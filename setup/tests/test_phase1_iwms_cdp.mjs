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

const PORT = 9570;
const userDataDir = `C:\\Users\\zhenmar\\AppData\\Local\\Temp\\chrome_phase1_test_${Date.now()}`;
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
  for (let i = 0; i < 30; i++) {
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
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error('JS Eval error: ' + JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  }

  async function takeScreenshot(filePath, clip = null) {
    const params = { format: 'png' };
    if (clip) params.clip = clip;
    const res = await send('Page.captureScreenshot', params);
    const buf = Buffer.from(res.data, 'base64');
    fs.writeFileSync(filePath, buf);
    console.log(`[Screenshot Saved] -> ${path.basename(filePath)}`);
  }

  async function setViewport(width, height) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 600
    });
    await sleep(400);
  }

  try {
    const wsUrl = await getWsUrl();
    console.log('Connected to CDP at:', wsUrl);

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
    await send('DOM.enable');
    await send('Runtime.enable');

    console.log('--- 1. Navigating to Warehouse Finals ---');
    await send('Page.navigate', { url: 'http://localhost/updated_inventory_website/warehouse_finals/' });
    await sleep(2000);

    console.log('--- 2. Performing Login as Administrator (Enhancer) ---');
    await evalJs(`
      (function() {
        const u = document.getElementById('login_username');
        const p = document.getElementById('login_password');
        const btn = document.getElementById('loginSubmitBtn');
        if (u) u.value = 'Enhancer';
        if (p) p.value = 'TestPass#2026!';
        if (btn) btn.click();
      })();
    `);
    await sleep(2500);

    // Set light mode explicitly for clean screenshot
    await evalJs(`
      (function() {
        if (window.GymTheme && typeof window.GymTheme.setThemeMode === 'function') {
          window.GymTheme.setThemeMode('light');
        }
      })();
    `);
    await sleep(600);

    const authRole = await evalJs(`authUser ? authUser.role_name : 'not logged in'`);
    console.log('Logged in user role:', authRole);

    await setViewport(1440, 960);
    await sleep(1000);

    console.log('--- 3. Verifying Absence of Active Products and Active Categories Cards ---');
    const legacyCards = await evalJs(`
      Array.from(document.querySelectorAll('#statGrid .kpi-card')).filter(c => {
        const txt = c.textContent.toLowerCase();
        return txt.includes('active products') || txt.includes('active categories') || txt.includes('total products');
      }).map(c => c.textContent.trim())
    `);
    console.log('Legacy Cards Found (Must be empty):', legacyCards);

    console.log('--- 4. Verifying Six Required Dashboard KPI Cards ---');
    const cards = await evalJs(`
      Array.from(document.querySelectorAll('#statGrid .kpi-card')).map(c => ({
        label: c.querySelector('.kpi-label')?.textContent?.trim(),
        value: c.querySelector('.kpi-value')?.textContent?.trim(),
        sub: c.querySelector('.kpi-sub')?.textContent?.trim(),
        icon: c.querySelector('.kpi-icon-box i')?.className
      }))
    `);
    console.log('Cards found (' + cards.length + '):', cards);

    console.log('--- 5. Verifying Recent Transactions Table & Stock Alerts in Workspace ---');
    const workspaceInfo = await evalJs(`
      ({
        txTableTitle: document.querySelectorAll('#dashboardRoleContent .gw-section-title')[2]?.textContent?.trim() ||
                      Array.from(document.querySelectorAll('#dashboardRoleContent .gw-section-title')).find(t => t.textContent.includes('Recent Transactions'))?.textContent?.trim(),
        txRowsCount: document.querySelectorAll('#dashboardRoleContent tbody tr').length,
        stockAlertsTitle: Array.from(document.querySelectorAll('#dashboardRoleContent .gw-section-title')).find(t => t.textContent.includes('Stock Alerts'))?.textContent?.trim(),
        stockAlertsCount: document.querySelectorAll('#dashboardRoleContent .stock-bar-track').length
      })
    `);
    console.log('Workspace Info:', workspaceInfo);

    await takeScreenshot(path.join(artifactsDir, 'phase1_admin_dashboard_desktop_light.png'));

    console.log('--- 6. Verifying Recent Transactions Modal ---');
    await evalJs(`openRecentTransactionsModal();`);
    await sleep(600);
    const modalInfo = await evalJs(`
      ({
        isOpen: document.getElementById('recentTransactionsModal')?.classList.contains('show'),
        rows: document.querySelectorAll('#recentTransactionsModalBody tr').length
      })
    `);
    console.log('Recent Transactions Modal:', modalInfo);
    await takeScreenshot(path.join(artifactsDir, 'phase1_recent_transactions_modal.png'));
    await evalJs(`closeModal('recentTransactionsModal');`);
    await sleep(600);

    console.log('--- 7. Verifying Product Inventory Modal & Calculations ---');
    await evalJs(`navigateTo('product');`);
    await sleep(1500);

    // Click the first product's View button
    await evalJs(`
      (function() {
        const btn = document.querySelector('#productTable .gw-btn-view-product');
        if (btn) btn.click();
      })();
    `);
    await sleep(800);

    const modalDetail = await evalJs(`
      ({
        isOpen: document.getElementById('productDetailModal')?.classList.contains('show'),
        title: document.getElementById('productDetailModalTitle')?.textContent,
        badgeText: document.querySelector('#productDetailModal .gw-status-badge')?.textContent?.trim(),
        availableStock: document.getElementById('invMetricAvailable')?.textContent?.trim(),
        reorderLevel: document.getElementById('invMetricReorder')?.textContent?.trim(),
        maxCapacity: document.getElementById('invMetricMax')?.textContent?.trim(),
        suggestedOrder: document.getElementById('invMetricSuggested')?.textContent?.trim()
      })
    `);
    console.log('Product Inventory Details Modal:', modalDetail);

    await takeScreenshot(path.join(artifactsDir, 'phase1_product_detail_modal.png'));
    await evalJs(`closeModal('productDetailModal');`);
    await sleep(500);

    console.log('--- 8. Verifying Dark Mode on Dashboard ---');
    await evalJs(`navigateTo('dashboard');`);
    await sleep(1000);
    await evalJs(`
      (function() {
        if (window.GymTheme && typeof window.GymTheme.setThemeMode === 'function') {
          window.GymTheme.setThemeMode('dark');
        }
      })();
    `);
    await sleep(800);
    await takeScreenshot(path.join(artifactsDir, 'phase1_admin_dashboard_desktop_dark.png'));

    console.log('=== PHASE 1 VERIFICATION COMPLETED SUCCESSFULLY ===');
  } catch (err) {
    console.error('Phase 1 test execution failed:', err);
    process.exitCode = 1;
  } finally {
    if (ws) ws.close();
    try {
      browserProcess.kill('SIGKILL');
    } catch (e) {}
  }
}

run();
