#!/usr/bin/env python3
"""
One-shot patch for two corrupted product URLs in index.html.

Two entries in PRODUCTS_BASE had their `url` field wired to unrelated
Shopify products, so the syncWithShopify button checked the wrong items'
availability:

  Raw Seiðkarlinn lyngblóma hunang 1kg
    /products/women-s-hormone-balance-gh-59-2ml
      -> /products/seidkarlinn-lyngbloma-hunang-1kg
  Raw Seiðkarlinn lyngblóma hunang 500g
    /products/zh-black-aged-garlic-extract-60-hylki-1
      -> /products/seidkarlinn-lyngbloma-hunang-500g

Both replacement handles exist in https://www.seidkarlinn.is/products.json
and Shopify reports them as out-of-stock, which is what should appear in
the wholesale view.
"""

import sys
from pathlib import Path

REPLACEMENTS = [
    ('women-s-hormone-balance-gh-59-2ml', 'seidkarlinn-lyngbloma-hunang-1kg'),
    ('zh-black-aged-garlic-extract-60-hylki-1', 'seidkarlinn-lyngbloma-hunang-500g'),
]


def main():
    p = Path('index.html')
    html = p.read_text(encoding='utf-8')
    new_html = html
    for old, new in REPLACEMENTS:
        count = new_html.count(old)
        if count == 0:
            print(f'WARN: pattern {old!r} not found (already patched?)', file=sys.stderr)
            continue
        if count > 1:
            print(f'ERROR: pattern {old!r} appears {count} times, expected exactly 1', file=sys.stderr)
            sys.exit(1)
        new_html = new_html.replace(old, new, 1)
        print(f'OK: {old} -> {new}')

    if new_html == html:
        print('No changes made (file already patched?)', file=sys.stderr)
        return

    p.write_text(new_html, encoding='utf-8')
    print('OK: index.html patched')


if __name__ == '__main__':
    main()
