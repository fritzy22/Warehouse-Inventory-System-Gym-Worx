let currentProductHealthFilter = 'all';
let currentProductSearchQuery = '';
let currentProductCategoryFilter = '';
let currentProductSortKey = 'product_name';
let currentProductSortDir = 'asc';
let currentProductPage = 1;
const PRODUCT_PAGE_SIZE = 12;

function classifyProductHealth(r) {
  const isReq = typeof authUser !== 'undefined' && authUser && (
    authUser.role_name === 'Store Requester' || 
    authUser.role_id === 4 || 
    (typeof getDashboardRoleProfile === 'function' && getDashboardRoleProfile() === 'requester')
  );
  const stock = isReq
    ? parseInt(r.branch_stock !== undefined ? r.branch_stock : (r.store_stock !== undefined ? r.store_stock : 0)) || 0
    : parseInt(r.available_stock !== undefined ? r.available_stock : r.stock_qty) || 0;
  const reorder = parseInt(r.reorder_level) !== undefined && !isNaN(parseInt(r.reorder_level)) ? parseInt(r.reorder_level) : 10;
  if ((!isReq && Boolean(r.is_critical_stock)) || stock <= 3) {
    return 'critical';
  }
  if ((!isReq && Boolean(r.is_below_reorder)) || stock <= reorder) {
    return 'low';
  }
  return 'healthy';
}

function computeProductStockLevelMetrics(r) {
  const isReq = typeof authUser !== 'undefined' && authUser && (
    authUser.role_name === 'Store Requester' || 
    authUser.role_id === 4 || 
    (typeof getDashboardRoleProfile === 'function' && getDashboardRoleProfile() === 'requester')
  );
  const rawStock = isReq
    ? parseInt(r.branch_stock !== undefined ? r.branch_stock : (r.store_stock !== undefined ? r.store_stock : 0))
    : parseInt(r.available_stock !== undefined ? r.available_stock : r.stock_qty);
  const stock = isNaN(rawStock) ? 0 : rawStock;
  const rawReorder = parseInt(r.reorder_level);
  const reorder = (!isNaN(rawReorder) && rawReorder >= 0) ? rawReorder : 10;
  const rawMax = parseInt(r.max_stock);
  const maxStock = (!isNaN(rawMax) && rawMax > 0) ? rawMax : Math.max(100, reorder * 2);

  const onOrder = Math.max(0, parseInt(r.outstanding_replenishment !== undefined ? r.outstanding_replenishment : (r.outstanding_po_qty !== undefined ? r.outstanding_po_qty : (r.on_order_qty !== undefined ? r.on_order_qty : 0))) || 0);
  const health = classifyProductHealth(r);

  const rawPct = maxStock > 0 ? Math.round((Math.max(0, stock) / maxStock) * 100) : 0;
  const pct = Math.max(0, Math.min(100, rawPct));
  const barWidth = (stock > 0 && pct < 6) ? 6 : pct;

  const isActive = parseInt(r.is_active) === 1;
  let levelLabel = 'Healthy';
  let barClass = 'bar-healthy';
  let textClass = 'text-good';

  if (!isActive) {
    levelLabel = 'Inactive';
    barClass = 'bar-inactive';
    textClass = 'text-inactive';
  } else if (stock <= 0 || health === 'critical') {
    levelLabel = 'Out of Stock';
    barClass = 'bar-critical';
    textClass = 'text-critical';
  } else if (health === 'low' || stock <= reorder) {
    levelLabel = 'Low Stock';
    barClass = 'bar-low';
    textClass = 'text-low';
  } else {
    levelLabel = 'In Stock';
    barClass = 'bar-healthy';
    textClass = 'text-good';
  }

  const needsReorder = (health === 'critical' || health === 'low' || Boolean(r.is_below_reorder) || stock <= reorder);
  const rawAdditional = r.additional_needed_qty !== undefined
    ? parseInt(r.additional_needed_qty)
    : Math.max(0, maxStock - stock - onOrder);
  const suggestedOrder = needsReorder ? Math.max(0, isNaN(rawAdditional) ? 0 : rawAdditional) : 0;

  let statusRank = 3;
  if (parseInt(r.is_active) !== 1) statusRank = 4;
  else if (health === 'critical') statusRank = 1;
  else if (health === 'low') statusRank = 2;

  return {
    stock: stock,
    maxStock: maxStock,
    reorder: reorder,
    onOrder: onOrder,
    suggestedOrder: suggestedOrder,
    pct: pct,
    barWidth: barWidth,
    health: health,
    levelLabel: levelLabel,
    barClass: barClass,
    textClass: textClass,
    statusRank: statusRank
  };
}

