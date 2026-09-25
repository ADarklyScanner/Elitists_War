import { describe, expect, it } from 'vitest';
import {
  alignments, applyAction, attackStrength, canEnterPlay, CARDS, destroyGroup, power, resistance, waitingFor,
  type Action, type GameState, type PlotPlay,
} from '../../src/engine';
import { COMPUTER_PLOTS, resourceKinds } from '../../src/engine/content/plots3';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const play = (s: GameState, pl: string, p: PlotPlay) => act(s, pl, { type: 'playPlot', play: p });
/** Play a non-attack Plot and let the other player pass so it resolves. */
const playResolve = (s: GameState, pl: string, p: PlotPlay) => {
  let t = play(s, pl, p);
  for (let i = 0; i < 5 && t.window?.kind === 'plot'; i++) t = act(t, waitingFor(t)[0], { type: 'pass' });
  return t;
};
/** Pass for everyone until the attack is over, forcing the dice if given. */
function finish(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** Pass until the roll window is open. */
function toRoll(s: GameState): GameState {
  for (let i = 0; i < 10 && s.window?.kind === 'attack'; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
const ill = (s: GameState, i: number) => s.players[i].illuminati;
/** Put a card straight into the destroyed pile (credited to `by`). */
function destroyed(s: GameState, owner: string, cardId: string, by: string, killed = false) {
  const iid = give(s, owner, cardId, { hand: true });
  s.players.find((p) => p.id === owner)!.hand = s.players.find((p) => p.id === owner)!.hand.filter((x) => x !== iid);
  Object.assign(s.cards[iid], { zone: 'destroyed', killed });
  s.players.find((p) => p.id === by)!.destroyedCredit.push(iid);
  return iid;
}
const resourceOf = (s: GameState, pl: string, cardId: string) => give(s, pl, cardId, { resource: true });

describe('Celebrity Spokesman', () => {
  it('links a Personality to an Organization and sets its Power to 4 until one is destroyed', () => {
    const s0 = scenario();
    const bush = give(s0, 'p1', 'george-bush', { under: ill(s0, 0), side: 'BOTTOM' });
    const org = give(s0, 'p1', 'fast-food-chains', { under: ill(s0, 0), side: 'LEFT' });
    const c = give(s0, 'p1', 'celebrity-spokesman', { hand: true });
    const s = playResolve(s0, 'p1', { card: c, target: bush, targets: [org] });
    expect(power(s, bush)).toBe(4);
    expect(s.cards[c].linkedTo).toBe(bush);
    destroyGroup(s, org, 'p2');
    expect(power(s, bush)).toBe(CARDS['george-bush'].power);
    expect(s.cards[c].zone).toBe('discard');
  });
  it('refuses Government Organizations and play during an attack', () => {
    const s0 = scenario();
    const bush = give(s0, 'p1', 'george-bush', { under: ill(s0, 0), side: 'BOTTOM' });
    const cia = give(s0, 'p1', 'c-i-a', { under: ill(s0, 0), side: 'LEFT' });
    const c = give(s0, 'p1', 'celebrity-spokesman', { hand: true });
    expect(() => play(s0, 'p1', { card: c, target: bush, targets: [cia] })).toThrow(/Government/);
    const tgt = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 1), side: 'BOTTOM' });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: cia, target: tgt });
    const org = give(s, 'p1', 'fast-food-chains', { under: ill(s, 0), side: 'RIGHT' });
    expect(() => play(s, 'p1', { card: c, target: bush, targets: [org] })).toThrow(/attack/);
  });
});

