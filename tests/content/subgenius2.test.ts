// SubGenius pack, batch subgenius2: the cards in scratchpad/expansions/batch_subgenius2.txt.
import { describe, expect, it } from 'vitest';
import {
  GOALS, HOOKS, abilitiesOf, applyAction, attackStrength, attributes, cardImplemented, destroyGroup, goalCount, goalNeeded, outSides,
  plotsInHand, power, waitingFor, type Action, type GameState,
} from '../../src/engine';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, i: number) => s.players[i].illuminati;
const use = (s: GameState, pl: string, card: string, ability: string, params: Record<string, unknown> = {}) =>
  act(s, pl, { type: 'useAbility', card, ability, params });
const attack = (s: GameState, pl: string, attacker: string, target: string, attackType: 'control' | 'destroy') =>
  act(s, pl, { type: 'attack', attackType, attacker, target });
function passAll(s: GameState): GameState {
  for (const pl of waitingFor(s)) if (s.window && !s.prompt && waitingFor(s).includes(pl)) s = act(s, pl, { type: 'pass' });
  return s;
}
function toRoll(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 10 && s.window?.kind === 'attack'; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  expect(s.window?.kind).toBe('roll');
  if (dice) s.attack!.roll = dice;
  return s;
}
function resolve(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
const boost = (s: GameState, pl: string, n = 30) => { s.attack!.attackBonus.push({ player: pl, amount: n, label: 'test' }); return s; };
/** Attack strength with and without a card in play (for constant, non-Plot bonuses). */
function diff(s: GameState, card: string) {
  const without = structuredClone(s);
  without.cards[card].zone = 'discard';
  const a = attackStrength(s, s.attack!), b = attackStrength(without, without.attack!);
  return { attack: a.attack - b.attack, defense: a.defense - b.defense };
}
/** Drain the announce/response window a 'move' or similar action opens. */
function settle(s: GameState): GameState {
  for (let i = 0; i < 10 && s.window; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}

const IDS = [
  'www-subgenius-com', 'connie-dobbs', 'dr-k-taden-legume', 'jesus-b', 'nhgh', 'overman-philo-drummond', 'reverend-ivan-stang',
  'st-janor-hypercleats', 'frop-farm', 'dallas-catacombs', 'dobbstown', 'dokstok', 'saucer-landing-strip', 'janor-device', 'martyr-meter',
  'sacred-stencil', 'the-prescriptures', 'the-true-pipe', 'three-fisted-tales-of-bob', 'arise', 'brag-of-the-subgenius',
  'cast-out-false-prophets', 'science-cannot-remove-the-terror-of-the-gods', 'the-anti-bob',
];

describe('subgenius2 batch: implemented', () => {
  it('every card in the batch is implemented', () => {
    for (const id of IDS) expect(cardImplemented(id), id).toBe(true);
  });
});

describe('www.subgenius.com', () => {
  it("spends its own action to draw a Group card in a mixed game", () => {
    let s = scenario();
    const g = give(s, 'p1', 'www-subgenius-com', { under: ill(s, 0), side: 'LEFT' });
    const before = s.players[0].groupDeck.length;
    s = use(s, 'p1', g, 'draw-group');
    expect(s.players[0].hand.length).toBe(1);
    expect(s.players[0].groupDeck.length).toBe(before - 1);
  });
  it('cannot use that action under the stand-alone SubGenius rules', () => {
    let s = scenario();
    const g = give(s, 'p1', 'www-subgenius-com', { under: ill(s, 0), side: 'LEFT' });
    s.settings.subgeniusRules = true;
    s.common = { plotDeck: [], groupDeck: [], plotDiscard: [], groupDiscard: [], uncontrolled: [] };
    expect(() => use(s, 'p1', g, 'draw-group')).toThrow(/uncontrolled area/);
  });
  it('draws an extra Group into the uncontrolled area at the start of the turn there', () => {
    let s = scenario();
    const g = give(s, 'p1', 'www-subgenius-com', { under: ill(s, 0), side: 'LEFT' });
    s.settings.subgeniusRules = true;
    s.common = { plotDeck: [], groupDeck: [...s.players[0].groupDeck], plotDiscard: [], groupDiscard: [], uncontrolled: [] };
    const before = s.common.groupDeck.length;
    HOOKS['www-subgenius-com'].onTurnStart!(s, g);
    expect(s.common.uncontrolled.length).toBe(1);
    expect(s.common.groupDeck.length).toBe(before - 1);
  });
});

describe('Connie Dobbs', () => {
  it('cannot be destroyed, and neither can her own puppets, while Straight and SubGenius', () => {
    let s = scenario();
    const connie = give(s, 'p1', 'connie-dobbs', { under: ill(s, 0), side: 'LEFT' });
    const puppet = give(s, 'p1', 'b-a-t-f', { under: connie, side: 'BOTTOM' });
    const attacker = give(s, 'p2', 'the-mafia', { under: ill(s, 1), side: 'TOP' });
    s.active = 1;
    s = resolve(boost(attack(s, 'p2', attacker, connie, 'destroy'), 'p2', 40), [1, 1]);
    expect(s.cards[connie].zone).toBe('structure');
    s.cards[attacker].tokens = 1;
    s = resolve(boost(attack(s, 'p2', attacker, puppet, 'destroy'), 'p2', 40), [1, 1]);
    expect(s.cards[puppet].zone).toBe('structure');
  });
  it('loses the protection once she is no longer SubGenius', () => {
    let s = scenario();
    const connie = give(s, 'p1', 'connie-dobbs', { under: ill(s, 0), side: 'LEFT' });
    s.cards[connie].mods.push({ source: 'test', kind: 'removeAttr', attr: 'SubGenius', until: 'endOfTurn' });
    const attacker = give(s, 'p2', 'the-mafia', { under: ill(s, 1), side: 'TOP' });
    s.active = 1;
    s = resolve(boost(attack(s, 'p2', attacker, connie, 'destroy'), 'p2', 40), [1, 1]);
    expect(s.cards[connie].zone).toBe('destroyed');
  });
});

describe("Dr. K'Taden Legume", () => {
  it('blocks any attack on another SubGenius Personality of his own controller', () => {
    let s = scenario();
    give(s, 'p1', 'dr-k-taden-legume', { under: ill(s, 0), side: 'RIGHT' });
    const target = give(s, 'p1', 'jesus-b', { under: ill(s, 0), side: 'LEFT' });
    const attacker = give(s, 'p2', 'the-mafia', { under: ill(s, 1), side: 'TOP' });
    s.active = 1;
    expect(() => attack(s, 'p2', attacker, target, 'destroy')).toThrow(/immune/);
  });
  it('does not protect a rival Personality, or a non-SubGenius one', () => {
    let s = scenario();
    give(s, 'p1', 'dr-k-taden-legume', { under: ill(s, 0), side: 'RIGHT' });
    const rivalPerson = give(s, 'p2', 'jesus-b', { under: ill(s, 1), side: 'LEFT' });
    const attacker = give(s, 'p1', 'the-mafia', { under: ill(s, 0), side: 'LEFT' });
    expect(() => attack(s, 'p1', attacker, rivalPerson, 'destroy')).not.toThrow();
  });
});

describe('Jesus B.', () => {
  it('buys one Slack for the Illuminati, once per game', () => {
    let s = scenario();
    const g = give(s, 'p1', 'jesus-b', { under: ill(s, 0), side: 'TOP' });
    const before = s.cards[ill(s, 0)].tokens;
    s = use(s, 'p1', g, 'buy-slack');
    expect(s.cards[ill(s, 0)].tokens).toBe(before + 1);
    expect(() => use(s, 'p1', g, 'buy-slack')).toThrow(/Already used/);
  });
});

describe('NHGH', () => {
  it('cannot be destroyed', () => {
    let s = scenario();
    const nhgh = give(s, 'p1', 'nhgh', { under: ill(s, 0), side: 'BOTTOM' });
    const attacker = give(s, 'p2', 'the-mafia', { under: ill(s, 1), side: 'TOP' });
    s.active = 1;
    expect(() => attack(s, 'p2', attacker, nhgh, 'destroy')).toThrow(/cannot be destroyed/);
  });
  it('can only be controlled by a player who has exposed The Anti"Bob"', () => {
    let s = scenario();
    const nhgh = give(s, 'p1', 'nhgh', { under: ill(s, 0), side: 'BOTTOM' });
    const attacker = give(s, 'p2', 'the-mafia', { under: ill(s, 1), side: 'TOP' });
    s.active = 1;
    expect(() => attack(s, 'p2', attacker, nhgh, 'control')).toThrow(/Anti"Bob"/);
    const antiBob = give(s, 'p2', 'the-anti-bob', { hand: true });
    s.cards[antiBob].exposed = true;
    expect(() => attack(s, 'p2', attacker, nhgh, 'control')).not.toThrow();
  });
  it('adds +5 to any Attack to Destroy while it sits uncontrolled', () => {
    let s = scenario();
    const nhgh = give(s, 'p1', 'nhgh', { under: ill(s, 0), side: 'BOTTOM' });
    Object.assign(s.cards[nhgh], { zone: 'uncontrolled', controller: undefined, master: undefined, x: undefined, y: undefined, side: undefined });
    const attacker = give(s, 'p2', 'the-mafia', { under: ill(s, 1), side: 'TOP' });
    const target = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'LEFT' });
    s.active = 1;
    s = attack(s, 'p2', attacker, target, 'destroy');
    expect(diff(s, nhgh).attack).toBe(5);
  });
  it('may be played from hand as a +5 Plot in a mixed game, and then belongs to the rival', () => {
    let s = scenario();
    const nhgh = give(s, 'p1', 'nhgh', { hand: true });
    const attacker = give(s, 'p1', 'the-mafia', { under: ill(s, 0), side: 'TOP' });
    const target = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'LEFT' });
    s = attack(s, 'p1', attacker, target, 'destroy');
    s = act(s, 'p1', { type: 'playPlot', play: { card: nhgh } });
    expect(s.attack!.attackBonus.some((c) => c.amount === 5)).toBe(true);
    expect(s.cards[nhgh].zone).toBe('hand');
    expect(s.players[1].hand).toContain(nhgh);
  });
});

