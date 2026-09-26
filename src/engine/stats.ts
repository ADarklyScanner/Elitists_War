// Effective card values after modifiers, NWOs and abilities.
// Calculation order (rules R047): set-to-value, then the single largest
// multiplier, then additions/subtractions. Power never drops below 0.
import type { Alignment, GameState, Modifier } from './types';
import { def, OPPOSITE } from './cards';
import { abilitiesOf, matches, setAlignmentResolver } from './abilities';
import { NWO_EFFECTS, fanaticUnited } from './nwo';
import { sumHooks, activeHookCards, HOOKS } from './hooks';

function activeMods(s: GameState, iid: string, opts: ValueOpts): Modifier[] {
  return s.cards[iid].mods.filter((m) => (!m.defenseOnly || opts.defense) && (!opts.goals || m.countsForGoals !== false) && (!opts.permanent || m.until === 'permanent'));
}

export function alignments(s: GameState, iid: string, opts: { goals?: boolean } = {}): Alignment[] {
  const d = def(s, iid);
  // A card may define its own starting alignments in place of the printed ones (Dittoheads).
  const base = HOOKS[d.id]?.baseAlignments;
  let al = [...(base ? base(s, iid) : d.alignments ?? [])] as Alignment[];
  for (const m of s.cards[iid].mods) {
    if (m.kind === 'addAlign' && m.align) {
      const opp = OPPOSITE[m.align];
      al = al.filter((a) => a !== opp);
      if (!al.includes(m.align)) al.push(m.align);
    }
    if (m.kind === 'removeAlign' && m.align) al = al.filter((a) => a !== m.align);
  }
  // Cards in play that change alignments (e.g. an NWO making Corporate count as Government). A card
  // whose change takes precedence over every other card's (`lastWord`) goes last.
  const active = activeHookCards(s);
  for (const last of [false, true]) {
    for (const self of active) {
      const h = HOOKS[s.cards[self].cardId];
      if (h.alignmentMod && !!h.lastWord === last) al = h.alignmentMod(s, self, iid, al, !!opts.goals);
    }
  }
  return al;
}
setAlignmentResolver(alignments, attributes);

export function attributes(s: GameState, iid: string): string[] {
  const d = def(s, iid);
  let attrs = [...(d.attributes ?? [])];
  for (const m of s.cards[iid]?.mods ?? []) {
    if (m.kind === 'addAttr' && m.attr && !attrs.includes(m.attr)) attrs.push(m.attr);
    if (m.kind === 'removeAttr' && m.attr) attrs = attrs.filter((a) => a !== m.attr);
  }
  for (const nwo of activeNwos(s)) NWO_EFFECTS[s.cards[nwo].cardId]?.attributes?.(s, iid, attrs);
  const active = activeHookCards(s);
  for (const last of [false, true]) {
    for (const self of active) {
      const h = HOOKS[s.cards[self].cardId];
      if (h.attributeMod && !!h.lastWord === last) attrs = h.attributeMod(s, self, iid, attrs);
    }
  }
  return attrs;
}

export function activeNwos(s: GameState): string[] {
  return Object.values(s.nwo).filter((x): x is string => !!x);
}

export interface ValueOpts {
  defense?: boolean;        // include defense-only modifiers (Good Polls, defensive +10)
  goals?: boolean;          // only changes that count toward Goals
  selfDefense?: boolean;    // a Group spending its own token to defend itself (R006c)
  noDefenseAdds?: boolean;  // leave out defense-only additions already counted elsewhere (R028: a +10 counts once)
  halve?: boolean;          // Devastated Place defending against an Attack to Destroy (R037)
  permanent?: boolean;      // Permanent Power: leave out changes that last only for a turn or an attack
}

/**
 * R047: set-to-value effects first, then the single largest multiplier (self-defense raises it one
 * step: none -> x2, x2 -> x3 ...), then additions and subtractions.
 */
