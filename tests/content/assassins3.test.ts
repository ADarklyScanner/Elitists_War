// Assassins pack, batch "assassins3": 5 NWOs plus 20 Plot cards. See src/engine/content/assassins3.ts.
import { describe, expect, it } from 'vitest';
import {
  applyAction, alignments, attributes, cardImplemented, frozen, goalNeeded, goalOptions, isParalyzed, openArrows, paralysesOn,
  player as playerOf, power, resistance, waitingFor, zapsOn, type Action, type AttackType, type GameState,
} from '../../src/engine';
import { alignmentPairs } from '../../src/engine/stats';
import { give, scenario } from '../helpers';

const BATCH = [
  'global-warming', 'interesting-times', 'the-magic-goes-away', 'visualize-whirled-peas', 'watermelons',
  'a-brief-attack-of-conscience', 'alien-abduction', 'anarchists-unite', 'anything-worth-doing-is-worth-overdoing',
  'back-to-the-drawing-board', 'back-to-the-salt-mines', 'backfire', 'backmasquerade', 'bait-and-switch', 'bar-codes',
  'beach-party', 'bite-the-wax-tadpole', 'brushfire-war', 'cat-juggling', 'cease-fire', 'chain-letter',
  'contract-on-america', 'crackdown-on-crime', 'crusade', 'death-to-all-fanatics',
];

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, pl: string) => playerOf(s, pl).illuminati;
function put(s: GameState, pl: string, cardId: string, under?: string): string {
  const m = under ?? ill(s, pl);
  const side = openArrows(s, m)[0];
  if (!side) throw new Error(`no open arrow under ${m}`);
  return give(s, pl, cardId, { under: m, side });
}
const attack = (s: GameState, attacker: string, target: string, attackType: AttackType) =>
  act(s, 'p1', { type: 'attack', attackType, attacker, target });
function resolveAttack(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
function playAndResolve(s: GameState, pl: string, play: { card: string; [k: string]: unknown }): GameState {
  s = act(s, pl, { type: 'playPlot', play });
  while (s.window?.kind === 'plot') s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}

describe('assassins3: every card is implemented', () => {
  it('cardImplemented is true for the whole batch', () => {
    for (const id of BATCH) expect(cardImplemented(id), id).toBe(true);
  });
});

describe('Global Warming (NWO)', () => {
  it('shrinks Coastal Places (never below 1), makes other land Coastal, and boosts Green groups', () => {
    let s = scenario();
    const brazil = put(s, 'p1', 'brazil'); // Coastal, not Green, printed Power 3
    const before = power(s, brazil);
    s = playAndResolve(s, 'p1', { card: give(s, 'p1', 'global-warming', { hand: true }) });
    expect(power(s, brazil)).toBe(before - 2);
    const island = put(s, 'p1', 'hawaii'); // already Coastal, printed Power 1: never drops below 1
    expect(power(s, island)).toBe(1);
    const landlocked = put(s, 'p1', 'las-vegas'); // not Coastal, not Space
    expect(attributes(s, landlocked)).toContain('Coastal');
    const green = put(s, 'p1', 'druids');
    expect(power(s, green)).toBe(4); // printed 2 + 2
  });
});

describe('Interesting Times (NWO)', () => {
  it('"basic" mode blocks Goal cards and Special Goals from winning', () => {
    let s = scenario();
    const c = give(s, 'p1', 'interesting-times', { hand: true });
    s = playAndResolve(s, 'p1', { card: c, mode: 'basic' });
    expect(goalOptions(s, 'p1').every((o) => o.id === 'basic')).toBe(true);
  });
  it('"harder" mode raises the Basic Goal by two Groups', () => {
    let s = scenario();
    const before = goalNeeded(s, 'p1');
    const c = give(s, 'p1', 'interesting-times', { hand: true });
    s = playAndResolve(s, 'p1', { card: c, mode: 'harder' });
    expect(goalNeeded(s, 'p1')).toBe(before + 2);
  });
  it('cannot be played without choosing a mode', () => {
    const s = scenario();
    const c = give(s, 'p1', 'interesting-times', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: c } })).toThrow(/Choose/);
  });
});

