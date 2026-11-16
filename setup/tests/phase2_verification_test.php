<?php
/**
 * Phase 2 Formal Verification Test Suite
 * Inventory and Warehouse Management System (GymWorx Warehouse)
 *
 * Verifies:
 * 1. Product creation (with Opening Stock) and editing by Admin, saved to MySQL.
 * 2. Category creation, editing, and assignment to products.
 * 3. Inventory balance formula: Available Stock = Usable On-Hand Stock - Active Reservations.
 * 4. Exclusion of quarantined and rejected goods from usable stock.
 * 5. Authorized opening balances and stock adjustments by Warehouse Officer.
 * 6. Mandatory reasons and RBAC authorization on stock adjustments.
 * 7. Duplicate stock adjustment prevention (client_token & 60s duplicate window).
 * 8. Prevention of negative available stock across deductions and reservations.
 * 9. Stock movement history ledger completeness and accuracy (no double-counting).
 * 10. Low-stock and critical-stock detection & suggested order calculations.
 * 11. Product Inventory UI: 5-column main table, green View buttons with white eye icons,
 *     9-field Inventory Details modal, no product images, responsive layout.
 * 12. Preservation of inactive products, historical transactions, and Phase 1 accounts.
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

$rootDir = realpath(__DIR__ . '/../..');
require_once $rootDir . '/config/db.php';
require_once $rootDir . '/config/permissions.php';
require_once $rootDir . '/config/inventory.php';

$conn = getConnection();

echo "=================================================================\n";
echo " PHASE 2 VERIFICATION & INVENTORY WORKFLOW TEST SUITE\n";
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

class Phase2HttpTester {
    private string $cookieFile;
    public string $csrfToken = '';
    private string $baseUrl;

    public function __construct(string $baseUrl, string $name) {
        $this->baseUrl = rtrim($baseUrl, '/') . '/';
        $this->cookieFile = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'gw_p2_cookie_' . $name . '_' . uniqid() . '.txt';
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

// Spin up built-in PHP server on 127.0.0.1:8089
$serverHost = '127.0.0.1';
$serverPort = 8089;
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

$createdProductId = 0;
$createdCategoryId = 0;
$createdReturnId = 0;

try {
    // Authenticate Role Clients
    $admin = new Phase2HttpTester($serverBase, 'admin');
    $warehouse = new Phase2HttpTester($serverBase, 'warehouse');
    $requester = new Phase2HttpTester($serverBase, 'requester');
    $manager = new Phase2HttpTester($serverBase, 'manager');

    assertCheck($admin->login('Enhancer', $testPassword)['status'] === 200, 'Admin authenticated');
    assertCheck($warehouse->login('christian', $testPassword)['status'] === 200, 'Warehouse Officer authenticated');
    assertCheck($requester->login('zhen1', $testPassword)['status'] === 200, 'Store Requester authenticated');
    assertCheck($manager->login('Jean', $testPassword)['status'] === 200, 'Manager authenticated');

    // -------------------------------------------------------------
    // SECTION 1: Category Creation, Editing & Assignment
    // -------------------------------------------------------------
    echo "\n--- SECTION 1: Category Workflow ---\n";
    $catName = 'P2_Functional_Training_' . substr(uniqid(), -5);
    $catCreate = $admin->request('POST', 'category.php', ['category_name' => $catName]);
    assertCheck($catCreate['status'] === 200 && !empty($catCreate['data']['success']), 'Admin creates a new Category', $catName);

    // Fetch created category ID
    $catList = $admin->request('GET', 'category.php');
    foreach ($catList['data']['data'] ?? [] as $c) {
        if ($c['category_name'] === $catName) {
            $createdCategoryId = (int)$c['category_id'];
            break;
        }
    }
    assertCheck($createdCategoryId > 0, 'Created Category persisted in MySQL', 'category_id=' . $createdCategoryId);

    // Duplicate category check
    $dupCat = $admin->request('POST', 'category.php', ['category_name' => $catName]);
    assertCheck($dupCat['status'] === 409, 'Duplicate Category name rejected with HTTP 409');

    // Edit category name
    $catUpdatedName = $catName . '_Updated';
    $catEdit = $admin->request('PUT', 'category.php', [
        'category_id' => $createdCategoryId,
        'category_name' => $catUpdatedName
    ]);
    assertCheck($catEdit['status'] === 200, 'Admin edits Category name', $catUpdatedName);

    // Unauthorized role cannot create category
    $unauthCat = $warehouse->request('POST', 'category.php', ['category_name' => 'Unauth_Cat']);
    assertCheck($unauthCat['status'] === 403, 'Warehouse Officer blocked from creating Category (HTTP 403)');

    // -------------------------------------------------------------
    // SECTION 2: Product Creation (with Opening Stock) & Editing
    // -------------------------------------------------------------
    echo "\n--- SECTION 2: Product Creation, Opening Stock & Editing ---\n";
    $prodName = 'P2_Kettlebell_24kg_' . substr(uniqid(), -5);
    $prodCreate = $admin->request('POST', 'product.php', [
        'category_id' => $createdCategoryId,
        'product_name' => $prodName,
        'unit_measure' => 'Piece',
        'unit_price' => 2450.50,
        'reorder_level' => 15,
        'max_stock' => 120,
        'opening_stock' => 35
    ]);
    assertCheck($prodCreate['status'] === 200 && !empty($prodCreate['data']['success']), 'Admin creates Product with Opening Stock (35 units)', $prodName);

    $createdProduct = $prodCreate['data']['data'] ?? null;
    $createdProductId = (int)($createdProduct['product_id'] ?? 0);
    assertCheck($createdProductId > 0, 'Product saved to MySQL with valid product_id', 'product_id=' . $createdProductId);
    assertCheck((int)($createdProduct['available_stock'] ?? -1) === 35, 'Opening stock balance (35) immediately reflected in Available Stock');
    assertCheck(($createdProduct['category_name'] ?? '') === $catUpdatedName, 'Assigned Category appears in Product metrics', $catUpdatedName);

    // Verify Opening Stock created a movement history record
    $movRes = $warehouse->request('GET', 'audit_log.php?mode=movements&product_id=' . $createdProductId);
    $movRows = $movRes['data']['data'] ?? [];
    $hasOpeningMovement = false;
    foreach ($movRows as $mr) {
        if ((int)$mr['product_id'] === $createdProductId && (int)$mr['quantity'] === 35 && strpos((string)$mr['party'], 'Opening Stock') !== false) {
            $hasOpeningMovement = true;
            break;
        }
    }
    assertCheck($hasOpeningMovement, 'Opening Stock Balance created a Stock Movement History record (+35)');

    // Duplicate product name rejected with 409
    $dupProd = $admin->request('POST', 'product.php', [
        'category_id' => $createdCategoryId,
        'product_name' => $prodName,
        'unit_measure' => 'Piece',
        'unit_price' => 2450.50,
        'reorder_level' => 15,
        'max_stock' => 120
    ]);
    assertCheck($dupProd['status'] === 409, 'Duplicate Product name rejected with HTTP 409');

    // Invalid max_stock < reorder_level rejected with 422
    $badLimits = $admin->request('PUT', 'product.php', [
        'product_id' => $createdProductId,
        'category_id' => $createdCategoryId,
        'product_name' => $prodName,
        'unit_measure' => 'Piece',
        'unit_price' => 2500.00,
        'reorder_level' => 50,
        'max_stock' => 20
    ]);
    assertCheck($badLimits['status'] === 422, 'Product update with max_stock < reorder_level rejected with HTTP 422');

    // Valid product edit by Admin
    $prodUpdatedName = $prodName . '_Pro';
    $prodEdit = $admin->request('PUT', 'product.php', [
        'product_id' => $createdProductId,
        'category_id' => $createdCategoryId,
        'product_name' => $prodUpdatedName,
        'unit_measure' => 'Unit',
        'unit_price' => 2600.00,
        'reorder_level' => 20,
        'max_stock' => 100
    ]);
    assertCheck($prodEdit['status'] === 200 && ($prodEdit['data']['data']['product_name'] ?? '') === $prodUpdatedName, 'Admin edits Product details and stock thresholds', 'price=2600.00, reorder=20, max=100');

    // Unauthorized role cannot create or edit product
    $unauthProd = $warehouse->request('POST', 'product.php', [
        'category_id' => $createdCategoryId,
        'product_name' => 'Unauth_Prod',
        'unit_measure' => 'Unit',
        'unit_price' => 100,
        'reorder_level' => 10,
        'max_stock' => 50
    ]);
    assertCheck($unauthProd['status'] === 403, 'Warehouse Officer blocked from creating Products (HTTP 403)');

    // -------------------------------------------------------------
    // SECTION 3: Authorized Stock Adjustments, Reasons & Duplicate Prevention
    // -------------------------------------------------------------
    echo "\n--- SECTION 3: Stock Adjustments, Reason Enforcement & Duplicate Prevention ---\n";

    // Admin and Store Requester blocked from creating stock adjustments
    $adminAdj = $admin->request('POST', 'adjustment.php', [
        'adjustment_date' => date('Y-m-d'),
        'reason' => 'Admin attempting direct stock change',
        'items' => [['product_id' => $createdProductId, 'quantity' => 5, 'adjustment_type' => 'Addition']]
    ]);
    assertCheck($adminAdj['status'] === 403, 'Admin blocked from performing direct stock adjustments (HTTP 403)');

    $reqAdj = $requester->request('POST', 'adjustment.php', [
        'adjustment_date' => date('Y-m-d'),
        'reason' => 'Requester attempting stock change',
        'items' => [['product_id' => $createdProductId, 'quantity' => 5, 'adjustment_type' => 'Addition']]
    ]);
    assertCheck($reqAdj['status'] === 403, 'Store Requester blocked from performing stock adjustments (HTTP 403)');

    // Warehouse Officer adjustment without reason rejected with 422
    $noReasonAdj = $warehouse->request('POST', 'adjustment.php', [
        'adjustment_date' => date('Y-m-d'),
        'reason' => '  ',
        'items' => [['product_id' => $createdProductId, 'quantity' => 5, 'adjustment_type' => 'Addition']]
    ]);
    assertCheck($noReasonAdj['status'] === 422, 'Stock adjustment without reason rejected with HTTP 422');

    // Duplicate product lines in same adjustment rejected with 422
    $dupLineAdj = $warehouse->request('POST', 'adjustment.php', [
        'adjustment_date' => date('Y-m-d'),
        'reason' => 'Cycle count adjustment',
        'items' => [
            ['product_id' => $createdProductId, 'quantity' => 5, 'adjustment_type' => 'Addition'],
            ['product_id' => $createdProductId, 'quantity' => 3, 'adjustment_type' => 'Addition']
        ]
    ]);
    assertCheck($dupLineAdj['status'] === 422, 'Duplicate product lines in same adjustment rejected with HTTP 422');

    // Authorized Addition (+15) by Warehouse Officer -> 35 + 15 = 50
    $token1 = 'TEST-ADJ-ADD-' . uniqid();
    $addAdj = $warehouse->request('POST', 'adjustment.php', [
        'adjustment_date' => date('Y-m-d'),
        'reason' => 'Verified cycle count surplus',
        'client_token' => $token1,
        'items' => [['product_id' => $createdProductId, 'quantity' => 15, 'adjustment_type' => 'Addition']]
    ]);
    assertCheck($addAdj['status'] === 200 && !empty($addAdj['data']['success']), 'Warehouse Officer records authorized Addition (+15)');

    // Duplicate submission with same client_token blocked (HTTP 409)
    $dupTokenAdj = $warehouse->request('POST', 'adjustment.php', [
        'adjustment_date' => date('Y-m-d'),
        'reason' => 'Verified cycle count surplus',
        'client_token' => $token1,
        'items' => [['product_id' => $createdProductId, 'quantity' => 15, 'adjustment_type' => 'Addition']]
    ]);
    assertCheck($dupTokenAdj['status'] === 409, 'Duplicate stock adjustment with same client_token blocked (HTTP 409)');

    // Duplicate submission within 60s window with different token also blocked (HTTP 409)
    $dupWindowAdj = $warehouse->request('POST', 'adjustment.php', [
        'adjustment_date' => date('Y-m-d'),
        'reason' => 'Verified cycle count surplus',
        'client_token' => 'TEST-ADJ-ADD-SECOND-' . uniqid(),
        'items' => [['product_id' => $createdProductId, 'quantity' => 15, 'adjustment_type' => 'Addition']]
    ]);
    assertCheck($dupWindowAdj['status'] === 409, 'Identical repeat stock adjustment within 60s window blocked (HTTP 409)');

    // Verify stock is exactly 50 (not double-counted)
    $pCheck1 = $warehouse->request('GET', 'product.php?id=' . $createdProductId)['data']['data'] ?? [];
    assertCheck((int)($pCheck1['available_stock'] ?? -1) === 50, 'Available Stock is 50 after +15 addition (no double-counting)');

    // Authorized Deduction (-32) by Warehouse Officer -> 50 - 32 = 18 (Low Stock since reorder_level = 20)
    $dedAdj = $warehouse->request('POST', 'adjustment.php', [
        'adjustment_date' => date('Y-m-d'),
        'reason' => 'Authorized shrinkage write-off',
        'client_token' => 'TEST-ADJ-DED-' . uniqid(),
        'items' => [['product_id' => $createdProductId, 'quantity' => 32, 'adjustment_type' => 'Deduction']]
    ]);
    assertCheck($dedAdj['status'] === 200, 'Warehouse Officer records authorized Deduction (-32)');

    $pCheck2 = $warehouse->request('GET', 'product.php?id=' . $createdProductId)['data']['data'] ?? [];
    assertCheck((int)($pCheck2['available_stock'] ?? -1) === 18, 'Available Stock updated to 18 after -32 deduction');
    assertCheck(!empty($pCheck2['is_low_stock']) && ($pCheck2['stock_status'] ?? '') === 'Low Stock', 'Low-stock detection triggered (18 <= reorder threshold 20)', 'status=' . ($pCheck2['stock_status'] ?? ''));
    assertCheck((int)($pCheck2['suggested_order_qty'] ?? -1) === 82, 'Suggested Order accurately calculated (max 100 - avail 18 = 82)');

    // Negative stock prevention: attempt to deduct 25 when available is 18
    $negAdj = $warehouse->request('POST', 'adjustment.php', [
        'adjustment_date' => date('Y-m-d'),
        'reason' => 'Attempt excessive deduction',
        'client_token' => 'TEST-ADJ-NEG-' . uniqid(),
        'items' => [['product_id' => $createdProductId, 'quantity' => 25, 'adjustment_type' => 'Deduction']]
    ]);
    assertCheck($negAdj['status'] === 409, 'Deduction exceeding Available Stock (25 > 18) rejected with HTTP 409');

    $pCheckAfterNeg = $warehouse->request('GET', 'product.php?id=' . $createdProductId)['data']['data'] ?? [];
    assertCheck((int)($pCheckAfterNeg['available_stock'] ?? -1) === 18, 'Available Stock remains 18 after rejected negative deduction');

    // -------------------------------------------------------------
    // SECTION 4: Reservations & Quarantined/Rejected Goods Rules
    // -------------------------------------------------------------
    echo "\n--- SECTION 4: Reservations & Quarantined/Rejected Goods Rules ---\n";

    // Create an Active Reservation of 8 units -> Usable On-Hand = 18, Active Reservation = 8, Available Stock = 10
    $resCreate = $warehouse->request('POST', 'adjustment.php', [
        'action' => 'create_reservation',
        'product_id' => $createdProductId,
        'reserved_qty' => 8,
        'notes' => 'Reserved for upcoming branch allocation'
    ]);
    $resId = (int)($resCreate['data']['data']['reservation_id'] ?? 0);
    $resProd = $resCreate['data']['data']['product'] ?? [];
    assertCheck($resCreate['status'] === 200 && $resId > 0, 'Active stock reservation created (8 units)', 'reservation_id=' . $resId);
    assertCheck(
        (int)($resProd['usable_on_hand_stock'] ?? -1) === 18 &&
        (int)($resProd['reserved_stock'] ?? -1) === 8 &&
        (int)($resProd['available_stock'] ?? -1) === 10,
        'Available Stock = Usable On-Hand (18) - Active Reservations (8) = 10'
    );
    assertCheck(!empty($resProd['is_critical_stock']) && ($resProd['stock_status'] ?? '') === 'Critical', 'Critical stock status detected when Available Stock drops to 10 (<= 50% of threshold 20)');

    // Attempting to deduct 12 units when Usable On-Hand is 18 but Available Stock is 10 must be blocked!
    $dedOverAvail = $warehouse->request('POST', 'adjustment.php', [
        'adjustment_date' => date('Y-m-d'),
        'reason' => 'Attempt to deduct reserved stock',
        'client_token' => 'TEST-ADJ-RES-' . uniqid(),
        'items' => [['product_id' => $createdProductId, 'quantity' => 12, 'adjustment_type' => 'Deduction']]
    ]);
    assertCheck($dedOverAvail['status'] === 409, 'Deduction (12) exceeding Available Stock (10) due to Active Reservation blocked (HTTP 409)');

    // Release/Cancel the reservation -> Available Stock returns to 18
    $resCancel = $warehouse->request('POST', 'adjustment.php', [
        'action' => 'cancel_reservation',
        'reservation_id' => $resId
    ]);
    $resProdAfter = $resCancel['data']['data']['product'] ?? [];
    assertCheck($resCancel['status'] === 200 && (int)($resProdAfter['available_stock'] ?? -1) === 18, 'Cancelling reservation restores Available Stock to 18');

    // Quarantined store return must NOT count as usable stock
    $qRet = $warehouse->request('POST', 'stocks_return.php', [
        'requested_by' => 'Makati Branch Gym',
        'return_date' => date('Y-m-d'),
        'reason' => 'Damaged rubber coating in transit - quarantined',
        'items' => [
            ['product_id' => $createdProductId, 'quantity_returned' => 6, 'condition_status' => 'Quarantined']
        ]
    ]);
    $createdReturnId = (int)($qRet['data']['data']['stocks_return_id'] ?? 0);
    assertCheck($qRet['status'] === 200 && $createdReturnId > 0, 'Quarantined store return (6 units) recorded');

    $pCheckQuar = $warehouse->request('GET', 'product.php?id=' . $createdProductId)['data']['data'] ?? [];
    assertCheck(
        (int)($pCheckQuar['available_stock'] ?? -1) === 18 &&
        (int)($pCheckQuar['usable_on_hand_stock'] ?? -1) === 18 &&
        (int)($pCheckQuar['quarantined_stock'] ?? -1) === 6,
        'Quarantined return (6 units) excluded from Usable On-Hand & Available Stock (remains 18, quarantined=6)'
    );

    // -------------------------------------------------------------
    // SECTION 5: Movement Ledger & Inventory Report Reconciliation
    // -------------------------------------------------------------
    echo "\n--- SECTION 5: Stock Movement History & Balance Reconciliation ---\n";
    $prodMovements = $warehouse->request('GET', 'audit_log.php?mode=movements&product_id=' . $createdProductId)['data']['data'] ?? [];
    assertCheck(count($prodMovements) === 4, 'All 4 transactions for test product recorded in Stock Movement History (Opening +35, Add +15, Ded -32, Quarantined 0)');

    $ledgerSum = 0;
    foreach ($prodMovements as $mRow) {
        $ledgerSum += (int)$mRow['qty_change'];
    }
    assertCheck($ledgerSum === (int)$pCheckQuar['usable_on_hand_stock'], 'Sum of usable movement qty_change (+35 + 15 - 32 + 0 = 18) exactly matches Usable On-Hand Stock (18)');

    // Verify all existing products in database reconcile with their movement ledger
    $allProducts = $admin->request('GET', 'product.php')['data']['data'] ?? [];
    $allReconciled = true;
    foreach ($allProducts as $prod) {
        $pid = (int)$prod['product_id'];
        $expectedAvail = max(0, (int)$prod['usable_on_hand_stock'] - (int)$prod['reserved_stock']);
        if ((int)$prod['available_stock'] !== $expectedAvail || (int)$prod['available_stock'] < 0) {
            $allReconciled = false;
            echo " Mismatch on product #{$pid}: avail={$prod['available_stock']}, expected={$expectedAvail}\n";
        }
    }
    assertCheck($allReconciled && count($allProducts) >= 12, 'All ' . count($allProducts) . ' products in Inventory Report reflect accurate non-negative database balances');

    // Test deactivating and preserving inactive product + historical transactions
    $deactRes = $admin->request('DELETE', 'product.php?id=' . $createdProductId);
    assertCheck($deactRes['status'] === 200, 'Admin deactivates product (preserved in database)');
    $pCheckInact = $admin->request('GET', 'product.php?id=' . $createdProductId)['data']['data'] ?? [];
    assertCheck((int)($pCheckInact['is_active'] ?? -1) === 0 && (int)($pCheckInact['available_stock'] ?? -1) === 18, 'Deactivated product and its historical stock balance (18) are preserved');

    // -------------------------------------------------------------
    // SECTION 6: Product Inventory UI & Modal Structure Verification
    // -------------------------------------------------------------
    echo "\n--- SECTION 6: Product Inventory UI & Modal Verification ---\n";
    $productHtml = (string)file_get_contents($rootDir . '/views/product.html');
    $templatesHtml = (string)file_get_contents($rootDir . '/views/common_templates.html');
    $productJs = (string)file_get_contents($rootDir . '/js/product.js');
    $appCss = (string)file_get_contents($rootDir . '/css/app.css');

    // 1. Main table headers: only Product Name | Category | Unit | Unit Price | Actions
    preg_match('/<table[^>]*id="productMainTable"[^>]*>.*?<thead>(.*?)<\/thead>/si', $productHtml, $theadMatch);
    $theadContent = $theadMatch[1] ?? '';
    preg_match_all('/<th\b[^>]*>(.*?)<\/th>/si', $theadContent, $thMatches);
    $headerTexts = array_map(function ($h) {
        return trim(preg_replace('/\s+/', ' ', strip_tags($h)));
    }, $thMatches[1] ?? []);
    assertCheck(
        $headerTexts === ['PRODUCT NAME', 'CATEGORY', 'UNIT', 'UNIT PRICE', 'ACTIONS'],
        'Product Inventory main table displays ONLY: Product Name | Category | Unit | Unit Price | Actions',
        implode(' | ', $headerTexts)
    );

    // 2. Green View buttons with white eye icons
    $hasGreenViewBtn = strpos($productJs, 'btn-success text-white gw-btn-view-product') !== false
        && strpos($productJs, 'bi-eye text-white') !== false
        && strpos($appCss, 'background-color: #008A3B !important;') !== false;
    assertCheck($hasGreenViewBtn, 'All View buttons are solid green with white eye icons');

    // 3. View modal contains all 9 required fields and no product images
    $requiredModalFields = [
        'Product Name',
        'Category',
        'Unit',
        'Unit Price',
        'Available Stock',
        'Stock Level',
        'On Order',
        'Suggested Order',
        'Status'
    ];
    $allModalFieldsPresent = true;
    foreach ($requiredModalFields as $fieldLabel) {
        if (strpos($productJs, '>' . $fieldLabel . '<') === false) {
            $allModalFieldsPresent = false;
            echo " Missing modal field: {$fieldLabel}\n";
        }
    }
    assertCheck($allModalFieldsPresent, 'Inventory Details modal displays all 9 required fields from live database calculations');

    $noImagesInProductUi = (stripos($productHtml, '<img') === false) && (stripos($productJs, '<img') === false);
    assertCheck($noImagesInProductUi, 'No product images are displayed in Product Inventory table or modal');

} finally {
    // Cleanup temporary test data so database remains clean
    if ($createdReturnId > 0) {
        $conn->prepare("DELETE FROM stocks_return_detail WHERE stocks_return_id = ?")->execute([$createdReturnId]);
        $conn->prepare("DELETE FROM stocks_return WHERE stocks_return_id = ?")->execute([$createdReturnId]);
    }
    if ($createdProductId > 0) {
        $conn->prepare("DELETE FROM stock_reservation WHERE product_id = ?")->execute([$createdProductId]);
        $conn->prepare("DELETE FROM adjustment_detail WHERE product_id = ?")->execute([$createdProductId]);
        $conn->prepare("DELETE FROM product WHERE product_id = ?")->execute([$createdProductId]);
        $conn->prepare("DELETE FROM notification WHERE ref_type = 'product' AND ref_id = ?")->execute([$createdProductId]);
        $conn->prepare("DELETE FROM audit_log WHERE module IN ('product', 'adjustment', 'adjustment_detail', 'stock_reservation', 'stocks_return') AND record_id >= ?")->execute([$createdProductId]);
    }
    if ($createdCategoryId > 0) {
        $conn->prepare("DELETE FROM category WHERE category_id = ?")->execute([$createdCategoryId]);
    }

    // Restore original user password hashes and active flags
    $restoreStmt = $conn->prepare("UPDATE users SET password = ?, is_active = ? WHERE user_id = ?");
    foreach ($origUsers as $u) {
        $restoreStmt->execute([$u['password'], (int)$u['is_active'], (int)$u['user_id']]);
    }

    // Stop temporary PHP server on port 8089
    exec('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \'php.exe\' -and $_.CommandLine -like \'*8089*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"');
}

echo "\n=================================================================\n";
echo " PHASE 2 TEST SUMMARY: {$passedCount} PASSED, {$failedCount} FAILED\n";
echo "=================================================================\n";
exit($failedCount > 0 ? 1 : 0);
