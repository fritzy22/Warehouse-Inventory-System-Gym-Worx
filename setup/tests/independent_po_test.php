<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config/db.php';
require_once __DIR__ . '/../../config/inventory.php';

echo "=================================================================\n";
echo " INDEPENDENT PURCHASE ORDER VERIFICATION SUITE\n";
echo "=================================================================\n\n";

$conn = getConnection();
$baseUrl = 'http://127.0.0.1/updated_inventory_website/warehouse_finals/api/';

$testPass = 'TestPass#2026!';
$testHash = password_hash($testPass, PASSWORD_DEFAULT);

// Backup existing passwords
$origUsers = $conn->query("SELECT user_id, password, is_active FROM users WHERE user_id IN (1, 31, 32, 33, 35)")->fetchAll();
$conn->prepare("UPDATE users SET password = ?, is_active = 1 WHERE user_id IN (1, 31, 32, 33, 35)")->execute([$testHash]);

class ApiClient {
    private string $baseUrl;
    private string $cookieFile;
    private ?string $csrf = null;

    public function __construct(string $baseUrl) {
        $this->baseUrl = $baseUrl;
        $this->cookieFile = sys_get_temp_dir() . '/test_po_cookie_' . uniqid() . '.txt';
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
        if ($this->csrf && in_array(strtoupper($method), ['POST', 'PUT', 'DELETE'], true)) {
            $headers[] = 'X-CSRF-Token: ' . $this->csrf;
        }

        if ($payload !== null) {
            $headers[] = 'Content-Type: application/json';
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        }

        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        $resp = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $json = json_decode((string)$resp, true);
        return ['status' => $status, 'data' => $json];
    }

    public function login(string $username, string $password): array {
        $res = $this->request('POST', 'auth.php?action=login', [
            'username' => $username,
            'password' => $password
        ]);
        if (isset($res['data']['data']['csrf_token'])) {
            $this->csrf = $res['data']['data']['csrf_token'];
        }
        return $res;
    }
}

$passed = 0;
$failed = 0;

function assertCheck(string $desc, bool $condition, string $detail = '') {
    global $passed, $failed;
    if ($condition) {
        $passed++;
        echo " [PASS] $desc\n";
    } else {
        $failed++;
        echo " [FAIL] $desc" . ($detail ? " ($detail)" : "") . "\n";
    }
}

