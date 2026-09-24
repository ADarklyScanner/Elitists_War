import { describe, expect, it } from 'vitest';
import {
  abilitiesDisabled, advance, alignments, applyAction, attackStrength, canAid, canEnterPlay, canOppose, createGame,
  destroyGroup, discardCard, giveToken, goalCheck, isSecret, power, raiseEvent, takeoverOptions, waitingFor,
  CARDS, GOALS, type Action, type GameState, type PlotPlay, type Side,
} from '../../src/engine';
import { randomDeck } from '../../src/engine/decks';
import { viewFor } from '../../src/server/service';
import { checkInvariants, give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const pl = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const ill = (s: GameState, id: string) => pl(s, id).illuminati;
const hand = (s: GameState, id: string) => pl(s, id).hand;

/** Pass in open response windows until the game needs a decision (or nothing is open). */
function drain(s: GameState): GameState {
  for (let i = 0; i < 30 && s.window && !s.prompt; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** Play a Plot and let the others pass on the counter window. */
function playAndResolve(s: GameState, who: string, play: PlotPlay): GameState {
  s = act(s, who, { type: 'playPlot', play });
  for (let i = 0; i < 10 && s.window?.kind === 'plot' && !s.prompt; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** Pass through an attack, forcing the dice. */
function resolveAttack(s: GameState, dice: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** Put a Group three steps below its Illuminati (no closeness bonus). */
function deep(s: GameState, who: string, cardId: string): string {
  const a = give(s, who, 'punk-rockers', { under: ill(s, who), side: 'BOTTOM' });
  const b = give(s, who, 'l-4-society', { under: a, side: 'BOTTOM' });
  return give(s, who, cardId, { under: b, side: 'BOTTOM' as Side });
}
/** From p1's main phase, end the turn and stop at the first window or prompt of p2's turn. */
function toP2Turn(s: GameState): GameState {
  s = act(s, 'p1', { type: 'endTurn' });
  return act(s, 'p2', { type: 'pass' });
}
/** Announce an event and open its response window. */
function event(s: GameState, e: Parameters<typeof raiseEvent>[1]): GameState {
  raiseEvent(s, e);
  advance(s);
  return s;
}

/** Like scenario(), with three players. */
function scenario3(): GameState {
  const s = createGame({
    seed: 11,
    players: ['p1', 'p2', 'p3'].map((id, i) => ({ id, name: id.toUpperCase(), isAI: true, deck: randomDeck(90 + i) })),
  });
  for (const c of Object.values(s.cards)) {
    if ((c.zone === 'structure' && CARDS[c.cardId].type === 'Group') || c.zone === 'hand') delete s.cards[c.iid];
  }
  for (const p of s.players) { p.turnsTaken = 1; p.hand = []; s.cards[p.illuminati].tokens = 1; }
  s.active = 0; s.phase = 'main'; s.prompt = undefined; s.window = undefined; s.round = 3; s.nwo = {};
  return s;
}

describe('Fratricide', () => {
  it('wins once two other Illuminati have fallen with your help', () => {
    const s = scenario3();
    pl(s, 'p2').lastPuppetTakenBy = 'p1';
    pl(s, 'p3').lastPuppetTakenBy = 'p2';
    pl(s, 'p3').lastPuppetHelpers = ['p1'];
    expect(GOALS['fratricide'](s, 'p1')).toMatch(/P2 and P3/);
  });
  it('needs credit for both, and a fallen player who is back in the game does not count', () => {
    const s = scenario3();
    pl(s, 'p2').lastPuppetTakenBy = 'p1';
    pl(s, 'p3').lastPuppetTakenBy = 'p2';
    expect(GOALS['fratricide'](s, 'p1')).toBeNull();
    pl(s, 'p3').lastPuppetHelpers = ['p1'];
    give(s, 'p3', 'loan-sharks', { under: ill(s, 'p3'), side: 'BOTTOM' });
    expect(GOALS['fratricide'](s, 'p1')).toBeNull();
  });
  it('the engine credits the destroyer and the players who aided', () => {
    let s = scenario3();
    const att = give(s, 'p1', 'the-mafia', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const last = give(s, 'p2', 'girlie-magazines', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const helper = give(s, 'p3', 'fraternal-orders', { under: ill(s, 'p3'), side: 'BOTTOM' });
    s.cards[att].mods.push({ source: 'test', kind: 'power', value: 10, until: 'permanent' });
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: last });
    s = act(s, 'p3', { type: 'aid', group: helper });
    s = resolveAttack(s, [1, 1]);
    expect(s.cards[last].zone).toBe('destroyed');
    expect(pl(s, 'p2').lastPuppetTakenBy).toBe('p1');
    expect(pl(s, 'p2').lastPuppetHelpers).toEqual(['p3']);
  });
});

describe('New World Orders', () => {
  it('Military-Industrial Complex: Corporate cards are Government too, but not for Goals', () => {
    let s = scenario();
    const corp = give(s, 'p1', 'cable-tv', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const other = give(s, 'p1', 'the-mafia', { under: ill(s, 'p1'), side: 'TOP' });
    const card = give(s, 'p1', 'military-industrial-complex', { hand: true });
    s = playAndResolve(s, 'p1', { card });
    expect(s.nwo.yellow).toBe(card);
    expect(alignments(s, corp)).toEqual(['Corporate', 'Government']);
    expect(alignments(s, other)).not.toContain('Government');
    expect(alignments(s, corp, { goals: true })).toEqual(['Corporate']);
    goalCheck.active = true;
    try { expect(alignments(s, corp)).toEqual(['Corporate']); } finally { goalCheck.active = false; }
  });
  it('Political Correctness: Liberal +3; Conservative Groups with Power 0 or 1 become Criminal', () => {
    let s = scenario();
    const lib = give(s, 'p1', 'girlie-magazines', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const weak = give(s, 'p2', 'opec', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const one = give(s, 'p2', 'gun-lobby', { under: ill(s, 'p2'), side: 'TOP' });
    const strong = give(s, 'p2', 'republicans', { under: ill(s, 'p2'), side: 'LEFT' });
    const card = give(s, 'p1', 'political-correctness', { hand: true });
    expect(alignments(s, weak)).not.toContain('Criminal');
    s = playAndResolve(s, 'p1', { card });
    expect(power(s, lib)).toBe(5);
    expect(alignments(s, weak)).toContain('Criminal');
    expect(alignments(s, one)).toContain('Criminal');
    expect(alignments(s, strong)).not.toContain('Criminal');
  });
  it('World Hunger: Green Groups lose tokens and abilities; Liberal and/or Nation Groups get -2 once', () => {
    let s = scenario();
    const druids = give(s, 'p2', 'druids', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const mafia = give(s, 'p2', 'the-mafia', { under: ill(s, 'p2'), side: 'TOP' });
    const lib = give(s, 'p1', 'big-media', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const both = give(s, 'p1', 'france', { under: ill(s, 'p1'), side: 'TOP' });
    const card = give(s, 'p1', 'world-hunger', { hand: true });
    s = playAndResolve(s, 'p1', { card });
    expect(s.nwo.blue).toBe(card);
    expect(s.cards[druids].tokens).toBe(0);
    giveToken(s, druids);
    expect(s.cards[druids].tokens).toBe(0);
    expect(abilitiesDisabled(s, druids)).toBe(true);
    expect(s.cards[mafia].tokens).toBe(1);
    expect(abilitiesDisabled(s, mafia)).toBe(false);
    expect(power(s, lib)).toBe(2);
    expect(power(s, both)).toBe(1); // Liberal Nation, Power 3: -2 only once
    expect(power(s, mafia)).toBe(6);
  });
});

describe('An Offer You Can\'t Refuse', () => {
  it('takes two Plots from a rival\'s deck at the start of your turn; no Group draw that turn', () => {
    let s = scenario();
    const card = give(s, 'p2', 'an-offer-you-can-t-refuse', { hand: true });
    const taken = pl(s, 'p1').plotDeck.slice(0, 2);
    const own = pl(s, 'p2').plotDeck[0];
    const groups = pl(s, 'p2').groupDeck.length;
    s = toP2Turn(s);
    expect(s.window?.event?.type).toBe('turnStart');
    s = act(s, 'p2', { type: 'playPlot', play: { card, target: ill(s, 'p1') } });
    s = drain(s);
    expect(s.players[s.active].id).toBe('p2');
    expect(hand(s, 'p2')).toEqual(expect.arrayContaining([...taken, own]));
    expect(pl(s, 'p2').groupDeck.length).toBe(groups);
    expect(s.cards[card].zone).toBe('table');
    // The Illuminati's Group draw is also cancelled this turn.
    if (s.prompt?.kind === 'takeover') s = act(s, 'p2', { type: 'skipTakeover' });
    s = act(s, 'p2', { type: 'drawGroup' });
    expect(pl(s, 'p2').groupDeck.length).toBe(groups);
    checkInvariants(s);
  });
  it('only at the start of your own turn, and "one each" needs two rivals', () => {
    let s = scenario();
    const mine = give(s, 'p1', 'an-offer-you-can-t-refuse', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: mine, target: ill(s, 'p2') } })).toThrow(/cannot be played/);
    const card = give(s, 'p2', 'an-offer-you-can-t-refuse', { hand: true });
    s = toP2Turn(s);
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: mine, target: ill(s, 'p2') } })).toThrow(/own turn/);
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card, target: ill(s, 'p1'), mode: 'split' } })).toThrow(/two different rivals/);
  });
});

