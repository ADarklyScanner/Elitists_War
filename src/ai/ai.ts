// Computer opponent. It plays through exactly the same actions as a person, so it can never
// break the rules: every candidate move is checked by the engine before it is chosen.
import {
  type Action, type AttackCtx, type GameState, type PlotPlay, type Side,
  applyAction, attackStrength, canAid, canOppose, checkPlot, currentOutcome, def, openArrows, player,
  plotsInHand, handLimit, power, resistance, structureCards, takeoverOptions, validateAttack, waitingFor,
  alignments, globalPower, abilitiesOf, PLOTS, subtree, goalCount, goalNeeded, depth, bestLead, plotOptions,
  HOOKS, CHOICES, checkAbility, resourcesOf, canEnterPlay, goalsInHand, goalLimit, type AbilityParams,
  type AiLevel, declareOptions, type GoalOption,
  type Deal, type DealGroup, I_LIED, sideEmpty, dealsAllowed, tokenBarred, offersFrom,
  GOAL_PROGRESS, moveSubtree, placeGroup, isPrivileged, agentProblem, reliefPledgesFor,
  plotDeckOf, groupDeckOf, uncontrolledCards, zapsOn, paralysesOn,
} from '../engine';
import { OPPOSITE } from '../engine/cards';
import { matches } from '../engine/abilities';
import { abilityOptions, attackOptions, responseOptions as engineResponseOptions } from '../engine/moves';
import { BASE_STYLE, clampStyle, styleOf, type Style } from './personas';
import { attackChance, attackOutcomeScore, bestBySimulation, evaluate, goalProgress, hideDice, rollout, spread, standing, successChance } from './evaluate';

/**
 * The legal responses right now, minus any activated ability marked `ai: 'never'` (too fiddly for the
 * computer to weigh, e.g. George Bush's Conservative toggle): those stay legal for a person in
 * `abilityOptions`/`responseOptions` (moves.ts, shared with the UI), but offering them here as an
 * always-available, no-cost, no-effect move can make the computer pick one over passing and leave an
 * end-of-turn or other response window reopening forever instead of closing.
 */
function responseOptions(s: GameState, pl: string) {
  return engineResponseOptions(s, pl).filter((o) => {
    const a = o.action;
    return a.type !== 'useAbility' || HOOKS[s.cards[a.card]?.cardId]?.actions?.find((x) => x.id === a.ability)?.ai !== 'never';
  });
}

/** Activated abilities of our cards with a given AI hint, tried against a few likely targets. */
function abilityMoves(s: GameState, pl: string, hint: string, targets: (string | undefined)[]): Action[] {
  const out: Action[] = [];
  const mine = [...structureCards(s, pl), ...resourcesOf(s, pl)];
  for (const card of mine) {
    for (const ab of HOOKS[s.cards[card].cardId]?.actions ?? []) {
      if (ab.ai !== hint) continue;
      if (!ab.usesToken && !ab.oncePerTurn && ab.ai !== 'free') continue; // free, repeatable abilities could loop forever
      const modes = ab.needs?.modes ?? [undefined];
      for (const target of ab.needs?.target ? targets : [undefined]) for (const mode of modes) {
        const params: AbilityParams = { target, mode };
        if (!checkAbility(s, pl, card, ab.id, params)) out.push({ type: 'useAbility', card, ability: ab.id, params });
      }
    }
  }
  return out;
}

/** Chance that 2d6 rolls `strength` or less (11 and 12 always fail). */
export { successChance };

/** Knobs for the computer player's appetite for risk (Normal level). */
export const AI_TUNING = { minChance: 0.4, actionCost: 2 };

/**
 * How each difficulty level plays. Easy takes only safe-looking attacks, ignores most clever
 * card play and sometimes slips; Hard looks further, expects rivals' hidden Plots to defend,
 * keeps strong Groups for helping, and goes all out to stop a rival who is about to win.
 * Normal and Hard also do what table players do routinely: join other players' fights against a
 * rival about to win (Hard: against the leader too), strike with Instant attacks at the end of that
 * rival's turn, cash in tokens that would refresh unused, send Relief, reorganize, and use Plots and
 * their Illuminati's specials with sense. Easy does none of that.
 */
interface Profile {
  minChance: number;            // lowest odds it will attack at
  costBase: number;             // what spending an attacker's action is worth…
  costPerPower: number;         // …plus this much per point of its Power (a strong Group could help instead)
  plans: number;                // how many candidate attacks it plays out
  generic: boolean;             // weighs every Plot and ability by look-ahead
  mistakes: number;             // how often it takes a worse option or forgets to defend (0..1)
  defendMin: number;            // defends when the attack's odds exceed this
  tricks: boolean;              // uses roll-changing cards and counters
  smartTakeover: boolean;       // plays out each automatic takeover to pick the best
  handPlotDefense: number;      // expected defense per Plot in the defender's hand
  endgame: boolean;             // takes long shots to stop a rival about to win
  gainMin: number;              // how much better an attack must look than doing nothing
  fullDefense: boolean;         // defends every attack: unused tokens come back next turn anyway
  drawGroups: boolean;          // spends a spare Illuminati action on a Group card when short of them
  samples: number;              // plays each top attack out this many times with real responses and dice (0 = estimate)
  aidBelow: number;             // helps its own attack with other Groups only while its odds are below this
  aidPlanning: boolean;         // counts the help its other Groups can really add to each attack
  interfere: 0 | 1 | 2;         // joins other players' attacks: 0 never, 1 to stop a rival about to win, 2 also to hold back the leader
  stopWin: boolean;             // strikes with Instant attacks (also at the end of rivals' turns) to stop a rival about to win
  cashIn: 0 | 1 | 2;            // at the end of the turn before its own, spends tokens that would refresh unused on Plots: 1 a little, 2 all
  judgeNwo: boolean;            // plays a New World Order only when the look-ahead says it helps
  relief: boolean;              // sends Relief to its own Devastated Places when it pays
  reorganize: 0 | 1 | 2;        // moves Groups: 1 with free moves and reorganizations, 2 also pays for a move that protects a key Group
  plotSense: boolean;           // attaches any Plot that raises the odds, keeps the most useful Plots, counters harmful ones harder
}
export const PROFILES: Record<AiLevel, Profile> = {
  easy: { minChance: 0.55, costBase: 0, costPerPower: 0, plans: 3, generic: false, mistakes: 0.3, defendMin: 0.45, tricks: false, smartTakeover: false, handPlotDefense: 0, endgame: false, gainMin: 1, fullDefense: false, drawGroups: false, samples: 0, aidBelow: 0.72, aidPlanning: false,
    interfere: 0, stopWin: false, cashIn: 0, judgeNwo: false, relief: false, reorganize: 0, plotSense: false },
  normal: { minChance: AI_TUNING.minChance, costBase: AI_TUNING.actionCost, costPerPower: 0, plans: 8, generic: true, mistakes: 0, defendMin: 0.25, tricks: true, smartTakeover: false, handPlotDefense: 0, endgame: false, gainMin: 0.5, fullDefense: false, drawGroups: false, samples: 0, aidBelow: 0.72, aidPlanning: false,
    interfere: 1, stopWin: true, cashIn: 1, judgeNwo: true, relief: true, reorganize: 1, plotSense: true },
  hard: { minChance: 0.3, costBase: 1.5, costPerPower: 0.2, plans: 14, generic: true, mistakes: 0, defendMin: 0.15, tricks: true, smartTakeover: true, handPlotDefense: 0, endgame: true, gainMin: 0.5, fullDefense: true, drawGroups: true, samples: 0, aidBelow: 0.72, aidPlanning: true,
    interfere: 2, stopWin: true, cashIn: 2, judgeNwo: true, relief: true, reorganize: 2, plotSense: true },
};
let P: Profile = PROFILES.normal;
/** The named computer's habits, on top of its level. */
let S: Style = BASE_STYLE;

