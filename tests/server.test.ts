import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/server/memoryStore';
import { joinTable, newTable, setOrders, submit, tick, viewFor } from '../src/server/service';
import { applyAction, openArrows, waitingFor, type Action, type GameState } from '../src/engine';
import { give, scenario } from './helpers';
import type { AiLevel } from '../src/engine';
import { emptyHabits, emptyProfile, foldGame, mirrorStyle, type PlayProfile } from '../src/ai/profile';
import { STYLE_RANGES, STYLES } from '../src/ai/personas';

describe('online play service', () => {
  it('starts a game once a friend joins with the invite code, and hides each hand from the other player', async () => {
    const store = new MemoryStore();
    const t = await newTable(store, { userId: 'ann', name: 'Ann', illuminati: 'bavarian-illuminati' }, { seats: 2 });
    expect(t.state).toBeNull();
    const g = await joinTable(store, t.invite, { userId: 'bob', name: 'Bob', illuminati: 'ufos' });
    expect(g.state).not.toBeNull();
    expect(g.state!.phase).toBe('setup');
    const annView = viewFor(g.state!, 'p1');
    const bobHand = annView.players[1].hand;
    expect(bobHand.every((i) => annView.cards[i].cardId.startsWith('hidden'))).toBe(true);
    expect(annView.players[0].hand.some((i) => !annView.cards[i].cardId.startsWith('hidden'))).toBe(true);
    expect(annView.rng).toBe(0);
  });

  it('rejects moves out of turn and from strangers', async () => {
    const store = new MemoryStore();
    const t = await newTable(store, { userId: 'ann', name: 'Ann', illuminati: 'bavarian-illuminati' }, { seats: 2 });
    await joinTable(store, t.invite, { userId: 'bob', name: 'Bob', illuminati: 'ufos' });
    await expect(submit(store, t.id, 'eve', { type: 'endTurn' })).rejects.toThrow(/not playing/);
    const rec = (await store.get(t.id))!;
    const other = waitingFor(rec.state!)[0] === 'p1' ? 'bob' : 'ann';
    await expect(submit(store, t.id, other, { type: 'endTurn' })).rejects.toThrow();
  });

  it('plays a full game against a computer seat through the service', async () => {
    const store = new MemoryStore();
    const t = await newTable(store, { userId: 'ann', name: 'Ann', illuminati: 'the-network' }, { seats: 2, computerSeats: 1 });
    expect(t.state).not.toBeNull();
    let rec = t;
    for (let i = 0; i < 3000 && rec.state!.phase !== 'gameOver'; i++) {
      const s = rec.state!;
      const { chooseAction } = await import('../src/ai/ai');
      rec = await submit(store, t.id, 'ann', chooseAction(s, waitingFor(s)[0]));
    }
    expect(rec.state!.phase).toBe('gameOver');
  }, 60_000);

  it('passes for a player whose response deadline has run out', async () => {
    const store = new MemoryStore();
    const t = await newTable(store, { userId: 'ann', name: 'Ann', illuminati: 'bavarian-illuminati' }, { seats: 2 });
    await joinTable(store, t.invite, { userId: 'bob', name: 'Bob', illuminati: 'ufos' });
    await setOrders(store, t.id, 'ann', { passWhenNothing: false });
    await setOrders(store, t.id, 'bob', { passWhenNothing: false });
    const changed = await tick(store, Date.now() + 1000 * 3600 * 1000, 72);
    expect(changed).toBeGreaterThanOrEqual(1);
  });
});

describe('website API handler', () => {
  it('creates, lists, joins, views and moves', async () => {
    const { handle } = await import('../src/server/api');
    const store = new MemoryStore();
    const made = await handle(store, 'u1', { op: 'new', name: 'Ann', illuminati: 'ufos', seats: 2 }) as { game: { invite: string; id: string; started: boolean } };
    expect(made.game.started).toBe(false);
    const joined = await handle(store, 'u2', { op: 'join', code: made.game.invite, name: 'Bob', illuminati: 'the-network' }) as { game: { started: boolean; me: string }; state: { players: { hand: string[] }[] } };
    expect(joined.game.started).toBe(true);
    expect(joined.game.me).toBe('p2');
    const list = await handle(store, 'u1', { op: 'list' }) as { games: unknown[] };
    expect(list.games.length).toBe(1);
    await expect(handle(store, 'u3', { op: 'view', gameId: made.game.id })).rejects.toThrow(/not found/);
  });
});

