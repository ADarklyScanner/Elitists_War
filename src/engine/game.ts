// The Elitists War rules engine. Pure state transitions: applyAction(state, player, action)
// validates the move against the rules, mutates a copy of the state and returns it.
import type {
  Action, AttackCtx, CardInstance, Contribution, GameSettings, GameState, PlayedPlot,
  PlayerState, PlotPlay, Side,
} from './types';
import { RuleError } from './types';
import { CARDS, cardName, def, inst } from './cards';
import { roll2d6, shuffle } from './rng';
import {
  DELTA, OPPOSITE_SIDE, SIDES, depth, occupied, openArrows, puppets, rotate, rotationFor, structureCards, subtree,
} from './geometry';
import { abilitiesOf, attackingGroups, matches } from './abilities';
import { alignmentPairs, alignments, globalPower, power, resistance } from './stats';
import { NWO_EFFECTS } from './nwo';
import { PLOTS } from './plotTypes';

// ---------------------------------------------------------------- setup

export interface DeckList { illuminati: string; plots: string[]; groups: string[] }
export interface NewPlayer { id: string; name: string; isAI: boolean; deck: DeckList }

export const DEFAULT_SETTINGS: GameSettings = { basicGoal: 12, responseHours: 24, houseRules: [] };

export function createGame(opts: { id?: string; seed?: number; players: NewPlayer[]; settings?: Partial<GameSettings> }): GameState {
  const s: GameState = {
    id: opts.id ?? `g${Date.now().toString(36)}`,
    version: 0,
    rng: opts.seed ?? Math.floor(Math.random() * 2 ** 31),
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    players: [],
    cards: {},
    turn: 0,
    round: 1,
    active: 0,
    phase: 'beginning',
    turnFlags: { takeoverDone: false, resourcePlayed: false, illumGroupDraw: false, bavarianPrivilege: false },
    nwo: {},
    attackCounter: 0,
    firstPlayer: 0,
    log: [],
  };
  const n = opts.players.length;
  // Basic Goal (R016): 12 for 2-3 players, 11 for 4, 10 for 5+; never below 12 with two players,
  // unless the players chose the "quick game" house rule (8 Groups).
  const standard = n <= 3 ? 12 : n === 4 ? 11 : 10;
  if (s.settings.houseRules.includes('quickGame')) s.settings.basicGoal = 8;
  else if (n === 2) s.settings.basicGoal = Math.max(opts.settings?.basicGoal ?? 12, 12);
  else s.settings.basicGoal = opts.settings?.basicGoal ?? standard;

  for (const p of opts.players) {
    let k = 0;
    const mk = (cardId: string, zone: CardInstance['zone']) => {
      if (!CARDS[cardId]) throw new Error(`Unknown card ${cardId}`);
      const iid = `${p.id}-${++k}`;
      s.cards[iid] = { iid, cardId, owner: p.id, zone, tokens: 0, mods: [] };
      return iid;
    };
    const ill = mk(p.deck.illuminati, 'structure');
    Object.assign(s.cards[ill], { controller: p.id, x: 0, y: 0, rot: 0 });
    const player: PlayerState = {
      id: p.id, name: p.name, isAI: p.isAI, illuminati: ill,
      plotDeck: shuffle(s, p.deck.plots.map((c) => mk(c, 'plotDeck'))),
      groupDeck: p.deck.groups.map((c) => mk(c, 'groupDeck')),
      hand: [], discard: [], destroyedCredit: [], turnsTaken: 0, eliminated: false, autoPass: false,
    };
    s.players.push(player);
    for (let i = 0; i < 3; i++) drawPlot(s, player);
  }
  // Lead Group: each player picks the Group with the best spread of arrows (then Power).
  // Duplicate picks are resolved by re-picking (R025/R043).
  const taken = new Set<string>();
  for (const p of s.players) {
    const options = p.groupDeck.filter((iid) => def(s, iid).type === 'Group' && !taken.has(s.cards[iid].cardId));
    options.sort((a, b) => leadScore(s, b) - leadScore(s, a));
    const lead = options[0];
    if (lead) {
      taken.add(s.cards[lead].cardId);
      p.groupDeck = p.groupDeck.filter((x) => x !== lead);
      placeGroup(s, lead, p.id, p.illuminati, 'BOTTOM');
      log(s, `${p.name} leads with ${cardName(s, lead)}.`, p.id);
    }
    shuffle(s, p.groupDeck);
    for (let i = 0; i < 6; i++) drawGroup(s, p);
  }
  // Highest 2d6 goes first.
  const rolls = s.players.map((p) => ({ p, r: roll2d6(s).reduce((a, b) => a + b) }));
  rolls.sort((a, b) => b.r - a.r);
  s.active = s.players.indexOf(rolls[0].p);
  s.firstPlayer = s.active;
  log(s, `${rolls[0].p.name} wins the roll to go first.`);
  beginTurn(s);
  return s;
}

function leadScore(s: GameState, iid: string) {
  const d = def(s, iid);
  return (d.arrowsOut?.length ?? 0) * 10 + (d.power ?? 0);
}

// ---------------------------------------------------------------- helpers

export function log(s: GameState, text: string, player?: string) {
  s.log.push({ turn: s.turn, player, text });
}
export const player = (s: GameState, id: string) => {
  const p = s.players.find((x) => x.id === id);
  if (!p) throw new RuleError(`No player ${id}`);
  return p;
};
export const activePlayer = (s: GameState) => s.players[s.active];
export const livePlayers = (s: GameState) => s.players.filter((p) => !p.eliminated);

export function drawPlot(s: GameState, p: PlayerState, n = 1) {
  for (let i = 0; i < n; i++) {
    const c = p.plotDeck.shift();
    if (!c) return;
    s.cards[c].zone = 'hand';
    p.hand.push(c);
  }
}
export function drawGroup(s: GameState, p: PlayerState) {
  const c = p.groupDeck.shift();
  if (!c) return;
  s.cards[c].zone = 'hand';
  p.hand.push(c);
}

function removeFromHand(s: GameState, iid: string) {
  for (const p of s.players) p.hand = p.hand.filter((x) => x !== iid);
}

export function discardCard(s: GameState, iid: string) {
  const c = s.cards[iid];
  removeFromHand(s, iid);
  c.zone = 'discard';
  c.controller = undefined; c.master = undefined; c.linkedTo = undefined;
  c.tokens = 0;
  player(s, c.owner).discard.push(iid);
}

export function controllerOf(s: GameState, iid: string): string | undefined {
  const c = s.cards[iid];
  return c.zone === 'structure' ? c.controller : undefined;
}

export function inPlayIds(s: GameState): Set<string> {
  return new Set(Object.values(s.cards).filter((c) => c.zone === 'structure').map((c) => c.cardId));
}

