import { describe, expect, it } from 'vitest';
import {
  advance, applyAction, attackStrength, attributes, startInstantAttack, destroyGroup, discardCard, globalPower, outSides, power, validateAttack, waitingFor,
  type Action, type GameState, type PlotPlay,
} from '../../src/engine';
import { checkInvariants, give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, pl: 'p1' | 'p2') => s.players[pl === 'p1' ? 0 : 1].illuminati;
const P = (s: GameState, pl: 'p1' | 'p2') => s.players[pl === 'p1' ? 0 : 1];
const play = (s: GameState, pl: string, p: PlotPlay) => act(s, pl, { type: 'playPlot', play: p });

/** Everyone passes the open windows (but never answers a prompt). */
function drain(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 40 && s.window && !s.prompt; i++) {
    if (dice && s.window.kind === 'roll' && s.attack?.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** Play a non-attack Plot and let the others pass so it resolves. */
function playAndResolve(s: GameState, pl: string, p: PlotPlay): GameState {
  s = play(s, pl, p);
  while (s.window?.kind === 'plot') s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** p1 ends the turn; stop at the first event window of p2's turn (or p2's main phase). */
function toP2TurnStart(s: GameState): GameState {
  s = act(s, 'p1', { type: 'endTurn' });
  for (let i = 0; i < 10 && s.window?.kind === 'endOfTurn'; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}

describe('Head in a Jar', () => {
  function setup() {
    const s = scenario();
    const pers = give(s, 'p1', 'nancy-reagan', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const pup = give(s, 'p1', 'punk-rockers', { under: pers, side: 'RIGHT' });
    const jar = give(s, 'p1', 'head-in-a-jar', { hand: true });
    return { s, pers, pup, jar };
  }
  it('keeps a killed Personality in play, in its old place with its puppets', () => {
    const { s: s0, pers, pup, jar } = setup();
    destroyGroup(s0, pers, 'p2');
    advance(s0);
    expect(s0.window?.kind).toBe('event');
    let s = play(s0, 'p1', { card: jar });
    s = drain(s);
    expect(s.cards[pers].zone).toBe('structure');
    expect(s.cards[pers].master).toBe(ill(s, 'p1'));
    expect(s.cards[pup].master).toBe(pers);
    expect(s.cards[jar].linkedTo).toBe(pers);
    expect(P(s, 'p2').destroyedCredit).not.toContain(pers);
    checkInvariants(s);
    // It can no longer take control of new Groups, but may still attack to destroy.
    s.cards[pers].tokens = 1;
    Object.assign(s.cards[pup], { zone: 'removed', master: undefined, x: undefined, y: undefined }); // free its arrow
    const tgt = give(s, 'p2', 'girlie-magazines', { under: ill(s, 'p2'), side: 'BOTTOM' });
    expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'control', attacker: pers, target: tgt })).toMatch(/head in a jar/);
    expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: pers, target: tgt })).toBeNull();
    // +10 to defend against a later Assassination.
    startInstantAttack(s, 'p2', { plot: 'test-assassination', target: pers, power: 10, assassination: true });
    expect(attackStrength(s, s.attack!).lines).toContain('Defense +10: Head in a Jar');
  });
  it('only for your own Personality', () => {
    const s0 = scenario();
    const theirs = give(s0, 'p2', 'nancy-reagan', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const jar = give(s0, 'p1', 'head-in-a-jar', { hand: true });
    destroyGroup(s0, theirs, 'p1');
    advance(s0);
    expect(() => play(s0, 'p1', { card: jar })).toThrow(/your Personalities/);
    // Not a Personality.
    const s1 = scenario();
    const org = give(s1, 'p1', 'loan-sharks', { under: ill(s1, 'p1'), side: 'BOTTOM' });
    const jar1 = give(s1, 'p1', 'head-in-a-jar', { hand: true });
    destroyGroup(s1, org, 'p2');
    advance(s1);
    expect(() => play(s1, 'p1', { card: jar1 })).toThrow(/Personalities/);
  });
});

