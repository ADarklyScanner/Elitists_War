// Scripted parts of the Group cards in src/engine/content/groups2.ts.
import { describe, expect, it } from 'vitest';
import {
  alignments, applyAction, attackStrength, canAid, canOppose, finalRoll, globalPower, HOOKS, isPrivileged, openArrows, power,
  resistance, waitingFor, CARDS, type Action, type AttackCtx, type GameState,
} from '../../src/engine';
import { rollDie } from '../../src/engine/rng';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const hand = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.hand;

/** Put a card into `pl`'s Power Structure under `master` (default: the Illuminati) on its first open arrow. */
function put(s: GameState, pl: string, cardId: string, master?: string): string {
  const m = master ?? ill(s, pl);
  const side = openArrows(s, m)[0];
  if (!side) throw new Error(`no open arrow on ${m}`);
  return give(s, pl, cardId, { under: m, side });
}
const boost = (s: GameState, iid: string, n = 40) => s.cards[iid].mods.push({ source: 'test', kind: 'power', value: n, until: 'permanent' });

function ctxOf(s: GameState, o: Partial<AttackCtx> & { target: string }): AttackCtx {
  return {
    id: 99, type: 'control', instant: false, attackerPlayer: 'p1', fromHand: s.cards[o.target].zone === 'hand', privileged: false,
    aid: [], oppose: [], attackBonus: [], defenseBonus: [], plays: [], targetPlayer: s.cards[o.target].controller, ...o,
  };
}
/** Sum of the strength lines on one side credited exactly to `label`. */
function line(s: GameState, ctx: AttackCtx, side: 'Attack' | 'Defense', label: string): number {
  return attackStrength(s, ctx).lines.filter((l) => l.startsWith(side) && l.endsWith(`: ${label}`))
    .reduce((n, l) => n + Number(l.match(/[+-]?\d+/)![0]), 0);
}

/** Pass until the attack is over, forcing the dice if given. */
function resolve(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 30 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** Pass the attack window so the dice are rolled; stops in the roll window. */
function toRoll(s: GameState): GameState {
  for (let i = 0; i < 10 && s.window?.kind === 'attack'; i++) s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** Play on until p1's next main phase. */
function nextP1Turn(s: GameState): GameState {
  s = act(s, 'p1', { type: 'endTurn' });
  for (let i = 0; i < 60; i++) {
    if (s.players[s.active].id === 'p1' && s.phase === 'main' && !s.window && !s.prompt) return s;
    if (s.prompt?.kind === 'takeover') s = act(s, s.prompt.player, { type: 'skipTakeover' });
    else if (s.window) s = act(s, waitingFor(s)[0], { type: 'pass' });
    else if (s.phase === 'main') s = act(s, s.players[s.active].id, { type: 'endTurn' });
    else throw new Error(`stuck in ${s.phase} ${s.prompt?.kind}`);
  }
  throw new Error('p1 never got a turn');
}
const use = (s: GameState, pl: string, card: string, ability: string, params: Record<string, unknown> = {}) =>
  act(s, pl, { type: 'useAbility', card, ability, params });

/** Start an Instant Disaster attack with `plot` against `place`. */
function disaster(s: GameState, plot: string, place: string): GameState {
  const card = give(s, 'p1', plot, { hand: true });
  return act(s, 'p1', { type: 'playPlot', play: { card, target: place } });
}

describe('Voudonistas', () => {
  it('+4 on an Assassination it joins', () => {
    const s = scenario();
    const v = put(s, 'p1', 'voudonistas');
    const per = put(s, 'p2', 'hillary-clinton');
    const base = { type: 'destroy' as const, instant: true, assassination: true, instantPower: 8, target: per };
    expect(line(s, ctxOf(s, { ...base, aid: [{ player: 'p1', iid: v, amount: 0, label: 'V' }] }), 'Attack', 'Voudonistas')).toBe(4);
    expect(line(s, ctxOf(s, base), 'Attack', 'Voudonistas')).toBe(0);
  });
});

describe('Wall Street', () => {
  it('may treat Corporate as Government when it leads an attack', () => {
    const s = scenario();
    const ws = put(s, 'p1', 'wall-street');
    const fed = give(s, 'p1', 'federal-reserve', { hand: true }); // Government
    expect(line(s, ctxOf(s, { attacker: ws, target: fed }), 'Attack', 'Wall Street')).toBe(8); // -4 becomes +4
    const mafia = put(s, 'p1', 'the-mafia');
    expect(line(s, ctxOf(s, { attacker: mafia, target: fed }), 'Attack', 'Wall Street')).toBe(0);
  });
  it('may aid an attack on a Government Group with its full Power', () => {
    const s0 = scenario();
    const ws = put(s0, 'p1', 'wall-street');
    const mafia = put(s0, 'p1', 'the-mafia');
    const fed = put(s0, 'p2', 'federal-reserve');
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: mafia, target: fed });
    expect(canAid(s, 'p1', ws)).toMatchObject({ ok: true, global: false });
  });
  it('its puppets get +10 Resistance, other Groups do not', () => {
    const s = scenario();
    const ws = put(s, 'p1', 'wall-street');
    const pup = put(s, 'p1', 'loan-sharks', ws);
    const other = put(s, 'p1', 'dentists');
    expect(resistance(s, pup)).toBe(CARDS['loan-sharks'].resistance! + 10);
    expect(resistance(s, other)).toBe(CARDS['dentists'].resistance!);
  });
});

