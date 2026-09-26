// Scripted parts of src/engine/content/subgenius4.ts: OverMan .. You'd Pay to
// Know What You Really Think! See docs/CARD_SCRIPTING.md.
import { describe, expect, it } from 'vitest';
import {
  applyAction, attackStrength, cardImplemented, CARDS, CHURCH, createGame, globalPower, goalOptions, handLimit,
  plotsInHand, power, registerAbilities, registerPlots, resistance, waitingFor, canOppose,
  type Action, type CardDef, type GameState, type PlotPlay,
} from '../../src/engine';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const play = (s: GameState, pl: string, p: PlotPlay) => act(s, pl, { type: 'playPlot', play: p });
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const hand = (s: GameState, pl: string, id: string) => give(s, pl, id, { hand: true });
const under = (s: GameState, pl: string, id: string, side: 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT' = 'BOTTOM', master?: string) =>
  give(s, pl, id, { under: master ?? ill(s, pl), side });

/** Pass for everyone while a non-attack window is open (never answers a prompt). */
function passAll(s: GameState): GameState {
  for (let i = 0; i < 40 && s.window && !s.prompt; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** Pass just long enough to reach `phase` (stops before any window that opens after it, e.g. the
 *  end-of-turn window a card that ends the turn at once opens right after resolving). */
function passUntil(s: GameState, phase: GameState['phase']): GameState {
  for (let i = 0; i < 10 && s.window && !s.prompt && s.phase !== phase; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** R027: a stray "discard down to your Plot limit" prompt (e.g. a rival dealt a big starting hand)
 *  can surface outside anyone's turn; clear it by discarding the oldest excess Plots. */
function clearDiscardPrompts(s: GameState): GameState {
  while (s.prompt?.kind === 'discardToLimit') {
    const pid = s.prompt.player;
    const plots = plotsInHand(s, pid);
    const extra = plots.length - handLimit(s, pid);
    s = act(s, pid, { type: 'discard', cards: plots.slice(0, Math.max(1, extra)) });
  }
  return s;
}
function resolveAttack(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 30 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}

const group = (id: string, o: Partial<CardDef>): CardDef => ({
  id, name: id, type: 'Group', subtype: 'Organization', rarity: null, text: '', power: 4, globalPower: 0, resistance: 4,
  alignments: [], attributes: [], arrowIn: 'TOP', arrowsOut: ['BOTTOM', 'LEFT', 'RIGHT'], ...o,
});
const plot = (id: string, o: Partial<CardDef> = {}): CardDef => ({ id, name: id, type: 'Plot', subtype: 'Plot', rarity: null, text: '', ...o });

for (const d of [
  group('sg4-personality', { subtype: 'Personality', power: 2, globalPower: 0, resistance: 2 }),
  group('sg4-personality2', { subtype: 'Personality', power: 3, resistance: 3 }),
  group('sg4-sub-personality', { subtype: 'Personality', attributes: ['SubGenius'], power: 3, resistance: 3 }),
  group('sg4-church-personality', { subtype: 'Personality', attributes: ['Church'], power: 3, resistance: 3 }),
  group('sg4-place-sub', { subtype: 'Place', attributes: ['SubGenius'], power: 2, resistance: 4 }),
  group('sg4-plain', { power: 3, resistance: 3 }),
  group('sg4-strong', { power: 30, resistance: 1 }),
  group('sg4-media', { attributes: ['Media'], alignments: ['Straight'], power: 4, resistance: 4 }),
  group('sg4-straight', { alignments: ['Straight'], power: 3, resistance: 5 }),
  group('sg4-straight2', { alignments: ['Straight'], power: 3, resistance: 5 }),
  group('sg4-weird-sub', { alignments: ['Weird'], attributes: ['SubGenius'], power: 3, resistance: 3 }),
  group('sg4-immune', { power: 3, resistance: 3 }),
  { id: 'sg4-resource', name: 'sg4-resource', type: 'Resource', subtype: 'Resource', rarity: null, text: '' } as CardDef,
  plot('sg4-simple-plot'), plot('sg4-unplayable-plot'), plot('sg4-goal', { subtype: 'Goal' }),
]) CARDS[d.id] = d;

registerPlots({
  'sg4-simple-plot': (() => {
    const perform = (s: GameState, pl: string) => { s.cards[ill(s, pl)].data = { ...s.cards[ill(s, pl)].data, played: true }; };
    return { timing: ['anytime'], check: () => null, apply: (s: GameState, pl: string, _play: PlotPlay, ctx?: unknown) => { if (ctx) perform(s, pl); }, resolve: perform };
  })(),
  'sg4-unplayable-plot': { timing: [], check: () => 'never', apply: () => undefined },
});
registerAbilities({ 'sg4-immune': [{ kind: 'selfImmune', from: {} }] });

const sgPlayers = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isAI: true, deck: { illuminati: CHURCH, plots: [], groups: [] } }));
const sg = (n = 2, seed = 4) => {
  let s = createGame({ seed, players: sgPlayers(n), settings: { subgeniusRules: true } });
  if (s.prompt?.kind === 'takeover') s = act(s, s.players[s.active].id, { type: 'skipTakeover' });
  s.phase = 'main'; s.prompt = undefined; s.promptQueue = undefined; s.window = undefined;
  return s;
};

describe('cardImplemented', () => {
  it('every card in this batch is implemented', () => {
    for (const id of [
      'overman', 'psychic-pstench', 'rain-of-prairie-squid', 'random-jesii', 'rant', 'repent', 'robo-bob', 's-c-a-m',
      'sacred-jests', 'schizm', 'shordurpersav', 'slackfusion', 'smite-them-all', 'stark-fist-of-removal', 'sultan-of-slack',
      'tape-runs-out', 'the-13th-apostle', 'the-saint-of-sales', 'the-world-ends-tomorrow-and-you-may-die', 'they-may-be-pink',
      'time-control', 'x-day', 'yacatisma', "you-d-pay-to-know-what-you-really-think",
    ]) expect(cardImplemented(id), id).toBe(true);
  });
});

describe('OverMan', () => {
  it('raises a Personality\'s Power and Global Power to 3, but never lowers them', () => {
    const s0 = scenario();
    const low = under(s0, 'p2', 'sg4-personality');
    const high = under(s0, 'p2', 'sg4-personality2', 'RIGHT');
    const card = hand(s0, 'p1', 'overman');
    let s = play(s0, 'p1', { card, target: low });
    s = passAll(s);
    expect(power(s, low)).toBe(3);
    expect(globalPower(s, low)).toBe(3);
    const card2 = hand(s, 'p1', 'overman');
    s = play(s, 'p1', { card: card2, target: high });
    s = passAll(s);
    expect(power(s, high)).toBe(3); // already 3
  });
  it('cannot affect a Personality that is already a False OverMan', () => {
    const s0 = scenario();
    const g = under(s0, 'p2', 'sg4-personality');
    const card = hand(s0, 'p1', 'overman');
    let s = play(s0, 'p1', { card, target: g });
    s = passAll(s);
    const card2 = hand(s, 'p1', 'overman');
    expect(() => play(s, 'p1', { card: card2, target: g })).toThrow(/False OverMan/);
  });
});

describe('Psychic Pstench', () => {
  it('exposes a rival\'s hidden Plots, with a SubGenius Personality action', () => {
    const s0 = scenario();
    const sub = under(s0, 'p1', 'sg4-sub-personality'); s0.cards[sub].tokens = 1;
    const hidden = hand(s0, 'p2', 'sg4-simple-plot');
    const card = hand(s0, 'p1', 'psychic-pstench');
    let s = play(s0, 'p1', { card, target: ill(s0, 'p2'), payWith: [sub] });
    s = passAll(s);
    expect(s.cards[hidden].exposed).toBe(true);
  });
  it('cannot be paid without a SubGenius Personality action', () => {
    const s0 = scenario();
    const plain = under(s0, 'p1', 'sg4-plain'); s0.cards[plain].tokens = 1;
    const card = hand(s0, 'p1', 'psychic-pstench');
    expect(() => play(s0, 'p1', { card, target: ill(s0, 'p2'), payWith: [plain] })).toThrow(/SubGenius/);
  });
  it('may instead force a rival to discard one exposed Goal', () => {
    const s0 = scenario();
    const sub = under(s0, 'p1', 'sg4-sub-personality'); s0.cards[sub].tokens = 1;
    const goal = hand(s0, 'p2', 'sg4-goal'); s0.cards[goal].exposed = true;
    const card = hand(s0, 'p1', 'psychic-pstench');
    let s = play(s0, 'p1', { card, target: ill(s0, 'p2'), mode: 'discardGoal', payWith: [sub] });
    s = passAll(s);
    expect(s.cards[goal].zone).toBe('discard');
  });
});

describe('Rain of Prairie Squid', () => {
  it('standard play: discards any number of Group cards from hand and draws as many', () => {
    const s0 = scenario();
    const g1 = hand(s0, 'p1', 'sg4-plain');
    const g2 = hand(s0, 'p1', 'sg4-media');
    const card = hand(s0, 'p1', 'rain-of-prairie-squid');
    const before = s0.players.find((p) => p.id === 'p1')!.hand.length;
    let s = play(s0, 'p1', { card, targets: [g1, g2] });
    s = passAll(s);
    expect(s.cards[g1].zone).toBe('discard');
    expect(s.cards[g2].zone).toBe('discard');
    expect(s.players.find((p) => p.id === 'p1')!.hand.length).toBe(before - 1 /* card played */ - 2 /* discarded */ + 2 /* drawn */);
  });
  it('SubGenius rules: reshuffles the whole uncontrolled area and deals as many replacements', () => {
    let s = sg(2);
    const pl = s.players[s.active].id;
    const n = s.common!.uncontrolled.length;
    const card = hand(s, pl, 'rain-of-prairie-squid');
    s = play(s, pl, { card });
    s = passAll(s);
    expect(s.common!.uncontrolled.length).toBe(n);
  });
});

describe('Random Jesii', () => {
  it('exposes all but one of a rival\'s Plots, his choice', () => {
    const s0 = scenario();
    const sub = under(s0, 'p1', 'sg4-sub-personality'); s0.cards[sub].tokens = 1;
    const a = hand(s0, 'p2', 'sg4-simple-plot');
    const b = hand(s0, 'p2', 'sg4-simple-plot');
    const card = hand(s0, 'p1', 'random-jesii');
    let s = play(s0, 'p1', { card, target: ill(s0, 'p2'), payWith: [sub] });
    s = passAll(s);
    expect(s.prompt?.kind).toBe('choose');
    s = act(s, 'p2', { type: 'choose', ids: [a] });
    expect(s.cards[a].exposed).toBeFalsy();
    expect(s.cards[b].exposed).toBe(true);
  });
  it('the Martyr Meter\'s holder is immune', () => {
    const s0 = scenario();
    const sub = under(s0, 'p1', 'sg4-sub-personality'); s0.cards[sub].tokens = 1;
    give(s0, 'p2', 'martyr-meter', { resource: true });
    const card = hand(s0, 'p1', 'random-jesii');
    expect(() => play(s0, 'p1', { card, target: ill(s0, 'p2'), payWith: [sub] })).toThrow(/Martyr Meter/);
  });
});

describe('Rant!', () => {
  it('a Personality with an open control arrow takes automatic control of an uncontrolled card; the turn ends', () => {
    let s = sg(2);
    const pl = s.players[s.active].id;
    const pers = under(s, pl, 'sg4-personality2'); s.cards[pers].tokens = 1;
    const g = s.common!.uncontrolled.find((c) => CARDS[s.cards[c].cardId].type === 'Group')!;
    const card = hand(s, pl, 'rant');
    s = play(s, pl, { card, target: g, payWith: [pers] });
    s = passUntil(s, 'endOfTurn');
    expect(s.cards[g]).toMatchObject({ zone: 'structure', controller: pl, master: pers });
    expect(s.turnFlags.endedAtOnce).toBe(true);
  });
  it('needs a Personality with an open control arrow to pay', () => {
    let s = sg(2);
    const pl = s.players[s.active].id;
    const g = s.common!.uncontrolled.find((c) => CARDS[s.cards[c].cardId].type === 'Group')!;
    const card = hand(s, pl, 'rant');
    expect(() => play(s, pl, { card, target: g, payWith: [ill(s, pl)] })).toThrow(/Personality/);
  });
});

describe('Repent!', () => {
  it('ends the turn at once and gives the Illuminati an extra Action token', () => {
    const s0 = scenario();
    // Go through a real turn transition so the actual token-placement step (and its log line) happens.
    let s = act(s0, 'p1', { type: 'endTurn' });
    s = act(s, 'p2', { type: 'pass' });
    if (s.prompt?.kind === 'takeover') s = act(s, s.players[s.active].id, { type: 'skipTakeover' });
    const pl = s.players[s.active].id;
    const before = s.cards[ill(s, pl)].tokens;
    const card = hand(s, pl, 'repent');
    s = play(s, pl, { card });
    s = passUntil(s, 'endOfTurn');
    expect(s.cards[ill(s, pl)].tokens).toBe(before + 1);
    expect(s.turnFlags.endedAtOnce).toBe(true);
  });
  it('cannot be played once something else has happened this turn', () => {
    const s0 = scenario();
    under(s0, 'p1', 'sg4-plain'); // an action logged for this turn (placement only, but log check needs an actual event)
    s0.log.push({ turn: s0.turn, player: 'p1', text: 'Something else happens.' });
    const card = hand(s0, 'p1', 'repent');
    expect(() => play(s0, 'p1', { card })).toThrow(/right after your token placement/);
  });
});

describe('Robo "Bob"', () => {
  it('guards a SubGenius Place: +5 against destruction, nobody else may control it; one per player', () => {
    const s0 = scenario();
    const place = under(s0, 'p1', 'sg4-place-sub');
    const card = hand(s0, 'p1', 'robo-bob');
    let s = play(s0, 'p1', { card, target: place, payWith: [place] });
    s = passAll(s);
    expect(resistance(s, place)).toBe(4); // no bonus outside an attack to destroy
    const attacker = under(s, 'p2', 'sg4-strong'); s.cards[attacker].tokens = 1;
    s.active = 1; // p2's turn, so p2 may attack
    expect(() => act(s, 'p2', { type: 'attack', attackType: 'control', attacker, target: place })).toThrow(/Robo "Bob"/);
    const destroy = act(s, 'p2', { type: 'attack', attackType: 'destroy', attacker, target: place });
    expect(attackStrength(destroy, destroy.attack!).lines.some((l) => l.includes('Robo') && l.includes('+5'))).toBe(true);
    s.active = 0; // back to p1's turn
    const card2 = hand(s, 'p1', 'robo-bob');
    const place2 = under(s, 'p1', 'sg4-place-sub', 'LEFT');
    expect(() => play(s, 'p1', { card: card2, target: place2, payWith: [place2] })).toThrow(/already have a Robo/);
  });
});

describe('S.C.A.M', () => {
  it('forces a rival to roll again after any die roll he makes', () => {
    const s0 = scenario();
    const pers = under(s0, 'p2', 'sg4-sub-personality'); s0.cards[pers].tokens = 1;
    const pers1 = under(s0, 'p1', 'sg4-sub-personality'); s0.cards[pers1].tokens = 1;
    const attacker = under(s0, 'p1', 'sg4-strong', 'RIGHT'); s0.cards[attacker].tokens = 1;
    const target = under(s0, 'p2', 'sg4-plain', 'RIGHT');
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker, target });
    for (let i = 0; i < 10 && s.window?.kind === 'attack'; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
    expect(s.window?.kind).toBe('roll');
    const card = hand(s, 'p2', 's-c-a-m');
    s = play(s, 'p2', { card, payWith: [pers] });
    expect(s.attack!.plays.some((p) => p.effect.t === 'reroll')).toBe(true);
    expect(() => { const c2 = hand(s, 'p1', 's-c-a-m'); play(s, 'p1', { card: c2, payWith: [pers1] }); }).toThrow(/rival/);
  });
});

describe('Sacred Jests', () => {
  it('a rival must discard a random Plot he cannot legally play right now', () => {
    const s0 = scenario();
    const victim = hand(s0, 'p2', 'sg4-unplayable-plot');
    const card = hand(s0, 'p1', 'sacred-jests');
    let s = play(s0, 'p1', { card, target: ill(s0, 'p2') });
    s = passAll(s);
    expect(s.cards[victim].zone).toBe('discard');
  });
  it('offers to play it now when it is currently legal (a rival taking part in an attack), or discard it', () => {
    const s0 = scenario();
    const victim = hand(s0, 'p2', 'sg4-simple-plot');
    const attacker = under(s0, 'p1', 'sg4-plain'); s0.cards[attacker].tokens = 1;
    const target = under(s0, 'p2', 'sg4-plain', 'RIGHT');
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker, target });
    const card = hand(s, 'p1', 'sacred-jests');
    s = play(s, 'p1', { card, target: ill(s, 'p2') });
    expect(s.prompt?.kind).toBe('choose');
    s = act(s, 'p2', { type: 'choose', ids: ['play'] });
    expect(s.cards[ill(s, 'p2')].data?.played).toBe(true);
    expect(s.cards[victim].zone).not.toBe('hand');
  });
  it('a Goal card picked at random is exposed instead', () => {
    const s0 = scenario();
    const goal = hand(s0, 'p2', 'sg4-goal');
    const card = hand(s0, 'p1', 'sacred-jests');
    let s = play(s0, 'p1', { card, target: ill(s0, 'p2') });
    s = passAll(s);
    expect(s.cards[goal].exposed).toBe(true);
  });
});

