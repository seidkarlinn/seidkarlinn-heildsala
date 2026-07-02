#!/usr/bin/env python3
"""
One-shot design patch for index.html — "Editorial Elevation" refresh (2026-07-02).

Runs via the fix-shopify-sync one-shot workflow (this repo's credential-less
deploy path). Applies a pure design-layer refresh: Cormorant Garamond /
Schibsted Grotesk typography, warm-paper tokens, double-bezel cards, pill
buttons with nested arrow chips, film grain, custom-bezier motion.
No application logic is touched.

Safety:
  - Aborts unless index.html matches the exact sha this patch was built from.
  - Verifies the result sha matches the locally previewed build byte-for-byte.
  - Idempotent: exits 0 without changes when already applied.
  - Commits and pushes index.html itself with a proper message (the workflow's
    fallback commit step then no-ops; its hardcoded message contains [skip ci],
    which would suppress the Netlify build).
Set DRY_RUN=1 to patch and verify without committing.
"""

import hashlib
import os
import subprocess
import sys
from pathlib import Path

BASE_SHA = "0e1e26271358babb4ead0da209ed43018424e7b523c25a7751cca4a85300c918"
NEW_SHA = "a0a667b412864f7bfc4915e5e7e7cdce57b80e71f9c38a68046bd6a6e9aaf91c"

FONT_LINK_OLD = """<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap" rel="stylesheet">"""
FONT_LINK_NEW = """<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Schibsted+Grotesk:ital,wght@0,400..700;1,400..700&family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap" rel="stylesheet">"""

ROOT_OLD = """:root {
  --ink:#1A1710; --ink2:#54503F; --ink3:#837E6F;
  --paper:#FAF8F3; --paper2:#F3F0E8; --paper3:#EAE5D8;
  --sf:#FAF8F3;
  --gold:#B8860B; --gold-l:#F5EED8; --gold-b:#8B6508;
  --green:#2A5C2A; --green-d:#1E431E; --green-l:#E6F0E6;
  --red:#C0392B; --red-l:#FDECEA;
  --r:10px; --rs:6px;
  --shadow: 0 1px 3px rgba(26,23,16,.05), 0 4px 16px rgba(26,23,16,.07);
  --shadow-lg: 0 16px 48px rgba(26,23,16,.18);
}"""
ROOT_NEW = """:root {
  --ink:#1A1710; --ink2:#57503C; --ink3:#8A8270;
  --paper:#FDFBF7; --paper2:#F5F1E8; --paper3:#E9E2D0;
  --sf:#FDFBF7;
  --gold:#A9812F; --gold-l:#F6EFDC; --gold-b:#82621E;
  --green:#2A5C2A; --green-d:#1E431E; --green-l:#E9F1E6;
  --red:#C0392B; --red-l:#FDECEA;
  --r:14px; --rs:9px;
  --hair:rgba(26,23,16,.09);
  --ease:cubic-bezier(.32,.72,0,1);
  --ease-o:cubic-bezier(.16,1,.3,1);
  --shadow: 0 1px 2px rgba(26,23,16,.03), 0 10px 30px -8px rgba(26,23,16,.09);
  --shadow-lg: 0 2px 6px rgba(26,23,16,.06), 0 32px 80px -16px rgba(26,23,16,.28);
  --serif:'Cormorant Garamond','Playfair Display',serif;
  --sans:'Schibsted Grotesk','DM Sans',sans-serif;
}"""

LAYER_ANCHOR = """@media (max-width: 820px) {
  .cat-dropdown { font-size: 16px; padding: 6px 28px 6px 10px; }
}
</style>"""

