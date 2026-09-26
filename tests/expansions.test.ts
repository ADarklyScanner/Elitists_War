// The expansion packs' foundation: card data, settings and decks, and the new rules (Zap, Paralysis,
// Freeze, "Requires ... Action", Assassinations, links, Slack and the stand-alone SubGenius game).
// Card behaviour is not tested here: synthetic test cards (ids starting with "x-") exercise the rules.
import { describe, expect, it } from 'vitest';
import {
  ALL_CARDS, BASE_CARDS, CARDS, CHURCH, EXPANSIONS_READY, EXPANSION_CARDS, PLOTS, anyOf, applyAction, assassinationPlot, attackStrength, canAid,
  canOppose, cardSet, costPlays, createGame, drawGroup, enabledSets, freezePlot, frozen, goalCount, goalOptions, groupActions, illuminatiAction,
  isKilled, isParalyzed, killPersonality, packProgress, paralysisPlot, plotDiscards, player, power, registerAbilities, registerHooks, registerPlots,
  registerZap, randomDeck, startCardAttack, structureCards, syncConditions, takeoverOptions, validateAttack, waitingFor, zapsOn, illuminatiFor,
  type Action, type CardDef, type GameState, type PlotPlay,
} from '../src/engine';
import { checkInvariants, give, scenario } from './helpers';
import { viewFor } from '../src/server/service';

// ---------------------------------------------------------------- synthetic test cards

const group = (id: string, o: Partial<CardDef>): CardDef => ({
  id, name: id, type: 'Group', subtype: 'Organization', rarity: null, text: '', power: 4, globalPower: 0, resistance: 4,
  alignments: [], attributes: [], arrowIn: 'TOP', arrowsOut: ['BOTTOM', 'LEFT', 'RIGHT'], ...o,
});
const plot = (id: string, o: Partial<CardDef> = {}): CardDef => ({ id, name: id, type: 'Plot', subtype: 'Plot', rarity: null, text: '', ...o });
for (const d of [
  group('x-weird', { alignments: ['Weird'] }),
  group('x-straight', { alignments: ['Straight'], power: 5, resistance: 5 }),
  group('x-peaceful', { alignments: ['Peaceful'], power: 3 }),
  group('x-violent', { alignments: ['Violent'], power: 6, resistance: 6 }),
  group('x-bank', { alignments: ['Straight'], attributes: ['Bank'] }),
  group('x-bank2', { alignments: ['Straight'], attributes: ['Bank'], power: 2 }),
  group('x-plain', { power: 3, resistance: 3 }),
  group('x-science', { attributes: ['Science'], power: 2, resistance: 2 }),
  group('x-person', { subtype: 'Personality', alignments: ['Peaceful'], power: 2, resistance: 3 }),
  group('x-sub', { alignments: ['Weird'], attributes: ['SubGenius'], power: 5 }),
  group('x-sub-target', { alignments: ['Straight'], attributes: ['SubGenius'], power: 2, resistance: 2 }),
  { id: 'x-res', name: 'x-res', type: 'Resource', subtype: 'Resource', rarity: null, text: '' } as CardDef,
  plot('x-zap', { keywords: ['Zap'] }), plot('x-zap2', { keywords: ['Zap'] }), plot('x-zap-instant', { keywords: ['Zap'] }),
  plot('x-zap-draw', { keywords: ['Zap'] }), plot('x-zap-proximity', { keywords: ['Zap'] }),
  plot('x-paralysis', { keywords: ['Paralysis'] }), plot('x-freeze', { keywords: ['Freeze'] }), plot('x-costly'),
  plot('x-assassin', { subtype: 'Assassination', keywords: ['Assassination', 'Instant'] }), plot('x-disaster', { subtype: 'Disaster' }), plot('x-link'),
]) CARDS[d.id] = d;