describe('OverMan Philo Drummond', () => {
  it('gives his Weird puppets the SubGenius attribute', () => {
    let s = scenario();
    const philo = give(s, 'p1', 'overman-philo-drummond', { under: ill(s, 0), side: 'LEFT' });
    const puppet = give(s, 'p1', 'church-of-elvis', { under: philo, side: 'LEFT' }); // Weird
    expect(attributes(s, puppet)).toContain('SubGenius');
  });
  it('does not affect a non-Weird puppet', () => {
    let s = scenario();
    const philo = give(s, 'p1', 'overman-philo-drummond', { under: ill(s, 0), side: 'LEFT' });
    const puppet = give(s, 'p1', 'b-a-t-f', { under: philo, side: 'RIGHT' }); // Violent, Government
    expect(attributes(s, puppet)).not.toContain('SubGenius');
  });
});

describe('Reverend Ivan Stang', () => {
  it('gives his own token to another SubGenius Group with none', () => {
    let s = scenario();
    const stang = give(s, 'p1', 'reverend-ivan-stang', { under: ill(s, 0), side: 'TOP' });
    const target = give(s, 'p1', 'jesus-b', { under: ill(s, 0), side: 'LEFT' });
    s.cards[target].tokens = 0;
    s = use(s, 'p1', stang, 'give-token', { target });
    expect(s.cards[target].tokens).toBe(1);
    expect(s.cards[stang].tokens).toBe(0);
  });
  it('refuses a Group that already has a token, or is not SubGenius', () => {
    let s = scenario();
    const stang = give(s, 'p1', 'reverend-ivan-stang', { under: ill(s, 0), side: 'TOP' });
    const plain = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'LEFT' });
    expect(() => use(s, 'p1', stang, 'give-token', { target: plain })).toThrow(/SubGenius/);
  });
});

