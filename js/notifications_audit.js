let notifPollTimer = null;
let lastSeenNotificationId = 0;
let currentNotifUnreadOnly = false;
let stockMovementsCache = [];

function startNotificationPolling() {
  stopNotificationPolling();
  pollNotifications(true);
  notifPollTimer = setInterval(function () {
    if (authUser) pollNotifications(false);
  }, 25000);
}

function stopNotificationPolling() {
  if (notifPollTimer) {
    clearInterval(notifPollTimer);
    notifPollTimer = null;
  }
}

async function pollNotifications(isInitial) {
  if (!authUser) return;
  const res = await axios.get(API + 'notification.php?action=summary&after_id=' + lastSeenNotificationId);
  if (res.status !== 200 || !res.data || !res.data.success || !res.data.data) return;

  const d = res.data.data;
  const unread = parseInt(d.unread_count) || 0;
  const recent = d.recent || [];

  if (recent.length > 0) {
    const maxId = Math.max.apply(null, recent.map(n => parseInt(n.notification_id) || 0));
    if (!isInitial && lastSeenNotificationId > 0 && d.new_items && d.new_items.length > 0) {
      const newest = d.new_items[0];
      if (newest) {
        const msg = newest.message || '';
        const title = newest.title || '';
        const textToDisplay = msg.startsWith(title) ? msg : (title ? `${title}: ${msg}` : msg);
        if (textToDisplay) {
          showToast(textToDisplay);
        }
      }
    }
    if (maxId > lastSeenNotificationId) {
      lastSeenNotificationId = maxId;
    }
  }

  updateNotificationBadges(unread, recent);
}

function updateNotificationBadges(unreadCount, recentList) {
  const count = parseInt(unreadCount) || 0;
  const topBadge = document.getElementById('topbarNotifBadge');
  const sideBadge = document.getElementById('sidebarNotifBadge');
  const reqSideBadge = document.getElementById('sidebarRequesterNotifBadge');
  const mobileBadge = document.getElementById('mobileNotifBadge');
  const label = count > 99 ? '99+' : count;

  if (topBadge) {
    topBadge.textContent = label;
    topBadge.hidden = count <= 0;
  }
  if (sideBadge) {
    sideBadge.textContent = label;
    sideBadge.hidden = count <= 0;
  }
  if (reqSideBadge) {
    reqSideBadge.textContent = label;
    reqSideBadge.hidden = count <= 0;
  }
  if (mobileBadge) {
    mobileBadge.textContent = label;
    mobileBadge.hidden = count <= 0;
  }

  if (Array.isArray(recentList)) {
    renderTopbarNotificationDropdown(recentList);
  }
}

function renderTopbarNotificationDropdown(list) {
  const container = document.getElementById('topbarNotifDropdownList');
  if (!container) return;

  if (!list || list.length === 0) {
    container.innerHTML = '<div class="p-3 text-center text-muted small fst-italic">No notifications yet.</div>';
    return;
  }

  container.innerHTML = list.slice(0, 8).map(function (n) {
    const isUnread = parseInt(n.is_read) === 0;
    return `
      <div class="notif-item ${isUnread ? 'unread' : ''} p-2 px-3 border-bottom" role="button" onclick="handleNotificationClick(${n.notification_id}, '${escapeHtml(n.entity_type || '')}', ${parseInt(n.entity_id) || 0})">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <strong class="small text-dark">${escapeHtml(n.title)}</strong>
          <span class="text-muted flex-shrink-0" style="font-size:0.68rem;">${escapeHtml((n.created_at || '').slice(5, 16))}</span>
        </div>
        <div class="small text-muted mt-1">${escapeHtml(n.message)}</div>
      </div>
    `;
  }).join('');
}

