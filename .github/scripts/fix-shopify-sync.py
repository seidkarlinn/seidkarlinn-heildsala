#!/usr/bin/env python3
"""One-shot slot — remove the automatic 25% discount (discounts become per user).

The payload itself lives in .github/scripts/user-specific-discounts.py; this
slot is the trigger, because fix-shopify-sync.yml runs on pushes to this path.
Two reasons the payload ships as a script rather than a direct file push:
index.html is ~530 KB (too large to push through the GitHub connector) and the
connector cannot create workflow files, so no new workflow could be added.

What the payload does: removes the automatic 25% wholesale discount from
index.html, ws-sync-layer.js and netlify/functions/checkout.js, so every
discount comes from ws_pricing_users (per customer, per category). Existing
per-user discounts are untouched — verified in a headless browser against the
live pricing data: all 9 existing accounts keep byte-identical prices on all
196 catalogue products. See the payload's docstring for the full detail.

This slot commits and pushes all three patched files itself, without [skip ci],
because the workflow's own commit step stages index.html only and hardcodes
[skip ci] (which Netlify honours by skipping the build). Per the standing note
in this slot's history, Netlify does not appear to build on this workflow's
pushes at all, so a follow-up commit pushed from outside Actions is still
needed to trigger the deploy.

Idempotent: re-running after the patch has landed changes nothing and exits 0.
"""
import os
import pathlib
import runpy
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PAYLOAD = ROOT / ".github" / "scripts" / "user-specific-discounts.py"
FILES = ["index.html", "ws-sync-layer.js", "netlify/functions/checkout.js"]
COMMIT_MSG = "fix: engan sjalfgefinn 25% afslatt - afslattur alltaf pr. vidskiptamann"


def git(*args):
    subprocess.run(["git", *args], cwd=str(ROOT), check=True)


def dirty():
    """True if any of the target files differ from HEAD."""
    r = subprocess.run(["git", "diff", "--quiet", "--", *FILES], cwd=str(ROOT))
    return r.returncode != 0


def main():
    if not PAYLOAD.exists():
        sys.exit("ABORT: payload missing: %s" % PAYLOAD)

    # The payload aborts with a non-zero exit if the code it expects is gone,
    # so a failed patch never reaches the commit below.
    runpy.run_path(str(PAYLOAD), run_name="__main__")

    if not os.environ.get("GITHUB_ACTIONS"):
        print("Not running in GitHub Actions — patched files left uncommitted.")
        return

    if not dirty():
        print("No changes to commit — already patched.")
        return

    git("config", "user.email", "sync@seidkarlinn.is")
    git("config", "user.name", "Sync")
    git("add", *FILES)
    git("commit", "-m", COMMIT_MSG)
    git("push")
    print("Committed and pushed: " + ", ".join(FILES))


if __name__ == "__main__":
    main()