describe('deleting and leaving games', () => {
  it('lets the host delete a game for everyone, and others only leave one that has not started', async () => {
    const { deleteOrLeave } = await import('../src/server/service');
    const store = new MemoryStore();
    const t = await newTable(store, { userId: 'ann', name: 'Ann', illuminati: 'bavarian-illuminati' }, { seats: 3 });
    await joinTable(store, t.invite, { userId: 'bob', name: 'Bob', illuminati: 'ufos' });
    expect(await deleteOrLeave(store, t.id, 'bob')).toBe('left');
    expect((await store.get(t.id))!.seats.some((x) => x.userId === 'bob')).toBe(false);
    await expect(deleteOrLeave(store, t.id, 'eve')).rejects.toThrow(/not playing/);
    // Once it has started, only the host may remove it.
    await joinTable(store, t.invite, { userId: 'bob', name: 'Bob', illuminati: 'ufos' });
    await joinTable(store, t.invite, { userId: 'cat', name: 'Cat', illuminati: 'the-network' });
    expect((await store.get(t.id))!.state).not.toBeNull();
    await expect(deleteOrLeave(store, t.id, 'cat')).rejects.toThrow(/created this game/);
    expect(await deleteOrLeave(store, t.id, 'ann')).toBe('deleted');
    expect(await store.get(t.id)).toBeUndefined();
  });
});

describe('viewFor keeps hidden cards hidden', () => {
  const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
  const use = (s: GameState, pl: string, card: string, ability: string, params: Record<string, unknown> = {}) =>
    act(s, pl, { type: 'useAbility', card, ability, params });
  const illOf = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
  const put = (s: GameState, pl: string, cardId: string) => give(s, pl, cardId, { under: illOf(s, pl), side: openArrows(s, illOf(s, pl))[0] });
  const text = (v: GameState) => JSON.stringify(v.log);

  it('a Plot hidden beneath Texas is a card back to rivals, even if marked exposed or seen before', () => {
    let s = scenario();
    const tx = put(s, 'p2', 'texas');
    const x = give(s, 'p2', 'volcano', { hand: true });
    s.active = 1;
    s = use(s, 'p2', tx, 'hide', { target: x });
    s.active = 0;
    s.cards[x].exposed = true;
    s.players[0].known = [x];
    const rival = viewFor(s, 'p1');
    expect(rival.cards[x].cardId).toBe('hidden-plot');
    expect(text(rival)).not.toMatch(/Volcano/);
    expect(viewFor(s, 'p2').cards[x].cardId).toBe('volcano');
  });

  it('a Resource face down under Warehouse 23 is a card back to rivals only', () => {
    let s = scenario();
    const wh = give(s, 'p1', 'warehouse-23', { resource: true });
    const hc = give(s, 'p1', 'hidden-city', { hand: true });
    s = use(s, 'p1', wh, 'hide', { target: hc });
    const rival = viewFor(s, 'p2');
    expect(rival.cards[hc]).toMatchObject({ cardId: 'hidden-resource', zone: 'resources', controller: 'p1', hiddenUnder: wh });
    expect(text(rival)).not.toMatch(/Hidden City/);
    const mine = viewFor(s, 'p1');
    expect(mine.cards[hc].cardId).toBe('hidden-city');
    expect(text(mine)).toMatch(/Hidden City/);
    // Once turned face up, everyone sees it.
    s = use(s, 'p1', wh, 'reveal', { target: hc });
    expect(viewFor(s, 'p2').cards[hc].cardId).toBe('hidden-city');
  });

  it('the Place named by the Holy Grail stays secret from rivals, in the log and on the card', () => {
    let s = scenario();
    const r = give(s, 'p1', 'the-holy-grail', { resource: true });
    const hawaii = put(s, 'p2', 'hawaii');
    s = use(s, 'p1', r, 'name', { target: hawaii });
    const rival = viewFor(s, 'p2');
    expect(rival.cards[r].note).toBe('(secret)');
    expect(text(rival)).not.toMatch(/Hawaii/);
    const mine = viewFor(s, 'p1');
    expect(mine.cards[r].note).toBe(hawaii);
    expect(text(mine)).toMatch(/Hawaii/);
    // Still secret after the Grail leaves play.
    Object.assign(s.cards[r], { zone: 'discard', controller: undefined });
    expect(viewFor(s, 'p2').cards[r].note).toBe('(secret)');
    expect(viewFor(s, 'p1').cards[r].note).toBe(hawaii);
  });

  it('a secret choice announced for others to answer is hidden from rivals', () => {
    const s = scenario();
    const r = give(s, 'p1', 'the-holy-grail', { resource: true });
    const hawaii = put(s, 'p2', 'hawaii');
    const action = { type: 'useAbility', card: r, ability: 'name', params: { target: hawaii } };
    s.window = { kind: 'event', passed: [], event: { type: 'action', player: 'p1', data: { action } } } as GameState['window'];
    const seen = (v: GameState) => (v.window!.event!.data!.action as typeof action).params.target;
    expect(seen(viewFor(s, 'p2'))).toBeUndefined();
    expect(seen(viewFor(s, 'p1'))).toBe(hawaii);
    expect(s.window!.event!.data!.action).toEqual(action); // the real game state is untouched
  });
});

