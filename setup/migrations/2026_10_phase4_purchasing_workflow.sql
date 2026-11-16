-- =============================================================================
-- Phase 4 Migration: Purchasing Officer Workflow, Approved PR Queue,
-- Linked & Independent Purchase Orders, Separate Status Dimensions,
-- and Supplier Management Permissions
-- =============================================================================

-- 1. Add Phase 4 tracking and status dimension columns to purchase_order
ALTER TABLE `purchase_order`
  ADD COLUMN IF NOT EXISTS `po_code` VARCHAR(30) DEFAULT NULL AFTER `po_id`,
  ADD COLUMN IF NOT EXISTS `po_source` VARCHAR(30) NOT NULL DEFAULT 'PR-Linked' AFTER `po_type`,
  ADD COLUMN IF NOT EXISTS `order_status` VARCHAR(40) NOT NULL DEFAULT 'Issued' AFTER `status`,
  ADD COLUMN IF NOT EXISTS `receiving_status` VARCHAR(40) NOT NULL DEFAULT 'Awaiting Delivery' AFTER `order_status`,
  ADD COLUMN IF NOT EXISTS `inspection_status` VARCHAR(40) NOT NULL DEFAULT 'Pending Delivery' AFTER `receiving_status`,
  ADD COLUMN IF NOT EXISTS `authorization_status` VARCHAR(40) NOT NULL DEFAULT 'Authorized' AFTER `inspection_status`,
  ADD COLUMN IF NOT EXISTS `notes` VARCHAR(500) DEFAULT NULL AFTER `manager_notes`,
  ADD COLUMN IF NOT EXISTS `client_token` VARCHAR(64) DEFAULT NULL AFTER `closed_reason`,
  ADD UNIQUE INDEX IF NOT EXISTS `uq_po_client_token` (`client_token`);

-- 2. Add pr_id to purchase_order_detail so a single PO can reference lines from one or multiple approved PRs
ALTER TABLE `purchase_order_detail`
  ADD COLUMN IF NOT EXISTS `pr_id` INT(11) DEFAULT NULL AFTER `po_id`;

-- 3. Backfill po_code, po_source, and separate status dimensions on existing purchase_order rows
UPDATE `purchase_order`
SET
  `po_code` = COALESCE(`po_code`, CONCAT('PO-', LPAD(`po_id`, 5, '0'))),
  `po_source` = CASE
    WHEN `pr_id` IS NULL OR `po_type` IN ('Independent', 'independent', 'warehouse_replenishment') THEN 'Independent'
    ELSE 'PR-Linked'
  END,
  `order_status` = CASE
    WHEN `status` = 'Draft' THEN 'Draft'
    WHEN `status` IN ('Pending Approval', 'Pending PO Approval') THEN 'Pending PO Approval'
    WHEN `status` IN ('Ordered', 'Issued') THEN 'Issued'
    WHEN `status` = 'Partially Received' THEN 'Partially Received'
    WHEN `status` IN ('Received', 'Fully Received') THEN 'Fully Received'
    WHEN `status` = 'On Hold' THEN 'On Hold'
    WHEN `status` = 'Cancelled' THEN 'Cancelled'
    WHEN `status` IN ('Closed', 'Closed Short') THEN 'Closed'
    ELSE 'Issued'
  END,
  `authorization_status` = CASE
    WHEN `status` = 'Draft' THEN 'Draft'
    WHEN `status` IN ('Pending Approval', 'Pending PO Approval') THEN 'Pending Approval'
    WHEN `status` = 'Cancelled' AND `approved_by` IS NULL AND `po_type` IN ('Independent', 'independent', 'warehouse_replenishment') THEN 'Rejected'
    ELSE 'Authorized'
  END,
  `receiving_status` = CASE
    WHEN `status` IN ('Draft', 'Pending Approval', 'Pending PO Approval', 'On Hold') THEN 'Not Ready'
    WHEN `status` IN ('Ordered', 'Issued') THEN 'Awaiting Delivery'
    WHEN `status` = 'Partially Received' THEN 'Partially Received'
    WHEN `status` IN ('Received', 'Fully Received') THEN 'Fully Received'
    WHEN `status` IN ('Closed', 'Closed Short') THEN 'Closed Short'
    WHEN `status` = 'Cancelled' THEN 'Cancelled'
    ELSE 'Awaiting Delivery'
  END;

-- 4. Backfill pr_id on purchase_order_detail from header pr_id or purchase_request_detail
UPDATE `purchase_order_detail` pod
INNER JOIN `purchase_order` po ON pod.`po_id` = po.`po_id`
LEFT JOIN `purchase_request_detail` prd ON pod.`pr_detail_id` = prd.`pr_detail_id`
SET pod.`pr_id` = COALESCE(pod.`pr_id`, prd.`pr_id`, po.`pr_id`)
WHERE pod.`pr_id` IS NULL AND (prd.`pr_id` IS NOT NULL OR po.`pr_id` IS NOT NULL);

-- 5. Ensure Purchasing Officer (role_id = 3) and Admin (role_id = 1) have supplier and product_supplier management permissions
INSERT INTO `role_permissions` (`role_id`, `module`, `can_view`, `can_manage`)
VALUES
  (1, 'supplier', 1, 1),
  (1, 'product_supplier', 1, 1),
  (3, 'supplier', 1, 1),
  (3, 'product_supplier', 1, 1),
  (3, 'purchase_order', 1, 1),
  (3, 'purchase_request', 1, 0)
ON DUPLICATE KEY UPDATE
  `can_view` = VALUES(`can_view`),
  `can_manage` = VALUES(`can_manage`);
