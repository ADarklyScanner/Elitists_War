import { describe, expect, it } from 'vitest';
import {
  applyAction, attackStrength, globalPower, power, resistance, alignments, waitingFor,
  type Action, type GameState, type PlotPlay,
} from '../../src/engine';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const play = (s: GameState, pl: string, p: PlotPlay) => act(s, pl, { type: 'playPlot', play: p });
/** Play a non-attack Plot and let the other player pass so it resolves. */
const resolved = (s: GameState, pl: string, p: PlotPlay) => act(play(s, pl, p), pl === 'p1' ? 'p2' : 'p1', { type: 'pass' });
/** Pass for everyone until the attack is over, forcing the dice if given. */
function finish(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const under = (s: GameState, pl: string, id: string, side: 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT' = 'BOTTOM', master?: string) =>
  give(s, pl, id, { under: master ?? ill(s, pl), side });
const hand = (s: GameState, pl: string, id: string) => give(s, pl, id, { hand: true });
/** A card that has been destroyed (optionally Assassinated) and credited to `by`. */
function destroyed(s: GameState, owner: string, id: string, by: string, killed = false) {
  const iid = hand(s, owner, id);
  const p = s.players.find((x) => x.id === owner)!;
  p.hand = p.hand.filter((x) => x !== iid);
  Object.assign(s.cards[iid], { zone: 'destroyed', killed });
  s.players.find((x) => x.id === by)!.destroyedCredit.push(iid);
  return iid;
}

describe('linked stat changes', () => {
  it('Hidden Influence: Global Power becomes equal to Power; costs an Illuminati action', () => {
    const s0 = scenario();
    const g = under(s0, 'p2', 'cable-tv');
    const c = hand(s0, 'p1', 'hidden-influence');
    expect(globalPower(s0, g)).toBe(2);
    const s = resolved(s0, 'p1', { card: c, target: g });
    expect(globalPower(s, g)).toBe(power(s, g));
    expect(s.cards[c].linkedTo).toBe(g);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
    s0.cards[ill(s0, 'p1')].tokens = 0;
    expect(() => play(s0, 'p1', { card: c, target: g })).toThrow(/Illuminati/);
  });

  it('Messiah: +4/+4 plus +2 each per Church you control; one in play; not during an attack', () => {
    const s0 = scenario();
    const perot = under(s0, 'p1', 'ross-perot');
    under(s0, 'p1', 'religious-reich', 'RIGHT');
    const m = hand(s0, 'p1', 'messiah');
    const s = resolved(s0, 'p1', { card: m, target: perot });
    expect(power(s, perot)).toBe(2 + 6);
    expect(resistance(s, perot)).toBe(6 + 6);
    const m2 = hand(s, 'p1', 'messiah');
    expect(() => play(s, 'p1', { card: m2, target: perot })).toThrow(/one Messiah/);
    const rival = under(s0, 'p2', 'bill-clinton');
    expect(() => play(s0, 'p1', { card: m, target: rival })).toThrow(/Personality you control/);
    const att = under(s0, 'p1', 'the-mafia', 'LEFT');
    const inAttack = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: rival });
    expect(() => play(inAttack, 'p1', { card: m, target: perot })).toThrow(/during an attack/);
  });

  it('Never Surrender: a Fanatic Group\'s Resistance becomes 12, even mid-attack', () => {
    const s0 = scenario();
    const w = under(s0, 'p2', 'w-i-t-c-h');
    const n = hand(s0, 'p2', 'never-surrender');
    const att = under(s0, 'p1', 'the-mafia');
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: w });
    const before = attackStrength(s, s.attack!).defense;
    s = play(s, 'p2', { card: n, target: w });
    expect(attackStrength(s, s.attack!).defense - before).toBe(12 - 6);
    s = finish(s, [12, 12]);
    expect(s.cards[n].linkedTo).toBe(w);
    expect(resistance(s, w)).toBe(12);
    const plain = under(s0, 'p2', 'loan-sharks', 'RIGHT');
    const n1 = hand(s0, 'p1', 'never-surrender');
    expect(() => play(s0, 'p1', { card: n1, target: plain })).toThrow(/Fanatic/);
    expect(resistance(resolved(s0, 'p1', { card: n1, target: w }), w)).toBe(12);
  });

  it('Resistance is Useless: Resistance 0 until end of turn, paid by a Media Group', () => {
    const s0 = scenario();
    const media = under(s0, 'p1', 'cable-tv');
    const t = under(s0, 'p2', 'wall-street');
    const r = hand(s0, 'p1', 'resistance-is-useless');
    const other = under(s0, 'p1', 'the-mafia', 'RIGHT');
    expect(() => play(s0, 'p1', { card: r, target: t, payWith: [other] })).toThrow(/Media/);
    let s = resolved(s0, 'p1', { card: r, target: t, payWith: [media] });
    expect(resistance(s, t)).toBe(0);
    expect(s.cards[media].tokens).toBe(0);
    s = act(s, 'p1', { type: 'endTurn' });
    s = act(s, 'p2', { type: 'pass' });
    expect(resistance(s, t)).toBe(3);
  });

  it('Resistance is Useless removes the master-alignment bonus in a control attack', () => {
    const s0 = scenario();
    const media = under(s0, 'p1', 'cable-tv');
    const m = under(s0, 'p2', 'the-mafia');
    const t = under(s0, 'p2', 'loan-sharks', 'BOTTOM', m); // both Criminal
    const att = under(s0, 'p1', 'wall-street', 'RIGHT');
    const r = hand(s0, 'p1', 'resistance-is-useless');
    const s = resolved(s0, 'p1', { card: r, target: t, payWith: [media] });
    const a = act(s, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: t });
    // Only the closeness bonus (+5 at depth 2) is left.
    expect(attackStrength(a, a.attack!).defense).toBe(5);
  });
});

