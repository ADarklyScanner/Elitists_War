// Card scripting: behaviour that is too specific for the declarative Ability list.
// A card's hooks are active while the card is in play: a Group in a Power Structure, a Resource
// beside it, or a Plot that stays on the table linked to something.
import type { Alignment, AttackCtx, GameState, GameEvent, PlotEffect } from './types';

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
  /**
   * When it can be used: in your own main phase, during an attack window, right after a roll, any time
   * you have priority, in the response window of an event (`events`, default the 'action' event that
   * announces an action outside an attack), or against a non-attack Plot waiting to resolve ('counter').
   */
  timing: ('main' | 'attack' | 'roll' | 'anytime' | 'event' | 'counter')[];
  /** Timing 'event': the event types it answers (default ['action']). */
  events?: GameEvent['type'][];
  /**
   * Timing 'event': could this card answer the event `e` right now? The engine opens a response window
   * only when some card listens, so keep it cheap and side-effect free. Without it, any event of a
   * listed type opens the window.
   */
  listens?: (s: GameState, pl: string, self: string, e: GameEvent) => boolean;
  /** Does using it spend the card's own Action token? */
  usesToken: boolean;
  /** At most once per turn. */
  oncePerTurn?: boolean;
  /** What the UI needs to ask for. */
  needs?: { target?: 'group' | 'ownGroup' | 'rivalGroup' | 'place' | 'personality' | 'resource' | 'plot' | 'actingGroup' | 'handCard' | 'handGroup' | 'handPlot' | 'destroyed' | 'discardPile' | 'rival' | 'rivalHand' | 'nwo'; modes?: string[]; alignment?: boolean };
  check: (s: GameState, pl: string, self: string, p: AbilityParams, ctx?: AttackCtx) => string | null;
  /** Do it. During an attack, return a live effect or push onto ctx.attackBonus / ctx.defenseBonus. */
  apply: (s: GameState, pl: string, self: string, p: AbilityParams, ctx?: AttackCtx) => PlotEffect | void;
  /**
   * The choice is secret (the Holy Grail naming a Place): the log line naming the target goes only to
   * the player using it; everyone else only sees that the ability was used.
   */
  secret?: boolean;
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

  // ---- rule changers
  /** Change a Group's alignments while this card is in play (`goals`: evaluating a Goal). */
  alignmentMod?: (s: GameState, self: string, iid: string, current: Alignment[], goals: boolean) => Alignment[];
  /** Change a Group's attributes while this card is in play. */
  attributeMod?: (s: GameState, self: string, iid: string, current: string[]) => string[];
  /** Forbid an attack (return a reason). Also consulted for automatic takeovers (type 'takeover'). */
  forbidAttack?: (s: GameState, self: string, attacker: string | undefined, target: string, type: 'control' | 'destroy' | 'takeover', attackerPlayer: string) => string | null;
  /** Forbid a Group from aiding or opposing this attack. */
  forbidJoin?: (s: GameState, self: string, ctx: AttackCtx, group: string, as: 'aid' | 'oppose') => boolean;
  /** Let `attacker` ignore `target`'s immunities (e.g. Deprogrammers vs Discordian protection). */
  ignoreImmunity?: (s: GameState, self: string, attacker: string, target: string) => boolean;
  /** Let `group` attack, aid or oppose despite the Secret-Group rule (R014). */
  secretOverride?: (s: GameState, self: string, group: string, secret: string) => boolean;
  /** `iid` cannot receive Action tokens. */
  noTokens?: (s: GameState, self: string, iid: string) => boolean;
  /** Plots and NWOs on the table only: switch off `iid`'s special abilities. */
  disablesAbilities?: (s: GameState, self: string, iid: string) => boolean;
  /** Called before a player draws from a deck: 'skip' cancels the draw, 'bottom' takes the bottom card. */
  beforeDraw?: (s: GameState, self: string, player: string, deck: 'plot' | 'group') => 'skip' | 'bottom' | undefined;
  /** Called after a card is drawn. */
  onDraw?: (s: GameState, self: string, player: string, deck: 'plot' | 'group', card: string) => void;
  /** Called for every game event (after it happens, before its response window). */
  onEvent?: (s: GameState, self: string, e: GameEvent) => void;
  /** Resources linked to `self` may not be moved to another card (Evil Geniuses for a Better Tomorrow). */
  lockLinks?: (s: GameState, self: string, resource: string) => boolean;
  /** This card's `attackMod` still applies in attacks by or against Secret Groups (its ability is about them). */
  worksInSecretAttacks?: boolean;
  /**
   * How many Groups of `alignment` this card counts as for Goal cards (default 1). Read for the card
   * itself wherever it is (in play or destroyed), not through the active cards.
   */
  goalAlignWeight?: (s: GameState, iid: string, alignment: Alignment) => number;
  /** Forbid `player` from playing the Plot `card`, or using an ability of `card`, aimed at `target` (return a reason). */
  forbidUse?: (s: GameState, self: string, player: string, card: string, target: string | undefined, ctx?: AttackCtx) => string | null;
  /** The Resource in play `resource` cannot be discarded, or targeted by a rival's card (Count Dracula). */
  protectResource?: (s: GameState, self: string, resource: string) => boolean;
  /** The Plot `card` in a hand cannot be exposed (Plots hidden beneath Texas or Fidel Castro). */
  preventExpose?: (s: GameState, self: string, card: string) => boolean;
  /** Static: added to any attack on this card, even while it is attacked from its owner's hand. */
  asTarget?: (s: GameState, self: string, ctx: AttackCtx, side: Side2) => number;
  /** Static: any number of copies of this Group may be in play or destroyed (Media Sensation). */
  multipleCopies?: boolean;
  /** Static: destroying this Group gives no destruction credit for Goals (Media Sensation). */
  noDestroyCredit?: boolean;
  /**
   * Called when everyone has passed after an attack's roll, before the result is applied. May push a
   * live effect onto ctx.plays (a re-roll, an automatic failure). Return true to open the roll window
   * again so players can respond to the change; a card must not do so twice in one attack.
   */
  beforeAttackResult?: (s: GameState, self: string, ctx: AttackCtx) => boolean | void;
  /** A Unique Resource that another copy may replace once this one is destroyed (Hidden City). */
  replaceableWhenDestroyed?: boolean;
  /**
   * Static: Disasters may strike this Resource while it is in play. It defends as a Place with this
   * Power and is never Devastated (Hidden City).
   */
  disasterTargetPower?: number;
  /** This card makes the attack in progress Magic, so defenses against Magic apply (Spear of Longinus). */
  magicAttack?: (s: GameState, self: string, ctx: AttackCtx) => boolean;

  // ---- triggers
  onTurnStart?: (s: GameState, self: string) => void;
  onDestroy?: (s: GameState, self: string, victim: string, by: string) => void;
  onCapture?: (s: GameState, self: string, victim: string, by: string, from: string | undefined) => void;
  onAttackEnd?: (s: GameState, self: string, ctx: AttackCtx) => void;
  /** An attack (of any kind) has just begun: `s.attack` is already set to `ctx`. */
  onAttackStart?: (s: GameState, self: string, ctx: AttackCtx) => void;
  onEnterPlay?: (s: GameState, self: string) => void;

  // ---- choices
  actions?: ActivatedAbility[];
}

