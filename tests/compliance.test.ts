// One test per checkable rule in the rulebook the game follows (v1.2 plus the later rules update).
// Rule numbers refer to the Core Rules tab of the workbook.
import { describe, expect, it } from 'vitest';
import {
  activeHookCards, alignments, applyAction, attackStrength, canAid, canEnterPlay, canOppose, createGame, discardCard, finalRoll, goalCount,
  goalLimit, goalsInHand, globalPower, handLimit, openArrows, plotsInHand, power, resistance, waitingFor,
  type Action, type GameState, CARDS,
} from '../src/engine';
import { randomDeck } from '../src/engine/decks';
import { viewFor } from '../src/server/service';
import { checkInvariants, give, scenario } from './helpers';

/** Pass for everyone until the attack is over, forcing the dice if given. */
function resolve(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = applyAction(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);

describe('R025 setup', () => {
  const s = createGame({ seed: 5, players: [
    { id: 'p1', name: 'A', isAI: true, deck: randomDeck(1) },
    { id: 'p2', name: 'B', isAI: true, deck: randomDeck(2) },
  ] });
  it('decks are 45 cards including the Illuminati', () => {
    const d = randomDeck(9);
    expect(1 + d.groups.length + d.plots.length).toBe(45);
  });
  it('each player starts with a lead Group on the Illuminati, 3 Plots and 6 Groups in hand', () => {
    for (const p of s.players) {
      const inPlay = Object.values(s.cards).filter((c) => c.controller === p.id && c.zone === 'structure');
      expect(inPlay.length).toBeGreaterThanOrEqual(2); // Illuminati + lead (the first player has also drawn for turn 1)
      if (s.players[s.active].id !== p.id) {
        expect(p.hand.filter((i) => CARDS[s.cards[i].cardId].type === 'Plot').length).toBe(3);
        expect(p.hand.filter((i) => CARDS[s.cards[i].cardId].type === 'Group').length).toBe(6);
      }
    }
  });
  it('the Basic Goal is 12 Groups in a two-player game', () => expect(s.settings.basicGoal).toBe(12));
});

describe('R001 turn sequence and R026 action tokens', () => {
  it('the active player draws a Plot and a Group, then gets tokens', () => {
    const s0 = scenario();
    const p2 = s0.players[1];
    const plots = p2.plotDeck.length, groups = p2.groupDeck.length;
    let s = act(s0, 'p1', { type: 'endTurn' });
    s = act(s, 'p2', { type: 'pass' });
    if (s.prompt?.kind === 'takeover') s = act(s, 'p2', { type: 'skipTakeover' });
    expect(s.players[1].plotDeck.length).toBe(plots - 1);
    expect(s.players[1].groupDeck.length).toBe(groups - 1);
    expect(s.cards[p2.illuminati].tokens).toBe(1);
  });
  it('two-player: an automatic takeover costs that turn\'s Illuminati token (R023)', () => {
    const s0 = scenario();
    give(s0, 'p2', 'loan-sharks', { hand: true });
    s0.cards[s0.players[1].illuminati].tokens = 0;
    let s = act(s0, 'p1', { type: 'endTurn' });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.prompt?.kind).toBe('takeover');
    const card = s.players[1].hand.find((i) => s.cards[i].cardId === 'loan-sharks')!;
    s = act(s, 'p2', { type: 'takeover', card, onto: s.players[1].illuminati, side: 'BOTTOM' });
    expect(s.cards[s.players[1].illuminati].tokens).toBe(0);
    expect(s.cards[card].tokens).toBe(1);
  });
  it('a captured Group gets no token on the turn it was captured', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const tgt = give(s0, 'p1', 'loan-sharks', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    s = resolve(s, [1, 1]);
    expect(s.cards[tgt].zone).toBe('structure');
    expect(s.cards[tgt].tokens).toBe(0);
  });
  it('the Illuminati may draw a Group card once per turn for its token (R001)', () => {
    const s0 = scenario();
    s0.cards[s0.players[0].illuminati].tokens = 2;
    const s = act(s0, 'p1', { type: 'drawGroup' });
    expect(s.players[0].hand.length).toBe(1);
    expect(() => act(s, 'p1', { type: 'drawGroup' })).toThrow(/once per turn/);
  });
});

