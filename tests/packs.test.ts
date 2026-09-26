// The player-facing side of the expansion packs (src/ui/packs.ts): the new-game switches, the settings
// they turn into, the readings of Zaps / Paralysis / Freezes / Slack on the table, the cost choices for
// Plots that name their action, and the keywords shown in the card library.
import { describe, expect, it } from 'vitest';
import { CARDS, CHURCH, applyAction, createGame, illuminatiFor, randomDeck, type GameState } from '../src/engine';
import {
  PACK_KEY, PREVIEW_KEY, cardConditions, costChoices, keepsSlack, liveFreezes, loadPackChoice, packOffered, packsInGame,
  playerConditions, previewPacks, zapLine, savePackChoice, settingsForChoice, tileKeywords, type Store,
} from '../src/ui/packs';
import { give, scenario } from './helpers';

const memory = (init: Record<string, string> = {}): Store & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};
const all = () => true;

describe('pack switches on the new-game page', () => {
  it('are off by default, remembered per browser, and survive damaged storage', () => {
    const st = memory();
    expect(loadPackChoice(st)).toEqual({ assassins: false, subgenius: false, sgMode: 'mixed' });
    savePackChoice({ assassins: true, subgenius: true, sgMode: 'standalone' }, st);
    expect(JSON.parse(st.data[PACK_KEY])).toEqual({ assassins: true, subgenius: true, sgMode: 'standalone' });
    expect(loadPackChoice(st)).toEqual({ assassins: true, subgenius: true, sgMode: 'standalone' });
    expect(loadPackChoice(memory({ [PACK_KEY]: '{oops' }))).toEqual({ assassins: false, subgenius: false, sgMode: 'mixed' });
    expect(loadPackChoice(undefined).assassins).toBe(false);
  });

  it('can be previewed before a pack is ready', () => {
    expect(previewPacks(memory())).toBe(false);
    expect(previewPacks(memory({ [PREVIEW_KEY]: '1' }))).toBe(true);
    expect(packOffered('assassins', true)).toBe(true);
  });

  it('turn into the engine settings, only for packs on offer', () => {
    expect(settingsForChoice({}, all)).toEqual({});
    expect(settingsForChoice({ assassins: true }, all)).toEqual({ expansions: { assassins: true, subgenius: false } });
    expect(settingsForChoice({ subgenius: true, sgMode: 'mixed' }, all)).toEqual({ expansions: { assassins: false, subgenius: true } });
    // The stand-alone game uses the SubGenius cards alone: Assassins is left out.
    expect(settingsForChoice({ assassins: true, subgenius: true, sgMode: 'standalone' }, all)).toEqual({ expansions: { assassins: false, subgenius: true }, subgeniusRules: true });
    // A pack that is not offered is ignored, whatever was remembered.
    expect(settingsForChoice({ assassins: true, subgenius: true }, (id) => id === 'subgenius')).toEqual({ expansions: { assassins: false, subgenius: true } });
    expect(settingsForChoice({ assassins: true, subgenius: true, sgMode: 'standalone' }, () => false)).toEqual({});
  });

  it('change the Illuminati on offer', () => {
    const ids = (x: Parameters<typeof illuminatiFor>[0]) => illuminatiFor(x).map((c) => c.id);
    expect(ids(settingsForChoice({}, all))).not.toContain('society-of-assassins');
    expect(ids(settingsForChoice({ assassins: true }, all))).toContain('society-of-assassins');
    expect(ids(settingsForChoice({ subgenius: true }, all))).toContain(CHURCH);
    expect(ids(settingsForChoice({ subgenius: true }, all))).not.toContain('society-of-assassins');
  });
});

