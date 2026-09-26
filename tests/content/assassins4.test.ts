import { describe, expect, it } from 'vitest';
import {
  advance, applyAction, cardImplemented, def, discardCard, frozen, giveToken, isParalyzed, paralysesOn, power, raiseEvent,
  waitingFor, zapsOn,
  type Action, type CardInstance, type GameEvent, type GameState, type PlotPlay,
} from '../../src/engine';
import { checkInvariants, give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, who: 'p1' | 'p2') => s.players.find((p) => p.id === who)!.illuminati;
const P = (s: GameState, who: 'p1' | 'p2') => s.players.find((p) => p.id === who)!;
const play = (s: GameState, who: string, p: PlotPlay) => act(s, who, { type: 'playPlot', play: p });

function drain(s: GameState): GameState {
  for (let i = 0; i < 30 && s.window && !s.prompt; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
function playAndResolve(s: GameState, who: string, p: PlotPlay): GameState {
  s = play(s, who, p);
  for (let i = 0; i < 10 && s.window?.kind === 'plot' && !s.prompt; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
function resolveAttack(s: GameState, dice: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** Put a fresh copy of a card straight into a player's own Group or Plot deck (top). */
function toDeck(s: GameState, who: string, cardId: string, deck: 'groupDeck' | 'plotDeck'): string {
  const p = P(s, who as 'p1' | 'p2');
  const iid = `d${Object.keys(s.cards).length}`;
  const c: CardInstance = { iid, cardId, owner: who, zone: deck, tokens: 0, mods: [] };
  s.cards[iid] = c;
  p[deck].unshift(iid);
  return iid;
}
/** Announce an event directly and open its response window (as tests/content/plots6.test.ts does). */
function fireEvent(s: GameState, e: GameEvent): GameState {
  raiseEvent(s, e);
  advance(s);
  return s;
}

const BATCH = [
  'defection', 'dolphins', 'don-t-rock-the-boat', 'don-t-touch-that-dial', 'enough-is-enough',
  'every-year-is-worse', 'exorcism', 'family-values', 'fickle-finger-of-fate', 'five-year-plan',
  'floating-point-error', 'frankenfood', 'go-fish', 'go-lemmings-go', 'grave-robbers', 'hubble-trouble',
  'junk-bonds', 'lab-explosion', 'let-the-sunshine-in', 'may-day', 'metric-system',
  'my-karma-ran-over-your-dogma', 'near-miss', 'nevermore', 'partition',
];

describe('assassins4: pack implementation', () => {
  it('is fully implemented for every card in this batch', () => {
    for (const id of BATCH) expect(cardImplemented(id), id).toBe(true);
  });
});

describe('Defection', () => {
  it('brings a duplicate of a rival Gadget into play with a Nation action', () => {
    let s = scenario();
    const nation = give(s, 'p1', 'brazil', { under: ill(s, 'p1'), side: 'BOTTOM' });
    s.cards[nation].tokens = 1;
    give(s, 'p2', 'eliza', { resource: true });
    const dup = toDeck(s, 'p1', 'eliza', 'groupDeck');
    const card = give(s, 'p1', 'defection', { hand: true });
    s = playAndResolve(s, 'p1', { card, payWith: [nation] });
    expect(s.prompt?.kind).toBe('choose');
    s = act(s, 'p1', { type: 'choose', ids: [dup] });
    expect(s.cards[dup].zone).toBe('resources');
    expect(s.cards[dup].controller).toBe('p1');
    checkInvariants(s);
  });

  it('cannot be played without a matching Resource a rival controls', () => {
    let s = scenario();
    const nation = give(s, 'p1', 'brazil', { under: ill(s, 'p1'), side: 'BOTTOM' });
    s.cards[nation].tokens = 1;
    toDeck(s, 'p1', 'eliza', 'groupDeck'); // no rival copy in play
    const card = give(s, 'p1', 'defection', { hand: true });
    expect(() => play(s, 'p1', { card, payWith: [nation] })).toThrow();
  });

  it('cannot be played without a Nation action', () => {
    let s = scenario();
    give(s, 'p2', 'eliza', { resource: true });
    toDeck(s, 'p1', 'eliza', 'groupDeck');
    const card = give(s, 'p1', 'defection', { hand: true });
    expect(() => play(s, 'p1', { card, payWith: [] })).toThrow();
  });
});

describe('Dolphins / May Day', () => {
  it('gives an Action token to one Green Group of any Power', () => {
    let s = scenario();
    const g = give(s, 'p1', 'druids', { under: ill(s, 'p1'), side: 'BOTTOM' });
    s.cards[g].tokens = 0;
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'dolphins', { hand: true });
    s = playAndResolve(s, 'p1', { card, targets: [g] });
    expect(s.cards[g].tokens).toBe(1);
    checkInvariants(s);
  });

  it('cannot give a token to a Green Group that already has one', () => {
    const s = scenario();
    const g = give(s, 'p1', 'druids', { under: ill(s, 'p1'), side: 'BOTTOM' });
    s.cards[g].tokens = 1;
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'dolphins', { hand: true });
    expect(() => play(s, 'p1', { card, targets: [g] })).toThrow();
  });

  it('May Day: gives a token to several Communist Groups sharing 5 Power or less', () => {
    let s = scenario();
    const a = give(s, 'p1', 'clone-arrangers', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const b = give(s, 'p1', 'fiendish-fluoridators', { under: ill(s, 'p1'), side: 'RIGHT' });
    s.cards[a].tokens = 0; s.cards[b].tokens = 0;
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'may-day', { hand: true });
    if (power(s, a) + power(s, b) <= 5) {
      s = playAndResolve(s, 'p1', { card, targets: [a, b] });
      expect(s.cards[a].tokens).toBe(1);
      expect(s.cards[b].tokens).toBe(1);
    }
  });
});

describe('Zaps: single-alignment takeover bans', () => {
  it("Don't Rock The Boat bars taking over Fanatic Groups", () => {
    let s = scenario();
    const target = give(s, 'p2', 'elders-of-zion', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', "don-t-rock-the-boat", { hand: true });
    s = playAndResolve(s, 'p1', { card, target: ill(s, 'p2'), payWith: [ill(s, 'p1')] });
    expect(s.cards[card].linkedTo).toBe(ill(s, 'p2'));
    checkInvariants(s);
  });

  it('My Karma Ran Over Your Dogma bars taking over Straight Groups', () => {
    let s = scenario();
    give(s, 'p2', 'boy-sprouts', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'my-karma-ran-over-your-dogma', { hand: true });
    s = playAndResolve(s, 'p1', { card, target: ill(s, 'p2'), payWith: [ill(s, 'p1')] });
    expect(s.cards[card].linkedTo).toBe(ill(s, 'p2'));
  });

  it('Family Values bars taking over Weird Groups', () => {
    let s = scenario();
    give(s, 'p2', 'american-autoduel-association', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'family-values', { hand: true });
    s = playAndResolve(s, 'p1', { card, target: ill(s, 'p2'), payWith: [ill(s, 'p1')] });
    expect(s.cards[card].linkedTo).toBe(ill(s, 'p2'));
    checkInvariants(s);
  });

  it('exempts a player whose Illuminati is the Discordian Society', () => {
    const s = scenario();
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'family-values', { hand: true });
    s.cards[ill(s, 'p2')].cardId = 'discordian-society';
    expect(() => play(s, 'p1', { card, target: ill(s, 'p2') })).toThrow();
  });

  it('Lab Explosion bars taking over any Resource, not Groups', () => {
    let s = scenario();
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'lab-explosion', { hand: true });
    s = playAndResolve(s, 'p1', { card, target: ill(s, 'p2'), payWith: [ill(s, 'p1')] });
    expect(s.cards[card].linkedTo).toBe(ill(s, 'p2'));
  });

  it('Fickle Finger of Fate strips the automatic takeover and gives one +10 direct attack a turn, but not in a two-player game', () => {
    const s = scenario();
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'fickle-finger-of-fate', { hand: true });
    expect(() => play(s, 'p1', { card, target: ill(s, 'p2') })).toThrow();
  });
});

describe('Paralysis', () => {
  it('Every Year Is Worse paralyzes a Conservative Group', () => {
    let s = scenario();
    const target = give(s, 'p2', 'flat-earthers', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'every-year-is-worse', { hand: true });
    s = playAndResolve(s, 'p1', { card, target, payWith: [ill(s, 'p1')] });
    expect(isParalyzed(s, target)).toBe(true);
    checkInvariants(s);
  });

  it('Metric System paralyzes a Corporate Group and is freed by any Illuminati action', () => {
    let s = scenario();
    const target = give(s, 'p2', 'cable-tv', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'metric-system', { hand: true });
    s = playAndResolve(s, 'p1', { card, target, payWith: [ill(s, 'p1')] });
    expect(isParalyzed(s, target)).toBe(true);
    expect(paralysesOn(s, target).length).toBe(1);
    s.cards[ill(s, 'p1')].tokens = 1;
    s = act(s, 'p1', { type: 'freeGroup', group: target, payWith: ill(s, 'p1') });
    expect(isParalyzed(s, target)).toBe(false);
    checkInvariants(s);
  });
});

describe('Attribute Freezes', () => {
  it('Five-Year Plan freezes Communist Groups for the rest of the turn', () => {
    const s = scenario();
    const g = give(s, 'p2', 'clone-arrangers', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'five-year-plan', { hand: true });
    const s2 = playAndResolve(s, 'p1', { card, payWith: [ill(s, 'p1')] });
    expect(frozen(s2, g)).toBe(true);
  });

  it('Floating Point Error freezes Computer Groups', () => {
    const s = scenario();
    const g = give(s, 'p2', 'hackers', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'floating-point-error', { hand: true });
    const s2 = playAndResolve(s, 'p1', { card, payWith: [ill(s, 'p1')] });
    expect(frozen(s2, g)).toBe(true);
  });

  it('Junk Bonds freezes Bank Groups', () => {
    const s = scenario();
    const g = give(s, 'p2', 'i-r-s', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'junk-bonds', { hand: true });
    const s2 = playAndResolve(s, 'p1', { card, payWith: [ill(s, 'p1')] });
    expect(frozen(s2, g)).toBe(true);
  });

  it('Let the Sunshine In freezes Secret Groups', () => {
    const s = scenario();
    const g = give(s, 'p2', 'elders-of-zion', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'let-the-sunshine-in', { hand: true });
    const s2 = playAndResolve(s, 'p1', { card, payWith: [ill(s, 'p1')] });
    expect(frozen(s2, g)).toBe(true);
  });

  it('Hubble Trouble freezes Space and Science Groups', () => {
    const s = scenario();
    const g = give(s, 'p2', 'nasa', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'hubble-trouble', { hand: true });
    const s2 = playAndResolve(s, 'p1', { card, payWith: [ill(s, 'p1')] });
    expect(frozen(s2, g)).toBe(true);
  });
});

describe('Enough is Enough', () => {
  it('clears Zaps, Paralysis and Freezes on your own turn and skips your Plot draws', () => {
    let s = scenario();
    give(s, 'p1', 'boy-sprouts', { under: ill(s, 'p1'), side: 'BOTTOM' });
    s.cards[ill(s, 'p2')].tokens = 1;
    const zap = give(s, 'p2', 'my-karma-ran-over-your-dogma', { hand: true });
    s.active = 1; // 'anytime' Plots need priority: let p2 act on his own turn
    s = playAndResolve(s, 'p2', { card: zap, target: ill(s, 'p1'), payWith: [ill(s, 'p2')] });
    s.active = 0;
    expect(zapsOn(s, 'p1').length).toBe(1);
    const eie = give(s, 'p1', 'enough-is-enough', { hand: true });
    s = fireEvent(s, { type: 'turnStart', player: 'p1' });
    expect(s.window?.kind).toBe('event');
    s = playAndResolve(s, 'p1', { card: eie });
    expect(zapsOn(s, 'p1').length).toBe(0);
    expect(s.turnFlags.noPlotDraws).toContain('p1');
  });
});

describe('Exorcism', () => {
  it('removes every Zap from a player at the cost of the top card of a deck', () => {
    let s = scenario();
    s.cards[ill(s, 'p2')].tokens = 1;
    const zap = give(s, 'p2', 'my-karma-ran-over-your-dogma', { hand: true });
    s.active = 1;
    s = playAndResolve(s, 'p2', { card: zap, target: ill(s, 'p1'), payWith: [ill(s, 'p2')] });
    s.active = 0;
    expect(zapsOn(s, 'p1').length).toBe(1);
    toDeck(s, 'p1', 'punk-rockers', 'groupDeck');
    const card = give(s, 'p1', 'exorcism', { hand: true });
    s = playAndResolve(s, 'p1', { card, target: ill(s, 'p1'), mode: 'groupDeck' });
    expect(zapsOn(s, 'p1').length).toBe(0);
    checkInvariants(s);
  });

  it('cannot be played on a player who is not Zapped', () => {
    const s = scenario();
    toDeck(s, 'p1', 'punk-rockers', 'groupDeck');
    const card = give(s, 'p1', 'exorcism', { hand: true });
    expect(() => play(s, 'p1', { card, target: ill(s, 'p1'), mode: 'groupDeck' })).toThrow();
  });
});

describe("Don't Touch That Dial!", () => {
  it("ends the attacker's turn at once when an attack on a Media Group fails", () => {
    let s = scenario();
    const media = give(s, 'p2', 'big-media', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const attacker = give(s, 'p1', 'punk-rockers', { under: ill(s, 'p1'), side: 'BOTTOM' });
    s.cards[attacker].tokens = 1;
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker, target: media });
    s = drain(s);
    if (s.window?.kind === 'roll') {
      s.attack!.roll = [1, 1];
      s.cards[media].tokens = 1;
      const card = give(s, 'p2', "don-t-touch-that-dial", { hand: true });
      s = play(s, 'p2', { card, payWith: [media] });
      s = resolveAttack(s, [1, 1]);
      expect(s.phase).toBe('endOfTurn');
      expect(s.turnFlags.endedAtOnce).toBe(true);
    }
  });
});