describe('And STAY Dead!', () => {
  it('a destroyed Group is gone for good; a discarded one leaves the game', () => {
    let s = scenario();
    const mage = give(s, 'p1', 'voudonistas', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const victim = give(s, 'p2', 'loan-sharks', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const card = give(s, 'p1', 'and-stay-dead', { hand: true });
    destroyGroup(s, victim, 'p1');
    advance(s);
    expect(s.window?.event?.type).toBe('destroyed');
    s = act(s, 'p1', { type: 'playPlot', play: { card, payWith: [mage] } });
    s = drain(s);
    expect(s.cards[victim].data?.neverReturns).toBe(true);
    expect(s.cards[mage].tokens).toBe(0);
    // A discarded Group.
    s.cards[mage].tokens = 1;
    const second = give(s, 'p1', 'and-stay-dead', { hand: true });
    const g = give(s, 'p2', 'girlie-magazines', { hand: true });
    discardCard(s, g);
    advance(s);
    s = act(s, 'p1', { type: 'playPlot', play: { card: second, payWith: [mage] } });
    s = drain(s);
    expect(s.cards[g].zone).toBe('destroyed');
    expect(pl(s, 'p2').discard).not.toContain(g);
    const dup = give(s, 'p2', 'girlie-magazines', { hand: true });
    expect(canEnterPlay(s, dup)).toBe(false);
    checkInvariants(s);
  });
  it('needs a Magic Group\'s action and a Group (not a Plot)', () => {
    let s = scenario();
    const mafia = give(s, 'p1', 'the-mafia', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const mage = give(s, 'p1', 'voudonistas', { under: ill(s, 'p1'), side: 'TOP' });
    const victim = give(s, 'p2', 'loan-sharks', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const card = give(s, 'p1', 'and-stay-dead', { hand: true });
    destroyGroup(s, victim, 'p1');
    advance(s);
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, payWith: [mafia] } })).toThrow(/Magic/);
    s = drain(s);
    const plot = give(s, 'p2', 'exposed', { hand: true });
    discardCard(s, plot);
    advance(s);
    expect(s.window?.kind).toBe('event');
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, payWith: [mage] } })).toThrow(/Group is destroyed or discarded/);
  });
});

