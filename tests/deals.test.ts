// Deals, trades and gifts between players (R040, R022, the transfer part of R038) and I Lied.
import { describe, expect, it } from 'vitest';
import {
  applyAction, createGame, openArrows, subtree, waitingFor, CARDS,
  type Action, type GameState, type Side,
} from '../src/engine';
import { randomDeck } from '../src/engine/decks';
import { viewFor } from '../src/server/service';
import { checkInvariants, give, scenario } from './helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const ill = (s: GameState, id: string) => P(s, id).illuminati;
const under = (s: GameState, pl: string, cardId: string, side: Side = 'BOTTOM') => give(s, pl, cardId, { under: ill(s, pl), side });
const lastDeal = (s: GameState) => s.deals![s.deals!.length - 1];
/** Pass in open response windows until nothing is open. */
function drain(s: GameState): GameState {
  for (let i = 0; i < 30 && s.window && !s.prompt; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** Three players, p1 in his main phase, everyone past the first turn, empty hands and structures. */
function scenario3(): GameState {
  const s = createGame({ seed: 11, players: ['p1', 'p2', 'p3'].map((id, i) => ({ id, name: id.toUpperCase(), isAI: true, deck: randomDeck(90 + i) })) });
  for (const c of Object.values(s.cards)) if ((c.zone === 'structure' && CARDS[c.cardId].type === 'Group') || c.zone === 'hand') delete s.cards[c.iid];
  for (const p of s.players) { p.turnsTaken = 1; p.hand = []; s.cards[p.illuminati].tokens = 1; }
  s.active = 0; s.phase = 'main'; s.prompt = undefined; s.window = undefined; s.round = 3; s.nwo = {};
  return s;
}

describe('gifts and trades of cards in hand (R040)', () => {
  it('a hidden Plot given away goes to the receiver\'s hand and is revealed only to the two players', () => {
    let s = scenario3();
    const plot = give(s, 'p1', 'swiss-bank-account', { hand: true });
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [plot] }, get: {} });
    // The offer is private: the third player does not even see it.
    expect(viewFor(s, 'p3').deals ?? []).toHaveLength(0);
    expect(viewFor(s, 'p2').deals).toHaveLength(1);
    // The receiver is shown the card on offer.
    expect(viewFor(s, 'p2').cards[plot].cardId).toBe('swiss-bank-account');
    s = act(s, 'p2', { type: 'respondDeal', deal: lastDeal(s).id, accept: true });
    expect(P(s, 'p2').hand).toContain(plot);
    expect(P(s, 'p1').hand).not.toContain(plot);
    expect(s.deals).toHaveLength(0);
    // Both players know the card; the third player sees only a card back and a count in the log.
    expect(viewFor(s, 'p2').cards[plot].cardId).toBe('swiss-bank-account');
    expect(viewFor(s, 'p1').cards[plot].cardId).toBe('swiss-bank-account');
    const p3 = viewFor(s, 'p3');
    expect(p3.cards[plot].cardId).toBe('hidden-plot');
    expect(p3.log.some((l) => /Swiss Bank/.test(l.text))).toBe(false);
    expect(p3.log.some((l) => /P1 hands P2 1 card from hand/.test(l.text))).toBe(true);
    checkInvariants(s);
  });

  it('a trade swaps cards at once, as one step: if either part is no longer possible nothing changes', () => {
    let s = scenario();
    const mine = give(s, 'p1', 'swiss-bank-account', { hand: true });
    const theirs = give(s, 'p2', 'benefit-concert', { hand: true });
    s.cards[theirs].exposed = true; // an exposed Plot can be asked for by name
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [mine] }, get: { cards: [theirs] } });
    const id = lastDeal(s).id;
    // The exposed Plot leaves p2's hand before the answer: accepting now fails and nobody loses anything.
    const gone = structuredClone(s);
    P(gone, 'p2').hand = [];
    gone.cards[theirs].zone = 'discard'; P(gone, 'p2').discard.push(theirs);
    expect(() => act(gone, 'p2', { type: 'respondDeal', deal: id, accept: true })).toThrow();
    expect(P(gone, 'p1').hand).toContain(mine);
    // Otherwise both cards change hands.
    s = act(s, 'p2', { type: 'respondDeal', deal: id, accept: true });
    expect(P(s, 'p1').hand).toEqual([theirs]);
    expect(P(s, 'p2').hand).toEqual([mine]);
    expect(s.cards[theirs].exposed).toBe(true);
  });

  it('you may ask only for cards you can see, or for cards of the other player\'s choice', () => {
    let s = scenario();
    const hidden = give(s, 'p2', 'benefit-concert', { hand: true });
    const hiddenGroup = give(s, 'p2', 'punk-rockers', { hand: true });
    const mine = give(s, 'p1', 'swiss-bank-account', { hand: true });
    expect(() => act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [mine] }, get: { cards: [hidden] } })).toThrow(/can see/);
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [mine] }, get: { anyPlots: 1, anyCards: 1 } });
    const id = lastDeal(s).id;
    // The answer must name exactly one Plot and one Group or Resource card.
    expect(() => act(s, 'p2', { type: 'respondDeal', deal: id, accept: true, choose: [hidden] })).toThrow(/Choose 1 Plot and 1 Group/);
    s = act(s, 'p2', { type: 'respondDeal', deal: id, accept: true, choose: [hidden, hiddenGroup] });
    expect(P(s, 'p1').hand.sort()).toEqual([hidden, hiddenGroup].sort());
  });

  it('undrawn cards, empty deals, deals with yourself and offers after the game is over are refused', () => {
    const s = scenario();
    const deckCard = P(s, 'p1').plotDeck[0];
    expect(() => act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [deckCard] }, get: {} })).toThrow();
    expect(() => act(s, 'p1', { type: 'offerDeal', to: 'p2', give: {}, get: {} })).toThrow(/something/);
    const c = give(s, 'p1', 'swiss-bank-account', { hand: true });
    expect(() => act(s, 'p1', { type: 'offerDeal', to: 'p1', give: { cards: [c] }, get: {} })).toThrow();
    const over = structuredClone(s); over.phase = 'gameOver';
    expect(() => act(over, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [c] }, get: {} })).toThrow(/over/);
  });

  it('no cards may be given to a player in a Privileged attack by someone outside it', () => {
    let s = scenario3();
    const att = under(s, 'p1', 'the-mafia');
    const tgt = under(s, 'p2', 'punk-rockers');
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    s.attack!.privileged = true; // as if declared with a Privilege card
    const c = give(s, 'p3', 'swiss-bank-account', { hand: true });
    s = act(s, 'p3', { type: 'offerDeal', to: 'p2', give: { cards: [c] }, get: {} });
    expect(() => act(s, 'p2', { type: 'respondDeal', deal: lastDeal(s).id, accept: true })).toThrow(/Privileged/);
    // Between the two players in the attack, cards may change hands.
    const d = give(s, 'p1', 'benefit-concert', { hand: true });
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [d] }, get: {} });
    s = act(s, 'p2', { type: 'respondDeal', deal: lastDeal(s).id, accept: true });
    expect(P(s, 'p2').hand).toContain(d);
  });

  it('offers lapse at the end of the turn and never hold up the game', () => {
    let s = scenario();
    const c = give(s, 'p1', 'swiss-bank-account', { hand: true });
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [c] }, get: {} });
    expect(waitingFor(s)).toEqual(['p1']);
    s = act(s, 'p1', { type: 'endTurn' });
    s = drain(s);
    expect(s.deals ?? []).toHaveLength(0);
    expect(P(s, 'p1').hand).toContain(c);
    expect(s.log.some((l) => l.to === 'p2' && /lapses/.test(l.text))).toBe(true);
  });

  it('a promise about the future is shown but never enforced', () => {
    let s = scenario();
    const c = give(s, 'p2', 'benefit-concert', { hand: true });
    s.cards[c].exposed = true;
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: {}, get: { cards: [c] }, note: 'I will give you a Plot next turn' });
    expect(lastDeal(s).note).toBe('I will give you a Plot next turn');
    s = act(s, 'p2', { type: 'respondDeal', deal: lastDeal(s).id, accept: true });
    expect(P(s, 'p1').hand).toContain(c);
    // Nothing is owed afterwards: no record of the promise binds p1.
    expect(s.deals).toHaveLength(0);
    expect(s.dealWaits ?? []).toHaveLength(0);
    expect(s.log.some((l) => l.to === 'p2' && /only a promise/.test(l.text))).toBe(true);
  });

  it('a declined or withdrawn offer changes nothing, and only the offerer may withdraw it', () => {
    let s = scenario();
    const c = give(s, 'p1', 'swiss-bank-account', { hand: true });
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [c] }, get: {} });
    expect(() => act(s, 'p2', { type: 'cancelDeal', deal: lastDeal(s).id })).toThrow();
    const declined = act(s, 'p2', { type: 'respondDeal', deal: lastDeal(s).id, accept: false });
    expect(P(declined, 'p1').hand).toContain(c);
    const withdrawn = act(s, 'p1', { type: 'cancelDeal', deal: lastDeal(s).id });
    expect(withdrawn.deals).toHaveLength(0);
    // A counter-offer replaces the offer it answers.
    const x = give(s, 'p2', 'benefit-concert', { hand: true });
    s = act(s, 'p2', { type: 'offerDeal', to: 'p1', give: { cards: [x] }, get: { anyPlots: 1 }, counterOf: lastDeal(s).id });
    expect(s.deals).toHaveLength(1);
    expect(lastDeal(s).from).toBe('p2');
  });
});

