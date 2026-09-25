// What computer players do that real players routinely do: join other players' fights, stop a
// winner with Instant attacks, cash in spare tokens, judge New World Orders, send Relief, reorganize,
// use their Illuminati's specials and Goal cards, and use Plots with some sense.
import { describe, expect, it } from 'vitest';
import {
  applyAction, createGame, CARDS, HOOKS, openArrows, placeGroup, structureCards, waitingFor, type Action, type AiLevel, type GameState,
} from '../src/engine';
import { randomDeck } from '../src/engine/decks';
import { chooseAction, PROFILES } from '../src/ai/ai';
import { goalProgress, standing } from '../src/ai/evaluate';

let n = 0;
/** A game of `ills.length` players in p1's main phase, everyone past the first turn, no Groups or cards in hand. */
function table(ills: string[], level: AiLevel = 'normal'): GameState {
  const s = createGame({
    id: 'strategy', seed: 5,
    players: ills.map((ill, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isAI: true, aiLevel: level, deck: randomDeck(40 + i, ill) })),
  });
  for (const [k, c] of Object.entries(s.cards)) {
    if ((c.zone === 'structure' && CARDS[c.cardId].type === 'Group') || c.zone === 'hand') delete s.cards[k];
  }
  for (const p of s.players) { p.turnsTaken = 2; // past the first turn, not yet open to elimination
    p.hand = []; s.cards[p.illuminati].tokens = 1; }
  Object.assign(s, { active: 0, phase: 'main', prompt: undefined, window: undefined, round: 3, turn: 9, nwo: {}, promptQueue: undefined, events: undefined });
  return s;
}
const ill = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.illuminati;
const hand = (s: GameState, pl: string) => s.players.find((p) => p.id === pl)!.hand;
/** A card in `pl`'s Power Structure under `master` (default the Illuminati), with a token. */
function put(s: GameState, pl: string, cardId: string, master?: string, side?: string): string {
  const iid = `x${++n}`;
  s.cards[iid] = { iid, cardId, owner: pl, zone: 'hand', tokens: 0, mods: [] };
  const m = master ?? ill(s, pl);
  placeGroup(s, iid, pl, m, (side ?? openArrows(s, m)[0]) as never);
  s.cards[iid].tokens = 1;
  return iid;
}
function inHand(s: GameState, pl: string, cardId: string): string {
  const iid = `x${++n}`;
  s.cards[iid] = { iid, cardId, owner: pl, zone: 'hand', tokens: 0, mods: [] };
  hand(s, pl).push(iid);
  return iid;
}
const boost = (s: GameState, iid: string, v: number) => s.cards[iid].mods.push({ source: 'test', kind: 'power', value: v, until: 'permanent' });
const setLevel = (s: GameState, pl: string, level: AiLevel) => { s.players.find((p) => p.id === pl)!.aiLevel = level; };
const act = (s: GameState, pl: string, a: Action) => applyAction(s, pl, a);

/** p2 (one Group short of winning) attacks one of p3's Groups; the window waits for p1. */
function leaderAttacks(level: AiLevel): { s: GameState; target: string } {
  let s = table(['adepts-of-hermes', 'the-network', 'ufos'], level);
  s.settings.basicGoal = 5;
  put(s, 'p2', 'fbi'); put(s, 'p2', 'lawyers');
  const att = put(s, 'p2', 'the-mafia');
  boost(s, att, 8);
  const target = put(s, 'p3', 'i-r-s'); // Criminal Government
  put(s, 'p3', 'big-media');
  put(s, 'p1', 'federal-reserve'); // Government: may defend the I.R.S.
  put(s, 'p1', 'democrats');
  s.active = 1;
  s = act(s, 'p2', { type: 'attack', attackType: 'control', attacker: att, target, side: openArrows(s, att)[0] });
  s = act(s, 'p2', { type: 'pass' });
  s = act(s, 'p3', { type: 'pass' });
  expect(waitingFor(s)).toEqual(['p1']);
  return { s, target };
}

