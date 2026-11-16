let lastDashboardData = null;

async function loadDashboard() {
  const grid = document.getElementById('statGrid');
  const content = document.getElementById('dashboardRoleContent');
  if (grid) {
    grid.replaceChildren(document.getElementById('tmpl-stat-card-loading').content.cloneNode(true));
  }

  const res = await axios.get(API + 'dashboard.php');
  if (res.status !== 200 || !res.data || !res.data.success) {
    if (grid) {
      grid.replaceChildren(document.getElementById('tmpl-stat-card-error').content.cloneNode(true));
    }
    if (content) content.innerHTML = '';
    return;
  }

  lastDashboardData = res.data.data;
  window.lastDashboardData = lastDashboardData;
  window.dashboardData = lastDashboardData;
  renderRoleDashboard(lastDashboardData);
}

function updateSidebarWorkflowBadges(data) {
  if (!data) return;
  const kpis = data.kpis || {};
  const profile = data.profile || '';

  const approvalBadge = document.getElementById('sidebarApprovalBadge');
  if (approvalBadge) {
    const count = parseInt(kpis.awaiting_manager_approval !== undefined ? kpis.awaiting_manager_approval : (kpis.awaiting_approval || 0)) || 0;
    approvalBadge.textContent = count;
    approvalBadge.hidden = count <= 0;
  }

  const prBadge = document.getElementById('sidebarPrBadge');
  if (prBadge) {
    let count = 0;
    if (profile === 'requester') {
      count = parseInt(kpis.for_revision || 0) || 0;
    } else if (profile === 'purchasing') {
      count = parseInt(kpis.approved_ready_for_po || 0) || 0;
    } else if (profile === 'admin') {
      count = parseInt(kpis.pending_requests || 0) || 0;
    }
    prBadge.textContent = count;
    prBadge.hidden = count <= 0;
  }

  const poBadge = document.getElementById('sidebarPoBadge');
  if (poBadge) {
    const count = parseInt(kpis.pos_awaiting_action !== undefined ? kpis.pos_awaiting_action : (kpis.approved_ready_for_po || 0)) || 0;
    poBadge.textContent = count;
    poBadge.hidden = count <= 0;
  }

  const rcvBadge = document.getElementById('sidebarReceivingBadge');
  if (rcvBadge) {
    const count = parseInt(kpis.deliveries_awaiting_receiving || 0) + parseInt(kpis.partially_received || 0);
    rcvBadge.textContent = count;
    rcvBadge.hidden = count <= 0;
  }

  if (typeof updateNotificationBadges === 'function' && kpis.unread_notifications !== undefined) {
    updateNotificationBadges(kpis.unread_notifications, data.notifications);
  }

  if (typeof updateAggregatedBadges === 'function') {
    updateAggregatedBadges();
  }
}

function renderRoleDashboard(data) {
  if (!data) return;
  const profile = data.profile || 'requester';
  const kpis = data.kpis || {};

  updateSidebarWorkflowBadges(data);

  const titleEl = document.getElementById('dashboardTitle');
  const subtitleEl = document.getElementById('dashboardSubtitle');
  const rolePill = document.getElementById('dashboardRolePill');
  const actionsEl = document.getElementById('dashboardHeaderActions');
  const desktopTitle = document.getElementById('desktopPageTitle');

  const firstName = (authUser && authUser.first_name) ? authUser.first_name : 'User';

  const roleConfig = {
    admin: {
      title: 'Administrator Dashboard',
      subtitle: `Welcome back, ${firstName}! System-wide inventory oversight, pipeline, and governance.`,
      pill: 'Administrator'
    },
    manager: {
      title: 'Manager Dashboard',
      subtitle: 'Purchase request approvals, procurement progress, and stock overview.',
      pill: 'Manager'
    },
    purchasing: {
      title: 'Purchase Orders (PO)',
      subtitle: 'Manage purchase orders, track deliveries, and monitor warehouse replenishment.',
      pill: 'Purchasing Officer'
    },
    warehouse: {
      title: 'Warehouse Dashboard',
      subtitle: 'Inspect incoming supplier deliveries, record full or partial stock receiving, and monitor stock levels.',
      pill: 'Warehouse Officer'
    },
    requester: {
      title: `Welcome back, ${firstName}!`,
      subtitle: 'Monitor branch inventory, track purchase request approvals, and request stock replenishment.',
      pill: 'Store Requester'
    }
  };

  const cfg = roleConfig[profile] || roleConfig.requester;
  if (titleEl) titleEl.textContent = cfg.title;
  if (desktopTitle && sessionStorage.getItem('activeTab') === 'dashboard') {
    desktopTitle.textContent = cfg.title;
  }
  if (subtitleEl) subtitleEl.textContent = cfg.subtitle;
  if (rolePill) {
    if (profile === 'requester') {
      const branchName = data.assigned_branch || (data.branch_inventory && data.branch_inventory.store_name) || 'Main Store';
      rolePill.innerHTML = `<span class="badge bg-primary text-white me-1 fw-semibold"><i class="bi bi-geo-alt-fill me-1"></i>${escapeHtml(branchName)}</span> <span class="badge bg-dark-subtle text-dark border fw-semibold">Store Requester</span>`;
    } else {
      rolePill.className = 'badge bg-light text-secondary border rounded-pill px-2.5 py-1 fw-semibold ms-2 align-middle';
      rolePill.textContent = (authUser && authUser.role_name) ? authUser.role_name : cfg.pill;
    }
    rolePill.hidden = false;
  }

  // Top-right quick CTA buttons per role
  if (actionsEl) {
    let ctaHtml = '';
    if (profile === 'requester') {
      ctaHtml += `<button type="button" class="btn btn-primary btn-sm fw-semibold px-3 d-inline-flex align-items-center gap-1.5" onclick="openNewPrModal()"><i class="bi bi-plus-lg"></i>New Purchase Request</button>`;
    } else if (profile === 'manager') {
      const qCount = kpis.awaiting_approval !== undefined ? kpis.awaiting_approval : (kpis.awaiting_manager_approval || 0);
      ctaHtml += `<button type="button" class="btn gw-mgr-approval-btn d-inline-flex align-items-center gap-1.5" onclick="openMgrPrListModal('Pending', 'Purchase Requests Approval Queue')"><i class="bi bi-inbox-fill me-1"></i>Approval Queue (${qCount})</button>`;
    } else if (profile === 'purchasing' && can('purchase_order', 'manage')) {
      ctaHtml += `
        <div class="d-flex align-items-center gap-2" id="dashPoHeaderToolbar">
          <div class="dropdown">
            <button class="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1 dropdown-toggle px-2.5 py-1.5" type="button" id="dashPoDateRangeBtn" data-bs-toggle="dropdown" aria-expanded="false" title="Date range filter" aria-label="Date range filter">
              <i class="bi bi-calendar3 text-secondary"></i>
              <span id="dashPoDateRangeLabel" class="small fw-medium">All Dates</span>
            </button>
            <ul class="dropdown-menu dropdown-menu-end shadow-sm border-0" aria-labelledby="dashPoDateRangeBtn">
              <li><a class="dropdown-item active" href="javascript:void(0)" onclick="navigateTo('purchase_order')">All Dates</a></li>
              <li><a class="dropdown-item" href="javascript:void(0)" onclick="navigateTo('purchase_order')">Today</a></li>
              <li><a class="dropdown-item" href="javascript:void(0)" onclick="navigateTo('purchase_order')">Last 7 Days</a></li>
              <li><a class="dropdown-item" href="javascript:void(0)" onclick="navigateTo('purchase_order')">Last 30 Days</a></li>
            </ul>
          </div>
          <button class="btn btn-outline-secondary btn-sm po-toolbar-btn" type="button" onclick="loadDashboard()" title="Reload dashboard records" aria-label="Reload dashboard records">
            <i class="bi bi-arrow-clockwise"></i>
          </button>
          <button class="btn btn-outline-secondary btn-sm po-toolbar-btn" type="button" onclick="navigateTo('purchase_order')" title="Open advanced filters" aria-label="Open advanced filters">
            <i class="bi bi-funnel"></i>
          </button>
          <button class="btn btn-primary btn-sm po-toolbar-btn po-toolbar-btn-primary" type="button" onclick="navigateTo('purchase_order', { openNewModal: true })" title="Create Purchase Order" aria-label="Create Purchase Order">
            <i class="bi bi-plus-lg fw-bold"></i>
          </button>
        </div>
      `;
    } else if (profile === 'warehouse' && can('stock_receiving', 'manage')) {
      ctaHtml += `<button type="button" class="btn btn-dark btn-sm fw-semibold" onclick="navigateTo('stock_receiving', { openNewModal: true })"><i class="bi bi-box-arrow-in-down me-1"></i>Record Receiving</button>`;
    } else if (profile === 'admin') {
      ctaHtml += `<button type="button" class="btn btn-outline-secondary btn-sm bg-white text-dark border shadow-sm px-3 py-1.5 fw-semibold d-inline-flex align-items-center gap-1.5 rounded-2" onclick="navigateTo('users')"><i class="bi bi-people me-1"></i>Users &amp; Roles</button>`;
      ctaHtml += `
        <div class="dropdown d-inline-block">
          <button class="btn btn-dark btn-sm fw-semibold dropdown-toggle d-inline-flex align-items-center gap-1.5 px-3 py-1.5 shadow-sm rounded-2 text-white" type="button" id="headerQuickActionsDropdown" data-bs-toggle="dropdown" aria-expanded="false">
            <i class="bi bi-plus-lg"></i> <span>Quick Actions</span>
          </button>
          <ul class="dropdown-menu dropdown-menu-end shadow border-0 py-2 mt-1 rounded-3" aria-labelledby="headerQuickActionsDropdown" style="min-width: 230px; z-index: 1050;">
            <li><button type="button" class="dropdown-item py-2 px-3 d-flex align-items-center justify-content-between" onclick="navigateTo('product', { openNewModal: true })"><span class="d-flex align-items-center gap-2"><i class="bi bi-plus-circle text-dark"></i> <span class="small fw-semibold">Add Product</span></span><i class="bi bi-chevron-right text-muted small"></i></button></li>
            <li><button type="button" class="dropdown-item py-2 px-3 d-flex align-items-center justify-content-between" onclick="navigateTo('purchase_request', { openNewModal: true })"><span class="d-flex align-items-center gap-2"><i class="bi bi-file-earmark-plus text-dark"></i> <span class="small fw-semibold">New Purchase Request</span></span><i class="bi bi-chevron-right text-muted small"></i></button></li>
            <li><button type="button" class="dropdown-item py-2 px-3 d-flex align-items-center justify-content-between" onclick="navigateTo('purchase_order', { openNewModal: true })"><span class="d-flex align-items-center gap-2"><i class="bi bi-cart-plus text-dark"></i> <span class="small fw-semibold">Create Purchase Order</span></span><i class="bi bi-chevron-right text-muted small"></i></button></li>
            <li><button type="button" class="dropdown-item py-2 px-3 d-flex align-items-center justify-content-between" onclick="navigateTo('stock_receiving', { openNewModal: true })"><span class="d-flex align-items-center gap-2"><i class="bi bi-box-arrow-in-down text-dark"></i> <span class="small fw-semibold">Stock Receiving</span></span><i class="bi bi-chevron-right text-muted small"></i></button></li>
            <li><button type="button" class="dropdown-item py-2 px-3 d-flex align-items-center justify-content-between" onclick="navigateTo('stock_releasing', { openNewModal: true })"><span class="d-flex align-items-center gap-2"><i class="bi bi-box-arrow-up text-dark"></i> <span class="small fw-semibold">Stock Releasing</span></span><i class="bi bi-chevron-right text-muted small"></i></button></li>
          </ul>
        </div>
      `;
    }
    actionsEl.innerHTML = ctaHtml;
  }

  renderDashboardKpiCards(profile, kpis);
  renderDashboardWorkspace(profile, data);
}