describe('Resources and Groups in play changing hands (R040, R038)', () => {
  it('a Resource given away is linked to the receiver\'s Illuminati; a Resource used this turn cannot be given', () => {
    let s = scenario();
    const r = give(s, 'p1', 'cyborg-soldiers', { resource: true });
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { resources: [r] }, get: {} });
    s = act(s, 'p2', { type: 'respondDeal', deal: lastDeal(s).id, accept: true });
    expect(s.cards[r].controller).toBe('p2');
    expect(s.cards[r].linkedTo).toBe(ill(s, 'p2'));
    const used = scenario();
    const u = give(used, 'p1', 'earthquake-projector', { resource: true });
    used.cards[u].abilityTurns = { x: used.turn };
    expect(() => act(used, 'p1', { type: 'offerDeal', to: 'p2', give: { resources: [u] }, get: {} })).toThrow(/used this turn/);
  });

  it('a Group handed over takes its puppets and linked Resources onto the open arrow the receiver picks, for one token', () => {
    let s = scenario();
    const mafia = under(s, 'p1', 'the-mafia');
    const puppet = give(s, 'p1', 'punk-rockers', { under: mafia, side: openArrows(s, mafia)[0] });
    const r = give(s, 'p1', 'cyborg-soldiers', { resource: true });
    s.cards[r].linkedTo = mafia;
    s.cards[mafia].tokens = 1;
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { groups: [{ group: mafia, payWith: mafia }] }, get: {} });
    const id = lastDeal(s).id;
    // The receiver must pick a legal open arrow of his own.
    expect(() => act(s, 'p2', { type: 'respondDeal', deal: id, accept: true, groups: [{ group: mafia, onto: ill(s, 'p1'), side: 'TOP' }] })).toThrow();
    const side = openArrows(s, ill(s, 'p2'))[0];
    s = act(s, 'p2', { type: 'respondDeal', deal: id, accept: true, groups: [{ group: mafia, onto: ill(s, 'p2'), side }] });
    expect(s.cards[mafia].controller).toBe('p2');
    expect(s.cards[mafia].master).toBe(ill(s, 'p2'));
    expect(s.cards[puppet].controller).toBe('p2');
    expect(s.cards[puppet].master).toBe(mafia);
    expect(subtree(s, mafia)).toContain(puppet);
    expect(s.cards[r].controller).toBe('p2');
    expect(s.cards[mafia].tokens).toBe(0); // its own token paid for the move
    checkInvariants(s);
  });

  it('you can ask for a rival\'s Group onto one of your own arrows; the handover needs a token and the main phase of one of the two', () => {
    let s = scenario3();
    const punks = under(s, 'p2', 'punk-rockers');
    s.cards[punks].tokens = 0;
    s.cards[ill(s, 'p2')].tokens = 0;
    const side = openArrows(s, ill(s, 'p1'))[0];
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: {}, get: { groups: [{ group: punks, onto: ill(s, 'p1'), side }] } });
    const id = lastDeal(s).id;
    // Nobody offered a token and p2 has none left on the Group, its master or his Illuminati.
    expect(() => act(s, 'p2', { type: 'respondDeal', deal: id, accept: true })).toThrow(/Action token/);
    // p2 may only pay with his own cards: p1's Illuminati is refused.
    expect(() => act(s, 'p2', { type: 'respondDeal', deal: id, accept: true, groups: [{ group: punks, payWith: ill(s, 'p1') }] })).toThrow(/your own/);
    s.cards[punks].tokens = 1;
    s = act(s, 'p2', { type: 'respondDeal', deal: id, accept: true, groups: [{ group: punks, payWith: punks }] });
    expect(s.cards[punks].controller).toBe('p1');
    checkInvariants(s);
    // In a third player's turn, Groups cannot change hands between these two.
    const other = scenario3();
    const g = under(other, 'p2', 'punk-rockers');
    other.active = 2;
    expect(() => act(other, 'p1', { type: 'offerDeal', to: 'p2', give: {}, get: { groups: [{ group: g, onto: ill(other, 'p1'), side: 'TOP' }] } })).toThrow(/main phase/);
  });
});