describe('Charismatic Leader / Citizenship Award', () => {
  it('raise a Fanatic / Conservative Group to Power 6 using its action', () => {
    const s0 = scenario();
    const f = give(s0, 'p1', 'moonies', { under: ill(s0, 0), side: 'BOTTOM' });
    const r = give(s0, 'p1', 'fraternal-orders', { under: ill(s0, 0), side: 'LEFT' });
    const a = give(s0, 'p1', 'charismatic-leader', { hand: true });
    const b = give(s0, 'p1', 'citizenship-award', { hand: true });
    let s = playResolve(s0, 'p1', { card: a, target: f });
    s = playResolve(s, 'p1', { card: b, target: r });
    expect(power(s, f)).toBe(6);
    expect(power(s, r)).toBe(6);
    expect(s.cards[f].tokens).toBe(0);
    expect(s.cards[a].linkedTo).toBe(f);
  });
  it('need the right alignment, an action, and only one copy in play', () => {
    const s0 = scenario();
    const f = give(s0, 'p1', 'moonies', { under: ill(s0, 0), side: 'BOTTOM' });
    const f2 = give(s0, 'p1', 'libertarians', { under: ill(s0, 0), side: 'LEFT' });
    const a = give(s0, 'p1', 'charismatic-leader', { hand: true });
    const a2 = give(s0, 'p1', 'charismatic-leader', { hand: true });
    const b = give(s0, 'p1', 'citizenship-award', { hand: true });
    expect(() => play(s0, 'p1', { card: b, target: f })).toThrow(/Conservative/);
    const s = playResolve(s0, 'p1', { card: a, target: f });
    expect(() => play(s, 'p1', { card: a2, target: f2 })).toThrow(/only have one/);
    s.cards[f2].tokens = 0;
    expect(() => play(s, 'p1', { card: a2, target: f2 })).toThrow();
  });
});

describe('Clone', () => {
  it('lets an Assassinated Personality be played again and removes the Goal credit', () => {
    const s0 = scenario();
    const orig = destroyed(s0, 'p2', 'george-bush', 'p1', true);
    const dup = give(s0, 'p1', 'george-bush', { hand: true });
    const c = give(s0, 'p1', 'clone', { hand: true });
    expect(canEnterPlay(s0, dup)).toBe(false);
    const s = playResolve(s0, 'p1', { card: c, target: dup });
    expect(s.cards[orig].zone).toBe('discard');
    expect(s.players[0].destroyedCredit).not.toContain(orig);
    expect(canEnterPlay(s, dup)).toBe(true);
    expect(s.cards[dup].zone).toBe('hand');
  });
  it('with the Clone Arrangers the clone comes into play at once', () => {
    const s0 = scenario();
    give(s0, 'p1', 'clone-arrangers', { under: ill(s0, 0), side: 'BOTTOM' });
    destroyed(s0, 'p2', 'george-bush', 'p1', true);
    const dup = give(s0, 'p1', 'george-bush', { hand: true });
    const c = give(s0, 'p1', 'clone', { hand: true });
    const s = playResolve(s0, 'p1', { card: c, target: dup });
    expect(s.cards[dup].zone).toBe('structure');
    expect(s.cards[dup].controller).toBe('p1');
  });
  it('only for Personalities that were Assassinated', () => {
    const s0 = scenario();
    destroyed(s0, 'p2', 'george-bush', 'p1', false);
    const dup = give(s0, 'p1', 'george-bush', { hand: true });
    const c = give(s0, 'p1', 'clone', { hand: true });
    expect(() => play(s0, 'p1', { card: c, target: dup })).toThrow(/Assassinated/);
  });
});

describe('Combined Disasters', () => {
  it('strikes with the main Disaster and adds the second one\'s Power', () => {
    const s0 = scenario();
    const place = give(s0, 'p2', 'hollywood', { under: ill(s0, 1), side: 'BOTTOM' });
    const t = give(s0, 'p1', 'tornado', { hand: true });
    const m = give(s0, 'p1', 'meteor-strike', { hand: true });
    const c = give(s0, 'p1', 'combined-disasters', { hand: true });
    let s = play(s0, 'p1', { card: c, target: place, targets: [t, m] });
    expect(s.attack?.instantPower).toBe(12);
    expect(s.attack?.instantCard).toBe(t);
    expect(s.attack?.attackBonus.some((b) => b.amount === 16)).toBe(true);
    expect(s.players[0].hand).not.toContain(m);
    s = finish(s, [6, 6]);
    for (const x of [t, m, c]) expect(s.cards[x].zone).toBe('discard');
  });
  it('both Disasters must be able to strike the Place', () => {
    const s0 = scenario();
    const huge = give(s0, 'p2', 'england', { under: ill(s0, 1), side: 'BOTTOM' });
    const t = give(s0, 'p1', 'tornado', { hand: true });
    const m = give(s0, 'p1', 'meteor-strike', { hand: true });
    const c = give(s0, 'p1', 'combined-disasters', { hand: true });
    expect(() => play(s0, 'p1', { card: c, target: huge, targets: [m, t] })).toThrow(/Tornado/);
  });
});