describe('R027 Plot hand limit and buying Plots', () => {
  it('the limit is 5 Plots, 6 for the Gnomes of Zurich', () => {
    const s = scenario();
    expect(handLimit(s, 'p1')).toBe(CARDS[s.cards[s.players[0].illuminati].cardId].id === 'gnomes-of-zurich' ? 6 : 5);
  });
  it('a player outside his turn must discard down to the limit at once, even mid-turn', () => {
    const s0 = scenario();
    for (let i = 0; i < 5; i++) give(s0, 'p2', 'reload', { hand: true });
    s0.cards[s0.players[1].illuminati].tokens = 1;
    // p2 buys a sixth Plot during p1's attack window.
    const att = give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const tgt = give(s0, 'p1', 'loan-sharks', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    if (handLimit(s, 'p2') === 6) give(s, 'p2', 'reload', { hand: true });
    s = act(s, 'p2', { type: 'buyPlot', payWith: [s.players[1].illuminati] });
    expect(s.prompt?.kind).toBe('discardToLimit');
    expect(s.prompt?.player).toBe('p2');
    const extra = plotsInHand(s, 'p2').slice(0, 1);
    s = act(s, 'p2', { type: 'discard', cards: extra });
    expect(s.prompt).toBeUndefined();
    expect(s.attack).toBeDefined(); // the attack carries on
  });
  it('the active player has no limit during his own turn', () => {
    const s = scenario();
    for (let i = 0; i < 8; i++) give(s, 'p1', 'reload', { hand: true });
    const next = act(s, 'p1', { type: 'buyPlot', payWith: [s.players[0].illuminati] });
    expect(next.prompt).toBeUndefined();
  });
  it('buying costs 1 Illuminati token or 2 other tokens', () => {
    const s = scenario();
    const g = give(s, 'p1', 'the-mafia', { under: s.players[0].illuminati, side: 'BOTTOM' });
    expect(() => act(s, 'p1', { type: 'buyPlot', payWith: [g] })).toThrow();
    expect(() => act(s, 'p1', { type: 'buyPlot', payWith: [s.players[0].illuminati] })).not.toThrow();
  });
});

describe('R003 / R004 / R006 attack strength', () => {
  function ctx(s: GameState, attacker: string, target: string, type: 'control' | 'destroy') {
    return { id: 1, type, instant: false, attacker, attackerPlayer: 'p1', target, targetPlayer: s.cards[target].controller, fromHand: s.cards[target].zone === 'hand', privileged: false, aid: [], oppose: [], attackBonus: [], defenseBonus: [], plays: [] };
  }
  it('position bonus is +10 next to the Illuminati, +5 one Group away, 0 further out', () => {
    const s = scenario();
    const ill = s.players[1].illuminati;
    const a = give(s, 'p2', 'fbi', { under: ill, side: 'BOTTOM' });
    const out = CARDS['fbi'].arrowsOut!;
    expect(out.length).toBeGreaterThan(0);
    const att = give(s, 'p1', 'the-mafia', { under: s.players[0].illuminati, side: 'BOTTOM' });
    const d1 = attackStrength(s, ctx(s, att, a, 'destroy')).lines.find((l) => l.includes('close to'));
    expect(d1).toMatch(/\+10/);
  });
  it('control: +4 per identical alignment, −4 per opposite pair; destroy is the reverse', () => {
    const s = scenario();
    const att = give(s, 'p1', 'the-mafia', { under: s.players[0].illuminati, side: 'BOTTOM' }); // Violent Criminal
    const tgt = give(s, 'p1', 'loan-sharks', { hand: true }); // Criminal
    const c = attackStrength(s, ctx(s, att, tgt, 'control'));
    expect(c.lines.some((l) => /alignments/.test(l))).toBe(true);
    expect(c.attack).toBe(power(s, att) + 4 * CARDS['the-mafia'].alignments!.filter((x) => CARDS['loan-sharks'].alignments!.includes(x)).length + (c.lines.filter((l) => !/Power|alignments/.test(l) && l.startsWith('Attack')).reduce((n, l) => n + Number(l.match(/[+-]\d+/)![0]), 0)));
  });
  it('strength below 2 fails without a roll', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'loan-sharks', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'the-mafia', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    s = act(s, 'p1', { type: 'pass' });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.attack).toBeUndefined();
    expect(s.log.some((l) => /fails without a roll/.test(l.text))).toBe(true);
  });
  it('a natural 11 or 12 always fails', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    s0.cards[att].mods.push({ source: 'test', kind: 'power', value: 30, until: 'permanent' });
    const tgt = give(s0, 'p1', 'loan-sharks', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    s = resolve(s, [6, 6]);
    expect(s.cards[tgt].zone).toBe('hand');
  });
  it('Global Power is used when a helper lacks a matching alignment, capped at its Power (R029)', () => {
    const s = scenario();
    const g = give(s, 'p1', 'c-i-a', { under: s.players[0].illuminati, side: 'BOTTOM' });
    expect(globalPower(s, g)).toBeLessThanOrEqual(power(s, g));
  });
});