function renderDashboardKpiCards(profile, kpis) {
  const grid = document.getElementById('statGrid');
  if (!grid) return;

  grid.innerHTML = '';

  if (profile === 'admin') {
    const cards = [
      {
        icon: 'bi-exclamation-triangle',
        tone: 'amber',
        value: kpis.low_stock_count || 0,
        valueClass: 'text-dark',
        label: 'Low Stock',
        sub: 'At or below reorder level',
        onClick: () => navigateTo('product', { health: 'low' })
      },
      {
        icon: 'bi-slash-circle',
        tone: 'red',
        value: kpis.out_of_stock_count || 0,
        valueClass: 'text-danger',
        alertDot: (Number(kpis.out_of_stock_count) > 0),
        label: 'Out of Stock',
        sub: 'Zero available warehouse stock',
        onClick: () => navigateTo('product', { health: 'critical' })
      },
      {
        icon: 'bi-cart3',
        tone: 'blue',
        value: kpis.pending_pos || 0,
        valueClass: 'text-dark',
        label: 'Pending POs',
        sub: 'Awaiting action/fulfillment',
        onClick: () => navigateTo('purchase_order')
      },
      {
        icon: 'bi-truck',
        tone: 'blue',
        value: kpis.pending_deliveries || 0,
        valueClass: 'text-dark',
        label: 'Pending Deliveries',
        sub: 'Incoming deliveries to receive',
        onClick: () => navigateTo('stock_receiving')
      },
      {
        icon: 'bi-file-earmark-text',
        tone: 'indigo',
        value: kpis.store_requests || 0,
        valueClass: 'text-dark',
        label: 'Store Requests',
        sub: 'Store requests requiring action',
        onClick: () => navigateTo('purchase_request')
      },
      {
        icon: 'bi-clock-history',
        tone: 'teal',
        value: kpis.recent_transactions_count || 0,
        valueClass: 'text-dark',
        label: 'Recent Transactions',
        sub: 'Live activity ledger',
        onClick: () => openRecentTransactionsModal()
      }
    ];
    cards.forEach(c => {
      const col = document.createElement('div');
      col.className = 'col-6 col-md-4 col-xl-2';
      col.innerHTML = `
        <div class="card kpi-card kpi-clickable h-100 shadow-sm border rounded-3 bg-white" role="button" tabindex="0">
          <div class="card-body p-3 d-flex flex-column justify-content-between">
            <div class="d-flex align-items-center gap-2 mb-2">
              <div class="kpi-icon-box tone-${c.tone}">
                <i class="bi ${c.icon}"></i>
              </div>
              <div class="kpi-label fw-semibold text-dark">${escapeHtml(c.label)}</div>
            </div>
            <div class="d-flex align-items-center justify-content-between mt-1">
              <div class="kpi-value fw-bold ${c.valueClass || 'text-dark'}">${escapeHtml(String(c.value))}</div>
              ${c.alertDot ? '<span class="badge rounded-circle bg-danger p-0 d-inline-flex align-items-center justify-content-center text-white fw-bold" style="width:20px;height:20px;font-size:0.75rem;"><i class="bi bi-exclamation"></i></span>' : ''}
            </div>
            <div class="kpi-sub mt-1 text-muted" style="font-size: 0.74rem;">${escapeHtml(c.sub)}</div>
          </div>
        </div>
      `;
      bindKpiClick(col, c.onClick);
      grid.appendChild(col);
    });
    return;
  }

  if (profile === 'manager') {
    const cards = [
      {
        icon: 'bi-file-earmark-text',
        tone: 'blue',
        value: kpis.awaiting_approval !== undefined ? kpis.awaiting_approval : (kpis.awaiting_manager_approval || 0),
        label: 'Awaiting PR Approval',
        sparkColor: '#2563eb',
        sparkPath: 'M 2 24 C 20 22, 35 12, 50 18 C 65 24, 72 8, 78 6',
        onClick: () => openMgrPrListModal('Pending', 'Purchase Requests Approval Queue')
      },
      {
        icon: 'bi-cart-check',
        tone: 'amber',
        value: kpis.pos_pending_approval || 0,
        label: 'POs Awaiting Approval',
        sparkColor: '#f59e0b',
        sparkPath: 'M 2 26 C 22 24, 38 18, 52 20 C 64 22, 70 12, 78 8',
        onClick: () => openMgrPoApprovalModal()
      },
      {
        icon: 'bi-check-circle',
        tone: 'green',
        value: kpis.approved_requests || 0,
        label: 'Approved Requests',
        sparkColor: '#10b981',
        sparkPath: 'M 2 24 C 18 20, 32 14, 48 10 C 62 6, 72 4, 78 2',
        onClick: () => openMgrPrListModal('Approved', 'Approved Requests')
      },
      {
        icon: 'bi-arrow-return-left',
        tone: 'orange',
        value: kpis.for_revision_requests || 0,
        label: 'Returned for Revision',
        sparkColor: '#f97316',
        sparkPath: 'M 2 14 C 20 18, 38 24, 54 22 C 66 20, 72 26, 78 28',
        onClick: () => openMgrPrListModal('For Revision', 'Returned for Revision Requests')
      },
      {
        icon: 'bi-x-circle',
        tone: 'red',
        value: kpis.rejected_requests || 0,
        label: 'Rejected',
        sparkColor: '#ef4444',
        sparkPath: 'M 2 10 C 18 16, 36 22, 52 18 C 66 14, 72 24, 78 26',
        onClick: () => openMgrPrListModal('Rejected', 'Rejected Requests')
      }
    ];

    cards.forEach(c => {
      const col = document.createElement('div');
      col.className = 'col-12 col-sm-6 col-md-4 col-xl';
      col.innerHTML = `
        <div class="kpi-card gw-mgr-kpi-card h-100 d-flex flex-column justify-content-between" role="button" tabindex="0" aria-label="${escapeHtml(c.label)}">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <div class="d-flex align-items-center gap-2">
              <div class="gw-mgr-icon-box tone-${c.tone}">
                <i class="bi ${c.icon}"></i>
              </div>
              <span class="small fw-semibold text-secondary">${escapeHtml(c.label)}</span>
            </div>
            <i class="bi bi-chevron-right gw-mgr-chevron small"></i>
          </div>
          <div class="d-flex justify-content-between align-items-end">
            <div class="fs-2 fw-bold text-dark lh-1">${escapeHtml(String(c.value))}</div>
            <svg class="gw-mgr-sparkline-svg" viewBox="0 0 80 32" aria-hidden="true">
              <path d="${c.sparkPath}" stroke="${c.sparkColor}" />
            </svg>
          </div>
        </div>
      `;
      bindKpiClick(col, c.onClick);
      grid.appendChild(col);
    });
    return;
  }

  if (profile === 'purchasing') {
    const cards = [
      {
        icon: 'bi-exclamation-triangle',
        boxClass: 'bg-warning-subtle text-warning',
        label: 'Items to Reorder',
        value: kpis.items_to_reorder || 0,
        sparkColor: '#f59e0b',
        sparkPath: 'M 2 18 Q 18 20 28 14 T 48 10 T 68 4',
        onClick: () => navigateTo('purchase_order', { action: 'reorder' })
      },
      {
        icon: 'bi-file-earmark-text',
        boxClass: 'bg-primary-subtle text-primary',
        label: 'Pending POs',
        value: kpis.pos_pending_approval || 0,
        sparkColor: '#3b82f6',
        sparkPath: 'M 2 20 Q 20 18 32 16 T 50 14 T 68 6',
        onClick: () => navigateTo('purchase_order', { status: 'Pending Approval' })
      },
      {
        icon: 'bi-check2-circle',
        boxClass: 'bg-success-subtle text-success',
        label: 'Approved POs',
        value: kpis.po_awaiting_delivery || kpis.awaiting_delivery || 0,
        sparkColor: '#10b981',
        sparkPath: 'M 2 19 Q 20 22 36 12 T 52 14 T 68 4',
        onClick: () => navigateTo('purchase_order', { status: 'Ordered' })
      },
      {
        icon: 'bi-box-seam',
        boxClass: 'bg-info-subtle text-info',
        label: 'Partially Received',
        value: kpis.po_partially_received || kpis.partially_received || 0,
        sparkColor: '#f97316',
        sparkPath: 'M 2 18 Q 16 16 30 18 T 50 12 T 68 8',
        onClick: () => navigateTo('purchase_order', { status: 'Partially Received' })
      },
      {
        icon: 'bi-truck',
        boxClass: 'text-purple',
        boxStyle: 'background-color: #ede9fe; color: #8b5cf6;',
        label: 'Completed POs',
        value: kpis.po_completed || kpis.completed_pos || 0,
        sparkColor: '#8b5cf6',
        sparkPath: 'M 2 20 Q 20 20 34 14 T 52 14 T 68 6',
        onClick: () => navigateTo('purchase_order', { status: 'Received' })
      }
    ];
    cards.forEach(c => {
      const col = document.createElement('div');
      col.className = 'col-12 col-sm-6 col-lg-4 col-xl';
      col.innerHTML = `
        <div class="card po-summary-card shadow-sm h-100 border-0" role="button" tabindex="0">
          <div class="card-body p-3">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <div class="po-card-icon-box ${c.boxClass}" ${c.boxStyle ? `style="${c.boxStyle}"` : ''}>
                <i class="bi ${c.icon}"></i>
              </div>
              <span class="po-card-chevron text-muted"><i class="bi bi-chevron-right"></i></span>
            </div>
            <div class="text-muted small fw-medium mb-1">${escapeHtml(c.label)}</div>
            <div class="d-flex justify-content-between align-items-end">
              <h3 class="fw-bold mb-0 text-dark">${escapeHtml(String(c.value))}</h3>
              <svg class="po-sparkline" width="70" height="24" viewBox="0 0 70 24" fill="none" stroke="${c.sparkColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="${c.sparkPath}" />
              </svg>
            </div>
          </div>
        </div>
      `;
      bindKpiClick(col, c.onClick);
      grid.appendChild(col);
    });
    return;
  }

  if (profile === 'warehouse') {
    const cards = [
      { icon: 'bi-truck', tone: 'violet', pillClass: 'pill-violet', value: kpis.deliveries_awaiting_receiving || 0, label: 'Deliveries to Receive', onClick: () => navigateTo('stock_receiving') },
      { icon: 'bi-box-arrow-up', tone: 'maroon', pillClass: 'pill-maroon', value: kpis.pending_releases || 0, label: 'Pending Store Releases', onClick: () => navigateTo('stock_releasing') },
      { icon: 'bi-clipboard-check', tone: 'teal', pillClass: 'pill-teal', value: kpis.partially_received || 0, label: 'Partially Received', onClick: () => navigateTo('stock_receiving') },
      { icon: 'bi-check2-circle', tone: 'green', pillClass: 'pill-green', value: kpis.received_today || 0, label: 'Received Today', onClick: () => navigateTo('stock_receiving') },
      { icon: 'bi-exclamation-triangle', tone: 'amber', pillClass: 'pill-amber', value: kpis.low_stock_count || 0, label: 'Low Stock Items', onClick: () => navigateTo('product', { health: 'low' }) },
      { icon: 'bi-exclamation-triangle', tone: 'red', pillClass: 'pill-red', value: kpis.critical_stock_count || 0, label: 'Critical Stock', onClick: () => navigateTo('product', { health: 'critical' }) }
    ];
    cards.forEach(c => {
      const col = document.createElement('div');
      col.className = 'col-6 col-md-4 col-xl-2';
      col.innerHTML = `
        <div class="card kpi-card kpi-clickable h-100" role="button" tabindex="0">
          <div class="card-body p-3 d-flex flex-column justify-content-between">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <div class="kpi-label">${escapeHtml(c.label)}</div>
              <div class="kpi-icon-box tone-${c.tone}">
                <i class="bi ${c.icon}"></i>
              </div>
            </div>
            <div class="d-flex justify-content-between align-items-end mt-1">
              <div class="kpi-value">${escapeHtml(String(c.value))}</div>
              <span class="kpi-mini-pill ${c.pillClass}">${escapeHtml(String(c.value))}</span>
            </div>
          </div>
        </div>
      `;
      bindKpiClick(col, c.onClick);
      grid.appendChild(col);
    });
    return;
  }

  // Store Requester (5 horizontal summary cards on desktop)
  const reqCards = [
    {
      icon: 'bi-file-earmark-text',
      tone: 'blue',
      value: kpis.total_requests !== undefined ? kpis.total_requests : ((kpis.pending_approval || 0) + (kpis.approved || 0) + (kpis.for_revision || 0) + (kpis.rejected || 0) + (kpis.completed || 0)),
      label: 'My Requests',
      sparkColor: '#2563eb',
      sparkPath: 'M 2 24 C 20 22, 35 12, 50 18 C 65 24, 72 8, 78 6',
      onClick: () => openRequesterRequestsModal('all', 'My Purchase Requests')
    },
    {
      icon: 'bi-hourglass-split',
      tone: 'amber',
      value: kpis.pending_approval || 0,
      label: 'Pending',
      sparkColor: '#f59e0b',
      sparkPath: 'M 2 26 C 22 24, 38 18, 52 20 C 64 22, 70 12, 78 8',
      onClick: () => openRequesterRequestsModal('Pending', 'Pending Purchase Requests')
    },
    {
      icon: 'bi-check-circle',
      tone: 'green',
      value: kpis.approved || 0,
      label: 'Approved',
      sparkColor: '#10b981',
      sparkPath: 'M 2 24 C 18 20, 32 14, 48 10 C 62 6, 72 4, 78 2',
      onClick: () => openRequesterRequestsModal('Approved', 'Approved Purchase Requests')
    },
    {
      icon: 'bi-arrow-repeat',
      tone: 'orange',
      value: kpis.for_revision || 0,
      label: 'For Revision',
      sparkColor: '#f97316',
      sparkPath: 'M 2 14 C 20 18, 38 24, 54 22 C 66 20, 72 26, 78 28',
      onClick: () => openRequesterRequestsModal('For Revision', 'Returned for Revision Requests')
    },
    {
      icon: 'bi-x-circle',
      tone: 'red',
      value: kpis.rejected || 0,
      label: 'Rejected',
      sparkColor: '#ef4444',
      sparkPath: 'M 2 10 C 18 16, 36 22, 52 18 C 66 14, 72 24, 78 26',
      onClick: () => openRequesterRequestsModal('Rejected', 'Rejected Purchase Requests')
    }
  ];

  reqCards.forEach(c => {
    const col = document.createElement('div');
    col.className = 'col-12 col-sm-6 col-md-4 col-xl';
    col.innerHTML = `
      <div class="kpi-card gw-mgr-kpi-card h-100 d-flex flex-column justify-content-between" role="button" tabindex="0" aria-label="${escapeHtml(c.label)}">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <div class="d-flex align-items-center gap-2">
            <div class="gw-mgr-icon-box tone-${c.tone}">
              <i class="bi ${c.icon}"></i>
            </div>
            <span class="small fw-semibold text-secondary">${escapeHtml(c.label)}</span>
          </div>
          <i class="bi bi-chevron-right gw-mgr-chevron small"></i>
        </div>
        <div class="d-flex justify-content-between align-items-end">
          <div class="fs-2 fw-bold text-dark lh-1">${escapeHtml(String(c.value))}</div>
          <svg class="gw-mgr-sparkline-svg" viewBox="0 0 80 32" aria-hidden="true">
            <path d="${c.sparkPath}" stroke="${c.sparkColor}" />
          </svg>
        </div>
      </div>
    `;
    bindKpiClick(col, c.onClick);
    grid.appendChild(col);
  });
}

function bindKpiClick(col, onClick) {
  const cardEl = col.querySelector('.kpi-card');
  if (cardEl && typeof onClick === 'function') {
    cardEl.addEventListener('click', onClick);
    cardEl.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        onClick();
      }
    });
  }
}

let gwPipelinePrevCounts = null;

function getNormalizedPipelineCounts(p) {
  p = p || {};
  return {
    submitted: Number(p.submitted !== undefined ? p.submitted : 0),
    approved: Number(p.approved !== undefined ? p.approved : 0),
    po_issued: Number(p.po_issued !== undefined ? p.po_issued : (p.po_ordered !== undefined ? p.po_ordered : 0)),
    partially_received: Number(p.partially_received !== undefined ? p.partially_received : (p.po_partial !== undefined ? p.po_partial : 0)),
    completed: Number(p.completed !== undefined ? p.completed : (p.po_received !== undefined ? p.po_received : 0))
  };
}

