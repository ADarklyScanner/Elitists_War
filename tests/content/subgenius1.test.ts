// Scripted parts of the SubGenius Groups in src/engine/content/subgenius1.ts (batch "subgenius1").
import { describe, expect, it } from 'vitest';
import {
  advance, alignments, applyAction, attackStrength, attributes, cardImplemented, CARDS, discardCard, globalPower, goalNeeded, openArrows,
  player as playerOf, power, resistance, waitingFor, type Action, type AttackType, type GameState,
} from '../../src/engine';
import { rollDie } from '../../src/engine/rng';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
function put(s: GameState, pl: string, cardId: string, under?: string): string {
  const m = under ?? ill(s, pl);
  const side = openArrows(s, m)[0];
  if (!side) throw new Error(`no open arrow under ${m}`);
  return give(s, pl, cardId, { under: m, side });
}
const attack = (s: GameState, attacker: string, target: string, attackType: AttackType) =>
  act(s, 'p1', { type: 'attack', attackType, attacker, target });
const use = (s: GameState, pl: string, card: string, ability: string, params = {}) =>
  act(s, pl, { type: 'useAbility', card, ability, params });
const hand = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.hand;
function line(s: GameState, side: 'Attack' | 'Defense', name: string): number {
  return attackStrength(s, s.attack!).lines
    .filter((l) => l.startsWith(side) && l.endsWith(`: ${name}`))
    .reduce((n, l) => n + Number(l.match(/([+-]\d+)/)![1]), 0);
}
function resolve(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = applyAction(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** Guarantee the attack in progress succeeds (proximity and alignment maths are not the point of these tests). */
const boost = (s: GameState, pl: string, n = 30) => { s.attack!.attackBonus.push({ player: pl, amount: n, label: 'test' }); return s; };
function settle(s: GameState): GameState {
  for (let i = 0; i < 20 && s.window; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** End the active player's turn and play on until the other player reaches his own main phase. */
function nextTurn(s: GameState): GameState {
  const from = s.players[s.active].id;
  s = act(s, from, { type: 'endTurn' });
  for (let i = 0; i < 60; i++) {
    if (s.players[s.active].id !== from && s.phase === 'main' && !s.window && !s.prompt) return s;
    if (s.prompt?.kind === 'takeover') s = act(s, s.prompt.player, { type: 'skipTakeover' });
    else if (s.window) s = act(s, waitingFor(s)[0], { type: 'pass' });
    else if (s.phase === 'main') s = act(s, s.players[s.active].id, { type: 'endTurn' });
    else throw new Error(`stuck in ${s.phase} ${s.prompt?.kind}`);
  }
  throw new Error('never reached the other player\'s turn');
}
/** An `rng` seed for which the very next `rollDie` gives a number matching `want`. */
function seedForRoll(want: (n: number) => boolean): number {
  for (let seed = 1; seed < 2000; seed++) {
    if (want(rollDie({ rng: seed } as GameState))) return seed;
  }
  throw new Error('no seed found');
}

const BATCH = [
  'bobbies', 'advanced-supersonic-aluminum-nazi-hell-creatures-from-beneath-the-hollow-earth', 'church-of-middle-america',
  'citizens-for-normalcy', 'corrective-phrenologists', 'divine-mail-order', 'drs-for-bob', 'false-prophets', 'glorps',
  'good-sex-for-mutants-dating-league', 'league-for-obvious-decency', 'local-clenches', 'mwowm', 'phlegm-elementals', 'pinks',
  'rogue-subgenii', 's-l-a-k', 's-p-u-t-u-m', 'secret-fistemple', 'speakers-in-tongues', 'subgenius-fistemples', 'the-hour-of-slack',
  'xists', 'yetis',
];

describe('subgenius1 batch', () => {
  it('every card in the batch is implemented', () => {
    for (const id of BATCH) expect(cardImplemented(id)).toBe(true);
  });
});

describe('"Bobbies"', () => {
  it('never counts toward the Basic Goal, but raises its controller\'s target by one', () => {
    const s0 = scenario();
    const needBefore = goalNeeded(s0, 'p1');
    put(s0, 'p1', 'bobbies');
    expect(goalNeeded(s0, 'p1')).toBe(needBefore + 1);
  });
  it('a successful Attack to Destroy forces the attacker to discard it or give it to a rival', () => {
    const s0 = scenario();
    const b = put(s0, 'p2', 'bobbies');
    const mafia = put(s0, 'p1', 'the-mafia');
    let s = attack(s0, mafia, b, 'destroy');
    s = boost(s, 'p1');
    s = resolve(s, [1, 1]);
    expect(s.prompt?.kind).toBe('choose');
    s = act(s, 'p1', { type: 'choose', ids: ['discard'] });
    expect(s.cards[b].zone).toBe('discard');
  });
  it('a successful Attack to Control gives it to a rival instead of the attacker keeping it', () => {
    const s0 = scenario();
    const b = put(s0, 'p2', 'bobbies');
    put(s0, 'p2', 'girlie-magazines'); // so p2 still has an open arrow to receive "Bobbies" back
    const mafia = put(s0, 'p1', 'the-mafia');
    let s = attack(s0, mafia, b, 'control');
    s = boost(s, 'p1');
    s = resolve(s, [1, 1]);
    expect(s.prompt?.kind).toBe('choose');
    const give1 = s.prompt!.choice!.options.find((o) => o.id.startsWith('give|'))!.id;
    s = act(s, 'p1', { type: 'choose', ids: [give1] });
    expect(s.cards[b].controller).not.toBe('p1');
  });
});

describe('Advanced Supersonic Aluminum Nazi Hell Creatures from Beneath the Hollow Earth', () => {
  it('draws a Plot for a successful Attack to Destroy a rival\'s Group', () => {
    const s0 = scenario();
    const c = put(s0, 'p1', 'advanced-supersonic-aluminum-nazi-hell-creatures-from-beneath-the-hollow-earth');
    const npc = put(s0, 'p2', 'nuclear-power-companies');
    let s = attack(s0, c, npc, 'destroy');
    const before = hand(s, 'p1').length;
    s = boost(s, 'p1');
    s = resolve(s, [1, 1]);
    expect(hand(s, 'p1').length).toBe(before + 1);
  });
  it('no Plot for a failed attack', () => {
    const s0 = scenario();
    const c = put(s0, 'p1', 'advanced-supersonic-aluminum-nazi-hell-creatures-from-beneath-the-hollow-earth');
    const npc = put(s0, 'p2', 'nuclear-power-companies');
    let s = attack(s0, c, npc, 'destroy');
    const before = hand(s, 'p1').length;
    s = resolve(s, [6, 6]);
    expect(hand(s, 'p1').length).toBe(before);
  });
});

describe('Church of Middle America', () => {
  it('gives the SubGenius Group that controls it +2 Power (and +2 Global Power if it has any)', () => {
    const s0 = scenario();
    const rs = put(s0, 'p2', 'rogue-subgenii'); // SubGenius, prints Global Power
    put(s0, 'p2', 'church-of-middle-america', rs);
    expect(power(s0, rs)).toBe((CARDS['rogue-subgenii'].power ?? 0) + 2);
    expect(globalPower(s0, rs)).toBe((CARDS['rogue-subgenii'].globalPower ?? 0) + 2);
  });
  it('no Global Power bonus for a SubGenius master with none printed', () => {
    const s0 = scenario();
    const dmo = put(s0, 'p2', 'divine-mail-order'); // SubGenius, no Global Power printed
    put(s0, 'p2', 'church-of-middle-america', dmo);
    expect(power(s0, dmo)).toBe((CARDS['divine-mail-order'].power ?? 0) + 2);
    expect(globalPower(s0, dmo)).toBe(0);
  });
  it('no bonus for a non-SubGenius master', () => {
    const s0 = scenario();
    const npc = put(s0, 'p1', 'nuclear-power-companies');
    put(s0, 'p1', 'church-of-middle-america', npc);
    expect(power(s0, npc)).toBe(CARDS['nuclear-power-companies'].power ?? 0);
  });
});

describe('Citizens for Normalcy', () => {
  it('is immune to a direct Attack to Control by a SubGenius Group', () => {
    const s0 = scenario();
    const cfn = put(s0, 'p2', 'citizens-for-normalcy');
    const sub = put(s0, 'p1', 'divine-mail-order');
    expect(() => attack(s0, sub, cfn, 'control')).toThrow(/immune/);
  });
  it('can still be attacked to control by an ordinary Group', () => {
    const s0 = scenario();
    const cfn = put(s0, 'p2', 'citizens-for-normalcy');
    const mafia = put(s0, 'p1', 'the-mafia');
    expect(() => attack(s0, mafia, cfn, 'control')).not.toThrow();
  });
  it('spends its token and an Illuminati token to cancel a Plot waiting to resolve', () => {
    const s0 = scenario();
    const cfn = put(s0, 'p2', 'citizens-for-normalcy');
    const payer = put(s0, 'p1', 'the-mafia');
    give(s0, 'p2', 'reload', { hand: true }); // a hidden Plot for George the Janitor to threaten
    const janitor = give(s0, 'p1', 'george-the-janitor', { hand: true });
    let s = act(s0, 'p1', { type: 'playPlot', play: { card: janitor, target: ill(s0, 'p2'), payWith: [payer] } });
    expect(s.window?.kind).toBe('plot');
    s = use(s, 'p2', cfn, 'cancel-plot');
    s = settle(s);
    expect(s.cards[janitor].zone).toBe('discard');
    expect(s.cards[ill(s, 'p2')].tokens).toBe(0);
  });
});

describe('Corrective Phrenologists', () => {
  it('gets a fresh Action token once the dice are rolled, in an attack against a rival\'s Violent Group', () => {
    const s0 = scenario();
    const cp = put(s0, 'p1', 'corrective-phrenologists');
    const violent = put(s0, 'p2', 'kkk');
    let s = attack(s0, cp, violent, 'destroy');
    expect(s.cards[cp].tokens).toBe(0); // spent to attack
    s = boost(s, 'p1'); // make the dice actually get rolled; the outcome does not matter
    s = resolve(s, [6, 6]);
    expect(s.cards[cp].tokens).toBe(1);
  });
  it('no fresh token against a non-Violent Group', () => {
    const s0 = scenario();
    const cp = put(s0, 'p1', 'corrective-phrenologists');
    const npc = put(s0, 'p2', 'nuclear-power-companies');
    let s = attack(s0, cp, npc, 'destroy');
    s = boost(s, 'p1');
    s = resolve(s, [6, 6]);
    expect(s.cards[cp].tokens).toBe(0);
  });
});

describe('Divine Mail Order', () => {
  it('its action draws one Plot', () => {
    const s0 = scenario();
    const dmo = put(s0, 'p1', 'divine-mail-order');
    const s = use(s0, 'p1', dmo, 'mail-order', { mode: 'one' });
    expect(hand(s, 'p1').length).toBe(1);
  });
  it('its action plus an Illuminati action draws three', () => {
    const s0 = scenario();
    const dmo = put(s0, 'p1', 'divine-mail-order');
    const s = use(s0, 'p1', dmo, 'mail-order', { mode: 'three' });
    expect(hand(s, 'p1').length).toBe(3);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
  });
  it('cannot draw three without an Illuminati token', () => {
    const s0 = scenario();
    const dmo = put(s0, 'p1', 'divine-mail-order');
    s0.cards[ill(s0, 'p1')].tokens = 0;
    expect(() => use(s0, 'p1', dmo, 'mail-order', { mode: 'three' })).toThrow();
  });
});

describe('Drs. for "Bob"', () => {
  it('adds its Power to another SubGenius Group\'s defense for free', () => {
    const s0 = scenario();
    const drs = put(s0, 'p2', 'drs-for-bob');
    const sub = put(s0, 'p2', 'divine-mail-order');
    const mafia = put(s0, 'p1', 'the-mafia');
    let s = attack(s0, mafia, sub, 'control');
    s = use(s, 'p2', drs, 'defend-subgenius');
    expect(line(s, 'Defense', 'Drs. for "Bob"')).toBe(power(s, drs));
    expect(s.cards[drs].tokens).toBe(1); // free: keeps its own token
  });
  it('cannot help a non-SubGenius Group', () => {
    const s0 = scenario();
    const drs = put(s0, 'p2', 'drs-for-bob');
    const npc = put(s0, 'p2', 'nuclear-power-companies');
    const mafia = put(s0, 'p1', 'the-mafia');
    const s = attack(s0, mafia, npc, 'control');
    expect(() => use(s, 'p2', drs, 'defend-subgenius')).toThrow();
  });
});

describe('False Prophets', () => {
  it('+4 to control or destroy a rival\'s Church Group', () => {
    const s0 = scenario();
    const fp = put(s0, 'p1', 'false-prophets');
    void fp;
    const church = put(s0, 'p2', 'church-of-elvis');
    const mafia = put(s0, 'p1', 'the-mafia');
    expect(line(attack(s0, mafia, church, 'control'), 'Attack', 'False Prophets')).toBe(4);
  });
  it('nothing against a non-Church Group', () => {
    const s0 = scenario();
    put(s0, 'p1', 'false-prophets');
    const npc = put(s0, 'p2', 'nuclear-power-companies');
    const mafia = put(s0, 'p1', 'the-mafia');
    expect(line(attack(s0, mafia, npc, 'control'), 'Attack', 'False Prophets')).toBe(0);
  });
});

describe('Glorps', () => {
  it('doubles its Power destroying a SubGenius Group', () => {
    const s0 = scenario();
    const g = put(s0, 'p1', 'glorps');
    const sub = put(s0, 'p2', 'divine-mail-order');
    expect(line(attack(s0, g, sub, 'destroy'), 'Attack', 'Glorps')).toBe(power(s0, g));
  });
  it('no bonus attacking a non-SubGenius Group', () => {
    const s0 = scenario();
    const g = put(s0, 'p1', 'glorps');
    const npc = put(s0, 'p2', 'nuclear-power-companies');
    expect(line(attack(s0, g, npc, 'destroy'), 'Attack', 'Glorps')).toBe(0);
  });
});

describe('Good Sex for Mutants Dating League', () => {
  it('-2 on a rival\'s attempt to control a Weird puppet it directly controls', () => {
    const s0 = scenario();
    const gsfmdl = put(s0, 'p2', 'good-sex-for-mutants-dating-league');
    const elvis = put(s0, 'p2', 'church-of-elvis', gsfmdl); // a Weird puppet
    const mafia = put(s0, 'p1', 'the-mafia');
    expect(line(attack(s0, mafia, elvis, 'control'), 'Attack', 'Good Sex for Mutants Dating League')).toBe(-2);
  });
  it('-2 on a rival\'s attempt to control any Weird Group, not only its own puppets', () => {
    const s0 = scenario();
    put(s0, 'p2', 'good-sex-for-mutants-dating-league');
    const elvis = put(s0, 'p2', 'church-of-elvis');
    const mafia = put(s0, 'p1', 'the-mafia');
    expect(line(attack(s0, mafia, elvis, 'control'), 'Attack', 'Good Sex for Mutants Dating League')).toBe(-2);
  });
  it('no penalty on its own controller\'s attempts, or on a Group that is not Weird', () => {
    const s0 = scenario();
    put(s0, 'p1', 'good-sex-for-mutants-dating-league');
    const elvis = put(s0, 'p2', 'church-of-elvis');
    const sharks = put(s0, 'p2', 'loan-sharks');
    const mafia = put(s0, 'p1', 'the-mafia');
    expect(line(attack(s0, mafia, elvis, 'control'), 'Attack', 'Good Sex for Mutants Dating League')).toBe(0);
    s0.players[1].hand = [];
    expect(line(attack(s0, mafia, sharks, 'control'), 'Attack', 'Good Sex for Mutants Dating League')).toBe(0);
  });
});

describe('League for Obvious Decency', () => {
  it('returns an exposed Plot to the top of its owner\'s Plot deck', () => {
    const s0 = scenario();
    const lfod = put(s0, 'p1', 'league-for-obvious-decency');
    const plotCard = give(s0, 'p2', 'annual-convention', { hand: true });
    s0.cards[plotCard].exposed = true;
    let s = use(s0, 'p1', lfod, 'bury-exposed');
    expect(s.prompt?.kind).toBe('choose');
    s = act(s, 'p1', { type: 'choose', ids: [plotCard] });
    expect(playerOf(s, 'p2').plotDeck[0]).toBe(plotCard);
    expect(playerOf(s, 'p2').hand.includes(plotCard)).toBe(false);
    expect(s.cards[plotCard].exposed).toBe(false);
  });
  it('cannot be used with no exposed Plots anywhere', () => {
    const s0 = scenario();
    const lfod = put(s0, 'p1', 'league-for-obvious-decency');
    expect(() => use(s0, 'p1', lfod, 'bury-exposed')).toThrow();
  });
});

describe('Local Clenches', () => {
  it('gives its SubGenius master an extra Action token at the start of the turn', () => {
    const s0 = scenario();
    const dmo = put(s0, 'p2', 'divine-mail-order');
    put(s0, 'p2', 'local-clenches', dmo);
    s0.cards[dmo].tokens = 0;
    const s = nextTurn(s0); // p2's turn begins
    expect(s.cards[dmo].tokens).toBe(2); // its own token plus the extra one
  });
  it('no extra token once its master stops being SubGenius', () => {
    const s0 = scenario();
    const npc = put(s0, 'p2', 'nuclear-power-companies');
    put(s0, 'p2', 'local-clenches', npc);
    s0.cards[npc].tokens = 0;
    const s = nextTurn(s0);
    expect(s.cards[npc].tokens).toBe(1);
  });
});

describe('MWOWM', () => {
  it('takes a just-discarded Plot on a low roll', () => {
    const s0 = scenario();
    const m = put(s0, 'p1', 'mwowm');
    const plotCard = give(s0, 'p2', 'annual-convention', { hand: true });
    discardCard(s0, plotCard);
    advance(s0);
    expect(s0.window?.kind).toBe('event');
    s0.rng = seedForRoll((n) => n <= 3);
    const s = use(s0, 'p1', m, 'snatch');
    expect(hand(s, 'p1').includes(plotCard)).toBe(true);
  });
  it('misses on a high roll', () => {
    const s0 = scenario();
    const m = put(s0, 'p1', 'mwowm');
    const plotCard = give(s0, 'p2', 'annual-convention', { hand: true });
    discardCard(s0, plotCard);
    advance(s0);
    s0.rng = seedForRoll((n) => n > 3);
    const s = use(s0, 'p1', m, 'snatch');
    expect(hand(s, 'p1').includes(plotCard)).toBe(false);
    expect(s.cards[plotCard].zone).toBe('discard');
  });
});

describe('Phlegm Elementals', () => {
  it('befouls the target once the dice are rolled, so it skips its next Action token', () => {
    const s0 = scenario();
    const pe = put(s0, 'p1', 'phlegm-elementals');
    const npc = put(s0, 'p2', 'nuclear-power-companies');
    let s = attack(s0, pe, npc, 'destroy');
    s = boost(s, 'p1');
    s = resolve(s, [6, 6]); // the marker is set regardless of outcome
    expect(s.cards[npc].data?.skipTokenGain).toBe(true);
    s.cards[npc].tokens = 0;
    s = nextTurn(s); // p2's own turn: the refresh is skipped once
    expect(s.cards[npc].tokens).toBe(0);
    s = nextTurn(s); // p1's turn
    s = nextTurn(s); // p2's turn again: refreshes normally now
    expect(s.cards[npc].tokens).toBe(1);
  });
});

describe('Pinks', () => {
  it('takes a token from another Straight Group when it has none', () => {
    const s0 = scenario();
    const pinks = put(s0, 'p1', 'pinks');
    const straight = put(s0, 'p1', 'dentists');
    s0.cards[pinks].tokens = 0;
    const s = use(s0, 'p1', pinks, 'mooch', { target: straight });
    expect(s.cards[pinks].tokens).toBe(1);
    expect(s.cards[straight].tokens).toBe(0);
  });
  it('cannot take a token while it already has one', () => {
    const s0 = scenario();
    const pinks = put(s0, 'p1', 'pinks');
    const straight = put(s0, 'p1', 'dentists');
    expect(() => use(s0, 'p1', pinks, 'mooch', { target: straight })).toThrow();
  });
  it('cannot take a token from a non-Straight Group', () => {
    const s0 = scenario();
    const pinks = put(s0, 'p1', 'pinks');
    const violent = put(s0, 'p1', 'kkk');
    s0.cards[pinks].tokens = 0;
    expect(() => use(s0, 'p1', pinks, 'mooch', { target: violent })).toThrow();
  });
});

describe('Rogue SubGenii', () => {
  it('discards a Plot to get a token when it has none, once per turn', () => {
    const s0 = scenario();
    const rs = put(s0, 'p1', 'rogue-subgenii');
    s0.cards[rs].tokens = 0;
    const plotCard = give(s0, 'p1', 'annual-convention', { hand: true });
    const s = use(s0, 'p1', rs, 'rogue-token', { target: plotCard });
    expect(s.cards[rs].tokens).toBe(1);
    expect(hand(s, 'p1').includes(plotCard)).toBe(false);
  });
  it('cannot be used twice in the same turn', () => {
    const s0 = scenario();
    const rs = put(s0, 'p1', 'rogue-subgenii');
    s0.cards[rs].tokens = 0;
    const p1 = give(s0, 'p1', 'annual-convention', { hand: true });
    const p2 = give(s0, 'p1', 'annual-convention', { hand: true });
    let s = use(s0, 'p1', rs, 'rogue-token', { target: p1 });
    s.cards[rs].tokens = 0;
    expect(() => use(s, 'p1', rs, 'rogue-token', { target: p2 })).toThrow(/turn/);
  });
});

describe('S.L.A.K.', () => {
  it('gets a token at the start of a rival\'s turn if it has none', () => {
    const s0 = scenario();
    const slak = put(s0, 'p2', 's-l-a-k');
    let s = nextTurn(s0); // p2's own turn: its normal refresh gives it a token
    s.cards[slak].tokens = 0; // spent, so it now has none
    s = nextTurn(s); // p1's turn starts: a rival's turn, for S.L.A.K.'s controller
    expect(s.cards[slak].tokens).toBe(1);
  });
});

describe('S.P.U.T.U.M.', () => {
  it('triples its Power against a Personality', () => {
    const s0 = scenario();
    const sp = put(s0, 'p1', 's-p-u-t-u-m');
    const person = put(s0, 'p2', 'george-bush');
    expect(line(attack(s0, sp, person, 'destroy'), 'Attack', 'S.P.U.T.U.M.')).toBe(power(s0, sp) * 2);
  });
  it('no bonus against a Group', () => {
    const s0 = scenario();
    const sp = put(s0, 'p1', 's-p-u-t-u-m');
    const npc = put(s0, 'p2', 'nuclear-power-companies');
    expect(line(attack(s0, sp, npc, 'destroy'), 'Attack', 'S.P.U.T.U.M.')).toBe(0);
  });
});

describe('Secret FisTemple', () => {
  it('cannot attack to control a non-Personality', () => {
    const s0 = scenario();
    const sf = put(s0, 'p1', 'secret-fistemple');
    const npc = put(s0, 'p2', 'nuclear-power-companies');
    expect(() => attack(s0, sf, npc, 'control')).toThrow(/only control Personalities/);
  });
  it('may attack to control a Personality', () => {
    const s0 = scenario();
    const sf = put(s0, 'p1', 'secret-fistemple');
    const person = put(s0, 'p2', 'george-bush');
    expect(() => attack(s0, sf, person, 'control')).not.toThrow();
  });
  it('grants SubGenius to a Personality it controls', () => {
    const s0 = scenario();
    const sf = put(s0, 'p1', 'secret-fistemple');
    const person = put(s0, 'p1', 'george-bush', sf);
    expect(attributes(s0, person).includes('SubGenius')).toBe(true);
  });
  it('always has its master\'s alignments', () => {
    const s0 = scenario();
    const npc = put(s0, 'p1', 'nuclear-power-companies');
    const sf = put(s0, 'p1', 'secret-fistemple', npc);
    expect(alignments(s0, sf)).toEqual(alignments(s0, npc));
  });
});

describe('Speakers in Tongues', () => {
  it('+3 to control a Church Group', () => {
    const s0 = scenario();
    const sit = put(s0, 'p1', 'speakers-in-tongues');
    void sit;
    const church = put(s0, 'p2', 'church-of-elvis');
    const mafia = put(s0, 'p1', 'the-mafia');
    expect(line(attack(s0, mafia, church, 'control'), 'Attack', 'Speakers in Tongues')).toBe(3);
  });
});

describe('SubGenius FisTemples', () => {
  it('+5 Resistance to a Group it directly controls', () => {
    const s0 = scenario();
    const sf = put(s0, 'p1', 'subgenius-fistemples');
    const npc = put(s0, 'p1', 'nuclear-power-companies', sf);
    expect(resistance(s0, npc)).toBe((CARDS['nuclear-power-companies'].resistance ?? 0) + 5);
  });
  it('no bonus to a Group it does not control', () => {
    const s0 = scenario();
    put(s0, 'p1', 'subgenius-fistemples');
    const npc = put(s0, 'p1', 'nuclear-power-companies');
    expect(resistance(s0, npc)).toBe(CARDS['nuclear-power-companies'].resistance ?? 0);
  });
});

describe('The Hour of Slack', () => {
  it('draws a Plot when a rival declares an attack on a Group in your Power Structure', () => {
    const s0 = scenario();
    put(s0, 'p1', 'the-hour-of-slack');
    const npc = put(s0, 'p1', 'nuclear-power-companies');
    const mafia = put(s0, 'p2', 'the-mafia');
    let s = nextTurn(s0); // p2's turn
    const before = hand(s, 'p1').length;
    s = act(s, 'p2', { type: 'attack', attackType: 'destroy', attacker: mafia, target: npc });
    expect(hand(s, 'p1').length).toBe(before + 1);
  });
});

describe('Xists', () => {
  it('goes back to hand (not the destroyed pile) when destroyed, and never counts as destroyed', () => {
    const s0 = scenario();
    const x = put(s0, 'p2', 'xists');
    const mafia = put(s0, 'p1', 'the-mafia');
    let s = attack(s0, mafia, x, 'destroy');
    s = boost(s, 'p1');
    s = resolve(s, [1, 1]);
    expect(s.cards[x].zone).toBe('hand');
    expect(playerOf(s, 'p1').destroyedCredit.includes(x)).toBe(false);
  });
});

describe('Yetis', () => {
  it('may be captured onto a side of the attacker with no printed outgoing arrow', () => {
    const s0 = scenario();
    const attacker = put(s0, 'p1', 'joggers'); // arrowsOut: [] (no printed outgoing arrow at all)
    expect(CARDS['joggers'].arrowsOut ?? []).toEqual([]);
    const yeti = give(s0, 'p1', 'yetis', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker, target: yeti, side: 'LEFT' });
    s = boost(s, 'p1');
    s = resolve(s, [1, 1]);
    expect(s.cards[yeti].zone).toBe('structure');
    expect(s.cards[yeti].master).toBe(attacker);
  });
  it('an ordinary Group cannot be placed on a side with no outgoing arrow', () => {
    const s0 = scenario();
    const attacker = put(s0, 'p1', 'joggers');
    const npc = give(s0, 'p1', 'nuclear-power-companies', { hand: true });
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'control', attacker, target: npc, side: 'LEFT' })).toThrow();
  });
});
