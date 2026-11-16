/**
 * test_dark_mode_inventory.js
 * Comprehensive automated regression and verification suite for:
 * GymWorx Warehouse Inventory System - Cursor-Inspired Dark Mode & Permanent Black Sidebar
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const basePath = path.resolve(__dirname, '..');
const appCssPath = path.join(basePath, 'css', 'app.css');
const indexPhpPath = path.join(basePath, 'index.php');
const indexHtmlPath = path.join(basePath, 'index.html');
const productHtmlPath = path.join(basePath, 'views', 'product.html');
const productJsPath = path.join(basePath, 'js', 'product.js');
const themeJsPath = path.join(basePath, 'js', 'theme.js');

console.log('--- GymWorx Dark Mode & Product Inventory UI/UX Verification Suite ---\n');

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
const productHtml = fs.readFileSync(productHtmlPath, 'utf8');
const productJs = fs.readFileSync(productJsPath, 'utf8');
const themeJs = fs.readFileSync(themeJsPath, 'utf8');

// =========================================================================
// 1. Permanent Sidebar Colors (Locked in BOTH Light & Dark Modes)
// =========================================================================
test('Sidebar background is permanently black (#0D0C0A) in both theme definitions', () => {
  // In root dark mode
  assert.ok(appCss.includes('--sidebar-bg: #0D0C0A'), 'Root --sidebar-bg must be #0D0C0A');
  // In light mode definition, sidebar must NOT switch to white
  const lightModeIndex = appCss.indexOf('[data-theme="light"]');
  const lightModeBlock = appCss.substring(lightModeIndex, lightModeIndex + 1600);
  assert.ok(lightModeBlock.includes('--sidebar-bg: #0D0C0A'), 'Light mode --sidebar-bg must remain #0D0C0A');
  assert.ok(!lightModeBlock.includes('--sidebar-bg: #FFFFFF'), 'Light mode --sidebar-bg must NOT be #FFFFFF');
});

test('Permanent sidebar navigation colors, borders, and icons adhere to Section 3', () => {
  assert.ok(appCss.includes('--sidebar-active: #262521'), 'Active nav background #262521 missing');
  assert.ok(appCss.includes('--sidebar-hover: #1B1A18'), 'Hover nav background #1B1A18 missing');
  assert.ok(appCss.includes('--sidebar-border: #302E2A'), 'Sidebar divider / border #302E2A missing');
  assert.ok(appCss.includes('--sidebar-text: #F5F3EF'), 'Primary nav text #F5F3EF missing');
  assert.ok(appCss.includes('--sidebar-text-secondary: #A8A6A2'), 'Secondary nav text #A8A6A2 missing');
  assert.ok(appCss.includes('#sidebarOffcanvas .nav-link i'), 'Sidebar nav icon selector missing');
});

// =========================================================================
// 2. Product Inventory Title & Header
// =========================================================================
test('Product Inventory title uses dirty-white (#F5F3EF) in Dark Mode and black (#171717) in Light Mode', () => {
  assert.ok(appCss.includes('.gw-product-page-title'), '.gw-product-page-title class missing in app.css');
  assert.ok(appCss.includes('color: #F5F3EF !important'), 'Dirty-white title color (#F5F3EF) missing');
  assert.ok(appCss.includes('[data-theme="light"] .gw-product-page-title') && appCss.includes('color: #171717 !important'),
    'Light mode black title color (#171717) missing');
});

test('Product Inventory subtitle uses theme-aware secondary colors (#A8A6A2 in Dark, #57534E in Light)', () => {
  assert.ok(appCss.includes('.gw-product-page-subtitle'), '.gw-product-page-subtitle missing in app.css');
  assert.ok(appCss.includes('[data-theme="dark"] .gw-product-page-subtitle') || appCss.includes('color: #A8A6A2 !important'),
    'Dark mode subtitle color (#A8A6A2) missing');
  assert.ok(appCss.includes('[data-theme="light"] .gw-product-page-subtitle') && appCss.includes('color: #57534E !important'),
    'Light mode subtitle color (#57534E) missing');
});

test('Product Inventory header icon badge uses clean white surface with subtle boundary', () => {
  assert.ok(appCss.includes('.gw-page-title-badge'), '.gw-page-title-badge missing in app.css');
  assert.ok(appCss.includes('border: 1px solid #302E2A') || appCss.includes('border: 1px solid #D8D5CF'),
    'Header icon badge subtle border missing');
});

// =========================================================================
// 3. Inventory Status Cards (Critical, Low Stock, Well Stocked)
// =========================================================================
test('Status cards use dark charcoal background (#161513) with subtle border (#302E2A) in Dark Mode', () => {
  assert.ok(appCss.includes('.gw-prod-summary-card'), '.gw-prod-summary-card missing in app.css');
  assert.ok(appCss.includes('background-color: #161513 !important'), 'Card dark charcoal background (#161513) missing');
  assert.ok(appCss.includes('border: 1px solid #302E2A !important') || appCss.includes('border-color: #302E2A !important'),
    'Card subtle border (#302E2A) missing');
  assert.ok(appCss.includes('border-radius: 12px'), 'Card rounded corners (12px) missing');
});

test('Critical status card uses Red (#EF4444) text/icon and #3A2022 icon background', () => {
  assert.ok(appCss.includes('background-color: #3A2022 !important'), 'Critical icon background (#3A2022) missing');
  assert.ok(appCss.includes('#EF4444'), 'Critical status red color (#EF4444) missing');
});

test('Low Stock status card uses Amber (#F59E0B) text/icon and #382A14 icon background', () => {
  assert.ok(appCss.includes('background-color: #382A14 !important'), 'Low Stock icon background (#382A14) missing');
  assert.ok(appCss.includes('#F59E0B'), 'Low Stock status amber color (#F59E0B) missing');
});

test('Well Stocked status card uses Green (#10B981) text/icon and #173326 icon background', () => {
  assert.ok(appCss.includes('background-color: #173326 !important'), 'Well Stocked icon background (#173326) missing');
  assert.ok(appCss.includes('#10B981'), 'Well Stocked status green color (#10B981) missing');
});

test('Status cards secondary unit text uses muted #74726E in Dark Mode', () => {
  assert.ok(appCss.includes('color: #74726E !important'), 'Status card muted unit text (#74726E) missing');
});

test('Status cards return to clean light mode appearance (#FFFFFF) in Light Mode', () => {
  assert.ok(appCss.includes('[data-theme="light"] .gw-prod-summary-card') &&
    appCss.includes('background-color: #FFFFFF !important'), 'Light mode white card background missing');
});

// =========================================================================
// 4. Product Category Column (Plain Text Without Badge Backgrounds)
// =========================================================================
test('Category column removes all pill/badge backgrounds, borders, and shadows in app.css', () => {
  assert.ok(appCss.includes('.gw-table-product .row-cat'), 'Category table cell selector missing');
  assert.ok(appCss.includes('background: transparent !important'), 'Category transparent background missing');
  assert.ok(appCss.includes('border: none !important'), 'Category border removal missing');
  assert.ok(appCss.includes('padding: 0 !important'), 'Category extra padding removal missing');
});

test('Category column text color is #F5F3EF in Dark Mode and #171717 in Light Mode', () => {
  assert.ok(appCss.includes('color: #F5F3EF !important'), 'Dark mode category text color (#F5F3EF) missing');
  assert.ok(appCss.includes('[data-theme="light"] .gw-table-product .row-cat') &&
    appCss.includes('color: #171717 !important'), 'Light mode category text color (#171717) missing');
});

test('product.js renders plain category text with gw-prod-category class', () => {
  assert.ok(productJs.includes('catBadge.className = \'row-cat gw-prod-category\'') ||
    productJs.includes('gw-prod-category'), 'product.js should assign plain gw-prod-category class');
});

test('views/product.html and index.html define tmpl-row-product with plain category cell', () => {
  assert.ok(productHtml.includes('gw-prod-category'), 'views/product.html must use gw-prod-category in template');
  assert.ok(indexHtml.includes('gw-prod-category'), 'index.html must use gw-prod-category in template');
});

// =========================================================================
// 5. Product Inventory Table & Internal Scrollbars
// =========================================================================
test('Product Inventory Table uses dark palette (#161513, #262521, #302E2A, #F5F3EF, #A8A6A2) in Dark Mode', () => {
  assert.ok(appCss.includes('[data-theme="dark"]') && appCss.includes('--table-dw-bg: #161513'),
    'Dark mode table background (#161513) missing');
  assert.ok(appCss.includes('--table-dw-header: #262521'), 'Dark mode table header (#262521) missing');
  assert.ok(appCss.includes('--table-dw-border: #302E2A'), 'Dark mode table border (#302E2A) missing');
  assert.ok(appCss.includes('--table-dw-text: #F5F3EF'), 'Dark mode table primary text (#F5F3EF) missing');
  assert.ok(appCss.includes('--table-dw-text-secondary: #A8A6A2'), 'Dark mode table secondary text (#A8A6A2) missing');
});

test('Product Inventory Table preserves dirty-white palette (#F5F3EF, #EBE9E4, #D8D5CF, #171717) in Light Mode', () => {
  assert.ok(appCss.includes('[data-theme="light"]') && appCss.includes('--table-dw-bg: #F5F3EF'),
    'Light mode table background (#F5F3EF) missing');
  assert.ok(appCss.includes('[data-theme="light"]') && appCss.includes('--table-dw-header: #EBE9E4'),
    'Light mode table header (#EBE9E4) missing');
  assert.ok(appCss.includes('[data-theme="light"]') && appCss.includes('--table-dw-border: #D8D5CF'),
    'Light mode table border (#D8D5CF) missing');
  assert.ok(appCss.includes('[data-theme="light"]') && appCss.includes('--table-dw-text: #171717'),
    'Light mode table text (#171717) missing');
});

test('Internal table scrollbar stays inside container with sticky header functional', () => {
  assert.ok(appCss.includes('.gw-product-table-scroll'), '.gw-product-table-scroll missing');
  assert.ok(appCss.includes('position: sticky !important') && appCss.includes('top: 0 !important'),
    'Sticky top header rule missing');
  assert.ok(appCss.includes('scrollbar-width: thin'), 'Thin scrollbar rule missing');
});

// =========================================================================
// 6. Minimalist View Buttons
// =========================================================================
test('View buttons use transparent background, thin green border, and green eye icon in both themes', () => {
  assert.ok(appCss.includes('.gw-btn-view-product'), '.gw-btn-view-product rule missing');
  assert.ok(appCss.includes('background: transparent !important'), 'Transparent view button background missing');
  assert.ok(appCss.includes('border: 1px solid #10B981 !important'), 'Dark mode green border (#10B981) missing');
  assert.ok(appCss.includes('color: #10B981 !important'), 'Dark mode green text (#10B981) missing');
  assert.ok(appCss.includes('border: 1px solid #008A45 !important'), 'Light mode green border (#008A45) missing');
  assert.ok(appCss.includes('color: #008A45 !important'), 'Light mode green text (#008A45) missing');
});

// =========================================================================
// 7. Table Pagination Controls
// =========================================================================
test('Pagination footer and buttons adapt cleanly to theme mode', () => {
  assert.ok(appCss.includes('.gw-product-table-footer'), '.gw-product-table-footer missing');
  assert.ok(appCss.includes('.gw-page-btn'), '.gw-page-btn missing');
  assert.ok(appCss.includes('[data-theme="dark"] .gw-page-btn') || appCss.includes('html:not([data-theme="light"]) .gw-page-btn'),
    'Dark mode page button styling missing');
  assert.ok(appCss.includes('[data-theme="light"] .gw-page-btn'), 'Light mode page button styling missing');
});

// =========================================================================
// 8. Print and Receipt Document Protection
// =========================================================================
test('Print and receipt documents maintain dedicated clean styling without theme leakage', () => {
  assert.ok(appCss.includes('.gw-receipt-paper'), '.gw-receipt-paper rule missing');
  assert.ok(appCss.includes('@media print'), '@media print stylesheet missing');
  assert.ok(appCss.includes('#receiptPrintArea'), '#receiptPrintArea missing');
});

console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('ALL DARK MODE & INVENTORY THEME VERIFICATION TESTS PASSED SUCCESSFULLY!\n');
}
