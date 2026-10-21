/* ws-order-edit.js — Pantanir: admin getur eytt vörulínum og breytt magni
   ---------------------------------------------------------------------------
   Bætir "✎ Breyta" við Vörur-kassann í útfelldri pöntun (admin → Pantanir).
   Í breytingaham: − / magn / + á hverri línu, 🗑 eyðir línu (↺ afturkallar),
   ný upphæð reiknuð jafnóðum. "Vista breytingar":
     1. sækir nýjasta ws_orders af netþjóni (svo nýjar pantanir glatist ekki),
     2. uppfærir items + total á þessari einu pöntun, skráir o.edits[],
        geymir o.origItems / o.origTotal við fyrstu breytingu,
     3. force-ýtir (eins og setStatus) → ws_orders_lm stimplast og kaupandinn
        fær breytta pöntun (Pantanir, Afhendingarlistar, PDF, Regla-útflutningur).
   total = gamla total − (gömul línusumma) + (ný línusumma), svo annað sem
   kann að vera í total (t.d. sending) helst óbreytt.
   "+ Bæta við vöru": leit í vörulista með verði KAUPANDANS (applyPricingOverrides
   keyrt tímabundið sem viðkomandi kaupandi, svo flokka-/fastir afslættir gildi).
   Kaupandinn sér athugasemd "✎ Seiðkarlinn breytti pöntuninni …".
   Vafið hér af því index.html er of stórt fyrir GitHub-connectorinn.
   (2026-10-20) */
