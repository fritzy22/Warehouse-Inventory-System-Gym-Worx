<?php
require_once '../config/db.php';
require_once '../config/inventory.php';
sendJsonHeaders();

class PurchaseOrderApi {
    private PDO $conn;

    public function __construct(PDO $conn) {
        $this->conn = $conn;
    }

    public function handleRequest($method) {
        switch ($method) {
            case 'GET':
                $this->get();
                break;
            case 'POST':
                $this->post();
                break;
            case 'PUT':
                $this->put();
                break;
            default:
                sendResponse(false, 'Method not allowed.', null, 405);
                break;
        }
    }

    private function deriveOrderStatus($status) {
        $st = trim((string)$status);
        switch ($st) {
            case 'Draft':
                return 'Draft';
            case 'Pending Approval':
            case 'Pending PO Approval':
                return 'Pending PO Approval';
            case 'Ordered':
            case 'Issued':
                return 'Issued';
            case 'Partially Received':
                return 'Partially Received';
            case 'Received':
            case 'Fully Received':
                return 'Fully Received';
            case 'On Hold':
                return 'On Hold';
            case 'Cancelled':
                return 'Cancelled';
            case 'Closed':
            case 'Closed Short':
                return 'Closed';
            default:
                return 'Issued';
        }
    }

    private function deriveAuthorizationStatus($status, $existingAuthStatus = '') {
        $st = trim((string)$status);
        if ($st === 'Draft') {
            return 'Draft';
        }
        if ($st === 'Pending Approval' || $st === 'Pending PO Approval') {
            return 'Pending Approval';
        }
        if ($existingAuthStatus === 'Rejected') {
            return 'Rejected';
        }
        return 'Authorized';
    }

    private function deriveReceivingStatus($status, $totalOrdered = 0, $totalReceived = 0) {
        $st = trim((string)$status);
        $ord = (int)$totalOrdered;
        $rec = (int)$totalReceived;

        if (in_array($st, array('Draft', 'Pending Approval', 'Pending PO Approval', 'On Hold'), true)) {
            return 'Not Ready';
        }
        if ($st === 'Cancelled') {
            return 'Cancelled';
        }
        if ($st === 'Closed' || $st === 'Closed Short') {
            return ($ord > 0 && $rec >= $ord) ? 'Fully Received' : 'Closed Short';
        }
        if ($st === 'Received' || $st === 'Fully Received' || ($ord > 0 && $rec >= $ord)) {
            return 'Fully Received';
        }
        if ($st === 'Partially Received' || $rec > 0) {
            return 'Partially Received';
        }
        return 'Awaiting Delivery';
    }

    private function deriveInspectionStatus($status, $receivingEvents = 0, $totalDamaged = 0, $totalReceived = 0) {
        $st = trim((string)$status);
        $events = (int)$receivingEvents;
        $dmg = (int)$totalDamaged;
        $rec = (int)$totalReceived;

        if ($st === 'Cancelled' && $events === 0 && $rec === 0) {
            return 'Not Applicable';
        }
        if ($events === 0 && $rec === 0) {
            return 'Pending Delivery';
        }
        if ($dmg > 0) {
            return 'Partial Discrepancy / Damaged';
        }
        return 'Passed';
    }

    private function enrichPoRow(array $row) {
        $poId = isset($row['po_id']) ? (int)$row['po_id'] : 0;
        $st = isset($row['status']) ? (string)$row['status'] : 'Ordered';
        $ord = isset($row['total_qty_ordered']) ? (int)$row['total_qty_ordered'] : 0;
        $rec = isset($row['total_qty_received']) ? (int)$row['total_qty_received'] : 0;
        $dmg = isset($row['total_qty_damaged']) ? (int)$row['total_qty_damaged'] : 0;
        $events = isset($row['receiving_events']) ? (int)$row['receiving_events'] : 0;

        $row['po_code'] = !empty($row['po_code'])
            ? (string)$row['po_code']
            : ('PO-' . str_pad((string)$poId, 5, '0', STR_PAD_LEFT));

        $hasPr = (!empty($row['pr_id']) && (int)$row['pr_id'] > 0)
            || (!empty($row['linked_pr_count']) && (int)$row['linked_pr_count'] > 0);
        if (!empty($row['po_source'])) {
            $row['po_source'] = (string)$row['po_source'];
        } else {
            $row['po_source'] = $hasPr ? 'PR-Linked' : 'Independent';
        }

        $row['outstanding_qty'] = in_array($st, array('Cancelled', 'Closed', 'Closed Short', 'Received', 'Fully Received'), true)
            ? 0
            : max(0, $ord - $rec);
        $row['total_outstanding_qty'] = $row['outstanding_qty'];

        $row['order_status'] = $this->deriveOrderStatus($st);
        $row['authorization_status'] = $this->deriveAuthorizationStatus($st, isset($row['authorization_status']) ? (string)$row['authorization_status'] : '');
        $row['receiving_status'] = $this->deriveReceivingStatus($st, $ord, $rec);
        $row['inspection_status'] = $this->deriveInspectionStatus($st, $events, $dmg, $rec);
        $row['is_receivable'] = in_array($st, array('Ordered', 'Issued', 'Partially Received'), true)
            && $row['authorization_status'] === 'Authorized'
            && $row['outstanding_qty'] > 0;

        return $row;
    }

    private function get() {
        requirePermission(array('purchase_order', 'stock_receiving', 'purchase_return', 'request_approval'), 'view');
        $mode = isset($_GET['mode']) ? (string)$_GET['mode'] : 'all';

        switch ($mode) {
            case 'reorder_candidates':
            case 'replenishment':
                sendResponse(true, 'Replenishment candidates retrieved', getReplenishmentCandidates($this->conn));
                break;
            case 'pending':
            case 'receivable':
                sendResponse(true, 'Receivable purchase orders retrieved', $this->getReceivablePurchaseOrders());
                break;
            case 'pending_approval':
                sendResponse(true, 'Purchase orders awaiting manager approval retrieved', $this->getPendingApprovalPurchaseOrders());
                break;
            case 'detail':
                $id = validatePositiveInt(isset($_GET['po_id']) ? $_GET['po_id'] : 0);
                if ($id <= 0) {
                    sendResponse(false, 'Valid PO ID is required.', null, 400);
                }
                $po = $this->getFullPurchaseOrder($id);
                if (!$po) {
                    sendResponse(false, 'Purchase order not found.', null, 404);
                }
                sendResponse(true, 'Purchase order retrieved', $po);
                break;
            default:
                $statusFilter = isset($_GET['status']) && is_string($_GET['status']) ? trim($_GET['status']) : '';
                sendResponse(true, 'Purchase orders retrieved', $this->getAllPurchaseOrders($statusFilter));
                break;
        }
    }

    private function post() {
        $user = requirePermission('purchase_order', 'manage');
        requireCsrf();
        $b = getRequestBody();
        $this->createPurchaseOrder($b, $user);
    }

    private function put() {
        $b = getRequestBody();
        $action = isset($b['action']) && is_string($b['action']) ? strtolower(trim($b['action'])) : '';

        if ($action === 'approve' || $action === 'reject') {
            $user = requirePermission('request_approval', 'manage');
        } else {
            $user = requirePermission('purchase_order', 'manage');
        }
        requireCsrf();
        $this->updatePurchaseOrderStatus($b, $user);
    }