registerZap('x-zap', { noTakeover: { alignments: ['Weird'] } });
registerZap('x-zap2', { noTakeover: { alignments: ['Straight'] } });
registerZap('x-zap-instant', { noInstants: true });
registerZap('x-zap-draw', { hooks: { beforeDraw: (s, self, pl, deck) => (deck === 'group' && s.cards[s.cards[self].linkedTo!]?.controller === pl ? 'plotInstead' : undefined) } });
registerZap('x-zap-proximity', { hooks: { noProximityBonus: (s, self, target) => s.cards[target]?.controller === s.cards[s.cards[self].linkedTo!]?.controller } });
registerPlots({
  'x-paralysis': paralysisPlot({ on: { alignments: ['Peaceful'] }, pay: { alignments: ['Violent'] } }),
  'x-freeze': freezePlot({ match: { attributes: ['Bank'] }, label: 'Bank' }),
  'x-costly': {
    timing: ['anytime'], requires: anyOf(illuminatiAction(), plotDiscards(2)),
    check: () => null, apply: () => undefined, resolve: (s, pl) => { s.cards[player(s, pl).illuminati].data = { costly: true }; },
  },
  'x-assassin': assassinationPlot({ power: (s, t) => (CARDS[s.cards[t].cardId].attributes ?? []).includes('Magic') ? 15 : 10, helper: { alignments: ['Violent'] } }),
  'x-disaster': {
    timing: ['anytime'], needs: { target: 'anyGroup' },
    check: () => null, apply: () => undefined,
    resolve: (s, pl, play) => startCardAttack(s, pl, { plot: play.card, target: play.target!, power: 10, disaster: { destroyMargin: null }, aidRule: 'defenderOnly' }),
    joinRule: (s, _ctx, g, as) => (as === 'oppose' && (CARDS[s.cards[g].cardId].attributes ?? []).includes('Science') ? true : undefined),
    joinMultiplier: (s, _ctx, g) => (s.cards[g].cardId === 'x-science' ? 3 : 1),
  },
  'x-link': {
    timing: ['anytime'], needs: { target: 'anyGroup' }, check: () => null, apply: () => undefined,
    resolve: (s, _pl, play) => { s.cards[play.card].linkedTo = play.target; },
    linkLegal: (s, _p, g) => (!s.cards[g] || s.cards[g].zone !== 'structure' ? 'discard' : (CARDS[s.cards[g].cardId].alignments ?? []).includes('Weird') && !s.cards[g].mods.some((m) => m.kind === 'removeAlign') ? 'ok' : 'inactive'),
  },
});
registerHooks({
  'x-res': { powerMod: (s, self, iid) => (iid === s.cards[self].linkedTo ? 2 : 0) },
  'x-peaceful': { powerMod: (s, self, iid) => (iid === self ? 1 : 0) },
  'x-link': { powerMod: (s, self, iid) => (iid === s.cards[self].linkedTo ? 3 : 0) },
});
registerAbilities({ 'x-weird': [], 'x-straight': [], 'x-peaceful': [], 'x-violent': [], 'x-bank': [], 'x-bank2': [], 'x-plain': [], 'x-science': [], 'x-person': [], 'x-sub': [], 'x-sub-target': [] });

