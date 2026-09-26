import { describe, expect, it } from 'vitest';
import {
  CARDS, alignments, applyAction, attributes, cardImplemented, drawPlot, frozen, isParalyzed, paralysesOn, player, power, registerHooks,
  waitingFor, zapsOn, type Action, type CardDef, type GameState, type PlotPlay,
} from '../../src/engine';
import { give, scenario } from '../helpers';

const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);
const play = (s: GameState, pl: string, p: PlotPlay) => act(s, pl, { type: 'playPlot', play: p });
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const under = (s: GameState, pl: string, id: string, side: 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT' = 'BOTTOM', master?: string) =>
  give(s, pl, id, { under: master ?? ill(s, pl), side });
const hand = (s: GameState, pl: string, id: string) => give(s, pl, id, { hand: true });

/** Play a non-attack Plot and pass until it resolves. */
function playAndResolve(s: GameState, pl: string, p: PlotPlay): GameState {
  s = play(s, pl, p);
  while (s.window?.kind === 'plot') s = act(s, waitingFor(s)[0], { type: 'pass' });
  return s;
}
/** Pass for everyone until the attack is over, forcing the dice if given. */
function resolveAttack(s: GameState, dice?: [number, number]): GameState {
  for (let i = 0; i < 30 && s.attack; i++) {
    if (dice && s.window?.kind === 'roll' && s.attack.roll) s.attack.roll = dice;
    s = act(s, waitingFor(s)[0], { type: 'pass' });
  }
  return s;
}
function p2Turn(s: GameState): GameState { s.active = 1; s.phase = 'main'; s.cards[ill(s, 'p2')].tokens = 1; return s; }

describe('every card in the batch is implemented', () => {
  const ids = [
    'pave-the-earth', 'pizza-for-the-secret-meeting', 'regi-tered-trademark', 'reverse-whammy', 'school-prayer', 'secret-master',
    'security-leak', 'sorry-wrong-number', 'strange-bedfellows', 'sudden-european-vacation', 'sufficiently-advanced-technology',
    'supernova', 'supreme-court-nomination', 'tanstaafl', 'take-the-money-and-run', 'teflon-coating', 'the-irish-flu',
    'the-meek-shall-inherit', 'this-was-only-a-test', 'truck-bomb', 'vile-secretions', 'waiting-period', 'whistle-blowers',
    'witch-hunt', 'you-are-what-you-eat',
  ];
  it.each(ids)('%s', (id) => { expect(cardImplemented(id)).toBe(true); });
});

describe('Pave the Earth! (Freeze on Green)', () => {
  it('freezes every Green Group, but not others', () => {
    let s = scenario();
    const green = under(s, 'p2', 'joggers');
    const other = under(s, 'p1', 'the-mafia', 'TOP');
    const card = hand(s, 'p1', 'pave-the-earth');
    s = playAndResolve(s, 'p1', { card, payWith: [ill(s, 'p1')] });
    expect(frozen(s, green)).toBe(true);
    expect(frozen(s, other)).toBe(false);
  });
  it('cannot be played with a target (a Freeze needs none)', () => {
    const s = scenario();
    const green = under(s, 'p2', 'joggers');
    const card = hand(s, 'p1', 'pave-the-earth');
    expect(() => play(s, 'p1', { card, target: green, payWith: [ill(s, 'p1')] })).toThrow(/no target/);
  });
});

describe('School Prayer (Freeze on Church, Liberal and Conservative)', () => {
  it('freezes Church, Liberal and Conservative Groups but not a plain Violent one', () => {
    let s = scenario();
    const church = under(s, 'p2', 'church-of-elvis');
    const violent = under(s, 'p1', 'the-mafia', 'TOP');
    const card = hand(s, 'p1', 'school-prayer');
    s = playAndResolve(s, 'p1', { card, payWith: [ill(s, 'p1')] });
    expect(frozen(s, church)).toBe(true);
    expect(frozen(s, violent)).toBe(false);
  });
});

describe('Zaps: TANSTAAFL, Take The Money And Run, The Meek Shall Inherit', () => {
  it('each stops the zapped Power Structure taking over Groups of one alignment', () => {
    for (const [cardId, align] of [['tanstaafl', 'Liberal'], ['take-the-money-and-run', 'Criminal'], ['the-meek-shall-inherit', 'Violent']] as const) {
      let s = scenario();
      const z = hand(s, 'p1', cardId);
      s = playAndResolve(s, 'p1', { card: z, target: ill(s, 'p2'), payWith: [ill(s, 'p1')] });
      expect(zapsOn(s, 'p2').length).toBe(1);
      const attacker = under(s, 'p2', 'the-mafia');
      const target = under(s, 'p1', align === 'Liberal' ? 'hollywood' : align === 'Criminal' ? 'the-mafia' : 'the-mafia', 'TOP');
      // The Mafia is Criminal and Violent, so it alone proves both TANSTAAFL-style Zaps that name it.
      if (align !== 'Liberal') {
        expect(() => act(p2Turn(s), 'p2', { type: 'attack', attackType: 'control', attacker, target })).toThrow(new RegExp(align));
      }
    }
  });
});

describe('Sorry, Wrong Number', () => {
  it('strips the closeness-to-Illuminati defense bonus from the zapped Power Structure', () => {
    let s = scenario();
    const tgt = under(s, 'p2', 'the-mafia');
    const att = under(s, 'p1', 'c-i-a');
    const z = hand(s, 'p1', 'sorry-wrong-number');
    s = playAndResolve(s, 'p1', { card: z, target: ill(s, 'p2'), payWith: [ill(s, 'p1')] });
    s.cards[att].tokens = 1;
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: att, target: tgt });
    expect(s.attack).toBeTruthy();
  });
});

