#!/usr/bin/env python3
"""One-shot slot — currently empty.

The last payload shipped in two commits:

  0dbe9f7  armed this slot to delegate to .github/scripts/user-specific-discounts.py
  6762da0  the bot commit it produced: the automatic 25% wholesale discount is
           gone from index.html, ws-sync-layer.js and netlify/functions/checkout.js.
           Every discount now comes from ws_pricing_users (per customer, per
           category); a buyer with no configured percentage for a category pays
           full retail. THEME_DEFAULTS.discountPct is deleted — do not
           reintroduce a global default. The new-account seed
           (STANDARD_PRICING_TEMPLATE in ws-sync-layer.js) was kept on purpose.

Notes for the next payload, learned the hard way:

  * The bot commit produced by this workflow must NOT contain [skip ci] if the
    change needs to reach production — Netlify honours it and silently skips
    the build. The workflow's own commit step hardcodes [skip ci] and stages
    index.html only, so a payload touching several files should do its own
    git add/commit/push (see 0dbe9f7 for how).
  * Netlify also appears not to build on this workflow's pushes at all, so
    follow up with a commit pushed from outside Actions to trigger the deploy —
    emptying this slot afterwards does that job nicely.
  * A push made through the Claude GitHub connector did not reliably raise the
    push event this workflow listens for. If arming the slot produces no run,
    start it by hand from the Actions tab ("Fix Shopify Sync (one-shot)" ->
    Run workflow); workflow_dispatch is enabled for exactly that.

How to use this slot: replace the body below with a patch that edits
index.html, then commit + push it. The fix-shopify-sync.yml workflow triggers
on pushes to this file, runs it, and pushes the result. Keep it idempotent.
"""


def main() -> None:
    print("One-shot slot is empty — nothing to do.")


if __name__ == "__main__":
    main()