describe('Wargamers', () => {
  it('puts an exposed Plot on the bottom of its owner\'s deck', () => {
    const s0 = scenario();
    const w = put(s0, 'p1', 'wargamers');
    const plot = give(s0, 'p2', 'reload', { hand: true });
    s0.cards[plot].exposed = true;
    const s = use(s0, 'p1', w, 'bury', { target: plot });
    expect(hand(s, 'p2')).not.toContain(plot);
    expect(s.players[1].plotDeck.at(-1)).toBe(plot);
    expect(s.cards[w].tokens).toBe(0);
  });
  it('cannot touch a Plot that is not exposed', () => {
    const s0 = scenario();
    const w = put(s0, 'p1', 'wargamers');
    const plot = give(s0, 'p2', 'reload', { hand: true });
    expect(() => use(s0, 'p1', w, 'bury', { target: plot })).toThrow(/exposed/);
  });
});

describe('W.I.T.C.H.', () => {
  function setup(target: string) {
    const s0 = scenario();
    const att = put(s0, 'p1', 'the-mafia');
    boost(s0, att, 10);
    const w = put(s0, 'p1', 'w-i-t-c-h');
    const tgt = give(s0, 'p1', target, { hand: true });
    return { s: act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt }), w };
  }
  it('alters the roll by 1, or by 2 when a Magic Group is involved', () => {
    let { s, w } = setup('loan-sharks');
    s = toRoll(s);
    s.attack!.roll = [3, 3];
    s = use(s, 'p1', w, 'alter', { mode: 'down' });
    expect(finalRoll(s.attack!)).toBe(5);
    ({ s, w } = setup('druids'));
    s = toRoll(s);
    s.attack!.roll = [3, 3];
    s = use(s, 'p1', w, 'alter', { mode: 'up' });
    expect(finalRoll(s.attack!)).toBe(8);
  });
  it('only after a die roll', () => {
    const { s, w } = setup('loan-sharks');
    expect(() => use(s, 'p1', w, 'alter', { mode: 'down' })).toThrow(/right now/);
  });
});

describe('Bjorne', () => {
  it('gets an extra action for each Media puppet', () => {
    const s0 = scenario();
    const b = put(s0, 'p1', 'bjorne');
    s0.cards[b].tokens = 0;
    put(s0, 'p1', 'pollsters', b);
    const s = nextP1Turn(s0);
    expect(s.cards[b].tokens).toBe(2);
  });
  it('without Media puppets it gets the normal single token', () => {
    const s = scenario();
    const b = put(s, 'p1', 'bjorne');
    put(s, 'p1', 'dentists', b);
    expect(HOOKS['bjorne'].extraTokens!(s, b, b)).toBe(0);
  });
  it('whoever destroys him draws Plots equal to his Power', () => {
    const s0 = scenario();
    const att = put(s0, 'p1', 'the-mafia');
    boost(s0, att);
    const b = put(s0, 'p2', 'bjorne');
    const before = hand(s0, 'p1').length;
    let s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: b });
    s = resolve(s, [1, 1]);
    expect(s.cards[b].zone).toBe('destroyed');
    expect(hand(s, 'p1').length).toBe(before + CARDS['bjorne'].power!);
  });
});

