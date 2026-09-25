// Scripted parts of the Illuminati in src/engine/content/illuminati.ts.
import { describe, expect, it } from 'vitest';
import {
  applyAction, goalCount, goalLimit, meetsGoal, openArrows, validateAttack, type Action, type GameState,
} from '../../src/engine';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
function put(s: GameState, pl: string, cardId: string, under?: string): string {
  const m = under ?? ill(s, pl);
  return give(s, pl, cardId, { under: m, side: openArrows(s, m)[0] });
}
/** Make p1 play the given Illuminati. */
function as(cardId: string): GameState {
  const s = scenario();
  s.cards[ill(s, 'p1')].cardId = cardId;
  return s;
}

describe('Adepts of Hermes', () => {
  it('each Magic Resource counts as a controlled Group', () => {
    const s = as('adepts-of-hermes');
    put(s, 'p1', 'the-mafia');
    const before = goalCount(s, 'p1');
    give(s, 'p1', 'the-bronze-head', { resource: true });
    expect(goalCount(s, 'p1')).toBe(before + 1);
  });
  it('other Resources and other Illuminati get nothing', () => {
    const s = as('adepts-of-hermes');
    const before = goalCount(s, 'p1');
    give(s, 'p1', 'xanadu', { resource: true });
    expect(goalCount(s, 'p1')).toBe(before);
    const s2 = as('bavarian-illuminati');
    const b2 = goalCount(s2, 'p1');
    give(s2, 'p1', 'the-bronze-head', { resource: true });
    expect(goalCount(s2, 'p1')).toBe(b2);
  });
});

describe('Bermuda Triangle', () => {
  it('reorganizes for free at the end of the turn, then makes no more attacks', () => {
    const s0 = as('bermuda-triangle');
    const mafia = put(s0, 'p1', 'the-mafia');
    const gun = put(s0, 'p1', 'gun-lobby');
    const target = put(s0, 'p2', 'kkk');
    let s = act(s0, 'p1', { type: 'useAbility', card: ill(s0, 'p1'), ability: 'reorganize', params: {} });
    expect(s.cards[ill(s, 'p1')].tokens).toBe(1); // no Illuminati action spent
    s.cards[gun].tokens = 0; s.cards[mafia].tokens = 0;
    s = act(s, 'p1', { type: 'move', group: gun, onto: mafia, side: openArrows(s, mafia)[0], payWith: gun });
    expect(s.cards[gun].master).toBe(mafia);
    s.cards[mafia].tokens = 1;
    expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: mafia, target })).toMatch(/reorganization/);
  });
  it('moves still cost an action before the reorganization', () => {
    const s = as('bermuda-triangle');
    const mafia = put(s, 'p1', 'the-mafia');
    const gun = put(s, 'p1', 'gun-lobby');
    s.cards[gun].tokens = 0; s.cards[mafia].tokens = 0; s.cards[ill(s, 'p1')].tokens = 0;
    expect(() => act(s, 'p1', { type: 'move', group: gun, onto: mafia, side: openArrows(s, mafia)[0], payWith: gun })).toThrow(/Pay/);
  });
});

describe('UFOs', () => {
  it('may hold three Goals and win with any of them', () => {
    const s = as('ufos');
    expect(goalLimit(s, 'p1')).toBe(3);
    for (const g of ['kill-for-peace', 'hail-eris', 'power-for-its-own-sake']) give(s, 'p1', g, { hand: true });
    const mafia = put(s, 'p1', 'the-mafia');
    expect(meetsGoal(s, 'p1')).toBeNull();
    s.cards[mafia].mods.push({ source: 'test', kind: 'power', value: 50, until: 'permanent' });
    expect(meetsGoal(s, 'p1')).toMatch(/Power for Its Own Sake/i);
  });
  it('other Illuminati hold one Goal', () => {
    expect(goalLimit(as('bavarian-illuminati'), 'p1')).toBe(1);
  });
});

import { attackStrength, startInstantAttack } from '../../src/engine';

describe('audit fixes', () => {
  describe('Shangri-La', () => {
    /** p2 plays Shangri-La. */
    function rivalShangri(): GameState {
      const s = scenario();
      s.cards[ill(s, 'p2')].cardId = 'shangri-la';
      return s;
    }
    const defense = (s: GameState) => attackStrength(s, s.attack!).lines
      .filter((l) => l.startsWith('Defense') && l.endsWith(': Shangri-La'))
      .reduce((n, l) => n + Number(l.match(/[+-]\d+/)![0]), 0);

    it('+5 to defend any Group in its Power Structure', () => {
      const s0 = rivalShangri();
      const mafia = put(s0, 'p1', 'the-mafia');
      const d = put(s0, 'p2', 'dentists');
      const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: mafia, target: d });
      expect(defense(s)).toBe(5);
    });
    it('even against Instant attacks', () => {
      const s = rivalShangri();
      const quayle = put(s, 'p2', 'dan-quayle');
      const plot = give(s, 'p1', 'sniper', { hand: true });
      startInstantAttack(s, 'p1', { plot, target: quayle, power: 10, assassination: true });
      expect(defense(s)).toBe(5);
    });
    it('may only destroy Violent Groups', () => {
      const s = as('shangri-la');
      const mafia = put(s, 'p1', 'the-mafia');
      const d = put(s, 'p2', 'dentists');
      const violent = put(s, 'p2', 'loan-sharks');
      expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: mafia, target: d })).toMatch(/only destroy Violent/);
      expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: mafia, target: violent })).toBeNull();
      expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'control', attacker: mafia, target: d })).toBeNull();
    });
    it('wins with 30 Power of Peaceful Groups in play, whoever controls them', () => {
      const s = as('shangri-la');
      const japan = put(s, 'p2', 'japan'); // Peaceful, Power 6
      put(s, 'p1', 'boy-sprouts'); // Peaceful, Power 1
      s.cards[japan].mods.push({ source: 'test', kind: 'power', value: 22, until: 'permanent' });
      expect(meetsGoal(s, 'p1') ?? '').not.toMatch(/Peaceful/);
      s.cards[japan].mods.push({ source: 'test', kind: 'power', value: 1, until: 'permanent' });
      expect(meetsGoal(s, 'p1')).toMatch(/Peaceful/);
      // Only Shangri-La has this Goal.
      expect(meetsGoal(s, 'p2') ?? '').not.toMatch(/Peaceful/);
    });
    it('Groups that are not Peaceful do not count', () => {
      const s = as('shangri-la');
      const mafia = put(s, 'p2', 'the-mafia');
      s.cards[mafia].mods.push({ source: 'test', kind: 'power', value: 40, until: 'permanent' });
      expect(meetsGoal(s, 'p1') ?? '').not.toMatch(/Peaceful/);
    });
  });
});
