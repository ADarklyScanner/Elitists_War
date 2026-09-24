import rawCards from '../data/cards.json';
import type { Alignment, CardDef, CardInstance, GameState } from './types';

export const CARDS: Record<string, CardDef> = Object.fromEntries(
  (rawCards as CardDef[]).map((c) => [c.id, c]),
);

export const ALL_CARDS: CardDef[] = rawCards as CardDef[];

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
