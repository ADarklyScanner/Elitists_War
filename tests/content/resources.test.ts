// Resource cards: main effect and at least one restriction for each.
import { describe, expect, it } from 'vitest';
import {
  applyAction, attackStrength, canEnterPlay, destroyGroup, globalPower, handLimit, participants, plotsInHand, power, resistance,
  takeoverOptions, waitingFor, alignments, attributes, startInstantAttack, type Action, type GameState,
} from '../../src/engine';
import { rollDie } from '../../src/engine/rng';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, i: number) => s.players[i].illuminati;
const use = (s: GameState, pl: string, card: string, ability: string, params: Record<string, unknown> = {}) =>
  act(s, pl, { type: 'useAbility', card, ability, params });

/** Pass for everyone until the attack is over, forcing the dice if given. */
function resolve(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = applyAction(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** Pass until the roll window opens (the attack must be strong enough to roll). */
function toRoll(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 10 && s.window?.kind === 'attack'; i++) s = applyAction(s, waitingFor(s)[0], { type: 'pass' });
  expect(s.window?.kind).toBe('roll');
  if (dice) s.attack!.roll = dice;
  return s;
}
/** End turns until `pid` starts a new main phase. */
function nextTurnOf(s: GameState, pid: string): GameState {
  s = act(s, s.players[s.active].id, { type: 'endTurn' });
  for (let i = 0; i < 60; i++) {
    if (s.prompt) {
      const pl = s.prompt.player;
      if (s.prompt.kind === 'takeover') s = act(s, pl, { type: 'skipTakeover' });
      else if (s.prompt.kind === 'choose') s = act(s, pl, { type: 'choose', ids: s.prompt.choice!.options.slice(0, s.prompt.choice!.min).map((o) => o.id) });
      else s = act(s, pl, { type: 'discard', cards: plotsInHand(s, pl).slice(handLimit(s, pl)) });
    } else if (s.window) s = act(s, waitingFor(s)[0], { type: 'pass' });
    else if (s.phase === 'main' && s.players[s.active].id === pid) return s;
    else s = act(s, s.players[s.active].id, { type: 'endTurn' });
  }
  throw new Error('turn did not come round');
}
/** Attack strength with and without a card in play. */
function diff(s: GameState, card: string) {
  const without = structuredClone(s);
  without.cards[card].zone = 'discard';
  const a = attackStrength(s, s.attack!), b = attackStrength(without, without.attack!);
  return { attack: a.attack - b.attack, defense: a.defense - b.defense };
}
const attack = (s: GameState, pl: string, attacker: string, target: string, attackType: 'control' | 'destroy') =>
  act(s, pl, { type: 'attack', attackType, attacker, target });
const boost = (s: GameState, pl: string, n = 30) => { s.attack!.attackBonus.push({ player: pl, amount: n, label: 'test' }); return s; };
/** Everyone waiting in the current window passes once. */
function passAll(s: GameState): GameState {
  for (const pl of waitingFor(s)) if (s.window && !s.prompt && waitingFor(s).includes(pl)) s = act(s, pl, { type: 'pass' });
  return s;
}
const choose = (s: GameState, pl: string, ids: string[]) => act(s, pl, { type: 'choose', ids });
const rerolls = (s: GameState) => s.attack!.plays.filter((p) => p.effect.t === 'reroll').length;

describe("Angel's Feather", () => {
  it('re-rolls a failed Attack to Control by the linked Peaceful Group, once', () => {
    let s = scenario();
    const r = give(s, 'p1', 'angel-s-feather', { resource: true });
    const ama = give(s, 'p1', 'a-m-a', { under: ill(s, 0), side: 'BOTTOM' });
    const tgt = give(s, 'p1', 'anti-war-activists', { hand: true });
    s = act(s, 'p1', { type: 'link', resource: r, to: ama });
    s = boost(attack(s, 'p1', ama, tgt, 'control'), 'p1', 5);
    s = toRoll(s, [6, 6]);
    s = passAll(s);
    // Re-rolled on its own; the roll window opens again for responses to the new roll.
    expect(s.window?.kind).toBe('roll');
    expect(rerolls(s)).toBe(1);
    s.attack!.plays.find((p) => p.effect.t === 'reroll')!.effect = { t: 'reroll', dice: [6, 6] };
    s = passAll(s);
    expect(s.attack).toBeUndefined();
    expect(s.cards[tgt].zone).toBe('hand');
  });
  it('re-rolls a successful attack on your Peaceful Group', () => {
    let s = scenario();
    give(s, 'p2', 'angel-s-feather', { resource: true });
    const ama = give(s, 'p2', 'a-m-a', { under: ill(s, 1), side: 'BOTTOM' });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    s = passAll(toRoll(boost(attack(s, 'p1', g, ama, 'destroy'), 'p1', 30), [1, 1]));
    expect(s.window?.kind).toBe('roll');
    expect(rerolls(s)).toBe(1);
  });
  it('must be linked to a Peaceful Group and does not re-roll a success', () => {
    let s = scenario();
    const r = give(s, 'p1', 'angel-s-feather', { resource: true });
    const batf = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'BOTTOM' });
    expect(() => act(s, 'p1', { type: 'link', resource: r, to: batf })).toThrow(/cannot be linked/);
    const ama = give(s, 'p1', 'a-m-a', { under: ill(s, 0), side: 'TOP' });
    const tgt = give(s, 'p1', 'anti-war-activists', { hand: true });
    s = act(s, 'p1', { type: 'link', resource: r, to: ama });
    s = passAll(toRoll(boost(attack(s, 'p1', ama, tgt, 'control'), 'p1', 5), [1, 1]));
    expect(s.attack).toBeUndefined();
    expect(s.cards[tgt].zone).toBe('structure');
  });
});

describe('Ark of the Covenant', () => {
  it('destroys the Group that destroys the named Group, for your Goals', () => {
    let s = scenario();
    const r = give(s, 'p1', 'ark-of-the-covenant', { resource: true });
    const batf = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'BOTTOM' });
    const mafia = give(s, 'p2', 'the-mafia', { under: ill(s, 1), side: 'BOTTOM' });
    s = use(s, 'p1', r, 'name', { target: batf });
    s.active = 1;
    s = resolve(boost(attack(s, 'p2', mafia, batf, 'destroy'), 'p2', 40), [1, 1]);
    expect(s.cards[batf].zone).toBe('destroyed');
    expect(s.cards[mafia].zone).toBe('destroyed');
    expect(s.players[0].destroyedCredit).toContain(mafia);
  });
  it('destroyed by an Illuminati: its owner chooses which Group to lose', () => {
    let s = scenario();
    const r = give(s, 'p1', 'ark-of-the-covenant', { resource: true });
    const batf = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'BOTTOM' });
    const mafia = give(s, 'p2', 'the-mafia', { under: ill(s, 1), side: 'BOTTOM' });
    const sharks = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'TOP' });
    s = use(s, 'p1', r, 'name', { target: batf });
    s.active = 1;
    s = resolve(boost(attack(s, 'p2', ill(s, 1), batf, 'destroy'), 'p2', 40), [1, 1]);
    expect(s.cards[batf].zone).toBe('destroyed');
    expect(s.prompt?.kind).toBe('choose');
    expect(s.prompt!.player).toBe('p2');
    expect(s.prompt!.choice!.options.map((o) => o.id).sort()).toEqual([mafia, sharks].sort());
    expect(() => choose(s, 'p1', [mafia])).toThrow();
    s = choose(s, 'p2', [mafia]);
    expect(s.cards[mafia].zone).toBe('destroyed');
    expect(s.cards[sharks].zone).toBe('structure');
    expect(s.players[0].destroyedCredit).toContain(mafia);
  });
  it('an Assassination is directed by the Illuminati: its player chooses a Group to lose', () => {
    let s = scenario();
    const r = give(s, 'p1', 'ark-of-the-covenant', { resource: true });
    const nancy = give(s, 'p1', 'nancy-reagan', { under: ill(s, 0), side: 'BOTTOM' });
    const mafia = give(s, 'p2', 'the-mafia', { under: ill(s, 1), side: 'BOTTOM' });
    const sharks = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'TOP' });
    const bomb = give(s, 'p2', 'car-bomb', { hand: true });
    s = use(s, 'p1', r, 'name', { target: nancy });
    s.active = 1;
    s = act(s, 'p2', { type: 'playPlot', play: { card: bomb, target: nancy, helper: mafia } });
    s = resolve(s, [1, 1]);
    expect(s.cards[nancy].zone).toBe('destroyed');
    expect(s.prompt?.kind).toBe('choose');
    expect(s.prompt!.player).toBe('p2');
    expect(s.prompt!.choice!.options.map((o) => o.id).sort()).toEqual([mafia, sharks].sort());
    s = choose(s, 'p2', [sharks]);
    expect(s.cards[sharks].zone).toBe('destroyed');
    expect(s.players[0].destroyedCredit).toContain(sharks);
  });
  it('a Plot that destroys the named Group directly counts as its player\'s Illuminati too', () => {
    const s = scenario();
    const r = give(s, 'p1', 'ark-of-the-covenant', { resource: true });
    const batf = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'BOTTOM' });
    give(s, 'p2', 'the-mafia', { under: ill(s, 1), side: 'BOTTOM' });
    s.cards[r].note = batf;
    destroyGroup(s, batf, 'p2');
    expect(s.prompt?.player).toBe('p2');
  });
  it('can only name your own Group', () => {
    const s = scenario();
    const r = give(s, 'p1', 'ark-of-the-covenant', { resource: true });
    const mafia = give(s, 'p2', 'the-mafia', { under: ill(s, 1), side: 'BOTTOM' });
    expect(() => use(s, 'p1', r, 'name', { target: mafia })).toThrow(/your Power Structure/);
  });
});

