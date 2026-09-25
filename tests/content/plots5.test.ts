import { describe, expect, it } from 'vitest';
import {
  applyAction, attackStrength, discardCard, power, alignments, waitingFor, type Action, type GameState, type PlotPlay, type Side,
} from '../../src/engine';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, pl: 'p1' | 'p2') => s.players[pl === 'p1' ? 0 : 1].illuminati;

/** Pass for everyone until the attack is over, forcing the dice if given. */
function resolve(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = applyAction(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** Play a non-attack Plot and let the other player pass so it resolves. */
function playAndResolve(s: GameState, pl: string, play: PlotPlay): GameState {
  s = act(s, pl, { type: 'playPlot', play });
  while (s.window?.kind === 'plot') s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** Put a Group three steps below its Illuminati (no closeness bonus), using filler Groups. */
function deep(s: GameState, pl: 'p1' | 'p2', cardId: string): string {
  const a = give(s, pl, 'punk-rockers', { under: ill(s, pl), side: 'BOTTOM' });
  const b = give(s, pl, 'l-4-society', { under: a, side: 'BOTTOM' });
  return give(s, pl, cardId, { under: b, side: 'BOTTOM' as Side });
}
/** Advance to the roll window of the current attack. */
function toRoll(s: GameState): GameState {
  for (let i = 0; i < 10 && s.window?.kind === 'attack'; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}

describe('Revolution', () => {
  it('+10 against a Nation, +20 against a Dictatorship, paid by a Group not attacking', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const payer = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'TOP' });
    const nation = give(s0, 'p2', 'finland', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const rev = give(s0, 'p1', 'revolution', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: nation, plots: [{ card: rev, payWith: [payer] }] });
    expect(s.attack!.attackBonus.find((b) => b.plot === rev)!.amount).toBe(10);
    expect(s.cards[payer].tokens).toBe(0);
    // Against a Dictatorship.
    const s1 = structuredClone(s0);
    const dict = give(s1, 'p2', 'dictatorship', { hand: true });
    s1.players[1].hand = s1.players[1].hand.filter((x) => x !== dict);
    Object.assign(s1.cards[dict], { zone: 'table', controller: 'p2', linkedTo: nation });
    s = act(s1, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: nation, plots: [{ card: rev, payWith: [payer] }] });
    expect(s.attack!.attackBonus.find((b) => b.plot === rev)!.amount).toBe(20);
  });
  it('the paying Group cannot be the attacker, and the target must be a Nation', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const payer = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'TOP' });
    const nation = give(s0, 'p2', 'finland', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const other = give(s0, 'p2', 'girlie-magazines', { under: ill(s0, 'p2'), side: 'TOP' });
    const rev = give(s0, 'p1', 'revolution', { hand: true });
    s0.cards[att].tokens = 2;
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: nation, plots: [{ card: rev, payWith: [att] }] })).toThrow(/NOT|not be one of/);
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: other, plots: [{ card: rev, payWith: [payer] }] })).toThrow(/Nation/);
  });
});

describe('Rewriting History', () => {
  function setup() {
    const s = scenario();
    const dead = give(s, 'p2', 'loan-sharks', { hand: true });
    s.players[1].hand = [];
    Object.assign(s.cards[dead], { zone: 'destroyed' });
    s.players[0].destroyedCredit.push(dead);
    const card = give(s, 'p1', 'rewriting-history', { hand: true });
    return { s, dead, card };
  }
  it('reverses an alignment of a destroyed Group', () => {
    const { s: s0, dead, card } = setup();
    const s = playAndResolve(s0, 'p1', { card, target: dead, mode: 'reverse', alignment: 'Violent', payWith: [ill(s0, 'p1')] });
    expect(alignments(s, dead).sort()).toEqual(['Criminal', 'Peaceful']);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
  });
  it('removes an alignment; Media payment needs 8 Power; target must be destroyed', () => {
    const { s: s0, dead, card } = setup();
    const media = give(s0, 'p1', 'big-media', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: dead, mode: 'remove', alignment: 'Violent', payWith: [media] } })).toThrow(/8 Power/);
    const alive = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'TOP' });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: alive, mode: 'remove', alignment: 'Violent', payWith: [ill(s0, 'p1')] } })).toThrow(/destroyed/);
    const s = playAndResolve(s0, 'p1', { card, target: dead, mode: 'remove', alignment: 'Violent', payWith: [ill(s0, 'p1')] });
    expect(alignments(s, dead)).toEqual(['Criminal']);
  });
});