/** Can this Group card be put into play (not a duplicate of one in play or destroyed)? */
export function canEnterPlay(s: GameState, iid: string): boolean {
  const cardId = s.cards[iid].cardId;
  return !Object.values(s.cards).some((c) => c.cardId === cardId && c.iid !== iid && (c.zone === 'structure' || c.zone === 'destroyed'));
}

/** Put a Group into a structure on `side` of `master`. */
export function placeGroup(s: GameState, iid: string, controller: string, master: string, side: Side) {
  const c = s.cards[iid];
  const m = s.cards[master];
  const d = def(s, iid);
  const [dx, dy] = DELTA[side];
  removeFromHand(s, iid);
  Object.assign(c, {
    zone: 'structure', controller, master, x: m.x! + dx, y: m.y! + dy,
    rot: rotationFor(d.arrowIn ?? 'TOP', side),
  });
}

/** Group has no tokens because it (or a master) is a Devastated Place, or it is barred. */
export function tokenBarred(s: GameState, iid: string): boolean {
  let c: CardInstance | undefined = s.cards[iid];
  while (c) {
    if (c.devastated) return true;
    c = c.master ? s.cards[c.master] : undefined;
  }
  if (abilitiesOf(s, iid).some((a) => a.kind === 'noTokens') && power(s, iid) === 0) return true;
  const d = def(s, iid);
  if (d.type === 'Group' && power(s, iid) === 0 && (d.power ?? 0) > 0) return true; // reduced to 0
  return s.cards[iid].mods.some((m) => m.kind === 'noTokens');
}

export function giveToken(s: GameState, iid: string) {
  if (!tokenBarred(s, iid) && s.cards[iid].tokens === 0) s.cards[iid].tokens = 1;
}

function illuminatiOf(s: GameState, playerId: string) {
  return player(s, playerId).illuminati;
}

function hasAbility(s: GameState, iid: string, kind: string) {
  return abilitiesOf(s, iid).some((a) => a.kind === kind);
}

// ---------------------------------------------------------------- turn flow

function beginTurn(s: GameState) {
  s.turn++;
  s.phase = 'beginning';
  s.turnFlags = { takeoverDone: false, resourcePlayed: false, illumGroupDraw: false, bavarianPrivilege: false };
  const p = activePlayer(s);
  // Expire "until the start of your next turn" effects of this player.
  for (const c of Object.values(s.cards)) c.mods = c.mods.filter((m) => !(m.until === 'startOfOwnerTurn' && c.controller === p.id));
  log(s, `— Turn ${s.turn} (round ${s.round}): ${p.name} —`, p.id);
  const extra = abilitiesOf(s, p.illuminati).filter((a) => a.kind === 'extraPlotDraw').reduce((n, a) => n + (a as { value: number }).value, 0);
  drawPlot(s, p, 1 + extra);
  drawGroup(s, p);
  if (takeoverOptions(s, p.id).length) s.prompt = { player: p.id, kind: 'takeover' };
  else finishBeginning(s);
}

function finishBeginning(s: GameState) {
  const p = activePlayer(s);
  s.prompt = undefined;
  for (const iid of structureCards(s, p.id)) {
    const d = def(s, iid);
    if (d.type === 'Illuminati') {
      let n = 1 + abilitiesOf(s, iid).filter((a) => a.kind === 'extraIlluminatiToken').reduce((k, a) => k + (a as { value: number }).value, 0);
      if (s.players.length === 2 && s.turnFlags.takeoverDone) n -= 1; // two-player rule (R023)
      s.cards[iid].tokens = Math.max(s.cards[iid].tokens, n);
    } else if (s.cards[iid].capturedTurn !== s.turn) {
      giveToken(s, iid);
    }
  }
  s.phase = 'main';
}

export function takeoverOptions(s: GameState, playerId: string): { card: string; onto: string; side: Side }[] {
  const out: { card: string; onto: string; side: Side }[] = [];
  const p = player(s, playerId);
  const spots = structureCards(s, playerId).flatMap((m) => openArrows(s, m).map((side) => ({ onto: m, side })));
  for (const card of p.hand) {
    if (def(s, card).type !== 'Group' || !canEnterPlay(s, card)) continue;
    for (const spot of spots) out.push({ card, ...spot });
  }
  return out;
}

function endTurnCleanup(s: GameState) {
  const p = activePlayer(s);
  // Groups that failed a takeover from hand this turn are discarded (R003).
  for (const iid of [...p.hand]) {
    if (s.cards[iid].failedTakeoverTurn === s.turn) {
      discardCard(s, iid);
      log(s, `${cardName(s, iid)} was not taken over and is discarded.`, p.id);
    }
  }
  for (const c of Object.values(s.cards)) c.mods = c.mods.filter((m) => m.until !== 'endOfTurn');
  // Hand limits (5 Plots outside your own turn) are enforced for everyone now.
  const over = livePlayers(s).find((x) => plotsInHand(s, x.id).length > handLimit(s, x.id));
  if (over) { s.prompt = { player: over.id, kind: 'discardToLimit' }; return; }
  finishTurn(s);
}

export function plotsInHand(s: GameState, playerId: string) {
  return player(s, playerId).hand.filter((iid) => def(s, iid).type === 'Plot');
}
export function handLimit(s: GameState, playerId: string) {
  let n = 5;
  for (const iid of structureCards(s, playerId)) for (const a of abilitiesOf(s, iid)) if (a.kind === 'handLimit') n += a.value;
  return n;
}

function finishTurn(s: GameState) {
  s.prompt = undefined;
  const p = activePlayer(s);
  p.turnsTaken++;
  checkVictory(s);
  if (isOver(s)) return;
  checkElimination(s);
  if (isOver(s)) return;
  // Next live player in seat order; a new round starts when play returns to the first player.
  let next = s.active;
  do {
    next = (next + 1) % s.players.length;
    if (next === s.firstPlayer) s.round++;
  } while (s.players[next].eliminated);
  s.active = next;
  beginTurn(s);
}

// ---------------------------------------------------------------- victory

export const isOver = (s: GameState) => s.phase === 'gameOver';

export function goalCount(s: GameState, playerId: string): number {
  const ill = illuminatiOf(s, playerId);
  const doubles = abilitiesOf(s, ill).filter((a) => a.kind === 'doubleCount') as { kind: 'doubleCount'; match: never; minPower?: number }[];
  let count = 0;
  let doubled = 0;
  for (const iid of structureCards(s, playerId)) {
    if (tokenBarredForGoals(s, iid)) continue;
    count++;
    if (doubled < 3 && def(s, iid).type === 'Group' && doubles.some((d) => matches(s, iid, d.match) && power(s, iid, { goals: true }) >= (d.minPower ?? 0))) {
      count++; doubled++;
    }
  }
  return count;
}

function tokenBarredForGoals(s: GameState, iid: string) {
  let c: CardInstance | undefined = s.cards[iid];
  while (c) { if (c.devastated && c.iid !== iid) return true; c = c.master ? s.cards[c.master] : undefined; }
  return false;
}

