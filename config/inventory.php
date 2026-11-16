<?php

/**
 * Inventory calculations & replenishment rules.
 *
 * Definitions:
 * - Usable On-Hand Stock (physical_stock): computed balance from usable receiving (excluding damaged/quarantined/rejected),
 *   usable store returns (excluding quarantined/rejected/damaged), authorized adjustments, releasing, and supplier returns.
 * - Quarantined / Rejected Stock (quarantined_stock): damaged/quarantined units on delivery or returned in non-usable condition.
 *   Never counted as usable stock.
 * - Active Reservations (reserved_stock): active stock_reservation records not yet released or cancelled.
 * - Available Stock = max(0, Usable On-Hand Stock - Active Reservations).
 * - Reorder Threshold: product.reorder_level (if 0 or unset, defaults to 10 for replenishment alerts).
 * - Maximum Stock: product.max_stock (defaults to 100).
 * - Suggested Order Quantity = max(0, max_stock - available_stock).
 * - Outstanding Replenishment = open PR lines not yet converted to POs
 *     (for PR in Pending, For Revision, Approved: max(0, COALESCE(approved_qty, requested_qty) - ordered_qty))
 *   + open PO lines not yet received
 *     (for PO in Draft, Ordered, Partially Received: max(0, quantity_ordered - quantity_received)).
 * - Additional Quantity Needed = max(0, base suggested quantity - unreceived non-cancelled PO quantity).
 *   Open PRs are informational and are not subtracted a second time.
 */

function effectiveReorderThreshold($reorderLevel) {
    $lvl = (int)$reorderLevel;
    return $lvl > 0 ? $lvl : 10;
}

function effectiveMaxStock($maxStock, $reorderLevel = 10) {
    $m = (int)$maxStock;
    $r = effectiveReorderThreshold($reorderLevel);
    if ($m <= 0) {
        return max(100, $r * 2);
    }
    return $m;
}

/**
 * Returns full inventory & replenishment metrics for one product (optionally locking the product row).
 */