ELEVATION = """@media (max-width: 820px) {
  .cat-dropdown { font-size: 16px; padding: 6px 28px 6px 10px; }
}

/* ═══════════════════════════════════════════════════════
   EDITORIAL ELEVATION LAYER — warm-paper luxe refresh.
   Pure override layer: no selectors above are removed;
   everything here refines surfaces, depth and motion.
   ═══════════════════════════════════════════════════════ */

/* ── Atmosphere: film grain + selection + scrollbars ── */
body::after{
  content:"";position:fixed;inset:0;z-index:3000;pointer-events:none;opacity:.05;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
}
::selection{background:var(--gold-l);color:var(--gold-b);}
*{scrollbar-width:thin;scrollbar-color:var(--paper3) transparent;}
::-webkit-scrollbar{width:10px;height:10px;}
::-webkit-scrollbar-thumb{background:var(--paper3);border-radius:99px;border:3px solid var(--paper);}
::-webkit-scrollbar-track{background:transparent;}

/* ── Typography: quiet serif authority, tracked eyebrows ── */
.cat-title{font-family:var(--serif);font-size:31px;font-weight:600;letter-spacing:-.015em;}
.cart-title,.adm-modal-title,.refund-modal-title,.vm-modal-title{font-family:var(--serif);font-weight:600;}
.cart-title{font-size:25px;}
.adm-modal-title{font-size:22px;}
.dp-name{font-family:var(--serif);font-size:23px;font-weight:600;}
.w-title{font-family:var(--serif);font-size:24px;font-weight:600;}
.cat-dropdown{font-family:var(--serif);font-weight:600;}
.sb-section,.dp-add-label,.dp-qty-lbl,.dp-price-label,.dp-price-lbl,.section-lbl,
.od-box-title,.stat-label,.ws-info-title,.gate-label,.adm-form-label,.price-input-label,.theme-section-title{
  letter-spacing:.16em;font-weight:600;
}
.gate-sub{letter-spacing:.22em;font-size:10px;color:var(--gold-b);}
.cat-sub{font-size:12px;letter-spacing:.01em;}

/* ── Login gate: cinematic modal ── */
#gate{backdrop-filter:blur(14px) saturate(.9);-webkit-backdrop-filter:blur(14px) saturate(.9);}
#gate:not(.hidden) .gate-box{animation:gateIn .65s var(--ease-o) both;}
@keyframes gateIn{from{opacity:0;transform:translateY(26px) scale(.97);}to{opacity:1;transform:translateY(0) scale(1);}}
.gate-box{
  border-radius:26px;padding:3rem 2.5rem 2.5rem;
  background:
    linear-gradient(175deg,#FFFEFB 0%,var(--paper) 55%,#F8F4EA 100%);
  box-shadow:
    0 0 0 1px var(--hair),
    0 0 0 7px rgba(253,251,247,.14),
    0 1px 0 rgba(255,255,255,.9) inset,
    0 40px 90px -18px rgba(10,8,4,.5);
}
#gate:not(.hidden) .gate-box > *{animation:riseIn .8s var(--ease-o) both;}
#gate:not(.hidden) .gate-box > *:nth-child(2){animation-delay:.08s;}
#gate:not(.hidden) .gate-box > *:nth-child(3){animation-delay:.15s;}
#gate:not(.hidden) .gate-box > *:nth-child(4){animation-delay:.21s;}
#gate:not(.hidden) .gate-box > *:nth-child(5){animation-delay:.26s;}
#gate:not(.hidden) .gate-box > *:nth-child(6){animation-delay:.31s;}
#gate:not(.hidden) .gate-box > *:nth-child(7){animation-delay:.36s;}
#gate:not(.hidden) .gate-box > *:nth-child(8){animation-delay:.42s;}
#gate:not(.hidden) .gate-box > *:nth-child(9){animation-delay:.5s;}
#gate:not(.hidden) .gate-box > *:nth-child(10){animation-delay:.56s;}
@keyframes riseIn{from{opacity:0;transform:translateY(14px);filter:blur(5px);}to{opacity:1;transform:translateY(0);filter:blur(0);}}
.gate-input{
  border-radius:13px;padding:12px 15px;border-width:1px;border-color:var(--paper3);
  transition:border-color .4s var(--ease),box-shadow .4s var(--ease),background .4s var(--ease);
}
.gate-input:focus{border-color:var(--green);background:#fff;box-shadow:0 0 0 4px var(--green-l);}
.gate-btn{
  border-radius:999px;padding:9px 9px 9px 24px;font-size:14px;font-weight:600;letter-spacing:.02em;
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  background:linear-gradient(180deg,#336633,var(--green) 45%,var(--green-d));
  box-shadow:0 1px 0 rgba(255,255,255,.22) inset,0 8px 18px -8px rgba(26,23,16,.3);
  transition:transform .5s var(--ease),box-shadow .5s var(--ease),filter .5s var(--ease);
}
.gate-btn::after{
  content:"→";flex-shrink:0;width:32px;height:32px;border-radius:50%;
  background:rgba(255,255,255,.16);box-shadow:0 1px 0 rgba(255,255,255,.18) inset;
  display:flex;align-items:center;justify-content:center;font-size:14px;
  transition:transform .5s var(--ease),background .5s var(--ease);
}
.gate-btn:hover{filter:brightness(1.06);box-shadow:0 1px 0 rgba(255,255,255,.22) inset,0 10px 22px -8px rgba(26,23,16,.32);}
.gate-btn:hover::after{transform:translateX(3px);background:rgba(255,255,255,.26);}
.gate-btn:active{transform:scale(.98);}
.gate-contact{margin-top:1.75rem;padding-top:1.25rem;border-top:1px solid var(--paper3);}

/* ── Header: espresso bar with gold hairline ── */
header{
  background:linear-gradient(180deg,#241F15,#1A1710) !important;
  border-bottom:1px solid rgba(169,129,47,.28);
  box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 8px 30px -12px rgba(26,23,16,.5);
}
.cart-btn{
  border-radius:999px;padding:8px 16px;border:1px solid rgba(255,255,255,.14);
  background:var(--paper);letter-spacing:.02em;
  transition:transform .45s var(--ease),background .45s var(--ease),color .45s var(--ease);
}
.cart-btn:hover{transform:translateY(-1px);}
.cart-btn:active{transform:scale(.97);}
.cart-count{background:var(--green);}
.cart-btn:hover .cart-count{background:var(--paper);color:var(--green);}
#hLoginBtn{border-radius:999px !important;transition:background .45s var(--ease),border-color .45s var(--ease);}
#hLoginBtn:hover{background:rgba(255,255,255,.2) !important;}

/* ── Sidebar: soft rail ── */
aside.sb{background:linear-gradient(180deg,var(--paper2),#F2EDE1);border-right:1px solid var(--hair);}
.sinput{border-width:1px;border-radius:999px;padding:9px 15px;background:#fff;
  transition:border-color .4s var(--ease),box-shadow .4s var(--ease);}
.sinput:focus{box-shadow:0 0 0 4px var(--green-l);}
.cat-btn{border-radius:999px;padding:7px 13px;transition:background .4s var(--ease),color .4s var(--ease),transform .4s var(--ease);}
.cat-btn:hover{transform:translateX(2px);}
.cat-btn.active{box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 0 0 1px rgba(42,92,42,.14);}
.ws-info{
  border-radius:18px;padding:1rem;border:1px solid rgba(169,129,47,.22);
  background:linear-gradient(165deg,#FBF4E1,var(--gold-l));
  box-shadow:0 1px 0 rgba(255,255,255,.65) inset,0 12px 26px -14px rgba(130,98,30,.35);
}
.moq-badge{border-radius:999px;padding:3px 10px;color:#fff;background:var(--gold-b);letter-spacing:.08em;}
.adm-drop{border-radius:16px;border-color:var(--hair);background:rgba(255,255,255,.45);}
.adm-side-btn,.sync-btn{border-radius:10px;transition:background .35s var(--ease),color .35s var(--ease);}

/* ── Product cards: machined double bezel ── */
@keyframes cardIn{from{opacity:0;transform:translateY(18px);filter:blur(6px);}to{opacity:1;transform:translateY(0);filter:blur(0);}}
.grid{gap:14px;}
.pcard{
  border:1px solid var(--hair);border-radius:calc(var(--r) + 7px);padding:7px;
  background:linear-gradient(180deg,#FFFEFC 0%,var(--paper) 70%);
  box-shadow:0 1px 0 rgba(255,255,255,.85) inset,0 1px 2px rgba(26,23,16,.04),0 6px 22px -10px rgba(26,23,16,.08);
  animation:cardIn .7s var(--ease-o) both;
  transition:transform .55s var(--ease),box-shadow .55s var(--ease),border-color .55s var(--ease);
}
.pcard:nth-child(1){animation-delay:.02s;}.pcard:nth-child(2){animation-delay:.06s;}
.pcard:nth-child(3){animation-delay:.1s;}.pcard:nth-child(4){animation-delay:.14s;}
.pcard:nth-child(5){animation-delay:.18s;}.pcard:nth-child(6){animation-delay:.22s;}
.pcard:nth-child(7){animation-delay:.26s;}.pcard:nth-child(8){animation-delay:.3s;}
.pcard:nth-child(9){animation-delay:.34s;}.pcard:nth-child(10){animation-delay:.38s;}
.pcard:nth-child(11){animation-delay:.42s;}.pcard:nth-child(12){animation-delay:.46s;}
.pcard:hover{
  border-color:rgba(42,92,42,.35);transform:translateY(-5px);
  box-shadow:0 1px 0 rgba(255,255,255,.85) inset,0 2px 4px rgba(26,23,16,.04),0 26px 48px -16px rgba(26,23,16,.18);
}
.pcard-img{border-radius:var(--r);box-shadow:0 0 0 1px var(--hair) inset;}
.pcard-body{padding:.8rem .55rem .55rem;}
.drag-handle{top:12px;right:12px;border-radius:8px;}
.prow{border-width:1px;border-color:var(--hair);border-radius:16px;
  transition:transform .45s var(--ease),border-color .45s var(--ease),box-shadow .45s var(--ease);animation:cardIn .55s var(--ease-o) both;}
.prow:hover{border-color:rgba(42,92,42,.35);transform:translateX(3px);box-shadow:var(--shadow);}
.prow-img{border-radius:10px;}

/* ── Buttons: pill physics everywhere ── */
.add-btn,.row-add,.dp-add-btn,.checkout-btn,.adm-btn{
  border-radius:999px;letter-spacing:.03em;font-weight:600;
  transition:transform .45s var(--ease),background .45s var(--ease),box-shadow .45s var(--ease),filter .45s var(--ease);
}
.add-btn,.row-add{padding:8px 12px;}
.add-btn:hover:not(:disabled),.row-add:hover:not(:disabled){box-shadow:0 6px 14px -7px rgba(26,23,16,.28);}
.add-btn:active:not(:disabled),.row-add:active:not(:disabled){transform:scale(.97);}
.dp-add-btn,.checkout-btn{
  padding:10px 10px 10px 22px;justify-content:space-between;
  background:linear-gradient(180deg,#336633,var(--green) 45%,var(--green-d));
  box-shadow:0 1px 0 rgba(255,255,255,.22) inset,0 8px 18px -8px rgba(26,23,16,.3);
}
.dp-add-btn::after,.checkout-btn::after{
  content:"→";flex-shrink:0;width:30px;height:30px;border-radius:50%;
  background:rgba(255,255,255,.16);box-shadow:0 1px 0 rgba(255,255,255,.18) inset;
  display:flex;align-items:center;justify-content:center;font-size:13px;
  transition:transform .5s var(--ease),background .5s var(--ease);
}
.dp-add-btn:hover:not(:disabled),.checkout-btn:hover:not(:disabled){filter:brightness(1.06);}
.dp-add-btn:hover:not(:disabled)::after,.checkout-btn:hover:not(:disabled)::after{transform:translateX(3px);background:rgba(255,255,255,.26);}
.dp-add-btn:disabled::after,.checkout-btn:disabled::after{background:rgba(26,23,16,.06);}
.dp-add-btn:disabled,.checkout-btn:disabled,.add-btn:disabled,.row-add:disabled{background:var(--paper3);box-shadow:none;filter:none;}
.dp-add-btn.added,.add-btn.added{background:linear-gradient(180deg,#B98F35,var(--gold-b));}
.qty-input,.dp-qty{border-width:1px;border-radius:10px;transition:border-color .4s var(--ease),box-shadow .4s var(--ease);}
.qty-input:focus,.dp-qty:focus{box-shadow:0 0 0 4px var(--green-l);}
.dp-qty-stepper{border-radius:999px;border-width:1px;overflow:hidden;background:#fff;}
.wchip{transition:background .4s var(--ease),border-color .4s var(--ease),color .4s var(--ease),transform .4s var(--ease);}
.wchip:hover{transform:translateY(-1px);}

/* ── Detail panel + cart drawer: gallery framing ── */
aside.detail{border-left:1px solid var(--hair);}
.dp-hdr{background:linear-gradient(180deg,#FFFEFC,var(--paper2));border-bottom:1px solid var(--hair);}
.dp-hero{
  border-radius:20px;border:1px solid var(--hair);padding:6px;background:#FFFEFC;
  box-shadow:0 1px 0 rgba(255,255,255,.85) inset,0 14px 32px -14px rgba(26,23,16,.14);height:232px;
}
.dp-hero img{border-radius:14px;}
.dp-hero-overlay{border-radius:14px;inset:6px;}
.dp-hero-name{bottom:16px;left:18px;right:18px;font-size:15px;}
.dp-hero-cat{top:16px;left:16px;}
.dp-hero-stock{top:16px;right:16px;}
.dp-price-card,.dp-ai-section,.dp-qty-section,.od-box,.stat-card{
  border-width:1px;border-color:var(--hair);border-radius:16px;
  box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 8px 20px -12px rgba(26,23,16,.08);
}
.dp-price-card.highlight{border-color:rgba(42,92,42,.22);}
.stat-val{font-family:var(--serif);font-size:27px;font-weight:600;}
#cartDrawer{
  border-radius:26px 0 0 26px;border-left:1px solid var(--hair);
  box-shadow:-24px 0 80px -20px rgba(26,23,16,.35);
  transition:transform .6s var(--ease);
}
.cart-hdr{background:linear-gradient(180deg,#FFFEFC,var(--paper2));border-bottom:1px solid var(--hair);}
.ci-img{border-radius:10px;box-shadow:0 0 0 1px var(--hair) inset;}
.ci-qty-btn{border-radius:50%;width:24px;height:24px;transition:background .35s var(--ease);}
.cart-note{border-width:1px;border-radius:14px;transition:border-color .4s var(--ease),box-shadow .4s var(--ease);}
.cart-note:focus{box-shadow:0 0 0 4px var(--green-l);}
@media(max-width:820px){#cartDrawer{border-radius:0;}}

/* ── Modals, tables, toast ── */
.adm-modal,.refund-modal{
  border-width:1px;border-color:var(--hair);border-radius:24px;
  box-shadow:0 0 0 7px rgba(253,251,247,.12),0 1px 0 rgba(255,255,255,.85) inset,var(--shadow-lg);
  animation:gateIn .5s var(--ease-o) both;
}
.adm-modal-overlay,.refund-modal-overlay{backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);}
.orders-table th,.vm-table th,.cat-disc-table th{letter-spacing:.14em;}
.orders-table tbody tr td,.vm-table td{transition:background .3s var(--ease);}
.status-pill{box-shadow:0 1px 0 rgba(255,255,255,.5) inset;}
#toast{
  background:rgba(26,23,16,.86);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  border:1px solid rgba(255,255,255,.12);box-shadow:0 18px 40px -12px rgba(26,23,16,.5);
  padding:11px 22px;letter-spacing:.02em;transition:transform .5s var(--ease);
}
#floatThemeBtn{transition:transform .45s var(--ease),background .45s var(--ease);}
#floatThemeBtn:hover{transform:translateY(-2px);}
.empty{font-family:var(--serif);font-size:18px;}

/* ── Catalog canvas breathing room ── */
main.catalog{padding:2rem 2.25rem 4rem;}
.cat-hdr{margin-bottom:1.75rem;}
@media(max-width:820px){
  main.catalog{padding:1rem .875rem 3rem;}
  .pcard{padding:4px;border-radius:calc(var(--r) + 4px);}
  .pcard-img{border-radius:calc(var(--r) - 2px);}
  .cat-title{font-size:26px;}
}

/* ── Restraint switch ── */
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001s !important;transition-duration:.001s !important;}
}
</style>"""

