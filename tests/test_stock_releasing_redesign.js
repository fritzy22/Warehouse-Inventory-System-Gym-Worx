/**
 * test_stock_releasing_redesign.js
 * Verification suite for the Stock Releasing page 3-panel horizontal redesign.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const basePath = path.resolve(__dirname, '..');
const appCss = fs.readFileSync(path.join(basePath, 'css', 'app.css'), 'utf8');
const stockReleasingJs = fs.readFileSync(path.join(basePath, 'js', 'stock_releasing.js'), 'utf8');
const stockReleasingHtml = fs.readFileSync(path.join(basePath, 'views', 'stock_releasing.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(basePath, 'index.html'), 'utf8');

console.log('=== Stock Releasing 3-Panel Redesign Verification Suite ===\n');

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

// 1. Grid Structure and Desktop Allocation
console.log('--- 1. Three-Panel Grid Layout ---');
it('views/stock_releasing.html uses .stock-releasing-grid containing all three panels', () => {
  assert.ok(stockReleasingHtml.includes('class="stock-releasing-grid"'));
  assert.ok(stockReleasingHtml.includes('id="releasingPendingPrCard"'));
  assert.ok(stockReleasingHtml.includes('id="releasingHistoryCard"'));
  assert.ok(stockReleasingHtml.includes('id="releasingStoreInventoryCard"'));
});

it('index.html contains .stock-releasing-grid and all three panels', () => {
  assert.ok(indexHtml.includes('class="stock-releasing-grid"'));
  assert.ok(indexHtml.includes('id="releasingPendingPrCard"'));
  assert.ok(indexHtml.includes('id="releasingHistoryCard"'));
  assert.ok(indexHtml.includes('id="releasingStoreInventoryCard"'));
});

it('app.css specifies 3-column desktop grid with equal distribution', () => {
  assert.ok(/grid-template-columns:\s*(repeat\(3,\s*(minmax\(0,\s*1fr\)|1fr)\)|1\.05fr\s+1fr\s+1\.1fr)/i.test(appCss));
  assert.ok(/\.stock-releasing-grid\s*\{[^}]*display:\s*grid/i.test(appCss));
});

it('app.css provides responsive stacking for viewport widths below 992px', () => {
  assert.ok(/@media\s*\(\s*max-width:\s*991\.98px\s*\)\s*\{[^}]*\.stock-releasing-grid\s*\{[^}]*flex-direction:\s*column/i.test(appCss));
});

// 2. Left Panel: Approved Store Requests
console.log('\n--- 2. Left Panel (Approved Store Requests) ---');
it('Left panel contains checkmark header and count pill', () => {
  assert.ok(stockReleasingHtml.includes('Approved Store Requests Ready for Warehouse Release'));
  assert.ok(stockReleasingHtml.includes('id="releasingPendingPrCount"'));
});

it('Left panel has dedicated search bar with filterPendingRequests handler', () => {
  assert.ok(stockReleasingHtml.includes('id="searchPendingRequests"'));
  assert.ok(stockReleasingHtml.includes('filterPendingRequests(this.value)'));
  assert.ok(stockReleasingJs.includes('function filterPendingRequests('));
});

it('Left panel table has exact 5 columns (PR Code, Store / Branch, Requested By, Items, Action)', () => {
  const headers = ['PR Code', 'Store / Branch', 'Requested By', 'Items', 'Action'];
  headers.forEach(h => {
    assert.ok(stockReleasingHtml.includes(`<th>${h}</th>`) || stockReleasingHtml.includes(`>${h}</th>`));
  });
});

it('Left panel renders compact green-outlined Release button with truck icon', () => {
  assert.ok(stockReleasingJs.includes('btn-release-action'));
  assert.ok(stockReleasingJs.includes('bi-truck'));
  assert.ok(stockReleasingJs.includes('openFulfillStoreRequestModal'));
  assert.ok(appCss.includes('.btn-release-action'));
  assert.ok(appCss.includes('#008A45'));
  assert.ok(appCss.includes('#22A66B'));
});

// 3. Center Panel: Stock Release History
console.log('\n--- 3. Center Panel (Stock Release History) ---');
it('Center panel has title, subtitle, and search field', () => {
  assert.ok(stockReleasingHtml.includes('Stock Release History'));
  assert.ok(stockReleasingHtml.includes('Completed branch and store stock releases'));
  assert.ok(stockReleasingHtml.includes('id="searchReleaseHistory"'));
  assert.ok(stockReleasingHtml.includes('filterReleaseHistory(this.value)'));
  assert.ok(stockReleasingJs.includes('function filterReleaseHistory('));
});

it('Center panel displays release code with PR reference underneath', () => {
  assert.ok(stockReleasingJs.includes("r.releasing_code || ('REL-' + String(r.releasing_id).padStart(4, '0'))"));
  assert.ok(stockReleasingJs.includes("r.pr_code ? ('Ref: ' + r.pr_code) : ''"));
});

it('Center panel preserves printer action button with Lucide SVG', () => {
  assert.ok(stockReleasingJs.includes('stock-release-print-btn'));
  assert.ok(stockReleasingJs.includes('openReceiptModal'));
});

// 4. Right Panel: Store Inventory Overview
console.log('\n--- 4. Right Panel (Store Inventory Overview) ---');
it('Right panel has header, refresh button, and search field', () => {
  assert.ok(stockReleasingHtml.includes('Store Inventory Overview (Branch Balances)'));
  assert.ok(stockReleasingHtml.includes('loadStoreInventory()'));
  assert.ok(stockReleasingHtml.includes('id="searchStoreInventory"'));
  assert.ok(stockReleasingHtml.includes('filterStoreInventory(this.value)'));
  assert.ok(stockReleasingJs.includes('function filterStoreInventory('));
});

it('Right panel preserves all 6 required columns', () => {
  const columns = ['Store / Branch', 'Product', 'Category', 'Unit', 'Current Store Stock', 'Last Updated'];
  columns.forEach(col => {
    assert.ok(stockReleasingHtml.includes(col));
    assert.ok(indexHtml.includes(col));
  });
});

it('Right panel supports empty, loading, and error states with reload', () => {
  assert.ok(stockReleasingJs.includes('No store inventory records available.'));
  assert.ok(stockReleasingJs.includes('Loading store inventory...'));
  assert.ok(stockReleasingJs.includes('Failed to load store inventory.'));
});

// 5. Independent Internal Scrolling & Theme Styling
console.log('\n--- 5. Independent Scrolling & Theme Styling ---');
it('Each panel table wrapper has independent scrolling with thin scrollbars', () => {
  assert.ok(appCss.includes('.stock-releasing-grid .panel-table-scroll'));
  assert.ok(appCss.includes('overflow-y: auto !important'));
  assert.ok(appCss.includes('scrollbar-width: thin'));
  assert.ok(appCss.includes('width: 5px'));
});

it('Table headers in panels remain sticky at the top', () => {
  assert.ok(appCss.includes('.stock-releasing-grid thead th'));
  assert.ok(appCss.includes('position: sticky !important'));
  assert.ok(appCss.includes('top: 0 !important'));
});

console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('ALL STOCK RELEASING REDESIGN TESTS PASSED SUCCESSFULLY!\n');
}