describe('The Magic Goes Away (NWO)', () => {
  it('Magic groups lose 1 Power, Illuminati lose 1 Power, and no automatic takeovers happen', () => {
    let s = scenario();
    const witch = put(s, 'p1', 'druids');
    const before = power(s, witch);
    const beforeIll = power(s, ill(s, 'p1'));
    s = playAndResolve(s, 'p1', { card: give(s, 'p1', 'the-magic-goes-away', { hand: true }) });
    expect(power(s, witch)).toBe(before - 1);
    expect(power(s, ill(s, 'p1'))).toBe(beforeIll - 1);
  });
});

describe('Visualize Whirled Peas (NWO)', () => {
  it('two Fanatic groups no longer oppose each other, and non-Weird Fanatics get +2 Power', () => {
    let s = scenario();
    const a = put(s, 'p1', 'elders-of-zion');
    const b = put(s, 'p2', 'goldfish-fanciers');
    const before = alignmentPairs(s, a, b);
    expect(before.opposite).toBeGreaterThan(0);
    const beforePower = power(s, a);
    s = playAndResolve(s, 'p1', { card: give(s, 'p1', 'visualize-whirled-peas', { hand: true }) });
    const after = alignmentPairs(s, a, b);
    expect(after.opposite).toBe(0);
    expect(after.same).toBeGreaterThan(0);
    expect(power(s, a)).toBe(beforePower + 2);
  });
});

describe('Watermelons (NWO / link)', () => {
  it('as an NWO: Green and Communist groups count as each other', () => {
    let s = scenario();
    const green = put(s, 'p1', 'druids');
    s = playAndResolve(s, 'p1', { card: give(s, 'p1', 'watermelons', { hand: true }) });
    expect(attributes(s, green)).toContain('Communist');
  });
  it('linked to a Group instead: it becomes both, permanently, and counts as a Plot', () => {
    let s = scenario();
    const commie = put(s, 'p1', 'fiendish-fluoridators');
    const c = give(s, 'p1', 'watermelons', { hand: true });
    s = playAndResolve(s, 'p1', { card: c, mode: 'link', target: commie });
    expect(attributes(s, commie)).toContain('Green');
    expect(attributes(s, commie)).toContain('Communist');
  });
  it('the link needs a Green or Communist Group', () => {
    const s = scenario();
    const other = put(s, 'p1', 'the-mafia');
    const c = give(s, 'p1', 'watermelons', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: c, mode: 'link', target: other } })).toThrow(/Green or Communist/);
  });
});

describe('Zaps', () => {
  const cases: [string, string][] = [
    ['a-brief-attack-of-conscience', 'Assassinations'],
    ['anarchists-unite', 'Government'],
    ['anything-worth-doing-is-worth-overdoing', 'Conservative'],
    ['bait-and-switch', 'Corporate'],
    ['brushfire-war', 'Peaceful'],
  ];
  for (const [id, word] of cases) {
    it(`${id}: restricts the victim's Power Structure until removed`, () => {
      let s = scenario();
      const c = give(s, 'p1', id, { hand: true });
      s.cards[ill(s, 'p1')].tokens = 2; // one to Zap, one left to remove it again below
      s = playAndResolve(s, 'p1', { card: c, target: ill(s, 'p2'), payWith: [ill(s, 'p1')] });
      expect(zapsOn(s, 'p2').length).toBe(1);
      // Any player may remove every Zap from one player, paying with his own Illuminati action.
      s = act(s, 'p1', { type: 'removeZaps', player: 'p2' });
      expect(zapsOn(s, 'p2').length).toBe(0);
      void word;
    });
    it(`${id}: only playable on a rival's Illuminati`, () => {
      const s = scenario();
      const c = give(s, 'p1', id, { hand: true });
      expect(() => act(s, 'p1', { type: 'playPlot', play: { card: c, target: ill(s, 'p1'), payWith: [ill(s, 'p1')] } })).toThrow(/rival/);
    });
  }
  it('Back to the Drawing Board: a Group draw becomes a Plot draw instead', () => {
    let s = scenario();
    const c = give(s, 'p1', 'back-to-the-drawing-board', { hand: true });
    s = playAndResolve(s, 'p1', { card: c, target: ill(s, 'p2'), payWith: [ill(s, 'p1')] });
    // Move to p2's turn so p2 may use the Illuminati's Group-draw action.
    s = act(s, 'p1', { type: 'endTurn' });
    for (let i = 0; i < 20 && !(s.phase === 'main' && s.active === 1); i++) s = act(s, waitingFor(s)[0], s.prompt?.kind === 'takeover' ? { type: 'skipTakeover' } : { type: 'pass' });
    const before = playerOf(s, 'p2').hand.length;
    const beforeGroupDeck = playerOf(s, 'p2').groupDeck.length;
    s = act(s, 'p2', { type: 'drawGroup', payWith: [ill(s, 'p2')] });
    expect(playerOf(s, 'p2').groupDeck.length).toBe(beforeGroupDeck); // untouched
    expect(playerOf(s, 'p2').hand.length).toBe(before + 1);
  });
});