/** A repeatable "random" number for this moment of the game, so replays stay the same. */
function roll01(s: GameState, pl: string, salt: string): number {
  let h = 2166136261;
  for (const ch of `${s.version}|${s.turn}|${pl}|${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
const slips = (s: GameState, pl: string, salt: string) => P.mistakes > 0 && roll01(s, pl, salt) < P.mistakes;
/** A rival who meets, or is one Group from, the Basic Goal. */
const nearWin = (s: GameState, id?: string) => !!id && goalCount(s, id) >= goalNeeded(s, id) - 1;

const tryAction = (s: GameState, pl: string, a: Action): boolean => {
  try { applyAction(s, pl, a); return true; } catch { return false; }
};

function groupValue(s: GameState, iid: string): number {
  const d = def(s, iid);
  return (d.power ?? 0) * 1.5 + (d.arrowsOut?.length ?? 0) * 2 + (d.resistance ?? 0) * 0.3 + subtree(s, iid).length * 2 + (abilitiesOf(s, iid).length ? 1 : 0);
}

function rivalsOf(s: GameState, pl: string) {
  return s.players.filter((p) => p.id !== pl && !p.eliminated);
}

/** Estimate how hard the defender can push back (self-defense doubles the target's Power). */
function expectedOpposition(s: GameState, ctx: AttackCtx): number {
  if (!ctx.targetPlayer || ctx.targetPlayer === ctx.attackerPlayer) return 0;
  const t = s.cards[ctx.target];
  let v = t.tokens > 0 ? power(s, ctx.target) * 2 : 0;
  // A couple of other defenders, at a discount.
  const helpers = structureCards(s, ctx.targetPlayer).filter((g) => g !== ctx.target && s.cards[g].tokens > 0).map((g) => power(s, g)).sort((a, b) => b - a);
  v += (helpers[0] ?? 0) * 0.4;
  // Hidden Plots in the defender's hand may hold +10 defenses.
  v += Math.min(6, P.handPlotDefense * plotsInHand(s, ctx.targetPlayer).length);
  return v;
}

function hypotheticalCtx(s: GameState, pl: string, attacker: string, target: string, type: 'control' | 'destroy'): AttackCtx {
  const fromHand = s.cards[target].zone === 'hand';
  return {
    id: -1, type, instant: false, attacker, attackerPlayer: pl, target, targetPlayer: fromHand ? undefined : s.cards[target].controller,
    fromHand, privileged: false, aid: [], oppose: [], attackBonus: [], defenseBonus: [], plays: [],
  };
}

interface AttackPlan { action: Extract<Action, { type: 'attack' }>; score: number; chance: number; habit: number }

function planAttacks(s: GameState, pl: string): AttackPlan[] {
  const plans: AttackPlan[] = [];
  const me = player(s, pl);
  const mine = structureCards(s, pl).filter((g) => s.cards[g].tokens > 0);
  const targets: { iid: string; type: 'control' | 'destroy' }[] = [];
  for (const r of rivalsOf(s, pl)) {
    for (const g of structureCards(s, r.id)) {
      if (def(s, g).type !== 'Group') continue;
      targets.push({ iid: g, type: 'control' }, { iid: g, type: 'destroy' });
    }
  }
  for (const h of me.hand) if (def(s, h).type === 'Group' && s.cards[h].failedTakeoverTurn !== s.turn) targets.push({ iid: h, type: 'control' });
  // SubGenius rules: the uncontrolled area, to capture (or to deny a rival).
  for (const u of uncontrolledCards(s)) if (def(s, u).type === 'Group') targets.push({ iid: u, type: 'control' }, { iid: u, type: 'destroy' });
  const behind = rivalsOf(s, pl).some((r) => goalCount(s, r.id) >= goalNeeded(s, r.id) - 2);
  // Hit the leader hardest, and above all a rival about to win.
  const scores = new Map(rivalsOf(s, pl).map((r) => [r.id, standing(s, r.id)]));
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const leader = ranked[0]?.[0], weakest = ranked.length > 1 ? ranked[ranked.length - 1][0] : undefined;
  const threat = (owner?: string) => (!owner ? 1 : (owner === leader ? S.leader : 1) * (owner === weakest ? S.weakest : 1) * (goalCount(s, owner) >= goalNeeded(s, owner) - 1 ? 1.6 : 1));
  for (const att of mine) {
    for (const t of targets) {
      const side: Side | undefined = t.type === 'control' ? openArrows(s, att)[0] : undefined;
      const action: Extract<Action, { type: 'attack' }> = { type: 'attack', attackType: t.type, attacker: att, target: t.iid, side };
      if (validateAttack(s, pl, action)) continue;
      const ctx = hypotheticalCtx(s, pl, att, t.iid, t.type);
      // Count likely aid from our other Groups.
      let strength = attackStrength(s, ctx).strength - expectedOpposition(s, ctx);
      if (P.aidPlanning) strength += helpAvailable(s, mine.filter((g) => g !== att), t.iid, t.type);
      else {
        const spare = mine.filter((g) => g !== att).map((g) => power(s, g)).sort((a, b) => b - a);
        strength += (spare[0] ?? 0) * 0.5;
      }
      const chance = successChance(Math.floor(strength));
      let value = groupValue(s, t.iid);
      if (t.type === 'destroy') value = (value * 0.7 + (behind ? 6 : 0)) * S.destroy;
      else value = (value + (s.cards[t.iid].zone === 'hand' ? 3 + S.fromHand : 4)) * S.control;
      value *= threat(s.cards[t.iid].controller);
      // Taking a Group that completes our own Goal is worth a great deal.
      if (t.type === 'control' && goalCount(s, pl) + 1 >= goalNeeded(s, pl)) value += 25;
      value += goalPursuit(s, pl, t.iid, t.type);
      const score = (S.safeBets ? chance * chance * 1.6 : chance) * value - (s.cards[att].cardId === def(s, me.illuminati).id ? 1 : 0);
      // The named computer's habits, as a nudge to the final choice (0 for a by-the-book player).
      const owner = s.cards[t.iid].controller;
      const habit = (t.type === 'destroy' ? S.destroy - 1 : S.control - 1) * 3
        + (owner && owner === leader ? (S.leader - 1.3) * 6 : 0) + (owner && owner === weakest ? (S.weakest - 1) * 6 : 0)
        + (s.cards[t.iid].zone === 'hand' ? S.fromHand * 0.4 : 0)
        + (S.safeBets ? (chance - 0.6) * 6 : 0) + (S.risk < 0 ? (0.6 - chance) * -S.risk * 12 : 0);
      plans.push({ action, score, chance, habit });
    }
  }
  return plans.sort((a, b) => b.score - a.score);
}

/**
 * Extra worth of an attack for our Illuminati's Special Goal or double counts: a Group that counts
 * double, Power toward the Bavarians' 50, a new alignment for the Bermuda Triangle, a destruction for
 * the Servants of Cthulhu (and a Peaceful Group Shangri-La would rather keep in play).
 */
function goalPursuit(s: GameState, pl: string, target: string, type: 'control' | 'destroy'): number {
  let v = 0;
  const ill = player(s, pl).illuminati;
  const mine = structureCards(s, pl);
  for (const a of abilitiesOf(s, ill)) {
    if (a.kind === 'doubleCount' && type === 'control' && matches(s, target, a.match) && power(s, target) >= (a.minPower ?? 0)) v += 4;
    if (a.kind !== 'specialGoal') continue;
    if (a.goal === 'totalPower' && type === 'control') v += power(s, target) * 0.8;
    if (a.goal === 'bermuda' && type === 'control') {
      const have = new Set(mine.flatMap((g) => alignments(s, g)));
      v += 3 * alignments(s, target).filter((x) => !have.has(x)).length + power(s, target) * 0.3;
    }
    if (a.goal === 'destroyCount' && type === 'destroy') v += 6;
    if (a.goal === 'peacefulPower' && alignments(s, target).includes('Peaceful')) v += type === 'destroy' ? -8 : 2;
  }
  return v;
}

/**
 * What our other Groups can really add to an attack: full Power when they may aid by alignment
 * (a shared alignment to take control, an opposite one to destroy), otherwise Global Power.
 * Only the best three count, since each helper spends its action.
 */
function helpAvailable(s: GameState, helpers: string[], target: string, type: 'control' | 'destroy'): number {
  const tAl = alignments(s, target);
  const adds = helpers.map((g) => {
    const al = alignments(s, g);
    const ok = type === 'control' ? al.some((a) => tAl.includes(a)) : al.some((a) => tAl.includes(OPPOSITE[a] as typeof a));
    return ok ? power(s, g) : Math.min(globalPower(s, g), power(s, g));
  }).sort((a, b) => b - a);
  return adds.slice(0, 3).reduce((n, x) => n + x, 0) * 0.85;
}

/**
 * Pick Plots worth attaching when declaring an attack: any Plot that raises the odds enough for what
 * the attack is worth, and privilege when rivals could otherwise join in (at most two Plots, Hard).
 */
function declarePlots(s: GameState, pl: string, a: Extract<Action, { type: 'attack' }>): PlotPlay[] {
  if (!P.plotSense) return fixedDeclarePlots(s, pl, a);
  const worth = groupValue(s, a.target) + 4 + (nearWin(s, s.cards[a.target].controller) ? 10 : 0);
  const others = rivalsOf(s, pl).filter((r) => r.id !== s.cards[a.target].controller).length;
  const chosen: PlotPlay[] = [];
  const chanceWith = (plots: PlotPlay[]) => {
    try { const after = applyAction(s, pl, { ...a, plots }); return { chance: attackChance(after), priv: !!after.attack && isPrivileged(after.attack) }; } catch { return undefined; }
  };
  let cur = chanceWith([]);
  if (!cur) return [];
  const probe = structuredClone(s);
  probe.attack = hypotheticalCtx(probe, pl, a.attacker, a.target, a.attackType);
  for (let round = 0; round < (P.smartTakeover ? 2 : 1) && cur.chance < 0.85; round++) {
    let best: { play: PlotPlay; gain: number; res: { chance: number; priv: boolean } } | undefined;
    for (const c of plotsInHand(s, pl)) {
      if (chosen.some((x) => x.card === c)) continue;
      const h = PLOTS[s.cards[c].cardId];
      if (!h || !(h.timing.includes('declare') || h.timing.includes('anytime')) || h.timing.includes('nwo')) continue;
      for (const play of attackPlotOptions(probe, pl, c, a.attacker)) {
        const res = chanceWith([...chosen, play]);
        if (!res) continue;
        // Privilege keeps the other rivals out of the fight.
        const gain = (res.chance - cur.chance) * worth + (res.priv && !cur.priv ? Math.min(4, others * 1.5) : 0) - 1.6;
        if (gain > (best?.gain ?? 0.5)) best = { play, gain, res };
      }
    }
    if (!best) break;
    chosen.push(best.play);
    cur = best.res;
  }
  return chosen;
}

/**
 * A few likely ways to attach one Plot to our attack (checked on `probe`, a copy holding the declared
 * attack): on the attacker, or on nothing, paid by one of our other Groups if it needs a payment.
 */
function attackPlotOptions(probe: GameState, pl: string, card: string, attacker: string): PlotPlay[] {
  const h = PLOTS[probe.cards[card].cardId];
  const needs = h?.needs ?? {};
  const modes: (string | undefined)[] = needs.mode ? (needs.mode.includes('power') ? ['power'] : needs.mode.slice(0, 2)) : [undefined];
  const pays: (string[] | undefined)[] = needs.pay === 'tokens'
    ? structureCards(probe, pl).filter((g) => g !== attacker && probe.cards[g].tokens > 0).slice(0, 4).map((g) => [g]) : [undefined];
  const out: PlotPlay[] = [];
  for (const target of [attacker, undefined]) for (const mode of modes) for (const payWith of pays) {
    const play: PlotPlay = { card, target, mode, payWith };
    if (!checkPlot(probe, pl, play, true)) { out.push(play); if (out.length >= 3) return out; }
  }
  return out;
}

/** Easy: attach one of the plain +10 Plots when it fits. */
function fixedDeclarePlots(s: GameState, pl: string, a: Extract<Action, { type: 'attack' }>): PlotPlay[] {
  const out: PlotPlay[] = [];
  for (const c of plotsInHand(s, pl)) {
    const id = s.cards[c].cardId;
    if (!['albino-alligators', 'benefit-concert', 'cold-fusion', 'harmonica-virgins', 'infobahn', 'jihad', 'just-say-no', 'martial-law', 'martyrs', 'pulitzer-prize', 'save-the-whales', 'slush-fund', 'stock-split', 'terrorist-nuke', 'the-big-score', 'world-cup-victory', 'swiss-bank-account'].includes(id)) continue;
    const play: PlotPlay = { card: c, target: a.attacker, mode: 'power' };
    // Validate against a hypothetical declared attack.
    const probe = structuredClone(s);
    probe.attack = hypotheticalCtx(probe, pl, a.attacker, a.target, a.attackType);
    if (!checkPlot(probe, pl, play, true) && out.length < 1) out.push(play);
  }
  return out;
}

function mainPhase(s: GameState, pl: string): Action {
  const me = player(s, pl);
  // 00. Assassins conditions: shake off Zaps, and free a Paralyzed Group, with a spare Illuminati action.
  const cond = conditionMove(s, pl);
  if (cond) return cond;
  // 0. Free moves under way (a reorganization): finish the reorganization first.
  if (s.turnFlags.freeMoves === pl && P.reorganize) {
    const mv = bestMove(s, pl, true, 0.4);
    if (mv) return mv.action;
  }
  // 1. Plays that help right away.
  for (const c of plotsInHand(s, pl)) {
    const id = s.cards[c].cardId;
    const h = PLOTS[id];
    if (!h) continue;
    if (h.needs?.targets) {
      // Reload cards cost the Illuminati's action: worth it when they refresh 2+ Groups.
      const best = plotOptions(s, pl, c).sort((a, b) => ((b.action as { play: PlotPlay }).play.targets?.length ?? 0) - ((a.action as { play: PlotPlay }).play.targets?.length ?? 0))[0];
      if (best && ((best.action as { play: PlotPlay }).play.targets?.length ?? 0) >= 2 && tryAction(s, pl, best.action)) return best.action;
    }
    // Easy plays any New World Order from turn 3; the others weigh it first (below).
    if (h.timing.includes('nwo') && s.turn >= 3 && !P.judgeNwo) {
      const a: Action = { type: 'playPlot', play: { card: c } };
      if (tryAction(s, pl, a)) return a;
    }
  }
  // 0b. A spare Illuminati card that matches a rival's Illuminati becomes an agent inside it (+3).
  for (const c of me.hand) {
    if (def(s, c).type === 'Illuminati' && !agentProblem(s, pl, c)) return { type: 'playAgent', card: c };
  }
  // 1a. Instant attacks (Disasters, Assassinations): a big prize at fair odds, or a long shot to stop a winner.
  const instant = instantStrike(s, pl);
  if (instant) return instant;
  // 1b. A New World Order, only when it leaves us better off.
  if (P.judgeNwo) { const n = nwoMove(s, pl); if (n) return n; }
  // 1c. The Collector draws Group cards before spending the Illuminati's action on anything else.
  if (S.collector && !s.common && s.cards[me.illuminati].tokens > 0 && !s.turnFlags.illumGroupDraw && groupDeckOf(s, pl).length
      && me.hand.filter((h) => def(s, h).type === 'Group').length <= 2) {
    const a: Action = { type: 'drawGroup' };
    if (tryAction(s, pl, a)) return a;
  }
  // 1d. Any other Plot or ability (or Relief) whose result looks better than doing nothing.
  const generic = P.generic ? genericMainMoves(s, pl) : undefined;
  if (generic) return generic;
  // 2. Best attack: the most promising few are played out both ways and weighed by their odds.
  // Against a rival about to win, long shots are worth taking (Hard).
  // A Kingslayer accepts worse odds when the target belongs to the leader.
  const lead = rivalsOf(s, pl).map((r) => r.id).sort((a, b) => standing(s, b, pl) - standing(s, a, pl))[0];
  const minFor = (p: AttackPlan) => (P.endgame && nearWin(s, s.cards[p.action.target].controller) ? 0.12
    : Math.min(0.8, Math.max(0.12, P.minChance + S.risk - (S.leader >= 2 && s.cards[p.action.target].controller === lead ? 0.15 : 0))));
  // Attacks a little short of our odds may still be worth it with the right Plot attached.
  const boosts = P.plotSense && plotsInHand(s, pl).some((c) => { const h = PLOTS[s.cards[c].cardId]; return !!h && !h.timing.includes('nwo') && (h.timing.includes('declare') || !!h.needs?.mode?.includes('power')); });
  const plans = planAttacks(s, pl).filter((p) => p.chance >= minFor(p) - (boosts ? 0.3 : 0)).slice(0, P.plans);
  const now = evaluate(s, pl);
  let best: AttackPlan | undefined;
  let bestGain = P.gainMin;
  let sampled = 0, plotted = 0;
  const viable: AttackPlan[] = [];
  for (const [i, p] of plans.entries()) {
    let after: GameState;
    try { after = applyAction(s, pl, p.action); } catch { continue; }
    // The most promising attacks count on the Plots we would attach to them.
    let chance = p.chance, plotCost = 0;
    const short = p.chance < minFor(p);
    if (boosts && (i < 3 || short) && plotted++ < 5) {
      const plots = declarePlots(s, pl, p.action);
      if (plots.length) {
        try {
          const boosted = applyAction(s, pl, { ...p.action, plots });
          chance = Math.min(0.92, Math.max(0, p.chance + attackChance(boosted) - attackChance(after)));
          plotCost = 1.6 * plots.length;
        } catch { /* keep the plain estimate */ }
      }
    }
    if (chance < minFor(p)) continue;
    let gain = chance * attackOutcomeScore(after, pl, true) + (1 - chance) * attackOutcomeScore(after, pl, false) - now - (P.costBase + P.costPerPower * power(s, p.action.attacker)) + p.habit - plotCost;
    // Hard: play the most promising attacks out for real — the defender answers, the dice roll.
    if (P.samples && gain > -3 && sampled++ < 5) gain = playedOut(s, pl, p.action, P.samples) - now - (P.costBase + P.costPerPower * power(s, p.action.attacker));
    if (gain > 0) viable.push(p);
    if (gain > bestGain) { bestGain = gain; best = p; }
  }
  // Easy sometimes settles for a lesser attack.
  if (best && viable.length > 1 && slips(s, pl, 'attack')) best = viable[Math.floor(roll01(s, pl, 'pick') * viable.length)];
  if (best) {
    let action = best.action;
    // Take control onto the arrow that keeps the most of the new Group's puppets and room to grow.
    if (action.attackType === 'control' && P.generic) action = { ...action, side: bestArrow(s, pl, action.attacker, action.target) ?? action.side };
    // The Bavarian Illuminati's free Privileged attack keeps the other rivals out of it.
    const priv = P.generic && canFreePrivilege(s, pl) && rivalsOf(s, pl).length >= 2 ? { privileged: true } : {};
    const withPlots = { ...action, ...priv, plots: declarePlots(s, pl, { ...action, ...priv }) };
    if (tryAction(s, pl, withPlots)) return withPlots;
    if (tryAction(s, pl, { ...action, ...priv })) return { ...action, ...priv };
    if (tryAction(s, pl, action)) return action;
  }
  // 3. Resources: bring one into play with the Illuminati's action, and link where a card wants it.
  if (s.cards[me.illuminati].tokens > 0 && !s.turnFlags.resourcePlayed) {
    // SubGenius rules: Resources are taken from the uncontrolled area.
    const r = (s.common ? uncontrolledCards(s) : me.hand).find((h) => def(s, h).type === 'Resource' && canEnterPlay(s, h, pl));
    if (r) { const a: Action = { type: 'playResource', card: r }; if (tryAction(s, pl, a)) return a; }
  }
  for (const r of resourcesOf(s, pl)) {
    const rule = HOOKS[s.cards[r].cardId]?.linkTo;
    if (!rule || s.cards[r].linkMovedTurn || (s.cards[r].linkedTo && s.cards[r].linkedTo !== me.illuminati)) continue;
    const best = structureCards(s, pl).filter((g) => g !== me.illuminati && rule(s, r, g)).sort((a, b) => power(s, b) - power(s, a))[0];
    if (best) { const a: Action = { type: 'link', resource: r, to: best }; if (tryAction(s, pl, a)) return a; }
  }
  for (const a of abilityMoves(s, pl, 'draw', [undefined])) if (tryAction(s, pl, a)) return a;
  // 3b. Short of Group cards: the Illuminati's spare action draws one (fuel for takeovers).
  if (s.common) {
    // SubGenius rules: buy a Group into the uncontrolled area when it runs short, keeping some Slack.
    if (s.cards[me.illuminati].tokens > 1 && uncontrolledCards(s).filter((c) => def(s, c).type === 'Group').length < 3) {
      const a: Action = { type: 'drawGroup', payWith: [me.illuminati] };
      if (tryAction(s, pl, a)) return a;
    }
  } else if ((P.drawGroups || S.collector) && s.cards[me.illuminati].tokens > 0 && !s.turnFlags.illumGroupDraw && groupDeckOf(s, pl).length
      && me.hand.filter((h) => def(s, h).type === 'Group').length <= (S.collector ? 3 : 1)) {
    const a: Action = { type: 'drawGroup' };
    if (tryAction(s, pl, a)) return a;
  }
  // 3c. Attacking is over: reorganize the Power Structure to open arrows and shelter key Groups.
  if (P.reorganize) { const r = reorganizeMove(s, pl); if (r) return r; }
  // 3c. Now and then, a simple offer to another player (at most one a turn).
  const deal = dealOffer(s, pl);
  if (deal) return deal;
  // 4. Buy a Plot with a spare Illuminati token.
  if (s.cards[me.illuminati].tokens > 0 && plotsInHand(s, pl).length < S.plotHand && plotDeckOf(s, pl).length) {
    const a: Action = { type: 'buyPlot', payWith: [me.illuminati] };
    if (tryAction(s, pl, a)) return a;
  }
  // 4b. Hard: plenty of Groups still holding tokens: two of the weakest buy a Plot, the rest stay for defence.
  if (P.cashIn >= 2 && plotsInHand(s, pl).length < 2) {
    const a = pairBuy(s, pl, 4);
    if (a) return a;
  }
  return { type: 'endTurn' };
}

/** Remove the Zaps on us, or free one of our Paralyzed Groups, when the Illuminati has an action to spare. */
function conditionMove(s: GameState, pl: string): Action | undefined {
  const me = player(s, pl);
  if (s.cards[me.illuminati].tokens < 1) return undefined;
  if (zapsOn(s, pl).length) {
    const a: Action = { type: 'removeZaps', player: pl };
    if (tryAction(s, pl, a)) return a;
  }
  const stuck = structureCards(s, pl).filter((g) => paralysesOn(s, g).length).sort((a, b) => power(s, b) - power(s, a))[0];
  if (stuck) {
    const a: Action = { type: 'freeGroup', group: stuck, payWith: me.illuminati };
    if (tryAction(s, pl, a)) return a;
  }
  return undefined;
}

/** Two of our weakest Groups with tokens buy a Plot, if at least `keep` token-holding Groups would be left. */

function pairBuy(s: GameState, pl: string, keep: number): Action | undefined {
  const me = player(s, pl);
  if (!plotDeckOf(s, pl).length || plotsInHand(s, pl).length >= Math.min(handLimit(s, pl), S.plotHand + 1)) return undefined;
  const spare = structureCards(s, pl).filter((g) => g !== me.illuminati && s.cards[g].tokens > 0).sort((a, b) => power(s, a) - power(s, b));
  if (spare.length < 2 + keep) return undefined;
  const a: Action = { type: 'buyPlot', payWith: spare.slice(0, 2) };
  return tryAction(s, pl, a) ? a : undefined;
}

/** Who takes the next turn (after an extra turn, the interrupted player). */
function nextPlayer(s: GameState): string | undefined {
  if (s.extraTurnFor) return s.extraTurnFor;
  if (s.resumeSeat !== undefined) return s.players[s.resumeSeat]?.id;
  for (let i = 1; i <= s.players.length; i++) {
    const p = s.players[(s.active + i) % s.players.length];
    if (!p.eliminated) return p.id;
  }
  return undefined;
}

/**
 * The end of the turn just before ours: tokens still on our cards would refresh unused, so cash them
 * in for Plots (they were kept for defence until now). Normal spends the Illuminati's token and one
 * pair of Groups; Hard spends every pair, up to the hand limit.
 */
function cashInMove(s: GameState, pl: string): Action | undefined {
  const level = Math.max(P.cashIn, S.schemer ? 1 : 0);
  if (!level || s.window?.kind !== 'endOfTurn' || s.players[s.active].id === pl || nextPlayer(s) !== pl) return undefined;
  const me = player(s, pl);
  const limit = Math.min(handLimit(s, pl), level >= 2 ? 99 : Math.max(3, S.plotHand));
  if (!plotDeckOf(s, pl).length || plotsInHand(s, pl).length >= limit) return undefined;
  if (s.cards[me.illuminati].tokens > 0) {
    const a: Action = { type: 'buyPlot', payWith: [me.illuminati] };
    if (tryAction(s, pl, a)) return a;
  }
  // Normal cashes in one pair per window (it passes once it has bought one); Hard every pair.
  const boughtHere = s.log.slice(-6).filter((l) => l.turn === s.turn && l.player === pl && /buys a Plot/.test(l.text)).length;
  if (level < 2 && boughtHere >= 2) return undefined;
  return pairBuy(s, pl, 0);
}

/** Can our Illuminati make this attack Privileged for free (the Bavarian Illuminati, once a turn)? */
function canFreePrivilege(s: GameState, pl: string): boolean {
  return !s.turnFlags.bavarianPrivilege && abilitiesOf(s, player(s, pl).illuminati).some((a) => a.kind === 'freePrivilegedAttack');
}

/**
 * Instant attacks in our main phase: the best target by odds × prize. A rival about to win is worth a
 * long shot (Normal at 25%, Hard at 15%); otherwise it needs fair odds on a valuable Group.
 */
function instantStrike(s: GameState, pl: string): Action | undefined {
  let best: Action | undefined;
  let bestScore = 0;
  for (const c of plotsInHand(s, pl)) {
    const h = PLOTS[s.cards[c].cardId];
    if (!h?.timing.includes('instant')) continue;
    const opts = P.plotSense ? plotOptions(s, pl, c).map((o) => o.action)
      : rivalsOf(s, pl).flatMap((r) => structureCards(s, r.id)).map((g): Action => ({ type: 'playPlot', play: { card: c, target: g } }));
    for (const a of spread(opts, 24)) {
      const target = (a as { play: PlotPlay }).play.target;
      const owner = target ? s.cards[target]?.controller : undefined;
      if (!target || !owner || owner === pl) continue;
      let after: GameState;
      try { after = applyAction(s, pl, a); } catch { continue; }
      const chance = after.attack ? attackChance(after) : 0;
      const stop = P.stopWin && nearWin(s, owner);
      const min = stop ? (P.endgame ? 0.15 : 0.25) : 0.4;
      const value = groupValue(s, target) + (stop ? 8 + subtree(s, target).length * 3 : 0);
      if (chance < min || (!stop && value < 6)) continue;
      const score = chance * value;
      if (score > bestScore) { bestScore = score; best = a; }
    }
  }
  return best;
}

/** A New World Order: played when the position after it, and our attack chances, beat keeping it. */
function nwoMove(s: GameState, pl: string): Action | undefined {
  const nwos = plotsInHand(s, pl).filter((c) => PLOTS[s.cards[c].cardId]?.timing.includes('nwo'));
  if (!nwos.length) return undefined;
  const now = evaluate(s, pl);
  const topPlan = (x: GameState) => { const p = planAttacks(x, pl)[0]; return p ? p.score : 0; };
  let planNow: number | undefined;
  let best: Action | undefined;
  let bestGain = 1;
  for (const c of nwos) {
    const a: Action = { type: 'playPlot', play: { card: c } };
    let after: GameState;
    try { after = rollout(applyAction(s, pl, a), pl); } catch { continue; }
    if (after.phase !== 'main' || after.players[after.active].id !== pl) continue;
    const direct = evaluate(after, pl) - now;
    if (direct < -4) continue; // our attack chances would have to change a great deal: not worth checking
    planNow ??= topPlan(s);
    const gain = direct + 0.5 * (topPlan(after) - planNow);
    if (gain > bestGain) { bestGain = gain; best = a; }
  }
  return best;
}

/**
 * Relief for our Devastated Places: the smallest set of our Groups with tokens that is enough, after
 * counting any Groups other players have pledged to it (they pay together, R037).
 */
function reliefOptions(s: GameState, pl: string): Action[] {
  const out: Action[] = [];
  for (const place of structureCards(s, pl).filter((g) => s.cards[g].devastated)) {
    const pledges = reliefPledgesFor(s, place, pl);
    const partners = pledges.length ? { partners: pledges.map((x) => x.player) } : {};
    const need = 3 * (def(s, place).power ?? 0) - pledges.reduce((n, x) => n + x.power, 0);
    if (need <= 0) { out.push({ type: 'relief', place, payWith: [], ...partners }); continue; }
    const pool = structureCards(s, pl).filter((g) => s.cards[g].tokens > 0 && g !== place).sort((a, b) => power(s, a) - power(s, b));
    const single = pool.find((g) => power(s, g) >= need);
    const pay: string[] = [];
    if (single) pay.push(single);
    else { let n = 0; for (const g of [...pool].reverse()) { if (n >= need) break; pay.push(g); n += power(s, g); } if (n < need) continue; }
    out.push({ type: 'relief', place, payWith: pay, ...partners });
  }
  return out;
}

/** Position bonus a Group gets from where it sits (R006): +10 next to the Illuminati, +5 one further. */
const shelter = (d: number) => (d === 1 ? 10 : d === 2 ? 5 : 0);

/** How well a Power Structure is laid out: key Groups sheltered, and Groups with tokens free to take over. */
function layoutScore(s: GameState, pl: string): number {
  let v = 0;
  const ill = player(s, pl).illuminati;
  for (const g of structureCards(s, pl)) {
    const open = openArrows(s, g).length;
    v += open * 0.3;
    if (g === ill) continue;
    v += groupValue(s, g) * shelter(depth(s, g)) * 0.03 * (S.fullDefense ? 1.5 : 1);
    if (s.cards[g].tokens > 0 && power(s, g) >= 3 && open) v += 1;
  }
  return v + goalCount(s, pl) * 3;
}

/**
 * The best single move of one of our Groups, judged by the layout it leaves. `free` moves cost nothing;
 * otherwise the cheapest payer is used (the moved Group, its old or new master, or the Illuminati).
 */
function bestMove(s: GameState, pl: string, free: boolean, minGain: number): { action: Action; gain: number } | undefined {
  const me = player(s, pl);
  const base = layoutScore(s, pl);
  const cards = structureCards(s, pl);
  const movers = cards.filter((g) => g !== me.illuminati && def(s, g).type === 'Group')
    .sort((a, b) => groupValue(s, b) - groupValue(s, a)).slice(0, 8);
  let best: { action: Action; gain: number } | undefined;
  let tried = 0;
  for (const g of movers) {
    const tree = new Set(subtree(s, g));
    for (const onto of cards) {
      if (tree.has(onto) || onto === s.cards[g].master) continue;
      for (const side of openArrows(s, onto, tree)) {
        if (tried++ > 40) return best;
        const payers = [g, s.cards[g].master, onto, me.illuminati].filter((x): x is string => !!x && s.cards[x]?.tokens > 0)
          .sort((a, b) => Number(a === me.illuminati) - Number(b === me.illuminati) || power(s, a) - power(s, b));
        const payWith = free ? g : payers[0];
        if (!payWith) continue;
        const action: Action = { type: 'move', group: g, onto, side, payWith };
        let after: GameState;
        try { after = rollout(applyAction(s, pl, action), pl); } catch { continue; }
        if (after.phase !== 'main' || after.players[after.active].id !== pl) continue;
        const gain = layoutScore(after, pl) - base - (free ? 0 : 1.5);
        if (gain > (best?.gain ?? minGain)) best = { action, gain };
      }
    }
  }
  return best;
}

/**
 * At the end of the main phase: start a reorganization (Bermuda Triangle: free moves but no more
 * attacks; Elders of Zion: one reorganization for two actions) when it clearly pays, or (Hard, and
 * Turtles) pay for one move that shelters a key Group or frees an arrow.
 */
function reorganizeMove(s: GameState, pl: string): Action | undefined {
  if (s.turnFlags.freeMoves === pl) return undefined;
  const level = Math.max(P.reorganize, S.fullDefense && P.reorganize ? 2 : 0);
  // What would free moves be worth? Try them on a copy where moving costs nothing.
  const probe: GameState = { ...s, turnFlags: { ...s.turnFlags, freeMoves: pl } };
  const freeGain = bestMove(probe, pl, true, 1.5)?.gain ?? 0;
  if (freeGain > 1.5) {
    for (const a of abilityMoves(s, pl, 'reorganize', [undefined])) {
      const elders = s.cards[(a as { card: string }).card].cardId === 'elders-of-zion';
      if (elders && freeGain < 3) continue;
      if (tryAction(s, pl, a)) return a;
    }
  }
  if (level >= 2) {
    const mv = bestMove(s, pl, false, 2.5);
    if (mv) return mv.action;
  }
  return undefined;
}

/** The control arrow of `attacker` that best receives `target` (with its puppets), or undefined. */
function bestArrow(s: GameState, pl: string, attacker: string, target: string): Side | undefined {
  const sides = openArrows(s, attacker);
  if (sides.length < 2) return sides[0];
  const keep = subtree(s, target).length;
  let best: Side | undefined, bestScore = -Infinity;
  for (const side of sides) {
    const t: GameState = structuredClone(s);
    try {
      if (t.cards[target].zone === 'structure') moveSubtree(t, target, pl, attacker, side, 'discard');
      else placeGroup(t, target, pl, attacker, side);
    } catch { continue; }
    const kept = t.cards[target].zone === 'structure' ? subtree(t, target).length : 0;
    const score = (kept - keep) * 5 + structureCards(t, pl).reduce((n, g) => n + openArrows(t, g).length, 0);
    if (score > bestScore) { bestScore = score; best = side; }
  }
  return best;
}

function genericMainMoves(s: GameState, pl: string): Action | undefined {
  const cands: Action[] = [];
  for (const c of plotsInHand(s, pl)) {
    const h = PLOTS[s.cards[c].cardId];
    if (!h || !(h.timing.includes('anytime') || h.timing.includes('nwo'))) continue;
    if (h.timing.includes('nwo') && P.judgeNwo) continue; // weighed on their own (nwoMove)
    cands.push(...spread(plotOptions(s, pl, c).map((o) => o.action), 8));
  }
  for (const card of [...structureCards(s, pl), ...resourcesOf(s, pl)]) {
    const abs = HOOKS[s.cards[card].cardId]?.actions ?? [];
    const ok = new Set(abs.filter((ab) => ab.ai !== 'never' && ab.ai !== 'reorganize' && (ab.usesToken || ab.oncePerTurn || ab.ai === 'free')).map((ab) => ab.id));
    if (ok.size) cands.push(...spread(abilityOptions(s, pl, card).map((o) => o.action).filter((a) => a.type === 'useAbility' && ok.has(a.ability)), 8));
    // Abilities that bring a Resource into play from hand or deck (Flying Saucer, Evil Geniuses, Warehouse 23).
    const me = player(s, pl);
    const own = [...me.hand, ...me.groupDeck, ...me.plotDeck].filter((c) => def(s, c).type === 'Resource');
    for (const ab of abs) {
      if (!ok.has(ab.id) || ab.needs?.target !== 'resource') continue;
      for (const r of own.slice(0, 12)) {
        const a: Action = { type: 'useAbility', card, ability: ab.id, params: { target: r } };
        if (!checkAbility(s, pl, card, ab.id, { target: r })) cands.push(a);
      }
    }
  }
  if (P.relief) cands.push(...reliefOptions(s, pl));
  if (!cands.length) return undefined;
  return bestBySimulation(s, pl, cands, evaluate(s, pl), S.schemer ? 0.6 : 1.5, 40);
}

/** Plots and abilities that change the attack's odds, judged by how much they move them. */
function oddsMove(s: GameState, pl: string, wantSuccess: boolean, worth: number): Action | undefined {
  const base = attackChance(s);
  let best: Action | undefined;
  let bestGain = 1.5;
  const opts = responseOptions(s, pl).map((o) => o.action).filter((a) => a.type === 'playPlot' || a.type === 'useAbility');
  for (const a of spread(opts, 40)) {
    let after: GameState;
    try { after = applyAction(s, pl, a); } catch { continue; }
    const chance = after.attack && after.attack.id === s.attack!.id ? attackChance(after) : 0;
    const gain = (wantSuccess ? chance - base : base - chance) * worth - (a.type === 'playPlot' ? 1.2 : 0.4);
    if (gain > bestGain) { bestGain = gain; best = a; }
  }
  return best;
}

function respondToAttack(s: GameState, pl: string): Action {
  const ctx = s.attack!;
  const chance = successChance(attackStrength(s, ctx).strength);
  const mine = structureCards(s, pl).filter((g) => s.cards[g].tokens > 0);
  if (ctx.attackerPlayer === pl) {
    if (chance < P.aidBelow) {
      const dup = player(s, pl).hand.find((h) => s.cards[h].cardId === s.cards[ctx.target].cardId && h !== ctx.target);
      if (dup && ctx.targetPlayer && ctx.targetPlayer !== pl) {
        const a: Action = { type: 'agent', card: dup, as: 'aid' };
        if (tryAction(s, pl, a)) return a;
      }
      for (const a of abilityMoves(s, pl, 'boostAttack', [ctx.target, ctx.attacker])) if (tryAction(s, pl, a)) return a;
      const odds = oddsMove(s, pl, true, groupValue(s, ctx.target) + 4);
      if (odds) return odds;
      const helpers = mine.map((g) => ({ g, r: canAid(s, pl, g) })).filter((x) => x.r.ok)
        .sort((a, b) => power(s, b.g) - power(s, a.g));
      for (const h of helpers) {
        const a: Action = { type: 'aid', group: h.g };
        if (tryAction(s, pl, a)) return a;
      }
    }
    return { type: 'pass' };
  }
  // Other players' fights: help whichever side stops a rival about to win (or, Hard, the leader).
  if (ctx.targetPlayer !== pl) {
    const m = interfereMove(s, pl, ctx);
    if (m) return m;
  }
  // The Meddler steps into other players' fights, once per attack, to stop the leader winning ground.
  if (S.meddler && ctx.targetPlayer && ctx.targetPlayer !== pl && chance > 0.45 && !ctx.oppose.some((c) => c.player === pl)) {
    const lead = [...s.players].filter((p) => !p.eliminated).sort((a, b) => standing(s, b.id) - standing(s, a.id))[0]?.id;
    if (ctx.attackerPlayer === lead || nearWin(s, ctx.attackerPlayer)) {
      const spare = mine.filter((g) => g !== player(s, pl).illuminati && canOppose(s, pl, g).ok).sort((a, b) => globalPower(s, b) - globalPower(s, a))[0];
      if (spare) { const a: Action = { type: 'oppose', group: spare }; if (tryAction(s, pl, a)) return a; }
    }
  }
  if (ctx.targetPlayer === pl && slips(s, pl, 'defend')) return { type: 'pass' };
  // Hard defends even long shots when the attacker is about to win.
  const defendMin = P.endgame && nearWin(s, ctx.attackerPlayer) ? 0.08 : Math.max(0.05, P.defendMin + S.defend);
  if (ctx.targetPlayer === pl && chance > defendMin) {
    const worth = groupValue(s, ctx.target);
    // Defensive +10 first (cheap), then Groups — the target itself counts double.
    for (const c of plotsInHand(s, pl)) {
      const play: PlotPlay = { card: c, target: ctx.target, mode: 'resistance' };
      const a: Action = { type: 'playPlot', play };
      if (worth >= 6 && PLOTS[s.cards[c].cardId]?.needs?.mode && tryAction(s, pl, a)) return a;
    }
    for (const a of abilityMoves(s, pl, 'cancelAttacker', [ctx.attacker])) if (worth >= 6 && tryAction(s, pl, a)) return a;
    for (const a of abilityMoves(s, pl, 'boostDefense', [ctx.target, ctx.attacker])) if (tryAction(s, pl, a)) return a;
    const odds = oddsMove(s, pl, false, worth + 4);
    if (odds) return odds;
    const defenders = mine.map((g) => ({ g, r: canOppose(s, pl, g) })).filter((x) => x.r.ok)
      .sort((a, b) => Number(b.r.self) - Number(a.r.self) || power(s, b.g) - power(s, a.g));
    for (const d of defenders) {
      if (!P.fullDefense && !S.fullDefense && d.g === player(s, pl).illuminati && worth < 8 && !d.r.self) continue; // keep the Illuminati token unless it matters
      const a: Action = { type: 'oppose', group: d.g };
      if (tryAction(s, pl, a)) return a;
    }
    // Cancel an attack plot with a counter if we hold one.
    for (const c of P.tricks ? plotsInHand(s, pl) : []) {
      const id = s.cards[c].cardId;
      if (!['hoax', 'secrets-man-was-not-meant-to-know'].includes(id)) continue;
      for (const p of ctx.plays.filter((x) => x.player !== pl)) {
        const payWith = id === 'hoax' ? mine.filter((g) => g !== ctx.target).sort((a, b) => power(s, b) - power(s, a)).slice(0, 3) : undefined;
        const a: Action = { type: 'playPlot', play: { card: c, target: p.iid, payWith, mode: id === 'secrets-man-was-not-meant-to-know' ? 'illuminati' : undefined } };
        if (tryAction(s, pl, a)) return a;
      }
    }
  }
  return { type: 'pass' };
}

/**
 * Joining an attack between two other players. Worth it when one of them is about to win (Normal) or
 * is the clear leader (Hard, Meddlers, Kingslayers): the stake is how much better off we are if the
 * attack fails (or succeeds), and each way to help is judged by how far it moves the odds, against the
 * cost of the token (little at the end of the round, when our tokens come back soon) or card.
 */
function interfereMove(s: GameState, pl: string, ctx: AttackCtx): Action | undefined {
  const level = P.interfere;
  if (!level || ctx.attackerPlayer === pl || ctx.targetPlayer === pl) return undefined;
  const live = s.players.filter((p) => !p.eliminated && p.id !== pl);
  const ranked = live.map((p) => ({ id: p.id, v: standing(s, p.id, pl) })).sort((a, b) => b.v - a.v);
  const clearLead = ranked.length > 1 && ranked[0].v - ranked[1].v > 8 ? ranked[0].id : undefined;
  const threat = (id?: string) => !!id && (nearWin(s, id) || (level >= 2 && id === clearLead));
  const hitAttacker = threat(ctx.attackerPlayer), hitDefender = threat(ctx.targetPlayer);
  if (hitAttacker === hitDefender) return undefined;
  // Something we could actually do: a Group with a token, a duplicate of the target, or a Plot.
  const me = player(s, pl);
  const dup = me.hand.find((h) => h !== ctx.target && s.cards[h].cardId === s.cards[ctx.target].cardId);
  const groups = structureCards(s, pl).filter((g) => s.cards[g].tokens > 0);
  if (!dup && !groups.length && !(level >= 2 && plotsInHand(s, pl).length)) return undefined;
  // Our stake in the result, from our own point of view (positive: we want it to fail).
  const stake = attackOutcomeScore(s, pl, false) - attackOutcomeScore(s, pl, true);
  const wantFail = stake > 0;
  if (Math.abs(stake) < 3 || wantFail !== hitAttacker) return undefined;
  const base = attackChance(s);
  if (wantFail ? base < 0.08 : base > 0.92) return undefined;
  // Our tokens come back at the start of our turn: spending them just before it costs little.
  const soon = nextPlayer(s) === pl;
  const tokenCost = (g: string) => (g === me.illuminati ? 2.5 : 1) * (soon ? 0.4 : 1.5);
  const cands: { a: Action; cost: number }[] = [];
  if (dup) cands.push({ a: { type: 'agent', card: dup, as: wantFail ? 'oppose' : 'aid' }, cost: 0.6 });
  for (const g of groups) {
    const r = wantFail ? canOppose(s, pl, g) : canAid(s, pl, g);
    if (r.ok) cands.push({ a: { type: wantFail ? 'oppose' : 'aid', group: g }, cost: tokenCost(g) });
  }
  if (level >= 2) {
    for (const o of spread(responseOptions(s, pl).map((x) => x.action).filter((a) => a.type === 'playPlot' || a.type === 'useAbility'), 16)) {
      cands.push({ a: o, cost: o.type === 'playPlot' ? 2 : 1 });
    }
  }
  let best: Action | undefined;
  let bestGain = 1;
  for (const c of cands) {
    let after: GameState;
    try { after = applyAction(s, pl, c.a); } catch { continue; }
    const chance = after.attack && after.attack.id === ctx.id ? attackChance(after) : 0;
    const gain = (wantFail ? base - chance : chance - base) * Math.abs(stake) - c.cost;
    if (gain > bestGain) { bestGain = gain; best = c.a; }
  }
  return best;
}

function respondToRoll(s: GameState, pl: string): Action {
  const ctx = s.attack!;
  const outcome = currentOutcome(s, ctx);
  const wantFail = ctx.targetPlayer === pl;
  const wantSuccess = ctx.attackerPlayer === pl;
  if (!P.tricks) return { type: 'pass' };
  if ((wantFail && outcome === 'success') || (wantSuccess && outcome === 'failure')) {
    for (const c of plotsInHand(s, pl)) {
      const id = s.cards[c].cardId;
      const mine = structureCards(s, pl);
      const plays: PlotPlay[] = [];
      if (id === 'read-my-lips' || id === 'murphy-s-law' || id === 'fnord' || (id === 'bribery' && wantSuccess)) plays.push({ card: c });
      if (id === 'computer-virus') for (const g of mine) plays.push({ card: c, payWith: [g], mode: wantFail ? 'up' : 'down' });
      for (const play of plays) {
        const a: Action = { type: 'playPlot', play };
        if (!tryAction(s, pl, a)) continue;
        const after = applyAction(s, pl, a);
        if (after.attack && currentOutcome(after, after.attack) !== outcome) return a;
        if (id === 'fnord') return a;
      }
    }
    // Anything else that turns the result around. A card that rolls again is tried with a few look-ahead
    // rolls of its own (never the real dice to come), and played when it turns the result often enough.
    for (const o of spread(responseOptions(s, pl).map((x) => x.action).filter((a) => a.type === 'playPlot' || a.type === 'useAbility'), 30)) {
      let flips = 0, tries = 0;
      for (let k = 0; k < 4; k++) {
        let after: GameState;
        try { after = applyAction(hideDice(s, 10 + k), pl, o); } catch { break; }
        tries++;
        if (after.attack ? currentOutcome(after, after.attack) !== outcome : wantFail) flips++;
        if (!rerolled(after)) { flips = flips ? tries : 0; break; } // no dice involved: one try tells
      }
      if (tries && flips / tries >= 0.25) return o;
    }
  }
  return { type: 'pass' };
}

/** Did the play roll the dice again? */
function rerolled(s: GameState): boolean {
  return !!s.attack?.plays.some((p) => p.effect.t === 'reroll');
}

/** A computer's habits can tilt what its level does (see personas.ts). */
function withStyle(p: Profile, st: Style, level: AiLevel): Profile {
  const q = { ...p };
  if (st.meddler) q.interfere = 2;                                  // steps into every fight the leader is in
  if (st.leader >= 2 && level !== 'easy') q.interfere = 2;          // Kingslayer: anything that stops the leader
  if (st.schemer) q.cashIn = Math.max(q.cashIn, 1) as Profile['cashIn'];
  if (st.fullDefense && level !== 'easy') q.reorganize = 2;         // Turtle: shelters its key Groups
  return q;
}

export function chooseAction(s: GameState, pl: string): Action {
  useHabits(s, pl);
  // A computer never lets a win go by: it declares as soon as it may (even the wild cards).
  const claim = declareMove(s, pl);
  if (claim) return claim;
  // Decide on a copy whose dice owe nothing to the real ones: no look-ahead can see what the game will roll.
  const view = hideDice(s);
  if (player(s, pl).aiStyle === 'chaos') return chaosMove(view, pl);
  return decide(view, pl);
}

/** Take on this computer player's level and habits. */
function useHabits(s: GameState, pl: string) {
  const me = player(s, pl);
  const level = me.aiLevel ?? 'normal';
  P = PROFILES[level] ?? PROFILES.normal;
  S = styleOf(me.aiStyle);
  // A mirror carries the habits learned from a person's games. On Normal it also slips as often as
  // they do; Easy keeps its own slips, and Hard plays their habits without mistakes.
  if (me.aiStyleData) {
    const { mistakes, ...knobs } = clampStyle(me.aiStyleData);
    S = { ...BASE_STYLE, ...knobs };
    if (level === 'normal' && mistakes !== undefined) P = { ...P, mistakes };
  }
  P = withStyle(P, S, level);
}

/**
 * Declare victory when a Goal is met and the moment is right (R016). A Goal card is shown only when
 * nothing else will do, since a failed claim leaves it exposed.
 */
function declareMove(s: GameState, pl: string): Action | undefined {
  if (s.prompt) return undefined;
  const opts = declareOptions(s, pl);
  if (!opts.length) return undefined;
  const pick = (o: GoalOption) => (o.card ? 1 : 0);
  const best = [...opts].sort((x, y) => pick(x) - pick(y))[0];
  return { type: 'declareVictory', goal: best.id };
}

/** Let a copy of the game run on, everyone passing, until the declared victories are decided. */
function untilClaimsDecided(state: GameState, success?: boolean): GameState {
  let t = state;
  for (let i = 0; i < 80 && t.phase !== 'gameOver' && t.claims?.length; i++) {
    if (t.window?.kind === 'roll' && t.attack?.roll && success !== undefined) t.attack.roll = success ? [1, 1] : [6, 6];
    let a: Action = { type: 'pass' };
    const who = waitingFor(t)[0];
    if (!who) break;
    if (t.prompt) {
      const ch = t.prompt.choice;
      if (t.prompt.kind !== 'choose' || !ch) break;
      a = { type: 'choose', ids: CHOICES[ch.key]?.ai?.(t, who, ch.options, { ...ch.data, source: ch.source }) ?? ch.options.slice(0, ch.min).map((o) => o.id) };
    }
    try { t = applyAction(t, who, a); } catch { break; }
  }
  return t;
}

/**
 * A rival has declared victory: this is the moment to spend everything. Each Plot and ability we
 * could use now (Instant attacks such as Assassinations and Disasters included) is played out on a
 * copy of the game, and the one most likely to leave every rival claim failing is chosen. An Instant
 * attack counts by its odds: its success and its failure are both played out.
 */
function stopClaim(s: GameState, pl: string): Action | undefined {
  const claimants = (s.claims ?? []).map((c) => c.player).filter((id) => id !== pl);
  if (!claimants.length) return undefined;
  if (slips(s, pl, 'claim')) return undefined;
  const stopped = (t: GameState) => !(t.phase === 'gameOver' && t.winners?.some((w) => claimants.includes(w)));
  const aimedElsewhere = (a: Action) => {
    if (a.type !== 'playPlot' || !a.play.target || !PLOTS[s.cards[a.play.card].cardId]?.timing.includes('instant')) return false;
    const c = s.cards[a.play.target];
    return !!c && c.zone === 'structure' && !claimants.includes(c.controller ?? '');
  };
  const opts = responseOptions(s, pl).map((o) => o.action)
    .filter((a) => (a.type === 'playPlot' || a.type === 'useAbility') && !aimedElsewhere(a));
  let best: Action | undefined;
  let bestValue = 0;
  for (const a of spread(opts, 36)) {
    let after: GameState;
    try { after = applyAction(s, pl, a); } catch { continue; }
    let value: number;
    if (after.attack && after.phase !== 'gameOver') {
      const chance = attackChance(after);
      value = chance * Number(stopped(untilClaimsDecided(after, true))) + (1 - chance) * Number(stopped(untilClaimsDecided(after, false)));
    } else value = Number(stopped(untilClaimsDecided(after)));
    if (value > bestValue + 0.01) { bestValue = value; best = a; }
  }
  if (best) return best;
  // Nothing in hand stops it: spend spare actions on more Plot cards and look again (Normal and Hard).
  if (!P.tricks) return undefined;
  const me = player(s, pl);
  if (!plotDeckOf(s, pl).length || s.turnFlags.noPlotDraws?.includes(pl)) return undefined;
  const spare = structureCards(s, pl).filter((g) => g !== me.illuminati && s.cards[g].tokens > 0).sort((x, y) => power(s, x) - power(s, y));
  const buys: Action[] = [{ type: 'buyPlot', payWith: [me.illuminati] }];
  if (spare.length >= 2) buys.push({ type: 'buyPlot', payWith: spare.slice(0, 2) });
  for (const b of buys) if (tryAction(s, pl, b)) return b;
  return undefined;
}

/**
 * The average position after actually playing an attack out `n` times: every player answers as
 * a Normal computer would, and each time the dice fall differently.
 */
function playedOut(s: GameState, pl: string, attack: Action, n: number): number {
  const saved = P, savedS = S;
  P = PROFILES.normal; S = BASE_STYLE;
  let total = 0;
  try {
    for (let k = 0; k < n; k++) {
      let t = applyAction(s, pl, attack);
      t.rng = (Math.imul(s.version + 1, 2654435761) ^ Math.imul(k + 1, 40503)) >>> 0; // a different roll each time
      const id = t.attack?.id;
      for (let j = 0; j < 60 && t.attack && t.attack.id === id && t.phase !== 'gameOver'; j++) {
        const who = waitingFor(t)[0];
        if (!who) break;
        try { t = applyAction(t, who, decide(t, who)); } catch { t = applyAction(t, who, t.window ? { type: 'pass' } : { type: 'endTurn' }); }
      }
      total += evaluate(rollout(t, pl), pl);
    }
  } finally { P = saved; S = savedS; }
  return total / n;
}

const goalCardProgress = (s: GameState, pl: string, card: string) => GOAL_PROGRESS[s.cards[card].cardId]?.(s, pl) ?? 0;

/** How much a Plot in hand is worth keeping, roughly (for discarding down to the hand limit). */
function plotValue(s: GameState, pl: string, card: string): number {
  const d = def(s, card);
  const h = PLOTS[d.id];
  if (d.subtype === 'Goal') return 4 + 10 * goalCardProgress(s, pl, card);
  // A spare Illuminati is worth keeping while a rival plays that Illuminati (it can become an agent).
  if (d.type === 'Illuminati') return rivalsOf(s, pl).some((r) => s.cards[r.illuminati].cardId === d.id) ? 4 : 0;
  if (!h) return 0;
  const t = h.timing;
  if (t.includes('instant')) return 4.5 + (rivalsOf(s, pl).some((r) => nearWin(s, r.id)) ? 2 : 0);
  if (t.includes('nwo')) return 2;
  if (t.includes('counter')) return 4.5;
  if (t.includes('roll')) return 4;
  if (h.needs?.mode?.includes('power')) {
    // A +10 Plot is only as good as the Groups we have that can use it.
    const probe = structuredClone(s);
    const fits = structureCards(s, pl).some((g) => {
      probe.attack = hypotheticalCtx(probe, pl, g, g, 'destroy');
      return !h.check(probe, pl, { card, target: g, mode: 'power' }, probe.attack);
    });
    return fits ? 4.5 : 1.5;
  }
  if (h.needs?.targets) return 3.5;
  return 3;
}

function decide(s: GameState, pl: string): Action {
  if (s.prompt?.player === pl) {
    if (s.prompt.kind === 'chooseLead') return { type: 'chooseLead', card: bestLead(s, pl) };
    // After a capture or move, the automatic arrangement is kept.
    if (s.prompt.kind === 'placeCaptured') return { type: 'placeCapturedDone' };
    if (s.prompt.kind === 'draw') {
      const d = s.prompt.data as { plot: number; group: number };
      return { type: 'draw', deck: d.plot > 0 ? 'plot' : 'group' };
    }
    if (s.prompt.kind === 'choose' && s.prompt.choice) {
      const ch = s.prompt.choice;
      const pick = CHOICES[ch.key]?.ai?.(s, pl, ch.options, { ...ch.data, source: ch.source }) ?? ch.options.slice(0, ch.min).map((o) => o.id);
      return { type: 'choose', ids: pick };
    }
    if (s.prompt.kind === 'takeover') {
      const opts = takeoverOptions(s, pl);
      opts.sort((a, b) => groupValue(s, b.card) - groupValue(s, a.card) || depth(s, a.onto) - depth(s, b.onto));
      if (P.smartTakeover && opts.length > 1) {
        // Play out the most promising placements and keep the one that leaves us best off.
        let best = opts[0], bestScore = -Infinity;
        for (const o of spread(opts, 12)) {
          try {
            const score = evaluate(applyAction(s, pl, { type: 'takeover', ...o }), pl) + (openArrowsAfter(s, pl, o) * 0.8);
            if (score > bestScore) { bestScore = score; best = o; }
          } catch { /* not placeable after all */ }
        }
        return { type: 'takeover', ...best };
      }
      if (opts.length > 1 && slips(s, pl, 'takeover')) return { type: 'takeover', ...opts[Math.floor(roll01(s, pl, 'tk') * opts.length)] };
      return opts.length ? { type: 'takeover', ...opts[0] } : { type: 'skipTakeover' };
    }
    if (s.prompt.kind === 'discardToLimit') {
      // Too many Goal cards (limit 1, UFOs 3) and/or Plots: drop surplus Goals first, then the least useful Plots.
      // Keep the Goal cards we are closest to meeting.
      const goals = P.plotSense ? [...goalsInHand(s, pl)].sort((a, b) => goalCardProgress(s, pl, b) - goalCardProgress(s, pl, a)) : goalsInHand(s, pl);
      const drop = goals.slice(goalLimit(s, pl));
      const outside = s.prompt.data?.resume === 'endTurn' || s.players[s.active].id !== pl;
      const plots = plotsInHand(s, pl).filter((c) => !drop.includes(c));
      const excess = outside ? plots.length - handLimit(s, pl) : 0;
      const byValue = P.plotSense ? [...plots].sort((a, b) => plotValue(s, pl, a) - plotValue(s, pl, b))
        : [...plots].sort((a, b) => (PLOTS[s.cards[a].cardId] ? 1 : 0) - (PLOTS[s.cards[b].cardId] ? 1 : 0));
      return { type: 'discard', cards: [...drop, ...byValue.slice(0, Math.max(0, excess))] };
    }
  }
  const w = s.window;
  // A rival is claiming victory: try everything that could stop it before anything else.
  if (w?.kind === 'endOfTurn' && s.claims?.some((c) => c.player !== pl)) {
    const stop = stopClaim(s, pl);
    if (stop) return stop;
  }
  if (w?.kind === 'attack' && s.attack) return respondToAttack(s, pl);
  if (w?.kind === 'roll' && s.attack) return respondToRoll(s, pl);
  if (w && (w.kind === 'plot' || w.kind === 'event' || w.kind === 'endOfTurn')) return windowMove(s, pl);
  if (w) return { type: 'pass' };
  if (s.phase === 'main' && s.players[s.active].id === pl) return mainPhase(s, pl);
  return { type: 'pass' };
}

/**
 * A wild card: any legal move, picked at random. It still has to follow the rules (every move is
 * checked), but it has no plan at all. Now and then that stumbles into brilliance.
 */
function chaosMove(s: GameState, pl: string): Action {
  const pick = <T>(xs: T[], salt: string): T => xs[Math.floor(roll01(s, pl, salt) * xs.length)];
  const legalOnes = (xs: Action[]) => xs.filter((a) => tryAction(s, pl, a));
  if (s.prompt?.player === pl) {
    const pr = s.prompt;
    if (pr.kind === 'takeover') {
      const opts = takeoverOptions(s, pl);
      if (opts.length && roll01(s, pl, 'skip') > 0.2) return { type: 'takeover', ...pick(opts, 'tk') };
      if (tryAction(s, pl, { type: 'skipTakeover' })) return { type: 'skipTakeover' };
    }
    if (pr.kind === 'choose' && pr.choice) {
      const ids = pr.choice.options.map((o) => o.id);
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(roll01(s, pl, `c${i}`) * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      const n = pr.choice.min + Math.floor(roll01(s, pl, 'n') * (pr.choice.max - pr.choice.min + 1));
      const a: Action = { type: 'choose', ids: ids.slice(0, n) };
      if (tryAction(s, pl, a)) return a;
    }
    if (pr.kind === 'draw') {
      const a: Action = { type: 'draw', deck: roll01(s, pl, 'deck') < 0.5 ? 'plot' : 'group' };
      if (tryAction(s, pl, a)) return a;
    }
    return decide(s, pl); // anything else: answer it plainly
  }
  if (s.window) {
    if (roll01(s, pl, 'pass') < 0.55) return { type: 'pass' };
    const opts = legalOnes(spread(responseOptions(s, pl).map((o) => o.action), 30));
    return opts.length ? pick(opts, 'resp') : { type: 'pass' };
  }
  if (s.phase === 'main' && s.players[s.active].id === pl) {
    if (roll01(s, pl, 'end') < 0.25) return { type: 'endTurn' };
    const me = player(s, pl);
    const cands: Action[] = [];
    for (const g of structureCards(s, pl).filter((x) => s.cards[x].tokens > 0)) {
      for (const o of attackOptions(s, pl, g)) cands.push({ type: 'attack', attackType: o.type, attacker: g, target: o.target, side: o.sides.length ? pick(o.sides, `side${o.target}`) : undefined });
      cands.push(...abilityOptions(s, pl, g).map((o) => o.action));
    }
    for (const c of plotsInHand(s, pl)) cands.push(...plotOptions(s, pl, c).map((o) => o.action));
    for (const h of me.hand) if (def(s, h).type === 'Resource') cands.push({ type: 'playResource', card: h });
    cands.push({ type: 'buyPlot', payWith: [me.illuminati] }, { type: 'drawGroup' });
    const opts = legalOnes(spread(cands, 40));
    return opts.length ? pick(opts, 'main') : { type: 'endTurn' };
  }
  return decide(s, pl);
}

/** Open arrows the structure would have after a takeover: room to grow. */
function openArrowsAfter(s: GameState, pl: string, o: { card: string; onto: string; side: Side }): number {
  try {
    const after = applyAction(s, pl, { type: 'takeover', ...o });
    return structureCards(after, pl).reduce((n, g) => n + openArrows(after, g).length, 0);
  } catch { return 0; }
}

/** Counter a harmful Plot, or answer an event, when the look-ahead says it pays. */
function windowMove(s: GameState, pl: string): Action {
  const cash = cashInMove(s, pl);
  if (cash) return cash;
  if (!P.tricks) return { type: 'pass' };
  let opts = responseOptions(s, pl).map((o) => o.action);
  if (!opts.length) return { type: 'pass' };
  const w = s.window!;
  const startsAttack = (a: Action) => a.type === 'playPlot' && !!PLOTS[s.cards[a.play.card].cardId]?.timing.includes('instant');
  // Instant attacks outside our own turn: only to stop a rival who is about to win.
  const danger = P.stopWin && w.kind === 'endOfTurn' && rivalsOf(s, pl).some((r) => nearWin(s, r.id) || meetsVisibleGoal(s, r.id, pl));
  opts = opts.filter((a) => !startsAttack(a) || danger);
  // A rival's Plot waiting to resolve: counters first, and judged with a smaller margin.
  const rivalPlot = w.kind === 'plot' && !!w.plot && w.plot.player !== pl;
  const isCounter = (a: Action) => (a.type === 'playPlot' ? !!PLOTS[s.cards[a.play.card].cardId]?.timing.includes('counter') : a.type === 'useAbility');
  if (rivalPlot && P.plotSense) opts = [...opts.filter(isCounter), ...opts.filter((a) => !isCounter(a))];
  if (danger) opts = [...opts.filter(startsAttack), ...opts.filter((a) => !startsAttack(a))];
  if (!opts.length) return { type: 'pass' };
  let baseline: number;
  try { baseline = evaluate(rollout(applyAction(s, pl, { type: 'pass' }), pl), pl); } catch { return { type: 'pass' }; }
  const margin = rivalPlot && P.plotSense ? (P.smartTakeover ? 0.75 : 1) : 1.5;
  return bestBySimulation(s, pl, spread(opts, 24), baseline, margin, 24) ?? { type: 'pass' };
}

/** A rival who meets the Basic Goal, or a Special Goal or exposed Goal card that `viewer` can see. */
function meetsVisibleGoal(s: GameState, id: string, viewer: string): boolean {
  return goalCount(s, id) >= goalNeeded(s, id) || goalProgress(s, id, viewer) >= 1;
}

// ------------------------------------------------------------------ deals

/** A Plot's worth to keep: Goals and Plots this version plays are worth more than the rest. */
function plotKeep(s: GameState, c: string): number {
  const d = def(s, c);
  return (d.subtype === 'Goal' ? 3 : 0) + (PLOTS[d.id] ? 1 : 0) + (d.id === I_LIED ? 2 : 0);
}

/** Could this player bring a Group card from hand into play (an open arrow and no copy in play)? */
function usableGroupCard(s: GameState, pl: string, c: string): boolean {
  return def(s, c).type === 'Group' && canEnterPlay(s, c) && structureCards(s, pl).some((g) => openArrows(s, g).length > 0);
}

/** What the look-ahead misses: a Group card someone can actually take over is worth more than a card. */
function cardBonus(s: GameState, pl: string, cards: string[]): number {
  return cards.filter((c) => usableGroupCard(s, pl, c)).reduce((n, c) => n + 0.5 * (def(s, c).power ?? 0) + 1, 0);
}

/** Accept an offer, making the choices it leaves open the plain way: cheapest cards, shallowest arrows. */
function acceptMove(s: GameState, pl: string, d: Deal): Extract<Action, { type: 'respondDeal' }> | undefined {
  const me = player(s, pl);
  const hand = me.hand.filter((c) => !(d.get.cards ?? []).includes(c) && s.cards[c].cardId !== I_LIED);
  const plots = hand.filter((c) => def(s, c).type === 'Plot').sort((a, b) => plotKeep(s, a) - plotKeep(s, b));
  const others = hand.filter((c) => def(s, c).type !== 'Plot').sort((a, b) => groupValue(s, a) - groupValue(s, b));
  if (plots.length < (d.get.anyPlots ?? 0) || others.length < (d.get.anyCards ?? 0)) return undefined;
  const choose = [...plots.slice(0, d.get.anyPlots ?? 0), ...others.slice(0, d.get.anyCards ?? 0)];
  const groups: DealGroup[] = [];
  const taken = new Set<string>();
  const spots = structureCards(s, pl).flatMap((m) => openArrows(s, m).map((side) => ({ onto: m, side }))).sort((a, b) => depth(s, a.onto) - depth(s, b.onto));
  const payer = (xs: (string | undefined)[]) => xs.find((x): x is string => !!x && s.cards[x]?.controller === pl && s.cards[x].tokens > 0 && !tokenBarred(s, x));
  for (const g of d.give.groups ?? []) {
    const spot = spots.find((o) => !taken.has(`${o.onto}:${o.side}`));
    if (!spot) return undefined;
    taken.add(`${spot.onto}:${spot.side}`);
    const payWith = g.payWith ?? payer([spot.onto, me.illuminati]);
    if (!payWith) return undefined;
    groups.push({ group: g.group, onto: spot.onto, side: spot.side, payWith });
  }
  for (const g of d.get.groups ?? []) {
    if (g.payWith) continue;
    const payWith = payer([g.group, s.cards[g.group]?.master, me.illuminati]);
    if (!payWith) return undefined;
    groups.push({ group: g.group, payWith });
  }
  return { type: 'respondDeal', deal: d.id, accept: true, choose, groups };
}

/**
 * Answer an offer made to a computer player. It accepts when the deal leaves it better placed by a
 * margin and does not feed the leader or a rival about to win; a Meddler or Kingslayer deals more
 * readily with anyone but the leader. With I Lied in hand it sometimes keeps its own side. Wild cards
 * accept or refuse at random.
 */
export function answerOffer(s: GameState, pl: string, d: Deal): Action {
  useHabits(s, pl);
  const no: Action = { type: 'respondDeal', deal: d.id, accept: false };
  const yes = acceptMove(s, pl, d);
  if (!yes) return no;
  let after: GameState;
  try { after = applyAction(s, pl, yes); } catch { return no; }
  if (player(s, pl).aiStyle === 'chaos') return roll01(s, pl, `deal${d.id}`) < 0.5 ? yes : no;
  const given = [...(d.get.cards ?? []), ...(yes.choose ?? [])];
  const gain = evaluate(after, pl) - evaluate(s, pl) + cardBonus(s, pl, d.give.cards ?? []) - cardBonus(s, pl, given);
  const theirGain = standing(after, d.from) - standing(s, d.from) + cardBonus(s, d.from, given);
  // A rival close to winning gets nothing from us but his own gifts: we cannot see what a card is worth to him.
  if (!sideEmpty(d.get) && (nearWin(s, d.from) || nearWin(after, d.from))) return no;
  const leader = rivalsOf(s, pl).map((r) => r.id).sort((a, b) => standing(s, b) - standing(s, a))[0];
  const againstLeader = (S.meddler || S.leader >= 2) && d.from !== leader;
  let margin = sideEmpty(d.get) ? 0 : againstLeader ? 0.4 : 1;
  if (d.from === leader && theirGain > 0) margin += 2;
  if (gain <= margin) return no;
  const lie = player(s, pl).hand.find((c) => s.cards[c].cardId === I_LIED && !(yes.choose ?? []).includes(c));
  if (lie && !sideEmpty(d.get) && roll01(s, pl, `lie${d.id}`) < 0.5) {
    const lying: Action = { ...yes, lie };
    if (tryAction(s, pl, lying)) return lying;
  }
  return yes;
}

/**
 * A computer's own offers, kept simple: a Group card it has no room for, traded for a Plot of the
 * other player's choice; or, for a Meddler or Kingslayer, a Plot given to the rival best placed to
 * stop a leader who is about to win. Never to the leader or a rival close to winning.
 */
function dealOffer(s: GameState, pl: string): Action | undefined {
  if (!dealsAllowed(s) || s.turnFlags.dealOffers?.includes(pl) || offersFrom(s, pl).length) return undefined;
  const me = player(s, pl);
  const rivals = rivalsOf(s, pl).filter((r) => r.turnsTaken > 0).map((r) => r.id).sort((a, b) => standing(s, b) - standing(s, a));
  if (rivals.length < 1) return undefined;
  const leader = rivals[0];
  const safe = rivals.filter((r) => (rivals.length === 1 || r !== leader) && !nearWin(s, r));
  const groupsInHand = me.hand.filter((c) => def(s, c).type === 'Group' && s.cards[c].failedTakeoverTurn !== s.turn);
  const noRoom = !structureCards(s, pl).some((g) => openArrows(s, g).length > 0);
  if (safe.length && groupsInHand.length && (noRoom || groupsInHand.length > 3) && roll01(s, pl, 'offer') < 0.35) {
    const card = [...groupsInHand].sort((a, b) => groupValue(s, a) - groupValue(s, b))[0];
    const to = safe[safe.length - 1]; // the weakest: least dangerous to strengthen
    const a: Action = { type: 'offerDeal', to, give: { cards: [card] }, get: { anyPlots: 1 } };
    if (tryAction(s, pl, a)) return a;
  }
  if ((S.meddler || S.leader >= 2) && rivals.length > 1 && nearWin(s, leader) && roll01(s, pl, 'gift') < 0.3) {
    const plots = plotsInHand(s, pl).filter((c) => s.cards[c].cardId !== I_LIED && def(s, c).subtype !== 'Goal');
    const to = safe[0];
    if (to && plots.length >= 2) {
      const card = [...plots].sort((a, b) => plotKeep(s, b) - plotKeep(s, a))[0];
      const a: Action = { type: 'offerDeal', to, give: { cards: [card] }, get: {}, note: 'Use it to stop the leader.' };
      if (tryAction(s, pl, a)) return a;
    }
  }
  return undefined;
}

/** An offer waiting on a computer player, and its answer (computers answer at once, so they never hold a deal up). */
export function computerDealAnswer(s: GameState): { player: string; action: Action } | undefined {
  const d = (s.deals ?? []).find((x) => { const p = s.players.find((q) => q.id === x.to); return !!p && p.isAI && !p.eliminated; });
  return d ? { player: d.to, action: answerOffer(s, d.to, d) } : undefined;
}

/** Apply a computer's answer to an offer; if it turns out not to be legal, it declines instead. */
export function applyDealAnswer(s: GameState, ans: { player: string; action: Action }): GameState {
  try { return applyAction(s, ans.player, ans.action); }
  catch { return applyAction(s, ans.player, { type: 'respondDeal', deal: (ans.action as { deal: string }).deal, accept: false }); }
}

/** Let every computer player act until a human is needed (or the game ends). */
export function runComputerPlayers(state: GameState, maxSteps = 500): GameState {
  let s = state;
  for (let i = 0; i < maxSteps; i++) {
    const ans = computerDealAnswer(s);
    if (ans) { s = applyDealAnswer(s, ans); continue; }
    const ai = waitingFor(s).map((id) => player(s, id)).find((p) => p.isAI);
    if (!ai) return s;
    let a = chooseAction(s, ai.id);
    try {
      s = applyAction(s, ai.id, a);
    } catch {
      a = s.window ? { type: 'pass' } : s.prompt?.kind === 'takeover' ? { type: 'skipTakeover' } : { type: 'endTurn' };
      s = applyAction(s, ai.id, a);
    }
  }
  return s;
}

export { resistance };