try {
    $poClient = new ApiClient($baseUrl);
    $loginRes = $poClient->login('Fritz', $testPass); // Purchasing Officer
    assertCheck('Purchasing Officer login succeeds', $loginRes['status'] === 200 && ($loginRes['data']['success'] ?? false));

    // 1. Verify Active Suppliers API returns suppliers
    $supRes = $poClient->request('GET', 'supplier.php?mode=active');
    assertCheck('Active Suppliers retrieved', $supRes['status'] === 200 && !empty($supRes['data']['data']));
    $supplierId = (int)$supRes['data']['data'][0]['supplier_id'];
    $supplierName = $supRes['data']['data'][0]['supplier_name'];

    // 2. Verify product_supplier API returns products with unit_measure & supplier_unit_cost
    $prodSupRes = $poClient->request('GET', "product_supplier.php?supplier_id=$supplierId&linked_only=0");
    assertCheck('Product-Supplier API returns products for supplier', $prodSupRes['status'] === 200 && !empty($prodSupRes['data']['data']));
    $firstProduct = $prodSupRes['data']['data'][0];
    assertCheck('Product includes unit_measure and supplier_unit_cost', isset($firstProduct['unit_measure']) && isset($firstProduct['supplier_unit_cost']));
    $productId = (int)$firstProduct['product_id'];
    $productCost = (float)$firstProduct['supplier_unit_cost'];

    // Get current stock before PO
    $initialStock = productInventoryMetrics($conn, $productId)['usable_stock'];

    // 3. Submit empty PO form -> rejected with 400
    $emptyRes = $poClient->request('POST', 'purchase_order.php', [
        'po_source' => 'Independent',
        'po_type' => 'Independent',
        'pr_id' => null,
        'supplier_id' => 0,
        'order_date' => '',
        'items' => []
    ]);
    assertCheck('Submit empty PO form is rejected with HTTP 400', $emptyRes['status'] === 400);

    // 4. Submit valid Independent PO
    $orderDate = date('Y-m-d');
    $expDate = date('Y-m-d', strtotime('+7 days'));
    $clientToken = 'test_token_' . uniqid();
    $qtyToOrder = 15;
    $expectedTotal = round($qtyToOrder * $productCost, 2);

    $createRes = $poClient->request('POST', 'purchase_order.php', [
        'po_source' => 'Independent',
        'po_type' => 'Independent',
        'pr_id' => null,
        'supplier_id' => $supplierId,
        'order_date' => $orderDate,
        'expected_date' => $expDate,
        'status' => 'Ordered',
        'notes' => 'Automated test independent PO',
        'client_token' => $clientToken,
        'items' => [
            [
                'product_id' => $productId,
                'pr_detail_id' => null,
                'quantity_ordered' => $qtyToOrder,
                'unit_cost' => $productCost
            ]
        ]
    ]);
    assertCheck('Submit valid Independent PO succeeds (HTTP 200)', $createRes['status'] === 200 && ($createRes['data']['success'] ?? false));
    $poId = (int)($createRes['data']['data']['po_id'] ?? 0);
    $poCode = $createRes['data']['data']['po_code'] ?? '';

    // 5. Double-click idempotency guard: submit again with same client_token
    $dupRes = $poClient->request('POST', 'purchase_order.php', [
        'po_source' => 'Independent',
        'po_type' => 'Independent',
        'pr_id' => null,
        'supplier_id' => $supplierId,
        'order_date' => $orderDate,
        'expected_date' => $expDate,
        'status' => 'Ordered',
        'notes' => 'Duplicate attempt',
        'client_token' => $clientToken,
        'items' => [
            [
                'product_id' => $productId,
                'pr_detail_id' => null,
                'quantity_ordered' => $qtyToOrder,
                'unit_cost' => $productCost
            ]
        ]
    ]);
    assertCheck('Duplicate submission with same client_token is rejected with HTTP 409', $dupRes['status'] === 409);

    // 6. View Purchase Orders list -> Newly created PO appears
    $listRes = $poClient->request('GET', 'purchase_order.php');
    assertCheck('PO List retrieves successfully', $listRes['status'] === 200 && is_array($listRes['data']['data']));
    $foundInList = false;
    foreach ($listRes['data']['data'] as $p) {
        if ((int)$p['po_id'] === $poId) {
            $foundInList = true;
            assertCheck('Newly created PO has source=Independent', $p['po_source'] === 'Independent' && empty($p['pr_id']));
            assertCheck('Newly created PO has correct status=Ordered', $p['status'] === 'Ordered' || $p['order_status'] === 'Issued');
            break;
        }
    }
    assertCheck('Newly created PO appears in Purchase Orders list', $foundInList);

    // 7. Open created PO detail endpoint
    $detailRes = $poClient->request('GET', "purchase_order.php?mode=detail&po_id=$poId");
    assertCheck('PO detail endpoint returns 200', $detailRes['status'] === 200);
    $poDetail = $detailRes['data']['data'];
    assertCheck('PO detail has pr_id=NULL', $poDetail['pr_id'] === null);
    assertCheck('PO detail has supplier_id matching selected supplier', (int)$poDetail['supplier_id'] === $supplierId);
    assertCheck('PO detail line items count is 1', count($poDetail['items']) === 1);
    assertCheck('PO detail line item quantity ordered matches', (int)$poDetail['items'][0]['quantity_ordered'] === $qtyToOrder);
    assertCheck('PO detail total amount matches calculation', abs((float)$poDetail['total_amount'] - $expectedTotal) < 0.01);

    // 8. Stock isolation verification: Creating an Independent PO must NOT increment warehouse stock
    $stockAfterPo = productInventoryMetrics($conn, $productId)['usable_stock'];
    assertCheck('Creating an Independent PO does not immediately alter warehouse inventory', $stockAfterPo === $initialStock, "Initial: $initialStock, After: $stockAfterPo");

    // 9. Role-based Access Control: Store Requester cannot create POs
    $reqClient = new ApiClient($baseUrl);
    $reqLogin = $reqClient->login('zhen1', $testPass); // Store Requester
    assertCheck('Store Requester login succeeds', $reqLogin['status'] === 200);
    $unauthPoRes = $reqClient->request('POST', 'purchase_order.php', [
        'po_source' => 'Independent',
        'po_type' => 'Independent',
        'pr_id' => null,
        'supplier_id' => $supplierId,
        'order_date' => $orderDate,
        'items' => [
            ['product_id' => $productId, 'quantity_ordered' => 5, 'unit_cost' => $productCost]
        ]
    ]);
    assertCheck('Store Requester cannot create Independent PO (HTTP 403 Forbidden)', $unauthPoRes['status'] === 403);

    // Clean up created PO
    $conn->prepare("DELETE FROM purchase_order_detail WHERE po_id = ?")->execute([$poId]);
    $conn->prepare("DELETE FROM purchase_order WHERE po_id = ?")->execute([$poId]);
    $conn->prepare("DELETE FROM audit_log WHERE module = 'purchase_order' AND record_id = ?")->execute([$poId]);
    echo " [INFO] Cleaned up test PO #$poId ($poCode)\n";

} finally {
    // Restore user passwords
    $stmtRestore = $conn->prepare("UPDATE users SET password = :pwd, is_active = :act WHERE user_id = :id");
    foreach ($origUsers as $u) {
        $stmtRestore->execute([
            ':pwd' => $u['password'],
            ':act' => $u['is_active'],
            ':id'  => $u['user_id']
        ]);
    }
}

echo "\n=================================================================\n";
echo " INDEPENDENT PO VERIFICATION RESULTS: $passed PASSED / $failed FAILED\n";
echo "=================================================================\n";

if ($failed > 0) exit(1);
