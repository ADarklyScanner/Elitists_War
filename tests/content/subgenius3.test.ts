import { describe, expect, it } from 'vitest';
import {
  applyAction, alignments, attackCancelled, attributes, cardImplemented, finalRoll, globalPower, power,
  resistance, waitingFor, type Action, type GameState, type PlotPlay,
} from '../../src/engine';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, pl: 'p1' | 'p2') => s.players[pl === 'p1' ? 0 : 1].illuminati;

/** Play a non-attack Plot and let the other player pass so it resolves. */
function playAndResolve(s: GameState, pl: string, play: PlotPlay): GameState {
  s = act(s, pl, { type: 'playPlot', play });
  while (s.window?.kind === 'plot') s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** Advance an attack past the declare window, to (and past) the roll window, forcing the dice. */
function toRoll(s: GameState): GameState {
  for (let i = 0; i < 10 && s.window?.kind === 'attack'; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
function resolveAttack(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
const CARDS_IN_BATCH = [
  'or-kill-me', '13013', 'anti-slack', 'attitude-mutation', 'bulldada', 'comet-hail-bob', 'decency-is-ok',
  'devival', 'eternal-salvation-or-triple-your-money-back', 'excremeditation', 'fake-healing',
  'false-overman', 'false-slack', 'give-me-slack-or-give-me-food', 'head-launching', 'inherently-bogus',
  'jhvh-1', 'kill-bob', 'luck-plane', 'mediocretinism', 'miraculous-manifestation', 'more-slack',
  'nental-ife', 'official-all-inclusive-divine-excuse',
];

describe('subgenius3 batch', () => {
  it('every card in the batch is implemented', () => {
    for (const id of CARDS_IN_BATCH) expect(cardImplemented(id)).toBe(true);
  });
});

describe('. . . Or Kill Me!', () => {
  it('a rival must give Slack or discard a Group, and the caster is then restricted to defense', () => {
    const s0 = scenario();
    s0.cards[ill(s0, 'p1')].tokens = 0;
    s0.cards[ill(s0, 'p2')].tokens = 2;
    const rivalGroup = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'or-kill-me', { hand: true });
    let s = playAndResolve(s0, 'p1', { card, target: ill(s0, 'p2') });
    expect(s.prompt?.kind).toBe('choose');
    expect(s.prompt!.player).toBe('p2');
    s = act(s, 'p2', { type: 'choose', ids: ['give'] });
    expect(s.cards[ill(s, 'p2')].tokens).toBe(1);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(1);
    expect(s.cards[rivalGroup].zone).toBe('structure');
    // The caster cannot take a further action or free move this turn, other than defending.
    const other = give(s, 'p1', 'loan-sharks', { under: ill(s, 'p1'), side: 'TOP' });
    s.cards[other].tokens = 1;
    expect(() => act(s, 'p1', { type: 'move', group: other, onto: ill(s, 'p1'), side: 'BOTTOM', payWith: other })).toThrow(/Or Kill Me/);
  });
  it('the choice may instead discard a rival Group', () => {
    const s0 = scenario();
    s0.cards[ill(s0, 'p1')].tokens = 0;
    s0.cards[ill(s0, 'p2')].tokens = 2;
    const rivalGroup = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'or-kill-me', { hand: true });
    let s = playAndResolve(s0, 'p1', { card, target: ill(s0, 'p2') });
    s = act(s, 'p2', { type: 'choose', ids: [`discard:${rivalGroup}`] });
    expect(s.cards[rivalGroup].zone).toBe('discard');
    expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
  });
  it('cannot be played while your Illuminati still has Slack', () => {
    const s0 = scenario();
    const rival = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'or-kill-me', { hand: true });
    void rival;
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: ill(s0, 'p2') } })).toThrow(/no Slack/);
  });
});

