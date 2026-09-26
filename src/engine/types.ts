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
  uniqueness?: string | null;
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
  /** Which box the card comes from: missing means the base game ('Base'). */
  set?: CardSet;
  /** Printed Plot keywords (Zap, Freeze, Paralysis, Disaster, Assassination, Instant, Special). */
  keywords?: string[];
  /** NWO cards of the expansions: the colour printed on the card. */
  nwoColor?: 'red' | 'blue' | 'yellow';
}

/** The boxes the cards come from. */
export type CardSet = 'Base' | 'Assassins' | 'SubGenius';
/** The optional expansion packs a game may use. */
export type ExpansionId = 'assassins' | 'subgenius';

/**
 * 'agents': a spare Illuminati card played from hand as an agent inside a rival Illuminati (R044). It
 * lies beside its player's Resources but is not a Resource.
 */
export type Zone = 'plotDeck' | 'groupDeck' | 'hand' | 'structure' | 'resources' | 'discard' | 'destroyed' | 'table' | 'removed' | 'agents'
  /** SubGenius rules: face up in the middle of the table, owned by nobody, for anyone to capture or destroy. */
  | 'uncontrolled';

/** A temporary or permanent change to a card. */
export interface Modifier {
  source: string;          // card instance id or rule name that created it
  kind: 'power' | 'resistance' | 'global' | 'setPower' | 'setResistance' | 'mulPower' | 'mulResistance'
      | 'addAlign' | 'removeAlign' | 'noTokens' | 'addAttr' | 'removeAttr' | 'addArrow';
  value?: number;
  attr?: string;           // addAttr / removeAttr
  side?: Side; // addArrow: a new outgoing arrow on this (printed, unrotated) side
  align?: Alignment;
  defenseOnly?: boolean;   // +10 Plots used defensively, Good Polls
  forOpposing?: boolean;   // a defenseOnly Power bonus that also counts while the Group opposes an attack on another Group (Devival)
  lower?: boolean;         // setPower / setResistance that reduces the value to `value` instead of raising it (Angst)
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
  x?: number; y?: number;  // card centre, in half-units of a 5 × 7 card (see geometry.ts)
  side?: Side;             // which arrow of its master it hangs from
  rot?: number;            // quarter turns clockwise, 0..3
  tokens: number;
  capturedTurn?: number;   // turn number it was captured (no tokens that turn)
  devastated?: boolean;
  mods: Modifier[];
  exposed?: boolean;       // Plots in hand
  linkedTo?: string;       // Plots that stay linked to a Group
  failedTakeoverTurn?: number; // group in hand that failed an attack from hand this turn
  killed?: boolean;        // assassinated Personality
  linkMovedTurn?: number;  // Resources: turn the link was last moved
  abilityTurns?: Record<string, number>; // activated abilities: turn last used
  note?: string;           // secret note written under a card (Ark of the Covenant, Holy Grail)
  data?: Record<string, unknown>; // card-specific memory for scripted cards
  hiddenUnder?: string;    // Resources: face down under this card (Warehouse 23): inactive, unseen by rivals
  /** A face-down Unique Resource its controller showed when a rival tried to play a copy: now public (R041). */
  shown?: boolean;
  /**
   * A face-down Unique Resource its controller kept hidden while a rival played a copy: the rival has
   * the Resource now, and this copy is discarded if it is ever turned face up (R041).
   */
  forfeited?: boolean;
  /** Resources: the turn it last gave a benefit (a bonus in an attack, an extra token or draw) (R042, R040). */
  benefitTurn?: number;
  /** Set aside for its owner after a duplicate copy replaced it in a capture: out of the game (R031). */
  setAside?: boolean;
  /**
   * Action tokens the card still has but cannot spend right now (Paralysis, Freeze): they come back
   * once the card is free again. Kept apart so no rule can spend them by mistake.
   */
  heldTokens?: number;
  /** SubGenius rules: who put the card into the uncontrolled area, and on which turn (automatic takeovers). */
  placedBy?: string;
  placedTurn?: number;
}

/** Computer opponent difficulty. */
export type AiLevel = 'easy' | 'normal' | 'hard';

