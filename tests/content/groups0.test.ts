import { it } from 'vitest';
import { scenario } from '../helpers';
it('probe', () => { const s = scenario(); for (const p of s.players) console.log(p.id, s.cards[p.illuminati].cardId, s.cards[p.illuminati].x, s.cards[p.illuminati].y, p.plotDeck.length, p.groupDeck.length); });
