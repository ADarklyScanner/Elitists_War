// Scripted parts of the Groups in src/engine/content/groups0.ts.
import { describe, expect, it } from 'vitest';
import {
  applyAction, attackCancelled, attackStrength, alignments, canOppose, destroyGroup, openArrows, power, resistance,
  startInstantAttack, validateAttack, waitingFor, type Action, type AttackType, type GameState,
} from '../../src/engine';
import { roll2d6 } from '../../src/engine/rng';
import { canAid, drawPlot, GOALS, player as playerOf } from '../../src/engine';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);

function resolve(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = applyAction(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}

const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
/** Put a Group into `pl`'s structure on the first open arrow of `under` (default: the Illuminati). */
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
/** Sum of the attack-strength lines credited to `name` on one side. */
function line(s: GameState, side: 'Attack' | 'Defense', name: string): number {
  return attackStrength(s, s.attack!).lines
    .filter((l) => l.startsWith(side) && l.endsWith(`: ${name}`))
    .reduce((n, l) => n + Number(l.match(/([+-]\d+)/)![1]), 0);
}
const hand = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.hand;
const disaster = (s: GameState, pl: string, target: string) => {
  const plot = give(s, pl, 'earthquake', { hand: true });
  startInstantAttack(s, pl, { plot, target, power: 12, disaster: { destroyMargin: null } });
};

describe('A.M.A.', () => {
  it('+5 when helping defend a Science group', () => {
    const s0 = scenario();
    const mafia = put(s0, 'p1', 'the-mafia');
    const npc = put(s0, 'p2', 'nuclear-power-companies');
    const ama = put(s0, 'p2', 'a-m-a');
    let s = attack(s0, mafia, npc, 'control');
    s = act(s, 'p2', { type: 'oppose', group: ama });
    expect(line(s, 'Defense', 'A.M.A.')).toBe(5);
  });
  it('nothing extra for a non-Science group', () => {
    const s0 = scenario();
    const mafia = put(s0, 'p1', 'the-mafia');
    const gun = put(s0, 'p2', 'gun-lobby');
    const ama = put(s0, 'p2', 'a-m-a');
    let s = attack(s0, mafia, gun, 'control');
    s = act(s, 'p2', { type: 'oppose', group: ama });
    expect(line(s, 'Defense', 'A.M.A.')).toBe(0);
  });
});

describe('Anti-Nuclear Activists', () => {
  it('+10 against Nuclear Power Companies, to control or destroy', () => {
    for (const type of ['control', 'destroy'] as const) {
      const s0 = scenario();
      const ana = put(s0, 'p1', 'anti-nuclear-activists');
      const npc = put(s0, 'p2', 'nuclear-power-companies');
      expect(line(attack(s0, ana, npc, type), 'Attack', 'Anti-Nuclear Activists')).toBe(10);
    }
  });
  it('only +6 against another Science group', () => {
    const s0 = scenario();
    const ana = put(s0, 'p1', 'anti-nuclear-activists');
    const ama = put(s0, 'p2', 'a-m-a');
    expect(line(attack(s0, ana, ama, 'destroy'), 'Attack', 'Anti-Nuclear Activists')).toBe(6);
  });
});

describe('Bank of England', () => {
  it('spends its action to draw two Plots', () => {
    const s0 = scenario();
    const b = put(s0, 'p1', 'bank-of-england');
    const s = use(s0, 'p1', b, 'draw');
    expect(hand(s, 'p1').length).toBe(2);
    expect(s.cards[b].tokens).toBe(0);
    expect(() => use(s, 'p1', b, 'draw')).toThrow(/no Action token/);
  });
});

describe('Big Media', () => {
  it('may oppose an attack on a Media group with full Power', () => {
    const s0 = scenario();
    const mafia = put(s0, 'p1', 'the-mafia');
    const comics = put(s0, 'p2', 'comic-books');
    const bm = put(s0, 'p2', 'big-media');
    const s = attack(s0, mafia, comics, 'control');
    expect(canOppose(s, 'p2', bm)).toMatchObject({ ok: true, global: false });
  });
  it('only Global Power for an unrelated non-Media target', () => {
    const s0 = scenario();
    const mafia = put(s0, 'p1', 'the-mafia');
    const gun = put(s0, 'p2', 'gun-lobby');
    const bm = put(s0, 'p2', 'big-media');
    const s = attack(s0, mafia, gun, 'control');
    expect(canOppose(s, 'p2', bm)).toMatchObject({ ok: true, global: true });
  });
});

describe('Boy Sprouts', () => {
  it('count as 12 for Relief and draw a Plot', () => {
    const s0 = scenario();
    const bs = put(s0, 'p1', 'boy-sprouts');
    const hawaii = put(s0, 'p1', 'hawaii');
    s0.cards[hawaii].devastated = true;
    const s = use(s0, 'p1', bs, 'relief', { target: hawaii });
    expect(s.cards[hawaii].devastated).toBe(false);
    expect(hand(s, 'p1').length).toBe(1);
  });
  it('need help for a big Place', () => {
    const s0 = scenario();
    const bs = put(s0, 'p1', 'boy-sprouts');
    const cal = put(s0, 'p1', 'california');
    s0.cards[cal].devastated = true;
    expect(() => use(s0, 'p1', bs, 'relief', { target: cal })).toThrow(/needs 15/);
  });
});

describe('Cattle Mutilators', () => {
  it('expose all hidden Plots of a rival', () => {
    const s0 = scenario();
    const cm = put(s0, 'p1', 'cattle-mutilators');
    const a = give(s0, 'p2', 'reload', { hand: true });
    const b = give(s0, 'p2', 'reload', { hand: true });
    const s = use(s0, 'p1', cm, 'expose');
    expect(s.cards[a].exposed && s.cards[b].exposed).toBe(true);
    expect(() => use(s, 'p1', cm, 'expose')).toThrow();
  });
  it('fail when the rival has nothing hidden', () => {
    const s0 = scenario();
    const cm = put(s0, 'p1', 'cattle-mutilators');
    expect(() => use(s0, 'p1', cm, 'expose')).toThrow(/no hidden Plots/);
  });
});

describe('Church of Elvis', () => {
  it('Power 1, 4 with Elvis in play, 8 when you control Elvis', () => {
    const s = scenario();
    const ch = put(s, 'p1', 'church-of-elvis');
    expect(power(s, ch)).toBe(1);
    const elvis = put(s, 'p2', 'elvis');
    expect(power(s, ch)).toBe(4);
    s.cards[elvis].zone = 'removed'; delete s.cards[elvis];
    put(s, 'p1', 'elvis');
    expect(power(s, ch)).toBe(8);
  });
});

describe('C.I.A., Clone Arrangers and Joggers', () => {
  it('C.I.A. turns an attack on a Personality into an Assassination; Clone Arrangers bring it back', () => {
    const s0 = scenario();
    const cia = put(s0, 'p1', 'c-i-a');
    const clones = put(s0, 'p1', 'clone-arrangers');
    put(s0, 'p1', 'joggers');
    s0.cards[cia].mods.push({ source: 'test', kind: 'power', value: 10, until: 'permanent' });
    const elvis = put(s0, 'p2', 'elvis');
    let s = attack(s0, cia, elvis, 'destroy');
    s = use(s, 'p1', cia, 'assassinate');
    expect(s.attack!.instant && s.attack!.assassination).toBe(true);
    expect(line(s, 'Attack', 'Joggers')).toBe(2);
    expect(() => act(s, 'p2', { type: 'oppose', group: elvis })).toThrow();
    s = resolve(s, [1, 1]);
    expect(s.cards[elvis].zone).toBe('destroyed');
    expect(s.cards[elvis].killed).toBe(true);
    expect(s.players[0].destroyedCredit).toContain(elvis);
    s = use(s, 'p1', clones, 'clone', { target: ill(s, 'p1') });
    expect(s.cards[elvis].zone).toBe('structure');
    expect(s.cards[elvis].controller).toBe('p1');
    expect(s.players[0].destroyedCredit).not.toContain(elvis);
  });
  it('C.I.A. cannot assassinate a non-Personality; Clone Arrangers need a fresh kill', () => {
    const s0 = scenario();
    const cia = put(s0, 'p1', 'c-i-a');
    const clones = put(s0, 'p1', 'clone-arrangers');
    const gun = put(s0, 'p2', 'gun-lobby');
    const s = attack(s0, cia, gun, 'destroy');
    expect(() => use(s, 'p1', cia, 'assassinate')).toThrow(/Personality/);
    expect(() => use(s0, 'p1', clones, 'clone', { target: ill(s0, 'p1') })).toThrow(/just been killed/);
  });
  it('Joggers do not help a Disaster', () => {
    const s = scenario();
    put(s, 'p1', 'joggers');
    const hawaii = put(s, 'p2', 'hawaii');
    disaster(s, 'p1', hawaii);
    expect(line(s, 'Attack', 'Joggers')).toBe(0);
  });
});

describe('Comic Books', () => {
  it('Weird target: printed Resistance and Weird-master bonus are ignored', () => {
    const s0 = scenario();
    const cb = put(s0, 'p1', 'comic-books');
    const l4 = put(s0, 'p2', 'l-4-society');
    const gay = put(s0, 'p2', 'gay-activists', l4);
    expect(line(attack(s0, cb, gay, 'control'), 'Defense', 'Comic Books')).toBe(-7);
  });
  it('no effect on a non-Weird target', () => {
    const s0 = scenario();
    const cb = put(s0, 'p1', 'comic-books');
    const d = put(s0, 'p2', 'dentists');
    expect(line(attack(s0, cb, d, 'control'), 'Defense', 'Comic Books')).toBe(0);
  });
});

describe('Cycle Gangs and International Weather Organization', () => {
  it('+4 to your Disasters; IWO +4 against rival Places', () => {
    const s = scenario();
    put(s, 'p1', 'cycle-gangs');
    put(s, 'p1', 'international-weather-organization');
    const hawaii = put(s, 'p2', 'hawaii');
    disaster(s, 'p1', hawaii);
    expect(line(s, 'Attack', 'Cycle Gangs')).toBe(4);
    expect(line(s, 'Attack', 'International Weather Organization')).toBe(4);
  });
  it('IWO: your Places +6 against Disasters; Cycle Gangs do not help a rival\'s Disaster', () => {
    const s = scenario();
    put(s, 'p1', 'cycle-gangs');
    put(s, 'p1', 'international-weather-organization');
    const hawaii = put(s, 'p1', 'hawaii');
    s.active = 1;
    disaster(s, 'p2', hawaii);
    expect(line(s, 'Defense', 'International Weather Organization')).toBe(6);
    expect(line(s, 'Attack', 'Cycle Gangs')).toBe(0);
  });
});

describe('Democrats', () => {
  it('+4 to control a Government group that is not a Nation', () => {
    const s0 = scenario();
    const dem = put(s0, 'p1', 'democrats');
    const cia = put(s0, 'p2', 'c-i-a');
    expect(line(attack(s0, dem, cia, 'control'), 'Attack', 'Democrats')).toBe(4);
  });
  it('nothing against a Nation', () => {
    const s0 = scenario();
    const dem = put(s0, 'p1', 'democrats');
    const sw = put(s0, 'p2', 'switzerland');
    expect(line(attack(s0, dem, sw, 'control'), 'Attack', 'Democrats')).toBe(0);
  });
});

describe('Dentists', () => {
  it('cancel the action of a Personality', () => {
    const s0 = scenario();
    const elvis = put(s0, 'p1', 'elvis');
    const d = put(s0, 'p2', 'dentists');
    const gun = put(s0, 'p2', 'gun-lobby');
    let s = attack(s0, elvis, gun, 'destroy');
    s = use(s, 'p2', d, 'cancel', { target: elvis });
    expect(attackCancelled(s.attack!)).toBe(true);
  });
  it('cannot cancel a non-Personality', () => {
    const s0 = scenario();
    const mafia = put(s0, 'p1', 'the-mafia');
    const d = put(s0, 'p2', 'dentists');
    const gun = put(s0, 'p2', 'gun-lobby');
    const s = attack(s0, mafia, gun, 'destroy');
    expect(() => use(s, 'p2', d, 'cancel', { target: mafia })).toThrow(/Personality/);
  });
});

describe('Druids', () => {
  it('linked Place gets +8 against Disasters, and Druids die with it', () => {
    let s = scenario();
    const dr = put(s, 'p1', 'druids');
    const hawaii = put(s, 'p1', 'hawaii');
    s = use(s, 'p1', dr, 'link', { target: hawaii });
    s.active = 1;
    disaster(s, 'p2', hawaii);
    expect(line(s, 'Defense', 'Druids')).toBe(8);
    s.attack = undefined; s.window = undefined;
    destroyGroup(s, hawaii, 'p2');
    expect(s.cards[dr].zone).toBe('destroyed');
  });
  it('can only link to a Place', () => {
    const s = scenario();
    const dr = put(s, 'p1', 'druids');
    const d = put(s, 'p1', 'dentists');
    expect(() => use(s, 'p1', dr, 'link', { target: d })).toThrow(/Place/);
  });
});

describe('EFF', () => {
  it('doubles the Power spent defending a Computer group', () => {
    const s0 = scenario();
    const mafia = put(s0, 'p1', 'the-mafia');
    const hackers = put(s0, 'p2', 'hackers');
    const eff = put(s0, 'p2', 'eff');
    let s = attack(s0, mafia, hackers, 'control');
    s = act(s, 'p2', { type: 'oppose', group: eff });
    expect(line(s, 'Defense', 'EFF')).toBe(1); // Global Power 1
    s = act(s, 'p2', { type: 'oppose', group: hackers });
    expect(line(s, 'Defense', 'EFF')).toBe(1 + 6); // hackers defend themselves with 3 x2
  });
  it('no effect for a non-Computer group', () => {
    const s0 = scenario();
    const mafia = put(s0, 'p1', 'the-mafia');
    const d = put(s0, 'p2', 'dentists');
    const eff = put(s0, 'p2', 'eff');
    let s = attack(s0, mafia, d, 'control');
    s = act(s, 'p2', { type: 'oppose', group: eff });
    expect(line(s, 'Defense', 'EFF')).toBe(0);
  });
});

describe('Empty Vee', () => {
  it('your Media groups are immune to Straight attackers; Personalities +1', () => {
    const s = scenario();
    put(s, 'p2', 'empty-vee');
    const comics = put(s, 'p2', 'comic-books');
    const elvis = put(s, 'p2', 'elvis');
    const d = put(s, 'p1', 'dentists');
    const mafia = put(s, 'p1', 'the-mafia');
    expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: d, target: comics })).toMatch(/immune/);
    expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: mafia, target: comics })).toBeNull();
    expect(power(s, elvis)).toBe(2);
  });
  it('a rival\'s Personalities get nothing', () => {
    const s = scenario();
    put(s, 'p2', 'empty-vee');
    const elvis = put(s, 'p1', 'elvis');
    expect(power(s, elvis)).toBe(1);
  });
});