(function () {
  if (window._wsOrderEdit) return;
  window._wsOrderEdit = true;

  var openRows = new Set();   // útfelldar pantanir haldast opnar eftir re-render
  var edit = null;            // { id, items:[{...,_origQty,_removed}] }

  function E(s) { return (typeof esc === 'function') ? esc(s) : String(s); }
  function ISK(n) { return (typeof fmtISK === 'function') ? fmtISK(n) : (Math.round(n) + ' ISK'); }
  function num(str) { return parseInt(String(str || '').replace(/[^\d]/g, ''), 10) || 0; }
  function lineSum(items) {
    return (items || []).reduce(function (s, it) { return s + (parseInt(it.qty, 10) || 0) * num(it.price); }, 0);
  }
  function orders() { try { return (typeof getOrders === 'function') ? getOrders() : JSON.parse(localStorage.getItem('ws_orders') || '[]'); } catch (e) { return []; } }
  function findOrder(id) { return orders().find(function (x) { return x && x.id === id; }); }
  function toast(m) { if (typeof showToast === 'function') showToast(m, 3000); }
  function when(iso, opts) { try { return new Date(iso).toLocaleDateString('is-IS', opts); } catch (e) { return ''; } }

  // Vörulisti með verði tiltekins kaupanda: keyrir applyPricingOverrides() (með
  // öllum wrappers: flat-discounts, Cordyfresh, Hunang40, lager…) eins og
  // kaupandinn sé innskráður, tekur afrit og skilar admin-stöðunni aftur.
  function catalogFor(buyer) {
    var role = localStorage.getItem('ws_role'), auth = localStorage.getItem('ws_auth');
    var list = [];
    try {
      if (buyer) { localStorage.setItem('ws_role', 'buyer'); localStorage.setItem('ws_auth', String(buyer).toLowerCase()); }
      if (typeof window.applyPricingOverrides === 'function') window.applyPricingOverrides();
      list = (window.PRODUCTS || []).map(function (p) {
        return { name: p.name, price: p.wholesale || p.price, retail: p.price, sku: p.sku, cat: p.cat, inStock: p.inStock, img: p.img };
      });
    } catch (e) { console.warn('[ws-order-edit] catalog', e); }
    finally {
      if (role === null) localStorage.removeItem('ws_role'); else localStorage.setItem('ws_role', role);
      if (auth === null) localStorage.removeItem('ws_auth'); else localStorage.setItem('ws_auth', auth);
      try { if (typeof window.applyPricingOverrides === 'function') window.applyPricingOverrides(); } catch (e) {}
    }
    return list.filter(function (p) { return p.name && num(p.price) > 0; });
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  var BTN = 'width:24px;height:24px;border:1px solid var(--paper3);background:var(--paper);border-radius:4px;cursor:pointer;font-size:13px;line-height:1;color:var(--ink);padding:0';

  function boxHTML(o) {
    var id = E(o.id);
    var ed = edit && edit.id === o.id ? edit : null;
    if (!ed) {
      var last = (o.edits || []).length ? o.edits[o.edits.length - 1] : null;
      return '' +
        '<div class="od-box-title" style="display:flex;justify-content:space-between;align-items:center">' +
          '<span>Vörur (' + (o.items || []).length + ')</span>' +
          '<button class="fulfill-btn" onclick="event.stopPropagation();wsOrdEdit.start(\'' + id + '\')" ' +
            'style="background:var(--paper2);color:var(--ink);border:1px solid var(--paper3)">✎ Breyta</button>' +
        '</div>' +
        (o.items || []).map(function (it) {
          return '<div class="od-item-row"><span>' + E(it.name) + '</span>' +
            '<span style="color:var(--ink3)">' + it.qty + ' × ' + E(it.price || '') + '</span></div>';
        }).join('') +
        (last ? '<div class="od-note" style="color:var(--ink3);margin-top:8px">✎ Breytt ' +
          when(last.at, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) +
          (o.origTotal ? ' · upphafleg upphæð ' + ISK(o.origTotal) : '') + '</div>' : '');
    }

    var kept = ed.items.filter(function (it) { return !it._removed && (parseInt(it.qty, 10) || 0) > 0; });
    var newTotal = Math.round((o.total || 0) - lineSum(o.items) + lineSum(kept));
    return '' +
      '<div class="od-box-title">Breyta vörum (' + kept.length + ' af ' + ed.items.length + ')</div>' +
      ed.items.map(function (it, i) {
        var q = parseInt(it.qty, 10) || 0;
        var changed = !it._removed && q !== it._origQty;
        var nameStyle = 'flex:1;' + (it._removed ? 'text-decoration:line-through;' : '') + (changed ? 'color:var(--ink);font-weight:600;' : '');
        var right = it._removed
          ? '<button onclick="event.stopPropagation();wsOrdEdit.restore(' + i + ')" style="' + BTN + ';width:auto;padding:0 8px;font-size:11px">↺ Afturkalla</button>'
          : '<span style="display:inline-flex;align-items:center;gap:4px" onclick="event.stopPropagation()">' +
              '<button onclick="wsOrdEdit.step(' + i + ',-1)" style="' + BTN + '">−</button>' +
              '<input type="number" min="0" value="' + q + '" onchange="wsOrdEdit.set(' + i + ',this.value)" ' +
                'style="width:52px;height:24px;text-align:center;border:1px solid var(--paper3);border-radius:4px;font-size:12px;font-family:var(--sans);background:var(--paper);color:var(--ink)">' +
              '<button onclick="wsOrdEdit.step(' + i + ',1)" style="' + BTN + '">+</button>' +
            '</span>' +
            '<span style="color:var(--ink3);min-width:78px;text-align:right">× ' + E(it.price || '') + '</span>' +
            '<button onclick="event.stopPropagation();wsOrdEdit.remove(' + i + ')" title="Eyða vörulínu" ' +
              'style="' + BTN + ';color:#dc2626;border-color:rgba(220,38,38,.3);background:#fee2e2">🗑</button>';
        return '<div class="od-item-row" style="align-items:center;gap:8px;' + (it._removed ? 'opacity:.45;' : '') + '">' +
          '<span style="' + nameStyle + '">' + (it._added ? '<span style="font-size:10px;font-weight:600;color:#fff;background:var(--green);border-radius:3px;padding:1px 5px;margin-right:6px">NÝ</span>' : '') + E(it.name) + '</span>' + right + '</div>';
      }).join('') +
      '<div style="margin-top:10px;position:relative" onclick="event.stopPropagation()">' +
        '<input type="text" id="wsOrdAddQ" placeholder="+ Bæta við vöru — leita eftir heiti eða vörunúmeri…" autocomplete="off" ' +
          'oninput="wsOrdEdit.search(this.value)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();wsOrdEdit.pickFirst();}" ' +
          'style="width:100%;box-sizing:border-box;height:32px;padding:0 10px;border:1.5px dashed var(--paper3);border-radius:var(--rs);font-size:12px;font-family:var(--sans);background:var(--paper);color:var(--ink)">' +
        '<div id="wsOrdAddRes" style="display:flex;flex-direction:column;margin-top:4px"></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12px;color:var(--ink2)">' +
        '<span>Ný upphæð</span><span><b style="color:var(--green)">' + ISK(newTotal) + '</b>' +
        (newTotal !== (o.total || 0) ? ' <span style="color:var(--ink3)">(var ' + ISK(o.total || 0) + ')</span>' : '') + '</span>' +
      '</div>' +
      (o.teyaSessionId ? '<div class="od-note" style="color:#B45309;margin-top:6px">⚠️ Greitt með korti — lækkun endurgreiðist ekki sjálfkrafa (notaðu ↩ Endurgreiða).</div>' : '') +
      '<div style="display:flex;gap:8px;margin-top:10px" onclick="event.stopPropagation()">' +
        '<button class="adm-btn primary" id="wsOrdEditSave" onclick="wsOrdEdit.save()" style="flex:1">💾 Vista breytingar</button>' +
        '<button class="adm-btn" onclick="wsOrdEdit.cancel()">Hætta við</button>' +
      '</div>';
  }

  function itemsBox(id) {
    var row = document.getElementById('od-' + id);
    return row ? row.querySelector('.od-box') : null;
  }
  function paint(id) {
    var o = findOrder(id), box = itemsBox(id);
    if (o && box) box.innerHTML = boxHTML(o);
  }

  // ── Admin: Pantanir ───────────────────────────────────────────────────────
  function decorateAdmin() {
    orders().forEach(function (o) {
      if (!o || !o.id) return;
      var row = document.getElementById('od-' + o.id);
      if (!row) return;
      if (openRows.has(o.id)) row.style.display = 'table-row';
      var box = row.querySelector('.od-box');
      if (box) box.innerHTML = boxHTML(o);
    });
  }

  function install() {
    var origRender = window.renderOrdersPanel;
    if (typeof origRender === 'function' && !origRender._wsOrdEdit) {
      var wrapped = function () {
        // Ekki rífa niður breytingakassann meðan verið er að slá inn magn (30s poll)
        if (edit) {
          var ae = document.activeElement, box = itemsBox(edit.id);
          if (ae && box && box.contains(ae) && ae.tagName === 'INPUT') return;
        }
        var r = origRender.apply(this, arguments);
        try { decorateAdmin(); } catch (e) { console.warn('[ws-order-edit]', e); }
        return r;
      };
      wrapped._wsOrdEdit = true;
      window.renderOrdersPanel = wrapped;
    }

    if (typeof window.toggleOrdDetail === 'function' && !window.toggleOrdDetail._wsOrdEdit) {
      var t = function (id) {
        var row = document.getElementById('od-' + id);
        if (!row) return;
        var open = row.style.display === 'none';
        row.style.display = open ? 'table-row' : 'none';
        if (open) openRows.add(id); else openRows.delete(id);
      };
      t._wsOrdEdit = true;
      window.toggleOrdDetail = t;
    }

    var origBuyer = window.renderBuyerOrdersPanel;
    if (typeof origBuyer === 'function' && !origBuyer._wsOrdEdit) {
      var wb = function () {
        var r = origBuyer.apply(this, arguments);
        try { decorateBuyer(); } catch (e) { console.warn('[ws-order-edit]', e); }
        return r;
      };
      wb._wsOrdEdit = true;
      window.renderBuyerOrdersPanel = wb;
    }

    // Ef Pantanir er þegar opið þegar skriftan hleðst
    var p = document.getElementById('panelOrders');
    if (p && p.querySelector('tr.expand-detail')) decorateAdmin();
  }

  // ── Kaupandi: athugasemd um breytingu ─────────────────────────────────────
  function decorateBuyer() {
    orders().forEach(function (o) {
      if (!o || !o.id || !(o.edits || []).length) return;
      var row = document.getElementById('bod-' + o.id);
      if (!row || row.querySelector('.ws-edit-note')) return;
      var boxes = row.querySelectorAll('.od-box');
      var info = boxes[1] || boxes[0];
      if (!info) return;
      var last = o.edits[o.edits.length - 1];
      var changes = [];
      o.edits.forEach(function (e) { (e.changes || []).forEach(function (c) { changes.push(c); }); });
      var note = document.createElement('div');
      note.className = 'od-note ws-edit-note';
      note.style.color = '#B45309';
      note.innerHTML = '✎ Seiðkarlinn breytti pöntuninni ' + when(last.at, { day: '2-digit', month: 'short' }) +
        (o.origTotal ? ' (upphaflega ' + ISK(o.origTotal) + ')' : '') + ': ' +
        changes.map(function (c) { return E(c.name) + (!c.from ? ' bætt við (' + c.to + ')' : c.to ? ' ' + c.from + '→' + c.to : ' fjarlægð'); }).join(', ');
      var btnWrap = info.querySelector('.adm-btn') ? info.querySelector('.adm-btn').parentNode : null;
      if (btnWrap && btnWrap.parentNode === info) info.insertBefore(note, btnWrap); else info.appendChild(note);
    });
  }

  // ── Aðgerðir ──────────────────────────────────────────────────────────────
  var api = {
    start: function (id) {
      var o = findOrder(id);
      if (!o) return;
      var prev = edit && edit.id;
      edit = {
        id: id,
        items: (o.items || []).map(function (it) {
          return Object.assign({}, it, { _origQty: parseInt(it.qty, 10) || 0, _removed: false });
        }),
        catalog: null,
        buyer: o.buyerUser || o.buyerEmail || ''
      };
      if (prev && prev !== id) paint(prev);
      paint(id);
    },
    cancel: function () { var id = edit && edit.id; edit = null; if (id) paint(id); },
    step: function (i, d) {
      var it = edit && edit.items[i]; if (!it) return;
      it.qty = Math.max(0, (parseInt(it.qty, 10) || 0) + d);
      if (it.qty === 0) it._removed = true;
      paint(edit.id);
    },
    set: function (i, v) {
      var it = edit && edit.items[i]; if (!it) return;
      it.qty = Math.max(0, parseInt(v, 10) || 0);
      if (it.qty === 0) it._removed = true;
      paint(edit.id);
    },
    remove: function (i) {
      var it = edit && edit.items[i]; if (!it) return;
      if (it._added) edit.items.splice(i, 1); else it._removed = true;
      paint(edit.id);
    },
    _hits: [],
    search: function (q) {
      var res = document.getElementById('wsOrdAddRes');
      if (!edit || !res) return;
      q = norm(q).trim();
      if (q.length < 2) { res.innerHTML = ''; api._hits = []; return; }
      if (!edit.catalog) edit.catalog = catalogFor(edit.buyer);
      var words = q.split(/\s+/);
      var hits = edit.catalog.filter(function (p) {
        var h = norm(p.name + ' ' + (p.sku || '') + ' ' + (p.cat || ''));
        return words.every(function (w) { return h.indexOf(w) !== -1; });
      }).slice(0, 8);
      api._hits = hits;
      res.innerHTML = hits.length ? hits.map(function (p, k) {
        return '<button type="button" onclick="event.stopPropagation();wsOrdEdit.add(' + k + ')" ' +
          'style="display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;text-align:left;padding:6px 8px;border:none;border-bottom:1px solid var(--paper3);background:var(--paper2);cursor:pointer;font-size:12px;font-family:var(--sans);color:var(--ink)">' +
          '<span>' + E(p.name) + (p.sku ? ' <span style="color:var(--ink3);font-size:10px">#' + E(p.sku) + '</span>' : '') +
          (p.inStock === false ? ' <span style="color:#dc2626;font-size:10px">uppselt</span>' : '') + '</span>' +
          '<span style="color:var(--green);white-space:nowrap">' + E(p.price) + '</span></button>';
      }).join('') : '<div style="font-size:11px;color:var(--ink3);padding:6px 2px">Engin vara fannst</div>';
    },
    pickFirst: function () { if (api._hits.length) api.add(0); },
    add: function (k) {
      var p = api._hits[k]; if (!edit || !p) return;
      var ex = edit.items.find(function (it) { return it.name === p.name; });
      if (ex) {
        if (ex._removed) { ex._removed = false; ex.qty = ex._origQty || 1; }
        else ex.qty = (parseInt(ex.qty, 10) || 0) + 1;
      } else {
        var item = { name: p.name, qty: 1, price: p.price, _origQty: 0, _removed: false, _added: true };
        if (p.sku) item.sku = p.sku;
        edit.items.push(item);
      }
      api._hits = [];
      paint(edit.id);
      var inp = document.getElementById('wsOrdAddQ'); if (inp) inp.focus();
    },
    restore: function (i) {
      var it = edit && edit.items[i]; if (!it) return;
      it._removed = false;
      if (!((parseInt(it.qty, 10) || 0) > 0)) it.qty = it._origQty || 1;
      paint(edit.id);
    },
    save: async function () {
      if (!edit) return;
      var ed = edit;
      var kept = ed.items.filter(function (it) { return !it._removed && (parseInt(it.qty, 10) || 0) > 0; });
      if (!kept.length) { toast('Pöntun verður að hafa a.m.k. eina vöru — notaðu ✕ til að hætta við pöntunina.'); return; }
      var changes = [];
      ed.items.forEach(function (it) {
        var q = parseInt(it.qty, 10) || 0;
        if (it._removed || q === 0) changes.push({ name: it.name, from: it._origQty, to: 0 });
        else if (q !== it._origQty) changes.push({ name: it.name, from: it._origQty, to: q });
      });
      if (!changes.length) { api.cancel(); return; }
      var sb = document.getElementById('wsOrdEditSave');
      if (sb) { sb.disabled = true; sb.textContent = 'Vista…'; }

      // Grunnur: nýjasti listi af netþjóni + staðbundnar pantanir sem vantar þar
      var list = orders();
      try {
        var r = await fetch('/.netlify/functions/ws-data?key=ws_orders', { cache: 'no-store' });
        var j = await r.json();
        if (j && j.ok && Array.isArray(j.value)) {
          var ids = new Set(j.value.map(function (x) { return x && x.id; }));
          list = j.value.concat(list.filter(function (x) { return x && x.id && !ids.has(x.id); }));
        }
      } catch (e) {}
      var o = list.find(function (x) { return x && x.id === ed.id; });
      if (!o) { toast('Pöntun fannst ekki'); if (sb) { sb.disabled = false; sb.textContent = '💾 Vista breytingar'; } return; }

      var oldSum = lineSum(o.items);
      var newItems = kept.map(function (it) {
        var c = Object.assign({}, it);
        delete c._origQty; delete c._removed; delete c._added;
        c.qty = parseInt(c.qty, 10) || 0;
        return c;
      });
      if (!o.origTotal) o.origTotal = o.total || 0;
      if (!o.origItems) o.origItems = (o.items || []).map(function (it) { return Object.assign({}, it); });
      o.items = newItems;
      o.total = Math.round((o.total || 0) - oldSum + lineSum(newItems));
      o.edits = (o.edits || []).concat([{ at: new Date().toISOString(), by: 'admin', changes: changes }]);

      if (window._wsReceiveFromServer) window._wsReceiveFromServer('ws_orders', JSON.stringify(list));
      else localStorage.setItem('ws_orders', JSON.stringify(list));
      var ok = false;
      try {
        var pr = await fetch('/.netlify/functions/ws-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'ws_orders', value: list, force: true })
        });
        var pj = await pr.json(); ok = !!(pj && pj.ok);
      } catch (e) {}
      edit = null;
      if (typeof window.renderOrdersPanel === 'function') window.renderOrdersPanel();
      if (typeof updatePendingBadge === 'function') { try { updatePendingBadge(); } catch (e) {} }
      toast(ok ? 'Pöntun ' + ed.id + ' uppfærð — ' + ISK(o.total)
               : '⚠️ Vistað staðbundið en ekki á netþjón — reyndu aftur');
    }
  };
  window.wsOrdEdit = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
