/**
 * GymWorx Warehouse Management System - Purchase Order (PO) Module
 * Redesigned for Purchasing Officer Dashboard & Operational Fulfillment
 */

// Global state & caches
var poDashboardData = null;
var poAllPosCache = [];
var poProductsCache = [];
var poCategoriesCache = [];
var poSuppliersCache = [];
var poApprovedPrsCache = [];
var poSelectedPrDetail = null;
var poActiveDateRange = 'all';
var poCurrentDetailPo = null;

// Create PO 3-Step Wizard State
var poWizardState = {
  step: 1,
  mode: 'Independent', // 'Independent' or 'PR-Linked'
  prId: null,
  supplierId: null,
  orderDate: '',
  expectedDate: '',
  notes: '',
  lines: [] // array of { product_id, product_name, category_name, unit_measure, available_stock, reorder_level, max_stock, quantity, unit_cost, preferred_supplier_id, preferred_supplier_name }
};

// Utilities
function showAlert(type, msg) {
  var isError = (type === 'danger' || type === 'error' || type === 'warning');
  if (typeof showToast === 'function') {
    showToast(msg, isError);
  } else if (typeof alert === 'function') {
    alert(msg);
  }
}

function todayStr() {
  var d = new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function formatMoney(val) {
  var num = parseFloat(val);
  if (isNaN(num)) num = 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateDisplay(dStr) {
  if (!dStr) return '—';
  try {
    var d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  } catch (e) {
    return dStr;
  }
}

function formatDateTimeDisplay(dtStr) {
  if (!dtStr) return '—';
  try {
    var d = new Date(dtStr);
    if (isNaN(d.getTime())) return dtStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) + ' ' +
           d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return dtStr;
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getProductIconClass(categoryName) {
  var cat = String(categoryName || '').toLowerCase();
  if (cat.indexOf('cardio') !== -1 || cat.indexOf('treadmill') !== -1) return 'bi-activity';
  if (cat.indexOf('strength') !== -1 || cat.indexOf('machine') !== -1) return 'bi-diagram-3';
  if (cat.indexOf('weight') !== -1 || cat.indexOf('dumbbell') !== -1 || cat.indexOf('plate') !== -1) return 'bi-box-seam';
  if (cat.indexOf('supplement') !== -1 || cat.indexOf('protein') !== -1 || cat.indexOf('nutrition') !== -1) return 'bi-capsule';
  if (cat.indexOf('accessory') !== -1) return 'bi-bandaid';
  return 'bi-box';
}

function poStatusBadgeHtml(status) {
  var s = String(status || '').trim();
  if (s === 'Pending Approval' || s === 'Pending PO Approval' || s === 'Pending') {
    return '<span class="badge rounded-pill bg-warning-subtle text-warning-emphasis border border-warning-subtle px-2 py-1"><i class="bi bi-hourglass-split me-1"></i>Pending</span>';
  }
  if (s === 'Ordered' || s === 'Issued') {
    return '<span class="badge rounded-pill bg-success-subtle text-success-emphasis border border-success-subtle px-2 py-1"><i class="bi bi-check-circle me-1"></i>Approved</span>';
  }
  if (s === 'In Transit') {
    return '<span class="badge rounded-pill bg-primary-subtle text-primary border border-primary-subtle px-2 py-1"><i class="bi bi-truck me-1"></i>In Transit</span>';
  }
  if (s === 'Partially Received') {
    return '<span class="badge rounded-pill bg-info-subtle text-info-emphasis border border-info-subtle px-2 py-1"><i class="bi bi-box-seam me-1"></i>Partially Received</span>';
  }
  if (s === 'Received' || s === 'Fully Received' || s === 'Completed') {
    return '<span class="badge rounded-pill bg-purple-subtle text-purple border px-2 py-1" style="background-color: #ede9fe; color: #7c3aed; border-color: #ddd6fe;"><i class="bi bi-check2-all me-1"></i>Completed</span>';
  }
  if (s === 'Cancelled') {
    return '<span class="badge rounded-pill bg-danger-subtle text-danger border border-danger-subtle px-2 py-1"><i class="bi bi-x-circle me-1"></i>Cancelled</span>';
  }
  return '<span class="badge rounded-pill bg-light text-secondary border px-2 py-1">' + escapeHtml(s) + '</span>';
}

function initPoTooltips() {
  if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"], .po-toolbar-btn, .po-btn-icon, .po-modal-action-btn'));
    tooltipTriggerList.forEach(function (el) {
      if (!bootstrap.Tooltip.getInstance(el)) {
        new bootstrap.Tooltip(el, { trigger: 'hover' });
      }
    });
  }
}

// =========================================================================
// MAIN ENTRY: LOAD PURCHASING DASHBOARD & PURCHASE ORDERS
// =========================================================================
async function loadPurchaseOrders(statusFilter) {
  try {
    // Show spinner if refreshing
    var refreshBtn = document.getElementById('btnRefreshPo');
    if (refreshBtn) refreshBtn.classList.add('disabled');

    // 1. Fetch Dashboard data (contains KPIs, replenishment candidates, recent activity, open POs)
    var dashRes = await axios.get(API + 'dashboard.php?profile=purchasing');
    if (dashRes.data && dashRes.data.success && dashRes.data.data) {
      poDashboardData = dashRes.data.data;
    }

    // 2. Fetch full purchase orders list
    var poRes = await axios.get(API + 'purchase_order.php?mode=all');
    if (poRes.data && poRes.data.success && poRes.data.data) {
      poAllPosCache = poRes.data.data;
    }

    // 3. Fetch products catalog with metrics (for replenishment & wizard)
    var prodRes = await axios.get(API + 'product.php?mode=all');
    if (prodRes.data && prodRes.data.success && prodRes.data.data) {
      poProductsCache = prodRes.data.data;
    }

    // 4. Fetch suppliers
    var suppRes = await axios.get(API + 'supplier.php');
    if (suppRes.data && suppRes.data.success && suppRes.data.data) {
      poSuppliersCache = suppRes.data.data;
      populateSupplierDropdowns();
    }

    // 5. Fetch approved purchase requests queue
    try {
      var prRes = await axios.get(API + 'purchase_request.php?mode=approved_queue');
      if (prRes.data && prRes.data.success && prRes.data.data) {
        poApprovedPrsCache = prRes.data.data;
      }
    } catch (e) {
      if (poDashboardData && poDashboardData.approved_requests) {
        poApprovedPrsCache = poDashboardData.approved_requests;
      }
    }

    // Render all dashboard sections
    renderPoKpiCards();
    renderPoReplenishmentMiniTable();
    renderPoDonutChart();
    renderPoRecentActivityTimeline();
    renderPoPendingTable();
    renderPoDeliveriesTable();

    initPoTooltips();
  } catch (err) {
    console.error('Error loading purchase orders data:', err);
    showAlert('danger', 'Failed to load purchase order records. Please try again.');
  } finally {
    var refreshBtn = document.getElementById('btnRefreshPo');
    if (refreshBtn) refreshBtn.classList.remove('disabled');
  }
}

function reloadPoModuleData() {
  loadPurchaseOrders();
}

function setPoDateRangeFilter(rangeKey, labelText) {
  poActiveDateRange = rangeKey;
  var lbl = document.getElementById('poDateRangeLabel');
  if (lbl) lbl.textContent = labelText;

  var dropdownMenu = lbl ? lbl.closest('.dropdown') : null;
  if (dropdownMenu) {
    var items = dropdownMenu.querySelectorAll('.dropdown-item');
    items.forEach(function (el) {
      if (el.textContent.trim() === labelText) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });
  }

  // Re-filter KPI cards, donut chart, and tables based on date range
  renderPoKpiCards();
  renderPoDonutChart();
  renderPoPendingTable();
  renderPoDeliveriesTable();
}

// =========================================================================
// REPLENISHMENT CANDIDATES RESOLUTION HELPER
// =========================================================================
function getPoReplenishmentItems() {
  if (poDashboardData && Array.isArray(poDashboardData.items_to_reorder) && poDashboardData.items_to_reorder.length > 0) {
    return poDashboardData.items_to_reorder;
  }
  if (poProductsCache && poProductsCache.length > 0) {
    var candidates = poProductsCache.filter(function (p) {
      if (!p || (p.is_active !== undefined && !Number(p.is_active))) return false;
      var avail = parseInt(p.available_stock !== undefined ? p.available_stock : (p.usable_stock || 0), 10);
      var reorder = parseInt(p.reorder_level !== undefined ? p.reorder_level : (p.reorder_threshold || 10), 10);
      return avail <= 0 || (avail > 0 && avail <= reorder);
    });
    candidates.sort(function (a, b) {
      var aAvail = parseInt(a.available_stock !== undefined ? a.available_stock : (a.usable_stock || 0), 10);
      var bAvail = parseInt(b.available_stock !== undefined ? b.available_stock : (b.usable_stock || 0), 10);
      if (aAvail === bAvail) {
        return (a.product_name || '').localeCompare(b.product_name || '');
      }
      return aAvail - bAvail;
    });
    return candidates;
  }
  return [];
}

// =========================================================================
// PHASE 3: 5 CLICKABLE SUMMARY CARDS
// =========================================================================
function renderPoKpiCards() {
  var kpis = (poDashboardData && poDashboardData.kpis) ? poDashboardData.kpis : {};

  // 1. Items to Reorder
  var replenishItems = getPoReplenishmentItems();
  var reorderCount = replenishItems.length;
  if (!reorderCount && kpis.items_to_reorder !== undefined) {
    reorderCount = kpis.items_to_reorder;
  } else if (!reorderCount && kpis.reorder_items_count !== undefined) {
    reorderCount = kpis.reorder_items_count;
  }
  var elReorder = document.getElementById('poKpiItemsToReorder');
  if (elReorder) elReorder.textContent = reorderCount;

  var pos = (poActiveDateRange && poActiveDateRange !== 'all')
    ? filterByDateRange(poAllPosCache || [], poActiveDateRange, 'order_date')
    : (poAllPosCache || []);

  // 2. Pending POs
  var pendingCount = 0;
  pos.forEach(function (po) {
    var s = String(po.status || '').toLowerCase();
    if (s.indexOf('pending') !== -1 || s === 'draft') pendingCount++;
  });
  if (pendingCount === 0 && (!poAllPosCache || poAllPosCache.length === 0) && kpis.pos_pending_approval !== undefined) {
    pendingCount = kpis.pos_pending_approval;
  }
  var elPending = document.getElementById('poKpiPendingPos');
  if (elPending) elPending.textContent = pendingCount;

  // 3. Approved POs (Ordered / Issued)
  var approvedCount = 0;
  pos.forEach(function (po) {
    var s = String(po.status || '');
    if (s === 'Ordered' || s === 'Issued') approvedCount++;
  });
  if (approvedCount === 0 && (!poAllPosCache || poAllPosCache.length === 0) && kpis.awaiting_delivery !== undefined) {
    approvedCount = kpis.awaiting_delivery;
  }
  var elApproved = document.getElementById('poKpiApprovedPos');
  if (elApproved) elApproved.textContent = approvedCount;

  // 4. Partially Received POs
  var partialCount = 0;
  pos.forEach(function (po) {
    var s = String(po.status || '');
    if (s === 'Partially Received') partialCount++;
  });
  if (partialCount === 0 && (!poAllPosCache || poAllPosCache.length === 0) && kpis.partially_received !== undefined) {
    partialCount = kpis.partially_received;
  }
  var elPartial = document.getElementById('poKpiPartialPos');
  if (elPartial) elPartial.textContent = partialCount;

  // 5. Completed POs
  var completedCount = 0;
  pos.forEach(function (po) {
    var s = String(po.status || '');
    if (s === 'Received' || s === 'Fully Received' || s === 'Completed') completedCount++;
  });
  if (completedCount === 0 && (!poAllPosCache || poAllPosCache.length === 0) && kpis.completed_pos !== undefined) {
    completedCount = kpis.completed_pos;
  }
  var elCompleted = document.getElementById('poKpiCompletedPos');
  if (elCompleted) elCompleted.textContent = completedCount;
}

// =========================================================================
// PHASE 4: REPLENISHMENT NEEDED (LOW STOCK) TABLE & CART ACTION
// =========================================================================
function renderPoReplenishmentMiniTable() {
  var tbody = document.getElementById('poReplenishmentMiniRows');
  var badge = document.getElementById('badgeReplenishMiniCount');
  if (!tbody) return;

  var items = getPoReplenishmentItems();
  if (badge) badge.textContent = items.length;

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3 small"><i class="bi bi-check-circle text-success me-1"></i>All warehouse products are sufficiently stocked.</td></tr>';
    return;
  }

  // Display a maximum of 2 product rows in dashboard preview
  var displayItems = items.slice(0, 2);
  var html = '';

  displayItems.forEach(function (item) {
    var pid = item.product_id;
    var name = escapeHtml(item.product_name);
    var avail = parseInt(item.available_stock !== undefined ? item.available_stock : (item.usable_stock || 0), 10);
    var reorder = parseInt(item.reorder_level !== undefined ? item.reorder_level : (item.reorder_threshold || 10), 10);
    var iconClass = getProductIconClass(item.category_name);
    var stockClass = avail <= 0 ? 'text-danger fw-bold' : (avail <= reorder ? 'text-warning-emphasis fw-bold' : 'text-dark');
    var statusBadge = avail <= 0
      ? '<span class="badge bg-danger-subtle text-danger border border-danger-subtle" style="font-size: 10px; padding: 1px 6px;">Out of Stock</span>'
      : (avail <= reorder ? '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle" style="font-size: 10px; padding: 1px 6px;">Low Stock</span>' : '');

    html += '<tr>' +
      '<td class="ps-3 py-2">' +
        '<div class="d-flex align-items-center">' +
          '<span class="po-product-thumb me-2"><i class="bi ' + iconClass + '"></i></span>' +
          '<div class="text-truncate">' +
            '<div class="fw-semibold text-dark text-truncate" title="' + name + '">' + name + '</div>' +
            (statusBadge ? '<div class="d-flex align-items-center mt-0.5">' + statusBadge + '</div>' : '') +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td class="text-center py-2 ' + stockClass + '">' + avail + '</td>' +
      '<td class="text-center py-2 text-muted pe-3">' + reorder + '</td>' +
    '</tr>';
  });

  tbody.innerHTML = html;
  initPoTooltips();
}

/**
 * Blue cart icon action:
 * Adds product to an Independent PO draft, prefills suggested qty & preferred supplier,
 * and opens the 3-step wizard directly at Step 2 (Supplier & Pricing) or Step 1 with product selected!
 */
function handleAddToPo(productId) {
  var p = (poProductsCache || []).find(function (it) { return it.product_id == productId; });
  if (!p) {
    // Check in replenishment candidates
    var candidates = getPoReplenishmentItems();
    p = candidates.find(function (it) { return it.product_id == productId; });
  }

  if (!p) {
    showAlert('warning', 'Product details not found.');
    return;
  }

  openCreatePoWizard('Independent', p);
}

// =========================================================================
// PHASE 5: PURCHASE ORDER STATUS DONUT CHART
// =========================================================================
function renderPoDonutChart() {
  var svg = document.getElementById('poDonutChartSvg');
  var centerCount = document.getElementById('poDonutCenterCount');
  if (!svg) return;

  var pos = (poActiveDateRange && poActiveDateRange !== 'all')
    ? filterByDateRange(poAllPosCache || [], poActiveDateRange, 'order_date')
    : (poAllPosCache || []);

  var pending = 0;
  var approved = 0;
  var partial = 0;
  var completed = 0;
  var cancelled = 0;
  var other = 0;

  pos.forEach(function (po) {
    var s = String(po.status || '');
    var sLower = s.toLowerCase();
    if (sLower.indexOf('pending') !== -1 || sLower === 'draft') {
      pending++;
    } else if (sLower === 'ordered' || sLower === 'issued') {
      approved++;
    } else if (sLower === 'partially received') {
      partial++;
    } else if (sLower === 'received' || sLower === 'fully received' || sLower === 'completed') {
      completed++;
    } else if (sLower === 'cancelled') {
      cancelled++;
    } else {
      other++;
    }
  });

  var total = pending + approved + partial + completed + cancelled + other;

  if (centerCount) centerCount.textContent = total;

  // Update Legend counts and percentages dynamically
  var updateLegend = function (elemId, count) {
    var el = document.getElementById(elemId);
    if (!el) return;
    if (total > 0 && count > 0) {
      var pct = Math.round((count / total) * 100);
      el.innerHTML = count + ' <span class="text-muted fw-normal" style="font-size: 11px;">(' + pct + '%)</span>';
    } else {
      el.innerHTML = count + ' <span class="text-muted fw-normal" style="font-size: 11px;">(0%)</span>';
    }
  };

  updateLegend('poLegendCountPending', pending);
  updateLegend('poLegendCountApproved', approved);
  updateLegend('poLegendCountPartial', partial);
  updateLegend('poLegendCountCompleted', completed);
  updateLegend('poLegendCountCancelled', cancelled);

  // Handle dynamic 'Other' legend item if unrecognized statuses exist
  var elOtherRow = document.getElementById('poLegendRowOther');
  if (other > 0) {
    if (!elOtherRow) {
      var legendList = document.getElementById('poDonutLegendList');
      if (legendList) {
        var otherDiv = document.createElement('div');
        otherDiv.id = 'poLegendRowOther';
        otherDiv.className = 'd-flex align-items-center justify-content-between small po-legend-row';
        otherDiv.role = 'button';
        otherDiv.title = 'View Other POs';
        otherDiv.onclick = function () { openPoFilteredModal('all', 'Other Purchase Orders'); };
        otherDiv.innerHTML = '<span class="d-flex align-items-center gap-1.5"><span class="po-legend-dot" style="background-color: #64748b;"></span>Other</span>' +
          '<strong class="text-dark" id="poLegendCountOther">0</strong>';
        legendList.appendChild(otherDiv);
      }
    }
    updateLegend('poLegendCountOther', other);
  } else if (elOtherRow) {
    elOtherRow.remove();
  }

  // Draw SVG Donut circle segments
  var radius = 60;
  var circumference = 2 * Math.PI * radius; // ~376.99
  var center = 85;
  var strokeWidth = 22;

  if (total === 0) {
    svg.innerHTML = '<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" fill="transparent" stroke="#e2e8f0" stroke-width="' + strokeWidth + '">' +
      '<title>No Purchase Orders</title>' +
    '</circle>';
    return;
  }

  var segments = [
    { label: 'Pending', count: pending, color: '#f59e0b', status: 'Pending Approval' },
    { label: 'Approved', count: approved, color: '#10b981', status: 'Ordered' },
    { label: 'Partially Received', count: partial, color: '#06b6d4', status: 'Partially Received' },
    { label: 'Completed', count: completed, color: '#8b5cf6', status: 'Received' },
    { label: 'Cancelled', count: cancelled, color: '#ef4444', status: 'Cancelled' }
  ];

  if (other > 0) {
    segments.push({ label: 'Other', count: other, color: '#64748b', status: 'all' });
  }

  var currentOffset = 0;
  var pathsHtml = '<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" fill="transparent" stroke="#f1f5f9" stroke-width="' + strokeWidth + '"></circle>';

  segments.forEach(function (seg) {
    if (seg.count > 0) {
      var pct = Math.round((seg.count / total) * 100);
      var segLen = (seg.count / total) * circumference;
      var dashArray = (seg.count === total)
        ? (circumference + ' 0')
        : (segLen.toFixed(2) + ' ' + (circumference - segLen).toFixed(2));
      var dashOffset = (-currentOffset).toFixed(2);

      pathsHtml += '<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" ' +
        'fill="transparent" stroke="' + seg.color + '" stroke-width="' + strokeWidth + '" ' +
        'stroke-dasharray="' + dashArray + '" stroke-dashoffset="' + dashOffset + '" ' +
        'transform="rotate(-90 ' + center + ' ' + center + ')" ' +
        'class="po-donut-slice" onclick="openPoFilteredModal(\'' + seg.status + '\', \'' + seg.label + ' POs\')">' +
        '<title>' + seg.label + ': ' + seg.count + ' POs (' + pct + '%)</title>' +
      '</circle>';

      currentOffset += segLen;
    }
  });

  svg.innerHTML = pathsHtml;
}

// =========================================================================
// PHASE 6: RECENT PURCHASING ACTIVITY TIMELINE
// =========================================================================
function renderPoRecentActivityTimeline() {
  var container = document.getElementById('poRecentActivityTimeline');
  if (!container) return;

  var list = (poDashboardData && poDashboardData.recent_activity) ? poDashboardData.recent_activity : [];

  if (list.length === 0) {
    container.innerHTML = '<div class="text-center text-muted py-4 small">No recent activity recorded.</div>';
    return;
  }

  var html = '';
  list.slice(0, 6).forEach(function (item) {
    var ref = escapeHtml(item.ref_no || '');
    var summary = escapeHtml(item.summary || '');
    var date = formatDateTimeDisplay(item.activity_date || item.sort_ts);

    // Determine icon & color based on summary text
    var iconClass = 'bi-file-earmark-text';
    var iconBg = 'bg-primary-subtle text-primary';
    var summaryLower = summary.toLowerCase();

    if (summaryLower.indexOf('approved') !== -1) {
      iconClass = 'bi-check2-circle';
      iconBg = 'bg-success-subtle text-success';
    } else if (summaryLower.indexOf('partially received') !== -1 || summaryLower.indexOf('delivery recorded') !== -1) {
      iconClass = 'bi-truck';
      iconBg = 'bg-purple-subtle text-purple';
    } else if (summaryLower.indexOf('converted') !== -1 || summaryLower.indexOf('pr') !== -1) {
      iconClass = 'bi-link-45deg';
      iconBg = 'bg-info-subtle text-info';
    }

    // Extract PO ID if possible
    var poIdMatch = ref.match(/PO-(\d+)/);
    var poId = poIdMatch ? parseInt(poIdMatch[1], 10) : 0;

    html += '<div class="po-activity-item">' +
      '<div class="d-flex align-items-center gap-2.5 overflow-hidden">' +
        '<div class="po-activity-icon ' + iconBg + '"><i class="bi ' + iconClass + '"></i></div>' +
        '<div class="overflow-hidden">' +
          '<div class="fw-semibold text-dark text-truncate small" style="max-width: 190px;" title="' + summary + '">' + summary + '</div>' +
          '<div class="text-muted" style="font-size: 11px;">' + date + '</div>' +
        '</div>' +
      '</div>' +
      (poId > 0 ?
        '<button type="button" class="po-btn-icon po-btn-icon-blue ms-1" onclick="openPoDetailModal(' + poId + ')" title="View PO Details" aria-label="View PO Details">' +
          '<i class="bi bi-eye"></i>' +
        '</button>' : '') +
    '</div>';
  });

  container.innerHTML = html;
  initPoTooltips();
}

// =========================================================================
// PHASE 7: PENDING PURCHASE ORDERS TABLE
// =========================================================================
function renderPoPendingTable() {
  var tbody = document.getElementById('poPendingTableRows');
  var badge = document.getElementById('badgePendingPosMiniCount');
  if (!tbody) return;

  var pending = poAllPosCache.filter(function (po) {
    var s = String(po.status || '').toLowerCase();
    return s.indexOf('pending') !== -1 || s === 'draft';
  });

  // Apply Date Range Filter if active
  if (poActiveDateRange !== 'all') {
    pending = filterByDateRange(pending, poActiveDateRange, 'order_date');
  }

  if (badge) badge.textContent = pending.length;

  if (pending.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4 small"><i class="bi bi-inbox me-1"></i>No purchase orders awaiting approval.</td></tr>';
    return;
  }

  var html = '';
  pending.slice(0, 5).forEach(function (po) {
    var poId = po.po_id;
    var poCode = escapeHtml(po.po_code || ('PO-' + String(poId).padStart(5, '0')));
    var supplier = escapeHtml(po.supplier_name || '—');
    var itemsCount = parseInt(po.total_ordered_qty || po.items_cnt || 1, 10);
    var cost = formatMoney(po.total_cost || po.total_amount || 0);
    var date = formatDateDisplay(po.order_date || po.created_at);

    html += '<tr>' +
      '<td class="ps-3 font-monospace fw-bold text-dark">' + poCode + '</td>' +
      '<td class="fw-semibold text-truncate" style="max-width: 140px;" title="' + supplier + '">' + supplier + '</td>' +
      '<td class="text-center">' + itemsCount + '</td>' +
      '<td class="text-end font-monospace fw-semibold text-dark">&#8369;' + cost + '</td>' +
      '<td class="text-muted small">' + date + '</td>' +
      '<td class="text-center">' + poStatusBadgeHtml(po.status) + '</td>' +
      '<td class="text-end pe-3 text-nowrap">' +
        '<div class="d-inline-flex gap-1">' +
          '<button type="button" class="po-btn-icon po-btn-icon-blue" onclick="openPoDetailModal(' + poId + ')" title="View PO Details" aria-label="View PO Details">' +
            '<i class="bi bi-eye"></i>' +
          '</button>' +
          '<button type="button" class="po-btn-icon po-btn-icon-blue" onclick="handlePoEdit(' + poId + ')" title="Edit Purchase Order" aria-label="Edit Purchase Order">' +
            '<i class="bi bi-pencil"></i>' +
          '</button>' +
          '<button type="button" class="po-btn-icon po-btn-icon-red" onclick="cancelPoWithConfirmation(' + poId + ')" title="Cancel Purchase Order" aria-label="Cancel Purchase Order">' +
            '<i class="bi bi-trash"></i>' +
          '</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  });

  tbody.innerHTML = html;
  initPoTooltips();
}

// =========================================================================
// PHASE 8: EXPECTED DELIVERIES TABLE
// =========================================================================
function renderPoDeliveriesTable() {
  var tbody = document.getElementById('poDeliveriesTableRows');
  var badge = document.getElementById('badgeDeliveriesMiniCount');
  if (!tbody) return;

  var deliveries = poAllPosCache.filter(function (po) {
    var s = String(po.status || '');
    var rec = String(po.receiving_status || '');
    return (s === 'Ordered' || s === 'Issued' || s === 'In Transit' || rec === 'In Transit' || rec === 'Awaiting Delivery') &&
           s !== 'Received' && s !== 'Fully Received' && s !== 'Cancelled';
  });

  // Sort by expected delivery date ascending
  deliveries.sort(function (a, b) {
    var dateA = a.expected_date ? new Date(a.expected_date).getTime() : 9999999999999;
    var dateB = b.expected_date ? new Date(b.expected_date).getTime() : 9999999999999;
    return dateA - dateB;
  });

  if (badge) badge.textContent = deliveries.length;

  if (deliveries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4 small"><i class="bi bi-truck me-1"></i>No supplier deliveries currently in transit.</td></tr>';
    return;
  }

  var html = '';
  deliveries.slice(0, 5).forEach(function (po) {
    var poId = po.po_id;
    var poCode = escapeHtml(po.po_code || ('PO-' + String(poId).padStart(5, '0')));
    var supplier = escapeHtml(po.supplier_name || '—');
    var itemsCount = parseInt(po.total_ordered_qty || po.items_cnt || 1, 10);
    var eta = formatDateDisplay(po.expected_date || po.order_date);
    var statusBadge = (po.receiving_status === 'In Transit' || po.status === 'In Transit')
      ? '<span class="badge rounded-pill bg-primary-subtle text-primary border border-primary-subtle px-2 py-1"><i class="bi bi-truck me-1"></i>In Transit</span>'
      : '<span class="badge rounded-pill bg-success-subtle text-success border border-success-subtle px-2 py-1"><i class="bi bi-clock me-1"></i>Confirmed</span>';

    html += '<tr>' +
      '<td class="ps-3 font-monospace fw-bold text-dark">' + poCode + '</td>' +
      '<td class="fw-semibold text-truncate" style="max-width: 120px;" title="' + supplier + '">' + supplier + '</td>' +
      '<td class="text-center">' + itemsCount + '</td>' +
      '<td class="text-dark small fw-medium">' + eta + '</td>' +
      '<td class="text-center">' + statusBadge + '</td>' +
      '<td class="text-end pe-3 text-nowrap">' +
        '<div class="d-inline-flex gap-1">' +
          '<button type="button" class="po-btn-icon po-btn-icon-blue" onclick="openPoDeliveryTracking(' + poId + ')" title="Track Delivery" aria-label="Track Delivery">' +
            '<i class="bi bi-truck"></i>' +
          '</button>' +
          '<button type="button" class="po-btn-icon po-btn-icon-blue" onclick="openPoDetailModal(' + poId + ')" title="View PO Details" aria-label="View PO Details">' +
            '<i class="bi bi-eye"></i>' +
          '</button>' +
          '<button type="button" class="po-btn-icon po-btn-icon-blue" onclick="viewPoReceipt(' + poId + ')" title="View Delivery Receipt" aria-label="View Delivery Receipt">' +
            '<i class="bi bi-file-earmark-text"></i>' +
          '</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  });

  tbody.innerHTML = html;
  initPoTooltips();
}

function filterByDateRange(items, rangeKey, dateField) {
  var now = new Date();
  var start = new Date();
  if (rangeKey === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (rangeKey === '7days') {
    start.setDate(now.getDate() - 7);
  } else if (rangeKey === '30days') {
    start.setDate(now.getDate() - 30);
  } else if (rangeKey === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else {
    return items;
  }

  return items.filter(function (it) {
    var raw = it[dateField] || it.created_at;
    if (!raw) return true;
    var d = new Date(raw);
    return d >= start;
  });
}

// =========================================================================
// PHASE 9: CREATE PURCHASE ORDER 3-STEP WIZARD
// =========================================================================
function openCreatePoWizard(mode, prefilledProduct) {
  poWizardState.step = 1;
  poWizardState.mode = mode || 'Independent';
  poWizardState.prId = null;
  poWizardState.supplierId = null;
  poWizardState.orderDate = todayStr();
  poWizardState.expectedDate = '';
  poWizardState.notes = '';
  poWizardState.lines = [];

  // Update UI mode switch
  var rIndep = document.getElementById('poWModeIndependent');
  var rPr = document.getElementById('poWModePrLinked');
  if (rIndep && rPr) {
    if (poWizardState.mode === 'PR-Linked') {
      rPr.checked = true;
      document.getElementById('poWPrSelectRow').hidden = false;
      populateApprovedPrDropdown();
    } else {
      rIndep.checked = true;
      document.getElementById('poWPrSelectRow').hidden = true;
    }
  }

  // Populate categories & products catalog for Step 1
  populateCategoryDropdown();
  renderPoWProductCatalog();

  // If a prefilled product was passed (e.g. from blue cart icon in low-stock table)
  if (prefilledProduct) {
    addOrUpdateWizardLine(prefilledProduct, true);
  }

  goToPoWizardStep(1);

  // Show modal
  var modalEl = document.getElementById('poModal');
  if (modalEl) {
    var bsModal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    bsModal.show();
  }
}

function switchPoWizardMode(mode) {
  poWizardState.mode = mode;
  var prRow = document.getElementById('poWPrSelectRow');
  if (prRow) {
    prRow.hidden = (mode !== 'PR-Linked');
    if (mode === 'PR-Linked') {
      populateApprovedPrDropdown();
    }
  }
  renderPoWProductCatalog();
}

function populateApprovedPrDropdown() {
  var sel = document.getElementById('poWPrSelect');
  if (!sel) return;
  var html = '<option value="">-- Select Approved PR --</option>';
  (poApprovedPrsCache || []).forEach(function (pr) {
    var code = escapeHtml(pr.pr_code || ('PR-' + String(pr.pr_id).padStart(4, '0')));
    var reqBy = escapeHtml(pr.requested_by_name || pr.requested_by || 'Store');
    var items = escapeHtml(pr.items_summary || (pr.item_count + ' items'));
    html += '<option value="' + pr.pr_id + '">' + code + ' — ' + reqBy + ' (' + items + ')</option>';
  });
  sel.innerHTML = html;
}

async function handlePoWPrSelectChange() {
  var sel = document.getElementById('poWPrSelect');
  var infoEl = document.getElementById('poWPrSummaryInfo');
  if (!sel || !sel.value) {
    if (infoEl) infoEl.textContent = 'Select an approved PR to automatically load shortage items.';
    return;
  }

  var prId = parseInt(sel.value, 10);
  poWizardState.prId = prId;

  try {
    var res = await axios.get(API + 'purchase_request.php?mode=detail&pr_id=' + prId);
    if (res.data && res.data.success && res.data.data) {
      var prData = res.data.data;
      var items = prData.items || [];
      poWizardState.lines = [];

      items.forEach(function (it) {
        var appQty = parseInt(it.approved_qty || it.requested_qty || 1, 10);
        var ordQty = parseInt(it.ordered_qty || 0, 10);
        var needed = Math.max(1, appQty - ordQty);

        poWizardState.lines.push({
          product_id: it.product_id,
          product_name: it.product_name,
          category_name: it.category_name || 'Equipment',
          unit_measure: it.unit_measure || 'Unit',
          available_stock: it.available_stock || 0,
          reorder_level: it.reorder_level || 10,
          max_stock: it.max_stock || 100,
          quantity: needed,
          unit_cost: parseFloat(it.supplier_unit_cost || it.unit_price || 0),
          preferred_supplier_id: it.supplier_id || null,
          preferred_supplier_name: it.supplier_name || ''
        });
      });

      if (infoEl) {
        infoEl.innerHTML = '<span class="text-success"><i class="bi bi-check-circle me-1"></i>Loaded ' + items.length + ' approved items from ' + (prData.pr_code || ('PR-' + prId)) + '.</span>';
      }

      updatePoWSelectedTray();
      renderPoWStep2OrderLines();
    }
  } catch (e) {
    console.error('Failed to load PR details:', e);
  }
}

function populateCategoryDropdown() {
  var sel = document.getElementById('poWCategoryFilter');
  if (!sel) return;

  var cats = {};
  (poProductsCache || []).forEach(function (p) {
    if (p.category_name) cats[p.category_name] = true;
  });

  var html = '<option value="all">All Categories</option>';
  Object.keys(cats).sort().forEach(function (cat) {
    html += '<option value="' + escapeHtml(cat) + '">' + escapeHtml(cat) + '</option>';
  });
  sel.innerHTML = html;

  var repSel = document.getElementById('poReplenishModalCategoryFilter');
  if (repSel) repSel.innerHTML = html;
}

function populateSupplierDropdowns() {
  var s1 = document.getElementById('poWSupplierSelect');
  var s2 = document.getElementById('poFilteredModalSupplierFilter');
  var s3 = document.getElementById('advFilterSupplier');

  var html = '<option value="">-- Select Active Supplier --</option>';
  var filterHtml = '<option value="all">All Suppliers</option>';

  (poSuppliersCache || []).forEach(function (s) {
    var sid = s.supplier_id;
    var sname = escapeHtml(s.supplier_name);
    html += '<option value="' + sid + '">' + sname + '</option>';
    filterHtml += '<option value="' + sid + '">' + sname + '</option>';
  });

  if (s1) s1.innerHTML = html;
  if (s2) s2.innerHTML = filterHtml;
  if (s3) s3.innerHTML = filterHtml;
}

function renderPoWProductCatalog() {
  var tbody = document.getElementById('poWProductCatalogRows');
  if (!tbody) return;

  var q = (document.getElementById('poWItemSearchInput') ? document.getElementById('poWItemSearchInput').value : '').toLowerCase().trim();
  var cat = (document.getElementById('poWCategoryFilter') ? document.getElementById('poWCategoryFilter').value : 'all');

  var filtered = (poProductsCache || []).filter(function (p) {
    var matchesQ = !q || (p.product_name && p.product_name.toLowerCase().indexOf(q) !== -1) ||
                         (p.product_id && String(p.product_id).indexOf(q) !== -1);
    var matchesCat = (cat === 'all') || (p.category_name === cat);
    return matchesQ && matchesCat;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4 small">No products matching filters found.</td></tr>';
    return;
  }

  var html = '';
  filtered.forEach(function (p) {
    var pid = p.product_id;
    var name = escapeHtml(p.product_name);
    var category = escapeHtml(p.category_name || 'General');
    var stock = parseInt(p.available_stock || 0, 10);
    var unit = escapeHtml(p.unit_measure || 'Unit');
    var maxS = parseInt(p.max_stock || 100, 10);
    var defaultQty = Math.max(1, maxS - stock);

    // Check if line item is already in wizard state
    var existingLine = poWizardState.lines.find(function (l) { return l.product_id == pid; });
    var qtyVal = existingLine ? existingLine.quantity : defaultQty;
    var isAdded = !!existingLine;

    html += '<tr>' +
      '<td class="ps-3">' +
        '<div class="d-flex align-items-center">' +
          '<span class="po-product-thumb me-2"><i class="bi ' + getProductIconClass(p.category_name) + '"></i></span>' +
          '<div>' +
            '<div class="fw-semibold text-dark">' + name + '</div>' +
            '<div class="text-muted" style="font-size: 11px;">ID: ' + pid + '</div>' +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td class="small text-secondary">' + category + '</td>' +
      '<td class="text-center font-monospace ' + (stock <= 0 ? 'text-danger fw-bold' : 'text-dark') + '">' + stock + '</td>' +
      '<td class="text-center small text-muted">' + unit + '</td>' +
      '<td class="text-center">' +
        '<div class="d-inline-flex align-items-center gap-1 po-qty-stepper">' +
          '<button type="button" class="po-stepper-btn" onclick="stepCatalogQty(' + pid + ', -1)" title="Decrease qty">-</button>' +
          '<input type="number" class="po-stepper-input font-monospace" id="stepperQty_' + pid + '" value="' + qtyVal + '" min="1" step="1" onchange="updateCatalogQty(' + pid + ')">' +
          '<button type="button" class="po-stepper-btn" onclick="stepCatalogQty(' + pid + ', 1)" title="Increase qty">+</button>' +
        '</div>' +
      '</td>' +
      '<td class="text-end pe-3">' +
        '<button type="button" class="po-btn-icon ' + (isAdded ? 'po-btn-icon-green' : 'po-btn-icon-blue') + '" onclick="toggleCatalogItem(' + pid + ')" title="' + (isAdded ? 'Item added to order' : 'Add to order') + '" aria-label="' + (isAdded ? 'Item added to order' : 'Add to order') + '">' +
          '<i class="bi ' + (isAdded ? 'bi-check-lg' : 'bi-cart-plus') + '"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  });

  tbody.innerHTML = html;
  initPoTooltips();
}

function handlePoWItemFilter() {
  renderPoWProductCatalog();
}

function clearPoWItemFilters() {
  var qInput = document.getElementById('poWItemSearchInput');
  var catSel = document.getElementById('poWCategoryFilter');
  if (qInput) qInput.value = '';
  if (catSel) catSel.value = 'all';
  renderPoWProductCatalog();
}

function stepCatalogQty(productId, delta) {
  var input = document.getElementById('stepperQty_' + productId);
  if (!input) return;
  var current = parseInt(input.value || 1, 10);
  var next = Math.max(1, current + delta);
  input.value = next;
  updateCatalogQty(productId);
}

function updateCatalogQty(productId) {
  var input = document.getElementById('stepperQty_' + productId);
  if (!input) return;
  var qty = Math.max(1, parseInt(input.value || 1, 10));
  input.value = qty;

  var line = poWizardState.lines.find(function (l) { return l.product_id == productId; });
  if (line) {
    line.quantity = qty;
    updatePoWSelectedTray();
    renderPoWStep2OrderLines();
  }
}

function toggleCatalogItem(productId) {
  var p = (poProductsCache || []).find(function (it) { return it.product_id == productId; });
  if (!p) return;

  var input = document.getElementById('stepperQty_' + productId);
  var qty = input ? Math.max(1, parseInt(input.value || 1, 10)) : 1;

  var existingIdx = poWizardState.lines.findIndex(function (l) { return l.product_id == productId; });
  if (existingIdx !== -1) {
    // Remove if already added
    poWizardState.lines.splice(existingIdx, 1);
  } else {
    // Add item
    addOrUpdateWizardLine(p, false, qty);
  }

  renderPoWProductCatalog();
  updatePoWSelectedTray();
  renderPoWStep2OrderLines();
}

function addOrUpdateWizardLine(p, autoAdvance, customQty) {
  var stock = parseInt(p.available_stock || 0, 10);
  var maxS = parseInt(p.max_stock || 100, 10);
  var qty = customQty || parseInt(p.suggested_order_qty || p.net_suggested_order_qty || Math.max(1, maxS - stock), 10);

  var existing = poWizardState.lines.find(function (l) { return l.product_id == p.product_id; });
  if (existing) {
    existing.quantity = qty;
  } else {
    poWizardState.lines.push({
      product_id: p.product_id,
      product_name: p.product_name,
      category_name: p.category_name || 'Equipment',
      unit_measure: p.unit_measure || 'Unit',
      available_stock: stock,
      reorder_level: p.reorder_level || 10,
      max_stock: maxS,
      quantity: qty,
      unit_cost: parseFloat(p.supplier_unit_cost || p.unit_price || 0),
      preferred_supplier_id: p.supplier_id || null,
      preferred_supplier_name: p.supplier_name || ''
    });
  }

  // Auto-set preferred supplier if lines share one and none set
  if (!poWizardState.supplierId && p.supplier_id) {
    poWizardState.supplierId = p.supplier_id;
    var sel = document.getElementById('poWSupplierSelect');
    if (sel) sel.value = p.supplier_id;
  }

  updatePoWSelectedTray();
  renderPoWStep2OrderLines();

  if (autoAdvance) {
    goToPoWizardStep(2);
  }
}

function updatePoWSelectedTray() {
  var container = document.getElementById('poWSelectedItemsBadges');
  var countEl = document.getElementById('poWSelectedItemsCount');
  var totalEl = document.getElementById('poWStep1RunningTotal');
  if (!container) return;

  var lines = poWizardState.lines || [];
  if (countEl) countEl.textContent = lines.length;

  if (lines.length === 0) {
    container.innerHTML = '<span class="text-muted small">No items added yet. Click the cart icon beside any product above.</span>';
    if (totalEl) totalEl.textContent = 'PHP 0.00';
    return;
  }

  var runningTotal = 0;
  var html = '';
  lines.forEach(function (l) {
    var lineTotal = (l.quantity || 0) * (l.unit_cost || 0);
    runningTotal += lineTotal;
    html += '<span class="badge bg-white text-dark border p-1.5 d-inline-flex align-items-center gap-1.5 shadow-xs">' +
      '<strong class="text-primary">' + l.quantity + 'x</strong> ' + escapeHtml(l.product_name) +
      '<button type="button" class="btn-close ms-1" style="font-size: 8px;" onclick="removeWizardLine(' + l.product_id + ')" aria-label="Remove item"></button>' +
    '</span>';
  });

  container.innerHTML = html;
  if (totalEl) totalEl.textContent = 'PHP ' + formatMoney(runningTotal);
}

function removeWizardLine(productId) {
  poWizardState.lines = poWizardState.lines.filter(function (l) { return l.product_id != productId; });
  renderPoWProductCatalog();
  updatePoWSelectedTray();
  renderPoWStep2OrderLines();
}

function renderPoWStep2OrderLines() {
  var tbody = document.getElementById('poWStep2OrderLines');
  var totalEl = document.getElementById('poWStep2GrandTotal');
  if (!tbody) return;

  var lines = poWizardState.lines || [];
  if (lines.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4 small">No products selected. Please return to Step 1 to select items.</td></tr>';
    if (totalEl) totalEl.textContent = 'PHP 0.00';
    return;
  }

  var grandTotal = 0;
  var html = '';

  lines.forEach(function (l, idx) {
    var lineTotal = (l.quantity || 0) * (l.unit_cost || 0);
    grandTotal += lineTotal;

    html += '<tr>' +
      '<td class="ps-3">' +
        '<div class="fw-semibold text-dark">' + escapeHtml(l.product_name) + '</div>' +
        '<div class="text-muted" style="font-size: 11px;">Stock: ' + l.available_stock + ' ' + escapeHtml(l.unit_measure) + ' | Max: ' + l.max_stock + '</div>' +
      '</td>' +
      '<td class="text-center">' +
        '<input type="number" class="form-control form-control-sm font-monospace text-center mx-auto" style="width: 75px;" value="' + l.quantity + '" min="1" step="1" onchange="handlePoWLineQtyChange(' + idx + ', this.value)">' +
      '</td>' +
      '<td class="text-end">' +
        '<input type="number" class="form-control form-control-sm font-monospace text-end ms-auto" style="width: 105px;" value="' + l.unit_cost.toFixed(2) + '" min="0" step="0.01" onchange="handlePoWLineCostChange(' + idx + ', this.value)">' +
      '</td>' +
      '<td class="text-end font-monospace fw-semibold text-primary">' +
        'PHP ' + formatMoney(lineTotal) +
      '</td>' +
      '<td class="text-end pe-3">' +
        '<button type="button" class="po-btn-icon po-btn-icon-red" onclick="removeWizardLine(' + l.product_id + ')" title="Remove item" aria-label="Remove item">' +
          '<i class="bi bi-trash"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  });

  tbody.innerHTML = html;
  if (totalEl) totalEl.textContent = 'PHP ' + formatMoney(grandTotal);
}

function handlePoWLineQtyChange(index, newVal) {
  var q = Math.max(1, parseInt(newVal || 1, 10));
  if (poWizardState.lines[index]) {
    poWizardState.lines[index].quantity = q;
    renderPoWStep2OrderLines();
    updatePoWSelectedTray();
  }
}

function handlePoWLineCostChange(index, newVal) {
  var c = Math.max(0, parseFloat(newVal || 0));
  if (poWizardState.lines[index]) {
    poWizardState.lines[index].unit_cost = c;
    renderPoWStep2OrderLines();
    updatePoWSelectedTray();
  }
}

async function handlePoWSupplierChange() {
  var sel = document.getElementById('poWSupplierSelect');
  if (!sel || !sel.value) return;
  var sid = parseInt(sel.value, 10);
  poWizardState.supplierId = sid;

  // Attempt to fetch supplier-contracted prices for selected products
  try {
    var res = await axios.get(API + 'product_supplier.php?supplier_id=' + sid);
    if (res.data && res.data.success && res.data.data) {
      var rates = res.data.data;
      var rateMap = {};
      rates.forEach(function (r) {
        rateMap[r.product_id] = parseFloat(r.supplier_unit_cost || r.unit_cost || 0);
      });

      poWizardState.lines.forEach(function (l) {
        if (rateMap[l.product_id] !== undefined && rateMap[l.product_id] > 0) {
          l.unit_cost = rateMap[l.product_id];
        }
      });
      renderPoWStep2OrderLines();
    }
  } catch (e) {
    console.warn('Could not load supplier contracted prices:', e);
  }
}

function goToPoWizardStep(stepNum) {
  // Validate before step change
  if (stepNum > 1 && poWizardState.lines.length === 0) {
    showAlert('warning', 'Please select at least one product before proceeding.');
    return;
  }
  if (stepNum > 2) {
    var suppSel = document.getElementById('poWSupplierSelect');
    if (!suppSel || !suppSel.value) {
      showAlert('warning', 'Please select a Supplier in Step 2.');
      return;
    }
    poWizardState.supplierId = parseInt(suppSel.value, 10);
    poWizardState.orderDate = document.getElementById('poWOrderDate') ? document.getElementById('poWOrderDate').value : todayStr();
    poWizardState.expectedDate = document.getElementById('poWExpectedDate') ? document.getElementById('poWExpectedDate').value : '';
    poWizardState.notes = document.getElementById('poWNotes') ? document.getElementById('poWNotes').value : '';
    populatePoWStep3Review();
  }

  poWizardState.step = stepNum;

  // Toggle stepper classes
  for (var i = 1; i <= 3; i++) {
    var stepEl = document.getElementById('poWStep' + i);
    var contentEl = document.getElementById('poWizardStep' + i + 'Content');
    if (stepEl) {
      stepEl.classList.toggle('active', i === stepNum);
      stepEl.classList.toggle('completed', i < stepNum);
    }
    if (contentEl) {
      contentEl.hidden = (i !== stepNum);
    }
  }

  // Toggle footer buttons
  var backBtn = document.getElementById('btnPoWizardBack');
  var nextBtn = document.getElementById('btnPoWizardNext');
  var submitBtn = document.getElementById('btnPoWizardSubmit');

  if (backBtn) backBtn.style.visibility = (stepNum > 1) ? 'visible' : 'hidden';
  if (nextBtn) {
    nextBtn.hidden = (stepNum === 3);
    if (stepNum === 1) nextBtn.innerHTML = 'Next: Supplier &amp; Pricing <i class="bi bi-arrow-right ms-1"></i>';
    if (stepNum === 2) nextBtn.innerHTML = 'Next: Review &amp; Submit <i class="bi bi-arrow-right ms-1"></i>';
  }
  if (submitBtn) submitBtn.hidden = (stepNum !== 3);
}

function handlePoWizardNext() {
  goToPoWizardStep(poWizardState.step + 1);
}

function handlePoWizardBack() {
  goToPoWizardStep(poWizardState.step - 1);
}

function populatePoWStep3Review() {
  var suppSel = document.getElementById('poWSupplierSelect');
  var suppName = suppSel && suppSel.selectedIndex > 0 ? suppSel.options[suppSel.selectedIndex].text : '—';

  var elSupp = document.getElementById('poWRevSupplier');
  var elMode = document.getElementById('poWRevMode');
  var elOrderDate = document.getElementById('poWRevOrderDate');
  var elExpectedDate = document.getElementById('poWRevExpectedDate');

  if (elSupp) elSupp.textContent = suppName;
  if (elMode) elMode.textContent = poWizardState.mode;
  if (elOrderDate) elOrderDate.textContent = formatDateDisplay(poWizardState.orderDate);
  if (elExpectedDate) elExpectedDate.textContent = poWizardState.expectedDate ? formatDateDisplay(poWizardState.expectedDate) : 'Not specified';

  var tbody = document.getElementById('poWRevItemsTableBody');
  var totalEl = document.getElementById('poWRevTotalAmount');
  if (!tbody) return;

  var grandTotal = 0;
  var html = '';

  poWizardState.lines.forEach(function (l) {
    var lineTotal = (l.quantity || 0) * (l.unit_cost || 0);
    grandTotal += lineTotal;

    html += '<tr>' +
      '<td class="ps-3 fw-semibold text-dark">' + escapeHtml(l.product_name) + '</td>' +
      '<td class="text-center font-monospace">' + l.quantity + ' ' + escapeHtml(l.unit_measure) + '</td>' +
      '<td class="text-end font-monospace">PHP ' + formatMoney(l.unit_cost) + '</td>' +
      '<td class="text-end font-monospace fw-semibold text-primary pe-3">PHP ' + formatMoney(lineTotal) + '</td>' +
    '</tr>';
  });

  tbody.innerHTML = html;
  if (totalEl) totalEl.textContent = 'PHP ' + formatMoney(grandTotal);
}

async function handlePoWizardSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();

  if (poWizardState.lines.length === 0) {
    showAlert('warning', 'No products in order.');
    return;
  }
  if (!poWizardState.supplierId) {
    showAlert('warning', 'Supplier is required.');
    return;
  }

  var submitBtn = document.getElementById('btnPoWizardSubmit');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span>Submitting PO…';
  }

  var payload = {
    supplier_id: poWizardState.supplierId,
    pr_id: poWizardState.mode === 'PR-Linked' ? poWizardState.prId : null,
    po_source: poWizardState.mode,
    po_type: poWizardState.mode === 'PR-Linked' ? 'pr_replenishment' : 'warehouse_replenishment',
    order_date: poWizardState.orderDate || todayStr(),
    expected_date: poWizardState.expectedDate || null,
    status: 'Pending Approval', // Routes to manager approval
    notes: poWizardState.notes || '',
    items: poWizardState.lines.map(function (l) {
      return {
        product_id: l.product_id,
        quantity_ordered: l.quantity,
        unit_cost: l.unit_cost
      };
    })
  };

  try {
    var res = await axios.post(API + 'purchase_order.php', payload);
    if (res.data && res.data.success) {
      showAlert('success', 'Purchase Order created successfully.');

      // Close modal
      var modalEl = document.getElementById('poModal');
      if (modalEl) {
        var bsModal = bootstrap.Modal.getInstance(modalEl);
        if (bsModal) bsModal.hide();
      }

      // Reload dashboard data
      loadPurchaseOrders();
    } else {
      showAlert('danger', (res.data && res.data.message) ? res.data.message : 'Failed to create Purchase Order.');
    }
  } catch (err) {
    console.error('Error submitting PO:', err);
    var msg = (err.response && err.response.data && err.response.data.message) ? err.response.data.message : 'Server error while saving Purchase Order.';
    showAlert('danger', msg);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Submit Purchase Order';
    }
  }
}

// =========================================================================
// PHASE 10: PURCHASE ORDER DETAILS MODAL
// =========================================================================
async function openPoDetailModal(poId) {
  try {
    var res = await axios.get(API + 'purchase_order.php?mode=detail&po_id=' + poId);
    if (!res.data || !res.data.success || !res.data.data) {
      showAlert('danger', 'Failed to retrieve purchase order details.');
      return;
    }

    var po = res.data.data;
    poCurrentDetailPo = po;

    // Header info
    var poCode = escapeHtml(po.po_code || ('PO-' + String(po.po_id).padStart(5, '0')));
    var elCode = document.getElementById('poDetailCode');
    var elStatus = document.getElementById('poDetailStatusBadge');
    if (elCode) elCode.textContent = poCode;
    if (elStatus) elStatus.innerHTML = poStatusBadgeHtml(po.status);

    // Key metrics
    var elSupp = document.getElementById('poDetailSupplier');
    var elItems = document.getElementById('poDetailTotalItems');
    var elCost = document.getElementById('poDetailTotalCost');
    var elCreated = document.getElementById('poDetailCreatedDate');
    var elExpected = document.getElementById('poDetailExpectedDelivery');

    var items = po.items || [];
    var totalCost = po.total_cost || po.total_amount || 0;
    if (totalCost === 0 && items.length > 0) {
      items.forEach(function (it) {
        totalCost += (it.quantity_ordered || 0) * (it.unit_cost || 0);
      });
    }

    if (elSupp) elSupp.textContent = po.supplier_name || '—';
    if (elItems) elItems.textContent = items.length;
    if (elCost) elCost.textContent = 'PHP ' + formatMoney(totalCost);
    if (elCreated) elCreated.textContent = formatDateDisplay(po.order_date || po.created_at);
    if (elExpected) elExpected.textContent = po.expected_date ? formatDateDisplay(po.expected_date) : 'Not specified';

    // Tabs counts
    var elItemsTabCount = document.getElementById('poDetailItemsTabCount');
    var elActTabCount = document.getElementById('poDetailActivityTabCount');
    if (elItemsTabCount) elItemsTabCount.textContent = items.length;

    // Items table
    var tbody = document.getElementById('poDetailItemsRows');
    if (tbody) {
      var html = '';
      items.forEach(function (it) {
        var lineTotal = (it.quantity_ordered || 0) * (it.unit_cost || 0);
        html += '<tr>' +
          '<td class="ps-3">' +
            '<div class="d-flex align-items-center">' +
              '<span class="po-product-thumb me-2"><i class="bi ' + getProductIconClass(it.category_name) + '"></i></span>' +
              '<div class="fw-semibold text-dark">' + escapeHtml(it.product_name) + '</div>' +
            '</div>' +
          '</td>' +
          '<td class="text-center font-monospace">' + it.quantity_ordered + '</td>' +
          '<td class="text-end font-monospace">PHP ' + formatMoney(it.unit_cost) + '</td>' +
          '<td class="text-end font-monospace fw-semibold text-primary">PHP ' + formatMoney(lineTotal) + '</td>' +
          '<td class="text-center">' + poStatusBadgeHtml(po.status) + '</td>' +
        '</tr>';
      });
      tbody.innerHTML = html;
    }

    // Activity Log
    var timelineContainer = document.getElementById('poDetailActivityTimeline');
    var history = po.history || [];
    if (history.length === 0) {
      // Build standard event history
      history = [
        { title: 'Purchase Order Created', desc: 'PO recorded by ' + (po.created_by || 'Purchasing Officer'), date: po.created_at },
        { title: 'Status: ' + po.status, desc: 'Current order state is ' + po.status, date: po.updated_at || po.created_at }
      ];
      if (po.approved_at) {
        history.splice(1, 0, { title: 'PO Approved', desc: 'Authorized by Manager (' + (po.approved_by_name || 'Management') + ')', date: po.approved_at });
      }
    }
    if (elActTabCount) elActTabCount.textContent = history.length;

    if (timelineContainer) {
      var actHtml = '';
      history.forEach(function (h) {
        actHtml += '<div class="d-flex align-items-start gap-2.5 pb-2 border-bottom">' +
          '<div class="po-card-icon-mini bg-light text-primary"><i class="bi bi-clock-history"></i></div>' +
          '<div>' +
            '<div class="fw-semibold small text-dark">' + escapeHtml(h.title || h.action || 'Activity') + '</div>' +
            '<div class="text-muted small">' + escapeHtml(h.desc || h.description || h.remarks || '') + '</div>' +
            '<div class="text-muted" style="font-size: 11px;">' + formatDateTimeDisplay(h.date || h.created_at) + '</div>' +
          '</div>' +
        '</div>';
      });
      timelineContainer.innerHTML = actHtml;
    }

    // Show modal
    var modalEl = document.getElementById('poDetailModal');
    if (modalEl) {
      var bsModal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      bsModal.show();
    }
  } catch (e) {
    console.error('Error loading PO details:', e);
    showAlert('danger', 'Could not open purchase order details.');
  }
}

function handlePoDetailPrint() {
  if (poCurrentDetailPo) {
    viewPoReceipt(poCurrentDetailPo.po_id);
  }
}

function handlePoDetailEdit() {
  if (!poCurrentDetailPo) return;
  var s = String(poCurrentDetailPo.status || '').toLowerCase();
  if (s.indexOf('pending') === -1 && s !== 'draft') {
    showAlert('warning', 'Only Pending or Draft Purchase Orders can be modified.');
    return;
  }
  handlePoEdit(poCurrentDetailPo.po_id);
}

function handlePoDetailCancel() {
  if (poCurrentDetailPo) {
    cancelPoWithConfirmation(poCurrentDetailPo.po_id);
  }
}

function handlePoEdit(poId) {
  var po = poAllPosCache.find(function (p) { return p.po_id == poId; });
  if (!po) return;

  var s = String(po.status || '').toLowerCase();
  if (s.indexOf('pending') === -1 && s !== 'draft') {
    showAlert('warning', 'Approved or Received Purchase Orders cannot be edited.');
    return;
  }

  showAlert('info', 'Opening edit mode for ' + (po.po_code || ('PO-' + poId)) + '.');
  openPoDetailModal(poId);
}

// =========================================================================
// CANCEL PO WITH CONFIRMATION
// =========================================================================
async function cancelPoWithConfirmation(poId) {
  var po = poAllPosCache.find(function (p) { return p.po_id == poId; });
  var code = po ? (po.po_code || ('PO-' + poId)) : ('PO-' + poId);

  if (po) {
    var s = String(po.status || '').toLowerCase();
    if (s === 'received' || s === 'fully received' || s === 'completed') {
      showAlert('warning', 'Completed purchase orders cannot be cancelled.');
      return;
    }
  }

  if (!confirm('Are you sure you want to cancel ' + code + '? This action cannot be undone.')) {
    return;
  }

  try {
    var res = await axios.put(API + 'purchase_order.php', {
      action: 'cancel',
      po_id: poId,
      reason: 'Cancelled by Purchasing Officer'
    });

    if (res.data && res.data.success) {
      showAlert('success', code + ' has been cancelled.');

      // Hide detail modal if open
      var modalEl = document.getElementById('poDetailModal');
      if (modalEl) {
        var bsModal = bootstrap.Modal.getInstance(modalEl);
        if (bsModal) bsModal.hide();
      }

      loadPurchaseOrders();
    } else {
      showAlert('danger', (res.data && res.data.message) ? res.data.message : 'Could not cancel purchase order.');
    }
  } catch (err) {
    console.error('Error cancelling PO:', err);
    showAlert('danger', 'Failed to cancel purchase order.');
  }
}

// =========================================================================
// PHASE 8: DELIVERY TRACKING & RECEIPT VIEWING
// =========================================================================
function openPoDeliveryTracking(poId) {
  var po = poAllPosCache.find(function (p) { return p.po_id == poId; });
  if (!po) return;

  var code = escapeHtml(po.po_code || ('PO-' + String(poId).padStart(5, '0')));
  var supp = escapeHtml(po.supplier_name || '—');
  var eta = formatDateDisplay(po.expected_date || po.order_date);

  var elCode = document.getElementById('trackPoCode');
  var elStatus = document.getElementById('trackPoStatus');
  var elSupp = document.getElementById('trackPoSupplier');
  var elEta = document.getElementById('trackPoEta');

  if (elCode) elCode.textContent = code;
  if (elStatus) elStatus.textContent = po.receiving_status || po.status || 'In Transit';
  if (elSupp) elSupp.textContent = supp;
  if (elEta) elEta.textContent = eta;

  var container = document.getElementById('trackPoMilestones');
  if (container) {
    container.innerHTML = '' +
      '<div class="d-flex align-items-center gap-2 small text-success"><i class="bi bi-check-circle-fill"></i><strong>Order Confirmed &amp; Issued:</strong> ' + formatDateDisplay(po.order_date || po.created_at) + '</div>' +
      '<div class="d-flex align-items-center gap-2 small text-primary"><i class="bi bi-truck"></i><strong>In Transit with Supplier Freight:</strong> Dispatch recorded</div>' +
      '<div class="d-flex align-items-center gap-2 small text-muted"><i class="bi bi-circle"></i><strong>Warehouse Dock Receiving:</strong> Scheduled on ' + eta + '</div>';
  }

  var modalEl = document.getElementById('poDeliveryTrackingModal');
  if (modalEl) {
    var bsModal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    bsModal.show();
  }
}

function viewPoReceipt(poId) {
  var po = poAllPosCache.find(function (p) { return p.po_id == poId; });
  if (!po) po = { po_id: poId };

  // Use global app receipt modal if defined
  if (typeof openReceiptModal === 'function') {
    openReceiptModal('purchase_order', po);
  } else {
    showAlert('info', 'Viewing transaction receipt for PO-' + poId);
  }
}

// =========================================================================
// PHASE 4: FULL REPLENISHMENT MODAL (ITEMS TO REORDER)
// =========================================================================
function openPoItemsToReorderModal() {
  populateCategoryDropdown();
  renderPoReplenishModalTable();

  var modalEl = document.getElementById('poReplenishmentModal');
  if (modalEl) {
    var bsModal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    bsModal.show();
  }
}

function renderPoReplenishModalTable() {
  var tbody = document.getElementById('poReplenishModalTableBody');
  var countInfo = document.getElementById('poReplenishModalCountInfo');
  if (!tbody) return;

  var items = getPoReplenishmentItems();
  var q = (document.getElementById('poReplenishModalSearch') ? document.getElementById('poReplenishModalSearch').value : '').toLowerCase().trim();
  var cat = (document.getElementById('poReplenishModalCategoryFilter') ? document.getElementById('poReplenishModalCategoryFilter').value : 'all');

  var filtered = items.filter(function (it) {
    var name = (it.product_name || '').toLowerCase();
    var supp = (it.supplier_name || '').toLowerCase();
    var matchesQ = !q || name.indexOf(q) !== -1 || supp.indexOf(q) !== -1 || String(it.product_id).indexOf(q) !== -1;
    var matchesCat = (cat === 'all') || (it.category_name === cat);
    return matchesQ && matchesCat;
  });

  if (countInfo) countInfo.textContent = 'Showing ' + filtered.length + ' of ' + items.length + ' products';

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-4 small">No replenishment candidates matching criteria.</td></tr>';
    return;
  }

  var html = '';
  filtered.forEach(function (it) {
    var pid = it.product_id;
    var name = escapeHtml(it.product_name);
    var unit = escapeHtml(it.unit_measure || 'Unit');
    var maxS = parseInt(it.max_stock || 100, 10);
    var avail = parseInt(it.available_stock !== undefined ? it.available_stock : (it.usable_stock || 0), 10);
    var reorder = parseInt(it.reorder_level !== undefined ? it.reorder_level : (it.reorder_threshold || 10), 10);
    var outPo = parseInt(it.outstanding_po_qty || it.on_order_qty || 0, 10);
    var sug = parseInt(it.suggested_order_qty || it.net_suggested_order_qty || Math.max(1, maxS - avail), 10);
    var supp = escapeHtml(it.supplier_name || '—');
    var cost = formatMoney(it.supplier_unit_cost || it.unit_cost || 0);
    var statusBadge = avail <= 0
      ? '<span class="badge bg-danger-subtle text-danger border border-danger-subtle" style="font-size: 10px; padding: 1px 6px;">Out of Stock</span>'
      : (avail <= reorder ? '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle" style="font-size: 10px; padding: 1px 6px;">Low Stock</span>' : '');

    html += '<tr>' +
      '<td class="ps-3">' +
        '<div class="d-flex align-items-center">' +
          '<span class="po-product-thumb me-2"><i class="bi ' + getProductIconClass(it.category_name) + '"></i></span>' +
          '<div>' +
            '<div class="fw-semibold text-dark">' + name + '</div>' +
            (statusBadge ? '<div class="d-flex align-items-center mt-0.5">' + statusBadge + '</div>' : '') +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td class="text-center small text-muted">' + unit + '</td>' +
      '<td class="text-center font-monospace">' + maxS + '</td>' +
      '<td class="text-center font-monospace ' + (avail <= 0 ? 'text-danger fw-bold' : 'text-dark') + '">' + avail + '</td>' +
      '<td class="text-center font-monospace text-muted">' + reorder + '</td>' +
      '<td class="text-center font-monospace text-info">' + outPo + '</td>' +
      '<td class="text-center font-monospace fw-bold text-primary">' + sug + '</td>' +
      '<td class="small text-secondary text-truncate" style="max-width: 140px;" title="' + supp + '">' + supp + '</td>' +
      '<td class="text-end font-monospace">&#8369;' + cost + '</td>' +
      '<td class="text-end pe-3">' +
        '<button type="button" class="po-btn-icon po-btn-icon-blue" onclick="handleAddToPoFromModal(' + pid + ')" title="Add to Purchase Order" aria-label="Add to Purchase Order">' +
          '<i class="bi bi-cart-plus"></i>' +
        '</button>' +
      '</td>' +
    '</tr>';
  });

  tbody.innerHTML = html;
  initPoTooltips();
}

function handlePoReplenishModalFilter() {
  renderPoReplenishModalTable();
}

function handleAddToPoFromModal(productId) {
  // Hide replenishment modal
  var modalEl = document.getElementById('poReplenishmentModal');
  if (modalEl) {
    var bsModal = bootstrap.Modal.getInstance(modalEl);
    if (bsModal) bsModal.hide();
  }

  handleAddToPo(productId);
}

// =========================================================================
// PHASE 3 & 7: FILTERED PURCHASE ORDERS LIST MODAL
// =========================================================================
function openPoFilteredModal(statusFilter, titleText) {
  var titleEl = document.getElementById('poFilteredListModalTitle');
  if (titleEl) titleEl.textContent = titleText || 'Purchase Orders';

  var statusSel = document.getElementById('poFilteredModalStatusFilter');
  if (statusSel) {
    if (statusFilter && statusFilter !== 'all') {
      statusSel.value = statusFilter;
    } else {
      statusSel.value = 'all';
    }
  }

  renderPoFilteredModalTable();

  var modalEl = document.getElementById('poFilteredListModal');
  if (modalEl) {
    var bsModal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    bsModal.show();
  }
}

function renderPoFilteredModalTable() {
  var tbody = document.getElementById('poFilteredModalTableBody');
  var countInfo = document.getElementById('poFilteredModalPaginationInfo');
  if (!tbody) return;

  var q = (document.getElementById('poFilteredModalSearch') ? document.getElementById('poFilteredModalSearch').value : '').toLowerCase().trim();
  var status = (document.getElementById('poFilteredModalStatusFilter') ? document.getElementById('poFilteredModalStatusFilter').value : 'all');
  var supplier = (document.getElementById('poFilteredModalSupplierFilter') ? document.getElementById('poFilteredModalSupplierFilter').value : 'all');

  var filtered = poAllPosCache.filter(function (po) {
    var poCode = (po.po_code || ('PO-' + po.po_id)).toLowerCase();
    var sName = (po.supplier_name || '').toLowerCase();
    var matchesQ = !q || poCode.indexOf(q) !== -1 || sName.indexOf(q) !== -1;

    var matchesStatus = true;
    if (status !== 'all') {
      var s = String(po.status || '').toLowerCase();
      var filterLower = status.toLowerCase();
      if (filterLower.indexOf('pending') !== -1) {
        matchesStatus = s.indexOf('pending') !== -1 || s === 'draft';
      } else if (filterLower.indexOf('ordered') !== -1 || filterLower.indexOf('approved') !== -1) {
        matchesStatus = s === 'ordered' || s === 'issued';
      } else if (filterLower.indexOf('transit') !== -1) {
        matchesStatus = s.indexOf('transit') !== -1 || String(po.receiving_status || '').toLowerCase().indexOf('transit') !== -1;
      } else if (filterLower === 'received' || filterLower === 'completed') {
        matchesStatus = s === 'received' || s === 'fully received' || s === 'completed';
      } else if (filterLower === 'cancelled') {
        matchesStatus = s === 'cancelled';
      } else {
        matchesStatus = s === filterLower;
      }
    }

    var matchesSupplier = (supplier === 'all') || (String(po.supplier_id) === String(supplier));

    return matchesQ && matchesStatus && matchesSupplier;
  });

  if (countInfo) countInfo.textContent = 'Showing ' + filtered.length + ' of ' + poAllPosCache.length + ' orders';

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4 small">No purchase orders found matching selected filters.</td></tr>';
    return;
  }

  var html = '';
  filtered.forEach(function (po) {
    var poId = po.po_id;
    var poCode = escapeHtml(po.po_code || ('PO-' + String(poId).padStart(5, '0')));
    var supplier = escapeHtml(po.supplier_name || '—');
    var itemsCount = parseInt(po.total_ordered_qty || po.items_cnt || 1, 10);
    var cost = formatMoney(po.total_cost || po.total_amount || 0);
    var created = formatDateDisplay(po.order_date || po.created_at);
    var eta = po.expected_date ? formatDateDisplay(po.expected_date) : '—';

    html += '<tr>' +
      '<td class="ps-3 font-monospace fw-bold text-dark">' + poCode + '</td>' +
      '<td class="fw-semibold text-truncate" style="max-width: 140px;" title="' + supplier + '">' + supplier + '</td>' +
      '<td class="text-center">' + itemsCount + '</td>' +
      '<td class="text-end font-monospace fw-semibold text-dark">&#8369;' + cost + '</td>' +
      '<td class="text-muted small">' + created + '</td>' +
      '<td class="text-muted small">' + eta + '</td>' +
      '<td class="text-center">' + poStatusBadgeHtml(po.status) + '</td>' +
      '<td class="text-end pe-3 text-nowrap">' +
        '<div class="d-inline-flex gap-1">' +
          '<button type="button" class="po-btn-icon po-btn-icon-blue" onclick="openPoDetailModal(' + poId + ')" title="View PO Details" aria-label="View PO Details">' +
            '<i class="bi bi-eye"></i>' +
          '</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  });

  tbody.innerHTML = html;
  initPoTooltips();
}

function handlePoFilteredModalFilter() {
  renderPoFilteredModalTable();
}

// =========================================================================
// ADVANCED FILTER MODAL
// =========================================================================
function applyPoAdvancedFilters() {
  var supp = document.getElementById('advFilterSupplier') ? document.getElementById('advFilterSupplier').value : 'all';
  var status = document.getElementById('advFilterStatus') ? document.getElementById('advFilterStatus').value : 'all';

  var modalEl = document.getElementById('poFilterModal');
  if (modalEl) {
    var bsModal = bootstrap.Modal.getInstance(modalEl);
    if (bsModal) bsModal.hide();
  }

  openPoFilteredModal(status, 'Filtered Purchase Orders');
  var suppSel = document.getElementById('poFilteredModalSupplierFilter');
  if (suppSel) {
    suppSel.value = supp;
    renderPoFilteredModalTable();
  }
}

function resetPoAdvancedFilters() {
  var s1 = document.getElementById('advFilterSupplier');
  var s2 = document.getElementById('advFilterStatus');
  var d1 = document.getElementById('advFilterStartDate');
  var d2 = document.getElementById('advFilterEndDate');

  if (s1) s1.value = 'all';
  if (s2) s2.value = 'all';
  if (d1) d1.value = '';
  if (d2) d2.value = '';
}

// Compatibility aliases for legacy calls from other modules
var openCreateIndependentPo = function () { openCreatePoWizard('Independent'); };
var openCreatePoForPr = function (prId) { openCreatePoWizard('PR-Linked'); };