export interface PlayerState {
  id: string;
  name: string;
  isAI: boolean;
  aiLevel?: AiLevel;       // how well a computer player plays (default 'normal')
  aiStyle?: string;        // which named computer this is: its habits (see src/ai/personas.ts)
  /** A mirror's habits, learned from a real player's games (src/ai/profile.ts); overrides the style's. */
  aiStyleData?: Record<string, number | boolean | undefined>;
  illuminati: string;      // iid
  plotDeck: string[];      // top of deck = index 0
  groupDeck: string[];
  hand: string[];          // Plots and Groups in hand
  discard: string[];
  destroyedCredit: string[]; // groups this player destroyed (for Goals)
  turnsTaken: number;
  eliminated: boolean;
  autoPass: boolean;       // standing order: pass when not directly involved
  known?: string[];        // cards this player has privately looked at (still secret from others)
  lastPuppetTakenBy?: string; // who removed this player's last Group (credit for knocking out an Illuminati)
  eliminatedBy?: string;
  lastPuppetHelpers?: string[]; // players who helped remove that last Group (Fratricide: any help counts)
  /** Players this one attacked before finishing his first turn: they may respond against him (R001). */
  firstTurnAttacked?: string[];
  /** Left the game (resigned): counts as elimination (R049). */
  resigned?: boolean;
  /** General-purpose once-per-game markers for a card whose text needs one (Oil Spill's Green-Group bonus). */
  flags?: Record<string, boolean>;
  /**
   * Go Fish (Assassins errata): this player received a Plot card from a rival, or was forced to show a
   * rival a hidden Plot, and is immune to Go Fish while `turnsTaken` is no more than this.
   */
  goFishShield?: number;
  /**
   * The player's local time zone, in minutes east of UTC, when the interface reported it: cards that
   * read the player's clock use it (Australia). Without it the clock of the device running the game is used.
   */
  utcOffset?: number;
}

export type AttackType = 'control' | 'destroy';

export interface Contribution {
  player: string;
  iid?: string;            // group spending a token
  plot?: string;           // plot instance providing it
  forGroup?: string;       // the Group a Plot bonus was played on
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
  ability?: string;        // set when this entry is an activated ability of a card, not a Plot
  partOf?: string;         // an extra effect of another entry (that Plot's iid): cancelled along with it
  /** Made illegal before it resolved (its Group no longer qualifies, a new immunity): it no longer counts. */
  voided?: boolean;
}

export interface AttackCtx {
  id: number;
  type: AttackType;
  instant: boolean;        // Instant Attack launched by a card (Disaster / Assassination)
  instantCard?: string;    // plot iid launching it
  instantPower?: number;
  instantDefense?: number;
  cardPower?: number;            // a card's own non-Instant attack with no attacking Group (Epidemic, Giant Kudzu)
  aidRule?: 'defenderOnly';      // only the defender may be helped (Giant Kudzu)
  tokenTaken?: boolean;          // a Disaster removed a token from its target (given back if cancelled)       // target's Power at the moment an Instant attack was played (R034)
  disaster?: { destroyMargin: number | null; devastateOnly?: boolean };
  assassination?: boolean;
  attacker?: string;       // iid of leading group (undefined for attacks launched by a card)
  attackerPlayer: string;
  target: string;          // iid
  targetPlayer?: string;   // controller of target (undefined if from hand)
  fromHand: boolean;
  /** SubGenius rules: the target lies in the uncontrolled area (no owner, no position bonus). */
  fromArea?: boolean;
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
  barred?: string[];       // players a card has barred from interfering in this attack (Multinational Oil Companies)
  strengthLock?: { attack: number; defense: number; by: string }; // strength fixed by a card (Mothers' March) unless that card is cancelled
  /** The attacker removed an Action token during the attack: it is committed and cannot be called off (R009). */
  committed?: boolean;
  /**
   * Why the attacking action is no longer legal (a new immunity, a changed alignment…), re-checked after
   * every play. While set the attack counts as cancelled; if it is still set when the attack resolves,
   * the attack does not happen. A later play may make it legal again (then it is cleared).
   */
  illegal?: string;
  /** Aiding or opposing Groups whose action has become illegal (a new immunity): they no longer count. */
  illegalGroups?: string[];
  /** Don't Touch That Dial! (Assassins): if this attack ends in failure, the attacker's turn ends at once. */
  endsAttackerTurn?: boolean;
  /**
   * A successful Attack to Control strips this alignment from the target for good instead of capturing
   * it (the Drug Companies): set once the attack starts, read when it resolves.
   */
  stripAlignment?: Alignment;
  /**
   * Society of Assassins: a player chose to treat the attacking and the defending Group's Fanatic
   * alignments as the same one (instead of opposite) for this attack.
   */
  fanaticSame?: boolean;
  /** Society of Assassins: the defender treats the target's Fanatic alignment as its master's (they share it). */
  fanaticMasterSame?: boolean;
}

