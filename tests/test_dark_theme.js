/**
 * test_dark_theme.js
 * Comprehensive automated verification for GymWorx Cursor-Inspired Dark Color Theme
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const basePath = path.resolve(__dirname, '..');
const appCssPath = path.join(basePath, 'css', 'app.css');
const indexPhpPath = path.join(basePath, 'index.php');
const indexHtmlPath = path.join(basePath, 'index.html');

console.log('--- GymWorx Dark Color Theme Verification Suite ---');

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

// 1. Centralized Palette Tokens in :root
test('Primary Neutral tokens are defined with exact hex codes', () => {
  assert.ok(appCss.includes('--bg-primary: #0D0C0A'), '--bg-primary (#0D0C0A) missing');
  assert.ok(appCss.includes('--bg-surface: #161513'), '--bg-surface (#161513) missing');
  assert.ok(appCss.includes('--bg-elevated: #1B1A18'), '--bg-elevated (#1B1A18) missing');
  assert.ok(appCss.includes('--bg-hover: #262521'), '--bg-hover (#262521) missing');
  assert.ok(appCss.includes('--border-primary: #2A2926'), '--border-primary (#2A2926) missing');
  assert.ok(appCss.includes('--border-secondary: #45433F'), '--border-secondary (#45433F) missing');
});

test('Typography color tokens are defined with exact hex codes', () => {
  assert.ok(appCss.includes('--text-primary: #F5F3EF'), '--text-primary (#F5F3EF) missing');
  assert.ok(appCss.includes('--text-secondary: #A8A6A2'), '--text-secondary (#A8A6A2) missing');
  assert.ok(appCss.includes('--text-muted: #74726E'), '--text-muted (#74726E) missing');
  assert.ok(appCss.includes('--text-disabled: #4F4D48'), '--text-disabled (#4F4D48) missing');
});

test('Buttons and Actions tokens are defined with exact hex codes', () => {
  assert.ok(appCss.includes('--button-primary: #F5F3EF'), '--button-primary (#F5F3EF) missing');
  assert.ok(appCss.includes('--button-primary-text: #111110'), '--button-primary-text (#111110) missing');
  assert.ok(appCss.includes('--button-primary-hover: #E4E1DB'), '--button-primary-hover (#E4E1DB) missing');
  assert.ok(appCss.includes('--button-secondary: #262521'), '--button-secondary (#262521) missing');
  assert.ok(appCss.includes('--button-secondary-hover: #33312D'), '--button-secondary-hover (#33312D) missing');
});

test('Input field color tokens are defined with exact hex codes', () => {
  assert.ok(appCss.includes('--input-background: #1B1A18'), '--input-background (#1B1A18) missing');
  assert.ok(appCss.includes('--input-border: #45433F'), '--input-border (#45433F) missing');
  assert.ok(appCss.includes('--input-text: #F5F3EF'), '--input-text (#F5F3EF) missing');
  assert.ok(appCss.includes('--input-placeholder: #74726E'), '--input-placeholder (#74726E) missing');
  assert.ok(appCss.includes('--input-focus: #F5F3EF'), '--input-focus (#F5F3EF) missing');
});

test('Semantic status tokens are defined with exact hex codes', () => {
  assert.ok(appCss.includes('--status-success: #22C55E'), '--status-success (#22C55E) missing');
  assert.ok(appCss.includes('--status-warning: #F59E0B'), '--status-warning (#F59E0B) missing');
  assert.ok(appCss.includes('--status-error: #EF4444'), '--status-error (#EF4444) missing');
  assert.ok(appCss.includes('--status-info: #3B82F6'), '--status-info (#3B82F6) missing');
});

test('Data visualization palette tokens are defined with exact hex codes', () => {
  assert.ok(appCss.includes('--chart-primary: #3B82F6'), '--chart-primary (#3B82F6) missing');
  assert.ok(appCss.includes('--chart-secondary: #8B5CF6'), '--chart-secondary (#8B5CF6) missing');
  assert.ok(appCss.includes('--chart-accent: #06B6D4'), '--chart-accent (#06B6D4) missing');
  assert.ok(appCss.includes('--chart-success: #22C55E'), '--chart-success (#22C55E) missing');
  assert.ok(appCss.includes('--chart-warning: #F59E0B'), '--chart-warning (#F59E0B) missing');
  assert.ok(appCss.includes('--chart-error: #EF4444'), '--chart-error (#EF4444) missing');
});

test('Table and Sidebar palette tokens are defined with exact hex codes', () => {
  assert.ok(appCss.includes('--table-header: #1B1A18'), '--table-header (#1B1A18) missing');
  assert.ok(appCss.includes('--table-row: #0D0C0A'), '--table-row (#0D0C0A) missing');
  assert.ok(appCss.includes('--table-row-hover: #1F1E1B'), '--table-row-hover (#1F1E1B) missing');
  assert.ok(appCss.includes('--table-border: #2A2926'), '--table-border (#2A2926) missing');
  assert.ok(appCss.includes('--sidebar-bg: #0D0C0A'), '--sidebar-bg (#0D0C0A) missing');
  assert.ok(appCss.includes('--sidebar-hover: #1F1E1B'), '--sidebar-hover (#1F1E1B) missing');
  assert.ok(appCss.includes('--sidebar-active: #262521'), '--sidebar-active (#262521) missing');
  assert.ok(appCss.includes('--sidebar-text: #F5F3EF'), '--sidebar-text (#F5F3EF) missing');
  assert.ok(appCss.includes('--sidebar-text-muted: #74726E'), '--sidebar-text-muted (#74726E) missing');
  assert.ok(appCss.includes('--sidebar-border: #2A2926'), '--sidebar-border (#2A2926) missing');
});

// 2. Sidebar Navigation Theme Rules
test('Sidebar styling uses the new dark tokens and transparent/active states', () => {
  assert.ok(appCss.includes('background-color: var(--sidebar-bg) !important'), 'Sidebar background not referencing --sidebar-bg');
  assert.ok(appCss.includes('background-color: var(--sidebar-hover) !important'), 'Sidebar hover not referencing --sidebar-hover');
  assert.ok(appCss.includes('background-color: var(--sidebar-active) !important'), 'Sidebar active not referencing --sidebar-active');
  assert.ok(appCss.includes('color: var(--sidebar-text) !important'), 'Sidebar text not referencing --sidebar-text');
  assert.ok(appCss.includes('color: var(--sidebar-text-muted) !important'), 'Sidebar muted text not referencing --sidebar-text-muted');
});

// 3. Table and Data Display Styling
test('Table headers and rows use dark theme tokens with proper hover', () => {
  assert.ok(appCss.includes('background-color: var(--table-header) !important'), 'Table header not using --table-header');
  assert.ok(appCss.includes('background-color: var(--table-row)'), 'Table body row not using --table-row');
  assert.ok(appCss.includes('background-color: var(--table-row-hover) !important'), 'Table row hover not using --table-row-hover');
  assert.ok(appCss.includes('color: var(--table-text)'), 'Table text not using --table-text');
});

// 4. Buttons and Form Controls
test('Primary button is dirty-white (#F5F3EF) with dark text (#111110)', () => {
  assert.ok(appCss.includes('background-color: var(--button-primary) !important'), 'Primary button not using --button-primary');
  assert.ok(appCss.includes('color: var(--button-primary-text) !important'), 'Primary button text not using --button-primary-text');
  assert.ok(appCss.includes('background-color: var(--button-primary-hover) !important'), 'Primary button hover not using --button-primary-hover');
});

test('Form controls, inputs, and selects use dark background and dirty white text', () => {
  assert.ok(appCss.includes('background-color: var(--input-background) !important'), 'Form control not using --input-background');
  assert.ok(appCss.includes('border: 1px solid var(--input-border) !important'), 'Form control not using --input-border');
  assert.ok(appCss.includes('color: var(--input-text) !important'), 'Form control text not using --input-text');
});

// 5. Modals and Dropdowns
test('Modals and Dropdown menus use dark surfaces and subtle boundaries', () => {
  assert.ok(appCss.includes('.modal-content {') && appCss.includes('background-color: var(--bg-surface) !important'), 'Modal content not using --bg-surface');
  assert.ok(appCss.includes('.dropdown-menu {') && appCss.includes('background-color: var(--bg-elevated) !important'), 'Dropdown menu not using --bg-elevated');
  assert.ok(appCss.includes('.dropdown-item:hover') && appCss.includes('background-color: var(--bg-hover) !important'), 'Dropdown item hover not using --bg-hover');
});

// 6. Semantic Status Badges
test('Status badges use subtle dark-tinted backgrounds preserving semantic distinctions', () => {
  assert.ok(appCss.includes('.wf-pending,') && appCss.includes('rgba(245, 158, 11, 0.15)'), 'Pending badge not tinted amber');
  assert.ok(appCss.includes('.wf-approved,') && appCss.includes('rgba(34, 197, 94, 0.15)'), 'Approved badge not tinted green');
  assert.ok(appCss.includes('.wf-rejected,') && appCss.includes('rgba(239, 68, 68, 0.15)'), 'Rejected badge not tinted red');
  assert.ok(appCss.includes('.wf-ordered,') && appCss.includes('rgba(59, 130, 246, 0.15)'), 'Ordered badge not tinted blue');
  assert.ok(appCss.includes('.wf-draft,') && appCss.includes('rgba(168, 166, 162, 0.12)'), 'Draft badge not tinted gray');
});

// 7. Typography Preservation
test('Geist and Geist Mono typography standards remain fully intact', () => {
  assert.ok(appCss.includes('--font-primary: "Geist"'), 'Geist primary font preserved');
  assert.ok(appCss.includes('--font-mono: "Geist Mono"'), 'Geist Mono font preserved');
  assert.ok(appCss.includes('--gw-font-size-h1: 1.875rem'), 'h1 font scale preserved');
  assert.ok(appCss.includes('--gw-font-size-kpi: 1.75rem'), 'kpi font scale preserved');
});

console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('ALL DARK COLOR THEME TESTS PASSED SUCCESSFULLY!');
}