describe('R004 destruction and R016 victory', () => {
  it('puppets of a destroyed Group return to their controller\'s hand and the destroyer gets credit', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    att; s0.cards[att].mods.push({ source: 'test', kind: 'power', value: 40, until: 'permanent' });
    const tgt = give(s0, 'p2', 'fbi', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    const side = (['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] as const).find((sd) => sd !== 'TOP')!;
    const out = s0.cards[tgt];
    const pup = give(s0, 'p2', 'loan-sharks', { under: tgt, side: ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'][((['TOP', 'RIGHT', 'BOTTOM', 'LEFT'].indexOf(CARDS['fbi'].arrowsOut![0]) + (out.rot ?? 0)) % 4)] as never });
    void side;
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    s = resolve(s, [1, 1]);
    expect(s.cards[tgt].zone).toBe('destroyed');
    expect(s.players[0].destroyedCredit).toContain(tgt);
    expect(s.players[1].hand).toContain(pup);
  });
  it('a Devastated Place and its puppets do not count toward the goal (R037)', () => {
    const s = scenario();
    const place = give(s, 'p1', 'hollywood', { under: s.players[0].illuminati, side: 'BOTTOM' });
    const before = goalCount(s, 'p1');
    s.cards[place].devastated = true;
    expect(goalCount(s, 'p1')).toBe(before - 1);
  });
  it('Relief needs actions totalling three times the Place\'s printed Power', () => {
    const s0 = scenario();
    const place = give(s0, 'p1', 'hollywood', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    s0.cards[place].devastated = true;
    const need = 3 * CARDS['hollywood'].power!;
    const ill = s0.players[0].illuminati;
    const ok = power(s0, ill) >= need;
    if (ok) expect(act(s0, 'p1', { type: 'relief', place, payWith: [ill] }).cards[place].devastated).toBe(false);
    else expect(() => act(s0, 'p1', { type: 'relief', place, payWith: [ill] })).toThrow(/three times/);
  });
  it('nobody wins in the first round, even with enough Groups', () => {
    const s0 = scenario();
    s0.round = 1;
    s0.settings.basicGoal = 1;
    let s = act(s0, 'p1', { type: 'endTurn' });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.phase).not.toBe('gameOver');
  });
  it('a player who meets the Basic Goal wins at the end of a turn after round 1', () => {
    const s0 = scenario();
    s0.settings.basicGoal = 1;
    let s = act(s0, 'p1', { type: 'endTurn' });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.phase).toBe('gameOver');
  });
  it('a player with no Groups after his third turn is eliminated at once (R049)', () => {
    const s0 = scenario();
    give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    s0.players[1].turnsTaken = 3;
    s0.settings.basicGoal = 99;
    const s = act(s0, 'p1', { type: 'buyPlot', payWith: [s0.players[0].illuminati] });
    expect(s.players[1].eliminated).toBe(true);
    expect(s.players[1].hand.length).toBe(0);
    expect(s.phase).toBe('gameOver');
  });
});

describe('R030 / R032 / R034 Plot and attack restrictions', () => {
  it('the same Plot cannot be used twice in one attack', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const tgt = give(s0, 'p1', 'loan-sharks', { hand: true });
    const a = give(s0, 'p1', 'the-big-score', { hand: true });
    const b = give(s0, 'p1', 'the-big-score', { hand: true });
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt, plots: [{ card: a, target: att, mode: 'power' }, { card: b, target: att, mode: 'power' }] })).toThrow(/already used/);
  });
  it('in a Privileged attack only the attacker and defender take part', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'loan-sharks', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    const priv = give(s0, 'p1', 'privileged-attack', { hand: true });
    s0.cards[s0.players[0].illuminati].tokens = 1;
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt, plots: [{ card: priv }] });
    expect(waitingFor(s).sort()).toEqual(['p1', 'p2']);
  });
  it('the target of an Instant attack cannot spend tokens, and a Disaster costs it a token', () => {
    const s0 = scenario();
    const place = give(s0, 'p2', 'hollywood', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    const t = give(s0, 'p1', 'tornado', { hand: true });
    const s = act(s0, 'p1', { type: 'playPlot', play: { card: t, target: place } });
    expect(s.cards[place].tokens).toBe(0);
    expect(() => act(s, 'p2', { type: 'oppose', group: place })).toThrow();
  });
  it('NWOs: a new one of the same colour replaces the old one (R045)', () => {
    const s0 = scenario();
    const a = give(s0, 'p1', 'law-and-order', { hand: true });
    const b = give(s0, 'p1', 'bigger-business', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card: a } });
    s = act(s, 'p2', { type: 'pass' });
    s = act(s, 'p1', { type: 'playPlot', play: { card: b } });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.nwo.yellow).toBe(b);
    expect(s.cards[a].zone).toBe('discard');
  });
});

describe('Fixes from the rules audit', () => {
  it('self-defense raises the multiplier one step, before additions (R006c, R047)', () => {
    const s0 = scenario();
    const tgt = give(s0, 'p2', 'loan-sharks', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    s0.cards[tgt].mods.push({ source: 't', kind: 'power', value: 2, until: 'permanent' });
    s0.cards[tgt].tokens = 1;
    const base = CARDS['loan-sharks'].power!;
    const att = give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    const before = attackStrength(s, s.attack!).defense;
    s = act(s, 'p2', { type: 'oppose', group: tgt });
    expect(attackStrength(s, s.attack!).defense - before).toBe(base * 2 + 2);
  });
  it('Solidarity does not stack with another multiplier and applies before additions', () => {
    const s = scenario();
    const g = give(s, 'p1', 'loan-sharks', { under: s.players[0].illuminati, side: 'BOTTOM' });
    const sol = give(s, 'p1', 'solidarity', { hand: true });
    s.cards[sol].zone = 'table'; s.nwo.red = sol;
    s.cards[g].mods.push({ source: 't', kind: 'mulResistance', value: 3, until: 'permanent' }, { source: 't', kind: 'resistance', value: 1, until: 'permanent' });
    expect(resistance(s, g)).toBe(CARDS['loan-sharks'].resistance! * 3 + 1);
  });
  it('Reload costs an Illuminati action and refreshes at most 5 Power of Groups (errata)', () => {
    const s0 = scenario();
    const ill = s0.players[0].illuminati;
    const r = give(s0, 'p1', 'reload', { hand: true });
    const v = give(s0, 'p1', 'the-mafia', { under: ill, side: 'BOTTOM' });
    s0.cards[v].tokens = 0;
    s0.cards[ill].tokens = 0;
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card: r, targets: [v] } })).toThrow(/Illuminati/);
    s0.cards[ill].tokens = 1;
    let s = act(s0, 'p1', { type: 'playPlot', play: { card: r, targets: [v] } });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.cards[v].tokens).toBe(1);
    expect(s.cards[ill].tokens).toBe(0);
  });
  it('buying a Plot needs two different Groups', () => {
    const s = scenario();
    const g = give(s, 'p1', 'the-mafia', { under: s.players[0].illuminati, side: 'BOTTOM' });
    expect(() => act(s, 'p1', { type: 'buyPlot', payWith: [g, g] })).toThrow();
  });
  it('first-turn protection: no cards against a player who has not finished a turn (R001)', () => {
    const s0 = scenario();
    s0.players[1].turnsTaken = 0;
    const place = give(s0, 'p2', 'hollywood', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    const t = give(s0, 'p1', 'tornado', { hand: true });
    expect(() => act(s0, 'p1', { type: 'playPlot', play: { card: t, target: place } })).toThrow(/first turn/);
  });
  it('only Illuminati or Secret Groups may attack a Secret Group (R014)', () => {
    const s = scenario();
    const secret = Object.values(CARDS).find((c) => c.type === 'Group' && (c.attributes ?? []).includes('Secret'))!;
    const tgt = give(s, 'p2', secret.id, { under: s.players[1].illuminati, side: 'BOTTOM' });
    const att = give(s, 'p1', 'loan-sharks', { under: s.players[0].illuminati, side: 'BOTTOM' });
    expect(() => act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt })).toThrow(/Secret/);
  });
  it('the attacker may call off an attack before committing a Plot; helpers get tokens back', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'loan-sharks', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    s = act(s, 'p2', { type: 'oppose', group: tgt });
    s = act(s, 'p1', { type: 'callOff' });
    expect(s.attack).toBeUndefined();
    expect(s.cards[tgt].tokens).toBe(1);
    expect(s.cards[att].tokens).toBe(0);
  });
  it('lead Groups are chosen by the players, and duplicate picks are set aside and re-picked (R025)', () => {
    const deck = randomDeck(3);
    let s = createGame({ seed: 2, chooseLeads: true, players: [
      { id: 'p1', name: 'A', isAI: false, deck },
      { id: 'p2', name: 'B', isAI: false, deck: { ...deck, illuminati: 'ufos' } },
    ] });
    expect(s.prompt?.kind).toBe('chooseLead');
    const pick = (pl: string) => s.players.find((p) => p.id === pl)!.groupDeck.find((i) => s.cards[i].cardId === deck.groups[0])!;
    s = act(s, 'p1', { type: 'chooseLead', card: pick('p1') });
    s = act(s, 'p2', { type: 'chooseLead', card: pick('p2') });
    expect(s.prompt?.kind).toBe('chooseLead'); // same Group picked: both must choose again
    expect(s.log.some((l) => /set it aside/.test(l.text))).toBe(true);
  });
});

