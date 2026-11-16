<?php
require_once '../config/db.php';
sendJsonHeaders();

class DashboardApi {
    private PDO $conn;

    public function __construct(PDO $conn) {
        $this->conn = $conn;
    }

    public function handleRequest($method) {
        if ($method !== 'GET') {
            sendResponse(false, 'Request failed.', null, 405);
        }
        $user = requirePermission('dashboard', 'view');
        $profile = roleDashboardProfile($user);

        // Allow profile override if user has appropriate permission (e.g. purchasing page requesting purchasing data)
        $requestedProfile = isset($_GET['profile']) ? trim((string)$_GET['profile']) : (isset($_GET['context']) ? trim((string)$_GET['context']) : '');
        $roleId = isset($user['role_id']) ? (int)$user['role_id'] : 0;
        if ($requestedProfile === 'purchasing' && ($roleId === 1 || userCan($roleId, 'purchase_order', 'view') || userCan($roleId, 'dashboard', 'view'))) {
            $profile = 'purchasing';
        }

        $products = allProductsWithMetrics($this->conn, true);

        // Check for manager sub-modes (for interactive modals)
        $mode = isset($_GET['mode']) ? trim((string)$_GET['mode']) : '';
        if ($mode === 'manager_pr_list') {
            $this->handleManagerPrList();
            return;
        }
        if ($mode === 'manager_po_list') {
            $this->handleManagerPoList();
            return;
        }
        if ($mode === 'manager_stock_comparison') {
            $this->handleManagerStockComparison($products);
            return;
        }

        $lowList = array();
        $criticalCount = 0;
        $lowCount = 0;
        $sufficientList = array();
        $replenishCandidates = array();

        foreach ($products as $p) {
            if (!empty($p['is_critical_stock'])) {
                $criticalCount++;
                $lowList[] = $p;
            } elseif (!empty($p['is_low_stock'])) {
                $lowCount++;
                $lowList[] = $p;
            } else {
                $sufficientList[] = $p;
            }
            if ($p['available_stock'] <= $p['reorder_threshold'] || $p['outstanding_replenishment'] > 0) {
                $replenishCandidates[] = $p;
            }
        }

        // Sort lowList by available_stock ascending
        usort($lowList, function ($a, $b) {
            return (int)$a['available_stock'] - (int)$b['available_stock'];
        });

        $notifs = $this->getRecentNotifications((int)$user['user_id'], 8);
        $unreadStmt = $this->conn->prepare("SELECT COUNT(*) FROM notification WHERE user_id = :uid AND is_read = 0");
        $unreadStmt->execute(array(':uid' => (int)$user['user_id']));
        $unreadCount = (int)$unreadStmt->fetchColumn();

        switch ($profile) {
            case 'admin':
                $payload = $this->buildAdminDashboard($products, $lowList, $lowCount, $criticalCount, $notifs);
                break;
            case 'manager':
                $payload = $this->buildManagerDashboard($products, $sufficientList, $notifs);
                break;
            case 'purchasing':
                $payload = $this->buildPurchasingDashboard($products, $notifs);
                break;
            case 'warehouse':
                $payload = $this->buildWarehouseDashboard($lowList, $lowCount, $criticalCount, $notifs);
                break;
            case 'requester':
            default:
                $payload = $this->buildRequesterDashboard((int)$user['user_id'], $products, $replenishCandidates, $notifs);
                break;
        }

        if (!isset($payload['kpis']) || !is_array($payload['kpis'])) {
            $payload['kpis'] = array();
        }
        $payload['kpis']['unread_notifications'] = $unreadCount;
        $payload['profile'] = $profile;
        $payload['role_name'] = $user['role_name'];
        sendResponse(true, 'Dashboard data retrieved', $payload);
    }

    private function buildAdminDashboard(array $products, array $lowList, $lowCount, $criticalCount, array $notifs) {
        $prCounts = $this->getRequestStatusCounts();
        $poCounts = $this->getPoStatusCounts();

        $outOfStockCount = 0;
        $lowStockCount = 0;
        $inStockCount = 0;
        foreach ($products as $p) {
            if ((int)$p['available_stock'] <= 0) {
                $outOfStockCount++;
            } elseif ((int)$p['available_stock'] <= (int)$p['reorder_threshold']) {
                $lowStockCount++;
            } else {
                $inStockCount++;
            }
        }

        $pendingPosCount = (int)$this->conn->query(
            "SELECT COUNT(*) FROM purchase_order WHERE status IN ('Pending', 'Pending Approval', 'Draft', 'Ordered', 'Partially Received')"
        )->fetchColumn();

        $pendingDeliveriesCount = (int)$this->conn->query(
            "SELECT COUNT(*) FROM purchase_order WHERE status IN ('Ordered', 'Partially Received')"
        )->fetchColumn();

        $storeRequestsCount = (int)$this->conn->query(
            "SELECT COUNT(*) FROM purchase_request WHERE status IN ('Pending', 'Pending Approval', 'For Revision', 'Approved')"
        )->fetchColumn();

        $approvedReadyForPo = (int)$this->conn->query(
            "SELECT COUNT(*) FROM (
                SELECT pr.pr_id,
                       SUM(GREATEST(0, COALESCE(d.approved_qty, d.requested_qty) - d.ordered_qty)) AS rem
                FROM purchase_request pr
                INNER JOIN purchase_request_detail d ON d.pr_id = pr.pr_id
                WHERE pr.status = 'Approved'
                GROUP BY pr.pr_id
                HAVING rem > 0
             ) t"
        )->fetchColumn();

        $posAwaitingAction = $poCounts['Draft'] + $approvedReadyForPo;
        $deliveriesToReceive = $pendingDeliveriesCount;
        $totalOpenRequests = $storeRequestsCount;

