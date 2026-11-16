<?php
require_once '../config/db.php';
sendJsonHeaders();

class PurchaseRequestApi {
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

    /**
     * Store Requesters are isolated to their own requests unless they hold cross-system roles/permissions.
     */
    private function isScopedToOwnRequests(array $user) {
        $roleId = isset($user['role_id']) ? (int)$user['role_id'] : 0;
        $roleName = strtolower(trim(isset($user['role_name']) ? (string)$user['role_name'] : ''));
        if ($roleId === 1 || $roleName === 'administrator') {
            return false;
        }
        if (in_array($roleName, array('manager', 'purchasing officer', 'purchase officer', 'warehouse staff', 'warehouse officer'), true)) {
            return false;
        }
        if (userCan($roleId, 'request_approval', 'view')
            || userCan($roleId, 'purchase_order', 'view')
            || userCan($roleId, 'stock_receiving', 'view')) {
            return false;
        }
        return true;
    }

    private function normalizeUrgency($rawUrgency) {
        $val = strtolower(trim((string)$rawUrgency));
        switch ($val) {
            case 'low':
                return 'Low';
            case 'high':
                return 'High';
            case 'urgent':
            case 'critical':
                return 'Urgent';
            case 'normal':
            case 'medium':
            case 'standard':
            default:
                return 'Normal';
        }
    }

    private function deriveApprovalStatus($status) {
        $st = trim((string)$status);
        switch ($st) {
            case 'Draft':
                return 'Draft';
            case 'Pending':
            case 'Pending Approval':
                return 'Pending Approval';
            case 'For Revision':
            case 'Returned for Revision':
                return 'Returned for Revision';
            case 'Approved':
            case 'Partially Ordered':
            case 'Ordered':
            case 'Partially Received':
            case 'Completed':
                return 'Approved';
            case 'Rejected':
                return 'Rejected';
            case 'Cancelled':
                return 'Cancelled';
            default:
                return 'Pending Approval';
        }
    }

    private function deriveFulfillmentStatus($status, $approvedQty, $reservedQty, $releasedQty, $orderedQty, $receivedQty) {
        $st = trim((string)$status);
        switch ($st) {
            case 'Draft':
                return 'Draft';
            case 'Pending':
            case 'Pending Approval':
                return 'Awaiting Approval';
            case 'For Revision':
            case 'Returned for Revision':
                return 'Awaiting Revision';
            case 'Rejected':
                return 'Not Fulfilled';
            case 'Cancelled':
                return 'Cancelled';
            case 'Completed':
                return 'Fulfilled';
        }

        $app = max(0, (int)$approvedQty);
        $res = max(0, (int)$reservedQty);
        $rel = max(0, (int)$releasedQty);
        $ord = max(0, (int)$orderedQty);
        $rec = max(0, (int)$receivedQty);
        $fulfilledUnits = max($rel, $rec);

        if ($app > 0 && $fulfilledUnits >= $app) {
            return 'Fulfilled';
        }
        if ($fulfilledUnits > 0 || $st === 'Partially Received') {
            return 'Partially Fulfilled';
        }
        if ($res > 0) {
            return 'Reserved';
        }
        if ($ord > 0 || in_array($st, array('Partially Ordered', 'Ordered'), true)) {
            return 'On Order';
        }
        return 'Pending Fulfillment';
    }

    private function get() {
        $user = requirePermission(array('purchase_request', 'request_approval', 'purchase_order', 'stock_receiving'), 'view');
        $mode = isset($_GET['mode']) ? (string)$_GET['mode'] : 'all';

        switch ($mode) {
            case 'detail': {
                $prId = validatePositiveInt(isset($_GET['pr_id']) ? $_GET['pr_id'] : 0);
                if ($prId <= 0) {
                    sendResponse(false, 'Invalid purchase request ID.', null, 400);
                }
                $detail = $this->getRequestDetail($prId, $user);
                if ($detail === 'FORBIDDEN') {
                    sendResponse(false, 'Access denied to this purchase request.', null, 403);
                }
                if (!$detail) {
                    sendResponse(false, 'Purchase request not found.', null, 404);
                }
                sendResponse(true, 'Purchase request retrieved', $detail);
                break;
            }
            case 'approved_for_po': {
                requirePermission('purchase_order', 'view');
                sendResponse(true, 'Approved requests ready for purchasing retrieved', $this->getApprovedRequestsForPo());
                break;
            }
            case 'suggestions': {
                $products = allProductsWithMetrics($this->conn, true);
                sendResponse(true, 'Replenishment suggestions retrieved', $products);
                break;
            }
            case 'all':
            default: {
                $statusFilter = isset($_GET['status']) ? trim((string)$_GET['status']) : '';
                sendResponse(true, 'Purchase requests retrieved', $this->getRequests($user, $statusFilter));
                break;
            }
        }
    }

    private function post() {
        $actor = requirePermission('purchase_request', 'manage');
        requireCsrf();

        $body = getRequestBody();
        $purpose = isset($body['purpose']) && is_string($body['purpose']) ? trim($body['purpose']) : '';
        $remarks = isset($body['remarks']) && is_string($body['remarks']) ? trim($body['remarks']) : '';
        $rawReason = isset($body['reason']) && is_string($body['reason']) ? trim($body['reason']) : '';
        $urgency = $this->normalizeUrgency(isset($body['urgency']) ? $body['urgency'] : 'Normal');

        if ($purpose === '' && $rawReason !== '') {
            $purpose = substr($rawReason, 0, 255);
        }
        if ($remarks === '' && $rawReason !== '') {
            $remarks = $rawReason;
        }
        $reason = $rawReason !== '' ? $rawReason : ($remarks !== '' ? $remarks : $purpose);

        $isDraft = !empty($body['save_as_draft'])
            || (isset($body['status']) && strcasecmp(trim((string)$body['status']), 'Draft') === 0)
            || (isset($body['action']) && strcasecmp(trim((string)$body['action']), 'draft') === 0);

        $clientToken = isset($body['client_token']) && is_string($body['client_token'])
            ? substr(trim($body['client_token']), 0, 64)
            : '';

        $rawItems = isset($body['items']) && is_array($body['items']) ? $body['items'] : array();
        $normalized = ensureItemList($rawItems, 'requested_qty');
        if ($normalized === false) {
            // Also accept `quantity` key for convenience
            $normalized = ensureItemList($rawItems, 'quantity');
        }

        if ($normalized === false || strlen($reason) > 500 || strlen($purpose) > 255 || strlen($remarks) > 500) {
            sendResponse(false, 'Please add at least one product with a positive whole-number quantity.', null, 422);
        }

        $storeName = isset($body['store_name']) && is_string($body['store_name']) ? trim($body['store_name']) : 'Main Store';
        if ($storeName === '') {
            $storeName = 'Main Store';
        }

        if ($clientToken !== '') {
            $tokStmt = $this->conn->prepare("SELECT pr_id FROM purchase_request WHERE client_token = :tok LIMIT 1");
            $tokStmt->execute(array(':tok' => $clientToken));
            if ($tokStmt->fetch()) {
                sendResponse(false, 'Duplicate purchase request submission detected.', null, 409);
            }
        }

        $this->conn->beginTransaction();
        try {
            $exceedsSuggestion = false;
            foreach ($normalized as $pid => $qty) {
                $m = productInventoryMetrics($this->conn, $pid, true, 0);
                if (!$m || (int)$m['is_active'] !== 1) {
                    throw new RuntimeException('Selected product #' . (int)$pid . ' is not active.');
                }
                if (!$isDraft) {
                    if ((int)$m['open_unapproved_requests'] > 0) {
                        throw new RuntimeException(
                            '"' . $m['product_name'] . '" already has a pending purchase request awaiting review. Edit the existing request or wait for approval to avoid duplicate ordering.'
                        );
                    }
                    if ((int)$m['additional_qty_needed'] <= 0 && $reason === '') {
                        throw new RuntimeException(
                            '"' . $m['product_name'] . '" already has sufficient stock / on-order replenishment ('
                            . $m['available_stock'] . ' on hand + ' . $m['outstanding_replenishment'] . ' on order vs max ' . $m['max_stock']
                            . '). Provide a purpose or reason if special replenishment is required.'
                        );
                    }
                    if ($qty > (int)$m['additional_qty_needed']) {
                        $exceedsSuggestion = true;
                    }
                }
            }

            if (!$isDraft && $exceedsSuggestion && $reason === '') {
                throw new RuntimeException('A purpose or reason is required when the requested quantity exceeds the suggested additional replenishment needed.');
            }

            $initialStatus = $isDraft ? 'Draft' : 'Pending';
            $initialApprovalStatus = $isDraft ? 'Draft' : 'Pending Approval';
            $initialFulfillmentStatus = $isDraft ? 'Draft' : 'Awaiting Approval';

            $stmt = $this->conn->prepare(
                "INSERT INTO purchase_request
                    (requester_id, store_name, purpose, urgency, status, approval_status, fulfillment_status, reason, remarks, client_token)
                 VALUES
                    (:requester_id, :store, :purpose, :urgency, :status, :approval_status, :fulfillment_status, :reason, :remarks, :client_token)"
            );
            $stmt->execute(array(
                ':requester_id' => (int)$actor['user_id'],
                ':store' => $storeName,
                ':purpose' => $purpose !== '' ? $purpose : ($reason !== '' ? substr($reason, 0, 255) : 'Store Inventory Replenishment'),
                ':urgency' => $urgency,
                ':status' => $initialStatus,
                ':approval_status' => $initialApprovalStatus,
                ':fulfillment_status' => $initialFulfillmentStatus,
                ':reason' => $reason !== '' ? $reason : null,
                ':remarks' => $remarks !== '' ? $remarks : ($reason !== '' ? $reason : null),
                ':client_token' => $clientToken !== '' ? $clientToken : null
            ));
            $prId = (int)$this->conn->lastInsertId();
            $prCode = 'PR-' . str_pad((string)$prId, 4, '0', STR_PAD_LEFT);

            $updCode = $this->conn->prepare("UPDATE purchase_request SET pr_code = :code WHERE pr_id = :id");
            $updCode->execute(array(':code' => $prCode, ':id' => $prId));

            $lineNotes = array();
            if (is_array($rawItems)) {
                foreach ($rawItems as $k => $entry) {
                    if (is_array($entry)) {
                        $pid = isset($entry['product_id']) ? (int)$entry['product_id'] : (int)$k;
                        $note = isset($entry['notes']) ? trim((string)$entry['notes']) : (isset($entry['adjustment_reason']) ? trim((string)$entry['adjustment_reason']) : '');
                        if ($pid > 0 && $note !== '') {
                            $lineNotes[$pid] = substr($note, 0, 255);
                        }
                    }
                }
            }

            $insLine = $this->conn->prepare(
                "INSERT INTO purchase_request_detail (pr_id, product_id, requested_qty, adjustment_reason)
                 VALUES (:pr_id, :product_id, :requested_qty, :adjustment_reason)"
            );
            foreach ($normalized as $pid => $qty) {
                $insLine->execute(array(
                    ':pr_id' => $prId,
                    ':product_id' => (int)$pid,
                    ':requested_qty' => (int)$qty,
                    ':adjustment_reason' => isset($lineNotes[$pid]) ? $lineNotes[$pid] : null
                ));
            }

            if ($isDraft) {
                $this->recordHistory(
                    $prId,
                    (int)$actor['user_id'],
                    'DRAFT_CREATED',
                    null,
                    'Draft',
                    $reason !== '' ? $reason : 'Purchase request saved as draft'
                );
            } else {
                $this->recordHistory(
                    $prId,
                    (int)$actor['user_id'],
                    'SUBMITTED',
                    null,
                    'Pending',
                    $reason !== '' ? $reason : 'Purchase request submitted for manager approval'
                );
            }
            $this->conn->commit();
        } catch (RuntimeException $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            sendResponse(false, $e->getMessage(), null, 422);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            error_log('PurchaseRequest create failed: ' . $e->getMessage());
            sendResponse(false, 'Unable to save purchase request.', null, 500);
        }

        $prCode = 'PR-' . str_pad((string)$prId, 4, '0', STR_PAD_LEFT);
        $actorName = $actor['first_name'] . ' ' . $actor['last_name'];

        if ($isDraft) {
            auditLog($this->conn, $actor, 'PR_DRAFT', 'purchase_request', $prId, $prCode . ' saved as draft by ' . $actorName);
            sendResponse(
                true,
                'Purchase request ' . $prCode . ' saved as draft.',
                array(
                    'pr_id' => $prId,
                    'pr_code' => $prCode,
                    'status' => 'Draft',
                    'approval_status' => 'Draft',
                    'fulfillment_status' => 'Draft'
                )
            );
            return;
        }

        auditLog($this->conn, $actor, 'PR_SUBMIT', 'purchase_request', $prId, $prCode . ' submitted by ' . $actorName);

        // Notify requester, managers, and administrators
        notifyUser(
            $this->conn,
            (int)$actor['user_id'],
            'pr_submitted',
            $prCode . ' Submitted',
            'Your purchase request ' . $prCode . ' has been submitted and is awaiting manager approval.',
            'purchase_request',
            'purchase_request',
            $prId,
            'info'
        );
        notifyUsersWithPermission(
            $this->conn,
            'request_approval',
            'manage',
            'pr_pending_approval',
            'New Request ' . $prCode . ' Awaiting Approval',
            $actorName . ' submitted ' . $prCode . ' (' . count($normalized) . ' item(s), Urgency: ' . $urgency . ') for review.',
            'purchase_request',
            'purchase_request',
            $prId,
            'warning',
            (int)$actor['user_id']
        );
        notifyAdmins(
            $this->conn,
            'pr_submitted',
            'New Purchase Request ' . $prCode,
            $actorName . ' submitted ' . $prCode . ' (' . count($normalized) . ' item(s)).',
            'purchase_request',
            'purchase_request',
            $prId,
            'info',
            (int)$actor['user_id']
        );

        sendResponse(
            true,
            'Purchase request ' . $prCode . ' submitted successfully.',
            array(
                'pr_id' => $prId,
                'pr_code' => $prCode,
                'status' => 'Pending',
                'approval_status' => 'Pending Approval',
                'fulfillment_status' => 'Awaiting Approval'
            )
        );
    }