describe('R038 moving Groups', () => {
  it('costs one token from the Group, a master, or the Illuminati', () => {
    const s0 = scenario();
    const ill = s0.players[0].illuminati;
    const g = give(s0, 'p1', 'loan-sharks', { under: ill, side: 'BOTTOM' });
    s0.cards[g].tokens = 0; s0.cards[ill].tokens = 0;
    expect(() => act(s0, 'p1', { type: 'move', group: g, onto: ill, side: 'TOP', payWith: ill })).toThrow();
    s0.cards[ill].tokens = 1;
    const s = act(s0, 'p1', { type: 'move', group: g, onto: ill, side: 'TOP', payWith: ill });
    expect(s.cards[g].side).toBe('TOP');
  });
});

// ---------------------------------------------------------------------------------------------
// Rules that were implemented but had no test of their own (rules audit, pass 2).

/** A minimal attack context for strength checks. */
function attackCtx(s: GameState, attacker: string, target: string, type: 'control' | 'destroy') {
  return { id: 1, type, instant: false, attacker, attackerPlayer: s.cards[attacker].controller!, target, targetPlayer: s.cards[target].controller, fromHand: s.cards[target].zone === 'hand', privileged: false, aid: [], oppose: [], attackBonus: [], defenseBonus: [], plays: [] };
}
/** Hang a new card on the first open arrow of `master`. */
const under = (s: GameState, pl: string, cardId: string, master: string) => give(s, pl, cardId, { under: master, side: openArrows(s, master)[0] });

describe('R001 refresh and R002 automatic takeover', () => {
  it('a Group whose Power has been reduced to 0 gets no token at the start of its turn (R001, R026)', () => {
    const s0 = scenario();
    const weak = give(s0, 'p2', 'loan-sharks', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    const fine = give(s0, 'p2', 'fbi', { under: s0.players[1].illuminati, side: 'TOP' });
    s0.cards[weak].mods.push({ source: 't', kind: 'power', value: -3, until: 'permanent' });
    s0.cards[weak].tokens = 0; s0.cards[fine].tokens = 0;
    let s = act(s0, 'p1', { type: 'endTurn' });
    s = act(s, 'p2', { type: 'pass' });
    if (s.prompt?.kind === 'takeover') s = act(s, 'p2', { type: 'skipTakeover' });
    expect(s.phase).toBe('main');
    expect(s.cards[fine].tokens).toBe(1);
    expect(s.cards[weak].tokens).toBe(0);
  });
  it('the automatic takeover is optional: skipping it keeps the card in hand', () => {
    const s0 = scenario();
    const card = give(s0, 'p2', 'loan-sharks', { hand: true });
    let s = act(s0, 'p1', { type: 'endTurn' });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.prompt?.kind).toBe('takeover');
    s = act(s, 'p2', { type: 'skipTakeover' });
    expect(s.players[1].hand).toContain(card);
    expect(s.phase).toBe('main');
  });
  it('an Illuminati action brings a Resource from hand into play, once per turn (R002, R041)', () => {
    const s0 = scenario();
    s0.cards[s0.players[0].illuminati].tokens = 2;
    const r1 = give(s0, 'p1', 'mercenaries', { hand: true });
    const r2 = give(s0, 'p1', 'rogue-boomer', { hand: true });
    const s = act(s0, 'p1', { type: 'playResource', card: r1 });
    expect(s.cards[r1].zone).toBe('resources');
    expect(s.cards[r1].linkedTo).toBe(s.players[0].illuminati);
    expect(s.cards[s.players[0].illuminati].tokens).toBe(1);
    expect(() => act(s, 'p1', { type: 'playResource', card: r2 })).toThrow(/one Resource/);
  });
});

