function getApiBaseUrl() {
  if (typeof window !== 'undefined' && window.__GYMWORX_API_URL__) {
    return window.__GYMWORX_API_URL__.endsWith('/') ? window.__GYMWORX_API_URL__ : window.__GYMWORX_API_URL__ + '/';
  }

  if (typeof window === 'undefined' || !window.location) {
    return 'api/';
  }

  const loc = window.location;
  const isDevPort = Boolean(loc.port && !['', '80', '443', '8013'].includes(loc.port));

  if (isDevPort) {
    return `${loc.protocol}//${loc.hostname}/inventory_warehouse/warehouse_finals/api/`;
  }

  if (loc.pathname && loc.pathname.includes('/inventory_warehouse/warehouse_finals/')) {
    return `${loc.protocol}//${loc.host}/inventory_warehouse/warehouse_finals/api/`;
  }

  return 'api/';
}

const API = getApiBaseUrl();
let csrfToken = null;

axios.defaults.withCredentials = true;
axios.defaults.validateStatus = function () { return true; };

axios.interceptors.request.use(function (config) {
  const method = (config.method || 'get').toUpperCase();
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && csrfToken) {
    config.headers = config.headers || {};
    config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});

let sessionExpiredShown = false;

axios.interceptors.response.use(
  function (response) {
    const url = (response.config && response.config.url) || '';
    const isAuthCall = url.indexOf('action=login') !== -1 || url.indexOf('action=me') !== -1 || url.indexOf('action=logout') !== -1;
    if (response.status === 401 && !isAuthCall && authUser && !sessionExpiredShown) {
      sessionExpiredShown = true;
      showAuthScreen();
      if (window.Swal) {
        Swal.fire({
          icon: 'warning',
          title: 'Session expired',
          text: 'Your session has ended. Please log in again.',
          confirmButtonText: 'OK',
          confirmButtonColor: '#212529'
        }).then(function () { sessionExpiredShown = false; });
      } else {
        sessionExpiredShown = false;
      }
    }
    return response;
  },
  function () {
    return Promise.resolve({
      status: 0,
      data: { success: false, message: 'Network error. Please check your connection.' }
    });
  }
);

const cache = {
  categories: [],
  products: [],
  suppliers: [],
  roles: []
};

let userCache = [];
let authUser = null;
let permissions = null;

function can(module, action) {
  if (!permissions) return false;
  if (module === 'users' && action === 'view') {
    return Boolean((permissions.users && permissions.users.view) || (permissions.role && permissions.role.view));
  }
  return Boolean(permissions[module] && permissions[module][action]);
}

let toastTimer = null;
function showToast(message, isError = false, title = null) {
  if (window.Swal) {
    if (isError) {
      const msgStr = String(message || '');
      let modalTitle = title;
      if (!modalTitle) {
        if (/denied|unauthorized|forbidden|permission/i.test(msgStr)) {
          modalTitle = 'Action Blocked';
        } else if (/not found/i.test(msgStr)) {
          modalTitle = 'Record Not Found';
        } else {
          modalTitle = 'Notice';
        }
      }
      Swal.fire({
        icon: 'error',
        title: modalTitle,
        text: message,
        confirmButtonText: 'OK',
        confirmButtonColor: '#6D28D9'
      });
      return;
    }
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: message,
      showConfirmButton: false,
      timer: 2800,
      timerProgressBar: true
    });
    return;
  }

  const successEl = document.getElementById('toastSuccess');
  const errorEl = document.getElementById('toastError');
  const target = isError ? errorEl : successEl;
  const other = isError ? successEl : errorEl;
  const body = document.getElementById(isError ? 'toastErrorBody' : 'toastSuccessBody');

  if (other) other.hidden = true;
  if (body) body.textContent = message;
  if (target) {
    target.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      target.hidden = true;
    }, 2800);
  }
}

async function showConfirm(title, text = '', confirmText = 'Yes', cancelText = 'Cancel') {
  if (window.Swal) {
    const res = await Swal.fire({
      title: title,
      text: text,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#6D28D9',
      cancelButtonColor: '#dc3545',
      confirmButtonText: confirmText,
      cancelButtonText: cancelText
    });
    return res.isConfirmed;
  }
  return confirm(text ? (title + '\n' + text) : title);
}

function renderWorkflowStatusHtml(status) {
  const s = String(status || 'Pending');
  const classMap = {
    'Pending': 'wf-pending',
    'Pending Approval': 'wf-pending',
    'For Revision': 'wf-revision',
    'Approved': 'wf-approved',
    'Partially Ordered': 'wf-ordered',
    'Ordered': 'wf-ordered',
    'Processing': 'wf-ordered',
    'Draft': 'wf-draft',
    'Partially Received': 'wf-partial',
    'Received': 'wf-received',
    'Completed': 'wf-received',
    'Rejected': 'wf-rejected',
    'Cancelled': 'wf-cancelled',
    'Closed Short': 'wf-partial',
    'Purchasing': 'wf-ordered',
    'Awaiting Delivery': 'wf-partial'
  };
  const cls = classMap[s] || 'wf-draft';
  return `<span class="badge wf-badge ${cls}">${escapeHtml(s)}</span>`;
}

function createPoStatusBadge(status) {
  const span = document.createElement('span');
  span.innerHTML = renderWorkflowStatusHtml(status);
  return span.firstElementChild || span;
}

const TAB_TO_MODULE_MAP = {
  request_approval: 'purchasing',
  purchase_request: 'purchasing',
  purchase_order: 'purchasing',
  stock_receiving: 'purchasing',
  stock_releasing: 'purchasing',
  purchase_return: 'purchasing',
  stocks_return: 'purchasing',
  adjustment: 'purchasing',
  stock_movement: 'purchasing',

  product: 'inventory',
  category: 'inventory',
  supplier: 'inventory',
  product_supplier: 'inventory',

  inventory_report: 'reports',
  audit_log: 'reports',

  users: 'system',
  role: 'system'
};

function getSubmenuForModule(moduleName) {
  if (!moduleName) return null;
  const capitalized = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
  return document.getElementById('submenu' + capitalized);
}

function setSidebarModuleExpanded(moduleName, expand) {
  const toggleBtn = document.querySelector('.gw-module-toggle[data-gw-module="' + moduleName + '"]');
  const submenu = getSubmenuForModule(moduleName);
  if (!toggleBtn || !submenu) return;

  if (expand) {
    toggleBtn.classList.add('is-open');
    toggleBtn.setAttribute('aria-expanded', 'true');
    submenu.classList.add('is-open');
  } else {
    toggleBtn.classList.remove('is-open');
    toggleBtn.setAttribute('aria-expanded', 'false');
    submenu.classList.remove('is-open');
  }
  updateAggregatedBadges();
}

function toggleSidebarModule(moduleName) {
  const toggleBtn = document.querySelector('.gw-module-toggle[data-gw-module="' + moduleName + '"]');
  if (!toggleBtn) return;
  const isCurrentlyOpen = toggleBtn.classList.contains('is-open');

  // Accordion behavior: only one module expanded at a time
  const allToggles = document.querySelectorAll('.gw-module-toggle[data-gw-module]');
  for (let i = 0; i < allToggles.length; i++) {
    const m = allToggles[i].getAttribute('data-gw-module');
    setSidebarModuleExpanded(m, false);
  }

  // If clicked module was not open, open it
  if (!isCurrentlyOpen) {
    setSidebarModuleExpanded(moduleName, true);
  }
}

function updateSidebarAccordionForTab(tabName) {
  const targetModule = TAB_TO_MODULE_MAP[tabName] || null;
  const allToggles = document.querySelectorAll('.gw-module-toggle[data-gw-module]');

  for (let i = 0; i < allToggles.length; i++) {
    const m = allToggles[i].getAttribute('data-gw-module');
    const isTarget = (m === targetModule);
    setSidebarModuleExpanded(m, isTarget);
    allToggles[i].classList.toggle('has-active-child', isTarget);
  }
  updateAggregatedBadges();
}

function updateAggregatedBadges() {
  const purchasingToggle = document.getElementById('sidebarModulePurchasing');
  const purchasingAgg = document.getElementById('sidebarPurchasingAggBadge');
  if (purchasingToggle && purchasingAgg) {
    const isPurchasingOpen = purchasingToggle.classList.contains('is-open');
    let total = 0;
    const badgeIds = ['sidebarApprovalBadge', 'sidebarPrBadge', 'sidebarPoBadge', 'sidebarReceivingBadge'];
    for (let i = 0; i < badgeIds.length; i++) {
      const b = document.getElementById(badgeIds[i]);
      if (b && !b.hidden) {
        const val = parseInt(b.textContent, 10);
        if (!isNaN(val) && val > 0) total += val;
      }
    }
    if (!isPurchasingOpen && total > 0) {
      purchasingAgg.textContent = total > 99 ? '99+' : total;
      purchasingAgg.hidden = false;
    } else {
      purchasingAgg.hidden = true;
    }
  }
}

