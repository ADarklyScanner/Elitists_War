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
  /** Non-attack Plots: take effect once nobody counters them. */
  resolve?: (s: GameState, player: string, play: PlotPlay) => void;
  /** Undo anything `apply` did when the Plot is cancelled (costs normally stay paid). */
  refund?: (s: GameState, player: string, play: PlotPlay) => void;
  /** For timing 'event': which event types this Plot can respond to. */
  events?: import('./types').GameEvent['type'][];
  /** Card stays on the table linked to a Group after resolving. */
  linked?: boolean;
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
