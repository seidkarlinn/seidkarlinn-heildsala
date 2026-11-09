/* ws-payment-layer.js — Teya: pöntun staðfestist AÐEINS þegar greiðsla tókst
   ---------------------------------------------------------------------------
   VANDINN (2026-11-09, pöntun WSMW9ESHY7 / hlidarkaup)
     checkout() skráði kortapöntun sem "pending" (⏳ Í bið) og sendi
     pöntunarpóst ÁÐUR en kaupandinn fór yfir á Teya. Kortinu var hafnað, en
     pöntunin leit út eins og staðfest pöntun í Pantanir.

   LAUSNIN
     • logOrder(): kortapöntun skráist sem status "awaiting_payment",
       paymentStatus "awaiting". Enginn póstur fyrr en Teya staðfestir.
     • netlify/functions/teya-verify.js spyr Teya (GET checkout session):
         SUCCESS  -> "pending" (Í bið, má afgreiða) + paymentStatus "paid" + póstur
         FAILED / EXPIRED -> "payment_failed" — aldrei staðfest
       Kallað af success.html, cancel.html, Pantanir-síðunni og á 10 mín fresti.
     • Pantanir (admin): merki "💳 Bíður greiðslu" / "✕ Greiðsla mistókst",
       Greiðsla-lína í Upplýsingar, "🔄 Athuga greiðslu" hnappur, Senda/Vinna
       falin á ógreiddum kortapöntunum, ógreitt dregið frá Heildartekjum,
       síur fyrir ógreiddar pantanir.
   Vafið hér af því index.html er of stórt fyrir GitHub-connectorinn. */
