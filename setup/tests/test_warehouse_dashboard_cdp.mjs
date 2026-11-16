import { spawn } from 'child_process';
import fs from 'fs';

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

const PORT = 9444;
const userDataDir = `C:\\Users\\zhenmar\\AppData\\Local\\Temp\\chrome_dashboard_test_${Date.now()}`;

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

  try {
    const wsUrl = await getWsUrl();
    ws = new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
      ws.onmessage = msg => {
        const data = JSON.parse(msg.data);
        if (data.method === 'Runtime.consoleAPICalled') {
          const text = (data.params.args || []).map(a => a.value || JSON.stringify(a)).join(' ');
          console.log(`[BROWSER CONSOLE ${data.params.type}]`, text);
        }
        if (data.method === 'Runtime.exceptionThrown') {
          console.log('[BROWSER EXCEPTION]', JSON.stringify(data.params.exceptionDetails));
        }
        if (data.id && pending.has(data.id)) {
          const { resolve, reject } = pending.get(data.id);
          pending.delete(data.id);
          if (data.error) reject(new Error(data.error.message));
          else resolve(data.result);
        }
      };
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    console.log('--- 1. Navigating to GymWorx application ---');
    await send('Page.navigate', { url: 'http://localhost/updated_inventory_website/warehouse_finals/index.php' });
    await sleep(2000);

    console.log('--- 2. Logging in as Christian (Warehouse Officer) ---');
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

    // Wait for async loadDashboard to complete and render
    let loaded = false;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      const title = await evalJs(`document.getElementById('dashboardTitle')?.textContent.trim()`);
      if (title && title !== 'Dashboard') {
        loaded = true;
        break;
      }
    }
    if (!loaded) {
      console.warn('Dashboard title did not change from initial state, current title:', await evalJs(`document.getElementById('dashboardTitle')?.textContent`));
    }
    console.log('--- 3. Verifying Dashboard Header & Profile ---');
    const title = await evalJs(`document.getElementById('dashboardTitle')?.textContent.trim()`);
    const pill = await evalJs(`document.getElementById('dashboardRolePill')?.textContent.trim()`);
    const ctaHtml = await evalJs(`document.getElementById('dashboardHeaderActions')?.innerHTML`);

    console.log('Dashboard Title:', title);
    console.log('Role Pill:', pill);
    console.log('Header CTA Button contains Record Receiving:', ctaHtml?.includes('Record Receiving'));
    console.log('Header CTA Button is btn-dark:', ctaHtml?.includes('btn-dark'));

    if (title !== 'Warehouse Dashboard') throw new Error(`Expected title 'Warehouse Dashboard', got: '${title}'`);
    if (!pill?.includes('Warehouse Officer')) throw new Error(`Expected 'Warehouse Officer' pill, got: '${pill}'`);
    if (!ctaHtml?.includes('Record Receiving') || !ctaHtml?.includes('btn-dark')) {
      throw new Error('CTA button missing btn-dark or Record Receiving');
    }

    console.log('--- 4. Verifying 6 Analytics KPI Cards ---');
    const kpis = await evalJs(`
      Array.from(document.querySelectorAll('#statGrid .kpi-card')).map(c => ({
        label: c.querySelector('.kpi-label')?.textContent.trim(),
        val: c.querySelector('.kpi-value')?.textContent.trim()
      }))
    `);
    console.log('Found KPI cards:', kpis);
    if (kpis.length !== 6) throw new Error(`Expected 6 KPI cards, found ${kpis.length}`);

    const expectedKpis = [
      'Deliveries to Receive',
      'Pending Store Releases',
      'Partially Received',
      'Received Today',
      'Low Stock Items',
      'Critical Stock'
    ];
    for (const exp of expectedKpis) {
      if (!kpis.some(k => k.label === exp)) {
        throw new Error(`Missing expected KPI card: ${exp}`);
      }
    }

    console.log('--- 5. Verifying 3 Preview Tables Layout & Columns ---');
    const tableSpecs = await evalJs(`
      Array.from(document.querySelectorAll('#dashboardRoleContent .card')).map(c => ({
        header: c.querySelector('.card-header h6')?.textContent.trim(),
        viewAll: c.querySelector('.card-header button')?.textContent.trim(),
        ths: Array.from(c.querySelectorAll('thead th')).map(th => th.textContent.trim()),
        rowCount: c.querySelectorAll('tbody tr').length
      }))
    `);
    console.log('Dashboard content cards:', tableSpecs);

    const prCard = tableSpecs.find(t => t.header?.includes('Approved Store Requests'));
    const poCard = tableSpecs.find(t => t.header?.includes('Incoming Deliveries'));
    const drCard = tableSpecs.find(t => t.header?.includes('Recent Delivery Receipts (DR)'));

    if (!prCard) throw new Error('Missing Approved Store Requests card');
    if (!poCard) throw new Error('Missing Incoming Deliveries card');
    if (!drCard) throw new Error('Missing Recent Delivery Receipts card');

    console.log('Approved PR Card Header:', prCard.header);
    if (prCard.header !== 'Approved Store Requests') {
      throw new Error(`Expected Approved PR header to be exactly 'Approved Store Requests' without '(Pending Release)', got: '${prCard.header}'`);
    }

    // Check that neither preview table has horizontal overflow / scrollbars
    const overflowCheck = await evalJs(`
      Array.from(document.querySelectorAll('#dashboardRoleContent .gw-dashboard-table-wrap')).map(wrap => ({
        clientWidth: wrap.clientWidth,
        scrollWidth: wrap.scrollWidth,
        hasHorizontalScrollbar: wrap.scrollWidth > wrap.clientWidth
      }))
    `);
    console.log('Dashboard Preview Table Overflow Check:', overflowCheck);
    for (const ov of overflowCheck) {
      if (ov.hasHorizontalScrollbar) {
        throw new Error(`Found unexpected horizontal scrollbar on dashboard preview table! scrollWidth (${ov.scrollWidth}) > clientWidth (${ov.clientWidth})`);
      }
    }

    console.log('Approved PR THs:', prCard.ths);
    if (prCard.ths.join('|') !== 'REQUEST NO.|DESTINATION STORE|REQUESTED BY') {
      throw new Error('Approved PR TH mismatch: ' + prCard.ths.join('|'));
    }

    console.log('Incoming Deliveries THs:', poCard.ths);
    if (poCard.ths.join('|') !== 'PO NUMBER|SUPPLIER|EXPECTED ITEMS') {
      throw new Error('Incoming Deliveries TH mismatch: ' + poCard.ths.join('|'));
    }

    console.log('Recent Delivery Receipts THs:', drCard.ths);
    if (drCard.ths.join('|') !== 'RECEIVING NO.|PO NO.|SUPPLIER|UNITS RCVD|DATE') {
      throw new Error('Delivery Receipts TH mismatch: ' + drCard.ths.join('|'));
    }

    // -------------------------------------------------------------
    // Verify Card Header Horizontal Flex Alignment
    // -------------------------------------------------------------
    console.log('--- 5b. Verifying Card Header Horizontal Flex Alignment ---');
    async function checkCardHeaderAlignments(screenLabel) {
      const headerAlignments = await evalJs(`
        Array.from(document.querySelectorAll('#dashboardRoleContent .card-header')).map((header, idx) => {
          const title = header.querySelector('h5, h6, .card-title, .gw-card-header-title');
          const btn = header.querySelector('button, .btn, a, .gw-card-header-action');
          if (!title || !btn) return null;

          const hRect = header.getBoundingClientRect();
          const tRect = title.getBoundingClientRect();
          const bRect = btn.getBoundingClientRect();

          const hStyle = window.getComputedStyle(header);
          const tStyle = window.getComputedStyle(title);
          const bStyle = window.getComputedStyle(btn);

          // Check vertical alignment: centers must be approximately equal
          const tCenter = (tRect.top + tRect.bottom) / 2;
          const bCenter = (bRect.top + bRect.bottom) / 2;
          const vDiff = Math.abs(tCenter - bCenter);

          // Check horizontal positioning: title on left, button on right
          const titleOnLeft = tRect.left < bRect.left;
          const noOverlap = (tRect.right <= bRect.left + 2); // small tolerance

          return {
            title: title.textContent.trim(),
            btnText: btn.textContent.trim(),
            display: hStyle.display,
            flexDirection: hStyle.flexDirection,
            flexWrap: hStyle.flexWrap,
            justifyContent: hStyle.justifyContent,
            alignItems: hStyle.alignItems,
            titleOverflow: tStyle.overflow,
            titleTextOverflow: tStyle.textOverflow,
            titleWhiteSpace: tStyle.whiteSpace,
            btnWhiteSpace: bStyle.whiteSpace,
            btnFlexShrink: bStyle.flexShrink,
            vDiff,
            sameRow: vDiff <= 12,
            titleOnLeft,
            noOverlap,
            tRect: { left: Math.round(tRect.left), right: Math.round(tRect.right), top: Math.round(tRect.top) },
            bRect: { left: Math.round(bRect.left), right: Math.round(bRect.right), top: Math.round(bRect.top) }
          };
        }).filter(Boolean)
      `);

      console.log(`[${screenLabel}] Card Header Alignment Results:`);
      for (const res of headerAlignments) {
        console.log(`  Card: "${res.title}" | Action: "${res.btnText}"`);
        console.log(`    Flex: display=${res.display}, dir=${res.flexDirection}, wrap=${res.flexWrap}, justify=${res.justifyContent}`);
        console.log(`    Title styling: whitespace=${res.titleWhiteSpace}, overflow=${res.titleOverflow}, ellipsis=${res.titleTextOverflow}`);
        console.log(`    Button styling: whitespace=${res.btnWhiteSpace}, shrink=${res.btnFlexShrink}`);
        console.log(`    Geometry: sameRow=${res.sameRow} (vDiff=${Math.round(res.vDiff)}px), titleOnLeft=${res.titleOnLeft}, noOverlap=${res.noOverlap}`);

        if (!res.sameRow) {
          throw new Error(`[${screenLabel}] Card "${res.title}" title and action button are NOT on the same horizontal row! vDiff=${res.vDiff}px`);
        }
        if (!res.titleOnLeft) {
          throw new Error(`[${screenLabel}] Card "${res.title}" title is not on the left of action button!`);
        }
        if (res.btnWhiteSpace !== 'nowrap') {
          throw new Error(`[${screenLabel}] Card "${res.title}" action button does not have white-space: nowrap!`);
        }
        if (res.btnFlexShrink !== '0') {
          throw new Error(`[${screenLabel}] Card "${res.title}" action button does not have flex-shrink: 0!`);
        }
      }
    }

    // Test Desktop Screen (1400px)
    await checkCardHeaderAlignments('Desktop (1400px)');

    // Test Tablet Screen (768px)
    console.log('Testing Tablet Screen (768px)...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 768,
      height: 1024,
      deviceScaleFactor: 1,
      mobile: false
    });
    await sleep(400);
    await checkCardHeaderAlignments('Tablet (768px)');

    // Test Mobile Screen (375px)
    console.log('Testing Mobile Screen (375px)...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 667,
      deviceScaleFactor: 1,
      mobile: true
    });
    await sleep(400);
    await checkCardHeaderAlignments('Mobile (375px)');

    // Reset back to Desktop
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1400,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await sleep(400);

    console.log('--- 6. Verifying Modals & Interactive View All ---');
    
    // Test Modal 1: Approved Store Requests Modal
    console.log('Opening Approved Store Requests Modal...');
    await evalJs(`openWhApprovedStoreRequestsModal()`);
    await sleep(600);
    const prModalVisible = await evalJs(`document.getElementById('whApprovedStoreRequestsModal')?.classList.contains('show')`);
    const prModalTitle = await evalJs(`document.getElementById('whApprovedStoreRequestsModalTitle')?.textContent.trim()`);
    console.log(`PR Modal Visible: ${prModalVisible}, Title: ${prModalTitle}`);
    if (!prModalVisible || !prModalTitle?.includes('Approved Store Requests')) {
      throw new Error('PR Modal did not open correctly');
    }
    await evalJs(`closeModal('whApprovedStoreRequestsModal')`);
    await sleep(600);

    // Test Modal 2: Incoming Deliveries Modal
    console.log('Opening Incoming Deliveries Modal...');
    await evalJs(`openWhIncomingDeliveriesModal()`);
    await sleep(600);
    const poModalVisible = await evalJs(`document.getElementById('whIncomingDeliveriesModal')?.classList.contains('show')`);
    const poModalTitle = await evalJs(`document.getElementById('whIncomingDeliveriesModalTitle')?.textContent.trim()`);
    console.log(`PO Modal Visible: ${poModalVisible}, Title: ${poModalTitle}`);
    if (!poModalVisible || !poModalTitle?.includes('Incoming Deliveries')) {
      throw new Error('PO Modal did not open correctly');
    }
    await evalJs(`closeModal('whIncomingDeliveriesModal')`);
    await sleep(600);

    // Test Modal 3: Delivery Receipts Modal
    console.log('Opening Delivery Receipts Modal...');
    await evalJs(`openWhDeliveryReceiptsModal()`);
    await sleep(600);
    const drModalVisible = await evalJs(`document.getElementById('whDeliveryReceiptsModal')?.classList.contains('show')`);
    const drModalTitle = await evalJs(`document.getElementById('whDeliveryReceiptsModalTitle')?.textContent.trim()`);
    const drInitialRows = await evalJs(`document.querySelectorAll('#whModalDrTableBody tr').length`);
    const drInitialInfo = await evalJs(`document.getElementById('whModalDrPaginationInfo')?.textContent.trim()`);
    console.log(`DR Modal Visible: ${drModalVisible}, Title: ${drModalTitle}, Rows: ${drInitialRows}, Info: ${drInitialInfo}`);

    if (!drModalVisible || !drModalTitle?.includes('Recent Delivery Receipts')) {
      throw new Error('DR Modal did not open correctly');
    }
    if (drInitialRows !== 5) {
      throw new Error(`Expected default 5 rows per page in DR Modal, got ${drInitialRows}`);
    }

    // Test Search in DR Modal
    console.log('Testing search filter in DR Modal (query: IronCore)...');
    await evalJs(`
      const input = document.getElementById('whModalDrSearch');
      input.value = 'IronCore';
      input.dispatchEvent(new Event('input'));
    `);
    await sleep(400);
    const drFilteredRows = await evalJs(`document.querySelectorAll('#whModalDrTableBody tr').length`);
    const drFilteredInfo = await evalJs(`document.getElementById('whModalDrPaginationInfo')?.textContent.trim()`);
    console.log(`Search result rows: ${drFilteredRows}, Info: ${drFilteredInfo}`);

    // Test Page Size change in DR Modal
    console.log('Testing page size change (Show: 10)...');
    await evalJs(`
      const sel = document.getElementById('whModalDrPageSize');
      sel.value = '10';
      sel.dispatchEvent(new Event('change'));
    `);
    await sleep(400);
    const drPage10Rows = await evalJs(`document.querySelectorAll('#whModalDrTableBody tr').length`);
    const drPage10Info = await evalJs(`document.getElementById('whModalDrPaginationInfo')?.textContent.trim()`);
    console.log(`Page size 10 rows: ${drPage10Rows}, Info: ${drPage10Info}`);
    if (drPage10Rows !== 10) {
      throw new Error(`Expected 10 rows when page size set to 10, got ${drPage10Rows}`);
    }

    await evalJs(`closeModal('whDeliveryReceiptsModal')`);
    await sleep(600);

    // Test Theme compatibility
    console.log('--- 7. Verifying Dark Mode and Light Mode Styles ---');
    await evalJs(`
      document.documentElement.setAttribute('data-theme', 'dark');
      document.body.classList.add('gw-dark-mode');
    `);
    await sleep(300);
    const darkThemeSet = await evalJs(`document.documentElement.getAttribute('data-theme')`);
    console.log('Dark Mode applied:', darkThemeSet === 'dark');

    await evalJs(`
      document.documentElement.setAttribute('data-theme', 'light');
      document.body.classList.remove('gw-dark-mode');
    `);
    await sleep(300);
    const lightThemeSet = await evalJs(`document.documentElement.getAttribute('data-theme')`);
    console.log('Light Mode reset:', lightThemeSet === 'light');

    console.log('\n======================================================');
    console.log('SUCCESS: ALL WAREHOUSE DASHBOARD TESTS PASSED!');
    console.log('======================================================');
  } finally {
    if (ws) ws.close();
    browserProcess.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
  }
}

run().catch(err => {
  console.error('\nTEST FAILED:', err);
  browserProcess.kill();
  process.exit(1);
});