    private function put() {
        $actor = requireMutationSecurity();
        $body = getRequestBody();
        $action = isset($body['action']) && is_string($body['action']) ? trim($body['action']) : '';
        $prId = validatePositiveInt(isset($body['pr_id']) ? $body['pr_id'] : 0);

        if ($prId <= 0 || $action === '') {
            sendResponse(false, 'Invalid request parameters.', null, 400);
        }

        switch ($action) {
            case 'save_draft':
                $body['save_as_draft'] = true;
                $this->updateAndResubmit($prId, $body, $actor);
                break;
            case 'submit':
                $this->submitDraft($prId, $body, $actor);
                break;
            case 'update':
            case 'resubmit':
                $this->updateAndResubmit($prId, $body, $actor);
                break;
            case 'cancel':
                $this->cancelRequest($prId, $body, $actor);
                break;
            case 'approve':
                $this->approveRequest($prId, $body, $actor);
                break;
            case 'reject':
                $this->rejectRequest($prId, $body, $actor);
                break;
            case 'return_for_revision':
                $this->returnForRevision($prId, $body, $actor);
                break;
            default:
                sendResponse(false, 'Unsupported action.', null, 400);
                break;
        }
    }

    private function submitDraft($prId, array $body, array $actor) {
        requirePermission('purchase_request', 'manage');
        // If items are passed with submit, delegate to updateAndResubmit with save_as_draft = false
        if (isset($body['items']) && is_array($body['items']) && !empty($body['items'])) {
            $body['save_as_draft'] = false;
            $this->updateAndResubmit($prId, $body, $actor);
            return;
        }

        $itemCount = 0;
        $urgency = 'Normal';

        $this->conn->beginTransaction();
        try {
            $q = $this->conn->prepare("SELECT * FROM purchase_request WHERE pr_id = :id FOR UPDATE");
            $q->execute(array(':id' => $prId));
            $pr = $q->fetch();
            if (!$pr) {
                throw new InvalidArgumentException('Purchase request not found.');
            }
            if ((int)$pr['requester_id'] !== (int)$actor['user_id']) {
                $this->conn->rollBack();
                sendResponse(false, 'You can only submit your own draft purchase requests.', null, 403);
            }
            if ($pr['status'] !== 'Draft') {
                throw new RuntimeException('Only Draft purchase requests can be submitted (current status: ' . $pr['status'] . ').');
            }

            $linesStmt = $this->conn->prepare("SELECT product_id, requested_qty FROM purchase_request_detail WHERE pr_id = :id");
            $linesStmt->execute(array(':id' => $prId));
            $lines = $linesStmt->fetchAll();
            if (empty($lines)) {
                throw new InvalidArgumentException('Cannot submit an empty draft purchase request.');
            }
            $itemCount = count($lines);
            $reason = trim((string)($pr['reason'] ?? $pr['purpose'] ?? $pr['remarks'] ?? ''));
            $urgency = $this->normalizeUrgency($pr['urgency'] ?? 'Normal');

            foreach ($lines as $ln) {
                $pid = (int)$ln['product_id'];
                $qty = (int)$ln['requested_qty'];
                $m = productInventoryMetrics($this->conn, $pid, true, $prId);
                if (!$m || (int)$m['is_active'] !== 1) {
                    throw new InvalidArgumentException('Selected product #' . $pid . ' is not active.');
                }
                if ((int)$m['open_unapproved_requests'] > 0) {
                    throw new InvalidArgumentException(
                        '"' . $m['product_name'] . '" already has a pending purchase request awaiting review.'
                    );
                }
                if ((int)$m['additional_qty_needed'] <= 0 && $reason === '') {
                    throw new InvalidArgumentException(
                        '"' . $m['product_name'] . '" already has sufficient stock. Provide a purpose or reason before submitting.'
                    );
                }
            }

            $prCode = 'PR-' . str_pad((string)$prId, 4, '0', STR_PAD_LEFT);
            $upd = $this->conn->prepare(
                "UPDATE purchase_request
                 SET pr_code = :code,
                     status = 'Pending',
                     approval_status = 'Pending Approval',
                     fulfillment_status = 'Awaiting Approval',
                     submitted_at = NOW(),
                     updated_at = NOW()
                 WHERE pr_id = :id AND status = 'Draft'"
            );
            $upd->execute(array(':code' => $prCode, ':id' => $prId));
            if ($upd->rowCount() !== 1) {
                throw new RuntimeException('Draft purchase request was already submitted.');
            }

            $this->recordHistory(
                $prId,
                (int)$actor['user_id'],
                'SUBMITTED',
                'Draft',
                'Pending',
                $reason !== '' ? $reason : 'Draft submitted for manager approval'
            );
            $this->conn->commit();
        } catch (InvalidArgumentException $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            sendResponse(false, $e->getMessage(), null, 422);
        } catch (RuntimeException $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            sendResponse(false, $e->getMessage(), null, 409);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            error_log('PR draft submit failed: ' . $e->getMessage());
            sendResponse(false, 'Unable to submit draft purchase request.', null, 500);
        }

        $prCode = 'PR-' . str_pad((string)$prId, 4, '0', STR_PAD_LEFT);
        $actorName = $actor['first_name'] . ' ' . $actor['last_name'];
        auditLog($this->conn, $actor, 'PR_SUBMIT', 'purchase_request', $prId, $prCode . ' submitted from draft by ' . $actorName);

        notifyUser(
            $this->conn,
            (int)$actor['user_id'],
            'pr_submitted',
            $prCode . ' Submitted',
            'Your purchase request ' . $prCode . ' has been submitted and is awaiting manager approval.',
            'purchase_request',
            'purchase_request',
            $prId,
            'info'
        );
        notifyUsersWithPermission(
            $this->conn,
            'request_approval',
            'manage',
            'pr_pending_approval',
            'New Request ' . $prCode . ' Awaiting Approval',
            $actorName . ' submitted ' . $prCode . ' (' . $itemCount . ' item(s), Urgency: ' . $urgency . ') for review.',
            'purchase_request',
            'purchase_request',
            $prId,
            'warning',
            (int)$actor['user_id']
        );
        notifyAdmins(
            $this->conn,
            'pr_submitted',
            'New Purchase Request ' . $prCode,
            $actorName . ' submitted ' . $prCode . ' (' . $itemCount . ' item(s)).',
            'purchase_request',
            'purchase_request',
            $prId,
            'info',
            (int)$actor['user_id']
        );

        sendResponse(
            true,
            'Purchase request ' . $prCode . ' submitted for approval.',
            array(
                'pr_id' => $prId,
                'pr_code' => $prCode,
                'status' => 'Pending',
                'approval_status' => 'Pending Approval',
                'fulfillment_status' => 'Awaiting Approval'
            )
        );
    }

