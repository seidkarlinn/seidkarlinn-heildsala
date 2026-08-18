#!/usr/bin/env python3
"""One-shot slot: afhendingarseðill -> afhendingarlisti (wording only).

Payload version: 2 (re-push to fire the workflow's push trigger).

The previous payload turned the generated document from an invoice into a
delivery note (commit 351a179). Its bot commit carried [skip ci], so Netlify
skipped that build and the change never reached production. This payload
renames the document to "afhendingarlisti" as requested and commits WITHOUT
[skip ci] so Netlify deploys both changes together.

Idempotent — exits 0 with no changes when index.html already says
AFHENDINGARLISTI. Aborts if index.html is in neither expected state.
"""
import io, pathlib, subprocess, sys

P = pathlib.Path("index.html")

# Exact anchors first (these must not be touched by the generic stem rules).
EXACT = [
    ('<div class="invoice-subtitle">Fylgiseðill / tínslulisti — ekki reikningur</div>',
     '<div class="invoice-subtitle">Tínslu- og fylgilisti — ekki reikningur</div>'),
    ('<strong>Þetta skjal er afhendingarseðill (fylgiseðill) — ekki reikningur og ekki greiðslukvittun.</strong>',
     '<strong>Þetta skjal er afhendingarlisti (fylgiskjal) — ekki reikningur og ekki greiðslukvittun.</strong>'),
    ('// AFHENDINGARSEÐILL Í PDF — Sækja fylgiseðil fyrir pöntun',
     '// AFHENDINGARLISTI Í PDF — Sækja afhendingarlista fyrir pöntun'),
    ("""        <div class="cat-sub">${orders.length} afhendingarseðill${orders.length !== 1 ? 'ar' : ''}</div>""",
     """        <div class="cat-sub">${orders.length} afhendingarlist${orders.length !== 1 ? 'ar' : 'i'}</div>"""),
    ("a.download = 'Afhendingarsedill-' + invoiceNo + '.html';",
     "a.download = 'Afhendingarlisti-' + invoiceNo + '.html';"),
]

# Generic word forms, longest stem first.
STEMS = [
    ("AFHENDINGARSEÐILL", "AFHENDINGARLISTI"),
    ("Afhendingarseðlar", "Afhendingarlistar"),
    ("afhendingarseðlar", "afhendingarlistar"),
    ("Afhendingarseðill", "Afhendingarlisti"),
    ("afhendingarseðill", "afhendingarlisti"),
    ("Afhendingarseðil", "Afhendingarlista"),
    ("afhendingarseðil", "afhendingarlista"),
]


def apply_patch() -> bool:
    s = io.open(P, encoding="utf-8").read()
    if "AFHENDINGARLISTI" in s:
        print("index.html already says AFHENDINGARLISTI; nothing to do.")
        return False
    if "AFHENDINGARSEÐILL" not in s:
        sys.exit("PATCH ABORTED - index.html contains neither AFHENDINGARSEÐILL "
                 "nor AFHENDINGARLISTI; refusing to guess.")

    for old, new in EXACT:
        if old not in s:
            sys.exit("PATCH ABORTED - anchor not found:\n" + old[:200])
        s = s.replace(old, new)

    for old, new in STEMS:
        s = s.replace(old, new)

    io.open(P, "w", encoding="utf-8").write(s)
    print("index.html patched: afhendingarseðill -> afhendingarlisti")
    return True


def main() -> None:
    if not apply_patch():
        return

    changed = subprocess.run(["git", "diff", "--quiet", "--", "index.html"]).returncode != 0
    if not changed:
        print("index.html unchanged; nothing to commit.")
        return
    run = lambda *a: subprocess.run(list(a), check=True)
    run("git", "config", "user.name", "seidkarlinn-bot")
    run("git", "config", "user.email", "bot@seidkarlinn.is")
    run("git", "add", "index.html")
    # No [skip ci]: the previous delivery-note commit was skipped by Netlify,
    # so this build must go out and carry both changes to production.
    run("git", "commit", "-m",
        "feat: endurnefna afhendingarsedil i afhendingarlista\n\n"
        "Titill skjalsins verdur AFHENDINGARLISTI, undirtitill 'Tinslu- og\n"
        "fylgilisti - ekki reikningur'. Hnappar: 'Saekja afhendingarlista i PDF',\n"
        "spjald: 'Afhendingarlistar', skraarnafn: Afhendingarlisti-SK-xxxx.html,\n"
        "tilkynningar og villuskilabod uppfaerd i somu ord.")
    run("git", "push")
    print("Pushed.")


if __name__ == "__main__":
    main()
