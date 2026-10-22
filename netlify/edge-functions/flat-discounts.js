/**
 * Netlify Edge Function — flat per-line wholesale discounts (2026-10-04).
 *
 * Kept as its own small file (inline config, path "/") so the large
 * inject-catalog.js / index.html don't need to be touched. Same mechanism as
 * CORDYFRESH_PATCH / HONEY40_PATCH in inject-catalog.js: a runtime script
 * wraps applyPricingOverrides() and renderCategoryPricingTab(). Every rule is
 * a virtual category in ws_pricing.cats, so the admin can still set a
 * per-customer % in "Verð og afslættir"; otherwise the default applies to
 * every buyer regardless of their real-category percentage.
 *
 *   • "VAICACAO"   30% — the ceremonial cacao line sits in cat
 *     "Seremóníu Kakó", which nobody's pricing contains (template has
 *     "Kakó"), so it rendered at 0% / full retail.
 *   • "Hunang 35%" 35% — the 21 older Seiðkarlinn honey/bee SKUs in
 *     HONEY35_SLUGS (matched on Shopify URL handle).
 *   • "Nutriest 30%" 30% — Nutriest bone broth (thin cost margin).
 *   • "Nutriest 35%" 35% — Nutriest whey, hydrolyzed + marine collagen,
 *     deep ocean minerals, ox bile (NUTRIEST35_SLUGS).
 *   • "Nutriest 40%" 40% — every other Nutriest product (2026-10-04, per
 *     margin analysis: landed cost vs. seidkarlinn.is retail).
 *   • "Mountaindrop 30%" 30% — PRIME 600g, Himalayan shilajit 45g + 100g.
 *   • "Mountaindrop 40%" 40% — Altai shilajit 25g, 40g, 65g.
 *   • "Mountaindrop 25%" 25% — Genius 450g, Flourish 600g (2026-10-05, per
 *     Mountaindrop margin analysis: cost incl. innskattur + shipping).
 *   • "Hunang 40%" 40% — every other Hunangsafurðir product. noDisc buckets
 *     keep their fixed price; the Hunang40 line keeps its own patch (40%).
 *
 * Also fills the empty retail "price" of two baked SKUs (Mountaindrop Altai
 * shilajit 65gr, propolis tincture 30ml) from Shopify, so a discount can be
 * computed for them at all.
 *
 * Removes the lyngblóma hunang SKUs (1kg, 500g) and the six Mulieres
 * candles from the catalogue.
 */

// Runtime patch — flat per-line discounts (2026-10-04). Same mechanism as
// CORDYFRESH_PATCH / HONEY40_PATCH but rule-driven.
const HONEY35_SLUGS = [
  'seidkarlinn-villibloma-hratt-hunang-1kg',
  'seidkarinn-villibloma-hungang-500g',
  'seidkarlinn-appelsinu-hratt-hunang-1kg',
  'seidkarlinn-appelsinu-hunang-500g',
  'seidkarlinn-appelsinu-hratt-hunang-med-hunangskamb-500gr',
  'seidkarlinn-hafjallahunang-1kg',
  'hafjallahunang-500g',
  'wildesland-beauty-2f1-300g-1',          // háfjalla hunang með kamb 500g
  'seidkarlinn-rosmarin-hratt-hunang-1kg',
  'seidkarlinn-rosmarin-hunang-500g',
  'timianbloma-hunang-1kg',
  'timianbloma-hunang-500g',
  'zh-immune-premium-60-hylki-1',          // skógarblóma hunang 1kg
  'seidkarlinn-skogarbloma-500g',
  'vitamin-d3-k2-dropar-30ml',             // honey pollen propolis 480g
  'virkja-islensk-burnirot-100ml-1',       // honey pollen propolis 300g
  'seidkarlinn-byflugnafrjo-480g',
  'seidkarlinn-byflugnafrjo-240g',
  'seidkarlinn-hunangsgjafaaskja-3x350gr',
  'wildesland-balance-2f1-300g-1',         // orange honey vinegar 250ml
  'vitamin-d3-dropar-30ml',                // propolis tincture 30ml
  'seidkarlinn-hunangskambur-250g',        // hunangskambur 250/290/310/330g (2026-10-22)
];

