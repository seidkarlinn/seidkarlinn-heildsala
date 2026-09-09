// netlify/lib/notify-order.js
// ---------------------------------------------------------------------------
// Sends a "new wholesale order" notification. Called from ws-data.js, which is
// the single place every order reaches the server: BOTH checkout paths in
// index.html (Teya card checkout and invoiceCheckout / reikningsviðskipti) end
// in logOrder(), and logOrder pushes ws_orders to /.netlify/functions/ws-data.
// Hooking there means no order can be placed without passing through here.
//
// TRANSPORT — whichever is configured, in this order:
//   1) RESEND_API_KEY        -> sends the email directly via Resend.
//                               Also honours ORDER_EMAIL_TO (default
//                               benedikt@seidkarlinn.is) and ORDER_EMAIL_FROM
//                               (default pantanir@seidkarlinn.is — the domain
//                               must be verified in Resend first).
//   2) ORDER_WEBHOOK_URL     -> POSTs the order as JSON to a Zapier/Make catch
//                               hook, which then sends the mail. No DNS work.
//   3) neither               -> logs and does nothing. The order still saves;
//                               notification is never allowed to break a write.
//
// DE-DUPLICATION
//   logOrder() deliberately pushes twice (sync-layer keepalive + an explicit
//   fetch) so an order survives a mobile page navigation. Both pushes carry the
//   same order, so we keep a small ledger of already-notified order IDs in the
//   Blob Store and skip anything already in it. Worst case under a true race is
//   one duplicate email — far better than a missed order.

const LEDGER_KEY = "ws_order_notified";
const LEDGER_MAX = 500;

const isk = (n) => {
  const v = Number(n) || 0;
  return v.toLocaleString("de-DE") + " ISK";
};

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Teya card orders get a session id and a WS-prefixed id from checkout.js.
// Invoice orders (reikningsviðskipti) use the sequential invoice number as the
// order id and never have a session.
function paymentLabel(order) {
  if (order.teyaSessionId) return "Kortagreiðsla (Teya)";
  if (/^\d+$/.test(String(order.id || ""))) return "Reikningsviðskipti · 14 dagar";
  return "Óþekkt greiðsluleið";
}

