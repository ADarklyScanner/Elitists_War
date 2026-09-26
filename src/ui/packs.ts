// The expansion packs as players meet them: the switches on the new-game page (remembered per browser),
// the settings they turn into, and plain-words readings of the packs' lasting effects on the table
// (Zaps, Paralysis, Freezes, killed Personalities, Slack). No DOM here, so it can be tested directly.
import {
  type CardDef, type ExpansionId, type GameSettings, type GameState, type PlotPlay,
  abilitiesOf, cardName, checkPlot, costPlays, def, describeOption, frozen, isKilled, isParalyzed, paralysesOn, player,
  packSelectable, PLOTS, zapsOn,
} from '../engine';

/** What the new-game page remembers: each pack's switch, and how SubGenius is played. */
export interface PackChoice {
  assassins?: boolean;
  subgenius?: boolean;
  /** 'mixed': SubGenius cards shuffled into a regular game; 'standalone': the stand-alone SubGenius game. */
  sgMode?: 'mixed' | 'standalone';
}

export const PACK_KEY = 'elitists-war.packs';
/** Set to '1' to see the pack switches before a pack is marked ready (for trying them out). */
export const PREVIEW_KEY = 'elitists-war.preview-packs';

/** Minimal storage, so tests can pass a plain object. */
export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function loadPackChoice(store?: Store): PackChoice {
  try {
    const v = JSON.parse(store?.getItem(PACK_KEY) ?? 'null');
    if (v && typeof v === 'object') return { assassins: !!v.assassins, subgenius: !!v.subgenius, sgMode: v.sgMode === 'standalone' ? 'standalone' : 'mixed' };
  } catch { /* storage unavailable or damaged: defaults */ }
  return { assassins: false, subgenius: false, sgMode: 'mixed' };
}
export function savePackChoice(c: PackChoice, store?: Store) {
  try { store?.setItem(PACK_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
}
export function previewPacks(store?: Store): boolean {
  try { return store?.getItem(PREVIEW_KEY) === '1'; } catch { return false; }
}

/** May this browser offer the pack: ready for everyone, or shown for a preview. */
export const packOffered = (id: ExpansionId, preview: boolean) => packSelectable(id) || preview;

export const PACK_INFO: Record<ExpansionId, { name: string; blurb: string }> = {
  assassins: { name: 'Assassins', blurb: 'Zaps that hobble a whole Power Structure, Paralyzed Groups, Attribute Freezes, new Disasters and Assassinations, and the Society of Assassins.' },
  subgenius: { name: 'SubGenius', blurb: 'The Church of the SubGenius and its Slack, SubGenius Groups, and Plots that name the action that powers them.' },
};

/** The game settings for a choice: only packs that are offered count; the stand-alone game leaves Assassins out. */
export function settingsForChoice(c: PackChoice, offered: (id: ExpansionId) => boolean): Partial<GameSettings> {
  const sg = !!c.subgenius && offered('subgenius');
  const standalone = sg && c.sgMode === 'standalone';
  const assassins = !!c.assassins && offered('assassins') && !standalone;
  if (!assassins && !sg) return {};
  return { expansions: { assassins, subgenius: sg }, ...(standalone ? { subgeniusRules: true } : {}) };
}

/** The packs a game uses, by name ('' for the base game alone). */
export function packsInGame(s: GameState): string {
  if (s.settings.subgeniusRules) return 'the stand-alone SubGenius game';
  const on = (['assassins', 'subgenius'] as ExpansionId[]).filter((id) => s.settings.expansions?.[id]).map((id) => PACK_INFO[id].name);
  return on.join(' and ');
}

// ------------------------------------------------------------------ what lies on the table

/** Does this card keep Slack (the Church of the SubGenius's tokens, kept from turn to turn)? */
export const keepsSlack = (s: GameState, iid: string) => !!s.cards[iid] && abilitiesOf(s, iid).some((a) => a.kind === 'slack');

/** Freezes in effect this turn, in words. */
export function liveFreezes(s: GameState): { card: string; label: string; by: string; exempt: string[] }[] {
  return (s.freezes ?? []).filter((f) => f.turn === s.turn && s.cards[f.card]).map((f) => ({ card: f.card, label: f.label, by: f.player, exempt: f.exempt ?? [] }));
}

/** One card's lasting conditions, for its badges: Paralyzed (and by what), Frozen, killed, held tokens. */
export function cardConditions(s: GameState, iid: string): { paralyzed: string[]; frozen: boolean; killed: boolean; held: number } {
  const c = s.cards[iid];
  if (!c) return { paralyzed: [], frozen: false, killed: false, held: 0 };
  return {
    paralyzed: isParalyzed(s, iid) ? paralysesOn(s, iid) : [],
    frozen: frozen(s, iid),
    killed: isKilled(s, iid),
    held: c.heldTokens ?? 0,
  };
}

/** Everything the packs have put on a player: Zaps on their Illuminati, their Paralyzed Groups. */
export function playerConditions(s: GameState, pl: string): { zaps: string[]; paralyzed: string[] } {
  const p = player(s, pl);
  const mine = Object.values(s.cards).filter((c) => c.zone === 'structure' && c.controller === p.id).map((c) => c.iid);
  return { zaps: zapsOn(s, pl), paralyzed: mine.filter((g) => isParalyzed(s, g)) };
}

/** A short line naming a Zap and what it forbids (its card text). */
export function zapLine(s: GameState, zap: string): string {
  const d = def(s, zap);
  const what = (d.text ?? '').replace(/^Zap[!.]?\s*/i, '').replace(/^Played on a rival(?:'s)? Illuminati[:,]?\s*/i, '').split(/(?<=\.)\s/)[0];
  return `${cardName(s, zap)}: ${what.charAt(0).toUpperCase()}${what.slice(1)}`;
}

// ------------------------------------------------------------------ "Requires ... Action"

/** A Plot whose handler declares its cost ("Requires ... Action"). */
export const declaresCost = (cardId: string) => !!PLOTS[cardId]?.requires;

/**
 * Every affordable way to pay a play of a Plot with a declared cost: one play per alternative the
 * player can afford (the engine picks the Groups or cards within an alternative). Each comes with the
 * alternative in words, so the player sees what will be spent.
 */
export function costChoices(s: GameState, pl: string, play: PlotPlay): { play: PlotPlay; cost: string }[] {
  const h = PLOTS[def(s, play.card).id];
  if (!h?.requires) return [];
  const bare: PlotPlay = { ...play, payWith: undefined, discards: undefined };
  const out: { play: PlotPlay; cost: string }[] = [];
  const seen = new Set<string>();
  for (const p of costPlays(s, pl, bare, h.requires)) {
    if (checkPlot(s, pl, p)) continue;
    const key = JSON.stringify([p.payWith, p.discards]);
    if (seen.has(key)) continue;
    seen.add(key);
    const option = h.requires.anyOf.find((o) => (o.kind === 'discards' ? !!p.discards?.length : o.kind === 'illuminati' ? p.payWith?.[0] === player(s, pl).illuminati && p.payWith.length === 1 : o.kind === 'target' ? p.payWith?.[0] === p.target && p.payWith?.length === 1 : !!p.payWith?.length));
    const what = p.discards?.length ? `discard ${p.discards.map((c) => cardName(s, c)).join(', ')}` : `spend ${p.payWith!.map((g) => cardName(s, g)).join(', ')}`;
    out.push({ play: p, cost: `${option ? describeOption(option, s, pl, p) : 'its cost'}: ${what}` });
  }
  return out;
}

// ------------------------------------------------------------------ the card library

/** The printed keywords worth showing on a card tile (Zap!, Freeze, Paralysis, Disaster, Assassination). */
export function tileKeywords(d: CardDef): string[] {
  const k = d.keywords ?? [];
  const out: string[] = [];
  if (k.includes('Zap')) out.push('Zap!');
  for (const w of ['Freeze', 'Paralysis', 'Disaster', 'Assassination']) if (k.includes(w) || (d.subtype === w && !out.includes(w))) out.push(w);
  if (k.includes('Instant') && !out.includes('Instant')) out.push('Instant');
  return [...new Set(out)];
}