(function () {
  if (window._wsPaymentLayer) return;
  window._wsPaymentLayer = true;

  var VERIFY = '/.netlify/functions/teya-verify';
  var UNPAID = ['awaiting_payment', 'payment_failed'];
  var LABELS = { awaiting_payment: '💳 Bíður greiðslu', payment_failed: '✕ Greiðsla mistókst' };

  function E(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s); }
  function toast(m, d) { if (typeof showToast === 'function') showToast(m, d || 3000); }
  function ISK(n) { return (typeof fmtISK === 'function') ? fmtISK(n) : (Math.round(n) + ' ISK'); }
  function isCard(o) { return !!(o && (o.teyaSessionId || (/^WS/.test(String(o.id || '')) && o.status !== 'invoice'))); }
  function isUnpaid(o) { return UNPAID.indexOf(o && o.status) !== -1; }

  // ── CSS ────────────────────────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent =
    '.status-pill.awaiting_payment{background:#EFF6FF;color:#1D4ED8;}' +
    '.status-pill.payment_failed{background:#FDECEA;color:var(--red,#C0392B);}' +
    '.pay-ok{color:var(--green,#2A5C2A);font-weight:600;}' +
    '.pay-bad{color:var(--red,#C0392B);font-weight:600;}' +
    '.pay-wait{color:#1D4ED8;font-weight:600;}' +
    '.pay-unk{color:#92400E;font-weight:600;}' +
    '.fulfill-btn.do-paycheck{background:#EFF6FF;color:#1D4ED8;border:1px solid rgba(29,78,216,.2);}' +
    'tr.ws-unpaid-row td{opacity:.72;}' +
    'tr.ws-unpaid-row td:last-child{opacity:1;}';
  document.head.appendChild(css);

  // ── 1. logOrder: card orders start as "awaiting_payment" ───────────────
  window.logOrder = function (orderId, total, cartItems, buyerName, buyerEmail, buyerUser, note, teyaSessionId) {
    var card = !!teyaSessionId || /^WS/.test(String(orderId || ''));
    var orders = getOrders();
    orders.unshift({
      id: orderId, total: total, buyerName: buyerName, buyerEmail: buyerEmail, buyerUser: buyerUser, note: note,
      date: new Date().toISOString(),
      status: card ? 'awaiting_payment' : 'pending',
      paymentStatus: card ? 'awaiting' : undefined,
      paymentMethod: card ? 'card' : undefined,
      teyaSessionId: teyaSessionId || null,
      refunds: [],
      items: (cartItems || []).map(function (i) { return { name: i.name, qty: i.qty, price: (i.wholesale || i.price) }; }),
    });
    saveOrders(orders);
    fetch('/.netlify/functions/ws-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'ws_orders', value: orders }),
      keepalive: true,
    }).catch(function () {});
    if (typeof updatePendingBadge === 'function') updatePendingBadge();
  };

  // ── 2. Status pills everywhere (admin + buyer panels) ──────────────────
  function relabel(root) {
    (root || document).querySelectorAll('.status-pill.awaiting_payment, .status-pill.payment_failed').forEach(function (el) {
      var k = el.classList.contains('awaiting_payment') ? 'awaiting_payment' : 'payment_failed';
      if (el.textContent !== LABELS[k]) el.textContent = LABELS[k];
    });
  }
  new MutationObserver(function () { relabel(); }).observe(document.body, { childList: true, subtree: true });

  // ── 3. Verify one order with Teya ──────────────────────────────────────
  var lastAuto = {};
  function verify(id) {
    return fetch(VERIFY + '?order=' + encodeURIComponent(id), { cache: 'no-store' })
      .then(function (r) { return r.json(); });
  }
  function refresh() {
    if (typeof refreshOrdersFromServer === 'function' && typeof window.renderOrdersPanel === 'function') {
      refreshOrdersFromServer(window.renderOrdersPanel);
    }
  }

  window.checkTeyaPayment = function (id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Athuga…'; }
    verify(id).then(function (j) {
      var ps = j && j.paymentStatus;
      if (!j.ok) toast('⚠️ ' + (j.error || 'Villa við að tengjast Teya') + (j.hint ? ' — ' + j.hint : ''), 6000);
      else if (ps === 'paid') toast('✅ ' + id + ': greiðsla staðfest hjá Teya', 4000);
      else if (ps === 'failed') toast('✕ ' + id + ': kortinu var hafnað — ekki greitt', 5000);
      else if (ps === 'expired') toast('✕ ' + id + ': greiðsla rann út — ekki greitt', 5000);
      else if (ps === 'awaiting') toast('⏳ ' + id + ': Teya hefur ekki staðfest greiðslu enn', 4000);
      else toast(id + ': ' + (ps || 'óþekkt staða'), 4000);
      refresh();
    }).catch(function () {
      toast('⚠️ Náði ekki sambandi við teya-verify', 4000);
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Athuga greiðslu'; }
    });
  };

  // Auto-check card orders that are not settled yet (max once a minute each).
  function autoVerify(orders) {
    var now = Date.now();
    var todo = orders.filter(function (o) {
      return isCard(o) && o.teyaSessionId &&
        ['paid', 'failed', 'expired'].indexOf(o.paymentStatus) === -1 &&
        o.status !== 'fulfilled' && o.status !== 'cancelled' &&
        now - new Date(o.date || 0).getTime() < 14 * 86400000 &&
        (!lastAuto[o.id] || now - lastAuto[o.id] > 60000);
    });
    if (!todo.length) return;
    todo.forEach(function (o) { lastAuto[o.id] = now; });
    Promise.all(todo.map(function (o) {
      return verify(o.id).then(function (j) {
        return j && j.ok && ['paid', 'failed', 'expired'].indexOf(j.paymentStatus) !== -1;
      }).catch(function () { return false; });
    })).then(function (res) { if (res.some(Boolean)) refresh(); });
  }

  // ── 4. Pantanir panel decoration ───────────────────────────────────────
  function payLine(o) {
    var t = o.paymentCheckedAt ? ' · ' + new Date(o.paymentCheckedAt).toLocaleString('is-IS', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    var v;
    if (o.paymentStatus === 'paid') v = '<span class="pay-ok">✓ Greitt hjá Teya</span>';
    else if (o.paymentStatus === 'failed') v = '<span class="pay-bad">✕ Kortinu hafnað — ekki greitt</span>';
    else if (o.paymentStatus === 'expired') v = '<span class="pay-bad">✕ Greiðsla rann út — ekki greitt</span>';
    else if (o.paymentStatus === 'awaiting') v = '<span class="pay-wait">⏳ Bíður staðfestingar Teya</span>';
    else v = '<span class="pay-unk">? Óstaðfest hjá Teya</span>';
    return '<div class="od-info-row ws-pay-row"><span class="od-info-key">Greiðsla</span><span class="od-info-val" title="' +
      E((o.teyaPaymentStatus || '') + ' ' + (o.teyaSessionStatus || '')) + '">' + v +
      '<span style="color:var(--ink3);font-weight:400;font-size:10px">' + E(t) + '</span></span></div>';
  }

  function decorate() {
    var panel = document.getElementById('panelOrders');
    if (!panel) return;
    var orders = getOrders();

    // Heildartekjur: only money actually received / owed
    var cards = panel.querySelectorAll('.stat-grid .stat-card');
    if (cards[3]) {
      var val = cards[3].querySelector('.stat-val');
      var sub = cards[3].querySelector('.stat-sub');
      var paidTotal = orders.filter(function (o) { return !isUnpaid(o); }).reduce(function (s, o) { return s + (o.total || 0); }, 0);
      if (val) val.textContent = ISK(paidTotal);
      var nUnpaid = orders.filter(isUnpaid).length;
      if (sub) sub.textContent = nUnpaid ? 'Heildsöluverð · án ' + nUnpaid + ' ógreiddra' : 'Heildsöluverð';
    }

    // Filter buttons for unpaid card orders
    var bar = panel.querySelector('.adm-toolbar');
    if (bar && !bar.querySelector('.ws-pay-filter')) {
      ['awaiting_payment', 'payment_failed'].forEach(function (s) {
        var b = document.createElement('button');
        b.className = 'adm-filter ws-pay-filter' + (orderFilter === s ? ' active' : '');
        b.textContent = s === 'awaiting_payment' ? 'Bíður greiðslu' : 'Greiðsla mistókst';
        b.onclick = function () { orderFilter = s; window.renderOrdersPanel(); };
        bar.appendChild(b);
      });
    }

    orders.forEach(function (o) {
      if (!isCard(o)) return;
      var detail = document.getElementById('od-' + o.id);
      if (!detail) return;
      var row = detail.previousElementSibling;

      // Upplýsingar box: Greiðsla line
      var boxes = detail.querySelectorAll('.od-box');
      var info = boxes[boxes.length - 1];
      if (info && !info.querySelector('.ws-pay-row')) {
        var rows = info.querySelectorAll('.od-info-row');
        var anchor = rows[rows.length - 1];
        var tmp = document.createElement('div');
        tmp.innerHTML = payLine(o);
        if (anchor) anchor.after(tmp.firstChild); else info.appendChild(tmp.firstChild);
      }

      if (!row) return;
      var actions = row.lastElementChild;
      var unpaid = isUnpaid(o) || ['failed', 'expired'].indexOf(o.paymentStatus) !== -1;
      row.classList.toggle('ws-unpaid-row', isUnpaid(o));

      if (unpaid && actions) {
        // No shipping, processing or refunding money that never arrived.
        actions.querySelectorAll('button').forEach(function (b) {
          var oc = b.getAttribute('onclick') || '';
          if (/'fulfilled'\)|'processing'\)|openRefundModal/.test(oc)) b.remove();
        });
        if (info) {
          var dl = info.querySelector('button[onclick*="downloadOrderPDF"]');
          if (dl) dl.style.display = 'none';
        }
      }

      if (o.paymentStatus !== 'paid' && actions && !actions.querySelector('.do-paycheck')) {
        var btn = document.createElement('button');
        btn.className = 'fulfill-btn do-paycheck';
        btn.textContent = '🔄 Athuga greiðslu';
        btn.onclick = function (e) { e.stopPropagation(); window.checkTeyaPayment(o.id, btn); };
        actions.insertBefore(btn, actions.firstChild);
      }
    });

    relabel(panel);
    autoVerify(orders);
  }

  function install() {
    var orig = window.renderOrdersPanel;
    if (typeof orig !== 'function' || orig._wsPay) return;
    var wrapped = function () {
      var r = orig.apply(this, arguments);
      try { decorate(); } catch (e) { console.warn('[ws-payment-layer]', e); }
      return r;
    };
    wrapped._wsPay = true;
    window.renderOrdersPanel = wrapped;
    // Order panel may already be on screen (last panel restored on load)
    var p = document.getElementById('panelOrders');
    if (p && p.innerHTML.trim()) { try { decorate(); } catch (e) {} }
  }

  // ── 5. "Sækja fyrir Reglu.is" CSV: leave unpaid card orders out ─────────
  //    (Senda í Reglu is guarded server-side in netlify/functions/regla.js.)
  function wrapExport() {
    var orig = window.exportReglaCSV;
    if (typeof orig !== 'function' || orig._wsPay) return;
    var w = function () {
      var g = window.getOrders;
      window.getOrders = function () { return g().filter(function (o) { return !isUnpaid(o); }); };
      try { return orig.apply(this, arguments); } finally { window.getOrders = g; }
    };
    w._wsPay = true;
    window.exportReglaCSV = w;
  }

  function installAll() { install(); wrapExport(); }
  installAll();
  // Other layers may (re)install on load; make sure we stay on top.
  setTimeout(installAll, 0);
  if (document.readyState !== 'complete') window.addEventListener('load', function () { setTimeout(installAll, 0); });
})();
