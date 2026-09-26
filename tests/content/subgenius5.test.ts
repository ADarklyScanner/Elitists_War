// SubGenius pack, faithfulness pass: every card played exactly as printed (and the official SubGenius
// rules and FAQ). These tests cover the behaviours that pass added or corrected; the batch test files
// cover the rest of each card.
import { describe, expect, it } from 'vitest';
import {
  CARDS, CHURCH, HOOKS, advance, applyAction, attackStrength, cardRoll, createGame, destroyGroup, globalPower, openArrows, outSides,
  attributes, power, registerHooks, resistance, takeoverOptions, waitingFor, type Action, type CardDef, type GameState, type PlotPlay, type Side,
} from '../../src/engine';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const play = (s: GameState, pl: string, p: PlotPlay) => act(s, pl, { type: 'playPlot', play: p });
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const hand = (s: GameState, pl: string, id: string) => give(s, pl, id, { hand: true });
const put = (s: GameState, pl: string, id: string, master?: string, side?: Side) => {
  const m = master ?? ill(s, pl);
  return give(s, pl, id, { under: m, side: side ?? openArrows(s, m)[0] });
};
const use = (s: GameState, pl: string, card: string, ability: string, params: Record<string, unknown> = {}) =>
  act(s, pl, { type: 'useAbility', card, ability, params });
const attack = (s: GameState, pl: string, attacker: string, target: string, attackType: 'control' | 'destroy', plots?: PlotPlay[]) =>
  act(s, pl, { type: 'attack', attackType, attacker, target, ...(plots ? { plots } : {}) });