describe('Commitment', () => {
  it('raises any Group\'s Resistance to 8', () => {
    const s0 = scenario();
    const g = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 1), side: 'BOTTOM' });
    const c = give(s0, 'p1', 'commitment', { hand: true });
    const s = playResolve(s0, 'p1', { card: c, target: g });
    expect(resistance(s, g)).toBe(8);
    expect(s.cards[c].linkedTo).toBe(g);
  });
  it('can be played by the defender during an attack on the target, and stays afterwards', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 0), side: 'BOTTOM' });
    const g = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 1), side: 'BOTTOM' });
    const c = give(s0, 'p2', 'commitment', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: g });
    const before = attackStrength(s, s.attack!).defense;
    s = play(s, 'p2', { card: c, target: g });
    expect(attackStrength(s, s.attack!).defense - before).toBe(8 - CARDS['loan-sharks'].resistance!);
    s = finish(s, [6, 6]);
    expect(resistance(s, g)).toBe(8);
    expect(s.cards[c].zone).toBe('table');
  });
  it('needs a Group as its target', () => {
    const s0 = scenario();
    const c = give(s0, 'p1', 'commitment', { hand: true });
    expect(() => play(s0, 'p1', { card: c })).toThrow(/Group/);
  });
});

describe('Computer Security', () => {
  it('its list of Plots that deal with Computers matches every Plot in the card data that names them', () => {
    const named = Object.values(CARDS)
      .filter((c) => c.type === 'Plot' && [c.text, c.cost, c.target, c.playRequirement].some((f) => /\bComputers?\b/.test(f ?? '')))
      .map((c) => c.id).sort();
    expect([...COMPUTER_PLOTS].sort()).toEqual(named);
  });
  it('negates a Computer Plot, paid by a Computer Group', () => {
    const s0 = scenario();
    const eff = give(s0, 'p1', 'eff', { under: ill(s0, 0), side: 'BOTTOM' });
    const vg = give(s0, 'p2', 'video-games', { under: ill(s0, 1), side: 'BOTTOM' });
    const ib = give(s0, 'p1', 'infobahn', { hand: true });
    const cs = give(s0, 'p2', 'computer-security', { hand: true });
    let s = play(s0, 'p1', { card: ib, target: eff, mode: 'power' });
    s = play(s, 'p2', { card: cs, target: ib, payWith: [vg] });
    s = act(s, 'p1', { type: 'pass' });
    expect(s.window).toBeUndefined();
    expect(s.cards[eff].mods.length).toBe(0);
    expect(s.cards[vg].tokens).toBe(0);
  });
  it('must be paid by the Network or a Computer Group, and only against Computer Plots', () => {
    const s0 = scenario();
    const eff = give(s0, 'p1', 'eff', { under: ill(s0, 0), side: 'BOTTOM' });
    const lsh = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 1), side: 'BOTTOM' });
    const vg = give(s0, 'p2', 'video-games', { under: ill(s0, 1), side: 'LEFT' });
    const ib = give(s0, 'p1', 'infobahn', { hand: true });
    const cs = give(s0, 'p2', 'computer-security', { hand: true });
    let s = play(s0, 'p1', { card: ib, target: eff, mode: 'power' });
    expect(() => play(s, 'p2', { card: cs, target: ib, payWith: [lsh] })).toThrow(/Computer/);
    s = act(s, 'p2', { type: 'pass' });
    const ff = give(s, 'p1', 'fast-food-chains', { under: ill(s, 0), side: 'LEFT' });
    const sts = give(s, 'p1', 'stock-split', { hand: true });
    s = play(s, 'p1', { card: sts, target: ff, mode: 'power' });
    expect(() => play(s, 'p2', { card: cs, target: sts, payWith: [vg] })).toThrow(/Computers/);
  });
});

