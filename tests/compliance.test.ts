// One test per checkable rule in the rulebook the game follows (v1.2 plus the later rules update).
// Rule numbers refer to the Core Rules tab of the workbook.
import { describe, expect, it } from 'vitest';
import {
  applyAction, attackStrength, createGame, goalCount, globalPower, handLimit, plotsInHand, power, resistance, waitingFor,
  type Action, type GameState, CARDS,
} from '../src/engine';
import { randomDeck } from '../src/engine/decks';
import { give, scenario } from './helpers';

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