describe('Scandal', () => {
  it('removes the tokens of a rival\'s Groups with an alignment of the acting Media Group', () => {
    const s0 = scenario();
    const media = give(s0, 'p1', 'big-media', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const lib = give(s0, 'p2', 'girlie-magazines', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const crim = give(s0, 'p2', 'the-mafia', { under: ill(s0, 'p2'), side: 'TOP' });
    const card = give(s0, 'p1', 'scandal', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, payWith: [media], alignment: 'Criminal' } })).toThrow(/alignment/);
    const s = playAndResolve(s0, 'p1', { card, payWith: [media], alignment: 'Liberal' });
    expect(s.cards[lib].tokens).toBe(0);
    expect(s.cards[crim].tokens).toBe(1);
    expect(s.cards[media].tokens).toBe(0);
  });
  it('cannot be played during an attack or with a Media Group under Power 2', () => {
    const s0 = scenario();
    const media = give(s0, 'p1', 'big-media', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const weak = give(s0, 'p1', 'punk-rockers', { under: ill(s0, 'p1'), side: 'LEFT' });
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'TOP' });
    const tgt = give(s0, 'p2', 'girlie-magazines', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'scandal', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, payWith: [weak], alignment: 'Weird' } })).toThrow(/Power 2/);
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, payWith: [media], alignment: 'Liberal' } })).toThrow(/during an attack/);
  });
});

describe('Self Esteem and The Weird Turn Pro', () => {
  it('Self Esteem: a Liberal Group\'s Power becomes 6, using its action', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'girlie-magazines', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const x = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'TOP' });
    const card = give(s0, 'p1', 'self-esteem', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: x } })).toThrow(/Liberal/);
    const s = playAndResolve(s0, 'p1', { card, target: g });
    expect(power(s, g)).toBe(6);
    expect(s.cards[g].tokens).toBe(0);
    expect(s.cards[card].linkedTo).toBe(g);
  });
  it('The Weird Turn Pro: Power 4, one in play per player', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'tabloids', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const h = give(s0, 'p1', 'punk-rockers', { under: ill(s0, 'p1'), side: 'TOP' });
    const a = give(s0, 'p1', 'the-weird-turn-pro', { hand: true });
    const b = give(s0, 'p1', 'the-weird-turn-pro', { hand: true });
    const s = playAndResolve(s0, 'p1', { card: a, target: g });
    expect(power(s, g)).toBe(4);
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: b, target: h } })).toThrow(/only have one/);
  });
  it('only ever raises Power: a stronger Group keeps its Power', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'california', { under: ill(s0, 'p1'), side: 'BOTTOM' }); // Weird, Power 5
    const before = power(s0, g);
    expect(before).toBe(5);
    const card = give(s0, 'p1', 'the-weird-turn-pro', { hand: true });
    const s = playAndResolve(s0, 'p1', { card, target: g });
    expect(power(s, g)).toBe(before);
  });
  it('uses the target\'s own action, so the Group must be yours', () => {
    const s0 = scenario();
    const theirs = give(s0, 'p2', 'girlie-magazines', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'self-esteem', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: theirs } })).toThrow(/you control/);
  });
});

