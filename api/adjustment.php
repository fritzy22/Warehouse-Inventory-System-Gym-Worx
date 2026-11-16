<?php
require_once '../config/db.php';
sendJsonHeaders();

class AdjustmentApi {
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
        requirePermission('adjustment', 'view');
        if (isset($_GET['action']) && $_GET['action'] === 'reservations') {
            $stmt = $this->conn->query(
                "SELECT r.reservation_id, r.product_id, p.product_name, r.pr_id, r.reserved_qty,
                        r.status, r.notes, r.created_at,
                        CASE WHEN u.user_id IS NOT NULL THEN CONCAT(u.first_name,' ',u.last_name) ELSE 'System' END AS created_by_name
                 FROM stock_reservation r
                 INNER JOIN product p ON p.product_id = r.product_id
                 LEFT JOIN users u ON u.user_id = r.created_by
                 ORDER BY r.reservation_id DESC"
            );
            sendResponse(true, 'Reservations retrieved', $stmt->fetchAll());
        }
        sendResponse(true, 'Adjustments retrieved', $this->getAllAdjustments());
    }

    private function post() {
        $actor = requirePermission('adjustment', 'manage');
        requireCsrf();
        $b = getRequestBody();
        $action = isset($b['action']) && is_string($b['action']) ? trim($b['action']) : '';

        if ($action === 'create_reservation') {
            $this->handleCreateReservation($b, $actor);
            return;
        }
        if ($action === 'cancel_reservation' || $action === 'release_reservation') {
            $this->handleUpdateReservation($b, $actor, $action === 'release_reservation' ? 'Released' : 'Cancelled');
            return;
        }

        $date = isset($b['adjustment_date']) ? $b['adjustment_date'] : date('Y-m-d');
        $reason = isset($b['reason']) && is_string($b['reason']) ? trim($b['reason']) : '';
        $clientToken = isset($b['client_token']) && is_string($b['client_token']) ? substr(trim($b['client_token']), 0, 60) : '';
        $raw = isset($b['items']) ? $b['items'] : array();

        if (empty($raw) && isset($b['product_id'])) {
            $rawType = isset($b['adjustment_type']) ? trim((string)$b['adjustment_type']) : 'Addition';
            if (in_array(strtolower($rawType), array('addition', 'add', 'in', 'opening balance', 'opening_balance', 'initial'), true)) {
                $rawType = 'Addition';
            } elseif (in_array(strtolower($rawType), array('deduction', 'deduct', 'out'), true)) {
                $rawType = 'Deduction';
            }
            $raw = array(
                array(
                    'product_id' => $b['product_id'],
                    'quantity' => isset($b['quantity']) ? $b['quantity'] : 0,
                    'adjustment_type' => $rawType
                )
            );
        }

        if (!validateDateValue($date)) {
            sendResponse(false, 'Please provide a valid adjustment date.', null, 400);
        }

        if ($reason === '' || strlen($reason) < 3 || strlen($reason) > 255) {
            sendResponse(false, 'Please provide a valid reason for the stock adjustment (3 to 255 characters).', null, 422);
        }

        if (!is_array($raw) || count($raw) < 1 || count($raw) > 100) {
            sendResponse(false, 'Please add at least one product line item to adjust.', null, 400);
        }

        $items = array();
        foreach ($raw as $it) {
            if (!is_array($it)) {
                sendResponse(false, 'Invalid adjustment item format.', null, 400);
            }
            $pid = validatePositiveInt(isset($it['product_id']) ? $it['product_id'] : 0);
            $qty = validatePositiveQuantity(isset($it['quantity']) ? $it['quantity'] : 0);
            $rawType = isset($it['adjustment_type']) && is_string($it['adjustment_type']) ? trim($it['adjustment_type']) : '';
            if (in_array(strtolower($rawType), array('addition', 'add', 'in', 'opening balance', 'opening_balance', 'initial'), true)) {
                $type = 'Addition';
            } elseif (in_array(strtolower($rawType), array('deduction', 'deduct', 'out'), true)) {
                $type = 'Deduction';
            } else {
                $type = $rawType;
            }
            if ($pid <= 0 || $qty <= 0 || !in_array($type, array('Addition', 'Deduction'), true)) {
                sendResponse(false, 'Please provide a valid product, positive quantity, and adjustment type.', null, 400);
            }
            if (isset($items[$pid])) {
                sendResponse(false, 'Duplicate products are not allowed in the same adjustment submission.', null, 422);
            }
            $items[$pid] = array('quantity' => $qty, 'adjustment_type' => $type);
        }

        try {
            $id = $this->createAdjustment($date, $reason, $items, $actor, $clientToken);
        } catch (RuntimeException $e) {
            $code = $e->getMessage();
            if ($code === 'maximum capacity reached') {
                sendResponse(false, 'Maximum stock capacity reached. Cannot add more stock to this product.', null, 422);
            }
            if ($code === 'insufficient stock') {
                sendResponse(false, 'Cannot deduct more than current available stock.', null, 409);
            }
            if ($code === 'duplicate adjustment') {
                sendResponse(false, 'Duplicate stock adjustment blocked. This adjustment was already recorded.', null, 409);
            }
            sendResponse(false, 'Invalid or inactive product selected.', null, 409);
        } catch (Throwable $e) {
            error_log('Adjustment failed: ' . $e->getMessage());
            sendResponse(false, 'Request failed.', null, 500);
        }

        auditLog($this->conn, $actor, 'INVENTORY_ADJUSTMENT', 'adjustment_detail', $id, 'Inventory adjustment recorded: ' . $reason);
        checkAndNotifyLowStock($this->conn, array_keys($items), $actor);
        sendResponse(true, 'Adjustment recorded successfully.', array('adjustment_id' => $id, 'adjustment_detail_id' => $id));
    }

    private function handleCreateReservation($b, $actor) {
        $pid = validatePositiveInt(isset($b['product_id']) ? $b['product_id'] : 0);
        $prId = isset($b['pr_id']) && $b['pr_id'] !== '' ? validatePositiveInt($b['pr_id']) : null;
        $qty = validatePositiveQuantity(isset($b['reserved_qty']) ? $b['reserved_qty'] : (isset($b['quantity']) ? $b['quantity'] : 0));
        $notes = isset($b['notes']) && is_string($b['notes']) ? substr(trim($b['notes']), 0, 255) : 'Active stock reservation';

        if ($pid <= 0 || $qty <= 0) {
            sendResponse(false, 'Please provide a valid product and positive reservation quantity.', null, 400);
        }

        $this->conn->beginTransaction();
        try {
            $chk = $this->conn->prepare("SELECT product_id, product_name FROM product WHERE product_id = :id AND is_active = 1 FOR UPDATE");
            $chk->execute(array(':id' => $pid));
            $prod = $chk->fetch();
            if (!$prod) {
                $this->conn->rollBack();
                sendResponse(false, 'Invalid or inactive product selected.', null, 404);
            }

            $avail = productStock($this->conn, $pid);
            if ($avail === null || $qty > $avail) {
                $this->conn->rollBack();
                sendResponse(false, 'Cannot reserve more than current available stock (' . (int)$avail . ').', null, 409);
            }

            $stmt = $this->conn->prepare(
                "INSERT INTO stock_reservation (product_id, pr_id, reserved_qty, status, notes, created_by)
                 VALUES (:pid, :pr_id, :qty, 'Active', :notes, :uid)"
            );
            $stmt->execute(array(
                ':pid' => $pid,
                ':pr_id' => $prId > 0 ? $prId : null,
                ':qty' => $qty,
                ':notes' => $notes !== '' ? $notes : 'Active stock reservation',
                ':uid' => (int)$actor['user_id']
            ));
            $resId = (int)$this->conn->lastInsertId();
            $this->conn->commit();
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            error_log('Reservation creation failed: ' . $e->getMessage());
            sendResponse(false, 'Request failed.', null, 500);
        }

        auditLog($this->conn, $actor, 'STOCK_RESERVE', 'stock_reservation', $resId, 'Reserved ' . $qty . ' units of product #' . $pid . ' (' . $notes . ')');
        checkAndNotifyLowStock($this->conn, array($pid), $actor);
        $metrics = productInventoryMetrics($this->conn, $pid, false);
        sendResponse(true, 'Stock reservation created.', array('reservation_id' => $resId, 'product' => $metrics));
    }

    private function handleUpdateReservation($b, $actor, $newStatus) {
        $resId = validatePositiveInt(isset($b['reservation_id']) ? $b['reservation_id'] : 0);
        if ($resId <= 0) {
            sendResponse(false, 'Invalid reservation ID.', null, 400);
        }

        $this->conn->beginTransaction();
        try {
            $chk = $this->conn->prepare("SELECT reservation_id, product_id, reserved_qty, status FROM stock_reservation WHERE reservation_id = :id FOR UPDATE");
            $chk->execute(array(':id' => $resId));
            $row = $chk->fetch();
            if (!$row) {
                $this->conn->rollBack();
                sendResponse(false, 'Reservation not found.', null, 404);
            }
            if ($row['status'] !== 'Active') {
                $this->conn->rollBack();
                sendResponse(false, 'Reservation is already ' . $row['status'] . '.', null, 409);
            }

            $upd = $this->conn->prepare("UPDATE stock_reservation SET status = :st WHERE reservation_id = :id");
            $upd->execute(array(':st' => $newStatus, ':id' => $resId));
            $this->conn->commit();
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            sendResponse(false, 'Request failed.', null, 500);
        }

        $pid = (int)$row['product_id'];
        auditLog($this->conn, $actor, 'STOCK_RESERVE_' . strtoupper($newStatus), 'stock_reservation', $resId, 'Reservation #' . $resId . ' marked ' . $newStatus);
        $metrics = productInventoryMetrics($this->conn, $pid, false);
        sendResponse(true, 'Stock reservation updated to ' . $newStatus . '.', array('reservation_id' => $resId, 'product' => $metrics));
    }

    private function getAllAdjustments() {
        $s = $this->conn->query(
            "SELECT d.adjustment_detail_id, d.product_id, p.product_name, d.quantity, d.adjustment_type,
                    COALESCE(d.adjustment_date, DATE(d.created_at)) AS adjustment_date,
                    COALESCE(NULLIF(TRIM(d.reason), ''), 'Initial Stock Adjustment') AS reason,
                    d.created_at,
                    CASE WHEN u.user_id IS NOT NULL THEN CONCAT(u.first_name,' ',u.last_name) ELSE 'System' END AS adjusted_by,
                    CASE WHEN u.user_id IS NOT NULL THEN CONCAT(u.first_name,' ',u.last_name) ELSE 'System' END AS processed_by
             FROM adjustment_detail d
             INNER JOIN product p ON d.product_id=p.product_id
             LEFT JOIN users u ON u.user_id = d.user_id
             ORDER BY d.adjustment_detail_id DESC"
        );
        return $s->fetchAll();
    }

    private function createAdjustment($date, $reason, $items, $user, $clientToken = '') {
        $this->conn->beginTransaction();
        try {
            $uid = isset($user['user_id']) ? (int)$user['user_id'] : null;

            if ($clientToken !== '') {
                $tokChk = $this->conn->prepare("SELECT adjustment_detail_id FROM adjustment_detail WHERE client_token LIKE :tok LIMIT 1 FOR UPDATE");
                $tokChk->execute(array(':tok' => $clientToken . '%'));
                if ($tokChk->fetch()) {
                    throw new RuntimeException('duplicate adjustment');
                }
            }

            $chkPid = 0;
            $chk = $this->conn->prepare("SELECT product_id FROM product WHERE product_id=:id AND is_active=1 FOR UPDATE");
            $chk->bindParam(':id', $chkPid, PDO::PARAM_INT);

            $dupChk = $this->conn->prepare(
                "SELECT adjustment_detail_id
                 FROM adjustment_detail
                 WHERE product_id = :pid
                   AND quantity = :qty
                   AND adjustment_type = :type
                   AND adjustment_date = :dt
                   AND LOWER(TRIM(COALESCE(reason, ''))) = LOWER(TRIM(:rsn))
                   AND COALESCE(user_id, 0) = COALESCE(:uid, 0)
                   AND created_at >= (NOW() - INTERVAL 60 SECOND)
                 LIMIT 1 FOR UPDATE"
            );

            foreach ($items as $pid => $item) {
                $chkPid = (int)$pid;
                $chk->execute();
                if (!$chk->fetch()) {
                    throw new RuntimeException('invalid product');
                }

                $dupChk->execute(array(
                    ':pid' => (int)$pid,
                    ':qty' => (int)$item['quantity'],
                    ':type' => (string)$item['adjustment_type'],
                    ':dt' => $date,
                    ':rsn' => $reason,
                    ':uid' => $uid
                ));
                if ($dupChk->fetch()) {
                    throw new RuntimeException('duplicate adjustment');
                }

                if ($item['adjustment_type'] === 'Deduction') {
                    $stock = productStock($this->conn, $pid);
                    if ($stock === null || $item['quantity'] > $stock) {
                        throw new RuntimeException('insufficient stock');
                    }
                } elseif ($item['adjustment_type'] === 'Addition') {
                    $stock = (int)productStock($this->conn, $pid);
                    $prodRow = $this->conn->query("SELECT max_stock, product_name FROM product WHERE product_id = " . (int)$pid)->fetch();
                    $maxStock = (int)($prodRow['max_stock'] ?? 100);
                    if ($maxStock <= 0) $maxStock = 100;
                    $remaining = max(0, $maxStock - $stock);
                    if ((int)$item['quantity'] > $remaining) {
                        throw new RuntimeException('maximum capacity reached');
                    }
                }
            }

            $itemPid = 0;
            $itemQty = 0;
            $itemType = '';
            $itemTok = null;
            $d = $this->conn->prepare("INSERT INTO adjustment_detail(product_id, quantity, adjustment_type, user_id, adjustment_date, reason, client_token) VALUES(:p, :q, :t, :u, :dt, :r, :tok)");
            $d->bindParam(':p', $itemPid, PDO::PARAM_INT);
            $d->bindParam(':q', $itemQty, PDO::PARAM_INT);
            $d->bindParam(':t', $itemType, PDO::PARAM_STR);
            $d->bindParam(':u', $uid, PDO::PARAM_INT);
            $d->bindParam(':dt', $date, PDO::PARAM_STR);
            $d->bindParam(':r', $reason, PDO::PARAM_STR);
            $d->bindParam(':tok', $itemTok, PDO::PARAM_STR);
            $lastId = 0;
            foreach ($items as $pid => $item) {
                $itemPid = (int)$pid;
                $itemQty = (int)$item['quantity'];
                $itemType = (string)$item['adjustment_type'];
                $itemTok = $clientToken !== '' ? ($clientToken . '-' . $itemPid) : null;
                try {
                    $d->execute();
                } catch (PDOException $ex) {
                    if ($ex->getCode() === '23000') {
                        throw new RuntimeException('duplicate adjustment');
                    }
                    throw $ex;
                }
                $lastId = (int)$this->conn->lastInsertId();
            }

            $this->conn->commit();
            return $lastId;
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

$api = new AdjustmentApi($conn);
$api->handleRequest($method);

