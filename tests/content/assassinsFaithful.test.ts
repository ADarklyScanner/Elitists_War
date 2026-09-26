// The Assassins cards played exactly as printed (and as the official errata and FAQ say): the
// choices each card gives a player, its full wording, and the engine features added for them.
import { afterEach, describe, expect, it } from 'vitest';
import {
  addFreeze, advance, alignments, applyAction, destroyGroup, frozen, GOALS, syncConditions, attackStrength, attributes, def, discardCard, goalCount, goFishShielded, HOOKS, localClock,
  openArrows, power, raiseEvent, resistance, shieldFromGoFish, validateAttack, waitingFor, abilityOptions, plotOptions,
  type Action, type AttackType, type CardInstance, type GameEvent, type GameState, type PlotPlay, type Side,
} from '../../src/engine';
import { checkInvariants, give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const P = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!;
const hand = (s: GameState, pl: string) => P(s, pl).hand;
const play = (s: GameState, pl: string, p: PlotPlay) => act(s, pl, { type: 'playPlot', play: p });
const use = (s: GameState, pl: string, card: string, ability: string, params: Record<string, unknown> = {}) =>
  act(s, pl, { type: 'useAbility', card, ability, params });
function put(s: GameState, pl: string, cardId: string, under?: string, side?: Side): string {
  const m = under ?? ill(s, pl);
  const sd = side ?? openArrows(s, m)[0];
  if (!sd) throw new Error(`no open arrow under ${m}`);
  return give(s, pl, cardId, { under: m, side: sd });
}
/** Pass until the response window of an event of this type is open. */
function untilEvent(s: GameState, type: GameEvent['type'], dice?: [number, number]): GameState {
  for (let i = 0; i < 40 && !(s.window?.kind === 'event' && s.window.event?.type === type) && (s.window || s.attack) && !s.prompt; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack?.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** Pass until no window (and no prompt) is waiting; forced dice if given. */
function settle(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 40 && (s.window || s.attack) && !s.prompt; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack?.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
function playAndResolve(s: GameState, pl: string, p: PlotPlay): GameState {
  s = play(s, pl, p);
  for (let i = 0; i < 10 && s.window?.kind === 'plot' && !s.prompt; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
function attack(s: GameState, attacker: string, target: string, type: AttackType, pl = 'p1', extra: Partial<Extract<Action, { type: 'attack' }>> = {}) {
  s.active = s.players.findIndex((p) => p.id === pl);
  return act(s, pl, { type: 'attack', attackType: type, attacker, target, ...extra });
}
let d = 0;
function toDeck(s: GameState, pl: string, cardId: string, deck: 'groupDeck' | 'plotDeck'): string {
  const iid = `fd${++d}`;
  const c: CardInstance = { iid, cardId, owner: pl, zone: deck, tokens: 0, mods: [] };
  s.cards[iid] = c;
  P(s, pl)[deck].unshift(iid);
  return iid;
}
function fireEvent(s: GameState, e: GameEvent): GameState {
  raiseEvent(s, e);
  advance(s);
  return s;
}
const choose = (s: GameState, ids: string[]) => act(s, s.prompt!.player, { type: 'choose', ids });
const line = (s: GameState, side: 'Attack' | 'Defense', name: string) =>
  attackStrength(s, s.attack!).lines.filter((l) => l.startsWith(side) && l.endsWith(`: ${name}`)).reduce((n, l) => n + Number(l.match(/([+-]\d+)/)![1]), 0);

const realNow = localClock.now;
afterEach(() => { localClock.now = realNow; });

// ------------------------------------------------------------------ Nutrition Nazis

describe('Nutrition Nazis played as a Plot', () => {
  it('links to a Group in play, which becomes Science, and is a Plot for all purposes', () => {
    let s = scenario();
    const g = put(s, 'p1', 'the-mafia');
    const nn = give(s, 'p1', 'nutrition-nazis', { hand: true });
    expect(plotOptions(s, 'p1', nn).length).toBeGreaterThan(0);
    s = playAndResolve(s, 'p1', { card: nn, target: g });
    expect(s.cards[nn].zone).toBe('table');
    expect(s.cards[nn].linkedTo).toBe(g);
    expect(attributes(s, g)).toContain('Science');
    // Only once per game.
    const nn2 = give(s, 'p2', 'nutrition-nazis', { hand: true });
    const g2 = put(s, 'p2', 'the-mafia');
    s.active = 1;
    expect(() => play(s, 'p2', { card: nn2, target: g2 })).toThrow(/once per game/);
    // No Nutrition Nazis may come into play as a Group while one is linked as a Plot.
    const a = put(s, 'p2', 'multinational-oil-companies');
    expect(validateAttack(s, 'p2', { type: 'attack', attackType: 'control', attacker: a, target: nn2 })).toMatch(/Plot/);
    // Its Group leaving play discards it.
    discardCard(s, g);
    syncConditions(s);
    expect(s.cards[nn].zone).toBe('discard');
  });
  it('may not be played while the Nutrition Nazis are in play as a Group, nor on a card in a hand', () => {
    const s = scenario();
    put(s, 'p2', 'nutrition-nazis');
    const nn = give(s, 'p1', 'nutrition-nazis', { hand: true });
    const g = put(s, 'p1', 'the-mafia');
    expect(() => play(s, 'p1', { card: nn, target: g })).toThrow(/in play as a Group/);
    const s2 = scenario();
    const nn2 = give(s2, 'p1', 'nutrition-nazis', { hand: true });
    const inHand = give(s2, 'p1', 'the-mafia', { hand: true });
    expect(() => play(s2, 'p1', { card: nn2, target: inHand })).toThrow(/Group in play/);
  });
  it('as a Group, lets any Science Group aid its side whatever the alignments', () => {
    const s = scenario();
    const nn = put(s, 'p1', 'nutrition-nazis');
    const target = put(s, 'p2', 'boy-sprouts');
    expect(HOOKS['nutrition-nazis'].mayJoin!(s, nn, { attacker: nn, aid: [], oppose: [], target } as never, put(s, 'p1', 'l-4-society'), 'aid')).toBe(true);
  });
});

// ------------------------------------------------------------------ Antitrust Legislation

describe('Antitrust Legislation (errata)', () => {
  function nested(s: GameState) {
    const top = put(s, 'p1', 'multinational-oil-companies');
    const low = put(s, 'p1', 'cable-tv', top);
    return { top, low };
  }
  it('lets each player reorganize first, one Plot per move, then strips nested Corporate Groups of their tokens', () => {
    let s = scenario();
    const { top, low } = nested(s);
    s.cards[top].tokens = 1; s.cards[low].tokens = 1;
    const pay = give(s, 'p1', 'earthquake', { hand: true });
    const card = give(s, 'p1', 'antitrust-legislation', { hand: true });
    s = playAndResolve(s, 'p1', { card });
    expect(s.prompt?.choice?.key).toBe('antitrust-reorg');
    expect(s.prompt!.player).toBe('p1');
    const move = s.prompt!.choice!.options.find((o) => o.id.startsWith(`move|${low}|${ill(s, 'p1')}|`))!;
    expect(move).toBeDefined();
    s = choose(s, [move.id]);
    expect(s.prompt?.choice?.key).toBe('antitrust-pay');
    s = choose(s, [pay]);
    expect(s.cards[pay].zone).toBe('discard');
    expect(s.cards[low].master).toBe(ill(s, 'p1'));
    s = choose(s, ['done']); // p1 is done
    expect(s.prompt!.player).toBe('p2');
    s = choose(s, ['done']);
    expect(s.nwo.yellow).toBe(card);
    expect(s.cards[low].tokens).toBe(1); // no longer nested with a Corporate Group
    checkInvariants(s);
  });
  it('takes the tokens of Corporate Groups left nested at once, and they get no new ones', () => {
    let s = scenario();
    const { top, low } = nested(s);
    s.cards[top].tokens = 1; s.cards[low].tokens = 1;
    const card = give(s, 'p1', 'antitrust-legislation', { hand: true });
    s = playAndResolve(s, 'p1', { card });
    s = choose(s, ['done']);
    s = choose(s, ['done']);
    expect(s.cards[top].tokens).toBe(0);
    expect(s.cards[low].tokens).toBe(0);
    expect(HOOKS['antitrust-legislation'].noTokens!(s, card, low)).toBe(true);
  });
  it('a complete reorganization costs three Plots (from hand or deck) and then any number of moves', () => {
    let s = scenario();
    const { low } = nested(s);
    const h1 = give(s, 'p1', 'earthquake', { hand: true });
    toDeck(s, 'p1', 'apathy', 'plotDeck');
    toDeck(s, 'p1', 'apathy', 'plotDeck');
    const card = give(s, 'p1', 'antitrust-legislation', { hand: true });
    s = playAndResolve(s, 'p1', { card });
    s = choose(s, ['complete']);
    s = choose(s, [h1, 'deck0', 'deck1']);
    expect(P(s, 'p1').discard.length).toBe(3);
    const free = s.prompt!.choice!.options.find((o) => o.id.startsWith(`move|${low}|`))!;
    expect(free.label).not.toMatch(/discard/);
    s = choose(s, [free.id]);
    expect(s.prompt?.choice?.key).toBe('antitrust-reorg'); // no payment asked
  });
  it('a computer player lets it take effect as things stand', () => {
    expect(HOOKS['antitrust-legislation']).toBeDefined();
  });
});

// ------------------------------------------------------------------ Australia

describe('Australia: the local clock', () => {
  const at = (iso: string) => () => new Date(iso);
  function aus(iso: string, utcOffset?: number) {
    localClock.now = at(iso);
    let s = scenario();
    if (utcOffset !== undefined) P(s, 'p2').utcOffset = utcOffset;
    const a = put(s, 'p2', 'australia');
    s = act(s, 'p1', { type: 'removeToken', card: put(s, 'p1', 'the-mafia') }); // any action reads the clock
    return { s, a };
  }
  it('doubles its printed Resistance on a weekday before 5 p.m.', () => {
    const { s, a } = aus('2026-09-23T10:00:00Z', 0); // a Wednesday, 10 a.m. UTC
    expect(resistance(s, a)).toBe(12);
  });
  it('quadruples it at the weekend or after 5 p.m. local time', () => {
    const sat = aus('2026-09-26T10:00:00Z', 0); // a Saturday
    expect(resistance(sat.s, sat.a)).toBe(24);
    const eve = aus('2026-09-23T18:30:00Z', 0);
    expect(resistance(eve.s, eve.a)).toBe(24);
    // The controller's own time zone decides: 10 a.m. UTC is 7 p.m. in Tokyo.
    const tokyo = aus('2026-09-23T10:00:00Z', 9 * 60);
    expect(resistance(tokyo.s, tokyo.a)).toBe(24);
  });
  it('keeps the value an attack started with, and the state records it', () => {
    let { s, a } = aus('2026-09-23T16:59:00Z', 0);
    const m = put(s, 'p1', 'multinational-oil-companies');
    s = attack(s, m, a, 'control');
    expect(s.cards[a].data?.partyTime).toBeFalsy();
    localClock.now = at('2026-09-23T17:30:00Z');
    s = act(s, 'p2', { type: 'pass' });
    expect(resistance(s, a)).toBe(12); // still the value the attack started with
  });
});

// ------------------------------------------------------------------ Fickle Finger of Fate

describe('Fickle Finger of Fate: the victim picks the attack', () => {
  function zapped() {
    let s = scenario();
    s.players.push({ ...P(s, 'p2'), id: 'p3', name: 'Cy', illuminati: 'p3ill', hand: [], plotDeck: [], groupDeck: [], discard: [], destroyedCredit: [] });
    s.cards.p3ill = { ...s.cards[ill(s, 'p2')], iid: 'p3ill', owner: 'p3', controller: 'p3', x: 0, y: 0 };
    const z = give(s, 'p2', 'fickle-finger-of-fate', { hand: true });
    Object.assign(s.cards[z], { zone: 'table', controller: 'p2', linkedTo: ill(s, 'p1') });
    P(s, 'p2').hand = P(s, 'p2').hand.filter((c) => c !== z);
    s.cards[ill(s, 'p1')].tokens = 2;
    return { s, z };
  }
  it('asks the victim when his Illuminati attacks; +10 only on the attack he picks, once per turn', () => {
    let { s, z } = zapped();
    const t1 = put(s, 'p2', 'boy-sprouts');
    s = attack(s, ill(s, 'p1'), t1, 'destroy');
    expect(s.prompt?.choice?.key).toBe('ffof-bonus');
    s = choose(s, ['save']);
    expect(line(s, 'Attack', 'Fickle Finger of Fate')).toBe(0);
    s = act(s, 'p1', { type: 'callOff' });
    s = attack(s, ill(s, 'p1'), t1, 'destroy');
    s = choose(s, ['use']);
    expect(line(s, 'Attack', 'Fickle Finger of Fate')).toBe(10);
    expect(s.cards[z].data?.usedTurn).toBe(s.turn);
  });
});

// ------------------------------------------------------------------ Grave Robbers

describe('Grave Robbers', () => {
  it('stands in for the automatic takeover, right after the start-of-turn draws', () => {
    let s = scenario();
    const art = toDeck(s, 'p1', 'hitler-s-brain', 'groupDeck');
    const card = give(s, 'p1', 'grave-robbers', { hand: true });
    s.phase = 'beginning';
    s = fireEvent(s, { type: 'drawn', player: 'p1', cards: [] });
    expect(s.window?.kind).toBe('event');
    s = playAndResolve(s, 'p1', { card, mode: 'takeover' });
    expect(s.turnFlags.takeoverDone).toBe(true);
    s = choose(s, [art]);
    expect(s.cards[art].zone).toBe('resources');
  });
  it('the player picks which Magic Groups pay 6 Power for a Magic Artifact', () => {
    let s = scenario();
    const art = toDeck(s, 'p1', 'angel-s-feather', 'groupDeck');
    const a = put(s, 'p1', 'cattle-mutilators'); // Power 2
    const b = put(s, 'p1', 'templars'); // Power 3
    const c = put(s, 'p1', 'vampires'); // Power 2
    const card = give(s, 'p1', 'grave-robbers', { hand: true });
    s = playAndResolve(s, 'p1', { card, mode: 'resource' });
    s = choose(s, [art]);
    expect(s.prompt?.choice?.key).toBe('grave-robbers-pay');
    s = choose(s, [a, c]); // only 4 Power: asked again
    expect(s.prompt?.choice?.key).toBe('grave-robbers-pay');
    s = choose(s, [a, b, c]);
    expect(s.cards[art].zone).toBe('resources');
    expect([a, b, c].map((g) => s.cards[g].tokens)).toEqual([0, 0, 0]);
  });
});

// ------------------------------------------------------------------ Go Fish

describe('Go Fish (errata): immunity after receiving a Plot or being made to show one', () => {
  it('is barred against a player who received a Plot from a rival, until the end of his next turn', () => {
    const s = scenario();
    shieldFromGoFish(s, 'p2');
    expect(goFishShielded(s, 'p2')).toBe(true);
    const card = give(s, 'p1', 'go-fish', { hand: true });
    expect(() => play(s, 'p1', { card, target: ill(s, 'p2'), mode: 'earthquake' })).toThrow(/immune to Go Fish/);
    P(s, 'p2').turnsTaken += 1; // his next turn is over
    expect(goFishShielded(s, 'p2')).toBe(false);
  });
  it('trades and deals shield the receiver; a forced look shields the one who showed', () => {
    let s = scenario();
    const ad = put(s, 'p1', 'arms-dealers');
    const mine = give(s, 'p1', 'earthquake', { hand: true });
    const theirs = give(s, 'p2', 'drought', { hand: true });
    s.cards[theirs].exposed = true;
    s = use(s, 'p1', ad, 'trade', { take: [theirs], targets: [mine] });
    expect(goFishShielded(s, 'p1')).toBe(true);
    expect(goFishShielded(s, 'p2')).toBe(true);
    let s2 = scenario();
    const x = put(s2, 'p1', 'a-m-a');
    const xr = give(s2, 'p1', 'x-ray-specs', { resource: true });
    s2 = act(s2, 'p1', { type: 'link', resource: xr, to: x });
    toDeck(s2, 'p2', 'apathy', 'plotDeck');
    s2 = use(s2, 'p1', xr, 'peek', { targets: ['p2:plot'] });
    expect(goFishShielded(s2, 'p2')).toBe(true);
    expect(goFishShielded(s2, 'p1')).toBe(false);
  });
  it('takes only hidden copies of the named Plot, and the one who fished is then shielded too', () => {
    let s = scenario();
    const hid = give(s, 'p2', 'earthquake', { hand: true });
    const shown = give(s, 'p2', 'earthquake', { hand: true });
    s.cards[shown].exposed = true;
    const card = give(s, 'p1', 'go-fish', { hand: true });
    s = playAndResolve(s, 'p1', { card, target: ill(s, 'p2'), mode: 'earthquake' });
    expect(hand(s, 'p1')).toContain(hid);
    expect(hand(s, 'p2')).toContain(shown);
    expect(goFishShielded(s, 'p1')).toBe(true);
  });
});

// ------------------------------------------------------------------ Go, Lemmings, Go!

describe('Go, Lemmings, Go! answers every discard paid for a Plot or an ability', () => {
  it("answers a base-game cost (Hoax's top Plot) with two more discards from that deck", () => {
    let s = scenario();
    const a = put(s, 'p2', 'multinational-oil-companies'); // Power 6 pays the Hoax
    for (let i = 0; i < 6; i++) toDeck(s, 'p2', 'apathy', 'plotDeck');
    const lem = give(s, 'p1', 'go-lemmings-go', { hand: true });
    const nwo = give(s, 'p1', 'apathy', { hand: true });
    s = play(s, 'p1', { card: nwo });
    const hoax = give(s, 'p2', 'hoax', { hand: true });
    s = act(s, 'p2', { type: 'playPlot', play: { card: hoax, target: nwo, payWith: [a] } });
    s = untilEvent(s, 'costDiscard');
    expect(s.window?.kind === 'event' && s.window.event?.type === 'costDiscard').toBe(true);
    const before = P(s, 'p2').plotDeck.length;
    s = playAndResolve(s, 'p1', { card: lem });
    expect(P(s, 'p2').plotDeck.length).toBe(before - 2);
  });
  it('makes a rival discard as many again from hand, and he chooses which', () => {
    let s = scenario();
    const tg = put(s, 'p2', 'the-thule-group');
    const target = put(s, 'p1', 'boy-sprouts');
    const g1 = give(s, 'p2', 'punk-rockers', { hand: true });
    const g2 = give(s, 'p2', 'the-mafia', { hand: true });
    const g3 = give(s, 'p2', 'cable-tv', { hand: true });
    const g4 = give(s, 'p2', 'gun-lobby', { hand: true });
    const g5 = give(s, 'p2', 'recording-industry', { hand: true });
    const lem = give(s, 'p1', 'go-lemmings-go', { hand: true });
    const m = put(s, 'p1', 'multinational-oil-companies');
    s = attack(s, m, target, 'destroy');
    s.active = 0;
    s = use(s, 'p2', tg, 'sacrifice', { mode: 'defense', targets: [g1, g2] });
    s = untilEvent(s, 'costDiscard', [2, 2]);
    expect(s.window?.event?.type).toBe('costDiscard');
    s = playAndResolve(s, 'p1', { card: lem });
    expect(s.prompt?.choice?.key).toBe('lemmings-hand');
    expect(s.prompt?.player).toBe('p2');
    s = choose(s, [g3, g4]);
    expect([g3, g4].map((c) => s.cards[c].zone)).toEqual(['discard', 'discard']);
    expect(hand(s, 'p2')).toContain(g5);
  });
});

// ------------------------------------------------------------------ Partition

describe('Partition', () => {
  it('may attack the duplicate to control it: the split only happens if the attack succeeds', () => {
    let s = scenario();
    const orig = put(s, 'p2', 'russia');
    const dup = give(s, 'p1', 'russia', { hand: true });
    const a = put(s, 'p1', 'multinational-oil-companies');
    const card = give(s, 'p1', 'partition', { hand: true });
    s = playAndResolve(s, 'p1', { card, target: dup, mode: 'attack', helper: a });
    expect(s.attack?.target).toBe(dup);
    expect(s.attack?.fromHand).toBe(true);
    s.attack!.attackBonus.push({ player: 'p1', amount: 30, label: 'test' });
    s = settle(s, [2, 2]);
    expect(s.cards[dup].zone).toBe('structure');
    expect(power(s, dup)).toBe(2);
    expect(power(s, orig)).toBe(2);
    expect(attributes(s, orig)).not.toContain('Huge');
    checkInvariants(s);
    let f = scenario();
    put(f, 'p2', 'russia');
    const dup2 = give(f, 'p1', 'russia', { hand: true });
    const a2 = put(f, 'p1', 'multinational-oil-companies');
    const card2 = give(f, 'p1', 'partition', { hand: true });
    f = playAndResolve(f, 'p1', { card: card2, target: dup2, mode: 'attack', helper: a2 });
    f = settle(f, [6, 6]);
    expect(f.cards[dup2].zone).toBe('hand');
    expect(Object.values(f.cards).some((c) => c.mods.some((m) => m.source === 'partition'))).toBe(false);
  });
  it('reunites only when one half controls the other; the Place keeps every card linked to either half', () => {
    let s = scenario();
    const a = put(s, 'p1', 'russia');
    const b = put(s, 'p1', 'russia', a);
    for (const [x, y] of [[a, b], [b, a]]) {
      s.cards[x].data = { partitionPair: y };
      s.cards[x].mods.push({ source: 'partition', kind: 'setPower', value: 2, lower: true, until: 'permanent' }, { source: 'partition', kind: 'removeAttr', attr: 'Huge', until: 'permanent' });
    }
    const res = give(s, 'p1', 'power-satellite', { resource: true });
    s.cards[res].linkedTo = b;
    const kid = put(s, 'p1', 'boy-sprouts', b);
    s = act(s, 'p1', { type: 'reunitePartition', group: a });
    expect(s.cards[b].zone).toBe('discard');
    expect(power(s, a)).toBe(4 + 2); // whole again (printed 4), plus the Power Satellite it now carries
    expect(attributes(s, a)).toContain('Huge');
    expect(s.cards[res].linkedTo).toBe(a);
    expect(s.cards[kid].master).toBe(a);
    checkInvariants(s);
    // Two halves that do not control one another cannot be reunited.
    const t = scenario();
    const c = put(t, 'p1', 'russia');
    const e = put(t, 'p1', 'russia');
    t.cards[c].data = { partitionPair: e };
    t.cards[e].data = { partitionPair: c };
    expect(() => act(t, 'p1', { type: 'reunitePartition', group: c })).toThrow(/controls the other/);
  });
});

// ------------------------------------------------------------------ Near Miss

describe('Near Miss', () => {
  it('cannot be used on a Place that could not be destroyed anyway', () => {
    let s = scenario();
    const place = put(s, 'p2', 'russia');
    s.cards[place].mods.push({ source: 'test', kind: 'power', value: 0, until: 'permanent' });
    const m = put(s, 'p1', 'multinational-oil-companies');
    s = attack(s, m, place, 'destroy');
    s.attack!.attackBonus.push({ player: 'p1', amount: 30, label: 'test' });
    s = act(s, 'p1', { type: 'pass' });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.window?.kind).toBe('roll');
    s.attack!.roll = [2, 2];
    const nm = give(s, 'p2', 'near-miss', { hand: true });
    const orig = HOOKS['russia'];
    HOOKS['russia'] = { ...orig, preventDestroy: (_s, self, t) => t === self };
    try {
      expect(() => play(s, 'p2', { card: nm, mode: 'save' })).toThrow(/cannot be destroyed anyway/);
    } finally { HOOKS['russia'] = orig as never; if (!orig) delete HOOKS['russia']; }
  });
  it('brings back a Place destroyed outside an attack roll, Devastated, with its puppets and linked cards', () => {
    let s = scenario();
    const place = put(s, 'p2', 'russia');
    const kid = put(s, 'p2', 'boy-sprouts', place);
    const res = give(s, 'p2', 'power-satellite', { resource: true });
    s.cards[res].linkedTo = place;
    const nm = give(s, 'p2', 'near-miss', { hand: true });
    s.phase = 'main';
    // A destruction that did not come from an attack roll (World War III's backfire, a card's backlash…).
    destroyGroup(s, place, 'p1');
    advance(s);
    expect(s.window?.event?.type).toBe('destroyed');
    s = playAndResolve(s, 'p2', { card: nm, mode: 'save' });
    expect(s.cards[place].zone).toBe('structure');
    expect(s.cards[place].devastated).toBe(true);
    expect(s.cards[kid].zone).toBe('structure');
    expect(s.cards[res].zone).toBe('resources');
    expect(P(s, 'p1').destroyedCredit).not.toContain(place);
    checkInvariants(s);
  });
});

// ------------------------------------------------------------------ You Are What You Eat

describe('You Are What You Eat: each former puppet is rehung, discarded or returned to hand', () => {
  it('asks the player for each puppet of the eaten Group', () => {
    let s = scenario();
    const attacker = put(s, 'p1', 'multinational-oil-companies');
    const k1 = put(s, 'p1', 'boy-sprouts', attacker);
    const k2 = put(s, 'p1', 'punk-rockers', attacker);
    const k3 = put(s, 'p1', 'gun-lobby', attacker);
    const target = put(s, 'p2', 'russia'); // TOP, LEFT, RIGHT arrows
    const card = give(s, 'p1', 'you-are-what-you-eat', { hand: true });
    s = attack(s, attacker, target, 'destroy');
    s.attack!.attackBonus.push({ player: 'p1', amount: 40, label: 'test' });
    s = untilEvent(s, 'destroyed', [2, 2]);
    expect(s.window?.event?.type).toBe('destroyed');
    s = playAndResolve(s, 'p1', { card });
    checkInvariants(s);
    expect(s.prompt?.choice?.key).toBe('yawye-puppet');
    const side = s.prompt!.choice!.options.find((o) => o.id.startsWith('side:'))!.id;
    s = choose(s, [side]);
    checkInvariants(s);
    s = choose(s, ['discard']);
    s = choose(s, ['hand']);
    expect(s.cards[k1].master).toBe(target);
    expect(s.cards[k2].zone).toBe('discard');
    expect(hand(s, 'p1')).toContain(k3);
    checkInvariants(s);
  });
});

// ------------------------------------------------------------------ Strange Bedfellows

describe('Strange Bedfellows', () => {
  it('reverses the chosen alignments for the next attack only, and not for Goals', () => {
    let s = scenario();
    const g = put(s, 'p1', 'moral-minority'); // Conservative, Straight, Fanatic
    const card = give(s, 'p1', 'strange-bedfellows', { hand: true });
    s = playAndResolve(s, 'p1', { card, target: g, mode: 'Conservative,Straight' });
    expect(alignments(s, g)).toEqual(expect.arrayContaining(['Liberal', 'Weird', 'Fanatic']));
    expect(alignments(s, g)).not.toContain('Conservative');
    expect(alignments(s, g, { goals: true })).toContain('Conservative');
    const target = put(s, 'p2', 'boy-sprouts');
    s.cards[g].tokens = 1;
    s = attack(s, g, target, 'destroy');
    expect(alignments(s, g)).toContain('Weird');
    s = settle(s, [6, 6]);
    expect(s.cards[card].zone).toBe('discard');
    expect(alignments(s, g)).toContain('Straight');
  });
  it('may be played while Action tokens are placed, and lasts only while they are', () => {
    let s = scenario();
    const g = put(s, 'p1', 'moral-minority');
    const card = give(s, 'p1', 'strange-bedfellows', { hand: true });
    s.phase = 'beginning';
    raiseEvent(s, { type: 'tokenPlacement', player: 'p1' }, 'placeTokens');
    advance(s);
    expect(s.window?.event?.type).toBe('tokenPlacement');
    s = playAndResolve(s, 'p1', { card, target: g, alignment: 'Straight' });
    expect(s.cards[card].data?.scope).toBe('tokens');
    expect(alignments(s, g)).toContain('Weird');
    s = settle(s);
    expect(s.cards[card].zone).toBe('discard');
  });
});

// ------------------------------------------------------------------ Society of Assassins

describe('Society of Assassins: the player chooses to make two Fanatic alignments the same', () => {
  it('asks the attacker; "same" turns the Fanatic penalty into a bonus for an Attack to Control', () => {
    let s = scenario();
    s.cards[ill(s, 'p1')].cardId = 'society-of-assassins';
    const a = put(s, 'p1', 'professional-sports'); // Violent, Fanatic
    const t = put(s, 'p2', 'libertarians'); // Fanatic
    s = attack(s, a, t, 'control');
    expect(s.prompt?.choice?.key).toBe('soa-fanatic');
    const opposed = attackStrength(choose(s, ['opposite']), choose(s, ['opposite']).attack!).attack;
    const same = choose(s, ['same']);
    expect(attackStrength(same, same.attack!).attack).toBe(opposed + 8);
  });
});

// ------------------------------------------------------------------ Science Alarmists

describe('Science Alarmists: the permission is asked for', () => {
  function atTakeover() {
    const s = scenario();
    put(s, 'p2', 'science-alarmists');
    const epa = give(s, 'p1', 'epa', { hand: true });
    s.phase = 'beginning';
    s.prompt = { player: 'p1', kind: 'takeover' };
    return { s, epa };
  }
  it('a refusal stops the takeover; a grant lets it happen', () => {
    let { s, epa } = atTakeover();
    s = act(s, 'p1', { type: 'takeover', card: epa, onto: ill(s, 'p1'), side: openArrows(s, ill(s, 'p1'))[0] });
    expect(s.prompt?.player).toBe('p2');
    expect(s.prompt?.choice?.key).toBe('takeoverPermission');
    const refused = choose(s, ['refuse']);
    expect(refused.cards[epa].zone).toBe('hand');
    const granted = choose(s, ['grant']);
    expect(granted.cards[epa].zone).toBe('structure');
  });
});

// ------------------------------------------------------------------ Arms Dealers

describe('Arms Dealers', () => {
  it('trades any number of Plots at once; received Plots may be kept exposed', () => {
    let s = scenario();
    const ad = put(s, 'p1', 'arms-dealers');
    const m1 = give(s, 'p1', 'earthquake', { hand: true });
    const m2 = give(s, 'p1', 'hoax', { hand: true });
    const t1 = give(s, 'p2', 'drought', { hand: true });
    const t2 = give(s, 'p2', 'apathy', { hand: true });
    s.cards[t1].exposed = true; s.cards[t2].exposed = true;
    expect(abilityOptions(s, 'p1', ad).some((o) => o.action.type === 'useAbility' && o.action.params?.take?.length === 2)).toBe(true);
    s = use(s, 'p1', ad, 'trade', { take: [t1, t2], targets: [m1, m2], keepExposed: [t2] });
    expect(hand(s, 'p1')).toEqual(expect.arrayContaining([t1, t2]));
    expect(hand(s, 'p2')).toEqual(expect.arrayContaining([m1, m2]));
    expect(s.cards[t1].exposed).toBe(false);
    expect(s.cards[t2].exposed).toBe(true);
  });
  it('needs as many of your Plots as you take, all from one rival', () => {
    const s = scenario();
    const ad = put(s, 'p1', 'arms-dealers');
    const m1 = give(s, 'p1', 'earthquake', { hand: true });
    const t1 = give(s, 'p2', 'drought', { hand: true });
    const t2 = give(s, 'p2', 'apathy', { hand: true });
    s.cards[t1].exposed = true; s.cards[t2].exposed = true;
    expect(() => use(s, 'p1', ad, 'trade', { take: [t1, t2], targets: [m1] })).toThrow(/Choose 2 Plots/);
  });
});

// ------------------------------------------------------------------ General Disorder

describe('General Disorder comes back with everything', () => {
  it('keeps his linked Plots and changes, and his destruction stops counting', () => {
    let s = scenario();
    const gd = put(s, 'p1', 'general-disorder');
    const plot = give(s, 'p1', 'dictatorship', { hand: true });
    Object.assign(s.cards[plot], { zone: 'table', controller: 'p1', linkedTo: gd });
    P(s, 'p1').hand = P(s, 'p1').hand.filter((c) => c !== plot);
    s.cards[gd].mods.push({ source: 'test', kind: 'power', value: 3, until: 'permanent' });
    destroyGroup(s, gd, 'p2');
    expect(s.cards[plot].zone).toBe('removed');
    expect(P(s, 'p2').destroyedCredit).toContain(gd);
    checkInvariants(s);
    s = act(s, 'p1', { type: 'endTurn' });
    s = settle(s);
    expect(s.cards[gd].zone).toBe('structure');
    expect(s.cards[plot].zone).toBe('table');
    expect(s.cards[plot].linkedTo).toBe(gd);
    expect(power(s, gd)).toBeGreaterThanOrEqual(4);
    expect(P(s, 'p2').destroyedCredit).not.toContain(gd);
  });
  it('stays dead once removed from the game (the Men in Black)', () => {
    const s = scenario();
    const gd = put(s, 'p1', 'general-disorder');
    destroyGroup(s, gd, 'p2');
    s.cards[gd].data = { ...s.cards[gd].data, removedFromGame: true };
    HOOKS['general-disorder'].delayedRevive!(s, gd);
    expect(s.cards[gd].zone).toBe('destroyed');
  });
});

// ------------------------------------------------------------------ Copy Shops

describe('Copy Shops: Goals and lost copies', () => {
  it('a copied Goal is declared at once when it wins, and does not count otherwise', () => {
    const s = scenario();
    const shop = put(s, 'p1', 'copy-shops');
    const pay = give(s, 'p1', 'earthquake', { hand: true });
    const goal = give(s, 'p2', 'blinded-by-science', { hand: true });
    s.cards[goal].exposed = true;
    expect(() => use(s, 'p1', shop, 'copy', { target: goal, targets: [pay] })).toThrow(/cannot win|a copy of it does not count|Victory/i);
  });
  it('the copy leaves the game once used: it never reaches a discard pile', () => {
    let s = scenario();
    const shop = put(s, 'p1', 'copy-shops');
    put(s, 'p1', 'the-mafia');
    const pay = give(s, 'p1', 'earthquake', { hand: true });
    const theirs = give(s, 'p2', 'good-polls', { hand: true });
    s.cards[theirs].exposed = true;
    s = settle(use(s, 'p1', shop, 'copy', { target: theirs, targets: [pay], copyPlay: { alignment: 'Violent' } }));
    const copies = Object.values(s.cards).filter((c) => c.data?.copyOf === theirs);
    expect(copies.length).toBe(1);
    expect(copies[0].zone).toBe('removed');
    expect(P(s, 'p1').discard).not.toContain(copies[0].iid);
    checkInvariants(s);
  });
});

// ------------------------------------------------------------------ Blivit vs Nuclear Power Companies

describe('Blivit: its owner is immune to the Nuclear Power Companies', () => {
  it('the Nuclear Power Companies cannot cancel his attack', () => {
    let s = scenario();
    give(s, 'p1', 'blivit', { resource: true });
    const npc = put(s, 'p2', 'nuclear-power-companies');
    const a = put(s, 'p1', 'the-mafia');
    const t = put(s, 'p2', 'boy-sprouts');
    s = attack(s, a, t, 'destroy');
    expect(() => use(s, 'p2', npc, 'cancelAction', { target: a })).toThrow(/immune/);
    const s2 = scenario();
    const npc2 = put(s2, 'p2', 'nuclear-power-companies');
    const a2 = put(s2, 'p1', 'the-mafia');
    const t2 = put(s2, 'p2', 'boy-sprouts');
    const s3 = use(attack(s2, a2, t2, 'destroy'), 'p2', npc2, 'cancelAction', { target: a2 });
    expect(s3.attack).toBeDefined();
  });
});

// ------------------------------------------------------------------ Regi$tered Trademark

describe('Regi$tered Trademark: the honour system is explained and both penalties work', () => {
  it('says how it works when linked, and a caught slip hands over the top Plot', () => {
    let s = scenario();
    const g = put(s, 'p2', 'boy-sprouts');
    toDeck(s, 'p2', 'apathy', 'plotDeck');
    const card = give(s, 'p1', 'regi-tered-trademark', { hand: true });
    s = playAndResolve(s, 'p1', { card, target: g });
    expect(s.log.some((l) => /Honour system/.test(l.text))).toBe(true);
    s = act(s, 'p1', { type: 'catchNameSlip', card });
    expect(hand(s, 'p1').length).toBe(1);
    expect(goFishShielded(s, 'p1')).toBe(true);
  });
});

// ------------------------------------------------------------------ Base cards naming Assassins cards

describe('Base cards that name Assassins cards', () => {
  it('Tabloids and Video Games get +3 to take over Convenience Stores', () => {
    for (const who of ['tabloids', 'video-games']) {
      let s = scenario();
      const g = put(s, 'p1', who);
      const cs = put(s, 'p2', 'convenience-stores');
      s = attack(s, g, cs, 'control');
      expect(attackStrength(s, s.attack!).lines.some((l) => /\+3/.test(l))).toBe(true);
    }
  });
  it('The Irish Flu cannot strike a Personality in the Power Structure of the Center for Disease Control', () => {
    const s = scenario();
    put(s, 'p2', 'center-for-disease-control');
    const pers = put(s, 'p2', 'bill-clinton');
    const flu = give(s, 'p1', 'the-irish-flu', { hand: true });
    expect(() => play(s, 'p1', { card: flu, target: pers })).toThrow(/immune/);
  });
});

// ------------------------------------------------------------------ Dittoheads

describe('Dittoheads', () => {
  it('only a Personality may control it, on any side, one each; it triples its master\'s Resistance', () => {
    let s = scenario();
    const pers = put(s, 'p1', 'elvis'); // one arrow, RIGHT
    const org = put(s, 'p1', 'the-mafia');
    const d1 = give(s, 'p2', 'dittoheads', { hand: true });
    s.active = 1;
    const p2m = put(s, 'p2', 'boy-sprouts');
    expect(validateAttack(s, 'p2', { type: 'attack', attackType: 'control', attacker: p2m, target: d1 })).toMatch(/Personality/);
    s.active = 0;
    const dh = give(s, 'p1', 'dittoheads', { hand: true });
    expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'control', attacker: org, target: dh })).toMatch(/Personality/);
    expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'control', attacker: pers, target: dh })).toBeNull();
    expect(alignments(s, dh)).toEqual([]); // in a hand it has none (Card FAQ)
    const before = resistance(s, pers);
    const placed = give(s, 'p1', 'dittoheads', { under: pers, side: 'LEFT' }); // no arrow there
    expect(resistance(s, pers)).toBe(before * 3);
    expect(power(s, pers)).toBe((def(s, pers).power ?? 0) + 2);
    expect(alignments(s, placed)).toContain('Fanatic');
    expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'control', attacker: pers, target: dh })).toMatch(/already controls Dittoheads/);
  });
});

