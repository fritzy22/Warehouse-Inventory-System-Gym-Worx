let prCache = [];
let prSuggestionsCache = [];
let currentPrStatusFilter = '';
let prLineItems = [];
let currentApprovePrData = null;
let poApprovalCache = [];
let currentPrClientToken = '';
let prSubmitting = false;

function generatePrClientToken() {
  return 'pr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
}

function renderUrgencyBadge(urgency) {
  const u = (urgency || 'Normal').trim();
  const low = u.toLowerCase();
  if (low === 'urgent' || low === 'critical') {
    return `<span class="badge bg-danger text-white">${escapeHtml(u)}</span>`;
  }
  if (low === 'high') {
    return `<span class="badge bg-warning text-dark">${escapeHtml(u)}</span>`;
  }
  if (low === 'low') {
    return `<span class="badge bg-secondary-subtle text-secondary border">${escapeHtml(u)}</span>`;
  }
  return `<span class="badge bg-info-subtle text-info-emphasis border">${escapeHtml(u)}</span>`;
}

function renderApprovalStatusBadge(approvalStatus, rawStatus) {
  const st = approvalStatus || (
    rawStatus === 'Draft' ? 'Draft' :
    (rawStatus === 'Pending' || rawStatus === 'Pending Approval') ? 'Pending Approval' :
    (rawStatus === 'For Revision' || rawStatus === 'Returned for Revision') ? 'Returned for Revision' :
    ['Approved', 'Partially Ordered', 'Ordered', 'Partially Received', 'Completed'].includes(rawStatus) ? 'Approved' :
    rawStatus || 'Pending Approval'
  );
  if (st === 'Draft') {
    return `<span class="gym-status gym-status--draft"><i class="bi bi-file-earmark-text"></i>Draft</span>`;
  }
  if (st === 'Pending Approval' || st === 'Pending') {
    return `<span class="gym-status gym-status--pending-approval"><i class="bi bi-hourglass-split"></i>Pending Approval</span>`;
  }
  if (st === 'Returned for Revision' || st === 'For Revision') {
    return `<span class="gym-status gym-status--returned-for-revision"><i class="bi bi-arrow-counterclockwise"></i>Returned for Revision</span>`;
  }
  if (st === 'Approved') {
    return `<span class="gym-status gym-status--approved"><i class="bi bi-check-circle-fill"></i>Approved</span>`;
  }
  if (st === 'Rejected') {
    return `<span class="gym-status gym-status--rejected"><i class="bi bi-x-circle-fill"></i>Rejected</span>`;
  }
  if (st === 'Cancelled') {
    return `<span class="gym-status gym-status--cancelled"><i class="bi bi-x-circle"></i>Cancelled</span>`;
  }
  if (st === 'Ordering' || st === 'Ordered') {
    return `<span class="gym-status gym-status--ordering"><i class="bi bi-info-circle-fill"></i>Ordering</span>`;
  }
  return `<span class="gym-status"><i class="bi bi-circle"></i>${escapeHtml(st)}</span>`;
}

function renderFulfillmentStatusBadge(fulfillmentStatus, rawStatus) {
  const fst = fulfillmentStatus || (
    rawStatus === 'Draft' ? 'Draft' :
    (rawStatus === 'Pending' || rawStatus === 'Pending Approval') ? 'Awaiting Approval' :
    (rawStatus === 'For Revision' || rawStatus === 'Returned for Revision') ? 'Awaiting Revision' :
    rawStatus === 'Approved' ? 'Pending Fulfillment' :
    (rawStatus === 'Ordered' || rawStatus === 'Partially Ordered') ? 'Ordering' :
    rawStatus === 'Partially Received' ? 'Fulfilled' :
    rawStatus === 'Completed' ? 'Fulfilled' :
    rawStatus === 'Rejected' ? 'Not Fulfilled' :
    rawStatus === 'Cancelled' ? 'Cancelled' : 'Not Fulfilled'
  );
  if (fst === 'Fulfilled') {
    return `<span class="gym-status gym-status--fulfilled"><i class="bi bi-check-circle-fill"></i>Fulfilled</span>`;
  }
  if (fst === 'Pending Fulfillment') {
    return `<span class="gym-status gym-status--pending-fulfillment"><i class="bi bi-check-circle"></i>Pending Fulfillment</span>`;
  }
  if (fst === 'Partially Fulfilled') {
    return `<span class="gym-status gym-status--fulfilled"><i class="bi bi-truck"></i>Partially Fulfilled</span>`;
  }
  if (fst === 'Reserved') {
    return `<span class="gym-status gym-status--approved"><i class="bi bi-bookmark-check"></i>Reserved</span>`;
  }
  if (fst === 'Ordering' || fst === 'On Order') {
    return `<span class="gym-status gym-status--ordering"><i class="bi bi-info-circle-fill"></i>Ordering</span>`;
  }
  if (fst === 'Not Fulfilled') {
    return `<span class="gym-status gym-status--not-fulfilled"><i class="bi bi-dash-circle"></i>Not Fulfilled</span>`;
  }
  if (fst === 'Cancelled') {
    return `<span class="gym-status gym-status--cancelled"><i class="bi bi-x-circle"></i>Cancelled</span>`;
  }
  if (fst === 'Awaiting Approval') {
    return `<span class="gym-status gym-status--pending-approval"><i class="bi bi-hourglass-split"></i>Awaiting Approval</span>`;
  }
  if (fst === 'Awaiting Revision') {
    return `<span class="gym-status gym-status--returned-for-revision"><i class="bi bi-arrow-counterclockwise"></i>Awaiting Revision</span>`;
  }
  return `<span class="gym-status gym-status--not-fulfilled"><i class="bi bi-dash-circle"></i>${escapeHtml(fst)}</span>`;
}

async function loadPoApprovalQueue() {
  const card = document.getElementById('poApprovalQueueCard');
  const tbody = document.getElementById('poApprovalQueueTable');
  const badge = document.getElementById('poApprovalQueueBadge');
  if (!card || !tbody) return;

  const isApprovalView = (sessionStorage.getItem('activeTab') === 'request_approval') || can('request_approval', 'manage');
  if (!isApprovalView) {
    card.hidden = true;
    return;
  }

  try {
    const res = await axios.get(API + 'purchase_order.php?mode=pending_approval');
    if (res.status === 200 && res.data && res.data.success) {
      poApprovalCache = res.data.data || [];
    } else {
      poApprovalCache = [];
    }
  } catch (err) {
    poApprovalCache = [];
  }

  if (badge) {
    badge.textContent = `${poApprovalCache.length} pending`;
  }

  // Show card if on Manager Approval Queue or if there are pending POs
  card.hidden = (sessionStorage.getItem('activeTab') !== 'request_approval' && poApprovalCache.length === 0);

  if (poApprovalCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3 fst-italic">No replenishment purchase orders currently awaiting approval.</td></tr>';
  } else {
    tbody.innerHTML = poApprovalCache.map(po => `
      <tr>
        <td class="font-monospace fw-bold">${escapeHtml(po.po_code)}</td>
        <td class="fw-medium">${escapeHtml(po.supplier_name)}</td>
        <td>${escapeHtml(po.ordered_by || '—')}</td>
        <td class="small text-muted">${escapeHtml(po.order_date || '')}</td>
        <td class="font-monospace">${po.item_count || 1} items (${po.total_ordered_qty || 0} units)</td>
        <td class="font-monospace fw-semibold">${peso(po.total_cost || 0)}</td>
        <td class="text-end text-nowrap">
          <button type="button" class="btn btn-sm btn-outline-secondary py-0.5 px-2 me-1" onclick="viewPurchaseOrderDetails(${po.po_id})" title="Inspect PO Line Items"><i class="bi bi-eye me-1"></i>Review</button>
          <button type="button" class="btn btn-sm btn-outline-danger py-0.5 px-2 me-1" onclick="rejectPurchaseOrder(${po.po_id})" title="Reject PO"><i class="bi bi-x me-1"></i>Reject</button>
          <button type="button" class="btn btn-sm btn-success py-0.5 px-2" onclick="approvePurchaseOrder(${po.po_id})" title="Approve PO"><i class="bi bi-check2 me-1"></i>Approve</button>
        </td>
      </tr>
    `).join('');
  }

  // Update total sidebar badge
  const sbApprove = document.getElementById('sidebarApprovalBadge');
  if (sbApprove) {
    const pendingPrCount = prCache.filter(r => isPrPendingStatus(r.status)).length;
    const totalPending = pendingPrCount + poApprovalCache.length;
    sbApprove.textContent = totalPending;
    sbApprove.hidden = totalPending <= 0;
  }
  if (typeof updateAggregatedBadges === 'function') updateAggregatedBadges();
}

async function loadPurchaseRequests(filterOverride) {
  if (typeof filterOverride === 'string') {
    currentPrStatusFilter = filterOverride;
  }

  const res = await axios.get(API + 'purchase_request.php?mode=all');
  if (res.status !== 200 || !res.data || !res.data.success) {
    showToast((res.data && res.data.message) || 'Failed to load purchase requests', true);
    return;
  }

  prCache = res.data.data || [];
  updatePrFilterCounts();
  filterPurchaseRequestsByStatus(currentPrStatusFilter);

  // Load pending POs awaiting approval for Managers
  if (typeof loadPoApprovalQueue === 'function') {
    loadPoApprovalQueue();
  }
}

function isPrPendingStatus(st) {
  return st === 'Pending' || st === 'Pending Approval';
}