function getCategoryBadgeClass(categoryName) {
  const name = String(categoryName || '').toLowerCase();
  if (name.includes('strength') || name.includes('machine')) return 'gw-cat-purple';
  if (name.includes('cardio')) return 'gw-cat-blue';
  if (name.includes('free weight') || name.includes('weight')) return 'gw-cat-green';
  if (name.includes('protein')) return 'gw-cat-pink';
  if (name.includes('pre') || name.includes('post') || name.includes('workout') || name.includes('supplement')) return 'gw-cat-orange';
  return 'gw-cat-slate';
}

async function loadProducts(filterOverride) {
  if (typeof filterOverride === 'string') {
    currentProductHealthFilter = filterOverride;
  }

  const [prodRes, catRes] = await Promise.all([
    axios.get(API + 'product.php'),
    can('category', 'view') ? axios.get(API + 'category.php') : Promise.resolve({ status: 200, data: { data: [] } })
  ]);

  if (prodRes.status !== 200) {
    showToast('Failed to load products', true);
    return;
  }

  cache.products = (prodRes.data && prodRes.data.data) || [];
  if (catRes.status === 200 && catRes.data && catRes.data.data) {
    cache.categories = catRes.data.data;
  }
  populateCategoryDropdown();
  populateCategoryFilterDropdown(cache.categories);
  updateProductAlertStats();
  filterProductsByHealth(currentProductHealthFilter);
}