describe('Spasm of Violence', () => {
  it('adds the Power of a second Assassination from hand', () => {
    const s0 = scenario();
    const tgt = give(s0, 'p2', 'bill-clinton', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const sniper = give(s0, 'p1', 'sniper', { hand: true });
    const poison = give(s0, 'p1', 'poison', { hand: true });
    const spasm = give(s0, 'p1', 'spasm-of-violence', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card: spasm } })).toThrow();
    let s = act(s0, 'p1', { type: 'playPlot', play: { card: sniper, target: tgt } });
    const before = attackStrength(s, s.attack!).attack;
    s = act(s, 'p1', { type: 'playPlot', play: { card: spasm, target: poison } });
    expect(attackStrength(s, s.attack!).attack - before).toBe(8);
    expect(s.cards[poison].zone).toBe('discard');
  });
  it('needs a second Assassination card', () => {
    const s0 = scenario();
    const tgt = give(s0, 'p2', 'bill-clinton', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const sniper = give(s0, 'p1', 'sniper', { hand: true });
    const spasm = give(s0, 'p1', 'spasm-of-violence', { hand: true });
    const s = act(s0, 'p1', { type: 'playPlot', play: { card: sniper, target: tgt } });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: spasm } })).toThrow(/second Assassination/);
  });
});

describe('Sucked Dry and Cast Aside', () => {
  it('x4 Power for the action, then the Group is destroyed without Goal credit', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const tgt = deep(s0, 'p2', 'girlie-magazines');
    const card = give(s0, 'p1', 'sucked-dry-and-cast-aside', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt, plots: [{ card, target: att }] });
    expect(s.attack!.attackBonus.find((b) => b.plot === card)!.amount).toBe(18);
    s = resolve(s, [2, 2]);
    expect(s.cards[tgt].zone).toBe('destroyed');
    expect(s.cards[att].zone).toBe('destroyed');
    expect(s.players[0].destroyedCredit).toContain(tgt);
    expect(s.players.some((p) => p.destroyedCredit.includes(att))).toBe(false);
    expect(s.cards[card].zone).toBe('discard');
  });
  it('not on the Illuminati, and only with an action', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'girlie-magazines', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'sucked-dry-and-cast-aside', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: att } })).toThrow(/cannot be played/);
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: ill(s0, 'p1'), target: tgt, plots: [{ card, target: ill(s0, 'p1') }] })).toThrow(/not your Illuminati/);
  });
});

describe('Sweeping Reforms', () => {
  it('discards every NWO, paid by Media Groups with 6+ Power', () => {
    const s0 = scenario();
    const a = give(s0, 'p2', 'law-and-order', { hand: true });
    const b = give(s0, 'p1', 'solidarity', { hand: true });
    s0.players[1].hand = []; s0.players[0].hand = [];
    Object.assign(s0.cards[a], { zone: 'table', controller: 'p2', linkedTo: 'nwo' });
    Object.assign(s0.cards[b], { zone: 'table', controller: 'p1', linkedTo: 'nwo' });
    s0.nwo = { yellow: a, red: b };
    const m1 = give(s0, 'p1', 'big-media', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const m2 = give(s0, 'p1', 'cable-tv', { under: ill(s0, 'p1'), side: 'TOP' });
    const card = give(s0, 'p1', 'sweeping-reforms', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, payWith: [m2] } })).toThrow(/6 Power/);
    const s = playAndResolve(s0, 'p1', { card, payWith: [m1, m2] });
    expect(Object.values(s.nwo).filter(Boolean)).toEqual([]);
    expect(s.cards[a].zone).toBe('discard');
    expect(s.cards[b].zone).toBe('discard');
  });
});

describe('Sweepstakes Prize', () => {
  it('+4 on direct Attacks to Control by the linked Personality', () => {
    const s0 = scenario();
    const p = give(s0, 'p1', 'bill-clinton', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const x = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'TOP' });
    const tgt = give(s0, 'p2', 'girlie-magazines', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'sweepstakes-prize', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: x } })).toThrow(/Personalities/);
    let s = playAndResolve(s0, 'p1', { card, target: p });
    expect(s.cards[card].linkedTo).toBe(p);
    s = act(s, 'p1', { type: 'attack', attackType: 'control', attacker: p, target: tgt });
    expect(attackStrength(s, s.attack!).lines).toContain('Attack +4: Sweepstakes Prize');
    const s2 = act(playAndResolve(s0, 'p1', { card, target: p }), 'p1', { type: 'attack', attackType: 'destroy', attacker: p, target: tgt });
    expect(attackStrength(s2, s2.attack!).lines).not.toContain('Attack +4: Sweepstakes Prize');
  });
});

