-- ============================================================
-- Phase 1 SQL Migration: Role Naming & RBAC Permissions Fix
-- Idempotent & Non-Destructive: Safe to run on existing database.
-- Preserves all existing tables, user records, and password hashes.
-- Target: MariaDB 10.4+ / MySQL 8.0+
-- ============================================================

SET NAMES utf8mb4;

-- 1. Ensure Role 2 is formally named 'Warehouse Officer'
UPDATE `role` SET `role_name` = 'Warehouse Officer' WHERE `role_id` = 2;

-- 2. Cleanly configure Role Permissions for Role 1 (Admin)
-- Admin manages users, roles, products, categories, suppliers, and system settings.
-- Admin monitors all purchasing and warehouse activities (read-only).
-- Admin cannot approve requests or modify warehouse inventory directly.
INSERT INTO `role_permissions` (`role_id`, `module`, `can_view`, `can_manage`) VALUES
(1, 'dashboard', 1, 1),
(1, 'users', 1, 1),
(1, 'role', 1, 1),
(1, 'category', 1, 1),
(1, 'product', 1, 1),
(1, 'supplier', 1, 1),
(1, 'product_supplier', 1, 1),
(1, 'audit_log', 1, 1),
(1, 'inventory_report', 1, 1),
(1, 'purchase_request', 1, 0),
(1, 'request_approval', 0, 0),
(1, 'purchase_order', 1, 0),
(1, 'stock_receiving', 1, 0),
(1, 'stock_releasing', 1, 0),
(1, 'purchase_return', 1, 0),
(1, 'stocks_return', 1, 0),
(1, 'adjustment', 1, 0),
(1, 'stock_movement', 1, 0)
ON DUPLICATE KEY UPDATE `can_view` = VALUES(`can_view`), `can_manage` = VALUES(`can_manage`);

-- 3. Cleanly configure Role Permissions for Role 4 (Store Requester)
-- Store Requester creates, submits, edits, and tracks Purchase Requests.
-- Cannot approve Purchase Requests or modify inventory (no stock releasing / returns).
INSERT INTO `role_permissions` (`role_id`, `module`, `can_view`, `can_manage`) VALUES
(4, 'dashboard', 1, 0),
(4, 'purchase_request', 1, 1),
(4, 'request_approval', 0, 0),
(4, 'purchase_order', 0, 0),
(4, 'stock_receiving', 0, 0),
(4, 'stock_releasing', 0, 0),
(4, 'purchase_return', 0, 0),
(4, 'stocks_return', 0, 0),
(4, 'adjustment', 0, 0),
(4, 'stock_movement', 0, 0),
(4, 'product', 1, 0),
(4, 'category', 1, 0),
(4, 'supplier', 0, 0),
(4, 'product_supplier', 0, 0),
(4, 'users', 0, 0),
(4, 'role', 0, 0),
(4, 'audit_log', 0, 0),
(4, 'inventory_report', 1, 0)
ON DUPLICATE KEY UPDATE `can_view` = VALUES(`can_view`), `can_manage` = VALUES(`can_manage`);

-- 4. Cleanly configure Role Permissions for Role 2 (Warehouse Officer)
-- Receives and inspects deliveries, processes stock releases and adjustments, maintains records.
INSERT INTO `role_permissions` (`role_id`, `module`, `can_view`, `can_manage`) VALUES
(2, 'dashboard', 1, 0),
(2, 'stock_receiving', 1, 1),
(2, 'stock_releasing', 1, 1),
(2, 'purchase_return', 1, 1),
(2, 'stocks_return', 1, 1),
(2, 'adjustment', 1, 1),
(2, 'stock_movement', 1, 0),
(2, 'purchase_order', 1, 0),
(2, 'purchase_request', 1, 0),
(2, 'product', 1, 0),
(2, 'category', 1, 0),
(2, 'supplier', 1, 0),
(2, 'product_supplier', 0, 0),
(2, 'inventory_report', 1, 0),
(2, 'request_approval', 0, 0),
(2, 'users', 0, 0),
(2, 'role', 0, 0),
(2, 'audit_log', 0, 0)
ON DUPLICATE KEY UPDATE `can_view` = VALUES(`can_view`), `can_manage` = VALUES(`can_manage`);

-- 5. Cleanly configure Role Permissions for Role 19 (Manager)
-- Approves, rejects, returns PRs for revision. Cannot directly change inventory.
INSERT INTO `role_permissions` (`role_id`, `module`, `can_view`, `can_manage`) VALUES
(19, 'dashboard', 1, 0),
(19, 'request_approval', 1, 1),
(19, 'purchase_request', 1, 0),
(19, 'purchase_order', 1, 0),
(19, 'stock_movement', 1, 0),
(19, 'stock_receiving', 1, 0),
(19, 'product', 1, 0),
(19, 'category', 1, 0),
(19, 'supplier', 1, 0),
(19, 'inventory_report', 1, 0),
(19, 'stock_releasing', 0, 0),
(19, 'adjustment', 0, 0),
(19, 'purchase_return', 0, 0),
(19, 'stocks_return', 0, 0),
(19, 'product_supplier', 0, 0),
(19, 'users', 0, 0),
(19, 'role', 0, 0),
(19, 'audit_log', 0, 0)
ON DUPLICATE KEY UPDATE `can_view` = VALUES(`can_view`), `can_manage` = VALUES(`can_manage`);

-- 6. Cleanly configure Role Permissions for Role 3 (Purchasing Officer)
-- Processes approved PRs, creates POs, monitors deliveries and suppliers.
INSERT INTO `role_permissions` (`role_id`, `module`, `can_view`, `can_manage`) VALUES
(3, 'dashboard', 1, 0),
(3, 'purchase_order', 1, 1),
(3, 'supplier', 1, 1),
(3, 'product_supplier', 1, 1),
(3, 'purchase_return', 1, 1),
(3, 'purchase_request', 1, 0),
(3, 'stock_receiving', 1, 0),
(3, 'stock_movement', 1, 0),
(3, 'product', 1, 0),
(3, 'category', 1, 0),
(3, 'inventory_report', 1, 0),
(3, 'request_approval', 0, 0),
(3, 'stock_releasing', 0, 0),
(3, 'stocks_return', 0, 0),
(3, 'adjustment', 0, 0),
(3, 'users', 0, 0),
(3, 'role', 0, 0),
(3, 'audit_log', 0, 0)
ON DUPLICATE KEY UPDATE `can_view` = VALUES(`can_view`), `can_manage` = VALUES(`can_manage`);
