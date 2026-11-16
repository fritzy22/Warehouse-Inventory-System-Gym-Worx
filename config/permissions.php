<?php

function getRbacModules() {
    return array(
        'dashboard',
        'category',
        'product',
        'supplier',
        'product_supplier',
        'role',
        'users',
        'purchase_request',
        'request_approval',
        'purchase_order',
        'stock_receiving',
        'stock_releasing',
        'purchase_return',
        'stocks_return',
        'adjustment',
        'stock_movement',
        'audit_log',
        'inventory_report'
    );
}

function getDefaultRolePermissions($roleName) {
    $clean = strtolower(trim((string)$roleName));
    $modules = getRbacModules();
    $result = array();
    foreach ($modules as $m) {
        $result[$m] = array('view' => false, 'manage' => false);
    }

    if ($clean === 'administrator' || $clean === 'admin') {
        $result['dashboard'] = array('view' => true, 'manage' => true);
        $result['category'] = array('view' => true, 'manage' => true);
        $result['product'] = array('view' => true, 'manage' => true);
        $result['supplier'] = array('view' => true, 'manage' => true);
        $result['product_supplier'] = array('view' => true, 'manage' => true);
        $result['users'] = array('view' => true, 'manage' => true);
        $result['role'] = array('view' => true, 'manage' => true);
        $result['audit_log'] = array('view' => true, 'manage' => true);
        $result['inventory_report'] = array('view' => true, 'manage' => true);
        // Monitor purchasing and warehouse activities (read-only):
        $result['purchase_request'] = array('view' => true, 'manage' => false);
        $result['purchase_order'] = array('view' => true, 'manage' => false);
        $result['stock_receiving'] = array('view' => true, 'manage' => false);
        $result['stock_releasing'] = array('view' => true, 'manage' => false);
        $result['purchase_return'] = array('view' => true, 'manage' => false);
        $result['stocks_return'] = array('view' => true, 'manage' => false);
        $result['adjustment'] = array('view' => true, 'manage' => false);
        $result['stock_movement'] = array('view' => true, 'manage' => false);
        // Admin cannot perform Manager or Warehouse Officer approvals
        $result['request_approval'] = array('view' => false, 'manage' => false);
        return $result;
    }

    if ($clean === 'manager') {
        $result['dashboard'] = array('view' => true, 'manage' => false);
        $result['category'] = array('view' => true, 'manage' => false);
        $result['product'] = array('view' => true, 'manage' => false);
        $result['supplier'] = array('view' => true, 'manage' => false);
        $result['purchase_request'] = array('view' => true, 'manage' => false);
        $result['request_approval'] = array('view' => true, 'manage' => true);
        $result['purchase_order'] = array('view' => true, 'manage' => false);
        $result['stock_receiving'] = array('view' => true, 'manage' => false);
        $result['stock_movement'] = array('view' => true, 'manage' => false);
        $result['inventory_report'] = array('view' => true, 'manage' => false);
        return $result;
    }

    if ($clean === 'purchasing officer' || $clean === 'purchase officer') {
        $result['dashboard'] = array('view' => true, 'manage' => false);
        $result['category'] = array('view' => true, 'manage' => false);
        $result['product'] = array('view' => true, 'manage' => false);
        $result['supplier'] = array('view' => true, 'manage' => true);
        $result['product_supplier'] = array('view' => true, 'manage' => true);
        $result['purchase_request'] = array('view' => true, 'manage' => false);
        $result['purchase_order'] = array('view' => true, 'manage' => true);
        $result['stock_receiving'] = array('view' => true, 'manage' => false);
        $result['purchase_return'] = array('view' => true, 'manage' => true);
        $result['stock_movement'] = array('view' => true, 'manage' => false);
        $result['inventory_report'] = array('view' => true, 'manage' => false);
        return $result;
    }

    if ($clean === 'warehouse staff' || $clean === 'warehouse officer') {
        $result['dashboard'] = array('view' => true, 'manage' => false);
        $result['category'] = array('view' => true, 'manage' => false);
        $result['product'] = array('view' => true, 'manage' => false);
        $result['supplier'] = array('view' => true, 'manage' => false);
        $result['product_supplier'] = array('view' => true, 'manage' => false);
        $result['purchase_request'] = array('view' => true, 'manage' => false);
        $result['purchase_order'] = array('view' => true, 'manage' => false);
        $result['stock_receiving'] = array('view' => true, 'manage' => true);
        $result['stock_releasing'] = array('view' => true, 'manage' => true);
        $result['purchase_return'] = array('view' => true, 'manage' => true);
        $result['stocks_return'] = array('view' => true, 'manage' => true);
        $result['adjustment'] = array('view' => true, 'manage' => true);
        $result['stock_movement'] = array('view' => true, 'manage' => false);
        $result['inventory_report'] = array('view' => true, 'manage' => false);
        return $result;
    }

    if ($clean === 'store requester') {
        $result['dashboard'] = array('view' => true, 'manage' => false);
        $result['category'] = array('view' => true, 'manage' => false);
        $result['product'] = array('view' => true, 'manage' => false);
        $result['purchase_request'] = array('view' => true, 'manage' => true);
        $result['inventory_report'] = array('view' => true, 'manage' => false);
        return $result;
    }

    return $result;
}