describe('joining other players\' attacks', () => {
  it('Normal opposes an attack that would let a rival win, even on a third player\'s Group', () => {
    const { s } = leaderAttacks('normal');
    const a = chooseAction(s, 'p1');
    expect(a.type).toBe('oppose');
    expect(applyAction(s, 'p1', a).attack!.oppose.some((c) => c.player === 'p1')).toBe(true);
  });

  it('uses agents (a duplicate of the target) to oppose it', () => {
    const { s } = leaderAttacks('normal');
    for (const g of structureCards(s, 'p1')) s.cards[g].tokens = 0; // no Groups free to help
    const dup = inHand(s, 'p1', 'i-r-s');
    expect(chooseAction(s, 'p1')).toEqual({ type: 'agent', card: dup, as: 'oppose' });
  });

  it('Easy stays out of other players\' fights', () => {
    const { s } = leaderAttacks('easy');
    expect(chooseAction(s, 'p1').type).toBe('pass');
  });

  it('aids an attack on the Groups of a rival about to win', () => {
    let s = table(['adepts-of-hermes', 'the-network', 'ufos']);
    s.settings.basicGoal = 5;
    put(s, 'p2', 'fbi'); put(s, 'p2', 'lawyers');
    const target = put(s, 'p2', 'i-r-s');
    const att = put(s, 'p3', 'the-mafia');
    boost(s, att, 14); // a fair chance, which help can make much better
    put(s, 'p1', 'clone-arrangers'); // Violent Criminal: shares Criminal with the I.R.S.
    s.active = 2;
    s = act(s, 'p3', { type: 'attack', attackType: 'destroy', attacker: att, target });
    s = act(s, 'p3', { type: 'pass' });
    s = act(s, 'p2', { type: 'pass' });
    expect(chooseAction(s, 'p1').type).toBe('aid');
  });
});

describe('Instant attacks to stop a winner', () => {
  it('strikes at the end of a rival\'s turn when that rival is about to win', () => {
    let s = table(['adepts-of-hermes', 'the-network', 'ufos']);
    s.settings.basicGoal = 5;
    const park = put(s, 'p2', 'dinosaur-park');
    put(s, 'p2', 'hawaii', park, 'LEFT');
    put(s, 'p2', 'fbi'); put(s, 'p2', 'lawyers');
    const quake = inHand(s, 'p1', 'earthquake');
    s.active = 1;
    s = act(s, 'p2', { type: 'endTurn' });
    expect(s.window?.kind).toBe('endOfTurn');
    const who = waitingFor(s);
    for (const pl of who.filter((x) => x !== 'p1')) s = act(s, pl, { type: 'pass' });
    const a = chooseAction(s, 'p1');
    expect(a.type).toBe('playPlot');
    expect((a as { play: { card: string } }).play.card).toBe(quake);
  });

  it('does not throw Instant attacks around at the end of rivals\' turns otherwise', () => {
    let s = table(['adepts-of-hermes', 'the-network', 'ufos']);
    put(s, 'p2', 'dinosaur-park');
    inHand(s, 'p1', 'earthquake');
    s.active = 1;
    s = act(s, 'p2', { type: 'endTurn' });
    for (const pl of waitingFor(s).filter((x) => x !== 'p1')) s = act(s, pl, { type: 'pass' });
    expect(chooseAction(s, 'p1').type).not.toBe('playPlot');
  });
});

describe('cashing in spare tokens for Plots', () => {
  function endOfPreviousTurn(level: AiLevel): GameState {
    let s = table(['adepts-of-hermes', 'the-network', 'ufos'], level);
    put(s, 'p1', 'fbi'); put(s, 'p1', 'lawyers'); put(s, 'p1', 'democrats'); put(s, 'p1', 'n-s-a');
    s.active = 2; // p3's turn: p1 is next
    s = act(s, 'p3', { type: 'endTurn' });
    return s;
  }
  function spend(s: GameState, pl: string): Action[] {
    const out: Action[] = [];
    for (let i = 0; i < 8 && waitingFor(s).includes(pl); i++) {
      const a = chooseAction(s, pl);
      out.push(a);
      s = applyAction(s, pl, a);
      if (a.type === 'pass') break;
    }
    return out;
  }
  it('Normal spends the Illuminati token and one pair of Groups at the end of the turn before its own', () => {
    const acts = spend(endOfPreviousTurn('normal'), 'p1');
    expect(acts.filter((a) => a.type === 'buyPlot').map((a) => (a as { payWith: string[] }).payWith.length)).toEqual([1, 2]);
  });
  it('Hard cashes in every pair', () => {
    const acts = spend(endOfPreviousTurn('hard'), 'p1');
    expect(acts.filter((a) => a.type === 'buyPlot').length).toBe(3);
  });
  it('keeps its tokens for defence at the end of other rivals\' turns, and Easy never cashes in', () => {
    let s = table(['adepts-of-hermes', 'the-network', 'ufos']);
    put(s, 'p1', 'fbi'); put(s, 'p1', 'lawyers');
    s.active = 1; // p2's turn: p3 is next
    s = act(s, 'p2', { type: 'endTurn' });
    expect(chooseAction(s, 'p1').type).toBe('pass');
    const e = endOfPreviousTurn('easy');
    expect(chooseAction(e, 'p1').type).toBe('pass');
  });
});