describe('Schizm', () => {
  it('gives +10 and, even against an immune Group, sends the target and its puppets uncontrolled on a successful Attack to Control', () => {
    let s = sg(2, 9);
    for (const p of s.players) p.turnsTaken = 1;
    const pl = s.players[s.active].id;
    const rival = s.players.find((p) => p.id !== pl)!.id;
    const attacker = under(s, pl, 'sg4-strong'); s.cards[attacker].tokens = 1;
    const target = under(s, rival, 'sg4-immune');
    const pup = under(s, rival, 'sg4-plain', 'BOTTOM', target);
    expect(() => act(s, pl, { type: 'attack', attackType: 'control', attacker, target })).toThrow(/immune/);
    const card = hand(s, pl, 'schizm');
    s = act(s, pl, { type: 'attack', attackType: 'control', attacker, target, plots: [{ card, target: attacker }] });
    expect(s.attack!.attackBonus.some((b) => b.label === 'Schizm' && b.amount === 10)).toBe(true);
    s = resolveAttack(s, [1, 1]);
    expect(s.cards[target].zone).toBe('uncontrolled');
    expect(s.cards[pup].zone).toBe('uncontrolled');
  });
});

describe('Shordurpersav', () => {
  it('lets you ignore your own die roll and try again', () => {
    const s0 = scenario();
    const attacker = under(s0, 'p1', 'sg4-strong'); s0.cards[attacker].tokens = 1;
    const target = under(s0, 'p2', 'sg4-plain');
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker, target });
    for (let i = 0; i < 10 && s.window?.kind === 'attack'; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
    expect(s.window?.kind).toBe('roll');
    const card = hand(s, 'p1', 'shordurpersav');
    s = play(s, 'p1', { card, payWith: [ill(s, 'p1')] });
    expect(s.attack!.plays.some((p) => p.effect.t === 'reroll')).toBe(true);
  });
});

