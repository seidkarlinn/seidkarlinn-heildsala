#!/usr/bin/env python3
# One-shot: applies design-restoration.patch to index.html, then restores
# this script to its original content from main so the branch diff stays
# limited to index.html. Runs inside fix-shopify-sync.yml (contents: write).
import hashlib
import os
import subprocess
import sys

PATCH = 'design-restoration.patch'
PATCH_SHA = '35c18d33dae7783f1697c5a33e961446e1c558c29cf62b26baf66ffdd2f7f22f'
RESULT_SHA = 'fcf9cdc8b055c4dd111873ffba10627f1dbf0adb66f8dc7a3803e53f2291e2a4'


def run(*cmd):
    print('+', ' '.join(cmd), flush=True)
    subprocess.check_call(cmd)


if not os.path.exists(PATCH):
    print('patch not present; nothing to do')
    sys.exit(0)

with open(PATCH, 'rb') as f:
    got = hashlib.sha256(f.read()).hexdigest()
assert got == PATCH_SHA, 'patch checksum mismatch: ' + got

run('git', 'apply', PATCH)

with open('index.html', encoding='utf-8') as f:
    s = f.read()
old = '\'DM Sans\',sans-serif">\U0001F511 Innskrá</button>'
new = '\'DM Sans\',sans-serif">Innskrá</button>'
assert s.count(old) == 1, 'expected 1 occurrence, got %d' % s.count(old)
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(s.replace(old, new))

with open('index.html', 'rb') as f:
    got = hashlib.sha256(f.read()).hexdigest()
assert got == RESULT_SHA, 'result checksum mismatch: ' + got

run('git', 'rm', '-q', PATCH)
run('git', 'fetch', 'origin', 'main')
run('git', 'checkout', 'origin/main', '--', '.github/scripts/fix-shopify-sync.py')
run('git', 'config', 'user.name', 'claude-design-bot')
run('git', 'config', 'user.email', 'noreply@anthropic.com')
run('git', 'add', '-A')
run('git', 'commit',
    '-m', 'fix(design): restore dead design tokens, polish typography, focus states and chrome icons',
    '-m', 'The :root token block was dead code: a stray h after the TOKENS comment '
          'turned the selector into "h :root", which matches nothing. Only the 7 '
          'variables re-applied by applyTheme() at runtime worked; border radii, '
          'soft borders, shadows, muted ink shades and the gold/red palette were '
          'undefined in production. Also: ink-tinted shadows, tabular numerals on '
          'prices and tables, text-wrap balance on headings, focus-visible rings, '
          'pressed feedback on buttons, consistent stroke SVG chrome icons instead '
          'of emoji, meta/OG tags, duplicate media query removed, dvh fallback.\n\n'
          'Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>')
run('git', 'push', 'origin', 'HEAD:design-restoration-polish')
print('DONE')
