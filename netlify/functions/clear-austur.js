const { getStore } = require("@netlify/blobs");

// Deprecated: this endpoint has been retired.
// New users are auto-seeded with STANDARD_PRICING_TEMPLATE on creation,
// so no manual copy is needed. Kept as a 410 Gone for safety.
exports.handler = async () => ({
  statusCode: 410,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    ok: false,
    error: "This endpoint has been retired. New users are auto-seeded with the standard pricing template.",
  }),
});
