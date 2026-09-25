// Coverage for Plot cards that had no test of their own (audit of plots.ts families and NWOs).
// Each card gets its main effect and at least one restriction, checked against the printed card.
import { describe, expect, it } from 'vitest';
import {
  alignments, applyAction, attackCancelled, attackStrength, createGame, finalRoll, isPrivileged, participants,
  power, resistance, waitingFor, CARDS,
  type Action, type GameState, type PlotPlay, type Side,
} from '../../src/engine';
import { randomDeck } from '../../src/engine/decks';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const play = (s: GameState, pl: string, p: PlotPlay) => act(s, pl, { type: 'playPlot', play: p });
const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const ill = (s: GameState, id: string) => P(s, id).illuminati;
const under = (s: GameState, pl: string, cardId: string, side: Side = 'BOTTOM') => give(s, pl, cardId, { under: ill(s, pl), side });

/** Play a non-attack Plot and let the others pass on the counter window. */
function playAndResolve(s: GameState, who: string, p: PlotPlay): GameState {
  s = play(s, who, p);
  for (let i = 0; i < 10 && s.window?.kind === 'plot' && !s.prompt; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** Pass until the roll window of the current attack is open. */
function toRoll(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 10 && s.window?.kind === 'attack'; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  if (dice && s.attack?.roll) s.attack.roll = dice;
  return s;
}
/** Pass through the rest of an attack, forcing the dice. */
function finish(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** Pass in open response windows until the game needs a decision (or nothing is open). */
function drain(s: GameState): GameState {
  for (let i = 0; i < 30 && s.window && !s.prompt; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** Put a Group three steps below its Illuminati (no closeness bonus). */
function deep(s: GameState, who: string, cardId: string): string {
  const a = give(s, who, 'punk-rockers', { under: ill(s, who), side: 'BOTTOM' });
  const b = give(s, who, 'l-4-society', { under: a, side: 'BOTTOM' });
  return give(s, who, cardId, { under: b, side: 'BOTTOM' as Side });
}
/** Put an NWO straight onto the table. */
function nwoInPlay(s: GameState, pl: string, cardId: string, color: string) {
  const n = give(s, pl, cardId, { hand: true });
  P(s, pl).hand = P(s, pl).hand.filter((x) => x !== n);
  Object.assign(s.cards[n], { zone: 'table', controller: pl, linkedTo: 'nwo' });
  s.nwo[color] = n;
  return n;
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
/** The alignment modifier of the attack in progress. */
function alignmentMod(s: GameState): number {
  const line = attackStrength(s, s.attack!).lines.find((l) => l.endsWith(': alignments'));
  return line ? Number(line.split(':')[0].replace('Attack ', '')) : 0;
}

// ============================================================ New World Orders

describe('NWO: A Thousand Points of Light', () => {
  const setup = (type: 'control' | 'destroy', target: string, withNwo: boolean) => {
    const s = scenario();
    if (withNwo) nwoInPlay(s, 'p1', 'a-thousand-points-of-light', 'blue');
    const att = under(s, 'p1', 'the-mafia'); // Criminal, Violent
    const tgt = deep(s, 'p2', target);
    return alignmentMod(act(s, 'p1', { type: 'attack', attackType: type, attacker: att, target: tgt }));
  };
  it('opposed alignments count for nothing, on control and on destroy', () => {
    expect(setup('control', 'red-cross', false)).toBe(-4); // Violent vs Peaceful
    expect(setup('control', 'red-cross', true)).toBe(0);
    expect(setup('destroy', 'red-cross', false)).toBe(4);
    expect(setup('destroy', 'red-cross', true)).toBe(0);
  });
  it('shared alignments keep their usual effect', () => {
    expect(setup('control', 'loan-sharks', true)).toBe(8);
    expect(setup('control', 'loan-sharks', false)).toBe(8);
  });
});

describe('NWO: Fear and Loathing', () => {
  const setup = (type: 'control' | 'destroy', target: string) => {
    const s = scenario();
    nwoInPlay(s, 'p1', 'fear-and-loathing', 'blue');
    const att = under(s, 'p1', 'nato'); // Violent only
    const tgt = deep(s, 'p2', target);
    return alignmentMod(act(s, 'p1', { type: 'attack', attackType: type, attacker: att, target: tgt }));
  };
  it('identical alignments give +8 to control and -8 to destroy', () => {
    expect(setup('control', 'urban-gangs')).toBe(8);
    expect(setup('destroy', 'urban-gangs')).toBe(-8);
  });
  it('opposed alignments give -8 to control and +8 to destroy; unrelated ones nothing', () => {
    expect(setup('control', 'red-cross')).toBe(-8);
    expect(setup('destroy', 'red-cross')).toBe(8);
    expect(setup('control', 'dentists')).toBe(0);
  });
});

describe('NWO: Chicken in Every Pot', () => {
  it('Banks and Coastal Places +2, Violent Groups -1', () => {
    const s = scenario();
    const bank = under(s, 'p1', 'offshore-banks', 'BOTTOM');
    const coast = under(s, 'p1', 'hawaii', 'LEFT');
    const violent = under(s, 'p1', 'nato', 'RIGHT');
    const both = under(s, 'p2', 'new-york', 'BOTTOM'); // Coastal Place and Violent
    const before = [bank, coast, violent, both].map((g) => power(s, g));
    const card = give(s, 'p1', 'chicken-in-every-pot', { hand: true });
    const t = playAndResolve(s, 'p1', { card });
    expect(t.nwo.blue).toBe(card);
    expect([bank, coast, violent, both].map((g) => power(t, g) - before[[bank, coast, violent, both].indexOf(g)])).toEqual([2, 2, -1, 1]);
  });
  it('an inland Place and a plain Group are unchanged', () => {
    const s = scenario();
    const inland = under(s, 'p1', 'las-vegas', 'BOTTOM');
    const plain = under(s, 'p1', 'dentists', 'LEFT');
    nwoInPlay(s, 'p1', 'chicken-in-every-pot', 'blue');
    expect(power(s, inland)).toBe(CARDS['las-vegas'].power);
    expect(power(s, plain)).toBe(CARDS['dentists'].power);
  });
});

describe("NWO: Don't Forget to Smash the State", () => {
  it('Government -3, Straight non-Government -2, others unchanged', () => {
    const s = scenario();
    const gov = under(s, 'p1', 'federal-reserve', 'BOTTOM'); // Government
    const straightGov = under(s, 'p1', 'fbi', 'LEFT'); // Straight Government: only -3
    const straight = under(s, 'p1', 'tobacco-companies', 'RIGHT'); // Straight
    const other = under(s, 'p2', 'the-mafia', 'BOTTOM');
    const ids = [gov, straightGov, straight, other];
    const before = ids.map((g) => power(s, g));
    const card = give(s, 'p1', 'don-t-forget-to-smash-the-state', { hand: true });
    const t = playAndResolve(s, 'p1', { card });
    expect(t.nwo.yellow).toBe(card);
    expect(ids.map((g, i) => power(t, g) - before[i])).toEqual([-3, -3, -2, 0]);
  });
});

describe('NWO: Energy Crisis', () => {
  it('Corporate -2 Power; Green -1 Power and -1 Resistance', () => {
    const s = scenario();
    const corp = under(s, 'p1', 'wall-street', 'BOTTOM');
    const green = under(s, 'p1', 'anti-nuclear-activists', 'LEFT');
    const card = give(s, 'p1', 'energy-crisis', { hand: true });
    const t = playAndResolve(s, 'p1', { card });
    expect(t.nwo.blue).toBe(card);
    expect(power(t, corp)).toBe(power(s, corp) - 2);
    expect(resistance(t, corp)).toBe(resistance(s, corp)); // Corporate loses no Resistance
    expect(power(t, green)).toBe(power(s, green) - 1);
    expect(resistance(t, green)).toBe(resistance(s, green) - 1);
  });
  it('cannot be played during an Instant attack', () => {
    const s0 = scenario();
    const place = under(s0, 'p2', 'hollywood');
    const t = give(s0, 'p1', 'tornado', { hand: true });
    const card = give(s0, 'p2', 'energy-crisis', { hand: true });
    const s = play(s0, 'p1', { card: t, target: place });
    expect(() => play(s, 'p2', { card })).toThrow();
  });
});

describe('NWO: Gun Control', () => {
  it('Violent Government +3, Criminal +1; Violent-only Groups unchanged', () => {
    const s = scenario();
    const vg = under(s, 'p1', 'c-i-a', 'BOTTOM'); // Violent Government
    const crim = under(s, 'p1', 'offshore-banks', 'LEFT'); // Criminal
    const all = under(s, 'p1', 'new-york', 'RIGHT'); // Violent Criminal Government: +4
    const violent = under(s, 'p2', 'nato', 'BOTTOM');
    const gov = under(s, 'p2', 'nasa', 'LEFT');
    const ids = [vg, crim, all, violent, gov];
    const before = ids.map((g) => power(s, g));
    const card = give(s, 'p1', 'gun-control', { hand: true });
    const t = playAndResolve(s, 'p1', { card });
    expect(t.nwo.red).toBe(card);
    expect(ids.map((g, i) => power(t, g) - before[i])).toEqual([3, 1, 4, 0, 0]);
  });
});

// ============================================================ +10 Power or Resistance

describe('+10 Power or Resistance family', () => {
  const cases: [string, string, string][] = [
    ['albino-alligators', 'psychiatrists', 'dentists'], // Weird
    ['benefit-concert', 'feminists', 'dentists'], // Liberal
    ['cold-fusion', 'a-m-a', 'red-cross'], // Science
    ['harmonica-virgins', 'druids', 'dentists'], // Magic
    ['jihad', 'libertarians', 'dentists'], // Fanatic
    ['just-say-no', 'dentists', 'psychiatrists'], // Straight
    ['martial-law', 'nasa', 'dentists'], // Government
    ['martyrs', 'red-cross', 'nato'], // Peaceful
    ['pulitzer-prize', 'tabloids', 'dentists'], // Media
    ['save-the-whales', 'joggers', 'dentists'], // Green
    ['slush-fund', 'fraternal-orders', 'feminists'], // Conservative
    ['terrorist-nuke', 'nato', 'red-cross'], // Violent
    ['world-cup-victory', 'finland', 'hollywood'], // Nation
  ];
  for (const [card, good, bad] of cases) {
    it(`${card}: +10 Power when declared with an attack by a ${good}`, () => {
      const s0 = scenario();
      const att = under(s0, 'p1', good);
      const tgt = deep(s0, 'p2', 'loan-sharks');
      const c = give(s0, 'p1', card, { hand: true });
      const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt, plots: [{ card: c, target: att, mode: 'power' }] });
      expect(s.attack!.attackBonus.find((b) => b.plot === c)?.amount).toBe(10);
    });
    it(`${card}: +10 Resistance for defense until end of turn, not for Goals`, () => {
      const s0 = scenario();
      const g = under(s0, 'p1', good);
      const c = give(s0, 'p1', card, { hand: true });
      const s = playAndResolve(s0, 'p1', { card: c, target: g, mode: 'resistance' });
      expect(resistance(s, g)).toBe(resistance(s0, g) + 10);
      expect(resistance(s, g, { goals: true })).toBe(resistance(s0, g, { goals: true }));
      expect(s.cards[g].mods.find((m) => m.source === c)?.until).toBe('endOfTurn');
    });
    it(`${card}: refused on a ${bad} or on a rival's Group`, () => {
      const s = scenario();
      const wrong = under(s, 'p1', bad);
      const theirs = under(s, 'p2', good);
      const c = give(s, 'p1', card, { hand: true });
      expect(() => play(s, 'p1', { card: c, target: wrong, mode: 'power' })).toThrow(/Group you control/);
      expect(() => play(s, 'p1', { card: c, target: theirs, mode: 'power' })).toThrow(/Group you control/);
    });
  }
  it('a Power boost cannot be added to an attack after it was declared', () => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'nato');
    const tgt = deep(s0, 'p2', 'loan-sharks');
    const c = give(s0, 'p1', 'terrorist-nuke', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    expect(() => play(s, 'p1', { card: c, target: att, mode: 'power' })).toThrow(/declared/);
  });
});

// ============================================================ Action tokens (reload family, R019 errata)

describe('Reload family: a token for each of your Groups of one alignment', () => {
  const cases: [string, string, string][] = [
    ['dollars-for-decency', 'dentists', 'deprogrammers'], // Straight
    ['flower-power', 'red-cross', 'boy-sprouts'], // Peaceful
    ['freaking-the-mundanes', 'psychiatrists', 'gay-activists'], // Weird
    ['gang-war', 'offshore-banks', 'telephone-psychics'], // Criminal
    ['new-federal-budget', 'nasa', 'mi-5'], // Government
    ['pledge-drive', 'feminists', 'united-nations'], // Liberal
    ['red-scare', 'fraternal-orders', 'gun-lobby'], // Conservative
    ['tax-breaks', 'fast-food-chains', 'recording-industry'], // Corporate
  ];
  for (const [card, a, b] of cases) {
    it(`${card}: ${a} and ${b} get a token, paid with an Illuminati action`, () => {
      const s0 = scenario();
      const x = under(s0, 'p1', a, 'BOTTOM');
      const y = under(s0, 'p1', b, 'LEFT');
      s0.cards[x].tokens = 0; s0.cards[y].tokens = 0;
      const c = give(s0, 'p1', card, { hand: true });
      const s = playAndResolve(s0, 'p1', { card: c, targets: [x, y] });
      expect(s.cards[x].tokens).toBe(1);
      expect(s.cards[y].tokens).toBe(1);
      expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
      expect(s.cards[c].zone).toBe('discard');
    });
    it(`${card}: refuses a Group of another alignment, and needs the Illuminati action`, () => {
      const s = scenario();
      const x = under(s, 'p1', a, 'BOTTOM');
      const other = under(s, 'p1', 'joggers', 'LEFT'); // no alignment
      s.cards[x].tokens = 0; s.cards[other].tokens = 0;
      const c = give(s, 'p1', card, { hand: true });
      expect(() => play(s, 'p1', { card: c, targets: [other] })).toThrow(/Only your/);
      s.cards[ill(s, 'p1')].tokens = 0;
      expect(() => play(s, 'p1', { card: c, targets: [x] })).toThrow(/Illuminati/);
    });
  }
  it('several Groups may be reloaded only up to 5 Power in total', () => {
    const s = scenario();
    const x = under(s, 'p1', 'wall-street', 'BOTTOM'); // Corporate 4
    const y = under(s, 'p1', 'fast-food-chains', 'LEFT'); // Corporate 2
    s.cards[x].tokens = 0; s.cards[y].tokens = 0;
    const c = give(s, 'p1', 'tax-breaks', { hand: true });
    expect(() => play(s, 'p1', { card: c, targets: [x, y] })).toThrow(/5 Power/);
  });
});

// ============================================================ Power raised to 6

describe('Power raised to 6 family', () => {
  const cases: [string, string, string][] = [
    ['emergency-powers', 'nasa', 'mi-5'], // Government
    ['grassroots-support', 'dentists', 'deprogrammers'], // Straight
    ['mob-influence', 'offshore-banks', 'telephone-psychics'], // Criminal
    ['new-blood', 'nato', 'urban-gangs'], // Violent
    ['nobel-peace-prize', 'red-cross', 'boy-sprouts'], // Peaceful
  ];
  for (const [card, a, b] of cases) {
    it(`${card}: uses the ${a}'s action, sets its Power to 6 and stays linked`, () => {
      const s0 = scenario();
      const g = under(s0, 'p1', a);
      const c = give(s0, 'p1', card, { hand: true });
      const s = playAndResolve(s0, 'p1', { card: c, target: g });
      expect(power(s, g)).toBe(6);
      expect(s.cards[g].tokens).toBe(0);
      expect(s.cards[c].linkedTo).toBe(g);
    });
    it(`${card}: wrong alignment, no action, or a second copy are refused`, () => {
      const s0 = scenario();
      const g = under(s0, 'p1', a, 'BOTTOM');
      const g2 = under(s0, 'p1', b, 'LEFT');
      const wrong = under(s0, 'p1', 'joggers', 'RIGHT');
      const c = give(s0, 'p1', card, { hand: true });
      const c2 = give(s0, 'p1', card, { hand: true });
      expect(() => play(s0, 'p1', { card: c, target: wrong })).toThrow(/Group you control/);
      s0.cards[g].tokens = 0;
      expect(() => play(s0, 'p1', { card: c, target: g })).toThrow(/action/);
      const s = playAndResolve(s0, 'p1', { card: c, target: g2 });
      s.cards[g].tokens = 1;
      expect(() => play(s, 'p1', { card: c2, target: g })).toThrow(/only have one/);
    });
  }
});

// ============================================================ Alignment changes

describe('Alignment change family', () => {
  // [card, alignment gained, its opposite, a target with the opposite, a payer with the alignment]
  const cases: [string, string, string, string, string][] = [
    ['assertiveness-training', 'Violent', 'Peaceful', 'red-cross', 'nato'],
    ['fundie-money', 'Conservative', 'Liberal', 'feminists', 'fraternal-orders'],
    ['jake-day', 'Weird', 'Straight', 'dentists', 'psychiatrists'],
    ['kinder-and-gentler', 'Peaceful', 'Violent', 'nato', 'red-cross'],
    ['liberal-agenda', 'Liberal', 'Conservative', 'fraternal-orders', 'feminists'],
    ['straighten-up', 'Straight', 'Weird', 'psychiatrists', 'dentists'],
  ];
  for (const [card, gain, lose, target, payer] of cases) {
    it(`${card}: paid by the Illuminati, the target becomes ${gain} and stops being ${lose}`, () => {
      const s0 = scenario();
      const t = under(s0, 'p1', target);
      const c = give(s0, 'p1', card, { hand: true });
      const s = playAndResolve(s0, 'p1', { card: c, target: t, payWith: [ill(s0, 'p1')] });
      expect(alignments(s, t)).toContain(gain);
      expect(alignments(s, t)).not.toContain(lose);
      expect(s.cards[c].linkedTo).toBe(t);
      expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
    });
    it(`${card}: ${gain} payers need twice the Resistance of a ${lose} target, plus closeness if it is a rival's`, () => {
      const s0 = scenario();
      const t = under(s0, 'p2', target); // next to its Illuminati: +10
      const need = resistance(s0, t) * 2 + 10;
      const pays = under(s0, 'p1', payer);
      const c = give(s0, 'p1', card, { hand: true });
      s0.cards[pays].mods.push({ source: 'test', kind: 'setPower', value: need - 1, until: 'permanent' });
      expect(() => play(s0, 'p1', { card: c, target: t, payWith: [pays] })).toThrow(new RegExp(`${need} Power`));
      s0.cards[pays].mods[0].value = need;
      const s = playAndResolve(s0, 'p1', { card: c, target: t, payWith: [pays] });
      expect(alignments(s, t)).toContain(gain);
      expect(s.cards[pays].tokens).toBe(0);
    });
    it(`${card}: Groups without the ${gain} alignment cannot pay`, () => {
      const s = scenario();
      const t = under(s, 'p1', target, 'BOTTOM');
      const wrong = under(s, 'p1', 'joggers', 'LEFT');
      s.cards[wrong].mods.push({ source: 'test', kind: 'setPower', value: 50, until: 'permanent' });
      const c = give(s, 'p1', card, { hand: true });
      expect(() => play(s, 'p1', { card: c, target: t, payWith: [wrong] })).toThrow(new RegExp(gain));
    });
  }
});

// ============================================================ Die rolls

/** p1's attack with a comfortable margin, at the roll window. */
function rollingAttack(dice: [number, number] = [4, 4]) {
  const s0 = scenario();
  const att = under(s0, 'p1', 'the-mafia');
  const tgt = deep(s0, 'p2', 'dentists');
  const s = toRoll(act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt }), dice);
  expect(s.window?.kind).toBe('roll');
  return { s, att, tgt };
}

describe('Bribery', () => {
  it('changes the roll to 2 and spends every Illuminati token', () => {
    const { s: s0 } = rollingAttack([6, 5]);
    s0.cards[ill(s0, 'p2')].tokens = 2;
    const c = give(s0, 'p2', 'bribery', { hand: true });
    const s = play(s0, 'p2', { card: c });
    expect(finalRoll(s.attack!)).toBe(2);
    expect(s.cards[ill(s, 'p2')].tokens).toBe(0);
  });
  it('needs at least one Illuminati token and a die roll', () => {
    const { s } = rollingAttack();
    s.cards[ill(s, 'p2')].tokens = 0;
    const c = give(s, 'p2', 'bribery', { hand: true });
    expect(() => play(s, 'p2', { card: c })).toThrow(/Illuminati/);
    const s1 = scenario();
    const c1 = give(s1, 'p1', 'bribery', { hand: true });
    expect(() => play(s1, 'p1', { card: c1 })).toThrow();
  });
});

describe('Computer Virus', () => {
  it('moves the roll by 2 either way, paid by a Science, Space or Computer Group', () => {
    const { s: s0 } = rollingAttack([3, 3]);
    const sci = under(s0, 'p2', 'a-m-a', 'LEFT');
    const c = give(s0, 'p2', 'computer-virus', { hand: true });
    const s = play(s0, 'p2', { card: c, mode: 'up', payWith: [sci] });
    expect(finalRoll(s.attack!)).toBe(8);
    expect(s.cards[sci].tokens).toBe(0);
    const { s: t0 } = rollingAttack([3, 3]);
    const space = under(t0, 'p1', 'nasa', 'LEFT');
    const c2 = give(t0, 'p1', 'computer-virus', { hand: true });
    const t = play(t0, 'p1', { card: c2, mode: 'down', payWith: [space] });
    expect(finalRoll(t.attack!)).toBe(4);
  });
  it('refuses any other payer', () => {
    const { s } = rollingAttack();
    const wrong = under(s, 'p2', 'red-cross', 'LEFT');
    const c = give(s, 'p2', 'computer-virus', { hand: true });
    expect(() => play(s, 'p2', { card: c, mode: 'up', payWith: [wrong] })).toThrow(/Science, Space or Computer/);
  });
});

describe('Fnord!', () => {
  it('re-rolls your own roll and discards your top Group card', () => {
    const { s: s0 } = rollingAttack([6, 6]);
    const top = P(s0, 'p1').groupDeck[0];
    const c = give(s0, 'p1', 'fnord', { hand: true });
    const s = play(s0, 'p1', { card: c });
    expect(s.attack!.plays.find((p) => p.iid === c)?.effect.t).toBe('reroll');
    expect(s.cards[top].zone).toBe('discard');
  });
  it('with an empty Group deck, two Group cards from hand are discarded instead', () => {
    const { s: s0 } = rollingAttack([6, 6]);
    for (const g of P(s0, 'p1').groupDeck) delete s0.cards[g];
    P(s0, 'p1').groupDeck = [];
    const g1 = give(s0, 'p1', 'dentists', { hand: true });
    const g2 = give(s0, 'p1', 'joggers', { hand: true });
    const c = give(s0, 'p1', 'fnord', { hand: true });
    const s = play(s0, 'p1', { card: c });
    expect(s.cards[g1].zone).toBe('discard');
    expect(s.cards[g2].zone).toBe('discard');
  });
  it('cannot re-roll a roll that is not yours', () => {
    const { s } = rollingAttack();
    const c = give(s, 'p2', 'fnord', { hand: true });
    expect(() => play(s, 'p2', { card: c })).toThrow(/your own/);
  });
});

describe('Read My Lips', () => {
  const attackOnPersonality = () => {
    const s0 = scenario();
    s0.active = 1;
    const att = under(s0, 'p2', 'the-mafia');
    const tgt = deep(s0, 'p1', 'george-bush');
    const s = toRoll(act(s0, 'p2', { type: 'attack', attackType: 'control', attacker: att, target: tgt }), [1, 1]);
    return { s, tgt };
  };
  it('turns a successful attack on your Personality into a failure', () => {
    const { s: s0, tgt } = attackOnPersonality();
    const c = give(s0, 'p1', 'read-my-lips', { hand: true });
    const s = finish(play(s0, 'p1', { card: c }), [1, 1]);
    expect(s.cards[tgt].controller).toBe('p1');
  });
  it('not while the attack is failing, and never against an Assassination', () => {
    const { s: s0 } = attackOnPersonality();
    s0.attack!.roll = [6, 6];
    const c = give(s0, 'p1', 'read-my-lips', { hand: true });
    expect(() => play(s0, 'p1', { card: c })).toThrow(/succeeded/);
    const s1 = scenario();
    const tgt = deep(s1, 'p2', 'george-bush');
    const sn = give(s1, 'p1', 'sniper', { hand: true });
    const c1 = give(s1, 'p2', 'read-my-lips', { hand: true });
    const s = toRoll(play(s1, 'p1', { card: sn, target: tgt }), [1, 1]);
    expect(() => play(s, 'p2', { card: c1 })).toThrow(/Assassination/);
  });
});

// ============================================================ Assassinations

describe('Car Bomb', () => {
  it('Instant attack of Power 8 on a Personality; a Violent or Criminal Group may add its Power', () => {
    const s0 = scenario();
    const tgt = deep(s0, 'p2', 'george-bush');
    const helper = under(s0, 'p1', 'offshore-banks'); // Criminal
    const c = give(s0, 'p1', 'car-bomb', { hand: true });
    const s = play(s0, 'p1', { card: c, target: tgt, helper });
    expect(s.attack!.instant).toBe(true);
    expect(s.attack!.instantPower).toBe(8);
    expect(attackStrength(s, s.attack!).attack).toBe(8 + power(s, helper));
    expect(s.cards[helper].tokens).toBe(0);
    const t = finish(s, [1, 1]);
    expect(t.cards[tgt].zone).toBe('destroyed');
  });
  it('only against a Personality, and only a Violent or Criminal helper', () => {
    const s = scenario();
    const org = deep(s, 'p2', 'dentists');
    const tgt = under(s, 'p2', 'george-bush', 'LEFT');
    const wrong = under(s, 'p1', 'red-cross');
    const c = give(s, 'p1', 'car-bomb', { hand: true });
    expect(() => play(s, 'p1', { card: c, target: org })).toThrow(/Personality/);
    expect(() => play(s, 'p1', { card: c, target: tgt, helper: wrong })).toThrow(/Violent\/Criminal/);
  });
});

describe('Hit and Run', () => {
  it('Instant attack of Power 10 on a Personality; a Fanatic Group may add its Power', () => {
    const s0 = scenario();
    const tgt = deep(s0, 'p2', 'george-bush');
    const helper = under(s0, 'p1', 'moonies');
    const c = give(s0, 'p1', 'hit-and-run', { hand: true });
    const s = play(s0, 'p1', { card: c, target: tgt, helper });
    expect(s.attack!.instantPower).toBe(10);
    expect(attackStrength(s, s.attack!).attack).toBe(10 + power(s, helper));
  });
  it('refuses a non-Fanatic helper and a non-Personality target', () => {
    const s = scenario();
    const tgt = deep(s, 'p2', 'george-bush');
    const org = under(s, 'p2', 'dentists', 'LEFT');
    const wrong = under(s, 'p1', 'nato');
    const c = give(s, 'p1', 'hit-and-run', { hand: true });
    expect(() => play(s, 'p1', { card: c, target: tgt, helper: wrong })).toThrow(/Fanatic/);
    expect(() => play(s, 'p1', { card: c, target: org })).toThrow(/Personality/);
  });
});

// ============================================================ Privileged attacks

describe('Censorship', () => {
  it('+15 and Privileged for a Straight, Conservative or Government attacker against a Media Group', () => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'fbi'); // Straight Government
    const tgt = deep(s0, 'p2', 'tabloids');
    const c = give(s0, 'p1', 'censorship', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt, plots: [{ card: c }] });
    expect(s.attack!.attackBonus.find((b) => b.plot === c)?.amount).toBe(15);
    expect(isPrivileged(s.attack!)).toBe(true);
  });
  it('not against a non-Media target, nor without a qualifying Group on the attacking side', () => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'fbi');
    const other = under(s0, 'p1', 'psychiatrists', 'LEFT'); // Weird only
    const media = deep(s0, 'p2', 'tabloids');
    const plain = under(s0, 'p2', 'dentists', 'LEFT');
    const c = give(s0, 'p1', 'censorship', { hand: true });
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: plain, plots: [{ card: c }] })).toThrow(/Media/);
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: other, target: media, plots: [{ card: c }] })).toThrow(/Straight, Conservative or Government/);
  });
});