describe('Bigfoot', () => {
  it('+3 to control Green Groups, not others', () => {
    let s = scenario();
    const r = give(s, 'p1', 'bigfoot', { resource: true });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const druids = give(s, 'p1', 'druids', { hand: true });
    const other = give(s, 'p1', 'anti-war-activists', { hand: true });
    expect(diff(attack(s, 'p1', g, druids, 'control'), r).attack).toBe(3);
    expect(diff(attack(s, 'p1', g, other, 'control'), r).attack).toBe(0);
  });
  it('uses its action to cancel a Media Group, but not other Groups', () => {
    let s = scenario();
    const r = give(s, 'p2', 'bigfoot', { resource: true });
    s.cards[r].tokens = 1;
    const comic = give(s, 'p1', 'comic-books', { under: ill(s, 0), side: 'BOTTOM' });
    const batf = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'TOP' });
    const tgt = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'BOTTOM' });
    const s2 = attack(s, 'p1', batf, tgt, 'destroy');
    expect(() => use(s2, 'p2', r, 'cancel', { target: batf })).toThrow(/Media/);
    s = attack(s, 'p1', comic, tgt, 'destroy');
    s = use(s, 'p2', r, 'cancel', { target: comic });
    expect(s.cards[r].tokens).toBe(0);
    s = resolve(s);
    expect(s.log.some((l) => /cancelled/.test(l.text))).toBe(true);
  });
  it('cancels the Relief a rival\'s Media Group sends', () => {
    let s = scenario();
    const r = give(s, 'p2', 'bigfoot', { resource: true });
    s.cards[r].tokens = 1;
    const hawaii = give(s, 'p1', 'hawaii', { under: ill(s, 0), side: 'BOTTOM' });
    const media = give(s, 'p1', 'big-media', { under: ill(s, 0), side: 'TOP' });
    s.cards[hawaii].devastated = true;
    // Announced in the main phase: Bigfoot answers in the response window before the Relief lands.
    s = act(s, 'p1', { type: 'relief', place: hawaii, payWith: [media] });
    expect(s.window?.event?.type).toBe('action');
    expect(s.cards[hawaii].devastated).toBe(true);
    s = use(s, 'p2', r, 'cancel', { target: media });
    while (s.window) s = act(s, waitingFor(s)[0], { type: 'pass' });
    expect(s.cards[hawaii].devastated).toBe(true);
    expect(s.cards[media].tokens).toBe(0);
    expect(s.cards[r].tokens).toBe(0);
    expect(s.prompt).toBeUndefined();
  });
  it('is offered to cancel Relief sent while another window is open', () => {
    let s = scenario();
    const r = give(s, 'p2', 'bigfoot', { resource: true });
    s.cards[r].tokens = 1;
    const hawaii = give(s, 'p1', 'hawaii', { under: ill(s, 0), side: 'BOTTOM' });
    const media = give(s, 'p1', 'big-media', { under: ill(s, 0), side: 'TOP' });
    s.cards[hawaii].devastated = true;
    s = act(s, 'p1', { type: 'endTurn' });
    expect(s.window?.kind).toBe('endOfTurn');
    s = act(s, 'p1', { type: 'relief', place: hawaii, payWith: [media] });
    expect(s.prompt?.player).toBe('p2');
    s = choose(s, 'p2', [media]);
    expect(s.cards[hawaii].devastated).toBe(true);
    expect(s.cards[r].tokens).toBe(0);
  });
  it('cancels a rival Media Group\'s move outside an attack, but not a move paid by another Group', () => {
    let s = scenario();
    const r = give(s, 'p2', 'bigfoot', { resource: true });
    s.cards[r].tokens = 1;
    const media = give(s, 'p1', 'big-media', { under: ill(s, 0), side: 'BOTTOM' });
    const fbi = give(s, 'p1', 'fbi', { under: ill(s, 0), side: 'TOP' });
    const plain = act(s, 'p1', { type: 'move', group: fbi, onto: ill(s, 0), side: 'LEFT', payWith: fbi });
    expect(plain.window).toBeUndefined();
    expect(plain.cards[fbi].side).toBe('LEFT');
    s = act(s, 'p1', { type: 'move', group: media, onto: ill(s, 0), side: 'RIGHT', payWith: media });
    expect(s.window?.event?.type).toBe('action');
    expect(s.cards[media].side).toBe('BOTTOM');
    expect(() => use(s, 'p2', r, 'cancel', { target: fbi })).toThrow();
    s = use(s, 'p2', r, 'cancel', { target: media });
    while (s.window) s = act(s, waitingFor(s)[0], { type: 'pass' });
    expect(s.cards[media].side).toBe('BOTTOM');
    expect(s.cards[media].tokens).toBe(0);
    expect(s.cards[r].tokens).toBe(0);
  });
  it('is not asked about Relief without a Media Group, nor without its action', () => {
    let s = scenario();
    const r = give(s, 'p2', 'bigfoot', { resource: true });
    const hawaii = give(s, 'p1', 'hawaii', { under: ill(s, 0), side: 'BOTTOM' });
    const media = give(s, 'p1', 'big-media', { under: ill(s, 0), side: 'TOP' });
    const fbi = give(s, 'p1', 'fbi', { under: ill(s, 0), side: 'LEFT' });
    s.cards[hawaii].devastated = true;
    const s1 = act(s, 'p1', { type: 'relief', place: hawaii, payWith: [media] });
    expect(s1.prompt).toBeUndefined();
    s.cards[r].tokens = 1;
    const s2 = act(s, 'p1', { type: 'relief', place: hawaii, payWith: [fbi] });
    expect(s2.prompt).toBeUndefined();
    expect(s2.cards[hawaii].devastated).toBe(false);
  });
});

