// "Requires ... Action" (Assassins, SubGenius): a declarative cost a Plot handler can carry in
// `requires`. The engine checks it when the Plot is played and pays it (spends the tokens, discards
// the cards) before the handler's `apply` runs, so a card script never pays by hand. The player says
// how he pays in `play.payWith` (Groups spending an action) and `play.discards` (Plots from hand).
//
// A cost is a list of alternatives: any one of them pays. Examples:
//   requires: anyOf(illuminatiAction(), groupActions({ alignments: ['Violent'] }, { power: targetResistance }))
//   requires: anyOf(groupActions({ attributes: ['SubGenius'] }))           // "Requires SubGenius Action"
//   requires: anyOf(illuminatiAction(), groupActions({ attributes: ['Church'] }, { count: 2 }))
//   requires: anyOf(targetAction())                                        // "counts as the action of the Group it affects"
//   requires: anyOf(illuminatiAction(), plotDiscards(3))                   // "Illuminati action or three discards"
import type { GameState, PlotPlay } from './types';
import { type Match, matches } from './abilities';
import { power, resistance } from './stats';
import { def } from './cards';

export type CostOption =
  /** One action of the player's Illuminati. */
  | { kind: 'illuminati' }
  /** The action of the Group the Plot is played on (`play.target`). */
  | { kind: 'target' }
  /**
   * Actions of the player's own Groups matching `match` (any Group without one): exactly `count` of
   * them, or (with `power`) as many as needed for their current Power to reach that total.
   */
  | { kind: 'groups'; match?: Match; count?: number; power?: number | ((s: GameState, pl: string, play: PlotPlay) => number); what?: string }
  /** Discard `count` other Plot cards from hand. */
  | { kind: 'discards'; count: number };

export interface ActionCost { anyOf: CostOption[] }

export const anyOf = (...options: CostOption[]): ActionCost => ({ anyOf: options });
export const illuminatiAction = (): CostOption => ({ kind: 'illuminati' });
export const targetAction = (): CostOption => ({ kind: 'target' });
export const plotDiscards = (count: number): CostOption => ({ kind: 'discards', count });
export const groupActions = (match: Match = {}, opts: { count?: number; power?: number | ((s: GameState, pl: string, play: PlotPlay) => number); what?: string } = {}): CostOption =>
  ({ kind: 'groups', match, count: opts.power === undefined ? opts.count ?? 1 : opts.count, power: opts.power, what: opts.what });
/** A `power` for groupActions: the current Resistance of the Plot's target (Paralysis cards). */
export const targetResistance = (s: GameState, _pl: string, play: PlotPlay) => (play.target && s.cards[play.target] ? resistance(s, play.target) : 0);

const describeMatch = (m?: Match) => [...(m?.alignments ?? []), ...(m?.attributes ?? []), ...(m?.subtypes ?? [])].join(' or ');

export function describeOption(o: CostOption, s?: GameState, pl?: string, play?: PlotPlay): string {
  switch (o.kind) {
    case 'illuminati': return 'an action of your Illuminati';
    case 'target': return 'the action of the Group it is played on';
    case 'discards': return `${o.count} other Plot card${o.count === 1 ? '' : 's'} discarded from your hand`;
    case 'groups': {
      const what = o.what ?? (describeMatch(o.match) ? `${describeMatch(o.match)} ` : '');
      if (o.power !== undefined) {
        const need = typeof o.power === 'number' ? o.power : s && pl && play ? o.power(s, pl, play) : undefined;
        return `actions of your ${what}Groups with ${need ?? 'enough'} Power in total`;
      }
      return (o.count ?? 1) === 1 ? `the action of one of your ${what}Groups` : `the actions of ${o.count} of your ${what}Groups`;
    }
  }
}

export function describeCost(cost: ActionCost, s?: GameState, pl?: string, play?: PlotPlay): string {
  return cost.anyOf.map((o) => describeOption(o, s, pl, play)).join(', or ');
}

const ownReady = (s: GameState, pl: string, g: string) => {
  const c = s.cards[g];
  return !!c && c.zone === 'structure' && c.controller === pl && c.tokens > 0;
};

