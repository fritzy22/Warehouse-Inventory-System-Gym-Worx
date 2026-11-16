<?php
/**
 * GymWorx Warehouse Management System
 * Comprehensive End-to-End Test Suite for Store Workflow & Direct Warehouse Replenishment
 */

declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '1');

$rootDir = realpath(__DIR__ . '/../..');
require_once $rootDir . '/config/db.php';
$conn = getConnection();

$baseUrl = 'http://127.0.0.1/inventory_warehouse/warehouse_finals/api/';
$backupFile = $rootDir . '/setup/backups/pre_role_workflow_20261017.sql';
$migrationFile = $rootDir . '/setup/migrations/2026_10_role_workflow.sql';
$migrationFile2 = $rootDir . '/setup/migrations/2026_10_pr_reorder_pipeline.sql';
$migrationFile3 = $rootDir . '/setup/migrations/2026_10_store_workflow_and_reorder.sql';

$passCount = 0;
$failCount = 0;
$errors = array();

function testAssert(bool $condition, string $description, ?string $extra = null): void {
    global $passCount, $failCount, $errors;
    if ($condition) {
        $passCount++;
        echo "  [PASS] {$description}\n";
    } else {
        $failCount++;
        $msg = "  [FAIL] {$description}";
        if ($extra) {
            $msg .= " -> Details: {$extra}";
        }
        echo $msg . "\n";
        $errors[] = $description . ($extra ? " ({$extra})" : '');
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

echo "\n=================================================================\n";
echo " STORE WORKFLOW & WAREHOUSE REPLENISHMENT VERIFICATION SUITE\n";
echo "=================================================================\n\n";

try {
    // Set predictable passwords for testing
    $testPass = 'TestingPass@123';
    $hash = password_hash($testPass, PASSWORD_DEFAULT);
    $conn->exec("UPDATE role SET is_active = 1 WHERE role_id IN (1, 2, 3, 4, 19)");
    $stmtPwd = $conn->prepare("UPDATE users SET password = ?, is_active = 1 WHERE user_id IN (1, 31, 32, 33, 35)");
    $stmtPwd->execute([$hash]);

    // Create clients
    $adminClient     = new ApiClient($baseUrl, 'admin');
    $managerClient   = new ApiClient($baseUrl, 'manager');
    $purchasingClient = new ApiClient($baseUrl, 'purchasing');
    $warehouseClient = new ApiClient($baseUrl, 'warehouse');
    $requesterClient = new ApiClient($baseUrl, 'requester');

    // 1. Authenticate users
    echo "--- Group 1: Role Authentication ---\n";
    $resAdmin = $adminClient->login('Enhancer', $testPass);
    testAssert($resAdmin['status'] === 200 && ($resAdmin['body']['success'] ?? false), 'Login as Administrator (Enhancer)');

    $resMgr = $managerClient->login('Jean', $testPass);
    testAssert($resMgr['status'] === 200 && ($resMgr['body']['success'] ?? false), 'Login as Manager (Jean)');

    $resPo = $purchasingClient->login('Fritz', $testPass);
    testAssert($resPo['status'] === 200 && ($resPo['body']['success'] ?? false), 'Login as Purchasing Officer (Fritz)');

    $resWh = $warehouseClient->login('christian', $testPass);
    testAssert($resWh['status'] === 200 && ($resWh['body']['success'] ?? false), 'Login as Warehouse Staff (christian)');

    $resReq = $requesterClient->login('zhen1', $testPass);
    testAssert($resReq['status'] === 200 && ($resReq['body']['success'] ?? false), 'Login as Store Requester (zhen1)');

    // Pick test catalog items and link to active supplier
    $prodIds = $conn->query("SELECT product_id FROM product WHERE is_active = 1 ORDER BY product_id ASC LIMIT 3")->fetchAll(PDO::FETCH_COLUMN);
    $pidA = (int)$prodIds[0];
    $pidB = (int)$prodIds[1];
    $supId = (int)$conn->query("SELECT supplier_id FROM supplier WHERE is_active = 1 ORDER BY supplier_id ASC LIMIT 1")->fetchColumn();

    $stmtLink = $conn->prepare(
        "INSERT INTO product_supplier (product_id, supplier_id, supplier_unit_cost)
         VALUES (:pid, :sid, :cost)
         ON DUPLICATE KEY UPDATE supplier_unit_cost = VALUES(supplier_unit_cost)"
    );
    $stmtLink->execute([':pid' => $pidA, ':sid' => $supId, ':cost' => 1500.00]);
    $stmtLink->execute([':pid' => $pidB, ':sid' => $supId, ':cost' => 100.00]);

    // Clear open transactions for isolated testing
    $conn->exec("UPDATE purchase_request SET status = 'Cancelled' WHERE status IN ('Pending', 'For Revision', 'Approved')");
    $conn->exec("UPDATE purchase_order SET status = 'Cancelled' WHERE status IN ('Draft', 'Ordered', 'Partially Received', 'Pending', 'Pending Approval')");

    // 2. Test Low-Stock Central Warehouse Replenishment Formula
    echo "\n--- Group 2: Automatic Low-Stock Monitoring & Reorder Formula ---\n";
    $conn->exec("UPDATE product SET reorder_level = 10, max_stock = 50, is_active = 1 WHERE product_id = {$pidB}");
    // Adjust pidB to exactly 5 units available
    $curB = (int)(productInventoryMetrics($conn, $pidB)['available_stock'] ?? 0);
    $diffB = 5 - $curB;
    if ($diffB !== 0) {
        $stmtAdj = $conn->prepare("INSERT INTO adjustment_detail (user_id, product_id, adjustment_date, adjustment_type, quantity, reason) VALUES (1, ?, CURDATE(), ?, ?, 'QA low stock setup')");
        $stmtAdj->execute([$pidB, $diffB > 0 ? 'Addition' : 'Deduction', abs($diffB)]);
    }

    $resReorder = $purchasingClient->request('GET', 'purchase_order.php?mode=reorder_candidates');
    testAssert($resReorder['status'] === 200 && ($resReorder['body']['success'] ?? false), 'Purchasing Officer gets reorder candidates endpoint');
    $candidates = $resReorder['body']['data'] ?? array();
    $foundProdB = false;
    $suggestedProdB = 0;
    foreach ($candidates as $cand) {
        if ((int)$cand['product_id'] === $pidB) {
            $foundProdB = true;
            $suggestedProdB = (int)$cand['net_suggested_order_qty'];
            break;
        }
    }
    testAssert($foundProdB, "Low-stock Product #{$pidB} is automatically identified in reorder candidates");
    testAssert($suggestedProdB === 45, "Suggested replenishment quantity calculation: Max (50) - Avail (5) = {$suggestedProdB} (expected 45)");

    // 3. Direct Warehouse Replenishment PO (Phase 4A)
    echo "\n--- Group 3: Direct Warehouse Replenishment PO & Manager Approval ---\n";
    $poPayload = array(
        'po_type' => 'warehouse_replenishment',
        'supplier_id' => $supId,
        'order_date' => date('Y-m-d'),
        'notes' => 'Central warehouse low-stock direct replenishment',
        'items' => array(
            array(
                'product_id' => $pidB,
                'quantity_ordered' => 45,
                'unit_cost' => 100.00
            )
        )
    );
    $resCreateDirectPo = $purchasingClient->request('POST', 'purchase_order.php', $poPayload);
    testAssert($resCreateDirectPo['status'] === 200 && ($resCreateDirectPo['body']['success'] ?? false), 'Purchasing Officer creates direct warehouse PO (po_type=warehouse_replenishment)', json_encode($resCreateDirectPo['body']));
    $directPoId = (int)($resCreateDirectPo['body']['data']['po_id'] ?? 0);
    testAssert($directPoId > 0, "Created Direct PO ID={$directPoId}");

    $poCheck = $conn->query("SELECT status, po_type, user_id FROM purchase_order WHERE po_id = $directPoId")->fetch(PDO::FETCH_ASSOC);
    testAssert(($poCheck['status'] ?? '') === 'Pending Approval', "Direct warehouse replenishment PO defaults to status 'Pending Approval'");
    testAssert(($poCheck['po_type'] ?? '') === 'warehouse_replenishment', "PO marked with po_type = 'warehouse_replenishment'");

    // Separation of Duties: Purchasing Officer attempting to approve their own PO is blocked
    $resSelfApprove = $purchasingClient->request('PUT', 'purchase_order.php', array(
        'po_id' => $directPoId,
        'action' => 'approve',
        'manager_notes' => 'Self approval attempt'
    ));
    testAssert($resSelfApprove['status'] === 403, 'Purchasing Officer blocked from approving their own PO (Separation of duties HTTP 403)');

    // Manager approves the Direct PO
    $resMgrApprove = $managerClient->request('PUT', 'purchase_order.php', array(
        'po_id' => $directPoId,
        'action' => 'approve',
        'manager_notes' => 'Approved direct replenishment by Manager Jean'
    ));
    testAssert($resMgrApprove['status'] === 200 && ($resMgrApprove['body']['success'] ?? false), 'Manager approves direct replenishment PO');

    $poApprovedCheck = $conn->query("SELECT status, approved_by, manager_notes FROM purchase_order WHERE po_id = $directPoId")->fetch(PDO::FETCH_ASSOC);
    testAssert(($poApprovedCheck['status'] ?? '') === 'Ordered', "PO status transitions to 'Ordered' upon Manager approval");
    testAssert((int)($poApprovedCheck['approved_by'] ?? 0) === 35, "PO recorded approved_by = 35 (Manager Jean)");

    // Manager Rejection branch
    $poPayload2 = array(
        'po_type' => 'warehouse_replenishment',
        'supplier_id' => $supId,
        'order_date' => date('Y-m-d'),
        'notes' => 'Test direct replenishment to be rejected',
        'items' => array(
            array('product_id' => $pidB, 'quantity_ordered' => 20, 'unit_cost' => 100.00)
        )
    );
    $resPo2 = $purchasingClient->request('POST', 'purchase_order.php', $poPayload2);
    $po2Id = (int)($resPo2['body']['data']['po_id'] ?? 0);
    $resRejNoReason = $managerClient->request('PUT', 'purchase_order.php', array(
        'po_id' => $po2Id,
        'action' => 'reject',
        'reason' => ''
    ));
    testAssert($resRejNoReason['status'] === 422, 'Manager reject without reason is blocked (HTTP 422)');

    $resMgrReject = $managerClient->request('PUT', 'purchase_order.php', array(
        'po_id' => $po2Id,
        'action' => 'reject',
        'reason' => 'Sufficient stock currently available in secondary warehouse'
    ));
    testAssert($resMgrReject['status'] === 200 && ($resMgrReject['body']['success'] ?? false), 'Manager rejects direct replenishment PO with reason');
    $po2Check = $conn->query("SELECT status, manager_notes FROM purchase_order WHERE po_id = $po2Id")->fetch(PDO::FETCH_ASSOC);
    testAssert(($po2Check['status'] ?? '') === 'Cancelled', "Rejected direct PO status transitions to 'Cancelled'");

    // 4. Store Replenishment Request & Internal Warehouse Fulfillment (Phase 4B & Phase 7)
    echo "\n--- Group 4: Store Replenishment Request & Warehouse Fulfillment ---\n";
    $conn->exec("UPDATE product SET reorder_level = 10, max_stock = 100, is_active = 1 WHERE product_id = {$pidA}");
    // Adjust pidA to exactly 50 units available
    $curA = (int)(productInventoryMetrics($conn, $pidA)['available_stock'] ?? 0);
    $diffA = 50 - $curA;
    if ($diffA !== 0) {
        $stmtAdj = $conn->prepare("INSERT INTO adjustment_detail (user_id, product_id, adjustment_date, adjustment_type, quantity, reason) VALUES (1, ?, CURDATE(), ?, ?, 'QA store request setup')");
        $stmtAdj->execute([$pidA, $diffA > 0 ? 'Addition' : 'Deduction', abs($diffA)]);
    }
    $conn->exec("DELETE FROM store_inventory WHERE store_name = 'Makati Branch Gym'");

    $storePrPayload = array(
        'reason' => 'Weekly replenishment for store front display',
        'store_name' => 'Makati Branch Gym',
        'items' => array(
            array('product_id' => $pidA, 'requested_qty' => 15)
        )
    );
    $resStorePr = $requesterClient->request('POST', 'purchase_request.php', $storePrPayload);
    testAssert($resStorePr['status'] === 200 && ($resStorePr['body']['success'] ?? false), 'Store Requester submits Store Request with store_name="Makati Branch Gym"');
    $storePrId = (int)($resStorePr['body']['data']['pr_id'] ?? 0);
    testAssert($storePrId > 0, "Created Store Request PR ID={$storePrId}");

    $resPrDetail = $managerClient->request('GET', "purchase_request.php?mode=detail&pr_id={$storePrId}");
    testAssert($resPrDetail['status'] === 200 && ($resPrDetail['body']['success'] ?? false), 'Manager reviews Store Request detail');
    $prData = $resPrDetail['body']['data'] ?? array();
    testAssert(($prData['store_name'] ?? '') === 'Makati Branch Gym', "Store name preserved and returned in PR detail (Actual: '" . ($prData['store_name'] ?? '') . "')");
    $firstItem = $prData['items'][0] ?? array();
    testAssert((int)($firstItem['available_warehouse_stock'] ?? $firstItem['available_stock'] ?? 0) === 50, "Central warehouse stock correctly displayed alongside requested qty (Available: 50, Requested: 15)");
    testAssert(empty($firstItem['has_shortage']), "No warehouse stock shortage flagged for 15 units out of 50");

    $resMgrApprovePr = $managerClient->request('PUT', 'purchase_request.php', array(
        'action' => 'approve',
        'pr_id' => $storePrId,
        'comment' => 'Adjusted from 15 to 12 based on shelf capacity quota',
        'items' => array(
            array('product_id' => $pidA, 'approved_qty' => 12)
        )
    ));
    testAssert($resMgrApprovePr['status'] === 200 && ($resMgrApprovePr['body']['success'] ?? false), 'Manager approves Store Request with quantity modification (15 -> 12) and audit comment');

    $resPendingReleases = $warehouseClient->request('GET', 'stock_releasing.php?mode=pending_pr_releases');
    testAssert($resPendingReleases['status'] === 200 && ($resPendingReleases['body']['success'] ?? false), 'Warehouse Staff queries pending PR releases queue');
    $pendingList = $resPendingReleases['body']['data'] ?? array();
    $foundPendingPr = false;
    foreach ($pendingList as $relPr) {
        if ((int)$relPr['pr_id'] === $storePrId) {
            $foundPendingPr = true;
            break;
        }
    }
    testAssert($foundPendingPr, 'Approved Store Request appears in Warehouse Staff pending releases queue');

    $releasePayload = array(
        'pr_id' => $storePrId,
        'destination_store' => 'Makati Branch Gym',
        'releasing_date' => date('Y-m-d'),
        'remarks' => 'Dispatched via delivery van #2 to Makati Branch Gym',
        'items' => array(
            array(
                'product_id' => $pidA,
                'quantity_released' => 12,
                'unit_cost' => 500.00
            )
        )
    );
    $resFulfill = $warehouseClient->request('POST', 'stock_releasing.php', $releasePayload);
    testAssert($resFulfill['status'] === 200 && ($resFulfill['body']['success'] ?? false), 'Warehouse Staff fulfills Store Request via stock_releasing (linked to pr_id)');

    $whStockAfter = (int)(productInventoryMetrics($conn, $pidA)['available_stock'] ?? 0);
    testAssert($whStockAfter === 38, "Central warehouse stock decremented accurately: 50 - 12 = {$whStockAfter} (expected 38)");

    $resStoreInv = $warehouseClient->request('GET', 'stock_releasing.php?mode=store_inventory&store_name=Makati+Branch+Gym');
    testAssert($resStoreInv['status'] === 200 && ($resStoreInv['body']['success'] ?? false), 'Warehouse Staff queries store_inventory');
    $storeInvList = $resStoreInv['body']['data'] ?? array();
    $storeQty = 0;
    foreach ($storeInvList as $inv) {
        if ((int)$inv['product_id'] === $pidA && $inv['store_name'] === 'Makati Branch Gym') {
            $storeQty = (int)$inv['store_stock'];
            break;
        }
    }
    testAssert($storeQty === 12, "Destination store inventory updated: Makati Branch Gym stock = {$storeQty} (expected 12)");

    $prFinal = $conn->query("SELECT status, releasing_id FROM purchase_request WHERE pr_id = $storePrId")->fetch(PDO::FETCH_ASSOC);
    testAssert(($prFinal['status'] ?? '') === 'Completed', "Originating Store PR status automatically rolled up to 'Completed'");
    testAssert((int)($prFinal['releasing_id'] ?? 0) > 0, "Originating Store PR linked to releasing_id={$prFinal['releasing_id']}");

    // 5. Shortage Detection Scenario (Phase 4B)
    echo "\n--- Group 5: Warehouse Shortage Detection ---\n";
    // Central warehouse has 38 units of pidA. Store Requester requests 50 units (exceeds 38)
    $shortagePrPayload = array(
        'reason' => 'Bulk equipment restock for peak season',
        'store_name' => 'BGC Branch Gym',
        'items' => array(
            array('product_id' => $pidA, 'requested_qty' => 50)
        )
    );
    $resShortagePr = $requesterClient->request('POST', 'purchase_request.php', $shortagePrPayload);
    $shortagePrId = (int)($resShortagePr['body']['data']['pr_id'] ?? 0);
    $resShortageCheck = $managerClient->request('GET', "purchase_request.php?mode=detail&pr_id={$shortagePrId}");
    $shortageItem = $resShortageCheck['body']['data']['items'][0] ?? array();
    testAssert(!empty($shortageItem['has_shortage']), "Shortage correctly flagged when requested (50) exceeds central warehouse stock (38)");
    testAssert((int)($shortageItem['shortage_qty'] ?? 0) === 12, "Calculated shortage quantity = 12 (50 - 38 = 12)");

    // 6. Purchase Return with PO / DR Linkage (Phase 9)
    echo "\n--- Group 6: Purchase Returns Linked to PO & DR ---\n";
    $resReturnSources = $warehouseClient->request('GET', "purchase_return.php?mode=sources&supplier_id={$supId}");
    testAssert($resReturnSources['status'] === 200 && ($resReturnSources['body']['success'] ?? false), 'Warehouse Staff queries purchase return sources (linked DRs & POs)');

    // Ensure there is at least 5 units on hand for pidB to return 2
    $returnPayload = array(
        'supplier_id' => $supId,
        'po_id' => $directPoId,
        'receiving_id' => 1,
        'return_date' => date('Y-m-d'),
        'reason' => 'Packaging damaged during courier transit',
        'items' => array(
            array('product_id' => $pidB, 'quantity_returned' => 2, 'unit_cost' => 100.00)
        )
    );
    $resCreateReturn = $warehouseClient->request('POST', 'purchase_return.php', $returnPayload);
    testAssert($resCreateReturn['status'] === 200 && ($resCreateReturn['body']['success'] ?? false), 'Warehouse Staff creates purchase return linked to PO and DR');
    $returnId = (int)($resCreateReturn['body']['data']['purchase_return_id'] ?? 0);
    testAssert($returnId > 0, "Created Return ID={$returnId}");

    $resReturnDetail = $warehouseClient->request('GET', "purchase_return.php?mode=detail&return_id={$returnId}");
    $returnDetail = $resReturnDetail['body']['data'] ?? array();
    testAssert((int)($returnDetail['po_id'] ?? 0) === $directPoId, "Purchase return record preserves linked po_id={$directPoId}");
    testAssert((int)($returnDetail['receiving_id'] ?? 0) === 1, "Purchase return record preserves linked receiving_id=1");

    // 7. Multi-Role Live Operational Dashboard Verification (Phase 2)
    echo "\n--- Group 7: Multi-Role Dashboard Operational Counts ---\n";
    // Manager Dashboard
    $resMgrDash = $managerClient->request('GET', 'dashboard.php');
    $mgrKpis = $resMgrDash['body']['data']['kpis'] ?? array();
    testAssert(isset($mgrKpis['pos_pending_approval']), "Manager dashboard includes pos_pending_approval KPI card");
    testAssert(isset($mgrKpis['awaiting_approval']), "Manager dashboard includes awaiting_approval KPI card");

    // Purchasing Officer Dashboard
    $resPoDash = $purchasingClient->request('GET', 'dashboard.php');
    $poKpis = $resPoDash['body']['data']['kpis'] ?? array();
    testAssert(isset($poKpis['items_to_reorder']), "Purchasing Officer dashboard includes items_to_reorder KPI card");
    testAssert(isset($poKpis['pos_pending_approval']), "Purchasing Officer dashboard includes pos_pending_approval KPI card");
    testAssert(isset($resPoDash['body']['data']['items_to_reorder']), "Purchasing Officer dashboard includes items_to_reorder list");

    // Warehouse Staff Dashboard
    $resWhDash = $warehouseClient->request('GET', 'dashboard.php');
    $whKpis = $resWhDash['body']['data']['kpis'] ?? array();
    testAssert(isset($whKpis['pending_releases']), "Warehouse Staff dashboard includes pending_releases KPI card");
    testAssert(isset($whKpis['deliveries_awaiting_receiving']), "Warehouse Staff dashboard includes deliveries_awaiting_receiving KPI card");
    testAssert(isset($resWhDash['body']['data']['pending_pr_releases']), "Warehouse Staff dashboard includes pending_pr_releases queue");

} finally {
    echo "\nRestoring clean pre-test database snapshot...\n";
    if (file_exists($backupFile) && file_exists($migrationFile)) {
        exec('"C:\xampp\mysql\bin\mysql.exe" --default-character-set=utf8mb4 -u root warehouse_inventory_db < ' . escapeshellarg($backupFile));
        exec('"C:\xampp\mysql\bin\mysql.exe" --default-character-set=utf8mb4 -u root warehouse_inventory_db < ' . escapeshellarg($migrationFile));
        if (file_exists($migrationFile2)) {
            exec('"C:\xampp\mysql\bin\mysql.exe" --default-character-set=utf8mb4 -u root warehouse_inventory_db < ' . escapeshellarg($migrationFile2));
        }
        if (file_exists($migrationFile3)) {
            exec('"C:\xampp\mysql\bin\mysql.exe" --default-character-set=utf8mb4 -u root warehouse_inventory_db < ' . escapeshellarg($migrationFile3));
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
echo " TEST SUMMARY: {$passCount} PASSED, {$failCount} FAILED\n";
echo "=================================================================\n\n";

if ($failCount > 0) {
    echo "FAILED ASSERTIONS:\n";
    foreach ($errors as $e) {
        echo " - {$e}\n";
    }
    exit(1);
}

exit(0);
