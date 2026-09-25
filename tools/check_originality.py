#!/usr/bin/env python3
"""Check that nothing we ship repeats the wording of the original INWO cards or rulebook.

Usage: python3 tools/check_originality.py <card_text.json> [rules.txt]

The reference files (text read off the printed cards, and the original rulebook) are copyrighted
and are NOT part of this repository: keep them local. The check fails when any of our text shares a
run of 8 or more consecutive words with the original, or when a card's own description shares 20% or more of its
distinctive 4-word sequences with that card's original text. The game's common vocabulary
(phrases found on several cards or throughout the rulebook) does not count.
"""
import glob, json, re, sys
import openpyxl

RUN, SHARE = 8, 0.20
words = lambda t: re.findall(r"[a-z0-9+\-']+", (t or '').lower())
grams = lambda ws, k: {tuple(ws[i:i + k]) for i in range(len(ws) - k + 1)}
norm = lambda n: re.sub(r'[^a-z0-9]', '', (n or '').lower())

cards_ref = json.load(open(sys.argv[1]))
rules_ref = open(sys.argv[2]).read() if len(sys.argv) > 2 else ''

# Phrases that recur on several cards or throughout the rulebook are the game's vocabulary
# ("attack to control any", "a roll of 11 or 12"): using them is not copying. Only distinctive
# wording counts.
from collections import Counter
def vocab(k):
    seen = Counter()
    for t in cards_ref.values():
        seen.update(grams(words(t), k))
    rules = Counter(tuple(words(rules_ref)[i:i + k]) for i in range(len(words(rules_ref)) - k + 1))
    return {g for g, n in seen.items() if n >= 3} | {g for g, n in rules.items() if n >= 3}
common6, common4 = vocab(RUN), vocab(4)
all_ref = ' \n '.join(list(cards_ref.values()) + [rules_ref])
ref6, ref4 = grams(words(all_ref), RUN) - common6, grams(words(all_ref), 4) - common4

def check(where, text, own=None):
    ws = words(text)
    runs = grams(ws, RUN) & ref6
    share = 0
    if own is not None:  # a card's description against that card's original wording
        g4 = grams(ws, 4) - common4
        share = len(g4 & (grams(words(own), 4) - common4)) / len(g4) if len(g4) >= 5 else 0
    if runs or share >= SHARE:
        sample = ' '.join(next(iter(runs))) if runs else ''
        problems.append((where, round(share, 2), sample, text[:110].replace('\n', ' ')))

problems = []
# 1. Card data shipped with the game.
for c in json.load(open('src/data/cards.json')):
    own = cards_ref.get(norm(c['name']), '')
    own = cards_ref.get(norm(c['name']), '')
    for f, v in c.items():
        if isinstance(v, str) and len(v) > 25 and f not in ('name', 'id'):
            check(f"cards.json {c['name']} .{f}", v, own)
# 2. Every text cell of the workbook.
wb = openpyxl.load_workbook('data/Elitists_War.xlsx', read_only=True)
for ws in wb:
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        own = cards_ref.get(norm(row[0])) if ws.title == 'Card Database' and row and isinstance(row[0], str) else None
        for j, v in enumerate(row):
            if isinstance(v, str) and len(v) > 25 and not v.startswith('http'):
                check(f"xlsx {ws.title} R{i}C{j + 1}", v, own if j else None)
# 3. Source code strings and comments, docs.
for path in glob.glob('src/**/*.ts', recursive=True) + glob.glob('docs/*.md') + ['README.md', 'RULES_COMPLIANCE.md']:
    for n, line in enumerate(open(path, encoding='utf8'), 1):
        if len(line) > 30:
            check(f"{path}:{n}", line)

for p in problems:
    print(*p, sep=' | ')
print(f"{len(problems)} problem(s)")
sys.exit(1 if problems else 0)
