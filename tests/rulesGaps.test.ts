// Rules that closed the last gaps in RULES_COMPLIANCE.md: Relief paid by several players (R037), spare
// Illuminati as agents (R044), the first-turn exception (R001), the Warehouse 23 showdown for Unique
// Resources (R041), links and gifts of a Resource that already helped (R042, R040), a duplicate that
// helps capture (R031), leaving a game (R049), the lead Group's arrow (R025), rearranging captured or
// moved puppets (R031, R038) and the agreed Basic Goal (R016).
import { describe, expect, it } from 'vitest';
import {
  applyAction, attackStrength, createGame, openArrows, plotsInHand, protectedPlayer, waitingFor, checkPlot, structureCards,
  type Action, type GameState, CARDS, ILLUMINATI,
} from '../src/engine';
import { randomDeck } from '../src/engine/decks';
import { resourceProblem } from '../src/engine/deals';
import { viewFor } from '../src/server/service';
import { MemoryStore } from '../src/server/memoryStore';
import { newTable, joinTable, deleteOrLeave } from '../src/server/service';
import { checkInvariants, give, scenario } from './helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);

/** Like the helpers' scenario, with three players: p1's main phase, everyone past a first turn, no Groups in play. */
function scenario3(): GameState {
  const s = createGame({ seed: 4, players: [1, 2, 3].map((n) => ({ id: `p${n}`, name: ['Alice', 'Bob', 'Cat'][n - 1], isAI: true, deck: randomDeck(n * 5) })) });
  for (const [k, c] of Object.entries(s.cards)) {
    if ((c.zone === 'structure' && CARDS[c.cardId].type === 'Group') || c.zone === 'hand') delete s.cards[k];
  }
  for (const p of s.players) { p.turnsTaken = 1; p.hand = []; s.cards[p.illuminati].tokens = 1; }
  s.active = 0; s.phase = 'main'; s.prompt = undefined; s.promptQueue = undefined; s.window = undefined; s.events = undefined; s.round = 3; s.nwo = {};
  return s;
}
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;