function buildEmail(order) {
  const pay = paymentLabel(order);
  const when = new Date(order.date || Date.now()).toLocaleString("is-IS", {
    timeZone: "Atlantic/Reykjavik",
  });
  const items = (order.items || [])
    .map(
      (i) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(i.name)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${esc(i.qty)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${esc(i.price)}</td>
      </tr>`
    )
    .join("");

  const subject = `Ný heildsölupöntun ${order.id} — ${isk(order.total)}${
    order.buyerName ? " — " + order.buyerName : ""
  }`;

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#1a1a1a;max-width:640px">
  <h2 style="margin:0 0 4px">Ný pöntun á heildsöluvefnum</h2>
  <div style="color:#666;margin-bottom:16px">${esc(when)} · ${esc(pay)}</div>

  <table style="border-collapse:collapse;margin-bottom:18px">
    <tr><td style="padding:2px 12px 2px 0;color:#666">Pöntun</td><td><strong>${esc(order.id)}</strong></td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Upphæð</td><td><strong>${esc(isk(order.total))}</strong></td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Kaupandi</td><td>${esc(order.buyerName || "—")}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Netfang</td><td>${esc(order.buyerEmail || "—")}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666">Notandi</td><td>${esc(order.buyerUser || "—")}</td></tr>
    ${order.note ? `<tr><td style="padding:2px 12px 2px 0;color:#666">Athugasemd</td><td>${esc(order.note)}</td></tr>` : ""}
  </table>

  <table style="border-collapse:collapse;width:100%">
    <thead><tr style="background:#f5f5f5">
      <th style="padding:6px 10px;text-align:left">Vara</th>
      <th style="padding:6px 10px;text-align:right">Fj.</th>
      <th style="padding:6px 10px;text-align:right">Verð</th>
    </tr></thead>
    <tbody>${items}</tbody>
  </table>

  <p style="margin-top:18px">
    <a href="https://wholesale.seidkarlinn.is/" style="color:#0b5">Opna heildsöluvefinn</a>
  </p>
</div>`;

  const text = [
    `Ný pöntun á heildsöluvefnum`,
    `${when} · ${pay}`,
    ``,
    `Pöntun:   ${order.id}`,
    `Upphæð:   ${isk(order.total)}`,
    `Kaupandi: ${order.buyerName || "—"}`,
    `Netfang:  ${order.buyerEmail || "—"}`,
    `Notandi:  ${order.buyerUser || "—"}`,
    order.note ? `Athugasemd: ${order.note}` : null,
    ``,
    ...(order.items || []).map((i) => `  ${i.qty} × ${i.name} — ${i.price}`),
    ``,
    `https://wholesale.seidkarlinn.is/`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return { subject, html, text, paymentLabel: pay };
}

async function sendViaResend(order) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ORDER_EMAIL_TO || "benedikt@seidkarlinn.is";
  const from = process.env.ORDER_EMAIL_FROM || "pantanir@seidkarlinn.is";
  const { subject, html, text } = buildEmail(order);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Seiðkarlinn heildsala <${from}>`,
      to: to.split(",").map((s) => s.trim()).filter(Boolean),
      reply_to: order.buyerEmail || undefined,
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) throw new Error("Resend HTTP " + res.status + " " + (await res.text()).slice(0, 200));
  return "resend";
}

async function sendViaWebhook(order) {
  const url = process.env.ORDER_WEBHOOK_URL;
  const { subject, html, text, paymentLabel: pay } = buildEmail(order);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "new_wholesale_order",
      to: process.env.ORDER_EMAIL_TO || "benedikt@seidkarlinn.is",
      subject,
      html,
      text,
      paymentMethod: pay,
      order,
    }),
  });
  if (!res.ok) throw new Error("Webhook HTTP " + res.status);
  return "webhook";
}

/**
 * Notify about orders that have not been notified about before.
 *
 * @param {object} store   Netlify Blobs store handle (already resolved).
 * @param {Array}  orders  Orders considered new by the caller.
 * @returns {Promise<{sent:number, skipped:number, transport:string|null}>}
 */
async function notifyNewOrders(store, orders) {
  const result = { sent: 0, skipped: 0, transport: null };
  if (!orders || !orders.length) return result;

  const hasResend = !!process.env.RESEND_API_KEY;
  const hasWebhook = !!process.env.ORDER_WEBHOOK_URL;
  if (!hasResend && !hasWebhook) {
    console.log(
      "[notify-order] " + orders.length + " new order(s) but no transport configured " +
      "(set RESEND_API_KEY or ORDER_WEBHOOK_URL): " + orders.map((o) => o.id).join(", ")
    );
    return result;
  }

  // Ledger of already-notified ids.
  let ledger = [];
  try {
    const raw = await store.get(LEDGER_KEY);
    if (raw) ledger = JSON.parse(raw) || [];
    if (!Array.isArray(ledger)) ledger = [];
  } catch (e) {
    ledger = [];
  }

  const todo = orders.filter((o) => o && o.id && ledger.indexOf(String(o.id)) === -1);
  result.skipped = orders.length - todo.length;
  if (!todo.length) return result;

  // Claim the ids BEFORE sending, so a concurrent invocation that reads the
  // ledger a moment later does not send the same mail again. A send that then
  // fails is logged loudly rather than retried — the order itself is safe.
  const claimed = ledger.concat(todo.map((o) => String(o.id))).slice(-LEDGER_MAX);
  try {
    await store.set(LEDGER_KEY, JSON.stringify(claimed));
  } catch (e) {
    console.warn("[notify-order] could not write ledger:", e.message);
  }

  for (const order of todo) {
    try {
      result.transport = hasResend ? await sendViaResend(order) : await sendViaWebhook(order);
      result.sent++;
      console.log("[notify-order] sent notification for order " + order.id);
    } catch (e) {
      console.error("[notify-order] FAILED for order " + order.id + ": " + e.message);
    }
  }
  return result;
}

module.exports = { notifyNewOrders, buildEmail, paymentLabel };
