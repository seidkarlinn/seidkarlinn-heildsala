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