describe('Annual Convention', () => {
  function setup(type: 'destroyed' | 'devastated') {
    const s = scenario();
    const place = give(s, 'p2', 'hawaii', { under: ill(s, 'p2'), side: 'TOP' });
    const org = deep(s, 'p2', 'loan-sharks');
    const sci = give(s, 'p1', 'evil-geniuses-for-a-better-tomorrow', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const mafia = give(s, 'p1', 'the-mafia', { under: ill(s, 'p1'), side: 'TOP' });
    const card = give(s, 'p1', 'annual-convention', { hand: true });
    if (type === 'devastated') s.cards[place].devastated = true;
    else destroyGroup(s, place, 'p1');
    event(s, { type, card: place, player: 'p2' });
    return { s, place, org, sci, mafia, card };
  }
  it('Instant Attack on an Organization: Power 9 after a Devastation, 12 after a destruction; only Magic or Weird Science may join', () => {
    const d = setup('devastated');
    let s = act(d.s, 'p1', { type: 'playPlot', play: { card: d.card, target: d.org } });
    expect(s.attack!.instant).toBe(true);
    expect(s.attack!.instantPower).toBe(9);
    expect(canAid(s, 'p1', d.sci).ok).toBe(true);
    expect(canAid(s, 'p1', d.mafia).ok).toBe(false);
    s = resolveAttack(s, [1, 1]);
    expect(s.cards[d.org].zone).toBe('destroyed');
    expect(s.cards[d.card].zone).toBe('discard');
    const x = setup('destroyed');
    s = act(x.s, 'p1', { type: 'playPlot', play: { card: x.card, target: x.org } });
    expect(s.attack!.instantPower).toBe(12);
    checkInvariants(resolveAttack(s, [6, 6]));
  });
  it('only after a Place is hit, and only against an Organization', () => {
    const d = setup('devastated');
    expect(() => act(d.s, 'p1', { type: 'playPlot', play: { card: d.card, target: d.place } })).toThrow(/Organization/);
    const s = scenario();
    const org = give(s, 'p2', 'loan-sharks', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const other = give(s, 'p2', 'girlie-magazines', { under: ill(s, 'p2'), side: 'TOP' });
    const card = give(s, 'p1', 'annual-convention', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, target: org } })).toThrow(/Place is destroyed or Devastated/);
    destroyGroup(s, other, 'p1');
    advance(s);
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, target: org } })).toThrow(/Place is destroyed or Devastated/);
  });
});