describe('Evil Geniuses for a Better Tomorrow', () => {
  it('bring a Gadget from hand into play linked to them', () => {
    const s0 = scenario();
    const eg = put(s0, 'p1', 'evil-geniuses-for-a-better-tomorrow');
    const cy = give(s0, 'p1', 'cyborg-soldiers', { hand: true });
    const s = use(s0, 'p1', eg, 'gadget', { target: cy });
    expect(s.cards[cy]).toMatchObject({ zone: 'resources', controller: 'p1', linkedTo: eg });
  });
  it('only Gadgets', () => {
    const s0 = scenario();
    const eg = put(s0, 'p1', 'evil-geniuses-for-a-better-tomorrow');
    const x = give(s0, 'p1', 'xanadu', { hand: true });
    expect(() => use(s0, 'p1', eg, 'gadget', { target: x })).toThrow(/Gadget/);
  });
});

describe('Fast Food Chains', () => {
  it('hide up to two exposed Plots per turn', () => {
    let s = scenario();
    const ff = put(s, 'p1', 'fast-food-chains');
    const plots = [1, 2, 3].map(() => give(s, 'p1', 'reload', { hand: true }));
    for (const p of plots) s.cards[p].exposed = true;
    s = use(s, 'p1', ff, 'hide', { target: plots[0] });
    s = use(s, 'p1', ff, 'hide', { target: plots[1] });
    expect(s.cards[plots[0]].exposed || s.cards[plots[1]].exposed).toBe(false);
    expect(() => use(s, 'p1', ff, 'hide', { target: plots[2] })).toThrow(/two Plots/);
  });
});