function permissionsForRole($roleIdentifier, $conn = null) {
    if ($conn === null) {
        $conn = getConnection();
    }

    $cleanRole = '';
    $roleId = 0;
    if (is_numeric($roleIdentifier)) {
        $roleId = (int)$roleIdentifier;
    } else {
        $cleanRole = is_string($roleIdentifier) ? trim($roleIdentifier) : '';
    }

    // Role name lookup if role ID is provided

    try {
        if ($roleId > 0 && $cleanRole === '') {
            $rStmt = $conn->prepare("SELECT role_name FROM role WHERE role_id = :role_id LIMIT 1");
            $rStmt->bindParam(':role_id', $roleId, PDO::PARAM_INT);
            $rStmt->execute();
            $rRow = $rStmt->fetch();
            if ($rRow) {
                $cleanRole = (string)$rRow['role_name'];
            }
        }
    } catch (Throwable $e) {
        error_log('permissionsForRole role lookup error: ' . $e->getMessage());
    }

    $defaults = getDefaultRolePermissions($cleanRole);
    $result = $defaults;

    try {
        if ($roleId > 0) {
            $stmt = $conn->prepare(
                "SELECT rp.module, rp.can_view, rp.can_manage, r.role_name
                 FROM role_permissions rp
                 INNER JOIN role r ON rp.role_id = r.role_id
                 WHERE rp.role_id = :role_id"
            );
            $stmt->bindParam(':role_id', $roleId, PDO::PARAM_INT);
        } else {
            $stmt = $conn->prepare(
                "SELECT rp.module, rp.can_view, rp.can_manage, r.role_name
                 FROM role_permissions rp
                 INNER JOIN role r ON rp.role_id = r.role_id
                 WHERE LOWER(TRIM(r.role_name)) = LOWER(TRIM(:role_name))"
            );
            $stmt->bindParam(':role_name', $cleanRole, PDO::PARAM_STR);
        }
        $stmt->execute();
        $rows = $stmt->fetchAll();

        if (!empty($rows)) {
            // Start from defaults for modules not yet stored in role_permissions,
            // and let stored database rows be authoritative for every module present.
            foreach ($rows as $row) {
                $m = $row['module'];
                if (isset($result[$m])) {
                    $canManage = ((int)$row['can_manage'] === 1);
                    $canView = ((int)$row['can_view'] === 1) || $canManage;
                    $result[$m] = array(
                        'view' => $canView,
                        'manage' => $canManage
                    );
                }
            }
        }
    } catch (Throwable $e) {
        error_log('permissionsForRole error: ' . $e->getMessage());
    }

    return $result;
}

function userCan($roleIdentifier, $module, $action) {
    $cleanRole = is_string($roleIdentifier) ? trim($roleIdentifier) : '';
    $roleId = is_numeric($roleIdentifier) ? (int)$roleIdentifier : 0;

    static $cache = array();
    $cacheKey = $roleId > 0 ? ('id_' . $roleId) : strtolower($cleanRole);
    if (!isset($cache[$cacheKey])) {
        $cache[$cacheKey] = permissionsForRole($roleIdentifier);
    }

    if (!isset($cache[$cacheKey][$module])) {
        return false;
    }

    if ($action === 'view') {
        return !empty($cache[$cacheKey][$module]['view']) || !empty($cache[$cacheKey][$module]['manage']);
    }

    if ($action === 'manage') {
        return !empty($cache[$cacheKey][$module]['manage']);
    }

    return false;
}
