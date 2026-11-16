const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TEMP_USER_DATA = path.join(os.tmpdir(), 'edge_header_test_' + Date.now());
const PORT = 9223;
const ARTIFACT_DIR = 'C:\\Users\\zhenmar\\.gemini\\antigravity\\brain\\d15aaf66-1d71-4a15-b98b-c41a42d5b428';

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
}

async function runBrowserVerification() {
  console.log('Launching Edge in headless mode on port ' + PORT + '...');
  const edgeProcess = spawn(EDGE_PATH, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    `--user-data-dir=${TEMP_USER_DATA}`,
    '--window-size=1440,900',
    'about:blank'
  ]);

  let connected = false;
  let wsUrl = '';
  for (let i = 0; i < 30; i++) {
    await wait(400);
    try {
      const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
      if (list && list.length > 0 && list[0].webSocketDebuggerUrl) {
        wsUrl = list[0].webSocketDebuggerUrl;
        connected = true;
        break;
      }
    } catch (e) {}
  }

  if (!connected) {
    throw new Error('Failed to connect to Edge remote debugging endpoint');
  }

  const list = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
  const target = list.find(t => t.type === 'page') || list[0];
  const client = new CDPClient(target.webSocketDebuggerUrl);
  await client.connect();
  console.log('Connected to Edge CDP.');

  await client.send('Page.enable');
  await client.send('DOM.enable');
  await client.send('Runtime.enable');

  const testUrl = 'http://localhost/updated_inventory_website/warehouse_finals/index.php';
  console.log(`Navigating to ${testUrl}...`);
  await client.send('Page.navigate', { url: testUrl });
  await wait(1500);

  // Perform login
  const loginRes = await client.send('Runtime.evaluate', {
    expression: `
      (async function() {
        const u = document.getElementById('login_username');
        const p = document.getElementById('login_password');
        const form = document.getElementById('loginForm');
        if (u && p && form) {
          u.value = 'admin';
          p.value = 'admin123';
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          return 'submitted';
        }
        return 'no_form_found';
      })()
    `,
    awaitPromise: true,
    returnByValue: true
  });
  console.log('Login action result:', loginRes.result.value);
  await wait(2500);

  // Verify header elements
  const headerCheck = await client.send('Runtime.evaluate', {
    expression: `
      (function() {
        const topbar = document.getElementById('appTopbar');
        const searchInput = document.getElementById('topbarGlobalSearch');
        const searchWrap = document.querySelector('.gw-topbar-search-wrap');
        const menuBtn = document.getElementById('sidebarCollapseBtn');
        const themeBtn = document.getElementById('topbarThemeToggleBtn');
        const notifBtn = document.getElementById('topbarNotifBtn');
        const profileMenu = document.getElementById('topbarAccountMenu');

        const topbarRect = topbar ? topbar.getBoundingClientRect() : null;
        const menuRect = menuBtn ? menuBtn.getBoundingClientRect() : null;
        const themeRect = themeBtn ? themeBtn.getBoundingClientRect() : null;
        const notifRect = notifBtn ? notifBtn.getBoundingClientRect() : null;
        const profileRect = profileMenu ? profileMenu.getBoundingClientRect() : null;

        return {
          topbarExists: !!topbar,
          searchInDom: !!searchInput,
          searchWrapInDom: !!searchWrap,
          topbarHeight: topbarRect ? topbarRect.height : 0,
          menuPos: menuRect ? { left: menuRect.left, right: menuRect.right } : null,
          themePos: themeRect ? { left: themeRect.left, right: themeRect.right } : null,
          notifPos: notifPos = notifRect ? { left: notifRect.left, right: notifRect.right } : null,
          profilePos: profileRect ? { left: profileRect.left, right: profileRect.right } : null,
          currentTheme: document.documentElement.getAttribute('data-theme')
        };
      })()
    `,
    returnByValue: true
  });

  console.log('Header verification:', JSON.stringify(headerCheck.result.value, null, 2));

  const val = headerCheck.result.value;
  if (val.searchInDom) throw new Error('Search input still in DOM!');
  if (val.searchWrapInDom) throw new Error('Search wrapper still in DOM!');
  if (!val.menuPos || !val.themePos || !val.notifPos || !val.profilePos) {
    throw new Error('Header controls missing bounding boxes!');
  }
  // Menu must be on far left, theme/notif/profile on far right
  if (val.menuPos.right > val.themePos.left) {
    throw new Error('Menu and utility buttons overlap!');
  }
  if (val.themePos.right > val.notifPos.left) {
    throw new Error('Theme button must be to the left of notification bell!');
  }
  if (val.notifPos.right > val.profilePos.left) {
    throw new Error('Notification bell must be to the left of profile menu!');
  }

  console.log('[PASS] Header layout: [☰ Menu] is on the left, [Theme] [Notifications] [Profile ▼] on the right.');
  console.log('[PASS] No search bar exists in the header.');

  // Test Ctrl + K keypress
  const ctrlKResult = await client.send('Runtime.evaluate', {
    expression: `
      (function() {
        const activeBefore = document.activeElement ? document.activeElement.id : null;
        const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true });
        document.dispatchEvent(event);
        const activeAfter = document.activeElement ? document.activeElement.id : null;
        return { activeBefore, activeAfter, searchExists: !!document.getElementById('topbarGlobalSearch') };
      })()
    `,
    returnByValue: true
  });
  console.log('Ctrl + K test:', ctrlKResult.result.value);

  // Set theme to dark and capture header screenshot
  await client.send('Runtime.evaluate', {
    expression: `if (typeof setThemeMode === 'function') setThemeMode('dark');`
  });
  await wait(500);

  const darkScreenshot = await client.send('Page.captureScreenshot', { format: 'png' });
  const darkPath = path.join(ARTIFACT_DIR, 'verify_header_dark.png');
  fs.writeFileSync(darkPath, Buffer.from(darkScreenshot.data, 'base64'));
  console.log('Dark mode screenshot saved to:', darkPath);

  // Set theme to light and capture header screenshot
  await client.send('Runtime.evaluate', {
    expression: `if (typeof setThemeMode === 'function') setThemeMode('light');`
  });
  await wait(500);

  const lightScreenshot = await client.send('Page.captureScreenshot', { format: 'png' });
  const lightPath = path.join(ARTIFACT_DIR, 'verify_header_light.png');
  fs.writeFileSync(lightPath, Buffer.from(lightScreenshot.data, 'base64'));
  console.log('Light mode screenshot saved to:', lightPath);

  // Test product table search preservation
  const productSearchTest = await client.send('Runtime.evaluate', {
    expression: `
      (function() {
        if (typeof navigateTo === 'function') navigateTo('product');
        const prodSearch = document.getElementById('gw_search_productTable');
        return {
          prodSearchExists: !!prodSearch,
          prodSearchVisible: prodSearch ? (prodSearch.offsetParent !== null) : false
        };
      })()
    `,
    returnByValue: true
  });
  console.log('Product Inventory search check:', productSearchTest.result.value);
  if (!productSearchTest.result.value.prodSearchExists) {
    throw new Error('Product table search missing!');
  }
  if (!productSearchTest.result.value.prodSearchVisible) {
    throw new Error('Product table search not visible!');
  }

  console.log('[PASS] Product Inventory search input is fully visible and intact!');

  // Cleanup
  edgeProcess.kill();
  console.log('\nAll browser verification tests completed successfully!');
}

runBrowserVerification().catch(err => {
  console.error('Browser verification failed:', err);
  process.exit(1);
});