async function loadNotificationsPanel(unreadOnly) {
  if (typeof unreadOnly === 'boolean') {
    currentNotifUnreadOnly = unreadOnly;
  }

  const btnAll = document.getElementById('notifFilterAll');
  const btnUnread = document.getElementById('notifFilterUnread');
  if (btnAll && btnUnread) {
    btnAll.className = !currentNotifUnreadOnly ? 'btn btn-dark' : 'btn btn-outline-secondary';
    btnUnread.className = currentNotifUnreadOnly ? 'btn btn-dark' : 'btn btn-outline-secondary';
  }

  const res = await axios.get(API + 'notification.php?action=list&limit=100' + (currentNotifUnreadOnly ? '&unread_only=1' : ''));
  if (res.status !== 200 || !res.data || !res.data.success) {
    showToast('Failed to load notifications', true);
    return;
  }

  const d = res.data.data || {};
  const items = Array.isArray(d) ? d : (d.items || []);
  const unreadCount = typeof d.unread_count === 'number' ? d.unread_count : items.filter(n => parseInt(n.is_read) === 0).length;
  updateNotificationBadges(unreadCount, items);

  const listEl = document.getElementById('notificationsFullList');
  if (!listEl) return;

  if (items.length === 0) {
    listEl.innerHTML = '<div class="p-4 text-center text-muted fst-italic">No notifications to display.</div>';
    return;
  }

  listEl.innerHTML = items.map(function (n) {
    const isUnread = parseInt(n.is_read) === 0;
    const toneMap = {
      success: 'text-success bi-check-circle-fill',
      warning: 'text-warning bi-exclamation-triangle-fill',
      danger: 'text-danger bi-exclamation-octagon-fill',
      info: 'text-primary bi-info-circle-fill'
    };
    const tone = n.severity || n.type || 'info';
    const iconCls = toneMap[tone] || toneMap.info;

    return `
      <div class="list-group-item notif-item ${isUnread ? 'unread' : ''} py-3 px-3 d-flex justify-content-between align-items-start gap-3" role="button" onclick="handleNotificationClick(${n.notification_id}, '${escapeHtml(n.entity_type || '')}', ${parseInt(n.entity_id) || 0})">
        <div class="d-flex align-items-start gap-3">
          <i class="bi ${iconCls} fs-5 mt-1"></i>
          <div>
            <div class="d-flex align-items-center gap-2">
              <strong class="text-dark">${escapeHtml(n.title)}</strong>
              ${isUnread ? '<span class="badge bg-warning text-dark" style="font-size:0.68rem;">New</span>' : ''}
            </div>
            <div class="text-muted small mt-1">${escapeHtml(n.message)}</div>
          </div>
        </div>
        <div class="text-end flex-shrink-0">
          <div class="small text-muted font-monospace">${escapeHtml((n.created_at || '').slice(0, 16))}</div>
          ${n.entity_type ? '<span class="badge bg-light text-secondary border mt-1">Open Record &rarr;</span>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

async function markAllNotificationsRead() {
  const res = await axios.put(API + 'notification.php', { action: 'mark_all_read' });
  if (res.status === 200 && res.data && res.data.success) {
    showToast('All notifications marked as read');
    pollNotifications(false);
    const panel = document.getElementById('panel-notifications');
    if (panel && !panel.hidden) {
      loadNotificationsPanel();
    }
  }
}

async function handleNotificationClick(notificationId, entityType, entityId) {
  if (notificationId) {
    await axios.put(API + 'notification.php', { action: 'mark_read', notification_id: parseInt(notificationId) });
    pollNotifications(false);
  }

  if (entityType === 'purchase_request') {
    if (can('purchase_request', 'view') || can('request_approval', 'view')) {
      navigateTo('purchase_request');
      if (entityId && typeof viewPurchaseRequestDetails === 'function') {
        viewPurchaseRequestDetails(entityId);
      }
    }
  } else if (entityType === 'purchase_order') {
    if (can('purchase_order', 'view')) {
      navigateTo('purchase_order');
      if (entityId && typeof viewPurchaseOrderDetails === 'function') {
        viewPurchaseOrderDetails(entityId);
      }
    }
  } else if (entityType === 'stock_receiving') {
    if (can('stock_receiving', 'view')) {
      navigateTo('stock_receiving');
      if (entityId && typeof viewReceivingDetails === 'function') {
        viewReceivingDetails(entityId);
      }
    }
  } else if (entityType === 'product') {
    if (can('product', 'view')) {
      navigateTo('product', { health: 'low' });
    }
  } else if (entityType === 'users' || entityType === 'role') {
    if (can('users', 'view') || can('role', 'view')) {
      navigateTo('users');
    }
  } else {
    const panel = document.getElementById('panel-notifications');
    if (panel && !panel.hidden) {
      loadNotificationsPanel();
    }
  }
}

let stockMovementsSummary = null;
let currentFilteredMovements = [];
let movementCurrentPage = 1;
let movementPageSize = 10;
let movementDateFilter = { preset: 'all', start: '', end: '' };

function renderSparklineSvg(containerId, color, points) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!points || points.length < 2) {
    points = [12, 18, 14, 25, 20, 32, 28, 40];
  }
  const min = Math.min.apply(null, points);
  const max = Math.max.apply(null, points);
  const range = max - min || 1;
  const w = 120;
  const h = 32;
  const pad = 2;

  const coords = points.map(function (p, i) {
    const x = pad + (i / (points.length - 1)) * (w - pad * 2);
    const y = h - pad - ((p - min) / range) * (h - pad * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  });

  const pathD = 'M ' + coords.join(' L ');
  const areaD = pathD + ' L ' + (w - pad) + ',' + h + ' L ' + pad + ',' + h + ' Z';
  const gradId = 'sparklineGrad_' + containerId;

  el.innerHTML =
    '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="width: 100%; height: 32px; display: block; overflow: visible;">' +
      '<defs>' +
        '<linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.25"/>' +
          '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.0"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<path d="' + areaD + '" fill="url(#' + gradId + ')"/>' +
      '<path d="' + pathD + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
}

function getMovementTypeBadge(type) {
  const t = String(type || '').trim();
  const lower = t.toLowerCase();
  if (lower.includes('receiving')) {
    return '<span class="badge rounded-pill bg-success-subtle text-success border border-success-subtle px-2 py-1 fw-medium font-monospace">Receiving (+In)</span>';
  }
  if (lower.includes('store return') || lower.includes('stocks return')) {
    return '<span class="badge rounded-pill bg-info-subtle text-info border border-info-subtle px-2 py-1 fw-medium font-monospace">Store Return (+In)</span>';
  }
  if (lower.includes('releasing')) {
    return '<span class="badge rounded-pill bg-danger-subtle text-danger border border-danger-subtle px-2 py-1 fw-medium font-monospace">Releasing (-Out)</span>';
  }
  if (lower.includes('purchase return')) {
    return '<span class="badge rounded-pill bg-warning-subtle text-warning-emphasis border border-warning-subtle px-2 py-1 fw-medium font-monospace">Purchase Return (-Out)</span>';
  }
  if (lower.includes('adjustment')) {
    return '<span class="badge rounded-pill gw-badge-purple border px-2 py-1 fw-medium font-monospace">Adjustment (+/-)</span>';
  }
  return '<span class="badge rounded-pill bg-secondary-subtle text-secondary border px-2 py-1 fw-medium font-monospace">' + escapeHtml(t) + '</span>';
}

function getQtyChangeBadge(row) {
  const isQuarantined = String(row.direction || '').toUpperCase() === 'QUARANTINED';
  const rawQ = row.qty_change !== undefined ? row.qty_change : (row.direction === 'OUT' ? -row.quantity : row.quantity);
  const q = parseInt(rawQ) || 0;
  if (isQuarantined) {
    return '<span class="badge rounded-pill bg-warning-subtle text-warning-emphasis border border-warning-subtle font-monospace px-2 py-1" title="Quarantined / Excluded from usable stock">0 (' + escapeHtml(String(row.quantity || 0)) + ' Quarantined)</span>';
  }
  if (q > 0) {
    return '<span class="badge rounded-pill bg-success-subtle text-success border border-success-subtle font-monospace px-2 py-1">+' + q.toLocaleString() + '</span>';
  }
  if (q < 0) {
    return '<span class="badge rounded-pill bg-danger-subtle text-danger border border-danger-subtle font-monospace px-2 py-1">' + q.toLocaleString() + '</span>';
  }
  return '<span class="badge rounded-pill bg-secondary-subtle text-secondary border border-secondary-subtle font-monospace px-2 py-1">0</span>';
}

function formatMovementDate(dtStr) {
  if (!dtStr) return '—';
  try {
    const parts = dtStr.split(' ')[0].split('-');
    if (parts.length === 3) {
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  } catch (e) {}
  return dtStr;
}

function formatMovementDateTime(dtStr) {
  if (!dtStr) return '—';
  try {
    const d = new Date(dtStr.replace(/-/g, '/'));
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
  } catch (e) {}
  return dtStr;
}

async function loadStockMovements() {
  try {
    const res = await axios.get(API + 'audit_log.php?mode=movements&limit=2000');
    if (res.status !== 200 || !res.data || !res.data.success) {
      showToast((res.data && res.data.message) || 'Failed to load stock movement history', true);
      return;
    }

    const resData = res.data.data;
    if (resData && Array.isArray(resData.movements)) {
      stockMovementsCache = resData.movements;
      stockMovementsSummary = resData.summary;
    } else if (Array.isArray(resData)) {
      stockMovementsCache = resData;
      stockMovementsSummary = null;
    } else {
      stockMovementsCache = [];
      stockMovementsSummary = null;
    }

    renderStockMovementKpis(stockMovementsSummary, stockMovementsCache);
    movementCurrentPage = 1;
    applyStockMovementFilters();
  } catch (err) {
    console.error('loadStockMovements error:', err);
    showToast('Failed to connect to stock movements server', true);
  }
}

function renderStockMovementKpis(summary, movements) {
  let totalMovements = 0;
  let stockReceived = 0;
  let stockReleased = 0;
  let storeReturns = 0;
  let purchaseReturns = 0;
  let adjustments = 0;

  if (summary) {
    totalMovements = parseInt(summary.total_movements) || 0;
    stockReceived = parseInt(summary.stock_received) || 0;
    stockReleased = parseInt(summary.stock_released) || 0;
    storeReturns = parseInt(summary.store_returns) || 0;
    purchaseReturns = parseInt(summary.purchase_returns) || 0;
    adjustments = parseInt(summary.adjustments_count) || 0;
  } else if (Array.isArray(movements)) {
    totalMovements = movements.length;
    movements.forEach(function (m) {
      const mt = String(m.movement_type || '').toLowerCase();
      const qty = parseInt(m.quantity) || 0;
      if (mt.includes('receiving')) stockReceived += qty;
      else if (mt.includes('releasing')) stockReleased += qty;
      else if (mt.includes('store return') || mt.includes('stocks return')) storeReturns += qty;
      else if (mt.includes('purchase return')) purchaseReturns += qty;
      else if (mt.includes('adjustment')) adjustments++;
    });
  }

  const elTotal = document.getElementById('kpiTotalMovements');
  const elRcv = document.getElementById('kpiStockReceived');
  const elRel = document.getElementById('kpiStockReleased');
  const elSrt = document.getElementById('kpiStoreReturns');
  const elPrt = document.getElementById('kpiPurchaseReturns');
  const elAdj = document.getElementById('kpiAdjustments');

  if (elTotal) elTotal.textContent = totalMovements.toLocaleString();
  if (elRcv) elRcv.textContent = '+' + stockReceived.toLocaleString();
  if (elRel) elRel.textContent = '-' + stockReleased.toLocaleString();
  if (elSrt) elSrt.textContent = storeReturns.toLocaleString();
  if (elPrt) elPrt.textContent = purchaseReturns.toLocaleString();
  if (elAdj) elAdj.textContent = adjustments.toLocaleString();

  // Dynamic sparklines
  renderSparklineSvg('sparklineTotalMovements', '#64748b', [totalMovements * 0.6, totalMovements * 0.75, totalMovements * 0.7, totalMovements * 0.85, totalMovements * 0.8, totalMovements * 0.95, totalMovements]);
  renderSparklineSvg('sparklineStockReceived', '#16a34a', [stockReceived * 0.5, stockReceived * 0.65, stockReceived * 0.58, stockReceived * 0.8, stockReceived * 0.75, stockReceived * 0.9, stockReceived]);
  renderSparklineSvg('sparklineStockReleased', '#dc2626', [stockReleased * 0.55, stockReleased * 0.7, stockReleased * 0.62, stockReleased * 0.85, stockReleased * 0.8, stockReleased * 0.92, stockReleased]);
  renderSparklineSvg('sparklineStoreReturns', '#0284c7', [storeReturns * 0.4, storeReturns * 0.6, storeReturns * 0.55, storeReturns * 0.75, storeReturns * 0.7, storeReturns * 0.85, storeReturns]);
  renderSparklineSvg('sparklinePurchaseReturns', '#ea580c', [purchaseReturns * 0.45, purchaseReturns * 0.6, purchaseReturns * 0.52, purchaseReturns * 0.78, purchaseReturns * 0.7, purchaseReturns * 0.88, purchaseReturns]);
  renderSparklineSvg('sparklineAdjustments', '#7c3aed', [adjustments * 0.5, adjustments * 0.65, adjustments * 0.6, adjustments * 0.8, adjustments * 0.75, adjustments * 0.9, adjustments]);
}

function handleStockMovementFilterChange() {
  movementCurrentPage = 1;
  applyStockMovementFilters();
}

/* ==========================================================================
   Portal Date Range Controller (Smart Placement & No Stacking Clipping)
   ========================================================================== */
function toggleMovementDateRangeDropdown(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const menu = document.getElementById('movementDateRangeMenu');
  if (!menu) return;

  const isVisible = menu.classList.contains('show');
  if (isVisible) {
    closeMovementDateRangeDropdown();
  } else {
    openMovementDateRangeDropdown();
  }
}

function openMovementDateRangeDropdown() {
  const menu = document.getElementById('movementDateRangeMenu');
  const btn = document.getElementById('movementDateRangeBtn');
  if (!menu || !btn) return;

  // Move to body portal if not already moved to guarantee no parent overflow clipping
  if (menu.parentNode !== document.body) {
    document.body.appendChild(menu);
  }

  menu.classList.add('show');
  menu.style.display = 'block';
  btn.setAttribute('aria-expanded', 'true');

  positionMovementDateRangeDropdown();

  // Attach global positioning & dismissal listeners
  window.addEventListener('scroll', onMovementDateScroll, true);
  window.addEventListener('resize', onMovementDateResize);
  document.addEventListener('click', onMovementDateOutsideClick);
  document.addEventListener('keydown', onMovementDateKeydown);
}

function closeMovementDateRangeDropdown() {
  const menu = document.getElementById('movementDateRangeMenu');
  const btn = document.getElementById('movementDateRangeBtn');
  if (!menu) return;

  menu.classList.remove('show');
  menu.style.display = 'none';
  if (btn) btn.setAttribute('aria-expanded', 'false');

  window.removeEventListener('scroll', onMovementDateScroll, true);
  window.removeEventListener('resize', onMovementDateResize);
  document.removeEventListener('click', onMovementDateOutsideClick);
  document.removeEventListener('keydown', onMovementDateKeydown);
}

function positionMovementDateRangeDropdown() {
  const menu = document.getElementById('movementDateRangeMenu');
  const btn = document.getElementById('movementDateRangeBtn');
  if (!menu || !btn || !menu.classList.contains('show')) return;

  const btnRect = btn.getBoundingClientRect();
  const menuWidth = Math.max(320, menu.offsetWidth || 320);
  const menuHeight = menu.offsetHeight || 330;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const gap = 6;

  // Smart placement: check if enough space below or flip upward
  const spaceBelow = vh - btnRect.bottom;
  const spaceAbove = btnRect.top;
  let top;
  let openUpward = false;

  if (spaceBelow < menuHeight + gap + 10 && spaceAbove > spaceBelow) {
    // Open Upward
    openUpward = true;
    top = Math.max(10, btnRect.top - menuHeight - gap);
  } else {
    // Open Downward
    top = Math.min(vh - menuHeight - 10, btnRect.bottom + gap);
  }

  // Horizontal placement: align with right edge of button, constrained by viewport
  let left = btnRect.right - menuWidth;
  if (left < 10) left = 10;
  if (left + menuWidth > vw - 10) left = vw - menuWidth - 10;

  // Mobile viewport centering (< 576px)
  if (vw < 576) {
    left = Math.max(10, (vw - menuWidth) / 2);
    top = Math.max(20, (vh - menuHeight) / 2);
  }

  menu.style.position = 'fixed';
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
  menu.style.zIndex = '2050';
  menu.setAttribute('data-placement', openUpward ? 'top' : 'bottom');
}

function onMovementDateScroll() {
  positionMovementDateRangeDropdown();
}

function onMovementDateResize() {
  positionMovementDateRangeDropdown();
}

function onMovementDateOutsideClick(e) {
  const menu = document.getElementById('movementDateRangeMenu');
  const btn = document.getElementById('movementDateRangeBtn');
  if (!menu || !btn) return;
  if (menu.contains(e.target) || btn.contains(e.target)) return;
  closeMovementDateRangeDropdown();
}

function onMovementDateKeydown(e) {
  if (e.key === 'Escape') {
    closeMovementDateRangeDropdown();
    const btn = document.getElementById('movementDateRangeBtn');
    if (btn) btn.focus();
  }
}

function applyDatePreset(preset) {
  movementDateFilter.preset = preset;
  movementDateFilter.start = '';
  movementDateFilter.end = '';

  const labelEl = document.getElementById('movementDateRangeLabel');
  if (labelEl) {
    const labels = {
      all: 'All Time',
      today: 'Today',
      '7days': 'Last 7 Days',
      '30days': 'Last 30 Days',
      this_month: 'This Month'
    };
    labelEl.textContent = labels[preset] || 'All Time';
  }

  // Update active styling and checkmarks
  document.querySelectorAll('.gw-date-preset-item').forEach(function (btn) {
    const p = btn.getAttribute('data-preset');
    const check = btn.querySelector('[data-preset-check]');
    if (p === preset) {
      btn.classList.add('active');
      if (check) check.classList.remove('d-none');
    } else {
      btn.classList.remove('active');
      if (check) check.classList.add('d-none');
    }
  });

  const errEl = document.getElementById('customDateError');
  if (errEl) errEl.style.display = 'none';

  closeMovementDateRangeDropdown();

  movementCurrentPage = 1;
  applyStockMovementFilters();
}

function applyCustomDateRange() {
  const startEl = document.getElementById('movementDateStart');
  const endEl = document.getElementById('movementDateEnd');
  const errEl = document.getElementById('customDateError');
  const startVal = startEl ? startEl.value : '';
  const endVal = endEl ? endEl.value : '';

  if (errEl) errEl.style.display = 'none';

  if (!startVal && !endVal) {
    if (errEl) {
      errEl.textContent = 'Please select at least a start or end date.';
      errEl.style.display = 'block';
    }
    showToast('Please select at least a start or end date', true);
    return;
  }

  if (startVal && endVal && startVal > endVal) {
    if (errEl) {
      errEl.textContent = 'Start date cannot be after end date.';
      errEl.style.display = 'block';
    }
    showToast('Start date cannot be after end date', true);
    return;
  }

  movementDateFilter.preset = 'custom';
  movementDateFilter.start = startVal;
  movementDateFilter.end = endVal;

  const labelEl = document.getElementById('movementDateRangeLabel');
  if (labelEl) {
    if (startVal && endVal) {
      labelEl.textContent = startVal + ' to ' + endVal;
    } else if (startVal) {
      labelEl.textContent = 'From ' + startVal;
    } else {
      labelEl.textContent = 'Until ' + endVal;
    }
  }

  document.querySelectorAll('.gw-date-preset-item').forEach(function (btn) {
    btn.classList.remove('active');
    const check = btn.querySelector('[data-preset-check]');
    if (check) check.classList.add('d-none');
  });

  closeMovementDateRangeDropdown();

  movementCurrentPage = 1;
  applyStockMovementFilters();
}

function cancelCustomDateRange() {
  const startEl = document.getElementById('movementDateStart');
  const endEl = document.getElementById('movementDateEnd');
  const errEl = document.getElementById('customDateError');
  if (startEl) startEl.value = '';
  if (endEl) endEl.value = '';
  if (errEl) errEl.style.display = 'none';
  closeMovementDateRangeDropdown();
}

function resetStockMovementFilters() {
  const sInput = document.getElementById('stockMovementSearchInput');
  const typeSel = document.getElementById('movementTypeFilter');
  const startEl = document.getElementById('movementDateStart');
  const endEl = document.getElementById('movementDateEnd');
  const errEl = document.getElementById('customDateError');

  if (sInput) sInput.value = '';
  if (typeSel) typeSel.value = '';
  if (startEl) startEl.value = '';
  if (endEl) endEl.value = '';
  if (errEl) errEl.style.display = 'none';

  movementDateFilter = { preset: 'all', start: '', end: '' };
  const labelEl = document.getElementById('movementDateRangeLabel');
  if (labelEl) labelEl.textContent = 'All Time';

  document.querySelectorAll('.gw-date-preset-item').forEach(function (btn) {
    const p = btn.getAttribute('data-preset');
    const check = btn.querySelector('[data-preset-check]');
    if (p === 'all') {
      btn.classList.add('active');
      if (check) check.classList.remove('d-none');
    } else {
      btn.classList.remove('active');
      if (check) check.classList.add('d-none');
    }
  });

  closeMovementDateRangeDropdown();

  movementCurrentPage = 1;
  applyStockMovementFilters();
}

/* ==========================================================================
   Reusable Filtered Movement Category Modal (Phases 2 & 3)
   ========================================================================== */
let categoryModalType = 'total';
let categoryModalRows = [];
let categoryModalFilteredRows = [];
let categoryModalCurrentPage = 1;
let categoryModalPageSize = 10;
let lastActiveKpiCard = null;

function openMovementCategoryModal(type) {
  categoryModalType = type || 'total';
  lastActiveKpiCard = document.activeElement;

  const modalEl = document.getElementById('movementCategoryModal');
  if (!modalEl) return;

  // Filter records based on category
  categoryModalRows = stockMovementsCache.map(function (item, originalIndex) {
    return Object.assign({}, item, { originalIndex: originalIndex });
  }).filter(function (r) {
    const mt = String(r.movement_type || '').toLowerCase();
    if (categoryModalType === 'receiving') return mt.includes('receiving');
    if (categoryModalType === 'releasing') return mt.includes('releasing');
    if (categoryModalType === 'store_return') return mt.includes('store return') || mt.includes('stocks return');
    if (categoryModalType === 'purchase_return') return mt.includes('purchase return');
    if (categoryModalType === 'adjustment') return mt.includes('adjustment');
    return true; // 'total'
  });

  // Config titles, icons, columns
  const titleEl = document.getElementById('movementCategoryModalLabel');
  const subEl = document.getElementById('categoryModalSubtitle');
  const iconEl = document.getElementById('categoryModalIcon');
  const iconBox = document.getElementById('categoryModalIconBox');
  const searchInput = document.getElementById('categoryModalSearchInput');
  const thead = document.getElementById('categoryModalTableHead');

  const configs = {
    total: {
      title: 'Total Movements',
      subtitle: 'Complete chronological warehouse movement ledger',
      icon: 'bi-arrow-left-right',
      iconBoxClass: 'bg-secondary-subtle text-secondary',
      searchPlaceholder: 'Search reference no., product, or performed by...',
      thead: '<tr><th style="min-width:110px;">Date</th><th style="min-width:150px;">Movement Type</th><th style="min-width:130px;">Reference No.</th><th style="min-width:200px;">Product</th><th class="text-center" style="min-width:100px;">Qty</th><th style="min-width:150px;">Performed By</th><th class="text-center" style="width:70px;">Action</th></tr>'
    },
    receiving: {
      title: 'Stock Received (+In)',
      subtitle: 'Inventory inflows from approved purchase orders and suppliers',
      icon: 'bi-box-arrow-in-down',
      iconBoxClass: 'bg-success-subtle text-success',
      searchPlaceholder: 'Search reference no., product, or supplier...',
      thead: '<tr><th style="min-width:110px;">Date</th><th style="min-width:130px;">Reference No.</th><th style="min-width:220px;">Product</th><th class="text-center" style="min-width:100px;">Qty</th><th style="min-width:180px;">Supplier</th><th class="text-center" style="width:70px;">Action</th></tr>'
    },
    releasing: {
      title: 'Stock Released (-Out)',
      subtitle: 'Inventory outflows dispatched to branches and stores',
      icon: 'bi-box-arrow-up',
      iconBoxClass: 'bg-danger-subtle text-danger',
      searchPlaceholder: 'Search reference no., product, or destination...',
      thead: '<tr><th style="min-width:110px;">Date</th><th style="min-width:130px;">Reference No.</th><th style="min-width:220px;">Product</th><th class="text-center" style="min-width:100px;">Qty</th><th style="min-width:180px;">Destination (Store)</th><th class="text-center" style="width:70px;">Action</th></tr>'
    },
    store_return: {
      title: 'Store Returns (+In)',
      subtitle: 'Inventory returned from branches and retail stores',
      icon: 'bi-arrow-counterclockwise',
      iconBoxClass: 'bg-info-subtle text-info',
      searchPlaceholder: 'Search reference no., product, or store...',
      thead: '<tr><th style="min-width:110px;">Date</th><th style="min-width:130px;">Reference No.</th><th style="min-width:220px;">Product</th><th class="text-center" style="min-width:100px;">Qty</th><th style="min-width:180px;">Store</th><th class="text-center" style="width:70px;">Action</th></tr>'
    },
    purchase_return: {
      title: 'Purchase Returns (-Out)',
      subtitle: 'Defective or damaged items returned to suppliers',
      icon: 'bi-arrow-return-left',
      iconBoxClass: 'bg-warning-subtle text-warning-emphasis',
      searchPlaceholder: 'Search reference no., product, or supplier...',
      thead: '<tr><th style="min-width:110px;">Date</th><th style="min-width:130px;">Reference No.</th><th style="min-width:220px;">Product</th><th class="text-center" style="min-width:100px;">Qty</th><th style="min-width:180px;">Supplier</th><th class="text-center" style="width:70px;">Action</th></tr>'
    },
    adjustment: {
      title: 'Adjustments (+/-)',
      subtitle: 'Physical count reconciliations, additions, and write-offs',
      icon: 'bi-sliders',
      iconBoxClass: 'bg-primary-subtle text-primary',
      searchPlaceholder: 'Search reference no., product, or reason...',
      thead: '<tr><th style="min-width:110px;">Date</th><th style="min-width:130px;">Reference No.</th><th style="min-width:220px;">Product</th><th class="text-center" style="min-width:100px;">Qty</th><th style="min-width:180px;">Reason</th><th class="text-center" style="width:70px;">Action</th></tr>'
    }
  };

  const cfg = configs[categoryModalType] || configs.total;
  if (titleEl) titleEl.textContent = cfg.title;
  if (subEl) subEl.textContent = cfg.subtitle;
  if (iconEl) iconEl.className = 'bi ' + cfg.icon + ' fs-5';
  if (iconBox) iconBox.className = 'gw-avatar-circle rounded-2 p-2 d-flex align-items-center justify-content-center ' + cfg.iconBoxClass;
  if (searchInput) {
    searchInput.placeholder = cfg.searchPlaceholder;
    searchInput.value = '';
  }
  if (thead) thead.innerHTML = cfg.thead;

  categoryModalCurrentPage = 1;
  categoryModalFilteredRows = categoryModalRows.slice();
  renderCategoryModalPage();

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();

  // Return focus to triggering card upon dismissal
  const onModalHidden = function () {
    if (lastActiveKpiCard && typeof lastActiveKpiCard.focus === 'function') {
      try { lastActiveKpiCard.focus(); } catch (e) {}
    }
    modalEl.removeEventListener('hidden.bs.modal', onModalHidden);
  };
  modalEl.addEventListener('hidden.bs.modal', onModalHidden);
}

function handleCategoryModalSearch() {
  const query = (document.getElementById('categoryModalSearchInput')?.value || '').trim().toLowerCase();
  if (!query) {
    categoryModalFilteredRows = categoryModalRows.slice();
  } else {
    categoryModalFilteredRows = categoryModalRows.filter(function (r) {
      const ref = String(r.ref_code || r.ref_no || '').toLowerCase();
      const prod = String(r.product_name || '').toLowerCase();
      const by = String(r.performed_by || '').toLowerCase();
      const party = String(r.party || '').toLowerCase();
      const notes = String(r.notes || '').toLowerCase();
      const type = String(r.movement_type || '').toLowerCase();
      return ref.includes(query) || prod.includes(query) || by.includes(query) || party.includes(query) || notes.includes(query) || type.includes(query);
    });
  }
  categoryModalCurrentPage = 1;
  renderCategoryModalPage();
}

function handleCategoryModalPageSizeChange(val) {
  categoryModalPageSize = parseInt(val) || 10;
  categoryModalCurrentPage = 1;
  renderCategoryModalPage();
}

function goToCategoryModalPage(p) {
  const totalPages = Math.ceil(categoryModalFilteredRows.length / categoryModalPageSize) || 1;
  if (p < 1) p = 1;
  if (p > totalPages) p = totalPages;
  categoryModalCurrentPage = p;
  renderCategoryModalPage();
}

function renderCategoryModalPage() {
  const tbody = document.getElementById('categoryModalTableBody');
  const paginationInfo = document.getElementById('categoryModalPaginationInfo');
  const paginationNav = document.getElementById('categoryModalPaginationNav');

  if (!tbody) return;

  const total = categoryModalFilteredRows.length;
  const totalPages = Math.ceil(total / categoryModalPageSize) || 1;

  if (categoryModalCurrentPage > totalPages) categoryModalCurrentPage = totalPages;
  if (categoryModalCurrentPage < 1) categoryModalCurrentPage = 1;

  const startIdx = (categoryModalCurrentPage - 1) * categoryModalPageSize;
  const endIdx = Math.min(startIdx + categoryModalPageSize, total);
  const pageRows = categoryModalFilteredRows.slice(startIdx, endIdx);

  if (paginationInfo) {
    if (total === 0) {
      paginationInfo.textContent = 'Showing 0 to 0 of 0 records';
    } else {
      paginationInfo.textContent = 'Showing ' + (startIdx + 1) + ' to ' + endIdx + ' of ' + total.toLocaleString() + ' records';
    }
  }

  if (pageRows.length === 0) {
    const colCount = categoryModalType === 'total' ? 7 : 6;
    tbody.innerHTML = '<tr><td colspan="' + colCount + '" class="text-center text-muted py-5 fst-italic">No records found matching your query.</td></tr>';
  } else {
    tbody.innerHTML = pageRows.map(function (r) {
      const dateFormatted = formatMovementDate(r.movement_date);
      const refCode = r.ref_code || r.ref_no || '—';
      const qBadge = getQtyChangeBadge(r);
      const origIdx = r.originalIndex;

      let colsHtml = '';
      if (categoryModalType === 'total') {
        colsHtml =
          '<td class="small text-muted text-nowrap">' + escapeHtml(dateFormatted) + '</td>' +
          '<td>' + getMovementTypeBadge(r.movement_type) + '</td>' +
          '<td class="font-monospace fw-bold text-dark text-nowrap">' + escapeHtml(refCode) + '</td>' +
          '<td class="fw-semibold text-dark">' + escapeHtml(r.product_name || '—') + '</td>' +
          '<td class="text-center">' + qBadge + '</td>' +
          '<td class="small text-nowrap">' + escapeHtml(r.performed_by || 'Warehouse Officer') + '</td>';
      } else if (categoryModalType === 'receiving' || categoryModalType === 'purchase_return') {
        colsHtml =
          '<td class="small text-muted text-nowrap">' + escapeHtml(dateFormatted) + '</td>' +
          '<td class="font-monospace fw-bold text-dark text-nowrap">' + escapeHtml(refCode) + '</td>' +
          '<td class="fw-semibold text-dark">' + escapeHtml(r.product_name || '—') + '</td>' +
          '<td class="text-center">' + qBadge + '</td>' +
          '<td class="small text-muted text-truncate" style="max-width:200px;" title="' + escapeHtml(r.party || '—') + '">' + escapeHtml(r.party || '—') + '</td>';
      } else if (categoryModalType === 'releasing') {
        colsHtml =
          '<td class="small text-muted text-nowrap">' + escapeHtml(dateFormatted) + '</td>' +
          '<td class="font-monospace fw-bold text-dark text-nowrap">' + escapeHtml(refCode) + '</td>' +
          '<td class="fw-semibold text-dark">' + escapeHtml(r.product_name || '—') + '</td>' +
          '<td class="text-center">' + qBadge + '</td>' +
          '<td class="small text-muted text-truncate" style="max-width:200px;" title="' + escapeHtml(r.party || 'Main Store') + '">' + escapeHtml(r.party || 'Main Store') + '</td>';
      } else if (categoryModalType === 'store_return') {
        colsHtml =
          '<td class="small text-muted text-nowrap">' + escapeHtml(dateFormatted) + '</td>' +
          '<td class="font-monospace fw-bold text-dark text-nowrap">' + escapeHtml(refCode) + '</td>' +
          '<td class="fw-semibold text-dark">' + escapeHtml(r.product_name || '—') + '</td>' +
          '<td class="text-center">' + qBadge + '</td>' +
          '<td class="small text-muted text-truncate" style="max-width:200px;" title="' + escapeHtml(r.party || 'Branch Store') + '">' + escapeHtml(r.party || 'Branch Store') + '</td>';
      } else if (categoryModalType === 'adjustment') {
        colsHtml =
          '<td class="small text-muted text-nowrap">' + escapeHtml(dateFormatted) + '</td>' +
          '<td class="font-monospace fw-bold text-dark text-nowrap">' + escapeHtml(refCode) + '</td>' +
          '<td class="fw-semibold text-dark">' + escapeHtml(r.product_name || '—') + '</td>' +
          '<td class="text-center">' + qBadge + '</td>' +
          '<td class="small text-muted text-truncate" style="max-width:200px;" title="' + escapeHtml(r.notes || r.party || 'Adjustment') + '">' + escapeHtml(r.notes || r.party || 'Adjustment') + '</td>';
      }

      return (
        '<tr>' +
          colsHtml +
          '<td class="text-center">' +
            '<button type="button" class="btn btn-sm btn-outline-secondary rounded-2 py-1 px-2 shadow-none" onclick="openCategoryModalMovementDetails(' + origIdx + ')" title="View Details">' +
              '<i class="bi bi-eye"></i>' +
            '</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  // Render pagination
  if (paginationNav) {
    if (totalPages <= 1) {
      paginationNav.innerHTML = '';
      return;
    }

    let navHtml = '';
    navHtml +=
      '<li class="page-item ' + (categoryModalCurrentPage === 1 ? 'disabled' : '') + '">' +
        '<button class="page-link" onclick="goToCategoryModalPage(' + (categoryModalCurrentPage - 1) + ')" aria-label="Previous">&laquo; Prev</button>' +
      '</li>';

    let startPage = Math.max(1, categoryModalCurrentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    if (startPage > 1) {
      navHtml += '<li class="page-item"><button class="page-link" onclick="goToCategoryModalPage(1)">1</button></li>';
      if (startPage > 2) navHtml += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
    }

    for (let p = startPage; p <= endPage; p++) {
      navHtml +=
        '<li class="page-item ' + (p === categoryModalCurrentPage ? 'active' : '') + '">' +
          '<button class="page-link" onclick="goToCategoryModalPage(' + p + ')">' + p + '</button>' +
        '</li>';
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) navHtml += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
      navHtml += '<li class="page-item"><button class="page-link" onclick="goToCategoryModalPage(' + totalPages + ')">' + totalPages + '</button></li>';
    }

    navHtml +=
      '<li class="page-item ' + (categoryModalCurrentPage === totalPages ? 'disabled' : '') + '">' +
        '<button class="page-link" onclick="goToCategoryModalPage(' + (categoryModalCurrentPage + 1) + ')" aria-label="Next">Next &raquo;</button>' +
      '</li>';

    paginationNav.innerHTML = navHtml;
  }
}

function openCategoryModalMovementDetails(origIdx) {
  openStockMovementDetails(origIdx);
}

function exportCategoryModalMovements() {
  const rows = categoryModalFilteredRows;
  if (!rows || rows.length === 0) {
    showToast('No records available to export', true);
    return;
  }

  const headers = ['Date', 'Reference No.', 'Movement Type', 'Product', 'Quantity Change', 'Unit', 'Performed By', 'Party / Store', 'Notes'];
  const csvRows = [headers.map(function (h) { return '"' + h.replace(/"/g, '""') + '"'; }).join(',')];
  rows.forEach(function (r) {
    const isQuarantined = String(r.direction || '').toUpperCase() === 'QUARANTINED';
    const rawQ = r.qty_change !== undefined ? r.qty_change : (r.direction === 'OUT' ? -r.quantity : r.quantity);
    const q = isQuarantined ? 0 : (parseInt(rawQ) || 0);
    const qStr = q >= 0 ? '+' + q : String(q);
    const row = [
      r.movement_date || '',
      r.ref_code || r.ref_no || '',
      r.movement_type || '',
      r.product_name || '',
      qStr,
      r.unit_measure || '',
      r.performed_by || '',
      r.party || '',
      r.notes || ''
    ];
    csvRows.push(row.map(function (val) { return '"' + String(val).replace(/"/g, '""') + '"'; }).join(','));
  });

  const csvContent = csvRows.join('\r\n');
  const now = new Date().toISOString().slice(0, 10);
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const fileName = categoryModalType + '_movements_' + now + '.csv';

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);

  showToast('Exported ' + rows.length + ' records');
}

function applyStockMovementFilters() {
  const sInput = document.getElementById('stockMovementSearchInput');
  const typeSel = document.getElementById('movementTypeFilter');
  const searchVal = (sInput ? sInput.value : '').trim().toLowerCase();
  const typeVal = (typeSel ? typeSel.value : '').trim().toLowerCase();

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  let rows = stockMovementsCache.slice();

  // 1. Filter by Search Query
  if (searchVal) {
    rows = rows.filter(function (r) {
      const ref = String(r.ref_code || r.ref_no || '').toLowerCase();
      const prod = String(r.product_name || '').toLowerCase();
      const by = String(r.performed_by || '').toLowerCase();
      const party = String(r.party || '').toLowerCase();
      const notes = String(r.notes || '').toLowerCase();
      return ref.includes(searchVal) || prod.includes(searchVal) || by.includes(searchVal) || party.includes(searchVal) || notes.includes(searchVal);
    });
  }

  // 2. Filter by Movement Type
  if (typeVal) {
    rows = rows.filter(function (r) {
      const mt = String(r.movement_type || '').toLowerCase();
      if (typeVal === 'receiving') return mt.includes('receiving');
      if (typeVal === 'store return' || typeVal === 'stocks return') return mt.includes('stocks return') || mt.includes('store return');
      if (typeVal === 'releasing') return mt.includes('releasing');
      if (typeVal === 'purchase return') return mt.includes('purchase return');
      if (typeVal === 'adjustment') return mt.includes('adjustment');
      return mt.includes(typeVal);
    });
  }

  // 3. Filter by Date
  if (movementDateFilter.preset !== 'all') {
    const p = movementDateFilter.preset;
    rows = rows.filter(function (r) {
      const rowDate = (r.movement_date || '').slice(0, 10);
      if (!rowDate) return true;

      if (p === 'today') {
        return rowDate === todayStr;
      }
      if (p === '7days') {
        const d = new Date(rowDate);
        const diffDays = (now - d) / (1000 * 60 * 60 * 24);
        return diffDays >= 0 && diffDays <= 7;
      }
      if (p === '30days') {
        const d = new Date(rowDate);
        const diffDays = (now - d) / (1000 * 60 * 60 * 24);
        return diffDays >= 0 && diffDays <= 30;
      }
      if (p === 'this_month') {
        const curYm = now.toISOString().slice(0, 7);
        return rowDate.startsWith(curYm);
      }
      if (p === 'custom') {
        if (movementDateFilter.start && rowDate < movementDateFilter.start) return false;
        if (movementDateFilter.end && rowDate > movementDateFilter.end) return false;
        return true;
      }
      return true;
    });
  }

  currentFilteredMovements = rows;
  renderStockMovementsPage();
}

function handleMovementPageSizeChange(val) {
  movementPageSize = parseInt(val) || 10;
  movementCurrentPage = 1;
  renderStockMovementsPage();
}

function goToMovementPage(p) {
  const totalPages = Math.ceil(currentFilteredMovements.length / movementPageSize) || 1;
  if (p < 1) p = 1;
  if (p > totalPages) p = totalPages;
  movementCurrentPage = p;
  renderStockMovementsPage();
}

function renderStockMovementsPage() {
  const body = document.getElementById('stockMovementTable');
  const mobileList = document.getElementById('stockMovementMobileList');
  const paginationInfo = document.getElementById('movementPaginationInfo');
  const paginationNav = document.getElementById('movementPaginationNav');

  if (!body && !mobileList) return;

  const total = currentFilteredMovements.length;
  const totalPages = Math.ceil(total / movementPageSize) || 1;

  if (movementCurrentPage > totalPages) movementCurrentPage = totalPages;
  if (movementCurrentPage < 1) movementCurrentPage = 1;

  const startIdx = (movementCurrentPage - 1) * movementPageSize;
  const endIdx = Math.min(startIdx + movementPageSize, total);
  const pageRows = currentFilteredMovements.slice(startIdx, endIdx);

  // Pagination info text
  if (paginationInfo) {
    if (total === 0) {
      paginationInfo.textContent = 'Showing 0 to 0 of 0 records';
    } else {
      paginationInfo.textContent = 'Showing ' + (startIdx + 1) + ' to ' + endIdx + ' of ' + total.toLocaleString() + ' records';
    }
  }

  // Render Table
  if (body) {
    if (pageRows.length === 0) {
      body.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-5 fst-italic">No stock movement records match the selected filters.</td></tr>';
    } else {
      body.innerHTML = pageRows.map(function (r, i) {
        const globalIdx = startIdx + i;
        const refCode = r.ref_code || r.ref_no || '—';
        const partyText = r.party || '—';
        const dateFormatted = formatMovementDate(r.movement_date);
        const typeBadge = getMovementTypeBadge(r.movement_type);
        const qBadge = getQtyChangeBadge(r);

        return (
          '<tr>' +
            '<td class="small text-muted text-nowrap">' + escapeHtml(dateFormatted) + '</td>' +
            '<td>' + typeBadge + '</td>' +
            '<td class="font-monospace fw-bold text-dark text-nowrap">' + escapeHtml(refCode) + '</td>' +
            '<td class="fw-semibold text-dark">' + escapeHtml(r.product_name || '—') + '</td>' +
            '<td class="text-center">' + qBadge + '</td>' +
            '<td class="small text-nowrap">' + escapeHtml(r.performed_by || 'Warehouse Officer') + '</td>' +
            '<td class="small text-muted text-truncate" style="max-width: 180px;" title="' + escapeHtml(partyText) + '">' + escapeHtml(partyText) + '</td>' +
            '<td class="text-center">' +
              '<button type="button" class="btn btn-sm btn-outline-secondary rounded-2 py-1 px-2 shadow-none" onclick="openStockMovementDetails(' + globalIdx + ')" title="View Details">' +
                '<i class="bi bi-eye"></i>' +
              '</button>' +
            '</td>' +
          '</tr>'
        );
      }).join('');
    }
  }

  // Render Mobile Cards
  if (mobileList) {
    if (pageRows.length === 0) {
      mobileList.innerHTML = '<div class="text-center text-muted p-4 fst-italic">No stock movement records found.</div>';
    } else {
      mobileList.innerHTML = pageRows.map(function (r, i) {
        const globalIdx = startIdx + i;
        const refCode = r.ref_code || r.ref_no || '—';
        const typeBadge = getMovementTypeBadge(r.movement_type);
        const qBadge = getQtyChangeBadge(r);
        const partyText = r.party || '—';

        return (
          '<div class="gw-mobile-card-item border rounded-2 p-3 mb-2 bg-white">' +
            '<div class="d-flex justify-content-between align-items-start gap-2 mb-2">' +
              '<div>' +
                '<strong class="text-dark d-block">' + escapeHtml(r.product_name || 'Item') + '</strong>' +
                '<div class="mt-1">' + typeBadge + '</div>' +
              '</div>' +
              '<div>' + qBadge + '</div>' +
            '</div>' +
            '<div class="d-flex justify-content-between align-items-center small text-muted mb-2">' +
              '<span class="font-monospace fw-bold text-dark">' + escapeHtml(refCode) + '</span>' +
              '<span>' + escapeHtml(formatMovementDate(r.movement_date)) + '</span>' +
            '</div>' +
            '<div class="small text-muted border-top pt-2 d-flex justify-content-between align-items-center">' +
              '<div>' +
                '<div><i class="bi bi-person me-1"></i>' + escapeHtml(r.performed_by || 'Warehouse Officer') + '</div>' +
                '<div class="mt-1"><i class="bi bi-building me-1"></i>' + escapeHtml(partyText) + '</div>' +
              '</div>' +
              '<button type="button" class="btn btn-sm btn-outline-secondary rounded-2 py-1 px-2" onclick="openStockMovementDetails(' + globalIdx + ')">' +
                '<i class="bi bi-eye me-1"></i>Details' +
              '</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }
  }

  // Render Pagination Buttons
  if (paginationNav) {
    if (totalPages <= 1) {
      paginationNav.innerHTML = '';
      return;
    }

    let navHtml = '';

    // Previous Button
    navHtml +=
      '<li class="page-item ' + (movementCurrentPage === 1 ? 'disabled' : '') + '">' +
        '<button class="page-link" onclick="goToMovementPage(' + (movementCurrentPage - 1) + ')" aria-label="Previous">&laquo; Prev</button>' +
      '</li>';

    // Page numbers
    let startPage = Math.max(1, movementCurrentPage - 2);
    let endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) {
      startPage = Math.max(1, endPage - 4);
    }

    if (startPage > 1) {
      navHtml += '<li class="page-item"><button class="page-link" onclick="goToMovementPage(1)">1</button></li>';
      if (startPage > 2) navHtml += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
    }

    for (let p = startPage; p <= endPage; p++) {
      navHtml +=
        '<li class="page-item ' + (p === movementCurrentPage ? 'active' : '') + '">' +
          '<button class="page-link" onclick="goToMovementPage(' + p + ')">' + p + '</button>' +
        '</li>';
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) navHtml += '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
      navHtml += '<li class="page-item"><button class="page-link" onclick="goToMovementPage(' + totalPages + ')">' + totalPages + '</button></li>';
    }

    // Next Button
    navHtml +=
      '<li class="page-item ' + (movementCurrentPage === totalPages ? 'disabled' : '') + '">' +
        '<button class="page-link" onclick="goToMovementPage(' + (movementCurrentPage + 1) + ')" aria-label="Next">Next &raquo;</button>' +
      '</li>';

    paginationNav.innerHTML = navHtml;
  }
}

function openStockMovementDetails(idx) {
  const row = currentFilteredMovements[idx];
  if (!row) return;

  const modalEl = document.getElementById('movementDetailsModal');
  if (!modalEl) return;

  const refNo = row.ref_code || row.ref_no || '—';
  const rawQ = row.qty_change !== undefined ? row.qty_change : (row.direction === 'OUT' ? -row.quantity : row.quantity);
  const q = parseInt(rawQ) || 0;
  const isQuarantined = String(row.direction || '').toUpperCase() === 'QUARANTINED';

  document.getElementById('modalRefNo').textContent = refNo;
  document.getElementById('modalMovementTypeBadge').innerHTML = getMovementTypeBadge(row.movement_type);
  document.getElementById('modalDate').textContent = formatMovementDateTime(row.sort_ts || row.movement_date);
  document.getElementById('modalProductName').textContent = row.product_name || '—';
  document.getElementById('modalProductUnit').textContent = row.unit_measure ? 'Unit of Measure: ' + row.unit_measure : '';

  // Quantity Change Badge
  let qtyHtml = '';
  if (isQuarantined) {
    qtyHtml = '<span class="badge rounded-pill bg-warning-subtle text-warning-emphasis border border-warning-subtle font-monospace px-3 py-2 fs-6">0 (' + escapeHtml(String(row.quantity || 0)) + ' Quarantined)</span>';
  } else if (q > 0) {
    qtyHtml = '<span class="badge rounded-pill bg-success-subtle text-success border border-success-subtle font-monospace px-3 py-2 fs-6">+' + q.toLocaleString() + ' ' + escapeHtml(row.unit_measure || 'Units') + '</span>';
  } else if (q < 0) {
    qtyHtml = '<span class="badge rounded-pill bg-danger-subtle text-danger border border-danger-subtle font-monospace px-3 py-2 fs-6">' + q.toLocaleString() + ' ' + escapeHtml(row.unit_measure || 'Units') + '</span>';
  } else {
    qtyHtml = '<span class="badge rounded-pill bg-secondary-subtle text-secondary border border-secondary-subtle font-monospace px-3 py-2 fs-6">0 ' + escapeHtml(row.unit_measure || 'Units') + '</span>';
  }
  document.getElementById('modalQtyChangeBadge').innerHTML = qtyHtml;

  document.getElementById('modalPerformedBy').textContent = row.performed_by || 'Warehouse Officer';
  document.getElementById('modalParty').textContent = row.party || '—';

  // Direction badge
  let dirHtml = '';
  if (row.direction === 'IN') {
    dirHtml = '<span class="badge bg-success-subtle text-success border border-success-subtle px-2 py-1"><i class="bi bi-arrow-down-left me-1"></i>Warehouse Inflow (+IN)</span>';
  } else if (row.direction === 'OUT') {
    dirHtml = '<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1"><i class="bi bi-arrow-up-right me-1"></i>Warehouse Outflow (-OUT)</span>';
  } else {
    dirHtml = '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle px-2 py-1"><i class="bi bi-shield-exclamation me-1"></i>Quarantined Stock</span>';
  }
  document.getElementById('modalDirectionBadge').innerHTML = dirHtml;

  // Inventory impact
  const impactEl = document.getElementById('modalInventoryImpact');
  if (impactEl) {
    if (row.direction === 'IN') {
      impactEl.innerHTML = '<span class="text-success"><i class="bi bi-plus-circle me-1"></i>Increased available warehouse inventory</span>';
    } else if (row.direction === 'OUT') {
      impactEl.innerHTML = '<span class="text-danger"><i class="bi bi-dash-circle me-1"></i>Decreased available warehouse inventory</span>';
    } else {
      impactEl.innerHTML = '<span class="text-warning-emphasis"><i class="bi bi-exclamation-triangle me-1"></i>Isolated from available inventory balance</span>';
    }
  }

  document.getElementById('modalNotes').textContent = row.notes || row.party || 'No additional remarks recorded for this transaction.';

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

function exportStockMovements(format) {
  const rows = currentFilteredMovements && currentFilteredMovements.length > 0 ? currentFilteredMovements : stockMovementsCache;
  if (!rows || rows.length === 0) {
    showToast('No stock movements available to export', true);
    return;
  }

  const headers = ['Date', 'Movement Type', 'Reference No.', 'Product', 'Quantity Change', 'Unit', 'Performed By', 'Party / Store', 'Notes'];

  const csvRows = [headers.map(function (h) { return '"' + h.replace(/"/g, '""') + '"'; }).join(',')];
  rows.forEach(function (r) {
    const isQuarantined = String(r.direction || '').toUpperCase() === 'QUARANTINED';
    const rawQ = r.qty_change !== undefined ? r.qty_change : (r.direction === 'OUT' ? -r.quantity : r.quantity);
    const q = isQuarantined ? 0 : (parseInt(rawQ) || 0);
    const qStr = q >= 0 ? '+' + q : String(q);
    const row = [
      r.movement_date || '',
      r.movement_type || '',
      r.ref_code || r.ref_no || '',
      r.product_name || '',
      qStr,
      r.unit_measure || '',
      r.performed_by || '',
      r.party || '',
      r.notes || ''
    ];
    csvRows.push(row.map(function (val) { return '"' + String(val).replace(/"/g, '""') + '"'; }).join(','));
  });

  const csvContent = csvRows.join('\r\n');
  const now = new Date().toISOString().slice(0, 10);
  const ext = format === 'excel' ? 'xls' : 'csv';
  const mimeType = format === 'excel' ? 'application/vnd.ms-excel;charset=utf-8;' : 'text/csv;charset=utf-8;';
  const blob = new Blob(['\uFEFF' + csvContent], { type: mimeType });
  const fileName = 'stock_movement_history_' + now + '.' + ext;

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);

  showToast('Stock movements exported as ' + ext.toUpperCase());
}
