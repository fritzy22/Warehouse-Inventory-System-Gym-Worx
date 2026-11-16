<?php
require_once '../config/db.php';
sendJsonHeaders();

class StockReleasingApi {
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
        requirePermission('stock_releasing', 'view');
        $mode = isset($_GET['mode']) ? (string)$_GET['mode'] : 'all';
        if ($mode === 'detail') {
            $id = validatePositiveInt(isset($_GET['releasing_id']) ? $_GET['releasing_id'] : 0);
            if ($id <= 0) {
                sendResponse(false, 'Request failed.', null, 400);
            }
            sendResponse(true, 'Stock releasing items retrieved', $this->getStockReleasingDetails($id));
        }
        if ($mode === 'pending_pr_releases') {
            sendResponse(true, 'Approved store requests ready for release retrieved', $this->getPendingPrReleases());
        }
        if ($mode === 'store_inventory') {
            sendResponse(true, 'Store inventory retrieved', $this->getStoreInventory());
        }
        sendResponse(true, 'Stock releasing records retrieved', $this->getAllStockReleasing());
    }

    private function getStockReleasingDetails($id) {
        $s = $this->conn->prepare(
            "SELECT d.product_id, p.product_name, d.quantity_released, p.unit_price
             FROM stock_releasing_detail d
             INNER JOIN product p ON d.product_id=p.product_id
             WHERE d.releasing_id=:id"
        );
        $s->bindParam(':id', $id, PDO::PARAM_INT);
        $s->execute();
        return $s->fetchAll();
    }

    private function post() {
        $actor = requirePermission('stock_releasing', 'manage');
        requireCsrf();
        $b = getRequestBody();
        $prId = validatePositiveInt(isset($b['pr_id']) ? $b['pr_id'] : 0);
        $destStore = isset($b['destination_store']) && is_string($b['destination_store']) ? trim($b['destination_store']) : '';
        $requested = isset($b['requested_by']) && is_string($b['requested_by']) ? trim($b['requested_by']) : '';
        $date = isset($b['releasing_date']) ? $b['releasing_date'] : date('Y-m-d');
        $items = ensureItemList(isset($b['items']) ? $b['items'] : array(), 'quantity_released');

        if ($prId > 0 && $requested === '') {
            $requested = $destStore !== '' ? ('Store: ' . $destStore) : 'Store Fulfillment';
        }

        if (!validateName($requested, 100) || !validateDateValue($date) || $items === false) {
            sendResponse(false, 'Request failed.', null, 400);
        }

        try {
            if ($prId > 0) {
                $id = $this->createStoreFulfillmentRelease($prId, $destStore, $requested, $date, $items, $actor);
            } else {
                $id = $this->createStockReleasing($requested, $date, $items, $actor);
            }
        } catch (RuntimeException $e) {
            $msg = $e->getMessage() === 'insufficient stock'
                ? 'Insufficient stock on hand to release the requested quantity.'
                : ($e->getMessage() ?: 'Invalid product selected.');
            sendResponse(false, $msg, null, 409);
        } catch (Throwable $e) {
            error_log('Stock releasing failed: ' . $e->getMessage());
            sendResponse(false, 'Request failed.', null, 500);
        }

        auditLog($this->conn, $actor, 'STOCK_RELEASING', 'stock_releasing', $id, 'Stock releasing recorded for ' . $requested . ($prId > 0 ? (' (PR-' . str_pad((string)$prId, 4, '0', STR_PAD_LEFT) . ')') : ''));
        checkAndNotifyLowStock($this->conn, array_keys($items), $actor);
        sendResponse(true, 'Stock releasing recorded successfully.', array('releasing_id' => $id));
    }

    private function getAllStockReleasing() {
        $s = $this->conn->query(
            "SELECT r.releasing_id,
                    CONCAT('REL-', LPAD(r.releasing_id, 4, '0')) AS releasing_code,
                    r.pr_id,
                    r.destination_store,
                    CASE WHEN r.pr_id IS NOT NULL THEN CONCAT('PR-', LPAD(r.pr_id, 4, '0')) ELSE NULL END AS pr_code,
                    r.requested_by,
                    CONCAT(u.first_name,' ',u.last_name) AS released_by,
                    r.releasing_date,
                    (SELECT COUNT(*) FROM stock_releasing_detail d WHERE d.releasing_id=r.releasing_id) AS item_count,
                    COALESCE((SELECT SUM(d.quantity_released) FROM stock_releasing_detail d WHERE d.releasing_id=r.releasing_id), 0) AS total_quantity
             FROM stock_releasing r
             INNER JOIN users u ON r.user_id=u.user_id
             ORDER BY r.releasing_date DESC, r.releasing_id DESC"
        );
        return $s->fetchAll();
    }

    private function getPendingPrReleases() {
        $q = $this->conn->query(
            "SELECT pr.pr_id,
                    CONCAT('PR-', LPAD(pr.pr_id, 4, '0')) AS pr_code,
                    pr.requester_id,
                    COALESCE(pr.store_name, 'Main Store') AS store_name,
                    CONCAT(ru.first_name, ' ', ru.last_name) AS requested_by_name,
                    CONCAT(rv.first_name, ' ', rv.last_name) AS approved_by_name,
                    pr.submitted_at, pr.reviewed_at, pr.manager_comment,
                    (SELECT COUNT(*) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id) AS item_count,
                    COALESCE((SELECT SUM(COALESCE(d.approved_qty, d.requested_qty)) FROM purchase_request_detail d WHERE d.pr_id = pr.pr_id), 0) AS total_approved_qty
             FROM purchase_request pr
             LEFT JOIN users ru ON ru.user_id = pr.requester_id
             LEFT JOIN users rv ON rv.user_id = pr.reviewed_by
             WHERE pr.status = 'Approved'
               AND (pr.releasing_id IS NULL OR pr.releasing_id = 0)
             ORDER BY pr.reviewed_at ASC, pr.pr_id ASC"
        );
        $prs = $q->fetchAll();

        $detStmt = $this->conn->prepare(
            "SELECT d.pr_detail_id, d.product_id, p.product_name, p.unit_measure,
                    d.requested_qty, COALESCE(d.approved_qty, d.requested_qty) AS authorized_qty
             FROM purchase_request_detail d
             INNER JOIN product p ON p.product_id = d.product_id
             WHERE d.pr_id = :id
             ORDER BY d.pr_detail_id ASC"
        );

        foreach ($prs as &$pr) {
            $detStmt->execute(array(':id' => (int)$pr['pr_id']));
            $lines = $detStmt->fetchAll();
            $allCovered = true;
            foreach ($lines as &$ln) {
                $avail = productStock($this->conn, (int)$ln['product_id'], (int)$pr['pr_id']);
                $ln['available_warehouse_stock'] = $avail !== null ? (int)$avail : 0;
                $ln['is_stock_sufficient'] = ($ln['available_warehouse_stock'] >= (int)$ln['authorized_qty']);
                if (!$ln['is_stock_sufficient']) {
                    $allCovered = false;
                }
            }
            unset($ln);
            $pr['items'] = $lines;
            $pr['can_fulfill_from_warehouse'] = $allCovered;
        }
        unset($pr);

        return $prs;
    }

    private function getStoreInventory() {
        $s = $this->conn->query(
            "SELECT si.store_inventory_id, si.store_name, si.product_id, p.product_name,
                    c.category_name, p.unit_measure, si.quantity, si.quantity AS store_stock, si.updated_at
             FROM store_inventory si
             INNER JOIN product p ON p.product_id = si.product_id
             LEFT JOIN category c ON c.category_id = p.category_id
             ORDER BY si.store_name ASC, p.product_name ASC"
        );
        return $s->fetchAll();
    }

    private function createStoreFulfillmentRelease($prId, $destStore, $requestedBy, $date, $items, $user) {
        $this->conn->beginTransaction();
        try {
            $prQ = $this->conn->prepare("SELECT pr_id, requester_id, store_name, status FROM purchase_request WHERE pr_id = :id FOR UPDATE");
            $prQ->execute(array(':id' => $prId));
            $pr = $prQ->fetch();
            if (!$pr) {
                throw new RuntimeException('Originating store request not found.');
            }
            if ($pr['status'] !== 'Approved') {
                throw new RuntimeException('Only Approved store requests can be fulfilled from the warehouse (current status: ' . $pr['status'] . ').');
            }

            if ($destStore === '') {
                $destStore = !empty($pr['store_name']) ? $pr['store_name'] : 'Main Store';
            }

            // Verify lines and warehouse stock
            $chkPid = 0;
            $chk = $this->conn->prepare("SELECT product_id FROM product WHERE product_id=:id AND is_active=1 FOR UPDATE");
            $chk->bindParam(':id', $chkPid, PDO::PARAM_INT);
            foreach ($items as $pid => $qty) {
                $chkPid = (int)$pid;
                $chk->execute();
                if (!$chk->fetch()) {
                    throw new RuntimeException('invalid product');
                }
                $stock = productStock($this->conn, $pid, $prId);
                if ($stock === null || $qty > $stock) {
                    throw new RuntimeException('insufficient stock');
                }
            }

            // Release any active stock reservations held for this PR so they are not double-counted
            $relRes = $this->conn->prepare(
                "UPDATE stock_reservation SET status = 'Released' WHERE pr_id = :pr_id AND status = 'Active'"
            );
            $relRes->execute(array(':pr_id' => $prId));

            // Insert stock releasing header with pr_id and destination_store
            $q = $this->conn->prepare("INSERT INTO stock_releasing(requested_by, user_id, releasing_date, pr_id, destination_store) VALUES(:requested, :u, :d, :pr, :dest)");
            $userId = (int)$user['user_id'];
            $q->execute(array(
                ':requested' => $requestedBy,
                ':u' => $userId,
                ':d' => $date,
                ':pr' => $prId,
                ':dest' => $destStore
            ));
            $relId = (int)$this->conn->lastInsertId();

            // Insert details
            $d = $this->conn->prepare("INSERT INTO stock_releasing_detail(releasing_id, product_id, quantity_released) VALUES(:r, :p, :q)");
            $updStore = $this->conn->prepare(
                "INSERT INTO store_inventory (store_name, product_id, quantity)
                 VALUES (:store, :p, :q)
                 ON DUPLICATE KEY UPDATE quantity = quantity + :q_upd"
            );

            foreach ($items as $pid => $qty) {
                $d->execute(array(
                    ':r' => $relId,
                    ':p' => (int)$pid,
                    ':q' => (int)$qty
                ));
                $updStore->execute(array(
                    ':store' => $destStore,
                    ':p' => (int)$pid,
                    ':q' => (int)$qty,
                    ':q_upd' => (int)$qty
                ));
            }

            // Update PR to Completed with fulfillment_type = 'store_release' and releasing_id
            $updPr = $this->conn->prepare(
                "UPDATE purchase_request
                 SET status = 'Completed',
                     fulfillment_type = 'store_release',
                     releasing_id = :rel_id,
                     completed_at = NOW(),
                     updated_at = NOW()
                 WHERE pr_id = :id"
            );
            $updPr->execute(array(
                ':rel_id' => $relId,
                ':id' => $prId
            ));

            // Record history
            $prCode = 'PR-' . str_pad((string)$prId, 4, '0', STR_PAD_LEFT);
            $relCode = 'REL-' . str_pad((string)$relId, 4, '0', STR_PAD_LEFT);
            $h = $this->conn->prepare(
                "INSERT INTO purchase_request_history (pr_id, user_id, action, from_status, to_status, comment)
                 VALUES (:pr_id, :uid, 'FULFILLED', 'Approved', 'Completed', :comm)"
            );
            $h->execute(array(
                ':pr_id' => $prId,
                ':uid' => $userId,
                ':comm' => 'Fulfilled from central warehouse via ' . $relCode . ' to ' . $destStore
            ));

            $this->conn->commit();

            // Notify requester
            if (!empty($pr['requester_id'])) {
                notifyUser(
                    $this->conn,
                    (int)$pr['requester_id'],
                    'pr_fulfilled',
                    $prCode . ' Fulfilled & Released',
                    'Your store request ' . $prCode . ' has been fulfilled from warehouse stock and released to ' . $destStore . '.',
                    'purchase_request',
                    'stock_releasing',
                    $relId,
                    'success'
                );
            }

            return $relId;
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $e;
        }
    }

    private function createStockReleasing($requestedBy, $date, $items, $user) {
        $this->conn->beginTransaction();
        try {
            $chkPid = 0;
            $chk = $this->conn->prepare("SELECT product_id FROM product WHERE product_id=:id AND is_active=1 FOR UPDATE");
            $chk->bindParam(':id', $chkPid, PDO::PARAM_INT);
            foreach ($items as $pid => $qty) {
                $chkPid = (int)$pid;
                $chk->execute();
                if (!$chk->fetch()) {
                    throw new RuntimeException('invalid product');
                }
                $stock = productStock($this->conn, $pid);
                if ($stock === null || $qty > $stock) {
                    throw new RuntimeException('insufficient stock');
                }
            }

            $q = $this->conn->prepare("INSERT INTO stock_releasing(requested_by, user_id, releasing_date) VALUES(:requested, :u, :d)");
            $userId = (int)$user['user_id'];
            $q->bindParam(':requested', $requestedBy, PDO::PARAM_STR);
            $q->bindParam(':u', $userId, PDO::PARAM_INT);
            $q->bindParam(':d', $date, PDO::PARAM_STR);
            $q->execute();
            $id = (int)$this->conn->lastInsertId();

            $itemPid = 0;
            $itemQty = 0;
            $d = $this->conn->prepare("INSERT INTO stock_releasing_detail(releasing_id, product_id, quantity_released) VALUES(:r, :p, :q)");
            $d->bindParam(':r', $id, PDO::PARAM_INT);
            $d->bindParam(':p', $itemPid, PDO::PARAM_INT);
            $d->bindParam(':q', $itemQty, PDO::PARAM_INT);
            foreach ($items as $pid => $qty) {
                $itemPid = (int)$pid;
                $itemQty = (int)$qty;
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

$api = new StockReleasingApi($conn);
$api->handleRequest($method);

