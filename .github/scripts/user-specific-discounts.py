#!/usr/bin/env python3
"""Remove the automatic 25% wholesale discount — all discounts become per user.

Background
----------
wholesale.seidkarlinn.is applied a 25% discount automatically:

  * THEME_DEFAULTS.discountPct = '25' was the fallback everywhere a buyer had
    no per-user category percentage (applyPricingOverrides, getMyDiscount, the
    sidebar terms text, the admin pricing/product panels).
  * Several code paths hardcoded `retail * 0.75` (cart totals, delivery-note
    lines, custom-product append, the silent catalog pull, and the Teya
    checkout function server-side).

Every real discount already lives in ws_pricing_users (per customer, per
category) and is UNTOUCHED by this patch. After it, a buyer with no configured
discount for a category simply pays full retail — there is no global default.

The standard-pricing seed for brand new accounts (STANDARD_PRICING_TEMPLATE in
ws-sync-layer.js) is deliberately KEPT as a starting point; only its stale
comment about the 25% fallback is corrected.

Idempotent: exits 0 without changes if already patched.
Aborts (exit 1) if expected code is missing AND the patch is not present, so a
failed run never leaves a half-patched file.
"""
import io, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]

EDITS = {
"index.html": [
# sidebar terms copy (static markup)
("""      <div class="ws-info-text" id="wsInfoText">
        25% afsláttur af smásöluverði á allar vörur.<br>""",
 """      <div class="ws-info-text" id="wsInfoText">
        Afsláttur er sérstilltur fyrir hvern viðskiptamann.<br>"""),
# cart totals fallback
("""    totalWs += parseISK(item.wholesale) * item.qty || parseISK(item.price) * item.qty * 0.75;""",
 """    // No wholesale price on the line → full retail. Never an automatic 25%.
    totalWs += parseISK(item.wholesale) * item.qty || parseISK(item.price) * item.qty;"""),
# grid (list view) display fallback
("""      const discL = liL ? (typeof getMyDiscount==='function' ? getMyDiscount() : 25) : 25;""",
 """      const discL = liL ? (typeof getMyDiscount==='function' ? getMyDiscount() : 0) : 0;"""),
# grid (card view) display fallback
("""      const disc = li ? (typeof getMyDiscount==='function' ? getMyDiscount() : 25) : 25;""",
 """      const disc = li ? (typeof getMyDiscount==='function' ? getMyDiscount() : 0) : 0;"""),
# product detail panel fallback
("""  const disc = _li ? (typeof getMyDiscount === 'function' ? getMyDiscount() : 25) : null;""",
 """  const disc = _li ? (typeof getMyDiscount === 'function' ? getMyDiscount() : 0) : null;"""),
# admin product table: no global % to derive a wholesale price from
("""            const wsNum = retail ? Math.round(retail * (1 - ((parseInt(getTheme().discountPct)||25)/100))) : 0;
            const wsStr = wsNum ? wsNum.toLocaleString('de-DE') + ' ISK' : '—';""",
 """            // No global discount exists any more: show the explicit wholesale
            // price if one is stored for this product, otherwise '—' (prices
            // are set per customer under "Verð og afslættir").
            const _ovProds = (getPricingOverrides() || {}).prods || {};
            const _ovWs = (_ovProds[getProdKey(p)] || {}).ws || 0;
            const wsNum = _ovWs > 0 ? _ovWs : 0;
            const wsStr = wsNum ? wsNum.toLocaleString('de-DE') + ' ISK' : '—';"""),
# product edit panel prefill
("""  const wsNum = retail ? Math.round(retail * (1 - ((parseInt(getTheme().discountPct)||25)/100))) : 0;
  const vskLabel =""",
 """  // Prefill the wholesale fields ONLY from an explicitly stored price. Deriving
  // them from a global % used to make an unrelated save (e.g. stock toggle)
  // silently write a global wholesale price for the product.
  const wsNum = (((getPricingOverrides() || {}).prods || {})[getProdKey(p)] || {}).ws || 0;
  const vskLabel ="""),
# price calculator: never auto-fill wholesale from a global %
("""  const disc = parseInt(getTheme().discountPct) || 25;
  const ws = Math.round(retail * (1 - disc/100));
  const wsEx = vskRate > 0 ? Math.round(ws / (1 + vskRate)) : ws;
  if (document.getElementById('vdRetail')) document.getElementById('vdRetail').value = retail || '';
  if (document.getElementById('vdWs')) document.getElementById('vdWs').value = ws || '';
  if (document.getElementById('vdWsExVsk')) document.getElementById('vdWsExVsk').value = wsEx || '';""",
 """  if (document.getElementById('vdRetail')) document.getElementById('vdRetail').value = retail || '';
  // Wholesale is NOT derived from a global discount any more — leave whatever
  // the admin typed (or nothing) untouched, so no automatic price is written."""),
# rebuildLiveCatalog fallback
("""      const v=p.wholesale||(p.price?Math.round(parseInt((p.price||'').replace(/[^\\d]/g,''))*0.75)+' ISK':'');""",
 """      const v=p.wholesale||(p.price?Math.round(parseInt((p.price||'').replace(/[^\\d]/g,'')))+' ISK':'');"""),
# saveProd: do not invent a wholesale price
("""  const wsStr    = wsInc ? fmtNum(wsInc)+' ISK' : (priceInc ? fmtNum(Math.round(priceInc*0.75))+' ISK' : '');""",
 """  // Leave wholesale empty when not entered — pricing is resolved per customer
  // by applyPricingOverrides() instead of baking in an automatic discount.
  const wsStr    = wsInc ? fmtNum(wsInc)+' ISK' : '';"""),
# THEME_DEFAULTS: drop the global discount setting
("""  discountPct:  '25',
  moqAmount:    '50.000 ISK',""",
 """  // discountPct removed 2026-08-20: there is no automatic global discount any
  // more. Every discount is per customer, stored in ws_pricing_users and edited
  // in "Verð og afslættir". A buyer with no configured discount pays full
  // retail. Do NOT reintroduce a global default here.
  moqAmount:    '50.000 ISK',"""),
# sidebar terms rebuilt by applyTheme
("""  if (wsText) wsText.innerHTML = `${t.discountPct}% afsláttur af smásöluverði á allar vörur.<br>Lágmarksverðmæti pöntunar: ${t.moqAmount}.`;""",
 """  if (wsText) {
    // Discounts are per customer now — no global percentage to advertise.
    const _d = (typeof getMyDiscount === 'function') ? getMyDiscount() : 0;
    wsText.innerHTML = (_d > 0
      ? `Þinn afsláttur: ${_d}% af smásöluverði (getur verið mismunandi eftir vöruflokki).`
      : 'Afsláttur er sérstilltur fyrir hvern viðskiptamann.')
      + `<br>Lágmarksverðmæti pöntunar: ${t.moqAmount}.`;
  }"""),
# theme preview chip
("""      <span class="theme-preview-btn" style="background:${t.colorGreen};color:#fff">${t.discountPct}% afsláttur</span>""",
 """      <span class="theme-preview-btn" style="background:${t.colorGreen};color:#fff">Afsláttur pr. viðskiptamann</span>"""),
# delivery note / invoice lines
("""      const unitWs    = parseISKNum(item.wholesale) || Math.round(parseISKNum(item.price) * 0.75);""",
 """      const unitWs    = parseISKNum(item.wholesale) || parseISKNum(item.price);"""),
# applyPricingOverrides: remove the global fallback percentage
("""  const ov = getEffectivePricing();
  const globalDisc = parseInt(getTheme().discountPct) || 25;
  const _src = window.PRODUCTS_BASE""",
 """  const ov = getEffectivePricing();
  const _src = window.PRODUCTS_BASE"""),
("""      } else if (o.ws && o.ws > 0) {
        ws = o.ws;
      } else {
        ws = p.wholesale;
      }""",
 """      } else if (o.ws && o.ws > 0) {
        ws = o.ws;
      } else {
        // No category % for this buyer and no explicit wholesale price: charge
        // full retail rather than the old baked-in 25% catalog discount.
        ws = baseRetailNum > 0 ? baseRetailNum : p.wholesale;
      }"""),
("""    // Global discount
    const retail = parseInt((p.price||'').replace(/[^\\d]/g,'')) || 0;
    const ws = retail > 0 ? Math.round(retail * (1 - globalDisc/100)) : 0;
    return {...p, wholesale: ws > 0 ? fmtISK(ws) : p.wholesale};""",
 """    // No discount configured for this buyer in this category → full retail.
    // (Previously a global 25% default was applied automatically here.)
    const retail = parseInt((p.price||'').replace(/[^\\d]/g,'')) || 0;
    return {...p,
      wholesale: retail > 0 ? fmtISK(retail) : p.wholesale,
      _noDiscount: true,
    };"""),
# admin pricing panel: category tab
("""  const ov = _pendingPricing || {};
  const globalDisc = parseInt(getTheme().discountPct) || 25;
  // Merge CAT_COLORS keys""",
 """  const ov = _pendingPricing || {};
  // Merge CAT_COLORS keys"""),
("""      Stilltu sérstakan afslátt á hvern flokk. Ef engin sérstaklegar stillingar eru, gildir <strong>${globalDisc}% almennt afsláttur</strong>.""",
 """      Stilltu afslátt á hvern flokk fyrir þennan viðskiptamann. Flokkur sem er
      ekki stilltur fær <strong>engan afslátt</strong> — viðskiptamaðurinn greiðir
      fullt smásöluverð. Það er enginn almennur sjálfgefinn afsláttur."""),
("""          const discVal = hasOverride ? ov.cats[cat] : globalDisc;""",
 """          const discVal = hasOverride ? ov.cats[cat] : '';"""),
("""              ${hasOverride && ov.cats[cat] !== globalDisc
                ? `<span class="disc-badge custom">Sérsniðið: ${ov.cats[cat]}%</span>`
                : `<span class="disc-badge global">Almennt: ${globalDisc}%</span>`}""",
 """              ${hasOverride
                ? `<span class="disc-badge custom">Sérsniðið: ${ov.cats[cat]}%</span>`
                : `<span class="disc-badge global">Ekki stillt — fullt verð</span>`}"""),
# admin pricing panel: product tab
("""        const globalDisc = parseInt(getTheme().discountPct) || 25;
        const catDisc = (ov.cats && ov.cats[p.cat] !== undefined) ? ov.cats[p.cat] : globalDisc;""",
 """        // No global fallback discount: an unset category means full retail.
        const catDisc = (ov.cats && ov.cats[p.cat] !== undefined) ? ov.cats[p.cat] : 0;"""),
# header discount chip: only when a discount is configured
("""    if (discEl)    if (discEl) discEl.style.display    = 'flex';
    if (discPct) {
      const disc = typeof getMyDiscount === 'function' ? getMyDiscount() : 25;
      if (discPct) discPct.textContent = disc + '% afsláttur';
    }""",
 """    // Discount chip only when this account actually has a discount configured
    // (per-user pricing). No configured discount → no chip, since there is no
    // global default to fall back on.
    const _myDisc = typeof getMyDiscount === 'function' ? getMyDiscount() : 0;
    if (discEl) discEl.style.display = _myDisc > 0 ? 'flex' : 'none';
    if (discPct) discPct.textContent = _myDisc > 0 ? _myDisc + '% afsláttur' : '';"""),
# getMyDiscount: no global fallback
("""  const u = localStorage.getItem('ws_auth');
  if (!u) return 25;
  // Safe theme read — THEME_DEFAULTS may not be defined yet if called early
  const safeDisc = () => {
    try { return parseInt((typeof getTheme === 'function' ? getTheme() : {discountPct:25}).discountPct) || 25; }
    catch(e) { return 25; }
  };
  if (ADMIN_ACCOUNTS && ADMIN_ACCOUNTS[u]) return safeDisc();""",
 """  const u = localStorage.getItem('ws_auth');
  // 0 = no discount configured for this account. There is no global/automatic
  // discount any more, so anyone without per-user pricing sees full retail.
  if (!u) return 0;
  if (ADMIN_ACCOUNTS && ADMIN_ACCOUNTS[u]) return 0;"""),
("""      return best;
    }
  } catch(e) {}
  return safeDisc();
}""",
 """      return best;
    }
  } catch(e) {}
  return 0;
}"""),
# silent catalog pull: go through per-user pricing
("""    // Rebuild catalog with server state
    const deleted = state.deleted;
    const custom  = Array.isArray(state.custom) ? state.custom : [];
    const srcBase = window.PRODUCTS_BASE || PRODUCTS;

    window.PRODUCTS = [
      ...srcBase.filter(p => !deleted.includes(p.url) && !deleted.includes(p.name)),
      ...custom
    ].map(p => {
      const retail = parseInt((p.price||'').replace(/[^\\d]/g,'')) || 0;
      const ws = p.noDisc ? (p.wholesale || p.price) : (retail ? fmtISK(retail * 0.75) : p.wholesale);
      return {...p, wholesale: ws};
    });""",
 """    // Rebuild catalog with server state. Go through applyPricingOverrides() so
    // the logged-in buyer's OWN pricing (ws_pricing_users) is what lands on the
    // catalog: it applies the deletions just saved above, re-appends custom
    // products and layers the per-customer category discounts. This used to
    // rebuild prices inline at a flat global percentage, which overwrote the
    // buyer's per-user prices until the next re-render.
    if (typeof applyPricingOverrides === 'function') {
      applyPricingOverrides();
    } else {
      const deleted = state.deleted;
      const custom  = Array.isArray(state.custom) ? state.custom : [];
      const srcBase = window.PRODUCTS_BASE || PRODUCTS;
      window.PRODUCTS = [
        ...srcBase.filter(p => !deleted.includes(p.url) && !deleted.includes(p.name)),
        ...custom
      ].map(p => {
        // No automatic discount: full retail when no pricing can be applied.
        const retail = parseInt((p.price||'').replace(/[^\\d]/g,'')) || 0;
        const ws = p.noDisc ? (p.wholesale || p.price) : (retail ? fmtISK(retail) : p.wholesale);
        return {...p, wholesale: ws};
      });
    }"""),
],

"ws-sync-layer.js": [
("""  // This guarantees new users get the right per-category percentages out of
  // the box, instead of falling back to the 25% global default.""",
 """  // This guarantees new users get the right per-category percentages out of
  // the box. There is no global default discount any more (removed 2026-08-20):
  // a category that is not listed here — or a user whose entry is edited to
  // remove it — means full retail for that user, not a 25% fallback. Every
  // discount is per user, so adjust individual customers in "Verð og afslættir"
  // after they are seeded."""),
("""        } else if (!p.wholesale) {
          var r = parseInt((p.price || "").replace(/[^\\d]/g, "")) || 0; // fallback: global 25% off
          if (r) p.wholesale = _isk(Math.round(r * 0.75));
        }""",
 """        } else if (!p.wholesale) {
          // No baked wholesale price: fall back to full retail. There is no
          // global 25% default any more — per-customer category discounts are
          // applied by applyPricingOverrides().
          var r = parseInt((p.price || "").replace(/[^\\d]/g, "")) || 0;
          if (r) p.wholesale = _isk(r);
        }"""),
],

"netlify/functions/checkout.js": [
("""    // 3. Build totals at wholesale price (75% of retail)""",
 """    // 3. Build totals at the wholesale price the buyer was shown. If an item
    //    carries no wholesale price, charge full retail — never apply an
    //    automatic discount server-side (discounts are per customer only)."""),
("""      const unit = parseISK(item.wholesale) || Math.round(parseISK(item.price) * 0.75);""",
 """      const unit = parseISK(item.wholesale) || parseISK(item.price);"""),
],
}

touched = []
for rel, edits in EDITS.items():
    path = ROOT / rel
    src = io.open(path, encoding="utf-8").read()
    out = src
    for old, new in edits:
        if new in out:
            continue                       # already patched
        if old not in out:
            sys.exit("ABORT: expected code not found and patch not present in %s:\n%s" % (rel, old[:160]))
        if out.count(old) != 1:
            sys.exit("ABORT: expected exactly 1 occurrence in %s, found %d:\n%s"
                     % (rel, out.count(old), old[:160]))
        out = out.replace(old, new)
    if out != src:
        io.open(path, "w", encoding="utf-8").write(out)
        touched.append(rel)

# Safety net: no automatic-discount arithmetic may survive in the app code.
for rel in EDITS:
    body = io.open(ROOT / rel, encoding="utf-8").read()
    for needle in ("* 0.75", "*0.75", "discountPct)"):
        if needle in body:
            sys.exit("ABORT: leftover automatic discount in %s: %r" % (rel, needle))

print("Patched: " + ", ".join(touched) if touched else "Already patched — nothing to do.")
