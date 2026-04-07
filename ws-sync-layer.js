(function () {
  "use strict";
  var API = "/.netlify/functions/ws-data";
  var SYNC_KEYS = [
    "ws_orders","ws_invoice_seq","ws_buyer_accounts","ws_custom_products",
    "ws_deleted_products","ws_pricing","ws_vidskm","ws_last_order","ws_cache_version"
  ];

  function pushToServer(key, value) {
    try {
      fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key, value: value })
      }).catch(function (err) { console.warn("[ws-sync] push failed for " + key + ":", err); });
    } catch (e) {}
  }

  var originalSetItem = localStorage.setItem.bind(localStorage);
  var originalGetItem = localStorage.getItem.bind(localStorage);
  var _syncPullDone = false;

  function mergeServerData(serverData) {
    if (!serverData) return;
    var MERGE_KEYS = [
      "ws_orders","ws_invoice_seq","ws_buyer_accounts","ws_custom_products",
      "ws_deleted_products","ws_pricing","ws_vidskm","ws_last_order"
    ];
    MERGE_KEYS.forEach(function (key) {
      if (serverData[key] !== undefined && serverData[key] !== null) {
        var serverVal = serverData[key];
        var localVal;
        try { localVal = JSON.parse(originalGetItem(key) || "null"); } catch (e) { localVal = null; }

        if (key === "ws_orders" && Array.isArray(serverVal)) {
          var localArr = Array.isArray(localVal) ? localVal : [];
          var merged = mergeOrders(localArr, serverVal);
          originalSetItem(key, JSON.stringify(merged));
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
})();
