// Named computer players: every style has a different name at each level, and names mean habits.
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, randomDeck, waitingFor } from '../src/engine';
import { chooseAction } from '../src/ai/ai';
import { STYLES, seatComputers, styleOf, whoIs, BASE_STYLE } from '../src/ai/personas';
import { checkInvariants } from './helpers';

describe('named computer players', () => {
  it('has at least seven different names at every level, all unique', () => {
    const all = STYLES.flatMap((st) => [st.names.easy, st.names.normal, st.names.hard]);
    expect(new Set(all).size).toBe(all.length);
    for (const lv of ['easy', 'normal', 'hard'] as const) expect(new Set(STYLES.map((st) => st.names[lv])).size).toBeGreaterThanOrEqual(7);
  });
  it('a name always tells you its style and level', () => {
    for (const st of STYLES) for (const lv of ['easy', 'normal', 'hard'] as const) expect(whoIs(st.names[lv])).toEqual({ style: st, level: lv });
  });
  it('seats computers with different styles, the right names, and Illuminati that suit them', () => {
    const seats = seatComputers(['easy', 'normal', 'hard', 'normal', 'easy', 'hard', 'normal'], 42, ['the-network'], ['ufos', 'shangri-la']);
    expect(new Set(seats.map((x) => x.style.id)).size).toBe(7);
    for (const x of seats) expect(x.name).toBe(x.style.names[x.level]);
    const ills = seats.map((x) => x.illuminati).filter(Boolean);
    expect(new Set(ills).size).toBe(ills.length); // no two share an Illuminati
    expect(ills).not.toContain('the-network');     // yours is never taken
    expect(seatComputers(['normal', 'hard'], 42)).toEqual(seatComputers(['normal', 'hard'], 42)); // repeatable
  });
  it('every style except By the book changes how it plays', () => {
    for (const st of STYLES) expect(JSON.stringify(styleOf(st.id)) === JSON.stringify(BASE_STYLE)).toBe(st.id === 'book');
  });
  it('a table of styled computers plays a legal game to the end', () => {
    const seats = seatComputers(['easy', 'normal', 'hard', 'normal'], 7);
    let s = createGame({ seed: 7, players: seats.map((c, i) => ({ id: `p${i + 1}`, name: c.name, isAI: true, aiLevel: c.level, aiStyle: c.style.id, deck: randomDeck(70 + i, c.illuminati) })) });
    expect(s.players.map((p) => p.aiStyle)).toEqual(seats.map((c) => c.style.id));
    for (let i = 0; i < 30000 && s.phase !== 'gameOver' && s.turn < 300; i++) {
      const w = waitingFor(s)[0];
      s = applyAction(s, w, chooseAction(s, w));
      checkInvariants(s);
    }
    expect(s.phase).toBe('gameOver');
  }, 300_000);
});