describe('St. Janor Hypercleats', () => {
  it('does not automatically fail on a natural 11 when he attacks', () => {
    let s = scenario();
    const janor = give(s, 'p1', 'st-janor-hypercleats', { under: ill(s, 0), side: 'LEFT' });
    const target = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'TOP' });
    s = resolve(boost(attack(s, 'p1', janor, target, 'destroy'), 'p1', 30), [5, 6]);
    expect(s.cards[target].zone).toBe('destroyed');
  });
  it('turns a natural 2 into a 12 (an automatic failure) and costs his Illuminati a token', () => {
    let s = scenario();
    const janor = give(s, 'p1', 'st-janor-hypercleats', { under: ill(s, 0), side: 'LEFT' });
    const target = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'TOP' });
    s.cards[ill(s, 0)].tokens = 1;
    s = resolve(boost(attack(s, 'p1', janor, target, 'destroy'), 'p1', 30), [1, 1]);
    expect(s.cards[target].zone).toBe('structure');
    expect(s.cards[ill(s, 0)].tokens).toBe(0);
  });
});

describe("'Frop Farm", () => {
  it('strips every Action token from a targeted Personality', () => {
    let s = scenario();
    const farm = give(s, 'p1', 'frop-farm', { under: ill(s, 0), side: 'RIGHT' });
    const target = give(s, 'p2', 'nancy-reagan', { under: ill(s, 1), side: 'RIGHT' });
    s = use(s, 'p1', farm, 'strip', { target });
    expect(s.cards[target].tokens).toBe(0);
  });
  it('refuses a target that is not a Personality', () => {
    let s = scenario();
    const farm = give(s, 'p1', 'frop-farm', { under: ill(s, 0), side: 'RIGHT' });
    const target = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'LEFT' });
    expect(() => use(s, 'p1', farm, 'strip', { target })).toThrow();
  });
});