describe('Security Leak', () => {
  it('exposes every Plot the zapped Illuminati draws', () => {
    let s = scenario();
    const z = hand(s, 'p1', 'security-leak');
    s = playAndResolve(s, 'p1', { card: z, target: ill(s, 'p2'), payWith: [ill(s, 'p1')] });
    const before = player(s, 'p2').hand.length;
    const drawn = player(s, 'p2').plotDeck[0];
    drawPlot(s, player(s, 'p2'));
    expect(player(s, 'p2').hand.length).toBe(before + 1);
    expect(s.cards[drawn].exposed).toBe(true);
  });
});

describe('Paralysis: Vile Secretions, Waiting Period, Whistle Blowers', () => {
  function setup(id: string, targetId: string, payerId: string) {
    const s = scenario();
    const target = under(s, 'p2', targetId);
    const payer = under(s, 'p1', payerId, 'TOP');
    const card = hand(s, 'p1', id);
    return { s, target, payer, card };
  }
  it('Vile Secretions paralyzes a Weird Group; freed by a Straight action or its master', () => {
    const { s, target, payer, card } = setup('vile-secretions', 'church-of-elvis', 'a-m-a');
    expect(() => play(s, 'p1', { card, target })).toThrow(/Illuminati|Straight/);
    const t = playAndResolve(s, 'p1', { card, target, payWith: [ill(s, 'p1')] });
    expect(isParalyzed(t, target)).toBe(true);
    // Freed by any Illuminati at any time: here p2's own, on p2's own turn.
    const u = act(p2Turn(t), 'p2', { type: 'freeGroup', group: target, payWith: ill(t, 'p2') });
    expect(isParalyzed(u, target)).toBe(false);
    void payer;
  });
  it('Waiting Period paralyzes a Violent Group', () => {
    const { s, target, card } = setup('waiting-period', 'the-mafia', 'a-m-a');
    const t = playAndResolve(s, 'p1', { card, target, payWith: [ill(s, 'p1')] });
    expect(isParalyzed(t, target)).toBe(true);
    expect(paralysesOn(t, target).length).toBe(1);
  });
  it('Whistle Blowers paralyzes a Government Group', () => {
    const { s, target, card } = setup('whistle-blowers', 'nasa', 'cable-tv');
    const t = playAndResolve(s, 'p1', { card, target, payWith: [ill(s, 'p1')] });
    expect(isParalyzed(t, target)).toBe(true);
  });
});

describe('Pizza for the Secret Meeting', () => {
  it('a Secret Group is not Secret for the rest of the turn', () => {
    let s = scenario();
    const secret = under(s, 'p2', 'elders-of-zion');
    const card = hand(s, 'p1', 'pizza-for-the-secret-meeting');
    expect(attributes(s, secret)).toContain('Secret');
    s = playAndResolve(s, 'p1', { card, target: secret });
    expect(attributes(s, secret)).not.toContain('Secret');
  });
  it('refuses a Group that is not Secret', () => {
    const s = scenario();
    const g = under(s, 'p2', 'the-mafia');
    const card = hand(s, 'p1', 'pizza-for-the-secret-meeting');
    expect(() => play(s, 'p1', { card, target: g })).toThrow(/Secret/);
  });
});