describe('13013', () => {
  it('raises a SubGenius Group to Power 6, using its own action, and links to it', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'drs-for-bob', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    s0.cards[g].tokens = 1;
    const card = give(s0, 'p1', '13013', { hand: true });
    const s = playAndResolve(s0, 'p1', { card, target: g, payWith: [g] });
    expect(power(s, g)).toBe(6);
    expect(s.cards[g].tokens).toBe(0);
    expect(s.cards[card].linkedTo).toBe(g);
  });
  it('needs a SubGenius Group with an available action, and only one may be in play per player', () => {
    const s0 = scenario();
    const notSubGenius = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    s0.cards[notSubGenius].tokens = 1;
    const card = give(s0, 'p1', '13013', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: notSubGenius, payWith: [notSubGenius] } })).toThrow(/SubGenius/);
    const g1 = give(s0, 'p1', 'drs-for-bob', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    s0.cards[g1].tokens = 1;
    const s = playAndResolve(s0, 'p1', { card, target: g1, payWith: [g1] });
    const g2 = give(s, 'p1', 'dobbstown', { under: ill(s, 'p1'), side: 'TOP' });
    s.cards[g2].tokens = 1;
    const card2 = give(s, 'p1', '13013', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: card2, target: g2, payWith: [g2] } })).toThrow(/one 13013/);
  });
});

describe('Anti-Slack', () => {
  it('removes one Slack from a rival with two or more', () => {
    const s0 = scenario();
    s0.cards[ill(s0, 'p2')].tokens = 2;
    const card = give(s0, 'p1', 'anti-slack', { hand: true });
    const s = playAndResolve(s0, 'p1', { card, target: ill(s0, 'p2') });
    expect(s.cards[ill(s, 'p2')].tokens).toBe(1);
  });
  it('needs at least two Slack, and only one Anti-Slack may hit a player per turn', () => {
    const s0 = scenario();
    s0.cards[ill(s0, 'p2')].tokens = 1;
    const card = give(s0, 'p1', 'anti-slack', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: ill(s0, 'p2') } })).toThrow(/two/);
    s0.cards[ill(s0, 'p2')].tokens = 3;
    let s = playAndResolve(s0, 'p1', { card, target: ill(s0, 'p2') });
    const card2 = give(s, 'p1', 'anti-slack', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: card2, target: ill(s, 'p2') } })).toThrow(/already/);
  });
});

describe('Attitude Mutation', () => {
  it('is free on a Group the Illuminati controls directly, and lasts only until end of turn', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'drs-for-bob', { under: ill(s0, 'p1'), side: 'BOTTOM' }); // Weird
    const card = give(s0, 'p1', 'attitude-mutation', { hand: true });
    let s = playAndResolve(s0, 'p1', { card, target: g, mode: 'add', alignment: 'Straight' });
    expect(alignments(s, g)).toContain('Straight');
    expect(alignments(s, g)).not.toContain('Weird'); // opposite is dropped
    s.cards[g].mods = s.cards[g].mods.filter((m) => m.until !== 'endOfTurn');
    expect(alignments(s, g)).not.toContain('Straight');
  });
  it('costs its master\'s action when not directly controlled, and only one per turn', () => {
    const s0 = scenario();
    const master = give(s0, 'p1', 'drs-for-bob', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const g = give(s0, 'p1', 'dobbstown', { under: master, side: 'TOP' });
    s0.cards[master].tokens = 0;
    const card = give(s0, 'p1', 'attitude-mutation', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: g, mode: 'add', alignment: 'Straight' } })).toThrow(/master/);
    s0.cards[master].tokens = 1;
    let s = playAndResolve(s0, 'p1', { card, target: g, mode: 'add', alignment: 'Straight' });
    expect(s.cards[master].tokens).toBe(0);
    const card2 = give(s, 'p1', 'attitude-mutation', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: card2, target: g, mode: 'remove', alignment: 'Straight' } })).toThrow(/one Attitude Mutation/);
  });
});

describe('Bulldada', () => {
  // A forced 12 is an automatic failure (11 or 12 always fails, however strong the attack): Bulldada
  // sabotages an attack (anyone's) rather than helping it.
  it('changes the just-rolled dice to 12, discarding three other Plots, dooming the attack', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'bulldada', { hand: true });
    const d1 = give(s0, 'p1', 'bulldada', { hand: true });
    const d2 = give(s0, 'p1', 'bulldada', { hand: true });
    const d3 = give(s0, 'p1', 'bulldada', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    s.attack!.strengthLock = { attack: 20, defense: 0, by: 'test-lock' };
    s = toRoll(s);
    s.attack!.roll = [1, 1]; // would succeed
    s = act(s, 'p1', { type: 'playPlot', play: { card, discards: [d1, d2, d3] } });
    expect(finalRoll(s.attack!)).toBe(12);
    expect(s.players[0].hand).not.toContain(d1);
    s = resolveAttack(s);
    expect(s.cards[tgt].zone).toBe('structure'); // 11 or 12 is always an automatic failure
  });
});

