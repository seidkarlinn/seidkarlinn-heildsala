/**
 * Netlify Edge Function — runs at CDN level before HTML is served
 * - Fetches catalog state from kvdb and injects deleted list into the HTML
 *   so every visitor gets the correct catalog on first load.
 * - Rewrites two known-corrupted product URLs so the "Samstilla við Shopify"
 *   button checks the correct Shopify products. See URL_FIXES below.
 */

// Stop-gap URL corrections for entries in PRODUCTS_BASE whose `url` was
// wired to an unrelated Shopify product. Each entry is replaced once per
// HTML response. When the underlying PRODUCTS_BASE is corrected at source,
// remove this list.
const URL_FIXES = [
  // Raw Seiðkarlinn lyngblóma hunang 1kg
  ['women-s-hormone-balance-gh-59-2ml', 'seidkarlinn-lyngbloma-hunang-1kg'],
  // Raw Seiðkarlinn lyngblóma hunang 500g
  ['zh-black-aged-garlic-extract-60-hylki-1', 'seidkarlinn-lyngbloma-hunang-500g'],
];

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';

  // Only process HTML responses
  if (!contentType.includes('text/html')) return response;

  const BUCKET = Deno.env.get('KVDB_BUCKET') || '';
  const KEY = 'seidkarlinn_catalog';

  let deletedJSON = '[]';

  if (BUCKET) {
    try {
      const kvRes = await fetch(`https://kvdb.io/${BUCKET}/${KEY}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (kvRes.ok) {
        const text = await kvRes.text();
        if (text && text !== 'null') {
          const state = JSON.parse(text);
          if (Array.isArray(state.deleted)) {
            deletedJSON = JSON.stringify(state.deleted);
          }
        }
      }
    } catch (e) {
      // Use empty deleted list if kvdb fails
    }
  }

  // Inject the deleted list into the HTML before any scripts run
  let html = await response.text();
  html = html.replace(
    '<script>',
    `<script>window.__SERVER_DELETED__=${deletedJSON};window.__SERVER_CATALOG_READY__=true;</script>\n<script>`
  );

  // Apply known URL corrections (stop-gap for corrupted PRODUCTS_BASE entries)
  for (const [oldHandle, newHandle] of URL_FIXES) {
    html = html.replace(oldHandle, newHandle);
  }

  return new Response(html, {
    status: response.status,
    headers: response.headers,
  });
}

export const config = { path: '/' };
