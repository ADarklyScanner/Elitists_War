// Power Structure layout with real card shapes. Cards are 5 × 7 rectangles (like the printed
// 2.5" × 3.5" cards); positions are card centres in half-units, so an upright card is 10 wide and
// 14 tall and a card turned on its side is 14 × 10. The Illuminati sits upright at (0,0). A puppet
// is rotated so its incoming arrow faces its master and is centred on the master's arrow, as on a
// table. Cards may not overlap, so a sideways card can block an arrow of a neighbour.
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
  const extra = c.mods.filter((m) => m.kind === 'addArrow' && m.side).map((m) => m.side!);
  return [...new Set([...(d.arrowsOut ?? []), ...extra])].filter((sd) => sd !== d.arrowIn).map((side) => rotate(side, c.rot ?? 0));
}

export function structureCards(s: GameState, player: string): string[] {
  return Object.values(s.cards)
    .filter((c) => c.zone === 'structure' && c.controller === player)
    .map((c) => c.iid);
}

/** Layout version stored in the game state; older games used one square cell per card. */
export const LAYOUT_VERSION = 2;
export const CARD_W = 10;
export const CARD_H = 14;

export interface Rect { x: number; y: number; w: number; h: number } // centre and full size

/** Size of a card with `rot` quarter turns: upright or on its side. */
export function sizeFor(rot: number): { w: number; h: number } {
  return rot % 2 ? { w: CARD_H, h: CARD_W } : { w: CARD_W, h: CARD_H };
}

export function rectOf(s: GameState, iid: string): Rect {
  const c = s.cards[iid];
  return { x: c.x!, y: c.y!, ...sizeFor(c.rot ?? 0) };
}

/**
 * Where a card hung on `side` of `master` would lie. Every incoming arrow is on a short edge, so a
 * card on a top or bottom arrow stands upright and one on a left or right arrow lies on its side.
 */
export function attachRect(s: GameState, master: string, side: Side): Rect {
  const m = rectOf(s, master);
  const { w, h } = side === 'LEFT' || side === 'RIGHT' ? sizeFor(1) : sizeFor(0);
  const [dx, dy] = DELTA[side];
  return { x: m.x + dx * (m.w + w) / 2, y: m.y + dy * (m.h + h) / 2, w, h };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}

/** Does `r` overlap any card in `player`'s Power Structure (other than those in `ignore`)? */
export function occupied(s: GameState, player: string, r: Rect, ignore: Set<string> = new Set()): boolean {
  return structureCards(s, player).some((iid) => !ignore.has(iid) && s.cards[iid].x !== undefined && overlaps(r, rectOf(s, iid)));
}

/** The side of its master that a puppet hangs from. */
export function sideOf(s: GameState, iid: string): Side | undefined {
  const c = s.cards[iid];
  if (c.side) return c.side;
  if (!c.master) return undefined;
  return SIDES.find((sd) => { const r = attachRect(s, c.master!, sd); return r.x === c.x && r.y === c.y; });
}

/**
 * Bring a game saved with the old square-cell layout up to real card shapes: every puppet keeps
 * the arrow it hangs from and is laid out again from the Illuminati outwards.
 */
export function ensureLayout(s: GameState) {
  if (s.layout === LAYOUT_VERSION) return;
  const cards = Object.values(s.cards).filter((c) => c.zone === 'structure' && c.x !== undefined);
  for (const c of cards) {
    if (!c.master || c.side) continue;
    const m = s.cards[c.master];
    c.side = SIDES.find((sd) => m.x! + DELTA[sd][0] === c.x && m.y! + DELTA[sd][1] === c.y);
  }
  const lay = (iid: string) => {
    for (const p of puppets(s, iid)) {
      const pc = s.cards[p];
      if (!pc.side) continue;
      const r = attachRect(s, iid, pc.side);
      pc.x = r.x; pc.y = r.y;
      lay(p);
    }
  };
  for (const c of cards) if (!c.master) { c.x = 0; c.y = 0; lay(c.iid); }
  s.layout = LAYOUT_VERSION;
}

export function puppets(s: GameState, iid: string): string[] {
  return Object.values(s.cards).filter((c) => c.zone === 'structure' && c.master === iid).map((c) => c.iid);
}

export function subtree(s: GameState, iid: string): string[] {
  const out = [iid];
  for (let i = 0; i < out.length; i++) out.push(...puppets(s, out[i]));
  return out;
}

/** Outgoing sides of `iid` where a card would fit: no puppet there and no card in the way. */
export function openArrows(s: GameState, iid: string, ignore: Set<string> = new Set()): Side[] {
  const c = s.cards[iid];
  if (c.zone !== 'structure' || !c.controller) return [];
  return outSides(s, iid).filter((side) => !occupied(s, c.controller!, attachRect(s, iid, side), new Set([...ignore, iid])));
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
