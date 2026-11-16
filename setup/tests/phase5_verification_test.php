<?php
/**
 * Phase 5 Formal Verification Test Suite
 * Inventory and Warehouse Management System (GymWorx Warehouse)
 *
 * Verifies all 12 required Phase 5 scenarios:
 *  1. Issued PO appears in receiving queue.
 *  2. Draft PO cannot be received.
 *  3. GRN creation works (Workflow A).
 *  4. Partial delivery works (Workflow C).
 *  5. Accepted goods increase usable inventory.
 *  6. Rejected goods do not increase usable inventory (Workflow D).
 *  7. Quarantined goods remain unavailable for normal stock release.
 *  8. PO outstanding quantities are correct across multiple deliveries.
 *  9. Duplicate GRN posting is blocked (idempotency and already-posted checks).
 * 10. Receiving errors roll back inventory changes.
 * 11. Stock movements and audit logs are recorded.
 * 12. Linked PRs are not falsely marked Fulfilled.
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

$rootDir = realpath(__DIR__ . '/../..');
require_once $rootDir . '/config/db.php';
require_once $rootDir . '/config/permissions.php';
require_once $rootDir . '/config/inventory.php';

$conn = getConnection();

echo "=================================================================\n";
echo " PHASE 5 VERIFICATION SUITE (WAREHOUSE RECEIVING & INSPECTION)\n";
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

class Phase5HttpTester {
    private string $baseUrl;
    private string $cookieFile;
    public ?string $csrfToken = null;

    public function __construct(string $baseUrl, string $tag) {
        $this->baseUrl = $baseUrl;
        $this->cookieFile = sys_get_temp_dir() . '/p5_cookie_' . $tag . '_' . uniqid() . '.txt';
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

        $headers = [];
        if ($this->csrfToken !== null) {
            $headers[] = 'X-CSRF-Token: ' . $this->csrfToken;
        }

        if ($payload !== null) {
            $headers[] = 'Content-Type: application/json';
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        }

        if (!empty($headers)) {
            curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        }

        $raw = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($raw === false) {
            return ['status' => 0, 'data' => null, 'error' => $err];
        }

        $decoded = json_decode($raw, true);
        return ['status' => $status, 'data' => $decoded, 'raw' => $raw];
    }

    public function login(string $username, string $password): array {
        $me = $this->request('GET', 'auth.php?action=me');
        $res = $this->request('POST', 'auth.php?action=login', [
            'username' => $username,
            'password' => $password
        ]);
        if ($res['status'] === 200 && !empty($res['data']['data']['csrf_token'])) {
            $this->csrfToken = $res['data']['data']['csrf_token'];
        }
        return $res;
    }
}

// -----------------------------------------------------------------------------
// SECTION 0: Server Base & Credentials Setup
// -----------------------------------------------------------------------------
$serverBase = "http://127.0.0.1/updated_inventory_website/warehouse_finals/api/";

// Temporarily set known password on test user accounts
$origUsers = $conn->query("SELECT user_id, password, is_active FROM users WHERE user_id IN (1, 31, 32, 33, 35)")->fetchAll();
$testPassword = 'TestPass#2026!';
$testHash = password_hash($testPassword, PASSWORD_DEFAULT);
$conn->prepare("UPDATE users SET password = ?, is_active = 1 WHERE user_id IN (1, 31, 32, 33, 35)")->execute([$testHash]);

$createdProductIds = [];
$createdSupplierIds = [];
$createdPrIds = [];
$createdPoIds = [];
$createdGrnIds = [];

try {
    $adminClient     = new Phase5HttpTester($serverBase, 'admin');
    $managerClient   = new Phase5HttpTester($serverBase, 'manager');
    $poClient        = new Phase5HttpTester($serverBase, 'purchasing');
    $warehouseClient = new Phase5HttpTester($serverBase, 'warehouse');
    $requesterClient = new Phase5HttpTester($serverBase, 'requester');

    $adminClient->login('Enhancer', $testPassword);
    $managerClient->login('Jean', $testPassword);
    $poClient->login('Fritz', $testPassword);
    $warehouseClient->login('christian', $testPassword);
    $requesterClient->login('zhen1', $testPassword);

    echo "--- SECTION 0: User Setup & Authentication ---\n";
    assertCheck($warehouseClient->csrfToken !== null, 'Warehouse Officer authenticated (christian)');
    assertCheck($poClient->csrfToken !== null, 'Purchasing Officer authenticated (Fritz)');
    assertCheck($managerClient->csrfToken !== null, 'Manager authenticated (Jean)');

    // Create test supplier
    $supRes = $poClient->request('POST', 'supplier.php', [
        'supplier_name' => 'P5_Apex_Logistics_' . uniqid(),
        'contact_person' => 'Marcus Vance',
        'email' => 'apex_' . uniqid() . '@example.com',
        'phone' => '0917-555-0988',
        'address' => 'Subic Port Freezone'
    ]);
    $supplierId = (int)($supRes['data']['data']['supplier_id'] ?? 0);
    $createdSupplierIds[] = $supplierId;
    assertCheck($supplierId > 0, 'Active supplier created for receiving tests', "Supplier ID: {$supplierId}");

    // Create test products
    // Product 1: Partial receiving & inspection test (Ordered=20, First=12, Rem=8)
    $p1Res = $adminClient->request('POST', 'product.php', [
        'category_id' => 1,
        'product_name' => 'P5_Olympic_Barbell_' . uniqid(),
        'unit_measure' => 'piece',
        'unit_price' => 4500.00,
        'reorder_level' => 5,
        'max_stock' => 100
    ]);
    $pid1 = (int)($p1Res['data']['data']['product_id'] ?? 0);
    $createdProductIds[] = $pid1;

    // Product 2: Rejected & Quarantined inspection test (Delivered=10, Accepted=8, Rejected=2)
    $p2Res = $adminClient->request('POST', 'product.php', [
        'category_id' => 1,
        'product_name' => 'P5_Bumper_Plate_20kg_' . uniqid(),
        'unit_measure' => 'pair',
        'unit_price' => 3200.00,
        'reorder_level' => 10,
        'max_stock' => 150
    ]);
    $pid2 = (int)($p2Res['data']['data']['product_id'] ?? 0);
    $createdProductIds[] = $pid2;

    // Product 3: Quarantined isolation test
    $p3Res = $adminClient->request('POST', 'product.php', [
        'category_id' => 1,
        'product_name' => 'P5_Kettlebell_24kg_' . uniqid(),
        'unit_measure' => 'piece',
        'unit_price' => 1800.00,
        'reorder_level' => 5,
        'max_stock' => 80
    ]);
    $pid3 = (int)($p3Res['data']['data']['product_id'] ?? 0);
    $createdProductIds[] = $pid3;

    assertCheck($pid1 > 0 && $pid2 > 0 && $pid3 > 0, '3 distinct test products created');

    // Link products to supplier
    $poClient->request('POST', 'product_supplier.php', ['product_id' => $pid1, 'supplier_id' => $supplierId, 'supplier_unit_cost' => 4200.00]);
    $poClient->request('POST', 'product_supplier.php', ['product_id' => $pid2, 'supplier_id' => $supplierId, 'supplier_unit_cost' => 3000.00]);
    $poClient->request('POST', 'product_supplier.php', ['product_id' => $pid3, 'supplier_id' => $supplierId, 'supplier_unit_cost' => 1650.00]);

    // -------------------------------------------------------------------------
    // TEST 1 & TEST 2: Receiving Queue Visibility & Draft PO Exclusion
    // -------------------------------------------------------------------------
    echo "\n--- TEST 1 & TEST 2: PO Eligibility & Draft PO Blocking ---\n";

    // Create an Independent PO in Draft status
    $draftPoRes = $poClient->request('POST', 'purchase_order.php', [
        'po_source' => 'Independent',
        'supplier_id' => $supplierId,
        'status' => 'Draft',
        'items' => [
            ['product_id' => $pid1, 'quantity_ordered' => 15, 'unit_cost' => 4200.00]
        ]
    ]);
    $draftPoId = (int)($draftPoRes['data']['data']['po_id'] ?? 0);
    $createdPoIds[] = $draftPoId;
    assertCheck($draftPoId > 0 && ($draftPoRes['data']['data']['order_status'] ?? '') === 'Draft', 'PO created in Draft status', "PO ID: {$draftPoId}");

    // Test 2: Draft PO must NOT appear in receiving queue
    $recvQueueRes = $warehouseClient->request('GET', 'purchase_order.php?mode=pending');
    $queuePoIds = array_map('intval', array_column($recvQueueRes['data']['data'] ?? [], 'po_id'));
    assertCheck(!in_array($draftPoId, $queuePoIds, true), 'Test 2a: Draft PO is strictly excluded from Warehouse Receiving Queue (mode=pending)');

    // Test 2: Attempting to receive against Draft PO must fail with HTTP 422
    $tryReceiveDraft = $warehouseClient->request('POST', 'stock_receiving.php', [
        'po_id' => $draftPoId,
        'receiving_date' => date('Y-m-d'),
        'dr_number' => 'DR-DRAFT-FAIL',
        'items' => [
            ['product_id' => $pid1, 'quantity_received' => 5]
        ]
    ]);
    assertCheck(
        $tryReceiveDraft['status'] === 422 && empty($tryReceiveDraft['data']['success']),
        'Test 2b: Draft PO cannot be received (blocked with HTTP 422)',
        $tryReceiveDraft['data']['message'] ?? ''
    );

    // Issue an authorized PO for Product 1 (Ordered=20)
    $issuedPoRes = $poClient->request('POST', 'purchase_order.php', [
        'po_source' => 'Independent',
        'supplier_id' => $supplierId,
        'status' => 'Issued',
        'items' => [
            ['product_id' => $pid1, 'quantity_ordered' => 20, 'unit_cost' => 4200.00]
        ]
    ]);
    $issuedPoId = (int)($issuedPoRes['data']['data']['po_id'] ?? 0);
    $createdPoIds[] = $issuedPoId;

    // Test 1: Issued PO appears in Warehouse Receiving Queue
    $recvQueueRes2 = $warehouseClient->request('GET', 'purchase_order.php?mode=pending');
    $queue2 = $recvQueueRes2['data']['data'] ?? [];
    $foundIssued = null;
    foreach ($queue2 as $q) {
        if ((int)$q['po_id'] === $issuedPoId) {
            $foundIssued = $q;
            break;
        }
    }
    assertCheck(
        $foundIssued !== null && (int)$foundIssued['outstanding_qty'] === 20,
        'Test 1: Issued PO appears in Warehouse Receiving Queue with full outstanding quantity (20)',
        "PO #{$issuedPoId}, Status: " . ($foundIssued['status'] ?? '') . ", Outstanding: " . ($foundIssued['outstanding_qty'] ?? '')
    );

    // -------------------------------------------------------------------------
    // TEST 3 & TEST 4: Goods Receipt Note (GRN) Creation & Partial Receiving
    // Workflow C Example: Ordered=20, First delivery=12, Outstanding=8
    // -------------------------------------------------------------------------
    echo "\n--- TEST 3 & TEST 4: GRN Creation & Partial Receiving (Ordered=20, Deliv=12, Rem=8) ---\n";

    // Initial stock check
    $mBefore = productInventoryMetrics($conn, $pid1, false);
    $stockBefore = (int)($mBefore['usable_stock'] ?? $mBefore['usable_on_hand_stock'] ?? 0);

    // Delivery 1: Receive 12 units
    $firstGrnToken = 'token_grn1_' . uniqid();
    $grn1Res = $warehouseClient->request('POST', 'stock_receiving.php', [
        'po_id' => $issuedPoId,
        'receiving_date' => date('Y-m-d'),
        'dr_number' => 'DR-P5-DELIV-001',
        'remarks' => 'First partial delivery of 12 units',
        'client_token' => $firstGrnToken,
        'items' => [
            ['product_id' => $pid1, 'quantity_received' => 12, 'discrepancy_note' => '12 of 20 delivered']
        ]
    ]);

    $grn1Id = (int)($grn1Res['data']['data']['receiving_id'] ?? 0);
    $grn1Number = $grn1Res['data']['data']['grn_number'] ?? '';
    $createdGrnIds[] = $grn1Id;

    assertCheck(
        $grn1Res['status'] === 200 && $grn1Id > 0 && strpos($grn1Number, 'GRN-') === 0,
        'Test 3: GRN creation works, generating unique GRN number (Workflow A)',
        "GRN Number: {$grn1Number}, Status: " . ($grn1Res['data']['data']['status'] ?? '')
    );

    // Workflow A Critical rule: Inventory MUST NOT increase until accepted quantities are posted
    $mAfterGrn1 = productInventoryMetrics($conn, $pid1, false);
    $stockAfterGrn1 = (int)($mAfterGrn1['usable_stock'] ?? $mAfterGrn1['usable_on_hand_stock'] ?? 0);
    assertCheck(
        $stockAfterGrn1 === $stockBefore,
        'Critical Rule: Usable inventory DOES NOT increase when GRN is created (pending inspection)',
        "Before={$stockBefore}, After={$stockAfterGrn1} (Expected={$stockBefore})"
    );

    // Test 4: PO status is Partially Received with 8 outstanding
    assertCheck(
        ($grn1Res['data']['data']['po_status'] ?? '') === 'Partially Received' &&
        (int)($grn1Res['data']['data']['outstanding_qty'] ?? -1) === 8,
        'Test 4a: PO status becomes Partially Received with 8 units outstanding',
        "PO Status: {$grn1Res['data']['data']['po_status']}, Outstanding: {$grn1Res['data']['data']['outstanding_qty']}"
    );

    // Test over-receiving prevention: Attempting to receive 9 when only 8 remain must fail
    $overRecvRes = $warehouseClient->request('POST', 'stock_receiving.php', [
        'po_id' => $issuedPoId,
        'receiving_date' => date('Y-m-d'),
        'dr_number' => 'DR-P5-OVERRECV',
        'items' => [
            ['product_id' => $pid1, 'quantity_received' => 9]
        ]
    ]);
    assertCheck(
        $overRecvRes['status'] === 422 && empty($overRecvRes['data']['success']),
        'Test 4b: Over-receiving is prevented (delivering 9 when only 8 remain blocked with HTTP 422)',
        $overRecvRes['data']['message'] ?? ''
    );

    // Delivery 2: Receive the remaining 8 units under second GRN
    $secondGrnToken = 'token_grn2_' . uniqid();
    $grn2Res = $warehouseClient->request('POST', 'stock_receiving.php', [
        'po_id' => $issuedPoId,
        'receiving_date' => date('Y-m-d'),
        'dr_number' => 'DR-P5-DELIV-002',
        'remarks' => 'Second partial delivery of 8 units (completes PO)',
        'client_token' => $secondGrnToken,
        'items' => [
            ['product_id' => $pid1, 'quantity_received' => 8, 'discrepancy_note' => 'Remaining 8 units']
        ]
    ]);
    $grn2Id = (int)($grn2Res['data']['data']['receiving_id'] ?? 0);
    $grn2Number = $grn2Res['data']['data']['grn_number'] ?? '';
    $createdGrnIds[] = $grn2Id;

    assertCheck(
        $grn2Res['status'] === 200 && ($grn2Res['data']['data']['po_status'] ?? '') === 'Received',
        'Test 4c: Second GRN for remaining 8 units succeeds and transitions PO to Received (Complete)',
        "GRN #2: {$grn2Number}, PO Status: {$grn2Res['data']['data']['po_status']}, Rem: {$grn2Res['data']['data']['outstanding_qty']}"
    );

    // -------------------------------------------------------------------------
    // TEST 5 & TEST 6: Inspection & Inventory Posting (Workflow B & Workflow D)
    // Example: Received 10 units -> Accepted 8 units, Rejected 2 units
    // Usable stock must increase by ONLY 8 units.
    // -------------------------------------------------------------------------
    echo "\n--- TEST 5 & TEST 6: Inspection Breakdown & Usable Stock Isolation (Deliv=10, Acc=8, Rej=2) ---\n";

    // Issue a PO for Product 2 (Ordered=10)
    $po2Res = $poClient->request('POST', 'purchase_order.php', [
        'po_source' => 'Independent',
        'supplier_id' => $supplierId,
        'status' => 'Issued',
        'items' => [
            ['product_id' => $pid2, 'quantity_ordered' => 10, 'unit_cost' => 3000.00]
        ]
    ]);
    $po2Id = (int)($po2Res['data']['data']['po_id'] ?? 0);
    $createdPoIds[] = $po2Id;

    $mP2Before = productInventoryMetrics($conn, $pid2, false);
    $stockP2Before = (int)($mP2Before['usable_stock'] ?? $mP2Before['usable_on_hand_stock'] ?? 0);

    // Create GRN for 10 units delivered
    $grnInspectRes = $warehouseClient->request('POST', 'stock_receiving.php', [
        'po_id' => $po2Id,
        'receiving_date' => date('Y-m-d'),
        'dr_number' => 'DR-P5-INSPECT-TEST',
        'remarks' => 'Delivered 10 pairs for inspection testing',
        'items' => [
            ['product_id' => $pid2, 'quantity_received' => 10]
        ]
    ]);
    $grnInspId = (int)($grnInspectRes['data']['data']['receiving_id'] ?? 0);
    $createdGrnIds[] = $grnInspId;
    $grnInspNumber = $grnInspectRes['data']['data']['grn_number'] ?? '';

    // Verify stock has not changed yet
    $mP2Pending = productInventoryMetrics($conn, $pid2, false);
    $stockP2Pending = (int)($mP2Pending['usable_stock'] ?? $mP2Pending['usable_on_hand_stock'] ?? 0);
    assertCheck($stockP2Pending === $stockP2Before, 'Prior to inspection, usable inventory remains untouched');

    // Conduct Inspection (Workflow B / Workflow D):
    // Delivered: 10 units. Accepted: 8 units. Rejected: 2 units.
    $inspSubmitRes = $warehouseClient->request('POST', 'stock_receiving.php', [
        'action' => 'inspect_and_post',
        'receiving_id' => $grnInspId,
        'inspection_date' => date('Y-m-d'),
        'inspection_notes' => '8 units passed tensile check; 2 units rejected with cracked rubber coating',
        'items' => [
            [
                'product_id' => $pid2,
                'quantity_accepted' => 8,
                'quantity_rejected' => 2,
                'quantity_quarantined' => 0,
                'rejection_reason' => 'Cracked rubber coating in packaging',
                'discrepancy_note' => '2 units rejected'
            ]
        ]
    ]);

    assertCheck(
        $inspSubmitRes['status'] === 200 && ($inspSubmitRes['data']['data']['status'] ?? '') === 'Posted',
        'Workflow B: Inspection completed and posted successfully',
        "GRN {$grnInspNumber}, Inspection Status: {$inspSubmitRes['data']['data']['inspection_status']}"
    );

    // Test 5: Accepted goods increase usable inventory (+8)
    $mP2After = productInventoryMetrics($conn, $pid2, false);
    $stockP2After = (int)($mP2After['usable_stock'] ?? $mP2After['usable_on_hand_stock'] ?? 0);
    $quarantinedP2 = (int)($mP2After['quarantined_stock'] ?? 0);

    assertCheck(
        $stockP2After === $stockP2Before + 8,
        'Test 5: Accepted goods increase usable inventory (+8 units)',
        "Initial={$stockP2Before}, Now={$stockP2After} (Expected=" . ($stockP2Before + 8) . ")"
    );

    // Test 6: Rejected goods DO NOT increase usable inventory and are tracked separately
    assertCheck(
        $stockP2After !== $stockP2Before + 10 && $quarantinedP2 >= 2,
        'Test 6: Rejected goods (2 units) do not increase usable stock and are isolated from normal release',
        "Usable Change=+8 (not +10), Quarantined/Rejected Stock={$quarantinedP2}"
    );

    // -------------------------------------------------------------------------
    // TEST 7: Quarantined Goods Isolation
    // Delivered: 15 units -> Accepted: 10, Quarantined: 5
    // Usable stock increases by ONLY 10 units; 5 quarantined units remain unavailable.
    // -------------------------------------------------------------------------
    echo "\n--- TEST 7: Quarantined Goods Isolation (Deliv=15, Acc=10, Quar=5) ---\n";

    $po3Res = $poClient->request('POST', 'purchase_order.php', [
        'po_source' => 'Independent',
        'supplier_id' => $supplierId,
        'status' => 'Issued',
        'items' => [
            ['product_id' => $pid3, 'quantity_ordered' => 15, 'unit_cost' => 1650.00]
        ]
    ]);
    $po3Id = (int)($po3Res['data']['data']['po_id'] ?? 0);
    $createdPoIds[] = $po3Id;

    $mP3Before = productInventoryMetrics($conn, $pid3, false);
    $stockP3Before = (int)($mP3Before['usable_stock'] ?? $mP3Before['usable_on_hand_stock'] ?? 0);

    $grn3Res = $warehouseClient->request('POST', 'stock_receiving.php', [
        'po_id' => $po3Id,
        'receiving_date' => date('Y-m-d'),
        'dr_number' => 'DR-P5-QUARANTINE-TEST',
        'items' => [
            ['product_id' => $pid3, 'quantity_received' => 15]
        ]
    ]);
    $grn3Id = (int)($grn3Res['data']['data']['receiving_id'] ?? 0);
    $createdGrnIds[] = $grn3Id;

    // Inspect: Accepted=10, Quarantined=5
    $inspQuarRes = $warehouseClient->request('POST', 'stock_receiving.php', [
        'action' => 'inspect_and_post',
        'receiving_id' => $grn3Id,
        'inspection_date' => date('Y-m-d'),
        'inspection_notes' => '10 units cleared; 5 units held in quarantine for weight calibration tests',
        'items' => [
            [
                'product_id' => $pid3,
                'quantity_accepted' => 10,
                'quantity_rejected' => 0,
                'quantity_quarantined' => 5,
                'quarantine_reason' => 'Pending weight calibration verification',
                'discrepancy_note' => '5 quarantined'
            ]
        ]
    ]);

    assertCheck($inspQuarRes['status'] === 200, 'Inspection with quarantined goods submitted successfully');

    $mP3After = productInventoryMetrics($conn, $pid3, false);
    $stockP3After = (int)($mP3After['usable_stock'] ?? $mP3After['usable_on_hand_stock'] ?? 0);
    $quarP3 = (int)($mP3After['quarantined_stock'] ?? 0);

    assertCheck(
        $stockP3After === $stockP3Before + 10 && $quarP3 >= 5,
        'Test 7: Quarantined goods (5 units) remain unavailable for usable stock release; usable stock increased by exactly 10',
        "Usable Initial={$stockP3Before}, Usable Now={$stockP3After} (+10), Quarantined Stock={$quarP3}"
    );

    // -------------------------------------------------------------------------
    // TEST 8: Purchase Order Outstanding Quantities Precision
    // -------------------------------------------------------------------------
    echo "\n--- TEST 8: PO Outstanding Quantities Precision ---\n";
    $poDetailQuery = $conn->prepare(
        "SELECT pod.quantity_ordered, pod.quantity_received,
                GREATEST(0, pod.quantity_ordered - pod.quantity_received) AS outstanding
         FROM purchase_order_detail pod
         WHERE pod.po_id = :id"
    );
    $poDetailQuery->execute([':id' => $issuedPoId]);
    $poLinesCheck = $poDetailQuery->fetch();

    assertCheck(
        (int)$poLinesCheck['quantity_ordered'] === 20 &&
        (int)$poLinesCheck['quantity_received'] === 20 &&
        (int)$poLinesCheck['outstanding'] === 0,
        'Test 8: Fully delivered PO #'.$issuedPoId.' reflects Ordered=20, Received=20, Outstanding=0 in database'
    );

    // -------------------------------------------------------------------------
    // TEST 9: Duplicate GRN Posting & Idempotency Prevention
    // -------------------------------------------------------------------------
    echo "\n--- TEST 9: Duplicate GRN Posting & Idempotency Blocking ---\n";

    // 1. Attempting to inspect and post an ALREADY-POSTED GRN must be blocked with HTTP 409
    $dupInspectRes = $warehouseClient->request('POST', 'stock_receiving.php', [
        'action' => 'inspect_and_post',
        'receiving_id' => $grnInspId,
        'inspection_date' => date('Y-m-d'),
        'items' => [
            ['product_id' => $pid2, 'quantity_accepted' => 8, 'quantity_rejected' => 2, 'quantity_quarantined' => 0]
        ]
    ]);
    assertCheck(
        $dupInspectRes['status'] === 409,
        'Test 9a: Reposting an already-posted GRN is blocked (HTTP 409)',
        $dupInspectRes['data']['message'] ?? ''
    );

    // 2. Submitting duplicate GRN creation with existing client token must be blocked with HTTP 409
    $dupTokenRes = $warehouseClient->request('POST', 'stock_receiving.php', [
        'po_id' => $issuedPoId,
        'receiving_date' => date('Y-m-d'),
        'dr_number' => 'DR-P5-DUP-CHECK',
        'client_token' => $firstGrnToken,
        'items' => [
            ['product_id' => $pid1, 'quantity_received' => 2]
        ]
    ]);
    assertCheck(
        $dupTokenRes['status'] === 409,
        'Test 9b: Duplicate GRN submission with same client_token is blocked (HTTP 409)',
        $dupTokenRes['data']['message'] ?? ''
    );

    // -------------------------------------------------------------------------
    // TEST 10: Validation Error & Transaction Rollback
    // When inspection totals do not equal delivered quantity, transaction rolls back.
    // -------------------------------------------------------------------------
    echo "\n--- TEST 10: Inspection Validation & Transaction Rollback ---\n";

    // Inspect GRN 1 (delivered=12). Attempt invalid total: accepted=7, rejected=2 (sum=9 != 12)
    $mP1BeforeRollback = productInventoryMetrics($conn, $pid1, false);
    $stockP1BeforeRollback = (int)($mP1BeforeRollback['usable_stock'] ?? $mP1BeforeRollback['usable_on_hand_stock'] ?? 0);

    $invalidTotalRes = $warehouseClient->request('POST', 'stock_receiving.php', [
        'action' => 'inspect_and_post',
        'receiving_id' => $grn1Id,
        'inspection_date' => date('Y-m-d'),
        'items' => [
            [
                'product_id' => $pid1,
                'quantity_accepted' => 7,
                'quantity_rejected' => 2,
                'quantity_quarantined' => 0
            ]
        ]
    ]);

    assertCheck(
        $invalidTotalRes['status'] === 422,
        'Test 10a: Invalid inspection total (7+2=9 != 12 delivered) rejected with HTTP 422',
        $invalidTotalRes['data']['message'] ?? ''
    );

    // Verify database transaction rolled back: GRN remains 'Pending Inspection' and stock unchanged
    $grn1Row = $conn->query("SELECT status FROM stock_receiving WHERE receiving_id = {$grn1Id}")->fetch();
    $mP1AfterRollback = productInventoryMetrics($conn, $pid1, false);
    $stockP1AfterRollback = (int)($mP1AfterRollback['usable_stock'] ?? $mP1AfterRollback['usable_on_hand_stock'] ?? 0);

    assertCheck(
        $grn1Row['status'] === 'Pending Inspection' && $stockP1AfterRollback === $stockP1BeforeRollback,
        'Test 10b: Database transaction rolled back -> GRN status remains Pending Inspection, stock unchanged',
        "Status: {$grn1Row['status']}, Stock: {$stockP1AfterRollback}"
    );

    // -------------------------------------------------------------------------
    // TEST 11: Stock Movements & Audit Logs
    // -------------------------------------------------------------------------
    echo "\n--- TEST 11: Stock Movements & Audit Trail Verification ---\n";

    // Check stock_movement table for accepted items from GRN #grnInspId
    $smStmt = $conn->prepare(
        "SELECT * FROM stock_movement
         WHERE reference_id = :rid AND reference_type = 'stock_receiving' AND direction = 'IN'"
    );
    $smStmt->execute([':rid' => $grnInspId]);
    $moves = $smStmt->fetchAll();

    assertCheck(
        !empty($moves) && (int)$moves[0]['quantity'] === 8 && (int)$moves[0]['product_id'] === $pid2,
        'Test 11a: Physical stock movement record generated for accepted units (+8 units of Product 2)',
        "Movement ID: " . ($moves[0]['movement_id'] ?? 'none') . ", Qty: " . ($moves[0]['quantity'] ?? 0)
    );

    // Check audit_log table
    $auditStmt = $conn->prepare(
        "SELECT action, description FROM audit_log
         WHERE record_id = :rid AND module = 'stock_receiving'
         ORDER BY audit_id DESC"
    );
    $auditStmt->execute([':rid' => $grnInspId]);
    $logs = $auditStmt->fetchAll();
    $auditActions = array_column($logs, 'action');

    assertCheck(
        in_array('GRN_CREATED', $auditActions, true) && in_array('INSPECTION_COMPLETED', $auditActions, true),
        'Test 11b: Complete audit log history recorded (GRN_CREATED and INSPECTION_COMPLETED)',
        "Logged actions: " . implode(', ', $auditActions)
    );

    // -------------------------------------------------------------------------
    // TEST 12: Purchase Request Synchronization & Non-Premature Fulfillment
    // For a PO linked to an approved PR, receiving goods must NOT mark the PR Fulfilled.
    // -------------------------------------------------------------------------
    echo "\n--- TEST 12: Purchase Request Synchronization & Non-Premature Fulfillment ---\n";

    // Create PR -> Approve PR -> Create Linked PO -> Receive PO -> Inspect PO
    $prLinkRes = $requesterClient->request('POST', 'purchase_request.php', [
        'store_name' => 'Main Store',
        'purpose' => 'Phase 5 PR Synchronization Test',
        'urgency' => 'Normal',
        'items' => [
            ['product_id' => $pid2, 'requested_qty' => 6]
        ]
    ]);
    $syncPrId = (int)($prLinkRes['data']['data']['pr_id'] ?? 0);
    $createdPrIds[] = $syncPrId;

    // Manager approves PR
    $managerClient->request('PUT', 'purchase_request.php', [
        'action' => 'approve',
        'pr_id' => $syncPrId,
        'manager_comment' => 'Approved for PR sync test'
    ]);

    // Purchasing creates linked PO
    $syncPoRes = $poClient->request('POST', 'purchase_order.php', [
        'pr_id' => $syncPrId,
        'supplier_id' => $supplierId,
        'po_source' => 'PR-Linked',
        'status' => 'Issued',
        'items' => [
            ['product_id' => $pid2, 'quantity_ordered' => 6, 'unit_cost' => 3000.00]
        ]
    ]);
    $syncPoId = (int)($syncPoRes['data']['data']['po_id'] ?? 0);
    $createdPoIds[] = $syncPoId;

    // Receive the delivery in warehouse
    $syncRecvRes = $warehouseClient->request('POST', 'stock_receiving.php', [
        'po_id' => $syncPoId,
        'receiving_date' => date('Y-m-d'),
        'dr_number' => 'DR-P5-PR-SYNC',
        'remarks' => 'Delivery for PR-linked PO',
        'items' => [
            ['product_id' => $pid2, 'quantity_received' => 6]
        ]
    ]);
    $syncGrnId = (int)($syncRecvRes['data']['data']['receiving_id'] ?? 0);
    $createdGrnIds[] = $syncGrnId;

    // Inspect and post the GRN
    $warehouseClient->request('POST', 'stock_receiving.php', [
        'action' => 'inspect_and_post',
        'receiving_id' => $syncGrnId,
        'inspection_date' => date('Y-m-d'),
        'items' => [
            ['product_id' => $pid2, 'quantity_accepted' => 6, 'quantity_rejected' => 0, 'quantity_quarantined' => 0]
        ]
    ]);

    // Check PR status in database
    $prCheckStmt = $conn->prepare("SELECT status, approval_status, fulfillment_status, completed_at FROM purchase_request WHERE pr_id = :id");
    $prCheckStmt->execute([':id' => $syncPrId]);
    $prRow = $prCheckStmt->fetch();

    assertCheck(
        $prRow['status'] !== 'Completed' &&
        $prRow['fulfillment_status'] !== 'Fulfilled' &&
        $prRow['approval_status'] === 'Approved' &&
        empty($prRow['completed_at']),
        'Test 12: Linked PR is NOT falsely marked Completed or Fulfilled merely because PO was received and inspected',
        "Status: {$prRow['status']}, Approval: {$prRow['approval_status']}, Fulfillment: {$prRow['fulfillment_status']}, CompletedAt: " . ($prRow['completed_at'] ?? 'NULL')
    );

} finally {
    // Restore user passwords exactly
    $stmtRestore = $conn->prepare("UPDATE users SET password = :pwd, is_active = :act WHERE user_id = :id");
    foreach ($origUsers as $u) {
        $stmtRestore->execute([
            ':pwd' => $u['password'],
            ':act' => (int)$u['is_active'],
            ':id'  => (int)$u['user_id']
        ]);
    }

    // Clean up created test entities in safe reverse order
    try {
        if (!empty($createdGrnIds)) {
            $inGrn = implode(',', array_map('intval', $createdGrnIds));
            $conn->exec("DELETE FROM stock_movement WHERE reference_type = 'stock_receiving' AND reference_id IN ({$inGrn})");
            $conn->exec("DELETE FROM stock_receiving_detail WHERE receiving_id IN ({$inGrn})");
            $conn->exec("DELETE FROM stock_receiving WHERE receiving_id IN ({$inGrn})");
        }
        if (!empty($createdPoIds)) {
            $inPo = implode(',', array_map('intval', $createdPoIds));
            $conn->exec("DELETE FROM purchase_order_detail WHERE po_id IN ({$inPo})");
            $conn->exec("DELETE FROM purchase_order WHERE po_id IN ({$inPo})");
        }
        if (!empty($createdPrIds)) {
            $inPr = implode(',', array_map('intval', $createdPrIds));
            $conn->exec("DELETE FROM purchase_request_history WHERE pr_id IN ({$inPr})");
            $conn->exec("DELETE FROM purchase_request_detail WHERE pr_id IN ({$inPr})");
            $conn->exec("DELETE FROM purchase_request WHERE pr_id IN ({$inPr})");
        }
        if (!empty($createdSupplierIds)) {
            $inSup = implode(',', array_map('intval', $createdSupplierIds));
            $conn->exec("DELETE FROM product_supplier WHERE supplier_id IN ({$inSup})");
            $conn->exec("DELETE FROM supplier WHERE supplier_id IN ({$inSup})");
        }
        if (!empty($createdProductIds)) {
            $inPid = implode(',', array_map('intval', $createdProductIds));
            $conn->exec("DELETE FROM product_supplier WHERE product_id IN ({$inPid})");
            $conn->exec("DELETE FROM stock_movement WHERE product_id IN ({$inPid})");
            $conn->exec("DELETE FROM product WHERE product_id IN ({$inPid})");
        }
    } catch (Throwable $e) {
        error_log('Cleanup error: ' . $e->getMessage());
    }
}

echo "\n=================================================================\n";
echo sprintf(" PHASE 5 VERIFICATION RESULTS: %d PASSED / %d FAILED\n", $passedCount, $failedCount);
echo "=================================================================\n";

exit($failedCount > 0 ? 1 : 0);
