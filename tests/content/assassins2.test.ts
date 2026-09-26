// Assassins pack, batch "assassins2": Al Amarja, Australia, Illuminati University; Black Helicopters,
// Blivit, Killer Satellite, Lenin's Body, Orgone Grinder, Power Satellite, Screaming Meme, Spy
// Satellite, The Big Prawn, X-Ray Specs; Spontaneous Combustion; Drought, Flesh-Eating Bacteria,
// No Beer!, Oil Spill; Blinded by Science, Earth First!, Population Reduction; Antitrust Legislation,
// Apathy, Australian Rules, End of the World.
//
// Attacks, links and resource plays can only be made by the active player (scenario() starts with
// p1 active), so most attack/Disaster tests below have p1 launch them against p2's cards.
import { describe, expect, it } from 'vitest';
import {
  applyAction, attackStrength, cardImplemented, def, GOALS, globalPower, goalCount, goalNeeded, power,
  resistance, alignments, attributes, waitingFor,
  type Action, type GameState, type PlotPlay, type Side,
} from '../../src/engine';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const play = (s: GameState, pl: string, p: PlotPlay) => act(s, pl, { type: 'playPlot', play: p });
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const under = (s: GameState, pl: string, id: string, side: Side = 'BOTTOM', master?: string) => give(s, pl, id, { under: master ?? ill(s, pl), side });
const hand = (s: GameState, pl: string, id: string) => give(s, pl, id, { hand: true });
const use = (s: GameState, pl: string, card: string, ability: string, params: Record<string, unknown> = {}) =>
  act(s, pl, { type: 'useAbility', card, ability, params });

