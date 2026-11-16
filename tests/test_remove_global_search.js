/**
 * test_remove_global_search.js
 * Verification suite for the removal of the global header search bar
 * across all user roles in GymWorx Warehouse Management System.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const basePath = path.resolve(__dirname, '..');
const indexHtmlPath = path.join(basePath, 'index.html');
const indexPhpPath = path.join(basePath, 'index.php');
const appJsPath = path.join(basePath, 'js', 'app.js');
const productJsPath = path.join(basePath, 'js', 'product.js');
const stockReleasingPath = path.join(basePath, 'views', 'stock_releasing.html');
const productHtmlPath = path.join(basePath, 'views', 'product.html');
const productSupplierHtmlPath = path.join(basePath, 'views', 'product_supplier.html');

console.log('=== Remove Global Search Bar Verification Suite ===\n');

let passCount = 0;
let failCount = 0;

function it(description, fn) {
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

const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const indexPhp = fs.readFileSync(indexPhpPath, 'utf8');
const appJs = fs.readFileSync(appJsPath, 'utf8');
const productJs = fs.readFileSync(productJsPath, 'utf8');
const stockReleasingHtml = fs.readFileSync(stockReleasingPath, 'utf8');
const productHtml = fs.readFileSync(productHtmlPath, 'utf8');
const productSupplierHtml = fs.readFileSync(productSupplierHtmlPath, 'utf8');

// 1. Verification of removal in index.html
it('index.html: Global search input id="topbarGlobalSearch" is completely absent', () => {
  assert.strictEqual(indexHtml.includes('id="topbarGlobalSearch"'), false, 'topbarGlobalSearch should be completely removed from index.html');
});

it('index.html: Global search wrap class="gw-topbar-search-wrap" is removed from #appTopbar', () => {
  const topbarMatch = indexHtml.match(/<header[^>]*id="appTopbar"[\s\S]*?<\/header>/);
  assert.ok(topbarMatch, '#appTopbar must exist in index.html');
  assert.strictEqual(topbarMatch[0].includes('gw-topbar-search-wrap'), false, 'gw-topbar-search-wrap should be absent in #appTopbar');
});

it('index.html: Ctrl + K badge is completely absent from #appTopbar', () => {
  const topbarMatch = indexHtml.match(/<header[^>]*id="appTopbar"[\s\S]*?<\/header>/);
  assert.strictEqual(topbarMatch[0].includes('Ctrl + K'), false, 'Ctrl + K shortcut indicator should be absent in #appTopbar');
});

// 2. Verification of removal in index.php
it('index.php: Global search input id="topbarGlobalSearch" is completely absent', () => {
  assert.strictEqual(indexPhp.includes('id="topbarGlobalSearch"'), false, 'topbarGlobalSearch should be completely removed from index.php');
});

it('index.php: Global search wrap class="gw-topbar-search-wrap" is removed from #appTopbar', () => {
  const topbarMatch = indexPhp.match(/<header[^>]*id="appTopbar"[\s\S]*?<\/header>/);
  assert.ok(topbarMatch, '#appTopbar must exist in index.php');
  assert.strictEqual(topbarMatch[0].includes('gw-topbar-search-wrap'), false, 'gw-topbar-search-wrap should be absent in #appTopbar');
});

it('index.php: Ctrl + K badge is completely absent from #appTopbar', () => {
  const topbarMatch = indexPhp.match(/<header[^>]*id="appTopbar"[\s\S]*?<\/header>/);
  assert.strictEqual(topbarMatch[0].includes('Ctrl + K'), false, 'Ctrl + K shortcut indicator should be absent in #appTopbar');
});

// 3. Header layout and alignment preservation
it('Header retains hamburger menu on the left and utility controls on the right in both files', () => {
  for (const [filename, content] of [['index.html', indexHtml], ['index.php', indexPhp]]) {
    const topbarMatch = content.match(/<header[^>]*id="appTopbar"[\s\S]*?<\/header>/);
    assert.ok(topbarMatch, `#appTopbar must exist in ${filename}`);
    const topbar = topbarMatch[0];
    
    // Check left elements
    assert.ok(topbar.includes('id="sidebarCollapseBtn"'), `sidebarCollapseBtn missing in ${filename}`);
    
    // Check right elements
    assert.ok(topbar.includes('id="topbarThemeToggleBtn"'), `topbarThemeToggleBtn missing in ${filename}`);
    assert.ok(topbar.includes('id="topbarNotifBtn"'), `topbarNotifBtn missing in ${filename}`);
    assert.ok(topbar.includes('id="topbarAccountMenu"'), `topbarAccountMenu missing in ${filename}`);
    
    // Check ordering: sidebarCollapseBtn is before topbarThemeToggleBtn
    const collapsePos = topbar.indexOf('id="sidebarCollapseBtn"');
    const themePos = topbar.indexOf('id="topbarThemeToggleBtn"');
    const notifPos = topbar.indexOf('id="topbarNotifBtn"');
    const profilePos = topbar.indexOf('id="topbarAccountMenu"');
    assert.ok(collapsePos < themePos, `Collapse button must be to the left of theme toggle in ${filename}`);
    assert.ok(themePos < notifPos, `Theme toggle must be to the left of notifications in ${filename}`);
    assert.ok(notifPos < profilePos, `Notifications must be to the left of profile in ${filename}`);
  }
});

// 4. JS event listeners removal
it('app.js: topbarGlobalSearch listener has been removed', () => {
  assert.strictEqual(appJs.includes('topbarGlobalSearch'), false, 'topbarGlobalSearch listener must be removed from app.js');
});

it('product.js: topbarGlobalSearch reference and Ctrl+K search focus handler removed', () => {
  assert.strictEqual(productJs.includes('topbarGlobalSearch'), false, 'topbarGlobalSearch reference must be removed from product.js');
  assert.strictEqual(productJs.includes('ctrlKey') && productJs.includes("'k'"), false, 'Ctrl+K listener must be removed from product.js');
});

// 5. Preservation of individual module-specific search fields
it('Module searches preserved: Product Inventory search exists and is accessible', () => {
  assert.ok(productHtml.includes('id="gw_search_productTable"'), 'gw_search_productTable must be in views/product.html');
  assert.ok(indexHtml.includes('id="gw_search_productTable"'), 'gw_search_productTable must be in index.html');
  assert.strictEqual(productHtml.includes('d-md-none'), false, 'gw_search_productTable must not be hidden on desktop in views/product.html');
  assert.strictEqual(indexHtml.includes('d-md-none mb-3">\n    <div class="input-group input-group-sm gw-mobile-product-search"'), false, 'gw_search_productTable wrapper must not hide on desktop in index.html');
});

it('Module searches preserved: Stock Releasing panels retain all 3 search inputs', () => {
  assert.ok(stockReleasingHtml.includes('id="searchPendingRequests"'), 'searchPendingRequests must remain in Stock Releasing');
  assert.ok(stockReleasingHtml.includes('id="searchReleaseHistory"'), 'searchReleaseHistory must remain in Stock Releasing');
  assert.ok(stockReleasingHtml.includes('id="searchStoreInventory"'), 'searchStoreInventory must remain in Stock Releasing');
});

it('Module searches preserved: Product Supplier view retains filterSearch and linkSearchProducts', () => {
  assert.ok(productSupplierHtml.includes('id="filterSearch"'), 'filterSearch must remain in product_supplier.html');
  assert.ok(productSupplierHtml.includes('id="linkSearchProducts"'), 'linkSearchProducts must remain in product_supplier.html');
});

console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('ALL REMOVE GLOBAL SEARCH BAR TESTS PASSED SUCCESSFULLY!\n');
}