describe('New World Orders', () => {
  it('Normal keeps an NWO that does nothing for it; Easy plays any from turn 3', () => {
    const s = table(['adepts-of-hermes', 'the-network']);
    put(s, 'p1', 'fbi');
    const nwo = inHand(s, 'p1', 'tax-reform'); // helps only the I.R.S., which nobody has
    const played = (a: Action) => a.type === 'playPlot' && a.play.card === nwo;
    expect(played(chooseAction(s, 'p1'))).toBe(false);
    setLevel(s, 'p1', 'easy');
    expect(played(chooseAction(s, 'p1'))).toBe(true);
  });
});

describe('Relief, moves and reorganization', () => {
  it('sends Relief to its own Devastated Place when it pays', () => {
    const s = table(['adepts-of-hermes', 'the-network']);
    const park = put(s, 'p1', 'dinosaur-park');
    put(s, 'p1', 'hawaii', park, 'LEFT');
    s.cards[park].devastated = true;
    for (const g of structureCards(s, 'p1')) if (g !== ill(s, 'p1')) s.cards[g].tokens = 0;
    put(s, 'p1', 'fbi');
    const a = chooseAction(s, 'p1');
    expect(a.type === 'relief' || (a.type === 'useAbility' && a.ability === 'relief')).toBe(true);
    if (a.type === 'relief') expect(a.place).toBe(park);
  });

  it('Bermuda Triangle reorganizes to bring a strong Group in close, once its attacks are over', () => {
    let s = table(['bermuda-triangle', 'the-network']);
    const a1 = put(s, 'p1', 'fbi');
    const a2 = put(s, 'p1', 'lawyers', a1);
    const key = put(s, 'p1', 'democrats', a2);
    for (const g of structureCards(s, 'p1')) s.cards[g].tokens = 0;
    const first = chooseAction(s, 'p1');
    expect(first).toMatchObject({ type: 'useAbility', ability: 'reorganize' });
    s = applyAction(s, 'p1', first);
    for (let i = 0; i < 6 && s.players[s.active].id === 'p1' && s.phase === 'main'; i++) {
      const a = chooseAction(s, 'p1');
      if (a.type !== 'move') break;
      s = applyAction(s, 'p1', a);
    }
    expect(s.cards[key].master).not.toBe(a2);
  });

  it('enables the main-phase abilities that are safe for a computer', () => {
    const hint = (card: string, id: string) => HOOKS[card].actions!.find((a) => a.id === id)!.ai;
    for (const [card, id] of [['c-i-a', 'assassinate'], ['clone-arrangers', 'clone'], ['boy-sprouts', 'relief'], ['nato', 'relief'],
      ['red-cross', 'relief'], ['united-nations', 'relief'], ['center-for-disease-control', 'relief'], ['nasa', 'transferToken'],
      ['s-m-o-f', 'removeToken'], ['flying-saucer', 'takeover'], ['evil-geniuses-for-a-better-tomorrow', 'gadget'], ['templars', 'discardExposed'],
      ['psychiatrists', 'discardExposed'], ['wargamers', 'bury'], ['center-for-weird-studies', 'refresh'], ['druids', 'link'], ['professional-sports', 'link']]) {
      expect(hint(card, id), `${card}/${id}`).toBeUndefined();
    }
    expect(hint('warehouse-23', 'fetch')).toBe('free');
    expect(hint('warehouse-23', 'reveal')).toBe('free');
    expect(hint('bermuda-triangle', 'reorganize')).toBe('reorganize');
    expect(hint('elders-of-zion', 'reorganize')).toBe('reorganize');
  });

  it('brings in a Resource with the Flying Saucer\'s extra takeover', () => {
    const s = table(['adepts-of-hermes', 'the-network']);
    const saucer = `x${++n}`;
    s.cards[saucer] = { iid: saucer, cardId: 'flying-saucer', owner: 'p1', zone: 'resources', controller: 'p1', tokens: 0, mods: [] };
    s.cards[ill(s, 'p1')].tokens = 0;
    const r = inHand(s, 'p1', 'perpetual-motion-machine');
    const a = chooseAction(s, 'p1');
    expect(a).toMatchObject({ type: 'useAbility', card: saucer, ability: 'takeover', params: { target: r } });
  });
});

