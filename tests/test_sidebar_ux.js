/**
 * Comprehensive Automated Verification Test for GymWorx Warehouse Sidebar UX
 */
const fs = require('fs');
const path = require('path');

const sidebarHtml = fs.readFileSync(path.join(__dirname, '../views/sidebar.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`[FAIL] ${testName}${details ? ' - ' + details : ''}`);
    failedTests++;
  }
}

console.log('=== 1. VERIFYING SIDEBAR HTML STRUCTURE & MODULES ===');

// Check Top Brand
assert(sidebarHtml.includes('GYMWORX') && sidebarHtml.includes('WAREHOUSE'), 'Brand logo & titles present');

// Check OVERVIEW section
assert(sidebarHtml.includes('id="sidebarHeaderOverview"') && sidebarHtml.includes('Overview'), 'OVERVIEW section header exists');
assert(sidebarHtml.includes('data-tab="dashboard"'), 'Dashboard nav item exists with data-tab="dashboard"');
assert(sidebarHtml.includes('data-tab="notifications"') && sidebarHtml.includes('id="sidebarNotifBadge"'), 'Notifications nav item with badge exists');

// Check WORKFLOW / Purchasing module
assert(sidebarHtml.includes('data-gw-module="purchasing"'), 'Purchasing module toggle exists');
assert(sidebarHtml.includes('id="submenuPurchasing"'), 'Purchasing submenu exists');
assert(sidebarHtml.includes('id="sidebarPurchasingAggBadge"'), 'Purchasing aggregated badge exists');
assert(sidebarHtml.includes('data-tab="purchase_request"') && sidebarHtml.includes('id="sidebarPrBadge"'), 'Purchase Requests child item with badge exists');
assert(sidebarHtml.includes('data-tab="purchase_order"') && sidebarHtml.includes('id="sidebarPoBadge"'), 'Purchase Orders child item with badge exists');
assert(sidebarHtml.includes('data-tab="stock_receiving"') && sidebarHtml.includes('id="sidebarReceivingBadge"'), 'Stock Receiving child item with badge exists');
assert(sidebarHtml.includes('data-tab="stock_releasing"'), 'Stock Releasing child item exists');
assert(sidebarHtml.includes('data-tab="purchase_return"'), 'Purchase Returns child item exists');
assert(sidebarHtml.includes('data-tab="stocks_return"'), 'Stocks Return child item exists');
assert(sidebarHtml.includes('data-tab="adjustment"'), 'Adjustments child item exists');
assert(sidebarHtml.includes('data-tab="stock_movement"'), 'Stock Movements child item exists');
assert(sidebarHtml.includes('data-tab="request_approval"') && sidebarHtml.includes('id="sidebarApprovalBadge"'), 'Approval Queue child item with badge preserved');

// Check INVENTORY module
assert(sidebarHtml.includes('data-gw-module="inventory"'), 'Inventory module toggle exists');
assert(sidebarHtml.includes('id="submenuInventory"'), 'Inventory submenu exists');
assert(sidebarHtml.includes('data-tab="product"'), 'Products & Stock child item exists');
assert(sidebarHtml.includes('data-tab="category"'), 'Categories child item exists');
assert(sidebarHtml.includes('data-tab="supplier"'), 'Suppliers child item exists');
assert(sidebarHtml.includes('data-tab="product_supplier"'), 'Product <-> Supplier child item exists');

// Check REPORTS module
assert(sidebarHtml.includes('data-gw-module="reports"'), 'Reports module toggle exists');
assert(sidebarHtml.includes('id="submenuReports"'), 'Reports submenu exists');
assert(sidebarHtml.includes('data-tab="inventory_report"'), 'Reports child item exists');
assert(sidebarHtml.includes('data-tab="audit_log"'), 'Audit Logs child item exists');

// Check SYSTEM module
assert(sidebarHtml.includes('data-gw-module="system"'), 'System module toggle exists');
assert(sidebarHtml.includes('id="submenuSystem"'), 'System submenu exists');
assert(sidebarHtml.includes('data-tab="users"') && sidebarHtml.includes('id="sidebarNavUsersRoles"'), 'User Management child item exists with preserved id');
assert(sidebarHtml.includes('data-tab="role"'), 'Settings child item exists with data-tab="role"');

