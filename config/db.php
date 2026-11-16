<?php

$db_host = '127.0.0.1';
$db_name = 'warehouse_inventory_db';
$db_user = 'root';
$db_pass = '';

ini_set('display_errors', '0');
ini_set('log_errors', '1');

function isAllowedOrigin($origin) {
    if (empty($origin) || !is_string($origin)) {
        return false;
    }
    $parsed = parse_url($origin);
    if (!$parsed || empty($parsed['host']) || empty($parsed['scheme'])) {
        return false;
    }
    $scheme = strtolower($parsed['scheme']);
    if ($scheme !== 'http' && $scheme !== 'https') {
        return false;
    }

    $host = strtolower($parsed['host']);

    // Loopback / localhost
    if ($host === 'localhost' || $host === '127.0.0.1' || $host === '::1') {
        return true;
    }

    // Match server's own address / host
    if (!empty($_SERVER['SERVER_ADDR']) && $host === strtolower($_SERVER['SERVER_ADDR'])) {
        return true;
    }
    if (!empty($_SERVER['HTTP_HOST'])) {
        $serverHost = parse_url('http://' . $_SERVER['HTTP_HOST'], PHP_URL_HOST);
        if ($serverHost && $host === strtolower($serverHost)) {
            return true;
        }
    }

    // Private LAN IPv4 ranges (RFC 1918)
    if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        $parts = explode('.', $host);
        if ($parts[0] === '192' && $parts[1] === '168') {
            return true;
        }
        if ($parts[0] === '10') {
            return true;
        }
        if ($parts[0] === '172' && (int)$parts[1] >= 16 && (int)$parts[1] <= 31) {
            return true;
        }
    }

    return false;
}

function handleCors() {
    if (empty($_SERVER['HTTP_ORIGIN'])) {
        return;
    }

    $origin = (string)$_SERVER['HTTP_ORIGIN'];
    if (isAllowedOrigin($origin)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, PATCH');
        header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token, Authorization, X-Requested-With, Accept');
        header('Access-Control-Max-Age: 86400');
        header('Vary: Origin');

        if (isset($_SERVER['REQUEST_METHOD']) && strtoupper($_SERVER['REQUEST_METHOD']) === 'OPTIONS') {
            http_response_code(204);
            exit;
        }
    }
}

handleCors();

function sendJsonHeaders() {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: same-origin');
}