// ---------------------------------------------------------------- helpers

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, pl: string) => player(s, pl).illuminati;
/** Play a non-attack Plot and pass until it resolves. */
function playAndResolve(s: GameState, pl: string, play: PlotPlay): GameState {
  s = act(s, pl, { type: 'playPlot', play });
  while (s.window?.kind === 'plot') s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** Pass for everyone until the attack is over, forcing the dice if given. */
function resolve(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 30 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** Make it p2's main phase (p2 past its first turn). */
function p2Turn(s: GameState): GameState { s.active = 1; s.phase = 'main'; s.cards[ill(s, 'p2')].tokens = 1; return s; }
const zapP2 = (s: GameState, card = 'x-zap') => {
  const z = give(s, 'p1', card, { hand: true });
  return { s: playAndResolve(s, 'p1', { card: z, target: ill(s, 'p2'), payWith: [ill(s, 'p1')] }), z };
};

// ---------------------------------------------------------------- data

describe('expansion card data', () => {
  it('has 125 Assassins and 97 SubGenius cards, loaded into CARDS and ALL_CARDS with their set', () => {
    expect(EXPANSION_CARDS.Assassins.length).toBe(125);
    expect(EXPANSION_CARDS.SubGenius.length).toBe(97);
    expect(ALL_CARDS.length).toBe(412 + 125 + 97);
    for (const c of [...EXPANSION_CARDS.Assassins, ...EXPANSION_CARDS.SubGenius]) {
      expect(CARDS[c.id], c.id).toBe(c);
      expect(['Assassins', 'SubGenius']).toContain(c.set);
      expect(c.text.length, c.id).toBeGreaterThan(10);
      expect(['Illuminati', 'Group', 'Resource', 'Plot']).toContain(c.type);
    }
    expect(BASE_CARDS.every((c) => cardSet(c) === 'Base')).toBe(true);
  });
  it('ids are unique across all sets and never collide with a base card', () => {
    const ids = ALL_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('keeps Plot keywords, NWO colours and the Groups\' arrows structured', () => {
    expect(CARDS['brushfire-war'].keywords).toContain('Zap');
    expect(CARDS['cat-juggling'].keywords).toContain('Paralysis');
    expect(CARDS['junk-bonds'].keywords).toContain('Freeze');
    expect(CARDS['spontaneous-combustion'].subtype).toBe('Assassination');
    expect(CARDS['apathy']).toMatchObject({ type: 'Plot', subtype: 'NWO', nwoColor: 'red' });
    expect(CARDS['blinded-by-science']).toMatchObject({ type: 'Plot', subtype: 'Goal' });
    expect(CARDS['church-of-the-subgenius']).toMatchObject({ type: 'Illuminati', arrowsOut: ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] });
    for (const c of ALL_CARDS.filter((x) => x.type === 'Group' && x.set)) expect(['TOP', 'BOTTOM']).toContain(c.arrowIn);
    expect(CARDS['convenience-stores'].set).toBe('Assassins');
  });
});

// ---------------------------------------------------------------- implementation progress

describe('pack implementation progress', () => {
  it('reports how many cards of each pack are implemented (100% required before a pack may be switched on)', () => {
    for (const [id, set] of [['assassins', 'Assassins'], ['subgenius', 'SubGenius']] as const) {
      const p = packProgress(set);
      console.log(`${set}: ${p.implemented}/${p.total} cards implemented`);
      expect(p.total).toBe(set === 'Assassins' ? 125 : 97);
      if (EXPANSIONS_READY[id]) expect(p.missing).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------- settings and decks

describe('settings and decks', () => {
  it('base-only by default; each pack switches on separately', () => {
    expect(enabledSets()).toEqual(['Base']);
    expect(enabledSets({ expansions: { assassins: true } })).toEqual(['Base', 'Assassins']);
    expect(enabledSets({ expansions: { subgenius: true } })).toEqual(['Base', 'SubGenius']);
    expect(enabledSets({ subgeniusRules: true })).toEqual(['SubGenius']);
    expect(EXPANSIONS_READY).toEqual({ assassins: false, subgenius: false });
  });
  it('random decks draw from the base game only unless a set is given', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const d = randomDeck(seed);
      for (const id of [d.illuminati, ...d.groups, ...d.plots]) expect(cardSet(CARDS[id]), id).toBe('Base');
    }
    const mixed = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((seed) => randomDeck(seed, undefined, { sets: ['Base', 'Assassins'], unimplemented: true }).groups);
    expect(mixed.some((id) => cardSet(CARDS[id]) === 'Assassins')).toBe(true);
    // Unimplemented expansion cards stay out of real games.
    const real = randomDeck(3, undefined, { sets: ['Base', 'Assassins'] });
    expect(real.groups.every((id) => cardSet(CARDS[id]) === 'Base')).toBe(true);
  });
  it('the Church of the SubGenius is offered once SubGenius is on', () => {
    expect(illuminatiFor().map((c) => c.id)).not.toContain(CHURCH);
    expect(illuminatiFor({ expansions: { subgenius: true } }).map((c) => c.id)).toContain(CHURCH);
  });
  it('a game saved before the expansions (no expansion fields) still loads and plays', () => {
    const s = JSON.parse(JSON.stringify(scenario())) as GameState;
    delete s.settings.expansions; delete s.common; delete s.freezes;
    const t = act(s, 'p1', { type: 'endTurn' });
    expect(t.phase).toBe('endOfTurn');
  });
});

// ---------------------------------------------------------------- Zaps

describe('Zap', () => {
  it('costs an Illuminati action and stays linked to the rival Illuminati', () => {
    const s0 = scenario();
    const z = give(s0, 'p1', 'x-zap', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card: z, target: ill(s0, 'p2') } })).toThrow(/Illuminati/);
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card: z, target: ill(s0, 'p1'), payWith: [ill(s0, 'p1')] } })).toThrow(/rival/);
    const s = playAndResolve(s0, 'p1', { card: z, target: ill(s0, 'p2'), payWith: [ill(s0, 'p1')] });
    expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
    expect(s.cards[z].zone).toBe('table');
    expect(zapsOn(s, 'p2')).toEqual([z]);
  });
  it('restricts the whole Power Structure: no Weird Group may be taken over, by attack or automatically', () => {
    const s0 = scenario();
    const att = give(s0, 'p2', 'x-plain', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const weird = give(s0, 'p1', 'x-weird', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const straight = give(s0, 'p1', 'x-straight', { under: ill(s0, 'p1'), side: 'TOP' });
    const inHand = give(s0, 'p2', 'x-weird', { hand: true });
    const { s } = zapP2(s0);
    p2Turn(s);
    expect(validateAttack(s, 'p2', { type: 'attack', attackType: 'control', attacker: att, target: weird })).toMatch(/Weird/);
    expect(validateAttack(s, 'p2', { type: 'attack', attackType: 'control', attacker: ill(s, 'p2'), target: weird })).toMatch(/Weird/);
    expect(validateAttack(s, 'p2', { type: 'attack', attackType: 'destroy', attacker: att, target: weird })).toBeNull();
    expect(validateAttack(s, 'p2', { type: 'attack', attackType: 'control', attacker: att, target: straight })).toBeNull();
    expect(takeoverOptions(s, 'p2').some((o) => o.card === inHand)).toBe(false);
    // The Zap does not bind the player who played it.
    s.active = 0;
    const mine = give(s, 'p1', 'x-plain', { under: ill(s, 'p1'), side: 'LEFT' });
    const theirs = give(s, 'p2', 'x-weird', { under: att, side: 'BOTTOM' });
    expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'control', attacker: mine, target: theirs })).toBeNull();
  });
  it('played in the middle of an attack it makes that attack illegal, and the attack is cancelled', () => {
    const s0 = scenario();
    const att = give(s0, 'p2', 'x-violent', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const weird = give(s0, 'p1', 'x-weird', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const z = give(s0, 'p1', 'x-zap', { hand: true });
    let s = act(p2Turn(s0), 'p2', { type: 'attack', attackType: 'control', attacker: att, target: weird });
    s = act(s, 'p1', { type: 'playPlot', play: { card: z, target: ill(s, 'p2'), payWith: [ill(s, 'p1')] } });
    expect(s.attack!.illegal).toMatch(/Weird/);
    s = resolve(s, [2, 2]);
    expect(s.attack).toBeUndefined();
    expect(s.cards[weird].controller).toBe('p1');
    expect(s.cards[z].linkedTo).toBe(ill(s, 'p2')); // the Zap stays
  });
  it('several Zaps add up', () => {
    const s0 = scenario();
    const att = give(s0, 'p2', 'x-plain', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const weird = give(s0, 'p1', 'x-weird', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const straight = give(s0, 'p1', 'x-straight', { under: ill(s0, 'p1'), side: 'TOP' });
    let { s } = zapP2(s0);
    s.cards[ill(s, 'p1')].tokens = 1;
    s = zapP2(s, 'x-zap2').s;
    expect(zapsOn(s, 'p2').length).toBe(2);
    p2Turn(s);
    expect(validateAttack(s, 'p2', { type: 'attack', attackType: 'control', attacker: att, target: weird })).toMatch(/Weird/);
    expect(validateAttack(s, 'p2', { type: 'attack', attackType: 'control', attacker: att, target: straight })).toMatch(/Straight/);
  });
  it('any player may spend an Illuminati action to remove every Zap from one player (not during an Instant attack)', () => {
    const s0 = scenario();
    let { s } = zapP2(s0);
    s.cards[ill(s, 'p1')].tokens = 1;
    s = zapP2(s, 'x-zap2').s;
    p2Turn(s);
    s.cards[ill(s, 'p2')].tokens = 0;
    expect(() => act(s, 'p2', { type: 'removeZaps', player: 'p2' })).toThrow(/Illuminati/);
    s.cards[ill(s, 'p2')].tokens = 1;
    expect(() => act(s, 'p2', { type: 'removeZaps', player: 'p1' })).toThrow(/not Zapped/);
    const t = act(s, 'p2', { type: 'removeZaps', player: 'p2' });
    expect(zapsOn(t, 'p2')).toEqual([]);
    expect(t.cards[ill(t, 'p2')].tokens).toBe(0);
    // Not during an Instant attack.
    const u = structuredClone(s);
    u.attack = { id: 9, type: 'destroy', instant: true, attackerPlayer: 'p1', target: ill(u, 'p2'), fromHand: false, privileged: false, aid: [], oppose: [], attackBonus: [], defenseBonus: [], plays: [] };
    u.window = { kind: 'attack', passed: [] };
    expect(() => act(u, 'p2', { type: 'removeZaps', player: 'p2' })).toThrow(/Instant/);
  });
  it('a Zap may forbid Assassinations and Disasters', () => {
    const s0 = scenario();
    const person = give(s0, 'p1', 'x-person', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const hit = give(s0, 'p2', 'x-assassin', { hand: true });
    const { s } = zapP2(s0, 'x-zap-instant');
    p2Turn(s);
    expect(() => act(s, 'p2', { type: 'playPlot', play: { card: hit, target: person } })).toThrow(/Assassinations/);
  });
  it('Zap hooks can turn Group draws into Plot draws and take away the closeness bonus', () => {
    const s0 = scenario();
    let { s } = zapP2(s0, 'x-zap-draw');
    const before = player(s, 'p2').hand.length;
    const got = drawGroup(s, player(s, 'p2'));
    expect(got.length).toBe(1);
    expect(CARDS[s.cards[got[0]].cardId].type).toBe('Plot');
    expect(player(s, 'p2').hand.length).toBe(before + 1);
    s = scenario();
    const tgt = give(s, 'p2', 'x-plain', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const att = give(s, 'p1', 'x-violent', { under: ill(s, 'p1'), side: 'BOTTOM' });
    s = zapP2(s, 'x-zap-proximity').s;
    s.cards[att].tokens = 1;
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    expect(attackStrength(s, s.attack!).lines.some((l) => /close to its Illuminati/.test(l))).toBe(false);
  });
});

// ---------------------------------------------------------------- Paralysis

describe('Paralysis', () => {
  function setup() {
    const s = scenario();
    const payer = give(s, 'p1', 'x-violent', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const target = give(s, 'p2', 'x-peaceful', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const puppet = give(s, 'p2', 'x-plain', { under: target, side: 'BOTTOM' });
    const res = give(s, 'p2', 'x-res', { resource: true });
    s.cards[res].linkedTo = target;
    const card = give(s, 'p1', 'x-paralysis', { hand: true });
    return { s, payer, target, puppet, res, card };
  }
  it('costs an Illuminati action or Violent actions totalling the target\'s Resistance', () => {
    const { s, payer, target, card } = setup();
    const weak = give(s, 'p1', 'x-weird', { under: ill(s, 'p1'), side: 'TOP' });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, target } })).toThrow(/Illuminati|Violent/);
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card, target, payWith: [weak] } })).toThrow(/Violent/);
    const plays = costPlays(s, 'p1', { card, target }, PLOTS['x-paralysis'].requires!);
    expect(plays.map((p) => p.payWith)).toEqual([[ill(s, 'p1')], [payer]]);
    const t = playAndResolve(s, 'p1', { card, target, payWith: [payer] });
    expect(t.cards[payer].tokens).toBe(0);
    expect(t.cards[ill(t, 'p1')].tokens).toBe(1);
    expect(isParalyzed(t, target)).toBe(true);
  });
  it('the Group cannot act, loses its ability and its linked Resources, gets no puppets and does not count for Goals', () => {
    const { s, payer, target, puppet, res, card } = setup();
    expect(power(s, target)).toBe(3 + 1 + 2);
    const count = goalCount(s, 'p2');
    const t = playAndResolve(s, 'p1', { card, target, payWith: [payer] });
    expect(t.cards[target].tokens).toBe(0);
    expect(t.cards[target].heldTokens).toBe(1);
    expect(power(t, target)).toBe(3); // no ability, no linked Resource
    expect(goalCount(t, 'p2')).toBe(count - 1); // its puppet still counts
    expect(t.cards[puppet].tokens).toBe(1);
    p2Turn(t);
    expect(() => act(t, 'p2', { type: 'buyPlot', payWith: [target, puppet] })).toThrow();
    const newcomer = give(t, 'p2', 'x-plain', { under: ill(t, 'p2'), side: 'TOP' });
    expect(() => act(t, 'p2', { type: 'move', group: newcomer, onto: target, side: 'LEFT', payWith: ill(t, 'p2') })).toThrow(/Paralyzed/);
    // Its Resources may be linked elsewhere.
    const u = act(t, 'p2', { type: 'link', resource: res, to: puppet });
    expect(u.cards[res].linkedTo).toBe(puppet);
  });
  it('can be removed at any time by its master or any Illuminati, victory claims included, and the token comes back', () => {
    const { s, payer, target, card } = setup();
    let t = playAndResolve(s, 'p1', { card, target, payWith: [payer] });
    t = act(t, 'p1', { type: 'endTurn' }); // end-of-turn window: p2 may act
    expect(() => act(t, 'p2', { type: 'freeGroup', group: target, payWith: payer })).toThrow(/your own/);
    t = act(t, 'p2', { type: 'freeGroup', group: target, payWith: ill(t, 'p2') });
    expect(isParalyzed(t, target)).toBe(false);
    expect(t.cards[card].zone).toBe('discard');
    expect(t.cards[target].tokens).toBe(1);
    expect(t.cards[ill(t, 'p2')].tokens).toBe(0);
  });
  it('ends when the Group loses the alignment it was played on', () => {
    const { s, payer, target, card } = setup();
    const t = playAndResolve(s, 'p1', { card, target, payWith: [payer] });
    t.cards[target].mods.push({ source: 'test', kind: 'removeAlign', align: 'Peaceful', until: 'permanent' });
    syncConditions(t);
    expect(isParalyzed(t, target)).toBe(false);
    expect(t.cards[card].zone).toBe('discard');
  });
});