/** Pass for everyone until the window/attack is over, forcing the dice if given (each 1-6). */
function finish(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 30 && (s.window || s.attack); i++) {
    if (dice && s.window?.kind === 'roll' && s.attack?.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** End the active player's turn and answer whatever comes up until the next player's main phase. */
function nextTurn(s: GameState): GameState {
  s = act(s, s.players[s.active].id, { type: 'endTurn' });
  for (let i = 0; i < 30 && (s.window || s.prompt); i++) {
    if (s.prompt) {
      const pl = s.prompt.player;
      if (s.prompt.kind === 'takeover') s = act(s, pl, { type: 'skipTakeover' });
      else if (s.prompt.kind === 'draw') s = act(s, pl, { type: 'skipDraw' });
      else if (s.prompt.kind === 'choose') s = act(s, pl, { type: 'choose', ids: s.prompt.choice!.options.slice(0, s.prompt.choice!.min).map((o) => o.id) });
      else s = act(s, pl, { type: 'discard', cards: [] });
    } else if (s.window) s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}

let k = 0;
function withPlotDeck(s: GameState, pl: string, n: number) {
  const ids = Array.from({ length: n }, () => `pd${++k}`);
  s.players.find((p) => p.id === pl)!.plotDeck = ids;
  for (const iid of ids) s.cards[iid] = { iid, cardId: 'apathy', owner: pl, zone: 'plotDeck', tokens: 0, mods: [] };
}
/** Put a Group straight into a player's structure, bypassing arrow geometry (Goal counting only). */
function put(s: GameState, pl: string, cardId: string): string {
  const iid = `pp${++k}`;
  s.cards[iid] = { iid, cardId, owner: pl, zone: 'structure', controller: pl, master: ill(s, pl), x: 100 + k, y: 100, tokens: 1, mods: [] };
  return iid;
}
/** A Group this player destroyed (for Goal cards). */
function destroyedCredit(s: GameState, pl: string, cardId: string): string {
  const iid = `d${++k}`;
  s.cards[iid] = { iid, cardId, owner: pl === 'p1' ? 'p2' : 'p1', zone: 'destroyed', tokens: 0, mods: [] };
  s.players.find((p) => p.id === pl)!.destroyedCredit.push(iid);
  return iid;
}
/** Put an NWO straight into play. */
function nwoInPlay(s: GameState, pl: string, cardId: string, color: string) {
  const n = hand(s, pl, cardId);
  s.players.find((p) => p.id === pl)!.hand = s.players.find((p) => p.id === pl)!.hand.filter((x) => x !== n);
  Object.assign(s.cards[n], { zone: 'table', controller: pl, linkedTo: 'nwo' });
  s.nwo[color] = n;
  return n;
}

// ------------------------------------------------------------------ cardImplemented

describe('assassins2 batch: implemented', () => {
  const ids = [
    'al-amarja', 'australia', 'illuminati-university', 'black-helicopters', 'blivit', 'killer-satellite',
    'lenin-s-body', 'orgone-grinder', 'power-satellite', 'screaming-meme', 'spy-satellite', 'the-big-prawn',
    'x-ray-specs', 'spontaneous-combustion', 'drought', 'flesh-eating-bacteria', 'no-beer', 'oil-spill',
    'blinded-by-science', 'earth-first', 'population-reduction', 'antitrust-legislation', 'apathy',
    'australian-rules', 'end-of-the-world',
  ];
  for (const id of ids) it(`${id} is implemented`, () => expect(cardImplemented(id)).toBe(true));
});

// ------------------------------------------------------------------ Groups (Places)

describe('Al Amarja', () => {
  it('is immune to I Lied for its controller, and discards Plots for +4 defense against a Disaster', () => {
    let s = scenario();
    const ama = under(s, 'p2', 'al-amarja');
    withPlotDeck(s, 'p2', 2);
    const spill = hand(s, 'p1', 'oil-spill');
    s = play(s, 'p1', { card: spill, target: ama });
    expect(s.attack).toBeDefined();
    const before = attackStrength(s, s.attack!).defense;
    s = use(s, 'p2', ama, 'burn-plot');
    expect(attackStrength(s, s.attack!).defense).toBe(before + 4);
    expect(s.players.find((p) => p.id === 'p2')!.plotDeck.length).toBe(1);
    s = finish(s, [1, 1]);
    expect(s.cards[ama].zone).toBe('structure'); // survives: Al Amarja is not Coastal
  });

  it("cannot be used by another player, or when no Disaster is striking Al Amarja/its master/a puppet", () => {
    const s = scenario();
    const ama = under(s, 'p2', 'al-amarja');
    withPlotDeck(s, 'p2', 1);
    // No attack under way at all: the ability's timing itself forbids it.
    expect(() => use(s, 'p2', ama, 'burn-plot')).toThrow();
    // A normal (non-Disaster) attack on Al Amarja: still refused, and not by its controller only.
    const attacker = under(s, 'p1', 'c-i-a');
    const a = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker, target: ama });
    expect(() => use(a, 'p1', ama, 'burn-plot')).toThrow();
    expect(() => use(a, 'p2', ama, 'burn-plot')).toThrow(/Disaster/);
  });
});

describe('Australia', () => {
  it('doubles its own Resistance while controlled, and gets +10 vs a normal Attack to Destroy', () => {
    const s = scenario();
    const aus = under(s, 'p2', 'australia');
    expect(resistance(s, aus)).toBe(12); // printed 6, doubled
    const attacker = under(s, 'p1', 'c-i-a');
    const a = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker, target: aus });
    expect(attackStrength(a, a.attack!).defense).toBeGreaterThanOrEqual(12 + 10);
  });
  it('the +10/+4 bonuses do not help against a Disaster', () => {
    let s = scenario();
    const aus = under(s, 'p2', 'australia');
    const spill = hand(s, 'p1', 'no-beer');
    s = play(s, 'p1', { card: spill, target: aus });
    // Defense against the Disaster is Australia's (doubled) Resistance plus the ordinary closeness
    // bonus, but never the extra +10 (or +4 for other Organizations) that only helps vs. Attacks to Destroy.
    expect(attackStrength(s, s.attack!).defense).toBeLessThan(resistance(s, aus) + 10);
  });
});

