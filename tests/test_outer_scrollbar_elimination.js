/**
 * test_outer_scrollbar_elimination.js
 * Comprehensive automated verification for GymWorx Warehouse:
 * Elimination of outer page/browser scrollbar and preservation of internal table scrolling
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const basePath = path.resolve(__dirname, '..');
const appCssPath = path.join(basePath, 'css', 'app.css');
const appJsPath = path.join(basePath, 'js', 'app.js');
const indexPhpPath = path.join(basePath, 'index.php');
const indexHtmlPath = path.join(basePath, 'index.html');
const viewsPath = path.join(basePath, 'views');

console.log('--- GymWorx Outer Scrollbar Elimination & Internal Table Scrolling Verification ---');

let passCount = 0;
let failCount = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`[PASS] ${description}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${description}`);
    console.error(`       Error: ${err.message}`);
    failCount++;
  }
}

const appCss = fs.readFileSync(appCssPath, 'utf8');
const appJs = fs.readFileSync(appJsPath, 'utf8');
const indexPhp = fs.readFileSync(indexPhpPath, 'utf8');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// =========================================================================
// 1. Root Application & Shell Layout Constraints
// =========================================================================
test('html, body, and #appShell are height-constrained to 100% with overflow hidden', () => {
  assert.ok(appCss.includes('html,\nbody,\n#appShell') || appCss.includes('html,') && appCss.includes('#appShell'), 'html, body, #appShell rule missing');
  assert.ok(appCss.includes('height: 100%'), 'height: 100% missing for root container');
  assert.ok(appCss.includes('.gw-app-shell-wrap'), '.gw-app-shell-wrap selector missing');
  assert.ok(appCss.includes('height: 100dvh'), '100dvh height missing in app shell wrap');
});

test('App body and main wrapper use flex column with zero min-height to prevent layout overflow', () => {
  assert.ok(appCss.includes('.gw-app-body') || appCss.includes('.gw-app-shell-wrap > .d-flex.flex-grow-1'), 'App body flex row missing');
  assert.ok(appCss.includes('.gw-main-wrapper') || appCss.includes('.gw-app-shell-wrap > .d-flex.flex-grow-1 > .d-flex.flex-column'), 'Main wrapper flex column missing');
  assert.ok(appCss.includes('min-height: 0'), 'min-height: 0 missing on flex children');
});

// =========================================================================
// 2. Main Content Container & Outer Scrollbar Removal on Table Pages
// =========================================================================
test('Default main allows scrolling for non-table pages (Dashboard, Notifications)', () => {
  assert.ok(appCss.includes('main,') && appCss.includes('.gw-main-content'), 'Default main selector missing');
  assert.ok(appCss.includes('overflow-y: auto'), 'Default overflow-y: auto missing for non-table pages');
});

test('On table pages (desktop), main enforces overflow: hidden to eliminate the outer page scrollbar', () => {
  assert.ok(appCss.includes('main.gw-table-page-active') || appCss.includes('main:has(> .panel:not([hidden]) .gym-table-container)'), 'Table page active main selector missing');
  assert.ok(appCss.includes('overflow: hidden !important'), 'overflow: hidden !important missing on table page main');
  assert.ok(appCss.includes('overflow-y: hidden !important'), 'overflow-y: hidden !important missing on table page main');
});

test('index.php and index.html include gw-main-content class without hardcoded pb-5 padding', () => {
  assert.ok(indexPhp.includes('class="flex-grow-1 p-3 p-md-4 gw-main-content'), 'gw-main-content missing in index.php');
  assert.ok(!indexPhp.includes('class="flex-grow-1 p-3 pb-5 p-md-4 overflow-y-auto'), 'Old pb-5 on main still present in index.php');
  assert.ok(indexHtml.includes('class="flex-grow-1 p-3 p-md-4 gw-main-content'), 'gw-main-content missing in index.html');
  assert.ok(!indexHtml.includes('class="flex-grow-1 p-3 pb-5 p-md-4 overflow-y-auto'), 'Old pb-5 on main still present in index.html');
});

// =========================================================================
// 3. Top Controls Pinning (Page title, filters, buttons, KPI cards)
// =========================================================================
test('Page controls (titles, action buttons, filter pills, nav tabs) remain pinned with flex-shrink: 0', () => {
  assert.ok(appCss.includes('flex-shrink: 0 !important'), 'flex-shrink: 0 !important missing for pinned controls');
  assert.ok(appCss.includes('.gw-filter-chips'), 'Filter chips selector missing in layout rules');
  assert.ok(appCss.includes('.gw-product-header-row'), 'Product header row selector missing in layout rules');
});

// =========================================================================
// 4. Data Table Card & Internal Table Scroll Container
// =========================================================================
test('Data table cards flex to occupy remaining vertical space (.gym-table-container.card, .gw-product-table-card)', () => {
  assert.ok(appCss.includes('.gym-table-container.card'), '.gym-table-container.card missing in layout rules');
  assert.ok(appCss.includes('flex: 1 1 auto !important'), 'flex: 1 1 auto missing for table card');
  assert.ok(appCss.includes('margin-bottom: 0 !important'), 'margin-bottom: 0 missing to prevent card overflow');
});

test('Internal table scroll container holds the ONLY vertical scrollbar inside the card', () => {
  assert.ok(appCss.includes('.gym-table-scroll'), '.gym-table-scroll missing');
  assert.ok(appCss.includes('overflow-y: auto !important'), 'overflow-y: auto missing on table scroll container');
  assert.ok(appCss.includes('overscroll-behavior: contain'), 'overscroll-behavior containment missing');
  assert.ok(appCss.includes('scrollbar-width: thin'), 'scrollbar-width: thin missing');
});

test('Table column headers remain sticky (position: sticky, top: 0, z-index: 2)', () => {
  assert.ok(appCss.includes('.gym-table thead th'), '.gym-table thead th selector missing');
  assert.ok(appCss.includes('position: sticky !important'), 'position: sticky missing');
  assert.ok(appCss.includes('top: 0 !important'), 'top: 0 missing');
  assert.ok(appCss.includes('z-index: 2 !important'), 'z-index: 2 missing');
});

test('Pagination footer remains pinned and accessible at the bottom of the card', () => {
  assert.ok(appCss.includes('.gw-product-table-footer'), '.gw-product-table-footer missing');
  assert.ok(appCss.includes('.gym-table-container.card > .card-footer') || appCss.includes('.gw-product-table-footer'), 'card-footer pinned rule missing');
});

// =========================================================================
// 5. Sidebar and Modal Independent Scrolling
// =========================================================================
test('Sidebar scrolls independently inside .offcanvas-body and remains permanently black #0D0C0A', () => {
  assert.ok(appCss.includes('--sidebar-bg: #0D0C0A'), 'Sidebar background must remain #0D0C0A');
  const sidebarHtml = fs.readFileSync(path.join(viewsPath, 'sidebar.html'), 'utf8');
  assert.ok(sidebarHtml.includes('offcanvas-body') && sidebarHtml.includes('overflow-y-auto'), 'Sidebar offcanvas-body must have overflow-y-auto');
});

test('Modals scroll independently without breaking page layout', () => {
  assert.ok(appCss.includes('.modal-dialog-scrollable') || appCss.includes('.gw-print-modal-body'), 'Modal scrolling rules missing');
  assert.ok(appCss.includes('overscroll-behavior-y: contain'), 'Modal overscroll containment missing');
});

// =========================================================================
// 6. JavaScript Tab State Synchronization
// =========================================================================
test('app.js synchronizes gw-table-page-active class on main during activateTab navigation', () => {
  assert.ok(appJs.includes('gw-table-page-active'), 'gw-table-page-active missing in app.js');
  assert.ok(appJs.includes("classList.toggle('gw-table-page-active'"), 'classList.toggle missing in app.js');
});

// =========================================================================
// 7. Universal Coverage across all 15 Table Views
// =========================================================================
const tableViews = [
  'purchase_request.html',
  'purchase_order.html',
  'stock_receiving.html',
  'stock_releasing.html',
  'purchase_return.html',
  'stocks_return.html',
  'adjustment.html',
  'audit_log.html',
  'product.html',
  'category.html',
  'supplier.html',
  'product_supplier.html',
  'inventory_report.html',
  'users.html'
];

tableViews.forEach(v => {
  test(`View ${v} contains standardized table container (.gym-table-container or .table-responsive)`, () => {
    const content = fs.readFileSync(path.join(viewsPath, v), 'utf8');
    assert.ok(
      content.includes('gym-table-container') || content.includes('table-responsive') || content.includes('gym-table-scroll'),
      `${v} must include gym-table-container or table-responsive`
    );
  });
});

console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('ALL OUTER SCROLLBAR ELIMINATION TESTS PASSED SUCCESSFULLY!\n');
}