function productInventoryMetrics(PDO $conn, $productId, $forUpdate = false, $excludePrId = 0) {
    $pid = (int)$productId;
    $exclPr = (int)$excludePrId;
    $lockSql = $forUpdate ? ' FOR UPDATE' : '';

    $stmt = $conn->prepare(
        "SELECT
            p.product_id,
            p.category_id,
            COALESCE(c.category_name, 'Uncategorized') AS category_name,
            p.product_name,
            p.unit_measure,
            p.unit_price,
            p.reorder_level,
            p.max_stock,
            p.is_active,
            p.created_at,
            (
              COALESCE((
                  SELECT SUM(COALESCE(d.quantity_accepted, d.quantity_received))
                  FROM stock_receiving_detail d
                  INNER JOIN stock_receiving sr ON sr.receiving_id = d.receiving_id
                  INNER JOIN purchase_order po ON po.po_id = sr.po_id
                  WHERE d.product_id = p.product_id
                    AND po.status NOT IN ('Cancelled', 'Rejected')
                    AND COALESCE(sr.status, 'Posted') IN ('Posted', 'Inspected')
              ), 0)
            + COALESCE((
                  SELECT SUM(d.quantity_returned)
                  FROM stocks_return_detail d
                  WHERE d.product_id = p.product_id
                    AND COALESCE(d.condition_status, 'Usable') = 'Usable'
              ), 0)
            + COALESCE((
                  SELECT SUM(d.quantity)
                  FROM adjustment_detail d
                  WHERE d.product_id = p.product_id
                    AND d.adjustment_type = 'Addition'
              ), 0)
            - COALESCE((
                  SELECT SUM(d.quantity_released)
                  FROM stock_releasing_detail d
                  WHERE d.product_id = p.product_id
              ), 0)
            - COALESCE((
                  SELECT SUM(d.quantity_returned)
                  FROM purchase_return_detail d
                  WHERE d.product_id = p.product_id
              ), 0)
            - COALESCE((
                  SELECT SUM(d.quantity)
                  FROM adjustment_detail d
                  WHERE d.product_id = p.product_id
                    AND d.adjustment_type = 'Deduction'
              ), 0)
            ) AS usable_on_hand_stock,
            (
              COALESCE((
                  SELECT SUM(COALESCE(d.quantity_quarantined, 0) + COALESCE(d.quantity_rejected, d.quantity_damaged, 0))
                  FROM stock_receiving_detail d
                  INNER JOIN stock_receiving sr ON sr.receiving_id = d.receiving_id
                  INNER JOIN purchase_order po ON po.po_id = sr.po_id
                  WHERE d.product_id = p.product_id
                    AND po.status NOT IN ('Cancelled', 'Rejected')
                    AND COALESCE(sr.status, 'Posted') IN ('Posted', 'Inspected')
              ), 0)
            + COALESCE((
                  SELECT SUM(d.quantity_returned)
                  FROM stocks_return_detail d
                  WHERE d.product_id = p.product_id
                    AND COALESCE(d.condition_status, 'Usable') IN ('Quarantined', 'Rejected', 'Damaged')
              ), 0)
            ) AS quarantined_stock,
            COALESCE((
                SELECT SUM(r.reserved_qty)
                FROM stock_reservation r
                WHERE r.product_id = p.product_id
                  AND r.status = 'Active'
                  AND (:excl_pr_res_1 = 0 OR r.pr_id IS NULL OR r.pr_id != :excl_pr_res_2)
            ), 0) AS reserved_stock,
            COALESCE((
                SELECT SUM(GREATEST(0, COALESCE(prd.approved_qty, prd.requested_qty) - prd.ordered_qty))
                FROM purchase_request_detail prd
                INNER JOIN purchase_request pr ON pr.pr_id = prd.pr_id
                WHERE prd.product_id = p.product_id
                  AND pr.status IN ('Pending', 'For Revision', 'Approved')
                  AND (:excl_pr_1 = 0 OR pr.pr_id != :excl_pr_2)
            ), 0) AS outstanding_pr_qty,
            COALESCE((
                SELECT SUM(GREATEST(0, pod.quantity_ordered - pod.quantity_received))
                FROM purchase_order_detail pod
                INNER JOIN purchase_order po ON po.po_id = pod.po_id
                WHERE pod.product_id = p.product_id
                  AND po.status IN ('Draft', 'Ordered', 'Partially Received', 'Pending', 'Pending Approval')
            ), 0) AS outstanding_po_qty,
            COALESCE((
                SELECT COUNT(*)
                FROM purchase_request_detail prd
                INNER JOIN purchase_request pr ON pr.pr_id = prd.pr_id
                WHERE prd.product_id = p.product_id
                  AND pr.status IN ('Pending', 'For Revision')
                  AND (:excl_pr_3 = 0 OR pr.pr_id != :excl_pr_4)
            ), 0) AS open_unapproved_requests,
            COALESCE((
                SELECT SUM(s.quantity)
                FROM store_inventory s
                WHERE s.product_id = p.product_id
            ), 0) AS store_stock,
            COALESCE(def_sup.supplier_id, 0) AS supplier_id,
            COALESCE(def_sup.supplier_name, '') AS supplier_name,
            COALESCE(def_sup.supplier_unit_cost, p.unit_price, 0) AS supplier_unit_cost
         FROM product p
         LEFT JOIN category c ON p.category_id = c.category_id
         LEFT JOIN (
             SELECT ps1.product_id, ps1.supplier_id, ps1.supplier_unit_cost, s1.supplier_name
             FROM product_supplier ps1
             INNER JOIN supplier s1 ON s1.supplier_id = ps1.supplier_id
             INNER JOIN (
                 SELECT product_id, MIN(supplier_unit_cost) AS min_cost
                 FROM product_supplier
                 GROUP BY product_id
             ) ps2 ON ps1.product_id = ps2.product_id AND ps1.supplier_unit_cost = ps2.min_cost
             GROUP BY ps1.product_id
         ) def_sup ON def_sup.product_id = p.product_id
         WHERE p.product_id = :pid" . $lockSql
    );
    $stmt->execute(array(
        ':pid' => $pid,
        ':excl_pr_res_1' => $exclPr,
        ':excl_pr_res_2' => $exclPr,
        ':excl_pr_1' => $exclPr,
        ':excl_pr_2' => $exclPr,
        ':excl_pr_3' => $exclPr,
        ':excl_pr_4' => $exclPr
    ));
    $row = $stmt->fetch();
    if (!$row) {
        return null;
    }
    return enrichProductMetricsRow($row);
}