describe('Comet Hail-"Bob"', () => {
  it('destroys a Group a rival just took over automatically, without Goal credit, once per game', () => {
    const s0 = scenario();
    s0.common = undefined;
    const card = give(s0, 'p1', 'comet-hail-bob', { hand: true });
    s0.cards[ill(s0, 'p1')].tokens = 1;
    // Simulate the takeover response window that doTakeover() opens.
    const taken = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    s0.window = { kind: 'event', event: { type: 'takeover', player: 'p2', card: taken }, passed: [], deadline: Date.now() + 1000 };
    let s = playAndResolve(s0, 'p1', { card, target: taken, payWith: [ill(s0, 'p1')] });
    expect(s.cards[taken].zone).toBe('destroyed');
    expect(s.players[0].destroyedCredit).not.toContain(taken);
  });
});

describe('Decency is OK!', () => {
  it('cancels an attack by a rival\'s Weird Group', () => {
    const s0 = scenario();
    s0.active = 1; // p2's turn, so p2 may declare the attack
    const att = give(s0, 'p2', 'drs-for-bob', { under: ill(s0, 'p2'), side: 'BOTTOM' }); // Weird
    const tgt = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'decency-is-ok', { hand: true });
    let s = act(s0, 'p2', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    s = act(s, 'p1', { type: 'playPlot', play: { card, target: att } });
    expect(attackCancelled(s.attack!)).toBe(true);
  });
});

describe('Devival', () => {
  it('gives +10 Power when declared on a SubGenius attacker', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'drs-for-bob', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'devival', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt, plots: [{ card, target: att, mode: 'power' }] });
    expect(s.attack!.attackBonus.find((b) => b.plot === card)!.amount).toBe(10);
  });
  it('is refused on a non-SubGenius Group', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'devival', { hand: true });
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt, plots: [{ card, target: att, mode: 'power' }] })).toThrow(/SubGenius/);
  });
});

describe('Eternal Salvation or Triple your Money Back', () => {
  it('draws Plots up to a hand of 5, using a SubGenius Group\'s action, once per game', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'drs-for-bob', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    s0.cards[g].tokens = 1;
    const card = give(s0, 'p1', 'eternal-salvation-or-triple-your-money-back', { hand: true });
    let s = playAndResolve(s0, 'p1', { card, payWith: [g] });
    expect(s.players[0].hand.length).toBe(5);
    expect(s.cards[g].tokens).toBe(0);
    const card2 = give(s, 'p1', 'eternal-salvation-or-triple-your-money-back', { hand: true });
    const g2 = give(s, 'p1', 'dobbstown', { under: ill(s, 'p1'), side: 'TOP' });
    s.cards[g2].tokens = 1;
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: card2, payWith: [g2] } })).toThrow(/once per game/);
  });
});

describe('Excremeditation', () => {
  it('gives a token to a single SubGenius Group of any Power', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'jesus-b', { under: ill(s0, 'p1'), side: 'BOTTOM' }); // Power 3
    s0.cards[g].tokens = 0;
    const card = give(s0, 'p1', 'excremeditation', { hand: true });
    const s = playAndResolve(s0, 'p1', { card, targets: [g], payWith: [ill(s0, 'p1')] });
    expect(s.cards[g].tokens).toBe(1);
  });
  it('several Groups together may add up to only 5 Power', () => {
    const s0 = scenario();
    const a = give(s0, 'p1', 'jesus-b', { under: ill(s0, 'p1'), side: 'BOTTOM' }); // 3
    const b = give(s0, 'p1', 'drs-for-bob', { under: ill(s0, 'p1'), side: 'TOP' }); // 2
    s0.cards[a].tokens = 0; s0.cards[b].tokens = 0;
    const card = give(s0, 'p1', 'excremeditation', { hand: true });
    let s = playAndResolve(s0, 'p1', { card, targets: [a, b], payWith: [ill(s0, 'p1')] });
    expect(s.cards[a].tokens).toBe(1);
    expect(s.cards[b].tokens).toBe(1);
    const c = give(s, 'p1', 'dr-k-taden-legume', { under: ill(s, 'p1'), side: 'LEFT' }); // 2, total would be 7
    s.cards[a].tokens = 0; s.cards[b].tokens = 0; s.cards[c].tokens = 0;
    s.cards[ill(s, 'p1')].tokens = 1;
    const card2 = give(s, 'p1', 'excremeditation', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: card2, targets: [a, b, c], payWith: [ill(s, 'p1')] } })).toThrow(/5 Power/);
  });
});