/** An open response window: everyone may act; closes when all players have passed in a row. */
export interface ResponseWindow {
  kind: 'attack' | 'roll' | 'plot' | 'endOfTurn' | 'event';
  event?: GameEvent;       // for kind 'event': what just happened
  passed: string[];        // players who passed since the last change
  deadline?: number;       // epoch ms, for asynchronous games (server enforces)
  plot?: PlayedPlot;       // for kind 'plot': the plot that may be countered
  plays?: PlayedPlot[];    // counters played against it
}

/** A decision only one player can make (blocks the game until made). */
export interface Prompt {
  player: string;
  /**
   * 'placeCaptured': the player may rearrange the Groups a capture or a move just brought in (each keeps
   * its master); `data` is a PlaceCapturedData. Groups still unplaced when he is done are lost (R031, R038).
   */
  kind: 'takeover' | 'discardToLimit' | 'placeCaptured' | 'chooseLead' | 'choose' | 'draw';
  data?: Record<string, unknown>;
  choice?: Choice;         // for kind 'choose'
}

/** What a 'placeCaptured' prompt is about. */
export interface PlaceCapturedData {
  /** The Groups that came in (the root first): only these may be rearranged. */
  cards: string[];
  /** Groups (with their puppets) that did not fit: each still needs an open arrow of its master. */
  pending: { group: string; master: string }[];
  /** What happens to a Group that still does not fit: discarded after a capture, back to hand after a move. */
  overflow: 'discard' | 'hand';
  /** Whose hand an unplaced Group goes back to (after a move). */
  handOf?: string;
}

/** A player's promise to spend some of his Groups' actions on Relief for a Devastated Place (R037). */
export interface ReliefPledge {
  player: string;
  place: string;
  groups: string[];
  turn: number;            // pledges lapse when the turn they were made in ends
}

/** A decision a card asks one player to make (pick a Group to lose, a Plot to show, …). */
export interface Choice {
  key: string;             // registered resolver (registerChoice)
  question: string;
  options: { id: string; label: string }[];
  min: number;
  max: number;
  source?: string;         // card instance that asked
  data?: Record<string, unknown>;
}

/** Something that just happened that some cards may respond to (R010 response window). */
export interface GameEvent {
  type: 'turnStart' | 'drawn' | 'takeover' | 'destroyed' | 'devastated' | 'discarded' | 'plotResolved' | 'relief'
    | 'failedTakeover' // a Group played from hand failed to be taken over (Opportunity Knocks)
    | 'costDiscard'    // cards were discarded from a hand or deck to pay a Plot's cost (Go, Lemmings, Go!)
    | 'tokenPlacement' // the active player's Action tokens are about to be placed (Strange Bedfellows)
    | 'gainedControl'  // a player took control of a Group from a hand or the uncontrolled area other than by automatic takeover
    | 'dieRoll'        // a card rolled dice outside an attack (cardRoll): cards changing "any die roll" answer it
    | 'action';       // an action outside an attack was announced and waits for responses before it happens
  player?: string;         // whose turn / who did it
  card?: string;           // card involved
  cards?: string[];
  by?: string;             // who caused it
  data?: Record<string, unknown>;
  /**
   * 'action' events: responses made while the action waits (cancels, and cancels of those cancels),
   * judged like the Plots of an attack: an entry counts unless a later live entry cancels it.
   */
  responses?: PlayedPlot[];
}

/** What an 'action' event announces (in `data.action`); `data.kind` names it for the interface. */
export type AnnouncedKind = 'move' | 'ability' | 'relief' | 'resource' | 'link' | 'drawGroup';

export type Phase = 'setup' | 'beginning' | 'main' | 'endOfTurn' | 'gameOver';

export interface LogEntry { turn: number; player?: string; text: string; to?: string /* private: only this player sees it */; info?: boolean /* narration of an automatic step, not an action */ }