describe('Counter-Revolution', () => {
  it('lets a destroyed Nation be played again (Illuminati action)', () => {
    const s0 = scenario();
    const orig = destroyed(s0, 'p2', 'england', 'p1');
    const dup = give(s0, 'p1', 'england', { hand: true });
    const c = give(s0, 'p1', 'counter-revolution', { hand: true });
    const s = playResolve(s0, 'p1', { card: c, target: dup, payWith: [ill(s0, 0)] });
    expect(s.cards[orig].zone).toBe('discard');
    expect(s.players[0].destroyedCredit).toHaveLength(0);
    expect(canEnterPlay(s, dup)).toBe(true);
    expect(s.cards[ill(s, 0)].tokens).toBe(0);
  });
  it('Government payers need 10 Power', () => {
    const s0 = scenario();
    destroyed(s0, 'p2', 'england', 'p1');
    const dup = give(s0, 'p1', 'england', { hand: true });
    const nasa = give(s0, 'p1', 'nasa', { under: ill(s0, 0), side: 'BOTTOM' });
    const c = give(s0, 'p1', 'counter-revolution', { hand: true });
    expect(() => play(s0, 'p1', { card: c, target: dup, payWith: [nasa] })).toThrow(/10 Power/);
  });
});

describe('Counterspell', () => {
  function setup() {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 0), side: 'BOTTOM' });
    const g = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 1), side: 'BOTTOM' });
    const hammer = resourceOf(s0, 'p1', 'hammer-of-thor');
    const gadget = resourceOf(s0, 'p1', 'cyborg-soldiers');
    const cs = give(s0, 'p2', 'counterspell', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: g });
    return { s, hammer, gadget, cs };
  }
  it('destroys a Magic Resource used against you and cancels its use', () => {
    const { s: s1, hammer, cs } = setup();
    s1.attack!.plays.push({ iid: 'ability:x', player: 'p1', play: { card: hammer }, effect: { t: 'delta', value: -2 }, ability: hammer });
    const s = play(s1, 'p2', { card: cs, payWith: [ill(s1, 1)] });
    expect(s.cards[hammer].zone).toBe('discard');
    expect(s.attack!.plays.at(-1)!.effect).toEqual({ t: 'cancelPlot', target: 'ability:x' });
  });
  it('only against Magic Resources', () => {
    const { s: s1, gadget, cs } = setup();
    s1.attack!.plays.push({ iid: 'ability:y', player: 'p1', play: { card: gadget }, effect: { t: 'none' }, ability: gadget });
    expect(() => play(s1, 'p2', { card: cs, payWith: [ill(s1, 1)] })).toThrow(/Magic Resource/);
  });
});

