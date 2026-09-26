// The last engine gaps before the Assassins and SubGenius packs ship:
//  - a card's die roll made in the middle of an attack (Imelda Marcos, Bill Clinton, OPEC, Killer
//    Satellite) can be answered by the cards that change "any die roll", in a window of its own that
//    opens only when someone could answer (otherwise the game plays exactly as before);
//  - plotOptions offers every affordable "Requires ... Action" alternative, cheapest first;
//  - Regi$tered Trademark's slips use the shared Plot deck in the SubGenius game;
//  - responseOptions (and so auto-pass) knows about removing Zaps and freeing Paralyzed Groups;
//  - the Slack Special Goal's label names whoever claims it.
import { describe, expect, it } from 'vitest';
import {
  BASE_CARDS, CARDS, CHURCH, HOOKS, PLOTS, alignments, applyAction, costPlays, createGame, goalOptions, hasResponse, heldRoll, openArrows,
  plotOptions, power, responseOptions, waitingFor, type Action, type CardDef, type GameState, type PlotPlay,
} from '../../src/engine';
import { rollDie } from '../../src/engine/rng';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const play = (s: GameState, pl: string, p: PlotPlay) => act(s, pl, { type: 'playPlot', play: p });
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const hand = (s: GameState, pl: string, id: string) => give(s, pl, id, { hand: true });
const put = (s: GameState, pl: string, id: string, master?: string) => {
  const m = master ?? ill(s, pl);
  return give(s, pl, id, { under: m, side: openArrows(s, m)[0] });
};
const use = (s: GameState, pl: string, card: string, ability: string, params: Record<string, unknown> = {}) =>
  act(s, pl, { type: 'useAbility', card, ability, params });
