// Netlify Function: regla — wholesale portal ⇄ Regla (regla.is) web service
// ---------------------------------------------------------------------------
// All calls are server-side: the Regla username/password never reach the
// browser, and the SOAP endpoint does not allow cross-origin calls anyway.
//
// POST /.netlify/functions/regla   (header X-Admin-Secret required)
//   { action: "ping" }                         -> test login, count products
//   { action: "status" }                       -> log of orders already sent
//   { action: "syncCustomers", customers:[…] } -> create missing customers
//   { action: "pushOrders", orders:[…], force? }
//        each order: { id, date, kt, note, paidByCard, buyerName, buyerEmail,
//                      customer:{kt,nafn,netfang,simi,heimili,postnr},
//                      lines:[{ sku, name, qty, retail, paid }] }
//        -> saves each as a DRAFT invoice (saved, not issued) in Regla.
//           Already-sent orders are skipped unless force:true.
//           The customer is created in Regla first if it does not exist.
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

    if (action === 'pushOrders') {
      const orders = Array.isArray(body.orders) ? body.orders.slice(0, MAX_ORDERS_PER_CALL) : [];
      const store = resolveStore();
      const log = await readLog(store);
      const results = [];

      for (const o of orders) {
        if (!o || !o.id) continue;
        if (!body.force && log[o.id] && log[o.id].ok) { results.push({ id: o.id, status: 'already' }); continue; }
        try {
          const { invoice, errors, warnings } = await regla.buildInvoice(o);
          if (errors.length) { results.push({ id: o.id, status: 'invalid', messages: errors }); continue; }

          const cust = await regla.ensureCustomer({ ...(o.customer || {}), kt: o.kt, nafn: (o.customer && o.customer.nafn) || o.buyerName, netfang: (o.customer && o.customer.netfang) || o.buyerEmail });
          if (cust.status === 'error') { results.push({ id: o.id, status: 'error', messages: ['Viðskiptamaður: ' + (cust.messages || []).join(' | ')] }); continue; }

          const saved = await regla.saveDraftInvoice(invoice);
          const entry = { ok: saved.ok, at: new Date().toISOString(), amount: invoice.Amount, messages: saved.messages.slice(0, 6) };
          if (saved.ok) log[o.id] = entry;
          results.push({ id: o.id, status: saved.ok ? 'sent' : 'error', customer: cust.status, messages: saved.messages, warnings });
        } catch (e) {
          results.push({ id: o.id, status: 'error', messages: [e.message] });
        }
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