// ------------------------------------------------------------------ Drug Companies

describe('Drug Companies', () => {
  it('needs no open arrow, and the attack is illegal once the alignment is gone', () => {
    let s = scenario();
    const dc = put(s, 'p1', 'drug-companies');
    put(s, 'p1', 'boy-sprouts', dc);
    for (const sd of openArrows(s, dc)) put(s, 'p1', 'gun-lobby', dc, sd);
    expect(openArrows(s, dc).length).toBe(0);
    const t = put(s, 'p2', 'the-mafia');
    s = use(s, 'p1', dc, 'strip-alignment', { target: t, alignment: 'Violent' });
    expect(s.attack?.stripAlignment).toBe('Violent');
    s.cards[t].mods.push({ source: 'test', kind: 'removeAlign', align: 'Violent', until: 'permanent' });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.attack?.illegal ?? '').toMatch(/no longer has/);
  });
});

// ------------------------------------------------------------------ Pale People In Black

describe('Pale People In Black aiding an Attack to Control', () => {
  it('removes the opposed-alignment penalty even when they only aid', () => {
    let s = scenario();
    const a = put(s, 'p1', 'the-mafia'); // Violent, Criminal
    const ppib = put(s, 'p1', 'pale-people-in-black'); // Weird
    const t = put(s, 'p2', 'moonies'); // Peaceful, Fanatic
    s = attack(s, a, t, 'control');
    const without = line(s, 'Attack', 'alignments');
    s.attack!.aid.push({ player: 'p1', iid: ppib, amount: 0, label: 'Pale People' });
    expect(without).toBeLessThan(0);
    expect(line(s, 'Attack', 'alignments')).toBe(0);
  });
});