describe('Botched Contact', () => {
  function setup() {
    const s = scenario();
    const payer = give(s, 'p1', 'the-mafia', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const card = give(s, 'p1', 'botched-contact', { hand: true });
    const a = give(s, 'p2', 'loan-sharks', { hand: true });
    const b = give(s, 'p2', 'girlie-magazines', { hand: true });
    return { s: toP2Turn(s), payer, card, a, b };
  }
  it('sends the taken-over Group back to hand; the rival takes over another card', () => {
    let { s, payer, card, a, b } = setup();
    expect(s.prompt?.kind).toBe('takeover');
    s = act(s, 'p2', { type: 'takeover', card: a, onto: ill(s, 'p2'), side: 'BOTTOM' });
    expect(s.window?.event?.type).toBe('takeover');
    s = act(s, 'p1', { type: 'playPlot', play: { card, payWith: [payer] } });
    s = drain(s);
    expect(hand(s, 'p2')).toContain(a);
    expect(s.cards[payer].tokens).toBe(0);
    expect(s.prompt?.kind).toBe('takeover');
    expect(takeoverOptions(s, 'p2').some((o) => o.card === a)).toBe(false);
    s = act(s, 'p2', { type: 'takeover', card: b, onto: ill(s, 'p2'), side: 'BOTTOM' });
    s = drain(s);
    expect(s.cards[b].zone).toBe('structure');
    expect(s.phase).toBe('main');
    checkInvariants(s);
  });
  it('costs one of your Groups\' actions and only works on a rival', () => {
    let { s, payer, card, a } = setup();
    s = act(s, 'p2', { type: 'takeover', card: a, onto: ill(s, 'p2'), side: 'BOTTOM' });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card } })).toThrow(/action of one of your Groups/);
    s.cards[payer].tokens = 1;
    const own = give(s, 'p2', 'botched-contact', { hand: true });
    const p2g = give(s, 'p2', 'the-mafia', { under: ill(s, 'p2'), side: 'TOP' });
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card: own, payWith: [p2g] } })).toThrow(/rival/);
  });
});