    private function createPurchaseOrder(array $b, array $user) {
        $sid = validatePositiveInt(isset($b['supplier_id']) ? $b['supplier_id'] : 0);
        $headerPrId = validatePositiveInt(isset($b['pr_id']) ? $b['pr_id'] : 0);
        $rawSource = isset($b['po_source']) && is_string($b['po_source']) ? trim($b['po_source']) : '';
        $rawType = isset($b['po_type']) && is_string($b['po_type']) ? trim($b['po_type']) : '';
        $date = isset($b['order_date']) && is_string($b['order_date']) && trim($b['order_date']) !== ''
            ? trim($b['order_date'])
            : date('Y-m-d');
        $expectedDate = isset($b['expected_date']) && is_string($b['expected_date']) && trim($b['expected_date']) !== ''
            ? trim($b['expected_date'])
            : null;
        $items = isset($b['items']) && is_array($b['items']) ? $b['items'] : array();
        $rawStatus = isset($b['status']) && is_string($b['status']) ? trim($b['status']) : '';
        $notes = isset($b['notes']) && is_string($b['notes'])
            ? trim($b['notes'])
            : (isset($b['manager_notes']) && is_string($b['manager_notes']) ? trim($b['manager_notes']) : '');
        $authNote = isset($b['authorization_note']) && is_string($b['authorization_note']) ? trim($b['authorization_note']) : '';
        $authorizeOverStock = !empty($b['authorize_over_stock']) || !empty($b['authorized_override']) || $authNote !== '';
        $clientToken = isset($b['client_token']) && is_string($b['client_token']) && trim($b['client_token']) !== ''
            ? substr(trim($b['client_token']), 0, 64)
            : null;

        if ($sid <= 0 || !validateDateValue($date) || empty($items)) {
            sendResponse(false, 'Supplier, valid order date, and at least one line item are required.', null, 400);
        }
        if ($expectedDate !== null && !validateDateValue($expectedDate)) {
            sendResponse(false, 'Expected delivery date must be in YYYY-MM-DD format.', null, 400);
        }
        if (!$this->activeSupplier($sid)) {
            sendResponse(false, 'Selected supplier is inactive or does not exist.', null, 422);
        }

        // Idempotency guard via client_token
        if ($clientToken !== null) {
            $dupStmt = $this->conn->prepare("SELECT po_id FROM purchase_order WHERE client_token = :tok LIMIT 1");
            $dupStmt->execute(array(':tok' => $clientToken));
            if ($dupStmt->fetch()) {
                sendResponse(false, 'Duplicate purchase order submission detected.', null, 409);
            }
        }

        // Check if any item carries a line-level pr_id or pr_detail_id
        $hasLinePrRef = false;
        foreach ($items as $it) {
            if (!empty($it['pr_id']) || !empty($it['pr_detail_id'])) {
                $hasLinePrRef = true;
                break;
            }
        }

        $isIndependentReq = in_array(strtolower($rawSource), array('independent', 'direct'), true)
            || in_array(strtolower($rawType), array('independent', 'direct', 'warehouse_replenishment'), true);

        if ($headerPrId <= 0 && !$hasLinePrRef && !$isIndependentReq) {
            sendResponse(false, 'A Purchase Order must be linked to an approved Purchase Request or marked as an Independent PO.', null, 422);
        }

        $isPrLinked = ($headerPrId > 0 || $hasLinePrRef);
        $poSource = $isPrLinked ? 'PR-Linked' : 'Independent';
        if ($isPrLinked) {
            $poType = 'pr_replenishment';
        } else {
            $poType = (strtolower($rawType) === 'warehouse_replenishment') ? 'warehouse_replenishment' : 'Independent';
        }

        // Determine initial status and authorization status
        $roleId = isset($user['role_id']) ? (int)$user['role_id'] : 0;
        $roleIdentifier = $roleId > 0 ? $roleId : (isset($user['role_name']) ? $user['role_name'] : '');
        $canDirectApprove = userCan($roleIdentifier, 'request_approval', 'manage');

        if ($rawStatus === 'Draft') {
            $initialStatus = 'Draft';
        } elseif ($rawStatus === 'Pending Approval' || $rawStatus === 'Pending PO Approval') {
            $initialStatus = 'Pending Approval';
        } elseif ($rawStatus === 'Issued' || $rawStatus === 'Ordered') {
            $initialStatus = 'Ordered';
        } elseif (!$isPrLinked && $poType === 'warehouse_replenishment' && !$canDirectApprove) {
            $initialStatus = 'Pending Approval';
        } else {
            $initialStatus = 'Ordered';
        }

        $orderStatus = $this->deriveOrderStatus($initialStatus);
        $authStatus = $this->deriveAuthorizationStatus($initialStatus);
        $recvStatus = $this->deriveReceivingStatus($initialStatus, 0, 0);
        $inspStatus = 'Pending Delivery';

        // Validate items and supplier pricing
        $linkLookup = $this->conn->prepare(
            "SELECT supplier_unit_cost FROM product_supplier WHERE product_id = :pid AND supplier_id = :sid LIMIT 1"
        );
        $prodLookup = $this->conn->prepare(
            "SELECT product_id, product_name, unit_price, is_active FROM product WHERE product_id = :pid LIMIT 1"
        );

        $seenPrLineKeys = array();
        $normalizedItems = array();

        foreach ($items as $item) {
            $pid = validatePositiveInt(isset($item['product_id']) ? $item['product_id'] : 0);
            $qty = validatePositiveInt(isset($item['quantity_ordered']) ? $item['quantity_ordered'] : (isset($item['qty']) ? $item['qty'] : 0));
            $linePrId = validatePositiveInt(isset($item['pr_id']) ? $item['pr_id'] : $headerPrId);
            $linePrDetailId = validatePositiveInt(isset($item['pr_detail_id']) ? $item['pr_detail_id'] : 0);

            if ($pid <= 0 || $qty <= 0) {
                sendResponse(false, 'Each PO line must specify a valid product and positive quantity.', null, 422);
            }

            $prodLookup->execute(array(':pid' => $pid));
            $prodRow = $prodLookup->fetch();
            if (!$prodRow || (int)$prodRow['is_active'] !== 1) {
                sendResponse(false, 'Product #' . $pid . ' is inactive or does not exist.', null, 422);
            }

            // Dedup Key: allow same product on different PR lines if multi-PR, but prevent duplicate same line
            $dedupKey = $linePrId . ':' . $linePrDetailId . ':' . $pid;
            if (isset($seenPrLineKeys[$dedupKey])) {
                sendResponse(false, 'Duplicate product line in purchase order.', null, 422);
            }
            $seenPrLineKeys[$dedupKey] = true;

            $linkLookup->execute(array(':pid' => $pid, ':sid' => $sid));
            $link = $linkLookup->fetch();

            $costProvided = isset($item['unit_cost']) && $item['unit_cost'] !== '' && $item['unit_cost'] !== null;
            if ($costProvided) {
                if (!validateNonNegativeDecimal($item['unit_cost'])) {
                    sendResponse(false, 'Invalid unit cost for Product #' . $pid . '.', null, 422);
                }
                $cost = (string)$item['unit_cost'];
            } elseif ($link) {
                $cost = (string)$link['supplier_unit_cost'];
            } else {
                $cost = (string)$prodRow['unit_price'];
            }

            // If require_supplier_link is explicitly requested and not linked, enforce it;
            // otherwise ensure product_supplier link exists so catalog stays synchronized
            if (!$link && !empty($b['require_supplier_link'])) {
                sendResponse(false, 'Product #' . $pid . ' is not linked to the selected supplier.', null, 422);
            }

            $normalizedItems[] = array(
                'product_id' => $pid,
                'product_name' => $prodRow['product_name'],
                'quantity_ordered' => $qty,
                'unit_cost' => $cost,
                'pr_id' => $linePrId > 0 ? $linePrId : null,
                'pr_detail_id' => $linePrDetailId > 0 ? $linePrDetailId : null,
                'has_supplier_link' => (bool)$link
            );
        }

        $this->conn->beginTransaction();
        try {
            $touchedPrIds = array();

            if ($isPrLinked) {
                // Lock and validate each referenced PR and PR detail row
                $prLockStmt = $this->conn->prepare("SELECT * FROM purchase_request WHERE pr_id = :id FOR UPDATE");
                $prLineByDetailStmt = $this->conn->prepare(
                    "SELECT d.pr_detail_id, d.pr_id, d.product_id, d.requested_qty, d.approved_qty, d.ordered_qty,
                            COALESCE((
                                SELECT SUM(r.reserved_qty)
                                FROM stock_reservation r
                                WHERE r.pr_id = d.pr_id AND r.product_id = d.product_id AND r.status = 'Active'
                            ), 0) AS reserved_qty,
                            COALESCE((
                                SELECT SUM(srd.quantity_released)
                                FROM stock_releasing_detail srd
                                INNER JOIN stock_releasing sr ON sr.releasing_id = srd.releasing_id
                                WHERE sr.pr_id = d.pr_id AND srd.product_id = d.product_id
                            ), 0) AS released_qty
                     FROM purchase_request_detail d
                     WHERE d.pr_detail_id = :did
                     FOR UPDATE"
                );
                $prLineByProductStmt = $this->conn->prepare(
                    "SELECT d.pr_detail_id, d.pr_id, d.product_id, d.requested_qty, d.approved_qty, d.ordered_qty,
                            COALESCE((
                                SELECT SUM(r.reserved_qty)
                                FROM stock_reservation r
                                WHERE r.pr_id = d.pr_id AND r.product_id = d.product_id AND r.status = 'Active'
                            ), 0) AS reserved_qty,
                            COALESCE((
                                SELECT SUM(srd.quantity_released)
                                FROM stock_releasing_detail srd
                                INNER JOIN stock_releasing sr ON sr.releasing_id = srd.releasing_id
                                WHERE sr.pr_id = d.pr_id AND srd.product_id = d.product_id
                            ), 0) AS released_qty
                     FROM purchase_request_detail d
                     WHERE d.pr_id = :pr_id AND d.product_id = :pid
                     LIMIT 1
                     FOR UPDATE"
                );

                $lockedPrs = array();
                if ($headerPrId > 0) {
                    $prLockStmt->execute(array(':id' => $headerPrId));
                    $prRow = $prLockStmt->fetch();
                    if (!$prRow) {
                        $this->conn->rollBack();
                        sendResponse(false, 'Linked Purchase Request #' . $headerPrId . ' not found.', null, 404);
                    }
                    if (!in_array((string)$prRow['status'], array('Approved', 'Partially Ordered', 'Ordered'), true) || ($prRow['approval_status'] ?? '') === 'Rejected') {
                        $this->conn->rollBack();
                        sendResponse(
                            false,
                            'Purchase Request #' . $headerPrId . ' has status "' . $prRow['status'] . '". Only Manager-Approved Purchase Requests can be converted to a Purchase Order.',
                            null,
                            422
                        );
                    }
                    $lockedPrs[$headerPrId] = $prRow;
                }
                foreach ($normalizedItems as &$item) {
                    $prLine = null;
                    if (!empty($item['pr_detail_id'])) {
                        $prLineByDetailStmt->execute(array(':did' => (int)$item['pr_detail_id']));
                        $prLine = $prLineByDetailStmt->fetch();
                        if (!$prLine || (int)$prLine['product_id'] !== (int)$item['product_id']) {
                            $this->conn->rollBack();
                            sendResponse(false, 'Invalid Purchase Request detail line #' . (int)$item['pr_detail_id'] . '.', null, 422);
                        }
                        $item['pr_id'] = (int)$prLine['pr_id'];
                    } else {
                        $targetPrId = !empty($item['pr_id']) ? (int)$item['pr_id'] : $headerPrId;
                        if ($targetPrId <= 0) {
                            $this->conn->rollBack();
                            sendResponse(false, 'Every line on a PR-Linked PO must reference an approved Purchase Request.', null, 422);
                        }
                        $prLineByProductStmt->execute(array(':pr_id' => $targetPrId, ':pid' => (int)$item['product_id']));
                        $prLine = $prLineByProductStmt->fetch();
                        if (!$prLine) {
                            $this->conn->rollBack();
                            sendResponse(false, 'Product #' . $item['product_id'] . ' is not part of Purchase Request #' . $targetPrId . '.', null, 422);
                        }
                        $item['pr_id'] = $targetPrId;
                        $item['pr_detail_id'] = (int)$prLine['pr_detail_id'];
                    }

                    $targetPrId = (int)$item['pr_id'];
                    if (!isset($lockedPrs[$targetPrId])) {
                        $prLockStmt->execute(array(':id' => $targetPrId));
                        $prRow = $prLockStmt->fetch();
                        if (!$prRow) {
                            $this->conn->rollBack();
                            sendResponse(false, 'Linked Purchase Request #' . $targetPrId . ' not found.', null, 404);
                        }
                        if (!in_array((string)$prRow['status'], array('Approved', 'Partially Ordered', 'Ordered'), true)) {
                            $this->conn->rollBack();
                            sendResponse(
                                false,
                                'Purchase Request #' . $targetPrId . ' has status "' . $prRow['status'] . '". Only Manager-Approved Purchase Requests can be converted to a Purchase Order.',
                                null,
                                422
                            );
                        }
                        $lockedPrs[$targetPrId] = $prRow;
                    }

                    $authorized = $prLine['approved_qty'] !== null
                        ? (int)$prLine['approved_qty']
                        : (int)$prLine['requested_qty'];
                    $alreadyOrdered = (int)$prLine['ordered_qty'];
                    $alreadyReleased = (int)$prLine['released_qty'];
                    $alreadyReserved = (int)$prLine['reserved_qty'];
                    $remainingApproved = max(0, $authorized - $alreadyOrdered - $alreadyReleased - $alreadyReserved);

                    if ((int)$item['quantity_ordered'] > $remainingApproved) {
                        $this->conn->rollBack();
                        sendResponse(
                            false,
                            'Cannot order ' . $item['quantity_ordered'] . ' unit(s) of Product #' . $item['product_id'] .
                            ' — only ' . $remainingApproved . ' authorized unit(s) remain on approved PR #' . $targetPrId . '.',
                            null,
                            422
                        );
                    }

                    // Check available unreserved stock vs remaining approved quantity
                    $m = productInventoryMetrics($this->conn, (int)$item['product_id'], true, $targetPrId);
                    $usableOnHand = $m ? (int)($m['usable_stock'] ?? $m['usable_on_hand_stock'] ?? 0) : 0;
                    $allReserved = $m ? (int)$m['reserved_stock'] : 0;
                    $availUnreserved = max(0, $usableOnHand - $allReserved);
                    $shortageQty = max(0, $remainingApproved - $availUnreserved);

                    // Rule: If stock is sufficient to cover the remaining approved PR quantity (shortage == 0),
                    // do not allow creating an unnecessary PO without explicit authorization override.
                    if ($shortageQty <= 0 && !$authorizeOverStock) {
                        $this->conn->rollBack();
                        sendResponse(
                            false,
                            'Sufficient usable warehouse stock (' . $availUnreserved . ' available) already covers the remaining approved quantity (' . $remainingApproved . ') for Product #' . $item['product_id'] . '. Proceed to stock reservation/release without a PO, or provide authorization override.',
                            null,
                            422
                        );
                    }

                    // Optional strict shortage enforcement when caller specifies enforce_shortage_limit
                    if (!empty($b['enforce_shortage_limit']) && !$authorizeOverStock && (int)$item['quantity_ordered'] > $shortageQty) {
                        $this->conn->rollBack();
                        sendResponse(
                            false,
                            'Order quantity (' . $item['quantity_ordered'] . ') exceeds calculated shortage (' . $shortageQty . ' unit(s); Approved=' . $remainingApproved . ', Available Stock=' . $availUnreserved . '). Do not order units already covered by usable stock without authorization.',
                            null,
                            422
                        );
                    }

                    $touchedPrIds[$targetPrId] = true;
                }
                unset($item);

                if ($headerPrId <= 0 && count($touchedPrIds) === 1) {
                    $headerPrId = (int)key($touchedPrIds);
                }
            }

            // Ensure product_supplier link exists for any new product-supplier pair
            $insLink = $this->conn->prepare(
                "INSERT IGNORE INTO product_supplier (product_id, supplier_id, supplier_unit_cost) VALUES (:pid, :sid, :cost)"
            );
            foreach ($normalizedItems as $item) {
                if (!$item['has_supplier_link']) {
                    $insLink->execute(array(
                        ':pid' => (int)$item['product_id'],
                        ':sid' => $sid,
                        ':cost' => $item['unit_cost']
                    ));
                }
            }

            $combinedNotes = $notes;
            if ($authNote !== '') {
                $combinedNotes = $combinedNotes !== '' ? ($combinedNotes . ' | Auth: ' . $authNote) : ('Auth: ' . $authNote);
            }

            // Insert purchase_order header
            $ins = $this->conn->prepare(
                "INSERT INTO purchase_order
                    (supplier_id, user_id, pr_id, po_type, po_source, order_date, expected_date,
                     status, order_status, receiving_status, inspection_status, authorization_status,
                     confirmed_at, approved_by, approved_at, manager_notes, notes, client_token)
                 VALUES
                    (:sid, :uid, :pr_id, :po_type, :po_source, :odate, :edate,
                     :status, :order_status, :receiving_status, :inspection_status, :authorization_status,
                     :confirmed_at, :approved_by, :approved_at, :mnotes, :notes, :client_token)"
            );
            $confirmedAt = ($initialStatus === 'Ordered') ? date('Y-m-d H:i:s') : null;
            $approvedBy = (!$isPrLinked && $initialStatus === 'Ordered' && $canDirectApprove) ? (int)$user['user_id'] : null;
            $approvedAt = ($approvedBy !== null) ? date('Y-m-d H:i:s') : null;

            $ins->execute(array(
                ':sid'                  => $sid,
                ':uid'                  => (int)$user['user_id'],
                ':pr_id'                => $headerPrId > 0 ? $headerPrId : null,
                ':po_type'              => $poType,
                ':po_source'            => $poSource,
                ':odate'                => $date,
                ':edate'                => $expectedDate,
                ':status'               => $initialStatus,
                ':order_status'         => $orderStatus,
                ':receiving_status'     => $recvStatus,
                ':inspection_status'    => $inspStatus,
                ':authorization_status' => $authStatus,
                ':confirmed_at'         => $confirmedAt,
                ':approved_by'          => $approvedBy,
                ':approved_at'          => $approvedAt,
                ':mnotes'               => $combinedNotes !== '' ? $combinedNotes : null,
                ':notes'                => $combinedNotes !== '' ? $combinedNotes : null,
                ':client_token'         => $clientToken
            ));
            $poId = (int)$this->conn->lastInsertId();
            $poCode = 'PO-' . str_pad((string)$poId, 5, '0', STR_PAD_LEFT);

            $this->conn->prepare("UPDATE purchase_order SET po_code = :code WHERE po_id = :id")
                ->execute(array(':code' => $poCode, ':id' => $poId));

            // Insert detail lines & increment PR ordered_qty when linked to PR
            $detailStmt = $this->conn->prepare(
                "INSERT INTO purchase_order_detail (po_id, pr_id, pr_detail_id, product_id, quantity_ordered, quantity_received, unit_cost)
                 VALUES (:po_id, :pr_id, :pr_detail_id, :pid, :qty, 0, :cost)"
            );
            $updPrDetail = $this->conn->prepare(
                "UPDATE purchase_request_detail
                 SET ordered_qty = ordered_qty + :qty
                 WHERE pr_detail_id = :did"
            );

            $totalOrderedQty = 0;
            $totalAmount = 0.0;
            foreach ($normalizedItems as $item) {
                $detailStmt->execute(array(
                    ':po_id'        => $poId,
                    ':pr_id'        => $item['pr_id'],
                    ':pr_detail_id' => $item['pr_detail_id'],
                    ':pid'          => (int)$item['product_id'],
                    ':qty'          => (int)$item['quantity_ordered'],
                    ':cost'         => $item['unit_cost'],
                ));
                if (!empty($item['pr_detail_id'])) {
                    $updPrDetail->execute(array(
                        ':qty' => (int)$item['quantity_ordered'],
                        ':did' => (int)$item['pr_detail_id'],
                    ));
                }
                $totalOrderedQty += (int)$item['quantity_ordered'];
                $totalAmount += ((int)$item['quantity_ordered'] * (float)$item['unit_cost']);
            }

            // Update touched PRs' fulfillment_status and status
            if (!empty($touchedPrIds)) {
                $remCheck = $this->conn->prepare(
                    "SELECT COUNT(*) AS rem
                     FROM purchase_request_detail d
                     WHERE d.pr_id = :pr_id
                       AND GREATEST(0, COALESCE(d.approved_qty, d.requested_qty) - d.ordered_qty - COALESCE((
                           SELECT SUM(srd.quantity_released)
                           FROM stock_releasing_detail srd
                           INNER JOIN stock_releasing sr ON sr.releasing_id = srd.releasing_id
                           WHERE sr.pr_id = d.pr_id AND srd.product_id = d.product_id
                       ), 0) - COALESCE((
                           SELECT SUM(r.reserved_qty)
                           FROM stock_reservation r
                           WHERE r.pr_id = d.pr_id AND r.product_id = d.product_id AND r.status = 'Active'
                       ), 0)) > 0"
                );
                $prHistStmt = $this->conn->prepare(
                    "INSERT INTO purchase_request_history (pr_id, user_id, action, from_status, to_status, comment)
                     VALUES (:pr_id, :uid, 'PO_CREATED', :from_st, :to_st, :comment)"
                );

                foreach (array_keys($touchedPrIds) as $tPrId) {
                    $remCheck->execute(array(':pr_id' => $tPrId));
                    $remRow = $remCheck->fetch();
                    $prevSt = isset($lockedPrs[$tPrId]['status']) ? (string)$lockedPrs[$tPrId]['status'] : 'Approved';

                    if ((int)$remRow['rem'] > 0) {
                        $nextSt = 'Approved';
                        $nextFulfill = 'Partially Ordered — PO Created';
                    } else {
                        $nextSt = 'Ordered';
                        $nextFulfill = 'Ordered — PO Created';
                    }

                    $this->conn->prepare(
                        "UPDATE purchase_request
                         SET status = :st,
                             fulfillment_status = :fulfill,
                             updated_at = NOW()
                         WHERE pr_id = :id"
                    )->execute(array(
                        ':st'      => $nextSt,
                        ':fulfill' => $nextFulfill,
                        ':id'      => $tPrId
                    ));

                    $prHistStmt->execute(array(
                        ':pr_id'   => $tPrId,
                        ':uid'     => (int)$user['user_id'],
                        ':from_st' => $prevSt,
                        ':to_st'   => $nextSt,
                        ':comment' => 'Linked to ' . $poCode . ' (' . $orderStatus . ')'
                    ));
                }
            }

            $this->conn->commit();
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            error_log('PO create error: ' . $e->getMessage());
            sendResponse(false, 'Failed to create purchase order.', null, 500);
        }

        $actorName = $user['first_name'] . ' ' . $user['last_name'];
        $poCode = 'PO-' . str_pad((string)$poId, 5, '0', STR_PAD_LEFT);
        $prCode = $headerPrId > 0 ? ('PR-' . str_pad((string)$headerPrId, 4, '0', STR_PAD_LEFT)) : 'Independent PO';
        auditLog(
            $this->conn,
            $user,
            'CREATE',
            'purchase_order',
            $poId,
            'Created ' . $poCode . ' (' . $poSource . ', status=' . $initialStatus . ', order_status=' . $orderStatus . ($headerPrId > 0 ? ', linked to ' . $prCode : '') . ')'
        );

        if ($initialStatus === 'Pending Approval') {
            notifyRole(
                $this->conn,
                'Manager',
                'po_pending_approval',
                $poCode . ' Awaiting PO Approval',
                $actorName . ' submitted ' . $poCode . ' (' . $poSource . ') for Manager approval.',
                'purchase_order',
                'purchase_order',
                $poId,
                'warning',
                (int)$user['user_id']
            );
        } elseif ($initialStatus === 'Ordered') {
            notifyRole(
                $this->conn,
                'Warehouse Staff',
                'po_ordered',
                $poCode . ' Issued — Incoming Delivery',
                $actorName . ' issued ' . $poCode . ' (' . $prCode . '). Ready for warehouse receiving upon arrival.',
                'stock_receiving',
                'purchase_order',
                $poId,
                'info',
                (int)$user['user_id']
            );
        }

        sendResponse(
            true,
            $poCode . ' created successfully.',
            array(
                'po_id'                => $poId,
                'po_code'              => $poCode,
                'pr_id'                => $headerPrId > 0 ? $headerPrId : null,
                'po_type'              => $poType,
                'po_source'            => $poSource,
                'status'               => $initialStatus,
                'order_status'         => $orderStatus,
                'authorization_status' => $authStatus,
                'receiving_status'     => $recvStatus,
                'inspection_status'    => $inspStatus,
                'total_qty_ordered'    => $totalOrderedQty,
                'total_qty_received'   => 0,
                'outstanding_qty'      => $totalOrderedQty,
                'total_amount'         => round($totalAmount, 2)
            )
        );
    }

