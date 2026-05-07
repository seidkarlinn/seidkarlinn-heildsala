/**
 * Netlify Edge Function — runs at CDN level before HTML is served
 * Fetches catalog state from kvdb and injects deleted list into the HTML.
 * Also injects the CordyFresh product set into the PRODUCTS array
 * (added 2026-05-06; sourced from Shopify, applied at 30% wholesale discount).
 *
 * 2026-05-07: Added a runtime patch script that:
 *   • Adds a virtual "Cordyfresh" discount category to the admin pricing panel
 *     (selected by tag, not p.cat — cat stays "Sveppir").
 *   • Routes wholesale price for tag:"Cordyfresh" products through that
 *     category, with default 30% if no admin override exists for the
 *     active user/global. Replaces the previously-hardcoded 30% derivation.
 */

// 8 CordyFresh entries — Cordyceps/Lions Mane/Reishi/Chaga at 20% and 50% strengths.
// Retail prices match the Shopify store; wholesale is now derived at runtime via
// the "Cordyfresh" category override (default 30%). The baked wholesale string
// below is kept for cart-fallback paths that read p.wholesale before
// applyPricingOverrides() has run.
const CORDYFRESH = `
  {"name":"Cordyceps 20% Cordyfresh 30ml","price":"5.990 ISK","cat":"Sveppir","tags":["cordyceps","dropar","tvíextrakt","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/cordyceps-20-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Cordyceps-20.jpg?v=1777761668","wholesale":"4.193 ISK"},
  {"name":"Lions Mane 20% Cordyfresh 30ml","price":"5.990 ISK","cat":"Sveppir","tags":["lions mane","dropar","tvíextrakt","NGF","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/lions-mane-20-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Lions-Mane-20.jpg?v=1777761653","wholesale":"4.193 ISK"},
  {"name":"Reishi 20% Cordyfresh 30ml","price":"5.990 ISK","cat":"Sveppir","tags":["reishi","dropar","tvíextrakt","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/reishi-20-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Reishi-20.jpg?v=1777761640","wholesale":"4.193 ISK"},
  {"name":"Chaga 20% Cordyfresh 30ml","price":"5.990 ISK","cat":"Sveppir","tags":["chaga","dropar","tvíextrakt","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/chaga-20-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Chaga-20.jpg?v=1777761629","wholesale":"4.193 ISK"},
  {"name":"Cordyceps 50% Cordyfresh 30ml","price":"11.990 ISK","cat":"Sveppir","tags":["cordyceps","dropar","tvíextrakt","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/cordyceps-50-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Cordyceps-50.jpg?v=1777761674","wholesale":"8.393 ISK"},
  {"name":"Lions Mane 50% Cordyfresh 30ml","price":"11.990 ISK","cat":"Sveppir","tags":["lions mane","dropar","tvíextrakt","NGF","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/lions-mane-50-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Lions-Mane-50.jpg?v=1777761662","wholesale":"8.393 ISK"},
  {"name":"Reishi 50% Cordyfresh 30ml","price":"11.990 ISK","cat":"Sveppir","tags":["reishi","dropar","tvíextrakt","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/reishi-50-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Reishi-50.jpg?v=1777761647","wholesale":"8.393 ISK"},
  {"name":"Chaga 50% Cordyfresh 30ml","price":"11.990 ISK","cat":"Sveppir","tags":["chaga","dropar","tvíextrakt","Cordyfresh"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/chaga-50-cordyfresh-30ml","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/Chaga-50.jpg?v=1777761634","wholesale":"8.393 ISK"},`;