describe('Slackfusion', () => {
  it('lets Illuminati tokens change hands in a deal for the rest of the turn, but not before', () => {
    const s0 = scenario();
    expect(() => act(s0, 'p1', { type: 'offerDeal', to: 'p2', give: { illuminatiTokens: 1 }, get: {} })).toThrow(/Slackfusion/);
    const card = hand(s0, 'p1', 'slackfusion');
    let s = play(s0, 'p1', { card });
    s = passAll(s);
    const before2 = s.cards[ill(s, 'p2')].tokens;
    s = act(s, 'p1', { type: 'offerDeal', to: 'p2', give: { illuminatiTokens: 1 }, get: {} });
    const offerId = s.deals![0].id;
    s = act(s, 'p2', { type: 'respondDeal', deal: offerId, accept: true });
    expect(s.cards[ill(s, 'p2')].tokens).toBe(before2 + 1);
  });
});

describe('Smite Them All!', () => {
  it('standard play: needs at least two Group cards in hand, then each player sends cards to the bottom of his own Group deck', () => {
    const s0 = scenario();
    const card0 = hand(s0, 'p1', 'smite-them-all');
    expect(() => play(s0, 'p1', { card: card0 })).toThrow(/two Group cards/);
    const a = hand(s0, 'p1', 'sg4-plain');
    const b = hand(s0, 'p1', 'sg4-media');
    const riv = hand(s0, 'p2', 'sg4-plain');
    const card = hand(s0, 'p1', 'smite-them-all');
    let s = play(s0, 'p1', { card, targets: [a, b] });
    s = passAll(s);
    expect(s.prompt?.kind).toBe('choose');
    s = act(s, 'p2', { type: 'choose', ids: [riv] });
    expect(s.cards[riv].zone).toBe('groupDeck');
    expect(s.prompt?.kind).toBe('choose');
    s = act(s, 'p1', { type: 'choose', ids: [a, b] });
    expect(s.cards[a].zone).toBe('groupDeck');
    expect(s.cards[b].zone).toBe('groupDeck');
  });
});

