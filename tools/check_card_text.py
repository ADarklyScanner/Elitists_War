#!/usr/bin/env python3
"""Check one final card-text file against docs/CARD_TEXT_STYLE.md budgets.

Usage: python3 tools/check_card_text.py <final.json> [<dir of other finals for opener clashes>]
Prints OK or each problem; exit 1 on problems.
"""
import json, os, re, sys

f = json.load(open(sys.argv[1]))
words = lambda t: len(re.findall(r"[\w'+\-]+", t or ''))
t, sub = f.get('type'), (f.get('subtype') or '')
has_ability = bool((f.get('rulesText') or '').strip())
if t == 'Group' and not has_ability: R, F, TOT = (0, 0), (12, 30), 30
elif t == 'Group': R, F, TOT = (8, 35), (6, 20), 55
elif t == 'Illuminati': R, F, TOT = (20, 65), (6, 15), 70
elif t == 'Resource': R, F, TOT = (10, 40), (6, 18), 55
elif sub in ('Disaster', 'Assassination'): R, F, TOT = (10, 40), (6, 15), 55
elif sub == 'NWO': R, F, TOT = (10, 35), (6, 15), 50
elif sub == 'Goal': R, F, TOT = (10, 35), (6, 15), 50
else: R, F, TOT = (8, 40), (6, 18), 55
r, fl = words(f.get('rulesText')), words(f.get('flavorText'))
probs = []
if has_ability and not (R[0] <= r <= R[1]): probs.append(f'rules text {r} words (budget {R[0]}-{R[1]})')
if not (F[0] <= fl <= F[1]): probs.append(f'flavour {fl} words (budget {F[0]}-{F[1]})')
if r + fl > TOT: probs.append(f'total {r + fl} words (max {TOT})')
if re.search(r'["“”]', f.get('flavorText') or ''): probs.append('flavour contains quotation marks')
if len(sys.argv) > 2:
    op = lambda s: ' '.join(re.findall(r"[a-z']+", (s or '').lower())[:3])
    mine = op(f.get('flavorText'))
    for g in os.listdir(sys.argv[2]):
        p = os.path.join(sys.argv[2], g)
        if g.endswith('.json') and os.path.abspath(p) != os.path.abspath(sys.argv[1]):
            o = json.load(open(p))
            if mine and op(o.get('flavorText')) == mine: probs.append(f'flavour opening "{mine}" also used by {o.get("name")}')
print('\n'.join(probs) if probs else 'OK')
sys.exit(1 if probs else 0)
