/**
 * GymWorx Warehouse — Standardized Print & Receipt System
 * Compact, nearly square modal design matching the official design specification.
 * Supports:
 *   - Stock Releasing Receipts
 *   - Stock Receiving Receipts / Goods Receipt Notes (GRN)
 *   - Purchase Orders
 *   - Purchase Requests
 *   - Stock Adjustments
 *   - Inventory Reports
 *   - Stock Returns & Purchase Returns
 */

(function (window, document) {
  'use strict';

  function formatDateTime(dateVal) {
    if (!dateVal) {
      const now = new Date();
      return 'Issued: ' + now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
        now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return 'Issued: ' + dateVal;
    return 'Issued: ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function formatDateOnly(dateVal) {
    if (!dateVal) return '-';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return dateVal;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatPeso(amount) {
    const value = parseFloat(amount);
    return 'PHP ' + (isNaN(value) ? 0 : value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function escapeHtmlStr(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Main reusable modal opener
   */
  async function openReceiptModal(type, dataOrId) {
    const modalEl = document.getElementById('receiptModal');
    if (!modalEl) {
      console.warn('receiptModal element not found');
      return;
    }

    // Role-based permission guard
    const normalizedType = String(type || '').toLowerCase();
    const permMap = {
      'stock_releasing': 'stock_releasing',
      'sale': 'stock_releasing',
      'releasing': 'stock_releasing',
      'stock_receiving': 'stock_receiving',
      'receiving': 'stock_receiving',
      'purchase_order': 'purchase_order',
      'po': 'purchase_order',
      'purchase_request': 'purchase_request',
      'pr': 'purchase_request',
      'adjustment': 'adjustment',
      'inventory_report': 'inventory_report',
      'report': 'inventory_report',
      'purchase_return': 'purchase_return',
      'stocks_return': 'stocks_return'
    };

    const targetModule = permMap[normalizedType];
    if (targetModule && typeof window.can === 'function') {
      if (!window.can(targetModule, 'view')) {
        if (typeof window.showToast === 'function') {
          window.showToast('You do not have permission to view or print this document.', true);
        } else {
          alert('Access denied: You do not have permission to print this document.');
        }
        return;
      }
    }

    // Initial loading placeholder in items table
    const itemsTbody = document.getElementById('receiptItemsBody');
    if (itemsTbody) {
      itemsTbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2" role="status"></span>Loading document preview...</td></tr>';
    }

    // Show modal instance
    if (window.bootstrap && bootstrap.Modal) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } else if (typeof window.openModal === 'function') {
      window.openModal('receiptModal');
    }

    try {
      const docPayload = await resolveDocumentData(normalizedType, dataOrId);
      renderStandardizedReceipt(docPayload);
    } catch (err) {
      console.error('Error loading receipt data:', err);
      if (itemsTbody) {
        itemsTbody.innerHTML = '<tr><td colspan="5" class="text-center py-3 text-danger"><i class="bi bi-exclamation-triangle me-1"></i>Unable to load document details.</td></tr>';
      }
    }
  }

  /**
   * Resolves raw data or fetches via API
   */
  async function resolveDocumentData(type, dataOrId) {
    const isObject = typeof dataOrId === 'object' && dataOrId !== null;
    let raw = isObject ? Object.assign({}, dataOrId) : { id: dataOrId };
    const apiBase = (typeof API !== 'undefined') ? API : 'api/';

    if (type === 'stock_releasing' || type === 'sale' || type === 'releasing') {
      const relId = raw.releasing_id || raw.transaction_id || raw.id;
      let items = raw.items || [];
      if (!items || items.length === 0) {
        if (relId) {
          const res = await axios.get(apiBase + 'stock_releasing.php?mode=detail&releasing_id=' + encodeURIComponent(relId));
          if (res.status === 200 && res.data && res.data.data) {
            items = res.data.data;
          }
        }
      }
      return {
        docType: 'stock_releasing',
        modalTitle: 'Print Stock Releasing Receipt',
        docTitle: 'STOCK RELEASING RECEIPT',
        refNo: raw.reference_no || (relId ? 'REL-' + String(relId).padStart(4, '0') : 'REL-0001'),
        issuedDate: formatDateTime(raw.created_at || raw.date || raw.releasing_date),
        dateLabel: 'Date Released',
        dateValue: formatDateOnly(raw.releasing_date || raw.date || raw.created_at || new Date()),
        partyLabel: 'Released To',
        partyValue: raw.requested_by || raw.customer_name || 'Main Store (zhenmar macabenlar)',
        userLabel: 'Released By',
        userValue: raw.released_by || raw.user_name || (window.authUser ? (window.authUser.first_name + ' ' + window.authUser.last_name) : 'christian andig'),
        status: raw.status || 'Completed',
        remarks: raw.remarks || raw.notes || 'This stock releasing receipt serves as proof of item release from the warehouse.',
        items: items,
        hasPrices: true,
        totalAmount: raw.total_amount || raw.total_cost || null,
        totalLabel: 'Total Amount'
      };
    }

    if (type === 'stock_receiving' || type === 'receiving') {
      const rcvId = raw.receiving_id || raw.id;
      if (rcvId && (!raw.items || raw.items.length === 0)) {
        const res = await axios.get(apiBase + 'stock_receiving.php?receiving_id=' + encodeURIComponent(rcvId));
        if (res.status === 200 && res.data && res.data.data) {
          raw = Object.assign(raw, res.data.data);
        }
      }
      const poCode = raw.po_code || (raw.po_id ? 'PO-' + String(raw.po_id).padStart(4, '0') : '');
      const drStr = raw.dr_number ? 'DR: ' + raw.dr_number : '';
      return {
        docType: 'stock_receiving',
        modalTitle: 'Print Stock Receiving Receipt',
        docTitle: 'GOODS RECEIPT NOTE (GRN)',
        refNo: raw.receiving_code || (rcvId ? 'RCV-' + String(rcvId).padStart(4, '0') : 'RCV-0001'),
        issuedDate: formatDateTime(raw.created_at || raw.receiving_date),
        dateLabel: 'Date Received',
        dateValue: formatDateOnly(raw.receiving_date || raw.order_date || new Date()),
        extraLeft: (poCode || drStr) ? { label: 'Linked PO / DR', value: [poCode, drStr].filter(Boolean).join(' | ') } : null,
        partyLabel: 'Supplier / Vendor',
        partyValue: raw.supplier_name || 'Authorized Supplier',
        userLabel: 'Verified & Received By',
        userValue: raw.received_by || raw.verified_by || (window.authUser ? (window.authUser.first_name + ' ' + window.authUser.last_name) : 'Warehouse Staff'),
        status: raw.status || raw.po_status || 'Received',
        remarks: raw.inspection_notes || raw.notes || 'Official proof of goods receipt and inspection verification at GymWorx Warehouse.',
        items: raw.items || [],
        hasPrices: true,
        priceHeader: 'Unit Cost',
        qtyKey: 'quantity_received',
        totalAmount: raw.total_cost || raw.total_amount || null,
        totalLabel: 'Total Amount'
      };
    }

    if (type === 'purchase_order' || type === 'po') {
      const poId = raw.po_id || raw.id;
      if (poId && (!raw.items || raw.items.length === 0)) {
        const res = await axios.get(apiBase + 'purchase_order.php?mode=full&po_id=' + encodeURIComponent(poId));
        if (res.status === 200 && res.data && res.data.data) {
          raw = Object.assign(raw, res.data.data);
        }
      }
      return {
        docType: 'purchase_order',
        modalTitle: 'Print Purchase Order',
        docTitle: 'OFFICIAL PURCHASE ORDER',
        refNo: raw.po_code || (poId ? 'PO-' + String(poId).padStart(4, '0') : 'PO-0001'),
        issuedDate: formatDateTime(raw.created_at || raw.order_date),
        dateLabel: 'Order Date',
        dateValue: formatDateOnly(raw.order_date || raw.date || new Date()),
        extraLeft: raw.pr_code ? { label: 'Source PR Ref', value: raw.pr_code } : null,
        partyLabel: 'Supplier / Vendor',
        partyValue: raw.supplier_name || 'Vendor',
        userLabel: 'Prepared By',
        userValue: raw.ordered_by || raw.created_by || (window.authUser ? (window.authUser.first_name + ' ' + window.authUser.last_name) : 'Purchasing Officer'),
        status: raw.status || 'Ordered',
        remarks: raw.notes || raw.remarks || 'This purchase order is an authorized procurement order from GymWorx Warehouse.',
        items: raw.items || [],
        hasPrices: true,
        priceHeader: 'Unit Cost',
        qtyKey: 'quantity_ordered',
        totalAmount: raw.total_cost || raw.total_amount || null,
        totalLabel: 'Total Order Value'
      };
    }

    if (type === 'purchase_request' || type === 'pr') {
      const prId = raw.pr_id || raw.request_id || raw.id;
      if (prId && (!raw.items || raw.items.length === 0)) {
        const res = await axios.get(apiBase + 'purchase_request.php?mode=detail&pr_id=' + encodeURIComponent(prId));
        if (res.status === 200 && res.data && res.data.data) {
          raw = Object.assign(raw, res.data.data);
        }
      }
      return {
        docType: 'purchase_request',
        modalTitle: 'Print Purchase Request',
        docTitle: 'PURCHASE REQUEST',
        refNo: raw.pr_code || (prId ? 'PR-' + String(prId).padStart(4, '0') : 'PR-0001'),
        issuedDate: formatDateTime(raw.created_at || raw.request_date),
        dateLabel: 'Date Requested',
        dateValue: formatDateOnly(raw.request_date || raw.created_at || new Date()),
        partyLabel: 'Department / Store',
        partyValue: raw.department || raw.store_name || 'Main Warehouse',
        userLabel: 'Requested By',
        userValue: raw.requester_name || raw.requester || (window.authUser ? (window.authUser.first_name + ' ' + window.authUser.last_name) : 'Requester'),
        status: raw.status || 'Approved',
        remarks: raw.purpose || raw.remarks || 'Official purchase requisition for inventory stock replenishment.',
        items: raw.items || [],
        hasPrices: true,
        priceHeader: 'Est. Unit Cost',
        qtyKey: 'quantity_requested',
        totalAmount: raw.total_estimated_cost || raw.total_cost || null,
        totalLabel: 'Total Est. Cost'
      };
    }

    if (type === 'adjustment') {
      const adjId = raw.adjustment_detail_id || raw.adjustment_id || raw.id;
      return {
        docType: 'adjustment',
        modalTitle: 'Print Stock Adjustment',
        docTitle: 'STOCK ADJUSTMENT RECEIPT',
        refNo: raw.reference_no || (adjId ? 'ADJ-' + String(adjId).padStart(4, '0') : 'ADJ-0001'),
        issuedDate: formatDateTime(raw.created_at || raw.adjustment_date),
        dateLabel: 'Adjustment Date',
        dateValue: formatDateOnly(raw.adjustment_date || raw.created_at || new Date()),
        partyLabel: 'Adjustment Type',
        partyValue: raw.adjustment_type || 'Stock Adjustment',
        userLabel: 'Adjusted By',
        userValue: raw.adjusted_by || raw.processed_by || (window.authUser ? (window.authUser.first_name + ' ' + window.authUser.last_name) : 'Warehouse Staff'),
        status: raw.status || 'Recorded',
        remarks: raw.reason || 'Manual inventory quantity calibration recorded in the system ledger.',
        items: raw.items || [raw],
        hasPrices: false,
        totalLabel: 'Total Adjusted Qty'
      };
    }

    if (type === 'inventory_report' || type === 'report') {
      let items = raw.items || [];
      if (!items || items.length === 0) {
        if (window.cache && window.cache.products && window.cache.products.length > 0) {
          items = window.cache.products;
        } else {
          const res = await axios.get(apiBase + 'product.php');
          if (res.status === 200 && res.data && res.data.data) {
            items = res.data.data;
          }
        }
      }
      return {
        docType: 'inventory_report',
        modalTitle: 'Print Inventory Report',
        docTitle: 'INVENTORY VALUATION & STOCK REPORT',
        refNo: 'INV-' + new Date().toISOString().slice(0, 10).replace(/-/g, ''),
        issuedDate: formatDateTime(),
        dateLabel: 'Report Date',
        dateValue: formatDateOnly(new Date()),
        partyLabel: 'Scope & Filter',
        partyValue: raw.scope || 'All Warehouse Categories',
        userLabel: 'Generated By',
        userValue: window.authUser ? (window.authUser.first_name + ' ' + window.authUser.last_name) : 'Inventory Supervisor',
        status: 'Active Stock',
        remarks: 'Official warehouse inventory valuation and health report generated from verified database records.',
        items: items,
        hasPrices: true,
        priceHeader: 'Unit Cost',
        qtyKey: 'current_stock',
        priceKey: 'unit_cost',
        totalLabel: 'Total Valuation'
      };
    }

    // Default fallback
    return {
      docType: 'document',
      modalTitle: 'Print Document Receipt',
      docTitle: 'WAREHOUSE DOCUMENT RECEIPT',
      refNo: raw.ref_no || 'DOC-0001',
      issuedDate: formatDateTime(),
      dateLabel: 'Transaction Date',
      dateValue: formatDateOnly(new Date()),
      partyLabel: 'Entity',
      partyValue: raw.party || 'Authorized Recipient',
      userLabel: 'Processed By',
      userValue: window.authUser ? (window.authUser.first_name + ' ' + window.authUser.last_name) : 'Warehouse Staff',
      status: raw.status || 'Completed',
      remarks: raw.remarks || 'Official computer-generated receipt from GymWorx Warehouse.',
      items: raw.items || [],
      hasPrices: true,
      totalLabel: 'Total Amount'
    };
  }

  /**
   * Renders the standardized layout inside the receipt modal
   */
  function renderStandardizedReceipt(doc) {
    // Header
    const modalTitleText = document.getElementById('receiptModalTitleText');
    if (modalTitleText) modalTitleText.textContent = doc.modalTitle || 'Print Receipt';

    // Document Titles & Badges
    const docTitle = document.getElementById('receiptDocTypeTitle');
    if (docTitle) docTitle.textContent = doc.docTitle || 'RECEIPT';

    const refBadge = document.getElementById('receiptRefNoBadge');
    if (refBadge) refBadge.textContent = doc.refNo || '-';

    const issuedDate = document.getElementById('receiptIssuedDate');
    if (issuedDate) issuedDate.textContent = doc.issuedDate || formatDateTime();

    // Left Card
    const dateLabel = document.getElementById('receiptDateLabel');
    if (dateLabel) dateLabel.textContent = doc.dateLabel || 'Date';

    const dateVal = document.getElementById('receiptDateValue');
    if (dateVal) dateVal.textContent = doc.dateValue || '-';

    const refLabel = document.getElementById('receiptRefLabel');
    if (refLabel) refLabel.textContent = 'Reference No.';

    const refVal = document.getElementById('receiptRefValue');
    if (refVal) refVal.textContent = doc.refNo || '-';

    const extraLeftWrap = document.getElementById('receiptExtraLeftWrap');
    if (extraLeftWrap) {
      if (doc.extraLeft) {
        extraLeftWrap.style.display = 'block';
        const elLabel = document.getElementById('receiptExtraLeftLabel');
        const elVal = document.getElementById('receiptExtraLeftValue');
        if (elLabel) elLabel.textContent = doc.extraLeft.label;
        if (elVal) elVal.textContent = doc.extraLeft.value;
      } else {
        extraLeftWrap.style.display = 'none';
      }
    }

    // Right Card
    const partyLabel = document.getElementById('receiptPartyLabel');
    if (partyLabel) partyLabel.textContent = doc.partyLabel || 'Party';

    const partyVal = document.getElementById('receiptPartyValue');
    if (partyVal) partyVal.textContent = doc.partyValue || '-';

    const userLabel = document.getElementById('receiptUserLabel');
    if (userLabel) userLabel.textContent = doc.userLabel || 'Processed By';

    const userVal = document.getElementById('receiptUserValue');
    if (userVal) userVal.textContent = doc.userValue || '-';

    const statusVal = document.getElementById('receiptStatusValue');
    if (statusVal) {
      const st = doc.status || 'Completed';
      const isGreen = /completed|approved|received|active|issued/i.test(st);
      const isRed = /rejected|cancelled|closed/i.test(st);
      const iconClass = isGreen ? 'bi-check-circle-fill' : (isRed ? 'bi-x-circle-fill' : 'bi-clock-history');
      const textClass = isGreen ? 'text-success' : (isRed ? 'text-danger' : 'text-warning');
      statusVal.className = 'gw-receipt-value ' + textClass;
      statusVal.innerHTML = `<i class="bi ${iconClass} me-1"></i>${escapeHtmlStr(st)}`;
    }

    // Table Column Headers
    const colPrice = document.getElementById('receiptColPrice');
    const colSubtotal = document.getElementById('receiptColSubtotal');
    if (colPrice) colPrice.textContent = doc.priceHeader || 'Unit Price';
    if (colPrice) colPrice.style.display = doc.hasPrices ? '' : 'none';
    if (colSubtotal) colSubtotal.style.display = doc.hasPrices ? '' : 'none';

    // Populate Items
    const itemsTbody = document.getElementById('receiptItemsBody');
    if (!itemsTbody) return;
    itemsTbody.innerHTML = '';

    let totalQty = 0;
    let grandTotal = 0;

    const items = doc.items || [];
    if (items.length === 0) {
      itemsTbody.innerHTML = `<tr><td colspan="${doc.hasPrices ? 5 : 3}" class="text-center py-3 text-muted fst-italic">No line items recorded for this document.</td></tr>`;
    } else {
      items.forEach(function (item, idx) {
        const tr = document.createElement('tr');

        // Extract qty
        let qty = 0;
        if (doc.qtyKey && item[doc.qtyKey] !== undefined) {
          qty = parseInt(item[doc.qtyKey], 10) || 0;
        } else {
          qty = parseInt(item.quantity || item.quantity_released || item.quantity_received || item.quantity_ordered || item.current_stock || 0, 10);
        }
        totalQty += isNaN(qty) ? 0 : qty;

        // Extract price
        const priceKey = doc.priceKey || (item.unit_cost !== undefined ? 'unit_cost' : (item.unit_price !== undefined ? 'unit_price' : 'cost'));
        const unitPrice = parseFloat(item[priceKey] || item.unit_price || item.unit_cost || 0);
        const subtotal = qty * unitPrice;
        grandTotal += isNaN(subtotal) ? 0 : subtotal;

        const pName = item.product_name || (typeof productName === 'function' && item.product_id ? productName(item.product_id) : ('Item #' + (idx + 1)));

        let extraMeta = '';
        if (item.sku) {
          extraMeta += `<span class="badge bg-light text-dark border me-1">${escapeHtmlStr(item.sku)}</span>`;
        }
        if (item.category_name) {
          extraMeta += `<span class="text-muted small">${escapeHtmlStr(item.category_name)}</span>`;
        }
        if (item.adjustment_type) {
          extraMeta += `<span class="badge bg-secondary me-1">${escapeHtmlStr(item.adjustment_type)}</span>`;
        }

        if (doc.hasPrices) {
          tr.innerHTML = `
            <td class="text-center text-muted small">${idx + 1}</td>
            <td>
              <div class="fw-semibold text-dark text-break">${escapeHtmlStr(pName)}</div>
              ${extraMeta ? `<div class="mt-1">${extraMeta}</div>` : ''}
            </td>
            <td class="text-center font-monospace fw-medium">${qty}</td>
            <td class="text-end font-monospace text-nowrap">${formatPeso(unitPrice)}</td>
            <td class="text-end font-monospace text-nowrap fw-bold">${formatPeso(subtotal)}</td>
          `;
        } else {
          tr.innerHTML = `
            <td class="text-center text-muted small">${idx + 1}</td>
            <td>
              <div class="fw-semibold text-dark text-break">${escapeHtmlStr(pName)}</div>
              ${extraMeta ? `<div class="mt-1">${extraMeta}</div>` : ''}
            </td>
            <td class="text-center font-monospace fw-medium">${qty}</td>
          `;
        }
        itemsTbody.appendChild(tr);
      });
    }

    // Remarks
    const remarksEl = document.getElementById('receiptRemarksText');
    if (remarksEl) remarksEl.textContent = doc.remarks || 'This document serves as proof of transaction from GymWorx Warehouse.';

    // Totals Card
    const totalLabelEl = document.getElementById('receiptTotalLabel');
    if (totalLabelEl) totalLabelEl.textContent = doc.totalLabel || (doc.hasPrices ? 'Total Amount' : 'Total Quantity');

    const totalValEl = document.getElementById('receiptTotalValue');
    if (totalValEl) {
      if (doc.hasPrices) {
        const finalVal = (doc.totalAmount !== null && doc.totalAmount !== undefined && !isNaN(parseFloat(doc.totalAmount)))
          ? parseFloat(doc.totalAmount)
          : grandTotal;
        totalValEl.textContent = formatPeso(finalVal);
      } else {
        totalValEl.textContent = totalQty.toLocaleString('en-US') + ' units';
      }
    }
  }

  /**
   * Browser Native Print Trigger
   */
  function printReceiptDoc() {
    window.print();
  }

  /**
   * Download PDF using html2pdf with meaningful filename pattern
   */
  function downloadReceiptPdf() {
    const element = document.getElementById('receiptPrintArea');
    if (!element) {
      window.print();
      return;
    }

    const refNoEl = document.getElementById('receiptRefNoBadge');
    const typeTitleEl = document.getElementById('receiptDocTypeTitle');
    const rawRef = refNoEl ? refNoEl.textContent.trim().replace(/[^a-zA-Z0-9_-]/g, '_') : 'Receipt';
    const rawType = typeTitleEl ? typeTitleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_') : 'Document';
    const fileName = `GymWorx_${rawType}_${rawRef}.pdf`;

    if (window.html2pdf) {
      const opt = {
        margin: [10, 10, 10, 10],
        filename: fileName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      if (typeof window.showToast === 'function') {
        window.showToast('Generating PDF document...', false);
      }

      html2pdf().set(opt).from(element).save().catch(function (err) {
        console.error('PDF generation error, falling back to print dialog:', err);
        window.print();
      });
    } else {
      window.print();
    }
  }

  // Export functions globally
  window.openReceiptModal = openReceiptModal;
  window.printReceiptDoc = printReceiptDoc;
  window.downloadReceiptPdf = downloadReceiptPdf;
  window.downloadInventoryReportPdf = function () {
    const element = document.getElementById('inventoryReportPrintArea');
    if (!element) {
      window.print();
      return;
    }
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fileName = `GymWorx_Inventory_Report_${dateStr}.pdf`;

    if (window.html2pdf) {
      const opt = {
        margin: [8, 8, 8, 8],
        filename: fileName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };

      if (typeof window.showToast === 'function') {
        window.showToast('Generating PDF document...', false);
      }

      html2pdf().set(opt).from(element).save().catch(function (err) {
        console.error('PDF generation error:', err);
        window.print();
      });
    } else {
      window.print();
    }
  };

  // Bridge openInventoryReportModal to the unified modal
  window.openInventoryReportModal = function () {
    openReceiptModal('inventory_report', {});
  };

})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : {});