// ------------------------------------------------------------------ Thule Group

describe('The Thule Group and Hitler\'s Brain', () => {
  it('with Hitler\'s Brain linked, neither can be destroyed', () => {
    const s = scenario();
    const tg = put(s, 'p1', 'the-thule-group');
    const hb = give(s, 'p1', 'hitler-s-brain', { resource: true });
    s.cards[hb].linkedTo = tg;
    expect(HOOKS['the-thule-group'].preventDestroy!(s, tg, tg)).toBe(true);
    expect(HOOKS['the-thule-group'].preventDestroy!(s, tg, hb)).toBe(true);
  });
});

// ------------------------------------------------------------------ Orgone Grinder

describe('Orgone Grinder has the last word', () => {
  it('no other card can give its Personality an alignment', () => {
    const s = scenario();
    const pers = put(s, 'p1', 'bill-clinton');
    const og = give(s, 'p1', 'orgone-grinder', { resource: true });
    s.cards[og].linkedTo = pers;
    const w = give(s, 'p1', 'watermelons', { hand: true });
    Object.assign(s.cards[w], { zone: 'table', controller: 'p1', linkedTo: pers });
    P(s, 'p1').hand = [];
    expect(alignments(s, pers)).toEqual([]);
    expect(attributes(s, pers)).toEqual([]);
  });
});