export function goalNeeded(s: GameState, playerId: string): number {
  let n = s.settings.basicGoal;
  const ill = illuminatiOf(s, playerId);
  if (abilitiesOf(s, ill).some((a) => a.kind === 'specialGoal' && a.goal === 'destroyCount')) n -= player(s, playerId).destroyedCredit.length;
  return n;
}

export function meetsGoal(s: GameState, playerId: string): string | null {
  if (goalCount(s, playerId) >= goalNeeded(s, playerId)) return 'controls enough Groups';
  const ill = illuminatiOf(s, playerId);
  const mine = structureCards(s, playerId);
  for (const a of abilitiesOf(s, ill)) {
    if (a.kind !== 'specialGoal') continue;
    const total = mine.reduce((n, iid) => n + power(s, iid, { goals: true }), 0);
    if (a.goal === 'totalPower' && total >= a.value) return `reached ${a.value} total Power`;
    if (a.goal === 'bermuda' && total >= a.value) {
      const all = new Set(mine.flatMap((iid) => alignments(s, iid)));
      if (['Government', 'Corporate', 'Liberal', 'Conservative', 'Peaceful', 'Violent', 'Straight', 'Weird', 'Criminal', 'Fanatic'].every((x) => all.has(x as never))) return 'controls every alignment with 35 Power';
    }
    if (a.goal === 'destroyCount' && player(s, playerId).destroyedCredit.length >= a.value) return `destroyed ${a.value} Groups`;
    if (a.goal === 'peacefulPower') {
      const peaceful = mine.filter((iid) => alignments(s, iid).includes('Peaceful')).reduce((n, iid) => n + power(s, iid, { goals: true }), 0);
      if (peaceful >= a.value) return `has ${a.value} Peaceful Power`;
    }
  }
  return null;
}

function checkVictory(s: GameState) {
  if (s.round === 1) return; // no one can win in the first round (R017)
  const winners = livePlayers(s).filter((p) => meetsGoal(s, p.id));
  const alive = livePlayers(s);
  if (alive.length === 1) winners.splice(0, winners.length, alive[0]);
  if (winners.length) {
    s.phase = 'gameOver';
    s.winners = winners.map((w) => w.id);
    for (const w of winners) log(s, `${w.name} wins: ${meetsGoal(s, w.id) ?? 'last player standing'}!`, w.id);
  }
}

function checkElimination(s: GameState) {
  for (const p of livePlayers(s)) {
    if (p.turnsTaken >= 3 && puppets(s, p.illuminati).length === 0) {
      p.eliminated = true;
      log(s, `${p.name} has no Groups left and is eliminated.`, p.id);
    }
  }
  const alive = livePlayers(s);
  if (alive.length === 1) {
    s.phase = 'gameOver';
    s.winners = [alive[0].id];
    log(s, `${alive[0].name} wins as the last player standing!`, alive[0].id);
  }
}

// ---------------------------------------------------------------- attacks

export function canAttackPlayer(s: GameState, attacker: string, defender: string | undefined): string | null {
  if (!defender || defender === attacker) return null;
  const a = player(s, attacker), d = player(s, defender);
  if (d.turnsTaken < 1 || (s.players.length === 2 && a.turnsTaken < 1)) return 'Neither player may attack the other until both have finished a full turn.';
  return null;
}

function immuneTo(s: GameState, target: string, attackerGroups: string[]): boolean {
  const owner = controllerOf(s, target);
  if (!owner) return false;
  const protectors = [target, ...structureCards(s, owner)];
  for (const pr of protectors) {
    for (const a of abilitiesOf(s, pr)) {
      if (a.kind === 'structureImmune' && attackerGroups.some((g) => matches(s, g, a.from))) return true;
      if (a.kind === 'selfImmune' && pr === target && attackerGroups.some((g) => matches(s, g, a.from))) return true;
    }
  }
  return false;
}

export function validateAttack(s: GameState, playerId: string, a: Extract<Action, { type: 'attack' }>): string | null {
  if (s.phase !== 'main' || activePlayer(s).id !== playerId) return 'You can only attack during the main phase of your own turn.';
  if (s.attack || s.window || s.prompt) return 'Finish the current action first.';
  const att = s.cards[a.attacker];
  const tgt = s.cards[a.target];
  if (!att || !tgt) return 'Unknown card.';
  if (att.zone !== 'structure' || att.controller !== playerId) return 'The attacker must be in your Power Structure.';
  if (att.tokens < 1) return `${cardName(s, a.attacker)} has no Action token.`;
  if (a.attacker === a.target) return 'A Group cannot attack itself.';
  const td = def(s, a.target);
  if (td.type !== 'Group') return 'Only Groups can be attacked.';
  const fromHand = tgt.zone === 'hand';
  if (fromHand) {
    if (a.attackType !== 'control') return 'Groups in your hand can only be attacked to control.';
    if (!player(s, playerId).hand.includes(a.target)) return 'You can only attack Groups from your own hand.';
    if (!canEnterPlay(s, a.target)) return 'That Group is already in play or was destroyed.';
  } else if (tgt.zone !== 'structure') return 'The target must be in play or in your hand.';
  if (a.attackType === 'control') {
    if (!fromHand && tgt.controller === playerId) return 'You already control that Group.';
    const open = openArrows(s, a.attacker);
    if (!open.length) return `${cardName(s, a.attacker)} has no open control arrow.`;
    if (a.side && !open.includes(a.side)) return 'That control arrow is not open.';
  }
  const err = canAttackPlayer(s, playerId, fromHand ? undefined : tgt.controller);
  if (err) return err;
  if (immuneTo(s, a.target, [a.attacker])) return `${cardName(s, a.target)} is immune to attacks from ${cardName(s, a.attacker)}.`;
  if (a.attackType === 'destroy' && abilitiesOf(s, a.target).some((x) => x.kind === 'cannotBeDestroyed')) return `${cardName(s, a.target)} cannot be destroyed.`;
  const ill = illuminatiOf(s, playerId);
  for (const ab of abilitiesOf(s, ill)) {
    if (a.attackType === 'destroy' && ab.kind === 'canOnlyDestroy' && !matches(s, a.target, ab.match)) return 'Your Illuminati may only destroy Violent Groups.';
  }
  if (a.privileged && !(abilitiesOf(s, ill).some((x) => x.kind === 'freePrivilegedAttack') && !s.turnFlags.bavarianPrivilege)) return 'You cannot make this attack Privileged.';
  return null;
}