/** Three spare Plots for a card that costs three discards (Bulldada, Luck Plane). */
const spares = (s: GameState, pl: string) => [hand(s, pl, 'x-day'), hand(s, pl, 'x-day'), hand(s, pl, 'x-day')];
/** Everyone passes until the given kind of window (or none) is up. */
function passUntil(s: GameState, done: (s: GameState) => boolean): GameState {
  for (let i = 0; i < 40 && !done(s) && s.window && !s.prompt; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
const seedFor = (ok: (d: number) => boolean) => {
  for (let k = 1; k < 1000; k++) if (ok(rollDie({ rng: k } as GameState))) return k;
  throw new Error('no seed');
};

const group = (id: string, o: Partial<CardDef>): CardDef => ({
  id, name: id, type: 'Group', subtype: 'Organization', rarity: null, text: '', power: 4, globalPower: 0, resistance: 4,
  alignments: [], attributes: [], arrowIn: 'TOP', arrowsOut: ['BOTTOM', 'LEFT', 'RIGHT'], ...o,
});
for (const d of [
  group('pf-strong', { power: 40, resistance: 1 }),
  group('pf-sub', { attributes: ['SubGenius'], power: 5 }),
  group('pf-peaceful', { alignments: ['Peaceful'], power: 3, resistance: 3 }),
  group('pf-violent', { alignments: ['Violent'], power: 4, resistance: 4 }),
]) CARDS[d.id] = d;

describe('a die roll made in the middle of an attack can be answered', () => {
  function imelda(seed?: number) {
    const s0 = scenario();
    const im = put(s0, 'p1', 'imelda-marcos');
    const tgt = put(s0, 'p2', 'federal-reserve');
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: im, target: tgt });
    if (seed !== undefined) s.rng = seed;
    return { s, im, tgt };
  }

  it('with nobody able to answer, Imelda Marcos\'s roll counts at once, exactly as before', () => {
    const seed = seedFor((d) => d <= 5);
    const { s: s0, im } = imelda(seed);
    const die = rollDie({ rng: seed } as GameState);
    const s = use(s0, 'p1', im, 'gamble');
    expect(s.window?.kind).toBe('attack');
    expect(heldRoll(s)).toBeUndefined();
    expect(s.log.some((l) => l.text === `Imelda Marcos rolls ${die}: her Power counts as 5.`)).toBe(true);
    expect(s.attack!.attackBonus.some((b) => b.label.startsWith('Imelda') && b.amount === 5 - power(s, im))).toBe(true);
    // The same position gives the same result (replays stay deterministic).
    expect(JSON.stringify(use(s0, 'p1', im, 'gamble').attack)).toBe(JSON.stringify(s.attack));
  });

  it('the Janor Device\'s holder turns Imelda\'s 6 into a 5: she survives and counts as Power 5', () => {
    const { s: s0, im } = imelda(seedFor((d) => d === 6));
    const dev = give(s0, 'p1', 'janor-device', { resource: true });
    let s = use(s0, 'p1', im, 'gamble');
    // The roll waits in a window of its own; the attack's window comes back afterwards.
    expect(s.window?.kind).toBe('event');
    expect(heldRoll(s)?.data?.dice).toEqual([6]);
    expect(s.cards[im].zone).toBe('structure');
    s = use(s, 'p1', dev, 'adjust', { mode: 'minus' });
    s = passUntil(s, (t) => t.window?.kind === 'attack');
    expect(s.window?.kind).toBe('attack');
    expect(s.cards[im].zone).toBe('structure');
    const entry = s.attack!.plays.find((p) => p.iid.startsWith(`ability:${im}:gamble:`))!;
    expect(entry).toBeDefined();
    expect(s.attack!.attackBonus.some((b) => b.plot === entry.iid && b.amount === 5 - power(s, im))).toBe(true);
    // The Device changed Imelda's roll, not the attack: nothing of it is recorded in the attack.
    expect(s.attack!.plays.some((p) => p.ability === dev)).toBe(false);
    expect(s.attack!.roll).toBeUndefined();
  });

  it('a rival\'s Bulldada makes Imelda\'s roll a 12: she is destroyed and her action cancelled', () => {
    const { s: s0, im } = imelda(seedFor((d) => d === 1));
    const card = hand(s0, 'p2', 'bulldada');
    const d = spares(s0, 'p2');
    let s = use(s0, 'p1', im, 'gamble');
    expect(heldRoll(s)).toBeDefined();
    expect(s.cards[im].zone).toBe('structure'); // a 1: nothing has happened yet
    s = play(s, 'p2', { card, discards: d });
    s = passUntil(s, (t) => t.window?.kind === 'attack' || !t.attack);
    expect(s.cards[im].zone).toBe('destroyed');
    expect(s.players[1].destroyedCredit).toContain(im);
    // Bulldada answered her roll: it is not one of the attack's plays, and it is discarded.
    expect(s.window?.kind).toBe('attack');
    expect(s.attack!.plays.some((p) => p.iid === card)).toBe(false);
    expect(s.cards[card].zone).toBe('discard');
    const entry = s.attack!.plays.find((p) => p.iid.startsWith(`ability:${im}:gamble:`))!;
    expect(entry.effect).toEqual({ t: 'cancelGroup', group: im });
    s = passUntil(s, (t) => !t.attack);
    expect(s.attack).toBeUndefined();
  });

  it('Bill Clinton\'s roll as an attack starts can be answered before the attack goes on (Luck Plane: Liberal)', () => {
    const s0 = scenario();
    const b = put(s0, 'p1', 'bill-clinton');
    const att = put(s0, 'p1', 'the-mafia');
    const tgt = put(s0, 'p2', 'dentists');
    const card = hand(s0, 'p2', 'luck-plane');
    const d = spares(s0, 'p2');
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    expect(s.attack).toBeDefined();
    expect(s.window?.kind).toBe('event');
    expect(heldRoll(s)?.data?.key).toBe('bill-clinton');
    s = play(s, 'p2', { card, discards: d });
    s = passUntil(s, (t) => t.window?.kind === 'attack');
    expect(s.window?.kind).toBe('attack');
    expect(s.window?.passed).toEqual([]);
    expect(s.log.some((l) => l.text === 'Bill Clinton rolls 2: he is Liberal in this attack.')).toBe(true);
    expect(alignments(s, b)).toContain('Liberal');
  });

  it('in a game where nobody could answer, Bill Clinton\'s roll opens no window', () => {
    const s0 = scenario();
    put(s0, 'p1', 'bill-clinton');
    const att = put(s0, 'p1', 'the-mafia');
    const tgt = put(s0, 'p2', 'dentists');
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    expect(s.window?.kind).toBe('attack');
    expect(s.log.some((l) => /^Bill Clinton rolls \d: he is (not )?Liberal in this attack\.$/.test(l.text))).toBe(true);
  });

  it('OPEC captured in an attack: its roll for Power may be answered (Bulldada: Power 10)', () => {
    const s0 = scenario();
    const att = put(s0, 'p1', 'pf-strong');
    const opec = put(s0, 'p2', 'opec');
    const card = hand(s0, 'p2', 'bulldada');
    const d = spares(s0, 'p2');
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: opec });
    for (let i = 0; i < 20 && s.attack && !heldRoll(s); i++) {
      if (s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = [1, 1];
      s = act(s, waitingFor(s)[0], { type: 'pass' });
    }
    expect(s.cards[opec].controller).toBe('p1');
    expect(heldRoll(s)?.data?.key).toBe('opec');
    s = play(s, 'p2', { card, discards: d });
    s = passUntil(s, (t) => !t.window);
    expect(s.window).toBeUndefined();
    expect(power(s, opec)).toBe(10);
  });

  it('Killer Satellite used during an attack: a Luck Plane 2 destroys the target and spares the Satellite', () => {
    const s0 = scenario();
    const att = put(s0, 'p1', 'pf-strong');
    const tgt = put(s0, 'p2', 'dentists');
    const ks = give(s0, 'p1', 'killer-satellite', { resource: true });
    s0.cards[ks].tokens = 1;
    const spy = give(s0, 'p2', 'spy-satellite', { resource: true });
    const card = hand(s0, 'p2', 'luck-plane');
    const d = spares(s0, 'p2');
    s0.rng = seedFor((x) => x === 6); // left alone, a 6 would miss and cost the Satellite itself
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    s = use(s, 'p1', ks, 'strike', { target: spy, mode: 'roll' });
    expect(heldRoll(s)?.data?.key).toBe('killer-satellite');
    s = play(s, 'p2', { card, discards: d });
    s = passUntil(s, (t) => t.window?.kind === 'attack');
    expect(s.window?.kind).toBe('attack');
    expect(s.cards[spy].zone).not.toBe('resources');
    expect(s.cards[ks].zone).toBe('resources');
  });

  it('no base-game card could ever answer a card\'s roll, so base games never see such a window', () => {
    for (const d of BASE_CARDS) {
      const h = PLOTS[d.id];
      if (h?.timing.includes('event')) expect(h.events && !h.events.includes('dieRoll'), d.id).toBe(true);
      for (const ab of HOOKS[d.id]?.actions ?? []) {
        if (ab.timing.includes('event')) expect((ab.events ?? ['action']).includes('dieRoll'), `${d.id} ${ab.id}`).toBe(false);
      }
    }
  });
});