describe('Eat the Rich!', () => {
  it('+10 and Privileged on an Attack to Destroy against Power 6+, with a Media Group', () => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'big-media');
    const tgt = deep(s0, 'p2', 'the-mafia');
    const c = give(s0, 'p1', 'eat-the-rich', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt, plots: [{ card: c }] });
    expect(s.attack!.attackBonus.find((b) => b.plot === c)?.amount).toBe(10);
    expect(isPrivileged(s.attack!)).toBe(true);
  });
  it('not below Power 6, not on a control attack, not without a Media Group', () => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'big-media', 'BOTTOM');
    const plain = under(s0, 'p1', 'c-i-a', 'LEFT');
    const small = under(s0, 'p2', 'dentists', 'LEFT');
    const rich = deep(s0, 'p2', 'the-mafia');
    const c = give(s0, 'p1', 'eat-the-rich', { hand: true });
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: small, plots: [{ card: c }] })).toThrow(/Power 6/);
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: rich, plots: [{ card: c }] })).toThrow(/Destroy/);
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: plain, target: rich, plots: [{ card: c }] })).toThrow(/Media/);
  });
});

describe('Ketchup is a Vegetable', () => {
  it('+5 and Privileged on an Attack to Destroy a Government Group', () => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'the-mafia');
    const tgt = deep(s0, 'p2', 'nasa');
    const c = give(s0, 'p1', 'ketchup-is-a-vegetable', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt, plots: [{ card: c }] });
    expect(s.attack!.attackBonus.find((b) => b.plot === c)?.amount).toBe(5);
    expect(isPrivileged(s.attack!)).toBe(true);
  });
  it('not on a control attack or against a non-Government Group', () => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'the-mafia');
    const gov = deep(s0, 'p2', 'nasa');
    const plain = under(s0, 'p2', 'dentists', 'LEFT');
    const c = give(s0, 'p1', 'ketchup-is-a-vegetable', { hand: true });
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: gov, plots: [{ card: c }] })).toThrow(/Government/);
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: plain, plots: [{ card: c }] })).toThrow(/Government/);
  });
});

