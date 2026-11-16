<?php
/**
 * Automated Verification Script: Multi-User Role API & Backend Connection Matrix
 * Tests all 5 user roles across their authorized and unauthorized API endpoints.
 */

require_once __DIR__ . '/../../config/db.php';
$conn = getConnection();

echo "=================================================================\n";
echo " ALL USERS & API CONNECTIONS VERIFICATION SUITE\n";
echo "=================================================================\n\n";

$testPass = 'TestPass#2026!';
$testHash = password_hash($testPass, PASSWORD_DEFAULT);

// Save current password hashes and is_active statuses
$origUsers = $conn->query("SELECT user_id, password, is_active FROM users WHERE user_id IN (1, 31, 32, 33, 35)")->fetchAll();

// Enable test credentials
$conn->exec("UPDATE role SET is_active = 1 WHERE role_id IN (1, 2, 3, 4, 19)");
$conn->prepare("UPDATE users SET password = ?, is_active = 1 WHERE user_id IN (1, 31, 32, 33, 35)")->execute([$testHash]);

$users = [
    'Administrator'      => ['username' => 'Enhancer',  'password' => $testPass],
    'Manager'            => ['username' => 'Jean',      'password' => $testPass],
    'Purchasing Officer' => ['username' => 'Fritz',     'password' => $testPass],
    'Warehouse Officer'  => ['username' => 'christian', 'password' => $testPass],
    'Store Requester'    => ['username' => 'zhen1',     'password' => $testPass],
];

$baseUrl = getenv('API_TEST_BASE') ?: 'http://127.0.0.1/updated_inventory_website/warehouse_finals/api/';

class RoleTester {
    private string $baseUrl;
    private string $cookieFile;
    private ?string $csrf = null;

    public function __construct(string $baseUrl, string $tag) {
        $this->baseUrl = $baseUrl;
        $this->cookieFile = sys_get_temp_dir() . '/test_cookie_' . $tag . '_' . uniqid() . '.txt';
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
            $this->csrf = $json['data']['csrf_token'];
        }
        return ['status' => $code, 'data' => $json, 'raw' => $raw];
    }

    public function login(string $user, string $pass): bool {
        $me = $this->request('GET', 'auth.php?action=me');
        $res = $this->request('POST', 'auth.php?action=login', [
            'username' => $user,
            'password' => $pass
        ]);
        if ($res['status'] !== 200 || empty($res['data']['success'])) {
            echo " [DEBUG LOGIN] HTTP {$res['status']} RAW: {$res['raw']}\n";
            return false;
        }
        return true;
    }
}

$summary = [];