describe('Book of Kells', () => {
  it('unlinked: +1 Power and +1 Global Power for the Illuminati', () => {
    const s = scenario();
    const before = [power(s, ill(s, 0)), globalPower(s, ill(s, 0))];
    give(s, 'p1', 'book-of-kells', { resource: true });
    expect(power(s, ill(s, 0))).toBe(before[0] + 1);
    expect(globalPower(s, ill(s, 0))).toBe(Math.min(before[1] + 1, before[0] + 1));
  });
  it('linked to a Magic Group gives it two actions; cannot link to a non-Magic Group', () => {
    let s = scenario();
    const r = give(s, 'p1', 'book-of-kells', { resource: true });
    const druids = give(s, 'p1', 'druids', { under: ill(s, 0), side: 'BOTTOM' });
    const fbi = give(s, 'p1', 'fbi', { under: ill(s, 0), side: 'TOP' });
    expect(() => act(s, 'p1', { type: 'link', resource: r, to: fbi })).toThrow(/cannot be linked/);
    s = act(s, 'p1', { type: 'link', resource: r, to: druids });
    s = nextTurnOf(s, 'p1');
    expect(s.cards[druids].tokens).toBe(2);
    expect(s.cards[fbi].tokens).toBe(1);
  });
  it('the linked Magic Group may not attack to destroy, but may attack to control', () => {
    let s = scenario();
    const r = give(s, 'p1', 'book-of-kells', { resource: true });
    const druids = give(s, 'p1', 'druids', { under: ill(s, 0), side: 'BOTTOM' });
    const tgt = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'BOTTOM' });
    expect(() => attack(s, 'p1', druids, tgt, 'destroy')).not.toThrow();
    s = act(s, 'p1', { type: 'link', resource: r, to: druids });
    expect(() => attack(s, 'p1', druids, tgt, 'destroy')).toThrow(/may not attack to destroy/);
    expect(() => attack(s, 'p1', druids, tgt, 'control')).not.toThrow();
  });
});

describe('Center for Weird Studies', () => {
  it('discards a Plot to refresh a spent Group, once per turn', () => {
    let s = scenario();
    const r = give(s, 'p1', 'center-for-weird-studies', { resource: true });
    const g = give(s, 'p1', 'fbi', { under: ill(s, 0), side: 'BOTTOM' });
    const g2 = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'TOP' });
    const plot = give(s, 'p1', 'fnord', { hand: true });
    give(s, 'p1', 'hoax', { hand: true });
    s.cards[g].tokens = 0; s.cards[g2].tokens = 0;
    s = use(s, 'p1', r, 'refresh', { target: g, payWith: [plot] });
    expect(s.cards[g].tokens).toBe(1);
    expect(s.cards[plot].zone).toBe('discard');
    expect(() => use(s, 'p1', r, 'refresh', { target: g2 })).toThrow(/Already used/);
  });
  it('only for a Group that has already used its action', () => {
    const s = scenario();
    const r = give(s, 'p1', 'center-for-weird-studies', { resource: true });
    const g = give(s, 'p1', 'fbi', { under: ill(s, 0), side: 'BOTTOM' });
    give(s, 'p1', 'fnord', { hand: true });
    expect(() => use(s, 'p1', r, 'refresh', { target: g })).toThrow(/still has/);
  });
});

describe('Clipper Chip', () => {
  it('+2 Power to your Government Groups and immunity to the Phone Phreaks', () => {
    let s = scenario();
    const fbi = give(s, 'p1', 'fbi', { under: ill(s, 0), side: 'BOTTOM' });
    const before = power(s, fbi);
    give(s, 'p1', 'clipper-chip', { resource: true });
    expect(power(s, fbi)).toBe(before + 2);
    const pp = give(s, 'p2', 'phone-phreaks', { under: ill(s, 1), side: 'BOTTOM' });
    s.active = 1;
    expect(() => attack(s, 'p2', pp, fbi, 'destroy')).toThrow(/immune/);
  });
  it('at most one per player, and discarded with no Government Group', () => {
    let s = scenario();
    give(s, 'p1', 'fbi', { under: ill(s, 0), side: 'BOTTOM' });
    give(s, 'p1', 'clipper-chip', { resource: true });
    const second = give(s, 'p1', 'clipper-chip', { hand: true });
    expect(() => act(s, 'p1', { type: 'playResource', card: second })).toThrow(/Unique/);
    expect(canEnterPlay(s, second, 'p2')).toBe(true);
    const s2 = scenario();
    const c = give(s2, 'p1', 'clipper-chip', { hand: true });
    const s3 = act(s2, 'p1', { type: 'playResource', card: c });
    expect(s3.cards[c].zone).toBe('discard');
  });
});

describe('Crystal Skull', () => {
  it('whenever you draw a Plot, take any one of the top three; the others go on top or bottom', () => {
    let s = scenario();
    give(s, 'p1', 'crystal-skull', { resource: true });
    const [a, b, c] = s.players[0].plotDeck;
    const n = s.players[0].plotDeck.length;
    s = act(s, 'p1', { type: 'buyPlot', payWith: [ill(s, 0)] });
    expect(s.prompt?.kind).toBe('choose');
    expect(s.players[0].hand).not.toContain(a);
    expect(() => choose(s, 'p1', [`take:${a}`, `take:${c}`])).toThrow(/exactly one/);
    s = choose(s, 'p1', [`take:${c}`, `bottom:${a}`]);
    const deck = s.players[0].plotDeck;
    expect(s.players[0].hand).toContain(c);
    expect(deck.length).toBe(n - 1);
    expect(deck[0]).toBe(b);
    expect(deck[deck.length - 1]).toBe(a);
    expect(s.prompt).toBeUndefined();
  });
  it('asks at the start of your turn before the takeover; not for a rival\'s draws', () => {
    let s = scenario();
    give(s, 'p2', 'crystal-skull', { resource: true });
    s = act(s, 'p1', { type: 'buyPlot', payWith: [ill(s, 0)] });
    expect(s.prompt).toBeUndefined();
    s = act(s, 'p1', { type: 'endTurn' });
    for (let i = 0; i < 20 && !s.prompt; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
    expect(s.prompt?.kind).toBe('choose');
    expect(s.prompt!.player).toBe('p2');
    s = choose(s, 'p2', [s.prompt!.choice!.options[1].id]);
    expect(s.prompt?.kind === 'choose').toBe(false);
  });
});

describe('Cyborg Soldiers', () => {
  it('doubles a Violent Group and is lost with it', () => {
    let s = scenario();
    const r = give(s, 'p1', 'cyborg-soldiers', { resource: true });
    const batf = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'BOTTOM' });
    const before = power(s, batf);
    s = act(s, 'p1', { type: 'link', resource: r, to: batf });
    expect(power(s, batf)).toBe(before * 2);
    destroyGroup(s, batf, 'p2');
    expect(s.cards[r].zone).toBe('destroyed');
  });
  it('cannot link to a non-Violent Group', () => {
    const s = scenario();
    const r = give(s, 'p1', 'cyborg-soldiers', { resource: true });
    const fbi = give(s, 'p1', 'fbi', { under: ill(s, 0), side: 'BOTTOM' });
    expect(() => act(s, 'p1', { type: 'link', resource: r, to: fbi })).toThrow(/cannot be linked/);
  });
});

describe('Death Mask', () => {
  it('the linked Magic Group joins after the roll', () => {
    let s = scenario();
    const r = give(s, 'p1', 'death-mask', { resource: true });
    const ninjas = give(s, 'p1', 'ninjas', { under: ill(s, 0), side: 'TOP' });
    const batf = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'BOTTOM' });
    const tgt = give(s, 'p2', 'anti-war-activists', { under: ill(s, 1), side: 'BOTTOM' });
    s = act(s, 'p1', { type: 'link', resource: r, to: ninjas });
    s = boost(attack(s, 'p1', batf, tgt, 'destroy'), 'p1', 20);
    expect(() => use(s, 'p1', r, 'join', { mode: 'aid' })).toThrow(/cannot be used right now/);
    s = toRoll(s);
    const before = attackStrength(s, s.attack!).attack;
    s = use(s, 'p1', r, 'join', { mode: 'aid' });
    expect(s.attack!.aid.map((a) => a.iid)).toContain(ninjas);
    expect(s.cards[ninjas].tokens).toBe(0);
    expect(attackStrength(s, s.attack!).attack).toBeGreaterThan(before);
  });
  it('cannot link to a non-Magic Group', () => {
    const s = scenario();
    const r = give(s, 'p1', 'death-mask', { resource: true });
    const batf = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'BOTTOM' });
    expect(() => act(s, 'p1', { type: 'link', resource: r, to: batf })).toThrow(/cannot be linked/);
  });
});