// ---------------------------------------------------------------- Freeze

describe('Attribute Freeze', () => {
  it('until the end of the turn, Frozen Groups spend no tokens except to defend themselves', () => {
    const s0 = scenario();
    const mine = give(s0, 'p1', 'x-bank', { under: ill(s0, 'p1'), side: 'TOP' });
    const att = give(s0, 'p1', 'x-violent', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const bank = give(s0, 'p2', 'x-bank', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const bank2 = give(s0, 'p2', 'x-bank2', { under: ill(s0, 'p2'), side: 'TOP' });
    const f = give(s0, 'p1', 'x-freeze', { hand: true });
    let s = playAndResolve(s0, 'p1', { card: f, mode: 'freeze', payWith: [ill(s0, 'p1')] });
    expect(frozen(s, bank) && frozen(s, mine) && frozen(s, bank2)).toBe(true);
    expect(s.cards[mine].tokens).toBe(0);
    expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'control', attacker: mine, target: bank })).toMatch(/token/);
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: bank });
    expect(canOppose(s, 'p2', bank2).ok).toBe(false);
    expect(canOppose(s, 'p2', bank).ok).toBe(true); // defending itself
    s = act(s, 'p2', { type: 'oppose', group: bank });
    expect(s.cards[bank].heldTokens ?? 0).toBe(0);
    s = resolve(s, [6, 6]);
    // The Freeze ends with the turn: p2's Groups get their tokens back.
    s = act(s, 'p1', { type: 'endTurn' });
    for (let i = 0; i < 20 && !(s.phase === 'main' && s.active === 1); i++) s = act(s, waitingFor(s)[0], s.prompt?.kind === 'takeover' ? { type: 'skipTakeover' } : { type: 'pass' });
    expect(s.freezes).toBeUndefined();
    expect(s.cards[bank2].tokens).toBe(1);
    expect(s.cards[bank].tokens).toBe(1);
  });
  it('or, right after a matching Group acts, cancels that action', () => {
    const s0 = scenario();
    const bank = give(s0, 'p2', 'x-bank', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const target = give(s0, 'p1', 'x-plain', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const f = give(s0, 'p1', 'x-freeze', { hand: true });
    let s = act(p2Turn(s0), 'p2', { type: 'attack', attackType: 'destroy', attacker: bank, target });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: f, mode: 'cancel', target, payWith: [ill(s, 'p1')] } })).toThrow(/acting/);
    s = act(s, 'p1', { type: 'playPlot', play: { card: f, mode: 'cancel', target: bank, payWith: [ill(s, 'p1')] } });
    s = resolve(s, [2, 2]);
    expect(s.cards[target].zone).toBe('structure');
    expect(s.log.some((l) => /cancelled/.test(l.text))).toBe(true);
  });
});