foreach ($users as $roleName => $creds) {
    echo "-----------------------------------------------------------------\n";
    echo " Testing Role: [{$roleName}] (User: {$creds['username']})\n";
    echo "-----------------------------------------------------------------\n";

    $tester = new RoleTester($baseUrl, strtolower(str_replace(' ', '_', $roleName)));
    $loggedIn = $tester->login($creds['username'], $creds['password']);

    if (!$loggedIn) {
        echo " [FAIL] Could not log in as {$creds['username']}\n";
        $summary[$roleName] = false;
        continue;
    }
    echo " [PASS] Authentication & Session Established\n";

    // 1. Dashboard API
    $dash = $tester->request('GET', 'dashboard.php');
    $dashRole = $dash['data']['data']['role_name'] ?? '';
    $dashOk = $dash['status'] === 200 && ($dashRole === $roleName || ($roleName === 'Purchasing Officer' && ($dashRole === 'Purchasing Officer' || $dashRole === 'Purchase Officer')));
    echo " [" . ($dashOk ? "PASS" : "FAIL") . "] Dashboard Endpoint (role={$dashRole})\n";

    // 2. Notification API (list and unread count)
    $notif = $tester->request('GET', 'notification.php?action=list&limit=10');
    $notifOk = $notif['status'] === 200 && isset($notif['data']['data']['items']);
    echo " [" . ($notifOk ? "PASS" : "FAIL") . "] Notification List API (items=" . count($notif['data']['data']['items'] ?? []) . ", unread=" . ($notif['data']['data']['unread_count'] ?? 0) . ")\n";

    // 3. Stock Movements API
    $mov = $tester->request('GET', 'audit_log.php?mode=movements&limit=5');
    $movOk = $mov['status'] === 200 && is_array($mov['data']['data']);
    echo " [" . ($movOk ? "PASS" : "FAIL") . "] Stock Movements API (records=" . count($mov['data']['data'] ?? []) . ")\n";

    // 4. Audit Log API
    $aud = $tester->request('GET', 'audit_log.php?mode=audit&limit=5');
    if ($roleName === 'Administrator') {
        $audOk = $aud['status'] === 200 && is_array($aud['data']['data']);
        echo " [" . ($audOk ? "PASS" : "FAIL") . "] Audit Log Access Granted (HTTP 200, records=" . count($aud['data']['data'] ?? []) . ")\n";
    } else {
        $audOk = $aud['status'] === 403;
        echo " [" . ($audOk ? "PASS" : "FAIL") . "] Audit Log Forbidden as expected (HTTP 403)\n";
    }

    // 5. Purchase Requests API (Read)
    $pr = $tester->request('GET', 'purchase_request.php');
    $prOk = $pr['status'] === 200;
    echo " [" . ($prOk ? "PASS" : "FAIL") . "] Purchase Requests API (HTTP 200, records=" . count($pr['data']['data'] ?? []) . ")\n";

    // 6. Approval Mutation (Write: approve request)
    $approveAttempt = $tester->request('PUT', 'purchase_request.php', [
        'action' => 'approve',
        'pr_id' => 9999,
        'comment' => 'Unauthorized approval attempt'
    ]);
    if ($roleName === 'Manager') {
        // Authorized manager reaches logic (fails on nonexistent PR with 404 or validation 422, NOT 403)
        $apprOk = in_array($approveAttempt['status'], [404, 422, 409], true);
        echo " [" . ($apprOk ? "PASS" : "FAIL") . "] Request Approval Authority Granted (status={$approveAttempt['status']})\n";
    } else {
        $apprOk = $approveAttempt['status'] === 403;
        echo " [" . ($apprOk ? "PASS" : "FAIL") . "] Request Approval Mutation Forbidden as expected (HTTP 403)\n";
    }

    // 7. Purchase Orders API
    $po = $tester->request('GET', 'purchase_order.php');
    if (in_array($roleName, ['Administrator', 'Manager', 'Purchasing Officer', 'Warehouse Staff'], true)) {
        $poOk = $po['status'] === 200;
        echo " [" . ($poOk ? "PASS" : "FAIL") . "] Purchase Orders Access Granted (HTTP 200)\n";
    } else {
        $poOk = $po['status'] === 403;
        echo " [" . ($poOk ? "PASS" : "FAIL") . "] Purchase Orders Forbidden as expected (HTTP 403)\n";
    }

    // 8. Stock Receiving API
    $rcv = $tester->request('GET', 'stock_receiving.php');
    if (in_array($roleName, ['Administrator', 'Manager', 'Purchasing Officer', 'Warehouse Staff'], true)) {
        $rcvOk = $rcv['status'] === 200;
        echo " [" . ($rcvOk ? "PASS" : "FAIL") . "] Stock Receiving Access Granted (HTTP 200)\n";
    } else {
        $rcvOk = $rcv['status'] === 403;
        echo " [" . ($rcvOk ? "PASS" : "FAIL") . "] Stock Receiving Forbidden as expected (HTTP 403)\n";
    }

    // 9. User Administration API
    $usr = $tester->request('GET', 'users.php');
    if ($roleName === 'Administrator') {
        $usrOk = $usr['status'] === 200;
        echo " [" . ($usrOk ? "PASS" : "FAIL") . "] User Admin Access Granted (HTTP 200)\n";
    } else {
        $usrOk = $usr['status'] === 403;
        echo " [" . ($usrOk ? "PASS" : "FAIL") . "] User Admin Forbidden as expected (HTTP 403)\n";
    }

    $summary[$roleName] = $dashOk && $notifOk && $movOk && $audOk && $prOk && $apprOk && $poOk && $rcvOk && $usrOk;
}

echo "\n=================================================================\n";
echo " MULTI-USER ROLE VERIFICATION SUMMARY\n";
echo "=================================================================\n";
$allPassed = true;
foreach ($summary as $r => $status) {
    echo sprintf(" - %-22s : %s\n", $r, $status ? "[ALL CHECKS PASSED]" : "[FAILED]");
    if (!$status) $allPassed = false;
}
echo "=================================================================\n";
echo " STATUS: " . ($allPassed ? "100% HEALTHY - ALL ROLES VERIFIED" : "DEFECTS DETECTED") . "\n";
echo "=================================================================\n";

// Restore original credentials and statuses
$stmtRestore = $conn->prepare("UPDATE users SET password = :pwd, is_active = :act WHERE user_id = :id");
foreach ($origUsers as $u) {
    $stmtRestore->execute([
        ':pwd' => $u['password'],
        ':act' => (int)$u['is_active'],
        ':id'  => (int)$u['user_id']
    ]);
}
echo "Clean user state restored.\n";
