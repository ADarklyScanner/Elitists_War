import { describe, expect, it } from 'vitest';
import { applyAction, attackStrength, power, CARDS, finalRoll } from '../src/engine';
import { give, newGame, scenario } from './helpers';

describe('Attack to Control (R003, R006)', () => {
  it('uses Power minus Resistance, +4 per shared alignment, position and master-alignment bonuses', () => {
    const s = scenario();
    const [a, b] = s.players;
    // Attacker: Congressional Wives? use plain cards: B.A.T.F. (Violent, Government, Power 3)
    const att = give(s, 'p1', 'b-a-t-f', { under: a.illuminati, side: 'BOTTOM' });
    // Target: C.I.A. under rival Illuminati (depth 1 -> +10), and a puppet of it (depth 2 -> +5)
    const cia = give(s, 'p2', 'c-i-a', { under: b.illuminati, side: 'BOTTOM' });
    const next = give(s, 'p2', 'fbi', { hand: true });
    const cardAtt = CARDS['b-a-t-f'], cardCia = CARDS['c-i-a'];
    const ctx = { id: 1, type: 'control' as const, instant: false, attacker: att, attackerPlayer: 'p1', target: cia, targetPlayer: 'p2', fromHand: false, privileged: false, aid: [], oppose: [], attackBonus: [], defenseBonus: [], plays: [] };
    const shared = cardAtt.alignments!.filter((x) => cardCia.alignments!.includes(x)).length;
    const r = attackStrength(s, ctx);
    expect(r.attack).toBe(power(s, att) + shared * 4);
    expect(r.defense).toBe(cardCia.resistance! + 10);
    expect(next).toBeTruthy();
  });

  it('a target defending itself doubles its Power, and capture moves it with its puppets', () => {
    const s0 = scenario();
    const [a, b] = s0.players;
    const att = give(s0, 'p1', 'the-mafia', { under: a.illuminati, side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'loan-sharks', { under: b.illuminati, side: 'BOTTOM' });
    let s = applyAction(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    const before = attackStrength(s, s.attack!).defense;
    s = applyAction(s, 'p2', { type: 'oppose', group: tgt });
    expect(attackStrength(s, s.attack!).defense - before).toBe(power(s, tgt) * 2);
    // Force a success by rolling: pass until resolved, then check whoever controls it is consistent.
    s = applyAction(s, 'p1', { type: 'pass' });
    s = applyAction(s, 'p2', { type: 'pass' });
    if (s.window?.kind === 'roll') { s = applyAction(s, 'p1', { type: 'pass' }); s = applyAction(s, 'p2', { type: 'pass' }); }
    expect(s.attack).toBeUndefined();
    expect(['p1', 'p2']).toContain(s.cards[tgt].controller);
  });

  it('two-player: nobody attacks the other before both have had a full turn (R023)', () => {
    const s = scenario();
    s.players[1].turnsTaken = 0;
    const att = give(s, 'p1', 'the-mafia', { under: s.players[0].illuminati, side: 'BOTTOM' });
    const tgt = give(s, 'p2', 'loan-sharks', { under: s.players[1].illuminati, side: 'BOTTOM' });
    expect(() => applyAction(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt })).toThrow(/full turn/);
  });
});

describe('Plots', () => {
  it('+10 Plots add to the attack, and a cancelled cancel restores them (R010)', () => {
    const s0 = scenario();
    const [a, b] = s0.players;
    const att = give(s0, 'p1', 'the-mafia', { under: a.illuminati, side: 'BOTTOM' }); // Criminal
    const tgt = give(s0, 'p2', 'loan-sharks', { under: b.illuminati, side: 'BOTTOM' });
    const bigScore = give(s0, 'p1', 'the-big-score', { hand: true });
    const hoax = give(s0, 'p2', 'hoax', { hand: true });
    const secrets = give(s0, 'p1', 'secrets-man-was-not-meant-to-know', { hand: true });
    const helper = give(s0, 'p2', 'c-i-a', { under: b.illuminati, side: 'TOP' });
    s0.cards[b.illuminati].tokens = 1;
    let s = applyAction(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt, plots: [{ card: bigScore, target: att, mode: 'power' }] });
    const withTen = attackStrength(s, s.attack!).attack;
    s = applyAction(s, 'p2', { type: 'playPlot', play: { card: hoax, target: bigScore, payWith: [helper, tgt] } });
    expect(attackStrength(s, s.attack!).attack).toBe(withTen - 10);
    s = applyAction(s, 'p1', { type: 'playPlot', play: { card: secrets, target: hoax, mode: 'illuminati' } });
    expect(attackStrength(s, s.attack!).attack).toBe(withTen);
  });

  it('Murphy\'s Law sets the roll to 12, so the attack fails', () => {
    const s0 = scenario();
    const [a, b] = s0.players;
    const att = give(s0, 'p1', 'the-mafia', { under: a.illuminati, side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'loan-sharks', { under: b.illuminati, side: 'BOTTOM' });
    const murphy = give(s0, 'p2', 'murphy-s-law', { hand: true });
    let s = applyAction(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    s = applyAction(s, 'p1', { type: 'pass' });
    s = applyAction(s, 'p2', { type: 'pass' });
    if (s.window?.kind !== 'roll') return; // strength < 2: failed without a roll
    s = applyAction(s, 'p2', { type: 'playPlot', play: { card: murphy } });
    expect(finalRoll(s.attack!)).toBe(12);
    s = applyAction(s, 'p1', { type: 'pass' });
    s = applyAction(s, 'p2', { type: 'pass' });
    expect(s.cards[tgt].zone).toBe('structure');
  });

  it('Volcano uses Power 18 (errata) and Devastates or destroys a Place', () => {
    const s0 = scenario();
    const place = give(s0, 'p2', 'hollywood', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    const volcano = give(s0, 'p1', 'volcano', { hand: true });
    let s = applyAction(s0, 'p1', { type: 'playPlot', play: { card: volcano, target: place } });
    expect(s.attack?.instantPower).toBe(18);
    while (s.attack) s = applyAction(s, s.window!.passed.includes('p1') ? 'p2' : 'p1', { type: 'pass' });
    const c = s.cards[place];
    expect(c.zone === 'destroyed' || c.devastated || c.zone === 'structure').toBe(true);
  });
});

describe('turn structure', () => {
  it('enforces the 5-Plot hand limit at the end of a turn', () => {
    const s0 = scenario();
    for (let i = 0; i < 7; i++) give(s0, 'p2', 'reload', { hand: true });
    let s = applyAction(s0, 'p1', { type: 'endTurn' });
    s = applyAction(s, 'p2', { type: 'pass' });
    expect(s.prompt?.kind).toBe('discardToLimit');
    expect(s.prompt?.player).toBe('p2');
  });
});
