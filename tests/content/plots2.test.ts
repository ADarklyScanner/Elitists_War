import { describe, expect, it } from 'vitest';
import {
  applyAction, attackStrength, goalLimit, isPrivileged, meetsGoal, power, resistance, waitingFor, HOOKS,
  type Action, type GameState, type Side,
} from '../../src/engine';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const P = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!;

/** Pass for everyone until the window closes (and the attack is over), forcing the dice if given. */
function passAll(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 30 && s.window; i++) {
    if (dice && s.window.kind === 'roll' && s.attack?.roll) s.attack.roll = dice;
    s = applyAction(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}

let k = 0;
/** Put a Group into a player's structure without caring about the layout (Goal counting only). */
function put(s: GameState, pl: string, cardId: string): string {
  const iid = `x${++k}`;
  s.cards[iid] = { iid, cardId, owner: pl, zone: 'structure', controller: pl, master: ill(s, pl), x: 100 + k, y: 100, rot: 0, tokens: 1, mods: [] };
  return iid;
}
/** A Group this player destroyed. */
function destroyed(s: GameState, pl: string, cardId: string): string {
  const iid = `d${++k}`;
  s.cards[iid] = { iid, cardId, owner: pl === 'p1' ? 'p2' : 'p1', zone: 'destroyed', tokens: 0, mods: [] };
  P(s, pl).destroyedCredit.push(iid);
  return iid;
}
const under = (s: GameState, pl: string, cardId: string, side: Side = 'BOTTOM') => give(s, pl, cardId, { under: ill(s, pl), side });
/** Put an NWO straight into play. */
function nwoInPlay(s: GameState, pl: string, cardId: string, color: string) {
  const n = give(s, pl, cardId, { hand: true });
  P(s, pl).hand = P(s, pl).hand.filter((x) => x !== n);
  Object.assign(s.cards[n], { zone: 'table', controller: pl, linkedTo: 'nwo' });
  s.nwo[color] = n;
  return n;
}

describe('Goals', () => {
  it('Criminal Overlords counts Violent Criminal Groups twice', () => {
    const s = scenario();
    s.settings.basicGoal = 5;
    give(s, 'p1', 'criminal-overlords', { hand: true });
    put(s, 'p1', 'loan-sharks');
    const other = put(s, 'p1', 'nato'); // Violent only
    expect(meetsGoal(s, 'p1')).toBeNull();
    s.cards[other].cardId = 'the-mafia';
    expect(meetsGoal(s, 'p1')).toMatch(/Criminal Overlords/);
  });
  it('Hail Eris counts Weird Groups of Power 3+ twice', () => {
    const s = scenario();
    s.settings.basicGoal = 4;
    give(s, 'p1', 'hail-eris', { hand: true });
    const g = put(s, 'p1', 'psychiatrists'); // Weird, Power 2
    put(s, 'p1', 'dentists');
    expect(meetsGoal(s, 'p1')).toBeNull();
    s.cards[g].mods.push({ source: 'x', kind: 'power', value: 1, until: 'permanent' });
    expect(meetsGoal(s, 'p1')).toMatch(/Hail Eris/);
  });
  it('The Corporate Masters counts Corporate Groups of Power 4+ twice', () => {
    const s = scenario();
    s.settings.basicGoal = 4;
    const g = give(s, 'p1', 'the-corporate-masters', { hand: true });
    put(s, 'p1', 'liquor-companies'); // Power 3
    put(s, 'p1', 'dentists');
    expect(meetsGoal(s, 'p1')).toBeNull();
    put(s, 'p1', 'wall-street'); // Power 4 → 1 + 1 + 1 + 2 = 5
    s.settings.basicGoal = 5;
    expect(meetsGoal(s, 'p1')).toMatch(/Corporate Masters/);
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: g } })).toThrow();
  });
  it('Kill for Peace: destroyed Violent and controlled Peaceful combinations', () => {
    const s = scenario();
    give(s, 'p1', 'kill-for-peace', { hand: true });
    for (const id of ['nato', 'urban-gangs', 'cycle-gangs', 'gun-lobby', 'kkk']) destroyed(s, 'p1', id);
    put(s, 'p1', 'red-cross'); put(s, 'p1', 'boy-sprouts');
    expect(meetsGoal(s, 'p1')).toBeNull(); // 5 + 2: needs 3 Peaceful
    destroyed(s, 'p1', 'loan-sharks');
    expect(meetsGoal(s, 'p1')).toMatch(/Kill for Peace/); // 6 + 1
  });
  it('Kill for Peace: 4 destroyed and 4 controlled; destroyed non-Violent Groups do not count', () => {
    const s = scenario();
    give(s, 'p1', 'kill-for-peace', { hand: true });
    for (const id of ['nato', 'urban-gangs', 'cycle-gangs']) destroyed(s, 'p1', id);
    destroyed(s, 'p1', 'dentists');
    for (const id of ['red-cross', 'boy-sprouts', 'moonies', 'a-m-a']) put(s, 'p1', id);
    expect(meetsGoal(s, 'p1')).toBeNull();
    destroyed(s, 'p1', 'kkk');
    expect(meetsGoal(s, 'p1')).toMatch(/Kill for Peace/);
  });
  it('Let Them Eat Cake, Power to the People, Hand of Madness, Up Against the Wall', () => {
    const cases: [string, string[], string[]][] = [
      ['let-them-eat-cake', ['feminists', 'democrats'], ['republicans', 'fraternal-orders', 'opec', 'templars', 'gun-lobby', 'kkk']],
      ['power-to-the-people', ['republicans', 'opec', 'kkk'], ['democrats', 'feminists', 'eff', 'united-nations', 'black-activists']],
      ['the-hand-of-madness', ['red-cross', 'boy-sprouts', 'moonies', 'a-m-a'], ['nato', 'urban-gangs', 'cycle-gangs', 'kkk']],
      ['up-against-the-wall', ['nasa', 'mi-5', 'c-i-a', 'post-office', 'federal-reserve'], ['nato', 'urban-gangs', 'cycle-gangs']],
    ];
    for (const [goal, dead, mine] of cases) {
      const s = scenario();
      give(s, 'p1', goal, { hand: true });
      for (const id of dead) destroyed(s, 'p1', id);
      const g = mine.map((id) => put(s, 'p1', id));
      expect(meetsGoal(s, 'p1'), goal).toMatch(/destroyed/);
      s.cards[g[0]].zone = 'discard'; s.cards[g[0]].controller = undefined;
      expect(meetsGoal(s, 'p1'), goal).toBeNull();
    }
  });
  it('Power for its Own Sake: 50 Power including the Illuminati', () => {
    const s = scenario();
    give(s, 'p1', 'power-for-its-own-sake', { hand: true });
    const illPower = power(s, ill(s, 'p1'), { goals: true });
    let total = illPower;
    const ids = ['the-mafia', 'c-i-a', 'cfl-aio', 'democrats', 'multinational-oil-companies', 'pentagon', 'japan', 'new-york', 'republicans', 'federal-reserve'];
    let last = '';
    for (const id of ids) { if (total >= 50) break; last = put(s, 'p1', id); total += power(s, last, { goals: true }); }
    expect(total).toBeGreaterThanOrEqual(50);
    expect(meetsGoal(s, 'p1')).toMatch(/Power/);
    s.cards[last].devastated = true; // a Devastated Place (or anything) does not count
    if (total - power(s, last, { goals: true }) < 50) expect(meetsGoal(s, 'p1')).toBeNull();
  });
  it('Alternate Goals: held in hand, two Goals may be held and either one wins', () => {
    const s = scenario();
    const alt = give(s, 'p1', 'alternate-goals', { hand: true });
    give(s, 'p1', 'hail-eris', { hand: true });
    give(s, 'p1', 'kill-for-peace', { hand: true });
    expect(goalLimit(s, 'p1')).toBe(2);
    for (const id of ['nato', 'urban-gangs', 'cycle-gangs', 'gun-lobby', 'kkk', 'loan-sharks']) destroyed(s, 'p1', id);
    put(s, 'p1', 'red-cross');
    expect(meetsGoal(s, 'p1')).toMatch(/Kill for Peace/);
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: alt } })).toThrow();
  });
});

