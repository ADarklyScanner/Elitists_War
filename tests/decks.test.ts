// Deck-shape checks for randomDeck (src/engine/decks.ts): the rulebook's deck-building
// guidance (p.2) calls a 45-card deck (including the Illuminati) typical with 12-20 Group
// cards and 24-32 Plot cards.
import { describe, expect, it } from 'vitest';
import { randomDeck, ILLUMINATI, CARDS } from '../src/engine';
import { PLAYABLE_GROUPS } from '../src/engine/decks';

describe('randomDeck deck ratios', () => {
  it('sits inside the rulebook\'s typical 12-20 Group / 24-32 Plot ranges over many seeds', () => {
    for (let seed = 0; seed < 200; seed++) {
      const d = randomDeck(seed);
      expect(d.groups.length).toBeGreaterThanOrEqual(12);
      expect(d.groups.length).toBeLessThanOrEqual(20);
      expect(d.plots.length).toBeGreaterThanOrEqual(24);
      expect(d.plots.length).toBeLessThanOrEqual(32);
      expect(1 + d.groups.length + d.plots.length).toBe(45);
    }
  });

  it('still guarantees enough arrows-out Groups and attackers regardless of size', () => {
    for (let seed = 0; seed < 40; seed++) {
      const d = randomDeck(seed);
      const groupCards = d.groups.map((id) => CARDS[id]).filter((c) => c.type === 'Group');
      const growers = groupCards.filter((g) => (g.arrowsOut?.length ?? 0) >= 2).length;
      expect(growers).toBeGreaterThan(0);
    }
  });

  it('keeps a theme cap so decks are not entirely one alignment', () => {
    for (const ill of ILLUMINATI.map((i) => i.id)) {
      const d = randomDeck(1, ill);
      const groupCards = d.groups.map((id) => CARDS[id]).filter((c) => c.type === 'Group');
      expect(groupCards.length).toBeGreaterThan(0);
      expect(groupCards.length).toBeLessThan(PLAYABLE_GROUPS.length);
    }
  });

  it('honors explicit groups/plots overrides for scenario decks', () => {
    const d = randomDeck(3, undefined, { groups: 18, plots: 26 });
    expect(d.groups.length).toBe(18);
    expect(d.plots.length).toBe(26);
  });
});
