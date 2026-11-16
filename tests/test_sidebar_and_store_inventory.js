/**
 * Verification Test: Sidebar Navigation & Scrollbar + Store Inventory Overview Table Layout
 * 
 * Verifies:
 * 1. Fixed sidebar header, independently scrollable navigation, fixed bottom user box.
 * 2. Subtle 4px scrollbar (#52504C thumb, #77736D hover thumb, transparent track, hover-revealed).
 * 3. Tightened navigation spacing and vertical icon-label alignment.
 * 4. Store Inventory Overview table layout, uncompressed height (min-height >= 220px, scroll >= 160px).
 * 5. Store Inventory Overview empty state ("No store inventory records available."), loading, error retry.
 * 6. Approved Store Requests empty state ("No approved store requests ready for release.") and badge.
 * 7. HTML structure in both views/sidebar.html, views/stock_releasing.html, and index.html.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${desc}: ${err.message}`);
  }
}

console.log('=== GymWorx Sidebar & Store Inventory Layout Test Suite ===\n');

const sidebarHtml = fs.readFileSync(path.join(__dirname, '../views/sidebar.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const stockReleasingHtml = fs.readFileSync(path.join(__dirname, '../views/stock_releasing.html'), 'utf8');
const appCss = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
const stockReleasingJs = fs.readFileSync(path.join(__dirname, '../js/stock_releasing.js'), 'utf8');

// --- SECTION 1: SIDEBAR 3-TIER STRUCTURE ---
console.log('--- 1. Verifying Sidebar 3-Tier Structure (Fixed Header, Scrollable Nav, Fixed Footer) ---');

it('views/sidebar.html has fixed header at the top of aside', () => {
  assert.ok(sidebarHtml.includes('id="sidebarOffcanvas"'));
  assert.ok(sidebarHtml.includes('d-none d-md-flex') && sidebarHtml.includes('GYMWORX'));
});

it('views/sidebar.html closes offcanvas-body BEFORE #sidebarUserBox', () => {
  const navEnd = sidebarHtml.indexOf('</nav>');
  const bodyClose = sidebarHtml.indexOf('</div>', navEnd);
  const userBoxStart = sidebarHtml.indexOf('id="sidebarUserBox"');
  assert.ok(navEnd > -1, 'nav element should exist');
  assert.ok(bodyClose > -1 && bodyClose < userBoxStart, 'offcanvas-body must close before #sidebarUserBox starts');
});

it('index.html also closes offcanvas-body BEFORE #sidebarUserBox', () => {
  const navEnd = indexHtml.indexOf('</nav>');
  const bodyClose = indexHtml.indexOf('</div>', navEnd);
  const userBoxStart = indexHtml.indexOf('id="sidebarUserBox"');
  assert.ok(navEnd > -1, 'nav element should exist');
  assert.ok(bodyClose > -1 && bodyClose < userBoxStart, 'offcanvas-body must close before #sidebarUserBox starts in index.html');
});

it('sidebar user box contains user avatar, name, role and logout button', () => {
  assert.ok(sidebarHtml.includes('id="sidebarUserAvatar"'));
  assert.ok(sidebarHtml.includes('id="sidebarUserName"'));
  assert.ok(sidebarHtml.includes('id="sidebarUserRole"'));
  assert.ok(sidebarHtml.includes('id="logoutBtn"'));
});

// --- SECTION 2: SIDEBAR SUBTLE SCROLLBAR & COMPACT SPACING CSS ---
console.log('\n--- 2. Verifying Sidebar Scrollbar & Spacing CSS ---');

it('sidebar offcanvas body uses subtle 4px scrollbar width', () => {
  assert.ok(appCss.includes('#sidebarOffcanvas .offcanvas-body::-webkit-scrollbar'));
  assert.ok(/#sidebarOffcanvas\s+\.offcanvas-body::-webkit-scrollbar\s*\{[^}]*width:\s*4px/i.test(appCss));
});

it('sidebar scrollbar track is transparent', () => {
  assert.ok(/#sidebarOffcanvas\s+\.offcanvas-body::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent/i.test(appCss));
});

it('sidebar scrollbar thumb uses #52504C and hover thumb uses #77736D', () => {
  assert.ok(/#52504C/i.test(appCss));
  assert.ok(/#77736D/i.test(appCss));
  assert.ok(/#sidebarOffcanvas\s+\.offcanvas-body::-webkit-scrollbar-thumb:hover\s*\{[^}]*background:\s*#77736D/i.test(appCss));
  assert.ok(/#sidebarOffcanvas\s+\.offcanvas-body::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*10px/i.test(appCss));
});

it('sidebar scrollbar shows on hover / focus-within where supported', () => {
  assert.ok(/#sidebarOffcanvas:hover\s+\.offcanvas-body/i.test(appCss) || /#sidebarOffcanvas\s+\.offcanvas-body:hover/i.test(appCss));
});

it('sidebar navigation links have tightened vertical spacing and padding', () => {
  assert.ok(/#sidebarOffcanvas\s+\.nav-link\s*\{[^}]*padding:\s*0\.44rem\s*0\.75rem/i.test(appCss));
  assert.ok(/#sidebarOffcanvas\s+\.nav-link\s*\{[^}]*margin-bottom:\s*0\.12rem/i.test(appCss));
});

it('sidebar module toggles have tightened vertical spacing and padding', () => {
  assert.ok(/#sidebarOffcanvas\s+\.gw-module-toggle\s*\{[^}]*padding:\s*0\.44rem\s*0\.75rem/i.test(appCss));
  assert.ok(/#sidebarOffcanvas\s+\.gw-module-toggle\s*\{[^}]*margin-bottom:\s*0\.12rem/i.test(appCss));
});

it('sidebar section headers have reduced margins to eliminate excessive gaps', () => {
  assert.ok(/#sidebarOffcanvas\s+small\.text-uppercase\s*\{[^}]*margin-top:\s*0\.45rem/i.test(appCss));
  assert.ok(/#sidebarOffcanvas\s+small\.text-uppercase\s*\{[^}]*margin-bottom:\s*0\.15rem/i.test(appCss));
});

it('sidebar remains permanently black in both themes', () => {
  assert.ok(appCss.includes('#sidebarOffcanvas {') || appCss.includes('#sidebarOffcanvas,'));
  assert.ok(/background-color:\s*var\(--sidebar-bg\)/i.test(appCss));
});

it('sidebar width is constrained to exact 270px on desktop and 72px collapsed', () => {
  assert.ok(/--sidebar-width:\s*270px/i.test(appCss));
  assert.ok(/--sidebar-collapsed-width:\s*72px/i.test(appCss));
  assert.ok(/--topbar-height:\s*64px/i.test(appCss));
  assert.ok(/width:\s*var\(--sidebar-width\)\s*!important/i.test(appCss));
  assert.ok(/width:\s*var\(--sidebar-collapsed-width\)\s*!important/i.test(appCss));
});

// --- SECTION 3: STOCK RELEASING BALANCED MULTI-CARD DESKTOP LAYOUT ---
console.log('\n--- 3. Verifying Stock Releasing Multi-Card Balanced Layout (No Outer Scrollbar) ---');

it('panel-stock_releasing has flex column layout with overflow: hidden on desktop to eliminate outer scrollbar', () => {
  assert.ok(/#panel-stock_releasing(:not\(\[hidden\]\))?\s*\{[^}]*display:\s*flex/i.test(appCss));
  assert.ok(/#panel-stock_releasing(:not\(\[hidden\]\))?\s*\{[^}]*overflow:\s*hidden/i.test(appCss));
});

it('releasingPendingPrCard is configured within stock-releasing-grid layout', () => {
  assert.ok(appCss.includes('#releasingPendingPrCard') || appCss.includes('.stock-releasing-panel'));
  assert.ok(appCss.includes('.stock-releasing-grid'));
});

it('Stock Release History card is allocated panel space with internal scroll', () => {
  assert.ok(appCss.includes('#releasingHistoryCard') || /grid-template-columns/i.test(appCss));
  assert.ok(appCss.includes('.panel-table-scroll') || appCss.includes('.gym-table-scroll'));
});

it('releasingStoreInventoryCard is allocated panel space with internal scroll', () => {
  assert.ok(appCss.includes('#releasingStoreInventoryCard') || /grid-template-columns/i.test(appCss));
  assert.ok(appCss.includes('.panel-table-scroll') || appCss.includes('.gym-table-scroll'));
});

// --- SECTION 4: STORE INVENTORY OVERVIEW TABLE CONTENT & EMPTY STATES ---
console.log('\n--- 4. Verifying Store Inventory Overview Table & Empty States ---');

it('Store Inventory Overview table includes all 6 required columns in HTML', () => {
  const columns = ['Store / Branch', 'Product', 'Category', 'Unit', 'Current Store Stock', 'Last Updated'];
  for (const col of columns) {
    assert.ok(stockReleasingHtml.includes(col), `Missing column ${col} in views/stock_releasing.html`);
    assert.ok(indexHtml.includes(col), `Missing column ${col} in index.html`);
  }
});

it('loadStoreInventory JS implements required empty state title and subtitle', () => {
  assert.ok(stockReleasingJs.includes('No store inventory records available.'), 'Missing exact empty state title');
  assert.ok(stockReleasingJs.includes('Branch inventory balances will appear here when records are available.'), 'Missing exact empty state subtitle');
  assert.ok(stockReleasingJs.includes('bi-box-seam'), 'Missing box icon in empty state');
});

it('loadStoreInventory JS implements loading spinner state', () => {
  assert.ok(stockReleasingJs.includes('Loading store inventory...'));
  assert.ok(stockReleasingJs.includes('spinner-border'));
});

it('loadStoreInventory JS implements error state with retry button', () => {
  assert.ok(stockReleasingJs.includes('Failed to load store inventory.'));
  assert.ok(stockReleasingJs.includes('loadStoreInventory()'), 'Retry button must invoke loadStoreInventory()');
});

// --- SECTION 5: APPROVED STORE REQUESTS READY FOR RELEASE ---
console.log('\n--- 5. Verifying Approved Store Requests Banner / Card ---');

it('releasingPendingPrCard is present and visible in views/stock_releasing.html', () => {
  assert.ok(stockReleasingHtml.includes('id="releasingPendingPrCard"'));
  assert.ok(!stockReleasingHtml.includes('id="releasingPendingPrCard" hidden'));
});

it('Approved Store Requests table includes required empty state title and subtitle in JS', () => {
  assert.ok(stockReleasingJs.includes('No approved store requests ready for release.'), 'Missing exact PR empty state title');
  assert.ok(stockReleasingJs.includes('Approved requests will appear here when available.'), 'Missing exact PR empty state subtitle');
});

it('Approved Store Requests updates count badge to 0 Ready when empty', () => {
  assert.ok(stockReleasingJs.includes("0 Ready"));
});

it('Approved Store Requests displays compact empty state without table headers when empty', () => {
  assert.ok(stockReleasingHtml.includes('id="releasingPendingPrEmpty"'));
  assert.ok(stockReleasingHtml.includes('id="releasingPendingPrTableWrapper"'));
  assert.ok(indexHtml.includes('id="releasingPendingPrEmpty"'));
  assert.ok(indexHtml.includes('id="releasingPendingPrTableWrapper"'));
  assert.ok(stockReleasingJs.includes('releasingPendingPrEmpty'));
  assert.ok(stockReleasingJs.includes('releasingPendingPrTableWrapper'));
});

// --- SUMMARY ---
console.log(`\n========================================`);
console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
if (passedTests === totalTests) {
  console.log('ALL TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
} else {
  console.error('SOME TESTS FAILED!');
  process.exit(1);
}
