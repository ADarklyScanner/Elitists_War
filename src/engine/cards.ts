import rawCards from '../data/cards.json';
import assassinsCards from '../data/expansions/assassins.json';
import subgeniusCards from '../data/expansions/subgenius.json';
import type { Alignment, CardDef, CardInstance, CardSet, GameState } from './types';

/** The base game's cards (412). */
export const BASE_CARDS: CardDef[] = rawCards as CardDef[];
/** The expansion packs' cards, by pack (see docs/EXPANSIONS.md). */
export const EXPANSION_CARDS: Record<'Assassins' | 'SubGenius', CardDef[]> = {
  Assassins: assassinsCards as CardDef[],
  SubGenius: subgeniusCards as CardDef[],
};

/** Every card of every set: base cards first, in their original order, then Assassins, then SubGenius. */
export const ALL_CARDS: CardDef[] = [...BASE_CARDS, ...EXPANSION_CARDS.Assassins, ...EXPANSION_CARDS.SubGenius];

export const CARDS: Record<string, CardDef> = Object.fromEntries(ALL_CARDS.map((c) => [c.id, c]));

/** Which box a card comes from (base cards carry no `set`). */
export const cardSet = (d: CardDef | undefined): CardSet => d?.set ?? 'Base';

// Face-down cards in an online player's view of a rival's hand or a deck.
CARDS['hidden-plot'] = { id: 'hidden-plot', name: 'Plot card', type: 'Plot', subtype: 'Hidden', rarity: null, text: 'A face-down Plot card.' };
CARDS['hidden-resource'] = { id: 'hidden-resource', name: 'Resource card', type: 'Resource', subtype: 'Hidden', rarity: null, text: 'A face-down Resource card.' };
CARDS['hidden-group'] = { id: 'hidden-group', name: 'Group card', type: 'Group', subtype: 'Hidden', rarity: null, text: 'A face-down card.' };

export const OPPOSITE: Partial<Record<Alignment, Alignment>> = {
  Government: 'Corporate', Corporate: 'Government',
  Liberal: 'Conservative', Conservative: 'Liberal',
  Peaceful: 'Violent', Violent: 'Peaceful',
  Straight: 'Weird', Weird: 'Straight',
};

export function def(s: GameState, iid: string): CardDef {
  return CARDS[s.cards[iid].cardId];
}

export function inst(s: GameState, iid: string): CardInstance {
  const c = s.cards[iid];
  if (!c) throw new Error(`Unknown card instance ${iid}`);
  return c;
}

export function cardName(s: GameState, iid: string): string {
  return s.cards[iid] ? def(s, iid).name : "(unknown card)";
}

export const isGroupLike = (d: CardDef) => d.type === 'Group' || d.type === 'Illuminati';
