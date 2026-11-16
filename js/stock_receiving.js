let receivingCache = [];
let pendingReceivingPosCache = [];
let currentGrnFilter = 'all';

async function loadStockReceiving() {
  const [rcvRes, pendRes] = await Promise.all([
    axios.get(API + 'stock_receiving.php'),
    axios.get(API + 'purchase_order.php?mode=pending')
  ]);

  if (rcvRes.status !== 200) {
    showToast('Failed to load stock receiving records', true);
    return;
  }

  receivingCache = (rcvRes.data && rcvRes.data.data) || [];
  pendingReceivingPosCache = (pendRes.status === 200 && pendRes.data && pendRes.data.data) ? pendRes.data.data : [];

  renderIncomingDeliveriesQueue(pendingReceivingPosCache);
  filterGrnList(currentGrnFilter);
}

function filterGrnList(mode) {
  currentGrnFilter = mode;
  const btnAll = document.getElementById('grnFilterAll');
  const btnPending = document.getElementById('grnFilterPending');
  if (btnAll) btnAll.classList.toggle('active', mode === 'all');
  if (btnPending) btnPending.classList.toggle('active', mode === 'pending_inspection');

  let list = receivingCache;
  if (mode === 'pending_inspection') {
    list = receivingCache.filter(function (r) {
      return (r.status || '').toLowerCase() === 'pending inspection';
    });
  }
  renderStockReceiving(list);
}

