#!/usr/bin/env python3
# One-shot: applies fix-images.patch (stale product image URLs -> current
# Shopify CDN files) to index.html and inject-catalog.js, then restores this
# script from main so the branch diff stays limited to the two data files.
import hashlib
import os
import subprocess
import sys

PATCH = 'fix-images.patch'
PATCH_SHA = '91ff6bdbc480eff28b5d8cef83353035411c6a1a501437e939922ca42e591fc1'
RESULT_SHAS = {
    'index.html': '0e1e26271358babb4ead0da209ed43018424e7b523c25a7751cca4a85300c918',
    'netlify/edge-functions/inject-catalog.js': '6d17967992d5494bb3f45452fc1a70b89463d1108bf255575d809ae184a739ae',
}


def run(*cmd):
    print('+', ' '.join(cmd), flush=True)
    subprocess.check_call(cmd)


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


if not os.path.exists(PATCH):
    print('patch not present; nothing to do')
    sys.exit(0)

assert sha(PATCH) == PATCH_SHA, 'patch checksum mismatch: ' + sha(PATCH)

run('git', 'apply', PATCH)

for path, want in RESULT_SHAS.items():
    got = sha(path)
    assert got == want, f'{path} checksum mismatch: {got}'

run('git', 'rm', '-q', PATCH)
run('git', 'fetch', 'origin', 'main')
run('git', 'checkout', 'origin/main', '--', '.github/scripts/fix-shopify-sync.py')
run('git', 'config', 'user.name', 'claude-design-bot')
run('git', 'config', 'user.email', 'noreply@anthropic.com')
run('git', 'add', '-A')
run('git', 'commit',
    '-m', 'fix(catalog): repoint 31 stale product image URLs at current Shopify CDN files',
    '-m', 'Products were re-photographed or renamed on the Shopify store, so the '
          'image URLs snapshotted in the wholesale catalog (index.html PRODUCTS '
          'and the inject-catalog.js edge-injected entries) returned 404. All new '
          'URLs were resolved via the Shopify Admin API and verified to return '
          '200 before committing. Also fills the missing image for Varia '
          'Fermented NAC. One product (Freeze-Dried jardarber 100g) has no '
          'matching product in Shopify anymore and was left unchanged.\n\n'
          'Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>')
run('git', 'push', 'origin', 'HEAD:fix-product-images')
print('DONE')