// Runtime patch — installs after the page's main script defines its globals.
// Kept as a self-contained IIFE so the existing index.html stays untouched.
const CORDYFRESH_PATCH = `
<script id="__cordyfresh_category_patch__">
(function(){
  var TAG = "Cordyfresh";        // tag selector
  var CAT_LABEL = "Cordyfresh";  // virtual category key (used in ws_pricing.cats[...])
  var DEFAULT_PCT = 30;          // preserves prior hardcoded 30% off behavior

  function fmtISKLocal(n){
    try { if (typeof window.fmtISK === "function") return window.fmtISK(n); } catch(e){}
    return String(Math.round(n)).replace(/(\\d)(?=(\\d{3})+$)/g,"$1.") + " ISK";
  }

  function isCordy(p){
    return p && Array.isArray(p.tags) && p.tags.indexOf(TAG) !== -1;
  }

  function cordyDiscPct(){
    try {
      var ov = (typeof window.getEffectivePricing === "function")
        ? window.getEffectivePricing() : null;
      if (ov && ov.cats && ov.cats[CAT_LABEL] != null) {
        var n = parseFloat(ov.cats[CAT_LABEL]);
        if (isFinite(n)) return Math.max(0, Math.min(100, n));
      }
    } catch(e){}
    return DEFAULT_PCT;
  }

  // ── Hook 1: applyPricingOverrides ─────────────────────────────
  // After the original runs, post-process window.PRODUCTS so every
  // tag:"Cordyfresh" product's wholesale reflects the Cordyfresh
  // category discount (or the 30% default), unless that product has
  // an explicit product-level override (_priceOverridden true).
  function patchApply(){
    if (typeof window.applyPricingOverrides !== "function") return false;
    if (window.applyPricingOverrides.__cordyPatched) return true;
    var orig = window.applyPricingOverrides;
    var wrapped = function(){
      var r = orig.apply(this, arguments);
      try {
        var disc = cordyDiscPct();
        if (Array.isArray(window.PRODUCTS)) {
          window.PRODUCTS = window.PRODUCTS.map(function(p){
            if (!isCordy(p)) return p;
            if (p._priceOverridden) return p; // admin product-level override wins
            var retail = parseInt((p.price||"").replace(/[^\\d]/g,""),10) || 0;
            if (retail <= 0) return p;
            var ws = Math.round(retail * (1 - disc/100));
            return Object.assign({}, p, {
              wholesale: fmtISKLocal(ws),
              _catOverridden: true,
              _cordyfreshOverridden: true
            });
          });
        }
      } catch(e){ console.warn("[cordyfresh-patch:apply]", e); }
      return r;
    };
    wrapped.__cordyPatched = true;
    window.applyPricingOverrides = wrapped;
    return true;
  }

  // ── Hook 2: renderCategoryPricingTab ──────────────────────────
  // Append a "Cordyfresh" row to the admin pricing-panel category table.
  // The row uses the existing updateCatDisc / resetCatDisc helpers so
  // the value is staged in _pendingPricing.cats["Cordyfresh"] and saved
  // by the existing savePricing() flow into ws_pricing[_users].
  function rowHtml(){
    try {
      var ov = (window._pendingPricing) || {};
      var src = window.PRODUCTS_BASE
              || (typeof window.PRODUCTS_BASE !== "undefined" ? window.PRODUCTS_BASE : null)
              || window.PRODUCTS || [];
      var count = 0;
      for (var i=0;i<src.length;i++) if (isCordy(src[i])) count++;
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
        + '<tr data-cordyfresh-row="1">'
        +   '<td style="font-weight:500;color:var(--ink)">'
        +     'CordyFresh sveppir '
        +     '<span style="font-size:10px;color:var(--ink3);font-weight:400">(merki: Cordyfresh)</span>'
        +   '</td>'
        +   '<td style="color:var(--ink3)">' + count + '</td>'
        +   '<td>'
        +     '<div style="display:flex;align-items:center;gap:6px">'
        +       '<input type="number" class="disc-input" min="0" max="100" '
        +              'value="' + discVal + '" '
        +              'data-cat="' + CAT_LABEL + '" '
        +              'oninput="updateCatDisc(\\'' + CAT_LABEL + '\\',this.value)" '
        +              'onblur="this.value=Math.min(100,Math.max(0,parseInt(this.value)||0))">'
        +       '<span style="font-size:11px;color:var(--ink3)">%</span>'
        +     '</div>'
        +   '</td>'
        +   '<td>' + badge + '</td>'
        +   '<td>' + resetBtn + '</td>'
        + '</tr>';
    } catch(e){
      console.warn("[cordyfresh-patch:row]", e);
      return "";
    }
  }

  function patchRender(){
    if (typeof window.renderCategoryPricingTab !== "function") return false;
    if (window.renderCategoryPricingTab.__cordyPatched) return true;
    var orig = window.renderCategoryPricingTab;
    var wrapped = function(){
      var html = orig.apply(this, arguments) || "";
      try {
        var extra = rowHtml();
        if (extra && html.indexOf("</tbody>") !== -1) {
          html = html.replace("</tbody>", extra + "</tbody>");
        }
      } catch(e){ console.warn("[cordyfresh-patch:render]", e); }
      return html;
    };
    wrapped.__cordyPatched = true;
    window.renderCategoryPricingTab = wrapped;
    return true;
  }

  // Try patching immediately and on a short retry loop until both hooks land.
  var tries = 0;
  function tryPatch(){
    var aOk = patchApply();
    var rOk = patchRender();
    if (aOk && rOk) {
      // Re-run pricing so live prices reflect the new override on first load.
      try { if (typeof window.applyPricingOverrides === "function") window.applyPricingOverrides(); } catch(e){}
      try { if (typeof window.rebuildLiveCatalog === "function") window.rebuildLiveCatalog(); } catch(e){}
      console.log("[cordyfresh-patch] installed (apply+render).");
      return;
    }
    if (++tries < 60) setTimeout(tryPatch, 100);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryPatch);
  } else {
    tryPatch();
  }
})();
</script>
`;

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

  const html = await response.text();

  // 1. Inject the deleted list (existing behavior — runs before any scripts).
  let injected = html.replace(
    '<script>',
    `<script>window.__SERVER_DELETED__=${deletedJSON};window.__SERVER_CATALOG_READY__=true;</script>\n<script>`
  );

  // 2. Inject the CordyFresh entries at the start of the PRODUCTS array.
  //    Idempotent: only inject if the marker entry isn't already present
  //    (prevents double-injection if products are later baked into source).
  if (!injected.includes('"Cordyceps 20% Cordyfresh 30ml"')) {
    injected = injected.replace(
      'const PRODUCTS = [',
      `const PRODUCTS = [${CORDYFRESH}`
    );
  }

  // 3. Inject the runtime category-patch script just before the document's
  //    final </body>. We use lastIndexOf because index.html contains an
  //    earlier </body> string inside a JS template literal (the invoice
  //    HTML around line 8036) that we must NOT replace. Idempotent.
  if (!injected.includes('__cordyfresh_category_patch__')) {
    const closeIdx = injected.lastIndexOf('</body>');
    if (closeIdx !== -1) {
      injected = injected.slice(0, closeIdx) + CORDYFRESH_PATCH + injected.slice(closeIdx);
    } else {
      injected += CORDYFRESH_PATCH;
    }
  }

  return new Response(injected, {
    status: response.status,
    headers: response.headers,
  });
}

export const config = { path: '/' };