describe('Federal Reserve', () => {
  it('+2 once against a Nation or a Corporate group', () => {
    for (const t of ['switzerland', 'nuclear-power-companies']) {
      const s0 = scenario();
      put(s0, 'p1', 'federal-reserve');
      const mafia = put(s0, 'p1', 'the-mafia');
      const tgt = put(s0, 'p2', t);
      expect(line(attack(s0, mafia, tgt, 'destroy'), 'Attack', 'Federal Reserve')).toBe(2);
    }
  });
  it('nothing against other groups', () => {
    const s0 = scenario();
    put(s0, 'p1', 'federal-reserve');
    const mafia = put(s0, 'p1', 'the-mafia');
    const d = put(s0, 'p2', 'dentists');
    expect(line(attack(s0, mafia, d, 'destroy'), 'Attack', 'Federal Reserve')).toBe(0);
  });
});

describe('Feminists', () => {
  it('keep a Liberal Group drawn from a rival\'s hand', () => {
    const s0 = scenario();
    const f = put(s0, 'p1', 'feminists');
    const dem = give(s0, 'p2', 'democrats', { hand: true });
    const s = use(s0, 'p1', f, 'recruit');
    expect(hand(s, 'p1')).toContain(dem);
    expect(hand(s, 'p2')).not.toContain(dem);
  });
  it('give back a non-Liberal Group', () => {
    const s0 = scenario();
    const f = put(s0, 'p1', 'feminists');
    const gun = give(s0, 'p2', 'gun-lobby', { hand: true });
    const s = use(s0, 'p1', f, 'recruit');
    expect(hand(s, 'p2')).toContain(gun);
    expect(s.cards[f].tokens).toBe(0);
  });
});

describe('Flat Earthers', () => {
  function withRoll(want: (n: number) => boolean) {
    const s = scenario();
    const fe = put(s, 'p1', 'flat-earthers');
    for (const p of ['hawaii', 'switzerland', 'finland']) put(s, 'p1', p);
    for (let r = 1; r < 5000; r++) {
      s.rng = r;
      const [a, b] = roll2d6(structuredClone(s));
      if (want(a + b)) return { s, fe, n: a + b };
    }
    throw new Error('no seed');
  }
  it('draw as many Plots as the roll when it is no more than the Places in play', () => {
    const { s, fe, n } = withRoll((x) => x <= 3);
    expect(hand(use(s, 'p1', fe, 'roll'), 'p1').length).toBe(n);
  });
  it('draw nothing on a higher roll', () => {
    const { s, fe } = withRoll((x) => x > 3);
    expect(hand(use(s, 'p1', fe, 'roll'), 'p1').length).toBe(0);
  });
});