describe('alignment changes', () => {
  it('Nationalization: gains Government, loses Corporate; Government payers need double Resistance vs Corporate', () => {
    const s0 = scenario();
    const t = under(s0, 'p1', 'wall-street');
    const n = hand(s0, 'p1', 'nationalization');
    const gov = under(s0, 'p1', 'bank-of-england', 'RIGHT'); // Power 3 < 2 x 3
    expect(() => play(s0, 'p1', { card: n, target: t, payWith: [gov] })).toThrow(/6 Power/);
    const s = resolved(s0, 'p1', { card: n, target: t, payWith: [ill(s0, 'p1')] });
    expect(alignments(s, t)).toContain('Government');
    expect(alignments(s, t)).not.toContain('Corporate');
    expect(s.cards[n].linkedTo).toBe(t);
  });
  it('Privatization: gains Corporate, loses Government; only Corporate Groups may pay', () => {
    const s0 = scenario();
    const t = under(s0, 'p1', 'federal-reserve');
    const p = hand(s0, 'p1', 'privatization');
    const gov = under(s0, 'p1', 'bank-of-england', 'RIGHT');
    expect(() => play(s0, 'p1', { card: p, target: t, payWith: [gov] })).toThrow(/Corporate/);
    const s = resolved(s0, 'p1', { card: p, target: t, payWith: [ill(s0, 'p1')] });
    expect(alignments(s, t)).toEqual(['Corporate']);
  });
  it('Power Corrupts: gains Criminal when Criminal payers reach the Resistance (+ closeness vs a rival)', () => {
    const s0 = scenario();
    const t = under(s0, 'p2', 'cable-tv'); // Resistance 2, +10 at depth 1
    const c = hand(s0, 'p1', 'power-corrupts');
    const mafia = under(s0, 'p1', 'the-mafia');
    expect(() => play(s0, 'p1', { card: c, target: t, payWith: [mafia] })).toThrow(/12 Power/);
    const s = resolved(s0, 'p1', { card: c, target: t, payWith: [ill(s0, 'p1')] });
    expect(alignments(s, t)).toContain('Criminal');
  });
});

