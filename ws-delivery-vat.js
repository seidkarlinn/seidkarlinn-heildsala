/* ws-delivery-vat.js — Afhendingarlisti: "VSK kr." per unit, not per line
   ---------------------------------------------------------------------------
   generateDeliveryNote() in index.html printed the whole line's VSK in the
   "VSK kr." column (e.g. 28 × honey → 4.978), right next to the per-unit
   Einingarverð, so the row read as 4.978 kr VSK per jar. The column now shows
   VSK per unit (4.978 / 28 ≈ 178). Line totals and "Samtals VSK" are
   untouched — they come from separate fields.
   Wrapped from here because index.html is too large for the GitHub connector.
   (2026-09-24) */
(function () {
  function install() {
    var fn = window.generateDeliveryNote;
    if (typeof fn !== 'function' || fn._wsUnitVat) return;
    var w = function (data) {
      try {
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
