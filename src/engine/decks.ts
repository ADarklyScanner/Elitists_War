// Deck building for quick games: a 45-card deck (R025) = 1 Illuminati + Groups + Plots,
// drawn only from cards this version can play.
import { ALL_CARDS } from './cards';
import { PLOTS, GOALS } from './plotTypes';
import { HOOKS } from './hooks';
import type { DeckList } from './game';

function rng(seed: number) {
  let t = seed | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const ILLUMINATI = ALL_CARDS.filter((c) => c.type === 'Illuminati');
export const PLAYABLE_PLOTS = ALL_CARDS.filter((c) => c.type === 'Plot' && (PLOTS[c.id] || GOALS[c.id]));
export const PLAYABLE_RESOURCES = ALL_CARDS.filter((c) => c.type === 'Resource' && HOOKS[c.id]);
export const PLAYABLE_GROUPS = ALL_CARDS.filter((c) => c.type === 'Group');

export function randomDeck(seed: number, illuminati?: string, opts: { groups?: number; plots?: number } = {}): DeckList {
  const r = rng(seed);
  const pick = <T>(arr: T[], n: number) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, n);
  };
  const ill = illuminati ?? ILLUMINATI[Math.floor(r() * ILLUMINATI.length)].id;
  const nGroups = opts.groups ?? 26;
  const nPlots = opts.plots ?? 44 - nGroups;
  // Favour Groups with outgoing arrows so Power Structures can grow.
  const withArrows = PLAYABLE_GROUPS.filter((g) => (g.arrowsOut?.length ?? 0) > 0);
  const without = PLAYABLE_GROUPS.filter((g) => (g.arrowsOut?.length ?? 0) === 0);
  // About one card in eight of the Group deck is a Resource.
  const nRes = Math.min(PLAYABLE_RESOURCES.length, Math.round(nGroups / 8));
  const nG = nGroups - nRes;
  const groups = [...pick(withArrows, Math.round(nG * 0.75)), ...pick(without, nG - Math.round(nG * 0.75)), ...pick(PLAYABLE_RESOURCES, nRes)].map((g) => g.id);
  // Plots: at most two copies of a card, no more than two NWOs.
  const plots: string[] = [];
  const nwos = PLAYABLE_PLOTS.filter((p) => p.subtype === 'NWO');
  plots.push(...pick(nwos, 2).map((p) => p.id));
  // One or two Goal cards, the rest ordinary Plots (at most two copies each).
  plots.push(...pick(PLAYABLE_PLOTS.filter((p) => p.subtype === 'Goal'), 2).map((p) => p.id));
  const rest = PLAYABLE_PLOTS.filter((p) => p.subtype !== 'NWO' && p.subtype !== 'Goal');
  while (plots.length < nPlots) {
    const c = rest[Math.floor(r() * rest.length)].id;
    if (plots.filter((x) => x === c).length < 2) plots.push(c);
  }
  return { illuminati: ill, groups, plots };
}