describe('Action tokens', () => {
  it('Market Manipulation: one Corporate Group plus rival Bank Groups lose their tokens, no action needed', () => {
    const s0 = scenario();
    const bank1 = under(s0, 'p2', 'wall-street');
    const bank2 = under(s0, 'p2', 'federal-reserve', 'RIGHT');
    const corp = under(s0, 'p2', 'cable-tv', 'LEFT');
    const other = under(s0, 'p2', 'big-media', 'TOP');
    const mm = hand(s0, 'p1', 'market-manipulation');
    expect(() => play(s0, 'p1', { card: mm, target: other })).toThrow(/Corporate or Bank/);
    const s = resolved(s0, 'p1', { card: mm, target: corp });
    expect([s.cards[bank1].tokens, s.cards[bank2].tokens, s.cards[corp].tokens, s.cards[other].tokens]).toEqual([0, 0, 0, 1]);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(1);
  });
  it('Mass Murder: rival Media Groups lose tokens; cost is the Illuminati or 5 Power of Media', () => {
    const s0 = scenario();
    const t = under(s0, 'p2', 'big-media');
    const t2 = under(s0, 'p2', 'tabloids', 'RIGHT');
    const small = under(s0, 'p1', 'cable-tv');
    const mm = hand(s0, 'p1', 'mass-murder');
    expect(() => play(s0, 'p1', { card: mm, target: t, payWith: [small] })).toThrow(/5 or more/);
    const s = resolved(s0, 'p1', { card: mm, target: t, payWith: [ill(s0, 'p1')] });
    expect(s.cards[t].tokens).toBe(0);
    expect(s.cards[t2].tokens).toBe(0);
    expect(s.cards[small].tokens).toBe(1);
  });
  it('Mass Murder cancels a Media Group\'s just-taken action in an attack', () => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'the-mafia');
    const tgt = under(s0, 'p2', 'girlie-magazines');
    const opp = under(s0, 'p2', 'big-media', 'RIGHT'); // shares Liberal
    const mm = hand(s0, 'p1', 'mass-murder');
    s0.cards[ill(s0, 'p1')].tokens = 2;
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    const before = attackStrength(s, s.attack!).defense;
    s = act(s, 'p1', { type: 'pass' });
    s = act(s, 'p2', { type: 'oppose', group: opp });
    expect(attackStrength(s, s.attack!).defense).toBe(before + 4);
    s = play(s, 'p1', { card: mm, target: opp, payWith: [ill(s, 'p1')] });
    expect(attackStrength(s, s.attack!).defense).toBe(before);
  });
  it('Miracle Diet Plan: rival Group loses tokens and your Science Group\'s next action is tripled', () => {
    const s0 = scenario();
    const media = under(s0, 'p1', 'cable-tv');
    const sci = under(s0, 'p1', 'fbi', 'RIGHT');
    const rival = under(s0, 'p2', 'loan-sharks');
    const md = hand(s0, 'p1', 'miracle-diet-plan');
    expect(() => play(s0, 'p1', { card: md, target: rival, helper: media, payWith: [media] })).toThrow(/Science/);
    let s = resolved(s0, 'p1', { card: md, target: rival, helper: sci, payWith: [media] });
    expect(s.cards[rival].tokens).toBe(0);
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: sci, target: rival });
    const line = attackStrength(s, s.attack!).lines.find((l) => l.includes('Miracle Diet Plan'));
    expect(line).toMatch(/Attack \+8/);
    const md2 = hand(s, 'p1', 'miracle-diet-plan');
    expect(() => play(s, 'p1', { card: md2, target: rival, helper: sci, payWith: [media] })).toThrow(/during an attack/);
    s = finish(s, [12, 12]);
    expect(s.cards[md].zone).toBe('discard');
  });
  it('Reach Out: only at the end of your turn; strips a rival\'s Groups and your own', () => {
    const s0 = scenario();
    const mine = under(s0, 'p1', 'the-mafia');
    const theirs = under(s0, 'p2', 'loan-sharks');
    s0.cards[ill(s0, 'p1')].tokens = 2;
    const ro = hand(s0, 'p1', 'reach-out');
    expect(() => play(s0, 'p1', { card: ro, target: theirs })).toThrow(/end of your own turn/);
    let s = act(s0, 'p1', { type: 'endTurn' });
    s = resolved(s, 'p1', { card: ro, target: theirs });
    expect([s.cards[mine].tokens, s.cards[ill(s, 'p1')].tokens, s.cards[theirs].tokens, s.cards[ill(s, 'p2')].tokens]).toEqual([0, 0, 0, 0]);
    expect(s.phase).toBe('endOfTurn');
  });
});

