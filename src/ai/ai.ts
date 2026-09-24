// Computer opponent. It plays through exactly the same actions as a person, so it can never
// break the rules: every candidate move is checked by the engine before it is chosen.
import {
  type Action, type AttackCtx, type GameState, type PlotPlay, type Side,
  applyAction, attackStrength, canAid, canOppose, checkPlot, currentOutcome, def, openArrows, player,
  plotsInHand, handLimit, power, resistance, structureCards, takeoverOptions, validateAttack, waitingFor,
  alignments, abilitiesOf, PLOTS, subtree, goalCount, goalNeeded, depth, bestLead, plotOptions,
  HOOKS, CHOICES, checkAbility, resourcesOf, canEnterPlay, goalsInHand, goalLimit, type AbilityParams,
} from '../engine';
import { abilityOptions, responseOptions } from '../engine/moves';
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

/** Knobs for the computer player's appetite for risk. */
export const AI_TUNING = { minChance: 0.4, actionCost: 2 };

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
  return v;
}

function hypotheticalCtx(s: GameState, pl: string, attacker: string, target: string, type: 'control' | 'destroy'): AttackCtx {
  const fromHand = s.cards[target].zone === 'hand';
  return {
    id: -1, type, instant: false, attacker, attackerPlayer: pl, target, targetPlayer: fromHand ? undefined : s.cards[target].controller,
    fromHand, privileged: false, aid: [], oppose: [], attackBonus: [], defenseBonus: [], plays: [],
  };
}

interface AttackPlan { action: Extract<Action, { type: 'attack' }>; score: number; chance: number }

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
  const leader = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const threat = (owner?: string) => (!owner ? 1 : (owner === leader ? 1.3 : 1) * (goalCount(s, owner) >= goalNeeded(s, owner) - 1 ? 1.6 : 1));
  for (const att of mine) {
    for (const t of targets) {
      const side: Side | undefined = t.type === 'control' ? openArrows(s, att)[0] : undefined;
      const action: Extract<Action, { type: 'attack' }> = { type: 'attack', attackType: t.type, attacker: att, target: t.iid, side };
      if (validateAttack(s, pl, action)) continue;
      const ctx = hypotheticalCtx(s, pl, att, t.iid, t.type);
      // Count likely aid from our other Groups.
      let strength = attackStrength(s, ctx).strength - expectedOpposition(s, ctx);
      const spare = mine.filter((g) => g !== att).map((g) => power(s, g)).sort((a, b) => b - a);
      strength += (spare[0] ?? 0) * 0.5;
      const chance = successChance(Math.floor(strength));
      let value = groupValue(s, t.iid);
      if (t.type === 'destroy') value = value * 0.7 + (behind ? 6 : 0);
      else value += s.cards[t.iid].zone === 'hand' ? 3 : 4;
      value *= threat(s.cards[t.iid].controller);
      // Taking a Group that completes our own Goal is worth a great deal.
      if (t.type === 'control' && goalCount(s, pl) + 1 >= goalNeeded(s, pl)) value += 25;
      const score = chance * value - (s.cards[att].cardId === def(s, me.illuminati).id ? 1 : 0);
      plans.push({ action, score, chance });
    }
  }
  return plans.sort((a, b) => b.score - a.score);
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
  // 1b. Any other Plot or ability whose result looks better than doing nothing.
  const generic = genericMainMoves(s, pl);
  if (generic) return generic;
  // 2. Best attack: the most promising few are played out both ways and weighed by their odds.
  const plans = planAttacks(s, pl).filter((p) => p.chance >= AI_TUNING.minChance).slice(0, 8);
  const now = evaluate(s, pl);
  let best: AttackPlan | undefined;
  let bestGain = 0.5;
  for (const p of plans) {
    let after: GameState;
    try { after = applyAction(s, pl, p.action); } catch { continue; }
    const gain = p.chance * attackOutcomeScore(after, pl, true) + (1 - p.chance) * attackOutcomeScore(after, pl, false) - now - AI_TUNING.actionCost;
    if (gain > bestGain) { bestGain = gain; best = p; }
  }
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
  // 4. Buy a Plot with a spare Illuminati token.
  if (s.cards[me.illuminati].tokens > 0 && plotsInHand(s, pl).length < 4 && me.plotDeck.length) {
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
  return bestBySimulation(s, pl, cands, evaluate(s, pl), 1.5, 40);
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
    if (chance < 0.72) {
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
  if (ctx.targetPlayer === pl && chance > 0.25) {
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
      if (d.g === player(s, pl).illuminati && worth < 8 && !d.r.self) continue; // keep the Illuminati token unless it matters
      const a: Action = { type: 'oppose', group: d.g };
      if (tryAction(s, pl, a)) return a;
    }
    // Cancel an attack plot with a counter if we hold one.
    for (const c of plotsInHand(s, pl)) {
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
  if (s.prompt?.player === pl) {
    if (s.prompt.kind === 'chooseLead') return { type: 'chooseLead', card: bestLead(s, pl) };
    if (s.prompt.kind === 'choose' && s.prompt.choice) {
      const ch = s.prompt.choice;
      const pick = CHOICES[ch.key]?.ai?.(s, pl, ch.options, { ...ch.data, source: ch.source }) ?? ch.options.slice(0, ch.min).map((o) => o.id);
      return { type: 'choose', ids: pick };
    }
    if (s.prompt.kind === 'takeover') {
      const opts = takeoverOptions(s, pl);
      opts.sort((a, b) => groupValue(s, b.card) - groupValue(s, a.card) || depth(s, a.onto) - depth(s, b.onto));
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
  if (w?.kind === 'attack' && s.attack) return respondToAttack(s, pl);
  if (w?.kind === 'roll' && s.attack) return respondToRoll(s, pl);
  if (w && (w.kind === 'plot' || w.kind === 'event' || w.kind === 'endOfTurn')) return windowMove(s, pl);
  if (w) return { type: 'pass' };
  if (s.phase === 'main' && s.players[s.active].id === pl) return mainPhase(s, pl);
  return { type: 'pass' };
}

/** Counter a harmful Plot, or answer an event, when the look-ahead says it pays. */
function windowMove(s: GameState, pl: string): Action {
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