describe('Corruption', () => {
  function setup() {
    const s = scenario();
    const place = give(s, 'p1', 'hawaii', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const a = give(s, 'p1', 'loan-sharks', { under: ill(s, 'p1'), side: 'TOP' });
    const b = give(s, 'p1', 'the-mafia', { under: ill(s, 'p1'), side: 'LEFT' });
    s.cards[place].devastated = true;
    s.cards[place].tokens = 0;
    const card = give(s, 'p2', 'corruption', { hand: true });
    return { s, place, a, b, card };
  }
  it('the Relief is lost and no Relief can be tried until after the player\'s next turn', () => {
    let { s, place, a, b, card } = setup();
    s = act(s, 'p1', { type: 'relief', place, payWith: [a] });
    expect(s.cards[place].devastated).toBe(false);
    expect(s.window?.event?.type).toBe('relief');
    s = act(s, 'p2', { type: 'playPlot', play: { card } });
    s = drain(s);
    expect(s.cards[place].devastated).toBe(true);
    expect(s.cards[place].data?.noReliefUntilTurn).toBe(s.turn + 1);
    expect(() => act(s, 'p1', { type: 'relief', place, payWith: [b] })).toThrow(/No Relief/);
    checkInvariants(s);
  });
  it('only right after Relief', () => {
    const { s, card } = setup();
    s.active = 1;
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card } })).toThrow(/cannot be played/);
  });
});

describe('Cover of Darkness', () => {
  it('takes a destroyed Artifact Resource into your own play', () => {
    let s = scenario();
    const g = give(s, 'p2', 'loan-sharks', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const skull = give(s, 'p2', 'crystal-skull', { resource: true });
    s.cards[skull].linkedTo = g;
    const card = give(s, 'p1', 'cover-of-darkness', { hand: true });
    destroyGroup(s, g, 'p1');
    advance(s);
    expect(s.cards[skull].zone).toBe('destroyed');
    // First the Group's window (nothing to do), then the Resource's.
    for (let i = 0; i < 5 && s.window?.event?.card !== skull; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
    s = act(s, 'p1', { type: 'playPlot', play: { card } });
    s = drain(s);
    expect(s.cards[skull].zone).toBe('resources');
    expect(s.cards[skull].controller).toBe('p1');
    checkInvariants(s);
  });
  it('not for other Resources', () => {
    let s = scenario();
    const g = give(s, 'p2', 'loan-sharks', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const foot = give(s, 'p2', 'bigfoot', { resource: true });
    s.cards[foot].linkedTo = g;
    const card = give(s, 'p1', 'cover-of-darkness', { hand: true });
    destroyGroup(s, g, 'p1');
    advance(s);
    for (let i = 0; i < 5 && s.window?.event?.card !== foot; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
    expect(s.window?.event?.card).toBe(foot);
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card } })).toThrow(/Gadget or Artifact/);
  });
});

