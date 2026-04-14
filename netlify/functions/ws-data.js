const { getStore } = require("@netlify/blobs");

const ALLOWED_KEYS = [
  "ws_orders","ws_invoice_seq","ws_buyer_accounts","ws_custom_products",
  "ws_deleted_products","ws_pricing","ws_pricing_users","ws_vidskm","ws_last_order","ws_cache_version",
];

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
    const store = getStore({
      name: "wholesale-data",
      siteID: process.env.SITE_ID,
      token: process.env.NETLIFY_API_TOKEN,
    });

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
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, key, value }) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { key, value } = body;

      if (!key || !ALLOWED_KEYS.includes(key)) {
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "Invalid or missing key" }) };
      }

      await store.set(key, JSON.stringify(value));
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, key, saved: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: "Method not allowed" }) };
  } catch (err) {
    console.error("ws-data error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err.message || "Internal server error" }) };
  }
};