    private function updateAndResubmit($prId, array $body, array $actor) {
        requirePermission('purchase_request', 'manage');
        $purpose = isset($body['purpose']) && is_string($body['purpose']) ? trim($body['purpose']) : '';
        $remarks = isset($body['remarks']) && is_string($body['remarks']) ? trim($body['remarks']) : '';
        $rawReason = isset($body['reason']) && is_string($body['reason']) ? trim($body['reason']) : '';

        if ($purpose === '' && $rawReason !== '') {
            $purpose = substr($rawReason, 0, 255);
        }
        if ($remarks === '' && $rawReason !== '') {
            $remarks = $rawReason;
        }
        $reason = $rawReason !== '' ? $rawReason : ($remarks !== '' ? $remarks : $purpose);

        $rawItems = isset($body['items']) && is_array($body['items']) ? $body['items'] : array();
        $normalized = ensureItemList($rawItems, 'requested_qty');
        if ($normalized === false) {
            $normalized = ensureItemList($rawItems, 'quantity');
        }
        if ($normalized === false || strlen($reason) > 500 || strlen($purpose) > 255 || strlen($remarks) > 500) {
            sendResponse(false, 'Please provide at least one item with a valid quantity.', null, 422);
        }

        $keepAsDraft = !empty($body['save_as_draft']);
        $prevStatus = '';
        $newStatus = 'Pending';

        $this->conn->beginTransaction();
        try {
            $q = $this->conn->prepare("SELECT * FROM purchase_request WHERE pr_id = :id FOR UPDATE");
            $q->execute(array(':id' => $prId));
            $pr = $q->fetch();
            if (!$pr) {
                throw new RuntimeException('Purchase request not found.');
            }
            if ((int)$pr['requester_id'] !== (int)$actor['user_id']) {
                $this->conn->rollBack();
                sendResponse(false, 'You can only edit and resubmit your own purchase requests.', null, 403);
            }
            if (!in_array($pr['status'], array('Draft', 'Pending', 'For Revision'), true)) {
                $this->conn->rollBack();
                sendResponse(false, 'Only requests in Draft, Pending Approval, or Returned for Revision status can be edited.', null, 409);
            }

            $prevStatus = (string)$pr['status'];
            $isStillDraft = ($prevStatus === 'Draft' && $keepAsDraft);
            $newStatus = $isStillDraft ? 'Draft' : 'Pending';
            $newApprovalStatus = $isStillDraft ? 'Draft' : 'Pending Approval';
            $newFulfillmentStatus = $isStillDraft ? 'Draft' : 'Awaiting Approval';

            foreach ($normalized as $pid => $qty) {
                $m = productInventoryMetrics($this->conn, $pid, true, $prId);
                if (!$m || (int)$m['is_active'] !== 1) {
                    throw new RuntimeException('Selected product is not active.');
                }
                if (!$isStillDraft && (int)$m['open_unapproved_requests'] > 0) {
                    throw new RuntimeException('"' . $m['product_name'] . '" already exists in another pending purchase request.');
                }
            }

            $effectivePurpose = $purpose !== ''
                ? $purpose
                : ($reason !== '' ? substr($reason, 0, 255) : (isset($pr['purpose']) && $pr['purpose'] !== '' ? $pr['purpose'] : 'Store Inventory Replenishment'));
            $effectiveUrgency = isset($body['urgency'])
                ? $this->normalizeUrgency($body['urgency'])
                : $this->normalizeUrgency(isset($pr['urgency']) ? $pr['urgency'] : 'Normal');
            $effectiveRemarks = $remarks !== ''
                ? $remarks
                : ($reason !== '' ? $reason : (isset($pr['remarks']) ? $pr['remarks'] : null));
            $effectiveStore = isset($body['store_name']) && is_string($body['store_name']) && trim($body['store_name']) !== ''
                ? trim($body['store_name'])
                : (isset($pr['store_name']) && $pr['store_name'] !== '' ? $pr['store_name'] : 'Main Store');

            $prCode = 'PR-' . str_pad((string)$prId, 4, '0', STR_PAD_LEFT);
            $upd = $this->conn->prepare(
                "UPDATE purchase_request
                 SET pr_code = :code,
                     store_name = :store,
                     purpose = :purpose,
                     urgency = :urgency,
                     status = :status,
                     approval_status = :approval_status,
                     fulfillment_status = :fulfillment_status,
                     reason = :reason,
                     remarks = :remarks,
                     updated_at = NOW()
                 WHERE pr_id = :id"
            );
            $upd->execute(array(
                ':code' => $prCode,
                ':store' => $effectiveStore,
                ':purpose' => $effectivePurpose,
                ':urgency' => $effectiveUrgency,
                ':status' => $newStatus,
                ':approval_status' => $newApprovalStatus,
                ':fulfillment_status' => $newFulfillmentStatus,
                ':reason' => $reason !== '' ? $reason : $pr['reason'],
                ':remarks' => $effectiveRemarks,
                ':id' => $prId
            ));

            $del = $this->conn->prepare("DELETE FROM purchase_request_detail WHERE pr_id = :id");
            $del->execute(array(':id' => $prId));

            $lineNotes = array();
            if (is_array($rawItems)) {
                foreach ($rawItems as $k => $entry) {
                    if (is_array($entry)) {
                        $pid = isset($entry['product_id']) ? (int)$entry['product_id'] : (int)$k;
                        $note = isset($entry['notes']) ? trim((string)$entry['notes']) : (isset($entry['adjustment_reason']) ? trim((string)$entry['adjustment_reason']) : '');
                        if ($pid > 0 && $note !== '') {
                            $lineNotes[$pid] = substr($note, 0, 255);
                        }
                    }
                }
            }

            $ins = $this->conn->prepare(
                "INSERT INTO purchase_request_detail (pr_id, product_id, requested_qty, adjustment_reason)
                 VALUES (:pr_id, :product_id, :requested_qty, :adjustment_reason)"
            );
            foreach ($normalized as $pid => $qty) {
                $ins->execute(array(
                    ':pr_id' => $prId,
                    ':product_id' => (int)$pid,
                    ':requested_qty' => (int)$qty,
                    ':adjustment_reason' => isset($lineNotes[$pid]) ? $lineNotes[$pid] : null
                ));
            }

            if ($isStillDraft) {
                $actType = 'DRAFT_UPDATED';
                $histMsg = $reason !== '' ? $reason : 'Draft purchase request updated';
            } elseif ($prevStatus === 'Draft') {
                $actType = 'SUBMITTED';
                $histMsg = $reason !== '' ? $reason : 'Draft submitted for manager approval';
            } elseif ($prevStatus === 'For Revision') {
                $actType = 'RESUBMITTED';
                $histMsg = $reason !== '' ? $reason : 'Revised and resubmitted for manager approval';
            } else {
                $actType = 'UPDATED';
                $histMsg = $reason !== '' ? $reason : 'Request updated by requester';
            }

            $this->recordHistory($prId, (int)$actor['user_id'], $actType, $prevStatus, $newStatus, $histMsg);
            $this->conn->commit();
        } catch (RuntimeException $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            sendResponse(false, $e->getMessage(), null, 422);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            error_log('PR update failed: ' . $e->getMessage());
            sendResponse(false, 'Unable to update purchase request.', null, 500);
        }

        $prCode = 'PR-' . str_pad((string)$prId, 4, '0', STR_PAD_LEFT);
        if ($newStatus === 'Draft') {
            auditLog($this->conn, $actor, 'PR_DRAFT_UPDATE', 'purchase_request', $prId, $prCode . ' draft updated');
            sendResponse(true, $prCode . ' draft saved.', array('pr_id' => $prId, 'pr_code' => $prCode, 'status' => 'Draft', 'approval_status' => 'Draft', 'fulfillment_status' => 'Draft'));
            return;
        }

        $auditAction = ($prevStatus === 'For Revision') ? 'PR_RESUBMIT' : ($prevStatus === 'Draft' ? 'PR_SUBMIT' : 'PR_UPDATE');
        auditLog($this->conn, $actor, $auditAction, 'purchase_request', $prId, $prCode . ' updated/resubmitted for approval');

        notifyUsersWithPermission(
            $this->conn,
            'request_approval',
            'manage',
            'pr_resubmitted',
            $prCode . ' Updated & Awaiting Approval',
            $actor['first_name'] . ' ' . $actor['last_name'] . ' updated ' . $prCode . ' and submitted it for review.',
            'purchase_request',
            'purchase_request',
            $prId,
            'warning',
            (int)$actor['user_id']
        );

        sendResponse(
            true,
            $prCode . ' updated and submitted for approval.',
            array(
                'pr_id' => $prId,
                'pr_code' => $prCode,
                'status' => 'Pending',
                'approval_status' => 'Pending Approval',
                'fulfillment_status' => 'Awaiting Approval'
            )
        );
    }

