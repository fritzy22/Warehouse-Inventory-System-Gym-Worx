
async function loadSuppliers() {
  const res = await axios.get(API + 'supplier.php');
  switch (res.status) {
    case 200:
      cache.suppliers = res.data.data;
      renderSuppliers(cache.suppliers);
      break;
    default:
      showToast('Failed to load suppliers', true);
  }
}

function renderSuppliers(rows) {
  const body = document.getElementById('supplierTable');
  const mobileList = document.getElementById('supplierMobileList');
  if (!rows || rows.length === 0) {
    if (body) renderEmptyRow(body, 'No suppliers yet. Add one to get started.', 6);
    if (mobileList) mobileList.innerHTML = '<div class="text-center text-muted p-4 fst-italic">No suppliers yet. Add one to get started.</div>';
    return;
  }

  if (body) {
    body.innerHTML = '';
    const tmpl = document.getElementById('tmpl-row-supplier');
    rows.map(function (r) {
      const clone = tmpl.content.cloneNode(true);
      clone.querySelector('.row-name').textContent = r.supplier_name;
      clone.querySelector('.row-contact').textContent = r.contact_person || '—';
      clone.querySelector('.row-phone').textContent = r.phone || '—';
      clone.querySelector('.row-email').textContent = r.email || '—';
      clone.querySelector('.row-status').appendChild(createStatusBadge(r.is_active));
      clone.querySelector('.row-actions').appendChild(createRowActions('supplier', r.supplier_id, r.is_active));
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
        <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
          <div>
            <strong class="text-dark d-block fs-6">${escapeHtml(r.supplier_name || 'Supplier')}</strong>
            ${r.contact_person ? `<span class="small text-muted"><i class="bi bi-person me-1"></i>${escapeHtml(r.contact_person)}</span>` : ''}
          </div>
          <div class="card-status-badge"></div>
        </div>
        <div class="small text-muted mb-2">
          ${r.phone ? `<div><i class="bi bi-telephone me-1"></i>${escapeHtml(r.phone)}</div>` : ''}
          ${r.email ? `<div><i class="bi bi-envelope me-1"></i>${escapeHtml(r.email)}</div>` : ''}
        </div>
        <div class="d-flex justify-content-end gap-2 border-top pt-2 card-actions-slot"></div>
      `;
      const badgeSlot = card.querySelector('.card-status-badge');
      if (badgeSlot) badgeSlot.appendChild(createStatusBadge(r.is_active));
      const actionsSlot = card.querySelector('.card-actions-slot');
      if (actionsSlot) actionsSlot.appendChild(createRowActions('supplier', r.supplier_id, r.is_active));
      mobileList.appendChild(card);
    });
  }

  if (window.TableTools) TableTools.enhance('supplierTable', { searchPlaceholder: 'Search suppliers...' });
}

function editSupplier(id) {
  const item = findById(cache.suppliers, 'supplier_id', id);
  if (!item) return;
  document.getElementById('supplier_id').value = item.supplier_id;
  document.getElementById('supplier_name').value = item.supplier_name;
  document.getElementById('contact_person').value = item.contact_person || '';
  document.getElementById('phone').value = item.phone || '';
  document.getElementById('email').value = item.email || '';
  document.getElementById('address').value = item.address || '';
  document.getElementById('supplierModalTitle').textContent = 'Edit Supplier';
  openModal('supplierModal');
}

async function saveSupplier(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const id = document.getElementById('supplier_id').value;
  const name = (document.getElementById('supplier_name').value || '').trim();
  const contact = (document.getElementById('contact_person').value || '').trim();
  const phone = (document.getElementById('phone').value || '').trim();
  const email = (document.getElementById('email').value || '').trim();
  const address = (document.getElementById('address').value || '').trim();

  let res;
  if (id) {
    res = await axios.put(API + 'supplier.php', {
      supplier_id: parseInt(id),
      supplier_name: name,
      contact_person: contact,
      phone: phone,
      email: email,
      address: address
    });
  } else {
    formData.set('supplier_name', name);
    formData.set('contact_person', contact);
    formData.set('phone', phone);
    formData.set('email', email);
    formData.set('address', address);
    res = await axios.post(API + 'supplier.php', formData);
  }

  switch (res.status) {
    case 200:
      handleFormResult(res, 'supplierModal', loadSuppliers);
      break;
    default:
      showToast((res.data && res.data.message) || 'Request failed', true);
  }
}

