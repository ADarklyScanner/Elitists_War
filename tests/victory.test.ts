// Declaring victory (R016): the claim is made after the knock, everyone else may try to stop it,
// and only then is it decided.
import { describe, expect, it } from 'vitest';
import {
  applyAction, attackStrength, createGame, declareBlocked, declareOptions, goalCount, goalOptions, hasResponse, openArrows,
  victoryReminder, waitingFor, type Action, type GameState, CARDS,
} from '../src/engine';
import { randomDeck } from '../src/engine/decks';
import { chooseAction } from '../src/ai/ai';
import { MemoryStore } from '../src/server/memoryStore';
import { joinTable, newTable, setOrders, submit, viewFor } from '../src/server/service';
import { give, scenario } from './helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
/** Everyone passes until the declared victories are decided (dice forced if given). */
function passAll(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 40 && s.phase !== 'gameOver' && (s.claims?.length || s.attack); i++) {
    if (dice && s.window?.kind === 'roll' && s.attack?.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** p1 controls exactly enough Groups for the Basic Goal. */
function readyToWin(): GameState {
  const s = scenario();
  give(s, 'p1', 'loan-sharks', { under: s.players[0].illuminati, side: 'BOTTOM' });
  s.settings.basicGoal = goalCount(s, 'p1');
  return s;
}
function threeWay(): GameState {
  const s = createGame({ seed: 11, players: ['p1', 'p2', 'p3'].map((id, i) => ({ id, name: id.toUpperCase(), isAI: true, deck: randomDeck(90 + i) })) });
  for (const c of Object.values(s.cards)) {
    if ((c.zone === 'structure' && CARDS[c.cardId].type === 'Group') || c.zone === 'hand') delete s.cards[c.iid];
  }
  for (const p of s.players) { p.turnsTaken = 1; p.hand = []; s.cards[p.illuminati].tokens = 1; }
  s.active = 0; s.phase = 'main'; s.prompt = undefined; s.window = undefined; s.round = 3; s.nwo = {};
  return s;
}

describe('declaring victory (R016)', () => {
  it('nobody can declare in the first round, even with enough Groups', () => {
    const s0 = readyToWin();
    s0.round = 1;
    expect(declareOptions(s0, 'p1')).toEqual([]);
    expect(() => act(s0, 'p1', { type: 'declareVictory', goal: 'basic' })).toThrow(/round 1/);
    const s = act(s0, 'p1', { type: 'endTurn' });
    expect(() => act(s, 'p1', { type: 'declareVictory', goal: 'basic' })).toThrow(/round 1/);
  });

  it('the first chance is at the end of the first player\'s second turn (round 2)', () => {
    const s0 = readyToWin();
    s0.round = 2;
    expect(declareOptions(s0, 'p1').map((o) => o.id)).toEqual(['basic']);
  });

  it('a Goal that is not met cannot be declared, and nothing is declared for you', () => {
    const s0 = readyToWin();
    s0.settings.basicGoal += 1;
    expect(() => act(s0, 'p1', { type: 'declareVictory', goal: 'basic' })).toThrow(/do not meet/);
    expect(() => act(s0, 'p1', { type: 'declareVictory', goal: 'nonsense' })).toThrow(/not one of your Goals/);
  });

  it('only at the end of a turn: not in a rival\'s main phase, nor during an attack', () => {
    const s0 = readyToWin();
    expect(declareBlocked(s0, 'p2')).toMatch(/end of a turn/);
    const tgt = give(s0, 'p2', 'boy-sprouts', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: s0.players[0].illuminati, target: tgt });
    expect(s.attack).toBeDefined();
    expect(() => act(s, 'p1', { type: 'declareVictory', goal: 'basic' })).toThrow(/end of a turn/);
  });

  it('declaring as you knock ends your turn; the claim wins when every rival passes', () => {
    const s0 = readyToWin();
    let s = act(s0, 'p1', { type: 'declareVictory', goal: 'basic' });
    expect(s.phase).toBe('endOfTurn');
    expect(s.claims).toEqual([{ player: 'p1', goals: ['basic'], labels: [expect.stringMatching(/Basic Goal/)] }]);
    expect(waitingFor(s)).toEqual(['p2']);
    s = act(s, 'p2', { type: 'pass' });
    expect(s.phase).toBe('gameOver');
    expect(s.winners).toEqual(['p1']);
    expect(s.log.some((l) => /shows all Plots/.test(l.text))).toBe(true);
  });

  it('a player may also declare after knocking, while the end-of-turn window is open', () => {
    const s0 = readyToWin();
    let s = act(s0, 'p1', { type: 'endTurn' });
    s = act(s, 'p1', { type: 'declareVictory', goal: 'basic' });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.winners).toEqual(['p1']);
  });

  it('a rival may declare at the end of someone else\'s turn', () => {
    const s0 = scenario();
    give(s0, 'p2', 'loan-sharks', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    s0.settings.basicGoal = goalCount(s0, 'p2');
    let s = act(s0, 'p1', { type: 'endTurn' });
    expect(declareOptions(s, 'p2').map((o) => o.id)).toContain('basic');
    s = act(s, 'p2', { type: 'declareVictory', goal: 'basic' });
    expect(waitingFor(s)).toEqual(['p1']);
    s = act(s, 'p1', { type: 'pass' });
    expect(s.winners).toEqual(['p2']);
  });

  it('a rival stops the claim with an Instant attack (a Disaster Plot): the turn then ends normally', () => {
    const s0 = scenario();
    const ls = give(s0, 'p1', 'loan-sharks', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const place = give(s0, 'p1', 'hollywood', { under: ls, side: openArrows(s0, ls)[0] });
    s0.cards[place].mods.push({ source: 'test', kind: 'power', value: -20, until: 'permanent' });
    s0.settings.basicGoal = goalCount(s0, 'p1');
    const tornado = give(s0, 'p2', 'tornado', { hand: true });
    let s = act(s0, 'p1', { type: 'declareVictory', goal: 'basic' });
    // Rivals may launch Instant attacks in answer to a declared victory.
    s = act(s, 'p2', { type: 'playPlot', play: { card: tornado, target: place } });
    expect(s.attack?.instant).toBe(true);
    expect(attackStrength(s, s.attack!).strength).toBeGreaterThanOrEqual(2);
    s = passAll(s, [1, 1]);
    expect(s.phase).not.toBe('gameOver');
    expect(s.claims).toBeUndefined();
    expect(s.players[s.active].id).toBe('p2');
    expect(s.log.some((l) => /claim of victory fails/.test(l.text))).toBe(true);
  });

  it('a rival stops the claim with an Assassination', () => {
    const s0 = scenario();
    const ls = give(s0, 'p1', 'loan-sharks', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const gore = give(s0, 'p1', 'al-gore', { under: ls, side: openArrows(s0, ls)[0] });
    s0.cards[gore].mods.push({ source: 'test', kind: 'power', value: -20, until: 'permanent' });
    s0.settings.basicGoal = goalCount(s0, 'p1');
    const snipe = give(s0, 'p2', 'car-bomb', { hand: true });
    let s = act(s0, 'p1', { type: 'declareVictory', goal: 'basic' });
    s = act(s, 'p2', { type: 'playPlot', play: { card: snipe, target: gore } });
    expect(s.attack?.assassination).toBe(true);
    expect(attackStrength(s, s.attack!).strength).toBeGreaterThanOrEqual(2);
    s = passAll(s, [1, 1]);
    expect(s.cards[gore].zone).toBe('destroyed');
    expect(s.phase).not.toBe('gameOver');
  });

  it('a failed claim with a Goal card leaves the card in hand, exposed', () => {
    const s0 = scenario();
    s0.settings.basicGoal = 20;
    const goal = give(s0, 'p1', 'criminal-overlords', { hand: true });
    const ill = s0.players[0].illuminati;
    s0.settings.basicGoal = 5;
    give(s0, 'p1', 'loan-sharks', { under: ill, side: 'BOTTOM' });
    const mafia = give(s0, 'p1', 'the-mafia', { under: ill, side: 'LEFT' });
    const opt = goalOptions(s0, 'p1').find((o) => o.id === goal)!;
    expect(opt.met).toBe(true);
    let s = act(s0, 'p1', { type: 'declareVictory', goal });
    expect(s.cards[goal].exposed).toBe(true);
    // Rivals see it at once online (it is shown, not played).
    expect(viewFor(s, 'p2').cards[goal].cardId).toBe('criminal-overlords');
    // Thwarted: the Mafia leaves play (as if destroyed by a rival's card).
    s = structuredClone(s);
    s.cards[mafia].devastated = true;
    s = act(s, 'p2', { type: 'pass' });
    expect(s.phase).not.toBe('gameOver');
    expect(s.players[0].hand).toContain(goal);
    expect(s.cards[goal].exposed).toBe(true);
    expect(s.log.some((l) => /goes back into .* hand, exposed/.test(l.text))).toBe(true);
  });

  it('a shown Goal card cannot be taken or affected while the claim is being decided', () => {
    const s0 = scenario();
    const goal = give(s0, 'p1', 'criminal-overlords', { hand: true });
    const ill = s0.players[0].illuminati;
    s0.settings.basicGoal = 5;
    give(s0, 'p1', 'loan-sharks', { under: ill, side: 'BOTTOM' });
    give(s0, 'p1', 'the-mafia', { under: ill, side: 'LEFT' });
    const s = act(s0, 'p1', { type: 'endTurn' });
    const t = act(s, 'p1', { type: 'declareVictory', goal });
    const grab = give(t, 'p2', 'nice-idea-it-s-mine-now', { hand: true });
    t.active = 1; // even on the rival's own turn the shown card stays out of reach
    expect(() => act(t, 'p2', { type: 'playPlot', play: { card: grab, target: goal } })).toThrow(/shown for a victory claim/);
  });

  it('special goals: the Illuminati\'s own Special Goal can be declared', () => {
    const s0 = scenario();
    const ill = s0.players[0].illuminati;
    s0.cards[ill].cardId = 'servants-of-cthulhu';
    give(s0, 'p1', 'loan-sharks', { under: ill, side: 'BOTTOM' });
    s0.settings.basicGoal = 99;
    for (let i = 0; i < 8; i++) s0.players[0].destroyedCredit.push(`gone${i}`);
    const opts = goalOptions(s0, 'p1');
    expect(opts.find((o) => o.id === 'basic')?.met).toBe(false);
    expect(opts.find((o) => o.id === 'special')).toMatchObject({ met: true, label: expect.stringMatching(/Special Goal: 8 Groups destroyed/) });
    let s = act(s0, 'p1', { type: 'declareVictory', goal: 'special' });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.winners).toEqual(['p1']);
  });

  it('two players who both declare and are not stopped share the victory', () => {
    const s0 = threeWay();
    for (const pl of ['p1', 'p2']) give(s0, pl, 'loan-sharks', { under: s0.players.find((p) => p.id === pl)!.illuminati, side: 'BOTTOM' });
    s0.cards[s0.players[0].illuminati].cardId = 'bavarian-illuminati';
    s0.cards[s0.players[1].illuminati].cardId = 'gnomes-of-zurich';
    s0.cards[s0.players[2].illuminati].cardId = 'the-network';
    s0.settings.basicGoal = 2;
    let s = act(s0, 'p1', { type: 'declareVictory', goal: 'basic' });
    s = act(s, 'p2', { type: 'declareVictory', goal: 'basic' });
    s = passAll(s);
    expect(s.winners?.sort()).toEqual(['p1', 'p2']);
    expect(s.log.some((l) => /share the victory/.test(l.text))).toBe(true);
  });

  it('factions of the same Illuminati cannot share: neither wins, but a third claimant still does', () => {
    const s0 = threeWay();
    for (const p of s0.players) give(s0, p.id, 'loan-sharks', { under: p.illuminati, side: 'BOTTOM' });
    s0.cards[s0.players[0].illuminati].cardId = 'bavarian-illuminati';
    s0.cards[s0.players[1].illuminati].cardId = 'bavarian-illuminati';
    s0.cards[s0.players[2].illuminati].cardId = 'gnomes-of-zurich';
    s0.settings.basicGoal = 2;
    let s = act(s0, 'p1', { type: 'declareVictory', goal: 'basic' });
    s = act(s, 'p2', { type: 'declareVictory', goal: 'basic' });
    const noThird = passAll(structuredClone(s));
    expect(noThird.phase).not.toBe('gameOver');
    s = act(s, 'p3', { type: 'declareVictory', goal: 'basic' });
    s = passAll(s);
    expect(s.winners).toEqual(['p3']);
  });

  it('a turn cut short by a card cannot end in a victory', () => {
    const s0 = readyToWin();
    s0.turnFlags.endedAtOnce = true;
    expect(declareBlocked(s0, 'p1')).toMatch(/cut short/);
  });

  it('the reminder is off by default and follows the setting', () => {
    const s0 = readyToWin();
    expect(victoryReminder(s0, 'p1')).toEqual([]);
    s0.settings.victoryReminder = true;
    expect(victoryReminder(s0, 'p1').map((o) => o.id)).toEqual(['basic']);
    // Declaring is a possible response, so "pass for me" never skips it.
    const s = act(s0, 'p1', { type: 'endTurn' });
    expect(hasResponse(s, 'p1')).toBe(true);
  });
});

describe('computer players and victory', () => {
  it('a computer declares as soon as it may', () => {
    const s0 = readyToWin();
    expect(chooseAction(s0, 'p1')).toEqual({ type: 'declareVictory', goal: 'basic' });
    s0.round = 1;
    expect(chooseAction(s0, 'p1').type).not.toBe('declareVictory');
  });

  it('a computer spends an Instant attack to stop a rival\'s claim', () => {
    const s0 = scenario();
    const ls = give(s0, 'p1', 'loan-sharks', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const place = give(s0, 'p1', 'hollywood', { under: ls, side: openArrows(s0, ls)[0] });
    s0.cards[place].mods.push({ source: 'test', kind: 'power', value: -20, until: 'permanent' });
    s0.settings.basicGoal = goalCount(s0, 'p1');
    const tornado = give(s0, 'p2', 'tornado', { hand: true });
    const s = act(s0, 'p1', { type: 'declareVictory', goal: 'basic' });
    const a = chooseAction(s, 'p2');
    expect(a).toMatchObject({ type: 'playPlot', play: { card: tornado, target: place } });
  });

  it('the claiming computer defends its claim like any attack', () => {
    const s0 = scenario();
    const ls = give(s0, 'p1', 'loan-sharks', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    s0.settings.basicGoal = goalCount(s0, 'p1');
    const s = act(s0, 'p1', { type: 'declareVictory', goal: 'basic' });
    // With nothing that can stop it, the rival lets it stand (or buys a Plot to look for an answer).
    expect(['pass', 'buyPlot']).toContain(chooseAction(s, 'p2').type);
    void ls;
  });
});

describe('online: declaring victory through the service', () => {
  it('the claim is shown to the rival, who answers, and the win is recorded', async () => {
    const store = new MemoryStore();
    const t = await newTable(store, { userId: 'ann', name: 'Ann', illuminati: 'bavarian-illuminati' }, { seats: 2 });
    await joinTable(store, t.invite, { userId: 'bob', name: 'Bob', illuminati: 'ufos' });
    await setOrders(store, t.id, 'bob', { passWhenNothing: false });
    const rec = (await store.get(t.id))!;
    const s = scenario();
    for (const p of s.players) p.isAI = false;
    const goal = give(s, 'p1', 'criminal-overlords', { hand: true });
    s.settings.basicGoal = 5;
    give(s, 'p1', 'loan-sharks', { under: s.players[0].illuminati, side: 'BOTTOM' });
    give(s, 'p1', 'the-mafia', { under: s.players[0].illuminati, side: 'LEFT' });
    s.cards[s.players[0].illuminati].cardId = 'bavarian-illuminati';
    s.cards[s.players[1].illuminati].cardId = 'ufos';
    expect(goalOptions(s, 'p1').find((o) => o.id === goal)?.met).toBe(true);
    rec.state = s;
    await store.put(rec);
    // Before the claim Bob cannot see Ann's Goal card.
    expect(viewFor(s, 'p2').cards[goal].cardId).toBe('hidden-plot');
    let after = await submit(store, t.id, 'ann', { type: 'declareVictory', goal });
    expect(after.state!.phase).toBe('endOfTurn');
    const bobView = viewFor(after.state!, 'p2');
    expect(bobView.claims?.[0]).toMatchObject({ player: 'p1', goals: [goal] });
    expect(bobView.cards[goal].cardId).toBe('criminal-overlords');
    expect(waitingFor(after.state!)).toEqual(['p2']);
    await expect(submit(store, t.id, 'ann', { type: 'pass' })).rejects.toThrow();
    after = await submit(store, t.id, 'bob', { type: 'pass' });
    expect(after.state!.phase).toBe('gameOver');
    expect(after.state!.winners).toEqual(['p1']);
  });
});
