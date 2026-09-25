// Real card shapes: 5 × 7 cards, puppets centred on their master's arrow, no overlaps.
import { describe, expect, it } from 'vitest';
import { applyAction, openArrows } from '../src/engine';
import { LAYOUT_VERSION, attachRect, ensureLayout, rectOf } from '../src/engine/geometry';
import { give, scenario, checkInvariants } from './helpers';

const ill = (s: ReturnType<typeof scenario>) => s.players[0].illuminati;

describe('card layout', () => {
  it('stands cards on top/bottom arrows upright and lays cards on side arrows sideways', () => {
    const s = scenario();
    const down = give(s, 'p1', 'loan-sharks', { under: ill(s), side: 'BOTTOM' });
    const right = give(s, 'p1', 'hollywood', { under: ill(s), side: 'RIGHT' });
    expect(rectOf(s, ill(s))).toEqual({ x: 0, y: 0, w: 10, h: 14 });
    expect(rectOf(s, down)).toEqual({ x: 0, y: 14, w: 10, h: 14 });   // directly below, same width
    expect(rectOf(s, right)).toEqual({ x: 12, y: 0, w: 14, h: 10 });  // on its side: 5 + 7 to the right
    checkInvariants(s);
  });

  it('closes an arrow when a card lying there would overlap another card', () => {
    const s = scenario();
    const right = give(s, 'p1', 'hollywood', { under: ill(s), side: 'RIGHT' });
    const down = give(s, 'p1', 'loan-sharks', { under: ill(s), side: 'BOTTOM' });
    // A card under the sideways card would reach down to y 19; the card to the right of the
    // lower Group lies across that same space.
    const underRight = attachRect(s, right, 'BOTTOM');
    const rightOfDown = attachRect(s, down, 'RIGHT');
    expect(Math.abs(underRight.y - rightOfDown.y) * 2).toBeLessThan(underRight.h + rightOfDown.h);
    expect(openArrows(s, down)).toContain('RIGHT');
    const before = openArrows(s, right);
    give(s, 'p1', 'fbi', { under: down, side: 'RIGHT' });
    expect(openArrows(s, right)).not.toContain('BOTTOM');
    expect(before.length).toBeGreaterThanOrEqual(openArrows(s, right).length);
    checkInvariants(s);
  });

  it('moves keep every puppet centred on its master\'s arrow', () => {
    let s = scenario();
    const g = give(s, 'p1', 'loan-sharks', { under: ill(s), side: 'BOTTOM' });
    s.cards[ill(s)].tokens = 1;
    s = applyAction(s, 'p1', { type: 'move', group: g, onto: ill(s), side: 'LEFT', payWith: ill(s) });
    expect(rectOf(s, g)).toEqual({ x: -12, y: 0, w: 14, h: 10 });
    checkInvariants(s);
  });

  it('converts games saved with the old one-cell-per-card layout', () => {
    const s = scenario();
    const down = give(s, 'p1', 'loan-sharks', { under: ill(s), side: 'BOTTOM' });
    const side = give(s, 'p1', 'hollywood', { under: down, side: openArrows(s, down)[0] });
    const sideWas = s.cards[side].side;
    // Rewrite as an old save: grid cells, no recorded arrow, no layout version.
    s.cards[down].x = 0; s.cards[down].y = 1; delete s.cards[down].side;
    const [dx, dy] = { TOP: [0, -1], RIGHT: [1, 0], BOTTOM: [0, 1], LEFT: [-1, 0] }[sideWas!];
    s.cards[side].x = dx; s.cards[side].y = 1 + dy; delete s.cards[side].side;
    delete s.layout;
    ensureLayout(s);
    expect(s.layout).toBe(LAYOUT_VERSION);
    expect(s.cards[down].side).toBe('BOTTOM');
    expect(s.cards[side].side).toBe(sideWas);
    expect(rectOf(s, down)).toMatchObject({ x: 0, y: 14 });
    checkInvariants(s);
  });
});