describe('Talisman of Ahrimanes', () => {
  it('the Assassination fails and the Talisman protects the Personality afterwards', () => {
    const s0 = scenario();
    const tgt = give(s0, 'p2', 'bill-clinton', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const sniper = give(s0, 'p1', 'sniper', { hand: true });
    const tal = give(s0, 'p2', 'talisman-of-ahrimanes', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card: sniper, target: tgt } });
    s = act(s, 'p2', { type: 'playPlot', play: { card: tal } });
    s = resolve(s, [2, 2]);
    expect(s.cards[tgt].zone).toBe('structure');
    expect(s.cards[tal].zone).toBe('table');
    expect(s.cards[tal].linkedTo).toBe(tgt);
    const att = give(s, 'p1', 'the-mafia', { under: ill(s, 'p1'), side: 'BOTTOM' });
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    expect(attackStrength(s, s.attack!).lines).toContain('Defense +2: Talisman of Ahrimanes');
  });
  it('only after an Assassination', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'bill-clinton', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const tal = give(s0, 'p2', 'talisman-of-ahrimanes', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card: tal } })).toThrow(/Assassination/);
  });
});

describe('The Big Sellout', () => {
  it('discarded Groups give one extra token each to different Groups', () => {
    const s0 = scenario();
    const a = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const b = give(s0, 'p1', 'hollywood', { under: ill(s0, 'p1'), side: 'TOP' });
    const c = give(s0, 'p1', 'girlie-magazines', { under: ill(s0, 'p1'), side: 'LEFT' });
    const g1 = give(s0, 'p1', 'loan-sharks', { hand: true });
    const g2 = give(s0, 'p1', 'lawyers', { hand: true });
    const r = give(s0, 'p1', 'crystal-skull', { hand: true });
    const card = give(s0, 'p1', 'the-big-sellout', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, payWith: [g1], mode: '0', targets: [a, a] } })).toThrow(/more than one/);
    const s = playAndResolve(s0, 'p1', { card, payWith: [g1, g2, r], mode: '0', targets: [a, b, c] });
    expect([s.cards[a].tokens, s.cards[b].tokens, s.cards[c].tokens]).toEqual([2, 2, 1]);
    expect(s.cards[g1].zone).toBe('discard');
    expect(s.cards[r].zone).toBe('discard');
  });
  it('only right after placing Action tokens', () => {
    const s0 = scenario();
    const a = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const g1 = give(s0, 'p1', 'loan-sharks', { hand: true });
    const card = give(s0, 'p1', 'the-big-sellout', { hand: true });
    const s = act(s0, 'p1', { type: 'drawGroup' });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, payWith: [g1], mode: '0', targets: [a] } })).toThrow(/right after/);
  });
});

describe('The First Thing We Do, Let\'s Kill All The Lawyers', () => {
  it('+20 to an Attack to Destroy the Lawyers only', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const law = give(s0, 'p2', 'lawyers', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'the-first-thing-we-do-let-s-kill-all-the-lawyers', { hand: true });
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: law, plots: [{ card }] })).toThrow(/Destroy the Lawyers/);
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: law, plots: [{ card }] });
    expect(s.attack!.attackBonus.find((b) => b.plot === card)!.amount).toBe(20);
  });
});

describe('The Internet Worm', () => {
  it('discards the top three cards of a rival\'s Plot deck', () => {
    const s0 = scenario();
    const hk = give(s0, 'p1', 'hackers', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const pp = give(s0, 'p1', 'phone-phreaks', { under: ill(s0, 'p1'), side: 'TOP' });
    const card = give(s0, 'p1', 'the-internet-worm', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, payWith: [pp] } })).toThrow(/3 Power/);
    const top = s0.players[1].plotDeck.slice(0, 3);
    const s = playAndResolve(s0, 'p1', { card, payWith: [hk] });
    expect(s.players[1].plotDeck.length).toBe(s0.players[1].plotDeck.length - 3);
    for (const c of top) expect(s.cards[c].zone).toBe('discard');
  });
});