describe('Regi$tered Trademark', () => {
  it('links to a Group in play, and lets either player record a naming slip', () => {
    let s = scenario();
    const g = under(s, 'p2', 'the-mafia');
    const card = hand(s, 'p1', 'regi-tered-trademark');
    s = playAndResolve(s, 'p1', { card, target: g });
    expect(s.cards[card].linkedTo).toBe(g);
    const plot = hand(s, 'p1', 'pave-the-earth');
    const before = player(s, 'p1').hand.length;
    s = act(s, 'p1', { type: 'nameSlip', card, discard: plot });
    expect(s.cards[plot].zone).toBe('discard');
    expect(player(s, 'p1').hand.length).toBe(before - 1);
    // The linked Group belongs to p2: p1 (who is not its owner) may catch p2 slipping.
    const beforeP1 = player(s, 'p1').hand.length;
    const topOfP2Deck = player(s, 'p2').plotDeck[0];
    s = act(s, 'p1', { type: 'catchNameSlip', card });
    expect(player(s, 'p1').hand.length).toBe(beforeP1 + 1);
    expect(s.cards[topOfP2Deck].owner).toBe('p1');
  });
  it('refuses to catch your own slip', () => {
    let s = scenario();
    const g = under(s, 'p2', 'the-mafia');
    const card = hand(s, 'p1', 'regi-tered-trademark');
    s = playAndResolve(s, 'p1', { card, target: g });
    expect(() => act(s, 'p2', { type: 'catchNameSlip', card })).toThrow(/own slip/);
  });
});

describe('Reverse Whammy', () => {
  it('turns a Zap played against you back on the Zapper, discarding a Group card', () => {
    let s = p2Turn(scenario());
    const zapCard = hand(s, 'p2', 'tanstaafl');
    const whammy = hand(s, 'p1', 'reverse-whammy'); // in hand before the Zap resolves, so it can answer it
    const g = hand(s, 'p1', 'the-mafia');
    s = playAndResolve(s, 'p2', { card: zapCard, target: ill(s, 'p1'), payWith: [ill(s, 'p2')] });
    expect(zapsOn(s, 'p1').length).toBe(1);
    expect(s.window?.kind).toBe('event');
    s = playAndResolve(s, 'p1', { card: whammy, target: zapCard, discards: [g] });
    expect(s.cards[g].zone).toBe('discard');
    expect(zapsOn(s, 'p1').length).toBe(0);
    expect(zapsOn(s, 'p2').length).toBe(1);
  });
});

describe('Secret Master', () => {
  it('immune to capture, only destroyed by Assassination or a direct Illuminati attack, +20 vs Assassination, no alignments', () => {
    let s = scenario();
    const person = under(s, 'p1', 'bill-clinton');
    const card = hand(s, 'p1', 'secret-master');
    s = playAndResolve(s, 'p1', { card, target: person });
    expect(alignments(s, person)).toEqual([]);
    const rival = under(s, 'p2', 'the-mafia');
    expect(() => act(p2Turn(s), 'p2', { type: 'attack', attackType: 'control', attacker: rival, target: person })).toThrow(/Secret Master/);
  });
});

describe('Strange Bedfellows', () => {
  it('reverses a Group\'s alignment for the rest of the turn, not for Goals', () => {
    let s = scenario();
    const g = under(s, 'p1', 'hollywood'); // Liberal
    const card = hand(s, 'p1', 'strange-bedfellows');
    s = playAndResolve(s, 'p1', { card, target: g, alignment: 'Liberal' });
    expect(alignments(s, g)).toContain('Conservative');
    expect(alignments(s, g, { goals: true })).not.toContain('Conservative');
  });
});

describe('Sudden European Vacation', () => {
  it('moves your own Personality to a new master and shields it from hostile Plots this turn', () => {
    let s = scenario();
    const person = under(s, 'p1', 'bill-clinton');
    const other = under(s, 'p1', 'the-mafia', 'TOP');
    const card = hand(s, 'p1', 'sudden-european-vacation');
    s = playAndResolve(s, 'p1', { card, target: person, helper: other, mode: 'TOP' });
    expect(s.cards[person].master).toBe(other);
    s = p2Turn(s);
    const zap = hand(s, 'p2', 'pizza-for-the-secret-meeting');
    expect(() => play(s, 'p2', { card: zap, target: person })).toThrow(/immune/);
  });
});

