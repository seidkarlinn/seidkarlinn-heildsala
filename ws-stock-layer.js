/* ═══════════════════════════════════════════════════════════════════════════
   ws-stock-layer.js — live Shopify stock for the wholesale portal
   ---------------------------------------------------------------------------
   Loaded at the end of <body> by netlify/edge-functions/inject-stock-layer.js,
   i.e. after index.html's inline scripts have defined applyPricingOverrides()
   and getEffectivePricing(), so both wrappers below install immediately.

   Lives in its own file rather than inside ws-sync-layer.js only because
   ws-sync-layer.js (and index.html) are too large to push through the GitHub
   connector — same reason the CordyFresh product set is injected at the edge.
   ═══════════════════════════════════════════════════════════════════════════ */

// Products renamed/replaced on Shopify after the catalogue snapshot in
// index.html: STALE handle in product.url -> current live handle. This
// mirrors SHOPIFY_HANDLE_FIXES in ws-sync-layer.js; that copy is used by the
// manual "Samstilla" buttons, this one by the automatic overlay. Keep both in
// step when a product is renamed again. window._wsHandleFixes wins if a future
// ws-sync-layer.js exposes it, so the duplicate can be retired from here.
var WS_STOCK_HANDLE_FIXES = {
  'vitamin-d3-dropar-30ml': 'seidkarlinn-propolis-tincture-30ml',
  'zh-immune-premium-60-hylki-1': 'seidkarlinn-skogarbloma-1kg',
  'wildesland-beauty-2f1-300g-1': 'seidkarlinn-hafjalla-hunang-med-kamb-500g',
  'vibrant-health-green-vibrance-25-billions-probiotics-330gr-1': 'seidkarlinn-moringa-350mg-60-hylki',
  'wildesland-balance-2f1-300g-1': 'seidkarlinn-orange-honey-vinegar-250ml',
  'vibrant-health-green-vibrance-25-billions-probiotics-660gr-1': 'seidkarlinn-lignosus-450mg-60-hylki',
  'wildesland-mobility-2f1-300g-1': 'seidkarlinn-colloidal-silver-50ml',
  'virkja-islensk-burnirot-100ml-1': 'seidkarlinn-honey-pollen-propolis-300g',
  'wildesland-belly-2f1-300g-1': 'seidkarlinn-colloidal-silver-1l',
  'ventrusca-tuna-in-olive-oil-120g': 'seidkarlinn-raudrofur-450mg-60-hylki',
  'vitamin-d3-k2-180-toflur-1': 'seidkarlinn-fig-jam-and-orange-honey-260g',
  'vitamin-d3-k2-dropar-30ml': 'seidkarlinn-honey-pollen-propolis-480g',
  'arbosana-palacio-olifuolia-500ml': 'seidkarlinn-olifuolia-early-harvest-unfiltered-arbequina-500ml'
};


