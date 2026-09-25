// Computer players and deals, and deals in online games (see tests/deals.test.ts for the rules).
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, def, waitingFor, type Action, type GameState } from '../src/engine';
import { randomDeck } from '../src/engine/decks';
import { joinTable, newTable, submit } from '../src/server/service';
import { handle } from '../src/server/api';
import { MemoryStore } from '../src/server/memoryStore';
import { answerOffer, applyDealAnswer, chooseAction, computerDealAnswer } from '../src/ai/ai';
import { checkInvariants, give, scenario } from './helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const lastDeal = (s: GameState) => s.deals![s.deals!.length - 1];
const ai = (s: GameState, id: string, style?: string) => Object.assign(P(s, id), { isAI: true, aiLevel: 'normal', aiStyle: style });

describe('computer players and deals', () => {
  it('accepts a clearly good deal and turns down a bad one', () => {
    let s = scenario();
    ai(s, 'p2', 'book');
    const a = give(s, 'p1', 'swiss-bank-account', { hand: true });
    const b = give(s, 'p1', 'benefit-concert', { hand: true });
    const c = give(s, 'p2', 'hoax', { hand: true });
    give(s, 'p2', 'secrets-man-was-not-meant-to-know', { hand: true });
    // Two Plots for one of its choice: good.
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [a, b] }, get: { anyPlots: 1 } });
    expect(answerOffer(s, 'p2', lastDeal(s))).toMatchObject({ type: 'respondDeal', accept: true });
    s = act(s, 'p1', { type: 'cancelDeal', deal: lastDeal(s).id });
    // Two of its Plots for nothing: bad.
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: {}, get: { anyPlots: 2 } });
    expect(answerOffer(s, 'p2', lastDeal(s))).toMatchObject({ type: 'respondDeal', accept: false });
    s = act(s, 'p1', { type: 'cancelDeal', deal: lastDeal(s).id });
    // A gift is welcome, and the answer is applied at once.
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [a] }, get: {} });
    s = applyDealAnswer(s, computerDealAnswer(s)!);
    expect(P(s, 'p2').hand).toContain(a);
    expect(P(s, 'p2').hand).toContain(c);
    expect(s.deals).toHaveLength(0);
  });

  it('does not feed a rival about to win', () => {
    let s = scenario();
    ai(s, 'p2', 'book');
    const a = give(s, 'p1', 'swiss-bank-account', { hand: true });
    const b = give(s, 'p1', 'benefit-concert', { hand: true });
    give(s, 'p2', 'hoax', { hand: true });
    give(s, 'p2', 'punk-rockers', { hand: true });
    const fair = structuredClone(s);
    // p1 one Group short of the Basic Goal.
    let master = P(s, 'p1').illuminati;
    for (let i = 0; i < 10; i++) master = give(s, 'p1', 'punk-rockers', { under: master, side: 'BOTTOM' });
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [a, b] }, get: { anyPlots: 1 } });
    expect(answerOffer(s, 'p2', lastDeal(s))).toMatchObject({ accept: false });
    // The same offer from a rival who is nowhere near winning is taken.
    const f = act(fair, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [a, b] }, get: { anyPlots: 1 } });
    expect(answerOffer(f, 'p2', lastDeal(f))).toMatchObject({ accept: true });
  });

  it('wild cards accept or decline at random', () => {
    const answers = new Set<boolean>();
    for (let k = 0; k < 12; k++) {
      let s = scenario();
      ai(s, 'p2', 'chaos');
      const a = give(s, 'p1', 'swiss-bank-account', { hand: true });
      give(s, 'p2', 'hoax', { hand: true });
      s.dealCounter = k;
      s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [a] }, get: { anyPlots: 1 } });
      answers.add((answerOffer(s, 'p2', lastDeal(s)) as { accept: boolean }).accept);
    }
    expect([...answers].sort()).toEqual([false, true]);
  });

  it('a four-player computer game with deals plays to a legal finish', () => {
    let offers = 0, done = 0, agreed = 0;
    for (const seed of [5, 6]) {
      let s = createGame({ seed, players: ['meddler', 'kingslayer', 'collector', 'book'].map((st, i) => ({ id: `p${i + 1}`, name: st, isAI: true, aiLevel: 'normal' as const, aiStyle: st, deck: randomDeck(seed * 13 + i) })) });
      for (let step = 0; step < 8000 && s.phase !== 'gameOver' && s.turn < 150; step++) {
        const ans = computerDealAnswer(s);
        if (ans) { s = applyDealAnswer(s, ans); if ((ans.action as { accept?: boolean }).accept) agreed++; checkInvariants(s); continue; }
        const who = waitingFor(s)[0];
        const a = chooseAction(s, who);
        if (a.type === 'offerDeal') offers++;
        s = act(s, who, a);
        checkInvariants(s);
      }
      if (s.phase === 'gameOver') done++;
      expect(s.deals ?? []).toHaveLength(0);
    }
    console.log(`deal offers made: ${offers}, deals agreed: ${agreed}`);
    expect(done).toBe(2);
    expect(offers).toBeGreaterThan(0);
    expect(agreed).toBeGreaterThan(0);
  }, 120_000);
});

