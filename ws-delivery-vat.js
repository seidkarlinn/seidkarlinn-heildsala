/* ws-delivery-vat.js — Afhendingarlisti: "VSK kr." per unit, not per line;
   correct payment label (reikningur vs. kort)
   ---------------------------------------------------------------------------
   generateDeliveryNote() in index.html printed the whole line's VSK in the
   "VSK kr." column (e.g. 28 × honey → 4.978), right next to the per-unit
   Einingarverð, so the row read as 4.978 kr VSK per jar. The column now shows
   VSK per unit (4.978 / 28 ≈ 178). Line totals and "Samtals VSK" are
   untouched — they come from separate fields.
   Also fixes the payment label on re-printed notes (📄 PDF in Pantanir):
   downloadOrderPDF() only called an order "Reikningsviðskipti" when its
   status was 'invoice', but invoice orders move on to pending/fulfilled, so
   every re-print said "Staðgreitt · kortagreiðsla". The real signal is the
   Teya session id: card checkouts store one, invoiceCheckout() never does.
   Wrapped from here because index.html is too large for the GitHub connector.
   (2026-09-24) */
(function () {
  function install() {
    var fn = window.generateDeliveryNote;
    if (typeof fn !== 'function' || fn._wsUnitVat) return;
    var w = function (data) {
      try {
        var o = null;
        try {
          if (data && data.invoiceNo && typeof getOrders === 'function') {
            o = (getOrders() || []).find(function (x) { return x && (x.id === data.invoiceNo || x.invoiceNo === data.invoiceNo); }) || null;
          }
        } catch (e) {}
        if (o && data) {
          data = Object.assign({}, data, {
            payLabel: o.teyaSessionId
              ? 'Staðgreitt · kortagreiðsla'
              : 'Reikningsviðskipti · greiðist innan 14 daga'
          });
        }
        if (data && Array.isArray(data.lines)) {
          data = Object.assign({}, data, {
            lines: data.lines.map(function (l) {
              var qty = parseFloat(l && l.qty) || 0;
              var lineVsk = l && (l.vsk != null ? l.vsk : l.vskAmt);
              if (!qty || lineVsk == null || isNaN(parseFloat(lineVsk))) return l;
              var per = parseFloat(lineVsk) / qty;
              return Object.assign({}, l, { vsk: per, vskAmt: per });
            })
          });
        }
      } catch (e) { console.warn('[ws-delivery-vat]', e); }
      return fn.apply(this, [data].concat([].slice.call(arguments, 1)));
    };
    w._wsUnitVat = true;
    window.generateDeliveryNote = w;
  }
  install();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  window.addEventListener('load', install);
})();