describe('Earthquake Projector', () => {
  it('+2 to an Attack to Destroy a Place, once per turn', () => {
    let s = scenario();
    const r = give(s, 'p1', 'earthquake-projector', { resource: true });
    s.cards[r].tokens = 1;
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const hawaii = give(s, 'p2', 'hawaii', { under: ill(s, 1), side: 'BOTTOM' });
    s = attack(s, 'p1', g, hawaii, 'destroy');
    const before = attackStrength(s, s.attack!).attack;
    s = use(s, 'p1', r, 'boost');
    expect(attackStrength(s, s.attack!).attack).toBe(before + 2);
    s.cards[r].tokens = 1;
    expect(() => use(s, 'p1', r, 'boost')).toThrow(/Already used/);
  });
  it('not against a non-Place', () => {
    let s = scenario();
    const r = give(s, 'p1', 'earthquake-projector', { resource: true });
    s.cards[r].tokens = 1;
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const t = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'BOTTOM' });
    s = attack(s, 'p1', g, t, 'destroy');
    expect(() => use(s, 'p1', r, 'boost')).toThrow(/Place/);
  });
});

describe('Eliza', () => {
  it('gives a linked Computer Group an extra action; one Eliza per Group', () => {
    let s = scenario();
    const r = give(s, 'p1', 'eliza', { resource: true });
    const r2 = give(s, 'p1', 'eliza', { resource: true });
    const eff = give(s, 'p1', 'eff', { under: ill(s, 0), side: 'BOTTOM' });
    const fbi = give(s, 'p1', 'fbi', { under: ill(s, 0), side: 'TOP' });
    expect(() => act(s, 'p1', { type: 'link', resource: r, to: fbi })).toThrow(/cannot be linked/);
    s = act(s, 'p1', { type: 'link', resource: r, to: eff });
    expect(() => act(s, 'p1', { type: 'link', resource: r2, to: eff })).toThrow(/cannot be linked/);
    s = nextTurnOf(s, 'p1');
    expect(s.cards[eff].tokens).toBe(2);
  });
  it('crashes when the extra action rolls 11 or 12, not the first action', () => {
    let s = scenario();
    const r = give(s, 'p1', 'eliza', { resource: true });
    const eff = give(s, 'p1', 'eff', { under: ill(s, 0), side: 'BOTTOM' });
    const t1 = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'BOTTOM' });
    const t2 = give(s, 'p2', 'the-mafia', { under: ill(s, 1), side: 'TOP' });
    s = act(s, 'p1', { type: 'link', resource: r, to: eff });
    s = nextTurnOf(s, 'p1');
    const plot = give(s, 'p1', 'fnord', { hand: true });
    s = resolve(boost(attack(s, 'p1', eff, t1, 'destroy'), 'p1', 30), [6, 6]);
    expect(s.cards[r].zone).toBe('resources');
    s = resolve(boost(attack(s, 'p1', eff, t2, 'destroy'), 'p1', 30), [6, 5]);
    expect(s.cards[r].zone).toBe('discard');
    expect(s.cards[plot].exposed).toBe(true);
  });
  it('does not crash in a turn it gave no extra action', () => {
    let s = scenario();
    const r = give(s, 'p1', 'eliza', { resource: true });
    const eff = give(s, 'p1', 'eff', { under: ill(s, 0), side: 'BOTTOM' });
    const t1 = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'BOTTOM' });
    s = act(s, 'p1', { type: 'link', resource: r, to: eff });
    s = resolve(boost(attack(s, 'p1', eff, t1, 'destroy'), 'p1', 30), [6, 6]);
    expect(s.cards[eff].tokens).toBe(0);
    expect(s.cards[r].zone).toBe('resources');
  });
});

describe('Flying Saucer', () => {
  it('linked to a Personality: +10 against destruction', () => {
    let s = scenario();
    const r = give(s, 'p2', 'flying-saucer', { resource: true });
    const bj = give(s, 'p2', 'bjorne', { under: ill(s, 1), side: 'BOTTOM' });
    const fbi = give(s, 'p2', 'fbi', { under: ill(s, 1), side: 'TOP' });
    expect(() => { s.active = 1; act(s, 'p2', { type: 'link', resource: r, to: fbi }); }).toThrow(/cannot be linked/);
    s = act(s, 'p2', { type: 'link', resource: r, to: bj });
    s.active = 0;
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    expect(diff(attack(s, 'p1', g, bj, 'destroy'), r).defense).toBe(10);
    expect(diff(attack(s, 'p1', g, bj, 'control'), r).defense).toBe(0);
  });
  it('unlinked: an extra Resource takeover for the top Plot card', () => {
    let s = scenario();
    const r = give(s, 'p1', 'flying-saucer', { resource: true });
    const res = give(s, 'p1', 'mercenaries', { hand: true });
    const top = s.players[0].plotDeck[0];
    s = use(s, 'p1', r, 'takeover', { target: res });
    expect(s.cards[res].zone).toBe('resources');
    expect(s.cards[top].zone).toBe('discard');
    const res2 = give(s, 'p1', 'rogue-boomer', { hand: true });
    expect(() => use(s, 'p1', r, 'takeover', { target: res2 })).toThrow(/Already used/);
  });
});

describe('Hallucinations', () => {
  it('+3 to destroy a Personality, once per turn', () => {
    let s = scenario();
    const r = give(s, 'p1', 'hallucinations', { resource: true });
    s.cards[r].tokens = 1;
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const bj = give(s, 'p2', 'bjorne', { under: ill(s, 1), side: 'BOTTOM' });
    s = attack(s, 'p1', g, bj, 'destroy');
    const before = attackStrength(s, s.attack!).attack;
    s = use(s, 'p1', r, 'boost');
    expect(attackStrength(s, s.attack!).attack).toBe(before + 3);
    s.cards[r].tokens = 1;
    expect(() => use(s, 'p1', r, 'cancel', { target: g })).toThrow(/Already used/);
  });
  it('cancels a Personality\'s action but not another Group\'s', () => {
    let s = scenario();
    const r = give(s, 'p2', 'hallucinations', { resource: true });
    s.cards[r].tokens = 1;
    const bill = give(s, 'p1', 'bill-clinton', { under: ill(s, 0), side: 'BOTTOM' });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'TOP' });
    const t = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'BOTTOM' });
    expect(() => use(attack(s, 'p1', g, t, 'destroy'), 'p2', r, 'cancel', { target: g })).toThrow(/Personality/);
    s = use(attack(s, 'p1', bill, t, 'destroy'), 'p2', r, 'cancel', { target: bill });
    expect(s.attack!.plays.some((p) => p.effect.t === 'cancelGroup')).toBe(true);
  });
});

describe('Hammer of Thor', () => {
  it('+2 to an attacking Government or Violent Group; not to others', () => {
    let s = scenario();
    const r = give(s, 'p1', 'hammer-of-thor', { resource: true });
    s.cards[r].tokens = 1;
    const batf = give(s, 'p1', 'b-a-t-f', { under: ill(s, 0), side: 'BOTTOM' });
    const ama = give(s, 'p1', 'a-m-a', { under: ill(s, 0), side: 'TOP' });
    const t = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'BOTTOM' });
    const s2 = attack(s, 'p1', ama, t, 'destroy');
    expect(() => use(s2, 'p1', r, 'boost', { target: ama })).toThrow(/Government or Violent/);
    s = attack(s, 'p1', batf, t, 'destroy');
    const before = attackStrength(s, s.attack!).attack;
    s = use(s, 'p1', r, 'boost', { target: batf });
    expect(attackStrength(s, s.attack!).attack).toBe(before + 2);
  });
});

describe('Hidden City', () => {
  it('+2 Power and +2 Global Power for the Illuminati; Unique', () => {
    const s = scenario();
    const p0 = power(s, ill(s, 0)), g0 = globalPower(s, ill(s, 0));
    give(s, 'p1', 'hidden-city', { resource: true });
    expect(power(s, ill(s, 0))).toBe(p0 + 2);
    expect(globalPower(s, ill(s, 0))).toBe(Math.min(g0 + 2, p0 + 2));
    const other = give(s, 'p2', 'hidden-city', { hand: true });
    expect(canEnterPlay(s, other, 'p2')).toBe(false);
  });
  it('once destroyed, another Hidden City may come into play (unlike other Unique Resources)', () => {
    const s = scenario();
    const hc = give(s, 'p1', 'hidden-city', { resource: true });
    const pm = give(s, 'p1', 'perpetual-motion-machine', { resource: true });
    Object.assign(s.cards[hc], { zone: 'destroyed', controller: undefined, linkedTo: undefined });
    Object.assign(s.cards[pm], { zone: 'destroyed', controller: undefined, linkedTo: undefined });
    expect(canEnterPlay(s, give(s, 'p2', 'hidden-city', { hand: true }), 'p2')).toBe(true);
    expect(canEnterPlay(s, give(s, 'p2', 'perpetual-motion-machine', { hand: true }), 'p2')).toBe(false);
  });
});

