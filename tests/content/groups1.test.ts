// Scripted Group abilities from src/engine/content/groups1.ts.
import { describe, expect, it } from 'vitest';
import {
  applyAction, attackStrength, canAid, canOppose, currentOutcome, globalPower, isPrivileged, power, resistance,
  startInstantAttack, tokenBarred, waitingFor, HOOKS, CARDS, type Action, type GameState,
} from '../../src/engine';
import { roll2d6 } from '../../src/engine/rng';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const under = (s: GameState, pl: string, id: string, side: 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT' = 'BOTTOM', master?: string) =>
  give(s, pl, id, { under: master ?? ill(s, pl), side });
const hand = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.hand;

/** Pass for everyone until the attack is over, forcing the dice if given. */
function resolve(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 20 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = applyAction(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
/** Sum of the attack or defense lines credited to a card. */
function mod(s: GameState, side: 'Attack' | 'Defense', cardId: string): number {
  const name = CARDS[cardId].name;
  return attackStrength(s, s.attack!).lines
    .filter((l) => l.startsWith(side) && l.endsWith(`: ${name}`))
    .reduce((n, l) => n + Number(l.match(/[+-]\d+/)![0]), 0);
}
const use = (s: GameState, pl: string, card: string, ability: string, params = {}) =>
  act(s, pl, { type: 'useAbility', card, ability, params });
function instant(s: GameState, pl: string, target: string, opts: { assassination?: boolean; disaster?: boolean; plot?: string }) {
  const plot = give(s, pl, opts.plot ?? (opts.disaster ? 'earthquake' : 'sniper'), { hand: true });
  startInstantAttack(s, pl, {
    plot, target, power: 40, assassination: opts.assassination,
    disaster: opts.disaster ? { destroyMargin: null, devastateOnly: true } : undefined,
  });
  return s;
}

describe('MI-5', () => {
  it('turns all your exposed Plots face down', () => {
    const s = scenario();
    const mi5 = under(s, 'p1', 'mi-5');
    const p = give(s, 'p1', 'reload', { hand: true });
    s.cards[p].exposed = true;
    const next = use(s, 'p1', mi5, 'hidePlots');
    expect(next.cards[p].exposed).toBe(false);
    expect(next.cards[mi5].tokens).toBe(0);
  });
  it('needs an exposed Plot', () => {
    const s = scenario();
    const mi5 = under(s, 'p1', 'mi-5');
    give(s, 'p1', 'reload', { hand: true });
    expect(() => use(s, 'p1', mi5, 'hidePlots')).toThrow(/no exposed Plots/);
  });
});

describe('Moonies and Religious Reich interfere in Privileged attacks', () => {
  function privileged(attacker: string, rivalCard: string) {
    let s = scenario();
    const att = under(s, 'p1', attacker);
    const tgt = give(s, 'p1', 'loan-sharks', { hand: true });
    const card = under(s, 'p2', rivalCard);
    s = act(s, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    s.attack!.privileged = true;
    return { s, card };
  }
  it('Moonies join either side regardless of alignment and end the privilege', () => {
    const { s, card } = privileged('the-mafia', 'moonies');
    expect(waitingFor(s)).toContain('p2');
    const next = use(s, 'p2', card, 'interfere', { mode: 'oppose' });
    expect(isPrivileged(next.attack!)).toBe(false);
    expect(next.attack!.oppose.some((o) => o.iid === card)).toBe(true);
    expect(mod(next, 'Defense', 'moonies')).toBe(0); // counted as an opposing Group, not a modifier
    expect(attackStrength(next, next.attack!).lines.some((l) => l.includes('Moonies opposes'))).toBe(true);
  });
  it('Moonies can only interfere in a Privileged attack', () => {
    const { s, card } = privileged('the-mafia', 'moonies');
    s.attack!.privileged = false;
    expect(() => use(s, 'p2', card, 'interfere', { mode: 'oppose' })).toThrow(/Privileged/);
  });
  it('Religious Reich interferes when a Straight or Conservative Group attacks', () => {
    const { s, card } = privileged('big-media', 'religious-reich');
    const next = use(s, 'p2', card, 'interfere', { mode: 'oppose' });
    expect(isPrivileged(next.attack!)).toBe(false);
    expect(next.attack!.oppose.some((o) => o.iid === card)).toBe(true);
  });
  it('Religious Reich cannot interfere with other attackers', () => {
    const { s, card } = privileged('the-mafia', 'religious-reich');
    expect(waitingFor(s)).not.toContain('p2');
    expect(() => use(s, 'p2', card, 'interfere', { mode: 'oppose' })).toThrow();
  });
});

describe('NASA', () => {
  it('passes its Action token to another Government Group', () => {
    const s = scenario();
    const nasa = under(s, 'p1', 'nasa');
    const gov = under(s, 'p1', 'supreme-court', 'RIGHT');
    s.cards[gov].tokens = 0;
    const next = use(s, 'p1', nasa, 'transferToken', { target: gov });
    expect(next.cards[nasa].tokens).toBe(0);
    expect(next.cards[gov].tokens).toBe(1);
  });
  it('only to a Government Group without a token', () => {
    const s = scenario();
    const nasa = under(s, 'p1', 'nasa');
    const other = under(s, 'p1', 'urban-gangs', 'RIGHT');
    s.cards[other].tokens = 0;
    expect(() => use(s, 'p1', nasa, 'transferToken', { target: other })).toThrow(/Government/);
  });
});

describe('NATO', () => {
  it('opposes attacks on Nations with its full Power', () => {
    let s = scenario();
    const att = under(s, 'p1', 'the-mafia');
    const japan = under(s, 'p2', 'japan');
    const nato = under(s, 'p2', 'nato', 'RIGHT');
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: japan });
    expect(canOppose(s, 'p2', nato)).toMatchObject({ ok: true, global: false });
  });
  it('uses only Global Power when no Nation is involved', () => {
    let s = scenario();
    const att = under(s, 'p1', 'the-mafia');
    const tgt = under(s, 'p2', 'las-vegas');
    const nato = under(s, 'p2', 'nato', 'RIGHT');
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    expect(canOppose(s, 'p2', nato)).toMatchObject({ ok: true, global: true });
  });
});

describe('Nephews of God', () => {
  it('a roll of 6 or less at the start of the turn allows one extra card from either deck', () => {
    const s = scenario();
    const n = under(s, 'p1', 'nephews-of-god');
    for (let i = 0; i < 10; i++) {
      const probe = structuredClone(s);
      const d = roll2d6(probe);
      HOOKS['nephews-of-god'].onTurnStart!(s, n);
      expect(s.cards[n].data?.extraDrawTurn).toBe(d[0] + d[1] <= 6 ? s.turn : undefined);
    }
    s.cards[n].data = { extraDrawTurn: s.turn };
    const before = hand(s, 'p1').length;
    const next = use(s, 'p1', n, 'extraDraw', { mode: 'group' });
    expect(hand(next, 'p1').length).toBe(before + 1);
    expect(() => use(next, 'p1', n, 'extraDraw', { mode: 'plot' })).toThrow();
  });
  it('no extra card without a good roll', () => {
    const s = scenario();
    const n = under(s, 'p1', 'nephews-of-god');
    expect(() => use(s, 'p1', n, 'extraDraw', { mode: 'plot' })).toThrow(/did not roll/);
  });
});

describe('Ninjas', () => {
  it('+4 to your Assassinations', () => {
    const s = scenario();
    under(s, 'p1', 'ninjas');
    instant(s, 'p1', under(s, 'p2', 'dan-quayle'), { assassination: true });
    expect(mod(s, 'Attack', 'ninjas')).toBe(4);
  });
  it('a rival\'s Ninjas do not help your Assassination', () => {
    const s = scenario();
    under(s, 'p2', 'ninjas', 'RIGHT');
    instant(s, 'p1', under(s, 'p2', 'dan-quayle'), { assassination: true });
    expect(mod(s, 'Attack', 'ninjas')).toBe(0);
  });
  it('gain an Action token when an attack on them fails', () => {
    let s = scenario();
    const att = under(s, 'p1', 'the-mafia');
    const ninjas = under(s, 'p2', 'ninjas');
    s = act(s, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: ninjas });
    s = resolve(s, [6, 6]);
    expect(s.cards[ninjas].tokens).toBe(2);
  });
  it('gain nothing when another Group is attacked', () => {
    let s = scenario();
    const att = under(s, 'p1', 'the-mafia');
    const ninjas = under(s, 'p2', 'ninjas');
    const other = under(s, 'p2', 'loan-sharks', 'RIGHT');
    s = act(s, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: other });
    s = resolve(s, [6, 6]);
    expect(s.cards[ninjas].tokens).toBe(1);
  });
});

