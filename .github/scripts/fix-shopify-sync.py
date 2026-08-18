#!/usr/bin/env python3
"""One-shot slot — currently empty.

The last payload shipped in two commits:

  351a179  reikningur -> afhendingarsedill: both checkout paths
           (reikningsvidskipti / invoiceCheckout and stadgreidsla-kortagreidsla /
           downloadOrderPDF) now call generateDeliveryNote() and print a delivery
           note instead of an invoice.
  cb63297  wording renamed to "afhendingarlisti" (title AFHENDINGARLISTI,
           buttons "Saekja afhendingarlista i PDF", panel "Afhendingarlistar",
           filename Afhendingarlisti-SK-xxxx.html).

Note for the next payload: the bot commit produced by this workflow must NOT
contain [skip ci] if the change needs to reach production — Netlify honours it
and silently skips the build (that is why 351a179 never deployed on its own).
Netlify also appears not to build on this workflow's pushes at all, so follow
up with a commit pushed from outside Actions to trigger the deploy.

How to use this slot: replace the body below with a patch that edits
index.html, then commit + push it. The fix-shopify-sync.yml workflow triggers
on pushes to this file, runs it, and pushes the result. Keep it idempotent.
"""


def main() -> None:
    print("One-shot slot is empty — nothing to do.")


if __name__ == "__main__":
    main()
