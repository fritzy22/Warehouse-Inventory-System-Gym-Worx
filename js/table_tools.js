/**
 * Reusable client-side search, status filter, column sorting, and pagination
 * for transaction and master tables.
 */

const TableTools = (function () {
  const controllers = {};

  function getNestedText(item, fields) {
    if (!item) return '';
    return fields.map(function (f) {
      const val = typeof f === 'function' ? f(item) : item[f];
      return val === null || val === undefined ? '' : String(val);
    }).join(' ').toLowerCase();
  }

  /**
   * Attaches a search/filter/sort/pagination toolbar above a table and manages rendering.
   *
   * @param {object} cfg
   *   - id: unique key (e.g. 'po', 'pr', 'receiving')
   *   - tableBodyId: tbody element id
   *   - searchFields: array of keys or functions
   *   - statusField: optional status key or function
   *   - statusOptions: optional array of { value, label }
   *   - defaultSort: { key, dir: 'asc'|'desc' }
   *   - pageSize: default 10
   *   - colSpan: number of columns for empty state
   *   - emptyMessage: message when no records match
   *   - renderRow: function(item) -> Node
   */
  function create(cfg) {
    const state = {
      cfg: cfg,
      allRows: [],
      search: '',
      status: '',
      sortKey: (cfg.defaultSort && cfg.defaultSort.key) || null,
      sortDir: (cfg.defaultSort && cfg.defaultSort.dir) || 'desc',
      page: 1,
      pageSize: cfg.pageSize || 10
    };
    controllers[cfg.id] = state;
    ensureToolbarAndFooter(state);
    return {
      setData: function (rows) {
        state.allRows = Array.isArray(rows) ? rows.slice() : [];
        state.page = 1;
        render(state);
      },
      setFilter: function (opts) {
        if (!opts) return;
        if (opts.status !== undefined) {
          state.status = opts.status;
          const sel = document.getElementById('gw_filter_' + cfg.id);
          if (sel) sel.value = opts.status;
        }
        if (opts.search !== undefined) {
          state.search = opts.search;
          const inp = document.getElementById('gw_search_' + cfg.id);
          if (inp) inp.value = opts.search;
        }
        state.page = 1;
        render(state);
      },
      refresh: function () {
        render(state);
      }
    };
  }

  function ensureToolbarAndFooter(state) {
    const cfg = state.cfg;
    const tbody = document.getElementById(cfg.tableBodyId);
    if (!tbody) return;
    const table = tbody.closest('table');
    const card = tbody.closest('.card');
    if (!table || !card) return;

    if (!document.getElementById('gw_toolbar_' + cfg.id)) {
      const bar = document.createElement('div');
      bar.id = 'gw_toolbar_' + cfg.id;
      bar.className = 'gw-table-toolbar d-flex flex-wrap align-items-center justify-content-between gap-2';

      const left = document.createElement('div');
      left.className = 'd-flex flex-wrap align-items-center gap-2 flex-grow-1';

      const searchWrap = document.createElement('div');
      searchWrap.className = 'input-group input-group-sm';
      searchWrap.style.maxWidth = '280px';
      searchWrap.innerHTML =
        '<span class="input-group-text bg-light border-end-0"><i class="bi bi-search text-muted"></i></span>' +
        '<input type="search" class="form-control border-start-0" id="gw_search_' + cfg.id + '" placeholder="' + (cfg.searchPlaceholder || 'Search records...') + '" aria-label="Search">';
      left.appendChild(searchWrap);

      if (cfg.statusOptions && cfg.statusOptions.length > 0) {
        const sel = document.createElement('select');
        sel.id = 'gw_filter_' + cfg.id;
        sel.className = 'form-select form-select-sm';
        sel.style.maxWidth = '195px';
        sel.setAttribute('aria-label', 'Filter by status');
        sel.innerHTML = '<option value="">All Statuses</option>' + cfg.statusOptions.map(function (o) {
          return '<option value="' + escapeHtml(o.value) + '">' + escapeHtml(o.label) + '</option>';
        }).join('');
        sel.addEventListener('change', function () {
          state.status = this.value;
          state.page = 1;
          render(state);
        });
        left.appendChild(sel);
      }

      const right = document.createElement('div');
      right.className = 'd-flex align-items-center gap-2 small text-muted';
      right.innerHTML = '<span id="gw_count_' + cfg.id + '">0 records</span>';

      bar.appendChild(left);
      bar.appendChild(right);
      card.insertBefore(bar, card.firstChild);

      const searchInput = document.getElementById('gw_search_' + cfg.id);
      if (searchInput) {
        searchInput.addEventListener('input', function () {
          state.search = this.value.trim();
          state.page = 1;
          render(state);
        });
      }
    }

    if (!document.getElementById('gw_pager_' + cfg.id)) {
      const footer = document.createElement('div');
      footer.id = 'gw_pager_' + cfg.id;
      footer.className = 'card-footer bg-white d-flex flex-wrap align-items-center justify-content-between gap-2 py-2 px-3 small';
      card.appendChild(footer);
    }
  }

  function render(state) {
    ensureToolbarAndFooter(state);
    const cfg = state.cfg;
    const tbody = document.getElementById(cfg.tableBodyId);
    if (!tbody) return;

    const q = (state.search || '').toLowerCase();
    const st = state.status || '';

    let filtered = state.allRows.filter(function (row) {
      if (st !== '') {
        const val = typeof cfg.statusField === 'function' ? cfg.statusField(row) : row[cfg.statusField || 'status'];
        if (String(val) !== String(st)) return false;
      }
      if (q !== '') {
        const hay = getNestedText(row, cfg.searchFields || Object.keys(row));
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    if (state.sortKey) {
      const key = state.sortKey;
      const mult = state.sortDir === 'asc' ? 1 : -1;
      filtered.sort(function (a, b) {
        const va = typeof key === 'function' ? key(a) : a[key];
        const vb = typeof key === 'function' ? key(b) : b[key];
        const na = parseFloat(va);
        const nb = parseFloat(vb);
        if (!isNaN(na) && !isNaN(nb) && String(va).trim() !== '' && String(vb).trim() !== '') {
          return (na - nb) * mult;
        }
        return String(va || '').localeCompare(String(vb || '')) * mult;
      });
    }

    const total = filtered.length;
    const countEl = document.getElementById('gw_count_' + cfg.id);
    if (countEl) {
      countEl.textContent = total + (total === 1 ? ' record' : ' records');
    }

    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
    const startIdx = (state.page - 1) * state.pageSize;
    const pageRows = filtered.slice(startIdx, startIdx + state.pageSize);

    if (pageRows.length === 0) {
      const msg = (q !== '' || st !== '')
        ? 'No matching records found for the current search/filter.'
        : (cfg.emptyMessage || 'No records available.');
      renderEmptyRow(tbody, msg, cfg.colSpan || 6);
    } else {
      tbody.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (let i = 0; i < pageRows.length; i++) {
        const node = cfg.renderRow(pageRows[i], startIdx + i);
        if (node) frag.appendChild(node);
      }
      tbody.appendChild(frag);
    }

    const pager = document.getElementById('gw_pager_' + cfg.id);
    if (pager) {
      if (total <= state.pageSize) {
        pager.hidden = true;
      } else {
        pager.hidden = false;
        const from = total === 0 ? 0 : startIdx + 1;
        const to = Math.min(total, startIdx + state.pageSize);
        pager.innerHTML =
          '<span class="text-muted">Showing ' + from + '–' + to + ' of ' + total + '</span>' +
          '<div class="btn-group btn-group-sm" role="group" aria-label="Pagination">' +
          '<button type="button" class="btn btn-outline-secondary" data-page="prev" ' + (state.page <= 1 ? 'disabled' : '') + '>Prev</button>' +
          '<span class="btn btn-light disabled">Page ' + state.page + ' / ' + totalPages + '</span>' +
          '<button type="button" class="btn btn-outline-secondary" data-page="next" ' + (state.page >= totalPages ? 'disabled' : '') + '>Next</button>' +
          '</div>';
        const prevBtn = pager.querySelector('[data-page="prev"]');
        const nextBtn = pager.querySelector('[data-page="next"]');
        if (prevBtn) {
          prevBtn.addEventListener('click', function () {
            if (state.page > 1) {
              state.page--;
              render(state);
            }
          });
        }
        if (nextBtn) {
          nextBtn.addEventListener('click', function () {
            if (state.page < totalPages) {
              state.page++;
              render(state);
            }
          });
        }
      }
    }
  }

  function enhance(tableBodyId, opts) {
    opts = opts || {};
    const tbody = typeof tableBodyId === 'string' ? document.getElementById(tableBodyId) : tableBodyId;
    if (!tbody) return;
    const table = tbody.closest('table');
    if (!table) return;
    const card = tbody.closest('.card') || table.parentElement;
    if (!card) return;

    const bodyId = tbody.id || ('tbl_' + Math.random().toString(36).substring(2, 7));
    const toolbarId = 'gw_toolbar_' + bodyId;
    let toolbar = document.getElementById(toolbarId);
    let searchInput;

    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = toolbarId;
      toolbar.className = 'gw-table-toolbar d-flex flex-wrap align-items-center justify-content-between gap-2 p-2 border-bottom bg-light bg-opacity-50';

      const left = document.createElement('div');
      left.className = 'd-flex flex-wrap align-items-center gap-2 flex-grow-1';

      const searchWrap = document.createElement('div');
      searchWrap.className = 'input-group input-group-sm';
      searchWrap.style.maxWidth = '300px';
      searchWrap.innerHTML =
        '<span class="input-group-text bg-white border-end-0"><i class="bi bi-search text-muted"></i></span>' +
        '<input type="search" class="form-control border-start-0" id="gw_search_' + bodyId + '" placeholder="' + (opts.searchPlaceholder || 'Search records...') + '" aria-label="Search">';
      left.appendChild(searchWrap);

      const right = document.createElement('div');
      right.className = 'd-flex align-items-center gap-2 small text-muted ms-auto';
      right.innerHTML = '<span id="gw_count_' + bodyId + '"></span>';

      toolbar.appendChild(left);
      toolbar.appendChild(right);

      if (opts.showToolbar === false) {
        toolbar.style.display = 'none';
      }

      const tableWrapper = table.closest('.table-responsive') || table;
      card.insertBefore(toolbar, tableWrapper);

      searchInput = toolbar.querySelector('input[type="search"]');
    } else {
      if (opts.showToolbar === false) {
        toolbar.style.display = 'none';
      }
      searchInput = toolbar.querySelector('input[type="search"]');
      if (opts.searchPlaceholder && searchInput) {
        searchInput.placeholder = opts.searchPlaceholder;
      }
    }

    function applyFilter() {
      const q = searchInput ? searchInput.value.trim().toLowerCase() : '';
      const allTrs = Array.from(tbody.querySelectorAll('tr'));
      const dataRows = allTrs.filter(function (tr) {
        return !tr.classList.contains('gw-search-empty-row') && !tr.querySelector('.row-empty-cell') && !tr.querySelector('.line-empty-cell');
      });

      let visibleCount = 0;
      dataRows.forEach(function (tr) {
        const text = tr.textContent.toLowerCase();
        const match = q === '' || text.indexOf(q) !== -1;
        tr.style.display = match ? '' : 'none';
        if (match) visibleCount++;
      });

      // Also filter mobile cards if present in the container
      const mobileCards = Array.from(card.querySelectorAll('.gw-mobile-card-item'));
      let mobileVisibleCount = 0;
      if (mobileCards.length > 0) {
        mobileCards.forEach(function (mc) {
          const text = mc.textContent.toLowerCase();
          const match = q === '' || text.indexOf(q) !== -1;
          mc.style.display = match ? '' : 'none';
          if (match) mobileVisibleCount++;
        });

        let mobileEmptyMatch = card.querySelector('.gw-search-empty-mobile');
        if (mobileCards.length > 0 && mobileVisibleCount === 0 && q !== '') {
          if (!mobileEmptyMatch) {
            mobileEmptyMatch = document.createElement('div');
            mobileEmptyMatch.className = 'gw-search-empty-mobile p-4 text-center text-muted fst-italic';
            mobileEmptyMatch.innerHTML = '<i class="bi bi-search me-1"></i>No matching records found.';
            const mobList = card.querySelector('.d-md-none') || card;
            mobList.appendChild(mobileEmptyMatch);
          } else {
            mobileEmptyMatch.style.display = '';
          }
        } else if (mobileEmptyMatch) {
          mobileEmptyMatch.style.display = 'none';
        }
      }

      const totalItems = dataRows.length > 0 ? dataRows.length : mobileCards.length;
      const countEl = document.getElementById('gw_count_' + bodyId);
      if (countEl) {
        const curVisible = dataRows.length > 0 ? visibleCount : mobileVisibleCount;
        if (q === '') {
          countEl.textContent = totalItems + (totalItems === 1 ? ' record' : ' records');
        } else {
          countEl.textContent = 'Showing ' + curVisible + ' of ' + totalItems;
        }
      }

      let emptyMatchRow = tbody.querySelector('.gw-search-empty-row');
      if (dataRows.length > 0 && visibleCount === 0 && q !== '') {
        if (!emptyMatchRow) {
          emptyMatchRow = document.createElement('tr');
          emptyMatchRow.className = 'gw-search-empty-row';
          const theadTr = table.querySelector('thead tr');
          const colSpan = (theadTr && theadTr.children.length) || 7;
          emptyMatchRow.innerHTML = '<td colspan="' + colSpan + '" class="text-center text-muted py-3 fst-italic"><i class="bi bi-search me-1"></i>No matching records found.</td>';
          tbody.appendChild(emptyMatchRow);
        } else {
          emptyMatchRow.style.display = '';
        }
      } else if (emptyMatchRow) {
        emptyMatchRow.style.display = 'none';
      }
    }

    if (searchInput && !searchInput.dataset.gwAttached) {
      searchInput.dataset.gwAttached = 'true';
      searchInput.addEventListener('input', applyFilter);
    }

    applyFilter();
  }

  function get(id) {
    return controllers[id] || null;
  }

  return { create: create, get: get, enhance: enhance };
})();