describe('cancelling actions (Nuclear Power Companies, Savings and Loans, Supreme Court)', () => {
  function attackOn(attacker: string, canceller: string) {
    let s = scenario();
    const att = under(s, 'p1', attacker);
    const tgt = under(s, 'p2', 'las-vegas');
    const c = under(s, 'p2', canceller, 'RIGHT');
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    return { s, att, tgt, c };
  }
  it('Nuclear Power Companies cancel the attacking Group\'s action', () => {
    const { s, att, tgt, c } = attackOn('the-mafia', 'nuclear-power-companies');
    s.attack!.attackBonus.push({ player: 'p1', amount: 40, label: 'test' });
    let next = use(s, 'p2', c, 'cancelAction', { target: att });
    expect(currentOutcome(next, next.attack!)).toBe('failure');
    next = resolve(next, [2, 2]);
    expect(next.cards[tgt].zone).toBe('structure');
  });
  it('Nuclear Power Companies can only cancel a Group acting in the attack', () => {
    const { s, c } = attackOn('the-mafia', 'nuclear-power-companies');
    const idle = under(s, 'p1', 'urban-gangs', 'RIGHT');
    expect(() => use(s, 'p2', c, 'cancelAction', { target: idle })).toThrow(/not taking an action/);
    expect(() => use(s, 'p2', c, 'cancelAction', { target: c })).toThrow();
  });
  it('Supreme Court cancels a Government Group\'s action', () => {
    const { s, att, c } = attackOn('c-i-a', 'supreme-court');
    const next = use(s, 'p2', c, 'cancelAction', { target: att });
    expect(currentOutcome(next, next.attack!)).toBe('failure');
  });
  it('Supreme Court cannot cancel a non-Government Group', () => {
    const { s, att, c } = attackOn('the-mafia', 'supreme-court');
    expect(() => use(s, 'p2', c, 'cancelAction', { target: att })).toThrow(/cannot be cancelled/);
  });
  it('Savings and Loans cancel a Government Group\'s action but not a Criminal one', () => {
    const a = attackOn('c-i-a', 'savings-and-loans');
    expect(() => use(a.s, 'p2', a.c, 'cancelAction', { target: a.att })).not.toThrow();
    const b = attackOn('the-mafia', 'savings-and-loans');
    expect(() => use(b.s, 'p2', b.c, 'cancelAction', { target: b.att })).toThrow(/cannot be cancelled/);
  });
  it('Savings and Loans get +3 to control Corporate, Government or Bank Groups', () => {
    const s = scenario();
    const sl = under(s, 'p1', 'savings-and-loans');
    const corp = under(s, 'p2', 'liquor-companies');
    const weird = under(s, 'p2', 'gay-activists', 'RIGHT');
    let a = act(s, 'p1', { type: 'attack', attackType: 'control', attacker: sl, target: corp });
    expect(mod(a, 'Attack', 'savings-and-loans')).toBe(3);
    a = act(s, 'p1', { type: 'attack', attackType: 'control', attacker: sl, target: weird });
    expect(mod(a, 'Attack', 'savings-and-loans')).toBe(0);
  });
});

