-- GymWorx Warehouse Management System
-- Phase 2 Safe Additive Migration: Stock Reservations, Adjustment Idempotency, and Quarantined Return Tracking
-- Date: 2026-10-27

CREATE TABLE IF NOT EXISTS `stock_reservation` (
  `reservation_id` int(11) NOT NULL AUTO_INCREMENT,
  `product_id` int(11) NOT NULL,
  `pr_id` int(11) DEFAULT NULL,
  `reserved_qty` int(11) NOT NULL DEFAULT 0,
  `status` varchar(20) NOT NULL DEFAULT 'Active',
  `notes` varchar(255) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`reservation_id`),
  KEY `idx_res_product_status` (`product_id`, `status`),
  KEY `idx_res_pr` (`pr_id`),
  CONSTRAINT `fk_res_product` FOREIGN KEY (`product_id`) REFERENCES `product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `adjustment_detail`
  ADD COLUMN IF NOT EXISTS `client_token` varchar(64) DEFAULT NULL AFTER `reason`,
  ADD UNIQUE INDEX IF NOT EXISTS `uq_adjd_client_token` (`client_token`);

ALTER TABLE `stocks_return_detail`
  ADD COLUMN IF NOT EXISTS `condition_status` varchar(20) NOT NULL DEFAULT 'Usable' AFTER `quantity_returned`;

-- Backfill missing metadata on legacy seed stock adjustments without altering historical stock balances
UPDATE `adjustment_detail`
SET
  `user_id` = COALESCE(`user_id`, 33),
  `adjustment_date` = COALESCE(`adjustment_date`, DATE(`created_at`)),
  `reason` = CASE
    WHEN `reason` IS NULL OR TRIM(`reason`) = '' THEN 'Initial Stock Adjustment'
    ELSE `reason`
  END
WHERE `user_id` IS NULL OR `adjustment_date` IS NULL OR `reason` IS NULL OR TRIM(`reason`) = '';