/** Play until p1 is free in his own main phase and everyone has had a turn. */
async function toAnnsMainPhase(store: MemoryStore, id: string, users: Record<string, string>) {
  let rec = (await store.get(id))!;
  for (let i = 0; i < 400; i++) {
    const s = rec.state!;
    if (s.phase === 'main' && s.players[s.active].id === 'p1' && !s.window && !s.prompt && !s.attack && s.players.every((p) => p.turnsTaken > 0)) break;
    const who = waitingFor(s)[0];
    rec = await submit(store, id, users[who], s.window ? { type: 'pass' } : s.prompt ? chooseAction(s, who) : { type: 'endTurn' });
  }
  return rec;
}

describe('deals online', () => {
  it('an offer goes through the service like any move; only the two players see it, and the answer completes it', async () => {
    const store = new MemoryStore();
    const t = await newTable(store, { userId: 'ann', name: 'Ann', illuminati: 'bavarian-illuminati' }, { seats: 3 });
    await joinTable(store, t.invite, { userId: 'bob', name: 'Bob', illuminati: 'ufos' });
    await joinTable(store, t.invite, { userId: 'cat', name: 'Cat', illuminati: 'the-network' });
    const rec = await toAnnsMainPhase(store, t.id, { p1: 'ann', p2: 'bob', p3: 'cat' });
    const s = rec.state!;
    expect(s.players[s.active].id).toBe('p1');
    const plot = s.players[0].hand.find((c) => def(s, c).type === 'Plot')!;
    const bobsBefore = s.players[1].hand.length;
    const r1 = await handle(store, 'ann', { op: 'move', gameId: t.id, action: { type: 'offerDeal', to: 'p2', give: { cards: [plot] }, get: {}, note: 'Remember this.' } }) as { state: GameState };
    expect(r1.state.deals).toHaveLength(1);
    const bob = await handle(store, 'bob', { op: 'view', gameId: t.id }) as { state: GameState; game: { offers: number } };
    expect(bob.game.offers).toBe(1);
    expect(bob.state.deals![0].note).toBe('Remember this.');
    expect(bob.state.cards[plot].cardId).not.toMatch(/^hidden/);
    const cat = await handle(store, 'cat', { op: 'view', gameId: t.id }) as { state: GameState };
    expect(cat.state.deals ?? []).toHaveLength(0);
    expect(cat.state.cards[plot].cardId).toBe('hidden-plot');
    const r2 = await handle(store, 'bob', { op: 'move', gameId: t.id, action: { type: 'respondDeal', deal: bob.state.deals![0].id, accept: true } }) as { state: GameState };
    expect(r2.state.players[1].hand).toContain(plot);
    expect(r2.state.players[1].hand.length).toBe(bobsBefore + 1);
    const cat2 = await handle(store, 'cat', { op: 'view', gameId: t.id }) as { state: GameState };
    expect(cat2.state.cards[plot].cardId).toBe('hidden-plot');
    expect(cat2.state.log.some((l) => /Ann hands Bob 1 card from hand/.test(l.text))).toBe(true);
  });

  it('a computer seat answers an offer at once, so the game never waits on it', async () => {
    const store = new MemoryStore();
    const t = await newTable(store, { userId: 'ann', name: 'Ann', illuminati: 'bavarian-illuminati' }, { seats: 2, computerSeats: 1 });
    let rec = await toAnnsMainPhase(store, t.id, { p1: 'ann' });
    const s = rec.state!;
    const plot = s.players[0].hand.find((c) => def(s, c).type === 'Plot')!;
    rec = await submit(store, t.id, 'ann', { type: 'offerDeal', to: 'p2', give: { cards: [plot] }, get: {} });
    expect(rec.state!.deals ?? []).toHaveLength(0);
    expect(rec.state!.players[1].hand).toContain(plot);
  });
});
