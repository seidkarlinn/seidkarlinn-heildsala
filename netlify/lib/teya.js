// netlify/lib/teya.js
// ---------------------------------------------------------------------------
// Shared Teya helpers: OAuth token + hosted-checkout session lookup.
//
// GET /v2/checkout/sessions/{id} (scope checkout/sessions/id/get) returns
//   payment_status  NONE | SUCCESS | FAILED
//   session_status  ACTIVE | PROCESSING | COMPLETED | EXPIRED
//
// classifySession() turns that into the portal's own paymentStatus:
//   paid      payment_status SUCCESS                       -> order is confirmed
//   failed    payment_status FAILED (card declined etc.)   -> never confirmed
//   expired   session EXPIRED / COMPLETED without SUCCESS  -> never confirmed
//   awaiting  still ACTIVE / PROCESSING                    -> check again later

const TEYA_AUTH_URL = "https://id.teya.com/oauth/v2/oauth-token";
const TEYA_API = "https://api.teya.com";

async function getToken(scope) {
  const id = process.env.TEYA_CLIENT_ID;
  const secret = process.env.TEYA_CLIENT_SECRET;
  if (!id || !secret) throw new Error("TEYA_CLIENT_ID / TEYA_CLIENT_SECRET vantar");
  const res = await fetch(TEYA_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
      scope,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Teya auth (${res.status}): ${text.slice(0, 200)}`);
    err.code = "TEYA_AUTH";
    throw err;
  }
  const { access_token } = JSON.parse(text);
  if (!access_token) throw new Error("Ekkert access_token frá Teya");
  return access_token;
}

async function getSession(sessionId, token) {
  const res = await fetch(`${TEYA_API}/v2/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Teya session (${res.status}): ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text);
}

function classifySession(s) {
  const pay = String((s && s.payment_status) || "").toUpperCase();
  const st = String((s && s.session_status) || "").toUpperCase();
  if (pay === "SUCCESS") return "paid";
  if (pay === "FAILED") return "failed";
  if (st === "EXPIRED") return "expired";
  if (st === "COMPLETED") return "failed"; // finished without a successful payment
  return "awaiting";
}

module.exports = { TEYA_AUTH_URL, TEYA_API, getToken, getSession, classifySession };