describe('Crop Circles', () => {
  it('chooses the Plot draw from the deck instead of drawing; the Group draw is normal', () => {
    let s = scenario();
    const mage = give(s, 'p2', 'voudonistas', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const card = give(s, 'p2', 'crop-circles', { hand: true });
    const plots = pl(s, 'p2').plotDeck.length;
    const groups = pl(s, 'p2').groupDeck.length;
    s = toP2Turn(s);
    s = act(s, 'p2', { type: 'playPlot', play: { card, mode: 'plot', payWith: [mage] } });
    s = drain(s);
    expect(s.prompt?.kind).toBe('choose');
    expect(viewFor(s, 'p1').prompt!.choice!.options).toEqual([]);
    const ch = s.prompt!.choice!;
    const picked = ch.options.slice(-ch.min).map((o) => o.id);
    s = act(s, 'p2', { type: 'choose', ids: picked });
    s = drain(s);
    expect(hand(s, 'p2')).toEqual(expect.arrayContaining(picked));
    expect(pl(s, 'p2').plotDeck.length).toBe(plots - ch.min);
    expect(pl(s, 'p2').groupDeck.length).toBe(groups - 1);
    checkInvariants(s);
  });
  it('only when you are about to draw, paid by a Magic Group', () => {
    let s = scenario();
    const mage = give(s, 'p1', 'voudonistas', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const card = give(s, 'p1', 'crop-circles', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, mode: 'plot', payWith: [mage] } })).toThrow(/cannot be played/);
    const theirs = give(s, 'p2', 'crop-circles', { hand: true });
    const mafia = give(s, 'p2', 'the-mafia', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s = toP2Turn(s);
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card: theirs, mode: 'plot', payWith: [mafia] } })).toThrow(/Magic/);
  });
});

describe('Earth Magic', () => {
  it('lets Magic Groups oppose a Disaster on a Place', () => {
    let s = scenario();
    const place = give(s, 'p2', 'hawaii', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const mage = give(s, 'p2', 'voudonistas', { under: ill(s, 'p2'), side: 'TOP' });
    const mafia = give(s, 'p2', 'the-mafia', { under: ill(s, 'p2'), side: 'LEFT' });
    const crud = give(s, 'p1', 'the-oregon-crud', { hand: true });
    const card = give(s, 'p2', 'earth-magic', { hand: true });
    s = act(s, 'p1', { type: 'playPlot', play: { card: crud, target: place } });
    expect(canOppose(s, 'p2', mage).ok).toBe(false);
    s = act(s, 'p2', { type: 'playPlot', play: { card } });
    expect(canOppose(s, 'p2', mage).ok).toBe(true);
    expect(canOppose(s, 'p2', mafia).ok).toBe(false);
    const before = attackStrength(s, s.attack!).defense;
    s = act(s, 'p2', { type: 'oppose', group: mage });
    expect(attackStrength(s, s.attack!).defense - before).toBe(1);
    s = resolveAttack(s, [6, 6]);
    expect(s.cards[card].zone).toBe('discard');
    checkInvariants(s);
  });
  it('only during a Disaster', () => {
    let s = scenario();
    const att = give(s, 'p1', 'the-mafia', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const place = give(s, 'p2', 'hawaii', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const card = give(s, 'p2', 'earth-magic', { hand: true });
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: place });
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card } })).toThrow(/Disaster/);
  });
});

describe('Embezzlement', () => {
  function setup() {
    const s = scenario();
    const card = give(s, 'p1', 'embezzlement', { hand: true });
    const other = give(s, 'p1', 'exposed', { hand: true });
    const old = give(s, 'p2', 'hat-trick', { hand: true });
    const drawn = pl(s, 'p2').plotDeck[0];
    return { s: toP2Turn(s), card, other, old, drawn };
  }
  it('takes the Plot a rival has just drawn, discarding another', () => {
    let { s, card, other, drawn } = setup();
    expect(s.window?.event?.type).toBe('drawn');
    s = act(s, 'p1', { type: 'playPlot', play: { card, target: drawn, targets: [other] } });
    expect(s.cards[other].zone).toBe('discard');
    s = drain(s);
    expect(hand(s, 'p1')).toContain(drawn);
    expect(hand(s, 'p2')).not.toContain(drawn);
    checkInvariants(s);
  });
  it('only a freshly drawn Plot, and one other Plot must be discarded', () => {
    const { s, card, other, old, drawn } = setup();
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, target: old, targets: [other] } })).toThrow(/just drawn/);
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, target: drawn } })).toThrow(/Discard exactly one/);
  });
});