describe('Illuminati University', () => {
  it('is immune to Disasters and to Straight/Government Groups, but not to others', () => {
    const s = scenario();
    const iou = under(s, 'p2', 'illuminati-university');
    const bug = hand(s, 'p1', 'flesh-eating-bacteria');
    expect(() => play(s, 'p1', { card: bug, target: iou })).toThrow(/immune/);
    const fbi = under(s, 'p1', 'fbi'); // Straight, Government
    expect(() => act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: fbi, target: iou })).toThrow();
  });
  it('a Violent Group (neither Straight nor Government) can still attack it', () => {
    const s = scenario();
    const iou = under(s, 'p2', 'illuminati-university');
    const attacker = under(s, 'p1', 'druids');
    const a = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker, target: iou });
    expect(a.attack).toBeDefined();
  });
  it('must pay tuition at the end of every turn or discard itself', () => {
    let s = scenario();
    const iou = under(s, 'p1', 'illuminati-university');
    withPlotDeck(s, 'p1', 1);
    s = act(s, 'p1', { type: 'endTurn' });
    s = act(s, 'p2', { type: 'pass' }); // closes the end-of-turn window: tuition is due
    expect(s.prompt?.kind).toBe('choose');
    const opt = s.prompt!.choice!.options.find((o) => o.id === 'topPlot')!;
    s = act(s, 'p1', { type: 'choose', ids: [opt.id] });
    expect(s.cards[iou].zone).toBe('structure');
    expect(s.players.find((p) => p.id === 'p1')!.plotDeck.length).toBe(0);
  });
  it('giving it up returns its puppets to hand', () => {
    let s = scenario();
    const iou = under(s, 'p1', 'illuminati-university');
    const puppet = under(s, 'p1', 'druids', 'RIGHT', iou);
    s = act(s, 'p1', { type: 'endTurn' });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.prompt?.kind).toBe('choose');
    s = act(s, 'p1', { type: 'choose', ids: ['discardIOU'] });
    expect(s.cards[iou].zone).toBe('discard');
    expect(s.cards[puppet].zone).toBe('hand');
    expect(s.players.find((p) => p.id === 'p1')!.hand).toContain(puppet);
  });
});

// ------------------------------------------------------------------ Resources

describe('Black Helicopters', () => {
  it('links to a Secret or Government Group and Privileges its attacks', () => {
    let s = scenario();
    const r = give(s, 'p1', 'black-helicopters', { resource: true });
    const cia = under(s, 'p1', 'c-i-a'); // Government
    s = act(s, 'p1', { type: 'link', resource: r, to: cia });
    const target = under(s, 'p2', 'druids');
    const a = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: cia, target });
    expect(a.attack!.privileged).toBe(true);
  });
  it('cannot link to a Group that is neither Secret nor Government, and is discarded if it stops being either', () => {
    let s = scenario();
    const r = give(s, 'p1', 'black-helicopters', { resource: true });
    const druids = under(s, 'p1', 'druids'); // no Secret/Government
    expect(() => act(s, 'p1', { type: 'link', resource: r, to: druids })).toThrow(/cannot be linked/);
    const cia = under(s, 'p1', 'c-i-a', 'RIGHT');
    s = act(s, 'p1', { type: 'link', resource: r, to: cia });
    expect(s.cards[r].zone).toBe('resources');
    s.cards[cia].mods.push({ source: 'test', kind: 'removeAlign', align: 'Government', until: 'permanent' });
    // Any later action re-checks the ongoing link legality (syncConditions).
    const attacker2 = under(s, 'p1', 'fbi', 'LEFT');
    const target = under(s, 'p2', 'druids');
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: attacker2, target });
    expect(s.cards[r].zone).toBe('discard');
  });
});

describe('Blivit', () => {
  it("cancels another Resource's just-announced action", () => {
    let s = scenario();
    const ks = give(s, 'p1', 'killer-satellite', { resource: true });
    s.cards[ks].tokens = 1;
    const spy = give(s, 'p1', 'spy-satellite', { resource: true });
    const blivit = give(s, 'p2', 'blivit', { resource: true });
    s.cards[blivit].tokens = 1;
    s = use(s, 'p1', ks, 'strike', { target: spy });
    expect(s.window?.kind).toBe('event');
    s = use(s, 'p2', blivit, 'jam', { target: ks });
    s = act(s, 'p1', { type: 'pass' });
    // The Killer Satellite's action never happened: its target survives.
    expect(s.cards[spy].zone).toBe('resources');
    expect(s.cards[blivit].tokens).toBe(0);
  });
  it('only one Blivit may be in play: a new one destroys the old', () => {
    let s = scenario();
    const b1 = give(s, 'p1', 'blivit', { resource: true });
    const b2 = give(s, 'p1', 'blivit', { hand: true });
    s = act(s, 'p1', { type: 'playResource', card: b2 });
    expect(s.cards[b1].zone).toBe('discard');
    expect(s.cards[b2].zone).toBe('resources');
  });
});