function navigateTo(tabName, options) {
  const opts = options || {};
  activateTab(tabName, opts);
}

function activateTab(tabName, options) {
  const opts = options || {};

  // Handle virtual tabs that map to combined panels
  let panelTarget = tabName;
  if (tabName === 'request_approval') {
    if (!can('request_approval', 'view') && !can('purchase_request', 'view')) return;
    panelTarget = 'purchase_request';
    if (opts.status === undefined) opts.status = 'Pending Approval';
  } else if (tabName === 'request_history') {
    if (!can('purchase_request', 'view')) return;
    panelTarget = 'purchase_request';
    if (opts.status === undefined) opts.status = '';
  } else if (tabName === 'role') {
    if (!can('role', 'view') && !can('users', 'view')) return;
    panelTarget = 'users';
    opts.usersSubTab = 'roles';
  } else if (tabName === 'notifications') {
    panelTarget = 'notifications';
  } else if (tabName === 'dashboard') {
    if (!can('dashboard', 'view')) return;
  } else if (tabName === 'audit_log') {
    if (!can('stock_movement', 'view') && !can('inventory_report', 'view')) return;
    panelTarget = 'stock_movement';
  } else {
    if (!can(tabName, 'view')) return;
  }

  sessionStorage.setItem('activeTab', tabName);

  const sidebarEl = document.getElementById('sidebarOffcanvas');
  if (sidebarEl && window.bootstrap && bootstrap.Offcanvas) {
    const oc = bootstrap.Offcanvas.getInstance(sidebarEl);
    if (oc) oc.hide();
  }

  const tabTitles = {
    dashboard: 'Dashboard',
    notifications: 'Notifications & Alerts',
    purchase_request: 'Purchase Requests',
    request_approval: 'Manager Approval Queue',
    request_history: 'Request History',
    purchase_order: 'Purchase Orders',
    stock_receiving: 'Stock Receiving & Verification',
    stock_releasing: 'Stock Releasing',
    purchase_return: 'Purchase Returns',
    stocks_return: 'Stocks Return',
    adjustment: 'Stock Adjustments',
    stock_movement: 'Stock Movement History',
    audit_log: 'Audit Logs',
    product: 'Product Inventory',
    category: 'Categories',
    supplier: 'Suppliers',
    product_supplier: 'Product ↔ Supplier',
    users: 'Users & Roles',
    role: 'Users & Roles',
    inventory_report: 'Inventory Report'
  };

  const titleText = tabTitles[tabName] || 'Warehouse';
  const mobileTitle = document.getElementById('mobilePageTitle');
  if (mobileTitle) mobileTitle.textContent = titleText;
  const desktopTitle = document.getElementById('desktopPageTitle');
  if (desktopTitle) desktopTitle.textContent = titleText;

  const navItems = document.querySelectorAll('.nav-link[data-tab]');
  const panels = document.querySelectorAll('.panel');

  for (let i = 0; i < navItems.length; i++) {
    const isCurrent = navItems[i].getAttribute('data-tab') === tabName;
    navItems[i].classList.toggle('active', isCurrent);
    if (isCurrent) {
      navItems[i].setAttribute('aria-current', 'page');
    } else {
      navItems[i].removeAttribute('aria-current');
    }
  }

  // Update sidebar accordion so parent module of active tab is expanded and others collapsed
  updateSidebarAccordionForTab(tabName);

  for (let i = 0; i < panels.length; i++) {
    const isTarget = (panels[i].id === 'panel-' + panelTarget);
    panels[i].hidden = !isTarget;
    if (isTarget) {
      panels[i].removeAttribute('hidden');
      panels[i].style.display = '';
    } else {
      panels[i].setAttribute('hidden', '');
      panels[i].style.display = 'none';
    }
  }

  // Update layout: Eliminate outer page scrollbar on table-based pages, keeping only internal table scrolling
  const mainEl = document.querySelector('main') || document.getElementById('mainContent');
  if (mainEl) {
    const activePanel = document.getElementById('panel-' + panelTarget);
    const isTablePage = Boolean(activePanel && activePanel.querySelector('.gym-table-container, .table-responsive, table'));
    mainEl.classList.toggle('gw-table-page-active', isTablePage);
  }

  if (panelTarget === 'dashboard') {
    loadDashboard();
  } else if (panelTarget === 'notifications') {
    if (typeof loadNotificationsPanel === 'function') loadNotificationsPanel();
  } else if (panelTarget === 'purchase_request') {
    const isApprovalView = (tabName === 'request_approval');
    const prTitle = document.getElementById('prPageTitle');
    const prSubtitle = document.getElementById('prPageSubtitle');
    const newPrBtn = document.getElementById('btnNewPurchaseRequest');
    const prMainCardTitle = document.getElementById('prMainCardTitle');

    const isHistoryView = (tabName === 'request_history');
    const isRequester = authUser && (authUser.role_name === 'Store Requester' || authUser.role_id === 4 || (authUser.role_name || '').toLowerCase().includes('requester'));
    if (prTitle) {
      prTitle.textContent = isApprovalView ? 'Manager Approval Queue' : (isHistoryView ? 'Request History' : (isRequester ? 'My Requests' : 'Purchase Requests'));
    }
    if (prSubtitle) {
      prSubtitle.textContent = isApprovalView
        ? 'Review and authorize store replenishment requests and direct warehouse purchase orders.'
        : (isHistoryView ? 'Complete historical log and audit trail of your submitted store purchase requests.' : 'Submit replenishment requests, review manager approvals, and track fulfillment progress.');
    }
    if (newPrBtn) {
      newPrBtn.hidden = isApprovalView && !can('purchase_request', 'manage');
    }
    if (prMainCardTitle) {
      prMainCardTitle.textContent = isApprovalView ? 'Store Purchase Requests' : (isHistoryView ? 'Store Request History' : (isRequester ? 'My Purchase Requests' : 'All Purchase Requests'));
    }
    if (typeof loadPurchaseRequests === 'function') {
      loadPurchaseRequests(opts.status !== undefined ? opts.status : (isApprovalView ? 'Pending Approval' : ''));
    }
    if (opts.openNewModal && typeof openNewPrModal === 'function') {
      openNewPrModal(opts.productId);
    }
  } else if (panelTarget === 'purchase_order') {
    if (typeof loadPurchaseOrders === 'function') {
      loadPurchaseOrders(opts.status !== undefined ? opts.status : '');
    } else if (typeof loadPOs === 'function') {
      loadPOs();
    }
    if (opts.openNewModal) {
      if (typeof openCreateIndependentPo === 'function') {
        openCreateIndependentPo();
      } else {
        resetModalForAdd('poModal').then(() => openModal('poModal'));
      }
    }
  } else if (panelTarget === 'stock_receiving') {
    loadStockReceiving();
    if (opts.openNewModal) {
      resetModalForAdd('receivingModal').then(() => openModal('receivingModal'));
    }
  } else if (panelTarget === 'stock_releasing') {
    loadStockReleasing();
  } else if (panelTarget === 'purchase_return') {
    loadPurchaseReturns();
  } else if (panelTarget === 'stocks_return') {
    loadStocksReturns();
  } else if (panelTarget === 'adjustment') {
    loadAdjustments();
  } else if (panelTarget === 'stock_movement') {
    if (typeof loadStockMovements === 'function') loadStockMovements();
  } else if (panelTarget === 'product') {
    loadProducts(opts.health || 'all');
    if (opts.openNewModal) {
      resetModalForAdd('productModal').then(() => openModal('productModal'));
    }
  } else if (panelTarget === 'category') {
    loadCategories();
  } else if (panelTarget === 'supplier') {
    loadSuppliers();
  } else if (panelTarget === 'product_supplier') {
    loadLinks();
  } else if (panelTarget === 'users') {
    loadUsers();
    if (opts.usersSubTab === 'roles') {
      const roleTabBtn = document.getElementById('ur-roles-tab');
      if (roleTabBtn && window.bootstrap && bootstrap.Tab) {
        bootstrap.Tab.getOrCreateInstance(roleTabBtn).show();
      }
      loadRoles();
    } else if (opts.usersSubTab === 'permissions') {
      const permTabBtn = document.getElementById('ur-perms-tab');
      if (permTabBtn && window.bootstrap && bootstrap.Tab) {
        bootstrap.Tab.getOrCreateInstance(permTabBtn).show();
      }
      if (typeof loadInlinePermissionsMatrix === 'function') loadInlinePermissionsMatrix();
    }
  } else if (panelTarget === 'inventory_report') {
    loadInventoryReport();
  }
}