/** Pass while a window is open and nobody has a question to answer. */
function passAll(s: GameState): GameState {
  for (let i = 0; i < 40 && s.window && !s.prompt; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
function resolveAttack(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 30 && s.attack && !s.prompt; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
const boost = (s: GameState, pl: string, n = 40) => { s.attack!.attackBonus.push({ player: pl, amount: n, label: 'test' }); return s; };
const choose = (s: GameState, id?: string) => act(s, s.prompt!.player, { type: 'choose', ids: [id ?? s.prompt!.choice!.options[0].id] });
/** End the active player's turn and play on until `pl` reaches his main phase (questions of his own stop it). */
function toTurnOf(s: GameState, pl: string): GameState {
  s = act(s, s.players[s.active].id, { type: 'endTurn' });
  for (let i = 0; i < 80; i++) {
    if (s.players[s.active].id === pl && s.phase === 'main' && !s.window) return s;
    if (s.prompt?.kind === 'takeover') s = act(s, s.prompt.player, { type: 'skipTakeover' });
    else if (s.prompt?.kind === 'draw') s = act(s, s.prompt.player, { type: 'skipDraw' });
    else if (s.prompt) return s;
    else if (s.window) s = act(s, waitingFor(s)[0], { type: 'pass' });
    else if (s.phase === 'main') s = act(s, s.players[s.active].id, { type: 'endTurn' });
    else throw new Error(`stuck in ${s.phase}`);
  }
  throw new Error('never reached that turn');
}

const group = (id: string, o: Partial<CardDef>): CardDef => ({
  id, name: id, type: 'Group', subtype: 'Organization', rarity: null, text: '', power: 4, globalPower: 0, resistance: 4,
  alignments: [], attributes: [], arrowIn: 'TOP', arrowsOut: ['BOTTOM', 'LEFT', 'RIGHT'], ...o,
});
for (const d of [
  group('sg5-weird', { alignments: ['Weird'], power: 5 }),
  group('sg5-plain', { power: 5 }),
  group('sg5-sub', { attributes: ['SubGenius'], power: 5 }),
  group('sg5-weird-sub', { alignments: ['Weird'], attributes: ['SubGenius'], power: 3 }),
  group('sg5-strong', { power: 30, resistance: 1 }),
  group('sg5-personality', { subtype: 'Personality', power: 2, resistance: 2 }),
  group('sg5-violent', { alignments: ['Violent'], power: 3, resistance: 3 }),
  group('sg5-sub-place', { subtype: 'Place', attributes: ['SubGenius'], power: 2, resistance: 4 }),
  { id: 'sg5-booster', name: 'sg5-booster', type: 'Resource', subtype: 'Resource', rarity: null, text: '' } as CardDef,
]) CARDS[d.id] = d;
// A Resource of its own kind that also raises its holder's Illuminati's Power (for The True Pipe).
registerHooks({ 'sg5-booster': { powerMod: (s, self, iid) => (s.cards[self].controller && iid === ill(s, s.cards[self].controller!) ? 1 : 0) } });

const sgGame = (seed = 4) => {
  let s = createGame({ seed, players: [1, 2].map((i) => ({ id: `p${i}`, name: `P${i}`, isAI: true, deck: { illuminati: CHURCH, plots: [], groups: [] } })), settings: { subgeniusRules: true } });
  if (s.prompt?.kind === 'takeover') s = act(s, s.players[s.active].id, { type: 'skipTakeover' });
  s.phase = 'main'; s.prompt = undefined; s.promptQueue = undefined; s.window = undefined;
  for (const p of s.players) p.turnsTaken = 1;
  return s;
};

// ---------------------------------------------------------------- Groups

describe('Citizens for Normalcy: never the puppet of the Church, the Discordians, Weird or SubGenius Groups', () => {
  it('an automatic takeover offers only arrows of other masters (never the Church Illuminati itself)', () => {
    const s = scenario();
    s.cards[ill(s, 'p1')].cardId = CHURCH;
    const weird = put(s, 'p1', 'sg5-weird');
    const plain = put(s, 'p1', 'sg5-plain');
    const cit = hand(s, 'p1', 'citizens-for-normalcy');
    const masters = new Set(takeoverOptions(s, 'p1').filter((o) => o.card === cit).map((o) => o.onto));
    expect(masters).toEqual(new Set([plain]));
    expect(masters.has(weird)).toBe(false);
  });
  it('cannot be moved under a SubGenius Group, but may go under another', () => {
    let s = scenario();
    const sub = put(s, 'p1', 'sg5-sub');
    const plain = put(s, 'p1', 'sg5-plain');
    const cit = put(s, 'p1', 'citizens-for-normalcy');
    expect(() => act(s, 'p1', { type: 'move', group: cit, onto: sub, side: openArrows(s, sub)[0], payWith: ill(s, 'p1') })).toThrow(/not open/);
    s = passAll(act(s, 'p1', { type: 'move', group: cit, onto: plain, side: openArrows(s, plain)[0], payWith: ill(s, 'p1') }));
    expect(s.cards[cit].master).toBe(plain);
  });
  it('is immune to a direct Attack to Control by a Weird Group even from a hand, but not by others', () => {
    const s = scenario();
    const weird = put(s, 'p1', 'sg5-weird');
    const plain = put(s, 'p1', 'sg5-plain');
    const cit = hand(s, 'p1', 'citizens-for-normalcy');
    expect(() => attack(s, 'p1', weird, cit, 'control')).toThrow(/immune/);
    expect(() => attack(s, 'p1', plain, cit, 'control')).not.toThrow();
  });
  it('can cancel a Plot played in an attack, for its token and an Illuminati token', () => {
    let s = scenario();
    const cit = put(s, 'p2', 'citizens-for-normalcy');
    const att = put(s, 'p1', 'sg5-strong');
    const tgt = put(s, 'p2', 'sg5-plain');
    const lp = hand(s, 'p1', 'luck-plane');
    const d = [hand(s, 'p1', 'x-day'), hand(s, 'p1', 'x-day'), hand(s, 'p1', 'x-day')];
    s = attack(s, 'p1', att, tgt, 'destroy');
    for (let i = 0; i < 5 && s.window?.kind === 'attack'; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
    s.attack!.roll = [6, 6];
    s = play(s, 'p1', { card: lp, discards: d });
    const illTokens = s.cards[ill(s, 'p2')].tokens;
    s = use(s, 'p2', cit, 'cancel-plot', { target: lp });
    expect(s.attack!.plays.some((p) => p.effect.t === 'cancelPlot' && p.effect.target === lp)).toBe(true);
    expect(s.cards[ill(s, 'p2')].tokens).toBe(illTokens - 1);
    expect(s.cards[cit].tokens).toBe(0);
  });
});

describe('"Bobbies"', () => {
  it('a successful Attack to Destroy makes the attacker discard them or give them to a rival; they are never destroyed', () => {
    let s = scenario();
    const bob = put(s, 'p2', 'bobbies');
    const hold = put(s, 'p2', 'sg5-plain');
    const att = put(s, 'p1', 'sg5-strong');
    s = resolveAttack(boost(attack(s, 'p1', att, bob, 'destroy'), 'p1'), [1, 1]);
    expect(s.prompt?.choice?.key).toBe('bobbies-relocate');
    const give2 = s.prompt!.choice!.options.find((o) => o.id.includes(`|${hold}|`))!;
    s = choose(s, give2.id);
    expect(s.cards[bob]).toMatchObject({ zone: 'structure', controller: 'p2', master: hold });
    destroyGroup(s, bob, 'p1');
    expect(s.cards[bob].zone).toBe('structure');
  });
  it('cannot be moved by their controller', () => {
    const s = scenario();
    const bob = put(s, 'p1', 'bobbies');
    const plain = put(s, 'p1', 'sg5-plain');
    expect(() => act(s, 'p1', { type: 'move', group: bob, onto: plain, side: openArrows(s, plain)[0], payWith: ill(s, 'p1') })).toThrow(/not open/);
  });
  it('whoever takes them over may hang them at once on a rival\'s open arrow', () => {
    let s = scenario();
    const bob = hand(s, 'p1', 'bobbies');
    s.prompt = { player: 'p1', kind: 'takeover' };
    s = act(s, 'p1', { type: 'takeover', card: bob, onto: ill(s, 'p1'), side: openArrows(s, ill(s, 'p1'))[0] });
    expect(s.prompt?.choice?.key).toBe('bobbies-relocate');
    expect(s.prompt!.choice!.options[0].id).toBe('keep');
    const opt = s.prompt!.choice!.options.find((o) => o.id.startsWith('give|p2|'))!;
    s = choose(s, opt.id);
    expect(s.cards[bob].controller).toBe('p2');
  });
  it('. . . Or Kill Me! cannot make a player discard them', () => {
    let s = scenario();
    s.cards[ill(s, 'p1')].tokens = 0;
    s.cards[ill(s, 'p2')].tokens = 1;
    const bob = put(s, 'p2', 'bobbies');
    const card = hand(s, 'p1', 'or-kill-me');
    s = passAll(play(s, 'p1', { card, target: ill(s, 'p2') }));
    expect(s.prompt!.choice!.options.map((o) => o.id)).not.toContain(`discard:${bob}`);
  });
});

describe('Xists never count as destroyed', () => {
  it('no destruction credit, no "draw a Plot when you destroy" trigger; they go to the destroyer\'s hand', () => {
    let s = scenario();
    s.cards[ill(s, 'p1')].cardId = 'servants-of-cthulhu'; // draws a Plot whenever it destroys a Group
    const x = put(s, 'p2', 'xists');
    const att = put(s, 'p1', 'sg5-strong');
    const handBefore = s.players[0].hand.length;
    s = resolveAttack(boost(attack(s, 'p1', att, x, 'destroy'), 'p1'), [1, 1]);
    expect(s.cards[x].zone).toBe('hand');
    expect(s.players[0].hand).toContain(x);
    expect(s.players[0].hand.length).toBe(handBefore + 1); // Xists only, no Plot drawn
    expect(s.players[0].destroyedCredit).not.toContain(x);
  });
});

describe('Corrective Phrenologists and Phlegm Elementals act the moment the dice are rolled', () => {
  it('the Phrenologists get a new token at the roll of their attack on a rival\'s Violent Group', () => {
    let s = scenario();
    const cp = put(s, 'p1', 'corrective-phrenologists');
    const tgt = put(s, 'p2', 'sg5-violent');
    s = boost(attack(s, 'p1', cp, tgt, 'destroy'), 'p1');
    expect(s.cards[cp].tokens).toBe(0);
    for (let i = 0; i < 5 && s.window?.kind === 'attack'; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
    expect(s.window?.kind).toBe('roll');
    expect(s.cards[cp].tokens).toBe(1);
  });
  it('the Elementals befoul the target at the roll, whatever the outcome', () => {
    let s = scenario();
    const pe = put(s, 'p1', 'phlegm-elementals');
    const tgt = put(s, 'p2', 'sg5-plain');
    s = boost(attack(s, 'p1', pe, tgt, 'destroy'), 'p1');
    for (let i = 0; i < 5 && s.window?.kind === 'attack'; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
    expect(s.cards[tgt].data?.skipTokenGain).toBe(true);
    s = resolveAttack(s, [6, 6]);
    expect(s.cards[tgt].data?.skipTokenGain).toBe(true);
  });
});

describe('S.L.A.K., Martyr Meter and Dokstok act in the token placement phase', () => {
  it('S.L.A.K. gets a token at a rival\'s token placement, not at its own', () => {
    let s = scenario();
    const slak = put(s, 'p1', 's-l-a-k');
    s.cards[slak].tokens = 0;
    s = toTurnOf(s, 'p2');
    expect(s.cards[slak].tokens).toBe(1);
  });
  it('the Martyr Meter asks its holder which Personality gets the extra token', () => {
    let s = scenario();
    give(s, 'p1', 'martyr-meter', { resource: true });
    const a = put(s, 'p1', 'sg5-personality');
    const b = put(s, 'p1', 'george-bush');
    s = toTurnOf(s, 'p2');
    s = toTurnOf(s, 'p1');
    expect(s.prompt?.choice?.key).toBe('martyr-meter');
    s = choose(s, b);
    expect(s.cards[b].tokens).toBe(2);
    expect(s.cards[a].tokens).toBe(1);
  });
  it('Dokstok\'s extra token goes to a rival (or away) before its controller does anything else', () => {
    let s = scenario();
    put(s, 'p1', 'dokstok');
    s = toTurnOf(s, 'p2');
    s = toTurnOf(s, 'p1');
    expect(s.prompt?.choice?.key).toBe('dokstok-token');
    const mine = s.cards[ill(s, 'p1')].tokens;
    expect(() => act(s, 'p1', { type: 'endTurn' })).toThrow();
    s = choose(s, 'discard');
    expect(s.cards[ill(s, 'p1')].tokens).toBe(mine);
  });
});

describe('Dr. K\'Taden Legume', () => {
  it('stops attacks on his controller\'s other SubGenius Personalities, even by that player, but not other Plots', () => {
    const s = scenario();
    put(s, 'p1', 'dr-k-taden-legume');
    const jb = put(s, 'p1', 'jesus-b');
    const att = put(s, 'p1', 'sg5-strong');
    expect(() => attack(s, 'p1', att, jb, 'destroy')).toThrow(/immune/);
    const frop = hand(s, 'p2', 'overman');
    s.active = 1;
    expect(() => play(s, 'p2', { card: frop, target: jb })).not.toThrow();
  });
});

describe('Reverend Ivan Stang', () => {
  it('may give his token to a rival\'s SubGenius Group that has none', () => {
    let s = scenario();
    const stang = put(s, 'p1', 'reverend-ivan-stang');
    const theirs = put(s, 'p2', 'sg5-sub');
    s.cards[theirs].tokens = 0;
    s = passAll(use(s, 'p1', stang, 'give-token', { target: theirs }));
    expect(s.cards[theirs].tokens).toBe(1);
    expect(s.cards[stang].tokens).toBe(0);
  });
});

describe('Secret FisTemple', () => {
  it('gives its token to its master only if the master is SubGenius by its own card', () => {
    const s = scenario();
    const plain = put(s, 'p1', 'sg5-plain');
    const fis = put(s, 'p1', 'secret-fistemple', plain);
    expect(() => use(s, 'p1', fis, 'pass-token', { target: plain })).toThrow(/SubGenius by its own/);
  });
  it('never takes a non-Personality as a puppet, by automatic takeover either', () => {
    const s = scenario();
    const fis = put(s, 'p1', 'secret-fistemple');
    const g = hand(s, 'p1', 'sg5-plain');
    const p = hand(s, 'p1', 'george-bush');
    const opts = takeoverOptions(s, 'p1');
    expect(opts.some((o) => o.card === g && o.onto === fis)).toBe(false);
    expect(opts.some((o) => o.card === p && o.onto === fis)).toBe(true);
  });
});

describe('Dallas Catacombs', () => {
  it('a captured Group may go on any side of the attacking Group, and a puppet may be turned to another side at any time', () => {
    const s0 = scenario();
    const cat = put(s0, 'p1', 'dallas-catacombs');
    const bush = put(s0, 'p1', 'george-bush'); // a single outgoing arrow
    const tgt = put(s0, 'p2', 'sg5-plain');
    let s: GameState | undefined;
    let fake: Side | undefined;
    for (const sd of ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] as Side[]) {
      if (outSides(s0, bush).includes(sd)) continue;
      try { s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: bush, target: tgt, side: sd }); fake = sd; break; } catch { /* occupied */ }
    }
    expect(fake).toBeTruthy();
    s = resolveAttack(boost(s!, 'p1'), [1, 1]);
    expect(s.cards[tgt]).toMatchObject({ controller: 'p1', master: bush, side: fake });
    const other = (['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] as Side[]).find((sd) => {
      if (sd === fake) return false;
      try { use(s!, 'p1', cat, 'turn-side', { target: tgt, mode: sd }); return true; } catch { return false; }
    })!;
    s = passAll(use(s, 'p1', cat, 'turn-side', { target: tgt, mode: other }));
    expect(s.cards[tgt]).toMatchObject({ master: bush, side: other });
  });
});

describe('Good Sex for Mutants Dating League', () => {
  it('-2 to a rival\'s attempt to control a Weird Group in the uncontrolled area', () => {
    let s = sgGame();
    const pl = s.players[s.active].id;
    const rival = s.players.find((p) => p.id !== pl)!.id;
    put(s, rival, 'good-sex-for-mutants-dating-league');
    const att = put(s, pl, 'sg5-plain');
    const w = give(s, pl, 'sg5-weird', { hand: true });
    s.players.find((p) => p.id === pl)!.hand = s.players.find((p) => p.id === pl)!.hand.filter((c) => c !== w);
    Object.assign(s.cards[w], { zone: 'uncontrolled' });
    s.common!.uncontrolled.push(w);
    s = attack(s, pl, att, w, 'control');
    expect(attackStrength(s, s.attack!).lines.some((l) => l.includes('-2') && l.includes('Good Sex'))).toBe(true);
  });
});

// ---------------------------------------------------------------- Resources

describe('The Prescriptures', () => {
  it('looks at the top three cards of any two decks in the game, on its holder\'s own turn only', () => {
    let s = scenario();
    const pre = give(s, 'p1', 'the-prescriptures', { resource: true });
    s = use(s, 'p1', pre, 'foresee', { mode: 'decks', payWith: [ill(s, 'p1')] });
    expect(s.prompt?.choice?.key).toBe('prescriptures-decks');
    expect(s.prompt!.choice!.options.map((o) => o.id)).toEqual(['plot|p1', 'group|p1', 'plot|p2', 'group|p2']);
    s = act(s, 'p1', { type: 'choose', ids: ['plot|p2', 'group|p2'] });
    const seen = s.log.filter((l) => l.to === 'p1').map((l) => l.text).join(' ');
    expect(seen).toMatch(/Bob's Plot deck/);
    const s2 = scenario();
    const pre2 = give(s2, 'p1', 'the-prescriptures', { resource: true });
    s2.active = 1;
    expect(() => use(s2, 'p1', pre2, 'foresee', { mode: 'decks', payWith: [ill(s2, 'p1')] })).toThrow();
  });
});

describe('The True Pipe', () => {
  it('+2 to its holder\'s Illuminati, but not combined with another Resource raising it', () => {
    const s = scenario();
    const base = power(s, ill(s, 'p1'));
    give(s, 'p1', 'the-true-pipe', { resource: true });
    expect(power(s, ill(s, 'p1'))).toBe(base + 2);
    give(s, 'p1', 'sg5-booster', { resource: true });
    expect(power(s, ill(s, 'p1'))).toBe(base + 1);
  });
});

describe('Three-Fisted Tales of "Bob"', () => {
  it('Global Power equal to the Place\'s new Power, whatever raised it', () => {
    const s = scenario();
    const place = put(s, 'p1', 'sg5-sub-place');
    const tales = give(s, 'p1', 'three-fisted-tales-of-bob', { resource: true });
    s.cards[tales].linkedTo = place;
    s.cards[place].mods.push({ source: 'test', kind: 'power', value: 3, until: 'permanent' });
    expect(power(s, place)).toBe(7);
    expect(globalPower(s, place)).toBe(7);
  });
});

describe('Janor Device and the cards changing "any die roll" work on rolls made outside attacks', () => {
  it('Luck Plane turns MWOWM\'s roll into a success', () => {
    let s = scenario();
    const lost = hand(s, 'p2', 'x-day');
    s.cards[lost].zone = 'discard';
    s.players[1].hand = s.players[1].hand.filter((c) => c !== lost);
    s.players[1].discard.push(lost);
    const lp = hand(s, 'p2', 'luck-plane');
    const d = [hand(s, 'p2', 'x-day'), hand(s, 'p2', 'x-day'), hand(s, 'p2', 'x-day')];
    s.rng = 12345;
    cardRoll(s, 'p1', 1, 'mwowm', { card: lost });
    advance(s);
    expect(s.window?.event?.type).toBe('dieRoll');
    s = act(s, 'p2', { type: 'playPlot', play: { card: lp, discards: d } });
    s = passAll(s);
    expect(s.players[0].hand).toContain(lost);
  });
  it('the Janor Device\'s holder may add 1 to such a roll of his own', () => {
    let s = scenario();
    const dev = give(s, 'p1', 'janor-device', { resource: true });
    const lost = hand(s, 'p2', 'x-day');
    s.players[1].hand = s.players[1].hand.filter((c) => c !== lost);
    s.cards[lost].zone = 'discard';
    s.players[1].discard.push(lost);
    // Find a seed whose die shows 4: the Device brings it down to 3.
    for (let seed = 1; seed < 500; seed++) {
      const t = structuredClone(s);
      t.rng = seed;
      cardRoll(t, 'p1', 1, 'mwowm', { card: lost });
      advance(t);
      if (t.window?.kind === 'event' && (t.window.event?.data?.dice as number[])[0] === 4) {
        const u = passAll(use(t, 'p1', dev, 'adjust', { mode: 'minus' }));
        expect(u.players[0].hand).toContain(lost);
        return;
      }
    }
    throw new Error('no seed gave a 4');
  });
});

// ---------------------------------------------------------------- Plots

describe('Comet Hail-"Bob" answers any control taken from a hand or the uncontrolled area', () => {
  it('after a successful Attack to Control on a Group in its attacker\'s hand', () => {
    let s = scenario();
    s.active = 1;
    const att = put(s, 'p2', 'sg5-strong');
    const tgt = hand(s, 'p2', 'sg5-plain');
    const comet = hand(s, 'p1', 'comet-hail-bob');
    s = resolveAttack(boost(attack(s, 'p2', att, tgt, 'control'), 'p2'), [1, 1]);
    expect(s.cards[tgt].controller).toBe('p2');
    expect(s.window?.kind).toBe('event');
    expect(s.window?.event?.type).toBe('gainedControl');
    s = play(s, 'p1', { card: comet, target: tgt, payWith: [ill(s, 'p1')] });
    s = passAll(s);
    expect(s.cards[tgt].zone).toBe('destroyed');
    expect(s.players[0].destroyedCredit).not.toContain(tgt);
  });
});

describe('Schizm works with any attack', () => {
  it('a successful Attack to Destroy on an undestroyable Group scatters it instead (standard game: discarded, puppets to hand)', () => {
    let s = scenario();
    const att = put(s, 'p1', 'sg5-strong');
    const jog = put(s, 'p2', 'joggers'); // cannot be destroyed
    const card = hand(s, 'p1', 'schizm');
    expect(() => attack(s, 'p1', att, jog, 'destroy')).toThrow(/cannot be destroyed/);
    s = attack(s, 'p1', att, jog, 'destroy', [{ card }]);
    s = resolveAttack(boost(s, 'p1'), [1, 1]);
    expect(s.cards[jog].zone).toBe('discard');
  });
  it('may be played by a third player on someone else\'s attack', () => {
    let s = scenario();
    const att = put(s, 'p1', 'sg5-strong');
    const tgt = put(s, 'p2', 'sg5-plain');
    s = attack(s, 'p1', att, tgt, 'control');
    const card = hand(s, 'p1', 'schizm');
    s = play(s, 'p1', { card });
    s = resolveAttack(boost(s, 'p1'), [1, 1]);
    expect(s.cards[tgt].zone).toBe('discard');
  });
});

describe('Sacred Jests', () => {
  it('the rival may use his random Plot at once in any legal way, target included, even outside his turn', () => {
    let s = scenario();
    const g = put(s, 'p2', 'sg5-sub');
    const med = hand(s, 'p2', 'mediocretinism'); // needs a SubGenius Group as its target
    const card = hand(s, 'p1', 'sacred-jests');
    s = passAll(play(s, 'p1', { card, target: ill(s, 'p2') }));
    expect(s.prompt?.choice?.key).toBe('sacred-jests');
    const opt = s.prompt!.choice!.options.find((o) => o.id.startsWith('play:'))!;
    s = passAll(choose(s, opt.id));
    expect(s.cards[med].zone).toBe('discard');
    expect(s.log.some((l) => /Mediocretinism takes effect/.test(l.text))).toBe(true);
    expect(s.cards[g].mods.some((m) => m.kind === 'removeAttr' && m.attr === 'SubGenius')).toBe(true);
  });
});

describe('Time Control', () => {
  it('cannot be played once the Illuminati spent a token this turn (buying Plots aside), and then locks it', () => {
    let s = scenario();
    s.cards[ill(s, 'p1')].tokens = 2;
    const tc = hand(s, 'p1', 'time-control');
    s = act(s, 'p1', { type: 'buyPlot', payWith: [ill(s, 'p1')] });
    s = passAll(play(s, 'p1', { card: tc }));
    expect(s.turnFlags.freeAttack).toBe('p1');
    const g = put(s, 'p1', 'sg5-plain');
    expect(() => act(s, 'p1', { type: 'move', group: g, onto: ill(s, 'p1'), side: openArrows(s, ill(s, 'p1'))[0], payWith: ill(s, 'p1') })).toThrow(/Time Control|except to buy/);
    const s2 = scenario();
    s2.cards[ill(s2, 'p1')].tokens = 2;
    const tc2 = hand(s2, 'p1', 'time-control');
    const g2 = put(s2, 'p1', 'sg5-plain');
    const g3 = put(s2, 'p1', 'sg5-plain');
    const t = passAll(act(s2, 'p1', { type: 'move', group: g2, onto: g3, side: openArrows(s2, g3)[0], payWith: ill(s2, 'p1') }));
    expect(() => play(t, 'p1', { card: tc2 })).toThrow(/already spent/);
  });
});

describe('Decency is OK!', () => {
  it('cancels the whole attack when a rival\'s Weird Group aids it', () => {
    let s = scenario();
    const att = put(s, 'p1', 'sg5-plain');
    const helper = put(s, 'p1', 'sg5-weird');
    const tgt = put(s, 'p2', 'sg5-plain');
    s = attack(s, 'p1', att, tgt, 'destroy');
    s.attack!.aid.push({ player: 'p1', iid: helper, amount: 0, label: 'aid' });
    const card = hand(s, 'p2', 'decency-is-ok');
    s = play(s, 'p2', { card, target: helper });
    s = resolveAttack(s);
    expect(s.log.some((l) => /attack was cancelled/.test(l.text))).toBe(true);
  });
});

describe('Devival for defense', () => {
  it('+10 Power counts for a Group opposing an attack, until the end of the turn', () => {
    let s = scenario();
    const att = put(s, 'p1', 'sg5-plain');
    const tgt = put(s, 'p2', 'sg5-weird');
    const sub = put(s, 'p2', 'sg5-weird-sub');
    s = attack(s, 'p1', att, tgt, 'destroy');
    s = act(s, 'p2', { type: 'oppose', group: sub });
    const before = attackStrength(s, s.attack!).defense;
    const card = hand(s, 'p2', 'devival');
    s = play(s, 'p2', { card, target: sub, mode: 'power' });
    expect(attackStrength(s, s.attack!).defense).toBe(before + 10);
  });
});

describe('The 13th Apostle', () => {
  it('may give a token to any player\'s Personality', () => {
    let s = scenario();
    const theirs = put(s, 'p2', 'george-bush');
    s.cards[theirs].tokens = 0;
    const card = hand(s, 'p1', 'the-13th-apostle');
    s = passAll(play(s, 'p1', { card, targets: [theirs], payWith: [ill(s, 'p1')] }));
    expect(s.cards[theirs].tokens).toBe(1);
  });
});

describe('False Slack', () => {
  it('hits no player more than once a turn, whichever of his Groups is chosen', () => {
    let s = scenario();
    s.cards[ill(s, 'p1')].tokens = 2;
    const a = put(s, 'p2', 'sg5-plain');
    const b = put(s, 'p2', 'sg5-plain');
    const c1 = hand(s, 'p1', 'false-slack');
    const c2 = hand(s, 'p1', 'false-slack');
    s = passAll(play(s, 'p1', { card: c1, target: a, payWith: [ill(s, 'p1')] }));
    expect(() => play(s, 'p1', { card: c2, target: b, payWith: [ill(s, 'p1')] })).toThrow(/already hit/);
  });
});

describe('Fake Healing', () => {
  it('may be played during its player\'s own attack', () => {
    let s = sgGame();
    const pl = s.players[s.active].id;
    const att = put(s, pl, 'sg5-plain');
    const tgt = s.common!.uncontrolled.find((c) => CARDS[s.cards[c].cardId].type === 'Group')!;
    s = attack(s, pl, att, tgt, 'control');
    const card = hand(s, pl, 'fake-healing');
    s = play(s, pl, { card, target: tgt });
    expect(s.cards[tgt].mods.some((m) => m.kind === 'setResistance' && m.value === 0)).toBe(true);
  });
});

describe('Robo "Bob"', () => {
  it('stays linked when its Place goes to the uncontrolled area', () => {
    let s = sgGame();
    const pl = s.players[s.active].id;
    const place = put(s, pl, 'sg5-sub-place');
    const card = hand(s, pl, 'robo-bob');
    s = passAll(play(s, pl, { card, target: place, payWith: [place] }));
    expect(s.cards[card].linkedTo).toBe(place);
    // The Place is sent to the uncontrolled area (as Schizm would); Robo "Bob" goes along.
    Object.assign(s.cards[place], { zone: 'uncontrolled', controller: undefined, master: undefined, x: undefined, y: undefined, side: undefined });
    s.common!.uncontrolled.push(place);
    s = act(s, pl, { type: 'removeToken', card: ill(s, pl) });
    expect(s.cards[card].zone).toBe('table');
    expect(s.cards[card].linkedTo).toBe(place);
  });
});

describe('The Anti"Bob"', () => {
  it('counts only Groups destroyed from a rival\'s Power Structure, and gives its token once per player', () => {
    let s = scenario();
    const v = put(s, 'p2', 'sg5-weird');
    const loose = hand(s, 'p2', 'sg5-weird');
    destroyGroup(s, v, 'p1');
    destroyGroup(s, loose, 'p1');
    expect(s.cards[v].data?.destroyedFrom).toBe('p2');
    expect(s.cards[loose].data?.destroyedFrom).toBeUndefined();
    const g = hand(s, 'p1', 'the-anti-bob');
    const before = s.cards[ill(s, 'p1')].tokens;
    s = act(s, 'p1', { type: 'exposeCard', card: g });
    expect(s.cards[ill(s, 'p1')].tokens).toBe(before + 1);
    const g2 = hand(s, 'p1', 'the-anti-bob');
    s = act(s, 'p1', { type: 'exposeCard', card: g2 });
    expect(s.cards[ill(s, 'p1')].tokens).toBe(before + 1);
  });
});

describe('Psychic Pstench', () => {
  it('its player picks which exposed Goal a rival must discard', () => {
    let s = scenario();
    const sub = put(s, 'p1', 'sg5-personality');
    s.cards[sub].mods.push({ source: 'test', kind: 'addAttr', attr: 'SubGenius', until: 'permanent' });
    s.cards[ill(s, 'p2')].cardId = 'ufos'; // may hold three Goals
    const g1 = hand(s, 'p2', 'the-anti-bob');
    const g2 = hand(s, 'p2', 'brag-of-the-subgenius');
    s.cards[g1].exposed = true; s.cards[g2].exposed = true;
    const card = hand(s, 'p1', 'psychic-pstench');
    s = passAll(play(s, 'p1', { card, target: ill(s, 'p2'), mode: 'discardGoal', payWith: [sub] }));
    expect(s.prompt?.choice?.key).toBe('pstench-goal');
    s = choose(s, g2);
    expect(s.cards[g2].zone).toBe('discard');
    expect(s.cards[g1].zone).toBe('hand');
  });
});

describe('Nental Ife and Head Launching', () => {
  it('Global Power equals Permanent Power (a change lasting only this turn is left out)', () => {
    let s = scenario();
    const jb = put(s, 'p1', 'jesus-b');
    const card = hand(s, 'p1', 'nental-ife');
    s = passAll(play(s, 'p1', { card, target: jb, payWith: [jb] }));
    s.cards[jb].mods.push({ source: 'test', kind: 'power', value: 5, until: 'endOfTurn' });
    expect(power(s, jb)).toBe(8);
    expect(globalPower(s, jb)).toBe(3);
    expect(HOOKS['nental-ife'].globalEqualsPower).toBeTruthy();
  });
});

describe('"Controls" reaches every Group below a card (SubGenius glossary, "Power Structure")', () => {
  it('SubGenius FisTemples: +5 Resistance for its puppets\' puppets too', () => {
    const s = scenario();
    const fis = put(s, 'p1', 'subgenius-fistemples');
    const pup = put(s, 'p1', 'sg5-plain', fis);
    const grand = put(s, 'p1', 'sg5-plain', pup);
    expect(resistance(s, grand)).toBe(4 + 5);
  });
  it('OverMan Philo Drummond: a Weird Group below his puppet is SubGenius too', () => {
    const s = scenario();
    const philo = put(s, 'p1', 'overman-philo-drummond');
    const pup = put(s, 'p1', 'sg5-plain', philo);
    const grand = put(s, 'p1', 'sg5-weird', pup);
    expect(attributes(s, grand)).toContain('SubGenius');
  });
  it('Secret FisTemple: a Personality bringing a non-Personality puppet along cannot come under it', () => {
    const s = scenario();
    const fis = put(s, 'p1', 'secret-fistemple');
    const bush = put(s, 'p1', 'george-bush');
    put(s, 'p1', 'sg5-plain', bush);
    expect(() => act(s, 'p1', { type: 'move', group: bush, onto: fis, side: openArrows(s, fis)[0], payWith: ill(s, 'p1') })).toThrow(/not open/);
  });
});

describe('The natural roll (SubGenius glossary) is what the dice showed', () => {
  it('a 12 made by Bulldada does not cost the attacker the Janor Device', () => {
    let s = scenario();
    const dev = give(s, 'p2', 'janor-device', { resource: true });
    s.cards[dev].controller = 'p1';
    s.cards[dev].linkedTo = ill(s, 'p1');
    const att = put(s, 'p1', 'sg5-strong');
    const tgt = put(s, 'p2', 'sg5-plain');
    const card = hand(s, 'p2', 'bulldada');
    const d = [hand(s, 'p2', 'x-day'), hand(s, 'p2', 'x-day'), hand(s, 'p2', 'x-day')];
    s = attack(s, 'p1', att, tgt, 'destroy');
    for (let i = 0; i < 5 && s.window?.kind === 'attack'; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
    s.attack!.roll = [2, 3];
    s = play(s, 'p2', { card, discards: d });
    s = resolveAttack(s);
    expect(s.cards[tgt].zone).toBe('structure');
    expect(s.cards[dev].controller).toBe('p1');
  });
});

describe('Drs. for "Bob"', () => {
  it('may add their Power, free, to their own defense too (they are a SubGenius Group you control)', () => {
    let s = scenario();
    const drs = put(s, 'p2', 'drs-for-bob');
    const att = put(s, 'p1', 'the-mafia');
    s = attack(s, 'p1', att, drs, 'control');
    const before = attackStrength(s, s.attack!).defense;
    s = use(s, 'p2', drs, 'defend-subgenius');
    expect(attackStrength(s, s.attack!).defense).toBe(before + power(s, drs));
    expect(s.cards[drs].tokens).toBe(1);
  });
});
