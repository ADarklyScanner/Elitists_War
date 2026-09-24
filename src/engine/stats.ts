// Effective card values after modifiers, NWOs and abilities.
// Calculation order (rules R047): set-to-value, then the single largest
// multiplier, then additions/subtractions. Power never drops below 0.
import type { Alignment, GameState, Modifier } from './types';
import { def, OPPOSITE } from './cards';
import { abilitiesOf, matches, setAlignmentResolver } from './abilities';
import { NWO_EFFECTS } from './nwo';

function activeMods(s: GameState, iid: string, opts: { defense?: boolean; goals?: boolean }): Modifier[] {
  return s.cards[iid].mods.filter((m) => (!m.defenseOnly || opts.defense) && (!opts.goals || m.countsForGoals !== false));
}

export function alignments(s: GameState, iid: string): Alignment[] {
  const d = def(s, iid);
  let al = [...(d.alignments ?? [])] as Alignment[];
  for (const m of s.cards[iid].mods) {
    if (m.kind === 'addAlign' && m.align) {
      const opp = OPPOSITE[m.align];
      al = al.filter((a) => a !== opp);
      if (!al.includes(m.align)) al.push(m.align);
    }
    if (m.kind === 'removeAlign' && m.align) al = al.filter((a) => a !== m.align);
  }
  return al;
}
setAlignmentResolver(alignments);

export function attributes(s: GameState, iid: string): string[] {
  const d = def(s, iid);
  const attrs = [...(d.attributes ?? [])];
  for (const nwo of activeNwos(s)) NWO_EFFECTS[s.cards[nwo].cardId]?.attributes?.(s, iid, attrs);
  return attrs;
}

export function activeNwos(s: GameState): string[] {
  return Object.values(s.nwo).filter((x): x is string => !!x);
}

function combine(base: number, mods: Modifier[], setKind: Modifier['kind'], mulKind: Modifier['kind'], addKind: Modifier['kind']): number {
  let v = base;
  for (const m of mods) if (m.kind === setKind && m.value !== undefined) v = Math.max(v, m.value); // "raised to" cards
  const mul = Math.max(1, ...mods.filter((m) => m.kind === mulKind).map((m) => m.value ?? 1));
  v *= mul;
  for (const m of mods) if (m.kind === addKind) v += m.value ?? 0;
  return v;
}

export function power(s: GameState, iid: string, opts: { defense?: boolean; goals?: boolean } = {}): number {
  const d = def(s, iid);
  const c = s.cards[iid];
  let base = d.power ?? 0;
  const mods = activeMods(s, iid, opts);
  let v = combine(base, mods, 'setPower', 'mulPower', 'power');
  for (const a of abilitiesOf(s, iid)) {
    if (a.kind === 'powerPer' && c.controller) {
      v += a.value * countControlled(s, c.controller, (g) => g !== iid && matches(s, g, a.per));
    }
  }
  if (d.type === 'Group') for (const nwo of activeNwos(s)) v += NWO_EFFECTS[s.cards[nwo].cardId]?.power?.(s, iid) ?? 0;
  return Math.max(0, v);
}

export function globalPower(s: GameState, iid: string): number {
  const d = def(s, iid);
  let v = d.globalPower ?? 0;
  for (const m of s.cards[iid].mods) if (m.kind === 'global') v += m.value ?? 0;
  const c = s.cards[iid];
  for (const a of abilitiesOf(s, iid)) {
    if (a.kind === 'powerPer' && a.global && c.controller) v += a.value * countControlled(s, c.controller, (g) => g !== iid && matches(s, g, a.per));
  }
  // Global Power is capped at current Power (R029).
  return Math.max(0, Math.min(v, power(s, iid)));
}

export function resistance(s: GameState, iid: string, opts: { defense?: boolean } = { defense: true }): number {
  const d = def(s, iid);
  const mods = activeMods(s, iid, opts);
  let v = combine(d.resistance ?? 0, mods, 'setResistance', 'mulResistance', 'resistance');
  if (d.type === 'Group') {
    for (const nwo of activeNwos(s)) {
      const e = NWO_EFFECTS[s.cards[nwo].cardId];
      if (e?.resistanceMul) v *= e.resistanceMul(s, iid);
      v += e?.resistance?.(s, iid) ?? 0;
    }
  }
  return Math.max(0, v);
}

export function countControlled(s: GameState, player: string, pred: (iid: string) => boolean): number {
  return Object.values(s.cards).filter((c) => c.zone === 'structure' && c.controller === player && def(s, c.iid).type === 'Group' && pred(c.iid)).length;
}

export function isOpposite(a: Alignment, b: Alignment): boolean {
  if (a === 'Fanatic' && b === 'Fanatic') return true;
  return OPPOSITE[a] === b;
}

/** Number of identical and opposite alignment pairs between two groups. */
export function alignmentPairs(s: GameState, a: string, b: string): { same: number; opposite: number } {
  const x = alignments(s, a);
  const y = alignments(s, b);
  let same = 0, opposite = 0;
  for (const p of x) {
    if (y.includes(p) && p !== 'Fanatic') same++;
    for (const q of y) if (isOpposite(p, q)) opposite++;
  }
  // Two Fanatic groups: Fanatic counts as an opposite pair, not a shared alignment (R006/R046).
  return { same, opposite };
}