describe('Fake Healing', () => {
  it('drops a hand Group\'s Resistance to 0 until end of turn, only on your own turn', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'loan-sharks', { hand: true });
    const card = give(s0, 'p1', 'fake-healing', { hand: true });
    let s = playAndResolve(s0, 'p1', { card, target: g });
    expect(resistance(s, g)).toBe(0);
  });
  it('cannot be played outside your own main phase', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'loan-sharks', { hand: true });
    const card = give(s0, 'p1', 'fake-healing', { hand: true });
    expect(() => act(s0, 'p2', { type: 'playPlot', play: { card, target: g } })).toThrow(/not in your hand|your own main phase/);
  });
});

describe('False Overman', () => {
  it('sets Power to 3 and makes the Personality Violent and Straight', () => {
    const s0 = scenario();
    const t = give(s0, 'p2', 'jesus-b', { under: ill(s0, 'p2'), side: 'BOTTOM' }); // Weird, Corporate
    const card = give(s0, 'p1', 'false-overman', { hand: true });
    const s = playAndResolve(s0, 'p1', { card, target: t });
    expect(power(s, t)).toBe(3);
    expect(alignments(s, t)).toContain('Violent');
    expect(alignments(s, t)).toContain('Straight');
    expect(alignments(s, t)).not.toContain('Weird');
  });
  it('cannot affect someone already made an OverMan', () => {
    const s0 = scenario();
    const t = give(s0, 'p2', 'jesus-b', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const overman = give(s0, 'p2', 'overman', { hand: true });
    s0.players[1].hand = [];
    Object.assign(s0.cards[overman], { zone: 'table', controller: 'p2', linkedTo: t });
    const card = give(s0, 'p1', 'false-overman', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: t } })).toThrow(/OverMan/);
  });
});

describe('False Slack', () => {
  it('empties a rival Group\'s tokens and its puppets\'', () => {
    const s0 = scenario();
    const master = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const puppet = give(s0, 'p2', 'the-mafia', { under: master, side: 'TOP' });
    s0.cards[master].tokens = 1; s0.cards[puppet].tokens = 1;
    const card = give(s0, 'p1', 'false-slack', { hand: true });
    const s = playAndResolve(s0, 'p1', { card, target: master, payWith: [ill(s0, 'p1')] });
    expect(s.cards[master].tokens).toBe(0);
    expect(s.cards[puppet].tokens).toBe(0);
  });
  it('cannot hit the same victim twice in a turn', () => {
    const s0 = scenario();
    const master = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'false-slack', { hand: true });
    let s = playAndResolve(s0, 'p1', { card, target: master, payWith: [ill(s0, 'p1')] });
    s.cards[ill(s, 'p1')].tokens = 1;
    const card2 = give(s, 'p1', 'false-slack', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: card2, target: master, payWith: [ill(s, 'p1')] } })).toThrow(/already/);
  });
});

describe('Give Me Slack, or Give Me Food', () => {
  it('takes back the Plot just played, discarding itself and one other card', () => {
    const s0 = scenario();
    const t = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const antiSlack = give(s0, 'p1', 'anti-slack', { hand: true });
    s0.cards[ill(s0, 'p2')].tokens = 2;
    const card = give(s0, 'p1', 'give-me-slack-or-give-me-food', { hand: true });
    const spare = give(s0, 'p1', 'give-me-slack-or-give-me-food', { hand: true });
    void t;
    let s = act(s0, 'p1', { type: 'playPlot', play: { card: antiSlack, target: ill(s0, 'p2') } });
    s = act(s, 'p1', { type: 'playPlot', play: { card, discards: [spare] } });
    while (s.window?.kind === 'plot') s = act(s, waitingFor(s)[0], { type: 'pass' });
    expect(s.players[0].hand).toContain(antiSlack);
    expect(s.players[0].hand).not.toContain(spare);
    expect(s.cards[ill(s, 'p2')].tokens).toBe(2); // Anti-Slack never took effect
  });
  it('cannot take back a rival\'s Plot', () => {
    const s0 = scenario();
    s0.active = 1;
    s0.cards[ill(s0, 'p1')].tokens = 2;
    const antiSlack = give(s0, 'p2', 'anti-slack', { hand: true });
    const card = give(s0, 'p1', 'give-me-slack-or-give-me-food', { hand: true });
    const spare = give(s0, 'p1', 'give-me-slack-or-give-me-food', { hand: true });
    let s = act(s0, 'p2', { type: 'playPlot', play: { card: antiSlack, target: ill(s0, 'p1') } });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, discards: [spare] } })).toThrow(/your own/);
  });
});