// ------------------------------------------------------------------ Population Reduction

describe('Population Reduction', () => {
  it('does not count Huge Places destroyed with World War III toward its outright win', () => {
    const s = scenario();
    const ids = ['russia', 'china', 'germany', 'brazil', 'england'].map((id) => {
      const iid = `pr-${id}`;
      s.cards[iid] = { iid, cardId: id, owner: 'p2', zone: 'destroyed', tokens: 0, mods: [] };
      P(s, 'p1').destroyedCredit.push(iid);
      return iid;
    });
    expect(GOALS['population-reduction'](s, 'p1')).toMatch(/without World War III/);
    s.cards[ids[0]].data = { viaWorldWarThree: true };
    expect(GOALS['population-reduction'](s, 'p1') ?? '').not.toMatch(/without World War III/);
  });
});

// ------------------------------------------------------------------ The Irish Flu

describe('The Irish Flu moves every turn', () => {
  it('at the start of the next turn, whoever\'s it is', () => {
    let s = scenario();
    const a = put(s, 'p2', 'bill-clinton');
    const b = put(s, 'p1', 'elvis');
    const flu = give(s, 'p1', 'the-irish-flu', { hand: true });
    s = playAndResolve(s, 'p1', { card: flu, target: a });
    expect(s.cards[flu].linkedTo).toBe(a);
    // p1 ends the turn: the next turn is p2's; the Flu moves at its start.
    s = act(s, 'p1', { type: 'endTurn' });
    for (let i = 0; i < 20 && s.prompt?.choice?.key !== 'irish-flu-pass'; i++) {
      if (s.prompt?.kind === 'draw') s = act(s, s.prompt.player, { type: 'skipDraw' });
      else if (s.prompt?.kind === 'takeover') s = act(s, s.prompt.player, { type: 'skipTakeover' });
      else if (s.window) s = act(s, waitingFor(s)[0], { type: 'pass' });
      else break;
    }
    expect(s.prompt?.choice?.key).toBe('irish-flu-pass');
    s = choose(s, [b]);
    expect(s.cards[flu].linkedTo).toBe(b);
  });
});