describe('Offshore Banks', () => {
  function destroy(attacker: string) {
    let s = scenario();
    const att = under(s, 'p1', attacker);
    const banks = under(s, 'p2', 'offshore-banks');
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: banks });
    s.attack!.attackBonus.push({ player: 'p1', amount: 40, label: 'test' });
    return { s, banks };
  }
  it('cannot be destroyed by a Government Group', () => {
    const { s, banks } = destroy('c-i-a');
    expect(resolve(s, [2, 2]).cards[banks].zone).toBe('structure');
  });
  it('Government Groups cannot aid an attack to destroy it', () => {
    const { s } = destroy('moonies');
    const cia = under(s, 'p1', 'c-i-a', 'RIGHT');
    expect(canAid(s, 'p1', cia).ok).toBe(false);
  });
  it('other Groups can destroy it', () => {
    const { s, banks } = destroy('moonies');
    expect(resolve(s, [2, 2]).cards[banks].zone).toBe('destroyed');
  });
});

describe('OPEC', () => {
  it('Power is 2d6-2 on takeover, +1 with Texas and +1 with Multinational Oil Companies', () => {
    const s = scenario();
    const opec = under(s, 'p1', 'opec');
    const probe = structuredClone(s);
    const d = roll2d6(probe);
    HOOKS['opec'].onEnterPlay!(s, opec);
    expect(power(s, opec)).toBe(d[0] + d[1] - 2);

    under(s, 'p1', 'texas', 'RIGHT');
    under(s, 'p1', 'multinational-oil-companies', 'LEFT');
    const probe2 = structuredClone(s);
    const d2 = roll2d6(probe2);
    HOOKS['opec'].onTurnStart!(s, opec);
    expect(power(s, opec)).toBe(d2[0] + d2[1]);
    expect(s.cards[opec].mods.filter((m) => m.source === opec)).toHaveLength(1);
  });
});