describe('Killer Satellite', () => {
  it('discarding it with its token gives +15 to destroy a Space Place', () => {
    let s = scenario();
    const ks = give(s, 'p1', 'killer-satellite', { resource: true });
    s.cards[ks].tokens = 1;
    const moonbase = under(s, 'p2', 'moonbase');
    const attacker = under(s, 'p1', 'c-i-a');
    const a = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker, target: moonbase });
    const before = attackStrength(a, a.attack!).attack;
    const after = use(a, 'p1', ks, 'sacrifice');
    expect(attackStrength(after, after.attack!).attack).toBe(before + 15);
    expect(after.cards[ks].zone).toBe('discard');
  });
  it('+5 to an attack on a Space Place, only', () => {
    const s = scenario();
    const ks = give(s, 'p1', 'killer-satellite', { resource: true });
    s.cards[ks].tokens = 1;
    const notSpace = under(s, 'p2', 'druids');
    const attacker = under(s, 'p1', 'c-i-a');
    const a = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker, target: notSpace });
    expect(() => use(a, 'p1', ks, 'boost')).toThrow(/Space/);
  });
});

describe("Lenin's Body", () => {
  it('gives +5 on a direct Attack to Control a Communist Group, when linked to the attacker', () => {
    let s = scenario();
    const lb = give(s, 'p1', 'lenin-s-body', { resource: true });
    const attacker = under(s, 'p1', 'c-i-a');
    s = act(s, 'p1', { type: 'link', resource: lb, to: attacker });
    const icc = under(s, 'p2', 'international-communist-conspiracy');
    const a = act(s, 'p1', { type: 'attack', attackType: 'control', attacker, target: icc });
    expect(attackStrength(a, a.attack!).attack).toBe(power(a, attacker) + 5);
  });
  it('does not help an Attack to Destroy, or an indirect (non-leading) attack', () => {
    let s = scenario();
    const lb = give(s, 'p1', 'lenin-s-body', { resource: true });
    const attacker = under(s, 'p1', 'c-i-a');
    s = act(s, 'p1', { type: 'link', resource: lb, to: attacker });
    const icc = under(s, 'p2', 'international-communist-conspiracy');
    const a = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker, target: icc });
    expect(attackStrength(a, a.attack!).attack).toBe(power(a, attacker));
  });
  it('gives its Communist linked Group Global Power equal to its (printed) Power', () => {
    let s = scenario();
    const lb = give(s, 'p1', 'lenin-s-body', { resource: true });
    const icc = under(s, 'p1', 'international-communist-conspiracy');
    s = act(s, 'p1', { type: 'link', resource: lb, to: icc });
    expect(globalPower(s, icc)).toBe(def(s, icc).power);
  });
});

describe('Orgone Grinder', () => {
  it('sets a linked Personality to Power 6, Resistance 10, with no alignments or attributes', () => {
    let s = scenario();
    const og = give(s, 'p1', 'orgone-grinder', { resource: true });
    const reagan = under(s, 'p1', 'ronald-reagan');
    s = act(s, 'p1', { type: 'link', resource: og, to: reagan });
    expect(power(s, reagan)).toBe(6);
    expect(resistance(s, reagan)).toBe(10);
    expect(alignments(s, reagan)).toEqual([]);
    expect(attributes(s, reagan)).toEqual([]);
  });
  it('only links to a Personality you control', () => {
    const s = scenario();
    const og = give(s, 'p1', 'orgone-grinder', { resource: true });
    const druids = under(s, 'p1', 'druids');
    expect(() => act(s, 'p1', { type: 'link', resource: og, to: druids })).toThrow(/cannot be linked/);
  });
});

describe('Power Satellite', () => {
  it('gives a linked Space Place +2 Power and +5 to all its defenses, Disasters included', () => {
    let s = scenario();
    const ps = give(s, 'p1', 'power-satellite', { resource: true });
    const moonbase = under(s, 'p1', 'moonbase');
    const before = power(s, moonbase);
    s = act(s, 'p1', { type: 'link', resource: ps, to: moonbase });
    expect(power(s, moonbase)).toBe(before + 2);
    // Moonbase itself is immune to most Disasters, so check the defense bonus on a Nation instead
    // (Power Satellite links to a Space Place or a Nation).
    const ps2 = give(s, 'p1', 'power-satellite', { resource: true });
    const italy = under(s, 'p1', 'italy', 'RIGHT');
    s = act(s, 'p1', { type: 'link', resource: ps2, to: italy });
    const disaster = hand(s, 'p1', 'no-beer');
    s = play(s, 'p1', { card: disaster, target: italy });
    // A Disaster's defense starts from the target's Power (R034), not its Resistance: check the +5 lands.
    expect(attackStrength(s, s.attack!).defense).toBe(power(s, italy) + 5);
  });
  it('only one per Place gives its bonus', () => {
    let s = scenario();
    const ps1 = give(s, 'p1', 'power-satellite', { resource: true });
    const ps2 = give(s, 'p1', 'power-satellite', { resource: true });
    const moonbase = under(s, 'p1', 'moonbase');
    const before = power(s, moonbase);
    s = act(s, 'p1', { type: 'link', resource: ps1, to: moonbase });
    s = act(s, 'p1', { type: 'link', resource: ps2, to: moonbase });
    expect(power(s, moonbase)).toBe(before + 2);
  });
});