// 2026-10-04: Nutriest wholesale tiers (matched on Shopify URL handle).
const NUTRIEST30_SLUGS = [
  'nutriest-beef-bone-broth-250g',
];
const NUTRIEST35_SLUGS = [
  'nutriest-whey-protein-1kg',
  'nutriest-hydrolyzed-collagen-peptides-300g',
  'nutriest-marine-collagen-300g',
  'nutriest-deep-ocean-minerals-100ml',
  'nutriest-ox-bile-60-hylki',
];

// 2026-10-05: Mountaindrop wholesale tiers (matched on Shopify URL handle).
const MD30_SLUGS = [
  'mountaindrop-prime-test-booster-600g',
  'mountaindrop-himalayan-shilajit-45gr',
  'mountaindrop-himalayan-shilajit-100gr',
];
const MD40_SLUGS = [
  'mountaindrop-shilajit-25gr',
  'mountaindrop-shilajit-40gr',
  'mountaindrop-shilajit-65gr',
];
const MD25_SLUGS = [
  'mountaindrop-genius-brain-booster-450g',
  'mountaindrop-flourish-600g',
];

const FLAT_RULES_PATCH = `
<script id="__flat_rules_patch__">
(function(){
  var HONEY35 = ${JSON.stringify(HONEY35_SLUGS)};
  var NUT30 = ${JSON.stringify(NUTRIEST30_SLUGS)};
  var NUT35 = ${JSON.stringify(NUTRIEST35_SLUGS)};
  var MD30 = ${JSON.stringify(MD30_SLUGS)};
  var MD40 = ${JSON.stringify(MD40_SLUGS)};
  var MD25 = ${JSON.stringify(MD25_SLUGS)};
  function slug(p){ return String((p && p.url) || "").split("?")[0].replace(/\\/+$/,"").split("/").pop(); }
  function hasTag(p,t){ return p && Array.isArray(p.tags) && p.tags.indexOf(t) !== -1; }
  // First matching rule wins.
  var RULES = [
    { key: "VAICACAO",   label: "VAICACAO seremóníu kakó", def: 30,
      match: function(p){ return /vaicacao/i.test(p.name||"") || /\\/vaicacao-/i.test(p.url||""); } },
    { key: "Nutriest 30%", label: "Nutriest beinaseyði", def: 30,
      match: function(p){ return NUT30.indexOf(slug(p)) !== -1; } },
    { key: "Nutriest 35%", label: "Nutriest prótín, kollagen, steinefni, gall", def: 35,
      match: function(p){ return NUT35.indexOf(slug(p)) !== -1; } },
    { key: "Nutriest 40%", label: "Nutriest – aðrar vörur", def: 40,
      match: function(p){ return /^nutriest-/i.test(slug(p)) || /^nutriest\\b/i.test(p.name||""); } },
    { key: "Mountaindrop 30%", label: "Mountaindrop PRIME, Himalayan shilajit 45g/100g", def: 30,
      match: function(p){ return MD30.indexOf(slug(p)) !== -1; } },
    { key: "Mountaindrop 40%", label: "Mountaindrop Altai shilajit 25g/40g/65g", def: 40,
      match: function(p){ return MD40.indexOf(slug(p)) !== -1; } },
    { key: "Mountaindrop 25%", label: "Mountaindrop Genius, Flourish", def: 25,
      match: function(p){ return MD25.indexOf(slug(p)) !== -1; } },
    { key: "Hunang 35%", label: "Eldra Seiðkarlinn hunang", def: 35,
      match: function(p){ return HONEY35.indexOf(slug(p)) !== -1; } },
    { key: "Hunang 40%", label: "Annað hunang (Hunangsafurðir)", def: 40,
      match: function(p){ return p.cat === "Hunangsafurðir" && !hasTag(p,"Hunang40"); } }
  ];

  function fmtISKLocal(n){
    try { if (typeof window.fmtISK === "function") return window.fmtISK(n); } catch(e){}
    return String(Math.round(n)).replace(/(\\d)(?=(\\d{3})+$)/g,"$1.") + " ISK";
  }
  function ruleFor(p){
    if (!p || hasTag(p,"Cordyfresh") || hasTag(p,"Hunang40")) return null;
    for (var i=0;i<RULES.length;i++) if (RULES[i].match(p)) return RULES[i];
    return null;
  }
  function pctFor(rule, ov){
    if (ov && ov.cats && ov.cats[rule.key] != null) {
      var n = parseFloat(ov.cats[rule.key]);
      if (isFinite(n)) return Math.max(0, Math.min(100, n));
    }
    return rule.def;
  }
  function hasFixedWs(p, ov){
    try {
      if (typeof window.getProdKey !== "function") return false;
      var o = (ov && ov.prods) ? ov.prods[window.getProdKey(p)] : null;
      return !!(o && o.ws && o.ws > 0 && !(ov.cats && ov.cats[o.cat || p.cat] != null));
    } catch(e){ return false; }
  }

  function patchApply(){
    if (typeof window.applyPricingOverrides !== "function") return false;
    if (window.applyPricingOverrides.__flatRulesPatched) return true;
    var orig = window.applyPricingOverrides;
    var wrapped = function(){
      var r = orig.apply(this, arguments);
      try {
        var ov = (typeof window.getEffectivePricing === "function") ? window.getEffectivePricing() : null;
        if (Array.isArray(window.PRODUCTS)) {
          window.PRODUCTS = window.PRODUCTS.map(function(p){
            var rule = ruleFor(p);
            if (!rule || p.noDisc) return p;
            if (hasFixedWs(p, ov)) return p;
            var retail = parseInt((p.price||"").replace(/[^\\d]/g,""),10) || 0;
            if (retail <= 0) return p;
            var ws = Math.round(retail * (1 - pctFor(rule, ov)/100));
            return Object.assign({}, p, { wholesale: fmtISKLocal(ws), _catOverridden: true, _flatRule: rule.key });
          });
        }
      } catch(e){ console.warn("[flat-rules-patch:apply]", e); }
      return r;
    };
    wrapped.__flatRulesPatched = true;
    window.applyPricingOverrides = wrapped;
    return true;
  }

  function rowsHtml(){
    var out = "";
    try {
      var ov = window._pendingPricing || {};
      var src = window.PRODUCTS_BASE || window.PRODUCTS || [];
      RULES.forEach(function(rule){
        var count = 0;
        for (var i=0;i<src.length;i++) if (ruleFor(src[i]) === rule && !src[i].noDisc) count++;
        if (!count) return;
        var has = !!(ov.cats && ov.cats[rule.key] !== undefined);
        var val = has ? ov.cats[rule.key] : rule.def;
        var custom = has && Number(ov.cats[rule.key]) !== rule.def;
        var badge = custom
          ? '<span class="disc-badge custom">Sérsniðið: ' + ov.cats[rule.key] + '%</span>'
          : '<span class="disc-badge global">Sjálfgefið: ' + rule.def + '%</span>';
        var k = rule.key.replace(/'/g,"\\\\'");
        var reset = has ? '<button class="fulfill-btn do-pending" onclick="resetCatDisc(\\'' + k + '\\')">↺ Endurstilla</button>' : '';
        out += '<tr data-flat-rule="' + rule.key + '">'
          + '<td style="font-weight:500;color:var(--ink)">' + rule.label
          + ' <span style="font-size:10px;color:var(--ink3);font-weight:400">(fastur afsláttur)</span></td>'
          + '<td style="color:var(--ink3)">' + count + '</td>'
          + '<td><div style="display:flex;align-items:center;gap:6px">'
          + '<input type="number" class="disc-input" min="0" max="100" value="' + val + '" data-cat="' + rule.key + '" '
          + 'oninput="updateCatDisc(\\'' + k + '\\',this.value)" '
          + 'onblur="this.value=Math.min(100,Math.max(0,parseInt(this.value)||0))">'
          + '<span style="font-size:11px;color:var(--ink3)">%</span></div></td>'
          + '<td>' + badge + '</td><td>' + reset + '</td></tr>';
      });
    } catch(e){ console.warn("[flat-rules-patch:row]", e); }
    return out;
  }

  function patchRender(){
    if (typeof window.renderCategoryPricingTab !== "function") return false;
    if (window.renderCategoryPricingTab.__flatRulesPatched) return true;
    var orig = window.renderCategoryPricingTab;
    var wrapped = function(){
      var html = orig.apply(this, arguments) || "";
      try {
        var extra = rowsHtml();
        if (extra && html.indexOf("</tbody>") !== -1) html = html.replace("</tbody>", extra + "</tbody>");
      } catch(e){ console.warn("[flat-rules-patch:render]", e); }
      return html;
    };
    wrapped.__flatRulesPatched = true;
    window.renderCategoryPricingTab = wrapped;
    return true;
  }

  var tries = 0;
  function tryPatch(){
    var aOk = patchApply(), rOk = patchRender();
    if (aOk && rOk) {
      try { window.applyPricingOverrides(); } catch(e){}
      try { if (typeof window.rebuildLiveCatalog === "function") window.rebuildLiveCatalog(); } catch(e){}
      console.log("[flat-rules-patch] installed.");
      return;
    }
    if (++tries < 60) setTimeout(tryPatch, 100);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tryPatch);
  else tryPatch();
})();
</script>
`;