describe('Deep Agent', () => {
  it('removes the privilege of a Privileged attack; the attack goes on', () => {
    const s0 = scenario3();
    const att = under(s0, 'p1', 'the-mafia');
    const tgt = deep(s0, 'p2', 'nasa');
    const k = give(s0, 'p1', 'ketchup-is-a-vegetable', { hand: true });
    const c = give(s0, 'p3', 'deep-agent', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt, plots: [{ card: k }] });
    expect(participants(s)).not.toContain('p3');
    s = play(s, 'p3', { card: c });
    expect(isPrivileged(s.attack!)).toBe(false);
    expect(s.attack).toBeDefined();
    expect(participants(s)).toContain('p3');
  });
  it('is refused against an ordinary attack', () => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'the-mafia');
    const tgt = deep(s0, 'p2', 'nasa');
    const c = give(s0, 'p2', 'deep-agent', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    expect(() => play(s, 'p2', { card: c })).toThrow(/Privileged/);
  });
});

describe('Interference', () => {
  it('lets a third player take part in a Privileged attack', () => {
    const s0 = scenario3();
    const att = under(s0, 'p1', 'the-mafia');
    const tgt = deep(s0, 'p2', 'nasa');
    const helper = under(s0, 'p3', 'c-i-a');
    const k = give(s0, 'p1', 'ketchup-is-a-vegetable', { hand: true });
    const c = give(s0, 'p3', 'interference', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt, plots: [{ card: k }] });
    expect(() => act(s, 'p3', { type: 'oppose', group: helper })).toThrow();
    s = play(s, 'p3', { card: c });
    expect(isPrivileged(s.attack!)).toBe(true); // still Privileged for everyone else
    expect(participants(s)).toContain('p3');
    const before = attackStrength(s, s.attack!).defense;
    s = act(s, 'p3', { type: 'oppose', group: helper });
    expect(attackStrength(s, s.attack!).defense).toBeGreaterThan(before);
  });
  it('is refused during an ordinary attack', () => {
    const s0 = scenario3();
    const att = under(s0, 'p1', 'the-mafia');
    const tgt = deep(s0, 'p2', 'nasa');
    const c = give(s0, 'p3', 'interference', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    expect(() => play(s, 'p3', { card: c })).toThrow(/Privileged/);
  });
});