function renderIncomingDeliveriesQueue(list) {
  const card = document.getElementById('incomingDeliveriesCard');
  const tbody = document.getElementById('incomingDeliveriesTable');
  const countBadge = document.getElementById('incomingDeliveriesCount');
  if (!card || !tbody) return;

  if (!list || list.length === 0) {
    card.hidden = true;
    return;
  }

  card.hidden = false;
  if (countBadge) countBadge.textContent = list.length + ' Open';

  const mobDeliveries = document.getElementById('incomingDeliveriesMobileList');
  if (mobDeliveries) {
    mobDeliveries.innerHTML = list.map(function (po) {
      const poCode = po.po_code || ('PO-' + String(po.po_id).padStart(4, '0'));
      const ord = parseInt(po.total_ordered !== undefined ? po.total_ordered : po.total_qty_ordered) || 0;
      const rcv = parseInt(po.total_received !== undefined ? po.total_received : po.total_qty_received) || 0;
      const out = parseInt(po.outstanding_qty !== undefined ? po.outstanding_qty : Math.max(0, ord - rcv)) || 0;
      return `
        <div class="card mb-2 shadow-sm border gw-mobile-card-item">
          <div class="card-body p-3 d-flex justify-content-between align-items-center gap-2">
            <div class="overflow-hidden" style="min-width:0;">
              <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
                <span class="font-monospace fw-bold text-dark fs-6">${escapeHtml(poCode)}</span>
                <span class="fw-semibold text-truncate text-secondary">&bull; ${escapeHtml(po.supplier_name)}</span>
              </div>
              <div class="small text-muted mb-1">Delivered: ${rcv}/${ord} &bull; <strong class="text-primary">${out} due</strong></div>
              <div>${renderWorkflowStatusHtml(po.status)}</div>
            </div>
            <div class="flex-shrink-0">
              ${can('stock_receiving', 'manage')
                ? `<button type="button" class="btn btn-sm btn-primary d-inline-flex align-items-center gap-1" onclick="openReceivePoModal(${po.po_id})"><i class="bi bi-box-arrow-in-down"></i> Receive</button>`
                : `<button type="button" class="btn btn-sm btn-outline-success" onclick="viewPurchaseOrderDetails(${po.po_id})">View</button>`}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  tbody.innerHTML = list.map(function (po) {
    const poCode = po.po_code || ('PO-' + String(po.po_id).padStart(4, '0'));
    const ord = parseInt(po.total_ordered !== undefined ? po.total_ordered : po.total_qty_ordered) || 0;
    const rcv = parseInt(po.total_received !== undefined ? po.total_received : po.total_qty_received) || 0;
    const out = parseInt(po.outstanding_qty !== undefined ? po.outstanding_qty : Math.max(0, ord - rcv)) || 0;
    return `
      <tr>
        <td class="font-monospace fw-bold">${escapeHtml(poCode)}</td>
        <td class="font-monospace small text-muted">${escapeHtml(po.pr_code || '—')}</td>
        <td class="fw-semibold">${escapeHtml(po.supplier_name)}</td>
        <td class="small text-muted">${escapeHtml(po.order_date)}</td>
        <td class="font-monospace">${rcv} / ${ord}</td>
        <td class="font-monospace fw-bold text-primary">${out} units</td>
        <td>${renderWorkflowStatusHtml(po.status)}</td>
        <td class="text-end">
          ${can('stock_receiving', 'manage')
            ? `<button type="button" class="btn btn-sm btn-primary py-0 px-2" onclick="openReceivePoModal(${po.po_id})"><i class="bi bi-box-arrow-in-down me-1"></i>Receive Delivery</button>`
            : `<button type="button" class="btn btn-sm btn-outline-success py-0 px-2" onclick="viewPurchaseOrderDetails(${po.po_id})">View PO</button>`}
        </td>
      </tr>
    `;
  }).join('');
}

function renderStockReceiving(rows) {
  const body = document.getElementById('receivingTable');
  const mobileList = document.getElementById('receivingMobileList');
  if (!body && !mobileList) return;

  if (!rows || rows.length === 0) {
    if (body) renderEmptyRow(body, currentGrnFilter === 'pending_inspection' ? 'No receiving records currently pending inspection.' : 'No Goods Receipt Notes (GRN) recorded yet.', 10);
    if (mobileList) {
      mobileList.innerHTML = '<div class="p-4 text-center text-muted fst-italic">No receiving records found.</div>';
    }
    if (window.TableTools) TableTools.enhance('receivingTable', { searchPlaceholder: 'Search GRN number, PO, DR number, supplier...' });
    return;
  }

  if (body) {
    body.innerHTML = '';
    const tmpl = document.getElementById('tmpl-row-receiving');
    rows.map(function (r) {
      const clone = tmpl.content.cloneNode(true);
      const grnCode = r.grn_number || r.receiving_code || ('GRN-' + String(r.receiving_id).padStart(5, '0'));
      const poCode = r.po_code || ('PO-' + String(r.po_id).padStart(4, '0'));
      const isPending = (r.status || '').toLowerCase() === 'pending inspection';

      const grnCell = clone.querySelector('.row-grn-code');
      if (grnCell) grnCell.textContent = grnCode;
      const poCell = clone.querySelector('.row-po-code');
      if (poCell) poCell.textContent = poCode;
      const drCell = clone.querySelector('.row-dr');
      if (drCell) drCell.textContent = r.dr_number || '—';

      clone.querySelector('.row-supplier').textContent = r.supplier_name;
      clone.querySelector('.row-date').innerHTML = `<div class="small fw-semibold">${escapeHtml(r.receiving_date)}</div><div class="text-muted" style="font-size:0.75rem;">By ${escapeHtml(r.received_by)}</div>`;

      const totDelivered = parseInt(r.total_received !== undefined ? r.total_received : r.total_received_qty) || 0;
      const totAccepted = parseInt(r.total_accepted_qty) || 0;
      const totRejected = (parseInt(r.total_rejected_qty) || 0) + (parseInt(r.total_quarantined_qty) || 0);

      clone.querySelector('.row-delivered').innerHTML = `<span class="fw-bold">${totDelivered}</span> <span class="text-muted small">(${r.item_count} item${parseInt(r.item_count) === 1 ? '' : 's'})</span>`;
      clone.querySelector('.row-accepted').innerHTML = isPending
        ? '<span class="text-muted fst-italic">—</span>'
        : `<span class="fw-bold text-success">+${totAccepted}</span>`;
      clone.querySelector('.row-rejected').innerHTML = isPending
        ? '<span class="text-muted fst-italic">—</span>'
        : (totRejected > 0 ? `<span class="fw-bold text-danger">${totRejected}</span>` : '<span class="text-muted">0</span>');

      const statusCell = clone.querySelector('.row-status');
      if (statusCell) {
        if (isPending) {
          statusCell.innerHTML = '<span class="badge bg-warning text-dark"><i class="bi bi-hourglass-split me-1"></i>Pending Inspection</span>';
        } else {
          const inspBadge = (r.inspection_status === 'Partial' || totRejected > 0)
            ? '<span class="badge bg-info text-dark"><i class="bi bi-shield-exclamation me-1"></i>Partial Rejections</span>'
            : '<span class="badge bg-success"><i class="bi bi-shield-check me-1"></i>Passed &amp; Posted</span>';
          statusCell.innerHTML = inspBadge;
        }
      }

      const actionsCell = clone.querySelector('.row-actions');
      if (actionsCell) {
        actionsCell.innerHTML = '';
        if (isPending && can('stock_receiving', 'manage')) {
          const inspBtn = document.createElement('button');
          inspBtn.type = 'button';
          inspBtn.className = 'btn btn-sm btn-primary me-1 py-0 px-2';
          inspBtn.title = 'Inspect Delivered Goods & Post to Stock';
          inspBtn.innerHTML = '<i class="bi bi-shield-check me-1"></i>Inspect';
          inspBtn.addEventListener('click', function () {
            openInspectionModal(r.receiving_id);
          });
          actionsCell.appendChild(inspBtn);
        }

        const viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className = 'btn btn-sm btn-outline-success py-0 px-2';
        viewBtn.title = 'View Goods Receipt Note Details';
        viewBtn.innerHTML = '<i class="bi bi-eye me-1"></i>View';
        viewBtn.addEventListener('click', function () {
          viewReceivingDetails(r.receiving_id);
        });
        actionsCell.appendChild(viewBtn);
      }

      return clone;
    }).forEach(function (rowNode) {
      body.appendChild(rowNode);
    });
  }

  if (mobileList) {
    mobileList.innerHTML = rows.map(function (r) {
      const grnCode = r.grn_number || r.receiving_code || ('GRN-' + String(r.receiving_id).padStart(5, '0'));
      const poCode = r.po_code || ('PO-' + String(r.po_id).padStart(4, '0'));
      const isPending = (r.status || '').toLowerCase() === 'pending inspection';
      const totDelivered = parseInt(r.total_received !== undefined ? r.total_received : r.total_received_qty) || 0;
      const totAccepted = parseInt(r.total_accepted_qty) || 0;
      return `
        <div class="card mb-2 shadow-sm border gw-mobile-card-item">
          <div class="card-body p-3 d-flex justify-content-between align-items-center gap-2">
            <div class="overflow-hidden" style="min-width:0;">
              <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
                <span class="font-monospace fw-bold text-dark fs-6">${escapeHtml(grnCode)}</span>
                <span class="badge bg-light text-dark border font-monospace">${escapeHtml(r.dr_number || 'DR—')}</span>
                <span class="small font-monospace text-muted">&bull; ${escapeHtml(poCode)}</span>
              </div>
              <div class="fw-semibold text-truncate mb-1">${escapeHtml(r.supplier_name)}</div>
              <div class="small text-muted mb-1">${escapeHtml(r.receiving_date)} &bull; Delivered: ${totDelivered} units</div>
              <div>
                ${isPending
                  ? '<span class="badge bg-warning text-dark"><i class="bi bi-hourglass-split me-1"></i>Pending Inspection</span>'
                  : `<span class="badge bg-success"><i class="bi bi-shield-check me-1"></i>+${totAccepted} Posted</span>`}
              </div>
            </div>
            <div class="flex-shrink-0 d-flex flex-column gap-1">
              ${isPending && can('stock_receiving', 'manage')
                ? `<button type="button" class="btn btn-sm btn-primary" onclick="openInspectionModal(${r.receiving_id})"><i class="bi bi-shield-check me-1"></i>Inspect</button>`
                : ''}
              <button type="button" class="btn btn-sm btn-outline-success" onclick="viewReceivingDetails(${r.receiving_id})">View</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.TableTools) {
    TableTools.enhance('receivingTable', { searchPlaceholder: 'Search GRN number, PO, DR number, supplier...' });
  }
}

function generateReceivingClientToken() {
  return 'rcv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

async function openReceivePoModal(poId) {
  if (document.getElementById('panel-stock_receiving') && document.getElementById('panel-stock_receiving').hidden) {
    activateTab('stock_receiving');
  }
  await resetModalForAdd('receivingModal');
  await loadPendingPurchaseOrders();
  const select = document.getElementById('receiving_po_id');
  if (select && poId) {
    select.value = String(poId);
    await loadPoItemsForReceiving();
  }
  openModal('receivingModal');
}

async function loadPendingPurchaseOrders() {
  const res = await axios.get(API + 'purchase_order.php?mode=pending');
  const tokenEl = document.getElementById('receiving_client_token');
  if (tokenEl) tokenEl.value = generateReceivingClientToken();

  const dateEl = document.getElementById('receiving_date');
  if (dateEl && !dateEl.value) {
    const now = new Date();
    dateEl.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }

  switch (res.status) {
    case 200: {
      const select = document.getElementById('receiving_po_id');
      const list = res.data.data || [];
      pendingReceivingPosCache = list;
      const optionsHtml = list.map(function (po) {
        const poCode = po.po_code || ('PO-' + String(po.po_id).padStart(4, '0'));
        const out = parseInt(po.outstanding_qty) || 0;
        return `<option value="${po.po_id}">${escapeHtml(poCode + ' — ' + po.supplier_name + ' (' + po.status + ', ' + out + ' units due)')}</option>`;
      }).join('');
      select.innerHTML = '<option value="">Select an authorized purchase order...</option>' + optionsHtml;
      renderEmptyRow(document.getElementById('receiving_items_table'), 'Select a purchase order first.', 7);
      updateReceivingLiveSummary();
      break;
    }
    default:
      showToast('Failed to load pending purchase orders', true);
  }
}

async function loadPoItemsForReceiving() {
  const poId = document.getElementById('receiving_po_id').value;
  const body = document.getElementById('receiving_items_table');
  const drInput = document.getElementById('receiving_dr_number');

  if (!poId) {
    renderEmptyRow(body, 'Select a purchase order first.', 7);
    updateReceivingLiveSummary();
    return;
  }

  if (drInput && !drInput.value.trim()) {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    drInput.value = `DR-${todayStr}-PO${String(poId).padStart(3, '0')}`;
  }

  const res = await axios.get(API + 'stock_receiving.php?po_id=' + encodeURIComponent(poId));
  switch (res.status) {
    case 200: {
      const items = res.data.data;
      if (!items || items.length === 0) {
        renderEmptyRow(body, 'This purchase order has no line items.', 7);
        updateReceivingLiveSummary();
        return;
      }

      body.innerHTML = '';
      const tmpl = document.getElementById('tmpl-row-receiving-item');
      items.map(function (it) {
        const clone = tmpl.content.cloneNode(true);
        const tr = clone.querySelector('.receiving-row');
        const ordered = parseInt(it.quantity_ordered) || 0;
        const prevRcv = parseInt(it.quantity_received) || 0;
        const outstanding = parseInt(it.outstanding_qty !== undefined ? it.outstanding_qty : Math.max(0, ordered - prevRcv)) || 0;

        tr.setAttribute('data-product-id', it.product_id);
        tr.setAttribute('data-po-detail-id', it.po_detail_id || '');
        tr.setAttribute('data-ordered', ordered);
        tr.setAttribute('data-prev-received', prevRcv);
        tr.setAttribute('data-outstanding', outstanding);

        clone.querySelector('.row-product-name').textContent = it.product_name;
        clone.querySelector('.row-qty-ordered').textContent = ordered;
        clone.querySelector('.row-qty-prev').textContent = prevRcv;
        clone.querySelector('.row-qty-outstanding').textContent = outstanding;

        const qtyInput = clone.querySelector('.row-qty-input');
        qtyInput.value = outstanding;
        qtyInput.max = outstanding;
        qtyInput.disabled = outstanding <= 0;
        qtyInput.id = 'receiving_qty_' + it.product_id;

        const noteInput = clone.querySelector('.row-note-input');
        noteInput.id = 'receiving_note_' + it.product_id;

        const remCell = clone.querySelector('.row-qty-remaining');
        remCell.textContent = 0;

        const recalcRow = function () {
          const rcvNow = Math.max(0, parseInt(qtyInput.value) || 0);
          qtyInput.classList.toggle('is-invalid', rcvNow > outstanding || rcvNow < 0);
          const remAfter = Math.max(0, outstanding - rcvNow);
          remCell.textContent = remAfter;
          remCell.className = 'text-center font-monospace row-qty-remaining ' + (remAfter > 0 ? 'text-warning-emphasis fw-bold' : 'text-success fw-bold');
          updateReceivingLiveSummary();
        };

        qtyInput.addEventListener('input', recalcRow);
        return clone;
      }).forEach(function (rowNode) {
        body.appendChild(rowNode);
      });
      updateReceivingLiveSummary();
      break;
    }
    default:
      showToast('Failed to load purchase order items', true);
  }
}

function fillReceivingQuantities(mode) {
  const rows = document.querySelectorAll('#receiving_items_table tr.receiving-row');
  rows.forEach(function (tr) {
    const out = parseInt(tr.getAttribute('data-outstanding')) || 0;
    const qtyInput = tr.querySelector('.row-qty-input');
    if (qtyInput && !qtyInput.disabled) {
      qtyInput.value = mode === 'zero' ? 0 : out;
      qtyInput.dispatchEvent(new Event('input'));
    }
  });
}

function updateReceivingLiveSummary() {
  const rows = Array.from(document.querySelectorAll('#receiving_items_table tr.receiving-row'));
  const sumNowEl = document.getElementById('rcvSumNow');
  const sumRemEl = document.getElementById('rcvSumRemaining');
  const statusEl = document.getElementById('rcvSumResultStatus');

  if (rows.length === 0) {
    if (sumNowEl) sumNowEl.textContent = '0';
    if (sumRemEl) sumRemEl.textContent = '0';
    if (statusEl) {
      statusEl.textContent = 'Select PO';
      statusEl.className = 'badge bg-secondary';
    }
    return;
  }

  let totalNow = 0;
  let totalRemaining = 0;

  rows.forEach(function (tr) {
    const out = parseInt(tr.getAttribute('data-outstanding')) || 0;
    const qtyIn = tr.querySelector('.row-qty-input');
    const rcv = Math.max(0, parseInt(qtyIn ? qtyIn.value : 0) || 0);
    totalNow += rcv;
    totalRemaining += Math.max(0, out - rcv);
  });

  if (sumNowEl) sumNowEl.textContent = totalNow;
  if (sumRemEl) sumRemEl.textContent = totalRemaining;

  if (statusEl) {
    if (totalNow === 0) {
      statusEl.textContent = 'Enter quantities';
      statusEl.className = 'badge bg-secondary';
    } else if (totalRemaining === 0) {
      statusEl.textContent = 'Received (Complete)';
      statusEl.className = 'badge bg-success';
    } else {
      statusEl.textContent = `Partially Received (${totalRemaining} outstanding)`;
      statusEl.className = 'badge bg-warning text-dark';
    }
  }
}

function showReceivingNotification(message) {
  const alertEl = document.getElementById('receivingSuccessAlert');
  if (alertEl) {
    const msgEl = document.getElementById('receivingSuccessMsg');
    if (msgEl) msgEl.textContent = message || 'Delivery recorded successfully.';
    alertEl.hidden = false;
    setTimeout(function () {
      alertEl.hidden = true;
    }, 5000);
  }
}

async function saveStockReceiving(e) {
  e.preventDefault();
  const poId = document.getElementById('receiving_po_id').value;
  if (!poId) {
    showToast('Select an authorized purchase order', true);
    return;
  }

  const drNumber = (document.getElementById('receiving_dr_number').value || '').trim();
  if (!drNumber) {
    showToast('Please enter the Supplier Delivery Receipt (DR) Number.', true);
    return;
  }

  const remarks = (document.getElementById('receiving_remarks').value || '').trim();
  const rows = Array.from(document.querySelectorAll('#receiving_items_table tr.receiving-row'));
  if (rows.length === 0) {
    showToast('This purchase order has no items to receive', true);
    return;
  }

  let totalReceivingNow = 0;
  let totalRemainingAfter = 0;
  const items = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const productId = parseInt(row.getAttribute('data-product-id'));
    const prodName = row.querySelector('.row-product-name').textContent;
    const outstanding = parseInt(row.getAttribute('data-outstanding')) || 0;
    const qtyInput = document.getElementById('receiving_qty_' + productId);
    const noteInput = document.getElementById('receiving_note_' + productId);

    const qty = qtyInput && qtyInput.value !== '' ? parseInt(qtyInput.value) : 0;
    const note = noteInput ? noteInput.value.trim() : '';

    if (isNaN(qty) || qty < 0) {
      showToast(`Delivered quantity cannot be negative for "${prodName}".`, true);
      return;
    }
    if (qty > outstanding) {
      showToast(`Delivered quantity (${qty}) for "${prodName}" cannot exceed the remaining outstanding quantity (${outstanding}).`, true);
      return;
    }

    totalReceivingNow += qty;
    totalRemainingAfter += Math.max(0, outstanding - qty);

    items.push({
      product_id: productId,
      quantity_received: qty,
      discrepancy_note: note
    });
  }

  if (totalReceivingNow <= 0) {
    showToast('Enter at least one delivered quantity greater than zero.', true);
    return;
  }

  const autoInspect = document.getElementById('receiving_auto_inspect') && document.getElementById('receiving_auto_inspect').checked;
  const resultStatusLabel = totalRemainingAfter === 0 ? 'Received (Complete)' : `Partially Received (${totalRemainingAfter} units remaining due)`;
  const confirmSummary = `Issue Goods Receipt Note (GRN) for ${totalReceivingNow} delivered unit(s) under DR "${drNumber}"?` +
    (autoInspect ? ' Goods will be inspected & posted immediately.' : ' Goods will be submitted for inspection.') +
    ` Resulting PO status: ${resultStatusLabel}.`;

  const ok = await showConfirm('Issue Goods Receipt Note?', confirmSummary, 'Issue GRN', 'Review Again');
  if (!ok) return;

  const tokenEl = document.getElementById('receiving_client_token');
  const clientToken = tokenEl && tokenEl.value ? tokenEl.value : generateReceivingClientToken();

  const payload = {
    po_id: parseInt(poId),
    receiving_date: document.getElementById('receiving_date').value,
    dr_number: drNumber,
    remarks: remarks,
    client_token: clientToken,
    auto_inspect: autoInspect,
    items: items
  };

  const res = await axios.post(API + 'stock_receiving.php', payload);
  switch (res.status) {
    case 200: {
      const msg = (res.data && res.data.message) ? res.data.message : 'Goods Receipt Note issued successfully.';
      showReceivingNotification(msg);
      cache.products = [];
      handleFormResult(res, 'receivingModal', function () {
        loadStockReceiving();
        if (typeof loadDashboard === 'function') loadDashboard();
      });
      break;
    }
    case 403:
      showToast('Unauthorized: You do not have permission to record stock receiving.', true);
      break;
    case 422:
    case 400:
    case 409:
      showToast((res.data && res.data.message) || 'Validation Error: Please check your input fields.', true);
      break;
    case 500:
      showToast('Server Error: ' + ((res.data && res.data.message) || 'Please try again later.'), true);
      break;
    default: {
      const msg = (res.data && res.data.message) ? res.data.message : 'Request failed.';
      showToast('Error ' + res.status + ': ' + msg, true);
      break;
    }
  }
}

/**
 * Workflow B: Opens Goods Inspection Modal
 */
async function openInspectionModal(receivingId) {
  if (!receivingId) {
    showToast('Receiving record ID required for inspection.', true);
    return;
  }

  const res = await axios.get(API + 'stock_receiving.php?receiving_id=' + encodeURIComponent(receivingId));
  if (res.status !== 200 || !res.data || !res.data.success) {
    showToast((res.data && res.data.message) || 'Failed to load receiving record for inspection.', true);
    return;
  }

  const r = res.data.data;
  const grnCode = r.grn_number || r.receiving_code || ('GRN-' + String(r.receiving_id).padStart(5, '0'));

  document.getElementById('insp_receiving_id').value = r.receiving_id;
  document.getElementById('inspectionModalLabel').innerHTML = `<i class="bi bi-shield-check text-warning me-2"></i>Inspect Goods — <span class="font-monospace text-warning">${escapeHtml(grnCode)}</span>`;

  const metaEl = document.getElementById('inspectionMetaCard');
  if (metaEl) {
    metaEl.innerHTML = `
      <div class="col-6 col-md-3">
        <div class="small text-muted text-uppercase fw-semibold">GRN Number</div>
        <div class="fw-bold font-monospace text-primary">${escapeHtml(grnCode)}</div>
      </div>
      <div class="col-6 col-md-3">
        <div class="small text-muted text-uppercase fw-semibold">Supplier DR No.</div>
        <div class="fw-bold font-monospace">${escapeHtml(r.dr_number || '—')}</div>
      </div>
      <div class="col-6 col-md-3">
        <div class="small text-muted text-uppercase fw-semibold">Purchase Order</div>
        <div class="font-monospace fw-semibold">${escapeHtml(r.po_code || ('PO-' + r.po_id))} ${r.pr_code ? `(${escapeHtml(r.pr_code)})` : ''}</div>
      </div>
      <div class="col-6 col-md-3">
        <div class="small text-muted text-uppercase fw-semibold">Supplier &amp; Delivery Date</div>
        <div class="fw-semibold">${escapeHtml(r.supplier_name)}</div>
        <div class="small text-muted">${escapeHtml(r.receiving_date)} &bull; By ${escapeHtml(r.received_by)}</div>
      </div>
    `;
  }

  const today = new Date().toISOString().slice(0, 10);
  const dateInput = document.getElementById('insp_date');
  if (dateInput) dateInput.value = r.inspection_date || today;

  const notesInput = document.getElementById('insp_notes');
  if (notesInput) notesInput.value = r.inspection_notes || '';

  const tbody = document.getElementById('inspectionItemsTableBody');
  if (tbody) {
    tbody.innerHTML = (r.items || []).map(function (it) {
      const delivered = parseInt(it.quantity_received) || 0;
      const maxCap = parseInt(it.max_stock) || 100;
      const curStock = parseInt(it.current_usable_stock) || 0;
      const remCap = Math.max(0, maxCap - curStock);

      let accDefault, rejDefault, quarDefault, defaultReason;
      if (it.quantity_accepted > 0 || it.quantity_rejected > 0 || it.quantity_quarantined > 0) {
        accDefault = parseInt(it.quantity_accepted) || 0;
        rejDefault = parseInt(it.quantity_rejected) || 0;
        quarDefault = parseInt(it.quantity_quarantined) || 0;
        defaultReason = it.rejection_reason || it.quarantine_reason || it.discrepancy_note || '';
      } else {
        // Enforce maximum stock capacity limit on first inspection
        accDefault = Math.min(delivered, remCap);
        rejDefault = 0;
        quarDefault = Math.max(0, delivered - accDefault);
        defaultReason = quarDefault > 0 ? 'Excess delivery exceeds maximum capacity (Flagged for Review)' : '';
      }

      const capBadge = remCap <= 0
        ? `<span class="badge bg-danger-subtle text-danger border border-danger-subtle small ms-1">Capacity Full (0 rem)</span>`
        : `<span class="badge bg-light text-muted border small ms-1">Cap: ${curStock}/${maxCap} (${remCap} rem)</span>`;

      return `
        <tr class="inspection-item-row" data-detail-id="${it.receiving_detail_id}" data-product-id="${it.product_id}" data-delivered="${delivered}" data-max-capacity="${maxCap}" data-current-stock="${curStock}" data-remaining-capacity="${remCap}">
          <td class="fw-semibold">
            ${escapeHtml(it.product_name)}
            <div class="small text-muted font-monospace">${it.unit_measure || 'units'} &bull; ${capBadge}</div>
            <div class="insp-cap-warning small mt-1" style="display:none;"></div>
          </td>
          <td class="text-center font-monospace fw-bold bg-light">${delivered}</td>
          <td>
            <input type="number" class="form-control form-control-sm text-center font-monospace insp-acc-input text-success fw-bold" min="0" max="${delivered}" step="1" value="${accDefault}">
          </td>
          <td>
            <input type="number" class="form-control form-control-sm text-center font-monospace insp-rej-input text-danger fw-bold" min="0" max="${delivered}" step="1" value="${rejDefault}">
          </td>
          <td>
            <input type="number" class="form-control form-control-sm text-center font-monospace insp-quar-input text-warning-emphasis fw-bold" min="0" max="${delivered}" step="1" value="${quarDefault}">
          </td>
          <td class="text-center font-monospace insp-balance-cell"></td>
          <td>
            <input type="text" class="form-control form-control-sm insp-reason-input" placeholder="Rejection/quarantine reason or quality note" value="${escapeHtml(defaultReason)}">
          </td>
        </tr>
      `;
    }).join('');

    // Attach real-time validation listeners
    tbody.querySelectorAll('input.insp-acc-input, input.insp-rej-input, input.insp-quar-input').forEach(function (input) {
      input.addEventListener('input', recalcInspectionAccounting);
    });

    recalcInspectionAccounting();
  }

  openModal('inspectionModal');
}

function recalcInspectionAccounting() {
  const rows = Array.from(document.querySelectorAll('#inspectionItemsTableBody tr.inspection-item-row'));
  let totalDel = 0;
  let totalAcc = 0;
  let totalRej = 0;
  let totalQuar = 0;
  let allBalanced = true;
  let hasCapacityError = false;
  let capacityErrorMsg = '';

  rows.forEach(function (row) {
    const delivered = parseInt(row.getAttribute('data-delivered')) || 0;
    const rawRemCap = row.getAttribute('data-remaining-capacity');
    const remCap = rawRemCap !== null ? parseInt(rawRemCap) : 999999;
    const curStock = parseInt(row.getAttribute('data-current-stock')) || 0;
    const maxCap = parseInt(row.getAttribute('data-max-capacity')) || 100;
    const effectiveRemCap = isNaN(remCap) ? 999999 : remCap;

    const accIn = row.querySelector('.insp-acc-input');
    const rejIn = row.querySelector('.insp-rej-input');
    const quarIn = row.querySelector('.insp-quar-input');
    const balCell = row.querySelector('.insp-balance-cell');
    const warnEl = row.querySelector('.insp-cap-warning');
    const reasonIn = row.querySelector('.insp-reason-input');

    const acc = Math.max(0, parseInt(accIn ? accIn.value : 0) || 0);
    const rej = Math.max(0, parseInt(rejIn ? rejIn.value : 0) || 0);
    const quar = Math.max(0, parseInt(quarIn ? quarIn.value : 0) || 0);
    const accounted = acc + rej + quar;

    totalDel += delivered;
    totalAcc += acc;
    totalRej += rej;
    totalQuar += quar;

    let rowCapError = false;
    if (acc > effectiveRemCap) {
      rowCapError = true;
      hasCapacityError = true;
      allBalanced = false;
      capacityErrorMsg = 'Maximum stock capacity reached. Cannot add more stock to this product.';
      if (warnEl) {
        warnEl.style.display = 'block';
        warnEl.innerHTML = `<span class="text-danger fw-bold"><i class="bi bi-exclamation-octagon-fill me-1"></i>Maximum stock capacity reached. Cannot add more stock to this product.</span><br><span class="text-muted small">Remaining capacity: ${effectiveRemCap} unit(s). Excess ${acc - effectiveRemCap} unit(s) cannot be accepted into usable stock and must be quarantined for review.</span> <a href="javascript:void(0)" class="btn-fix-excess text-primary fw-semibold" style="font-size:0.75rem;">[Cap &amp; Quarantine Excess]</a>`;
        const fixBtn = warnEl.querySelector('.btn-fix-excess');
        if (fixBtn) {
          fixBtn.onclick = function () {
            const excess = acc - effectiveRemCap;
            accIn.value = effectiveRemCap;
            quarIn.value = (parseInt(quarIn.value) || 0) + excess;
            if (reasonIn && !reasonIn.value) {
              reasonIn.value = 'Excess delivery exceeds maximum capacity (Flagged for Review)';
            }
            recalcInspectionAccounting();
          };
        }
      }
    } else {
      if (warnEl) {
        warnEl.style.display = 'none';
        warnEl.innerHTML = '';
      }
    }

    if (!rowCapError && accounted === delivered) {
      balCell.innerHTML = '<span class="badge bg-success-subtle text-success border border-success-subtle"><i class="bi bi-check-lg me-1"></i>Matched</span>';
      row.classList.remove('table-danger');
    } else {
      allBalanced = false;
      const diff = delivered - accounted;
      const diffLabel = rowCapError ? 'Exceeds Cap' : (diff > 0 ? `${diff} unassigned` : `${Math.abs(diff)} excess`);
      balCell.innerHTML = `<span class="badge bg-danger-subtle text-danger border border-danger-subtle">${diffLabel}</span>`;
      row.classList.add('table-danger');
    }
  });

  const sumDelEl = document.getElementById('inspSumDelivered');
  const sumAccEl = document.getElementById('inspSumAccepted');
  const sumRejEl = document.getElementById('inspSumRejected');
  const sumQuarEl = document.getElementById('inspSumQuarantined');
  const noticeEl = document.getElementById('inspValidationNotice');
  const submitBtn = document.getElementById('inspSubmitBtn');

  if (sumDelEl) sumDelEl.textContent = totalDel;
  if (sumAccEl) sumAccEl.textContent = totalAcc;
  if (sumRejEl) sumRejEl.textContent = totalRej;
  if (sumQuarEl) sumQuarEl.textContent = totalQuar;

  if (noticeEl) {
    if (hasCapacityError) {
      noticeEl.innerHTML = `<span class="badge bg-danger"><i class="bi bi-exclamation-octagon-fill me-1"></i>${capacityErrorMsg}</span>`;
    } else if (allBalanced) {
      noticeEl.innerHTML = '<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>All items fully accounted for</span>';
    } else {
      noticeEl.innerHTML = '<span class="badge bg-danger"><i class="bi bi-exclamation-triangle me-1"></i>Item quantities do not match delivered totals</span>';
    }
  }

  if (submitBtn) {
    submitBtn.disabled = !allBalanced || hasCapacityError;
  }
}

async function submitGoodsInspection(e) {
  e.preventDefault();
  const receivingId = parseInt(document.getElementById('insp_receiving_id').value);
  if (!receivingId) {
    showToast('Invalid receiving ID.', true);
    return;
  }

  const inspDate = document.getElementById('insp_date').value;
  const inspNotes = (document.getElementById('insp_notes').value || '').trim();
  const rows = Array.from(document.querySelectorAll('#inspectionItemsTableBody tr.inspection-item-row'));

  let totalAccepted = 0;
  let totalRejected = 0;
  let totalQuarantined = 0;
  const items = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const detId = parseInt(row.getAttribute('data-detail-id'));
    const pid = parseInt(row.getAttribute('data-product-id'));
    const delivered = parseInt(row.getAttribute('data-delivered')) || 0;

    const acc = Math.max(0, parseInt(row.querySelector('.insp-acc-input').value) || 0);
    const rej = Math.max(0, parseInt(row.querySelector('.insp-rej-input').value) || 0);
    const quar = Math.max(0, parseInt(row.querySelector('.insp-quar-input').value) || 0);
    const reason = (row.querySelector('.insp-reason-input').value || '').trim();

    if (acc + rej + quar !== delivered) {
      showToast(`Item inspection total (${acc + rej + quar}) does not match delivered quantity (${delivered}).`, true);
      return;
    }

    totalAccepted += acc;
    totalRejected += rej;
    totalQuarantined += quar;

    items.push({
      receiving_detail_id: detId,
      product_id: pid,
      quantity_accepted: acc,
      quantity_rejected: rej,
      quantity_quarantined: quar,
      rejection_reason: rej > 0 ? reason : '',
      quarantine_reason: quar > 0 ? reason : '',
      discrepancy_note: reason
    });
  }

  const confirmMsg = `Post inspection for GRN #${receivingId}?` +
    `\n• Accepted (usable stock): +${totalAccepted}` +
    `\n• Rejected: ${totalRejected}` +
    `\n• Quarantined: ${totalQuarantined}` +
    `\n\nOnly accepted quantities will enter usable warehouse inventory.`;

  const ok = await showConfirm('Complete & Post Inspection?', confirmMsg, 'Post to Inventory', 'Review');
  if (!ok) return;

  const payload = {
    action: 'inspect_and_post',
    receiving_id: receivingId,
    inspection_date: inspDate,
    inspection_notes: inspNotes,
    items: items
  };

  const res = await axios.post(API + 'stock_receiving.php', payload);
  switch (res.status) {
    case 200: {
      const msg = (res.data && res.data.message) ? res.data.message : 'Inspection completed and accepted goods posted to inventory.';
      showReceivingNotification(msg);
      cache.products = [];
      closeModal('inspectionModal');
      await loadStockReceiving();
      if (typeof loadDashboard === 'function') loadDashboard();
      break;
    }
    case 409:
      showToast((res.data && res.data.message) || 'This Goods Receipt Note has already been inspected and posted.', true);
      break;
    case 422:
      showToast((res.data && res.data.message) || 'Validation error: Please check inspection quantities.', true);
      break;
    default: {
      const msg = (res.data && res.data.message) ? res.data.message : 'Request failed.';
      showToast('Inspection failed: ' + msg, true);
      break;
    }
  }
}

async function viewReceivingDetails(receivingId) {
  if (!receivingId) {
    showToast('Receiving record not specified or no longer available.', true, 'Receiving Record');
    return;
  }
  const res = await axios.get(API + 'stock_receiving.php?receiving_id=' + encodeURIComponent(receivingId));
  if (res.status !== 200 || !res.data || !res.data.success) {
    showToast((res.data && res.data.message) || 'Receiving record not found or no longer available.', true, 'Receiving Record');
    return;
  }

  const r = res.data.data;
  const grnCode = r.grn_number || r.receiving_code || ('GRN-' + String(r.receiving_id).padStart(5, '0'));
  const isPending = (r.status || '').toLowerCase() === 'pending inspection';

  document.getElementById('receivingDetailModalTitle').innerHTML = `${escapeHtml(grnCode)} — Goods Receipt Note &amp; Inspection Details`;

  const metaEl = document.getElementById('receivingDetailMeta');
  if (metaEl) {
    metaEl.innerHTML = `
      <div class="col-6 col-md-3">
        <div class="small text-muted text-uppercase fw-semibold">GRN No.</div>
        <div class="fw-bold font-monospace text-primary">${escapeHtml(grnCode)}</div>
      </div>
      <div class="col-6 col-md-3">
        <div class="small text-muted text-uppercase fw-semibold">Supplier DR No.</div>
        <div class="fw-bold font-monospace">${escapeHtml(r.dr_number || '—')}</div>
      </div>
      <div class="col-6 col-md-3">
        <div class="small text-muted text-uppercase fw-semibold">Purchase Order</div>
        <div class="font-monospace fw-semibold">${escapeHtml(r.po_code || ('PO-' + r.po_id))} ${r.pr_code ? `(${escapeHtml(r.pr_code)})` : ''}</div>
      </div>
      <div class="col-6 col-md-3">
        <div class="small text-muted text-uppercase fw-semibold">Inspection Status</div>
        <div>
          ${isPending
            ? '<span class="badge bg-warning text-dark"><i class="bi bi-hourglass-split me-1"></i>Pending Inspection</span>'
            : '<span class="badge bg-success"><i class="bi bi-shield-check me-1"></i>Posted to Inventory</span>'}
        </div>
      </div>
      <div class="col-6 col-md-3 mt-2">
        <div class="small text-muted text-uppercase fw-semibold">Supplier</div>
        <div class="fw-semibold">${escapeHtml(r.supplier_name)}</div>
      </div>
      <div class="col-6 col-md-3 mt-2">
        <div class="small text-muted text-uppercase fw-semibold">Delivered On</div>
        <div>${escapeHtml(r.receiving_date)} &bull; By ${escapeHtml(r.received_by)}</div>
      </div>
      <div class="col-6 col-md-3 mt-2">
        <div class="small text-muted text-uppercase fw-semibold">Inspected On</div>
        <div>${r.inspection_date ? `${escapeHtml(r.inspection_date)} &bull; By ${escapeHtml(r.inspected_by_name || 'Inspector')}` : '<span class="text-muted">Awaiting Inspection</span>'}</div>
      </div>
      <div class="col-6 col-md-3 mt-2">
        <div class="small text-muted text-uppercase fw-semibold">Posted to Inventory</div>
        <div>${r.posted_at ? escapeHtml(r.posted_at) : '<span class="text-muted">Not Yet Posted</span>'}</div>
      </div>
      ${r.remarks ? `<div class="col-12 mt-2 pt-2 border-top small"><strong>Delivery Remarks:</strong> ${escapeHtml(r.remarks)}</div>` : ''}
      ${r.inspection_notes ? `<div class="col-12 mt-1 small"><strong>Inspection Notes:</strong> ${escapeHtml(r.inspection_notes)}</div>` : ''}
    `;
  }

  const tbody = document.getElementById('receivingDetailItemsBody');
  if (tbody) {
    tbody.innerHTML = (r.items || []).map(function (it) {
      const delivered = parseInt(it.quantity_received) || 0;
      const acc = parseInt(it.quantity_accepted) || 0;
      const rej = parseInt(it.quantity_rejected) || 0;
      const quar = parseInt(it.quantity_quarantined) || 0;
      const reason = it.rejection_reason || it.quarantine_reason || it.discrepancy_note || '—';

      return `
        <tr>
          <td class="fw-semibold">${escapeHtml(it.product_name)}</td>
          <td class="text-center font-monospace fw-bold">${delivered}</td>
          <td class="text-center font-monospace ${acc > 0 ? 'text-success fw-bold' : 'text-muted'}">${isPending ? 'Pending' : `+${acc}`}</td>
          <td class="text-center font-monospace ${rej > 0 ? 'text-danger fw-bold' : 'text-muted'}">${isPending ? '—' : rej}</td>
          <td class="text-center font-monospace ${quar > 0 ? 'text-warning-emphasis fw-bold' : 'text-muted'}">${isPending ? '—' : quar}</td>
          <td class="text-end font-monospace">${peso(it.unit_cost || 0)}</td>
          <td class="small text-muted">${escapeHtml(reason)}</td>
        </tr>
      `;
    }).join('');
  }

  const footer = document.getElementById('receivingDetailFooter');
  if (footer) {
    footer.innerHTML = `
      <div>
        ${isPending && can('stock_receiving', 'manage')
          ? `<button type="button" class="btn btn-primary" onclick="closeModal('receivingDetailModal'); openInspectionModal(${r.receiving_id});">
              <i class="bi bi-shield-check me-1"></i>Conduct Inspection Now
            </button>`
          : ''}
      </div>
      <div>
        <button type="button" class="btn btn-outline-secondary me-2" data-bs-dismiss="modal">Close</button>
        <button type="button" class="btn btn-success btn-print-action" onclick="closeModal('receivingDetailModal'); openReceiptModal('stock_receiving', ${r.receiving_id});">
          <i class="bi bi-printer me-1"></i>Print Goods Receipt Note (GRN)
        </button>
      </div>
    `;
  }

  openModal('receivingDetailModal');
}

// Initialise event listeners when DOM ready
document.addEventListener('DOMContentLoaded', function () {
  const receivingForm = document.getElementById('receivingForm');
  if (receivingForm) {
    receivingForm.addEventListener('submit', saveStockReceiving);
  }

  const poSelect = document.getElementById('receiving_po_id');
  if (poSelect) {
    poSelect.addEventListener('change', loadPoItemsForReceiving);
  }
});