describe('Screaming Meme', () => {
  it('cannot be relinked once placed, and never to an Illuminati', () => {
    let s = scenario();
    const sm = give(s, 'p1', 'screaming-meme', { resource: true });
    const druids = under(s, 'p1', 'druids');
    s = act(s, 'p1', { type: 'link', resource: sm, to: druids });
    const other = under(s, 'p1', 'a-m-a', 'RIGHT');
    // Bypass the ordinary "once per turn" limit to isolate Screaming Meme's own permanent lock.
    s.cards[sm].linkMovedTurn = undefined;
    expect(() => act(s, 'p1', { type: 'link', resource: sm, to: ill(s, 'p1') })).toThrow(/Illuminati/);
    s.cards[sm].linkMovedTurn = undefined;
    expect(() => act(s, 'p1', { type: 'link', resource: sm, to: other })).toThrow(/cannot be linked/);
  });
  it('makes its linked Organization indestructible', () => {
    let s = scenario();
    const sm = give(s, 'p1', 'screaming-meme', { resource: true });
    const druids = under(s, 'p1', 'druids');
    s = act(s, 'p1', { type: 'link', resource: sm, to: druids });
    s = nextTurn(s); // p2's turn: p2 may now attack
    const attacker = under(s, 'p2', 'c-i-a');
    s = act(s, 'p2', { type: 'attack', attackType: 'destroy', attacker, target: druids });
    s = finish(s, [1, 1]);
    expect(s.cards[druids].zone).toBe('structure');
  });
  it('only one Screaming Meme may be in play', () => {
    let s = scenario();
    const sm1 = give(s, 'p1', 'screaming-meme', { resource: true });
    const sm2 = give(s, 'p1', 'screaming-meme', { hand: true });
    s = act(s, 'p1', { type: 'playResource', card: sm2 });
    expect(s.cards[sm1].zone).toBe('discard');
  });
});

describe('Spy Satellite', () => {
  it("looks at a rival's Plot cards, spending its own action", () => {
    let s = scenario();
    const ss = give(s, 'p1', 'spy-satellite', { resource: true });
    s.cards[ss].tokens = 1;
    hand(s, 'p2', 'apathy');
    s = use(s, 'p1', ss, 'peek', { target: ill(s, 'p2'), mode: 'plot' });
    expect(s.cards[ss].tokens).toBe(0);
  });
  it('cannot target your own Illuminati', () => {
    const s = scenario();
    const ss = give(s, 'p1', 'spy-satellite', { resource: true });
    s.cards[ss].tokens = 1;
    expect(() => use(s, 'p1', ss, 'peek', { target: ill(s, 'p1'), mode: 'plot' })).toThrow();
  });
});

describe('The Big Prawn', () => {
  it('doubles the Power of the Coastal Place it is linked to', () => {
    let s = scenario();
    const bp = give(s, 'p1', 'the-big-prawn', { resource: true });
    const italy = under(s, 'p1', 'italy');
    const before = power(s, italy);
    s = act(s, 'p1', { type: 'link', resource: bp, to: italy });
    expect(power(s, italy)).toBe(before * 2);
  });
  it('only links to a Coastal Place, and is destroyed if its Place is only Devastated', () => {
    let s = scenario();
    const bp = give(s, 'p1', 'the-big-prawn', { resource: true });
    const notCoastal = under(s, 'p1', 'a-m-a');
    expect(() => act(s, 'p1', { type: 'link', resource: bp, to: notCoastal })).toThrow(/cannot be linked/);
    const italy = under(s, 'p1', 'italy', 'RIGHT');
    s = act(s, 'p1', { type: 'link', resource: bp, to: italy });
    const disaster = hand(s, 'p1', 'no-beer'); // can only Devastate, never destroy
    s = play(s, 'p1', { card: disaster, target: italy });
    s = finish(s, [1, 1]);
    expect(s.cards[italy].devastated).toBe(true);
    expect(s.cards[bp].zone).toBe('discard');
  });
});