// ---------------------------------------------------------------- costs, assassinations, links, joining

describe('"Requires ... Action" costs', () => {
  it('offers every affordable way to pay, and the engine pays before the card acts', () => {
    const s0 = scenario();
    const c = give(s0, 'p1', 'x-costly', { hand: true });
    const d1 = give(s0, 'p1', 'x-zap', { hand: true });
    const d2 = give(s0, 'p1', 'x-zap2', { hand: true });
    const plays = costPlays(s0, 'p1', { card: c }, PLOTS['x-costly'].requires!);
    expect(plays.length).toBe(2);
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card: c, discards: [d1] } })).toThrow(/2 other Plot cards/);
    const s = playAndResolve(s0, 'p1', { card: c, discards: [d1, d2] });
    expect(s.cards[d1].zone).toBe('discard');
    expect(s.cards[ill(s, 'p1')].tokens).toBe(1);
    expect(s.cards[ill(s, 'p1')].data?.costly).toBe(true);
    expect(groupActions({ attributes: ['SubGenius'] })).toMatchObject({ kind: 'groups', count: 1 });
  });
});

describe('Assassinations and killed Personalities', () => {
  it('the shared Assassination family: Power may depend on the target; a success kills the Personality', () => {
    const s0 = scenario();
    const person = give(s0, 'p2', 'x-person', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const helper = give(s0, 'p1', 'x-violent', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const hit = give(s0, 'p1', 'x-assassin', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card: hit, target: person, helper } });
    expect(s.attack!.instant && s.attack!.assassination).toBe(true);
    expect(s.attack!.instantPower).toBe(10);
    s = resolve(s, [2, 2]);
    expect(s.cards[person].zone).toBe('destroyed');
    expect(isKilled(s, person)).toBe(true);
  });
  it('killPersonality destroys and marks killed; other Groups are only destroyed', () => {
    const s = scenario();
    const person = give(s, 'p2', 'x-person', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const org = give(s, 'p2', 'x-plain', { under: ill(s, 'p2'), side: 'TOP' });
    killPersonality(s, person, 'p1');
    killPersonality(s, org, 'p1');
    expect([isKilled(s, person), isKilled(s, org)]).toEqual([true, false]);
    expect(s.cards[org].zone).toBe('destroyed');
  });
});

describe('links as the SubGenius rules use them', () => {
  it('a link that becomes illegal is inactive until legal again; one illegal for good is discarded', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'x-weird', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const l = give(s0, 'p1', 'x-link', { hand: true });
    let s = playAndResolve(s0, 'p1', { card: l, target: g });
    expect(power(s, g)).toBe(7);
    s.cards[g].mods.push({ source: 't', kind: 'removeAlign', align: 'Weird', until: 'endOfTurn' });
    syncConditions(s);
    expect(power(s, g)).toBe(4);
    s.cards[g].mods = [];
    syncConditions(s);
    expect(power(s, g)).toBe(7);
    s = act(s, 'p1', { type: 'endTurn' });
    s.cards[g].zone = 'removed';
    syncConditions(s);
    expect(s.cards[l].zone).toBe('discard');
  });
});

