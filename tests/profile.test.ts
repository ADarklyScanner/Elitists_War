// Mirrors: recording how a person plays, folding games into a profile, and computers that play like them.
import { describe, expect, it } from 'vitest';
import { applyAction, createGame, waitingFor, type Action, type GameState } from '../src/engine';
import { randomDeck } from '../src/engine/decks';
import { chooseAction } from '../src/ai/ai';
import { STYLE_RANGES } from '../src/ai/personas';
import {
  emptyHabits, emptyProfile, foldGame, habitsIn, habitsReport, mirrorIlluminati, mirrorReady, mirrorSeats, mirrorStyle,
  mirrorVariants, observeHuman, profileConfidence, type HabitStats, type PlayProfile,
} from '../src/ai/profile';
import { assignIlluminati, resolveLineup } from '../src/ui/lineup';
import { checkInvariants, give, scenario } from './helpers';

const habits = (h: Partial<HabitStats>): HabitStats => ({ ...emptyHabits(), ...h });
/** A player who attacks at `odds` and defends `defended` of 4 attacks, over `games` games. */
function profileOf(odds: number, games = 3, extra: Partial<HabitStats> = {}): PlayProfile {
  let p = emptyProfile();
  for (let g = 0; g < games; g++) {
    p = foldGame(p, habits({ turns: 10, attacks: 4, chanceSum: odds * 4, control: 3, destroy: 1, atLeader: 2, atOther: 2, targeted: 4, defended: 2, decisions: 20, gapSum: 20, mistakes: 3, ...extra }),
      { won: g % 2 === 0, illuminati: g === 0 ? 'ufos' : 'the-network', gameId: `g${g}`, now: 1 });
  }
  return p;
}

