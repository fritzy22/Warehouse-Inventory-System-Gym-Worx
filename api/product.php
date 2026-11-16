<?php
require_once '../config/db.php';
sendJsonHeaders();

class ProductApi {
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
            case 'PUT':
                $this->put();
                break;
            case 'DELETE':
                $this->delete();
                break;
            default:
                sendResponse(false, 'Request failed.', null, 405);
                break;
        }
    }

    private function get() {
        requirePermission(array('product', 'product_supplier', 'purchase_request', 'request_approval', 'purchase_order', 'stock_receiving', 'stock_releasing', 'purchase_return', 'stocks_return', 'adjustment', 'stock_movement', 'inventory_report', 'dashboard'), 'view');
        if (isset($_GET['id']) && $_GET['id'] !== '') {
            $id = validatePositiveInt($_GET['id']);
            if ($id <= 0) {
                sendResponse(false, 'Invalid product ID.', null, 400);
            }
            $item = productInventoryMetrics($this->conn, $id, false);
            if (!$item) {
                sendResponse(false, 'Product not found.', null, 404);
            }
            sendResponse(true, 'Product retrieved', $item);
        }
        $mode = isset($_GET['mode']) ? (string)$_GET['mode'] : 'all';
        if ($mode === 'active') {
            sendResponse(true, 'Products retrieved', allProductsWithMetrics($this->conn, true));
        }
        sendResponse(true, 'Products retrieved', allProductsWithMetrics($this->conn, false));
    }

    private function post() {
        $actor = requirePermission('product', 'manage');
        requireCsrf();
        $body = getRequestBody();
        $categoryId = validatePositiveInt(isset($body['category_id']) ? $body['category_id'] : 0);
        $name = isset($body['product_name']) && is_string($body['product_name']) ? trim($body['product_name']) : '';
        $unit = isset($body['unit_measure']) && is_string($body['unit_measure']) ? trim($body['unit_measure']) : '';
        $price = isset($body['unit_price']) ? $body['unit_price'] : '0';
        $reorder = validateNonNegativeInt(isset($body['reorder_level']) && $body['reorder_level'] !== '' ? $body['reorder_level'] : 10);
        $maxStock = isset($body['max_stock']) && $body['max_stock'] !== ''
            ? validatePositiveInt($body['max_stock'])
            : 100;
        $openingStock = validateNonNegativeInt(isset($body['opening_stock']) && $body['opening_stock'] !== '' ? $body['opening_stock'] : 0);
        $openingReason = isset($body['opening_stock_reason']) && is_string($body['opening_stock_reason']) && trim($body['opening_stock_reason']) !== ''
            ? substr(trim($body['opening_stock_reason']), 0, 255)
            : 'Opening Stock Balance';

        if ($categoryId <= 0 || !$this->activeCategoryExists($categoryId) || !validateName($name, 150)
            || !validateName($unit, 30) || !validateNonNegativeDecimal($price) || $reorder === null || $maxStock <= 0 || $openingStock === null) {
            sendResponse(false, 'Please provide valid product details, reorder threshold, and maximum stock quantity.', null, 400);
        }

        if ($maxStock < $reorder) {
            sendResponse(false, 'Maximum stock quantity must be greater than or equal to the reorder threshold.', null, 422);
        }

        if ($openingStock > $maxStock) {
            sendResponse(false, 'Opening stock quantity cannot exceed maximum stock capacity.', null, 422);
        }

        if ($this->productNameExists($name, 0)) {
            sendResponse(false, 'A product with this name already exists.', null, 409);
        }

        $id = 0;
        try {
            $this->conn->beginTransaction();
            $priceStr = (string)$price;
            $stmt = $this->conn->prepare("INSERT INTO product (category_id, product_name, unit_measure, unit_price, reorder_level, max_stock) VALUES (:category_id, :name, :unit, :price, :reorder, :max_stock)");
            $stmt->bindParam(':category_id', $categoryId, PDO::PARAM_INT);
            $stmt->bindParam(':name', $name, PDO::PARAM_STR);
            $stmt->bindParam(':unit', $unit, PDO::PARAM_STR);
            $stmt->bindParam(':price', $priceStr, PDO::PARAM_STR);
            $stmt->bindParam(':reorder', $reorder, PDO::PARAM_INT);
            $stmt->bindParam(':max_stock', $maxStock, PDO::PARAM_INT);
            $stmt->execute();
            $id = (int)$this->conn->lastInsertId();

            if ($openingStock > 0) {
                $today = date('Y-m-d');
                $token = 'OPENING-' . $id . '-' . bin2hex(random_bytes(8));
                $adjStmt = $this->conn->prepare(
                    "INSERT INTO adjustment_detail (product_id, quantity, adjustment_type, user_id, adjustment_date, reason, client_token)
                     VALUES (:pid, :qty, 'Addition', :uid, :adj_date, :reason, :token)"
                );
                $adjStmt->execute(array(
                    ':pid' => $id,
                    ':qty' => $openingStock,
                    ':uid' => (int)$actor['user_id'],
                    ':adj_date' => $today,
                    ':reason' => $openingReason,
                    ':token' => $token
                ));
            }

            $this->conn->commit();
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            error_log('Product creation failed: ' . $e->getMessage());
            sendResponse(false, 'Request failed.', null, 400);
        }

        $auditDesc = 'Created product ' . $name . ' (reorder: ' . $reorder . ', max: ' . $maxStock . ($openingStock > 0 ? ', opening stock: ' . $openingStock : '') . ')';
        auditLog($this->conn, $actor, 'CREATE', 'product', $id, $auditDesc);
        if ($openingStock > 0) {
            auditLog($this->conn, $actor, 'ADJUSTMENT', 'adjustment', $id, 'Opening stock addition (' . $openingStock . ') for ' . $name . ' (' . $openingReason . ')');
        }
        checkAndNotifyLowStock($this->conn, array($id), $actor);
        $metrics = productInventoryMetrics($this->conn, $id, false);
        sendResponse(true, 'Product added successfully.', $metrics);
    }

    private function put() {
        $actor = requirePermission('product', 'manage');
        requireCsrf();
        $body = getRequestBody();
        $id = validatePositiveInt(isset($body['product_id']) ? $body['product_id'] : 0);
        $categoryId = validatePositiveInt(isset($body['category_id']) ? $body['category_id'] : 0);
        $name = isset($body['product_name']) && is_string($body['product_name']) ? trim($body['product_name']) : '';
        $unit = isset($body['unit_measure']) && is_string($body['unit_measure']) ? trim($body['unit_measure']) : '';
        $price = isset($body['unit_price']) ? $body['unit_price'] : '0';
        $reorder = validateNonNegativeInt(isset($body['reorder_level']) && $body['reorder_level'] !== '' ? $body['reorder_level'] : 10);
        $maxStock = isset($body['max_stock']) && $body['max_stock'] !== ''
            ? validatePositiveInt($body['max_stock'])
            : 100;

        if ($id <= 0 || !$this->productExists($id) || $categoryId <= 0 || !$this->categoryValidForUpdate($id, $categoryId)
            || !validateName($name, 150) || !validateName($unit, 30) || !validateNonNegativeDecimal($price) || $reorder === null || $maxStock <= 0) {
            sendResponse(false, 'Please provide valid product details, reorder threshold, and maximum stock quantity.', null, 400);
        }

        if ($maxStock < $reorder) {
            sendResponse(false, 'Maximum stock quantity must be greater than or equal to the reorder threshold.', null, 422);
        }

        if ($this->productNameExists($name, $id)) {
            sendResponse(false, 'A product with this name already exists.', null, 409);
        }

        try {
            $priceStr = (string)$price;
            $stmt = $this->conn->prepare("UPDATE product SET category_id = :category_id, product_name = :name, unit_measure = :unit, unit_price = :price, reorder_level = :reorder, max_stock = :max_stock WHERE product_id = :id");
            $stmt->bindParam(':category_id', $categoryId, PDO::PARAM_INT);
            $stmt->bindParam(':name', $name, PDO::PARAM_STR);
            $stmt->bindParam(':unit', $unit, PDO::PARAM_STR);
            $stmt->bindParam(':price', $priceStr, PDO::PARAM_STR);
            $stmt->bindParam(':reorder', $reorder, PDO::PARAM_INT);
            $stmt->bindParam(':max_stock', $maxStock, PDO::PARAM_INT);
            $stmt->bindParam(':id', $id, PDO::PARAM_INT);
            $stmt->execute();
        } catch (Throwable $e) {
            error_log('Product update failed: ' . $e->getMessage());
            sendResponse(false, 'Request failed.', null, 400);
        }

        auditLog($this->conn, $actor, 'UPDATE', 'product', $id, 'Updated product ' . $name . ' (reorder: ' . $reorder . ', max: ' . $maxStock . ')');
        checkAndNotifyLowStock($this->conn, array($id), $actor);
        $metrics = productInventoryMetrics($this->conn, $id, false);
        sendResponse(true, 'Product updated successfully.', $metrics);
    }

    private function delete() {
        $actor = requirePermission('product', 'manage');
        requireCsrf();
        $id = validatePositiveInt(isset($_GET['id']) ? $_GET['id'] : 0);
        $restore = isset($_GET['restore']) && (int)$_GET['restore'] === 1;

        if ($id <= 0 || !$this->productExists($id)) {
            sendResponse(false, 'Request failed.', null, 404);
        }

        $status = $restore ? 1 : 0;
        $stmt = $this->conn->prepare("UPDATE product SET is_active = :status WHERE product_id = :id");
        $stmt->bindParam(':status', $status, PDO::PARAM_INT);
        $stmt->bindParam(':id', $id, PDO::PARAM_INT);
        $stmt->execute();

        auditLog($this->conn, $actor, $restore ? 'RESTORE' : 'DEACTIVATE', 'product', $id, 'Product status changed');
        sendResponse(true, $restore ? 'Product restored successfully.' : 'Product deactivated successfully.');
    }

    private function productExists($id) {
        $stmt = $this->conn->prepare("SELECT product_id FROM product WHERE product_id = :id LIMIT 1");
        $stmt->bindParam(':id', $id, PDO::PARAM_INT);
        $stmt->execute();
        return (bool)$stmt->fetch();
    }

    private function productNameExists($name, $excludeId = 0) {
        $stmt = $this->conn->prepare("SELECT product_id FROM product WHERE LOWER(TRIM(product_name)) = LOWER(TRIM(:name)) AND product_id != :id LIMIT 1");
        $stmt->bindParam(':name', $name, PDO::PARAM_STR);
        $stmt->bindParam(':id', $excludeId, PDO::PARAM_INT);
        $stmt->execute();
        return (bool)$stmt->fetch();
    }

    private function activeCategoryExists($id) {
        $stmt = $this->conn->prepare("SELECT category_id FROM category WHERE category_id = :id AND is_active = 1 LIMIT 1");
        $stmt->bindParam(':id', $id, PDO::PARAM_INT);
        $stmt->execute();
        return (bool)$stmt->fetch();
    }

    private function categoryValidForUpdate($productId, $categoryId) {
        if ($this->activeCategoryExists($categoryId)) {
            return true;
        }
        $stmt = $this->conn->prepare("SELECT category_id FROM product WHERE product_id = :pid AND category_id = :cid LIMIT 1");
        $stmt->execute(array(':pid' => (int)$productId, ':cid' => (int)$categoryId));
        return (bool)$stmt->fetch();
    }
}

$conn = getConnection();
$method = $_SERVER['REQUEST_METHOD'];

$api = new ProductApi($conn);
$api->handleRequest($method);
