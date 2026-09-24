// Engine features used by the unusual cards: targets, events, choices, private reveals, extra turns,
// attacks made by cards.
import { describe, expect, it } from 'vitest';
import {
  advance, applyAction, askChoice, raiseEvent, registerChoice, registerPlots, revealTo, startCardAttack, waitingFor,
  CARDS, PLOTS, type Action, type GameState,
} from '../src/engine';
import { plotOptions, targetPool } from '../src/engine/moves';
import { viewFor } from '../src/server/service';
import { give, scenario, checkInvariants } from './helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const hand = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.hand;

// A test-only Plot that answers takeover events.
const base = Object.values(CARDS).find((c) => c.type === 'Plot')!;
CARDS['test-event-plot'] = { ...base, id: 'test-event-plot', name: 'Test Event Plot', subtype: '' };
let heard: string[] = [];
registerPlots({
  'test-event-plot': {
    timing: ['event'], events: ['takeover'],
    check: (s) => (s.window?.kind === 'event' ? null : 'Only after a takeover.'),
    apply: () => {},
    resolve: (s) => { heard.push(String(s.window?.event?.type ?? 'resolved')); },
  },
});

describe('target pools', () => {
  it('lists hand cards, rivals, resources and destroyed Groups', () => {
    const s = scenario();
    const h = give(s, 'p1', 'hollywood', { hand: true });
    const r = give(s, 'p2', 'hollywood', { hand: true });
    const res = Object.values(CARDS).find((c) => c.type === 'Resource')!;
    const rs = give(s, 'p1', res.id, { resource: true });
    const d = give(s, 'p2', 'fbi', { hand: true });
    s.players[1].hand = s.players[1].hand.filter((x) => x !== d);
    s.cards[d].zone = 'destroyed';
    expect(targetPool(s, 'p1', 'handGroup')).toEqual([h]);
    expect(targetPool(s, 'p1', 'rival')).toEqual([ill(s, 'p2')]);
    expect(targetPool(s, 'p1', 'rivalHand')).toEqual([r]);
    expect(targetPool(s, 'p1', 'resource')).toEqual([rs]);
    expect(targetPool(s, 'p1', 'destroyed')).toEqual([d]);
  });
  it('offers a Plot once per target of the new kinds', () => {
    const s = scenario();
    PLOTS['test-hand-plot'] = { timing: ['anytime'], needs: { target: 'handGroup' }, check: () => null, apply: () => {} };
    CARDS['test-hand-plot'] = { ...base, id: 'test-hand-plot', name: 'Test Hand Plot', subtype: '' };
    const p = give(s, 'p1', 'test-hand-plot', { hand: true });
    give(s, 'p1', 'hollywood', { hand: true });
    give(s, 'p1', 'fbi', { hand: true });
    expect(plotOptions(s, 'p1', p).length).toBe(2);
    delete PLOTS['test-hand-plot'];
  });
});

describe('choices', () => {
  it('asks, queues, hides from others and resolves', () => {
    let s = scenario();
    const got: string[][] = [];
    registerChoice('test-pick', { resolve: (_s, _pl, picked) => { got.push(picked); } });
    const opts = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
    askChoice(s, 'p2', { key: 'test-pick', question: 'Pick', options: opts, min: 1, max: 1 });
    askChoice(s, 'p1', { key: 'test-pick', question: 'Pick again', options: opts, min: 1, max: 1 });
    expect(waitingFor(s)).toEqual(['p2']);
    expect(viewFor(s, 'p1').prompt!.choice!.options).toEqual([]);
    expect(viewFor(s, 'p2').prompt!.choice!.options.length).toBe(2);
    expect(() => act(s, 'p2', { type: 'choose', ids: ['a', 'b'] })).toThrow();
    s = act(s, 'p2', { type: 'choose', ids: ['b'] });
    expect(waitingFor(s)).toEqual(['p1']);
    s = act(s, 'p1', { type: 'choose', ids: ['a'] });
    expect(got).toEqual([['b'], ['a']]);
    expect(s.prompt).toBeUndefined();
  });
});

describe('private reveals', () => {
  it('shows cards only to the player who looked', () => {
    const s = scenario();
    const c = give(s, 'p2', 'hollywood', { hand: true });
    revealTo(s, 'p1', [c], 'You looked at');
    expect(viewFor(s, 'p1').cards[c].cardId).toBe('hollywood');
    expect(viewFor(s, 'p1').log.at(-1)!.text).toContain('Hollywood');
    const other = viewFor(s, 'p2');
    expect(other.log.some((l) => l.to === 'p1')).toBe(false);
  });
});

describe('events', () => {
  it('opens a response window only when someone holds a matching Plot', () => {
    const s = scenario();
    raiseEvent(s, { type: 'takeover', player: 'p1' });
    expect(s.events ?? []).toEqual([]);
    give(s, 'p2', 'test-event-plot', { hand: true });
    raiseEvent(s, { type: 'destroyed', player: 'p1' });
    expect(s.events ?? []).toEqual([]);
    raiseEvent(s, { type: 'takeover', player: 'p1' });
    expect(s.events!.length).toBe(1);
  });
  it('lets the holder play the Plot in the event window, then carries on', () => {
    let s = scenario();
    heard = [];
    const p = give(s, 'p2', 'test-event-plot', { hand: true });
    raiseEvent(s, { type: 'takeover', player: 'p1' });
    advance(s);
    expect(s.window?.kind).toBe('event');
    expect(waitingFor(s)).toContain('p2');
    s = act(s, 'p2', { type: 'playPlot', play: { card: p } });
    for (let i = 0; i < 10 && s.window; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
    expect(s.cards[p].zone).toBe('discard');
    checkInvariants(s);
  });
});

describe('extra turns', () => {
  it('gives the player another turn, then play resumes in seat order', () => {
    let s = scenario();
    s.extraTurnFor = 'p1';
    s = act(s, 'p1', { type: 'endTurn' });
    for (let i = 0; i < 20 && s.players[s.active].id !== 'p1' || (s.window && i < 20); i++) {
      if (!waitingFor(s).length) break;
      const w = waitingFor(s)[0];
      s = act(s, w, s.prompt?.kind === 'takeover' ? { type: 'skipTakeover' } : { type: 'pass' });
    }
    expect(s.players[s.active].id).toBe('p1');
    expect(s.turnFlags.extraTurn).toBe(true);
  });
});

describe('attacks by cards', () => {
  it('attacks with the card\'s own Power', () => {
    const s = scenario();
    const g = give(s, 'p2', 'hollywood', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const p = give(s, 'p1', 'test-event-plot', { hand: true });
    hand(s, 'p1').splice(hand(s, 'p1').indexOf(p), 1);
    s.cards[p].zone = 'table';
    startCardAttack(s, 'p1', { plot: p, target: g, power: 8, aidRule: 'defenderOnly' });
    expect(s.attack!.cardPower).toBe(8);
    expect(s.attack!.attacker).toBeUndefined();
    expect(s.window?.kind).toBe('attack');
  });
});