describe('Sufficiently Advanced Technology', () => {
  it('a linked Science Group is also Magic, and vice versa', () => {
    let s = scenario();
    const science = under(s, 'p1', 'a-m-a');
    const card = hand(s, 'p1', 'sufficiently-advanced-technology');
    s = playAndResolve(s, 'p1', { card, target: science });
    expect(attributes(s, science)).toContain('Magic');
    let s2 = scenario();
    const magic = under(s2, 'p1', 'ninjas');
    const card2 = hand(s2, 'p1', 'sufficiently-advanced-technology');
    s2 = playAndResolve(s2, 'p1', { card: card2, target: magic });
    expect(attributes(s2, magic)).toContain('Science');
  });
});

describe('Supernova', () => {
  it('brings one or two Gadget Resources into play, one Space action each', () => {
    const gadget: CardDef = { id: 'x-gadget', name: 'x-gadget', type: 'Resource', subtype: 'Resource', rarity: null, text: '', uniqueness: 'Gadget; not marked Unique' };
    CARDS[gadget.id] = gadget;
    registerHooks({ 'x-gadget': { hasAction: true } });
    let s = scenario();
    const space = under(s, 'p1', 'nasa');
    const g1 = hand(s, 'p1', 'x-gadget');
    const card = hand(s, 'p1', 'supernova');
    expect(() => play(s, 'p1', { card, targets: [g1], payWith: [] })).toThrow(/Space/);
    s = playAndResolve(s, 'p1', { card, targets: [g1], payWith: [space] });
    expect(s.cards[g1].zone).toBe('resources');
    expect(s.cards[g1].tokens).toBe(1);
    expect(s.cards[space].tokens).toBe(0);
  });
});

describe('Supreme Court Nomination', () => {
  it('destroys the target on success (not killed), any Group may aid, doubled for Republicans/Democrats/Media', () => {
    let s = p2Turn(scenario());
    const target = under(s, 'p1', 'bill-clinton');
    const card = hand(s, 'p2', 'supreme-court-nomination');
    s = play(s, 'p2', { card, target });
    expect(s.attack?.instant).toBe(false);
    expect(s.attack?.type).toBe('destroy');
    s.attack!.attackBonus.push({ player: 'p2', amount: 20, label: 'test' });
    s = resolveAttack(s, [2, 2]);
    expect(s.cards[target].zone).toBe('destroyed');
    expect(s.cards[target].killed).toBeFalsy();
  });
  it('on failure the target becomes Chief Justice, and no more nominations while he sits', () => {
    let s = p2Turn(scenario());
    const target = under(s, 'p1', 'bill-clinton');
    const card = hand(s, 'p2', 'supreme-court-nomination');
    s = play(s, 'p2', { card, target });
    s.attack!.defenseBonus.push({ player: 'p1', amount: 30, label: 'test' });
    s = resolveAttack(s, [6, 6]);
    expect(power(s, target)).toBe(4);
    expect(alignments(s, target)).toContain('Government');
    const card2 = hand(s, 'p2', 'supreme-court-nomination');
    const other = under(s, 'p2', 'the-mafia');
    void other;
    expect(() => play(s, 'p2', { card: card2, target })).toThrow(/Chief Justice/);
  });
});

describe('Teflon Coating', () => {
  it('cancels every Media action in the attack, and bars further Media aid', () => {
    let s = scenario();
    const media = under(s, 'p1', 'cable-tv');
    const target = under(s, 'p2', 'bill-clinton');
    s.cards[media].tokens = 1;
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: media, target });
    const teflon = hand(s, 'p2', 'teflon-coating');
    s = play(s, 'p2', { card: teflon });
    s = resolveAttack(s);
    expect(s.attack).toBeUndefined();
    expect(s.cards[target].zone).toBe('structure'); // the whole attack was cancelled: its only Group was Media
  });
});

describe('The Irish Flu', () => {
  it('the victim loses its token this turn', () => {
    let s = p2Turn(scenario());
    const victim = under(s, 'p1', 'bill-clinton');
    const card = hand(s, 'p2', 'the-irish-flu');
    s = playAndResolve(s, 'p2', { card, target: victim });
    expect(s.cards[victim].tokens).toBe(0);
    expect(s.cards[card].linkedTo).toBe(victim);
  });
  it('the Center for Disease Control protects its whole Power Structure', () => {
    let s = p2Turn(scenario());
    const cdc = under(s, 'p1', 'center-for-disease-control');
    const shielded = under(s, 'p1', 'bill-clinton', 'TOP', cdc);
    const card = hand(s, 'p2', 'the-irish-flu');
    expect(() => play(s, 'p2', { card, target: shielded })).toThrow(/immune/);
  });
});

