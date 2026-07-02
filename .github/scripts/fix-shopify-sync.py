#!/usr/bin/env python3
"""One-shot maintenance: typeset refinement pass on index.html, plus PRODUCT.md.

Idempotent: exits 0 immediately when index.html already matches the target build.
Aborts without touching anything if index.html is not the exact expected base.
"""
import hashlib
import pathlib
import subprocess
import sys

BASE_SHA = "a0a667b412864f7bfc4915e5e7e7cdce57b80e71f9c38a68046bd6a6e9aaf91c"
TARGET_SHA = "659a2cdeceb6308daf3f1580b788faff37a7d027bb8c866bb4fc80abf8661d21"

COMMIT_MSG = """typeset: type-scale & readability refinement

- Trim font payload: drop unused Cormorant/Playfair italics and DM Sans 300
- Route 11 leftover inline 'DM Sans' font-families through var(--sans)
- Dropdown: Playfair literal -> var(--serif); options Arial -> var(--sans)
- New TYPESET layer: prose up out of the micro-label range (dp-desc 14px,
  pname 14px), 10px legibility floor on labels/badges, clearer price
  hierarchy, small serif modal titles stepped up for Cormorant x-height,
  font-optical-sizing + font-kerning on body; mobile 3-col density kept
- Add PRODUCT.md (impeccable project context)
"""

TYPESET_BLOCK = """
/* ── TYPESET: scale & readability refinement ── */
body{font-optical-sizing:auto;font-kerning:normal;}
/* Prose surfaces up out of the micro-label range */
.dp-desc{font-size:14px;line-height:1.65;max-width:62ch;}
.dp-ai-body{font-size:13px;}
.w-sub{font-size:13px;}
.pname{font-size:14px;line-height:1.4;}
.ci-name{font-size:13px;}
.cat-sub{font-size:13px;}
/* Price hierarchy: clearer step between money and metadata */
.ws-price{font-size:17px;letter-spacing:-.01em;}
.retail-price{font-size:11px;}
.saving{font-size:10px;letter-spacing:.02em;}
/* Legibility floor: no label under 10px; caps get room to breathe */
.dp-price-label,.dp-price-lbl,.price-input-label{font-size:10px;}
.cbadge{font-size:10px;letter-spacing:.06em;}
/* Cormorant's small x-height: step small serif titles up */
.refund-modal-title{font-size:20px;}
.vm-modal-title{font-size:20px;}
/* Keep the deliberate 3-column mobile density */
@media(max-width:820px){
  .pname{font-size:11px;}
  .cbadge{font-size:9px;}
  .dp-desc{font-size:13px;}
}
</style>"""

RESTRAINT_ANCHOR = """/* ── Restraint switch ── */
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001s !important;transition-duration:.001s !important;}
}
</style>"""

PRODUCT_MD = """# Product

## Register

product

## Users

Icelandic retail buyers (endursöluaðilar) of Seiðkarlinn: shop owners and purchasing managers restocking honey, supplements, mushrooms, shilajit and ceremonial cacao at wholesale prices. They arrive with intent to order, usually on desktop during the workday. The Seiðkarlinn team administers products, orders, pricing and refunds in the same interface.

## Product Purpose

B2B wholesale ordering portal for wholesale.seidkarlinn.is. Buyers log in, browse the catalog at wholesale prices and check out (Teya payments); the team manages the Shopify-synced inventory, orders and invoicing. Success: a reorder takes minutes and the portal feels as considered as the brand's retail presence.

## Brand Personality

Warm, apothecary-editorial, trustworthy. Old-world Icelandic craft with modern B2B efficiency: Cormorant Garamond display serif over Schibsted Grotesk UI on warm cream paper, deep green and gold accents, espresso-dark header.

## Anti-references

Generic SaaS admin chrome (gray-on-white Bootstrap/shadcn defaults); loud discount-store e-commerce; cold corporate wholesale portals; anything that breaks the warm paper + espresso header identity.

## Design Principles

- The tool disappears into the order: density and familiarity beat novelty.
- One serif voice for identity, one sans for work; roles never mix.
- Warmth is carried by the committed palette and typography, not decoration.
- Logged-out browsing teaches the catalog before login; every state exists.
- Runtime theming (THEME_DEFAULTS in the inline JS) is part of the design system: visual changes ship in both the CSS tokens and THEME_DEFAULTS.

## Accessibility & Inclusion

Icelandic-language UI. Visible green focus outlines throughout; prefers-reduced-motion collapses all animation; touch-action tuned tap targets for mobile reorders; tabular numerals for all money and tables. Text contrast maintained against the cream surfaces.
"""


def rep(s: str, old: str, new: str, expected: int) -> str:
    n = s.count(old)
    if n != expected:
        print(f"ABORT: found {n} occurrence(s) (expected {expected}) of: {old[:70]!r}")
        sys.exit(1)
    return s.replace(old, new)


def main() -> None:
    p = pathlib.Path("index.html")
    s = p.read_text(encoding="utf-8")
    cur = hashlib.sha256(s.encode("utf-8")).hexdigest()

    if cur == TARGET_SHA:
        print("index.html already at target build; nothing to do.")
        return
    if cur != BASE_SHA:
        print(f"ABORT: index.html sha {cur} is neither base nor target.")
        sys.exit(1)

    # 1. Trim font payload (drop Cormorant italics, Playfair italic, DM Sans 300)
    s = rep(
        s,
        "family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500"
        "&family=Schibsted+Grotesk:ital,wght@0,400..700;1,400..700"
        "&family=Playfair+Display:ital,wght@0,400;0,600;1,400"
        "&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap",
        "family=Cormorant+Garamond:wght@400;500;600"
        "&family=Schibsted+Grotesk:ital,wght@0,400..700;1,400..700"
        "&family=Playfair+Display:wght@400;600"
        "&family=DM+Sans:opsz,wght@9..40,400;9..40,500&display=swap",
        1,
    )

    # 2. Dropdown: hardcoded Playfair -> serif token
    s = rep(
        s,
        "  font-family: 'Playfair Display', serif;\n  font-size: 22px;",
        "  font-family: var(--serif);\n  font-size: 22px;",
        1,
    )

    # 3. Dropdown options: Arial -> sans token
    s = rep(
        s,
        ".cat-dropdown option { font-family: Arial, sans-serif;",
        ".cat-dropdown option { font-family: var(--sans);",
        1,
    )

    # 4. Leftover inline DM Sans -> sans token (post-redesign family mismatch)
    s = rep(s, "font-family:'DM Sans',sans-serif", "font-family:var(--sans)", 11)

    # 5. Append TYPESET refinement layer at the end of the main stylesheet
    s = rep(s, RESTRAINT_ANCHOR, RESTRAINT_ANCHOR[: -len("</style>")] + TYPESET_BLOCK, 1)

    result = hashlib.sha256(s.encode("utf-8")).hexdigest()
    if result != TARGET_SHA:
        print(f"ABORT: result sha {result} != expected target; not writing.")
        sys.exit(1)

    p.write_text(s, encoding="utf-8")
    pathlib.Path("PRODUCT.md").write_text(PRODUCT_MD, encoding="utf-8")
    print("index.html transformed and verified; PRODUCT.md written.")

    run = lambda *a: subprocess.run(list(a), check=True)
    run("git", "config", "user.name", "seidkarlinn-bot")
    run("git", "config", "user.email", "bot@seidkarlinn.is")
    run("git", "add", "index.html", "PRODUCT.md")
    run("git", "commit", "-m", COMMIT_MSG)
    run("git", "push")
    print("Pushed.")


if __name__ == "__main__":
    main()