describe("Hitler's Brain", () => {
  it('each Group you destroy lets you draw a Plot', () => {
    let s = scenario();
    const r = give(s, 'p1', 'hitler-s-brain', { resource: true });
    const t = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'BOTTOM' });
    expect(() => use(s, 'p1', r, 'draw')).toThrow(/destroy/);
    destroyGroup(s, t, 'p1');
    const n = s.players[0].hand.length;
    s = use(s, 'p1', r, 'draw');
    expect(s.players[0].hand.length).toBe(n + 1);
    expect(() => use(s, 'p1', r, 'hide')).toThrow(/destroy/);
  });
  it('you cannot take control of Peaceful Groups, by attack or automatic takeover', () => {
    const s = scenario();
    give(s, 'p1', 'hitler-s-brain', { resource: true });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const t = give(s, 'p1', 'anti-war-activists', { hand: true });
    const fbi = give(s, 'p1', 'fbi', { hand: true });
    const ama = give(s, 'p2', 'a-m-a', { under: ill(s, 1), side: 'BOTTOM' });
    expect(() => attack(s, 'p1', g, t, 'control')).toThrow(/Peaceful/);
    expect(() => attack(s, 'p1', g, ama, 'control')).toThrow(/Peaceful/);
    expect(() => attack(s, 'p1', g, ama, 'destroy')).not.toThrow();
    expect(() => attack(s, 'p1', g, fbi, 'control')).not.toThrow();
    const cards = takeoverOptions(s, 'p1').map((o) => o.card);
    expect(cards).toContain(fbi);
    expect(cards).not.toContain(t);
  });
  it('a rival without it may still take Peaceful Groups', () => {
    const s = scenario();
    give(s, 'p2', 'hitler-s-brain', { resource: true });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const t = give(s, 'p1', 'anti-war-activists', { hand: true });
    expect(() => attack(s, 'p1', g, t, 'control')).not.toThrow();
  });
});

describe('Immortality Serum', () => {
  it('the linked Personality cannot be destroyed', () => {
    let s = scenario();
    const r = give(s, 'p2', 'immortality-serum', { resource: true });
    const bj = give(s, 'p2', 'bjorne', { under: ill(s, 1), side: 'BOTTOM' });
    const bill = give(s, 'p2', 'bill-clinton', { under: ill(s, 1), side: 'TOP' });
    s.active = 1;
    s = act(s, 'p2', { type: 'link', resource: r, to: bj });
    s.cards[r].linkMovedTurn = undefined; // a later turn
    expect(() => act(s, 'p2', { type: 'link', resource: r, to: bill })).toThrow(/cannot be linked/);
    s.active = 0;
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    s = attack(s, 'p1', g, bj, 'destroy');
    expect(diff(s, r).defense).toBe(5);
    s = resolve(boost(s, 'p1', 50), [1, 1]);
    expect(s.cards[bj].zone).toBe('structure');
  });
  it('takes a Personality played from your hand with no roll, then serves it', () => {
    let s = scenario();
    const r = give(s, 'p1', 'immortality-serum', { resource: true });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const bj = give(s, 'p1', 'bjorne', { hand: true });
    const fbi = give(s, 'p1', 'fbi', { hand: true });
    expect(() => use(attack(s, 'p1', g, fbi, 'control'), 'p1', r, 'seize')).toThrow(/Personality/);
    s = use(attack(s, 'p1', g, bj, 'control'), 'p1', r, 'seize');
    s = resolve(s, [6, 6]);
    expect(s.cards[bj].zone).toBe('structure');
    expect(s.cards[r].linkedTo).toBe(bj);
  });
  it('takes a Personality a rival has just taken over automatically', () => {
    let s = scenario();
    const r = give(s, 'p1', 'immortality-serum', { resource: true });
    const bj = give(s, 'p2', 'bjorne', { hand: true });
    s.active = 1;
    s.phase = 'beginning';
    s.prompt = { player: 'p2', kind: 'takeover' };
    s = act(s, 'p2', { type: 'takeover', card: bj, onto: ill(s, 1), side: 'BOTTOM' });
    expect(s.cards[bj].controller).toBe('p2');
    expect(s.prompt?.player).toBe('p1');
    const spot = s.prompt!.choice!.options.find((o) => o.id !== 'no')!.id;
    s = choose(s, 'p1', [spot]);
    expect(s.cards[bj].controller).toBe('p1');
    expect(s.cards[bj].master).toBe(ill(s, 0));
    expect(s.cards[r].linkedTo).toBe(bj);
    expect(s.phase).toBe('main');
  });
  it('takes a Personality a rival captured from his hand; may be kept for later; never for non-Personalities', () => {
    let s = scenario();
    const r = give(s, 'p2', 'immortality-serum', { resource: true });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const bj = give(s, 'p1', 'bjorne', { hand: true });
    const fbi = give(s, 'p1', 'fbi', { hand: true });
    const s1 = resolve(boost(attack(s, 'p1', g, fbi, 'control'), 'p1', 30), [2, 2]);
    expect(s1.prompt).toBeUndefined();
    s = resolve(boost(attack(s, 'p1', g, bj, 'control'), 'p1', 30), [2, 2]);
    expect(s.cards[bj].controller).toBe('p1');
    expect(s.prompt?.player).toBe('p2');
    const kept = choose(s, 'p2', ['no']);
    expect(kept.cards[bj].controller).toBe('p1');
    expect(kept.cards[r].linkedTo).toBe(ill(kept, 1));
    s = choose(s, 'p2', [s.prompt!.choice!.options[1].id]);
    expect(s.cards[bj].controller).toBe('p2');
    expect(s.cards[r].linkedTo).toBe(bj);
  });
});

describe('Loch Ness Monster', () => {
  it('+4 to destroy a Coastal Place, not another Place', () => {
    let s = scenario();
    const r = give(s, 'p1', 'loch-ness-monster', { resource: true });
    s.cards[r].tokens = 1;
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const hawaii = give(s, 'p2', 'hawaii', { under: ill(s, 1), side: 'BOTTOM' });
    const park = give(s, 'p2', 'dinosaur-park', { under: ill(s, 1), side: 'TOP' });
    expect(() => use(attack(s, 'p1', g, park, 'destroy'), 'p1', r, 'boost')).toThrow(/Coastal/);
    s = attack(s, 'p1', g, hawaii, 'destroy');
    const before = attackStrength(s, s.attack!).attack;
    s = use(s, 'p1', r, 'boost');
    expect(attackStrength(s, s.attack!).attack).toBe(before + 4);
  });
  it('cancels the action of a Coastal Place', () => {
    let s = scenario();
    const r = give(s, 'p2', 'loch-ness-monster', { resource: true });
    s.cards[r].tokens = 1;
    const hawaii = give(s, 'p1', 'hawaii', { under: ill(s, 0), side: 'BOTTOM' });
    const t = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'BOTTOM' });
    s = use(attack(s, 'p1', hawaii, t, 'destroy'), 'p2', r, 'cancel', { target: hawaii });
    expect(s.attack!.plays.some((p) => p.effect.t === 'cancelGroup')).toBe(true);
  });
});

