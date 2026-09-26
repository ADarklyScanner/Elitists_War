// The optional expansion packs (Assassins, SubGenius): which cards belong to which pack, whether a
// pack may be offered to players yet, and the small helpers the rules need to tell a SubGenius game
// (shared decks, uncontrolled area) from a standard one. The rules themselves live in game.ts.
import type { CardDef, CardSet, ExpansionId, GameSettings, GameState } from './types';
import { ALL_CARDS, CARDS, EXPANSION_CARDS, cardSet } from './cards';
import { isImplemented } from './abilities';
import { HOOKS } from './hooks';
import { GOALS, PLOTS } from './plotTypes';

/**
 * A pack becomes selectable only once every one of its cards is implemented. Until then its switch is
 * hidden in the interface (the engine itself will play with whatever settings it is given, which is how
 * the tests force a pack on). Flip a flag only when tests/expansions.test.ts reports 100% for that pack.
 */
export const EXPANSIONS_READY: Record<ExpansionId, boolean> = { assassins: false, subgenius: false };

export const PACKS: { id: ExpansionId; set: Exclude<CardSet, 'Base'>; name: string }[] = [
  { id: 'assassins', set: 'Assassins', name: 'Assassins' },
  { id: 'subgenius', set: 'SubGenius', name: 'SubGenius' },
];

/** The Church of the SubGenius: every player's Illuminati in the stand-alone SubGenius game. */
export const CHURCH = 'church-of-the-subgenius';

/** The sets a game draws its cards from: always the base game, plus each pack switched on. */
export function enabledSets(settings?: Partial<GameSettings>): CardSet[] {
  const out: CardSet[] = [];
  // The stand-alone SubGenius game is played with the SubGenius cards alone.
  if (!settings?.subgeniusRules) out.push('Base');
  if (settings?.expansions?.assassins && !settings?.subgeniusRules) out.push('Assassins');
  if (settings?.expansions?.subgenius || settings?.subgeniusRules) out.push('SubGenius');
  return out;
}

/** Cards of the given sets. */
export const cardsOfSets = (sets: CardSet[]): CardDef[] => ALL_CARDS.filter((c) => sets.includes(cardSet(c)));

/**
 * Is this card's behaviour encoded? Groups and Illuminati: an ability entry with nothing pending;
 * Resources: hooks; Goal cards: a Goal condition; other Plots (NWOs included): a Plot handler.
 * A card agent may also mark a card as still incomplete with markPending().
 */
export function cardImplemented(id: string): boolean {
  const d = CARDS[id];
  if (!d || PENDING[id]) return false;
  if (d.type === 'Group' || d.type === 'Illuminati') return isImplemented(id);
  if (d.type === 'Resource') return !!HOOKS[id];
  if (d.subtype === 'Goal') return !!GOALS[id];
  return !!PLOTS[id];
}

/** Cards whose encoding is known to be incomplete (for Resources and Plots, which have no `pending` ability). */
export const PENDING: Record<string, string> = {};
export function markPending(id: string, note: string) { PENDING[id] = note; }

/** How far a pack's encoding has come. */
export function packProgress(set: Exclude<CardSet, 'Base'>): { total: number; implemented: number; missing: string[] } {
  const cards = EXPANSION_CARDS[set];
  const missing = cards.filter((c) => !cardImplemented(c.id)).map((c) => c.id);
  return { total: cards.length, implemented: cards.length - missing.length, missing };
}

/** May players switch this pack on (every card implemented and the ready flag set)? */
export const packSelectable = (id: ExpansionId) => EXPANSIONS_READY[id];

// ---------------------------------------------------------------- the SubGenius game

/** Is this game played under the stand-alone SubGenius rules (shared decks, uncontrolled area)? */
export const sgRules = (s: GameState) => !!s.settings.subgeniusRules;

/** The Plot deck a player draws from: his own, or the shared one under SubGenius rules. */
export function plotDeckOf(s: GameState, playerId: string): string[] {
  return s.common ? s.common.plotDeck : s.players.find((p) => p.id === playerId)!.plotDeck;
}
/** The Group deck a player draws from: his own, or the shared one under SubGenius rules. */
export function groupDeckOf(s: GameState, playerId: string): string[] {
  return s.common ? s.common.groupDeck : s.players.find((p) => p.id === playerId)!.groupDeck;
}
/** Cards in the uncontrolled area (empty outside a SubGenius game). */
export const uncontrolledCards = (s: GameState): string[] => s.common?.uncontrolled ?? [];