// ============================================================ Other attack Plots

describe('Whispering Campaign', () => {
  const setup = (target: string) => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'tabloids', 'BOTTOM');
    const media = under(s0, 'p1', 'pollsters', 'LEFT');
    const tgt = deep(s0, 'p2', target);
    const c = give(s0, 'p1', 'whispering-campaign', { hand: true });
    return { s0, att, media, tgt, c };
  };
  it('+15 against a Personality, +10 against any other Group, paid by a Media Group', () => {
    for (const [target, bonus] of [['bill-clinton', 15], ['dentists', 10]] as const) {
      const { s0, att, media, tgt, c } = setup(target);
      const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt, plots: [{ card: c, payWith: [media] }] });
      expect(s.attack!.attackBonus.find((b) => b.plot === c)?.amount).toBe(bonus);
      expect(s.cards[media].tokens).toBe(0);
    }
  });
  it('only with an Attack to Destroy, paid by a Media Group, and never with an Assassination', () => {
    const { s0, att, media, tgt, c } = setup('bill-clinton');
    const plain = under(s0, 'p1', 'dentists', 'RIGHT');
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt, plots: [{ card: c, payWith: [media] }] })).toThrow(/Destroy/);
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt, plots: [{ card: c, payWith: [plain] }] })).toThrow(/Media/);
    const sn = give(s0, 'p1', 'sniper', { hand: true });
    const s = play(s0, 'p1', { card: sn, target: tgt });
    expect(() => play(s, 'p1', { card: c, payWith: [media] })).toThrow();
  });
  // Mismatch: the printed card says a Personality removed this way is out of public life for good
  // and can never come back into play. The engine only destroys it like any other Group, so Media
  // Blitz can still bring a duplicate of that Personality back into play afterwards.
  it.fails('a Personality it removes can never be brought back into play', () => {
    const { s0, att, media, tgt, c } = setup('bill-clinton');
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt, plots: [{ card: c, payWith: [media] }] });
    s = finish(s, [1, 1]);
    expect(s.cards[tgt].zone).toBe('destroyed');
    const dup = give(s, 'p1', 'bill-clinton', { hand: true });
    const blitz = give(s, 'p1', 'media-blitz', { hand: true });
    const media2 = under(s, 'p1', 'cable-tv', 'RIGHT');
    expect(() => play(s, 'p1', { card: blitz, target: dup, payWith: [media2] })).toThrow();
  });
});

