// The suggested computer line-ups for each table difficulty.
import { describe, expect, it } from 'vitest';
import { suggestBots, type TableLevel } from '../src/ui/botMix';

const tally = (n: number, lv: TableLevel) => {
  const b = suggestBots(n, lv);
  return { hard: b.filter((x) => x === 'hard').length, normal: b.filter((x) => x === 'normal').length, easy: b.filter((x) => x === 'easy').length };
};

describe('suggested computer line-ups', () => {
  it('Standard: 1 → Normal, 2 → Normal + Easy, 5 → 3 Normal + 2 Easy', () => {
    expect(suggestBots(1, 'standard')).toEqual(['normal']);
    expect(tally(2, 'standard')).toEqual({ hard: 0, normal: 1, easy: 1 });
    expect(tally(5, 'standard')).toEqual({ hard: 0, normal: 3, easy: 2 });
  });
  it('Challenging: 5 → 2 Hard + 2 Normal + 1 Easy; Expert is all Hard; Beginner is mostly Easy', () => {
    expect(tally(5, 'challenging')).toEqual({ hard: 2, normal: 2, easy: 1 });
    expect(suggestBots(1, 'challenging')).toEqual(['hard']);
    expect(tally(5, 'expert')).toEqual({ hard: 5, normal: 0, easy: 0 });
    expect(tally(2, 'beginner')).toEqual({ hard: 0, normal: 0, easy: 2 });
    expect(tally(5, 'beginner')).toEqual({ hard: 0, normal: 1, easy: 4 });
  });
  it('always gives exactly the number asked for, and a harder table is never weaker', () => {
    const score = (n: number, lv: TableLevel) => { const t = tally(n, lv); return t.hard * 2 + t.normal; };
    for (let n = 1; n <= 7; n++) {
      for (const lv of ['beginner', 'standard', 'challenging', 'expert'] as const) expect(suggestBots(n, lv)).toHaveLength(n);
      expect(score(n, 'beginner')).toBeLessThanOrEqual(score(n, 'standard'));
      expect(score(n, 'standard')).toBeLessThanOrEqual(score(n, 'challenging'));
      expect(score(n, 'challenging')).toBeLessThanOrEqual(score(n, 'expert'));
    }
  });
  it('spreads the strong computers round the table', () => {
    expect(suggestBots(5, 'challenging')).toEqual(['hard', 'easy', 'hard', 'normal', 'normal']);
  });
});