function populateCategoryFilterDropdown(categories) {
  const sel = document.getElementById('gw_category_productFilter');
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">All Categories</option>' + (categories || []).map(c => `
    <option value="${c.category_id}">${escapeHtml(c.category_name)}</option>
  `).join('');
  sel.value = currentVal;
}

window.handleProductCategoryFilterChange = function() {
  const sel = document.getElementById('gw_category_productFilter');
  currentProductCategoryFilter = sel ? sel.value : '';
  currentProductPage = 1;
  applyProductFiltersAndRender();
};

function updateProductAlertStats() {
  const activeProducts = (cache.products || []).filter(function (p) { return parseInt(p.is_active) === 1; });
  let criticalCount = 0;
  let lowCount = 0;
  let goodCount = 0;

  activeProducts.forEach(function (r) {
    const health = classifyProductHealth(r);
    if (health === 'critical') {
      criticalCount++;
    } else if (health === 'low') {
      lowCount++;
    } else {
      goodCount++;
    }
  });

  const statCritEl = document.getElementById('productStatCritical');
  if (statCritEl) statCritEl.textContent = criticalCount;
  const statLowEl = document.getElementById('productStatLow');
  if (statLowEl) statLowEl.textContent = lowCount;
  const statGoodEl = document.getElementById('productStatGood');
  if (statGoodEl) statGoodEl.textContent = goodCount;
}

function populateCategoryDropdown() {
  const select = document.getElementById('product_category_id');
  if (!select) return;
  const activeCategories = (cache.categories || []).filter(function (c) { return parseInt(c.is_active) === 1; });
  const optionsHtml = activeCategories.map(function (c) {
    return '<option value="' + c.category_id + '">' + escapeHtml(c.category_name) + '</option>';
  }).join('');
  select.innerHTML = '<option value="">Select Category</option>' + optionsHtml;
}

function toggleProductHealthFilter(mode) {
  if (currentProductHealthFilter === mode) {
    filterProductsByHealth('all');
  } else {
    filterProductsByHealth(mode);
  }
}

function toggleLowStockViewButton() {
  if (currentProductHealthFilter === 'low') {
    filterProductsByHealth('all');
  } else {
    filterProductsByHealth('low');
  }
}

function filterProductsByHealth(mode) {
  currentProductHealthFilter = mode || 'all';
  currentProductPage = 1;

  const btns = document.querySelectorAll('[data-product-filter]');
  btns.forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-product-filter') === currentProductHealthFilter);
  });

  const lowBtnText = document.getElementById('btnViewLowStockText');
  const lowBtn = document.getElementById('btnViewLowStock');
  if (lowBtnText && lowBtn) {
    if (currentProductHealthFilter === 'low' || currentProductHealthFilter === 'critical') {
      lowBtnText.textContent = 'Show All Products';
      lowBtn.classList.add('active-filter');
    } else {
      lowBtnText.textContent = 'View Low Stock Items';
      lowBtn.classList.remove('active-filter');
    }
  }

  applyProductFiltersAndRender();
}

function sortProductsBy(key) {
  if (currentProductSortKey === key) {
    currentProductSortDir = currentProductSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    currentProductSortKey = key;
    currentProductSortDir = 'asc';
  }
  updateProductSortHeaders();
  applyProductFiltersAndRender();
}

function updateProductSortHeaders() {
  const headers = document.querySelectorAll('#productMainTable th[data-product-sort]');
  headers.forEach(function (th) {
    const key = th.getAttribute('data-product-sort');
    const icon = th.querySelector('.gw-sort-icon');
    if (!icon) return;
    if (key === currentProductSortKey) {
      th.classList.add('sorted');
      icon.className = 'bi ' + (currentProductSortDir === 'asc' ? 'bi-arrow-up' : 'bi-arrow-down') + ' gw-sort-icon active';
    } else {
      th.classList.remove('sorted');
      icon.className = 'bi bi-arrow-down-up gw-sort-icon';
    }
  });
}

function getFilteredAndSortedProducts() {
  let rows = (cache.products || []).slice();

  // 1. Health filter
  if (currentProductHealthFilter === 'low') {
    rows = rows.filter(function (r) {
      const h = classifyProductHealth(r);
      return parseInt(r.is_active) === 1 && (h === 'low' || h === 'critical');
    });
  } else if (currentProductHealthFilter === 'critical') {
    rows = rows.filter(function (r) {
      return parseInt(r.is_active) === 1 && classifyProductHealth(r) === 'critical';
    });
  } else if (currentProductHealthFilter === 'healthy') {
    rows = rows.filter(function (r) {
      return parseInt(r.is_active) === 1 && classifyProductHealth(r) === 'healthy';
    });
  } else if (currentProductHealthFilter === 'replenish') {
    rows = rows.filter(function (r) {
      const m = computeProductStockLevelMetrics(r);
      return parseInt(r.is_active) === 1 && (m.suggestedOrder > 0 || m.health !== 'healthy');
    });
  }

  // 1b. Category filter
  if (currentProductCategoryFilter && currentProductCategoryFilter !== '') {
    rows = rows.filter(function (r) {
      return String(r.category_id) === String(currentProductCategoryFilter) || String(r.category_name) === String(currentProductCategoryFilter);
    });
  }

  // 2. Search filter
  const q = (currentProductSearchQuery || '').trim().toLowerCase();
  if (q !== '') {
    rows = rows.filter(function (r) {
      const m = computeProductStockLevelMetrics(r);
      const statusText = parseInt(r.is_active) !== 1
        ? 'inactive'
        : (m.health === 'critical' ? 'critical' : (m.health === 'low' ? 'low stock monitor' : 'well stocked healthy good'));
      const hay = [
        r.product_name,
        r.category_name,
        r.unit_measure,
        r.product_id ? ('SKU-' + String(r.product_id).padStart(4, '0')) : '',
        statusText
      ].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  // 3. Sorting
  const dir = currentProductSortDir === 'asc' ? 1 : -1;
  rows.sort(function (a, b) {
    const ma = computeProductStockLevelMetrics(a);
    const mb = computeProductStockLevelMetrics(b);

    let va, vb;
    switch (currentProductSortKey) {
      case 'category_name':
        va = String(a.category_name || '');
        vb = String(b.category_name || '');
        return va.localeCompare(vb) * dir;
      case 'unit_measure':
        va = String(a.unit_measure || '');
        vb = String(b.unit_measure || '');
        return va.localeCompare(vb) * dir;
      case 'unit_price':
        return ((parseFloat(a.unit_price) || 0) - (parseFloat(b.unit_price) || 0)) * dir;
      case 'available_stock':
        return (ma.stock - mb.stock) * dir;
      case 'stock_pct':
        return (ma.pct - mb.pct) * dir;
      case 'on_order':
        return (ma.onOrder - mb.onOrder) * dir;
      case 'suggested_order':
        return (ma.suggestedOrder - mb.suggestedOrder) * dir;
      case 'status_rank':
        return (ma.statusRank - mb.statusRank) * dir;
      case 'product_name':
      default:
        va = String(a.product_name || '');
        vb = String(b.product_name || '');
        return va.localeCompare(vb) * dir;
    }
  });

  return rows;
}

function applyProductFiltersAndRender() {
  const filtered = getFilteredAndSortedProducts();
  renderProducts(filtered);
}

function renderProducts(rows) {
  const body = document.getElementById('productTable');
  const mobileList = document.getElementById('productMobileList');
  if (!body && !mobileList) return;

  const isRequester = authUser && (authUser.role_name === 'Store Requester' || authUser.role_id === 4 || (typeof getDashboardRoleProfile === 'function' && getDashboardRoleProfile() === 'requester'));

  if (isRequester) {
    const titleEl = document.querySelector('.gw-product-page-title');
    const subtitleEl = document.querySelector('.gw-product-page-subtitle');
    const addBtn = document.querySelector('[data-bs-target="#productModal"]');
    if (titleEl) titleEl.textContent = 'My Branch Inventory';
    if (subtitleEl) {
      const branchName = (typeof dashboardData !== 'undefined' && dashboardData && dashboardData.assigned_branch) ? dashboardData.assigned_branch : 'Main Store';
      subtitleEl.textContent = `Current on-hand inventory balances for ${branchName}.`;
    }
    if (addBtn) addBtn.style.display = 'none';

    const thead = document.querySelector('#productMainTable thead');
    if (thead && thead.dataset.mode !== 'requester') {
      thead.dataset.mode = 'requester';
      thead.innerHTML = `
        <tr>
          <th class="ps-3 ps-md-4">PRODUCT</th>
          <th>CATEGORY</th>
          <th class="text-center">CURRENT STOCK</th>
          <th>UNIT</th>
          <th class="pe-3 pe-md-4 text-end">STATUS</th>
        </tr>
      `;
    }
  }

  const total = Array.isArray(rows) ? rows.length : 0;
  const totalPages = Math.max(1, Math.ceil(total / PRODUCT_PAGE_SIZE));
  if (currentProductPage > totalPages) currentProductPage = totalPages;
  if (currentProductPage < 1) currentProductPage = 1;

  const startIdx = (currentProductPage - 1) * PRODUCT_PAGE_SIZE;
  const pageRows = (rows || []).slice(startIdx, startIdx + PRODUCT_PAGE_SIZE);

  renderProductPagination(total, startIdx, pageRows.length, totalPages);

  if (total === 0) {
    if (body) renderEmptyRow(body, 'No matching products found.', 5);
    if (mobileList) {
      mobileList.innerHTML = '';
    }
    return;
  }

  if (body) {
    body.innerHTML = '';

    if (isRequester) {
      const tmplReq = document.getElementById('tmpl-row-product-requester');
      pageRows.map(function (r) {
        if (!tmplReq) return document.createElement('tr');
        const clone = tmplReq.content.cloneNode(true);
        const nameEl = clone.querySelector('.row-name');
        if (nameEl) {
          nameEl.textContent = r.product_name;
          nameEl.style.cursor = 'pointer';
          nameEl.addEventListener('click', function () {
            viewProductDetails(r.product_id, this);
          });
        }
        const catBadge = clone.querySelector('.row-cat');
        if (catBadge) {
          catBadge.textContent = r.category_name || 'Uncategorized';
          catBadge.className = 'row-cat gw-prod-category';
        }
        const stockEl = clone.querySelector('.row-stock');
        const bStock = parseInt(r.branch_stock !== undefined ? r.branch_stock : (r.store_stock !== undefined ? r.store_stock : r.available_stock)) || 0;
        if (stockEl) {
          stockEl.textContent = bStock;
        }
        const unitEl = clone.querySelector('.row-unit');
        if (unitEl) {
          unitEl.textContent = r.unit_measure || 'Unit';
        }
        const statusEl = clone.querySelector('.row-status');
        const reorder = parseInt(r.reorder_level) || 10;
        if (statusEl) {
          if (bStock <= 0) {
            statusEl.innerHTML = '<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1"><i class="bi bi-x-circle me-1"></i>Out of Stock</span>';
          } else if (bStock <= reorder) {
            statusEl.innerHTML = '<span class="badge bg-warning-subtle text-dark border border-warning-subtle px-2 py-1"><i class="bi bi-exclamation-triangle me-1"></i>Low Stock</span>';
          } else {
            statusEl.innerHTML = '<span class="badge bg-success-subtle text-success border border-success-subtle px-2 py-1"><i class="bi bi-check2-circle me-1"></i>In Stock</span>';
          }
        }
        return clone;
      }).forEach(function (rowNode) {
        body.appendChild(rowNode);
      });
      return;
    }

    const tmpl = document.getElementById('tmpl-row-product');
    pageRows.map(function (r) {
      const clone = tmpl.content.cloneNode(true);

      const nameEl = clone.querySelector('.row-name');
      if (nameEl) {
        nameEl.textContent = r.product_name;
      }

      const catBadge = clone.querySelector('.row-cat');
      if (catBadge) {
        catBadge.textContent = r.category_name || 'Uncategorized';
        catBadge.className = 'row-cat gw-prod-category';
      }

      const unitEl = clone.querySelector('.row-unit');
      if (unitEl) {
        unitEl.textContent = r.unit_measure || 'Unit';
      }

      const priceEl = clone.querySelector('.row-price');
      if (priceEl) {
        priceEl.textContent = peso(r.unit_price);
      }

      const actionsCell = clone.querySelector('.row-actions');
      if (actionsCell) {
        const viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className = 'btn btn-sm btn-outline-success gw-btn-view-product';
        viewBtn.setAttribute('aria-label', 'View inventory details for ' + (r.product_name || 'product'));
        viewBtn.innerHTML = '<i class="bi bi-eye me-1" aria-hidden="true"></i><span>View</span>';
        viewBtn.addEventListener('click', function () {
          viewProductDetails(r.product_id, this);
        });
        actionsCell.appendChild(viewBtn);
      }

      return clone;
    }).forEach(function (rowNode) {
      body.appendChild(rowNode);
    });
  }

  if (mobileList) {
    mobileList.innerHTML = '';
  }
}

function renderProductHealthBadgeHtml(r, m) {
  if (parseInt(r.is_active) !== 1) {
    return '<span class="gw-status-badge status-inactive"><i class="bi bi-slash-circle-fill"></i><span>Inactive</span></span>';
  }
  const stock = parseInt(r.available_stock !== undefined ? r.available_stock : (m && m.stock !== undefined ? m.stock : 0)) || 0;
  const reorder = parseInt(r.reorder_level !== undefined ? r.reorder_level : (m && m.reorder !== undefined ? m.reorder : 10)) || 10;

  if (stock <= 0 || (m && m.health === 'critical')) {
    return '<span class="gw-status-badge status-critical"><i class="bi bi-x-octagon-fill"></i><span>Out of Stock</span></span>';
  }
  if (stock <= reorder || (m && m.health === 'low')) {
    return '<span class="gw-status-badge status-low"><i class="bi bi-exclamation-triangle-fill"></i><span>Low Stock</span></span>';
  }
  return '<span class="gw-status-badge status-good"><i class="bi bi-check-circle-fill"></i><span>In Stock</span></span>';
}

function renderProductPagination(total, startIdx, countOnPage, totalPages) {
  const infoEl = document.getElementById('productPaginationInfo');
  const controlsEl = document.getElementById('productPaginationControls');
  if (infoEl) {
    if (total === 0) {
      infoEl.textContent = 'Showing 0 of 0 products';
    } else {
      const from = startIdx + 1;
      const to = startIdx + countOnPage;
      infoEl.textContent = `Showing ${from}–${to} of ${total} product${total === 1 ? '' : 's'}`;
    }
  }
  if (!controlsEl) return;

  let html = '';
  html += `<button type="button" class="gw-page-btn" ${currentProductPage <= 1 ? 'disabled' : ''} data-prod-page="${currentProductPage - 1}" aria-label="Previous page"><i class="bi bi-chevron-left"></i></button>`;
  for (let p = 1; p <= totalPages; p++) {
    const activeCls = p === currentProductPage ? 'active' : '';
    html += `<button type="button" class="gw-page-btn ${activeCls}" data-prod-page="${p}" aria-label="Page ${p}" ${p === currentProductPage ? 'aria-current="page"' : ''}>${p}</button>`;
  }
  html += `<button type="button" class="gw-page-btn" ${currentProductPage >= totalPages ? 'disabled' : ''} data-prod-page="${currentProductPage + 1}" aria-label="Next page"><i class="bi bi-chevron-right"></i></button>`;

  controlsEl.innerHTML = html;
  const pageBtns = controlsEl.querySelectorAll('button[data-prod-page]');
  pageBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (this.disabled) return;
      const targetPage = parseInt(this.getAttribute('data-prod-page'));
      if (!isNaN(targetPage) && targetPage >= 1 && targetPage <= totalPages && targetPage !== currentProductPage) {
        currentProductPage = targetPage;
        applyProductFiltersAndRender();
      }
    });
  });
}

let lastProductModalTrigger = null;

function viewProductDetails(id, triggerEl) {
  const item = findById(cache.products, 'product_id', id);
  if (!item) {
    showToast('Product details not found.', true);
    return;
  }

  lastProductModalTrigger = triggerEl || document.activeElement;

  const m = computeProductStockLevelMetrics(item);
  const isActive = parseInt(item.is_active) === 1;
  const catCls = getCategoryBadgeClass(item.category_name);
  const healthBadge = renderProductHealthBadgeHtml(item, m);

  const onOrderColorClass = !isActive ? 'text-inactive' : 'text-good';
  const suggestedColorClass = !isActive
    ? 'text-inactive'
    : (m.suggestedOrder > 0 ? m.textClass : 'text-good');

  const titleEl = document.getElementById('productDetailModalTitle');
  if (titleEl) titleEl.textContent = 'Inventory Details';

  const bodyEl = document.getElementById('productDetailModalBody');
  if (bodyEl) {
    bodyEl.innerHTML = `
      <!-- Section A: Product Information -->
      <div class="gw-inv-section-a" role="region" aria-label="Product Information">
        <div class="gw-inv-info-row">
          <div class="gw-inv-info-label">Product Name</div>
          <div class="gw-inv-info-value gw-inv-val-bold">${escapeHtml(item.product_name)}</div>
        </div>
        <div class="gw-inv-info-row">
          <div class="gw-inv-info-label">Category</div>
          <div class="gw-inv-info-value">
            <span class="gw-cat-badge ${catCls}">${escapeHtml(item.category_name || 'Uncategorized')}</span>
          </div>
        </div>
        <div class="gw-inv-info-row">
          <div class="gw-inv-info-label">Unit</div>
          <div class="gw-inv-info-value">${escapeHtml(item.unit_measure || 'Unit')}</div>
        </div>
        <div class="gw-inv-info-row">
          <div class="gw-inv-info-label">Unit Price</div>
          <div class="gw-inv-info-value gw-inv-val-bold">${peso(item.unit_price)}</div>
        </div>
      </div>

      <hr class="gw-inv-section-divider" aria-hidden="true">

      <!-- Section B: Inventory Information -->
      <div class="gw-inv-section-b" role="region" aria-label="Inventory Information">
        <div class="gw-inv-table-row">
          <div class="gw-inv-table-label">Available Stock</div>
          <div class="gw-inv-table-value">
            <span class="gw-inv-metric-num ${m.textClass}">${m.stock.toLocaleString('en-US')}</span>
          </div>
        </div>
        <div class="gw-inv-table-row">
          <div class="gw-inv-table-label">Stock Level</div>
          <div class="gw-inv-table-value">
            <div class="gw-inv-stock-level-wrap">
              <div class="gw-inv-stock-track" role="progressbar" aria-valuenow="${m.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Stock Level ${m.pct}% ${escapeHtml(m.levelLabel)}">
                <div class="gw-stock-fill ${m.barClass}" style="width: ${m.barWidth}%;"></div>
              </div>
              <div class="gw-inv-stock-meta">
                <span class="gw-inv-stock-pct">${m.pct}%</span>
                <span class="gw-inv-stock-health ${m.textClass}">${escapeHtml(m.levelLabel)}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="gw-inv-table-row">
          <div class="gw-inv-table-label">On Order</div>
          <div class="gw-inv-table-value">
            <span class="gw-inv-metric-num ${onOrderColorClass}">${m.onOrder.toLocaleString('en-US')}</span>
          </div>
        </div>
        <div class="gw-inv-table-row">
          <div class="gw-inv-table-label">Suggested Order</div>
          <div class="gw-inv-table-value">
            <span class="gw-inv-metric-num ${suggestedColorClass}">${m.suggestedOrder.toLocaleString('en-US')}</span>
          </div>
        </div>
        <div class="gw-inv-table-row">
          <div class="gw-inv-table-label">Status</div>
          <div class="gw-inv-table-value">
            ${healthBadge}
          </div>
        </div>
      </div>
    `;
  }

  const footerEl = document.getElementById('productDetailModalFooter');
  if (footerEl) {
    let footerHtml = '';
    if (typeof can === 'function' && can('product', 'manage')) {
      const toggleLabel = isActive ? 'Deactivate' : 'Reactivate';
      const toggleClass = isActive ? 'btn-outline-danger' : 'btn-outline-success';
      footerHtml += `
        <div class="d-flex flex-wrap align-items-center gap-2 me-auto">
          <button type="button" class="btn btn-sm btn-outline-primary fw-semibold" id="btnDetailEditProduct">
            <i class="bi bi-pencil-square me-1"></i>Edit
          </button>
          <button type="button" class="btn btn-sm ${toggleClass} fw-semibold" id="btnDetailToggleProduct">
            <i class="bi ${isActive ? 'bi-slash-circle' : 'bi-arrow-counterclockwise'} me-1"></i>${toggleLabel}
          </button>
        </div>
      `;
    }
    footerHtml += '<button type="button" class="btn gw-btn-modal-close" data-bs-dismiss="modal">Close</button>';
    footerEl.innerHTML = footerHtml;

    const editBtn = document.getElementById('btnDetailEditProduct');
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        closeModal('productDetailModal');
        setTimeout(function () { editProduct(item.product_id); }, 180);
      });
    }
    const toggleBtn = document.getElementById('btnDetailToggleProduct');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        closeModal('productDetailModal');
        toggleStatus('product.php', item.product_id, isActive ? 0 : 1, loadProducts);
      });
    }
  }

  openModal('productDetailModal');
}

function editProduct(id) {
  const item = findById(cache.products, 'product_id', id);
  if (!item) return;
  populateCategoryDropdown();
  const catSelect = document.getElementById('product_category_id');
  if (catSelect && item.category_id) {
    const exists = Array.from(catSelect.options).some(function (opt) { return String(opt.value) === String(item.category_id); });
    if (!exists && item.category_name) {
      catSelect.insertAdjacentHTML('beforeend', '<option value="' + item.category_id + '">' + escapeHtml(item.category_name) + ' (Inactive)</option>');
    }
    catSelect.value = item.category_id;
  }
  document.getElementById('product_id').value = item.product_id;
  document.getElementById('product_name').value = item.product_name;
  document.getElementById('unit_measure').value = item.unit_measure;
  document.getElementById('unit_price').value = item.unit_price;
  document.getElementById('reorder_level').value = item.reorder_level !== undefined ? item.reorder_level : 10;
  const maxEl = document.getElementById('max_stock');
  if (maxEl) {
    maxEl.value = item.max_stock !== undefined ? item.max_stock : Math.max(100, (parseInt(item.reorder_level) || 10) * 5);
  }
  const openStockRow = document.getElementById('openingStockRow');
  if (openStockRow) openStockRow.hidden = true;
  const openStockInput = document.getElementById('opening_stock');
  if (openStockInput) openStockInput.value = 0;

  document.getElementById('productModalTitle').textContent = 'Edit Product & Stock Limits';
  openModal('productModal');
}

async function saveProduct(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const id = document.getElementById('product_id').value;
  const categoryId = document.getElementById('product_category_id').value;
  const name = (document.getElementById('product_name').value || '').trim();
  const unit = (document.getElementById('unit_measure').value || '').trim();
  const price = document.getElementById('unit_price').value;
  const reorder = document.getElementById('reorder_level').value;
  const maxStockEl = document.getElementById('max_stock');
  const maxStock = maxStockEl ? maxStockEl.value : Math.max(100, (parseInt(reorder) || 10) * 5);
  const openingStockEl = document.getElementById('opening_stock');
  const openingStock = openingStockEl && openingStockEl.value !== '' ? parseInt(openingStockEl.value) : 0;

  if (parseInt(maxStock) < parseInt(reorder)) {
    showToast('Maximum Stock Capacity must be greater than or equal to the Reorder Threshold.', true);
    return;
  }
  if (!id && (isNaN(openingStock) || openingStock < 0)) {
    showToast('Opening stock balance cannot be negative.', true);
    return;
  }

  let res;
  if (id) {
    res = await axios.put(API + 'product.php', {
      product_id: parseInt(id),
      category_id: parseInt(categoryId),
      product_name: name,
      unit_measure: unit,
      unit_price: parseFloat(price),
      reorder_level: parseInt(reorder),
      max_stock: parseInt(maxStock)
    });
  } else {
    formData.set('category_id', categoryId);
    formData.set('product_name', name);
    formData.set('unit_measure', unit);
    formData.set('unit_price', price);
    formData.set('reorder_level', reorder);
    formData.set('max_stock', maxStock);
    formData.set('opening_stock', String(Math.max(0, openingStock)));
    res = await axios.post(API + 'product.php', formData);
  }

  switch (res.status) {
    case 200:
      handleFormResult(res, 'productModal', loadProducts);
      break;
    case 403:
      showToast('Unauthorized: You do not have permission to manage products.', true);
      break;
    case 409:
      showToast((res.data && res.data.message) || 'A product with this name already exists.', true);
      break;
    case 422:
    case 400:
      showToast((res.data && res.data.message) || 'Validation Error: Please check your input fields.', true);
      break;
    case 500:
      showToast('Server Error: Please try again later.', true);
      break;
    default: {
      const msg = (res.data && res.data.message) ? res.data.message : 'Request failed.';
      showToast('Error ' + res.status + ': ' + msg, true);
      break;
    }
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const mobSearch = document.getElementById('gw_search_productTable');

  if (mobSearch) {
    mobSearch.addEventListener('input', function () {
      currentProductSearchQuery = this.value || '';
      currentProductPage = 1;
      applyProductFiltersAndRender();
    });
  }

  const detailModalEl = document.getElementById('productDetailModal');
  if (detailModalEl) {
    detailModalEl.addEventListener('shown.bs.modal', function () {
      const closeBtn = detailModalEl.querySelector('.gw-btn-modal-close') || detailModalEl.querySelector('.btn-close');
      if (closeBtn && typeof closeBtn.focus === 'function') {
        closeBtn.focus();
      }
    });
    detailModalEl.addEventListener('hidden.bs.modal', function () {
      if (lastProductModalTrigger && typeof lastProductModalTrigger.focus === 'function' && document.body.contains(lastProductModalTrigger)) {
        lastProductModalTrigger.focus();
      }
      lastProductModalTrigger = null;
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      const modalEl = document.getElementById('productDetailModal');
      if (modalEl && modalEl.classList.contains('show')) {
        closeModal('productDetailModal');
        return;
      }
    }
  });
});