describe('Are We Having Fun Yet?', () => {
  it('cancels the action of a Group acting in an attack, paid by Groups with more Power', () => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'nato'); // Power 3
    const tgt = deep(s0, 'p2', 'dentists');
    const pay1 = under(s0, 'p2', 'the-mafia', 'LEFT'); // Power 6
    const c = give(s0, 'p2', 'are-we-having-fun-yet', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    s = play(s, 'p2', { card: c, target: att, payWith: [pay1] });
    expect(attackCancelled(s.attack!)).toBe(true);
    expect(s.cards[pay1].tokens).toBe(0);
    s = finish(s);
    expect(s.cards[tgt].controller).toBe('p2');
  });
  it('the payers must have more Power than the target, and the target must be acting', () => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'nato'); // Power 3
    const idle = under(s0, 'p1', 'c-i-a', 'LEFT');
    const tgt = deep(s0, 'p2', 'dentists');
    const pay1 = under(s0, 'p2', 'b-a-t-f', 'LEFT'); // Power 3: not more
    const big = under(s0, 'p2', 'the-mafia', 'RIGHT');
    const c = give(s0, 'p2', 'are-we-having-fun-yet', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    expect(() => play(s, 'p2', { card: c, target: att, payWith: [pay1] })).toThrow(/more than 3/);
    expect(() => play(s, 'p2', { card: c, target: idle, payWith: [big] })).toThrow(/taking an action/);
  });
});

