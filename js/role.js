const RBAC_MODULES = [
  'dashboard',
  'purchase_request',
  'request_approval',
  'purchase_order',
  'stock_receiving',
  'stock_releasing',
  'purchase_return',
  'stocks_return',
  'adjustment',
  'stock_movement',
  'product',
  'category',
  'supplier',
  'product_supplier',
  'users',
  'role',
  'inventory_report'
];

const RBAC_MODULE_META = {
  dashboard: { label: 'Dashboard', desc: 'Role-specific operational dashboard and KPI cards', viewOnly: true },
  purchase_request: { label: 'Purchase Requests', desc: 'Create, edit, and track replenishment purchase requests', viewOnly: false },
  request_approval: { label: 'Request Approval (Manager)', desc: 'Review, adjust quantities, approve, return, or reject purchase requests', viewOnly: false },
  purchase_order: { label: 'Purchase Orders', desc: 'Create supplier POs from approved requests and manage order statuses', viewOnly: false },
  stock_receiving: { label: 'Stock Receiving', desc: 'Verify deliveries, enter full/partial received quantities, and issue DRs', viewOnly: false },
  stock_releasing: { label: 'Stock Releasing', desc: 'Release warehouse stock to store/operations', viewOnly: false },
  purchase_return: { label: 'Purchase Returns', desc: 'Return defective or excess items to suppliers', viewOnly: false },
  stocks_return: { label: 'Stocks Return', desc: 'Receive returned stock back from store/customers', viewOnly: false },
  adjustment: { label: 'Stock Adjustments', desc: 'Record manual stock additions or deductions with reason', viewOnly: false },
  stock_movement: { label: 'Stock Movements Ledger', desc: 'View chronological inflow/outflow history across all modules', viewOnly: true },
  product: { label: 'Products & Stock Levels', desc: 'View stock levels or manage product catalog, reorder thresholds, and max stock', viewOnly: false },
  category: { label: 'Categories', desc: 'Product categorization master records', viewOnly: false },
  supplier: { label: 'Suppliers', desc: 'Vendor and supplier contact records', viewOnly: false },
  product_supplier: { label: 'Product ↔ Supplier', desc: 'Link products to suppliers and configure supplier unit costs', viewOnly: false },
  users: { label: 'User Management', desc: 'View, create, edit, activate/deactivate user accounts', viewOnly: false },
  role: { label: 'Roles & Permissions', desc: 'Manage system roles and module-level permissions', viewOnly: false },
  inventory_report: { label: 'Inventory Report', desc: 'Generate and print inventory valuation and stock health summaries', viewOnly: true }
};

async function loadRoles() {
  const res = await axios.get(API + 'role.php');
  switch (res.status) {
    case 200:
      cache.roles = res.data.data || [];
      renderRoles(cache.roles);
      break;
    default:
      showToast('Failed to load roles', true);
  }
}

