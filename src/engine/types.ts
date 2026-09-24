// Core data types for the Elitists War rules engine.
// The whole game is one JSON-serialisable GameState so it can be saved after
// every move and resumed later (asynchronous play) or run on a server.

export type Side = 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT';
export type CardType = 'Illuminati' | 'Group' | 'Resource' | 'Plot';
export type Alignment =
  | 'Government' | 'Corporate' | 'Liberal' | 'Conservative' | 'Peaceful'
  | 'Violent' | 'Straight' | 'Weird' | 'Criminal' | 'Fanatic';

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  subtype: string; // Organization | Personality | Place | Promo | Plot | Disaster | Assassination | Goal | NWO ...
  rarity: string | null;
  text: string;
  trigger?: string | null;
  target?: string | null;
  cost?: string | null;
  modifier?: string | null;
  playRequirement?: string | null;
  notes?: string | null;
  power?: number;
  globalPower?: number;
  resistance?: number | null;
  alignments?: string[];
  conditionalAlignments?: string[];
  attributes?: string[];
  arrowIn?: Side | null;
  arrowsOut?: Side[];
  attackPower?: string | null;
  variableStats?: boolean;
}

export type Zone = 'plotDeck' | 'groupDeck' | 'hand' | 'structure' | 'discard' | 'destroyed' | 'table' | 'removed';

/** A temporary or permanent change to a card. */
export interface Modifier {
  source: string;          // card instance id or rule name that created it
  kind: 'power' | 'resistance' | 'global' | 'setPower' | 'setResistance' | 'mulPower' | 'mulResistance'
      | 'addAlign' | 'removeAlign' | 'noTokens';
  value?: number;
  align?: Alignment;
  defenseOnly?: boolean;   // +10 Plots used defensively, Good Polls
  until: 'permanent' | 'endOfTurn' | 'startOfOwnerTurn' | 'attack'; // 'attack' = current attack only
  countsForGoals?: boolean;
}

export interface CardInstance {
  iid: string;             // unique per game, e.g. "p1-12"
  cardId: string;
  owner: string;           // player id
  zone: Zone;
  controller?: string;     // player id while in a structure / on the table
  // Power Structure placement (zone === 'structure')
  master?: string;         // iid of master (undefined for Illuminati)
  x?: number; y?: number;  // grid cell
  rot?: number;            // quarter turns clockwise, 0..3
  tokens: number;
  capturedTurn?: number;   // turn number it was captured (no tokens that turn)
  devastated?: boolean;
  mods: Modifier[];
  exposed?: boolean;       // Plots in hand
  linkedTo?: string;       // Plots that stay linked to a Group
  failedTakeoverTurn?: number; // group in hand that failed an attack from hand this turn
  killed?: boolean;        // assassinated Personality
}

export interface PlayerState {
  id: string;
  name: string;
  isAI: boolean;
  illuminati: string;      // iid
  plotDeck: string[];      // top of deck = index 0
  groupDeck: string[];
  hand: string[];          // Plots and Groups in hand
  discard: string[];
  destroyedCredit: string[]; // groups this player destroyed (for Goals)
  turnsTaken: number;
  eliminated: boolean;
  autoPass: boolean;       // standing order: pass when not directly involved
}

export type AttackType = 'control' | 'destroy';

export interface Contribution {
  player: string;
  iid?: string;            // group spending a token
  plot?: string;           // plot instance providing it
  amount: number;
  label: string;
}

/** What a played Plot does to the attack (evaluated live, so cancelling the Plot undoes it). */
export type PlotEffect =
  | { t: 'none' }
  | { t: 'cancelPlot'; target: string }
  | { t: 'cancelGroup'; group: string }
  | { t: 'reroll'; dice: number[] }
  | { t: 'delta'; value: number }
  | { t: 'set'; value: number }
  | { t: 'fail' }
  | { t: 'privileged' }
  | { t: 'unprivilege' }
  | { t: 'interfere'; player: string };

export interface PlayedPlot {
  iid: string;
  player: string;
  play: PlotPlay;
  effect: PlotEffect;
}