// 2026-10-04: Two SKUs are baked into index.html with an empty "price", so no
// discount could be computed for them. Fill retail from Shopify (variant
// price) at the edge rather than touching the 500KB index.html.
const PRICE_FIXES = [
  { url: 'https://www.seidkarlinn.is/is-is/products/mountaindrop-shilajit-65gr', price: '22.990 ISK' }, // SKU 12003
  { url: 'https://www.seidkarlinn.is/is-is/products/vitamin-d3-dropar-30ml',     price: '4.100 ISK' },  // propolis tincture, SKU 1551
];
function applyPriceFixes(html) {
  for (const f of PRICE_FIXES) {
    const i = html.indexOf(`"url": "${f.url}"`);
    if (i === -1) continue;
    const start = html.lastIndexOf('{', i);
    const end = html.indexOf('}', i);
    if (start === -1 || end === -1) continue;
    let block = html.slice(start, end + 1);
    block = block.replace('"price": ""', `"price": "${f.price}"`).replace('"wholesale": ""', `"wholesale": "${f.price}"`);
    html = html.slice(0, start) + block + html.slice(end + 1);
  }
  return html;
}

// 2026-10-04 (2): Lyngblóma hunang is taken out of the wholesale catalogue.
// Strip both baked entries from the served PRODUCTS array (matched on URL).
const REMOVED_URLS = [
  'https://www.seidkarlinn.is/is-is/products/seidkarlinn-lyngbloma-hunang-1kg',
  'https://www.seidkarlinn.is/is-is/products/seidkarlinn-lyngbloma-hunang-500g',
  // 2026-10-04 (3): Mulieres candles out of the wholesale catalogue.
  'https://www.seidkarlinn.is/is-is/products/natural-candle-forest-180ml',
  'https://www.seidkarlinn.is/is-is/products/natural-candle-gingerbread-180ml',
  'https://www.seidkarlinn.is/is-is/products/natural-candle-pure-180ml',
  'https://www.seidkarlinn.is/is-is/products/natural-candle-pure-120ml',
  'https://www.seidkarlinn.is/is-is/products/natural-candle-gingerbread-120ml',
  'https://www.seidkarlinn.is/is-is/products/natural-candle-forest-120ml',
];
function removeProducts(html) {
  for (const u of REMOVED_URLS) {
    const i = html.indexOf(`"url": "${u}"`);
    if (i === -1) continue;
    const start = html.lastIndexOf('{', i);
    let end = html.indexOf('}', i);
    if (start === -1 || end === -1) continue;
    end += 1;
    const m = /^\s*,/.exec(html.slice(end));
    if (m) end += m[0].length;
    html = html.slice(0, start) + html.slice(end);
  }
  return html;
}

