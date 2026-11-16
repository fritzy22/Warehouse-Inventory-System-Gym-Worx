
let pendingPrReleasesCache = [];
let rawReleaseHistoryCache = [];
let rawStoreInventoryCache = [];

async function loadStockReleasing() {
  const [relRes] = await Promise.all([
    axios.get(API + 'stock_releasing.php'),
    loadPendingPrReleases(),
    loadStoreInventory()
  ]);

  if (relRes.status === 200 && relRes.data && relRes.data.data) {
    rawReleaseHistoryCache = relRes.data.data;
    renderStockReleasing(rawReleaseHistoryCache);
  } else {
    showToast('Failed to load stock releasing records', true);
  }
}

async function loadPendingPrReleases() {
  const card = document.getElementById('releasingPendingPrCard');
  const tbody = document.getElementById('releasingPendingPrBody');
  const countBadge = document.getElementById('releasingPendingPrCount');
  const emptyBox = document.getElementById('releasingPendingPrEmpty');
  const tableWrap = document.getElementById('releasingPendingPrTableWrapper');
  if (!card || !tbody) return;

  if (typeof can === 'function' && !can('stock_releasing', 'manage')) {
    card.hidden = true;
    return;
  }

  card.hidden = false;

  try {
    const res = await axios.get(API + 'stock_releasing.php?mode=pending_pr_releases');
    if (res.status !== 200 || !res.data || !res.data.success) {
      if (emptyBox) emptyBox.style.display = 'none';
      if (tableWrap) tableWrap.style.display = 'block';
      if (countBadge) countBadge.textContent = '0 Ready';
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center py-3 text-muted">
            <div class="d-flex align-items-center justify-content-center gap-2">
              <i class="bi bi-exclamation-circle text-warning"></i>
              <span>Could not load pending store requests.</span>
              <button type="button" class="btn btn-sm btn-link p-0 text-decoration-none" onclick="loadPendingPrReleases()">Retry</button>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    pendingPrReleasesCache = res.data.data || [];
    renderPendingStoreRequests(pendingPrReleasesCache);
  } catch (err) {
    console.error('Failed to load pending store requests for release:', err);
    if (emptyBox) emptyBox.style.display = 'none';
    if (tableWrap) tableWrap.style.display = 'block';
    if (countBadge) countBadge.textContent = '0 Ready';
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center py-3 text-muted">
          <div class="d-flex align-items-center justify-content-center gap-2">
            <i class="bi bi-exclamation-circle text-warning"></i>
            <span>Could not load pending store requests.</span>
            <button type="button" class="btn btn-sm btn-link p-0 text-decoration-none" onclick="loadPendingPrReleases()">Retry</button>
          </div>
        </td>
      </tr>
    `;
  }
}

function renderPendingStoreRequests(list) {
  const tbody = document.getElementById('releasingPendingPrBody');
  const countBadge = document.getElementById('releasingPendingPrCount');
  const emptyBox = document.getElementById('releasingPendingPrEmpty');
  const tableWrap = document.getElementById('releasingPendingPrTableWrapper');
  if (!tbody) return;

  if (tableWrap) tableWrap.style.display = 'block';

  if (!list || list.length === 0) {
    if (emptyBox) emptyBox.style.display = 'flex';
    if (countBadge) countBadge.textContent = '0 Ready';
    tbody.innerHTML = `
      <tr id="releasingPendingPrEmptyRow">
        <td colspan="5" class="text-center py-5 text-muted border-0 align-middle">
          <div class="d-flex flex-column align-items-center justify-content-center py-4" id="releasingPendingPrEmpty">
            <i class="bi bi-box-seam fs-1 mb-2 opacity-50" aria-hidden="true"></i>
            <div class="fw-semibold gw-empty-title mb-1">No approved store requests ready for release.</div>
            <small class="text-muted gw-empty-sub">Approved requests will appear here when available.</small>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  if (emptyBox) emptyBox.style.display = 'none';
  if (countBadge) countBadge.textContent = list.length + ' Ready';

  tbody.innerHTML = list.map(function (pr) {
    const items = pr.items || [];
    const itemsSummary = items.map(it => `${escapeHtml(it.product_name)} (${it.authorized_qty})`).join(', ');

    return `
      <tr>
        <td class="font-monospace fw-bold">${escapeHtml(pr.pr_code)}</td>
        <td><span class="badge bg-secondary-subtle text-secondary-emphasis border">${escapeHtml(pr.store_name || 'Main Store')}</span></td>
        <td>
          <div class="fw-semibold">${escapeHtml(pr.requested_by_name || '—')}</div>
          <div class="text-muted" style="font-size:0.72rem;">Approved by ${escapeHtml(pr.approved_by_name || 'Manager')}</div>
        </td>
        <td class="small">${escapeHtml(itemsSummary)}</td>
        <td class="text-end">
          <button type="button" class="btn btn-sm btn-outline-success btn-release-action py-0 px-2" onclick="openFulfillStoreRequestModal(${pr.pr_id})">
            <i class="bi bi-truck me-1"></i>Release
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterPendingRequests(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    renderPendingStoreRequests(pendingPrReleasesCache);
    return;
  }
  const filtered = pendingPrReleasesCache.filter(function (pr) {
    const prCode = (pr.pr_code || '').toLowerCase();
    const storeName = (pr.store_name || '').toLowerCase();
    const reqBy = (pr.requested_by_name || '').toLowerCase();
    const appBy = (pr.approved_by_name || '').toLowerCase();
    const items = (pr.items || []).map(function (it) { return (it.product_name || '').toLowerCase(); }).join(' ');
    return prCode.includes(q) || storeName.includes(q) || reqBy.includes(q) || appBy.includes(q) || items.includes(q);
  });
  renderPendingStoreRequests(filtered);
}

function filterReleaseHistory(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    renderStockReleasing(rawReleaseHistoryCache);
    return;
  }
  const filtered = rawReleaseHistoryCache.filter(function (r) {
    const code = (r.releasing_code || ('REL-' + String(r.releasing_id).padStart(4, '0'))).toLowerCase();
    const prRef = (r.pr_code || '').toLowerCase();
    const to = (r.requested_by || '').toLowerCase();
    const by = (r.released_by || '').toLowerCase();
    return code.includes(q) || prRef.includes(q) || to.includes(q) || by.includes(q);
  });
  renderStockReleasing(filtered);
}

function filterStoreInventory(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    renderStoreInventoryRows(rawStoreInventoryCache);
    return;
  }
  const filtered = rawStoreInventoryCache.filter(function (r) {
    const store = (r.store_name || '').toLowerCase();
    const product = (r.product_name || '').toLowerCase();
    const cat = (r.category_name || '').toLowerCase();
    return store.includes(q) || product.includes(q) || cat.includes(q);
  });
  renderStoreInventoryRows(filtered);
}

async function loadStoreInventory() {
  const tbody = document.getElementById('releasingStoreInventoryBody');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="6" class="text-center py-4 text-muted">
        <div class="spinner-border spinner-border-sm me-2 text-primary" role="status" aria-hidden="true"></div>
        <span>Loading store inventory...</span>
      </td>
    </tr>
  `;

  try {
    const res = await axios.get(API + 'stock_releasing.php?mode=store_inventory');
    if (res.status !== 200 || !res.data || !res.data.success) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-4 text-danger">
            <div class="d-flex flex-column align-items-center justify-content-center">
              <i class="bi bi-exclamation-triangle fs-3 mb-2" aria-hidden="true"></i>
              <div class="fw-semibold mb-2">Failed to load store inventory.</div>
              <button type="button" class="btn btn-sm btn-outline-secondary" onclick="loadStoreInventory()">
                <i class="bi bi-arrow-clockwise me-1"></i>Retry
              </button>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    rawStoreInventoryCache = res.data.data || [];
    renderStoreInventoryRows(rawStoreInventoryCache);
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-4 text-danger">
          <div class="d-flex flex-column align-items-center justify-content-center">
            <i class="bi bi-exclamation-triangle fs-3 mb-2" aria-hidden="true"></i>
            <div class="fw-semibold mb-2">Failed to load store inventory.</div>
            <button type="button" class="btn btn-sm btn-outline-secondary" onclick="loadStoreInventory()">
              <i class="bi bi-arrow-clockwise me-1"></i>Retry
            </button>
          </div>
        </td>
      </tr>
    `;
  }
}

function renderStoreInventoryRows(rows) {
  const tbody = document.getElementById('releasingStoreInventoryBody');
  if (!tbody) return;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-5">
          <div class="d-flex flex-column align-items-center justify-content-center text-muted">
            <i class="bi bi-box-seam fs-1 mb-2 opacity-50" aria-hidden="true"></i>
            <div class="fw-semibold gw-empty-title mb-1">No store inventory records available.</div>
            <small class="text-muted gw-empty-sub">Branch inventory balances will appear here when records are available.</small>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map(function (r) {
    return `
      <tr>
        <td><strong class="text-dark gw-store-name">${escapeHtml(r.store_name)}</strong></td>
        <td class="fw-semibold">${escapeHtml(r.product_name)}</td>
        <td><span class="badge bg-light text-dark border gw-badge-category">${escapeHtml(r.category_name || 'General')}</span></td>
        <td class="text-muted small">${escapeHtml(r.unit_measure || 'pcs')}</td>
        <td class="text-center font-monospace fw-bold text-success fs-6">${r.quantity}</td>
        <td class="small text-muted">${escapeHtml(r.updated_at || '—')}</td>
      </tr>
    `;
  }).join('');
}

function resetReleasingModalForManual() {
  const prIdInput = document.getElementById('releasing_pr_id');
  const storeInput = document.getElementById('releasing_destination_store');
  const banner = document.getElementById('releasingPrFulfillmentBanner');
  const modalTitle = document.getElementById('releasingModalTitle');
  const requestedBy = document.getElementById('releasing_requested_by');

  if (prIdInput) prIdInput.value = '';
  if (storeInput) storeInput.value = '';
  if (banner) banner.hidden = true;
  if (modalTitle) modalTitle.textContent = 'Release Stock';
  if (requestedBy) requestedBy.value = '';
  txItems.releasing = [];
  renderLineItemsTable('releasing');
}

async function openFulfillStoreRequestModal(prId) {
  const pr = pendingPrReleasesCache.find(p => parseInt(p.pr_id) === parseInt(prId));
  if (!pr) {
    showToast('Store request not found', true);
    return;
  }

  await resetModalForAdd('releasingModal');
  const prIdInput = document.getElementById('releasing_pr_id');
  const storeInput = document.getElementById('releasing_destination_store');
  const banner = document.getElementById('releasingPrFulfillmentBanner');
  const bannerText = document.getElementById('releasingPrFulfillmentText');
  const modalTitle = document.getElementById('releasingModalTitle');
  const requestedBy = document.getElementById('releasing_requested_by');

  const storeName = pr.store_name || 'Main Store';
  if (prIdInput) prIdInput.value = pr.pr_id;
  if (storeInput) storeInput.value = storeName;
  if (banner) banner.hidden = false;
  if (bannerText) {
    bannerText.innerHTML = `Fulfilling Store Request <strong>${escapeHtml(pr.pr_code)}</strong> to <strong>${escapeHtml(storeName)}</strong>. On release, central warehouse stock will be decremented and store inventory will be incremented.`;
  }
  if (modalTitle) modalTitle.textContent = 'Fulfill Store Request: ' + pr.pr_code;
  if (requestedBy) requestedBy.value = storeName + ' (' + (pr.requested_by_name || 'Requester') + ')';

  // Prepopulate items from approved PR
  txItems.releasing = (pr.items || []).map(function (it) {
    return {
      product_id: parseInt(it.product_id),
      product_name: it.product_name,
      quantity: parseInt(it.authorized_qty) || 1
    };
  });

  renderLineItemsTable('releasing');
  openModal('releasingModal');
}

function renderStockReleasing(rows) {
  const body = document.getElementById('releasingTable');
  const mobileList = document.getElementById('releasingMobileList');
  if (!rows || rows.length === 0) {
    if (body) renderEmptyRow(body, 'No stock releasing records yet.', 6);
    if (mobileList) mobileList.innerHTML = '<div class="text-center text-muted p-4 fst-italic">No stock releasing records yet.</div>';
    return;
  }

  if (body) {
    body.innerHTML = '';
    const tmpl = document.getElementById('tmpl-row-releasing');
    rows.map(function (r) {
      const clone = tmpl.content.cloneNode(true);
      const codeEl = clone.querySelector('.row-code');
      if (codeEl) codeEl.textContent = r.releasing_code || ('REL-' + String(r.releasing_id).padStart(4, '0'));
      const refEl = clone.querySelector('.row-pr-ref');
      if (refEl) {
        refEl.textContent = r.pr_code ? ('Ref: ' + r.pr_code) : '';
      }
      clone.querySelector('.row-to').textContent = r.requested_by;
      clone.querySelector('.row-by').textContent = r.released_by;
      clone.querySelector('.row-date').textContent = r.releasing_date;
      clone.querySelector('.row-items').textContent = (r.total_quantity !== undefined ? r.total_quantity : r.item_count) + ' units (' + r.item_count + ' items)';

      const actionsCell = clone.querySelector('.row-actions');
      if (actionsCell) {
        const printBtn = document.createElement('button');
        printBtn.type = 'button';
        printBtn.className = 'btn btn-sm btn-print-action gw-btn-print-receipt stock-release-print-btn';
        printBtn.setAttribute('title', 'Print Receipt');
        printBtn.setAttribute('aria-label', 'Print Receipt');
        printBtn.setAttribute('data-bs-toggle', 'tooltip');
        printBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-printer" aria-hidden="true"><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>';
        printBtn.addEventListener('click', function () {
          openReceiptModal('sale', {
            transaction_id: r.releasing_id,
            customer_name: r.requested_by,
            date: r.releasing_date,
            user_name: r.released_by,
            status: 'Completed'
          });
        });
        actionsCell.appendChild(printBtn);
      }

      return clone;
    }).forEach(function (node) {
      body.appendChild(node);
    });
  }

  if (mobileList) {
    mobileList.innerHTML = '';
    rows.forEach(function (r) {
      const card = document.createElement('div');
      card.className = 'gw-mobile-card-item';
      card.innerHTML = `
        <div class="d-flex justify-content-between align-items-start gap-2 mb-1">
          <div>
            <strong class="text-dark">${escapeHtml(r.requested_by || 'Branch')}</strong>
            ${r.pr_code ? `<div class="small text-muted font-monospace">Ref: ${escapeHtml(r.pr_code)}</div>` : ''}
          </div>
          <span class="badge bg-secondary border">${escapeHtml(String(r.item_count || 1))} items</span>
        </div>
        <div class="d-flex justify-content-between align-items-center small text-muted mb-2">
          <span><i class="bi bi-person me-1"></i>${escapeHtml(r.released_by || 'Staff')}</span>
          <span>${escapeHtml(r.releasing_date || '—')}</span>
        </div>
        <div class="d-flex justify-content-end mt-2 border-top pt-2">
          <button type="button" class="btn btn-sm btn-print-action gw-btn-print-receipt stock-release-print-btn btn-print-receipt" title="Print Receipt" aria-label="Print Receipt" data-bs-toggle="tooltip">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-printer" aria-hidden="true"><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>
          </button>
        </div>
      `;
      const btn = card.querySelector('.btn-print-receipt');
      if (btn) {
        btn.addEventListener('click', function () {
          openReceiptModal('sale', {
            transaction_id: r.releasing_id,
            customer_name: r.requested_by,
            date: r.releasing_date,
            user_name: r.released_by,
            status: 'Completed'
          });
        });
      }
      mobileList.appendChild(card);
    });
  }

  if (window.TableTools) TableTools.enhance('releasingTable', { searchPlaceholder: 'Search stock releasing...', showToolbar: false });
}

async function saveStockReleasing(e) {
  e.preventDefault();
  if (txItems.releasing.length === 0) {
    showToast('Add at least one item to release', true);
    return;
  }

  const prIdVal = document.getElementById('releasing_pr_id') ? document.getElementById('releasing_pr_id').value : '';
  const destStoreVal = document.getElementById('releasing_destination_store') ? document.getElementById('releasing_destination_store').value : '';

  const payload = {
    requested_by: document.getElementById('releasing_requested_by').value.trim(),
    releasing_date: document.getElementById('releasing_date').value,
    items: txItems.releasing.map(function (it) {
      return { product_id: it.product_id, quantity_released: it.quantity };
    })
  };
  if (prIdVal && parseInt(prIdVal) > 0) {
    payload.pr_id = parseInt(prIdVal);
    payload.destination_store = destStoreVal || 'Main Store';
  }

  const res = await axios.post(API + 'stock_releasing.php', payload);
  switch (res.status) {
    case 200:
      handleFormResult(res, 'releasingModal', function () {
        loadStockReleasing();
        if (typeof loadDashboard === 'function') loadDashboard();
      });
      break;
    default:
      showToast((res.data && res.data.message) || 'Request failed', true);
  }
}
