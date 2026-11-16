/**
 * Automated Verification Test for GymWorx Warehouse Redesigned Login Page
 */
const fs = require('fs');
const path = require('path');

const authHtml = fs.readFileSync(path.join(__dirname, '../views/auth.html'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
const bgPath = path.join(__dirname, '../assets/warehouse_dark_bg.jpg');

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

console.log('=== 1. VERIFYING BACKGROUND ASSET & CSS RULES ===');
assert(!appCss.includes("url('../assets/warehouse_dark_bg.jpg')"), 'Background image removed as requested');
assert(appCss.includes('background-color: #0D0C0A') || appCss.includes('#0D0C0A'), 'Solid background color #0D0C0A is applied');
assert(appCss.includes('rgba(12, 11, 10, 0.88)'), 'Login card background rgba(12, 11, 10, 0.88) is applied');
assert(appCss.includes('#F5F3EF'), 'Primary dirty-white text #F5F3EF is applied');
assert(appCss.includes('#A8A6A2'), 'Secondary muted text #A8A6A2 is applied');
assert(appCss.includes('#1B1A18'), 'Input background #1B1A18 is applied');
assert(appCss.includes('#45433F'), 'Input borders #45433F are applied');
assert(appCss.includes('#111110'), 'Login button dark text #111110 is applied');
assert(appCss.includes('#E4E1DB'), 'Login button hover #E4E1DB is applied');

console.log('\n=== 2. VERIFYING LOGIN CARD LAYOUT & TYPOGRAPHY ===');
assert(authHtml.includes('id="loginCard"') && authHtml.includes('gw-login-card'), 'Centered login card exists with id="loginCard"');
assert(authHtml.includes('gw-cube-logo-svg'), 'GymWorx isometric cube logo vector exists');
assert(authHtml.includes('GYMWORX'), 'Brand name GYMWORX exists');
assert(authHtml.includes('WAREHOUSE'), 'Brand name WAREHOUSE exists');
assert(authHtml.includes('INVENTORY MANAGEMENT SYSTEM'), 'Subtitle INVENTORY MANAGEMENT SYSTEM exists');

console.log('\n=== 3. VERIFYING FORM CONTROLS & SECURITY ===');
assert(authHtml.includes('id="loginForm"'), 'Form exists with id="loginForm"');
assert(authHtml.includes('id="loginErrorAlert"'), 'Error alert exists with id="loginErrorAlert"');
assert(authHtml.includes('id="login_username"') && authHtml.includes('name="username"'), 'Username input with id="login_username" and name="username"');
assert(authHtml.includes('id="login_password"') && authHtml.includes('name="password"'), 'Password input with id="login_password" and name="password"');
assert(authHtml.includes('id="toggleLoginPassword"') && authHtml.includes('type="button"'), 'Password visibility toggle exists with type="button" (non-submitting)');
assert(authHtml.includes('id="login_remember"'), 'Remember me checkbox exists with id="login_remember"');
assert(!authHtml.includes('forgotPasswordLink') && !authHtml.includes('Forgot password?'), 'Forgot password link is removed as requested');
assert(authHtml.includes('id="loginSubmitBtn"') && authHtml.includes('type="submit"') && authHtml.includes('LOGIN'), 'Submit button with id="loginSubmitBtn" and text "LOGIN"');
assert(authHtml.includes('bi-box-arrow-in-right'), 'Login button contains login icon');
assert(authHtml.includes('GymWorx Warehouse. All rights reserved.'), 'Footer copyright exists');

console.log('\n=== 4. VERIFYING AUTHENTICATION INTEGRITY IN JAVASCRIPT ===');
assert(appJs.includes('handleLogin'), 'handleLogin function exists in app.js');
assert(appJs.includes('auth.php?action=login'), 'API endpoint auth.php?action=login called');
assert(appJs.includes('toggleLoginPassword'), 'Password toggle event listener exists in app.js');
assert(appJs.includes('gw_remember_username'), 'Remember me username persistence in app.js');
assert(appJs.includes('forgotPasswordLink'), 'Forgot password handler exists in app.js');

console.log('\n=== 5. VERIFYING MOBILE RESPONSIVENESS RULES ===');
assert(appCss.includes('@media (max-width: 575.98px)'), 'Mobile media query exists');
assert(appCss.includes('max-width: 92vw'), 'Mobile card adapts cleanly to 92vw');
assert(appCss.includes('background-attachment: scroll'), 'Mobile background optimized for mobile touch scrolling');

console.log('\n=== 6. VERIFYING STATIC INDEX.HTML COMPILATION ===');
assert(indexHtml.includes('gw-cube-logo-svg'), 'index.html contains GymWorx cube logo');
assert(indexHtml.includes('INVENTORY MANAGEMENT SYSTEM'), 'index.html contains subtitle');
assert(indexHtml.includes('id="login_remember"'), 'index.html contains remember me checkbox');
assert(!indexHtml.includes('id="forgotPasswordLink"'), 'index.html has forgot password removed');

console.log(`\n========================================`);
console.log(`TOTAL TESTS: ${passedTests + failedTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
if (failedTests > 0) process.exit(1);