describe('New World Orders', () => {
  it('Peace in Our Time: Peaceful +1 (+3 vs destroy), +3 Resistance in a structure, Violent/Criminal -1', () => {
    const s0 = scenario();
    const card = give(s0, 'p1', 'peace-in-our-time', { hand: true });
    const rc = under(s0, 'p2', 'red-cross');
    const ls = under(s0, 'p1', 'loan-sharks');
    const handPeace = give(s0, 'p1', 'boy-sprouts', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card } });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.nwo.red).toBe(card);
    expect(power(s, rc)).toBe(3);
    expect(power(s, ls)).toBe(2); // Violent and Criminal: -1 once
    expect(resistance(s, rc)).toBe(4 + 3);
    expect(resistance(s, handPeace)).toBe(3); // not in a Power Structure
    const off = structuredClone(s0);
    const a = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: ls, target: rc });
    const b = act(off, 'p1', { type: 'attack', attackType: 'destroy', attacker: ls, target: rc });
    expect(attackStrength(a, a.attack!).defense - attackStrength(b, b.attack!).defense).toBe(3);
  });
  it('Tax Reform: the I.R.S. gets +10 defense and taxes each Plot deck at the start of its turn', () => {
    const s0 = scenario();
    const irs = under(s0, 'p1', 'i-r-s');
    const card = give(s0, 'p1', 'tax-reform', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card } });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.nwo.red).toBe(card);
    const att = under(s, 'p2', 'the-mafia');
    const noTax = structuredClone(s);
    noTax.nwo = {}; noTax.cards[card].zone = 'discard'; noTax.cards[card].linkedTo = undefined;
    // Defense
    s.active = 1;
    const a = act(s, 'p2', { type: 'attack', attackType: 'destroy', attacker: att, target: irs });
    expect(attackStrength(a, a.attack!).lines).toContain('Defense +10: Tax Reform');
    // Tax at the start of p1's turn
    const run = (st: GameState) => {
      st.active = 1; st.attack = undefined; st.window = undefined;
      let x = act(st, 'p2', { type: 'endTurn' });
      x = passAll(x);
      return x;
    };
    const before = { p1: P(s, 'p1').plotDeck.length, p2: P(s, 'p2').plotDeck.length, hand: P(s, 'p1').hand.length };
    const taxed = run(s);
    expect(taxed.players[taxed.active].id).toBe('p1');
    expect(P(taxed, 'p2').plotDeck.length).toBe(before.p2 - 1);
    const plain = run(noTax);
    expect(P(plain, 'p1').plotDeck.length - P(taxed, 'p1').plotDeck.length).toBe(1); // taxed his own deck too
    expect(P(plain, 'p2').plotDeck.length).toBe(before.p2);
    expect(P(taxed, 'p1').hand.length - P(plain, 'p1').hand.length).toBe(2);
    expect(HOOKS['i-r-s'].onTurnStart).toBeDefined();
  });
  it('World War Three: Nation vs Nation Power x3; success draws a Plot and gives a token', () => {
    const s0 = scenario();
    const card = give(s0, 'p1', 'world-war-three', { hand: true });
    const jp = under(s0, 'p1', 'japan');
    const fi = under(s0, 'p2', 'finland');
    let s = act(s0, 'p1', { type: 'playPlot', play: { card } });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.nwo.yellow).toBe(card);
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: jp, target: fi });
    expect(attackStrength(s, s.attack!).lines).toContain('Attack +12: World War Three');
    const hand = P(s, 'p1').hand.length;
    s = passAll(s, [1, 1]);
    expect(s.cards[fi].zone).toBe('destroyed');
    expect(P(s, 'p1').hand.length).toBe(hand + 1);
    expect(s.cards[jp].tokens).toBe(1);
  });
  it('World War Three: a failed war destroys the attacker, credited to the defender; non-Nations are unaffected', () => {
    const s0 = scenario();
    nwoInPlay(s0, 'p1', 'world-war-three', 'yellow');
    const jp = under(s0, 'p1', 'japan');
    const fi = under(s0, 'p2', 'finland');
    const ls = under(s0, 'p1', 'loan-sharks', 'TOP');
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: jp, target: fi });
    s = passAll(s, [6, 6]);
    expect(s.cards[jp].zone).toBe('destroyed');
    expect(P(s, 'p2').destroyedCredit).toContain(jp);
    const t = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: ls, target: fi });
    expect(attackStrength(t, t.attack!).lines.some((l) => l.includes('World War Three'))).toBe(false);
  });
});