describe('plotOptions offers every affordable cost alternative', () => {
  it('The Saint of Sales: paid by a SubGenius Group or by the Illuminati, the Group first', () => {
    const s = scenario();
    const sub = put(s, 'p1', 'pf-sub');
    const res = hand(s, 'p1', 'bigfoot');
    const card = hand(s, 'p1', 'the-saint-of-sales');
    const opts = plotOptions(s, 'p1', card).map((o) => (o.action as { play: PlotPlay }).play).filter((p) => p.target === res);
    expect(opts.map((p) => p.payWith)).toEqual([[sub], [ill(s, 'p1')]]);
    // The same ways to pay as costPlays (which the interface lists), none left out.
    const all = costPlays(s, 'p1', { card, target: res }, PLOTS['the-saint-of-sales'].requires!);
    expect(new Set(opts.map((p) => JSON.stringify(p.payWith)))).toEqual(new Set(all.map((p) => JSON.stringify(p.payWith))));
    // Either one plays.
    for (const p of opts) expect(() => play(s, 'p1', p)).not.toThrow();
  });
  it('a Paralysis: an Illuminati action or Groups of the named alignment, both offered', () => {
    const s = scenario();
    const violent = put(s, 'p1', 'pf-violent');
    const target = put(s, 'p2', 'pf-peaceful');
    const card = hand(s, 'p1', 'cat-juggling');
    const opts = plotOptions(s, 'p1', card).map((o) => (o.action as { play: PlotPlay }).play).filter((p) => p.target === target);
    expect(opts.map((p) => p.payWith)).toEqual([[violent], [ill(s, 'p1')]]);
  });
  it('the Church spends its Slack last: Group actions come before an Illuminati action', () => {
    let s = createGame({ seed: 5, players: [1, 2].map((i) => ({ id: `p${i}`, name: `P${i}`, isAI: true, deck: { illuminati: CHURCH, plots: [], groups: [] } })), settings: { subgeniusRules: true } });
    if (s.prompt?.kind === 'takeover') s = act(s, s.players[s.active].id, { type: 'skipTakeover' });
    s.phase = 'main'; s.prompt = undefined; s.promptQueue = undefined; s.window = undefined;
    for (const p of s.players) p.turnsTaken = 1;
    const pl = s.players[s.active].id;
    s.cards[ill(s, pl)].tokens = 2;
    const sub = put(s, pl, 'pf-sub');
    const res = give(s, pl, 'bigfoot', { hand: true });
    s.players.find((p) => p.id === pl)!.hand = s.players.find((p) => p.id === pl)!.hand.filter((c) => c !== res);
    Object.assign(s.cards[res], { zone: 'uncontrolled' });
    s.common!.uncontrolled.push(res);
    const card = hand(s, pl, 'the-saint-of-sales');
    const opts = plotOptions(s, pl, card).map((o) => (o.action as { play: PlotPlay }).play);
    expect(opts[0].payWith).toEqual([sub]);
    expect(opts.some((p) => p.payWith?.[0] === ill(s, pl))).toBe(true);
  });
});

