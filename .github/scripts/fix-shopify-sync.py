#!/usr/bin/env python3
"""
One-shot patch for syncWithShopify() in index.html.

Place this file at:   .github/scripts/fix-shopify-sync.py
Pair it with:         .github/workflows/fix-shopify-sync.yml

Old behaviour:
  - Bulk-fetches /products.json, builds byHandle map.
  - Iterates PRODUCTS_BASE; products whose URL handle is not in byHandle
    silently increment "missing" with no name.
  - Breaks for products whose Shopify handle has been renamed: Shopify
    redirects /products/{old-handle} -> current product (so the wholesale
    link still works in a browser), but /products.json only returns the
    current handle, so the bulk lookup misses these products entirely.

New behaviour:
  - Same first pass against byHandle.
  - For products whose handle is not in byHandle, do a per-product fetch
    of /products/{handle}.js (10 at a time). Shopify follows handle-history
    redirects on this endpoint, so the resolved JSON has the canonical
    handle and a definitive `.available` flag for the current product.
  - 404s (truly unpublished products) still count as missing.
  - Missing-product NAMES are surfaced in the toast (first 3 + overflow
    count) AND console.warn'd in full, so admin can immediately see which
    products are not syncing.
"""

import sys
from pathlib import Path

OLD_FUNC = r'''async function syncWithShopify() {
  if (!confirm('Sækja birgðarstatus frá Shopify og uppfæra vörur sem eru uppseldar?')) return;
  showToast('⏳ Sæki gegnir Shopify...', 5000);

  (async function() {
    try {
      var all = [];
      for (var page = 1; page <= 10; page++) {
        var r = await fetch('https://www.seidkarlinn.is/products.json?limit=250&page=' + page);
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
      base.forEach(function(p) {
        var m = (p.url||'').match(/\/products\/([^\/?]+)/);
        if (!m) { missing++; return; }
        var handle = m[1];
        if (!(handle in byHandle)) { missing++; return; }
        var shopifyInStock = byHandle[handle];
        var key = getProdKey(p);
        var prev = ov.prods[key] || {};
        var currentInStock = (typeof prev.inStock === 'boolean') ? prev.inStock : (p.inStock !== false);
        if (currentInStock !== shopifyInStock) {
          ov.prods[key] = Object.assign({}, prev, { inStock: shopifyInStock });
          if (shopifyInStock) restocked++; else soldOut++;
        } else {
          unchanged++;
        }
      });

      savePricingOverrides(ov);
      applyPricingOverrides();
      if (typeof rebuildLiveCatalog === 'function') rebuildLiveCatalog();
      if (typeof renderProductsPanel === 'function') renderProductsPanel();
      if (typeof renderGrid === 'function') renderGrid();

      showToast('✓ Shopify sync látið: ' + soldOut + ' uppseldar, ' + restocked + ' á lager aftur, ' + unchanged + ' óbreyttar' + (missing ? ' (' + missing + ' fundust ekki)' : ''), 7000);
    } catch(e) {
      console.error('Shopify sync failed:', e);
      showToast('✗ Shopify sync miststókst: ' + e.message, 5000);
    }
  })();
}'''

NEW_FUNC = r'''async function syncWithShopify() {
  if (!confirm('Sækja birgðarstatus frá Shopify og uppfæra vörur sem eru uppseldar?')) return;
  showToast('⏳ Sæki gögn frá Shopify...', 5000);

  (async function() {
    try {
      var all = [];
      for (var page = 1; page <= 10; page++) {
        var r = await fetch('https://www.seidkarlinn.is/products.json?limit=250&page=' + page);
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

      // First pass: bulk byHandle lookup. Anything not found goes into a
      // resolveNeeded queue for a per-product .js fetch — that endpoint follows
      // Shopify's handle-history redirects, so old handles in PRODUCTS_BASE still
      // resolve to the current product even after a Shopify-side rename.
      var resolveNeeded = [];
      base.forEach(function(p, i) {
        var m = (p.url||'').match(/\/products\/([^\/?]+)/);
        if (!m) { missing++; missingNames.push(p.name || ('#' + i)); return; }
        var handle = m[1];
        if (handle in byHandle) {
          applyResult(p, byHandle[handle]);
        } else {
          resolveNeeded.push({ p: p, i: i, handle: handle });
        }
      });

      // Second pass: resolve renamed/edge-case handles in batches of 10.
      var BATCH = 10;
      for (var bi = 0; bi < resolveNeeded.length; bi += BATCH) {
        var batch = resolveNeeded.slice(bi, bi + BATCH);
        await Promise.all(batch.map(async function(t) {
          try {
            var pr = await fetch('https://www.seidkarlinn.is/products/' + t.handle + '.js');
            if (!pr.ok) { missing++; missingNames.push(t.p.name || ('#' + t.i)); return; }
            var pd = await pr.json();
            applyResult(t.p, !!pd.available);
          } catch(e) {
            missing++; missingNames.push(t.p.name || ('#' + t.i));
          }
        }));
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
}'''


def main():
    p = Path('index.html')
    html = p.read_text(encoding='utf-8')

    if OLD_FUNC not in html:
        print('ERROR: old syncWithShopify block not found in index.html. '
              'It may have been edited since this script was authored. '
              'Aborting without changes.', file=sys.stderr)
        sys.exit(1)

    new_html = html.replace(OLD_FUNC, NEW_FUNC, 1)
    if new_html == html:
        print('ERROR: replacement produced identical content', file=sys.stderr)
        sys.exit(1)

    p.write_text(new_html, encoding='utf-8')
    print('OK: syncWithShopify patched (handle-redirect fallback + missing names)')


if __name__ == '__main__':
    main()