describe('Let\'s Get Organized', () => {
  it('adds one outgoing arrow, paid by the Group or its master', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'druids', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'let-s-get-organized', { hand: true });
    expect(outSides(s0, g)).toEqual(['BOTTOM']);
    const s = playAndResolve(s0, 'p1', { card, target: g, mode: 'LEFT', payWith: [ill(s0, 'p1')] });
    expect(outSides(s, g).sort()).toEqual(['BOTTOM', 'LEFT']);
    expect(s.cards[card].linkedTo).toBe(g);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
    // A second copy cannot be used on the same Group.
    const again = give(s, 'p1', 'let-s-get-organized', { hand: true });
    expect(() => play(s, 'p1', { card: again, target: g, mode: 'RIGHT', payWith: [g] })).toThrow(/already has/);
  });
  it('not on a Group with 3 arrows, and not paid by an unrelated Group', () => {
    const s = scenario();
    const mafia = give(s, 'p1', 'the-mafia', { under: ill(s, 'p1'), side: 'TOP' });
    const g = give(s, 'p1', 'druids', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const card = give(s, 'p1', 'let-s-get-organized', { hand: true });
    expect(() => play(s, 'p1', { card, target: mafia, payWith: [mafia] })).toThrow(/3 outgoing/);
    expect(() => play(s, 'p1', { card, target: g, payWith: [mafia] })).toThrow(/its master/);
  });
});

describe('Let\'s Get REALLY Organized', () => {
  it('gives a Group with two arrows a third', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'let-s-get-really-organized', { hand: true });
    const s = playAndResolve(s0, 'p1', { card, target: g, payWith: [g] });
    expect(outSides(s, g).length).toBe(3);
    expect(s.cards[card].linkedTo).toBe(g);
  });
  it('not on a Group without arrows, and only in your own turn', () => {
    const s = scenario();
    const g = give(s, 'p1', 'punk-rockers', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const card = give(s, 'p1', 'let-s-get-really-organized', { hand: true });
    expect(() => play(s, 'p1', { card, target: g, payWith: [g] })).toThrow(/one or two/);
  });
});