/** Everyone passes until the attack (and any window) is over, forcing the dice. */
function resolve(s: GameState, dice: [number, number] = [1, 1]): GameState {
  for (let i = 0; i < 30 && (s.attack || s.window); i++) {
    if (s.window?.kind === 'roll' && s.attack?.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}

describe('R037 Relief paid by several players together', () => {
  function devastated() {
    const s = scenario();
    const place = give(s, 'p2', 'england', { under: ill(s, 'p2'), side: 'BOTTOM' }); // printed Power 2: needs 6
    s.cards[place].devastated = true;
    s.cards[place].tokens = 0;
    const mine = give(s, 'p1', 'dentists', { under: ill(s, 'p1'), side: 'BOTTOM' }); // Power 1
    const theirs = give(s, 'p2', 'democrats', { under: ill(s, 'p2'), side: 'TOP' }); // Power 6
    s.cards[theirs].tokens = 0;
    const small = give(s, 'p2', 'feminists', { under: ill(s, 'p2'), side: 'LEFT' }); // Power 2
    return { s, place, mine, theirs, small };
  }

  it('a pledge from one player and Groups of another pay one Relief, spent at the same time', () => {
    const { s: s0, place, mine, small } = devastated();
    // p1 alone (Power 1) cannot pay 6; p2's Feminists (2) cannot either.
    expect(() => act(s0, 'p1', { type: 'relief', place, payWith: [mine] })).toThrow(/needs 6/);
    let s = act(s0, 'p2', { type: 'pledgeRelief', place, payWith: [small] });
    expect(s.reliefPledges?.[0]).toMatchObject({ player: 'p2', place, groups: [small] });
    // Still not enough: 1 + 2.
    expect(() => act(s, 'p1', { type: 'relief', place, payWith: [mine], partners: ['p2'] })).toThrow(/together you have 3/);
    s.cards[mine].mods.push({ source: 'test', kind: 'power', value: 3, until: 'endOfTurn' }); // Power 4
    s = act(s, 'p1', { type: 'relief', place, payWith: [mine], partners: ['p2'] });
    s = resolve(s);
    expect(s.cards[place].devastated).toBe(false);
    expect(s.cards[mine].tokens).toBe(0);
    expect(s.cards[small].tokens).toBe(0);
    expect(s.reliefPledges).toBeUndefined();
    expect(s.log.some((l) => /together with Bob/.test(l.text))).toBe(true);
  });

  it('a player\'s Groups cannot be used without his pledge, and a pledge lapses when the turn ends', () => {
    const { s: s0, place, mine } = devastated();
    expect(() => act(s0, 'p1', { type: 'relief', place, payWith: [mine], partners: ['p2'] })).toThrow(/has not pledged/);
    const s = act(s0, 'p1', { type: 'pledgeRelief', place, payWith: [mine] });
    expect(s.reliefPledges).toHaveLength(1);
    let t = act(s, 'p1', { type: 'endTurn' });
    for (let i = 0; i < 10 && t.window; i++) t = act(t, waitingFor(t)[0], { type: 'pass' });
    expect(t.reliefPledges).toBeUndefined();
  });

  it('pledging is not a play: it may be made while another player has priority, and withdrawn', () => {
    const { s: s0, place, small } = devastated();
    // It is p1's main phase: p2 has no priority, but may still pledge.
    let s = act(s0, 'p2', { type: 'pledgeRelief', place, payWith: [small] });
    s = act(s, 'p2', { type: 'pledgeRelief', place, payWith: [] });
    expect(s.reliefPledges).toBeUndefined();
    expect(() => act(s, 'p2', { type: 'pledgeRelief', place, payWith: [s.players[0].illuminati] })).toThrow(/must be yours/);
  });
});

describe('R044 spare Illuminati as agents', () => {
  function withSpare(rivalIll?: string) {
    const s = scenario();
    const theirs = rivalIll ?? s.cards[ill(s, 'p2')].cardId;
    const spare = give(s, 'p1', theirs, { hand: true });
    return { s, spare };
  }

  it('is held with the Plots, played for the top card of each deck, and gives +3 against that Illuminati\'s Power Structure', () => {
    const { s: s0, spare } = withSpare();
    expect(plotsInHand(s0, 'p1')).toContain(spare);
    const p1 = s0.players[0];
    const [topPlot, topGroup] = [p1.plotDeck[0], p1.groupDeck[0]];
    const att = give(s0, 'p1', 'democrats', { under: ill(s0, 'p1'), side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'fbi', { under: ill(s0, 'p2'), side: 'BOTTOM' });
    const probe = { id: -1, type: 'control' as const, instant: false, attacker: att, attackerPlayer: 'p1', target: tgt, targetPlayer: 'p2', fromHand: false, privileged: false, aid: [], oppose: [], attackBonus: [], defenseBonus: [], plays: [] };
    const before = attackStrength(s0, probe).strength;
    const s = act(s0, 'p1', { type: 'playAgent', card: spare });
    expect(s.cards[spare].zone).toBe('agents');
    expect(s.players[0].discard).toEqual(expect.arrayContaining([topPlot, topGroup]));
    expect(attackStrength(s, probe).strength).toBe(before + 3);
    // And +3 to defend against that Illuminati's attacks.
    const back = { ...probe, attacker: tgt, attackerPlayer: 'p2', target: att, targetPlayer: 'p1' };
    expect(attackStrength(s, back).defense).toBe(attackStrength(s0, back).defense + 3);
    checkInvariants(s);
  });

  it('only one agent per Illuminati, never inside your own, and only when a rival plays it', () => {
    const { s: s0, spare } = withSpare();
    const s = act(s0, 'p1', { type: 'playAgent', card: spare });
    const second = give(s, 'p1', s.cards[spare].cardId, { hand: true });
    expect(() => act(s, 'p1', { type: 'playAgent', card: second })).toThrow(/already have an agent/);
    const own = give(s, 'p1', s.cards[ill(s, 'p1')].cardId, { hand: true });
    expect(() => act(s, 'p1', { type: 'playAgent', card: own })).toThrow(/your own Illuminati/);
    const other = ILLUMINATI.map((c) => c.id).find((id) => id !== s.cards[ill(s, 'p1')].cardId && id !== s.cards[ill(s, 'p2')].cardId)!;
    const nobody = give(s, 'p1', other, { hand: true });
    expect(() => act(s, 'p1', { type: 'playAgent', card: nobody })).toThrow(/No rival is playing/);
  });

  it('shows a Plot back to rivals while in hand, and is public once played', () => {
    const { s: s0, spare } = withSpare();
    expect(viewFor(s0, 'p2').cards[spare].cardId).toBe('hidden-plot');
    const s = act(s0, 'p1', { type: 'playAgent', card: spare });
    expect(viewFor(s, 'p2').cards[spare].cardId).toBe(s0.cards[spare].cardId);
  });

  it('decks sometimes carry one spare Illuminati in the Plot deck, keeping the book\'s deck shape', () => {
    const d = randomDeck(4, 'shangri-la', { spareIlluminati: 1 });
    const spares = d.plots.filter((id) => CARDS[id].type === 'Illuminati');
    expect(spares).toHaveLength(1);
    expect(spares[0]).not.toBe('shangri-la');
    expect(1 + d.groups.length + d.plots.length).toBe(45);
    expect(randomDeck(4, 'shangri-la', { spareIlluminati: 0 }).plots.some((id) => CARDS[id].type === 'Illuminati')).toBe(false);
    let n = 0;
    for (let seed = 0; seed < 200; seed++) if (randomDeck(seed).plots.some((id) => CARDS[id].type === 'Illuminati')) n++;
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThan(90);
  });
});

describe('R001 the first-turn exception', () => {
  it('a player attacked by someone in his first turn may answer that player, and only him', () => {
    const s0 = createGame({ seed: 8, players: [
      { id: 'p1', name: 'A', isAI: true, deck: randomDeck(1) },
      { id: 'p2', name: 'B', isAI: true, deck: randomDeck(2) },
      { id: 'p3', name: 'C', isAI: true, deck: randomDeck(3) },
    ] });
    const s = structuredClone(s0);
    const [a, b, c] = s.players;
    a.turnsTaken = 0; b.turnsTaken = 1; c.turnsTaken = 1;
    expect(protectedPlayer(s, 'p2', 'p1')).toBe(true);
    s.players[0].firstTurnAttacked = ['p2'];
    expect(protectedPlayer(s, 'p2', 'p1')).toBe(false);
    expect(protectedPlayer(s, 'p3', 'p1')).toBe(true);
  });

  it('an attack made in the first turn lifts the protection for the target\'s player', () => {
    let s = scenario3();
    s.players[0].turnsTaken = 0; // p1 is still in his first turn
    const att = give(s, 'p1', 'democrats', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const tgt = give(s, 'p2', 'dentists', { under: ill(s, 'p2'), side: 'BOTTOM' });
    expect(protectedPlayer(s, 'p2', 'p1')).toBe(true);
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    expect(s.players[0].firstTurnAttacked).toEqual(['p2']);
    expect(protectedPlayer(s, 'p2', 'p1')).toBe(false);
    expect(protectedPlayer(s, 'p3', 'p1')).toBe(true);
    // p2 may now answer p1: an Assassination aimed at p1's Group (at the end of the turn, when Instant
    // attacks may be played) is no longer refused for protection; p3 still may not.
    s = resolve(s, [6, 6]);
    s = act(s, 'p1', { type: 'endTurn' });
    expect(s.window?.kind).toBe('endOfTurn');
    const bomb = give(s, 'p2', 'car-bomb', { hand: true });
    expect(checkPlot(s, 'p2', { card: bomb, target: att }) ?? '').not.toMatch(/first turn/);
    const other = give(s, 'p3', 'car-bomb', { hand: true });
    expect(checkPlot(s, 'p3', { card: other, target: att }) ?? '').toMatch(/first turn/);
  });
});

describe('R041 Warehouse 23 and Unique duplicates', () => {
  function hidden() {
    const s = scenario();
    const w23 = give(s, 'p2', 'warehouse-23', { resource: true });
    const theirs = give(s, 'p2', 'bigfoot', { resource: true });
    s.cards[theirs].hiddenUnder = w23;
    const mine = give(s, 'p1', 'bigfoot', { hand: true });
    return { s, w23, theirs, mine };
  }

  it('the controller must show the hidden copy: the play fails and costs nothing', () => {
    const { s: s0, theirs, mine } = hidden();
    let s = act(s0, 'p1', { type: 'playResource', card: mine });
    expect(s.prompt).toMatchObject({ player: 'p2', kind: 'choose' });
    expect(viewFor(s, 'p1').prompt?.choice?.options).toEqual([]);
    s = act(s, 'p2', { type: 'choose', ids: ['show'] });
    expect(s.players[0].hand).toContain(mine);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(1);
    expect(s.turnFlags.resourcePlayed).toBe(false);
    expect(s.cards[theirs].shown).toBe(true);
    expect(viewFor(s, 'p1').cards[theirs].cardId).toBe('bigfoot');
    expect(() => act(s, 'p1', { type: 'playResource', card: mine })).toThrow(/Unique/);
  });

  it('keeping it hidden gives the rival the Resource; the hidden copy is discarded when turned face up', () => {
    const { s: s0, w23, theirs, mine } = hidden();
    let s = act(s0, 'p1', { type: 'playResource', card: mine });
    s = act(s, 'p2', { type: 'choose', ids: ['hide'] });
    s = resolve(s);
    expect(s.cards[mine].zone).toBe('resources');
    expect(s.cards[mine].controller).toBe('p1');
    expect(s.cards[theirs].forfeited).toBe(true);
    // Rivals never learn that it was given up.
    expect(viewFor(s, 'p1').cards[theirs].forfeited).toBeUndefined();
    s = resolve(act(s, 'p1', { type: 'endTurn' }));
    if (s.prompt?.kind === 'takeover') s = act(s, 'p2', { type: 'skipTakeover' });
    s = act(s, 'p2', { type: 'useAbility', card: w23, ability: 'reveal', params: { target: theirs } });
    s = resolve(s);
    expect(s.cards[theirs].zone).toBe('discard');
    expect(s.cards[mine].zone).toBe('resources');
  });

  it('the computer always shows its hidden copy', async () => {
    const { chooseAction } = await import('../src/ai/ai');
    const { s: s0, mine } = hidden();
    const s = act(s0, 'p1', { type: 'playResource', card: mine });
    expect(chooseAction(s, 'p2')).toEqual({ type: 'choose', ids: ['show'] });
  });
});

describe('R042 / R040 a Resource that helped this turn', () => {
  it('may not have its link moved, or be given away, after lending a bonus to an attack', () => {
    let s = scenario();
    const lib = give(s, 'p1', 'the-library-at-alexandria', { resource: true });
    const att = give(s, 'p1', 'democrats', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const tgt = give(s, 'p2', 'fbi', { under: ill(s, 'p2'), side: 'BOTTOM' });
    // Before it helps, it may be relinked.
    expect(() => act(s, 'p1', { type: 'link', resource: lib, to: att })).not.toThrow();
    s = act(s, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    s = resolve(s, [6, 6]);
    expect(s.cards[lib].benefitTurn).toBe(s.turn);
    expect(() => act(s, 'p1', { type: 'link', resource: lib, to: att })).toThrow(/already been used/);
    expect(resourceProblem(s, 'p1', 'p2', lib)).toMatch(/used this turn/);
  });
});

describe('R031 a duplicate that helps capture', () => {
  it('the capturer\'s own copy goes into his Power Structure and the owner keeps his card', () => {
    let s = scenario();
    const att = give(s, 'p1', 'democrats', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const tgt = give(s, 'p2', 'feminists', { under: ill(s, 'p2'), side: 'BOTTOM' });
    const puppet = give(s, 'p2', 'dentists', { under: tgt, side: openArrows(s, tgt)[0] });
    const dup = give(s, 'p1', 'feminists', { hand: true });
    s = act(s, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    s = act(s, 'p1', { type: 'agent', card: dup, as: 'aid' });
    s = resolve(s, [2, 2]);
    expect(s.cards[dup].zone).toBe('structure');
    expect(s.cards[dup].controller).toBe('p1');
    expect(s.cards[dup].master).toBe(att);
    expect(s.cards[tgt].zone).toBe('removed');
    expect(s.cards[tgt].setAside).toBe(true);
    expect(s.cards[puppet].master).toBe(dup);
    expect(s.cards[puppet].controller).toBe('p1');
    checkInvariants(s);
  });
});

describe('R049 leaving a game', () => {
  it('leaving counts as elimination: the last player standing wins', () => {
    let s = scenario();
    give(s, 'p2', 'democrats', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s = act(s, 'p2', { type: 'resign' });
    expect(s.players[1].eliminated).toBe(true);
    expect(s.players[1].resigned).toBe(true);
    expect(structureCards(s, 'p2').filter((g) => g !== ill(s, 'p2'))).toEqual([]);
    expect(s.phase).toBe('gameOver');
    expect(s.winners).toEqual(['p1']);
  });

  it('when the player whose turn it is leaves, play passes on and an attack he made never happened', () => {
    let s = createGame({ seed: 3, players: [
      { id: 'p1', name: 'A', isAI: true, deck: randomDeck(1) },
      { id: 'p2', name: 'B', isAI: true, deck: randomDeck(2) },
      { id: 'p3', name: 'C', isAI: true, deck: randomDeck(3) },
    ] });
    // Play forward to someone's main phase.
    for (let i = 0; i < 20 && !(s.phase === 'main' && !s.window && !s.prompt); i++) {
      const w = waitingFor(s)[0];
      s = act(s, w, s.prompt?.kind === 'takeover' ? { type: 'skipTakeover' } : s.prompt?.kind === 'draw' ? { type: 'skipDraw' } : { type: 'pass' });
    }
    const active = s.players[s.active].id;
    s = act(s, active, { type: 'resign' });
    expect(s.players.find((p) => p.id === active)!.eliminated).toBe(true);
    expect(s.players[s.active].id).not.toBe(active);
    expect(s.phase).not.toBe('gameOver');
    checkInvariants(s);
  });

  it('online, leaving a started game resigns; the host can still delete it', async () => {
    const store = new MemoryStore();
    const t = await newTable(store, { userId: 'ann', name: 'Ann', illuminati: 'bavarian-illuminati' }, { seats: 3, computerSeats: 1 });
    await joinTable(store, t.invite, { userId: 'bob', name: 'Bob', illuminati: 'ufos' });
    let rec = (await store.get(t.id))!;
    // Choose leads for both people so the game is under way.
    for (const [user, seat] of [['ann', 'p1'], ['bob', 'p2']] as const) {
      rec = (await store.get(t.id))!;
      if (rec.state!.prompt?.kind === 'chooseLead' && rec.state!.prompt.player === seat) {
        const { leadOptions } = await import('../src/engine');
        const { submit } = await import('../src/server/service');
        await submit(store, t.id, user, { type: 'chooseLead', card: leadOptions(rec.state!, seat)[0] });
      }
    }
    rec = (await store.get(t.id))!;
    for (let i = 0; i < 4 && rec.state!.phase === 'setup'; i++) {
      const pr = rec.state!.prompt!;
      const user = pr.player === 'p1' ? 'ann' : 'bob';
      const { leadOptions } = await import('../src/engine');
      const { submit } = await import('../src/server/service');
      await submit(store, t.id, user, { type: 'chooseLead', card: leadOptions(rec.state!, pr.player)[0] });
      rec = (await store.get(t.id))!;
    }
    expect(rec.state!.phase).not.toBe('setup');
    expect(await deleteOrLeave(store, t.id, 'bob')).toBe('resigned');
    rec = (await store.get(t.id))!;
    expect(rec.state!.players.find((p) => p.id === 'p2')!.eliminated).toBe(true);
    expect(await deleteOrLeave(store, t.id, 'ann')).toBe('deleted');
  });
});

describe('R025 the lead Group\'s arrow', () => {
  it('each player chooses which Illuminati arrow his lead hangs from', () => {
    let s = createGame({ seed: 11, chooseLeads: true, players: [
      { id: 'p1', name: 'A', isAI: false, deck: randomDeck(1) },
      { id: 'p2', name: 'B', isAI: true, deck: randomDeck(2) },
    ] });
    const { leadOptions } = { leadOptions: (st: GameState, pl: string) => st.players.find((p) => p.id === pl)!.groupDeck.filter((i) => CARDS[st.cards[i].cardId].type === 'Group') };
    expect(s.prompt?.kind).toBe('chooseLead');
    const pick1 = leadOptions(s, 'p1')[0];
    s = act(s, 'p1', { type: 'chooseLead', card: pick1, side: 'LEFT' });
    const others = leadOptions(s, 'p2').filter((i) => s.cards[i].cardId !== s.cards[pick1].cardId);
    s = act(s, 'p2', { type: 'chooseLead', card: others[0] });
    expect(s.cards[pick1].side).toBe('LEFT');
    expect(s.cards[others[0]].side).toBe('BOTTOM');
  });
});

describe('R031 / R038 rearranging new Groups', () => {
  it('a waiting Group can be placed on an open arrow of its own master; one still waiting when done is lost', () => {
    const s = scenario();
    s.players[0].isAI = false;
    const m = give(s, 'p1', 'democrats', { under: ill(s, 'p1'), side: 'BOTTOM' }); // arrows LEFT and RIGHT
    const a = give(s, 'p1', 'dentists', { hand: true });
    const b = give(s, 'p1', 'feminists', { hand: true });
    for (const x of [a, b]) { s.players[0].hand = s.players[0].hand.filter((h) => h !== x); s.cards[x].zone = 'removed'; }
    s.prompt = { player: 'p1', kind: 'placeCaptured', data: { cards: [m], pending: [{ group: a, master: m }, { group: b, master: m }], overflow: 'hand', handOf: 'p1', layout: {} } };
    const side = openArrows(s, m)[0];
    expect(() => act(s, 'p1', { type: 'placeCaptured', group: a, onto: ill(s, 'p1'), side: 'TOP' })).toThrow(/same master/);
    let t = act(s, 'p1', { type: 'placeCaptured', group: a, onto: m, side });
    expect(t.cards[a].zone).toBe('structure');
    expect(t.cards[a].master).toBe(m);
    t = act(t, 'p1', { type: 'placeCapturedDone' });
    expect(t.prompt).toBeUndefined();
    expect(t.players[0].hand).toContain(b);
    checkInvariants(t);
  });
});

describe('R038 a move that crowds puppets', () => {
  function crowded() {
    const s = scenario();
    const i1 = ill(s, 'p1');
    const kids = ['dentists', 'feminists', 'boy-sprouts', 'comic-books'];
    let k = 0;
    const g = give(s, 'p1', 'big-media', { under: i1, side: 'BOTTOM' });
    for (const side of openArrows(s, g)) give(s, 'p1', kids[k++], { under: g, side });
    const o = give(s, 'p1', 'c-i-a', { under: i1, side: 'RIGHT' });
    const more = ['cycle-gangs', 'gay-activists', 'flat-earthers'];
    let j = 0;
    for (const side of openArrows(s, o)) give(s, 'p1', more[j++], { under: o, side });
    return { s, g };
  }

  it('a person may rearrange before Groups that still do not fit go back to his hand', () => {
    const { s: s0, g } = crowded();
    s0.players[0].isAI = false;
    let s = act(s0, 'p1', { type: 'move', group: g, onto: ill(s0, 'p1'), side: 'TOP', payWith: g });
    s = resolve(s);
    expect(s.prompt?.kind).toBe('placeCaptured');
    const d = s.prompt!.data as { pending: { group: string }[] };
    expect(d.pending.length).toBe(1);
    const lost = d.pending[0].group;
    checkInvariants(s);
    s = act(s, 'p1', { type: 'placeCapturedDone' });
    expect(s.prompt).toBeUndefined();
    expect(s.players[0].hand).toContain(lost);
    checkInvariants(s);
  });

  it('a computer keeps the automatic arrangement and is never asked', () => {
    const { s: s0, g } = crowded();
    let s = act(s0, 'p1', { type: 'move', group: g, onto: ill(s0, 'p1'), side: 'TOP', payWith: g });
    s = resolve(s);
    expect(s.prompt).toBeUndefined();
    checkInvariants(s);
  });
});

describe('small table rules: tokens, showing a Plot, calling off', () => {
  it('a player may take a token off his own card; during his attack that commits it', () => {
    let s = scenario();
    const att = give(s, 'p1', 'democrats', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const other = give(s, 'p1', 'dentists', { under: ill(s, 'p1'), side: 'TOP' });
    const tgt = give(s, 'p2', 'feminists', { under: ill(s, 'p2'), side: 'BOTTOM' });
    expect(() => act(s, 'p1', { type: 'removeToken', card: tgt })).toThrow(/your own/);
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    const t = act(s, 'p1', { type: 'removeToken', card: other });
    expect(t.cards[other].tokens).toBe(0);
    expect(() => act(t, 'p1', { type: 'callOff' })).toThrow(/committed/);
  });

  it('spending another Group\'s token to aid your own attack commits it too', () => {
    let s = scenario();
    const att = give(s, 'p1', 'democrats', { under: ill(s, 'p1'), side: 'BOTTOM' });
    const helper = give(s, 'p1', 'black-activists', { under: ill(s, 'p1'), side: 'TOP' });
    const tgt = give(s, 'p2', 'feminists', { under: ill(s, 'p2'), side: 'BOTTOM' });
    s = act(s, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    s = act(s, 'p1', { type: 'aid', group: helper });
    expect(() => act(s, 'p1', { type: 'callOff' })).toThrow(/committed/);
  });

  it('a hidden Plot shown to one rival is seen by him only', () => {
    let s = scenario();
    const plot = give(s, 'p1', 'car-bomb', { hand: true });
    s = act(s, 'p1', { type: 'showCard', card: plot, to: 'p2' });
    expect(s.cards[plot].exposed).toBeFalsy();
    expect(viewFor(s, 'p2').cards[plot].cardId).toBe('car-bomb');
    expect(s.log.some((l) => !l.to && /shows a hidden Plot to Bob/.test(l.text))).toBe(true);
  });
});

describe('R016 the agreed Basic Goal', () => {
  const deck = (n: number) => randomDeck(n);
  it('a Basic Goal agreed before the game is used; with two players it never goes below 12', () => {
    const three = createGame({ seed: 1, settings: { basicGoal: 9 }, players: [1, 2, 3].map((n) => ({ id: `p${n}`, name: `P${n}`, isAI: true, deck: deck(n) })) });
    expect(three.settings.basicGoal).toBe(9);
    const two = createGame({ seed: 1, settings: { basicGoal: 9 }, players: [1, 2].map((n) => ({ id: `p${n}`, name: `P${n}`, isAI: true, deck: deck(n) })) });
    expect(two.settings.basicGoal).toBe(12);
    const book = createGame({ seed: 1, players: [1, 2, 3, 4].map((n) => ({ id: `p${n}`, name: `P${n}`, isAI: true, deck: deck(n) })) });
    expect(book.settings.basicGoal).toBe(11);
  });
});