function updatePrFilterCounts() {
  const draftCount = prCache.filter(r => r.status === 'Draft').length;
  const pendingCount = prCache.filter(r => isPrPendingStatus(r.status)).length;
  const revisionCount = prCache.filter(r => r.status === 'For Revision' || r.approval_status === 'Returned for Revision').length;
  const approvedCount = prCache.filter(r => r.status === 'Approved').length;

  const dEl = document.getElementById('prCountDraft');
  const pEl = document.getElementById('prCountPending');
  const rEl = document.getElementById('prCountRevision');
  const aEl = document.getElementById('prCountApproved');
  if (dEl) dEl.textContent = draftCount;
  if (pEl) pEl.textContent = pendingCount;
  if (rEl) rEl.textContent = revisionCount;
  if (aEl) aEl.textContent = approvedCount;

  const sbApprove = document.getElementById('sidebarApprovalBadge');
  if (sbApprove) {
    const totalCount = pendingCount + (poApprovalCache ? poApprovalCache.length : 0);
    sbApprove.textContent = totalCount;
    sbApprove.hidden = totalCount <= 0;
  }
  if (typeof updateAggregatedBadges === 'function') updateAggregatedBadges();
}

function filterPurchaseRequestsByStatus(status) {
  currentPrStatusFilter = status || '';
  const btns = document.querySelectorAll('#prStatusFilterGroup [data-pr-status]');
  btns.forEach(function (b) {
    const bSt = b.getAttribute('data-pr-status');
    const isAct = bSt === currentPrStatusFilter || (isPrPendingStatus(bSt) && isPrPendingStatus(currentPrStatusFilter));
    b.className = isAct ? 'btn btn-sm btn-dark text-nowrap' : 'btn btn-sm btn-outline-secondary text-nowrap';
  });

  let rows = prCache.slice();
  if (currentPrStatusFilter === 'in_progress') {
    rows = rows.filter(r => ['Partially Ordered', 'Ordered', 'Partially Received'].includes(r.status));
  } else if (isPrPendingStatus(currentPrStatusFilter)) {
    rows = rows.filter(r => isPrPendingStatus(r.status));
  } else if (currentPrStatusFilter === 'For Revision' || currentPrStatusFilter === 'Returned for Revision') {
    rows = rows.filter(r => r.status === 'For Revision' || r.approval_status === 'Returned for Revision');
  } else if (currentPrStatusFilter !== '') {
    rows = rows.filter(r => r.status === currentPrStatusFilter);
  }

  renderPurchaseRequestsTable(rows);
}

