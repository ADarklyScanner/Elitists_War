import { describe, expect, it } from 'vitest';
import {
  applyAction, waitingFor,
  type Action, type GameState, type PlotPlay,
} from '../../src/engine';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const play = (s: GameState, pl: string, p: PlotPlay) => act(s, pl, { type: 'playPlot', play: p });
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const P = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!;
const under = (s: GameState, pl: string, id: string, side: 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT' = 'BOTTOM', master?: string) =>
  give(s, pl, id, { under: master ?? ill(s, pl), side });
const hand = (s: GameState, pl: string, id: string) => give(s, pl, id, { hand: true });
/** Pass for everyone while a window is open (never answers a prompt), forcing the dice if given. */
function passAll(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 40 && s.window && !s.prompt; i++) {
    if (dice && s.window.kind === 'roll' && s.attack?.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** Pass until the roll window is open, then force the dice. */
function toRoll(s: GameState, dice: [number, number]): GameState {
  for (let i = 0; i < 10 && s.window?.kind === 'attack'; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  if (s.attack?.roll) s.attack.roll = dice;
  return s;
}

describe('Hurricane and Tidal Wave (audit fix)', () => {
  it('strike only Coastal Places', () => {
    const s0 = scenario();
    const inland = under(s0, 'p2', 'las-vegas');
    const coast = under(s0, 'p2', 'hawaii', 'TOP');
    const h = hand(s0, 'p1', 'hurricane');
    const t = hand(s0, 'p1', 'tidal-wave');
    expect(() => play(s0, 'p1', { card: h, target: inland })).toThrow(/Coastal/);
    expect(() => play(s0, 'p1', { card: t, target: inland })).toThrow(/Coastal/);
    expect(play(s0, 'p1', { card: h, target: coast }).attack?.instantPower).toBe(20);
    expect(play(s0, 'p1', { card: t, target: coast }).attack?.instantPower).toBe(24);
  });
});

describe('Are We Having Fun Yet? (audit fix)', () => {
  it('cancels an action announced outside an attack', () => {
    let s = scenario();
    const fun = hand(s, 'p2', 'are-we-having-fun-yet');
    const payer = under(s, 'p2', 'pentagon');
    const g = under(s, 'p1', 'hollywood');
    s = act(s, 'p1', { type: 'move', group: g, onto: ill(s, 'p1'), side: 'LEFT', payWith: g });
    expect(s.window?.event?.type).toBe('action');
    s = play(s, 'p2', { card: fun, target: g, payWith: [payer] });
    s = passAll(s);
    expect(s.cards[g].side).toBe('BOTTOM'); // the move never happened
    expect(s.cards[payer].tokens).toBe(0);
    expect(s.cards[fun].zone).toBe('discard');
  });
  it('the payers need more Power than the acting Group, and the target must be acting', () => {
    let s = scenario();
    const fun = hand(s, 'p2', 'are-we-having-fun-yet');
    const weak = under(s, 'p2', 'punk-rockers');
    const other = under(s, 'p2', 'pentagon', 'TOP');
    const g = under(s, 'p1', 'hollywood');
    s = act(s, 'p1', { type: 'move', group: g, onto: ill(s, 'p1'), side: 'LEFT', payWith: g });
    expect(() => play(s, 'p2', { card: fun, target: g, payWith: [weak] })).toThrow(/more than 3/);
    expect(() => play(s, 'p2', { card: fun, target: other, payWith: [other] })).toThrow(/taking the action/);
  });
});

describe('Fnord! (audit fix)', () => {
  function rolled() {
    let s = scenario();
    const att = under(s, 'p1', 'the-mafia');
    const tgt = under(s, 'p2', 'loan-sharks');
    const f = hand(s, 'p1', 'fnord');
    const cards = [hand(s, 'p1', 'cable-tv'), hand(s, 'p1', 'fbi'), hand(s, 'p1', 'dentists')];
    s = act(s, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    s.attack!.attackBonus.push({ player: 'p1', amount: 20, label: 'test' }); // make sure the dice are rolled
    s = toRoll(s, [6, 6]);
    return { s, f, cards };
  }
  it('pays with two Group cards from hand that the player picks', () => {
    const { s: s0, f, cards } = rolled();
    const deck = P(s0, 'p1').groupDeck.length;
    let s = play(s0, 'p1', { card: f, mode: 'hand' });
    expect(s.prompt?.choice?.key).toBe('fnord-discard');
    s = act(s, 'p1', { type: 'choose', ids: [cards[0], cards[2]] });
    expect([s.cards[cards[0]].zone, s.cards[cards[1]].zone, s.cards[cards[2]].zone]).toEqual(['discard', 'hand', 'discard']);
    expect(P(s, 'p1').groupDeck.length).toBe(deck);
  });
  it('or with the top card of the Group deck', () => {
    const { s: s0, f, cards } = rolled();
    const top = P(s0, 'p1').groupDeck[0];
    const s = play(s0, 'p1', { card: f, mode: 'groupDeck' });
    expect(s.cards[top].zone).toBe('discard');
    for (const c of cards) expect(s.cards[c].zone).toBe('hand');
    const empty = structuredClone(s0);
    P(empty, 'p1').hand = P(empty, 'p1').hand.filter((x) => !cards.slice(1).includes(x));
    expect(() => play(empty, 'p1', { card: f, mode: 'hand' })).toThrow(/two Group cards/);
  });
});

describe('Poison (audit fix)', () => {
  it('a Magic Group may join it, as well as a Criminal one', () => {
    const s0 = scenario();
    const t = under(s0, 'p2', 'dan-quayle');
    const druids = under(s0, 'p1', 'druids');
    const plain = under(s0, 'p1', 'pentagon', 'TOP');
    const p = hand(s0, 'p1', 'poison');
    expect(() => play(s0, 'p1', { card: p, target: t, helper: plain })).toThrow(/Criminal or Magic/);
    const s = play(s0, 'p1', { card: p, target: t, helper: druids });
    expect(s.attack?.aid.map((a) => a.iid)).toContain(druids);
  });
});

describe('Privileged Attack (audit fix)', () => {
  it('is free when one of your Secret Groups makes the attack', () => {
    const s0 = scenario();
    s0.cards[ill(s0, 'p1')].tokens = 0;
    const nsa = under(s0, 'p1', 'n-s-a');
    const tgt = under(s0, 'p2', 'loan-sharks');
    const priv = hand(s0, 'p1', 'privileged-attack');
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: nsa, target: tgt, plots: [{ card: priv }] });
    expect(waitingFor(s).sort()).toEqual(['p1', 'p2']);
    expect(s.attack?.plays.some((p) => p.effect.t === 'privileged')).toBe(true);
  });
  it('or a Secret Group of yours may spend its token instead of the Illuminati; other Groups cannot', () => {
    const s0 = scenario();
    s0.cards[ill(s0, 'p1')].tokens = 0;
    const att = under(s0, 'p1', 'the-mafia');
    const secret = under(s0, 'p1', 'subliminals', 'TOP');
    const plain = under(s0, 'p1', 'pentagon', 'LEFT');
    const tgt = under(s0, 'p2', 'loan-sharks');
    const priv = hand(s0, 'p1', 'privileged-attack');
    const decl = (payWith?: string[]) => act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt, plots: [{ card: priv, payWith }] });
    expect(() => decl([plain])).toThrow(/Secret Groups/);
    const s = decl([secret]);
    expect(s.cards[secret].tokens).toBe(0);
    expect(s.attack?.plays.some((p) => p.effect.t === 'privileged')).toBe(true);
    // Without naming a payer, a Secret Group with a token pays when the Illuminati cannot.
    expect(decl().cards[secret].tokens).toBe(0);
  });
});

describe('Whispering Campaign (audit fix)', () => {
  it('a Personality it destroys can never come back', () => {
    let s = scenario();
    const att = under(s, 'p1', 'the-mafia');
    const media = under(s, 'p1', 'cable-tv', 'TOP');
    const bill = under(s, 'p2', 'bill-clinton');
    const wc = hand(s, 'p1', 'whispering-campaign');
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: bill, plots: [{ card: wc, payWith: [media] }] });
    s = passAll(s, [2, 2]);
    expect(s.cards[bill].zone).toBe('destroyed');
    expect(s.cards[bill].data?.neverReturns).toBe(true);
    expect(s.cards[wc].zone).toBe('discard');
    // Media Blitz cannot bring a duplicate back.
    const dup = hand(s, 'p2', 'bill-clinton');
    const mb = hand(s, 'p2', 'media-blitz');
    const theirMedia = under(s, 'p2', 'big-media', 'TOP');
    s.active = 1;
    expect(() => play(s, 'p2', { card: mb, target: dup, payWith: [theirMedia] })).toThrow(/duplicates a destroyed Group/);
  });
});
