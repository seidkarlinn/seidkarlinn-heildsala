/**
 * Netlify Edge Function — Global Healing line (added 2026-10-05).
 *
 * Injects the 26 ACTIVE Global Healing SKUs from seidkarlinn.is into the
 * PRODUCTS array (drafts Ultimate Enzymes 1338 and Heavy Metal & Chemical
 * Binder 7067 are deliberately left out). Same pattern as inject-catalog.js,
 * kept in its own file so that file stays readable.
 *
 * Pricing: every entry carries the tag "GlobalHealing". GH35_PATCH routes
 * those products through a virtual "Global Healing" discount category with a
 * default of 35% off retail for EVERY buyer, independent of their
 * Fæðubótarefni percentage. The admin can still override it per customer in
 * Verðstjórn (row "Global Healing (merki: GlobalHealing)"), and an explicit
 * per-product wholesale price still wins. The baked "wholesale" string is
 * 35% off retail (Math.round(retail * 0.65)) as a fallback only.
 *
 * Retail prices, images, URLs and SKUs mirror Shopify on 2026-10-05.
 * Idempotent: keyed on the Zinc marker (last entry).
 */

const GLOBAL_HEALING = `
  {"name": "Lung Health 30ml Global Healing", "price": "7.678 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "lungu"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/global-healing-lung-health-30ml", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/lung-health_1.jpg?v=1790805570", "sku": "1179", "wholesale": "4.991 ISK"},
  {"name": "Lífrænt Tulsi Holy Basil 59ml Global Healing", "price": "7.794 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "tulsi"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/tulsi-gh-59-2ml", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/tulsi-holy-basil_1.jpg?v=1790805621", "sku": "1301", "wholesale": "5.066 ISK"},
  {"name": "Lífrænt Turmeric 59ml Global Healing", "price": "7.205 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "túrmerik"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/lifraent-turmeric-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/organic-liquid-turmeric_1.jpg?v=1790805511", "sku": "1220", "wholesale": "4.683 ISK"},
  {"name": "Paratrex II 59ml Global Healing", "price": "10.369 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "hreinsun"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/gh-paratrex-ii-59-2ml", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/paratrex-ii_1.jpg?v=1790805512", "sku": "1349", "wholesale": "6.740 ISK"},
  {"name": "Lífrænt Moringa 59ml Global Healing", "price": "8.117 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "moringa"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/global-healing-moringa", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/moringa_1.jpg?v=1790805620", "sku": "7048", "wholesale": "5.276 ISK"},
  {"name": "Toxin Binder 59ml Global Healing", "price": "9.020 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "hreinsun"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/toxin-binder-gh-59-2-ml", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/toxin-binder-detox_1.jpg?v=1790805512", "sku": "7049", "wholesale": "5.863 ISK"},
  {"name": "Candida Balance 120 hylki Global Healing", "price": "9.749 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "melting"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/candida-balance-gh-120hylki-1", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/candida-balance_1.jpg?v=1790805570", "sku": "7065", "wholesale": "6.337 ISK"},
  {"name": "Lífrænt Valerian 59ml Global Healing", "price": "7.461 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "svefn"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/valerian-gh-59-2-ml", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/valerian_1.jpg?v=1790805621", "sku": "7068", "wholesale": "4.850 ISK"},
  {"name": "Paratrex I 59ml Global Healing", "price": "10.369 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "hreinsun"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/paratrex-i-gh-120-hylki", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/paratrex-targeted-cleanse_1.jpg?v=1790805569", "sku": "7069", "wholesale": "6.740 ISK"},
  {"name": "Lífrænt Acid Reflux Relief 59ml Global Healing", "price": "8.909 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "melting"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/acid-reflux-relief-org-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/acid-reflux-relief-supplement_1.jpg?v=1790806866", "sku": "1762", "wholesale": "5.791 ISK"},
  {"name": "Lífrænt Aloe Vera 60 hylki Global Healing", "price": "10.302 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "melting"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/aloe-vera-org-60-stk-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/aloe-vera-capsules_1.jpg?v=1790806653", "sku": "1753", "wholesale": "6.696 ISK"},
  {"name": "Lífrænt Ashwagandha 59ml Global Healing", "price": "8.053 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "ashwagandha"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/ashwagandha-org-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/organic-ashwagandha_1.jpg?v=1790806867", "sku": "1763", "wholesale": "5.234 ISK"},
  {"name": "Bio-Active Copper 30 hylki Global Healing", "price": "13.795 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "steinefni"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/bio-active-copper-30-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/bio-active-copper-supplement_1.jpg?v=1790806653", "sku": "1752", "wholesale": "8.967 ISK"},
  {"name": "Boron 59ml Global Healing", "price": "9.362 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "steinefni"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/boron-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/boron_1.jpg?v=1790806780", "sku": "1760", "wholesale": "6.085 ISK"},
  {"name": "Brain Health 59ml Global Healing", "price": "9.536 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "heili"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/brain-health-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/herbal-brain-health-supplement_1.jpg?v=1790806868", "sku": "1764", "wholesale": "6.198 ISK"},
  {"name": "Detoxadine Nascent Iodine 30ml Global Healing", "price": "7.730 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "joð"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/detoxadine-org-30-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/detoxadine_1.jpg?v=1790806653", "sku": "1751", "wholesale": "5.024 ISK"},
  {"name": "Dr. Group's Cleansing Foot Pads 10 stk Global Healing", "price": "9.990 ISK", "cat": "Hreinlætisvörur", "tags": ["GlobalHealing", "Global Healing", "fótapúðar"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/dr-groups-cleansing-foot-pads-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/cleansing-foot-pads_1.jpg?v=1790806652", "sku": "1750", "wholesale": "6.494 ISK"},
  {"name": "Foreign Protein Cleanse 59ml Global Healing", "price": "10.757 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "hreinsun"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/foreign-protein-cleanse-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/foreign-protein-cleanse_1.jpg?v=1790806717", "sku": "1754", "wholesale": "6.992 ISK"},
  {"name": "Lífrænt Ginseng 59ml Global Healing", "price": "9.803 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "ginseng"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/ginseng-org-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/ginseng_1.jpg?v=1790806868", "sku": "1765", "wholesale": "6.372 ISK"},
  {"name": "Latero-Flora 60 hylki Global Healing", "price": "7.020 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "góðgerlar"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/latero-flora%E2%84%A2-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/latero-flora_1.jpg?v=1790806718", "sku": "1755", "wholesale": "4.563 ISK"},
  {"name": "Lífrænt Liver Health 59ml Global Healing", "price": "8.733 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "lifur"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/liver-health-org-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/liver-health_1.jpg?v=1790806868", "sku": "1766", "wholesale": "5.676 ISK"},
  {"name": "NAD+ 59ml Global Healing", "price": "9.914 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "NAD+"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/nad-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/nad_1.jpg?v=1790806780", "sku": "1761", "wholesale": "6.444 ISK"},
  {"name": "Selenium 59ml Global Healing", "price": "7.274 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "steinefni"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/selenium-liquid-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/liquid-selenium_1.jpg?v=1790806719", "sku": "1757", "wholesale": "4.728 ISK"},
  {"name": "Vitamin B12 30ml Global Healing", "price": "7.890 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "vítamín"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/vitamin-b12-liquid-30-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/organic-vitamin-b12-liquid_1.jpg?v=1790806719", "sku": "1756", "wholesale": "5.128 ISK"},
  {"name": "Vitamin C 59ml Global Healing", "price": "7.421 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "vítamín"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/vitamin-c-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/organic-liquid-vitamin-c_1.jpg?v=1790806779", "sku": "1758", "wholesale": "4.824 ISK"},
  {"name": "Zinc 59ml Global Healing", "price": "9.137 ISK", "cat": "Fæðubótarefni", "tags": ["GlobalHealing", "Global Healing", "steinefni"], "desc": "", "inStock": true, "url": "https://www.seidkarlinn.is/products/zinc-liquid-59-ml-gh", "img": "https://cdn.shopify.com/s/files/1/0657/8264/4910/files/zinc_1.jpg?v=1790806780", "sku": "1759", "wholesale": "5.939 ISK"},`;

