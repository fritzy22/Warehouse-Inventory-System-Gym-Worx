<?php
require_once '../config/db.php';
sendJsonHeaders();

class NotificationApi {
    private PDO $conn;

    public function __construct(PDO $conn) {
        $this->conn = $conn;
    }

    public function handleRequest($method) {
        switch ($method) {
            case 'GET':
                $this->get();
                break;
            case 'PUT':
            case 'POST':
                $this->mutate();
                break;
            default:
                sendResponse(false, 'Request failed.', null, 405);
                break;
        }
    }

    private function get() {
        $user = requireAuthenticated();
        $uid = (int)$user['user_id'];
        $action = isset($_GET['action']) ? (string)$_GET['action'] : 'list';

        if ($action === 'summary') {
            $afterId = validateNonNegativeInt(isset($_GET['after_id']) ? $_GET['after_id'] : 0);
            if ($afterId === null) {
                $afterId = 0;
            }

            $cntStmt = $this->conn->prepare("SELECT COUNT(*) AS unread FROM notification WHERE user_id = :uid AND is_read = 0");
            $cntStmt->execute(array(':uid' => $uid));
            $unread = (int)$cntStmt->fetch()['unread'];

            $recentStmt = $this->conn->prepare(
                "SELECT notification_id, type, severity, title, message, link_tab, ref_type, ref_id, is_read, created_at
                 FROM notification
                 WHERE user_id = :uid
                 ORDER BY notification_id DESC
                 LIMIT 12"
            );
            $recentStmt->execute(array(':uid' => $uid));
            $recent = $recentStmt->fetchAll();

            $newItems = array();
            if ($afterId > 0) {
                foreach ($recent as $item) {
                    if ((int)$item['notification_id'] > $afterId) {
                        $newItems[] = $item;
                    }
                }
            }
            $latestId = !empty($recent) ? (int)$recent[0]['notification_id'] : $afterId;

            sendResponse(true, 'Notification summary retrieved', array(
                'unread_count' => $unread,
                'latest_id' => $latestId,
                'recent' => $recent,
                'new_items' => $newItems
            ));
        }

        $filter = isset($_GET['filter']) ? (string)$_GET['filter'] : 'all';
        $unreadOnly = ($filter === 'unread') || (!empty($_GET['unread_only']) && $_GET['unread_only'] !== '0');
        $whereRead = $unreadOnly ? 'AND is_read = 0' : '';
        $limit = isset($_GET['limit']) ? max(1, min(500, (int)$_GET['limit'])) : 200;

        $stmt = $this->conn->prepare(
            "SELECT notification_id, type, severity, title, message, link_tab,
                    ref_type, ref_id,
                    ref_type AS entity_type, ref_id AS entity_id,
                    is_read, created_at, read_at
             FROM notification
             WHERE user_id = :uid $whereRead
             ORDER BY notification_id DESC
             LIMIT :lim"
        );
        $stmt->bindValue(':uid', $uid, PDO::PARAM_INT);
        $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
        $stmt->execute();
        $items = $stmt->fetchAll();

        // Calculate current unread count for user
        $cntStmt = $this->conn->prepare("SELECT COUNT(*) FROM notification WHERE user_id = :uid AND is_read = 0");
        $cntStmt->execute(array(':uid' => $uid));
        $unreadCount = (int)$cntStmt->fetchColumn();

        sendResponse(true, 'Notifications retrieved', array(
            'items' => $items,
            'unread_count' => $unreadCount,
            'list' => $items
        ));
    }

    private function mutate() {
        $user = requireMutationSecurity();
        $uid = (int)$user['user_id'];
        $body = getRequestBody();
        $action = isset($body['action']) ? (string)$body['action'] : 'mark_read';

        if ($action === 'mark_all_read') {
            $stmt = $this->conn->prepare("UPDATE notification SET is_read = 1, read_at = NOW() WHERE user_id = :uid AND is_read = 0");
            $stmt->execute(array(':uid' => $uid));
            sendResponse(true, 'All notifications marked as read.');
        }

        $id = validatePositiveInt(isset($body['notification_id']) ? $body['notification_id'] : 0);
        if ($id <= 0) {
            sendResponse(false, 'Invalid notification ID.', null, 400);
        }
        $stmt = $this->conn->prepare("UPDATE notification SET is_read = 1, read_at = NOW() WHERE notification_id = :id AND user_id = :uid");
        $stmt->execute(array(':id' => $id, ':uid' => $uid));
        sendResponse(true, 'Notification marked as read.');
    }
}

$conn = getConnection();
$method = $_SERVER['REQUEST_METHOD'];

$api = new NotificationApi($conn);
$api->handleRequest($method);
