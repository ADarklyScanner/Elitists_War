// Power Structure layout on a square grid. Every card fills one cell; the
// Illuminati sits at (0,0). A card's printed arrow sides are rotated so that
// its incoming arrow faces its master, which is how physical INWO cards line up.
import type { GameState, Side } from './types';
import { def } from './cards';

export const SIDES: Side[] = ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'];
export const DELTA: Record<Side, [number, number]> = { TOP: [0, -1], RIGHT: [1, 0], BOTTOM: [0, 1], LEFT: [-1, 0] };
export const OPPOSITE_SIDE: Record<Side, Side> = { TOP: 'BOTTOM', BOTTOM: 'TOP', LEFT: 'RIGHT', RIGHT: 'LEFT' };

export function rotate(side: Side, rot: number): Side {
  return SIDES[(SIDES.indexOf(side) + rot) % 4];
}

/** World-facing outgoing arrow sides of a card in a structure. */
export function outSides(s: GameState, iid: string): Side[] {
  const c = s.cards[iid];
  const d = def(s, iid);
  return (d.arrowsOut ?? []).map((side) => rotate(side, c.rot ?? 0));
}

export function structureCards(s: GameState, player: string): string[] {
  return Object.values(s.cards)
    .filter((c) => c.zone === 'structure' && c.controller === player)
    .map((c) => c.iid);
}

export function occupied(s: GameState, player: string, x: number, y: number, ignore: Set<string> = new Set()): boolean {
  return structureCards(s, player).some((iid) => {
    const c = s.cards[iid];
    return !ignore.has(iid) && c.x === x && c.y === y;
  });
}

export function puppets(s: GameState, iid: string): string[] {
  return Object.values(s.cards).filter((c) => c.zone === 'structure' && c.master === iid).map((c) => c.iid);
}

export function subtree(s: GameState, iid: string): string[] {
  const out = [iid];
  for (let i = 0; i < out.length; i++) out.push(...puppets(s, out[i]));
  return out;
}

/** Outgoing sides of `iid` with no puppet and no card in the adjacent cell. */
export function openArrows(s: GameState, iid: string, ignore: Set<string> = new Set()): Side[] {
  const c = s.cards[iid];
  if (c.zone !== 'structure' || !c.controller) return [];
  return outSides(s, iid).filter((side) => {
    const [dx, dy] = DELTA[side];
    return !occupied(s, c.controller!, c.x! + dx, c.y! + dy, ignore);
  });
}

/** Rotation that makes `cardId`'s incoming arrow face a master lying on `sideOfMaster`. */
export function rotationFor(arrowIn: Side, sideOfMaster: Side): number {
  const want = OPPOSITE_SIDE[sideOfMaster]; // child's incoming must point back at master
  return (SIDES.indexOf(want) - SIDES.indexOf(arrowIn) + 4) % 4;
}

/** Depth from the Illuminati (Illuminati = 0, direct puppet = 1, ...). */
export function depth(s: GameState, iid: string): number {
  let d = 0;
  let c = s.cards[iid];
  while (c.master) { d++; c = s.cards[c.master]; }
  return d;
}
