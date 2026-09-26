import { describe, expect, it } from 'vitest';
import { BASE_CARDS, CARDS, GROUP_ABILITIES, PLOTS } from '../src/engine';

describe('card data', () => {
  it('has the full 412-card base set', () => {
    expect(BASE_CARDS.length).toBe(412);
    const count = (t: string) => BASE_CARDS.filter((c) => c.type === t).length;
    expect([count('Illuminati'), count('Group'), count('Resource'), count('Plot')]).toEqual([9, 167, 36, 200]);
  });
  it('every Group has stats and a legal arrow layout', () => {
    for (const c of Object.values(CARDS).filter((x) => x.type === 'Group' && x.subtype !== 'Hidden')) {
      expect(c.arrowIn, c.name).toMatch(/TOP|BOTTOM|LEFT|RIGHT/);
      expect(c.arrowsOut!.includes(c.arrowIn!), c.name).toBe(false);
      expect(c.arrowsOut!.length, c.name).toBeLessThanOrEqual(3);
    }
  });
  it('abilities and Plot handlers only reference real cards', () => {
    for (const id of [...Object.keys(GROUP_ABILITIES), ...Object.keys(PLOTS)]) expect(CARDS[id], id).toBeDefined();
    // Video Games and Tabloids name Convenience Stores, which the Assassins pack provides.
    const names = JSON.stringify(GROUP_ABILITIES).match(/"names":\[[^\]]*\]/g) ?? [];
    for (const n of names) for (const id of JSON.parse(`{${n}}`).names) expect(CARDS[id], `named card ${id}`).toBeDefined();
  });
  it('every base Group has an ability entry', () => {
    for (const c of BASE_CARDS.filter((x) => x.type === 'Group' || x.type === 'Illuminati')) expect(GROUP_ABILITIES[c.id], c.name).toBeDefined();
  });
});