    private function cancelRequest($prId, array $body, array $actor) {
        requirePermission('purchase_request', 'manage');
        $comment = isset($body['comment']) && is_string($body['comment']) ? trim($body['comment']) : 'Cancelled by requester';

        $this->conn->beginTransaction();
        try {
            $q = $this->conn->prepare("SELECT * FROM purchase_request WHERE pr_id = :id FOR UPDATE");
            $q->execute(array(':id' => $prId));
            $pr = $q->fetch();
            if (!$pr) {
                throw new RuntimeException('Purchase request not found.');
            }
            $isAdmin = ((int)$actor['role_id'] === 1 || strcasecmp($actor['role_name'], 'Administrator') === 0);
            if ((int)$pr['requester_id'] !== (int)$actor['user_id'] && !$isAdmin) {
                $this->conn->rollBack();
                sendResponse(false, 'You can only cancel your own purchase requests.', null, 403);
            }
            if (!in_array($pr['status'], array('Draft', 'Pending', 'For Revision'), true)) {
                throw new RuntimeException('This request can no longer be cancelled because it has already been processed.');
            }

            $prevStatus = $pr['status'];
            $upd = $this->conn->prepare(
                "UPDATE purchase_request
                 SET status = 'Cancelled',
                     approval_status = 'Cancelled',
                     fulfillment_status = 'Cancelled',
                     updated_at = NOW()
                 WHERE pr_id = :id"
            );
            $upd->execute(array(':id' => $prId));

            $this->recordHistory($prId, (int)$actor['user_id'], 'CANCELLED', $prevStatus, 'Cancelled', $comment);
            $this->conn->commit();
        } catch (RuntimeException $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            sendResponse(false, $e->getMessage(), null, 409);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            sendResponse(false, 'Unable to cancel purchase request.', null, 500);
        }

        $prCode = 'PR-' . str_pad((string)$prId, 4, '0', STR_PAD_LEFT);
        auditLog($this->conn, $actor, 'PR_CANCEL', 'purchase_request', $prId, $prCode . ' cancelled');
        sendResponse(true, $prCode . ' has been cancelled.');
    }

    private function approveRequest($prId, array $body, array $actor) {
        requirePermission('request_approval', 'manage');
        $rawComment = isset($body['manager_comment']) && is_string($body['manager_comment'])
            ? $body['manager_comment']
            : (isset($body['comment']) && is_string($body['comment']) ? $body['comment'] : '');
        $comment = trim($rawComment);
        $rawItems = isset($body['items']) && is_array($body['items']) ? $body['items'] : array();

        if (strlen($comment) > 500) {
            sendResponse(false, 'Manager comment must be 500 characters or fewer.', null, 422);
        }

        $approvedMap = array();
        $reasonMap = array();
        foreach ($rawItems as $it) {
            if (!is_array($it)) {
                continue;
            }
            $pid = validatePositiveInt(isset($it['product_id']) ? $it['product_id'] : 0);
            $aqty = validatePositiveQuantity(isset($it['approved_qty']) ? $it['approved_qty'] : 0);
            $adjReason = isset($it['adjustment_reason']) && is_string($it['adjustment_reason']) ? trim($it['adjustment_reason']) : '';
            if ($pid > 0 && $aqty > 0) {
                $approvedMap[$pid] = $aqty;
                $reasonMap[$pid] = substr($adjReason, 0, 255);
            }
        }

        $requesterId = 0;
        $adjustSummary = array();

        $this->conn->beginTransaction();
        try {
            $q = $this->conn->prepare("SELECT * FROM purchase_request WHERE pr_id = :id FOR UPDATE");
            $q->execute(array(':id' => $prId));
            $pr = $q->fetch();
            if (!$pr) {
                throw new RuntimeException('Purchase request not found.');
            }
            if ((int)$pr['requester_id'] === (int)$actor['user_id']) {
                $this->conn->rollBack();
                sendResponse(false, 'Self-approval is not permitted. A requester cannot approve their own purchase request.', null, 403);
            }
            if ($pr['status'] !== 'Pending') {
                throw new RuntimeException('Only Pending Approval purchase requests can be approved (current status: ' . $pr['status'] . ').');
            }
            $requesterId = (int)$pr['requester_id'];

            $linesStmt = $this->conn->prepare(
                "SELECT prd.pr_detail_id, prd.product_id, prd.requested_qty, p.product_name
                 FROM purchase_request_detail prd
                 INNER JOIN product p ON p.product_id = prd.product_id
                 WHERE prd.pr_id = :pr_id
                 FOR UPDATE"
            );
            $linesStmt->execute(array(':pr_id' => $prId));
            $lines = $linesStmt->fetchAll();
            if (empty($lines)) {
                throw new InvalidArgumentException('Purchase request has no line items.');
            }

            $updLine = $this->conn->prepare(
                "UPDATE purchase_request_detail
                 SET approved_qty = :approved_qty, adjustment_reason = :adjustment_reason
                 WHERE pr_detail_id = :pr_detail_id"
            );

            foreach ($lines as $line) {
                $pid = (int)$line['product_id'];
                $reqQty = (int)$line['requested_qty'];
                $appQty = isset($approvedMap[$pid]) ? (int)$approvedMap[$pid] : $reqQty;
                if ($appQty <= 0) {
                    throw new InvalidArgumentException('Approved quantity for "' . $line['product_name'] . '" must be greater than zero.');
                }
                $adjReason = isset($reasonMap[$pid]) ? $reasonMap[$pid] : '';
                if ($appQty !== $reqQty && $adjReason === '' && $comment === '') {
                    throw new InvalidArgumentException(
                        'Please provide an adjustment reason or comment for changing "' . $line['product_name']
                        . '" from ' . $reqQty . ' to ' . $appQty . '.'
                    );
                }
                if ($appQty !== $reqQty) {
                    $why = $adjReason !== '' ? $adjReason : $comment;
                    $adjustSummary[] = $line['product_name'] . ': ' . $reqQty . ' → ' . $appQty . ($why !== '' ? ' (' . $why . ')' : '');
                }

                $updLine->execute(array(
                    ':approved_qty' => $appQty,
                    ':adjustment_reason' => ($adjReason !== '' ? $adjReason : ($appQty !== $reqQty ? $comment : null)),
                    ':pr_detail_id' => (int)$line['pr_detail_id']
                ));
            }

            $updPr = $this->conn->prepare(
                "UPDATE purchase_request
                 SET status = 'Approved',
                     approval_status = 'Approved',
                     fulfillment_status = 'Pending Fulfillment',
                     manager_comment = :comment,
                     reviewed_by = :reviewed_by,
                     reviewed_at = NOW(),
                     updated_at = NOW()
                 WHERE pr_id = :id AND status = 'Pending'"
            );
            $updPr->execute(array(
                ':comment' => $comment !== '' ? $comment : null,
                ':reviewed_by' => (int)$actor['user_id'],
                ':id' => $prId
            ));
            if ($updPr->rowCount() !== 1) {
                throw new RuntimeException('Concurrent modification detected. Please refresh and try again.');
            }

            $histComment = $comment;
            if (!empty($adjustSummary)) {
                $histComment = ($histComment !== '' ? $histComment . ' | ' : '') . 'Adjusted: ' . implode('; ', $adjustSummary);
            }
            $this->recordHistory($prId, (int)$actor['user_id'], 'APPROVED', 'Pending', 'Approved', $histComment !== '' ? $histComment : 'Approved by manager');
            $this->conn->commit();
        } catch (InvalidArgumentException $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            sendResponse(false, $e->getMessage(), null, 422);
        } catch (RuntimeException $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            sendResponse(false, $e->getMessage(), null, 409);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            error_log('PR approve failed: ' . $e->getMessage());
            sendResponse(false, 'Unable to approve purchase request.', null, 500);
        }

        $prCode = 'PR-' . str_pad((string)$prId, 4, '0', STR_PAD_LEFT);
        $actorName = $actor['first_name'] . ' ' . $actor['last_name'];
        $adjNote = !empty($adjustSummary) ? (' [Qty adjusted: ' . implode('; ', $adjustSummary) . ']') : '';
        auditLog($this->conn, $actor, 'PR_APPROVE', 'request_approval', $prId, $prCode . ' approved by ' . $actorName . $adjNote);

        // Notify requester, purchasing officers, and administrators
        notifyUser(
            $this->conn,
            $requesterId,
            'pr_approved',
            $prCode . ' Approved',
            $actorName . ' approved your request ' . $prCode . '.' . $adjNote . ($comment !== '' ? ' Comment: ' . $comment : ''),
            'purchase_request',
            'purchase_request',
            $prId,
            'success'
        );
        notifyUsersWithPermission(
            $this->conn,
            'purchase_order',
            'manage',
            'pr_ready_for_po',
            $prCode . ' Ready for Purchasing',
            $prCode . ' was approved by ' . $actorName . ' and is ready for Purchase Order creation.' . $adjNote,
            'purchase_order',
            'purchase_request',
            $prId,
            'info',
            (int)$actor['user_id']
        );
        notifyAdmins(
            $this->conn,
            'pr_approved',
            $prCode . ' Approved by ' . $actorName,
            $prCode . ' has been approved and forwarded to Purchasing.' . $adjNote,
            'purchase_request',
            'purchase_request',
            $prId,
            'info',
            (int)$actor['user_id']
        );

        sendResponse(
            true,
            $prCode . ' approved and forwarded to Purchasing Officer.',
            array(
                'pr_id' => $prId,
                'pr_code' => $prCode,
                'status' => 'Approved',
                'approval_status' => 'Approved',
                'fulfillment_status' => 'Pending Fulfillment',
                'reviewed_by' => (int)$actor['user_id']
            )
        );
    }