    private function updatePurchaseOrderStatus(array $b, array $user) {
        $poId = validatePositiveInt(isset($b['po_id']) ? $b['po_id'] : 0);
        $action = isset($b['action']) && is_string($b['action']) ? strtolower(trim($b['action'])) : '';
        $newStatus = isset($b['status']) && is_string($b['status']) ? trim($b['status']) : '';
        $reason = isset($b['reason']) && is_string($b['reason'])
            ? trim($b['reason'])
            : (isset($b['notes']) && is_string($b['notes']) ? trim($b['notes']) : '');

        if ($poId <= 0) {
            sendResponse(false, 'Valid PO ID is required.', null, 400);
        }

        // Normalize action -> status
        if ($action === 'confirm' || $action === 'issue' || $newStatus === 'Issued') {
            $newStatus = 'Ordered';
        } elseif ($action === 'submit_for_approval' || $newStatus === 'Pending PO Approval') {
            $newStatus = 'Pending Approval';
        } elseif ($action === 'approve') {
            $newStatus = 'Ordered';
        } elseif ($action === 'reject') {
            $newStatus = 'Cancelled';
        } elseif ($action === 'hold' || $newStatus === 'On Hold') {
            $newStatus = 'On Hold';
        } elseif ($action === 'resume') {
            $newStatus = 'Ordered';
        } elseif ($action === 'cancel') {
            $newStatus = 'Cancelled';
        } elseif ($action === 'close_short' || $action === 'close' || $newStatus === 'Closed') {
            $newStatus = 'Closed Short';
        } elseif ($newStatus === 'Fully Received') {
            $newStatus = 'Received';
        }

        $allowedTargets = array('Draft', 'Pending Approval', 'Ordered', 'On Hold', 'Cancelled', 'Closed Short', 'Received');
        if (!in_array($newStatus, $allowedTargets, true)) {
            sendResponse(false, 'Unsupported status transition.', null, 422);
        }

        if (($action === 'reject' || $newStatus === 'Closed Short' || $newStatus === 'On Hold') && $reason === '') {
            sendResponse(false, 'Please provide a reason/note for this status update.', null, 422);
        }

        $this->conn->beginTransaction();
        try {
            $stmt = $this->conn->prepare("SELECT * FROM purchase_order WHERE po_id = :id FOR UPDATE");
            $stmt->execute(array(':id' => $poId));
            $po = $stmt->fetch();
            if (!$po) {
                $this->conn->rollBack();
                sendResponse(false, 'Purchase order not found.', null, 404);
            }

            $currentStatus = (string)$po['status'];
            $prId = $po['pr_id'] ? (int)$po['pr_id'] : 0;

            $rcvSumStmt = $this->conn->prepare(
                "SELECT COALESCE(SUM(quantity_ordered), 0) AS total_ordered,
                        COALESCE(SUM(quantity_received), 0) AS total_received
                 FROM purchase_order_detail
                 WHERE po_id = :id"
            );
            $rcvSumStmt->execute(array(':id' => $poId));
            $sums = $rcvSumStmt->fetch();
            $totalOrdered = (int)$sums['total_ordered'];
            $totalReceived = (int)$sums['total_received'];

            if ($action === 'approve') {
                if (!in_array($currentStatus, array('Pending Approval', 'Pending PO Approval', 'Draft'), true)) {
                    $this->conn->rollBack();
                    sendResponse(false, 'Only POs awaiting approval can be approved.', null, 409);
                }
                $orderStatus = 'Issued';
                $authStatus = 'Authorized';
                $recvStatus = 'Awaiting Delivery';
                $this->conn->prepare(
                    "UPDATE purchase_order
                     SET status = 'Ordered',
                         order_status = :ost,
                         authorization_status = :ast,
                         receiving_status = :rst,
                         approved_by = :uid,
                         approved_at = NOW(),
                         confirmed_at = NOW(),
                         manager_notes = COALESCE(NULLIF(:notes, ''), manager_notes),
                         updated_at = NOW()
                     WHERE po_id = :id"
                )->execute(array(
                    ':ost'   => $orderStatus,
                    ':ast'   => $authStatus,
                    ':rst'   => $recvStatus,
                    ':uid'   => (int)$user['user_id'],
                    ':notes' => $reason,
                    ':id'    => $poId,
                ));
            } elseif ($action === 'reject') {
                if (!in_array($currentStatus, array('Pending Approval', 'Pending PO Approval'), true)) {
                    $this->conn->rollBack();
                    sendResponse(false, 'Only POs awaiting approval can be rejected.', null, 409);
                }
                $orderStatus = 'Cancelled';
                $authStatus = 'Rejected';
                $recvStatus = 'Cancelled';
                $this->releaseUnreceivedPrAllocations($poId, $prId, $user, 'Rejected PO-' . str_pad((string)$poId, 5, '0', STR_PAD_LEFT) . ': ' . $reason);
                $this->conn->prepare(
                    "UPDATE purchase_order
                     SET status = 'Cancelled',
                         order_status = :ost,
                         authorization_status = :ast,
                         receiving_status = :rst,
                         inspection_status = 'Not Applicable',
                         closed_reason = :reason,
                         manager_notes = :notes,
                         updated_at = NOW()
                     WHERE po_id = :id"
                )->execute(array(
                    ':ost'    => $orderStatus,
                    ':ast'    => $authStatus,
                    ':rst'    => $recvStatus,
                    ':reason' => $reason,
                    ':notes'  => $reason,
                    ':id'     => $poId,
                ));
            } elseif ($newStatus === 'Pending Approval') {
                if ($currentStatus !== 'Draft') {
                    $this->conn->rollBack();
                    sendResponse(false, 'Only Draft POs can be submitted for PO approval.', null, 409);
                }
                $orderStatus = 'Pending PO Approval';
                $authStatus = 'Pending Approval';
                $recvStatus = 'Not Ready';
                $this->conn->prepare(
                    "UPDATE purchase_order
                     SET status = 'Pending Approval',
                         order_status = :ost,
                         authorization_status = :ast,
                         receiving_status = :rst,
                         updated_at = NOW()
                     WHERE po_id = :id"
                )->execute(array(
                    ':ost' => $orderStatus,
                    ':ast' => $authStatus,
                    ':rst' => $recvStatus,
                    ':id'  => $poId
                ));
            } elseif ($newStatus === 'Ordered') {
                // Issuing a Draft or Resuming an On Hold PO
                if (!in_array($currentStatus, array('Draft', 'On Hold'), true)) {
                    $this->conn->rollBack();
                    sendResponse(false, 'Only Draft or On Hold POs can be issued/resumed.', null, 409);
                }
                $targetDbStatus = ($currentStatus === 'On Hold' && $totalReceived > 0) ? 'Partially Received' : 'Ordered';
                $orderStatus = ($targetDbStatus === 'Partially Received') ? 'Partially Received' : 'Issued';
                $authStatus = 'Authorized';
                $recvStatus = ($targetDbStatus === 'Partially Received') ? 'Partially Received' : 'Awaiting Delivery';
                $this->conn->prepare(
                    "UPDATE purchase_order
                     SET status = :st,
                         order_status = :ost,
                         authorization_status = :ast,
                         receiving_status = :rst,
                         confirmed_at = COALESCE(confirmed_at, NOW()),
                         updated_at = NOW()
                     WHERE po_id = :id"
                )->execute(array(
                    ':st'  => $targetDbStatus,
                    ':ost' => $orderStatus,
                    ':ast' => $authStatus,
                    ':rst' => $recvStatus,
                    ':id'  => $poId
                ));
                $newStatus = $targetDbStatus;
            } elseif ($newStatus === 'On Hold') {
                if (!in_array($currentStatus, array('Ordered', 'Issued', 'Partially Received'), true)) {
                    $this->conn->rollBack();
                    sendResponse(false, 'Only Issued/Ordered or Partially Received POs can be placed On Hold.', null, 409);
                }
                $orderStatus = 'On Hold';
                $authStatus = 'Authorized';
                $recvStatus = 'Not Ready';
                $this->conn->prepare(
                    "UPDATE purchase_order
                     SET status = 'On Hold',
                         order_status = :ost,
                         receiving_status = :rst,
                         notes = COALESCE(NULLIF(:notes, ''), notes),
                         updated_at = NOW()
                     WHERE po_id = :id"
                )->execute(array(
                    ':ost'   => $orderStatus,
                    ':rst'   => $recvStatus,
                    ':notes' => $reason,
                    ':id'    => $poId
                ));
            } elseif ($newStatus === 'Cancelled') {
                if (!in_array($currentStatus, array('Draft', 'Pending Approval', 'Pending PO Approval', 'Ordered', 'Issued', 'On Hold'), true)) {
                    $this->conn->rollBack();
                    sendResponse(false, 'Cannot cancel a PO that has already been received or closed.', null, 409);
                }
                if ($totalReceived > 0) {
                    $this->conn->rollBack();
                    sendResponse(false, 'Cannot cancel a PO with received deliveries. Use Close / Close Short instead.', null, 409);
                }

                $this->releaseUnreceivedPrAllocations($poId, $prId, $user, 'Cancelled PO-' . str_pad((string)$poId, 5, '0', STR_PAD_LEFT) . ($reason !== '' ? ': ' . $reason : ''));
                $orderStatus = 'Cancelled';
                $authStatus = (string)$po['authorization_status'];
                $recvStatus = 'Cancelled';
                $this->conn->prepare(
                    "UPDATE purchase_order
                     SET status = 'Cancelled',
                         order_status = :ost,
                         receiving_status = :rst,
                         inspection_status = 'Not Applicable',
                         closed_reason = :reason,
                         updated_at = NOW()
                     WHERE po_id = :id"
                )->execute(array(
                    ':ost'    => $orderStatus,
                    ':rst'    => $recvStatus,
                    ':reason' => $reason !== '' ? $reason : 'Cancelled by user',
                    ':id'     => $poId,
                ));
            } elseif ($newStatus === 'Closed Short') {
                if (!in_array($currentStatus, array('Ordered', 'Issued', 'Partially Received', 'Received', 'Fully Received'), true)) {
                    $this->conn->rollBack();
                    sendResponse(false, 'Only active or received POs can be closed.', null, 409);
                }
                if ($totalReceived < $totalOrdered) {
                    $this->releaseUnreceivedPrAllocations($poId, $prId, $user, 'Closed short PO-' . str_pad((string)$poId, 5, '0', STR_PAD_LEFT) . ': ' . $reason);
                }
                $orderStatus = 'Closed';
                $recvStatus = ($totalOrdered > 0 && $totalReceived >= $totalOrdered) ? 'Fully Received' : 'Closed Short';
                $this->conn->prepare(
                    "UPDATE purchase_order
                     SET status = 'Closed Short',
                         order_status = :ost,
                         receiving_status = :rst,
                         closed_reason = :reason,
                         updated_at = NOW()
                     WHERE po_id = :id"
                )->execute(array(
                    ':ost'    => $orderStatus,
                    ':rst'    => $recvStatus,
                    ':reason' => $reason,
                    ':id'     => $poId,
                ));
            }

            $this->conn->commit();
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            error_log('PO status update error: ' . $e->getMessage());
            sendResponse(false, 'Failed to update purchase order status.', null, 500);
        }

        $poCode = 'PO-' . str_pad((string)$poId, 5, '0', STR_PAD_LEFT);
        auditLog($this->conn, $user, 'STATUS_CHANGE', 'purchase_order', $poId, $poCode . ' status updated to ' . $newStatus . ($reason !== '' ? ' (' . $reason . ')' : ''));

        if ($newStatus === 'Ordered') {
            notifyRole(
                $this->conn,
                'Warehouse Staff',
                'po_confirmed',
                $poCode . ' Issued for Receiving',
                $poCode . ' is now issued and ready for warehouse receiving.',
                'stock_receiving',
                'purchase_order',
                $poId,
                'info',
                (int)$user['user_id']
            );
        }

        $updatedPo = $this->getFullPurchaseOrder($poId);
        sendResponse(true, $poCode . ' status updated to ' . $newStatus . '.', $updatedPo);
    }