describe('March on Washington', () => {
  function setup() {
    const s = scenario();
    const big = give(s, 'p1', 'big-media', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const holly = give(s, 'p1', 'hollywood', { under: ill(s, 'p1'), side: 'TOP' });
    const target = give(s, 'p2', 'fbi', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const mc = give(s, 'p1', 'media-connections', { hand: true });
    const mow = give(s, 'p1', 'march-on-washington', { hand: true });
    return { s, big, holly, target, mc, mow };
  }
  it('gives back the action of a paying Group of Power 6 or less; costs the top Plot of your deck', () => {
    const { s: s0, big, holly, target, mc, mow } = setup();
    const deck = P(s0, 'p1').plotDeck.length;
    let s = play(s0, 'p1', { card: mc, target, payWith: [big, holly] });
    s = play(s, 'p1', { card: mow, target: mc, targets: [holly] });
    expect(s.cards[holly].tokens).toBe(1);
    expect(s.cards[big].tokens).toBe(0);
    expect(P(s, 'p1').plotDeck.length).toBe(deck - 1);
    s = drain(s);
    expect(s.cards[mc].linkedTo).toBe(target);
    expect(s.cards[mow].zone).toBe('discard');
    checkInvariants(s);
  });
  it('only once per turn, and only for a Group that paid', () => {
    const { s: s0, big, holly, target, mc, mow } = setup();
    let s = play(s0, 'p1', { card: mc, target, payWith: [big, holly] });
    const other = give(s, 'p1', 'loan-sharks', { under: ill(s, 'p1'), side: 'LEFT' });
    s.cards[other].tokens = 0;
    expect(() => play(s, 'p1', { card: mow, target: mc, targets: [other] })).toThrow(/paid/);
    s.cards[ill(s, 'p1')].data = { marchTurn: s.turn };
    expect(() => play(s, 'p1', { card: mow, target: mc, targets: [holly] })).toThrow(/once per turn/);
  });
});

describe('Media Connections', () => {
  it('makes any Group Media with Global Power equal to its Power', () => {
    const s0 = scenario();
    const big = give(s0, 'p1', 'big-media', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const holly = give(s0, 'p1', 'hollywood', { under: ill(s0, 'p1'), side: 'TOP' });
    const fbi = give(s0, 'p2', 'fbi', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'media-connections', { hand: true });
    expect(globalPower(s0, fbi)).toBe(2);
    const s = playAndResolve(s0, 'p1', { card, target: fbi, payWith: [big, holly] });
    expect(attributes(s, fbi)).toContain('Media');
    expect(globalPower(s, fbi)).toBe(power(s, fbi));
    expect(s.cards[card].linkedTo).toBe(fbi);
  });
  it('needs Media Groups with 6 Power in total', () => {
    const s = scenario();
    const holly = give(s, 'p1', 'hollywood', { under: ill(s, 'p1'), side: 'TOP' });
    const mafia = give(s, 'p1', 'the-mafia', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const card = give(s, 'p1', 'media-connections', { hand: true });
    expect(() => play(s, 'p1', { card, target: mafia, payWith: [holly] })).toThrow(/6 Power/);
    expect(() => play(s, 'p1', { card, target: mafia, payWith: [holly, mafia] })).toThrow(/Media Groups/);
  });
});

describe('Opportunity Knocks', () => {
  /** p1 fails to take over Big Media from hand; p2 holds Opportunity Knocks. */
  function setup() {
    const s0 = scenario();
    const weak = give(s0, 'p1', 'l-4-society', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const big = give(s0, 'p1', 'big-media', { hand: true });
    const mafia = give(s0, 'p2', 'the-mafia', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const ok = give(s0, 'p2', 'opportunity-knocks', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: weak, target: big });
    for (let i = 0; i < 10 && s.attack; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
    return { s, big, mafia, ok };
  }
  it('lets a rival attack the failed Group out of turn at +5, then the turn goes on', () => {
    const { s: s0, big, mafia, ok } = setup();
    expect(s0.window?.kind).toBe('event');
    expect(s0.window?.event?.type).toBe('failedTakeover');
    let s = play(s0, 'p2', { card: ok, mode: 'control', helper: mafia });
    s = act(s, 'p1', { type: 'pass' }); // the Plot resolves and the attack begins
    expect(s.attack?.attackerPlayer).toBe('p2');
    expect(s.attack?.attackBonus.some((b) => b.amount === 5)).toBe(true);
    s = drain(s, [1, 1]);
    expect(s.cards[big].zone).toBe('structure');
    expect(s.cards[big].controller).toBe('p2');
    expect(s.window).toBeUndefined();
    expect(s.players[s.active].id).toBe('p1');
    expect(s.phase).toBe('main');
    checkInvariants(s);
  });
  it('can destroy the Group instead', () => {
    const { s: s0, big, mafia, ok } = setup();
    let s = play(s0, 'p2', { card: ok, mode: 'destroy', helper: mafia });
    s = act(s, 'p1', { type: 'pass' });
    s = drain(s, [1, 1]);
    expect(s.cards[big].zone).toBe('destroyed');
    expect(P(s, 'p2').destroyedCredit).toContain(big);
    checkInvariants(s);
  });
  it('only against a rival, with a Group that can attack', () => {
    const { s, mafia, ok } = setup();
    s.cards[mafia].tokens = 0;
    expect(() => play(s, 'p2', { card: ok, mode: 'control', helper: mafia })).toThrow(/Action token/);
    const mine = give(s, 'p1', 'opportunity-knocks', { hand: true });
    expect(() => play(s, 'p1', { card: mine, mode: 'control', helper: ill(s, 'p1') })).toThrow(/rival/);
  });
});

describe('Purge', () => {
  it('a Group loses 1 Power and 1 Global Power but becomes immune to agents', () => {
    const s0 = scenario();
    const big = give(s0, 'p1', 'big-media', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'purge', { hand: true });
    let s = playAndResolve(s0, 'p1', { card, payWith: [big] });
    expect(power(s, big)).toBe(3);
    expect(globalPower(s, big)).toBe(3);
    expect(s.cards[card].linkedTo).toBe(big);
    // A rival's duplicate cannot be used against it.
    const att = give(s, 'p2', 'the-mafia', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const dup = give(s, 'p2', 'big-media', { hand: true });
    s.active = 1;
    s = act(s, 'p2', { type: 'attack', attackType: 'destroy', attacker: att, target: big });
    expect(() => act(s, 'p2', { type: 'agent', card: dup, as: 'aid' })).toThrow(/immune to agents/);
  });
  it('the Illuminati purges Agents of itself; with none in play it cannot be used', () => {
    const s0 = scenario();
    const card = give(s0, 'p1', 'purge', { hand: true });
    expect(() => play(s0, 'p1', { card, payWith: [ill(s0, 'p1')] })).toThrow(/no Agents/);
    const agent = give(s0, 'p2', s0.cards[ill(s0, 'p1')].cardId, { hand: true });
    P(s0, 'p2').hand = [];
    Object.assign(s0.cards[agent], { zone: 'table', controller: 'p2' });
    const s = playAndResolve(s0, 'p1', { card, payWith: [ill(s0, 'p1')] });
    expect(s.cards[agent].zone).toBe('destroyed');
  });
});

describe('Reorganization', () => {
  it('lets you move Groups without paying for the rest of the turn', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'reorganization', { hand: true });
    let s = playAndResolve(s0, 'p1', { card });
    expect(s.turnFlags.freeMoves).toBe('p1');
    s.cards[g].tokens = 0;
    s = act(s, 'p1', { type: 'move', group: g, onto: ill(s, 'p1'), side: 'TOP', payWith: g });
    expect(s.cards[g].side).toBe('TOP');
    s = act(s, 'p1', { type: 'move', group: g, onto: ill(s, 'p1'), side: 'LEFT', payWith: g });
    expect(s.cards[g].side).toBe('LEFT');
    checkInvariants(s);
  });
  it('costs the Illuminati\'s action', () => {
    const s = scenario();
    s.cards[ill(s, 'p1')].tokens = 0;
    const card = give(s, 'p1', 'reorganization', { hand: true });
    expect(() => play(s, 'p1', { card })).toThrow(/Illuminati/);
  });
});

describe('Sabotage', () => {
  /** p2's turn begins and he takes over the FBI automatically; p1 holds Sabotage. */
  function setup() {
    let s = scenario();
    const fbi = give(s, 'p2', 'fbi', { hand: true });
    const card = give(s, 'p1', 'sabotage', { hand: true });
    const cia = give(s, 'p1', 'c-i-a', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const mafia = give(s, 'p1', 'the-mafia', { under: ill(s, 'p1'), side: 'TOP' });
    s = toP2TurnStart(s);
    s = drain(s);
    expect(s.prompt?.kind).toBe('takeover');
    s = act(s, 'p2', { type: 'takeover', card: fbi, onto: ill(s, 'p2'), side: 'BOTTOM' });
    return { s, fbi, card, cia, mafia };
  }
  it('sends the Group back to his hand and stops automatic takeovers this turn', () => {
    const { s: s0, fbi, card } = setup();
    expect(s0.window?.event?.type).toBe('takeover');
    let s = play(s0, 'p1', { card, payWith: [ill(s0, 'p1')] });
    s = drain(s);
    expect(s.cards[fbi].zone).toBe('hand');
    expect(P(s, 'p2').hand).toContain(fbi);
    expect(s.turnFlags.noTakeover).toBe(true);
    expect(s.phase).toBe('main');
    checkInvariants(s);
  });
  it('paid by Groups: 6 Power, one sharing an alignment with the Group', () => {
    const { s, card, cia, mafia } = setup();
    expect(() => play(s, 'p1', { card, payWith: [mafia] })).toThrow(/6 Power|share an alignment/);
    expect(() => play(s, 'p1', { card, payWith: [mafia, ill(s, 'p1')] })).toThrow(/Illuminati/);
    expect(() => play(s, 'p1', { card, payWith: [cia] })).not.toThrow(); // Government, 6 Power
  });
});

describe('Seize The Time', () => {
  it('takes a special turn before the interrupted player, without draws or Plots', () => {
    let s = scenario();
    const card = give(s, 'p1', 'seize-the-time', { hand: true });
    const other = give(s, 'p1', 'reorganization', { hand: true });
    s = toP2TurnStart(s);
    expect(s.window?.event?.type).toBe('turnStart');
    const deck = P(s, 'p1').plotDeck.length;
    s = play(s, 'p1', { card });
    s = drain(s);
    expect(s.players[s.active].id).toBe('p1');
    expect(s.turnFlags.extraTurn).toBe(true);
    expect(P(s, 'p1').plotDeck.length).toBe(deck);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
    expect(() => play(s, 'p1', { card: other })).toThrow(/extra turn/);
    // Afterwards the interrupted player's turn begins.
    s = act(s, 'p1', { type: 'endTurn' });
    s = drain(s);
    expect(s.players[s.active].id).toBe('p2');
    expect(s.turnFlags.extraTurn).toBeFalsy();
  });
  it('once per game, never in the first round, never on your own turn', () => {
    let s = scenario();
    const card = give(s, 'p1', 'seize-the-time', { hand: true });
    s = toP2TurnStart(s);
    const used = structuredClone(s);
    used.cards[ill(used, 'p1')].data = { seizedTime: true };
    expect(() => play(used, 'p1', { card })).toThrow(/once per game/);
    const early = structuredClone(s);
    early.round = 1;
    expect(() => play(early, 'p1', { card })).toThrow(/first round/);
    const s2 = scenario();
    const c2 = give(s2, 'p1', 'seize-the-time', { hand: true });
    expect(() => play(s2, 'p1', { card: c2 })).toThrow(/cannot be played right now/);
  });
});

describe('Senate Investigating Committee', () => {
  it('the rival may only draw and place tokens this turn', () => {
    let s = scenario();
    const card = give(s, 'p1', 'senate-investigating-committee', { hand: true });
    const cia = give(s, 'p1', 'c-i-a', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const att = give(s, 'p2', 'the-mafia', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s = toP2TurnStart(s);
    s = play(s, 'p1', { card, payWith: [cia] });
    s = drain(s);
    if (s.prompt?.kind === 'takeover') s = act(s, 'p2', { type: 'skipTakeover' });
    expect(s.players[s.active].id).toBe('p2');
    expect(s.turnFlags.restricted).toBe(true);
    expect(() => act(s, 'p2', { type: 'attack', attackType: 'destroy', attacker: att, target: cia })).toThrow(/only draw/);
    expect(s.cards[ill(s, 'p2')].data?.investigated).toBe(true);
  });
  it('not the Discordians; a second investigation of the same player does nothing; needs Government 5+', () => {
    let s = scenario();
    const card = give(s, 'p1', 'senate-investigating-committee', { hand: true });
    const cia = give(s, 'p1', 'c-i-a', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const fbi = give(s, 'p1', 'fbi', { under: ill(s, 'p1'), side: 'TOP' });
    s = toP2TurnStart(s);
    expect(() => play(s, 'p1', { card, payWith: [fbi] })).toThrow(/Government Group with Power 5/);
    const disc = structuredClone(s);
    disc.cards[ill(disc, 'p2')].cardId = 'discordian-society';
    expect(() => play(disc, 'p1', { card, payWith: [cia] })).toThrow(/Discordians/);
    s.cards[ill(s, 'p2')].data = { investigated: true };
    s = drain(play(s, 'p1', { card, payWith: [cia] }));
    expect(s.turnFlags.restricted).toBeFalsy();
    expect(s.cards[card].zone).toBe('discard');
  });
});

describe('Stealing the Plans', () => {
  it('takes a Plot another player just discarded', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'stealing-the-plans', { hand: true });
    const junk = give(s0, 'p2', 'purge', { hand: true });
    discardCard(s0, junk);
    advance(s0);
    expect(s0.window?.event?.type).toBe('discarded');
    let s = play(s0, 'p1', { card, payWith: [g] });
    s = drain(s);
    expect(P(s, 'p1').hand).toContain(junk);
    expect(P(s, 'p2').discard).not.toContain(junk);
    checkInvariants(s);
  });
  it('not your own discards, and the paying Group needs Power 3', () => {
    const s0 = scenario();
    const weak = give(s0, 'p1', 'druids', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'stealing-the-plans', { hand: true });
    const junk = give(s0, 'p2', 'purge', { hand: true });
    discardCard(s0, junk);
    advance(s0);
    expect(() => play(s0, 'p1', { card, payWith: [weak] })).toThrow(/Power 3/);
    const s1 = scenario();
    const g = give(s1, 'p1', 'loan-sharks', { under: ill(s1, 'p1'), side: 'BOTTOM' });
    const c1 = give(s1, 'p1', 'stealing-the-plans', { hand: true });
    const mine = give(s1, 'p1', 'purge', { hand: true });
    discardCard(s1, mine);
    advance(s1);
    expect(() => play(s1, 'p1', { card: c1, payWith: [g] })).toThrow(/another player/);
  });
});

describe('The Auditor From Hell', () => {
  function setup() {
    const s = scenario();
    const hackers = give(s, 'p1', 'hackers', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const card = give(s, 'p1', 'the-auditor-from-hell', { hand: true });
    const a = give(s, 'p2', 'purge', { hand: true });
    const b = give(s, 'p2', 'reorganization', { hand: true });
    return { s, hackers, card, a, b };
  }
  it('looks at a rival\'s hidden Plots and takes one', () => {
    const { s: s0, hackers, card, a, b } = setup();
    let s = playAndResolve(s0, 'p1', { card, target: ill(s0, 'p2'), payWith: [hackers] });
    expect(s.prompt?.kind).toBe('choose');
    expect(P(s, 'p1').known).toEqual(expect.arrayContaining([a, b]));
    s = act(s, 'p1', { type: 'choose', ids: [b] });
    expect(P(s, 'p1').hand).toContain(b);
    expect(P(s, 'p2').hand).not.toContain(b);
    checkInvariants(s);
  });
  it('or exposes them all; only the Network or a Computer or Bank Group may use it', () => {
    const { s: s0, hackers, card, a, b } = setup();
    const mafia = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'TOP' });
    expect(() => play(s0, 'p1', { card, target: ill(s0, 'p2'), payWith: [mafia] })).toThrow(/Network/);
    let s = playAndResolve(s0, 'p1', { card, target: ill(s0, 'p2'), payWith: [hackers] });
    s = act(s, 'p1', { type: 'choose', ids: ['reveal'] });
    expect(s.cards[a].exposed && s.cards[b].exposed).toBe(true);
    // p1's Illuminati in this scenario is the Network, which may pay too.
    const s1 = setup().s;
    const c1 = Object.keys(s1.cards).find((k) => s1.cards[k].cardId === 'the-auditor-from-hell' && P(s1, 'p1').hand.includes(k))!;
    expect(s1.cards[ill(s1, 'p1')].cardId).toBe('the-network');
    expect(() => play(s1, 'p1', { card: c1, target: ill(s1, 'p2'), payWith: [ill(s1, 'p1')] })).not.toThrow();
  });
});

describe('Unlucky 13', () => {
  it('the rival draws no Plot cards this turn', () => {
    let s = scenario();
    const card = give(s, 'p1', 'unlucky-13', { hand: true });
    const druids = give(s, 'p1', 'druids', { under: ill(s, 'p1'), side: 'BOTTOM' });
    s = toP2TurnStart(s);
    const deck = P(s, 'p2').plotDeck.length;
    s = play(s, 'p1', { card, payWith: [druids] });
    s = drain(s);
    expect(s.players[s.active].id).toBe('p2');
    expect(P(s, 'p2').plotDeck.length).toBe(deck);
    expect(s.turnFlags.noPlotDraws).toContain('p2');
    if (s.prompt?.kind === 'takeover') s = act(s, 'p2', { type: 'skipTakeover' });
    expect(() => act(s, 'p2', { type: 'buyPlot', payWith: [ill(s, 'p2')] })).toThrow(/cannot draw Plot/);
  });
  it('needs a Magic Group, at the start of a rival\'s turn', () => {
    let s = scenario();
    const card = give(s, 'p1', 'unlucky-13', { hand: true });
    const mafia = give(s, 'p1', 'the-mafia', { under: ill(s, 'p1'), side: 'BOTTOM' });
    expect(() => play(s, 'p1', { card, payWith: [mafia] })).toThrow(/cannot be played right now/);
    s = toP2TurnStart(s);
    expect(() => play(s, 'p1', { card, payWith: [mafia] })).toThrow(/Magic/);
  });
});

describe('Unmasked!', () => {
  it('replaces your Illuminati with one from your hand; its Agents in hand are lost', () => {
    const s0 = scenario();
    const old = ill(s0, 'p1');
    const g = give(s0, 'p1', 'loan-sharks', { under: old, side: 'BOTTOM' });
    const neu = give(s0, 'p1', 'gnomes-of-zurich', { hand: true });
    const agents = give(s0, 'p1', 'gnomes-of-zurich', { hand: true });
    const card = give(s0, 'p1', 'unmasked', { hand: true });
    const s = playAndResolve(s0, 'p1', { card, target: neu });
    expect(P(s, 'p1').illuminati).toBe(neu);
    expect(s.cards[neu].zone).toBe('structure');
    expect(s.cards[g].master).toBe(neu);
    expect(s.cards[old].zone).toBe('discard');
    expect(s.cards[agents].zone).toBe('discard');
    checkInvariants(s);
  });
  it('needs an Illuminati card from your hand', () => {
    const s = scenario();
    const grp = give(s, 'p1', 'loan-sharks', { hand: true });
    const card = give(s, 'p1', 'unmasked', { hand: true });
    expect(() => play(s, 'p1', { card, target: grp })).toThrow(/Illuminati card/);
  });
});

describe('Upheaval!', () => {
  it('every player discards a Group of his choice; nobody gets credit', () => {
    const s0 = scenario();
    const a = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const pup = give(s0, 'p1', 'punk-rockers', { under: a, side: 'LEFT' });
    const b = give(s0, 'p2', 'the-mafia', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const c = give(s0, 'p2', 'fbi', { under: ill(s0, 'p2'), side: 'TOP' });
    const card = give(s0, 'p1', 'upheaval', { hand: true });
    let s = playAndResolve(s0, 'p1', { card });
    expect(s.prompt?.player).toBe('p1');
    s = act(s, 'p1', { type: 'choose', ids: [a] });
    expect(s.prompt?.player).toBe('p2');
    expect(() => act(s, 'p2', { type: 'choose', ids: [a] })).toThrow();
    s = act(s, 'p2', { type: 'choose', ids: [c] });
    expect(s.cards[a].zone).toBe('discard');
    expect(s.cards[pup].zone).toBe('hand');
    expect(s.cards[c].zone).toBe('discard');
    expect(s.cards[b].zone).toBe('structure');
    expect(P(s, 'p1').destroyedCredit.length + P(s, 'p2').destroyedCredit.length).toBe(0);
    checkInvariants(s);
  });
  it('costs the Illuminati\'s action and not in the first round', () => {
    const s = scenario();
    const card = give(s, 'p1', 'upheaval', { hand: true });
    s.round = 1;
    expect(() => play(s, 'p1', { card })).toThrow(/first round/);
    s.round = 3;
    s.cards[ill(s, 'p1')].tokens = 0;
    expect(() => play(s, 'p1', { card })).toThrow(/Illuminati/);
  });
});
