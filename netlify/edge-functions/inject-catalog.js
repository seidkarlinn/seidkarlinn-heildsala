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
 *
 * 2026-05-13: Inject favicon <link> tags into <head>. The actual binary
 *   favicon content is served by netlify/edge-functions/favicons.js at
 *   /favicon.ico, /favicon-32.png, /favicon-180.png. Idempotent — skips
 *   if a favicon link is already present in source. Hrefs include a
 *   ?v=N query string for cache-busting whenever the favicon image
 *   bytes change (bump FAVICON_VERSION below to force a refetch).
 *
 * 2026-05-28: Injected 4 new products (Sea Moss, Moringa, Full Spectrum
 *   Maca, Lignosus 450mg) that received fresh product photos on Shopify
 *   today. Uses the same edge-function pattern as CordyFresh so the
 *   500KB index.html doesn't need to be touched. Also strips the stale
 *   "seidkarlinn-maca-600mg-120hylki" URL from the baked ADMIN_DELETED
 *   list and removes the old maca block from PRODUCTS to avoid a
 *   duplicate listing.
 *
 * 2026-05-28 (2): Added Seiðkarlinn Shilajit 60 hylki (5th product) and
 *   extended the deleted-URL stripping to handle multiple URLs. Also
 *   added a one-time localStorage migration script — for admin users,
 *   ws_deleted_products keeps its own copy of deleted URLs (separate
 *   from ADMIN_DELETED), so admins who previously deleted maca/shilajit
 *   would still see them filtered even after this edge-level cleanup.
 *   The migration is idempotent — runs once per URL per browser.
 *
 * 2026-05-28 (3): Hotfix — the (2) commit's URL stripping included a
 *   bare-string `"URL"` strip that also matched inside the injected
 *   PRODUCTS entries' "url":"…" field, blanking them out and breaking
 *   the page. Dropped the bare strip; comma-delimited forms cover
 *   every position inside ADMIN_DELETED on their own.
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

// 5 products added 2026-05-28 — fresh photos uploaded to Shopify today.
// Wholesale prices use the standard 25% off retail (Math.floor(retail * 0.75)).
// All five are baked here (rather than added to index.html) so the 500KB
// source file stays untouched. Idempotent guard below keys on the Sea Moss
// marker so this can later be migrated into index.html without
// double-injecting.
const NEW_PRODUCTS_20260528 = `
  {"name":"Seiðkarlinn Irish Sea Moss with bladderwrack 60 hylki","price":"6.990 ISK","cat":"Fæðubótarefni","tags":["sea moss","bladderwrack","ofurfæða","joð","steinefni"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/seidkarlinn-sea-moss-60-hylki","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/2_e06f226f-9ead-4f7a-b499-2f95cbf5bfb1.png?v=1780001234","wholesale":"5.242 ISK"},
  {"name":"Seiðkarlinn Moringa 350mg 60 hylki","price":"3.990 ISK","cat":"Fæðubótarefni","tags":["moringa","supermat","andoxun","þreyta","næring"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/seidkarlinn-moringa-350mg-60-hylki","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/4_2a40b944-a6f4-4d11-a49b-e28658315a3d.png?v=1780001095","wholesale":"2.992 ISK"},
  {"name":"Seiðkarlinn Full Spectrum Maca 600mg 120 hylki","price":"4.990 ISK","cat":"Fæðubótarefni","tags":["maca","hormónabalans","orkugjafi","frjósemi","Peru"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/seidkarlinn-maca-600mg-120hylki","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/3_5e37c0ff-cb5c-433b-8b54-906d67c7b85b.png?v=1780001057","wholesale":"3.742 ISK"},
  {"name":"Seiðkarlinn Lignosus 450mg 60 hylki","price":"5.990 ISK","cat":"Sveppir","tags":["lignosus","tiger milk","sveppur","ónæmiskerfi"],"desc":"","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/seidkarlinn-lignosus-450mg-60-hylki","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/1_528e6f7a-7f66-4c82-9ea3-c7315d2d3c44.png?v=1780001022","wholesale":"4.492 ISK"},
  {"name":"Seiðkarlinn Shilajit 60 hylki","price":"6.990 ISK","cat":"Fæðubótarefni","tags":["shilajit","fulvic acid","steinefni","orkugjafi"],"desc":"500mg Shilajit hylki 83% Fulvic Acid sem er um það bil 2-3x sterkara en meðalshilajit í töflum á markaði.","inStock":true,"url":"https://www.seidkarlinn.is/is-is/products/seidkarlinn-shilajit-60-hylki","img":"https://cdn.shopify.com/s/files/1/0657/8264/4910/files/1_d410b220-2211-46dd-b9af-6521f5d76f8a.png?v=1778671558","wholesale":"5.242 ISK"},`;

// Stale entries that need to come back out of the deleted list, because the
// fresh NEW_PRODUCTS_20260528 entries reuse their Shopify URLs. If we leave
// these in ADMIN_DELETED, the new entries get filtered out for non-admin
// viewers; if we leave them in admin localStorage, they stay hidden for the
// admin too (admins use their own localStorage list rather than ADMIN_DELETED).
const STALE_DELETED_URLS = [
  'https://www.seidkarlinn.is/is-is/products/seidkarlinn-maca-600mg-120hylki',
  'https://www.seidkarlinn.is/is-is/products/seidkarlinn-shilajit-60-hylki',
];