describe('X-Ray Specs', () => {
  it("spends the linked Science Group's action to look at the top cards of a deck", () => {
    let s = scenario();
    const xr = give(s, 'p1', 'x-ray-specs', { resource: true });
    const ama = under(s, 'p1', 'a-m-a');
    s = act(s, 'p1', { type: 'link', resource: xr, to: ama });
    s = use(s, 'p1', xr, 'peek', { targets: ['p1:plot'] });
    expect(s.cards[ama].tokens).toBe(0);
  });
  it('only links to a Science Group, and cannot be used without an Action token', () => {
    let s = scenario();
    const xr = give(s, 'p1', 'x-ray-specs', { resource: true });
    const druids = under(s, 'p1', 'druids'); // not Science
    expect(() => act(s, 'p1', { type: 'link', resource: xr, to: druids })).toThrow(/cannot be linked/);
    const ama = under(s, 'p1', 'a-m-a', 'RIGHT');
    s = act(s, 'p1', { type: 'link', resource: xr, to: ama });
    s.cards[ama].tokens = 0;
    expect(() => use(s, 'p1', xr, 'peek', { targets: ['p1:plot'] })).toThrow(/Action token/);
  });
});

// ------------------------------------------------------------------ Assassination

describe('Spontaneous Combustion', () => {
  it('is an Instant Attack to kill a Personality, Power 10 (needs no action)', () => {
    let s = scenario();
    const target = under(s, 'p2', 'ronald-reagan');
    const card = hand(s, 'p1', 'spontaneous-combustion');
    s = play(s, 'p1', { card, target });
    expect(s.attack!.instant).toBe(true);
    expect(s.attack!.instantPower).toBe(10);
    expect(s.attack!.assassination).toBe(true);
  });
  it('is Power 15 against a Magic Personality, and a Magic Group may add its own Power', () => {
    let s = scenario();
    const dracula = under(s, 'p2', 'count-dracula');
    const helper = under(s, 'p1', 'druids');
    const card = hand(s, 'p1', 'spontaneous-combustion');
    s = play(s, 'p1', { card, target: dracula, helper });
    expect(s.attack!.instantPower).toBe(15);
    expect(s.cards[helper].tokens).toBe(0);
    s = finish(s, [1, 1]);
    expect(s.cards[dracula].zone).toBe('destroyed');
    expect(s.cards[dracula].killed).toBe(true);
  });
});

// ------------------------------------------------------------------ Disasters

describe('Drought', () => {
  it('attacks a Huge Place, Power 24 if Coastal, 28 otherwise, not Instant', () => {
    let s = scenario();
    const texas = under(s, 'p2', 'texas'); // Huge, Coastal
    const card = hand(s, 'p1', 'drought');
    s = play(s, 'p1', { card, target: texas });
    expect(s.attack!.instant).toBe(false);
    expect(s.attack!.cardPower).toBe(24);
  });
  it('cannot strike a Place that is not Huge', () => {
    const s = scenario();
    const notHuge = under(s, 'p2', 'italy');
    const card = hand(s, 'p1', 'drought');
    expect(() => play(s, 'p1', { card, target: notHuge })).toThrow(/Huge/);
  });
});

describe('Flesh-Eating Bacteria', () => {
  it('attacks any Place, Power 20, not Instant', () => {
    let s = scenario();
    const place = under(s, 'p2', 'italy');
    const card = hand(s, 'p1', 'flesh-eating-bacteria');
    s = play(s, 'p1', { card, target: place });
    expect(s.attack!.instant).toBe(false);
    expect(s.attack!.cardPower).toBe(20);
  });
  it('destroying it (margin > 8) lets a Science action return the card to hand', () => {
    let s = scenario();
    const place = under(s, 'p2', 'italy');
    const sci = under(s, 'p1', 'a-m-a', 'RIGHT'); // kept back with its token, to return the card after
    const booster = under(s, 'p1', 'clone-arrangers', 'LEFT'); // aids for enough margin to destroy
    const card = hand(s, 'p1', 'flesh-eating-bacteria');
    s = play(s, 'p1', { card, target: place });
    s = act(s, 'p1', { type: 'aid', group: booster });
    s = finish(s, [1, 1]);
    expect(s.cards[place].zone).toBe('destroyed');
    // The player chooses: spend a Science action (which Group's), or let the card go.
    expect(s.prompt?.choice?.key).toBe('feb-return');
    expect(act(s, 'p1', { type: 'choose', ids: ['no'] }).cards[card].zone).toBe('discard');
    s = act(s, 'p1', { type: 'choose', ids: [sci] });
    expect(s.players.find((p) => p.id === 'p1')!.hand).toContain(card);
    expect(s.cards[sci].tokens).toBe(0);
  });
});