describe('Mercenaries', () => {
  it('+4 to destroy or +1 to control, once per turn', () => {
    let s = scenario();
    const r = give(s, 'p1', 'mercenaries', { resource: true });
    s.cards[r].tokens = 1;
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const t = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'BOTTOM' });
    const sc = attack(s, 'p1', g, t, 'control');
    const bc = attackStrength(sc, sc.attack!).attack;
    const s1 = use(sc, 'p1', r, 'boost');
    expect(attackStrength(s1, s1.attack!).attack).toBe(bc + 1);
    s = attack(s, 'p1', g, t, 'destroy');
    const bd = attackStrength(s, s.attack!).attack;
    s = use(s, 'p1', r, 'boost');
    expect(attackStrength(s, s.attack!).attack).toBe(bd + 4);
    s.cards[r].tokens = 1;
    expect(() => use(s, 'p1', r, 'boost')).toThrow(/Already used/);
  });
});

describe('Midas Mill', () => {
  it('unlinked: Illuminati +2 Power and +2 Global Power', () => {
    const s = scenario();
    const p0 = power(s, ill(s, 0)), g0 = globalPower(s, ill(s, 0));
    give(s, 'p1', 'midas-mill', { resource: true });
    expect(power(s, ill(s, 0))).toBe(p0 + 2);
    expect(globalPower(s, ill(s, 0))).toBe(Math.min(g0 + 2, p0 + 2));
  });
  it('linked to a Coastal Group: Global Power equals Power; not to a non-Coastal Group', () => {
    let s = scenario();
    const r = give(s, 'p1', 'midas-mill', { resource: true });
    const fin = give(s, 'p1', 'finland', { under: ill(s, 0), side: 'BOTTOM' });
    const fbi = give(s, 'p1', 'fbi', { under: ill(s, 0), side: 'TOP' });
    expect(() => act(s, 'p1', { type: 'link', resource: r, to: fbi })).toThrow(/cannot be linked/);
    s = act(s, 'p1', { type: 'link', resource: r, to: fin });
    expect(globalPower(s, fin)).toBe(power(s, fin));
    expect(power(s, fin)).toBeGreaterThan(0);
  });
});

describe('Necronomicon', () => {
  it('doubles a Violent or Magic Group; not a Straight Government one', () => {
    let s = scenario();
    const r = give(s, 'p1', 'necronomicon', { resource: true });
    const ninjas = give(s, 'p1', 'ninjas', { under: ill(s, 0), side: 'BOTTOM' });
    const fbi = give(s, 'p1', 'fbi', { under: ill(s, 0), side: 'TOP' });
    expect(() => act(s, 'p1', { type: 'link', resource: r, to: fbi })).toThrow(/cannot be linked/);
    const before = power(s, ninjas);
    s = act(s, 'p1', { type: 'link', resource: r, to: ninjas });
    expect(power(s, ninjas)).toBe(before * 2);
  });
  it('a roll of 11 or 12 destroys the linked Group; the book stays, unlinked', () => {
    let s = scenario();
    const r = give(s, 'p1', 'necronomicon', { resource: true });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const t = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'BOTTOM' });
    s = act(s, 'p1', { type: 'link', resource: r, to: g });
    s = resolve(boost(attack(s, 'p1', g, t, 'destroy'), 'p1', 30), [6, 6]);
    expect(s.cards[g].zone).toBe('destroyed');
    expect(s.cards[r].zone).toBe('resources');
    expect(s.cards[r].linkedTo).toBe(ill(s, 0));
    if (s.cards[ill(s, 0)].cardId !== 'servants-of-cthulhu') expect(s.players[0].destroyedCredit).not.toContain(g);
  });
});

describe('Orbital Mind Control Lasers', () => {
  it('changes an alignment until the end of the turn', () => {
    let s = scenario();
    const r = give(s, 'p1', 'orbital-mind-control-lasers', { resource: true });
    s.cards[r].tokens = 1;
    const fbi = give(s, 'p2', 'fbi', { under: ill(s, 1), side: 'BOTTOM' });
    s = use(s, 'p1', r, 'align', { target: fbi, mode: 'reverse', alignment: 'Straight' });
    expect(alignments(s, fbi)).toContain('Weird');
    expect(alignments(s, fbi)).not.toContain('Straight');
    s = nextTurnOf(s, 'p2');
    expect(alignments(s, fbi)).toContain('Straight');
  });
  it('not during a Privileged attack', () => {
    let s = scenario();
    const r = give(s, 'p1', 'orbital-mind-control-lasers', { resource: true });
    s.cards[r].tokens = 1;
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const t = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'BOTTOM' });
    s = attack(s, 'p1', g, t, 'destroy');
    s.attack!.privileged = true;
    expect(() => use(s, 'p1', r, 'align', { target: t, mode: 'remove', alignment: 'Violent' })).toThrow(/Privileged/);
  });
});

describe('Perpetual Motion Machine', () => {
  it('the linked Group gets an extra Action token; Unique', () => {
    let s = scenario();
    const r = give(s, 'p1', 'perpetual-motion-machine', { resource: true });
    const fbi = give(s, 'p1', 'fbi', { under: ill(s, 0), side: 'BOTTOM' });
    s = act(s, 'p1', { type: 'link', resource: r, to: fbi });
    s = nextTurnOf(s, 'p1');
    expect(s.cards[fbi].tokens).toBe(2);
    const other = give(s, 'p2', 'perpetual-motion-machine', { hand: true });
    expect(canEnterPlay(s, other, 'p2')).toBe(false);
  });
});

describe('Principia Discordia', () => {
  it('each of your Weird Groups gets +1 Resistance per Weird Group you control; not rivals\'', () => {
    const s = scenario();
    const a = give(s, 'p1', 'church-of-elvis', { under: ill(s, 0), side: 'BOTTOM' });
    const b = give(s, 'p1', 'american-autoduel-association', { under: ill(s, 0), side: 'TOP' });
    const c = give(s, 'p2', 'comic-books', { under: ill(s, 1), side: 'TOP' });
    const before = [resistance(s, a), resistance(s, b), resistance(s, c)];
    give(s, 'p1', 'principia-discordia', { resource: true });
    expect([resistance(s, a), resistance(s, b), resistance(s, c)]).toEqual([before[0] + 2, before[1] + 2, before[2]]);
  });
});

describe('Rogue Boomer', () => {
  it('+5 to control a Nation', () => {
    const s = scenario();
    const r = give(s, 'p1', 'rogue-boomer', { resource: true });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const fin = give(s, 'p1', 'finland', { hand: true });
    const other = give(s, 'p1', 'fbi', { hand: true });
    expect(diff(attack(s, 'p1', g, fin, 'control'), r).attack).toBe(5);
    expect(diff(attack(s, 'p1', g, other, 'control'), r).attack).toBe(0);
  });
  it('once: +10 to destroy a Place, then discarded; not for control', () => {
    let s = scenario();
    const r = give(s, 'p1', 'rogue-boomer', { resource: true });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const hawaii = give(s, 'p2', 'hawaii', { under: ill(s, 1), side: 'BOTTOM' });
    expect(() => use(attack(s, 'p1', g, hawaii, 'control'), 'p1', r, 'strike')).toThrow(/destroy/);
    s = attack(s, 'p1', g, hawaii, 'destroy');
    const before = attackStrength(s, s.attack!).attack;
    s = use(s, 'p1', r, 'strike');
    expect(attackStrength(s, s.attack!).attack).toBe(before + 10);
    expect(s.cards[r].zone).toBe('discard');
  });
  it('helps only its holder\'s own attacks on a Nation or a Place, but any Disaster', () => {
    const s = scenario();
    const r = give(s, 'p1', 'rogue-boomer', { resource: true });
    const g = give(s, 'p2', 'c-i-a', { under: ill(s, 1), side: 'BOTTOM' });
    const fin = give(s, 'p1', 'finland', { under: ill(s, 0), side: 'BOTTOM' });
    const hawaii = give(s, 'p1', 'hawaii', { under: ill(s, 0), side: 'TOP' });
    s.active = 1;
    expect(diff(attack(s, 'p2', g, fin, 'control'), r).attack).toBe(0);
    expect(() => use(attack(s, 'p2', g, hawaii, 'destroy'), 'p1', r, 'strike')).toThrow(/your own/);
    const quake = give(s, 'p2', 'earthquake', { hand: true });
    startInstantAttack(s, 'p2', { plot: quake, target: hawaii, power: 12, disaster: { destroyMargin: null } });
    const before = attackStrength(s, s.attack!).attack;
    const after = use(s, 'p1', r, 'strike');
    expect(attackStrength(after, after.attack!).attack).toBe(before + 10);
  });
});