// The original "Seiðkarlinn maca 600mg 120 hylki" entry baked into
// index.html shares its URL with the new Full Spectrum Maca entry above and
// would render as a duplicate listing — strip it from the served HTML.
const OLD_MACA_BLOCK_RE = /\{\s*\n\s*"name":\s*"Seiðkarlinn maca 600mg 120 hylki",[\s\S]*?"wholesale":\s*"3\.742 ISK"\s*\},?\s*\n/;
// The original "Seiðkarlinn shilajit 60 hylki" entry baked into index.html
// shares its URL with the fresh-photo Shilajit entry injected above and would
// render as a duplicate listing — strip it from the served HTML. (Mirrors the
// maca handling; the original 2026-05-28 injection forgot this one because the
// baked entry uses a lowercase "shilajit" while the idempotency guard keys on
// the capital-S "Shilajit", so the guard never suppressed the injection.)
const OLD_SHILAJIT_BLOCK_RE = /\{\s*\n\s*"name":\s*"Seiðkarlinn shilajit 60 hylki",[\s\S]*?"wholesale":\s*"5\.242 ISK"\s*\},?\s*\n/;

// One-time localStorage migration injected into the page. Admin users have
// their own ws_deleted_products array (separate from the baked ADMIN_DELETED
// list); after a URL is brought back at the edge level, we still need to
// remove it from each admin's local list, otherwise their view continues to
// filter it. Keyed on STALE_DELETED_URLS above. Idempotent — uses a
// per-URL marker in localStorage so it only runs once per browser.
const LOCALSTORAGE_MIGRATION = `
<script id="__deleted_url_migration_2026_05_28__">
(function(){
  try {
    var STALE = ${JSON.stringify(STALE_DELETED_URLS)};
    var MARKER = "ws_migration_2026_05_28_stale_urls";
    if (localStorage.getItem(MARKER) === "1") return;
    var raw = localStorage.getItem("ws_deleted_products");
    if (raw) {
      try {
        var list = JSON.parse(raw);
        if (Array.isArray(list)) {
          var cleaned = list.filter(function(u){ return STALE.indexOf(u) === -1; });
          if (cleaned.length !== list.length) {
            localStorage.setItem("ws_deleted_products", JSON.stringify(cleaned));
            console.log("[migration:2026-05-28] restored", list.length - cleaned.length, "URLs from ws_deleted_products");
          }
        }
      } catch(e){ /* ignore parse errors */ }
    }
    localStorage.setItem(MARKER, "1");
  } catch(e){ /* localStorage unavailable */ }
})();
</script>
`;

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

// Favicon <link> tags — added 2026-05-13.
// Binary favicon files are served by the sibling edge function favicons.js
// (HTTP-routed at /favicon.ico, /favicon-32.png, /favicon-180.png). The
// favicons.js handler keys on url.pathname, so the ?v=N query string is
// transparent to it — but visible to browsers, which bust their cache on URL
// change. Bump FAVICON_VERSION any time the favicon image bytes change.
const FAVICON_VERSION = '2';
const FAVICON_LINKS = `
    <link rel="icon" type="image/x-icon" href="/favicon.ico?v=${FAVICON_VERSION}">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=${FAVICON_VERSION}">
    <link rel="apple-touch-icon" sizes="180x180" href="/favicon-180.png?v=${FAVICON_VERSION}">
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

  // 2b. Inject the 5 new products from 2026-05-28 at the start of PRODUCTS.
  //     Idempotent: keyed on the Shilajit marker (last entry added).
  if (!injected.includes('"Seiðkarlinn Shilajit 60 hylki"')) {
    injected = injected.replace(
      'const PRODUCTS = [',
      `const PRODUCTS = [${NEW_PRODUCTS_20260528}`
    );
  }

  // 2c. Remove the stale maca block (same URL as the new Full Spectrum Maca)
  //     from the served PRODUCTS array so the listing isn't duplicated.
  //     Idempotent: regex no-ops if the block has already been removed.
  injected = injected.replace(OLD_MACA_BLOCK_RE, '');

  // 2c-bis. Remove the stale baked shilajit block (same URL as the injected
  //         fresh-photo Shilajit entry) so the listing isn't duplicated.
  //         Idempotent: regex no-ops if the block has already been removed.
  injected = injected.replace(OLD_SHILAJIT_BLOCK_RE, '');

  // 2d. Strip stale-deleted URLs from the baked ADMIN_DELETED list so the
  //     resurrected entries aren't filtered out for non-admin viewers.
  //     Only strip the comma-delimited forms — never the bare quoted URL,
  //     which would also obliterate the "url":"…" field inside our injected
  //     PRODUCTS entries and break the page (incident 2026-05-28).
  //     Idempotent: each replace no-ops if the URL is absent.
  for (const u of STALE_DELETED_URLS) {
    injected = injected.split(`"${u}", `).join('');
    injected = injected.split(`, "${u}"`).join('');
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

  // 3b. Inject the one-time admin localStorage migration just after <head>
  //     so it runs as early as possible (before any script reads
  //     ws_deleted_products). Idempotent at two levels: this guard avoids
  //     re-injecting the tag, and the script's own marker avoids re-running
  //     the migration inside the browser.
  if (!injected.includes('__deleted_url_migration_2026_05_28__')) {
    injected = injected.replace('<head>', `<head>${LOCALSTORAGE_MIGRATION}`);
  }

  // 4. Inject favicon <link> tags right after <head>. Idempotent guard: skip
  //    if the source HTML already has a favicon reference (lets a future
  //    baked-in version take over without double-injecting). We check
  //    "/favicon.ico" without the ?v= suffix so a bare baked reference still
  //    counts.
  if (!injected.includes('href="/favicon.ico') && !injected.includes('rel="icon"')) {
    injected = injected.replace('<head>', `<head>${FAVICON_LINKS}`);
  }

  return new Response(injected, {
    status: response.status,
    headers: response.headers,
  });
}

export const config = { path: '/' };