describe('Stark Fist of Removal', () => {
  it('your Illuminati keeps one token, a rival\'s loses all of them; the turn ends', () => {
    const s0 = scenario();
    s0.cards[ill(s0, 'p1')].tokens = 3;
    s0.cards[ill(s0, 'p2')].tokens = 2;
    const card = hand(s0, 'p1', 'stark-fist-of-removal');
    let s = play(s0, 'p1', { card, target: ill(s0, 'p2') });
    s = passUntil(s, 'endOfTurn');
    expect(s.cards[ill(s, 'p1')].tokens).toBe(1);
    expect(s.cards[ill(s, 'p2')].tokens).toBe(0);
    expect(s.turnFlags.endedAtOnce).toBe(true);
  });
});

describe('Sultan of Slack', () => {
  it('blocks a win by Illuminati Special Goal for anyone below its holder\'s token count, until its holder\'s next turn', () => {
    const s = sg(2, 21);
    s.settings.basicGoal = 3; // low enough that the lead card plus a little Slack meets it
    const pl = s.players[s.active].id;
    const rival = s.players.find((p) => p.id !== pl)!.id;
    s.cards[ill(s, rival)].tokens = 3;
    expect(goalOptions(s, rival).find((o) => o.id === 'special')!.met).toBe(true);
    s.cards[ill(s, pl)].tokens = 5;
    const card = hand(s, pl, 'sultan-of-slack');
    let s2 = play(s, pl, { card });
    s2 = clearDiscardPrompts(s2);
    s2 = passAll(s2);
    expect(goalOptions(s2, rival).find((o) => o.id === 'special')!.met).toBe(false);
    const card2 = hand(s2, pl, 'sultan-of-slack');
    expect(() => play(s2, pl, { card: card2 })).toThrow(/once per game/);
  });
});