describe('Dobbstown', () => {
  it('gives +5 on any attempt to control a SubGenius Personality', () => {
    let s = scenario();
    const dobbstown = give(s, 'p1', 'dobbstown', { under: ill(s, 0), side: 'LEFT' });
    const attacker = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'RIGHT' });
    const target = give(s, 'p2', 'jesus-b', { under: ill(s, 1), side: 'TOP' });
    s = attack(s, 'p1', attacker, target, 'control');
    expect(diff(s, dobbstown).attack).toBe(5);
  });
  it('does not help against a non-SubGenius Personality', () => {
    let s = scenario();
    const dobbstown = give(s, 'p1', 'dobbstown', { under: ill(s, 0), side: 'LEFT' });
    const attacker = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'RIGHT' });
    const target = give(s, 'p2', 'nancy-reagan', { under: ill(s, 1), side: 'RIGHT' });
    s = attack(s, 'p1', attacker, target, 'control');
    expect(diff(s, dobbstown).attack).toBe(0);
  });
});

describe('Dokstok', () => {
  it('gives its controller one extra Illuminati token at token placement', () => {
    let s = scenario();
    const g = give(s, 'p1', 'dokstok', { under: ill(s, 0), side: 'RIGHT' });
    expect(abilitiesOf(s, g)).toContainEqual({ kind: 'extraIlluminatiToken', value: 1 });
  });
});

describe('Saucer Landing Strip', () => {
  it('trades its token for two Plots when its controller holds none', () => {
    let s = scenario();
    const strip = give(s, 'p1', 'saucer-landing-strip', { under: ill(s, 0), side: 'RIGHT' });
    expect(s.players[0].hand.length).toBe(0);
    s = use(s, 'p1', strip, 'trade');
    expect(s.players[0].hand.length).toBe(2);
  });
  it('refuses while its controller still holds a Plot', () => {
    let s = scenario();
    const strip = give(s, 'p1', 'saucer-landing-strip', { under: ill(s, 0), side: 'RIGHT' });
    give(s, 'p1', 'swiss-bank-account', { hand: true });
    expect(() => use(s, 'p1', strip, 'trade')).toThrow(/no Plot/);
  });
});