describe('Fnord Motor Company', () => {
  function failedRoll(leader: 'the-mafia' | 'fnord-motor-company') {
    const s0 = scenario();
    const fnord = put(s0, 'p1', 'fnord-motor-company');
    const mafia = put(s0, 'p1', 'the-mafia');
    const plot = give(s0, 'p1', 'reload', { hand: true });
    const d = put(s0, 'p2', 'gun-lobby');
    const att = leader === 'the-mafia' ? mafia : fnord;
    s0.cards[att].mods.push({ source: 'test', kind: 'power', value: 20, until: 'permanent' });
    if (leader === 'fnord-motor-company') s0.cards[fnord].tokens = 2;
    let s = attack(s0, att, d, 'destroy');
    s = act(s, 'p1', { type: 'pass' });
    s = act(s, 'p2', { type: 'pass' });
    expect(s.window?.kind).toBe('roll');
    s.attack!.roll = [6, 6];
    return { s, fnord, plot };
  }
  it('discard a Plot to reroll a failed attack by another Group', () => {
    const { s: s0, fnord, plot } = failedRoll('the-mafia');
    const s = use(s0, 'p1', fnord, 'reroll', { target: plot });
    expect(s.cards[plot].zone).toBe('discard');
    expect(s.attack!.plays.at(-1)!.effect.t).toBe('reroll');
  });
  it('not for its own attack', () => {
    const { s, fnord, plot } = failedRoll('fnord-motor-company');
    expect(() => use(s, 'p1', fnord, 'reroll', { target: plot })).toThrow(/another Group/);
  });
});

describe('Fraternal Orders', () => {
  it('draw a Group card for their action', () => {
    const s0 = scenario();
    const fo = put(s0, 'p1', 'fraternal-orders');
    const s = use(s0, 'p1', fo, 'draw');
    expect(hand(s, 'p1').length).toBe(1);
    expect(() => use(s, 'p1', fo, 'draw')).toThrow(/no Action token/);
  });
});

describe('Gay Activists', () => {
  it('reverse one alignment until end of turn', () => {
    const s0 = scenario();
    const ga = put(s0, 'p1', 'gay-activists');
    const d = put(s0, 'p2', 'dentists');
    const s = use(s0, 'p1', ga, 'reverse', { target: d, alignment: 'Straight' });
    expect(alignments(s, d)).toEqual(['Weird']);
    expect(s.cards[d].mods[0].until).toBe('endOfTurn');
  });
  it('the Group must have that alignment, and not during an attack', () => {
    const s0 = scenario();
    const ga = put(s0, 'p1', 'gay-activists');
    const mafia = put(s0, 'p1', 'the-mafia');
    const d = put(s0, 'p2', 'dentists');
    expect(() => use(s0, 'p1', ga, 'reverse', { target: d, alignment: 'Liberal' })).toThrow(/alignments/);
    const s = attack(s0, mafia, d, 'destroy');
    expect(() => use(s, 'p1', ga, 'reverse', { target: d, alignment: 'Straight' })).toThrow();
  });
});

describe('Gun Lobby', () => {
  it('Resistance becomes 10 against Liberal attackers', () => {
    const s0 = scenario();
    const dem = put(s0, 'p1', 'democrats');
    const gun = put(s0, 'p2', 'gun-lobby');
    expect(line(attack(s0, dem, gun, 'control'), 'Defense', 'Gun Lobby')).toBe(7);
  });
  it('but not against a Criminal attacker', () => {
    const s0 = scenario();
    const mafia = put(s0, 'p1', 'the-mafia');
    const gun = put(s0, 'p2', 'gun-lobby');
    expect(line(attack(s0, mafia, gun, 'control'), 'Defense', 'Gun Lobby')).toBe(0);
  });
  it('draw a Plot when your Conservative/Violent group survives an attack', () => {
    const s0 = scenario();
    const mafia = put(s0, 'p1', 'the-mafia');
    put(s0, 'p2', 'gun-lobby');
    const kkk = put(s0, 'p2', 'kkk');
    const s = resolve(attack(s0, mafia, kkk, 'control'), [6, 6]);
    expect(s.cards[kkk].controller).toBe('p2');
    expect(hand(s, 'p2').length).toBe(1);
  });
  it('no Plot for a group that is neither', () => {
    const s0 = scenario();
    const mafia = put(s0, 'p1', 'the-mafia');
    put(s0, 'p2', 'gun-lobby');
    const d = put(s0, 'p2', 'dentists');
    const s = resolve(attack(s0, mafia, d, 'control'), [6, 6]);
    expect(hand(s, 'p2').length).toBe(0);
  });
});

describe('Intellectuals', () => {
  it('Media master gets +1 Power and cannot be destroyed by a normal attack', () => {
    const s0 = scenario();
    const mafia = put(s0, 'p1', 'the-mafia');
    const comics = put(s0, 'p2', 'comic-books');
    put(s0, 'p2', 'intellectuals', comics);
    expect(power(s0, comics)).toBe(2);
    s0.cards[mafia].mods.push({ source: 'test', kind: 'power', value: 30, until: 'permanent' });
    const s = resolve(attack(s0, mafia, comics, 'destroy'), [1, 1]);
    expect(s.cards[comics].zone).toBe('structure');
  });
  it('an Assassination still works; a non-Media master gets nothing', () => {
    const s = scenario();
    const comics = put(s, 'p2', 'comic-books');
    put(s, 'p2', 'intellectuals', comics);
    const hit = give(s, 'p1', 'earthquake', { hand: true });
    startInstantAttack(s, 'p1', { plot: hit, target: comics, power: 40, assassination: true });
    const done = resolve(s, [1, 1]);
    expect(done.cards[comics].zone).toBe('destroyed');
    const s2 = scenario();
    const kkk = put(s2, 'p2', 'kkk');
    put(s2, 'p2', 'intellectuals', kkk);
    expect(power(s2, kkk)).toBe(2);
  });
});

describe('International Communist Conspiracy', () => {
  it('+3 to control a puppet of a Communist master', () => {
    const s0 = scenario();
    const icc = put(s0, 'p1', 'international-communist-conspiracy');
    const ff = put(s0, 'p2', 'fiendish-fluoridators');
    const d = put(s0, 'p2', 'dentists', ff);
    expect(line(attack(s0, icc, d, 'control'), 'Attack', 'International Communist Conspiracy')).toBe(3);
  });
  it('nothing for a puppet of a non-Communist master', () => {
    const s0 = scenario();
    const icc = put(s0, 'p1', 'international-communist-conspiracy');
    const kkk = put(s0, 'p2', 'kkk');
    const d = put(s0, 'p2', 'dentists', kkk);
    expect(line(attack(s0, icc, d, 'control'), 'Attack', 'International Communist Conspiracy')).toBe(0);
  });
});