    private function rejectRequest($prId, array $body, array $actor) {
        requirePermission('request_approval', 'manage');
        $rawComment = isset($body['manager_comment']) && is_string($body['manager_comment'])
            ? $body['manager_comment']
            : (isset($body['comment']) && is_string($body['comment'])
                ? $body['comment']
                : (isset($body['rejection_reason']) && is_string($body['rejection_reason']) ? $body['rejection_reason'] : ''));
        $comment = trim($rawComment);
        if ($comment === '' || strlen($comment) > 500) {
            sendResponse(false, 'Please provide a clear rejection reason (up to 500 characters).', null, 422);
        }

        $requesterId = 0;
        $this->conn->beginTransaction();
        try {
            $q = $this->conn->prepare("SELECT * FROM purchase_request WHERE pr_id = :id FOR UPDATE");
            $q->execute(array(':id' => $prId));
            $pr = $q->fetch();
            if (!$pr) {
                throw new RuntimeException('Purchase request not found.');
            }
            if ((int)$pr['requester_id'] === (int)$actor['user_id']) {
                $this->conn->rollBack();
                sendResponse(false, 'You cannot review your own purchase request.', null, 403);
            }
            if ($pr['status'] !== 'Pending') {
                throw new RuntimeException('Only Pending Approval purchase requests can be rejected.');
            }
            $requesterId = (int)$pr['requester_id'];

            $upd = $this->conn->prepare(
                "UPDATE purchase_request
                 SET status = 'Rejected',
                     approval_status = 'Rejected',
                     fulfillment_status = 'Not Fulfilled',
                     manager_comment = :comment,
                     reviewed_by = :reviewed_by,
                     reviewed_at = NOW(),
                     updated_at = NOW()
                 WHERE pr_id = :id AND status = 'Pending'"
            );
            $upd->execute(array(
                ':comment' => $comment,
                ':reviewed_by' => (int)$actor['user_id'],
                ':id' => $prId
            ));
            if ($upd->rowCount() !== 1) {
                throw new RuntimeException('Concurrent modification detected.');
            }

            // Release any active stock reservations tied to this PR if any exist
            $relRes = $this->conn->prepare("UPDATE stock_reservation SET status = 'Cancelled', updated_at = NOW() WHERE pr_id = :pr_id AND status = 'Active'");
            $relRes->execute(array(':pr_id' => $prId));

            $this->recordHistory($prId, (int)$actor['user_id'], 'REJECTED', 'Pending', 'Rejected', $comment);
            $this->conn->commit();
        } catch (RuntimeException $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            sendResponse(false, $e->getMessage(), null, 409);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            sendResponse(false, 'Unable to reject purchase request.', null, 500);
        }

        $prCode = 'PR-' . str_pad((string)$prId, 4, '0', STR_PAD_LEFT);
        $actorName = $actor['first_name'] . ' ' . $actor['last_name'];
        auditLog($this->conn, $actor, 'PR_REJECT', 'request_approval', $prId, $prCode . ' rejected by ' . $actorName . ': ' . $comment);

        notifyUser(
            $this->conn,
            $requesterId,
            'pr_rejected',
            $prCode . ' Rejected',
            $actorName . ' rejected ' . $prCode . '. Reason: ' . $comment,
            'purchase_request',
            'purchase_request',
            $prId,
            'danger'
        );
        notifyAdmins(
            $this->conn,
            'pr_rejected',
            $prCode . ' Rejected by ' . $actorName,
            'Reason: ' . $comment,
            'purchase_request',
            'purchase_request',
            $prId,
            'warning',
            (int)$actor['user_id']
        );

        sendResponse(
            true,
            $prCode . ' has been rejected.',
            array(
                'pr_id' => $prId,
                'pr_code' => $prCode,
                'status' => 'Rejected',
                'approval_status' => 'Rejected',
                'fulfillment_status' => 'Not Fulfilled'
            )
        );
    }

    private function returnForRevision($prId, array $body, array $actor) {
        requirePermission('request_approval', 'manage');
        $rawComment = isset($body['manager_comment']) && is_string($body['manager_comment'])
            ? $body['manager_comment']
            : (isset($body['comment']) && is_string($body['comment']) ? $body['comment'] : '');
        $comment = trim($rawComment);
        if ($comment === '' || strlen($comment) > 500) {
            sendResponse(false, 'Please provide manager comments explaining what needs to be revised.', null, 422);
        }

        $requesterId = 0;
        $this->conn->beginTransaction();
        try {
            $q = $this->conn->prepare("SELECT * FROM purchase_request WHERE pr_id = :id FOR UPDATE");
            $q->execute(array(':id' => $prId));
            $pr = $q->fetch();
            if (!$pr) {
                throw new RuntimeException('Purchase request not found.');
            }
            if ((int)$pr['requester_id'] === (int)$actor['user_id']) {
                $this->conn->rollBack();
                sendResponse(false, 'You cannot review your own purchase request.', null, 403);
            }
            if ($pr['status'] !== 'Pending') {
                throw new RuntimeException('Only Pending Approval purchase requests can be returned for revision.');
            }
            $requesterId = (int)$pr['requester_id'];

            $upd = $this->conn->prepare(
                "UPDATE purchase_request
                 SET status = 'For Revision',
                     approval_status = 'Returned for Revision',
                     fulfillment_status = 'Awaiting Revision',
                     manager_comment = :comment,
                     reviewed_by = :reviewed_by,
                     reviewed_at = NOW(),
                     updated_at = NOW()
                 WHERE pr_id = :id AND status = 'Pending'"
            );
            $upd->execute(array(
                ':comment' => $comment,
                ':reviewed_by' => (int)$actor['user_id'],
                ':id' => $prId
            ));
            if ($upd->rowCount() !== 1) {
                throw new RuntimeException('Concurrent modification detected.');
            }

            $this->recordHistory($prId, (int)$actor['user_id'], 'RETURNED_FOR_REVISION', 'Pending', 'For Revision', $comment);
            $this->conn->commit();
        } catch (RuntimeException $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            sendResponse(false, $e->getMessage(), null, 409);
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            sendResponse(false, 'Unable to return purchase request for revision.', null, 500);
        }

        $prCode = 'PR-' . str_pad((string)$prId, 4, '0', STR_PAD_LEFT);
        $actorName = $actor['first_name'] . ' ' . $actor['last_name'];
        auditLog($this->conn, $actor, 'PR_REVISION', 'request_approval', $prId, $prCode . ' returned for revision by ' . $actorName . ': ' . $comment);

        notifyUser(
            $this->conn,
            $requesterId,
            'pr_for_revision',
            $prCode . ' Returned for Revision',
            $actorName . ' returned ' . $prCode . ' for revision: ' . $comment,
            'purchase_request',
            'purchase_request',
            $prId,
            'warning'
        );

        sendResponse(
            true,
            $prCode . ' returned to requester for revision.',
            array(
                'pr_id' => $prId,
                'pr_code' => $prCode,
                'status' => 'For Revision',
                'approval_status' => 'Returned for Revision',
                'fulfillment_status' => 'Awaiting Revision'
            )
        );
    }

    private function recordHistory($prId, $userId, $action, $fromStatus, $toStatus, $comment) {
        $stmt = $this->conn->prepare(
            "INSERT INTO purchase_request_history (pr_id, user_id, action, from_status, to_status, comment)
             VALUES (:pr_id, :user_id, :action, :from_status, :to_status, :comment)"
        );
        $stmt->execute(array(
            ':pr_id' => (int)$prId,
            ':user_id' => $userId ? (int)$userId : null,
            ':action' => $action,
            ':from_status' => $fromStatus,
            ':to_status' => $toStatus,
            ':comment' => $comment
        ));
    }

