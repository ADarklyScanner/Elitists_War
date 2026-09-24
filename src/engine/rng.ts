// Deterministic RNG (mulberry32). Its state lives in GameState so replays and
// server-side validation always produce the same dice.
import type { GameState } from './types';

export function nextRandom(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rollDie(s: GameState): number {
  return 1 + Math.floor(nextRandom(s) * 6);
}

export function roll2d6(s: GameState): number[] {
  return [rollDie(s), rollDie(s)];
}

export function shuffle<T>(s: GameState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(s) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