// ============================================================ Disasters

describe('Hurricane', () => {
  it('Power 16 against a Huge Place, 20 against another Coastal Place', () => {
    const s0 = scenario();
    const huge = under(s0, 'p2', 'texas', 'BOTTOM');
    const coast = under(s0, 'p2', 'hawaii', 'LEFT');
    const a = give(s0, 'p1', 'hurricane', { hand: true });
    expect(play(structuredClone(s0), 'p1', { card: a, target: huge }).attack!.instantPower).toBe(16);
    expect(play(s0, 'p1', { card: a, target: coast }).attack!.instantPower).toBe(20);
  });
  it('a success only Devastates, however large the margin', () => {
    const s0 = scenario();
    const place = deep(s0, 'p2', 'hawaii'); // Power 1, no closeness bonus: margin 17 on a roll of 2
    const a = give(s0, 'p1', 'hurricane', { hand: true });
    const s = finish(play(s0, 'p1', { card: a, target: place }), [1, 1]);
    expect(s.cards[place].zone).toBe('structure');
    expect(s.cards[place].devastated).toBe(true);
  });
  // Mismatch (unless the parallel fix has landed): the printed card can strike only a Coastal Place,
  // but the handler accepts any Place, such as the inland Pentagon.
  it.fails('refuses a Place that is not Coastal', () => {
    const s = scenario();
    const inland = under(s, 'p2', 'pentagon');
    const a = give(s, 'p1', 'hurricane', { hand: true });
    expect(() => play(s, 'p1', { card: a, target: inland })).toThrow(/Coastal/);
  });
  it('refuses a Group that is not a Place', () => {
    const s = scenario();
    const org = under(s, 'p2', 'dentists');
    const a = give(s, 'p1', 'hurricane', { hand: true });
    expect(() => play(s, 'p1', { card: a, target: org })).toThrow(/Place/);
  });
});

