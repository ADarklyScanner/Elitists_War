// Card scripting: behaviour that is too specific for the declarative Ability list.
// A card's hooks are active while the card is in play: a Group in a Power Structure, a Resource
// beside it, or a Plot that stays on the table linked to something.
import type { AttackCtx, GameState, PlotEffect } from './types';

export type Side2 = 'attack' | 'defense';

export interface AbilityParams {
  target?: string;          // a card instance (Group, Resource or Plot)
  mode?: string;            // a named option, e.g. 'cancel' | 'bonus'
  payWith?: string[];       // extra Groups spending tokens
  alignment?: string;
}

/** "Spend this card's action to …" and other things a player chooses to do with a card. */
export interface ActivatedAbility {
  id: string;
  label: string;
  /** When it can be used: in your own main phase, during an attack window, right after a roll, or any time you have priority. */
  timing: ('main' | 'attack' | 'roll' | 'anytime')[];
  /** Does using it spend the card's own Action token? */
  usesToken: boolean;
  /** At most once per turn. */
  oncePerTurn?: boolean;
  /** What the UI needs to ask for. */
  needs?: { target?: 'group' | 'ownGroup' | 'rivalGroup' | 'place' | 'personality' | 'resource' | 'plot' | 'actingGroup'; modes?: string[]; alignment?: boolean };
  check: (s: GameState, pl: string, self: string, p: AbilityParams, ctx?: AttackCtx) => string | null;
  /** Do it. During an attack, return a live effect or push onto ctx.attackBonus / ctx.defenseBonus. */
  apply: (s: GameState, pl: string, self: string, p: AbilityParams, ctx?: AttackCtx) => PlotEffect | void;
  /** Hint for the computer player. */
  ai?: 'boostAttack' | 'boostDefense' | 'cancelAttacker' | 'draw' | 'never';
}

export interface CardHooks {
  /** Resource with its own Action token (refreshed each turn like a Group's). */
  hasAction?: boolean;
  /** Resource: which Groups it may be linked to (Illuminati always allowed). */
  linkTo?: (s: GameState, self: string, group: string) => boolean;
  /** Duplicates (agents) of the controller's Groups give no bonus (Xanadu). */
  cancelAgents?: (s: GameState, self: string) => boolean;
  // ---- constant effects (self = the card providing the effect, iid = the card being measured)
  powerMod?: (s: GameState, self: string, iid: string) => number;
  resistanceMod?: (s: GameState, self: string, iid: string) => number;
  globalMod?: (s: GameState, self: string, iid: string) => number;
  /** Extra Action tokens `iid` receives when tokens are refreshed. */
  extraTokens?: (s: GameState, self: string, iid: string) => number;
  /** Added to the attack or defense total of an attack in progress. */
  attackMod?: (s: GameState, self: string, ctx: AttackCtx, side: Side2) => number;
  /** Lets `group` aid or oppose this attack with its full Power regardless of alignment. */
  mayJoin?: (s: GameState, self: string, ctx: AttackCtx, group: string, as: 'aid' | 'oppose') => boolean;
  /** `target` cannot be attacked or affected by `source` (a Group, or a Plot card being played). */
  immune?: (s: GameState, self: string, target: string, source: string, ctx?: AttackCtx) => boolean;
  /** `target` cannot be destroyed (by any means, or only by some attacks). */
  preventDestroy?: (s: GameState, self: string, target: string, ctx?: AttackCtx) => boolean;
  /** Player may take part in Privileged attacks. */
  mayInterfere?: (s: GameState, self: string, player: string) => boolean;
  /** Plot hand limit change for the controller. */
  handLimit?: (s: GameState, self: string) => number;
  /** Extra Plot draws for the controller at the start of his turn. */
  extraPlotDraws?: (s: GameState, self: string) => number;
  /** Counts this many extra Groups toward the controller's Basic Goal. */
  goalBonus?: (s: GameState, self: string) => number;

  // ---- triggers
  onTurnStart?: (s: GameState, self: string) => void;
  onDestroy?: (s: GameState, self: string, victim: string, by: string) => void;
  onCapture?: (s: GameState, self: string, victim: string, by: string, from: string | undefined) => void;
  onAttackEnd?: (s: GameState, self: string, ctx: AttackCtx) => void;
  onEnterPlay?: (s: GameState, self: string) => void;

  // ---- choices
  actions?: ActivatedAbility[];
}

export const HOOKS: Record<string, CardHooks> = {};

export function registerHooks(table: Record<string, CardHooks>) {
  for (const [id, h] of Object.entries(table)) HOOKS[id] = { ...HOOKS[id], ...h };
}

/** Cards whose hooks are active: Groups in structures, Resources in play, linked Plots on the table. */
export function activeHookCards(s: GameState): string[] {
  const out: string[] = [];
  for (const c of Object.values(s.cards)) {
    if (!HOOKS[c.cardId]) continue;
    if (c.zone === 'structure' || c.zone === 'resources' || (c.zone === 'table' && c.linkedTo)) out.push(c.iid);
  }
  return out;
}

export function hooksOf(s: GameState, iid: string): CardHooks | undefined {
  return HOOKS[s.cards[iid].cardId];
}

export function sumHooks(s: GameState, fn: (h: CardHooks, self: string) => number | undefined): number {
  let n = 0;
  for (const self of activeHookCards(s)) n += fn(HOOKS[s.cards[self].cardId], self) ?? 0;
  return n;
}

export function anyHook(s: GameState, fn: (h: CardHooks, self: string) => boolean | undefined): boolean {
  for (const self of activeHookCards(s)) if (fn(HOOKS[s.cards[self].cardId], self)) return true;
  return false;
}

export function fireHooks(s: GameState, fn: (h: CardHooks, self: string) => void) {
  for (const self of activeHookCards(s)) fn(HOOKS[s.cards[self].cardId], self);
}
