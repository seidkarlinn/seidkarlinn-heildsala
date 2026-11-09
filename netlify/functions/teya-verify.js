/**
 * Seiðkarlinn Heildsala — Teya payment verification
 * ---------------------------------------------------------------------------
 * A card order is only CONFIRMED once Teya says the payment succeeded.
 * checkout() logs the order as status "awaiting_payment" before redirecting
 * to Teya; this function asks Teya what actually happened and moves it on:
 *
 *   paid               -> status "pending" (Í bið, ready to fulfil),
 *                         paymentStatus "paid", order e-mail sent now
 *   failed / expired   -> status "payment_failed", paymentStatus failed|expired,
 *                         no e-mail, excluded from revenue and Regla
 *   awaiting           -> unchanged, checked again later
 *
 *   GET/POST ?order=WS…   verify one order (success.html, cancel.html, admin)
 *   no order              sweep every card order still awaiting payment
 *                         (runs on a schedule — see teya-sweep.js)
 *
 * Needs the Teya scope checkout/sessions/id/get on the API client.
 */

const { getStore } = require("@netlify/blobs");
const { getToken, getSession, classifySession } = require("../lib/teya");
const { notifyNewOrders } = require("../lib/notify-order");

const SWEEP_MAX_AGE_DAYS = 14;
const TERMINAL = ["paid", "failed", "expired"];

function resolveStore() {
  const siteID = process.env.SITE_ID || "22a63579-5658-4bde-9a62-cf59aa4891ab";
  const token = process.env.NETLIFY_API_TOKEN;
  if (siteID && token) return getStore({ name: "wholesale-data", siteID, token });
  return getStore("wholesale-data");
}

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (statusCode, obj) => ({ statusCode, headers, body: JSON.stringify(obj) });

// Card order = has a Teya session, or carries the WS-prefix checkout.js gives.
function isCardOrder(o) {
  return !!(o && (o.teyaSessionId || (/^WS/.test(String(o.id || "")) && o.status !== "invoice")));
}

function needsCheck(o, now) {
  if (!isCardOrder(o) || !o.teyaSessionId) return false;
  if (TERMINAL.includes(o.paymentStatus)) return false;
  const age = now - new Date(o.date || 0).getTime();
  return age <= SWEEP_MAX_AGE_DAYS * 86400000;
}

function applyResult(o, result, session) {
  const before = `${o.status}|${o.paymentStatus}`;
  o.paymentStatus = result;
  o.paymentCheckedAt = new Date().toISOString();
  if (session) {
    o.teyaPaymentStatus = session.payment_status || null;
    o.teyaSessionStatus = session.session_status || null;
  }
  if (result === "paid") {
    o.paidAt = o.paidAt || o.paymentCheckedAt;
    if (o.status === "awaiting_payment" || o.status === "payment_failed") o.status = "pending";
  } else if (result === "failed" || result === "expired") {
    // Never undo work the admin already did by hand (sent / cancelled).
    if (["awaiting_payment", "pending", "processing"].includes(o.status)) o.status = "payment_failed";
  } else if (!o.status || o.status === "pending") {
    o.status = "awaiting_payment";
  }
  return before !== `${o.status}|${o.paymentStatus}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };

  let orderId = (event.queryStringParameters || {}).order || null;
  if (!orderId && event.body) {
    try { orderId = JSON.parse(event.body).order || null; } catch (e) { /* scheduled call body */ }
  }

  try {
    const store = resolveStore();
    const raw = await store.get("ws_orders");
    let orders = [];
    try { orders = JSON.parse(raw || "[]"); } catch (e) { orders = []; }
    if (!Array.isArray(orders)) orders = [];

    const now = Date.now();
    let targets;
    if (orderId) {
      const o = orders.find((x) => x && x.id === orderId);
      if (!o) return reply(404, { ok: false, error: "Pöntun fannst ekki", order: orderId });
      if (!isCardOrder(o)) return reply(200, { ok: true, order: orderId, paymentStatus: "n/a", status: o.status });
      if (!o.teyaSessionId) return reply(200, { ok: true, order: orderId, paymentStatus: o.paymentStatus || "unknown", status: o.status, note: "Enginn Teya session ID" });
      // An explicit check re-asks Teya even for a terminal state (except paid).
      targets = o.paymentStatus === "paid" ? [] : [o];
      if (!targets.length) return reply(200, { ok: true, order: orderId, paymentStatus: "paid", status: o.status });
    } else {
      targets = orders.filter((o) => needsCheck(o, now));
    }
    if (!targets.length) return reply(200, { ok: true, checked: 0, results: [] });

    let token;
    try {
      token = await getToken("checkout/sessions/id/get");
    } catch (e) {
      return reply(502, { ok: false, error: e.message, hint: "Teya API client vantar líklega scope checkout/sessions/id/get" });
    }

    const results = [];
    const newlyPaid = [];
    let changed = false;
    for (const o of targets) {
      try {
        const session = await getSession(o.teyaSessionId, token);
        const result = classifySession(session);
        const wasPaid = o.paymentStatus === "paid";
        if (applyResult(o, result, session)) changed = true;
        if (result === "paid" && !wasPaid) newlyPaid.push(o);
        results.push({ id: o.id, paymentStatus: o.paymentStatus, status: o.status, teya: { payment: session.payment_status, session: session.session_status } });
      } catch (e) {
        // 404 = Teya has no such session: nothing was ever charged.
        if (e.status === 404) {
          if (applyResult(o, "expired", null)) changed = true;
          results.push({ id: o.id, paymentStatus: o.paymentStatus, status: o.status, teya: "not-found" });
        } else {
          results.push({ id: o.id, error: e.message });
        }
      }
    }

    if (changed) {
      // Re-read and patch only the payment fields, so an order pushed while we
      // were talking to Teya is not lost.
      const fresh = JSON.parse((await store.get("ws_orders")) || "[]");
      const byId = Object.fromEntries(targets.map((o) => [o.id, o]));
      const merged = (Array.isArray(fresh) ? fresh : []).map((o) => {
        const u = o && byId[o.id];
        if (!u) return o;
        return Object.assign({}, o, {
          status: u.status,
          paymentStatus: u.paymentStatus,
          paymentCheckedAt: u.paymentCheckedAt,
          paidAt: u.paidAt,
          teyaPaymentStatus: u.teyaPaymentStatus,
          teyaSessionStatus: u.teyaSessionStatus,
        });
      });
      await store.set("ws_orders", JSON.stringify(merged));
    }

    // The order e-mail goes out only now that the money is confirmed.
    if (newlyPaid.length) {
      try { await notifyNewOrders(store, newlyPaid); } catch (e) { console.error("[teya-verify] notify failed:", e.message); }
    }

    if (orderId) {
      const r = results[0] || {};
      return reply(r.error ? 502 : 200, Object.assign({ ok: !r.error, order: orderId }, r));
    }
    return reply(200, { ok: true, checked: targets.length, results });
  } catch (err) {
    console.error("[teya-verify]", err);
    return reply(500, { ok: false, error: err.message });
  }
};
