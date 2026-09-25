// Online play service, independent of any hosting provider. It keeps the authoritative game,
// checks every move with the rules engine, hides what each player must not see, moves computer
// players, applies standing orders and response deadlines. A host only needs to supply a Store
// (database) and call these functions from its API routes and a periodic timer.
import {
  type Action, type AiLevel, type GameState, type GameSettings, applyAction, createGame, hasResponse, player, waitingFor, randomDeck,
  RuleError, def, HOOKS, canExpose,
} from '../engine';
import { chooseAction } from '../ai/ai';
import { seatComputers, styleById } from '../ai/personas';

export interface Seat { id: string; name: string; isAI: boolean; aiLevel?: AiLevel; aiStyle?: string; userId?: string; illuminati?: string }

export interface StandingOrders {
  /** Pass automatically in windows where you have no legal response. */
  passWhenNothing: boolean;
  /** Pass automatically on attacks that don't involve your Groups. */
  passWhenUninvolved: boolean;
}

export interface GameRecord {
  id: string;
  state: GameState | null;          // null until every seat is filled
  seats: Seat[];
  orders: Record<string, StandingOrders>;
  invite: string;                    // code friends use to join
  createdAt: number;
  updatedAt: number;
  settings: Partial<GameSettings>;
}

export interface Store {
  get(id: string): Promise<GameRecord | undefined>;
  getByInvite(code: string): Promise<GameRecord | undefined>;
  put(rec: GameRecord, expectedUpdatedAt?: number): Promise<void>; // throws on a stale write
  listForUser(userId: string): Promise<GameRecord[]>;
  listWithDeadlines(before: number): Promise<GameRecord[]>;
  delete(id: string): Promise<void>;
}

/** Why a player is being alerted. Only these few moments are worth a message outside the app. */
export type AlertKind = 'gameStarted' | 'yourTurn' | 'destroyAttack';
export interface Notifier { alert(userId: string, gameId: string, kind: AlertKind, what: string): Promise<void> }

const DEFAULT_ORDERS: StandingOrders = { passWhenNothing: true, passWhenUninvolved: false };

function inviteCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}

// ------------------------------------------------------------------ lobby