/**
 * Returns all products with inventory & replenishment metrics in a single query.
 */
function allProductsWithMetrics(PDO $conn, $onlyActive = false) {
    $where = $onlyActive ? 'WHERE p.is_active = 1' : '';
    $sql = "SELECT
                p.product_id,
                p.category_id,
                COALESCE(c.category_name, 'Uncategorized') AS category_name,
                p.product_name,
                p.unit_measure,
                p.unit_price,
                p.reorder_level,
                p.max_stock,
                p.is_active,
                p.created_at,
                (
                  COALESCE(rcv.qty, 0)
                + COALESCE(sret.qty, 0)
                + COALESCE(adj_add.qty, 0)
                - COALESCE(rel.qty, 0)
                - COALESCE(pret.qty, 0)
                - COALESCE(adj_ded.qty, 0)
                ) AS usable_on_hand_stock,
                (
                  COALESCE(rcv.damaged_qty, 0)
                + COALESCE(sret.quarantined_qty, 0)
                ) AS quarantined_stock,
                COALESCE(res.qty, 0) AS reserved_stock,
                COALESCE(opr.qty, 0) AS outstanding_pr_qty,
                COALESCE(opo.qty, 0) AS outstanding_po_qty,
                COALESCE(opr.unapproved_cnt, 0) AS open_unapproved_requests,
                COALESCE(sinv.qty, 0) AS store_stock,
                COALESCE(def_sup.supplier_id, 0) AS supplier_id,
                COALESCE(def_sup.supplier_name, '') AS supplier_name,
                COALESCE(def_sup.supplier_unit_cost, p.unit_price, 0) AS supplier_unit_cost
            FROM product p
            LEFT JOIN category c ON p.category_id = c.category_id
            LEFT JOIN (
                SELECT ps1.product_id, ps1.supplier_id, ps1.supplier_unit_cost, s1.supplier_name
                FROM product_supplier ps1
                INNER JOIN supplier s1 ON s1.supplier_id = ps1.supplier_id
                INNER JOIN (
                    SELECT product_id, MIN(supplier_unit_cost) AS min_cost
                    FROM product_supplier
                    GROUP BY product_id
                ) ps2 ON ps1.product_id = ps2.product_id AND ps1.supplier_unit_cost = ps2.min_cost
                GROUP BY ps1.product_id
            ) def_sup ON def_sup.product_id = p.product_id
            LEFT JOIN (
                SELECT product_id, SUM(quantity) AS qty
                FROM store_inventory GROUP BY product_id
            ) sinv ON sinv.product_id = p.product_id
            LEFT JOIN (
                SELECT d.product_id,
                       SUM(CASE WHEN COALESCE(sr.status, 'Posted') IN ('Posted', 'Inspected') THEN COALESCE(d.quantity_accepted, d.quantity_received) ELSE 0 END) AS qty,
                       SUM(CASE WHEN COALESCE(sr.status, 'Posted') IN ('Posted', 'Inspected') THEN (COALESCE(d.quantity_quarantined, 0) + COALESCE(d.quantity_rejected, d.quantity_damaged, 0)) ELSE 0 END) AS damaged_qty
                FROM stock_receiving_detail d
                INNER JOIN stock_receiving sr ON sr.receiving_id = d.receiving_id
                INNER JOIN purchase_order po ON po.po_id = sr.po_id
                WHERE po.status NOT IN ('Cancelled', 'Rejected')
                GROUP BY d.product_id
            ) rcv ON rcv.product_id = p.product_id
            LEFT JOIN (
                SELECT product_id,
                       SUM(CASE WHEN COALESCE(condition_status, 'Usable') = 'Usable' THEN quantity_returned ELSE 0 END) AS qty,
                       SUM(CASE WHEN COALESCE(condition_status, 'Usable') IN ('Quarantined', 'Rejected', 'Damaged') THEN quantity_returned ELSE 0 END) AS quarantined_qty
                FROM stocks_return_detail GROUP BY product_id
            ) sret ON sret.product_id = p.product_id
            LEFT JOIN (
                SELECT product_id, SUM(quantity) AS qty
                FROM adjustment_detail WHERE adjustment_type = 'Addition' GROUP BY product_id
            ) adj_add ON adj_add.product_id = p.product_id
            LEFT JOIN (
                SELECT product_id, SUM(quantity_released) AS qty
                FROM stock_releasing_detail GROUP BY product_id
            ) rel ON rel.product_id = p.product_id
            LEFT JOIN (
                SELECT product_id, SUM(quantity_returned) AS qty
                FROM purchase_return_detail GROUP BY product_id
            ) pret ON pret.product_id = p.product_id
            LEFT JOIN (
                SELECT product_id, SUM(quantity) AS qty
                FROM adjustment_detail WHERE adjustment_type = 'Deduction' GROUP BY product_id
            ) adj_ded ON adj_ded.product_id = p.product_id
            LEFT JOIN (
                SELECT product_id, SUM(reserved_qty) AS qty
                FROM stock_reservation WHERE status = 'Active' GROUP BY product_id
            ) res ON res.product_id = p.product_id
            LEFT JOIN (
                SELECT prd.product_id,
                       SUM(GREATEST(0, COALESCE(prd.approved_qty, prd.requested_qty) - prd.ordered_qty)) AS qty,
                       SUM(CASE WHEN pr.status IN ('Pending', 'For Revision') THEN 1 ELSE 0 END) AS unapproved_cnt
                FROM purchase_request_detail prd
                INNER JOIN purchase_request pr ON pr.pr_id = prd.pr_id
                WHERE pr.status IN ('Pending', 'For Revision', 'Approved')
                GROUP BY prd.product_id
            ) opr ON opr.product_id = p.product_id
            LEFT JOIN (
                SELECT pod.product_id,
                       SUM(GREATEST(0, pod.quantity_ordered - pod.quantity_received)) AS qty
                FROM purchase_order_detail pod
                INNER JOIN purchase_order po ON po.po_id = pod.po_id
                WHERE po.status IN ('Draft', 'Ordered', 'Partially Received', 'Pending', 'Pending Approval')
                GROUP BY pod.product_id
            ) opo ON opo.product_id = p.product_id
            $where
            ORDER BY p.product_name ASC";

    $stmt = $conn->query($sql);
    $rows = $stmt->fetchAll();
    $out = array();
    foreach ($rows as $row) {
        $out[] = enrichProductMetricsRow($row);
    }
    return $out;
}

