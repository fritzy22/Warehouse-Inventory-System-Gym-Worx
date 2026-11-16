<?php
require_once '../config/db.php';
sendJsonHeaders();

class StocksReturnApi {
    private PDO $conn;

    public function __construct(PDO $conn) {
        $this->conn = $conn;
    }

    public function handleRequest($method) {
        switch ($method) {
            case 'GET':
                $this->get();
                break;
            case 'POST':
                $this->post();
                break;
            default:
                sendResponse(false, 'Request failed.', null, 405);
                break;
        }
    }

    private function get() {
        requirePermission('stocks_return', 'view');
        sendResponse(true, 'Stocks returns retrieved', $this->getAllStocksReturns());
    }

    private function post() {
        $actor = requirePermission('stocks_return', 'manage');
        requireCsrf();
        $b = getRequestBody();
        $requested = isset($b['requested_by']) && is_string($b['requested_by']) ? trim($b['requested_by']) : '';
        $date = isset($b['return_date']) ? $b['return_date'] : date('Y-m-d');
        $reason = isset($b['reason']) && is_string($b['reason']) ? trim($b['reason']) : '';
        $rawItems = isset($b['items']) && is_array($b['items']) ? $b['items'] : array();
        $items = ensureItemList($rawItems, 'quantity_returned');

        if (!validateName($requested, 100) || !validateDateValue($date) || strlen($reason) > 255 || $items === false) {
            sendResponse(false, 'Request failed.', null, 400);
        }

        $conditionByPid = array();
        $allowedConditions = array('Usable', 'Quarantined', 'Rejected', 'Damaged');
        foreach ($rawItems as $it) {
            if (!is_array($it)) {
                continue;
            }
            $pid = validatePositiveInt(isset($it['product_id']) ? $it['product_id'] : 0);
            $cond = isset($it['condition_status']) && is_string($it['condition_status']) ? ucfirst(strtolower(trim($it['condition_status']))) : 'Usable';
            if (!in_array($cond, $allowedConditions, true)) {
                $cond = 'Usable';
            }
            if ($pid > 0) {
                $conditionByPid[$pid] = $cond;
            }
        }

        try {
            $id = $this->createStocksReturn($requested, $date, $reason, $items, $conditionByPid, $actor);
        } catch (RuntimeException $e) {
            if ($e->getMessage() === 'maximum capacity reached') {
                sendResponse(false, 'Maximum stock capacity reached. Cannot add more stock to this product.', null, 422);
            }
            sendResponse(false, 'Request failed: ' . $e->getMessage(), null, 409);
        } catch (Throwable $e) {
            error_log('Stocks return failed: ' . $e->getMessage());
            sendResponse(false, 'Request failed.', null, 409);
        }

        auditLog($this->conn, $actor, 'STOCKS_RETURN', 'stocks_return', $id, 'Stocks return recorded');
        sendResponse(true, 'Stocks return recorded successfully.', array('stocks_return_id' => $id));
    }

    private function getAllStocksReturns() {
        $s = $this->conn->query("SELECT sr.stocks_return_id, sr.requested_by, CONCAT(u.first_name,' ',u.last_name) AS processed_by, sr.return_date, sr.reason, (SELECT COUNT(*) FROM stocks_return_detail d WHERE d.stocks_return_id=sr.stocks_return_id) AS item_count FROM stocks_return sr LEFT JOIN users u ON sr.user_id=u.user_id ORDER BY sr.return_date DESC, sr.stocks_return_id DESC");
        return $s->fetchAll();
    }

    private function createStocksReturn($requestedBy, $date, $reason, $items, $conditionByPid, $user) {
        $this->conn->beginTransaction();
        try {
            $chkPid = 0;
            $chk = $this->conn->prepare("SELECT product_id, max_stock, product_name FROM product WHERE product_id=:id AND is_active=1 FOR UPDATE");
            $chk->bindParam(':id', $chkPid, PDO::PARAM_INT);
            foreach ($items as $pid => $qty) {
                $chkPid = (int)$pid;
                $chk->execute();
                $prodRow = $chk->fetch();
                if (!$prodRow) {
                    throw new RuntimeException('invalid product');
                }
                $itemCond = isset($conditionByPid[$chkPid]) ? $conditionByPid[$chkPid] : 'Usable';
                if ($itemCond === 'Usable') {
                    $stock = (int)productStock($this->conn, $chkPid);
                    $maxStock = (int)($prodRow['max_stock'] ?? 100);
                    if ($maxStock <= 0) $maxStock = 100;
                    $remaining = max(0, $maxStock - $stock);
                    if ((int)$qty > $remaining) {
                        throw new RuntimeException('maximum capacity reached');
                    }
                }
            }

            $q = $this->conn->prepare("INSERT INTO stocks_return(requested_by, user_id, return_date, reason) VALUES(:requested, :u, :d, :r)");
            $userId = (int)$user['user_id'];
            $q->bindParam(':requested', $requestedBy, PDO::PARAM_STR);
            $q->bindParam(':u', $userId, PDO::PARAM_INT);
            $q->bindParam(':d', $date, PDO::PARAM_STR);
            $q->bindParam(':r', $reason, PDO::PARAM_STR);
            $q->execute();
            $id = (int)$this->conn->lastInsertId();

            $itemPid = 0;
            $itemQty = 0;
            $itemCond = 'Usable';
            $d = $this->conn->prepare("INSERT INTO stocks_return_detail(stocks_return_id, product_id, quantity_returned, condition_status) VALUES(:r, :p, :q, :c)");
            $d->bindParam(':r', $id, PDO::PARAM_INT);
            $d->bindParam(':p', $itemPid, PDO::PARAM_INT);
            $d->bindParam(':q', $itemQty, PDO::PARAM_INT);
            $d->bindParam(':c', $itemCond, PDO::PARAM_STR);
            foreach ($items as $pid => $qty) {
                $itemPid = (int)$pid;
                $itemQty = (int)$qty;
                $itemCond = isset($conditionByPid[$itemPid]) ? $conditionByPid[$itemPid] : 'Usable';
                $d->execute();
            }

            $this->conn->commit();
            return $id;
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $e;
        }
    }
}

$conn = getConnection();
$method = $_SERVER['REQUEST_METHOD'];

$api = new StocksReturnApi($conn);
$api->handleRequest($method);

