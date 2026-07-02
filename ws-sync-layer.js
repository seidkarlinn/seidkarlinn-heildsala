(function () {
  "use strict";
  var API = "/.netlify/functions/ws-data";
  var SYNC_KEYS = [
    "ws_orders","ws_invoice_seq","ws_buyer_accounts","ws_custom_products",
    "ws_deleted_products","ws_pricing","ws_pricing_users","ws_vidskm","ws_last_order","ws_cache_version","ws_product_info","ws_theme","ws_product_order"
  ];

  function pushToServer(key, value) {
    try {
      // keepalive:true so fetch survives page unload/refresh,
      // preventing a stale server pull from overwriting fresh local changes.
      var body = JSON.stringify({ key: key, value: value });
      fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true
      }).catch(function (err) { console.warn("[ws-sync] push failed for " + key + ": ", err); });
      try { window._wsPending = window._wsPending || {}; window._wsPending[key] = body; } catch(e) {}
    } catch (e) {}
  }

  var originalSetItem = localStorage.setItem.bind(localStorage);
  var originalGetItem = localStorage.getItem.bind(localStorage);
  var _syncPullDone = false;

  function mergeServerData(serverData) {
    if (!serverData) return;
    var MERGE_KEYS = [
      "ws_orders","ws_invoice_seq","ws_buyer_accounts","ws_custom_products",
      "ws_deleted_products","ws_pricing","ws_pricing_users","ws_vidskm","ws_last_order","ws_product_info","ws_theme","ws_product_order"
    ];
    MERGE_KEYS.forEach(function (key) {
      if (serverData[key] !== undefined && serverData[key] !== null) {
        var serverVal = serverData[key];
        var localVal;
        try { localVal = JSON.parse(originalGetItem(key) || "null"); } catch (e) { localVal = null; }

        if (key === "ws_orders" && Array.isArray(serverVal)) {
          // Compare authoritative last-modified timestamps.
          // ws_orders_lm is only written when admin does a force:true delete/clear.
          // If the server's lm is newer than the client's, the server performed an
          // authoritative edit after the client last synced — REPLACE local with
          // server data so admin-deleted orders are not resurrected by stale localStorage.
          var server_lm = (serverData['ws_orders_lm'] && typeof serverData['ws_orders_lm'] === 'string')
            ? serverData['ws_orders_lm'] : null;
          var local_lm = originalGetItem('ws_orders_lm') || null;
          var serverIsNewer = server_lm && (!local_lm || server_lm > local_lm);

          if (serverIsNewer) {
            // Server performed an authoritative admin action after client last synced.
            // Replace local entirely — do NOT merge and do NOT push stale data back up.
            originalSetItem('ws_orders', JSON.stringify(serverVal));
            originalSetItem('ws_orders_lm', server_lm);
            console.log('[ws-sync] Server ws_orders_lm newer (' + server_lm + ' > ' + local_lm + ') — replaced local orders with server-authoritative list (' + serverVal.length + ' orders).');
            return;
          }

          var localArr = Array.isArray(localVal) ? localVal : [];
          var merged = mergeOrders(localArr, serverVal);
          originalSetItem(key, JSON.stringify(merged));
          // Keep local lm in sync (if server has one and we don't yet)
          if (server_lm && !local_lm) originalSetItem('ws_orders_lm', server_lm);
          // If local had orders the server didn't (e.g. keepalive fetch failed during
          // mobile page navigation to payment gateway), push the merged set back up so
          // the admin panel sees all orders.
          if (merged.length > serverVal.length) {
            pushToServer(key, merged);
          }
          return;
        }
        if (key === "ws_invoice_seq") {
          var best = Math.max(parseInt(serverVal, 10) || 0, parseInt(localVal, 10) || 0);
          originalSetItem(key, String(best));
          return;
        }
        originalSetItem(key, JSON.stringify(serverVal));
      }
    });
  }

  function mergeOrders(localOrders, serverOrders) {
    var byId = {};
    function addOrder(o) {
      if (!o || !o.id) return;
      if (!byId[o.id]) { byId[o.id] = o; return; }
      var existingDate = new Date(byId[o.id].date || 0).getTime();
      var newDate = new Date(o.date || 0).getTime();
      if (newDate > existingDate) byId[o.id] = o;
    }
    serverOrders.forEach(addOrder);
    localOrders.forEach(addOrder);
    return Object.values(byId).sort(function (a, b) {
      return new Date(b.date || 0) - new Date(a.date || 0);
    });
  }

  localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (_syncPullDone && SYNC_KEYS.indexOf(key) !== -1) {
      var parsed;
      try { parsed = JSON.parse(value); } catch (e) { parsed = value; }
      pushToServer(key, parsed);
    }
  };

  // Exposed helper: write server-fetched data into localStorage WITHOUT
  // triggering a push back to the server. Use this in all "read from server"
  // paths to prevent accidental overwrite of newer local writes.
  window._wsReceiveFromServer = function(key, value) {
    try {
      originalSetItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch(e) {}
  };

  window._wsSyncReady = false;
  fetch(API + "?key=_all")
    .then(function (res) { return res.json(); })
    .then(function (json) {
      if (json.ok && json.data) {
        mergeServerData(json.data);
        console.log("[ws-sync] Server data loaded and merged.");
        // Re-apply the shared theme now that the server's ws_theme has been
        // merged into localStorage, so first-visit / guest sessions converge on
        // the same colors + logo font as returning users (the app applies the
        // theme once at load, before this async sync completes).
        try {
          if (typeof window.applyTheme === "function" && typeof window.getTheme === "function") {
            window.applyTheme(window.getTheme());
          }
        } catch (e) { console.warn("[ws-sync] theme re-apply failed:", e); }
      }
      _syncPullDone = true;
      window._wsSyncReady = true;
      window.dispatchEvent(new CustomEvent("ws-sync-ready"));
    })
    .catch(function (err) {
      console.warn("[ws-sync] Initial pull failed (offline?):", err);
      _syncPullDone = true;
      window._wsSyncReady = true;
      window.dispatchEvent(new CustomEvent("ws-sync-ready"));
    });

  console.log("[ws-sync] Sync layer installed. Keys tracked:", SYNC_KEYS.length);

  // ─── DEFAULT PRICING SEED ────────────────────────────────────────────────
  // After sync completes, any buyer account (from ws_buyer_accounts or
  // ws_vidskm) that does not yet have an entry in ws_pricing_users — or has
  // an empty entry — is seeded with the standard category-discount template.
  // This guarantees new users get the right per-category percentages out of
  // the box, instead of falling back to the 25% global default.
  //
  // Runs admin-side only: the seeding write is pushed to the server, so it
  // only needs to happen once for any given user. Edit STANDARD_PRICING_TEMPLATE
  // here to change the default applied to all future new users.
  var STANDARD_PRICING_TEMPLATE = {
    cats: {
      "Drykkir": 30,
      "Frostþurrkaðir ávextir": 30,
      "Fæðubótarefni": 35,
      "Hreinlætisvörur": 30,
      "Hunangsafurðir": 35,
      "Hárvörur": 30,
      "Húðvörur": 30,
      "Kakó": 30,
      "Shilajit": 35,
      "Sveppir": 35,
      "Ólífuolíur": 30,
      "Tannhirða": 25,
      "Rakstursvörur": 30,
      "Eldhúsáhöld": 30
    },
    prods: {}
  };

  function seedDefaultPricing() {
    try {
      // Only run for the admin session — buyers don't have permission to
      // mutate other users' pricing and shouldn't push to the server here.
      if (originalGetItem("ws_role") !== "admin") return;

      var pricingUsers = {};
      try { pricingUsers = JSON.parse(originalGetItem("ws_pricing_users") || "{}"); } catch (e) { pricingUsers = {}; }

      // Collect candidate usernames from both possible sources.
      var candidates = {};
      try {
        var accounts = JSON.parse(originalGetItem("ws_buyer_accounts") || "{}");
        Object.keys(accounts || {}).forEach(function (u) {
          // Skip default/system users — they typically aren't real customers
          // and may have intentional non-standard pricing.
          if (["heildsala", "demo", "buyer1"].indexOf(u) === -1) candidates[u] = true;
        });
      } catch (e) {}
      try {
        var vidskm = JSON.parse(originalGetItem("ws_vidskm") || "[]");
        if (Array.isArray(vidskm)) {
          vidskm.forEach(function (v) {
            if (v && v.user) candidates[v.user] = true;
          });
        }
      } catch (e) {}

      var dirty = false;
      Object.keys(candidates).forEach(function (user) {
        var lc = user.toLowerCase();
        var existing = pricingUsers[user] || pricingUsers[lc];
        var isEmpty = existing
          && (!existing.cats || Object.keys(existing.cats).length === 0)
          && (!existing.prods || Object.keys(existing.prods).length === 0);
        if (!existing || isEmpty) {
          pricingUsers[lc] = JSON.parse(JSON.stringify(STANDARD_PRICING_TEMPLATE));
          dirty = true;
          console.log("[ws-sync] Seeded standard pricing for new user: " + user);
        }
      });

      if (dirty) {
        // Use the patched setItem so the change is mirrored to localStorage
        // AND pushed to the server via the sync layer.
        localStorage.setItem("ws_pricing_users", JSON.stringify(pricingUsers));
        console.log("[ws-sync] Pricing seed pushed to server.");
        // Hint the UI to re-render pricing.
        try { window.dispatchEvent(new CustomEvent("ws-pricing-seeded")); } catch (e) {}
      }
    } catch (e) {
      console.warn("[ws-sync] seedDefaultPricing failed:", e);
    }
  }

  // Run seed after sync completes. Listener AND timeout poll, in case
  // event fires before our listener registers.
  window.addEventListener("ws-sync-ready", function () { setTimeout(seedDefaultPricing, 250); });
  setTimeout(function () { if (window._wsSyncReady) seedDefaultPricing(); }, 3000);

  window.addEventListener("beforeunload", function() {
    try {
      if (!window._wsPending) return;
      Object.keys(window._wsPending).forEach(function(k) {
        try { navigator.sendBeacon(API, new Blob([window._wsPending[k]], { type: "application/json" })); } catch(e) {}
      });
    } catch(e) {}
  });
})();