    private function getRequests(array $user, $statusFilter = '') {
        $scoped = $this->isScopedToOwnRequests($user);
        $params = array();
        $where = array();

        if ($scoped) {
            $where[] = 'pr.requester_id = :uid';
            $params[':uid'] = (int)$user['user_id'];
        } else {
            // Unsubmitted drafts are private to the requester who created them
            $where[] = "(pr.status != 'Draft' OR pr.requester_id = :viewer_uid)";
            $params[':viewer_uid'] = (int)$user['user_id'];
        }

        if ($statusFilter !== '') {
            if ($statusFilter === 'Pending Approval') {
                $statusFilter = 'Pending';
            } elseif ($statusFilter === 'Returned for Revision') {
                $statusFilter = 'For Revision';
            }
            $where[] = 'pr.status = :status';
            $params[':status'] = $statusFilter;
        }
        $whereSql = !empty($where) ? ('WHERE ' . implode(' AND ', $where)) : '';

        $sql = "SELECT
                    pr.pr_id,
                    COALESCE(pr.pr_code, CONCAT('PR-', LPAD(pr.pr_id, 4, '0'))) AS pr_code,
                    pr.requester_id,
                    COALESCE(pr.store_name, 'Main Store') AS store_name,
                    COALESCE(NULLIF(TRIM(pr.purpose), ''), NULLIF(TRIM(pr.reason), ''), 'Store Inventory Replenishment') AS purpose,
                    COALESCE(NULLIF(TRIM(pr.urgency), ''), 'Normal') AS urgency,
                    pr.fulfillment_type,
                    pr.releasing_id,
                    CASE WHEN ru.user_id IS NOT NULL THEN CONCAT(ru.first_name, ' ', ru.last_name) ELSE 'Unknown Requester' END AS requested_by,
                    CASE WHEN ru.user_id IS NOT NULL THEN CONCAT(ru.first_name, ' ', ru.last_name) ELSE 'Unknown Requester' END AS requested_by_name,
                    ru.username AS requester_username,
                    r_req.role_name AS requester_role,
                    r_req.role_name AS role_name,
                    r_req.role_id AS requester_role_id,
                    pr.status,
                    pr.reason,
                    COALESCE(NULLIF(TRIM(pr.remarks), ''), pr.reason) AS remarks,
                    pr.manager_comment,
                    CASE WHEN pr.status = 'Rejected' THEN pr.manager_comment ELSE NULL END AS rejection_reason,
                    pr.reviewed_by,
                    CASE WHEN rv.user_id IS NOT NULL THEN CONCAT(rv.first_name, ' ', rv.last_name) ELSE NULL END AS reviewed_by_name,
                    CASE WHEN rv.user_id IS NOT NULL THEN CONCAT(rv.first_name, ' ', rv.last_name) ELSE NULL END AS approved_by_name,
                    r_rev.role_name AS reviewer_role,
                    r_rev.role_name AS reviewer_role_name,
                    r_rev.role_id AS reviewer_role_id,
                    pr.reviewed_at,
                    pr.submitted_at,
                    DATE(pr.submitted_at) AS request_date,
                    pr.updated_at,
                    pr.completed_at,
                    (SELECT COUNT(*) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id) AS item_count,
                    COALESCE((SELECT SUM(d.requested_qty) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id), 0) AS total_requested_qty,
                    COALESCE((SELECT SUM(COALESCE(d.approved_qty, d.requested_qty)) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id), 0) AS total_approved_qty,
                    COALESCE((SELECT SUM(d.approved_qty) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id), 0) AS explicit_approved_qty,
                    COALESCE((SELECT SUM(r.reserved_qty) FROM stock_reservation r WHERE r.pr_id = pr.pr_id AND r.status = 'Active'), 0) AS total_reserved_qty,
                    COALESCE((
                        SELECT SUM(srd.quantity_released)
                        FROM stock_releasing_detail srd
                        INNER JOIN stock_releasing sr ON sr.releasing_id = srd.releasing_id
                        WHERE sr.pr_id = pr.pr_id
                    ), 0) AS total_released_qty,
                    COALESCE((SELECT SUM(d.ordered_qty) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id), 0) AS total_ordered_qty,
                    COALESCE((
                        SELECT SUM(pod.quantity_received)
                        FROM purchase_order_detail pod
                        INNER JOIN purchase_order po ON po.po_id = pod.po_id
                        WHERE po.pr_id = pr.pr_id AND po.status != 'Cancelled'
                    ), 0) AS total_received_qty,
                    (SELECT GROUP_CONCAT(CONCAT(p.product_name, ' (', COALESCE(d.approved_qty, d.requested_qty), ')') SEPARATOR ', ')
                     FROM purchase_request_detail d
                     INNER JOIN product p ON p.product_id = d.product_id
                     WHERE d.pr_id = pr.pr_id) AS items_summary
                FROM purchase_request pr
                LEFT JOIN users ru ON ru.user_id = pr.requester_id
                LEFT JOIN role r_req ON r_req.role_id = ru.role_id
                LEFT JOIN users rv ON rv.user_id = pr.reviewed_by
                LEFT JOIN role r_rev ON r_rev.role_id = rv.role_id
                $whereSql
                ORDER BY pr.submitted_at DESC, pr.pr_id DESC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        foreach ($rows as &$row) {
            $st = (string)$row['status'];
            $reqQty = (int)$row['total_requested_qty'];
            $appQty = in_array($st, array('Approved', 'Partially Ordered', 'Ordered', 'Partially Received', 'Completed'), true)
                ? (int)$row['total_approved_qty']
                : 0;
            $resQty = (int)$row['total_reserved_qty'];
            $relQty = (int)$row['total_released_qty'];
            $ordQty = (int)$row['total_ordered_qty'];
            $recQty = (int)$row['total_received_qty'];

            if (in_array($st, array('Rejected', 'Cancelled', 'Completed'), true)) {
                $outQty = 0;
            } elseif ($appQty > 0) {
                $outQty = max(0, $appQty - max($relQty, $recQty));
            } else {
                $outQty = max(0, $reqQty - $relQty);
            }

            $row['requested_qty'] = $reqQty;
            $row['approved_qty'] = $appQty;
            $row['reserved_qty'] = $resQty;
            $row['released_qty'] = $relQty;
            $row['outstanding_qty'] = $outQty;
            $row['total_outstanding_qty'] = $outQty;
            $row['approval_status'] = $this->deriveApprovalStatus($st);
            $row['fulfillment_status'] = $this->deriveFulfillmentStatus($st, $appQty, $resQty, $relQty, $ordQty, $recQty);
        }
        unset($row);

        return $rows;
    }