describe('hands and hidden Plots', () => {
  it('Let\'s You and Him Fight: one of two random Group cards is discarded; a lone one is lost', () => {
    const s0 = scenario();
    const t = under(s0, 'p2', 'loan-sharks');
    const lone = hand(s0, 'p2', 'the-mafia');
    const f = hand(s0, 'p1', 'let-s-you-and-him-fight');
    let s = resolved(s0, 'p1', { card: f, target: t });
    expect(s.cards[lone].zone).toBe('discard');
    s0.cards[ill(s0, 'p1')].tokens = 0;
    expect(() => play(s0, 'p1', { card: f, target: t })).toThrow(/Illuminati/);
    s0.cards[ill(s0, 'p1')].tokens = 1;
    hand(s0, 'p2', 'cable-tv'); hand(s0, 'p2', 'fbi');
    s = resolved(s0, 'p1', { card: f, target: t });
    expect(s.players[1].hand.length).toBe(2);
  });
  it('Logic Bomb: take one of a rival\'s hidden Plots, exposed; needs a Power 6 Group', () => {
    const s0 = scenario();
    const t = under(s0, 'p2', 'loan-sharks');
    const secret = hand(s0, 'p2', 'tornado');
    const lb = hand(s0, 'p1', 'logic-bomb');
    const weak = under(s0, 'p1', 'cable-tv');
    const big = under(s0, 'p1', 'pentagon', 'RIGHT');
    expect(() => play(s0, 'p1', { card: lb, target: t, payWith: [weak] })).toThrow(/Power 6/);
    const s = resolved(s0, 'p1', { card: lb, target: t, payWith: [big], targets: [secret] });
    expect(s.players[0].hand).toContain(secret);
    expect(s.cards[secret].exposed).toBe(true);
    expect(s.players[1].hand).not.toContain(secret);
  });
  it('Mutual Betrayal: expose his Plots one-for-one with your own', () => {
    const s0 = scenario();
    const t = under(s0, 'p2', 'loan-sharks');
    const a = hand(s0, 'p2', 'tornado');
    const b = hand(s0, 'p2', 'reload');
    const mine = hand(s0, 'p1', 'hoax');
    const mb = hand(s0, 'p1', 'mutual-betrayal');
    const g = under(s0, 'p1', 'the-mafia');
    expect(() => play(s0, 'p1', { card: mb, target: t, payWith: [g], targets: [a, b, mine] })).toThrow(/one of your own/);
    const s = resolved(s0, 'p1', { card: mb, target: t, payWith: [g], targets: [a, mine] });
    expect([s.cards[a].exposed, s.cards[b].exposed, s.cards[mine].exposed]).toEqual([true, undefined, true]);
  });
  it('Nice Idea, It\'s Mine Now!: take a rival\'s exposed Goal on your turn', () => {
    const s0 = scenario();
    const goal = hand(s0, 'p2', 'criminal-overlords');
    const ni = hand(s0, 'p1', 'nice-idea-it-s-mine-now');
    expect(() => play(s0, 'p1', { card: ni, target: goal })).toThrow(/exposed Goal/);
    s0.cards[goal].exposed = true;
    const s = resolved(s0, 'p1', { card: ni, target: goal });
    expect(s.players[0].hand).toContain(goal);
    expect(s.cards[goal].exposed).toBe(true);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
  });
  it('Impostor: a duplicate of an Assassinated Personality enters play; the kill no longer counts', () => {
    const s0 = scenario();
    const orig = destroyed(s0, 'p1', 'ross-perot', 'p2', true);
    const dup = hand(s0, 'p1', 'ross-perot');
    const imp = hand(s0, 'p1', 'impostor');
    const wrong = under(s0, 'p1', 'the-mafia');
    const right = under(s0, 'p1', 'religious-reich', 'RIGHT'); // Straight, Conservative
    expect(() => play(s0, 'p1', { card: imp, payWith: [wrong] })).toThrow(/sharing an alignment/);
    const s = resolved(s0, 'p1', { card: imp, target: dup, payWith: [right] });
    expect(s.cards[dup].zone).toBe('structure');
    expect(s.cards[dup].controller).toBe('p1');
    expect(s.players[1].destroyedCredit).not.toContain(orig);
    s0.cards[orig].killed = false;
    expect(() => play(s0, 'p1', { card: imp, payWith: [right] })).toThrow(/Assassinated/);
  });
  it('Media Blitz: a duplicate of a destroyed Group returns, paid by a Media Group; not for Assassinated Personalities', () => {
    const s0 = scenario();
    const orig = destroyed(s0, 'p1', 'loan-sharks', 'p2');
    const dup = hand(s0, 'p1', 'loan-sharks');
    const mb = hand(s0, 'p1', 'media-blitz');
    const media = under(s0, 'p1', 'cable-tv');
    const s = resolved(s0, 'p1', { card: mb, payWith: [media] });
    expect(s.cards[dup].zone).toBe('structure');
    expect(s.players[1].destroyedCredit).not.toContain(orig);
    const s1 = scenario();
    destroyed(s1, 'p1', 'ross-perot', 'p2', true);
    hand(s1, 'p1', 'ross-perot');
    const mb1 = hand(s1, 'p1', 'media-blitz');
    const media1 = under(s1, 'p1', 'cable-tv');
    expect(() => play(s1, 'p1', { card: mb1, payWith: [media1] })).toThrow(/Assassinated/);
  });
});

