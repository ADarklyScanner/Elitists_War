// Hidden information: Plots hidden beneath a card, secret ability choices, and the Resources that
// touch hidden cards (Hidden City, Spear of Longinus, Warehouse 23).
import { describe, expect, it } from 'vitest';
import {
  applyAction, attackStrength, canOppose, exposeCards, globalPower, magicByCard, openArrows, plotOptions, power, waitingFor,
  type Action, type GameState,
} from '../../src/engine';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const use = (s: GameState, pl: string, card: string, ability: string, params: Record<string, unknown> = {}) =>
  act(s, pl, { type: 'useAbility', card, ability, params });
function put(s: GameState, pl: string, cardId: string): string {
  const m = ill(s, pl);
  return give(s, pl, cardId, { under: m, side: openArrows(s, m)[0] });
}
/** Log lines a given player can read (public lines and his own private ones). */
const visibleTo = (s: GameState, pl: string, from = 0) => s.log.slice(from).filter((l) => !l.to || l.to === pl).map((l) => l.text).join('\n');
function resolve(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = applyAction(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}

/** p2 hides a Volcano beneath Texas and also holds a Reload. */
function texasSetup() {
  let s = scenario();
  const tx = put(s, 'p2', 'texas');
  const hidden = give(s, 'p2', 'volcano', { hand: true });
  const other = give(s, 'p2', 'reload', { hand: true });
  s.active = 1;
  s = use(s, 'p2', tx, 'hide', { target: hidden });
  s.active = 0;
  return { s, tx, hidden, other };
}

describe('Plots hidden beneath a card stay hidden', () => {
  it('hiding one never names it in the public log', () => {
    let s = scenario();
    const tx = put(s, 'p1', 'texas');
    const x = give(s, 'p1', 'volcano', { hand: true });
    const seen = s.log.length;
    s = use(s, 'p1', tx, 'hide', { target: x });
    expect(visibleTo(s, 'p2', seen)).not.toMatch(/Volcano/);
    expect(visibleTo(s, 'p1', seen)).toMatch(/Volcano/);
  });

  it('exposeCards skips a protected Plot and reports only what it exposed', () => {
    const { s, hidden, other } = texasSetup();
    expect(exposeCards(s, [hidden, other])).toEqual([other]);
    expect(s.cards[hidden].exposed).toBeFalsy();
    expect(s.cards[other].exposed).toBe(true);
  });

  it('Phone Company exposes only the other Plots, and its log never names the hidden one', () => {
    let { s, hidden, other } = texasSetup();
    const pc = put(s, 'p1', 'phone-company');
    const seen = s.log.length;
    s = use(s, 'p1', pc, 'expose', { target: ill(s, 'p2') });
    expect(s.cards[other].exposed).toBe(true);
    expect(s.cards[hidden].exposed).toBeFalsy();
    expect(s.log.slice(seen).map((l) => l.text).join()).not.toMatch(/Volcano/);
  });

  it('Phone Company cannot use its expose on a rival whose only hidden Plot is beneath Texas', () => {
    let { s, other } = texasSetup();
    s.cards[other].exposed = true;
    const pc = put(s, 'p1', 'phone-company');
    expect(() => use(s, 'p1', pc, 'expose', { target: ill(s, 'p2') })).toThrow(/no hidden Plot/);
    // Nor can it look at it privately.
    expect(() => use(s, 'p1', pc, 'inspect', { target: ill(s, 'p2') })).toThrow(/no hidden Plot/);
  });

  it('Cattle Mutilators expose every other hidden Plot but never the protected one', () => {
    let { s, hidden, other } = texasSetup();
    const cm = put(s, 'p1', 'cattle-mutilators');
    const seen = s.log.length;
    s = use(s, 'p1', cm, 'expose', { target: s.cards[ill(s, 'p2')].iid });
    expect(s.cards[other].exposed).toBe(true);
    expect(s.cards[hidden].exposed).toBeFalsy();
    expect(s.log.slice(seen).map((l) => l.text).join()).not.toMatch(/Volcano/);
  });
});

describe('secret ability choices', () => {
  it('the Holy Grail names its Place privately', () => {
    let s = scenario();
    const r = give(s, 'p1', 'the-holy-grail', { resource: true });
    const hawaii = put(s, 'p2', 'hawaii');
    const seen = s.log.length;
    s = use(s, 'p1', r, 'name', { target: hawaii });
    expect(visibleTo(s, 'p2', seen)).toMatch(/Holy Grail/);
    expect(visibleTo(s, 'p2', seen)).not.toMatch(/Hawaii/);
    expect(visibleTo(s, 'p1', seen)).toMatch(/Hawaii/);
  });

  it('the Ark of the Covenant names its Group privately', () => {
    let s = scenario();
    const r = give(s, 'p1', 'ark-of-the-covenant', { resource: true });
    const g = put(s, 'p1', 'dentists');
    const seen = s.log.length;
    s = use(s, 'p1', r, 'name', { target: g });
    expect(visibleTo(s, 'p2', seen)).not.toMatch(/Dentists/);
    expect(visibleTo(s, 'p1', seen)).toMatch(/Dentists/);
  });

  it('an ability that is not secret still names its target for everyone', () => {
    let s = scenario();
    const r = give(s, 'p1', 'orbital-mind-control-lasers', { resource: true });
    s.cards[r].tokens = 1;
    const g = put(s, 'p2', 'dentists');
    const seen = s.log.length;
    s = use(s, 'p1', r, 'align', { target: g, mode: 'add', alignment: 'Violent' });
    expect(visibleTo(s, 'p2', seen)).toMatch(/Dentists/);
  });
});

describe('Hidden City as a Disaster target', () => {
  it('any Disaster may strike it, even one that cannot strike Huge Places', () => {
    const s = scenario();
    const hc = give(s, 'p2', 'hidden-city', { resource: true });
    const tornado = give(s, 'p1', 'tornado', { hand: true });
    const opts = plotOptions(s, 'p1', tornado);
    expect(opts.some((o) => o.action.type === 'playPlot' && o.action.play.target === hc)).toBe(true);
    // Other Resources are still not Places.
    const pm = give(s, 'p2', 'perpetual-motion-machine', { resource: true });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: tornado, target: pm } })).toThrow(/Place/);
  });

  it('defends as a Power 10 Place and is destroyed by a big enough margin', () => {
    let s = scenario();
    const hc = give(s, 'p2', 'hidden-city', { resource: true });
    const volcano = give(s, 'p1', 'volcano', { hand: true });
    const p2Power = power(s, ill(s, 'p2'));
    s = act(s, 'p1', { type: 'playPlot', play: { card: volcano, target: hc } });
    expect(s.attack?.targetPlayer).toBe('p2');
    expect(attackStrength(s, s.attack!).defense).toBe(10);
    s = resolve(s, [1, 1]);
    expect(s.cards[hc].zone).toBe('destroyed');
    expect(power(s, ill(s, 'p2'))).toBe(p2Power - 2);
  });

  it('a Disaster that only just succeeds does not Devastate it', () => {
    let s = scenario();
    const hc = give(s, 'p2', 'hidden-city', { resource: true });
    const volcano = give(s, 'p1', 'volcano', { hand: true });
    s = act(s, 'p1', { type: 'playPlot', play: { card: volcano, target: hc } });
    s = resolve(s, [4, 4]); // strength 18 - 10 = 8: success by 0, Volcano needs 2 to destroy
    expect(s.cards[hc].zone).toBe('resources');
    expect(s.cards[hc].devastated).toBeFalsy();
  });
});

