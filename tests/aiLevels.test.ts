// Computer difficulty levels: each plays whole games legally, and the level is kept in the game.
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, waitingFor, type AiLevel } from '../src/engine';
import { randomDeck } from '../src/engine/decks';
import { chooseAction, PROFILES } from '../src/ai/ai';
import { MemoryStore } from '../src/server/memoryStore';
import { newTable } from '../src/server/service';
import { checkInvariants } from './helpers';

function play(a: AiLevel, b: AiLevel, seed: number) {
  let s = createGame({ seed, players: [
    { id: 'p1', name: 'A', isAI: true, aiLevel: a, deck: randomDeck(seed * 7 + 1) },
    { id: 'p2', name: 'B', isAI: true, aiLevel: b, deck: randomDeck(seed * 7 + 2) }] });
  for (let i = 0; i < 6000 && s.phase !== 'gameOver' && s.turn < 120; i++) {
    const w = waitingFor(s)[0];
    s = applyAction(s, w, chooseAction(s, w)); // a level that picks an illegal move fails the test
    checkInvariants(s);
  }
  return s;
}

describe('computer difficulty levels', () => {
  it("keeps each computer player's level in the game", () => {
    const s = createGame({ seed: 1, players: [
      { id: 'p1', name: 'A', isAI: true, aiLevel: 'hard', deck: randomDeck(1) },
      { id: 'p2', name: 'B', isAI: false, aiLevel: 'easy', deck: randomDeck(2) }] });
    expect(s.players[0].aiLevel).toBe('hard');
    expect(s.players[1].aiLevel).toBeUndefined(); // a person has no level
  });
  it('Easy, Normal and Hard all play complete, legal games', () => {
    for (const [a, b, seed] of [['easy', 'hard', 11], ['hard', 'normal', 12], ['normal', 'easy', 13]] as const) {
      expect(play(a, b, seed).phase).toBe('gameOver');
    }
  }, 120_000);
  it('the levels differ in the ways described to players', () => {
    expect(PROFILES.easy.mistakes).toBeGreaterThan(0);
    expect(PROFILES.easy.minChance).toBeGreaterThan(PROFILES.normal.minChance);
    expect(PROFILES.hard.aidPlanning && PROFILES.hard.smartTakeover && PROFILES.hard.endgame).toBe(true);
    expect(PROFILES.normal.mistakes + PROFILES.hard.mistakes).toBe(0);
  });
  it('online games give computer seats the chosen level', async () => {
    const rec = await newTable(new MemoryStore(), { userId: 'ann', name: 'Ann', illuminati: 'the-network' }, { seats: 2, computerSeats: 1, aiLevel: 'hard' });
    expect(rec.seats[1]).toMatchObject({ isAI: true, aiLevel: 'hard' });
    expect(rec.state!.players[1].aiLevel).toBe('hard');
  });
  it('each computer seat can have its own level, with friends and computers at one table of 8', async () => {
    const rec = await newTable(new MemoryStore(), { userId: 'ann', name: 'Ann', illuminati: 'the-network' },
      { seats: 8, computerSeats: 6, aiLevels: ['easy', 'hard', 'normal', 'hard', 'easy', 'normal'] });
    expect(rec.seats[1]).toMatchObject({ isAI: false, name: '' }); // the friend's seat waits for them
    expect(rec.seats.slice(2).map((x) => x.aiLevel)).toEqual(['easy', 'hard', 'normal', 'hard', 'easy', 'normal']);
    expect(rec.seats[2].name).toBe('Computer 1 (Easy)');
    expect(rec.state).toBeNull(); // not started until the friend joins
  });
  it('an 8-player game with mixed levels plays to a legal finish', () => {
    const levels: AiLevel[] = ['easy', 'normal', 'hard', 'normal', 'easy', 'hard', 'normal', 'easy'];
    let s = createGame({ seed: 8, players: levels.map((lv, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isAI: true, aiLevel: lv, deck: randomDeck(80 + i) })) });
    expect(s.settings.basicGoal).toBe(10);
    for (let i = 0; i < 40000 && s.phase !== 'gameOver' && s.turn < 400; i++) {
      const w = waitingFor(s)[0];
      s = applyAction(s, w, chooseAction(s, w));
      checkInvariants(s);
    }
    expect(s.phase).toBe('gameOver');
  }, 300_000);
});