describe('Epidemic and Giant Kudzu', () => {
  it('Epidemic: Power 14, needs no action, and only Devastates', () => {
    let s = scenario();
    const place = deep(s, 'p2', 'hawaii');
    const card = give(s, 'p1', 'epidemic', { hand: true });
    s = act(s, 'p1', { type: 'playPlot', play: { card, target: place } });
    expect(s.attack!.cardPower).toBe(14);
    expect(s.attack!.instant).toBe(false);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(1);
    s = resolveAttack(s, [1, 1]);
    expect(s.cards[place].zone).toBe('structure');
    expect(s.cards[place].devastated).toBe(true);
    checkInvariants(s);
  });
  it('Epidemic: only Places, only as an attack in your own turn', () => {
    const s = scenario();
    const org = give(s, 'p2', 'loan-sharks', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const place = give(s, 'p1', 'hawaii', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const card = give(s, 'p1', 'epidemic', { hand: true });
    const theirs = give(s, 'p2', 'epidemic', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, target: org } })).toThrow(/Place/);
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card: theirs, target: place } })).toThrow(/cannot be played/);
  });
  it('Giant Kudzu: 30 on a Coastal Place, 24 otherwise; destroys when made by more than 6', () => {
    let s = scenario();
    const coast = deep(s, 'p2', 'hawaii');
    const card = give(s, 'p1', 'giant-kudzu', { hand: true });
    s = act(s, 'p1', { type: 'playPlot', play: { card, target: coast } });
    expect(s.attack!.cardPower).toBe(30);
    s = resolveAttack(s, [1, 1]);
    expect(s.cards[coast].zone).toBe('destroyed');
    s = scenario();
    const vegas = give(s, 'p2', 'las-vegas', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const k2 = give(s, 'p1', 'giant-kudzu', { hand: true });
    s = act(s, 'p1', { type: 'playPlot', play: { card: k2, target: vegas } });
    expect(s.attack!.cardPower).toBe(24);
    s = resolveAttack(s, [4, 4]); // needs 12 or less, made by 4: Devastated only
    expect(s.cards[vegas].zone).toBe('structure');
    expect(s.cards[vegas].devastated).toBe(true);
  });
  it('Giant Kudzu: only the defender may be helped', () => {
    let s = scenario();
    const place = give(s, 'p2', 'las-vegas', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const mine = give(s, 'p1', 'multinational-oil-companies', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const theirs = give(s, 'p2', 'liquor-companies', { under: ill(s, 'p2'), side: 'TOP' });
    const card = give(s, 'p1', 'giant-kudzu', { hand: true });
    s = act(s, 'p1', { type: 'playPlot', play: { card, target: place } });
    expect(canAid(s, 'p1', mine).ok).toBe(false);
    expect(canOppose(s, 'p2', theirs).ok).toBe(true);
  });
});

describe('Exposed!', () => {
  it('a Secret Group loses its Secret status, paid by a Media Group of Power 4+', () => {
    let s = scenario();
    const media = give(s, 'p1', 'big-media', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const secret = give(s, 'p2', 'subliminals', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const card = give(s, 'p1', 'exposed', { hand: true });
    expect(isSecret(s, secret)).toBe(true);
    s = playAndResolve(s, 'p1', { card, target: secret, payWith: [media] });
    expect(isSecret(s, secret)).toBe(false);
    expect(s.cards[media].tokens).toBe(0);
  });
  it('needs a Secret target and a strong enough Media Group', () => {
    const s = scenario();
    const weak = give(s, 'p1', 'girlie-magazines', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const media = give(s, 'p1', 'big-media', { under: ill(s, 'p1'), side: 'TOP' });
    const secret = give(s, 'p2', 'subliminals', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const open = give(s, 'p2', 'loan-sharks', { under: ill(s, 'p2'), side: 'TOP' });
    const card = give(s, 'p1', 'exposed', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, target: secret, payWith: [weak] } })).toThrow(/Power 4/);
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, target: open, payWith: [media] } })).toThrow(/Secret/);
  });
});