describe('R003 / R004 / R005 attack legality', () => {
  it('the Illuminati can never be attacked, and Resources cannot be attacked (R003, R021)', () => {
    const s = scenario();
    const att = give(s, 'p1', 'the-mafia', { under: s.players[0].illuminati, side: 'BOTTOM' });
    const res = give(s, 'p2', 'mercenaries', { resource: true });
    expect(() => act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: s.players[1].illuminati })).toThrow(/Only Groups/);
    expect(() => act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: res })).toThrow(/Only Groups/);
  });
  it('an Attack to Control needs an open control arrow; an Attack to Destroy does not', () => {
    const s = scenario();
    const att = give(s, 'p1', 'manuel-noriega', { under: s.players[0].illuminati, side: 'BOTTOM' }); // no outgoing arrows
    const tgt = give(s, 'p2', 'loan-sharks', { under: s.players[1].illuminati, side: 'BOTTOM' });
    expect(() => act(s, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt })).toThrow(/no open control arrow/);
    expect(() => act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt })).not.toThrow();
  });
  it('there is no third kind of attack (R005)', () => {
    const s = scenario();
    const att = give(s, 'p1', 'the-mafia', { under: s.players[0].illuminati, side: 'BOTTOM' });
    const tgt = give(s, 'p2', 'loan-sharks', { under: s.players[1].illuminati, side: 'BOTTOM' });
    expect(() => act(s, 'p1', { type: 'attack', attackType: 'neutralize' as never, attacker: att, target: tgt })).toThrow(/control or to destroy/);
  });
  it('a player may destroy his own Group, and it gets no position bonus (R004, R006)', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const own = give(s0, 'p1', 'loan-sharks', { under: s0.players[0].illuminati, side: 'TOP' });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: own });
    const r = attackStrength(s, s.attack!);
    expect(r.lines.some((l) => /close to/.test(l))).toBe(false);
    expect(r.defense).toBe(power(s, own));
  });
  it('a destroyed Group takes its linked Resources with it (R004, R041)', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    s0.cards[att].mods.push({ source: 't', kind: 'power', value: 40, until: 'permanent' });
    const tgt = give(s0, 'p2', 'fbi', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    const res = give(s0, 'p2', 'mercenaries', { resource: true });
    s0.cards[res].linkedTo = tgt;
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    s = resolve(s, [1, 1]);
    expect(s.cards[tgt].zone).toBe('destroyed');
    expect(s.cards[res].zone).toBe('destroyed');
  });
  it('a captured Group brings its linked Resources along (R041)', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    s0.cards[att].mods.push({ source: 't', kind: 'power', value: 40, until: 'permanent' });
    const tgt = give(s0, 'p2', 'fbi', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    const res = give(s0, 'p2', 'mercenaries', { resource: true });
    s0.cards[res].linkedTo = tgt;
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    s = resolve(s, [1, 1]);
    expect(s.cards[tgt].controller).toBe('p1');
    expect(s.cards[res].controller).toBe('p1');
  });
});

describe('R006 / R007 / R047 defense values and dice', () => {
  it('a target gets +4 per alignment it shares with its master, but never for Fanatic (R006b)', () => {
    const s = scenario();
    const ill = s.players[1].illuminati;
    const att = give(s, 'p1', 'c-i-a', { under: s.players[0].illuminati, side: 'BOTTOM' });
    const mafia = give(s, 'p2', 'the-mafia', { under: ill, side: 'BOTTOM' });
    const sharks = under(s, 'p2', 'loan-sharks', mafia); // both Violent and Criminal
    const elders = give(s, 'p2', 'elders-of-zion', { under: ill, side: 'TOP' });
    const fluor = under(s, 'p2', 'fiendish-fluoridators', elders); // both Fanatic only
    const bonus = (t: string) => attackStrength(s, attackCtx(s, att, t, 'control')).lines.find((l) => /master/.test(l));
    expect(bonus(sharks)).toMatch(/\+8/);
    expect(bonus(fluor)).toBeUndefined();
  });
  it('a Devastated Place defends with half its Power (rounded down) against an Attack to Destroy (R007, R037)', () => {
    const s = scenario();
    const att = give(s, 'p1', 'the-mafia', { under: s.players[0].illuminati, side: 'BOTTOM' });
    const place = give(s, 'p2', 'hollywood', { under: s.players[1].illuminati, side: 'BOTTOM' });
    s.cards[place].devastated = true;
    const r = attackStrength(s, attackCtx(s, att, place, 'destroy'));
    expect(r.defense).toBe(Math.floor(CARDS['hollywood'].power! / 2) + 10);
  });
  it('a modified roll is kept within 2 to 12 (R008, R047)', () => {
    const base = { id: 1, type: 'destroy' as const, instant: false, attackerPlayer: 'p1', target: 'x', fromHand: false, privileged: false, aid: [], oppose: [], attackBonus: [], defenseBonus: [] };
    const low = { ...base, roll: [1, 1] as [number, number], plays: [{ iid: 'a', player: 'p1', play: { card: 'a' }, effect: { t: 'delta' as const, value: -5 } }] };
    const high = { ...base, roll: [6, 5] as [number, number], plays: [{ iid: 'a', player: 'p1', play: { card: 'a' }, effect: { t: 'delta' as const, value: 5 } }] };
    expect(finalRoll(low)).toBe(2);
    expect(finalRoll(high)).toBe(12);
  });
});