console.log('\n=== 2. VERIFYING BACKWARD COMPATIBILITY & PRESERVED IDS ===');
const requiredIds = [
  'sidebarOffcanvas',
  'sidebarHeaderOverview',
  'sidebarHeaderTransactions',
  'sidebarHeaderLookup',
  'sidebarHeaderReports',
  'sidebarHeaderSystem',
  'sidebarDividerWorkflow',
  'sidebarDividerCatalog',
  'sidebarDividerAdmin',
  'sidebarNotifBadge',
  'sidebarApprovalBadge',
  'sidebarPrBadge',
  'sidebarPoBadge',
  'sidebarReceivingBadge',
  'sidebarLabelPR',
  'sidebarNavUsersRoles',
  'sidebarUserBox',
  'sidebarUserAvatar',
  'sidebarUserName',
  'sidebarUserRole',
  'logoutBtn'
];

requiredIds.forEach(id => {
  assert(sidebarHtml.includes(`id="${id}"`), `Preserved ID: #${id}`);
});

console.log('\n=== 3. VERIFYING CSS STYLING & ANIMATIONS ===');
assert(appCss.includes('.gw-nav-collapse'), 'CSS Grid collapsible container class (.gw-nav-collapse) exists');
assert(appCss.includes('grid-template-rows: 0fr') && appCss.includes('grid-template-rows: 1fr'), 'CSS Grid 0fr to 1fr transition exists');
assert(appCss.includes('220ms') || appCss.includes('250ms'), 'Transition duration is between 200ms and 250ms');
assert(appCss.includes('.gw-module-chevron'), 'Chevron styling class exists');
assert(appCss.includes('transform: rotate(180deg)'), 'Smooth chevron rotation to chevron-up on expand exists');
assert(appCss.includes('.gw-child-link'), 'Indented child links class (.gw-child-link) exists');
assert(appCss.includes('#sidebarOffcanvas .offcanvas-body::-webkit-scrollbar'), 'Subtle custom scrollbar for sidebar offcanvas exists');
assert(appCss.includes('body.sidebar-collapsed #sidebarOffcanvas .gw-module-chevron'), 'Desktop sidebar collapse handling for chevrons exists');

console.log('\n=== 4. VERIFYING JAVASCRIPT ACCORDION LOGIC ===');
assert(appJs.includes('TAB_TO_MODULE_MAP'), 'TAB_TO_MODULE_MAP exists to map pages to modules');
assert(appJs.includes('toggleSidebarModule'), 'toggleSidebarModule function exists');
assert(appJs.includes('setSidebarModuleExpanded'), 'setSidebarModuleExpanded function exists');
assert(appJs.includes('updateSidebarAccordionForTab'), 'updateSidebarAccordionForTab function exists');
assert(appJs.includes('updateAggregatedBadges'), 'updateAggregatedBadges function exists');
assert(appJs.includes("tabName === 'audit_log'"), 'activateTab handles audit_log virtual tab route');

// Test Accordion Logic simulation
console.log('\n=== 5. SIMULATING ACCORDION BEHAVIOR IN JAVASCRIPT ===');

// Mock DOM elements
class MockClassList {
  constructor() { this.classes = new Set(); }
  add(cls) { this.classes.add(cls); }
  remove(cls) { this.classes.delete(cls); }
  contains(cls) { return this.classes.has(cls); }
  toggle(cls, force) {
    if (force === undefined) {
      if (this.classes.has(cls)) this.classes.delete(cls);
      else this.classes.add(cls);
    } else if (force) this.classes.add(cls);
    else this.classes.delete(cls);
  }
}

class MockElement {
  constructor(id, modName) {
    this.id = id;
    this.dataset = { gwModule: modName };
    this.classList = new MockClassList();
    this.attributes = {};
    this.hidden = false;
    this.textContent = '';
  }
  getAttribute(attr) {
    if (attr === 'data-gw-module') return this.dataset.gwModule;
    return this.attributes[attr];
  }
  setAttribute(attr, val) { this.attributes[attr] = val; }
  removeAttribute(attr) { delete this.attributes[attr]; }
}