describe('reading the packs on the table', () => {
  const standalone = (): GameState => createGame({
    seed: 4,
    players: ['p1', 'p2', 'p3'].map((id, i) => ({ id, name: id, isAI: true, deck: randomDeck(10 + i, CHURCH, { sets: ['SubGenius'] }) })),
    settings: { subgeniusRules: true, expansions: { subgenius: true } },
  });

  it('names the packs a game uses', () => {
    expect(packsInGame(scenario())).toBe('');
    const s = scenario();
    s.settings.expansions = { assassins: true, subgenius: true };
    expect(packsInGame(s)).toBe('Assassins and SubGenius');
    expect(packsInGame(standalone())).toBe('the stand-alone SubGenius game');
  });

  it('sees Zaps on a player and Paralysis on a Group', () => {
    const s0 = scenario();
    const ill2 = s0.players[1].illuminati;
    const lama = give(s0, 'p2', 'lama-ramadingdong', { under: ill2, side: 'BOTTOM' });
    const zap = give(s0, 'p1', 'brushfire-war', { hand: true });
    const cat = give(s0, 'p1', 'cat-juggling', { hand: true });
    s0.cards[s0.players[0].illuminati].tokens = 2;
    let s = applyAction(s0, 'p1', { type: 'playPlot', play: { card: zap, target: ill2, payWith: [s0.players[0].illuminati] } });
    while (s.window) s = applyAction(s, s.window.passed.includes('p1') ? 'p2' : 'p1', { type: 'pass' });
    expect(playerConditions(s, 'p2').zaps).toEqual([zap]);
    expect(zapLine(s, zap)).toBe('Brushfire War: No Group in that Power Structure may take over Peaceful Groups.');
    expect(playerConditions(s, 'p1').zaps).toEqual([]);
    s = applyAction(s, 'p1', { type: 'playPlot', play: { card: cat, target: lama, payWith: [s.players[0].illuminati] } });
    while (s.window) s = applyAction(s, s.window.passed.includes('p1') ? 'p2' : 'p1', { type: 'pass' });
    expect(cardConditions(s, lama).paralyzed).toEqual([cat]);
    expect(cardConditions(s, lama).held).toBe(1); // its token is held back
    expect(playerConditions(s, 'p2').paralyzed).toEqual([lama]);
    expect(cardConditions(s, lama).frozen).toBe(false);
    expect(liveFreezes(s)).toEqual([]);
  });

  it('offers every affordable way to pay a Plot that names its action', () => {
    const s = scenario();
    const ill1 = s.players[0].illuminati;
    const lama = give(s, 'p2', 'lama-ramadingdong', { under: s.players[1].illuminati, side: 'BOTTOM' });
    const cia = give(s, 'p1', 'c-i-a', { under: ill1, side: 'BOTTOM' });
    const cat = give(s, 'p1', 'cat-juggling', { hand: true });
    const ways = costChoices(s, 'p1', { card: cat, target: lama });
    expect(ways.map((w) => w.play.payWith)).toEqual([[ill1], [cia]]);
    expect(ways[0].cost).toMatch(/Illuminati/);
    expect(ways[1].cost).toMatch(/Violent/);
    expect(ways[1].cost).toMatch(/C\.I\.A\./);
    // Without a Violent Group only the Illuminati can pay. A Zap costs an Illuminati action; a base Plot declares no cost.
    s.cards[cia].tokens = 0;
    expect(costChoices(s, 'p1', { card: cat, target: lama }).map((w) => w.play.payWith)).toEqual([[ill1]]);
    const other = give(s, 'p1', 'brushfire-war', { hand: true });
    expect(costChoices(s, 'p1', { card: other, target: s.players[1].illuminati }).map((w) => w.play.payWith)).toEqual([[ill1]]);
    const base = give(s, 'p1', 'swiss-bank-account', { hand: true });
    expect(costChoices(s, 'p1', { card: base })).toEqual([]);
  });

  it('knows which Illuminati keeps Slack', () => {
    const s = standalone();
    expect(keepsSlack(s, s.players[0].illuminati)).toBe(true);
    expect(keepsSlack(scenario(), scenario().players[0].illuminati)).toBe(false);
  });
});

describe('card library tiles', () => {
  it('show the printed keywords worth knowing', () => {
    expect(tileKeywords(CARDS['brushfire-war'])).toEqual(['Zap!']);
    expect(tileKeywords(CARDS['cat-juggling'])).toEqual(['Paralysis']);
    expect(tileKeywords(CARDS['junk-bonds'])).toEqual(['Freeze']);
    expect(tileKeywords(CARDS['oil-spill'])).toEqual(['Disaster', 'Instant']);
    expect(tileKeywords(CARDS['spontaneous-combustion'])).toEqual(['Assassination', 'Instant']);
    expect(tileKeywords(CARDS[CHURCH])).toEqual([]);
  });
});
