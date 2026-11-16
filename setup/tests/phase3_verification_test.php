<?php
/**
 * Phase 3 Formal Verification Test Suite
 * Inventory and Warehouse Management System (GymWorx Warehouse)
 *
 * Verifies all 10 required Phase 3 scenarios:
 * 1. Draft creation (Store Requester saves PR as Draft with products, quantities, purpose, urgency, remarks).
 * 2. PR submission (Submitting a Draft PR & direct submission; unique PR reference number; Pending Approval status; duplicate submission prevention).
 * 3. Manager approval (Records Manager ID & timestamp; sets approval_status = Approved; does NOT deduct stock; does NOT auto-create PO).
 * 4. Manager rejection with reason (Requires reason; sets approval_status = Rejected; notifies requester).
 * 5. Return for revision (Requires Manager comments; sets approval_status = Returned for Revision; preserves history).
 * 6. Requester revision and resubmission (Original requester edits and resubmits; returns to Pending Approval; preserves review history).
 * 7. Approved PR appearing in the purchasing queue (Visible in Purchasing Officer's Approved PR Queue).
 * 8. Rejected PR remaining excluded from purchasing (Excluded from Approved PR Queue; PO creation against rejected PR is blocked).
 * 9. Request tracking, notifications, and audit history (Requested, Approved, Reserved, Released, Outstanding quantities; separate approval & fulfillment statuses; Manager comments; transaction history; notifications; audit_log).
 * 10. Unauthorized approval attempts & self-approval attempts (Store Requester, Admin, Purchasing Officer, Warehouse Officer blocked from approving; self-approval blocked).
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

$rootDir = realpath(__DIR__ . '/../..');
require_once $rootDir . '/config/db.php';
require_once $rootDir . '/config/permissions.php';
require_once $rootDir . '/config/inventory.php';

$conn = getConnection();

echo "=================================================================\n";
echo " PHASE 3 VERIFICATION & PURCHASE REQUEST WORKFLOW TEST SUITE\n";
echo "=================================================================\n\n";

$passedCount = 0;
$failedCount = 0;

function assertCheck(bool $condition, string $title, string $details = ''): void {
    global $passedCount, $failedCount;
    if ($condition) {
        $passedCount++;
        echo " [PASS] " . $title . ($details !== '' ? " -> " . $details : "") . "\n";
    } else {
        $failedCount++;
        echo " [FAIL] " . $title . ($details !== '' ? " -> " . $details : "") . "\n";
    }
}

class Phase3HttpTester {
    private string $cookieFile;
    public string $csrfToken = '';
    private string $baseUrl;

    public function __construct(string $baseUrl, string $name) {
        $this->baseUrl = rtrim($baseUrl, '/') . '/';
        $this->cookieFile = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'gw_p3_cookie_' . $name . '_' . uniqid() . '.txt';
    }

    public function __destruct() {
        if (file_exists($this->cookieFile)) {
            @unlink($this->cookieFile);
        }
    }

    public function request(string $method, string $endpoint, ?array $payload = null): array {
        $ch = curl_init($this->baseUrl . ltrim($endpoint, '/'));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
        curl_setopt($ch, CURLOPT_COOKIEJAR, $this->cookieFile);
        curl_setopt($ch, CURLOPT_COOKIEFILE, $this->cookieFile);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);

        $headers = ['Accept: application/json'];
        if ($this->csrfToken !== '') {
            $headers[] = 'X-CSRF-Token: ' . $this->csrfToken;
        }

        if ($payload !== null) {
            $json = json_encode($payload);
            $headers[] = 'Content-Type: application/json';
            curl_setopt($ch, CURLOPT_POSTFIELDS, $json);
        }

        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $json = json_decode((string)$raw, true);
        if (isset($json['data']['csrf_token'])) {
            $this->csrfToken = $json['data']['csrf_token'];
        }
        return ['status' => $code, 'data' => $json, 'raw' => $raw];
    }

    public function login(string $username, string $password): array {
        $this->request('GET', 'auth.php?action=me');
        return $this->request('POST', 'auth.php?action=login', [
            'username' => $username,
            'password' => $password
        ]);
    }
}

// Spin up built-in PHP server on 127.0.0.1:8090
$serverHost = '127.0.0.1';
$serverPort = 8090;
$serverBase = "http://{$serverHost}:{$serverPort}/warehouse_finals/api/";
$docRoot = realpath(__DIR__ . '/../../../');

$serverCmd = sprintf(
    'powershell -NoProfile -Command "Start-Process -FilePath \'C:\xampp\php\php.exe\' -ArgumentList \'-S %s:%d -t \"%s\"\' -WindowStyle Hidden"',
    $serverHost,
    $serverPort,
    $docRoot
);
pclose(popen($serverCmd, 'r'));
usleep(700000);

// Backup user passwords to restore after test
$origUsers = $conn->query("SELECT user_id, password, is_active FROM users WHERE user_id IN (1, 31, 32, 33, 35)")->fetchAll();
$testPassword = 'TestPass#2026!';
$testHash = password_hash($testPassword, PASSWORD_DEFAULT);
$conn->prepare("UPDATE users SET password = ?, is_active = 1 WHERE user_id IN (1, 31, 32, 33, 35)")->execute([$testHash]);

$createdPrIds = [];
$createdReservationIds = [];
$createdReleasingIds = [];
$testProd1Id = 0;
$testProd2Id = 0;
$maxNotifIdBefore = (int)$conn->query("SELECT COALESCE(MAX(notification_id), 0) FROM notification")->fetchColumn();
$maxAuditIdBefore = (int)$conn->query("SELECT COALESCE(MAX(audit_id), 0) FROM audit_log")->fetchColumn();

try {
    $admin = new Phase3HttpTester($serverBase, 'admin');
    $requester = new Phase3HttpTester($serverBase, 'requester');
    $manager = new Phase3HttpTester($serverBase, 'manager');
    $purchasing = new Phase3HttpTester($serverBase, 'purchasing');
    $warehouse = new Phase3HttpTester($serverBase, 'warehouse');

    $rAdmin = $admin->login('Enhancer', $testPassword);
    $rReq = $requester->login('zhen1', $testPassword);
    $rMgr = $manager->login('Jean', $testPassword);
    $rPo = $purchasing->login('Fritz', $testPassword);
    $rWh = $warehouse->login('christian', $testPassword);

    echo "--- Step 0: Authenticate All 5 System Roles ---\n";
    assertCheck(
        $rAdmin['status'] === 200 && $rReq['status'] === 200 && $rMgr['status'] === 200 && $rPo['status'] === 200 && $rWh['status'] === 200,
        'All 5 active role accounts authenticated for Phase 3 testing'
    );

    // Create 2 temporary products so existing open PRs (like PR-0079) are completely untouched
    $catId = (int)$conn->query("SELECT category_id FROM category WHERE is_active = 1 ORDER BY category_id ASC LIMIT 1")->fetchColumn();
    $supId = (int)$conn->query("SELECT supplier_id FROM supplier WHERE is_active = 1 ORDER BY supplier_id ASC LIMIT 1")->fetchColumn();

    $p1Res = $admin->request('POST', 'product.php', [
        'product_name' => 'Phase3 Test Kettlebell 16kg ' . uniqid(),
        'category_id' => $catId,
        'unit_measure' => 'Piece',
        'unit_price' => 1800.00,
        'reorder_level' => 10,
        'max_stock' => 60,
        'opening_stock' => 20,
        'opening_reason' => 'Phase 3 test opening stock',
        'supplier_ids' => [$supId]
    ]);
    $testProd1Id = (int)($p1Res['data']['data']['product_id'] ?? 0);

    $p2Res = $admin->request('POST', 'product.php', [
        'product_name' => 'Phase3 Test Slam Ball 10kg ' . uniqid(),
        'category_id' => $catId,
        'unit_measure' => 'Piece',
        'unit_price' => 1200.00,
        'reorder_level' => 10,
        'max_stock' => 50,
        'opening_stock' => 15,
        'opening_reason' => 'Phase 3 test opening stock',
        'supplier_ids' => [$supId]
    ]);
    $testProd2Id = (int)($p2Res['data']['data']['product_id'] ?? 0);

    $initialStockP1 = (int)(productInventoryMetrics($conn, $testProd1Id)['available_stock'] ?? 0);
    $initialStockP2 = (int)(productInventoryMetrics($conn, $testProd2Id)['available_stock'] ?? 0);

    // =========================================================================
    // 1. Test 1: Draft Creation (Workflow A)
    // =========================================================================
    echo "\n--- Test 1: Draft Purchase Request Creation ---\n";
    $draftToken = 'p3_draft_tok_' . uniqid();
    $resDraft = $requester->request('POST', 'purchase_request.php', [
        'save_as_draft' => true,
        'client_token' => $draftToken,
        'store_name' => 'Makati Branch Gym',
        'purpose' => 'Q4 Free Weights Display Restock',
        'urgency' => 'High',
        'remarks' => 'Prepare before Friday fitness promo',
        'items' => [
            ['product_id' => $testProd1Id, 'requested_qty' => 12, 'notes' => 'Rack row A'],
            ['product_id' => $testProd2Id, 'requested_qty' => 8, 'notes' => 'Functional zone']
        ]
    ]);
    $draftPrId = (int)($resDraft['data']['data']['pr_id'] ?? 0);
    if ($draftPrId > 0) {
        $createdPrIds[] = $draftPrId;
    }
    assertCheck(
        $resDraft['status'] === 200 && ($resDraft['data']['success'] ?? false) && $draftPrId > 0,
        'Store Requester saves Purchase Request as Draft',
        "pr_id={$draftPrId}, status=" . ($resDraft['data']['data']['status'] ?? '')
    );

    $draftDetailRes = $requester->request('GET', "purchase_request.php?mode=detail&pr_id={$draftPrId}");
    $draftDetail = $draftDetailRes['data']['data'] ?? [];
    assertCheck(
        ($draftDetail['status'] ?? '') === 'Draft'
        && ($draftDetail['approval_status'] ?? '') === 'Draft'
        && ($draftDetail['fulfillment_status'] ?? '') === 'Draft',
        'Draft PR has status=Draft, approval_status=Draft, fulfillment_status=Draft'
    );
    assertCheck(
        ($draftDetail['purpose'] ?? '') === 'Q4 Free Weights Display Restock'
        && ($draftDetail['urgency'] ?? '') === 'High'
        && ($draftDetail['remarks'] ?? '') === 'Prepare before Friday fitness promo'
        && count($draftDetail['items'] ?? []) === 2,
        'Draft PR preserves multiple products, requested quantities, purpose, urgency, and remarks'
    );

    // Manager should NOT see unsubmitted Draft in Pending queue or receive notification yet
    $mgrNotifBeforeSubmit = (int)$conn->query(
        "SELECT COUNT(*) FROM notification WHERE ref_type = 'purchase_request' AND ref_id = {$draftPrId} AND type = 'pr_pending_approval'"
    )->fetchColumn();
    assertCheck($mgrNotifBeforeSubmit === 0, 'Saving as Draft does not prematurely notify Manager');

    // Requester updates the Draft before submitting
    $resUpdateDraft = $requester->request('PUT', 'purchase_request.php', [
        'action' => 'save_draft',
        'pr_id' => $draftPrId,
        'purpose' => 'Q4 Free Weights Display Restock (Updated)',
        'urgency' => 'Urgent',
        'remarks' => 'Updated draft quantities before submission',
        'items' => [
            ['product_id' => $testProd1Id, 'requested_qty' => 15, 'notes' => 'Rack row A'],
            ['product_id' => $testProd2Id, 'requested_qty' => 10, 'notes' => 'Functional zone']
        ]
    ]);
    assertCheck(
        $resUpdateDraft['status'] === 200 && ($resUpdateDraft['data']['data']['status'] ?? '') === 'Draft',
        'Store Requester can edit and re-save a Draft PR while keeping status=Draft'
    );

    // =========================================================================
    // 2. Test 2: PR Submission & Duplicate Prevention (Workflow A)
    // =========================================================================
    echo "\n--- Test 2: Purchase Request Submission & Duplicate Prevention ---\n";
    $resSubmitDraft = $requester->request('PUT', 'purchase_request.php', [
        'action' => 'submit',
        'pr_id' => $draftPrId
    ]);
    $prCode1 = (string)($resSubmitDraft['data']['data']['pr_code'] ?? '');
    assertCheck(
        $resSubmitDraft['status'] === 200
        && ($resSubmitDraft['data']['success'] ?? false)
        && preg_match('/^PR-\d{4,}$/', $prCode1) === 1,
        'Submitted PR receives unique reference number',
        "pr_code={$prCode1}"
    );
    assertCheck(
        ($resSubmitDraft['data']['data']['approval_status'] ?? '') === 'Pending Approval'
        && ($resSubmitDraft['data']['data']['fulfillment_status'] ?? '') === 'Awaiting Approval',
        'Submitted PR transitions to approval_status="Pending Approval" and fulfillment_status="Awaiting Approval"'
    );

    // Verify Manager received a notification upon submission
    $mgrNotifAfterSubmit = (int)$conn->query(
        "SELECT COUNT(*) FROM notification WHERE ref_type = 'purchase_request' AND ref_id = {$draftPrId} AND type = 'pr_pending_approval'"
    )->fetchColumn();
    assertCheck($mgrNotifAfterSubmit >= 1, 'Manager receives notification when PR is submitted for approval');

    // Verify duplicate client_token submission is blocked (HTTP 409)
    $resDupToken = $requester->request('POST', 'purchase_request.php', [
        'client_token' => $draftToken,
        'purpose' => 'Duplicate token attempt',
        'urgency' => 'Normal',
        'items' => [['product_id' => $testProd1Id, 'requested_qty' => 5]]
    ]);
    assertCheck($resDupToken['status'] === 409, 'Duplicate PR submission with same client_token is rejected (HTTP 409)');

    // Verify duplicate pending product submission is blocked (HTTP 422)
    $resDupPendingProd = $requester->request('POST', 'purchase_request.php', [
        'purpose' => 'Second overlapping pending request for same product',
        'urgency' => 'Normal',
        'items' => [['product_id' => $testProd1Id, 'requested_qty' => 5]]
    ]);
    assertCheck($resDupPendingProd['status'] === 422, 'Submitting a second Pending PR for a product already awaiting approval is blocked (HTTP 422)');

    // Verify stock was NOT deducted when PR was created or submitted
    $stockAfterSubmitP1 = (int)(productInventoryMetrics($conn, $testProd1Id)['available_stock'] ?? 0);
    assertCheck(
        $stockAfterSubmitP1 === $initialStockP1,
        'Stock is NOT deducted when a Purchase Request is created or submitted',
        "available_stock={$stockAfterSubmitP1} (expected {$initialStockP1})"
    );

    // =========================================================================
    // 3. Test 10: Unauthorized Approval & Self-Approval Attempts
    // =========================================================================
    echo "\n--- Test 3 (Rule Check): Unauthorized Approval Attempts & Self-Approval ---\n";
    // Store Requester attempts to approve their own PR
    $resReqApprove = $requester->request('PUT', 'purchase_request.php', [
        'action' => 'approve',
        'pr_id' => $draftPrId,
        'comment' => 'Requester trying to self-approve'
    ]);
    assertCheck($resReqApprove['status'] === 403, 'Store Requester cannot approve Purchase Requests (HTTP 403)');

    // Admin attempts to approve PR
    $resAdminApprove = $admin->request('PUT', 'purchase_request.php', [
        'action' => 'approve',
        'pr_id' => $draftPrId,
        'comment' => 'Admin trying to approve PR'
    ]);
    assertCheck($resAdminApprove['status'] === 403, 'Admin cannot perform Manager PR approvals (HTTP 403)');

    // Purchasing Officer attempts to approve PR
    $resPoApprove = $purchasing->request('PUT', 'purchase_request.php', [
        'action' => 'approve',
        'pr_id' => $draftPrId,
        'comment' => 'Purchasing Officer trying to approve PR'
    ]);
    assertCheck($resPoApprove['status'] === 403, 'Purchasing Officer cannot approve Purchase Requests (HTTP 403)');

    // Warehouse Officer attempts to approve PR
    $resWhApprove = $warehouse->request('PUT', 'purchase_request.php', [
        'action' => 'approve',
        'pr_id' => $draftPrId,
        'comment' => 'Warehouse Officer trying to approve PR'
    ]);
    assertCheck($resWhApprove['status'] === 403, 'Warehouse Officer cannot approve Purchase Requests (HTTP 403)');

    // =========================================================================
    // 4. Test 5: Return for Revision (Workflow B)
    // =========================================================================
    echo "\n--- Test 4: Manager Return for Revision ---\n";
    // Attempt return for revision without comments -> must fail HTTP 422
    $resRevNoComment = $manager->request('PUT', 'purchase_request.php', [
        'action' => 'return_for_revision',
        'pr_id' => $draftPrId,
        'comment' => ''
    ]);
    assertCheck($resRevNoComment['status'] === 422, 'Manager Return for Revision without comments is rejected (HTTP 422)');

    // Manager returns PR for revision with comments
    $resReturnRev = $manager->request('PUT', 'purchase_request.php', [
        'action' => 'return_for_revision',
        'pr_id' => $draftPrId,
        'manager_comment' => 'Please reduce Kettlebell 16kg from 15 to 12 units and confirm urgency.'
    ]);
    assertCheck(
        $resReturnRev['status'] === 200
        && ($resReturnRev['data']['data']['approval_status'] ?? '') === 'Returned for Revision'
        && ($resReturnRev['data']['data']['status'] ?? '') === 'For Revision',
        'Manager returns PR for revision; approval_status becomes "Returned for Revision"'
    );

    // =========================================================================
    // 5. Test 6: Requester Revision and Resubmission (Workflow B)
    // =========================================================================
    echo "\n--- Test 5: Requester Revision & Resubmission ---\n";
    // Another user (e.g. Manager) cannot edit/resubmit the requester's PR
    $resMgrEdit = $manager->request('PUT', 'purchase_request.php', [
        'action' => 'update',
        'pr_id' => $draftPrId,
        'purpose' => 'Unauthorized edit',
        'items' => [['product_id' => $testProd1Id, 'requested_qty' => 12]]
    ]);
    assertCheck($resMgrEdit['status'] === 403, 'Non-requester cannot edit or resubmit the PR (HTTP 403)');

    // Original Store Requester edits and resubmits the PR
    $resResubmit = $requester->request('PUT', 'purchase_request.php', [
        'action' => 'resubmit',
        'pr_id' => $draftPrId,
        'purpose' => 'Q4 Free Weights Display Restock (Revised per Manager)',
        'urgency' => 'High',
        'remarks' => 'Adjusted Kettlebell 16kg to 12 units as requested by Manager Jean',
        'items' => [
            ['product_id' => $testProd1Id, 'requested_qty' => 12, 'notes' => 'Revised to 12 units'],
            ['product_id' => $testProd2Id, 'requested_qty' => 10, 'notes' => 'Functional zone']
        ]
    ]);
    assertCheck(
        $resResubmit['status'] === 200
        && ($resResubmit['data']['data']['approval_status'] ?? '') === 'Pending Approval'
        && ($resResubmit['data']['data']['status'] ?? '') === 'Pending',
        'Original requester edits and resubmits PR; status returns to "Pending Approval"'
    );

    // Check that previous review history is preserved
    $resAfterResubmit = $manager->request('GET', "purchase_request.php?mode=detail&pr_id={$draftPrId}");
    $histActions = array_column($resAfterResubmit['data']['data']['history'] ?? [], 'action');
    assertCheck(
        in_array('DRAFT_CREATED', $histActions, true)
        && in_array('SUBMITTED', $histActions, true)
        && in_array('RETURNED_FOR_REVISION', $histActions, true)
        && in_array('RESUBMITTED', $histActions, true),
        'Previous review and revision history is preserved in purchase_request_history',
        'Actions: ' . implode(' -> ', $histActions)
    );

    // =========================================================================
    // 6. Test 3: Manager Approval (Workflow B)
    // =========================================================================
    echo "\n--- Test 6: Manager Approval Decision ---\n";
    $poCountBeforeApprove = (int)$conn->query("SELECT COUNT(*) FROM purchase_order WHERE pr_id = {$draftPrId}")->fetchColumn();

    $resApprove = $manager->request('PUT', 'purchase_request.php', [
        'action' => 'approve',
        'pr_id' => $draftPrId,
        'manager_comment' => 'Approved after revision; Slam Ball adjusted from 10 to 8 units.',
        'items' => [
            ['product_id' => $testProd1Id, 'approved_qty' => 12],
            ['product_id' => $testProd2Id, 'approved_qty' => 8, 'adjustment_reason' => '8 units fit current rack']
        ]
    ]);
    assertCheck(
        $resApprove['status'] === 200
        && ($resApprove['data']['success'] ?? false)
        && ($resApprove['data']['data']['approval_status'] ?? '') === 'Approved',
        'Manager approves PR and sets approval_status to "Approved"'
    );

    $approvedRow = $conn->query("SELECT status, approval_status, fulfillment_status, reviewed_by, reviewed_at, manager_comment FROM purchase_request WHERE pr_id = {$draftPrId}")->fetch();
    assertCheck(
        (int)($approvedRow['reviewed_by'] ?? 0) === 35 && !empty($approvedRow['reviewed_at']),
        'Manager ID (reviewed_by=35) and approval timestamp (reviewed_at) are recorded in MySQL',
        "reviewed_by={$approvedRow['reviewed_by']}, reviewed_at={$approvedRow['reviewed_at']}"
    );
    assertCheck(
        ($approvedRow['approval_status'] ?? '') === 'Approved'
        && ($approvedRow['fulfillment_status'] ?? '') === 'Pending Fulfillment',
        'Approval status ("Approved") is kept separate from Fulfillment status ("Pending Fulfillment")'
    );

    // Verify no automatic Purchase Order was created upon PR approval
    $poCountAfterApprove = (int)$conn->query("SELECT COUNT(*) FROM purchase_order WHERE pr_id = {$draftPrId}")->fetchColumn();
    assertCheck(
        $poCountBeforeApprove === 0 && $poCountAfterApprove === 0,
        'Approving a Purchase Request does NOT automatically create a Purchase Order'
    );

    // Verify stock was NOT deducted upon PR approval
    $stockAfterApproveP1 = (int)(productInventoryMetrics($conn, $testProd1Id)['available_stock'] ?? 0);
    $stockAfterApproveP2 = (int)(productInventoryMetrics($conn, $testProd2Id)['available_stock'] ?? 0);
    assertCheck(
        $stockAfterApproveP1 === $initialStockP1 && $stockAfterApproveP2 === $initialStockP2,
        'Approving a Purchase Request does NOT deduct warehouse stock',
        "P1={$stockAfterApproveP1}, P2={$stockAfterApproveP2}"
    );

    // Attempting to approve an already-Approved PR is blocked (HTTP 409)
    $resDoubleApprove = $manager->request('PUT', 'purchase_request.php', [
        'action' => 'approve',
        'pr_id' => $draftPrId,
        'comment' => 'Duplicate approval attempt'
    ]);
    assertCheck($resDoubleApprove['status'] === 409, 'Invalid status transition (re-approving an already Approved PR) is rejected (HTTP 409)');

    // =========================================================================
    // 7. Test 4: Manager Rejection with Reason (Workflow B)
    // =========================================================================
    echo "\n--- Test 7: Manager Rejection with Reason ---\n";
    // Create a second PR to test rejection
    $resPr2 = $requester->request('POST', 'purchase_request.php', [
        'store_name' => 'BGC Branch Gym',
        'purpose' => 'Unscheduled promotional giveaway request',
        'urgency' => 'Low',
        'remarks' => 'Testing rejection workflow',
        'items' => [
            ['product_id' => $testProd1Id, 'requested_qty' => 5]
        ]
    ]);
    $rejectPrId = (int)($resPr2['data']['data']['pr_id'] ?? 0);
    if ($rejectPrId > 0) {
        $createdPrIds[] = $rejectPrId;
    }
    assertCheck($resPr2['status'] === 200 && $rejectPrId > 0, 'Store Requester submits second PR for rejection test', "pr_id={$rejectPrId}");

    // Manager attempts to reject without reason -> blocked HTTP 422
    $resRejectNoReason = $manager->request('PUT', 'purchase_request.php', [
        'action' => 'reject',
        'pr_id' => $rejectPrId,
        'comment' => '   '
    ]);
    assertCheck($resRejectNoReason['status'] === 422, 'Manager rejection without a reason is blocked (HTTP 422)');

    // Manager rejects with a clear reason
    $resRejectOk = $manager->request('PUT', 'purchase_request.php', [
        'action' => 'reject',
        'pr_id' => $rejectPrId,
        'manager_comment' => 'Promotional giveaway budget is frozen for this quarter.'
    ]);
    assertCheck(
        $resRejectOk['status'] === 200
        && ($resRejectOk['data']['data']['approval_status'] ?? '') === 'Rejected'
        && ($resRejectOk['data']['data']['fulfillment_status'] ?? '') === 'Not Fulfilled',
        'Manager rejects PR with reason; approval_status="Rejected" and fulfillment_status="Not Fulfilled"'
    );

    // =========================================================================
    // 8. Test 7 & Test 8: Purchasing Queue Visibility & Exclusion of Rejected PRs
    // =========================================================================
    echo "\n--- Test 8: Purchasing Officer Approved PR Queue & Exclusion of Rejected PRs ---\n";
    $resPoQueue = $purchasing->request('GET', 'purchase_request.php?mode=approved_for_po');
    $poQueueData = $resPoQueue['data']['data'] ?? [];
    $queuePrIds = array_map('intval', array_column($poQueueData, 'pr_id'));

    assertCheck(
        $resPoQueue['status'] === 200 && in_array($draftPrId, $queuePrIds, true),
        'Approved PR (#'.$draftPrId.') appears in Purchasing Officer Approved PR Queue (mode=approved_for_po)'
    );
    assertCheck(
        !in_array($rejectPrId, $queuePrIds, true),
        'Rejected PR (#'.$rejectPrId.') is excluded from Purchasing Officer Approved PR Queue'
    );

    // Verify Purchasing Officer cannot create a PO from a Rejected PR
    $resPoFromRejected = $purchasing->request('POST', 'purchase_order.php', [
        'pr_id' => $rejectPrId,
        'supplier_id' => $supId,
        'order_date' => date('Y-m-d'),
        'items' => [
            ['product_id' => $testProd1Id, 'quantity_ordered' => 5, 'unit_cost' => 1500.00]
        ]
    ]);
    assertCheck(
        $resPoFromRejected['status'] === 422 || $resPoFromRejected['status'] === 409,
        'Rejected PR is blocked from Purchase Order creation in api/purchase_order.php (HTTP ' . $resPoFromRejected['status'] . ')'
    );

    // =========================================================================
    // 9. Test 9: Request Tracking (Quantities, Separate Statuses, Comments, History)
    // =========================================================================
    echo "\n--- Test 9: Store Requester Request Tracking & Quantity Breakdown ---\n";
    // Simulate a partial stock reservation (4 units of testProd1Id) and a partial stock release (5 units of testProd1Id) against $draftPrId
    $stmtRes = $conn->prepare(
        "INSERT INTO stock_reservation (product_id, pr_id, reserved_qty, status, notes, created_by)
         VALUES (:pid, :pr_id, 4, 'Active', 'Phase 3 reservation tracking test', 33)"
    );
    $stmtRes->execute([':pid' => $testProd1Id, ':pr_id' => $draftPrId]);
    $createdReservationIds[] = (int)$conn->lastInsertId();

    $stmtRel = $conn->prepare(
        "INSERT INTO stock_releasing (pr_id, requested_by, destination_store, user_id, releasing_date)
         VALUES (:pr_id, 'zhenmar macabenlar', 'Makati Branch Gym', 33, CURDATE())"
    );
    $stmtRel->execute([':pr_id' => $draftPrId]);
    $relId = (int)$conn->lastInsertId();
    $createdReleasingIds[] = $relId;

    $stmtRelDet = $conn->prepare(
        "INSERT INTO stock_releasing_detail (releasing_id, product_id, quantity_released)
         VALUES (:rel_id, :pid, 5)"
    );
    $stmtRelDet->execute([':rel_id' => $relId, ':pid' => $testProd1Id]);

    $trackRes = $requester->request('GET', "purchase_request.php?mode=detail&pr_id={$draftPrId}");
    $trackData = $trackRes['data']['data'] ?? [];
    $itemsByPid = [];
    foreach ($trackData['items'] ?? [] as $it) {
        $itemsByPid[(int)$it['product_id']] = $it;
    }
    $item1 = $itemsByPid[$testProd1Id] ?? [];
    $item2 = $itemsByPid[$testProd2Id] ?? [];

    assertCheck(
        (int)($item1['requested_qty'] ?? -1) === 12
        && (int)($item1['approved_qty'] ?? -1) === 12
        && (int)($item1['reserved_qty'] ?? -1) === 4
        && (int)($item1['released_qty'] ?? -1) === 5
        && (int)($item1['outstanding_qty'] ?? -1) === 7,
        'Item #1 tracking displays accurate Requested (12), Approved (12), Reserved (4), Released (5), and Outstanding (7) quantities'
    );
    assertCheck(
        (int)($item2['requested_qty'] ?? -1) === 10
        && (int)($item2['approved_qty'] ?? -1) === 8
        && (int)($item2['reserved_qty'] ?? -1) === 0
        && (int)($item2['released_qty'] ?? -1) === 0
        && (int)($item2['outstanding_qty'] ?? -1) === 8,
        'Item #2 tracking displays accurate Requested (10), Approved (8), Reserved (0), Released (0), and Outstanding (8) quantities'
    );
    assertCheck(
        ($trackData['approval_status'] ?? '') === 'Approved'
        && ($trackData['fulfillment_status'] ?? '') === 'Partially Fulfilled',
        'Approval status ("Approved") remains distinct from Fulfillment status ("Partially Fulfilled")',
        "approval_status={$trackData['approval_status']}, fulfillment_status={$trackData['fulfillment_status']}"
    );
    assertCheck(
        !empty($trackData['manager_comment']) && count($trackData['history'] ?? []) >= 5,
        'Store Requester sees Manager comments and complete transaction history'
    );

    // =========================================================================
    // 10. Verify Notifications & Audit Logs
    // =========================================================================
    echo "\n--- Test 10: Notifications & Audit History Verification ---\n";
    $notifTypes = $conn->query(
        "SELECT DISTINCT type FROM notification WHERE notification_id > {$maxNotifIdBefore} AND ref_id IN ({$draftPrId}, {$rejectPrId})"
    )->fetchAll(PDO::FETCH_COLUMN);

    assertCheck(
        in_array('pr_submitted', $notifTypes, true)
        && in_array('pr_pending_approval', $notifTypes, true)
        && in_array('pr_for_revision', $notifTypes, true)
        && in_array('pr_resubmitted', $notifTypes, true)
        && in_array('pr_approved', $notifTypes, true)
        && in_array('pr_ready_for_po', $notifTypes, true)
        && in_array('pr_rejected', $notifTypes, true),
        'Notifications generated for PR submission, pending approval, return for revision, resubmission, approval, ready for PO, and rejection',
        'Types: ' . implode(', ', $notifTypes)
    );

    $auditActions = $conn->query(
        "SELECT DISTINCT action FROM audit_log WHERE audit_id > {$maxAuditIdBefore} AND record_id IN ({$draftPrId}, {$rejectPrId})"
    )->fetchAll(PDO::FETCH_COLUMN);

    assertCheck(
        in_array('PR_DRAFT', $auditActions, true)
        && in_array('PR_SUBMIT', $auditActions, true)
        && in_array('PR_REVISION', $auditActions, true)
        && in_array('PR_RESUBMIT', $auditActions, true)
        && in_array('PR_APPROVE', $auditActions, true)
        && in_array('PR_REJECT', $auditActions, true),
        'Audit log records PR_DRAFT, PR_SUBMIT, PR_REVISION, PR_RESUBMIT, PR_APPROVE, and PR_REJECT',
        'Actions: ' . implode(', ', $auditActions)
    );

} finally {
    // Clean up temporary Phase 3 test records and restore original user hashes
    foreach ($createdReleasingIds as $relId) {
        if ($relId > 0) {
            $conn->prepare("DELETE FROM stock_releasing_detail WHERE releasing_id = ?")->execute([$relId]);
            $conn->prepare("DELETE FROM stock_releasing WHERE releasing_id = ?")->execute([$relId]);
        }
    }
    foreach ($createdReservationIds as $resId) {
        if ($resId > 0) {
            $conn->prepare("DELETE FROM stock_reservation WHERE reservation_id = ?")->execute([$resId]);
        }
    }
    foreach ($createdPrIds as $prId) {
        if ($prId > 0) {
            $conn->prepare("DELETE FROM notification WHERE ref_type = 'purchase_request' AND ref_id = ?")->execute([$prId]);
            $conn->prepare("DELETE FROM audit_log WHERE record_id = ? AND action LIKE 'PR_%'")->execute([$prId]);
            $conn->prepare("DELETE FROM purchase_request_history WHERE pr_id = ?")->execute([$prId]);
            $conn->prepare("DELETE FROM purchase_request_detail WHERE pr_id = ?")->execute([$prId]);
            $conn->prepare("DELETE FROM purchase_request WHERE pr_id = ?")->execute([$prId]);
        }
    }
    foreach ([$testProd1Id, $testProd2Id] as $pid) {
        if ($pid > 0) {
            $conn->prepare("DELETE FROM audit_log WHERE module = 'product' AND record_id = ?")->execute([$pid]);
            $conn->prepare("DELETE FROM adjustment_detail WHERE product_id = ?")->execute([$pid]);
            $conn->prepare("DELETE FROM product_supplier WHERE product_id = ?")->execute([$pid]);
            $conn->prepare("DELETE FROM product WHERE product_id = ?")->execute([$pid]);
        }
    }

    $restoreUser = $conn->prepare("UPDATE users SET password = ?, is_active = ? WHERE user_id = ?");
    foreach ($origUsers as $u) {
        $restoreUser->execute([$u['password'], $u['is_active'], $u['user_id']]);
    }
}

echo "\n=================================================================\n";
echo " PHASE 3 TEST SUMMARY: {$passedCount} PASSED, {$failedCount} FAILED\n";
echo "=================================================================\n";

exit($failedCount > 0 ? 1 : 0);
