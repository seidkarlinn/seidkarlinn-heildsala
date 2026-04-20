const { getStore } = require("@netlify/blobs");

const ALLOWED_KEYS = [
  "ws_orders","ws_invoice_seq","ws_buyer_accounts","ws_custom_products",
  "ws_deleted_products","ws_pricing","ws_pricing_users","ws_vidskm","ws_last_order","ws_cache_version","ws_product_info","ws_theme","ws_product_order",
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

      // ws_orders: merge by order ID instead of blind overwrite so that
      // out-of-order network delivery never silently drops orders.
      // Two concurrent pushes (e.g. sync-layer + explicit keepalive) may arrive
      // in reverse order; the earlier push must not wipe orders added by the later one.
      if (key === "ws_orders" && Array.isArray(value)) {
        const existing = await store.get("ws_orders");
        let stored = [];
        if (existing) {
          try { stored = JSON.parse(existing); } catch { stored = []; }
          if (!Array.isArray(stored)) stored = [];
        }
        // Merge: keep all unique order IDs, prefer the entry with the later date
        const byId = {};
        function addOrder(o) {
          if (!o || !o.id) return;
          if (!byId[o.id]) { byId[o.id] = o; return; }
          const existingTs = new Date(byId[o.id].date || 0).getTime();
          const incomingTs = new Date(o.date || 0).getTime();
          if (incomingTs > existingTs) byId[o.id] = o;
        }
        stored.forEach(addOrder);   // existing server data first
        value.forEach(addOrder);    // incoming data second (wins on tie or newer date)
        const merged = Object.values(byId).sort((a, b) =>
          new Date(b.date || 0) - new Date(a.date || 0)
        );
        await store.set("ws_orders", JSON.stringify(merged));
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, key, saved: true }) };
      }

      // All other keys: plain overwrite (safe — they are not append-only arrays)
      await store.set(key, JSON.stringify(value));
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, key, saved: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: "Method not allowed" }) };
  } catch (err) {
    console.error("ws-data error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err.message || "Internal server error" }) };
  }
};