describe('Head Launching', () => {
  it('gives Global Power equal to Power, spending the Group\'s action and two discards', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'the-mafia', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    s0.cards[g].tokens = 1;
    const card = give(s0, 'p1', 'head-launching', { hand: true });
    const d1 = give(s0, 'p1', 'head-launching', { hand: true });
    const d2 = give(s0, 'p1', 'head-launching', { hand: true });
    const s = playAndResolve(s0, 'p1', { card, target: g, discards: [d1, d2] });
    expect(globalPower(s, g)).toBe(power(s, g));
    expect(s.cards[g].tokens).toBe(0);
    expect(s.players[0].hand).not.toContain(d1);
  });
});

describe('Inherently Bogus', () => {
  it('costs a Church-of-the-SubGenius Illuminati with no SubGenius Groups a token', () => {
    const s0 = scenario();
    s0.cards[ill(s0, 'p2')].cardId = 'church-of-the-subgenius';
    s0.cards[ill(s0, 'p2')].tokens = 1;
    give(s0, 'p2', 'loan-sharks', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'inherently-bogus', { hand: true });
    const s = playAndResolve(s0, 'p1', { card, target: ill(s0, 'p2') });
    expect(s.cards[ill(s, 'p2')].tokens).toBe(0);
  });
  it('does not apply to a Church that controls a SubGenius Group', () => {
    const s0 = scenario();
    s0.cards[ill(s0, 'p2')].cardId = 'church-of-the-subgenius';
    s0.cards[ill(s0, 'p2')].tokens = 1;
    give(s0, 'p2', 'drs-for-bob', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'inherently-bogus', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: ill(s0, 'p2') } })).toThrow(/SubGenius Group/);
  });
});

describe('JHVH-1', () => {
  it('forces a rival to discard half his Plots, his own choice', () => {
    const s0 = scenario();
    const a = give(s0, 'p2', 'anti-slack', { hand: true });
    const b = give(s0, 'p2', 'anti-slack', { hand: true });
    const c = give(s0, 'p2', 'anti-slack', { hand: true });
    s0.cards[ill(s0, 'p1')].tokens = 1;
    const card = give(s0, 'p1', 'jhvh-1', { hand: true });
    let s = playAndResolve(s0, 'p1', { card, target: ill(s0, 'p2'), payWith: [ill(s0, 'p1')] });
    expect(s.prompt?.kind).toBe('choose');
    expect(s.prompt!.player).toBe('p2');
    expect(s.prompt!.choice!.min).toBe(2); // ceil(3/2)
    s = act(s, 'p2', { type: 'choose', ids: [a, b] });
    expect(s.players[1].discard).toEqual(expect.arrayContaining([a, b]));
    expect(s.players[1].hand).toContain(c);
  });
});

describe('Kill "Bob"!', () => {
  it('gives Slack to the attacking side when a SubGenius Group is destroyed', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'drs-for-bob', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'kill-bob', { hand: true });
    s0.cards[ill(s0, 'p1')].tokens = 0;
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    s.attack!.strengthLock = { attack: 20, defense: 0, by: 'test-lock' };
    s = toRoll(s);
    s.attack!.roll = [2, 2];
    s = act(s, 'p1', { type: 'playPlot', play: { card } });
    expect(s.cards[ill(s, 'p1')].tokens).toBe(1);
    s = resolveAttack(s);
    expect(s.cards[tgt].zone).toBe('destroyed');
  });
  it('rewards the owner of the destroyed SubGenius Group even on a failed attack', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'drs-for-bob', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p2', 'kill-bob', { hand: true });
    s0.cards[ill(s0, 'p2')].tokens = 0;
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    s.attack!.strengthLock = { attack: 20, defense: 0, by: 'test-lock' };
    s = toRoll(s);
    s.attack!.roll = [12, 12];
    s = act(s, 'p2', { type: 'playPlot', play: { card } });
    expect(s.cards[ill(s, 'p2')].tokens).toBe(1);
  });
});

