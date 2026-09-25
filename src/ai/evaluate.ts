// Position evaluation and short look-ahead for the computer opponent. A candidate move is tried on
// a copy of the game, everyone is assumed to let it through, and the resulting position is scored.
import {
  type Action, type Alignment, type GameState, applyAction, attackCancelled, attackStrength, def, goalCount, goalNeeded, liveEffects,
  meetsGoal, player, plotsInHand, power, resourcesOf, structureCards, waitingFor, CHOICES, abilitiesOf, alignments, goalsInHand,
  GOAL_PROGRESS,
} from '../engine';

const ALL_ALIGNMENTS: Alignment[] = ['Government', 'Corporate', 'Liberal', 'Conservative', 'Peaceful', 'Violent', 'Straight', 'Weird', 'Criminal', 'Fanatic'];

/**
 * A seed for look-ahead dice that owes nothing to the real one. Every look-ahead rolls with it, so no
 * computer player can see (and play around) the dice the real game will roll next.
 */
export function lookaheadSeed(s: GameState, salt = 0): number {
  let h = 2166136261;
  for (const ch of `${s.id}|${s.version}|${s.turn}|${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
/** The same position with look-ahead dice in place of the real ones (a shallow copy: never mutate it). */
export const hideDice = (s: GameState, salt = 0): GameState => ({ ...s, rng: lookaheadSeed(s, salt) });

/** Counted toward victory: not a Devastated Place or anything below one. */
function counted(s: GameState, iid: string): boolean {
  let c: GameState['cards'][string] | undefined = s.cards[iid];
  while (c) { if (c.devastated) return false; c = c.master ? s.cards[c.master] : undefined; }
  return true;
}

/**
 * How far a player is toward his other ways of winning, 0 to 1: his Illuminati's Special Goal and the
 * Goal cards he holds. Rivals' hidden Goal cards are not known to `viewer`, so only exposed ones count.
 */
export function goalProgress(s: GameState, id: string, viewer?: string): number {
  const p = player(s, id);
  let best = 0;
  const mine = structureCards(s, id).filter((g) => counted(s, g));
  const total = () => mine.reduce((n, g) => n + power(s, g, { goals: true }), 0);
  for (const a of abilitiesOf(s, p.illuminati)) {
    if (a.kind !== 'specialGoal') continue;
    if (a.goal === 'totalPower') best = Math.max(best, total() / a.value);
    if (a.goal === 'bermuda') {
      const al = new Set(mine.flatMap((g) => alignments(s, g)));
      best = Math.max(best, 0.5 * Math.min(1, total() / a.value) + 0.5 * ALL_ALIGNMENTS.filter((x) => al.has(x)).length / ALL_ALIGNMENTS.length);
    }
    if (a.goal === 'destroyCount') best = Math.max(best, p.destroyedCredit.length / a.value);
    if (a.goal === 'peacefulPower') {
      const peaceful = s.players.filter((x) => !x.eliminated).flatMap((x) => structureCards(s, x.id))
        .filter((g) => counted(s, g) && alignments(s, g).includes('Peaceful')).reduce((n, g) => n + power(s, g, { goals: true }), 0);
      best = Math.max(best, peaceful / a.value);
    }
  }
  for (const g of goalsInHand(s, id)) {
    if (viewer !== undefined && viewer !== id && !s.cards[g].exposed) continue;
    const f = GOAL_PROGRESS[s.cards[g].cardId];
    if (f) best = Math.max(best, f(s, id));
  }
  return Math.min(1, best);
}

export function successChance(strength: number): number {
  const ways = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
  let n = 0;
  for (let t = 2; t <= Math.min(10, strength); t++) n += ways[t];
  return n / 36;
}

/** How well one player is doing, in rough "points", as `viewer` can tell (default: everything). */
export function standing(s: GameState, id: string, viewer?: string): number {
  const p = player(s, id);
  if (p.eliminated) return -500;
  if (meetsGoal(s, id)) return 500;
  const need = Math.max(1, goalNeeded(s, id));
  const basic = Math.min(1, goalCount(s, id) / need);
  // Special Goals and Goal cards are other roads to victory: the furthest one counts in full, and
  // a little of the other besides, so progress on either is worth making.
  const special = goalProgress(s, id, viewer);
  const frac = Math.max(basic, special) + 0.15 * Math.min(basic, special);
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
  const rivals = s.players.filter((p) => p.id !== pl && !p.eliminated).map((p) => standing(s, p.id, pl));
  if (!rivals.length) return 1000;
  const top = Math.max(...rivals);
  const avg = rivals.reduce((a, b) => a + b, 0) / rivals.length;
  return standing(s, pl, pl) - 0.8 * top - 0.2 * avg;
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
  let s = hideDice(state, 1); // never the real dice
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

/**
 * Try each action and keep the one that leaves `pl` best off, if it beats `baseline` by `margin`.
 * An action that starts an attack (an Instant attack, or one started by a card) is weighed by its
 * odds: success and failure are both played out and averaged. Every look-ahead rolls its own dice.
 */
export function bestBySimulation(s: GameState, pl: string, actions: Action[], baseline: number, margin = 1, budget = 48): Action | undefined {
  let best: Action | undefined;
  let bestScore = baseline + margin;
  const view = hideDice(s, 2);
  for (const a of actions.slice(0, budget)) {
    let after: GameState;
    try { after = applyAction(view, pl, a); } catch { continue; }
    let score: number;
    if (after.attack && after.attack.id !== s.attack?.id) {
      const chance = attackChance(after);
      score = chance * attackOutcomeScore(after, pl, true) + (1 - chance) * attackOutcomeScore(after, pl, false);
    } else score = evaluate(rollout(after, pl), pl);
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
  let s = hideDice(state, success ? 3 : 4);
  const id = s.attack?.id;
  for (let i = 0; i < 40 && s.attack && s.attack.id === id && s.phase !== 'gameOver'; i++) {
    if (s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = success ? [1, 1] : [6, 6];
    const w = waitingFor(s);
    if (!w.length || s.prompt) break;
    try { s = applyAction(s, w[0], { type: 'pass' }); } catch { break; }
  }
  return evaluate(rollout(s, pl), pl);
}
