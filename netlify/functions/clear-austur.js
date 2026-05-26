const { getStore } = require("@netlify/blobs");

// One-shot cleanup: removes any "Austur" entry from ws_pricing_users
// so the user falls back to the global default discount.
// Safe to call multiple times. Returns before/after for verification.
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

    const raw = await store.get("ws_pricing_users");
    let users = {};
    if (raw) {
      try { users = JSON.parse(raw); } catch { users = {}; }
    }

    const before = Object.keys(users);
    const removed = before.filter((k) => k.toLowerCase() === "austur");
    removed.forEach((k) => delete users[k]);

    await store.set("ws_pricing_users", JSON.stringify(users));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        before,
        removed,
        after: Object.keys(users),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