function startAttack(s: GameState, playerId: string, a: Extract<Action, { type: 'attack' }>) {
  const err = validateAttack(s, playerId, a);
  if (err) throw new RuleError(err);
  const tgt = s.cards[a.target];
  const fromHand = tgt.zone === 'hand';
  s.cards[a.attacker].tokens--;
  const ctx: AttackCtx = {
    id: ++s.attackCounter, type: a.attackType, instant: false, attacker: a.attacker, attackerPlayer: playerId,
    target: a.target, targetPlayer: fromHand ? undefined : tgt.controller, fromHand,
    arrow: a.attackType === 'control' ? a.side ?? openArrows(s, a.attacker)[0] : undefined,
    privileged: !!a.privileged, aid: [], oppose: [], attackBonus: [], defenseBonus: [], plays: [],
  };
  if (a.privileged) s.turnFlags.bavarianPrivilege = true;
  s.attack = ctx;
  log(s, `${cardName(s, a.attacker)} attacks to ${a.attackType} ${cardName(s, a.target)}${fromHand ? ' (from hand)' : ''}${ctx.privileged ? ' — Privileged' : ''}.`, playerId);
  for (const play of a.plots ?? []) playPlot(s, playerId, play, true);
  openWindow(s, 'attack');
}

// ---- live Plot effects: a Plot counts unless a later, itself uncancelled Plot cancels it (R010).
export function isCancelled(plays: PlayedPlot[], iid: string): boolean {
  const i = plays.findIndex((p) => p.iid === iid);
  return plays.some((q, j) => j > i && q.effect.t === 'cancelPlot' && q.effect.target === iid && !isCancelled(plays, q.iid));
}
export function liveEffects(ctx: AttackCtx) {
  return ctx.plays.filter((p) => !isCancelled(ctx.plays, p.iid)).map((p) => ({ ...p.effect, by: p.player }));
}
export function isPrivileged(ctx: AttackCtx): boolean {
  const fx = liveEffects(ctx);
  if (fx.some((e) => e.t === 'unprivilege')) return false;
  return ctx.privileged || fx.some((e) => e.t === 'privileged');
}
export function cancelledGroups(ctx: AttackCtx): Set<string> {
  return new Set(liveEffects(ctx).flatMap((e) => (e.t === 'cancelGroup' ? [e.group] : [])));
}
export function attackCancelled(ctx: AttackCtx): boolean {
  if (ctx.instantCard && isCancelled(ctx.plays, ctx.instantCard)) return true;
  return !!ctx.attacker && cancelledGroups(ctx).has(ctx.attacker);
}

/** Players allowed to take part in the current attack. */
export function participants(s: GameState): string[] {
  const ctx = s.attack;
  if (!ctx || !isPrivileged(ctx)) return livePlayers(s).map((p) => p.id);
  const extra = liveEffects(ctx).flatMap((e) => (e.t === 'interfere' ? [e.player] : []));
  return [...new Set([ctx.attackerPlayer, ctx.targetPlayer, ...extra].filter((x): x is string => !!x))];
}

function openWindow(s: GameState, kind: 'attack' | 'roll' | 'plot' | 'endOfTurn', plot?: PlayedPlot) {
  s.window = { kind, passed: [], plot, deadline: Date.now() + s.settings.responseHours * 3600_000 };
}

function contributionPower(s: GameState, c: Contribution & { useGlobal?: boolean; selfDefense?: boolean }): number {
  if (!c.iid) return c.amount;
  let v = c.useGlobal ? globalPower(s, c.iid) : power(s, c.iid, { defense: c.selfDefense });
  if (c.selfDefense) v *= 2;
  return v + c.amount;
}

export interface StrengthBreakdown { attack: number; defense: number; strength: number; lines: string[] }

export function attackStrength(s: GameState, ctx: AttackCtx): StrengthBreakdown {
  const lines: string[] = [];
  let atk = 0, dfn = 0;
  const add = (side: 'a' | 'd', v: number, why: string) => {
    if (!v) return;
    if (side === 'a') atk += v; else dfn += v;
    lines.push(`${side === 'a' ? 'Attack' : 'Defense'} ${v > 0 ? '+' : ''}${v}: ${why}`);
  };
  const tgt = ctx.target;
  const td = def(s, tgt);
  const ownTarget = ctx.targetPlayer === ctx.attackerPlayer;
  const liveBonus = (list: Contribution[]) => list.filter((b) => !b.plot || !isCancelled(ctx.plays, b.plot));
  const gone = cancelledGroups(ctx);
  const aid = ctx.aid.filter((c) => !gone.has(c.iid!));
  const oppose = ctx.oppose.filter((c) => !gone.has(c.iid!));

  if (ctx.instant) {
    add('a', ctx.instantPower ?? 0, 'card Power');
    for (const c of aid) add('a', contributionPower(s, c), `${cardName(s, c.iid!)} joins`);
    // Only abilities that mention Instant attacks apply.
    for (const g of structureCards(s, ctx.attackerPlayer)) {
      for (const a of abilitiesOf(s, g)) {
        if (a.kind === 'attackBonus' && a.instant && a.scope === 'any' && (a.on === 'destroy' || a.on === 'both') && matches(s, tgt, a.target)) add('a', a.value, cardName(s, g));
      }
    }
    for (const b of liveBonus(ctx.attackBonus)) add('a', b.amount, b.label);
    add('d', power(s, tgt, { defense: true }), `${td.name} Power`);
  } else {
    const att = ctx.attacker!;
    add('a', power(s, att), `${cardName(s, att)} Power`);
    for (const c of aid) add('a', contributionPower(s, c), `${cardName(s, c.iid!)} aids${(c as { useGlobal?: boolean }).useGlobal ? ' (Global)' : ''}`);
    // Alignment modifier for the leading attacker only.
    const pairs = alignmentPairs(s, att, tgt);
    let perSame = 4, perOpp = 4;
    for (const n of Object.values(s.nwo)) {
      const v = n ? NWO_EFFECTS[s.cards[n].cardId]?.alignmentValues?.() : undefined;
      if (v) { perSame = v.same; perOpp = v.opposite; }
    }
    const replaces = abilitiesOf(s, att).some((a) => a.kind === 'attackBonus' && a.replacesAlignmentPenalty && (a.on === 'both' || a.on === ctx.type) && matches(s, tgt, a.target));
    if (ctx.type === 'control') add('a', pairs.same * perSame - (replaces ? 0 : pairs.opposite * perOpp), 'alignments');
    else add('a', pairs.opposite * perOpp - (replaces ? 0 : pairs.same * perSame), 'alignments');
    // Abilities: "any attempt" bonuses from all your Groups; the leader's "direct" bonuses do not
    // stack with its own "any attempt" bonus for the same attack — the larger applies (R029).
    for (const g of structureCards(s, ctx.attackerPlayer)) {
      let direct = 0, any = 0;
      for (const a of abilitiesOf(s, g)) {
        if (a.kind !== 'attackBonus' || !(a.on === 'both' || a.on === ctx.type) || !matches(s, tgt, a.target, g)) continue;
        if (a.scope === 'any') any += a.value; else if (g === att) direct += a.value;
      }
      add('a', g === att ? Math.max(direct, any) : any, cardName(s, g));
    }
    for (const c of aid) {
      for (const a of abilitiesOf(s, c.iid!)) {
        if (a.kind === 'aidBonus' && (a.on === 'both' || a.on === ctx.type) && matches(s, tgt, a.target)) add('a', a.value, `${cardName(s, c.iid!)} ability`);
      }
    }
    for (const b of liveBonus(ctx.attackBonus)) add('a', b.amount, b.label);
    // Defense.
    if (ctx.type === 'control') {
      add('d', resistance(s, tgt), `${td.name} Resistance`);
      const m = s.cards[tgt].master;
      if (!ctx.fromHand && m && def(s, m).type === 'Group') {
        const shared = alignments(s, tgt).filter((x) => x !== 'Fanatic' && alignments(s, m).includes(x)).length;
        add('d', shared * 4, `shares alignments with its master`);
      }
    } else {
      let p = power(s, tgt, { defense: true });
      if (s.cards[tgt].devastated) p = Math.floor(p / 2);
      add('d', p, `${td.name} Power${s.cards[tgt].devastated ? ' (Devastated, halved)' : ''}`);
    }
  }
  // Position bonus (R006) — not when attacking your own Group, not from hand.
  if (!ctx.fromHand && !ownTarget) {
    const d = depth(s, tgt);
    add('d', d === 1 ? 10 : d === 2 ? 5 : 0, 'close to its Illuminati');
  }
  for (const c of oppose) add('d', contributionPower(s, c), `${cardName(s, c.iid!)} opposes${(c as { selfDefense?: boolean }).selfDefense ? ' (defending itself, x2)' : ''}`);
  // Defensive abilities of the target's Power Structure.
  if (ctx.targetPlayer) {
    const attackers = ctx.instant ? [] : attackingGroups(ctx);
    for (const g of structureCards(s, ctx.targetPlayer)) {
      for (const a of abilitiesOf(s, g)) {
        const kindOk = !('on' in a) || !a.on || a.on === 'both' || a.on === ctx.type;
        if (a.kind === 'structureDefense' && kindOk && (!ctx.instant || a.instant) && (!a.vs || attackers.some((x) => matches(s, x, a.vs)))) add('d', a.value, cardName(s, g));
        if (a.kind === 'selfDefense' && g === tgt && kindOk && (!ctx.instant || a.instant) && (!a.vs || attackers.some((x) => matches(s, x, a.vs)))) add('d', a.value, `${cardName(s, g)} ability`);
      }
    }
  }
  for (const b of liveBonus(ctx.defenseBonus)) add('d', b.amount, b.label);
  return { attack: atk, defense: dfn, strength: atk - dfn, lines };
}

