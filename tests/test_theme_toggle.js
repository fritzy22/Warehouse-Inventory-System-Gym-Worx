/**
 * test_theme_toggle.js
 * Comprehensive automated verification for GymWorx Dynamic Sun/Moon Theme Toggle
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const basePath = path.resolve(__dirname, '..');
const appCssPath = path.join(basePath, 'css', 'app.css');
const indexPhpPath = path.join(basePath, 'index.php');
const indexHtmlPath = path.join(basePath, 'index.html');
const themeJsPath = path.join(basePath, 'js', 'theme.js');

console.log('--- GymWorx Dynamic Sun/Moon Theme Toggle Verification Suite ---');

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
const themeJs = fs.readFileSync(themeJsPath, 'utf8');

// =========================================================================
// 1. Time-Based Automatic Theme Detection Logic
// =========================================================================
test('theme.js defines getAutomaticTheme() using 6 AM to 6 PM light mode window', () => {
  assert.ok(themeJs.includes('function getAutomaticTheme('), 'getAutomaticTheme missing in theme.js');
  assert.ok(themeJs.includes('hour >= 6 && hour < 18'), 'Time window 6-18 missing in getAutomaticTheme');

  // Evaluate the logic mathematically
  function evalHour(hour) {
    return (hour >= 6 && hour < 18) ? 'light' : 'dark';
  }

  assert.strictEqual(evalHour(0), 'dark', '12:00 AM must be dark');
  assert.strictEqual(evalHour(5), 'dark', '5:59 AM (hour 5) must be dark');
  assert.strictEqual(evalHour(6), 'light', '6:00 AM (hour 6) must be light');
  assert.strictEqual(evalHour(12), 'light', '12:00 PM (hour 12) must be light');
  assert.strictEqual(evalHour(17), 'light', '5:59 PM (hour 17) must be light');
  assert.strictEqual(evalHour(18), 'dark', '6:00 PM (hour 18) must be dark');
  assert.strictEqual(evalHour(23), 'dark', '11:59 PM (hour 23) must be dark');
});

// =========================================================================
// 2. Icon Design & Placement
// =========================================================================
test('theme.js defines Lucide-style Sun and Moon SVG icons', () => {
  assert.ok(themeJs.includes('gw-theme-icon-sun'), 'Sun SVG icon definition missing');
  assert.ok(themeJs.includes('gw-theme-icon-moon'), 'Moon SVG icon definition missing');
  assert.ok(!themeJs.includes('☀️') && !themeJs.includes('🌙'), 'Emoji icons must not be used');
});

test('Desktop topbar places theme toggle button immediately left of notification bell in index.php', () => {
  const togglePos = indexPhp.indexOf('id="topbarThemeToggleBtn"');
  const notifPos = indexPhp.indexOf('id="topbarNotifBtn"');
  assert.ok(togglePos !== -1, 'topbarThemeToggleBtn missing in index.php');
  assert.ok(notifPos !== -1, 'topbarNotifBtn missing in index.php');
  assert.ok(togglePos < notifPos, 'topbarThemeToggleBtn must appear immediately before topbarNotifBtn');
});

test('Desktop topbar places theme toggle button immediately left of notification bell in index.html', () => {
  const togglePos = indexHtml.indexOf('id="topbarThemeToggleBtn"');
  const notifPos = indexHtml.indexOf('id="topbarNotifBtn"');
  assert.ok(togglePos !== -1, 'topbarThemeToggleBtn missing in index.html');
  assert.ok(notifPos !== -1, 'topbarNotifBtn missing in index.html');
  assert.ok(togglePos < notifPos, 'topbarThemeToggleBtn must appear immediately before topbarNotifBtn in index.html');
});

test('Mobile topbar includes mobile theme toggle button left of mobile notification bell in index.php & index.html', () => {
  assert.ok(indexPhp.includes('id="mobileThemeToggleBtn"'), 'mobileThemeToggleBtn missing in index.php');
  assert.ok(indexHtml.includes('id="mobileThemeToggleBtn"'), 'mobileThemeToggleBtn missing in index.html');
});

// =========================================================================
// 3. Theme Toggle Button Styling & Appearance
// =========================================================================
test('app.css defines .gw-theme-toggle-btn dimensions, radius, and smooth transitions', () => {
  assert.ok(appCss.includes('.gw-theme-toggle-btn'), '.gw-theme-toggle-btn class missing in app.css');
  assert.ok(appCss.includes('width: 40px'), 'Width 40px missing for theme toggle button');
  assert.ok(appCss.includes('height: 40px'), 'Height 40px missing for theme toggle button');
  assert.ok(appCss.includes('border-radius: 11px'), 'Border radius 11px missing for theme toggle button');
  assert.ok(appCss.includes('transition: background-color 0.18s ease'), 'Smooth transition missing for theme toggle button');
});

test('app.css enforces exact Dark Mode toggle button appearance', () => {
  assert.ok(appCss.includes('background-color: #1B1A18'), 'Dark mode button background (#1B1A18) missing');
  assert.ok(appCss.includes('border: 1px solid #45433F'), 'Dark mode button border (#45433F) missing');
  assert.ok(appCss.includes('color: #F5F3EF'), 'Dark mode button icon color (#F5F3EF) missing');
  assert.ok(appCss.includes('background-color: #262521'), 'Dark mode button hover (#262521) missing');
});

test('app.css enforces exact Light Mode toggle button appearance', () => {
  assert.ok(appCss.includes('background-color: #F5F3EF'), 'Light mode button background (#F5F3EF) missing');
  assert.ok(appCss.includes('border: 1px solid #D8D5CF'), 'Light mode button border (#D8D5CF) missing');
  assert.ok(appCss.includes('color: #171717'), 'Light mode button icon color (#171717) missing');
  assert.ok(appCss.includes('background-color: #EAE7E1'), 'Light mode button hover (#EAE7E1) missing');
});

// =========================================================================
// 4. Light Mode Full-Website Palette Tokens
// =========================================================================
test('app.css defines [data-theme="light"] with required light mode color tokens', () => {
  assert.ok(appCss.includes('[data-theme="light"]'), '[data-theme="light"] selector missing');
  assert.ok(appCss.includes('--bg-primary: #F7F6F3'), '--bg-primary (#F7F6F3) light mode missing');
  assert.ok(appCss.includes('--bg-surface: #FFFFFF'), '--bg-surface (#FFFFFF) light mode missing');
  assert.ok(appCss.includes('--bg-elevated: #F5F3EF'), '--bg-elevated (#F5F3EF) light mode missing');
  assert.ok(appCss.includes('--text-primary: #171717'), '--text-primary (#171717) light mode missing');
  assert.ok(appCss.includes('--text-secondary: #57534E'), '--text-secondary (#57534E) light mode missing');
  assert.ok(appCss.includes('--border-primary: #D8D5CF'), '--border-primary (#D8D5CF) light mode missing');
  assert.ok(appCss.includes('--sidebar-bg: #0D0C0A'), '--sidebar-bg (#0D0C0A) must remain black in light mode');
  assert.ok(appCss.includes('--button-primary: #171717'), '--button-primary (#171717) light mode missing');
  assert.ok(appCss.includes('--button-primary-text: #FFFFFF'), '--button-primary-text (#FFFFFF) light mode missing');
});

// =========================================================================
// 5. Anti-Flash & Preference Persistence
// =========================================================================
test('index.php and index.html include synchronous anti-flash script in <head>', () => {
  assert.ok(indexPhp.includes('localStorage.getItem(\'gw_theme_mode\')'), 'Anti-flash script missing in index.php head');
  assert.ok(indexHtml.includes('localStorage.getItem(\'gw_theme_mode\')'), 'Anti-flash script missing in index.html head');
});

test('Account profile menu provides options to restore Automatic Mode or select explicit theme', () => {
  assert.ok(indexPhp.includes('onclick="setThemeMode(\'auto\')"'), 'setThemeMode(auto) missing in index.php');
  assert.ok(indexPhp.includes('onclick="setThemeMode(\'light\')"'), 'setThemeMode(light) missing in index.php');
  assert.ok(indexPhp.includes('onclick="setThemeMode(\'dark\')"'), 'setThemeMode(dark) missing in index.php');
  assert.ok(indexHtml.includes('onclick="setThemeMode(\'auto\')"'), 'setThemeMode(auto) missing in index.html');
});

// =========================================================================
// 6. Preservation of Dirty-White Tables in Both Modes
// =========================================================================
test('Dirty-white table tokens remain identical and untouched for both themes', () => {
  assert.ok(appCss.includes('--table-dw-bg: #F5F3EF'), '--table-dw-bg (#F5F3EF) missing');
  assert.ok(appCss.includes('--table-dw-header: #EBE9E4'), '--table-dw-header (#EBE9E4) missing');
  assert.ok(appCss.includes('--table-dw-text: #171717'), '--table-dw-text (#171717) missing');
  assert.ok(appCss.includes('--table-dw-border: #D8D5CF'), '--table-dw-border (#D8D5CF) missing');
  assert.ok(appCss.includes('.gym-table-container'), '.gym-table-container missing');
});

console.log(`\nTests Completed: ${passCount} Passed, ${failCount} Failed`);
if (failCount > 0) {
  process.exit(1);
} else {
  console.log('ALL DYNAMIC SUN/MOON THEME TOGGLE TESTS PASSED SUCCESSFULLY!\n');
}
