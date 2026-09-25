import { describe, expect, it } from 'vitest';
import { applyAction, waitingFor } from '../src/engine';
import { chooseAction } from '../src/ai/ai';
import { checkInvariants, newGame } from './helpers';

function playOut(seed: number, maxSteps = 6000) {
  let s = newGame(seed);
  let steps = 0;
  while (s.phase !== 'gameOver' && steps < maxSteps && s.turn < 120) {
    const who = waitingFor(s)[0];
    const a = chooseAction(s, who);
    try {
      s = applyAction(s, who, a);
    } catch (e) {
      throw new Error(`seed ${seed} step ${steps} turn ${s.turn}: ${who} ${JSON.stringify(a)} -> ${(e as Error).message}\n${s.log.slice(-8).map((l) => l.text).join('\n')}`);
    }
    checkInvariants(s);
    steps++;
  }
  return s;
}

describe('computer vs computer games', () => {
  it('play many full games without breaking a rule', () => {
    let finished = 0;
    const turns: number[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      const s = playOut(seed);
      if (s.phase === 'gameOver') { finished++; turns.push(s.turn); }
    }
    console.log(`finished ${finished}/60, average ${Math.round(turns.reduce((a, b) => a + b, 0) / Math.max(1, turns.length))} turns`);
    expect(finished).toBeGreaterThan(40);
  }, 300_000); // 60 full games; slower machines need the headroom
});