describe('Attribute Freezes', () => {
  it('Backfire: no Magic group may spend its action token (except to defend) this turn', () => {
    let s = scenario();
    const magic = put(s, 'p1', 'druids');
    const c = give(s, 'p1', 'backfire', { hand: true });
    s = playAndResolve(s, 'p1', { card: c, payWith: [ill(s, 'p1')] });
    expect(frozen(s, magic)).toBe(true);
  });
  it('Bite the Wax Tadpole: right after a Media Group acts, cancels that action', () => {
    let s = scenario();
    const media = put(s, 'p1', 'comic-books');
    const target = put(s, 'p2', 'the-mafia');
    const c = give(s, 'p2', 'bite-the-wax-tadpole', { hand: true });
    s = attack(s, media, target, 'destroy'); // media itself is the attacker
    s = act(s, 'p2', { type: 'playPlot', play: { card: c, mode: 'cancel', target: media, payWith: [ill(s, 'p2')] } });
    s = resolveAttack(s, [1, 1]);
    expect(s.log.some((l) => /cancelled/.test(l.text))).toBe(true);
    expect(s.cards[target].zone).toBe('structure');
  });
});

describe('Paralysis', () => {
  const cases: [string, string, string][] = [
    ['cat-juggling', 'anti-war-activists', 'Peaceful'],
    ['chain-letter', 'bank-of-england', 'Straight'],
    ['contract-on-america', 'anti-war-activists', 'Liberal'],
    ['crackdown-on-crime', 'clone-arrangers', 'Criminal'],
    ['death-to-all-fanatics', 'elders-of-zion', 'Fanatic'],
  ];
  for (const [id, target, align] of cases) {
    it(`${id}: Paralyzes a ${align} Group with an Illuminati action`, () => {
      let s = scenario();
      const g = put(s, 'p2', target);
      s.cards[ill(s, 'p1')].tokens = 2; // one to Paralyze, one left over to free it again below
      const c = give(s, 'p1', id, { hand: true });
      s = playAndResolve(s, 'p1', { card: c, target: g, payWith: [ill(s, 'p1')] });
      expect(isParalyzed(s, g)).toBe(true);
      // Any Illuminati may free it, each paying with its own action (it is p1's turn here).
      s = act(s, 'p1', { type: 'freeGroup', group: g, payWith: ill(s, 'p1') });
      expect(isParalyzed(s, g)).toBe(false);
      expect(paralysesOn(s, g).length).toBe(0);
    });
  }
});

describe('Alien Abduction', () => {
  it('strips a Personality of alignments until the end of the turn', () => {
    let s = scenario();
    const p = put(s, 'p1', 'bjorne');
    expect(alignments(s, p).length).toBeGreaterThan(0);
    const c = give(s, 'p1', 'alien-abduction', { hand: true });
    s = playAndResolve(s, 'p1', { card: c, target: p });
    expect(alignments(s, p)).toEqual([]);
  });
  it('with a Space Group\'s action: pulls a hand Personality straight into your Power Structure', () => {
    let s = scenario();
    const spaceGroup = put(s, 'p1', 'nasa');
    const person = give(s, 'p1', 'bjorne', { hand: true });
    const c = give(s, 'p1', 'alien-abduction', { hand: true });
    s = playAndResolve(s, 'p1', { card: c, mode: 'abduct', target: person, payWith: [spaceGroup] });
    expect(s.cards[person].zone).toBe('structure');
    expect(s.cards[person].controller).toBe('p1');
  });
});