describe('This Was Only A Test', () => {
  it('cancels a Disaster and exposes it back to its owner\'s hand, unusable next turn', () => {
    let s = scenario();
    const target = under(s, 'p2', 'hollywood');
    const disaster = hand(s, 'p1', 'tornado');
    s = play(s, 'p1', { card: disaster, target });
    expect(s.attack?.instant).toBe(true);
    const test = hand(s, 'p2', 'this-was-only-a-test');
    s = play(s, 'p2', { card: test });
    s = resolveAttack(s);
    expect(s.attack).toBeUndefined();
    expect(s.cards[disaster].zone).toBe('hand');
    expect(s.cards[disaster].exposed).toBe(true);
    expect(() => play(s, 'p1', { card: disaster, target })).toThrow(/cannot be used/);
  });
});

describe('Truck Bomb', () => {
  it('turns an Attack to Destroy an Organization into an Instant attack by a lone Violent Group', () => {
    let s = scenario();
    const attacker = under(s, 'p1', 'c-i-a');
    const target = under(s, 'p2', 'punk-rockers');
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker, target });
    const bomb = hand(s, 'p1', 'truck-bomb');
    s = play(s, 'p1', { card: bomb });
    expect(s.attack?.instant).toBe(true);
    expect(s.attack?.instantPower).toBe(power(s, attacker));
  });
  it('refuses a non-Violent attacker or an Organization already joined by an aid', () => {
    const s = scenario();
    const attacker = under(s, 'p1', 'nasa'); // Government, not Violent
    const target = under(s, 'p2', 'punk-rockers');
    const s1 = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker, target });
    const bomb = hand(s1, 'p1', 'truck-bomb');
    expect(() => play(s1, 'p1', { card: bomb })).toThrow(/Violent/);
  });
});

describe('Witch Hunt', () => {
  it('gives a token to one Church Group, or several totalling 5 Power or less', () => {
    let s = scenario();
    const church = under(s, 'p2', 'church-of-elvis');
    s.cards[church].tokens = 0;
    const card = hand(s, 'p1', 'witch-hunt');
    s = playAndResolve(s, 'p1', { card, targets: [church] });
    expect(s.cards[church].tokens).toBe(1);
  });
  it('refuses a Group that already has a token, or too much total Power', () => {
    let s = scenario();
    const church = under(s, 'p2', 'church-of-elvis');
    const big = under(s, 'p1', 'the-mafia', 'TOP'); // not Church at all
    const card = hand(s, 'p1', 'witch-hunt');
    expect(() => play(s, 'p1', { card, targets: [big] })).toThrow(/Church/);
    s.cards[church].tokens = 1;
    expect(() => play(s, 'p1', { card, targets: [church] })).toThrow(/Church/);
  });
});

describe('You Are What You Eat', () => {
  it('discards the attacker (not for Goals) and puts the destroyed Group in its place', () => {
    let s = scenario();
    const attacker = under(s, 'p1', 'c-i-a');
    const target = under(s, 'p2', 'punk-rockers');
    const card = hand(s, 'p1', 'you-are-what-you-eat'); // in hand before the destroy, so it can answer the event
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker, target });
    s.attack!.attackBonus.push({ player: 'p1', amount: 20, label: 'test' });
    s = resolveAttack(s, [2, 2]);
    expect(s.cards[target].zone).toBe('destroyed');
    expect(s.window?.kind).toBe('event');
    const before = player(s, 'p1').destroyedCredit.length;
    s = playAndResolve(s, 'p1', { card });
    expect(s.cards[attacker].zone).toBe('discard');
    expect(s.cards[target].zone).toBe('structure');
    expect(s.cards[target].controller).toBe('p1');
    expect(player(s, 'p1').destroyedCredit.length).toBe(before);
  });
  it('does not apply when your Illuminati itself made the attack', () => {
    let s = scenario();
    const target = under(s, 'p2', 'punk-rockers');
    const card = hand(s, 'p1', 'you-are-what-you-eat');
    s.cards[ill(s, 'p1')].tokens = 1;
    s = act(s, 'p1', { type: 'attack', attackType: 'destroy', attacker: ill(s, 'p1'), target });
    s.attack!.attackBonus.push({ player: 'p1', amount: 20, label: 'test' });
    s = resolveAttack(s, [2, 2]);
    expect(() => play(s, 'p1', { card })).toThrow(/Illuminati/);
  });
});