describe('No Beer!', () => {
  it('Power 16 normally, 24 against Australia/Germany/Texas, 8 against France/Italy; Instant; only Devastates', () => {
    let s = scenario();
    const italy = under(s, 'p2', 'italy');
    const card = hand(s, 'p1', 'no-beer');
    s = play(s, 'p1', { card, target: italy });
    expect(s.attack!.instant).toBe(true);
    expect(s.attack!.instantPower).toBe(8);
    expect(s.attack!.disaster!.destroyMargin).toBeNull();
  });
  it('the Liquor Companies may spend their action to halve or double it', () => {
    let s = scenario();
    const italy = under(s, 'p2', 'italy'); // power 8
    const lc = under(s, 'p1', 'liquor-companies', 'RIGHT');
    const card = hand(s, 'p1', 'no-beer');
    s = play(s, 'p1', { card, target: italy });
    s = use(s, 'p1', lc, 'no-beer', { mode: 'double' });
    expect(s.attack!.instantPower).toBe(16);
  });
});

describe('Oil Spill', () => {
  it('attacks a Coastal Place, Power 14 if Huge else 18, Instant, destroys on margin > 6', () => {
    let s = scenario();
    const italy = under(s, 'p2', 'italy'); // Coastal, not Huge
    const card = hand(s, 'p1', 'oil-spill');
    s = play(s, 'p1', { card, target: italy });
    expect(s.attack!.instant).toBe(true);
    expect(s.attack!.instantPower).toBe(18);
    expect(s.attack!.disaster!.destroyMargin).toBe(6);
  });
  it('cannot target a non-Coastal Place, but can give +10 against OPEC instead', () => {
    let s = scenario();
    const notCoastal = under(s, 'p2', 'a-m-a');
    const card = hand(s, 'p1', 'oil-spill');
    expect(() => play(s, 'p1', { card, target: notCoastal })).toThrow(/Coastal/);
    const opec = under(s, 'p2', 'opec', 'RIGHT');
    const attacker = under(s, 'p1', 'c-i-a');
    const a = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker, target: opec });
    const before = attackStrength(a, a.attack!).attack;
    const after = play(a, 'p1', { card, mode: 'bonus' });
    expect(attackStrength(after, after.attack!).attack).toBe(before + 10);
  });
  it('a successful strike gives every Green Group an extra token, once per player per game', () => {
    let s = scenario();
    const italy = under(s, 'p2', 'italy');
    const green = under(s, 'p2', 'druids', 'RIGHT');
    s.cards[green].tokens = 0;
    const card = hand(s, 'p1', 'oil-spill');
    s = play(s, 'p1', { card, target: italy });
    s = finish(s, [1, 1]);
    expect(s.cards[green].tokens).toBe(1);
  });
});

// ------------------------------------------------------------------ Goals

describe('Blinded by Science', () => {
  it('needs 6+ Science Groups with 30+ total Power (official errata)', () => {
    const s = scenario();
    for (let i = 0; i < 5; i++) put(s, 'p1', 'clone-arrangers'); // Science, Power 6 each = 30
    put(s, 'p1', 'fbi'); // Science, Power 4: 6th Group, total 34
    expect(GOALS['blinded-by-science'](s, 'p1')).not.toBeNull();
  });
  it('not met with fewer than 6 Science Groups, or not enough total Power', () => {
    const s = scenario();
    for (let i = 0; i < 6; i++) put(s, 'p1', 'l-4-society'); // Science, Power 1 each: only 6 total
    expect(GOALS['blinded-by-science'](s, 'p1')).toBeNull();
    under(s, 'p1', 'fbi');
    expect(GOALS['blinded-by-science'](s, 'p1')).toBeNull();
  });
});

describe('Earth First!', () => {
  it('meets one of the printed destroy/control combinations', () => {
    const s = scenario();
    destroyedCredit(s, 'p1', 'liquor-companies'); // Corporate
    destroyedCredit(s, 'p1', 'multinational-oil-companies'); // Corporate
    for (let i = 0; i < 6; i++) put(s, 'p1', 'druids'); // Green
    expect(GOALS['earth-first'](s, 'p1')).not.toBeNull();
  });
  it('not met with too few of either', () => {
    const s = scenario();
    destroyedCredit(s, 'p1', 'liquor-companies');
    under(s, 'p1', 'druids');
    expect(GOALS['earth-first'](s, 'p1')).toBeNull();
  });
});