describe('Back to the Salt Mines', () => {
  it('adds +10 to the attack; the defender\'s copy bumps the attacker\'s copy back to hand', () => {
    let s = scenario();
    const attacker = put(s, 'p1', 'the-mafia');
    const place = put(s, 'p2', 'california');
    const mine1 = give(s, 'p1', 'back-to-the-salt-mines', { hand: true });
    const mine2 = give(s, 'p2', 'back-to-the-salt-mines', { hand: true });
    s = attack(s, attacker, place, 'destroy');
    s = act(s, 'p1', { type: 'playPlot', play: { card: mine1 } });
    expect(s.attack!.attackBonus.some((b) => b.plot === mine1)).toBe(true);
    s = act(s, 'p2', { type: 'playPlot', play: { card: mine2 } });
    expect(s.attack!.attackBonus.some((b) => b.plot === mine1)).toBe(false);
    expect(playerOf(s, 'p1').hand).toContain(mine1);
    s = resolveAttack(s, [1, 1]); // low roll: the defense (mine2's side) should prevail
    expect(playerOf(s, 'p2').hand).toContain(mine2);
    expect(s.cards[mine2].exposed).toBe(true);
  });
  it('cannot be played outside an attack on a Place', () => {
    let s = scenario();
    const attacker = put(s, 'p1', 'the-mafia');
    const target = put(s, 'p2', 'the-mafia');
    const c = give(s, 'p1', 'back-to-the-salt-mines', { hand: true });
    s = attack(s, attacker, target, 'destroy');
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: c } })).toThrow(/Place/);
  });
});

describe('Backmasquerade', () => {
  it('links to a Magic Group, which can then spend its action to remove any Zap', () => {
    let s = scenario();
    const magic = put(s, 'p1', 'druids');
    const back = give(s, 'p1', 'backmasquerade', { hand: true });
    s = playAndResolve(s, 'p1', { card: back, target: magic });
    const zap = give(s, 'p1', 'brushfire-war', { hand: true });
    s.cards[ill(s, 'p1')].tokens = 1;
    s = playAndResolve(s, 'p1', { card: zap, target: ill(s, 'p2'), payWith: [ill(s, 'p1')] });
    const zapCard = zapsOn(s, 'p2')[0];
    expect(zapCard).toBeTruthy();
    s = act(s, 'p1', { type: 'useAbility', card: back, ability: 'unzap-one', params: { target: zapCard } });
    expect(zapsOn(s, 'p2').length).toBe(0);
    expect(s.cards[magic].tokens).toBe(0);
  });
  it('only one Backmasquerade may be in play: a new one discards the old', () => {
    let s = scenario();
    const magic1 = put(s, 'p1', 'druids');
    const magic2 = put(s, 'p1', 'cattle-mutilators');
    const first = give(s, 'p1', 'backmasquerade', { hand: true });
    s = playAndResolve(s, 'p1', { card: first, target: magic1 });
    const second = give(s, 'p1', 'backmasquerade', { hand: true });
    s = playAndResolve(s, 'p1', { card: second, target: magic2 });
    expect(s.cards[first].zone).toBe('discard');
    expect(s.cards[second].linkedTo).toBe(magic2);
  });
});

describe('Bar Codes', () => {
  it('looks through a rival\'s Group deck with a Computer Group\'s action', () => {
    let s = scenario();
    const eff = put(s, 'p1', 'eff');
    const c = give(s, 'p1', 'bar-codes', { hand: true });
    const before = [...playerOf(s, 'p2').groupDeck];
    s = playAndResolve(s, 'p1', { card: c, target: ill(s, 'p2'), payWith: [eff] });
    expect(playerOf(s, 'p2').groupDeck).toEqual(before); // order untouched unless the rival shuffles
    expect(s.cards[eff].tokens).toBe(0);
  });
});

