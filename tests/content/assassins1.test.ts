// Scripted parts of the Assassins cards in src/engine/content/assassins1.ts.
import { describe, expect, it } from 'vitest';
import {
  applyAction, alignments, attackStrength, attributes, cardImplemented, def, goalAlignWeight, goalCount, HOOKS, openArrows, power, resistance,
  startInstantAttack, validateAttack, waitingFor, type Action, type AttackType, type GameState,
} from '../../src/engine';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
function resolve(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = applyAction(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** Pass until every open window (an attack, or a Plot waiting to resolve) has settled. */
function settle(s: GameState): GameState {
  for (let i = 0; i < 20 && (s.attack || s.window); i++) s = applyAction(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** A huge attack bonus so the roll's exact strength no longer matters: combine with `resolve(s, [2, 2])`
 *  for a guaranteed success. */
function boost(s: GameState): GameState {
  s.attack!.attackBonus.push({ player: s.attack!.attackerPlayer, amount: 50, label: 'test boost' });
  return s;
}
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
function put(s: GameState, pl: string, cardId: string, under?: string): string {
  const m = under ?? ill(s, pl);
  const side = openArrows(s, m)[0];
  if (!side) throw new Error(`no open arrow under ${m}`);
  return give(s, pl, cardId, { under: m, side });
}
const attack = (s: GameState, attacker: string, target: string, attackType: AttackType, pl = 'p1') => {
  s.active = s.players.findIndex((p) => p.id === pl); // scenario() always starts on p1's turn
  return act(s, pl, { type: 'attack', attackType, attacker, target });
};
/** Build an attack context directly, bypassing declaration rules (arrow-less leaders like Pale People
 *  In Black or Shock Jocks, which can never actually declare an Attack to Control themselves). */
function ctxFor(s: GameState, attacker: string, target: string, type: AttackType, attackerPlayer = 'p1'): GameState {
  s.attack = {
    id: 1, type, instant: false, attacker, attackerPlayer, target, targetPlayer: s.cards[target].controller,
    fromHand: false, privileged: false, aid: [], oppose: [], attackBonus: [], defenseBonus: [], plays: [],
  };
  return s;
}
const use = (s: GameState, pl: string, card: string, ability: string, params = {}) =>
  act(s, pl, { type: 'useAbility', card, ability, params });
function line(s: GameState, side: 'Attack' | 'Defense', name: string): number {
  return attackStrength(s, s.attack!).lines.filter((l: string) => l.startsWith(side) && l.endsWith(`: ${name}`))
    .reduce((n: number, l: string) => n + Number(l.match(/([+-]\d+)/)![1]), 0);
}
const hand = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.hand;
function as(cardId: string): GameState {
  const s = scenario();
  s.cards[ill(s, 'p1')].cardId = cardId;
  return s;
}

const BATCH = [
  'society-of-assassins', 'arms-dealers', 'church-of-violentology', 'convenience-stores', 'copy-shops',
  'day-care-centers', 'dittoheads', 'drug-companies', 'epa', 'militia', 'nutrition-nazis',
  'pale-people-in-black', 'recycling-centers', 'science-alarmists', 'shock-jocks', 'state-lotteries',
  'swingers', 'the-green-party', 'the-thule-group', 'general-disorder', 'lama-ramadingdong',
  'lyndon-larouche', 'newt-gingrich', 'teddy-kennedy', 'vladimir-zhirinovsky',
];

describe('batch assassins1: every card is implemented', () => {
  it.each(BATCH)('%s', (id) => expect(cardImplemented(id)).toBe(true));
});

describe('Society of Assassins (Illuminati)', () => {
  it('a Secret Group counts double toward the Basic Goal', () => {
    const s = as('society-of-assassins');
    const g = put(s, 'p1', 'cattle-mutilators'); // Secret attribute
    expect(attributes(s, g)).toContain('Secret');
    const before = goalCount(s, 'p1'); // the Illuminati (1) plus the Secret Group counted twice (2)
    expect(before).toBe(3);
    put(s, 'p1', 'gun-lobby'); // an ordinary Group only counts once
    expect(goalCount(s, 'p1')).toBe(before + 1);
  });
  it('does not double count once a rival controls a stronger Secret Group', () => {
    const s = as('society-of-assassins');
    const mine = put(s, 'p1', 'cattle-mutilators');
    const withoutRival = goalCount(s, 'p1');
    const rival = put(s, 'p2', 'cattle-mutilators');
    s.cards[rival].mods.push({ source: 'test', kind: 'power', value: 50, until: 'permanent' });
    expect(goalCount(s, 'p1')).toBe(withoutRival - 1);
  });
  it('Global Power of a controlled Fanatic Group equals its Power', () => {
    const s = as('society-of-assassins');
    const g = put(s, 'p1', 'militia'); // Violent, Conservative, Fanatic
    expect(alignments(s, g)).toContain('Fanatic');
    expect(power(s, g)).toBeGreaterThan(0);
  });
});

describe('Arms Dealers', () => {
  it('trades one Plot of yours for one exposed Plot of a rival', () => {
    const s0 = scenario();
    const ad = put(s0, 'p1', 'arms-dealers');
    const mine = give(s0, 'p1', 'earthquake', { hand: true });
    const theirs = give(s0, 'p2', 'drought', { hand: true });
    s0.cards[theirs].exposed = true;
    const s = use(s0, 'p1', ad, 'trade', { target: theirs, targets: [mine] });
    expect(hand(s, 'p1')).toContain(theirs);
    expect(hand(s, 'p2')).toContain(mine);
    expect(hand(s, 'p1')).not.toContain(mine);
  });
  it('refuses a hidden rival Plot', () => {
    const s0 = scenario();
    const ad = put(s0, 'p1', 'arms-dealers');
    const mine = give(s0, 'p1', 'earthquake', { hand: true });
    const theirs = give(s0, 'p2', 'drought', { hand: true });
    expect(() => use(s0, 'p1', ad, 'trade', { target: theirs, targets: [mine] })).toThrow(/exposed/);
  });
});

describe('Church of Violentology', () => {
  it('every Group that helps destroy it draws its controller a Plot', () => {
    const s0 = scenario();
    const church = put(s0, 'p2', 'church-of-violentology');
    const mafia = put(s0, 'p1', 'the-mafia');
    let s = attack(s0, mafia, church, 'destroy');
    s = boost(s);
    s = resolve(s, [2, 2]);
    expect(hand(s, 'p1').length).toBe(1);
  });
  it('a failed attack draws the Church controller Plots and kills the weakest attacker', () => {
    const s0 = scenario();
    const church = put(s0, 'p2', 'church-of-violentology');
    const weak = put(s0, 'p1', 'boy-sprouts');
    let s = attack(s0, weak, church, 'destroy');
    s.attack!.roll = [6, 6];
    s = resolve(s);
    expect(hand(s, 'p2').length).toBeGreaterThanOrEqual(1);
    expect(s.cards[weak].zone).toBe('destroyed');
  });
});

describe('Convenience Stores', () => {
  it('+10 against an Attack to Destroy', () => {
    const s0 = scenario();
    const cs = put(s0, 'p1', 'convenience-stores');
    const mafia = put(s0, 'p2', 'the-mafia');
    const s = attack(s0, mafia, cs, 'destroy', 'p2');
    expect(line(s, 'Defense', 'Convenience Stores ability')).toBe(10);
  });
  it('gives an extra +5 to an agents card played by anyone while it is in play', () => {
    const s0 = scenario();
    put(s0, 'p2', 'convenience-stores'); // owned by either side; the bonus is universal
    const mafia1 = put(s0, 'p1', 'the-mafia');
    const mafia2 = put(s0, 'p2', 'the-mafia');
    give(s0, 'p1', 'the-mafia', { hand: true }); // p1's own duplicate of the target's card
    const dup = hand(s0, 'p1')[0];
    let s = attack(s0, mafia1, mafia2, 'control');
    s = act(s, 'p1', { type: 'agent', card: dup, as: 'aid' } as unknown as Action);
    expect(line(s, 'Attack', 'Convenience Stores')).toBe(5);
  });
});

describe('Copy Shops', () => {
  it("copies a rival's exposed Plot and plays the copy at once, paying its own cost", () => {
    const s0 = scenario();
    const shop = put(s0, 'p1', 'copy-shops');
    const mafia = put(s0, 'p1', 'the-mafia'); // Violent, Criminal
    const discard = give(s0, 'p1', 'earthquake', { hand: true });
    const theirs = give(s0, 'p2', 'good-polls', { hand: true });
    s0.cards[theirs].exposed = true;
    const s = settle(use(s0, 'p1', shop, 'copy', { target: theirs, targets: [discard], copyPlay: { alignment: 'Violent' } }));
    expect(hand(s, 'p1')).not.toContain(discard);
    expect(hand(s, 'p2')).toContain(theirs); // the rival's own card is untouched
    expect(s.cards[mafia].mods.some((m) => m.kind === 'mulPower')).toBe(true);
  });
  it('refuses a rival Plot that is still hidden, or one this version cannot play', () => {
    const s0 = scenario();
    const shop = put(s0, 'p1', 'copy-shops');
    const discard = give(s0, 'p1', 'earthquake', { hand: true });
    const hidden = give(s0, 'p2', 'good-polls', { hand: true });
    expect(() => use(s0, 'p1', shop, 'copy', { target: hidden, targets: [discard] })).toThrow(/exposed/);
    const s1 = scenario();
    const shop1 = put(s1, 'p1', 'copy-shops');
    const discard1 = give(s1, 'p1', 'earthquake', { hand: true });
    const unimplemented = give(s1, 'p2', 'drought', { hand: true });
    s1.cards[unimplemented].exposed = true;
    expect(() => use(s1, 'p1', shop1, 'copy', { target: unimplemented, targets: [discard1] })).toThrow();
  });
});

describe('Day Care Centers', () => {
  it("always has exactly its master's alignments", () => {
    const s = scenario();
    const kkk = put(s, 'p1', 'kkk'); // Violent, Conservative, Fanatic
    const dcc = give(s, 'p1', 'day-care-centers', { under: kkk, side: openArrows(s, kkk)[0] });
    expect(alignments(s, dcc).sort()).toEqual(alignments(s, kkk).sort());
  });
  it('keeps the alignments it had when destroyed', () => {
    const s0 = scenario();
    const kkk = put(s0, 'p1', 'kkk');
    const dcc = give(s0, 'p1', 'day-care-centers', { under: kkk, side: openArrows(s0, kkk)[0] });
    const before = alignments(s0, dcc).slice().sort();
    const rival = put(s0, 'p2', 'the-mafia');
    let s = attack(s0, rival, dcc, 'destroy', 'p2');
    s = boost(s);
    s = resolve(s, [2, 2]);
    expect(s.cards[dcc].zone).toBe('destroyed');
    expect(alignments(s, dcc).slice().sort()).toEqual(before);
  });
});

describe('Dittoheads', () => {
  it('gives its Personality master +2 Power and triple Resistance', () => {
    const s = scenario();
    const larouche = put(s, 'p1', 'lyndon-larouche'); // any Personality works for this part
    const before = { p: power(s, larouche), r: resistance(s, larouche) };
    give(s, 'p1', 'dittoheads', { under: larouche, side: openArrows(s, larouche)[0] });
    expect(power(s, larouche)).toBe(before.p + 2);
    expect(resistance(s, larouche)).toBe(before.r * 3);
  });
  it("takes its Personality's alignments plus Fanatic", () => {
    const s = scenario();
    const teddy = put(s, 'p1', 'teddy-kennedy'); // Liberal, Government
    const dh = give(s, 'p1', 'dittoheads', { under: teddy, side: openArrows(s, teddy)[0] });
    expect(alignments(s, dh)).toEqual(expect.arrayContaining(['Liberal', 'Government', 'Fanatic']));
  });
  it('gives no bonus to a non-Personality master', () => {
    const s = scenario();
    const mafia = put(s, 'p1', 'the-mafia');
    const before = power(s, mafia);
    give(s, 'p1', 'dittoheads', { under: mafia, side: openArrows(s, mafia)[0] });
    expect(power(s, mafia)).toBe(before);
  });
});

describe('Drug Companies', () => {
  it('strips a chosen alignment on a successful special attack instead of capturing', () => {
    const s0 = scenario();
    const dc = put(s0, 'p1', 'drug-companies');
    const target = put(s0, 'p2', 'the-mafia'); // Violent, Criminal
    expect(alignments(s0, target)).toContain('Violent');
    let s = use(s0, 'p1', dc, 'strip-alignment', { target, alignment: 'Violent' });
    expect(s.attack?.type).toBe('control');
    s = boost(s);
    s = resolve(s, [2, 2]);
    expect(alignments(s, target)).not.toContain('Violent');
    expect(s.cards[target].controller).toBe('p2'); // never actually captured
  });
  it('refuses an alignment the target does not have', () => {
    const s0 = scenario();
    const dc = put(s0, 'p1', 'drug-companies');
    const target = put(s0, 'p2', 'the-mafia');
    expect(() => use(s0, 'p1', dc, 'strip-alignment', { target, alignment: 'Liberal' })).toThrow();
  });
});

describe('EPA', () => {
  it("blocks the Nuclear Power Companies' special ability while it holds a token", () => {
    const s = scenario();
    const epa = put(s, 'p1', 'epa');
    const npc = put(s, 'p1', 'nuclear-power-companies');
    expect(s.cards[epa].tokens).toBe(1);
    const abilities = HOOKS['nuclear-power-companies']?.actions ?? [];
    expect(abilities.length).toBeGreaterThan(0);
    expect(() => use(s, 'p1', npc, abilities[0].id, {})).toThrow(/cannot use its special/);
  });
  it('no longer blocks it once its token is spent', () => {
    const s = scenario();
    const epa = put(s, 'p1', 'epa');
    s.cards[epa].tokens = 0;
    const npc = put(s, 'p1', 'nuclear-power-companies');
    const abilities = HOOKS['nuclear-power-companies']?.actions ?? [];
    expect(() => use(s, 'p1', npc, abilities[0].id, {})).not.toThrow(/cannot use its special/);
  });
});

describe('Militia', () => {
  it('gains Power after a successful Attack to Destroy it leads', () => {
    const s0 = scenario();
    const militia = put(s0, 'p1', 'militia');
    const target = put(s0, 'p2', 'boy-sprouts');
    let s = attack(s0, militia, target, 'destroy');
    s = boost(s);
    s = resolve(s, [2, 2]);
    expect(def(s, militia).power).toBe(1);
    expect(power(s, militia)).toBe(2);
  });
  it('loses Power, never below 1, after a failed Attack to Destroy', () => {
    const s0 = scenario();
    const militia = put(s0, 'p1', 'militia');
    const target = put(s0, 'p2', 'boy-sprouts');
    let s = attack(s0, militia, target, 'destroy');
    s.attack!.roll = [12, 12];
    s = resolve(s);
    expect(power(s, militia)).toBe(1);
  });
});

describe('Nutrition Nazis', () => {
  it('lets a Science Group aid an attack it is part of regardless of alignment', () => {
    const s0 = scenario();
    const nn = put(s0, 'p1', 'nutrition-nazis');
    const target = put(s0, 'p2', 'the-mafia');
    let s = attack(s0, nn, target, 'control');
    const sci = put(s, 'p1', 'nuclear-power-companies'); // Science attribute, no alignment overlap needed
    expect(() => act(s, 'p1', { type: 'aid', group: sci })).not.toThrow();
  });
});

describe('Pale People In Black', () => {
  it('cannot be destroyed (the engine refuses to even declare an Attack to Destroy on it)', () => {
    const s = scenario();
    const ppib = put(s, 'p1', 'pale-people-in-black');
    const rival = put(s, 'p2', 'the-mafia');
    expect(validateAttack(s, 'p2', { type: 'attack', attackType: 'destroy', attacker: rival, target: ppib }, { outOfTurn: true })).toMatch(/cannot be destroyed/);
  });
  it('ignores the opposite-alignment penalty when it leads an Attack to Control (see the RULING in the source: it has no outgoing arrow, so this is only reachable directly)', () => {
    const s0 = scenario();
    const ppib = put(s0, 'p1', 'pale-people-in-black'); // Weird
    const target = put(s0, 'p2', 'boy-sprouts'); // Straight, opposite of Weird
    const s = ctxFor(s0, ppib, target, 'control');
    expect(line(s, 'Attack', 'alignments')).toBe(0);
  });
});

describe('Recycling Centers', () => {
  it('salvages a Group discarded this turn back to its hand', () => {
    const s0 = scenario();
    const rc = put(s0, 'p1', 'recycling-centers');
    const g = give(s0, 'p2', 'gun-lobby', { hand: true });
    s0.players.find((p) => p.id === 'p2')!.hand = s0.players.find((p) => p.id === 'p2')!.hand.filter((c) => c !== g);
    s0.cards[g].zone = 'discard';
    s0.cards[g].data = { discardTurn: s0.turn };
    s0.players.find((p) => p.id === 'p2')!.discard.push(g);
    const s = use(s0, 'p1', rc, 'salvage', { target: g });
    expect(hand(s, 'p2')).toContain(g);
  });
  it('refuses a card discarded on an earlier turn', () => {
    const s0 = scenario();
    const rc = put(s0, 'p1', 'recycling-centers');
    const g = give(s0, 'p2', 'gun-lobby', { hand: true });
    s0.players.find((p) => p.id === 'p2')!.hand = s0.players.find((p) => p.id === 'p2')!.hand.filter((c) => c !== g);
    s0.cards[g].zone = 'discard';
    s0.cards[g].data = { discardTurn: s0.turn - 1 };
    s0.players.find((p) => p.id === 'p2')!.discard.push(g);
    expect(() => use(s0, 'p1', rc, 'salvage', { target: g })).toThrow(/this turn/);
  });
});

describe('Science Alarmists', () => {
  it('blocks a rival automatic takeover of a Science or Green Group, but not an ordinary attack', () => {
    const s = scenario();
    put(s, 'p1', 'science-alarmists');
    const target = put(s, 'p1', 'epa'); // Green, Science attributes
    const npc = put(s, 'p2', 'the-mafia');
    const outOfTurn = { outOfTurn: true };
    expect(HOOKS['science-alarmists'].forbidAttack!(s, Object.keys(s.cards).find((k) => s.cards[k].cardId === 'science-alarmists')!, npc, target, 'takeover', 'p2')).toMatch(/permission/);
    expect(validateAttack(s, 'p2', { type: 'attack', attackType: 'control', attacker: npc, target }, outOfTurn)).toBeNull();
  });
});

describe('Shock Jocks', () => {
  it('counts as Straight when it leads an Attack to Control a Straight Group', () => {
    const s0 = scenario();
    const sj = put(s0, 'p1', 'shock-jocks'); // Weird
    const target = put(s0, 'p2', 'boy-sprouts'); // Straight
    const s = ctxFor(s0, sj, target, 'control');
    expect(alignments(s, sj)).toContain('Straight');
  });
  it('may interfere in an attack that involves a Straight Group', () => {
    const s = scenario();
    const sj = put(s, 'p1', 'shock-jocks');
    const attacker = put(s, 'p1', 'boy-sprouts');
    const target = put(s, 'p2', 'the-mafia');
    ctxFor(s, attacker, target, 'destroy', 'p1');
    expect(HOOKS['shock-jocks'].mayInterfere!(s, sj, 'p1')).toBe(true);
  });
});

describe('State Lotteries', () => {
  it('reshuffles all Plots in hand and draws one fewer', () => {
    const s0 = scenario();
    const sl = put(s0, 'p1', 'state-lotteries');
    const a = give(s0, 'p1', 'earthquake', { hand: true });
    const b = give(s0, 'p1', 'drought', { hand: true });
    const c = give(s0, 'p1', 'hurricane', { hand: true });
    const s = use(s0, 'p1', sl, 'redraw', { mode: 'plots' });
    expect(hand(s, 'p1').filter((x) => [a, b, c].includes(x)).length).toBe(0);
    expect(hand(s, 'p1').length).toBe(2);
  });
});

describe('Swingers', () => {
  it('+1 Power per other Liberal Group controlled', () => {
    const s = scenario();
    const sw = put(s, 'p1', 'swingers');
    expect(power(s, sw)).toBe(1);
    put(s, 'p1', 'democrats'); // Liberal
    expect(power(s, sw)).toBe(2);
  });
});

describe('The Green Party', () => {
  it('gives +1 Power to other Green Groups controlled', () => {
    const s = scenario();
    put(s, 'p1', 'the-green-party');
    const epa = put(s, 'p1', 'epa'); // Green attribute
    expect(power(s, epa)).toBe(def(s, epa).power! + 1);
  });
  it('+4 to control another Green Group', () => {
    const s0 = scenario();
    const gp = put(s0, 'p1', 'the-green-party');
    const target = put(s0, 'p2', 'epa');
    const s = attack(s0, gp, target, 'control');
    expect(line(s, 'Attack', 'The Green Party')).toBe(4);
  });
});

describe('The Thule Group', () => {
  it("discards Groups from hand to add their printed Power to an attack", () => {
    const s0 = scenario();
    const thule = put(s0, 'p1', 'the-thule-group');
    const mafia = put(s0, 'p1', 'the-mafia');
    const target = put(s0, 'p2', 'boy-sprouts');
    let s = attack(s0, mafia, target, 'control');
    const discard = give(s, 'p1', 'gun-lobby', { hand: true });
    s = use(s, 'p1', thule, 'sacrifice', { targets: [discard], mode: 'attack' });
    expect(line(s, 'Attack', 'The Thule Group (discarded Groups)')).toBe(def(s, discard).power ?? 0);
  });
  it('cannot be captured while linked to Hitler\'s Brain', () => {
    const s = scenario();
    const thule = put(s, 'p1', 'the-thule-group');
    const brain = give(s, 'p1', "hitler-s-brain", { resource: true });
    s.cards[brain].linkedTo = thule;
    const rival = put(s, 'p2', 'the-mafia');
    expect(validateAttack(s, 'p2', { type: 'attack', attackType: 'control', attacker: rival, target: thule }, { outOfTurn: true })).toMatch(/Hitler's Brain/);
  });
});

describe('General Disorder', () => {
  it('adds +10 to a Disaster and limits it to Devastate', () => {
    const s0 = scenario();
    const gd = put(s0, 'p1', 'general-disorder');
    const target = put(s0, 'p2', 'the-mafia');
    const plot = give(s0, 'p1', 'earthquake', { hand: true });
    startInstantAttack(s0, 'p1', { plot, target, power: 12, disaster: { destroyMargin: 7 } });
    const s = use(s0, 'p1', gd, 'disorder', {});
    expect(s.attack!.disaster!.devastateOnly).toBe(true);
  });
  it('comes back at the end of the turn if the game continues', () => {
    const s0 = scenario();
    const master = put(s0, 'p1', 'the-mafia');
    const gd = give(s0, 'p1', 'general-disorder', { under: master, side: openArrows(s0, master)[0] });
    const rival = put(s0, 'p2', 'gun-lobby');
    let s = attack(s0, rival, gd, 'destroy', 'p2');
    s = boost(s);
    s = resolve(s, [2, 2]);
    expect(s.cards[gd].zone).toBe('destroyed');
    expect(s.cards[gd].data?.reviveAtEndOfTurn).toBe(s.turn);
    // Force the delayed revival directly (end-of-turn processing runs inside finishTurn).
    HOOKS['general-disorder'].delayedRevive!(s, gd);
    expect(s.cards[gd].zone === 'structure' || s.cards[gd].zone === 'hand').toBe(true);
  });
});

describe('Lama Ramadingdong', () => {
  it('+1 Power for every other Green Group in play', () => {
    const s = scenario();
    const lama = put(s, 'p1', 'lama-ramadingdong');
    expect(power(s, lama)).toBe(1);
    put(s, 'p2', 'epa'); // Green, anyone's
    expect(power(s, lama)).toBe(2);
  });
  it('adds its Power to the defense of any Green Group under attack, no token needed', () => {
    const s0 = scenario();
    const lama = put(s0, 'p1', 'lama-ramadingdong');
    const green = put(s0, 'p2', 'epa');
    const rival = put(s0, 'p1', 'the-mafia');
    s0.cards[lama].tokens = 0;
    const s = attack(s0, rival, green, 'destroy');
    expect(line(s, 'Defense', 'Lama Ramadingdong')).toBe(power(s, lama));
  });
});

describe('Lyndon LaRouche', () => {
  it("his Power becomes his strongest Government or party puppet's printed Power", () => {
    const s = scenario();
    const larouche = put(s, 'p1', 'lyndon-larouche');
    expect(power(s, larouche)).toBe(1);
    const gov = put(s, 'p1', 'epa'); // Government alignment
    expect(power(s, larouche)).toBe(def(s, gov).power);
  });
  it('his alignments never count toward a Goal', () => {
    const s = scenario();
    const larouche = put(s, 'p1', 'lyndon-larouche');
    expect(goalAlignWeight(s, larouche, 'Weird')).toBe(0);
  });
});

describe('Newt Gingrich', () => {
  it('gives +3 to anyone destroying a Liberal Group, +5 more to his own direct attack', () => {
    const s0 = scenario();
    const newt = put(s0, 'p1', 'newt-gingrich');
    const target = put(s0, 'p2', 'democrats'); // Liberal
    let s = attack(s0, newt, target, 'destroy');
    expect(line(s, 'Attack', 'Newt Gingrich')).toBe(8);
  });
  it("still gives the smaller +3 to a rival's own attack on a Liberal Group", () => {
    const s0 = scenario();
    put(s0, 'p1', 'newt-gingrich');
    const attacker = put(s0, 'p2', 'the-mafia');
    const target = put(s0, 'p1', 'democrats');
    const s = attack(s0, attacker, target, 'destroy', 'p2');
    expect(line(s, 'Attack', 'Newt Gingrich')).toBe(3);
  });
});

describe('Teddy Kennedy', () => {
  it('his Liberal Groups are immune to Attacks to Control', () => {
    const s = scenario();
    put(s, 'p1', 'teddy-kennedy');
    const puppet = put(s, 'p1', 'democrats');
    const rival = put(s, 'p2', 'the-mafia');
    expect(validateAttack(s, 'p2', { type: 'attack', attackType: 'control', attacker: rival, target: puppet }, { outOfTurn: true })).toMatch(/immune/);
  });
  it('they defend at +5 against an Attack to Destroy', () => {
    const s0 = scenario();
    put(s0, 'p1', 'teddy-kennedy');
    const puppet = put(s0, 'p1', 'democrats');
    const rival = put(s0, 'p2', 'the-mafia');
    const s = attack(s0, rival, puppet, 'destroy', 'p2');
    expect(line(s, 'Defense', 'Teddy Kennedy')).toBe(5);
  });
});

describe('Vladimir Zhirinovsky', () => {
  it('+10 for his direct control of Russia', () => {
    const s0 = scenario();
    const z = put(s0, 'p1', 'vladimir-zhirinovsky');
    const russia = put(s0, 'p2', 'russia');
    const s = attack(s0, z, russia, 'control');
    expect(line(s, 'Attack', 'Vladimir Zhirinovsky')).toBe(10);
  });
  it('+5 for his direct control of another Communist Group', () => {
    const s0 = scenario();
    const z = put(s0, 'p1', 'vladimir-zhirinovsky');
    const target = put(s0, 'p2', 'china');
    const s = attack(s0, z, target, 'control');
    expect(line(s, 'Attack', 'Vladimir Zhirinovsky')).toBe(5);
  });
});