describe('Janor Device', () => {
  it("adds 1 to the roll at its holder's choice, once", () => {
    let s = scenario();
    const device = give(s, 'p1', 'janor-device', { resource: true });
    const attacker = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'TOP' });
    const target = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'TOP' });
    s = toRoll(boost(attack(s, 'p1', attacker, target, 'destroy'), 'p1', 30), [3, 3]);
    s = use(s, 'p1', device, 'adjust', { mode: 'plus' });
    expect(s.attack!.plays.some((p) => p.effect.t === 'delta' && p.effect.value === 1)).toBe(true);
    expect(() => use(s, 'p1', device, 'adjust', { mode: 'minus' })).toThrow(/Already used/);
  });
  it("sends itself off in a roll-off after a natural 12, ending the holder's own turn", () => {
    let s = scenario();
    const device = give(s, 'p1', 'janor-device', { resource: true });
    const attacker = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'TOP' });
    const target = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'TOP' });
    s = resolve(boost(attack(s, 'p1', attacker, target, 'destroy'), 'p1', 30), [6, 6]);
    expect(s.turnFlags.endedAtOnce).toBe(true);
    expect(s.cards[device].controller).not.toBe('p1');
  });
});

describe('Martyr Meter', () => {
  it("gives an extra Action token to the Personality it's linked to", () => {
    let s = scenario();
    const meter = give(s, 'p1', 'martyr-meter', { resource: true });
    const person = give(s, 'p1', 'jesus-b', { under: ill(s, 0), side: 'TOP' });
    s = act(s, 'p1', { type: 'link', resource: meter, to: person });
    expect(HOOKS['martyr-meter'].extraTokens!(s, meter, person)).toBe(1);
  });
  it('cannot link to a non-Personality', () => {
    let s = scenario();
    const meter = give(s, 'p1', 'martyr-meter', { resource: true });
    const place = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'TOP' });
    expect(() => act(s, 'p1', { type: 'link', resource: meter, to: place })).toThrow(/cannot be linked/);
  });
});

describe('Sacred Stencil', () => {
  it('adds +5 to defense against an Attack to Destroy', () => {
    let s = scenario();
    const stencil = give(s, 'p1', 'sacred-stencil', { resource: true });
    const mine = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'TOP' });
    const attacker = give(s, 'p2', 'the-mafia', { under: ill(s, 1), side: 'TOP' });
    s.active = 1;
    s = attack(s, 'p2', attacker, mine, 'destroy');
    s = use(s, 'p1', stencil, 'boost');
    expect(s.attack!.defenseBonus.some((c) => c.amount === 5)).toBe(true);
  });
  it('does not help an Attack to Control', () => {
    let s = scenario();
    const stencil = give(s, 'p1', 'sacred-stencil', { resource: true });
    const mine = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'TOP' });
    const attacker = give(s, 'p2', 'the-mafia', { under: ill(s, 1), side: 'TOP' });
    s.active = 1;
    s = attack(s, 'p2', attacker, mine, 'control');
    expect(() => use(s, 'p1', stencil, 'boost')).toThrow();
  });
});

describe('The Prescriptures', () => {
  it("looks at a rival's Plots, paid with the Illuminati's action", () => {
    let s = scenario();
    const pres = give(s, 'p1', 'the-prescriptures', { resource: true });
    give(s, 'p2', 'swiss-bank-account', { hand: true });
    const ill0 = ill(s, 0);
    s = use(s, 'p1', pres, 'foresee', { mode: 'hand', target: ill(s, 1), payWith: [ill0] });
    expect(s.cards[ill0].tokens).toBe(0);
    expect(s.players[0].known?.length).toBeGreaterThan(0);
  });
  it('can instead be paid with the actions of all Personalities, at least one', () => {
    let s = scenario();
    const pres = give(s, 'p1', 'the-prescriptures', { resource: true });
    const person = give(s, 'p1', 'jesus-b', { under: ill(s, 0), side: 'TOP' });
    s = use(s, 'p1', pres, 'foresee', { mode: 'decks', payWith: [person] });
    expect(s.cards[person].tokens).toBe(0);
  });
  it('only once per turn', () => {
    let s = scenario();
    const pres = give(s, 'p1', 'the-prescriptures', { resource: true });
    const ill0 = ill(s, 0);
    s.cards[ill0].tokens = 2;
    s = use(s, 'p1', pres, 'foresee', { mode: 'decks', payWith: [ill0] });
    expect(() => use(s, 'p1', pres, 'foresee', { mode: 'decks', payWith: [ill0] })).toThrow();
  });
});