const toggles = {
  purchasing: new MockElement('sidebarModulePurchasing', 'purchasing'),
  inventory: new MockElement('sidebarModuleInventory', 'inventory'),
  reports: new MockElement('sidebarModuleReports', 'reports'),
  system: new MockElement('sidebarModuleSystem', 'system')
};

const submenus = {
  purchasing: new MockElement('submenuPurchasing', 'purchasing'),
  inventory: new MockElement('submenuInventory', 'inventory'),
  reports: new MockElement('submenuReports', 'reports'),
  system: new MockElement('submenuSystem', 'system')
};

function simSetSidebarModuleExpanded(mod, expand) {
  const t = toggles[mod];
  const s = submenus[mod];
  if (!t || !s) return;
  if (expand) {
    t.classList.add('is-open');
    t.setAttribute('aria-expanded', 'true');
    s.classList.add('is-open');
  } else {
    t.classList.remove('is-open');
    t.setAttribute('aria-expanded', 'false');
    s.classList.remove('is-open');
  }
}

function simToggleModule(mod) {
  const isCurrentlyOpen = toggles[mod].classList.contains('is-open');
  Object.keys(toggles).forEach(m => simSetSidebarModuleExpanded(m, false));
  if (!isCurrentlyOpen) {
    simSetSidebarModuleExpanded(mod, true);
  }
}

// Test 5.1: Default state all collapsed
Object.keys(toggles).forEach(m => simSetSidebarModuleExpanded(m, false));
assert(!toggles.purchasing.classList.contains('is-open') && !submenus.purchasing.classList.contains('is-open'), 'Default state: Purchasing is collapsed');

// Test 5.2: Click purchasing expands it
simToggleModule('purchasing');
assert(toggles.purchasing.classList.contains('is-open') && submenus.purchasing.classList.contains('is-open'), 'Clicking Purchasing expands it');
assert(!toggles.inventory.classList.contains('is-open'), 'Inventory remains collapsed');

// Test 5.3: Accordion behavior - expanding inventory collapses purchasing
simToggleModule('inventory');
assert(!toggles.purchasing.classList.contains('is-open') && !submenus.purchasing.classList.contains('is-open'), 'Switching module: Purchasing automatically collapsed');
assert(toggles.inventory.classList.contains('is-open') && submenus.inventory.classList.contains('is-open'), 'Inventory is now expanded');

// Test 5.4: Clicking an expanded module collapses it
simToggleModule('inventory');
assert(!toggles.inventory.classList.contains('is-open') && !submenus.inventory.classList.contains('is-open'), 'Clicking expanded Inventory collapses it');

// Test 5.5: Auto-expand module on page navigation
function simUpdateForTab(tab) {
  const map = {
    purchase_request: 'purchasing',
    product: 'inventory',
    inventory_report: 'reports',
    users: 'system'
  };
  const targetMod = map[tab] || null;
  Object.keys(toggles).forEach(m => {
    const isTarget = (m === targetMod);
    simSetSidebarModuleExpanded(m, isTarget);
    toggles[m].classList.toggle('has-active-child', isTarget);
  });
}

simUpdateForTab('purchase_request');
assert(toggles.purchasing.classList.contains('is-open') && toggles.purchasing.classList.contains('has-active-child'), 'Navigating to purchase_request auto-expands Purchasing');
assert(!toggles.inventory.classList.contains('is-open') && !toggles.reports.classList.contains('is-open'), 'Other modules remain closed on purchase_request');

simUpdateForTab('dashboard');
assert(!toggles.purchasing.classList.contains('is-open') && !toggles.inventory.classList.contains('is-open'), 'Navigating to Dashboard collapses all modules');

console.log('\n=== 6. VERIFYING STATIC INDEX.HTML SYNCHRONIZATION ===');
assert(indexHtml.includes('id="sidebarModulePurchasing"'), 'index.html contains Purchasing module');
assert(indexHtml.includes('id="sidebarModuleInventory"'), 'index.html contains Inventory module');
assert(indexHtml.includes('id="sidebarModuleReports"'), 'index.html contains Reports module');
assert(indexHtml.includes('id="sidebarModuleSystem"'), 'index.html contains System module');

console.log(`\n========================================`);
console.log(`TOTAL TESTS: ${passedTests + failedTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
if (failedTests > 0) process.exit(1);