describe('Shroud of Turin', () => {
  it('each Plot draw: see the top card, or leave it and draw the bottom card', () => {
    let s = scenario();
    give(s, 'p1', 'shroud-of-turin', { resource: true });
    const deck0 = [...s.players[0].plotDeck];
    s = act(s, 'p1', { type: 'buyPlot', payWith: [ill(s, 0)] });
    expect(s.prompt?.kind).toBe('choose');
    expect(s.players[0].hand).not.toContain(deck0[0]);
    s = choose(s, 'p1', ['bottom']);
    expect(s.players[0].hand).toContain(deck0[deck0.length - 1]);
    expect(s.players[0].plotDeck[0]).toBe(deck0[0]);
  });
  it('each Group draw too; keeping the top card is a normal draw; not for a rival', () => {
    let s = scenario();
    give(s, 'p1', 'shroud-of-turin', { resource: true });
    const top = s.players[0].groupDeck[0];
    s = act(s, 'p1', { type: 'drawGroup' });
    s = choose(s, 'p1', ['top']);
    expect(s.players[0].hand).toContain(top);
    const s2 = scenario();
    give(s2, 'p2', 'shroud-of-turin', { resource: true });
    expect(act(s2, 'p1', { type: 'drawGroup' }).prompt).toBeUndefined();
  });
});

describe('Soulburner', () => {
  it('when a rival destroys your Group, take two Plots from his deck', () => {
    let s = scenario();
    const r = give(s, 'p1', 'soulburner', { resource: true });
    const g = give(s, 'p1', 'fbi', { under: ill(s, 0), side: 'BOTTOM' });
    expect(() => use(s, 'p1', r, 'take')).toThrow(/rival/);
    const top2 = s.players[1].plotDeck.slice(0, 2);
    destroyGroup(s, g, 'p2');
    s = use(s, 'p1', r, 'take');
    expect(s.players[0].hand).toEqual(expect.arrayContaining(top2));
  });
  it('or expose his Plots and discard one of them', () => {
    let s = scenario();
    const r = give(s, 'p1', 'soulburner', { resource: true });
    const g = give(s, 'p1', 'fbi', { under: ill(s, 0), side: 'BOTTOM' });
    const a = give(s, 'p2', 'fnord', { hand: true });
    const b = give(s, 'p2', 'hoax', { hand: true });
    destroyGroup(s, g, 'p2');
    s = use(s, 'p1', r, 'expose', { target: b });
    expect(s.cards[a].exposed).toBe(true);
    expect(s.cards[b].zone).toBe('discard');
    expect(() => use(s, 'p1', r, 'expose')).toThrow(/rival/);
  });
});

describe('Spear of Longinus', () => {
  it('+1 to an Attack to Destroy, once per attack; not to control', () => {
    let s = scenario();
    const r = give(s, 'p2', 'spear-of-longinus', { resource: true });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const t = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'BOTTOM' });
    expect(() => use(attack(s, 'p1', g, t, 'control'), 'p2', r, 'boost')).toThrow(/Destroy/);
    s = attack(s, 'p1', g, t, 'destroy');
    const before = attackStrength(s, s.attack!).attack;
    s = use(s, 'p2', r, 'boost');
    expect(attackStrength(s, s.attack!).attack).toBe(before + 1);
    expect(() => use(s, 'p2', r, 'boost')).toThrow(/already/);
  });
  it('an attack it helps counts as Magic, only for that attack', () => {
    let s = scenario();
    const r = give(s, 'p1', 'spear-of-longinus', { resource: true });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const t = give(s, 'p2', 'loan-sharks', { under: ill(s, 1), side: 'BOTTOM' });
    s = attack(s, 'p1', g, t, 'destroy');
    expect(attributes(s, g)).not.toContain('Magic');
    s = use(s, 'p1', r, 'boost');
    expect(attributes(s, g)).toContain('Magic');
    expect(attributes(s, t)).not.toContain('Magic');
    s = resolve(s, [6, 6]);
    expect(attributes(s, g)).not.toContain('Magic');
  });
});

describe('Suicide Squad', () => {
  const seedFor = (face: number) => { for (let k = 0; ; k++) { const t = { rng: k } as GameState; if (rollDie(t) === face) return k; } };
  it('1: the target is destroyed and the Squad survives; 6: only the Squad dies (destroyed cards are discarded)', () => {
    let s = scenario();
    const r = give(s, 'p1', 'suicide-squad', { resource: true });
    const t = give(s, 'p2', 'bigfoot', { resource: true });
    s.rng = seedFor(1);
    const s1 = use(s, 'p1', r, 'strike', { target: t });
    expect([s1.cards[t].zone, s1.cards[r].zone]).toEqual(['discard', 'resources']);
    s.rng = seedFor(6);
    const s6 = use(s, 'p1', r, 'strike', { target: t });
    expect([s6.cards[t].zone, s6.cards[r].zone]).toEqual(['resources', 'discard']);
    s.rng = seedFor(3);
    const s3 = use(s, 'p1', r, 'strike', { target: t });
    expect([s3.cards[t].zone, s3.cards[r].zone]).toEqual(['discard', 'discard']);
  });
  it('only against a rival\'s Resource', () => {
    const s = scenario();
    const r = give(s, 'p1', 'suicide-squad', { resource: true });
    const mine = give(s, 'p1', 'bigfoot', { resource: true });
    expect(() => use(s, 'p1', r, 'strike', { target: mine })).toThrow(/rival/);
  });
});

describe('The Bronze Head', () => {
  it('a failed takeover from your hand returns the card to hand', () => {
    let s = scenario();
    give(s, 'p1', 'the-bronze-head', { resource: true });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const t = give(s, 'p1', 'fbi', { hand: true });
    s = resolve(boost(attack(s, 'p1', g, t, 'control'), 'p1', 10), [6, 6]);
    expect(s.cards[t].zone).toBe('hand');
    expect(s.cards[t].failedTakeoverTurn).toBeUndefined();
  });
  it('without it the card would be discarded (control)', () => {
    let s = scenario();
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const t = give(s, 'p1', 'fbi', { hand: true });
    s = resolve(boost(attack(s, 'p1', g, t, 'control'), 'p1', 10), [6, 6]);
    if (s.cards[ill(s, 0)].cardId !== 'adepts-of-hermes') expect(s.cards[t].failedTakeoverTurn).toBe(s.turn);
  });
});

describe('The Frog God', () => {
  it('lets its controller interfere with a Privileged attack, spending its action', () => {
    let s = scenario();
    const r = give(s, 'p2', 'the-frog-god', { resource: true });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const t = give(s, 'p1', 'a-m-a', { hand: true });
    const helper = give(s, 'p2', 'boy-sprouts', { under: ill(s, 1), side: 'BOTTOM' });
    s = attack(s, 'p1', g, t, 'control');
    s.attack!.privileged = true;
    expect(participants(s)).not.toContain('p2');
    s.cards[r].tokens = 1;
    expect(participants(s)).toContain('p2');
    s = act(s, 'p2', { type: 'oppose', group: helper });
    s = resolve(s);
    expect(s.cards[r].tokens).toBe(0);
  });
});

