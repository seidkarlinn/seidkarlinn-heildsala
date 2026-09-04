#!/usr/bin/env python3
"""One-shot payload: standard honey discount 35% -> 40%.

STANDARD_PRICING_TEMPLATE.cats["Hunangsafurðir"] in ws-sync-layer.js is the
seed applied to every NEW buyer account (seedDefaultPricing / saveVm wrap).
It goes from 35 to 40.

Scope: seeding only. Existing buyers' percentages live in ws_pricing_users in
the Netlify Blob Store and are runtime data — this deploy does not touch them.
Adjust existing customers in "Verð og afslættir" if they should also get 40%.

Idempotent: exits 0 without changes if already at 40.
Aborts (exit 1) if neither the old nor the new value is present.
"""
import io
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
TARGET = ROOT / "ws-sync-layer.js"

OLD = '      "Hunangsafurðir": 35,'
NEW = '      "Hunangsafurðir": 40,'


def main() -> None:
    s = io.open(TARGET, encoding="utf-8").read()

    if NEW in s:
        print("Already patched — Hunangsafurðir is 40%.")
        return
    if s.count(OLD) != 1:
        sys.exit("ABORT: expected exactly 1 occurrence of %r, found %d" % (OLD, s.count(OLD)))

    io.open(TARGET, "w", encoding="utf-8").write(s.replace(OLD, NEW))
    print("Patched ws-sync-layer.js — Hunangsafurðir 35% -> 40%.")

    # The workflow's own commit step stages index.html only and hardcodes
    # [skip ci] (which Netlify honours by skipping the build), so this payload
    # commits and pushes its own file without it.
    subprocess.run(["git", "config", "user.email", "sync@seidkarlinn.is"], check=True)
    subprocess.run(["git", "config", "user.name", "Sync"], check=True)
    subprocess.run(["git", "add", "ws-sync-layer.js"], check=True)
    if subprocess.run(["git", "diff", "--staged", "--quiet"]).returncode == 0:
        print("Nothing staged — no commit.")
        return
    subprocess.run(
        ["git", "commit", "-m", "feat: stadalafslattur a hunangi 35% -> 40% (nyir vidskiptamenn)"],
        check=True,
    )
    subprocess.run(["git", "push"], check=True)


if __name__ == "__main__":
    main()
