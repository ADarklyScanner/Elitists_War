// Engine features used by the unusual cards: targets, events, choices, private reveals, extra turns,
// attacks made by cards.
import { describe, expect, it } from 'vitest';
import {
  actionSummary, advance, announcedAction, applyAction, askChoice, raiseEvent, registerChoice, registerPlots, respondToAction, revealTo,
  startCardAttack, waitingFor, power, structureCards,
  CARDS, PLOTS, type Action, type GameState,
} from '../src/engine';
import { plotOptions, targetPool, abilityOptions } from '../src/engine/moves';
import { viewFor } from '../src/server/service';
import { give, scenario, checkInvariants } from './helpers';
import { chooseAction } from '../src/ai/ai';

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

// A test-only Plot that answers announced actions by cancelling them.
CARDS['test-action-plot'] = { ...base, id: 'test-action-plot', name: 'Test Action Plot', subtype: '' };
registerPlots({
  'test-action-plot': {
    timing: ['event'], events: ['action'],
    check: (s) => (announcedAction(s) ? null : 'Only after an action is announced.'),
    apply: () => {},
    resolve: (s, pl, play) => respondToAction(s, pl, play.card, { t: 'fail' }),
  },
});

describe('announced actions', () => {
  const passAll = (s: GameState) => { for (let i = 0; i < 20 && s.window; i++) s = act(s, waitingFor(s)[0], { type: 'pass' }); return s; };
  const resource = CARDS['book-of-kells'];

  it('opens no window and happens at once when nobody can respond', () => {
    let s = scenario();
    give(s, 'p2', 'test-event-plot', { hand: true }); // answers takeovers only
    const g = give(s, 'p1', 'hollywood', { under: ill(s, 'p1'), side: 'BOTTOM' });
    s = act(s, 'p1', { type: 'move', group: g, onto: ill(s, 'p1'), side: 'LEFT', payWith: g });
    expect(s.window).toBeUndefined();
    expect(s.events ?? []).toEqual([]);
    expect(s.cards[g].side).toBe('LEFT');
    const r = give(s, 'p1', resource.id, { hand: true });
    s = act(s, 'p1', { type: 'playResource', card: r });
    expect(s.window).toBeUndefined();
    expect(s.cards[r].zone).toBe('resources');
  });
  it('waits for responses when a card can answer, then carries the action out', () => {
    let s = scenario();
    give(s, 'p2', 'test-action-plot', { hand: true });
    const g = give(s, 'p1', 'hollywood', { under: ill(s, 'p1'), side: 'BOTTOM' });
    s = act(s, 'p1', { type: 'move', group: g, onto: ill(s, 'p1'), side: 'LEFT', payWith: g });
    expect(s.window?.kind).toBe('event');
    expect(s.window?.event).toMatchObject({ type: 'action', player: 'p1', cards: [g], data: { kind: 'move' } });
    expect(actionSummary(s, s.window!.event!)).toContain('Hollywood');
    expect(s.cards[g].side).toBe('BOTTOM');
    expect(s.cards[g].tokens).toBe(0); // the cost is paid when the action is announced
    s = passAll(s);
    expect(s.cards[g].side).toBe('LEFT');
    checkInvariants(s);
  });
  it('a cancelled action never happens, but its costs stay paid and a once-per-turn action may be retried', () => {
    let s = scenario();
    const p = give(s, 'p2', 'test-action-plot', { hand: true });
    const r = give(s, 'p1', resource.id, { hand: true });
    s.cards[ill(s, 'p1')].tokens = 2;
    s = act(s, 'p1', { type: 'playResource', card: r });
    expect(s.window?.event?.type).toBe('action');
    s = act(s, 'p2', { type: 'playPlot', play: { card: p } });
    s = passAll(s);
    expect(s.cards[p].zone).toBe('discard');
    expect(hand(s, 'p1')).toContain(r);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(1);
    expect(s.turnFlags.resourcePlayed).toBe(false);
    s = act(s, 'p1', { type: 'playResource', card: r });
    expect(s.cards[r].zone).toBe('resources');
    checkInvariants(s);
  });
  it('buying a Plot is not an action and is never announced', () => {
    let s = scenario();
    give(s, 'p2', 'test-action-plot', { hand: true });
    const before = hand(s, 'p1').length;
    s = act(s, 'p1', { type: 'buyPlot', payWith: [ill(s, 'p1')] });
    expect(s.window).toBeUndefined();
    expect(hand(s, 'p1').length).toBe(before + 1);
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

describe('drawing by hand at the start of a person\'s turn', () => {
  /** p1 is a person; play until p1's next turn begins. */
  function toMyTurn() {
    let s = scenario();
    s.players[0].isAI = false;
    s = act(s, 'p1', { type: 'endTurn' });
    for (let i = 0; i < 200 && !(s.prompt?.kind === 'draw' && s.prompt.player === 'p1'); i++) {
      const w = waitingFor(s)[0];
      s = act(s, w, w === 'p1' ? { type: 'pass' } : chooseAction(s, w));
    }
    return s;
  }
  it('waits for the person to draw from each deck, then carries on', () => {
    let s = toMyTurn();
    expect(s.prompt).toMatchObject({ kind: 'draw', player: 'p1' });
    const before = hand(s, 'p1').length;
    const plots = (s.prompt!.data as { plot: number }).plot; // 1, or more with a card that grants extra draws
    for (let i = 0; i < plots; i++) s = act(s, 'p1', { type: 'draw', deck: 'plot' });
    expect(hand(s, 'p1').length).toBe(before + plots);
    expect(() => act(s, 'p1', { type: 'draw', deck: 'plot' })).toThrow(/already drawn/);
    s = act(s, 'p1', { type: 'draw', deck: 'group' });
    expect(hand(s, 'p1').length).toBe(before + plots + 1);
    expect(s.prompt?.kind).not.toBe('draw');
    expect(s.log.some((l) => new RegExp(`draws ${plots} Plot cards? and 1 Group card`).test(l.text))).toBe(true);
    checkInvariants(s);
  });
  it('the draws are optional: skipping keeps the hand as it was', () => {
    let s = toMyTurn();
    const before = hand(s, 'p1').length;
    s = act(s, 'p1', { type: 'skipDraw' });
    expect(hand(s, 'p1').length).toBe(before);
    expect(s.prompt?.kind).not.toBe('draw');
  });
  it('computer players still draw automatically', () => {
    const s = toMyTurn();
    expect(s.log.some((l) => l.player === 'p2' && /draws 1 Plot card/.test(l.text))).toBe(true);
  });
});

describe('audit fixes', () => {
  it('abilityOptions fills payWith for a Relief ability that needs helper Groups', () => {
    const s = scenario();
    const nato = give(s, 'p1', 'nato', { under: s.players[0].illuminati, side: 'LEFT' });
    const helper = give(s, 'p1', 'hollywood', { under: s.players[0].illuminati, side: 'TOP' });
    const place = give(s, 'p1', 'china', { under: s.players[0].illuminati, side: 'BOTTOM' });
    s.cards[place].devastated = true;
    // NATO alone (3x its own Power) is not enough for China's need (3x4=12); it needs the helper too.
    const need = 3 * CARDS['china'].power!;
    expect(3 * CARDS['nato'].power!).toBeLessThan(need);
    const opts = abilityOptions(s, 'p1', nato);
    const relief = opts.find((o) => o.action.type === 'useAbility' && o.action.ability === 'relief');
    expect(relief).toBeTruthy();
    const action = relief!.action as Extract<Action, { type: 'useAbility' }>;
    expect(action.params?.payWith).toContain(helper);
    const next = act(s, 'p1', action);
    expect(next.cards[place].devastated).toBe(false);
  });

  it('Boy Sprouts\' Relief still respects the Corruption Plot\'s "no Relief yet" block', () => {
    const s = scenario();
    const sprouts = give(s, 'p1', 'boy-sprouts', { under: s.players[0].illuminati, side: 'LEFT' });
    const place = give(s, 'p1', 'hollywood', { under: s.players[0].illuminati, side: 'BOTTOM' });
    s.cards[place].devastated = true;
    s.cards[place].data = { ...s.cards[place].data, noReliefUntilTurn: s.turn + 5 };
    expect(() => act(s, 'p1', { type: 'useAbility', card: sprouts, ability: 'relief', params: { target: place, payWith: [] } }))
      .toThrow(/No Relief can be sent there yet/);
    expect(abilityOptions(s, 'p1', sprouts).some((o) => o.action.type === 'useAbility' && o.action.ability === 'relief')).toBe(false);
  });

  it('buying a Plot is legal at any time, including a rival\'s turn and a response window', () => {
    let s = scenario();
    s.active = 1; // p2's turn
    const ill1 = ill(s, 'p1');
    s.cards[ill1].tokens = 1;
    const before = s.players[0].plotDeck.length;
    const next = act(s, 'p1', { type: 'buyPlot', payWith: [ill1] });
    expect(next.players[0].plotDeck.length).toBe(before - 1);
  });

  it('a move may pay with no Group at all when it is free (Reorganization Plot, Bermuda Triangle)', () => {
    const s = scenario();
    const ill1 = ill(s, 'p1');
    const g1 = give(s, 'p1', 'hollywood', { under: ill1, side: 'TOP' });
    s.cards[g1].tokens = 0; // no Group anywhere has a token
    s.turnFlags.freeMoves = 'p1';
    const open = structureCards(s, 'p1').filter((c) => c !== g1);
    void open;
    // Move g1 back onto its own Illuminati's other arrow: still needs an open arrow, but no payer.
    expect(() => act(s, 'p1', { type: 'move', group: g1, onto: ill1, side: 'LEFT' })).not.toThrow();
  });

  it('a Group may voluntarily discard any card from its hand at any time (R048)', () => {
    const s = scenario();
    const grp = give(s, 'p1', 'hollywood', { hand: true });
    expect(hand(s, 'p1')).toContain(grp);
    const next = act(s, 'p1', { type: 'discard', cards: [grp] });
    expect(hand(next, 'p1')).not.toContain(grp);
    expect(next.players[0].discard).toContain(grp);
  });

  it('a Plot may voluntarily be returned to the deck at a chosen position (R048)', () => {
    const s = scenario();
    const plotCard = Object.values(CARDS).find((c) => c.type === 'Plot' && PLOTS[c.id])!.id;
    const iid = give(s, 'p1', plotCard, { hand: true });
    s.players[0].plotDeck = ['x1', 'x2', 'x3'];
    const next = act(s, 'p1', { type: 'discard', cards: [iid], toDeck: true, position: 'top' });
    expect(next.players[0].plotDeck[0]).toBe(iid);
    const s2 = scenario();
    const iid2 = give(s2, 'p1', plotCard, { hand: true });
    s2.players[0].plotDeck = ['y1', 'y2', 'y3'];
    const next2 = act(s2, 'p1', { type: 'discard', cards: [iid2], toDeck: true, position: 'bottom' });
    expect(next2.players[0].plotDeck[next2.players[0].plotDeck.length - 1]).toBe(iid2);
  });

  it('a Plot may voluntarily be exposed at any time (R048)', () => {
    const s = scenario();
    const plotCard = Object.values(CARDS).find((c) => c.type === 'Plot' && PLOTS[c.id])!.id;
    const iid = give(s, 'p1', plotCard, { hand: true });
    expect(s.cards[iid].exposed).toBeFalsy();
    const next = act(s, 'p1', { type: 'exposeCard', card: iid });
    expect(next.cards[iid].exposed).toBe(true);
  });
});