describe('Count Dracula', () => {
  function attack(attacker: string) {
    const s0 = scenario();
    const att = put(s0, 'p1', attacker);
    boost(s0, att);
    const d = put(s0, 'p2', 'count-dracula');
    const s = resolve(act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: d }), [1, 1]);
    return s.cards[d].zone;
  }
  it('cannot be destroyed without Magic', () => expect(attack('the-mafia')).toBe('structure'));
  it('a Magic Group can destroy him', () => expect(attack('voudonistas')).toBe('destroyed'));
});

describe('Cancel a Group\'s action', () => {
  const cases: [string, string][] = [
    ['dan-quayle', 'tabloids'], ['elvis', 'tabloids'], ['jimmy-hoffa', 'liquor-companies'], ['saddam-hussein', 'b-a-t-f'],
  ];
  for (const [card, attacker] of cases) {
    function setup(att: string) {
      const s0 = scenario();
      const a = put(s0, 'p1', att);
      const c = put(s0, 'p2', card);
      const tgt = give(s0, 'p1', 'dentists', { hand: true });
      return { s: act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: a, target: tgt }), a, c, tgt };
    }
    it(`${card} cancels the action of ${attacker}`, () => {
      const { s: s0, a, c, tgt } = setup(attacker);
      let s = use(s0, 'p2', c, 'cancel', { target: a });
      s = resolve(s, [1, 1]);
      expect(s.cards[tgt].zone).toBe('hand');
      expect(s.log.some((l) => /cancelled/.test(l.text))).toBe(true);
    });
    it(`${card} cannot cancel a Group of the wrong kind`, () => {
      const { s, a, c } = setup('loan-sharks');
      expect(() => use(s, 'p2', c, 'cancel', { target: a })).toThrow(/Only a/);
    });
  }
});

describe('George Bush', () => {
  it('his controller chooses whether he is Conservative', () => {
    const s0 = scenario();
    const b = put(s0, 'p1', 'george-bush');
    let s = use(s0, 'p1', b, 'conservative', { mode: 'yes' });
    expect(alignments(s, b)).toContain('Conservative');
    s = use(s, 'p1', b, 'conservative', { mode: 'no' });
    expect(alignments(s, b)).not.toContain('Conservative');
    expect(() => use(s, 'p1', b, 'conservative', { mode: 'maybe' })).toThrow();
  });
});

describe('Imelda Marcos', () => {
  const seedFor = (ok: (d: number) => boolean) => {
    for (let k = 1; k < 1000; k++) if (ok(rollDie({ rng: k } as GameState))) return k;
    throw new Error('no seed');
  };
  function setup(target: string) {
    const s0 = scenario();
    const im = put(s0, 'p1', 'imelda-marcos');
    const tgt = put(s0, 'p2', target);
    return { s: act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: im, target: tgt }), im };
  }
  it('on 1-5 her Power counts as 5 against a Government target', () => {
    const { s: s0, im } = setup('federal-reserve');
    s0.rng = seedFor((d) => d <= 5);
    const s = use(s0, 'p1', im, 'gamble');
    expect(s.attack!.attackBonus.some((b) => b.amount === 4)).toBe(true);
    expect(() => use(s, 'p1', im, 'gamble')).toThrow(/already/);
  });
  it('on 6 she is destroyed, credited to the target\'s owner', () => {
    const { s: s0, im } = setup('federal-reserve');
    s0.rng = seedFor((d) => d === 6);
    let s = use(s0, 'p1', im, 'gamble');
    expect(s.cards[im].zone).toBe('destroyed');
    expect(s.players[1].destroyedCredit).toContain(im);
    s = resolve(s);
    expect(s.attack).toBeUndefined();
  });
  it('not against other targets', () => {
    const { s, im } = setup('loan-sharks');
    expect(() => use(s, 'p1', im, 'gamble')).toThrow(/Government or Bank/);
  });
});

describe('Manuel Noriega', () => {
  it('his master may borrow his alignments when attacking', () => {
    const s = scenario();
    const m = put(s, 'p1', 'loan-sharks');
    put(s, 'p1', 'manuel-noriega', m);
    const tgt = give(s, 'p1', 'b-a-t-f', { hand: true }); // Violent Government
    expect(line(s, ctxOf(s, { attacker: m, target: tgt }), 'Attack', 'Manuel Noriega')).toBe(4);
    const other = put(s, 'p1', 'the-mafia');
    expect(line(s, ctxOf(s, { attacker: other, target: tgt }), 'Attack', 'Manuel Noriega')).toBe(0);
  });
  it('his master may aid with a borrowed alignment', () => {
    const s0 = scenario();
    const m = put(s0, 'p1', 'loan-sharks');
    put(s0, 'p1', 'manuel-noriega', m);
    const att = put(s0, 'p1', 'the-mafia');
    const other = put(s0, 'p1', 'dentists');
    const tgt = put(s0, 'p2', 'post-office'); // Government
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    expect(canAid(s, 'p1', m)).toMatchObject({ ok: true, global: false });
    expect(canAid(s, 'p1', other).ok).toBe(false);
  });
});

