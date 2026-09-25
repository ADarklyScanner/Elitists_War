// Computer opponent. It plays through exactly the same actions as a person, so it can never
// break the rules: every candidate move is checked by the engine before it is chosen.
import {
  type Action, type AttackCtx, type GameState, type PlotPlay, type Side,
  applyAction, attackStrength, canAid, canOppose, checkPlot, currentOutcome, def, openArrows, player,
  plotsInHand, handLimit, power, resistance, structureCards, takeoverOptions, validateAttack, waitingFor,
  alignments, globalPower, abilitiesOf, PLOTS, subtree, goalCount, goalNeeded, depth, bestLead, plotOptions,
  HOOKS, CHOICES, checkAbility, resourcesOf, canEnterPlay, goalsInHand, goalLimit, type AbilityParams,
  type AiLevel, declareOptions, type GoalOption,
} from '../engine';
import { OPPOSITE } from '../engine/cards';
import { abilityOptions, attackOptions, responseOptions } from '../engine/moves';
import { BASE_STYLE, clampStyle, styleOf, type Style } from './personas';
import { attackChance, attackOutcomeScore, bestBySimulation, evaluate, rollout, spread, standing, successChance } from './evaluate';

/** Activated abilities of our cards with a given AI hint, tried against a few likely targets. */
function abilityMoves(s: GameState, pl: string, hint: string, targets: (string | undefined)[]): Action[] {
  const out: Action[] = [];
  const mine = [...structureCards(s, pl), ...resourcesOf(s, pl)];
  for (const card of mine) {
    for (const ab of HOOKS[s.cards[card].cardId]?.actions ?? []) {
      if (ab.ai !== hint) continue;
      if (!ab.usesToken && !ab.oncePerTurn) continue; // free, repeatable abilities could loop forever
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
}
export const PROFILES: Record<AiLevel, Profile> = {
  easy: { minChance: 0.55, costBase: 0, costPerPower: 0, plans: 3, generic: false, mistakes: 0.3, defendMin: 0.45, tricks: false, smartTakeover: false, handPlotDefense: 0, endgame: false, gainMin: 1, fullDefense: false, drawGroups: false, samples: 0, aidBelow: 0.72, aidPlanning: false },
  normal: { minChance: AI_TUNING.minChance, costBase: AI_TUNING.actionCost, costPerPower: 0, plans: 8, generic: true, mistakes: 0, defendMin: 0.25, tricks: true, smartTakeover: false, handPlotDefense: 0, endgame: false, gainMin: 0.5, fullDefense: false, drawGroups: false, samples: 0, aidBelow: 0.72, aidPlanning: false },
  hard: { minChance: 0.3, costBase: 1.5, costPerPower: 0.2, plans: 14, generic: true, mistakes: 0, defendMin: 0.15, tricks: true, smartTakeover: true, handPlotDefense: 0, endgame: true, gainMin: 0.5, fullDefense: true, drawGroups: true, samples: 0, aidBelow: 0.72, aidPlanning: true },
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

/** Pick Plots worth attaching when declaring an attack. */
function declarePlots(s: GameState, pl: string, a: Extract<Action, { type: 'attack' }>): PlotPlay[] {
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
    if (h.timing.includes('nwo') && s.turn >= 3) {
      const a: Action = { type: 'playPlot', play: { card: c } };
      if (tryAction(s, pl, a)) return a;
    }
    if (h.timing.includes('instant')) {
      for (const r of rivalsOf(s, pl)) {
        for (const g of structureCards(s, r.id)) {
          const a: Action = { type: 'playPlot', play: { card: c, target: g } };
          if (!tryAction(s, pl, a)) continue;
          const after = applyAction(s, pl, a);
          const chance = after.attack ? successChance(attackStrength(after, after.attack).strength) : 0;
          if (chance >= 0.4 && groupValue(s, g) >= 6) return a;
        }
      }
    }
  }
  // 1a. The Collector draws Group cards before spending the Illuminati's action on anything else.
  if (S.collector && s.cards[me.illuminati].tokens > 0 && !s.turnFlags.illumGroupDraw && me.groupDeck.length
      && me.hand.filter((h) => def(s, h).type === 'Group').length <= 2) {
    const a: Action = { type: 'drawGroup' };
    if (tryAction(s, pl, a)) return a;
  }
  // 1b. Any other Plot or ability whose result looks better than doing nothing.
  const generic = P.generic ? genericMainMoves(s, pl) : undefined;
  if (generic) return generic;
  // 2. Best attack: the most promising few are played out both ways and weighed by their odds.
  // Against a rival about to win, long shots are worth taking (Hard).
  // A Kingslayer accepts worse odds when the target belongs to the leader.
  const lead = rivalsOf(s, pl).map((r) => r.id).sort((a, b) => standing(s, b) - standing(s, a))[0];
  const minFor = (p: AttackPlan) => (P.endgame && nearWin(s, s.cards[p.action.target].controller) ? 0.12
    : Math.min(0.8, Math.max(0.12, P.minChance + S.risk - (S.leader >= 2 && s.cards[p.action.target].controller === lead ? 0.15 : 0))));
  const plans = planAttacks(s, pl).filter((p) => p.chance >= minFor(p)).slice(0, P.plans);
  const now = evaluate(s, pl);
  let best: AttackPlan | undefined;
  let bestGain = P.gainMin;
  let sampled = 0;
  const viable: AttackPlan[] = [];
  for (const p of plans) {
    let after: GameState;
    try { after = applyAction(s, pl, p.action); } catch { continue; }
    let gain = p.chance * attackOutcomeScore(after, pl, true) + (1 - p.chance) * attackOutcomeScore(after, pl, false) - now - (P.costBase + P.costPerPower * power(s, p.action.attacker)) + p.habit;
    // Hard: play the most promising attacks out for real — the defender answers, the dice roll.
    if (P.samples && gain > -3 && sampled++ < 5) gain = playedOut(s, pl, p.action, P.samples) - now - (P.costBase + P.costPerPower * power(s, p.action.attacker));
    if (gain > 0) viable.push(p);
    if (gain > bestGain) { bestGain = gain; best = p; }
  }
  // Easy sometimes settles for a lesser attack.
  if (best && viable.length > 1 && slips(s, pl, 'attack')) best = viable[Math.floor(roll01(s, pl, 'pick') * viable.length)];
  if (best) {
    const withPlots = { ...best.action, plots: declarePlots(s, pl, best.action) };
    if (tryAction(s, pl, withPlots)) return withPlots;
    if (tryAction(s, pl, best.action)) return best.action;
  }
  // 3. Resources: bring one into play with the Illuminati's action, and link where a card wants it.
  if (s.cards[me.illuminati].tokens > 0 && !s.turnFlags.resourcePlayed) {
    const r = me.hand.find((h) => def(s, h).type === 'Resource' && canEnterPlay(s, h, pl));
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
  if ((P.drawGroups || S.collector) && s.cards[me.illuminati].tokens > 0 && !s.turnFlags.illumGroupDraw && me.groupDeck.length
      && me.hand.filter((h) => def(s, h).type === 'Group').length <= (S.collector ? 3 : 1)) {
    const a: Action = { type: 'drawGroup' };
    if (tryAction(s, pl, a)) return a;
  }
  // 4. Buy a Plot with a spare Illuminati token.
  if (s.cards[me.illuminati].tokens > 0 && plotsInHand(s, pl).length < S.plotHand && me.plotDeck.length) {
    const a: Action = { type: 'buyPlot', payWith: [me.illuminati] };
    if (tryAction(s, pl, a)) return a;
  }
  return { type: 'endTurn' };
}

function genericMainMoves(s: GameState, pl: string): Action | undefined {
  const cands: Action[] = [];
  for (const c of plotsInHand(s, pl)) {
    const h = PLOTS[s.cards[c].cardId];
    if (!h || !(h.timing.includes('anytime') || h.timing.includes('nwo'))) continue;
    cands.push(...spread(plotOptions(s, pl, c).map((o) => o.action), 8));
  }
  for (const card of [...structureCards(s, pl), ...resourcesOf(s, pl)]) {
    const abs = HOOKS[s.cards[card].cardId]?.actions ?? [];
    const ok = new Set(abs.filter((ab) => ab.ai !== 'never' && (ab.usesToken || ab.oncePerTurn)).map((ab) => ab.id));
    if (ok.size) cands.push(...spread(abilityOptions(s, pl, card).map((o) => o.action).filter((a) => a.type === 'useAbility' && ok.has(a.ability)), 8));
  }
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
    // Anything else that turns the result around.
    for (const o of spread(responseOptions(s, pl).map((x) => x.action).filter((a) => a.type === 'playPlot' || a.type === 'useAbility'), 30)) {
      let after: GameState;
      try { after = applyAction(s, pl, o); } catch { continue; }
      if (after.attack ? currentOutcome(after, after.attack) !== outcome : wantFail) return o;
    }
  }
  return { type: 'pass' };
}

export function chooseAction(s: GameState, pl: string): Action {
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
  // A computer never lets a win go by: it declares as soon as it may (even the wild cards).
  const claim = declareMove(s, pl);
  if (claim) return claim;
  if (player(s, pl).aiStyle === 'chaos') return chaosMove(s, pl);
  return decide(s, pl);
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
  if (!me.plotDeck.length || s.turnFlags.noPlotDraws?.includes(pl)) return undefined;
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

function decide(s: GameState, pl: string): Action {
  if (s.prompt?.player === pl) {
    if (s.prompt.kind === 'chooseLead') return { type: 'chooseLead', card: bestLead(s, pl) };
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
      const goals = goalsInHand(s, pl);
      const drop = goals.slice(goalLimit(s, pl));
      const outside = s.prompt.data?.resume === 'endTurn' || s.players[s.active].id !== pl;
      const plots = plotsInHand(s, pl).filter((c) => !drop.includes(c));
      const excess = outside ? plots.length - handLimit(s, pl) : 0;
      const byValue = [...plots].sort((a, b) => (PLOTS[s.cards[a].cardId] ? 1 : 0) - (PLOTS[s.cards[b].cardId] ? 1 : 0));
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
  if (!P.tricks) return { type: 'pass' };
  const opts = responseOptions(s, pl).map((o) => o.action);
  if (!opts.length) return { type: 'pass' };
  let baseline: number;
  try { baseline = evaluate(rollout(applyAction(s, pl, { type: 'pass' }), pl), pl); } catch { return { type: 'pass' }; }
  return bestBySimulation(s, pl, spread(opts, 24), baseline, 1.5, 24) ?? { type: 'pass' };
}

/** Let every computer player act until a human is needed (or the game ends). */
export function runComputerPlayers(state: GameState, maxSteps = 500): GameState {
  let s = state;
  for (let i = 0; i < maxSteps; i++) {
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