function renderPipelineComponentHtml(p) {
  const current = getNormalizedPipelineCounts(p);
  // On initial load (gwPipelinePrevCounts === null), render with current counts directly without animation.
  // On subsequent calls, render with previous counts so animatePipelineNumber can tween to current counts!
  const display = (gwPipelinePrevCounts !== null) ? gwPipelinePrevCounts : current;

  return `
    <!-- Request-to-Receiving Pipeline -->
    <div class="card h-100 gw-pipeline-card shadow-sm border-0 rounded-3">
      <div class="card-header bg-transparent d-flex justify-content-between align-items-start py-3 px-3 px-md-4">
        <div>
          <h6 class="mb-0 fw-bold text-dark gw-section-title">Request-to-Receiving Pipeline</h6>
          <p class="text-muted small mb-0 mt-0.5">Live cross-stage volume from purchase request to warehouse receiving</p>
        </div>
        <button type="button" class="btn btn-sm btn-link text-decoration-none text-dark fw-medium p-0 text-nowrap" onclick="navigateTo('purchase_request')">View all</button>
      </div>
      <div class="card-body py-3 d-flex flex-column justify-content-center">
        <div class="gw-pipeline-flow" id="gwPipelineFlow">
          <!-- Stage 1: Submitted -->
          <div class="gw-pipeline-box tone-rose" id="pipeStage-submitted" role="button" tabindex="0" onclick="navigateTo('purchase_request', { status: 'Pending Approval' })" title="Submitted Purchase Requests">
            <div class="gw-pipe-icon-wrapper">
              <i class="bi bi-file-earmark-text gw-pipe-icon"></i>
            </div>
            <div class="gw-pipe-title">Submitted</div>
            <div class="gw-pipe-count" id="pipeCount-submitted">${display.submitted}</div>
          </div>

          <!-- Arrow 1 -->
          <div class="gw-pipe-arrow" id="pipeArrow-0"><i class="bi bi-arrow-right"></i></div>

          <!-- Stage 2: Approved -->
          <div class="gw-pipeline-box tone-rose" id="pipeStage-approved" role="button" tabindex="0" onclick="navigateTo('purchase_request', { status: 'Approved' })" title="Approved Requests Awaiting PO">
            <div class="gw-pipe-icon-wrapper">
              <i class="bi bi-check2-circle gw-pipe-icon"></i>
            </div>
            <div class="gw-pipe-title">Approved</div>
            <div class="gw-pipe-count" id="pipeCount-approved">${display.approved}</div>
          </div>

          <!-- Arrow 2 -->
          <div class="gw-pipe-arrow" id="pipeArrow-1"><i class="bi bi-arrow-right"></i></div>

          <!-- Stage 3: PO Issued -->
          <div class="gw-pipeline-box tone-violet" id="pipeStage-po_issued" role="button" tabindex="0" onclick="navigateTo('purchase_order', { status: 'Ordered' })" title="POs Issued to Suppliers">
            <div class="gw-pipe-icon-wrapper">
              <i class="bi bi-file-earmark-check gw-pipe-icon"></i>
            </div>
            <div class="gw-pipe-title">PO Issued</div>
            <div class="gw-pipe-count" id="pipeCount-po_issued">${display.po_issued}</div>
          </div>

          <!-- Arrow 3 -->
          <div class="gw-pipe-arrow" id="pipeArrow-2"><i class="bi bi-arrow-right"></i></div>

          <!-- Stage 4: Partially Received -->
          <div class="gw-pipeline-box tone-blue" id="pipeStage-partially_received" role="button" tabindex="0" onclick="navigateTo('stock_receiving')" title="Partially Received Deliveries">
            <div class="gw-pipe-icon-wrapper">
              <i class="bi bi-truck gw-pipe-icon"></i>
            </div>
            <div class="gw-pipe-title">Partially Received</div>
            <div class="gw-pipe-count" id="pipeCount-partially_received">${display.partially_received}</div>
          </div>

          <!-- Arrow 4 -->
          <div class="gw-pipe-arrow" id="pipeArrow-3"><i class="bi bi-arrow-right"></i></div>

          <!-- Stage 5: Completed -->
          <div class="gw-pipeline-box tone-green" id="pipeStage-completed" role="button" tabindex="0" onclick="navigateTo('purchase_order', { status: 'Received' })" title="Completed Orders Fully Received">
            <div class="gw-pipe-icon-wrapper">
              <i class="bi bi-check2-circle gw-pipe-icon"></i>
            </div>
            <div class="gw-pipe-title">Completed</div>
            <div class="gw-pipe-count" id="pipeCount-completed">${display.completed}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function initOrUpdatePipelineFlow(pipelineData) {
  const current = getNormalizedPipelineCounts(pipelineData);
  const flowEl = document.getElementById('gwPipelineFlow');
  if (!flowEl) return;

  const stages = ['submitted', 'approved', 'po_issued', 'partially_received', 'completed'];

  // Add keyboard navigation support (Enter / Space)
  stages.forEach(function (st) {
    const box = document.getElementById('pipeStage-' + st);
    if (box && !box.dataset.hasKeyHandler) {
      box.dataset.hasKeyHandler = 'true';
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          box.click();
        }
      });
    }
  });

  // CASE 1: First load / Page refresh
  // IMPORTANT: The animation should trigger only when the underlying transaction data actually changes.
  // Opening the dashboard or refreshing the page should not make every stage animate as if new transactions had occurred.
  if (gwPipelinePrevCounts === null) {
    stages.forEach(function (st) {
      const el = document.getElementById('pipeCount-' + st);
      if (el) el.textContent = current[st];
    });
    gwPipelinePrevCounts = Object.assign({}, current);
    return;
  }

  // CASE 2: Subsequent fetch — compare current counts against previous counts
  const prev = gwPipelinePrevCounts;
  const changedStages = [];
  stages.forEach(function (st) {
    if (prev[st] !== current[st]) {
      changedStages.push(st);
    }
  });

  // If no transaction counts changed, do not animate anything!
  if (changedStages.length === 0) {
    return;
  }

  const isReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Animate numbers and pulse only for stages whose counts changed
  changedStages.forEach(function (st) {
    const el = document.getElementById('pipeCount-' + st);
    const box = document.getElementById('pipeStage-' + st);

    if (el) {
      if (isReducedMotion) {
        el.textContent = current[st];
      } else {
        animatePipelineNumber(el, prev[st], current[st], 550);
      }
    }

    if (box && !isReducedMotion) {
      box.classList.remove('gw-pipe-stage-pulse');
      void box.offsetWidth; // trigger reflow
      box.classList.add('gw-pipe-stage-pulse');
    }
  });

  // Trigger smooth progression animations on connecting arrows
  if (!isReducedMotion) {
    // Stage 1 (Submitted) -> Stage 2 (Approved)
    if (prev.submitted > current.submitted || current.approved > prev.approved) {
      triggerArrowAnimation(0);
    }
    // Stage 2 (Approved) -> Stage 3 (PO Issued)
    if (prev.approved > current.approved || current.po_issued > prev.po_issued) {
      triggerArrowAnimation(1);
    }
    // Stage 3 (PO Issued) -> Stage 4 (Partially Received)
    if (prev.po_issued > current.po_issued || current.partially_received > prev.partially_received) {
      triggerArrowAnimation(2);
    }
    // Stage 4 (Partially Received) -> Stage 5 (Completed) or Stage 3 (PO Issued) -> Stage 5
    if (prev.partially_received > current.partially_received || current.completed > prev.completed) {
      triggerArrowAnimation(3);
    }
  }

  // Clean up pulse and arrow classes after animation
  setTimeout(function () {
    stages.forEach(function (st) {
      const box = document.getElementById('pipeStage-' + st);
      if (box) box.classList.remove('gw-pipe-stage-pulse');
    });
    for (let i = 0; i < 4; i++) {
      const arr = document.getElementById('pipeArrow-' + i);
      if (arr) arr.classList.remove('gw-pipe-arrow-active');
    }
  }, 1200);

  // Update previous counts store
  gwPipelinePrevCounts = Object.assign({}, current);
}

function triggerArrowAnimation(arrowIndex) {
  const arr = document.getElementById('pipeArrow-' + arrowIndex);
  if (!arr) return;
  arr.classList.remove('gw-pipe-arrow-active');
  void arr.offsetWidth;
  arr.classList.add('gw-pipe-arrow-active');
}

function animatePipelineNumber(element, start, end, duration) {
  if (start === end) {
    element.textContent = end;
    return;
  }
  const startTime = performance.now();
  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Smooth ease-out cubic curve
    const ease = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(start + (end - start) * ease);
    element.textContent = value;
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      element.textContent = end;
    }
  }
  requestAnimationFrame(step);
}

function renderDashboardWorkspace(profile, data) {
  const container = document.getElementById('dashboardRoleContent');
  if (!container) return;

  if (profile === 'admin') {
    container.innerHTML = renderAdminWorkspaceHtml(data);
    initOrUpdatePipelineFlow(data.pipeline);
  } else if (profile === 'manager') {
    container.innerHTML = renderManagerWorkspaceHtml(data);
  } else if (profile === 'purchasing') {
    container.innerHTML = renderPurchasingWorkspaceHtml(data);
  } else if (profile === 'warehouse') {
    container.innerHTML = renderWarehouseWorkspaceHtml(data);
  } else {
    container.innerHTML = renderRequesterWorkspaceHtml(data);
  }
}

function renderAdminWorkspaceHtml(data) {
  const p = data.pipeline || {};
  const alerts = (data.low_stock_products || []).slice(0, 5);
  const recentTx = (data.recent_transactions || []).slice(0, 6);

  return `
    <!-- Top Row: Pipeline & Stock Alerts -->
    <div class="row g-3 align-items-stretch mb-3">
      <!-- Left Column: Request-to-Receiving Pipeline -->
      <div class="col-12 col-xl-7">
        ${renderPipelineComponentHtml(p)}
      </div>

      <!-- Right Column: Stock Alerts (Low & Out of Stock) -->
      <div class="col-12 col-xl-5">
        <div class="card h-100 shadow-sm border-0 rounded-3">
          <div class="card-header bg-transparent d-flex justify-content-between align-items-start py-3 px-3 px-md-4">
            <div>
              <h6 class="mb-0 fw-bold text-dark gw-section-title">Stock Alerts (Low &amp; Out of Stock)</h6>
              <p class="text-muted small mb-0 mt-0.5">Items needing immediate procurement attention</p>
            </div>
            <button type="button" class="btn btn-sm btn-link text-decoration-none text-dark fw-medium p-0 text-nowrap" onclick="openStockAlertsModal()">View all</button>
          </div>
          <div class="card-body p-3">
            ${alerts.length === 0 ? '<div class="text-center text-muted small py-3 fst-italic">All active products are currently in stock.</div>' : alerts.map(item => renderStockBarRowHtml(item)).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Row: Recent Transactions Live Feed -->
    <div class="card shadow-sm border-0 rounded-3">
      <div class="card-header bg-transparent d-flex justify-content-between align-items-start py-3 px-3 px-md-4">
        <div class="d-flex align-items-start gap-2">
          <i class="bi bi-clock-history text-info fs-5 mt-0.5"></i>
          <div>
            <h6 class="mb-0 fw-bold text-dark gw-section-title">Recent Transactions</h6>
            <p class="text-muted small mb-0 mt-0.5">Audit trail across all warehouse operational events</p>
          </div>
        </div>
        <button type="button" class="btn btn-sm btn-link text-decoration-none text-dark fw-medium p-0 text-nowrap" onclick="openRecentTransactionsModal()">View all &rarr;</button>
      </div>
      <div class="table-responsive">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th class="ps-3 ps-md-4">REFERENCE</th>
              <th>TRANSACTION TYPE</th>
              <th>USER / ACTOR</th>
              <th>STATUS</th>
              <th>DATE</th>
              <th class="text-end pe-3 pe-md-4">ACTION</th>
            </tr>
          </thead>
          <tbody>
            ${recentTx.length === 0 ? '<tr><td colspan="6" class="text-center text-muted py-4 fst-italic">No recent transactions recorded.</td></tr>' : recentTx.map(tx => `
              <tr role="button" onclick="handleDashboardTxClick('${escapeHtml(tx.tx_type)}', ${parseInt(tx.ref_id) || 0})">
                <td class="font-monospace fw-bold text-dark ps-3 ps-md-4">${escapeHtml(tx.ref_code || tx.ref_no || '-')}</td>
                <td>
                  <span class="badge bg-light text-dark border font-monospace">${escapeHtml(tx.tx_type)}</span>
                </td>
                <td class="fw-semibold text-dark">${escapeHtml(tx.actor || tx.actor_name || '-')}</td>
                <td>${renderWorkflowStatusHtml(tx.status)}</td>
                <td class="small text-muted font-monospace">${escapeHtml(tx.tx_date || '')}</td>
                <td class="text-end pe-3 pe-md-4">
                  <button type="button" class="btn btn-sm btn-outline-secondary py-0.5 px-2.5 font-monospace" onclick="event.stopPropagation(); handleDashboardTxClick('${escapeHtml(tx.tx_type)}', ${parseInt(tx.ref_id) || 0})">View</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderManagerWorkspaceHtml(data) {
  const queue = data.approval_queue || [];
  const poApprovalQueue = data.po_approval_queue || [];
  const comparisons = data.stock_comparison || [];

  return `
    <!-- ROW 2: Purchase Requests Approval Queue (Full Width) -->
    <div class="card mb-3 shadow-sm border-0 rounded-3">
      <div class="card-header bg-transparent d-flex justify-content-between align-items-center py-3 px-3 px-md-4">
        <h6 class="mb-0 fw-bold text-dark gw-section-title">Purchase Requests Approval Queue</h6>
        <button type="button" class="btn btn-sm btn-link text-decoration-none text-violet fw-semibold p-0 text-nowrap" onclick="openMgrPrListModal('Pending', 'Purchase Requests Approval Queue')">View all</button>
      </div>
      <div class="table-responsive">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th class="ps-3 ps-md-4">REQUEST NO.</th>
              <th>REQUESTED BY</th>
              <th class="text-center">ITEMS</th>
              <th class="text-center">REQUESTED QTY</th>
              <th>SUBMITTED</th>
              <th>STATUS</th>
              <th class="text-end pe-3 pe-md-4">ACTION</th>
            </tr>
          </thead>
          <tbody>
            ${queue.length === 0 ? '<tr><td colspan="7" class="text-center text-muted py-4 fst-italic">No purchase requests awaiting approval right now.</td></tr>' : queue.slice(0, 5).map(pr => `
              <tr>
                <td class="font-monospace fw-bold ps-3 ps-md-4">${escapeHtml(pr.pr_code)}</td>
                <td class="fw-semibold text-dark">${escapeHtml(pr.requested_by_name || pr.requested_by || '—')}</td>
                <td class="text-center font-monospace">${pr.item_count || 1}</td>
                <td class="text-center font-monospace">${pr.total_requested_qty || 0}</td>
                <td class="small text-muted">${formatDisplayDate(pr.submitted_at || pr.request_date)}</td>
                <td><span class="badge bg-warning text-dark font-monospace">Pending</span></td>
                <td class="text-end pe-3 pe-md-4">
                  <button type="button" class="btn btn-sm btn-primary px-3 fw-semibold" onclick="openApprovePrModal(${pr.pr_id})">Review</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- ROW 3: Two Columns (Side-by-side on desktop) -->
    <div class="row g-3 mb-3 align-items-start">
      <!-- Left Column: Replenishment POs Awaiting Manager Approval -->
      <div class="col-12 col-xl-7">
        <div class="card shadow-sm border-0 rounded-3">
          <div class="card-header bg-transparent d-flex justify-content-between align-items-center py-3 px-3 px-md-4">
            <h6 class="mb-0 fw-bold text-dark gw-section-title">Replenishment POs Awaiting Manager Approval</h6>
            <button type="button" class="btn btn-sm btn-link text-decoration-none text-violet fw-semibold p-0 text-nowrap" onclick="openMgrPoApprovalModal()">View all</button>
          </div>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th class="ps-3 ps-md-4">PO NUMBER</th>
                  <th>SUPPLIER</th>
                  <th class="text-center">ITEMS</th>
                  <th>TOTAL COST</th>
                  <th>ORDER DATE</th>
                  <th class="text-end pe-3 pe-md-4">ACTION</th>
                </tr>
              </thead>
              <tbody>
                ${poApprovalQueue.length === 0 ? '<tr><td colspan="6" class="text-center text-muted py-3.5 fst-italic">No direct replenishment purchase orders currently awaiting manager approval.</td></tr>' : poApprovalQueue.slice(0, 5).map(po => `
                  <tr>
                    <td class="font-monospace fw-bold ps-3 ps-md-4">${escapeHtml(po.po_code)}</td>
                    <td class="fw-semibold text-dark">${escapeHtml(po.supplier_name)}</td>
                    <td class="text-center font-monospace">${po.item_count || 1}</td>
                    <td class="font-monospace fw-semibold">${peso(po.total_cost || 0)}</td>
                    <td class="small text-muted">${formatDisplayDate(po.order_date)}</td>
                    <td class="text-end pe-3 pe-md-4">
                      <button type="button" class="btn btn-sm btn-primary px-3 fw-semibold" onclick="handleManagerReviewPo(${po.po_id})">Review</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Right Column: Requested vs Available Stock (Grouped Bar Chart) -->
      <div class="col-12 col-xl-5">
        <div class="card shadow-sm border-0 rounded-3">
          <div class="card-header bg-transparent d-flex justify-content-between align-items-center py-3 px-3 px-md-4">
            <h6 class="mb-0 fw-bold text-dark gw-section-title" role="button" onclick="openMgrStockComparisonModal()">Requested vs Available Stock</h6>
            <select class="form-select form-select-sm" id="mgrStockFilterSelect" style="width: auto; max-width: 190px;" onchange="handleMgrChartFilterChange(this.value)">
              <option value="top5" selected>Top 5 by Requested Qty</option>
              <option value="top10">Top 10 by Requested Qty</option>
              <option value="low">Low Stock Products</option>
              <option value="critical">Critical Stock Products</option>
              <option value="all">All Relevant Products</option>
            </select>
          </div>
          <div class="card-body p-3" id="mgrStockChartCardBody">
            ${renderManagerStockChartHtml(comparisons)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPurchasingWorkspaceHtml(data) {
  const readyPrs = data.approved_requests_queue || [];
  const reorderItems = data.items_to_reorder || [];
  const recentPos = data.recent_pos || [];
  const expectedDeliveries = recentPos.filter(po => po.status === 'Ordered' || po.status === 'Partially Received').slice(0, 4);
  const notifs = (data.notifications || []).slice(0, 5);

  return `
    <div class="row g-3">
      <div class="col-12 col-xl-8">
        ${reorderItems.length > 0 ? `
          <!-- Warehouse Items Reaching Reorder Level (Suggested Replenishments) -->
          <div class="card mb-3 border-amber shadow-sm">
            <div class="card-header bg-transparent d-flex justify-content-between align-items-center">
              <div class="d-flex align-items-center gap-2">
                <i class="bi bi-exclamation-triangle-fill text-warning fs-5"></i>
                <h6 class="mb-0 gw-section-title">Warehouse Replenishment Needed (Low Stock)</h6>
                <span class="badge bg-warning text-dark font-monospace">${reorderItems.length} items</span>
              </div>
              <button class="btn btn-sm btn-link text-decoration-none text-violet fw-semibold p-0" onclick="navigateTo('purchase_order')">Open PO Desk</button>
            </div>
            <div class="table-responsive">
              <table class="table table-hover align-middle mb-0">
                <thead class="table-light">
                  <tr>
                    <th>Product</th>
                    <th class="text-center">Avail Stock</th>
                    <th class="text-center">Reorder Level</th>
                    <th class="text-center">Max Stock</th>
                    <th class="text-center">Suggested Qty</th>
                    <th class="text-end">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${reorderItems.slice(0, 5).map(it => `
                    <tr>
                      <td class="fw-semibold text-dark">${escapeHtml(it.product_name)}</td>
                      <td class="text-center font-monospace ${Number(it.available_stock) <= Number(it.reorder_threshold) ? 'text-danger fw-bold' : ''}">${it.available_stock}</td>
                      <td class="text-center font-monospace">${it.reorder_threshold}</td>
                      <td class="text-center font-monospace">${it.max_stock}</td>
                      <td class="text-center font-monospace fw-bold text-violet">${it.net_suggested_order_qty}</td>
                      <td class="text-end text-nowrap">
                        <button class="btn btn-sm btn-primary py-0.5 px-2.5" onclick="navigateTo('purchase_order')"><i class="bi bi-cart-plus me-1"></i>Prepare PO</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        <!-- Approved Requests Ready for Purchasing -->
        <div class="card mb-3">
          <div class="card-header d-flex justify-content-between align-items-center">
            <h6 class="mb-0 gw-section-title">Approved Requests Ready for Purchasing</h6>
            <button class="btn btn-sm btn-link text-decoration-none text-violet fw-semibold p-0" onclick="navigateTo('purchase_request', { status: 'Approved' })">View all</button>
          </div>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>Request No.</th>
                  <th>Approved By</th>
                  <th>Items</th>
                  <th>Approved Qty</th>
                  <th>Approved On</th>
                  <th class="text-end">Action</th>
                </tr>
              </thead>
              <tbody>
                ${readyPrs.length === 0 ? '<tr><td colspan="6" class="text-center text-muted py-4 fst-italic">No approved requests waiting for PO creation.</td></tr>' : readyPrs.map(pr => `
                  <tr>
                    <td class="font-monospace fw-bold">${escapeHtml(pr.pr_code)}</td>
                    <td>
                      <div>${escapeHtml(pr.approved_by_name || '—')}</div>
                      ${(pr.reviewer_role || pr.reviewer_role_name) ? `<div class="text-muted" style="font-size:0.72rem;">${escapeHtml(pr.reviewer_role || pr.reviewer_role_name)}</div>` : ''}
                    </td>
                    <td>${pr.item_count || 1} ${parseInt(pr.item_count) === 1 ? 'item' : 'items'}</td>
                    <td class="font-monospace fw-semibold">${pr.total_approved_qty} pcs</td>
                    <td class="small text-muted">${escapeHtml((pr.approved_at || pr.request_date || '').slice(0, 10))}</td>
                    <td class="text-end text-nowrap">
                      ${can('purchase_order', 'manage')
                        ? `<button class="btn btn-sm btn-primary px-3" onclick="openCreatePoFromPr(${pr.pr_id})"><i class="bi bi-plus-lg me-1"></i>Create PO</button>`
                        : `<button class="btn btn-sm btn-outline-success" onclick="viewPurchaseRequestDetails(${pr.pr_id})">View</button>`}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Open Purchase Orders (Essential Columns Only) -->
        <div class="card">
          <div class="card-header d-flex justify-content-between align-items-center">
            <h6 class="mb-0 gw-section-title">Open Purchase Orders</h6>
            <button class="btn btn-sm btn-link text-decoration-none text-violet fw-semibold p-0" onclick="navigateTo('purchase_order')">Manage All POs</button>
          </div>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>PO Number</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Order Date</th>
                  <th class="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${recentPos.length === 0 ? '<tr><td colspan="5" class="text-center text-muted py-4 fst-italic">No purchase orders created yet.</td></tr>' : recentPos.map(po => {
                  const rcvd = parseInt(po.total_received) || 0;
                  const ord = Math.max(1, parseInt(po.total_ordered) || 1);
                  const pct = Math.min(100, Math.round((rcvd / ord) * 100));
                  const showBar = po.status === 'Partially Received' || rcvd > 0;
                  return `
                    <tr>
                      <td>
                        <div class="font-monospace fw-bold">${escapeHtml(po.po_code)}</div>
                        ${po.pr_code ? `<div class="small text-muted font-monospace">Ref: ${escapeHtml(po.pr_code)}</div>` : ''}
                      </td>
                      <td class="fw-medium">${escapeHtml(po.supplier_name)}</td>
                      <td>
                        ${renderWorkflowStatusHtml(po.status)}
                        ${showBar ? `
                          <div class="d-flex align-items-center gap-2 mt-1" style="max-width:160px;">
                            <div class="stock-bar-track"><div class="stock-bar-fill fill-teal" style="width:${pct}%"></div></div>
                            <span class="small font-monospace text-muted">${rcvd}/${po.total_ordered || 0}</span>
                          </div>
                        ` : ''}
                      </td>
                      <td class="small text-muted">${escapeHtml(po.order_date)}</td>
                      <td class="text-end text-nowrap">
                        <button class="btn btn-sm btn-link text-success p-1" onclick="viewPurchaseOrderDetails(${po.po_id})" title="View Details" aria-label="View PO Details"><i class="bi bi-eye fs-6"></i></button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Right Column: Expected Deliveries + Recent Purchasing Activity -->
      <div class="col-12 col-xl-4">
        <div class="card mb-3">
          <div class="card-header">
            <h6 class="mb-0 gw-section-title">Expected Deliveries</h6>
          </div>
          <div class="card-body p-3">
            ${expectedDeliveries.length === 0 ? '<div class="text-muted small fst-italic text-center py-3">No pending supplier deliveries scheduled.</div>' : `
              <ul class="gw-timeline-list">
                ${expectedDeliveries.map(po => {
                  const rem = Math.max(0, (parseInt(po.total_ordered) || 0) - (parseInt(po.total_received) || 0));
                  return `
                    <li class="gw-timeline-item" role="button" onclick="viewPurchaseOrderDetails(${po.po_id})">
                      <span class="gw-timeline-dot"></span>
                      <div class="d-flex justify-content-between align-items-start gap-2">
                        <div>
                          <div class="fw-semibold small text-dark">${escapeHtml(po.po_code)} ${escapeHtml(po.supplier_name)}</div>
                          <div class="small text-muted">Remaining ${rem} units</div>
                        </div>
                        <span class="badge bg-light text-dark border small">${escapeHtml(po.order_date || 'Scheduled')}</span>
                      </div>
                    </li>
                  `;
                }).join('')}
              </ul>
            `}
          </div>
        </div>

        <div class="card">
          <div class="card-header d-flex justify-content-between align-items-center">
            <h6 class="mb-0 gw-section-title">Recent Purchasing Activity</h6>
            <button class="btn btn-sm btn-link text-decoration-none text-violet fw-semibold p-0" onclick="navigateTo('notifications')">View all</button>
          </div>
          <div class="card-body p-3">
            ${notifs.length === 0 ? '<div class="text-muted small fst-italic text-center py-3">No recent activity.</div>' : `
              <ul class="gw-timeline-list">
                ${notifs.map(n => `
                  <li class="gw-timeline-item" role="button" onclick="handleNotificationClick(${n.notification_id}, '${escapeHtml(n.entity_type || '')}', ${parseInt(n.entity_id) || 0})">
                    <span class="gw-timeline-dot"></span>
                    <div class="fw-semibold small text-dark">${escapeHtml(n.title)}</div>
                    <div class="small text-muted">${escapeHtml(n.message)}</div>
                    <div class="text-violet mt-1" style="font-size:0.7rem;">${escapeHtml((n.created_at || '').slice(0, 16))}</div>
                  </li>
                `).join('')}
              </ul>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderWarehouseWorkspaceHtml(data) {
  const deliveries = data.incoming_deliveries || [];
  const pendingPrReleases = data.pending_pr_releases || [];
  const lowStock = (data.low_stock_products || data.stock_alerts || data.all_stock_alerts || []);
  const recentRcv = data.recent_receivings || [];
  const movements = data.recent_movements || [];

  return `
    <div class="row g-3">
      <!-- LEFT AND CENTER CONTENT (col-xl-8) -->
      <div class="col-12 col-xl-8">
        <!-- Row 1: Approved Store Requests & Incoming Deliveries side-by-side -->
        <div class="row g-3 mb-3">
          <!-- Card 1: Approved Store Requests -->
          <div class="col-12 col-md-6">
            <div class="card h-100 shadow-sm border-0">
              <div class="card-header bg-transparent gw-card-header-flex d-flex justify-content-between align-items-center py-3" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:nowrap;gap:0.75rem;">
                <h6 class="mb-0 fw-bold text-dark text-truncate gw-card-header-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto;" title="Approved Store Requests">Approved Store Requests</h6>
                <button type="button" class="btn btn-sm btn-link text-decoration-none text-violet fw-semibold p-0 text-nowrap flex-shrink-0 gw-card-header-action" style="white-space:nowrap;flex-shrink:0;margin-left:auto;" onclick="openWhApprovedStoreRequestsModal()">View all &rarr;</button>
              </div>
              <div class="table-responsive flex-grow-1 gw-dashboard-table-wrap">
                <table class="table table-hover align-middle mb-0 gw-dashboard-preview-table" style="table-layout: fixed; width: 100%;">
                  <colgroup>
                    <col style="width: 28%;">
                    <col style="width: 40%;">
                    <col style="width: 32%;">
                  </colgroup>
                  <thead class="table-light">
                    <tr>
                      <th class="small text-muted fw-bold ps-3 text-truncate" style="width: 28%;">REQUEST NO.</th>
                      <th class="small text-muted fw-bold text-truncate" style="width: 40%;">DESTINATION STORE</th>
                      <th class="small text-muted fw-bold pe-3 text-truncate" style="width: 32%;">REQUESTED BY</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${pendingPrReleases.length === 0 ? '<tr><td colspan="3" class="text-center text-muted py-4 fst-italic">No approved store requests awaiting release.</td></tr>' : pendingPrReleases.slice(0, 3).map(pr => `
                      <tr>
                        <td class="font-monospace fw-bold ps-3 text-truncate" title="${escapeHtml(pr.pr_code)}">${escapeHtml(pr.pr_code)}</td>
                        <td class="fw-semibold text-truncate" title="${escapeHtml(pr.store_name || 'Main Store')}">${escapeHtml(pr.store_name || 'Main Store')}</td>
                        <td class="small text-muted pe-3 text-truncate" title="${escapeHtml(pr.requested_by_name || '—')}">${escapeHtml(pr.requested_by_name || '—')}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Card 2: Incoming Deliveries -->
          <div class="col-12 col-md-6">
            <div class="card h-100 shadow-sm border-0">
              <div class="card-header bg-transparent gw-card-header-flex d-flex justify-content-between align-items-center py-3" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:nowrap;gap:0.75rem;">
                <h6 class="mb-0 fw-bold text-dark text-truncate gw-card-header-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto;" title="Incoming Deliveries">Incoming Deliveries</h6>
                <button type="button" class="btn btn-sm btn-link text-decoration-none text-violet fw-semibold p-0 text-nowrap flex-shrink-0 gw-card-header-action" style="white-space:nowrap;flex-shrink:0;margin-left:auto;" onclick="openWhIncomingDeliveriesModal()">View all &rarr;</button>
              </div>
              <div class="table-responsive flex-grow-1 gw-dashboard-table-wrap">
                <table class="table table-hover align-middle mb-0 gw-dashboard-preview-table" style="table-layout: fixed; width: 100%;">
                  <colgroup>
                    <col style="width: 28%;">
                    <col style="width: 42%;">
                    <col style="width: 30%;">
                  </colgroup>
                  <thead class="table-light">
                    <tr>
                      <th class="small text-muted fw-bold ps-3 text-truncate" style="width: 28%;">PO NUMBER</th>
                      <th class="small text-muted fw-bold text-truncate" style="width: 42%;">SUPPLIER</th>
                      <th class="small text-muted fw-bold pe-3 text-truncate" style="width: 30%;">EXPECTED ITEMS</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${deliveries.length === 0 ? '<tr><td colspan="3" class="text-center text-muted py-4 fst-italic">No pending supplier deliveries.</td></tr>' : deliveries.slice(0, 3).map(d => `
                      <tr>
                        <td class="font-monospace fw-bold ps-3 text-truncate" title="${escapeHtml(d.po_code)}">${escapeHtml(d.po_code)}</td>
                        <td class="fw-semibold text-truncate" title="${escapeHtml(d.supplier_name)}">${escapeHtml(d.supplier_name)}</td>
                        <td class="font-monospace text-muted small pe-3 text-truncate" title="${d.item_count ? d.item_count + ' items' : (d.total_ordered || 0) + ' units'}">${d.item_count ? d.item_count + ' items' : (d.total_ordered || 0) + ' units'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- Row 2: Recent Delivery Receipts (DR) -->
        <div class="row g-3">
          <div class="col-12">
            <div class="card shadow-sm border-0">
              <div class="card-header bg-transparent gw-card-header-flex d-flex justify-content-between align-items-center py-3" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:nowrap;gap:0.75rem;">
                <h6 class="mb-0 fw-bold text-dark text-truncate gw-card-header-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto;" title="Recent Delivery Receipts (DR)">Recent Delivery Receipts (DR)</h6>
                <button type="button" class="btn btn-sm btn-link text-decoration-none text-violet fw-semibold p-0 text-nowrap flex-shrink-0 gw-card-header-action" style="white-space:nowrap;flex-shrink:0;margin-left:auto;" onclick="openWhDeliveryReceiptsModal()">View all &rarr;</button>
              </div>
              <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                  <thead class="table-light">
                    <tr>
                      <th class="small text-muted fw-bold ps-3">RECEIVING NO.</th>
                      <th class="small text-muted fw-bold">PO NO.</th>
                      <th class="small text-muted fw-bold">SUPPLIER</th>
                      <th class="small text-muted fw-bold text-center">UNITS RCVD</th>
                      <th class="small text-muted fw-bold pe-3">DATE</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${recentRcv.length === 0 ? '<tr><td colspan="5" class="text-center text-muted py-4 fst-italic">No receiving records yet.</td></tr>' : recentRcv.slice(0, 3).map(r => `
                      <tr>
                        <td class="font-monospace fw-semibold ps-3">${escapeHtml(r.receiving_code)}</td>
                        <td class="font-monospace">${escapeHtml(r.po_code)}</td>
                        <td class="text-truncate" style="max-width: 180px;">${escapeHtml(r.supplier_name)}</td>
                        <td class="text-center font-monospace fw-bold text-success">+${r.total_received}</td>
                        <td class="small text-muted pe-3">${escapeHtml(r.receiving_date)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT CONTENT (col-xl-4) -->
      <div class="col-12 col-xl-4">
        <!-- Low & Critical Stock -->
        <div class="card mb-3 shadow-sm border-0">
          <div class="card-header bg-transparent gw-card-header-flex d-flex justify-content-between align-items-center py-3" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:nowrap;gap:0.75rem;">
            <h6 class="mb-0 fw-bold text-dark text-truncate gw-card-header-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto;" title="Low &amp; Critical Stock">Low &amp; Critical Stock</h6>
            <button type="button" class="btn btn-sm btn-link text-decoration-none text-violet fw-semibold p-0 text-nowrap flex-shrink-0 gw-card-header-action" style="white-space:nowrap;flex-shrink:0;margin-left:auto;" onclick="openStockAlertsModal()">View all</button>
          </div>
          <div class="card-body p-3">
            ${lowStock.length === 0 ? `
              <div class="text-center text-muted py-4">
                <i class="bi bi-box fs-1 d-block mb-2 text-muted opacity-50"></i>
                <div class="small">All products are above reorder threshold.</div>
              </div>
            ` : lowStock.slice(0, 5).map(item => renderStockBarRowHtml(item)).join('')}
          </div>
        </div>

        <!-- Recent Stock Movements -->
        <div class="card shadow-sm border-0">
          <div class="card-header bg-transparent gw-card-header-flex d-flex justify-content-between align-items-center py-3" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:nowrap;gap:0.75rem;">
            <h6 class="mb-0 fw-bold text-dark text-truncate gw-card-header-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto;" title="Recent Stock Movements">Recent Stock Movements</h6>
            <button type="button" class="btn btn-sm btn-link text-decoration-none text-violet fw-semibold p-0 text-nowrap flex-shrink-0 gw-card-header-action" style="white-space:nowrap;flex-shrink:0;margin-left:auto;" onclick="navigateTo('stock_movement')">Ledger &rarr;</button>
          </div>
          <div class="card-body p-3">
            ${movements.length === 0 && recentRcv.length === 0 ? `
              <div class="text-center text-muted small py-4 fst-italic">No recent stock movements.</div>
            ` : `
              <ul class="gw-timeline-list mb-0">
                ${(movements.length > 0 ? movements : recentRcv.map(r => ({
                  ref_no: r.receiving_code,
                  direction: 'IN',
                  product_name: r.supplier_name,
                  qty: r.total_received,
                  move_date: r.receiving_date
                }))).slice(0, 5).map(m => {
                  const isIn = m.direction === 'IN';
                  const dotColor = isIn ? '#22C55E' : '#EF4444';
                  const dotBorder = isIn ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)';
                  const textClass = isIn ? 'text-success' : 'text-danger';
                  const sign = isIn ? '+' : '-';
                  return `
                    <li class="gw-timeline-item" role="button" onclick="navigateTo('stock_movement')">
                      <span class="gw-timeline-dot" style="background:${dotColor};border-color:${dotBorder};"></span>
                      <div class="d-flex justify-content-between align-items-center">
                        <div class="text-truncate me-2">
                          <span class="fw-bold font-monospace ${textClass} me-2">${sign}${m.qty}</span>
                          <span class="fw-semibold small text-dark">${escapeHtml(m.product_name)}</span>
                          <span class="text-muted small ms-1">(${escapeHtml(m.ref_no)})</span>
                        </div>
                        <span class="small text-muted flex-shrink-0">${escapeHtml(m.move_date || '')}</span>
                      </div>
                    </li>
                  `;
                }).join('')}
              </ul>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Warehouse Dashboard: Modals, Search, Filter & Pagination Controllers
// -----------------------------------------------------------------------------

let whPrModalState = { page: 1, pageSize: 5, search: '', store: '' };
let whPoModalState = { page: 1, pageSize: 5, search: '', supplier: '' };
let whDrModalState = { page: 1, pageSize: 5, search: '' };

function renderPaginationButtons(currentPage, totalPages, fnName) {
  if (totalPages <= 1) return '';
  let html = '';

  html += `
    <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
      <button class="page-link py-1 px-2.5 small" type="button" onclick="${fnName}(${currentPage - 1})" aria-label="Previous">
        <i class="bi bi-chevron-left"></i>
      </button>
    </li>
  `;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      html += `
        <li class="page-item ${i === currentPage ? 'active' : ''}">
          <button class="page-link py-1 px-2.5 small" type="button" onclick="${fnName}(${i})">${i}</button>
        </li>
      `;
    } else if (i === currentPage - 2 || i === currentPage + 2) {
      html += `<li class="page-item disabled"><span class="page-link py-1 px-2 small">…</span></li>`;
    }
  }

  html += `
    <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
      <button class="page-link py-1 px-2.5 small" type="button" onclick="${fnName}(${currentPage + 1})" aria-label="Next">
        <i class="bi bi-chevron-right"></i>
      </button>
    </li>
  `;

  return html;
}

// Modal 1: Approved Store Requests
function openWhApprovedStoreRequestsModal() {
  const modalEl = document.getElementById('whApprovedStoreRequestsModal');
  if (!modalEl) return;

  const data = (lastDashboardData && lastDashboardData.pending_pr_releases) || [];

  const storeFilter = document.getElementById('whModalPrStoreFilter');
  if (storeFilter) {
    const currentVal = whPrModalState.store || '';
    const stores = Array.from(new Set(data.map(p => p.store_name || 'Main Store'))).sort();
    storeFilter.innerHTML = '<option value="">All Stores / Branches</option>' +
      stores.map(s => `<option value="${escapeHtml(s)}"${s === currentVal ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('');
  }

  initWhModalPrListeners();

  whPrModalState.page = 1;
  renderWhPrModalTable();

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

let whModalPrListenersInitialized = false;
function initWhModalPrListeners() {
  if (whModalPrListenersInitialized) return;
  whModalPrListenersInitialized = true;

  const searchInput = document.getElementById('whModalPrSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      whPrModalState.search = this.value.trim().toLowerCase();
      whPrModalState.page = 1;
      renderWhPrModalTable();
    });
  }

  const storeFilter = document.getElementById('whModalPrStoreFilter');
  if (storeFilter) {
    storeFilter.addEventListener('change', function() {
      whPrModalState.store = this.value;
      whPrModalState.page = 1;
      renderWhPrModalTable();
    });
  }

  const pageSizeSel = document.getElementById('whModalPrPageSize');
  if (pageSizeSel) {
    pageSizeSel.addEventListener('change', function() {
      whPrModalState.pageSize = parseInt(this.value) || 5;
      whPrModalState.page = 1;
      renderWhPrModalTable();
    });
  }
}

function renderWhPrModalTable() {
  const tbody = document.getElementById('whModalPrTableBody');
  const badge = document.getElementById('whModalPrCountBadge');
  const info = document.getElementById('whModalPrPaginationInfo');
  const pag = document.getElementById('whModalPrPagination');
  if (!tbody) return;

  const allRequests = (lastDashboardData && lastDashboardData.pending_pr_releases) || [];

  const filtered = allRequests.filter(r => {
    if (whPrModalState.store && (r.store_name || 'Main Store') !== whPrModalState.store) {
      return false;
    }
    if (whPrModalState.search) {
      const q = whPrModalState.search;
      const code = (r.pr_code || '').toLowerCase();
      const store = (r.store_name || 'Main Store').toLowerCase();
      const requester = (r.requested_by_name || '').toLowerCase();
      if (!code.includes(q) && !store.includes(q) && !requester.includes(q)) {
        return false;
      }
    }
    return true;
  });

  if (badge) badge.textContent = String(filtered.length);

  const total = filtered.length;
  const pageSize = whPrModalState.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  whPrModalState.page = Math.min(Math.max(1, whPrModalState.page), totalPages);
  const startIdx = (whPrModalState.page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageItems = filtered.slice(startIdx, endIdx);

  if (info) {
    info.textContent = total === 0 ? 'Showing 0 to 0 of 0 entries' : `Showing ${startIdx + 1} to ${endIdx} of ${total} entries`;
  }

  if (pag) {
    pag.innerHTML = renderPaginationButtons(whPrModalState.page, totalPages, 'setWhPrPage');
  }

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted fst-italic">No matching store requests found.</td></tr>';
    return;
  }

  tbody.innerHTML = pageItems.map(pr => `
    <tr>
      <td class="font-monospace fw-bold ps-3">${escapeHtml(pr.pr_code)}</td>
      <td class="fw-semibold text-violet">${escapeHtml(pr.store_name || 'Main Store')}</td>
      <td>${escapeHtml(pr.requested_by_name || '—')}</td>
      <td class="font-monospace">${pr.item_count || 1} items (${pr.total_approved_qty || 0} units)</td>
      <td class="small text-muted">${escapeHtml((pr.reviewed_at || pr.submitted_at || '').slice(0, 10))}</td>
      <td class="text-end pe-3 text-nowrap">
        ${can('stock_releasing', 'manage') ? `<button type="button" class="btn btn-sm btn-outline-success fw-semibold px-2.5 py-1" onclick="handleWhModalRelease(${pr.pr_id})"><i class="bi bi-box-arrow-up me-1"></i>Release</button>` : '—'}
      </td>
    </tr>
  `).join('');
}

function setWhPrPage(page) {
  whPrModalState.page = page;
  renderWhPrModalTable();
}

async function handleWhModalRelease(prId) {
  closeModal('whApprovedStoreRequestsModal');
  if (typeof openFulfillStoreRequestModal === 'function') {
    if (typeof pendingPrReleasesCache !== 'undefined' && (!pendingPrReleasesCache.length || !pendingPrReleasesCache.find(p => parseInt(p.pr_id) === parseInt(prId)))) {
      try {
        const res = await axios.get(API + 'stock_releasing.php?mode=pending_pr_releases');
        if (res.data && res.data.success) {
          pendingPrReleasesCache = res.data.data || [];
        }
      } catch (err) {
        console.warn('Failed to load pending PR releases cache', err);
      }
    }
    openFulfillStoreRequestModal(prId);
  } else {
    navigateTo('stock_releasing');
  }
}

// Modal 2: Incoming Deliveries
function openWhIncomingDeliveriesModal() {
  const modalEl = document.getElementById('whIncomingDeliveriesModal');
  if (!modalEl) return;

  const data = (lastDashboardData && lastDashboardData.incoming_deliveries) || [];

  const supplierFilter = document.getElementById('whModalPoSupplierFilter');
  if (supplierFilter) {
    const currentVal = whPoModalState.supplier || '';
    const suppliers = Array.from(new Set(data.map(p => p.supplier_name))).filter(Boolean).sort();
    supplierFilter.innerHTML = '<option value="">All Suppliers</option>' +
      suppliers.map(s => `<option value="${escapeHtml(s)}"${s === currentVal ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('');
  }

  initWhModalPoListeners();

  whPoModalState.page = 1;
  renderWhPoModalTable();

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

let whModalPoListenersInitialized = false;
function initWhModalPoListeners() {
  if (whModalPoListenersInitialized) return;
  whModalPoListenersInitialized = true;

  const searchInput = document.getElementById('whModalPoSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      whPoModalState.search = this.value.trim().toLowerCase();
      whPoModalState.page = 1;
      renderWhPoModalTable();
    });
  }

  const supplierFilter = document.getElementById('whModalPoSupplierFilter');
  if (supplierFilter) {
    supplierFilter.addEventListener('change', function() {
      whPoModalState.supplier = this.value;
      whPoModalState.page = 1;
      renderWhPoModalTable();
    });
  }

  const pageSizeSel = document.getElementById('whModalPoPageSize');
  if (pageSizeSel) {
    pageSizeSel.addEventListener('change', function() {
      whPoModalState.pageSize = parseInt(this.value) || 5;
      whPoModalState.page = 1;
      renderWhPoModalTable();
    });
  }
}

function renderWhPoModalTable() {
  const tbody = document.getElementById('whModalPoTableBody');
  const badge = document.getElementById('whModalPoCountBadge');
  const info = document.getElementById('whModalPoPaginationInfo');
  const pag = document.getElementById('whModalPoPagination');
  if (!tbody) return;

  const allDeliveries = (lastDashboardData && lastDashboardData.incoming_deliveries) || [];

  const filtered = allDeliveries.filter(d => {
    if (whPoModalState.supplier && d.supplier_name !== whPoModalState.supplier) {
      return false;
    }
    if (whPoModalState.search) {
      const q = whPoModalState.search;
      const code = (d.po_code || '').toLowerCase();
      const sup = (d.supplier_name || '').toLowerCase();
      if (!code.includes(q) && !sup.includes(q)) {
        return false;
      }
    }
    return true;
  });

  if (badge) badge.textContent = String(filtered.length);

  const total = filtered.length;
  const pageSize = whPoModalState.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  whPoModalState.page = Math.min(Math.max(1, whPoModalState.page), totalPages);
  const startIdx = (whPoModalState.page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageItems = filtered.slice(startIdx, endIdx);

  if (info) {
    info.textContent = total === 0 ? 'Showing 0 to 0 of 0 entries' : `Showing ${startIdx + 1} to ${endIdx} of ${total} entries`;
  }

  if (pag) {
    pag.innerHTML = renderPaginationButtons(whPoModalState.page, totalPages, 'setWhPoPage');
  }

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted fst-italic">No matching incoming deliveries found.</td></tr>';
    return;
  }

  tbody.innerHTML = pageItems.map(d => `
    <tr>
      <td class="font-monospace fw-bold ps-3">${escapeHtml(d.po_code)}</td>
      <td class="fw-semibold">${escapeHtml(d.supplier_name)}</td>
      <td class="font-monospace text-muted small">${d.item_count ? d.item_count + ' items' : (d.total_ordered || 0) + ' units'}</td>
      <td class="font-monospace fw-semibold">${d.outstanding_qty || 0} of ${d.total_ordered || 0}</td>
      <td>${renderWorkflowStatusHtml(d.status)}</td>
      <td class="text-end pe-3 text-nowrap">
        ${can('stock_receiving', 'manage') ? `<button type="button" class="btn btn-sm btn-outline-primary fw-semibold px-2.5 py-1" onclick="handleWhModalReceive(${d.po_id})"><i class="bi bi-box-arrow-in-down me-1"></i>Receive</button>` : '—'}
      </td>
    </tr>
  `).join('');
}

function setWhPoPage(page) {
  whPoModalState.page = page;
  renderWhPoModalTable();
}

function handleWhModalReceive(poId) {
  closeModal('whIncomingDeliveriesModal');
  if (typeof openReceivePoModal === 'function') {
    openReceivePoModal(poId);
  } else {
    navigateTo('stock_receiving');
  }
}

// Modal 3: Recent Delivery Receipts (DR)
function openWhDeliveryReceiptsModal() {
  const modalEl = document.getElementById('whDeliveryReceiptsModal');
  if (!modalEl) return;

  initWhModalDrListeners();

  whDrModalState.page = 1;
  renderWhDrModalTable();

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

let whModalDrListenersInitialized = false;
function initWhModalDrListeners() {
  if (whModalDrListenersInitialized) return;
  whModalDrListenersInitialized = true;

  const searchInput = document.getElementById('whModalDrSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      whDrModalState.search = this.value.trim().toLowerCase();
      whDrModalState.page = 1;
      renderWhDrModalTable();
    });
  }

  const pageSizeSel = document.getElementById('whModalDrPageSize');
  if (pageSizeSel) {
    pageSizeSel.addEventListener('change', function() {
      whDrModalState.pageSize = parseInt(this.value) || 5;
      whDrModalState.page = 1;
      renderWhDrModalTable();
    });
  }
}

function renderWhDrModalTable() {
  const tbody = document.getElementById('whModalDrTableBody');
  const badge = document.getElementById('whModalDrCountBadge');
  const info = document.getElementById('whModalDrPaginationInfo');
  const pag = document.getElementById('whModalDrPagination');
  if (!tbody) return;

  const allReceivings = (lastDashboardData && lastDashboardData.recent_receivings) || [];

  const filtered = allReceivings.filter(r => {
    if (whDrModalState.search) {
      const q = whDrModalState.search;
      const rcvCode = (r.receiving_code || '').toLowerCase();
      const poCode = (r.po_code || '').toLowerCase();
      const drNo = (r.dr_number || '').toLowerCase();
      const sup = (r.supplier_name || '').toLowerCase();
      if (!rcvCode.includes(q) && !poCode.includes(q) && !drNo.includes(q) && !sup.includes(q)) {
        return false;
      }
    }
    return true;
  });

  if (badge) badge.textContent = String(filtered.length);

  const total = filtered.length;
  const pageSize = whDrModalState.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  whDrModalState.page = Math.min(Math.max(1, whDrModalState.page), totalPages);
  const startIdx = (whDrModalState.page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageItems = filtered.slice(startIdx, endIdx);

  if (info) {
    info.textContent = total === 0 ? 'Showing 0 to 0 of 0 entries' : `Showing ${startIdx + 1} to ${endIdx} of ${total} entries`;
  }

  if (pag) {
    pag.innerHTML = renderPaginationButtons(whDrModalState.page, totalPages, 'setWhDrPage');
  }

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted fst-italic">No matching delivery receipts found.</td></tr>';
    return;
  }

  tbody.innerHTML = pageItems.map(r => `
    <tr>
      <td class="font-monospace fw-semibold ps-3">${escapeHtml(r.receiving_code)}</td>
      <td class="font-monospace">${escapeHtml(r.po_code)}</td>
      <td class="font-monospace">${escapeHtml(r.dr_number || '—')}</td>
      <td>${escapeHtml(r.supplier_name)}</td>
      <td class="text-center font-monospace fw-bold text-success">+${r.total_received}</td>
      <td class="small text-muted">${escapeHtml(r.receiving_date)}</td>
      <td class="text-end pe-3">
        <button type="button" class="btn btn-sm btn-outline-secondary px-2.5 py-1" onclick="handleWhModalViewDr(${r.receiving_id})" title="View DR Details">
          <i class="bi bi-eye me-1"></i>View
        </button>
      </td>
    </tr>
  `).join('');
}

function setWhDrPage(page) {
  whDrModalState.page = page;
  renderWhDrModalTable();
}

function handleWhModalViewDr(receivingId) {
  if (typeof viewReceivingDetails === 'function') {
    viewReceivingDetails(receivingId);
  } else if (typeof openReceiptModal === 'function') {
    openReceiptModal('receiving', receivingId);
  }
}

function renderBranchDonutSvg(inStock, lowStock, outOfStock, total) {
  if (!total || total <= 0) {
    return `
      <svg viewBox="0 0 100 100" class="w-100 h-100">
        <circle cx="50" cy="50" r="40" fill="transparent" stroke="#e2e8f0" stroke-width="12" />
        <text x="50" y="53" text-anchor="middle" font-size="9" fill="#94a3b8" font-weight="600">No Data</text>
      </svg>
    `;
  }
  const C = 2 * Math.PI * 40; // ~251.327
  const inLen = (inStock / total) * C;
  const lowLen = (lowStock / total) * C;
  const outLen = (outOfStock / total) * C;

  const inOffset = 0;
  const lowOffset = -inLen;
  const outOffset = -(inLen + lowLen);

  return `
    <svg viewBox="0 0 100 100" class="w-100 h-100" style="transform: rotate(-90deg);">
      <circle cx="50" cy="50" r="40" fill="transparent" stroke="#f1f5f9" stroke-width="12" />
      ${inStock > 0 ? `
        <circle cx="50" cy="50" r="40" fill="transparent" stroke="#10b981" stroke-width="12"
          stroke-dasharray="${inLen} ${C - inLen}" stroke-dashoffset="${inOffset}" />
      ` : ''}
      ${lowStock > 0 ? `
        <circle cx="50" cy="50" r="40" fill="transparent" stroke="#f59e0b" stroke-width="12"
          stroke-dasharray="${lowLen} ${C - lowLen}" stroke-dashoffset="${lowOffset}" />
      ` : ''}
      ${outOfStock > 0 ? `
        <circle cx="50" cy="50" r="40" fill="transparent" stroke="#ef4444" stroke-width="12"
          stroke-dasharray="${outLen} ${C - outLen}" stroke-dashoffset="${outOffset}" />
      ` : ''}
    </svg>
    <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none;">
      <span class="fs-4 fw-bold text-dark lh-1">${total}</span>
      <span class="text-muted fw-semibold text-uppercase" style="font-size:0.65rem; letter-spacing: 0.5px;">Items</span>
    </div>
  `;
}

let requesterModalCurrentPage = 1;
const REQUESTER_MODAL_PAGE_SIZE = 10;
let requesterModalFilteredRequests = [];

window.openRequesterRequestsModal = function(statusFilter, title) {
  const modalEl = document.getElementById('requesterRequestsModal');
  if (!modalEl) {
    if (typeof navigateTo === 'function') {
      navigateTo('purchase_request', { status: statusFilter === 'all' ? '' : statusFilter });
    }
    return;
  }
  const titleEl = document.getElementById('requesterRequestsModalTitle');
  if (titleEl) titleEl.textContent = title || 'My Purchase Requests';

  const filterSelect = document.getElementById('requesterModalStatusFilter');
  if (filterSelect) {
    filterSelect.value = statusFilter || 'all';
  }

  const searchInput = document.getElementById('requesterModalSearchInput');
  if (searchInput) searchInput.value = '';

  requesterModalCurrentPage = 1;
  applyRequesterModalFilter();

  const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
  bsModal.show();
};

window.handleRequesterModalSearch = function() {
  requesterModalCurrentPage = 1;
  applyRequesterModalFilter();
};

window.handleRequesterModalStatusFilter = function() {
  requesterModalCurrentPage = 1;
  applyRequesterModalFilter();
};

function applyRequesterModalFilter() {
  const dData = (typeof lastDashboardData !== 'undefined' && lastDashboardData) ? lastDashboardData : ((typeof dashboardData !== 'undefined' && dashboardData) ? dashboardData : null);
  const all = (dData && (dData.all_my_requests || dData.my_recent_requests)) ? (dData.all_my_requests || dData.my_recent_requests) : [];
  const searchInput = document.getElementById('requesterModalSearchInput');
  const filterSelect = document.getElementById('requesterModalStatusFilter');

  const q = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const st = filterSelect ? filterSelect.value : 'all';

  requesterModalFilteredRequests = all.filter(pr => {
    // Status filter
    if (st && st !== 'all') {
      if (st === 'Pending' && !['Pending', 'Pending Approval'].includes(pr.status)) return false;
      if (st === 'Approved' && !['Approved', 'Partially Ordered', 'Ordered', 'Partially Received', 'Completed'].includes(pr.status)) return false;
      if (st === 'For Revision' && !['For Revision', 'Returned for Revision'].includes(pr.status)) return false;
      if (st === 'Rejected' && pr.status !== 'Rejected') return false;
      if (st === 'Completed' && pr.status !== 'Completed') return false;
      if (st === 'Draft' && pr.status !== 'Draft') return false;
    }

    // Search filter
    if (q) {
      const prCode = (pr.pr_code || ('PR-' + pr.pr_id)).toLowerCase();
      const items = (pr.items_summary || '').toLowerCase();
      const purpose = (pr.purpose || pr.remarks || '').toLowerCase();
      const store = (pr.store_name || '').toLowerCase();
      if (!prCode.includes(q) && !items.includes(q) && !purpose.includes(q) && !store.includes(q)) {
        return false;
      }
    }
    return true;
  });

  renderRequesterModalTable();
}

function renderRequesterModalTable() {
  const tbody = document.getElementById('requesterModalTableBody');
  const infoEl = document.getElementById('requesterModalPaginationInfo');
  const controlsEl = document.getElementById('requesterModalPaginationControls');
  if (!tbody) return;

  const total = requesterModalFilteredRequests.length;
  const totalPages = Math.max(1, Math.ceil(total / REQUESTER_MODAL_PAGE_SIZE));
  if (requesterModalCurrentPage > totalPages) requesterModalCurrentPage = totalPages;
  if (requesterModalCurrentPage < 1) requesterModalCurrentPage = 1;

  const startIdx = (requesterModalCurrentPage - 1) * REQUESTER_MODAL_PAGE_SIZE;
  const pageRows = requesterModalFilteredRequests.slice(startIdx, startIdx + REQUESTER_MODAL_PAGE_SIZE);

  if (infoEl) {
    if (total === 0) {
      infoEl.textContent = 'Showing 0 of 0 requests';
    } else {
      const from = startIdx + 1;
      const to = startIdx + pageRows.length;
      infoEl.textContent = `Showing ${from}–${to} of ${total} request${total === 1 ? '' : 's'}`;
    }
  }

  if (controlsEl) {
    let paginationHtml = '';
    paginationHtml += `
      <button type="button" class="btn btn-sm btn-outline-secondary ${requesterModalCurrentPage <= 1 ? 'disabled' : ''}" onclick="changeRequesterModalPage(${requesterModalCurrentPage - 1})">
        &larr; Prev
      </button>
      <span class="small fw-semibold text-muted px-2">Page ${requesterModalCurrentPage} of ${totalPages}</span>
      <button type="button" class="btn btn-sm btn-outline-secondary ${requesterModalCurrentPage >= totalPages ? 'disabled' : ''}" onclick="changeRequesterModalPage(${requesterModalCurrentPage + 1})">
        Next &rarr;
      </button>
    `;
    controlsEl.innerHTML = paginationHtml;
  }

  if (pageRows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted py-4 fst-italic">
          No matching purchase requests found.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = pageRows.map(pr => {
    const prCode = pr.pr_code || ('PR-' + String(pr.pr_id).padStart(4, '0'));
    const rawItem = (pr.items_summary ? String(pr.items_summary).split(',')[0].trim() : '') || 'Store Items';
    const extraCount = (pr.item_count && parseInt(pr.item_count) > 1) ? ` <span class="badge bg-secondary-subtle text-dark border ms-1">+${parseInt(pr.item_count) - 1}</span>` : '';
    const subDate = (pr.submitted_at || pr.request_date || '').slice(0, 10);
    return `
      <tr>
        <td class="ps-3"><strong class="font-monospace text-dark">${escapeHtml(prCode)}</strong></td>
        <td><span class="badge bg-light text-dark border">${escapeHtml(pr.store_name || 'Main Store')}</span></td>
        <td>
          <div class="fw-semibold text-dark text-truncate" style="max-width: 260px;" title="${escapeHtml(pr.items_summary || rawItem)}">
            ${escapeHtml(rawItem)}${extraCount}
          </div>
          <div class="small text-muted text-truncate" style="max-width: 260px;">
            ${escapeHtml(pr.purpose || pr.remarks || 'Stock Replenishment')}
          </div>
        </td>
        <td class="text-center font-monospace fw-semibold">${pr.total_requested_qty || 0}</td>
        <td class="text-center">${renderWorkflowStatusHtml(pr.status)}</td>
        <td class="text-nowrap small text-muted font-monospace">${escapeHtml(subDate)}</td>
        <td class="text-end pe-3 text-nowrap">
          <button type="button" class="btn btn-sm btn-outline-primary px-2.5 py-1" onclick="bootstrap.Modal.getInstance(document.getElementById('requesterRequestsModal')).hide(); viewPurchaseRequestDetails(${pr.pr_id});">
            <i class="bi bi-eye me-1"></i>View
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

window.changeRequesterModalPage = function(page) {
  requesterModalCurrentPage = page;
  renderRequesterModalTable();
};

function renderRequesterWorkspaceHtml(data) {
  const branchInv = data.branch_inventory || {};
  const branchName = data.assigned_branch || branchInv.store_name || 'Main Store';
  const recentRequests = data.recent_requests || data.my_recent_requests || [];
  const inStock = parseInt(branchInv.in_stock) || 0;
  const lowStock = parseInt(branchInv.low_stock) || 0;
  const outOfStock = parseInt(branchInv.out_of_stock) || 0;
  const totalItems = parseInt(branchInv.total_products) || (inStock + lowStock + outOfStock);
  const alerts = data.branch_stock_alerts || branchInv.alerts || [];

  return `
    <div class="row g-3">
      <!-- Left Column: Recent Purchase Requests (~60%) -->
      <div class="col-12 col-xl-7">
        <div class="card h-100 shadow-sm border-0 rounded-3">
          <div class="card-header bg-transparent d-flex justify-content-between align-items-center py-3 px-3 px-md-4 border-bottom">
            <div>
              <h6 class="mb-0 fw-bold text-dark gw-section-title">Recent Purchase Requests</h6>
              <small class="text-muted">Your latest submitted requests and manager decisions</small>
            </div>
            <button type="button" class="btn btn-sm btn-link text-decoration-none text-primary fw-semibold p-0" onclick="openRequesterRequestsModal('all', 'My Purchase Requests')">
              View All <i class="bi bi-arrow-right ms-1"></i>
            </button>
          </div>
          <div class="card-body p-0">
            <div class="table-responsive" style="max-height: 480px;">
              <table class="table table-hover align-middle mb-0">
                <thead class="table-light text-secondary small">
                  <tr>
                    <th class="ps-3 ps-md-4">Request No.</th>
                    <th>Items</th>
                    <th class="text-center">Total Qty</th>
                    <th class="text-center">Status</th>
                    <th>Submitted</th>
                    <th class="text-end pe-3 pe-md-4">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${recentRequests.length === 0 ? `
                    <tr>
                      <td colspan="6" class="text-center text-muted py-5">
                        <i class="bi bi-inbox fs-2 text-muted d-block mb-2"></i>
                        No purchase requests submitted yet.<br>
                        <button type="button" class="btn btn-primary btn-sm mt-3" onclick="openNewPrModal()">
                          <i class="bi bi-plus-lg me-1"></i>Create Your First Request
                        </button>
                      </td>
                    </tr>
                  ` : recentRequests.map(pr => {
                    const prCode = pr.pr_code || ('PR-' + String(pr.pr_id).padStart(4, '0'));
                    const rawItem = (pr.items_summary ? String(pr.items_summary).split(',')[0].trim() : '') || 'Store Items';
                    const extraCount = (pr.item_count && parseInt(pr.item_count) > 1) ? ` <span class="badge bg-secondary-subtle text-dark border ms-1">+${parseInt(pr.item_count) - 1}</span>` : '';
                    const subDate = (pr.submitted_at || pr.request_date || '').slice(0, 10);
                    return `
                      <tr>
                        <td class="ps-3 ps-md-4">
                          <span class="fw-bold font-monospace text-dark">${escapeHtml(prCode)}</span>
                        </td>
                        <td>
                          <div class="fw-semibold text-dark text-truncate" style="max-width: 180px;" title="${escapeHtml(pr.items_summary || rawItem)}">
                            ${escapeHtml(rawItem)}${extraCount}
                          </div>
                          <div class="small text-muted text-truncate" style="max-width: 180px;">
                            ${escapeHtml(pr.purpose || pr.remarks || 'Stock Replenishment')}
                          </div>
                        </td>
                        <td class="text-center font-monospace fw-semibold">${pr.total_requested_qty || 0}</td>
                        <td class="text-center">${renderWorkflowStatusHtml(pr.status)}</td>
                        <td class="text-nowrap small text-muted font-monospace">${escapeHtml(subDate)}</td>
                        <td class="text-end pe-3 pe-md-4 text-nowrap">
                          <button type="button" class="btn btn-sm btn-outline-primary px-2.5 py-1" onclick="viewPurchaseRequestDetails(${pr.pr_id})">
                            <i class="bi bi-eye me-1"></i>View
                          </button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column: Branch Inventory Overview & Low Stock Alerts (~40%) -->
      <div class="col-12 col-xl-5">
        <div class="card h-100 shadow-sm border-0 rounded-3">
          <div class="card-header bg-transparent d-flex justify-content-between align-items-center py-3 px-3 px-md-4 border-bottom">
            <div class="d-flex align-items-center gap-2">
              <h6 class="mb-0 fw-bold text-dark gw-section-title">Branch Inventory Overview</h6>
              <span class="badge bg-primary-subtle text-primary border border-primary-subtle fw-semibold px-2 py-0.5" style="font-size:0.75rem;">
                <i class="bi bi-geo-alt-fill me-1"></i>${escapeHtml(branchName)}
              </span>
            </div>
            <button type="button" class="btn btn-sm btn-link text-decoration-none text-primary fw-semibold p-0" onclick="navigateTo('product')">
              View Inventory &rarr;
            </button>
          </div>
          <div class="card-body p-3 p-md-4">
            <!-- Donut Chart & Legend -->
            <div class="d-flex flex-column flex-sm-row align-items-center justify-content-around gap-3 mb-4">
              <div class="gw-donut-container" style="width: 130px; height: 130px; position: relative;">
                ${renderBranchDonutSvg(inStock, lowStock, outOfStock, totalItems)}
              </div>
              <div class="d-flex flex-column gap-2">
                <div class="d-flex align-items-center gap-2">
                  <span class="rounded-circle" style="width:10px;height:10px;background:#10b981;"></span>
                  <span class="small fw-semibold text-secondary">In Stock:</span>
                  <span class="small fw-bold text-dark">${inStock} (${totalItems > 0 ? Math.round((inStock/totalItems)*100) : 0}%)</span>
                </div>
                <div class="d-flex align-items-center gap-2">
                  <span class="rounded-circle" style="width:10px;height:10px;background:#f59e0b;"></span>
                  <span class="small fw-semibold text-secondary">Low Stock:</span>
                  <span class="small fw-bold text-dark">${lowStock} (${totalItems > 0 ? Math.round((lowStock/totalItems)*100) : 0}%)</span>
                </div>
                <div class="d-flex align-items-center gap-2">
                  <span class="rounded-circle" style="width:10px;height:10px;background:#ef4444;"></span>
                  <span class="small fw-semibold text-secondary">Out of Stock:</span>
                  <span class="small fw-bold text-dark">${outOfStock} (${totalItems > 0 ? Math.round((outOfStock/totalItems)*100) : 0}%)</span>
                </div>
              </div>
            </div>

            <hr class="my-3 opacity-25">

            <!-- Low Stock Alerts -->
            <div>
              <div class="d-flex justify-content-between align-items-center mb-2.5">
                <h6 class="small fw-bold text-uppercase text-secondary mb-0">Low Stock Alerts</h6>
                <span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-0.5" style="font-size:0.75rem;">
                  ${alerts.length} item(s) need attention
                </span>
              </div>
              <div class="overflow-y-auto" style="max-height: 220px;">
                ${alerts.length === 0 ? `
                  <div class="text-center text-muted small py-4 fst-italic">
                    <i class="bi bi-check2-circle text-success fs-4 d-block mb-1"></i>
                    All branch products are currently well stocked!
                  </div>
                ` : `
                  <div class="list-group list-group-flush">
                    ${alerts.map(item => `
                      <div class="list-group-item d-flex justify-content-between align-items-center py-2 px-2 border-0 border-bottom bg-transparent" role="button" onclick="openNewPrModal(${item.product_id})" title="Click to request replenishment">
                        <div class="overflow-hidden me-2">
                          <div class="fw-semibold text-dark text-truncate small" style="max-width: 200px;">
                            ${escapeHtml(item.product_name)}
                          </div>
                          <div class="text-muted font-monospace" style="font-size:0.75rem;">
                            Available: <strong class="${item.available_quantity <= 0 ? 'text-danger' : 'text-warning'}">${item.available_quantity}</strong> ${escapeHtml(item.unit_measure || 'units')}
                          </div>
                        </div>
                        <span class="badge ${item.badge_class} border" style="font-size:0.7rem;">
                          ${escapeHtml(item.status)}
                        </span>
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderRequesterProgressStepperHtml(status) {
  const s = String(status || 'Pending Approval');
  let step1 = 'done';
  let step2 = '';
  let step2Label = '[Approved]';
  let step3 = '';
  let step4 = '';

  if (s === 'For Revision') {
    step2 = 'current-amber';
    step2Label = '[Revision]';
  } else if (s === 'Rejected') {
    step2 = 'current-red';
    step2Label = '[Rejected]';
  } else if (s === 'Approved') {
    step2 = 'done';
  } else if (s === 'Partially Ordered' || s === 'Ordered' || s === 'Processing' || s === 'Purchasing') {
    step2 = 'done';
    step3 = 'done';
  } else if (s === 'Partially Received' || s === 'Awaiting Delivery') {
    step2 = 'done';
    step3 = 'done';
    step4 = 'current-violet';
  } else if (s === 'Completed' || s === 'Received') {
    step2 = 'done';
    step3 = 'done';
    step4 = 'done';
  }

  const iconFor = st => (st === 'done') ? '<i class="bi bi-check"></i>' : '';

  return `
    <div class="gw-req-stepper">
      <div class="gw-req-step ${step1}">
        <span class="gw-req-dot">${iconFor(step1)}</span>
        <span class="gw-req-label">[Submitted]</span>
      </div>
      <div class="gw-req-step ${step2}">
        <span class="gw-req-dot">${iconFor(step2)}</span>
        <span class="gw-req-label">${step2Label}</span>
      </div>
      <div class="gw-req-step ${step3}">
        <span class="gw-req-dot">${iconFor(step3)}</span>
        <span class="gw-req-label">[Ordered]</span>
      </div>
      <div class="gw-req-step ${step4}">
        <span class="gw-req-dot">${iconFor(step4)}</span>
        <span class="gw-req-label">[Received]</span>
      </div>
    </div>
  `;
}

function renderStockBarRowHtml(item) {
  const avail = parseInt(item.available_stock) || 0;
  const reorder = parseInt(item.reorder_threshold || item.reorder_level) || 10;
  const maxS = Math.max(1, parseInt(item.max_stock) || 100);
  const suggested = Math.max(0, maxS - avail);
  const pct = Math.min(100, Math.max(5, Math.round((avail / maxS) * 100)));
  const isOutOfStock = avail <= 0;
  const fillClass = isOutOfStock ? 'fill-critical' : 'fill-low';
  const badgeHtml = isOutOfStock
    ? '<span class="badge wf-badge wf-critical">Out of Stock</span>'
    : '<span class="badge wf-badge wf-low">Low Stock</span>';

  return `
    <div class="py-2 border-bottom">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <span class="fw-semibold small text-dark">${escapeHtml(item.product_name)}</span>
        <div class="d-flex align-items-center gap-2">
          <span class="font-monospace small fw-bold">${avail} / ${maxS}</span>
          ${badgeHtml}
        </div>
      </div>
      <div class="stock-bar-track mb-1">
        <div class="stock-bar-fill ${fillClass}" style="width:${pct}%"></div>
      </div>
      <div class="d-flex justify-content-between text-muted" style="font-size: 0.72rem;">
        <span>Reorder Level: <strong class="text-dark font-monospace">${reorder}</strong></span>
        <span>Suggested Order: <strong class="text-dark font-monospace">${suggested}</strong></span>
      </div>
    </div>
  `;
}

function renderDashboardNotificationsCardHtml(notifs) {
  return `
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <h6 class="mb-0 gw-section-title">Recent Notifications</h6>
        <button class="btn btn-sm btn-link text-decoration-none text-violet fw-semibold p-0" onclick="navigateTo('notifications')">View all</button>
      </div>
      <div class="list-group list-group-flush">
        ${(!notifs || notifs.length === 0) ? '<div class="p-3 text-center text-muted small fst-italic">No notifications yet.</div>' : notifs.map(n => {
          const t = String(n.type || 'info');
          let iconTone = 'tone-violet';
          let iconName = 'bi-bell';
          if (t === 'success') { iconTone = 'tone-green'; iconName = 'bi-check2-circle'; }
          else if (t === 'warning') { iconTone = 'tone-amber'; iconName = 'bi-truck'; }
          else if (t === 'danger') { iconTone = 'tone-red'; iconName = 'bi-exclamation-triangle'; }
          return `
            <div class="list-group-item notif-item ${parseInt(n.is_read) === 0 ? 'unread' : ''} py-2 px-3" role="button" onclick="handleNotificationClick(${n.notification_id}, '${escapeHtml(n.entity_type || '')}', ${parseInt(n.entity_id) || 0})">
              <div class="d-flex align-items-start gap-3">
                <div class="kpi-icon-box ${iconTone} mt-1" style="width:34px;height:34px;border-radius:50%;font-size:0.95rem;">
                  <i class="bi ${iconName}"></i>
                </div>
                <div class="flex-grow-1" style="min-width:0;">
                  <div class="fw-semibold small text-dark text-truncate">${escapeHtml(n.title)}</div>
                  <div class="small text-muted text-truncate">${escapeHtml(n.message)}</div>
                  <div class="text-muted mt-1" style="font-size:0.7rem;">${escapeHtml((n.created_at || '').slice(0, 16))}</div>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function handleDashboardTxClick(txType, refId) {
  if (txType === 'Purchase Request') {
    navigateTo('purchase_request');
    if (refId) viewPurchaseRequestDetails(refId);
  } else if (txType === 'Purchase Order') {
    navigateTo('purchase_order');
    if (refId) viewPurchaseOrderDetails(refId);
  } else if (txType === 'Stock Receiving') {
    navigateTo('stock_receiving');
    if (refId && typeof viewReceivingDetails === 'function') viewReceivingDetails(refId);
  } else if (txType === 'Stock Releasing') {
    navigateTo('stock_releasing');
  }
}

function openRecentTransactionsModal() {
  const modalEl = document.getElementById('recentTransactionsModal');
  if (!modalEl) return;
  const body = document.getElementById('recentTransactionsModalBody');
  if (!body) return;

  const txs = (lastDashboardData && (lastDashboardData.all_recent_transactions || lastDashboardData.recent_transactions)) || [];

  if (txs.length === 0) {
    body.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4 fst-italic">No recent transactions recorded.</td></tr>';
  } else {
    body.innerHTML = txs.map(tx => `
      <tr role="button" class="gw-tx-modal-row" onclick="closeModal('recentTransactionsModal'); handleDashboardTxClick('${escapeHtml(tx.tx_type)}', ${parseInt(tx.ref_id) || 0})">
        <td class="font-monospace fw-bold text-dark ps-3 ps-md-4">${escapeHtml(tx.ref_code || tx.ref_no || '-')}</td>
        <td>
          <div class="fw-semibold text-dark">${escapeHtml(tx.tx_type)}</div>
          <div class="small text-muted d-sm-none">${escapeHtml(tx.actor || '—')} &bull; ${escapeHtml(tx.tx_date || '')}</div>
        </td>
        <td class="small d-none d-sm-table-cell">${escapeHtml(tx.actor || '—')}</td>
        <td>${renderWorkflowStatusHtml(tx.status)}</td>
        <td class="small text-muted d-none d-md-table-cell pe-3 pe-md-4">${escapeHtml(tx.tx_date || '')}</td>
      </tr>
    `).join('');
  }

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

function openStockAlertsModal() {
  const modalEl = document.getElementById('stockAlertsModal');
  if (!modalEl) return;
  const list = document.getElementById('stockAlertsModalList');
  if (!list) return;

  const alerts = (lastDashboardData && (lastDashboardData.all_stock_alerts || lastDashboardData.stock_alerts || lastDashboardData.low_stock_products)) || [];

  if (alerts.length === 0) {
    list.innerHTML = '<div class="text-center text-muted py-4 fst-italic">All active products are currently above their reorder thresholds.</div>';
  } else {
    list.innerHTML = alerts.map(item => {
      const isCritical = Boolean(item.is_critical_stock || parseInt(item.available_stock) <= 3);
      const badgeClass = isCritical ? 'wf-badge wf-critical' : 'wf-badge wf-low';
      const badgeText = isCritical ? 'Critical' : 'Low Stock';
      const avail = parseInt(item.available_stock) || 0;
      const reorder = parseInt(item.reorder_threshold !== undefined ? item.reorder_threshold : (item.reorder_level || 0)) || 0;

      return `
        <div class="list-group-item d-flex justify-content-between align-items-center py-2 px-3 border-bottom" role="button" onclick="closeModal('stockAlertsModal'); navigateTo('product', { search: '${escapeHtml(item.product_name)}' })">
          <div class="me-3 text-truncate">
            <div class="fw-bold text-dark text-truncate">${escapeHtml(item.product_name)}</div>
            ${item.category_name ? `<div class="small text-muted">${escapeHtml(item.category_name)}</div>` : ''}
          </div>
          <div class="d-flex align-items-center gap-3 flex-shrink-0">
            <span class="font-monospace fw-bold text-dark">${avail} / ${reorder}</span>
            <span class="${badgeClass}">${badgeText}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

function openRecentNotificationsModal() {
  const modalEl = document.getElementById('recentNotificationsModal');
  if (!modalEl) return;
  const listEl = document.getElementById('recentNotificationsModalList');
  const badgeEl = document.getElementById('recentNotificationsModalBadge');

  const notifs = (lastDashboardData && lastDashboardData.notifications) || [];
  const unreadCount = notifs.filter(n => parseInt(n.is_read) === 0).length;

  if (badgeEl) {
    if (unreadCount > 0) {
      badgeEl.textContent = unreadCount + ' unread';
      badgeEl.hidden = false;
    } else {
      badgeEl.hidden = true;
    }
  }

  if (listEl) {
    if (notifs.length === 0) {
      listEl.innerHTML = '<div class="p-4 text-center text-muted small fst-italic">No notifications yet. You are all caught up!</div>';
    } else {
      listEl.innerHTML = notifs.map(n => {
        const t = String(n.type || 'info');
        let iconTone = 'tone-violet';
        let iconName = 'bi-bell';
        if (t === 'success') { iconTone = 'tone-green'; iconName = 'bi-check2-circle'; }
        else if (t === 'warning') { iconTone = 'tone-amber'; iconName = 'bi-truck'; }
        else if (t === 'danger') { iconTone = 'tone-red'; iconName = 'bi-exclamation-triangle'; }

        return `
          <div class="list-group-item list-group-item-action ${parseInt(n.is_read) === 0 ? 'bg-light-subtle' : ''} py-2.5 px-3 border-bottom" role="button" onclick="closeModal('recentNotificationsModal'); handleNotificationClick(${n.notification_id}, '${escapeHtml(n.entity_type || '')}', ${parseInt(n.entity_id) || 0})">
            <div class="d-flex align-items-start gap-3">
              <div class="kpi-icon-box ${iconTone} mt-1 flex-shrink-0" style="width:34px;height:34px;border-radius:50%;font-size:0.95rem;display:flex;align-items:center;justify-content:center;">
                <i class="bi ${iconName}"></i>
              </div>
              <div class="flex-grow-1" style="min-width:0;">
                <div class="d-flex justify-content-between align-items-center gap-2">
                  <div class="fw-semibold small text-dark text-truncate">${escapeHtml(n.title)}</div>
                  ${parseInt(n.is_read) === 0 ? '<span class="badge rounded-circle bg-danger p-1" style="width:7px;height:7px;"></span>' : ''}
                </div>
                <div class="small text-muted text-truncate mt-0.5">${escapeHtml(n.message)}</div>
                <div class="text-muted mt-1" style="font-size:0.7rem;"><i class="bi bi-clock me-1"></i>${escapeHtml((n.created_at || '').slice(0, 16))}</div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

function openQuickActionsModal() {
  const modalEl = document.getElementById('quickActionsModal');
  if (!modalEl) return;
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

function toggleQuickActionsMenu() {
  // Retained as harmless no-op stub for backward compatibility
}

/* ==========================================================================
   Manager Dashboard — Polish, Charting, Modals & Portal Filters
   ========================================================================== */

function formatDisplayDate(val) {
  if (!val) return '—';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val).slice(0, 10);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) {
    return String(val).slice(0, 10);
  }
}

function handleManagerReviewPo(poId) {
  if (typeof openPoDetailModal === 'function') {
    openPoDetailModal(poId);
  } else {
    navigateTo('purchase_order');
  }
}

// Calculate clean, human-readable numerical tick marks for the Y-axis
function calculateNiceChartTicks(maxValue, targetIntervals = 4) {
  const actualMax = Math.max(10, Number(maxValue) || 10);
  const roughStep = actualMax / targetIntervals;
  const power = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const fraction = roughStep / power;

  let niceFraction;
  if (fraction <= 1.25) niceFraction = 1;
  else if (fraction <= 2.5) niceFraction = 2;
  else if (fraction <= 3.75) niceFraction = 2.5;
  else if (fraction <= 7.0) niceFraction = 5;
  else niceFraction = 10;

  const step = niceFraction * power;
  let niceMax = Math.ceil(actualMax / step) * step;
  if (niceMax === 0) niceMax = step * targetIntervals;

  const ticks = [];
  for (let val = niceMax; val >= 0; val -= step) {
    ticks.push(Math.round(val));
  }
  return {
    niceMax,
    step,
    ticks
  };
}

function formatChartProductLabel(name) {
  if (!name) return '—';
  const clean = String(name).trim();
  if (clean.length > 13) {
    return clean.substring(0, 11) + '...';
  }
  return clean;
}

// Grouped Bar Chart Renderer (Requested vs Available Stock)
function renderManagerStockChartHtml(items) {
  if (!items || items.length === 0) {
    return `<div class="text-center text-muted py-5 fst-italic">No product comparison data available.</div>`;
  }
  const slice = items.slice(0, 5);

  let rawMax = 0;
  slice.forEach(it => {
    rawMax = Math.max(rawMax, parseInt(it.requested_qty) || 0, parseInt(it.available_stock) || 0, parseInt(it.max_stock) || 100);
  });

  const { niceMax, ticks } = calculateNiceChartTicks(rawMax, 4);
  const plotHeight = 160;

  return `
    <div class="gw-mgr-chart-container" onclick="openMgrStockComparisonModal()" role="button" title="Click to view full requested vs available stock breakdown">
      <!-- Plot Area: Y-Axis + Bars & Gridlines -->
      <div class="gw-mgr-chart-plot-wrap">
        <div class="gw-mgr-chart-y-axis">
          ${ticks.map(tick => `<div class="gw-mgr-chart-y-tick">${tick}</div>`).join('')}
        </div>
        <div class="gw-mgr-chart-bars-wrap">
          <div class="gw-mgr-chart-gridlines">
            ${ticks.map(() => `<div class="gw-mgr-chart-gridline"></div>`).join('')}
          </div>
          <div class="gw-mgr-chart-bars-row">
            ${slice.map(it => {
              const req = parseInt(it.requested_qty) || 0;
              const avail = parseInt(it.available_stock) || 0;
              const maxS = parseInt(it.max_stock) || 100;

              const hReq = Math.min(plotHeight, Math.max(req > 0 ? 3 : 0, Math.round((req / niceMax) * plotHeight)));
              const hAvail = Math.min(plotHeight, Math.max(avail > 0 ? 3 : 0, Math.round((avail / niceMax) * plotHeight)));
              const hMax = Math.min(plotHeight, Math.max(maxS > 0 ? 3 : 0, Math.round((maxS / niceMax) * plotHeight)));

              const tooltipTitle = `${it.product_name}\n• Requested Qty: ${req}\n• Available Stock: ${avail}\n• Max Stock: ${maxS}\n• Status: ${it.stock_status || it.status || 'Sufficient'}`;
              return `
                <div class="gw-mgr-chart-col" title="${escapeHtml(tooltipTitle)}">
                  <div class="gw-mgr-chart-bars">
                    <div class="gw-mgr-bar gw-mgr-bar-requested" style="height: ${hReq}px;" title="Requested: ${req}"></div>
                    <div class="gw-mgr-bar gw-mgr-bar-available" style="height: ${hAvail}px;" title="Available: ${avail}"></div>
                    <div class="gw-mgr-bar gw-mgr-bar-max" style="height: ${hMax}px;" title="Max Stock: ${maxS}"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- X-Axis Labels Row -->
      <div class="gw-mgr-chart-x-row">
        <div class="gw-mgr-chart-x-spacer"></div>
        <div class="gw-mgr-chart-x-labels">
          ${slice.map(it => `
            <div class="gw-mgr-chart-x-label" title="${escapeHtml(it.product_name)}">
              ${escapeHtml(formatChartProductLabel(it.product_name))}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Legend -->
      <div class="gw-mgr-chart-legend">
        <div class="gw-mgr-legend-item">
          <span class="gw-mgr-legend-dot" style="background-color: #3b82f6;"></span>
          <span>Requested Qty</span>
        </div>
        <div class="gw-mgr-legend-item">
          <span class="gw-mgr-legend-dot" style="background-color: #10b981;"></span>
          <span>Available Stock</span>
        </div>
        <div class="gw-mgr-legend-item">
          <span class="gw-mgr-legend-dot" style="background-color: #94a3b8;"></span>
          <span>Max Stock</span>
        </div>
      </div>
    </div>
  `;
}

async function handleMgrChartFilterChange(val) {
  const container = document.getElementById('mgrStockChartCardBody');
  if (!container) return;
  try {
    const res = await axios.get(API + 'dashboard.php?mode=manager_stock_comparison&filter=' + encodeURIComponent(val));
    if (res.data && res.data.success) {
      container.innerHTML = renderManagerStockChartHtml(res.data.data || []);
    }
  } catch (err) {
    console.warn('Failed to filter stock chart', err);
  }
}

// -----------------------------------------------------------------------------
// Manager Modal 1: Purchase Requests List Modal
// -----------------------------------------------------------------------------
let mgrPrModalState = {
  status: 'Pending',
  title: 'Purchase Requests Approval Queue',
  page: 1,
  pageSize: 10,
  search: '',
  dateOption: 'all',
  startDate: '',
  endDate: '',
  data: []
};

let mgrPrListenersInitialized = false;

async function openMgrPrListModal(status, title) {
  const modalEl = document.getElementById('mgrPrListModal');
  if (!modalEl) return;

  mgrPrModalState.status = status || 'Pending';
  mgrPrModalState.title = title || (status === 'Approved' ? 'Approved Requests' : 'Purchase Requests');
  mgrPrModalState.page = 1;
  mgrPrModalState.search = '';

  const titleEl = document.getElementById('mgrPrModalTitle');
  if (titleEl) titleEl.textContent = mgrPrModalState.title;

  const iconEl = document.getElementById('mgrPrModalIcon');
  if (iconEl) {
    if (status === 'Approved') iconEl.className = 'bi bi-file-earmark-check text-success fs-5';
    else if (status === 'Rejected') iconEl.className = 'bi bi-x-circle text-danger fs-5';
    else if (status === 'For Revision') iconEl.className = 'bi bi-arrow-return-left text-warning fs-5';
    else iconEl.className = 'bi bi-file-earmark-text text-primary fs-5';
  }

  const searchInput = document.getElementById('mgrPrModalSearch');
  if (searchInput) searchInput.value = '';

  initMgrPrModalListeners();
  await loadMgrPrModalData();

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function initMgrPrModalListeners() {
  if (mgrPrListenersInitialized) return;
  mgrPrListenersInitialized = true;

  const searchInput = document.getElementById('mgrPrModalSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      mgrPrModalState.search = this.value.trim().toLowerCase();
      mgrPrModalState.page = 1;
      renderMgrPrModalTable();
    });
  }

  const pageSizeSel = document.getElementById('mgrPrModalPageSize');
  if (pageSizeSel) {
    pageSizeSel.addEventListener('change', function () {
      mgrPrModalState.pageSize = parseInt(this.value) || 10;
      mgrPrModalState.page = 1;
      renderMgrPrModalTable();
    });
  }
}

async function loadMgrPrModalData() {
  const tbody = document.getElementById('mgrPrModalTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted fst-italic">Loading requests...</td></tr>';
  }

  try {
    let url = API + 'dashboard.php?mode=manager_pr_list&status=' + encodeURIComponent(mgrPrModalState.status);
    if (mgrPrModalState.startDate) url += '&start_date=' + encodeURIComponent(mgrPrModalState.startDate);
    if (mgrPrModalState.endDate) url += '&end_date=' + encodeURIComponent(mgrPrModalState.endDate);

    const res = await axios.get(url);
    if (res.data && res.data.success) {
      mgrPrModalState.data = res.data.data || [];
    } else {
      mgrPrModalState.data = [];
    }
  } catch (err) {
    console.warn('Failed to load manager PR modal data', err);
    mgrPrModalState.data = [];
  }

  renderMgrPrModalTable();
}

function renderMgrPrModalTable() {
  const tbody = document.getElementById('mgrPrModalTableBody');
  const countBadge = document.getElementById('mgrPrModalCountBadge');
  const info = document.getElementById('mgrPrModalPaginationInfo');
  const pag = document.getElementById('mgrPrModalPagination');
  if (!tbody) return;

  let filtered = mgrPrModalState.data || [];
  if (mgrPrModalState.search) {
    const q = mgrPrModalState.search;
    filtered = filtered.filter(r => {
      const code = (r.pr_code || '').toLowerCase();
      const req = (r.requested_by || '').toLowerCase();
      const purpose = (r.purpose || '').toLowerCase();
      return code.includes(q) || req.includes(q) || purpose.includes(q);
    });
  }

  if (countBadge) countBadge.textContent = String(filtered.length);

  const total = filtered.length;
  const pageSize = mgrPrModalState.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  mgrPrModalState.page = Math.min(Math.max(1, mgrPrModalState.page), totalPages);
  const startIdx = (mgrPrModalState.page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageItems = filtered.slice(startIdx, endIdx);

  if (info) {
    info.textContent = total === 0 ? 'Showing 0 to 0 of 0 records' : `Showing ${startIdx + 1} to ${endIdx} of ${total} records`;
  }

  if (pag) {
    pag.innerHTML = renderPaginationButtons(mgrPrModalState.page, totalPages, 'setMgrPrPage');
  }

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted fst-italic">No matching purchase requests found.</td></tr>';
    return;
  }

  tbody.innerHTML = pageItems.map(pr => {
    const st = pr.status || 'Pending';
    let badgeClass = 'bg-warning text-dark';
    if (['Approved', 'Ordered', 'Partially Received', 'Completed'].includes(st)) {
      badgeClass = 'bg-success text-white';
    } else if (st === 'Rejected') {
      badgeClass = 'bg-danger text-white';
    } else if (st === 'For Revision') {
      badgeClass = 'bg-warning text-dark';
    }

    const isPending = st === 'Pending';
    const actionBtn = isPending
      ? `<button type="button" class="btn btn-sm btn-primary px-3 fw-semibold" onclick="closeModal('mgrPrListModal'); openApprovePrModal(${pr.pr_id});">Review</button>`
      : `<button type="button" class="btn btn-sm btn-outline-primary px-3 fw-semibold" onclick="closeModal('mgrPrListModal'); viewPurchaseRequestDetails(${pr.pr_id});">View</button>`;

    return `
      <tr>
        <td class="font-monospace fw-bold ps-3">${escapeHtml(pr.pr_code)}</td>
        <td class="fw-semibold text-dark">${escapeHtml(pr.requested_by || '—')}</td>
        <td class="text-center font-monospace">${pr.item_count || 1}</td>
        <td class="text-center font-monospace">${pr.total_requested_qty || 0}</td>
        <td class="small text-muted">${formatDisplayDate(pr.submitted_at || pr.request_date)}</td>
        <td><span class="badge ${badgeClass} font-monospace">${escapeHtml(st)}</span></td>
        <td class="text-end pe-3 text-nowrap">${actionBtn}</td>
      </tr>
    `;
  }).join('');
}

function setMgrPrPage(p) {
  mgrPrModalState.page = p;
  renderMgrPrModalTable();
}

function resetMgrPrModalFilters() {
  mgrPrModalState.search = '';
  mgrPrModalState.dateOption = 'all';
  mgrPrModalState.startDate = '';
  mgrPrModalState.endDate = '';
  mgrPrModalState.page = 1;

  const searchInput = document.getElementById('mgrPrModalSearch');
  if (searchInput) searchInput.value = '';

  const btnText = document.getElementById('mgrPrDateRangeBtnText');
  if (btnText) btnText.textContent = 'All Time';

  const sDate = document.getElementById('mgrPrStartDate');
  const eDate = document.getElementById('mgrPrEndDate');
  if (sDate) sDate.value = '';
  if (eDate) eDate.value = '';

  loadMgrPrModalData();
}

// Manager PR Date Portal
function toggleMgrPrDateRangeDropdown(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const menu = document.getElementById('mgrPrDateRangeMenu');
  if (!menu) return;
  if (menu.classList.contains('show')) {
    closeMgrPrDateRangeDropdown();
  } else {
    openMgrPrDateRangeDropdown();
  }
}

function openMgrPrDateRangeDropdown() {
  const menu = document.getElementById('mgrPrDateRangeMenu');
  const btn = document.getElementById('mgrPrDateRangeBtn');
  if (!menu || !btn) return;

  if (menu.parentNode !== document.body) {
    document.body.appendChild(menu);
  }

  menu.classList.add('show');
  menu.style.display = 'block';
  positionMgrPrDateRangeDropdown();

  window.addEventListener('scroll', positionMgrPrDateRangeDropdown, true);
  window.addEventListener('resize', positionMgrPrDateRangeDropdown);
  document.addEventListener('click', onMgrPrOutsideClick);
  document.addEventListener('keydown', onMgrPrKeydown);
}

function closeMgrPrDateRangeDropdown() {
  const menu = document.getElementById('mgrPrDateRangeMenu');
  if (!menu) return;
  menu.classList.remove('show');
  menu.style.display = 'none';

  window.removeEventListener('scroll', positionMgrPrDateRangeDropdown, true);
  window.removeEventListener('resize', positionMgrPrDateRangeDropdown);
  document.removeEventListener('click', onMgrPrOutsideClick);
  document.removeEventListener('keydown', onMgrPrKeydown);
}

function positionMgrPrDateRangeDropdown() {
  const menu = document.getElementById('mgrPrDateRangeMenu');
  const btn = document.getElementById('mgrPrDateRangeBtn');
  if (!menu || !btn || !menu.classList.contains('show')) return;

  const rect = btn.getBoundingClientRect();
  const menuW = 340;
  const menuH = menu.offsetHeight || 330;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const gap = 6;

  let top = rect.bottom + gap;
  if (vh - rect.bottom < menuH + gap + 10 && rect.top > menuH + gap) {
    top = Math.max(10, rect.top - menuH - gap);
  }

  let left = rect.right - menuW;
  if (left < 10) left = 10;
  if (left + menuW > vw - 10) left = vw - menuW - 10;

  if (vw < 576) {
    left = Math.max(10, (vw - menuW) / 2);
    top = Math.max(20, (vh - menuH) / 2);
  }

  menu.style.position = 'fixed';
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
  menu.style.zIndex = '2050';
}

function onMgrPrOutsideClick(e) {
  const menu = document.getElementById('mgrPrDateRangeMenu');
  const btn = document.getElementById('mgrPrDateRangeBtn');
  if (!menu || !menu.classList.contains('show')) return;
  if (!menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
    closeMgrPrDateRangeDropdown();
  }
}

function onMgrPrKeydown(e) {
  if (e.key === 'Escape') closeMgrPrDateRangeDropdown();
}

function selectMgrPrDateOption(opt, label) {
  mgrPrModalState.dateOption = opt;
  const btnText = document.getElementById('mgrPrDateRangeBtnText');
  if (btnText) btnText.textContent = label;

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  if (opt === 'all') {
    mgrPrModalState.startDate = '';
    mgrPrModalState.endDate = '';
  } else if (opt === 'today') {
    mgrPrModalState.startDate = todayStr;
    mgrPrModalState.endDate = todayStr;
  } else if (opt === '7days') {
    const past = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    mgrPrModalState.startDate = past.toISOString().slice(0, 10);
    mgrPrModalState.endDate = todayStr;
  } else if (opt === '30days') {
    const past = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    mgrPrModalState.startDate = past.toISOString().slice(0, 10);
    mgrPrModalState.endDate = todayStr;
  } else if (opt === 'month') {
    mgrPrModalState.startDate = `${yyyy}-${mm}-01`;
    mgrPrModalState.endDate = todayStr;
  }

  closeMgrPrDateRangeDropdown();
  mgrPrModalState.page = 1;
  loadMgrPrModalData();
}

function applyMgrPrCustomDateRange() {
  const s = document.getElementById('mgrPrStartDate');
  const e = document.getElementById('mgrPrEndDate');
  if (!s || !e) return;
  const startVal = s.value;
  const endVal = e.value;

  if (!startVal && !endVal) {
    selectMgrPrDateOption('all', 'All Time');
    return;
  }
  if (startVal && endVal && startVal > endVal) {
    if (typeof showToast === 'function') showToast('Start date cannot be after end date.', true);
    return;
  }

  mgrPrModalState.startDate = startVal || '';
  mgrPrModalState.endDate = endVal || '';
  mgrPrModalState.dateOption = 'custom';

  const btnText = document.getElementById('mgrPrDateRangeBtnText');
  if (btnText) {
    btnText.textContent = `${startVal || '...'} to ${endVal || '...'}`;
  }

  closeMgrPrDateRangeDropdown();
  mgrPrModalState.page = 1;
  loadMgrPrModalData();
}

// -----------------------------------------------------------------------------
// Manager Modal 2: POs Awaiting Approval Modal
// -----------------------------------------------------------------------------
let mgrPoModalState = {
  status: 'Pending Approval',
  page: 1,
  pageSize: 10,
  search: '',
  dateOption: 'all',
  startDate: '',
  endDate: '',
  data: []
};

let mgrPoListenersInitialized = false;

async function openMgrPoApprovalModal() {
  const modalEl = document.getElementById('mgrPoApprovalModal');
  if (!modalEl) return;

  mgrPoModalState.page = 1;
  mgrPoModalState.search = '';

  const searchInput = document.getElementById('mgrPoModalSearch');
  if (searchInput) searchInput.value = '';

  initMgrPoModalListeners();
  await loadMgrPoModalData();

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function initMgrPoModalListeners() {
  if (mgrPoListenersInitialized) return;
  mgrPoListenersInitialized = true;

  const searchInput = document.getElementById('mgrPoModalSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      mgrPoModalState.search = this.value.trim().toLowerCase();
      mgrPoModalState.page = 1;
      renderMgrPoModalTable();
    });
  }

  const pageSizeSel = document.getElementById('mgrPoModalPageSize');
  if (pageSizeSel) {
    pageSizeSel.addEventListener('change', function () {
      mgrPoModalState.pageSize = parseInt(this.value) || 10;
      mgrPoModalState.page = 1;
      renderMgrPoModalTable();
    });
  }
}

async function loadMgrPoModalData() {
  const tbody = document.getElementById('mgrPoModalTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted fst-italic">Loading purchase orders...</td></tr>';
  }

  try {
    let url = API + 'dashboard.php?mode=manager_po_list&status=' + encodeURIComponent(mgrPoModalState.status);
    if (mgrPoModalState.startDate) url += '&start_date=' + encodeURIComponent(mgrPoModalState.startDate);
    if (mgrPoModalState.endDate) url += '&end_date=' + encodeURIComponent(mgrPoModalState.endDate);

    const res = await axios.get(url);
    if (res.data && res.data.success) {
      mgrPoModalState.data = res.data.data || [];
    } else {
      mgrPoModalState.data = [];
    }
  } catch (err) {
    console.warn('Failed to load manager PO modal data', err);
    mgrPoModalState.data = [];
  }

  renderMgrPoModalTable();
}

function renderMgrPoModalTable() {
  const tbody = document.getElementById('mgrPoModalTableBody');
  const countBadge = document.getElementById('mgrPoModalCountBadge');
  const info = document.getElementById('mgrPoModalPaginationInfo');
  const pag = document.getElementById('mgrPoModalPagination');
  if (!tbody) return;

  let filtered = mgrPoModalState.data || [];
  if (mgrPoModalState.search) {
    const q = mgrPoModalState.search;
    filtered = filtered.filter(r => {
      const code = (r.po_code || '').toLowerCase();
      const sup = (r.supplier_name || '').toLowerCase();
      const ord = (r.ordered_by || '').toLowerCase();
      return code.includes(q) || sup.includes(q) || ord.includes(q);
    });
  }

  if (countBadge) countBadge.textContent = String(filtered.length);

  const total = filtered.length;
  const pageSize = mgrPoModalState.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  mgrPoModalState.page = Math.min(Math.max(1, mgrPoModalState.page), totalPages);
  const startIdx = (mgrPoModalState.page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageItems = filtered.slice(startIdx, endIdx);

  if (info) {
    info.textContent = total === 0 ? 'Showing 0 to 0 of 0 records' : `Showing ${startIdx + 1} to ${endIdx} of ${total} records`;
  }

  if (pag) {
    pag.innerHTML = renderPaginationButtons(mgrPoModalState.page, totalPages, 'setMgrPoPage');
  }

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted fst-italic">No purchase orders currently awaiting approval.</td></tr>';
    return;
  }

  tbody.innerHTML = pageItems.map(po => `
    <tr>
      <td class="font-monospace fw-bold ps-3">${escapeHtml(po.po_code)}</td>
      <td class="fw-semibold text-dark">${escapeHtml(po.supplier_name)}</td>
      <td class="text-center font-monospace">${po.item_count || 1}</td>
      <td class="font-monospace fw-semibold">${peso(po.total_cost || 0)}</td>
      <td class="small text-muted">${formatDisplayDate(po.order_date)}</td>
      <td class="text-end pe-3 text-nowrap">
        <button type="button" class="btn btn-sm btn-primary px-3 fw-semibold" onclick="closeModal('mgrPoApprovalModal'); handleManagerReviewPo(${po.po_id});">Review</button>
      </td>
    </tr>
  `).join('');
}

function setMgrPoPage(p) {
  mgrPoModalState.page = p;
  renderMgrPoModalTable();
}

function resetMgrPoModalFilters() {
  mgrPoModalState.search = '';
  mgrPoModalState.dateOption = 'all';
  mgrPoModalState.startDate = '';
  mgrPoModalState.endDate = '';
  mgrPoModalState.page = 1;

  const searchInput = document.getElementById('mgrPoModalSearch');
  if (searchInput) searchInput.value = '';

  const btnText = document.getElementById('mgrPoDateRangeBtnText');
  if (btnText) btnText.textContent = 'All Time';

  const sDate = document.getElementById('mgrPoStartDate');
  const eDate = document.getElementById('mgrPoEndDate');
  if (sDate) sDate.value = '';
  if (eDate) eDate.value = '';

  loadMgrPoModalData();
}

// Manager PO Date Portal
function toggleMgrPoDateRangeDropdown(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const menu = document.getElementById('mgrPoDateRangeMenu');
  if (!menu) return;
  if (menu.classList.contains('show')) {
    closeMgrPoDateRangeDropdown();
  } else {
    openMgrPoDateRangeDropdown();
  }
}

function openMgrPoDateRangeDropdown() {
  const menu = document.getElementById('mgrPoDateRangeMenu');
  const btn = document.getElementById('mgrPoDateRangeBtn');
  if (!menu || !btn) return;

  if (menu.parentNode !== document.body) {
    document.body.appendChild(menu);
  }

  menu.classList.add('show');
  menu.style.display = 'block';
  positionMgrPoDateRangeDropdown();

  window.addEventListener('scroll', positionMgrPoDateRangeDropdown, true);
  window.addEventListener('resize', positionMgrPoDateRangeDropdown);
  document.addEventListener('click', onMgrPoOutsideClick);
  document.addEventListener('keydown', onMgrPoKeydown);
}

function closeMgrPoDateRangeDropdown() {
  const menu = document.getElementById('mgrPoDateRangeMenu');
  if (!menu) return;
  menu.classList.remove('show');
  menu.style.display = 'none';

  window.removeEventListener('scroll', positionMgrPoDateRangeDropdown, true);
  window.removeEventListener('resize', positionMgrPoDateRangeDropdown);
  document.removeEventListener('click', onMgrPoOutsideClick);
  document.removeEventListener('keydown', onMgrPoKeydown);
}

function positionMgrPoDateRangeDropdown() {
  const menu = document.getElementById('mgrPoDateRangeMenu');
  const btn = document.getElementById('mgrPoDateRangeBtn');
  if (!menu || !btn || !menu.classList.contains('show')) return;

  const rect = btn.getBoundingClientRect();
  const menuW = 340;
  const menuH = menu.offsetHeight || 330;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const gap = 6;

  let top = rect.bottom + gap;
  if (vh - rect.bottom < menuH + gap + 10 && rect.top > menuH + gap) {
    top = Math.max(10, rect.top - menuH - gap);
  }

  let left = rect.right - menuW;
  if (left < 10) left = 10;
  if (left + menuW > vw - 10) left = vw - menuW - 10;

  if (vw < 576) {
    left = Math.max(10, (vw - menuW) / 2);
    top = Math.max(20, (vh - menuH) / 2);
  }

  menu.style.position = 'fixed';
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
  menu.style.zIndex = '2050';
}

function onMgrPoOutsideClick(e) {
  const menu = document.getElementById('mgrPoDateRangeMenu');
  const btn = document.getElementById('mgrPoDateRangeBtn');
  if (!menu || !menu.classList.contains('show')) return;
  if (!menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
    closeMgrPoDateRangeDropdown();
  }
}

function onMgrPoKeydown(e) {
  if (e.key === 'Escape') closeMgrPoDateRangeDropdown();
}

function selectMgrPoDateOption(opt, label) {
  mgrPoModalState.dateOption = opt;
  const btnText = document.getElementById('mgrPoDateRangeBtnText');
  if (btnText) btnText.textContent = label;

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  if (opt === 'all') {
    mgrPoModalState.startDate = '';
    mgrPoModalState.endDate = '';
  } else if (opt === 'today') {
    mgrPoModalState.startDate = todayStr;
    mgrPoModalState.endDate = todayStr;
  } else if (opt === '7days') {
    const past = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    mgrPoModalState.startDate = past.toISOString().slice(0, 10);
    mgrPoModalState.endDate = todayStr;
  } else if (opt === '30days') {
    const past = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    mgrPoModalState.startDate = past.toISOString().slice(0, 10);
    mgrPoModalState.endDate = todayStr;
  } else if (opt === 'month') {
    mgrPoModalState.startDate = `${yyyy}-${mm}-01`;
    mgrPoModalState.endDate = todayStr;
  }

  closeMgrPoDateRangeDropdown();
  mgrPoModalState.page = 1;
  loadMgrPoModalData();
}

function applyMgrPoCustomDateRange() {
  const s = document.getElementById('mgrPoStartDate');
  const e = document.getElementById('mgrPoEndDate');
  if (!s || !e) return;
  const startVal = s.value;
  const endVal = e.value;

  if (!startVal && !endVal) {
    selectMgrPoDateOption('all', 'All Time');
    return;
  }
  if (startVal && endVal && startVal > endVal) {
    if (typeof showToast === 'function') showToast('Start date cannot be after end date.', true);
    return;
  }

  mgrPoModalState.startDate = startVal || '';
  mgrPoModalState.endDate = endVal || '';
  mgrPoModalState.dateOption = 'custom';

  const btnText = document.getElementById('mgrPoDateRangeBtnText');
  if (btnText) {
    btnText.textContent = `${startVal || '...'} to ${endVal || '...'}`;
  }

  closeMgrPoDateRangeDropdown();
  mgrPoModalState.page = 1;
  loadMgrPoModalData();
}

// -----------------------------------------------------------------------------
// Manager Modal 3: Requested vs Available Stock Modal
// -----------------------------------------------------------------------------
let mgrStockModalState = {
  filter: 'top10',
  search: '',
  page: 1,
  pageSize: 10,
  data: []
};

let mgrStockListenersInitialized = false;

async function openMgrStockComparisonModal() {
  const modalEl = document.getElementById('mgrStockComparisonModal');
  if (!modalEl) return;

  mgrStockModalState.page = 1;
  mgrStockModalState.search = '';

  const searchInput = document.getElementById('mgrStockModalSearch');
  if (searchInput) searchInput.value = '';

  initMgrStockModalListeners();
  await loadMgrStockModalData();

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function initMgrStockModalListeners() {
  if (mgrStockListenersInitialized) return;
  mgrStockListenersInitialized = true;

  const searchInput = document.getElementById('mgrStockModalSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      mgrStockModalState.search = this.value.trim().toLowerCase();
      mgrStockModalState.page = 1;
      renderMgrStockModalTable();
    });
  }

  const filterSel = document.getElementById('mgrStockModalFilter');
  if (filterSel) {
    filterSel.addEventListener('change', function () {
      mgrStockModalState.filter = this.value;
      mgrStockModalState.page = 1;
      loadMgrStockModalData();
    });
  }
}

async function loadMgrStockModalData() {
  const tbody = document.getElementById('mgrStockModalTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted fst-italic">Loading product comparison...</td></tr>';
  }

  try {
    const res = await axios.get(API + 'dashboard.php?mode=manager_stock_comparison&filter=' + encodeURIComponent(mgrStockModalState.filter));
    if (res.data && res.data.success) {
      mgrStockModalState.data = res.data.data || [];
    } else {
      mgrStockModalState.data = [];
    }
  } catch (err) {
    console.warn('Failed to load manager stock comparison data', err);
    mgrStockModalState.data = [];
  }

  renderMgrStockModalTable();
}

function renderMgrStockModalTable() {
  const tbody = document.getElementById('mgrStockModalTableBody');
  const info = document.getElementById('mgrStockModalPaginationInfo');
  const pag = document.getElementById('mgrStockModalPagination');
  if (!tbody) return;

  let filtered = mgrStockModalState.data || [];
  if (mgrStockModalState.search) {
    const q = mgrStockModalState.search;
    filtered = filtered.filter(it => {
      const name = (it.product_name || '').toLowerCase();
      const sku = (it.sku || '').toLowerCase();
      return name.includes(q) || sku.includes(q);
    });
  }

  const total = filtered.length;
  const pageSize = mgrStockModalState.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  mgrStockModalState.page = Math.min(Math.max(1, mgrStockModalState.page), totalPages);
  const startIdx = (mgrStockModalState.page - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pageItems = filtered.slice(startIdx, endIdx);

  if (info) {
    info.textContent = total === 0 ? 'Showing 0 to 0 of 0 records' : `Showing ${startIdx + 1} to ${endIdx} of ${total} records`;
  }

  if (pag) {
    pag.innerHTML = renderPaginationButtons(mgrStockModalState.page, totalPages, 'setMgrStockPage');
  }

  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted fst-italic">No matching products found.</td></tr>';
    return;
  }

  tbody.innerHTML = pageItems.map(it => {
    const st = it.status || 'Sufficient';
    let badgeClass = 'bg-success text-white';
    if (st === 'Critical') {
      badgeClass = 'bg-danger text-white';
    } else if (st === 'Low') {
      badgeClass = 'bg-warning text-dark';
    }

    return `
      <tr>
        <td class="ps-3">
          <div class="fw-semibold text-dark">${escapeHtml(it.product_name)}</div>
          <div class="small text-muted font-monospace">${escapeHtml(it.sku || '')}</div>
        </td>
        <td class="text-center font-monospace fw-semibold">${it.requested_qty}</td>
        <td class="text-center font-monospace">${it.available_stock}</td>
        <td class="text-center font-monospace">${it.max_stock}</td>
        <td class="pe-3"><span class="badge ${badgeClass} font-monospace">${escapeHtml(st)}</span></td>
      </tr>
    `;
  }).join('');
}

function setMgrStockPage(p) {
  mgrStockModalState.page = p;
  renderMgrStockModalTable();
}