    private function releaseUnreceivedPrAllocations($poId, $headerPrId, array $user, $comment) {
        $lines = $this->conn->prepare(
            "SELECT po_detail_id, pr_id, pr_detail_id, product_id, quantity_ordered, quantity_received
             FROM purchase_order_detail
             WHERE po_id = :id"
        );
        $lines->execute(array(':id' => (int)$poId));
        $poLines = $lines->fetchAll();

        $decByDetail = $this->conn->prepare(
            "UPDATE purchase_request_detail
             SET ordered_qty = GREATEST(0, ordered_qty - :unreceived)
             WHERE pr_detail_id = :did"
        );
        $decByPrProd = $this->conn->prepare(
            "UPDATE purchase_request_detail
             SET ordered_qty = GREATEST(0, ordered_qty - :unreceived)
             WHERE pr_id = :pr_id AND product_id = :pid"
        );

        $affectedPrs = array();
        if ($headerPrId > 0) {
            $affectedPrs[(int)$headerPrId] = true;
        }

        foreach ($poLines as $pl) {
            $unreceived = max(0, (int)$pl['quantity_ordered'] - (int)$pl['quantity_received']);
            if ($unreceived <= 0) {
                continue;
            }
            if (!empty($pl['pr_detail_id'])) {
                $decByDetail->execute(array(
                    ':unreceived' => $unreceived,
                    ':did'        => (int)$pl['pr_detail_id']
                ));
                if (!empty($pl['pr_id'])) {
                    $affectedPrs[(int)$pl['pr_id']] = true;
                }
            } elseif ($headerPrId > 0) {
                $decByPrProd->execute(array(
                    ':unreceived' => $unreceived,
                    ':pr_id'      => (int)$headerPrId,
                    ':pid'        => (int)$pl['product_id']
                ));
            }
        }

        foreach (array_keys($affectedPrs) as $tPrId) {
            $this->conn->prepare(
                "UPDATE purchase_request
                 SET status = CASE WHEN status IN ('Ordered', 'Partially Ordered') THEN 'Approved' ELSE status END,
                     fulfillment_status = CASE WHEN status IN ('Ordered', 'Partially Ordered') THEN 'Pending Fulfillment' ELSE fulfillment_status END,
                     updated_at = NOW()
                 WHERE pr_id = :id"
            )->execute(array(':id' => (int)$tPrId));

            $this->conn->prepare(
                "INSERT INTO purchase_request_history (pr_id, user_id, action, from_status, to_status, comment)
                 VALUES (:pr_id, :uid, 'PO_RELEASED', 'Ordered', 'Approved', :comment)"
            )->execute(array(
                ':pr_id'   => (int)$tPrId,
                ':uid'     => (int)$user['user_id'],
                ':comment' => $comment
            ));
        }
    }