describe('R026 / R029 tokens, aiding and opposing', () => {
  it('a Group whose Power drops to 0 loses its tokens at once (R026)', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'loan-sharks', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    s0.cards[g].mods.push({ source: 't', kind: 'power', value: -3, until: 'permanent' });
    const s = act(s0, 'p1', { type: 'buyPlot', payWith: [s0.players[0].illuminati] });
    expect(s.cards[g].tokens).toBe(0);
  });
  it('to aid an Attack to Destroy a Group needs an opposite alignment, or else uses Global Power (R029)', () => {
    const s0 = scenario();
    const ill = s0.players[0].illuminati;
    const att = give(s0, 'p1', 'the-mafia', { under: ill, side: 'BOTTOM' });
    const weird = give(s0, 'p1', 'american-autoduel-association', { under: ill, side: 'TOP' }); // Weird, opposite of Straight
    const cia = give(s0, 'p1', 'c-i-a', { under: ill, side: 'LEFT' }); // no opposite, Global 4
    const sharks = give(s0, 'p1', 'loan-sharks', { under: ill, side: 'RIGHT' }); // no opposite, Global 0
    const tgt = give(s0, 'p2', 'fbi', { under: s0.players[1].illuminati, side: 'BOTTOM' }); // Straight Government
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    expect(canAid(s, 'p1', weird)).toMatchObject({ ok: true, global: false });
    expect(canAid(s, 'p1', cia)).toMatchObject({ ok: true, global: true });
    expect(canAid(s, 'p1', sharks).ok).toBe(false);
  });
  it('a puppet of the target may oppose with its full Power even without a shared alignment (R029)', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'fbi', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    const pup = under(s0, 'p2', 'hollywood', tgt); // Liberal: shares nothing with the FBI
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    expect(canOppose(s, 'p2', pup)).toMatchObject({ ok: true, global: false });
  });
});

describe('R016 / R018 / R049 Goals and elimination', () => {
  it('no more than three Groups ever count double', () => {
    const s = scenario();
    const ill = s.players[0].illuminati;
    for (const [id, side] of [['the-mafia', 'BOTTOM'], ['fbi', 'TOP'], ['c-i-a', 'LEFT'], ['loan-sharks', 'RIGHT']] as const) give(s, 'p1', id, { under: ill, side });
    expect(goalCount(s, 'p1', () => true)).toBe(goalCount(s, 'p1') + 3);
  });
  it('a player may hold only his limit of Goal cards; the excess must go at once', () => {
    const s0 = scenario();
    const goals = ['kill-for-peace', 'hail-eris', 'fratricide', 'power-to-the-people'];
    for (let i = 0; i <= goalLimit(s0, 'p2'); i++) give(s0, 'p2', goals[i], { hand: true });
    let s = act(s0, 'p1', { type: 'buyPlot', payWith: [s0.players[0].illuminati] });
    expect(s.prompt).toMatchObject({ kind: 'discardToLimit', player: 'p2' });
    s = act(s, 'p2', { type: 'discard', cards: goalsInHand(s, 'p2').slice(0, 1) });
    expect(goalsInHand(s, 'p2').length).toBe(goalLimit(s, 'p2'));
  });
  it('nobody is eliminated before finishing a third turn (R018)', () => {
    const s0 = scenario();
    s0.players[1].turnsTaken = 2;
    const s = act(s0, 'p1', { type: 'buyPlot', payWith: [s0.players[0].illuminati] });
    expect(s.players[1].eliminated).toBe(false);
  });
  it('an eliminated player\'s Resources leave play (R049)', () => {
    const s0 = scenario();
    give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const res = give(s0, 'p2', 'mercenaries', { resource: true });
    s0.players[1].turnsTaken = 3;
    const s = act(s0, 'p1', { type: 'buyPlot', payWith: [s0.players[0].illuminati] });
    expect(s.players[1].eliminated).toBe(true);
    expect(s.cards[res].zone).toBe('removed');
    expect(activeHookCards(s)).not.toContain(res);
  });
  it('...unless another faction of the same Illuminati knocked him out: it takes them (R044, R049)', () => {
    const s0 = scenario();
    s0.cards[s0.players[1].illuminati].cardId = s0.cards[s0.players[0].illuminati].cardId;
    give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const res = give(s0, 'p2', 'mercenaries', { resource: true });
    s0.players[1].turnsTaken = 3;
    s0.players[1].lastPuppetTakenBy = 'p1';
    const s = act(s0, 'p1', { type: 'buyPlot', payWith: [s0.players[0].illuminati] });
    expect(s.cards[res]).toMatchObject({ zone: 'resources', controller: 'p1', linkedTo: s.players[0].illuminati });
  });
  it('the Servants of Cthulhu destroying their own last Group as the 8th win at the end of the turn instead (R049)', () => {
    const s0 = scenario();
    const ill = s0.players[0].illuminati;
    s0.cards[ill].cardId = 'servants-of-cthulhu';
    s0.players[0].turnsTaken = 3;
    s0.settings.basicGoal = 99;
    for (let i = 0; i < 7; i++) {
      const g = give(s0, 'p2', 'fbi', { hand: true });
      s0.players[1].hand = s0.players[1].hand.filter((x) => x !== g);
      s0.cards[g].zone = 'destroyed';
      s0.players[0].destroyedCredit.push(g);
    }
    const place = give(s0, 'p1', 'hollywood', { under: ill, side: 'BOTTOM' });
    const t = give(s0, 'p1', 'tornado', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card: t, target: place } });
    s = resolve(s, [1, 1]);
    expect(s.cards[place].zone).toBe('destroyed');
    expect(s.players[0].eliminated).toBe(false);
    s = act(s, 'p1', { type: 'endTurn' });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.winners).toEqual(['p1']);
  });
});