function enrichProductMetricsRow(array $row) {
    $usableOnHand = isset($row['usable_on_hand_stock']) ? (int)$row['usable_on_hand_stock'] : (isset($row['available_stock']) ? (int)$row['available_stock'] : 0);
    $usableOnHand = max(0, $usableOnHand);
    $reservedStock = isset($row['reserved_stock']) ? max(0, (int)$row['reserved_stock']) : 0;
    $quarantinedStock = isset($row['quarantined_stock']) ? max(0, (int)$row['quarantined_stock']) : 0;

    $reorder = (int)$row['reorder_level'];
    $threshold = effectiveReorderThreshold($reorder);
    $maxStock = effectiveMaxStock(isset($row['max_stock']) ? $row['max_stock'] : 100, $reorder);

    // Available Stock = Usable On-Hand Stock - Active Reservations (never negative, cannot exceed max capacity)
    $avail = max(0, $usableOnHand - $reservedStock);
    $avail = min($maxStock, $avail);
    $remainingCapacity = max(0, $maxStock - $avail);

    $rawPct = $maxStock > 0 ? (int)round(($avail / $maxStock) * 100) : 0;
    $stockPercentage = max(0, min(100, $rawPct));

    $outPr = (int)$row['outstanding_pr_qty'];
    $outPo = (int)$row['outstanding_po_qty'];
    // PR quantities are tracked separately; only unreceived PO units offset new ordering.
    $outstanding = max(0, $outPo);

    // Suggested Order Quantity = Maximum Stock − Available Warehouse Stock
    $suggested = max(0, $maxStock - $avail);
    $netStockPosition = max(0, $avail + $outPo);
    $netSuggested = max(0, $maxStock - $netStockPosition);
    $additionalNeeded = max(0, $suggested - $outPo);

    $isCritical = ($avail <= 0);
    $isLow = ($avail > 0 && $avail <= $threshold);
    $eligibleForAlert = ($avail <= $threshold);
    $isReachedReorder = ($avail <= $reorder || $avail <= $threshold);

    // Three distinct statuses: In Stock, Low Stock, Out of Stock
    $stockStatus = 'In Stock';
    if ($avail <= 0) {
        $stockStatus = 'Out of Stock';
    } elseif ($isLow || $isReachedReorder) {
        $stockStatus = 'Low Stock';
    }
    $statusUpper = ($avail <= 0) ? 'OUT OF STOCK' : (($isReachedReorder) ? 'LOW STOCK' : 'IN STOCK');

    $supplierId = isset($row['supplier_id']) ? (int)$row['supplier_id'] : 0;
    $supplierName = isset($row['supplier_name']) ? (string)$row['supplier_name'] : '';
    $unitCost = isset($row['supplier_unit_cost']) && (float)$row['supplier_unit_cost'] > 0
        ? (float)$row['supplier_unit_cost']
        : (isset($row['unit_price']) ? (float)$row['unit_price'] : 0.0);

    $storeStock = isset($row['store_stock']) ? (int)$row['store_stock'] : 0;
    $row['store_stock'] = $storeStock;
    $row['usable_on_hand_stock'] = $usableOnHand;
    $row['physical_stock'] = $usableOnHand;
    $row['usable_stock'] = $usableOnHand;
    $row['quarantined_stock'] = $quarantinedStock;
    $row['reserved_stock'] = $reservedStock;
    $row['stock_qty'] = $avail;
    $row['available_stock'] = $avail;
    $row['remaining_stock'] = $avail;
    $row['max_stock'] = $maxStock;
    $row['max_capacity'] = $maxStock;
    $row['remaining_capacity'] = $remainingCapacity;
    $row['remaining_stock_capacity'] = $remainingCapacity;
    $row['stock_percentage'] = $stockPercentage;
    $row['stock_level_percentage'] = $stockPercentage;
    $row['reorder_threshold'] = $threshold;
    $row['outstanding_pr_qty'] = $outPr;
    $row['outstanding_po_qty'] = $outPo;
    $row['on_order_qty'] = $outPo;
    $row['outstanding_replenishment'] = $outstanding;
    $row['net_stock_position'] = $netStockPosition;
    $row['net_suggested_order_qty'] = $netSuggested;
    $row['suggested_order_qty'] = $suggested;
    $row['base_quantity_to_order'] = $suggested;
    $row['base_qty_to_order'] = $suggested;
    $row['additional_qty_needed'] = $additionalNeeded;
    $row['additional_needed_qty'] = $additionalNeeded;
    $row['additional_quantity_needed'] = $additionalNeeded;
    $row['supplier_id'] = $supplierId;
    $row['supplier_name'] = $supplierName;
    $row['unit_cost'] = $unitCost;
    $row['estimated_cost'] = round($unitCost * $additionalNeeded, 2);
    $row['estimated_replenishment_cost'] = round($unitCost * $additionalNeeded, 2);
    $row['status'] = $statusUpper;
    $row['is_low_stock'] = $isLow || ($isReachedReorder && !$isCritical);
    $row['is_below_reorder'] = $eligibleForAlert || $isReachedReorder;
    $row['is_reached_reorder'] = $isReachedReorder;
    $row['is_critical_stock'] = $isCritical;
    $row['needs_replenishment'] = ($isCritical || $isLow || $isReachedReorder);
    $row['stock_status'] = $stockStatus;
    $row['open_unapproved_requests'] = isset($row['open_unapproved_requests']) ? (int)$row['open_unapproved_requests'] : 0;

    return $row;
}

