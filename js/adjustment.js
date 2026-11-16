async function loadAdjustments() {
  const res = await axios.get(API + 'adjustment.php');
  switch (res.status) {
    case 200:
      renderAdjustments(res.data.data);
      break;
    case 403:
      showToast('Unauthorized: You do not have permission to view adjustments.', true);
      break;
    default:
      showToast('Failed to load adjustments', true);
      break;
  }
}

function renderAdjustments(rows) {
  const body = document.getElementById('adjustmentTable');
  const mobileList = document.getElementById('adjustmentMobileList');
  if (!rows || rows.length === 0) {
    if (body) renderEmptyRow(body, 'No adjustments yet.', 6);
    if (mobileList) mobileList.innerHTML = '<div class="text-center text-muted p-4 fst-italic">No adjustments yet.</div>';
    return;
  }

  if (body) {
    body.innerHTML = '';
    const tmpl = document.getElementById('tmpl-row-adjustment');
    rows.map(function (r) {
      const clone = tmpl.content.cloneNode(true);
      const dateCell = clone.querySelector('.row-date');
      if (dateCell) dateCell.textContent = r.adjustment_date || '—';
      clone.querySelector('.row-product').textContent = r.product_name;
      const typeCell = clone.querySelector('.row-type');
      if (r.adjustment_type === 'Addition') {
        typeCell.innerHTML = '<span class="badge bg-success">+ Addition</span>';
      } else {
        typeCell.innerHTML = '<span class="badge bg-warning text-dark">&minus; Deduction</span>';
      }
      clone.querySelector('.row-qty').textContent = r.quantity;
      const byCell = clone.querySelector('.row-by');
      if (byCell) byCell.textContent = r.adjusted_by || r.processed_by || '—';
      const reasonCell = clone.querySelector('.row-reason');
      if (reasonCell) reasonCell.textContent = r.reason || '—';
      const printBtn = clone.querySelector('.row-print-btn');
      if (printBtn) {
        printBtn.addEventListener('click', function () {
          openReceiptModal('adjustment', r);
        });
      }
      return clone;
    }).forEach(function (rowNode) {
      body.appendChild(rowNode);
    });
  }

  if (mobileList) {
    mobileList.innerHTML = rows.map(function (r) {
      const isAdd = r.adjustment_type === 'Addition';
      const typeBadge = isAdd
        ? '<span class="badge bg-success">+ Addition</span>'
        : '<span class="badge bg-warning text-dark">&minus; Deduction</span>';
      const qtyClass = isAdd ? 'text-success' : 'text-warning';
      return `
        <div class="gw-mobile-card-item">
          <div class="d-flex justify-content-between align-items-start gap-2 mb-1">
            <strong class="text-dark">${escapeHtml(r.product_name || 'Item')}</strong>
            ${typeBadge}
          </div>
          <div class="d-flex justify-content-between align-items-center small text-muted mb-1">
            <span>Qty: <strong class="${qtyClass}">${isAdd ? '+' : '-'}${escapeHtml(String(r.quantity || 0))}</strong></span>
            <span>${escapeHtml(r.adjustment_date || '—')}</span>
          </div>
          <div class="small text-muted border-top pt-1 mt-1">
            <div><i class="bi bi-person me-1"></i>${escapeHtml(r.adjusted_by || r.processed_by || '—')}</div>
            ${r.reason ? `<div class="fst-italic text-truncate mt-1"><i class="bi bi-chat-left-text me-1"></i>${escapeHtml(r.reason)}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.TableTools) {
    TableTools.enhance('adjustmentTable', { searchPlaceholder: 'Search adjustments...' });
  }
}

async function saveAdjustment(e) {
  e.preventDefault();
  if (txItems.adjustment.length === 0) {
    showToast('Add at least one item to the adjustment', true);
    return;
  }

  const reason = (document.getElementById('adjustment_reason').value || '').trim();
  if (reason.length < 3) {
    showToast('Please provide a valid reason for the stock adjustment (at least 3 characters).', true);
    return;
  }

  if (!window.currentAdjustmentClientToken) {
    window.currentAdjustmentClientToken = 'ADJ-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  const payload = {
    adjustment_date: document.getElementById('adjustment_date').value,
    reason: reason,
    client_token: window.currentAdjustmentClientToken,
    items: txItems.adjustment.map(function (it) {
      return { product_id: it.product_id, quantity: it.quantity, adjustment_type: it.adjustment_type };
    })
  };

  const res = await axios.post(API + 'adjustment.php', payload);
  switch (res.status) {
    case 200:
      window.currentAdjustmentClientToken = 'ADJ-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      handleFormResult(res, 'adjustmentModal', async function () {
        await loadAdjustments();
        const prodRes = await axios.get(API + 'product.php');
        if (prodRes.status === 200 && prodRes.data && prodRes.data.data) {
          cache.products = prodRes.data.data;
        }
      });
      break;
    case 403:
      showToast('Unauthorized: You do not have permission to perform adjustments.', true);
      break;
    case 409:
      showToast((res.data && res.data.message) || 'Insufficient stock for deduction.', true);
      break;
    case 422:
    case 400:
      showToast((res.data && res.data.message) || 'Validation Error: Please check your inputs.', true);
      break;
    default:
      showToast((res.data && res.data.message) || 'Request failed', true);
      break;
  }
}
