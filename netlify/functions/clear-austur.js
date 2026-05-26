const { getStore } = require("@netlify/blobs");

// Inspect & copy pricing overrides for users.
//
// GET ?action=inspect           -> returns ws_pricing_users + ws_pricing (global)
// GET ?action=copy&from=USER    -> copies USER's overrides onto Austur
// GET ?action=clear             -> removes Austur entry (fallback to global)
//
// Safe to call multiple times.
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const store = getStore({
      name: "wholesale-data",
      siteID: process.env.SITE_ID,
      token: process.env.NETLIFY_API_TOKEN,
    });

    const action = event.queryStringParameters?.action || "inspect";

    const rawUsers = await store.get("ws_pricing_users");
    let users = {};
    if (rawUsers) { try { users = JSON.parse(rawUsers); } catch { users = {}; } }

    const rawGlobal = await store.get("ws_pricing");
    let global = {};
    if (rawGlobal) { try { global = JSON.parse(rawGlobal); } catch { global = {}; } }

    if (action === "inspect") {
      // Summarize each user: how many category overrides, how many product overrides
      const summary = {};
      for (const [k, v] of Object.entries(users)) {
        summary[k] = {
          cats: v && v.cats ? Object.keys(v.cats).length : 0,
          prods: v && v.prods ? Object.keys(v.prods).length : 0,
          catDetail: v && v.cats ? v.cats : {},
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          userKeys: Object.keys(users),
          summary,
          globalHasCats: global && global.cats ? Object.keys(global.cats).length : 0,
          globalCatDetail: global && global.cats ? global.cats : {},
        }, null, 2),
      };
    }

    if (action === "copy") {
      const from = event.queryStringParameters?.from;
      if (!from) {
        return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "Missing ?from=USERNAME" }) };
      }
      // Resolve from-user case-insensitively
      const srcKey = Object.keys(users).find((k) => k.toLowerCase() === from.toLowerCase());
      if (!srcKey) {
        return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: "Source user not found", available: Object.keys(users) }) };
      }
      // Remove any existing Austur entry first (any case), then add lowercase 'austur'
      Object.keys(users)
        .filter((k) => k.toLowerCase() === "austur")
        .forEach((k) => delete users[k]);
      users["austur"] = JSON.parse(JSON.stringify(users[srcKey])); // deep copy

      await store.set("ws_pricing_users", JSON.stringify(users));
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          action: "copy",
          from: srcKey,
          to: "austur",
          copied: users["austur"],
        }, null, 2),
      };
    }

    if (action === "clear") {
      const removed = Object.keys(users).filter((k) => k.toLowerCase() === "austur");
      removed.forEach((k) => delete users[k]);
      await store.set("ws_pricing_users", JSON.stringify(users));
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, action: "clear", removed }, null, 2),
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: "Unknown action. Use inspect | copy | clear" }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
