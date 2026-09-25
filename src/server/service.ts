// Online play service, independent of any hosting provider. It keeps the authoritative game,
// checks every move with the rules engine, hides what each player must not see, moves computer
// players, applies standing orders and response deadlines. A host only needs to supply a Store
// (database) and call these functions from its API routes and a periodic timer.
import {
  type Action, type AiLevel, type GameState, type GameSettings, applyAction, createGame, hasResponse, player, waitingFor, randomDeck,
  RuleError, def, HOOKS, canExpose,
} from '../engine';
import { chooseAction } from '../ai/ai';
import { seatComputers, styleById, WILD_CARDS } from '../ai/personas';
import { foldGame, habitsIn, mirrorSeats, noteAttacks, normalizeProfile, observeHuman, type MirrorSeat, type PlayProfile } from '../ai/profile';
import { resolveLineup, type BotSpec } from '../ui/lineup';

export interface Seat {
  id: string; name: string; isAI: boolean; aiLevel?: AiLevel; aiStyle?: string; userId?: string; illuminati?: string;
  /** A mirror's learned knobs: only ever made here, from a stored profile, never taken from a request. */
  aiStyleData?: Record<string, number | boolean | undefined>;
  /** Illuminati this computer would like (a mirror's player's second favourite). */
  preferIlluminati?: string;
  /** A seat filled when the game starts, once every person at the table is known. */
  pending?: 'random' | 'mirror';
  /** For a pending mirror: whose mirror (user id). */
  mirrorOf?: string;
}

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
  /** Set once the finished game has been folded into each person's play profile. */
  profilesFolded?: boolean;
}

