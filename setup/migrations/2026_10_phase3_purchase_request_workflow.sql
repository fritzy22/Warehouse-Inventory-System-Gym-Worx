-- GymWorx Warehouse Management System
-- Phase 3 Safe Additive Migration: Purchase Request Workflow, Separate Approval & Fulfillment Statuses, Purpose/Urgency/Remarks, and Idempotency
-- Date: 2026-10-27

ALTER TABLE `purchase_request`
  ADD COLUMN IF NOT EXISTS `pr_code` varchar(30) DEFAULT NULL AFTER `pr_id`,
  ADD COLUMN IF NOT EXISTS `purpose` varchar(255) DEFAULT NULL AFTER `store_name`,
  ADD COLUMN IF NOT EXISTS `urgency` varchar(30) NOT NULL DEFAULT 'Normal' AFTER `purpose`,
  ADD COLUMN IF NOT EXISTS `approval_status` varchar(40) NOT NULL DEFAULT 'Pending Approval' AFTER `status`,
  ADD COLUMN IF NOT EXISTS `fulfillment_status` varchar(40) NOT NULL DEFAULT 'Awaiting Approval' AFTER `approval_status`,
  ADD COLUMN IF NOT EXISTS `remarks` varchar(500) DEFAULT NULL AFTER `reason`,
  ADD COLUMN IF NOT EXISTS `client_token` varchar(64) DEFAULT NULL AFTER `releasing_id`,
  ADD UNIQUE INDEX IF NOT EXISTS `uq_pr_code` (`pr_code`),
  ADD UNIQUE INDEX IF NOT EXISTS `uq_pr_client_token` (`client_token`);

-- Backfill unique PR reference numbers and separate approval/fulfillment statuses on existing records
UPDATE `purchase_request`
SET
  `pr_code` = CASE
    WHEN `status` = 'Draft' THEN COALESCE(`pr_code`, CONCAT('DRAFT-', LPAD(`pr_id`, 4, '0')))
    ELSE COALESCE(`pr_code`, CONCAT('PR-', LPAD(`pr_id`, 4, '0')))
  END,
  `purpose` = COALESCE(NULLIF(TRIM(`purpose`), ''), NULLIF(TRIM(`reason`), ''), 'Store Inventory Replenishment'),
  `urgency` = COALESCE(NULLIF(TRIM(`urgency`), ''), 'Normal'),
  `remarks` = COALESCE(NULLIF(TRIM(`remarks`), ''), NULLIF(TRIM(`reason`), '')),
  `approval_status` = CASE
    WHEN `status` = 'Draft' THEN 'Draft'
    WHEN `status` IN ('Pending', 'Pending Approval') THEN 'Pending Approval'
    WHEN `status` IN ('For Revision', 'Returned for Revision') THEN 'Returned for Revision'
    WHEN `status` IN ('Approved', 'Partially Ordered', 'Ordered', 'Partially Received', 'Completed') THEN 'Approved'
    WHEN `status` = 'Rejected' THEN 'Rejected'
    WHEN `status` = 'Cancelled' THEN 'Cancelled'
    ELSE 'Pending Approval'
  END,
  `fulfillment_status` = CASE
    WHEN `status` = 'Draft' THEN 'Draft'
    WHEN `status` IN ('Pending', 'Pending Approval') THEN 'Awaiting Approval'
    WHEN `status` IN ('For Revision', 'Returned for Revision') THEN 'Awaiting Revision'
    WHEN `status` = 'Approved' THEN 'Pending Fulfillment'
    WHEN `status` IN ('Partially Ordered', 'Ordered') THEN 'On Order'
    WHEN `status` = 'Partially Received' THEN 'Partially Fulfilled'
    WHEN `status` = 'Completed' THEN 'Fulfilled'
    WHEN `status` = 'Rejected' THEN 'Not Fulfilled'
    WHEN `status` = 'Cancelled' THEN 'Cancelled'
    ELSE 'Unfulfilled'
  END;