describe('I Lied', () => {
  it('accepting with I Lied: you receive the other side at once and keep your own', () => {
    let s = scenario();
    const mine = give(s, 'p1', 'swiss-bank-account', { hand: true });
    const theirs = give(s, 'p2', 'benefit-concert', { hand: true });
    const lie = give(s, 'p2', 'i-lied', { hand: true });
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [mine] }, get: { anyPlots: 1 } });
    s = act(s, 'p2', { type: 'respondDeal', deal: lastDeal(s).id, accept: true, choose: [theirs], lie });
    expect(P(s, 'p2').hand).toContain(mine);
    expect(P(s, 'p2').hand).toContain(theirs);
    expect(s.window?.kind).toBe('plot'); // others may counter it
    s = drain(s);
    expect(P(s, 'p2').hand).toContain(theirs);
    expect(P(s, 'p1').hand).not.toContain(theirs);
    expect(P(s, 'p2').discard).toContain(lie);
    expect(s.dealWaits ?? []).toHaveLength(0);
  });

  it('a cancelled I Lied means the liar hands over his side after all', () => {
    let s = scenario();
    const mine = give(s, 'p1', 'swiss-bank-account', { hand: true });
    const theirs = give(s, 'p2', 'benefit-concert', { hand: true });
    const lie = give(s, 'p2', 'i-lied', { hand: true });
    const hoax = give(s, 'p1', 'hoax', { hand: true });
    const mafia = under(s, 'p1', 'the-mafia');
    s.cards[mafia].tokens = 1;
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [mine] }, get: { anyPlots: 1 } });
    s = act(s, 'p2', { type: 'respondDeal', deal: lastDeal(s).id, accept: true, choose: [theirs], lie });
    s = act(s, 'p1', { type: 'playPlot', play: { card: hoax, target: lie, payWith: [mafia] } });
    s = drain(s);
    expect(P(s, 'p1').hand).toContain(theirs);
    expect(P(s, 'p2').hand).toContain(mine);
  });

  it('an offer can carry the offerer\'s I Lied in secret: once accepted, only the other side is delivered', () => {
    let s = scenario3();
    const mine = give(s, 'p1', 'swiss-bank-account', { hand: true });
    const theirs = give(s, 'p2', 'benefit-concert', { hand: true });
    s.cards[theirs].exposed = true;
    const lie = give(s, 'p1', 'i-lied', { hand: true });
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { cards: [mine] }, get: { cards: [theirs] }, lie });
    // The other player cannot see the lie coming, nor the I Lied card.
    const v = viewFor(s, 'p2');
    expect(v.deals![0].lie).toBeUndefined();
    expect(v.cards[lie].cardId).toBe('hidden-plot');
    expect(viewFor(s, 'p1').deals![0].lie).toBe(lie);
    s = act(s, 'p2', { type: 'respondDeal', deal: lastDeal(s).id, accept: true });
    s = drain(s);
    expect(P(s, 'p1').hand).toContain(theirs);
    expect(P(s, 'p1').hand).toContain(mine);
    expect(P(s, 'p2').hand).not.toContain(mine);
    checkInvariants(s);
  });

  it('cannot be played on its own, nor during an attack', () => {
    let s = scenario();
    const lie = give(s, 'p1', 'i-lied', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: lie } })).toThrow();
    const att = under(s, 'p1', 'the-mafia');
    const tgt = under(s, 'p2', 'punk-rockers');
    const c = give(s, 'p2', 'benefit-concert', { hand: true });
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    s = act(s, 'p2', { type: 'offerDeal', to: 'p1', give: { cards: [c] }, get: { anyPlots: 1 } });
    const spare = give(s, 'p1', 'swiss-bank-account', { hand: true });
    expect(() => act(s, 'p1', { type: 'respondDeal', deal: lastDeal(s).id, accept: true, choose: [spare], lie })).toThrow(/attack/);
    // Without the lie, the trade itself may go ahead during the attack.
    s = act(s, 'p1', { type: 'respondDeal', deal: lastDeal(s).id, accept: true, choose: [spare] });
    expect(P(s, 'p1').hand).toContain(c);
  });
});