/** Everyone has passed: roll the dice (or fail automatically) and open the roll window. */
function rollAttack(s: GameState) {
  const ctx = s.attack!;
  const { strength } = attackStrength(s, ctx);
  if (strength < 2) {
    log(s, `Attack strength is ${strength}: it fails without a roll.`);
    ctx.result = 'failure';
    finishAttack(s);
    return;
  }
  ctx.roll = roll2d6(s);
  log(s, `Needs ${strength} or less on 2d6 — rolled ${ctx.roll[0]} + ${ctx.roll[1]} = ${ctx.roll[0] + ctx.roll[1]}.`);
  openWindow(s, 'roll');
}

export function finalRoll(ctx: AttackCtx): number {
  let dice = ctx.roll ?? [0, 0];
  let delta = 0;
  let set: number | undefined;
  for (const e of liveEffects(ctx)) {
    if (e.t === 'reroll') { dice = e.dice; delta = 0; set = undefined; }
    if (e.t === 'delta') delta += e.value;
    if (e.t === 'set') set = e.value;
  }
  if (set !== undefined) return set;
  return Math.max(2, Math.min(12, dice[0] + dice[1] + delta));
}

export function currentOutcome(s: GameState, ctx: AttackCtx): 'success' | 'failure' {
  if (attackCancelled(ctx) || liveEffects(ctx).some((e) => e.t === 'fail')) return 'failure';
  const { strength } = attackStrength(s, ctx);
  const r = finalRoll(ctx);
  if (strength < 2 || r >= 11) return 'failure';
  return r <= strength ? 'success' : 'failure';
}

function finishAttack(s: GameState) {
  const ctx = s.attack!;
  s.window = undefined;
  if (!ctx.result) ctx.result = currentOutcome(s, ctx);
  const tgt = ctx.target;
  if (attackCancelled(ctx)) {
    log(s, 'The attack was cancelled.');
    // R009: helpers get their tokens back; a Disaster's target gets its token back.
    for (const c of [...ctx.aid, ...ctx.oppose]) if (c.iid && s.cards[c.iid].zone === 'structure') s.cards[c.iid].tokens++;
    if (ctx.disaster && ctx.instantCard && isCancelled(ctx.plays, ctx.instantCard)) giveToken(s, tgt);
  }
  else if (ctx.result === 'success') {
    const margin = attackStrength(s, ctx).strength - finalRoll(ctx);
    if (ctx.disaster) {
      if (ctx.disaster.destroyMargin !== null && margin >= ctx.disaster.destroyMargin && !ctx.disaster.devastateOnly) {
        log(s, `${cardName(s, tgt)} is destroyed!`);
        destroyGroup(s, tgt, ctx.attackerPlayer);
      } else {
        devastate(s, tgt);
      }
    } else if (ctx.type === 'control') {
      capture(s, ctx);
    } else if (abilitiesOf(s, tgt).some((a) => a.kind === 'cannotBeDestroyed')) {
      log(s, `${cardName(s, tgt)} cannot be destroyed.`);
    } else {
      log(s, `${cardName(s, tgt)} is destroyed!`);
      if (ctx.assassination && def(s, tgt).subtype === 'Personality') s.cards[tgt].killed = true;
      destroyGroup(s, tgt, ctx.attackerPlayer);
    }
  } else {
    log(s, 'The attack fails.');
    if (ctx.fromHand && s.cards[tgt].zone === 'hand') {
      const keeps = abilitiesOf(s, illuminatiOf(s, ctx.attackerPlayer)).some((a) => a.kind === 'failedHandReturns');
      if (!keeps) s.cards[tgt].failedTakeoverTurn = s.turn;
    }
  }
  // Discard the Plots used in this attack (linked ones stay).
  for (const p of ctx.plays) {
    const c = s.cards[p.iid];
    if (c.zone === 'table' && (!c.linkedTo || isCancelled(ctx.plays, p.iid))) discardCard(s, p.iid);
  }
  for (const c of Object.values(s.cards)) c.mods = c.mods.filter((m) => m.until !== 'attack');
  s.attack = undefined;
  // Instant attacks can be launched during the end-of-turn window: return to it.
  if (s.phase === 'endOfTurn') openWindow(s, 'endOfTurn');
}

function devastate(s: GameState, iid: string) {
  const c = s.cards[iid];
  if (c.devastated) return;
  c.devastated = true;
  for (const g of subtree(s, iid)) s.cards[g].tokens = 0;
  log(s, `${cardName(s, iid)} is Devastated.`);
}