describe('Regi$tered Trademark in the SubGenius game uses the shared Plot deck', () => {
  function sg() {
    let s = createGame({ seed: 4, players: [1, 2].map((i) => ({ id: `p${i}`, name: `P${i}`, isAI: true, deck: { illuminati: CHURCH, plots: [], groups: [] } })), settings: { subgeniusRules: true } });
    if (s.prompt?.kind === 'takeover') s = act(s, s.players[s.active].id, { type: 'skipTakeover' });
    s.phase = 'main'; s.prompt = undefined; s.promptQueue = undefined; s.window = undefined;
    for (const p of s.players) p.turnsTaken = 1;
    const me = s.players[s.active].id, rival = s.players.find((p) => p.id !== me)!.id;
    // Two known Plots on top of the shared deck.
    const tops = [hand(s, me, 'x-day'), hand(s, me, 'x-day')];
    const p = s.players.find((x) => x.id === me)!;
    p.hand = p.hand.filter((c) => !tops.includes(c));
    for (const c of tops) s.cards[c].zone = 'plotDeck';
    s.common!.plotDeck.unshift(...tops);
    const tm = hand(s, me, 'regi-tered-trademark');
    p.hand = p.hand.filter((c) => c !== tm);
    Object.assign(s.cards[tm], { zone: 'table', controller: me });
    return { s, me, rival, tm, tops };
  }
  it('a slip admitted without a Plot from hand discards the top of the shared deck', () => {
    const { s: s0, me, tm, tops } = sg();
    s0.cards[tm].linkedTo = ill(s0, me);
    const before = s0.common!.plotDeck.length;
    const s = act(s0, me, { type: 'nameSlip', card: tm });
    expect(s.common!.plotDeck.length).toBe(before - 1);
    expect(s.common!.plotDiscard).toContain(tops[0]);
    expect(s.cards[tops[0]].zone).toBe('discard');
  });
  it('a rival caught slipping hands over the top of the shared deck', () => {
    const { s: s0, me, rival, tm, tops } = sg();
    s0.cards[tm].linkedTo = ill(s0, rival);
    const s = act(s0, me, { type: 'catchNameSlip', card: tm });
    expect(s.players.find((p) => p.id === me)!.hand).toContain(tops[0]);
    expect(s.common!.plotDeck).not.toContain(tops[0]);
  });
});

describe('responseOptions knows about Zaps and Paralysis', () => {
  it('removing the Zaps on you and freeing your Paralyzed Group are responses, so auto-pass waits for them', () => {
    let s = scenario();
    const peaceful = put(s, 'p2', 'pf-peaceful');
    const zap = hand(s, 'p1', 'brushfire-war');
    const zap2 = hand(s, 'p2', 'brushfire-war');
    const para = hand(s, 'p1', 'cat-juggling');
    for (const p of s.players) p.hand = [];
    Object.assign(s.cards[zap], { zone: 'table', controller: 'p1', linkedTo: ill(s, 'p2') });
    Object.assign(s.cards[zap2], { zone: 'table', controller: 'p2', linkedTo: ill(s, 'p1') });
    Object.assign(s.cards[para], { zone: 'table', controller: 'p1', linkedTo: peaceful });
    s = act(s, 'p1', { type: 'endTurn' });
    expect(s.window?.kind).toBe('endOfTurn');
    expect(waitingFor(s)).toContain('p2');
    const opts = responseOptions(s, 'p2').map((o) => o.action);
    expect(opts).toContainEqual({ type: 'removeZaps', player: 'p2' });
    expect(opts).toContainEqual({ type: 'freeGroup', group: peaceful, payWith: ill(s, 'p2') });
    expect(hasResponse(s, 'p2')).toBe(true);
    // Another player's Zaps are not offered as a response.
    expect(opts).not.toContainEqual({ type: 'removeZaps', player: 'p1' });
    // Each offered option is legal.
    for (const a of opts) expect(() => act(s, 'p2', a)).not.toThrow();
  });
});

describe('the Slack Special Goal is worded for whoever claims it', () => {
  it('names the claimant\'s Illuminati, not "your Illuminati"', () => {
    const s = createGame({ seed: 4, players: [1, 2].map((i) => ({ id: `p${i}`, name: `P${i}`, isAI: true, deck: { illuminati: CHURCH, plots: [], groups: [] } })), settings: { subgeniusRules: true } });
    for (const id of ['p1', 'p2']) {
      const label = goalOptions(s, id).find((o) => o.id === 'special')!.label;
      expect(label).toContain(`tokens on P${id.slice(1)}'s Illuminati`);
      expect(label).not.toMatch(/your Illuminati/);
    }
  });
});