        $recentTx = $this->conn->query(
            "SELECT * FROM (
                SELECT CONCAT('PR-', LPAD(pr.pr_id, 4, '0')) AS ref_no,
                       CONCAT('PR-', LPAD(pr.pr_id, 4, '0')) AS ref_code,
                       'Purchase Request' AS tx_type,
                       'purchase_request' AS link_tab,
                       pr.pr_id AS record_id,
                       pr.pr_id AS ref_id,
                       CONCAT(u.first_name, ' ', u.last_name) AS actor_name,
                       CONCAT(u.first_name, ' ', u.last_name) AS actor,
                       pr.status AS status,
                       DATE(pr.submitted_at) AS tx_date,
                       pr.submitted_at AS sort_ts
                FROM purchase_request pr
                INNER JOIN users u ON u.user_id = pr.requester_id

                UNION ALL

                SELECT CONCAT('PO-', LPAD(po.po_id, 4, '0')) AS ref_no,
                       CONCAT('PO-', LPAD(po.po_id, 4, '0')) AS ref_code,
                       'Purchase Order' AS tx_type,
                       'purchase_order' AS link_tab,
                       po.po_id AS record_id,
                       po.po_id AS ref_id,
                       CONCAT(u.first_name, ' ', u.last_name) AS actor_name,
                       CONCAT(u.first_name, ' ', u.last_name) AS actor,
                       po.status AS status,
                       po.order_date AS tx_date,
                       COALESCE(po.created_at, CONCAT(po.order_date, ' 12:00:00')) AS sort_ts
                FROM purchase_order po
                INNER JOIN users u ON u.user_id = po.user_id

                UNION ALL

                SELECT CONCAT('RCV-', LPAD(r.receiving_id, 4, '0')) AS ref_no,
                       CONCAT('RCV-', LPAD(r.receiving_id, 4, '0')) AS ref_code,
                       'Stock Receiving' AS tx_type,
                       'stock_receiving' AS link_tab,
                       r.receiving_id AS record_id,
                       r.receiving_id AS ref_id,
                       CONCAT(u.first_name, ' ', u.last_name) AS actor_name,
                       CONCAT(u.first_name, ' ', u.last_name) AS actor,
                       'Received' AS status,
                       r.receiving_date AS tx_date,
                       COALESCE(r.created_at, CONCAT(r.receiving_date, ' 12:00:00')) AS sort_ts
                FROM stock_receiving r
                INNER JOIN users u ON u.user_id = r.user_id

                UNION ALL

                SELECT CONCAT('REL-', LPAD(rel.releasing_id, 4, '0')) AS ref_no,
                       CONCAT('REL-', LPAD(rel.releasing_id, 4, '0')) AS ref_code,
                       'Stock Releasing' AS tx_type,
                       'stock_releasing' AS link_tab,
                       rel.releasing_id AS record_id,
                       rel.releasing_id AS ref_id,
                       CONCAT(u.first_name, ' ', u.last_name) AS actor_name,
                       CONCAT(u.first_name, ' ', u.last_name) AS actor,
                       'Completed' AS status,
                       rel.releasing_date AS tx_date,
                       CONCAT(rel.releasing_date, ' 12:00:00') AS sort_ts
                FROM stock_releasing rel
                INNER JOIN users u ON u.user_id = rel.user_id
             ) tx
             ORDER BY tx.sort_ts DESC
             LIMIT 30"
        )->fetchAll();

        $alertsSlice = array_slice($lowList, 0, 8);

        return array(
            'kpis' => array(
                'low_stock_count' => $lowStockCount,
                'out_of_stock_count' => $outOfStockCount,
                'in_stock_count' => $inStockCount,
                'items_to_reorder' => count($lowList),
                'reorder_items_count' => count($lowList),
                'pending_pos' => $pendingPosCount,
                'pending_deliveries' => $pendingDeliveriesCount,
                'store_requests' => $storeRequestsCount,
                'recent_transactions_count' => count($recentTx),
                // Compatibility aliases
                'total_products' => count($products),
                'pending_requests' => $storeRequestsCount,
                'awaiting_approval' => $prCounts['Pending'],
                'awaiting_manager_approval' => $prCounts['Pending'],
                'pos_awaiting_action' => $pendingPosCount,
                'deliveries_to_receive' => $pendingDeliveriesCount,
                'deliveries_awaiting_receiving' => $pendingDeliveriesCount,
                'critical_stock_count' => $outOfStockCount
            ),
            'pipeline' => array(
                'submitted' => $prCounts['Pending'] + $prCounts['For Revision'],
                'for_revision' => $prCounts['For Revision'],
                'approved' => $prCounts['Approved'],
                'po_issued' => $poCounts['Ordered'] + $poCounts['Draft'],
                'po_ordered' => $poCounts['Ordered'],
                'po_draft' => $poCounts['Draft'],
                'partially_received' => $poCounts['Partially Received'],
                'po_partial' => $poCounts['Partially Received'],
                'completed' => $poCounts['Received'],
                'po_received' => $poCounts['Received']
            ),
            'recent_transactions' => $recentTx,
            'all_recent_transactions' => $recentTx,
            'recent_activity' => $this->getPurchasingRecentActivity(),
            'stock_alerts' => $alertsSlice,
            'all_stock_alerts' => $lowList,
            'low_stock_products' => $alertsSlice,
            'items_to_reorder' => $lowList,
            'reorder_candidates' => $lowList,
            'notifications' => $notifs
        );
    }

    private function buildManagerDashboard(array $products, array $sufficientList, array $notifs) {
        $prCounts = $this->getRequestStatusCounts();
        $poCounts = $this->getPoStatusCounts();

        $queue = $this->conn->query(
            "SELECT pr.pr_id,
                    COALESCE(pr.pr_code, CONCAT('PR-', LPAD(pr.pr_id, 4, '0'))) AS pr_code,
                    pr.requester_id,
                    COALESCE(pr.store_name, 'Main Store') AS store_name,
                    COALESCE(NULLIF(TRIM(pr.purpose), ''), NULLIF(TRIM(pr.reason), ''), 'Store Inventory Replenishment') AS purpose,
                    COALESCE(NULLIF(TRIM(pr.urgency), ''), 'Normal') AS urgency,
                    CASE WHEN u.user_id IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE 'Unknown Requester' END AS requested_by,
                    CASE WHEN u.user_id IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE 'Unknown Requester' END AS requested_by_name,
                    u.username AS requester_username,
                    r.role_name AS requester_role,
                    r.role_name AS role_name,
                    r.role_id AS requester_role_id,
                    pr.status,
                    'Pending Approval' AS approval_status,
                    'Awaiting Approval' AS fulfillment_status,
                    pr.reason,
                    COALESCE(NULLIF(TRIM(pr.remarks), ''), pr.reason) AS remarks,
                    pr.submitted_at,
                    DATE(pr.submitted_at) AS request_date,
                    (SELECT COUNT(*) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id) AS item_count,
                    COALESCE((SELECT SUM(d.requested_qty) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id), 0) AS total_requested_qty
             FROM purchase_request pr
             LEFT JOIN users u ON u.user_id = pr.requester_id
             LEFT JOIN role r ON r.role_id = u.role_id
             WHERE pr.status = 'Pending'
             ORDER BY pr.submitted_at DESC, pr.pr_id DESC
             LIMIT 15"
        )->fetchAll();

        // Get product comparison data (pending first, then popular requested products)
        $comparison = $this->conn->query(
            "SELECT MIN(pr.pr_id) AS pr_id, p.product_id, p.product_name, p.unit_measure, p.reorder_level, p.max_stock,
                    SUM(d.requested_qty) AS requested_qty
             FROM purchase_request_detail d
             INNER JOIN purchase_request pr ON pr.pr_id = d.pr_id
             INNER JOIN product p ON p.product_id = d.product_id
             WHERE pr.status = 'Pending'
             GROUP BY p.product_id, p.product_name, p.unit_measure, p.reorder_level, p.max_stock
             ORDER BY requested_qty DESC
             LIMIT 10"
        )->fetchAll();

        if (count($comparison) < 5) {
            $existingPids = array_map(function ($c) { return (int)$c['product_id']; }, $comparison);
            $excludeClause = !empty($existingPids) ? "WHERE p.product_id NOT IN (" . implode(',', $existingPids) . ")" : "";
            $extra = $this->conn->query(
                "SELECT 0 AS pr_id, p.product_id, p.product_name, p.unit_measure, p.reorder_level, p.max_stock,
                        COALESCE((SELECT SUM(d.requested_qty) FROM purchase_request_detail d WHERE d.product_id = p.product_id), 0) AS requested_qty
                 FROM product p
                 $excludeClause
                 ORDER BY requested_qty DESC, p.product_id ASC
                 LIMIT " . (10 - count($comparison))
            )->fetchAll();
            $comparison = array_merge($comparison, $extra);
        }

        $prodMap = array();
        foreach ($products as $p) {
            $prodMap[(int)$p['product_id']] = $p;
        }
        foreach ($comparison as &$c) {
            $pid = (int)$c['product_id'];
            $m = isset($prodMap[$pid]) ? $prodMap[$pid] : null;
            $c['available_stock'] = $m ? (int)$m['available_stock'] : 0;
            $c['max_stock'] = $m && (int)$m['max_stock'] > 0 ? (int)$m['max_stock'] : ((int)$c['max_stock'] > 0 ? (int)$c['max_stock'] : 100);
            $c['reorder_threshold'] = $m ? (int)$m['reorder_threshold'] : effectiveReorderThreshold($c['reorder_level']);
            $c['sufficient_stock'] = $c['available_stock'] > $c['reorder_threshold'];
            if ($c['available_stock'] <= 0 || ($m && !empty($m['is_critical_stock']))) {
                $c['stock_status'] = 'Critical';
            } elseif ($c['available_stock'] <= $c['reorder_threshold'] || ($m && !empty($m['is_low_stock']))) {
                $c['stock_status'] = 'Low';
            } else {
                $c['stock_status'] = 'Sufficient';
            }
        }
        unset($c);

        $approvedInProgress = $this->conn->query(
            "SELECT pr.pr_id,
                    CONCAT('PR-', LPAD(pr.pr_id, 4, '0')) AS pr_code,
                    CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name,
                    pr.status,
                    COALESCE((SELECT SUM(COALESCE(d.approved_qty, d.requested_qty)) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id), 0) AS total_approved_qty,
                    (SELECT COUNT(*) FROM purchase_order po WHERE po.pr_id = pr.pr_id AND po.status != 'Cancelled') AS po_count
             FROM purchase_request pr
             INNER JOIN users u ON u.user_id = pr.requester_id
             WHERE pr.status IN ('Approved', 'Ordered', 'Partially Received')
             ORDER BY pr.updated_at DESC
             LIMIT 6"
        )->fetchAll();

        $recentApprovals = $this->conn->query(
            "SELECT h.history_id, h.pr_id,
                    CONCAT('PR-', LPAD(h.pr_id, 4, '0')) AS pr_code,
                    h.action, h.to_status, h.to_status AS new_status,
                    h.comment, h.comment AS comments, h.created_at,
                    CASE WHEN u.user_id IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE 'Manager' END AS actor_name
             FROM purchase_request_history h
             LEFT JOIN users u ON u.user_id = h.user_id
             WHERE h.action IN ('APPROVED', 'REJECTED', 'RETURNED_FOR_REVISION')
             ORDER BY h.history_id DESC
             LIMIT 8"
        )->fetchAll();

        $approvedTotal = $prCounts['Approved'] + $prCounts['Ordered'] + $prCounts['Partially Received'] + $prCounts['Completed'];
        $suffSlice = array_slice($sufficientList, 0, 6);

        $posPendingApproval = (int)$this->conn->query("SELECT COUNT(*) FROM purchase_order WHERE status = 'Pending Approval'")->fetchColumn();
        $poApprovalQueue = $this->conn->query(
            "SELECT po.po_id,
                    CONCAT('PO-', LPAD(po.po_id, 4, '0')) AS po_code,
                    s.supplier_name,
                    CONCAT(u.first_name, ' ', u.last_name) AS ordered_by,
                    po.order_date, po.expected_date, po.status, po.manager_notes,
                    (SELECT COUNT(*) FROM purchase_order_detail d WHERE d.po_id = po.po_id) AS item_count,
                    COALESCE((SELECT SUM(d.quantity_ordered) FROM purchase_order_detail d WHERE d.po_id = po.po_id), 0) AS total_ordered_qty,
                    COALESCE((SELECT SUM(d.quantity_ordered * d.unit_cost) FROM purchase_order_detail d WHERE d.po_id = po.po_id), 0) AS total_cost
             FROM purchase_order po
             INNER JOIN supplier s ON po.supplier_id = s.supplier_id
             INNER JOIN users u ON po.user_id = u.user_id
             WHERE po.status = 'Pending Approval'
             ORDER BY po.order_date DESC, po.po_id DESC
             LIMIT 15"
        )->fetchAll();

        $receivingCount = $poCounts['Partially Received'] + $prCounts['Ordered'];
        $poIssuedCount = $poCounts['Ordered'] + $poCounts['Draft'];
        $completedCount = $poCounts['Received'] > 0 ? (int)$poCounts['Received'] : (int)$prCounts['Completed'];

        return array(
            'kpis' => array(
                'awaiting_approval' => $prCounts['Pending'],
                'pos_pending_approval' => $posPendingApproval,
                'approved' => $approvedTotal,
                'approved_requests' => $approvedTotal,
                'for_revision' => $prCounts['For Revision'],
                'for_revision_requests' => $prCounts['For Revision'],
                'rejected' => $prCounts['Rejected'],
                'rejected_requests' => $prCounts['Rejected']
            ),
            'pipeline' => array(
                'approved_requests' => $approvedTotal,
                'po_issued' => $poIssuedCount,
                'receiving' => $receivingCount,
                'completed' => $completedCount
            ),
            'in_progress' => array(
                'approved_waiting_po' => $prCounts['Approved'],
                'po_issued' => $poIssuedCount,
                'receiving' => $receivingCount
            ),
            'approved_in_progress' => $approvedInProgress,
            'approval_queue' => $queue,
            'po_approval_queue' => $poApprovalQueue,
            'stock_comparison' => $comparison,
            'sufficient_products' => $suffSlice,
            'sufficient_stock_products' => $suffSlice,
            'recent_approvals' => $recentApprovals,
            'notifications' => $notifs
        );
    }

    private function handleManagerPrList() {
        $status = isset($_GET['status']) ? trim((string)$_GET['status']) : '';
        $search = isset($_GET['search']) ? trim((string)$_GET['search']) : '';
        $startDate = isset($_GET['start_date']) ? trim((string)$_GET['start_date']) : '';
        $endDate = isset($_GET['end_date']) ? trim((string)$_GET['end_date']) : '';

        $where = array();
        $params = array();

        if ($status !== '' && strtolower($status) !== 'all') {
            $stLower = strtolower($status);
            if ($stLower === 'pending' || $stLower === 'pending approval') {
                $where[] = "pr.status = 'Pending'";
            } elseif ($stLower === 'approved') {
                $where[] = "pr.status IN ('Approved', 'Ordered', 'Partially Received', 'Completed')";
            } elseif ($stLower === 'for revision' || $stLower === 'returned for revision') {
                $where[] = "pr.status = 'For Revision'";
            } elseif ($stLower === 'rejected') {
                $where[] = "pr.status = 'Rejected'";
            } else {
                $where[] = "pr.status = :st";
                $params[':st'] = $status;
            }
        }

        if ($startDate !== '') {
            $where[] = "DATE(pr.submitted_at) >= :sdate";
            $params[':sdate'] = $startDate;
        }
        if ($endDate !== '') {
            $where[] = "DATE(pr.submitted_at) <= :edate";
            $params[':edate'] = $endDate;
        }

        if ($search !== '') {
            $where[] = "(pr.pr_code LIKE :q OR CONCAT(u.first_name, ' ', u.last_name) LIKE :q OR u.username LIKE :q OR pr.purpose LIKE :q OR pr.remarks LIKE :q)";
            $params[':q'] = '%' . $search . '%';
        }

        $whereSql = !empty($where) ? 'WHERE ' . implode(' AND ', $where) : '';

        $sql = "SELECT pr.pr_id,
                       COALESCE(pr.pr_code, CONCAT('PR-', LPAD(pr.pr_id, 4, '0'))) AS pr_code,
                       pr.requester_id,
                       COALESCE(pr.store_name, 'Main Store') AS store_name,
                       COALESCE(NULLIF(TRIM(pr.purpose), ''), NULLIF(TRIM(pr.reason), ''), 'Store Inventory Replenishment') AS purpose,
                       CASE WHEN u.user_id IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE 'Unknown Requester' END AS requested_by,
                       pr.status,
                       pr.submitted_at,
                       DATE(pr.submitted_at) AS request_date,
                       (SELECT COUNT(*) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id) AS item_count,
                       COALESCE((SELECT SUM(d.requested_qty) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id), 0) AS total_requested_qty
                FROM purchase_request pr
                LEFT JOIN users u ON u.user_id = pr.requester_id
                $whereSql
                ORDER BY pr.submitted_at DESC, pr.pr_id DESC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        sendResponse(true, 'Manager PR list retrieved', $rows);
    }

    private function handleManagerPoList() {
        $status = isset($_GET['status']) ? trim((string)$_GET['status']) : '';
        $search = isset($_GET['search']) ? trim((string)$_GET['search']) : '';
        $startDate = isset($_GET['start_date']) ? trim((string)$_GET['start_date']) : '';
        $endDate = isset($_GET['end_date']) ? trim((string)$_GET['end_date']) : '';

        $where = array();
        $params = array();

        if ($status !== '' && strtolower($status) !== 'all') {
            $where[] = "po.status = :st";
            $params[':st'] = $status;
        }

        if ($startDate !== '') {
            $where[] = "po.order_date >= :sdate";
            $params[':sdate'] = $startDate;
        }
        if ($endDate !== '') {
            $where[] = "po.order_date <= :edate";
            $params[':edate'] = $endDate;
        }

        if ($search !== '') {
            $where[] = "(po.po_code LIKE :q OR s.supplier_name LIKE :q OR CONCAT(u.first_name, ' ', u.last_name) LIKE :q)";
            $params[':q'] = '%' . $search . '%';
        }

        $whereSql = !empty($where) ? 'WHERE ' . implode(' AND ', $where) : '';

        $sql = "SELECT po.po_id,
                       CONCAT('PO-', LPAD(po.po_id, 4, '0')) AS po_code,
                       s.supplier_name,
                       CONCAT(u.first_name, ' ', u.last_name) AS ordered_by,
                       po.order_date, po.expected_date, po.status, po.manager_notes,
                       (SELECT COUNT(*) FROM purchase_order_detail d WHERE d.po_id = po.po_id) AS item_count,
                       COALESCE((SELECT SUM(d.quantity_ordered) FROM purchase_order_detail d WHERE d.po_id = po.po_id), 0) AS total_ordered_qty,
                       COALESCE((SELECT SUM(d.quantity_ordered * d.unit_cost) FROM purchase_order_detail d WHERE d.po_id = po.po_id), 0) AS total_cost
                FROM purchase_order po
                INNER JOIN supplier s ON po.supplier_id = s.supplier_id
                INNER JOIN users u ON po.user_id = u.user_id
                $whereSql
                ORDER BY po.order_date DESC, po.po_id DESC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        sendResponse(true, 'Manager PO list retrieved', $rows);
    }

    private function handleManagerStockComparison(array $products) {
        $filter = isset($_GET['filter']) ? trim((string)$_GET['filter']) : 'top10';
        $search = isset($_GET['search']) ? trim((string)$_GET['search']) : '';

        $prodMap = array();
        foreach ($products as $p) {
            $prodMap[(int)$p['product_id']] = $p;
        }

        $reqMap = array();
        $stmt = $this->conn->query("
            SELECT d.product_id, SUM(d.requested_qty) AS req_qty
            FROM purchase_request_detail d
            INNER JOIN purchase_request pr ON pr.pr_id = d.pr_id
            GROUP BY d.product_id
        ");
        while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $reqMap[(int)$r['product_id']] = (int)$r['req_qty'];
        }

        $list = array();
        foreach ($products as $p) {
            $pid = (int)$p['product_id'];
            $req = isset($reqMap[$pid]) ? $reqMap[$pid] : 0;
            $avail = (int)$p['available_stock'];
            $maxS = (int)$p['max_stock'] > 0 ? (int)$p['max_stock'] : 100;
            $reorder = (int)$p['reorder_threshold'];

            $status = 'Sufficient';
            if ($avail <= 0 || !empty($p['is_critical_stock'])) {
                $status = 'Critical';
            } elseif ($avail <= $reorder || !empty($p['is_low_stock'])) {
                $status = 'Low';
            }

            $list[] = array(
                'product_id' => $pid,
                'product_name' => $p['product_name'],
                'sku' => isset($p['sku']) ? $p['sku'] : ('SKU-' . str_pad((string)$pid, 4, '0', STR_PAD_LEFT)),
                'requested_qty' => $req,
                'available_stock' => $avail,
                'max_stock' => $maxS,
                'status' => $status
            );
        }

        if ($search !== '') {
            $q = strtolower($search);
            $list = array_values(array_filter($list, function ($item) use ($q) {
                return (strpos(strtolower($item['product_name']), $q) !== false) || (strpos(strtolower($item['sku']), $q) !== false);
            }));
        }

        if ($filter === 'top5') {
            usort($list, function ($a, $b) { return $b['requested_qty'] - $a['requested_qty']; });
            $list = array_slice($list, 0, 5);
        } elseif ($filter === 'top10') {
            usort($list, function ($a, $b) { return $b['requested_qty'] - $a['requested_qty']; });
            $list = array_slice($list, 0, 10);
        } elseif ($filter === 'low') {
            $list = array_values(array_filter($list, function ($item) { return $item['status'] === 'Low'; }));
        } elseif ($filter === 'critical') {
            $list = array_values(array_filter($list, function ($item) { return $item['status'] === 'Critical'; }));
        }

        sendResponse(true, 'Stock comparison retrieved', $list);
    }

    private function getPurchasingRecentActivity() {
        return $this->conn->query(
            "SELECT * FROM (
                SELECT CONCAT('PO-', LPAD(po.po_id, 4, '0')) AS ref_no,
                       CONCAT('PO ', po.status, ' — ', s.supplier_name) AS summary,
                       po.order_date AS activity_date,
                       COALESCE(po.updated_at, CONCAT(po.order_date, ' 12:00:00')) AS sort_ts
                FROM purchase_order po
                INNER JOIN supplier s ON s.supplier_id = po.supplier_id

                UNION ALL

                SELECT CONCAT('RCV-', LPAD(r.receiving_id, 4, '0')) AS ref_no,
                       CONCAT('Delivery recorded against PO-', LPAD(r.po_id, 4, '0')) AS summary,
                       r.receiving_date AS activity_date,
                       COALESCE(r.created_at, CONCAT(r.receiving_date, ' 12:00:00')) AS sort_ts
                FROM stock_receiving r
             ) a
             ORDER BY a.sort_ts DESC
             LIMIT 8"
        )->fetchAll();
    }

    private function buildPurchasingDashboard(array $products, array $notifs) {
        $poCounts = $this->getPoStatusCounts();

        $reorderCandidates = array();
        foreach ($products as $p) {
            $avail = (int)$p['available_stock'];
            $reorder = (int)$p['reorder_level'];
            $threshold = (int)$p['reorder_threshold'];
            $effReorder = $reorder > 0 ? $reorder : $threshold;

            if ($avail <= 0 || ($avail > 0 && $avail <= $effReorder)) {
                $reorderCandidates[] = $p;
            }
        }
        usort($reorderCandidates, function ($a, $b) {
            $aAvail = (int)$a['available_stock'];
            $bAvail = (int)$b['available_stock'];
            if ($aAvail === $bAvail) {
                return strcmp((string)$a['product_name'], (string)$b['product_name']);
            }
            return $aAvail - $bAvail;
        });

        $posPendingApproval = (int)$this->conn->query("SELECT COUNT(*) FROM purchase_order WHERE status = 'Pending Approval'")->fetchColumn();

        $approvedRequests = $this->conn->query(
            "SELECT pr.pr_id,
                    CONCAT('PR-', LPAD(pr.pr_id, 4, '0')) AS pr_code,
                    pr.requester_id,
                    CASE WHEN ru.user_id IS NOT NULL THEN CONCAT(ru.first_name, ' ', ru.last_name) ELSE 'Unknown Requester' END AS requested_by,
                    CASE WHEN ru.user_id IS NOT NULL THEN CONCAT(ru.first_name, ' ', ru.last_name) ELSE 'Unknown Requester' END AS requested_by_name,
                    r_req.role_name AS requester_role,
                    r_req.role_name AS role_name,
                    CASE WHEN rv.user_id IS NOT NULL THEN CONCAT(rv.first_name, ' ', rv.last_name) ELSE NULL END AS approved_by,
                    CASE WHEN rv.user_id IS NOT NULL THEN CONCAT(rv.first_name, ' ', rv.last_name) ELSE NULL END AS approved_by_name,
                    r_rev.role_name AS reviewer_role,
                    pr.status,
                    pr.reviewed_at,
                    pr.manager_comment,
                    COUNT(d.pr_detail_id) AS item_count,
                    SUM(GREATEST(0, COALESCE(d.approved_qty, d.requested_qty) - d.ordered_qty)) AS remaining_approved_qty,
                    SUM(GREATEST(0, COALESCE(d.approved_qty, d.requested_qty) - d.ordered_qty)) AS total_approved_qty,
                    GROUP_CONCAT(CONCAT(p.product_name, ' (', GREATEST(0, COALESCE(d.approved_qty, d.requested_qty) - d.ordered_qty), ')') SEPARATOR ', ') AS items_summary
             FROM purchase_request pr
             INNER JOIN purchase_request_detail d ON d.pr_id = pr.pr_id
             INNER JOIN product p ON p.product_id = d.product_id
             LEFT JOIN users ru ON ru.user_id = pr.requester_id
             LEFT JOIN role r_req ON r_req.role_id = ru.role_id
             LEFT JOIN users rv ON rv.user_id = pr.reviewed_by
             LEFT JOIN role r_rev ON r_rev.role_id = rv.role_id
             WHERE pr.status = 'Approved'
               AND COALESCE(d.approved_qty, d.requested_qty) > d.ordered_qty
             GROUP BY pr.pr_id, ru.first_name, ru.last_name, r_req.role_name, rv.user_id, rv.first_name, rv.last_name, r_rev.role_name, pr.status, pr.reviewed_at, pr.manager_comment
             ORDER BY pr.reviewed_at ASC, pr.pr_id ASC"
        )->fetchAll();

        $openPos = $this->conn->query(
            "SELECT po.po_id,
                    CONCAT('PO-', LPAD(po.po_id, 4, '0')) AS po_code,
                    po.pr_id,
                    CASE WHEN po.pr_id IS NOT NULL THEN CONCAT('PR-', LPAD(po.pr_id, 4, '0')) ELSE NULL END AS pr_code,
                    s.supplier_name, po.order_date, po.expected_date, po.status,
                    COALESCE((SELECT SUM(d.quantity_ordered) FROM purchase_order_detail d WHERE d.po_id = po.po_id), 0) AS total_ordered_qty,
                    COALESCE((SELECT SUM(d.quantity_ordered) FROM purchase_order_detail d WHERE d.po_id = po.po_id), 0) AS total_ordered,
                    COALESCE((SELECT SUM(d.quantity_received) FROM purchase_order_detail d WHERE d.po_id = po.po_id), 0) AS total_received_qty,
                    COALESCE((SELECT SUM(d.quantity_received) FROM purchase_order_detail d WHERE d.po_id = po.po_id), 0) AS total_received,
                    COALESCE((SELECT SUM(d.quantity_ordered * d.unit_cost) FROM purchase_order_detail d WHERE d.po_id = po.po_id), 0) AS total_cost
             FROM purchase_order po
             INNER JOIN supplier s ON s.supplier_id = po.supplier_id
             ORDER BY po.po_id DESC
             LIMIT 12"
        )->fetchAll();

        $recentActivity = $this->getPurchasingRecentActivity();

        return array(
            'kpis' => array(
                'total_pos' => array_sum($poCounts),
                'approved_ready_for_po' => count($approvedRequests),
                'items_to_reorder' => count($reorderCandidates),
                'reorder_items_count' => count($reorderCandidates),
                'pos_pending_approval' => $poCounts['Pending Approval'],
                'draft_pos' => $poCounts['Draft'],
                'po_draft' => $poCounts['Draft'],
                'awaiting_confirmation' => $poCounts['Draft'],
                'awaiting_delivery' => $poCounts['Ordered'],
                'po_awaiting_delivery' => $poCounts['Ordered'],
                'partially_received' => $poCounts['Partially Received'],
                'po_partially_received' => $poCounts['Partially Received'],
                'completed_pos' => $poCounts['Received'],
                'po_completed' => $poCounts['Received'],
                'cancelled_pos' => $poCounts['Cancelled'],
                'po_cancelled' => $poCounts['Cancelled'] + $poCounts['Closed Short'],
                'po_status_counts' => $poCounts
            ),
            'approved_requests' => $approvedRequests,
            'approved_requests_queue' => $approvedRequests,
            'items_to_reorder' => $reorderCandidates,
            'reorder_candidates' => $reorderCandidates,
            'open_purchase_orders' => $openPos,
            'recent_pos' => $openPos,
            'recent_activity' => $recentActivity,
            'notifications' => $notifs
        );
    }

    private function buildWarehouseDashboard(array $lowList, $lowCount, $criticalCount, array $notifs) {
        $poCounts = $this->getPoStatusCounts();

        $pendingReleases = (int)$this->conn->query("SELECT COUNT(*) FROM purchase_request WHERE status = 'Approved' AND (releasing_id IS NULL OR releasing_id = 0)")->fetchColumn();
        $pendingPrReleases = $this->conn->query(
            "SELECT pr.pr_id,
                    CONCAT('PR-', LPAD(pr.pr_id, 4, '0')) AS pr_code,
                    COALESCE(pr.store_name, 'Main Store') AS store_name,
                    CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name,
                    pr.submitted_at, pr.reviewed_at,
                    (SELECT COUNT(*) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id) AS item_count,
                    COALESCE((SELECT SUM(COALESCE(d.approved_qty, d.requested_qty)) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id), 0) AS total_approved_qty
             FROM purchase_request pr
             INNER JOIN users u ON u.user_id = pr.requester_id
             WHERE pr.status = 'Approved' AND (pr.releasing_id IS NULL OR pr.releasing_id = 0)
             ORDER BY pr.reviewed_at ASC
             LIMIT 100"
        )->fetchAll();

        $incoming = $this->conn->query(
            "SELECT po.po_id,
                    CONCAT('PO-', LPAD(po.po_id, 4, '0')) AS po_code,
                    po.pr_id,
                    CASE WHEN po.pr_id IS NOT NULL THEN CONCAT('PR-', LPAD(po.pr_id, 4, '0')) ELSE NULL END AS pr_code,
                    s.supplier_name, po.order_date, po.expected_date, po.status,
                    (SELECT COUNT(*) FROM purchase_order_detail d WHERE d.po_id = po.po_id) AS item_count,
                    COALESCE((SELECT SUM(d.quantity_ordered) FROM purchase_order_detail d WHERE d.po_id = po.po_id), 0) AS total_ordered_qty,
                    COALESCE((SELECT SUM(d.quantity_ordered) FROM purchase_order_detail d WHERE d.po_id = po.po_id), 0) AS total_ordered,
                    COALESCE((SELECT SUM(d.quantity_received) FROM purchase_order_detail d WHERE d.po_id = po.po_id), 0) AS total_received_qty,
                    COALESCE((SELECT SUM(d.quantity_received) FROM purchase_order_detail d WHERE d.po_id = po.po_id), 0) AS total_received,
                    COALESCE((SELECT SUM(GREATEST(0, d.quantity_ordered - d.quantity_received)) FROM purchase_order_detail d WHERE d.po_id = po.po_id), 0) AS outstanding_qty
             FROM purchase_order po
             INNER JOIN supplier s ON s.supplier_id = po.supplier_id
             WHERE po.status IN ('Ordered', 'Partially Received', 'Pending')
             HAVING outstanding_qty > 0
             ORDER BY CASE WHEN po.status = 'Partially Received' THEN 0 ELSE 1 END, po.order_date ASC, po.po_id ASC
             LIMIT 100"
        )->fetchAll();

        $completedReceiving = (int)$this->conn->query("SELECT COUNT(*) FROM stock_receiving")->fetchColumn();
        $receivedToday = (int)$this->conn->query("SELECT COUNT(*) FROM stock_receiving WHERE receiving_date = CURDATE()")->fetchColumn();

        $recentReceivings = $this->conn->query(
            "SELECT r.receiving_id,
                    CONCAT('RCV-', LPAD(r.receiving_id, 4, '0')) AS receiving_code,
                    r.po_id,
                    CONCAT('PO-', LPAD(r.po_id, 4, '0')) AS po_code,
                    r.dr_number,
                    s.supplier_name,
                    r.receiving_date,
                    COALESCE((SELECT SUM(d.quantity_received) FROM stock_receiving_detail d WHERE d.receiving_id = r.receiving_id), 0) AS total_received
             FROM stock_receiving r
             INNER JOIN purchase_order po ON po.po_id = r.po_id
             INNER JOIN supplier s ON s.supplier_id = po.supplier_id
             ORDER BY r.receiving_id DESC
             LIMIT 100"
        )->fetchAll();

        $movements = $this->conn->query(
            "SELECT * FROM (
                SELECT CONCAT('RCV-', LPAD(r.receiving_id, 4, '0')) AS ref_no,
                       'IN' AS direction,
                       p.product_name,
                       d.quantity_received AS qty,
                       r.receiving_date AS move_date,
                       COALESCE(r.created_at, CONCAT(r.receiving_date, ' 12:00:00')) AS sort_ts
                FROM stock_receiving_detail d
                INNER JOIN stock_receiving r ON r.receiving_id = d.receiving_id
                INNER JOIN product p ON p.product_id = d.product_id
                WHERE d.quantity_received > 0

                UNION ALL

                SELECT CONCAT('REL-', LPAD(rel.releasing_id, 4, '0')) AS ref_no,
                       'OUT' AS direction,
                       p.product_name,
                       d.quantity_released AS qty,
                       rel.releasing_date AS move_date,
                       CONCAT(rel.releasing_date, ' 12:00:00') AS sort_ts
                FROM stock_releasing_detail d
                INNER JOIN stock_releasing rel ON rel.releasing_id = d.releasing_id
                INNER JOIN product p ON p.product_id = d.product_id

                UNION ALL

                SELECT CONCAT('ADJ-', LPAD(ad.adjustment_detail_id, 4, '0')) AS ref_no,
                       CASE WHEN ad.adjustment_type = 'Addition' THEN 'IN' ELSE 'OUT' END AS direction,
                       p.product_name,
                       ad.quantity AS qty,
                       COALESCE(ad.adjustment_date, DATE(ad.created_at)) AS move_date,
                       ad.created_at AS sort_ts
                FROM adjustment_detail ad
                INNER JOIN product p ON p.product_id = ad.product_id
             ) mv
             ORDER BY mv.sort_ts DESC
             LIMIT 10"
        )->fetchAll();

        $alertsSlice = array_slice($lowList, 0, 8);

        return array(
            'kpis' => array(
                'awaiting_receiving' => $poCounts['Ordered'],
                'deliveries_awaiting_receiving' => $poCounts['Ordered'] + $poCounts['Partially Received'],
                'partially_received' => $poCounts['Partially Received'],
                'pending_releases' => $pendingReleases,
                'approved_releases' => $pendingReleases,
                'received_today' => $receivedToday,
                'completed_receiving' => $completedReceiving,
                'completed_receivings' => $completedReceiving,
                'low_stock_count' => $lowCount,
                'critical_stock_count' => $criticalCount
            ),
            'incoming_deliveries' => $incoming,
            'pending_pr_releases' => $pendingPrReleases,
            'recent_receivings' => $recentReceivings,
            'stock_alerts' => $alertsSlice,
            'all_stock_alerts' => $lowList,
            'low_stock_products' => $alertsSlice,
            'recent_movements' => $movements,
            'notifications' => $notifs
        );
    }

    private function buildRequesterDashboard($userId, array $products, array $replenishCandidates, array $notifs) {
        $prCounts = $this->getRequestStatusCounts($userId);

        // 1. Identify current assigned store or branch for this user
        $userStore = $this->conn->prepare("SELECT store_name FROM purchase_request WHERE requester_id = :uid AND store_name IS NOT NULL AND TRIM(store_name) != '' ORDER BY pr_id DESC LIMIT 1");
        $userStore->execute(array(':uid' => $userId));
        $assignedBranch = $userStore->fetchColumn();
        if (!$assignedBranch || trim($assignedBranch) === '') {
            $assignedBranch = 'Main Store';
        }

        // 2. Query branch inventory balances for assigned branch
        $branchInvStmt = $this->conn->prepare(
            "SELECT p.product_id, p.product_name, p.unit_measure, p.reorder_level, p.max_stock,
                    c.category_name, COALESCE(si.quantity, 0) AS branch_stock
             FROM product p
             LEFT JOIN category c ON c.category_id = p.category_id
             LEFT JOIN store_inventory si ON si.product_id = p.product_id AND si.store_name = :branch
             WHERE p.is_active = 1
             ORDER BY p.product_name ASC"
        );
        $branchInvStmt->execute(array(':branch' => $assignedBranch));
        $branchProducts = $branchInvStmt->fetchAll();

        $inStockCount = 0;
        $lowStockCount = 0;
        $outOfStockCount = 0;
        $branchStockAlerts = array();

        foreach ($branchProducts as $bp) {
            $bStock = (int)$bp['branch_stock'];
            $reorder = (int)$bp['reorder_level'] > 0 ? (int)$bp['reorder_level'] : 10;
            $maxStock = (int)$bp['max_stock'] > 0 ? (int)$bp['max_stock'] : max(100, $reorder * 2);

            if ($bStock <= 0) {
                $outOfStockCount++;
                $branchStockAlerts[] = array(
                    'product_id' => (int)$bp['product_id'],
                    'product_name' => $bp['product_name'],
                    'category_name' => $bp['category_name'] ?: 'General',
                    'unit_measure' => $bp['unit_measure'] ?: 'pcs',
                    'available_quantity' => 0,
                    'reorder_level' => $reorder,
                    'max_stock' => $maxStock,
                    'status' => 'Out of Stock',
                    'badge_class' => 'bg-danger text-white'
                );
            } elseif ($bStock <= $reorder) {
                $lowStockCount++;
                $branchStockAlerts[] = array(
                    'product_id' => (int)$bp['product_id'],
                    'product_name' => $bp['product_name'],
                    'category_name' => $bp['category_name'] ?: 'General',
                    'unit_measure' => $bp['unit_measure'] ?: 'pcs',
                    'available_quantity' => $bStock,
                    'reorder_level' => $reorder,
                    'max_stock' => $maxStock,
                    'status' => 'Low Stock',
                    'badge_class' => 'bg-warning text-dark'
                );
            } else {
                $inStockCount++;
            }
        }

        // Sort alerts: Out of stock (0) first, then lowest stock
        usort($branchStockAlerts, function($a, $b) {
            if ($a['available_quantity'] === $b['available_quantity']) {
                return strcmp($a['product_name'], $b['product_name']);
            }
            return $a['available_quantity'] - $b['available_quantity'];
        });

        // 3. User Purchase Requests (Top 5 recent + full query for modals)
        $myRequests = $this->conn->prepare(
            "SELECT pr.pr_id,
                    COALESCE(pr.pr_code, CONCAT('PR-', LPAD(pr.pr_id, 4, '0'))) AS pr_code,
                    COALESCE(pr.store_name, 'Main Store') AS store_name,
                    COALESCE(NULLIF(TRIM(pr.purpose), ''), NULLIF(TRIM(pr.reason), ''), 'Store Inventory Replenishment') AS purpose,
                    COALESCE(NULLIF(TRIM(pr.urgency), ''), 'Normal') AS urgency,
                    pr.status,
                    COALESCE(NULLIF(TRIM(pr.approval_status), ''), CASE
                        WHEN pr.status = 'Draft' THEN 'Draft'
                        WHEN pr.status IN ('Pending', 'Pending Approval') THEN 'Pending Approval'
                        WHEN pr.status IN ('For Revision', 'Returned for Revision') THEN 'Returned for Revision'
                        WHEN pr.status IN ('Approved', 'Partially Ordered', 'Ordered', 'Partially Received', 'Completed') THEN 'Approved'
                        WHEN pr.status = 'Rejected' THEN 'Rejected'
                        WHEN pr.status = 'Cancelled' THEN 'Cancelled'
                        ELSE 'Pending Approval'
                    END) AS approval_status,
                    COALESCE(NULLIF(TRIM(pr.fulfillment_status), ''), CASE
                        WHEN pr.status = 'Draft' THEN 'Draft'
                        WHEN pr.status IN ('Pending', 'Pending Approval') THEN 'Awaiting Approval'
                        WHEN pr.status IN ('For Revision', 'Returned for Revision') THEN 'Awaiting Revision'
                        WHEN pr.status = 'Approved' THEN 'Pending Fulfillment'
                        WHEN pr.status IN ('Partially Ordered', 'Ordered') THEN 'On Order'
                        WHEN pr.status = 'Partially Received' THEN 'Partially Fulfilled'
                        WHEN pr.status = 'Completed' THEN 'Fulfilled'
                        WHEN pr.status = 'Rejected' THEN 'Not Fulfilled'
                        WHEN pr.status = 'Cancelled' THEN 'Cancelled'
                        ELSE 'Unfulfilled'
                    END) AS fulfillment_status,
                    pr.reason, COALESCE(NULLIF(TRIM(pr.remarks), ''), pr.reason) AS remarks,
                    pr.manager_comment,
                    CASE WHEN pr.status = 'Rejected' THEN pr.manager_comment ELSE NULL END AS rejection_reason,
                    pr.submitted_at, DATE(pr.submitted_at) AS request_date, pr.reviewed_at,
                    CASE WHEN rv.user_id IS NOT NULL THEN CONCAT(rv.first_name, ' ', rv.last_name) ELSE NULL END AS reviewed_by_name,
                    CASE WHEN rv.user_id IS NOT NULL THEN CONCAT(rv.first_name, ' ', rv.last_name) ELSE NULL END AS approved_by_name,
                    r_rev.role_name AS reviewer_role,
                    r_rev.role_name AS reviewer_role_name,
                    (SELECT COUNT(*) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id) AS item_count,
                    COALESCE((SELECT SUM(d.requested_qty) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id), 0) AS total_requested_qty,
                    COALESCE((SELECT SUM(COALESCE(d.approved_qty, d.requested_qty)) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id), 0) AS total_approved_qty,
                    (SELECT GROUP_CONCAT(CONCAT(p.product_name, ' (', COALESCE(d.approved_qty, d.requested_qty), ')') SEPARATOR ', ')
                     FROM purchase_request_detail d
                     INNER JOIN product p ON p.product_id = d.product_id
                     WHERE d.pr_id = pr.pr_id) AS items_summary
             FROM purchase_request pr
             LEFT JOIN users rv ON rv.user_id = pr.reviewed_by
             LEFT JOIN role r_rev ON r_rev.role_id = rv.role_id
             WHERE pr.requester_id = :uid
             ORDER BY pr.submitted_at DESC, pr.pr_id DESC
             LIMIT 50"
        );
        $myRequests->execute(array(':uid' => $userId));
        $allMyRequests = $myRequests->fetchAll();
        $recentRequests = array_slice($allMyRequests, 0, 5);

        // Calculate KPI values
        $totalRequests = count($allMyRequests);
        $approvedTotal = $prCounts['Approved'] + $prCounts['Ordered'] + $prCounts['Partially Received'] + $prCounts['Completed'];

        return array(
            'assigned_branch' => $assignedBranch,
            'kpis' => array(
                'total_requests' => $totalRequests,
                'pending_approval' => $prCounts['Pending'],
                'approved' => $approvedTotal,
                'for_revision' => $prCounts['For Revision'],
                'rejected' => $prCounts['Rejected'],
                'draft' => $prCounts['Draft'],
                'completed' => $prCounts['Completed']
            ),
            'branch_inventory' => array(
                'store_name' => $assignedBranch,
                'in_stock' => $inStockCount,
                'low_stock' => $lowStockCount,
                'out_of_stock' => $outOfStockCount,
                'total_products' => count($branchProducts),
                'alerts' => $branchStockAlerts,
                'products' => $branchProducts
            ),
            'branch_stock_alerts' => $branchStockAlerts,
            'recent_requests' => $recentRequests,
            'my_recent_requests' => $recentRequests,
            'my_requests' => $recentRequests,
            'all_my_requests' => $allMyRequests,
            'notifications' => $notifs
        );
    }

    private function getRequestStatusCounts($requesterId = 0) {
        $counts = array(
            'Draft' => 0,
            'Pending' => 0,
            'For Revision' => 0,
            'Approved' => 0,
            'Ordered' => 0,
            'Partially Received' => 0,
            'Completed' => 0,
            'Rejected' => 0,
            'Cancelled' => 0
        );
        if ($requesterId > 0) {
            $stmt = $this->conn->prepare("SELECT status, COUNT(*) AS cnt FROM purchase_request WHERE requester_id = :uid GROUP BY status");
            $stmt->execute(array(':uid' => (int)$requesterId));
        } else {
            $stmt = $this->conn->query("SELECT status, COUNT(*) AS cnt FROM purchase_request GROUP BY status");
        }
        foreach ($stmt->fetchAll() as $r) {
            $st = $r['status'];
            if ($st === 'Pending Approval') $st = 'Pending';
            if (isset($counts[$st])) {
                $counts[$st] += (int)$r['cnt'];
            }
        }
        return $counts;
    }

    private function getPoStatusCounts() {
        $counts = array(
            'Pending Approval' => 0,
            'Draft' => 0,
            'Ordered' => 0,
            'Partially Received' => 0,
            'Received' => 0,
            'Closed Short' => 0,
            'Cancelled' => 0
        );
        $stmt = $this->conn->query("SELECT status, COUNT(*) AS cnt FROM purchase_order GROUP BY status");
        foreach ($stmt->fetchAll() as $r) {
            $rawStatus = (string)($r['status'] ?? '');
            $rawLower = strtolower($rawStatus);
            if (strpos($rawLower, 'pending') !== false) {
                $counts['Pending Approval'] += (int)$r['cnt'];
            } elseif ($rawLower === 'draft') {
                $counts['Draft'] += (int)$r['cnt'];
            } elseif ($rawLower === 'ordered' || $rawLower === 'issued') {
                $counts['Ordered'] += (int)$r['cnt'];
            } elseif ($rawLower === 'partially received') {
                $counts['Partially Received'] += (int)$r['cnt'];
            } elseif ($rawLower === 'received' || $rawLower === 'fully received' || $rawLower === 'completed') {
                $counts['Received'] += (int)$r['cnt'];
            } elseif ($rawLower === 'cancelled') {
                $counts['Cancelled'] += (int)$r['cnt'];
            } elseif ($rawLower === 'closed short' || $rawLower === 'closed') {
                $counts['Closed Short'] += (int)$r['cnt'];
            }
        }
        return $counts;
    }

    private function getRecentNotifications($userId, $limit = 8) {
        $stmt = $this->conn->prepare(
            "SELECT notification_id, type, severity, title, message, link_tab,
                    ref_type, ref_type AS entity_type,
                    ref_id, ref_id AS entity_id,
                    is_read, created_at
             FROM notification
             WHERE user_id = :uid
             ORDER BY notification_id DESC
             LIMIT " . (int)$limit
        );
        $stmt->execute(array(':uid' => (int)$userId));
        return $stmt->fetchAll();
    }
}

$conn = getConnection();
$method = $_SERVER['REQUEST_METHOD'];

$api = new DashboardApi($conn);
$api->handleRequest($method);