/* ═══════════════════════════════════════════════════════════════════════════
   Shopify sync hardening (hotfix override layer)
   ---------------------------------------------------------------------------
   Overrides window.syncShopifyImages / window.syncWithShopify (defined inline
   in index.html). Installed on DOMContentLoaded so it runs AFTER those inline
   declarations and therefore wins when the "Samstilla" buttons are clicked
   (the buttons resolve the function by name at click time).

   Fixes two production issues:
     1) IMAGE SYNC RATE-LIMITING — the old loop fired 10 concurrent requests
        per batch with no delay and no retry, so Shopify replied HTTP 429 and
        ~half the products silently kept their old image on a full run. Now:
        concurrency 4, a short delay between batches, and 429 back-off that
        honours Retry-After.
     2) STALE (RENAMED) HANDLES — 13 products were renamed on Shopify; their
        old handle now 404s with no redirect, so neither stock nor image sync
        could ever reach them. SHOPIFY_HANDLE_FIXES remaps the stale handle to
        the current live handle *at fetch time only* — product.url is left
        untouched so getProdKey() identity and saved per-customer pricing
        overrides are preserved.

   NOTE: 33 further products (26 DRAFT, 7 ARCHIVED in Shopify) are simply not
   published to the Online Store sales channel, so the public storefront JSON
   these functions read cannot see them. They will still be reported as "fannst
   ekki" / "villa" until they are either published or the sync is moved to the
   Admin API. That is a separate decision and is intentionally NOT changed here.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
/* ─── Shopify sync helpers (rate-limit safe + stale-handle remap) ─── */
// Products renamed/replaced on Shopify after this catalog snapshot. Maps the
// STALE handle embedded in a product's url -> the current live handle.
// NOTE: we deliberately do NOT rewrite product.url, so getProdKey() identity
// (and any saved per-customer pricing/overrides) stays intact — only the
// network fetch uses the corrected handle.
const SHOPIFY_HANDLE_FIXES = {
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
function resolveShopifyHandle(h){ return SHOPIFY_HANDLE_FIXES[h] || h; }
function _syncSleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
// fetch that backs off and retries on HTTP 429 (honours Retry-After header)
async function shopifyFetch(url, tries){
  tries = tries || 4;
  for (var attempt = 0; attempt < tries; attempt++){
    var r = await fetch(url);
    if (r.status !== 429) return r;
    var ra = parseFloat(r.headers.get('retry-after')) || (0.8 * Math.pow(2, attempt));
    await _syncSleep(ra * 1000);
  }
  return fetch(url);
}


async function syncShopifyImages() {
  if (!confirm('Sækja nýjustu myndir frá Shopify fyrir allar vörur? Þetta getur tekið nokkrar mínútur.')) return;

  var base = window.PRODUCTS_BASE || PRODUCTS;
  var btn = document.getElementById('syncShopifyImagesBtn');
  var origBtnText = btn ? btn.textContent : '';

  function normImg(url) {
    if (!url) return '';
    return String(url).replace(/^http:/, 'https:').replace(/\?v=\d+$/, '').replace(/\?v=\d+&/, '?');
  }

  // Build list of products with Shopify handles (stale handles remapped)
  var tasks = [];
  base.forEach(function(p, i) {
    var m = (p.url||'').match(/\/products\/([^\/?]+)/);
    if (m) tasks.push({ product: p, idx: i, handle: resolveShopifyHandle(m[1]) });
  });

  var total = tasks.length;
  var updated = 0, unchanged = 0, errors = 0;
  var ov = getPricingOverrides();
  if (!ov.prods) ov.prods = {};

  // Concurrency 4 + 429-retry + inter-batch delay to stay under Shopify's
  // public-endpoint rate limit (the old 10-wide no-delay loop got throttled
  // and silently dropped ~half the images on a full run).
  var BATCH = 4;
  for (var i = 0; i < tasks.length; i += BATCH) {
    var batch = tasks.slice(i, i + BATCH);
    await Promise.all(batch.map(async function(t) {
      try {
        var r = await shopifyFetch('https://www.seidkarlinn.is/products/' + t.handle + '.json');
        if (!r.ok) { errors++; return; }
        var d = await r.json();
        var firstImg = d.product && d.product.images && d.product.images[0];
        if (!firstImg || !firstImg.src) { errors++; return; }
        var latest = normImg(firstImg.src);
        var key = getProdKey(t.product);
        var prev = ov.prods[key] || {};
        var currentImg = normImg(prev.img || t.product.img || '');
        if (latest && latest !== currentImg) {
          ov.prods[key] = Object.assign({}, prev, { img: latest });
          updated++;
        } else {
          unchanged++;
        }
      } catch(e) {
        errors++;
      }
    }));
    var done = Math.min(i + BATCH, total);
    if (btn) btn.textContent = '⏳ Samstilli ' + done + '/' + total + '...';
    showToast('⏳ Sæki myndir ' + done + '/' + total + ' (+' + updated + ' uppfærðar)', 1500);
    await _syncSleep(300);
  }

  savePricingOverrides(ov);
  applyPricingOverrides();
  if (typeof rebuildLiveCatalog === 'function') rebuildLiveCatalog();
  if (typeof renderProductsPanel === 'function') renderProductsPanel();
  if (typeof renderGrid === 'function') renderGrid();

  if (btn) btn.textContent = origBtnText;
  showToast('✓ Myndir samstilltar: ' + updated + ' uppfærðar, ' + unchanged + ' óbreyttar, ' + errors + ' villur', 8000);
}

async function syncWithShopify() {
  if (!confirm('Sækja birgðarstatus frá Shopify og uppfæra vörur sem eru uppseldar?')) return;
  showToast('⏳ Sæki gögn frá Shopify...', 5000);

  (async function() {
    try {
      var all = [];
      for (var page = 1; page <= 10; page++) {
        var r = await shopifyFetch('https://www.seidkarlinn.is/products.json?limit=250&page=' + page);
        if (!r.ok) break;
        var d = await r.json();
        if (!d.products || d.products.length === 0) break;
        all = all.concat(d.products);
        if (d.products.length < 250) break;
      }
      var byHandle = {};
      all.forEach(function(s) {
        var anyAvail = (s.variants || []).some(function(v) { return v.available; });
        byHandle[s.handle] = anyAvail;
      });

      var ov = getPricingOverrides();
      if (!ov.prods) ov.prods = {};
      var base = window.PRODUCTS_BASE || PRODUCTS;
      var soldOut = 0, restocked = 0, missing = 0, unchanged = 0;
      var missingNames = [];

      // First pass: bulk byHandle lookup (stale handles remapped to live ones,
      // so renamed products now resolve straight from the bulk feed). Anything
      // still not found goes to a per-product .js fetch that follows Shopify's
      // handle-history redirects.
      var resolveNeeded = [];
      base.forEach(function(p, i) {
        var m = (p.url||'').match(/\/products\/([^\/?]+)/);
        if (!m) { missing++; missingNames.push(p.name || ('#' + i)); return; }
        var handle = resolveShopifyHandle(m[1]);
        if (handle in byHandle) {
          applyResult(p, byHandle[handle]);
        } else {
          resolveNeeded.push({ p: p, i: i, handle: handle });
        }
      });

      // Second pass: resolve renamed/edge-case handles, concurrency 4 + 429 retry.
      var BATCH = 4;
      for (var bi = 0; bi < resolveNeeded.length; bi += BATCH) {
        var batch = resolveNeeded.slice(bi, bi + BATCH);
        await Promise.all(batch.map(async function(t) {
          try {
            var pr = await shopifyFetch('https://www.seidkarlinn.is/products/' + t.handle + '.js');
            if (!pr.ok) { missing++; missingNames.push(t.p.name || ('#' + t.i)); return; }
            var pd = await pr.json();
            applyResult(t.p, !!pd.available);
          } catch(e) {
            missing++; missingNames.push(t.p.name || ('#' + t.i));
          }
        }));
        await _syncSleep(300);
      }

      function applyResult(p, shopifyInStock) {
        var key = getProdKey(p);
        var prev = ov.prods[key] || {};
        var currentInStock = (typeof prev.inStock === 'boolean') ? prev.inStock : (p.inStock !== false);
        if (currentInStock !== shopifyInStock) {
          ov.prods[key] = Object.assign({}, prev, { inStock: shopifyInStock });
          if (shopifyInStock) restocked++; else soldOut++;
        } else {
          unchanged++;
        }
      }

      savePricingOverrides(ov);
      applyPricingOverrides();
      if (typeof rebuildLiveCatalog === 'function') rebuildLiveCatalog();
      if (typeof renderProductsPanel === 'function') renderProductsPanel();
      if (typeof renderGrid === 'function') renderGrid();

      var msg = '✓ Shopify sync lokið: ' + soldOut + ' uppseldar, ' + restocked + ' á lager aftur, ' + unchanged + ' óbreyttar';
      if (missing) {
        var preview = missingNames.slice(0, 3).join(', ');
        if (missingNames.length > 3) preview += ' +' + (missingNames.length - 3);
        msg += ' (' + missing + ' fundust ekki: ' + preview + ')';
        console.warn('[syncWithShopify] Vörur sem ekki fundust í Shopify:', missingNames);
      }
      showToast(msg, 9000);
    } catch(e) {
      console.error('Shopify sync failed:', e);
      showToast('✗ Shopify sync mistókst: ' + e.message, 5000);
    }
  })();
}

  function _installSyncOverrides() {
    window.syncShopifyImages = syncShopifyImages;
    window.syncWithShopify   = syncWithShopify;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _installSyncOverrides);
  } else {
    _installSyncOverrides();
  }
  window.addEventListener("load", _installSyncOverrides); // extra safety
})();