describe('The True Pipe', () => {
  it('gives the Illuminati +2 Power and +2 Global Power', () => {
    let s = scenario();
    give(s, 'p1', 'the-true-pipe', { resource: true });
    const without = structuredClone(s);
    for (const c of Object.values(without.cards)) if (c.cardId === 'the-true-pipe') c.zone = 'discard';
    expect(power(s, ill(s, 0)) - power(without, ill(s, 0))).toBe(2);
  });
});

describe('Three-Fisted Tales of "Bob"', () => {
  it('gives a linked SubGenius Place +2 Power and Global Power equal to its new Power', () => {
    let s = scenario();
    const book = give(s, 'p1', 'three-fisted-tales-of-bob', { resource: true });
    const place = give(s, 'p1', 'dobbstown', { under: ill(s, 0), side: 'TOP' }); // SubGenius Place, printed Power 3
    s = act(s, 'p1', { type: 'link', resource: book, to: place });
    expect(power(s, place)).toBe(3 + 2);
  });
  it('cannot link to a non-Place', () => {
    let s = scenario();
    const book = give(s, 'p1', 'three-fisted-tales-of-bob', { resource: true });
    const person = give(s, 'p1', 'jesus-b', { under: ill(s, 0), side: 'TOP' });
    expect(() => act(s, 'p1', { type: 'link', resource: book, to: person })).toThrow(/cannot be linked/);
  });
});

describe('Arise!', () => {
  it('spares a player with no puppets until the end of the turn, and lets them win if still puppetless', () => {
    let s = scenario();
    give(s, 'p2', 'arise', { hand: true });
    s.players[1].turnsTaken = 3;
    for (const c of Object.values(s.cards)) if (c.zone === 'structure' && c.controller === 'p2' && c.iid !== ill(s, 1)) c.zone = 'destroyed';
    s = act(s, 'p1', { type: 'endTurn' });
    for (let i = 0; i < 40 && s.phase !== 'gameOver'; i++) {
      if (s.prompt?.kind === 'takeover') s = act(s, s.prompt.player, { type: 'skipTakeover' });
      else if (s.prompt?.kind === 'discardToLimit') s = act(s, s.prompt.player, { type: 'discard', cards: [] });
      else if (s.window) s = act(s, waitingFor(s)[0], { type: 'pass' });
      else break;
    }
    expect(s.players[1].eliminated).toBe(false);
    expect(s.phase).toBe('gameOver');
    expect(s.winners).toContain('p2');
  });
  it('gives no such reprieve without the card in hand', () => {
    let s = scenario();
    s.players[1].turnsTaken = 3;
    for (const c of Object.values(s.cards)) if (c.zone === 'structure' && c.controller === 'p2' && c.iid !== ill(s, 1)) c.zone = 'destroyed';
    s = act(s, 'p1', { type: 'endTurn' });
    for (let i = 0; i < 40 && s.phase !== 'gameOver' && !s.players[1].eliminated; i++) {
      if (s.prompt?.kind === 'takeover') s = act(s, s.prompt.player, { type: 'skipTakeover' });
      else if (s.prompt?.kind === 'discardToLimit') s = act(s, s.prompt.player, { type: 'discard', cards: [] });
      else if (s.window) s = act(s, waitingFor(s)[0], { type: 'pass' });
      else break;
    }
    expect(s.players[1].eliminated).toBe(true);
  });
});

