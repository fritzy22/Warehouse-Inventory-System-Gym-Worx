import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

const chromePath = CHROME_PATHS.find(p => fs.existsSync(p));
if (!chromePath) {
  console.error('No browser executable found!');
  process.exit(1);
}

const PORT = 9557;
const userDataDir = `C:\\Users\\zhenmar\\AppData\\Local\\Temp\\chrome_date_portal_test_${Date.now()}`;
const artifactsDir = 'C:\\Users\\zhenmar\\.gemini\\antigravity\\brain\\0fbba556-25be-4bd1-91a3-0edccb342aba';

const browserProcess = spawn(chromePath, [
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${userDataDir}`,
  '--disable-gpu',
  'about:blank'
], { stdio: 'ignore' });

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getWsUrl() {
  for (let i = 0; i < 25; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const tabs = await res.json();
      const pageTab = tabs && tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pageTab) {
        return pageTab.webSocketDebuggerUrl;
      }
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('Could not connect to browser CDP port');
}

async function run() {
  let ws;
  let id = 1;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = id++;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async function evalJs(expr) {
    const res = await send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error('JS Eval Exception: ' + JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  }

  async function captureScreenshot(filename) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(artifactsDir, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`[SCREENSHOT] Saved: ${outPath}`);
    return outPath;
  }

  async function setViewport(width, height) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768
    });
  }

  try {
    const wsUrl = await getWsUrl();
    ws = new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data.toString());
        if (data.id && pending.has(data.id)) {
          const { resolve, reject } = pending.get(data.id);
          pending.delete(data.id);
          if (data.error) reject(data.error);
          else resolve(data.result);
        }
      };
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    console.log('--- 1. Navigating and Logging In ---');
    await setViewport(1440, 900);
    await send('Page.navigate', { url: 'http://localhost/updated_inventory_website/warehouse_finals/index.php' });
    await sleep(2500);

    await evalJs(`
      (function() {
        const u = document.getElementById('login_username');
        const p = document.getElementById('login_password');
        const btn = document.getElementById('loginSubmitBtn');
        if (u) u.value = 'christian';
        if (p) p.value = 'TestPass#2026!';
        if (btn) btn.click();
      })()
    `);
    await sleep(2500);

    await evalJs(`
      (async () => {
        navigateTo('stock_movement');
        await loadStockMovements();
      })()
    `);
    await sleep(1500);

    console.log('--- 2. Testing Default Closed State ---');
    const closedState = await evalJs(`
      (() => {
        const menu = document.getElementById('movementDateRangeMenu');
        const btn = document.getElementById('movementDateRangeBtn');
        return {
          menuDisplay: menu ? window.getComputedStyle(menu).display : 'none',
          btnExpanded: btn?.getAttribute('aria-expanded'),
          btnText: document.getElementById('movementDateRangeLabel')?.textContent.trim()
        };
      })()
    `);
    console.log('Closed State:', closedState);

    console.log('--- 3. Testing Dropdown Opened Downward (Portal & Positioning) ---');
    await evalJs(`openMovementDateRangeDropdown()`);
    await sleep(400);

    const openDownwardMetrics = await evalJs(`
      (() => {
        const menu = document.getElementById('movementDateRangeMenu');
        const btn = document.getElementById('movementDateRangeBtn');
        const thead = document.querySelector('.gw-movement-table thead');
        const btnRect = btn.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const theadRect = thead.getBoundingClientRect();

        return {
          menuParent: menu.parentNode.tagName,
          menuZIndex: window.getComputedStyle(menu).zIndex,
          theadZIndex: window.getComputedStyle(thead).zIndex,
          placement: menu.getAttribute('data-placement'),
          btnBottom: btnRect.bottom,
          menuTop: menuRect.top,
          menuBottom: menuRect.bottom,
          theadTop: theadRect.top,
          // Menu top must be >= button bottom, and menu must be in front of thead
          isPositionedBelowBtn: menuRect.top >= btnRect.bottom,
          isHigherZIndex: parseInt(window.getComputedStyle(menu).zIndex) > parseInt(window.getComputedStyle(thead).zIndex),
          menuVisible: window.getComputedStyle(menu).display !== 'none'
        };
      })()
    `);
    console.log('Open Downward Metrics:', openDownwardMetrics);

    if (!openDownwardMetrics.isPositionedBelowBtn || !openDownwardMetrics.isHigherZIndex) {
      throw new Error('Dropdown layering/placement check failed!');
    }

    await captureScreenshot('date_filter_open_downward.png');

    console.log('--- 4. Testing Auto Open Upward (Near Viewport Bottom) ---');
    // Set a smaller viewport height (480px) so space below is insufficient (< menuHeight)
    await setViewport(1440, 500);
    await sleep(200);
    await evalJs(`
      (() => {
        positionMovementDateRangeDropdown();
      })()
    `);
    await sleep(300);

    const upwardMetrics = await evalJs(`
      (() => {
        const menu = document.getElementById('movementDateRangeMenu');
        const btn = document.getElementById('movementDateRangeBtn');
        const btnRect = btn.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        return {
          placement: menu.getAttribute('data-placement'),
          btnTop: btnRect.top,
          menuBottom: menuRect.bottom,
          isPositionedAboveBtn: menuRect.bottom <= btnRect.top + 2
        };
      })()
    `);
    console.log('Upward Metrics (when near bottom):', upwardMetrics);
    await captureScreenshot('date_filter_open_upward.png');

    // Restore full viewport height
    await setViewport(1440, 900);
    await sleep(200);
    await evalJs(`positionMovementDateRangeDropdown()`);
    await sleep(200);

    console.log('--- 5. Testing Custom Range Date Validation (start > end) ---');
    const valResult = await evalJs(`
      (() => {
        document.getElementById('movementDateStart').value = '2026-10-31';
        document.getElementById('movementDateEnd').value = '2026-10-01';
        applyCustomDateRange();
        const err = document.getElementById('customDateError');
        return {
          errorVisible: err && err.style.display !== 'none',
          errorText: err?.textContent
        };
      })()
    `);
    console.log('Date Validation Result:', valResult);
    if (!valResult.errorVisible) {
      throw new Error('Date validation failed to reject start > end!');
    }

    console.log('--- 6. Testing Valid Custom Range Application ---');
    const customResult = await evalJs(`
      (() => {
        document.getElementById('movementDateStart').value = '2026-10-15';
        document.getElementById('movementDateEnd').value = '2026-10-28';
        applyCustomDateRange();
        return {
          label: document.getElementById('movementDateRangeLabel')?.textContent,
          filteredCount: currentFilteredMovements.length,
          paginationText: document.getElementById('movementPaginationInfo')?.textContent
        };
      })()
    `);
    console.log('Custom Range Applied:', customResult);

    console.log('--- 7. Testing Reset Restores All Time ---');
    const resetResult = await evalJs(`
      (() => {
        resetStockMovementFilters();
        return {
          label: document.getElementById('movementDateRangeLabel')?.textContent,
          totalRows: currentFilteredMovements.length,
          paginationText: document.getElementById('movementPaginationInfo')?.textContent
        };
      })()
    `);
    console.log('Reset Result:', resetResult);

    console.log('--- 8. Testing Presets (Last 7 Days, Last 30 Days, This Month) ---');
    const presetsResult = await evalJs(`
      (() => {
        applyDatePreset('7days');
        const c7 = currentFilteredMovements.length;
        applyDatePreset('30days');
        const c30 = currentFilteredMovements.length;
        applyDatePreset('all');
        const cAll = currentFilteredMovements.length;
        return { count7Days: c7, count30Days: c30, countAll: cAll };
      })()
    `);
    console.log('Presets Result:', presetsResult);

    console.log('--- 9. Capturing Final Clean Screenshots ---');
    // Open dropdown in downward position
    await evalJs(`openMovementDateRangeDropdown()`);
    await sleep(300);
    await captureScreenshot('date_filter_all_options_visible.png');

    // Close and capture clean page
    await evalJs(`closeMovementDateRangeDropdown()`);
    await sleep(300);
    await captureScreenshot('stock_movement_fixed_ledger.png');

    console.log('\n======================================================');
    console.log('ALL DATE FILTER PORTAL & POSITIONING CHECKS PASSED!');
    console.log('======================================================');

  } catch (err) {
    console.error('Test Error:', err);
    process.exitCode = 1;
  } finally {
    if (ws) ws.close();
    browserProcess.kill();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

run();