describe('Prince Charles', () => {
  it('Privileged attacks on him cannot succeed', () => {
    const s = scenario();
    const pc = put(s, 'p2', 'prince-charles');
    const att = put(s, 'p1', 'the-mafia');
    expect(line(s, ctxOf(s, { attacker: att, target: pc, privileged: true }), 'Defense', 'Prince Charles')).toBe(999);
    expect(line(s, ctxOf(s, { attacker: att, target: pc }), 'Defense', 'Prince Charles')).toBe(0);
  });
  it('Media attacking him have doubled Power', () => {
    const s = scenario();
    const pc = put(s, 'p2', 'prince-charles');
    const media = put(s, 'p1', 'tabloids');
    const plain = put(s, 'p1', 'loan-sharks');
    expect(line(s, ctxOf(s, { type: 'destroy', attacker: media, target: pc }), 'Attack', 'Prince Charles')).toBe(power(s, media));
    expect(line(s, ctxOf(s, { type: 'destroy', attacker: plain, target: pc }), 'Attack', 'Prince Charles')).toBe(0);
  });
  it('any Group may help defend him', () => {
    const s0 = scenario();
    const pc = put(s0, 'p2', 'prince-charles');
    const helper = put(s0, 'p2', 'dentists');
    const att = put(s0, 'p1', 'the-mafia');
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: pc });
    expect(canOppose(s, 'p2', helper)).toMatchObject({ ok: true, global: false });
  });
});

describe('Princess Di', () => {
  it('your other Liberal Groups get +1 Power', () => {
    const s = scenario();
    const di = put(s, 'p2', 'princess-di');
    const lib = put(s, 'p2', 'feminists');
    const straight = put(s, 'p2', 'dentists');
    expect(power(s, lib)).toBe(CARDS['feminists'].power! + 1);
    expect(power(s, straight)).toBe(CARDS['dentists'].power!);
    expect(power(s, di)).toBe(CARDS['princess-di'].power!);
  });
  it('immune to rival Peaceful or Liberal Groups, but not Media', () => {
    const s0 = scenario();
    const di = put(s0, 'p2', 'princess-di');
    const peaceful = put(s0, 'p1', 'red-cross');
    const media = put(s0, 'p1', 'girlie-magazines');
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: peaceful, target: di })).toThrow(/immune/);
    expect(() => act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: media, target: di })).not.toThrow();
  });
});

describe('Corporate master gets an extra token (Brazil, Hawaii, China)', () => {
  for (const place of ['brazil', 'hawaii', 'china']) {
    it(place, () => {
      const s = scenario();
      const corp = put(s, 'p1', 'liquor-companies');
      const p = put(s, 'p1', place, corp);
      expect(HOOKS[place].extraTokens!(s, p, corp)).toBe(1);
      const gov = put(s, 'p1', 'post-office');
      expect(HOOKS[place].extraTokens!(s, p, gov)).toBe(0);
    });
  }
  it('in play: the Corporate master gets two tokens', () => {
    const s0 = scenario();
    const corp = put(s0, 'p1', 'liquor-companies');
    put(s0, 'p1', 'hawaii', corp);
    s0.cards[corp].tokens = 0;
    const s = nextP1Turn(s0);
    expect(s.cards[corp].tokens).toBe(2);
  });
  it('China gets +20 defense against Disasters too', () => {
    const s = scenario();
    const ch = put(s, 'p2', 'china');
    const ctx = ctxOf(s, { type: 'destroy', instant: true, disaster: { destroyMargin: 4 }, instantPower: 16, target: ch });
    expect(line(s, ctx, 'Defense', 'China ability')).toBe(20);
  });
});