describe('Luck Plane', () => {
  it('changes the just-rolled dice to 2, discarding three other Plots', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'luck-plane', { hand: true });
    const d1 = give(s0, 'p1', 'luck-plane', { hand: true });
    const d2 = give(s0, 'p1', 'luck-plane', { hand: true });
    const d3 = give(s0, 'p1', 'luck-plane', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    s.attack!.strengthLock = { attack: 20, defense: 0, by: 'test-lock' };
    s = toRoll(s);
    s.attack!.roll = [6, 6];
    s = act(s, 'p1', { type: 'playPlot', play: { card, discards: [d1, d2, d3] } });
    expect(finalRoll(s.attack!)).toBe(2);
  });
});

describe('Mediocretinism', () => {
  it('removes SubGenius from a Group until end of turn', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'drs-for-bob', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'mediocretinism', { hand: true });
    const s = playAndResolve(s0, 'p1', { card, target: g });
    expect(attributes(s, g)).not.toContain('SubGenius');
  });
  it('only applies to a currently SubGenius Group', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'mediocretinism', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: g } })).toThrow(/SubGenius/);
  });
});

describe('Miraculous Manifestation', () => {
  it('makes every player draw a Group (revealed to the caster in a standard game)', () => {
    const s0 = scenario();
    const card = give(s0, 'p1', 'miraculous-manifestation', { hand: true });
    const before1 = s0.players[0].groupDeck.length;
    const before2 = s0.players[1].groupDeck.length;
    const s = playAndResolve(s0, 'p1', { card });
    expect(s.players[0].groupDeck.length).toBe(before1 - 1);
    expect(s.players[1].groupDeck.length).toBe(before2 - 1);
    expect(s.players[0].known?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('More Slack', () => {
  it('spends one Slack and exposes every hand, once per game', () => {
    const s0 = scenario();
    give(s0, 'p2', 'anti-slack', { hand: true });
    s0.cards[ill(s0, 'p1')].tokens = 1;
    const card = give(s0, 'p1', 'more-slack', { hand: true });
    let s = playAndResolve(s0, 'p1', { card });
    expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
    expect(s.players[1].hand.every((c) => s.cards[c].exposed)).toBe(true);
    const card2 = give(s, 'p1', 'more-slack', { hand: true });
    s.cards[ill(s, 'p1')].tokens = 1;
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: card2 } })).toThrow(/once per game/);
  });
});

describe('Nental Ife', () => {
  it('gives Global Power equal to Power, using the Personality\'s own action', () => {
    const s0 = scenario();
    const p = give(s0, 'p1', 'jesus-b', { under: ill(s0, 'p1'), side: 'BOTTOM' }); // SubGenius Personality
    s0.cards[p].tokens = 1;
    const card = give(s0, 'p1', 'nental-ife', { hand: true });
    const s = playAndResolve(s0, 'p1', { card, target: p, payWith: [p] });
    expect(globalPower(s, p)).toBe(power(s, p));
    expect(s.cards[p].tokens).toBe(0);
  });
  it('only links to a SubGenius Personality', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'drs-for-bob', { under: ill(s0, 'p1'), side: 'BOTTOM' }); // SubGenius but not a Personality
    s0.cards[g].tokens = 1;
    const card = give(s0, 'p1', 'nental-ife', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: g, payWith: [g] } })).toThrow(/Personality/);
  });
});

describe('Official, all Inclusive, Divine Excuse', () => {
  it('makes an attack on a Personality fail before the roll', () => {
    const s0 = scenario();
    s0.active = 1;
    const att = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const tgt = give(s0, 'p1', 'jesus-b', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'official-all-inclusive-divine-excuse', { hand: true });
    let s = act(s0, 'p2', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    s = act(s, 'p1', { type: 'playPlot', play: { card } });
    s = resolveAttack(s);
    expect(s.cards[tgt].zone).toBe('structure');
    expect(s.cards[tgt].controller).toBe('p1');
  });
  it('cannot be used when the target is not a Personality', () => {
    const s0 = scenario();
    s0.active = 1;
    const att = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const tgt = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const card = give(s0, 'p1', 'official-all-inclusive-divine-excuse', { hand: true });
    const s = act(s0, 'p2', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card } })).toThrow(/Personality/);
  });
});
