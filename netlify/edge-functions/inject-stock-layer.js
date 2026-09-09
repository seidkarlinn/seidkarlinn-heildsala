/**
 * Netlify Edge Function — inject-stock-layer
 *
 * Adds <script src="/ws-stock-layer.js"> just before </body> so the live
 * Shopify stock overlay loads after index.html's inline scripts have defined
 * applyPricingOverrides() and getEffectivePricing().
 *
 * WHY AN EDGE FUNCTION
 *   index.html is ~530 KB and cannot be pushed through the GitHub connector,
 *   so the <script> tag cannot be added to the file itself. Same pattern the
 *   CordyFresh product injection uses. If index.html ever gains a baked-in
 *   reference to ws-stock-layer.js, the guard below turns this into a no-op
 *   and the edge function can be retired.
 *
 * VERSION
 *   Bump WS_STOCK_LAYER_VERSION whenever ws-stock-layer.js changes, so the
 *   browser refetches it instead of revalidating a cached copy.
 */

const WS_STOCK_LAYER_VERSION = '20260909a';

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();

  // Idempotent: never inject twice, and stand down if index.html loads it.
  if (html.includes('ws-stock-layer.js')) {
    return new Response(html, { status: response.status, headers: response.headers });
  }

  const tag = `<script src="/ws-stock-layer.js?v=${WS_STOCK_LAYER_VERSION}"></script>`;
  const injected = html.includes('</body>')
    ? html.replace('</body>', `${tag}</body>`)
    : html + tag;

  return new Response(injected, { status: response.status, headers: response.headers });
}

export const config = { path: '/' };