export interface GameSettings {
  basicGoal: number;       // groups to control (incl. Illuminati)
  responseHours: number;   // async deadline for response windows
  houseRules: string[];
  /**
   * Remind a player who could declare victory that he may (a learner's aid; the interface turns it on
   * in its Tutorial and Guided help modes). Off by default: strict play means you must spot your own
   * win and declare it, and nobody wins without declaring.
   */
  victoryReminder?: boolean;
  /** Expansion packs whose cards this game uses (both off unless switched on). Missing = base game only. */
  expansions?: { assassins?: boolean; subgenius?: boolean };
  /**
   * The stand-alone SubGenius game (SubGenius rulebook): everybody plays the Church of the SubGenius,
   * all players share one Plot deck and one Group deck, and Groups are drawn into an uncontrolled area
   * in the middle of the table instead of into hands. See docs/EXPANSIONS.md.
   */
  subgeniusRules?: boolean;
}

/** One Goal a player can claim: the Basic Goal, his Illuminati's Special Goal, or a Goal card in hand. */
export interface GoalOption {
  id: string;              // 'basic', 'special', or the Goal card's instance id
  label: string;           // plain words: which Goal it is
  met: boolean;            // is it met right now?
  why?: string;            // when met: what meets it
  card?: string;           // a Goal card's instance id
}

/** A declared victory, waiting while the other players try to stop it (R016). */
export interface VictoryClaim {
  player: string;
  goals: string[];         // GoalOption ids declared (a Goal card is shown: exposed; 'copy:<card id>' is a Goal copied by Copy Shops)
  labels: string[];        // what was said when declaring, for everyone to read
}

export interface GameState {
  id: string;
  version: number;         // increments on every applied action
  rng: number;             // seeded RNG state
  layout?: number;         // card layout version (2 = real card shapes; see geometry.ts)
  settings: GameSettings;
  players: PlayerState[];  // seat order = turn order
  cards: Record<string, CardInstance>;
  turn: number;            // total turns started, 1-based
  round: number;
  active: number;          // index into players
  phase: Phase;
  turnFlags: {
    takeoverDone: boolean; resourcePlayed: boolean; illumGroupDraw: boolean; bavarianPrivilege: boolean;
    noPlotDraws?: string[];     // players who may draw no Plots this turn (Unlucky 13)
    noTakeover?: boolean;       // automatic takeovers are barred this turn (Sabotage)
    restricted?: boolean;       // active player may only draw and place tokens (Senate Investigating Committee)
    extraTurn?: boolean;        // an extra turn: no draws, no Plots, no new Illuminati token (Seize the Time)
    freeMoves?: string;         // this player may move Groups without paying (Reorganization)
    freeMovesOnce?: boolean;    // the free moves are one reorganization: they end at the player's next other step (Elders of Zion)
    noDraws?: boolean;          // skip this turn's normal draws (An Offer You Can't Refuse)
    redoTakeover?: boolean;     // the automatic takeover was undone: offer it again (Botched Contact)
    endedAtOnce?: boolean;      // a card ended the turn at once: nobody can win at the end of it (R016)
    dealOffers?: string[];      // players who made a deal offer this turn (computer players make one at most)
    noActionsExcept?: string[]; // these players may take no action or free move for the rest of this turn, other than opposing an attack (SubGenius: . . . Or Kill Me!)
    freeAttack?: string;        // this player's Illuminati may make one direct attack without spending a token (Time Control)
    illuminatiLocked?: string;  // this player's Illuminati token may not be spent this turn except to buy a Plot (Time Control)
    endPending?: boolean;       // a card ended the turn at once: open the end-of-turn window when the game is free
    illuminatiSpent?: string[]; // players whose Illuminati spent a token this turn on anything but buying Plots (Time Control)
    slackfusion?: boolean;      // Illuminati Action tokens may change hands in a deal, Illuminati to Illuminati only (Slackfusion)
  };
  events?: GameEvent[];       // queued events waiting for their response window
  continuation?: string;      // what to do when the current event window closes
  promptQueue?: Prompt[];     // choices waiting behind the current prompt
  resumeSeat?: number;        // after an extra turn, whose turn begins
  extraTurnFor?: string;      // a player who will take an extra turn next
  nwo: Record<string, string | undefined>; // colour -> plot iid
  attack?: AttackCtx;
  window?: ResponseWindow;
  prompt?: Prompt;
  attackCounter: number;
  firstPlayer: number;      // index of the player who went first (rounds start with them)
  log: LogEntry[];
  winners?: string[];
  /** Victories declared at the end of this turn, open to responses until everyone passes (R016). */
  claims?: VictoryClaim[];
  setup?: { picks: Record<string, string | undefined>; banned: string[]; setAside: string[]; sides?: Record<string, Side> };
  /** Players' promises to join in Relief for a Devastated Place, so several players can pay it together (R037). */
  reliefPledges?: ReliefPledge[];
  /** Deal offers waiting for an answer (R040, R022). Each is seen only by its two players. */
  deals?: Deal[];
  /** Agreed deals whose I Lied is still waiting to resolve: the liar's side is held back until then. */
  dealWaits?: DealWait[];
  dealCounter?: number;
  /** SubGenius rules: the shared decks, discard piles and the uncontrolled area (top of a deck = index 0). */
  common?: CommonDecks;
  /** Attribute Freezes in effect (Assassins): they last until the end of the turn they were played in. */
  freezes?: Freeze[];
  /** How each person has played this game so far (counters kept by src/ai/profile.ts; people only). */
  habits?: Record<string, Record<string, unknown>>;
  /** SubGenius: players spared from R049 elimination this turn by showing Arise!, awaiting the end of turn. */
  ariseWatch?: string[];
  /**
   * The Sultan of Slack (SubGenius): until the start of `by`'s next turn, nobody may win by their
   * Illuminati's Special Goal unless their Illuminati holds at least `tokens` Action tokens.
   */
  sultanOfSlack?: { by: string; tokens: number };
  /** A card makes this player use this Plot at once (SubGenius: Sacred Jests): it may be played now whatever its usual moment. */
  forcedPlay?: { player: string; card: string };
}