function capture(s: GameState, ctx: AttackCtx) {
  const tgt = ctx.target;
  const attacker = ctx.attacker!;
  let side = ctx.arrow && openArrows(s, attacker).includes(ctx.arrow) ? ctx.arrow : openArrows(s, attacker)[0];
  let master = attacker;
  if (!side) {
    // The attacker's arrows filled up during the attack: use any open arrow in the structure.
    const spot = structureCards(s, ctx.attackerPlayer).flatMap((m) => openArrows(s, m).map((sd) => ({ m, sd })))[0];
    if (!spot) { log(s, 'No open control arrow is left, so the capture fails.'); return; }
    master = spot.m; side = spot.sd;
  }
  log(s, `${player(s, ctx.attackerPlayer).name} takes control of ${cardName(s, tgt)}.`, ctx.attackerPlayer);
  moveSubtree(s, tgt, ctx.attackerPlayer, master, side, 'discard');
  for (const g of subtree(s, tgt)) { s.cards[g].tokens = 0; s.cards[g].capturedTurn = s.turn; }
  s.cards[tgt].failedTakeoverTurn = undefined;
}

/**
 * Move a Group and its puppets (keeping their relative layout) onto `side` of `master`.
 * Puppets that no longer fit are re-placed on another arrow of the same master if possible,
 * otherwise sent to `overflow` (discarded after a capture, returned to hand after a move).
 */
export function moveSubtree(s: GameState, root: string, controller: string, master: string, side: Side, overflow: 'discard' | 'hand') {
  const prevController = s.cards[root].controller ?? player(s, s.cards[root].owner).id;
  // Remember each card's puppets and which of its (local) arrows they hang from.
  const layout: Record<string, { child: string; local: Side }[]> = {};
  const all = s.cards[root].zone === 'structure' ? subtree(s, root) : [root];
  for (const iid of all) {
    const c = s.cards[iid];
    layout[iid] = puppets(s, iid).map((child) => {
      const ch = s.cards[child];
      const world = SIDES.find((sd) => c.x! + DELTA[sd][0] === ch.x && c.y! + DELTA[sd][1] === ch.y)!;
      return { child, local: rotate(world, (4 - (c.rot ?? 0)) % 4) };
    });
  }
  // Lift the whole subtree out of play first.
  for (const iid of all) Object.assign(s.cards[iid], { zone: 'removed' as const, x: undefined, y: undefined, master: undefined });
  const place = (iid: string, m: string, sd: Side) => {
    placeGroup(s, iid, controller, m, sd);
    for (const { child, local } of layout[iid]) {
      let want = rotate(local, s.cards[iid].rot ?? 0);
      const open = openArrows(s, iid);
      if (!open.includes(want)) want = open[0];
      if (want) place(child, iid, want);
      else {
        for (const lost of subtreeFromLayout(layout, child)) {
          const c = s.cards[lost];
          c.tokens = 0;
          if (overflow === 'discard') { c.zone = 'hand'; discardCard(s, lost); }
          else { c.zone = 'hand'; c.controller = undefined; player(s, prevController).hand.push(lost); }
        }
        log(s, `${cardName(s, child)} does not fit and is ${overflow === 'discard' ? 'discarded' : 'returned to hand'}.`);
      }
    }
  };
  place(root, master, side);
}

function subtreeFromLayout(layout: Record<string, { child: string }[]>, iid: string): string[] {
  const out = [iid];
  for (let i = 0; i < out.length; i++) out.push(...(layout[out[i]] ?? []).map((x) => x.child));
  return out;
}

export function destroyGroup(s: GameState, iid: string, by: string) {
  const c = s.cards[iid];
  const prev = c.controller ?? c.owner;
  // "Draw a Plot whenever you destroy …" abilities (checked before the card loses its changes).
  let draws = 0;
  for (const g of structureCards(s, by)) {
    for (const a of abilitiesOf(s, g)) if (a.kind === 'drawPlotOnDestroy' && (!a.match || matches(s, iid, a.match))) draws++;
  }
  // Puppets go back to the hand of the destroyed Group's controller.
  for (const p of puppets(s, iid)) {
    for (const g of subtree(s, p)) {
      const gc = s.cards[g];
      Object.assign(gc, { zone: 'hand', controller: undefined, master: undefined, x: undefined, y: undefined, tokens: 0 });
      player(s, prev).hand.push(g);
    }
  }
  // Linked Plots are discarded.
  for (const other of Object.values(s.cards)) if (other.linkedTo === iid) discardCard(s, other.iid);
  Object.assign(c, { zone: 'destroyed', controller: undefined, master: undefined, x: undefined, y: undefined, tokens: 0, mods: [], devastated: false });
  if (!player(s, by).destroyedCredit.includes(iid)) player(s, by).destroyedCredit.push(iid);
  if (draws) drawPlot(s, player(s, by), draws);
}

// ---------------------------------------------------------------- plots

export function plotContext(s: GameState): 'main' | 'attack' | 'roll' | 'plot' | 'endOfTurn' | 'none' {
  if (s.prompt) return 'none';
  if (s.window) return s.window.kind;
  if (s.phase === 'main') return 'main';
  return 'none';
}

export function checkPlot(s: GameState, playerId: string, play: PlotPlay, declaring = false): string | null {
  const p = player(s, playerId);
  if (!p.hand.includes(play.card)) return 'That card is not in your hand.';
  const d = def(s, play.card);
  if (d.type !== 'Plot') return 'Only Plot cards can be played this way.';
  const h = PLOTS[d.id];
  if (!h) return `${d.name} is not available in this version yet.`;
  const ctxKind = plotContext(s);
  const ctx = s.attack;
  const isActiveMain = ctxKind === 'main' && activePlayer(s).id === playerId;
  const t = h.timing;
  let ok = false;
  if (declaring) ok = t.includes('declare') || t.includes('anytime');
  else if (t.includes('anytime') && (isActiveMain || ctxKind === 'attack' || ctxKind === 'endOfTurn')) ok = true;
  if (!ok && !declaring) {
    if (t.includes('attack') && ctxKind === 'attack') ok = true;
    if (t.includes('roll') && ctxKind === 'roll') ok = true;
    if (t.includes('counter') && (ctxKind === 'plot' || (ctxKind === 'attack' && !!ctx?.plays.length))) ok = true;
    if (t.includes('instant') && !ctx && (isActiveMain || ctxKind === 'endOfTurn')) ok = true;
    // NWOs may not be played during an Instant or Privileged attack (R045).
    if (t.includes('nwo') && (isActiveMain || ctxKind === 'endOfTurn' || (ctxKind === 'attack' && !ctx?.instant && !ctx?.privileged))) ok = true;
  }
  if (!ok) return `${d.name} cannot be played right now.`;
  if (ctx && isPrivileged(ctx) && !participants(s).includes(playerId) && !t.includes('roll') && d.id !== 'interference' && d.id !== 'deep-agent') return 'Only the two players involved may act in a Privileged attack.';
  return h.check(s, playerId, play, ctx);
}

