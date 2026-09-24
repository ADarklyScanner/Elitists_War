import { createGame, placeGroup, type GameState, type DeckList, type Side, CARDS } from '../src/engine';
import { randomDeck } from '../src/engine/decks';

export function newGame(seed = 1, a?: Partial<DeckList>, b?: Partial<DeckList>): GameState {
  return createGame({
    seed,
    players: [
      { id: 'p1', name: 'Alice', isAI: true, deck: { ...randomDeck(seed * 7 + 1), ...a } },
      { id: 'p2', name: 'Bob', isAI: true, deck: { ...randomDeck(seed * 7 + 2), ...b } },
    ],
  });
}

/** Every card is in exactly one place and the structures are consistent. */
export function checkInvariants(s: GameState) {
  const seen = new Map<string, string>();
  const note = (iid: string, where: string) => {
    if (seen.has(iid)) throw new Error(`${iid} is in ${seen.get(iid)} and ${where}`);
    seen.set(iid, where);
  };
  for (const p of s.players) {
    p.hand.forEach((i) => note(i, `${p.id} hand`));
    p.plotDeck.forEach((i) => note(i, `${p.id} plotDeck`));
    p.groupDeck.forEach((i) => note(i, `${p.id} groupDeck`));
    p.discard.forEach((i) => note(i, `${p.id} discard`));
  }
  const cells = new Set<string>();
  for (const c of Object.values(s.cards)) {
    if (c.tokens < 0) throw new Error(`${c.iid} has negative tokens`);
    if (c.zone === 'hand' && !s.players.some((p) => p.hand.includes(c.iid))) throw new Error(`${c.iid} zone hand but not in a hand`);
    if (c.zone === 'discard' && !seen.has(c.iid)) throw new Error(`${c.iid} zone discard but not in a pile`);
    if (c.zone === 'removed' && !s.players.find((p) => p.id === c.owner)?.eliminated) throw new Error(`${c.iid} left in limbo`);
    if (c.zone === 'structure') {
      if (seen.has(c.iid)) throw new Error(`${c.iid} in structure and ${seen.get(c.iid)}`);
      const key = `${c.controller}:${c.x},${c.y}`;
      if (cells.has(key)) throw new Error(`two cards at ${key}`);
      cells.add(key);
      if (CARDS[c.cardId].type !== 'Illuminati') {
        const m = c.master ? s.cards[c.master] : undefined;
        if (!m || m.zone !== 'structure' || m.controller !== c.controller) throw new Error(`${c.iid} has a bad master`);
        if (Math.abs(m.x! - c.x!) + Math.abs(m.y! - c.y!) !== 1) throw new Error(`${c.iid} not adjacent to master`);
      }
    }
  }
}

let n = 0;
/** Put a fresh copy of a card somewhere, bypassing the normal flow (test setup only). */
export function give(s: GameState, pl: string, cardId: string, where: { hand?: true; under?: string; side?: Side; resource?: true }) {
  if (!CARDS[cardId]) throw new Error(cardId);
  const iid = `t${++n}`;
  s.cards[iid] = { iid, cardId, owner: pl, zone: 'hand', tokens: 0, mods: [] };
  if (where.resource) { Object.assign(s.cards[iid], { zone: 'resources', controller: pl, linkedTo: s.players.find((p) => p.id === pl)!.illuminati }); return iid; }
  if (where.hand) s.players.find((p) => p.id === pl)!.hand.push(iid);
  else { placeGroup(s, iid, pl, where.under!, where.side!); s.cards[iid].tokens = 1; }
  return iid;
}

/** A game in p1's main phase, with both players past their first turn and no Groups in play. */
export function scenario(): GameState {
  const s = newGame(3);
  for (const c of Object.values(s.cards)) {
    if (c.zone === 'structure' && CARDS[c.cardId].type === 'Group') {
      c.zone = 'removed'; c.controller = undefined; c.master = undefined; c.x = undefined; c.y = undefined;
    }
  }
  for (const [k, c] of Object.entries(s.cards)) if (c.zone === 'removed') delete s.cards[k];
  for (const p of s.players) { p.turnsTaken = 1; p.hand = []; }
  for (const c of Object.values(s.cards)) if (c.zone === 'hand') { c.zone = 'removed'; delete s.cards[c.iid]; }
  s.active = 0; s.phase = 'main'; s.prompt = undefined; s.window = undefined; s.round = 3;
  s.cards[s.players[0].illuminati].tokens = 1;
  s.cards[s.players[1].illuminati].tokens = 1;
  s.nwo = {};
  return s;
}