function combine(base: number, mods: Modifier[], kinds: { set: Modifier['kind']; mul: Modifier['kind']; add: Modifier['kind'] },
  extra: { muls?: number[]; adds?: number[] }, opts: ValueOpts): number {
  let v = base;
  // "Raised to" cards, and "reduced to" cards (`lower`), in the order they were played.
  for (const m of mods) if (m.kind === kinds.set && m.value !== undefined) v = m.lower ? Math.min(v, m.value) : Math.max(v, m.value);
  let mul = Math.max(1, ...mods.filter((m) => m.kind === kinds.mul).map((m) => m.value ?? 1), ...(extra.muls ?? []));
  if (opts.selfDefense) mul = mul > 1 ? mul + 1 : 2;
  v *= mul;
  if (opts.halve) v = Math.floor(v / 2);
  for (const m of mods) if (m.kind === kinds.add && !(opts.noDefenseAdds && m.defenseOnly)) v += m.value ?? 0;
  for (const a of extra.adds ?? []) v += a;
  return v;
}

export function power(s: GameState, iid: string, opts: ValueOpts = {}): number {
  const d = def(s, iid);
  const c = s.cards[iid];
  const adds: number[] = [];
  for (const a of abilitiesOf(s, iid)) {
    if (a.kind === 'powerPer' && c.controller) adds.push(a.value * countControlled(s, c.controller, (g) => g !== iid && matches(s, g, a.per)));
  }
  if (d.type === 'Group') for (const nwo of activeNwos(s)) adds.push(NWO_EFFECTS[s.cards[nwo].cardId]?.power?.(s, iid) ?? 0);
  adds.push(sumHooks(s, (h, self) => h.powerMod?.(s, self, iid)));
  // A Resource that defends as a Place (Hidden City) uses that Power.
  const v = combine(d.power ?? HOOKS[d.id]?.disasterTargetPower ?? 0, activeMods(s, iid, opts), { set: 'setPower', mul: 'mulPower', add: 'power' }, { adds }, opts);
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
  v += sumHooks(s, (h, self) => h.globalMod?.(s, self, iid));
  // Cards that make Global Power equal to the Group's Power (Nental Ife, Head Launching: its Permanent Power).
  for (const self of activeHookCards(s)) {
    const eq = HOOKS[s.cards[self].cardId].globalEqualsPower?.(s, self, iid);
    if (eq) v = Math.max(v, power(s, iid, { permanent: eq === 'permanent' }));
  }
  // Global Power is capped at current Power (R029).
  return Math.max(0, Math.min(v, power(s, iid)));
}

export function resistance(s: GameState, iid: string, opts: ValueOpts = { defense: true }): number {
  const d = def(s, iid);
  const muls: number[] = [], adds: number[] = [];
  if (d.type === 'Group') {
    for (const nwo of activeNwos(s)) {
      const e = NWO_EFFECTS[s.cards[nwo].cardId];
      if (e?.resistanceMul) muls.push(e.resistanceMul(s, iid));
      adds.push(e?.resistance?.(s, iid) ?? 0);
    }
  }
  adds.push(sumHooks(s, (h, self) => h.resistanceMod?.(s, self, iid)));
  for (const self of activeHookCards(s)) {
    const m = HOOKS[s.cards[self].cardId].resistanceMul?.(s, self, iid);
    if (m && m > 1) muls.push(m);
  }
  const v = combine(d.resistance ?? 0, activeMods(s, iid, opts), { set: 'setResistance', mul: 'mulResistance', add: 'resistance' }, { muls, adds }, opts);
  return Math.max(0, v);
}

export function countControlled(s: GameState, player: string, pred: (iid: string) => boolean): number {
  return Object.values(s.cards).filter((c) => c.zone === 'structure' && c.controller === player && def(s, c.iid).type === 'Group' && pred(c.iid)).length;
}

/**
 * Two Fanatic groups are normally opposite each other (R006/R046), not sharing an alignment. Visualize
 * Whirled Peas (Assassins) unites all Fanatics into one shared alignment instead: pass the game state
 * along so this can be checked; omit it where no such NWO exists (e.g. hypothetical comparisons).
 */
export function isOpposite(a: Alignment, b: Alignment, s?: GameState): boolean {
  if (a === 'Fanatic' && b === 'Fanatic') return !(s && fanaticUnited(s));
  return OPPOSITE[a] === b;
}

/** Number of identical and opposite alignment pairs between two groups. */
export function alignmentPairs(s: GameState, a: string, b: string): { same: number; opposite: number } {
  const x = alignments(s, a);
  const y = alignments(s, b);
  const united = fanaticUnited(s);
  let same = 0, opposite = 0;
  for (const p of x) {
    if (y.includes(p) && (p !== 'Fanatic' || united)) same++;
    for (const q of y) if (isOpposite(p, q, s)) opposite++;
  }
  return { same, opposite };
}
