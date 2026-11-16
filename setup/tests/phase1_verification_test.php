<?php
/**
 * Phase 1 Formal Verification Test Suite
 * Inventory and Warehouse Management System (GymWorx Warehouse)
 *
 * Verifies:
 * 1. Syntax of all PHP and configuration files.
 * 2. Database configuration and role/permissions schema.
 * 3. Authentication for all 5 roles with valid active accounts.
 * 4. Rejection of invalid credentials (401).
 * 5. Rejection of inactive accounts (403).
 * 6. Role identification and correct dashboard mapping.
 * 7. Server-side authorization and RBAC module isolation.
 * 8. Separation of duties:
 *    - Admin cannot perform Manager or Warehouse Officer approvals/stock changes.
 *    - Store Requester cannot approve PRs or modify inventory.
 *    - Manager cannot modify inventory.
 *    - Purchasing Officer cannot approve PRs or modify inventory directly.
 *    - Warehouse Officer cannot approve PRs.
 * 9. Secure session lifecycle and logout.
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');

$rootDir = realpath(__DIR__ . '/../..');
require_once $rootDir . '/config/db.php';
require_once $rootDir . '/config/permissions.php';

$conn = getConnection();

echo "=================================================================\n";
echo " PHASE 1 VERIFICATION & SECURITY AUDIT SUITE\n";
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

// -------------------------------------------------------------
// SECTION 1: Code Linting
// -------------------------------------------------------------
echo "--- SECTION 1: PHP Syntax & Linting ---\n";
$phpFiles = array_merge(
    glob($rootDir . '/*.php') ?: [],
    glob($rootDir . '/config/*.php') ?: [],
    glob($rootDir . '/api/*.php') ?: []
);

$lintAllPassed = true;
foreach ($phpFiles as $file) {
    $out = [];
    $code = 0;
    exec('"C:\xampp\php\php.exe" -l ' . escapeshellarg($file) . ' 2>&1', $out, $code);
    if ($code !== 0) {
        $lintAllPassed = false;
        echo " Lint error in {$file}: " . implode(' ', $out) . "\n";
    }
}
assertCheck($lintAllPassed, 'All PHP files pass syntax lint', count($phpFiles) . ' files checked');

// -------------------------------------------------------------
// SECTION 2: Role & Permission Matrix Configuration
// -------------------------------------------------------------
echo "\n--- SECTION 2: Role & Permission Matrix in Database ---\n";

$rolesStmt = $conn->query("SELECT role_id, role_name, is_active FROM role ORDER BY role_id");
$roles = $rolesStmt->fetchAll();
$roleNames = array_column($roles, 'role_name', 'role_id');

assertCheck(isset($roleNames[1]) && $roleNames[1] === 'Administrator', 'Role 1 is Administrator');
assertCheck(isset($roleNames[2]) && ($roleNames[2] === 'Warehouse Officer' || $roleNames[2] === 'Warehouse Staff'), 'Role 2 is Warehouse Officer');
assertCheck(isset($roleNames[3]) && $roleNames[3] === 'Purchasing Officer', 'Role 3 is Purchasing Officer');
assertCheck(isset($roleNames[4]) && $roleNames[4] === 'Store Requester', 'Role 4 is Store Requester');
assertCheck(isset($roleNames[19]) && $roleNames[19] === 'Manager', 'Role 19 is Manager');

// Verify Admin cannot approve PRs or do direct warehouse operations
assertCheck(!userCan(1, 'request_approval', 'manage'), 'Admin cannot perform Manager request approvals (request_approval.manage = false)');
assertCheck(!userCan(1, 'stock_receiving', 'manage'), 'Admin cannot perform stock receiving (stock_receiving.manage = false)');
assertCheck(!userCan(1, 'stock_releasing', 'manage'), 'Admin cannot perform stock releases (stock_releasing.manage = false)');
assertCheck(!userCan(1, 'adjustment', 'manage'), 'Admin cannot perform manual stock adjustments (adjustment.manage = false)');

// Verify Admin CAN manage users, roles, products, categories, suppliers
assertCheck(userCan(1, 'users', 'manage'), 'Admin can manage users');
assertCheck(userCan(1, 'role', 'manage'), 'Admin can manage roles');
assertCheck(userCan(1, 'product', 'manage'), 'Admin can manage products');
assertCheck(userCan(1, 'category', 'manage'), 'Admin can manage categories');
assertCheck(userCan(1, 'supplier', 'manage'), 'Admin can manage suppliers');
assertCheck(userCan(1, 'audit_log', 'view'), 'Admin can access audit log');

// Verify Store Requester
assertCheck(userCan(4, 'purchase_request', 'manage'), 'Store Requester can create/manage purchase requests');
assertCheck(!userCan(4, 'request_approval', 'manage'), 'Store Requester cannot approve requests');
assertCheck(!userCan(4, 'stock_releasing', 'manage'), 'Store Requester cannot release stock');
assertCheck(!userCan(4, 'stocks_return', 'manage'), 'Store Requester cannot return stocks directly');
assertCheck(!userCan(4, 'adjustment', 'manage'), 'Store Requester cannot adjust stock');
assertCheck(!userCan(4, 'purchase_order', 'manage'), 'Store Requester cannot create purchase orders');
assertCheck(!userCan(4, 'users', 'view'), 'Store Requester cannot view users');

// Verify Manager
assertCheck(userCan(19, 'request_approval', 'manage'), 'Manager can approve requests (request_approval.manage = true)');
assertCheck(!userCan(19, 'stock_receiving', 'manage'), 'Manager cannot directly receive stock');
assertCheck(!userCan(19, 'stock_releasing', 'manage'), 'Manager cannot directly release stock');
assertCheck(!userCan(19, 'adjustment', 'manage'), 'Manager cannot adjust stock');
assertCheck(!userCan(19, 'users', 'view'), 'Manager cannot view/manage users');

// Verify Purchasing Officer
assertCheck(userCan(3, 'purchase_order', 'manage'), 'Purchasing Officer can manage POs');
assertCheck(!userCan(3, 'request_approval', 'manage'), 'Purchasing Officer cannot approve requests');
assertCheck(!userCan(3, 'stock_releasing', 'manage'), 'Purchasing Officer cannot release stock');

// Verify Warehouse Officer
assertCheck(userCan(2, 'stock_receiving', 'manage'), 'Warehouse Officer can receive stock');
assertCheck(userCan(2, 'stock_releasing', 'manage'), 'Warehouse Officer can release stock');
assertCheck(userCan(2, 'adjustment', 'manage'), 'Warehouse Officer can perform adjustments');
assertCheck(!userCan(2, 'request_approval', 'manage'), 'Warehouse Officer cannot approve requests');
assertCheck(!userCan(2, 'purchase_order', 'manage'), 'Warehouse Officer cannot create purchase orders');

// -------------------------------------------------------------
// SECTION 3: HTTP API Authentication, Sessions & RBAC
// -------------------------------------------------------------
echo "\n--- SECTION 3: HTTP API Verification (Auth, Session & Security) ---\n";

class Phase1HttpTester {
    private string $baseUrl;
    private string $cookieFile;
    public ?string $csrfToken = null;

    public function __construct(string $baseUrl, string $tag) {
        $this->baseUrl = $baseUrl;
        $this->cookieFile = sys_get_temp_dir() . '/p1_cookie_' . $tag . '_' . uniqid() . '.txt';
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

// Spin up built-in PHP server on 127.0.0.1:8088
$serverHost = '127.0.0.1';
$serverPort = 8088;
$serverBase = "http://{$serverHost}:{$serverPort}/warehouse_finals/api/";
$docRoot = realpath(__DIR__ . '/../../../');

$serverCmd = sprintf(
    'powershell -NoProfile -Command "Start-Process -FilePath \'C:\xampp\php\php.exe\' -ArgumentList \'-S %s:%d -t \"%s\"\' -WindowStyle Hidden"',
    $serverHost,
    $serverPort,
    $docRoot
);
pclose(popen($serverCmd, 'r'));
usleep(600000); // 600ms warm up

// Backup user passwords and active statuses to restore exactly after test
$origUsers = $conn->query("SELECT user_id, password, is_active FROM users WHERE user_id IN (1, 2, 31, 32, 33, 35)")->fetchAll();
$testPassword = 'TestPass#2026!';
$testHash = password_hash($testPassword, PASSWORD_DEFAULT);

// Temporarily set known password on the 5 active roles
$conn->prepare("UPDATE users SET password = ?, is_active = 1 WHERE user_id IN (1, 31, 32, 33, 35)")->execute([$testHash]);
// Ensure user 2 (zhen) remains inactive
$conn->exec("UPDATE users SET password = '{$testHash}', is_active = 0 WHERE user_id = 2");

try {
    $tester = new Phase1HttpTester($serverBase, 'auth_tester');

    // 1. Invalid credentials rejection
    $badLogin = $tester->login('Enhancer', 'WrongPassword123!');
    assertCheck($badLogin['status'] === 401 && empty($badLogin['data']['success']), 'Invalid credentials rejected with HTTP 401');

    $nonexistent = $tester->login('non_existent_user_999', 'AnyPassword123!');
    assertCheck($nonexistent['status'] === 401 && empty($nonexistent['data']['success']), 'Non-existent user rejected with HTTP 401');

    // 2. Inactive account rejection
    $inactiveLogin = $tester->login('zhen', $testPassword);
    assertCheck($inactiveLogin['status'] === 403 && empty($inactiveLogin['data']['success']), 'Inactive account rejected with HTTP 403 (Account deactivated)');

    // 3. Test active logins and dashboard routing for all 5 roles
    $testRoles = [
        'Administrator'      => ['user' => 'Enhancer',  'profile' => 'admin'],
        'Manager'            => ['user' => 'Jean',      'profile' => 'manager'],
        'Purchasing Officer' => ['user' => 'Fritz',     'profile' => 'purchasing'],
        'Warehouse Officer'  => ['user' => 'christian', 'profile' => 'warehouse'],
        'Store Requester'    => ['user' => 'zhen1',     'profile' => 'requester']
    ];

    $clients = [];
    foreach ($testRoles as $roleName => $info) {
        $c = new Phase1HttpTester($serverBase, strtolower(str_replace(' ', '_', $roleName)));
        $res = $c->login($info['user'], $testPassword);
        $ok = $res['status'] === 200 && !empty($res['data']['success']) && isset($res['data']['data']['user']);
        assertCheck($ok, "Role [{$roleName}] logs in successfully as user '{$info['user']}'");

        if ($ok) {
            $dashRes = $c->request('GET', 'dashboard.php');
            $profileMatch = ($dashRes['status'] === 200 && ($dashRes['data']['data']['profile'] ?? '') === $info['profile']);
            assertCheck($profileMatch, "Role [{$roleName}] receives correct dashboard profile '{$info['profile']}'");
            $clients[$roleName] = $c;
        }
    }

    // 4. Server-Side Protection & Separation of Duties Tests
    echo "\n--- SECTION 4: Server-Side Protection & Separation of Duties Enforcement ---\n";

    // A. PR Approval Protection: Only Manager may approve PRs. Admin, Purchasing, Warehouse, Requester MUST be rejected (403)
    if (isset($clients['Administrator'])) {
        $adminApprove = $clients['Administrator']->request('PUT', 'purchase_request.php', ['action' => 'approve', 'pr_id' => 9999]);
        assertCheck($adminApprove['status'] === 403, 'Admin approval attempt rejected with HTTP 403 (Forbidden)');
    }
    if (isset($clients['Purchasing Officer'])) {
        $poApprove = $clients['Purchasing Officer']->request('PUT', 'purchase_request.php', ['action' => 'approve', 'pr_id' => 9999]);
        assertCheck($poApprove['status'] === 403, 'Purchasing Officer approval attempt rejected with HTTP 403 (Forbidden)');
    }
    if (isset($clients['Warehouse Officer'])) {
        $whApprove = $clients['Warehouse Officer']->request('PUT', 'purchase_request.php', ['action' => 'approve', 'pr_id' => 9999]);
        assertCheck($whApprove['status'] === 403, 'Warehouse Officer approval attempt rejected with HTTP 403 (Forbidden)');
    }
    if (isset($clients['Store Requester'])) {
        $reqApprove = $clients['Store Requester']->request('PUT', 'purchase_request.php', ['action' => 'approve', 'pr_id' => 9999]);
        assertCheck($reqApprove['status'] === 403, 'Store Requester approval attempt rejected with HTTP 403 (Forbidden)');
    }
    if (isset($clients['Manager'])) {
        $mgrApprove = $clients['Manager']->request('PUT', 'purchase_request.php', ['action' => 'approve', 'pr_id' => 9999]);
        // Manager reaches business validation (404/422/409, NOT 403)
        assertCheck(in_array($mgrApprove['status'], [404, 422, 409], true), 'Manager holds approval authority (passes 403 check, reaches business logic)');
    }

    // B. Stock Modification Protection: Only Warehouse Officer may adjust or receive stock
    if (isset($clients['Administrator'])) {
        $adminAdj = $clients['Administrator']->request('POST', 'adjustment.php', ['product_id' => 1, 'quantity' => 1, 'adjustment_type' => 'Addition']);
        assertCheck($adminAdj['status'] === 403, 'Admin stock adjustment rejected with HTTP 403');
    }
    if (isset($clients['Manager'])) {
        $mgrAdj = $clients['Manager']->request('POST', 'adjustment.php', ['product_id' => 1, 'quantity' => 1, 'adjustment_type' => 'Addition']);
        assertCheck($mgrAdj['status'] === 403, 'Manager stock adjustment rejected with HTTP 403');
    }
    if (isset($clients['Store Requester'])) {
        $reqAdj = $clients['Store Requester']->request('POST', 'adjustment.php', ['product_id' => 1, 'quantity' => 1, 'adjustment_type' => 'Addition']);
        assertCheck($reqAdj['status'] === 403, 'Store Requester stock adjustment rejected with HTTP 403');
    }
    if (isset($clients['Warehouse Officer'])) {
        $whAdj = $clients['Warehouse Officer']->request('POST', 'adjustment.php', ['product_id' => 9999, 'quantity' => 1, 'adjustment_type' => 'Addition']);
        // Warehouse Officer is authorized to adjust (fails on product validation, NOT 403)
        assertCheck(in_array($whAdj['status'], [400, 404, 422], true), 'Warehouse Officer holds stock adjustment authority (not 403)');
    }

    // C. Sensitive Record Isolation: Users and Audit Log
    if (isset($clients['Administrator'])) {
        $aud = $clients['Administrator']->request('GET', 'audit_log.php?mode=audit&limit=5');
        assertCheck($aud['status'] === 200, 'Admin can view system audit logs (HTTP 200)');
        $usr = $clients['Administrator']->request('GET', 'users.php');
        assertCheck($usr['status'] === 200, 'Admin can view and manage user accounts (HTTP 200)');
    }
    if (isset($clients['Manager'])) {
        $aud = $clients['Manager']->request('GET', 'audit_log.php?mode=audit');
        assertCheck($aud['status'] === 403, 'Manager cannot access audit logs (HTTP 403)');
        $usr = $clients['Manager']->request('GET', 'users.php');
        assertCheck($usr['status'] === 403, 'Manager cannot access user management (HTTP 403)');
    }
    if (isset($clients['Store Requester'])) {
        $aud = $clients['Store Requester']->request('GET', 'audit_log.php?mode=audit');
        assertCheck($aud['status'] === 403, 'Store Requester cannot access audit logs (HTTP 403)');
        $usr = $clients['Store Requester']->request('GET', 'users.php');
        assertCheck($usr['status'] === 403, 'Store Requester cannot access user management (HTTP 403)');
    }

    // 5. Session Termination & Logout
    echo "\n--- SECTION 5: Session Termination & Secure Logout ---\n";
    if (isset($clients['Administrator'])) {
        $logoutRes = $clients['Administrator']->request('POST', 'auth.php?action=logout');
        assertCheck($logoutRes['status'] === 200 && !empty($logoutRes['data']['success']), 'Logout endpoint executes successfully (HTTP 200)');

        // Following logout, session should be destroyed and me returns null user
        $meAfterLogout = $clients['Administrator']->request('GET', 'auth.php?action=me');
        assertCheck(empty($meAfterLogout['data']['data']['user']), 'Session is destroyed: currentUser() returns null after logout');

        // Access to protected API after logout must be rejected with 401
        $dashAfterLogout = $clients['Administrator']->request('GET', 'dashboard.php');
        assertCheck($dashAfterLogout['status'] === 401, 'Protected endpoint returns HTTP 401 after logout');
    }

} finally {
    // Restore original passwords and active statuses exactly
    $stmtRestore = $conn->prepare("UPDATE users SET password = :pwd, is_active = :act WHERE user_id = :id");
    foreach ($origUsers as $u) {
        $stmtRestore->execute([
            ':pwd' => $u['password'],
            ':act' => (int)$u['is_active'],
            ':id'  => (int)$u['user_id']
        ]);
    }
    echo "\nOriginal user account passwords and active statuses fully restored.\n";

    // Stop temporary PHP server
    exec('powershell -NoProfile -Command "Get-Process -Name php -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like \'*8088*\' } | Stop-Process -Force"');
}

echo "\n=================================================================\n";
echo sprintf(" PHASE 1 VERIFICATION RESULTS: %d PASSED / %d FAILED\n", $passedCount, $failedCount);
echo "=================================================================\n";

exit($failedCount === 0 ? 0 : 1);
