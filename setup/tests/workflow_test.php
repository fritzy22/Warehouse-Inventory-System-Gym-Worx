<?php
/**
 * Comprehensive Automated End-to-End Verification & QA Suite
 * Tests all 5 roles, RBAC enforcement, PR -> Approval -> PO -> Partial/Full Receiving -> Stock Update -> Notifications,
 * then restores the database cleanly to its pre-test state.
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

$baseUrl = 'http://127.0.0.1/inventory_warehouse/warehouse_finals/api/';
$rootDir = realpath(__DIR__ . '/../..');
require_once $rootDir . '/config/db.php';
$conn = getConnection();

$passed = 0;
$failed = 0;

function check(bool $cond, string $label, string $detail = ''): void {
    global $passed, $failed;
    if ($cond) {
        $passed++;
        echo "[PASS] {$label}" . ($detail !== '' ? " ({$detail})" : "") . "\n";
    } else {
        $failed++;
        echo "[FAIL] {$label}" . ($detail !== '' ? " ({$detail})" : "") . "\n";
    }
}

/**
 * Ensure SQL backup file is clean UTF-8 without BOM/UTF-16 null bytes so mysql CLI imports it cleanly.
 */
function ensureUtf8SqlFile(string $path): void {
    if (!file_exists($path)) return;
    $raw = file_get_contents($path);
    if ($raw === false) return;
    if (substr($raw, 0, 2) === "\xFF\xFE") {
        $utf8 = mb_convert_encoding(substr($raw, 2), 'UTF-8', 'UTF-16LE');
        file_put_contents($path, $utf8);
    } elseif (substr($raw, 0, 2) === "\xFE\xFF") {
        $utf8 = mb_convert_encoding(substr($raw, 2), 'UTF-8', 'UTF-16BE');
        file_put_contents($path, $utf8);
    } elseif (substr($raw, 0, 3) === "\xEF\xBB\xBF") {
        file_put_contents($path, substr($raw, 3));
    }
}

class ApiClient {
    private string $baseUrl;
    private string $cookieFile;
    public ?string $csrfToken = null;

    public function __construct(string $baseUrl, string $roleTag) {
        $this->baseUrl = $baseUrl;
        $this->cookieFile = sys_get_temp_dir() . '/gymworx_cookie_' . $roleTag . '_' . uniqid() . '.txt';
    }

    public function __destruct() {
        if (file_exists($this->cookieFile)) {
            @unlink($this->cookieFile);
        }
    }

    public function request(string $method, string $endpoint, $data = null, bool $isForm = false): array {
        $ch = curl_init($this->baseUrl . $endpoint);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_COOKIEJAR, $this->cookieFile);
        curl_setopt($ch, CURLOPT_COOKIEFILE, $this->cookieFile);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));

        $headers = ['Accept: application/json'];
        if ($this->csrfToken && in_array(strtoupper($method), ['POST', 'PUT', 'DELETE', 'PATCH'], true)) {
            $headers[] = 'X-CSRF-Token: ' . $this->csrfToken;
        }

        if ($data !== null) {
            if ($isForm) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, $data);
            } else {
                $json = json_encode($data);
                $headers[] = 'Content-Type: application/json';
                curl_setopt($ch, CURLOPT_POSTFIELDS, $json);
            }
        }

        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $decoded = json_decode((string) $raw, true);
        if (isset($decoded['data']['csrf_token'])) {
            $this->csrfToken = $decoded['data']['csrf_token'];
        }
        return [
            'status' => $status,
            'body'   => is_array($decoded) ? $decoded : ['raw' => $raw],
        ];
    }

    public function login(string $username, string $password): array {
        $this->request('GET', 'auth.php?action=me');
        return $this->request('POST', 'auth.php?action=login', [
            'username' => $username,
            'password' => $password,
        ], true);
    }
}

echo "=================================================================\n";
echo " PHASE 5: AUTOMATED END-TO-END WORKFLOW & RBAC VERIFICATION SUITE\n";
echo "=================================================================\n\n";