    private function getAllPurchaseOrders($statusFilter = '') {
        $params = array();
        $where = '';
        if ($statusFilter !== '') {
            if ($statusFilter === 'Issued' || $statusFilter === 'Ordered') {
                $where = "WHERE po.status IN ('Ordered', 'Issued')";
            } elseif ($statusFilter === 'Pending PO Approval' || $statusFilter === 'Pending Approval') {
                $where = "WHERE po.status IN ('Pending Approval', 'Pending PO Approval')";
            } elseif ($statusFilter === 'Fully Received' || $statusFilter === 'Received') {
                $where = "WHERE po.status IN ('Received', 'Fully Received')";
            } elseif ($statusFilter === 'Closed' || $statusFilter === 'Closed Short') {
                $where = "WHERE po.status IN ('Closed', 'Closed Short')";
            } else {
                $where = 'WHERE po.status = :status';
                $params[':status'] = $statusFilter;
            }
        }

        $sql = "SELECT
                    po.po_id,
                    COALESCE(po.po_code, CONCAT('PO-', LPAD(po.po_id, 5, '0'))) AS po_code,
                    po.pr_id,
                    CASE WHEN po.pr_id IS NOT NULL THEN COALESCE(pr.pr_code, CONCAT('PR-', LPAD(po.pr_id, 4, '0'))) ELSE NULL END AS pr_code,
                    po.po_type,
                    po.po_source,
                    po.supplier_id,
                    s.supplier_name,
                    po.user_id,
                    CONCAT(u.first_name, ' ', u.last_name) AS created_by,
                    r_cre.role_name AS creator_role,
                    po.approved_by,
                    CASE WHEN ua.user_id IS NOT NULL THEN CONCAT(ua.first_name, ' ', ua.last_name) ELSE NULL END AS approved_by_name,
                    r_app.role_name AS approver_role,
                    po.approved_at,
                    po.manager_notes,
                    po.notes,
                    po.order_date,
                    po.expected_date,
                    po.status,
                    po.order_status,
                    po.receiving_status,
                    po.inspection_status,
                    po.authorization_status,
                    po.confirmed_at,
                    po.closed_reason,
                    po.created_at,
                    po.updated_at,
                    (SELECT COUNT(DISTINCT COALESCE(pod_pr.pr_id, po.pr_id)) FROM purchase_order_detail pod_pr WHERE pod_pr.po_id = po.po_id AND (pod_pr.pr_id IS NOT NULL OR po.pr_id IS NOT NULL)) AS linked_pr_count,
                    (SELECT COUNT(*) FROM purchase_order_detail pod WHERE pod.po_id = po.po_id) AS item_count,
                    COALESCE((SELECT SUM(pod.quantity_ordered) FROM purchase_order_detail pod WHERE pod.po_id = po.po_id), 0) AS total_qty_ordered,
                    COALESCE((SELECT SUM(pod.quantity_received) FROM purchase_order_detail pod WHERE pod.po_id = po.po_id), 0) AS total_qty_received,
                    COALESCE((SELECT SUM(pod.quantity_ordered * pod.unit_cost) FROM purchase_order_detail pod WHERE pod.po_id = po.po_id), 0) AS total_amount,
                    (SELECT COUNT(*) FROM stock_receiving sr WHERE sr.po_id = po.po_id) AS receiving_events,
                    COALESCE((
                        SELECT SUM(srd.quantity_damaged)
                        FROM stock_receiving_detail srd
                        INNER JOIN stock_receiving sr ON sr.receiving_id = srd.receiving_id
                        WHERE sr.po_id = po.po_id
                    ), 0) AS total_qty_damaged
                FROM purchase_order po
                INNER JOIN supplier s ON po.supplier_id = s.supplier_id
                INNER JOIN users u ON po.user_id = u.user_id
                LEFT JOIN role r_cre ON r_cre.role_id = u.role_id
                LEFT JOIN users ua ON po.approved_by = ua.user_id
                LEFT JOIN role r_app ON r_app.role_id = ua.role_id
                LEFT JOIN purchase_request pr ON pr.pr_id = po.pr_id
                $where
                ORDER BY po.po_id DESC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        foreach ($rows as &$row) {
            $row = $this->enrichPoRow($row);
        }
        unset($row);

        return $rows;
    }

