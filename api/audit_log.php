<?php
require_once '../config/db.php';
sendJsonHeaders();

class AuditAndMovementsApi {
    private PDO $conn;

    public function __construct(PDO $conn) {
        $this->conn = $conn;
    }

    public function handleRequest($method) {
        if ($method !== 'GET') {
            sendResponse(false, 'Request failed.', null, 405);
        }
        $mode = isset($_GET['mode']) ? (string)$_GET['mode'] : 'audit';
        if ($mode === 'movements') {
            requirePermission(array('stock_movement', 'product', 'stock_receiving', 'stock_releasing', 'adjustment', 'inventory_report'), 'view');
            $movements = $this->getStockMovements();
            $summary = $this->getMovementSummary();
            sendResponse(true, 'Stock movements retrieved', array(
                'summary' => $summary,
                'movements' => $movements
            ));
        }
        requirePermission('audit_log', 'view');
        sendResponse(true, 'Audit log retrieved', $this->getAuditLogs());
    }

    private function getAuditLogs() {
        $module = isset($_GET['module']) ? trim((string)$_GET['module']) : '';
        $limit = isset($_GET['limit']) ? max(1, min(1000, (int)$_GET['limit'])) : 500;
        $whereSql = '';
        $params = array();

        if ($module !== '') {
            $whereSql = 'WHERE a.module = :mod';
            $params[':mod'] = $module;
        }

        $stmt = $this->conn->prepare(
            "SELECT a.audit_id, a.user_id,
                    CASE WHEN u.user_id IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE 'System / Unauthenticated' END AS actor_name,
                    u.username, r.role_name,
                    a.action, a.module, a.record_id,
                    a.description,
                    a.description AS details,
                    a.ip_address, a.created_at
             FROM audit_log a
             LEFT JOIN users u ON u.user_id = a.user_id
             LEFT JOIN role r ON r.role_id = u.role_id
             $whereSql
             ORDER BY a.audit_id DESC
             LIMIT :lim"
        );
        foreach ($params as $k => $v) {
            $stmt->bindValue($k, $v);
        }
        $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    private function getStockMovements() {
        $limit = isset($_GET['limit']) ? max(1, min(5000, (int)$_GET['limit'])) : 1000;
        $filterPid = isset($_GET['product_id']) ? validatePositiveInt($_GET['product_id']) : 0;
        $whereSql = $filterPid > 0 ? 'WHERE m.product_id = :pid' : '';

        $sql = "SELECT m.*,
                       m.ref_no AS ref_code,
                       CASE
                           WHEN m.direction = 'OUT' THEN -m.quantity
                           WHEN m.direction = 'IN' THEN m.quantity
                           ELSE 0
                       END AS qty_change
                FROM (
                    SELECT
                        COALESCE(r.grn_number, CONCAT('GRN-', LPAD(r.receiving_id, 5, '0')), CONCAT('RCV-', LPAD(r.receiving_id, 4, '0'))) AS ref_no,
                        'Stock Receiving' AS movement_type,
                        'IN' AS direction,
                        d.product_id,
                        p.product_name,
                        p.unit_measure,
                        COALESCE(d.quantity_accepted, d.quantity_received) AS quantity,
                        CASE WHEN u.user_id IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE 'Warehouse Officer' END AS performed_by,
                        s.supplier_name AS party,
                        COALESCE(NULLIF(TRIM(r.remarks), ''), NULLIF(TRIM(r.inspection_notes), ''), CONCAT('Received via PO #', po.po_code), '—') AS notes,
                        COALESCE(r.inspection_date, r.receiving_date) AS movement_date,
                        COALESCE(r.posted_at, r.created_at, CONCAT(r.receiving_date, ' 12:00:00')) AS sort_ts
                    FROM stock_receiving_detail d
                    INNER JOIN stock_receiving r ON r.receiving_id = d.receiving_id
                    INNER JOIN purchase_order po ON po.po_id = r.po_id
                    LEFT JOIN supplier s ON s.supplier_id = po.supplier_id
                    INNER JOIN product p ON p.product_id = d.product_id
                    LEFT JOIN users u ON u.user_id = COALESCE(r.posted_by, r.inspected_by, r.user_id)
                    WHERE COALESCE(d.quantity_accepted, d.quantity_received) > 0
                      AND po.status NOT IN ('Cancelled', 'Rejected')
                      AND COALESCE(r.status, 'Posted') IN ('Posted', 'Inspected')

                    UNION ALL

                    SELECT
                        CONCAT('REL-', LPAD(rel.releasing_id, 4, '0')) AS ref_no,
                        'Stock Releasing' AS movement_type,
                        'OUT' AS direction,
                        d.product_id,
                        p.product_name,
                        p.unit_measure,
                        d.quantity_released AS quantity,
                        CASE WHEN u.user_id IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE 'Warehouse Officer' END AS performed_by,
                        COALESCE(NULLIF(TRIM(rel.destination_store), ''), rel.requested_by, '—') AS party,
                        COALESCE(NULLIF(TRIM(rel.destination_store), ''), rel.requested_by, 'Store Delivery') AS notes,
                        rel.releasing_date AS movement_date,
                        CONCAT(rel.releasing_date, ' 12:00:00') AS sort_ts
                    FROM stock_releasing_detail d
                    INNER JOIN stock_releasing rel ON rel.releasing_id = d.releasing_id
                    INNER JOIN product p ON p.product_id = d.product_id
                    LEFT JOIN users u ON u.user_id = rel.user_id

                    UNION ALL

                    SELECT
                        CONCAT('SRT-', LPAD(sr.stocks_return_id, 4, '0')) AS ref_no,
                        CASE
                            WHEN COALESCE(d.condition_status, 'Usable') = 'Usable' THEN 'Stocks Return'
                            ELSE CONCAT('Stocks Return (', d.condition_status, ')')
                        END AS movement_type,
                        CASE
                            WHEN COALESCE(d.condition_status, 'Usable') = 'Usable' THEN 'IN'
                            ELSE 'QUARANTINED'
                        END AS direction,
                        d.product_id,
                        p.product_name,
                        p.unit_measure,
                        d.quantity_returned AS quantity,
                        CASE WHEN u.user_id IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE 'Warehouse Officer' END AS performed_by,
                        sr.requested_by AS party,
                        COALESCE(NULLIF(TRIM(sr.reason), ''), 'Store return to warehouse') AS notes,
                        sr.return_date AS movement_date,
                        CONCAT(sr.return_date, ' 12:00:00') AS sort_ts
                    FROM stocks_return_detail d
                    INNER JOIN stocks_return sr ON sr.stocks_return_id = d.stocks_return_id
                    INNER JOIN product p ON p.product_id = d.product_id
                    LEFT JOIN users u ON u.user_id = sr.user_id

                    UNION ALL

                    SELECT
                        CONCAT('PRT-', LPAD(pr.purchase_return_id, 4, '0')) AS ref_no,
                        'Purchase Return' AS movement_type,
                        'OUT' AS direction,
                        d.product_id,
                        p.product_name,
                        p.unit_measure,
                        d.quantity_returned AS quantity,
                        CASE WHEN u.user_id IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE 'Warehouse Officer' END AS performed_by,
                        COALESCE(s.supplier_name, '—') AS party,
                        COALESCE(NULLIF(TRIM(pr.reason), ''), CONCAT('Return to supplier ', COALESCE(s.supplier_name, '')), '—') AS notes,
                        pr.return_date AS movement_date,
                        CONCAT(pr.return_date, ' 12:00:00') AS sort_ts
                    FROM purchase_return_detail d
                    INNER JOIN purchase_return pr ON pr.purchase_return_id = d.purchase_return_id
                    LEFT JOIN supplier s ON s.supplier_id = pr.supplier_id
                    INNER JOIN product p ON p.product_id = d.product_id
                    LEFT JOIN users u ON u.user_id = pr.user_id

                    UNION ALL

                    SELECT
                        CONCAT('ADJ-', LPAD(ad.adjustment_detail_id, 4, '0')) AS ref_no,
                        CONCAT('Adjustment (', ad.adjustment_type, ')') AS movement_type,
                        CASE WHEN ad.adjustment_type = 'Addition' THEN 'IN' ELSE 'OUT' END AS direction,
                        ad.product_id,
                        p.product_name,
                        p.unit_measure,
                        ad.quantity AS quantity,
                        CASE WHEN u.user_id IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE 'Warehouse Officer' END AS performed_by,
                        COALESCE(NULLIF(TRIM(ad.reason), ''), ad.adjustment_type) AS party,
                        COALESCE(NULLIF(TRIM(ad.reason), ''), ad.adjustment_type) AS notes,
                        COALESCE(ad.adjustment_date, DATE(ad.created_at)) AS movement_date,
                        ad.created_at AS sort_ts
                    FROM adjustment_detail ad
                    INNER JOIN product p ON p.product_id = ad.product_id
                    LEFT JOIN users u ON u.user_id = ad.user_id
                ) m
                $whereSql
                ORDER BY m.sort_ts DESC, m.ref_no DESC
                LIMIT :lim";

        $stmt = $this->conn->prepare($sql);
        if ($filterPid > 0) {
            $stmt->bindValue(':pid', $filterPid, PDO::PARAM_INT);
        }
        $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function getMovementSummary() {
        // 1. Stock Received
        $stmtRcv = $this->conn->query("
            SELECT COALESCE(SUM(COALESCE(d.quantity_accepted, d.quantity_received)), 0) AS total_qty,
                   COUNT(DISTINCT r.receiving_id) AS total_count
            FROM stock_receiving_detail d
            INNER JOIN stock_receiving r ON r.receiving_id = d.receiving_id
            INNER JOIN purchase_order po ON po.po_id = r.po_id
            WHERE COALESCE(d.quantity_accepted, d.quantity_received) > 0
              AND po.status NOT IN ('Cancelled', 'Rejected')
              AND COALESCE(r.status, 'Posted') IN ('Posted', 'Inspected')
        ");
        $rcvData = $stmtRcv->fetch();

        // 2. Stock Released
        $stmtRel = $this->conn->query("
            SELECT COALESCE(SUM(d.quantity_released), 0) AS total_qty,
                   COUNT(DISTINCT rel.releasing_id) AS total_count
            FROM stock_releasing_detail d
            INNER JOIN stock_releasing rel ON rel.releasing_id = d.releasing_id
        ");
        $relData = $stmtRel->fetch();

        // 3. Store Returns
        $stmtSrt = $this->conn->query("
            SELECT COALESCE(SUM(d.quantity_returned), 0) AS total_qty,
                   COUNT(DISTINCT sr.stocks_return_id) AS total_count
            FROM stocks_return_detail d
            INNER JOIN stocks_return sr ON sr.stocks_return_id = d.stocks_return_id
        ");
        $srtData = $stmtSrt->fetch();

        // 4. Purchase Returns
        $stmtPrt = $this->conn->query("
            SELECT COALESCE(SUM(d.quantity_returned), 0) AS total_qty,
                   COUNT(DISTINCT pr.purchase_return_id) AS total_count
            FROM purchase_return_detail d
            INNER JOIN purchase_return pr ON pr.purchase_return_id = d.purchase_return_id
        ");
        $prtData = $stmtPrt->fetch();

        // 5. Adjustments
        $stmtAdj = $this->conn->query("
            SELECT COUNT(*) AS total_count,
                   COALESCE(SUM(quantity), 0) AS total_qty
            FROM adjustment_detail
        ");
        $adjData = $stmtAdj->fetch();

        // 6. Total Movements count
        $stmtTotal = $this->conn->query("
            SELECT (
                (SELECT COUNT(*) FROM stock_receiving_detail d INNER JOIN stock_receiving r ON r.receiving_id = d.receiving_id INNER JOIN purchase_order po ON po.po_id = r.po_id WHERE COALESCE(d.quantity_accepted, d.quantity_received) > 0 AND po.status NOT IN ('Cancelled', 'Rejected') AND COALESCE(r.status, 'Posted') IN ('Posted', 'Inspected'))
                + (SELECT COUNT(*) FROM stock_releasing_detail)
                + (SELECT COUNT(*) FROM stocks_return_detail)
                + (SELECT COUNT(*) FROM purchase_return_detail)
                + (SELECT COUNT(*) FROM adjustment_detail)
            ) AS total_movements
        ");
        $totalMovements = (int)($stmtTotal->fetchColumn() ?? 0);

        return array(
            'total_movements' => $totalMovements,
            'stock_received' => (int)($rcvData['total_qty'] ?? 0),
            'stock_released' => (int)($relData['total_qty'] ?? 0),
            'store_returns' => (int)($srtData['total_qty'] ?? 0),
            'purchase_returns' => (int)($prtData['total_qty'] ?? 0),
            'adjustments_count' => (int)($adjData['total_count'] ?? 0)
        );
    }
}

$conn = getConnection();
$method = $_SERVER['REQUEST_METHOD'];

$api = new AuditAndMovementsApi($conn);
$api->handleRequest($method);
