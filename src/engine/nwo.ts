// New World Order cards: global rule changes that stay on the table (R045).
import type { Alignment, GameState } from './types';
import { alignments } from './stats';
import { def } from './cards';

export interface NwoEffect {
  color: 'red' | 'blue' | 'yellow';
  power?: (s: GameState, iid: string) => number;
  resistance?: (s: GameState, iid: string) => number;
  resistanceMul?: (s: GameState, iid: string) => number;
  attributes?: (s: GameState, iid: string, attrs: string[]) => void;
  /** Override the +4/-4 alignment modifier values: returns [perSame, perOpposite] for control. */
  alignmentValues?: () => { same: number; opposite: number };
  implemented: boolean;
}

const has = (s: GameState, iid: string, a: Alignment) => alignments(s, iid).includes(a);
const attr = (s: GameState, iid: string, a: string) => (def(s, iid).attributes ?? []).includes(a);

/** Two-alignment NWO: +2 for either, +3 (not +4) for both. */
function pairBonus(a: Alignment, b: Alignment) {
  return (s: GameState, iid: string) => {
    const x = has(s, iid, a), y = has(s, iid, b);
    return x && y ? 3 : x || y ? 2 : 0;
  };
}

export const NWO_EFFECTS: Record<string, NwoEffect> = {
  'solidarity': { color: 'red', resistanceMul: () => 2, implemented: true },
  'law-and-order': { color: 'yellow', power: pairBonus('Conservative', 'Straight'), implemented: true },
  'bigger-business': { color: 'yellow', power: pairBonus('Corporate', 'Conservative'), implemented: true },
  'gun-control': {
    color: 'red', implemented: true,
    power: (s, i) => (has(s, i, 'Violent') && has(s, i, 'Government') ? 3 : 0) + (has(s, i, 'Criminal') ? 1 : 0),
  },
  'a-thousand-points-of-light': { color: 'blue', alignmentValues: () => ({ same: 4, opposite: 0 }), implemented: true },
  'fear-and-loathing': { color: 'blue', alignmentValues: () => ({ same: 8, opposite: 8 }), implemented: true },
  'don-t-forget-to-smash-the-state': {
    color: 'yellow', implemented: true,
    power: (s, i) => (has(s, i, 'Government') ? -3 : has(s, i, 'Straight') ? -2 : 0),
  },
  'chicken-in-every-pot': {
    color: 'blue', implemented: true,
    power: (s, i) => (attr(s, i, 'Bank') ? 2 : 0) + (def(s, i).subtype === 'Place' && attr(s, i, 'Coastal') ? 2 : 0) + (has(s, i, 'Violent') ? -1 : 0),
  },
  'energy-crisis': {
    color: 'blue', implemented: true,
    power: (s, i) => (has(s, i, 'Corporate') ? -2 : 0) + (attr(s, i, 'Green') ? -1 : 0),
    resistance: (s, i) => (attr(s, i, 'Green') ? -1 : 0),
  },
  // Its effect (Corporate cards count as Government, except for Goals) is an alignmentMod hook in plots6.ts.
  'military-industrial-complex': { color: 'yellow', implemented: true },
  'political-correctness': {
    color: 'red', implemented: true,
    power: (s, i) => (has(s, i, 'Liberal') ? 3 : 0),
  },
  'peace-in-our-time': {
    color: 'red', implemented: true,
    power: (s, i) => (has(s, i, 'Peaceful') ? 1 : 0),
    resistance: (s, i) => (has(s, i, 'Peaceful') ? 3 : 0),
  },
};

export const NWO_COLOR: Record<string, 'red' | 'blue' | 'yellow'> = {
  'tax-reform': 'red', 'world-hunger': 'blue', 'world-war-three': 'yellow',
};

export function nwoColor(cardId: string): 'red' | 'blue' | 'yellow' {
  return NWO_EFFECTS[cardId]?.color ?? NWO_COLOR[cardId] ?? 'red';
}
