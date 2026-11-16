<?php
require_once '../config/db.php';
sendJsonHeaders();

class StockReceivingApi {
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
                sendResponse(false, 'Request failed.', null, 405);
                break;
        }
    }

    private function get() {
        requirePermission(array('stock_receiving', 'purchase_order', 'request_approval'), 'view');

        if (isset($_GET['receiving_id'])) {
            $rid = validatePositiveInt($_GET['receiving_id']);
            if ($rid <= 0) {
                sendResponse(false, 'Invalid receiving ID.', null, 400);
            }
            $detail = $this->getReceivingDetail($rid);
            if (!$detail) {
                sendResponse(false, 'Receiving record not found.', null, 404);
            }
            sendResponse(true, 'Receiving record retrieved', $detail);
        }

        if (isset($_GET['po_id'])) {
            $id = validatePositiveInt($_GET['po_id']);
            if ($id <= 0) {
                sendResponse(false, 'Invalid purchase order ID.', null, 400);
            }
            sendResponse(true, 'Purchase order items retrieved', $this->getPurchaseOrderItemsForReceiving($id));
        }

        $mode = isset($_GET['mode']) ? (string)$_GET['mode'] : 'all';
        sendResponse(true, 'Stock receiving records retrieved', $this->getAllStockReceiving($mode));
    }

    private function post() {
        $actor = requirePermission('stock_receiving', 'manage');
        requireCsrf();
        $b = getRequestBody();

        $action = isset($b['action']) && is_string($b['action']) ? trim($b['action']) : '';

        if ($action === 'inspect' || $action === 'inspect_and_post' || $action === 'post_inventory') {
            $this->handleInspection($b, $actor);
            return;
        }

        $this->handleReceivingCreation($b, $actor);
    }

    private function put() {
        $actor = requirePermission('stock_receiving', 'manage');
        requireCsrf();
        $b = getRequestBody();
        $this->handleInspection($b, $actor);
    }

    /**
     * Workflow A: Warehouse Officer creates Goods Receipt Note (GRN) upon delivery arrival.
     * Generates unique GRN number and submits for inspection.
     * Inventory DOES NOT increase until accepted quantities are inspected and posted.
     */
    private function handleReceivingCreation(array $b, array $actor) {
        $poId = validatePositiveInt(isset($b['po_id']) ? $b['po_id'] : 0);
        $date = isset($b['receiving_date']) ? (string)$b['receiving_date'] : date('Y-m-d');
        $drNumber = isset($b['dr_number']) && is_string($b['dr_number']) ? trim($b['dr_number']) : '';
        $remarks = isset($b['remarks']) && is_string($b['remarks']) ? trim($b['remarks']) : '';
        $clientToken = isset($b['client_token']) && is_string($b['client_token']) ? trim($b['client_token']) : '';
        $rawItems = isset($b['items']) && is_array($b['items']) ? $b['items'] : array();
        $autoInspect = !empty($b['auto_inspect']);

        if ($poId <= 0 || !validateDateValue($date) || empty($rawItems) || strlen($drNumber) > 50 || strlen($remarks) > 500) {
            sendResponse(false, 'Please select an authorized purchase order, valid delivery date, DR number, and items.', null, 422);
        }

        $items = array();
        $totalDelivered = 0;
        foreach ($rawItems as $it) {
            if (!is_array($it)) {
                continue;
            }
            $pid = validatePositiveInt(isset($it['product_id']) ? $it['product_id'] : 0);
            $recvQty = validateNonNegativeInt(isset($it['quantity_received']) ? $it['quantity_received'] : (isset($it['quantity']) ? $it['quantity'] : 0));
            $dmgQty = validateNonNegativeInt(isset($it['quantity_damaged']) ? $it['quantity_damaged'] : (isset($it['quantity_rejected']) ? $it['quantity_rejected'] : 0));
            $quarQty = validateNonNegativeInt(isset($it['quantity_quarantined']) ? $it['quantity_quarantined'] : 0);
            $note = isset($it['discrepancy_note']) && is_string($it['discrepancy_note']) ? substr(trim($it['discrepancy_note']), 0, 255) : '';
            $rejReason = isset($it['rejection_reason']) && is_string($it['rejection_reason']) ? substr(trim($it['rejection_reason']), 0, 255) : '';
            $quarReason = isset($it['quarantine_reason']) && is_string($it['quarantine_reason']) ? substr(trim($it['quarantine_reason']), 0, 255) : '';

            if ($pid <= 0 || $recvQty === null || $dmgQty === null || $quarQty === null) {
                sendResponse(false, 'Invalid item quantities supplied.', null, 422);
            }
            if ($recvQty === 0 && $dmgQty === 0 && $quarQty === 0) {
                continue;
            }

            $totalDelivered += $recvQty;
            $items[$pid] = array(
                'quantity_received' => $recvQty,
                'quantity_damaged' => $dmgQty,
                'quantity_quarantined' => $quarQty,
                'discrepancy_note' => $note,
                'rejection_reason' => $rejReason,
                'quarantine_reason' => $quarReason
            );
        }

        if (empty($items) || $totalDelivered <= 0) {
            sendResponse(false, 'Enter a positive delivered quantity for at least one item.', null, 422);
        }

        try {
            $result = $this->createGoodsReceiptNote($poId, $date, $drNumber, $remarks, $clientToken, $items, $actor, $autoInspect);
        } catch (InvalidArgumentException $e) {
            sendResponse(false, $e->getMessage(), null, 422);
        } catch (RuntimeException $e) {
            sendResponse(false, $e->getMessage(), null, 409);
        } catch (Throwable $e) {
            error_log('Stock receiving GRN creation failed: ' . $e->getMessage());
            sendResponse(false, 'Request failed: ' . $e->getMessage(), null, 500);
        }

        $receivingId = (int)$result['receiving_id'];
        $grnNumber = (string)$result['grn_number'];
        $newPoStatus = $result['po_status'];
        $prId = !empty($result['pr_id']) ? (int)$result['pr_id'] : 0;
        $requesterId = !empty($result['requester_id']) ? (int)$result['requester_id'] : 0;
        $poCreatorId = !empty($result['po_user_id']) ? (int)$result['po_user_id'] : 0;
        $poCode = 'PO-' . str_pad((string)$poId, 5, '0', STR_PAD_LEFT);
        $actorName = $actor['first_name'] . ' ' . $actor['last_name'];

        auditLog(
            $this->conn,
            $actor,
            'GRN_CREATED',
            'stock_receiving',
            $receivingId,
            $grnNumber . ' recorded against ' . $poCode . ' (PO status: ' . $newPoStatus . ', Status: ' . $result['status'] . ')'
        );

        $statusSev = ($newPoStatus === 'Received' || $newPoStatus === 'Fully Received') ? 'success' : 'info';
        $notifTitle = $grnNumber . ' Issued (' . $poCode . ' — ' . $newPoStatus . ')';
        $notifMsg = $actorName . ' recorded delivery under ' . $grnNumber . ' for ' . $poCode
            . ($drNumber !== '' ? ' (Supplier DR: ' . $drNumber . ')' : '')
            . '. Record is ' . $result['status'] . '.';

        notifyUsersWithPermission(
            $this->conn,
            'purchase_order',
            'manage',
            'po_receiving_update',
            $notifTitle,
            $notifMsg,
            'purchase_order',
            'purchase_order',
            $poId,
            $statusSev,
            (int)$actor['user_id']
        );

        if ($poCreatorId > 0 && $poCreatorId !== (int)$actor['user_id']) {
            notifyUser($this->conn, $poCreatorId, 'po_receiving_update', $notifTitle, $notifMsg, 'purchase_order', 'purchase_order', $poId, $statusSev);
        }

        if ($requesterId > 0) {
            $prCode = 'PR-' . str_pad((string)$prId, 4, '0', STR_PAD_LEFT);
            notifyUser(
                $this->conn,
                $requesterId,
                'pr_receiving_update',
                'Delivery Arrived for ' . $prCode,
                'Delivered goods for ' . $prCode . ' arrived under ' . $grnNumber . ' (' . $result['status'] . ').',
                'purchase_request',
                'purchase_request',
                $prId,
                'info'
            );
        }

        sendResponse(true, 'Goods Receipt Note ' . $grnNumber . ' created successfully (' . $result['status'] . ').', array(
            'receiving_id' => $receivingId,
            'grn_number' => $grnNumber,
            'receiving_code' => $grnNumber,
            'status' => $result['status'],
            'po_status' => $newPoStatus,
            'outstanding_qty' => $result['outstanding_qty']
        ));
    }

    /**
     * Workflow B: Goods Inspection and Inventory Posting.
     * Inspects delivered items, accounts for Accepted, Rejected, and Quarantined quantities.
     * Posts accepted quantities to usable inventory, creating stock movements and updating PO status.
     */
    private function handleInspection(array $b, array $actor) {
        $receivingId = validatePositiveInt(isset($b['receiving_id']) ? $b['receiving_id'] : 0);
        $inspDate = isset($b['inspection_date']) && validateDateValue((string)$b['inspection_date'])
            ? (string)$b['inspection_date']
            : date('Y-m-d');
        $notes = isset($b['inspection_notes']) && is_string($b['inspection_notes'])
            ? trim($b['inspection_notes'])
            : (isset($b['remarks']) ? trim($b['remarks']) : '');
        $rawItems = isset($b['items']) && is_array($b['items']) ? $b['items'] : array();

        if ($receivingId <= 0) {
            sendResponse(false, 'Please specify a valid Goods Receipt Note (receiving_id).', null, 422);
        }
        if (empty($rawItems)) {
            sendResponse(false, 'Please provide inspection breakdown for delivered items.', null, 422);
        }

        $items = array();
        foreach ($rawItems as $it) {
            if (!is_array($it)) {
                continue;
            }
            $pid = validatePositiveInt(isset($it['product_id']) ? $it['product_id'] : 0);
            $detId = validatePositiveInt(isset($it['receiving_detail_id']) ? $it['receiving_detail_id'] : 0);
            $accepted = validateNonNegativeInt(isset($it['quantity_accepted']) ? $it['quantity_accepted'] : 0);
            $rejected = validateNonNegativeInt(isset($it['quantity_rejected']) ? $it['quantity_rejected'] : 0);
            $quarantined = validateNonNegativeInt(isset($it['quantity_quarantined']) ? $it['quantity_quarantined'] : 0);
            $rejReason = isset($it['rejection_reason']) && is_string($it['rejection_reason']) ? substr(trim($it['rejection_reason']), 0, 255) : '';
            $quarReason = isset($it['quarantine_reason']) && is_string($it['quarantine_reason']) ? substr(trim($it['quarantine_reason']), 0, 255) : '';
            $discrepancyNote = isset($it['discrepancy_note']) && is_string($it['discrepancy_note']) ? substr(trim($it['discrepancy_note']), 0, 255) : '';

            if (($pid <= 0 && $detId <= 0) || $accepted === null || $rejected === null || $quarantined === null) {
                sendResponse(false, 'Invalid item inspection quantities.', null, 422);
            }

            $key = $detId > 0 ? ('det_' . $detId) : ('prod_' . $pid);
            $items[$key] = array(
                'receiving_detail_id' => $detId,
                'product_id' => $pid,
                'quantity_accepted' => $accepted,
                'quantity_rejected' => $rejected,
                'quantity_quarantined' => $quarantined,
                'rejection_reason' => $rejReason,
                'quarantine_reason' => $quarReason,
                'discrepancy_note' => $discrepancyNote
            );
        }

        try {
            $result = $this->completeInspectionAndPost($receivingId, $inspDate, $notes, $items, $actor);
        } catch (InvalidArgumentException $e) {
            sendResponse(false, $e->getMessage(), null, 422);
        } catch (RuntimeException $e) {
            sendResponse(false, $e->getMessage(), null, 409);
        } catch (Throwable $e) {
            error_log('Goods inspection failed: ' . $e->getMessage());
            sendResponse(false, 'Inspection failed: ' . $e->getMessage(), null, 500);
        }

        $grnNumber = $result['grn_number'];
        $poId = (int)$result['po_id'];
        $poCode = 'PO-' . str_pad((string)$poId, 5, '0', STR_PAD_LEFT);
        $totalAccepted = (int)$result['total_accepted'];
        $totalRejected = (int)$result['total_rejected'];
        $totalQuarantined = (int)$result['total_quarantined'];

        auditLog(
            $this->conn,
            $actor,
            'INSPECTION_COMPLETED',
            'stock_receiving',
            $receivingId,
            $grnNumber . ' inspected: ' . $totalAccepted . ' accepted, ' . $totalRejected . ' rejected, ' . $totalQuarantined . ' quarantined. Usable stock posted.'
        );

        // Check and notify low/critical stock updates
        if (!empty($result['accepted_product_ids']) && function_exists('checkAndNotifyLowStock')) {
            checkAndNotifyLowStock($this->conn, $result['accepted_product_ids'], $actor);
        }

        sendResponse(true, 'Inspection completed and accepted goods posted to inventory for ' . $grnNumber . '.', array(
            'receiving_id' => $receivingId,
            'grn_number' => $grnNumber,
            'status' => 'Posted',
            'inspection_status' => $result['inspection_status'],
            'total_accepted' => $totalAccepted,
            'total_rejected' => $totalRejected,
            'total_quarantined' => $totalQuarantined,
            'po_status' => $result['po_status'],
            'po_order_status' => $result['po_order_status'],
            'po_receiving_status' => $result['po_receiving_status'],
            'po_inspection_status' => $result['po_inspection_status']
        ));
    }

    private function getAllStockReceiving($mode = 'all') {
        $whereSql = '';
        if ($mode === 'pending_inspection') {
            $whereSql = "WHERE COALESCE(r.status, 'Posted') = 'Pending Inspection'";
        }

        $s = $this->conn->query(
            "SELECT r.receiving_id,
                    COALESCE(r.grn_number, CONCAT('GRN-', LPAD(r.receiving_id, 5, '0'))) AS grn_number,
                    COALESCE(r.grn_number, CONCAT('GRN-', LPAD(r.receiving_id, 5, '0')), CONCAT('RCV-', LPAD(r.receiving_id, 4, '0'))) AS receiving_code,
                    r.po_id,
                    COALESCE(po.po_code, CONCAT('PO-', LPAD(r.po_id, 5, '0'))) AS po_code,
                    po.pr_id,
                    CASE WHEN po.pr_id IS NOT NULL THEN COALESCE(pr.pr_code, CONCAT('PR-', LPAD(po.pr_id, 4, '0'))) ELSE NULL END AS pr_code,
                    po.status AS po_status,
                    po.order_status AS po_order_status,
                    po.receiving_status AS po_receiving_status,
                    po.inspection_status AS po_inspection_status,
                    s.supplier_name,
                    CONCAT(u.first_name, ' ', u.last_name) AS received_by,
                    r.receiving_date,
                    r.dr_number,
                    r.remarks,
                    COALESCE(r.status, 'Posted') AS status,
                    COALESCE(r.inspection_status, 'Passed') AS inspection_status,
                    r.inspection_date,
                    CASE WHEN u_insp.user_id IS NOT NULL THEN CONCAT(u_insp.first_name, ' ', u_insp.last_name) ELSE NULL END AS inspected_by_name,
                    r.posted_at,
                    (SELECT COUNT(*) FROM stock_receiving_detail d WHERE d.receiving_id = r.receiving_id) AS item_count,
                    COALESCE((SELECT SUM(d.quantity_received) FROM stock_receiving_detail d WHERE d.receiving_id = r.receiving_id), 0) AS total_received_qty,
                    COALESCE((SELECT SUM(d.quantity_received) FROM stock_receiving_detail d WHERE d.receiving_id = r.receiving_id), 0) AS total_received,
                    COALESCE((SELECT SUM(COALESCE(d.quantity_accepted, d.quantity_received)) FROM stock_receiving_detail d WHERE d.receiving_id = r.receiving_id), 0) AS total_accepted_qty,
                    COALESCE((SELECT SUM(COALESCE(d.quantity_rejected, d.quantity_damaged, 0)) FROM stock_receiving_detail d WHERE d.receiving_id = r.receiving_id), 0) AS total_rejected_qty,
                    COALESCE((SELECT SUM(COALESCE(d.quantity_quarantined, 0)) FROM stock_receiving_detail d WHERE d.receiving_id = r.receiving_id), 0) AS total_quarantined_qty
             FROM stock_receiving r
             INNER JOIN purchase_order po ON r.po_id = po.po_id
             INNER JOIN supplier s ON po.supplier_id = s.supplier_id
             INNER JOIN users u ON r.user_id = u.user_id
             LEFT JOIN users u_insp ON r.inspected_by = u_insp.user_id
             LEFT JOIN purchase_request pr ON pr.pr_id = po.pr_id
             $whereSql
             ORDER BY r.receiving_id DESC"
        );
        return $s->fetchAll();
    }

    private function getReceivingDetail($receivingId) {
        $s = $this->conn->prepare(
            "SELECT r.receiving_id,
                    COALESCE(r.grn_number, CONCAT('GRN-', LPAD(r.receiving_id, 5, '0'))) AS grn_number,
                    COALESCE(r.grn_number, CONCAT('GRN-', LPAD(r.receiving_id, 5, '0')), CONCAT('RCV-', LPAD(r.receiving_id, 4, '0'))) AS receiving_code,
                    r.po_id,
                    COALESCE(po.po_code, CONCAT('PO-', LPAD(r.po_id, 5, '0'))) AS po_code,
                    po.pr_id,
                    CASE WHEN po.pr_id IS NOT NULL THEN COALESCE(pr.pr_code, CONCAT('PR-', LPAD(po.pr_id, 4, '0'))) ELSE NULL END AS pr_code,
                    po.order_date,
                    po.status AS po_status,
                    po.order_status AS po_order_status,
                    po.receiving_status AS po_receiving_status,
                    po.inspection_status AS po_inspection_status,
                    po.authorization_status AS po_authorization_status,
                    s.supplier_name,
                    CONCAT(u.first_name, ' ', u.last_name) AS received_by,
                    r.receiving_date,
                    r.dr_number,
                    r.remarks,
                    COALESCE(r.status, 'Posted') AS status,
                    COALESCE(r.inspection_status, 'Passed') AS inspection_status,
                    r.inspection_date,
                    r.inspected_by,
                    CASE WHEN u_insp.user_id IS NOT NULL THEN CONCAT(u_insp.first_name, ' ', u_insp.last_name) ELSE NULL END AS inspected_by_name,
                    r.inspection_notes,
                    r.posted_at,
                    r.posted_by,
                    CASE WHEN u_post.user_id IS NOT NULL THEN CONCAT(u_post.first_name, ' ', u_post.last_name) ELSE NULL END AS posted_by_name,
                    r.created_at
             FROM stock_receiving r
             INNER JOIN purchase_order po ON r.po_id = po.po_id
             INNER JOIN supplier s ON po.supplier_id = s.supplier_id
             INNER JOIN users u ON r.user_id = u.user_id
             LEFT JOIN users u_insp ON r.inspected_by = u_insp.user_id
             LEFT JOIN users u_post ON r.posted_by = u_post.user_id
             LEFT JOIN purchase_request pr ON pr.pr_id = po.pr_id
             WHERE r.receiving_id = :id
             LIMIT 1"
        );
        $s->execute(array(':id' => $receivingId));
        $hdr = $s->fetch();
        if (!$hdr) {
            return null;
        }

        $d = $this->conn->prepare(
            "SELECT d.receiving_detail_id, d.po_detail_id, d.product_id, p.product_name, p.unit_measure,
                    COALESCE(p.max_stock, 100) AS max_stock,
                    d.quantity_received,
                    COALESCE(d.quantity_accepted, d.quantity_received) AS quantity_accepted,
                    COALESCE(d.quantity_rejected, d.quantity_damaged, 0) AS quantity_rejected,
                    COALESCE(d.quantity_quarantined, 0) AS quantity_quarantined,
                    COALESCE(d.quantity_damaged, 0) AS quantity_damaged,
                    d.rejection_reason,
                    d.quarantine_reason,
                    d.discrepancy_note,
                    COALESCE(d.inspection_status, 'Passed') AS inspection_status,
                    COALESCE(pod.quantity_ordered, d.quantity_received) AS quantity_ordered,
                    COALESCE(pod.unit_cost, p.unit_price) AS unit_cost
             FROM stock_receiving_detail d
             INNER JOIN product p ON p.product_id = d.product_id
             LEFT JOIN purchase_order_detail pod ON pod.po_detail_id = d.po_detail_id
             WHERE d.receiving_id = :id
             ORDER BY d.receiving_detail_id ASC"
        );
        $d->execute(array(':id' => $receivingId));
        $rawItems = $d->fetchAll();
        foreach ($rawItems as &$it) {
            $cur = (int)productStock($this->conn, (int)$it['product_id']);
            $maxC = (int)$it['max_stock'];
            if ($maxC <= 0) $maxC = 100;
            $it['current_usable_stock'] = $cur;
            $it['remaining_capacity'] = max(0, $maxC - $cur);
        }
        unset($it);
        $hdr['items'] = $rawItems;
        return $hdr;
    }

    private function getPurchaseOrderItemsForReceiving($poId) {
        $s = $this->conn->prepare(
            "SELECT d.po_detail_id, d.product_id, p.product_name, p.unit_measure,
                    d.quantity_ordered,
                    d.quantity_received AS quantity_already_received,
                    d.quantity_received AS quantity_received,
                    GREATEST(0, d.quantity_ordered - d.quantity_received) AS quantity_outstanding,
                    GREATEST(0, d.quantity_ordered - d.quantity_received) AS outstanding_qty,
                    COALESCE((
                        SELECT SUM(srd.quantity_accepted)
                        FROM stock_receiving_detail srd
                        INNER JOIN stock_receiving sr ON sr.receiving_id = srd.receiving_id
                        WHERE srd.po_detail_id = d.po_detail_id AND sr.status = 'Posted'
                    ), 0) AS quantity_accepted,
                    COALESCE((
                        SELECT SUM(srd.quantity_rejected)
                        FROM stock_receiving_detail srd
                        INNER JOIN stock_receiving sr ON sr.receiving_id = srd.receiving_id
                        WHERE srd.po_detail_id = d.po_detail_id AND sr.status = 'Posted'
                    ), 0) AS quantity_rejected,
                    d.unit_cost
             FROM purchase_order_detail d
             INNER JOIN product p ON d.product_id = p.product_id
             WHERE d.po_id = :id
             ORDER BY d.po_detail_id ASC"
        );
        $s->bindParam(':id', $poId, PDO::PARAM_INT);
        $s->execute();
        return $s->fetchAll();
    }

    /**
     * Workflow A DB Operations:
     * - Validates PO is Authorized & Issued
     * - Checks against remaining outstanding PO quantities to prevent unauthorized over-receiving
     * - Generates unique Goods Receipt Note (GRN) number
     * - Saves receiving record in 'Pending Inspection' state
     * - Updates PO received quantities and progress
     * - Preserves PR separate statuses (does NOT mark PR fulfilled)
     */
    private function createGoodsReceiptNote($poId, $date, $drNumber, $remarks, $clientToken, array $items, array $user, $autoInspect = false) {
        $this->conn->beginTransaction();
        try {
            // 1. Idempotency check (prevent duplicate GRN submission)
            if ($clientToken !== '') {
                $tokChk = $this->conn->prepare("SELECT receiving_id, grn_number FROM stock_receiving WHERE client_token = :tok LIMIT 1");
                $tokChk->execute(array(':tok' => substr($clientToken, 0, 64)));
                $existing = $tokChk->fetch();
                if ($existing) {
                    throw new RuntimeException('This receiving transaction has already been recorded under ' . ($existing['grn_number'] ?: ('RCV-' . $existing['receiving_id'])) . '.');
                }
            }

            // 2. Lock PO header and verify eligibility
            $q = $this->conn->prepare(
                "SELECT po.po_id, po.po_code, po.pr_id, po.user_id, po.supplier_id, po.status,
                        po.order_status, po.receiving_status, po.authorization_status, pr.requester_id
                 FROM purchase_order po
                 LEFT JOIN purchase_request pr ON pr.pr_id = po.pr_id
                 WHERE po.po_id = :id
                 FOR UPDATE"
            );
            $q->execute(array(':id' => $poId));
            $po = $q->fetch();

            if (!$po) {
                throw new InvalidArgumentException('Purchase order #' . $poId . ' not found.');
            }

            // Critical rule: Draft, Pending Approval, Cancelled, and Closed POs cannot be received
            $authStatus = isset($po['authorization_status']) ? (string)$po['authorization_status'] : 'Authorized';
            $ordStatus = isset($po['order_status']) ? (string)$po['order_status'] : $po['status'];
            $st = (string)$po['status'];

            if ($authStatus !== 'Authorized') {
                throw new InvalidArgumentException('Purchase order ' . ($po['po_code'] ?: ('PO-' . $poId)) . ' is not authorized (authorization_status: ' . $authStatus . '). Only Authorized POs can be received.');
            }
            if (in_array($ordStatus, array('Draft', 'Pending Approval', 'Pending PO Approval'), true) || $st === 'Draft') {
                throw new InvalidArgumentException('Draft or unapproved purchase orders cannot be received.');
            }
            if (in_array($ordStatus, array('Cancelled', 'Closed', 'Closed Short'), true) || in_array($st, array('Cancelled', 'Closed'), true)) {
                throw new InvalidArgumentException('Purchase order ' . ($po['po_code'] ?: ('PO-' . $poId)) . ' is closed or cancelled.');
            }

            // 3. Lock PO detail rows and validate quantities
            $qLines = $this->conn->prepare(
                "SELECT pod.po_detail_id, pod.product_id, pod.quantity_ordered, pod.quantity_received, p.product_name
                 FROM purchase_order_detail pod
                 INNER JOIN product p ON p.product_id = pod.product_id
                 WHERE pod.po_id = :id
                 FOR UPDATE"
            );
            $qLines->execute(array(':id' => $poId));
            $poLines = array();
            foreach ($qLines->fetchAll() as $ln) {
                $poLines[(int)$ln['product_id']] = $ln;
            }

            if (empty($poLines)) {
                throw new InvalidArgumentException('Purchase order has no line items.');
            }

            $chkProd = $this->conn->prepare("SELECT product_id FROM product WHERE product_id = :id FOR UPDATE");
            foreach ($items as $pid => $it) {
                if (!isset($poLines[$pid])) {
                    throw new InvalidArgumentException('Product #' . (int)$pid . ' does not belong to this purchase order.');
                }
                $ln = $poLines[$pid];
                $outstanding = max(0, (int)$ln['quantity_ordered'] - (int)$ln['quantity_received']);
                $recvNow = (int)$it['quantity_received'];

                // Over-receiving prevention without authorization
                if ($recvNow > $outstanding) {
                    throw new InvalidArgumentException(
                        'Cannot receive ' . $recvNow . ' unit(s) of "' . $ln['product_name']
                        . '" — only ' . $outstanding . ' unit(s) remain outstanding on this purchase order.'
                    );
                }

                $chkProd->execute(array(':id' => (int)$pid));
                if (!$chkProd->fetch()) {
                    throw new InvalidArgumentException('Product #' . (int)$pid . ' not found in catalog.');
                }

                if ($autoInspect && $recvNow > 0) {
                    $curStock = (int)productStock($this->conn, $pid);
                    $pRow = $this->conn->query("SELECT max_stock FROM product WHERE product_id = " . (int)$pid)->fetch();
                    $mCap = (int)($pRow['max_stock'] ?? 100);
                    if ($mCap <= 0) $mCap = 100;
                    $rCap = max(0, $mCap - $curStock);
                    if ($recvNow > $rCap) {
                        throw new InvalidArgumentException(
                            'Maximum stock capacity reached. Cannot add more stock to this product.'
                        );
                    }
                }
            }

            $initialStatus = $autoInspect ? 'Posted' : 'Pending Inspection';
            $initialInspStatus = $autoInspect ? 'Passed' : 'Pending Inspection';

            // 4. Insert receiving header
            $insHdr = $this->conn->prepare(
                "INSERT INTO stock_receiving (po_id, user_id, receiving_date, dr_number, remarks, client_token, status, inspection_status)
                 VALUES (:po, :u, :d, :dr, :rem, :tok, :st, :ist)"
            );
            $insHdr->execute(array(
                ':po' => $poId,
                ':u' => (int)$user['user_id'],
                ':d' => $date,
                ':dr' => $drNumber !== '' ? $drNumber : null,
                ':rem' => $remarks !== '' ? $remarks : null,
                ':tok' => $clientToken !== '' ? substr($clientToken, 0, 64) : null,
                ':st' => $initialStatus,
                ':ist' => $initialInspStatus
            ));
            $receivingId = (int)$this->conn->lastInsertId();

            // 5. Generate and assign unique GRN number
            $grnNumber = 'GRN-' . str_pad((string)$receivingId, 5, '0', STR_PAD_LEFT);
            $updGrn = $this->conn->prepare("UPDATE stock_receiving SET grn_number = :grn WHERE receiving_id = :id");
            $updGrn->execute(array(':grn' => $grnNumber, ':id' => $receivingId));

            // 6. Insert line items and update PO detail quantity_received
            $insDet = $this->conn->prepare(
                "INSERT INTO stock_receiving_detail
                    (receiving_id, po_detail_id, product_id, quantity_received, quantity_accepted, quantity_rejected, quantity_quarantined, quantity_damaged, discrepancy_note, rejection_reason, quarantine_reason, inspection_status)
                 VALUES (:r, :pod, :p, :q, :acc, :rej, :quar, :dmg, :note, :r_rsn, :q_rsn, :ist)"
            );
            $updPod = $this->conn->prepare(
                "UPDATE purchase_order_detail
                 SET quantity_received = quantity_received + :q
                 WHERE po_detail_id = :pod"
            );

            $insStockMove = $this->conn->prepare(
                "INSERT INTO stock_movement (product_id, movement_type, direction, quantity, reference_no, reference_type, reference_id, user_id, movement_date, notes)
                 VALUES (:pid, 'Stock Receiving', 'IN', :qty, :ref_no, 'stock_receiving', :ref_id, :uid, :mdate, :notes)"
            );

            $hasDiscrepancy = false;
            foreach ($items as $pid => $it) {
                $podId = (int)$poLines[$pid]['po_detail_id'];
                $qRecv = (int)$it['quantity_received'];
                $qDmg = (int)$it['quantity_damaged'];
                $qQuar = (int)$it['quantity_quarantined'];
                $note = $it['discrepancy_note'] !== '' ? $it['discrepancy_note'] : null;
                $rejRsn = $it['rejection_reason'] !== '' ? $it['rejection_reason'] : null;
                $quarRsn = $it['quarantine_reason'] !== '' ? $it['quarantine_reason'] : null;

                if ($autoInspect) {
                    $qAccepted = max(0, $qRecv - $qDmg - $qQuar);
                    $lineInspStatus = ($qDmg > 0 || $qQuar > 0) ? 'Partial' : 'Passed';
                    if ($qDmg > 0 || $qQuar > 0) {
                        $hasDiscrepancy = true;
                    }
                } else {
                    $qAccepted = 0;
                    $lineInspStatus = 'Pending';
                }

                $insDet->execute(array(
                    ':r' => $receivingId,
                    ':pod' => $podId,
                    ':p' => (int)$pid,
                    ':q' => $qRecv,
                    ':acc' => $qAccepted,
                    ':rej' => $qDmg,
                    ':quar' => $qQuar,
                    ':dmg' => $qDmg,
                    ':note' => $note,
                    ':r_rsn' => $rejRsn,
                    ':q_rsn' => $quarRsn,
                    ':ist' => $lineInspStatus
                ));

                if ($qRecv > 0) {
                    $updPod->execute(array(':q' => $qRecv, ':pod' => $podId));
                }

                if ($autoInspect && $qAccepted > 0) {
                    $insStockMove->execute(array(
                        ':pid' => (int)$pid,
                        ':qty' => $qAccepted,
                        ':ref_no' => $grnNumber,
                        ':ref_id' => $receivingId,
                        ':uid' => (int)$user['user_id'],
                        ':mdate' => $date,
                        ':notes' => 'Accepted into usable warehouse stock under ' . $grnNumber
                    ));
                }
            }

            if ($autoInspect) {
                $updAuto = $this->conn->prepare(
                    "UPDATE stock_receiving
                     SET inspection_date = :idate,
                         inspected_by = :uid,
                         inspection_status = :ist,
                         posted_at = NOW(),
                         posted_by = :puid
                     WHERE receiving_id = :id"
                );
                $updAuto->execute(array(
                    ':idate' => $date,
                    ':uid' => (int)$user['user_id'],
                    ':ist' => $hasDiscrepancy ? 'Partial' : 'Passed',
                    ':puid' => (int)$user['user_id'],
                    ':id' => $receivingId
                ));
            }

            // 7. Update PO status and calculate outstanding delivery progress
            $sumStmt = $this->conn->prepare(
                "SELECT
                    SUM(quantity_ordered) AS total_ord,
                    SUM(quantity_received) AS total_rcv,
                    SUM(CASE WHEN quantity_received < quantity_ordered THEN 1 ELSE 0 END) AS incomplete_lines
                 FROM purchase_order_detail
                 WHERE po_id = :id"
            );
            $sumStmt->execute(array(':id' => $poId));
            $totals = $sumStmt->fetch();

            $incompleteLines = (int)$totals['incomplete_lines'];
            $totalOrd = (int)$totals['total_ord'];
            $totalRcv = (int)$totals['total_rcv'];
            $outstandingRemaining = max(0, $totalOrd - $totalRcv);

            if ($incompleteLines === 0 && $totalRcv > 0) {
                $newPoStatus = 'Received';
                $newOrderStatus = 'Fully Received';
                $newRecvStatus = 'Fully Received';
            } elseif ($totalRcv > 0) {
                $newPoStatus = 'Partially Received';
                $newOrderStatus = 'Partially Received';
                $newRecvStatus = 'Partially Received';
            } else {
                $newPoStatus = 'Issued';
                $newOrderStatus = 'Issued';
                $newRecvStatus = 'Awaiting Delivery';
            }

            $poInspStatus = $autoInspect
                ? ($hasDiscrepancy ? 'Partial Discrepancy / Damaged' : 'Passed')
                : 'Pending Inspection';

            $updPo = $this->conn->prepare(
                "UPDATE purchase_order
                 SET status = :st,
                     order_status = :ost,
                     receiving_status = :rst,
                     inspection_status = :ist
                 WHERE po_id = :id"
            );
            $updPo->execute(array(
                ':st'  => $newPoStatus,
                ':ost' => $newOrderStatus,
                ':rst' => $newRecvStatus,
                ':ist' => $poInspStatus,
                ':id'  => $poId
            ));

            // 8. Purchase Request Synchronization:
            // CRITICAL RULE: Linked PRs must NOT automatically become Fulfilled merely because PO was received.
            // PR remains outstanding ('Approved' / 'Awaiting Release' / 'Partially Fulfilled') until authorized stock release occurs.
            $prId = !empty($po['pr_id']) ? (int)$po['pr_id'] : 0;
            if ($prId > 0) {
                $hist = $this->conn->prepare(
                    "INSERT INTO purchase_request_history (pr_id, user_id, action, from_status, to_status, comment)
                     VALUES (:pr_id, :uid, 'RECEIVING_RECORDED', NULL, NULL, :comment)"
                );
                $hist->execute(array(
                    ':pr_id' => $prId,
                    ':uid' => (int)$user['user_id'],
                    ':comment' => $grnNumber . ' recorded against PO-' . str_pad((string)$poId, 5, '0', STR_PAD_LEFT) . ' (' . $newPoStatus . ', goods in warehouse awaiting release)'
                ));
            }

            $this->conn->commit();
            return array(
                'receiving_id' => $receivingId,
                'grn_number' => $grnNumber,
                'status' => $initialStatus,
                'po_status' => $newPoStatus,
                'outstanding_qty' => $outstandingRemaining,
                'pr_id' => $prId,
                'requester_id' => !empty($po['requester_id']) ? (int)$po['requester_id'] : 0,
                'po_user_id' => (int)$po['user_id'],
                'has_discrepancy' => $hasDiscrepancy
            );
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Workflow B DB Operations:
     * - Locks GRN record and verifies it has not already been posted (duplicate posting blocked)
     * - Validates that for each line: Accepted + Rejected + Quarantined == Delivered
     * - Updates breakdown quantities, inspection notes, reasons, and marks GRN as 'Posted'
     * - Posts accepted quantities into usable inventory
     * - Inserts stock movement records for accepted units
     * - Updates PO inspection progress
     */
    private function completeInspectionAndPost($receivingId, $inspDate, $notes, array $itemBreakdown, array $actor) {
        $this->conn->beginTransaction();
        try {
            // 1. Lock stock_receiving header
            $sHdr = $this->conn->prepare(
                "SELECT sr.receiving_id, sr.grn_number, sr.po_id, sr.status, sr.inspection_status, po.status AS po_status, po.supplier_id
                 FROM stock_receiving sr
                 INNER JOIN purchase_order po ON po.po_id = sr.po_id
                 WHERE sr.receiving_id = :id
                 FOR UPDATE"
            );
            $sHdr->execute(array(':id' => $receivingId));
            $rcv = $sHdr->fetch();
            if (!$rcv) {
                throw new InvalidArgumentException('Goods Receipt Note #' . $receivingId . ' not found.');
            }

            // Duplicate posting check
            if ($rcv['status'] === 'Posted') {
                throw new RuntimeException('Goods Receipt Note ' . ($rcv['grn_number'] ?: ('#' . $receivingId)) . ' has already been inspected and posted to inventory.');
            }

            $grnNumber = $rcv['grn_number'] ?: ('GRN-' . str_pad((string)$receivingId, 5, '0', STR_PAD_LEFT));
            $poId = (int)$rcv['po_id'];

            // 2. Lock and fetch all detail rows for this receiving record
            $sDet = $this->conn->prepare(
                "SELECT srd.receiving_detail_id, srd.product_id, srd.quantity_received, p.product_name
                 FROM stock_receiving_detail srd
                 INNER JOIN product p ON p.product_id = srd.product_id
                 WHERE srd.receiving_id = :id
                 FOR UPDATE"
            );
            $sDet->execute(array(':id' => $receivingId));
            $lines = $sDet->fetchAll();
            if (empty($lines)) {
                throw new InvalidArgumentException('No items found on Goods Receipt Note ' . $grnNumber . '.');
            }

            $linesByDet = array();
            $linesByProd = array();
            foreach ($lines as $ln) {
                $linesByDet[(int)$ln['receiving_detail_id']] = $ln;
                $linesByProd[(int)$ln['product_id']] = $ln;
            }

            // Prepared statements
            $updDet = $this->conn->prepare(
                "UPDATE stock_receiving_detail
                 SET quantity_accepted = :acc,
                     quantity_rejected = :rej,
                     quantity_quarantined = :quar,
                     quantity_damaged = :dmg,
                     rejection_reason = :r_rsn,
                     quarantine_reason = :q_rsn,
                     discrepancy_note = :dnote,
                     inspection_status = :ist
                 WHERE receiving_detail_id = :id"
            );

            $insStockMove = $this->conn->prepare(
                "INSERT INTO stock_movement (product_id, movement_type, direction, quantity, reference_no, reference_type, reference_id, user_id, movement_date, notes)
                 VALUES (:pid, 'Stock Receiving', 'IN', :qty, :ref_no, 'stock_receiving', :ref_id, :uid, :mdate, :notes)"
            );

            $chkProd = $this->conn->prepare("SELECT product_id, max_stock, product_name FROM product WHERE product_id = :pid FOR UPDATE");

            $totalAcceptedAll = 0;
            $totalRejectedAll = 0;
            $totalQuarantinedAll = 0;
            $acceptedProductIds = array();
            $hasDiscrepancy = false;

            // 3. Process and strictly validate each line item
            foreach ($lines as $ln) {
                $detId = (int)$ln['receiving_detail_id'];
                $pid = (int)$ln['product_id'];
                $qtyDelivered = (int)$ln['quantity_received'];
                $prodName = $ln['product_name'];

                $input = null;
                if (isset($itemBreakdown['det_' . $detId])) {
                    $input = $itemBreakdown['det_' . $detId];
                } elseif (isset($itemBreakdown['prod_' . $pid])) {
                    $input = $itemBreakdown['prod_' . $pid];
                }

                if (!$input) {
                    throw new InvalidArgumentException('Missing inspection quantities for item "' . $prodName . '". All items must be accounted for.');
                }

                $acc = (int)$input['quantity_accepted'];
                $rej = (int)$input['quantity_rejected'];
                $quar = (int)$input['quantity_quarantined'];
                $rejReason = !empty($input['rejection_reason']) ? trim($input['rejection_reason']) : null;
                $quarReason = !empty($input['quarantine_reason']) ? trim($input['quarantine_reason']) : null;
                $note = !empty($input['discrepancy_note']) ? trim($input['discrepancy_note']) : null;

                // CRITICAL RULE: Validation that all delivered quantities are accounted for
                $sumAccounted = $acc + $rej + $quar;
                if ($sumAccounted !== $qtyDelivered) {
                    throw new InvalidArgumentException(
                        'Inspection total mismatch for "' . $prodName . '": Accepted (' . $acc . ') + Rejected (' . $rej . ') + Quarantined (' . $quar . ') = ' . $sumAccounted . ' unit(s), which does not equal delivered quantity (' . $qtyDelivered . '). All received units must be accounted for.'
                    );
                }

                if ($rej > 0 || $quar > 0) {
                    $hasDiscrepancy = true;
                }

                $lineInspStatus = 'Passed';
                if ($acc === 0 && $rej > 0 && $quar === 0) {
                    $lineInspStatus = 'Rejected';
                } elseif ($acc === 0 && $quar > 0 && $rej === 0) {
                    $lineInspStatus = 'Quarantined';
                } elseif ($rej > 0 || $quar > 0) {
                    $lineInspStatus = 'Partial';
                }

                $chkProd->execute(array(':pid' => $pid));
                $prodRow = $chkProd->fetch();
                $maxCapacity = (int)($prodRow['max_stock'] ?? 100);
                if ($maxCapacity <= 0) $maxCapacity = 100;
                $currentUsableStock = (int)productStock($this->conn, $pid);
                $remainingCapacity = max(0, $maxCapacity - $currentUsableStock);

                // Enforce Maximum Stock Capacity limit
                if ($acc > 0 && $remainingCapacity <= 0) {
                    throw new InvalidArgumentException(
                        'Maximum stock capacity reached. Cannot add more stock to this product.'
                    );
                }
                if ($acc > $remainingCapacity) {
                    throw new InvalidArgumentException(
                        'Maximum stock capacity reached. Cannot add more stock to this product. ' .
                        'Only ' . $remainingCapacity . ' unit(s) can fit within the remaining capacity for "' . $prodName . '" ' .
                        '(Current Stock: ' . $currentUsableStock . ', Max Capacity: ' . $maxCapacity . '). ' .
                        'Excess ' . ($acc - $remainingCapacity) . ' unit(s) cannot be posted to usable inventory and must be quarantined or rejected for review.'
                    );
                }

                $updDet->execute(array(
                    ':acc' => $acc,
                    ':rej' => $rej,
                    ':quar' => $quar,
                    ':dmg' => $rej,
                    ':r_rsn' => $rejReason,
                    ':q_rsn' => $quarReason,
                    ':dnote' => $note,
                    ':ist' => $lineInspStatus,
                    ':id' => $detId
                ));

                // Stock Movement records created ONLY for accepted quantities
                if ($acc > 0) {
                    $insStockMove->execute(array(
                        ':pid' => $pid,
                        ':qty' => $acc,
                        ':ref_no' => $grnNumber,
                        ':ref_id' => $receivingId,
                        ':uid' => (int)$actor['user_id'],
                        ':mdate' => $inspDate,
                        ':notes' => 'Accepted into usable inventory from ' . $grnNumber
                    ));
                    $acceptedProductIds[] = $pid;
                }

                $totalAcceptedAll += $acc;
                $totalRejectedAll += $rej;
                $totalQuarantinedAll += $quar;
            }

            // 4. Update stock_receiving header to Posted
            $overallInspStatus = $hasDiscrepancy ? 'Partial' : 'Passed';
            $updHdr = $this->conn->prepare(
                "UPDATE stock_receiving
                 SET status = 'Posted',
                     inspection_status = :ist,
                     inspection_date = :idate,
                     inspected_by = :uid,
                     inspection_notes = :notes,
                     posted_at = NOW(),
                     posted_by = :puid
                 WHERE receiving_id = :id"
            );
            $updHdr->execute(array(
                ':ist' => $overallInspStatus,
                ':idate' => $inspDate,
                ':uid' => (int)$actor['user_id'],
                ':notes' => $notes !== '' ? $notes : null,
                ':puid' => (int)$actor['user_id'],
                ':id' => $receivingId
            ));

            // 5. Update PO inspection status
            $poChk = $this->conn->prepare(
                "SELECT
                    (SELECT COUNT(*) FROM stock_receiving WHERE po_id = :po1 AND status = 'Pending Inspection') AS pending_grns,
                    (SELECT SUM(srd.quantity_rejected) FROM stock_receiving_detail srd INNER JOIN stock_receiving sr ON sr.receiving_id = srd.receiving_id WHERE sr.po_id = :po2) AS total_rej,
                    (SELECT SUM(srd.quantity_quarantined) FROM stock_receiving_detail srd INNER JOIN stock_receiving sr ON sr.receiving_id = srd.receiving_id WHERE sr.po_id = :po3) AS total_quar
                 FROM DUAL"
            );
            $poChk->execute(array(':po1' => $poId, ':po2' => $poId, ':po3' => $poId));
            $poStats = $poChk->fetch();

            $poNewInspStatus = 'Passed';
            if ((int)$poStats['pending_grns'] > 0) {
                $poNewInspStatus = 'Pending Inspection';
            } elseif ((int)$poStats['total_rej'] > 0 || (int)$poStats['total_quar'] > 0) {
                $poNewInspStatus = 'Partial Discrepancy / Rejected';
            }

            $updPo = $this->conn->prepare("UPDATE purchase_order SET inspection_status = :ist WHERE po_id = :id");
            $updPo->execute(array(':ist' => $poNewInspStatus, ':id' => $poId));

            // Re-fetch PO to return fresh statuses
            $poRefresh = $this->conn->prepare("SELECT status, order_status, receiving_status, inspection_status FROM purchase_order WHERE po_id = :id");
            $poRefresh->execute(array(':id' => $poId));
            $freshPo = $poRefresh->fetch();

            $this->conn->commit();

            return array(
                'receiving_id' => $receivingId,
                'grn_number' => $grnNumber,
                'po_id' => $poId,
                'inspection_status' => $overallInspStatus,
                'total_accepted' => $totalAcceptedAll,
                'total_rejected' => $totalRejectedAll,
                'total_quarantined' => $totalQuarantinedAll,
                'accepted_product_ids' => array_unique($acceptedProductIds),
                'po_status' => $freshPo['status'],
                'po_order_status' => $freshPo['order_status'],
                'po_receiving_status' => $freshPo['receiving_status'],
                'po_inspection_status' => $freshPo['inspection_status']
            );
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $e;
        }
    }
}

$conn = getConnection();
$method = $_SERVER['REQUEST_METHOD'];

$api = new StockReceivingApi($conn);
$api->handleRequest($method);