describe('England', () => {
  it('gets two Action tokens every turn', () => {
    const s0 = scenario();
    const e = put(s0, 'p1', 'england');
    const d = put(s0, 'p1', 'dentists');
    s0.cards[e].tokens = 0; s0.cards[d].tokens = 0;
    const s = nextP1Turn(s0);
    expect(s.cards[e].tokens).toBe(2);
    expect(s.cards[d].tokens).toBe(1);
  });
});

describe('California and New York', () => {
  it('California: your Media Groups get +1 Power', () => {
    const s = scenario();
    put(s, 'p1', 'california');
    const media = put(s, 'p1', 'tabloids');
    const rival = put(s, 'p2', 'pollsters');
    const plain = put(s, 'p1', 'dentists');
    expect(power(s, media)).toBe(CARDS['tabloids'].power! + 1);
    expect(power(s, rival)).toBe(CARDS['pollsters'].power!);
    expect(power(s, plain)).toBe(CARDS['dentists'].power!);
  });
  it('New York: your other Criminal Groups get +1 Power', () => {
    const s = scenario();
    const ny = put(s, 'p1', 'new-york');
    const crim = put(s, 'p1', 'lawyers');
    const plain = put(s, 'p1', 'dentists');
    expect(power(s, crim)).toBe(CARDS['lawyers'].power! + 1);
    expect(power(s, plain)).toBe(CARDS['dentists'].power!);
    expect(power(s, ny)).toBe(CARDS['new-york'].power!);
  });
});

describe('Center for Disease Control', () => {
  it('sends Relief to a Devastated Place with its action', () => {
    const s0 = scenario();
    const cdc = put(s0, 'p1', 'center-for-disease-control');
    const place = put(s0, 'p2', 'hawaii');
    s0.cards[place].devastated = true;
    const s = use(s0, 'p1', cdc, 'relief', { target: place });
    expect(s.cards[place].devastated).toBe(false);
    expect(() => use(s0, 'p1', cdc, 'relief', { target: cdc })).toThrow(/Devastated/);
  });
  it('a failed attempt to destroy a Place destroys it, credited to the target\'s owner', () => {
    const run = (dice: [number, number]) => {
      const s0 = scenario();
      const cdc = put(s0, 'p1', 'center-for-disease-control');
      const place = put(s0, 'p2', 'hawaii');
      const s = resolve(act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: cdc, target: place }), dice);
      return { s, cdc, place };
    };
    const fail = run([5, 6]);
    expect(fail.s.cards[fail.cdc].zone).toBe('destroyed');
    expect(fail.s.players[1].destroyedCredit).toContain(fail.cdc);
    const ok = run([1, 1]);
    expect(ok.s.cards[ok.place].zone).toBe('destroyed');
    expect(ok.s.cards[ok.cdc].zone).toBe('structure');
  });
});

describe('Dinosaur Park', () => {
  it('+4 to a Disaster', () => {
    const s0 = scenario();
    const dp = put(s0, 'p2', 'dinosaur-park');
    const place = put(s0, 'p2', 'hawaii');
    let s = disaster(s0, 'meteor-strike', place);
    s = use(s, 'p2', dp, 'disaster');
    expect(line(s, s.attack!, 'Attack', 'Dinosaur Park')).toBe(4);
  });
  it('not in an ordinary attack', () => {
    const s0 = scenario();
    const dp = put(s0, 'p1', 'dinosaur-park');
    const att = put(s0, 'p1', 'the-mafia');
    const tgt = give(s0, 'p1', 'dentists', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    expect(() => use(s, 'p1', dp, 'disaster')).toThrow(/Disaster/);
  });
  it('it and its master may join attacks on Science or Corporate Groups', () => {
    const s0 = scenario();
    const dp = put(s0, 'p1', 'dinosaur-park');
    const att = put(s0, 'p1', 'the-mafia');
    const sci = put(s0, 'p2', 'a-m-a');
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: sci });
    expect(canAid(s, 'p1', dp)).toMatchObject({ ok: true, global: false });
    const s1 = scenario();
    const dp1 = put(s1, 'p1', 'dinosaur-park');
    const att1 = put(s1, 'p1', 'the-mafia');
    const plain = put(s1, 'p2', 'dentists');
    const t = act(s1, 'p1', { type: 'attack', attackType: 'control', attacker: att1, target: plain });
    expect(canAid(t, 'p1', dp1).ok).toBe(false);
  });
});