describe('Plots', () => {
  it('18 1/2-Minute Gap: the Plot has no effect and goes to your hand', () => {
    const s0 = scenario();
    const bank = under(s0, 'p1', 'wall-street');
    const bm = give(s0, 'p1', 'bank-merger', { hand: true });
    const gap = give(s0, 'p2', '18-1-2-minute-gap', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card: bm } });
    const discards = P(s, 'p2').discard.length;
    s = act(s, 'p2', { type: 'playPlot', play: { card: gap, target: bm } });
    s = passAll(s);
    expect(s.cards[bank].tokens).toBe(1);
    expect(P(s, 'p2').hand).toContain(bm);
    expect(s.cards[ill(s, 'p2')].tokens).toBe(0);
    expect(P(s, 'p2').discard.length).toBe(discards + 3); // top Plot, top Group, and the Gap itself
  });
  it('18 1/2-Minute Gap needs an Illuminati token and another player\'s Plot', () => {
    const s0 = scenario();
    under(s0, 'p1', 'wall-street');
    const bm = give(s0, 'p1', 'bank-merger', { hand: true });
    const gap = give(s0, 'p2', '18-1-2-minute-gap', { hand: true });
    const own = give(s0, 'p1', '18-1-2-minute-gap', { hand: true });
    const s = act(s0, 'p1', { type: 'playPlot', play: { card: bm } });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: own, target: bm } })).toThrow();
    s.cards[ill(s, 'p2')].tokens = 0;
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card: gap, target: bm } })).toThrow(/Illuminati/);
  });
  it('Agent in Place: a rival discards the hidden Plot you choose', () => {
    const s0 = scenario();
    const big = under(s0, 'p1', 'the-mafia');
    const small = under(s0, 'p1', 'dentists', 'TOP');
    const card = give(s0, 'p1', 'agent-in-place', { hand: true });
    const victim = give(s0, 'p2', 'reload', { hand: true });
    give(s0, 'p2', 'tornado', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: victim, payWith: [small] } })).toThrow(/Power 4/);
    let s = act(s0, 'p1', { type: 'playPlot', play: { card, target: victim, payWith: [big] } });
    s = passAll(s);
    expect(s.cards[victim].zone).toBe('discard');
    expect(s.cards[big].tokens).toBe(0);
  });
  it('Air Magic triples a Place\'s Power against a Disaster, but not an Earthquake', () => {
    const s0 = scenario();
    const place = under(s0, 'p2', 'hollywood');
    const t = give(s0, 'p1', 'tornado', { hand: true });
    const am = give(s0, 'p2', 'air-magic', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card: t, target: place } });
    const before = attackStrength(s, s.attack!).defense;
    s = act(s, 'p2', { type: 'playPlot', play: { card: am, mode: 'deck' } });
    expect(attackStrength(s, s.attack!).defense - before).toBe(2 * power(s, place, { defense: true }));
    const s1 = scenario();
    const p1 = under(s1, 'p2', 'hollywood');
    const eq = give(s1, 'p1', 'earthquake', { hand: true });
    const am1 = give(s1, 'p2', 'air-magic', { hand: true });
    const e = act(s1, 'p1', { type: 'playPlot', play: { card: eq, target: p1 } });
    expect(() => act(e, 'p2', { type: 'playPlot', play: { card: am1, mode: 'deck' } })).toThrow(/Earthquake/);
  });
  it('Angst sets a Place or Organization to Power 1 and stays linked', () => {
    const s0 = scenario();
    const psy = under(s0, 'p1', 'psychiatrists');
    const mafia = under(s0, 'p2', 'the-mafia');
    const card = give(s0, 'p1', 'angst', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: mafia } })).toThrow(/Psychiatrists/);
    let s = act(s0, 'p1', { type: 'playPlot', play: { card, target: mafia, payWith: [psy] } });
    s = passAll(s);
    expect(power(s, mafia)).toBe(1);
    expect(s.cards[card].linkedTo).toBe(mafia);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
    expect(s.cards[psy].tokens).toBe(0);
  });
  it('Angst: not a Personality, and not during an attack', () => {
    const s0 = scenario();
    const psy = under(s0, 'p1', 'psychiatrists');
    const bill = under(s0, 'p2', 'bill-clinton');
    const card = give(s0, 'p1', 'angst', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: bill, payWith: [psy] } })).toThrow(/Place or Organization/);
  });
  it('Atomic Monster: Disaster vs Coastal Places with 16/20/24 Power', () => {
    const s0 = scenario();
    const hw = under(s0, 'p2', 'hawaii');
    const jp = under(s0, 'p2', 'japan', 'TOP');
    const en = under(s0, 'p2', 'england', 'LEFT');
    const lv = under(s0, 'p2', 'las-vegas', 'RIGHT');
    const card = give(s0, 'p1', 'atomic-monster', { hand: true });
    expect(act(s0, 'p1', { type: 'playPlot', play: { card, target: hw } }).attack!.instantPower).toBe(20);
    expect(act(s0, 'p1', { type: 'playPlot', play: { card, target: jp } }).attack!.instantPower).toBe(24);
    const e = act(s0, 'p1', { type: 'playPlot', play: { card, target: en } });
    expect(e.attack!.instantPower).toBe(16);
    expect(e.attack!.disaster!.destroyMargin).toBe(7);
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: lv } })).toThrow(/Coastal/);
  });
  it('Atomic Monster: +10 to an attack to destroy the Nuclear Power Companies only', () => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'the-mafia');
    const npc = under(s0, 'p2', 'nuclear-power-companies');
    const other = under(s0, 'p2', 'loan-sharks', 'TOP');
    const card = give(s0, 'p2', 'atomic-monster', { hand: true });
    const a = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: npc });
    const before = attackStrength(a, a.attack!).attack;
    const b = act(a, 'p2', { type: 'playPlot', play: { card, mode: 'boost' } });
    expect(attackStrength(b, b.attack!).attack - before).toBe(10);
    expect(waitingFor(b)).toContain('p1');
    const c = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: other });
    expect(() => act(c, 'p2', { type: 'playPlot', play: { card, mode: 'boost' } })).toThrow(/Robot Sea Monsters/);
  });
  it('Backlash undoes a Plot\'s change and discards that Plot', () => {
    const s0 = scenario();
    const tgt = under(s0, 'p2', 'liquor-companies');
    const mono = give(s0, 'p2', 'monopoly', { hand: true });
    P(s0, 'p2').hand = [];
    Object.assign(s0.cards[mono], { zone: 'table', controller: 'p2', linkedTo: tgt });
    s0.cards[tgt].mods.push({ source: mono, kind: 'setPower', value: 6, until: 'permanent' });
    const payer = under(s0, 'p1', 'fast-food-chains');
    const wrong = under(s0, 'p1', 'loan-sharks', 'TOP');
    const card = give(s0, 'p1', 'backlash', { hand: true });
    expect(power(s0, tgt)).toBe(6);
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: tgt, payWith: [wrong] } })).toThrow(/alignment/);
    let s = act(s0, 'p1', { type: 'playPlot', play: { card, target: tgt, payWith: [payer] } });
    s = passAll(s);
    expect(power(s, tgt)).toBe(3);
    expect(s.cards[mono].zone).toBe('discard');
  });
  it('Backlash does not undo New World Order changes', () => {
    const s0 = scenario();
    nwoInPlay(s0, 'p1', 'peace-in-our-time', 'red');
    const tgt = under(s0, 'p2', 'red-cross');
    const payer = under(s0, 'p1', 'boy-sprouts');
    const card = give(s0, 'p1', 'backlash', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: tgt, payWith: [payer] } })).toThrow(/No Plot/);
  });
  it('Bank Merger gives every Bank Group a token, even one that has one', () => {
    const s0 = scenario();
    const ws = under(s0, 'p1', 'wall-street');
    const ob = under(s0, 'p1', 'offshore-banks', 'TOP');
    s0.cards[ob].tokens = 0;
    const card = give(s0, 'p1', 'bank-merger', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card } });
    s = passAll(s);
    expect(s.cards[ws].tokens).toBe(2);
    expect(s.cards[ob].tokens).toBe(1);
    const s1 = scenario();
    const c1 = give(s1, 'p1', 'bank-merger', { hand: true });
    expect(() => act(s1, 'p1', { type: 'playPlot', play: { card: c1 } })).toThrow(/Bank/);
  });
  it('Bimbo at Eleven: +5 and Privileged for a Media attack on a male Personality; he never returns', () => {
    const s0 = scenario();
    const media = under(s0, 'p1', 'big-media');
    const bill = under(s0, 'p2', 'bill-clinton');
    const card = give(s0, 'p1', 'bimbo-at-eleven', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: media, target: bill, plots: [{ card }] });
    expect(isPrivileged(s.attack!)).toBe(true);
    expect(attackStrength(s, s.attack!).lines).toContain('Attack +5: Bimbo at Eleven');
    s.attack!.attackBonus.push({ player: 'p1', amount: 20, label: 'test' });
    s = passAll(s, [1, 1]);
    expect(s.cards[bill].zone).toBe('destroyed');
    expect(s.cards[bill].data?.neverReturns).toBe(true);
    expect(s.cards[card].zone).toBe('discard');
  });
  it('Bimbo at Eleven: not against a female Personality or with a non-Media attacker', () => {
    const s0 = scenario();
    const media = under(s0, 'p1', 'big-media');
    const mafia = under(s0, 'p1', 'the-mafia', 'TOP');
    const hil = under(s0, 'p2', 'hillary-clinton');
    const bill = under(s0, 'p2', 'bill-clinton', 'TOP');
    const card = give(s0, 'p1', 'bimbo-at-eleven', { hand: true });
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: media, target: hil, plots: [{ card }] })).toThrow(/male/);
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: mafia, target: bill, plots: [{ card }] })).toThrow(/Media/);
  });
  it('Blitzkrieg gives a Group captured this turn a token', () => {
    const s0 = scenario();
    const g = under(s0, 'p1', 'loan-sharks');
    const card = give(s0, 'p1', 'blitzkrieg', { hand: true });
    s0.cards[g].tokens = 0;
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: g } })).toThrow(/this turn/);
    s0.cards[g].capturedTurn = s0.turn;
    let s = act(s0, 'p1', { type: 'playPlot', play: { card, target: g } });
    s = passAll(s);
    expect(s.cards[g].tokens).toBe(1);
  });
  it('Blood, Toil, Tears and Sweat discards an NWO, paid by 4 Power of Media Groups', () => {
    const s0 = scenario();
    const n = nwoInPlay(s0, 'p2', 'peace-in-our-time', 'red');
    const big = under(s0, 'p1', 'big-media');
    const cable = under(s0, 'p1', 'cable-tv', 'TOP');
    const card = give(s0, 'p1', 'blood-toil-tears-and-sweat', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card, target: n, payWith: [cable] } })).toThrow(/4 Power/);
    let s = act(s0, 'p1', { type: 'playPlot', play: { card, mode: 'red', payWith: [big] } });
    s = passAll(s);
    expect(s.nwo.red).toBeUndefined();
    expect(s.cards[n].zone).toBe('discard');
  });
  it('Bodyguard: the Assassination fails and the Personality gets +6 against attempts to destroy', () => {
    const s0 = scenario();
    const bill = under(s0, 'p2', 'bill-clinton');
    const sn = give(s0, 'p1', 'sniper', { hand: true });
    const bg = give(s0, 'p2', 'bodyguard', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card: sn, target: bill } });
    s.attack!.attackBonus.push({ player: 'p1', amount: 30, label: 'test' });
    s = act(s, 'p2', { type: 'playPlot', play: { card: bg } });
    s = passAll(s, [1, 1]);
    expect(s.cards[bill].zone).toBe('structure');
    expect(s.cards[bg].linkedTo).toBe(bill);
    const att = under(s, 'p1', 'the-mafia');
    const a = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: bill });
    expect(attackStrength(a, a.attack!).lines).toContain('Defense +6: Bodyguard');
  });
  it('Bodyguard only answers an Assassination', () => {
    const s0 = scenario();
    const place = under(s0, 'p2', 'hollywood');
    const t = give(s0, 'p1', 'tornado', { hand: true });
    const bg = give(s0, 'p2', 'bodyguard', { hand: true });
    const s = act(s0, 'p1', { type: 'playPlot', play: { card: t, target: place } });
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card: bg } })).toThrow(/Assassination/);
  });
});
