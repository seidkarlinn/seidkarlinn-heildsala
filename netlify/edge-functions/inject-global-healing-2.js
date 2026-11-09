/**
 * Netlify Edge Function — Global Healing, viðbót 2026-11-09.
 *
 * Bætir við þeim 8 Global Healing vörum sem urðu ACTIVE í Shopify eftir
 * 2026-10-05 lotuna í inject-global-healing.js (SKU 1773–1780).
 * Sama merki "GlobalHealing" → GH35_PATCH í inject-global-healing.js setur
 * þær sjálfkrafa á 35% afslátt fyrir alla viðskiptamenn. Baked "wholesale"
 * = Math.round(retail * 0.65), aðeins fallback.
 *
 * Path er skráður inline (config hér neðst), svo engin breyting á
 * netlify.toml: inline-föll keyra innst, þ.e. á origin index.html á undan
 * öllum toml-föllunum — category-order raðar þessum vörum því eins og öðrum.
 * Verð, myndir, slóðir og SKU spegla Shopify 2026-11-09.
 * Idempotent: lykill er "Vitamin B12 59ml Global Healing".
 */

const GLOBAL_HEALING_2 = `
  {"name": "Omega 3-6-7-9 59ml Global Healing", "price": "9.301 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "omega"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/omega-3-6-7-9-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/omega-3-6-7-9_1.jpg?v=1792518939", "sku": "1773", "wholesale": "6.046 ISK"},
  {"name": "Lífrænt Elderberry & Echinacea 59ml Global Healing", "price": "7.696 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "ónæmiskerfi"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/elderberry-echinacea-org-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/elderberry-echinacea_1.jpg?v=1792518940", "sku": "1774", "wholesale": "5.002 ISK"},
  {"name": "CoQ10 & BioPQQ® með Shilajit 60 hylki Global Healing", "price": "16.793 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "CoQ10"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/coq10-biopqq%C2%AE-with-shilajit-60-stk-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/coq10-biopqq-shilajit_1.jpg?v=1792518940", "sku": "1775", "wholesale": "10.915 ISK"},
  {"name": "Prostate Health 59ml Global Healing", "price": "10.396 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "blöðruhálskirtill"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/prostate-health-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/prostate-health_1.jpg?v=1792518940", "sku": "1776", "wholesale": "6.757 ISK"},
  {"name": "Lífrænt Vein Health 59ml Global Healing", "price": "8.909 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "æðar"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/vein-health-org-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/vein-health_1.jpg?v=1792518941", "sku": "1777", "wholesale": "5.791 ISK"},
  {"name": "Calcium Disodium EDTA 59ml Global Healing", "price": "10.632 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "hreinsun"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/calcium-disodium-edta-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/calcium-disodium-edta_1.jpg?v=1792518941", "sku": "1778", "wholesale": "6.911 ISK"},
  {"name": "Yeast & Mold Cleanse 59ml Global Healing", "price": "9.646 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "hreinsun"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/yeast-and-mold-cleanse-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/yeast-mold-cleanse_1.jpg?v=1792518942", "sku": "1779", "wholesale": "6.270 ISK"},
  {"name": "Vitamin B12 59ml Global Healing", "price": "8.424 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "vítamín"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/vitamin-b12-liquid-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/vitamin-b12-59ml_1.jpg?v=1792519162", "sku": "1780", "wholesale": "5.476 ISK"},`;

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  if (!html.includes('"Vitamin B12 59ml Global Healing"') && html.includes('const PRODUCTS = [')) {
    html = html.replace('const PRODUCTS = [', `const PRODUCTS = [${GLOBAL_HEALING_2}`);
  }
  return new Response(html, { status: response.status, headers: response.headers });
}

export const config = { path: '/' };
