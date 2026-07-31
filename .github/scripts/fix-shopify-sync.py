#!/usr/bin/env python3
"""Delegates to fix-user-discount.py.

The original one-shot Shopify retail-price sync (2026-07-20) completed and
was committed; index.html has since moved past that script's TARGET_SHA, so
its SHA guard would only abort. This slot now follows the same established
pattern to ship the next one-shot fix: the fix-shopify-sync.yml workflow
triggers on pushes to this file, runs it, and commits the result.

Current payload: per-user discount display fix (see fix-user-discount.py).
Idempotent — exits 0 with no changes when index.html is already patched.
"""
import pathlib, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent

def main() -> None:
    # Apply the patch (aborts non-zero if index.html is unexpected).
    subprocess.run([sys.executable, str(HERE / "fix-user-discount.py")], check=True)

    # Commit + push only if index.html actually changed.
    changed = subprocess.run(["git", "diff", "--quiet", "--", "index.html"]).returncode != 0
    if not changed:
        print("index.html unchanged; nothing to commit.")
        return
    run = lambda *a: subprocess.run(list(a), check=True)
    run("git", "config", "user.name", "seidkarlinn-bot")
    run("git", "config", "user.email", "bot@seidkarlinn.is")
    run("git", "add", "index.html")
    run("git", "commit", "-m",
        "fix: show per-user discount from ws_pricing_users instead of global default\n\n"
        "getMyDiscount() ignored ws_pricing_users and always returned the theme's\n"
        "global discountPct (25%), so buyers - reported by Fiskkompani - saw the\n"
        "wrong discount in the header chip and fallback price calc. Now derives\n"
        "the representative discount from the user's effective category pricing.\n"
        "Also: case-insensitive pricing lookups and lowercase-normalized saves\n"
        "in the admin pricing panel. [skip ci]")
    run("git", "push")
    print("Pushed.")

if __name__ == "__main__":
    main()