describe('Paranoids', () => {
  it('+2 for the structure against Assassinations, not Disasters', () => {
    const s = scenario();
    under(s, 'p2', 'paranoids', 'RIGHT');
    const pers = under(s, 'p2', 'dan-quayle');
    instant(s, 'p1', pers, { assassination: true });
    expect(mod(s, 'Defense', 'paranoids')).toBe(2);
    const s2 = scenario();
    under(s2, 'p2', 'paranoids', 'RIGHT');
    instant(s2, 'p1', under(s2, 'p2', 'las-vegas'), { disaster: true });
    expect(mod(s2, 'Defense', 'paranoids')).toBe(0);
  });
  it('get no tokens and cannot be destroyed while their Power is 0', () => {
    let s = scenario();
    const att = under(s, 'p1', 'the-mafia');
    const par = under(s, 'p2', 'paranoids');
    expect(tokenBarred(s, par)).toBe(true);
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: par });
    s.attack!.attackBonus.push({ player: 'p1', amount: 40, label: 'test' });
    expect(resolve(s, [2, 2]).cards[par].zone).toBe('structure');
  });
  it('can be destroyed once something gives them Power', () => {
    let s = scenario();
    const att = under(s, 'p1', 'the-mafia');
    const par = under(s, 'p2', 'paranoids');
    s.cards[par].mods.push({ source: 'test', kind: 'power', value: 1, until: 'permanent' });
    expect(tokenBarred(s, par)).toBe(false);
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: par });
    s.attack!.attackBonus.push({ player: 'p1', amount: 40, label: 'test' });
    expect(resolve(s, [2, 2]).cards[par].zone).toBe('destroyed');
  });
});

describe('Phone Company and Post Office expose rival cards', () => {
  it('Phone Company exposes two random hidden rival Plots', () => {
    const s = scenario();
    const pc = under(s, 'p1', 'phone-company');
    const plots = [1, 2, 3].map(() => give(s, 'p2', 'reload', { hand: true }));
    const next = use(s, 'p1', pc, 'expose');
    expect(plots.filter((p) => next.cards[p].exposed)).toHaveLength(2);
  });
  it('Phone Company needs hidden rival Plots', () => {
    const s = scenario();
    const pc = under(s, 'p1', 'phone-company');
    give(s, 'p2', 'loan-sharks', { hand: true });
    expect(() => use(s, 'p1', pc, 'expose')).toThrow(/no hidden Plot/);
  });
  it('Post Office exposes two random rival Group cards, not Plots', () => {
    const s = scenario();
    const po = under(s, 'p1', 'post-office');
    const groups = ['loan-sharks', 'gay-activists', 'boy-sprouts'].map((g) => give(s, 'p2', g, { hand: true }));
    const plot = give(s, 'p2', 'reload', { hand: true });
    const next = use(s, 'p1', po, 'expose');
    expect(groups.filter((g) => next.cards[g].exposed)).toHaveLength(2);
    expect(next.cards[plot].exposed).toBeFalsy();
  });
});