export interface Store {
  get(id: string): Promise<GameRecord | undefined>;
  getByInvite(code: string): Promise<GameRecord | undefined>;
  put(rec: GameRecord, expectedUpdatedAt?: number): Promise<void>; // throws on a stale write
  listForUser(userId: string): Promise<GameRecord[]>;
  listWithDeadlines(before: number): Promise<GameRecord[]>;
  delete(id: string): Promise<void>;
  /** Each signed-in player's play profile (src/ai/profile.ts), which their mirrors are made from. */
  getProfile?(userId: string): Promise<PlayProfile | undefined>;
  setProfile?(userId: string, profile: PlayProfile): Promise<void>;
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

const LEVEL_NAME: Record<AiLevel, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const ALL_ILLUMINATI = ['bavarian-illuminati', 'gnomes-of-zurich', 'the-network', 'servants-of-cthulhu', 'discordian-society', 'ufos', 'shangri-la', 'adepts-of-hermes', 'bermuda-triangle'];

/**
 * Accept a computer seat from the client only if it is a real style and name (names are never free
 * text). A random seat ('random') or a mirror ('mirror') is only a placeholder here: it is filled when
 * the game starts, from the pool and the stored profiles. Nothing else a request sends is kept.
 */
function cleanBot(b?: { name: string; level: AiLevel; style: string }): { name: string; level: AiLevel; style: string; pending?: 'random' | 'mirror' } | undefined {
  if (!b) return undefined;
  const level: AiLevel = b.level === 'easy' || b.level === 'hard' ? b.level : 'normal';
  if (b.style === 'random') return { name: `Random ${LEVEL_NAME[level]} player`, level, style: 'random', pending: 'random' };
  if (b.style === 'mirror') return { name: `Mirror (${LEVEL_NAME[level]})`, level, style: 'mirror', pending: 'mirror' };
  if (b.style === 'chaos') {
    const w = WILD_CARDS.find((x) => b.name === x.name || b.name.startsWith(`${x.name} `));
    return w && { name: b.name.slice(0, 24), level: 'normal' as AiLevel, style: 'chaos' };
  }
  const st = styleById(b.style);
  return st && { name: b.name === `${st.names[level]} II` ? b.name : st.names[level], level, style: st.id };
}

export async function newTable(store: Store, host: { userId: string; name: string; illuminati: string }, opts: {
  seats: number; computerSeats?: number; aiLevel?: AiLevel; aiLevels?: AiLevel[]; bots?: { name: string; level: AiLevel; style: string }[]; settings?: Partial<GameSettings>;
}, notifier?: Notifier): Promise<GameRecord> {
  const seats: Seat[] = [{ id: 'p1', name: host.name, isAI: false, userId: host.userId, illuminati: host.illuminati }];
  const firstAi = opts.seats - (opts.computerSeats ?? 0) + 1;
  const levels = Array.from({ length: opts.computerSeats ?? 0 }, (_, k) => opts.aiLevels?.[k] ?? opts.aiLevel ?? 'normal');
  // Named computers, each with its own style; their Illuminati are picked when the game starts.
  const auto = seatComputers(levels, Date.now() % 1e9);
  // A line-up chosen on the setup screen wins over the automatic one.
  const named = levels.map((_, k) => cleanBot(opts.bots?.[k]) ?? { name: auto[k].name, level: auto[k].level, style: auto[k].style.id });
  for (let i = 2; i <= opts.seats; i++) {
    const k = i - firstAi; // 0 for the first computer player
    const b = named[k];
    seats.push(k >= 0 ? { id: `p${i}`, name: b.name, isAI: true, aiLevel: b.level, aiStyle: b.style, ...('pending' in b && b.pending ? { pending: b.pending, ...(b.pending === 'mirror' ? { mirrorOf: host.userId } : {}) } : {}) } : { id: `p${i}`, name: '', isAI: false });
  }
  const now = Date.now();
  const rec: GameRecord = {
    id: `g${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, state: null, seats, orders: {},
    invite: inviteCode(), createdAt: now, updatedAt: now, settings: opts.settings ?? {},
  };
  await fillPending(store, rec);
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
  await fillPending(store, rec);
  maybeStart(rec); // the last seat was just filled: the game starts now
  rec.updatedAt = Date.now();
  await store.put(rec, before);
  await notifyStart(rec, who.userId, notifier);
  return rec;
}

/**
 * Once every person has a seat, fill the random and mirror seats. A random seat of a level draws
 * from the whole pool of that level: the built-in players not already seated plus the mirrors of
 * every person at the table (those with enough games). A picked mirror is its picker's own, or a
 * random seat if they have too few games yet.
 */
async function fillPending(store: Store, rec: GameRecord) {
  if (rec.state || rec.seats.some((s) => !s.isAI && !s.userId)) return;
  const pending = rec.seats.filter((s) => s.pending);
  if (!pending.length) return;
  const seed = Math.floor(Math.random() * 2 ** 31);
  const byUser = new Map<string, MirrorSeat[]>();
  for (const [i, h] of rec.seats.filter((s) => !s.isAI && s.userId).entries()) {
    let profile: PlayProfile | undefined;
    try { profile = store.getProfile ? normalizeProfile(await store.getProfile(h.userId!)) : undefined; } catch { profile = undefined; }
    byUser.set(h.userId!, mirrorSeats(profile, seed + i, h.name, ALL_ILLUMINATI));
  }
  const everyone = [...byUser.values()].flat();
  const seated: BotSpec[] = rec.seats.filter((s) => s.isAI && !s.pending).map((s) => ({ name: s.name, level: s.aiLevel ?? 'normal', style: s.aiStyle ?? '' }));
  pending.forEach((seat, k) => {
    const level = seat.aiLevel ?? 'normal';
    const own = seat.pending === 'mirror' ? (byUser.get(seat.mirrorOf ?? '') ?? []).filter((m) => m.level === level) : [];
    const none = { easy: 0, normal: 0, hard: 0, wild: 0 };
    const [b] = own.length
      ? resolveLineup({ picked: [`mirror:${level}`], random: none }, seed + k, { mirrors: own, seated })
      : resolveLineup({ picked: [], random: { ...none, [level]: 1 } }, seed + k, { mirrors: everyone, seated });
    Object.assign(seat, { name: b.name, aiLevel: b.level, aiStyle: b.style, aiStyleData: b.data, preferIlluminati: b.illuminati });
    delete seat.pending; delete seat.mirrorOf;
    if (!seat.aiStyleData) delete seat.aiStyleData;
    if (!seat.preferIlluminati) delete seat.preferIlluminati;
    seated.push(b);
  });
}

function maybeStart(rec: GameRecord) {
  if (rec.state || rec.seats.some((s) => (!s.isAI && !s.userId) || s.pending)) return;
  const seed = Math.floor(Math.random() * 2 ** 31);
  const used = new Set(rec.seats.map((s) => s.illuminati).filter(Boolean));
  rec.state = createGame({
    id: rec.id, seed, settings: rec.settings, chooseLeads: true,
    players: rec.seats.map((s, i) => {
      let ill = s.illuminati;
      if (!ill) {
        // A named computer takes an Illuminati that suits its style when one is free (a mirror, its player's second favourite).
        ill = [...(s.preferIlluminati ? [s.preferIlluminati] : []), ...(styleById(s.aiStyle)?.favours ?? []), ...ALL_ILLUMINATI].find((x) => !used.has(x))!;
        used.add(ill);
      }
      return { id: s.id, name: s.name, isAI: s.isAI, aiLevel: s.aiLevel, aiStyle: s.aiStyle, aiStyleData: s.isAI ? s.aiStyleData : undefined, deck: randomDeck(seed + i, ill) };
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
  observeHuman(rec.state, s, seat.id, action); // habits for this player's mirror
  s = settle(rec, s);
  rec.state = s;
  rec.updatedAt = Date.now();
  await foldProfiles(store, rec);
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
  await foldProfiles(store, rec);
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
      noteAttacks(s); // attacks on people, and how their own attacks ended
      continue;
    }
    const auto = waiting.find((id) => s.window && autoPasses(rec, s, id));
    if (auto) { s = applyAction(s, auto, { type: 'pass' }); noteAttacks(s); continue; }
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

/**
 * A finished game is folded into each signed-in player's profile, once (the record remembers, and
 * the profile itself ignores a game it already has, should the save that follows be retried).
 */
async function foldProfiles(store: Store, rec: GameRecord) {
  const s = rec.state;
  if (!s || s.phase !== 'gameOver' || rec.profilesFolded || !store.getProfile || !store.setProfile) return;
  rec.profilesFolded = true;
  for (const seat of rec.seats) {
    const p = s.players.find((x) => x.id === seat.id);
    if (seat.isAI || !seat.userId || !p) continue;
    try {
      const cur = normalizeProfile(await store.getProfile(seat.userId));
      await store.setProfile(seat.userId, foldGame(cur, habitsIn(s, seat.id), { won: !!s.winners?.includes(seat.id), illuminati: s.cards[p.illuminati]?.cardId, gameId: rec.id }));
    } catch { /* a profile must never break a move */ }
  }
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
    noteAttacks(s);
    rec.state = settle(rec, s);
    rec.updatedAt = now;
    await foldProfiles(store, rec);
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
  // Each player sees only their own habits.
  if (v.habits) for (const k of Object.keys(v.habits)) if (k !== viewer) delete v.habits[k];
  if (v.setup) for (const k of Object.keys(v.setup.picks)) if (k !== viewer && v.setup.picks[k]) v.setup.picks[k] = 'chosen';
  return v;
}