/* ═══════════════════════════════════════════════════════════════════════════
   Live Shopify stock overlay  (automatic — no "Samstilla" click required)
   ---------------------------------------------------------------------------
   PROBLEM (2026-09-09)
     Products that were sold out on Shopify kept showing "Til á lager" in the
     wholesale portal — e.g. Nutriest beef liver 240 hylki, Nutriest pregnancy
     and fertility 240 hylki, Nutriest hydrolyzed collagen peptides 300g and
     Ginseng Extract Everyone Blue KRG (all 0 or negative on hand in Shopify).
     Three separate causes:

       1) NOTHING SYNCED BY ITSELF. Stock only moved when an admin opened the
          portal and clicked "Samstilla" (syncWithShopify), which wrote inStock
          overrides into the Blob Store. Between clicks the catalogue showed the
          baked-in inStock value from index.html, which is a snapshot.

       2) BUYER OVERRIDES SHADOWED THE GLOBAL ONE. getEffectivePricing() merges
          per-buyer prods entries over the global map with a shallow
          Object.assign, so a buyer who had ANY per-product entry (a price, an
          image) replaced the whole object — including the global inStock:false
          the sync had just written. Patched by the second block in this file;
          the overlay also makes it moot, because the overlay runs last.

       3) DRAFT PRODUCTS WERE UNREACHABLE. The old sync read the public
          storefront feed, which only lists products published to the Online
          Store, so 49 catalogue items (DRAFT in Shopify) could never be
          corrected by it at all.

   FIX
     /.netlify/functions/ws-stock returns a handle -> { a: 1|0, q: qty } map
     built from the Shopify Admin API (all statuses, real inventory counts).
     We fetch it on every load and re-assert inStock on window.PRODUCTS after
     each catalogue rebuild, exactly like the img/category fixes in
     ws-sync-layer.js.

   DELIBERATE DESIGN NOTES
     • Read-only. The overlay never writes to the Blob Store — stock is derived
       data owned by Shopify, and runtime data must not be churned by it.
       (The admin "Samstilla" button still writes overrides; that is unchanged.)
     • This file loads after ws-sync-layer.js, so its applyPricingOverrides
       wrapper is the outermost one and gets the last word on inStock, ahead of
       the custom-product / image / category wrappers installed there.
     • Products the map does not know (admin custom products, bulk buckets) are
       left exactly as they are — absence is never treated as "sold out".
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var ENDPOINT = "/.netlify/functions/ws-stock";
  var REFRESH_MS = 5 * 60 * 1000;

  window._wsLiveStock = null;        // { handle: {a,q} } once loaded
  window._wsLiveStockMeta = null;    // { source, generatedAt, count }

  function handleOf(p) {
    var m = String((p && p.url) || "").match(/\/products\/([^\/?#]+)/);
    if (!m) return null;
    var fixes = window._wsHandleFixes || WS_STOCK_HANDLE_FIXES;
    return fixes[m[1]] || m[1];
  }

  // Re-assert live stock on the freshly rebuilt catalogue. Also patches
  // PRODUCTS_BASE so panels that read the base array (admin Vörustjórnun)
  // agree with the buyer grid.
  function applyLiveStock() {
    var map = window._wsLiveStock;
    if (!map) return 0;
    var changed = 0;
    ["PRODUCTS", "PRODUCTS_BASE"].forEach(function (which) {
      var arr = window[which];
      if (!Array.isArray(arr)) return;
      arr.forEach(function (p) {
        if (!p) return;
        var h = handleOf(p);
        if (!h) return;
        var live = map[h];
        if (!live) return;              // unknown to Shopify — leave untouched
        var want = live.a === 1;
        if (p.inStock !== want) { p.inStock = want; changed++; }
      });
    });
    return changed;
  }
  window._wsApplyLiveStock = applyLiveStock;

  function install() {
    if (typeof window.applyPricingOverrides !== "function") return false;
    if (window.applyPricingOverrides._liveStockWrapped) return true;
    var orig = window.applyPricingOverrides;
    window.applyPricingOverrides = function () {
      var r = orig.apply(this, arguments);
      applyLiveStock();                // last word on inStock
      return r;
    };
    window.applyPricingOverrides._liveStockWrapped = true;
    return true;
  }

  function repaint() {
    try { if (typeof window.applyPricingOverrides === "function") window.applyPricingOverrides(); } catch (e) {}
    try { if (typeof rebuildLiveCatalog === "function") rebuildLiveCatalog(); } catch (e) {}
    try { if (typeof renderGrid === "function") renderGrid(); } catch (e) {}
    try { if (typeof renderProductsPanel === "function") renderProductsPanel(); } catch (e) {}
  }

  function load(force) {
    return fetch(ENDPOINT + (force ? "?fresh=1" : ""), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok || !d.stock) return;
        window._wsLiveStock = d.stock;
        window._wsLiveStockMeta = { source: d.source, generatedAt: d.generatedAt, count: d.count, cached: !!d.cached };
        install();
        var changed = applyLiveStock();
        console.log("[ws-stock] " + d.count + " vörur frá " + d.source +
                    (d.adminError ? " (admin ófáanlegt: " + d.adminError + ")" : "") +
                    " — " + changed + " lagerstöður uppfærðar");
        if (changed) repaint();
      })
      .catch(function (e) { console.warn("[ws-stock] gat ekki sótt lagerstöðu:", e); });
  }
  window._wsReloadStock = function () { return load(true).then(repaint); };

  function boot() { install(); load(false); }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.addEventListener("load", install);
  window.addEventListener("ws-sync-ready", function () { setTimeout(function () { install(); applyLiveStock(); }, 300); });
  setInterval(function () { load(false); }, REFRESH_MS);
})();


/* ═══════════════════════════════════════════════════════════════════════════
   Per-buyer override shadowing fix  (inStock / img)
   ---------------------------------------------------------------------------
   getEffectivePricing() in index.html merges a buyer's per-product overrides
   over the global ones with a plain Object.assign:

       prods: Object.assign({}, global.prods || {}, u.prods || {})

   Object.assign replaces the WHOLE per-product object, so a buyer who had any
   entry for a product — often just a price or a fixed image — silently dropped
   the global inStock/img that the Shopify sync had written for it. Result:
   sold-out products stayed on "Til á lager" for exactly the customers who had
   custom pricing, which is most of them.

   We wrap getEffectivePricing and fill inStock/img back in from the global map
   whenever the buyer's own entry does not carry them. Prices are deliberately
   left alone: a buyer's price entry must keep overriding the global one in
   full. Patched from here rather than edited in index.html because that file
   is ~530 KB and cannot be pushed through the GitHub connector.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  function install() {
    if (typeof window.getEffectivePricing !== "function") return false;
    if (window.getEffectivePricing._stockMergeWrapped) return true;
    var orig = window.getEffectivePricing;
    window.getEffectivePricing = function () {
      var eff = orig.apply(this, arguments) || {};
      try {
        var global = {};
        try { global = JSON.parse(localStorage.getItem("ws_pricing") || "{}"); } catch (e) {}
        var gp = global.prods;
        if (!gp || !eff.prods || eff.prods === gp) return eff;
        var prods = Object.assign({}, eff.prods);
        Object.keys(gp).forEach(function (k) {
          var g = gp[k], e = prods[k];
          if (!g || !e || e === g) return;
          var merged = null;
          if (typeof e.inStock !== "boolean" && typeof g.inStock === "boolean") {
            merged = Object.assign({}, e); merged.inStock = g.inStock;
          }
          if (!e.img && g.img) {
            merged = merged || Object.assign({}, e); merged.img = g.img;
          }
          if (merged) prods[k] = merged;
        });
        eff = { cats: eff.cats, prods: prods };
      } catch (e) { console.warn("[ws-stockmerge] failed:", e); }
      return eff;
    };
    window.getEffectivePricing._stockMergeWrapped = true;
    return true;
  }

  function installAndRefresh() {
    if (install()) {
      try { if (typeof window.applyPricingOverrides === "function") window.applyPricingOverrides(); } catch (e) {}
      try { if (typeof renderGrid === "function") renderGrid(); } catch (e) {}
    }
  }

  // Install as early as possible so the first catalogue build already sees the
  // merged overrides, then re-assert on the usual lifecycle hooks.
  install();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installAndRefresh);
  else installAndRefresh();
  window.addEventListener("load", install);
  window.addEventListener("ws-sync-ready", function () { setTimeout(installAndRefresh, 200); });
})();
