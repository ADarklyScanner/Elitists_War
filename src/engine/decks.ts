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

/**
 * What each Illuminati's deck is built around: an alignment and/or attribute its abilities and
 * Special Goal reward. Decks lean on the theme (so Groups can aid each other and the Goal is
 * reachable) while keeping some variety.
 */
const THEMES: Record<string, { align?: string[]; attr?: string[]; power?: boolean; destroy?: boolean; spread?: boolean; goals?: number }> = {
  'adepts-of-hermes': { attr: ['Magic'] },
  'bavarian-illuminati': { power: true },
  'bermuda-triangle': { spread: true, power: true },
  'discordian-society': { align: ['Weird'] },
  'gnomes-of-zurich': { align: ['Corporate'], attr: ['Bank'] },
  'the-network': { attr: ['Computer', 'Science'] },
  'servants-of-cthulhu': { align: ['Violent'], destroy: true },
  'shangri-la': { align: ['Peaceful'] },
  'ufos': { goals: 3 },
};
const ALIGNS = ['Government', 'Corporate', 'Liberal', 'Conservative', 'Peaceful', 'Violent', 'Straight', 'Weird', 'Criminal', 'Fanatic'];
const OPP: Record<string, string> = { Government: 'Corporate', Corporate: 'Government', Liberal: 'Conservative', Conservative: 'Liberal', Peaceful: 'Violent', Violent: 'Peaceful', Straight: 'Weird', Weird: 'Straight' };
const WORDS = [...ALIGNS, 'Media', 'Magic', 'Science', 'Computer', 'Bank', 'Church', 'Space', 'Green', 'Communist', 'Secret', 'Nation', 'Coastal'];

/** Alignments and attributes a card's play requirement or cost asks for. */
function needsOf(c: { playRequirement?: string | null; cost?: string | null }): string[] {
  const t = `${c.playRequirement ?? ''} ${c.cost ?? ''}`;
  return WORDS.filter((w) => new RegExp(`\\b${w}`, 'i').test(t));
}

/** Kind of Plot, from how the engine lets it be played. */
function plotKind(id: string): 'goal' | 'nwo' | 'boost' | 'defense' | 'instant' | 'counter' | 'roll' | 'other' {
  const d = ALL_CARDS.find((c) => c.id === id)!;
  if (d.subtype === 'Goal') return 'goal';
  if (d.subtype === 'NWO') return 'nwo';
  const t = PLOTS[id]?.timing ?? [];
  if (t.includes('instant')) return 'instant';
  if (t.includes('declare')) return 'boost';
  if (t.includes('roll')) return 'roll';
  if (t.includes('counter')) return 'counter';
  if (t.includes('attack')) return PLOTS[id]?.needs?.mode ? 'boost' : 'defense';
  return 'other';
}