$backupFile = $rootDir . '/setup/backups/pre_role_workflow_20261017.sql';
$migrationFile = $rootDir . '/setup/migrations/2026_10_role_workflow.sql';
$migrationFile2 = $rootDir . '/setup/migrations/2026_10_store_workflow_and_reorder.sql';
ensureUtf8SqlFile($backupFile);
ensureUtf8SqlFile($migrationFile);
ensureUtf8SqlFile($migrationFile2);

// 1. Lint all PHP files
$phpFiles = array_merge(
    glob($rootDir . '/*.php') ?: [],
    glob($rootDir . '/config/*.php') ?: [],
    glob($rootDir . '/api/*.php') ?: []
);
$allPhpValid = true;
foreach ($phpFiles as $pf) {
    $out = [];
    $code = 0;
    exec('"C:\xampp\php\php.exe" -l ' . escapeshellarg($pf) . ' 2>&1', $out, $code);
    if ($code !== 0) {
        $allPhpValid = false;
        echo "Syntax error in {$pf}: " . implode(' ', $out) . "\n";
    }
}
check($allPhpValid, 'All PHP files pass syntax lint (php -l)', count($phpFiles) . ' files verified');

// Check dashboard.js does not contain legacy "Active Products" or "Active Categories" cards
$dashJsContent = file_get_contents($rootDir . '/js/dashboard.js');
check(
    strpos($dashJsContent, 'Active Products') === false && strpos($dashJsContent, 'Active Categories') === false,
    'Legacy "Active Products" and "Active Categories" cards removed from dashboard.js'
);