// 2026-10-22: Hunangskambur Seiðkarlinn (Shopify seidkarlinn-hunangskambur-250g,
// ACTIVE) — all four weight variants as separate listings. url carries
// ?variant=<id> so cart/overrides/deletions stay distinct; the slug() match
// strips the query, so HONEY35_SLUGS puts the whole line on "Hunang 35%".
// ws-stock returns per-variant stock as "<handle>#<variantId>".
const HONEYCOMB_20261022 = `
  {"name":"Hunangskambur 250g Seiðkarlinn","price":"2.990 ISK","cat":"Hunangsafurðir","tags":["hunang","hunangskambur","hrátt","Seiðkarlinn"],"desc":"","inStock":true,"sku":"1566","url":"https://www.seidkarlinn.is/is-is/products/seidkarlinn-hunangskambur-250g?variant=48918139011246","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/hunangskambur_250g.jpg?v=1782422003","wholesale":"1.944 ISK"},
  {"name":"Hunangskambur 290g Seiðkarlinn","price":"3.470 ISK","cat":"Hunangsafurðir","tags":["hunang","hunangskambur","hrátt","Seiðkarlinn"],"desc":"","inStock":true,"sku":"1566-290","url":"https://www.seidkarlinn.is/is-is/products/seidkarlinn-hunangskambur-250g?variant=48918138847406","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/hunangskambur_250g.jpg?v=1782422003","wholesale":"2.256 ISK"},
  {"name":"Hunangskambur 310g Seiðkarlinn","price":"3.710 ISK","cat":"Hunangsafurðir","tags":["hunang","hunangskambur","hrátt","Seiðkarlinn"],"desc":"","inStock":true,"sku":"1566-310","url":"https://www.seidkarlinn.is/is-is/products/seidkarlinn-hunangskambur-250g?variant=48918138880174","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/hunangskambur_250g.jpg?v=1782422003","wholesale":"2.412 ISK"},
  {"name":"Hunangskambur 330g Seiðkarlinn","price":"3.950 ISK","cat":"Hunangsafurðir","tags":["hunang","hunangskambur","hrátt","Seiðkarlinn"],"desc":"","inStock":true,"sku":"1566-330","url":"https://www.seidkarlinn.is/is-is/products/seidkarlinn-hunangskambur-250g?variant=48918138912942","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/hunangskambur_250g.jpg?v=1782422003","wholesale":"2.568 ISK"},`;