describe('The Oregon Crud', () => {
  it('is a Power 24 Disaster that Devastates, destroying on a margin of 10+', () => {
    const s0 = scenario();
    const place = give(s0, 'p2', 'hollywood', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'the-oregon-crud', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card, target: place } });
    expect(s.attack!.instantPower).toBe(24);
    expect(s.attack!.disaster!.destroyMargin).toBe(10);
    const strength = attackStrength(s, s.attack!).strength;
    const r = strength - 9; // succeeds by 9: Devastated only
    s = resolve(s, [Math.ceil(r / 2), Math.floor(r / 2)]);
    expect(s.cards[place].zone).toBe('structure');
    expect(s.cards[place].devastated).toBe(true);
  });
  it('cannot strike a Huge Place', () => {
    const s0 = scenario();
    const huge = give(s0, 'p2', 'california', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'the-oregon-crud', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: huge } })).toThrow(/Huge/);
  });
});

describe('The Second Bullet', () => {
  function setup() {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const helper = give(s0, 'p1', 'nuclear-power-companies', { under: ill(s0, 'p1'), side: 'TOP' });
    const useless = give(s0, 'p1', 'punk-rockers', { under: ill(s0, 'p1'), side: 'LEFT' });
    const tgt = deep(s0, 'p2', 'girlie-magazines');
    const card = give(s0, 'p1', 'the-second-bullet', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    s = toRoll(s);
    const st = attackStrength(s, s.attack!).strength;
    s.attack!.roll = [Math.min(6, st + 2 - 1), st + 2 - Math.min(6, st + 2 - 1)]; // fails by 2
    return { s, helper, useless, tgt, card, st };
  }
  it('Groups that could have aided add Power to turn the failure into a success', () => {
    const { s: s0, helper, tgt, card, st } = setup();
    expect(st + 2).toBeLessThanOrEqual(10);
    let s = act(s0, 'p1', { type: 'playPlot', play: { card, payWith: [helper] } });
    expect(s.cards[helper].tokens).toBe(0);
    s = resolve(s);
    expect(s.cards[tgt].zone).toBe('destroyed');
  });
  it('the Groups must have been able to aid and must add enough', () => {
    const { s, useless, card } = setup();
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, payWith: [useless] } })).toThrow(/could not have aided/);
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card, payWith: [useless] } })).toThrow();
  });
});

describe('The Stars Are Right', () => {
  it('brings a Resource from hand into play for an Illuminati action', () => {
    const s0 = scenario();
    const r = give(s0, 'p1', 'crystal-skull', { hand: true });
    const witch = give(s0, 'p1', 'w-i-t-c-h', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'the-stars-are-right', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: r, payWith: [witch] } })).toThrow(/Power 4/);
    const s = playAndResolve(s0, 'p1', { card, target: r, payWith: [ill(s0, 'p1')] });
    expect(s.cards[r].zone).toBe('resources');
    expect(s.cards[r].controller).toBe('p1');
  });
});

describe('The Weak Link', () => {
  it('destroys a rival\'s Artifact or Gadget Resource', () => {
    const s0 = scenario();
    const skull = give(s0, 'p2', 'crystal-skull', { resource: true });
    const foot = give(s0, 'p2', 'bigfoot', { resource: true });
    const card = give(s0, 'p1', 'the-weak-link', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: foot, payWith: [ill(s0, 'p1')] } })).toThrow(/Artifact or Gadget/);
    const pp = give(s0, 'p1', 'phone-phreaks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: skull, payWith: [pp] } })).toThrow(/6 Power/);
    const s = playAndResolve(s0, 'p1', { card, target: skull, payWith: [ill(s0, 'p1')] });
    expect(s.cards[skull].zone).toBe('discard');
    expect(s.cards[foot].zone).toBe('resources');
  });
});

describe('Time Warp', () => {
  it('forces another player to re-roll a successful roll; he draws a Group', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const tgt = deep(s0, 'p2', 'girlie-magazines');
    const tw = give(s0, 'p2', 'time-warp', { hand: true });
    const mine = give(s0, 'p1', 'time-warp', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    s = toRoll(s);
    s.attack!.roll = [1, 1];
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: mine } })).toThrow(/another player/);
    const hand = s.players[0].hand.length;
    s = act(s, 'p2', { type: 'playPlot', play: { card: tw } });
    expect(s.attack!.plays.find((p) => p.iid === tw)!.effect.t).toBe('reroll');
    expect(s.players[0].hand.length).toBe(hand + 1);
  });
});