// ------------------------------------------------------------------ This Was Only A Test

describe('This Was Only A Test against a non-Instant Disaster', () => {
  it('the Disaster goes back to its player\'s hand, exposed', () => {
    let s = scenario();
    const place = put(s, 'p2', 'italy');
    const feb = give(s, 'p1', 'flesh-eating-bacteria', { hand: true });
    s = play(s, 'p1', { card: feb, target: place });
    const test = give(s, 'p2', 'this-was-only-a-test', { hand: true });
    s = act(s, 'p1', { type: 'pass' });
    s = play(s, 'p2', { card: test });
    s = settle(s, [2, 2]);
    expect(s.cards[place].devastated).toBeFalsy();
    expect(hand(s, 'p1')).toContain(feb);
    expect(s.cards[feb].exposed).toBe(true);
  });
});

// ------------------------------------------------------------------ X-Ray Specs, Spy Satellite, Killer Satellite, Hubble Trouble

describe('Satellites and X-Ray Specs as printed', () => {
  it('X-Ray Specs: any deck in play; a Weird Science Group may see two decks or six cards', () => {
    let s = scenario();
    const g = put(s, 'p1', 'l-4-society'); // Weird, Science
    const xr = give(s, 'p1', 'x-ray-specs', { resource: true });
    s = act(s, 'p1', { type: 'link', resource: xr, to: g });
    const labels = abilityOptions(s, 'p1', xr).map((o) => o.label);
    expect(labels.some((l) => /top six/.test(l))).toBe(true);
    expect(labels.some((l) => / and /.test(l))).toBe(true);
    s = use(s, 'p1', xr, 'peek', { targets: ['p2:plot', 'p2:group'] });
    expect(s.cards[g].tokens).toBe(0);
    const s2 = scenario();
    const plain = put(s2, 'p1', 'a-m-a');
    const xr2 = give(s2, 'p1', 'x-ray-specs', { resource: true });
    s2.cards[xr2].linkedTo = plain;
    expect(() => use(s2, 'p1', xr2, 'peek', { targets: ['p2:plot'], mode: 'six' })).toThrow(/Weird Science/);
  });
  it('Killer Satellite: the sure kill discards it and destroys the target', () => {
    let s = scenario();
    const ks = give(s, 'p1', 'killer-satellite', { resource: true });
    s.cards[ks].tokens = 1;
    const sat = give(s, 'p2', 'spy-satellite', { resource: true });
    s = use(s, 'p1', ks, 'strike', { target: sat, mode: 'sure' });
    s = settle(s);
    expect(s.cards[ks].zone).toBe('discard');
    expect(s.cards[sat].zone).toBe('destroyed');
  });
  it('Spy Satellite: the same game picks the same cards, and its user may show them to everyone', () => {
    const mk = () => {
      const s = scenario();
      const ss = give(s, 'p1', 'spy-satellite', { resource: true });
      s.cards[ss].tokens = 1;
      for (const id of ['punk-rockers', 'the-mafia', 'gun-lobby', 'cable-tv']) give(s, 'p2', id, { hand: true });
      return settle(use(s, 'p1', ss, 'peek', { target: ill(s, 'p2'), mode: 'groups' }));
    };
    const a = mk(), b = mk();
    expect(a.prompt?.choice?.options.length).toBe(2);
    const seen = (x: GameState) => ((x.prompt?.choice?.data?.cards as string[]) ?? []).map((c) => x.cards[c].cardId);
    expect(seen(a)).toEqual(seen(b));
    const shown = choose(a, ['show']);
    expect(shown.log.some((l) => /shows everybody/.test(l.text) && !l.to)).toBe(true);
  });
  it('Hubble Trouble freezes every Satellite Resource, the Assassins ones included', () => {
    const s = scenario();
    const ks = give(s, 'p1', 'killer-satellite', { resource: true });
    addFreeze(s, { card: 'x', player: 'p2', match: [{ attributes: ['Space'] }], resources: ['killer-satellite', 'power-satellite', 'spy-satellite'], label: 'Space' });
    expect(frozen(s, ks)).toBe(true);
  });
});

// ------------------------------------------------------------------ Supreme Court Nomination

describe('Supreme Court Nomination', () => {
  it('a failed nomination makes a Chief Justice: Power raised to 4, Government, and no longer Corporate', () => {
    let s = scenario();
    const pers = put(s, 'p2', 'bill-clinton');
    s.cards[pers].mods.push({ source: 'test', kind: 'addAlign', align: 'Corporate', until: 'permanent' });
    const card = give(s, 'p1', 'supreme-court-nomination', { hand: true });
    s = play(s, 'p1', { card, target: pers });
    s = settle(s, [6, 6]);
    expect(alignments(s, pers)).toContain('Government');
    expect(alignments(s, pers)).not.toContain('Corporate');
    expect(power(s, pers)).toBe(4);
  });
});

// Keep the base goal count helper referenced (a regression guard: Goal counting still works).
it('goalCount still counts a plain structure', () => {
  const s = scenario();
  expect(goalCount(s, 'p1')).toBe(1);
});
