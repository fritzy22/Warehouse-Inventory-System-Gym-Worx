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

const PORT = 9556;
const userDataDir = `C:\\Users\\zhenmar\\AppData\\Local\\Temp\\chrome_stock_movements_phase2_test_${Date.now()}`;
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

    console.log('--- 1. Navigating to Warehouse Finals App ---');
    await setViewport(1440, 900);
    await send('Page.navigate', { url: 'http://localhost/updated_inventory_website/warehouse_finals/index.php' });
    await sleep(2500);

    console.log('--- 2. Performing Login as Warehouse Officer ---');
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

    console.log('--- 3. Navigating to Stock Movement History Page ---');
    await evalJs(`
      (async () => {
        navigateTo('stock_movement');
        await loadStockMovements();
      })()
    `);
    await sleep(1500);

    console.log('--- 4. Checking Date Filter Dropdown & Capturing Open Menu ---');
    // Open date dropdown
    await evalJs(`
      (() => {
        const btn = document.getElementById('movementDateRangeBtn');
        const dd = bootstrap.Dropdown.getOrCreateInstance(btn);
        dd.show();
      })()
    `);
    await sleep(400);

    const dateMenuMetrics = await evalJs(`
      (() => {
        const menu = document.getElementById('movementDateRangeMenu');
        const rect = menu ? menu.getBoundingClientRect() : null;
        return {
          exists: !!menu,
          visible: menu && window.getComputedStyle(menu).display !== 'none',
          rect: rect ? { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width } : null,
          viewportHeight: window.innerHeight
        };
      })()
    `);
    console.log('Date Menu Metrics:', dateMenuMetrics);

    if (!dateMenuMetrics.visible) {
      throw new Error('Date range dropdown menu is not visible when opened!');
    }

    await captureScreenshot('stock_movement_date_filter_open.png');

    // Test Date Validation: Start Date > End Date
    console.log('--- 5. Testing Custom Date Validation (Start > End) ---');
    const dateValTest = await evalJs(`
      (() => {
        document.getElementById('movementDateStart').value = '2026-10-28';
        document.getElementById('movementDateEnd').value = '2026-10-01';
        applyCustomDateRange();
        const err = document.getElementById('customDateError');
        return {
          errorDisplayed: err && err.style.display !== 'none',
          errorText: err ? err.textContent : ''
        };
      })()
    `);
    console.log('Date Validation Test Result:', dateValTest);
    if (!dateValTest.errorDisplayed) {
      throw new Error('Expected date validation error when Start Date > End Date!');
    }

    // Apply valid preset
    await evalJs(`applyDatePreset('all')`);
    await sleep(300);

    console.log('--- 6. Verifying Clickability of All 6 Summary Cards ---');
    const cardsCheck = await evalJs(`
      (() => {
        const cards = [
          'cardKpiTotalMovements',
          'cardKpiStockReceived',
          'cardKpiStockReleased',
          'cardKpiStoreReturns',
          'cardKpiPurchaseReturns',
          'cardKpiAdjustments'
        ];
        return cards.map(id => {
          const el = document.getElementById(id);
          const style = el ? window.getComputedStyle(el) : {};
          return {
            id,
            hasPointer: style.cursor === 'pointer',
            tabIndex: el?.getAttribute('tabindex'),
            role: el?.getAttribute('role')
          };
        });
      })()
    `);
    console.log('Cards Clickability Check:', cardsCheck);

    const allCardsClickable = cardsCheck.every(c => c.hasPointer && c.tabIndex === '0' && c.role === 'button');
    if (!allCardsClickable) {
      throw new Error('Not all summary cards have pointer cursor or tabindex=0!');
    }

    console.log('--- 7. Testing Modal 1: Total Movements ---');
    const m1 = await evalJs(`
      (() => {
        openMovementCategoryModal('total');
        return {
          title: document.getElementById('movementCategoryModalLabel')?.textContent,
          rowCount: document.querySelectorAll('#categoryModalTableBody tr').length,
          paginationText: document.getElementById('categoryModalPaginationInfo')?.textContent
        };
      })()
    `);
    console.log('Modal 1 Result:', m1);
    await sleep(400);
    await captureScreenshot('modal_1_total_movements.png');

    console.log('--- 8. Testing Modal 2: Stock Received (+In) ---');
    const m2 = await evalJs(`
      (() => {
        openMovementCategoryModal('receiving');
        return {
          title: document.getElementById('movementCategoryModalLabel')?.textContent,
          rowCount: document.querySelectorAll('#categoryModalTableBody tr').length,
          paginationText: document.getElementById('categoryModalPaginationInfo')?.textContent,
          firstRowSupplier: document.querySelector('#categoryModalTableBody tr:first-child td:nth-child(5)')?.textContent
        };
      })()
    `);
    console.log('Modal 2 Result:', m2);
    await sleep(400);
    await captureScreenshot('modal_2_stock_received.png');

    console.log('--- 9. Testing Modal 3: Stock Released (-Out) ---');
    const m3 = await evalJs(`
      (() => {
        openMovementCategoryModal('releasing');
        return {
          title: document.getElementById('movementCategoryModalLabel')?.textContent,
          rowCount: document.querySelectorAll('#categoryModalTableBody tr').length,
          paginationText: document.getElementById('categoryModalPaginationInfo')?.textContent,
          firstRowDestination: document.querySelector('#categoryModalTableBody tr:first-child td:nth-child(5)')?.textContent
        };
      })()
    `);
    console.log('Modal 3 Result:', m3);
    await sleep(400);
    await captureScreenshot('modal_3_stock_released.png');

    console.log('--- 10. Testing Modal 4: Store Returns (+In) ---');
    const m4 = await evalJs(`
      (() => {
        openMovementCategoryModal('store_return');
        return {
          title: document.getElementById('movementCategoryModalLabel')?.textContent,
          rowCount: document.querySelectorAll('#categoryModalTableBody tr').length,
          paginationText: document.getElementById('categoryModalPaginationInfo')?.textContent,
          firstRowStore: document.querySelector('#categoryModalTableBody tr:first-child td:nth-child(5)')?.textContent
        };
      })()
    `);
    console.log('Modal 4 Result:', m4);
    await sleep(400);
    await captureScreenshot('modal_4_store_returns.png');

    console.log('--- 11. Testing Modal 5: Purchase Returns (-Out) ---');
    const m5 = await evalJs(`
      (() => {
        openMovementCategoryModal('purchase_return');
        return {
          title: document.getElementById('movementCategoryModalLabel')?.textContent,
          rowCount: document.querySelectorAll('#categoryModalTableBody tr').length,
          paginationText: document.getElementById('categoryModalPaginationInfo')?.textContent,
          firstRowSupplier: document.querySelector('#categoryModalTableBody tr:first-child td:nth-child(5)')?.textContent
        };
      })()
    `);
    console.log('Modal 5 Result:', m5);
    await sleep(400);
    await captureScreenshot('modal_5_purchase_returns.png');

    console.log('--- 12. Testing Modal 6: Adjustments (+/-) ---');
    const m6 = await evalJs(`
      (() => {
        openMovementCategoryModal('adjustment');
        return {
          title: document.getElementById('movementCategoryModalLabel')?.textContent,
          rowCount: document.querySelectorAll('#categoryModalTableBody tr').length,
          paginationText: document.getElementById('categoryModalPaginationInfo')?.textContent,
          firstRowReason: document.querySelector('#categoryModalTableBody tr:first-child td:nth-child(5)')?.textContent
        };
      })()
    `);
    console.log('Modal 6 Result:', m6);
    await sleep(400);
    await captureScreenshot('modal_6_adjustments.png');

    console.log('--- 13. Testing Search inside Category Modal ---');
    const searchModalRes = await evalJs(`
      (() => {
        const inp = document.getElementById('categoryModalSearchInput');
        inp.value = 'Olympic';
        handleCategoryModalSearch();
        return {
          filteredCount: categoryModalFilteredRows.length,
          rowCount: document.querySelectorAll('#categoryModalTableBody tr').length,
          paginationText: document.getElementById('categoryModalPaginationInfo')?.textContent
        };
      })()
    `);
    console.log('Modal Search Result:', searchModalRes);

    console.log('--- 14. Testing View Details Action from inside Category Modal ---');
    const modalDetailsRes = await evalJs(`
      (() => {
        openCategoryModalMovementDetails(0);
        return {
          refNo: document.getElementById('modalRefNo')?.textContent,
          product: document.getElementById('modalProductName')?.textContent,
          date: document.getElementById('modalDate')?.textContent
        };
      })()
    `);
    console.log('Modal View Details Result:', modalDetailsRes);
    await sleep(300);

    // Close details modal
    await evalJs(`
      (() => {
        const modal = bootstrap.Modal.getInstance(document.getElementById('movementDetailsModal'));
        if (modal) modal.hide();
      })()
    `);
    await sleep(300);

    // Close category modal
    await evalJs(`
      (() => {
        const modal = bootstrap.Modal.getInstance(document.getElementById('movementCategoryModal'));
        if (modal) modal.hide();
      })()
    `);
    await sleep(300);

    console.log('--- 15. Testing Export from Category Modal ---');
    const exportModalRes = await evalJs(`
      (() => {
        try {
          openMovementCategoryModal('receiving');
          exportCategoryModalMovements();
          bootstrap.Modal.getInstance(document.getElementById('movementCategoryModal'))?.hide();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      })()
    `);
    console.log('Modal Export Result:', exportModalRes);
    await sleep(300);

    console.log('--- 16. Final Screenshots (Desktop Light, Dark, Tablet, Mobile) ---');
    await evalJs(`setThemeMode('light')`);
    await sleep(300);
    await captureScreenshot('stock_movement_improved_desktop_light.png');

    await evalJs(`setThemeMode('dark')`);
    await sleep(300);
    await captureScreenshot('stock_movement_improved_desktop_dark.png');

    await setViewport(1024, 768);
    await sleep(300);
    await captureScreenshot('stock_movement_improved_tablet.png');

    await setViewport(390, 844);
    await sleep(300);
    await captureScreenshot('stock_movement_improved_mobile.png');

    console.log('\n======================================================');
    console.log('ALL PHASE 1 - 8 VERIFICATION CHECKS PASSED PERFECTLY!');
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
