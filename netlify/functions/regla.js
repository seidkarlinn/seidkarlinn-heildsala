// Netlify Function: regla — wholesale portal ⇄ Regla (regla.is) web service
// ---------------------------------------------------------------------------
// All calls are server-side: the Regla username/password never reach the
// browser, and the SOAP endpoint does not allow cross-origin calls anyway.
//
// POST /.netlify/functions/regla   (header X-Admin-Secret required)
//   { action: "ping" }                         -> test login, count products
//   { action: "status" }                       -> log of orders already sent
//   { action: "syncCustomers", customers:[…] } -> create missing customers
//   { action: "searchCustomers", query }       -> Regla customers by kt / text
//   { action: "pushOrders", orders:[…], force? }
//        each order: { id, date, kt, note, paidByCard, buyerName, buyerEmail,
//                      customer:{kt,nafn,netfang,simi,heimili,postnr},
//                      lines:[{ sku, name, qty, retail, paid }] }
//        -> saves each as a DRAFT invoice (saved, not issued) in Regla.
//           Already-sent orders are skipped unless force:true.
//           The customer is created in Regla first if it does not exist.
//   { action: "resendOrder", order:{…}, allowNew? }
//        -> deletes our old draft of that order in Regla and saves the
//           current (edited) order as a new draft.
//
// GET  /.netlify/functions/regla?action=stock   (public, cached)
//   -> { ok, stock: { "<vörunúmer>": { q, ctl } } }
//
// Sent-order log lives in the Blob Store (wholesale-data / ws_regla_log), so
// it survives deploys and is shared by every admin browser.

const { getStore } = require('@netlify/blobs');
const regla = require('../lib/regla');

const ADMIN_SECRET = process.env.CATALOG_ADMIN_SECRET || 'seid_catalog_2024';
const LOG_KEY = 'ws_regla_log';
const MAX_ORDERS_PER_CALL = 8;   // keeps each call well inside the 10 s limit

function resolveStore() {
  const siteID = process.env.SITE_ID || '22a63579-5658-4bde-9a62-cf59aa4891ab';
  const token = process.env.NETLIFY_API_TOKEN;
  if (siteID && token) return getStore({ name: 'wholesale-data', siteID, token });
  return getStore('wholesale-data');
}

