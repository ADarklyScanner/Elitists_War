// Choosing computer players: hand-picked ones plus random ones per difficulty and wild cards.
import { describe, expect, it } from 'vitest';
import { assignIlluminati, lineupSize, resolveLineup, specOf } from '../src/ui/lineup';
import { WILD_CARDS } from '../src/ai/personas';

describe('computer line-up', () => {
  it('keeps a favourite and fills the rest at random from the chosen difficulties', () => {
    const l = { picked: ['wrecker:hard'], random: { easy: 0, normal: 4, hard: 0, wild: 0 } };
    const bots = resolveLineup(l, 5);
    expect(lineupSize(l)).toBe(5);
    expect(bots[0]).toEqual({ name: 'The Demolisher', level: 'hard', style: 'wrecker' });
    expect(bots.slice(1).every((b) => b.level === 'normal')).toBe(true);
    expect(new Set(bots.map((b) => b.style)).size).toBe(5); // no style twice while others are free
    expect(new Set(bots.map((b) => b.name)).size).toBe(5);
  });
  it('wild cards are named, play at random, and never share a name', () => {
    const bots = resolveLineup({ picked: ['wild:wild-bingo'], random: { easy: 0, normal: 0, hard: 0, wild: 3 } }, 9);
    expect(bots.every((b) => b.style === 'chaos')).toBe(true);
    expect(new Set(bots.map((b) => b.name)).size).toBe(4);
    expect(bots[0].name).toBe('Bingo');
    expect(WILD_CARDS.length).toBeGreaterThanOrEqual(4);
  });
  it('ignores unknown ids and is repeatable from its seed', () => {
    expect(specOf('nobody:hard')).toBeUndefined();
    const l = { picked: [], random: { easy: 2, normal: 2, hard: 2, wild: 1 } };
    expect(resolveLineup(l, 3)).toEqual(resolveLineup(l, 3));
  });
  it('gives each computer a different Illuminati, never yours, suited to its style when free', () => {
    const bots = resolveLineup({ picked: ['turtle:normal'], random: { easy: 3, normal: 0, hard: 3, wild: 0 } }, 1);
    const ills = assignIlluminati(bots, ['bavarian-illuminati'], ['adepts-of-hermes', 'bavarian-illuminati', 'bermuda-triangle', 'discordian-society', 'gnomes-of-zurich', 'the-network', 'servants-of-cthulhu', 'shangri-la', 'ufos']);
    expect(ills[0]).toBe('shangri-la'); // the Turtle's favourite
    expect(new Set(ills).size).toBe(ills.length);
    expect(ills).not.toContain('bavarian-illuminati');
  });
});
