// Online play service, independent of any hosting provider. It keeps the authoritative game,
// checks every move with the rules engine, hides what each player must not see, moves computer
// players, applies standing orders and response deadlines. A host only needs to supply a Store
// (database) and call these functions from its API routes and a periodic timer.
import {
  type Action, type GameState, type GameSettings, applyAction, createGame, hasResponse, player, waitingFor, randomDeck,
  RuleError, def,
} from '../engine';
import { chooseAction } from '../ai/ai';

export interface Seat { id: string; name: string; isAI: boolean; userId?: string; illuminati?: string }

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
}

export interface Notifier { yourMove(userId: string, gameId: string, what: string): Promise<void> }

const DEFAULT_ORDERS: StandingOrders = { passWhenNothing: true, passWhenUninvolved: false };

function inviteCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}

// ------------------------------------------------------------------ lobby

export async function newTable(store: Store, host: { userId: string; name: string; illuminati: string }, opts: {
  seats: number; computerSeats?: number; settings?: Partial<GameSettings>;
}): Promise<GameRecord> {
  const seats: Seat[] = [{ id: 'p1', name: host.name, isAI: false, userId: host.userId, illuminati: host.illuminati }];
  for (let i = 2; i <= opts.seats; i++) {
    const ai = i > opts.seats - (opts.computerSeats ?? 0);
    seats.push({ id: `p${i}`, name: ai ? `Computer ${i - 1}` : '', isAI: ai });
  }
  const now = Date.now();
  const rec: GameRecord = {
    id: `g${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, state: null, seats, orders: {},
    invite: inviteCode(), createdAt: now, updatedAt: now, settings: opts.settings ?? {},
  };
  maybeStart(rec);
  await store.put(rec);
  return rec;
}

export async function joinTable(store: Store, code: string, who: { userId: string; name: string; illuminati: string }): Promise<GameRecord> {
  const rec = await store.getByInvite(code.toUpperCase());
  if (!rec) throw new RuleError('No game with that invite code.');
  if (rec.seats.some((s) => s.userId === who.userId)) return rec;
  const seat = rec.seats.find((s) => !s.isAI && !s.userId);
  if (!seat) throw new RuleError('That game is full.');
  const before = rec.updatedAt;
  Object.assign(seat, { userId: who.userId, name: who.name, illuminati: who.illuminati });
  maybeStart(rec);
  rec.updatedAt = Date.now();
  await store.put(rec, before);
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
        ill = ['bavarian-illuminati', 'gnomes-of-zurich', 'the-network', 'servants-of-cthulhu', 'discordian-society', 'ufos', 'shangri-la', 'adepts-of-hermes', 'bermuda-triangle'].find((x) => !used.has(x))!;
        used.add(ill);
      }
      return { id: s.id, name: s.name, isAI: s.isAI, deck: randomDeck(seed + i, ill) };
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
  const waitingBefore = new Set(waitingFor(rec.state));
  let s = applyAction(rec.state, seat.id, action);
  s = settle(rec, s);
  rec.state = s;
  rec.updatedAt = Date.now();
  await store.put(rec, before); // a stale write means two moves raced: the client retries
  await notifyNew(rec, waitingBefore, notifier);
  return rec;
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
    const waitingBefore = new Set(waitingFor(s));
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
    await notifyNew(rec, waitingBefore, notifier);
    changed++;
  }
  return changed;
}

async function notifyNew(rec: GameRecord, before: Set<string>, notifier?: Notifier) {
  if (!notifier || !rec.state) return;
  for (const id of waitingFor(rec.state)) {
    if (before.has(id)) continue;
    const seat = rec.seats.find((x) => x.id === id);
    if (seat?.userId) await notifier.yourMove(seat.userId, rec.id, describeWait(rec.state, id));
  }
}

function describeWait(s: GameState, id: string): string {
  if (s.prompt?.player === id) return s.prompt.kind === 'takeover' ? 'Your turn: automatic takeover' : 'A decision is waiting for you';
  if (s.attack) return `${def(s, s.attack.target).name} is under attack — respond`;
  if (s.window?.kind === 'plot') return 'A Plot was played — respond';
  return 'Your turn';
}

// ------------------------------------------------------------------ what each player may see

/**
 * The game as `viewer` is allowed to see it: rivals' hidden hand cards and every deck become
 * anonymous backs, and the random seed is removed so dice cannot be predicted.
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
    if (p.id !== viewer) for (const iid of p.hand) if (!v.cards[iid].exposed && !known.has(iid)) hide(iid);
    if (p.id !== viewer) p.known = [];
  }
  // Private log lines (what a player saw with a card) go only to that player.
  v.log = v.log.filter((l) => !l.to || l.to === viewer);
  // Someone else's decision may show their hidden cards as options: others only see that they are choosing.
  const hideChoice = (pr?: GameState['prompt']) => {
    if (pr?.choice && pr.player !== viewer) pr.choice = { ...pr.choice, options: [], question: 'Another player is making a choice.' };
  };
  hideChoice(v.prompt);
  for (const q of v.promptQueue ?? []) hideChoice(q);
  // A Goal or note written under a card stays secret.
  for (const c of Object.values(v.cards)) if (c.note && c.controller !== viewer) c.note = '(secret)';
  if (v.setup) for (const k of Object.keys(v.setup.picks)) if (k !== viewer && v.setup.picks[k]) v.setup.picks[k] = 'chosen';
  return v;
}
