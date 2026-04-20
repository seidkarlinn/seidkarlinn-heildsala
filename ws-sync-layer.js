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

  window.addEventListener("beforeunload", function() {
    try {
      if (!window._wsPending) return;
      Object.keys(window._wsPending).forEach(function(k) {
        try { navigator.sendBeacon(API, new Blob([window._wsPending[k]], { type: "application/json" })); } catch(e) {}
      });
    } catch(e) {}
  });
})();