function renderPurchaseRequestsTable(rows) {
  const body = document.getElementById('prTable');
  const mobileList = document.getElementById('prMobileList');
  if (!body && !mobileList) return;

  if (!rows || rows.length === 0) {
    if (body) renderEmptyRow(body, 'No purchase requests match this filter.', 7);
    if (mobileList) {
      mobileList.innerHTML = '<div class="p-4 text-center text-muted fst-italic">No purchase requests match this filter.</div>';
    }
    if (window.TableTools) TableTools.enhance('prTable', { searchPlaceholder: 'Search PR number, requester, status...', showToolbar: false });
    return;
  }

  if (body) {
    body.innerHTML = '';
    const canApprove = can('request_approval', 'manage');
    const canCreatePo = can('purchase_order', 'manage');
    const currentUserId = authUser ? parseInt(authUser.user_id) : 0;

    rows.forEach(function (r) {
      const tr = document.createElement('tr');
      const prCode = r.pr_code || ('PR-' + String(r.pr_id).padStart(4, '0'));
      const reqQty = parseInt(r.total_requested_qty) || 0;
      const appQty = r.approved_qty !== null && r.approved_qty !== undefined && parseInt(r.approved_qty) > 0
        ? parseInt(r.approved_qty)
        : (r.total_approved_qty !== null && r.total_approved_qty !== undefined && ['Approved', 'Partially Ordered', 'Ordered', 'Partially Received', 'Completed'].includes(r.status) ? parseInt(r.total_approved_qty) : null);
      const outQty = r.outstanding_qty !== undefined ? parseInt(r.outstanding_qty) : reqQty;

      const qtyDisplay = appQty !== null
        ? `<span class="fw-bold text-primary">${appQty}</span> <span class="text-muted small">(req ${reqQty}, out ${outQty})</span>`
        : `<span class="fw-semibold">${reqQty}</span>`;

      const purposeText = r.purpose || r.remarks || r.reason || '—';
      const commentSnippet = r.rejection_reason || r.manager_comment || '';
      const isOwner = parseInt(r.requester_id) === currentUserId;

      let actionsHtml = `
        <button type="button" class="btn btn-sm btn-outline-success me-1" onclick="viewPurchaseRequestDetails(${r.pr_id})" title="View Request & Tracking">
          <i class="bi bi-eye me-1"></i>View
        </button>
      `;

      if (canApprove && isPrPendingStatus(r.status) && !isOwner) {
        actionsHtml += `
          <button type="button" class="btn btn-sm btn-warning text-dark fw-semibold me-1" onclick="openApprovePrModal(${r.pr_id})" title="Review & Decide">
            <i class="bi bi-check2-square me-1"></i>Review
          </button>
        `;
      }

      if (canCreatePo && ['Approved', 'Partially Ordered'].includes(r.status)) {
        actionsHtml += `
          <button type="button" class="btn btn-sm btn-primary me-1" onclick="openCreatePoFromPr(${r.pr_id})" title="Create Purchase Order">
            <i class="bi bi-cart-plus me-1"></i>Create PO
          </button>
        `;
      }

      if (isOwner && can('purchase_request', 'manage')) {
        if (r.status === 'Draft') {
          actionsHtml += `
            <button type="button" class="btn btn-sm btn-dark me-1" onclick="submitDraftPurchaseRequest(${r.pr_id})" title="Submit Draft for Approval">
              <i class="bi bi-send me-1"></i>Submit
            </button>
          `;
        }
        if (r.status === 'Draft' || isPrPendingStatus(r.status) || r.status === 'For Revision') {
          actionsHtml += `
            <button type="button" class="btn btn-sm btn-outline-dark me-1" onclick="editPurchaseRequest(${r.pr_id})" title="${r.status === 'For Revision' ? 'Revise & Resubmit' : 'Edit Request'}">
              <i class="bi bi-pencil"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline-danger" onclick="cancelPurchaseRequest(${r.pr_id})" title="Cancel Request">
              <i class="bi bi-x-circle"></i>
            </button>
          `;
        }
      }

      tr.innerHTML = `
        <td class="font-monospace fw-bold">${escapeHtml(prCode)}</td>
        <td>
          <div class="fw-semibold">${escapeHtml(r.requested_by_name || '—')}</div>
          ${(r.role_name || r.requester_role) ? `<div class="text-muted" style="font-size:0.72rem;">${escapeHtml(r.role_name || r.requester_role)}</div>` : ''}
        </td>
        <td class="small">
          <div class="text-muted">${escapeHtml(r.request_date || '')}</div>
          <div class="mt-0.5">${renderUrgencyBadge(r.urgency || 'Normal')}</div>
        </td>
        <td class="font-monospace">${r.item_count || 0} items &bull; ${qtyDisplay}</td>
        <td>
          <div class="mb-1">${renderApprovalStatusBadge(r.approval_status, r.status)}</div>
          <div>${renderFulfillmentStatusBadge(r.fulfillment_status, r.status)}</div>
        </td>
        <td class="small text-muted" style="max-width:240px;">
          <div class="fw-medium text-dark text-truncate" title="${escapeHtml(purposeText)}">${escapeHtml(purposeText)}</div>
          ${commentSnippet ? `<div class="text-warning-emphasis text-truncate" title="${escapeHtml(commentSnippet)}"><i class="bi bi-chat-left-text me-1"></i>${escapeHtml(commentSnippet)}</div>` : ''}
          ${r.approved_by_name ? `<div class="text-secondary" style="font-size:0.72rem;">Reviewed by ${escapeHtml(r.approved_by_name)}</div>` : ''}
        </td>
        <td class="text-end text-nowrap">${actionsHtml}</td>
      `;
      body.appendChild(tr);
    });
  }

  if (mobileList) {
    mobileList.innerHTML = rows.map(function (r) {
      const prCode = r.pr_code || ('PR-' + String(r.pr_id).padStart(4, '0'));
      return `
        <div class="card mb-2 shadow-sm border gw-mobile-card-item">
          <div class="card-body p-3 d-flex justify-content-between align-items-center gap-2">
            <div class="overflow-hidden" style="min-width:0;">
              <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
                <span class="font-monospace fw-bold text-dark fs-6">${escapeHtml(prCode)}</span>
                ${renderUrgencyBadge(r.urgency || 'Normal')}
                <span class="text-muted small text-truncate">&bull; ${escapeHtml(r.requested_by_name || '—')}</span>
              </div>
              <div class="d-flex align-items-center gap-1 flex-wrap">
                ${renderApprovalStatusBadge(r.approval_status, r.status)}
                ${renderFulfillmentStatusBadge(r.fulfillment_status, r.status)}
              </div>
            </div>
            <div class="flex-shrink-0">
              <button type="button" class="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1 px-3 py-1 fw-semibold" onclick="viewPurchaseRequestDetails(${r.pr_id})">
                <i class="bi bi-eye"></i><span>View</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.TableTools) {
    TableTools.enhance('prTable', { searchPlaceholder: 'Search PR number, requester, status...', showToolbar: false });
  }
}

async function loadPrSuggestions() {
  const res = await axios.get(API + 'purchase_request.php?mode=suggestions');
  if (res.status === 200 && res.data && res.data.success) {
    prSuggestionsCache = res.data.data || [];
    cache.products = prSuggestionsCache;
  } else {
    await ensureMasterDataLoaded(false);
    prSuggestionsCache = cache.products || [];
  }
  renderPrSuggestionsHelper();
  populatePrProductDropdown();
}

function populatePrProductDropdown() {
  const sel = document.getElementById('pr_item_product');
  if (!sel) return;
  const list = (prSuggestionsCache && prSuggestionsCache.length > 0) ? prSuggestionsCache : (cache && cache.products ? cache.products : []);
  const active = list.filter(p => parseInt(p.is_active) === 1);
  sel.innerHTML = '<option value="">-- Select Product --</option>' + active.map(function (p) {
    const avail = parseInt(p.available_stock !== undefined ? p.available_stock : p.stock_qty) || 0;
    const maxS = parseInt(p.max_stock) || 100;
    const sug = parseInt(p.suggested_order_qty) || Math.max(0, maxS - avail);
    return `<option value="${p.product_id}">${escapeHtml(p.product_name)} (Stock: ${avail}/${maxS}, Suggested: ${sug})</option>`;
  }).join('');
}

function renderPrSuggestionsHelper() {
  const tbody = document.getElementById('prSuggestionsTable');
  if (!tbody) return;

  const candidates = (prSuggestionsCache || []).filter(function (p) {
    return parseInt(p.is_active) === 1 && (parseInt(p.suggested_order_qty) > 0 || Boolean(p.is_below_reorder));
  });

  if (candidates.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-2 fst-italic">All products are currently at maximum stock capacity.</td></tr>';
    return;
  }

  tbody.innerHTML = candidates.map(function (p) {
    const avail = parseInt(p.available_stock) || 0;
    const maxS = parseInt(p.max_stock) || 100;
    const reord = parseInt(p.reorder_level) || 10;
    const onOrd = parseInt(p.outstanding_replenishment) || 0;
    const sug = parseInt(p.suggested_order_qty) || 0;
    const addNeeded = parseInt(p.additional_needed_qty) || 0;
    const defaultAddQty = addNeeded > 0 ? addNeeded : sug;

    return `
      <tr>
        <td class="fw-semibold small">${escapeHtml(p.product_name)}</td>
        <td class="text-center font-monospace ${avail <= reord ? 'text-danger fw-bold' : ''}">${avail}</td>
        <td class="text-center font-monospace text-muted">${maxS}</td>
        <td class="text-center font-monospace text-muted">${reord}</td>
        <td class="text-center font-monospace">${onOrd}</td>
        <td class="text-center font-monospace fw-bold text-primary">${sug}</td>
        <td class="text-center font-monospace fw-bold">${addNeeded}</td>
        <td class="text-end">
          ${defaultAddQty > 0
            ? `<button type="button" class="btn btn-sm btn-outline-primary py-0 px-2" onclick="quickAddSuggestedPrItem(${p.product_id}, ${defaultAddQty})">+ Add (${defaultAddQty})</button>`
            : `<span class="badge bg-secondary-subtle text-secondary border">On Order</span>`}
        </td>
      </tr>
    `;
  }).join('');
}

function togglePrSuggestionsPanel() {
  const card = document.getElementById('prSuggestionsCard');
  if (card) card.hidden = !card.hidden;
}

function handlePrProductSelectChange() {
  const sel = document.getElementById('pr_item_product');
  const qtyInput = document.getElementById('pr_item_qty');
  if (!sel || !sel.value) {
    updatePrItemExcessHint();
    return;
  }

  const list = (prSuggestionsCache && prSuggestionsCache.length > 0) ? prSuggestionsCache : (cache && cache.products ? cache.products : []);
  const p = findById(list, 'product_id', sel.value);
  if (!p) return;

  const avail = parseInt(p.available_stock !== undefined ? p.available_stock : p.stock_qty) || 0;
  const maxS = parseInt(p.max_stock) || 100;
  const onOrd = parseInt(p.outstanding_replenishment) || 0;
  const sug = parseInt(p.suggested_order_qty) || Math.max(0, maxS - avail);
  const addNeeded = parseInt(p.additional_needed_qty !== undefined ? p.additional_needed_qty : Math.max(0, sug - onOrd)) || 0;

  if (qtyInput) {
    qtyInput.value = addNeeded > 0 ? addNeeded : (sug > 0 ? sug : 1);
    if (!qtyInput.dataset.hasExcessListener) {
      qtyInput.dataset.hasExcessListener = 'true';
      qtyInput.addEventListener('input', updatePrItemExcessHint);
    }
  }

  updatePrItemExcessHint();
}

function updatePrItemExcessHint() {
  const sel = document.getElementById('pr_item_product');
  const qtyInput = document.getElementById('pr_item_qty');
  const hint = document.getElementById('prProductStockHint');
  const excessAlert = document.getElementById('prItemExcessWarning');
  const excessText = document.getElementById('prItemExcessWarningText');

  if (!sel || !sel.value) {
    if (hint) hint.textContent = 'Select a product to view available stock, maximum stock, and suggested order quantity.';
    if (excessAlert) excessAlert.hidden = true;
    return;
  }

  const list = (prSuggestionsCache && prSuggestionsCache.length > 0) ? prSuggestionsCache : (cache && cache.products ? cache.products : []);
  const p = findById(list, 'product_id', sel.value);
  if (!p) return;

  const avail = parseInt(p.available_stock !== undefined ? p.available_stock : p.stock_qty) || 0;
  const maxS = parseInt(p.max_stock) || 100;
  const onOrd = parseInt(p.outstanding_replenishment) || 0;
  const sug = parseInt(p.suggested_order_qty) || Math.max(0, maxS - avail);
  const addNeeded = parseInt(p.additional_needed_qty !== undefined ? p.additional_needed_qty : Math.max(0, sug - onOrd)) || 0;
  const qty = parseInt(qtyInput ? qtyInput.value : 0) || 0;

  if (hint) {
    let msg = `Available Stock: <strong>${avail}</strong> / Max Stock: <strong>${maxS}</strong> &bull; Suggested Order Qty: <strong class="text-primary">${sug}</strong>`;
    if (onOrd > 0) {
      msg += ` &bull; <span class="text-warning-emphasis">${onOrd} units already on active requests/orders (Additional Needed: <strong>${addNeeded}</strong>)</span>`;
    }
    if (avail >= maxS) {
      msg += ` &bull; <span class="text-danger fw-semibold">Note: Current stock is already at/above maximum capacity.</span>`;
    }
    hint.innerHTML = msg;
  }

  if (excessAlert && excessText) {
    if (qty > 0 && (avail + qty > maxS)) {
      const excess = (avail + qty) - maxS;
      excessText.innerHTML = `<strong>Capacity Notice:</strong> Requested <strong>${qty}</strong> + Current <strong>${avail}</strong> = <strong>${avail + qty} units</strong>. Exceeds max capacity (${maxS}) by <strong>+${excess}</strong> (Suggested: ${sug}). You may still request this amount, but you must provide a business justification for Manager approval.`;
      excessAlert.hidden = false;
    } else {
      excessAlert.hidden = true;
    }
  }
}

function quickAddSuggestedPrItem(productId, qty) {
  const p = findById(prSuggestionsCache, 'product_id', productId);
  if (!p) return;
  const existing = prLineItems.find(it => parseInt(it.product_id) === parseInt(productId));
  if (existing) {
    existing.requested_qty = parseInt(qty) || existing.requested_qty;
  } else {
    prLineItems.push({
      product_id: parseInt(productId),
      product_name: p.product_name,
      available_stock: parseInt(p.available_stock !== undefined ? p.available_stock : p.stock_qty) || 0,
      max_stock: parseInt(p.max_stock) || 100,
      suggested_order_qty: parseInt(p.suggested_order_qty) || 0,
      requested_qty: Math.max(1, parseInt(qty) || 1),
      notes: ''
    });
  }
  renderPrLineItemsTable();
}

function addAllLowStockSuggestionsToPr() {
  const lowItems = (prSuggestionsCache || []).filter(p => parseInt(p.is_active) === 1 && Boolean(p.is_below_reorder) && parseInt(p.additional_needed_qty) > 0);
  if (lowItems.length === 0) {
    showToast('No low-stock items with remaining replenishment need found.', true);
    return;
  }
  lowItems.forEach(p => {
    quickAddSuggestedPrItem(p.product_id, p.additional_needed_qty);
  });
  showToast(`Added ${lowItems.length} low-stock product(s) with suggested quantities.`);
}

function addPrLineItem() {
  const sel = document.getElementById('pr_item_product');
  const qtyInput = document.getElementById('pr_item_qty');
  const notesInput = document.getElementById('pr_item_notes');

  if (!sel || !sel.value) {
    showToast('Please select a product first.', true);
    return;
  }
  const qty = parseInt(qtyInput.value);
  if (!qty || qty <= 0) {
    showToast('Please enter a requested quantity greater than zero.', true);
    return;
  }

  const list = (prSuggestionsCache && prSuggestionsCache.length > 0) ? prSuggestionsCache : (cache && cache.products ? cache.products : []);
  const p = findById(list, 'product_id', sel.value);
  if (!p) return;

  const existing = prLineItems.find(it => parseInt(it.product_id) === parseInt(p.product_id));
  if (existing) {
    existing.requested_qty += qty;
    if (notesInput && notesInput.value.trim()) {
      existing.notes = notesInput.value.trim();
    }
  } else {
    prLineItems.push({
      product_id: parseInt(p.product_id),
      product_name: p.product_name,
      available_stock: parseInt(p.available_stock !== undefined ? p.available_stock : p.stock_qty) || 0,
      max_stock: parseInt(p.max_stock) || 100,
      suggested_order_qty: parseInt(p.suggested_order_qty) || 0,
      requested_qty: qty,
      notes: notesInput ? notesInput.value.trim() : ''
    });
  }

  sel.value = '';
  if (qtyInput) qtyInput.value = 1;
  if (notesInput) notesInput.value = '';
  renderPrLineItemsTable();
}

function removePrLineItem(index) {
  prLineItems.splice(index, 1);
  renderPrLineItemsTable();
}

let currentPrWizardStep = 1;

function goToPrWizardStep(step) {
  if (step === 2 || step === 3) {
    if (!prLineItems || prLineItems.length === 0) {
      showToast('Please add at least one product to the purchase request.', true);
      return;
    }
    for (let i = 0; i < prLineItems.length; i++) {
      if (!prLineItems[i].requested_qty || prLineItems[i].requested_qty <= 0) {
        showToast(`Enter a valid requested quantity greater than zero for "${prLineItems[i].product_name}".`, true);
        return;
      }
    }
  }

  const hasExcess = (prLineItems || []).some(it => (parseInt(it.available_stock) || 0) + (parseInt(it.requested_qty) || 0) > (parseInt(it.max_stock) || 100));

  if (step === 2) {
    const s2Alert = document.getElementById('prExcessStep2Alert');
    if (s2Alert) s2Alert.hidden = !hasExcess;
    updatePrStep2ReviewTable();
  }

  if (step === 3) {
    const purp = (document.getElementById('pr_purpose') ? document.getElementById('pr_purpose').value.trim() : '');
    const rem = (document.getElementById('pr_remarks') ? document.getElementById('pr_remarks').value.trim() : '');
    if (purp === '' && rem === '') {
      showToast('Please enter the Business Justification / Purpose before proceeding.', true);
      if (document.getElementById('pr_purpose')) document.getElementById('pr_purpose').focus();
      return;
    }
    if (hasExcess && purp.length < 8 && rem.length < 8) {
      showToast('This request exceeds maximum stock capacity. Please provide a clear Business Justification (at least 8 characters) explaining the reason.', true);
      if (document.getElementById('pr_purpose')) document.getElementById('pr_purpose').focus();
      return;
    }
    updatePrStep3Confirmation();
  }

  currentPrWizardStep = step;

  const s1 = document.getElementById('prWizardStep1');
  const s2 = document.getElementById('prWizardStep2');
  const s3 = document.getElementById('prWizardStep3');

  if (s1) s1.hidden = (step !== 1);
  if (s2) s2.hidden = (step !== 2);
  if (s3) s3.hidden = (step !== 3);

  for (let i = 1; i <= 3; i++) {
    const tab = document.getElementById('prStepTab' + i);
    const badge = document.getElementById('prStepBadge' + i);
    const label = document.getElementById('prStepLabel' + i);
    if (!tab) continue;

    if (i === step) {
      tab.className = 'd-flex align-items-center gap-2 pr-wizard-step-tab active';
      if (badge) badge.className = 'badge rounded-circle bg-primary text-white';
      if (label) label.className = 'small fw-bold text-dark';
    } else if (i < step) {
      tab.className = 'd-flex align-items-center gap-2 pr-wizard-step-tab done';
      if (badge) badge.className = 'badge rounded-circle bg-success text-white';
      if (label) label.className = 'small fw-semibold text-success';
    } else {
      tab.className = 'd-flex align-items-center gap-2 pr-wizard-step-tab';
      if (badge) badge.className = 'badge rounded-circle bg-secondary text-white';
      if (label) label.className = 'small fw-semibold text-muted';
    }
  }

  const prevBtn = document.getElementById('prWizardPrevBtn');
  const nextBtn = document.getElementById('prWizardNextBtn');
  const submitBtn = document.getElementById('prSubmitBtn');

  if (prevBtn) prevBtn.hidden = (step === 1);
  if (nextBtn) {
    nextBtn.hidden = (step === 3);
    nextBtn.textContent = (step === 1) ? 'Next: Review Details →' : 'Next: Confirm & Submit →';
  }
  if (submitBtn) submitBtn.hidden = (step !== 3);
}

function nextPrWizardStep() {
  if (currentPrWizardStep < 3) {
    goToPrWizardStep(currentPrWizardStep + 1);
  }
}

function prevPrWizardStep() {
  if (currentPrWizardStep > 1) {
    goToPrWizardStep(currentPrWizardStep - 1);
  }
}

function updatePrStep2ReviewTable() {
  const tbody = document.getElementById('prStep2ReviewItemsBody');
  const badge = document.getElementById('prAssignedBranchBadge');
  const assignedBranch = (typeof dashboardData !== 'undefined' && dashboardData && dashboardData.assigned_branch) ? dashboardData.assigned_branch : 'Main Store';
  if (badge) badge.textContent = assignedBranch;
  if (!tbody) return;
  tbody.innerHTML = prLineItems.map(function (it) {
    const avail = parseInt(it.available_stock) || 0;
    const maxS = parseInt(it.max_stock) || 100;
    const reqQ = parseInt(it.requested_qty) || 0;
    const isOver = (avail + reqQ) > maxS;
    const excess = isOver ? (avail + reqQ) - maxS : 0;
    return `
      <tr>
        <td class="fw-semibold text-dark">
          ${escapeHtml(it.product_name)}
          ${isOver ? `<div class="small text-warning-emphasis fw-semibold"><i class="bi bi-exclamation-triangle-fill text-warning me-1"></i>Exceeds Max Capacity (+${excess} surplus over max ${maxS})</div>` : ''}
        </td>
        <td class="text-center font-monospace fw-bold text-primary">
          ${reqQ}
          ${isOver ? `<span class="badge bg-warning-subtle text-warning-emphasis border border-warning ms-1" style="font-size:0.68rem;">+${excess} surplus</span>` : ''}
        </td>
        <td class="text-muted small">${escapeHtml(it.notes || '—')}</td>
      </tr>
    `;
  }).join('');
}

function updatePrStep3Confirmation() {
  const branchEl = document.getElementById('prConfirmBranch');
  const urgEl = document.getElementById('prConfirmUrgency');
  const countEl = document.getElementById('prConfirmItemCount');
  const qtyEl = document.getElementById('prConfirmTotalQty');
  const purpEl = document.getElementById('prConfirmPurpose');
  const tbody = document.getElementById('prConfirmItemsTableBody');

  const assignedBranch = (typeof dashboardData !== 'undefined' && dashboardData && dashboardData.assigned_branch) ? dashboardData.assigned_branch : 'Main Store';
  if (branchEl) branchEl.textContent = assignedBranch;
  const urgency = document.getElementById('pr_urgency') ? document.getElementById('pr_urgency').value : 'Normal';
  if (urgEl) urgEl.textContent = urgency;
  const purpose = document.getElementById('pr_purpose') ? document.getElementById('pr_purpose').value.trim() : '';
  const remarks = document.getElementById('pr_remarks') ? document.getElementById('pr_remarks').value.trim() : '';
  if (purpEl) purpEl.textContent = purpose || remarks || 'Store Inventory Replenishment';

  const totalQty = prLineItems.reduce((sum, it) => sum + (parseInt(it.requested_qty) || 0), 0);
  const hasExcess = prLineItems.some(it => (parseInt(it.available_stock) || 0) + (parseInt(it.requested_qty) || 0) > (parseInt(it.max_stock) || 100));

  if (countEl) {
    countEl.innerHTML = `${prLineItems.length} item(s) ${hasExcess ? '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning ms-1" style="font-size:0.7rem;"><i class="bi bi-exclamation-triangle-fill text-warning me-1"></i>Includes Surplus Items</span>' : ''}`;
  }
  if (qtyEl) qtyEl.textContent = totalQty + ' unit(s)';

  if (tbody) {
    tbody.innerHTML = prLineItems.map(function (it) {
      const avail = parseInt(it.available_stock) || 0;
      const maxS = parseInt(it.max_stock) || 100;
      const reqQ = parseInt(it.requested_qty) || 0;
      const isOver = (avail + reqQ) > maxS;
      const excess = isOver ? (avail + reqQ) - maxS : 0;
      return `
        <tr>
          <td class="fw-semibold text-dark">
            ${escapeHtml(it.product_name)}
            ${isOver ? `<span class="badge bg-warning-subtle text-warning-emphasis border border-warning ms-1" style="font-size:0.68rem;">+${excess} surplus</span>` : ''}
          </td>
          <td class="text-center font-monospace fw-bold text-primary">${reqQ}</td>
          <td class="text-muted small">${escapeHtml(it.notes || '—')}</td>
        </tr>
      `;
    }).join('');
  }
}

function renderPrLineItemsTable() {
  const tbody = document.getElementById('pr_items_table');
  if (!tbody) return;

  if (!prLineItems || prLineItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3 fst-italic">No items added to this purchase request yet.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  prLineItems.forEach(function (it, idx) {
    const avail = parseInt(it.available_stock) || 0;
    const maxS = parseInt(it.max_stock) || 100;
    const sug = parseInt(it.suggested_order_qty) || Math.max(0, maxS - avail);
    const reqQ = parseInt(it.requested_qty) || 0;
    const isOver = (avail + reqQ) > maxS;
    const excess = isOver ? (avail + reqQ) - maxS : 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="fw-semibold">
        ${escapeHtml(it.product_name)}
        ${isOver ? `<div class="small text-warning-emphasis fw-semibold line-excess-info" style="font-size:0.72rem;"><i class="bi bi-exclamation-triangle-fill text-warning me-1"></i>+${excess} over max (${maxS})</div>` : '<div class="line-excess-info"></div>'}
      </td>
      <td class="text-center font-monospace small">${avail} / ${maxS}</td>
      <td class="text-center font-monospace text-primary fw-semibold">${sug}</td>
      <td>
        <input type="number" class="form-control form-control-sm font-monospace pr-line-qty ${isOver ? 'border-warning fw-bold' : ''}" min="1" step="1" value="${reqQ}">
      </td>
      <td>
        <input type="text" class="form-control form-control-sm pr-line-note" value="${escapeHtml(it.notes || '')}" placeholder="Optional note">
      </td>
      <td class="text-end">
        <button type="button" class="btn btn-sm btn-outline-danger"><i class="bi bi-trash"></i></button>
      </td>
    `;
    const qtyIn = tr.querySelector('.pr-line-qty');
    const noteIn = tr.querySelector('.pr-line-note');
    const delBtn = tr.querySelector('button');
    const excessInfo = tr.querySelector('.line-excess-info');

    qtyIn.addEventListener('input', function () {
      const v = parseInt(qtyIn.value);
      it.requested_qty = isNaN(v) || v <= 0 ? 0 : v;
      qtyIn.classList.toggle('is-invalid', it.requested_qty <= 0);

      const curProj = avail + it.requested_qty;
      const curOver = it.requested_qty > 0 && curProj > maxS;
      qtyIn.classList.toggle('border-warning', curOver);
      qtyIn.classList.toggle('fw-bold', curOver);
      if (excessInfo) {
        if (curOver) {
          const curExcess = curProj - maxS;
          excessInfo.className = 'small text-warning-emphasis fw-semibold line-excess-info';
          excessInfo.style.fontSize = '0.72rem';
          excessInfo.innerHTML = `<i class="bi bi-exclamation-triangle-fill text-warning me-1"></i>+${curExcess} over max (${maxS})`;
        } else {
          excessInfo.innerHTML = '';
        }
      }
    });
    noteIn.addEventListener('input', function () {
      it.notes = noteIn.value;
    });
    delBtn.addEventListener('click', function () {
      removePrLineItem(idx);
    });
    tbody.appendChild(tr);
  });
}

async function openNewPrModal(prefillProductId) {
  if (document.getElementById('panel-purchase_request') && document.getElementById('panel-purchase_request').hidden) {
    activateTab('purchase_request');
  }
  currentPrClientToken = generatePrClientToken();
  document.getElementById('prModalTitle').textContent = 'Create Purchase Request';
  document.getElementById('pr_id').value = '';
  const purpEl = document.getElementById('pr_purpose');
  const urgEl = document.getElementById('pr_urgency');
  const remEl = document.getElementById('pr_remarks');
  if (purpEl) purpEl.value = '';
  if (urgEl) urgEl.value = 'Normal';
  if (remEl) remEl.value = '';

  const revAlert = document.getElementById('prRevisionAlert');
  if (revAlert) revAlert.hidden = true;
  const draftBtn = document.getElementById('prSaveDraftBtn');
  if (draftBtn) draftBtn.hidden = false;
  const submitBtn = document.getElementById('prSubmitBtn');
  if (submitBtn) submitBtn.innerHTML = '<i class="bi bi-send-check me-1"></i>Submit Purchase Request';

  prLineItems = [];
  goToPrWizardStep(1);
  await loadPrSuggestions();

  if (prefillProductId) {
    const p = findById(prSuggestionsCache, 'product_id', prefillProductId);
    if (p) {
      const defaultQty = parseInt(p.additional_needed_qty) > 0 ? parseInt(p.additional_needed_qty) : (parseInt(p.suggested_order_qty) > 0 ? parseInt(p.suggested_order_qty) : 1);
      quickAddSuggestedPrItem(p.product_id, defaultQty);
    }
  } else {
    renderPrLineItemsTable();
  }

  openModal('prModal');
}

async function editPurchaseRequest(prId) {
  const res = await axios.get(API + 'purchase_request.php?mode=detail&pr_id=' + encodeURIComponent(prId));
  if (res.status !== 200 || !res.data || !res.data.success) {
    showToast((res.data && res.data.message) || 'Failed to load purchase request details', true);
    return;
  }

  const pr = res.data.data;
  goToPrWizardStep(1);
  await loadPrSuggestions();

  const isForRev = pr.status === 'For Revision' || pr.approval_status === 'Returned for Revision';
  const isDraft = pr.status === 'Draft';
  document.getElementById('prModalTitle').textContent = (isForRev ? 'Revise & Resubmit ' : (isDraft ? 'Edit Draft ' : 'Edit ')) + (pr.pr_code || ('PR-' + pr.pr_id));
  document.getElementById('pr_id').value = pr.pr_id;
  const purpEl = document.getElementById('pr_purpose');
  const urgEl = document.getElementById('pr_urgency');
  const remEl = document.getElementById('pr_remarks');
  if (purpEl) purpEl.value = pr.purpose || pr.reason || '';
  if (urgEl) urgEl.value = pr.urgency || 'Normal';
  if (remEl) remEl.value = pr.remarks || pr.reason || '';

  const revAlert = document.getElementById('prRevisionAlert');
  const revText = document.getElementById('prRevisionCommentText');
  if (revAlert && revText) {
    if (isForRev && pr.manager_comment) {
      revText.textContent = pr.manager_comment;
      revAlert.hidden = false;
    } else {
      revAlert.hidden = true;
    }
  }

  const draftBtn = document.getElementById('prSaveDraftBtn');
  if (draftBtn) {
    draftBtn.hidden = !isDraft;
  }

  const submitBtn = document.getElementById('prSubmitBtn');
  if (submitBtn) {
    submitBtn.innerHTML = isForRev
      ? '<i class="bi bi-send-check me-1"></i>Resubmit for Manager Approval'
      : (isDraft ? '<i class="bi bi-send me-1"></i>Submit Purchase Request' : '<i class="bi bi-check2 me-1"></i>Save &amp; Resubmit');
  }

  prLineItems = (pr.items || []).map(function (it) {
    const avail = parseInt(it.available_stock) || 0;
    const maxS = parseInt(it.max_stock) || 100;
    return {
      product_id: parseInt(it.product_id),
      product_name: it.product_name,
      available_stock: avail,
      max_stock: maxS,
      suggested_order_qty: Math.max(0, maxS - avail),
      requested_qty: parseInt(it.requested_qty) || 1,
      notes: it.notes || ''
    };
  });

  renderPrLineItemsTable();
  openModal('prModal');
}

async function savePrAsDraft() {
  await submitPrFormInternal(true);
}

async function savePurchaseRequest(e) {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  await submitPrFormInternal(false);
}

async function submitPrFormInternal(saveAsDraft) {
  if (prSubmitting) return;
  if (!prLineItems || prLineItems.length === 0) {
    showToast('Please add at least one product to the purchase request.', true);
    return;
  }

  for (let i = 0; i < prLineItems.length; i++) {
    if (!prLineItems[i].requested_qty || prLineItems[i].requested_qty <= 0) {
      showToast(`Enter a valid requested quantity greater than zero for "${prLineItems[i].product_name}".`, true);
      return;
    }
  }

  const prId = document.getElementById('pr_id').value;
  const purpEl = document.getElementById('pr_purpose');
  const urgEl = document.getElementById('pr_urgency');
  const remEl = document.getElementById('pr_remarks');

  const purpose = purpEl ? purpEl.value.trim() : '';
  const urgency = urgEl ? urgEl.value.trim() : 'Normal';
  const remarks = remEl ? remEl.value.trim() : '';

  if (!saveAsDraft && purpose === '' && remarks === '') {
    showToast('Please enter the Purpose of this purchase request.', true);
    if (purpEl) purpEl.focus();
    return;
  }

  const itemsPayload = prLineItems.map(it => ({
    product_id: it.product_id,
    requested_qty: it.requested_qty,
    notes: it.notes || ''
  }));

  const assignedBranch = (document.getElementById('prAssignedBranchBadge') ? document.getElementById('prAssignedBranchBadge').textContent.trim() : '')
    || ((typeof dashboardData !== 'undefined' && dashboardData && dashboardData.assigned_branch) ? dashboardData.assigned_branch : 'Main Store');

  prSubmitting = true;
  try {
    let res;
    if (prId) {
      res = await axios.put(API + 'purchase_request.php', {
        action: saveAsDraft ? 'save_draft' : 'update',
        save_as_draft: Boolean(saveAsDraft),
        pr_id: parseInt(prId),
        store_name: assignedBranch,
        purpose: purpose || remarks,
        urgency: urgency,
        remarks: remarks || purpose,
        reason: remarks || purpose,
        items: itemsPayload
      });
    } else {
      res = await axios.post(API + 'purchase_request.php', {
        save_as_draft: Boolean(saveAsDraft),
        client_token: currentPrClientToken || generatePrClientToken(),
        store_name: assignedBranch,
        purpose: purpose || remarks,
        urgency: urgency,
        remarks: remarks || purpose,
        reason: remarks || purpose,
        items: itemsPayload
      });
    }

    if (res.status === 200 && res.data && res.data.success) {
      currentPrClientToken = generatePrClientToken();
      handleFormResult(res, 'prModal', function () {
        loadPurchaseRequests();
        if (typeof loadDashboard === 'function') {
          loadDashboard();
        }
      });
    } else {
      showToast((res.data && res.data.message) || 'Failed to save purchase request.', true);
    }
  } finally {
    prSubmitting = false;
  }
}

async function submitDraftPurchaseRequest(prId) {
  const res = await axios.put(API + 'purchase_request.php', {
    action: 'submit',
    pr_id: parseInt(prId)
  });

  if (res.status === 200 && res.data && res.data.success) {
    showToast(res.data.message || 'Draft purchase request submitted for approval.');
    loadPurchaseRequests();
    if (typeof loadDashboard === 'function') {
      loadDashboard();
    }
  } else {
    showToast((res.data && res.data.message) || 'Unable to submit draft purchase request.', true);
  }
}

async function cancelPurchaseRequest(prId) {
  const ok = await showConfirm('Cancel Purchase Request?', 'This request will be marked as Cancelled and removed from the approval queue.', 'Yes, Cancel Request', 'Keep Request');
  if (!ok) return;

  const res = await axios.put(API + 'purchase_request.php', {
    action: 'cancel',
    pr_id: parseInt(prId),
    comment: 'Cancelled by requester'
  });

  if (res.status === 200 && res.data && res.data.success) {
    showToast(res.data.message || 'Purchase request cancelled.');
    loadPurchaseRequests();
    if (typeof loadDashboard === 'function') {
      loadDashboard();
    }
  } else {
    showToast((res.data && res.data.message) || 'Failed to cancel request.', true);
  }
}

async function openApprovePrModal(prId) {
  const res = await axios.get(API + 'purchase_request.php?mode=detail&pr_id=' + encodeURIComponent(prId));
  if (res.status !== 200 || !res.data || !res.data.success) {
    showToast((res.data && res.data.message) || 'Unable to load purchase request for review.', true);
    return;
  }

  const pr = res.data.data;
  currentApprovePrData = pr;

  document.getElementById('approve_pr_id').value = pr.pr_id;
  document.getElementById('approvePrCode').textContent = pr.pr_code || ('PR-' + pr.pr_id);
  const approveReqRole = pr.role_name || pr.requester_role;
  const approveReqEl = document.getElementById('approvePrRequester');
  if (approveReqEl) {
    approveReqEl.innerHTML = `${escapeHtml(pr.requested_by_name || '—')}${approveReqRole ? ` <span class="badge bg-secondary-subtle text-secondary border fw-normal ms-1" style="font-size:0.72rem;">${escapeHtml(approveReqRole)}</span>` : ''}`;
  }
  document.getElementById('approvePrDate').textContent = pr.request_date || '—';
  const urgBox = document.getElementById('approvePrUrgency');
  if (urgBox) urgBox.innerHTML = renderUrgencyBadge(pr.urgency || 'Normal');
  const purpBox = document.getElementById('approvePrPurpose');
  if (purpBox) purpBox.textContent = pr.purpose || pr.reason || '—';
  document.getElementById('approvePrRemarks').textContent = pr.remarks || pr.reason || '—';
  document.getElementById('pr_approve_comment').value = pr.manager_comment || '';

  const histBox = document.getElementById('approvePrHistoryBox');
  if (histBox) {
    const hist = Array.isArray(pr.history) ? pr.history : [];
    if (hist.length === 0) {
      histBox.innerHTML = '<div class="text-muted fst-italic">No prior review history recorded.</div>';
    } else {
      histBox.innerHTML = hist.map(function (h) {
        const ts = (h.created_at || '').slice(0, 19);
        const actor = h.actor_name || 'System';
        const role = h.actor_role || h.role_name || '';
        return `<div class="mb-1 pb-1 border-bottom last-border-0">
          <span class="fw-semibold text-dark">${escapeHtml(h.action || '')}</span>
          <span class="text-muted">by ${escapeHtml(actor)}${role ? ' (' + escapeHtml(role) + ')' : ''} on <span class="font-monospace">${escapeHtml(ts)}</span></span>
          ${h.comment ? `<div class="text-secondary">${escapeHtml(h.comment)}</div>` : ''}
        </div>`;
      }).join('');
    }
  }

  const hasSurplus = (pr.items || []).some(function (it) {
    const avail = parseInt(it.available_stock) || 0;
    const maxS = parseInt(it.max_stock) || 100;
    const reqQty = parseInt(it.requested_qty) || 0;
    return (avail + reqQty) > maxS;
  });

  const surplusBanner = document.getElementById('prApproveSurplusBanner');
  if (surplusBanner) surplusBanner.hidden = !hasSurplus;

  const tbody = document.getElementById('approvePrItemsTable');
  tbody.innerHTML = '';

  (pr.items || []).forEach(function (it) {
    const avail = parseInt(it.available_stock) || 0;
    const maxS = parseInt(it.max_stock) || 100;
    const reord = parseInt(it.reorder_level) || 10;
    const reqQty = parseInt(it.requested_qty) || 0;
    const sugQty = Math.max(0, maxS - avail);
    const defaultApproved = it.approved_qty !== null && it.approved_qty !== undefined ? parseInt(it.approved_qty) : reqQty;
    const isOverMax = (avail + reqQty) > maxS;
    const excess = isOverMax ? (avail + reqQty) - maxS : 0;

    let assessmentBadge = '<span class="badge bg-success-subtle text-success border">Within capacity</span>';
    if (avail <= 3) {
      assessmentBadge = '<span class="badge bg-danger text-white">Critical stock (&le;3)</span>';
    } else if (avail <= reord) {
      assessmentBadge = '<span class="badge bg-warning text-dark">Below reorder level</span>';
    }
    if (isOverMax) {
      assessmentBadge = `<span class="badge bg-warning-subtle text-warning-emphasis border border-warning fw-semibold"><i class="bi bi-exclamation-triangle-fill text-warning me-1"></i>Exceeds Max (+${excess})</span>`;
    }

    const tr = document.createElement('tr');
    tr.setAttribute('data-product-id', it.product_id);
    tr.setAttribute('data-requested-qty', reqQty);
    tr.setAttribute('data-suggested-qty', sugQty);
    tr.innerHTML = `
      <td>
        <div class="fw-semibold">${escapeHtml(it.product_name)}</div>
        ${it.notes ? `<div class="small text-muted">Note: ${escapeHtml(it.notes)}</div>` : ''}
      </td>
      <td class="text-center font-monospace fw-bold">${avail}</td>
      <td class="text-center font-monospace text-muted">${maxS}</td>
      <td class="text-center font-monospace">${parseInt(it.already_ordered_qty) || 0}</td>
      <td class="text-center font-monospace text-primary fw-semibold">${sugQty}</td>
      <td class="text-center font-monospace fw-bold ${isOverMax ? 'text-warning-emphasis' : ''}">${reqQty}</td>
      <td class="text-center">
        <input type="number" class="form-control form-control-sm text-center font-monospace fw-bold approve-qty-input ${isOverMax ? 'border-warning' : ''}" min="0" step="1" value="${defaultApproved}">
        ${isOverMax ? `<button type="button" class="btn btn-outline-primary btn-sm py-0 px-1 mt-1 font-monospace" style="font-size:0.68rem;" onclick="setApprovedQtyToSuggested(this, ${sugQty})" title="Adjust approved quantity to suggested level (${sugQty})">Cap at ${sugQty}</button>` : ''}
      </td>
      <td>${assessmentBadge}</td>
    `;

    const qtyInput = tr.querySelector('.approve-qty-input');
    qtyInput.addEventListener('input', checkApproveQtyAdjustmentBanner);
    tbody.appendChild(tr);
  });

  checkApproveQtyAdjustmentBanner();
  openModal('prApproveModal');
}

function setApprovedQtyToSuggested(btn, suggestedQty) {
  const tr = btn.closest('tr');
  if (!tr) return;
  const input = tr.querySelector('.approve-qty-input');
  if (input) {
    input.value = suggestedQty;
    input.classList.remove('border-warning');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function checkApproveQtyAdjustmentBanner() {
  const rows = document.querySelectorAll('#approvePrItemsTable tr[data-product-id]');
  let adjusted = false;
  rows.forEach(function (tr) {
    const req = parseInt(tr.getAttribute('data-requested-qty')) || 0;
    const inp = tr.querySelector('.approve-qty-input');
    const app = inp ? parseInt(inp.value) : req;
    if (app !== req) adjusted = true;
  });
  const badge = document.getElementById('prCommentRequiredBadge');
  if (badge) badge.hidden = !adjusted;
}

async function submitPrDecision(action) {
  const prId = parseInt(document.getElementById('approve_pr_id').value);
  const comment = (document.getElementById('pr_approve_comment').value || '').trim();
  const rows = Array.from(document.querySelectorAll('#approvePrItemsTable tr[data-product-id]'));

  const items = [];
  let hasAdjustment = false;
  let totalApproved = 0;

  rows.forEach(function (tr) {
    const prodId = parseInt(tr.getAttribute('data-product-id'));
    const reqQty = parseInt(tr.getAttribute('data-requested-qty')) || 0;
    const inp = tr.querySelector('.approve-qty-input');
    const appQty = inp && inp.value !== '' ? parseInt(inp.value) : 0;
    if (appQty !== reqQty) hasAdjustment = true;
    if (appQty > 0) totalApproved += appQty;
    items.push({
      product_id: prodId,
      approved_qty: Math.max(0, isNaN(appQty) ? 0 : appQty)
    });
  });

  if (action === 'approve') {
    if (totalApproved <= 0) {
      showToast('Total approved quantity must be greater than zero to approve a request.', true);
      return;
    }
    if (hasAdjustment && comment === '') {
      showToast('Please enter a Manager Comment explaining why the requested quantities were adjusted.', true);
      document.getElementById('pr_approve_comment').focus();
      return;
    }
  } else if (action === 'return_for_revision') {
    if (comment === '') {
      showToast('Please provide Manager comments explaining what needs to be revised.', true);
      document.getElementById('pr_approve_comment').focus();
      return;
    }
  } else if (action === 'reject') {
    if (comment === '') {
      showToast('Please provide a clear rejection reason.', true);
      document.getElementById('pr_approve_comment').focus();
      return;
    }
  }

  const res = await axios.put(API + 'purchase_request.php', {
    action: action,
    pr_id: prId,
    comment: comment,
    manager_comment: comment,
    items: items
  });

  if (res.status === 200 && res.data && res.data.success) {
    showToast(res.data.message || 'Decision recorded.');
    closeModal('prApproveModal');
    loadPurchaseRequests();
    if (typeof loadDashboard === 'function') loadDashboard();
  } else {
    showToast((res.data && res.data.message) || 'Failed to record decision.', true);
  }
}

async function viewPurchaseRequestDetails(prId) {
  if (!prId) {
    showToast('Purchase request not specified or no longer available.', true, 'Purchase Request');
    return;
  }
  const res = await axios.get(API + 'purchase_request.php?mode=detail&pr_id=' + encodeURIComponent(prId));
  if (res.status !== 200 || !res.data || !res.data.success) {
    showToast((res.data && res.data.message) || 'Failed to load request details', true, 'Purchase Request');
    return;
  }

  const pr = res.data.data;
  const prCode = pr.pr_code || ('PR-' + String(pr.pr_id).padStart(4, '0'));
  document.getElementById('prDetailModalTitle').textContent = `${prCode} — Purchase Request Details`;

  // 4-Step Progress Tracker
  const st = pr.status;
  const step1Done = st !== 'Draft';
  const step2Done = ['Approved', 'Partially Ordered', 'Ordered', 'Partially Received', 'Completed'].includes(st);
  const step3Done = ['Partially Ordered', 'Ordered', 'Partially Received', 'Completed'].includes(st);
  const step4Done = st === 'Completed';

  const stepper = document.getElementById('prDetailStepper');
  if (stepper) {
    const subDate = (pr.request_date || pr.submitted_at || '').slice(0, 10);
    const poList = pr.purchase_orders || [];
    stepper.innerHTML = `
      <div class="gw-pr-stepper-track">
        <div class="track-seg ${step2Done ? 'track-solid' : 'track-dashed'}"></div>
        <div class="track-seg ${step3Done ? 'track-solid' : 'track-dashed'}"></div>
        <div class="track-seg ${step4Done ? 'track-solid' : 'track-dashed'}"></div>
      </div>
      <div class="gw-pr-step">
        <div class="gw-pr-step-circle ${step1Done ? 'done' : 'active'}">
          <i class="bi bi-file-earmark-text"></i>
          ${step1Done ? '<span class="gw-pr-step-check"><i class="bi bi-check"></i></span>' : ''}
        </div>
        <div class="gw-pr-step-title">${st === 'Draft' ? '1. Draft' : '1. Submitted'}</div>
        <div class="gw-pr-step-sub">${escapeHtml(subDate)}</div>
      </div>
      <div class="gw-pr-step">
        <div class="gw-pr-step-circle ${step2Done ? 'done' : (isPrPendingStatus(st) || st === 'For Revision' ? 'active' : 'pending')}">
          <i class="bi bi-person"></i>
          ${step2Done ? '<span class="gw-pr-step-check"><i class="bi bi-check"></i></span>' : ''}
        </div>
        <div class="gw-pr-step-title">2. Manager Review</div>
        <div class="gw-pr-step-sub ${step2Done ? 'text-approved' : ''}">${escapeHtml(pr.approval_status || st)}</div>
        ${pr.approved_by_name ? `<div class="gw-pr-step-sub d-none d-sm-block">by ${escapeHtml(pr.approved_by_name)}</div>` : ''}
      </div>
      <div class="gw-pr-step">
        <div class="gw-pr-step-circle ${step3Done ? 'done' : (st === 'Approved' ? 'active' : 'pending')}">
          <i class="bi bi-cart3"></i>
          ${step3Done ? '<span class="gw-pr-step-check"><i class="bi bi-check"></i></span>' : ''}
        </div>
        <div class="gw-pr-step-title">3. Purchasing (PO)</div>
        <div class="gw-pr-step-sub">${poList.length} PO(s)</div>
      </div>
      <div class="gw-pr-step">
        <div class="gw-pr-step-circle ${step4Done ? 'done' : (st === 'Partially Received' ? 'active' : 'pending')}">
          <i class="bi bi-truck"></i>
          ${step4Done ? '<span class="gw-pr-step-check"><i class="bi bi-check"></i></span>' : ''}
        </div>
        <div class="gw-pr-step-title">4. Fulfillment</div>
        <div class="gw-pr-step-sub">${escapeHtml(pr.fulfillment_status || 'Unfulfilled')}</div>
      </div>
    `;
  }

  // Request Summary Box (Separate Approval Status & Fulfillment Status + Purpose/Urgency/Remarks)
  const metaEl = document.getElementById('prDetailMeta');
  if (metaEl) {
    const requesterRole = pr.role_name || pr.requester_role || '';
    const reviewerRole = pr.reviewer_role || pr.reviewer_role_name || '';
    const rolePill = requesterRole ? `<span class="gw-pill-role">${escapeHtml(requesterRole)}</span>` : '';
    const reviewerPill = reviewerRole ? `<span class="gw-pill-role">${escapeHtml(reviewerRole)}</span>` : '';
    const approvalBadge = renderApprovalStatusBadge(pr.approval_status, pr.status);
    const fulfillmentBadge = renderFulfillmentStatusBadge(pr.fulfillment_status, pr.status);
    const urgencyBadge = renderUrgencyBadge(pr.urgency || 'Normal');

    metaEl.innerHTML = `
      <div class="d-none d-md-flex align-items-center justify-content-between flex-wrap gap-2">
        <div class="gw-pr-summary-col">
          <div class="gw-pr-label">Request No. / Urgency</div>
          <div class="gw-pr-val font-monospace d-flex align-items-center gap-2">${escapeHtml(prCode)} ${urgencyBadge}</div>
        </div>
        <div class="gw-pr-summary-col">
          <div class="gw-pr-label">Requested By</div>
          <div class="gw-pr-val d-flex align-items-center gap-1">
            <span>${escapeHtml(pr.requested_by_name || '—')}</span>
            ${rolePill}
          </div>
        </div>
        <div class="gw-pr-summary-col">
          <div class="gw-pr-label">Approval Status</div>
          <div>${approvalBadge}</div>
        </div>
        <div class="gw-pr-summary-col">
          <div class="gw-pr-label">Fulfillment Status</div>
          <div>${fulfillmentBadge}</div>
        </div>
        <div class="gw-pr-summary-col">
          <div class="gw-pr-label">Reviewed By</div>
          <div class="gw-pr-val d-flex align-items-center gap-1">
            <span>${escapeHtml(pr.approved_by_name || 'Pending')}</span>
            ${pr.approved_by_name ? reviewerPill : ''}
          </div>
        </div>
      </div>
      <div class="d-none d-md-flex justify-content-between border-top pt-2 mt-2 small text-muted">
        <div><strong>Purpose:</strong> <span class="text-dark">${escapeHtml(pr.purpose || pr.reason || '—')}</span></div>
        <div><strong>Remarks:</strong> <span class="text-dark">${escapeHtml(pr.remarks || pr.reason || '—')}</span></div>
        <div><strong>Totals:</strong> Req <span class="font-monospace fw-bold text-dark">${pr.requested_qty || 0}</span> &bull; Appr <span class="font-monospace fw-bold text-primary">${pr.approved_qty || 0}</span> &bull; Resv <span class="font-monospace fw-bold">${pr.reserved_qty || 0}</span> &bull; Rel <span class="font-monospace fw-bold text-success">${pr.released_qty || 0}</span> &bull; Out <span class="font-monospace fw-bold text-danger">${pr.outstanding_qty || 0}</span></div>
      </div>

      <!-- Mobile View -->
      <div class="d-md-none">
        <div class="gw-pr-summary-row">
          <span class="text-muted small">Request No.</span>
          <span class="fw-bold font-monospace">${escapeHtml(prCode)} ${urgencyBadge}</span>
        </div>
        <div class="gw-pr-summary-row">
          <span class="text-muted small">Requested By</span>
          <div class="d-flex align-items-center gap-1">
            <span class="fw-semibold">${escapeHtml(pr.requested_by_name || '—')}</span>
            ${rolePill}
          </div>
        </div>
        <div class="gw-pr-summary-row">
          <span class="text-muted small">Approval Status</span>
          <div>${approvalBadge}</div>
        </div>
        <div class="gw-pr-summary-row">
          <span class="text-muted small">Fulfillment Status</span>
          <div>${fulfillmentBadge}</div>
        </div>
        <div class="gw-pr-summary-row">
          <span class="text-muted small">Purpose</span>
          <span class="small text-dark">${escapeHtml(pr.purpose || pr.reason || '—')}</span>
        </div>
      </div>
    `;
  }

  const fbEl = document.getElementById('prDetailFeedbackBanner');
  if (fbEl) {
    if (pr.rejection_reason) {
      fbEl.innerHTML = `<div class="alert alert-danger py-1 px-3 small mb-2"><i class="bi bi-x-octagon-fill me-1"></i><strong>Rejection Reason:</strong> ${escapeHtml(pr.rejection_reason)}</div>`;
    } else if (pr.manager_comment) {
      fbEl.innerHTML = `<div class="alert alert-warning py-1 px-3 small mb-2"><i class="bi bi-chat-left-quote-fill me-1"></i><strong>Manager Comments:</strong> ${escapeHtml(pr.manager_comment)}</div>`;
    } else {
      fbEl.innerHTML = '';
    }
  }

  // Items Table: Product | Requested Qty | Approved Qty | Reserved Qty | Released Qty | Outstanding Qty | Notes
  const itemsBody = document.getElementById('prDetailItemsBody');
  if (itemsBody) {
    itemsBody.innerHTML = (pr.items || []).map(function (it) {
      const reqQ = parseInt(it.requested_qty) || 0;
      const appQ = it.approved_qty !== null && it.approved_qty !== undefined ? parseInt(it.approved_qty) : null;
      const resQ = parseInt(it.reserved_qty) || 0;
      const relQ = parseInt(it.released_qty) || 0;
      const outQ = it.outstanding_qty !== undefined ? parseInt(it.outstanding_qty) : Math.max(0, (appQ !== null ? appQ : reqQ) - relQ);
      const wasAdjusted = appQ !== null && appQ !== reqQ;
      return `
        <tr>
          <td><strong class="text-dark">${escapeHtml(it.product_name)}</strong></td>
          <td class="text-center font-monospace fw-semibold">${reqQ}</td>
          <td class="text-center font-monospace fw-bold text-primary">
            ${appQ !== null ? appQ : '—'}
            ${wasAdjusted ? '<span class="badge bg-warning-subtle text-dark border ms-1" style="font-size:0.65rem;">Adj</span>' : ''}
          </td>
          <td class="text-center font-monospace">${resQ}</td>
          <td class="text-center font-monospace text-success fw-bold">${relQ}</td>
          <td class="text-center font-monospace ${outQ > 0 ? 'text-danger fw-bold' : 'text-muted'}">${outQ}</td>
          <td class="small text-muted d-none d-md-table-cell">${escapeHtml(it.notes || '—')}</td>
        </tr>
      `;
    }).join('');
  }

  // Linked POs HTML
  const pos = pr.purchase_orders || [];
  let posHtml = '';
  if (pos.length === 0) {
    posHtml = `
      <div class="gw-pr-empty-state">
        <div class="mb-2" style="color:var(--text-secondary, #A8A6A2);">
          <svg width="40" height="40" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="10" y="8" width="28" height="36" rx="4" stroke="#74726E" stroke-width="2" fill="#1B1A18"/>
            <rect x="18" y="4" width="12" height="6" rx="2" stroke="#74726E" stroke-width="2" fill="#262521"/>
            <line x1="16" y1="18" x2="32" y2="18" stroke="#45433F" stroke-width="2" stroke-linecap="round"/>
            <line x1="16" y1="24" x2="32" y2="24" stroke="#45433F" stroke-width="2" stroke-linecap="round"/>
            <line x1="16" y1="30" x2="26" y2="30" stroke="#45433F" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="fw-bold text-dark" style="font-size:0.8rem;">No Purchase Orders</div>
        <div class="text-muted" style="font-size:0.7rem;">No Purchase Orders have been generated for this request yet.</div>
      </div>
    `;
  } else {
    posHtml = `
      <div class="list-group list-group-flush">
        ${pos.map(po => `
          <div class="list-group-item d-flex justify-content-between align-items-center py-1 px-2 border-0 border-bottom">
            <div>
              <strong class="font-monospace text-dark" style="font-size:0.8rem;">PO-${String(po.po_id).padStart(4, '0')}</strong> &bull; <span class="small">${escapeHtml(po.supplier_name)}</span>
              <div class="text-muted" style="font-size:0.68rem;">${escapeHtml(po.order_date)} &bull; ${peso(po.total_cost)}</div>
            </div>
            <div class="d-flex align-items-center gap-1">
              ${renderWorkflowStatusHtml(po.status)}
              <button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:0.7rem;" onclick="closeModal('prDetailModal'); viewPurchaseOrderDetails(${po.po_id});">Open</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  const posEl = document.getElementById('prDetailLinkedPos');
  if (posEl) posEl.innerHTML = posHtml;
  const posMobileEl = document.getElementById('prDetailLinkedPosMobile');
  if (posMobileEl) posMobileEl.innerHTML = posHtml;

  // History Timeline HTML
  const hist = Array.isArray(pr.history) ? pr.history : [];
  let histHtml = '<div class="gw-pr-timeline-track">';

  if (hist.length > 0) {
    hist.forEach(function (h) {
      const ts = (h.created_at || '').slice(0, 19);
      const rawAction = (h.action || '').toUpperCase();
      let actionLabel = rawAction.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      if (rawAction === 'PO_CREATED') actionLabel = 'PO Created';
      if (rawAction === 'RECEIVING_RECORDED') actionLabel = 'Goods Received';

      const isAppr = ['APPROVED', 'COMPLETED', 'FULFILLED'].includes(rawAction);
      const isReject = ['REJECTED', 'CANCELLED'].includes(rawAction);
      const bulletClass = isAppr ? 'green' : (isReject ? 'red' : 'purple');
      const actionClass = isAppr ? 'text-success' : (isReject ? 'text-danger' : 'text-violet');

      const actorName = h.actor_name || 'System';
      const actorRole = h.actor_role || h.role_name || '';
      const actorInfo = actorRole ? `${escapeHtml(actorName)} (${escapeHtml(actorRole)})` : escapeHtml(actorName);
      const commentText = h.comment || h.comments || '';

      histHtml += `
        <div class="gw-pr-timeline-node">
          <span class="gw-pr-timeline-bullet ${bulletClass}"></span>
          <div class="d-flex justify-content-between align-items-center">
            <strong class="${actionClass} fw-bold" style="font-size:0.78rem;">${escapeHtml(actionLabel)}</strong>
            <span class="text-muted font-monospace" style="font-size:0.68rem;">${escapeHtml(ts)}</span>
          </div>
          <div class="text-muted" style="font-size:0.7rem;">By ${actorInfo}</div>
          ${commentText ? `<div class="text-dark small mt-0.5" style="font-size:0.72rem;">${escapeHtml(commentText)}</div>` : ''}
        </div>
      `;
    });
  } else {
    const subDate = (pr.request_date || pr.submitted_at || '').slice(0, 10);
    const subTime = (pr.submitted_at || '').slice(11, 19) || '00:00:00';
    const subTs = subDate ? `${subDate} ${subTime}` : '';
    const reqRole = pr.role_name || pr.requester_role || '';
    const reqInfo = reqRole ? `${escapeHtml(pr.requested_by_name || 'Requester')} (${escapeHtml(reqRole)})` : escapeHtml(pr.requested_by_name || 'Requester');

    histHtml += `
      <div class="gw-pr-timeline-node">
        <span class="gw-pr-timeline-bullet purple"></span>
        <div class="d-flex justify-content-between align-items-center">
          <strong class="text-violet fw-bold" style="font-size:0.78rem;">Submitted</strong>
          <span class="text-muted font-monospace" style="font-size:0.68rem;">${escapeHtml(subTs)}</span>
        </div>
        <div class="text-muted" style="font-size:0.7rem;">By ${reqInfo}</div>
        <div class="text-dark small mt-0.5" style="font-size:0.72rem;">Purchase request submitted</div>
      </div>
    `;
  }
  histHtml += '</div>';

  const histEl = document.getElementById('prDetailHistory');
  if (histEl) histEl.innerHTML = histHtml;
  const histMobileEl = document.getElementById('prDetailHistoryMobile');
  if (histMobileEl) histMobileEl.innerHTML = histHtml;

  // Modal Footer contextual actions
  const footerEl = document.getElementById('prDetailModalFooter');
  if (footerEl) {
    const currentUserId = authUser ? parseInt(authUser.user_id) : 0;
    const isOwner = parseInt(pr.requester_id) === currentUserId;
    let fHtml = '<button type="button" class="btn btn-light border px-4 py-1 fw-semibold text-dark" data-bs-dismiss="modal" onclick="closeModal(\'prDetailModal\')">Close</button>';
    fHtml += `<button type="button" class="btn btn-outline-success fw-semibold px-3 py-1 ms-2" onclick="openReceiptModal('purchase_request', ${pr.pr_id});"><i class="bi bi-printer me-1"></i>Print PR</button>`;
    if (isOwner && can('purchase_request', 'manage') && (pr.status === 'Draft' || pr.status === 'For Revision')) {
      fHtml += `<button type="button" class="btn btn-dark fw-semibold px-4 py-1" onclick="closeModal('prDetailModal'); editPurchaseRequest(${pr.pr_id});"><i class="bi bi-pencil-square me-1"></i>${pr.status === 'For Revision' ? 'Edit &amp; Resubmit' : 'Edit / Submit Draft'}</button>`;
    }
    if (can('request_approval', 'manage') && isPrPendingStatus(pr.status) && !isOwner) {
      fHtml += `<button type="button" class="btn btn-warning text-dark fw-semibold px-4 py-1" onclick="closeModal('prDetailModal'); openApprovePrModal(${pr.pr_id});"><i class="bi bi-check2-square me-1"></i>Review &amp; Approve</button>`;
    }
    if (can('purchase_order', 'manage') && ['Approved', 'Partially Ordered'].includes(pr.status)) {
      fHtml += `
        <button type="button" class="btn btn-primary px-4 py-1 fw-semibold d-inline-flex align-items-center gap-1" onclick="closeModal('prDetailModal'); openCreatePoFromPr(${pr.pr_id});">
          <i class="bi bi-cart3"></i> <span>Create Purchase Order</span>
        </button>
      `;
    }
    footerEl.innerHTML = fHtml;
  }

  openModal('prDetailModal');
}
