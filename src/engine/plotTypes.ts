import type { AttackCtx, GameState, PlotEffect, PlotPlay } from './types';

/** When a Plot may be played. */
export type PlotTiming =
  | 'anytime'        // whenever the player has priority and no Instant/Privileged restriction applies
  | 'declare'        // only together with declaring one of your own attacks
  | 'attack'         // during an attack's response window (e.g. defensive +10, cancel an action)
  | 'roll'           // right after the attack dice are rolled
  | 'counter'        // immediately after another Plot is played
  | 'instant'        // launches an Instant Attack (Disaster / Assassination)
  | 'nwo';           // New World Order

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
  /** Card stays on the table linked to a Group after resolving. */
  linked?: boolean;
  /** Short hint for the UI about what the play needs (target, mode, payWith). */
  needs?: { target?: 'ownGroup' | 'anyGroup' | 'rivalGroup' | 'place' | 'personality' | 'plot'; mode?: string[]; pay?: 'tokens' | 'illuminati'; alignment?: boolean; helper?: boolean; targets?: boolean };
}

export const PLOTS: Record<string, PlotHandler> = {};

export function registerPlots(table: Record<string, PlotHandler>) {
  Object.assign(PLOTS, table);
}
