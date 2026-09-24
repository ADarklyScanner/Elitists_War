// Position evaluation and short look-ahead for the computer opponent. A candidate move is tried on
// a copy of the game, everyone is assumed to let it through, and the resulting position is scored.
import {
  type Action, type GameState, applyAction, attackCancelled, attackStrength, def, goalCount, goalNeeded, liveEffects,
  meetsGoal, player, plotsInHand, power, resourcesOf, structureCards, waitingFor, CHOICES,
} from '../engine';

export function successChance(strength: number): number {
  const ways = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
  let n = 0;
  for (let t = 2; t <= Math.min(10, strength); t++) n += ways[t];
  return n / 36;
}

/** How well one player is doing, in rough "points". */
export function standing(s: GameState, id: string): number {
  const p = player(s, id);
  if (p.eliminated) return -500;
  if (meetsGoal(s, id)) return 500;
  const need = Math.max(1, goalNeeded(s, id));
  const frac = Math.min(1, goalCount(s, id) / need);
  let v = 70 * frac * frac + 15 * frac;
  for (const g of structureCards(s, id)) {
    if (g === p.illuminati) continue;
    v += Math.max(0, power(s, g)) * 0.8 + (s.cards[g].tokens > 0 ? 0.5 : 0) + 1;
  }
  v += plotsInHand(s, id).length * 1.2;
  v += p.hand.filter((h) => def(s, h).type === 'Group').length * 0.6;
  v += resourcesOf(s, id).length * 2;
  return v;
}

/** Score of the position for `pl`: own standing against the strongest rival (and the field). */
export function evaluate(s: GameState, pl: string): number {
  if (s.phase === 'gameOver') return s.winners?.includes(pl) ? 1000 : -1000;
  const rivals = s.players.filter((p) => p.id !== pl && !p.eliminated).map((p) => standing(s, p.id));
  if (!rivals.length) return 1000;
  const top = Math.max(...rivals);
  const avg = rivals.reduce((a, b) => a + b, 0) / rivals.length;
  return standing(s, pl) - 0.8 * top - 0.2 * avg;
}

/** Chance the current attack succeeds (0 once it is cancelled or has ended). */
export function attackChance(s: GameState): number {
  const ctx = s.attack;
  if (!ctx || attackCancelled(ctx) || liveEffects(ctx).some((e) => e.t === 'fail')) return 0;
  return successChance(attackStrength(s, ctx).strength);
}

/**
 * Let the game run on with every player passing (and making default choices) until `pl` is back
 * in charge of his main phase, or an attack needs dice. Returns the resulting position.
 */
export function rollout(state: GameState, pl: string, maxSteps = 30): GameState {
  let s = state;
  for (let i = 0; i < maxSteps && s.phase !== 'gameOver'; i++) {
    if (s.phase === 'main' && !s.window && !s.prompt && !s.attack && s.players[s.active].id === pl) break;
    const w = waitingFor(s);
    if (!w.length) break;
    const who = w[0];
    let a: Action = { type: 'pass' };
    if (s.prompt) {
      const pr = s.prompt;
      if (pr.kind === 'choose' && pr.choice) {
        const ch = pr.choice;
        a = { type: 'choose', ids: CHOICES[ch.key]?.ai?.(s, who, ch.options, { ...ch.data, source: ch.source }) ?? ch.options.slice(0, ch.min).map((o) => o.id) };
      } else if (pr.kind === 'takeover') a = { type: 'skipTakeover' };
      else break; // other decisions are beyond a short look-ahead
    } else if (!s.window) break;
    try { s = applyAction(s, who, a); } catch { break; }
  }
  return s;
}

/** Try each action and keep the one that leaves `pl` best off, if it beats `baseline` by `margin`. */
export function bestBySimulation(s: GameState, pl: string, actions: Action[], baseline: number, margin = 1, budget = 48): Action | undefined {
  let best: Action | undefined;
  let bestScore = baseline + margin;
  for (const a of actions.slice(0, budget)) {
    let after: GameState;
    try { after = applyAction(s, pl, a); } catch { continue; }
    if (after.attack && !s.attack) continue; // attacks are judged by the attack planner
    const score = evaluate(rollout(after, pl), pl);
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

/** At most `n` items spread evenly through a list. */
export function spread<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]);
}

/**
 * Play an attack through with nobody responding and the dice forced, and score the result.
 * Used to compare what winning and losing the attack would leave behind.
 */
export function attackOutcomeScore(state: GameState, pl: string, success: boolean): number {
  let s = state;
  const id = s.attack?.id;
  for (let i = 0; i < 40 && s.attack && s.attack.id === id && s.phase !== 'gameOver'; i++) {
    if (s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = success ? [1, 1] : [6, 6];
    const w = waitingFor(s);
    if (!w.length || s.prompt) break;
    try { s = applyAction(s, w[0], { type: 'pass' }); } catch { break; }
  }
  return evaluate(rollout(s, pl), pl);
}
