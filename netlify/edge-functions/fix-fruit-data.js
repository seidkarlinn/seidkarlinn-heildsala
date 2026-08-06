/**
 * Netlify Edge Function — freeze-dried fruit weight/price correction.
 *
 * Three "Frostþurrkaðir ávextir" sample entries baked into index.html carried
 * stale weights and retail prices that no longer matched the retail store
 * seidkarlinn.is — the source of truth, synced from Shopify. This function
 * rewrites those two values in the served HTML so wholesale.seidkarlinn.is
 * matches retail, using the same "patch at the edge, never touch the ~500KB
 * index.html" approach as inject-catalog.js and category-order.js.
 *
 * Verified against Shopify on 2026-07-14:
 *   • Bláber   seidkarlinn-blaber-200g : 200g / 4.962 ISK  ->  250g / 6.203 ISK
 *   • Brómber  seidkarlinn-bromber-30g :  30g /   993 ISK  ->   25g /   828 ISK
 *   • Bananar  sedkarlinn-bananar-30g  :  30g /   706 ISK  ->   35g /   824 ISK
 *
 * IMPORTANT — we do NOT touch the "wholesale" field. The displayed wholesale
 * price is computed at runtime from the retail price times the buyer's
 * discount (getMyDiscount() -> per-user override, else the global
 * getTheme().discountPct). So correcting the retail price is enough: these
 * three products then get exactly the same discount as every other product
 * and every other user, with no bespoke rate baked in.
 *
 * Declared FIRST in netlify.toml so it runs as the OUTERMOST wrapper and
 * post-processes the final HTML after category-order + inject-catalog. All
 * targets are baked into index.html, so ordering is not critical.
 *
 * Stateless per request; each replacement no-ops if its old value is already
 * absent.
 */

const FRUIT_FIXES = [
  {
    oldName: 'Freeze-Dried Seiðkarlinn bláber 200g',
    newName: 'Freeze-Dried Seiðkarlinn bláber 250g',
    oldPrice: '4.962 ISK', newPrice: '6.203 ISK',
  },
  {
    oldName: 'Freeze-Dried Blackberry 30g Seiðkarlinn',
    newName: 'Freeze-Dried Blackberry 25g Seiðkarlinn',
    oldPrice: '993 ISK', newPrice: '828 ISK',
  },
  {
    oldName: 'Freeze-Dried Seðkarlinn Bananar 30g',
    newName: 'Freeze-Dried Seðkarlinn Bananar 35g',
    oldPrice: '706 ISK', newPrice: '824 ISK',
  },
];

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyFruitFixes(html) {
  let out = html;
  for (const f of FRUIT_FIXES) {
    // Retail price — anchored on the (still-old) unique name, non-greedy to
    // this object's own "price" field so no other object is touched.
    const priceRe = new RegExp(
      '("name":\\s*"' + esc(f.oldName) + '"[\\s\\S]*?"price":\\s*")' + esc(f.oldPrice) + '(")'
    );
    out = out.replace(priceRe, '$1' + f.newPrice + '$2');

    // Name (weight) — exact string, every occurrence (covers both the PRODUCTS
    // array and the PRODUCTS_BASE seed if the object appears twice).
    out = out.split('"name": "' + f.oldName + '"').join('"name": "' + f.newName + '"');
  }
  return out;
}

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';

  // Only process HTML responses; pass everything else straight through.
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();
  const fixed = applyFruitFixes(html);

  return new Response(fixed, {
    status: response.status,
    headers: response.headers,
  });
}

export const config = { path: '/' };