describe('France and Italy', () => {
  it('Italy may defend your Weird Groups with its full Power', () => {
    const s0 = scenario();
    const it2 = put(s0, 'p2', 'italy');
    const weird = put(s0, 'p2', 'gay-activists');
    const att = put(s0, 'p1', 'the-mafia');
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: weird });
    expect(canOppose(s, 'p2', it2)).toMatchObject({ ok: true, global: false });
  });
  it('Italy cannot defend a Straight Group', () => {
    const s0 = scenario();
    const it2 = put(s0, 'p2', 'italy');
    const straight = put(s0, 'p2', 'dentists');
    const att = put(s0, 'p1', 'the-mafia');
    const s = act(s0, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: straight });
    expect(canOppose(s, 'p2', it2).ok).toBe(false);
  });
  it('France may defend your Liberal Groups, not a rival\'s', () => {
    const s = scenario();
    const fr = put(s, 'p2', 'france');
    const mine = put(s, 'p2', 'feminists');
    const theirs = put(s, 'p1', 'secular-humanists');
    const mayJoin = HOOKS['france'].mayJoin!;
    expect(mayJoin(s, fr, ctxOf(s, { target: mine }), fr, 'oppose')).toBe(true);
    expect(mayJoin(s, fr, ctxOf(s, { target: theirs }), fr, 'oppose')).toBe(false);
  });
});

describe('Germany', () => {
  it('receives another token even while holding a saved one', () => {
    const s0 = scenario();
    const g = put(s0, 'p1', 'germany');
    s0.cards[g].tokens = 1;
    const s = nextP1Turn(s0);
    expect(s.cards[g].tokens).toBe(2);
  });
  it('with no saved token it just gets one', () => {
    const s0 = scenario();
    const g = put(s0, 'p1', 'germany');
    s0.cards[g].tokens = 0;
    const s = nextP1Turn(s0);
    expect(s.cards[g].tokens).toBe(1);
  });
  it('may add its Power again with a saved token in an attack it is part of', () => {
    const s0 = scenario();
    const g = put(s0, 'p1', 'germany');
    s0.cards[g].tokens = 2;
    const tgt = give(s0, 'p1', 'dentists', { hand: true });
    let s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: g, target: tgt });
    s = use(s, 'p1', g, 'combine');
    expect(line(s, s.attack!, 'Attack', 'Germany (saved action)')).toBe(power(s, g));
    const s1 = scenario();
    const g1 = put(s1, 'p1', 'germany');
    const att = put(s1, 'p1', 'the-mafia');
    const t = act(s1, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: give(s1, 'p1', 'dentists', { hand: true }) });
    expect(() => use(t, 'p1', g1, 'combine')).toThrow(/Germany must/);
  });
});

describe('Hollywood', () => {
  it('+2 Power and Global Power per Media Personality you control', () => {
    const s = scenario();
    const h = put(s, 'p1', 'hollywood');
    put(s, 'p1', 'tabloids'); // Media, but not a Personality
    expect(power(s, h)).toBe(CARDS['hollywood'].power!);
    put(s, 'p1', 'gordo-remora');
    expect(power(s, h)).toBe(CARDS['hollywood'].power! + 2);
    expect(globalPower(s, h)).toBe(CARDS['hollywood'].globalPower! + 2);
  });
});

describe('Israel', () => {
  function setup(tokens: number) {
    const s0 = scenario();
    const isr = put(s0, 'p2', 'israel');
    s0.cards[isr].tokens = tokens;
    const att = put(s0, 'p1', 'the-mafia');
    const tgt = give(s0, 'p1', 'dentists', { hand: true });
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    s.attack!.privileged = true;
    return { s, isr };
  }
  it('may interfere in a Privileged attack, negating the Privilege', () => {
    const { s: s0, isr } = setup(1);
    expect(waitingFor(s0)).toContain('p2');
    const s = use(s0, 'p2', isr, 'interfere', { mode: 'oppose' });
    expect(isPrivileged(s.attack!)).toBe(false);
    expect(line(s, s.attack!, 'Defense', 'Israel interferes')).toBe(power(s, isr));
  });
  it('without an action it cannot', () => {
    const { s, isr } = setup(0);
    expect(() => use(s, 'p2', isr, 'interfere', { mode: 'oppose' })).toThrow();
  });
  it('may aid any attack regardless of alignment', () => {
    const s0 = scenario();
    const isr = put(s0, 'p1', 'israel');
    const att = put(s0, 'p1', 'the-mafia');
    const s = act(s0, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: give(s0, 'p1', 'dentists', { hand: true }) });
    expect(canAid(s, 'p1', isr)).toMatchObject({ ok: true, global: false });
  });
});

