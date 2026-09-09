/**
 * Netlify Edge Function — inject-stock-layer
 *
 * Adds the wholesale portal's client-side overlay scripts just before the
 * document's closing </body>, so they load after index.html's inline scripts
 * have defined applyPricingOverrides(), getEffectivePricing() and
 * exportReglaCSV():
 *
 *   ws-stock-layer.js   live Shopify stock (and the per-buyer override fix)
 *   ws-vorunumer.js     Vörunúmer / SKU on each product
 *   ws-regla-export.js  "Sækja fyrir Reglu.is" → Sölusaga line-item CSV
 *
 * Order matters: ws-vorunumer.js reads the stock map that ws-stock-layer.js
 * puts on window._wsLiveStock, and the handle-remap table it defines;
 * ws-regla-export.js reads the sku that ws-vorunumer.js sets.
 *
 * WHY AN EDGE FUNCTION
 *   index.html is ~530 KB and cannot be pushed through the GitHub connector,
 *   so the <script> tags cannot be added to the file itself. Same pattern the
 *   CordyFresh product injection uses. If index.html ever gains baked-in
 *   references, the guards below turn this into a no-op and the edge function
 *   can be retired.
 *
 * WHY lastIndexOf
 *   index.html contains an EARLIER literal </body> inside the template string
 *   that builds the delivery note (deliveryHTML). A plain replace() hits that
 *   one first, which parks the tags inside a JS string: harmless to the page
 *   (it is a template literal) but the scripts never load, and printed
 *   delivery notes carry stray tags. Always target the last </body>.
 *
 * VERSIONS
 *   Bump a script's version whenever that file changes, so the browser
 *   refetches it instead of revalidating a cached copy.
 */

const SCRIPTS = [
  { src: '/ws-stock-layer.js', version: '20260909a' },
  { src: '/ws-vorunumer.js', version: '20260909a' },
  { src: '/ws-regla-export.js', version: '20260909b' },
];

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();

  // Idempotent per script: never inject twice, and stand down for any script
  // index.html has started loading on its own.
  const tags = SCRIPTS
    .filter((s) => !html.includes(s.src))
    .map((s) => `<script src="${s.src}?v=${s.version}"></script>`)
    .join('');

  if (tags) {
    const at = html.lastIndexOf('</body>');
    html = at === -1 ? html + tags : html.slice(0, at) + tags + html.slice(at);
  }

  return new Response(html, { status: response.status, headers: response.headers });
}

export const config = { path: '/' };