THEME_SUBS = [
    ("  colorPaper:   '#FAF8F3',\n  colorPaper2:  '#F3F0E8',",
     "  colorPaper:   '#FDFBF7',\n  colorPaper2:  '#F5F1E8',"),
    ("  colorGreenL:  '#E6F0E6',\n  colorGold:    '#B8860B',",
     "  colorGreenL:  '#E9F1E6',\n  colorGold:    '#A9812F',"),
    ("  fontBody:     'DM Sans',\n  fontLogo:     'Playfair Display',",
     "  fontBody:     'Schibsted Grotesk',\n  fontLogo:     'Cormorant Garamond',"),
    ("const fonts = ['DM Sans','Playfair Display',",
     "const fonts = ['Schibsted Grotesk','Cormorant Garamond','DM Sans','Playfair Display',"),
]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def replace_counted(s, old, new, expected):
    n = s.count(old)
    if n != expected:
        sys.exit(f"ERROR: expected {expected} occurrence(s) of {old[:60]!r}, found {n}")
    return s.replace(old, new)


def main():
    p = Path("index.html")
    raw = p.read_bytes()
    cur = sha256(raw)
    if cur == NEW_SHA:
        print("OK: design patch already applied, nothing to do")
        return
    if cur != BASE_SHA:
        sys.exit(f"ERROR: index.html sha {cur} != expected base {BASE_SHA}; "
                 "upstream changed since this patch was built. Aborting.")

    s = raw.decode("utf-8")

    # 1. Route every font-family in the main style block through tokens
    #    (must run before the token block below introduces those literals).
    head, sep, tail = s.partition("</style>\n</head>")
    head = replace_counted(head, "'DM Sans',sans-serif", "var(--sans)", 43)
    head = replace_counted(head, "'Playfair Display',serif", "var(--serif)", 9)
    s = head + sep + tail

    # 2. Premium font loading, design tokens, elevation override layer.
    s = replace_counted(s, FONT_LINK_OLD, FONT_LINK_NEW, 1)
    s = replace_counted(s, ROOT_OLD, ROOT_NEW, 1)
    s = replace_counted(s, LAYER_ANCHOR, ELEVATION, 1)

    # 3. Runtime theme defaults (applyTheme would otherwise restore old look).
    for old, new in THEME_SUBS:
        s = replace_counted(s, old, new, 1)

    out = s.encode("utf-8")
    got = sha256(out)
    if got != NEW_SHA:
        sys.exit(f"ERROR: result sha {got} != expected {NEW_SHA}; "
                 "refusing to write a build that differs from the previewed one.")
    p.write_bytes(out)
    print("OK: design patch applied and verified byte-for-byte")

    if os.environ.get("DRY_RUN"):
        print("DRY_RUN set: skipping commit/push")
        return

    run = lambda *a: subprocess.run(a, check=True)
    run("git", "config", "user.email", "design@seidkarlinn.is")
    run("git", "config", "user.name", "Design")
    run("git", "add", "index.html")
    run("git", "commit", "-m",
        "design: editorial elevation refresh\n\n"
        "Cormorant Garamond + Schibsted Grotesk, warm-paper tokens, "
        "double-bezel cards, pill buttons with nested arrow chips, "
        "film grain, custom-bezier motion. CSS/token layer only; "
        "no application logic touched.")
    run("git", "push")
    print("OK: committed and pushed")


if __name__ == "__main__":
    main()