describe('Cover-Up', () => {
  it('turns a successful attack on a Secret Group into a failure', () => {
    const s0 = scenario();
    const sec = give(s0, 'p2', 'subliminals', { under: ill(s0, 1), side: 'BOTTOM' });
    const cu = give(s0, 'p2', 'cover-up', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: ill(s0, 0), target: sec });
    s.attack!.attackBonus.push({ player: 'p1', amount: 30, label: 'test' });
    s = toRoll(s);
    s.attack!.roll = [1, 1];
    expect(() => play(s, 'p2', { card: cu, payWith: [sec] })).toThrow(/different Secret/);
    expect(finish(s).cards[sec].controller).toBe('p1'); // without Cover-Up it is captured
    s = play(s, 'p2', { card: cu, payWith: [ill(s, 1)] });
    s = finish(s);
    expect(s.cards[sec].controller).toBe('p2');
  });
  it('cannot be played when the attack has not succeeded', () => {
    const s0 = scenario();
    const sec = give(s0, 'p2', 'subliminals', { under: ill(s0, 1), side: 'BOTTOM' });
    const cu = give(s0, 'p2', 'cover-up', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: ill(s0, 0), target: sec });
    s.attack!.attackBonus.push({ player: 'p1', amount: 30, label: 'test' });
    s = toRoll(s);
    s.attack!.roll = [6, 6];
    expect(() => play(s, 'p2', { card: cu, payWith: [ill(s, 1)] })).toThrow(/succeeded/);
  });
});

describe('Currency Speculation', () => {
  it('triples a Bank\'s Power for its next action, then ends', () => {
    const s0 = scenario();
    const bank = give(s0, 'p1', 'savings-and-loans', { under: ill(s0, 0), side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 1), side: 'BOTTOM' });
    const c = give(s0, 'p1', 'currency-speculation', { hand: true });
    let s = playResolve(s0, 'p1', { card: c, target: bank, mode: 'power' });
    expect(power(s, bank)).toBe(3 * power(s0, bank));
    s = act(s, 'p1', { type: 'attack', attackType: 'control', attacker: bank, target: tgt });
    s = finish(s, [6, 6]);
    expect(power(s, bank)).toBe(power(s0, bank));
    expect(s.cards[c].zone).toBe('discard');
  });
  it('only on your Bank Groups', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 0), side: 'BOTTOM' });
    const c = give(s0, 'p1', 'currency-speculation', { hand: true });
    expect(() => play(s0, 'p1', { card: c, target: g, mode: 'power' })).toThrow(/Bank/);
  });
});

describe('Deasil Engine', () => {
  it('destroys a Gadget; a second Deasil Engine cancels the first', () => {
    const s0 = scenario();
    const gadget = resourceOf(s0, 'p2', 'cyborg-soldiers');
    const d1 = give(s0, 'p1', 'deasil-engine', { hand: true });
    const d2 = give(s0, 'p2', 'deasil-engine', { hand: true });
    const s = playResolve(s0, 'p1', { card: d1 });
    expect(s.cards[gadget].zone).toBe('discard');
    let t = play(s0, 'p1', { card: d1, target: gadget });
    t = play(t, 'p2', { card: d2, target: d1 });
    t = act(t, 'p1', { type: 'pass' });
    expect(t.cards[gadget].zone).toBe('resources');
  });
  it('needs a Gadget', () => {
    const s0 = scenario();
    resourceOf(s0, 'p2', 'hammer-of-thor');
    const d1 = give(s0, 'p1', 'deasil-engine', { hand: true });
    expect(() => play(s0, 'p1', { card: d1 })).toThrow(/Gadget/);
  });
});

describe('Dictatorship', () => {
  it('gives your Nation +2 Power and makes it Violent, using its action', () => {
    const s0 = scenario();
    const n = give(s0, 'p1', 'vatican-city', { under: ill(s0, 0), side: 'BOTTOM' });
    const c = give(s0, 'p1', 'dictatorship', { hand: true });
    const s = playResolve(s0, 'p1', { card: c, target: n });
    expect(power(s, n)).toBe(power(s0, n) + 2);
    expect(alignments(s, n)).toContain('Violent');
    expect(s.cards[n].tokens).toBe(0);
    expect(s.cards[c].linkedTo).toBe(n);
  });
  it('only on a Nation you control, in your own turn', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 0), side: 'BOTTOM' });
    const n = give(s0, 'p2', 'england', { under: ill(s0, 1), side: 'BOTTOM' });
    const c = give(s0, 'p1', 'dictatorship', { hand: true });
    const c2 = give(s0, 'p2', 'dictatorship', { hand: true });
    expect(() => play(s0, 'p1', { card: c, target: g })).toThrow(/Nation/);
    expect(() => play(s0, 'p2', { card: c2, target: n })).toThrow();
  });
});