describe('Tidal Wave', () => {
  it('Power 20 against a Huge Place, 24 against another Coastal Place', () => {
    const s0 = scenario();
    const huge = under(s0, 'p2', 'texas', 'BOTTOM');
    const coast = under(s0, 'p2', 'hawaii', 'LEFT');
    const a = give(s0, 'p1', 'tidal-wave', { hand: true });
    expect(play(structuredClone(s0), 'p1', { card: a, target: huge }).attack!.instantPower).toBe(20);
    expect(play(s0, 'p1', { card: a, target: coast }).attack!.instantPower).toBe(24);
  });
  it('Devastates on a success by 10 or less, destroys on a success by more than 10', () => {
    // Hawaii next to its Illuminati: 24 against 1 + 10, strength 13.
    const s0 = scenario();
    const place = under(s0, 'p2', 'hawaii');
    const a = give(s0, 'p1', 'tidal-wave', { hand: true });
    const hit = (d: [number, number]) => finish(play(structuredClone(s0), 'p1', { card: a, target: place }), d);
    const by10 = hit([1, 2]);
    expect(by10.cards[place].zone).toBe('structure'); // 13 - 3 = 10: Devastated only
    expect(by10.cards[place].devastated).toBe(true);
    expect(hit([1, 1]).cards[place].zone).toBe('destroyed'); // 13 - 2 = 11: destroyed
  });
  // Mismatch (unless the parallel fix has landed): the printed card can strike only a Coastal Place,
  // but the handler accepts any Place.
  it.fails('refuses a Place that is not Coastal', () => {
    const s = scenario();
    const inland = under(s, 'p2', 'pentagon');
    const a = give(s, 'p1', 'tidal-wave', { hand: true });
    expect(() => play(s, 'p1', { card: a, target: inland })).toThrow(/Coastal/);
  });
});

