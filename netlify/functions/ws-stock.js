// Netlify Function: ws-stock
// ---------------------------------------------------------------------------
// Serves a compact handle -> stock-status map for the wholesale catalog so the
// portal can show live Shopify inventory WITHOUT anyone clicking "Samstilla".
//
// WHY THIS EXISTS
//   The old flow was: admin opens the portal, clicks "Samstilla", the browser
//   walks the public storefront feed and writes inStock overrides into the
//   Blob Store. Two failure modes made products sit on "Til á lager" forever:
//     1) Nobody clicks the button, so nothing ever syncs.
//     2) The public storefront feed (/products.json) only contains products
//        published to the Online Store — 49 catalog items are DRAFT in Shopify
//        and are therefore invisible to it, so they could never be corrected.
//   This endpoint solves both: it reads the Admin API (all statuses, real
//   inventory numbers) server-side and the client overlays it on every load.
//
// SOURCES, in order of preference
//   1) Shopify Admin API   — needs SHOPIFY_STORE_DOMAIN + SHOPIFY_ADMIN_TOKEN
//                            (same env vars oos-data.js already uses).
//                            Sees DRAFT/ARCHIVED products too.
//   2) Public storefront   — https://www.seidkarlinn.is/products.json
//                            No credentials, but published products only.
//   The response always says which source produced it, so a silent downgrade
//   is visible in the payload instead of showing up as wrong stock.
//
// AVAILABILITY RULE
//   tracked inventory  -> available = totalInventory > 0
//   untracked          -> available = true (nothing to count)
//   Wholesale deliberately ignores "continue selling when out of stock": a
//   buyer must not be able to order units that do not physically exist.
//
// RESPONSE
//   { ok, source, generatedAt, count, stock: { "<handle>": { a: 1|0, q: n } } }
//
// CACHING
//   In-memory per warm container (TTL below) + CDN cache, so a page-load storm
//   costs one upstream fetch. Stock does not need to be second-accurate.

const SHOPIFY_API_VERSION = '2024-10';
const CACHE_TTL_MS = 5 * 60 * 1000;   // in-process
const CDN_MAX_AGE = 300;              // seconds, Netlify edge
const STORE_PUBLIC_BASE = 'https://www.seidkarlinn.is';

let _cache = null;   // { at: epochMs, payload: {...} }

/* ── Source 1: Admin API (all product statuses) ─────────────────────────── */
async function fromAdminApi(storeDomain, adminToken) {
  const endpoint = `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  // Product-level totalInventory + tracksInventory only: no nested variant
  // connection, which keeps the query cost low enough to pull 250 products per
  // request (the whole catalogue is ~4 requests).
  const query = `
    query Stock($cursor: String) {
      products(first: 250, after: $cursor) {
        edges {
          node {
            handle
            status
            totalInventory
            tracksInventory
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  const stock = {};
  let cursor = null;
  let hasNext = true;
  let requests = 0;

  while (hasNext && requests < 12) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': adminToken,
      },
      body: JSON.stringify({ query, variables: { cursor } }),
    });
    if (!res.ok) throw new Error('Admin API HTTP ' + res.status);
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    requests++;

    json.data.products.edges.forEach((e) => {
      const n = e.node;
      if (!n || !n.handle) return;
      const tracked = n.tracksInventory !== false;
      const qty = typeof n.totalInventory === 'number' ? n.totalInventory : null;
      const available = tracked ? (qty !== null && qty > 0) : true;
      stock[n.handle] = { a: available ? 1 : 0, q: qty, s: n.status };
    });

    hasNext = json.data.products.pageInfo.hasNextPage;
    cursor = json.data.products.pageInfo.endCursor;
  }

  return { source: 'admin', stock };
}

/* ── Source 2: public storefront feed (published products only) ─────────── */
async function fromPublicFeed() {
  const stock = {};
  for (let page = 1; page <= 10; page++) {
    // NOTE: the store 302-redirects /products.json to /is-is/products.json.
    // fetch() follows that automatically; do not "fix" the URL by hardcoding
    // the locale — the default locale can change in Shopify.
    const res = await fetch(`${STORE_PUBLIC_BASE}/products.json?limit=250&page=${page}`);
    if (!res.ok) break;
    const data = await res.json();
    const products = data.products || [];
    if (!products.length) break;
    products.forEach((p) => {
      const available = (p.variants || []).some((v) => v.available);
      stock[p.handle] = { a: available ? 1 : 0, q: null, s: 'ACTIVE' };
    });
    if (products.length < 250) break;
  }
  return { source: 'public', stock };
}

async function buildPayload() {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const adminToken = process.env.SHOPIFY_ADMIN_TOKEN;
  let result = null;
  let adminError = null;

  if (storeDomain && adminToken) {
    try {
      result = await fromAdminApi(storeDomain, adminToken);
    } catch (err) {
      adminError = err.message;
    }
  } else {
    adminError = 'SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN not set';
  }

  if (!result) result = await fromPublicFeed();

  return {
    ok: true,
    source: result.source,
    // Present when we wanted the Admin API but had to fall back: the portal
    // then only covers published products, so this is worth surfacing.
    adminError: result.source === 'admin' ? undefined : adminError,
    generatedAt: new Date().toISOString(),
    count: Object.keys(result.stock).length,
    stock: result.stock,
  };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    // Browsers revalidate; the CDN absorbs the traffic.
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Netlify-CDN-Cache-Control': `public, max-age=${CDN_MAX_AGE}, stale-while-revalidate=600`,
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const fresh = event.queryStringParameters?.fresh === '1';

  try {
    if (!fresh && _cache && Date.now() - _cache.at < CACHE_TTL_MS) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ..._cache.payload, cached: true }),
      };
    }
    const payload = await buildPayload();
    _cache = { at: Date.now(), payload };
    return { statusCode: 200, headers, body: JSON.stringify(payload) };
  } catch (err) {
    // Serve a stale payload rather than nothing: a slightly old stock map is
    // far better for the portal than falling back to the baked-in catalogue.
    if (_cache) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ..._cache.payload, cached: true, stale: true, error: err.message }),
      };
    }
    return { statusCode: 502, headers, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