describe('Tape Runs Out...', () => {
  it('cancels a Plot just played; both are discarded', () => {
    const s0 = scenario();
    const played = hand(s0, 'p1', 'sg4-simple-plot');
    let s = play(s0, 'p1', { card: played });
    expect(s.window?.kind).toBe('plot');
    const canceler = hand(s, 'p2', 'tape-runs-out');
    s = play(s, 'p2', { card: canceler, target: played, payWith: [ill(s, 'p2')] });
    s = passAll(s);
    expect(s.cards[ill(s, 'p1')].data?.played).toBeUndefined();
    expect(s.cards[played].zone).toBe('discard');
    expect(s.cards[canceler].zone).toBe('discard');
  });
});

describe('The 13th Apostle', () => {
  it('gives an Action token to one Personality, or several with 5 Power or less in total', () => {
    const s0 = scenario();
    const g = under(s0, 'p1', 'sg4-personality'); s0.cards[g].tokens = 0;
    const card = hand(s0, 'p1', 'the-13th-apostle');
    let s = play(s0, 'p1', { card, targets: [g], payWith: [ill(s0, 'p1')] });
    s = passAll(s);
    expect(s.cards[g].tokens).toBe(1);
  });
  it('not for a Group that already has a token, and not for more than 5 Power in total', () => {
    const s0 = scenario();
    const a = under(s0, 'p1', 'sg4-personality2'); s0.cards[a].tokens = 0; // Power 3
    const b = under(s0, 'p1', 'sg4-personality2', 'RIGHT'); s0.cards[b].tokens = 0; // Power 3, total 6
    const card = hand(s0, 'p1', 'the-13th-apostle');
    expect(() => play(s0, 'p1', { card, targets: [a, b], payWith: [ill(s0, 'p1')] })).toThrow(/5 Power/);
    const card2 = hand(s0, 'p1', 'the-13th-apostle');
    expect(() => play(s0, 'p1', { card: card2, targets: [a], payWith: [ill(s0, 'p1')] })).not.toThrow();
    s0.cards[a].tokens = 1;
    const card3 = hand(s0, 'p1', 'the-13th-apostle');
    expect(() => play(s0, 'p1', { card: card3, targets: [a], payWith: [ill(s0, 'p1')] })).toThrow(/without an Action token/);
  });
});

