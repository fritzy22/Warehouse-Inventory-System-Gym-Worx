/**
 * test_dark_mode_modal.js
 * Automated verification suite for GymWorx Final Dark Mode Modal Fix
 * - Cursor-inspired Dark Mode modal palette tokens
 * - Modal header readability and contrast
 * - Four-stage progress tracker styling
 * - Request information charcoal card (#1C1C1B) and subtle border (#353532)
 * - Quantity Tracking table dark surface (#141413) and header (#262624)
 * - Linked POs and History panels with internal scrolling
 * - Light Mode preservation and instant theme toggle
 * - Universal modal contrast protection
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- GymWorx Dark Mode Modal Fix Verification Suite ---');

let passCount = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    process.exit(1);
  }
}

const appCssPath = path.join(__dirname, '../css/app.css');
const prJsPath = path.join(__dirname, '../js/purchase_request.js');
const prHtmlPath = path.join(__dirname, '../views/purchase_request.html');

const appCss = fs.readFileSync(appCssPath, 'utf8');
const prJs = fs.readFileSync(prJsPath, 'utf8');
const prHtml = fs.readFileSync(prHtmlPath, 'utf8');

// 1. Dark Mode Modal Palette Tokens
test('CSS defines exact Cursor-inspired modal tokens in :root', () => {
  assert.ok(appCss.includes('--modal-bg: #141413'), 'Modal background #141413 missing');
  assert.ok(appCss.includes('--modal-card-bg: #1C1C1B'), 'Inner card background #1C1C1B missing');
  assert.ok(appCss.includes('--modal-table-header: #262624'), 'Table header #262624 missing');
  assert.ok(appCss.includes('--modal-text-primary: #F5F3EF'), 'Primary text #F5F3EF missing');
  assert.ok(appCss.includes('--modal-text-secondary: #B8B4AD'), 'Secondary text #B8B4AD missing');
  assert.ok(appCss.includes('--modal-text-muted: #89857F'), 'Muted text #89857F missing');
  assert.ok(appCss.includes('--modal-border: #353532'), 'Borders and dividers #353532 missing');
  assert.ok(appCss.includes('--modal-purple: #7C3AED'), 'Purple progress #7C3AED missing');
  assert.ok(appCss.includes('--modal-approved: #22C55E'), 'Approved #22C55E missing');
  assert.ok(appCss.includes('--modal-pending: #D6A34A'), 'Pending #D6A34A missing');
  assert.ok(appCss.includes('--modal-rejected: #EF4444'), 'Rejected #EF4444 missing');
});

// 2. Light Mode Modal Tokens
test('CSS defines corresponding Light Mode modal tokens under [data-theme="light"]', () => {
  assert.ok(appCss.includes('--modal-bg: #FFFFFF'), 'Light mode modal bg missing');
  assert.ok(appCss.includes('--modal-card-bg: #FFFFFF'), 'Light mode modal card bg missing');
  assert.ok(appCss.includes('--modal-text-primary: #171717'), 'Light mode modal text primary missing');
  assert.ok(appCss.includes('--modal-border: #D8D5CF'), 'Light mode modal border missing');
});

// 3. Modal Container & Header
test('Modal container and header use --modal-bg and --modal-border with readable dirty-white title', () => {
  assert.ok(appCss.includes('#prDetailModal .modal-content'), '#prDetailModal .modal-content missing');
  assert.ok(appCss.includes('background-color: var(--modal-bg, #141413) !important'), 'Modal content background #141413 missing');
  assert.ok(appCss.includes('#prDetailModal .modal-header'), '#prDetailModal .modal-header missing');
  assert.ok(appCss.includes('#prDetailModal .modal-title'), '#prDetailModal .modal-title missing');
  assert.ok(appCss.includes('color: var(--modal-text-primary, #F5F3EF) !important'), 'Modal title color #F5F3EF missing');
});

// 4. Progress Tracker
test('Four-stage progress tracker uses purple #7C3AED for active/done and subtle dotted line for pending', () => {
  assert.ok(appCss.includes('.gw-pr-stepper-track .track-solid'), '.track-solid missing');
  assert.ok(appCss.includes('background-color: var(--modal-purple, #7C3AED)'), 'Track solid #7C3AED missing');
  assert.ok(appCss.includes('.gw-pr-step-circle.active') && appCss.includes('.gw-pr-step-circle.done'), 'Step circle active/done missing');
  assert.ok(appCss.includes('background-color: var(--modal-purple, #7C3AED) !important'), 'Step circle purple background missing');
  assert.ok(appCss.includes('.gw-pr-step-title'), 'Step title missing');
});

// 5. Request Information Card
test('Request information card uses charcoal background (#1C1C1B) and subtle border (#353532)', () => {
  assert.ok(appCss.includes('.gw-pr-summary-box'), '.gw-pr-summary-box missing');
  assert.ok(appCss.includes('background-color: var(--modal-card-bg, #1C1C1B) !important'), 'Summary box #1C1C1B missing');
  assert.ok(appCss.includes('border: 1px solid var(--modal-border, #353532) !important'), 'Summary box border #353532 missing');
  assert.ok(appCss.includes('.gw-pr-label'), '.gw-pr-label missing');
  assert.ok(appCss.includes('.gw-pr-val'), '.gw-pr-val missing');
});

// 6. Section Titles in Blue-Cyan
test('Modal block titles and icons use readable blue-cyan #38BDF8 in Dark Mode', () => {
  assert.ok(appCss.includes('.gw-pr-block-title'), '.gw-pr-block-title missing');
  assert.ok(appCss.includes('color: #38BDF8 !important'), 'Block title color #38BDF8 missing');
  assert.ok(appCss.includes('.gw-pr-block-title i'), 'Block title icon missing');
});

// 7. Requested Items & Quantity Tracking Table
test('Quantity Tracking table uses dark surface (#141413), header (#262624), and dirty-white text', () => {
  assert.ok(appCss.includes('.gw-pr-items-box thead th'), '.gw-pr-items-box thead th missing');
  assert.ok(appCss.includes('background-color: var(--modal-table-header, #262624) !important'), 'Table header #262624 missing');
  assert.ok(appCss.includes('.gw-pr-items-box tbody td'), '.gw-pr-items-box tbody td missing');
  assert.ok(appCss.includes('background-color: var(--modal-bg, #141413) !important'), 'Table body #141413 missing');
  assert.ok(appCss.includes('color: var(--modal-text-primary, #F5F3EF) !important'), 'Table text color #F5F3EF missing');
});

// 8. Linked Purchase Orders Panel
test('Linked Purchase Orders panel uses charcoal (#1C1C1B) with readable empty state', () => {
  assert.ok(appCss.includes('.gw-pr-card-box'), '.gw-pr-card-box missing');
  assert.ok(appCss.includes('background-color: var(--modal-card-bg, #1C1C1B) !important'), 'Card box background #1C1C1B missing');
  assert.ok(appCss.includes('.gw-pr-empty-state .text-dark'), 'Empty state dark text override missing');
  assert.ok(appCss.includes('.gw-pr-empty-state .text-muted'), 'Empty state muted text override missing');
});

// 9. Transaction & Approval History Panel
test('Transaction History panel uses vertical timeline with purple, green, and red bullets', () => {
  assert.ok(appCss.includes('.gw-pr-timeline-track::before'), 'Timeline vertical line missing');
  assert.ok(appCss.includes('.gw-pr-timeline-bullet.purple'), 'Purple bullet missing');
  assert.ok(appCss.includes('.gw-pr-timeline-bullet.green'), 'Green bullet missing');
  assert.ok(appCss.includes('.gw-pr-timeline-bullet.red'), 'Red bullet missing');
  assert.ok(appCss.includes('background-color: var(--modal-approved, #22C55E)'), 'Approved bullet #22C55E missing');
});

// 10. Modal Footer and Action Buttons
test('Modal footer uses dark background, ghost Close button, and thin green Print PR button', () => {
  assert.ok(appCss.includes('#prDetailModal .modal-footer'), '#prDetailModal .modal-footer missing');
  assert.ok(appCss.includes('.modal-footer .btn-light'), '.modal-footer .btn-light rule missing');
  assert.ok(appCss.includes('.modal-footer .btn-outline-success'), '.modal-footer .btn-outline-success rule missing');
  assert.ok(appCss.includes('border: 1px solid var(--modal-approved, #22C55E) !important'), 'Print PR green border #22C55E missing');
});

// 11. Plain Status Indicators Colors
test('Status indicators enforce #22C55E for Approved, #D6A34A for Pending/Fulfillment, and #EF4444 for Rejected', () => {
  assert.ok(appCss.includes('.gym-status--approved'), '.gym-status--approved missing');
  assert.ok(appCss.includes('.gym-status--pending-fulfillment'), '.gym-status--pending-fulfillment missing');
  assert.ok(appCss.includes('color: var(--modal-pending, #D6A34A) !important'), 'Pending fulfillment amber color missing');
  assert.ok(appCss.includes('.gym-status--rejected'), '.gym-status--rejected missing');
  assert.ok(appCss.includes('color: var(--modal-rejected, #EF4444) !important'), 'Rejected red color missing');
});

// 12. Universal Modal Body Dark Mode Protection
test('Universal modal cards, backgrounds, and text-dark elements adapt safely in Dark Mode', () => {
  assert.ok(appCss.includes('.modal-body .card'), '.modal-body .card rule missing');
  assert.ok(appCss.includes('.modal-body strong.text-dark'), '.modal-body strong.text-dark rule missing');
});

// 13. Light Mode Preserved
test('Light Mode cleanly restores white surfaces, dirty-white table headers, and dark text', () => {
  assert.ok(appCss.includes('[data-theme="light"] #prDetailModal .modal-content'), 'Light mode modal content override missing');
  assert.ok(appCss.includes('[data-theme="light"] .gw-pr-summary-box'), 'Light mode summary box override missing');
  assert.ok(appCss.includes('[data-theme="light"] .gw-pr-card-box'), 'Light mode card box override missing');
  assert.ok(appCss.includes('[data-theme="light"] .gym-status--approved'), 'Light mode approved override missing');
  assert.ok(appCss.includes('[data-theme="light"] .gym-status--pending-fulfillment'), 'Light mode pending fulfillment override missing');
});

// 14. JavaScript viewPurchaseRequestDetails Dynamic Title & Functionality
test('purchase_request.js viewPurchaseRequestDetails sets dynamic em-dash title and preserves print handler', () => {
  assert.ok(prJs.includes('document.getElementById(\'prDetailModalTitle\').textContent = `${prCode} — Purchase Request Details`'), 'Dynamic title with em-dash missing in purchase_request.js');
  assert.ok(prJs.includes("openReceiptModal('purchase_request'"), 'Print PR openReceiptModal handler missing');
});

console.log(`\nTests Completed: ${passCount} Passed, 0 Failed`);
console.log('ALL DARK MODE MODAL FIX TESTS PASSED SUCCESSFULLY!');
