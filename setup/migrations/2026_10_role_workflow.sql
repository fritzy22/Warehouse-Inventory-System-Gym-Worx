-- ============================================================
-- Migration: Role-based workflow (Purchase Requests, approvals,
-- partial receiving, notifications, audit log, max stock)
-- Date: 2026-10-17
-- Target: MariaDB 10.4+ / MySQL 8 (XAMPP)
-- Idempotent: safe to run more than once.
-- Usage:  mysql -u root warehouse_inventory_db < setup/migrations/2026_10_role_workflow.sql
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- 1. Product: maximum stock + default reorder threshold of 10
-- ------------------------------------------------------------
ALTER TABLE product ADD COLUMN IF NOT EXISTS max_stock INT NOT NULL DEFAULT 100 AFTER reorder_level;
ALTER TABLE product ALTER COLUMN reorder_level SET DEFAULT 10;

-- ------------------------------------------------------------
-- 2. Purchase requests (Store Requester -> Manager approval)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_request (
    pr_id INT AUTO_INCREMENT PRIMARY KEY,
    requester_id INT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'Pending',
    reason VARCHAR(500) NULL,
    manager_comment VARCHAR(500) NULL,
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    KEY idx_pr_status (status),
    KEY idx_pr_requester (requester_id, status),
    CONSTRAINT fk_pr_requester FOREIGN KEY (requester_id) REFERENCES users(user_id),
    CONSTRAINT fk_pr_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS purchase_request_detail (
    pr_detail_id INT AUTO_INCREMENT PRIMARY KEY,
    pr_id INT NOT NULL,
    product_id INT NOT NULL,
    requested_qty INT NOT NULL,
    approved_qty INT NULL,
    adjustment_reason VARCHAR(255) NULL,
    ordered_qty INT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_prd_pr_product (pr_id, product_id),
    KEY idx_prd_product (product_id),
    CONSTRAINT fk_prd_pr FOREIGN KEY (pr_id) REFERENCES purchase_request(pr_id),
    CONSTRAINT fk_prd_product FOREIGN KEY (product_id) REFERENCES product(product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS purchase_request_history (
    history_id INT AUTO_INCREMENT PRIMARY KEY,
    pr_id INT NOT NULL,
    user_id INT NULL,
    action VARCHAR(40) NOT NULL,
    from_status VARCHAR(30) NULL,
    to_status VARCHAR(30) NULL,
    comment VARCHAR(1000) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_prh_pr (pr_id, history_id),
    CONSTRAINT fk_prh_pr FOREIGN KEY (pr_id) REFERENCES purchase_request(pr_id),
    CONSTRAINT fk_prh_user FOREIGN KEY (user_id) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ------------------------------------------------------------
-- 3. Purchase order: link to request + lifecycle columns
-- ------------------------------------------------------------
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS pr_id INT NULL AFTER user_id;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS expected_date DATE NULL AFTER order_date;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS confirmed_at DATETIME NULL;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS closed_reason VARCHAR(255) NULL;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE purchase_order ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE purchase_order ADD INDEX IF NOT EXISTS idx_po_status (status);
ALTER TABLE purchase_order ADD INDEX IF NOT EXISTS idx_po_pr (pr_id);
ALTER TABLE purchase_order ADD CONSTRAINT fk_po_pr FOREIGN KEY IF NOT EXISTS (pr_id) REFERENCES purchase_request(pr_id);

-- Legacy "Pending" meant "ordered, awaiting delivery"
UPDATE purchase_order SET status = 'Ordered' WHERE status = 'Pending';

ALTER TABLE purchase_order_detail ADD COLUMN IF NOT EXISTS pr_detail_id INT NULL AFTER po_id;
ALTER TABLE purchase_order_detail ADD COLUMN IF NOT EXISTS quantity_received INT NOT NULL DEFAULT 0 AFTER quantity_ordered;
ALTER TABLE purchase_order_detail ADD INDEX IF NOT EXISTS idx_pod_prd (pr_detail_id);
ALTER TABLE purchase_order_detail ADD CONSTRAINT fk_pod_prd FOREIGN KEY IF NOT EXISTS (pr_detail_id) REFERENCES purchase_request_detail(pr_detail_id);

-- ------------------------------------------------------------
-- 4. Stock receiving: allow multiple (partial) deliveries per PO
-- ------------------------------------------------------------
ALTER TABLE stock_receiving ADD INDEX IF NOT EXISTS idx_recv_po (po_id);
ALTER TABLE stock_receiving DROP INDEX IF EXISTS uq_stock_receiving_po;
ALTER TABLE stock_receiving ADD COLUMN IF NOT EXISTS dr_number VARCHAR(50) NULL;
ALTER TABLE stock_receiving ADD COLUMN IF NOT EXISTS remarks VARCHAR(500) NULL;
ALTER TABLE stock_receiving ADD COLUMN IF NOT EXISTS client_token VARCHAR(64) NULL;
ALTER TABLE stock_receiving ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE stock_receiving ADD UNIQUE INDEX IF NOT EXISTS uq_recv_client_token (client_token);

ALTER TABLE stock_receiving_detail ADD COLUMN IF NOT EXISTS po_detail_id INT NULL AFTER receiving_id;
ALTER TABLE stock_receiving_detail ADD COLUMN IF NOT EXISTS quantity_damaged INT NOT NULL DEFAULT 0;
ALTER TABLE stock_receiving_detail ADD COLUMN IF NOT EXISTS discrepancy_note VARCHAR(255) NULL;
ALTER TABLE stock_receiving_detail ADD INDEX IF NOT EXISTS idx_srd_pod (po_detail_id);
ALTER TABLE stock_receiving_detail ADD INDEX IF NOT EXISTS idx_srd_product (product_id);

-- Back-fill running received totals and line links for legacy data
UPDATE purchase_order_detail pod
JOIN (
    SELECT r.po_id, d.product_id, SUM(d.quantity_received) AS q
    FROM stock_receiving r
    JOIN stock_receiving_detail d ON d.receiving_id = r.receiving_id
    GROUP BY r.po_id, d.product_id
) x ON x.po_id = pod.po_id AND x.product_id = pod.product_id
SET pod.quantity_received = x.q
WHERE pod.quantity_received = 0;

UPDATE stock_receiving_detail d
JOIN stock_receiving r ON r.receiving_id = d.receiving_id
JOIN purchase_order_detail pod ON pod.po_id = r.po_id AND pod.product_id = d.product_id
SET d.po_detail_id = pod.po_detail_id
WHERE d.po_detail_id IS NULL;

-- ------------------------------------------------------------
-- 5. Adjustments: record who/when/why (previously discarded)
-- ------------------------------------------------------------
ALTER TABLE adjustment_detail ADD COLUMN IF NOT EXISTS user_id INT NULL;
ALTER TABLE adjustment_detail ADD COLUMN IF NOT EXISTS adjustment_date DATE NULL;
ALTER TABLE adjustment_detail ADD COLUMN IF NOT EXISTS reason VARCHAR(255) NULL;
ALTER TABLE adjustment_detail ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ------------------------------------------------------------
-- 6. Notifications + audit log
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification (
    notification_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type VARCHAR(40) NOT NULL,
    severity VARCHAR(10) NOT NULL DEFAULT 'info',
    title VARCHAR(150) NOT NULL,
    message VARCHAR(500) NOT NULL,
    link_tab VARCHAR(50) NULL,
    ref_type VARCHAR(30) NULL,
    ref_id INT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at DATETIME NULL,
    KEY idx_notif_user (user_id, is_read, notification_id),
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS audit_log (
    audit_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    action VARCHAR(50) NOT NULL,
    module VARCHAR(50) NOT NULL,
    record_id INT NULL,
    description VARCHAR(1000) NULL,
    ip_address VARCHAR(45) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_audit_created (created_at),
    KEY idx_audit_module (module, record_id),
    KEY idx_audit_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ------------------------------------------------------------
-- 7. Roles & permissions
-- ------------------------------------------------------------
INSERT IGNORE INTO role (role_name) VALUES ('Manager');
UPDATE role SET is_active = 1 WHERE role_name = 'Manager';

-- New modules: insert only when missing so administrator edits are never overwritten.
INSERT IGNORE INTO role_permissions (role_id, module, can_view, can_manage)
SELECT r.role_id, m.module, m.v, m.mg
FROM role r
JOIN (
              SELECT 'Administrator' rn, 'purchase_request' module, 1 v, 1 mg
    UNION ALL SELECT 'Administrator', 'request_approval', 1, 1
    UNION ALL SELECT 'Administrator', 'audit_log', 1, 1
    UNION ALL SELECT 'Administrator', 'stock_movement', 1, 1
    UNION ALL SELECT 'Administrator', 'inventory_report', 1, 1
    UNION ALL SELECT 'Manager', 'dashboard', 1, 0
    UNION ALL SELECT 'Manager', 'category', 1, 0
    UNION ALL SELECT 'Manager', 'product', 1, 0
    UNION ALL SELECT 'Manager', 'supplier', 1, 0
    UNION ALL SELECT 'Manager', 'purchase_request', 1, 0
    UNION ALL SELECT 'Manager', 'request_approval', 1, 1
    UNION ALL SELECT 'Manager', 'purchase_order', 1, 0
    UNION ALL SELECT 'Manager', 'stock_receiving', 1, 0
    UNION ALL SELECT 'Manager', 'stock_movement', 1, 0
    UNION ALL SELECT 'Manager', 'inventory_report', 1, 0
    UNION ALL SELECT 'Manager', 'audit_log', 0, 0
    UNION ALL SELECT 'Purchasing Officer', 'purchase_request', 1, 0
    UNION ALL SELECT 'Purchasing Officer', 'request_approval', 0, 0
    UNION ALL SELECT 'Purchasing Officer', 'stock_movement', 1, 0
    UNION ALL SELECT 'Purchasing Officer', 'audit_log', 0, 0
    UNION ALL SELECT 'Purchasing Officer', 'inventory_report', 1, 0
    UNION ALL SELECT 'Warehouse Staff', 'purchase_request', 1, 0
    UNION ALL SELECT 'Warehouse Staff', 'request_approval', 0, 0
    UNION ALL SELECT 'Warehouse Staff', 'stock_movement', 1, 0
    UNION ALL SELECT 'Warehouse Staff', 'audit_log', 0, 0
    UNION ALL SELECT 'Warehouse Staff', 'inventory_report', 1, 0
    UNION ALL SELECT 'Store Requester', 'purchase_request', 1, 1
    UNION ALL SELECT 'Store Requester', 'request_approval', 0, 0
    UNION ALL SELECT 'Store Requester', 'stock_movement', 0, 0
    UNION ALL SELECT 'Store Requester', 'audit_log', 0, 0
    UNION ALL SELECT 'Store Requester', 'inventory_report', 1, 0
) m ON m.rn = r.role_name;

-- The Manager role must hold approval authority (core responsibility).
UPDATE role_permissions rp JOIN role r ON r.role_id = rp.role_id
SET rp.can_view = 1, rp.can_manage = 1
WHERE r.role_name = 'Manager' AND rp.module = 'request_approval';

-- Store Requesters must be able to submit purchase requests.
UPDATE role_permissions rp JOIN role r ON r.role_id = rp.role_id
SET rp.can_view = 1, rp.can_manage = 1
WHERE r.role_name = 'Store Requester' AND rp.module = 'purchase_request';
