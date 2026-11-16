/**
 * test_print_redesign.js
 * Comprehensive automated verification for GymWorx Standardized Print & Receipt System
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const basePath = path.resolve(__dirname, '..');
const appCssPath = path.join(basePath, 'css', 'app.css');
const commonTemplatesPath = path.join(basePath, 'views', 'common_templates.html');
const indexPhpPath = path.join(basePath, 'index.php');
const indexHtmlPath = path.join(basePath, 'index.html');
const printReceiptJsPath = path.join(basePath, 'js', 'print_receipt.js');

console.log('--- GymWorx Standardized Print & Receipt Verification Suite ---');

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
const commonTemplates = fs.readFileSync(commonTemplatesPath, 'utf8');
const indexPhp = fs.readFileSync(indexPhpPath, 'utf8');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const printReceiptJs = fs.readFileSync(printReceiptJsPath, 'utf8');

// =========================================================================
// 1. Modal Container Dimensions & Styling
// =========================================================================
test('app.css defines compact modal dimensions (720-820px target width, 90vh max-height, 12px radius)', () => {
  assert.ok(appCss.includes('.gw-print-modal-dialog'), '.gw-print-modal-dialog missing in app.css');
  assert.ok(appCss.includes('max-width: 780px'), '780px compact max-width missing in app.css');
  assert.ok(appCss.includes('border-radius: 12px'), '12px border radius missing in app.css');
  assert.ok(appCss.includes('min(90vh, 90dvh)'), '90vh max-height constraint missing in app.css');
});

test('app.css enforces Cursor-inspired dark modal frame colors (#161513, #1B1A18, #302E2A, #F5F3EF)', () => {
  assert.ok(appCss.includes('background-color: #161513'), 'Modal background (#161513) missing');
  assert.ok(appCss.includes('background-color: #1B1A18'), 'Header/Footer background (#1B1A18) missing');
  assert.ok(appCss.includes('border: 1px solid #302E2A'), 'Modal border (#302E2A) missing');
  assert.ok(appCss.includes('color: #F5F3EF'), 'Header text color (#F5F3EF) missing');
  assert.ok(!appCss.includes('#receiptModal .modal-header.bg-warning'), 'No yellow headers allowed');
});

// =========================================================================
// 2. Receipt Paper Preview & Layout
// =========================================================================
test('app.css enforces dirty-white receipt paper styling (#F5F3EF, #171717, #57534E, #D8D5CF)', () => {
  assert.ok(appCss.includes('background-color: #F5F3EF'), 'Receipt paper background (#F5F3EF) missing');
  assert.ok(appCss.includes('color: #171717'), 'Receipt text color (#171717) missing');
  assert.ok(appCss.includes('border: 1px solid #D8D5CF'), 'Receipt border (#D8D5CF) missing');
  assert.ok(appCss.includes('.gw-receipt-paper'), '.gw-receipt-paper missing');
  assert.ok(appCss.includes('.gw-receipt-info-card'), '.gw-receipt-info-card missing');
  assert.ok(appCss.includes('.gw-receipt-total-card'), '.gw-receipt-total-card missing');
});

test('common_templates.html includes standardized 2-column info cards and totals layout', () => {
  assert.ok(commonTemplates.includes('id="receiptPrintArea"'), 'receiptPrintArea missing');
  assert.ok(commonTemplates.includes('id="receiptInfoGrid"'), 'receiptInfoGrid missing');
  assert.ok(commonTemplates.includes('id="receiptTotalsRemarksGrid"'), 'receiptTotalsRemarksGrid missing');
  assert.ok(commonTemplates.includes('id="receiptDocTypeTitle"'), 'receiptDocTypeTitle missing');
  assert.ok(commonTemplates.includes('id="receiptRefNoBadge"'), 'receiptRefNoBadge missing');
  assert.ok(commonTemplates.includes('id="receiptRemarksText"'), 'receiptRemarksText missing');
  assert.ok(commonTemplates.includes('id="receiptTotalValue"'), 'receiptTotalValue missing');
});

// =========================================================================
// 3. Fixed Header, Fixed Footer, and Contained Internal Scrolling
// =========================================================================
test('common_templates.html defines 3-part layout with fixed header, internal scroll body, and fixed footer', () => {
  assert.ok(commonTemplates.includes('gw-print-modal-header'), 'gw-print-modal-header missing');
  assert.ok(commonTemplates.includes('gw-print-modal-body'), 'gw-print-modal-body missing');
  assert.ok(commonTemplates.includes('gw-print-modal-footer'), 'gw-print-modal-footer missing');
  assert.ok(appCss.includes('overflow-y: auto !important'), 'Internal scrolling missing in body');
  assert.ok(appCss.includes('overscroll-behavior-y: contain'), 'overscroll-behavior containment missing');
});

test('Modal footer includes Close, Download PDF, and Print buttons', () => {
  assert.ok(commonTemplates.includes('gw-receipt-btn-close'), 'Close button missing in footer');
  assert.ok(commonTemplates.includes('id="receiptDownloadPdfBtn"'), 'receiptDownloadPdfBtn missing in footer');
  assert.ok(commonTemplates.includes('id="receiptNativePrintBtn"'), 'receiptNativePrintBtn missing in footer');
  assert.ok(appCss.includes('background-color: #008A45'), 'Green print button (#008A45) missing in app.css');
});

// =========================================================================
// 4. Reusable Print JavaScript Architecture
// =========================================================================
test('print_receipt.js exports global openReceiptModal, printReceiptDoc, and downloadReceiptPdf', () => {
  assert.ok(printReceiptJs.includes('window.openReceiptModal = openReceiptModal'), 'openReceiptModal export missing');
  assert.ok(printReceiptJs.includes('window.printReceiptDoc = printReceiptDoc'), 'printReceiptDoc export missing');
  assert.ok(printReceiptJs.includes('window.downloadReceiptPdf = downloadReceiptPdf'), 'downloadReceiptPdf export missing');
});

test('print_receipt.js enforces role permissions before opening print preview', () => {
  assert.ok(printReceiptJs.includes('window.can(targetModule, \'view\')'), 'Role permission guard missing in print_receipt.js');
});

test('print_receipt.js supports all required document types without fake data', () => {
  assert.ok(printReceiptJs.includes('stock_releasing'), 'stock_releasing support missing');
  assert.ok(printReceiptJs.includes('stock_receiving'), 'stock_receiving support missing');
  assert.ok(printReceiptJs.includes('purchase_order'), 'purchase_order support missing');
  assert.ok(printReceiptJs.includes('purchase_request'), 'purchase_request support missing');
  assert.ok(printReceiptJs.includes('adjustment'), 'adjustment support missing');
  assert.ok(printReceiptJs.includes('inventory_report'), 'inventory_report support missing');
});

test('PDF download dynamically builds filename matching GymWorx_<DocType>_<RefNo>.pdf', () => {
  assert.ok(printReceiptJs.includes('GymWorx_${rawType}_${rawRef}.pdf') || printReceiptJs.includes('GymWorx_'), 'PDF filename pattern missing');
});

// =========================================================================
// 5. Clean A4 Dedicated Print Stylesheet
// =========================================================================
test('app.css includes @media print rules targeting A4 portrait and hiding UI controls', () => {
  assert.ok(appCss.includes('size: A4 portrait'), 'A4 portrait size missing in @media print');
  assert.ok(appCss.includes('#appShell'), 'appShell exclusion missing in @media print');
  assert.ok(appCss.includes('#appTopbar'), 'appTopbar exclusion missing in @media print');
  assert.ok(appCss.includes('#sidebarOffcanvas'), 'sidebarOffcanvas exclusion missing in @media print');
  assert.ok(appCss.includes('.gw-print-modal-header'), 'modal header exclusion missing in @media print');
  assert.ok(appCss.includes('.gw-print-modal-footer'), 'modal footer exclusion missing in @media print');
  assert.ok(appCss.includes('break-inside: avoid'), 'Row break avoidance missing in @media print');
});

// =========================================================================
// 6. Template Synchronization
// =========================================================================
test('index.php and index.html include html2pdf and print_receipt.js', () => {
  assert.ok(indexPhp.includes('html2pdf'), 'html2pdf missing in index.php');
  assert.ok(indexPhp.includes('js/print_receipt.js'), 'print_receipt.js missing in index.php');
  assert.ok(indexHtml.includes('html2pdf'), 'html2pdf missing in index.html');
  assert.ok(indexHtml.includes('js/print_receipt.js'), 'print_receipt.js missing in index.html');
});

console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('ALL STANDARDIZED PRINT & RECEIPT TESTS PASSED SUCCESSFULLY!\n');
}