describe('Spear of Longinus and Disasters', () => {
  it('a Disaster helped by the Spear is Magic, so the Druids may oppose it', () => {
    let s = scenario();
    const spear = give(s, 'p1', 'spear-of-longinus', { resource: true });
    const hawaii = put(s, 'p2', 'hawaii');
    const druids = put(s, 'p2', 'druids');
    const volcano = give(s, 'p1', 'volcano', { hand: true });
    s = act(s, 'p1', { type: 'playPlot', play: { card: volcano, target: hawaii } });
    expect(magicByCard(s, s.attack)).toBe(false);
    expect(canOppose(s, 'p2', druids).ok).toBe(false);
    s = use(s, 'p1', spear, 'boost');
    expect(magicByCard(s, s.attack)).toBe(true);
    expect(canOppose(s, 'p2', druids).ok).toBe(true);
  });
});

describe('Warehouse 23', () => {
  function setup() {
    let s = scenario();
    const wh = give(s, 'p1', 'warehouse-23', { resource: true });
    const hc = give(s, 'p1', 'hidden-city', { hand: true });
    const p0 = power(s, ill(s, 'p1'));
    const seen = s.log.length;
    s = use(s, 'p1', wh, 'hide', { target: hc });
    return { s, wh, hc, p0, seen };
  }

  it('a Resource hidden under it is face down: unnamed in the public log and inactive', () => {
    const { s, hc, p0, seen } = setup();
    expect(s.cards[hc].zone).toBe('resources');
    expect(s.cards[hc].hiddenUnder).toBeDefined();
    expect(visibleTo(s, 'p2', seen)).not.toMatch(/Hidden City/);
    expect(visibleTo(s, 'p1', seen)).toMatch(/Hidden City/);
    expect(power(s, ill(s, 'p1'))).toBe(p0);
    expect(s.turnFlags.resourcePlayed).toBe(true);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
  });

  it('follows the usual once-per-turn Resource play', () => {
    const { s, wh } = setup();
    const pm = give(s, 'p1', 'perpetual-motion-machine', { hand: true });
    expect(() => use(s, 'p1', wh, 'hide', { target: pm })).toThrow(/one Resource/);
  });

  it('rivals cannot target it, and it cannot be used or linked until turned face up', () => {
    const { s, hc } = setup();
    const squad = give(s, 'p2', 'suicide-squad', { resource: true });
    s.active = 1;
    expect(() => use(s, 'p2', squad, 'strike', { target: hc })).toThrow(/face down/);
    s.active = 0;
    const g = put(s, 'p1', 'dentists');
    expect(() => act(s, 'p1', { type: 'link', resource: hc, to: g })).toThrow(/face down/);
  });

  it('turning it face up makes it active at once, and it stays face up', () => {
    let { s, wh, hc, p0 } = setup();
    const seen = s.log.length;
    s = use(s, 'p1', wh, 'reveal', { target: hc });
    expect(s.cards[hc].hiddenUnder).toBeUndefined();
    expect(power(s, ill(s, 'p1'))).toBe(p0 + 2);
    expect(globalPower(s, ill(s, 'p1'))).toBeGreaterThan(0);
    expect(visibleTo(s, 'p2', seen)).toMatch(/Hidden City/);
    expect(() => use(s, 'p1', wh, 'reveal', { target: hc })).toThrow(/face down/);
  });

  it('its hidden cards go with it when it is destroyed or changes hands', () => {
    let { s, wh, hc } = setup();
    s.cards[wh].controller = 'p2';
    s = act(s, 'p1', { type: 'setAutoPass', value: false });
    expect(s.cards[hc].controller).toBe('p2');
    expect(s.cards[hc].hiddenUnder).toBe(wh);
    Object.assign(s.cards[wh], { zone: 'destroyed', controller: undefined, linkedTo: undefined });
    s = act(s, 'p1', { type: 'setAutoPass', value: false });
    expect(s.cards[hc].zone).toBe('destroyed');
    expect(s.cards[hc].hiddenUnder).toBeUndefined();
  });
});