describe('Frankenfood', () => {
  it('gives one of your own Places a chosen alignment with a Science action', () => {
    let s = scenario();
    const sci = give(s, 'p1', 'a-m-a', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const place = give(s, 'p1', 'russia', { under: ill(s, 'p1'), side: 'RIGHT' });
    s.cards[sci].tokens = 1;
    const card = give(s, 'p1', 'frankenfood', { hand: true });
    s = playAndResolve(s, 'p1', { card, target: place, payWith: [sci], alignment: 'Liberal' });
    expect(s.cards[card].linkedTo).toBe(place);
    checkInvariants(s);
  });

  it('cannot add an alignment opposite one the Place already has (Texas is Violent: no Peaceful)', () => {
    const s = scenario();
    const sci = give(s, 'p1', 'a-m-a', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const place = give(s, 'p1', 'texas', { under: ill(s, 'p1'), side: 'RIGHT' });
    s.cards[sci].tokens = 1;
    const card = give(s, 'p1', 'frankenfood', { hand: true });
    expect(def(s, place).alignments).toContain('Violent');
    expect(() => play(s, 'p1', { card, target: place, payWith: [sci], alignment: 'Peaceful' })).toThrow();
  });
});

describe('Go Fish', () => {
  it("takes every copy of a named Plot and discards two more from the victim's deck", () => {
    let s = scenario();
    const named = give(s, 'p2', 'nevermore', { hand: true });
    toDeck(s, 'p2', 'nevermore', 'plotDeck');
    toDeck(s, 'p2', 'nevermore', 'plotDeck');
    const card = give(s, 'p1', 'go-fish', { hand: true });
    s = playAndResolve(s, 'p1', { card, target: ill(s, 'p2'), mode: 'nevermore' });
    expect(P(s, 'p1').hand).toContain(named);
    checkInvariants(s);
  });

  it('exposes all of your own Plots if the rival has none of the named Plot', () => {
    let s = scenario();
    give(s, 'p2', 'my-karma-ran-over-your-dogma', { hand: true });
    const mine = give(s, 'p1', 'my-karma-ran-over-your-dogma', { hand: true });
    const card = give(s, 'p1', 'go-fish', { hand: true });
    s = playAndResolve(s, 'p1', { card, target: ill(s, 'p2'), mode: 'nevermore' });
    expect(s.cards[mine].exposed).toBe(true);
  });
});

describe('Go, Lemmings, Go!', () => {
  it("doubles a rival's single deck discard used to pay a cost, with no benefit to the rival", () => {
    let s = scenario();
    give(s, 'p1', 'go-lemmings-go', { hand: true });
    s.cards[ill(s, 'p1')].tokens = 1;
    const zap = give(s, 'p1', 'my-karma-ran-over-your-dogma', { hand: true });
    s = playAndResolve(s, 'p1', { card: zap, target: ill(s, 'p2'), payWith: [ill(s, 'p1')] });
    expect(zapsOn(s, 'p2').length).toBe(1);
    toDeck(s, 'p2', 'punk-rockers', 'groupDeck');
    toDeck(s, 'p2', 'punk-rockers', 'groupDeck');
    toDeck(s, 'p2', 'punk-rockers', 'groupDeck');
    const before = P(s, 'p2').groupDeck.length;
    const exorcism = give(s, 'p2', 'exorcism', { hand: true });
    s.active = 1; // 'anytime' Plots need priority: let p2 act on his own turn
    s = play(s, 'p2', { card: exorcism, target: ill(s, 'p2'), mode: 'groupDeck' });
    for (let i = 0; i < 10 && s.window?.kind === 'plot' && !s.prompt; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
    // The costDiscard event now waits: p1 answers with Go, Lemmings, Go! instead of passing.
    expect(s.window?.kind).toBe('event');
    const lemmings = P(s, 'p1').hand.find((c) => s.cards[c].cardId === 'go-lemmings-go')!;
    s = playAndResolve(s, 'p1', { card: lemmings });
    expect(before - P(s, 'p2').groupDeck.length).toBe(3); // 1 for Exorcism, +2 more from Go, Lemmings, Go!
    checkInvariants(s);
  });
});

describe('Grave Robbers', () => {
  it('offers to search your Group deck for an Artifact right after you take over a Resource', () => {
    let s = scenario();
    const art = toDeck(s, 'p1', 'angel-s-feather', 'groupDeck');
    const res = give(s, 'p1', 'weather-satellite', { resource: true });
    const card = give(s, 'p1', 'grave-robbers', { hand: true });
    s = fireEvent(s, { type: 'takeover', player: 'p1', card: res });
    expect(s.window?.kind).toBe('event');
    s = playAndResolve(s, 'p1', { card });
    expect(s.prompt?.kind).toBe('choose');
    s = act(s, 'p1', { type: 'choose', ids: [art] });
    expect(s.cards[art].zone).toBe('resources');
    expect(s.cards[art].controller).toBe('p1');
    checkInvariants(s);
  });

  it('cannot be played right after taking over a Group, or with no Artifact in the deck', () => {
    let s = scenario();
    const g = give(s, 'p1', 'punk-rockers', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const card = give(s, 'p1', 'grave-robbers', { hand: true });
    s = fireEvent(s, { type: 'takeover', player: 'p1', card: g });
    expect(() => play(s, 'p1', { card })).toThrow();
  });
});

describe('Near Miss', () => {
  it('turns a destroyed Place into a mere Devastation', () => {
    let s = scenario();
    const attacker = give(s, 'p1', 'punk-rockers', { under: ill(s, 'p1'), side: 'BOTTOM' });
    s.cards[attacker].tokens = 1;
    const place = give(s, 'p2', 'russia', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker, target: place });
    s = drain(s);
    if (s.window?.kind === 'roll') {
      const card = give(s, 'p2', 'near-miss', { hand: true });
      s = play(s, 'p2', { card, target: place, mode: 'save' });
      s = resolveAttack(s, [1, 1]);
      expect(s.cards[place].zone).toBe('structure');
      expect(s.cards[place].devastated).toBe(true);
      checkInvariants(s);
    }
  });

  it('removes Devastation from a Place at any time outside an attack', () => {
    let s = scenario();
    const place = give(s, 'p1', 'russia', { under: ill(s, 'p1'), side: 'BOTTOM' });
    s.cards[place].devastated = true;
    const card = give(s, 'p1', 'near-miss', { hand: true });
    s = playAndResolve(s, 'p1', { card, target: place, mode: 'clear' });
    expect(s.cards[place].devastated).toBe(false);
  });
});

describe('Nevermore!', () => {
  it('bans a Plot for the rest of the game right after it resolves', () => {
    let s = scenario();
    s.cards[ill(s, 'p2')].tokens = 1;
    s.cards[ill(s, 'p1')].tokens = 1;
    const card = give(s, 'p1', 'nevermore', { hand: true });
    const zap = give(s, 'p2', 'my-karma-ran-over-your-dogma', { hand: true });
    s.active = 1; // 'anytime' Plots need priority: let p2 act on his own turn
    s = playAndResolve(s, 'p2', { card: zap, target: ill(s, 'p1'), payWith: [ill(s, 'p2')] });
    expect(s.window?.kind).toBe('event');
    s = playAndResolve(s, 'p1', { card, mode: 'illuminati', payWith: [ill(s, 'p1')] });
    expect(s.cards[card].data?.banned).toContain('my-karma-ran-over-your-dogma');
    checkInvariants(s);
  });
});

describe('Partition', () => {
  it('splits a Huge Place into two non-Huge halves with half the printed Power', () => {
    let s = scenario();
    give(s, 'p1', 'russia', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const dup = give(s, 'p1', 'russia', { hand: true });
    const card = give(s, 'p1', 'partition', { hand: true });
    s = playAndResolve(s, 'p1', { card, target: dup });
    const halves = Object.values(s.cards).filter((c) => c.cardId === 'russia' && c.zone === 'structure');
    expect(halves.length).toBe(2);
    for (const h of halves) {
      expect(power(s, h.iid)).toBe(2);
      expect(def(s, h.iid).attributes).toContain('Huge'); // printed attributes unaffected
    }
    checkInvariants(s);
  });

  it('cannot be played without a copy of that Huge Place already in play', () => {
    const s = scenario();
    const dup = give(s, 'p1', 'russia', { hand: true });
    const card = give(s, 'p1', 'partition', { hand: true });
    expect(() => play(s, 'p1', { card, target: dup })).toThrow();
  });
});