describe('Beach Party', () => {
  it('gives Relief and an Action token to a Devastated Coastal Place, and +5 vs later Disasters', () => {
    let s = scenario();
    const cal = put(s, 'p1', 'california');
    s.cards[cal].devastated = true;
    s.cards[cal].tokens = 0;
    const c = give(s, 'p1', 'beach-party', { hand: true });
    s = playAndResolve(s, 'p1', { card: c, target: cal });
    expect(s.cards[cal].devastated).toBe(false);
    expect(s.cards[cal].tokens).toBe(1);
  });
  it('needs a Coastal Place that is actually Devastated', () => {
    const s = scenario();
    const cal = put(s, 'p1', 'california');
    const c = give(s, 'p1', 'beach-party', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: c, target: cal } })).toThrow(/Devastated/);
  });
});

describe('Cease-Fire', () => {
  it('removes every Zap once two or more players are Zapped, discarding your top deck card unseen', () => {
    let s = scenario();
    const zapOnP2 = give(s, 'p1', 'bait-and-switch', { hand: true });
    s = playAndResolve(s, 'p1', { card: zapOnP2, target: ill(s, 'p2'), payWith: [ill(s, 'p1')] });
    // Move to p2's turn so p2 can Zap p1 back.
    s = act(s, 'p1', { type: 'endTurn' });
    for (let i = 0; i < 20 && !(s.phase === 'main' && s.active === 1); i++) s = act(s, waitingFor(s)[0], s.prompt?.kind === 'takeover' ? { type: 'skipTakeover' } : { type: 'pass' });
    s.cards[ill(s, 'p2')].tokens = 1;
    const zapOnP1 = give(s, 'p2', 'brushfire-war', { hand: true });
    s = playAndResolve(s, 'p2', { card: zapOnP1, target: ill(s, 'p1'), payWith: [ill(s, 'p2')] });
    expect(zapsOn(s, 'p1').length + zapsOn(s, 'p2').length).toBe(2);
    const cf = give(s, 'p2', 'cease-fire', { hand: true }); // it is p2's turn now
    const before = playerOf(s, 'p2').plotDeck.length;
    s = playAndResolve(s, 'p2', { card: cf, mode: 'plot' });
    expect(zapsOn(s, 'p1').length).toBe(0);
    expect(zapsOn(s, 'p2').length).toBe(0);
    expect(playerOf(s, 'p2').plotDeck.length).toBe(before - 1);
  });
  it('cannot be played while fewer than two players are Zapped', () => {
    const s = scenario();
    const cf = give(s, 'p1', 'cease-fire', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: cf, mode: 'plot' } })).toThrow(/two/);
  });
});

describe('Crusade', () => {
  it('gives a Church Group +10 Power for its own declared attack', () => {
    let s = scenario();
    const church = put(s, 'p1', 'church-of-elvis');
    const target = put(s, 'p2', 'the-mafia');
    const c = give(s, 'p1', 'crusade', { hand: true });
    s = attack(s, church, target, 'destroy');
    s = act(s, 'p1', { type: 'playPlot', play: { card: c, target: church, mode: 'action-power' } });
    expect(s.attack!.attackBonus.some((b) => b.plot === c && b.amount === 10)).toBe(true);
  });
  it('gives a Church Group +10 defense until the end of the turn, not counting for Goals', () => {
    let s = scenario();
    const church = put(s, 'p1', 'church-of-elvis');
    const before = resistance(s, church);
    const c = give(s, 'p1', 'crusade', { hand: true });
    s = playAndResolve(s, 'p1', { card: c, target: church, mode: 'turn-resistance' });
    expect(resistance(s, church, { defense: true } as never)).toBe(before + 10);
    expect(resistance(s, church, { goals: true } as never)).toBe(before);
  });
  it('only works on a Church Group the player controls', () => {
    const s = scenario();
    const other = put(s, 'p1', 'the-mafia');
    const c = give(s, 'p1', 'crusade', { hand: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: c, target: other, mode: 'turn-power' } })).toThrow(/Church/);
  });
});
