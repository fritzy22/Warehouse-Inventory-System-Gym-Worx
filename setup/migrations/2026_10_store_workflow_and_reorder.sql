-- GymWorx Warehouse Management System
-- Additive Schema Migration: Store Inventory, Direct PO Replenishment, and Return Traceability
-- Author: Senior Full-Stack Developer & Database Engineer
-- Date: 2026-10-24

CREATE TABLE IF NOT EXISTS `store_inventory` (
  `store_inventory_id` int(11) NOT NULL AUTO_INCREMENT,
  `store_name` varchar(100) NOT NULL,
  `product_id` int(11) NOT NULL,
  `quantity` int(11) NOT NULL DEFAULT 0,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`store_inventory_id`),
  UNIQUE KEY `uq_store_product` (`store_name`, `product_id`),
  KEY `idx_store_product` (`product_id`),
  CONSTRAINT `fk_store_inv_product` FOREIGN KEY (`product_id`) REFERENCES `product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `purchase_request`
  ADD COLUMN IF NOT EXISTS `store_name` varchar(100) DEFAULT 'Main Store' AFTER `requester_id`,
  ADD COLUMN IF NOT EXISTS `fulfillment_type` varchar(30) DEFAULT 'unassigned' AFTER `status`,
  ADD COLUMN IF NOT EXISTS `releasing_id` int(11) DEFAULT NULL AFTER `completed_at`;

ALTER TABLE `purchase_order`
  ADD COLUMN IF NOT EXISTS `po_type` varchar(30) NOT NULL DEFAULT 'pr_replenishment' AFTER `pr_id`,
  ADD COLUMN IF NOT EXISTS `approved_by` int(11) DEFAULT NULL AFTER `confirmed_at`,
  ADD COLUMN IF NOT EXISTS `approved_at` datetime DEFAULT NULL AFTER `approved_by`,
  ADD COLUMN IF NOT EXISTS `manager_notes` varchar(500) DEFAULT NULL AFTER `approved_at`;

ALTER TABLE `stock_releasing`
  ADD COLUMN IF NOT EXISTS `pr_id` int(11) DEFAULT NULL AFTER `releasing_id`,
  ADD COLUMN IF NOT EXISTS `destination_store` varchar(100) DEFAULT NULL AFTER `requested_by`;

ALTER TABLE `purchase_return`
  ADD COLUMN IF NOT EXISTS `po_id` int(11) DEFAULT NULL AFTER `supplier_id`,
  ADD COLUMN IF NOT EXISTS `receiving_id` int(11) DEFAULT NULL AFTER `po_id`;

-- Allow Manager role (role_id = 19) to view purchase orders for approval queue review
UPDATE `role_permissions` SET `can_view` = 1 WHERE `role_id` = 19 AND `module` = 'purchase_order';