describe('Illuminati specials and Goals', () => {
  it('the Bavarian Illuminati make their best attack Privileged for free', () => {
    const s = table(['bavarian-illuminati', 'the-network', 'ufos']);
    const att = put(s, 'p1', 'the-mafia');
    boost(s, att, 20);
    put(s, 'p2', 'dentists');
    const a = chooseAction(s, 'p1');
    expect(a).toMatchObject({ type: 'attack', privileged: true });
  });

  it('values progress toward a Special Goal and a held Goal card', () => {
    const s = table(['bavarian-illuminati', 'the-network']);
    const g = put(s, 'p1', 'democrats');
    const before = goalProgress(s, 'p1');
    boost(s, g, 20);
    expect(goalProgress(s, 'p1')).toBeGreaterThan(before);
    const t = table(['adepts-of-hermes', 'the-network']);
    put(t, 'p1', 'democrats');
    const plain = standing(t, 'p1', 'p1');
    const card = inHand(t, 'p1', 'power-for-its-own-sake');
    expect(goalProgress(t, 'p1', 'p1')).toBeGreaterThan(0);
    expect(standing(t, 'p1', 'p1')).toBeGreaterThan(plain);
    // A rival's hidden Goal card is not counted, an exposed one is.
    expect(goalProgress(t, 'p1', 'p2')).toBe(0);
    t.cards[card].exposed = true;
    expect(goalProgress(t, 'p1', 'p2')).toBeGreaterThan(0);
  });

  it('drops the Goal card it is furthest from', () => {
    let s = table(['adepts-of-hermes', 'the-network']);
    put(s, 'p1', 'democrats'); put(s, 'p1', 'federal-reserve');
    const far = inHand(s, 'p1', 'kill-for-peace'); // nothing destroyed yet
    const near = inHand(s, 'p1', 'power-for-its-own-sake');
    s = act(s, 'p1', { type: 'endTurn' }); // the Goal limit is enforced at once
    s.prompt = { player: 'p1', kind: 'discardToLimit', data: { resume: 'continue' } };
    const a = chooseAction(s, 'p1') as { cards: string[] };
    expect(a.cards).toContain(far);
    expect(a.cards).not.toContain(near);
  });
});

describe('Plots', () => {
  it('attaches a Plot that raises the odds, even one outside the plain +10 family', () => {
    const s = table(['adepts-of-hermes', 'the-network']);
    const att = put(s, 'p1', 'dentists'); // no control arrow: it can only attack to destroy
    boost(s, att, 19);
    put(s, 'p1', 'hollywood'); // a Media Group to pay for the Whispering Campaign
    const t = put(s, 'p2', 'lawyers');
    s.cards[t].tokens = 0; // it cannot defend itself
    const wc = inHand(s, 'p1', 'whispering-campaign');
    s.cards[ill(s, 'p1')].tokens = 0; // no Plot to buy first
    const a = chooseAction(s, 'p1');
    expect(a.type).toBe('attack');
    expect((a as { plots?: { card: string }[] }).plots?.map((p) => p.card)).toContain(wc);
  });

  it('discards the least useful Plots at the hand limit', () => {
    const s = table(['adepts-of-hermes', 'the-network']);
    put(s, 'p1', 'the-mafia');
    const keep = ['earthquake', 'terrorist-nuke', 'fnord', 'murphy-s-law', 'sniper'].map((c) => inHand(s, 'p1', c));
    const junk = inHand(s, 'p1', 'tax-reform');
    s.active = 1;
    s.prompt = { player: 'p1', kind: 'discardToLimit', data: { resume: 'continue' } };
    const a = chooseAction(s, 'p1') as { cards: string[] };
    expect(a.cards).toEqual([junk]);
    expect(keep.every((k) => !a.cards.includes(k))).toBe(true);
  });

  it('difficulty levels keep these habits apart', () => {
    expect(PROFILES.easy.interfere + PROFILES.easy.cashIn + PROFILES.easy.reorganize).toBe(0);
    expect(PROFILES.easy.judgeNwo || PROFILES.easy.stopWin || PROFILES.easy.plotSense).toBe(false);
    expect(PROFILES.normal.interfere).toBeLessThan(PROFILES.hard.interfere);
    expect(PROFILES.normal.cashIn).toBeLessThan(PROFILES.hard.cashIn);
  });
});