export async function newTable(store: Store, host: { userId: string; name: string; illuminati: string }, opts: {
  seats: number; computerSeats?: number; aiLevel?: AiLevel; aiLevels?: AiLevel[]; settings?: Partial<GameSettings>;
}, notifier?: Notifier): Promise<GameRecord> {
  const seats: Seat[] = [{ id: 'p1', name: host.name, isAI: false, userId: host.userId, illuminati: host.illuminati }];
  const firstAi = opts.seats - (opts.computerSeats ?? 0) + 1;
  const levels = Array.from({ length: opts.computerSeats ?? 0 }, (_, k) => opts.aiLevels?.[k] ?? opts.aiLevel ?? 'normal');
  // Named computers, each with its own style; their Illuminati are picked when the game starts.
  const named = seatComputers(levels, Date.now() % 1e9);
  for (let i = 2; i <= opts.seats; i++) {
    const k = i - firstAi; // 0 for the first computer player
    seats.push(k >= 0 ? { id: `p${i}`, name: named[k].name, isAI: true, aiLevel: named[k].level, aiStyle: named[k].style.id } : { id: `p${i}`, name: '', isAI: false });
  }
  const now = Date.now();
  const rec: GameRecord = {
    id: `g${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, state: null, seats, orders: {},
    invite: inviteCode(), createdAt: now, updatedAt: now, settings: opts.settings ?? {},
  };
  maybeStart(rec);
  await store.put(rec);
  await notifyStart(rec, host.userId, notifier);
  return rec;
}

export async function joinTable(store: Store, code: string, who: { userId: string; name: string; illuminati: string }, notifier?: Notifier): Promise<GameRecord> {
  const rec = await store.getByInvite(code.toUpperCase());
  if (!rec) throw new RuleError('No game with that invite code.');
  if (rec.seats.some((s) => s.userId === who.userId)) return rec;
  const seat = rec.seats.find((s) => !s.isAI && !s.userId);
  if (!seat) throw new RuleError('That game is full.');
  const before = rec.updatedAt;
  Object.assign(seat, { userId: who.userId, name: who.name, illuminati: who.illuminati });
  maybeStart(rec); // the last seat was just filled: the game starts now
  rec.updatedAt = Date.now();
  await store.put(rec, before);
  await notifyStart(rec, who.userId, notifier);
  return rec;
}

function maybeStart(rec: GameRecord) {
  if (rec.state || rec.seats.some((s) => !s.isAI && !s.userId)) return;
  const seed = Math.floor(Math.random() * 2 ** 31);
  const used = new Set(rec.seats.map((s) => s.illuminati).filter(Boolean));
  rec.state = createGame({
    id: rec.id, seed, settings: rec.settings, chooseLeads: true,
    players: rec.seats.map((s, i) => {
      let ill = s.illuminati;
      if (!ill) {
        // A named computer takes an Illuminati that suits its style when one is free.
        ill = [...(styleById(s.aiStyle)?.favours ?? []), 'bavarian-illuminati', 'gnomes-of-zurich', 'the-network', 'servants-of-cthulhu', 'discordian-society', 'ufos', 'shangri-la', 'adepts-of-hermes', 'bermuda-triangle'].find((x) => !used.has(x))!;
        used.add(ill);
      }
      return { id: s.id, name: s.name, isAI: s.isAI, aiLevel: s.aiLevel, aiStyle: s.aiStyle, deck: randomDeck(seed + i, ill) };
    }),
  });
  rec.state = settle(rec, rec.state);
}

// ------------------------------------------------------------------ moves

/** Apply one player's move, then let computer players and standing orders run. */
export async function submit(store: Store, gameId: string, userId: string, action: Action, notifier?: Notifier): Promise<GameRecord> {
  const rec = await store.get(gameId);
  if (!rec || !rec.state) throw new RuleError('That game has not started.');
  const seat = rec.seats.find((s) => s.userId === userId);
  if (!seat) throw new RuleError('You are not playing in this game.');
  const before = rec.updatedAt;
  const snapshot = alertSnapshot(rec.state);
  let s = applyAction(rec.state, seat.id, action);
  s = settle(rec, s);
  rec.state = s;
  rec.updatedAt = Date.now();
  await store.put(rec, before); // a stale write means two moves raced: the client retries
  await notifyNew(rec, snapshot, notifier, userId);
  return rec;
}

/**
 * The host (who created the game) may delete it at any time, for everyone. Anyone else may leave a
 * game that has not started yet, which frees their seat for someone new.
 */
export async function deleteOrLeave(store: Store, gameId: string, userId: string): Promise<'deleted' | 'left'> {
  const rec = await store.get(gameId);
  if (!rec) throw new RuleError('No such game.');
  const seat = rec.seats.find((s) => s.userId === userId);
  if (!seat) throw new RuleError('You are not playing in this game.');
  if (seat.id === rec.seats[0].id) { await store.delete(gameId); return 'deleted'; }
  if (rec.state) throw new RuleError('Only the player who created this game can delete it once it has started.');
  const before = rec.updatedAt;
  Object.assign(seat, { userId: undefined, name: '', illuminati: undefined });
  rec.updatedAt = Date.now();
  await store.put(rec, before);
  return 'left';
}

export async function setOrders(store: Store, gameId: string, userId: string, orders: Partial<StandingOrders>): Promise<GameRecord> {
  const rec = await store.get(gameId);
  if (!rec) throw new RuleError('No such game.');
  const seat = rec.seats.find((s) => s.userId === userId);
  if (!seat) throw new RuleError('You are not playing in this game.');
  const before = rec.updatedAt;
  rec.orders[seat.id] = { ...DEFAULT_ORDERS, ...rec.orders[seat.id], ...orders };
  if (rec.state) rec.state = settle(rec, rec.state);
  rec.updatedAt = Date.now();
  await store.put(rec, before);
  return rec;
}

/** Run computer players and standing orders until a person has a real decision to make. */
export function settle(rec: GameRecord, state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 2000 && s.phase !== 'gameOver'; i++) {
    const waiting = waitingFor(s);
    const ai = waiting.find((id) => player(s, id).isAI);
    if (ai) {
      try { s = applyAction(s, ai, chooseAction(s, ai)); }
      catch { s = applyAction(s, ai, s.window ? { type: 'pass' } : s.prompt?.kind === 'takeover' ? { type: 'skipTakeover' } : { type: 'endTurn' }); }
      continue;
    }
    const auto = waiting.find((id) => s.window && autoPasses(rec, s, id));
    if (auto) { s = applyAction(s, auto, { type: 'pass' }); continue; }
    break;
  }
  return s;
}

function autoPasses(rec: GameRecord, s: GameState, pl: string): boolean {
  const o = rec.orders[pl] ?? DEFAULT_ORDERS;
  // Your own attack waits for you to roll the dice.
  if (s.window?.kind === 'attack' && s.attack?.attackerPlayer === pl) return false;
  if (o.passWhenNothing && !hasResponse(s, pl)) return true;
  if (o.passWhenUninvolved && s.attack && s.attack.attackerPlayer !== pl && s.attack.targetPlayer !== pl) return true;
  return false;
}

// ------------------------------------------------------------------ deadlines

/**
 * Called by a timer. Anyone who let a response window's deadline pass is treated as passing;
 * an active player who has not moved for `turnHours` has his turn ended for him.
 */
export async function tick(store: Store, now = Date.now(), turnHours = 72, notifier?: Notifier): Promise<number> {
  let changed = 0;
  for (const rec of await store.listWithDeadlines(now)) {
    let s = rec.state;
    if (!s || s.phase === 'gameOver') continue;
    const before = rec.updatedAt;
    const snapshot = alertSnapshot(s);
    if (s.window?.deadline && s.window.deadline < now) {
      for (const pl of waitingFor(s)) s = applyAction(s, pl, { type: 'pass' });
    } else if (now - rec.updatedAt > turnHours * 3600_000) {
      const pl = waitingFor(s)[0];
      const a: Action = s.prompt?.kind === 'takeover' ? { type: 'skipTakeover' } : s.prompt ? chooseAction(s, pl) : s.window ? { type: 'pass' } : { type: 'endTurn' };
      s = applyAction(s, pl, a);
    } else continue;
    rec.state = settle(rec, s);
    rec.updatedAt = now;
    await store.put(rec, before);
    await notifyNew(rec, snapshot, notifier);
    changed++;
  }
  return changed;
}

/** What mattered for alerts before a move: whose turn it was, and which Attack to Destroy was open. */
interface AlertSnapshot { turn: number; active: string; destroyAttack?: number }

function alertSnapshot(s: GameState): AlertSnapshot {
  return { turn: s.turn, active: s.players[s.active]?.id, destroyAttack: destroyAttackOf(s)?.id };
}

function destroyAttackOf(s: GameState) {
  return s.attack?.type === 'destroy' && s.attack.targetPlayer ? s.attack : undefined;
}

/**
 * Alerts go out only for moments worth leaving the app for: a player's turn beginning, and an
 * Attack to Destroy aimed at one of their Groups. `actor` (who just moved, and is looking at the
 * game) is never alerted. Everything else is left to the in-app list.
 */
async function notifyNew(rec: GameRecord, before: AlertSnapshot, notifier?: Notifier, actor?: string) {
  if (!notifier || !rec.state || rec.state.phase === 'gameOver') return;
  const s = rec.state;
  const seatOf = (id: string) => rec.seats.find((x) => x.id === id);
  const send = async (id: string, kind: AlertKind, what: string) => {
    const seat = seatOf(id);
    if (!seat?.userId || seat.isAI || seat.userId === actor) return;
    try { await notifier.alert(seat.userId, rec.id, kind, what); } catch { /* an alert must never break a move */ }
  };
  const active = s.players[s.active]?.id;
  if (active && (s.turn !== before.turn || active !== before.active)) await send(active, 'yourTurn', 'It is your turn');
  const atk = destroyAttackOf(s);
  if (atk && atk.id !== before.destroyAttack && waitingFor(s).includes(atk.targetPlayer!)) {
    await send(atk.targetPlayer!, 'destroyAttack', `${def(s, atk.target).name} is under an Attack to Destroy`);
  }
}

/** The lobby just filled and the game began: tell everyone except the player who completed it. */
async function notifyStart(rec: GameRecord, actor: string, notifier?: Notifier) {
  if (!notifier || !rec.state) return;
  for (const seat of rec.seats) {
    if (!seat.userId || seat.isAI || seat.userId === actor) continue;
    try { await notifier.alert(seat.userId, rec.id, 'gameStarted', 'Your game has started'); } catch { /* ignore */ }
  }
}

// ------------------------------------------------------------------ what each player may see

/**
 * The game as `viewer` is allowed to see it: rivals' hidden hand cards, Plots hidden beneath a card
 * (Texas, Fidel Castro), Resources face down under Warehouse 23, and every deck become anonymous
 * backs; secret notes (a card named in secret) are masked; and the random seed is removed so dice
 * cannot be predicted.
 */
export function viewFor(s: GameState, viewer: string): GameState {
  const v: GameState = structuredClone(s);
  v.rng = 0;
  const hide = (iid: string) => {
    const c = v.cards[iid];
    const kind = def(s, iid).type === 'Plot' ? 'hidden-plot' : 'hidden-group';
    v.cards[iid] = { iid, cardId: kind, owner: c.owner, zone: c.zone, tokens: 0, mods: [] };
  };
  const known = new Set(s.players.find((p) => p.id === viewer)?.known ?? []);
  for (const p of v.players) {
    for (const iid of [...p.plotDeck, ...p.groupDeck]) if (!known.has(iid)) hide(iid);
    // A Plot hidden beneath a card is never shown to rivals, even if it was exposed or seen before.
    if (p.id !== viewer) for (const iid of p.hand) if ((!v.cards[iid].exposed && !known.has(iid)) || !canExpose(s, iid)) hide(iid);
    if (p.id !== viewer) p.known = [];
  }
  // Private log lines (what a player saw with a card) go only to that player.
  v.log = v.log.filter((l) => !l.to || l.to === viewer);
  // Someone else's decision may show their hidden cards as options: others only see that they are choosing.
  const hideChoice = (pr?: GameState['prompt']) => {
    if (pr?.choice && pr.player !== viewer) pr.choice = { ...pr.choice, options: [], question: 'Another player is making a choice.' };
  };
  hideChoice(v.prompt);
  // An announced ability that secretly names a card keeps that choice from rivals while others respond.
  const hideAnnounced = (e?: { player?: string; data?: Record<string, unknown> }) => {
    const a = e?.data?.action as { type?: string; card?: string; ability?: string; params?: { target?: string } } | undefined;
    if (!e || e.player === viewer || a?.type !== 'useAbility' || !a.params?.target || !a.card || !s.cards[a.card]) return;
    const ab = HOOKS[s.cards[a.card].cardId]?.actions?.find((x) => x.id === a.ability);
    const t = s.cards[a.params.target];
    const hidden = t && (t.zone === 'hand' || t.zone === 'plotDeck' || t.zone === 'groupDeck') && !t.exposed;
    if (ab?.secret || hidden) a.params = { ...a.params, target: undefined };
  };
  hideAnnounced(v.window?.event);
  for (const e of v.events ?? []) hideAnnounced(e);
  for (const q of v.promptQueue ?? []) hideChoice(q);
  // Resources face down under Warehouse 23: rivals see only a card back where it lies.
  for (const c of Object.values(s.cards)) {
    if (c.zone !== 'resources' || !c.hiddenUnder || c.controller === viewer) continue;
    v.cards[c.iid] = { iid: c.iid, cardId: 'hidden-resource', owner: c.owner, zone: c.zone, controller: c.controller, linkedTo: c.linkedTo, hiddenUnder: c.hiddenUnder, tokens: 0, mods: [] };
  }
  // A Goal or note written under a card (a card named in secret) stays secret, even once the card has
  // left play: only its controller (or, out of play, its owner) sees it.
  for (const c of Object.values(v.cards)) if (c.note && (c.controller ?? c.owner) !== viewer) c.note = '(secret)';
  if (v.setup) for (const k of Object.keys(v.setup.picks)) if (k !== viewer && v.setup.picks[k]) v.setup.picks[k] = 'chosen';
  return v;
}