/** Play a Plot from hand. Attack plots are recorded on the attack; others open a counter window first. */
export function playPlot(s: GameState, playerId: string, play: PlotPlay, declaring = false) {
  const err = checkPlot(s, playerId, play, declaring);
  if (err) throw new RuleError(err);
  const d = def(s, play.card);
  const h = PLOTS[d.id];
  removeFromHand(s, play.card);
  s.cards[play.card].zone = 'table';
  s.cards[play.card].controller = playerId;
  const pp: PlayedPlot = { iid: play.card, player: playerId, play, effect: { t: 'none' } };
  log(s, `${player(s, playerId).name} plays ${d.name}${play.target && s.cards[play.target] ? ` on ${cardName(s, play.target)}` : ''}.`, playerId);
  const ctx = s.attack;
  if (s.window?.kind === 'plot') {
    // A counter to the Plot waiting to resolve.
    s.window.plays!.push(pp);
    pp.effect = h.apply(s, playerId, play) ?? pp.effect;
    s.window.passed = [playerId];
    return;
  }
  if (ctx && !h.timing.includes('instant')) {
    ctx.plays.push(pp);
    pp.effect = h.apply(s, playerId, play, ctx) ?? pp.effect;
    if (s.window) s.window.passed = [];
    return;
  }
  if (h.timing.includes('instant')) {
    h.apply(s, playerId, play); // starts an Instant attack (sets s.attack and opens a window)
    s.attack?.plays.push(pp);
    return;
  }
  // Non-attack Plot: give others a chance to counter it, then resolve.
  s.window = { kind: 'plot', passed: [playerId], plot: pp, plays: [pp], deadline: Date.now() + s.settings.responseHours * 3600_000 };
}

function resolvePendingPlot(s: GameState) {
  const w = s.window!;
  const pp = w.plot!;
  s.window = undefined;
  const d = def(s, pp.iid);
  if (!isCancelled(w.plays!, pp.iid)) {
    log(s, `${d.name} takes effect.`, pp.player);
    PLOTS[d.id].resolve?.(s, pp.player, pp.play);
    const c = s.cards[pp.iid];
    if (c.zone === 'table' && !c.linkedTo && d.subtype !== 'NWO') discardCard(s, pp.iid);
  } else {
    log(s, `${d.name} is cancelled.`, pp.player);
    PLOTS[d.id].refund?.(s, pp.player, pp.play);
    if (s.cards[pp.iid].zone === 'table') discardCard(s, pp.iid);
  }
  for (const q of w.plays!) if (q !== pp && s.cards[q.iid].zone === 'table') discardCard(s, q.iid);
  if (s.phase === 'endOfTurn') openWindow(s, 'endOfTurn');
}

// ---------------------------------------------------------------- aid / oppose

export function canAid(s: GameState, playerId: string, group: string): { ok: boolean; global: boolean; why?: string } {
  const ctx = s.attack;
  if (!ctx || s.window?.kind !== 'attack') return { ok: false, global: false, why: 'No attack in progress.' };
  const c = s.cards[group];
  if (c.zone !== 'structure' || c.controller !== playerId) return { ok: false, global: false, why: 'Not your Group.' };
  if (c.tokens < 1) return { ok: false, global: false, why: 'No Action token.' };
  if (ctx.instant) return { ok: false, global: false, why: 'Groups cannot join an Instant attack unless a card allows it.' };
  if (group === ctx.attacker || group === ctx.target) return { ok: false, global: false, why: 'Already part of this attack.' };
  if ([...ctx.aid, ...ctx.oppose].some((x) => x.iid === group)) return { ok: false, global: false, why: 'Already used in this attack.' };
  if (!participants(s).includes(playerId)) return { ok: false, global: false, why: 'This attack is Privileged.' };
  if (immuneTo(s, ctx.target, [group])) return { ok: false, global: false, why: 'The target is immune to this Group.' };
  const al = alignments(s, group), ta = alignments(s, ctx.target);
  const qualifies = ctx.type === 'control' ? al.some((a) => a !== 'Fanatic' && ta.includes(a)) : al.some((a) => ta.some((b) => (a === 'Fanatic' && b === 'Fanatic') || (a !== b && ({ Government: 'Corporate', Corporate: 'Government', Liberal: 'Conservative', Conservative: 'Liberal', Peaceful: 'Violent', Violent: 'Peaceful', Straight: 'Weird', Weird: 'Straight' } as Record<string, string>)[a] === b)));
  return { ok: true, global: !qualifies };
}

export function canOppose(s: GameState, playerId: string, group: string): { ok: boolean; global: boolean; self: boolean; why?: string } {
  const ctx = s.attack;
  if (!ctx || s.window?.kind !== 'attack') return { ok: false, global: false, self: false, why: 'No attack in progress.' };
  const c = s.cards[group];
  if (c.zone !== 'structure' || c.controller !== playerId) return { ok: false, global: false, self: false, why: 'Not your Group.' };
  if (c.tokens < 1) return { ok: false, global: false, self: false, why: 'No Action token.' };
  if (ctx.instant) return { ok: false, global: false, self: false, why: 'The target of an Instant attack cannot spend tokens.' };
  if (group === ctx.attacker) return { ok: false, global: false, self: false, why: 'The attacker cannot oppose.' };
  if (ctx.aid.some((x) => x.iid === group)) return { ok: false, global: false, self: false, why: 'Already aiding.' };
  if (!participants(s).includes(playerId)) return { ok: false, global: false, self: false, why: 'This attack is Privileged.' };
  const self = group === ctx.target;
  if (!self && ctx.oppose.some((x) => x.iid === group)) return { ok: false, global: false, self: false, why: 'Already used in this attack.' };
  const tc = s.cards[ctx.target];
  const related = self || tc.master === group || c.master === ctx.target;
  const shares = alignments(s, group).some((a) => a !== 'Fanatic' && alignments(s, ctx.target).includes(a));
  return { ok: true, global: !(related || shares), self };
}

// ---------------------------------------------------------------- main dispatcher

function assertPriority(s: GameState, playerId: string) {
  if (s.phase === 'gameOver') throw new RuleError('The game is over.');
  if (s.prompt && s.prompt.player !== playerId) throw new RuleError(`Waiting for ${player(s, s.prompt.player).name}.`);
}

/** Whose input the game is waiting for. */
export function waitingFor(s: GameState): string[] {
  if (s.phase === 'gameOver') return [];
  if (s.prompt) return [s.prompt.player];
  if (s.window) {
    const who = s.window.kind === 'plot' || s.window.kind === 'endOfTurn' || s.window.kind === 'roll' ? livePlayers(s).map((p) => p.id) : participants(s);
    return who.filter((id) => !s.window!.passed.includes(id));
  }
  return [activePlayer(s).id];
}