async function readLog(store) {
  try { const raw = await store.get(LOG_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

// Portal-shaped view of a Regla customer record (Viðskiptamenn form fields).
function portalCustomer(c) {
  if (!c || typeof c !== 'object') return null;
  const pc = c.PostalCode && typeof c.PostalCode === 'object' ? c.PostalCode : {};
  const str = (v) => (v == null || typeof v === 'object') ? '' : String(v).trim();
  return {
    kt: regla.ktDigits(c.CustomerNumber),
    nafn: str(c.Name),
    heimili: [str(c.AddressLine1), str(c.AddressLine2)].filter(Boolean).join(', '),
    postnr: str(pc.Value),
    stadur: str(pc.Name) || str(c.City),
    simi: str(c.Phone1) || str(c.Phone2),
    netfang: str(c.Email) || str(c.InvoiceEmail),
  };
}

// Regla customers by kennitala (exact, GetCustomer) or free text (SearchCustomers).
async function searchCustomers(q) {
  const out = []; const seen = new Set();
  const kt = regla.ktDigits(q);
  if (kt.length === 10) {
    const c = await regla.getCustomer(kt);
    if (c) { const p = portalCustomer(c); out.push(p); seen.add(p.kt); }
  }
  const { r, ok, messages } = await regla.call('SearchCustomers',
    () => regla.toXml({ search: q, indexFrom: 0, maxRecordCount: 25 }));
  if (!ok && !out.length && !messages.some((m) => /_NOT_FOUND;/.test(m))) throw new Error('SearchCustomers: ' + messages.join(' | '));
  const raw = r.SearchCustomersResult && r.SearchCustomersResult.Customer;
  for (const c of (Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [])) {
    const p = portalCustomer(c);
    if (!p || !p.kt || seen.has(p.kt)) continue;
    seen.add(p.kt); out.push(p);
  }
  return out;
}

const UNPAID = new Set(['payment_failed', 'awaiting_payment']);

async function orderStatuses(store) {
  const wsStatus = {};
  try {
    const all = JSON.parse((await store.get('ws_orders')) || '[]');
    (Array.isArray(all) ? all : []).forEach((x) => { if (x && x.id) wsStatus[x.id] = x.status; });
  } catch (e) { /* no status info: send as before */ }
  return wsStatus;
}

// Build + save one order as a Regla draft and update the log entry in place.
async function sendOne(o, log, wsStatus) {
  // Unpaid / declined Teya card orders never become Regla invoices (2026-11-09).
  if (o.paidByCard && UNPAID.has((wsStatus[o.id] || ''))) return { id: o.id, status: 'invalid', messages: ['Kortagreiðsla ekki staðfest hjá Teya — ekki send'] };
  try {
    const { invoice, errors, warnings } = await regla.buildInvoice(o);
    if (errors.length) return { id: o.id, status: 'invalid', messages: errors };

    const cust = await regla.ensureCustomer({ ...(o.customer || {}), kt: o.kt, nafn: (o.customer && o.customer.nafn) || o.buyerName, netfang: (o.customer && o.customer.netfang) || o.buyerEmail });
    if (cust.status === 'error') return { id: o.id, status: 'error', messages: ['Viðskiptamaður: ' + (cust.messages || []).join(' | ')] };

    const full = await regla.customerForInvoice(regla.ktDigits(o.kt), (o.customer && o.customer.nafn) || o.buyerName);
    invoice.Customer = full.customer;
    const saved = await regla.saveDraftInvoice(invoice, full.patched);
    const entry = { ok: saved.ok, number: saved.number, at: new Date().toISOString(), amount: invoice.Amount, total: o.total != null ? o.total : undefined, messages: saved.messages.slice(0, 12) };
    if (saved.ok) log[o.id] = entry; else delete log[o.id];
    const msgs = saved.ok ? ['Geymdur reikningur nr. ' + saved.number + ' í Reglu'].concat(saved.messages) : saved.messages;
    return { id: o.id, status: saved.ok ? 'sent' : 'error', number: saved.number, customer: cust.status, messages: msgs, warnings };
  } catch (e) {
    return { id: o.id, status: 'error', messages: [e.message] };
  }
}

// Remove our earlier draft of an order from Regla's saved invoices (only one
// whose Concerning is "Heildsölupöntun <id>"). Looks up the logged number
// first, then searches the customer's saved invoices in case it changed.
// -> { deleted:[numbers], found:boolean, messages:[] }
async function deleteOldDraft(id, kt, number) {
  const concerning = 'Heildsölupöntun ' + id;
  const out = { deleted: [], found: false, messages: [] };
  const targets = [];
  if (number) {
    const { r } = await regla.call('GetSavedInvoice', () => regla.toXml({ invoiceNumber: String(number) }));
    const inv = r.GetSavedInvoiceResult;
    if (inv && typeof inv === 'object' && String(inv.Concerning || '') === concerning) targets.push(String(number));
  }
  if (!targets.length && kt) {
    const hit = await regla.findSavedInvoice(kt, id, concerning);
    if (hit && hit.number) targets.push(String(hit.number));
  }
  out.found = targets.length > 0;
  for (const n of targets) {
    const d = await regla.call('DeleteSavedInvoice', () => regla.toXml({ invoiceNumber: n }), 'DeleteSavedInvoiceResult');
    if (d.ok) out.deleted.push(n); else out.messages.push('Tókst ekki að eyða drögum nr. ' + n + ': ' + d.messages.join(' | '));
  }
  return out;
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (code, obj, extra) => ({ statusCode: code, headers: { ...headers, ...(extra || {}) }, body: JSON.stringify(obj) });

let _stockCache = null;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  try {
    if (event.httpMethod === 'GET') {
      const action = event.queryStringParameters?.action;
      if (action !== 'stock') return reply(400, { ok: false, error: 'Unknown action' });
      if (!regla.configured()) return reply(200, { ok: false, configured: false, error: 'Regla not configured' });
      if (_stockCache && Date.now() - _stockCache.at < 5 * 60 * 1000) return reply(200, { ..._stockCache.payload, cached: true });
      const stock = await regla.stock();
      const payload = { ok: true, generatedAt: new Date().toISOString(), count: Object.keys(stock).length, stock };
      _stockCache = { at: Date.now(), payload };
      return reply(200, payload, { 'Netlify-CDN-Cache-Control': 'public, max-age=300, stale-while-revalidate=600' });
    }

    if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method not allowed' });

    const secret = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'];
    if (secret !== ADMIN_SECRET) return reply(401, { ok: false, error: 'Unauthorized' });

    const body = JSON.parse(event.body || '{}');
    const action = body.action;

    if (!regla.configured()) {
      return reply(200, { ok: false, configured: false, error: 'REGLA_USERNAME / REGLA_PASSWORD eru ekki stillt í Netlify' });
    }

    if (action === 'ping') {
      await regla.login(true);
      const cat = await regla.products(true);
      return reply(200, { ok: true, loggedIn: true, products: Object.keys(cat.bySku).length });
    }

    if (action === 'customer') {
      // Diagnostics: what Regla holds for one kennitala (no secrets in it).
      const kt = regla.ktDigits(body.kt);
      const c = await regla.getCustomer(kt);
      const pm = await regla.defaultPaymentMethod().catch((e) => ({ error: e.message }));
      return reply(200, { ok: true, customer: c, defaultPaymentMethod: pm });
    }

    if (action === 'product') {
      const sku = String(body.sku || '').trim();
      const cat = await regla.products();
      const fromSearch = cat.bySku[sku] ? cat.bySku[sku].raw : null;
      const full = await regla.productRecord(sku);
      return reply(200, { ok: true, fromSearch, full });
    }

    if (action === 'savedInvoices') {
      // Diagnostics: find saved (unissued) invoices in Regla by free text.
      const { r, ok, messages } = await regla.call('SearchSavedInvoices',
        () => regla.toXml({ search: String(body.search || ''), indexFrom: 0, maxRecordCount: 20 }));
      const raw = r.SearchSavedInvoicesResult && r.SearchSavedInvoicesResult.Invoice;
      const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((i) => ({
        number: i.InvoiceNumber, date: i.Date, concerning: i.Concerning, ref: i.UniqueReference,
        customer: i.Customer && i.Customer.Name, amount: i.Amount, type: i.Type,
      }));
      return reply(200, { ok, messages, count: list.length, invoices: list });
    }

    if (action === 'invoices') {
      // Diagnostics: issued invoices matching free text (read-only).
      const { r, ok, messages } = await regla.call('SearchInvoices',
        () => regla.toXml({ search: String(body.search || ''), indexFrom: 0, maxRecordCount: 20 }));
      const raw = r.SearchInvoicesResult && r.SearchInvoicesResult.Invoice;
      const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((i) => ({
        number: i.InvoiceNumber, date: i.Date, concerning: i.Concerning, ref: i.UniqueReference,
        customer: i.Customer && i.Customer.Name, amount: i.Amount, type: i.Type,
      }));
      return reply(200, { ok, messages, count: list.length, invoices: list });
    }

    if (action === 'deleteOrder') {
      // Remove one order everywhere: its Regla draft (only if that draft is
      // ours — Concerning "Heildsölupöntun <id>"), the order in ws_orders and
      // its ws_regla_log entry. ws_orders_lm is stamped like an admin force
      // write so admin browsers drop their stale local copy.
      const id = String(body.id || '').trim();
      if (!id) return reply(400, { ok: false, error: 'id vantar' });
      const store = resolveStore();
      const log = await readLog(store);
      const out = { id, regla: null, orders: null };

      const number = log[id] && log[id].number;
      if (number) {
        const { r } = await regla.call('GetSavedInvoice', () => regla.toXml({ invoiceNumber: String(number) }));
        const inv = r.GetSavedInvoiceResult;
        const concerning = inv && typeof inv === 'object' ? String(inv.Concerning || '') : '';
        if (concerning === 'Heildsölupöntun ' + id) {
          const d = await regla.call('DeleteSavedInvoice', () => regla.toXml({ invoiceNumber: String(number) }), 'DeleteSavedInvoiceResult');
          out.regla = { number, deleted: d.ok, messages: d.messages };
        } else {
          out.regla = { number, deleted: false, messages: ['Drög nr. ' + number + ' tilheyra ekki ' + id + ' (' + (concerning || 'fannst ekki') + ') — ekki eytt'] };
        }
      }

      const raw = await store.get('ws_orders');
      let orders = [];
      try { orders = JSON.parse(raw || '[]'); } catch { orders = []; }
      const before = orders.length;
      orders = orders.filter((o) => o && o.id !== id);
      if (orders.length !== before) {
        await store.set('ws_orders', JSON.stringify(orders));
        await store.set('ws_orders_lm', new Date().toISOString());
      }
      out.orders = { removed: before - orders.length, remaining: orders.length };

      if (log[id]) { delete log[id]; await store.set(LOG_KEY, JSON.stringify(log)); }
      return reply(200, { ok: true, ...out });
    }

    if (action === 'searchCustomers') {
      // Import side of the customer link: find Regla customers by kennitala
      // or free text so the admin can create a portal customer from one.
      const q = String(body.query || '').trim();
      if (q.length < 2) return reply(400, { ok: false, error: 'Leitarorð vantar' });
      const customers = await searchCustomers(q);
      return reply(200, { ok: true, customers });
    }

    if (action === 'status') {
      const log = await readLog(resolveStore());
      return reply(200, { ok: true, log });
    }

    if (action === 'syncCustomers') {
      const list = Array.isArray(body.customers) ? body.customers.slice(0, 40) : [];
      const results = [];
      for (const c of list) {
        try { results.push({ nafn: c.nafn, ...(await regla.ensureCustomer(c)) }); }
        catch (e) { results.push({ nafn: c.nafn, kt: regla.ktDigits(c.kt), status: 'error', messages: [e.message] }); }
      }
      return reply(200, { ok: true, results });
    }

    if (action === 'resendOrder') {
      // Re-send one order that changed after it was sent (2026-11-12):
      // delete our old draft in Regla, then save the current order as a new
      // draft. If the old draft is gone from Geymdir reikningar (issued or
      // removed in Regla) nothing is sent unless allowNew:true, so an issued
      // invoice is never doubled by accident.
      const o = body.order;
      if (!o || !o.id) return reply(400, { ok: false, error: 'order vantar' });
      const store = resolveStore();
      const log = await readLog(store);
      const prev = log[o.id];
      const kt = regla.ktDigits(o.kt);
      const del = await deleteOldDraft(o.id, kt, prev && prev.number);
      if (del.messages.length) return reply(200, { ok: true, result: { id: o.id, status: 'error', messages: del.messages } });
      if (!del.found && prev && prev.ok && prev.number && !body.allowNew) {
        return reply(200, { ok: true, result: { id: o.id, status: 'issued', number: prev.number,
          messages: ['Drög nr. ' + prev.number + ' fundust ekki lengur í Geymdum reikningum — reikningurinn hefur líklega verið gefinn út eða eytt í Reglu. Ekkert sent.'] } });
      }
      delete log[o.id];
      const res = await sendOne(o, log, await orderStatuses(store));
      if (res.status !== 'sent' && prev) log[o.id] = { ...prev, ok: false, failedResend: new Date().toISOString() };
      if (del.deleted.length) res.messages = ['Eldri drögum eytt í Reglu (nr. ' + del.deleted.join(', ') + ')'].concat(res.messages || []);
      await store.set(LOG_KEY, JSON.stringify(log));
      return reply(200, { ok: true, result: res });
    }

    if (action === 'pushOrders') {
      const orders = Array.isArray(body.orders) ? body.orders.slice(0, MAX_ORDERS_PER_CALL) : [];
      const store = resolveStore();
      const log = await readLog(store);
      const results = [];
      // Real order status lives in ws_orders (the client payload has none).
      const wsStatus = await orderStatuses(store);

      for (const o of orders) {
        if (!o || !o.id) continue;
        if (!body.force && log[o.id] && log[o.id].ok && log[o.id].number) { results.push({ id: o.id, status: 'already' }); continue; }
        results.push(await sendOne(o, log, wsStatus));
      }

      await store.set(LOG_KEY, JSON.stringify(log));
      return reply(200, { ok: true, results });
    }

    return reply(400, { ok: false, error: 'Unknown action' });
  } catch (err) {
    console.error('[regla]', err);
    return reply(502, { ok: false, error: err.message || 'Regla error' });
  }
};