/**
 * Returns all active products requiring replenishment (Out of Stock or Low Stock).
 * Authoritative replenishment logic:
 * - Out of Stock: Available Stock <= 0
 * - Low Stock: Available Stock > 0 AND Available Stock <= effectiveReorderThreshold(reorder_level)
 * Excludes well-stocked products (Available Stock > reorder threshold).
 * Returns products sorted by Available Stock ASC, then Product Name ASC.
 */
function getReplenishmentCandidates(PDO $conn) {
    $products = allProductsWithMetrics($conn, true);
    $candidates = array();

    foreach ($products as $p) {
        $avail = (int)$p['available_stock'];
        $reorder = (int)$p['reorder_level'];
        $threshold = (int)$p['reorder_threshold'];
        $effReorder = $reorder > 0 ? $reorder : $threshold;

        if ($avail <= 0 || ($avail > 0 && $avail <= $effReorder)) {
            $candidates[] = $p;
        }
    }

    usort($candidates, function ($a, $b) {
        $aAvail = (int)$a['available_stock'];
        $bAvail = (int)$b['available_stock'];
        if ($aAvail === $bAvail) {
            return strcmp((string)$a['product_name'], (string)$b['product_name']);
        }
        return $aAvail - $bAvail;
    });

    return $candidates;
}

