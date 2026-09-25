// Computer players must not see future dice: every look-ahead rolls with its own seed.
import { describe, expect, it } from 'vitest';
import { applyAction, openArrows, type Action, type GameState } from '../src/engine';
import { chooseAction } from '../src/ai/ai';
import { give, scenario } from './helpers';

const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
function put(s: GameState, pl: string, cardId: string): string {
  return give(s, pl, cardId, { under: ill(s, pl), side: openArrows(s, ill(s, pl))[0] });
}

/** p1's attack has just succeeded; p2 holds Time Warp, which forces a re-roll. */
function rollWindow(level: 'normal' | 'hard'): GameState {
  let s = scenario();
  for (const p of s.players) { p.isAI = true; p.aiLevel = level; }
  const mafia = put(s, 'p1', 'the-mafia');
  s.cards[mafia].mods.push({ source: 'test', kind: 'power', value: 12, until: 'permanent' }); // strength 7
  const t = put(s, 'p2', 'dentists');
  give(s, 'p2', 'time-warp', { hand: true });
  s = applyAction(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: mafia, target: t });
  s = applyAction(s, 'p1', { type: 'pass' });
  s = applyAction(s, 'p2', { type: 'pass' });
  expect(s.window?.kind).toBe('roll');
  s.attack!.roll = [1, 1];
  return s;
}

describe('hidden dice', () => {
  for (const level of ['normal', 'hard'] as const) {
    it(`a ${level} look-ahead cannot change its choice based on the real upcoming roll`, () => {
      const base = rollWindow(level);
      const choices = new Set<string>();
      // The same position with different real dice to come: the computer must choose the same way.
      for (let seed = 1; seed <= 40; seed++) {
        const s: GameState = { ...base, rng: seed * 2654435761 };
        const a: Action = chooseAction(s, 'p2');
        choices.add(JSON.stringify(a));
      }
      expect(choices.size).toBe(1);
      // And the real state's dice are left untouched by the look-ahead.
      const s = structuredClone(base);
      chooseAction(s, 'p2');
      expect(s.rng).toBe(base.rng);
    });
  }
});