describe('I.R.S. and Lawyers', () => {
  it('take the top Plot of a rival\'s deck once per turn', () => {
    const s0 = scenario();
    const irs = put(s0, 'p1', 'i-r-s');
    const top = s0.players[1].plotDeck[0];
    const s = use(s0, 'p1', irs, 'tax');
    expect(hand(s, 'p1')).toContain(top);
    expect(s.players[1].plotDeck).not.toContain(top);
    expect(() => use(s, 'p1', irs, 'tax')).toThrow(/Already used/);
  });
  it('a rival with Lawyers is immune', () => {
    const s0 = scenario();
    const irs = put(s0, 'p1', 'i-r-s');
    put(s0, 'p2', 'lawyers');
    expect(() => use(s0, 'p1', irs, 'tax')).toThrow(/Lawyers/);
  });
});

describe('KKK', () => {
  it('doubles Violent groups attacking a Peaceful group', () => {
    const s0 = scenario();
    const kkk = put(s0, 'p1', 'kkk');
    const mafia = put(s0, 'p1', 'the-mafia');
    const ama = put(s0, 'p2', 'a-m-a');
    let s = attack(s0, kkk, ama, 'destroy');
    expect(line(s, 'Attack', 'KKK')).toBe(2);
    s = act(s, 'p1', { type: 'aid', group: mafia });
    expect(line(s, 'Attack', 'KKK')).toBe(2 + 6);
  });
  it('no effect against a non-Peaceful group', () => {
    const s0 = scenario();
    const kkk = put(s0, 'p1', 'kkk');
    const d = put(s0, 'p2', 'dentists');
    expect(line(attack(s0, kkk, d, 'destroy'), 'Attack', 'KKK')).toBe(0);
  });
});

describe('L-4 Society', () => {
  it('+8 on direct control of Space groups', () => {
    const s0 = scenario();
    const l4 = put(s0, 'p1', 'l-4-society');
    const nasa = put(s0, 'p2', 'nasa');
    expect(line(attack(s0, l4, nasa, 'control'), 'Attack', 'L-4 Society')).toBe(8);
  });
  it('+4 only against a Science group', () => {
    const s0 = scenario();
    const l4 = put(s0, 'p1', 'l-4-society');
    const ama = put(s0, 'p2', 'a-m-a');
    expect(line(attack(s0, l4, ama, 'control'), 'Attack', 'L-4 Society')).toBe(4);
  });
});

describe('Libertarians', () => {
  it('double the attacking Power when taking a Group from a Government master', () => {
    const s0 = scenario();
    const lib = put(s0, 'p1', 'libertarians');
    const cia = put(s0, 'p2', 'c-i-a');
    const d = put(s0, 'p2', 'dentists', cia);
    expect(line(attack(s0, lib, d, 'control'), 'Attack', 'Libertarians')).toBe(1);
  });
  it('nothing when the master is not Government', () => {
    const s0 = scenario();
    const lib = put(s0, 'p1', 'libertarians');
    const d = put(s0, 'p2', 'dentists');
    expect(line(attack(s0, lib, d, 'control'), 'Attack', 'Libertarians')).toBe(0);
  });
  it('take the Power of a Nation they capture', () => {
    const s0 = scenario();
    const lib = put(s0, 'p1', 'libertarians');
    const japan = put(s0, 'p2', 'japan');
    s0.cards[lib].mods.push({ source: 'test', kind: 'power', value: 40, until: 'permanent' });
    const s = resolve(attack(s0, lib, japan, 'control'), [1, 1]);
    expect(s.cards[japan].controller).toBe('p1');
    s.cards[lib].mods = s.cards[lib].mods.filter((m) => m.source !== 'test');
    expect(power(s, lib)).toBe(6);
  });
});

describe('Local Police Departments', () => {
  it('master gets +1 Power and +3 Resistance, other groups nothing', () => {
    const s = scenario();
    const mafia = put(s, 'p1', 'the-mafia');
    const kkk = put(s, 'p1', 'kkk');
    put(s, 'p1', 'local-police-departments', mafia);
    expect(power(s, mafia)).toBe(7);
    expect(resistance(s, mafia)).toBe(10);
    expect(power(s, kkk)).toBe(2);
  });
});

// ---------------------------------------------------------------- parts added with the newer hooks

const va = (s: GameState, attacker: string, target: string, attackType: AttackType) =>
  validateAttack(s, 'p1', { type: 'attack', attackType, attacker, target });

describe('Deprogrammers', () => {
  it('may attack the Discordian Society\'s Groups although they are Straight', () => {
    const s = scenario();
    s.cards[ill(s, 'p2')].cardId = 'discordian-society';
    const dp = put(s, 'p1', 'deprogrammers');
    const fb = put(s, 'p1', 'fred-birch-society');
    const gun = put(s, 'p2', 'gun-lobby');
    expect(va(s, dp, gun, 'destroy')).toBeNull();
    expect(va(s, fb, gun, 'destroy')).toMatch(/immune/);
  });
});

describe('Druids and Secret Groups', () => {
  it('may aid an attack on a Secret Magic Group, not on another Secret Group', () => {
    const s0 = scenario();
    const dr = put(s0, 'p1', 'druids');
    const vamp = put(s0, 'p2', 'vampires');
    const s = attack(s0, ill(s0, 'p1'), vamp, 'destroy');
    expect(canAid(s, 'p1', dr).ok).toBe(true);
    const s1 = scenario();
    const dr1 = put(s1, 'p1', 'druids');
    const sub = put(s1, 'p2', 'subliminals');
    const t = attack(s1, ill(s1, 'p1'), sub, 'destroy');
    expect(canAid(t, 'p1', dr1)).toMatchObject({ ok: false, why: expect.stringMatching(/Secret/) });
  });
  it('still cannot lead an attack on a Secret Magic Group', () => {
    const s = scenario();
    const dr = put(s, 'p1', 'druids');
    const vamp = put(s, 'p2', 'vampires');
    expect(va(s, dr, vamp, 'destroy')).toMatch(/Secret/);
  });
});

describe('Elders of Zion', () => {
  it('spend their action and an Illuminati action to move Groups for free', () => {
    const s0 = scenario();
    const ez = put(s0, 'p1', 'elders-of-zion');
    const mafia = put(s0, 'p1', 'the-mafia');
    const gun = put(s0, 'p1', 'gun-lobby');
    let s = use(s0, 'p1', ez, 'reorganize');
    expect(s.cards[ez].tokens).toBe(0);
    expect(s.cards[ill(s, 'p1')].tokens).toBe(0);
    s.cards[gun].tokens = 0; s.cards[mafia].tokens = 0;
    s = act(s, 'p1', { type: 'move', group: gun, onto: mafia, side: openArrows(s, mafia)[0], payWith: gun });
    expect(s.cards[gun].master).toBe(mafia);
  });
  it('need the Illuminati action too', () => {
    const s = scenario();
    const ez = put(s, 'p1', 'elders-of-zion');
    s.cards[ill(s, 'p1')].tokens = 0;
    expect(() => use(s, 'p1', ez, 'reorganize')).toThrow(/Illuminati/);
  });
});