// ============================================================ Other

describe('Savings & Loan Scam', () => {
  it("uses one Group's action to draw three Plots, then is discarded", () => {
    const s0 = scenario();
    const g = under(s0, 'p1', 'dentists');
    const c = give(s0, 'p1', 'savings-loan-scam', { hand: true });
    const deck = P(s0, 'p1').plotDeck.slice(0, 3);
    const s = playAndResolve(s0, 'p1', { card: c, payWith: [g] });
    expect(P(s, 'p1').hand).toEqual(expect.arrayContaining(deck));
    expect(P(s, 'p1').hand.length).toBe(3);
    expect(s.cards[g].tokens).toBe(0);
    expect(s.cards[c].zone).toBe('discard');
  });
  it('needs exactly one paying Group with an action', () => {
    const s = scenario();
    const g = under(s, 'p1', 'dentists', 'BOTTOM');
    const h = under(s, 'p1', 'joggers', 'LEFT');
    const c = give(s, 'p1', 'savings-loan-scam', { hand: true });
    expect(() => play(s, 'p1', { card: c })).toThrow(/one Group/);
    expect(() => play(s, 'p1', { card: c, payWith: [g, h] })).toThrow(/one Group/);
    s.cards[g].tokens = 0;
    expect(() => play(s, 'p1', { card: c, payWith: [g] })).toThrow(/Action token/);
  });
});

describe('Good Polls', () => {
  it('triples Power and Resistance of your Groups of the chosen alignment, for defense only', () => {
    const s0 = scenario();
    const v = under(s0, 'p1', 'nato', 'BOTTOM'); // Violent
    const other = under(s0, 'p1', 'dentists', 'LEFT');
    const rival = under(s0, 'p2', 'urban-gangs'); // Violent, but not yours
    const c = give(s0, 'p1', 'good-polls', { hand: true });
    const s = playAndResolve(s0, 'p1', { card: c, alignment: 'Violent' });
    expect(power(s, v, { defense: true })).toBe(3 * CARDS['nato'].power!);
    expect(resistance(s, v)).toBe(3 * CARDS['nato'].resistance!);
    expect(power(s, v)).toBe(CARDS['nato'].power); // not when it acts
    expect(power(s, other, { defense: true })).toBe(CARDS['dentists'].power);
    expect(power(s, rival, { defense: true })).toBe(CARDS['urban-gangs'].power);
  });
  it('lasts through the rival\'s turn and ends when your next turn begins', () => {
    const s0 = scenario();
    const v = under(s0, 'p1', 'nato');
    const c = give(s0, 'p1', 'good-polls', { hand: true });
    let s = playAndResolve(s0, 'p1', { card: c, alignment: 'Violent' });
    s = drain(act(s, 'p1', { type: 'endTurn' }));
    expect(s.players[s.active].id).toBe('p2');
    expect(resistance(s, v)).toBe(3 * CARDS['nato'].resistance!);
    s.prompt = undefined; s.window = undefined; s.phase = 'main';
    s = drain(act(s, 'p2', { type: 'endTurn' }));
    expect(s.players[s.active].id).toBe('p1');
    expect(resistance(s, v)).toBe(CARDS['nato'].resistance);
  });
  it('needs an alignment to be chosen', () => {
    const s = scenario();
    const c = give(s, 'p1', 'good-polls', { hand: true });
    expect(() => play(s, 'p1', { card: c })).toThrow(/alignment/);
  });
});