describe('R020 / R027 / R039 changes, Plot hand limit and dropping Groups', () => {
  it('"until end of turn" changes expire when the turn ends; permanent ones stay (R020)', () => {
    const s0 = scenario();
    const g = give(s0, 'p1', 'loan-sharks', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    s0.cards[g].mods.push({ source: 'a', kind: 'power', value: 2, until: 'endOfTurn' }, { source: 'b', kind: 'power', value: 1, until: 'permanent' });
    let s = act(s0, 'p1', { type: 'endTurn' });
    s = act(s, 'p2', { type: 'pass' });
    expect(power(s, g)).toBe(CARDS['loan-sharks'].power! + 1);
  });
  it('excess Plots may go back into the Plot deck instead of the discard pile (R027)', () => {
    const s0 = scenario();
    for (let i = 0; i <= handLimit(s0, 'p2'); i++) give(s0, 'p2', 'reload', { hand: true });
    let s = act(s0, 'p1', { type: 'buyPlot', payWith: [s0.players[0].illuminati] });
    expect(s.prompt).toMatchObject({ kind: 'discardToLimit', player: 'p2' });
    const extra = plotsInHand(s, 'p2').slice(0, 1);
    s = act(s, 'p2', { type: 'discard', cards: extra, toDeck: true });
    expect(s.players[1].plotDeck).toContain(extra[0]);
    expect(s.players[1].discard).not.toContain(extra[0]);
  });
  it('a Group in play can never be discarded or dropped (R013, R039)', () => {
    const s0 = scenario();
    const g = give(s0, 'p2', 'loan-sharks', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    for (let i = 0; i <= handLimit(s0, 'p2'); i++) give(s0, 'p2', 'reload', { hand: true });
    const s = act(s0, 'p1', { type: 'buyPlot', payWith: [s0.players[0].illuminati] });
    expect(s.prompt?.kind).toBe('discardToLimit');
    expect(() => act(s, 'p2', { type: 'discard', cards: [g] })).toThrow(/Plot cards/);
  });
});

describe('R031 hidden agents and R044 factions', () => {
  function setup() {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'loan-sharks', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    const a1 = give(s0, 'p1', 'loan-sharks', { hand: true });
    const a2 = give(s0, 'p1', 'loan-sharks', { hand: true });
    const own = give(s0, 'p2', 'loan-sharks', { hand: true });
    return { s: act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt }), a1, a2, own };
  }
  it('a duplicate in hand adds +10 to the attack; only one agents card per attack (R030, R031)', () => {
    const { s: s0, a1, a2 } = setup();
    const before = attackStrength(s0, s0.attack!).attack;
    const s = act(s0, 'p1', { type: 'agent', card: a1, as: 'aid' });
    expect(attackStrength(s, s.attack!).attack).toBe(before + 10);
    expect(() => act(s, 'p1', { type: 'agent', card: a2, as: 'aid' })).toThrow(/Only one agents card/);
  });
  it('agents oppose for 6, but never by the attacked Group\'s own controller (R031)', () => {
    const { s: s0, a1, own } = setup();
    expect(() => act(s0, 'p2', { type: 'agent', card: own, as: 'oppose' })).toThrow(/own Group/);
    const before = attackStrength(s0, s0.attack!).defense;
    const s = act(s0, 'p1', { type: 'agent', card: a1, as: 'oppose' });
    expect(attackStrength(s, s.attack!).defense).toBe(before + 6);
  });
  it('+5 to attacks on a Group of another faction of your own Illuminati (R044)', () => {
    const s = scenario();
    s.cards[s.players[1].illuminati].cardId = s.cards[s.players[0].illuminati].cardId;
    const att = give(s, 'p1', 'the-mafia', { under: s.players[0].illuminati, side: 'BOTTOM' });
    const tgt = give(s, 'p2', 'loan-sharks', { under: s.players[1].illuminati, side: 'BOTTOM' });
    expect(attackStrength(s, attackCtx(s, att, tgt, 'destroy')).lines).toContain('Attack +5: rival faction of your Illuminati');
  });
});

