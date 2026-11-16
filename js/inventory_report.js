
async function loadInventoryReport() {
  const [prodRes, catRes] = await Promise.all([
    axios.get(API + 'product.php'),
    axios.get(API + 'category.php')
  ]);

  const failed = [prodRes, catRes].find(function (r) { return r.status !== 200; });

  switch (failed ? failed.status : 200) {
    case 200:
      cache.products = prodRes.data.data;
      cache.categories = catRes.data.data;
      populateInventoryFilterDropdown();
      renderInventoryReport(cache.products);
      break;
    default:
      showToast('Failed to load inventory report', true);
      break;
  }
}

function populateInventoryFilterDropdown() {
  const select = document.getElementById('inventoryFilterCategory');
  if (!select) return;
  const activeCategories = cache.categories.filter(function (c) { return parseInt(c.is_active) === 1; });
  const optionsHtml = activeCategories.map(function (c) {
    return '<option value="' + c.category_id + '">' + escapeHtml(c.category_name) + '</option>';
  }).join('');
  select.innerHTML = '<option value="">All Categories</option>' + optionsHtml;

  select.removeEventListener('change', handleInventoryFilterChange);
  select.addEventListener('change', handleInventoryFilterChange);
}

function handleInventoryFilterChange() {
  const categoryId = document.getElementById('inventoryFilterCategory').value;
  const filtered = categoryId
    ? cache.products.filter(function (p) { return String(p.category_id) === String(categoryId); })
    : cache.products;
  renderInventoryReport(filtered);
}

function renderInventoryReport(rows) {
  const body = document.getElementById('inventoryReportTable');
  if (!body) return;

  const activeRows = rows ? rows.filter(function (r) { return parseInt(r.is_active) === 1; }) : [];

  if (activeRows.length === 0) {
    renderEmptyRow(body, 'No products found.', 7);
    updateInventorySummary([]);
    return;
  }

  body.innerHTML = '';
  const tmpl = document.getElementById('tmpl-row-inventory');

  activeRows.map(function (r) {
    const clone = tmpl.content.cloneNode(true);
    clone.querySelector('.row-name').textContent = r.product_name;
    clone.querySelector('.row-cat').textContent = r.category_name;
    clone.querySelector('.row-unit').textContent = r.unit_measure;
    clone.querySelector('.row-price').textContent = peso(r.unit_price);

    const stock = parseInt(r.stock_qty) || 0;
    const reorder = parseInt(r.reorder_level) || 0;
    const stockCell = clone.querySelector('.row-stock');
    stockCell.textContent = stock;

    clone.querySelector('.row-reorder').textContent = r.reorder_level;

    const statusCell = clone.querySelector('.row-status-indicator');
    if (stock <= 0) {
      statusCell.innerHTML = '<span class="badge bg-danger">Out of Stock</span>';
    } else if (stock <= reorder) {
      statusCell.innerHTML = '<span class="badge bg-warning text-dark">Low Stock</span>';
    } else {
      statusCell.innerHTML = '<span class="badge bg-success">In Stock</span>';
    }

    return clone;
  }).forEach(function (rowNode) {
    body.appendChild(rowNode);
  });

  updateInventorySummary(activeRows);
}

function updateInventorySummary(activeRows) {
  const qtyEl = document.getElementById('inventoryTotalQty');
  const valueEl = document.getElementById('inventoryEstimatedValue');

  const totalQtyOnHand = activeRows.reduce(function (total, r) {
    return total + (parseInt(r.stock_qty) || 0);
  }, 0);

  const totalInventoryValue = activeRows.reduce(function (total, r) {
    return total + ((parseInt(r.stock_qty) || 0) * (parseFloat(r.unit_price) || 0));
  }, 0);

  if (qtyEl) qtyEl.textContent = totalQtyOnHand.toLocaleString('en-US');
  if (valueEl) valueEl.textContent = peso(totalInventoryValue);
}