describe('Moonbase', () => {
  it('is immune to Disasters other than Nuclear Accident and Meteor Strike', () => {
    const s0 = scenario();
    const mb = put(s0, 'p2', 'moonbase');
    let s = disaster(s0, 'tornado', mb);
    expect(line(s, s.attack!, 'Defense', 'Moonbase')).toBe(999);
    s = resolve(s, [1, 1]);
    expect(s.cards[mb].devastated).toBeFalsy();
    expect(s.cards[mb].tokens).toBe(1);
    const t = disaster(s0, 'meteor-strike', mb);
    expect(line(t, t.attack!, 'Defense', 'Moonbase')).toBe(0);
  });
  it('linked Personalities get +6 against Assassination (not against Voudonistas) and die with it', () => {
    const s0 = scenario();
    const mb = put(s0, 'p1', 'moonbase');
    const hc = put(s0, 'p1', 'hillary-clinton');
    let s = use(s0, 'p1', mb, 'link', { target: hc });
    const base = { type: 'destroy' as const, instant: true, assassination: true, instantPower: 8, target: hc, attackerPlayer: 'p2' };
    expect(line(s, ctxOf(s, base), 'Defense', 'Moonbase')).toBe(6);
    const v = put(s, 'p2', 'voudonistas');
    expect(line(s, ctxOf(s, { ...base, aid: [{ player: 'p2', iid: v, amount: 0, label: 'V' }] }), 'Defense', 'Moonbase')).toBe(0);
    expect(() => use(s, 'p1', mb, 'link', { target: hc })).toThrow(/already/);
    // Moonbase is destroyed: the linked Personality dies.
    s.active = 1; // p2's turn
    const att = put(s, 'p2', 'the-mafia');
    boost(s, att);
    s = resolve(act(s, 'p2', { type: 'attack', attackType: 'destroy', attacker: att, target: mb }), [1, 1]);
    expect(s.cards[mb].zone).toBe('destroyed');
    expect(s.cards[hc].zone).toBe('destroyed');
  });
});

describe('Orbit One and the Pentagon', () => {
  it('Orbit One: one extra Plot draw per Science puppet', () => {
    const s = scenario();
    const o = put(s, 'p1', 'orbit-one');
    put(s, 'p1', 'fbi', o);
    put(s, 'p1', 'dentists', o);
    expect(HOOKS['orbit-one'].extraPlotDraws!(s, o)).toBe(1);
  });
  it('Orbit One: only Nuclear Accident and Meteor Strike affect it', () => {
    const s0 = scenario();
    const o = put(s0, 'p2', 'orbit-one');
    const s = disaster(s0, 'earthquake', o);
    expect(line(s, s.attack!, 'Defense', 'Orbit One')).toBe(999);
    const t = disaster(s0, 'nuclear-accident', o);
    expect(line(t, t.attack!, 'Defense', 'Orbit One')).toBe(0);
  });
  it('Pentagon: one extra Plot draw per Corporate puppet, at the start of the turn', () => {
    const drawn = (withCorp: boolean) => {
      const s0 = scenario();
      const p = put(s0, 'p1', 'pentagon');
      put(s0, 'p1', withCorp ? 'liquor-companies' : 'dentists', p);
      const deck = s0.players[0].plotDeck.length;
      return deck - nextP1Turn(s0).players[0].plotDeck.length;
    };
    expect(drawn(true)).toBe(drawn(false) + 1);
    const s0 = scenario();
    const p = put(s0, 'p1', 'pentagon');
    put(s0, 'p1', 'liquor-companies', p);
    put(s0, 'p1', 'dentists', p);
    expect(HOOKS['pentagon'].extraPlotDraws!(s0, p)).toBe(1);
  });
});

describe('Russia', () => {
  it('Communist Groups get +4 on direct control of Russia', () => {
    const s = scenario();
    const r = put(s, 'p2', 'russia');
    const comm = put(s, 'p1', 'international-communist-conspiracy');
    const plain = put(s, 'p1', 'loan-sharks');
    expect(line(s, ctxOf(s, { attacker: comm, target: r }), 'Attack', 'Russia')).toBe(4);
    expect(line(s, ctxOf(s, { attacker: plain, target: r }), 'Attack', 'Russia')).toBe(0);
    expect(line(s, ctxOf(s, { type: 'destroy', attacker: comm, target: r }), 'Attack', 'Russia')).toBe(0);
  });
});

