// Enumerates legal moves for the interface and the computer player. Every option returned
// here has already been checked by the rules, so the UI can simply offer them as buttons.
import type { Action, Alignment, GameState, PlotPlay, Side } from './types';
import { applyAction, canAid, canOppose, checkPlot, player, plotsInHand, validateAttack, waitingFor } from './game';
import { cardName, def } from './cards';
import { openArrows, structureCards } from './geometry';
import { alignments, power } from './stats';
import { PLOTS } from './plotTypes';

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

/** All legal ways to play one Plot card right now. */
export function plotOptions(s: GameState, pl: string, card: string, declaring?: Extract<Action, { type: 'attack' }>): MoveOption[] {
  const d = def(s, card);
  const h = PLOTS[d.id];
  if (!h) return [];
  const needs = h.needs ?? {};
  const groupsInPlay = Object.values(s.cards).filter((c) => c.zone === 'structure' && def(s, c.iid).type === 'Group').map((c) => c.iid);
  let targets: (string | undefined)[] = [undefined];
  if (needs.target === 'plot') targets = (s.window?.kind === 'plot' ? s.window.plays ?? [] : s.attack?.plays ?? []).map((p) => p.iid).filter((x) => x !== card);
  else if (needs.target) targets = groupsInPlay;
  const modes: (string | undefined)[] = needs.mode ?? (d.id === 'secrets-man-was-not-meant-to-know' ? ['illuminati', 'deck'] : [undefined]);
  const aligns: (Alignment | undefined)[] = needs.alignment ? ALIGNMENTS : [undefined];
  const helpers: (string | undefined)[] = needs.helper ? [undefined, ...structureCards(s, pl).filter((g) => s.cards[g].tokens > 0)] : [undefined];
  const out: MoveOption[] = [];
  for (const target of targets) {
    const pays: (string[] | undefined)[] = needs.pay === 'tokens' ? payCandidates(s, pl, target) : [undefined];
    for (const mode of modes) for (const alignment of aligns) for (const helper of helpers) {
      let found = false;
      for (const payWith of pays) {
        if (found) break;
        const play: PlotPlay = { card, target, mode, alignment, helper, payWith };
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

export function describePlay(s: GameState, p: PlotPlay): string {
  const parts: string[] = [];
  if (p.target) parts.push(s.cards[p.target] ? (def(s, p.target).type === 'Plot' ? `cancel ${cardName(s, p.target)}` : `on ${cardName(s, p.target)}`) : '');
  if (p.mode === 'power') parts.push('+10 Power');
  if (p.mode === 'resistance') parts.push('+10 defense');
  if (p.mode === 'up') parts.push('roll +2');
  if (p.mode === 'down') parts.push('roll −2');
  if (p.mode === 'illuminati') parts.push('pay: Illuminati tokens');
  if (p.mode === 'deck') parts.push('pay: top 2 Plots of your deck');
  if (p.alignment) parts.push(`${p.alignment} Groups`);
  if (p.helper) parts.push(`with ${cardName(s, p.helper)}`);
  if (p.payWith?.length) parts.push(`paid by ${p.payWith.map((g) => cardName(s, g)).join(', ')}`);
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
  return out;
}

export function hasResponse(s: GameState, pl: string): boolean {
  return responseOptions(s, pl).length > 0;
}