/**
 * Checks a set of product IDs after a stock-reducing operation and creates
 * low-stock / critical-stock notifications when a product is at/below threshold.
 */
function checkAndNotifyLowStock(PDO $conn, array $productIds, $actor = null) {
    if (empty($productIds) || !function_exists('notifyUsersWithPermission')) {
        return;
    }
    foreach (array_unique(array_map('intval', $productIds)) as $pid) {
        if ($pid <= 0) {
            continue;
        }
        $m = productInventoryMetrics($conn, $pid, false);
        if (!$m || (int)$m['is_active'] !== 1) {
            continue;
        }
        if (!$m['is_low_stock']) {
            continue;
        }

        // Avoid spamming: skip if an unread low_stock notification for this product already exists in last 6 hours
        try {
            $chk = $conn->prepare(
                "SELECT notification_id FROM notification
                 WHERE ref_type = 'product' AND ref_id = :pid
                   AND type IN ('low_stock', 'critical_stock')
                   AND is_read = 0
                   AND created_at >= (NOW() - INTERVAL 6 HOUR)
                 LIMIT 1"
            );
            $chk->execute(array(':pid' => $pid));
            if ($chk->fetch()) {
                continue;
            }
        } catch (Throwable $e) {
            // ignore
        }

        $isCrit = !empty($m['is_critical_stock']);
        $type = $isCrit ? 'critical_stock' : 'low_stock';
        $severity = $isCrit ? 'danger' : 'warning';
        $title = ($isCrit ? 'Critical Stock Alert: ' : 'Low Stock Alert: ') . $m['product_name'];
        $msg = sprintf(
            'Low Stock Alert: %s is running low. Current stock: %d.',
            $m['product_name'],
            $m['available_stock']
        );

        notifyAdmins($conn, $type, $title, $msg, 'product', 'product', $pid, $severity);
        notifyUsersWithRoleNames($conn, array('Manager', 'Warehouse Staff', 'Warehouse Officer', 'Store Requester'), $type, $title, $msg, 'product', 'product', $pid, $severity);
    }
}