/* ═══════════════════════════════════════════════════════════════════════════
   Custom-products visibility fix (buyer catalog)
   ---------------------------------------------------------------------------
   applyPricingOverrides() rebuilds window.PRODUCTS from PRODUCTS_BASE only and
   drops ws_custom_products, so admin-added custom products (e.g. bulk wholesale
   boxes) appeared in the admin "Vörur" panel but never in the buyer grid. We
   wrap applyPricingOverrides so that after each rebuild the custom products are
   appended — honouring noDisc (fixed price) and the deleted list — then trigger
   a re-render. Installed from ws-sync-layer to avoid editing the ~500 KB
   index.html. Because index.html is a classic script, window.applyPricingOverrides
   is the same binding bare internal calls resolve to, so category clicks/search
   that call applyPricingOverrides() also get the wrapped version.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  function _isk(n) { try { return Number(n).toLocaleString("is-IS") + " ISK"; } catch (e) { return n + " ISK"; } }

  function appendCustomProducts() {
    try {
      if (!Array.isArray(window.PRODUCTS)) return;
      var custom = [];
      try { custom = JSON.parse(localStorage.getItem("ws_custom_products") || "[]"); } catch (e) {}
      if (!Array.isArray(custom) || !custom.length) return;
      var del = [];
      try { del = JSON.parse(localStorage.getItem("ws_deleted_products") || "[]"); } catch (e) {}
      var seen = {};
      window.PRODUCTS.forEach(function (p) { if (p) seen[p.url || p.name] = true; });
      custom.forEach(function (cp) {
        if (!cp) return;
        var id = cp.url || cp.name;
        if (seen[id]) return;                                          // already in catalog
        if (del.indexOf(cp.url) > -1 || del.indexOf(cp.name) > -1) return; // deleted by admin
        var p = Object.assign({}, cp);
        if (p.noDisc) {
          p.wholesale = p.wholesale || p.price;                        // fixed price (discount included)
          p._priceOverridden = true;                                   // mark fixed: grid/cart use stored wholesale, never apply buyer discount on top
        } else if (!p.wholesale) {
          var r = parseInt((p.price || "").replace(/[^\d]/g, "")) || 0; // fallback: global 25% off
          if (r) p.wholesale = _isk(Math.round(r * 0.75));
        }
        window.PRODUCTS.push(p);
        seen[id] = true;
      });
    } catch (e) { console.warn("[ws-custom] append failed:", e); }
  }

  function install() {
    if (typeof window.applyPricingOverrides !== "function") return false;
    if (window.applyPricingOverrides._customWrapped) return true;
    var orig = window.applyPricingOverrides;
    window.applyPricingOverrides = function () {
      var r = orig.apply(this, arguments);
      appendCustomProducts();
      return r;
    };
    window.applyPricingOverrides._customWrapped = true;
    return true;
  }

  function installAndRefresh() {
    if (install()) {
      try { window.applyPricingOverrides(); } catch (e) {}
      try { if (typeof buildSidebar === "function") buildSidebar(); } catch (e) {}
      try { if (typeof renderGrid === "function") renderGrid(); } catch (e) {}
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installAndRefresh);
  else installAndRefresh();
  window.addEventListener("load", installAndRefresh);
  window.addEventListener("ws-sync-ready", function () { setTimeout(installAndRefresh, 150); });
})();


/* ═══════════════════════════════════════════════════════════════════════════
   Detail sidebar scroll fix
   ---------------------------------------------------------------------------
   aside.detail is a fixed-height flex column (height:calc(100vh-64px);
   overflow:hidden) and .dp-body is its flex:1 scroll area (overflow-y:auto).
   But a flex item defaults to min-height:auto, so when the product panel is
   tall (image + prices + AI info + add-to-cart) .dp-body expands to its full
   content height and is clipped by the parent's overflow:hidden INSTEAD of
   scrolling — leaving the bottom (the "Bæta í körfu" button) unreachable.
   Adding min-height:0 lets the flex item shrink so its own overflow-y:auto
   engages. Injected as a <style> to avoid editing the ~500 KB index.html.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  try {
    var css = "aside.detail .dp-body{min-height:0;}";
    var s = document.createElement("style");
    s.setAttribute("data-ws-fix", "detail-scroll");
    s.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(s);
  } catch (e) { console.warn("[ws-detail-scroll] inject failed:", e); }
})();
