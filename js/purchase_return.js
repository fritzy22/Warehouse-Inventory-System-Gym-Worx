
let preturnSourcesCache = [];

async function loadPurchaseReturns() {
  const [res, srcRes] = await Promise.all([
    axios.get(API + 'purchase_return.php'),
    axios.get(API + 'purchase_return.php?mode=sources')
  ]);

  if (res.status === 200 && res.data && res.data.data) {
    renderPurchaseReturns(res.data.data);
  } else {
    showToast('Failed to load purchase returns', true);
  }

  if (srcRes.status === 200 && srcRes.data && srcRes.data.data) {
    preturnSourcesCache = srcRes.data.data.receivings || [];
    populatePreturnSources();
  }
}

function populatePreturnSources() {
  const sel = document.getElementById('preturn_source_select');
  if (!sel) return;

  sel.innerHTML = '<option value="">-- Manual Return (No Linked Delivery) --</option>' + preturnSourcesCache.map(function (s) {
    const drText = s.dr_number ? ` (DR: ${escapeHtml(s.dr_number)})` : '';
    const dmgText = s.total_damaged > 0 ? ` [${s.total_damaged} damaged]` : '';
    return `<option value="${s.receiving_id}">${escapeHtml(s.receiving_code)} — ${escapeHtml(s.po_code)}${drText} &bull; ${escapeHtml(s.supplier_name)}${dmgText}</option>`;
  }).join('');
}

function handlePreturnSourceChange() {
  const sel = document.getElementById('preturn_source_select');
  const rcvId = sel ? sel.value : '';
  const poIdInput = document.getElementById('preturn_po_id');
  const rcvIdInput = document.getElementById('preturn_receiving_id');
  const supSel = document.getElementById('preturn_supplier_id');
  const reasonInput = document.getElementById('preturn_reason');

  if (!rcvId) {
    if (poIdInput) poIdInput.value = '';
    if (rcvIdInput) rcvIdInput.value = '';
    return;
  }

  const src = preturnSourcesCache.find(s => parseInt(s.receiving_id) === parseInt(rcvId));
  if (src) {
    if (poIdInput) poIdInput.value = src.po_id || '';
    if (rcvIdInput) rcvIdInput.value = src.receiving_id || '';
    if (supSel && src.supplier_id) {
      supSel.value = String(src.supplier_id);
    }
    if (reasonInput && (!reasonInput.value || reasonInput.value.trim() === '')) {
      reasonInput.value = src.total_damaged > 0
        ? `Return of damaged items received under ${src.receiving_code} (${src.po_code})`
        : `Return linked to ${src.receiving_code} (${src.po_code})`;
    }
  }
}

function renderPurchaseReturns(rows) {
  const body = document.getElementById('preturnTable');
  const mobileList = document.getElementById('preturnMobileList');
  if (!rows || rows.length === 0) {
    if (body) renderEmptyRow(body, 'No purchase returns yet.', 5);
    if (mobileList) mobileList.innerHTML = '<div class="text-center text-muted p-4 fst-italic">No purchase returns yet.</div>';
    return;
  }

  if (body) {
    body.innerHTML = '';
    const tmpl = document.getElementById('tmpl-row-preturn');
    rows.map(function (r) {
      const clone = tmpl.content.cloneNode(true);
      const supplierCell = clone.querySelector('.row-supplier');
      if (supplierCell) {
        supplierCell.innerHTML = `
          <div class="fw-bold">${escapeHtml(r.supplier_name)}</div>
          <div class="small font-monospace text-muted">${escapeHtml(r.return_code || '')} ${r.po_code ? `&bull; Ref: ${escapeHtml(r.po_code)}` : ''}</div>
        `;
      }
      clone.querySelector('.row-by').textContent = r.returned_by;
      clone.querySelector('.row-date').textContent = r.return_date;
      clone.querySelector('.row-reason').textContent = r.reason || '—';
      clone.querySelector('.row-items').textContent = (r.total_returned_qty !== undefined ? r.total_returned_qty : r.item_count) + ' units (' + r.item_count + ' items)';
      return clone;
    }).forEach(function (node) {
      body.appendChild(node);
    });
  }

  if (mobileList) {
    mobileList.innerHTML = rows.map(function (r) {
      return `
        <div class="gw-mobile-card-item">
          <div class="d-flex justify-content-between align-items-start gap-2 mb-1">
            <div>
              <strong class="text-dark">${escapeHtml(r.supplier_name || 'Supplier')}</strong>
              <div class="small font-monospace text-muted">${escapeHtml(r.return_code || '')} ${r.po_code ? `&bull; ${escapeHtml(r.po_code)}` : ''}</div>
            </div>
            <span class="badge bg-danger-subtle text-danger border">${escapeHtml(String(r.item_count || 1))} items</span>
          </div>
          <div class="d-flex justify-content-between align-items-center small text-muted mb-1">
            <span><i class="bi bi-person me-1"></i>${escapeHtml(r.returned_by || 'Staff')}</span>
            <span>${escapeHtml(r.return_date || '—')}</span>
          </div>
          ${r.reason ? `<div class="small text-muted border-top pt-1 mt-1 fst-italic"><i class="bi bi-chat-left-text me-1"></i>${escapeHtml(r.reason)}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  if (window.TableTools) TableTools.enhance('preturnTable', { searchPlaceholder: 'Search purchase returns...' });
}

async function savePurchaseReturn(e) {
  e.preventDefault();
  if (txItems.preturn.length === 0) {
    showToast('Add at least one item to the return', true);
    return;
  }

  const poIdVal = document.getElementById('preturn_po_id') ? document.getElementById('preturn_po_id').value : '';
  const rcvIdVal = document.getElementById('preturn_receiving_id') ? document.getElementById('preturn_receiving_id').value : '';

  const payload = {
    supplier_id: document.getElementById('preturn_supplier_id').value,
    return_date: document.getElementById('preturn_date').value,
    reason: document.getElementById('preturn_reason').value.trim(),
    items: txItems.preturn.map(function (it) {
      return { product_id: it.product_id, quantity_returned: it.quantity };
    })
  };
  if (poIdVal && parseInt(poIdVal) > 0) {
    payload.po_id = parseInt(poIdVal);
  }
  if (rcvIdVal && parseInt(rcvIdVal) > 0) {
    payload.receiving_id = parseInt(rcvIdVal);
  }

  const res = await axios.post(API + 'purchase_return.php', payload);
  switch (res.status) {
    case 200:
      handleFormResult(res, 'preturnModal', function () {
        loadPurchaseReturns();
        if (typeof loadDashboard === 'function') loadDashboard();
      });
      break;
    default:
      showToast((res.data && res.data.message) || 'Request failed', true);
  }
}

