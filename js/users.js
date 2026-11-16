async function loadUsers() {
  const canViewUsers = can('users', 'view');
  const canViewRoles = can('role', 'view');

  const userReq = canViewUsers ? axios.get(API + 'users.php') : Promise.resolve({ status: 200, data: { data: [] } });
  const roleReq = canViewRoles ? axios.get(API + 'role.php') : axios.get(API + 'role.php?mode=active');

  const [userRes, roleRes] = await Promise.all([userReq, roleReq]);
  if (userRes.status !== 200) {
    showToast('Failed to load users', true);
    return;
  }

  userCache = (userRes.data && userRes.data.data) || [];
  if (roleRes.status === 200 && roleRes.data && roleRes.data.data) {
    cache.roles = roleRes.data.data;
  }

  populateUserRoleDropdown();
  renderUsers(userCache);
  if (canViewRoles && typeof renderRoles === 'function') {
    renderRoles(cache.roles);
  }
}

async function populateUserRoleDropdown() {
  const select = document.getElementById('user_role_id');
  if (!select) return;

  if (!cache.roles || cache.roles.length === 0) {
    const res = await axios.get(API + 'role.php?mode=active');
    if (res.status === 200 && res.data && res.data.data) {
      cache.roles = res.data.data;
    }
  }

  const isActorAdmin = Boolean(authUser && (parseInt(authUser.role_id) === 1 || authUser.role_name === 'Administrator'));
  const activeRoles = (cache.roles || []).filter(function (r) {
    if (r.is_active !== undefined && parseInt(r.is_active) !== 1) return false;
    if ((parseInt(r.role_id) === 1 || r.role_name === 'Administrator') && !isActorAdmin) {
      return false;
    }
    return true;
  });

  const optionsHtml = activeRoles.map(function (r) {
    return '<option value="' + r.role_id + '">' + escapeHtml(r.role_name) + '</option>';
  }).join('');
  select.innerHTML = '<option value="">Select Role</option>' + optionsHtml;
}