function relocateAllModalsToBody() {
  const modals = document.querySelectorAll('.modal');
  for (let i = 0; i < modals.length; i++) {
    const m = modals[i];
    if (m.parentElement !== document.body) {
      document.body.appendChild(m);
    }
  }
}

function openModal(id) {
  const modal = typeof id === 'string' ? document.getElementById(id) : id;
  if (!modal) return;

  // Move modal to document.body so the backdrop never renders over it
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }

  if (window.bootstrap && bootstrap.Modal) {
    const inst = bootstrap.Modal.getOrCreateInstance(modal);
    inst.show();
    return;
  }

  const trigger = document.getElementById('modalTrigger');
  if (trigger) {
    trigger.setAttribute('data-bs-target', '#' + (modal.id || id));
    trigger.click();
  }
}

function closeModal(id) {
  const modal = typeof id === 'string' ? document.getElementById(id) : id;
  if (!modal) return;

  if (window.bootstrap && bootstrap.Modal) {
    const inst = bootstrap.Modal.getInstance(modal) || bootstrap.Modal.getOrCreateInstance(modal);
    if (inst) {
      inst.hide();
      return;
    }
  }

  const dismissBtn = modal.querySelector('[data-bs-dismiss="modal"]');
  if (dismissBtn) {
    dismissBtn.click();
    return;
  }

  modal.classList.remove('show');
  modal.style.display = 'none';
  if (!document.querySelector('.modal.show')) {
    document.querySelectorAll('.modal-backdrop').forEach(function (b) { b.remove(); });
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('padding-right');
    document.body.style.removeProperty('overflow');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', relocateAllModalsToBody);
} else {
  relocateAllModalsToBody();
}

document.addEventListener('show.bs.modal', function (e) {
  if (e.target && e.target.classList && e.target.classList.contains('modal')) {
    if (e.target.parentElement !== document.body) {
      document.body.appendChild(e.target);
    }
  }
});

document.addEventListener('hidden.bs.modal', function () {
  if (!document.querySelector('.modal.show')) {
    document.querySelectorAll('.modal-backdrop').forEach(function (b) { b.remove(); });
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('padding-right');
    document.body.style.removeProperty('overflow');
  }
});

/**
 * Opens the responsive receipt modal populated with transaction data.
 * Supports:
 * - 'purchase_order': Official Purchase Order (PO) document
 * - 'stock_receiving': Delivery / Receiving Receipt (DR) document with actual received & damaged quantities
 * - 'stock_releasing' / 'sale': Stock Releasing receipt
 */
async function openReceiptModal(type, dataOrId) {
  const modalEl = document.getElementById('receiptModal');
  if (!modalEl) return;

  const itemsTbody = document.getElementById('receiptItemsBody');
  if (itemsTbody) {
    itemsTbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2" role="status"></span>Loading document preview...</td></tr>';
  }

  if (window.bootstrap && bootstrap.Modal) {
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  } else {
    openModal('receiptModal');
  }

  let txData = null;
  let items = [];
  const isPO = (type === 'purchase_order' || type === 'po');
  const isReceiving = (type === 'stock_receiving' || type === 'receiving');
  const isReleasing = (type === 'sale' || type === 'stock_releasing' || type === 'releasing');

  try {
    if (typeof dataOrId === 'object' && dataOrId !== null) {
      txData = Object.assign({}, dataOrId);
    } else {
      txData = { id: dataOrId, po_id: dataOrId, receiving_id: dataOrId, releasing_id: dataOrId, transaction_id: dataOrId };
    }

    if (isReceiving) {
      const rcvId = txData.receiving_id || txData.id;
      if (rcvId) {
        const res = await axios.get(API + 'stock_receiving.php?receiving_id=' + encodeURIComponent(rcvId));
        if (res.status === 200 && res.data && res.data.data) {
          txData = Object.assign(txData, res.data.data);
          items = res.data.data.items || [];
        }
      }
    } else if (isPO) {
      const poId = txData.po_id || txData.id;
      if (poId) {
        const res = await axios.get(API + 'purchase_order.php?mode=full&po_id=' + encodeURIComponent(poId));
        if (res.status === 200 && res.data && res.data.data) {
          txData = Object.assign(txData, res.data.data);
          items = res.data.data.items || [];
        }
      }
    } else if (isReleasing) {
      const releasingId = txData.transaction_id || txData.releasing_id || txData.id;
      if (!txData.items || txData.items.length === 0) {
        if (releasingId) {
          const res = await axios.get(API + 'stock_releasing.php?mode=detail&releasing_id=' + encodeURIComponent(releasingId));
          if (res.status === 200 && res.data && res.data.data) {
            items = res.data.data;
          }
        }
      } else {
        items = txData.items;
      }
    } else {
      items = txData.items || [];
    }

    renderReceiptContent(type, txData, items);
  } catch (err) {
    console.error('Error loading receipt details:', err);
    if (itemsTbody) {
      itemsTbody.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-danger"><i class="bi bi-exclamation-triangle me-1"></i>Unable to load document details.</td></tr>';
    }
  }
}

function renderReceiptContent(type, txData, items) {
  const isPO = (type === 'purchase_order' || type === 'po');
  const isReceiving = (type === 'stock_receiving' || type === 'receiving');
  const typeBadge = document.getElementById('receiptTypeBadge');
  const refLabel = document.getElementById('receiptRefLabel');
  const refNo = document.getElementById('receiptRefNo');
  const dateEl = document.getElementById('receiptDate');
  const partyLabel = document.getElementById('receiptPartyLabel');
  const partyName = document.getElementById('receiptPartyName');
  const userLabel = document.getElementById('receiptUserLabel');
  const userName = document.getElementById('receiptUserName');
  const statusBadge = document.getElementById('receiptStatusBadge');
  const priceColHeader = document.getElementById('receiptPriceColHeader');
  const itemsTbody = document.getElementById('receiptItemsBody');
  const totalItemsEl = document.getElementById('receiptTotalItems');
  const totalAmountEl = document.getElementById('receiptTotalAmount');
  const printedDateEl = document.getElementById('receiptPrintedDate');

  if (printedDateEl) {
    const now = new Date();
    printedDateEl.textContent = 'Issued: ' + now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  if (isReceiving) {
    if (typeBadge) {
      typeBadge.textContent = 'Delivery & Receiving Receipt (DR)';
      typeBadge.className = 'badge bg-success fs-6 px-3 py-2 text-uppercase';
    }
    if (refLabel) refLabel.textContent = 'Receiving / DR / PO Ref';
    if (refNo) {
      const rcvCode = txData.receiving_code || (txData.receiving_id ? 'RCV-' + String(txData.receiving_id).padStart(4, '0') : '');
      const poCode = txData.po_code || (txData.po_id ? 'PO-' + String(txData.po_id).padStart(4, '0') : '');
      const drStr = txData.dr_number ? ` | DR: ${txData.dr_number}` : '';
      refNo.textContent = `${rcvCode} (${poCode})${drStr}`;
    }
    if (dateEl) dateEl.textContent = txData.receiving_date || txData.order_date || '-';
    if (partyLabel) partyLabel.textContent = 'Supplier / Vendor';
    if (partyName) partyName.textContent = txData.supplier_name || 'N/A';
    if (userLabel) userLabel.textContent = 'Verified & Received By';
    if (userName) userName.textContent = txData.received_by || (authUser ? (authUser.first_name + ' ' + authUser.last_name) : 'Warehouse Staff');
    if (statusBadge) {
      statusBadge.textContent = txData.po_status || 'Received';
      statusBadge.className = 'badge bg-success';
    }
    if (priceColHeader) priceColHeader.textContent = 'Unit Cost';
  } else if (isPO) {
    if (typeBadge) {
      typeBadge.textContent = 'Official Purchase Order (PO)';
      typeBadge.className = 'badge bg-dark fs-6 px-3 py-2 text-uppercase';
    }
    if (refLabel) refLabel.textContent = 'PO Number / PR Ref';
    if (refNo) {
      const poCode = txData.po_code || (txData.po_id ? ('PO-' + String(txData.po_id).padStart(4, '0')) : '-');
      const prCode = txData.pr_code ? ` (Ref: ${txData.pr_code})` : '';
      refNo.textContent = poCode + prCode;
    }
    if (dateEl) dateEl.textContent = txData.order_date || txData.date || '-';
    if (partyLabel) partyLabel.textContent = 'Supplier / Vendor';
    if (partyName) partyName.textContent = txData.supplier_name || 'N/A';
    if (userLabel) userLabel.textContent = 'Prepared By';
    if (userName) userName.textContent = txData.ordered_by || (authUser ? (authUser.first_name + ' ' + authUser.last_name) : 'Purchasing Officer');
    if (statusBadge) {
      const st = txData.status || 'Ordered';
      statusBadge.textContent = st;
      statusBadge.className = 'badge ' + (st === 'Received' ? 'bg-success' : (st === 'Cancelled' ? 'bg-danger' : 'bg-primary'));
    }
    if (priceColHeader) priceColHeader.textContent = 'Unit Cost';
  } else {
    if (typeBadge) {
      typeBadge.textContent = 'Stock Releasing Receipt';
      typeBadge.className = 'badge bg-primary fs-6 px-3 py-2 text-uppercase';
    }
    if (refLabel) refLabel.textContent = 'Releasing / Ref No.';
    const relId = txData.releasing_id || txData.transaction_id || txData.id;
    if (refNo) refNo.textContent = relId ? ('REL-' + String(relId).padStart(4, '0')) : 'REL-' + Date.now().toString().slice(-6);
    if (dateEl) dateEl.textContent = txData.releasing_date || txData.date || new Date().toISOString().split('T')[0];
    if (partyLabel) partyLabel.textContent = 'Requested / Released To';
    if (partyName) partyName.textContent = txData.requested_by || txData.customer_name || 'Authorized Recipient';
    if (userLabel) userLabel.textContent = 'Released By';
    if (userName) userName.textContent = txData.released_by || txData.user_name || (authUser ? (authUser.first_name + ' ' + authUser.last_name) : 'Authorized Staff');
    if (statusBadge) {
      statusBadge.textContent = txData.status || 'Completed';
      statusBadge.className = 'badge bg-success';
    }
    if (priceColHeader) priceColHeader.textContent = 'Unit Price';
  }

  if (!itemsTbody) return;
  itemsTbody.innerHTML = '';

  let calculatedGrandTotal = 0;
  let totalQty = 0;

  if (!items || items.length === 0) {
    itemsTbody.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-muted fst-italic">No line items recorded for this transaction.</td></tr>';
  } else {
    items.forEach(function (item, idx) {
      const tr = document.createElement('tr');
      const qty = isReceiving
        ? (parseInt(item.quantity_received) || 0)
        : (parseInt(item.quantity_ordered || item.quantity_received || item.quantity_released || item.quantity || 0));
      const unitPrice = parseFloat(item.unit_cost !== undefined ? item.unit_cost : (item.unit_price !== undefined ? item.unit_price : 0));
      const subtotal = (qty * unitPrice);

      totalQty += isNaN(qty) ? 0 : qty;
      calculatedGrandTotal += isNaN(subtotal) ? 0 : subtotal;

      const pName = item.product_name || (typeof productName === 'function' && item.product_id ? productName(item.product_id) : 'Item #' + (idx + 1));
      const extraMeta = [];
      if (isReceiving) {
        if (item.quantity_ordered !== undefined) extraMeta.push(`Ordered: ${item.quantity_ordered}`);
        if (parseInt(item.quantity_damaged) > 0) extraMeta.push(`Damaged: ${item.quantity_damaged}`);
        if (item.discrepancy_note) extraMeta.push(`Note: ${item.discrepancy_note}`);
      }

      tr.innerHTML = `
        <td class="text-center text-muted small">${idx + 1}</td>
        <td>
          <div class="fw-semibold text-dark text-break">${escapeHtml(pName)}</div>
          ${extraMeta.length > 0 ? `<div class="small text-muted">${escapeHtml(extraMeta.join(' | '))}</div>` : ''}
        </td>
        <td class="text-center font-monospace">${qty}</td>
        <td class="text-end font-monospace text-nowrap">${peso(unitPrice)}</td>
        <td class="text-end font-monospace text-nowrap fw-bold">${peso(subtotal)}</td>
      `;
      itemsTbody.appendChild(tr);
    });
  }

  if (totalItemsEl) {
    totalItemsEl.textContent = totalQty;
  }

  if (totalAmountEl) {
    const finalTotal = (!isReceiving && txData.total_cost !== undefined && txData.total_cost !== null)
      ? parseFloat(txData.total_cost)
      : calculatedGrandTotal;
    totalAmountEl.textContent = peso(finalTotal);
  }
}

function peso(amount) {
  const value = parseFloat(amount);
  return 'PHP ' + (isNaN(value) ? 0 : value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text === null || text === undefined ? '' : text;
  return div.innerHTML;
}

function capitalize(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : '';
}

function findById(list, key, id) {
  if (!list) return null;
  for (let i = 0; i < list.length; i++) {
    if (String(list[i][key]) === String(id)) return list[i];
  }
  return null;
}

function createStatusBadge(isActive) {
  const tmplId = parseInt(isActive) === 1 ? 'tmpl-badge-active' : 'tmpl-badge-inactive';
  return document.getElementById(tmplId).content.cloneNode(true);
}

const entityModuleMap = {
  category: 'category',
  product: 'product',
  supplier: 'supplier',
  role: 'role',
  user: 'users'
};

function createRowActions(entity, id, isActive) {
  const module = entityModuleMap[entity];
  const fragment = document.createDocumentFragment();

  if (!can(module, 'manage')) {
    fragment.appendChild(document.getElementById('tmpl-txt-view-only').content.cloneNode(true));
    return fragment;
  }

  const editClone = document.getElementById('tmpl-btn-edit').content.cloneNode(true);
  const editBtn = editClone.querySelector('button');
  editBtn.classList.add('me-1');
  editBtn.addEventListener('click', function () {
    if (entity === 'category') editCategory(id);
    else if (entity === 'product') editProduct(id);
    else if (entity === 'supplier') editSupplier(id);
    else if (entity === 'role') editRole(id);
    else if (entity === 'user') editUser(id);
  });
  fragment.appendChild(editClone);

  const toggleTmplId = parseInt(isActive) === 1 ? 'tmpl-btn-deactivate' : 'tmpl-btn-reactivate';
  const toggleClone = document.getElementById(toggleTmplId).content.cloneNode(true);
  const toggleBtn = toggleClone.querySelector('button');
  const newStatus = parseInt(isActive) === 1 ? 0 : 1;
  toggleBtn.addEventListener('click', function () {
    toggleStatus(entity, id, newStatus);
  });
  fragment.appendChild(toggleClone);

  return fragment;
}

function renderEmptyRow(tableBody, message, colSpan = 5) {
  if (!tableBody) return;
  const clone = document.getElementById('tmpl-row-empty').content.cloneNode(true);
  const td = clone.querySelector('.row-empty-cell');
  td.colSpan = colSpan;
  td.textContent = message;
  tableBody.replaceChildren(clone);
}

function handleFormResult(res, modalId, reloadFn) {
  if (res.data && res.data.success) {
    showToast(res.data.message || 'Saved successfully');
    closeModal(modalId);
    if (typeof reloadFn === 'function') reloadFn();
  } else {
    showToast((res.data && res.data.message) || 'Operation failed', true);
  }
}

const entityFileMap = {
  category: 'category.php',
  product: 'product.php',
  supplier: 'supplier.php',
  role: 'role.php',
  user: 'users.php'
};

async function toggleStatus(entity, id, newStatus) {
  const confirmTitle = newStatus === 1 ? 'Reactivate record?' : 'Deactivate record?';
  const confirmText = newStatus === 1
    ? 'This record will become available again.'
    : 'This record will be hidden from active use but kept for historical transactions.';

  const ok = await showConfirm(confirmTitle, confirmText, newStatus === 1 ? 'Reactivate' : 'Deactivate');
  if (!ok) return;

  const endpoint = entityFileMap[entity];
  const url = API + endpoint + (endpoint.includes('?') ? '&' : '?') + 'id=' + id + (newStatus === 1 ? '&restore=1' : '');

  const res = await axios.delete(url);
  switch (res.status) {
    case 200:
      showToast(res.data.message || 'Status updated');
      if (entity === 'category') loadCategories();
      else if (entity === 'product') loadProducts();
      else if (entity === 'supplier') loadSuppliers();
      else if (entity === 'role') loadRoles();
      else if (entity === 'user') loadUsers();
      break;
    default:
      showToast((res.data && res.data.message) || 'Failed to update status', true);
  }
}

function showAuthScreen() {
  authUser = null;
  permissions = null;
  if (typeof stopNotificationPolling === 'function') stopNotificationPolling();
  sessionStorage.removeItem('isLoggedIn');
  sessionStorage.removeItem('activeTab');
  const sidebarEl = document.getElementById('sidebarOffcanvas');
  if (sidebarEl && window.bootstrap && bootstrap.Offcanvas) {
    const oc = bootstrap.Offcanvas.getInstance(sidebarEl);
    if (oc) oc.hide();
  }
  document.getElementById('authScreen').hidden = false;
  document.getElementById('appShell').hidden = true;
  if (typeof startLoginAnimation === 'function') startLoginAnimation();
}

function showApp(user, perms, token) {
  authUser = user;
  permissions = perms;
  if (token) csrfToken = token;

  sessionStorage.setItem('isLoggedIn', '1');

  document.getElementById('authScreen').hidden = true;
  document.getElementById('appShell').hidden = false;
  if (typeof stopLoginAnimation === 'function') stopLoginAnimation();

  const fullName = user.first_name + ' ' + user.last_name;
  const sideName = document.getElementById('sidebarUserName');
  const sideRole = document.getElementById('sidebarUserRole');
  if (sideName) sideName.textContent = fullName;
  if (sideRole) sideRole.textContent = user.role_name;

  const topName = document.getElementById('topbarUserName');
  const topRole = document.getElementById('topbarUserRole');
  const topRoleText = document.getElementById('topbarUserRoleText');
  if (topName) topName.textContent = fullName;
  if (topRole) topRole.textContent = user.role_name;
  if (topRoleText) topRoleText.textContent = user.role_name;

  applyRBAC();
  relocateAllModalsToBody();
  if (typeof startNotificationPolling === 'function') startNotificationPolling();

  const savedTab = sessionStorage.getItem('activeTab');
  if (savedTab && (savedTab === 'dashboard' || savedTab === 'notifications' || can(savedTab, 'view'))) {
    activateTab(savedTab);
  } else if (can('dashboard', 'view')) {
    activateTab('dashboard');
  } else {
    const firstAllowed = document.querySelector('.nav-link[data-tab][data-module]:not([hidden])');
    if (firstAllowed) {
      activateTab(firstAllowed.getAttribute('data-tab'));
    }
  }
}

function applyRBAC() {
  const dashboard = document.querySelector('.nav-link[data-tab="dashboard"]');
  if (dashboard) {
    dashboard.hidden = !can('dashboard', 'view');
  }

  const navItems = document.querySelectorAll('.nav-link[data-module]');
  for (let i = 0; i < navItems.length; i++) {
    const module = navItems[i].getAttribute('data-module');
    navItems[i].hidden = !can(module, 'view');
  }

  // Combined Users & Roles visibility
  const usersNav = document.getElementById('sidebarNavUsersRoles');
  if (usersNav) {
    usersNav.hidden = !(can('users', 'view') || can('role', 'view'));
  }
  const tabItemUsers = document.getElementById('tabItemUsers');
  if (tabItemUsers) tabItemUsers.hidden = !can('users', 'view');
  const tabItemRoles = document.getElementById('tabItemRoles');
  if (tabItemRoles) tabItemRoles.hidden = !can('role', 'view');
  const tabItemPerms = document.getElementById('tabItemPermissions');
  if (tabItemPerms) tabItemPerms.hidden = !can('role', 'view');

  // Role-specific Purchase Request label
  const prLabel = document.getElementById('sidebarLabelPR');
  if (prLabel && authUser) {
    const rn = (authUser.role_name || '').toLowerCase();
    prLabel.textContent = rn.includes('requester') ? 'My Purchase Requests' : 'Purchase Requests';
  }

  const txModules = ['purchase_request', 'request_approval', 'purchase_order', 'stock_receiving', 'stock_releasing', 'purchase_return', 'stocks_return', 'adjustment', 'stock_movement'];
  const hasTx = txModules.some(m => can(m, 'view'));
  const txHdr = document.getElementById('sidebarHeaderTransactions');
  if (txHdr) txHdr.hidden = !hasTx;
  const txDiv = document.getElementById('sidebarDividerWorkflow');
  if (txDiv) txDiv.hidden = !hasTx;
  const txModBtn = document.getElementById('sidebarModulePurchasing');
  if (txModBtn) txModBtn.hidden = !hasTx;
  const txSub = document.getElementById('submenuPurchasing');
  if (txSub && !hasTx) txSub.classList.remove('is-open');

  const lookupModules = ['product', 'category', 'supplier', 'product_supplier'];
  const hasLookup = lookupModules.some(m => can(m, 'view'));
  const lookupHdr = document.getElementById('sidebarHeaderLookup');
  if (lookupHdr) lookupHdr.hidden = !hasLookup;
  const lookupDiv = document.getElementById('sidebarDividerCatalog');
  if (lookupDiv) lookupDiv.hidden = !hasLookup;
  const lookupModBtn = document.getElementById('sidebarModuleInventory');
  if (lookupModBtn) lookupModBtn.hidden = !hasLookup;
  const lookupSub = document.getElementById('submenuInventory');
  if (lookupSub && !hasLookup) lookupSub.classList.remove('is-open');

  const reportModules = ['inventory_report', 'stock_movement'];
  const hasReports = reportModules.some(m => can(m, 'view'));
  const reportsHdr = document.getElementById('sidebarHeaderReports');
  if (reportsHdr) reportsHdr.hidden = !hasReports;
  const reportsDiv = document.getElementById('sidebarDividerReports');
  if (reportsDiv) reportsDiv.hidden = !hasReports;
  const reportsModBtn = document.getElementById('sidebarModuleReports');
  if (reportsModBtn) reportsModBtn.hidden = !hasReports;
  const reportsSub = document.getElementById('submenuReports');
  if (reportsSub && !hasReports) reportsSub.classList.remove('is-open');

  const systemModules = ['users', 'role'];
  const hasSystem = systemModules.some(m => can(m, 'view'));
  const systemHdr = document.getElementById('sidebarHeaderSystem');
  if (systemHdr) systemHdr.hidden = !hasSystem;
  const adminDiv = document.getElementById('sidebarDividerAdmin');
  if (adminDiv) adminDiv.hidden = !hasSystem;
  const systemDiv = document.getElementById('sidebarDividerSystem');
  if (systemDiv) systemDiv.hidden = !hasSystem;
  const systemModBtn = document.getElementById('sidebarModuleSystem');
  if (systemModBtn) systemModBtn.hidden = !hasSystem;
  const systemSub = document.getElementById('submenuSystem');
  if (systemSub && !hasSystem) systemSub.classList.remove('is-open');

  updateAggregatedBadges();

  // Store Requester: simplified sidebar
  const isRequesterRole = !!(authUser && (authUser.role_name || '').toLowerCase().includes('requester'));
  const standardNavEl = document.getElementById('standardNav');
  const requesterNavEl = document.getElementById('requesterNav');
  if (standardNavEl) standardNavEl.hidden = isRequesterRole;
  if (requesterNavEl) requesterNavEl.hidden = !isRequesterRole;

  const openers = document.querySelectorAll('[data-bs-target][data-module], [data-module]#btnNewPurchaseRequest');
  for (let i = 0; i < openers.length; i++) {
    const m = openers[i].getAttribute('data-module');
    openers[i].hidden = !can(m, 'manage');
  }
}

async function checkSession() {
  const res = await axios.get(API + 'auth.php?action=me');
  switch (res.status) {
    case 200:
      if (res.data && res.data.data && res.data.data.csrf_token) {
        csrfToken = res.data.data.csrf_token;
      }
      if (res.data && res.data.success && res.data.data && res.data.data.user) {
        showApp(res.data.data.user, res.data.data.permissions, csrfToken);
      } else {
        showAuthScreen();
      }
      break;
    default:
      showAuthScreen();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const alertEl = document.getElementById('loginErrorAlert');
  if (alertEl) alertEl.hidden = true;

  const form = e.target;
  const formData = new FormData(form);
  const username = (formData.get('username') || document.getElementById('login_username').value || '').trim();
  const password = formData.get('password') || document.getElementById('login_password').value || '';

  if (!username || !password) {
    form.classList.add('was-validated');
    if (alertEl) {
      alertEl.textContent = 'Please enter both username and password.';
      alertEl.hidden = false;
    }
    return;
  }
  form.classList.remove('was-validated');

  formData.set('username', username);
  formData.set('password', password);

  const res = await axios.post(API + 'auth.php?action=login', formData);

  switch (res.status) {
    case 200:
      if (alertEl) alertEl.hidden = true;
      showToast(res.data.message || 'Login successful');

      const rememberEl = document.getElementById('login_remember');
      if (rememberEl && rememberEl.checked) {
        localStorage.setItem('gw_remember_username', username);
      } else {
        localStorage.removeItem('gw_remember_username');
      }

      document.getElementById('loginForm').reset();
      csrfToken = (res.data.data && res.data.data.csrf_token) || csrfToken;
      sessionStorage.removeItem('activeTab');
      showApp(res.data.data.user, res.data.data.permissions, csrfToken);
      break;
    case 401: {
      const msg = (res.data && res.data.message) || 'Invalid username or password.';
      if (alertEl) {
        alertEl.textContent = msg;
        alertEl.hidden = false;
      }
      showToast(msg, true);
      break;
    }
    case 403: {
      const msg = (res.data && res.data.message) || 'Account is inactive. Please contact an administrator.';
      if (alertEl) {
        alertEl.textContent = msg;
        alertEl.hidden = false;
      }
      showToast(msg, true);
      break;
    }
    default: {
      const msg = (res.data && res.data.message) || 'Login failed';
      if (alertEl) {
        alertEl.textContent = msg;
        alertEl.hidden = false;
      }
      showToast(msg, true);
    }
  }
}

async function handleLogout() {
  const res = await axios.post(API + 'auth.php?action=logout');
  if (res.data && res.data.data && res.data.data.csrf_token) {
    csrfToken = res.data.data.csrf_token;
  } else {
    csrfToken = null;
  }
  showAuthScreen();
  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.reset();
  const alertEl = document.getElementById('loginErrorAlert');
  if (alertEl) alertEl.hidden = true;
}

async function resetModalForAdd(modalId) {
  if (modalId === 'categoryModal') {
    document.getElementById('categoryModalTitle').textContent = 'Add Category';
    document.getElementById('categoryForm').reset();
    document.getElementById('category_id').value = '';
  } else if (modalId === 'productModal') {
    document.getElementById('productModalTitle').textContent = 'Add Product';
    document.getElementById('productForm').reset();
    document.getElementById('product_id').value = '';
    const rEl = document.getElementById('reorder_level');
    if (rEl) rEl.value = 10;
    const mEl = document.getElementById('max_stock');
    if (mEl) mEl.value = 100;
    const openRow = document.getElementById('openingStockRow');
    if (openRow) openRow.hidden = false;
    const openInput = document.getElementById('opening_stock');
    if (openInput) openInput.value = 0;
  } else if (modalId === 'supplierModal') {
    document.getElementById('supplierModalTitle').textContent = 'Add Supplier';
    document.getElementById('supplierForm').reset();
    document.getElementById('supplier_id').value = '';
  } else if (modalId === 'linkModal') {
    document.getElementById('linkModalTitle').textContent = 'Link Products to Supplier';
    var linkSupSel = document.getElementById('link_supplier_id');
    if (linkSupSel) linkSupSel.value = '';
    var linkSearchEl = document.getElementById('linkSearchProducts');
    if (linkSearchEl) linkSearchEl.value = '';
    var linkListEl = document.getElementById('linkProductList');
    if (linkListEl) linkListEl.innerHTML = '<tr><td colspan="3" class="text-muted fst-italic">Select a supplier to view products.</td></tr>';
    var selCountEl = document.getElementById('selectedCount');
    if (selCountEl) selCountEl.textContent = 'Selected Products: 0';
    var hdrCb = document.getElementById('checkAllHeader');
    if (hdrCb) { hdrCb.checked = false; hdrCb.indeterminate = false; }
  } else if (modalId === 'roleModal') {
    document.getElementById('roleModalTitle').textContent = 'Add Role';
    document.getElementById('roleForm').reset();
    document.getElementById('role_id').value = '';
    const nameInput = document.getElementById('role_name');
    if (nameInput) nameInput.readOnly = false;
    const cbs = document.querySelectorAll('#roleForm .perm-check');
    for (let i = 0; i < cbs.length; i++) {
      cbs[i].checked = false;
      cbs[i].disabled = false;
    }
  } else if (modalId === 'userModal') {
    document.getElementById('userModalTitle').textContent = 'Add User';
    document.getElementById('userForm').reset();
    document.getElementById('user_id').value = '';
    document.getElementById('passwordFieldLabel').hidden = false;
    document.getElementById('password').setAttribute('required', 'required');
    if (typeof populateUserRoleDropdown === 'function') {
      await populateUserRoleDropdown();
    }
  } else if (modalId === 'poModal') {
    document.getElementById('poForm').reset();
    txItems.po = [];
    selectedPoPr = null;
    const summaryCard = document.getElementById('poPrItemsSummaryCard');
    if (summaryCard) summaryCard.hidden = true;
    renderLineItemsTable('po');
    await ensureMasterDataLoaded(true);
    if (typeof populateApprovedPrDropdown === 'function') {
      await populateApprovedPrDropdown();
    }
    fillDropdownOptions('po_supplier_id', getActiveSuppliers(), 'supplier_id', function (s) { return s.supplier_name; });
    const poSupplierSel = document.getElementById('po_supplier_id');
    if (poSupplierSel) {
      poSupplierSel.insertAdjacentHTML('afterbegin', '<option value="">-- Select Supplier --</option>');
      poSupplierSel.value = '';
    }
    setCurrentUserSelect('po_user_id');
    resetPoItemInputs();
    const poDate = document.getElementById('po_order_date');
    if (poDate && !poDate.value) {
      const now = new Date();
      poDate.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    }
  } else if (modalId === 'receivingModal') {
    document.getElementById('receivingForm').reset();
    renderEmptyRow(document.getElementById('receiving_items_table'), 'Select a purchase order first.', 8);
    await ensureMasterDataLoaded(false);
    setCurrentUserSelect('receiving_user_id');
    await loadPendingPurchaseOrders();
  } else if (modalId === 'releasingModal') {
    document.getElementById('releasingForm').reset();
    txItems.releasing = [];
    renderLineItemsTable('releasing');
    await ensureMasterDataLoaded(false);
    setCurrentUserSelect('releasing_user_id');
    fillDropdownOptions('releasing_item_product', getActiveProductsList(), 'product_id', function (p) { return p.product_name; });
  } else if (modalId === 'preturnModal') {
    document.getElementById('preturnForm').reset();
    txItems.preturn = [];
    renderLineItemsTable('preturn');
    await ensureMasterDataLoaded(true);
    fillDropdownOptions('preturn_supplier_id', getActiveSuppliers(), 'supplier_id', function (s) { return s.supplier_name; });
    setCurrentUserSelect('preturn_user_id');
    fillDropdownOptions('preturn_item_product', getActiveProductsList(), 'product_id', function (p) { return p.product_name; });
  } else if (modalId === 'sreturnModal') {
    document.getElementById('sreturnForm').reset();
    txItems.sreturn = [];
    renderLineItemsTable('sreturn');
    await ensureMasterDataLoaded(false);
    setCurrentUserSelect('sreturn_user_id');
    fillDropdownOptions('sreturn_item_product', getActiveProductsList(), 'product_id', function (p) { return p.product_name; });
  } else if (modalId === 'adjustmentModal') {
    document.getElementById('adjustmentForm').reset();
    txItems.adjustment = [];
    window.currentAdjustmentClientToken = 'ADJ-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    renderLineItemsTable('adjustment');
    await ensureMasterDataLoaded(false);
    setCurrentUserSelect('adjustment_user_id');
    fillDropdownOptions('adjustment_item_product', getActiveProductsList(), 'product_id', function (p) { return p.product_name; });
    const adjDate = document.getElementById('adjustment_date');
    if (adjDate && !adjDate.value) {
      const now = new Date();
      adjDate.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    }
  }
}

const txItems = {
  po: [],
  releasing: [],
  preturn: [],
  sreturn: [],
  adjustment: []
};

async function ensureMasterDataLoaded(requiresSuppliers = false) {
  if (cache.products.length === 0) {
    const res = await axios.get(API + 'product.php');
    if (res.status === 200 && res.data && res.data.data) {
      cache.products = res.data.data;
    }
  }
  if (requiresSuppliers && can('supplier', 'view') && cache.suppliers.length === 0) {
    const res = await axios.get(API + 'supplier.php');
    if (res.status === 200 && res.data && res.data.data) {
      cache.suppliers = res.data.data;
    }
  }
}

function getActiveSuppliers() {
  return cache.suppliers.filter(function (s) { return parseInt(s.is_active) === 1; });
}

function getActiveProductsList() {
  return cache.products.filter(function (p) { return parseInt(p.is_active) === 1; });
}

function fillDropdownOptions(selectId, list, valueKey, labelFn) {
  const select = document.getElementById(selectId);
  if (!select || !list) return;

  const html = list.map(function (item) {
    return '<option value="' + item[valueKey] + '">' + escapeHtml(labelFn(item)) + '</option>';
  }).join('');
  select.innerHTML = html;
}

function setCurrentUserSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select || !authUser) return;
  select.innerHTML = '<option value="' + authUser.user_id + '">' +
    escapeHtml(authUser.first_name + ' ' + authUser.last_name) + '</option>';
  select.value = String(authUser.user_id);
}

function productName(productId) {
  const p = findById(cache.products, 'product_id', productId);
  return p ? p.product_name : 'Product';
}

function addLineItem(prefix) {
  const productSelect = document.getElementById(prefix + '_item_product');
  const qtyInput = document.getElementById(prefix + '_item_qty');

  if (!productSelect || !productSelect.value) {
    showToast('Select a product first', true);
    return;
  }

  const qty = parseInt(qtyInput.value);
  if (!qty || qty <= 0) {
    showToast('Enter a quantity greater than zero', true);
    return;
  }

  const productId = parseInt(productSelect.value);
  const item = {
    product_id: productId,
    product_name: productName(productId),
    quantity: qty
  };

  if (prefix === 'po') {
    const costInput = document.getElementById('po_item_cost');
    const rawCost = costInput.value.trim();
    const cost = parseFloat(rawCost);
    if (rawCost === '' || isNaN(cost) || cost < 0) {
      showToast('Enter a valid unit cost (0 or higher) for the selected product.', true);
      return;
    }
    item.unit_cost = cost;

    const maxRem = typeof getApprovedRemainingQtyForProduct === 'function' ? getApprovedRemainingQtyForProduct(productId) : null;
    if (maxRem !== null) {
      item.max_qty = maxRem;
    }

    const existing = txItems.po.find(function (it) { return it.product_id === productId; });
    if (existing) {
      const nextQty = existing.quantity + qty;
      if (maxRem !== null && nextQty > maxRem) {
        showToast(`Total order quantity (${nextQty}) cannot exceed remaining approved quantity (${maxRem}).`, true);
        return;
      }
      existing.quantity = nextQty;
      renderLineItemsTable('po');
      resetPoItemInputs(true);
      return;
    } else if (maxRem !== null && qty > maxRem) {
      showToast(`Order quantity (${qty}) cannot exceed remaining approved quantity (${maxRem}).`, true);
      return;
    }
  }

  if (prefix === 'adjustment') {
    item.adjustment_type = document.getElementById('adjustment_item_type').value;
    const dupAdj = txItems.adjustment.find(function (it) { return it.product_id === productId; });
    if (dupAdj) {
      showToast('This product is already in the adjustment list. Remove it first if you need to change its quantity or type.', true);
      return;
    }
    if (item.adjustment_type === 'Deduction') {
      const prodObj = findById(cache.products, 'product_id', productId);
      const availStock = prodObj ? (parseInt(prodObj.available_stock !== undefined ? prodObj.available_stock : prodObj.stock_qty) || 0) : null;
      if (availStock !== null && qty > availStock) {
        showToast(`Cannot deduct ${qty} unit(s). Current available stock is ${availStock}.`, true);
        return;
      }
    } else if (item.adjustment_type === 'Addition') {
      const prodObj = findById(cache.products, 'product_id', productId);
      if (prodObj) {
        const availStock = parseInt(prodObj.available_stock !== undefined ? prodObj.available_stock : prodObj.stock_qty) || 0;
        const maxCapacity = Math.max(1, parseInt(prodObj.max_stock) || 100);
        const remainingCapacity = Math.max(0, maxCapacity - availStock);
        if (qty > remainingCapacity) {
          showToast('Maximum stock capacity reached. Cannot add more stock to this product.', true);
          return;
        }
      }
    }
  }

  if (prefix === 'sreturn') {
    const condEl = document.getElementById('sreturn_condition');
    const condition = condEl ? condEl.value : 'Usable';
    item.condition_status = condition;
    if (condition === 'Usable') {
      const prodObj = findById(cache.products, 'product_id', productId);
      if (prodObj) {
        const availStock = parseInt(prodObj.available_stock !== undefined ? prodObj.available_stock : prodObj.stock_qty) || 0;
        const maxCapacity = Math.max(1, parseInt(prodObj.max_stock) || 100);
        const remainingCapacity = Math.max(0, maxCapacity - availStock);
        if (qty > remainingCapacity) {
          showToast('Maximum stock capacity reached. Cannot add more stock to this product.', true);
          return;
        }
      }
    }
  }

  txItems[prefix].push(item);
  renderLineItemsTable(prefix);
  if (prefix === 'po') {
    resetPoItemInputs(true);
    return;
  }
  qtyInput.value = 1;
}

function removeLineItem(prefix, index) {
  txItems[prefix].splice(index, 1);
  renderLineItemsTable(prefix);
}

function poLineSubtotal(quantity, unitCost) {
  const q = parseInt(quantity);
  const c = parseFloat(unitCost);
  if (isNaN(q) || q <= 0 || isNaN(c) || c < 0) return 0;
  return Math.round(q * c * 100) / 100;
}

function updatePoTotals() {
  const poFoot = document.getElementById('po_items_tfoot');
  if (!poFoot) return;
  if (!txItems.po || txItems.po.length === 0) {
    poFoot.innerHTML = '';
    return;
  }
  const totalCost = txItems.po.reduce(function (total, it) {
    return total + poLineSubtotal(it.quantity, it.unit_cost);
  }, 0);
  poFoot.innerHTML = '<tr><td colspan="3" class="text-end">Grand Total:</td><td class="font-monospace text-nowrap">' + peso(totalCost) + '</td><td></td></tr>';
}

function renderLineItemsTable(prefix) {
  const body = document.getElementById(prefix + '_items_table');
  const poFoot = (prefix === 'po') ? document.getElementById('po_items_tfoot') : null;
  if (!body) return;

  const items = txItems[prefix];
  if (!items || items.length === 0) {
    const colspan = (prefix === 'po') ? 5 : (prefix === 'adjustment' ? 4 : 3);
    const clone = document.getElementById('tmpl-line-item-empty').content.cloneNode(true);
    clone.querySelector('.line-empty-cell').colSpan = colspan;
    body.replaceChildren(clone);
    if (poFoot) poFoot.innerHTML = '';
    return;
  }

  body.innerHTML = '';
  items.map(function (it, i) {
    let clone;
    if (prefix === 'po') {
      clone = document.getElementById('tmpl-line-item-po').content.cloneNode(true);
      clone.querySelector('.line-product').textContent = it.product_name;

      const qtyInput = document.createElement('input');
      qtyInput.type = 'number';
      qtyInput.min = '1';
      if (it.max_qty) qtyInput.max = String(it.max_qty);
      qtyInput.step = '1';
      qtyInput.className = 'form-control form-control-sm font-monospace';
      qtyInput.value = it.quantity;
      qtyInput.setAttribute('aria-label', 'Quantity for ' + it.product_name);
      clone.querySelector('.line-qty').appendChild(qtyInput);

      const costInput = document.createElement('input');
      costInput.type = 'number';
      costInput.min = '0';
      costInput.step = '0.01';
      costInput.className = 'form-control form-control-sm font-monospace';
      costInput.value = it.unit_cost;
      costInput.setAttribute('aria-label', 'Unit cost for ' + it.product_name);
      clone.querySelector('.line-cost').appendChild(costInput);

      const subtotalCell = clone.querySelector('.line-subtotal');
      subtotalCell.classList.add('text-nowrap', 'font-monospace');
      subtotalCell.textContent = peso(poLineSubtotal(it.quantity, it.unit_cost));

      const refresh = function () {
        const q = parseInt(qtyInput.value);
        const c = parseFloat(costInput.value);
        it.quantity = isNaN(q) ? 0 : q;
        it.unit_cost = isNaN(c) ? NaN : c;
        const exceedsCap = Boolean(it.max_qty && q > it.max_qty);
        qtyInput.classList.toggle('is-invalid', isNaN(q) || q <= 0 || exceedsCap);
        costInput.classList.toggle('is-invalid', isNaN(c) || c < 0);
        subtotalCell.textContent = peso(poLineSubtotal(it.quantity, it.unit_cost));
        updatePoTotals();
      };
      qtyInput.addEventListener('input', refresh);
      costInput.addEventListener('input', refresh);
    } else if (prefix === 'adjustment') {
      clone = document.getElementById('tmpl-line-item-adjustment').content.cloneNode(true);
      clone.querySelector('.line-product').textContent = it.product_name;
      clone.querySelector('.line-qty').textContent = it.quantity;
      clone.querySelector('.line-type').textContent = it.adjustment_type;
    } else {
      clone = document.getElementById('tmpl-line-item-simple').content.cloneNode(true);
      clone.querySelector('.line-product').textContent = it.product_name;
      clone.querySelector('.line-qty').textContent = it.quantity;
    }

    const btnClone = document.getElementById('tmpl-btn-remove-line').content.cloneNode(true);
    const btn = btnClone.querySelector('button');
    btn.setAttribute('aria-label', 'Remove ' + it.product_name);
    btn.addEventListener('click', function () {
      removeLineItem(prefix, i);
    });
    clone.querySelector('.line-action').appendChild(btnClone);

    return clone;
  }).forEach(function (node) {
    body.appendChild(node);
  });

  if (poFoot) {
    updatePoTotals();
  }
}

function guardSubmit(handler) {
  return async function (e) {
    if (e && e.preventDefault) e.preventDefault();
    const form = e.currentTarget || e.target;
    if (form.dataset.submitting === '1') return;
    form.dataset.submitting = '1';

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalHtml = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Please wait...';
    }

    try {
      await handler(e);
    } finally {
      form.dataset.submitting = '0';
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
      }
    }
  };
}