describe('Volunteer Aid', () => {
  it('+6 against a Disaster, and Relief at the start of the owner\'s next turn', () => {
    const s0 = scenario();
    const place = deep(s0, 'p2', 'hollywood');
    const tornado = give(s0, 'p1', 'tornado', { hand: true });
    const va = give(s0, 'p2', 'volunteer-aid', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card: tornado, target: place } });
    const before = attackStrength(s, s.attack!).defense;
    s = act(s, 'p2', { type: 'playPlot', play: { card: va } });
    expect(attackStrength(s, s.attack!).defense - before).toBe(6);
    s = resolve(s, [1, 1]);
    expect(s.cards[place].devastated).toBe(true);
    expect(s.cards[va].zone).toBe('table');
    s = act(s, 'p1', { type: 'endTurn' });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.cards[place].devastated).toBeFalsy();
    expect(s.cards[va].zone).toBe('discard');
  });
  it('only against a Disaster', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const place = give(s0, 'p2', 'hollywood', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const va = give(s0, 'p2', 'volunteer-aid', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: place });
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card: va } })).toThrow(/Disaster/);
  });
});

describe('Voodoo Economics', () => {
  it('removes top Plots from the game for extra tokens; Illuminati action; once per game', () => {
    const s0 = scenario();
    const a = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const b = give(s0, 'p1', 'hollywood', { under: ill(s0, 'p1'), side: 'TOP' });
    const card = give(s0, 'p1', 'voodoo-economics', { hand: true });
    const again = give(s0, 'p1', 'voodoo-economics', { hand: true });
    const top = s0.players[0].plotDeck.slice(0, 2);
    let s = playAndResolve(s0, 'p1', { card, mode: '2', targets: [a, b] });
    expect(s.players[0].plotDeck.length).toBe(s0.players[0].plotDeck.length - 2);
    for (const c of top) expect(s.cards[c].zone).toBe('destroyed');
    expect([s.cards[a].tokens, s.cards[b].tokens]).toEqual([2, 2]);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
    s.cards[ill(s, 'p1')].tokens = 1;
    s.log.push({ turn: s.turn, player: 'p1', text: '— Turn test —' });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: again, mode: '1', targets: [a] } })).toThrow(/once per game/);
  });
});

describe('Vultures', () => {
  it('takes a Group a rival failed to take over from hand, once he has discarded it', () => {
    const s0 = scenario();
    const g = give(s0, 'p2', 'loan-sharks', { hand: true });
    const card = give(s0, 'p1', 'vultures', { hand: true });
    s0.cards[g].failedTakeoverTurn = s0.turn;
    // Still in his hand: he may retry until the end of his turn.
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: g } })).toThrow(/discarded/);
    discardCard(s0, g);
    const s = playAndResolve(s0, 'p1', { card, target: g });
    expect(s.players[0].hand).toContain(g);
    expect(s.players[1].discard).not.toContain(g);
    expect(s.cards[g].zone).toBe('hand');
    expect(s.cards[g].failedTakeoverTurn).toBeUndefined();
  });
  it('not a Group that was simply discarded', () => {
    const s0 = scenario();
    const g = give(s0, 'p2', 'loan-sharks', { hand: true });
    const card = give(s0, 'p1', 'vultures', { hand: true });
    discardCard(s0, g);
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: g } })).toThrow(/failed/);
  });
});

describe('Withering Curse', () => {
  it('Power 10 Assassination; only a Magic Group may join', () => {
    const s0 = scenario();
    const tgt = give(s0, 'p2', 'bill-clinton', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const witch = give(s0, 'p1', 'w-i-t-c-h', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const mafia = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'TOP' });
    const card = give(s0, 'p1', 'withering-curse', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: tgt, helper: mafia } })).toThrow(/Magic/);
    const s = act(s0, 'p1', { type: 'playPlot', play: { card, target: tgt, helper: witch } });
    expect(s.attack!.instantPower).toBe(10);
    expect(s.attack!.assassination).toBe(true);
    expect(s.attack!.aid.map((a) => a.iid)).toEqual([witch]);
  });
});

