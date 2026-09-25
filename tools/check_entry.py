#!/usr/bin/env python3
"""Originality check for ONE drafted card info sheet, run before the entry is accepted.

Usage: python3 tools/check_entry.py <card_text.json> <rules.txt> <entry.json>

Same test as check_originality.py (no run of 8+ words shared with the original cards or rulebook;
under 20% of distinctive 4-word sequences shared with that card's original text), applied to every
text field of the entry. Also refuses quotations credited to someone ("... — Name"), since real
cards often carry quotes and those must never be reused. Prints PASS, or each problem; exit 1 on problems.
"""
import json, re, sys
from collections import Counter

RUN, SHARE = 8, 0.20
words = lambda t: re.findall(r"[a-z0-9+\-']+", (t or '').lower())
grams = lambda ws, k: {tuple(ws[i:i + k]) for i in range(len(ws) - k + 1)}
norm = lambda n: re.sub(r'[^a-z0-9]', '', (n or '').lower())

cards_ref = json.load(open(sys.argv[1]))
rules_ref = open(sys.argv[2]).read()
entry = json.load(open(sys.argv[3]))

def vocab(k):
    seen = Counter()
    for t in cards_ref.values(): seen.update(grams(words(t), k))
    rw = words(rules_ref)
    rules = Counter(tuple(rw[i:i + k]) for i in range(len(rw) - k + 1))
    return {g for g, n in seen.items() if n >= 3} | {g for g, n in rules.items() if n >= 3}
common8, common4 = vocab(RUN), vocab(4)
all_ref = ' \n '.join(list(cards_ref.values()) + [rules_ref])
ref8 = grams(words(all_ref), RUN) - common8
own = grams(words(cards_ref.get(norm(entry.get('name')), '')), 4) - common4

problems = []
for field, text in entry.items():
    if not isinstance(text, str) or len(text) < 20 or field in ('name', 'id', 'imageFile'):
        continue
    ws = words(text)
    for g in grams(ws, RUN) & ref8:
        problems.append(f"{field}: shares the run '{' '.join(g)}' with the original")
    g4 = grams(ws, 4) - common4
    if len(g4) >= 5 and len(g4 & own) / len(g4) >= SHARE:
        problems.append(f"{field}: {len(g4 & own) / len(g4):.0%} of its 4-word phrases match this card's original text")
    if re.search(r'["“].{5,}["”]\s*[-—–]\s*\w', text) or re.search(r'[—–-]{1,2}\s*[A-Z][a-z]+(\s[A-Z][a-z.]+)*\s*$', text.strip()):
        problems.append(f"{field}: looks like a quotation credited to someone; write original flavour with no attribution")
print('\n'.join(problems) if problems else 'PASS')
sys.exit(1 if problems else 0)
