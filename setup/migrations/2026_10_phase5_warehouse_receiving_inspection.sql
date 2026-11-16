-- =============================================================================
-- Phase 5 Migration: Warehouse Receiving, Goods Receipt Notes (GRNs),
-- Goods Inspection, Partial Deliveries, Quarantined / Rejected Goods,
-- Stock Movement Records, and Usable Stock Isolation
-- =============================================================================

-- 1. Enhance stock_receiving header with GRN number and inspection lifecycle
ALTER TABLE `stock_receiving`
  ADD COLUMN IF NOT EXISTS `grn_number` VARCHAR(30) DEFAULT NULL AFTER `receiving_id`,
  ADD COLUMN IF NOT EXISTS `status` VARCHAR(40) NOT NULL DEFAULT 'Pending Inspection' AFTER `remarks`,
  ADD COLUMN IF NOT EXISTS `inspection_status` VARCHAR(40) NOT NULL DEFAULT 'Pending Inspection' AFTER `status`,
  ADD COLUMN IF NOT EXISTS `inspection_date` DATE DEFAULT NULL AFTER `inspection_status`,
  ADD COLUMN IF NOT EXISTS `inspected_by` INT(11) DEFAULT NULL AFTER `inspection_date`,
  ADD COLUMN IF NOT EXISTS `inspection_notes` TEXT DEFAULT NULL AFTER `inspected_by`,
  ADD COLUMN IF NOT EXISTS `posted_at` DATETIME DEFAULT NULL AFTER `inspection_notes`,
  ADD COLUMN IF NOT EXISTS `posted_by` INT(11) DEFAULT NULL AFTER `posted_at`;

-- 2. Backfill existing stock_receiving records as historically inspected and posted
UPDATE `stock_receiving`
SET
  `grn_number` = COALESCE(`grn_number`, CONCAT('GRN-', LPAD(`receiving_id`, 5, '0'))),
  `status` = 'Posted',
  `inspection_status` = CASE
    WHEN COALESCE((SELECT SUM(`quantity_damaged`) FROM `stock_receiving_detail` d WHERE d.`receiving_id` = `stock_receiving`.`receiving_id`), 0) > 0 THEN 'Partial'
    ELSE 'Passed'
  END,
  `inspection_date` = COALESCE(`inspection_date`, `receiving_date`),
  `inspected_by` = COALESCE(`inspected_by`, `user_id`),
  `posted_at` = COALESCE(`posted_at`, `created_at`),
  `posted_by` = COALESCE(`posted_by`, `user_id`);

ALTER TABLE `stock_receiving`
  ADD UNIQUE INDEX IF NOT EXISTS `uq_sr_grn_number` (`grn_number`);

-- 3. Enhance stock_receiving_detail with inspection breakdown quantities and reasons
ALTER TABLE `stock_receiving_detail`
  ADD COLUMN IF NOT EXISTS `quantity_accepted` INT(11) NOT NULL DEFAULT 0 AFTER `quantity_received`,
  ADD COLUMN IF NOT EXISTS `quantity_rejected` INT(11) NOT NULL DEFAULT 0 AFTER `quantity_accepted`,
  ADD COLUMN IF NOT EXISTS `quantity_quarantined` INT(11) NOT NULL DEFAULT 0 AFTER `quantity_rejected`,
  ADD COLUMN IF NOT EXISTS `rejection_reason` VARCHAR(255) DEFAULT NULL AFTER `discrepancy_note`,
  ADD COLUMN IF NOT EXISTS `quarantine_reason` VARCHAR(255) DEFAULT NULL AFTER `rejection_reason`,
  ADD COLUMN IF NOT EXISTS `inspection_status` VARCHAR(40) NOT NULL DEFAULT 'Pending' AFTER `quarantine_reason`;

-- 4. Backfill existing stock_receiving_detail rows
UPDATE `stock_receiving_detail`
SET
  `quantity_accepted` = `quantity_received`,
  `quantity_rejected` = COALESCE(`quantity_damaged`, 0),
  `quantity_quarantined` = 0,
  `inspection_status` = CASE
    WHEN COALESCE(`quantity_damaged`, 0) > 0 THEN 'Partial'
    ELSE 'Passed'
  END;

-- 5. Physical stock movement ledger table
CREATE TABLE IF NOT EXISTS `stock_movement` (
  `movement_id` INT(11) NOT NULL AUTO_INCREMENT,
  `product_id` INT(11) NOT NULL,
  `movement_type` VARCHAR(50) NOT NULL,
  `direction` ENUM('IN','OUT') NOT NULL,
  `quantity` INT(11) NOT NULL,
  `reference_no` VARCHAR(50) DEFAULT NULL,
  `reference_type` VARCHAR(50) DEFAULT NULL,
  `reference_id` INT(11) DEFAULT NULL,
  `user_id` INT(11) DEFAULT NULL,
  `movement_date` DATE NOT NULL,
  `notes` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`movement_id`),
  KEY `idx_sm_product` (`product_id`),
  KEY `idx_sm_ref` (`reference_type`, `reference_id`),
  KEY `idx_sm_date` (`movement_date`),
  CONSTRAINT `fk_sm_product` FOREIGN KEY (`product_id`) REFERENCES `product` (`product_id`),
  CONSTRAINT `fk_sm_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