describe('Evil Geniuses: linked Resources are locked', () => {
  it('a Resource linked to them cannot be moved', () => {
    const s0 = scenario();
    const eg = put(s0, 'p1', 'evil-geniuses-for-a-better-tomorrow');
    const cy = give(s0, 'p1', 'cyborg-soldiers', { hand: true });
    const s = use(s0, 'p1', eg, 'gadget', { target: cy });
    s.cards[cy].linkMovedTurn = undefined;
    expect(() => act(s, 'p1', { type: 'link', resource: cy, to: ill(s, 'p1') })).toThrow(/locked/);
  });
});

describe('Fred Birch Society', () => {
  function destroyed(s: GameState, ids: string[]) {
    for (const id of ids) {
      const g = give(s, 'p2', id, { hand: true });
      hand(s, 'p2').splice(hand(s, 'p2').indexOf(g), 1);
      s.cards[g].zone = 'destroyed';
      playerOf(s, 'p1').destroyedCredit.push(g);
    }
  }
  const LIBERAL = ['democrats', 'feminists', 'eff', 'big-media', 'black-activists'];
  it('counts as two Conservative Groups for Goal cards', () => {
    const s = scenario();
    destroyed(s, LIBERAL);
    put(s, 'p1', 'fred-birch-society');
    put(s, 'p1', 'gun-lobby');
    expect(GOALS['let-them-eat-cake'](s, 'p1')).toMatch(/3 Conservative/);
  });
  it('an ordinary Conservative Group counts once', () => {
    const s = scenario();
    destroyed(s, LIBERAL);
    put(s, 'p1', 'kkk');
    put(s, 'p1', 'gun-lobby');
    expect(GOALS['let-them-eat-cake'](s, 'p1')).toBeNull();
  });
  it('also counts twice when destroyed', () => {
    const run = (dead: string[]) => {
      const s = scenario();
      destroyed(s, dead);
      const placed = [ill(s, 'p1')];
      for (const id of LIBERAL) placed.push(put(s, 'p1', id, placed.find((m) => openArrows(s, m).length)));
      return GOALS['power-to-the-people'](s, 'p1');
    };
    expect(run(['fred-birch-society', 'kkk'])).toMatch(/3 Conservative/);
    expect(run(['gun-lobby', 'kkk'])).toBeNull();
  });
});

describe('Intellectuals: the Media master cannot be captured', () => {
  it('forbids an Attack to Control on it, not an Attack to Destroy', () => {
    const s = scenario();
    const mafia = put(s, 'p1', 'the-mafia');
    const comics = put(s, 'p2', 'comic-books');
    put(s, 'p2', 'intellectuals', comics);
    expect(va(s, mafia, comics, 'control')).toMatch(/Intellectuals/);
    expect(va(s, mafia, comics, 'destroy')).toBeNull();
  });
  it('a non-Media master may be captured', () => {
    const s = scenario();
    const mafia = put(s, 'p1', 'the-mafia');
    const kkk = put(s, 'p2', 'kkk');
    put(s, 'p2', 'intellectuals', kkk);
    expect(va(s, mafia, kkk, 'control')).toBeNull();
  });
});

describe('Junk Mail', () => {
  it('may attack a Secret Group, with +6 to control it', () => {
    const s0 = scenario();
    const jm = put(s0, 'p1', 'junk-mail');
    const sub = put(s0, 'p2', 'subliminals');
    expect(va(s0, jm, sub, 'control')).toBeNull();
    expect(line(attack(s0, jm, sub, 'control'), 'Attack', 'Junk Mail')).toBe(6);
  });
  it('other Groups still cannot; no bonus against a non-Secret Group', () => {
    const s0 = scenario();
    const jm = put(s0, 'p1', 'junk-mail');
    const mafia = put(s0, 'p1', 'the-mafia');
    const sub = put(s0, 'p2', 'subliminals');
    const gun = put(s0, 'p2', 'gun-lobby');
    expect(va(s0, mafia, sub, 'control')).toMatch(/Secret/);
    expect(line(attack(s0, jm, gun, 'control'), 'Attack', 'Junk Mail')).toBe(0);
  });
  it('may oppose an attack on a Secret Group', () => {
    const s0 = scenario();
    const sub = put(s0, 'p2', 'subliminals');
    const jm = put(s0, 'p2', 'junk-mail');
    const s = attack(s0, ill(s0, 'p1'), sub, 'destroy');
    expect(canOppose(s, 'p2', jm).ok).toBe(true);
  });
});

describe('Liquor Companies', () => {
  it('cancel the rival\'s next card draw, once', () => {
    const s0 = scenario();
    const lq = put(s0, 'p1', 'liquor-companies');
    const s = use(s0, 'p1', lq, 'dry', { target: ill(s0, 'p2') });
    expect(s.cards[lq].tokens).toBe(0);
    expect(drawPlot(s, playerOf(s, 'p2'))).toEqual([]);
    expect(drawPlot(s, playerOf(s, 'p2')).length).toBe(1);
  });
  it('one cancellation at a time; it lapses at the start of your next turn', () => {
    const s0 = scenario();
    const lq = put(s0, 'p1', 'liquor-companies');
    const s = use(s0, 'p1', lq, 'dry', { target: ill(s0, 'p2') });
    s.cards[lq].tokens = 1;
    expect(() => use(s, 'p1', lq, 'dry', { target: ill(s, 'p2') })).toThrow(/already/);
    // Your own draws are never affected.
    expect(drawPlot(s, playerOf(s, 'p1')).length).toBe(1);
  });
});

describe('International Cocaine Smugglers', () => {
  const ICS = 'International Cocaine Smugglers';
  it('+4 to any attempt to control the named Groups', () => {
    for (const id of ['punk-rockers', 'cycle-gangs', 'urban-gangs', 'hollywood', 'manuel-noriega']) {
      const s = scenario();
      const ics = put(s, 'p1', 'international-cocaine-smugglers');
      expect(line(attack(s, ics, put(s, 'p2', id), 'control'), 'Attack', ICS), id).toBe(4);
    }
    const s = scenario();
    put(s, 'p1', 'international-cocaine-smugglers');
    const mafia = put(s, 'p1', 'the-mafia');
    expect(line(attack(s, mafia, put(s, 'p2', 'hollywood'), 'control'), 'Attack', ICS)).toBe(4);
  });
  it('also to control a puppet of one of them', () => {
    const s = scenario();
    const ics = put(s, 'p1', 'international-cocaine-smugglers');
    const hollywood = put(s, 'p2', 'hollywood');
    expect(line(attack(s, ics, put(s, 'p2', 'loan-sharks', hollywood), 'control'), 'Attack', ICS)).toBe(4);
  });
  it('nothing against other Groups, or to destroy', () => {
    const s = scenario();
    const ics = put(s, 'p1', 'international-cocaine-smugglers');
    expect(line(attack(s, ics, put(s, 'p2', 'loan-sharks'), 'control'), 'Attack', ICS)).toBe(0);
    const s2 = scenario();
    const ics2 = put(s2, 'p1', 'international-cocaine-smugglers');
    expect(line(attack(s2, ics2, put(s2, 'p2', 'punk-rockers'), 'destroy'), 'Attack', ICS)).toBe(0);
  });
});

