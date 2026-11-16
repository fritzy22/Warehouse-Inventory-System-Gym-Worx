<?php

/**
 * Database-backed notification helpers.
 * All helper calls are wrapped in try/catch so a notification hiccup never breaks a business transaction.
 */

function notifyUser(
    PDO $conn,
    $userId,
    $type,
    $title,
    $message,
    $linkTab = 'dashboard',
    $refType = null,
    $refId = null,
    $severity = 'info'
) {
    $uid = (int)$userId;
    if ($uid <= 0) {
        return;
    }
    $cleanTitle = substr(trim((string)$title), 0, 150);
    $cleanMsg = substr(trim((string)$message), 0, 500);
    $cleanType = substr(trim((string)$type), 0, 40);
    $cleanSev = in_array($severity, array('info', 'success', 'warning', 'danger'), true) ? $severity : 'info';
    $cleanTab = $linkTab ? substr(trim((string)$linkTab), 0, 50) : null;
    $cleanRefType = $refType ? substr(trim((string)$refType), 0, 30) : null;
    $cleanRefId = $refId !== null ? (int)$refId : null;

    try {
        $stmt = $conn->prepare(
            "INSERT INTO notification (user_id, type, severity, title, message, link_tab, ref_type, ref_id)
             VALUES (:user_id, :type, :severity, :title, :message, :link_tab, :ref_type, :ref_id)"
        );
        $stmt->execute(array(
            ':user_id' => $uid,
            ':type' => $cleanType,
            ':severity' => $cleanSev,
            ':title' => $cleanTitle,
            ':message' => $cleanMsg,
            ':link_tab' => $cleanTab,
            ':ref_type' => $cleanRefType,
            ':ref_id' => $cleanRefId
        ));
    } catch (Throwable $e) {
        error_log('notifyUser failed: ' . $e->getMessage());
    }
}

function notifyUsers(
    PDO $conn,
    array $userIds,
    $type,
    $title,
    $message,
    $linkTab = 'dashboard',
    $refType = null,
    $refId = null,
    $severity = 'info',
    $excludeUserId = 0
) {
    $excl = (int)$excludeUserId;
    $unique = array_unique(array_map('intval', $userIds));
    foreach ($unique as $uid) {
        if ($uid <= 0 || ($excl > 0 && $uid === $excl)) {
            continue;
        }
        notifyUser($conn, $uid, $type, $title, $message, $linkTab, $refType, $refId, $severity);
    }
}

function getActiveUserIdsByRoleNames(PDO $conn, array $roleNames) {
    if (empty($roleNames)) {
        return array();
    }
    $lower = array_map(function ($n) { return strtolower(trim((string)$n)); }, $roleNames);
    $placeholders = implode(',', array_fill(0, count($lower), '?'));
    try {
        $stmt = $conn->prepare(
            "SELECT u.user_id
             FROM users u
             INNER JOIN role r ON u.role_id = r.role_id
             WHERE u.is_active = 1 AND r.is_active = 1
               AND LOWER(TRIM(r.role_name)) IN ($placeholders)"
        );
        $stmt->execute(array_values($lower));
        return array_map(function ($r) { return (int)$r['user_id']; }, $stmt->fetchAll());
    } catch (Throwable $e) {
        error_log('getActiveUserIdsByRoleNames failed: ' . $e->getMessage());
        return array();
    }
}

function getActiveUserIdsWithPermission(PDO $conn, $module, $action = 'view') {
    try {
        $stmt = $conn->query(
            "SELECT u.user_id, u.role_id, r.role_name
             FROM users u
             INNER JOIN role r ON u.role_id = r.role_id
             WHERE u.is_active = 1 AND r.is_active = 1"
        );
        $rows = $stmt->fetchAll();
        $ids = array();
        foreach ($rows as $row) {
            if (userCan((int)$row['role_id'], $module, $action)) {
                $ids[] = (int)$row['user_id'];
            }
        }
        return $ids;
    } catch (Throwable $e) {
        error_log('getActiveUserIdsWithPermission failed: ' . $e->getMessage());
        return array();
    }
}

function notifyUsersWithRoleNames(
    PDO $conn,
    array $roleNames,
    $type,
    $title,
    $message,
    $linkTab = 'dashboard',
    $refType = null,
    $refId = null,
    $severity = 'info',
    $excludeUserId = 0
) {
    $ids = getActiveUserIdsByRoleNames($conn, $roleNames);
    notifyUsers($conn, $ids, $type, $title, $message, $linkTab, $refType, $refId, $severity, $excludeUserId);
}

function notifyUsersWithPermission(
    PDO $conn,
    $module,
    $action,
    $type,
    $title,
    $message,
    $linkTab = 'dashboard',
    $refType = null,
    $refId = null,
    $severity = 'info',
    $excludeUserId = 0
) {
    $ids = getActiveUserIdsWithPermission($conn, $module, $action);
    notifyUsers($conn, $ids, $type, $title, $message, $linkTab, $refType, $refId, $severity, $excludeUserId);
}

function notifyAdmins(
    PDO $conn,
    $type,
    $title,
    $message,
    $linkTab = 'dashboard',
    $refType = null,
    $refId = null,
    $severity = 'info',
    $excludeUserId = 0
) {
    $ids = getActiveUserIdsByRoleNames($conn, array('Administrator'));
    notifyUsers($conn, $ids, $type, $title, $message, $linkTab, $refType, $refId, $severity, $excludeUserId);
}

function notifyRole(
    PDO $conn,
    $roleName,
    $type,
    $title,
    $message,
    $linkTab = 'dashboard',
    $refType = null,
    $refId = null,
    $severity = 'info',
    $excludeUserId = 0
) {
    notifyUsersWithRoleNames($conn, array($roleName), $type, $title, $message, $linkTab, $refType, $refId, $severity, $excludeUserId);
}
