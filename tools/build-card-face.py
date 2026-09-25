#!/usr/bin/env python3
"""Collect the finished card-face text into src/data/cardFace.json (id -> rules, goal, flavour).

Usage: python3 tools/build-card-face.py <folder of final/<NNN>-<id>.json files>
"""
import json, glob, sys
out = {}
for f in sorted(glob.glob(f'{sys.argv[1]}/*.json')):
    d = json.load(open(f))
    out[d['id']] = {'rules': d.get('rulesText', ''), 'goal': d.get('specialGoal', ''), 'flavor': d.get('flavorText', '')}
json.dump(out, open('src/data/cardFace.json', 'w'), ensure_ascii=False, indent=0)
print(f'src/data/cardFace.json: {len(out)} cards')
