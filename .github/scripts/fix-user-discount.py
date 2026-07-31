#!/usr/bin/env python3
"""One-shot fix: Fiskkompani (and every buyer) was shown the global default
discount (25%) instead of their per-user discount from ws_pricing_users.

getMyDiscount() ignored ws_pricing_users entirely and always returned the
theme's global discountPct, so the header chip and fallback price calc showed
25% even though all users have the standard 30/35% category discounts.

Three edits to index.html:
1. getMyDiscount(): derive the buyer's representative discount from their
   effective pricing (most common category %), falling back to the theme
   default only when no per-user/global category pricing exists.
2. getPricingOverrides(): case-insensitive user lookup (account keys like
   'Laundro' vs lowercase pricing keys).
3. savePricingOverrides(): always store under the lowercase key so admin
   edits land on the entry buyers actually read.

Idempotent: exits 0 without changes if already patched.
Aborts (exit 1) if expected code is missing AND the patch is not present.
"""
import io, sys, pathlib

p = pathlib.Path(__file__).resolve().parents[2] / "index.html"
s = io.open(p, encoding="utf-8").read()

EDITS = [
(
"""  if (ADMIN_ACCOUNTS && ADMIN_ACCOUNTS[u]) return safeDisc();
  // Customer-level afslattur removed — per-user discounts now solely via ws_pricing_users
  return safeDisc();
}""",
"""  if (ADMIN_ACCOUNTS && ADMIN_ACCOUNTS[u]) return safeDisc();
  // Per-user discounts live in ws_pricing_users (category %). Derive the
  // buyer's representative discount from their effective pricing so the
  // header chip and fallback price calc reflect THEIR discount instead of
  // always falling back to the global default. Uses the most common
  // category percentage as the representative number.
  try {
    const eff = (typeof getEffectivePricing === 'function') ? getEffectivePricing() : null;
    const vals = eff && eff.cats
      ? Object.values(eff.cats).map(v => parseFloat(v)).filter(n => !isNaN(n))
      : [];
    if (vals.length) {
      const counts = {};
      let best = null;
      vals.forEach(n => {
        counts[n] = (counts[n] || 0) + 1;
        if (best === null || counts[n] > counts[best]) best = n;
      });
      return best;
    }
  } catch(e) {}
  return safeDisc();
}"""
),
(
"""      var users = JSON.parse(localStorage.getItem('ws_pricing_users') || '{}');
      return users[userKey] || { cats: {}, prods: {} };""",
"""      var users = JSON.parse(localStorage.getItem('ws_pricing_users') || '{}');
      // Case-insensitive fallback: buyer logins are lowercased, so pricing
      // entries are stored under lowercase keys even when the account key
      // is capitalized (e.g. 'Laundro' -> 'laundro').
      return users[userKey] || users[String(userKey).toLowerCase()] || { cats: {}, prods: {} };"""
),
(
"""    var users = {};
    try { users = JSON.parse(localStorage.getItem('ws_pricing_users') || '{}'); } catch {}
    users[userKey] = p;
    localStorage.setItem('ws_pricing_users', JSON.stringify(users));""",
"""    var users = {};
    try { users = JSON.parse(localStorage.getItem('ws_pricing_users') || '{}'); } catch {}
    // Always store under the lowercase key — getEffectivePricing() looks up
    // the lowercased login name first, so saving under a capitalized account
    // key would create a duplicate entry the buyer never reads.
    var _lk = String(userKey).toLowerCase();
    if (_lk !== userKey && users[userKey]) delete users[userKey];
    users[_lk] = p;
    localStorage.setItem('ws_pricing_users', JSON.stringify(users));"""
),
]

changed = False
for old, new in EDITS:
    if new in s:
        continue  # already patched
    if old not in s:
        sys.exit("ABORT: expected code not found and patch not present:\n" + old[:120])
    if s.count(old) != 1:
        sys.exit("ABORT: expected exactly 1 occurrence, found %d" % s.count(old))
    s = s.replace(old, new)
    changed = True

if changed:
    io.open(p, "w", encoding="utf-8").write(s)
    print("Patched index.html (user discount fix applied).")
else:
    print("Already patched — nothing to do.")
