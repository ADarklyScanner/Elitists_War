// The words printed on each card's face: friendly rules text, an Illuminati's Special Goal line, and
// flavour. The game engine's own wording (cards.json `text`) stays the authority for what a card does;
// this is how it reads to a player. Cards without a face entry fall back to the engine wording.
import FACE from '../data/cardFace.json';

export interface CardFace { rules: string; goal: string; flavor: string }
const faces = FACE as Record<string, CardFace>;

export const cardFace = (cardId: string): CardFace | undefined => faces[cardId];