describe('Pollsters', () => {
  function attack(aid: boolean) {
    let s = scenario();
    const att = under(s, 'p1', 'big-media');
    const pol = under(s, 'p1', 'pollsters', 'RIGHT');
    const tgt = under(s, 'p2', 'gay-activists');
    s = act(s, 'p1', { type: 'attack', attackType: 'control', attacker: att, target: tgt });
    if (aid) s = act(s, 'p1', { type: 'aid', group: pol });
    return s;
  }
  it('cancel the alignment penalty of the side they help', () => {
    const s = attack(true);
    expect(attackStrength(s, s.attack!).lines).toContain('Attack -4: alignments');
    expect(mod(s, 'Attack', 'pollsters')).toBe(4);
  });
  it('do nothing when not involved', () => {
    expect(mod(attack(false), 'Attack', 'pollsters')).toBe(0);
  });
});

describe('Professional Sports', () => {
  it('a Personality linked to it gets +3 Power', () => {
    const s = scenario();
    const ps = under(s, 'p1', 'professional-sports');
    const pers = give(s, 'p1', 'dan-quayle', { under: ps, side: 'RIGHT' });
    const other = under(s, 'p1', 'bill-clinton', 'TOP');
    expect(power(s, pers)).toBe(1 + 3);
    expect(power(s, other)).toBe(4);
  });
});

describe('Psychiatrists', () => {
  it('+6 to destroy a Personality, except in a Privileged attack', () => {
    let s = scenario();
    const psy = under(s, 'p1', 'psychiatrists');
    const pers = under(s, 'p2', 'dan-quayle');
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: psy, target: pers });
    expect(mod(s, 'Attack', 'psychiatrists')).toBe(6);
    s.attack!.privileged = true;
    expect(mod(s, 'Attack', 'psychiatrists')).toBe(0);
  });
  it('force the discard of an exposed non-Goal Plot', () => {
    const s = scenario();
    const psy = under(s, 'p1', 'psychiatrists');
    const plot = give(s, 'p2', 'reload', { hand: true });
    const goal = give(s, 'p2', 'fratricide', { hand: true });
    s.cards[plot].exposed = true; s.cards[goal].exposed = true;
    expect(() => use(s, 'p1', psy, 'discardExposed', { target: goal })).toThrow(/Goal/);
    const next = use(s, 'p1', psy, 'discardExposed', { target: plot });
    expect(next.cards[plot].zone).toBe('discard');
  });
});

describe('Recording Industry', () => {
  it('your Media Personalities +2 Power, other Personalities +1; not a rival\'s', () => {
    const s = scenario();
    const media = under(s, 'p1', 'ronald-reagan');
    const plain = under(s, 'p1', 'dan-quayle', 'RIGHT');
    const rival = under(s, 'p2', 'bill-clinton');
    const before = [media, plain, rival].map((g) => power(s, g));
    under(s, 'p1', 'recording-industry', 'LEFT');
    expect([media, plain, rival].map((g) => power(s, g))).toEqual([before[0] + 2, before[1] + 1, before[2]]);
  });
});

describe('Red Cross', () => {
  it('+6 against Disasters and its master gets automatic Relief', () => {
    let s = scenario();
    const place = under(s, 'p2', 'las-vegas');
    give(s, 'p2', 'red-cross', { under: place, side: 'LEFT' });
    instant(s, 'p1', place, { disaster: true });
    expect(mod(s, 'Defense', 'red-cross')).toBe(6);
    s = resolve(s, [2, 2]);
    expect(s.log.some((l) => l.text.includes('Devastated'))).toBe(true);
    expect(s.cards[place].devastated).toBe(false);
  });
  it('as an action sends Relief to a Devastated Place only', () => {
    const s = scenario();
    const rc = under(s, 'p1', 'red-cross');
    const place = under(s, 'p2', 'las-vegas');
    expect(() => use(s, 'p1', rc, 'relief', { target: place })).toThrow(/Devastated/);
    s.cards[place].devastated = true;
    expect(use(s, 'p1', rc, 'relief', { target: place }).cards[place].devastated).toBe(false);
  });
  it('no Disaster bonus against normal attacks', () => {
    let s = scenario();
    const att = under(s, 'p1', 'the-mafia');
    const place = under(s, 'p2', 'las-vegas');
    give(s, 'p2', 'red-cross', { under: place, side: 'LEFT' });
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: place });
    expect(mod(s, 'Defense', 'red-cross')).toBe(0);
  });
});

