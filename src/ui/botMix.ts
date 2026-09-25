// Suggested computer line-ups: one overall table difficulty becomes a sensible mix of levels
// for however many computer players there are.
import type { AiLevel } from '../engine/types';

export type TableLevel = 'beginner' | 'standard' | 'challenging' | 'expert';

/** Share of Hard, Normal and Easy computers at each table difficulty. */
export const MIX: Record<TableLevel, { hard: number; normal: number; easy: number }> = {
  beginner: { hard: 0, normal: 0.2, easy: 0.8 },     // mostly Easy, the odd Normal once the table is big
  standard: { hard: 0, normal: 0.6, easy: 0.4 },     // Normal-led with Easy company: 2 → N+E, 5 → 3N+2E
  challenging: { hard: 0.4, normal: 0.4, easy: 0.2 }, // 5 → 2H+2N+1E
  expert: { hard: 1, normal: 0, easy: 0 },           // every computer on Hard
};

const STRENGTH: AiLevel[] = ['hard', 'normal', 'easy'];

/**
 * Split `count` computers by the table's shares (largest remainder, ties to the stronger level),
 * then seat them strongest, weakest, next strongest… so the strong ones are spread round the table.
 */
export function suggestBots(count: number, level: TableLevel): AiLevel[] {
  if (count <= 0) return [];
  const share = MIX[level];
  const want = STRENGTH.map((lv) => share[lv] * count);
  const got = want.map(Math.floor);
  let left = count - got.reduce((a, b) => a + b, 0);
  const order = STRENGTH.map((_, i) => i).sort((a, b) => (want[b] - got[b]) - (want[a] - got[a]) || a - b);
  for (const i of order) { if (left <= 0) break; if (want[i] > 0) { got[i]++; left--; } }
  const sorted = STRENGTH.flatMap((lv, i) => Array<AiLevel>(got[i]).fill(lv));
  const seated: AiLevel[] = [];
  for (let a = 0, b = sorted.length - 1; a <= b; a++, b--) { seated.push(sorted[a]); if (a !== b) seated.push(sorted[b]); }
  return seated;
}
