#!/usr/bin/env python3
"""One-shot price sync: align retail prices in index.html PRODUCTS with the
live published prices on seidkarlinn.is (Shopify storefront), verified
per-product on 2026-07-20. Wholesale prices intentionally untouched.

Idempotent: exits 0 when index.html already matches the target build.
Aborts without touching anything if index.html is not the expected base.
"""
import hashlib, json, pathlib, subprocess, sys

BASE_SHA = "659a2cdeceb6308daf3f1580b788faff37a7d027bb8c866bb4fc80abf8661d21"
TARGET_SHA = "04d74e4727524a0762c2be79701376da5456d03b18aaca036822c90f210b9ed4"

# (product name, old retail price, new retail price from seidkarlinn.is)
PAIRS = [
  [
    "Freeze-Dried Seiðkarlinn bláber 200g",
    "4.962 ISK",
    "6.203 ISK"
  ],
  [
    "Freeze-Dried Blackberry 30g Seiðkarlinn",
    "993 ISK",
    "828 ISK"
  ],
  [
    "CocoCoast natural 320ml",
    "frá 350 ISK",
    "frá 399 ISK"
  ],
  [
    "CocoCoast sparkling 320ml",
    "8.400 ISK",
    "399 ISK"
  ],
  [
    "Lignosus tiger milk mushroom 30 stikur",
    "9.490 ISK",
    "6.990 ISK"
  ],
  [
    "Nutriest grass-fed whey protein 1kg",
    "9.490 ISK",
    "9.990 ISK"
  ],
  [
    "Nutriest hydrolyzed collagen peptides 300g",
    "7.490 ISK",
    "5.990 ISK"
  ],
  [
    "Nutriest marine collagen 300g",
    "12.990 ISK",
    "9.990 ISK"
  ],
  [
    "Nutriest beef liver 240 hylki",
    "9.990 ISK",
    "8.990 ISK"
  ],
  [
    "Nutriest beef testicles 240 hylki",
    "11.990 ISK",
    "9.990 ISK"
  ],
  [
    "Nutriest beef organ complex 240 hylki",
    "10.990 ISK",
    "9.990 ISK"
  ],
  [
    "Nutriest ultimate organ complex 240 hylki",
    "11.990 ISK",
    "9.990 ISK"
  ],
  [
    "Nutriest colostrum extract 240 hylki",
    "11.990 ISK",
    "9.990 ISK"
  ],
  [
    "Nutriest ox bile 60 hylki",
    "9.490 ISK",
    "6.990 ISK"
  ],
  [
    "Nutriest pregnancy and fertility 240 hylki",
    "11.990 ISK",
    "9.990 ISK"
  ],
  [
    "The Lekker Co. woodland deodorant soft 30g",
    "1.476 ISK",
    "1.649 ISK"
  ],
  [
    "Mountaindrop elixir shilajit myntu sápa 100gr",
    "1.490 ISK",
    "1.334 ISK"
  ],
  [
    "Seiðkarlinn skegg olía 30ml",
    "3.990 ISK",
    "3.572 ISK"
  ],
  [
    "Freeze-Dried Seðkarlinn Bananar 30g",
    "706 ISK",
    "824 ISK"
  ],
  [
    "Nutriest Beef Thyroid 240 hylki",
    "11.990 ISK",
    "9.990 ISK"
  ],
  [
    "Nutriest Organ Complex 135g doypack",
    "10.990 ISK",
    "9.990 ISK"
  ],
  [
    "Nutriest Beef Brain 240hylki",
    "11.990 ISK",
    "9.990 ISK"
  ],
  [
    "Nutriest pure oyster extract 120hylki",
    "9.990 ISK",
    "8.990 ISK"
  ]
]

COMMIT_MSG = """sync: retail prices from seidkarlinn.is (Shopify)

23 products updated to the current published prices on the retail
store (verified per-product against the live storefront). Wholesale
prices left unchanged by request. 46 catalog entries whose retail
product no longer exists on seidkarlinn.is were left untouched.
"""


def main() -> None:
    p = pathlib.Path("index.html")
    s = p.read_text(encoding="utf-8")
    cur = hashlib.sha256(s.encode("utf-8")).hexdigest()
    if cur == TARGET_SHA:
        print("index.html already at target; nothing to do.")
        return
    if cur != BASE_SHA:
        print(f"ABORT: index.html sha {cur} is neither base nor target.")
        sys.exit(1)

    for name, old, new in PAIRS:
        anchor = json.dumps(name, ensure_ascii=False)
        i = s.find(anchor)
        if i == -1:
            print(f"ABORT: product not found: {name}")
            sys.exit(1)
        seg_start = s.rfind("{", 0, i)
        seg_end = s.find("}", i)
        seg = s[seg_start:seg_end]
        old_pair = f'"price": {json.dumps(old, ensure_ascii=False)},'
        new_pair = f'"price": {json.dumps(new, ensure_ascii=False)},'
        if seg.count(old_pair) != 1:
            print(f"ABORT: expected 1 occurrence for {name}, got {seg.count(old_pair)}")
            sys.exit(1)
        s = s[:seg_start] + seg.replace(old_pair, new_pair) + s[seg_end:]

    if hashlib.sha256(s.encode("utf-8")).hexdigest() != TARGET_SHA:
        print("ABORT: result does not match expected target; not writing.")
        sys.exit(1)
    p.write_text(s, encoding="utf-8")
    print("index.html price-synced and verified.")

    run = lambda *a: subprocess.run(list(a), check=True)
    run("git", "config", "user.name", "seidkarlinn-bot")
    run("git", "config", "user.email", "bot@seidkarlinn.is")
    run("git", "add", "index.html")
    run("git", "commit", "-m", COMMIT_MSG)
    run("git", "push")
    print("Pushed.")


if __name__ == "__main__":
    main()