describe('Double-Cross', () => {
  function spyWindow() {
    const s = scenario();
    const spy = give(s, 'p1', 'logic-bomb', { hand: true });
    s.players[0].hand = [];
    Object.assign(s.cards[spy], { zone: 'table', controller: 'p1' });
    const pp = { iid: spy, player: 'p1', play: { card: spy, target: ill(s, 1) }, effect: { t: 'none' as const } };
    s.window = { kind: 'plot', passed: ['p1'], plot: pp, plays: [pp] };
    return { s, spy };
  }
  it('cancels a rival\'s spying Plot', () => {
    const { s: s0, spy } = spyWindow();
    const dc = give(s0, 'p2', 'double-cross', { hand: true });
    const s = play(s0, 'p2', { card: dc, target: spy });
    expect(s.window!.plays!.at(-1)!.effect).toEqual({ t: 'cancelPlot', target: spy });
  });
  it('only against spying Plots aimed at you', () => {
    const { s: s0, spy } = spyWindow();
    const dc = give(s0, 'p1', 'double-cross', { hand: true });
    expect(() => play(s0, 'p1', { card: dc, target: spy })).toThrow(/rival/);
  });
});

describe('Early Warning', () => {
  it('gives a Place +10 against a Disaster', () => {
    const s0 = scenario();
    const place = give(s0, 'p2', 'hollywood', { under: ill(s0, 1), side: 'BOTTOM' });
    const t = give(s0, 'p1', 'tornado', { hand: true });
    const ew = give(s0, 'p2', 'early-warning', { hand: true });
    let s = play(s0, 'p1', { card: t, target: place });
    const before = attackStrength(s, s.attack!).defense;
    s = play(s, 'p2', { card: ew });
    expect(attackStrength(s, s.attack!).defense - before).toBe(10);
  });
  it('only against Disasters', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 0), side: 'BOTTOM' });
    const g = give(s0, 'p2', 'hollywood', { under: ill(s0, 1), side: 'BOTTOM' });
    const ew = give(s0, 'p2', 'early-warning', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: g });
    expect(() => play(s, 'p2', { card: ew })).toThrow(/Disaster/);
  });
});

describe('Faction Fight', () => {
  it('plays the duplicate as agents, adds +5 and makes the attack Privileged', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 0), side: 'BOTTOM' });
    const g = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 1), side: 'BOTTOM' });
    const dup = give(s0, 'p1', 'loan-sharks', { hand: true });
    const ff = give(s0, 'p1', 'faction-fight', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: g, plots: [{ card: ff }] });
    const bonus = s.attack!.attackBonus.map((b) => b.amount).sort();
    expect(bonus).toEqual([10, 5]);
    expect(s.players[0].hand).not.toContain(dup);
    expect(s.attack!.plays.some((p) => p.effect.t === 'privileged')).toBe(true);
  });
  it('needs a duplicate of the target', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: ill(s0, 0), side: 'BOTTOM' });
    const g = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 1), side: 'BOTTOM' });
    const ff = give(s0, 'p1', 'faction-fight', { hand: true });
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: g, plots: [{ card: ff }] })).toThrow(/duplicate/);
  });
});

describe('Foiled!', () => {
  const goalId = Object.values(CARDS).find((c) => c.subtype === 'Goal')!.id;
  it('makes a rival discard an exposed Goal (Media action)', () => {
    const s0 = scenario();
    const media = give(s0, 'p1', 'cable-tv', { under: ill(s0, 0), side: 'BOTTOM' });
    const goal = give(s0, 'p2', goalId, { hand: true });
    s0.cards[goal].exposed = true;
    const f = give(s0, 'p1', 'foiled', { hand: true });
    const s = playResolve(s0, 'p1', { card: f, payWith: [media] });
    expect(s.cards[goal].zone).toBe('discard');
    expect(s.cards[media].tokens).toBe(0);
  });
  it('only exposed Goals, and only with a Media Group', () => {
    const s0 = scenario();
    const media = give(s0, 'p1', 'cable-tv', { under: ill(s0, 0), side: 'BOTTOM' });
    const goal = give(s0, 'p2', goalId, { hand: true });
    const f = give(s0, 'p1', 'foiled', { hand: true });
    expect(() => play(s0, 'p1', { card: f, payWith: [media] })).toThrow(/exposed Goal/);
    s0.cards[goal].exposed = true;
    expect(() => play(s0, 'p1', { card: f, payWith: [ill(s0, 0)] })).toThrow(/Media/);
  });
});

