/* ═══════════════════════════════════════════════════════════════════════════
   ws-regla-api.js — direct link to Regla (regla.is web service)
   ---------------------------------------------------------------------------
   Adds to the admin panel:
     Pantanir        "⇪ Senda í Reglu"  → each order in the chosen period is
                     saved in Regla as a DRAFT invoice (not issued), customer
                     created first if missing. Already-sent orders are skipped
                     and marked "Regla ✓" in the table.
     Viðskiptamenn   "⇪ Samstilla við Reglu" → creates every customer with a
                     kennitala that does not exist in Regla yet. Existing Regla
                     customers are never overwritten.
   Stock from Regla is applied server-side in ws-stock.js — nothing here.

   Lines use the same matching rules as the Sölusaga CSV (ws-regla-export.js),
   so the kennitala, Vörunúmer, retail price and discount match on both paths.
   All Regla credentials stay in the Netlify function /.netlify/functions/regla.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var FN = '/.netlify/functions/regla';
  var CHUNK = 8;
  var _log = null;   // { orderId: { ok, at, amount } }

  function secret() {
    try { if (typeof ADMIN_SECRET !== 'undefined') return ADMIN_SECRET; } catch (e) {}
    return 'seid_catalog_2024';
  }
  function isAdmin() {
    try { return localStorage.getItem('ws_role') === 'admin'; } catch (e) { return false; }
  }
  function toast(msg, ms) {
    if (typeof showToast === 'function') showToast(msg, ms || 4000); else console.log(msg);
  }
  function api(payload) {
    return fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': secret() },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }
  // Same matching rules as ws-regla-export.js (Sölusaga CSV): kt from the
  // order, else Viðskiptamenn by username → name → e-mail; product by exact
  // name, then loose alphanumeric match. Kept in step with that file.
  var HELPERS = (function () {
    function ktDigits(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
    function vidskmList() {
      try { if (typeof getVidskm === 'function') return getVidskm() || []; } catch (e) {}
      try { return JSON.parse(localStorage.getItem('ws_vidskm') || '[]') || []; } catch (e) {}
      return [];
    }
    function norm(x) { return String(x == null ? '' : x).trim().toLowerCase(); }
    function kennitalaFor(o) {
      var own = ktDigits(o.buyerKt);
      if (own.length === 10) return own;
      var list = vidskmList(), u = norm(o.buyerUser), n = norm(o.buyerName), e = norm(o.buyerEmail), hit = null;
      if (u) hit = list.find(function (v) { return v && norm(v.user) === u; });
      if (!hit && n) hit = list.find(function (v) { return v && norm(v.nafn) === n; });
      if (!hit && e) hit = list.find(function (v) { return v && norm(v.netfang) === e; });
      return hit ? ktDigits(hit.kt) : '';
    }
    function iskNum(v) {
      if (typeof v === 'number') return Math.round(v);
      return parseInt(String(v == null ? '' : v).replace(/[^\d]/g, ''), 10) || 0;
    }
    function findProduct(name) {
      var lists = [window.PRODUCTS, window.PRODUCTS_BASE];
      try { var c = JSON.parse(localStorage.getItem('ws_custom_products') || '[]'); if (Array.isArray(c)) lists.push(c); } catch (e) {}
      var i, hit, loose = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      for (i = 0; i < lists.length; i++) {
        if (!Array.isArray(lists[i])) continue;
        hit = lists[i].find(function (p) { return p && p.name === name; });
        if (hit) return hit;
      }
      if (!loose) return null;
      for (i = 0; i < lists.length; i++) {
        if (!Array.isArray(lists[i])) continue;
        hit = lists[i].find(function (p) { return p && String(p.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '') === loose; });
        if (hit) return hit;
      }
      return null;
    }
    function inPeriod(d, period, now) {
      if (period === 'today') return d.toDateString() === now.toDateString();
      if (period === 'week') { var w = new Date(now); w.setDate(now.getDate() - 7); return d >= w; }
      if (period === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      if (period === 'last_month') { var lm = new Date(now.getFullYear(), now.getMonth() - 1, 1); return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear(); }
      return true;
    }
    return { ktDigits: ktDigits, vidskmList: vidskmList, kennitalaFor: kennitalaFor, iskNum: iskNum, findProduct: findProduct, inPeriod: inPeriod };
  })();
  function H() { return HELPERS; }
  function escH(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ── result dialog ─────────────────────────────────────────────────────── */
  function showReport(title, rows) {
    var old = document.getElementById('wsReglaReport');
    if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'wsReglaReport';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(20,14,8,.45);display:flex;align-items:center;justify-content:center;padding:16px';
    el.innerHTML =
      '<div style="background:var(--paper,#faf6ee);color:var(--ink,#2a1f14);border-radius:12px;max-width:640px;width:100%;max-height:80vh;overflow:auto;padding:1.25rem 1.25rem 1rem;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:var(--sans,system-ui)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:.75rem">' +
          '<div style="font-family:var(--serif,Georgia);font-size:20px;font-weight:600">' + escH(title) + '</div>' +
          '<button class="adm-btn" id="wsReglaReportClose">Loka</button>' +
        '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
          rows.map(function (r) {
            var color = r.tone === 'ok' ? 'var(--green,#2f5d3a)' : r.tone === 'warn' ? '#92400E' : r.tone === 'err' ? '#B91C1C' : 'var(--ink3,#7a6a58)';
            return '<tr style="border-top:1px solid var(--paper3,#e8dfcf)">' +
              '<td style="padding:6px 8px 6px 0;white-space:nowrap;font-variant-numeric:tabular-nums">' + escH(r.key) + '</td>' +
              '<td style="padding:6px 8px;color:' + color + ';font-weight:600;white-space:nowrap">' + escH(r.label) + '</td>' +
              '<td style="padding:6px 0;color:var(--ink2,#4a3b2c)">' + (r.msgs || []).map(escH).join('<br>') + '</td></tr>';
          }).join('') +
        '</table></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) { if (e.target === el || e.target.id === 'wsReglaReportClose') el.remove(); });
  }

  /* ── orders → draft invoices ───────────────────────────────────────────── */
  function customerFor(kt) {
    var h = H(); if (!h || !kt) return null;
    var hit = h.vidskmList().find(function (v) { return v && h.ktDigits(v.kt) === kt; });
    return hit ? { kt: kt, nafn: hit.nafn, netfang: hit.netfang, simi: hit.simi, heimili: hit.heimili, postnr: hit.postnr } : null;
  }

  function buildOrder(o) {
    var h = H();
    var kt = h.kennitalaFor(o);
    return {
      id: o.id,
      date: o.date,
      kt: kt,
      note: o.note || '',
      paidByCard: !!o.teyaSessionId,
      buyerName: o.buyerName || o.buyerUser || '',
      buyerEmail: o.buyerEmail || '',
      customer: customerFor(kt),
      lines: (o.items || []).map(function (item) {
        var prod = h.findProduct(item.name);
        return {
          sku: prod && prod.sku ? String(prod.sku) : '',
          name: item.name,
          qty: parseInt(item.qty, 10) || 1,
          retail: prod ? h.iskNum(prod.price) : 0,
          paid: h.iskNum(item.price)
        };
      })
    };
  }

  function loadLog() {
    return api({ action: 'status' }).then(function (j) {
      if (j && j.ok) { _log = j.log || {}; decorateOrders(); }
      return _log;
    }).catch(function () { return _log; });
  }

  function pushOrders(btn) {
    var h = H();
    var period = (document.getElementById('exportPeriod') || {}).value || 'month';
    var now = new Date();
    var all = (typeof getOrders === 'function') ? getOrders() : [];

    loadLog().then(function (log) {
      log = log || {};
      var todo = all.filter(function (o) {
        return o && o.id && o.status !== 'cancelled' && h.inPeriod(new Date(o.date), period, now) && !(log[o.id] && log[o.id].ok && log[o.id].number);
      });
      if (!todo.length) { toast('Ekkert nýtt að senda í Reglu fyrir valið tímabil', 4000); return; }
      if (!window.confirm('Senda ' + todo.length + ' pöntun(ir) í Reglu sem drög að reikningum?')) return;

      var payload = todo.map(buildOrder);
      var results = [];
      var label = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; }

      var i = 0;
      (function next() {
        if (i >= payload.length) return done();
        if (btn) btn.innerHTML = '⏳ ' + Math.min(i + CHUNK, payload.length) + '/' + payload.length;
        var chunk = payload.slice(i, i + CHUNK); i += CHUNK;
        api({ action: 'pushOrders', orders: chunk }).then(function (j) {
          if (!j || !j.ok) {
            chunk.forEach(function (o) { results.push({ id: o.id, status: 'error', messages: [(j && j.error) || 'Villa'] }); });
            if (j && j.configured === false) { i = payload.length; }
          } else {
            results = results.concat(j.results || []);
          }
          next();
        }).catch(function (e) {
          chunk.forEach(function (o) { results.push({ id: o.id, status: 'error', messages: [String(e)] }); });
          next();
        });
      })();

      function done() {
        if (btn) { btn.disabled = false; btn.innerHTML = label; }
        var sent = results.filter(function (r) { return r.status === 'sent'; }).length;
        var bad = results.filter(function (r) { return r.status === 'error' || r.status === 'invalid'; }).length;
        loadLog();
        var L = { sent: 'Sent ✓', already: 'Þegar sent', invalid: 'Ekki sent', error: 'Villa' };
        showReport('Regla — ' + sent + ' send' + (bad ? ', ' + bad + ' með villu' : ''), results.map(function (r) {
          var msgs = (r.messages || []).concat((r.warnings || []));
          if (r.customer === 'created') msgs.unshift('Viðskiptamaður stofnaður í Reglu');
          return { key: r.id, label: L[r.status] || r.status, tone: r.status === 'sent' ? 'ok' : r.status === 'already' ? '' : 'err', msgs: msgs };
        }));
      }
    });
  }

  function decorateOrders() {
    if (!_log) return;
    var cells = document.querySelectorAll('#panelOrders .order-id');
    Array.prototype.forEach.call(cells, function (c) {
      if (c.querySelector('.ws-regla-tag')) return;
      var id = c.textContent.trim();
      var e = _log[id];
      if (!e || !e.ok || !e.number) return;
      var tag = document.createElement('span');
      tag.className = 'ws-regla-tag';
      tag.title = 'Geymdur reikningur nr. ' + e.number + ' í Reglu · ' + new Date(e.at).toLocaleString('is-IS');
      tag.textContent = 'Regla ✓';
      tag.style.cssText = 'display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;font-size:9px;font-weight:600;background:#E8F0E9;color:var(--green,#2f5d3a);vertical-align:middle';
      c.appendChild(tag);
    });
  }

  function decorateOrdersPanel() {
    var panel = document.getElementById('panelOrders');
    if (!panel || panel.querySelector('#wsReglaPushBtn')) { decorateOrders(); return; }
    var anchor = panel.querySelector('button[onclick^="exportReglaCSV"]');
    if (!anchor) return;
    var b = document.createElement('button');
    b.id = 'wsReglaPushBtn';
    b.className = 'adm-btn';
    b.title = 'Vista pantanir tímabilsins sem drög að reikningum í Reglu';
    b.style.cssText = 'background:var(--green,#2f5d3a);color:#fff;border-color:var(--green,#2f5d3a);display:flex;align-items:center;gap:5px';
    b.innerHTML = '⇪ Senda í Reglu';
    b.addEventListener('click', function () { pushOrders(b); });
    anchor.parentNode.insertBefore(b, anchor.nextSibling);
    if (_log) decorateOrders(); else loadLog();
  }

  /* ── customers ─────────────────────────────────────────────────────────── */
  function syncCustomers(btn) {
    var h = H();
    var list = (h ? h.vidskmList() : []).filter(function (v) { return v && h.ktDigits(v.kt).length === 10; });
    if (!list.length) { toast('Enginn viðskiptamaður með gilda kennitölu', 4000); return; }
    var label = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '⏳ Samstilli…';
    var payload = list.map(function (v) {
      return { kt: h.ktDigits(v.kt), nafn: v.nafn, netfang: v.netfang, simi: v.simi, heimili: v.heimili, postnr: v.postnr };
    });
    api({ action: 'syncCustomers', customers: payload }).then(function (j) {
      btn.disabled = false; btn.innerHTML = label;
      if (!j || !j.ok) { toast('Regla: ' + ((j && j.error) || 'villa'), 7000); return; }
      var L = { created: 'Stofnaður ✓', exists: 'Til í Reglu', skipped: 'Sleppt', error: 'Villa' };
      var created = j.results.filter(function (r) { return r.status === 'created'; }).length;
      showReport('Viðskiptamenn — ' + created + ' stofnaðir í Reglu', j.results.map(function (r) {
        return { key: r.kt, label: L[r.status] || r.status, tone: r.status === 'created' ? 'ok' : r.status === 'error' ? 'err' : '', msgs: [r.nafn || ''].concat(r.messages || []) };
      }));
    }).catch(function (e) {
      btn.disabled = false; btn.innerHTML = label;
      toast('Regla: ' + e, 7000);
    });
  }

  function decorateVidskmPanel() {
    var panel = document.getElementById('panelVidskm');
    if (!panel || panel.querySelector('#wsReglaVmBtn')) return;
    var anchor = panel.querySelector('button[onclick^="openVmModal"]');
    if (!anchor) return;
    var b = document.createElement('button');
    b.id = 'wsReglaVmBtn';
    b.className = 'adm-btn';
    b.style.cssText = 'margin-right:8px';
    b.title = 'Stofna viðskiptamenn sem vantar í Reglu (engum breytt sem er þar fyrir)';
    b.innerHTML = '⇪ Samstilla við Reglu';
    b.addEventListener('click', function () { syncCustomers(b); });
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    anchor.parentNode.insertBefore(wrap, anchor);
    wrap.appendChild(b); wrap.appendChild(anchor);
  }

  /* ── install: wrap the panel renderers ─────────────────────────────────── */
  function wrap(name, after) {
    var fn = window[name];
    if (typeof fn !== 'function' || fn._wsRegla) return;
    var w = function () {
      var r = fn.apply(this, arguments);
      try { if (isAdmin()) after(); } catch (e) { console.warn('[ws-regla-api]', e); }
      return r;
    };
    w._wsRegla = true;
    window[name] = w;
  }

  function install() {
    wrap('renderOrdersPanel', decorateOrdersPanel);
    wrap('renderVidskm', decorateVidskmPanel);
    if (isAdmin()) { decorateOrdersPanel(); decorateVidskmPanel(); }
  }

  window.wsRegla = { pushOrders: pushOrders, syncCustomers: syncCustomers, ping: function () { return api({ action: 'ping' }); } };
  install();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  window.addEventListener('load', install);
})();
