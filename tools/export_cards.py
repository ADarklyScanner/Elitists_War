"""Export the Card Database tab of data/Elitists_War.xlsx to src/data/cards.json."""
import json, re, openpyxl, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
wb = openpyxl.load_workbook(os.path.join(ROOT, 'data/Elitists_War.xlsx'))
db = wb['Card Database']
H = [c.value for c in db[1]]

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def lst(v):
    if not v or str(v).strip() in ('None', 'N/A', 'NONE'): return []
    return [x.strip() for x in str(v).split(',') if x.strip()]

def num(v):
    m = re.match(r'\s*(\d+)', str(v or ''))
    return int(m.group(1)) if m else 0

cards = []
for row in db.iter_rows(min_row=2, values_only=True):
    r = dict(zip(H, row))
    t = r['Card Type']
    c = {
        'id': slug(r['Card Name']), 'name': r['Card Name'], 'type': t,
        'subtype': r['Subtype'] or t, 'rarity': r['Rarity'],
        'text': r['Mechanical Behavior (paraphrased)'],
        'trigger': r['Trigger'], 'target': r['Target selector'], 'cost': r['Cost'],
        'duration': r['Duration / expiry'], 'modifier': r['Modifier / state change'],
        'uniqueness': r['Uniqueness / Duplicate Rule'], 'notes': r['Research Notes'],
        'playRequirement': r['Play Requirement'], 'responseWindow': r['Response Window'],
    }
    pg = str(r['Power / Global'] or '')
    if t == 'Illuminati':
        m = re.search(r'Power (\d+)/(\d+)', c['text'] or '')
        c.update(power=int(m.group(1)), globalPower=int(m.group(2)), resistance=None,
                 alignments=[], attributes=[], arrowIn=None, arrowsOut=['TOP', 'RIGHT', 'BOTTOM', 'LEFT'])
    elif t == 'Group':
        p, _, g = pg.partition('/')
        al = lst(r['Alignments'])
        c.update(power=num(p), globalPower=num(g) if g else 0, resistance=num(r['Resistance']),
                 variableStats='*' in pg or '*' in str(r['Resistance']),
                 alignments=[a for a in al if '(' not in a],
                 conditionalAlignments=[a.split(' (')[0] for a in al if '(' in a],
                 attributes=lst(r['Attributes']),
                 arrowIn=r['Incoming Arrow Direction'], arrowsOut=lst(r['Outgoing Arrow Directions']))
    else:
        c['attackPower'] = pg or None
    cards.append(c)

ids = [c['id'] for c in cards]
assert len(ids) == len(set(ids)) == 412, 'duplicate or missing ids'
json.dump(cards, open(os.path.join(ROOT, 'src/data/cards.json'), 'w'), indent=1)
print(len(cards), 'cards exported')