describe('Forgery', () => {
  it('brings in a duplicate Unique Resource; the other copy is discarded', () => {
    const s0 = scenario();
    const theirs = resourceOf(s0, 'p2', 'hammer-of-thor');
    const mine = give(s0, 'p1', 'hammer-of-thor', { hand: true });
    const f = give(s0, 'p1', 'forgery', { hand: true });
    const s = playResolve(s0, 'p1', { card: f });
    expect(s.cards[theirs].zone).toBe('discard');
    expect(s.cards[mine].zone).toBe('resources');
    expect(s.cards[mine].controller).toBe('p1');
  });
  it('needs a duplicate of a Unique Resource in play', () => {
    const s0 = scenario();
    give(s0, 'p1', 'hammer-of-thor', { hand: true });
    const f = give(s0, 'p1', 'forgery', { hand: true });
    expect(() => play(s0, 'p1', { card: f })).toThrow(/Unique Resource/);
  });
});

describe('Full Moon', () => {
  it('gives your Fanatic Groups and chosen others an Action token', () => {
    const s0 = scenario();
    const mine = give(s0, 'p1', 'moonies', { under: ill(s0, 0), side: 'BOTTOM' });
    const other = give(s0, 'p1', 'loan-sharks', { under: ill(s0, 0), side: 'LEFT' });
    const theirs = give(s0, 'p2', 'libertarians', { under: ill(s0, 1), side: 'BOTTOM' });
    for (const g of [mine, other, theirs]) s0.cards[g].tokens = 0;
    const fm = give(s0, 'p1', 'full-moon', { hand: true });
    const s = playResolve(s0, 'p1', { card: fm, targets: [theirs] });
    expect([s.cards[mine].tokens, s.cards[other].tokens, s.cards[theirs].tokens]).toEqual([1, 0, 1]);
  });
  it('the chosen extra Groups must be Fanatic', () => {
    const s0 = scenario();
    const g = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 1), side: 'BOTTOM' });
    const fm = give(s0, 'p1', 'full-moon', { hand: true });
    expect(() => play(s0, 'p1', { card: fm, targets: [g] })).toThrow(/Fanatic/);
  });
});

describe('Gremlins', () => {
  it('removes a Computer Group\'s token, or bounces a rival Gadget to hand', () => {
    const s0 = scenario();
    const vg = give(s0, 'p2', 'video-games', { under: ill(s0, 1), side: 'BOTTOM' });
    const gadget = resourceOf(s0, 'p2', 'cyborg-soldiers');
    const g1 = give(s0, 'p1', 'gremlins', { hand: true });
    const g2 = give(s0, 'p1', 'gremlins', { hand: true });
    let s = playResolve(s0, 'p1', { card: g1, target: vg, mode: 'computer' });
    expect(s.cards[vg].tokens).toBe(0);
    s = playResolve(s, 'p1', { card: g2, mode: 'gadget' });
    expect(s.cards[gadget].zone).toBe('hand');
    expect(s.players[1].hand).toContain(gadget);
  });
  it('cancels a Computer Group\'s action in an attack', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'hackers', { under: ill(s0, 0), side: 'BOTTOM' });
    const g = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 1), side: 'BOTTOM' });
    const gr = give(s0, 'p2', 'gremlins', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: g });
    s = play(s, 'p2', { card: gr, target: att, mode: 'computer' });
    s = finish(s, [1, 1]);
    expect(s.cards[g].controller).toBe('p2');
  });
  it('mode (a) needs a Computer Group', () => {
    const s0 = scenario();
    const g = give(s0, 'p2', 'loan-sharks', { under: ill(s0, 1), side: 'BOTTOM' });
    const gr = give(s0, 'p1', 'gremlins', { hand: true });
    expect(() => play(s0, 'p1', { card: gr, target: g, mode: 'computer' })).toThrow(/Computer/);
  });
});

