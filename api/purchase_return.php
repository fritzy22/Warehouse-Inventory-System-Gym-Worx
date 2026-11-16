<?php
require_once '../config/db.php';
sendJsonHeaders();

class PurchaseReturnApi {
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
        requirePermission('purchase_return', 'view');
        $mode = isset($_GET['mode']) ? (string)$_GET['mode'] : 'all';

        if ($mode === 'detail') {
            $id = validatePositiveInt(isset($_GET['purchase_return_id']) ? $_GET['purchase_return_id'] : (isset($_GET['return_id']) ? $_GET['return_id'] : (isset($_GET['id']) ? $_GET['id'] : 0)));
            if ($id <= 0) {
                sendResponse(false, 'Request failed.', null, 400);
            }
            sendResponse(true, 'Purchase return details retrieved', $this->getPurchaseReturnDetails($id));
        }

        if ($mode === 'sources') {
            sendResponse(true, 'Return sources retrieved', $this->getReturnSources());
        }

        sendResponse(true, 'Purchase returns retrieved', $this->getAllPurchaseReturns());
    }

    private function getPurchaseReturnDetails($id) {
        $s = $this->conn->prepare(
            "SELECT pr.purchase_return_id,
                    CONCAT('RET-', LPAD(pr.purchase_return_id, 4, '0')) AS return_code,
                    pr.supplier_id, s.supplier_name, s.contact_person, s.phone, s.email,
                    CONCAT(u.first_name, ' ', u.last_name) AS returned_by,
                    pr.return_date, pr.reason, pr.po_id, pr.receiving_id,
                    po.status AS po_status, rcv.dr_number
             FROM purchase_return pr
             INNER JOIN supplier s ON s.supplier_id = pr.supplier_id
             INNER JOIN users u ON u.user_id = pr.user_id
             LEFT JOIN purchase_order po ON po.po_id = pr.po_id
             LEFT JOIN stock_receiving rcv ON rcv.receiving_id = pr.receiving_id
             WHERE pr.purchase_return_id = :id"
        );
        $s->execute(array(':id' => $id));
        $hdr = $s->fetch();
        if (!$hdr) {
            return null;
        }

        $d = $this->conn->prepare(
            "SELECT d.product_id, p.product_name, p.unit_measure, d.quantity_returned, p.unit_price
             FROM purchase_return_detail d
             INNER JOIN product p ON p.product_id = d.product_id
             WHERE d.purchase_return_id = :id"
        );
        $d->execute(array(':id' => $id));
        $hdr['items'] = $d->fetchAll();
        return $hdr;
    }

    private function getReturnSources() {
        // Return recent receivings and purchase orders so staff can quickly populate supplier & products
        $receivings = $this->conn->query(
            "SELECT r.receiving_id,
                    CONCAT('RCV-', LPAD(r.receiving_id, 4, '0')) AS receiving_code,
                    r.po_id,
                    CONCAT('PO-', LPAD(r.po_id, 4, '0')) AS po_code,
                    r.dr_number,
                    r.receiving_date,
                    po.supplier_id,
                    s.supplier_name,
                    (SELECT COUNT(*) FROM stock_receiving_detail d WHERE d.receiving_id = r.receiving_id) AS item_count,
                    COALESCE((SELECT SUM(d.quantity_damaged) FROM stock_receiving_detail d WHERE d.receiving_id = r.receiving_id), 0) AS total_damaged
             FROM stock_receiving r
             INNER JOIN purchase_order po ON po.po_id = r.po_id
             INNER JOIN supplier s ON s.supplier_id = po.supplier_id
             ORDER BY r.receiving_id DESC
             LIMIT 25"
        )->fetchAll();

        return array(
            'receivings' => $receivings
        );
    }

    private function post() {
        $actor = requirePermission('purchase_return', 'manage');
        requireCsrf();
        $b = getRequestBody();
        $supplierId = validatePositiveInt(isset($b['supplier_id']) ? $b['supplier_id'] : 0);
        $poId = validatePositiveInt(isset($b['po_id']) ? $b['po_id'] : 0);
        $receivingId = validatePositiveInt(isset($b['receiving_id']) ? $b['receiving_id'] : 0);
        $date = isset($b['return_date']) ? $b['return_date'] : date('Y-m-d');
        $reason = isset($b['reason']) && is_string($b['reason']) ? trim($b['reason']) : '';
        $items = ensureItemList(isset($b['items']) ? $b['items'] : array(), 'quantity_returned');

        if ($supplierId <= 0 || !validateDateValue($date) || strlen($reason) > 255 || $items === false) {
            sendResponse(false, 'Request failed.', null, 400);
        }

        try {
            $id = $this->createPurchaseReturn($supplierId, $poId, $receivingId, $date, $reason, $items, $actor);
        } catch (RuntimeException $e) {
            $msg = $e->getMessage() === 'insufficient stock'
                ? 'Insufficient stock on hand to return the requested quantity.'
                : 'Invalid product selected.';
            sendResponse(false, $msg, null, 409);
        } catch (Throwable $e) {
            error_log('Purchase return failed: ' . $e->getMessage());
            sendResponse(false, 'Request failed.', null, 500);
        }

        $retCode = 'RET-' . str_pad((string)$id, 4, '0', STR_PAD_LEFT);
        auditLog($this->conn, $actor, 'PURCHASE_RETURN', 'purchase_return', $id, $retCode . ' recorded (' . $reason . ')');
        checkAndNotifyLowStock($this->conn, array_keys($items), $actor);
        sendResponse(true, 'Purchase return recorded successfully.', array('purchase_return_id' => $id, 'return_code' => $retCode));
    }

    private function getAllPurchaseReturns() {
        $s = $this->conn->query(
            "SELECT pr.purchase_return_id,
                    CONCAT('RET-', LPAD(pr.purchase_return_id, 4, '0')) AS return_code,
                    pr.supplier_id, s.supplier_name,
                    pr.po_id, pr.receiving_id,
                    CASE WHEN pr.po_id IS NOT NULL THEN CONCAT('PO-', LPAD(pr.po_id, 4, '0')) ELSE NULL END AS po_code,
                    CONCAT(u.first_name,' ',u.last_name) AS returned_by,
                    pr.return_date, pr.reason,
                    (SELECT COUNT(*) FROM purchase_return_detail d WHERE d.purchase_return_id=pr.purchase_return_id) AS item_count,
                    COALESCE((SELECT SUM(d.quantity_returned) FROM purchase_return_detail d WHERE d.purchase_return_id=pr.purchase_return_id), 0) AS total_returned_qty
             FROM purchase_return pr
             INNER JOIN supplier s ON pr.supplier_id=s.supplier_id
             INNER JOIN users u ON pr.user_id=u.user_id
             ORDER BY pr.return_date DESC, pr.purchase_return_id DESC"
        );
        return $s->fetchAll();
    }

    private function createPurchaseReturn($supplierId, $poId, $receivingId, $date, $reason, $items, $user) {
        $this->conn->beginTransaction();
        try {
            $q = $this->conn->prepare("SELECT supplier_id FROM supplier WHERE supplier_id=:id AND is_active=1 FOR UPDATE");
            $q->bindParam(':id', $supplierId, PDO::PARAM_INT);
            $q->execute();
            if (!$q->fetch()) {
                throw new RuntimeException('invalid supplier');
            }

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

            $q = $this->conn->prepare(
                "INSERT INTO purchase_return(supplier_id, user_id, return_date, reason, po_id, receiving_id)
                 VALUES(:s, :u, :d, :r, :po, :rcv)"
            );
            $userId = (int)$user['user_id'];
            $q->execute(array(
                ':s' => $supplierId,
                ':u' => $userId,
                ':d' => $date,
                ':r' => $reason,
                ':po' => $poId > 0 ? $poId : null,
                ':rcv' => $receivingId > 0 ? $receivingId : null
            ));
            $id = (int)$this->conn->lastInsertId();

            $itemPid = 0;
            $itemQty = 0;
            $d = $this->conn->prepare("INSERT INTO purchase_return_detail(purchase_return_id, product_id, quantity_returned) VALUES(:r, :p, :q)");
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

$api = new PurchaseReturnApi($conn);
$api->handleRequest($method);

