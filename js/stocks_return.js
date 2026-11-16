
async function loadStocksReturns() {
  const res = await axios.get(API + 'stocks_return.php');
  switch (res.status) {
    case 200:
      renderStocksReturns(res.data.data);
      break;
    default:
      showToast('Failed to load stocks returns', true);
  }
}

function renderStocksReturns(rows) {
  const body = document.getElementById('sreturnTable');
  const mobileList = document.getElementById('sreturnMobileList');
  if (!rows || rows.length === 0) {
    if (body) renderEmptyRow(body, 'No stocks returns yet.', 5);
    if (mobileList) mobileList.innerHTML = '<div class="text-center text-muted p-4 fst-italic">No stocks returns yet.</div>';
    return;
  }

  if (body) {
    body.innerHTML = '';
    const tmpl = document.getElementById('tmpl-row-sreturn');
    rows.map(function (r) {
      const clone = tmpl.content.cloneNode(true);
      clone.querySelector('.row-by-customer').textContent = r.requested_by;
      clone.querySelector('.row-by-staff').textContent = r.processed_by;
      clone.querySelector('.row-date').textContent = r.return_date;
      clone.querySelector('.row-reason').textContent = r.reason;
      clone.querySelector('.row-items').textContent = r.item_count;
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
            <strong class="text-dark">${escapeHtml(r.requested_by || 'Branch / Requester')}</strong>
            <span class="badge bg-secondary border">${escapeHtml(String(r.item_count || 1))} items</span>
          </div>
          <div class="d-flex justify-content-between align-items-center small text-muted mb-1">
            <span><i class="bi bi-person me-1"></i>${escapeHtml(r.processed_by || 'Staff')}</span>
            <span>${escapeHtml(r.return_date || '—')}</span>
          </div>
          ${r.reason ? `<div class="small text-muted border-top pt-1 mt-1 fst-italic"><i class="bi bi-chat-left-text me-1"></i>${escapeHtml(r.reason)}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  if (window.TableTools) TableTools.enhance('sreturnTable', { searchPlaceholder: 'Search stocks returns...' });
}

async function saveStocksReturn(e) {
  e.preventDefault();
  if (txItems.sreturn.length === 0) {
    showToast('Add at least one item to the return', true);
    return;
  }

  const payload = {
    requested_by: document.getElementById('sreturn_requested_by').value.trim(),
    return_date: document.getElementById('sreturn_date').value,
    reason: document.getElementById('sreturn_reason').value.trim(),
    items: txItems.sreturn.map(function (it) {
      return { product_id: it.product_id, quantity_returned: it.quantity };
    })
  };

  const res = await axios.post(API + 'stocks_return.php', payload);
  switch (res.status) {
    case 200:
      handleFormResult(res, 'sreturnModal', loadStocksReturns);
      break;
    default:
      showToast((res.data && res.data.message) || 'Request failed', true);
  }
}

