import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/server/memoryStore';
import { joinTable, newTable, setOrders, submit, tick, viewFor } from '../src/server/service';
import { waitingFor } from '../src/engine';

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