export function randomDeck(seed: number, illuminati?: string, opts: { groups?: number; plots?: number } = {}): DeckList {
  const r = rng(seed);
  const shuffle = <T>(arr: T[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const ill = illuminati ?? ILLUMINATI[Math.floor(r() * ILLUMINATI.length)].id;
  const theme = THEMES[ill] ?? {};
  // The rulebook's deck-building guidance (p.2) calls a 45-card deck (including the Illuminati)
  // typical with 12-20 Group cards and 24-32 Plot cards, so Groups+Plots is always 44. Pick a
  // Group count in that range per deck instead of always building the same ratio.
  const nGroups = opts.groups ?? 12 + Math.floor(r() * 9);
  const nPlots = opts.plots ?? 44 - nGroups;
  const nRes = Math.min(PLAYABLE_RESOURCES.length, Math.round(nGroups / 6));
  const nG = nGroups - nRes;

  // A theme alignment (from the Illuminati, or picked) and a second one that does not clash with it.
  // An attribute theme (Magic, Computer) takes the alignment most common among its Groups, so they can aid each other.
  const attrGroups = PLAYABLE_GROUPS.filter((g) => (theme.attr ?? []).some((a) => (g.attributes ?? []).includes(a)));
  const commonAlign = theme.attr && !theme.align
    ? ALIGNS.map((a) => [a, attrGroups.filter((g) => (g.alignments ?? []).includes(a)).length] as const).sort((a, b) => b[1] - a[1])[0][0]
    : undefined;
  const primary = theme.align?.[0] ?? commonAlign ?? (theme.spread ? undefined : ALIGNS[Math.floor(r() * ALIGNS.length)]);
  const partners = ALIGNS.filter((a) => a !== primary && a !== (primary && OPP[primary]));
  const secondary = theme.spread ? undefined : partners[Math.floor(r() * partners.length)];
  const onTheme = (g: (typeof PLAYABLE_GROUPS)[number]) =>
    (!!primary && (g.alignments ?? []).includes(primary)) || (theme.attr ?? []).some((a) => (g.attributes ?? []).includes(a));
  const score = (g: (typeof PLAYABLE_GROUPS)[number]) => {
    const al = g.alignments ?? [];
    let v = r() * 3;                                   // variety
    if (onTheme(g)) v += 3;
    if ((theme.attr ?? []).some((a) => (g.attributes ?? []).includes(a))) v += 2; // the Illuminati's own attribute first
    if (secondary && al.includes(secondary)) v += 1.5;
    if (primary && OPP[primary] && al.includes(OPP[primary])) v -= 2.5; // clashes with the theme
    v += Math.max(0, (g.arrowsOut?.length ?? 0) - 1) * 0.8; // room to grow
    v += (g.power ?? 0) / (theme.power ? 2.5 : 4);
    if (theme.destroy && al.includes('Violent')) v += 1;
    return v;
  };
  const ranked = PLAYABLE_GROUPS.map((g) => ({ g, v: score(g) })).sort((a, b) => b.v - a.v).map((x) => x.g);
  const chosen: typeof ranked = [];
  const take = (g: (typeof ranked)[number]) => { if (!chosen.includes(g) && chosen.length < nG) chosen.push(g); };
  // Guarantees first: growth, attackers, and (Bermuda Triangle) one Group of every alignment.
  if (theme.spread) for (const a of ALIGNS) { const g = ranked.find((x) => (x.alignments ?? []).includes(a) && !chosen.includes(x)); if (g) take(g); }
  for (const g of ranked.filter((x) => (x.arrowsOut?.length ?? 0) >= 2).slice(0, 8)) take(g);
  for (const g of ranked.filter((x) => (x.power ?? 0) >= 5).slice(0, 4)) take(g);
  // Then the best of the rest, but keep at least a third of the deck off-theme for variety.
  const themeCap = Math.round(nG * 0.65);
  for (const g of ranked) {
    if (chosen.length >= nG) break;
    if (onTheme(g) && chosen.filter(onTheme).length >= themeCap) continue;
    take(g);
  }
  for (const g of ranked) take(g);
  const words = new Set(chosen.flatMap((g) => [...(g.alignments ?? []), ...(g.attributes ?? [])]));
  const usable = (c: { playRequirement?: string | null; cost?: string | null }) => { const n = needsOf(c); return !n.length || n.some((w) => words.has(w)); };
  const resources = shuffle(PLAYABLE_RESOURCES.filter(usable))
    .sort((a, b) => Number((theme.attr ?? []).some((t) => (b.text ?? '').includes(t))) - Number((theme.attr ?? []).some((t) => (a.text ?? '').includes(t))))
    .slice(0, nRes);

  // Plots: a balanced hand of tricks the deck can actually use.
  const pool = shuffle(PLAYABLE_PLOTS.filter((p) => usable(p)));
  const byKind = (k: ReturnType<typeof plotKind>) => pool.filter((p) => plotKind(p.id) === k);
  const plots: string[] = [];
  const add = (list: typeof pool, n: number) => { for (const p of list) { if (n <= 0 || plots.length >= nPlots) break; if (!plots.includes(p.id)) { plots.push(p.id); n--; } } };
  const themeWords = [primary, ...(theme.attr ?? [])].filter(Boolean) as string[];
  const goals = byKind('goal').sort((a, b) =>
    Number(themeWords.some((w) => (b.text ?? '').includes(w))) - Number(themeWords.some((w) => (a.text ?? '').includes(w))));
  add(goals, theme.goals ?? 1);
  add(byKind('nwo'), 2);
  add(byKind('boost'), 4);
  add(byKind('instant'), theme.destroy ? 4 : 2);
  add(byKind('defense'), 2);
  add(byKind('counter'), 2);
  add(byKind('roll'), 1);
  add(byKind('other'), nPlots);
  add(pool.filter((p) => !['goal', 'nwo'].includes(plotKind(p.id))), nPlots);
  return { illuminati: ill, groups: [...chosen, ...resources].map((g) => g.id), plots };
}