describe('recording habits', () => {
  it('counts a person\'s attack: its odds, kind, whose Group it was, and how it ended', () => {
    const s0 = scenario();
    s0.players[0].isAI = false;
    const [a, b] = s0.players;
    const att = give(s0, 'p1', 'the-mafia', { under: a.illuminati, side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'loan-sharks', { under: b.illuminati, side: 'BOTTOM' });
    const act: Action = { type: 'attack', attackType: 'control', attacker: att, target: tgt };
    let s = applyAction(s0, 'p1', act);
    observeHuman(s0, s, 'p1', act);
    const h = habitsIn(s, 'p1')!;
    expect(h.attacks).toBe(1);
    expect(h.control).toBe(1);
    expect(h.atLeader).toBe(1); // the only rival leads
    expect(h.longShots).toBe(1); // deep in the rival's structure: poor odds
    expect(h.decisions).toBe(1); // a main-phase move, judged against the Normal computer
    expect(habitsIn(s, 'p2')).toBeUndefined(); // computers are not recorded
    for (let i = 0; i < 10 && s.attack; i++) {
      const who = waitingFor(s)[0];
      const prev = s;
      s = applyAction(s, who, { type: 'pass' });
      observeHuman(prev, s, who, { type: 'pass' });
    }
    expect(habitsIn(s, 'p1')!.resolved).toBe(1);
    expect(habitsIn(s, 'p1')!.open).toBeUndefined();
  });

  it('counts Plots bought, Group draws, and attacks on a person and whether they defended', () => {
    const s0 = scenario();
    s0.players[1].isAI = false; // p2 is the person; p1 (a computer) attacks them
    const [a, b] = s0.players;
    const att = give(s0, 'p1', 'the-mafia', { under: a.illuminati, side: 'BOTTOM' });
    const tgt = give(s0, 'p2', 'loan-sharks', { under: b.illuminati, side: 'BOTTOM' });
    const atk: Action = { type: 'attack', attackType: 'control', attacker: att, target: tgt };
    let s = applyAction(s0, 'p1', atk);
    observeHuman(s0, s, 'p1', atk);
    expect(habitsIn(s, 'p2')!.targeted).toBe(1);
    const prev = s;
    s = applyAction(s, 'p2', { type: 'oppose', group: tgt });
    observeHuman(prev, s, 'p2', { type: 'oppose', group: tgt });
    expect(habitsIn(s, 'p2')).toMatchObject({ targeted: 1, defended: 1, meddled: 0 });

    // Buying a Plot and drawing a Group card in the person's own turn.
    const t0 = scenario();
    t0.players[0].isAI = false;
    let t = applyAction(t0, 'p1', { type: 'buyPlot', payWith: [t0.players[0].illuminati] });
    observeHuman(t0, t, 'p1', { type: 'buyPlot', payWith: [t0.players[0].illuminati] });
    expect(habitsIn(t, 'p1')!.plotsBought).toBe(1);
    expect(habitsIn(t, 'p1')!.decisions).toBe(1);
    const t1 = scenario();
    t1.players[0].isAI = false;
    t = applyAction(t1, 'p1', { type: 'drawGroup' });
    observeHuman(t1, t, 'p1', { type: 'drawGroup' });
    expect(habitsIn(t, 'p1')!.groupDraws).toBe(1);
  });
});

describe('the play profile', () => {
  it('a won game, or one with better moves than usual, moves the profile more than a lost one', () => {
    const base = profileOf(0.5);
    const game = habits({ turns: 10, attacks: 4, chanceSum: 0.2 * 4, decisions: 20, gapSum: 20 });
    const lost = foldGame(base, game, { won: false, now: 1 });
    const won = foldGame(base, game, { won: true, now: 1 });
    expect(base.traits.odds!.v).toBeCloseTo(0.5);
    expect(won.traits.odds!.v).toBeLessThan(lost.traits.odds!.v); // pulled further towards 0.2
    // Same result, but this game's moves were better than the player's average: it counts more.
    const better = foldGame(base, { ...game, gapSum: 2 }, { won: false, now: 1 });
    expect(better.traits.odds!.v).toBeLessThan(lost.traits.odds!.v);
    expect(won.games).toBe(base.games + 1);
    expect(won.wins).toBe(base.wins + 1);
  });

  it('folds a game only once, and offers a mirror from two games on', () => {
    let p = foldGame(emptyProfile(), habits({ turns: 5 }), { won: false, gameId: 'x', now: 1 });
    expect(mirrorReady(p)).toBe(false);
    expect(mirrorSeats(p, 1)).toEqual([]);
    p = foldGame(p, habits({ turns: 5 }), { won: false, gameId: 'x', now: 1 });
    expect(p.games).toBe(1);
    p = foldGame(p, habits({ turns: 5 }), { won: true, gameId: 'y', now: 1 });
    expect(mirrorReady(p)).toBe(true);
    expect(profileConfidence(p)).toBeCloseTo(0.2);
  });

  it('mirror knobs stay inside the built-in ranges, and a risky player\'s mirror takes long shots', () => {
    const risky = mirrorStyle(profileOf(0.2));
    expect(risky.risk!).toBeLessThan(0);
    expect(mirrorStyle(profileOf(0.8)).risk!).toBeGreaterThan(0);
    const extremes = [
      profileOf(0, 3, { destroy: 40, control: 0, atLeader: 0, atWeakest: 9, atOther: 0, defended: 0, plotsPlayed: 99, plotsBought: 99, groupDraws: 99, othersAttacks: 5, meddled: 5, mistakes: 20, fromHand: 4 }),
      profileOf(1, 3, { destroy: 0, control: 40, atLeader: 9, defended: 4, decisions: 5, mistakes: 0 }),
    ];
    for (const p of extremes) {
      const k = mirrorStyle(p) as Record<string, unknown>;
      for (const [name, [lo, hi]] of Object.entries(STYLE_RANGES)) {
        if (k[name] === undefined) continue;
        expect(k[name] as number).toBeGreaterThanOrEqual(lo);
        expect(k[name] as number).toBeLessThanOrEqual(hi);
      }
    }
    for (const v of mirrorVariants(profileOf(0.2), 3, 7)) {
      for (const [name, [lo, hi]] of Object.entries(STYLE_RANGES)) {
        const x = (v.data as Record<string, unknown>)[name];
        if (typeof x === 'number') { expect(x).toBeGreaterThanOrEqual(lo); expect(x).toBeLessThanOrEqual(hi); }
      }
    }
    expect(mirrorVariants(profileOf(0.2), 3, 7).map((v) => v.name)).toEqual(['Your Mirror', 'Your Echo', 'Your Shadow']);
    expect(mirrorVariants(profileOf(0.2), 2, 7, 'Ann').map((v) => v.name)).toEqual(["Ann's Mirror", "Ann's Echo"]);
  });

  it('a mirror plays on the player\'s second-favourite Illuminati, never their favourite', () => {
    const p = profileOf(0.5, 4); // picks: ufos once, the-network three times
    expect(mirrorIlluminati(p)).toBe('ufos');
    const one = profileOf(0.5, 1); // only ever ufos
    expect(mirrorIlluminati(one, ['ufos', 'shangri-la'])).toBe('shangri-la');
    const seats = mirrorSeats(p, 3, undefined, ['ufos', 'the-network']);
    expect(assignIlluminati(seats, ['bavarian-illuminati'], ['the-network', 'ufos', 'shangri-la'])[0]).toBe('ufos');
  });

  it('reports a game\'s habits in plain words', () => {
    const lines = habitsReport(habits({ turns: 8, attacks: 6, chanceSum: 1.8, longShots: 6, longShotFails: 5, resolved: 6, wins: 1, targeted: 5, defended: 1, atWeakest: 3, atOther: 3, decisions: 10, mistakes: 2 }));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines).toContain('You attacked at under 35% odds 6 times; 5 failed.');
    expect(lines).toContain('You defended 1 of 5 attacks on you.');
    expect(lines).toContain('You never attacked the leader.');
    // eslint-disable-next-line no-control-regex
    expect(lines.join(' ')).toMatch(/^[\x00-\x7F]*$/); // plain text, no emoji
  });
});