describe('Reformed Church of Satan', () => {
  it('Straight Groups cannot attack your other Groups, but may attack the Church', () => {
    const s = scenario();
    const att = under(s, 'p1', 'big-media');
    const church = under(s, 'p2', 'reformed-church-of-satan');
    const other = under(s, 'p2', 'gay-activists', 'RIGHT');
    expect(() => act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: other })).toThrow(/immune/);
    expect(() => act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: church })).not.toThrow();
  });
});

describe('Republicans', () => {
  it('+5 to control Government Groups that are not Nations', () => {
    const s = scenario();
    const rep = under(s, 'p1', 'republicans');
    const fbi = under(s, 'p2', 'fbi');
    const japan = under(s, 'p2', 'japan', 'RIGHT');
    expect(mod(act(s, 'p1', { type: 'attack', attackType: 'control', attacker: rep, target: fbi }), 'Attack', 'republicans')).toBe(5);
    expect(mod(act(s, 'p1', { type: 'attack', attackType: 'control', attacker: rep, target: japan }), 'Attack', 'republicans')).toBe(0);
  });
});

describe('Robot Sea Monsters', () => {
  it('+4 to your Disasters on Coastal Places, except Space Disasters', () => {
    const s = scenario();
    under(s, 'p1', 'robot-sea-monsters');
    instant(s, 'p1', under(s, 'p2', 'japan'), { disaster: true });
    expect(mod(s, 'Attack', 'robot-sea-monsters')).toBe(4);
    const s2 = scenario();
    under(s2, 'p1', 'robot-sea-monsters');
    instant(s2, 'p1', under(s2, 'p2', 'japan'), { disaster: true, plot: 'meteor-strike' });
    expect(mod(s2, 'Attack', 'robot-sea-monsters')).toBe(0);
  });
});

describe('Science Fiction Fans', () => {
  it('their master gets +6 to control Computer Groups', () => {
    const s = scenario();
    const mafia = under(s, 'p1', 'the-mafia');
    give(s, 'p1', 'science-fiction-fans', { under: mafia, side: 'LEFT' });
    const tgt = under(s, 'p2', 'video-games');
    expect(mod(act(s, 'p1', { type: 'attack', attackType: 'control', attacker: mafia, target: tgt }), 'Attack', 'science-fiction-fans')).toBe(6);
  });
  it('no bonus for a Group that is not their master', () => {
    const s = scenario();
    const mafia = under(s, 'p1', 'the-mafia');
    under(s, 'p1', 'science-fiction-fans', 'RIGHT');
    const tgt = under(s, 'p2', 'video-games');
    expect(mod(act(s, 'p1', { type: 'attack', attackType: 'control', attacker: mafia, target: tgt }), 'Attack', 'science-fiction-fans')).toBe(0);
  });
});

describe('Secret Service and Urban Gangs on Assassinations', () => {
  it('Secret Service: +10 to assassinate a Government Personality only', () => {
    const s = scenario();
    under(s, 'p1', 'secret-service');
    instant(s, 'p1', under(s, 'p2', 'bill-clinton'), { assassination: true });
    expect(mod(s, 'Attack', 'secret-service')).toBe(10);
    const s2 = scenario();
    under(s2, 'p1', 'secret-service');
    instant(s2, 'p1', under(s2, 'p2', 'dan-quayle'), { assassination: true });
    expect(mod(s2, 'Attack', 'secret-service')).toBe(0);
  });
  it('Urban Gangs: +2 to Assassinations, not Disasters', () => {
    const s = scenario();
    under(s, 'p1', 'urban-gangs');
    instant(s, 'p1', under(s, 'p2', 'dan-quayle'), { assassination: true });
    expect(mod(s, 'Attack', 'urban-gangs')).toBe(2);
    const s2 = scenario();
    under(s2, 'p1', 'urban-gangs');
    instant(s2, 'p1', under(s2, 'p2', 'las-vegas'), { disaster: true });
    expect(mod(s2, 'Attack', 'urban-gangs')).toBe(0);
  });
});

