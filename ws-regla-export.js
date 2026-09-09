/* ═══════════════════════════════════════════════════════════════════════════
   ws-regla-export.js — "Sækja fyrir Reglu.is" → Sölusaga line-item CSV
   ---------------------------------------------------------------------------
   Replaces exportReglaCSV() from index.html. The old export produced a general
   ledger journal (Dagsetning, Lykill debet/kredit, Fjárhæð, Þar af vsk …).
   Regla now wants the Sölusaga layout instead — one row per order line:

     Pöntunarnúmer · Kennitala · Dagsetning · Mynt · Vörunúmer · Magn ·
     Ein.verð · Afsláttar upphæð

   Column headers are written exactly as they appear in Sölusaga.xlsx,
   INCLUDING the leading spaces on four of them (" Pöntunarnúmer", " Kennitala",
   " Vörunúmer", " Magn"). They look like typos, but an importer that matches
   headers literally would reject the file without them. Trim them here only if
   Regla turns out not to care.

   AGREED SEMANTICS (confirmed with Benedikt 2026-09-09)
     Ein.verð          full RETAIL unit price, INCLUDING VSK
     Afsláttar upphæð  the whole line's discount incl. VSK:
                       (retail − wholesale) × magn
     so that Ein.verð × Magn − Afsláttar upphæð equals what the buyer actually
     pays, and the customer's discount stays visible in Regla.

   KENNITALA
     Order records almost never carry one. The Teya card checkout does not ask
     for a kt at all, and invoiceCheckout() writes buyerKt straight to
     localStorage without pushing it to the server (deliberately — a third
     concurrent push raced the other two), so it never leaves the browser that
     placed the order. Checked against the live data: 0 of the stored orders
     have buyerKt. So the kt is resolved from Viðskiptamenn (ws_vidskm) at
     export time, matched on username first, then name, then e-mail. All 10
     customers there have a kt, and every real order matches on username — and
     because the lookup happens at export time it fixes past orders too.

   WHY A LOOKUP IS NEEDED
     Order lines only ever stored the price charged (the wholesale price) — see
     logOrder() in index.html. The retail price is not on the order, so it comes
     from the catalogue, matched by product name. The same lookup supplies the
     Vörunúmer. Lines whose product cannot be matched fall back to
     Ein.verð = the price charged and Afsláttar upphæð = 0 (never a negative or
     invented discount), and are counted in the toast so a bad export is
     noticed rather than silently filed.

   Overriding from here rather than editing index.html: that file is ~530 KB and
   cannot be pushed through the GitHub connector. The button resolves the
   function by name at click time, so replacing window.exportReglaCSV wins.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var HEADERS = [
    " Pöntunarnúmer", " Kennitala", "Dagsetning", "Mynt",
    " Vörunúmer", " Magn", "Ein.verð", "Afsláttar upphæð"
  ];

  // Regla gets a bare 10-digit kennitala: the customer list holds both
  // "5501012345" and "550101-2345" spellings.
  function ktDigits(v) {
    var d = String(v == null ? "" : v).replace(/\D/g, "");
    return d.length === 10 ? d : (d || "");
  }

  function vidskmList() {
    try {
      if (typeof getVidskm === "function") return getVidskm() || [];
    } catch (e) {}
    try { return JSON.parse(localStorage.getItem("ws_vidskm") || "[]") || []; } catch (e) {}
    return [];
  }

  // kt on the order wins (an invoice order placed in this browser has it);
  // otherwise look the customer up. Username is the reliable key — name and
  // e-mail are typed by hand at checkout and drift.
  function kennitalaFor(order) {
    var own = ktDigits(order.buyerKt);
    if (own) return own;
    var list = vidskmList();
    var norm = function (x) { return String(x == null ? "" : x).trim().toLowerCase(); };
    var u = norm(order.buyerUser), n = norm(order.buyerName), e = norm(order.buyerEmail);
    var hit = null;
    if (u) hit = list.find(function (v) { return v && norm(v.user) === u; });
    if (!hit && n) hit = list.find(function (v) { return v && norm(v.nafn) === n; });
    if (!hit && e) hit = list.find(function (v) { return v && norm(v.netfang) === e; });
    return hit ? ktDigits(hit.kt) : "";
  }

  function iskNum(v) {
    if (typeof v === "number") return Math.round(v);
    return parseInt(String(v == null ? "" : v).replace(/[^\d]/g, ""), 10) || 0;
  }

  // Match an order line back to a catalogue product. Orders store the product
  // name as it was at the time, and the catalogue has since been renamed to
  // English in places, so fall back through every list we have and finally to a
  // loose comparison before giving up.
  function findProduct(name) {
    var lists = [window.PRODUCTS, window.PRODUCTS_BASE];
    try {
      var custom = JSON.parse(localStorage.getItem("ws_custom_products") || "[]");
      if (Array.isArray(custom)) lists.push(custom);
    } catch (e) {}
    var i, arr, hit;
    for (i = 0; i < lists.length; i++) {
      arr = lists[i];
      if (!Array.isArray(arr)) continue;
      hit = arr.find(function (p) { return p && p.name === name; });
      if (hit) return hit;
    }
    var loose = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!loose) return null;
    for (i = 0; i < lists.length; i++) {
      arr = lists[i];
      if (!Array.isArray(arr)) continue;
      hit = arr.find(function (p) {
        return p && String(p.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "") === loose;
      });
      if (hit) return hit;
    }
    return null;
  }

  function inPeriod(d, period, now) {
    if (period === "today") return d.toDateString() === now.toDateString();
    if (period === "week") {
      var weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
      return d >= weekAgo;
    }
    if (period === "month") {
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }
    if (period === "last_month") {
      var lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
    }
    return true; // all
  }

  function exportReglaCSV() {
    var orders = (typeof getOrders === "function") ? getOrders() : [];
    var period = (document.getElementById("exportPeriod") || {}).value || "month";
    var now = new Date();

    var filtered = orders.filter(function (o) { return inPeriod(new Date(o.date), period, now); });
    if (!filtered.length) {
      showToast("Engar pantanir fundust fyrir valið tímabil", 3000);
      return;
    }

    var rows = [HEADERS];
    var noSku = 0, noMatch = 0, noKt = 0, lines = 0;

    filtered.forEach(function (o) {
      var d = new Date(o.date);
      var kt = kennitalaFor(o);
      if (!kt) noKt++;
      var dateFmt = d.toLocaleDateString("is-IS", { day: "2-digit", month: "2-digit", year: "numeric" })
                     .replace(/\./g, "/");

      (o.items || []).forEach(function (item) {
        var prod = findProduct(item.name);
        var qty = parseInt(item.qty, 10) || 1;
        var paidUnit = iskNum(item.price);                 // wholesale, incl VSK
        var retailUnit = prod ? iskNum(prod.price) : 0;    // list price, incl VSK

        // Never invent a discount: if the catalogue price is missing or is not
        // above what was charged, bill the price actually paid at zero discount.
        var unit, discount;
        if (retailUnit > paidUnit) {
          unit = retailUnit;
          discount = (retailUnit - paidUnit) * qty;
        } else {
          unit = paidUnit;
          discount = 0;
        }

        var sku = (prod && prod.sku) ? String(prod.sku) : "";
        if (!prod) noMatch++;
        if (!sku) noSku++;
        lines++;

        rows.push([
          o.id || "",              // Pöntunarnúmer
          kt,                      // Kennitala (úr Viðskiptamenn ef ekki á pöntun)
          dateFmt,                 // Dagsetning
          "ISK",                   // Mynt
          sku,                     // Vörunúmer
          qty,                     // Magn
          unit,                    // Ein.verð (retail, m/VSK)
          discount                 // Afsláttar upphæð (línan öll, m/VSK)
        ]);
      });
    });

    // Semicolon-separated with a BOM, as before — Icelandic accounting software
    // and Excel both expect that combination.
    var csv = rows.map(function (row) {
      return row.map(function (cell) {
        var s = String(cell == null ? "" : cell);
        return (s.indexOf(";") > -1 || s.indexOf('"') > -1) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(";");
    }).join("\r\n");

    var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var periodLabel = { all: "allar", today: "dagurinn", week: "vikan", month: "manudur", last_month: "sidasti_manudur" };
    a.href = url;
    a.download = "solusaga_" + (periodLabel[period] || period) + "_" + now.toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    var msg = "✅ Sölusaga tilbúin — " + lines + " línur úr " + filtered.length + " pöntunum";
    if (noSku) msg += " · " + noSku + " án vörunúmers";
    if (noMatch) msg += " · " + noMatch + " vörur fundust ekki í vörulista";
    if (noKt) msg += " · " + noKt + " pöntun(ir) án kennitölu";
    showToast(msg, noSku || noMatch || noKt ? 9000 : 4000);
    if (noSku || noMatch || noKt) {
      console.warn("[ws-regla] línur án vörunúmers: " + noSku +
                   ", vörur sem fundust ekki: " + noMatch +
                   ", pantanir án kennitölu: " + noKt);
    }
  }

  function install() { window.exportReglaCSV = exportReglaCSV; }
  install();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  window.addEventListener("load", install);   // last word over the inline version
})();