describe('attacks', () => {
  it('Mistaken Identity: an Assassination fails automatically; only against Assassinations', () => {
    const s0 = scenario();
    const t = under(s0, 'p2', 'bill-clinton');
    const sn = hand(s0, 'p1', 'sniper');
    const mi = hand(s0, 'p2', 'mistaken-identity');
    let s = play(s0, 'p1', { card: sn, target: t });
    s = play(s, 'p2', { card: mi });
    s = finish(s, [2, 2]);
    expect(s.cards[t].zone).toBe('structure');
    const att = under(s0, 'p1', 'the-mafia');
    const a = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: t });
    expect(() => play(a, 'p2', { card: mi })).toThrow(/Assassination/);
  });
  it('Mothers\' March: a successful Attack to Destroy is re-rolled at -4; needs a Power 3 Group', () => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'the-mafia');
    const t = under(s0, 'p2', 'loan-sharks');
    const weak = under(s0, 'p2', 'comic-books', 'RIGHT');
    const strong = under(s0, 'p2', 'fbi', 'LEFT');
    const mm = hand(s0, 'p2', 'mother-s-march');
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: t });
    s.attack!.attackBonus.push({ player: 'p1', amount: 30, label: 'test' });
    s = act(s, 'p1', { type: 'pass' });
    s = act(s, 'p2', { type: 'pass' });
    s.attack!.roll = [1, 1];
    expect(() => play(s, 'p2', { card: mm, payWith: [weak] })).toThrow(/Power 3/);
    const before = attackStrength(s, s.attack!).strength;
    s = play(s, 'p2', { card: mm, payWith: [strong] });
    expect(attackStrength(s, s.attack!).strength).toBe(before - 4);
    expect(s.attack!.plays.at(-1)!.effect.t).toBe('reroll');
    const c = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: t });
    c.attack!.attackBonus.push({ player: 'p1', amount: 30, label: 'test' });
    const r = act(act(c, 'p1', { type: 'pass' }), 'p2', { type: 'pass' });
    r.attack!.roll = [1, 1];
    expect(() => play(r, 'p2', { card: mm, payWith: [strong] })).toThrow(/Attack to Destroy/);
  });
  it('Payoff: a rival\'s agents card duplicating your Group is discarded without effect', () => {
    const s0 = scenario();
    const att = under(s0, 'p1', 'the-mafia');
    const t = under(s0, 'p2', 'loan-sharks');
    const agent = hand(s0, 'p1', 'loan-sharks');
    const po = hand(s0, 'p2', 'payoff');
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: t });
    const base = attackStrength(s, s.attack!).attack;
    const sw = hand(s, 'p1', 'swiss-bank-account');
    s = act(s, 'p1', { type: 'agent', card: agent, as: 'aid' });
    expect(attackStrength(s, s.attack!).attack).toBe(base + 10);
    expect(() => play(s, 'p2', { card: po, target: sw })).toThrow(/duplicate/);
    s = play(s, 'p2', { card: po, target: agent });
    expect(attackStrength(s, s.attack!).attack).toBe(base);
    s = finish(s, [12, 12]);
    expect(s.cards[agent].zone).toBe('discard');
  });
  it('Plague of Demons: Disaster at 10 + the Magic Group\'s Power (not Huge), or +10 vs a Magic Group', () => {
    const s0 = scenario();
    const magic = under(s0, 'p1', 'w-i-t-c-h');
    const place = under(s0, 'p2', 'hollywood');
    const huge = under(s0, 'p2', 'california', 'RIGHT');
    const pd = hand(s0, 'p1', 'plague-of-demons');
    expect(() => play(s0, 'p1', { card: pd, target: huge, payWith: [magic] })).toThrow(/Huge/);
    const s = play(s0, 'p1', { card: pd, target: place, payWith: [magic] });
    expect(s.attack!.instantPower).toBe(13);
    expect(s.attack!.disaster!.destroyMargin).toBe(6);
    expect(s.cards[magic].tokens).toBe(0);
    const ninjas = under(s0, 'p2', 'ninjas', 'LEFT');
    const att = under(s0, 'p1', 'the-mafia', 'RIGHT');
    let b = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: ninjas });
    const before = attackStrength(b, b.attack!).attack;
    b = play(b, 'p1', { card: pd, mode: 'boost' });
    expect(attackStrength(b, b.attack!).attack).toBe(before + 10);
    const c = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: place });
    expect(() => play(c, 'p1', { card: pd, mode: 'boost' })).toThrow(/Magic/);
  });
  it('Nuclear Accident: 14 vs Huge, 18 otherwise; Nuclear Power Companies lose their token', () => {
    const s0 = scenario();
    const place = under(s0, 'p2', 'hollywood');
    const huge = under(s0, 'p2', 'california', 'RIGHT');
    const npc = under(s0, 'p1', 'nuclear-power-companies');
    const na = hand(s0, 'p1', 'nuclear-accident');
    const s = play(s0, 'p1', { card: na, target: place });
    expect(s.attack!.instantPower).toBe(18);
    expect(s.attack!.disaster!.destroyMargin).toBe(5);
    expect(s.cards[npc].tokens).toBe(0);
    expect(play(s0, 'p1', { card: na, target: huge }).attack!.instantPower).toBe(14);
    const notPlace = under(s0, 'p2', 'loan-sharks', 'LEFT');
    expect(() => play(s0, 'p1', { card: na, target: notPlace })).toThrow(/Place/);
  });
  it('Rain of Frogs: 10 + 4 per Frog God the target\'s owner has in play, any size', () => {
    const s0 = scenario();
    const huge = under(s0, 'p2', 'california');
    give(s0, 'p2', 'the-frog-god', { resource: true });
    const rf = hand(s0, 'p1', 'rain-of-frogs');
    const s = play(s0, 'p1', { card: rf, target: huge });
    expect(s.attack!.instantPower).toBe(14);
    expect(s.attack!.disaster!.destroyMargin).toBe(7);
    const notPlace = under(s0, 'p2', 'loan-sharks', 'LEFT');
    expect(() => play(s0, 'p1', { card: rf, target: notPlace })).toThrow(/Place/);
  });
});

describe('turn structure', () => {
  it('Power Grab: a second automatic takeover right after the first, then the turn ends', () => {
    const s0 = scenario();
    const first = hand(s0, 'p2', 'loan-sharks');
    const second = hand(s0, 'p2', 'the-mafia');
    const pg = hand(s0, 'p2', 'power-grab');
    expect(() => play(s0, 'p1', { card: hand(s0, 'p1', 'power-grab') })).toThrow(/automatic takeover/);
    let s = act(s0, 'p1', { type: 'endTurn' });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.prompt?.kind).toBe('takeover');
    s = act(s, 'p2', { type: 'takeover', card: first, onto: ill(s, 'p2'), side: 'BOTTOM' });
    const later = act(s, 'p2', { type: 'buyPlot', payWith: [ill(s, 'p2')] });
    expect(() => play(later, 'p2', { card: pg, target: second })).toThrow(/right after/);
    s = play(s, 'p2', { card: pg, target: second, helper: ill(s, 'p2'), mode: 'RIGHT' });
    s = act(s, 'p1', { type: 'pass' });
    expect(s.cards[second].zone).toBe('structure');
    expect(s.cards[second].tokens).toBe(1);
    expect(s.phase).toBe('endOfTurn');
  });
});
