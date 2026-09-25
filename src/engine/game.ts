// The Elitists War rules engine. Pure state transitions: applyAction(state, player, action)
// validates the move against the rules, mutates a copy of the state and returns it.
import type {
  Action, Alignment, AttackCtx, CardInstance, Contribution, GameSettings, GameState, PlayedPlot,
  PlayerState, PlotPlay, Prompt, Side,
} from './types';
import { RuleError } from './types';
import { CARDS, cardName, def, inst } from './cards';
import { roll2d6, shuffle } from './rng';
import {
  DELTA, OPPOSITE_SIDE, SIDES, attachRect, depth, ensureLayout, LAYOUT_VERSION, occupied, openArrows, sideOf, puppets, rotate, rotationFor, structureCards, subtree,
} from './geometry';
import { abilitiesOf, attackingGroups, matches } from './abilities';
import { alignmentPairs, alignments, attributes, globalPower, power, resistance } from './stats';
import { NWO_EFFECTS } from './nwo';
import { PLOTS, GOALS } from './plotTypes';
import { HOOKS, CHOICES, EVENT_ABILITY_CARDS, abilitiesDisabled, activeHookCards, anyHook, fireHooks, goalCheck, hooksOf, sumHooks, type AbilityParams, type ActivatedAbility } from './hooks';
import type { AnnouncedKind, Choice, GameEvent, PlotEffect } from './types';

// ---------------------------------------------------------------- setup

export interface DeckList { illuminati: string; plots: string[]; groups: string[] }
export interface NewPlayer { id: string; name: string; isAI: boolean; deck: DeckList }

export const DEFAULT_SETTINGS: GameSettings = { basicGoal: 12, responseHours: 24, houseRules: [] };

export function createGame(opts: { id?: string; seed?: number; players: NewPlayer[]; settings?: Partial<GameSettings>; chooseLeads?: boolean }): GameState {
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
    s.layout = LAYOUT_VERSION;
    const player: PlayerState = {
      id: p.id, name: p.name, isAI: p.isAI, illuminati: ill,
      plotDeck: shuffle(s, p.deck.plots.map((c) => mk(c, 'plotDeck'))),
      groupDeck: p.deck.groups.map((c) => mk(c, 'groupDeck')),
      hand: [], discard: [], destroyedCredit: [], turnsTaken: 0, eliminated: false, autoPass: false,
    };
    s.players.push(player);
    for (let i = 0; i < 3; i++) drawPlot(s, player);
  }
  // Lead Group (R025): each player secretly picks one Group from his deck.
  s.setup = { picks: {}, banned: [], setAside: [] };
  if (opts.chooseLeads) s.phase = 'setup';
  else for (const p of s.players) s.setup.picks[p.id] = bestLead(s, p.id);
  promptNextLead(s);
  advance(s);
  return s;
}

export function leadOptions(s: GameState, playerId: string): string[] {
  const banned = new Set(s.setup?.banned ?? []);
  return player(s, playerId).groupDeck.filter((iid) => def(s, iid).type === 'Group' && !banned.has(s.cards[iid].cardId));
}
export const bestLead = (s: GameState, playerId: string) => leadOptions(s, playerId).sort((a, b) => leadScore(s, b) - leadScore(s, a))[0];

function promptNextLead(s: GameState) {
  const st = s.setup!;
  const next = s.players.find((p) => !st.picks[p.id] && leadOptions(s, p.id).length);
  if (next) {
    if (s.phase !== 'setup') { st.picks[next.id] = bestLead(s, next.id); promptNextLead(s); return; }
    s.prompt = { player: next.id, kind: 'chooseLead' };
    return;
  }
  s.prompt = undefined;
  // Players who picked the same Group set them aside and pick again (R025/R043).
  const ids = Object.values(st.picks).filter((x): x is string => !!x).map((iid) => s.cards[iid].cardId);
  const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dup.length) {
    for (const p of s.players) {
      const pick = st.picks[p.id];
      if (pick && dup.includes(s.cards[pick].cardId)) {
        p.groupDeck = p.groupDeck.filter((x) => x !== pick);
        st.setAside.push(pick);
        st.picks[p.id] = undefined;
        log(s, `${p.name} picked the same lead Group as a rival (${cardName(s, pick)}): both set it aside and pick again.`, p.id);
      }
    }
    st.banned.push(...dup);
    promptNextLead(s);
    return;
  }
  completeSetup(s);
}

function completeSetup(s: GameState) {
  const st = s.setup!;
  s.phase = 'beginning';
  for (const p of s.players) {
    const lead = st.picks[p.id];
    if (lead) {
      p.groupDeck = p.groupDeck.filter((x) => x !== lead);
      placeGroup(s, lead, p.id, p.illuminati, 'BOTTOM');
      log(s, `${p.name} leads with ${cardName(s, lead)}.`, p.id);
    }
    shuffle(s, p.groupDeck);
    for (let i = 0; i < 6; i++) drawGroup(s, p);
  }
  // Set-aside duplicates go back into their owners' decks after the draw.
  for (const iid of st.setAside) {
    const p = player(s, s.cards[iid].owner);
    p.groupDeck.push(iid);
    shuffle(s, p.groupDeck);
  }
  s.setup = undefined;
  // Highest 2d6 goes first; tied highest rollers roll again.
  let rolls = s.players.map((p) => ({ p, r: roll2d6(s).reduce((a, b) => a + b) }));
  for (;;) {
    rolls.sort((a, b) => b.r - a.r);
    const tied = rolls.filter((x) => x.r === rolls[0].r);
    if (tied.length === 1) break;
    rolls = tied.map((x) => ({ p: x.p, r: roll2d6(s).reduce((a, b) => a + b) }));
  }
  s.active = s.players.indexOf(rolls[0].p);
  s.firstPlayer = s.active;
  log(s, `${rolls[0].p.name} wins the roll to go first.`);
  beginTurn(s);
}

function leadScore(s: GameState, iid: string) {
  const d = def(s, iid);
  return (d.arrowsOut?.length ?? 0) * 10 + (d.power ?? 0);
}

// ---------------------------------------------------------------- helpers

