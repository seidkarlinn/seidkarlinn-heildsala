/**
 * Netlify Edge Function — category grouping layer.
 *
 * Rolls mushroom (Sveppir) and Shilajit products up into the Fæðubótarefni
 * supplement category, for BOTH filtering and display ordering, so all the
 * supplement capsule products line up side by side in "Allar vörur" and in
 * every category view — instead of the mushroom capsule bags sitting in a
 * separate block. Injected at the edge (same pattern as inject-catalog.js) so
 * the ~500KB index.html never has to be touched.
 *
 * Declared BEFORE inject-catalog in netlify.toml so it runs as the OUTER
 * wrapper and post-processes inject-catalog's already-transformed HTML — the
 * CordyFresh + 2026-05-28 edge-injected products are therefore covered too.
 *
 * The patch is a self-contained IIFE that installs after the page's main
 * script has defined its globals (catMatch / renderGrid / _sortKey). It:
 *   1. Replaces window.catMatch so selecting "Fæðubótarefni" also returns
 *      Shilajit and Sveppir products (extends the app's existing Shilajit
 *      roll-up to include Sveppir).
 *   2. Wraps window.renderGrid so that, after each default-sorted render, the
 *      grid is regrouped by EFFECTIVE category (Shilajit/Sveppir -> Fæðubótarefni)
 *      then brand -> product -> size (largest first) — matching the app's own
 *      default ordering but with the rolled-up category, so capsule sizes and
 *      related capsule bags sit next to each other. window._filtered and each
 *      card's data-idx are kept in sync so click/cart lookups stay correct.
 *      Drag-and-drop (admin) is keyed on data-url, so manual ordering still
 *      works and is honoured within the grouped block.
 */

const CATEGORY_PATCH = `
<script id="__category_grouping_patch__">
(function(){
  "use strict";
  // Sub-categories that roll up into a parent category.
  var CAT_GROUP = { "Shilajit": "Fæðubótarefni", "Sveppir": "Fæðubótarefni" };
  function effCat(cat){ return CAT_GROUP[cat] || cat; }

  // parent -> [child cats], derived from CAT_GROUP.
  var REVERSE = {};
  Object.keys(CAT_GROUP).forEach(function(child){
    var parent = CAT_GROUP[child];
    (REVERSE[parent] = REVERSE[parent] || []).push(child);
  });

  // 1) Filtering: a category also matches its rolled-up sub-categories.
  function installCatMatch(){
    window.catMatch = function(p, filter){
      if (!p) return false;
      if (filter === "All") return true;
      if (p.cat === filter) return true;
      var extras = REVERSE[filter] || [];
      return extras.indexOf(p.cat) !== -1;
    };
  }

  function readCustomOrder(){
    try {
      var raw = localStorage.getItem("ws_product_order");
      return raw ? (JSON.parse(raw).order || []) : [];
    } catch(e){ return []; }
  }

  // 2) Ordering: regroup the default view by effective category so related
  //    supplement capsule products are contiguous and sizes line up.
  function regroup(){
    try {
      var sortSel = document.getElementById("sortSel");
      var mode = sortSel ? sortSel.value : "default";
      if (mode && mode !== "default") return; // only the default grouped view
      var container = document.getElementById("productGrid");
      var f = window._filtered;
      if (!container || !f || f.length < 2) return;
      if (typeof window._sortKey !== "function") return;

      var custom = readCustomOrder();
      var idx = f.map(function(_, i){ return i; });
      idx.sort(function(ia, ib){
        var a = f[ia], b = f[ib];
        var cc = effCat(a.cat).localeCompare(effCat(b.cat), "is");
        if (cc !== 0) return cc;
        if (custom.length){
          var ai = custom.indexOf(a.url), bi = custom.indexOf(b.url);
          if (ai !== -1 && bi !== -1) return ai - bi;
          if (ai !== -1) return -1;
          if (bi !== -1) return 1;
        }
        var ka = window._sortKey(a.name), kb = window._sortKey(b.name);
        var br = ka.brand.localeCompare(kb.brand, "is");
        if (br !== 0) return br;
        var bn = ka.base.localeCompare(kb.base, "is");
        if (bn !== 0) return bn;
        return kb.size - ka.size;
      });

      // Already in this order? Do nothing (avoids needless DOM churn).
      var changed = false;
      for (var k = 0; k < idx.length; k++){ if (idx[k] !== k){ changed = true; break; } }
      if (!changed) return;

      // Snapshot every card by its CURRENT data-idx before mutating anything.
      var nodes = [];
      for (var i = 0; i < f.length; i++){
        nodes[i] = container.querySelector('[data-idx="' + i + '"]');
      }
      var frag = document.createDocumentFragment();
      idx.forEach(function(oldI, newI){
        var n = nodes[oldI];
        if (n){ n.setAttribute("data-idx", newI); frag.appendChild(n); }
      });
      container.appendChild(frag);
      window._filtered = idx.map(function(i){ return f[i]; });
    } catch(e){ /* never break the render */ }
  }

  function installRenderGrid(){
    if (typeof window.renderGrid !== "function") return false;
    if (window.renderGrid.__catGroupPatched) return true;
    var orig = window.renderGrid;
    var wrapped = function(){
      var r = orig.apply(this, arguments);
      regroup();
      return r;
    };
    wrapped.__catGroupPatched = true;
    window.renderGrid = wrapped;
    return true;
  }

  var tries = 0;
  function tryPatch(){
    installCatMatch();
    if (installRenderGrid()){
      try { window.renderGrid(); } catch(e){}
      console.log("[category-grouping-patch] installed.");
      return;
    }
    if (++tries < 60) setTimeout(tryPatch, 100);
  }

  if (document.readyState === "loading"){
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

  // Only process HTML responses; pass everything else straight through.
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();

  // Inject the runtime category-grouping patch just before the document's
  // final </body>. lastIndexOf avoids an earlier </body> that appears inside
  // a JS template literal in index.html. Idempotent.
  if (!html.includes('__category_grouping_patch__')) {
    const closeIdx = html.lastIndexOf('</body>');
    if (closeIdx !== -1) {
      html = html.slice(0, closeIdx) + CATEGORY_PATCH + html.slice(closeIdx);
    } else {
      html += CATEGORY_PATCH;
    }
  }

  return new Response(html, {
    status: response.status,
    headers: response.headers,
  });
}

export const config = { path: '/' };
