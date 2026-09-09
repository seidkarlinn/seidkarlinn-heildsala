/* ═══════════════════════════════════════════════════════════════════════════
   ws-vorunumer.js — show Vörunúmer on wholesale products
   ---------------------------------------------------------------------------
   index.html already renders a "Vörunúmer" row in the product detail panel and
   a column in the admin Vörur table whenever a product carries `sku`, but the
   baked catalogue has no sku on any product, so the row never appeared.

   WHERE THE NUMBERS COME FROM
     The Vörunúmer in the Söluvörur spreadsheet and the SKU in Shopify are the
     same number — spot-checked on 2026-09-09 (Maca 1235, KSM-66 1236, Reishi
     1237, Varia Maca 7062 …), and 45 of the 71 four-digit numbers in the sheet
     match the Shopify SKU of the same product exactly, with no contradictions.
     So rather than hardcoding a copy of the spreadsheet that goes stale the
     day a product is added, we read the SKU that ws-stock already returns
     (field `k`) — one source, kept current automatically.

   WHY NOT WRITE sku INTO ws_pricing
     applyPricingOverrides() takes a *different pricing branch* for any product
     that has an entry in ov.prods. For a product whose category has no discount
     for that buyer, that branch ends at `ws = baseRetailNum` — full retail —
     instead of leaving the baked-in wholesale price alone. Adding a bare
     { sku } entry would therefore silently reprice products. This overlay
     touches nothing but the sku field.

   PRECEDENCE
     A sku already on the product wins: an admin edit in Vörustjórnun, or a
     per-product override, is deliberate and must not be overwritten by the
     catalogue-wide default.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  // Products that are DRAFT in Shopify are absent from the public storefront
  // feed, so ws-stock cannot see them until SHOPIFY_ADMIN_TOKEN is set on the
  // site. These 24 are in the wholesale catalogue and visible to buyers, so
  // their numbers are pinned here (read from the Shopify Admin API on
  // 2026-09-09). Once the admin token is configured, ws-stock returns these
  // too and this map becomes redundant — harmless either way, because the
  // live map is consulted first.
  var DRAFT_SKUS = {
    "seidkarlinn-lyngbloma-hunang-1kg": "1557",
    "seidkarlinn-lyngbloma-hunang-500g": "1558",
    "seidkarlinn-skogarbloma-1kg": "1559",
    "seidkarlinn-skogarbloma-500g": "1560",
    "varia-sveppablanda-duft-50-skammtar": "7045",
    "varia-reishi-duft-50-skammtar": "7043",
    "varia-lions-mane-dropar-0-alkahol-100ml": "7055",
    "varia-lions-mane-dropar-med-alkaholi-50ml": "7071",
    "varia-cordyceps-dropar-0-alkahol-100ml": "7056",
    "varia-cordyceps-dropar-med-alkaholi-50ml": "7070",
    "varia-sveppablanda-dropar-0-alkahol-100ml": "7054",
    "varia-sveppablanda-dropar-med-alkoholi-50-ml": "7044",
    "seidkarlinn-colloidal-silver-50ml": "1556",
    "seidkarlinn-colloidal-silver-1l": "1555",
    "naturavit-rosemary-water-100ml": "1317",
    "dental-floss-in-bamboo-case": "1588",
    "bath-brush-bamboo": "1599",
    "krg-pure-extract": "1419",
    "natural-multi-cleaner-pure-unscented-0-45l": "1255",
    "natural-multi-cleaner-fresh-citrus-0-45l": "1256",
    "natural-multi-cleaner-rose-garden-0-45l": "1257",
    "natural-multi-cleaner-nordic-forest-0-45l": "1258",
    "bucket-runny-orange-honey-10kg": "1650",
    "bucket-runny-pyrenees-honey-10kg": "1651"
  };

  function handleOf(p) {
    var m = String((p && p.url) || "").match(/\/products\/([^\/?#]+)/);
    if (!m) return null;
    // Same stale-handle remap the stock overlay uses (ws-stock-layer.js).
    var fixes = window._wsHandleFixes || window.WS_STOCK_HANDLE_FIXES || {};
    return fixes[m[1]] || m[1];
  }

  function skuFor(p) {
    var h = handleOf(p);
    if (!h) return null;
    var live = window._wsLiveStock && window._wsLiveStock[h];
    if (live && live.k) return String(live.k);
    return DRAFT_SKUS[h] || null;
  }

  function applySkus() {
    var changed = 0;
    ["PRODUCTS", "PRODUCTS_BASE"].forEach(function (which) {
      var arr = window[which];
      if (!Array.isArray(arr)) return;
      arr.forEach(function (p) {
        if (!p || p.sku) return;          // never overwrite a deliberate sku
        var s = skuFor(p);
        if (s) { p.sku = s; changed++; }
      });
    });
    return changed;
  }
  window._wsApplySkus = applySkus;

  function install() {
    if (typeof window.applyPricingOverrides !== "function") return false;
    if (window.applyPricingOverrides._skuWrapped) return true;
    var orig = window.applyPricingOverrides;
    window.applyPricingOverrides = function () {
      var r = orig.apply(this, arguments);
      applySkus();
      return r;
    };
    window.applyPricingOverrides._skuWrapped = true;
    return true;
  }

  function refresh() {
    install();
    var n = applySkus();
    if (n) {
      try { if (typeof renderGrid === "function") renderGrid(); } catch (e) {}
      try { if (typeof renderProductsPanel === "function") renderProductsPanel(); } catch (e) {}
      console.log("[ws-vorunumer] " + n + " vörunúmer sett á vörur");
    }
  }

  // The live map arrives asynchronously (ws-stock-layer fetches it), so run
  // once now for the pinned drafts and again once the fetch has landed.
  install();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh);
  else refresh();
  window.addEventListener("load", refresh);
  window.addEventListener("ws-sync-ready", function () { setTimeout(refresh, 400); });
  [1200, 3000, 6000].forEach(function (ms) { setTimeout(refresh, ms); });
})();