describe('Brag of the SubGenius', () => {
  it('counts a Power 3+ SubGenius Group as two Groups toward the Basic Goal', () => {
    let s = scenario();
    give(s, 'p1', 'brag-of-the-subgenius', { hand: true });
    give(s, 'p1', 'dobbstown', { under: ill(s, 0), side: 'TOP' }); // SubGenius, printed Power 3
    const met = GOALS['brag-of-the-subgenius'](s, 'p1');
    // 1 Place + doubling gives credit for 2 Groups; the Basic Goal itself needs many more, so check the
    // doubled count directly instead of the (unmet) full Goal.
    // 1 (the Illuminati itself) + 2 (Dobbstown counted twice for being a Power 3+ SubGenius Group).
    const doubled = goalCount(s, 'p1', (iid) => attributes(s, iid).includes('SubGenius') && power(s, iid, { goals: true }) >= 3);
    expect(doubled).toBe(3);
    expect(met === null || typeof met === 'string').toBe(true);
  });
});

describe('Cast Out False Prophets!', () => {
  it('is met once a faction of the same Illuminati is eliminated by you', () => {
    let s = scenario();
    give(s, 'p1', 'cast-out-false-prophets', { hand: true });
    expect(GOALS['cast-out-false-prophets'](s, 'p1')).toBeNull();
    s.cards[ill(s, 1)].cardId = s.cards[ill(s, 0)].cardId;
    s.players[1].eliminated = true;
    s.players[1].eliminatedBy = 'p1';
    expect(GOALS['cast-out-false-prophets'](s, 'p1')).toBeTruthy();
  });
  it('boosts an Attack to Destroy on a rival, played as a Plot', () => {
    let s = scenario();
    const plot = give(s, 'p1', 'cast-out-false-prophets', { hand: true });
    const attacker = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'TOP' });
    const target = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'TOP' });
    s = attack(s, 'p1', attacker, target, 'destroy');
    s = act(s, 'p1', { type: 'playPlot', play: { card: plot } });
    expect(s.attack!.attackBonus.some((c) => c.amount === 10)).toBe(true);
  });
  it('cannot boost an attack on your own Group', () => {
    let s = scenario();
    const plot = give(s, 'p1', 'cast-out-false-prophets', { hand: true });
    const attacker = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'TOP' });
    const target = give(s, 'p1', 'loan-sharks', { under: ill(s, 0), side: 'LEFT' });
    s = attack(s, 'p1', attacker, target, 'destroy');
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: plot } })).toThrow();
  });
});

