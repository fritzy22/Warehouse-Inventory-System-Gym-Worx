/**
 * test_typography.js
 * Comprehensive automated verification for Cursor-inspired typography (Geist + Geist Mono)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const basePath = path.resolve(__dirname, '..');
const appCssPath = path.join(basePath, 'css', 'app.css');
const indexPhpPath = path.join(basePath, 'index.php');
const indexHtmlPath = path.join(basePath, 'index.html');

console.log('--- GymWorx Typography Verification Suite ---');

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

// 1. Google Fonts CDN link and @import verification
test('app.css contains @import for Geist and Geist Mono from Google Fonts', () => {
  assert.ok(
    appCss.includes('@import url(\'https://fonts.googleapis.com/css2?family=Geist+Mono') ||
    appCss.includes('@import url("https://fonts.googleapis.com/css2?family=Geist+Mono'),
    '@import for Geist Mono / Geist not found in app.css'
  );
  assert.ok(appCss.includes('family=Geist:wght'), 'Geist sans weights not specified in @import');
});

test('index.php includes preconnect and link for Geist and Geist Mono fonts', () => {
  assert.ok(indexPhp.includes('fonts.googleapis.com'), 'Google Fonts preconnect/link missing in index.php');
  assert.ok(indexPhp.includes('family=Geist+Mono'), 'Geist Mono link missing in index.php');
  assert.ok(indexPhp.includes('family=Geist:wght'), 'Geist sans link missing in index.php');
});

test('index.html includes preconnect and link for Geist and Geist Mono fonts', () => {
  assert.ok(indexHtml.includes('fonts.googleapis.com'), 'Google Fonts preconnect/link missing in index.html');
  assert.ok(indexHtml.includes('family=Geist+Mono'), 'Geist Mono link missing in index.html');
  assert.ok(indexHtml.includes('family=Geist:wght'), 'Geist sans link missing in index.html');
});

// 2. CSS Custom Properties / Design Tokens
test('CSS variables --font-primary and --font-mono are declared in :root', () => {
  assert.ok(appCss.includes('--font-primary: "Geist"'), '--font-primary with Geist not found');
  assert.ok(appCss.includes('--font-mono: "Geist Mono"'), '--font-mono with Geist Mono not found');
  assert.ok(appCss.includes('--bs-body-font-family: var(--font-primary)'), 'Bootstrap body font override missing');
  assert.ok(appCss.includes('--bs-font-monospace: var(--font-mono)'), 'Bootstrap monospace font override missing');
});

// 3. Global Typography Inheritance
test('html and body inherit var(--font-primary) with proper font rendering', () => {
  assert.ok(appCss.includes('font-family: var(--font-primary)'), 'body font-family not set to var(--font-primary)');
  assert.ok(appCss.includes('-webkit-font-smoothing: antialiased'), 'antialiased rendering missing');
});

test('Universal font inheritance covers buttons, inputs, tables, cards, modals, nav', () => {
  assert.ok(
    appCss.includes('.btn,') &&
    appCss.includes('.form-control,') &&
    appCss.includes('.table,') &&
    appCss.includes('.card,') &&
    appCss.includes('.modal,') &&
    appCss.includes('.dropdown-menu,'),
    'Universal inheritance selector missing component targets'
  );
});

// 4. Selective Monospace for Technical Codes
test('Monospace rule targets code, kbd, .font-monospace, SKUs, and transaction IDs', () => {
  assert.ok(appCss.includes('font-family: var(--font-mono) !important'), 'var(--font-mono) !important rule missing');
  assert.ok(appCss.includes('.font-monospace,'), '.font-monospace selector missing');
  assert.ok(appCss.includes('.row-sku,'), '.row-sku selector missing');
  assert.ok(appCss.includes('.row-po-code,'), '.row-po-code selector missing');
  assert.ok(appCss.includes('.row-grn-code,'), '.row-grn-code selector missing');
  assert.ok(appCss.includes('font-feature-settings: "tnum" 1'), 'tabular numbers setting missing');
});

// 5. Typography Scale Standards
test('Main page titles (h1, #dashboardTitle) scale is 28–32px (1.875rem), weight 600', () => {
  assert.ok(appCss.includes('--gw-font-size-h1: 1.875rem'), '--gw-font-size-h1 token missing');
  assert.ok(appCss.includes('h1, .h1, #dashboardTitle'), 'h1 title selector missing');
  assert.ok(appCss.includes('font-size: var(--gw-font-size-h1)'), 'h1 font-size not referencing token');
});

test('Section headings (h2, .gw-section-title, .modal-title) scale is 20–24px (1.375rem), weight 600', () => {
  assert.ok(appCss.includes('--gw-font-size-h2: 1.375rem'), '--gw-font-size-h2 token missing');
  assert.ok(appCss.includes('font-size: var(--gw-font-size-h2)'), 'h2 font-size not referencing token');
});

test('Card headings (h3, .card-title, .card-header h5) scale is 16–18px (1.0625rem), weight 600', () => {
  assert.ok(appCss.includes('--gw-font-size-h3: 1.0625rem'), '--gw-font-size-h3 token missing');
  assert.ok(appCss.includes('font-size: var(--gw-font-size-h3)'), 'card heading font-size not referencing token');
});

test('Sidebar navigation items are 14px, weight 500', () => {
  assert.ok(appCss.includes('--gw-font-size-nav: 14px'), '--gw-font-size-nav token missing');
  assert.ok(appCss.includes('#sidebarOffcanvas .nav-link'), '#sidebarOffcanvas .nav-link rule missing');
  assert.ok(appCss.includes('font-size: var(--gw-font-size-nav) !important'), 'nav link font-size not referencing token');
});

test('Table headers are 12–13px (0.78125rem), weight 600', () => {
  assert.ok(appCss.includes('--gw-font-size-th: 0.78125rem'), '--gw-font-size-th token missing');
  assert.ok(appCss.includes('.table > thead > tr > th'), 'table thead th rule missing');
  assert.ok(appCss.includes('font-size: var(--gw-font-size-th) !important'), 'table header font size token missing');
  assert.ok(appCss.includes('font-weight: 600 !important'), 'table header weight 600 missing');
});

test('Table content cells are 13–14px (0.84375rem), weight 400', () => {
  assert.ok(appCss.includes('--gw-font-size-td: 0.84375rem'), '--gw-font-size-td token missing');
  assert.ok(appCss.includes('.table > tbody > tr > td'), 'table tbody td rule missing');
  assert.ok(appCss.includes('font-size: var(--gw-font-size-td)'), 'table cell font size token missing');
});

test('Buttons are 14px, weight 500', () => {
  assert.ok(appCss.includes('--gw-font-size-btn: 14px'), '--gw-font-size-btn token missing');
  assert.ok(appCss.includes('.btn,'), '.btn rule missing');
  assert.ok(appCss.includes('font-size: var(--gw-font-size-btn)'), 'btn font size token missing');
});

test('Form labels are 13px, weight 500', () => {
  assert.ok(appCss.includes('--gw-font-size-label: 13px'), '--gw-font-size-label token missing');
  assert.ok(appCss.includes('.form-label,'), '.form-label rule missing');
  assert.ok(appCss.includes('font-size: var(--gw-font-size-label)'), 'form label font size token missing');
});

test('Input text is 14px, weight 400', () => {
  assert.ok(appCss.includes('--gw-font-size-input: 14px'), '--gw-font-size-input token missing');
  assert.ok(appCss.includes('.form-control,'), '.form-control rule missing');
  assert.ok(appCss.includes('font-size: var(--gw-font-size-input)'), 'form input font size token missing');
});

test('Helper text is 12–13px (12.5px), weight 400', () => {
  assert.ok(appCss.includes('--gw-font-size-helper: 12.5px'), '--gw-font-size-helper token missing');
  assert.ok(appCss.includes('.form-text,'), '.form-text rule missing');
  assert.ok(appCss.includes('font-size: var(--gw-font-size-helper)'), 'helper text font size token missing');
});

test('KPI values are 26–30px (1.75rem / 28px), weight 600', () => {
  assert.ok(appCss.includes('--gw-font-size-kpi: 1.75rem'), '--gw-font-size-kpi token missing');
  assert.ok(appCss.includes('.kpi-value,'), '.kpi-value rule missing');
  assert.ok(appCss.includes('font-size: var(--gw-font-size-kpi) !important'), 'kpi font size token missing');
  assert.ok(appCss.includes('font-weight: 600 !important'), 'kpi font weight 600 missing');
});

// 6. Theme Integration
test('Dark theme tokens and typography integrate seamlessly', () => {
  assert.ok(appCss.includes('--bg-primary: #0D0C0A'), 'Primary background token present');
  assert.ok(appCss.includes('--text-primary: #F5F3EF'), 'Primary text token present');
  assert.ok(appCss.includes('--button-primary: #F5F3EF'), 'Primary button token present');
});

console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('ALL TYPOGRAPHY TESTS PASSED SUCCESSFULLY!');
}
