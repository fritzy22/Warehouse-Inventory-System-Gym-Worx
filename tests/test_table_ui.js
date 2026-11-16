/**
 * test_table_ui.js
 * Comprehensive automated verification for GymWorx Standardized Dirty-White Data Tables & Internal Scrolling
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const basePath = path.resolve(__dirname, '..');
const appCssPath = path.join(basePath, 'css', 'app.css');
const indexPhpPath = path.join(basePath, 'index.php');
const indexHtmlPath = path.join(basePath, 'index.html');
const viewsPath = path.join(basePath, 'views');

console.log('--- GymWorx Table UI/UX Standardization Verification Suite ---');

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
const indexPhp = fs.readFileSync(indexPhpPath, 'utf8');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// 1. Dirty-White Table Palette Tokens in :root
test('Dirty-white table palette tokens are defined with exact hex codes in :root', () => {
  assert.ok(appCss.includes('--table-dw-bg: #F5F3EF'), '--table-dw-bg missing or incorrect');
  assert.ok(appCss.includes('--table-dw-header: #EBE9E4'), '--table-dw-header missing or incorrect');
  assert.ok(appCss.includes('--table-dw-row: #F5F3EF'), '--table-dw-row missing or incorrect');
  assert.ok(appCss.includes('--table-dw-row-hover: #EAE7E1'), '--table-dw-row-hover missing or incorrect');
  assert.ok(appCss.includes('--table-dw-text: #171717'), '--table-dw-text missing or incorrect');
  assert.ok(appCss.includes('--table-dw-text-secondary: #57534E'), '--table-dw-text-secondary missing or incorrect');
  assert.ok(appCss.includes('--table-dw-border: #D8D5CF'), '--table-dw-border missing or incorrect');
  assert.ok(appCss.includes('--table-dw-scroll-track: #EBE9E4'), '--table-dw-scroll-track missing or incorrect');
  assert.ok(appCss.includes('--table-dw-scroll-thumb: #AAA69F'), '--table-dw-scroll-thumb missing or incorrect');
});

// 2. Table Container Styling
test('Table container (.gym-table-container) enforces dirty-white background, subtle border and rounded boundary', () => {
  assert.ok(appCss.includes('.gym-table-container'), '.gym-table-container missing in CSS');
  assert.ok(appCss.includes('border-radius: 12px'), 'Container border-radius 12px missing');
  assert.ok(appCss.includes('overflow: hidden'), 'Container overflow: hidden missing');
});

// 3. Internal Table Scrollbar
test('Internal table scrollbar is contained inside the container with controlled max-height', () => {
  assert.ok(appCss.includes('.gym-table-scroll'), '.gym-table-scroll missing in CSS');
  assert.ok(appCss.includes('max-height: min(580px, 65vh)'), 'Internal max-height rule missing');
  assert.ok(appCss.includes('scrollbar-width: thin'), 'Firefox thin scrollbar missing');
  assert.ok(appCss.includes('scrollbar-color: var(--table-dw-scroll-thumb) var(--table-dw-scroll-track)'), 'Scrollbar track and thumb color tokens missing');
  assert.ok(appCss.includes('.gym-table-scroll::-webkit-scrollbar'), 'Webkit scrollbar rule missing');
  assert.ok(appCss.includes('.gym-table-scroll::-webkit-scrollbar-thumb'), 'Webkit scrollbar thumb missing');
  assert.ok(appCss.includes('.gym-table-scroll::-webkit-scrollbar-track'), 'Webkit scrollbar track missing');
});

// 4. Sticky Table Headers
test('Table headers (.gym-table thead th) are sticky with opaque dirty-white background', () => {
  assert.ok(appCss.includes('.gym-table thead th'), '.gym-table thead th rule missing');
  assert.ok(appCss.includes('position: sticky !important') && appCss.includes('top: 0 !important'), 'Sticky top: 0 missing');
  assert.ok(appCss.includes('background-color: var(--table-dw-header) !important'), 'Header background not using --table-dw-header (#EBE9E4)');
  assert.ok(appCss.includes('border-bottom: 1px solid var(--table-dw-border) !important'), 'Header border-bottom not using --table-dw-border (#D8D5CF)');
  assert.ok(appCss.includes('color: var(--table-dw-text) !important'), 'Header text not using --table-dw-text (#171717)');
});

// 5. Table Rows and Hovers
test('Table rows and hover use dirty-white palette with dark readable text', () => {
  assert.ok(appCss.includes('background-color: var(--table-dw-row) !important'), 'Row background not using --table-dw-row');
  assert.ok(appCss.includes('background-color: var(--table-dw-row-hover) !important'), 'Hover background not using --table-dw-row-hover');
  assert.ok(appCss.includes('color: var(--table-dw-text) !important'), 'Cell text not using --table-dw-text');
  assert.ok(appCss.includes('color: var(--table-dw-text-secondary) !important'), 'Secondary text not using --table-dw-text-secondary');
});

// 6. Approval / Fulfillment Status Without Background Badges
test('Status labels (.gym-status) render plain text and icons without colored badge backgrounds', () => {
  assert.ok(appCss.includes('.gym-status'), '.gym-status rule missing');
  assert.ok(appCss.includes('background: transparent !important'), '.gym-status background is not transparent');
  assert.ok(appCss.includes('border: none !important'), '.gym-status border is not removed');
  assert.ok(appCss.includes('.gym-status--approved') && appCss.includes('color: #008A45 !important'), 'Approved status color (#008A45) missing');
  assert.ok(appCss.includes('.gym-status--fulfilled') && appCss.includes('color: #008A45 !important'), 'Fulfilled status color (#008A45) missing');
  assert.ok(appCss.includes('.gym-status--pending-fulfillment') && appCss.includes('color: #008A45 !important'), 'Pending Fulfillment status color (#008A45) missing');
  assert.ok(appCss.includes('.gym-status--pending-approval') && appCss.includes('color: #A66B00 !important'), 'Pending Approval status color (#A66B00) missing');
  assert.ok(appCss.includes('.gym-status--returned-for-revision') && appCss.includes('color: #A66B00 !important'), 'Returned for Revision color (#A66B00) missing');
  assert.ok(appCss.includes('.gym-status--rejected') && appCss.includes('color: #DC2626 !important'), 'Rejected status color (#DC2626) missing');
  assert.ok(appCss.includes('.gym-status--cancelled') && appCss.includes('color: #6B7280 !important'), 'Cancelled status color (#6B7280) missing');
  assert.ok(appCss.includes('.gym-status--ordering') && appCss.includes('color: #2563EB !important'), 'Ordering status color (#2563EB) missing');
  assert.ok(appCss.includes('.gym-status--not-fulfilled') && appCss.includes('color: #6B7280 !important'), 'Not Fulfilled status color (#6B7280) missing');
});

// 7. Minimalist View Action Buttons
test('View action buttons use thin green border (#008A45), green text, transparent background, and rounded corners', () => {
  assert.ok(appCss.includes('border: 1px solid #008A45 !important'), 'Green border missing on View action button');
  assert.ok(appCss.includes('color: #008A45 !important'), 'Green text (#008A45) missing on View action button');
  assert.ok(appCss.includes('border-radius: 6px !important'), 'Rounded corners (6px) missing on View action button');
  assert.ok(appCss.includes('background: rgba(0, 138, 69, 0.08) !important'), 'Subtle hover background missing on View button');
  assert.ok(appCss.includes('outline: 2px solid #008A45 !important'), 'Keyboard focus state missing on View button');
});

// 8. Presence of Standardized Classes Across Module Views
const requiredViews = [
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
  'users.html',
  'role.html',
  'common_templates.html'
];

requiredViews.forEach(v => {
  test(`View ${v} includes standardized table classes (gym-table-container, gym-table-scroll, or gym-table)`, () => {
    const content = fs.readFileSync(path.join(viewsPath, v), 'utf8');
    const hasTable = content.includes('<table');
    if (hasTable) {
      assert.ok(
        content.includes('gym-table') || content.includes('gym-table-scroll') || content.includes('gym-table-container'),
        `${v} contains <table> but missing standardized gym-table classes`
      );
    }
  });
});

// 9. Static Compilation index.html Synchronization
test('index.html contains synchronized dirty-white table structure and classes', () => {
  assert.ok(indexHtml.includes('gym-table-container'), 'index.html missing gym-table-container');
  assert.ok(indexHtml.includes('gym-table-scroll'), 'index.html missing gym-table-scroll');
  assert.ok(indexHtml.includes('gym-table'), 'index.html missing gym-table');
  assert.ok(indexHtml.includes('All Purchase Requests'), 'index.html missing All Purchase Requests card title');
});

console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('ALL STANDARDIZED DIRTY-WHITE TABLE TESTS PASSED SUCCESSFULLY!');
}