describe('Secular Humanists', () => {
  it('Straight attacks on your other Groups are -3, not on the Humanists themselves', () => {
    const s = scenario();
    const att = under(s, 'p1', 'big-media');
    const sh = under(s, 'p2', 'secular-humanists', 'RIGHT');
    const other = under(s, 'p2', 'gay-activists');
    expect(mod(act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: other }), 'Attack', 'secular-humanists')).toBe(-3);
    expect(mod(act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: sh }), 'Attack', 'secular-humanists')).toBe(0);
  });
});

describe('S.M.O.F.', () => {
  it('once per turn removes an Action token from a rival Weird Group', () => {
    const s = scenario();
    const smof = under(s, 'p1', 's-m-o-f');
    const w1 = under(s, 'p2', 'gay-activists');
    const w2 = under(s, 'p2', 'conspiracy-theorists', 'RIGHT');
    const next = use(s, 'p1', smof, 'removeToken', { target: w1 });
    expect(next.cards[w1].tokens).toBe(0);
    expect(next.cards[smof].tokens).toBe(1);
    expect(() => use(next, 'p1', smof, 'removeToken', { target: w2 })).toThrow(/Already used/);
  });
  it('only Weird Groups', () => {
    const s = scenario();
    const smof = under(s, 'p1', 's-m-o-f');
    const g = under(s, 'p2', 'loan-sharks');
    expect(() => use(s, 'p1', smof, 'removeToken', { target: g })).toThrow(/Weird/);
  });
});

describe('Society for Creative Anarchism', () => {
  it('forces a rival to discard the top Group card of his deck', () => {
    const s = scenario();
    const sca = under(s, 'p1', 'society-for-creative-anarchism');
    const top = s.players[1].groupDeck[0];
    const next = use(s, 'p1', sca, 'discardTopGroup');
    expect(next.cards[top].zone).toBe('discard');
    expect(next.players[1].discard).toContain(top);
  });
  it('needs cards in that deck', () => {
    const s = scenario();
    const sca = under(s, 'p1', 'society-for-creative-anarchism');
    s.players[1].groupDeck = [];
    expect(() => use(s, 'p1', sca, 'discardTopGroup')).toThrow(/empty/);
  });
});

describe('Constant Power and Resistance changes', () => {
  it('South American Nazis: Weird Science puppets +3 Power', () => {
    const s = scenario();
    const san = under(s, 'p1', 'south-american-nazis');
    const puppet = give(s, 'p1', 'l-4-society', { under: san, side: 'LEFT' });
    const other = under(s, 'p1', 'evil-geniuses-for-a-better-tomorrow', 'RIGHT');
    expect(power(s, puppet)).toBe(1 + 3);
    expect(power(s, other)).toBe(2);
  });
  it('Subliminals: Power and Global Power +1 per Media Group', () => {
    const s = scenario();
    const sub = under(s, 'p1', 'subliminals');
    expect(globalPower(s, sub)).toBe(2);
    under(s, 'p1', 'cable-tv', 'RIGHT');
    expect(power(s, sub)).toBe(3);
    expect(globalPower(s, sub)).toBe(3);
  });
  it('TV Preachers: puppets +5 Resistance, other Groups unchanged', () => {
    const s = scenario();
    const tv = under(s, 'p1', 'tv-preachers');
    const puppet = give(s, 'p1', 'loan-sharks', { under: tv, side: 'LEFT' });
    const other = under(s, 'p1', 'gay-activists', 'RIGHT');
    expect(resistance(s, puppet)).toBe((CARDS['loan-sharks'].resistance ?? 0) + 5);
    expect(resistance(s, other)).toBe(CARDS['gay-activists'].resistance);
  });
  it('Video Games: your other Computer Groups +1 Power', () => {
    const s = scenario();
    const vg = under(s, 'p1', 'video-games');
    const comp = under(s, 'p1', 'phone-company', 'RIGHT');
    const rival = under(s, 'p2', 'post-office');
    expect(power(s, comp)).toBe(5 + 1);
    expect(power(s, vg)).toBe(2);
    expect(power(s, rival)).toBe(4);
  });
});