function renderUsers(rows) {
  const body = document.getElementById('userTable');
  const mobileList = document.getElementById('userMobileList');
  if (!body && !mobileList) return;

  if (!rows || rows.length === 0) {
    if (body) renderEmptyRow(body, 'No users yet. Add one to get started.', 6);
    if (mobileList) {
      mobileList.innerHTML = '<div class="p-4 text-center text-muted fst-italic">No users yet. Add one to get started.</div>';
    }
    if (window.TableTools) TableTools.enhance('userTable', { searchPlaceholder: 'Search username, name, role...' });
    return;
  }

  if (body) {
    body.innerHTML = '';
    const tmpl = document.getElementById('tmpl-row-user');
    rows.map(function (r) {
      const clone = tmpl.content.cloneNode(true);
      clone.querySelector('.row-username').textContent = r.username;
      clone.querySelector('.row-name').textContent = r.first_name + ' ' + r.last_name;
      clone.querySelector('.row-role').innerHTML = `<span class="badge bg-dark-subtle text-dark border fw-semibold">${escapeHtml(r.role_name)}</span>`;
      clone.querySelector('.row-email').textContent = r.contact_number || '—';
      clone.querySelector('.row-status').appendChild(createStatusBadge(r.is_active));

      const actionsCell = clone.querySelector('.row-actions');

      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn btn-sm btn-outline-success me-1';
      viewBtn.title = 'View User Details';
      viewBtn.innerHTML = '<i class="bi bi-eye"></i>';
      viewBtn.addEventListener('click', function () {
        viewUserDetails(r.user_id);
      });
      actionsCell.appendChild(viewBtn);

      if (can('users', 'manage')) {
        const resetClone = document.getElementById('tmpl-btn-reset-password').content.cloneNode(true);
        const resetBtn = resetClone.querySelector('button');
        resetBtn.classList.add('me-1');
        resetBtn.addEventListener('click', function () {
          openResetPassword(r.user_id);
        });
        actionsCell.appendChild(resetClone);

        const rowActionsFrag = createRowActions('user', r.user_id, r.is_active);
        actionsCell.appendChild(rowActionsFrag);
      }
      return clone;
    }).forEach(function (rowNode) {
      body.appendChild(rowNode);
    });
  }

  if (mobileList) {
    mobileList.innerHTML = rows.map(function (r) {
      return `
        <div class="card mb-2 shadow-sm border gw-mobile-card-item">
          <div class="card-body p-3">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <div class="overflow-hidden" style="min-width:0;">
                <div class="fw-bold text-dark fs-6 text-truncate">${escapeHtml(r.first_name + ' ' + r.last_name)}</div>
                <div class="small text-muted font-monospace text-truncate">@${escapeHtml(r.username)}</div>
              </div>
              <div class="d-flex align-items-center gap-1 flex-shrink-0">
                <span class="badge bg-dark-subtle text-dark border">${escapeHtml(r.role_name)}</span>
                ${parseInt(r.is_active) === 1 ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-danger">Inactive</span>'}
              </div>
            </div>
            <div class="d-flex justify-content-between align-items-center pt-2 border-top">
              <div class="small text-muted text-truncate">${escapeHtml(r.contact_number || 'No contact')}</div>
              <div class="d-flex align-items-center gap-1">
                <button type="button" class="btn btn-sm btn-outline-success px-2 py-1" title="View Details" onclick="viewUserDetails(${r.user_id})">
                  <i class="bi bi-eye"></i>
                </button>
                ${can('users', 'manage') ? `
                  <button type="button" class="btn btn-sm btn-outline-secondary px-2 py-1" title="Reset Password" onclick="openResetPassword(${r.user_id})">
                    <i class="bi bi-key"></i>
                  </button>
                  <button type="button" class="btn btn-sm btn-outline-secondary px-2 py-1" title="Edit User" onclick="editUser(${r.user_id})">
                    <i class="bi bi-pencil"></i>
                  </button>
                  ${parseInt(r.is_active) === 1 ? `
                    <button type="button" class="btn btn-sm btn-outline-danger px-2 py-1" title="Deactivate" onclick="deactivateUser(${r.user_id})">
                      <i class="bi bi-slash-circle"></i>
                    </button>
                  ` : `
                    <button type="button" class="btn btn-sm btn-outline-success px-2 py-1" title="Reactivate" onclick="reactivateUser(${r.user_id})">
                      <i class="bi bi-arrow-counterclockwise"></i>
                    </button>
                  `}
                ` : ''}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  if (window.TableTools) {
    TableTools.enhance('userTable', { searchPlaceholder: 'Search username, name, role...' });
  }
}

function viewUserDetails(userId) {
  const u = findById(userCache, 'user_id', userId);
  if (!u) return;

  const roleObj = findById(cache.roles, 'role_id', u.role_id);
  const perms = (roleObj && roleObj.permissions) ? roleObj.permissions : {};
  const enabledModules = Object.keys(perms).filter(m => perms[m] && (perms[m].view || perms[m].manage));

  const body = document.getElementById('userDetailModalBody');
  const footer = document.getElementById('userDetailModalFooter');
  if (body) {
    body.innerHTML = `
      <div class="row g-3 p-3 bg-light rounded border mb-3">
        <div class="col-6 col-md-4">
          <div class="small text-muted text-uppercase fw-semibold">Full Name</div>
          <div class="fw-bold fs-6">${escapeHtml(u.first_name + ' ' + u.last_name)}</div>
        </div>
        <div class="col-6 col-md-4">
          <div class="small text-muted text-uppercase fw-semibold">Username</div>
          <div class="font-monospace fw-semibold">${escapeHtml(u.username)}</div>
        </div>
        <div class="col-6 col-md-4">
          <div class="small text-muted text-uppercase fw-semibold">Assigned Role</div>
          <div><span class="badge bg-dark">${escapeHtml(u.role_name)}</span></div>
        </div>
        <div class="col-6 col-md-4">
          <div class="small text-muted text-uppercase fw-semibold">Contact Number</div>
          <div>${escapeHtml(u.contact_number || 'Not provided')}</div>
        </div>
        <div class="col-6 col-md-4">
          <div class="small text-muted text-uppercase fw-semibold">Account Status</div>
          <div>${parseInt(u.is_active) === 1 ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-danger">Inactive</span>'}</div>
        </div>
      </div>
      <h6 class="fw-bold small text-uppercase text-muted mb-2">Effective Role Permissions (${escapeHtml(u.role_name)})</h6>
      <div class="d-flex flex-wrap gap-1">
        ${enabledModules.length === 0
          ? '<span class="text-muted small fst-italic">Standard role permissions apply.</span>'
          : enabledModules.map(m => {
              const p = perms[m] || {};
              const badgeTone = p.manage ? 'bg-primary-subtle text-primary border' : 'bg-secondary-subtle text-secondary border';
              const accessType = p.manage ? 'View & Manage' : 'View Only';
              return `<span class="badge ${badgeTone} px-2 py-1">${escapeHtml(m)} (${accessType})</span>`;
            }).join('')}
      </div>
    `;
  }

  if (footer) {
    let fHtml = '<button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button>';
    if (can('users', 'manage')) {
      fHtml += `<button type="button" class="btn btn-dark" onclick="closeModal('userDetailModal'); editUser(${u.user_id});"><i class="bi bi-pencil me-1"></i>Edit Account</button>`;
    }
    footer.innerHTML = fHtml;
  }

  openModal('userDetailModal');
}

async function editUser(id) {
  const row = findById(userCache, 'user_id', id);
  if (!row) return;
  document.getElementById('userModalTitle').textContent = 'Edit User';
  document.getElementById('user_id').value = row.user_id;
  document.getElementById('first_name').value = row.first_name;
  document.getElementById('last_name').value = row.last_name;
  document.getElementById('username').value = row.username;
  await populateUserRoleDropdown();
  document.getElementById('user_role_id').value = String(row.role_id);
  document.getElementById('contact_number').value = row.contact_number || '';
  document.getElementById('password').value = '';
  document.getElementById('password').removeAttribute('required');
  document.getElementById('passwordFieldLabel').hidden = true;
  openModal('userModal');
}

function openResetPassword(id) {
  document.getElementById('reset_user_id').value = id;
  document.getElementById('new_password').value = '';
  openModal('resetPwdModal');
}

async function saveUser(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const id = document.getElementById('user_id').value;
  const firstName = (document.getElementById('first_name').value || '').trim();
  const lastName = (document.getElementById('last_name').value || '').trim();
  const username = (document.getElementById('username').value || '').trim();
  const roleId = document.getElementById('user_role_id').value;
  const contact = (document.getElementById('contact_number').value || '').trim();

  let res;
  if (id) {
    res = await axios.put(API + 'users.php', {
      user_id: parseInt(id),
      action: 'update_details',
      first_name: firstName,
      last_name: lastName,
      username: username,
      role_id: parseInt(roleId),
      contact_number: contact
    });
  } else {
    formData.set('first_name', firstName);
    formData.set('last_name', lastName);
    formData.set('username', username);
    formData.set('role_id', roleId);
    formData.set('contact_number', contact);
    formData.set('password', document.getElementById('password').value);
    res = await axios.post(API + 'users.php', formData);
  }

  switch (res.status) {
    case 200:
      handleFormResult(res, 'userModal', loadUsers);
      break;
    default:
      showToast((res.data && res.data.message) || 'Request failed', true);
  }
}

async function saveResetPassword(e) {
  e.preventDefault();
  const payload = {
    user_id: document.getElementById('reset_user_id').value,
    action: 'reset_password',
    password: document.getElementById('new_password').value
  };

  const res = await axios.put(API + 'users.php', payload);
  switch (res.status) {
    case 200:
      handleFormResult(res, 'resetPwdModal', loadUsers);
      break;
    default:
      showToast((res.data && res.data.message) || 'Request failed', true);
  }
}