/** The shared piles of the stand-alone SubGenius game. */
export interface CommonDecks {
  plotDeck: string[];
  groupDeck: string[];
  plotDiscard: string[];
  groupDiscard: string[];
  /** Group and Resource cards face up in the middle of the table, controlled by nobody. */
  uncontrolled: string[];
}

/**
 * An Attribute Freeze (Assassins): until the end of `turn`, Groups matching `match` (and Resources whose
 * card id is listed) may spend no Action tokens except to defend themselves.
 */
export interface Freeze {
  card: string;            // the Freeze Plot's instance id
  player: string;          // who played it
  turn: number;
  match: import('./abilities').Match | import('./abilities').Match[]; // several: any of them
  resources?: string[];    // Resource card ids frozen as well (Satellites, the Orbital Mind Control Lasers)
  exempt?: string[];       // players whose cards it no longer affects (Enough is Enough)
  label: string;           // what is frozen, in words
}

// ---------------- Deals, trades and gifts (R040, R022, R038) ----------------

/** A Group in play changing hands, with its puppets, onto an open arrow of the receiver's structure. */
export interface DealGroup {
  group: string;
  onto?: string;           // the receiver's card it will hang from (chosen by the receiver)
  side?: Side;             // which arrow of `onto`
  payWith?: string;        // the token paying for the move: the Group, its old or new master, or either Illuminati
}

/** What one player hands over in a deal. */
export interface DealSide {
  cards?: string[];        // cards from hand (Plots, hidden or exposed, Groups, Resources)
  resources?: string[];    // Resources in play
  groups?: DealGroup[];    // Groups in play
  anyPlots?: number;       // asked for only: Plots from hand of the giver's choice
  anyCards?: number;       // asked for only: Group or Resource cards from hand of the giver's choice
  /** Illuminati Action tokens, one Illuminati to another only (Slackfusion, for the rest of that turn). */
  illuminatiTokens?: number;
}

export interface Deal {
  id: string;
  from: string;            // who offered it
  to: string;              // who is asked to accept
  turn: number;            // the turn it was offered in: an offer lapses when that turn ends
  give: DealSide;          // what the offer hands over
  get: DealSide;           // what it asks for in return (empty for a gift)
  note?: string;           // a promise about the future: shown, never enforced
  lie?: string;            // the offerer's I Lied, played as soon as the deal is agreed (secret from the other player)
  counterOf?: string;      // the offer this one answers
}

/** An agreed deal held up by I Lied: each liar's side is delivered only if his I Lied is cancelled. */
export interface DealWait {
  id: string;
  deal: Deal;              // with every choice filled in
  lies: { player: string; card: string; state: 'waiting' | 'playing' | 'kept' | 'cancelled' }[];
}

// ---------------- Actions a player can submit ----------------

export interface PlotPlay {
  card: string;                  // plot iid in hand
  target?: string;               // group iid (or plot iid for counters)
  mode?: 'power' | 'resistance' | 'up' | 'down' | string;
  payWith?: string[];            // group iids spending tokens as the plot's cost
  alignment?: Alignment;
  helper?: string;               // optional group joining an Instant Attack
  targets?: string[];            // several Groups (reload cards)
  march?: string;                // a March on Washington card in hand standing in for one required action
  /** Plot cards from hand discarded to pay a cost declared with `requires` (see costs.ts). */
  discards?: string[];
}