describe('The Holy Grail', () => {
  it('the named Place cannot be destroyed by an attack; the name cannot change', () => {
    let s = scenario();
    const r = give(s, 'p1', 'the-holy-grail', { resource: true });
    const hawaii = give(s, 'p2', 'hawaii', { under: ill(s, 1), side: 'BOTTOM' });
    const park = give(s, 'p2', 'dinosaur-park', { under: ill(s, 1), side: 'TOP' });
    s = use(s, 'p1', r, 'name', { target: hawaii });
    expect(() => use(s, 'p1', r, 'name', { target: park })).toThrow(/already/);
    s.active = 1;
    const g = give(s, 'p2', 'c-i-a', { under: ill(s, 1), side: 'LEFT' });
    s = resolve(boost(attack(s, 'p2', g, hawaii, 'destroy'), 'p2', 50), [1, 1]);
    expect(s.cards[hawaii].zone).toBe('structure');
  });
  it('stays secret until a Disaster would succeed, then makes it fail', () => {
    let s = scenario();
    const r = give(s, 'p2', 'the-holy-grail', { resource: true });
    const hawaii = give(s, 'p2', 'hawaii', { under: ill(s, 1), side: 'BOTTOM' });
    s.active = 1;
    s = use(s, 'p2', r, 'name', { target: hawaii });
    s.active = 0;
    const volcano = give(s, 'p1', 'volcano', { hand: true });
    const seen = s.log.length;
    s = act(s, 'p1', { type: 'playPlot', play: { card: volcano, target: hawaii } });
    expect(attackStrength(s, s.attack!).lines.join()).not.toMatch(/Grail/);
    s = toRoll(s, [1, 1]);
    expect(s.log.slice(seen).some((l) => /Grail/.test(l.text))).toBe(false);
    s = resolve(s);
    expect(s.cards[hawaii].devastated).toBeFalsy();
    expect(s.cards[hawaii].zone).toBe('structure');
    expect(s.log.some((l) => /Holy Grail is revealed/.test(l.text))).toBe(true);
  });
  it('does not act on an attack that fails anyway', () => {
    let s = scenario();
    const r = give(s, 'p2', 'the-holy-grail', { resource: true });
    const hawaii = give(s, 'p2', 'hawaii', { under: ill(s, 1), side: 'BOTTOM' });
    s.active = 1;
    s = use(s, 'p2', r, 'name', { target: hawaii });
    s.active = 0;
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    s = resolve(boost(attack(s, 'p1', g, hawaii, 'destroy'), 'p1', 30), [6, 6]);
    expect(s.log.some((l) => /Holy Grail is revealed/.test(l.text))).toBe(false);
  });
  it('is discarded if the Place is captured', () => {
    let s = scenario();
    const r = give(s, 'p1', 'the-holy-grail', { resource: true });
    const hawaii = give(s, 'p2', 'hawaii', { under: ill(s, 1), side: 'BOTTOM' });
    s = use(s, 'p1', r, 'name', { target: hawaii });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    s = resolve(boost(attack(s, 'p1', g, hawaii, 'control'), 'p1', 50), [2, 2]);
    expect(s.cards[hawaii].controller).toBe('p1');
    expect(s.cards[r].zone).toBe('discard');
  });
});

describe('The Library at Alexandria', () => {
  it('+5 to control Science, Magic or Computer Groups only', () => {
    const s = scenario();
    const r = give(s, 'p1', 'the-library-at-alexandria', { resource: true });
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const sci = give(s, 'p1', 'a-m-a', { hand: true });
    const other = give(s, 'p1', 'loan-sharks', { hand: true });
    expect(diff(attack(s, 'p1', g, sci, 'control'), r).attack).toBe(5);
    expect(diff(attack(s, 'p1', g, other, 'control'), r).attack).toBe(0);
  });
});

describe('Warehouse 23', () => {
  it('when played, brings in an Artifact or Gadget from hand; not other Resources', () => {
    let s = scenario();
    const w = give(s, 'p1', 'warehouse-23', { hand: true });
    const necro = give(s, 'p1', 'necronomicon', { hand: true });
    const bigfoot = give(s, 'p1', 'bigfoot', { hand: true });
    s = act(s, 'p1', { type: 'playResource', card: w });
    expect(() => use(s, 'p1', w, 'fetch', { target: bigfoot })).toThrow(/Artifact or Gadget/);
    s = use(s, 'p1', w, 'fetch', { target: necro });
    expect(s.cards[necro].zone).toBe('resources');
    expect(() => use(s, 'p1', w, 'fetch', { target: bigfoot })).toThrow(/first played/);
  });
});

describe('Weather Satellite', () => {
  it('+10 to a Tornado; only one of its actions per attack', () => {
    let s = scenario();
    const r = give(s, 'p1', 'weather-satellite', { resource: true });
    s.cards[r].tokens = 2;
    const hawaii = give(s, 'p2', 'hawaii', { under: ill(s, 1), side: 'BOTTOM' });
    const tornado = give(s, 'p1', 'tornado', { hand: true });
    s = act(s, 'p1', { type: 'playPlot', play: { card: tornado, target: hawaii } });
    const before = attackStrength(s, s.attack!).attack;
    expect(() => use(s, 'p1', r, 'place', { mode: 'up' })).toThrow(/storm/);
    s = use(s, 'p1', r, 'storm', { mode: 'up' });
    expect(attackStrength(s, s.attack!).attack).toBe(before + 10);
    expect(() => use(s, 'p1', r, 'storm', { mode: 'down' })).toThrow(/already/);
  });
  it('+4/-2 to other attacks to destroy a non-Space Place; two tokens each turn', () => {
    let s = scenario();
    const r = give(s, 'p1', 'weather-satellite', { resource: true });
    s.cards[r].tokens = 1;
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const hawaii = give(s, 'p2', 'hawaii', { under: ill(s, 1), side: 'BOTTOM' });
    const moon = give(s, 'p2', 'moonbase', { under: ill(s, 1), side: 'TOP' });
    expect(() => use(attack(s, 'p1', g, moon, 'destroy'), 'p1', r, 'place', { mode: 'up' })).toThrow(/Space/);
    let s2 = attack(s, 'p1', g, hawaii, 'destroy');
    const before = attackStrength(s2, s2.attack!).attack;
    s2 = use(s2, 'p1', r, 'place', { mode: 'down' });
    expect(attackStrength(s2, s2.attack!).attack).toBe(before - 2);
    s = nextTurnOf(s, 'p1');
    expect(s.cards[r].tokens).toBe(2);
  });
});

describe('Xanadu', () => {
  it('agents give no bonus against your Groups', () => {
    let s = scenario();
    const g = give(s, 'p1', 'c-i-a', { under: ill(s, 0), side: 'BOTTOM' });
    const fbi = give(s, 'p2', 'fbi', { under: ill(s, 1), side: 'BOTTOM' });
    const dup = give(s, 'p1', 'fbi', { hand: true });
    s = attack(s, 'p1', g, fbi, 'destroy');
    expect(() => act(s, 'p1', { type: 'agent', card: dup, as: 'aid' })).not.toThrow();
    const x = give(s, 'p2', 'xanadu', { resource: true });
    expect(x).toBeTruthy();
    expect(() => act(s, 'p1', { type: 'agent', card: dup, as: 'aid' })).toThrow(/no bonus/);
  });
});

describe('audit fixes (D)', () => {
  it('Warehouse 23 fetches every printed Gadget or Artifact, wherever the data records its type', () => {
    // Flying Saucer, Eliza and Weather Satellite: the type is in the uniqueness footer;
    // Cyborg Soldiers, Earthquake Projector and The Frog God: the type is in the notes.
    for (const id of ['flying-saucer', 'eliza', 'weather-satellite', 'cyborg-soldiers', 'earthquake-projector', 'the-frog-god']) {
      let s = scenario();
      const w = give(s, 'p1', 'warehouse-23', { hand: true });
      const r = give(s, 'p1', id, { hand: true });
      s = act(s, 'p1', { type: 'playResource', card: w });
      s = use(s, 'p1', w, 'fetch', { target: r });
      expect(s.cards[r].zone, id).toBe('resources');
    }
  });

  it('Suicide Squad discards what it destroys, so a Unique Resource may come back later', () => {
    const seedFor = (face: number) => { for (let k = 0; ; k++) { const t = { rng: k } as GameState; if (rollDie(t) === face) return k; } };
    const s = scenario();
    const r = give(s, 'p1', 'suicide-squad', { resource: true });
    const t = give(s, 'p2', 'warehouse-23', { resource: true });
    s.rng = seedFor(1);
    const s1 = use(s, 'p1', r, 'strike', { target: t });
    expect(s1.cards[t].zone).toBe('discard');
    expect(s1.players[1].discard).toContain(t);
    expect(canEnterPlay(s1, t, 'p2')).toBe(true);
    s.rng = seedFor(4);
    const s4 = use(s, 'p1', r, 'strike', { target: t });
    expect(s4.players[0].discard).toContain(r);
  });
});