import { CARDS } from '../../src/engine';

describe('audit fixes', () => {
  const name = (id: string) => CARDS[id].name;

  describe('"any attempt" bonuses help every attack your Groups lead', () => {
    // [card with the bonus, target, attack type, bonus]
    const cases: [string, string, AttackType, number][] = [
      ['anti-nuclear-activists', 'fbi', 'destroy', 6], // Science
      ['anti-nuclear-activists', 'eco-guerrillas', 'control', 4], // Green
      ['anti-nuclear-activists', 'nuclear-power-companies', 'destroy', 10], // +10 instead of +6
      ['b-a-t-f', 'gun-lobby', 'control', 6],
      ['b-a-t-f', 'tobacco-companies', 'destroy', 6],
      ['big-media', 'madison-avenue', 'destroy', 4],
      ['black-activists', 'feminists', 'control', 2],
      ['clone-arrangers', 'dan-quayle', 'control', 4],
      ['deprogrammers', 'goldfish-fanciers', 'destroy', 4], // Fanatic only
      ['deprogrammers', 'reformed-church-of-satan', 'destroy', 8], // Weird and Fanatic
      ['fast-food-chains', 'eco-guerrillas', 'destroy', 6],
      ['fbi', 'loan-sharks', 'control', 2],
      ['fbi', 'loan-sharks', 'destroy', 4], // its +10 is direct only
      ['feminists', 'cfl-aio', 'control', 3],
      ['feminists', 'gun-lobby', 'destroy', 3],
      ['fiendish-fluoridators', 'dan-quayle', 'destroy', 5],
      ['international-communist-conspiracy', 'china', 'control', 3],
      ['l-4-society', 'moonbase', 'control', 4],
      ['l-4-society', 'fbi', 'destroy', 4],
      ['local-police-departments', 'loan-sharks', 'destroy', 4],
    ];
    for (const [id, target, type, value] of cases) {
      it(`${name(id)}: +${value} to ${type} ${name(target)} when another of your Groups leads`, () => {
        const s = scenario();
        put(s, 'p1', id);
        const mafia = put(s, 'p1', 'the-mafia');
        expect(line(attack(s, mafia, put(s, 'p2', target), type), 'Attack', name(id))).toBe(value);
      });
    }
    it('a rival\'s copy gives nothing to your attack', () => {
      const s = scenario();
      put(s, 'p2', 'black-activists');
      const mafia = put(s, 'p1', 'the-mafia');
      expect(line(attack(s, mafia, put(s, 'p2', 'feminists'), 'control'), 'Attack', 'Black Activists')).toBe(0);
    });
    it('a leader with a "direct" and an "any attempt" bonus uses the larger, not both', () => {
      const s = scenario();
      const l4 = put(s, 'p1', 'l-4-society');
      expect(line(attack(s, l4, put(s, 'p2', 'moonbase'), 'control'), 'Attack', 'L-4 Society')).toBe(8);
      const s2 = scenario();
      const ana = put(s2, 'p1', 'anti-nuclear-activists');
      expect(line(attack(s2, ana, put(s2, 'p2', 'nuclear-power-companies'), 'destroy'), 'Attack', 'Anti-Nuclear Activists')).toBe(10);
    });
    it('International Communist Conspiracy: +3 to control a puppet of a Communist master, whoever leads', () => {
      const s = scenario();
      put(s, 'p1', 'international-communist-conspiracy');
      const mafia = put(s, 'p1', 'the-mafia');
      const china = put(s, 'p2', 'china');
      const puppet = put(s, 'p2', 'dentists', china);
      expect(line(attack(s, mafia, puppet, 'control'), 'Attack', 'International Communist Conspiracy')).toBe(3);
    });
    it('Junk Mail: +6 when your Illuminati attacks to control a Secret Group', () => {
      const s = scenario();
      put(s, 'p1', 'junk-mail');
      const secret = put(s, 'p2', 'fiendish-fluoridators');
      expect(line(attack(s, ill(s, 'p1'), secret, 'control'), 'Attack', 'Junk Mail')).toBe(6);
    });
  });

  describe('CFL-AIO', () => {
    it('is Liberal and Corporate', () => {
      const s = scenario();
      const cfl = put(s, 'p1', 'cfl-aio');
      expect(alignments(s, cfl)).toEqual(expect.arrayContaining(['Liberal', 'Corporate']));
    });
    it('its direct +10 against a Corporate Group replaces the same-alignment penalty', () => {
      const s0 = scenario();
      const cfl = put(s0, 'p1', 'cfl-aio');
      const s = attack(s0, cfl, put(s0, 'p2', 'madison-avenue'), 'destroy');
      expect(line(s, 'Attack', 'CFL-AIO')).toBe(10);
      expect(line(s, 'Attack', 'alignments')).toBe(0);
    });
  });

  describe('Flat Earthers', () => {
    it('count only the Places you control', () => {
      const s = scenario();
      const fe = put(s, 'p1', 'flat-earthers');
      put(s, 'p1', 'hawaii');
      for (const p of ['switzerland', 'finland', 'moonbase']) put(s, 'p2', p);
      let seed = 0;
      for (let r = 1; r < 5000 && !seed; r++) {
        s.rng = r;
        const [a, b] = roll2d6(structuredClone(s));
        if (a + b <= 4) seed = r;
      }
      s.rng = seed;
      // With 4 Places in play the roll would pay off; with only 1 of them yours it does not.
      expect(hand(use(s, 'p1', fe, 'roll'), 'p1').length).toBe(0);
    });
  });

  describe('Gun Lobby', () => {
    it('draws a Plot even when the attack on your Conservative or Violent Group succeeds', () => {
      const s0 = scenario();
      const mafia = put(s0, 'p1', 'the-mafia');
      put(s0, 'p2', 'gun-lobby');
      const kkk = put(s0, 'p2', 'kkk');
      s0.cards[mafia].mods.push({ source: 'test', kind: 'power', value: 40, until: 'permanent' });
      const s = resolve(attack(s0, mafia, kkk, 'destroy'), [1, 1]);
      expect(s.cards[kkk].zone).toBe('destroyed');
      expect(hand(s, 'p2').length).toBe(1);
    });
    it('and when it is taken over', () => {
      const s0 = scenario();
      const mafia = put(s0, 'p1', 'the-mafia');
      put(s0, 'p2', 'gun-lobby');
      const kkk = put(s0, 'p2', 'kkk');
      s0.cards[mafia].mods.push({ source: 'test', kind: 'power', value: 40, until: 'permanent' });
      const s = resolve(attack(s0, mafia, kkk, 'control'), [1, 1]);
      expect(s.cards[kkk].controller).toBe('p1');
      expect(hand(s, 'p2').length).toBe(1);
    });
  });

  describe('Libertarians', () => {
    it('take the Power of a Government Place that is a U.S. state', () => {
      const s0 = scenario();
      const lib = put(s0, 'p1', 'libertarians');
      const texas = put(s0, 'p2', 'texas');
      s0.cards[lib].mods.push({ source: 'test', kind: 'power', value: 40, until: 'permanent' });
      const s = resolve(attack(s0, lib, texas, 'control'), [1, 1]);
      expect(s.cards[texas].controller).toBe('p1');
      s.cards[lib].mods = s.cards[lib].mods.filter((m) => m.source !== 'test');
      expect(power(s, lib)).toBe(6);
    });
    it('not of a state that is not a Government card', () => {
      const s0 = scenario();
      const lib = put(s0, 'p1', 'libertarians');
      const hawaii = put(s0, 'p2', 'hawaii');
      s0.cards[lib].mods.push({ source: 'test', kind: 'power', value: 40, until: 'permanent' });
      const s = resolve(attack(s0, lib, hawaii, 'control'), [1, 1]);
      expect(s.cards[hawaii].controller).toBe('p1');
      s.cards[lib].mods = s.cards[lib].mods.filter((m) => m.source !== 'test');
      expect(power(s, lib)).toBe(1);
    });
  });

  describe('A.M.A.', () => {
    it('may help attack a Science Group regardless of alignment, with +5', () => {
      const s0 = scenario();
      const mafia = put(s0, 'p1', 'the-mafia');
      const ama = put(s0, 'p1', 'a-m-a');
      let s = attack(s0, mafia, put(s0, 'p2', 'moonbase'), 'control');
      const can = canAid(s, 'p1', ama);
      expect(can.ok).toBe(true);
      expect(can.global).toBe(false);
      s = act(s, 'p1', { type: 'aid', group: ama });
      expect(line(s, 'Attack', 'A.M.A. ability')).toBe(5);
    });
    it('may help defend a Science Group regardless of alignment', () => {
      const s0 = scenario();
      const mafia = put(s0, 'p1', 'the-mafia');
      const ama = put(s0, 'p2', 'a-m-a');
      const s = attack(s0, mafia, put(s0, 'p2', 'moonbase'), 'destroy');
      const can = canOppose(s, 'p2', ama);
      expect(can.ok).toBe(true);
      expect(can.global).toBe(false);
    });
    it('no special help against a non-Science Group', () => {
      const s0 = scenario();
      const mafia = put(s0, 'p1', 'the-mafia');
      const ama = put(s0, 'p1', 'a-m-a');
      const s = attack(s0, mafia, put(s0, 'p2', 'las-vegas'), 'control');
      const can = canAid(s, 'p1', ama);
      expect(can.ok && !can.global).toBe(false);
    });
  });

  describe('Druids', () => {
    it('may link to a rival\'s Place and protect it against Disasters', () => {
      let s = scenario();
      const dr = put(s, 'p1', 'druids');
      const hawaii = put(s, 'p2', 'hawaii');
      s = use(s, 'p1', dr, 'link', { target: hawaii });
      disaster(s, 'p1', hawaii);
      expect(line(s, 'Defense', 'Druids')).toBe(8);
    });
  });

  describe('Eco-Guerrillas', () => {
    it('+6 when they lead an Attack to Destroy a Corporate Group', () => {
      const s = scenario();
      const eco = put(s, 'p1', 'eco-guerrillas');
      expect(line(attack(s, eco, put(s, 'p2', 'madison-avenue'), 'destroy'), 'Attack', 'Eco-Guerrillas')).toBe(6);
    });
    it('the +6 is direct: nothing when another Group leads', () => {
      const s = scenario();
      put(s, 'p1', 'eco-guerrillas');
      const mafia = put(s, 'p1', 'the-mafia');
      expect(line(attack(s, mafia, put(s, 'p2', 'madison-avenue'), 'destroy'), 'Attack', 'Eco-Guerrillas')).toBe(0);
    });
    it('+2 Resistance for all your Groups against a Corporate attacker', () => {
      const s = scenario();
      const mad = put(s, 'p1', 'madison-avenue');
      put(s, 'p2', 'eco-guerrillas');
      expect(line(attack(s, mad, put(s, 'p2', 'feminists'), 'control'), 'Defense', 'Eco-Guerrillas')).toBe(2);
    });
    it('Resistance does not count against an Attack to Destroy, or against other attackers', () => {
      const s = scenario();
      const mad = put(s, 'p1', 'madison-avenue');
      put(s, 'p2', 'eco-guerrillas');
      expect(line(attack(s, mad, put(s, 'p2', 'feminists'), 'destroy'), 'Defense', 'Eco-Guerrillas')).toBe(0);
      const s2 = scenario();
      const mafia = put(s2, 'p1', 'the-mafia');
      put(s2, 'p2', 'eco-guerrillas');
      expect(line(attack(s2, mafia, put(s2, 'p2', 'feminists'), 'control'), 'Defense', 'Eco-Guerrillas')).toBe(0);
    });
  });

  describe('Goldfish Fanciers', () => {
    it('Fanatic Groups cannot attack any Group in your Power Structure', () => {
      const s = scenario();
      const fanatic = put(s, 'p1', 'professional-sports');
      const other = put(s, 'p1', 'the-mafia');
      put(s, 'p2', 'goldfish-fanciers');
      const gun = put(s, 'p2', 'gun-lobby');
      expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: fanatic, target: gun })).toMatch(/immune/);
      expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'control', attacker: fanatic, target: gun })).toMatch(/immune/);
      expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: other, target: gun })).toBeNull();
    });
    it('no protection without the Goldfish Fanciers', () => {
      const s = scenario();
      const fanatic = put(s, 'p1', 'professional-sports');
      const gun = put(s, 'p2', 'gun-lobby');
      expect(validateAttack(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: fanatic, target: gun })).toBeNull();
    });
  });
});