describe('who may join an attack a card makes', () => {
  it('the launching card may let some Groups defend (and multiply their Power)', () => {
    const s0 = scenario();
    const place = give(s0, 'p2', 'x-plain', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const sci = give(s0, 'p2', 'x-science', { under: ill(s0, 'p2'), side: 'TOP' });
    const other = give(s0, 'p2', 'x-weird', { under: ill(s0, 'p2'), side: 'LEFT' });
    const helper = give(s0, 'p1', 'x-plain', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const d = give(s0, 'p1', 'x-disaster', { hand: true });
    let s = playAndResolve(s0, 'p1', { card: d, target: place });
    expect(s.attack?.cardPower).toBe(10);
    expect(canOppose(s, 'p2', sci).ok).toBe(true);
    expect(canOppose(s, 'p2', other).ok).toBe(false);
    expect(canAid(s, 'p1', helper).ok).toBe(false);
    const before = attackStrength(s, s.attack!).defense;
    s = act(s, 'p2', { type: 'oppose', group: sci });
    expect(attackStrength(s, s.attack!).defense).toBe(before + 6);
  });
});

describe('Convenience Stores (Assassins) and the base cards that name it', () => {
  it('Tabloids and Video Games get +3 to take it over once it is in the game', () => {
    const s0 = scenario();
    const tab = give(s0, 'p1', 'tabloids', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    give(s0, 'p1', 'video-games', { under: ill(s0, 'p1'), side: 'TOP' });
    const cs = give(s0, 'p2', 'convenience-stores', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: tab, target: cs });
    const lines = attackStrength(s, s.attack!).lines;
    expect(lines).toContain('Attack +3: Tabloids');
    expect(lines).toContain('Attack +3: Video Games');
  });
});

// ---------------------------------------------------------------- Slack (Church of the SubGenius)

describe('Slack', () => {
  const church = (s: GameState, pl: string) => { s.cards[ill(s, pl)].cardId = CHURCH; return ill(s, pl); };
  it('the Church keeps its tokens from turn to turn and gets its new one on top', () => {
    const s0 = scenario();
    const c = church(s0, 'p1');
    s0.cards[c].tokens = 2;
    let s = act(p2Turn(s0), 'p2', { type: 'endTurn' });
    for (let i = 0; i < 20 && !(s.phase === 'main' && s.active === 0); i++) s = act(s, waitingFor(s)[0], s.prompt?.kind === 'takeover' ? { type: 'skipTakeover' } : { type: 'pass' });
    expect(s.cards[c].tokens).toBe(3);
  });
  it('up to 3 Slack count as Groups toward the Basic Goal (its Special Goal)', () => {
    const s = scenario();
    const c = church(s, 'p1');
    give(s, 'p1', 'x-plain', { under: c, side: 'BOTTOM' });
    s.settings.basicGoal = 5;
    const special = () => goalOptions(s, 'p1').find((o) => o.id === 'special')!;
    s.cards[c].tokens = 2;
    expect(special().met).toBe(false);
    s.cards[c].tokens = 3;
    expect(special().met).toBe(true);
    s.settings.basicGoal = 6;
    s.cards[c].tokens = 9;
    expect(special().met).toBe(false); // only 3 count
    expect(goalOptions(s, 'p1').find((o) => o.id === 'basic')!.met).toBe(false);
  });
  it('the Church and its SubGenius Groups get +2 on direct Attacks to Control SubGenius Groups', () => {
    const s0 = scenario();
    const c = church(s0, 'p1');
    const sub = give(s0, 'p1', 'x-sub', { under: c, side: 'BOTTOM' });
    const plain = give(s0, 'p1', 'x-plain', { under: c, side: 'TOP' });
    const tgt = give(s0, 'p2', 'x-sub-target', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: sub, target: tgt });
    expect(attackStrength(s, s.attack!).lines).toContain('Attack +2: Church of the SubGenius');
    s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: plain, target: tgt });
    expect(attackStrength(s, s.attack!).lines).not.toContain('Attack +2: Church of the SubGenius');
  });
});