    private function getPendingApprovalPurchaseOrders() {
        $rows = $this->getAllPurchaseOrders('Pending Approval');
        $detailStmt = $this->conn->prepare(
            "SELECT pod.po_detail_id, pod.product_id, p.product_name, p.unit_measure,
                    pod.quantity_ordered, pod.unit_cost,
                    (pod.quantity_ordered * pod.unit_cost) AS line_total
             FROM purchase_order_detail pod
             INNER JOIN product p ON pod.product_id = p.product_id
             WHERE pod.po_id = :po_id"
        );
        foreach ($rows as &$r) {
            $detailStmt->execute(array(':po_id' => (int)$r['po_id']));
            $r['items'] = $detailStmt->fetchAll();
        }
        unset($r);
        return $rows;
    }

    private function getReceivablePurchaseOrders() {
        $stmt = $this->conn->query(
            "SELECT
                po.po_id,
                COALESCE(po.po_code, CONCAT('PO-', LPAD(po.po_id, 5, '0'))) AS po_code,
                po.pr_id,
                CASE WHEN po.pr_id IS NOT NULL THEN COALESCE(pr.pr_code, CONCAT('PR-', LPAD(po.pr_id, 4, '0'))) ELSE NULL END AS pr_code,
                po.po_type,
                po.po_source,
                po.supplier_id,
                s.supplier_name,
                po.order_date,
                po.expected_date,
                po.status,
                po.order_status,
                po.receiving_status,
                po.inspection_status,
                po.authorization_status,
                COALESCE((SELECT SUM(pod.quantity_ordered) FROM purchase_order_detail pod WHERE pod.po_id = po.po_id), 0) AS total_qty_ordered,
                COALESCE((SELECT SUM(pod.quantity_received) FROM purchase_order_detail pod WHERE pod.po_id = po.po_id), 0) AS total_qty_received,
                COALESCE((SELECT SUM(GREATEST(0, pod.quantity_ordered - pod.quantity_received)) FROM purchase_order_detail pod WHERE pod.po_id = po.po_id), 0) AS remaining_qty,
                (SELECT COUNT(*) FROM stock_receiving sr WHERE sr.po_id = po.po_id) AS receiving_events,
                COALESCE((
                    SELECT SUM(srd.quantity_damaged)
                    FROM stock_receiving_detail srd
                    INNER JOIN stock_receiving sr ON sr.receiving_id = srd.receiving_id
                    WHERE sr.po_id = po.po_id
                ), 0) AS total_qty_damaged
             FROM purchase_order po
             INNER JOIN supplier s ON po.supplier_id = s.supplier_id
             LEFT JOIN purchase_request pr ON pr.pr_id = po.pr_id
             WHERE po.status IN ('Ordered', 'Issued', 'Partially Received')
               AND COALESCE(po.authorization_status, 'Authorized') = 'Authorized'
               AND COALESCE(po.order_status, 'Issued') IN ('Issued', 'Partially Received')
             HAVING remaining_qty > 0
             ORDER BY po.po_id DESC"
        );
        $rows = $stmt->fetchAll();
        foreach ($rows as &$row) {
            $row = $this->enrichPoRow($row);
        }
        unset($row);
        return $rows;
    }

