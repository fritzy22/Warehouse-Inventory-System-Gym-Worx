
async function loadCategories() {
  const res = await axios.get(API + 'category.php');
  switch (res.status) {
    case 200:
      cache.categories = res.data.data;
      renderCategories(cache.categories);
      break;
    default:
      showToast('Failed to load categories', true);
  }
}

function renderCategories(rows) {
  const body = document.getElementById('categoryTable');
  const mobileList = document.getElementById('categoryMobileList');
  if (!rows || rows.length === 0) {
    if (body) renderEmptyRow(body, 'No categories yet. Add one to get started.', 4);
    if (mobileList) mobileList.innerHTML = '<div class="text-center text-muted p-4 fst-italic">No categories yet. Add one to get started.</div>';
    return;
  }

  if (body) {
    body.innerHTML = '';
    const tmpl = document.getElementById('tmpl-row-category');
    rows.map(function (r) {
      const clone = tmpl.content.cloneNode(true);
      clone.querySelector('.row-name').textContent = r.category_name;
      clone.querySelector('.row-desc').textContent = r.description || '—';
      clone.querySelector('.row-status').appendChild(createStatusBadge(r.is_active));
      clone.querySelector('.row-actions').appendChild(createRowActions('category', r.category_id, r.is_active));
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
            <strong class="text-dark d-block">${escapeHtml(r.category_name || 'Category')}</strong>
            ${r.description ? `<span class="small text-muted">${escapeHtml(r.description)}</span>` : ''}
          </div>
          <div class="card-status-badge"></div>
        </div>
        <div class="d-flex justify-content-end gap-2 border-top pt-2 mt-2 card-actions-slot"></div>
      `;
      const badgeSlot = card.querySelector('.card-status-badge');
      if (badgeSlot) badgeSlot.appendChild(createStatusBadge(r.is_active));
      const actionsSlot = card.querySelector('.card-actions-slot');
      if (actionsSlot) actionsSlot.appendChild(createRowActions('category', r.category_id, r.is_active));
      mobileList.appendChild(card);
    });
  }

  if (window.TableTools) TableTools.enhance('categoryTable', { searchPlaceholder: 'Search categories...' });
}

function editCategory(id) {
  const item = findById(cache.categories, 'category_id', id);
  if (!item) return;
  document.getElementById('category_id').value = item.category_id;
  document.getElementById('category_name').value = item.category_name;
  document.getElementById('category_description').value = item.description || '';
  document.getElementById('categoryModalTitle').textContent = 'Edit Category';
  openModal('categoryModal');
}

async function saveCategory(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const id = document.getElementById('category_id').value;
  const name = (document.getElementById('category_name').value || '').trim();
  const desc = (document.getElementById('category_description').value || '').trim();

  let res;
  if (id) {
    res = await axios.put(API + 'category.php', {
      category_id: parseInt(id),
      category_name: name,
      description: desc
    });
  } else {
    formData.set('category_name', name);
    formData.set('description', desc);
    res = await axios.post(API + 'category.php', formData);
  }

  switch (res.status) {
    case 200:
      handleFormResult(res, 'categoryModal', loadCategories);
      break;
    default:
      showToast((res.data && res.data.message) || 'Request failed', true);
  }
}