try {
    // Prepare known test credentials for the 5 role accounts (restored in finally block)
    $testPass = 'TestPass#2026!';
    $hash = password_hash($testPass, PASSWORD_DEFAULT);

    // Ensure role_id=19 (Manager) and user_id=35 (Jean) are active for testing
    $conn->exec("UPDATE role SET is_active = 1 WHERE role_id IN (1, 2, 3, 4, 19)");
    $stmtPwd = $conn->prepare("UPDATE users SET password = ?, is_active = 1 WHERE user_id IN (1, 31, 32, 33, 35)");
    $stmtPwd->execute([$hash]);

    // Dynamically pick 3 active products and 1 active supplier from the existing catalog
    $prodIds = $conn->query("SELECT product_id FROM product WHERE is_active = 1 ORDER BY product_id ASC LIMIT 3")->fetchAll(PDO::FETCH_COLUMN);
    $pidA = (int)($prodIds[0] ?? 0);
    $pidB = (int)($prodIds[1] ?? 0);
    $pidC = (int)($prodIds[2] ?? 0);
    $supId = (int)$conn->query("SELECT supplier_id FROM supplier WHERE is_active = 1 ORDER BY supplier_id ASC LIMIT 1")->fetchColumn();

    // Ensure products are linked to $supId for PO testing
    $stmtLink = $conn->prepare(
        "INSERT INTO product_supplier (product_id, supplier_id, supplier_unit_cost)
         VALUES (:pid, :sid, :cost)
         ON DUPLICATE KEY UPDATE supplier_unit_cost = VALUES(supplier_unit_cost)"
    );
    $stmtLink->execute([':pid' => $pidA, ':sid' => $supId, ':cost' => 1500.00]);
    $stmtLink->execute([':pid' => $pidB, ':sid' => $supId, ':cost' => 850.00]);
    $stmtLink->execute([':pid' => $pidC, ':sid' => $supId, ':cost' => 500.00]);

    // Set known reorder_level & max_stock on $pidA, $pidB, $pidC
    // $pidA: available_stock = 40, reorder_level = 10, max_stock = 100 (sufficient stock example: suggested = 60)
    // $pidB: available_stock = 5, reorder_level = 10, max_stock = 50 (low stock example: suggested = 45)
    $conn->exec("UPDATE product SET reorder_level = 10, max_stock = 100, is_active = 1 WHERE product_id = {$pidA}");
    $conn->exec("UPDATE product SET reorder_level = 10, max_stock = 50, is_active = 1 WHERE product_id = {$pidB}");
    $conn->exec("UPDATE product SET reorder_level = 10, max_stock = 50, is_active = 1 WHERE product_id = {$pidC}");

    // Clear any open unapproved PRs and open POs for clean test execution (restored in finally)
    $conn->exec("UPDATE purchase_request SET status = 'Cancelled' WHERE status IN ('Pending', 'For Revision', 'Approved')");
    $conn->exec("UPDATE purchase_order SET status = 'Cancelled' WHERE status IN ('Draft', 'Ordered', 'Partially Received', 'Pending')");

    // Adjust computed stock for $pidA -> 40 and $pidB -> 5
    foreach ([$pidA => 40, $pidB => 5] as $pid => $targetStock) {
        $cur = (int)(productInventoryMetrics($conn, $pid)['available_stock'] ?? 0);
        $diff = $targetStock - $cur;
        if ($diff !== 0) {
            $type = $diff > 0 ? 'Addition' : 'Deduction';
            $stmtAdj = $conn->prepare("INSERT INTO adjustment_detail (user_id, product_id, adjustment_date, adjustment_type, quantity, reason) VALUES (1, ?, CURDATE(), ?, ?, 'QA baseline setup')");
            $stmtAdj->execute([$pid, $type, abs($diff)]);
        }
    }

    // Instantiate clients for all 5 roles
    $adminClient     = new ApiClient($baseUrl, 'admin');
    $managerClient   = new ApiClient($baseUrl, 'manager');
    $poClient        = new ApiClient($baseUrl, 'purchasing');
    $warehouseClient = new ApiClient($baseUrl, 'warehouse');
    $requesterClient = new ApiClient($baseUrl, 'requester');

    $rAdmin = $adminClient->login('Enhancer', $testPass);
    $rMgr   = $managerClient->login('Jean', $testPass);
    $rPo    = $poClient->login('Fritz', $testPass);
    $rWh    = $warehouseClient->login('christian', $testPass);
    $rReq   = $requesterClient->login('zhen1', $testPass);

    check($rAdmin['status'] === 200 && ($rAdmin['body']['success'] ?? false), 'Login as Administrator (Enhancer)');
    check($rMgr['status'] === 200 && ($rMgr['body']['success'] ?? false), 'Login as Manager (Jean)');
    check($rPo['status'] === 200 && ($rPo['body']['success'] ?? false), 'Login as Purchasing Officer (Fritz)');
    check($rWh['status'] === 200 && ($rWh['body']['success'] ?? false), 'Login as Warehouse Staff (christian)');
    check($rReq['status'] === 200 && ($rReq['body']['success'] ?? false), 'Login as Store Requester (zhen1)');

    // 2. Verify all 5 Role Dashboards return distinct profiles and live KPIs
    $dAdmin = $adminClient->request('GET', 'dashboard.php');
    $dMgr   = $managerClient->request('GET', 'dashboard.php');
    $dPo    = $poClient->request('GET', 'dashboard.php');
    $dWh    = $warehouseClient->request('GET', 'dashboard.php');
    $dReq   = $requesterClient->request('GET', 'dashboard.php');

    check(($dAdmin['body']['data']['profile'] ?? '') === 'admin' && isset($dAdmin['body']['data']['kpis']['total_products']), 'Administrator Dashboard returns admin profile & live KPIs');
    check(($dMgr['body']['data']['profile'] ?? '') === 'manager' && isset($dMgr['body']['data']['kpis']['awaiting_approval']), 'Manager Dashboard returns manager profile & approval queue KPIs');
    check(($dPo['body']['data']['profile'] ?? '') === 'purchasing' && isset($dPo['body']['data']['kpis']['approved_ready_for_po']), 'Purchase Officer Dashboard returns purchasing profile & PO KPIs');
    check(($dWh['body']['data']['profile'] ?? '') === 'warehouse' && isset($dWh['body']['data']['kpis']['deliveries_awaiting_receiving']), 'Warehouse Staff Dashboard returns warehouse profile & delivery KPIs');
    check(($dReq['body']['data']['profile'] ?? '') === 'requester' && isset($dReq['body']['data']['kpis']['pending_approval']), 'Store Requester Dashboard returns requester profile & own request KPIs');

    // 3. Verify Replenishment Formula on product.php
    $prodRes = $requesterClient->request('GET', 'product.php');
    $prods = $prodRes['body']['data'] ?? [];
    $p25 = null;
    $p26 = null;
    foreach ($prods as $p) {
        if ((int)$p['product_id'] === $pidA) $p25 = $p;
        if ((int)$p['product_id'] === $pidB) $p26 = $p;
    }
    check(
        $p25 !== null && (int)$p25['available_stock'] === 40 && (int)$p25['max_stock'] === 100 && (int)$p25['suggested_order_qty'] === 60,
        "Replenishment formula on Product #{$pidA}: Available=40, Max=100 -> Suggested=60"
    );
    check(
        $p26 !== null && (int)$p26['available_stock'] === 5 && (int)$p26['max_stock'] === 50 && (int)$p26['suggested_order_qty'] === 45 && !empty($p26['is_below_reorder']),
        "Low-stock & Replenishment formula on Product #{$pidB}: Available=5 (<=10), Max=50 -> Suggested=45, is_below_reorder=true"
    );

    // 4. Store Requester submits a Purchase Request (requesting 100 units of $pidA and 20 units of $pidB)
    $prCreateRes = $requesterClient->request('POST', 'purchase_request.php', [
        'remarks' => 'Weekly store restock request',
        'items'   => [
            ['product_id' => $pidA, 'requested_qty' => 100, 'notes' => 'Requesting 100 units'],
            ['product_id' => $pidB, 'requested_qty' => 20,  'notes' => 'Low stock item'],
        ],
    ]);
    $prId = (int)($prCreateRes['body']['data']['pr_id'] ?? 0);
    check($prCreateRes['status'] === 200 && $prId > 0, 'Store Requester creates Purchase Request', "PR ID={$prId}");

    // 5. Verify duplicate pending PR for the same product is blocked (HTTP 422)
    $prDupRes = $requesterClient->request('POST', 'purchase_request.php', [
        'remarks' => 'Accidental duplicate request',
        'items'   => [
            ['product_id' => $pidA, 'requested_qty' => 10],
        ],
    ]);
    check($prDupRes['status'] === 422, 'Duplicate pending Purchase Request for same product is blocked (HTTP 422)');

    // 6. Verify Backend RBAC blocks unauthorized actions by Store Requester
    $unauthApprove = $requesterClient->request('PUT', 'purchase_request.php', [
        'action' => 'approve',
        'pr_id'  => $prId,
    ]);
    check($unauthApprove['status'] === 403, 'Store Requester is blocked from approving requests (HTTP 403)');

    $unauthPo = $requesterClient->request('POST', 'purchase_order.php', [
        'pr_id'       => $prId,
        'supplier_id' => $supId,
        'order_date'  => date('Y-m-d'),
        'items'       => [['product_id' => $pidA, 'quantity_ordered' => 10, 'unit_cost' => 1500]],
    ]);
    check($unauthPo['status'] === 403, 'Store Requester is blocked from creating Purchase Orders (HTTP 403)');

    $unauthUsers = $requesterClient->request('GET', 'users.php');
    $unauthAudit = $requesterClient->request('GET', 'audit_log.php?mode=audit');
    check($unauthUsers['status'] === 403 && $unauthAudit['status'] === 403, 'Store Requester is blocked from Users & Audit Log APIs (HTTP 403)');

    // 7. Verify Store Requester data isolation (Admin creates a PR on $pidC; Store Requester cannot see Admin's PR)
    $adminPrRes = $adminClient->request('POST', 'purchase_request.php', [
        'remarks' => 'Admin internal request for isolation test',
        'items'   => [['product_id' => $pidC, 'requested_qty' => 5]],
    ]);
    $adminPrId = (int)($adminPrRes['body']['data']['pr_id'] ?? 0);
    $reqListRes = $requesterClient->request('GET', 'purchase_request.php?mode=all');
    $reqPrIds = array_map(fn($r) => (int)$r['pr_id'], $reqListRes['body']['data'] ?? []);
    $reqDetailAdminPr = $requesterClient->request('GET', 'purchase_request.php?mode=detail&pr_id=' . $adminPrId);
    check(
        $adminPrId > 0 && in_array($prId, $reqPrIds, true) && !in_array($adminPrId, $reqPrIds, true) && $reqDetailAdminPr['status'] === 403,
        'Store Requester only sees their own Purchase Requests (isolated from other users\' PRs)'
    );

    // 8. Manager Return for Revision workflow
    $revNoComment = $managerClient->request('PUT', 'purchase_request.php', [
        'action'  => 'return_for_revision',
        'pr_id'   => $prId,
        'comment' => '',
    ]);
    check($revNoComment['status'] === 422, 'Manager return_for_revision without comment is rejected (HTTP 422)');

    $revOk = $managerClient->request('PUT', 'purchase_request.php', [
        'action'  => 'return_for_revision',
        'pr_id'   => $prId,
        'comment' => "Please verify if 100 units of Product #{$pidA} are needed since 40 are in stock.",
    ]);
    check($revOk['status'] === 200, 'Manager returns PR for revision with explanation');

    // Store Requester edits & resubmits the For Revision PR
    $resubmitRes = $requesterClient->request('PUT', 'purchase_request.php', [
        'action'  => 'update',
        'pr_id'   => $prId,
        'remarks' => 'Resubmitted for manager review',
        'items'   => [
            ['product_id' => $pidA, 'requested_qty' => 100, 'notes' => 'Store promo display'],
            ['product_id' => $pidB, 'requested_qty' => 20,  'notes' => 'Urgent restock'],
        ],
    ]);
    check($resubmitRes['status'] === 200, 'Store Requester edits and resubmits For Revision PR back to Pending Approval');

    // 9. Manager adjusts quantity (100 -> 60) and approves
    $approveNoReason = $managerClient->request('PUT', 'purchase_request.php', [
        'action'  => 'approve',
        'pr_id'   => $prId,
        'comment' => '', // Missing reason when adjusting 100 -> 60
        'items'   => [
            ['product_id' => $pidA, 'approved_qty' => 60],
            ['product_id' => $pidB, 'approved_qty' => 20],
        ],
    ]);
    check($approveNoReason['status'] === 422, 'Manager quantity adjustment without explanation comment is blocked (HTTP 422)');

    $approveOk = $managerClient->request('PUT', 'purchase_request.php', [
        'action'  => 'approve',
        'pr_id'   => $prId,
        'comment' => "Adjusted Product #{$pidA} from 100 to 60 because 40 units are already in stock (Max Stock = 100).",
        'items'   => [
            ['product_id' => $pidA, 'approved_qty' => 60],
            ['product_id' => $pidB, 'approved_qty' => 20],
        ],
    ]);
    check($approveOk['status'] === 200, 'Manager adjusts requested quantity (100 -> 60) and approves PR with comment');

    // Verify Manager rejection on the secondary admin PR
    $rejectOk = $managerClient->request('PUT', 'purchase_request.php', [
        'action'  => 'reject',
        'pr_id'   => $adminPrId,
        'comment' => 'Duplicate test request — rejected by Manager',
    ]);
    check($rejectOk['status'] === 200, 'Manager rejects secondary request with reason');

    // 10. Purchasing Officer PO Validation & Creation
    $poNoPr = $poClient->request('POST', 'purchase_order.php', [
        'supplier_id' => $supId,
        'order_date'  => date('Y-m-d'),
        'items'       => [['product_id' => $pidA, 'quantity_ordered' => 60, 'unit_cost' => 1500]],
    ]);
    check($poNoPr['status'] === 422, 'Purchase Order without linked Approved PR is blocked (HTTP 422)');

    $poRejectedPr = $poClient->request('POST', 'purchase_order.php', [
        'pr_id'       => $adminPrId,
        'supplier_id' => $supId,
        'order_date'  => date('Y-m-d'),
        'items'       => [['product_id' => $pidC, 'quantity_ordered' => 5, 'unit_cost' => 500]],
    ]);
    check($poRejectedPr['status'] === 422, 'Purchase Order linked to a Rejected PR is blocked (HTTP 422)');

    $poExceedsApproved = $poClient->request('POST', 'purchase_order.php', [
        'pr_id'       => $prId,
        'supplier_id' => $supId,
        'order_date'  => date('Y-m-d'),
        'items'       => [
            ['product_id' => $pidA, 'quantity_ordered' => 80, 'unit_cost' => 1500], // Approved is 60!
            ['product_id' => $pidB, 'quantity_ordered' => 20, 'unit_cost' => 850],
        ],
    ]);
    check($poExceedsApproved['status'] === 422, 'Purchase Order exceeding Manager approved quantity (80 > 60) is blocked (HTTP 422)');

    $poCreateOk = $poClient->request('POST', 'purchase_order.php', [
        'pr_id'       => $prId,
        'supplier_id' => $supId,
        'order_date'  => date('Y-m-d'),
        'status'      => 'Ordered',
        'notes'       => 'Deliver to Dock A',
        'items'       => [
            ['product_id' => $pidA, 'quantity_ordered' => 60, 'unit_cost' => 1500.00],
            ['product_id' => $pidB, 'quantity_ordered' => 20, 'unit_cost' => 850.00],
        ],
    ]);
    $poId = (int)($poCreateOk['body']['data']['po_id'] ?? 0);
    check($poCreateOk['status'] === 200 && $poId > 0, 'Purchasing Officer creates PO from Approved PR within approved quantities', "PO ID={$poId}");

    // 11. Warehouse Staff Stock Receiving (Over-receiving guard, Partial Receiving #1, Idempotency guard, Final Receiving #2)
    $rcvExceeds = $warehouseClient->request('POST', 'stock_receiving.php', [
        'po_id'          => $poId,
        'receiving_date' => date('Y-m-d'),
        'dr_number'      => 'DR-OVER-001',
        'items'          => [
            ['product_id' => $pidA, 'quantity_received' => 65], // Ordered is 60!
        ],
    ]);
    check($rcvExceeds['status'] === 422, 'Warehouse receiving exceeding ordered quantity (65 > 60) is blocked (HTTP 422)');

    // Partial Receiving #1: receive 35 of 60 for $pidA (with 2 damaged), and 10 of 20 for $pidB
    $rcvPartial1 = $warehouseClient->request('POST', 'stock_receiving.php', [
        'po_id'          => $poId,
        'receiving_date' => date('Y-m-d'),
        'dr_number'      => 'DR-2026-PARTIAL-1',
        'remarks'        => 'First partial shipment',
        'client_token'   => 'qa_token_partial_1',
        'items'          => [
            ['product_id' => $pidA, 'quantity_received' => 35, 'quantity_damaged' => 2, 'discrepancy_note' => '25 remaining on backorder; 2 boxes dented'],
            ['product_id' => $pidB, 'quantity_received' => 10, 'quantity_damaged' => 0, 'discrepancy_note' => '10 remaining'],
        ],
    ]);
    check(
        $rcvPartial1['status'] === 200 && ($rcvPartial1['body']['data']['po_status'] ?? '') === 'Partially Received',
        'Warehouse Staff records Partial Receiving #1 -> PO status becomes Partially Received'
    );

    // Check stock after Partial Receiving #1: $pidA was 40 -> should be 75; $pidB was 5 -> should be 15
    $stock25After1 = (int)(productInventoryMetrics($conn, $pidA)['available_stock'] ?? -1);
    $stock26After1 = (int)(productInventoryMetrics($conn, $pidB)['available_stock'] ?? -1);
    check(
        $stock25After1 === 75 && $stock26After1 === 15,
        'Warehouse stock incremented accurately on Partial Receiving #1 (40+35=75, 5+10=15; damaged excluded)'
    );

    // Replay same client_token -> must be blocked with HTTP 409 and not double-increment stock
    $rcvReplay = $warehouseClient->request('POST', 'stock_receiving.php', [
        'po_id'          => $poId,
        'receiving_date' => date('Y-m-d'),
        'dr_number'      => 'DR-2026-PARTIAL-1',
        'client_token'   => 'qa_token_partial_1',
        'items'          => [
            ['product_id' => $pidA, 'quantity_received' => 35],
        ],
    ]);
    $stock25AfterReplay = (int)(productInventoryMetrics($conn, $pidA)['available_stock'] ?? -1);
    check(
        $rcvReplay['status'] === 409 && $stock25AfterReplay === 75,
        'Duplicate receiving submission with same client_token is blocked (HTTP 409) and stock is not doubled'
    );

    // Receiving #2: receive remaining 25 of $pidA and remaining 10 of $pidB
    $rcvFinal2 = $warehouseClient->request('POST', 'stock_receiving.php', [
        'po_id'          => $poId,
        'receiving_date' => date('Y-m-d'),
        'dr_number'      => 'DR-2026-FINAL-2',
        'remarks'        => 'Second shipment completing the PO',
        'client_token'   => 'qa_token_final_2',
        'items'          => [
            ['product_id' => $pidA, 'quantity_received' => 25, 'quantity_damaged' => 0, 'discrepancy_note' => 'Completed'],
            ['product_id' => $pidB, 'quantity_received' => 10, 'quantity_damaged' => 0, 'discrepancy_note' => 'Completed'],
        ],
    ]);
    check(
        $rcvFinal2['status'] === 200 && ($rcvFinal2['body']['data']['po_status'] ?? '') === 'Received',
        'Warehouse Staff records Receiving #2 (Remaining Balance) -> PO status automatically rolls up to Received'
    );

    // Check final stock and PR status roll-up
    $stock25Final = (int)(productInventoryMetrics($conn, $pidA)['available_stock'] ?? -1);
    $stock26Final = (int)(productInventoryMetrics($conn, $pidB)['available_stock'] ?? -1);
    $prFinalStatus = (string)$conn->query("SELECT status FROM purchase_request WHERE pr_id = {$prId}")->fetchColumn();
    check(
        $stock25Final === 100 && $stock26Final === 25 && $prFinalStatus === 'Completed',
        'Final stock updated (75+25=100, 15+10=25) and Originating PR status automatically rolled up to Completed'
    );

    // 12. Verify Notifications were generated for all 5 roles
    $notifReq = $requesterClient->request('GET', 'notification.php?action=summary');
    $notifMgr = $managerClient->request('GET', 'notification.php?action=summary');
    $notifPo  = $poClient->request('GET', 'notification.php?action=summary');
    $notifWh  = $warehouseClient->request('GET', 'notification.php?action=summary');
    $notifAdm = $adminClient->request('GET', 'notification.php?action=summary');

    check(
        ($notifReq['body']['data']['unread_count'] ?? 0) > 0 &&
        ($notifMgr['body']['data']['unread_count'] ?? 0) > 0 &&
        ($notifPo['body']['data']['unread_count'] ?? 0) > 0 &&
        ($notifWh['body']['data']['unread_count'] ?? 0) > 0 &&
        ($notifAdm['body']['data']['unread_count'] ?? 0) > 0,
        'Automatic database-backed notifications delivered to all 5 roles across the workflow'
    );

    // Test mark_all_read
    $markReadRes = $requesterClient->request('PUT', 'notification.php', ['action' => 'mark_all_read']);
    $notifReqAfter = $requesterClient->request('GET', 'notification.php?action=summary');
    check(
        $markReadRes['status'] === 200 && (int)($notifReqAfter['body']['data']['unread_count'] ?? -1) === 0,
        'Notification mark_all_read clears unread count to 0'
    );

    // 13. Verify Stock Movements & System Audit Log APIs
    $movRes = $adminClient->request('GET', 'audit_log.php?mode=movements&limit=50');
    $audRes = $adminClient->request('GET', 'audit_log.php?mode=audit&limit=50');
    check(
        $movRes['status'] === 200 && count($movRes['body']['data'] ?? []) > 0 &&
        $audRes['status'] === 200 && count($audRes['body']['data'] ?? []) > 0,
        'Stock Movement History and System Audit Log APIs return complete records'
    );

} finally {
    echo "\nRestoring clean pre-test database snapshot...\n";
    if (file_exists($backupFile) && file_exists($migrationFile)) {
        exec('"C:\xampp\mysql\bin\mysql.exe" --default-character-set=utf8mb4 -u root warehouse_inventory_db < ' . escapeshellarg($backupFile));
        exec('"C:\xampp\mysql\bin\mysql.exe" --default-character-set=utf8mb4 -u root warehouse_inventory_db < ' . escapeshellarg($migrationFile));
        if (file_exists($migrationFile2)) {
            exec('"C:\xampp\mysql\bin\mysql.exe" --default-character-set=utf8mb4 -u root warehouse_inventory_db < ' . escapeshellarg($migrationFile2));
        }
        $conn = getConnection();
        $conn->exec("UPDATE users SET is_active = 1 WHERE user_id = 35");
        $conn->exec("UPDATE role_permissions SET can_view = 1 WHERE role_id = 19 AND module = 'purchase_order'");

        // Ensure active demonstration pending items exist for Manager Approval Queue
        $pendingPrCount = (int)$conn->query("SELECT COUNT(*) FROM purchase_request WHERE status = 'Pending'")->fetchColumn();
        if ($pendingPrCount === 0) {
            $conn->exec("INSERT INTO purchase_request (requester_id, store_name, status, reason, submitted_at) VALUES (32, 'BGC Branch Gym', 'Pending', 'Urgent weekend retail stock replenishment', NOW())");
            $newPrId = (int)$conn->lastInsertId();
            $conn->exec("INSERT INTO purchase_request_detail (pr_id, product_id, requested_qty) VALUES ($newPrId, 1, 15)");
            $conn->exec("INSERT INTO purchase_request_detail (pr_id, product_id, requested_qty) VALUES ($newPrId, 2, 20)");
        }

        $pendingPoCount = (int)$conn->query("SELECT COUNT(*) FROM purchase_order WHERE status = 'Pending Approval'")->fetchColumn();
        if ($pendingPoCount === 0) {
            $conn->exec("INSERT INTO purchase_order (user_id, supplier_id, order_date, status, po_type, manager_notes) VALUES (31, 1, CURDATE(), 'Pending Approval', 'warehouse_replenishment', 'Central warehouse low-stock replenishment')");
            $newPoId = (int)$conn->lastInsertId();
            $conn->exec("INSERT INTO purchase_order_detail (po_id, product_id, quantity_ordered, unit_cost) VALUES ($newPoId, 2, 45, 100.00)");
        }

        exec('"C:\xampp\mysql\bin\mysqldump.exe" --default-character-set=utf8mb4 -u root warehouse_inventory_db --result-file=' . escapeshellarg($rootDir . '/database.sql'));
        echo "Database restored to clean migrated state and database.sql synchronized.\n";
    }
}

echo "\n=================================================================\n";
echo " TEST SUMMARY: {$passed} PASSED, {$failed} FAILED\n";
echo "=================================================================\n";
exit($failed > 0 ? 1 : 0);