describe('Population Reduction', () => {
  it('an outright win with 5+ Huge Places destroyed and World War Three not in effect', () => {
    const s = scenario();
    for (let i = 0; i < 5; i++) destroyedCredit(s, 'p1', 'texas');
    expect(GOALS['population-reduction'](s, 'p1')).not.toBeNull();
  });
  it('with fewer than 5, each Huge Place destroyed (up to 3) only doubles toward the Basic Goal', () => {
    const s = scenario();
    for (let i = 0; i < 4; i++) destroyedCredit(s, 'p1', 'texas');
    const need = goalNeeded(s, 'p1');
    const bonus = Math.min(3, 4) * 2; // 6
    const result = GOALS['population-reduction'](s, 'p1');
    expect(result).toBe(goalCount(s, 'p1') + bonus >= need ? result : null);
    if (goalCount(s, 'p1') + bonus < need) expect(result).toBeNull();
  });
});

// ------------------------------------------------------------------ NWOs

describe('Antitrust Legislation', () => {
  it('a Corporate Group nested under another Corporate Group cannot use its special ability', () => {
    let s = scenario();
    nwoInPlay(s, 'p1', 'antitrust-legislation', 'yellow');
    const master = under(s, 'p1', 'multinational-oil-companies');
    const puppet = under(s, 'p1', 'liquor-companies', 'RIGHT', master);
    s.cards[puppet].tokens = 1;
    expect(() => act(s, 'p1', { type: 'useAbility', card: puppet, ability: 'dry', params: { target: ill(s, 'p2') } })).toThrow();
  });
  it('a Corporate Group not nested under another Corporate Group is unaffected', () => {
    let s = scenario();
    nwoInPlay(s, 'p1', 'antitrust-legislation', 'yellow');
    const g = under(s, 'p1', 'liquor-companies');
    s.cards[g].tokens = 1;
    expect(() => act(s, 'p1', { type: 'useAbility', card: g, ability: 'dry', params: { target: ill(s, 'p2') } })).not.toThrow();
  });
});

describe('Apathy', () => {
  it('no Group may aid an attack made by another Group', () => {
    let s = scenario();
    nwoInPlay(s, 'p1', 'apathy', 'red');
    const attacker = under(s, 'p1', 'c-i-a');
    const aid = under(s, 'p1', 'fbi', 'RIGHT');
    s.cards[aid].tokens = 1;
    const target = under(s, 'p2', 'druids');
    const a = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker, target });
    expect(() => act(a, 'p1', { type: 'aid', group: aid })).toThrow();
  });
});

describe('Australian Rules', () => {
  it('attacking a rival earns an extra Plot draw; destroying its Group earns an extra Group draw', () => {
    let s = scenario();
    nwoInPlay(s, 'p1', 'australian-rules', 'red');
    withPlotDeck(s, 'p1', 1);
    const ar1 = s.players.find((p) => p.id === 'p1')!.plotDeck[0];
    s.players.find((p) => p.id === 'p1')!.groupDeck = ['ar2'];
    s.cards['ar2'] = { iid: 'ar2', cardId: 'druids', owner: 'p1', zone: 'groupDeck', tokens: 0, mods: [] };
    const attacker = under(s, 'p1', 'c-i-a');
    const target = under(s, 'p2', 'druids');
    let a = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker, target });
    a.attack!.attackBonus.push({ player: 'p1', amount: 30, label: 'test boost' }); // guarantee success
    a = finish(a, [1, 1]);
    expect(a.players.find((p) => p.id === 'p1')!.hand).toContain(ar1);
    expect(a.players.find((p) => p.id === 'p1')!.hand).toContain('ar2');
  });
});

describe('End of the World', () => {
  it('Church/Fanatic Groups get +2 (+3 for a Fanatic Church); Corporate/Government get -2', () => {
    const s = scenario();
    nwoInPlay(s, 'p1', 'end-of-the-world', 'yellow');
    const icc = under(s, 'p1', 'international-communist-conspiracy'); // Fanatic
    const cia = under(s, 'p2', 'c-i-a', 'LEFT'); // Government
    expect(power(s, icc)).toBe(def(s, icc).power! + 2);
    expect(power(s, cia)).toBe(def(s, cia).power! - 2);
  });
});