describe('mirrors at the table', () => {
  it('random seats draw from the whole pool of their level: built-in players and mirrors', () => {
    const mirrors = mirrorSeats(profileOf(0.3), 5);
    let sawMirror = 0, sawBuiltIn = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const bots = resolveLineup({ picked: [], random: { easy: 1, normal: 3, hard: 1, wild: 0 } }, seed, { mirrors });
      expect(bots.length).toBe(5); // never more seats than asked for
      expect(new Set(bots.map((b) => b.name)).size).toBe(5);
      for (const b of bots) {
        if (b.style === 'mirror') { sawMirror++; expect(mirrors).toContainEqual(b); } else sawBuiltIn++;
      }
      expect(bots.filter((b) => b.level === 'normal').length).toBe(3);
    }
    expect(sawMirror).toBeGreaterThan(0);
    expect(sawBuiltIn).toBeGreaterThan(sawMirror);
  });

  it('a picked mirror takes your mirror of that level, or a random seat until you have one', () => {
    const mirrors = mirrorSeats(profileOf(0.3), 5);
    const [m] = resolveLineup({ picked: ['mirror:hard'], random: { easy: 0, normal: 0, hard: 0, wild: 0 } }, 2, { mirrors });
    expect(m).toMatchObject({ name: 'Your Shadow', level: 'hard', style: 'mirror' });
    expect(m.data).toBeDefined();
    const none = resolveLineup({ picked: ['mirror:hard'], random: { easy: 0, normal: 0, hard: 0, wild: 0 } }, 2);
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({ level: 'hard' });
    expect(none[0].style).not.toBe('mirror');
  });

  it('Easy, Normal and Hard mirrors play a legal game to the end, recording the person as they go', () => {
    const p = profileOf(0.25, 3, { destroy: 3, control: 1, plotsPlayed: 10 });
    const mirrors = mirrorSeats(p, 9);
    let s: GameState = createGame({ seed: 21, settings: { houseRules: ['quickGame'] }, players: [
      { id: 'p1', name: 'You', isAI: false, deck: randomDeck(211) },
      ...mirrors.map((m, i) => ({ id: `p${i + 2}`, name: m.name, isAI: true, aiLevel: m.level, aiStyle: m.style, aiStyleData: m.data, deck: randomDeck(212 + i) })),
    ] });
    expect(s.players[3]).toMatchObject({ aiStyle: 'mirror', aiLevel: 'hard' });
    expect(s.players[3].aiStyleData).toEqual(mirrors[2].data);
    for (let i = 0; i < 20000 && s.phase !== 'gameOver' && s.turn < 200; i++) {
      const w = waitingFor(s)[0];
      const a = chooseAction(s, w);
      const next = applyAction(s, w, a); // a mirror that picks an illegal move fails the test
      observeHuman(s, next, w, a);
      s = next;
      checkInvariants(s);
    }
    expect(s.phase).toBe('gameOver');
    const h = habitsIn(s, 'p1')!;
    expect(h.turns).toBeGreaterThan(0);
    expect(h.decisions).toBeGreaterThan(0);
    expect(foldGame(emptyProfile(), h, { won: !!s.winners?.includes('p1'), now: 1 }).games).toBe(1);
  }, 120_000);
});