// ---------------------------------------------------------------- the stand-alone SubGenius game

describe('the stand-alone SubGenius game', () => {
  const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isAI: true, deck: { illuminati: CHURCH, plots: [], groups: [] } }));
  const sg = (n = 3, seed = 4) => createGame({ seed, players: players(n), settings: { subgeniusRules: true } });

  it('sets up shared decks: every player plays the Church, holds 3 Plots, leads with one of 3 dealt Group cards', () => {
    const s = sg(3);
    checkInvariants(s);
    expect(s.settings.basicGoal).toBe(10);
    expect(sg(2).settings.basicGoal).toBe(12);
    expect(s.common).toBeDefined();
    for (const p of s.players) {
      expect(s.cards[p.illuminati].cardId).toBe(CHURCH);
      expect(p.plotDeck.length + p.groupDeck.length).toBe(0);
      const lead = structureCards(s, p.id).length - 1 + Object.values(s.cards).filter((c) => c.zone === 'resources' && c.controller === p.id).length;
      expect(lead).toBe(1);
    }
    // Only SubGenius cards are used, each once.
    const ids = Object.values(s.cards).map((c) => c.cardId).filter((id) => id !== CHURCH);
    expect(ids.every((id) => CARDS[id].set === 'SubGenius')).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // The first player has put his two held cards (and his draw) into the uncontrolled area.
    const first = s.players[s.active];
    expect(first.hand.every((c) => CARDS[s.cards[c].cardId].type === 'Plot')).toBe(true);
    expect(s.common!.uncontrolled.length).toBe(3);
    for (const p of s.players.filter((x) => x !== first)) expect(p.hand.filter((c) => CARDS[s.cards[c].cardId].type !== 'Plot').length).toBe(2);
  });
  it('the automatic takeover is limited to cards the player put into the area this turn, and costs the Illuminati token', () => {
    const s = sg(3);
    const pl = s.players[s.active].id;
    expect(s.prompt?.kind).toBe('takeover');
    expect(takeoverOptions(s, pl).length).toBeGreaterThan(0);
    for (const o of takeoverOptions(s, pl)) expect(s.cards[o.card]).toMatchObject({ placedBy: pl, placedTurn: s.turn });
    // A card another player put there, or one from an earlier turn, cannot be taken over automatically.
    const other = s.common!.uncontrolled[0];
    s.cards[other].placedTurn = s.turn - 1;
    expect(takeoverOptions(s, pl).some((o) => o.card === other)).toBe(false);
    s.cards[other].placedTurn = s.turn;
    const o = takeoverOptions(s, pl)[0];
    const t = act(s, pl, { type: 'takeover', ...o });
    checkInvariants(t);
    expect(t.cards[ill(t, pl)].tokens).toBe(0); // no new Slack after an automatic takeover
  });
  it('anyone may attack a Group in the uncontrolled area, to control or to destroy it', () => {
    let s = sg(3, 7);
    const pl = s.players[s.active].id;
    if (s.prompt?.kind === 'takeover') s = act(s, pl, { type: 'skipTakeover' });
    const target = s.common!.uncontrolled.find((c) => CARDS[s.cards[c].cardId].type === 'Group')!;
    const att = structureCards(s, pl).find((g) => g !== ill(s, pl) && s.cards[g].tokens > 0) ?? ill(s, pl);
    expect(validateAttack(s, pl, { type: 'attack', attackType: 'destroy', attacker: att, target })).toBeNull();
    let t = act(s, pl, { type: 'attack', attackType: 'destroy', attacker: att, target });
    expect(t.attack!.fromArea).toBe(true);
    expect(t.attack!.targetPlayer).toBeUndefined();
    t.attack!.plays.push({ iid: 'force', player: pl, play: { card: 'force' }, effect: { t: 'set', value: 2 } });
    t.attack!.attackBonus.push({ player: pl, amount: 50, label: 'test' });
    t = resolve(t);
    expect(t.cards[target].zone).toBe('destroyed');
    expect(t.common!.uncontrolled).not.toContain(target);
    expect(player(t, pl).destroyedCredit).toContain(target);
    checkInvariants(t);
  });
  it('Group draws go to the area only while it holds fewer than 8 cards; Resources are taken for one Slack a turn', () => {
    let s = sg(3, 11);
    const pl = s.players[s.active].id;
    if (s.prompt?.kind === 'takeover') s = act(s, pl, { type: 'skipTakeover' });
    s.cards[ill(s, pl)].tokens = 3;
    // Buying a Group card: one Illuminati token, into the area.
    const n = s.common!.uncontrolled.length;
    s = act(s, pl, { type: 'drawGroup' });
    expect(s.common!.uncontrolled.length).toBe(n + 1);
    // A Resource in the area.
    const res = Object.values(s.cards).find((c) => CARDS[c.cardId].type === 'Resource' && (c.zone === 'groupDeck' || c.zone === 'uncontrolled'))!;
    if (res.zone === 'groupDeck') { s.common!.groupDeck = s.common!.groupDeck.filter((x) => x !== res.iid); res.zone = 'uncontrolled'; s.common!.uncontrolled.push(res.iid); }
    s = act(s, pl, { type: 'playResource', card: res.iid });
    expect(s.cards[res.iid]).toMatchObject({ zone: 'resources', controller: pl });
    checkInvariants(s);
    // Discards go to the shared pile and never back into the deck.
    const c = player(s, pl).hand[0];
    expect(() => act(s, pl, { type: 'discard', cards: [c], toDeck: true })).toThrow(/discard pile/);
    s = act(s, pl, { type: 'discard', cards: [c] });
    expect(s.common!.plotDiscard).toContain(c);
  });
  it('a destroyed Group\'s puppets become uncontrolled; the player who takes a rival\'s last Group gets his Plots', () => {
    const s = sg(2, 5);
    s.phase = 'main'; s.prompt = undefined; s.promptQueue = undefined;
    const [a, b] = s.players;
    const top = give(s, b.id, 'x-plain', { under: b.illuminati, side: 'TOP' });
    const pup = give(s, b.id, 'x-weird', { under: top, side: 'BOTTOM' });
    killPersonality(s, top, a.id); // not a Personality: simply destroyed
    expect(s.cards[pup].zone).toBe('uncontrolled');
    expect(s.common!.uncontrolled).toContain(pup);
    checkInvariants(s);
    // Elimination: the eliminator takes the Plot hand.
    const plots = [...b.hand].filter((c) => CARDS[s.cards[c].cardId].type === 'Plot');
    b.lastPuppetTakenBy = a.id; b.turnsTaken = 3;
    for (const g of structureCards(s, b.id).filter((g) => g !== b.illuminati)) killPersonality(s, g, a.id);
    const t = act(s, s.players[s.active].id, { type: 'setAutoPass', value: false });
    expect(player(t, b.id).eliminated).toBe(true);
    for (const c of plots) expect(player(t, a.id).hand).toContain(c);
    checkInvariants(t);
  });
  it('online players never see the shared decks', () => {
    const s = sg(3);
    const v = viewFor(s, 'p1');
    for (const iid of [...v.common!.plotDeck, ...v.common!.groupDeck]) expect(['hidden-plot', 'hidden-group']).toContain(v.cards[iid].cardId);
    for (const iid of v.common!.uncontrolled) expect(v.cards[iid].cardId).toBe(s.cards[iid].cardId);
  });
  it('the Secret attribute has no effect of its own', () => {
    const s = sg(2);
    const secret = Object.values(s.cards).find((c) => (CARDS[c.cardId].attributes ?? []).includes('Secret'))!;
    expect(secret).toBeDefined();
    // isSecret is false under SubGenius rules, so ordinary Groups may attack it.
    s.common!.groupDeck = s.common!.groupDeck.filter((x) => x !== secret.iid);
    Object.assign(secret, { zone: 'uncontrolled' }); s.common!.uncontrolled.push(secret.iid);
    const pl = s.players[s.active].id;
    s.phase = 'main'; s.prompt = undefined;
    const att = give(s, pl, 'x-plain', { under: ill(s, pl), side: 'TOP' });
    expect(validateAttack(s, pl, { type: 'attack', attackType: 'control', attacker: att, target: secret.iid })).toBeNull();
  });
});