export interface AttackCtx {
  id: number;
  type: AttackType;
  instant: boolean;        // Instant Attack launched by a card (Disaster / Assassination)
  instantCard?: string;    // plot iid launching it
  instantPower?: number;
  disaster?: { destroyMargin: number | null; devastateOnly?: boolean };
  assassination?: boolean;
  attacker?: string;       // iid of leading group (undefined for instant attacks without a group)
  attackerPlayer: string;
  target: string;          // iid
  targetPlayer?: string;   // controller of target (undefined if from hand)
  fromHand: boolean;
  arrow?: Side;            // world side of attacker to place captured group on
  privileged: boolean;
  aid: Contribution[];
  oppose: Contribution[];
  attackBonus: Contribution[];   // +N to the attack (plots, abilities)
  defenseBonus: Contribution[];  // +N to defense
  plays: PlayedPlot[];           // plots played during this attack (can be targeted by cancels)
  roll?: number[];               // 2d6 once rolled
  result?: 'success' | 'failure';
  usedAgents?: boolean;
}

/** An open response window: everyone may act; closes when all players have passed in a row. */
export interface ResponseWindow {
  kind: 'attack' | 'roll' | 'plot' | 'endOfTurn';
  passed: string[];        // players who passed since the last change
  deadline?: number;       // epoch ms, for asynchronous games (server enforces)
  plot?: PlayedPlot;       // for kind 'plot': the plot that may be countered
  plays?: PlayedPlot[];    // counters played against it
}

/** A decision only one player can make (blocks the game until made). */
export interface Prompt {
  player: string;
  kind: 'takeover' | 'discardToLimit' | 'placeCaptured';
  data?: Record<string, unknown>;
}

export type Phase = 'beginning' | 'main' | 'endOfTurn' | 'gameOver';

export interface LogEntry { turn: number; player?: string; text: string; }

export interface GameSettings {
  basicGoal: number;       // groups to control (incl. Illuminati)
  responseHours: number;   // async deadline for response windows
  houseRules: string[];
}

export interface GameState {
  id: string;
  version: number;         // increments on every applied action
  rng: number;             // seeded RNG state
  settings: GameSettings;
  players: PlayerState[];  // seat order = turn order
  cards: Record<string, CardInstance>;
  turn: number;            // total turns started, 1-based
  round: number;
  active: number;          // index into players
  phase: Phase;
  turnFlags: { takeoverDone: boolean; resourcePlayed: boolean; illumGroupDraw: boolean; bavarianPrivilege: boolean };
  nwo: Record<string, string | undefined>; // colour -> plot iid
  attack?: AttackCtx;
  window?: ResponseWindow;
  prompt?: Prompt;
  attackCounter: number;
  firstPlayer: number;      // index of the player who went first (rounds start with them)
  log: LogEntry[];
  winners?: string[];
}

// ---------------- Actions a player can submit ----------------

export interface PlotPlay {
  card: string;                  // plot iid in hand
  target?: string;               // group iid (or plot iid for counters)
  mode?: 'power' | 'resistance' | 'up' | 'down' | string;
  payWith?: string[];            // group iids spending tokens as the plot's cost
  alignment?: Alignment;
  helper?: string;               // optional group joining an Instant Attack
}

export type Action =
  | { type: 'takeover'; card: string; onto: string; side: Side }
  | { type: 'skipTakeover' }
  | { type: 'attack'; attackType: AttackType; attacker: string; target: string; side?: Side; plots?: PlotPlay[]; privileged?: boolean }
  | { type: 'move'; group: string; onto: string; side: Side; payWith: string }
  | { type: 'playPlot'; play: PlotPlay }
  | { type: 'buyPlot'; payWith: string[] }
  | { type: 'aid'; group: string; useGlobal?: boolean }
  | { type: 'oppose'; group: string; useGlobal?: boolean }
  | { type: 'pass' }
  | { type: 'endTurn' }
  | { type: 'discard'; cards: string[] }
  | { type: 'setAutoPass'; value: boolean };

export class RuleError extends Error {}