describe('The Saint of Sales', () => {
  it('takes a Resource into play at once, with an Illuminati action', () => {
    const s0 = scenario();
    const res = hand(s0, 'p1', 'sg4-resource');
    const card = hand(s0, 'p1', 'the-saint-of-sales');
    let s = play(s0, 'p1', { card, target: res, payWith: [ill(s0, 'p1')] });
    s = passAll(s);
    expect(s.cards[res]).toMatchObject({ zone: 'resources', controller: 'p1' });
  });
});

describe('The World Ends Tomorrow and You May Die!', () => {
  it('an attack on a Group in hand by a Group sharing an alignment succeeds automatically; the turn ends', () => {
    const s0 = scenario();
    const attacker = under(s0, 'p1', 'sg4-straight'); s0.cards[attacker].tokens = 1;
    const target = hand(s0, 'p1', 'sg4-straight2');
    const card = hand(s0, 'p1', 'the-world-ends-tomorrow-and-you-may-die');
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker, target, plots: [{ card, target: attacker }] });
    s = resolveAttack(s);
    expect(s.cards[target]).toMatchObject({ zone: 'structure', controller: 'p1' });
    expect(s.phase).toBe('endOfTurn');
  });
  it('needs a shared alignment, or a Media Group', () => {
    const s0 = scenario();
    const attacker = under(s0, 'p1', 'sg4-plain'); s0.cards[attacker].tokens = 1;
    const target = hand(s0, 'p1', 'sg4-straight');
    const card = hand(s0, 'p1', 'the-world-ends-tomorrow-and-you-may-die');
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'control', attacker, target, plots: [{ card, target: attacker }] })).toThrow(/alignment|Media/);
  });
});