async function openInventoryReportModal() {
  const modalEl = document.getElementById('inventoryReportModal');
  if (!modalEl) return;

  if (!cache.products || cache.products.length === 0) {
    await loadInventoryReport();
  }

  const categorySelect = document.getElementById('inventoryFilterCategory');
  const categoryId = categorySelect ? categorySelect.value : '';
  const categoryName = categorySelect && categorySelect.selectedIndex >= 0
    ? categorySelect.options[categorySelect.selectedIndex].text
    : 'All Categories';

  const activeProducts = (cache.products || []).filter(function (p) {
    if (parseInt(p.is_active) !== 1) return false;
    if (categoryId && String(p.category_id) !== String(categoryId)) return false;
    return true;
  });

  const now = new Date();
  const dateStr = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const dateEl = document.getElementById('invModalGeneratedDate');
  if (dateEl) dateEl.textContent = 'Generated: ' + dateStr;

  const catEl = document.getElementById('invModalCategoryName');
  if (catEl) catEl.textContent = categoryName;

  const userEl = document.getElementById('invModalUserName');
  if (userEl) {
    userEl.textContent = (typeof authUser !== 'undefined' && authUser)
      ? (authUser.first_name + ' ' + authUser.last_name)
      : 'Authorized Staff';
  }

  const itemsCountEl = document.getElementById('invModalTotalItemsCount');
  if (itemsCountEl) itemsCountEl.textContent = activeProducts.length + ' active products';

  let totalQty = 0;
  let totalVal = 0;
  let inStockCount = 0;
  let lowStockCount = 0;
  let outStockCount = 0;

  const tbody = document.getElementById('invModalTableBody');
  if (tbody) {
    tbody.innerHTML = '';
    if (activeProducts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-3 text-muted fst-italic">No products found in this category.</td></tr>';
    } else {
      activeProducts.forEach(function (p, idx) {
        const qty = parseInt(p.stock_qty) || 0;
        const reorder = parseInt(p.reorder_level) || 0;
        const price = parseFloat(p.unit_price) || 0;
        const rowVal = qty * price;

        totalQty += qty;
        totalVal += rowVal;

        let statusBadge = '<span class="badge bg-success">In Stock</span>';
        if (qty <= 0) {
          statusBadge = '<span class="badge bg-danger">Out of Stock</span>';
          outStockCount++;
        } else if (qty <= reorder) {
          statusBadge = '<span class="badge bg-warning text-dark">Low Stock</span>';
          lowStockCount++;
        } else {
          inStockCount++;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="text-center text-muted small">${idx + 1}</td>
          <td><div class="fw-semibold text-dark text-break">${escapeHtml(p.product_name)}</div></td>
          <td>${escapeHtml(p.category_name || '-')}</td>
          <td class="text-center">${escapeHtml(p.unit_measure || '-')}</td>
          <td class="text-end font-monospace text-nowrap">${peso(price)}</td>
          <td class="text-center font-monospace fw-bold">${qty}</td>
          <td class="text-end font-monospace text-nowrap fw-bold">${peso(rowVal)}</td>
          <td class="text-center">${statusBadge}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  }

  const inStockEl = document.getElementById('invModalInStockCount');
  if (inStockEl) inStockEl.textContent = inStockCount + ' In Stock';
  const lowStockEl = document.getElementById('invModalLowStockCount');
  if (lowStockEl) lowStockEl.textContent = lowStockCount + ' Low Stock';
  const outStockEl = document.getElementById('invModalOutOfStockCount');
  if (outStockEl) outStockEl.textContent = outStockCount + ' Out of Stock';

  const totalQtyEl = document.getElementById('invModalTotalQty');
  if (totalQtyEl) totalQtyEl.textContent = totalQty.toLocaleString('en-US');
  const totalValEl = document.getElementById('invModalTotalValue');
  if (totalValEl) totalValEl.textContent = peso(totalVal);

  const tfootQty = document.getElementById('invModalTfootQty');
  if (tfootQty) tfootQty.textContent = totalQty.toLocaleString('en-US');
  const tfootVal = document.getElementById('invModalTfootValue');
  if (tfootVal) tfootVal.textContent = peso(totalVal);

  if (window.bootstrap && bootstrap.Modal) {
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  } else {
    openModal('inventoryReportModal');
  }
}

function initInventoryReportEvents() {
  const invPrintBtn = document.getElementById('invModalNativePrintBtn');
  if (invPrintBtn) {
    invPrintBtn.addEventListener('click', function () {
      window.print();
    });
  }

  const reportBtn = document.getElementById('btnInventoryReportPrint');
  if (reportBtn) {
    reportBtn.addEventListener('click', function (e) {
      e.preventDefault();
      openInventoryReportModal();
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initInventoryReportEvents);
} else {
  initInventoryReportEvents();
}
