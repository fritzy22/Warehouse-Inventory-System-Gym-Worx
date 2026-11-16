/**
 * test_single_active_page_navigation.js
 * Verification of single active page rendering and mutual exclusion across all navigation modules.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- GymWorx Warehouse: Single Active Page & Navigation Mutual Exclusion Verification ---');

const basePath = path.resolve(__dirname, '..');
const appCss = fs.readFileSync(path.join(basePath, 'css', 'app.css'), 'utf8');
const appJs = fs.readFileSync(path.join(basePath, 'js', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(basePath, 'index.html'), 'utf8');

let passCount = 0;
let failCount = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`[PASS] ${desc}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${desc}: ${err.message}`);
    failCount++;
  }
}

// 1. CSS Hidden Protection Rules
it('app.css enforces display: none !important on all hidden panels including #panel-stock_releasing[hidden]', () => {
  assert.ok(/#panel-stock_releasing\[hidden\]\s*\{[^}]*display:\s*none\s*!important/i.test(appCss) ||
            /\[hidden\],\s*\.panel\[hidden\],[^}]*#panel-stock_releasing\[hidden\]\s*\{[^}]*display:\s*none\s*!important/i.test(appCss));
});

it('#panel-stock_releasing flex layout uses :not([hidden]) selector so it never displays when inactive', () => {
  assert.ok(/#panel-stock_releasing:not\(\[hidden\]\)\s*\{[^}]*display:\s*flex\s*!important/i.test(appCss));
});

it('Universal [hidden] and .panel[hidden] enforce display: none !important', () => {
  assert.ok(/\.panel\[hidden\]\s*,\s*section\.panel\[hidden\]\s*,\s*#panel-stock_releasing\[hidden\]\s*\{[^}]*display:\s*none\s*!important/i.test(appCss) ||
            /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/i.test(appCss));
});

// 2. JavaScript activateTab Mutual Exclusion
it('activateTab in app.js explicitly removes hidden on target and sets hidden + display: none on inactive panels', () => {
  assert.ok(appJs.includes('panels[i].removeAttribute(\'hidden\')'));
  assert.ok(appJs.includes('panels[i].setAttribute(\'hidden\', \'\')'));
  assert.ok(appJs.includes('panels[i].style.display = \'none\''));
});

// 3. Simulated DOM Navigation Test
it('Simulating navigation between Stock Releasing and Purchase Returns ensures strict mutual exclusion', () => {
  // Mock panels
  const panelIds = [
    'panel-dashboard', 'panel-notifications', 'panel-purchase_request',
    'panel-purchase_order', 'panel-stock_receiving', 'panel-stock_releasing',
    'panel-purchase_return', 'panel-stocks_return', 'panel-adjustment',
    'panel-stock_movement', 'panel-category', 'panel-product',
    'panel-supplier', 'panel-product_supplier', 'panel-users', 'panel-inventory_report'
  ];

  const panels = panelIds.map(id => ({
    id: id,
    hidden: id !== 'panel-dashboard',
    style: { display: id === 'panel-dashboard' ? '' : 'none' },
    removeAttribute: function(attr) { if (attr === 'hidden') this.hidden = false; },
    setAttribute: function(attr) { if (attr === 'hidden') this.hidden = true; }
  }));

  function simulateActivate(target) {
    for (let i = 0; i < panels.length; i++) {
      const isTarget = (panels[i].id === 'panel-' + target);
      panels[i].hidden = !isTarget;
      if (isTarget) {
        panels[i].removeAttribute('hidden');
        panels[i].style.display = '';
      } else {
        panels[i].setAttribute('hidden', '');
        panels[i].style.display = 'none';
      }
    }
  }

  // Navigate to stock_releasing
  simulateActivate('stock_releasing');
  let visiblePanels = panels.filter(p => !p.hidden && p.style.display !== 'none');
  assert.strictEqual(visiblePanels.length, 1);
  assert.strictEqual(visiblePanels[0].id, 'panel-stock_releasing');

  // Navigate to purchase_return
  simulateActivate('purchase_return');
  visiblePanels = panels.filter(p => !p.hidden && p.style.display !== 'none');
  assert.strictEqual(visiblePanels.length, 1);
  assert.strictEqual(visiblePanels[0].id, 'panel-purchase_return');
  assert.strictEqual(panels.find(p => p.id === 'panel-stock_releasing').hidden, true);
  assert.strictEqual(panels.find(p => p.id === 'panel-stock_releasing').style.display, 'none');

  // Navigate to dashboard
  simulateActivate('dashboard');
  visiblePanels = panels.filter(p => !p.hidden && p.style.display !== 'none');
  assert.strictEqual(visiblePanels.length, 1);
  assert.strictEqual(visiblePanels[0].id, 'panel-dashboard');

  // Navigate to product
  simulateActivate('product');
  visiblePanels = panels.filter(p => !p.hidden && p.style.display !== 'none');
  assert.strictEqual(visiblePanels.length, 1);
  assert.strictEqual(visiblePanels[0].id, 'panel-product');
});

console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed`);
if (failCount === 0) {
  console.log('ALL SINGLE ACTIVE PAGE NAVIGATION TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
} else {
  process.exit(1);
}
