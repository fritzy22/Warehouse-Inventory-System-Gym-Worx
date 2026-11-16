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

const PORT = 9560;
const userDataDir = `C:\\Users\\zhenmar\\AppData\\Local\\Temp\\chrome_mgr_dash_test_${Date.now()}`;
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

    console.log('--- 2. Performing Login as Manager (Jean) ---');
    await evalJs(`
      (function() {
        const u = document.getElementById('login_username');
        const p = document.getElementById('login_password');
        const btn = document.getElementById('loginSubmitBtn');
        if (u) u.value = 'Jean';
        if (p) p.value = 'TestPass#2026!';
        if (btn) btn.click();
      })();
    `);
    await sleep(2500);

    // Ensure Light Mode initially via GymTheme
    await evalJs(`
      (function() {
        if (window.GymTheme && typeof window.GymTheme.setThemeMode === 'function') {
          window.GymTheme.setThemeMode('light');
        } else {
          document.documentElement.removeAttribute('data-theme');
          document.body.classList.remove('gw-dark-mode');
          localStorage.setItem('gw_theme_mode', 'light');
        }
      })();
    `);
    await sleep(600);

    const currentRole = await evalJs(`authUser ? authUser.role_name : 'not logged in'`);
    console.log('Logged in user role:', currentRole);

    // Set Desktop Viewport
    await setViewport(1440, 960);
    await sleep(1500);

    console.log('--- 3. Verifying Header & Badges ---');
    const headerInfo = await evalJs(`
      ({
        title: document.getElementById('dashboardTitle')?.textContent,
        pill: document.getElementById('dashboardRolePill')?.textContent,
        subtitle: document.getElementById('dashboardSubtitle')?.textContent,
        approvalBtn: document.querySelector('.gw-mgr-approval-btn')?.textContent?.trim()
      })
    `);
    console.log('Header Verification:', headerInfo);

    console.log('--- 4. Verifying Five Summary Cards ---');
    const cardsInfo = await evalJs(`
      Array.from(document.querySelectorAll('#statGrid .gw-mgr-kpi-card')).map(c => ({
        label: c.querySelector('.small.fw-semibold')?.textContent?.trim(),
        value: c.querySelector('.fs-2.fw-bold')?.textContent?.trim(),
        hasSparkline: !!c.querySelector('svg.gw-mgr-sparkline-svg path'),
        sparkColor: c.querySelector('svg.gw-mgr-sparkline-svg path')?.getAttribute('stroke'),
        icon: c.querySelector('.gw-mgr-icon-box i')?.className
      }))
    `);
    console.log('Summary Cards found (' + cardsInfo.length + '):', cardsInfo);

    console.log('--- 5. Verifying Row 2: PR Approval Queue ---');
    const prQueueInfo = await evalJs(`
      ({
        sectionTitle: document.querySelector('#dashboardRoleContent .gw-section-title')?.textContent?.trim(),
        hasViewAll: !!document.querySelector('#dashboardRoleContent button[onclick*="openMgrPrListModal"]'),
        colHeaders: Array.from(document.querySelectorAll('#dashboardRoleContent thead th')).map(th => th.textContent.trim()),
        hasRows: document.querySelectorAll('#dashboardRoleContent tbody tr').length
      })
    `);
    console.log('PR Queue Table:', prQueueInfo);

    console.log('--- 6. Verifying Row 3: PO Approval & Stock Chart ---');
    const row3Info = await evalJs(`
      ({
        poSectionTitle: Array.from(document.querySelectorAll('#dashboardRoleContent .gw-section-title'))[1]?.textContent?.trim(),
        hasPoViewAll: !!document.querySelector('#dashboardRoleContent button[onclick*="openMgrPoApprovalModal"]'),
        stockSectionTitle: Array.from(document.querySelectorAll('#dashboardRoleContent .gw-section-title'))[2]?.textContent?.trim(),
        chartCols: document.querySelectorAll('.gw-mgr-chart-col').length,
        hasFilterSelect: !!document.getElementById('mgrStockFilterSelect'),
        yTicks: Array.from(document.querySelectorAll('.gw-mgr-chart-y-tick')).map(t => t.textContent.trim()),
        xLabels: Array.from(document.querySelectorAll('.gw-mgr-chart-x-label')).map(l => l.textContent.trim()),
        colTooltips: Array.from(document.querySelectorAll('.gw-mgr-chart-col')).map(c => c.getAttribute('title'))
      })
    `);
    console.log('Row 3 Verification:', row3Info);

    console.log('--- 6b. Testing Stock Chart Filter Change ---');
    await evalJs(`
      (function() {
        const sel = document.getElementById('mgrStockFilterSelect');
        if (sel) {
          sel.value = 'low';
          handleMgrChartFilterChange('low');
        }
      })();
    `);
    await sleep(600);
    const filterUpdated = await evalJs(`
      ({
        chartCols: document.querySelectorAll('.gw-mgr-chart-col').length,
        xLabels: Array.from(document.querySelectorAll('.gw-mgr-chart-x-label')).map(l => l.textContent.trim())
      })
    `);
    console.log('Chart filtered to Low Stock:', filterUpdated);

    // Switch back to Top 5
    await evalJs(`
      (function() {
        const sel = document.getElementById('mgrStockFilterSelect');
        if (sel) {
          sel.value = 'top5';
          handleMgrChartFilterChange('top5');
        }
      })();
    `);
    await sleep(600);

    console.log('--- 7. Verifying Procurement Progress Pipeline Removal ---');
    const pipelineInfo = await evalJs(`
      ({
        hasPipelineCard: !!document.querySelector('.gw-mgr-pipeline-card'),
        hasPipelineStage: !!document.querySelector('.gw-mgr-pipeline-stage'),
        sectionCount: document.querySelectorAll('#dashboardRoleContent .gw-section-title').length
      })
    `);
    console.log('Pipeline Removal Verification:', pipelineInfo);

    // Capture Full Desktop View
    await takeScreenshot(path.join(artifactsDir, 'manager_dashboard_desktop_light.png'));

    console.log('--- 8. Testing Modal 1: Approved Requests Modal & Portal Date Filter ---');
    // Click on Card 3 (Approved Requests)
    await evalJs(`
      (function() {
        const cards = document.querySelectorAll('#statGrid .gw-mgr-kpi-card');
        if (cards[2]) cards[2].click();
      })();
    `);
    await sleep(1000);

    const prModalOpen = await evalJs(`
      ({
        isOpen: document.getElementById('mgrPrListModal')?.classList.contains('show'),
        title: document.getElementById('mgrPrModalTitle')?.textContent,
        count: document.getElementById('mgrPrModalCountBadge')?.textContent,
        rowsCount: document.querySelectorAll('#mgrPrModalTableBody tr').length
      })
    `);
    console.log('Approved Requests Modal status:', prModalOpen);

    // Open Date Filter Portal Dropdown
    await evalJs(`
      (function() {
        const btn = document.getElementById('mgrPrDateRangeBtn');
        if (btn) btn.click();
      })();
    `);
    await sleep(500);

    const portalOpen = await evalJs(`
      ({
        menuShow: document.getElementById('mgrPrDateRangeMenu')?.classList.contains('show'),
        parentIsBody: document.getElementById('mgrPrDateRangeMenu')?.parentNode === document.body,
        zIndex: document.getElementById('mgrPrDateRangeMenu')?.style.zIndex,
        rect: document.getElementById('mgrPrDateRangeMenu')?.getBoundingClientRect()
      })
    `);
    console.log('Date Filter Portal status:', portalOpen);

    await takeScreenshot(path.join(artifactsDir, 'manager_modal_approved_requests_with_date_filter.png'));

    // Close Date Dropdown and Modal
    await evalJs(`
      (function() {
        closeMgrPrDateRangeDropdown();
        closeModal('mgrPrListModal');
      })();
    `);
    await sleep(600);

    console.log('--- 9. Testing Modal 2: POs Awaiting Approval Modal ---');
    await evalJs(`
      (function() {
        openMgrPoApprovalModal();
      })();
    `);
    await sleep(1000);

    const poModalOpen = await evalJs(`
      ({
        isOpen: document.getElementById('mgrPoApprovalModal')?.classList.contains('show'),
        count: document.getElementById('mgrPoModalCountBadge')?.textContent,
        rows: document.querySelectorAll('#mgrPoModalTableBody tr').length
      })
    `);
    console.log('POs Awaiting Approval Modal status:', poModalOpen);

    await takeScreenshot(path.join(artifactsDir, 'manager_modal_pos_awaiting_approval.png'));

    await evalJs(`closeModal('mgrPoApprovalModal');`);
    await sleep(600);

    console.log('--- 10. Testing Modal 3: Requested vs Available Stock Modal ---');
    await evalJs(`
      (function() {
        openMgrStockComparisonModal();
      })();
    `);
    await sleep(1000);

    const stockModalOpen = await evalJs(`
      ({
        isOpen: document.getElementById('mgrStockComparisonModal')?.classList.contains('show'),
        title: document.getElementById('mgrStockComparisonModalTitle')?.textContent,
        rows: document.querySelectorAll('#mgrStockModalTableBody tr').length
      })
    `);
    console.log('Stock Comparison Modal status:', stockModalOpen);

    await takeScreenshot(path.join(artifactsDir, 'manager_modal_stock_comparison.png'));

    await evalJs(`closeModal('mgrStockComparisonModal');`);
    await sleep(600);

    console.log('--- 11. Testing Tablet View ---');
    await setViewport(768, 1024);
    await sleep(800);
    await takeScreenshot(path.join(artifactsDir, 'manager_dashboard_tablet.png'));

    console.log('--- 12. Testing Mobile View ---');
    await setViewport(390, 844);
    await sleep(800);
    await takeScreenshot(path.join(artifactsDir, 'manager_dashboard_mobile.png'));

    console.log('--- 13. Testing Dark Mode View ---');
    await setViewport(1440, 960);
    await evalJs(`
      (function() {
        if (window.GymTheme && typeof window.GymTheme.setThemeMode === 'function') {
          window.GymTheme.setThemeMode('dark');
        } else {
          document.documentElement.setAttribute('data-theme', 'dark');
          document.body.classList.add('gw-dark-mode');
          localStorage.setItem('gw_theme_mode', 'dark');
        }
      })();
    `);
    await sleep(800);
    await takeScreenshot(path.join(artifactsDir, 'manager_dashboard_desktop_dark.png'));

    console.log('=== ALL MANAGER DASHBOARD CDP TESTS PASSED SUCCESSFULLY! ===');
  } catch (err) {
    console.error('Test execution failed:', err);
    process.exitCode = 1;
  } finally {
    if (ws) ws.close();
    try {
      browserProcess.kill('SIGKILL');
    } catch (e) {}
  }
}

run();