document.addEventListener('DOMContentLoaded', function () {

  const navItems = document.querySelectorAll('.nav-link[data-tab]');
  for (let i = 0; i < navItems.length; i++) {
    navItems[i].addEventListener('click', function () {
      activateTab(this.getAttribute('data-tab'));
    });
  }

  // Collapsible dropdown module headers (accordion toggle)
  const moduleToggles = document.querySelectorAll('.gw-module-toggle[data-gw-module]');
  for (let i = 0; i < moduleToggles.length; i++) {
    moduleToggles[i].addEventListener('click', function (e) {
      e.preventDefault();
      const modName = this.getAttribute('data-gw-module');
      toggleSidebarModule(modName);
    });
  }

  const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
  if (sidebarCollapseBtn) {
    sidebarCollapseBtn.addEventListener('click', function () {
      document.body.classList.toggle('sidebar-collapsed');
    });
  }

  document.addEventListener('click', function (e) {
    const opener = e.target.closest('[data-bs-toggle="modal"]');
    if (opener) {
      const target = opener.getAttribute('data-bs-target');
      if (target && target.startsWith('#')) {
        const modalId = target.slice(1);
        if (opener.hasAttribute('data-module')) {
          resetModalForAdd(modalId);
        }
      }
    }
  });

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
  const logoutBtnMobile = document.getElementById('logoutBtnMobile');
  if (logoutBtnMobile) logoutBtnMobile.addEventListener('click', handleLogout);
  const logoutBtnTopbar = document.getElementById('logoutBtnTopbar');
  if (logoutBtnTopbar) logoutBtnTopbar.addEventListener('click', handleLogout);

  const passwordToggle = document.getElementById('toggleLoginPassword');
  if (passwordToggle) {
    passwordToggle.addEventListener('click', function () {
      const pwd = document.getElementById('login_password');
      const icon = passwordToggle.querySelector('i');
      const show = pwd.type === 'password';
      pwd.type = show ? 'text' : 'password';
      passwordToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      passwordToggle.setAttribute('aria-pressed', show ? 'true' : 'false');
      if (icon) {
        icon.classList.toggle('bi-eye', !show);
        icon.classList.toggle('bi-eye-slash', show);
      }
    });
  }

  // Restore remembered username if set
  try {
    const savedUsername = localStorage.getItem('gw_remember_username');
    const userInp = document.getElementById('login_username');
    const remBox = document.getElementById('login_remember');
    if (savedUsername && userInp) {
      userInp.value = savedUsername;
      if (remBox) remBox.checked = true;
    }
  } catch (e) {}

  // Forgot password notice handler
  const forgotLink = document.getElementById('forgotPasswordLink');
  if (forgotLink) {
    forgotLink.addEventListener('click', function (e) {
      e.preventDefault();
      if (window.Swal) {
        Swal.fire({
          title: 'Reset Password',
          text: 'Please contact your system administrator or warehouse manager to reset your credentials.',
          icon: 'info',
          confirmButtonColor: '#1B1A18',
          confirmButtonText: 'Understood'
        });
      } else {
        alert('Please contact your system administrator or warehouse manager to reset your credentials.');
      }
    });
  }

  const formDefs = [
    { id: 'loginForm', fnName: 'handleLogin', localFn: handleLogin },
    { id: 'categoryForm', fnName: 'saveCategory' },
    { id: 'productForm', fnName: 'saveProduct' },
    { id: 'supplierForm', fnName: 'saveSupplier' },
    { id: 'roleForm', fnName: 'saveRole' },
    { id: 'userForm', fnName: 'saveUser' },
    { id: 'resetPwdForm', fnName: 'saveResetPassword' },
    { id: 'prForm', fnName: 'savePurchaseRequest' },
    { id: 'poForm', fnName: 'savePurchaseOrder' },
    { id: 'receivingForm', fnName: 'saveStockReceiving' },
    { id: 'releasingForm', fnName: 'saveStockReleasing' },
    { id: 'preturnForm', fnName: 'savePurchaseReturn' },
    { id: 'sreturnForm', fnName: 'saveStocksReturn' },
    { id: 'adjustmentForm', fnName: 'saveAdjustment' }
  ];

  for (let f = 0; f < formDefs.length; f++) {
    const item = formDefs[f];
    const el = document.getElementById(item.id);
    if (el) {
      el.addEventListener('submit', function (e) {
        e.preventDefault();
        const fn = item.localFn || (typeof window[item.fnName] === 'function' ? window[item.fnName] : null);
        if (typeof fn === 'function') {
          return guardSubmit(fn)(e);
        }
      });
    }
  }

  const poSupplierSelect = document.getElementById('po_supplier_id');
  if (poSupplierSelect) {
    poSupplierSelect.addEventListener('change', function (e) {
      if (typeof window.handlePoSupplierChange === 'function') {
        window.handlePoSupplierChange(e);
      }
    });
  }
  const poProductSelect = document.getElementById('po_item_product');
  if (poProductSelect) {
    poProductSelect.addEventListener('change', function (e) {
      if (typeof window.handlePoProductChange === 'function') {
        window.handlePoProductChange(e);
      }
    });
  }
  const poQtyInput = document.getElementById('po_item_qty');
  if (poQtyInput) {
    poQtyInput.addEventListener('input', function (e) {
      if (typeof window.updatePoPreviewSubtotal === 'function') {
        window.updatePoPreviewSubtotal(e);
      }
    });
  }
  const poCostInput = document.getElementById('po_item_cost');
  if (poCostInput) {
    poCostInput.addEventListener('input', function (e) {
      if (typeof window.updatePoPreviewSubtotal === 'function') {
        window.updatePoPreviewSubtotal(e);
      }
    });
  }

  const receivingPoSelect = document.getElementById('receiving_po_id');
  if (receivingPoSelect) {
    receivingPoSelect.addEventListener('change', function (e) {
      if (typeof window.loadPoItemsForReceiving === 'function') {
        window.loadPoItemsForReceiving(e);
      }
    });
  }

  const receiptPrintBtn = document.getElementById('receiptNativePrintBtn');
  if (receiptPrintBtn) {
    receiptPrintBtn.addEventListener('click', function () {
      window.print();
    });
  }

  checkSession();
});

window.addEventListener('pageshow', function (e) {
  if (e.persisted) {
    checkSession();
  }
});

window.addEventListener('popstate', function () {
  checkSession();
});