describe('Silicon Valley', () => {
  it('draws an extra Plot with its action, once per token', () => {
    const s0 = scenario();
    const sv = put(s0, 'p1', 'silicon-valley');
    const s = use(s0, 'p1', sv, 'draw');
    expect(hand(s, 'p1').length).toBe(hand(s0, 'p1').length + 1);
    expect(() => use(s, 'p1', sv, 'draw')).toThrow(/no Action token/);
  });
});

describe('Switzerland', () => {
  it('Gnomes get +15 to control it and cannot destroy it', () => {
    const s = scenario();
    s.cards[ill(s, 'p1')].cardId = 'gnomes-of-zurich';
    const sw = put(s, 'p2', 'switzerland');
    const other = put(s, 'p1', 'the-mafia');
    expect(line(s, ctxOf(s, { attacker: ill(s, 'p1'), target: sw }), 'Attack', 'Switzerland')).toBe(15);
    expect(line(s, ctxOf(s, { attacker: other, target: sw }), 'Attack', 'Switzerland')).toBe(0);
    expect(HOOKS['switzerland'].preventDestroy!(s, sw, sw, ctxOf(s, { type: 'destroy', attacker: other, target: sw }))).toBe(true);
  });
  it('another Illuminati controlling it gets +2 attacking the Gnomes', () => {
    const s = scenario();
    s.cards[ill(s, 'p2')].cardId = 'gnomes-of-zurich';
    put(s, 'p1', 'switzerland');
    const att = put(s, 'p1', 'the-mafia');
    const tgt = put(s, 'p2', 'dentists');
    expect(line(s, ctxOf(s, { attacker: att, target: tgt }), 'Attack', 'Switzerland')).toBe(2);
    s.cards[ill(s, 'p1')].cardId = 'gnomes-of-zurich'; // the Gnomes themselves get no such bonus
    expect(line(s, ctxOf(s, { attacker: att, target: tgt }), 'Attack', 'Switzerland')).toBe(0);
  });
});

describe('The Great Pyramid', () => {
  it('is immune to Tornadoes and Hurricanes, not other Disasters', () => {
    const s = scenario();
    const gp = put(s, 'p2', 'the-great-pyramid');
    const tornado = give(s, 'p1', 'tornado', { hand: true });
    const meteor = give(s, 'p1', 'meteor-strike', { hand: true });
    const base = { type: 'destroy' as const, instant: true, disaster: { destroyMargin: 4 }, instantPower: 12, target: gp };
    expect(line(s, ctxOf(s, { ...base, instantCard: tornado }), 'Defense', 'The Great Pyramid')).toBe(999);
    expect(line(s, ctxOf(s, { ...base, instantCard: meteor }), 'Defense', 'The Great Pyramid')).toBe(0);
  });
});

describe('Pyramid Marketing Schemes', () => {
  it('+2 Resistance per Fanatic Group in your Power Structure', () => {
    const s = scenario();
    const pms = put(s, 'p1', 'pyramid-marketing-schemes');
    expect(resistance(s, pms)).toBe(CARDS['pyramid-marketing-schemes'].resistance!);
    put(s, 'p1', 'moonies');
    put(s, 'p2', 'libertarians'); // a rival's Fanatic Group does not count
    expect(resistance(s, pms)).toBe(CARDS['pyramid-marketing-schemes'].resistance! + 2);
  });
});

describe('Trading Card Games', () => {
  it('is replaced by a Group from hand in exactly its position', () => {
    const s0 = scenario();
    const tcg = put(s0, 'p1', 'trading-card-games');
    const { x, y, master } = s0.cards[tcg];
    const g = give(s0, 'p1', 'dentists', { hand: true });
    const s = use(s0, 'p1', tcg, 'replace', { target: g });
    expect(s.cards[tcg].zone).toBe('discard');
    expect(s.cards[g]).toMatchObject({ zone: 'structure', controller: 'p1', x, y, master });
    expect(hand(s, 'p1')).not.toContain(g);
  });
  it('the replacement must come from your hand', () => {
    const s0 = scenario();
    const tcg = put(s0, 'p1', 'trading-card-games');
    const g = put(s0, 'p1', 'dentists');
    expect(() => use(s0, 'p1', tcg, 'replace', { target: g })).toThrow(/hand/);
  });
});
