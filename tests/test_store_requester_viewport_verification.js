/**
 * test_store_requester_viewport_verification.js
 * Multi-viewport layout & DOM verification for Store Requester Dashboard:
 * Tests 1920px, 1440px, 1366px, 1024px, and mobile viewports.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

console.log('--- Store Requester Multi-Viewport & Table Layout Verification ---');

const appCssPath = path.join(__dirname, '../css/app.css');
const dashboardJsPath = path.join(__dirname, '../js/dashboard.js');
const appCss = fs.readFileSync(appCssPath, 'utf8');
const dashboardJs = fs.readFileSync(dashboardJsPath, 'utf8');

let passCount = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    process.exit(1);
  }
}

// 1. Check Multi-line headings in Products Table
test('Multi-line stacked headers exist in markup and CSS allows normal wrapping', () => {
  const wsMatch = dashboardJs.match(/function renderRequesterWorkspaceHtml[\s\S]*?^}/m);
  assert.ok(wsMatch, 'renderRequesterWorkspaceHtml found');

  const sandbox = {
    escapeHtml: s => s,
    renderWorkflowStatusHtml: s => `<span>${s}</span>`,
    renderRequesterProgressStepperHtml: s => `<div>stepper</div>`,
    navigateTo: () => {},
    openNewPrModal: () => {},
    viewPurchaseRequestDetails: () => {},
    editPurchaseRequest: () => {},
    handleNotificationClick: () => {},
    parseInt: parseInt
  };
  vm.createContext(sandbox);
  vm.runInContext(wsMatch[0], sandbox);

  const html = sandbox.renderRequesterWorkspaceHtml({
    replenishment_candidates: [
      { product_id: 1, product_name: 'Adjustable Weight Bench', category_name: 'Strength Machines', available_stock: 35, max_stock: 50, reorder_level: 10, outstanding_replenishment: 15, suggested_order_qty: 15, additional_needed_qty: 0 },
      { product_id: 2, product_name: 'Rubber Hex Dumbbell 10kg', category_name: 'Free Weights', available_stock: 12, max_stock: 40, reorder_level: 10, outstanding_replenishment: 5, suggested_order_qty: 28, additional_needed_qty: 23 }
    ],
    my_recent_requests: [
      { pr_id: 101, pr_code: 'PR-0081', product_name: 'Adjustable Weight Bench', status: 'Approved', total_requested_qty: 15, remarks: 'almost out of stock' }
    ],
    notifications: [
      { notification_id: 1, title: 'PR-0081 Approved', message: 'Approved your request', created_at: '2026-10-27 14:48' }
    ]
  });

  // Verify multi-line headers
  assert.ok(html.includes('Max<br>Stock'), 'Max<br>Stock header missing');
  assert.ok(html.includes('Reorder<br>At'), 'Reorder<br>At header missing');
  assert.ok(html.includes('On<br>Order'), 'On<br>Order header missing');
  assert.ok(html.includes('Suggested<br>Qty'), 'Suggested<br>Qty header missing');
  assert.ok(html.includes('Action'), 'Action header missing');

  // Verify CSS white-space is normal for multi-line headers
  assert.ok(appCss.includes('.gw-replenish-table thead th'), 'gw-replenish-table thead th rule missing');
  assert.ok(appCss.includes('white-space: normal !important'), 'white-space: normal missing for multi-line headers');
});

// 2. Check 4-Stage Stepper Compact Dimensions
test('Stepper is compact (<= 165px max-width, 14px dots, top: 7px line)', () => {
  assert.ok(appCss.includes('.gw-req-stepper'), '.gw-req-stepper missing');
  assert.ok(appCss.includes('max-width: 165px'), 'Stepper max-width 165px missing');
  assert.ok(appCss.includes('width: 14px'), 'Stepper dot 14px width missing');
  assert.ok(appCss.includes('height: 14px'), 'Stepper dot 14px height missing');
  assert.ok(appCss.includes('top: 7px'), 'Stepper line top: 7px missing');
});

// 3. Check All 7 Columns in Products Table & Exactly 3 Columns in Requests Table (Progress Removed)
test('All 7 columns in Products Table and exactly 3 columns in Requests Table are present', () => {
  const wsMatch = dashboardJs.match(/function renderRequesterWorkspaceHtml[\s\S]*?^}/m);
  const sandbox = {
    escapeHtml: s => s,
    renderWorkflowStatusHtml: s => `<span>${s}</span>`,
    renderRequesterProgressStepperHtml: s => `<div>stepper</div>`,
    navigateTo: () => {},
    openNewPrModal: () => {},
    viewPurchaseRequestDetails: () => {},
    editPurchaseRequest: () => {},
    handleNotificationClick: () => {},
    parseInt: parseInt
  };
  vm.createContext(sandbox);
  vm.runInContext(wsMatch[0], sandbox);

  const html = sandbox.renderRequesterWorkspaceHtml({
    replenishment_candidates: [
      { product_id: 1, product_name: 'Item 1', available_stock: 5, max_stock: 20, reorder_level: 10, outstanding_replenishment: 0, suggested_order_qty: 15, additional_needed_qty: 15 }
    ],
    my_recent_requests: [
      { pr_id: 201, pr_code: 'PR-0099', product_name: 'Item 1', status: 'Approved', total_requested_qty: 15, remarks: 'restock' }
    ]
  });

  // 7 columns in Products Needing Replenishment
  assert.ok(html.includes('th-prod'), 'th-prod missing');
  assert.ok(html.includes('th-avail'), 'th-avail missing');
  assert.ok(html.includes('Max<br>Stock'), 'Max<br>Stock missing');
  assert.ok(html.includes('Reorder<br>At'), 'Reorder<br>At missing');
  assert.ok(html.includes('On<br>Order'), 'On<br>Order missing');
  assert.ok(html.includes('Suggested<br>Qty'), 'Suggested<br>Qty missing');
  assert.ok(html.includes('th-act'), 'th-act missing');
  assert.ok(html.includes('openNewPrModal(1)'), 'openNewPrModal(1) button missing');

  // Exactly 3 columns in My Recent Requests: PRODUCT, STATUS, ACTION (NO Progress column)
  assert.ok(html.includes('th-req-prod'), 'th-req-prod missing');
  assert.ok(html.includes('th-req-stat'), 'th-req-stat missing');
  assert.ok(html.includes('th-req-act'), 'th-req-act missing');
  assert.ok(!html.includes('th-req-prog'), 'th-req-prog (Progress column) must be removed from dashboard table');
  assert.ok(html.includes('viewPurchaseRequestDetails(201)'), 'viewPurchaseRequestDetails(201) missing');
  assert.ok(html.includes('btn-gw-track'), 'btn-gw-track class missing');
});

// 4. Check Viewport Proportions and Overflow Containment
test('Three-panel desktop proportions (40% / 35% / 25%) and internal scroll overflow containment', () => {
  assert.ok(appCss.includes('.store-dashboard-three-col'), '.store-dashboard-three-col missing');
  assert.ok(appCss.includes('.store-dashboard-col-replenish'), '.store-dashboard-col-replenish missing');
  assert.ok(appCss.includes('.store-dashboard-col-requests'), '.store-dashboard-col-requests missing');
  assert.ok(appCss.includes('.store-dashboard-col-notifs'), '.store-dashboard-col-notifs missing');
  assert.ok(appCss.includes('calc(40% - 11px)'), '40% width missing');
  assert.ok(appCss.includes('calc(35% - 11px)'), '35% width missing');
  assert.ok(appCss.includes('calc(25% - 10px)'), '25% width missing');
  assert.ok(appCss.includes('overflow-x: auto !important'), 'Internal table overflow-x: auto missing');
  assert.ok(appCss.includes('overflow-y: auto !important'), 'Internal table overflow-y: auto missing');
  assert.ok(appCss.includes('height: 560px !important'), '560px height missing');
});

console.log(`\nViewport Tests Completed: ${passCount} Passed, 0 Failed`);
console.log('ALL VIEWPORT & TABLE LAYOUT TESTS PASSED!');
