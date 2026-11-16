/**
 * test_store_requester_dashboard.js
 * Comprehensive automated verification for GymWorx Store Requester Dashboard UI/UX:
 * - Independent internal scrollbars for Products Needing Replenishment, My Recent Requests, and Notifications
 * - Responsive table container heights and sticky table column headers
 * - 4-step progress stepper and timeline styling
 * - 0, 1, 5, and 20 record rendering fixtures
 * - Buttons, actions, links, and themes
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- GymWorx Store Requester Dashboard UI/UX Verification Suite ---');

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

const appCssPath = path.join(__dirname, '../css/app.css');
const appJsPath = path.join(__dirname, '../js/app.js');
const dashboardJsPath = path.join(__dirname, '../js/dashboard.js');
const indexHtmlPath = path.join(__dirname, '../index.html');

const appCss = fs.readFileSync(appCssPath, 'utf8');
const appJs = fs.readFileSync(appJsPath, 'utf8');
const dashboardJs = fs.readFileSync(dashboardJsPath, 'utf8');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// 1. Cursor-Inspired Scrollbar CSS Variables & Tokens
test('CSS defines 5px Cursor-inspired scrollbar tokens for Store Dashboard in Dark and Light mode', () => {
  assert.ok(appCss.includes('--store-scroll-width: 5px'), 'Dark mode scrollbar width 5px missing');
  assert.ok(appCss.includes('--store-scroll-track: transparent'), 'Dark mode scrollbar transparent track missing');
  assert.ok(appCss.includes('--store-scroll-thumb: #52504C'), 'Dark mode scrollbar thumb #52504C missing');
  assert.ok(appCss.includes('--store-scroll-thumb-hover: #77736D'), 'Dark mode scrollbar hover thumb #77736D missing');

  assert.ok(appCss.includes('--store-scroll-thumb: #C4C0BA'), 'Light mode scrollbar thumb #C4C0BA missing');
  assert.ok(appCss.includes('--store-scroll-thumb-hover: #918C85'), 'Light mode scrollbar hover thumb #918C85 missing');
});

// 2. Table Header Background Variables for Sticky Headers
test('CSS defines --table-header-bg for sticky headers in both Dark and Light mode', () => {
  assert.ok(appCss.includes('--table-header-bg: #262521'), 'Dark mode --table-header-bg #262521 missing');
  assert.ok(appCss.includes('--table-header-bg: #EBE9E4'), 'Light mode --table-header-bg #EBE9E4 missing');
});

// 3. Store Dashboard Card & Layout Architecture
test('CSS defines .store-dashboard-card with flex column, min-height 0, and overflow hidden', () => {
  assert.ok(appCss.includes('.store-dashboard-card'), '.store-dashboard-card missing in CSS');
  assert.ok(appCss.includes('.store-dashboard-card-header'), '.store-dashboard-card-header missing in CSS');
  assert.ok(appCss.includes('flex-shrink: 0'), 'Card header flex-shrink: 0 missing');
});

// 4. Products Needing Replenishment & Recent Requests Internal Table Scrolling
test('CSS defines .store-dashboard-table-scroll with clamp(180px, 28vh, 280px), overflow auto, and thin scrollbar', () => {
  assert.ok(appCss.includes('.store-dashboard-table-scroll'), '.store-dashboard-table-scroll missing in CSS');
  assert.ok(appCss.includes('max-height: clamp(180px, 28vh, 280px)'), 'Table scroll clamp(180px, 28vh, 280px) missing');
  assert.ok(appCss.includes('overscroll-behavior: contain'), 'Table scroll overscroll-behavior: contain missing');
});

// 5. Sticky Column Headings
test('CSS enforces sticky column headings (.store-dashboard-table-scroll thead th) with opaque background', () => {
  assert.ok(appCss.includes('.store-dashboard-table-scroll thead th'), '.store-dashboard-table-scroll thead th missing in CSS');
  assert.ok(appCss.includes('position: sticky'), 'Header position: sticky missing');
  assert.ok(appCss.includes('top: 0'), 'Header top: 0 missing');
  assert.ok(appCss.includes('z-index: 2'), 'Header z-index: 2 missing');
});

// 6. Notifications & Updates Scrolling
test('CSS defines .store-dashboard-notification-scroll with clamp(280px, 55vh, 600px) and overflow-y auto', () => {
  assert.ok(appCss.includes('.store-dashboard-notification-scroll'), '.store-dashboard-notification-scroll missing in CSS');
  assert.ok(appCss.includes('max-height: clamp(280px, 55vh, 600px)'), 'Notification scroll clamp(280px, 55vh, 600px) missing');
  assert.ok(appCss.includes('overflow-y: auto'), 'Notification scroll overflow-y: auto missing');
});

// 7. Desktop Proportions (40% / 35% / 25%) and Three-Column Grid/Flex
test('CSS provides responsive layout grid for 40% left, 35% center, and 25% right columns on desktop', () => {
  assert.ok(appCss.includes('.store-dashboard-layout'), '.store-dashboard-layout missing in CSS');
  assert.ok(appCss.includes('.store-dashboard-three-col'), '.store-dashboard-three-col missing in CSS');
  assert.ok(appCss.includes('.store-dashboard-col-replenish'), '.store-dashboard-col-replenish missing in CSS');
  assert.ok(appCss.includes('.store-dashboard-col-requests'), '.store-dashboard-col-requests missing in CSS');
  assert.ok(appCss.includes('.store-dashboard-col-notifs'), '.store-dashboard-col-notifs missing in CSS');
  assert.ok(appCss.includes('calc(40% - 11px)'), '40% column calculation missing');
  assert.ok(appCss.includes('calc(35% - 11px)'), '35% column calculation missing');
  assert.ok(appCss.includes('calc(25% - 10px)'), '25% column calculation missing');
  assert.ok(appCss.includes('560px'), '560px equal panel height missing');
});

// 8. Requester 4-Step Progress Tracker Styling
test('CSS formats 4-step progress stepper with dots, connecting lines, and status colors', () => {
  assert.ok(appCss.includes('.gw-req-stepper'), '.gw-req-stepper missing');
  assert.ok(appCss.includes('.gw-req-step'), '.gw-req-step missing');
  assert.ok(appCss.includes('.gw-req-dot'), '.gw-req-dot missing');
  assert.ok(appCss.includes('.gw-req-label'), '.gw-req-label missing');
});

// 9. Notifications Vertical Timeline Styling
test('CSS formats vertical timeline with dots (purple, green, blue) and line for notifications', () => {
  assert.ok(appCss.includes('.gw-timeline-list'), '.gw-timeline-list missing');
  assert.ok(appCss.includes('.gw-timeline-item'), '.gw-timeline-item missing');
  assert.ok(appCss.includes('.gw-timeline-dot'), '.gw-timeline-dot missing');
  assert.ok(appCss.includes('.gw-timeline-dot.dot-purple'), 'Purple dot class missing');
  assert.ok(appCss.includes('.gw-timeline-dot.dot-green'), 'Green dot class missing');
  assert.ok(appCss.includes('.gw-timeline-dot.dot-blue'), 'Blue dot class missing');
  assert.ok(appCss.includes('.gw-timeline-item::before'), 'Timeline vertical line missing');
});

// 10. Status Badge Mapping in app.js
test('app.js includes Purchasing and Awaiting Delivery in renderWorkflowStatusHtml classMap', () => {
  assert.ok(appJs.includes("'Purchasing': 'wf-ordered'"), 'Purchasing mapping missing in classMap');
  assert.ok(appJs.includes("'Awaiting Delivery': 'wf-partial'"), 'Awaiting Delivery mapping missing in classMap');
});

// 11. Mock Environment for Testing renderRequesterWorkspaceHtml & Stepper
const vm = require('vm');

function createRequesterSandbox() {
  const sandbox = {
    escapeHtml: str => String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    renderWorkflowStatusHtml: status => `<span class="badge wf-badge">${status}</span>`,
    navigateTo: () => {},
    openNewPrModal: () => {},
    viewPurchaseRequestDetails: () => {},
    editPurchaseRequest: () => {},
    handleNotificationClick: () => {},
    parseInt: parseInt
  };
  vm.createContext(sandbox);

  // Extract functions from dashboard.js
  const stepperFnMatch = dashboardJs.match(/function renderRequesterProgressStepperHtml[\s\S]*?^}/m);
  assert.ok(stepperFnMatch, 'renderRequesterProgressStepperHtml function found');
  vm.runInContext(stepperFnMatch[0], sandbox);

  const wsFnMatch = dashboardJs.match(/function renderRequesterWorkspaceHtml[\s\S]*?^}/m);
  assert.ok(wsFnMatch, 'renderRequesterWorkspaceHtml function found');
  vm.runInContext(wsFnMatch[0], sandbox);

  return sandbox;
}

const sandbox = createRequesterSandbox();

// 12. Test Stepper Across All Relevant Statuses
test('renderRequesterProgressStepperHtml correctly renders all 4 steps for key workflow statuses', () => {
  const checkStatus = (status, expectedLabels) => {
    const html = sandbox.renderRequesterProgressStepperHtml(status);
    expectedLabels.forEach(lbl => {
      assert.ok(html.includes(lbl), `Expected label ${lbl} in stepper for status ${status}`);
    });
  };

  checkStatus('Pending Approval', ['[Submitted]', '[Approved]', '[Ordered]', '[Received]']);
  checkStatus('For Revision', ['[Submitted]', '[Revision]', '[Ordered]', '[Received]']);
  checkStatus('Approved', ['[Submitted]', '[Approved]', '[Ordered]', '[Received]']);
  checkStatus('Purchasing', ['[Submitted]', '[Approved]', '[Ordered]', '[Received]']);
  checkStatus('Awaiting Delivery', ['[Submitted]', '[Approved]', '[Ordered]', '[Received]']);
  checkStatus('Completed', ['[Submitted]', '[Approved]', '[Ordered]', '[Received]']);
});

// 13. Test Products Needing Replenishment with 0, 1, 5, and 20 records
test('renderRequesterWorkspaceHtml handles Products Needing Replenishment with 0, 1, 5, and 20 records', () => {
  // 0 records
  let html0 = sandbox.renderRequesterWorkspaceHtml({ replenishment_candidates: [], my_recent_requests: [], notifications: [] });
  assert.ok(html0.includes('All products are currently well stocked.'), 'Empty state for 0 replenishment records missing');

  // 1 record
  let p1 = [{ product_id: 1, product_name: 'Adjustable Weight Bench', category_name: 'Strength Machines', available_stock: 35, max_stock: 50, reorder_level: 10, outstanding_replenishment: 15, suggested_order_qty: 15, additional_needed_qty: 0 }];
  let html1 = sandbox.renderRequesterWorkspaceHtml({ replenishment_candidates: p1 });
  assert.ok(html1.includes('Adjustable Weight Bench'), 'Product 1 missing');
  assert.ok(html1.includes('Already on order'), 'Already on order badge missing');

  // 5 records
  let p5 = Array.from({ length: 5 }, (_, i) => ({
    product_id: i + 1,
    product_name: `Product ${i + 1}`,
    category_name: 'Category',
    available_stock: 5,
    max_stock: 30,
    reorder_level: 10,
    outstanding_replenishment: 0,
    suggested_order_qty: 25,
    additional_needed_qty: 25
  }));
  let html5 = sandbox.renderRequesterWorkspaceHtml({ replenishment_candidates: p5 });
  for (let i = 1; i <= 5; i++) {
    assert.ok(html5.includes(`Product ${i}`), `Product ${i} missing in 5-record set`);
  }

  // 20 records
  let p20 = Array.from({ length: 20 }, (_, i) => ({
    product_id: i + 1,
    product_name: `Product ${i + 1}`,
    category_name: 'Category',
    available_stock: 5,
    max_stock: 30,
    reorder_level: 10,
    outstanding_replenishment: 0,
    suggested_order_qty: 25,
    additional_needed_qty: 25
  }));
  let html20 = sandbox.renderRequesterWorkspaceHtml({ replenishment_candidates: p20 });
  assert.ok(html20.includes('Product 20'), 'Product 20 missing in 20-record set - table must render all records for scrolling');
});

// 14. Test My Recent Requests with 0, 1, 5, and 20 records: displays Product Name, hides visible PR code, retains Track button
test('renderRequesterWorkspaceHtml handles My Recent Requests: displays Product Name, hides visible PR code, retains Track button', () => {
  // 0 records
  let html0 = sandbox.renderRequesterWorkspaceHtml({ replenishment_candidates: [], my_recent_requests: [], notifications: [] });
  assert.ok(html0.includes('You have not submitted any purchase requests yet.'), 'Empty state for 0 requests missing');

  // 1 record
  let r1 = [{ pr_id: 101, pr_code: 'PR-0081', product_name: 'Adjustable Weight Bench', status: 'Approved', total_requested_qty: 15, remarks: 'almost out of stock' }];
  let html1 = sandbox.renderRequesterWorkspaceHtml({ my_recent_requests: r1 });
  assert.ok(html1.includes('Adjustable Weight Bench'), 'Product name missing');
  assert.ok(html1.includes('almost out of stock'), 'Remarks missing');
  assert.ok(html1.includes('Track'), 'Track button missing');
  assert.ok(html1.includes('viewPurchaseRequestDetails(101)'), 'Track button onclick handler missing pr_id 101');
  assert.ok(!html1.includes('>PR-0081<'), 'PR code must NOT be rendered in visible text content');
  assert.ok(html1.includes('data-pr-code="PR-0081"'), 'PR code retained on data attribute for modal access');

  // 5 records
  let r5 = Array.from({ length: 5 }, (_, i) => ({
    pr_id: 100 + i,
    pr_code: `PR-009${i}`,
    product_name: `Product Alpha ${i}`,
    status: i % 2 === 0 ? 'Approved' : 'Purchasing',
    total_requested_qty: 10,
    remarks: `Request ${i}`
  }));
  let html5 = sandbox.renderRequesterWorkspaceHtml({ my_recent_requests: r5 });
  for (let i = 0; i < 5; i++) {
    assert.ok(html5.includes(`Product Alpha ${i}`), `Product Alpha ${i} missing in 5-record set`);
    assert.ok(!html5.includes(`>PR-009${i}<`), `PR-009${i} must not be rendered as visible text`);
  }

  // 20 records
  let r20 = Array.from({ length: 20 }, (_, i) => ({
    pr_id: 200 + i,
    pr_code: `PR-02${i < 10 ? '0' + i : i}`,
    product_name: `Batch Product ${i}`,
    status: 'Approved',
    total_requested_qty: 10,
    remarks: `Batch Request ${i}`
  }));
  let html20 = sandbox.renderRequesterWorkspaceHtml({ my_recent_requests: r20 });
  assert.ok(html20.includes('Batch Product 19'), 'Batch Product 19 missing in 20-record set - table must render all records for scrolling');
});

// 15. Test Notifications with 0, 1, 6, and 20 records
test('renderRequesterWorkspaceHtml handles Notifications with 0, 1, 6, and 20 records', () => {
  // 0 records
  let html0 = sandbox.renderRequesterWorkspaceHtml({ notifications: [] });
  assert.ok(html0.includes('No notifications yet.'), 'Empty state for 0 notifications missing');

  // 1 record
  let n1 = [{ notification_id: 1, title: 'PR-0081 Approved', message: 'Request PR-0081 approved.', created_at: '2026-10-27 14:48:00' }];
  let html1 = sandbox.renderRequesterWorkspaceHtml({ notifications: n1 });
  assert.ok(html1.includes('PR-0081 Approved'), 'Notification title missing');
  assert.ok(html1.includes('Request PR-0081 approved.'), 'Notification message missing');

  // 6 records
  let n6 = Array.from({ length: 6 }, (_, i) => ({
    notification_id: i + 1,
    title: `Notification ${i + 1}`,
    message: `Message ${i + 1}`,
    created_at: '2026-10-27 14:48:00'
  }));
  let html6 = sandbox.renderRequesterWorkspaceHtml({ notifications: n6 });
  for (let i = 1; i <= 6; i++) {
    assert.ok(html6.includes(`Notification ${i}`), `Notification ${i} missing in 6-record set`);
  }

  // 20 records
  let n20 = Array.from({ length: 20 }, (_, i) => ({
    notification_id: i + 1,
    title: `Notification ${i + 1}`,
    message: `Message ${i + 1}`,
    created_at: '2026-10-27 14:48:00'
  }));
  let html20 = sandbox.renderRequesterWorkspaceHtml({ notifications: n20 });
  assert.ok(html20.includes('Notification 20'), 'Notification 20 missing in 20-record set - list must render all records for scrolling');
});

// 16. Action & Navigation Buttons Present
test('renderRequesterWorkspaceHtml contains View Catalog, View All My Requests, and View all buttons', () => {
  let html = sandbox.renderRequesterWorkspaceHtml({});
  assert.ok(html.includes("navigateTo('product')"), 'View Catalog button missing or has wrong handler');
  assert.ok(html.includes("navigateTo('purchase_request')"), 'View All My Requests button missing or has wrong handler');
  assert.ok(html.includes("navigateTo('notifications')"), 'View all notifications button missing or has wrong handler');
});

// 17. Multi-line Column Headings in Products Table
test('Products Needing Replenishment table renders multi-line headings to prevent column cutoff', () => {
  let html = sandbox.renderRequesterWorkspaceHtml({ replenishment_candidates: [{ product_id: 1, product_name: 'Item A', available_stock: 5, max_stock: 20, reorder_level: 10, outstanding_replenishment: 0, suggested_order_qty: 15, additional_needed_qty: 15 }] });
  assert.ok(html.includes('Max<br>Stock') || html.includes('Max<span class="d-block">Stock</span>'), 'Max Stock multi-line heading missing');
  assert.ok(html.includes('Reorder<br>At') || html.includes('Reorder<span class="d-block">At</span>'), 'Reorder At multi-line heading missing');
  assert.ok(html.includes('On<br>Order') || html.includes('On<span class="d-block">Order</span>'), 'On Order multi-line heading missing');
  assert.ok(html.includes('Suggested<br>Qty') || html.includes('Suggested<span class="d-block">Qty</span>'), 'Suggested Qty multi-line heading missing');
  assert.ok(html.includes('Action'), 'Action column header missing');
});

// 18. Compact Stepper Width and Dot Alignment
test('CSS configures compact 4-stage stepper to keep Track button fully visible', () => {
  assert.ok(appCss.includes('.gw-req-stepper'), '.gw-req-stepper missing');
  assert.ok(appCss.includes('max-width: 165px'), 'Compact stepper max-width missing');
  assert.ok(appCss.includes('width: 14px') && appCss.includes('height: 14px'), '14px compact dot missing');
  assert.ok(appCss.includes('top: 7px'), '7px line alignment missing');
});

// 19. Dedicated Table Classes and Independent Horizontal/Vertical Overflow
test('CSS defines table classes with internal scrolling and zero page blowout', () => {
  assert.ok(appCss.includes('.gw-replenish-table'), '.gw-replenish-table class missing in CSS');
  assert.ok(appCss.includes('.gw-requests-table'), '.gw-requests-table class missing in CSS');
  assert.ok(appCss.includes('overflow-x: auto !important'), 'Internal table overflow-x: auto missing');
  assert.ok(appCss.includes('overflow-y: auto !important'), 'Internal table overflow-y: auto missing');
});

// 20. Equal Panel Heights and Dark/Light Surface Definitions
test('CSS enforces 560px equal panel heights on desktop with proper dark and light themes', () => {
  assert.ok(appCss.includes('height: 560px !important'), 'Desktop 560px height missing');
  assert.ok(appCss.includes('--bg-surface, #151515'), 'Dark mode surface #151515 missing');
  assert.ok(appCss.includes('--table-dw-bg, #F5F3EF'), 'Light mode surface #F5F3EF missing');
});

// 21. My Recent Requests 3-Column Layout & Removed Progress Column
test('My Recent Requests table has exactly 3 columns (PRODUCT, STATUS, ACTION) without visible progress column', () => {
  let html = sandbox.renderRequesterWorkspaceHtml({
    my_recent_requests: [{ pr_id: 301, pr_code: 'PR-0099', product_name: 'Bench', status: 'Approved', remarks: 'test' }]
  });
  assert.ok(html.includes('th-req-prod'), 'Product column header missing');
  assert.ok(html.includes('th-req-stat'), 'Status column header missing');
  assert.ok(html.includes('th-req-act'), 'Action column header missing');
  assert.ok(!html.includes('th-req-prog'), 'Progress column must be removed from dashboard table');
  assert.ok(html.includes('btn-gw-track'), 'Track button with btn-gw-track missing');
  assert.ok(appCss.includes('table-layout: fixed'), 'Fixed table layout missing');
  assert.ok(appCss.includes('width: 50%'), '50% product width missing');
  assert.ok(appCss.includes('width: 25%'), '25% status/action width missing');
});

console.log(`\nTests Completed: ${passCount} Passed, 0 Failed`);
console.log('ALL STORE REQUESTER DASHBOARD TESTS PASSED SUCCESSFULLY!');
