<?php
/**
 * Phase 4 Formal Verification Test Suite
 * Inventory and Warehouse Management System (GymWorx Warehouse)
 *
 * Verifies all 11 required Phase 4 scenarios:
 *  1. Approved PR appears in the correct Purchasing Officer queue.
 *  2. Rejected PR cannot create a linked PO (HTTP 422).
 *  3. Sufficient stock does not require a PO (stock_sufficient=true, shortage=0, un-overridden PO blocked).
 *  4. Shortage calculation is correct (Approved=20, Available unreserved stock=12 -> Shortage=8).
 *  5. Linked PO creation works (for the 8-unit shortage, linked to Approved PR).
 *  6. Independent PO creation works (po_source='Independent', pr_id=NULL, expected delivery date).
 *  7. Draft, Pending PO Approval, Issued/Ordered, On Hold, Closed, and Cancelled statuses work,
 *     with separate order_status, authorization_status, receiving_status, and inspection_status.
 *  8. PO quantities and totals are accurate.
 *  9. Multiple PO allocations (1 PR -> multiple POs, and 1 PO -> multiple PR lines) do not over-purchase.
 * 10. Creating or issuing a PO does not increase inventory.
 * 11. Warehouse receiving queue (mode=pending) shows ONLY eligible authorized & issued POs.
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

$rootDir = realpath(__DIR__ . '/../..');
require_once $rootDir . '/config/db.php';
require_once $rootDir . '/config/permissions.php';
require_once $rootDir . '/config/inventory.php';

$conn = getConnection();

echo "=================================================================\n";
echo " PHASE 4 VERIFICATION SUITE (PURCHASING & PURCHASE ORDERS)\n";
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

class Phase4HttpTester {
    private string $baseUrl;
    private string $cookieFile;
    public ?string $csrfToken = null;

    public function __construct(string $baseUrl, string $tag) {
        $this->baseUrl = $baseUrl;
        $this->cookieFile = sys_get_temp_dir() . '/p4_cookie_' . $tag . '_' . uniqid() . '.txt';
    }

    public function __destruct() {
        if (file_exists($this->cookieFile)) {
            @unlink($this->cookieFile);
        }
    }

    public function request(string $method, string $endpoint, $payload = null): array {
        $ch = curl_init($this->baseUrl . $endpoint);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_COOKIEJAR, $this->cookieFile);
        curl_setopt($ch, CURLOPT_COOKIEFILE, $this->cookieFile);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));

        $headers = ['Accept: application/json'];
        if ($this->csrfToken && in_array(strtoupper($method), ['POST', 'PUT', 'DELETE'], true)) {
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

// -------------------------------------------------------------
// SECTION 0: PHP Syntax Lint & Supplier Non-User Audit
// -------------------------------------------------------------
echo "--- SECTION 0: PHP Syntax Lint & Supplier Non-User Rules ---\n";
$lintFiles = [
    $rootDir . '/api/purchase_order.php',
    $rootDir . '/api/purchase_request.php',
    $rootDir . '/api/supplier.php',
    $rootDir . '/api/product_supplier.php',
    $rootDir . '/api/stock_receiving.php',
    $rootDir . '/config/inventory.php',
    $rootDir . '/config/permissions.php'
];
$allLintOk = true;
foreach ($lintFiles as $f) {
    $out = [];
    $code = 0;
    exec('"C:\xampp\php\php.exe" -l ' . escapeshellarg($f) . ' 2>&1', $out, $code);
    if ($code !== 0) {
        $allLintOk = false;
        echo " Lint error in {$f}: " . implode(' ', $out) . "\n";
    }
}
assertCheck($allLintOk, 'All Phase 4 PHP files pass syntax lint');

$supplierRoleCount = (int)$conn->query("SELECT COUNT(*) FROM role WHERE LOWER(role_name) LIKE '%supplier%'")->fetchColumn();
assertCheck($supplierRoleCount === 0, 'Supplier is not a system user role (0 supplier roles in role table)');
assertCheck(userCan(1, 'supplier', 'manage') && userCan(3, 'supplier', 'manage'), 'Admin and Purchasing Officer can maintain Supplier master data');
assertCheck(userCan(1, 'product_supplier', 'manage') && userCan(3, 'product_supplier', 'manage'), 'Admin and Purchasing Officer can maintain Product-Supplier links');
assertCheck(!userCan(4, 'supplier', 'manage') && !userCan(4, 'purchase_order', 'manage'), 'Store Requester cannot manage suppliers or purchase orders');

// Spin up built-in PHP server on 127.0.0.1:8094
$serverHost = '127.0.0.1';
$serverPort = 8094;
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

// Backup user passwords and restore in finally
$origUsers = $conn->query("SELECT user_id, password, is_active FROM users WHERE user_id IN (1, 31, 32, 33, 35)")->fetchAll();
$testPassword = 'TestPass#2026!';
$testHash = password_hash($testPassword, PASSWORD_DEFAULT);
$conn->prepare("UPDATE users SET password = ?, is_active = 1 WHERE user_id IN (1, 31, 32, 33, 35)")->execute([$testHash]);

// Track created test entities for cleanup
$createdProductIds = [];
$createdSupplierIds = [];
$createdPrIds = [];
$createdPoIds = [];
$createdAdjIds = [];

try {
    $adminClient     = new Phase4HttpTester($serverBase, 'admin');
    $managerClient   = new Phase4HttpTester($serverBase, 'manager');
    $poClient        = new Phase4HttpTester($serverBase, 'purchasing');
    $warehouseClient = new Phase4HttpTester($serverBase, 'warehouse');
    $requesterClient = new Phase4HttpTester($serverBase, 'requester');

    $adminClient->login('Enhancer', $testPassword);
    $managerClient->login('Jean', $testPassword);
    $poClient->login('Fritz', $testPassword);
    $warehouseClient->login('christian', $testPassword);
    $requesterClient->login('zhen1', $testPassword);

    // Create 2 active suppliers via Purchasing Officer
    $sup1Name = 'P4_Primary_Supplier_' . uniqid();
    $sup2Name = 'P4_Secondary_Supplier_' . uniqid();
    $s1Res = $poClient->request('POST', 'supplier.php', [
        'supplier_name'  => $sup1Name,
        'contact_person' => 'Marco Reyes',
        'phone'          => '0917-555-0101',
        'email'          => 'marco@p4primary.test',
        'address'        => 'CDO Industrial Zone'
    ]);
    $s2Res = $poClient->request('POST', 'supplier.php', [
        'supplier_name'  => $sup2Name,
        'contact_person' => 'Elena Cruz',
        'phone'          => '0917-555-0202',
        'email'          => 'elena@p4secondary.test',
        'address'        => 'Divisoria CDO'
    ]);
    $supId1 = (int)$conn->query("SELECT supplier_id FROM supplier WHERE supplier_name = " . $conn->quote($sup1Name))->fetchColumn();
    $supId2 = (int)$conn->query("SELECT supplier_id FROM supplier WHERE supplier_name = " . $conn->quote($sup2Name))->fetchColumn();
    if ($supId1 > 0) $createdSupplierIds[] = $supId1;
    if ($supId2 > 0) $createdSupplierIds[] = $supId2;
    assertCheck($s1Res['status'] === 200 && $supId1 > 0 && $supId2 > 0, 'Purchasing Officer creates and maintains supplier records');

    // Create 3 clean test products via Admin:
    // - Product 1 ($pidShortage): Will have 12 usable stock. Approved PR = 20 -> Shortage = 8!
    // - Product 2 ($pidSufficient): Will have 25 usable stock. Approved PR = 10 -> Shortage = 0 (Stock Sufficient)!
    // - Product 3 ($pidMulti): Will have 0 usable stock. Approved PR = 15 -> Shortage = 15 (for multi-PO & multi-PR tests)!
    $catId = (int)$conn->query("SELECT category_id FROM category WHERE is_active = 1 LIMIT 1")->fetchColumn();

    $p1Name = 'P4_Shortage_Item_' . uniqid();
    $p2Name = 'P4_Sufficient_Item_' . uniqid();
    $p3Name = 'P4_MultiPO_Item_' . uniqid();

    $adminClient->request('POST', 'product.php', [
        'product_name' => $p1Name, 'category_id' => $catId, 'unit_measure' => 'pcs',
        'unit_price' => 500.00, 'reorder_level' => 10, 'max_stock' => 100
    ]);
    $adminClient->request('POST', 'product.php', [
        'product_name' => $p2Name, 'category_id' => $catId, 'unit_measure' => 'pcs',
        'unit_price' => 300.00, 'reorder_level' => 5, 'max_stock' => 80
    ]);
    $adminClient->request('POST', 'product.php', [
        'product_name' => $p3Name, 'category_id' => $catId, 'unit_measure' => 'pcs',
        'unit_price' => 750.00, 'reorder_level' => 10, 'max_stock' => 120
    ]);

    $pidShortage   = (int)$conn->query("SELECT product_id FROM product WHERE product_name = " . $conn->quote($p1Name))->fetchColumn();
    $pidSufficient = (int)$conn->query("SELECT product_id FROM product WHERE product_name = " . $conn->quote($p2Name))->fetchColumn();
    $pidMulti      = (int)$conn->query("SELECT product_id FROM product WHERE product_name = " . $conn->quote($p3Name))->fetchColumn();
    $createdProductIds = [$pidShortage, $pidSufficient, $pidMulti];

    // Link products to suppliers via Purchasing Officer
    $linkRes = $poClient->request('POST', 'product_supplier.php?action=bulk_save', [
        'supplier_id' => $supId1,
        'links' => [
            ['product_id' => $pidShortage,   'supplier_unit_cost' => 450.00],
            ['product_id' => $pidSufficient, 'supplier_unit_cost' => 260.00],
            ['product_id' => $pidMulti,      'supplier_unit_cost' => 700.00]
        ]
    ]);
    $poClient->request('POST', 'product_supplier.php?action=bulk_save', [
        'supplier_id' => $supId2,
        'links' => [
            ['product_id' => $pidShortage,   'supplier_unit_cost' => 455.00],
            ['product_id' => $pidMulti,      'supplier_unit_cost' => 710.00]
        ]
    ]);
    assertCheck($linkRes['status'] === 200, 'Purchasing Officer links products and supplier unit costs via product_supplier.php');

    // Seed exact opening balances via Warehouse Officer:
    // - $pidShortage = 12 usable units
    // - $pidSufficient = 25 usable units
    // - $pidMulti = 0 usable units
    $adj1 = $warehouseClient->request('POST', 'adjustment.php', [
        'product_id'      => $pidShortage,
        'quantity'        => 12,
        'adjustment_type' => 'Opening Balance',
        'reason'          => 'Phase 4 test initial usable stock of 12 units'
    ]);
    if (!empty($adj1['data']['data']['adjustment_id'])) {
        $createdAdjIds[] = (int)$adj1['data']['data']['adjustment_id'];
    }
    $adj2 = $warehouseClient->request('POST', 'adjustment.php', [
        'product_id'      => $pidSufficient,
        'quantity'        => 25,
        'adjustment_type' => 'Opening Balance',
        'reason'          => 'Phase 4 test initial usable stock of 25 units'
    ]);
    if (!empty($adj2['data']['data']['adjustment_id'])) {
        $createdAdjIds[] = (int)$adj2['data']['data']['adjustment_id'];
    }

    // -------------------------------------------------------------
    // TEST 1 & TEST 4: Approved PR Queue & Exact Shortage Calculation
    // (Approved PR = 20, Available unreserved stock = 12 -> Shortage = 8)
    // -------------------------------------------------------------
    echo "\n--- TEST 1 & TEST 4: Approved PR Queue & Shortage Calculation (Approved=20, Stock=12 -> Shortage=8) ---\n";
    $prShortRes = $requesterClient->request('POST', 'purchase_request.php', [
        'store_name' => 'Main Store',
        'purpose'    => 'Phase 4 Shortage Test (20 needed, 12 in stock)',
        'urgency'    => 'High',
        'remarks'    => 'Testing 20 approved vs 12 in stock -> 8 shortage',
        'items'      => [
            ['product_id' => $pidShortage, 'requested_qty' => 20, 'notes' => 'Need 20 units']
        ]
    ]);
    $prShortId = (int)($prShortRes['data']['data']['pr_id'] ?? 0);
    if ($prShortId > 0) $createdPrIds[] = $prShortId;

    // Manager approves PR for 20 units
    $mgrAppShort = $managerClient->request('PUT', 'purchase_request.php', [
        'action'  => 'approve',
        'pr_id'   => $prShortId,
        'comment' => 'Approved 20 units for store fulfillment'
    ]);
    assertCheck($mgrAppShort['status'] === 200, 'Manager approves PR for 20 units');

    // Purchasing Officer checks Approved PR Queue
    $queueRes = $poClient->request('GET', 'purchase_request.php?mode=approved_for_po');
    $queueList = $queueRes['data']['data'] ?? [];
    $foundShortPr = null;
    foreach ($queueList as $qPr) {
        if ((int)$qPr['pr_id'] === $prShortId) {
            $foundShortPr = $qPr;
            break;
        }
    }

    assertCheck($foundShortPr !== null, 'Test 1: Approved PR appears in the Purchasing Officer Approved PR Queue');
    $itemShort = $foundShortPr['items'][0] ?? [];
    assertCheck(
        (int)($itemShort['requested_qty'] ?? -1) === 20 &&
        (int)($itemShort['approved_qty'] ?? -1) === 20 &&
        (int)($itemShort['reserved_qty'] ?? -1) === 0 &&
        (int)($itemShort['released_qty'] ?? -1) === 0 &&
        (int)($itemShort['outstanding_qty'] ?? -1) === 20,
        'Approved PR displays requested (20), approved (20), reserved (0), released (0), and outstanding (20) quantities'
    );
    assertCheck(
        (int)($itemShort['available_unreserved_stock'] ?? -1) === 12 &&
        (int)($itemShort['shortage_qty'] ?? -1) === 8 &&
        (int)($itemShort['recommended_po_qty'] ?? -1) === 8 &&
        !empty($itemShort['requires_po']) &&
        empty($itemShort['stock_sufficient']),
        'Test 4: Shortage calculation is exact -> Approved=20, Available Unreserved Stock=12 => Shortage=8, Recommended PO Qty=8',
        sprintf('Available=%d, Shortage=%d, Recommended=%d', (int)($itemShort['available_unreserved_stock'] ?? -1), (int)($itemShort['shortage_qty'] ?? -1), (int)($itemShort['recommended_po_qty'] ?? -1))
    );

    // -------------------------------------------------------------
    // TEST 2: Rejected PR Cannot Create a Linked PO
    // -------------------------------------------------------------
    echo "\n--- TEST 2: Rejected PR Cannot Create a Linked PO ---\n";
    $prRejCreate = $requesterClient->request('POST', 'purchase_request.php', [
        'store_name' => 'Main Store',
        'purpose'    => 'Phase 4 Rejected PR Test',
        'urgency'    => 'Normal',
        'items'      => [
            ['product_id' => $pidMulti, 'requested_qty' => 5]
        ]
    ]);
    $prRejId = (int)($prRejCreate['data']['data']['pr_id'] ?? 0);
    if ($prRejId > 0) $createdPrIds[] = $prRejId;

    $managerClient->request('PUT', 'purchase_request.php', [
        'action'  => 'reject',
        'pr_id'   => $prRejId,
        'comment' => 'Rejected for budget control'
    ]);

    $poFromRejected = $poClient->request('POST', 'purchase_order.php', [
        'pr_id'       => $prRejId,
        'supplier_id' => $supId1,
        'order_date'  => date('Y-m-d'),
        'items'       => [
            ['product_id' => $pidMulti, 'quantity_ordered' => 5, 'unit_cost' => 700.00]
        ]
    ]);
    assertCheck($poFromRejected['status'] === 422, 'Test 2: Rejected PR cannot create a linked PO (blocked with HTTP 422)');

    // -------------------------------------------------------------
    // TEST 3: Sufficient Stock Does Not Require a PO
    // -------------------------------------------------------------
    echo "\n--- TEST 3: Sufficient Stock Does Not Require a PO ---\n";
    $prSuffCreate = $requesterClient->request('POST', 'purchase_request.php', [
        'store_name' => 'Main Store',
        'purpose'    => 'Phase 4 Sufficient Stock Test (10 needed, 25 in stock)',
        'urgency'    => 'Normal',
        'items'      => [
            ['product_id' => $pidSufficient, 'requested_qty' => 10]
        ]
    ]);
    $prSuffId = (int)($prSuffCreate['data']['data']['pr_id'] ?? 0);
    if ($prSuffId > 0) $createdPrIds[] = $prSuffId;

    $managerClient->request('PUT', 'purchase_request.php', [
        'action'  => 'approve',
        'pr_id'   => $prSuffId,
        'comment' => 'Approved 10 units — fulfill from warehouse stock'
    ]);

    $suffDetailRes = $poClient->request('GET', 'purchase_request.php?mode=detail&pr_id=' . $prSuffId);
    $suffPr = $suffDetailRes['data']['data'] ?? [];
    $suffItem = $suffPr['items'][0] ?? [];

    assertCheck(
        !empty($suffPr['stock_sufficient']) &&
        empty($suffPr['requires_po']) &&
        (int)($suffItem['shortage_qty'] ?? -1) === 0 &&
        ($suffPr['fulfillment_recommendation'] ?? '') === 'reserve_or_release_stock',
        'Test 3a: Approved PR with sufficient stock (Available=25 >= Approved=10) flags stock_sufficient=true, shortage_qty=0, requires_po=false'
    );

    // Attempting to create an un-authorized PO for an item already covered by usable stock is blocked
    $poUnneeded = $poClient->request('POST', 'purchase_order.php', [
        'pr_id'       => $prSuffId,
        'supplier_id' => $supId1,
        'order_date'  => date('Y-m-d'),
        'items'       => [
            ['product_id' => $pidSufficient, 'quantity_ordered' => 10, 'unit_cost' => 260.00]
        ]
    ]);
    assertCheck(
        $poUnneeded['status'] === 422,
        'Test 3b: Creating a PO without authorization when usable stock already covers approved PR quantity is blocked (HTTP 422)'
    );

    // -------------------------------------------------------------
    // TEST 5, TEST 8 & TEST 10: Linked PO Creation for Shortage (8 units),
    // Totals Accuracy, and Inventory Non-Inflation
    // -------------------------------------------------------------
    echo "\n--- TEST 5, TEST 8 & TEST 10: Linked PO Creation for 8-Unit Shortage & Inventory Check ---\n";
    $stockBeforePo = (int)(productInventoryMetrics($conn, $pidShortage, true)['usable_stock'] ?? -1);

    // Also verify enforce_shortage_limit blocks ordering all 20 when only 8 are short
    $poOverShortage = $poClient->request('POST', 'purchase_order.php', [
        'pr_id'                  => $prShortId,
        'supplier_id'            => $supId1,
        'order_date'             => date('Y-m-d'),
        'enforce_shortage_limit' => true,
        'items'                  => [
            ['product_id' => $pidShortage, 'quantity_ordered' => 20, 'unit_cost' => 450.00]
        ]
    ]);
    assertCheck(
        $poOverShortage['status'] === 422,
        'Ordering all 20 units when only 8 units are short is blocked when enforce_shortage_limit is active (HTTP 422)'
    );

    // Create linked PO for the exact 8-unit shortage
    $poShortCreate = $poClient->request('POST', 'purchase_order.php', [
        'pr_id'         => $prShortId,
        'supplier_id'   => $supId1,
        'order_date'    => date('Y-m-d'),
        'expected_date' => date('Y-m-d', strtotime('+5 days')),
        'status'        => 'Ordered',
        'notes'         => 'Ordering 8-unit shortage for ' . $foundShortPr['pr_code'],
        'items'         => [
            ['product_id' => $pidShortage, 'quantity_ordered' => 8, 'unit_cost' => 450.00]
        ]
    ]);
    $poShortData = $poShortCreate['data']['data'] ?? [];
    $poShortId = (int)($poShortData['po_id'] ?? 0);
    if ($poShortId > 0) $createdPoIds[] = $poShortId;

    assertCheck(
        $poShortCreate['status'] === 200 && $poShortId > 0 &&
        ($poShortData['po_source'] ?? '') === 'PR-Linked' &&
        (int)($poShortData['pr_id'] ?? 0) === $prShortId,
        'Test 5: Linked PO created for the 8-unit shortage (po_source=PR-Linked)',
        'PO Code=' . ($poShortData['po_code'] ?? '')
    );

    assertCheck(
        (int)($poShortData['total_qty_ordered'] ?? 0) === 8 &&
        (int)($poShortData['outstanding_qty'] ?? 0) === 8 &&
        abs((float)($poShortData['total_amount'] ?? 0) - 3600.00) < 0.01,
        'Test 8: PO quantities (8 ordered, 8 outstanding) and total cost (8 * 450.00 = PHP 3,600.00) are accurate'
    );

    $stockAfterPo = (int)(productInventoryMetrics($conn, $pidShortage, true)['usable_stock'] ?? -1);
    assertCheck(
        $stockBeforePo === 12 && $stockAfterPo === 12,
        'Test 10: Creating and issuing a Purchase Order does NOT increase inventory (usable_stock remains 12)'
    );

    // Now that 8 units are ordered on PO, remaining unordered on PR is 20 - 8 = 12, which is covered by the 12 in stock!
    // Verify that attempting to order more on the same PR without override is blocked because remaining 12 are covered by stock!
    $poAfterShortageCovered = $poClient->request('POST', 'purchase_order.php', [
        'pr_id'       => $prShortId,
        'supplier_id' => $supId1,
        'order_date'  => date('Y-m-d'),
        'items'       => [
            ['product_id' => $pidShortage, 'quantity_ordered' => 5, 'unit_cost' => 450.00]
        ]
    ]);
    assertCheck(
        $poAfterShortageCovered['status'] === 422,
        'After ordering the 8-unit shortage, remaining 12 approved units are covered by 12 usable stock -> additional un-overridden PO is blocked (HTTP 422)'
    );

    // -------------------------------------------------------------
    // TEST 6 & TEST 7: Independent PO Creation & Full Status Lifecycle
    // (Draft -> Pending PO Approval -> Approved/Issued -> On Hold -> Resumed)
    // -------------------------------------------------------------
    echo "\n--- TEST 6 & TEST 7: Independent PO Creation & Status Lifecycle ---\n";
    $indPoCreate = $poClient->request('POST', 'purchase_order.php', [
        'po_source'     => 'Independent',
        'supplier_id'   => $supId1,
        'order_date'    => date('Y-m-d'),
        'expected_date' => date('Y-m-d', strtotime('+7 days')),
        'status'        => 'Draft',
        'notes'         => 'Independent seasonal stock replenishment',
        'items'         => [
            ['product_id' => $pidMulti, 'quantity_ordered' => 10, 'unit_cost' => 700.00]
        ]
    ]);
    $indPoData = $indPoCreate['data']['data'] ?? [];
    $indPoId = (int)($indPoData['po_id'] ?? 0);
    if ($indPoId > 0) $createdPoIds[] = $indPoId;

    assertCheck(
        $indPoCreate['status'] === 200 && $indPoId > 0 &&
        ($indPoData['po_source'] ?? '') === 'Independent' &&
        ($indPoData['pr_id'] ?? null) === null,
        'Test 6: Independent PO created without a PR reference (po_source=Independent, pr_id=NULL)'
    );

    assertCheck(
        ($indPoData['status'] ?? '') === 'Draft' &&
        ($indPoData['order_status'] ?? '') === 'Draft' &&
        ($indPoData['authorization_status'] ?? '') === 'Draft' &&
        ($indPoData['receiving_status'] ?? '') === 'Not Ready' &&
        ($indPoData['inspection_status'] ?? '') === 'Pending Delivery',
        'Test 7a: Draft PO has separate order_status=Draft, authorization_status=Draft, receiving_status=Not Ready, inspection_status=Pending Delivery'
    );

    // Submit Draft PO for Pending PO Approval
    $subAppRes = $poClient->request('PUT', 'purchase_order.php', [
        'po_id'  => $indPoId,
        'action' => 'submit_for_approval'
    ]);
    $subAppData = $subAppRes['data']['data'] ?? [];
    assertCheck(
        $subAppRes['status'] === 200 &&
        ($subAppData['order_status'] ?? '') === 'Pending PO Approval' &&
        ($subAppData['authorization_status'] ?? '') === 'Pending Approval' &&
        ($subAppData['receiving_status'] ?? '') === 'Not Ready',
        'Test 7b: Submitting Draft PO transitions to order_status=Pending PO Approval, authorization_status=Pending Approval'
    );

    // Manager approves the Pending PO Approval order -> becomes Issued / Ordered and Authorized
    $mgrPoApp = $managerClient->request('PUT', 'purchase_order.php', [
        'po_id'  => $indPoId,
        'action' => 'approve',
        'reason' => 'Approved independent replenishment PO'
    ]);
    $mgrPoAppData = $mgrPoApp['data']['data'] ?? [];
    assertCheck(
        $mgrPoApp['status'] === 200 &&
        ($mgrPoAppData['status'] ?? '') === 'Ordered' &&
        ($mgrPoAppData['order_status'] ?? '') === 'Issued' &&
        ($mgrPoAppData['authorization_status'] ?? '') === 'Authorized' &&
        ($mgrPoAppData['receiving_status'] ?? '') === 'Awaiting Delivery',
        'Test 7c: Manager PO approval transitions order_status=Issued, authorization_status=Authorized, receiving_status=Awaiting Delivery'
    );

    // Place PO On Hold -> excluded from receiving queue
    $holdRes = $poClient->request('PUT', 'purchase_order.php', [
        'po_id'  => $indPoId,
        'action' => 'hold',
        'reason' => 'Supplier requested 2-day dispatch delay'
    ]);
    $holdData = $holdRes['data']['data'] ?? [];
    assertCheck(
        $holdRes['status'] === 200 &&
        ($holdData['status'] ?? '') === 'On Hold' &&
        ($holdData['order_status'] ?? '') === 'On Hold' &&
        ($holdData['receiving_status'] ?? '') === 'Not Ready',
        'Test 7d: Placing PO On Hold sets order_status=On Hold and receiving_status=Not Ready'
    );

    // -------------------------------------------------------------
    // TEST 9: Multiple PO Allocations (1 Approved PR -> Multiple POs,
    // and Over-Purchasing Prevention)
    // -------------------------------------------------------------
    echo "\n--- TEST 9: Multiple PO Allocations & Over-Purchasing Prevention ---\n";
    $prMultiCreate = $requesterClient->request('POST', 'purchase_request.php', [
        'store_name' => 'Main Store',
        'purpose'    => 'Phase 4 Multi-PO Fulfillment Test (15 units needed, 0 in stock)',
        'urgency'    => 'High',
        'items'      => [
            ['product_id' => $pidMulti, 'requested_qty' => 15]
        ]
    ]);
    $prMultiId = (int)($prMultiCreate['data']['data']['pr_id'] ?? 0);
    if ($prMultiId > 0) $createdPrIds[] = $prMultiId;

    $managerClient->request('PUT', 'purchase_request.php', [
        'action'  => 'approve',
        'pr_id'   => $prMultiId,
        'comment' => 'Approved 15 units — may split across suppliers'
    ]);

    // PO #1 orders 9 of the 15 approved units from Supplier 1 (as Draft first, then Issued)
    $multiPo1Res = $poClient->request('POST', 'purchase_order.php', [
        'pr_id'       => $prMultiId,
        'supplier_id' => $supId1,
        'order_date'  => date('Y-m-d'),
        'status'      => 'Draft',
        'items'       => [
            ['product_id' => $pidMulti, 'quantity_ordered' => 9, 'unit_cost' => 700.00]
        ]
    ]);
    $multiPo1Id = (int)($multiPo1Res['data']['data']['po_id'] ?? 0);
    if ($multiPo1Id > 0) $createdPoIds[] = $multiPo1Id;
    assertCheck($multiPo1Res['status'] === 200 && $multiPo1Id > 0, 'Test 9a: First partial PO (9 of 15 units) created as Draft');

    // Attempt to order 7 units on PO #2 (9 + 7 = 16 > 15 approved!) -> MUST be blocked with HTTP 422
    $multiPoOver = $poClient->request('POST', 'purchase_order.php', [
        'pr_id'       => $prMultiId,
        'supplier_id' => $supId2,
        'order_date'  => date('Y-m-d'),
        'status'      => 'Ordered',
        'items'       => [
            ['product_id' => $pidMulti, 'quantity_ordered' => 7, 'unit_cost' => 710.00]
        ]
    ]);
    assertCheck(
        $multiPoOver['status'] === 422,
        'Test 9b: Second PO attempting 7 units when only 6 remain (9+7=16 > 15 approved) is blocked (HTTP 422)'
    );

    // Order the exact remaining 6 units on PO #2 from Supplier 2
    $multiPo2Res = $poClient->request('POST', 'purchase_order.php', [
        'pr_id'       => $prMultiId,
        'supplier_id' => $supId2,
        'order_date'  => date('Y-m-d'),
        'status'      => 'Ordered',
        'items'       => [
            ['product_id' => $pidMulti, 'quantity_ordered' => 6, 'unit_cost' => 710.00]
        ]
    ]);
    $multiPo2Id = (int)($multiPo2Res['data']['data']['po_id'] ?? 0);
    if ($multiPo2Id > 0) $createdPoIds[] = $multiPo2Id;
    assertCheck(
        $multiPo2Res['status'] === 200 && $multiPo2Id > 0,
        'Test 9c: Second partial PO for the remaining 6 units (9+6=15) succeeds'
    );

    // Verify PR detail shows both linked POs and total_ordered_qty = 15
    $prMultiDetail = $poClient->request('GET', 'purchase_request.php?mode=detail&pr_id=' . $prMultiId)['data']['data'] ?? [];
    assertCheck(
        (int)($prMultiDetail['total_ordered_qty'] ?? 0) === 15 &&
        count($prMultiDetail['purchase_orders'] ?? []) === 2,
        'Test 9d: Approved PR tracks both linked POs and total_ordered_qty = 15'
    );

    // -------------------------------------------------------------
    // TEST 11: Warehouse Receiving Queue (mode=pending) Eligibility
    // -------------------------------------------------------------
    echo "\n--- TEST 11: Warehouse Receiving Queue Shows Only Eligible Issued POs ---\n";
    // Right now:
    // - $poShortId is Ordered/Issued -> MUST be in mode=pending
    // - $multiPo2Id is Ordered/Issued -> MUST be in mode=pending
    // - $multiPo1Id is Draft -> MUST NOT be in mode=pending
    // - $indPoId is On Hold -> MUST NOT be in mode=pending
    $rcvQueueRes = $warehouseClient->request('GET', 'purchase_order.php?mode=pending');
    $rcvQueueIds = array_map(fn($r) => (int)$r['po_id'], $rcvQueueRes['data']['data'] ?? []);

    assertCheck(
        in_array($poShortId, $rcvQueueIds, true) && in_array($multiPo2Id, $rcvQueueIds, true),
        'Test 11a: Authorized & Issued POs appear in the Warehouse Receiving Queue (mode=pending)'
    );
    assertCheck(
        !in_array($multiPo1Id, $rcvQueueIds, true) && !in_array($indPoId, $rcvQueueIds, true),
        'Test 11b: Draft PO and On Hold PO are strictly excluded from the Warehouse Receiving Queue'
    );

    // Now issue $multiPo1Id (Draft -> Issued/Ordered) and resume $indPoId (On Hold -> Issued/Ordered),
    // then cancel $multiPo1Id and close $indPoId to verify Cancelled and Closed are also excluded!
    $poClient->request('PUT', 'purchase_order.php', ['po_id' => $multiPo1Id, 'action' => 'issue']);
    $poClient->request('PUT', 'purchase_order.php', ['po_id' => $indPoId, 'action' => 'resume']);

    $rcvQueueAfterIssue = array_map(
        fn($r) => (int)$r['po_id'],
        $warehouseClient->request('GET', 'purchase_order.php?mode=pending')['data']['data'] ?? []
    );
    assertCheck(
        in_array($multiPo1Id, $rcvQueueAfterIssue, true) && in_array($indPoId, $rcvQueueAfterIssue, true),
        'Test 11c: Once Draft PO is Issued and On Hold PO is Resumed, both become available in the Warehouse Receiving Queue'
    );

    // Cancel $multiPo1Id and Close $indPoId
    $cancelRes = $poClient->request('PUT', 'purchase_order.php', [
        'po_id'  => $multiPo1Id,
        'action' => 'cancel',
        'reason' => 'Test cancellation releases PR allocation'
    ]);
    $closeRes = $poClient->request('PUT', 'purchase_order.php', [
        'po_id'  => $indPoId,
        'action' => 'close',
        'reason' => 'Test closing PO'
    ]);
    assertCheck(
        $cancelRes['status'] === 200 && ($cancelRes['data']['data']['order_status'] ?? '') === 'Cancelled' &&
        $closeRes['status'] === 200 && ($closeRes['data']['data']['order_status'] ?? '') === 'Closed',
        'Cancelling and Closing POs update order_status to Cancelled and Closed respectively'
    );

    $rcvQueueAfterClose = array_map(
        fn($r) => (int)$r['po_id'],
        $warehouseClient->request('GET', 'purchase_order.php?mode=pending')['data']['data'] ?? []
    );
    assertCheck(
        !in_array($multiPo1Id, $rcvQueueAfterClose, true) && !in_array($indPoId, $rcvQueueAfterClose, true),
        'Test 11d: Cancelled and Closed POs are excluded from the Warehouse Receiving Queue'
    );

} finally {
    // Clean up test records in reverse dependency order
    if (!empty($createdPoIds)) {
        $inPo = implode(',', array_map('intval', $createdPoIds));
        $conn->exec("DELETE FROM purchase_order_detail WHERE po_id IN ({$inPo})");
        $conn->exec("DELETE FROM purchase_order WHERE po_id IN ({$inPo})");
    }
    if (!empty($createdPrIds)) {
        $inPr = implode(',', array_map('intval', $createdPrIds));
        $conn->exec("DELETE FROM purchase_request_history WHERE pr_id IN ({$inPr})");
        $conn->exec("DELETE FROM stock_reservation WHERE pr_id IN ({$inPr})");
        $conn->exec("DELETE FROM purchase_request_detail WHERE pr_id IN ({$inPr})");
        $conn->exec("DELETE FROM purchase_request WHERE pr_id IN ({$inPr})");
    }
    if (!empty($createdAdjIds)) {
        $inAdj = implode(',', array_map('intval', $createdAdjIds));
        $conn->exec("DELETE FROM adjustment_detail WHERE adjustment_detail_id IN ({$inAdj})");
    }
    if (!empty($createdProductIds)) {
        $inProd = implode(',', array_map('intval', $createdProductIds));
        $conn->exec("DELETE FROM product_supplier WHERE product_id IN ({$inProd})");
        $conn->exec("DELETE FROM product WHERE product_id IN ({$inProd})");
    }
    if (!empty($createdSupplierIds)) {
        $inSup = implode(',', array_map('intval', $createdSupplierIds));
        $conn->exec("DELETE FROM product_supplier WHERE supplier_id IN ({$inSup})");
        $conn->exec("DELETE FROM supplier WHERE supplier_id IN ({$inSup})");
    }

    // Restore user passwords and active flags
    $stmtRestore = $conn->prepare("UPDATE users SET password = :pwd, is_active = :act WHERE user_id = :id");
    foreach ($origUsers as $u) {
        $stmtRestore->execute([
            ':pwd' => $u['password'],
            ':act' => (int)$u['is_active'],
            ':id'  => (int)$u['user_id']
        ]);
    }

    // Stop temporary PHP server on 8094
    exec('powershell -NoProfile -Command "Get-Process -Name php -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like \'*8094*\' } | Stop-Process -Force"');
}

echo "\n=================================================================\n";
echo sprintf(" PHASE 4 VERIFICATION RESULTS: %d PASSED / %d FAILED\n", $passedCount, $failedCount);
echo "=================================================================\n";

exit($failedCount === 0 ? 0 : 1);