/** Does this play pay the option exactly (the Groups and discards it names, nothing missing)? */
function pays(s: GameState, pl: string, play: PlotPlay, o: CostOption): boolean {
  const pay = play.payWith ?? [];
  const disc = play.discards ?? [];
  const me = s.players.find((p) => p.id === pl);
  if (!me || new Set(pay).size !== pay.length || new Set(disc).size !== disc.length) return false;
  switch (o.kind) {
    case 'illuminati': return !disc.length && pay.length === 1 && pay[0] === me.illuminati && ownReady(s, pl, me.illuminati);
    case 'target': return !disc.length && pay.length === 1 && pay[0] === play.target && ownReady(s, pl, pay[0]);
    case 'discards': return !pay.length && disc.length === o.count && disc.every((c) => c !== play.card && me.hand.includes(c) && def(s, c).type === 'Plot');
    case 'groups': {
      if (disc.length || !pay.length || !pay.every((g) => ownReady(s, pl, g) && matches(s, g, o.match))) return false;
      if (o.power !== undefined) {
        const need = typeof o.power === 'number' ? o.power : o.power(s, pl, play);
        return pay.reduce((n, g) => n + power(s, g), 0) >= need && (o.count === undefined || pay.length <= o.count);
      }
      return pay.length === (o.count ?? 1);
    }
  }
}

/** Why this play does not pay its cost (null when it does). */
export function costProblem(s: GameState, pl: string, play: PlotPlay, cost: ActionCost): string | null {
  if (cost.anyOf.some((o) => pays(s, pl, play, o))) return null;
  return `${def(s, play.card).name} needs ${describeCost(cost, s, pl, play)}.`;
}

/** Pay the cost: spend one token of each paying card and discard the listed Plots. */
export function payCost(s: GameState, play: PlotPlay, discard: (s: GameState, iid: string) => void) {
  for (const g of play.payWith ?? []) s.cards[g].tokens--;
  for (const c of play.discards ?? []) discard(s, c);
}

/**
 * Ways to pay this play, one per alternative the player can afford (payWith / discards filled in):
 * the computer players and the interface offer these.
 */
export function costPlays(s: GameState, pl: string, play: PlotPlay, cost: ActionCost): PlotPlay[] {
  const me = s.players.find((p) => p.id === pl);
  if (!me) return [];
  const out: PlotPlay[] = [];
  const mine = Object.values(s.cards).filter((c) => c.zone === 'structure' && c.controller === pl && c.tokens > 0).map((c) => c.iid);
  for (const o of cost.anyOf) {
    let p: PlotPlay | undefined;
    if (o.kind === 'illuminati') p = { ...play, payWith: [me.illuminati], discards: undefined };
    else if (o.kind === 'target') p = play.target ? { ...play, payWith: [play.target], discards: undefined } : undefined;
    else if (o.kind === 'discards') {
      // Exposed Plots first (they are known anyway), then the rest in hand order.
      const plots = me.hand.filter((c) => c !== play.card && def(s, c).type === 'Plot' && def(s, c).subtype !== 'Goal')
        .sort((a, b) => Number(!!s.cards[b].exposed) - Number(!!s.cards[a].exposed));
      if (plots.length >= o.count) p = { ...play, payWith: undefined, discards: plots.slice(0, o.count) };
    } else {
      const pool = mine.filter((g) => g !== me.illuminati && matches(s, g, o.match)).sort((a, b) => power(s, a) - power(s, b));
      if (o.power !== undefined) {
        const need = typeof o.power === 'number' ? o.power : o.power(s, pl, { ...play, payWith: [] });
        // The weakest single Group that suffices, else the strongest ones until the total is reached.
        const one = pool.find((g) => power(s, g) >= need);
        const pick: string[] = one ? [one] : [];
        if (!one) { let n = 0; for (const g of [...pool].reverse()) { if (n >= need) break; pick.push(g); n += power(s, g); } }
        if (pick.length) p = { ...play, payWith: pick, discards: undefined };
      } else if (pool.length >= (o.count ?? 1)) p = { ...play, payWith: pool.slice(0, o.count ?? 1), discards: undefined };
    }
    if (p && pays(s, pl, p, o) && !out.some((x) => JSON.stringify(x) === JSON.stringify(p))) out.push(p);
  }
  return out;
}
