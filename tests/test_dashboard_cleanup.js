/**
 * test_dashboard_cleanup.js
 * Verification suite for Dashboard UI/UX Cleanup:
 * 1. Confirms removal of Recent Transactions, Recent Notifications, and in-dashboard Quick Actions cards.
 * 2. Confirms Request-to-Receiving Pipeline and Stock Alerts layout grid alignment (col-12 col-xl-7 and col-12 col-xl-5, card h-100).
 * 3. Confirms preservation of Header Quick Actions dropdown, Topbar notification bell, and Sidebar notifications.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passedTests = 0;
function test(desc, fn) {
  try {
    fn();
    console.log(`\x1b[32m✔\x1b[0m ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`\x1b[31m✘\x1b[0m ${desc}`);
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  }
}

const dashboardJsPath = path.join(__dirname, '../js/dashboard.js');
const indexHtmlPath = path.join(__dirname, '../index.html');
const cssPath = path.join(__dirname, '../css/app.css');

const dashboardJs = fs.readFileSync(dashboardJsPath, 'utf8');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const appCss = fs.readFileSync(cssPath, 'utf8');

console.log('\n--- GymWorx Warehouse: Dashboard Redundant Sections Cleanup Verification ---\n');

test('1. dashboard.js renderAdminWorkspaceHtml does NOT contain Recent Transactions card', () => {
  const adminWsMatch = dashboardJs.match(/function renderAdminWorkspaceHtml\([\s\S]*?^}/m);
  assert(adminWsMatch, 'renderAdminWorkspaceHtml must be defined');
  const code = adminWsMatch[0];
  assert(!code.includes('Recent Transactions'), 'Must not render Recent Transactions');
  assert(!code.includes('openRecentTransactionsModal()'), 'Must not render button to openRecentTransactionsModal in workspace');
  assert(!code.includes('No recent transactions'), 'Must not render empty transactions state');
  assert(!code.includes('View Transactions'), 'Must not render View Transactions button');
});

test('2. dashboard.js renderAdminWorkspaceHtml does NOT contain Recent Notifications card', () => {
  const adminWsMatch = dashboardJs.match(/function renderAdminWorkspaceHtml\([\s\S]*?^}/m);
  const code = adminWsMatch[0];
  assert(!code.includes('Recent Notifications'), 'Must not render Recent Notifications in admin workspace');
  assert(!code.includes('openRecentNotificationsModal()'), 'Must not render button to openRecentNotificationsModal in workspace');
  assert(!code.includes('No recent notifications'), 'Must not render empty notifications state');
  assert(!code.includes('View Notifications'), 'Must not render View Notifications button');
});

test('3. dashboard.js renderAdminWorkspaceHtml does NOT contain in-dashboard Quick Actions card', () => {
  const adminWsMatch = dashboardJs.match(/function renderAdminWorkspaceHtml\([\s\S]*?^}/m);
  const code = adminWsMatch[0];
  assert(!code.includes('gw-quick-actions-card'), 'Must not contain gw-quick-actions-card');
  assert(!code.includes('dashboardQuickActionsBtn'), 'Must not contain dashboardQuickActionsBtn');
  assert(!code.includes('dashboardQuickActionsMenu'), 'Must not contain dashboardQuickActionsMenu');
  assert(!code.includes('Select Quick Action...'), 'Must not contain Select Quick Action dropdown');
});

test('4. Request-to-Receiving Pipeline and Stock Alerts are cleanly aligned side-by-side', () => {
  const adminWsMatch = dashboardJs.match(/function renderAdminWorkspaceHtml\([\s\S]*?^}/m);
  const code = adminWsMatch[0];
  assert(code.includes('col-12 col-xl-7'), 'Pipeline column must be col-12 col-xl-7');
  assert(code.includes('col-12 col-xl-5'), 'Stock Alerts column must be col-12 col-xl-5');
  assert(code.includes('renderPipelineComponentHtml'), 'Must render pipeline component');
  assert(code.includes('Stock Alerts'), 'Must render Stock Alerts component');
  assert(code.includes('card h-100'), 'Stock alerts card must use card h-100 for height alignment');
});

test('5. renderPipelineComponentHtml uses card h-100 and vertically centered body for clean alignment', () => {
  assert(dashboardJs.includes('<div class="card h-100 gw-pipeline-card">'), 'Pipeline card must use card h-100');
  assert(dashboardJs.includes('card-body py-3 d-flex flex-column justify-content-center'), 'Pipeline body must be vertically centered');
});

test('6. Unused outside click listener for dashboardQuickActionsMenu has been removed', () => {
  assert(!dashboardJs.includes("getElementById('dashboardQuickActionsMenu')"), 'Unused dashboardQuickActionsMenu listener must be removed');
});

test('7. Header Quick Actions dropdown button is fully preserved', () => {
  assert(dashboardJs.includes('id="headerQuickActionsDropdown"'), 'Header quick actions dropdown must remain in dashboard header actions');
  assert(dashboardJs.includes('Quick Actions'), 'Header quick actions button text must remain');
  assert(dashboardJs.includes("navigateTo('purchase_request', { openNewModal: true })"), 'Header quick actions PR action preserved');
  assert(dashboardJs.includes("navigateTo('purchase_order', { openNewModal: true })"), 'Header quick actions PO action preserved');
  assert(dashboardJs.includes("navigateTo('stock_receiving', { openNewModal: true })"), 'Header quick actions receiving action preserved');
  assert(dashboardJs.includes("navigateTo('stock_releasing', { openNewModal: true })"), 'Header quick actions releasing action preserved');
});

test('8. Topbar notification bell and badge are fully preserved', () => {
  assert(indexHtml.includes('id="topbarNotifBtn"'), 'Topbar notification button topbarNotifBtn must remain');
  assert(indexHtml.includes('id="topbarNotifBadge"'), 'Topbar notification badge topbarNotifBadge must remain');
  assert(indexHtml.includes('id="topbarNotifDropdownList"'), 'Notification dropdown list topbarNotifDropdownList must remain');
});

test('9. Sidebar navigation to Notifications and other modules preserved', () => {
  assert(indexHtml.includes('id="sidebarNavNotifications"'), 'Sidebar notifications item preserved');
  assert(indexHtml.includes('data-tab="product"'), 'Sidebar products item preserved');
  assert(indexHtml.includes('data-tab="purchase_request"'), 'Sidebar purchase requests item preserved');
  assert(indexHtml.includes('data-tab="purchase_order"'), 'Sidebar purchase orders item preserved');
  assert(indexHtml.includes('data-tab="stock_receiving"'), 'Sidebar stock receiving item preserved');
  assert(indexHtml.includes('data-tab="stock_releasing"'), 'Sidebar stock releasing item preserved');
});

test('10. App CSS removed unused in-dashboard quick actions and summary card classes', () => {
  assert(!appCss.includes('.gw-quick-actions-card'), 'Unused .gw-quick-actions-card CSS removed');
  assert(!appCss.includes('.quick-actions-inline-menu'), 'Unused .quick-actions-inline-menu CSS removed');
  assert(!appCss.includes('@keyframes gwQuickActionsSlide'), 'Unused @keyframes gwQuickActionsSlide CSS removed');
});

test('11. Synthetic execution of renderAdminWorkspaceHtml renders valid HTML string', () => {
  // Mock data structure
  const mockData = {
    pipeline: { submitted: 3, approved: 2, po_issued: 1, partially_received: 0, completed: 5 },
    low_stock_products: [
      { product_name: 'Optimum Whey 5lbs', available_stock: 4, max_stock: 50, is_critical_stock: false },
      { product_name: 'Creatine Monohydrate', available_stock: 2, max_stock: 40, is_critical_stock: true }
    ],
    kpis: { unread_notifications: 0 }
  };

  // Evaluate safely in isolated context
  const vm = require('vm');
  const context = {
    gwPipelinePrevCounts: null,
    getNormalizedPipelineCounts: (p) => ({
      submitted: p.submitted || 0,
      approved: p.approved || 0,
      po_issued: p.po_issued || 0,
      partially_received: p.partially_received || 0,
      completed: p.completed || 0
    }),
    renderPipelineComponentHtml: (p) => `<div class="card h-100 gw-pipeline-card">Pipeline (${p.submitted})</div>`,
    openStockAlertsModal: () => {},
    renderStockBarRowHtml: (item) => `<div class="stock-row">${item.product_name}</div>`
  };

  const scriptCode = `
    ${dashboardJs.slice(dashboardJs.indexOf('function renderAdminWorkspaceHtml'), dashboardJs.indexOf('function renderManagerWorkspaceHtml'))}
  `;
  vm.createContext(context);
  vm.runInContext(scriptCode, context);
  const resultHtml = context.renderAdminWorkspaceHtml(mockData);

  assert(resultHtml.includes('Pipeline (3)'), 'Rendered pipeline content');
  assert(resultHtml.includes('Optimum Whey 5lbs'), 'Rendered stock alert item 1');
  assert(resultHtml.includes('Creatine Monohydrate'), 'Rendered stock alert item 2');
  assert(!resultHtml.includes('Recent Transactions'), 'Must not render Recent Transactions');
  assert(!resultHtml.includes('Recent Notifications'), 'Must not render Recent Notifications');
  assert(!resultHtml.includes('Quick Actions'), 'Must not render Quick Actions');
});

test('12. Rebuilt index.html is up to date and contains clean dashboard structure', () => {
  assert(indexHtml.includes('id="dashboardRoleContent"'), 'Dashboard container present in index.html');
  assert(!indexHtml.includes('id="dashboardQuickActionsBtn"'), 'No in-dashboard quick actions button in index.html');
});

console.log(`\n\x1b[32m✔ All ${passedTests} Dashboard Cleanup tests passed successfully!\x1b[0m\n`);
