const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TEMP_USER_DATA = path.join(os.tmpdir(), 'edge_gymworx_test_' + Date.now());
const PORT = 9222;

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.events = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const { resolve, reject } = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        } else if (msg.method) {
          const handler = this.events.get(msg.method);
          if (handler) handler(msg.params);
        }
      };
    });
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  }

  async screenshot(filepath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filepath, Buffer.from(res.data, 'base64'));
    console.log(`[SCREENSHOT] Saved to: ${filepath}`);
  }

  close() {
    this.ws.close();
  }
}

async function run() {
  console.log('=== GYMWORX STOCK RELEASING BROWSER LAYOUT VERIFICATION ===\n');

  if (!fs.existsSync(EDGE_PATH)) {
    console.error('Edge executable not found at: ' + EDGE_PATH);
    process.exit(1);
  }

  const scratchDir = 'C:\\Users\\zhenmar\\.gemini\\antigravity\\brain\\d15aaf66-1d71-4a15-b98b-c41a42d5b428\\scratch';
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

  const edgeProc = spawn(EDGE_PATH, [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${TEMP_USER_DATA}`,
    'about:blank'
  ], { stdio: 'ignore' });

  // Wait for Edge CDP
  let connected = false;
  for (let i = 0; i < 30; i++) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
      if (list && list.length > 0) {
        connected = true;
        break;
      }
    } catch (e) {}
    await wait(300);
  }

  if (!connected) {
    console.error('Could not connect to Edge DevTools Protocol');
    edgeProc.kill('SIGKILL');
    process.exit(1);
  }

  const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
  const target = list.find(t => t.type === 'page') || list[0];
  const cdp = new CDPClient(target.webSocketDebuggerUrl);
  await cdp.connect();

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  try {
    // 1. Test 1920x1080 (Standard Wide Desktop)
    console.log('--- 1. Testing Desktop 1920x1080 ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });

    await cdp.send('Page.navigate', { url: 'http://localhost/updated_inventory_website/warehouse_finals/' });
    await wait(1500);

    // Login via script
    console.log('Logging in as admin...');
    await cdp.eval(`
      (async function() {
        const u = document.getElementById('login_username');
        const p = document.getElementById('login_password');
        if (u && p) {
          u.value = 'admin';
          p.value = 'admin123';
          const form = document.getElementById('loginForm');
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      })();
    `);
    await wait(2000);

    // Navigate to stock releasing module
    console.log('Navigating to Stock Releasing module...');
    await cdp.eval(`
      (async function() {
        if (typeof showModule === 'function') {
          showModule('stock_releasing');
        } else {
          document.querySelectorAll('.panel').forEach(p => p.hidden = true);
          const p = document.getElementById('panel-stock_releasing');
          if (p) p.hidden = false;
        }
        if (typeof loadStockReleasing === 'function') {
          await loadStockReleasing();
        }
      })();
    `);
    await wait(2000);

    // Measure panels and tables at 1920x1080
    const metrics1920 = await cdp.eval(`
      (function() {
        const grid = document.querySelector('.stock-releasing-grid');
        const p1 = document.getElementById('releasingPendingPrCard');
        const p2 = document.getElementById('releasingHistoryCard');
        const p3 = document.getElementById('releasingStoreInventoryCard');

        const t1 = p1.querySelector('.panel-table-scroll');
        const t2 = p2.querySelector('.panel-table-scroll');
        const t3 = p3.querySelector('.panel-table-scroll');

        return {
          gridDisplay: getComputedStyle(grid).display,
          gridColumns: getComputedStyle(grid).gridTemplateColumns,
          gridWidth: grid.clientWidth,
          p1: { width: p1.clientWidth, height: p1.clientHeight },
          p2: { width: p2.clientWidth, height: p2.clientHeight },
          p3: { width: p3.clientWidth, height: p3.clientHeight },
          t1: { clientWidth: t1.clientWidth, scrollWidth: t1.scrollWidth, overflowX: getComputedStyle(t1).overflowX },
          t2: { clientWidth: t2.clientWidth, scrollWidth: t2.scrollWidth, overflowX: getComputedStyle(t2).overflowX },
          t3: { clientWidth: t3.clientWidth, scrollWidth: t3.scrollWidth, overflowX: getComputedStyle(t3).overflowX }
        };
      })()
    `);

    console.log('Grid Display:', metrics1920.gridDisplay);
    console.log('Grid Columns:', metrics1920.gridColumns);
    console.log('Panel 1 Width:', metrics1920.p1.width, 'Height:', metrics1920.p1.height);
    console.log('Panel 2 Width:', metrics1920.p2.width, 'Height:', metrics1920.p2.height);
    console.log('Panel 3 Width:', metrics1920.p3.width, 'Height:', metrics1920.p3.height);
    console.log('Table 1 Overflow Check:', metrics1920.t1.scrollWidth <= metrics1920.t1.clientWidth ? 'NO OVERFLOW (PASS)' : `OVERFLOW (${metrics1920.t1.scrollWidth} > ${metrics1920.t1.clientWidth})`);
    console.log('Table 2 Overflow Check:', metrics1920.t2.scrollWidth <= metrics1920.t2.clientWidth ? 'NO OVERFLOW (PASS)' : `OVERFLOW (${metrics1920.t2.scrollWidth} > ${metrics1920.t2.clientWidth})`);
    console.log('Table 3 Overflow Check:', metrics1920.t3.scrollWidth <= metrics1920.t3.clientWidth ? 'NO OVERFLOW (PASS)' : `OVERFLOW (${metrics1920.t3.scrollWidth} > ${metrics1920.t3.clientWidth})`);

    // Screenshot Light Mode 1920
    await cdp.screenshot(path.join(scratchDir, 'verify_1920_light.png'));

    // Test Dark Mode 1920
    console.log('\n--- 2. Testing Dark Mode 1920x1080 ---');
    await cdp.eval(`
      document.documentElement.setAttribute('data-theme', 'dark');
      document.body.classList.add('gw-dark-mode');
    `);
    await wait(500);
    await cdp.screenshot(path.join(scratchDir, 'verify_1920_dark.png'));

    // Switch back to light
    await cdp.eval(`
      document.documentElement.setAttribute('data-theme', 'light');
      document.body.classList.remove('gw-dark-mode');
    `);
    await wait(300);

    // 3. Test 1440x900 (Laptop / Desktop)
    console.log('\n--- 3. Testing Desktop 1440x900 ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
    await wait(500);

    const metrics1440 = await cdp.eval(`
      (function() {
        const p1 = document.getElementById('releasingPendingPrCard');
        const p2 = document.getElementById('releasingHistoryCard');
        const p3 = document.getElementById('releasingStoreInventoryCard');
        const t1 = p1.querySelector('.panel-table-scroll');
        const t2 = p2.querySelector('.panel-table-scroll');
        const t3 = p3.querySelector('.panel-table-scroll');
        const ths2 = Array.from(t2.querySelectorAll('thead th')).map(th => ({ text: th.innerText.replace(/\\n/g, ' '), w: th.getBoundingClientRect().width, scrollW: th.scrollWidth }));
        const tr1 = t2.querySelector('tbody tr');
        const tds2 = tr1 ? Array.from(tr1.querySelectorAll('td')).map(td => ({ text: td.innerText.replace(/\\n/g, ' '), w: td.clientWidth, sw: td.scrollWidth })) : [];
        console.log('TR1 cells:', JSON.stringify(tds2));
        const wider = Array.from(p2.querySelectorAll('*')).filter(el => el.scrollWidth > t2.clientWidth).map(el => ({ tag: el.tagName, id: el.id, cls: el.className, w: el.clientWidth, sw: el.scrollWidth }));
        return {
          t1: { clientWidth: t1.clientWidth, scrollWidth: t1.scrollWidth },
          t2: {
            clientWidth: t2.clientWidth,
            scrollWidth: t2.scrollWidth,
            parentClientWidth: t2.parentElement.clientWidth,
            tableClientWidth: t2.querySelector('table').clientWidth,
            tableScrollWidth: t2.querySelector('table').scrollWidth,
            tableOffsetWidth: t2.querySelector('table').offsetWidth,
            wider,
            ths2,
            tds2
          },
          t3: { clientWidth: t3.clientWidth, scrollWidth: t3.scrollWidth }
        };
      })()
    `);
    console.log('Wider elements in Table 2 (1440px):', JSON.stringify(metrics1440.t2.wider));
    console.log('Table 2 Details (1440px):', JSON.stringify({
      containerClientW: metrics1440.t2.clientWidth,
      containerScrollW: metrics1440.t2.scrollWidth,
      tableClientW: metrics1440.t2.tableClientWidth,
      tableOffsetW: metrics1440.t2.tableOffsetWidth,
      tableScrollW: metrics1440.t2.tableScrollWidth,
      tds2: metrics1440.t2.tds2
    }));
    console.log('Table 1 (1440px):', metrics1440.t1.scrollWidth <= metrics1440.t1.clientWidth ? 'NO OVERFLOW (PASS)' : `OVERFLOW (${metrics1440.t1.scrollWidth} > ${metrics1440.t1.clientWidth})`);
    console.log('Table 2 (1440px):', metrics1440.t2.scrollWidth <= metrics1440.t2.clientWidth ? 'NO OVERFLOW (PASS)' : `OVERFLOW (${metrics1440.t2.scrollWidth} > ${metrics1440.t2.clientWidth})`);
    console.log('Table 3 (1440px):', metrics1440.t3.scrollWidth <= metrics1440.t3.clientWidth ? 'NO OVERFLOW (PASS)' : `OVERFLOW (${metrics1440.t3.scrollWidth} > ${metrics1440.t3.clientWidth})`);
    await cdp.screenshot(path.join(scratchDir, 'verify_1440_light.png'));

    // 4. Test 1024x768 (Tablet)
    console.log('\n--- 4. Testing Tablet 1024x768 ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1024,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false
    });
    await wait(500);
    await cdp.screenshot(path.join(scratchDir, 'verify_1024_tablet.png'));

    // 5. Test 375x667 (Mobile)
    console.log('\n--- 5. Testing Mobile 375x667 ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true
    });
    await wait(500);
    await cdp.screenshot(path.join(scratchDir, 'verify_375_mobile.png'));

    // 6. Test Empty State explicitly
    console.log('\n--- 6. Testing Empty State on Approved Store Requests ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false
    });
    await cdp.eval(`
      renderPendingStoreRequests([]);
    `);
    await wait(500);
    const emptyMetrics = await cdp.eval(`
      (function() {
        const box = document.getElementById('releasingPendingPrEmpty');
        const th = document.querySelector('#releasingPendingPrTableWrapper thead');
        return {
          emptyVisible: box && getComputedStyle(box).display !== 'none',
          emptyHeight: box ? box.clientHeight : 0,
          headerVisible: th && getComputedStyle(th).display !== 'none'
        };
      })()
    `);
    console.log('Empty State Box Visible:', emptyMetrics.emptyVisible);
    console.log('Empty State Box Height:', emptyMetrics.emptyHeight);
    console.log('Table Header Kept Visible:', emptyMetrics.headerVisible);
    await cdp.screenshot(path.join(scratchDir, 'verify_empty_state.png'));

    console.log('\nALL BROWSER VERIFICATIONS COMPLETED SUCCESSFULLY!');
  } finally {
    cdp.close();
    edgeProc.kill();
    try { fs.rmSync(TEMP_USER_DATA, { recursive: true, force: true }); } catch (e) {}
  }
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