export function log(s: GameState, text: string, player?: string) {
  // The offline game calls the human player "You": keep possessives readable.
  text = text.replace(/\bYou's\b/g, 'your').replace(/^your\b/, 'Your');
  s.log.push({ turn: s.turn, player, text });
}
export const player = (s: GameState, id: string) => {
  const p = s.players.find((x) => x.id === id);
  if (!p) throw new RuleError(`No player ${id}`);
  return p;
};
export const activePlayer = (s: GameState) => s.players[s.active];
export const livePlayers = (s: GameState) => s.players.filter((p) => !p.eliminated);

/** Draw from the top of a deck (cards may skip the draw or take the bottom card instead). Returns the cards drawn. */
function drawFrom(s: GameState, p: PlayerState, deck: 'plot' | 'group', n: number): string[] {
  const out: string[] = [];
  const pile = deck === 'plot' ? p.plotDeck : p.groupDeck;
  for (let i = 0; i < n; i++) {
    if (deck === 'plot' && s.turnFlags?.noPlotDraws?.includes(p.id)) break;
    if (s.turnFlags?.extraTurn && s.players[s.active]?.id === p.id) break; // no draws during an extra turn (Seize the Time)
    let how: 'skip' | 'bottom' | undefined;
    for (const self of activeHookCards(s)) { how = HOOKS[s.cards[self].cardId].beforeDraw?.(s, self, p.id, deck) ?? how; if (how) break; }
    if (how === 'skip') { log(s, `${p.name}'s draw is cancelled.`, p.id); continue; }
    const c = how === 'bottom' ? pile.pop() : pile.shift();
    if (!c) break;
    s.cards[c].zone = 'hand';
    p.hand.push(c);
    out.push(c);
    fireHooks(s, (h, self) => h.onDraw?.(s, self, p.id, deck, c));
  }
  return out;
}
export function drawPlot(s: GameState, p: PlayerState, n = 1): string[] { return drawFrom(s, p, 'plot', n); }
export function drawGroup(s: GameState, p: PlayerState): string[] { return drawFrom(s, p, 'group', 1); }

// ---------------------------------------------------------------- events, choices, private information

/**
 * Can anybody respond to this event: a Plot in hand with timing 'event' for it, or an activated ability
 * of a card in play with timing 'event' for it whose `listens` says it could answer?
 */
function hasListeners(s: GameState, e: GameEvent): boolean {
  const plot = livePlayers(s).some((p) => p.hand.some((iid) => {
    const h = PLOTS[s.cards[iid].cardId];
    return !!h && h.timing.includes('event') && (!h.events || h.events.includes(e.type));
  }));
  if (plot) return true;
  if (!EVENT_ABILITY_CARDS.size) return false;
  for (const c of Object.values(s.cards)) {
    if (!EVENT_ABILITY_CARDS.has(c.cardId) || (c.zone !== 'structure' && c.zone !== 'resources') || !c.controller) continue;
    if (player(s, c.controller).eliminated || abilitiesDisabled(s, c.iid)) continue;
    for (const ab of HOOKS[c.cardId].actions ?? []) {
      if (!ab.timing.includes('event') || !(ab.events ?? ['action']).includes(e.type)) continue;
      if (!ab.listens || ab.listens(s, c.controller, c.iid, e)) return true;
    }
  }
  return false;
}

/**
 * Something happened. Card triggers run at once; if a player holds a Plot that can respond, a
 * response window opens as soon as the current action is finished. `then` names what the game
 * does once that window closes (or straight away if nobody can respond).
 */
export function raiseEvent(s: GameState, e: GameEvent, then?: string) {
  fireHooks(s, (h, self) => h.onEvent?.(s, self, e));
  if (hasListeners(s, e)) { (s.events ??= []).push({ ...e, data: { ...e.data, then } }); return; }
  if (then) runContinuation(s, then, e);
}

function runContinuation(s: GameState, then: string, e?: GameEvent) {
  if (s.phase === 'gameOver') return;
  if (then === 'draws') turnDraws(s);
  else if (then === 'takeoverPrompt') takeoverStep(s);
  else if (then === 'finishBeginning') finishBeginning(s);
  else if (then === 'resolveAction' && e) resolveAction(s, e);
}

// ---------------------------------------------------------------- announced actions (R009/R010)
//
// Any player may respond to an announced action, and a cancelled action never happened while its
// costs stay paid (R009). Actions outside an attack (moving a Group, an activated ability used in your
// main phase, Relief, bringing a Resource into play, linking a Resource, the Illuminati's Group draw)
// are therefore announced first: the costs are paid, an 'action' event is raised, and the action itself
// is carried out by that event's continuation ('resolveAction') once its response window closes, unless
// it was cancelled. When nobody can respond, raiseEvent runs the continuation at once, so the game plays
// exactly as if the action had been done directly. Buying Plots is not an action and cannot be
// cancelled (R027, R009), so it is never announced.

/** Announce an action; `actors` are the Groups (or other cards) whose token pays for it. */
function announce(s: GameState, playerId: string, kind: AnnouncedKind, action: Action, actors: string[], card?: string) {
  raiseEvent(s, { type: 'action', player: playerId, card: card ?? actors[0], cards: actors, data: { kind, action } }, 'resolveAction');
}

/** Actions are announced only when nothing else is going on; in other windows they happen at once. */
function canAnnounce(s: GameState) {
  return !s.window && !s.attack && !s.prompt && s.phase === 'main';
}

/** Set while a Plot played in response to an announced action resolves (its window is closed then). */
let respondingTo: GameEvent | undefined;

/** The action waiting for responses: the open 'action' event, or the one a responding Plot resolves for. */
export function announcedAction(s: GameState): GameEvent | undefined {
  const e = s.window?.kind === 'event' ? s.window.event : respondingTo;
  return e?.type === 'action' ? e : undefined;
}

/** Has this acting card's action been cancelled (or, with no card, the whole action)? */
export function actionCancelled(e: GameEvent, card?: string): boolean {
  const rs = e.responses ?? [];
  return rs.some((r) => !isCancelled(rs, r.iid) && (r.effect.t === 'fail' || (!!card && r.effect.t === 'cancelGroup' && r.effect.group === card)));
}

/** Cards acting in an announced action: its uncancelled actors, and cards that answered it with a still-live ability. */
export function announcedActors(e: GameEvent): string[] {
  const rs = e.responses ?? [];
  const actors = (e.cards ?? []).filter((c) => !actionCancelled(e, c));
  const responders = rs.filter((r) => r.ability && !isCancelled(rs, r.iid)).map((r) => r.ability!);
  return [...new Set([...actors, ...responders])];
}

/**
 * The effect that cancels `card`'s action in an announced action: its own action, or the latest
 * ability it used in response (so a cancel can itself be cancelled, R010).
 */
export function cancelActorEffect(e: GameEvent, card: string): PlotEffect | undefined {
  if ((e.cards ?? []).includes(card) && !actionCancelled(e, card)) return { t: 'cancelGroup', group: card };
  const rs = e.responses ?? [];
  const r = [...rs].reverse().find((x) => x.ability === card && !isCancelled(rs, x.iid));
  return r ? { t: 'cancelPlot', target: r.iid } : undefined;
}

/**
 * Record a response to the announced action. The engine records abilities used in the window by
 * itself; a Plot answering the action calls this from its `resolve`. `{t:'fail'}` cancels it all.
 */
export function respondToAction(s: GameState, playerId: string, source: string, effect: PlotEffect, ability = false) {
  const e = announcedAction(s);
  if (!e) return;
  (e.responses ??= []).push({ iid: `${ability ? 'ability' : 'response'}:${source}:${s.version}:${e.responses.length}`, player: playerId, play: { card: source }, effect, ability: ability ? source : undefined });
}

/**
 * The out-of-attack half of "spend this card's action to cancel an action of a [matching] Group": it
 * answers a rival's announced action whose acting Group matches `ok` (or a card that answered it).
 * Card scripts combine it with their attack half; the ability needs timing 'event'.
 */
export function announcedCancel(ok: (s: GameState, g: string) => boolean): Pick<ActivatedAbility, 'listens' | 'check' | 'apply'> {
  const isGroupCard = (s: GameState, g: string) => ['Group', 'Illuminati'].includes(def(s, g).type);
  const ready = (s: GameState, self: string) => s.cards[self].tokens > 0 && !tokenBarred(s, self);
  return {
    listens: (s, pl, self, e) => e.type === 'action' && !!e.player && e.player !== pl && !protectedPlayer(s, pl, e.player) && ready(s, self) &&
      announcedActors(e).some((g) => g !== self && isGroupCard(s, g) && ok(s, g)),
    check(s, pl, self, p) {
      const e = announcedAction(s);
      if (!e) return 'Use this right after a rival announces an action.';
      const t = p.target;
      if (!t || t === self || !announcedActors(e).includes(t) || !isGroupCard(s, t)) return 'Choose another Group that is taking an action right now.';
      const owner = s.cards[t].controller ?? e.player;
      if (owner === pl) return 'Choose a rival\'s Group.';
      if (protectedPlayer(s, pl, owner)) return 'That player has not finished a first turn yet.';
      if (!ok(s, t)) return `${cardName(s, t)}'s action cannot be cancelled by this card.`;
      return null;
    },
    apply: (s, _pl, _self, p) => cancelActorEffect(announcedAction(s)!, p.target!) ?? { t: 'none' },
  };
}

/** What an announced action would do, as a phrase after "wants to" / "does not". */
export function actionSummary(s: GameState, e: GameEvent): string {
  const a = e.data?.action as Action | undefined;
  const n = (iid?: string) => (iid && s.cards[iid] ? cardName(s, iid) : 'a card');
  switch (a?.type) {
    case 'move': return `move ${n(a.group)} under ${n(a.onto)}`;
    case 'useAbility': {
      const ab = HOOKS[s.cards[a.card].cardId]?.actions?.find((x) => x.id === a.ability);
      const tgt = a.params?.target && s.cards[a.params.target] && s.cards[a.params.target].zone !== 'hand' ? ` (${n(a.params.target)})` : '';
      return `use ${n(a.card)}: ${(ab?.label ?? a.ability).replace(/^./, (x) => x.toLowerCase())}${tgt}`;
    }
    case 'relief': return `send Relief to ${n(a.place)}`;
    case 'playResource': return `bring ${n(a.card)} into play`;
    case 'link': return `link ${n(a.resource)} to ${n(a.to)}`;
    case 'drawGroup': return 'draw a Group card with the Illuminati\'s action';
    default: return 'take an action';
  }
}

function doMove(s: GameState, pl: string, a: Extract<Action, { type: 'move' }>) {
  const g = s.cards[a.group], dest = s.cards[a.onto];
  const ok = g.zone === 'structure' && g.controller === pl && dest.zone === 'structure' && dest.controller === pl &&
    !subtree(s, a.group).includes(a.onto) && openArrows(s, a.onto, new Set(subtree(s, a.group))).includes(a.side);
  if (!ok) { log(s, `${cardName(s, a.group)} can no longer be moved there.`, pl); return; }
  moveSubtree(s, a.group, pl, a.onto, a.side, 'hand');
  // Moving under a Devastated Place costs the moved Groups their tokens (R037).
  for (const g2 of subtree(s, a.group)) if (tokenBarred(s, g2)) s.cards[g2].tokens = 0;
  log(s, `${player(s, pl).name} moves ${cardName(s, a.group)}.`, pl);
}

function doLink(s: GameState, pl: string, resource: string, to: string) {
  const r = s.cards[resource];
  if (r.zone !== 'resources' || r.controller !== pl || s.cards[to].zone !== 'structure' || s.cards[to].controller !== pl) return;
  r.linkedTo = to;
  r.linkMovedTurn = s.turn;
  log(s, `${player(s, pl).name} links ${cardName(s, resource)} to ${cardName(s, to)}.`, pl);
}

function doDrawGroup(s: GameState, p: PlayerState) {
  drawGroup(s, p);
  log(s, `${p.name} uses the Illuminati's action to draw a Group card.`, p.id);
}

function doRelief(s: GameState, pl: string, place: string, payWith: string[], announced: boolean) {
  s.cards[place].devastated = false;
  log(s, `${player(s, pl).name} sends Relief: ${cardName(s, place)} is no longer Devastated.`, pl);
  raiseEvent(s, { type: 'relief', card: place, player: pl, cards: payWith, data: announced ? { announced: true } : undefined });
}

/** The response window of an announced action has closed: carry it out unless it was cancelled. */
function resolveAction(s: GameState, e: GameEvent) {
  const a = e.data?.action as Action;
  const pl = e.player!;
  const p = player(s, pl);
  if (p.eliminated) return;
  const actors = e.cards ?? [];
  const whole = actionCancelled(e);
  const cancelled = actors.filter((c) => actionCancelled(e, c));
  const names = (l: string[]) => l.map((c) => cardName(s, c)).join(', ');
  if (a.type === 'relief' && !whole) {
    // Groups sending Relief together: a cancelled one adds nothing, but the others may still be enough.
    const place = s.cards[a.place];
    if (place.zone !== 'structure' || !place.devastated) return;
    const live = a.payWith.filter((g) => !cancelled.includes(g) && s.cards[g].zone === 'structure' && s.cards[g].controller === pl);
    const need = 3 * (def(s, a.place).power ?? 0);
    if (cancelled.length) {
      if (live.reduce((n, g) => n + power(s, g), 0) < need) {
        log(s, `${names(cancelled)}: action cancelled. The Relief falls short and ${cardName(s, a.place)} stays Devastated.`, pl);
        return;
      }
      log(s, `${names(cancelled)}: action cancelled, but the other Groups still send enough Relief.`, pl);
    }
    doRelief(s, pl, a.place, a.payWith, true);
    return;
  }
  if (whole || (actors.length && cancelled.length === actors.length)) {
    // R009: the action never happened. Its costs stay paid; a once-per-turn action may be tried again.
    log(s, `${actors.length ? `${names(actors)}: action cancelled` : 'Action cancelled'}, so ${p.name} does not ${actionSummary(s, e)}.`, pl);
    if (a.type === 'playResource') s.turnFlags.resourcePlayed = false;
    if (a.type === 'drawGroup') s.turnFlags.illumGroupDraw = false;
    if (a.type === 'useAbility' && s.cards[a.card]?.abilityTurns) delete s.cards[a.card].abilityTurns![a.ability];
    return;
  }
  switch (a.type) {
    case 'move': doMove(s, pl, a); break;
    case 'useAbility': {
      const c = s.cards[a.card];
      const ab = HOOKS[c.cardId]?.actions?.find((x) => x.id === a.ability);
      if (!ab || (c.zone !== 'structure' && c.zone !== 'resources') || c.controller !== pl || abilitiesDisabled(s, a.card)) {
        log(s, `${cardName(s, a.card)} is no longer able to use that ability.`, pl);
        break;
      }
      ab.apply(s, pl, a.card, a.params ?? {}, s.attack);
      break;
    }
    case 'playResource':
      if (p.hand.includes(a.card) && canEnterPlay(s, a.card, pl)) playResourceCard(s, a.card, pl);
      break;
    case 'link': doLink(s, pl, a.resource, a.to); break;
    case 'drawGroup': doDrawGroup(s, p); break;
  }
}

/** Open the next queued event window, if the game is free to do so. */
function openNextEvent(s: GameState): boolean {
  if (s.window || s.prompt || s.attack || !s.events?.length || s.phase === 'gameOver') return false;
  const e = s.events.shift()!;
  s.window = { kind: 'event', event: e, passed: [], deadline: Date.now() + s.settings.responseHours * 3600_000 };
  return true;
}

/** Ask one player to choose; queued behind any decision already being made. */
export function askChoice(s: GameState, playerId: string, choice: Choice) {
  const p: Prompt = { player: playerId, kind: 'choose', choice };
  if (s.prompt) (s.promptQueue ??= []).push(p);
  else s.prompt = p;
}

/** Let one player see cards privately (e.g. a rival's hidden Plots). Others only learn that he looked. */
export function revealTo(s: GameState, playerId: string, cards: string[], why: string) {
  const p = player(s, playerId);
  p.known = [...new Set([...(p.known ?? []), ...cards])];
  s.log.push({ turn: s.turn, player: playerId, to: playerId, text: `${why}: ${cards.map((c) => cardName(s, c)).join(', ') || 'nothing'}.` });
}

function removeFromHand(s: GameState, iid: string) {
  for (const p of s.players) p.hand = p.hand.filter((x) => x !== iid);
}

/** Is this Resource in play protected from being discarded or targeted by rivals (Count Dracula)? */
export function resourceProtected(s: GameState, iid: string | undefined): boolean {
  return !!iid && s.cards[iid]?.zone === 'resources' && anyHook(s, (h, self) => !!h.protectResource?.(s, self, iid));
}

/** First reason a card in play gives to forbid using `card` against `target`. */
function forbiddenUse(s: GameState, playerId: string, card: string, target: string | undefined, ctx?: AttackCtx): string | null {
  for (const self of activeHookCards(s)) {
    const why = HOOKS[s.cards[self].cardId].forbidUse?.(s, self, playerId, card, target, ctx);
    if (why) return why;
  }
  if (target && resourceProtected(s, target) && s.cards[target].controller !== playerId) return `${cardName(s, target)} is protected and cannot be affected.`;
  return null;
}

export function discardCard(s: GameState, iid: string) {
  const c = s.cards[iid];
  if (resourceProtected(s, iid)) { log(s, `${cardName(s, iid)} is protected and stays in play.`); return; }
  const wasPlot = def(s, iid).type === 'Plot' && (c.zone === 'hand' || c.zone === 'table');
  // Groups and Resources discarded from hand or from play are announced too (And STAY Dead!, Cover of Darkness).
  const wasCard = def(s, iid).type !== 'Plot' && def(s, iid).type !== 'Illuminati' && (c.zone === 'hand' || c.zone === 'structure' || c.zone === 'resources');
  const from = c.zone, by = c.controller;
  removeFromHand(s, iid);
  c.zone = 'discard';
  c.controller = undefined; c.master = undefined; c.linkedTo = undefined;
  c.tokens = 0;
  player(s, c.owner).discard.push(iid);
  if ((wasPlot || wasCard) && s.turn > 0) raiseEvent(s, { type: 'discarded', card: iid, player: c.owner, by, data: { from } });
}

export function controllerOf(s: GameState, iid: string): string | undefined {
  const c = s.cards[iid];
  return c.zone === 'structure' ? c.controller : undefined;
}

export function inPlayIds(s: GameState): Set<string> {
  return new Set(Object.values(s.cards).filter((c) => c.zone === 'structure').map((c) => c.cardId));
}

/** Can this Group card be put into play (not a duplicate of one in play or destroyed)? */
export function canEnterPlay(s: GameState, iid: string, playerId?: string): boolean {
  const cardId = s.cards[iid].cardId;
  if (def(s, iid).type === 'Resource') {
    // Unique Resources: one in play, never again once destroyed. "One per player" limits (errata).
    const u = def(s, iid).uniqueness ?? '';
    if (/one per player/i.test(u)) return !Object.values(s.cards).some((c) => c.cardId === cardId && c.zone === 'resources' && c.controller === playerId);
    if (!isUnique(s, iid)) return true;
    // Some Unique Resources may come back once destroyed (Hidden City).
    const again = !!HOOKS[cardId]?.replaceableWhenDestroyed;
    return !Object.values(s.cards).some((c) => c.cardId === cardId && c.iid !== iid && (c.zone === 'resources' || (c.zone === 'destroyed' && !again)));
  }
  if (HOOKS[cardId]?.multipleCopies) return s.cards[iid].zone !== 'structure' && s.cards[iid].zone !== 'destroyed';
  return !Object.values(s.cards).some((c) => c.cardId === cardId && c.iid !== iid && (c.zone === 'structure' || c.zone === 'destroyed'));
}

/** Put a Group into a structure on `side` of `master`. */
export function placeGroup(s: GameState, iid: string, controller: string, master: string, side: Side) {
  const c = s.cards[iid];
  const d = def(s, iid);
  removeFromHand(s, iid);
  const r = attachRect(s, master, side);
  Object.assign(c, {
    zone: 'structure', controller, master, side, x: r.x, y: r.y,
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
  if (anyHook(s, (h, self) => !!h.noTokens?.(s, self, iid))) return true;
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

function beginTurn(s: GameState, extraTurn = false) {
  s.turn++;
  s.phase = 'beginning';
  s.turnFlags = { takeoverDone: false, resourcePlayed: false, illumGroupDraw: false, bavarianPrivilege: false, extraTurn: extraTurn || undefined };
  const p = activePlayer(s);
  // Expire "until the start of your next turn" effects of this player.
  for (const c of Object.values(s.cards)) c.mods = c.mods.filter((m) => !(m.until === 'startOfOwnerTurn' && c.controller === p.id));
  log(s, `— Turn ${s.turn} (round ${s.round}): ${p.name}${extraTurn ? ' (extra turn)' : ''} —`, p.id);
  // Cards played "at the start of a turn" (Unlucky 13, Seize the Time …) get their window first.
  raiseEvent(s, { type: 'turnStart', player: p.id }, 'draws');
}

/** R001 steps 1–2: Plot draw (plus extras) and Group draw, then the automatic takeover step. */
function turnDraws(s: GameState) {
  // Someone seized the time: their extra turn comes before this player's (Seize the Time).
  if (s.extraTurnFor) {
    const who = s.extraTurnFor;
    s.extraTurnFor = undefined;
    s.resumeSeat = s.active;
    s.turn--; // the interrupted turn has not really started
    s.active = s.players.findIndex((x) => x.id === who);
    beginTurn(s, true);
    return;
  }
  const p = activePlayer(s);
  const drawn: string[] = [];
  if (!s.turnFlags.extraTurn && !s.turnFlags.noDraws) {
    let extra = 0;
    for (const iid of structureCards(s, p.id)) for (const a of abilitiesOf(s, iid)) if (a.kind === 'extraPlotDraw') extra += a.value;
    extra += sumHooks(s, (h, self) => (controllerOf2(s, self) === p.id ? h.extraPlotDraws?.(s, self) : 0));
    drawn.push(...drawPlot(s, p, 1 + extra));
    drawn.push(...drawGroup(s, p));
    const plots = drawn.filter((c) => def(s, c).type === 'Plot').length;
    s.log.push({ turn: s.turn, player: p.id, info: true, text: `Start of turn: ${p.name} draws ${plots} Plot card${plots === 1 ? '' : 's'} and ${drawn.length - plots} Group card${drawn.length - plots === 1 ? '' : 's'}.` });
    if (drawn.length) s.log.push({ turn: s.turn, player: p.id, to: p.id, info: true, text: `You drew: ${drawn.map((c) => cardName(s, c)).join(', ')}.` });
  }
  fireHooks(s, (h, self) => { if (controllerOf2(s, self) === p.id) h.onTurnStart?.(s, self); });
  if (s.phase === 'gameOver') return;
  raiseEvent(s, { type: 'drawn', player: p.id, cards: drawn }, 'takeoverPrompt');
}

function takeoverStep(s: GameState) {
  const p = activePlayer(s);
  if (!s.turnFlags.noTakeover && !s.turnFlags.restricted && !s.turnFlags.extraTurn && takeoverOptions(s, p.id).length) {
    // A card's question asked during the draws (Crystal Skull) is answered first.
    const pr: Prompt = { player: p.id, kind: 'takeover' };
    if (s.prompt) (s.promptQueue ??= []).push(pr); else s.prompt = pr;
  } else finishBeginning(s);
}

function finishBeginning(s: GameState) {
  // A card undid the automatic takeover (Botched Contact): the player chooses again first.
  if (s.turnFlags.redoTakeover) { s.turnFlags.redoTakeover = undefined; takeoverStep(s); return; }
  const p = activePlayer(s);
  // Close the takeover prompt, but keep any card's question still waiting for an answer.
  if (!s.prompt || s.prompt.kind === 'takeover') s.prompt = s.promptQueue?.shift();
  for (const iid of structureCards(s, p.id)) {
    const d = def(s, iid);
    if (d.type === 'Illuminati') {
      let n = 1 + abilitiesOf(s, iid).filter((a) => a.kind === 'extraIlluminatiToken').reduce((k, a) => k + (a as { value: number }).value, 0);
      if (s.players.length === 2 && s.turnFlags.takeoverDone) n -= 1; // two-player rule (R023)
      if (s.turnFlags.extraTurn) n = 0; // extra turn: no new Illuminati token
      s.cards[iid].tokens = Math.max(s.cards[iid].tokens, n);
    } else if (s.cards[iid].capturedTurn !== s.turn) {
      giveToken(s, iid);
    }
    // Card-granted extra tokens are added at this step (R001 step 4).
    const more = sumHooks(s, (h, self) => h.extraTokens?.(s, self, iid));
    if (more > 0 && !tokenBarred(s, iid) && s.cards[iid].capturedTurn !== s.turn) s.cards[iid].tokens += more;
  }
  // Resources that have their own action get a token too.
  for (const r of resourcesOf(s, p.id)) if (HOOKS[s.cards[r].cardId]?.hasAction && s.cards[r].tokens === 0) s.cards[r].tokens = 1;
  const twoPlayerRule = s.players.length === 2 && s.turnFlags.takeoverDone && !s.turnFlags.extraTurn;
  s.log.push({ turn: s.turn, player: p.id, info: true, text: `${p.name}'s Groups get their Action tokens${twoPlayerRule ? ' (two-player rule: no Illuminati token this turn after an automatic takeover)' : ''}. Main phase.` });
  s.phase = 'main';
}

export function takeoverOptions(s: GameState, playerId: string): { card: string; onto: string; side: Side }[] {
  const out: { card: string; onto: string; side: Side }[] = [];
  const p = player(s, playerId);
  const spots = structureCards(s, playerId).flatMap((m) => openArrows(s, m).map((side) => ({ onto: m, side })));
  for (const card of p.hand) {
    if (s.cards[card].data?.noTakeoverTurn === s.turn) continue; // returned by Botched Contact
    if (anyHook(s, (h, self) => !!h.forbidAttack?.(s, self, undefined, card, 'takeover', playerId))) continue;
    if (def(s, card).type === 'Resource' && canEnterPlay(s, card, playerId)) out.push({ card, onto: p.illuminati, side: 'TOP' });
    if (def(s, card).type !== 'Group' || !canEnterPlay(s, card)) continue;
    for (const spot of spots) out.push({ card, ...spot });
  }
  return out;
}

// ---------------------------------------------------------------- resources (R041)

export function resourcesOf(s: GameState, playerId: string): string[] {
  return Object.values(s.cards).filter((c) => c.zone === 'resources' && c.controller === playerId).map((c) => c.iid);
}
export const isUnique = (s: GameState, iid: string) => /\bUnique\b/.test(def(s, iid).uniqueness ?? '') || /one per player/i.test(def(s, iid).uniqueness ?? '');

/** Controller of any in-play card (Group, Resource, or a linked Plot on the table). */
export function controllerOf2(s: GameState, iid: string): string | undefined {
  const c = s.cards[iid];
  return c.zone === 'structure' || c.zone === 'resources' || c.zone === 'table' ? c.controller : undefined;
}

/** Put a Resource into play beside its owner's Power Structure, linked to his Illuminati. */
export function playResourceCard(s: GameState, iid: string, controller: string) {
  removeFromHand(s, iid);
  Object.assign(s.cards[iid], { zone: 'resources', controller, linkedTo: player(s, controller).illuminati, tokens: 0 });
  log(s, `${player(s, controller).name} brings ${cardName(s, iid)} into play.`, controller);
  hooksOf(s, iid)?.onEnterPlay?.(s, iid);
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
  // The turn is over, so the 5-Plot limit now applies to the active player too (R027).
  const over = livePlayers(s).find((x) => overLimit(s, x.id));
  if (over) { s.prompt = { player: over.id, kind: 'discardToLimit', data: { resume: 'endTurn' } }; return; }
  finishTurn(s);
}

/** Outside his own turn a player may never hold more Plots than his limit: excess goes at once (R027). */
function enforceHandLimits(s: GameState) {
  if (s.prompt || s.phase === 'gameOver') return;
  const active = activePlayer(s).id;
  // The Goal-card limit applies at all times, the Plot limit outside your own turn.
  const over = livePlayers(s).find((x) => (x.id !== active && overLimit(s, x.id)) || goalsInHand(s, x.id).length > goalLimit(s, x.id));
  if (over) s.prompt = { player: over.id, kind: 'discardToLimit', data: { resume: 'continue' } };
}

/** How many Groups of `alignment` a card counts as for Goal cards (Fred Birch Society counts as two Conservative Groups). */
export function goalAlignWeight(s: GameState, iid: string, alignment: Alignment): number {
  return HOOKS[s.cards[iid].cardId]?.goalAlignWeight?.(s, iid, alignment) ?? 1;
}

export function goalsInHand(s: GameState, playerId: string) {
  return player(s, playerId).hand.filter((iid) => def(s, iid).subtype === 'Goal');
}
/** Normally one Goal card in hand; UFOs may hold three; Alternate Goals held raises it to two. */
export function goalLimit(s: GameState, playerId: string) {
  const ill = s.cards[player(s, playerId).illuminati].cardId;
  let n = ill === 'ufos' ? 3 : 1;
  if (player(s, playerId).hand.some((i) => s.cards[i].cardId === 'alternate-goals')) n = Math.max(n, 2);
  return n;
}
export function overLimit(s: GameState, playerId: string) {
  return plotsInHand(s, playerId).length > handLimit(s, playerId) || goalsInHand(s, playerId).length > goalLimit(s, playerId);
}

export function plotsInHand(s: GameState, playerId: string) {
  return player(s, playerId).hand.filter((iid) => def(s, iid).type === 'Plot');
}
export function handLimit(s: GameState, playerId: string) {
  let n = 5;
  for (const iid of structureCards(s, playerId)) for (const a of abilitiesOf(s, iid)) if (a.kind === 'handLimit') n += a.value;
  n += sumHooks(s, (h, self) => (controllerOf2(s, self) === playerId ? h.handLimit?.(s, self) : 0));
  return n;
}

function finishTurn(s: GameState) {
  s.prompt = undefined;
  const p = activePlayer(s);
  if (!s.turnFlags.extraTurn) p.turnsTaken++;
  // Victory is checked before "until end of turn" changes expire: temporary changes count for
  // a declaration made at the end of that turn (R016).
  checkVictory(s);
  for (const c of Object.values(s.cards)) c.mods = c.mods.filter((m) => m.until !== 'endOfTurn');
  if (isOver(s)) return;
  checkElimination(s);
  if (isOver(s)) return;
  advanceTurn(s);
}

function advanceTurn(s: GameState) {
  // After an extra turn, the interrupted player's turn begins.
  if (s.resumeSeat !== undefined) {
    s.active = s.resumeSeat;
    s.resumeSeat = undefined;
    beginTurn(s);
    return;
  }
  // Next live player in seat order; a new round starts when play returns to the first player.
  let next = s.active;
  for (let i = 0; i < s.players.length; i++) {
    next = (next + 1) % s.players.length;
    if (next === s.firstPlayer) s.round++;
    if (!s.players[next].eliminated) break;
  }
  s.active = next;
  beginTurn(s);
}

// ---------------------------------------------------------------- victory

export const isOver = (s: GameState) => s.phase === 'gameOver';

/**
 * Groups counted toward the Basic Goal. `extraDouble` lets a Goal card add its own "counts double"
 * rule. No Group counts more than double and at most 3 Groups count double (R016).
 */
export function goalCount(s: GameState, playerId: string, extraDouble?: (iid: string) => boolean): number {
  const ill = illuminatiOf(s, playerId);
  const doubles = abilitiesOf(s, ill).filter((a) => a.kind === 'doubleCount') as { kind: 'doubleCount'; match: never; minPower?: number }[];
  let count = 0;
  let doubled = 0;
  for (const iid of structureCards(s, playerId)) {
    if (tokenBarredForGoals(s, iid)) continue;
    count++;
    const twice = def(s, iid).type === 'Group' && (doubles.some((d) => matches(s, iid, d.match) && power(s, iid, { goals: true }) >= (d.minPower ?? 0)) || !!extraDouble?.(iid));
    if (doubled < 3 && twice) { count++; doubled++; }
  }
  count += sumHooks(s, (h, self) => (controllerOf2(s, self) === playerId ? h.goalBonus?.(s, self) : 0));
  return count;
}

function tokenBarredForGoals(s: GameState, iid: string) {
  let c: CardInstance | undefined = s.cards[iid];
  // A Devastated Place and everything below it do not count toward victory (R037).
  while (c) { if (c.devastated) return true; c = c.master ? s.cards[c.master] : undefined; }
  return false;
}

export function goalNeeded(s: GameState, playerId: string): number {
  let n = s.settings.basicGoal;
  const ill = illuminatiOf(s, playerId);
  if (abilitiesOf(s, ill).some((a) => a.kind === 'specialGoal' && a.goal === 'destroyCount')) n -= player(s, playerId).destroyedCredit.length;
  return n;
}

export function meetsGoal(s: GameState, playerId: string): string | null {
  // Cards that change alignments "except for Goals" (Military-Industrial Complex) read this flag.
  const was = goalCheck.active;
  goalCheck.active = true;
  try { return meetsGoalNow(s, playerId); } finally { goalCheck.active = was; }
}

function meetsGoalNow(s: GameState, playerId: string): string | null {
  if (goalCount(s, playerId) >= goalNeeded(s, playerId)) return 'controls enough Groups';
  // Goal cards held in hand (R016).
  for (const g of goalsInHand(s, playerId)) {
    const why = GOALS[s.cards[g].cardId]?.(s, playerId);
    if (why) return `${cardName(s, g)}: ${why}`;
  }
  const ill = illuminatiOf(s, playerId);
  const mine = structureCards(s, playerId).filter((iid) => !tokenBarredForGoals(s, iid));
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
  let winners = livePlayers(s).filter((p) => meetsGoal(s, p.id));
  // Two factions of the same Illuminati can never share a win (R044): both are knocked out of the claim.
  const ill = (pl: PlayerState) => s.cards[pl.illuminati].cardId;
  const shangri = winners.every((w) => ill(w) === 'shangri-la' && meetsGoal(s, w.id)?.includes('Peaceful'));
  if (!shangri) winners = winners.filter((w) => winners.filter((x) => ill(x) === ill(w)).length === 1);
  const alive = livePlayers(s);
  if (alive.length === 1) winners.splice(0, winners.length, alive[0]);
  if (winners.length) {
    s.phase = 'gameOver';
    s.winners = winners.map((w) => w.id);
    for (const w of winners) log(s, `${w.name} wins: ${meetsGoal(s, w.id) ?? 'last player standing'}!`, w.id);
  }
}

/** R049: after his third complete turn, a player whose Illuminati has no puppets is out at once. */
function checkElimination(s: GameState) {
  const activeId = activePlayer(s).id;
  for (const p of livePlayers(s)) {
    if (p.turnsTaken >= 3 && puppets(s, p.illuminati).length === 0) {
      p.eliminated = true;
      p.eliminatedBy = p.lastPuppetTakenBy;
      // His hand and decks leave the game.
      for (const iid of [...p.hand, ...p.plotDeck, ...p.groupDeck]) s.cards[iid].zone = 'removed';
      p.hand = []; p.plotDeck = []; p.groupDeck = [];
      log(s, `${p.name} has no Groups left and is eliminated.`, p.id);
    }
  }
  const alive = livePlayers(s);
  if (alive.length <= 1) {
    s.phase = 'gameOver';
    s.winners = alive.map((a) => a.id);
    s.attack = undefined; s.window = undefined; s.prompt = undefined;
    if (alive.length) log(s, `${alive[0].name} wins as the last player standing!`, alive[0].id);
    else log(s, 'Every player has been eliminated: nobody wins.');
    return;
  }
  if (player(s, activeId).eliminated) {
    // The active player went out during his own turn: play passes on.
    s.attack = undefined; s.window = undefined; s.prompt = undefined;
    advanceTurn(s);
  }
}

// ---------------------------------------------------------------- attacks

export const isSecret = (s: GameState, iid: string) => attributes(s, iid).includes('Secret');

/**
 * R014: non-Secret Groups may not attack a Secret Group, aid or oppose attacks on it, or aid its
 * attacks. Illuminati and other Secret Groups are exempt, and a Secret Group's own master and
 * puppets may defend it and aid its attacks.
 */
function secretBlocks(s: GameState, helper: string, secret: string): boolean {
  if (!isSecret(s, secret) || isSecret(s, helper) || def(s, helper).type === 'Illuminati') return false;
  if (anyHook(s, (h, self) => !!h.secretOverride?.(s, self, helper, secret))) return false;
  const h = s.cards[helper], t = s.cards[secret];
  return !(t.master === helper || h.master === secret);
}

/** First-turn protection (R001): nobody may act against a player who has not finished his first turn. */
export function protectedPlayer(s: GameState, actor: string, other: string | undefined): boolean {
  if (!other || other === actor) return false;
  return player(s, other).turnsTaken < 1;
}

export function canAttackPlayer(s: GameState, attacker: string, defender: string | undefined): string | null {
  if (!defender || defender === attacker) return null;
  const a = player(s, attacker), d = player(s, defender);
  if (d.turnsTaken < 1 || (s.players.length === 2 && a.turnsTaken < 1)) return 'Neither player may attack the other until both have finished a full turn.';
  return null;
}

function immuneTo(s: GameState, target: string, attackerGroups: string[], ctx?: AttackCtx): boolean {
  attackerGroups = attackerGroups.filter((g) => !anyHook(s, (h, self) => !!h.ignoreImmunity?.(s, self, g, target)));
  if (attackerGroups.some((g) => anyHook(s, (h, self) => h.immune?.(s, self, target, g, ctx)))) return true;
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

export function validateAttack(s: GameState, playerId: string, a: Extract<Action, { type: 'attack' }>, opts: { outOfTurn?: boolean; anyHand?: boolean } = {}): string | null {
  if (!opts.outOfTurn) {
    if (s.phase !== 'main' || activePlayer(s).id !== playerId) return 'You can only attack during the main phase of your own turn.';
    if (s.attack || s.window || s.prompt) return 'Finish the current action first.';
    if (s.turnFlags.restricted) return 'This turn you may only draw cards and place Action tokens.';
  }
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
    // opts.anyHand: a card lets you attack a Group in another player's hand, to control or destroy it (Opportunity Knocks).
    if (a.attackType !== 'control' && !opts.anyHand) return 'Groups in your hand can only be attacked to control.';
    if (!opts.anyHand && !player(s, playerId).hand.includes(a.target)) return 'You can only attack Groups from your own hand.';
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
  for (const self of activeHookCards(s)) {
    const why = HOOKS[s.cards[self].cardId].forbidAttack?.(s, self, a.attacker, a.target, a.attackType, playerId);
    if (why) return why;
  }
  if (isSecret(s, a.target) && !isSecret(s, a.attacker) && def(s, a.attacker).type !== 'Illuminati' && !anyHook(s, (h, self) => !!h.secretOverride?.(s, self, a.attacker, a.target))) return `${cardName(s, a.target)} is Secret: only Illuminati and Secret Groups can attack it.`;
  if (immuneTo(s, a.target, [a.attacker])) return `${cardName(s, a.target)} is immune to attacks from ${cardName(s, a.attacker)}.`;
  if (a.attackType === 'destroy' && abilitiesOf(s, a.target).some((x) => x.kind === 'cannotBeDestroyed')) return `${cardName(s, a.target)} cannot be destroyed.`;
  const ill = illuminatiOf(s, playerId);
  for (const ab of abilitiesOf(s, ill)) {
    if (a.attackType === 'destroy' && ab.kind === 'canOnlyDestroy' && !matches(s, a.target, ab.match)) return 'Your Illuminati may only destroy Violent Groups.';
  }
  if (a.privileged && !(abilitiesOf(s, ill).some((x) => x.kind === 'freePrivilegedAttack') && !s.turnFlags.bavarianPrivilege)) return 'You cannot make this attack Privileged.';
  return null;
}

/** Start an attack. Plots such as Opportunity Knocks may start one outside the attacker's turn. */
export function startAttack(s: GameState, playerId: string, a: Extract<Action, { type: 'attack' }>, opts: { outOfTurn?: boolean; anyHand?: boolean } = {}) {
  const err = validateAttack(s, playerId, a, opts);
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
  if (ctx?.barred?.length) return participantsBeforeBar(s).filter((id) => !ctx.barred!.includes(id));
  return participantsBeforeBar(s);
}
function participantsBeforeBar(s: GameState): string[] {
  const ctx = s.attack;
  if (!ctx || !isPrivileged(ctx)) return livePlayers(s).map((p) => p.id);
  const extra = liveEffects(ctx).flatMap((e) => (e.t === 'interfere' ? [e.player] : []));
  for (const p of livePlayers(s)) if (anyHook(s, (h, self) => controllerOf2(s, self) === p.id && !!h.mayInterfere?.(s, self, p.id))) extra.push(p.id);
  return [...new Set([ctx.attackerPlayer, ctx.targetPlayer, ...extra].filter((x): x is string => !!x))];
}

function openWindow(s: GameState, kind: 'attack' | 'roll' | 'plot' | 'endOfTurn', plot?: PlayedPlot) {
  s.window = { kind, passed: [], plot, deadline: Date.now() + s.settings.responseHours * 3600_000 };
}

function contributionPower(s: GameState, c: Contribution & { useGlobal?: boolean; selfDefense?: boolean }): number {
  if (!c.iid) return c.amount;
  // Self-defense raises the multiplier one step (R006c). Defensive +10s are already part of the
  // target's defense value, so they are not counted again here (R028).
  const v = c.useGlobal ? globalPower(s, c.iid)
    : power(s, c.iid, c.selfDefense ? { defense: true, selfDefense: true, noDefenseAdds: true } : {});
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
  const gone = cancelledGroups(ctx);
  // A Plot bonus stops counting if the Plot is cancelled or the Group it helped has its action cancelled (R009).
  const liveBonus = (list: Contribution[]) => list.filter((b) => (!b.plot || !isCancelled(ctx.plays, b.plot)) && !(b.forGroup && gone.has(b.forGroup)));
  // R014: in an attack by or against a Secret Group, special-ability bonuses and penalties are ignored.
  const noAbilities = isSecret(s, tgt) || (!!ctx.attacker && isSecret(s, ctx.attacker));
  const aid = ctx.aid.filter((c) => !gone.has(c.iid!));
  const oppose = ctx.oppose.filter((c) => !gone.has(c.iid!));

  if (ctx.instant) {
    add('a', ctx.instantPower ?? 0, 'card Power');
    for (const c of aid) add('a', contributionPower(s, c), `${cardName(s, c.iid!)} joins`);
    // Only abilities that mention Instant attacks apply.
    for (const g of noAbilities ? [] : structureCards(s, ctx.attackerPlayer)) {
      for (const a of abilitiesOf(s, g)) {
        if (a.kind === 'attackBonus' && a.instant && a.scope === 'any' && (a.on === 'destroy' || a.on === 'both') && matches(s, tgt, a.target)) add('a', a.value, cardName(s, g));
      }
    }
    for (const b of liveBonus(ctx.attackBonus)) add('a', b.amount, b.label);
    const p = ctx.instantDefense ?? power(s, tgt, { defense: true, halve: !!s.cards[tgt].devastated });
    add('d', p, `${td.name} Power when it was struck${s.cards[tgt].devastated ? ' (Devastated, halved)' : ''}`);
  } else if (!ctx.attacker) {
    // A card's own attack (no attacking Group): its Power, plus aid, against the target's Power.
    add('a', ctx.cardPower ?? 0, 'card Power');
    for (const c of aid) add('a', contributionPower(s, c), `${cardName(s, c.iid!)} aids${(c as { useGlobal?: boolean }).useGlobal ? ' (Global)' : ''}`);
    for (const b of liveBonus(ctx.attackBonus)) add('a', b.amount, b.label);
    add('d', power(s, tgt, { defense: true, halve: !!s.cards[tgt].devastated }), `${td.name} Power${s.cards[tgt].devastated ? ' (Devastated, halved)' : ''}`);
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
    // R044: +5 against another faction of your own Illuminati.
    if (ctx.targetPlayer && ctx.targetPlayer !== ctx.attackerPlayer && s.cards[illuminatiOf(s, ctx.targetPlayer)].cardId === s.cards[illuminatiOf(s, ctx.attackerPlayer)].cardId) add('a', 5, 'rival faction of your Illuminati');
    for (const g of noAbilities ? [] : structureCards(s, ctx.attackerPlayer)) {
      let direct = 0, any = 0;
      for (const a of abilitiesOf(s, g)) {
        if (a.kind !== 'attackBonus' || !(a.on === 'both' || a.on === ctx.type) || !matches(s, tgt, a.target, g)) continue;
        if (a.scope === 'any') any += a.value; else if (g === att) direct += a.value;
      }
      add('a', g === att ? Math.max(direct, any) : any, cardName(s, g));
    }
    for (const c of noAbilities ? [] : aid) {
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
      const p = power(s, tgt, { defense: true, halve: !!s.cards[tgt].devastated });
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
  if (ctx.targetPlayer && !noAbilities) {
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
  // Scripted card effects (Resources, linked Plots, special Groups).
  {
    for (const self of activeHookCards(s)) {
      const h = HOOKS[s.cards[self].cardId];
      if (!h.attackMod) continue;
      if (noAbilities && !ctx.instant && !h.worksInSecretAttacks) continue;
      add('a', h.attackMod(s, self, ctx, 'attack'), cardName(s, self));
      add('d', h.attackMod(s, self, ctx, 'defense'), cardName(s, self));
    }
    // The target's own attack modifiers, which also work while it is attacked from hand.
    const th = HOOKS[s.cards[tgt].cardId]?.asTarget;
    if (th && (s.cards[tgt].zone === 'hand' || activeHookCards(s).includes(tgt))) {
      add('a', th(s, tgt, ctx, 'attack'), td.name);
      add('d', th(s, tgt, ctx, 'defense'), td.name);
    }
  }
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
    // R009: if the attacking action is cancelled, Groups that aided or opposed get their tokens back
    // and Plots other players used for them return to their owners' hands, exposed. Costs spent on a
    // cancelled Instant attack (e.g. a helping Group's token) stay spent.
    if (!ctx.instant) {
      for (const c of [...ctx.aid, ...ctx.oppose]) if (c.iid && s.cards[c.iid].zone === 'structure') s.cards[c.iid].tokens++;
      for (const pp of ctx.plays) {
        const card = s.cards[pp.iid];
        if (!card || pp.player === ctx.attackerPlayer || card.zone !== 'table' || pp.effect.t === 'cancelGroup' || card.linkedTo) continue;
        card.zone = 'hand'; card.controller = undefined; card.exposed = true;
        player(s, card.owner).hand.push(pp.iid);
      }
    }
    // A cancelled Disaster gives back the token it took from its target (R036).
    if (ctx.disaster && ctx.tokenTaken && s.cards[tgt].zone === 'structure') s.cards[tgt].tokens++;
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
    } else if (abilitiesOf(s, tgt).some((a) => a.kind === 'cannotBeDestroyed') || anyHook(s, (h, self) => !!h.preventDestroy?.(s, self, tgt, ctx))) {
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
      if (!keeps) {
        s.cards[tgt].failedTakeoverTurn = s.turn;
        raiseEvent(s, { type: 'failedTakeover', card: tgt, player: ctx.attackerPlayer });
      }
    }
  }
  // Discard the Plots used in this attack (linked ones stay).
  for (const p of ctx.plays) {
    const c = s.cards[p.iid];
    if (!c) continue; // an activated ability, not a card
    if (c.zone === 'table' && (!c.linkedTo || isCancelled(ctx.plays, p.iid))) discardCard(s, p.iid);
  }
  fireHooks(s, (h, self) => h.onAttackEnd?.(s, self, ctx));
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
  raiseEvent(s, { type: 'devastated', card: iid, player: c.controller });
}

function capture(s: GameState, ctx: AttackCtx) {
  const tgt = ctx.target;
  const attacker = ctx.attacker!;
  let side = ctx.arrow && openArrows(s, attacker).includes(ctx.arrow) ? ctx.arrow : openArrows(s, attacker)[0];
  let master = attacker;
  if (!side) {
    // The captured Group must go on the attacking Group's own arrow (R003).
    log(s, `${cardName(s, attacker)} has no open control arrow left, so the capture fails.`);
    return;
  }
  log(s, `${player(s, ctx.attackerPlayer).name} takes control of ${cardName(s, tgt)}.`, ctx.attackerPlayer);
  const from = s.cards[tgt].controller;
  moveSubtree(s, tgt, ctx.attackerPlayer, master, side, 'discard');
  const tree = subtree(s, tgt);
  for (const g of tree) { s.cards[g].tokens = 0; s.cards[g].capturedTurn = s.turn; }
  // Resources linked to captured Groups go with them (R041).
  for (const r of Object.values(s.cards)) if (r.zone === 'resources' && r.linkedTo && tree.includes(r.linkedTo)) r.controller = ctx.attackerPlayer;
  s.cards[tgt].failedTakeoverTurn = undefined;
  hooksOf(s, tgt)?.onEnterPlay?.(s, tgt);
  fireHooks(s, (h, self) => h.onCapture?.(s, self, tgt, ctx.attackerPlayer, from));
  noteLastPuppet(s, from, ctx.attackerPlayer);
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
    layout[iid] = puppets(s, iid).map((child) => ({ child, local: rotate(sideOf(s, child)!, (4 - (c.rot ?? 0)) % 4) }));
  }
  // Lift the whole subtree out of play first.
  for (const iid of all) Object.assign(s.cards[iid], { zone: 'removed' as const, x: undefined, y: undefined, master: undefined, side: undefined });
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
  // Where the Group and its puppets were, for cards that bring it back (Head in a Jar).
  const layout = c.zone === 'structure' ? subtree(s, iid).map((g) => ({ iid: g, master: s.cards[g].master, x: s.cards[g].x, y: s.cards[g].y, side: sideOf(s, g) })) : [];
  removeFromHand(s, iid); // a Group attacked in someone's hand (Opportunity Knocks)
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
  fireHooks(s, (h, self) => h.onDestroy?.(s, self, iid, by));
  raiseEvent(s, { type: 'destroyed', card: iid, by, player: prev, data: { layout } });
  // Linked Plots are discarded; linked Resources are destroyed with the Group (R041).
  for (const other of Object.values(s.cards)) {
    if (other.linkedTo !== iid) continue;
    if (other.zone === 'resources') {
      const owner = other.controller;
      Object.assign(other, { zone: 'destroyed', controller: undefined, linkedTo: undefined, tokens: 0 });
      raiseEvent(s, { type: 'destroyed', card: other.iid, by, player: owner });
    } else discardCard(s, other.iid);
  }
  Object.assign(c, { zone: 'destroyed', controller: undefined, master: undefined, x: undefined, y: undefined, tokens: 0, mods: [], devastated: false });
  if (!HOOKS[c.cardId]?.noDestroyCredit && !player(s, by).destroyedCredit.includes(iid)) player(s, by).destroyedCredit.push(iid);
  if (draws) drawPlot(s, player(s, by), draws);
  noteLastPuppet(s, prev, by);
}

/** Remember who took a player's last Group (Fratricide credit, R049). */
function noteLastPuppet(s: GameState, victim: string | undefined, by: string) {
  const v = victim ? s.players.find((x) => x.id === victim) : undefined;
  if (v && v.id !== by && puppets(s, v.illuminati).length === 0) {
    v.lastPuppetTakenBy = by;
    // Players who helped the attack (aid, or a bonus from a Plot or ability) share the credit (Fratricide).
    const ctx = s.attack;
    const helped = ctx ? [...ctx.aid, ...ctx.attackBonus].map((c) => c.player) : [];
    v.lastPuppetHelpers = [...new Set(helped)].filter((x) => x !== v.id && x !== by);
  }
}

// ---------------------------------------------------------------- plots

export function plotContext(s: GameState): 'main' | 'attack' | 'roll' | 'plot' | 'endOfTurn' | 'event' | 'none' {
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
    if (t.includes('event') && ctxKind === 'event' && (!h.events || h.events.includes(s.window!.event!.type))) ok = true;
    if (t.includes('nwo') && (isActiveMain || ctxKind === 'endOfTurn' || (ctxKind === 'attack' && !!ctx && !ctx.instant && !isPrivileged(ctx)))) ok = true;
  }
  if (!ok) return `${d.name} cannot be played right now.`;
  if (activePlayer(s).id === playerId && (s.turnFlags.extraTurn || s.turnFlags.restricted)) return s.turnFlags.extraTurn ? 'No Plots may be played during an extra turn.' : 'This turn you may only draw cards and place Action tokens.';
  // Immunities also stop Plots aimed at a Group (R033 excepts Plots in general; card hooks may say otherwise).
  if (play.target && s.cards[play.target]?.zone === 'structure' && anyHook(s, (h, self) => !!h.immune?.(s, self, play.target!, play.card))) return `${cardName(s, play.target)} is immune to ${d.name}.`;
  const forbidden = forbiddenUse(s, playerId, play.card, play.target, ctx);
  if (forbidden) return forbidden;
  // First-turn protection (R001): no cards against a player who has not finished his first turn.
  const tgtOwner = play.target && s.cards[play.target] ? (s.cards[play.target].controller ?? s.cards[play.target].owner) : undefined;
  if (protectedPlayer(s, playerId, tgtOwner)) return 'That player has not finished a first turn yet.';
  if (ctx && protectedPlayer(s, playerId, ctx.attackerPlayer) && ctx.targetPlayer !== playerId) return 'You cannot interfere with the first turn of a player.';
  // No player may use two copies of the same Plot in one attack (R030); a cancelled copy never happened.
  if (ctx && ctx.plays.some((p) => p.player === playerId && s.cards[p.iid]?.cardId === d.id && !isCancelled(ctx.plays, p.iid))) return `You already used ${d.name} in this attack.`;
  if (ctx?.barred?.includes(playerId)) return 'A card bars you from interfering in this attack.';
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
  // Non-attack Plot: pay its costs now, give others a chance to counter it, then resolve.
  h.apply(s, playerId, play);
  const fromEvent = s.window?.kind === 'event' ? s.window.event : undefined;
  s.window = { kind: 'plot', passed: [playerId], plot: pp, plays: [pp], deadline: Date.now() + s.settings.responseHours * 3600_000, event: fromEvent };
}

function resolvePendingPlot(s: GameState) {
  const w = s.window!;
  const pp = w.plot!;
  s.window = undefined;
  const d = def(s, pp.iid);
  if (!isCancelled(w.plays!, pp.iid)) {
    log(s, `${d.name} takes effect.`, pp.player);
    // A Plot answering an announced action may respond to it (respondToAction) while it resolves.
    respondingTo = w.event?.type === 'action' ? w.event : undefined;
    try { PLOTS[d.id].resolve?.(s, pp.player, pp.play); } finally { respondingTo = undefined; }
    const c = s.cards[pp.iid];
    if (c.zone === 'table' && !c.linkedTo && d.subtype !== 'NWO') discardCard(s, pp.iid);
  } else {
    log(s, `${d.name} is cancelled.`, pp.player);
    PLOTS[d.id].refund?.(s, pp.player, pp.play);
    if (s.cards[pp.iid]?.zone === 'table') discardCard(s, pp.iid);
  }
  for (const q of w.plays!) if (q !== pp && s.cards[q.iid]?.zone === 'table') discardCard(s, q.iid);
  if (!isCancelled(w.plays!, pp.iid)) raiseEvent(s, { type: 'plotResolved', card: pp.iid, player: pp.player });
  // A Plot played in response to an event: the event's window reopens so others may respond too.
  if (w.event) {
    // If resolving started an attack (Opportunity Knocks), the event window reopens once it is over.
    if (s.attack || s.window) { (s.events ??= []).unshift(w.event); return; }
    s.window = { kind: 'event', event: w.event, passed: [], deadline: Date.now() + s.settings.responseHours * 3600_000 };
    return;
  }
  if (s.phase === 'endOfTurn') openWindow(s, 'endOfTurn');
}

// ---------------------------------------------------------------- aid / oppose

export function canAid(s: GameState, playerId: string, group: string): { ok: boolean; global: boolean; why?: string } {
  const ctx = s.attack;
  if (!ctx || s.window?.kind !== 'attack') return { ok: false, global: false, why: 'No attack in progress.' };
  const c = s.cards[group];
  if (c.zone !== 'structure' || c.controller !== playerId) return { ok: false, global: false, why: 'Not your Group.' };
  if (c.tokens < 1) return { ok: false, global: false, why: 'No Action token.' };
  if (group === ctx.attacker || group === ctx.target) return { ok: false, global: false, why: 'Already part of this attack.' };
  if (ctx.instant && !anyHook(s, (h, self) => !!h.mayJoin?.(s, self, ctx, group, 'aid'))) return { ok: false, global: false, why: 'Groups cannot join an Instant attack unless a card allows it.' };
  if (ctx.aidRule === 'defenderOnly') return { ok: false, global: false, why: 'Only the defender may be helped against this attack.' };
  if (anyHook(s, (h, self) => !!h.forbidJoin?.(s, self, ctx, group, 'aid'))) return { ok: false, global: false, why: 'A card in play stops this Group joining.' };
  if ([...ctx.aid, ...ctx.oppose].some((x) => x.iid === group)) return { ok: false, global: false, why: 'Already used in this attack.' };
  if (!participants(s).includes(playerId)) return { ok: false, global: false, why: 'This attack is Privileged.' };
  if (protectedPlayer(s, playerId, ctx.attackerPlayer) || protectedPlayer(s, playerId, ctx.targetPlayer)) return { ok: false, global: false, why: 'That player has not finished a first turn yet.' };
  if (secretBlocks(s, group, ctx.target) || (ctx.attacker && secretBlocks(s, group, ctx.attacker))) return { ok: false, global: false, why: 'Secret Groups can only be helped by Illuminati, Secret Groups, or their own master and puppets.' };
  if (immuneTo(s, ctx.target, [group])) return { ok: false, global: false, why: 'The target is immune to this Group.' };
  const al = alignments(s, group), ta = alignments(s, ctx.target);
  const qualifies = ctx.type === 'control' ? al.some((a) => a !== 'Fanatic' && ta.includes(a)) : al.some((a) => ta.some((b) => (a === 'Fanatic' && b === 'Fanatic') || (a !== b && ({ Government: 'Corporate', Corporate: 'Government', Liberal: 'Conservative', Conservative: 'Liberal', Peaceful: 'Violent', Violent: 'Peaceful', Straight: 'Weird', Weird: 'Straight' } as Record<string, string>)[a] === b)));
  // Cards that let a Group join regardless of alignment use its full Power.
  if (anyHook(s, (h, self) => h.mayJoin?.(s, self, ctx, group, 'aid'))) return { ok: true, global: false };
  // Without a qualifying alignment a Group can only help with its Global Power (R029).
  if (!qualifies && globalPower(s, group) === 0) return { ok: false, global: true, why: 'No matching alignment and no Global Power.' };
  return { ok: true, global: !qualifies };
}

export function canOppose(s: GameState, playerId: string, group: string): { ok: boolean; global: boolean; self: boolean; why?: string } {
  const ctx = s.attack;
  if (!ctx || s.window?.kind !== 'attack') return { ok: false, global: false, self: false, why: 'No attack in progress.' };
  const c = s.cards[group];
  if (c.zone !== 'structure' || c.controller !== playerId) return { ok: false, global: false, self: false, why: 'Not your Group.' };
  if (c.tokens < 1) return { ok: false, global: false, self: false, why: 'No Action token.' };
  if (ctx.instant && (group === ctx.target || !anyHook(s, (h, me) => !!h.mayJoin?.(s, me, ctx, group, 'oppose')))) return { ok: false, global: false, self: false, why: 'The target of an Instant attack cannot spend tokens.' };
  if (anyHook(s, (h, me) => !!h.forbidJoin?.(s, me, ctx, group, 'oppose'))) return { ok: false, global: false, self: false, why: 'A card in play stops this Group joining.' };
  if (group === ctx.attacker) return { ok: false, global: false, self: false, why: 'The attacker cannot oppose.' };
  if (ctx.aid.some((x) => x.iid === group)) return { ok: false, global: false, self: false, why: 'Already aiding.' };
  if (!participants(s).includes(playerId)) return { ok: false, global: false, self: false, why: 'This attack is Privileged.' };
  const self = group === ctx.target;
  if (!self && ctx.oppose.some((x) => x.iid === group)) return { ok: false, global: false, self: false, why: 'Already used in this attack.' };
  if (protectedPlayer(s, playerId, ctx.attackerPlayer) && ctx.targetPlayer !== playerId) return { ok: false, global: false, self: false, why: 'That player has not finished a first turn yet.' };
  if (!self && secretBlocks(s, group, ctx.target)) return { ok: false, global: false, self: false, why: 'Only Illuminati, Secret Groups, or its own master and puppets can defend a Secret Group.' };
  const tc = s.cards[ctx.target];
  const related = self || tc.master === group || c.master === ctx.target;
  const shares = alignments(s, group).some((a) => a !== 'Fanatic' && alignments(s, ctx.target).includes(a));
  if (!(related || shares) && anyHook(s, (h, me) => h.mayJoin?.(s, me, ctx, group, 'oppose'))) return { ok: true, global: false, self };
  if (!(related || shares) && globalPower(s, group) === 0) return { ok: false, global: true, self, why: 'No matching alignment and no Global Power.' };
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
    const who = s.window.kind === 'plot' || s.window.kind === 'endOfTurn' || s.window.kind === 'roll' || s.window.kind === 'event' ? livePlayers(s).map((p) => p.id) : participants(s);
    return who.filter((id) => !s.window!.passed.includes(id));
  }
  return [activePlayer(s).id];
}

export function applyAction(state: GameState, playerId: string, action: Action): GameState {
  const s: GameState = structuredClone(state);
  ensureLayout(s); // games saved before cards had real shapes
  assertPriority(s, playerId);
  const p = player(s, playerId);
  if (p.eliminated) throw new RuleError('You have been eliminated.');

  switch (action.type) {
    case 'playResource': {
      // Once per turn, an Illuminati action puts a Resource from hand into play (R041).
      if (s.phase !== 'main' || activePlayer(s).id !== playerId || s.window || s.attack) throw new RuleError('Only in your own main phase.');
      if (s.turnFlags.restricted) throw new RuleError('This turn you may only draw cards and place Action tokens.');
      if (s.turnFlags.resourcePlayed) throw new RuleError('You can only play one Resource this way per turn.');
      if (!p.hand.includes(action.card) || def(s, action.card).type !== 'Resource') throw new RuleError('Choose a Resource in your hand.');
      if (!canEnterPlay(s, action.card, playerId)) throw new RuleError('That Resource is Unique and already in play or destroyed.');
      if (s.cards[p.illuminati].tokens < 1) throw new RuleError('Your Illuminati needs an Action token.');
      s.cards[p.illuminati].tokens--;
      s.turnFlags.resourcePlayed = true;
      announce(s, playerId, 'resource', action, [p.illuminati]);
      break;
    }

    case 'link': {
      // Link a Resource to one of your Groups during your main phase (R042).
      if (s.phase !== 'main' || activePlayer(s).id !== playerId || s.window || s.attack) throw new RuleError('Only in your own main phase.');
      const r = inst(s, action.resource);
      if (r.zone !== 'resources' || r.controller !== playerId) throw new RuleError('Choose one of your Resources.');
      const to = inst(s, action.to);
      if (to.zone !== 'structure' || to.controller !== playerId) throw new RuleError('Link it to a Group in your Power Structure.');
      if (s.turnFlags.restricted) throw new RuleError('This turn you may only draw cards and place Action tokens.');
      if (r.linkMovedTurn === s.turn) throw new RuleError('A link can be moved only once per turn.');
      if (r.linkedTo && anyHook(s, (h, self) => self === r.linkedTo && !!h.lockLinks?.(s, self, action.resource))) throw new RuleError(`${cardName(s, action.resource)} is locked to ${cardName(s, r.linkedTo)} and cannot be moved.`);
      const rule = HOOKS[r.cardId]?.linkTo;
      if (rule && def(s, action.to).type !== 'Illuminati' && !rule(s, action.resource, action.to)) throw new RuleError(`${cardName(s, action.resource)} cannot be linked to ${cardName(s, action.to)}.`);
      // Linking spends no Group's action, so only cards answering any action (Plots) may respond.
      announce(s, playerId, 'link', action, [], action.resource);
      break;
    }

    case 'useAbility':
      useAbility(s, playerId, action.card, action.ability, action.params ?? {});
      break;

    case 'agent': {
      // R031: a card in hand duplicating a Group a rival controls can aid (+10) or oppose (-6)
      // an attack on that Group. One agents card per attack; it is discarded afterwards.
      const ctx = s.attack;
      if (!ctx || s.window?.kind !== 'attack' || ctx.instant) throw new RuleError('Agents can only join an attack in progress.');
      if (!participants(s).includes(playerId)) throw new RuleError('This attack is Privileged.');
      if (ctx.usedAgents) throw new RuleError('Only one agents card may be used per attack.');
      if (!p.hand.includes(action.card) || s.cards[action.card].cardId !== s.cards[ctx.target].cardId || action.card === ctx.target) throw new RuleError('You need a duplicate of the Group being attacked.');
      if (ctx.targetPlayer === playerId) throw new RuleError('You cannot use agents against your own Group.');
      if (s.cards[ctx.target].data?.noAgents) throw new RuleError('That Group is immune to agents.');
      if (action.as === 'aid' && ctx.fromHand) throw new RuleError('Agents can only oppose an attack on a Group played from hand.');
      if (anyHook(s, (h, self) => controllerOf2(s, self) === ctx.targetPlayer && h.cancelAgents?.(s, self) === true)) throw new RuleError('Agents give no bonus against this Group.');
      removeFromHand(s, action.card);
      Object.assign(s.cards[action.card], { zone: 'table', controller: playerId });
      const entry = { player: playerId, plot: action.card, amount: action.as === 'aid' ? 10 : 6, label: `Agents (${cardName(s, action.card)})` };
      (action.as === 'aid' ? ctx.attackBonus : ctx.defenseBonus).push(entry);
      ctx.plays.push({ iid: action.card, player: playerId, play: { card: action.card }, effect: { t: 'none' } });
      ctx.usedAgents = true;
      log(s, `${p.name} reveals agents in ${cardName(s, action.card)} (${action.as === 'aid' ? '+10 to the attack' : '−6 to the attack'}).`, playerId);
      s.window!.passed = [];
      break;
    }

    case 'choose': {
      const pr = s.prompt;
      if (pr?.kind !== 'choose' || pr.player !== playerId || !pr.choice) throw new RuleError('There is nothing to choose.');
      const ch = pr.choice;
      const ids = [...new Set(action.ids)];
      if (!ids.every((id) => ch.options.some((o) => o.id === id))) throw new RuleError('Pick from the options shown.');
      if (ids.length < ch.min || ids.length > ch.max) throw new RuleError(ch.min === ch.max ? `Pick ${ch.min}.` : `Pick between ${ch.min} and ${ch.max}.`);
      s.prompt = s.promptQueue?.shift();
      CHOICES[ch.key]?.resolve(s, playerId, ids, { ...ch.data, source: ch.source });
      break;
    }

    case 'chooseLead': {
      if (s.prompt?.kind !== 'chooseLead' || s.prompt.player !== playerId) throw new RuleError('Not choosing a lead Group now.');
      if (!leadOptions(s, playerId).includes(action.card)) throw new RuleError('Pick a Group from your deck.');
      s.setup!.picks[playerId] = action.card;
      s.prompt = undefined;
      promptNextLead(s);
      break;
    }

    case 'callOff': {
      // R009: the attacker may call an attack off until he commits a Plot to it. Everyone else gets
      // back the tokens and cards they put in; the attacker's own token stays spent.
      const ctx = s.attack;
      if (!ctx || ctx.attackerPlayer !== playerId || ctx.instant || s.window?.kind !== 'attack') throw new RuleError('You can only call off your own attack before the roll.');
      if (ctx.plays.some((pp) => pp.player === playerId)) throw new RuleError('You have committed a Plot to this attack, so it can no longer be called off.');
      for (const c of [...ctx.aid, ...ctx.oppose]) if (c.iid && s.cards[c.iid].zone === 'structure') s.cards[c.iid].tokens++;
      for (const pp of ctx.plays) {
        const card = s.cards[pp.iid];
        if (!card || card.zone !== 'table') continue;
        card.zone = 'hand'; card.controller = undefined; card.linkedTo = undefined;
        player(s, card.owner).hand.push(pp.iid);
      }
      for (const c of Object.values(s.cards)) c.mods = c.mods.filter((m) => m.until !== 'attack');
      log(s, `${p.name} calls off the attack.`, playerId);
      s.attack = undefined; s.window = undefined;
      break;
    }

    case 'setAutoPass':
      p.autoPass = action.value;
      break;

    case 'takeover': {
      if (s.prompt?.kind !== 'takeover' || s.prompt.player !== playerId) throw new RuleError('You cannot make an automatic takeover now.');
      if (!takeoverOptions(s, playerId).some((o) => o.card === action.card && (def(s, action.card).type === 'Resource' || (o.onto === action.onto && o.side === action.side)))) throw new RuleError('That placement is not legal.');
      s.turnFlags.takeoverDone = true;
      if (def(s, action.card).type === 'Resource') playResourceCard(s, action.card, playerId);
      else {
        placeGroup(s, action.card, playerId, action.onto, action.side);
        log(s, `${p.name} takes over ${cardName(s, action.card)} automatically.`, playerId);
        hooksOf(s, action.card)?.onEnterPlay?.(s, action.card);
      }
      s.prompt = s.promptQueue?.shift();
      // Rivals may respond to an automatic takeover (Sabotage, Botched Contact) before tokens are placed.
      raiseEvent(s, { type: 'takeover', player: playerId, card: action.card }, 'finishBeginning');
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
      if (s.turnFlags.restricted) throw new RuleError('This turn you may only draw cards and place Action tokens.');
      const free = s.turnFlags.freeMoves === playerId;
      const g = inst(s, action.group);
      if (g.controller !== playerId || def(s, action.group).type !== 'Group') throw new RuleError('You can only move your own Groups.');
      const dest = inst(s, action.onto);
      if (dest.controller !== playerId || subtree(s, action.group).includes(action.onto)) throw new RuleError('Choose an arrow elsewhere in your own Power Structure.');
      const ignore = new Set(subtree(s, action.group));
      if (!openArrows(s, action.onto, ignore).includes(action.side)) throw new RuleError('That arrow is not open.');
      const payers = [action.group, g.master, action.onto, p.illuminati];
      if (!free && (!payers.includes(action.payWith) || s.cards[action.payWith].tokens < 1)) throw new RuleError('Pay with a token from the Group, its old or new master, or your Illuminati.');
      if (!free) s.cards[action.payWith].tokens--;
      announce(s, playerId, 'move', action, free ? [] : [action.payWith], action.group);
      break;
    }

    case 'playPlot':
      playPlot(s, playerId, action.play);
      break;

    case 'buyPlot': {
      const ill = action.payWith.length === 1 && action.payWith[0] === p.illuminati;
      const two = action.payWith.length === 2 && action.payWith.every((g) => g !== p.illuminati);
      if (!ill && !(two && action.payWith[0] !== action.payWith[1])) throw new RuleError('Buying a Plot costs 1 Illuminati token or tokens from 2 different other Groups.');
      for (const g of action.payWith) {
        const c = inst(s, g);
        if (c.controller !== playerId || c.zone !== 'structure' || c.tokens < 1) throw new RuleError('Those Groups cannot pay.');
      }
      if (!p.plotDeck.length) throw new RuleError('Your Plot deck is empty.');
      if (s.turnFlags.noPlotDraws?.includes(playerId)) throw new RuleError('You cannot draw Plot cards this turn.');
      if (s.turnFlags.extraTurn && activePlayer(s).id === playerId) throw new RuleError('No cards may be drawn during an extra turn.');
      for (const g of action.payWith) s.cards[g].tokens--;
      drawPlot(s, p);
      log(s, `${p.name} buys a Plot card.`, playerId);
      break;
    }

    case 'drawGroup': {
      if (s.phase !== 'main' || activePlayer(s).id !== playerId || s.window || s.attack) throw new RuleError('Only in your own main phase.');
      if (s.turnFlags.illumGroupDraw) throw new RuleError('You can only do this once per turn.');
      if (s.turnFlags.extraTurn) throw new RuleError('No cards may be drawn during an extra turn.');
      if (s.cards[p.illuminati].tokens < 1) throw new RuleError('Your Illuminati needs an Action token.');
      if (!p.groupDeck.length) throw new RuleError('Your Group deck is empty.');
      s.cards[p.illuminati].tokens--;
      s.turnFlags.illumGroupDraw = true;
      announce(s, playerId, 'drawGroup', action, [p.illuminati]);
      break;
    }

    case 'relief': {
      // R037: actions whose Power totals at least 3x the Place's printed Power remove Devastation.
      const place = inst(s, action.place);
      if (place.zone !== 'structure' || !place.devastated) throw new RuleError('Choose a Devastated Place.');
      if (s.attack && s.window?.kind !== 'attack') throw new RuleError('Not during an attack roll.');
      if (!s.window && !(s.phase === 'main' && activePlayer(s).id === playerId)) throw new RuleError('Relief can be sent during your turn or while you are able to respond.');
      if (new Set(action.payWith).size !== action.payWith.length || !action.payWith.length) throw new RuleError('Choose the Groups that send Relief.');
      for (const g of action.payWith) {
        const c = inst(s, g);
        if (c.zone !== 'structure' || c.controller !== playerId || c.tokens < 1) throw new RuleError('Each Group sending Relief must be yours and have an Action token.');
      }
      const need = 3 * (def(s, action.place).power ?? 0);
      const total = action.payWith.reduce((n, g) => n + power(s, g), 0);
      if (total < need) throw new RuleError(`Relief needs ${need} Power in total (three times its printed Power); you have ${total}.`);
      for (const g of action.payWith) s.cards[g].tokens--;
      if ((place.data?.noReliefUntilTurn as number | undefined) !== undefined && s.turn <= (place.data!.noReliefUntilTurn as number)) throw new RuleError('No Relief can be sent there yet.');
      if (canAnnounce(s)) announce(s, playerId, 'relief', action, [...action.payWith], action.place);
      else doRelief(s, playerId, action.place, action.payWith, false);
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
      const outside = s.prompt.data?.resume === 'endTurn' || activePlayer(s).id !== playerId;
      if (outside && plots.length - action.cards.length > handLimit(s, playerId)) throw new RuleError(`Discard down to ${handLimit(s, playerId)} Plots.`);
      const goals = goalsInHand(s, playerId);
      if (goals.length - action.cards.filter((c) => goals.includes(c)).length > goalLimit(s, playerId)) throw new RuleError(`You may hold only ${goalLimit(s, playerId)} Goal card${goalLimit(s, playerId) > 1 ? 's' : ''}.`);
      for (const c of action.cards) {
        if (action.toDeck) {
          // Excess Plots may be put back into your Plot deck instead of discarded (R027).
          p.hand = p.hand.filter((x) => x !== c);
          s.cards[c].zone = 'plotDeck'; s.cards[c].exposed = false;
          p.plotDeck.push(c);
        } else discardCard(s, c);
      }
      const resume = s.prompt.data?.resume;
      s.prompt = undefined;
      if (resume === 'endTurn') endTurnCleanup(s);
      break;
    }
  }
  advance(s);
  zeroPowerLosesTokens(s);
  if (!isOver(s)) checkElimination(s);
  enforceHandLimits(s);
  advance(s);
  // Plots that cannot be exposed (hidden beneath a card) are never left face up.
  for (const c of Object.values(s.cards)) if (c.exposed && c.zone === 'hand' && anyHook(s, (h, self) => !!h.preventExpose?.(s, self, c.iid))) c.exposed = false;
  s.version++;
  return s;
}

/** A Group whose Power has been reduced to 0 loses its tokens at once (R026). */
function zeroPowerLosesTokens(s: GameState) {
  for (const c of Object.values(s.cards)) {
    if (c.zone === 'structure' && c.tokens > 0 && def(s, c.iid).type === 'Group' && (def(s, c.iid).power ?? 0) > 0 && power(s, c.iid) === 0) c.tokens = 0;
  }
}

/** Use an activated ability of a Group or Resource you control. */
export function checkAbility(s: GameState, playerId: string, card: string, abilityId: string, params: AbilityParams): string | null {
  if (activePlayer(s).id === playerId && s.turnFlags.restricted) return 'This turn you may only draw cards and place Action tokens.';
  const c = s.cards[card];
  if (!c || (c.zone !== 'structure' && c.zone !== 'resources') || c.controller !== playerId) return 'You can only use your own cards in play.';
  const ab = HOOKS[c.cardId]?.actions?.find((a) => a.id === abilityId);
  if (!ab) return 'That card has no such ability.';
  if (abilitiesDisabled(s, card)) return `${cardName(s, card)} cannot use its special abilities right now.`;
  const ctxKind = plotContext(s);
  const mine = activePlayer(s).id === playerId;
  const ok = ab.timing.some((t) =>
    (t === 'main' && ctxKind === 'main' && mine) ||
    (t === 'attack' && ctxKind === 'attack') ||
    (t === 'roll' && ctxKind === 'roll') ||
    (t === 'anytime' && ((ctxKind === 'main' && mine) || ctxKind === 'attack' || ctxKind === 'endOfTurn')) ||
    (t === 'event' && ctxKind === 'event' && (ab.events ?? ['action']).includes(s.window!.event!.type)) ||
    (t === 'counter' && ctxKind === 'plot'));
  if (!ok) return `${ab.label} cannot be used right now.`;
  if (s.attack && s.window && !participants(s).includes(playerId)) return 'This attack is Privileged.';
  if (s.window && !waitingFor(s).includes(playerId)) return 'You have already passed.';
  if (ab.usesToken && (c.tokens < 1 || tokenBarred(s, card))) return `${cardName(s, card)} has no Action token.`;
  if (ab.oncePerTurn && c.abilityTurns?.[abilityId] === s.turn) return 'Already used this turn.';
  const forbidden = forbiddenUse(s, playerId, card, params.target, s.attack);
  if (forbidden) return forbidden;
  return ab.check(s, playerId, card, params, s.attack);
}

function useAbility(s: GameState, playerId: string, card: string, abilityId: string, params: AbilityParams) {
  const err = checkAbility(s, playerId, card, abilityId, params);
  if (err) throw new RuleError(err);
  const c = s.cards[card];
  const ab = HOOKS[c.cardId]!.actions!.find((a) => a.id === abilityId)!;
  if (ab.usesToken) c.tokens--;
  c.abilityTurns = { ...c.abilityTurns, [abilityId]: s.turn };
  log(s, `${cardName(s, card)}: ${ab.label}${params.target && s.cards[params.target] ? ` (${cardName(s, params.target)})` : ''}.`, playerId);
  // Used in your main phase with nothing else going on: announced first, so others may respond (R010).
  // A token-paid ability is the card's action, which cancelling cards may target.
  if (canAnnounce(s)) {
    announce(s, playerId, 'ability', { type: 'useAbility', card, ability: abilityId, params }, ab.usesToken ? [card] : [], card);
    return;
  }
  const effect = ab.apply(s, playerId, card, params, s.attack);
  const w = s.window;
  if (s.attack) {
    // Recorded like a Plot so that it can be cancelled and undone live.
    s.attack.plays.push({ iid: `ability:${card}:${abilityId}:${s.version}`, player: playerId, play: { card }, effect: effect ?? { t: 'none' }, ability: card });
  } else if (w?.kind === 'event' && w.event?.type === 'action') {
    // A response to an announced action (a cancel, or a cancel of a cancel).
    respondToAction(s, playerId, card, effect ?? { t: 'none' }, true);
  } else if (w?.kind === 'plot' && effect) {
    // A response to a Plot waiting to resolve (e.g. negating it).
    w.plays!.push({ iid: `ability:${card}:${abilityId}:${s.version}`, player: playerId, play: { card }, effect, ability: card });
  }
  if (s.window) s.window.passed = s.window.kind === 'plot' ? [playerId] : [];
}

/**
 * Everyone has passed after the roll: cards that act on the result (automatic re-rolls, automatic
 * failures) do so now. Returns true if the roll window must open again.
 */
function beforeResult(s: GameState): boolean {
  const ctx = s.attack;
  if (!ctx) return false;
  let again = false;
  for (const self of activeHookCards(s)) if (HOOKS[s.cards[self].cardId].beforeAttackResult?.(s, self, ctx)) again = true;
  if (again && s.window) s.window.passed = [];
  return again;
}

/** Close any window everyone has passed on, and advance the game. */
function settleWindows(s: GameState) {
  for (let guard = 0; guard < 50; guard++) {
    const w = s.window;
    if (!w || s.phase === 'gameOver') return;
    if (waitingFor(s).length) return;
    if (w.kind === 'attack') rollAttack(s);
    else if (w.kind === 'roll') { if (!beforeResult(s)) finishAttack(s); }
    else if (w.kind === 'plot') resolvePendingPlot(s);
    else if (w.kind === 'endOfTurn') { s.window = undefined; endTurnCleanup(s); }
    else if (w.kind === 'event') {
      s.window = undefined;
      const then = w.event?.data?.then as string | undefined;
      if (then) runContinuation(s, then, w.event);
    }
  }
}

/** Settle windows and open queued event windows until the game needs a player's input. */
export function advance(s: GameState) {
  for (let guard = 0; guard < 200; guard++) {
    settleWindows(s);
    if (!openNextEvent(s)) return;
  }
}

/**
 * A non-Instant attack launched by a card, with no attacking Group (Epidemic, Giant Kudzu). Others
 * may aid or oppose as usual unless `aidRule` says only the defender may be helped.
 */
export function startCardAttack(s: GameState, playerId: string, opts: {
  plot: string; target: string; power: number; disaster?: AttackCtx['disaster']; aidRule?: 'defenderOnly';
}) {
  const ctx: AttackCtx = {
    id: ++s.attackCounter, type: 'destroy', instant: false, instantCard: opts.plot, cardPower: opts.power,
    disaster: opts.disaster, attackerPlayer: playerId, aidRule: opts.aidRule,
    target: opts.target, targetPlayer: controllerOf(s, opts.target), fromHand: false, privileged: false,
    aid: [], oppose: [], attackBonus: [], defenseBonus: [], plays: [],
  };
  if (opts.disaster && s.cards[opts.target].tokens > 0) { s.cards[opts.target].tokens--; ctx.tokenTaken = true; }
  s.attack = ctx;
  openWindow(s, 'attack');
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
  ctx.instantDefense = power(s, opts.target, { defense: true, halve: !!s.cards[opts.target].devastated }); // Power when played (R034)
  if (opts.disaster && s.cards[opts.target].tokens > 0) { s.cards[opts.target].tokens--; ctx.tokenTaken = true; } // R036
  s.attack = ctx;
  openWindow(s, 'attack');
}

export { OPPOSITE_SIDE, occupied };