export const HOOKS: Record<string, CardHooks> = {};

/** Set while the engine checks whether a player meets a Goal (for effects that do not count for Goals). */
export const goalCheck = { active: false };

/** Resolvers for player choices asked with askChoice (key -> what to do with the picked ids). */
export const CHOICES: Record<string, {
  resolve: (s: GameState, player: string, picked: string[], data: Record<string, unknown>) => void;
  /** How the computer picks (defaults to the first `min` options). */
  ai?: (s: GameState, player: string, options: { id: string; label: string }[], data: Record<string, unknown>) => string[];
}> = {};
export function registerChoice(key: string, c: (typeof CHOICES)[string]) { CHOICES[key] = c; }

/** Cards with an activated ability that answers events (kept up to date so the engine can skip the search). */
export const EVENT_ABILITY_CARDS = new Set<string>();

export function registerHooks(table: Record<string, CardHooks>) {
  for (const [id, h] of Object.entries(table)) {
    HOOKS[id] = { ...HOOKS[id], ...h };
    if (HOOKS[id].actions?.some((a) => a.timing.includes('event'))) EVENT_ABILITY_CARDS.add(id);
    else EVENT_ABILITY_CARDS.delete(id);
  }
}

/** Cards whose hooks are active: Groups in structures, Resources in play, linked Plots on the table. */
export function activeHookCards(s: GameState): string[] {
  const out: string[] = [];
  const table: string[] = [];
  for (const c of Object.values(s.cards)) {
    if (!HOOKS[c.cardId] || c.hiddenUnder) continue; // face down under Warehouse 23: inactive
    if (c.zone === 'table' && c.linkedTo) table.push(c.iid);
    else if (c.zone === 'structure' || c.zone === 'resources') out.push(c.iid);
  }
  // Table cards (Plots, NWOs) may switch off Groups' abilities (World Hunger); they are never switched off themselves.
  const off = table.filter((t) => HOOKS[s.cards[t].cardId].disablesAbilities);
  const live = off.length ? out.filter((g) => !off.some((t) => HOOKS[s.cards[t].cardId].disablesAbilities!(s, t, g))) : out;
  return [...live, ...table];
}

/** Is `iid`'s special ability switched off by a card on the table? */
export function abilitiesDisabled(s: GameState, iid: string): boolean {
  for (const c of Object.values(s.cards)) {
    if (c.zone !== 'table' || !c.linkedTo) continue;
    const h = HOOKS[c.cardId];
    if (h?.disablesAbilities?.(s, c.iid, iid)) return true;
  }
  return false;
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

/** Does a card in play make this attack Magic (as well as any Magic Group taking part)? */
export function magicByCard(s: GameState, ctx: AttackCtx | undefined): boolean {
  return !!ctx && anyHook(s, (h, self) => !!h.magicAttack?.(s, self, ctx));
}

export function fireHooks(s: GameState, fn: (h: CardHooks, self: string) => void) {
  for (const self of activeHookCards(s)) fn(HOOKS[s.cards[self].cardId], self);
}
