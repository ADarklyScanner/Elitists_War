// Enumerates legal moves for the interface and the computer player. Every option returned
// here has already been checked by the rules, so the UI can simply offer them as buttons.
import type { Action, Alignment, GameState, PlotPlay, Side } from './types';
import { applyAction, canAid, canOppose, checkPlot, player, plotsInHand, validateAttack, waitingFor } from './game';
import { cardName, def } from './cards';
import { openArrows, structureCards } from './geometry';
import { alignments, attributes, power } from './stats';
import { PLOTS } from './plotTypes';
import { HOOKS } from './hooks';
import { announcedAction, announcedActors, checkAbility, disasterTarget, resourcesOf, MARCH_ON_WASHINGTON } from './game';

const ALIGNMENTS: Alignment[] = ['Government', 'Corporate', 'Liberal', 'Conservative', 'Peaceful', 'Violent', 'Straight', 'Weird', 'Criminal', 'Fanatic'];

export interface MoveOption { label: string; action: Action }

export function legal(s: GameState, pl: string, a: Action): boolean {
  try { applyAction(s, pl, a); return true; } catch { return false; }
}

/** Candidate ways of paying token costs: the Illuminati alone, single Groups, and strongest-first sets. */
function payCandidates(s: GameState, pl: string, exclude?: string): string[][] {
  const me = player(s, pl);
  const mine = structureCards(s, pl).filter((g) => s.cards[g].tokens > 0 && g !== exclude);
  const groups = mine.filter((g) => g !== me.illuminati).sort((a, b) => power(s, b) - power(s, a));
  const out: string[][] = [];
  if (mine.includes(me.illuminati)) out.push([me.illuminati]);
  for (const g of groups) out.push([g]);
  const pools: string[][] = [groups];
  for (const al of ALIGNMENTS) pools.push(groups.filter((g) => alignments(s, g).includes(al)));
  for (const pool of pools) for (let k = 2; k <= pool.length; k++) out.push(pool.slice(0, k));
  const seen = new Set<string>();
  return out.filter((p) => { const k = p.join(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Media Groups with a token, yours first then other players' (strongest first), until their Power reaches 6. */
function sharedMediaPayers(s: GameState, pl: string): string[] {
  const media = Object.values(s.cards).filter((c) => c.zone === 'structure' && c.tokens > 0 && def(s, c.iid).type === 'Group' && attributes(s, c.iid).includes('Media'))
    .map((c) => c.iid).sort((a, b) => Number(s.cards[b].controller === pl) - Number(s.cards[a].controller === pl) || power(s, b) - power(s, a));
  const out: string[] = [];
  let n = 0;
  for (const g of media) { if (n >= 6) break; out.push(g); n += power(s, g); }
  return out;
}

/** All legal ways to play one Plot card right now. */
export function plotOptions(s: GameState, pl: string, card: string, declaring?: Extract<Action, { type: 'attack' }>): MoveOption[] {
  const d = def(s, card);
  const h = PLOTS[d.id];
  if (!h) return [];
  const needs = h.needs ?? {};
  let targets: (string | undefined)[] = [undefined];
  if (needs.target === 'plot') targets = (s.window?.kind === 'plot' ? s.window.plays ?? [] : s.attack?.plays ?? []).map((p) => p.iid).filter((x) => x !== card && s.cards[x]);
  else if (needs.target) targets = targetPool(s, pl, needs.target, card);
  const modes: (string | undefined)[] = needs.mode ?? (d.id === 'secrets-man-was-not-meant-to-know' ? ['illuminati', 'deck'] : [undefined]);
  const aligns: (Alignment | undefined)[] = needs.alignment ? ALIGNMENTS : [undefined];
  const helpers: (string | undefined)[] = needs.helper ? [undefined, ...structureCards(s, pl).filter((g) => s.cards[g].tokens > 0)] : [undefined];
  // Reload cards: offer each single Group and the largest sets within 5 Power.
  let targetSets: (string[] | undefined)[] = [undefined];
  if (needs.targetsOf && needs.targetsOf !== 'ownTokenless') {
    const pool = targetPool(s, pl, needs.targetsOf, card);
    targetSets = [...pool.map((c) => [c]), pool.slice(0, 2), pool].filter((x) => x.length);
  } else if (needs.targets) {
    const el = structureCards(s, pl).filter((g) => def(s, g).type === 'Group' && s.cards[g].tokens === 0);
    const asc = [...el].sort((a, b) => power(s, a) - power(s, b));
    const fit = (list: string[]) => { const out: string[] = []; let n = 0; for (const g of list) if (n + power(s, g) <= 5) { out.push(g); n += power(s, g); } return out; };
    targetSets = [...el.map((g) => [g]), fit(asc), fit([...asc].reverse())].filter((x) => x.length);
  }
  const out: MoveOption[] = [];
  for (const targetList of targetSets) for (const target of targets) {
    const pays: (string[] | undefined)[] = needs.pay === 'tokens' ? payCandidates(s, pl, target) : [undefined];
    // Sweeping Reforms may also be paid with other players' Media Groups (they are asked to agree).
    if (d.id === 'sweeping-reforms') pays.push(sharedMediaPayers(s, pl));
    for (const mode of modes) for (const alignment of aligns) for (const helper of helpers) {
      let found = false;
      // Without a legal way to pay, March on Washington may stand in for one of the actions.
      const march = needs.pay === 'tokens' ? marchCard(s, pl, card) : undefined;
      const tries: { payWith?: string[]; march?: string }[] = [...pays.map((payWith) => ({ payWith })), ...(march ? [[], ...pays].map((payWith) => ({ payWith, march })) : [])];
      for (const { payWith, march: m } of tries) {
        if (found) break;
        const play: PlotPlay = { card, target, mode, alignment, helper, payWith, targets: targetList, ...(m ? { march: m } : {}) };
        if (declaring) {
          const probe = structuredClone(s);
          probe.attack = { id: -1, type: declaring.attackType, instant: false, attacker: declaring.attacker, attackerPlayer: pl, target: declaring.target, targetPlayer: probe.cards[declaring.target].controller, fromHand: probe.cards[declaring.target].zone === 'hand', privileged: false, aid: [], oppose: [], attackBonus: [], defenseBonus: [], plays: [] };
          if (checkPlot(probe, pl, play, true)) continue;
          out.push({ label: describePlay(s, play), action: { type: 'playPlot', play } });
          found = true;
        } else if (!checkPlot(s, pl, play)) {
          out.push({ label: describePlay(s, play), action: { type: 'playPlot', play } });
          found = true;
        }
      }
    }
  }
  return out;
}

/** A March on Washington in hand that could stand in for an action of another Plot. */
function marchCard(s: GameState, pl: string, card: string): string | undefined {
  const me = player(s, pl);
  if (s.cards[card].cardId === MARCH_ON_WASHINGTON || s.cards[me.illuminati].data?.marchTurn === s.turn || !me.plotDeck.length) return undefined;
  return me.hand.find((c) => c !== card && s.cards[c].cardId === MARCH_ON_WASHINGTON);
}

/** Candidate targets of a given kind for a Plot or ability. */
export function targetPool(s: GameState, pl: string, kind: string, exclude?: string): string[] {
  const cards = Object.values(s.cards);
  const me = player(s, pl);
  const rivals = s.players.filter((p) => p.id !== pl && !p.eliminated);
  let out: string[];
  switch (kind) {
    case 'resource': out = cards.filter((c) => c.zone === 'resources').map((c) => c.iid); break;
    // Disasters may also strike a Resource that defends as a Place (Hidden City).
    case 'place': out = cards.filter((c) => (c.zone === 'structure' && def(s, c.iid).type === 'Group') || (c.zone === 'resources' && disasterTarget(s, c.iid))).map((c) => c.iid); break;
    case 'handCard': out = [...me.hand]; break;
    case 'handGroup': out = me.hand.filter((i) => def(s, i).type === 'Group'); break;
    case 'handPlot': out = me.hand.filter((i) => def(s, i).type === 'Plot'); break;
    case 'destroyed': out = cards.filter((c) => c.zone === 'destroyed').map((c) => c.iid); break;
    case 'discardPile': out = s.players.flatMap((p) => p.discard); break;
    case 'nwo': out = Object.values(s.nwo).filter((x): x is string => !!x); break;
    case 'rival': out = rivals.map((p) => p.illuminati); break;
    case 'rivalHand': out = rivals.flatMap((p) => p.hand); break;
    default: out = cards.filter((c) => c.zone === 'structure' && def(s, c.iid).type === 'Group').map((c) => c.iid);
  }
  return out.filter((x) => x !== exclude);
}

export function describePlay(s: GameState, p: PlotPlay): string {
  const parts: string[] = [];
  if (p.target && s.cards[p.target]) {
    const c = s.cards[p.target];
    const d = def(s, p.target);
    parts.push(d.type === 'Illuminati' ? `against ${player(s, c.controller ?? c.owner).name}`
      : c.zone === 'hand' ? `${d.name} (in hand)` : c.zone === 'destroyed' ? `${d.name} (destroyed)` : c.zone === 'discard' ? `${d.name} (discarded)`
      : d.type === 'Plot' && c.zone === 'table' && !c.linkedTo ? `cancel ${d.name}` : `on ${d.name}`);
  }
  if (p.mode === 'power') parts.push('+10 Power');
  if (p.mode === 'resistance') parts.push('+10 defense');
  if (p.mode === 'up') parts.push('roll +2');
  if (p.mode === 'down') parts.push('roll −2');
  if (p.mode === 'illuminati') parts.push('pay: Illuminati tokens');
  if (p.mode === 'deck') parts.push('pay: top 2 Plots of your deck');
  if (p.mode === 'groupDeck') parts.push('pay: top card of your Group deck');
  if (p.mode === 'hand') parts.push('pay: two Group cards from your hand');
  if (p.alignment) parts.push(`${p.alignment} Groups`);
  if (p.helper) parts.push(`with ${cardName(s, p.helper)}`);
  if (p.targets?.length) parts.push(`tokens for ${p.targets.map((g) => cardName(s, g)).join(', ')}`);
  if (p.payWith?.length) parts.push(`paid by ${p.payWith.map((g) => cardName(s, g)).join(', ')}`);
  if (p.march) parts.push('March on Washington stands in for one action');
  return parts.filter(Boolean).join(' · ') || 'Play';
}

/** Legal attacks for one of your Groups: each target with its attack type and arrow choices. */
export function attackOptions(s: GameState, pl: string, attacker: string): { target: string; type: 'control' | 'destroy'; sides: Side[] }[] {
  const out: { target: string; type: 'control' | 'destroy'; sides: Side[] }[] = [];
  const candidates = [
    ...Object.values(s.cards).filter((c) => c.zone === 'structure' && def(s, c.iid).type === 'Group').map((c) => c.iid),
    ...player(s, pl).hand.filter((h) => def(s, h).type === 'Group'),
  ];
  for (const target of candidates) {
    for (const type of ['control', 'destroy'] as const) {
      if (validateAttack(s, pl, { type: 'attack', attackType: type, attacker, target })) continue;
      out.push({ target, type, sides: type === 'control' ? openArrows(s, attacker) : [] });
    }
  }
  return out;
}

/** Everything the player may do in the current response window (besides passing). */
export function responseOptions(s: GameState, pl: string): MoveOption[] {
  if (!s.window || !waitingFor(s).includes(pl)) return [];
  const out: MoveOption[] = [];
  if (s.window.kind === 'attack' && s.attack) {
    for (const g of structureCards(s, pl)) {
      const a = canAid(s, pl, g);
      if (a.ok) out.push({ label: `${cardName(s, g)} aids (+${a.global ? `${def(s, g).globalPower ?? 0} Global` : power(s, g)})`, action: { type: 'aid', group: g } });
      const o = canOppose(s, pl, g);
      if (o.ok) out.push({ label: `${cardName(s, g)} opposes${o.self ? ' (itself, ×2)' : o.global ? ' (Global)' : ''}`, action: { type: 'oppose', group: g } });
    }
  }
  for (const c of plotsInHand(s, pl)) for (const o of plotOptions(s, pl, c)) out.push({ label: `${cardName(s, c)}: ${o.label}`, action: o.action });
  // Agents: a duplicate of the attacked Group in your hand (R031).
  const ctx = s.attack;
  if (s.window.kind === 'attack' && ctx && !ctx.instant) {
    for (const h of player(s, pl).hand) {
      if (h === ctx.target || s.cards[h].cardId !== s.cards[ctx.target].cardId) continue;
      for (const as of ['aid', 'oppose'] as const) {
        const a: Action = { type: 'agent', card: h, as };
        if (legal(s, pl, a)) out.push({ label: `Agents in ${cardName(s, h)}: ${as === 'aid' ? '+10 to the attack' : '−6 to the attack'}`, action: a });
      }
    }
  }
  for (const card of [...structureCards(s, pl), ...resourcesOf(s, pl)]) out.push(...abilityOptions(s, pl, card));
  return out;
}

/** Legal uses of a card's activated abilities right now. */
export function abilityOptions(s: GameState, pl: string, card: string): MoveOption[] {
  const out: MoveOption[] = [];
  const inPlay = Object.values(s.cards).filter((c) => c.zone === 'structure' || c.zone === 'resources').map((c) => c.iid);
  const plays = (s.window?.kind === 'plot' ? s.window.plays ?? [] : s.attack?.plays ?? []).map((p) => p.iid).filter((i) => s.cards[i]);
  for (const ab of HOOKS[s.cards[card].cardId]?.actions ?? []) {
    const n = ab.needs ?? {};
    let targets: (string | undefined)[] = [undefined];
    if (n.target === 'plot') targets = plays;
    else if (n.target === 'actingGroup') {
      const announced = announcedAction(s);
      targets = s.attack ? [s.attack.attacker, ...s.attack.aid.map((a) => a.iid), ...s.attack.oppose.map((o) => o.iid)].filter((x): x is string => !!x)
        : announced ? announcedActors(announced) : [];
    }
    else if (n.target === 'resource') targets = inPlay.filter((i) => s.cards[i].zone === 'resources');
    else if (n.target && ['handCard', 'handGroup', 'handPlot', 'destroyed', 'discardPile', 'rival', 'rivalHand', 'nwo'].includes(n.target)) targets = targetPool(s, pl, n.target, card);
    else if (n.target) targets = inPlay.filter((i) => s.cards[i].zone === 'structure');
    const modes = n.modes ?? [undefined];
    const aligns = n.alignment ? ALIGNMENTS : [undefined];
    for (const target of targets) for (const mode of modes) for (const alignment of aligns) {
      // Helper Groups (e.g. Relief): try none, then add your other Groups with a token, strongest
      // first, one at a time, until the ability's own check accepts the total. The target itself,
      // your Illuminati and this card are never offered as helpers.
      let payWith: string[] | undefined;
      if (n.helpers) {
        const helperPool = structureCards(s, pl)
          .filter((g) => g !== card && g !== target && g !== player(s, pl).illuminati && s.cards[g].tokens > 0)
          .sort((a, b) => power(s, b) - power(s, a));
        const tried: string[] = [];
        if (!checkAbility(s, pl, card, ab.id, { target, mode, alignment, payWith: [] })) payWith = [];
        else for (const g of helperPool) {
          tried.push(g);
          if (!checkAbility(s, pl, card, ab.id, { target, mode, alignment, payWith: tried })) { payWith = [...tried]; break; }
        }
        if (payWith === undefined) continue;
      }
      const params = { target, mode, alignment, ...(n.helpers ? { payWith } : {}) };
      if (checkAbility(s, pl, card, ab.id, params)) continue;
      const bits = [ab.label, target ? `on ${cardName(s, target)}` : '', mode ?? '', alignment ?? '', payWith?.length ? `with ${payWith.map((g) => cardName(s, g)).join(', ')}` : ''].filter(Boolean);
      out.push({ label: `${cardName(s, card)}: ${bits.join(' · ')}`, action: { type: 'useAbility', card, ability: ab.id, params } });
    }
  }
  return out;
}

export function hasResponse(s: GameState, pl: string): boolean {
  return responseOptions(s, pl).length > 0;
}