function renderRoles(rows) {
  const body = document.getElementById('roleTable');
  const mobileList = document.getElementById('roleMobileList');
  if (!body && !mobileList) return;

  if (!rows || rows.length === 0) {
    if (body) renderEmptyRow(body, 'No roles yet. Add one to get started.', 5);
    if (mobileList) {
      mobileList.innerHTML = '<div class="p-4 text-center text-muted fst-italic">No roles yet. Add one to get started.</div>';
    }
    return;
  }

  if (body) {
    body.innerHTML = '';
    const tmpl = document.getElementById('tmpl-row-role');
    rows.map(function (r) {
      const clone = tmpl.content.cloneNode(true);
      clone.querySelector('.row-name').textContent = r.role_name;

      const assignedCount = (userCache || []).filter(u => String(u.role_id) === String(r.role_id)).length;
      const usersCell = clone.querySelector('.row-users');
      if (usersCell) {
        usersCell.innerHTML = `<span class="badge bg-secondary-subtle text-dark border">${assignedCount} user${assignedCount === 1 ? '' : 's'}</span>`;
      }

      const perms = r.permissions || {};
      const enabledCount = RBAC_MODULES.filter(m => perms[m] && (perms[m].view || perms[m].manage)).length;
      const modsCell = clone.querySelector('.row-modules');
      if (modsCell) {
        modsCell.innerHTML = `<span class="small text-muted">${enabledCount} / ${RBAC_MODULES.length} modules enabled</span>`;
      }

      clone.querySelector('.row-status').appendChild(createStatusBadge(r.is_active));
      clone.querySelector('.row-actions').appendChild(createRowActions('role', r.role_id, r.is_active));
      return clone;
    }).forEach(function (node) {
      body.appendChild(node);
    });
  }

  if (mobileList) {
    mobileList.innerHTML = rows.map(function (r) {
      const assignedCount = (userCache || []).filter(u => String(u.role_id) === String(r.role_id)).length;
      const perms = r.permissions || {};
      const enabledCount = RBAC_MODULES.filter(m => perms[m] && (perms[m].view || perms[m].manage)).length;
      const isAdmin = parseInt(r.role_id) === 1 || r.role_name === 'Administrator';

      return `
        <div class="card mb-2 shadow-sm border gw-mobile-card-item">
          <div class="card-body p-3">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <div>
                <div class="fw-bold text-dark fs-6 mb-1">${escapeHtml(r.role_name)}</div>
                <div class="small text-muted">${assignedCount} user${assignedCount === 1 ? '' : 's'} assigned</div>
              </div>
              <div>${parseInt(r.is_active) === 1 ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-danger">Inactive</span>'}</div>
            </div>
            <div class="d-flex justify-content-between align-items-center pt-2 border-top flex-wrap gap-2">
              <div class="small text-muted">
                ${enabledCount} / ${RBAC_MODULES.length} modules
              </div>
              <div class="d-flex align-items-center gap-1">
                ${can('role', 'manage') ? `
                  <button type="button" class="btn btn-sm btn-outline-secondary px-2 py-1" title="Edit Role" onclick="editRole(${r.role_id})">
                    <i class="bi bi-pencil me-1"></i>Edit
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

function editRole(id) {
  const item = findById(cache.roles, 'role_id', id);
  if (!item) return;

  document.getElementById('role_id').value = item.role_id;
  const nameInput = document.getElementById('role_name');
  nameInput.value = item.role_name;
  document.getElementById('roleModalTitle').textContent = 'Edit Role & Permissions';

  const isAdmin = (item.role_name === 'Administrator' || parseInt(item.role_id) === 1);
  nameInput.readOnly = isAdmin;

  const perms = item.permissions || {};
  for (let i = 0; i < RBAC_MODULES.length; i++) {
    const mod = RBAC_MODULES[i];
    const viewCb = document.getElementById('perm_view_' + mod);
    const manageCb = document.getElementById('perm_manage_' + mod);
    const modPerm = perms[mod] || {};

    if (viewCb) {
      viewCb.checked = Boolean(modPerm.view || modPerm.manage);
      viewCb.disabled = false;
    }
    if (manageCb) {
      manageCb.checked = Boolean(modPerm.manage);
      manageCb.disabled = false;
    }
  }

  openModal('roleModal');
}

async function saveRole(e) {
  e.preventDefault();
  const id = document.getElementById('role_id').value;
  const permissionsPayload = {};

  for (let i = 0; i < RBAC_MODULES.length; i++) {
    const mod = RBAC_MODULES[i];
    const viewCb = document.getElementById('perm_view_' + mod);
    const manageCb = document.getElementById('perm_manage_' + mod);
    const canManage = manageCb ? manageCb.checked : false;
    const canView = viewCb ? (viewCb.checked || canManage) : false;
    permissionsPayload[mod] = {
      view: canView,
      manage: canManage
    };
  }

  const payload = {
    role_name: document.getElementById('role_name').value.trim(),
    permissions: permissionsPayload
  };

  let res;
  if (id) {
    payload.role_id = parseInt(id);
    res = await axios.put(API + 'role.php', payload);
  } else {
    res = await axios.post(API + 'role.php', payload);
  }

  switch (res.status) {
    case 200:
      handleFormResult(res, 'roleModal', async function () {
        await loadRoles();
        await loadInlinePermissionsMatrix();
        if (authUser && (String(authUser.role_id) === String(id) || authUser.role_name === payload.role_name)) {
          await checkSession();
        }
      });
      break;
    default:
      showToast((res.data && res.data.message) || 'Request failed', true);
  }
}

async function loadInlinePermissionsMatrix() {
  if (!cache.roles || cache.roles.length === 0) {
    await loadRoles();
  }
  const select = document.getElementById('inlinePermRoleSelect');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = (cache.roles || []).map(function (r) {
    return `<option value="${r.role_id}">${escapeHtml(r.role_name)}${parseInt(r.is_active) === 1 ? '' : ' (Inactive)'}</option>`;
  }).join('');

  if (currentVal && findById(cache.roles, 'role_id', currentVal)) {
    select.value = currentVal;
  } else if (cache.roles.length > 0) {
    const nonAdmin = cache.roles.find(r => parseInt(r.role_id) !== 1);
    select.value = String(nonAdmin ? nonAdmin.role_id : cache.roles[0].role_id);
  }

  renderInlinePermissionsForSelectedRole();
}

function renderInlinePermissionsForSelectedRole() {
  const select = document.getElementById('inlinePermRoleSelect');
  const tbody = document.getElementById('inlinePermissionsTableBody');
  const saveBtn = document.getElementById('btnSaveInlinePerms');
  if (!select || !tbody) return;

  const role = findById(cache.roles, 'role_id', select.value);
  if (!role) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Select a role above.</td></tr>';
    return;
  }

  const isAdmin = parseInt(role.role_id) === 1 || role.role_name === 'Administrator';
  const canManageRoles = can('role', 'manage');
  if (saveBtn) {
    saveBtn.disabled = !canManageRoles;
  }

  const perms = role.permissions || {};
  tbody.innerHTML = RBAC_MODULES.map(function (mod) {
    const meta = RBAC_MODULE_META[mod] || { label: mod, desc: '', viewOnly: false };
    const modPerm = perms[mod] || {};
    const vChecked = (modPerm.view || modPerm.manage) ? 'checked' : '';
    const mChecked = (modPerm.manage) ? 'checked' : '';
    const disabledAttr = !canManageRoles ? 'disabled' : '';

    return `
      <tr>
        <td class="ps-3 fw-semibold">${escapeHtml(meta.label)}</td>
        <td class="small text-muted">${escapeHtml(meta.desc)}</td>
        <td class="text-center">
          <input type="checkbox" class="form-check-input inline-perm-check inline-perm-view" data-module="${mod}" id="inline_perm_view_${mod}" ${vChecked} ${disabledAttr}>
        </td>
        <td class="text-center">
          ${meta.viewOnly
            ? '<span class="text-muted small fst-italic">View-only</span>'
            : `<input type="checkbox" class="form-check-input inline-perm-check inline-perm-manage" data-module="${mod}" id="inline_perm_manage_${mod}" ${mChecked} ${disabledAttr}>`}
        </td>
      </tr>
    `;
  }).join('');
}

async function saveInlineRolePermissions() {
  const select = document.getElementById('inlinePermRoleSelect');
  if (!select || !select.value) return;
  const role = findById(cache.roles, 'role_id', select.value);
  if (!role) return;

  const permissionsPayload = {};
  RBAC_MODULES.forEach(function (mod) {
    const vCb = document.getElementById('inline_perm_view_' + mod);
    const mCb = document.getElementById('inline_perm_manage_' + mod);
    const canManage = mCb ? mCb.checked : false;
    const canView = vCb ? (vCb.checked || canManage) : false;
    permissionsPayload[mod] = { view: canView, manage: canManage };
  });

  const res = await axios.put(API + 'role.php', {
    role_id: parseInt(role.role_id),
    role_name: role.role_name,
    permissions: permissionsPayload
  });

  if (res.status === 200 && res.data && res.data.success) {
    showToast(res.data.message || 'Permissions updated successfully');
    await loadRoles();
    renderInlinePermissionsForSelectedRole();
    if (authUser && String(authUser.role_id) === String(role.role_id)) {
      await checkSession();
    }
  } else {
    showToast((res.data && res.data.message) || 'Failed to update permissions', true);
  }
}

document.addEventListener('change', function (e) {
  if (!e.target) return;

  if (e.target.classList.contains('perm-check')) {
    const mod = e.target.getAttribute('data-module');
    if (!mod) return;
    if (e.target.classList.contains('perm-manage') && e.target.checked) {
      const viewCb = document.getElementById('perm_view_' + mod);
      if (viewCb) viewCb.checked = true;
    } else if (e.target.classList.contains('perm-view') && !e.target.checked) {
      const manageCb = document.getElementById('perm_manage_' + mod);
      if (manageCb) manageCb.checked = false;
    }
  } else if (e.target.classList.contains('inline-perm-check')) {
    const mod = e.target.getAttribute('data-module');
    if (!mod) return;
    if (e.target.classList.contains('inline-perm-manage') && e.target.checked) {
      const viewCb = document.getElementById('inline_perm_view_' + mod);
      if (viewCb) viewCb.checked = true;
    } else if (e.target.classList.contains('inline-perm-view') && !e.target.checked) {
      const manageCb = document.getElementById('inline_perm_manage_' + mod);
      if (manageCb) manageCb.checked = false;
    }
  }
});