export function applyAction(state: GameState, playerId: string, action: Action): GameState {
  const s: GameState = structuredClone(state);
  assertPriority(s, playerId);
  const p = player(s, playerId);
  if (p.eliminated) throw new RuleError('You have been eliminated.');

  switch (action.type) {
    case 'setAutoPass':
      p.autoPass = action.value;
      break;

    case 'takeover': {
      if (s.prompt?.kind !== 'takeover' || s.prompt.player !== playerId) throw new RuleError('You cannot make an automatic takeover now.');
      if (!takeoverOptions(s, playerId).some((o) => o.card === action.card && o.onto === action.onto && o.side === action.side)) throw new RuleError('That placement is not legal.');
      placeGroup(s, action.card, playerId, action.onto, action.side);
      s.turnFlags.takeoverDone = true;
      log(s, `${p.name} takes over ${cardName(s, action.card)} automatically.`, playerId);
      finishBeginning(s);
      break;
    }
    case 'skipTakeover':
      if (s.prompt?.kind !== 'takeover' || s.prompt.player !== playerId) throw new RuleError('Nothing to skip.');
      finishBeginning(s);
      break;

    case 'attack':
      startAttack(s, playerId, action);
      break;

    case 'move': {
      if (s.phase !== 'main' || activePlayer(s).id !== playerId || s.window || s.attack) throw new RuleError('You can only move Groups in your own main phase.');
      const g = inst(s, action.group);
      if (g.controller !== playerId || def(s, action.group).type !== 'Group') throw new RuleError('You can only move your own Groups.');
      const dest = inst(s, action.onto);
      if (dest.controller !== playerId || subtree(s, action.group).includes(action.onto)) throw new RuleError('Choose an arrow elsewhere in your own Power Structure.');
      const ignore = new Set(subtree(s, action.group));
      if (!openArrows(s, action.onto, ignore).includes(action.side)) throw new RuleError('That arrow is not open.');
      const payers = [action.group, g.master, action.onto, p.illuminati];
      if (!payers.includes(action.payWith) || s.cards[action.payWith].tokens < 1) throw new RuleError('Pay with a token from the Group, its old or new master, or your Illuminati.');
      s.cards[action.payWith].tokens--;
      moveSubtree(s, action.group, playerId, action.onto, action.side, 'hand');
      log(s, `${p.name} moves ${cardName(s, action.group)}.`, playerId);
      break;
    }

    case 'playPlot':
      playPlot(s, playerId, action.play);
      break;

    case 'buyPlot': {
      const ill = action.payWith.length === 1 && action.payWith[0] === p.illuminati;
      const two = action.payWith.length === 2 && action.payWith.every((g) => g !== p.illuminati);
      if (!ill && !two) throw new RuleError('Buying a Plot costs 1 Illuminati token or 2 tokens from other Groups.');
      for (const g of action.payWith) {
        const c = inst(s, g);
        if (c.controller !== playerId || c.zone !== 'structure' || c.tokens < 1) throw new RuleError('Those Groups cannot pay.');
      }
      if (!p.plotDeck.length) throw new RuleError('Your Plot deck is empty.');
      for (const g of action.payWith) s.cards[g].tokens--;
      drawPlot(s, p);
      log(s, `${p.name} buys a Plot card.`, playerId);
      break;
    }

    case 'aid':
    case 'oppose': {
      const r = action.type === 'aid' ? canAid(s, playerId, action.group) : canOppose(s, playerId, action.group);
      if (!r.ok) throw new RuleError(r.why ?? 'Not allowed.');
      const ctx = s.attack!;
      s.cards[action.group].tokens--;
      const c: Contribution & { useGlobal?: boolean; selfDefense?: boolean } = {
        player: playerId, iid: action.group, amount: 0, label: cardName(s, action.group),
        useGlobal: r.global, selfDefense: 'self' in r && r.self === true,
      };
      (action.type === 'aid' ? ctx.aid : ctx.oppose).push(c);
      log(s, `${cardName(s, action.group)} ${action.type === 'aid' ? 'aids' : 'opposes'} the attack${r.global ? ' with Global Power' : ''}.`, playerId);
      s.window!.passed = [];
      break;
    }

    case 'pass': {
      const w = s.window;
      if (!w) throw new RuleError('There is nothing to pass on.');
      if (!waitingFor(s).includes(playerId)) throw new RuleError('You have already passed.');
      w.passed.push(playerId);
      break;
    }

    case 'endTurn': {
      if (s.phase !== 'main' || activePlayer(s).id !== playerId || s.window || s.attack || s.prompt) throw new RuleError('You cannot end your turn right now.');
      s.phase = 'endOfTurn';
      log(s, `${p.name} ends the turn.`, playerId);
      openWindow(s, 'endOfTurn');
      s.window!.passed = [playerId];
      break;
    }

    case 'discard': {
      if (s.prompt?.kind !== 'discardToLimit' || s.prompt.player !== playerId) throw new RuleError('You do not need to discard.');
      const plots = plotsInHand(s, playerId);
      if (!action.cards.every((c) => plots.includes(c))) throw new RuleError('Discard Plot cards from your hand.');
      if (plots.length - action.cards.length > handLimit(s, playerId)) throw new RuleError(`Discard down to ${handLimit(s, playerId)} Plots.`);
      for (const c of action.cards) discardCard(s, c);
      s.prompt = undefined;
      endTurnCleanup(s);
      break;
    }
  }
  settleWindows(s);
  s.version++;
  return s;
}

/** Close any window everyone has passed on, and advance the game. */
function settleWindows(s: GameState) {
  for (let guard = 0; guard < 50; guard++) {
    const w = s.window;
    if (!w || s.phase === 'gameOver') return;
    if (waitingFor(s).length) return;
    if (w.kind === 'attack') rollAttack(s);
    else if (w.kind === 'roll') finishAttack(s);
    else if (w.kind === 'plot') resolvePendingPlot(s);
    else if (w.kind === 'endOfTurn') { s.window = undefined; endTurnCleanup(s); }
  }
}

// Exposed for plot handlers.
export function startInstantAttack(s: GameState, playerId: string, opts: {
  plot: string; target: string; power: number; disaster?: AttackCtx['disaster']; assassination?: boolean; helper?: string;
}) {
  const ctx: AttackCtx = {
    id: ++s.attackCounter, type: 'destroy', instant: true, instantCard: opts.plot, instantPower: opts.power,
    disaster: opts.disaster, assassination: opts.assassination, attackerPlayer: playerId,
    target: opts.target, targetPlayer: controllerOf(s, opts.target), fromHand: false, privileged: false,
    aid: [], oppose: [], attackBonus: [], defenseBonus: [], plays: [],
  };
  if (opts.helper) {
    s.cards[opts.helper].tokens--;
    ctx.aid.push({ player: playerId, iid: opts.helper, amount: 0, label: cardName(s, opts.helper) });
  }
  if (opts.disaster && s.cards[opts.target].tokens > 0) s.cards[opts.target].tokens--; // R036
  s.attack = ctx;
  openWindow(s, 'attack');
}

export { OPPOSITE_SIDE, occupied };
