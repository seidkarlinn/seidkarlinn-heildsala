// [Blobs 401 recovery 2026-07-01] The site's auto-injected Netlify Blobs context
// started returning 401 on every operation (data was intact; only auth failed).
// resolveStore() now prefers explicit credentials (SITE_ID + NETLIFY_API_TOKEN)
// and keeps auto-context only as a fallback.
const { getStore } = require("@netlify/blobs");
const { notifyNewOrders } = require("../lib/notify-order");

const ALLOWED_KEYS = [
  "ws_orders","ws_invoice_seq","ws_buyer_accounts","ws_custom_products",
  "ws_deleted_products","ws_pricing","ws_pricing_users","ws_vidskm","ws_last_order","ws_cache_version","ws_product_info","ws_theme","ws_product_order",
  "ws_orders_lm", // last-modified timestamp — set only on force:true writes (admin deletions)
  "ws_orders_deleted", // tombstones: ids of orders admin deleted — read-only for clients
];

// ── Tombstones ────────────────────────────────────────────────────────────
// Every order id that leaves ws_orders through an admin write is remembered
// here. Stale copies in a buyer's or another admin's localStorage are pushed
// back up on their next save (plain merge) — without tombstones the deleted
// order comes back to life. Tombstoned ids are dropped from EVERY write and
// every read, so a deletion is permanent.
const TOMB_KEY = "ws_orders_deleted";
const TOMB_MAX = 5000;
async function readTombs(store) {
  try { const a = JSON.parse((await store.get(TOMB_KEY)) || "[]"); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
async function addTombs(store, ids) {
  ids = (ids || []).filter(Boolean);
  if (!ids.length) return;
  const cur = await readTombs(store);
  const set = new Set(cur);
  ids.forEach((id) => set.add(id));
  await store.set(TOMB_KEY, JSON.stringify(Array.from(set).slice(-TOMB_MAX)));
}
function dropTombed(arr, tombs) {
  if (!Array.isArray(arr) || !tombs.length) return arr;
  const t = new Set(tombs);
  return arr.filter((o) => !(o && o.id && t.has(o.id)));
}

// Resolve a Blob store handle. Prefer EXPLICIT credentials because this site's
// auto-injected context is currently rejected with 401. siteID is not secret
// (it is public deploy metadata); the token is provided via the NETLIFY_API_TOKEN
// env var (functions/runtime scope). Auto-context remains as a last resort.
function resolveStore() {
  const siteID = process.env.SITE_ID || "22a63579-5658-4bde-9a62-cf59aa4891ab";
  const token = process.env.NETLIFY_API_TOKEN;
  if (siteID && token) {
    return getStore({ name: "wholesale-data", siteID, token });
  }
  return getStore("wholesale-data");
}

// Server-confirmed Teya payment results (set by teya-verify.js) win over any
// client copy that has not caught up yet. Mutates the incoming orders in place.
const PAY_TERMINAL = ["paid", "failed", "expired"];
const PAY_FIELDS = ["paymentStatus", "paymentCheckedAt", "paidAt", "teyaPaymentStatus", "teyaSessionStatus"];
function keepPaymentState(storedArr, incomingById) {
  (storedArr || []).forEach((s) => {
    if (!s || !s.id || !PAY_TERMINAL.includes(s.paymentStatus)) return;
    const o = incomingById[s.id];
    if (!o || o === s || PAY_TERMINAL.includes(o.paymentStatus)) return;
    PAY_FIELDS.forEach((f) => { if (s[f] !== undefined) o[f] = s[f]; });
    // Status: only correct the payment-driven values; admin choices stand.
    if (o.status === "awaiting_payment" || (s.status === "payment_failed" && o.status === "pending")) {
      o.status = s.status;
    }
  });
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  try {
    const store = resolveStore();

    if (event.httpMethod === "GET") {
      const key = event.queryStringParameters?.key;

      if (key === "_all") {
        const result = {};
        await Promise.all(
          ALLOWED_KEYS.map(async (k) => {
            const raw = await store.get(k);
            if (raw !== null && raw !== undefined) {
              try { result[k] = JSON.parse(raw); } catch { result[k] = raw; }
            }
          })
        );
        if (Array.isArray(result.ws_orders)) result.ws_orders = dropTombed(result.ws_orders, result[TOMB_KEY] || []);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, data: result }) };
      }

      if (!key || !ALLOWED_KEYS.includes(key)) {
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "Invalid or missing key" }) };
      }

      const raw = await store.get(key);
      let value = null;
      if (raw !== null && raw !== undefined) {
        try { value = JSON.parse(raw); } catch { value = raw; }
      }
      if (key === "ws_orders" && Array.isArray(value)) {
        const tombs = await readTombs(store);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, key, value: dropTombed(value, tombs), deleted: tombs }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, key, value }) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { key, value } = body;

      if (!key || !ALLOWED_KEYS.includes(key)) {
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "Invalid or missing key" }) };
      }
      if (key === TOMB_KEY) {
        return { statusCode: 403, headers, body: JSON.stringify({ ok: false, error: "Read-only key" }) };
      }

      // ws_orders: merge by order ID so out-of-order concurrent pushes
      // (sync-layer keepalive + explicit fetch from logOrder) cannot silently
      // drop orders that arrived in a different network order.
      //
      // EXCEPTION — force:true: admin deliberate writes (status changes,
      // deletions) set force:true and bypass the merge entirely. This
      // prevents a status-change push from being undone by an older concurrent
      // push arriving later, and allows "clear all" to actually clear.
      if (key === "ws_orders" && Array.isArray(value) && !body.force) {
        const existing = await store.get("ws_orders");
        let stored = [];
        if (existing) {
          try { stored = JSON.parse(existing); } catch { stored = []; }
          if (!Array.isArray(stored)) stored = [];
        }
        // Merge: keep all unique order IDs; incoming wins on equal or newer date
        const byId = {};
        function addOrder(o) {
          if (!o || !o.id) return;
          if (!byId[o.id]) { byId[o.id] = o; return; }
          const existingTs = new Date(byId[o.id].date || 0).getTime();
          const incomingTs = new Date(o.date || 0).getTime();
          if (incomingTs >= existingTs) byId[o.id] = o; // >= so incoming wins on tie
        }

        // Order ids the server had BEFORE this push — anything in the incoming
        // payload that is not here is a brand-new order and worth an email.
        const tombs = await readTombs(store);
        const incoming = dropTombed(value, tombs);   // stale copies of deleted orders stay dead
        const knownIds = new Set(stored.map((o) => o && o.id).filter(Boolean));
        const newOrders = incoming.filter((o) => o && o.id && !knownIds.has(o.id));

        dropTombed(stored, tombs).forEach(addOrder);   // existing server data first
        incoming.forEach(addOrder);    // incoming second (wins on same or newer date)
        // Payment state is owned by teya-verify.js — a stale client copy that
        // still says "awaiting" must not undo a confirmed paid/failed result.
        keepPaymentState(stored, byId);
        const merged = Object.values(byId).sort((a, b) =>
          new Date(b.date || 0) - new Date(a.date || 0)
        );
        await store.set("ws_orders", JSON.stringify(merged));

        // Notify AFTER the order is safely stored, and never let a mail
        // failure turn into a failed write: the order matters, the email does
        // not. notifyNewOrders keeps its own ledger so the second push that
        // logOrder() always fires does not produce a second email.
        let notified = null;
        let notifyError = null;
        try {
          notified = await notifyNewOrders(store, newOrders);
        } catch (e) {
          notifyError = String(e && e.message ? e.message : e).slice(0, 160);
          console.error("[ws-data] order notification failed:", notifyError);
        }

        const payload = { ok: true, key, saved: true, notified: notified ? notified.sent : 0 };
        // Opt-in diagnostics: POST {"debug":true} to see WHY nothing was sent.
        // Booleans and a short reason string only — never the transport URL or
        // any credential.
        if (body.debug) {
          payload.diag = {
            newOrderIds: newOrders.map((o) => o.id),
            reason: notified ? notified.reason : "threw",
            configured: notified ? notified.configured : null,
            transport: notified ? notified.transport : null,
            skipped: notified ? notified.skipped : null,
            error: notifyError,
          };
        }

        return { statusCode: 200, headers, body: JSON.stringify(payload) };
      }

      // All other keys, and ws_orders with force:true: plain overwrite.
      // For force:true ws_orders writes (admin deletions/status changes), also
      // stamp ws_orders_lm so clients can detect server-side authority and
      // replace their stale localStorage instead of merging it back up.
      let toStore = value;
      if (key === "ws_orders" && body.force && Array.isArray(value)) {
        let prev = [];
        try { prev = JSON.parse((await store.get("ws_orders")) || "[]"); } catch (e) { prev = []; }
        if (!Array.isArray(prev)) prev = [];
        // Orders the admin removed with this write → tombstone them.
        const keepIds = new Set(value.map((o) => o && o.id).filter(Boolean));
        await addTombs(store, prev.map((o) => o && o.id).filter((id) => id && !keepIds.has(id)));
        // A force write built from a stale admin copy must not revive one either.
        toStore = dropTombed(value, await readTombs(store));
        const byIdF = {};
        toStore.forEach((o) => { if (o && o.id) byIdF[o.id] = o; });
        keepPaymentState(prev, byIdF);
      }
      await store.set(key, JSON.stringify(toStore));
      if (key === "ws_orders" && body.force) {
        await store.set("ws_orders_lm", new Date().toISOString());
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, key, saved: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: "Method not allowed" }) };
  } catch (err) {
    console.error("ws-data error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err.message || "Internal server error" }) };
  }
};
