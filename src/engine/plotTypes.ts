import type { AttackCtx, GameState, PlotEffect, PlotPlay } from './types';

/** When a Plot may be played. */
export type PlotTiming =
  | 'anytime'        // whenever the player has priority and no Instant/Privileged restriction applies
  | 'declare'        // only together with declaring one of your own attacks
  | 'attack'         // during an attack's response window (e.g. defensive +10, cancel an action)
  | 'roll'           // right after the attack dice are rolled
  | 'counter'        // immediately after another Plot is played
  | 'instant'        // launches an Instant Attack (Disaster / Assassination)
  | 'nwo'            // New World Order
  | 'event';         // in the response window right after an event (see `events`)

export interface PlotHandler {
  timing: PlotTiming[];
  /** Return an error message if this play is not legal right now, or null if it is. */
  check: (s: GameState, player: string, play: PlotPlay, ctx?: AttackCtx) => string | null;
  /**
   * Called as soon as the Plot is played: pay costs, and for attack Plots record the bonus or
   * return a live effect. Non-attack Plots do their work in `resolve`, after the counter window.
   */
  apply: (s: GameState, player: string, play: PlotPlay, ctx?: AttackCtx) => PlotEffect | void;
  /**
   * Attack Plots: is the play still legal now, after later plays changed the Groups involved? (Checked
   * after every play in the attack and before it resolves; a Plot made illegal returns to its owner's
   * hand, exposed.) Only the lasting requirements belong here, not the costs or the moment of playing.
   */
  stillLegal?: (s: GameState, player: string, play: PlotPlay, ctx: AttackCtx) => string | null;
  /** Non-attack Plots: take effect once nobody counters them. */
  resolve?: (s: GameState, player: string, play: PlotPlay) => void;
  /** Undo anything `apply` did when the Plot is cancelled (costs normally stay paid). */
  refund?: (s: GameState, player: string, play: PlotPlay) => void;
  /** For timing 'event': which event types this Plot can respond to. */
  events?: import('./types').GameEvent['type'][];
  /** Card stays on the table linked to a Group after resolving. */
  linked?: boolean;
  /**
   * "Requires ... Action" (costs.ts): what playing it costs. The engine checks the play's `payWith` /
   * `discards` against it and pays before `apply`, so `apply` must not spend these again.
   */
  requires?: import('./costs').ActionCost;
  /**
   * A lasting condition this Plot puts on the card it is linked to (Assassins): 'zap' (linked to the
   * victim's Illuminati: a restriction on that player's whole Power Structure) or 'paralysis' (linked to
   * a Group, which can then do nothing). See conditions.ts.
   */
  condition?: 'zap' | 'paralysis';
  /**
   * Links as the SubGenius rules use them: is this Plot's link to `group` still legal? 'inactive': it
   * has no effect until it becomes legal again (and may not be moved meanwhile); 'discard': it became
   * illegal for good and is discarded. Checked after every action. Default 'ok'.
   */
  linkLegal?: (s: GameState, plot: string, group: string) => 'ok' | 'inactive' | 'discard';
  /**
   * Attacks launched by this card (Disasters, Assassinations): may `group` aid or oppose it? true lets
   * it join whatever its alignments (and even an Instant attack), false forbids it, undefined leaves the
   * normal rules. `joinMultiplier` multiplies the Power it adds (the Center for Disease Control: 3).
   */
  joinRule?: (s: GameState, ctx: AttackCtx, group: string, as: 'aid' | 'oppose') => boolean | undefined;
  joinMultiplier?: (s: GameState, ctx: AttackCtx, group: string) => number;
  /** Short hint for the UI about what the play needs (target, mode, payWith). */
  needs?: {
    /** What `play.target` is: a Group in play, a Resource, a card in your hand, a destroyed Group, a card
     *  in any discard pile, an NWO on the table, a rival (target = his Illuminati), or a card in a rival's hand. */
    target?: 'ownGroup' | 'anyGroup' | 'rivalGroup' | 'place' | 'personality' | 'plot' | 'resource' | 'handCard' | 'handGroup' | 'handPlot' | 'destroyed' | 'discardPile' | 'nwo' | 'rival' | 'rivalHand';
    /** Offer `play.targets` as a set of cards of this kind (reload cards: your Groups without a token). */
    targetsOf?: 'ownTokenless' | 'handPlot' | 'handGroup' | 'handCard';
    mode?: string[]; pay?: 'tokens' | 'illuminati'; alignment?: boolean; helper?: boolean; targets?: boolean;
  };
}

export const PLOTS: Record<string, PlotHandler> = {};

export function registerPlots(table: Record<string, PlotHandler>) {
  Object.assign(PLOTS, table);
}

/** Goal cards: return a short reason when the holder meets the Goal, else null. */
export const GOALS: Record<string, (s: GameState, player: string) => string | null> = {};
export function registerGoals(table: Record<string, (s: GameState, player: string) => string | null>) {
  Object.assign(GOALS, table);
}

/**
 * How far a player is toward a Goal card, from 0 to 1 (1 = met). Lets a computer player pursue a Goal
 * card it holds instead of only noticing when it is met. Goal cards without an entry count as 0.
 */
export const GOAL_PROGRESS: Record<string, (s: GameState, player: string) => number> = {};
export function registerGoalProgress(table: Record<string, (s: GameState, player: string) => number>) {
  Object.assign(GOAL_PROGRESS, table);
}