describe('George the Janitor', () => {
  function setup() {
    const s = scenario();
    const payer = give(s, 'p1', 'the-mafia', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const card = give(s, 'p1', 'george-the-janitor', { hand: true });
    const plots = ['exposed', 'hat-trick', 'epidemic'].map((id) => give(s, 'p2', id, { hand: true }));
    return { s, payer, card, plots };
  }
  function start(x: ReturnType<typeof setup>): GameState {
    let s = playAndResolve(x.s, 'p1', { card: x.card, target: ill(x.s, 'p2'), payWith: [x.payer] });
    expect(waitingFor(s)).toEqual(['p2']);
    expect(viewFor(s, 'p1').prompt!.choice!.options).toEqual([]);
    s = act(s, 'p2', { type: 'choose', ids: [x.plots[0]] });
    expect(waitingFor(s)).toEqual(['p1']);
    return s;
  }
  it('the rival sets a card aside; you choose blind to expose all the others', () => {
    const x = setup();
    let s = start(x);
    s = act(s, 'p1', { type: 'choose', ids: ['others'] });
    expect(x.plots.map((c) => !!s.cards[c].exposed)).toEqual([false, true, true]);
  });
  it('...or just that card', () => {
    const x = setup();
    let s = start(x);
    s = act(s, 'p1', { type: 'choose', ids: ['picked'] });
    expect(x.plots.map((c) => !!s.cards[c].exposed)).toEqual([true, false, false]);
    expect(s.prompt).toBeUndefined();
  });
  it('needs a rival with hidden Plots and a Group\'s action', () => {
    const s = scenario();
    const payer = give(s, 'p1', 'the-mafia', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const card = give(s, 'p1', 'george-the-janitor', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, target: ill(s, 'p2'), payWith: [payer] } })).toThrow(/no hidden Plot/);
    give(s, 'p2', 'exposed', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, target: ill(s, 'p2') } })).toThrow(/action of one of your Groups/);
  });
});

describe('Hat Trick', () => {
  function setup() {
    const s = scenario();
    const media = give(s, 'p1', 'big-media', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const strong = give(s, 'p1', 'loan-sharks', { under: ill(s, 'p1'), side: 'TOP' });
    const weak = give(s, 'p1', 'punk-rockers', { under: ill(s, 'p1'), side: 'LEFT' });
    const secret = give(s, 'p2', 'subliminals', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const exposed = give(s, 'p1', 'exposed', { hand: true });
    return { s, media, strong, weak, secret, exposed };
  }
  it('returns the Plot you just used to your hand; Hat Trick is discarded instead', () => {
    const x = setup();
    const card = give(x.s, 'p1', 'hat-trick', { hand: true });
    let s = playAndResolve(x.s, 'p1', { card: x.exposed, target: x.secret, payWith: [x.media] });
    expect(s.window?.event?.type).toBe('discarded');
    s = act(s, 'p1', { type: 'playPlot', play: { card, target: x.exposed, payWith: [x.strong] } });
    s = drain(s);
    expect(hand(s, 'p1')).toContain(x.exposed);
    expect(s.cards[card].zone).toBe('discard');
    expect(s.cards[x.strong].tokens).toBe(0);
    checkInvariants(s);
  });
  it('only for your own Plot, paid by a Group with Power 3+', () => {
    const x = setup();
    const card = give(x.s, 'p1', 'hat-trick', { hand: true });
    const theirs = give(x.s, 'p2', 'hat-trick', { hand: true });
    const p2g = give(x.s, 'p2', 'the-mafia', { under: ill(x.s, 'p2'), side: 'TOP' });
    const s = playAndResolve(x.s, 'p1', { card: x.exposed, target: x.secret, payWith: [x.media] });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, target: x.exposed, payWith: [x.weak] } })).toThrow(/Power 3/);
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card: theirs, target: x.exposed, payWith: [p2g] } })).toThrow(/your Plot/);
  });
});