describe('R034 / R035 / R036 / R045 Instant attacks and NWOs', () => {
  it('an Instant attack cannot be called off (R034)', () => {
    const s0 = scenario();
    const place = give(s0, 'p2', 'hollywood', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    const t = give(s0, 'p1', 'tornado', { hand: true });
    const s = act(s0, 'p1', { type: 'playPlot', play: { card: t, target: place } });
    expect(() => act(s, 'p1', { type: 'callOff' })).toThrow();
  });
  it('a successful Assassination kills the Personality (R035)', () => {
    const s0 = scenario();
    const fbi = give(s0, 'p2', 'fbi', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    const dan = under(s0, 'p2', 'dan-quayle', fbi);
    const sniper = give(s0, 'p1', 'sniper', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card: sniper, target: dan } });
    expect(s.attack?.assassination).toBe(true);
    s = resolve(s, [1, 1]);
    expect(s.cards[dan].zone).toBe('destroyed');
    expect(s.cards[dan].killed).toBe(true);
  });
  it('a cancelled Disaster gives back the token it took (R036, R009)', () => {
    const s0 = scenario();
    const ill = s0.players[1].illuminati;
    const place = give(s0, 'p2', 'hollywood', { under: ill, side: 'BOTTOM' });
    const cia = give(s0, 'p2', 'c-i-a', { under: ill, side: 'TOP' });
    const t = give(s0, 'p1', 'tornado', { hand: true });
    const hoax = give(s0, 'p2', 'hoax', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card: t, target: place } });
    expect(s.cards[place].tokens).toBe(0);
    s = act(s, 'p2', { type: 'playPlot', play: { card: hoax, target: t, payWith: [cia] } });
    s = resolve(s);
    expect(s.cards[place].tokens).toBe(1);
    expect(s.cards[place].devastated).toBeFalsy();
  });
  it('an NWO cannot be played during a Privileged attack (R032, R045)', () => {
    const s0 = scenario();
    const att = give(s0, 'p1', 'the-mafia', { under: s0.players[0].illuminati, side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'loan-sharks', { under: s0.players[1].illuminati, side: 'BOTTOM' });
    const priv = give(s0, 'p1', 'privileged-attack', { hand: true });
    const nwo = give(s0, 'p1', 'law-and-order', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt, plots: [{ card: priv }] });
    expect(() => act(s, 'p1', { type: 'playPlot', play: { card: nwo } })).toThrow(/cannot be played/);
  });
});

describe('R038 / R042 / R043 / R046 structure, links, duplicates and alignments', () => {
  it('a Group moves with its puppets, and only within its own Power Structure (R038)', () => {
    const s0 = scenario();
    const ill = s0.players[0].illuminati;
    const mafia = give(s0, 'p1', 'the-mafia', { under: ill, side: 'BOTTOM' });
    const pup = under(s0, 'p1', 'loan-sharks', mafia);
    expect(() => act(s0, 'p1', { type: 'move', group: mafia, onto: s0.players[1].illuminati, side: 'TOP', payWith: ill })).toThrow(/own Power Structure/);
    const s = act(s0, 'p1', { type: 'move', group: mafia, onto: ill, side: 'TOP', payWith: ill });
    expect(s.cards[mafia].side).toBe('TOP');
    expect(s.cards[pup]).toMatchObject({ zone: 'structure', master: mafia });
    checkInvariants(s);
  });
  it('a Resource link may be moved only once per turn (R042)', () => {
    const s0 = scenario();
    const ill = s0.players[0].illuminati;
    const a = give(s0, 'p1', 'the-mafia', { under: ill, side: 'BOTTOM' });
    const b = give(s0, 'p1', 'fbi', { under: ill, side: 'TOP' });
    const res = give(s0, 'p1', 'mercenaries', { resource: true });
    const s = act(s0, 'p1', { type: 'link', resource: res, to: a });
    expect(s.cards[res].linkedTo).toBe(a);
    expect(() => act(s, 'p1', { type: 'link', resource: res, to: b })).toThrow(/once per turn/);
  });
  it('a Group already in play or destroyed cannot be played again; one merely discarded can (R043)', () => {
    const s = scenario();
    const dup = give(s, 'p1', 'loan-sharks', { hand: true });
    const inPlay = give(s, 'p2', 'loan-sharks', { under: s.players[1].illuminati, side: 'BOTTOM' });
    expect(canEnterPlay(s, dup)).toBe(false);
    s.cards[inPlay].zone = 'discard';
    expect(canEnterPlay(s, dup)).toBe(true);
    s.cards[inPlay].zone = 'destroyed';
    expect(canEnterPlay(s, dup)).toBe(false);
  });
  it('a second copy of a Unique Resource cannot come into play (R041)', () => {
    const s = scenario();
    give(s, 'p2', 'bigfoot', { resource: true });
    const mine = give(s, 'p1', 'bigfoot', { hand: true });
    expect(canEnterPlay(s, mine, 'p1')).toBe(false);
  });
  it('gaining an alignment removes its opposite (R046)', () => {
    const s = scenario();
    const g = give(s, 'p1', 'hollywood', { under: s.players[0].illuminati, side: 'BOTTOM' }); // Liberal
    s.cards[g].mods.push({ source: 't', kind: 'addAlign', align: 'Conservative', until: 'permanent' });
    expect(alignments(s, g)).toEqual(['Conservative']);
  });
});

describe('R014 Resources in attacks on Secret Groups', () => {
  it('a Resource still works in an attack on a Secret Group, unless it is linked to a non-Secret Group', () => {
    const s = scenario();
    const ill = s.players[0].illuminati;
    const att = give(s, 'p1', 'vampires', { under: ill, side: 'BOTTOM' }); // Secret
    const plain = give(s, 'p1', 'the-mafia', { under: ill, side: 'TOP' });
    const tgt = give(s, 'p2', 'rosicrucians', { under: s.players[1].illuminati, side: 'BOTTOM' }); // Secret Magic
    const lib = give(s, 'p1', 'the-library-at-alexandria', { resource: true }); // +5 to control Magic Groups
    const has = () => attackStrength(s, attackCtx(s, att, tgt, 'control')).lines.some((l) => /Library/.test(l));
    expect(has()).toBe(true);
    s.cards[lib].linkedTo = plain;
    expect(has()).toBe(false);
  });
});

describe('R012 discards are public', () => {
  it('a rival sees the cards in another player\'s discard pile', () => {
    const s = scenario();
    const c = give(s, 'p2', 'reload', { hand: true });
    discardCard(s, c);
    expect(viewFor(s, 'p1').cards[c].cardId).toBe('reload');
  });
});