describe('Survivalists', () => {
  it('+3 against Disasters and automatic Relief for their master at the start of your turn', () => {
    const s = scenario();
    const place = under(s, 'p1', 'las-vegas');
    const surv = give(s, 'p1', 'survivalists', { under: place, side: 'LEFT' });
    s.cards[place].devastated = true;
    HOOKS['survivalists'].onTurnStart!(s, surv);
    expect(s.cards[place].devastated).toBe(false);
    s.active = 1;
    instant(s, 'p2', place, { disaster: true });
    expect(mod(s, 'Defense', 'survivalists')).toBe(3);
  });
  it('no bonus against normal attacks', () => {
    let s = scenario();
    const att = under(s, 'p1', 'the-mafia');
    under(s, 'p2', 'survivalists', 'RIGHT');
    const place = under(s, 'p2', 'las-vegas');
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: place });
    expect(mod(s, 'Defense', 'survivalists')).toBe(0);
  });
});

describe('Templars', () => {
  it('force the discard of any exposed rival Plot, not a hidden one', () => {
    const s = scenario();
    const t = under(s, 'p1', 'templars');
    const goal = give(s, 'p2', 'fratricide', { hand: true });
    const hidden = give(s, 'p2', 'reload', { hand: true });
    s.cards[goal].exposed = true;
    expect(() => use(s, 'p1', t, 'discardExposed', { target: hidden })).toThrow(/exposed/);
    expect(use(s, 'p1', t, 'discardExposed', { target: goal }).cards[goal].zone).toBe('discard');
  });
});

describe('The Men in Black', () => {
  function destroyWith(attacker: string) {
    let s = scenario();
    const att = under(s, 'p1', attacker);
    const tgt = under(s, 'p2', 'loan-sharks');
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    s.attack!.attackBonus.push({ player: 'p1', amount: 40, label: 'test' });
    s = resolve(s, [2, 2]);
    return s.cards[tgt];
  }
  it('Groups they destroy are removed from the game', () => {
    const c = destroyWith('the-men-in-black');
    expect(c.zone).toBe('destroyed');
    expect(c.data?.removedFromGame).toBe(true);
  });
  it('not Groups destroyed by others', () => {
    expect(destroyWith('the-mafia').data?.removedFromGame).toBeUndefined();
  });
});

describe('Tobacco Companies and Trekkies', () => {
  it('Green Groups get +4 to destroy Tobacco Companies; others do not', () => {
    const s = scenario();
    const green = under(s, 'p1', 'underground-newspapers');
    const mafia = under(s, 'p1', 'the-mafia', 'RIGHT');
    const tob = under(s, 'p2', 'tobacco-companies');
    expect(mod(act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: green, target: tob }), 'Attack', 'tobacco-companies')).toBe(4);
    expect(mod(act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: mafia, target: tob }), 'Attack', 'tobacco-companies')).toBe(0);
  });
  it('Media Groups get +4 to control Trekkies, not to destroy them', () => {
    const s = scenario();
    const media = under(s, 'p1', 'cable-tv');
    const trek = under(s, 'p2', 'trekkies');
    expect(mod(act(s, 'p1', { type: 'attack', attackType: 'control', attacker: media, target: trek }), 'Attack', 'trekkies')).toBe(4);
    expect(mod(act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: media, target: trek }), 'Attack', 'trekkies')).toBe(0);
  });
});

describe('Underground Newspapers', () => {
  function destroy(target: string, aid: boolean) {
    let s = scenario();
    const att = under(s, 'p1', 'the-mafia');
    const un = under(s, 'p1', 'underground-newspapers', 'RIGHT');
    const tgt = under(s, 'p2', target);
    const before = hand(s, 'p1').length;
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    if (aid) s = act(s, 'p1', { type: 'aid', group: un });
    s.attack!.attackBonus.push({ player: 'p1', amount: 40, label: 'test' });
    s = resolve(s, [2, 2]);
    expect(s.cards[tgt].zone).toBe('destroyed');
    return hand(s, 'p1').length - before;
  }
  it('draw a Plot when they help destroy a Corporate Group', () => {
    expect(destroy('liquor-companies', true)).toBe(destroy('liquor-companies', false) + 1);
  });
  it('not for other Groups', () => {
    expect(destroy('gay-activists', true)).toBe(destroy('gay-activists', false));
  });
});
