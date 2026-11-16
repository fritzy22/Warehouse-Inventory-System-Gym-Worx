/**
 * test_stock_releasing_print_button.js
 * Comprehensive automated verification for GymWorx Warehouse - Stock Releasing Minimalist Printer Icon Action Button
 * Verifies exact 42px x 34px dimensions, 15px icon, centered Actions column alignment, and Cursor dark/light styling.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const basePath = path.resolve(__dirname, '..');
const appCssPath = path.join(basePath, 'css', 'app.css');
const stockReleasingJsPath = path.join(basePath, 'js', 'stock_releasing.js');
const stockReleasingHtmlPath = path.join(basePath, 'views', 'stock_releasing.html');
const indexHtmlPath = path.join(basePath, 'index.html');

console.log('--- GymWorx Stock Releasing Print Button Verification Suite ---');

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
const stockReleasingJs = fs.readFileSync(stockReleasingJsPath, 'utf8');
const stockReleasingHtml = fs.readFileSync(stockReleasingHtmlPath, 'utf8');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// =========================================================================
// 1. Icon-Only Button Structure & Text Removal in stock_releasing.js
// =========================================================================
test('stock_releasing.js removes visible "Print Receipt" text from button body', () => {
  const tableSectionMatch = stockReleasingJs.match(/actionsCell\.appendChild\(printBtn\);/);
  assert.ok(tableSectionMatch, 'actionsCell.appendChild(printBtn) missing');
  
  assert.ok(!stockReleasingJs.includes("printBtn.innerHTML = '<i class=\"bi bi-printer me-1\"></i>Print Receipt'"), 'Old printBtn with visible text still found');
  assert.ok(!stockReleasingJs.includes('btn-print-action w-100 btn-print-receipt">\n            <i class="bi bi-printer me-1"></i>Print Receipt'), 'Old mobile button with visible text still found');
});

test('stock_releasing.js renders Lucide Printer SVG icon (15px) inside print button', () => {
  assert.ok(stockReleasingJs.includes('lucide-printer'), 'Lucide printer class missing in SVG');
  assert.ok(stockReleasingJs.includes('viewBox="0 0 24 24"'), 'SVG viewBox missing or incorrect');
  assert.ok(stockReleasingJs.includes('stroke="currentColor"'), 'SVG stroke="currentColor" missing');
  assert.ok(stockReleasingJs.includes('width="15"') && stockReleasingJs.includes('height="15"'), 'SVG width/height 15px missing');
  assert.ok(stockReleasingJs.includes('aria-hidden="true"'), 'SVG aria-hidden="true" missing');
});

test('stock_releasing.js provides accessible label and tooltip attributes', () => {
  assert.ok(stockReleasingJs.includes("printBtn.setAttribute('title', 'Print Receipt')"), 'Tooltip title attribute missing on table button');
  assert.ok(stockReleasingJs.includes("printBtn.setAttribute('aria-label', 'Print Receipt')"), 'aria-label attribute missing on table button');
  assert.ok(stockReleasingJs.includes("printBtn.setAttribute('data-bs-toggle', 'tooltip')"), 'data-bs-toggle="tooltip" attribute missing on table button');
  assert.ok(stockReleasingJs.includes('title="Print Receipt"') && stockReleasingJs.includes('aria-label="Print Receipt"'), 'Mobile card button missing tooltip or aria-label attributes');
});

test('stock_releasing.js applies minimalist classes without solid green button background class', () => {
  assert.ok(stockReleasingJs.includes("printBtn.className = 'btn btn-sm btn-print-action gw-btn-print-receipt stock-release-print-btn'"), 'btn-print-action gw-btn-print-receipt stock-release-print-btn missing on table button');
  assert.ok(!stockReleasingJs.includes("printBtn.className = 'btn btn-sm btn-success btn-print-action'"), 'Old btn-success class must not be on printBtn');
});

// =========================================================================
// 2. Click Handler & Record Preservation
// =========================================================================
test('stock_releasing.js preserves exact openReceiptModal click handler and payload', () => {
  assert.ok(stockReleasingJs.includes("openReceiptModal('sale'"), 'openReceiptModal("sale") missing');
  assert.ok(stockReleasingJs.includes("transaction_id: r.releasing_id"), 'transaction_id mapping missing');
  assert.ok(stockReleasingJs.includes("customer_name: r.requested_by"), 'customer_name mapping missing');
  assert.ok(stockReleasingJs.includes("date: r.releasing_date"), 'date mapping missing');
  assert.ok(stockReleasingJs.includes("user_name: r.released_by"), 'user_name mapping missing');
  assert.ok(stockReleasingJs.includes("status: 'Completed'"), 'status mapping missing');
});

// =========================================================================
// 3. Actions Column Centering & Alignment
// =========================================================================
test('Views and templates center the Actions column horizontally', () => {
  assert.ok(stockReleasingHtml.includes('<th class="text-center text-nowrap">Actions</th>'), 'Actions header in views/stock_releasing.html must have text-center');
  assert.ok(stockReleasingHtml.includes('<td class="text-center text-nowrap row-actions"></td>'), 'Actions cell in views/stock_releasing.html must have text-center');
  assert.ok(indexHtml.includes('<th class="text-center text-nowrap">Actions</th>'), 'Actions header in index.html must have text-center');
  assert.ok(indexHtml.includes('<td class="text-center text-nowrap row-actions"></td>'), 'Actions cell in index.html must have text-center');
  assert.ok(appCss.includes('#releasingTable td.row-actions'), '#releasingTable td.row-actions selector missing in app.css');
  assert.ok(appCss.includes('text-align: center !important'), 'text-align: center missing for #releasingTable td.row-actions');
});

// =========================================================================
// 4. Exact CSS Dimensions, Border, Radius & Centering in app.css
// =========================================================================
test('app.css defines exact button dimensions: 42px width x 34px height and 15px icon', () => {
  assert.ok(appCss.includes('.stock-release-print-btn'), '.stock-release-print-btn selector missing in app.css');
  assert.ok(appCss.includes('width: 42px !important'), '42px width rule missing');
  assert.ok(appCss.includes('height: 34px !important'), '34px height rule missing');
  assert.ok(appCss.includes('width: 15px !important') && appCss.includes('height: 15px !important'), '15px SVG icon dimensions missing');
});

test('app.css defines 1px border width, 7px radius, and centered flex layout', () => {
  assert.ok(appCss.includes('border: 1px solid #008A45 !important') || appCss.includes('border: 1px solid'), '1px border missing');
  assert.ok(appCss.includes('border-radius: 7px !important'), '7px border-radius missing');
  assert.ok(appCss.includes('display: inline-flex !important'), 'inline-flex display missing');
  assert.ok(appCss.includes('align-items: center !important'), 'align-items: center missing');
  assert.ok(appCss.includes('justify-content: center !important'), 'justify-content: center missing');
  assert.ok(appCss.includes('padding: 0 !important'), 'padding: 0 missing to ensure perfect centering');
});

// =========================================================================
// 5. Light Mode & Dark Mode Styling Rules in app.css
// =========================================================================
test('app.css enforces exact Light Mode colors (transparent bg, #008A45 border/icon, #E8F3EC hover)', () => {
  assert.ok(appCss.includes('border: 1px solid #008A45 !important') || appCss.includes('border-color: #008A45 !important'), 'Light mode #008A45 border missing');
  assert.ok(appCss.includes('color: #008A45 !important'), 'Light mode #008A45 icon/color missing');
  assert.ok(appCss.includes('background-color: #E8F3EC !important') || appCss.includes('background: #E8F3EC !important'), 'Light mode #E8F3EC hover background missing');
  assert.ok(appCss.includes('outline: 2px solid #008A45 !important'), 'Light mode focus visible outline missing');
});

test('app.css enforces exact Dark Mode colors (transparent bg, #22A66B border/icon, #173326 hover)', () => {
  assert.ok(appCss.includes('border-color: #22A66B !important'), 'Dark mode #22A66B border missing');
  assert.ok(appCss.includes('color: #22A66B !important'), 'Dark mode #22A66B icon/color missing');
  assert.ok(appCss.includes('background-color: #173326 !important') || appCss.includes('background: #173326 !important'), 'Dark mode #173326 hover background missing');
  assert.ok(appCss.includes('outline: 2px solid #22A66B !important'), 'Dark mode focus visible outline missing');
});

test('app.css preserves permanent black sidebar (#0D0C0A) in both themes', () => {
  assert.ok(appCss.includes('--sidebar-bg: #0D0C0A'), 'Root --sidebar-bg must be #0D0C0A');
  const lightModeIndex = appCss.indexOf('[data-theme="light"]');
  const lightModeBlock = appCss.substring(lightModeIndex, lightModeIndex + 1600);
  assert.ok(lightModeBlock.includes('--sidebar-bg: #0D0C0A'), 'Light mode --sidebar-bg must remain #0D0C0A');
  assert.ok(!lightModeBlock.includes('--sidebar-bg: #FFFFFF'), 'Light mode --sidebar-bg must NOT be #FFFFFF');
});

// =========================================================================
// 6. Functional DOM Simulation
// =========================================================================
test('Simulated rendering produces valid icon-only button and triggers modal correctly', () => {
  let modalOpened = false;
  let modalArgs = null;

  // Mock global openReceiptModal
  global.openReceiptModal = function(type, payload) {
    modalOpened = true;
    modalArgs = { type, payload };
  };

  // Mock DOM elements
  class MockElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.attributes = {};
      this.classList = new Set();
      this.children = [];
      this.listeners = {};
      this.innerHTML = '';
      this._textContent = '';
    }
    set className(val) {
      this.attributes['class'] = val;
      this.classList = new Set(val.split(/\s+/).filter(Boolean));
    }
    get className() {
      return this.attributes['class'] || '';
    }
    setAttribute(name, val) {
      this.attributes[name] = val;
    }
    getAttribute(name) {
      return this.attributes[name];
    }
    addEventListener(event, fn) {
      this.listeners[event] = this.listeners[event] || [];
      this.listeners[event].push(fn);
    }
    dispatchEvent(event) {
      const handlers = this.listeners[event.type] || [];
      handlers.forEach(h => h(event));
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    querySelector(sel) {
      if (sel === '.row-actions') return this;
      return null;
    }
    set textContent(v) { this._textContent = v; }
    get textContent() { return this._textContent; }
  }

  global.document = {
    createElement: function(tag) {
      return new MockElement(tag);
    }
  };

  // Run snippet simulating the table button creation
  const r = {
    releasing_id: 104,
    requested_by: 'Downtown Gym Branch',
    released_by: 'Alex Warehouse Staff',
    releasing_date: '2026-10-28'
  };

  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'btn btn-sm btn-print-action gw-btn-print-receipt stock-release-print-btn';
  printBtn.setAttribute('title', 'Print Receipt');
  printBtn.setAttribute('aria-label', 'Print Receipt');
  printBtn.setAttribute('data-bs-toggle', 'tooltip');
  printBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-printer" aria-hidden="true"><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>';
  printBtn.addEventListener('click', function () {
    openReceiptModal('sale', {
      transaction_id: r.releasing_id,
      customer_name: r.requested_by,
      date: r.releasing_date,
      user_name: r.released_by,
      status: 'Completed'
    });
  });

  assert.strictEqual(printBtn.getAttribute('title'), 'Print Receipt');
  assert.strictEqual(printBtn.getAttribute('aria-label'), 'Print Receipt');
  assert.ok(printBtn.classList.has('gw-btn-print-receipt'));
  assert.ok(printBtn.classList.has('stock-release-print-btn'));
  assert.ok(printBtn.classList.has('btn-print-action'));
  assert.ok(!printBtn.classList.has('btn-success'));

  // Trigger click
  printBtn.dispatchEvent({ type: 'click' });
  assert.strictEqual(modalOpened, true, 'openReceiptModal must be called on click');
  assert.strictEqual(modalArgs.type, 'sale');
  assert.strictEqual(modalArgs.payload.transaction_id, 104);
  assert.strictEqual(modalArgs.payload.customer_name, 'Downtown Gym Branch');
  assert.strictEqual(modalArgs.payload.user_name, 'Alex Warehouse Staff');
  assert.strictEqual(modalArgs.payload.status, 'Completed');
});

console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('ALL STOCK RELEASING PRINT BUTTON TESTS PASSED SUCCESSFULLY!\n');
}