function sendResponse($success, $message, $data = null, $status = null) {
    if ($status !== null) {
        http_response_code((int)$status);
    }
    $response = array(
        'success' => (bool)$success,
        'message' => $message,
        'data' => $data
    );
    echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

set_exception_handler(function ($e) {
    error_log('Warehouse application exception: ' . $e->getMessage());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(array('success' => false, 'message' => 'Request failed.', 'data' => null));
    exit;
});

function getConnection() {
    global $db_host, $db_name, $db_user, $db_pass;

    $dsn = "mysql:host=$db_host;dbname=$db_name;charset=utf8mb4";
    $options = array(
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_TIMEOUT => 5
    );

    try {
        return new PDO($dsn, $db_user, $db_pass, $options);
    } catch (PDOException $e) {
        error_log('Database connection error: ' . $e->getMessage());
        sendResponse(false, 'Database connection failed. Please ensure the database service is running.', null, 500);
    }
}

if (session_status() === PHP_SESSION_NONE) {
    $isHttps = (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off')
        || (isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443);

    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_secure', $isHttps ? '1' : '0');
    ini_set('session.cookie_samesite', 'Lax');
    ini_set('session.gc_maxlifetime', '28800');

    session_set_cookie_params(array(
        'lifetime' => 28800,
        'path' => '/',
        'secure' => $isHttps,
        'httponly' => true,
        'samesite' => 'Lax'
    ));
    session_start();
}

require_once __DIR__ . '/permissions.php';

function getRequestBody() {
    if (!empty($_POST)) {
        return $_POST;
    }

    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return array();
    }

    $body = json_decode($raw, true);
    if (!is_array($body)) {
        sendResponse(false, 'Request failed.', null, 400);
    }
    return $body;
}

function clientIp() {

    return isset($_SERVER['REMOTE_ADDR']) ? substr((string)$_SERVER['REMOTE_ADDR'], 0, 45) : null;
}

function csrfToken() {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function requireCsrf() {
    $token = isset($_SERVER['HTTP_X_CSRF_TOKEN']) ? (string)$_SERVER['HTTP_X_CSRF_TOKEN'] : '';
    if ($token === '' || empty($_SESSION['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $token)) {
        sendResponse(false, 'Request failed.', null, 403);
    }
}

function currentUser() {
    static $cachedUserId = null;
    static $user = null;

    $sessionUserId = !empty($_SESSION['user_id']) && filter_var($_SESSION['user_id'], FILTER_VALIDATE_INT, array('options' => array('min_range' => 1)))
        ? (int)$_SESSION['user_id'] : null;

    if ($sessionUserId === null) {
        $cachedUserId = null;
        $user = null;
        return null;
    }

    if (!empty($_SESSION['last_activity']) && (time() - (int)$_SESSION['last_activity']) > 28800) {
        $_SESSION = array();
        session_destroy();
        $cachedUserId = null;
        $user = null;
        return null;
    }

    if ($cachedUserId === $sessionUserId && $user !== null) {
        return $user;
    }

    $conn = getConnection();
    $stmt = $conn->prepare(
        "SELECT u.user_id, u.role_id, r.role_name, u.first_name, u.last_name, u.username, u.is_active,
                r.is_active AS role_is_active
         FROM users u
         INNER JOIN role r ON u.role_id = r.role_id
         WHERE u.user_id = :user_id
         LIMIT 1"
    );
    $id = (int)$_SESSION['user_id'];
    $stmt->bindParam(':user_id', $id, PDO::PARAM_INT);
    $stmt->execute();
    $row = $stmt->fetch();

    if (!$row || (int)$row['is_active'] !== 1 || (int)$row['role_is_active'] !== 1) {
        $_SESSION = array();
        session_destroy();
        return null;
    }

    $user = array(
        'user_id' => (int)$row['user_id'],
        'role_id' => (int)$row['role_id'],
        'role_name' => $row['role_name'],
        'first_name' => $row['first_name'],
        'last_name' => $row['last_name'],
        'username' => $row['username']
    );
    $_SESSION['user'] = $user;
    $_SESSION['role'] = $row['role_name'];
    $_SESSION['role_name'] = $row['role_name'];
    $_SESSION['role_id'] = (int)$row['role_id'];
    $_SESSION['last_activity'] = time();
    $cachedUserId = $user['user_id'];
    return $user;
}

function requireAuthenticated() {
    $user = currentUser();
    if (!$user) {
        sendResponse(false, 'Request failed.', null, 401);
    }

    $timeout = 28800;
    if (!empty($_SESSION['last_activity']) && (time() - (int)$_SESSION['last_activity']) > $timeout) {
        $_SESSION = array();
        session_destroy();
        sendResponse(false, 'Request failed.', null, 401);
    }

    $_SESSION['last_activity'] = time();
    return $user;
}

function requirePermission($module, $action = 'view') {
    $user = requireAuthenticated();

    $roleName = isset($user['role_name']) ? trim((string)$user['role_name']) : '';
    $roleId = isset($user['role_id']) ? (int)$user['role_id'] : 0;
    $roleIdentifier = $roleId > 0 ? $roleId : $roleName;

    if (is_array($module)) {
        $allowed = false;
        foreach ($module as $m) {
            if (userCan($roleIdentifier, $m, $action)) {
                $allowed = true;
                break;
            }
        }
        if (!$allowed) {
            sendResponse(false, 'You are not authorized to perform this action.', null, 403);
        }
    } else {
        if (!userCan($roleIdentifier, $module, $action)) {
            sendResponse(false, 'You are not authorized to perform this action.', null, 403);
        }
    }

    return $user;
}

function requireMutationSecurity() {
    requireCsrf();
    return requireAuthenticated();
}

function validatePositiveInt($value) {
    return is_int($value) || (is_string($value) && ctype_digit($value) && (int)$value > 0)
        ? (int)$value : 0;
}

function validateDateValue($value) {
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
        return false;
    }
    $dt = DateTime::createFromFormat('!Y-m-d', $value);
    return $dt && $dt->format('Y-m-d') === $value;
}

function validateDateYmd($value) {
    return validateDateValue($value);
}

function validateNonNegativeInt($value) {
    if (is_int($value)) {
        return $value >= 0 && $value <= 2147483647 ? $value : null;
    }
    if (is_string($value) && preg_match('/^\d+$/', $value)) {
        $n = (int)$value;
        return $n <= 2147483647 ? $n : null;
    }
    return null;
}

function validateUsername($value) {
    return is_string($value) && strlen($value) >= 3 && strlen($value) <= 50
        && preg_match('/^[A-Za-z0-9._-]+$/', $value);
}

function validatePassword($value) {
    return is_string($value) && strlen($value) >= 4 && strlen($value) <= 255;
}

function validateName($value, $max = 100) {
    return is_string($value) && $value !== '' && strlen($value) <= $max
        && !preg_match('/[\x00-\x1F\x7F]/', $value);
}

function validateContact($value) {
    return $value === '' || (is_string($value) && strlen($value) <= 20
        && preg_match('/^[0-9+() .-]+$/', $value));
}

function validateNonNegativeDecimal($value, $max = '99999999.99') {
    if (is_int($value) || is_float($value)) {
        $value = (string)$value;
    }
    if (!is_string($value) || !preg_match('/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/', $value)) {
        return false;
    }
    return (float)$value >= 0 && (float)$value <= (float)$max;
}

function validatePositiveQuantity($value) {
    if (is_int($value)) {
        return $value > 0 && $value <= 2147483647 ? $value : 0;
    }
    if (is_string($value) && ctype_digit($value)) {
        $n = (int)$value;
        return $n > 0 && $n <= 2147483647 ? $n : 0;
    }
    return 0;
}

function auditLog($conn, $user, $action, $module, $recordId = null, $description = '') {
    try {
        if (!$conn instanceof PDO) {
            return;
        }
        $uid = (is_array($user) && isset($user['user_id']) && (int)$user['user_id'] > 0) ? (int)$user['user_id'] : null;
        $act = substr(trim((string)$action), 0, 50);
        $mod = substr(trim((string)$module), 0, 50);
        $rid = ($recordId !== null && $recordId !== '' && is_numeric($recordId)) ? (int)$recordId : null;
        $desc = substr(trim((string)$description), 0, 1000);
        $ip = clientIp();

        $stmt = $conn->prepare(
            "INSERT INTO audit_log (user_id, action, module, record_id, description, ip_address)
             VALUES (:user_id, :action, :module, :record_id, :description, :ip_address)"
        );
        $stmt->execute(array(
            ':user_id' => $uid,
            ':action' => $act,
            ':module' => $mod,
            ':record_id' => $rid,
            ':description' => $desc,
            ':ip_address' => $ip
        ));
    } catch (Throwable $e) {
        error_log('auditLog failed: ' . $e->getMessage());
    }
}

function roleDashboardProfile($user) {
    if (!$user || !is_array($user)) {
        return 'requester';
    }
    $roleId = isset($user['role_id']) ? (int)$user['role_id'] : 0;
    $clean = strtolower(trim(isset($user['role_name']) ? (string)$user['role_name'] : ''));

    if ($roleId === 1 || $clean === 'administrator' || $clean === 'admin') {
        return 'admin';
    }
    if ($clean === 'manager') {
        return 'manager';
    }
    if ($clean === 'purchasing officer' || $clean === 'purchase officer') {
        return 'purchasing';
    }
    if ($clean === 'warehouse staff' || $clean === 'warehouse officer') {
        return 'warehouse';
    }
    if ($clean === 'store requester') {
        return 'requester';
    }

    // Custom roles fall back based on highest-authority permission
    $rid = $roleId > 0 ? $roleId : $clean;
    if (userCan($rid, 'users', 'manage') || userCan($rid, 'role', 'manage')) {
        return 'admin';
    }
    if (userCan($rid, 'request_approval', 'manage')) {
        return 'manager';
    }
    if (userCan($rid, 'purchase_order', 'manage')) {
        return 'purchasing';
    }
    if (userCan($rid, 'stock_receiving', 'manage')) {
        return 'warehouse';
    }
    return 'requester';
}

function productStock($conn, $productId, $excludePrId = 0) {
    $pid = (int)$productId;
    $exclPr = (int)$excludePrId;
    $stmt = $conn->prepare(
        "SELECT
            (
              COALESCE((
                  SELECT SUM(COALESCE(d.quantity_accepted, d.quantity_received))
                  FROM stock_receiving_detail d
                  INNER JOIN stock_receiving sr ON sr.receiving_id = d.receiving_id
                  INNER JOIN purchase_order po ON po.po_id = sr.po_id
                  WHERE d.product_id = p.product_id
                    AND po.status NOT IN ('Cancelled', 'Rejected')
                    AND COALESCE(sr.status, 'Posted') IN ('Posted', 'Inspected')
              ), 0)
            + COALESCE((
                  SELECT SUM(d.quantity_returned)
                  FROM stocks_return_detail d
                  WHERE d.product_id = p.product_id
                    AND COALESCE(d.condition_status, 'Usable') = 'Usable'
              ), 0)
            + COALESCE((
                  SELECT SUM(d.quantity)
                  FROM adjustment_detail d
                  WHERE d.product_id = p.product_id
                    AND d.adjustment_type = 'Addition'
              ), 0)
            - COALESCE((
                  SELECT SUM(d.quantity_released)
                  FROM stock_releasing_detail d
                  WHERE d.product_id = p.product_id
              ), 0)
            - COALESCE((
                  SELECT SUM(d.quantity_returned)
                  FROM purchase_return_detail d
                  WHERE d.product_id = p.product_id
              ), 0)
            - COALESCE((
                  SELECT SUM(d.quantity)
                  FROM adjustment_detail d
                  WHERE d.product_id = p.product_id
                    AND d.adjustment_type = 'Deduction'
              ), 0)
            - COALESCE((
                  SELECT SUM(r.reserved_qty)
                  FROM stock_reservation r
                  WHERE r.product_id = p.product_id
                    AND r.status = 'Active'
                    AND (:excl_pr_1 = 0 OR r.pr_id IS NULL OR r.pr_id != :excl_pr_2)
              ), 0)
            ) AS stock_qty
         FROM product p
         WHERE p.product_id = :product_id
         FOR UPDATE"
    );
    $stmt->execute(array(
        ':product_id' => $pid,
        ':excl_pr_1' => $exclPr,
        ':excl_pr_2' => $exclPr
    ));
    $row = $stmt->fetch();
    return $row ? (int)$row['stock_qty'] : null;
}

function ensureItemList($items, $quantityKey) {
    if (!is_array($items) || count($items) < 1 || count($items) > 100) {
        return false;
    }
    $normalized = array();
    foreach ($items as $item) {
        if (!is_array($item)) {
            return false;
        }
        $productId = validatePositiveInt(isset($item['product_id']) ? $item['product_id'] : 0);
        $rawQty = isset($item[$quantityKey]) ? $item[$quantityKey] : (isset($item['quantity']) ? $item['quantity'] : 0);
        $qty = validatePositiveQuantity($rawQty);
        if ($productId <= 0 || $qty <= 0) {
            return false;
        }
        if (!isset($normalized[$productId])) {
            $normalized[$productId] = 0;
        }
        $normalized[$productId] += $qty;
        if ($normalized[$productId] > 2147483647) {
            return false;
        }
    }
    return $normalized;
}

require_once __DIR__ . '/inventory.php';
require_once __DIR__ . '/notifications.php';