    private function getRequestDetail($prId, array $user) {
        $scoped = $this->isScopedToOwnRequests($user);
        $stmt = $this->conn->prepare(
            "SELECT
                pr.pr_id,
                COALESCE(pr.pr_code, CONCAT('PR-', LPAD(pr.pr_id, 4, '0'))) AS pr_code,
                pr.requester_id,
                COALESCE(pr.store_name, 'Main Store') AS store_name,
                COALESCE(NULLIF(TRIM(pr.purpose), ''), NULLIF(TRIM(pr.reason), ''), 'Store Inventory Replenishment') AS purpose,
                COALESCE(NULLIF(TRIM(pr.urgency), ''), 'Normal') AS urgency,
                pr.fulfillment_type,
                pr.releasing_id,
                CASE WHEN ru.user_id IS NOT NULL THEN CONCAT(ru.first_name, ' ', ru.last_name) ELSE 'Unknown Requester' END AS requested_by,
                CASE WHEN ru.user_id IS NOT NULL THEN CONCAT(ru.first_name, ' ', ru.last_name) ELSE 'Unknown Requester' END AS requested_by_name,
                ru.username AS requester_username,
                r_req.role_name AS requester_role,
                r_req.role_name AS role_name,
                r_req.role_id AS requester_role_id,
                pr.status,
                pr.reason,
                COALESCE(NULLIF(TRIM(pr.remarks), ''), pr.reason) AS remarks,
                pr.manager_comment,
                CASE WHEN pr.status = 'Rejected' THEN pr.manager_comment ELSE NULL END AS rejection_reason,
                pr.reviewed_by,
                CASE WHEN rv.user_id IS NOT NULL THEN CONCAT(rv.first_name, ' ', rv.last_name) ELSE NULL END AS reviewed_by_name,
                CASE WHEN rv.user_id IS NOT NULL THEN CONCAT(rv.first_name, ' ', rv.last_name) ELSE NULL END AS approved_by_name,
                r_rev.role_name AS reviewer_role,
                r_rev.role_name AS reviewer_role_name,
                r_rev.role_id AS reviewer_role_id,
                pr.reviewed_at,
                pr.submitted_at,
                DATE(pr.submitted_at) AS request_date,
                pr.updated_at,
                pr.completed_at
             FROM purchase_request pr
             LEFT JOIN users ru ON ru.user_id = pr.requester_id
             LEFT JOIN role r_req ON r_req.role_id = ru.role_id
             LEFT JOIN users rv ON rv.user_id = pr.reviewed_by
             LEFT JOIN role r_rev ON r_rev.role_id = rv.role_id
             WHERE pr.pr_id = :id
             LIMIT 1"
        );
        $stmt->execute(array(':id' => $prId));
        $pr = $stmt->fetch();
        if (!$pr) {
            return null;
        }
        if ($scoped && (int)$pr['requester_id'] !== (int)$user['user_id']) {
            return 'FORBIDDEN';
        }
        if ($pr['status'] === 'Draft' && (int)$pr['requester_id'] !== (int)$user['user_id']) {
            return 'FORBIDDEN';
        }

        // Load items enriched with live stock, reserved_qty, released_qty, outstanding_qty, and linked suppliers
        $itemsStmt = $this->conn->prepare(
            "SELECT
                d.pr_detail_id,
                d.product_id,
                p.product_name,
                p.unit_measure,
                p.unit_price,
                p.reorder_level,
                p.max_stock,
                d.requested_qty,
                d.approved_qty,
                d.adjustment_reason,
                d.adjustment_reason AS notes,
                d.ordered_qty,
                d.ordered_qty AS already_ordered_qty,
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
                ), 0) AS released_qty,
                COALESCE((
                    SELECT SUM(pod.quantity_received)
                    FROM purchase_order_detail pod
                    INNER JOIN purchase_order po ON po.po_id = pod.po_id
                    WHERE (po.pr_id = d.pr_id OR pod.pr_id = d.pr_id OR pod.pr_detail_id = d.pr_detail_id)
                      AND pod.product_id = d.product_id
                      AND po.status != 'Cancelled'
                ), 0) AS already_received_qty,
                GREATEST(0, COALESCE(d.approved_qty, d.requested_qty) - d.ordered_qty) AS remaining_to_order
             FROM purchase_request_detail d
             INNER JOIN product p ON p.product_id = d.product_id
             WHERE d.pr_id = :id
             ORDER BY d.pr_detail_id ASC"
        );
        $itemsStmt->execute(array(':id' => $prId));
        $lines = $itemsStmt->fetchAll();

        $supStmt = $this->conn->prepare(
            "SELECT ps.supplier_id, s.supplier_name, ps.supplier_unit_cost
             FROM product_supplier ps
             INNER JOIN supplier s ON s.supplier_id = ps.supplier_id
             WHERE ps.product_id = :pid AND s.is_active = 1
             ORDER BY s.supplier_name ASC"
        );

        $st = (string)$pr['status'];
        $isApprovedState = in_array($st, array('Approved', 'Partially Ordered', 'Ordered', 'Partially Received', 'Completed'), true);

        $totalReq = 0;
        $totalApp = 0;
        $totalRes = 0;
        $totalRel = 0;
        $totalOrd = 0;
        $totalRec = 0;
        $totalOut = 0;
        $totalShortage = 0;
        $totalNetShortage = 0;
        $allItemsStockSufficient = true;

        foreach ($lines as &$line) {
            $m = productInventoryMetrics($this->conn, (int)$line['product_id'], false, $prId);
            $usableOnHand = $m ? (int)$m['usable_stock'] : 0;
            $allReserved = $m ? (int)$m['reserved_stock'] : 0;
            $availableUnreservedStock = $m ? max(0, $usableOnHand - $allReserved) : 0;
            $line['available_stock'] = $m ? (int)$m['available_stock'] : 0;
            $line['available_unreserved_stock'] = $availableUnreservedStock;
            $line['available_warehouse_stock'] = $line['available_stock'];
            $line['max_stock'] = $m ? (int)$m['max_stock'] : (int)$line['max_stock'];
            $line['reorder_threshold'] = $m ? (int)$m['reorder_threshold'] : effectiveReorderThreshold($line['reorder_level']);
            $line['outstanding_replenishment'] = $m ? (int)$m['outstanding_replenishment'] : 0;
            $line['incoming_supply_qty'] = $m ? (int)($m['outstanding_po_qty'] ?? $m['on_order_qty'] ?? 0) : 0;
            $line['suggested_order_qty'] = $m ? (int)$m['suggested_order_qty'] : 0;
            $line['additional_qty_needed'] = $m ? (int)$m['additional_qty_needed'] : 0;
            $line['additional_needed_qty'] = $line['additional_qty_needed'];
            $line['sufficient_stock'] = $line['available_stock'] > $line['reorder_threshold'];

            $reqQty = (int)$line['requested_qty'];
            $appQty = $line['approved_qty'] !== null
                ? (int)$line['approved_qty']
                : ($isApprovedState ? $reqQty : null);
            $effectiveQty = $appQty !== null ? $appQty : $reqQty;
            $resQty = (int)$line['reserved_qty'];
            $relQty = (int)$line['released_qty'];
            $ordQty = (int)$line['ordered_qty'];
            $recQty = (int)$line['already_received_qty'];

            if (in_array($st, array('Rejected', 'Cancelled', 'Completed'), true)) {
                $outQty = 0;
            } elseif ($isApprovedState) {
                $outQty = max(0, $effectiveQty - max($relQty, $recQty));
            } else {
                $outQty = max(0, $reqQty - $relQty);
            }

            $remainingApprovedQty = max(0, $effectiveQty - $relQty - $resQty - $ordQty);
            $shortageQty = max(0, $remainingApprovedQty - $availableUnreservedStock);
            $openPoForThisPr = max(0, $ordQty - $recQty);
            $otherIncomingSupply = max(0, $line['incoming_supply_qty'] - $openPoForThisPr);
            $netShortageQty = max(0, $shortageQty - $otherIncomingSupply);
            $stockSufficientForPr = ($remainingApprovedQty > 0)
                ? ($availableUnreservedStock >= $remainingApprovedQty)
                : ($availableUnreservedStock >= max(0, $effectiveQty - $relQty));

            if (!$stockSufficientForPr && $remainingApprovedQty > 0) {
                $allItemsStockSufficient = false;
            }

            $line['requested_qty'] = $reqQty;
            $line['approved_qty'] = $appQty;
            $line['reserved_qty'] = $resQty;
            $line['released_qty'] = $relQty;
            $line['received_qty'] = $recQty;
            $line['outstanding_qty'] = $outQty;
            $line['remaining_approved_qty'] = $remainingApprovedQty;
            $line['remaining_to_order'] = $remainingApprovedQty;
            $line['has_shortage'] = ($shortageQty > 0);
            $line['shortage_qty'] = $shortageQty;
            $line['net_shortage_qty'] = $netShortageQty;
            $line['recommended_po_qty'] = $shortageQty;
            $line['stock_sufficient'] = $stockSufficientForPr;
            $line['requires_po'] = ($shortageQty > 0);

            $totalReq += $reqQty;
            $totalApp += ($appQty !== null ? $appQty : 0);
            $totalRes += $resQty;
            $totalRel += $relQty;
            $totalOrd += $ordQty;
            $totalRec += $recQty;
            $totalOut += $outQty;
            $totalShortage += $shortageQty;
            $totalNetShortage += $netShortageQty;

            $supStmt->execute(array(':pid' => (int)$line['product_id']));
            $line['suppliers'] = $supStmt->fetchAll();
        }
        unset($line);

        // Linked POs (either header pr_id or detail pr_id/pr_detail_id)
        $poStmt = $this->conn->prepare(
            "SELECT DISTINCT po.po_id,
                    COALESCE(po.po_code, CONCAT('PO-', LPAD(po.po_id, 5, '0'))) AS po_code,
                    po.supplier_id, s.supplier_name, po.order_date, po.expected_date, po.status,
                    po.po_source, po.order_status, po.receiving_status, po.inspection_status, po.authorization_status,
                    COALESCE((SELECT SUM(pod.quantity_ordered) FROM purchase_order_detail pod WHERE pod.po_id = po.po_id), 0) AS qty_ordered,
                    COALESCE((SELECT SUM(pod.quantity_received) FROM purchase_order_detail pod WHERE pod.po_id = po.po_id), 0) AS qty_received,
                    COALESCE((SELECT SUM(pod.quantity_ordered * pod.unit_cost) FROM purchase_order_detail pod WHERE pod.po_id = po.po_id), 0) AS total_cost
             FROM purchase_order po
             INNER JOIN supplier s ON s.supplier_id = po.supplier_id
             WHERE po.pr_id = :id
                OR EXISTS (
                    SELECT 1
                    FROM purchase_order_detail pod2
                    LEFT JOIN purchase_request_detail prd2 ON prd2.pr_detail_id = pod2.pr_detail_id
                    WHERE pod2.po_id = po.po_id AND (pod2.pr_id = :id2 OR prd2.pr_id = :id3)
                )
             ORDER BY po.po_id DESC"
        );
        $poStmt->execute(array(':id' => $prId, ':id2' => $prId, ':id3' => $prId));

        // Approval & workflow history
        $histStmt = $this->conn->prepare(
            "SELECT h.history_id, h.action, h.from_status, h.to_status, h.to_status AS new_status,
                    h.comment, h.comment AS comments, h.created_at,
                    CASE WHEN u.user_id IS NOT NULL THEN CONCAT(u.first_name, ' ', u.last_name) ELSE 'System' END AS actor_name,
                    r.role_name AS actor_role, r.role_name AS role_name
             FROM purchase_request_history h
             LEFT JOIN users u ON u.user_id = h.user_id
             LEFT JOIN role r ON r.role_id = u.role_id
             WHERE h.pr_id = :id
             ORDER BY h.history_id ASC"
        );
        $histStmt->execute(array(':id' => $prId));

        $pr['requested_qty'] = $totalReq;
        $pr['approved_qty'] = $totalApp;
        $pr['reserved_qty'] = $totalRes;
        $pr['released_qty'] = $totalRel;
        $pr['outstanding_qty'] = $totalOut;
        $pr['shortage_qty'] = $totalShortage;
        $pr['net_shortage_qty'] = $totalNetShortage;
        $pr['stock_sufficient'] = $allItemsStockSufficient;
        $pr['requires_po'] = ($totalShortage > 0);
        $pr['fulfillment_recommendation'] = $allItemsStockSufficient ? 'reserve_or_release_stock' : 'create_purchase_order';
        $pr['total_requested_qty'] = $totalReq;
        $pr['total_approved_qty'] = $totalApp;
        $pr['total_reserved_qty'] = $totalRes;
        $pr['total_released_qty'] = $totalRel;
        $pr['total_ordered_qty'] = $totalOrd;
        $pr['total_received_qty'] = $totalRec;
        $pr['total_outstanding_qty'] = $totalOut;
        $pr['total_shortage_qty'] = $totalShortage;
        $pr['approval_status'] = $this->deriveApprovalStatus($st);
        $pr['fulfillment_status'] = $this->deriveFulfillmentStatus($st, $totalApp, $totalRes, $totalRel, $totalOrd, $totalRec);

        $pr['items'] = $lines;
        $pr['purchase_orders'] = $poStmt->fetchAll();
        $pr['history'] = $histStmt->fetchAll();
        return $pr;
    }

    private function getApprovedRequestsForPo() {
        $stmt = $this->conn->query(
            "SELECT
                pr.pr_id,
                COALESCE(pr.pr_code, CONCAT('PR-', LPAD(pr.pr_id, 4, '0'))) AS pr_code,
                pr.requester_id,
                COALESCE(pr.store_name, 'Main Store') AS store_name,
                COALESCE(NULLIF(TRIM(pr.purpose), ''), NULLIF(TRIM(pr.reason), ''), 'Store Inventory Replenishment') AS purpose,
                COALESCE(NULLIF(TRIM(pr.urgency), ''), 'Normal') AS urgency,
                CASE WHEN ru.user_id IS NOT NULL THEN CONCAT(ru.first_name, ' ', ru.last_name) ELSE 'Unknown Requester' END AS requested_by,
                CASE WHEN ru.user_id IS NOT NULL THEN CONCAT(ru.first_name, ' ', ru.last_name) ELSE 'Unknown Requester' END AS requested_by_name,
                r_req.role_name AS requester_role,
                r_req.role_name AS role_name,
                r_req.role_id AS requester_role_id,
                pr.reviewed_by,
                CASE WHEN rv.user_id IS NOT NULL THEN CONCAT(rv.first_name, ' ', rv.last_name) ELSE NULL END AS approved_by,
                CASE WHEN rv.user_id IS NOT NULL THEN CONCAT(rv.first_name, ' ', rv.last_name) ELSE NULL END AS approved_by_name,
                r_rev.role_name AS reviewer_role,
                r_rev.role_name AS reviewer_role_name,
                r_rev.role_id AS reviewer_role_id,
                pr.status,
                'Approved' AS approval_status,
                pr.reason,
                COALESCE(NULLIF(TRIM(pr.remarks), ''), pr.reason) AS remarks,
                pr.manager_comment,
                pr.reviewed_at,
                pr.submitted_at,
                DATE(pr.submitted_at) AS request_date,
                (SELECT COUNT(*) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id AND COALESCE(d.approved_qty, d.requested_qty) > d.ordered_qty) AS remaining_item_count,
                COALESCE((SELECT SUM(GREATEST(0, COALESCE(d.approved_qty, d.requested_qty) - d.ordered_qty)) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id), 0) AS remaining_qty,
                COALESCE((SELECT SUM(d.requested_qty) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id), 0) AS total_requested_qty,
                COALESCE((SELECT SUM(COALESCE(d.approved_qty, d.requested_qty)) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id), 0) AS total_approved_qty
             FROM purchase_request pr
             LEFT JOIN users ru ON ru.user_id = pr.requester_id
             LEFT JOIN role r_req ON r_req.role_id = ru.role_id
             LEFT JOIN users rv ON rv.user_id = pr.reviewed_by
             LEFT JOIN role r_rev ON r_rev.role_id = rv.role_id
             WHERE pr.status IN ('Approved', 'Partially Ordered')
             HAVING remaining_qty > 0
             ORDER BY pr.reviewed_at ASC, pr.pr_id ASC"
        );
        $rows = $stmt->fetchAll();

        $itemStmt = $this->conn->prepare(
            "SELECT d.pr_detail_id, d.pr_id, d.product_id, p.product_name, p.unit_measure, p.unit_price,
                    d.requested_qty, COALESCE(d.approved_qty, d.requested_qty) AS approved_qty,
                    d.ordered_qty,
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
                    ), 0) AS released_qty,
                    COALESCE((
                        SELECT SUM(pod.quantity_received)
                        FROM purchase_order_detail pod
                        INNER JOIN purchase_order po ON po.po_id = pod.po_id
                        WHERE (po.pr_id = d.pr_id OR pod.pr_id = d.pr_id OR pod.pr_detail_id = d.pr_detail_id)
                          AND pod.product_id = d.product_id
                          AND po.status != 'Cancelled'
                    ), 0) AS received_qty,
                    GREATEST(0, COALESCE(d.approved_qty, d.requested_qty) - d.ordered_qty) AS remaining_to_order
             FROM purchase_request_detail d
             INNER JOIN product p ON p.product_id = d.product_id
             WHERE d.pr_id = :pr_id
             ORDER BY d.pr_detail_id ASC"
        );

        $supStmt = $this->conn->prepare(
            "SELECT ps.supplier_id, s.supplier_name, ps.supplier_unit_cost
             FROM product_supplier ps
             INNER JOIN supplier s ON s.supplier_id = ps.supplier_id
             WHERE ps.product_id = :pid AND s.is_active = 1
             ORDER BY s.supplier_name ASC"
        );

        $filteredRows = array();
        foreach ($rows as $row) {
            $prId = (int)$row['pr_id'];
            $itemStmt->execute(array(':pr_id' => $prId));
            $items = $itemStmt->fetchAll();

            $totalReq = 0;
            $totalApp = 0;
            $totalRes = 0;
            $totalRel = 0;
            $totalOrd = 0;
            $totalRec = 0;
            $totalOut = 0;
            $totalRem = 0;
            $totalAvail = 0;
            $totalIncoming = 0;
            $totalShortage = 0;
            $totalNetShortage = 0;
            $allSufficient = true;

            foreach ($items as &$item) {
                $pid = (int)$item['product_id'];
                $m = productInventoryMetrics($this->conn, $pid, false, $prId);
                $usableOnHand = $m ? (int)$m['usable_stock'] : 0;
                $allReserved = $m ? (int)$m['reserved_stock'] : 0;
                $availUnreserved = $m ? max(0, $usableOnHand - $allReserved) : 0;
                $incomingSupply = $m ? (int)($m['outstanding_po_qty'] ?? $m['on_order_qty'] ?? 0) : 0;

                $reqQty = (int)$item['requested_qty'];
                $appQty = (int)$item['approved_qty'];
                $resQty = (int)$item['reserved_qty'];
                $relQty = (int)$item['released_qty'];
                $ordQty = (int)$item['ordered_qty'];
                $recQty = (int)$item['received_qty'];
                $outQty = max(0, $appQty - max($relQty, $recQty));
                $remApproved = max(0, $appQty - $relQty - $resQty - $ordQty);

                $shortageQty = max(0, $remApproved - $availUnreserved);
                $openPoForThisPr = max(0, $ordQty - $recQty);
                $otherIncoming = max(0, $incomingSupply - $openPoForThisPr);
                $netShortageQty = max(0, $shortageQty - $otherIncoming);
                $stockSufficient = ($availUnreserved >= $remApproved);

                if (!$stockSufficient && $remApproved > 0) {
                    $allSufficient = false;
                }

                $item['requested_qty'] = $reqQty;
                $item['approved_qty'] = $appQty;
                $item['reserved_qty'] = $resQty;
                $item['released_qty'] = $relQty;
                $item['ordered_qty'] = $ordQty;
                $item['received_qty'] = $recQty;
                $item['outstanding_qty'] = $outQty;
                $item['remaining_approved_qty'] = $remApproved;
                $item['remaining_to_order'] = $remApproved;
                $item['available_stock'] = $availUnreserved;
                $item['available_unreserved_stock'] = $availUnreserved;
                $item['incoming_supply_qty'] = $incomingSupply;
                $item['other_incoming_supply_qty'] = $otherIncoming;
                $item['shortage_qty'] = $shortageQty;
                $item['net_shortage_qty'] = $netShortageQty;
                $item['recommended_po_qty'] = $shortageQty;
                $item['stock_sufficient'] = $stockSufficient;
                $item['requires_po'] = ($shortageQty > 0);

                $supStmt->execute(array(':pid' => $pid));
                $item['suppliers'] = $supStmt->fetchAll();

                $totalReq += $reqQty;
                $totalApp += $appQty;
                $totalRes += $resQty;
                $totalRel += $relQty;
                $totalOrd += $ordQty;
                $totalRec += $recQty;
                $totalOut += $outQty;
                $totalRem += $remApproved;
                $totalAvail += $availUnreserved;
                $totalIncoming += $incomingSupply;
                $totalShortage += $shortageQty;
                $totalNetShortage += $netShortageQty;
            }
            unset($item);

            // If all approved units have already been released or ordered, skip from active PO queue
            if ($totalOut <= 0 && $totalRem <= 0) {
                continue;
            }

            $row['requested_qty'] = $totalReq;
            $row['approved_qty'] = $totalApp;
            $row['reserved_qty'] = $totalRes;
            $row['released_qty'] = $totalRel;
            $row['ordered_qty'] = $totalOrd;
            $row['received_qty'] = $totalRec;
            $row['outstanding_qty'] = $totalOut;
            $row['remaining_qty'] = $totalRem;
            $row['available_stock'] = $totalAvail;
            $row['incoming_supply_qty'] = $totalIncoming;
            $row['shortage_qty'] = $totalShortage;
            $row['net_shortage_qty'] = $totalNetShortage;
            $row['stock_sufficient'] = $allSufficient;
            $row['requires_po'] = ($totalShortage > 0);
            $row['fulfillment_recommendation'] = $allSufficient ? 'reserve_or_release_stock' : 'create_purchase_order';
            $row['fulfillment_status'] = $this->deriveFulfillmentStatus((string)$row['status'], $totalApp, $totalRes, $totalRel, $totalOrd, $totalRec);
            $row['items'] = $items;
            $filteredRows[] = $row;
        }

        return $filteredRows;
    }
}

$conn = getConnection();
$method = $_SERVER['REQUEST_METHOD'];

$api = new PurchaseRequestApi($conn);
$api->handleRequest($method);
