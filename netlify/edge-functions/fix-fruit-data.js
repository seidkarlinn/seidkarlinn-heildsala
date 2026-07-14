/**
 * Netlify Edge Function — freeze-dried fruit weight/price correction.
 *
 * Three "Frostþurrkaðir ávextir" sample entries baked into index.html carried
 * stale weights and prices that no longer matched the retail store
 * seidkarlinn.is — the source of truth, synced from Shopify. This function
 * rewrites those values in the served HTML so wholesale.seidkarlinn.is matches
 * retail, using the same "patch at the edge, never touch the ~500KB
 * index.html" approach as inject-catalog.js and category-order.js.
 *
 * Verified against Shopify on 2026-07-14:
 *   • Bláber   seidkarlinn-blaber-200g : 200g / 4.962  ->  250g / 6.203 ISK
 *   • Brómber  seidkarlinn-bromber-30g :  30g /   993  ->   25g /   828 ISK
 *   • Bananar  sedkarlinn-bananar-30g  :  30g /   706  ->   35g /   824 ISK
 *
 * The baked "wholesale" string is the store's standard Math.floor(retail*0.75)
 * cart-fallback (applyPricingOverrides() also recomputes it at runtime from
 * the retail price); it is kept in sync here:
 *   6.203 -> 4.652,  828 -> 621,  824 -> 618.
 *
 * Declared FIRST in netlify.toml so it runs as the OUTERMOST wrapper and
 * post-processes the final HTML after category-order + inject-catalog. All
 * three targets are baked into index.html, so ordering is not critical.
 *
 * Stateless per request (each response is transformed from fresh origin HTML),
 * so the replacements re-apply every time; each one no-ops if its old value is
 * already absent.
 */

const FRUIT_FIXES = [
  {
    url: 'https://www.seidkarlinn.is/is-is/products/seidkarlinn-blaber-200g',
    oldName: 'Freeze-Dried Seiðkarlinn bláber 200g',
    newName: 'Freeze-Dried Seiðkarlinn bláber 250g',
    oldPrice: '4.962 ISK', newPrice: '6.203 ISK',
    oldWholesale: '3.721 ISK', newWholesale: '4.652 ISK',
  },
  {
    url: 'https://www.seidkarlinn.is/is-is/products/seidkarlinn-bromber-30g',
    oldName: 'Freeze-Dried Blackberry 30g Seiðkarlinn',
    newName: 'Freeze-Dried Blackberry 25g Seiðkarlinn',
    oldPrice: '993 ISK', newPrice: '828 ISK',
    oldWholesale: '745 ISK', newWholesale: '621 ISK',
  },
  {
    url: 'https://www.seidkarlinn.is/is-is/products/sedkarlinn-bananar-30g',
    oldName: 'Freeze-Dried Seðkarlinn Bananar 30g',
    newName: 'Freeze-Dried Seðkarlinn Bananar 35g',
    oldPrice: '706 ISK', newPrice: '824 ISK',
    oldWholesale: '530 ISK', newWholesale: '618 ISK',
  },
];

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyFruitFixes(html) {
  let out = html;
  for (const f of FRUIT_FIXES) {
    // 1) Retail price — anchored on the (still-old) unique name, non-greedy to
    //    this object's own "price" field so no other object is touched.
    const priceRe = new RegExp(
      '("name":\\s*"' + esc(f.oldName) + '"[\\s\\S]*?"price":\\s*")' + esc(f.oldPrice) + '(")'
    );
    out = out.replace(priceRe, '$1' + f.newPrice + '$2');

    // 2) Wholesale fallback — anchored on the unique product url, non-greedy to
    //    this object's own "wholesale" field.
    const wholesaleRe = new RegExp(
      '("url":\\s*"' + esc(f.url) + '"[\\s\\S]*?"wholesale":\\s*")' + esc(f.oldWholesale) + '(")'
    );
    out = out.replace(wholesaleRe, '$1' + f.newWholesale + '$2');

    // 3) Name (weight) — exact string, every occurrence (covers both the
    //    PRODUCTS array and the PRODUCTS_BASE seed if the object appears twice).
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
