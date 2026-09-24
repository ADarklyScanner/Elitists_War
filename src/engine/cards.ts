import rawCards from '../data/cards.json';
import type { Alignment, CardDef, CardInstance, GameState } from './types';

export const CARDS: Record<string, CardDef> = Object.fromEntries(
  (rawCards as CardDef[]).map((c) => [c.id, c]),
);

export const ALL_CARDS: CardDef[] = rawCards as CardDef[];

// Face-down cards in an online player's view of a rival's hand or a deck.
CARDS['hidden-plot'] = { id: 'hidden-plot', name: 'Plot card', type: 'Plot', subtype: 'Hidden', rarity: null, text: 'A face-down Plot card.' };
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
  return def(s, iid).name;
}

export const isGroupLike = (d: CardDef) => d.type === 'Group' || d.type === 'Illuminati';