const GH35_PATCH = `
<script id="__gh35_category_patch__">
(function(){
  var TAG = "GlobalHealing";
  var CAT_LABEL = "Global Healing";
  var DEFAULT_PCT = 35;

  function fmtISKLocal(n){
    try { if (typeof window.fmtISK === "function") return window.fmtISK(n); } catch(e){}
    return String(Math.round(n)).replace(/(\\d)(?=(\\d{3})+$)/g,"$1.") + " ISK";
  }
  function isGH(p){ return p && Array.isArray(p.tags) && p.tags.indexOf(TAG) !== -1; }
  function ghDiscPct(){
    try {
      var ov = (typeof window.getEffectivePricing === "function") ? window.getEffectivePricing() : null;
      if (ov && ov.cats && ov.cats[CAT_LABEL] != null) {
        var n = parseFloat(ov.cats[CAT_LABEL]);
        if (isFinite(n)) return Math.max(0, Math.min(100, n));
      }
    } catch(e){}
    return DEFAULT_PCT;
  }
  function hasFixedWsOverride(p){
    try {
      if (typeof window.getProdKey !== "function") return !!p._priceOverridden;
      var ov = (typeof window.getEffectivePricing === "function") ? window.getEffectivePricing() : null;
      var o = (ov && ov.prods) ? ov.prods[window.getProdKey(p)] : null;
      return !!(o && o.ws && o.ws > 0);
    } catch(e){ return !!p._priceOverridden; }
  }
  function patchApply(){
    if (typeof window.applyPricingOverrides !== "function") return false;
    if (window.applyPricingOverrides.__gh35Patched) return true;
    var orig = window.applyPricingOverrides;
    var wrapped = function(){
      var r = orig.apply(this, arguments);
      try {
        var disc = ghDiscPct();
        if (Array.isArray(window.PRODUCTS)) {
          window.PRODUCTS = window.PRODUCTS.map(function(p){
            if (!isGH(p) || p.noDisc || hasFixedWsOverride(p)) return p;
            var retail = parseInt((p.price||"").replace(/[^\\d]/g,""),10) || 0;
            if (retail <= 0) return p;
            return Object.assign({}, p, {
              wholesale: fmtISKLocal(Math.round(retail * (1 - disc/100))),
              _catOverridden: true, _gh35Overridden: true
            });
          });
        }
      } catch(e){ console.warn("[gh35-patch:apply]", e); }
      return r;
    };
    wrapped.__gh35Patched = true;
    window.applyPricingOverrides = wrapped;
    return true;
  }
  function rowHtml(){
    try {
      var ov = (window._pendingPricing) || {};
      var src = window.PRODUCTS_BASE || window.PRODUCTS || [];
      var count = 0;
      for (var i=0;i<src.length;i++) if (isGH(src[i])) count++;
      if (count === 0) return "";
      var hasOverride = !!(ov.cats && ov.cats[CAT_LABEL] !== undefined);
      var discVal = hasOverride ? ov.cats[CAT_LABEL] : DEFAULT_PCT;
      var custom = hasOverride && Number(ov.cats[CAT_LABEL]) !== DEFAULT_PCT;
      var badge = custom
        ? '<span class="disc-badge custom">Sérsniðið: ' + ov.cats[CAT_LABEL] + '%</span>'
        : '<span class="disc-badge global">Sjálfgefið: ' + DEFAULT_PCT + '%</span>';
      var resetBtn = hasOverride
        ? '<button class="fulfill-btn do-pending" onclick="resetCatDisc(\\'' + CAT_LABEL + '\\')">↺ Endurstilla</button>'
        : '';
      return ''
        + '<tr data-gh35-row="1">'
        +   '<td style="font-weight:500;color:var(--ink)">Global Healing '
        +     '<span style="font-size:10px;color:var(--ink3);font-weight:400">(merki: GlobalHealing)</span></td>'
        +   '<td style="color:var(--ink3)">' + count + '</td>'
        +   '<td><div style="display:flex;align-items:center;gap:6px">'
        +     '<input type="number" class="disc-input" min="0" max="100" value="' + discVal + '" '
        +       'data-cat="' + CAT_LABEL + '" '
        +       'oninput="updateCatDisc(\\'' + CAT_LABEL + '\\',this.value)" '
        +       'onblur="this.value=Math.min(100,Math.max(0,parseInt(this.value)||0))">'
        +     '<span style="font-size:11px;color:var(--ink3)">%</span></div></td>'
        +   '<td>' + badge + '</td>'
        +   '<td>' + resetBtn + '</td>'
        + '</tr>';
    } catch(e){ console.warn("[gh35-patch:row]", e); return ""; }
  }
  function patchRender(){
    if (typeof window.renderCategoryPricingTab !== "function") return false;
    if (window.renderCategoryPricingTab.__gh35Patched) return true;
    var orig = window.renderCategoryPricingTab;
    var wrapped = function(){
      var html = orig.apply(this, arguments) || "";
      try {
        var extra = rowHtml();
        if (extra && html.indexOf("</tbody>") !== -1) html = html.replace("</tbody>", extra + "</tbody>");
      } catch(e){ console.warn("[gh35-patch:render]", e); }
      return html;
    };
    wrapped.__gh35Patched = true;
    window.renderCategoryPricingTab = wrapped;
    return true;
  }
  var tries = 0;
  function tryPatch(){
    var aOk = patchApply(), rOk = patchRender();
    if (aOk && rOk) {
      try { if (typeof window.applyPricingOverrides === "function") window.applyPricingOverrides(); } catch(e){}
      try { if (typeof window.rebuildLiveCatalog === "function") window.rebuildLiveCatalog(); } catch(e){}
      console.log("[gh35-patch] installed (apply+render).");
      return;
    }
    if (++tries < 60) setTimeout(tryPatch, 100);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tryPatch);
  else tryPatch();
})();
</script>
`;

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();

  if (!html.includes('"Zinc 59ml Global Healing"')) {
    html = html.replace('const PRODUCTS = [', `const PRODUCTS = [${GLOBAL_HEALING}`);
  }
  if (!html.includes('__gh35_category_patch__')) {
    const i = html.lastIndexOf('</body>');
    html = i !== -1 ? html.slice(0, i) + GH35_PATCH + html.slice(i) : html + GH35_PATCH;
  }

  return new Response(html, { status: response.status, headers: response.headers });
}

export const config = { path: '/' };