describe('audit fixes: one-per-player limits', () => {
  it('Self-Esteem: no player may have two in play', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'girlie-magazines', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const h = give(s0, 'p1', 'underground-newspapers', { under: ill(s0, 'p1'), side: 'TOP' });
    const a = give(s0, 'p1', 'self-esteem', { hand: true });
    const b = give(s0, 'p1', 'self-esteem', { hand: true });
    const s = playAndResolve(s0, 'p1', { card: a, target: g });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: b, target: h } })).toThrow(/only have one/);
  });
  it('Sweepstakes Prize: no player may have two in play', () => {
    const s0 = scenario();
    const p = give(s0, 'p1', 'bill-clinton', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const q = give(s0, 'p1', 'dan-quayle', { under: ill(s0, 'p1'), side: 'TOP' });
    const a = give(s0, 'p1', 'sweepstakes-prize', { hand: true });
    const b = give(s0, 'p1', 'sweepstakes-prize', { hand: true });
    const s = playAndResolve(s0, 'p1', { card: a, target: p });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: b, target: q } })).toThrow(/only one/);
    // Another player may still have one of their own.
    const r = give(s, 'p2', 'ronald-reagan', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const c = give(s, 'p2', 'sweepstakes-prize', { hand: true });
    s.active = 1;
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card: c, target: r } })).not.toThrow();
  });
  it('Talisman of Ahrimanes: only one in play at a time', () => {
    const s0 = scenario();
    const first = give(s0, 'p2', 'bill-clinton', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const old = give(s0, 'p2', 'talisman-of-ahrimanes', { hand: true });
    s0.players[1].hand = s0.players[1].hand.filter((x) => x !== old);
    Object.assign(s0.cards[old], { zone: 'table', controller: 'p2', linkedTo: first });
    const tgt = give(s0, 'p2', 'dan-quayle', { under: ill(s0, 'p2'), side: 'TOP' });
    const sniper = give(s0, 'p1', 'sniper', { hand: true });
    const tal = give(s0, 'p2', 'talisman-of-ahrimanes', { hand: true });
    const s = act(s0, 'p1', { type: 'playPlot', play: { card: sniper, target: tgt } });
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card: tal } })).toThrow(/only one/);
  });
});

describe('Sweeping Reforms (audit fix): Media Groups of several players', () => {
  function setup() {
    const s0 = scenario();
    const a = give(s0, 'p2', 'law-and-order', { hand: true });
    s0.players[1].hand = [];
    Object.assign(s0.cards[a], { zone: 'table', controller: 'p2', linkedTo: 'nwo' });
    s0.nwo = { yellow: a };
    const mine = give(s0, 'p1', 'cable-tv', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const theirs = give(s0, 'p2', 'big-media', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'sweeping-reforms', { hand: true });
    return { s0, a, mine, theirs, card };
  }
  it('another player\'s Media Group may pay if that player agrees', () => {
    const { s0, a, mine, theirs, card } = setup();
    let s = playAndResolve(s0, 'p1', { card, payWith: [mine, theirs] });
    expect(s.prompt?.player).toBe('p2');
    s = act(s, 'p2', { type: 'choose', ids: ['yes'] });
    expect(s.cards[a].zone).toBe('discard');
    expect(s.cards[theirs].tokens).toBe(0);
    expect(s.cards[mine].tokens).toBe(0);
  });
  it('if that player refuses, nothing happens and his Group keeps its token', () => {
    const { s0, a, mine, theirs, card } = setup();
    let s = playAndResolve(s0, 'p1', { card, payWith: [mine, theirs] });
    s = act(s, 'p2', { type: 'choose', ids: ['no'] });
    expect(s.cards[a].zone).toBe('table');
    expect(s.cards[theirs].tokens).toBe(1);
  });
});