describe('mirrors online', () => {
  const games = (n: number, odds = 0.25): PlayProfile => {
    let p = emptyProfile();
    for (let g = 0; g < n; g++) p = foldGame(p, { ...emptyHabits(), turns: 8, attacks: 4, chanceSum: odds * 4, control: 3, destroy: 1 }, { won: false, illuminati: g ? 'ufos' : 'shangri-la', gameId: `old${g}`, now: 1 });
    return p;
  };
  type Bot = { name: string; level: AiLevel; style: string };

  it('folds a finished game into each person\'s stored profile, once', async () => {
    const store = new MemoryStore();
    const t = await newTable(store, { userId: 'ann', name: 'Ann', illuminati: 'the-network' }, { seats: 2, computerSeats: 1 });
    const rec = (await store.get(t.id))!;
    rec.state!.habits = { p1: { ...emptyHabits(), turns: 6, attacks: 2, chanceSum: 0.4 } as unknown as Record<string, unknown> };
    rec.state!.phase = 'gameOver'; rec.state!.winners = ['p1'];
    await store.put(rec);
    await setOrders(store, t.id, 'ann', { passWhenNothing: true });
    await setOrders(store, t.id, 'ann', { passWhenNothing: false });
    const p = (await store.getProfile('ann'))!;
    expect(p).toMatchObject({ games: 1, wins: 1 });
    expect(p.traits.odds!.v).toBeCloseTo(0.2);
    expect(p.illuminatiPicks).toEqual({ 'the-network': 1 });
    expect(store.profiles.size).toBe(1); // computers have no profile
    const { handle } = await import('../src/server/api');
    const r = await handle(store, 'ann', { op: 'profile' }) as { profile: { games: number; ready: boolean } };
    expect(r.profile).toMatchObject({ games: 1, ready: false });
  });

  it('never takes mirror knobs from the request: a mirror is made from the stored profile', async () => {
    const store = new MemoryStore();
    const forged = { name: 'Evil Twin', level: 'hard', style: 'mirror', aiStyleData: { risk: -5, mistakes: 0 } } as Bot;
    const styled = { name: 'Vex', level: 'normal', style: 'gambler', aiStyleData: { risk: -5 } } as Bot;
    // No profile yet: the mirror seat becomes an ordinary Hard computer, and no knobs get through.
    const a = await newTable(store, { userId: 'ann', name: 'Ann', illuminati: 'the-network' }, { seats: 3, computerSeats: 2, bots: [forged, styled] });
    expect(a.seats[1]).toMatchObject({ isAI: true, aiLevel: 'hard' });
    expect(a.seats[1].aiStyle).not.toBe('mirror');
    expect(a.seats.every((x) => !x.aiStyleData)).toBe(true);
    expect(a.state!.players.every((x) => !x.aiStyleData)).toBe(true);
    // With enough games stored, the seat is Ann's own mirror, with knobs from her profile.
    await store.setProfile('ann', games(3));
    const b = await newTable(store, { userId: 'ann', name: 'Ann', illuminati: 'the-network' }, { seats: 3, computerSeats: 2, bots: [forged, styled] });
    expect(b.seats[1]).toMatchObject({ name: "Ann's Shadow", aiLevel: 'hard', aiStyle: 'mirror' });
    expect(b.seats[1].aiStyleData!.risk).toBeGreaterThanOrEqual(STYLE_RANGES.risk[0]);
    expect(b.seats[2].aiStyleData).toBeUndefined();
    expect(b.state!.players[1].aiStyleData).toEqual(b.seats[1].aiStyleData);
    expect(b.state!.cards[b.state!.players[1].illuminati].cardId).toBe('shangri-la'); // Ann's second favourite
    expect(mirrorStyle(games(3)).risk).toBeLessThan(0);
  });

  it('random seats wait for every person, then draw from built-in players and everyone\'s mirrors', async () => {
    const store = new MemoryStore();
    await store.setProfile('bob', games(2));
    const random: Bot = { name: '', level: 'normal', style: 'random' };
    const t = await newTable(store, { userId: 'ann', name: 'Ann', illuminati: 'the-network' }, { seats: 6, computerSeats: 4, bots: [random, random, random, random] });
    expect(t.state).toBeNull();
    expect(t.seats.slice(2).every((x) => x.pending === 'random')).toBe(true);
    const g = await joinTable(store, t.invite, { userId: 'bob', name: 'Bob', illuminati: 'ufos' });
    expect(g.state).not.toBeNull();
    const bots = g.seats.slice(2);
    expect(bots).toHaveLength(4);
    expect(new Set(bots.map((x) => x.name)).size).toBe(4);
    for (const x of bots) {
      expect(x.pending).toBeUndefined();
      expect(x.aiLevel).toBe('normal');
      if (x.aiStyle === 'mirror') expect(x.name).toBe("Bob's Mirror"); // Ann has no games: only Bob's mirror is in the pool
      else expect(STYLES.map((st) => st.names.normal)).toContain(x.name);
    }
  });
});