describe('They May Be Pink...', () => {
  it('lets the defender\'s Weird and SubGenius Groups help defend a Straight Group', () => {
    const s0 = scenario();
    const attacker = under(s0, 'p1', 'sg4-plain'); s0.cards[attacker].tokens = 1;
    const target = under(s0, 'p2', 'sg4-straight', 'TOP');
    const helper = under(s0, 'p2', 'sg4-weird-sub', 'RIGHT'); s0.cards[helper].tokens = 1;
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker, target });
    expect(canOppose(s, 'p2', helper).ok).toBe(false);
    const card = hand(s, 'p2', 'they-may-be-pink');
    s = play(s, 'p2', { card });
    expect(canOppose(s, 'p2', helper).ok).toBe(true);
  });
});

describe('Time Control', () => {
  it('lets the Illuminati make one direct attack without a token, but then locks its token for the rest of the turn', () => {
    const s0 = scenario();
    s0.cards[ill(s0, 'p1')].tokens = 1;
    const card = hand(s0, 'p1', 'time-control');
    let s = play(s0, 'p1', { card });
    s = passAll(s);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(1); // untouched
    const target = under(s, 'p2', 'sg4-plain');
    expect(() => act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: ill(s, 'p1'), target })).not.toThrow();
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: ill(s, 'p1'), target });
    expect(s.cards[ill(s, 'p1')].tokens).toBe(1); // the attack cost no token
    s = resolveAttack(s, [6, 6]);
    const res = hand(s, 'p1', 'sg4-resource');
    expect(() => act(s, 'p1', { type: 'playResource', card: res })).toThrow(/cannot be spent/);
  });
});

