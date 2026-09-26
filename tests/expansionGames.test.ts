// Computer-vs-computer games with each expansion pack forced on (the packs stay hidden from players
// until every card is implemented). The packs' Zaps, Paralysis and Freezes get stand-in handlers built
// from the rule families, so the computers play them and the new rules are exercised in real games.
import { describe, expect, it } from 'vitest';
import {
  CARDS, CHURCH, EXPANSION_CARDS, applyAction, createGame, freezePlot, paralysisPlot, randomDeck, registerPlots, registerZap, waitingFor,
  type Alignment, type CardSet, type GameSettings, type GameState, type NewPlayer,
} from '../src/engine';
import { chooseAction } from '../src/ai/ai';
import { checkInvariants } from './helpers';

const ALIGNS = ['Government', 'Corporate', 'Liberal', 'Conservative', 'Peaceful', 'Violent', 'Straight', 'Weird', 'Criminal', 'Fanatic'];
const matchOf = (words: string[]) => ({
  alignments: words.filter((w) => ALIGNS.includes(w)) as Alignment[],
  attributes: words.filter((w) => !ALIGNS.includes(w)),
});

// Stand-ins (test only): the real cards' own details are the card agents' job.
for (const c of EXPANSION_CARDS.Assassins) {
  const kw = c.keywords ?? [];
  if (kw.includes('Zap')) {
    const m = /take over (\w+) Groups/.exec(c.text);
    registerZap(c.id, m ? { noTakeover: { alignments: [m[1] as Alignment] } } : { noInstants: /Assassinations or Disasters/.test(c.text) });
  } else if (kw.includes('Paralysis')) {
    const m = /Paralysis on an? (\w+) Group\. Costs an Illuminati action, or (\w+) actions/.exec(c.text);
    if (m) registerPlots({ [c.id]: paralysisPlot({ on: { alignments: [m[1] as Alignment] }, pay: { alignments: [m[2] as Alignment] } }) });
  } else if (kw.includes('Freeze')) {
    const m = /Freeze on ([\w ,]+?)(?: Groups)?[:,]/.exec(c.text);
    const words = m ? m[1].split(/,? and |, /).map((w) => w.trim()) : [];
    if (words.length) registerPlots({ [c.id]: freezePlot({ match: matchOf(words), label: words.join('/') }) });
  }
}

function play(settings: Partial<GameSettings>, seed: number, n: number, sets: CardSet[], maxTurns = 50) {
  const players: NewPlayer[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`, name: `P${i + 1}`, isAI: true,
    deck: settings.subgeniusRules ? { illuminati: CHURCH, plots: [], groups: [] } : randomDeck(seed * 11 + i, undefined, { sets, unimplemented: true }),
  }));
  let s: GameState = createGame({ seed, players, settings });
  let steps = 0;
  while (s.phase !== 'gameOver' && s.turn < maxTurns && steps < 8000) {
    const who = waitingFor(s)[0];
    const a = chooseAction(s, who);
    try { s = applyAction(s, who, a); } catch (e) {
      throw new Error(`seed ${seed} step ${steps} turn ${s.turn}: ${who} ${JSON.stringify(a)} -> ${(e as Error).message}\n${s.log.slice(-8).map((l) => l.text).join('\n')}`);
    }
    checkInvariants(s);
    steps++;
  }
  // No stall: the game either ended or reached the turn limit.
  expect(s.phase === 'gameOver' || s.turn >= maxTurns, `seed ${seed} stalled at turn ${s.turn}`).toBe(true);
  return s;
}

const cardsUsed = (s: GameState, set: CardSet) => Object.values(s.cards).filter((c) => CARDS[c.cardId].set === set && c.zone !== 'plotDeck' && c.zone !== 'groupDeck').length;

describe('computer games with the expansion packs forced on', () => {
  it('Assassins mixed into standard games', () => {
    let zaps = 0, used = 0, over = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = play({ expansions: { assassins: true } }, seed, 2 + (seed % 3), ['Base', 'Assassins']);
      zaps += s.log.filter((l) => /Zaps|Paralyzed|Frozen/.test(l.text)).length;
      used += cardsUsed(s, 'Assassins');
      if (s.phase === 'gameOver') over++;
    }
    console.log(`Assassins: ${over}/12 finished, ${used} pack cards seen, ${zaps} Zap/Paralysis/Freeze events`);
    expect(used).toBeGreaterThan(0);
    expect(zaps).toBeGreaterThan(0);
  }, 600_000);
  it('SubGenius cards mixed into standard games', () => {
    let used = 0, over = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = play({ expansions: { subgenius: true } }, seed, 2 + (seed % 2), ['Base', 'SubGenius']);
      used += cardsUsed(s, 'SubGenius');
      if (s.phase === 'gameOver') over++;
    }
    console.log(`SubGenius mixed: ${over}/6 finished, ${used} pack cards seen`);
    expect(used).toBeGreaterThan(0);
  }, 600_000);
  it('the stand-alone SubGenius game (shared decks, uncontrolled area, Slack)', () => {
    let over = 0, captured = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = play({ subgeniusRules: true }, seed, 2 + (seed % 3), ['SubGenius'], 60);
      captured += s.log.filter((l) => /takes control of|takes over/.test(l.text)).length;
      if (s.phase === 'gameOver') over++;
    }
    console.log(`SubGenius game: ${over}/12 finished, ${captured} takeovers`);
    expect(captured).toBeGreaterThan(0);
  }, 600_000);
});