    private function getFullPurchaseOrder($poId) {
        $stmt = $this->conn->prepare(
            "SELECT
                po.po_id,
                COALESCE(po.po_code, CONCAT('PO-', LPAD(po.po_id, 5, '0'))) AS po_code,
                po.pr_id,
                CASE WHEN po.pr_id IS NOT NULL THEN COALESCE(pr.pr_code, CONCAT('PR-', LPAD(po.pr_id, 4, '0'))) ELSE NULL END AS pr_code,
                po.po_type,
                po.po_source,
                po.supplier_id,
                s.supplier_name,
                s.contact_person AS supplier_contact,
                s.phone AS supplier_phone,
                s.email AS supplier_email,
                po.user_id,
                CONCAT(u.first_name, ' ', u.last_name) AS created_by,
                r_cre.role_name AS creator_role,
                po.approved_by,
                CASE WHEN ua.user_id IS NOT NULL THEN CONCAT(ua.first_name, ' ', ua.last_name) ELSE NULL END AS approved_by_name,
                r_app.role_name AS approver_role,
                po.approved_at,
                po.manager_notes,
                po.notes,
                po.order_date,
                po.expected_date,
                po.status,
                po.order_status,
                po.receiving_status,
                po.inspection_status,
                po.authorization_status,
                po.confirmed_at,
                po.closed_reason,
                po.created_at,
                po.updated_at,
                (SELECT COUNT(DISTINCT COALESCE(pod_pr.pr_id, po.pr_id)) FROM purchase_order_detail pod_pr WHERE pod_pr.po_id = po.po_id AND (pod_pr.pr_id IS NOT NULL OR po.pr_id IS NOT NULL)) AS linked_pr_count,
                COALESCE((SELECT SUM(pod.quantity_ordered) FROM purchase_order_detail pod WHERE pod.po_id = po.po_id), 0) AS total_qty_ordered,
                COALESCE((SELECT SUM(pod.quantity_received) FROM purchase_order_detail pod WHERE pod.po_id = po.po_id), 0) AS total_qty_received,
                COALESCE((SELECT SUM(pod.quantity_ordered * pod.unit_cost) FROM purchase_order_detail pod WHERE pod.po_id = po.po_id), 0) AS total_amount,
                (SELECT COUNT(*) FROM stock_receiving sr WHERE sr.po_id = po.po_id) AS receiving_events,
                COALESCE((
                    SELECT SUM(srd.quantity_damaged)
                    FROM stock_receiving_detail srd
                    INNER JOIN stock_receiving sr ON sr.receiving_id = srd.receiving_id
                    WHERE sr.po_id = po.po_id
                ), 0) AS total_qty_damaged
             FROM purchase_order po
             INNER JOIN supplier s ON po.supplier_id = s.supplier_id
             INNER JOIN users u ON po.user_id = u.user_id
             LEFT JOIN role r_cre ON r_cre.role_id = u.role_id
             LEFT JOIN users ua ON po.approved_by = ua.user_id
             LEFT JOIN role r_app ON r_app.role_id = ua.role_id
             LEFT JOIN purchase_request pr ON pr.pr_id = po.pr_id
             WHERE po.po_id = :id
             LIMIT 1"
        );
        $stmt->execute(array(':id' => $poId));
        $po = $stmt->fetch();
        if (!$po) {
            return null;
        }
        $po = $this->enrichPoRow($po);

        $detailStmt = $this->conn->prepare(
            "SELECT
                pod.po_detail_id,
                pod.pr_id,
                CASE WHEN COALESCE(pod.pr_id, po.pr_id) IS NOT NULL THEN CONCAT('PR-', LPAD(COALESCE(pod.pr_id, po.pr_id), 4, '0')) ELSE NULL END AS pr_code,
                pod.pr_detail_id,
                pod.product_id,
                p.product_name,
                p.unit_measure,
                pod.quantity_ordered,
                pod.quantity_received,
                GREATEST(0, pod.quantity_ordered - pod.quantity_received) AS remaining_qty,
                GREATEST(0, pod.quantity_ordered - pod.quantity_received) AS outstanding_qty,
                pod.unit_cost,
                (pod.quantity_ordered * pod.unit_cost) AS line_total
             FROM purchase_order_detail pod
             INNER JOIN purchase_order po ON po.po_id = pod.po_id
             INNER JOIN product p ON pod.product_id = p.product_id
             WHERE pod.po_id = :id
             ORDER BY pod.po_detail_id ASC"
        );
        $detailStmt->execute(array(':id' => $poId));
        $po['items'] = $detailStmt->fetchAll();

        $rcvStmt = $this->conn->prepare(
            "SELECT
                sr.receiving_id,
                CONCAT('RCV-', LPAD(sr.receiving_id, 4, '0')) AS receiving_code,
                sr.receiving_date,
                sr.dr_number,
                sr.remarks,
                CONCAT(u.first_name, ' ', u.last_name) AS received_by,
                r_rcv.role_name AS receiver_role,
                sr.created_at,
                COALESCE((SELECT SUM(srd.quantity_received) FROM stock_receiving_detail srd WHERE srd.receiving_id = sr.receiving_id), 0) AS total_accepted,
                COALESCE((SELECT SUM(srd.quantity_damaged) FROM stock_receiving_detail srd WHERE srd.receiving_id = sr.receiving_id), 0) AS total_damaged
             FROM stock_receiving sr
             INNER JOIN users u ON sr.user_id = u.user_id
             LEFT JOIN role r_rcv ON r_rcv.role_id = u.role_id
             WHERE sr.po_id = :id
             ORDER BY sr.receiving_id DESC"
        );
        $rcvStmt->execute(array(':id' => $poId));
        $po['receiving_history'] = $rcvStmt->fetchAll();

        return $po;
    }

    private function activeSupplier($id) {
        $s = $this->conn->prepare("SELECT supplier_id FROM supplier WHERE supplier_id = :id AND is_active = 1 LIMIT 1");
        $s->execute(array(':id' => $id));
        return (bool)$s->fetch();
    }
}

$conn = getConnection();
$method = $_SERVER['REQUEST_METHOD'];

$api = new PurchaseOrderApi($conn);
$api->handleRequest($method);