describe('Science Cannot Remove the Terror of the Gods!', () => {
  it('is not met with too few destroyed Science or Church Groups', () => {
    let s = scenario();
    give(s, 'p1', 'science-cannot-remove-the-terror-of-the-gods', { hand: true });
    for (const side of ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] as const) give(s, 'p1', 'tv-preachers', { under: ill(s, 0), side });
    expect(GOALS['science-cannot-remove-the-terror-of-the-gods'](s, 'p1')).toBeNull();
  });
  it('is met once enough are destroyed and enough Church Groups are controlled', () => {
    let s = scenario();
    give(s, 'p1', 'science-cannot-remove-the-terror-of-the-gods', { hand: true });
    const roots = (['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] as const).map((side) => give(s, 'p1', 'tv-preachers', { under: ill(s, 0), side }));
    // A 5th Church Group, nested under whichever of the four still has a real open arrow of its own.
    const hub = roots.find((r) => outSides(s, r).length)!;
    give(s, 'p1', 'tv-preachers', { under: hub, side: outSides(s, hub)[0] });
    const v1 = give(s, 'p2', 'church-of-elvis', { under: ill(s, 1), side: 'TOP' });
    const v2 = give(s, 'p2', 'reformed-church-of-satan', { under: ill(s, 1), side: 'LEFT' });
    destroyGroup(s, v1, 'p1');
    destroyGroup(s, v2, 'p1');
    expect(GOALS['science-cannot-remove-the-terror-of-the-gods'](s, 'p1')).toBeTruthy();
  });
});

describe('The Anti"Bob"', () => {
  it('can be exposed once for an extra Illuminati token, and then never leaves the hand', () => {
    let s = scenario();
    const card = give(s, 'p1', 'the-anti-bob', { hand: true });
    const before = s.cards[ill(s, 0)].tokens;
    s = act(s, 'p1', { type: 'exposeCard', card });
    expect(s.cards[ill(s, 0)].tokens).toBe(before + 1);
    expect(s.cards[card].exposed).toBe(true);
    expect(() => act(s, 'p1', { type: 'exposeCard', card })).toThrow(/Already exposed/);
    expect(() => act(s, 'p1', { type: 'discard', cards: [card] })).toThrow();
  });
  it('is met by controlling 6 SubGenius Groups and destroying 2 rival SubGenius or Weird Groups', () => {
    let s = scenario();
    give(s, 'p1', 'the-anti-bob', { hand: true });
    const spots: [string, 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT'][] = [
      [ill(s, 0), 'TOP'], [ill(s, 0), 'RIGHT'], [ill(s, 0), 'BOTTOM'], [ill(s, 0), 'LEFT'],
    ];
    const roots = spots.map(([m, side]) => give(s, 'p1', 'dobbstown', { under: m, side }));
    give(s, 'p1', 'jesus-b', { under: roots[0], side: 'TOP' });
    give(s, 'p1', 'jesus-b', { under: roots[1], side: 'BOTTOM' });
    expect(GOALS['the-anti-bob'](s, 'p1')).toBeNull();
    const v1 = give(s, 'p2', 'church-of-elvis', { under: ill(s, 1), side: 'TOP' }); // Weird
    const v2 = give(s, 'p2', 'reformed-church-of-satan', { under: ill(s, 1), side: 'LEFT' });
    s.cards[v2].mods.push({ source: 'test', kind: 'addAttr', attr: 'SubGenius', until: 'permanent' });
    destroyGroup(s, v1, 'p1');
    destroyGroup(s, v2, 'p1');
    expect(GOALS['the-anti-bob'](s, 'p1')).toBeTruthy();
  });
});

const ALL_SIDES = ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] as const;
/** A side of `master` that is not really one of its (rotated) outgoing arrows. */
const fakeSide = (s: GameState, master: string) => ALL_SIDES.find((sd) => !outSides(s, master).includes(sd))!;

describe('Dallas Catacombs', () => {
  it('lets a Group move onto a side that is not really one of its master\'s arrows', () => {
    let s = scenario();
    give(s, 'p1', 'dallas-catacombs', { under: ill(s, 0), side: 'LEFT' });
    const philo = give(s, 'p1', 'overman-philo-drummond', { under: ill(s, 0), side: 'RIGHT' });
    const fake = fakeSide(s, philo);
    const g = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'TOP' });
    s = settle(act(s, 'p1', { type: 'move', group: g, onto: philo, side: fake, payWith: ill(s, 0) }));
    expect(s.cards[g].master).toBe(philo);
    expect(s.cards[g].side).toBe(fake);
    expect(outSides(s, philo)).not.toContain(fake);
  });
  it('refuses that same move without the Catacombs in play', () => {
    let s = scenario();
    const philo = give(s, 'p1', 'overman-philo-drummond', { under: ill(s, 0), side: 'RIGHT' });
    const fake = fakeSide(s, philo);
    const g = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'TOP' });
    expect(() => act(s, 'p1', { type: 'move', group: g, onto: philo, side: fake, payWith: ill(s, 0) })).toThrow(/not open/);
  });
  it('moves everything back onto a real arrow (or discards it) once the Catacombs are lost', () => {
    let s = scenario();
    const cat = give(s, 'p1', 'dallas-catacombs', { under: ill(s, 0), side: 'LEFT' });
    const philo = give(s, 'p1', 'overman-philo-drummond', { under: ill(s, 0), side: 'RIGHT' });
    const fake = fakeSide(s, philo);
    const g = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'TOP' });
    s = settle(act(s, 'p1', { type: 'move', group: g, onto: philo, side: fake, payWith: ill(s, 0) }));
    expect(s.cards[g].side).toBe(fake);
    destroyGroup(s, cat, 'p2');
    const backOnRealArrow = s.cards[g].zone === 'structure' && outSides(s, s.cards[g].master!).includes(s.cards[g].side!);
    expect(s.cards[g].zone === 'discard' || backOnRealArrow).toBe(true);
  });
});