export type Action =
  | { type: 'takeover'; card: string; onto: string; side: Side }
  | { type: 'skipTakeover' }
  | { type: 'attack'; attackType: AttackType; attacker: string; target: string; side?: Side; plots?: PlotPlay[]; privileged?: boolean }
  | { type: 'move'; group: string; onto: string; side: Side; payWith?: string }
  | { type: 'playPlot'; play: PlotPlay }
  | { type: 'buyPlot'; payWith: string[] }
  /** The Illuminati's once-per-turn Group draw; under SubGenius rules any time, paid by `payWith` (1 Illuminati or 2 other Groups). */
  | { type: 'drawGroup'; payWith?: string[] }
  | { type: 'draw'; deck: 'plot' | 'group' } // start-of-turn draw, made by hand (people only)
  | { type: 'skipDraw' }                     // the start-of-turn draws are optional
  | { type: 'playResource'; card: string }
  | { type: 'link'; resource: string; to: string }
  | { type: 'useAbility'; card: string; ability: string; params?: import('./hooks').AbilityParams }
  | { type: 'agent'; card: string; as: 'aid' | 'oppose' }
  /** `partners`: other players whose pledged Groups pay for this Relief along with `payWith` (R037). */
  | { type: 'relief'; place: string; payWith: string[]; partners?: string[] }
  /** Promise Groups toward a Relief another player (or you) may send; an empty list withdraws it. */
  | { type: 'pledgeRelief'; place: string; payWith: string[] }
  /** Play a spare Illuminati card from hand as an agent inside a rival Illuminati (R044). */
  | { type: 'playAgent'; card: string }
  /** Leave the game for good: it counts as being eliminated (R049). */
  | { type: 'resign' }
  /** Spend one of your Illuminati's actions to remove every Zap from one player (Assassins). */
  | { type: 'removeZaps'; player: string }
  /** Free a Paralyzed Group: pay with its master (if you control it) or with your Illuminati (Assassins). */
  | { type: 'freeGroup'; group: string; payWith: string }
  /**
   * Admit a naming slip against a linked Regi$tered Trademark (Assassins): discard the named Plot from
   * hand, or (if `discard` is left out) the top card of your own Plot deck.
   */
  | { type: 'nameSlip'; card: string; discard?: string }
  /** Catch the linked Regi$tered Trademark's Group's owner slipping first: they hand you their top Plot (Assassins). */
  | { type: 'catchNameSlip'; card: string }
  /** Reunite the two halves of a Place split by Partition (Assassins): both must be yours. */
  | { type: 'reunitePartition'; group: string }
  /** Rearranging Groups a capture or move brought in: put `group` on `side` of `onto` (its own master). */
  | { type: 'placeCaptured'; group: string; onto: string; side: Side }
  | { type: 'placeCapturedDone' }
  /** Take an Action token off one of your own Groups or Resources, for whatever reason (Action Tokens, p.3). */
  | { type: 'removeToken'; card: string }
  /** Show a hidden Plot in your hand to one rival; it stays hidden from everyone else (Hidden and Exposed Plots, p.5). */
  | { type: 'showCard'; card: string; to: string }
  | { type: 'aid'; group: string; useGlobal?: boolean }
  | { type: 'oppose'; group: string; useGlobal?: boolean }
  | { type: 'pass' }
  | { type: 'endTurn' }
  | { type: 'declareVictory'; goal: string }  // knock (in your main phase) or at the end of a turn: claim a Goal
  | { type: 'discard'; cards: string[]; toDeck?: boolean; position?: 'top' | 'middle' | 'bottom' }
  | { type: 'exposeCard'; card: string }
  | { type: 'chooseLead'; card: string; side?: Side }
  | { type: 'choose'; ids: string[] }
  | { type: 'callOff' }
  | { type: 'setAutoPass'; value: boolean }
  | { type: 'offerDeal'; to: string; give: DealSide; get: DealSide; note?: string; lie?: string; counterOf?: string }
  /** Accept (filling in the choices the offer leaves to you) or decline an offer made to you. */
  | { type: 'respondDeal'; deal: string; accept: boolean; choose?: string[]; groups?: DealGroup[]; lie?: string }
  | { type: 'cancelDeal'; deal: string };

export class RuleError extends Error {}