describe('Hex', () => {
  it('destroys a rival\'s Magic Resource (Illuminati action)', () => {
    const s0 = scenario();
    const hammer = resourceOf(s0, 'p2', 'hammer-of-thor');
    const h = give(s0, 'p1', 'hex', { hand: true });
    const s = playResolve(s0, 'p1', { card: h, payWith: [ill(s0, 0)] });
    expect(s.cards[hammer].zone).toBe('discard');
  });
  it('needs a Magic Resource and a Magic Group with Power 3+', () => {
    const s0 = scenario();
    resourceOf(s0, 'p2', 'cyborg-soldiers');
    const h = give(s0, 'p1', 'hex', { hand: true });
    expect(() => play(s0, 'p1', { card: h, payWith: [ill(s0, 0)] })).toThrow(/Magic Resource/);
    resourceOf(s0, 'p2', 'hammer-of-thor');
    const druids = give(s0, 'p1', 'druids', { under: ill(s0, 0), side: 'BOTTOM' });
    expect(() => play(s0, 'p1', { card: h, payWith: [druids] })).toThrow(/Power 3/);
  });
});

describe('Resource categories', () => {
  it('read Magic, Artifact and Gadget from the card footer', () => {
    const s = scenario();
    expect(resourceKinds(s, resourceOf(s, 'p1', 'hammer-of-thor'))).toEqual(['Magic', 'Artifact']);
    expect(resourceKinds(s, resourceOf(s, 'p1', 'cyborg-soldiers'))).toEqual(['Gadget']);
    expect(resourceKinds(s, resourceOf(s, 'p1', 'the-frog-god'))).toEqual(['Magic', 'Artifact']);
    expect(resourceKinds(s, resourceOf(s, 'p1', 'xanadu'))).toEqual([]);
  });
});

describe('Full Moon (audit fix)', () => {
  it('adds a token even to Fanatic Groups that already have one, but not to Groups barred from tokens', () => {
    const s0 = scenario();
    const mine = give(s0, 'p1', 'moonies', { under: ill(s0, 0), side: 'BOTTOM' });
    const theirs = give(s0, 'p2', 'libertarians', { under: ill(s0, 1), side: 'BOTTOM' });
    s0.cards[mine].tokens = 1;
    s0.cards[theirs].tokens = 1;
    s0.cards[mine].mods.push({ source: 'test', kind: 'noTokens', until: 'permanent' });
    const fm = give(s0, 'p1', 'full-moon', { hand: true });
    const s = playResolve(s0, 'p1', { card: fm, targets: [theirs] });
    expect(s.cards[theirs].tokens).toBe(2);
    expect(s.cards[mine].tokens).toBe(1);
  });
});

describe('Combined Disasters (audit fix)', () => {
  it('adds the Power of an Epidemic used as the second Disaster', () => {
    const s0 = scenario();
    const place = give(s0, 'p2', 'hollywood', { under: ill(s0, 1), side: 'BOTTOM' });
    const t = give(s0, 'p1', 'tornado', { hand: true });
    const e = give(s0, 'p1', 'epidemic', { hand: true });
    const c = give(s0, 'p1', 'combined-disasters', { hand: true });
    const s = play(s0, 'p1', { card: c, target: place, targets: [t, e] });
    expect(s.attack?.instantCard).toBe(t);
    expect(s.attack?.attackBonus.some((b) => b.amount === 14)).toBe(true);
  });
});