describe('X-Day', () => {
  it('discards all your Plots and draws as many, four at most, once per turn', () => {
    const s0 = scenario();
    for (let i = 0; i < 5; i++) hand(s0, 'p1', 'sg4-simple-plot');
    const card = hand(s0, 'p1', 'x-day');
    const p = s0.players.find((x) => x.id === 'p1')!;
    const plotDeckBefore = p.plotDeck.length;
    let s = play(s0, 'p1', { card });
    s = passAll(s);
    const p1 = s.players.find((x) => x.id === 'p1')!;
    expect(p1.plotDeck.length).toBeLessThanOrEqual(plotDeckBefore); // some drawn
    const card2 = hand(s, 'p1', 'x-day');
    expect(() => play(s, 'p1', { card: card2 })).toThrow(/once per turn/);
  });
});

describe('Yacatisma', () => {
  it('discards two random hidden Plots of a rival', () => {
    const s0 = scenario();
    const sub = under(s0, 'p1', 'sg4-sub-personality'); s0.cards[sub].tokens = 1;
    const a = hand(s0, 'p2', 'sg4-simple-plot');
    const b = hand(s0, 'p2', 'sg4-simple-plot');
    const card = hand(s0, 'p1', 'yacatisma');
    let s = play(s0, 'p1', { card, target: ill(s0, 'p2'), payWith: [sub] });
    s = passAll(s);
    const gone = [a, b].filter((c) => s.cards[c].zone === 'discard');
    expect(gone.length).toBe(2);
  });
});

describe("You'd Pay to Know What You Really Think!", () => {
  it('replaces a puppet-free Group with the top Group deck card, keeping its tokens', () => {
    const s0 = scenario();
    const g = under(s0, 'p1', 'sg4-plain');
    s0.cards[g].tokens = 1;
    const p = s0.players.find((x) => x.id === 'p1')!;
    p.groupDeck.unshift('sg4-media-copy');
    s0.cards['sg4-media-copy'] = { iid: 'sg4-media-copy', cardId: 'sg4-media', owner: 'p1', zone: 'groupDeck', tokens: 0, mods: [] };
    const card = hand(s0, 'p1', "you-d-pay-to-know-what-you-really-think");
    let s = play(s0, 'p1', { card, target: g });
    s = passAll(s);
    expect(s.cards[g].zone).toBe('discard'); // standard play: no uncontrolled area, so it is discarded
    expect(s.cards['sg4-media-copy']).toMatchObject({ zone: 'structure', controller: 'p1', tokens: 1 });
  });
  it('cannot be used on a Group that has puppets', () => {
    const s0 = scenario();
    const g = under(s0, 'p1', 'sg4-plain');
    under(s0, 'p1', 'sg4-plain', 'BOTTOM', g);
    const card = hand(s0, 'p1', "you-d-pay-to-know-what-you-really-think");
    expect(() => play(s0, 'p1', { card, target: g })).toThrow(/no puppets/);
  });
});