function injectHoneycomb(html) {
  if (html.includes('"Hunangskambur 330g Seiðkarlinn"')) return html;
  return html.replace('const PRODUCTS = [', `const PRODUCTS = [${HONEYCOMB_20261022}`);
}

// Per-variant stock for listings whose url carries ?variant=<id>. The stock
// overlay (ws-stock-layer.js) keys on handle only, so all variants would get
// the product total. ws-stock now also returns "<handle>#<variantId>"; this
// wrapper sits outside the stock overlay and re-asserts the variant figure.
const VARIANT_STOCK_PATCH = `
<script id="__variant_stock_patch__">
(function(){
  function key(p){
    var u = String((p && p.url) || ""), i = u.indexOf("/products/"), q = u.indexOf("variant=");
    if (i === -1 || q === -1) return null;
    var h = u.slice(i + 10).split("?")[0].split("#")[0].split("/")[0];
    var v = u.slice(q + 8).split("&")[0].split("#")[0];
    return h && v ? h + "#" + v : null;
  }
  function apply(){
    var map = window._wsLiveStock, n = 0;
    if (!map) return 0;
    ["PRODUCTS", "PRODUCTS_BASE"].forEach(function(w){
      var a = window[w];
      if (!Array.isArray(a)) return;
      a.forEach(function(p){
        var k = key(p), e = k ? map[k] : null;
        if (!e) return;
        var want = e.a === 1;
        if (p.inStock !== want) { p.inStock = want; n++; }
      });
    });
    return n;
  }
  function wrap(){
    var f = window.applyPricingOverrides;
    if (typeof f !== "function" || !f._liveStockWrapped || f.__variantStock) return;
    var w = function(){ var r = f.apply(this, arguments); try { apply(); } catch(e){} return r; };
    w._liveStockWrapped = true; w._skuWrapped = f._skuWrapped; w.__variantStock = true;
    w.__flatRulesPatched = f.__flatRulesPatched;
    window.applyPricingOverrides = w;
  }
  var last = null;
  setInterval(function(){
    wrap();
    if (window._wsLiveStock && window._wsLiveStock !== last) {
      last = window._wsLiveStock;
      if (apply()) {
        try { if (typeof window.rebuildLiveCatalog === "function") window.rebuildLiveCatalog(); } catch(e){}
        try { if (typeof window.renderGrid === "function") window.renderGrid(); } catch(e){}
        try { if (typeof window.renderProductsPanel === "function") window.renderProductsPanel(); } catch(e){}
      }
    }
  }, 1000);
})();
</script>
`;

export default async function handler(request, context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  html = applyPriceFixes(html);
  html = removeProducts(html);
  html = injectHoneycomb(html);

  // Insert before the document's FINAL </body> (index.html has an earlier
  // </body> inside a JS template literal). Idempotent.
  if (!html.includes('__flat_rules_patch__')) {
    const idx = html.lastIndexOf('</body>');
    html = idx !== -1 ? html.slice(0, idx) + FLAT_RULES_PATCH + html.slice(idx) : html + FLAT_RULES_PATCH;
  }
  if (!html.includes('__variant_stock_patch__')) {
    const idx = html.lastIndexOf('</body>');
    html = idx !== -1 ? html.slice(0, idx) + VARIANT_STOCK_PATCH + html.slice(idx) : html + VARIANT_STOCK_PATCH;
  }

  return new Response(html, { status: response.status, headers: response.headers });
}

export const config = { path: '/' };
