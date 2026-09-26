// Assassins pack, batch "assassins3": 5 NWOs plus 20 Plot cards (see docs/CARD_SCRIPTING.md,
// "Expansions", and docs/EXPANSIONS.md). Built from src/data/expansions/assassins.json and the
// verbatim rules text in the local research transcript; card text and comments here are paraphrased.
import type { Alignment, GameState, PlotPlay } from '../types';
import type { PlotHandler } from '../plotTypes';
import { registerPlots } from '../plotTypes';
import { registerHooks, registerChoice } from '../hooks';
import { registerZap, paralysisPlot, freezePlot } from './families';
import { plusTen } from './plots';
import { cardName, def } from '../cards';
import { alignments, attributes } from '../stats';
import { nwoColor } from '../nwo';
import { structureCards, openArrows } from '../geometry';
import { shuffle } from '../rng';
import {
  askChoice, attackCancelled, discardCard, exposeCards, giveToken, isCancelled, log, placeGroup,
  player, revealTo, zappedPlayer, zapsOn,
} from '../game';
import { groupDeckOf, sgRules } from '../expansions';

// ---------------------------------------------------------------- helpers

const isPlace = (s: GameState, iid: string) => def(s, iid).subtype === 'Place';
const isGroup = (s: GameState, iid: string) => def(s, iid).type === 'Group';
const hasAlign = (s: GameState, iid: string, a: Alignment) => alignments(s, iid).includes(a);
const hasAttr = (s: GameState, iid: string, a: string) => attributes(s, iid).includes(a);
const own = (s: GameState, pl: string, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure' && s.cards[iid].controller === pl;
const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';

function rivalOf(s: GameState, pl: string, target?: string): string | undefined {
  const c = target ? s.cards[target] : undefined;
  if (!c || !target || def(s, target).type !== 'Illuminati' || c.zone !== 'structure') return undefined;
  const who = c.controller;
  return who && who !== pl && !player(s, who).eliminated ? who : undefined;
}

/** Place an NWO card, replacing any earlier one of the same printed colour (as plots2.ts / plots6.ts). */
function placeNwo(s: GameState, play: PlotPlay) {
  const color = nwoColor(s.cards[play.card].cardId);
  const prev = s.nwo[color];
  if (prev && prev !== play.card) { discardCard(s, prev); log(s, `${def(s, prev).name} is replaced.`); }
  s.nwo[color] = play.card;
  s.cards[play.card].linkedTo = 'nwo';
}

/** A plain New World Order with no extra step. */
function nwo(): PlotHandler {
  return {
    timing: ['nwo'],
    check: () => null,
    apply: (s, _pl, play, ctx) => { if (ctx) placeNwo(s, play); },
    resolve: (s, _pl, play) => placeNwo(s, play),
  };
}

// ---------------------------------------------------------------- New World Orders

registerPlots({
  // Blue NWO. Coastal Places get -2 Power (never below 1, i.e. never more than a printed 1 Power is
  // taken away); every other Place but a Space Place becomes Coastal; Green Groups get +2 Power.
  'global-warming': nwo(),
  // Red NWO. Magic Resources do nothing and Magic Groups get -1 Power (still counted normally for
  // Goals); every Illuminati gets -1 Power and nobody makes an automatic takeover.
  'the-magic-goes-away': nwo(),
  // Yellow NWO. Fanatic Groups no longer oppose one another: Fanatic becomes one shared alignment
  // (stats.ts isOpposite/alignmentPairs read this through nwo.ts's fanaticUnited). Fanatic Groups that
  // are not also Weird get +2 Power.
  'visualize-whirled-peas': nwo(),
  // Blue NWO. The player's choice, declared on play: (a) only the Basic Goal can win a game, or (b) the
  // Basic Goal needs two more Groups. The effect itself is read straight off this table card by
  // goalNeeded/goalOptions (game.ts) and nwo.ts's interestingTimesMode, since it is not a per-card stat.
  'interesting-times': {
    timing: ['nwo'],
    needs: { mode: ['basic', 'harder'] },
    check: (_s, _pl, play) => (play.mode === 'basic' || play.mode === 'harder' ? null : 'Choose "Basic Goal only" or "Basic Goal +2".'),
    apply(s, _pl, play, ctx) { if (ctx) { placeNwo(s, play); s.cards[play.card].data = { mode: play.mode }; } },
    resolve(s, _pl, play) { placeNwo(s, play); s.cards[play.card].data = { mode: play.mode }; },
  },
  // Blue NWO, or (mode 'link') linked for good to a Green or Communist Group of the player's own,
  // making it both alignments permanently; the card then counts as an ordinary Plot, not an NWO.
  'watermelons': {
    timing: ['nwo'],
    needs: { target: 'ownGroup', mode: ['nwo', 'link'] },
    check(s, pl, play, ctx) {
      if ((play.mode ?? 'nwo') === 'nwo') return null;
      if (ctx) return 'Play the link outside an attack.';
      if (!own(s, pl, play.target) || !isGroup(s, play.target!) || !(hasAttr(s, play.target!, 'Green') || hasAttr(s, play.target!, 'Communist'))) {
        return 'Choose a Green or Communist Group you control.';
      }
      return null;
    },
    apply(s, _pl, play, ctx) { if (ctx && (play.mode ?? 'nwo') === 'nwo') placeNwo(s, play); },
    resolve(s, pl, play) {
      if ((play.mode ?? 'nwo') === 'nwo') { placeNwo(s, play); return; }
      s.cards[play.card].linkedTo = play.target;
      log(s, `Watermelons links to ${cardName(s, play.target!)}: it becomes Green and Communist for good.`, pl);
    },
    // No linkLegal: the link is permanent ("for good"), and syncConditions treats any linkLegal card's
    // linkedTo as another card's iid, which would wrongly discard the NWO-mode copy (linkedTo: 'nwo').
  },
});

registerHooks({
  'global-warming': {
    attributeMod: (s, _self, iid, current) =>
      (isPlace(s, iid) && !current.includes('Space') && !current.includes('Coastal') ? [...current, 'Coastal'] : current),
    powerMod(s, _self, iid) {
      // "Green Groups" covers any card of type Group (Organizations, Places and Personalities alike).
      let n = hasAttr(s, iid, 'Green') ? 2 : 0;
      if (isPlace(s, iid) && attributes(s, iid).includes('Coastal')) n -= Math.min(2, Math.max(0, (def(s, iid).power ?? 0) - 1));
      return n;
    },
  },
  'the-magic-goes-away': {
    powerMod: (s, _self, iid) => (isGroup(s, iid) && hasAttr(s, iid, 'Magic') ? -1 : def(s, iid).type === 'Illuminati' ? -1 : 0),
    disablesAbilities: (s, _self, iid) => def(s, iid).type === 'Resource' && hasAttr(s, iid, 'Magic'),
    forbidAttack: (_s, _self, _attacker, _target, type) => (type === 'takeover' ? 'The Magic Goes Away: no automatic takeovers.' : null),
  },
  'visualize-whirled-peas': {
    powerMod: (s, _self, iid) => (isGroup(s, iid) && hasAlign(s, iid, 'Fanatic') && !hasAlign(s, iid, 'Weird') ? 2 : 0),
  },
  'watermelons': {
    attributeMod(s, self, iid, current) {
      const c = s.cards[self];
      if (c.linkedTo === 'nwo') {
        if (current.includes('Green') && !current.includes('Communist')) return [...current, 'Communist'];
        if (current.includes('Communist') && !current.includes('Green')) return [...current, 'Green'];
        return current;
      }
      // Linked to a single Group for good: it is permanently both.
      if (iid === c.linkedTo) {
        const out = [...current];
        if (!out.includes('Green')) out.push('Green');
        if (!out.includes('Communist')) out.push('Communist');
        return out;
      }
      return current;
    },
  },
});

// ---------------------------------------------------------------- Zaps

registerZap('a-brief-attack-of-conscience', { noInstants: true });
registerZap('anarchists-unite', { noTakeover: { attributes: ['Government'] } });
registerZap('anything-worth-doing-is-worth-overdoing', { noTakeover: { alignments: ['Conservative'] } });
registerZap('bait-and-switch', { noTakeover: { alignments: ['Corporate'] } });
registerZap('brushfire-war', { noTakeover: { alignments: ['Peaceful'] } });
registerZap('back-to-the-drawing-board', {
  hooks: {
    beforeDraw: (s, self, pl, deck) => (deck === 'group' && s.cards[s.cards[self].linkedTo!]?.controller === pl ? 'plotInstead' : undefined),
  },
});

// ---------------------------------------------------------------- Attribute Freezes

registerPlots({
  'backfire': freezePlot({ match: { attributes: ['Magic'] }, label: 'Magic' }),
  'bite-the-wax-tadpole': freezePlot({ match: { attributes: ['Media'] }, label: 'Media' }),
});

// ---------------------------------------------------------------- Paralysis

registerPlots({
  'cat-juggling': paralysisPlot({ on: { alignments: ['Peaceful'] }, pay: { alignments: ['Violent'] } }),
  'chain-letter': paralysisPlot({ on: { alignments: ['Straight'] }, pay: { alignments: ['Weird'] } }),
  'contract-on-america': paralysisPlot({ on: { alignments: ['Liberal'] }, pay: { alignments: ['Conservative'] } }),
  'crackdown-on-crime': paralysisPlot({ on: { alignments: ['Criminal'] }, pay: { attributes: ['Government'] } }),
  // Fanatic actions pay for a Paralysis on a Fanatic Group too (the card names the same alignment twice).
  'death-to-all-fanatics': paralysisPlot({ on: { alignments: ['Fanatic'] }, pay: { alignments: ['Fanatic'] } }),
});

// ---------------------------------------------------------------- Alien Abduction

/** The first open spot in a player's own Power Structure, as an automatic takeover would pick one:
 *  this card names which Personality to grab, not where — so, like an automatic takeover, the first
 *  open arrow is used. */
function firstOpenSpot(s: GameState, pl: string): { onto: string; side: import('../types').Side } | undefined {
  for (const m of structureCards(s, pl)) {
    const side = openArrows(s, m)[0];
    if (side) return { onto: m, side };
  }
  return undefined;
}

registerPlots({
  'alien-abduction': {
    timing: ['anytime'],
    needs: { target: 'personality', mode: ['blank', 'abduct'] },
    check(s, pl, play, ctx) {
      if ((play.mode ?? 'blank') === 'blank') {
        return inPlay(s, play.target) && def(s, play.target!).subtype === 'Personality' ? null : 'Choose a Personality in play.';
      }
      if (ctx) return 'Play the abduction outside an attack.';
      const t = play.target ? s.cards[play.target] : undefined;
      if (!t || def(s, play.target!).subtype !== 'Personality') return 'Choose a Personality.';
      const fromHand = t.zone === 'hand' && player(s, pl).hand.includes(play.target!);
      const fromArea = sgRules(s) && t.zone === 'uncontrolled';
      if (!fromHand && !fromArea) return 'Choose a Personality in your hand (or the uncontrolled area).';
      if (!firstOpenSpot(s, pl)) return 'Your Power Structure has no open arrow left.';
      const payer = play.payWith?.length === 1 ? s.cards[play.payWith[0]] : undefined;
      if (!payer || payer.controller !== pl || payer.zone !== 'structure' || payer.tokens < 1) return 'Pay with the action of the UFOs or a Space Group of yours.';
      const isUfos = payer.cardId === 'ufos' && player(s, pl).illuminati === play.payWith![0];
      if (!isUfos && !hasAttr(s, play.payWith![0], 'Space')) return 'Pay with the action of the UFOs or a Space Group of yours.';
      return null;
    },
    apply(s, _pl, play, ctx) {
      if ((play.mode ?? 'blank') === 'blank') { if (ctx) s.cards[play.card].linkedTo = play.target; return; }
      s.cards[play.payWith![0]].tokens--;
    },
    resolve(s, pl, play) {
      if ((play.mode ?? 'blank') === 'blank') { s.cards[play.card].linkedTo = play.target; return; }
      const spot = firstOpenSpot(s, pl);
      const t = play.target ? s.cards[play.target] : undefined;
      if (!spot || !t) return;
      if (t.zone === 'hand') player(s, pl).hand = player(s, pl).hand.filter((c) => c !== play.target);
      placeGroup(s, play.target!, pl, spot.onto, spot.side);
      s.cards[play.target!].tokens = 0;
      log(s, `${cardName(s, play.target!)} is abducted straight into ${player(s, pl).name}'s Power Structure.`, pl);
    },
    linkLegal: (s, _p, g) => (s.cards[g] && s.cards[g].zone === 'structure' ? 'ok' : 'discard'),
  },
});
registerHooks({
  'alien-abduction': {
    // Until the end of the turn: the linked Personality has no alignments and cannot gain any "for any
    // reason": `lastWord` makes this override run after every other alignment-changing card.
    lastWord: true,
    alignmentMod: (s, self, iid, current) => (iid === s.cards[self].linkedTo ? [] : current),
    onTurnStart: (s, self) => { if (s.cards[self].data?.turn !== s.turn) discardCard(s, self); },
  },
});

// ---------------------------------------------------------------- Back to the Salt Mines

const SALT_MINES = 'back-to-the-salt-mines';
const liveCopyBy = (s: GameState, ctx: import('../types').AttackCtx, who: string) =>
  ctx.plays.find((p) => p.player === who && s.cards[p.iid]?.cardId === SALT_MINES && s.cards[p.iid].zone === 'table' && !isCancelled(ctx.plays, p.iid));

registerPlots({
  [SALT_MINES]: {
    timing: ['attack'],
    check(s, pl, _play, ctx) {
      if (!ctx || ctx.instant) return 'Play this when a Place is attacked, not by an Instant attack.';
      if (!isPlace(s, ctx.target)) return 'Only an attack on a Place can play this card.';
      if (pl !== ctx.attackerPlayer && pl !== ctx.targetPlayer) return 'Only the attacker or the defender may play this.';
      // "Only one such card may be played during any attack; if a defender plays this card, an attacker
      // must take his back": one live copy per attack. The defender's copy bumps the attacker's back to
      // hand; the attacker may not play one over the defender's.
      if (pl === ctx.attackerPlayer && liveCopyBy(s, ctx, ctx.targetPlayer!)) return 'The defender has already played Back to the Salt Mines in this attack.';
      return null;
    },
    apply(s, pl, play, ctx) {
      const side = pl === ctx!.attackerPlayer ? 'attack' : 'defense';
      if (side === 'defense') {
        const theirs = liveCopyBy(s, ctx!, ctx!.attackerPlayer);
        if (theirs) {
          ctx!.attackBonus = ctx!.attackBonus.filter((b) => b.plot !== theirs.iid);
          theirs.voided = true;
          const card = s.cards[theirs.iid];
          card.zone = 'hand'; card.controller = undefined; card.linkedTo = undefined;
          player(s, card.owner).hand.push(theirs.iid);
          log(s, `${cardName(s, theirs.iid)} is knocked back to ${player(s, card.owner).name}'s hand.`, pl);
        }
      }
      (side === 'attack' ? ctx!.attackBonus : ctx!.defenseBonus).push({ player: pl, plot: play.card, amount: 10, label: 'Back to the Salt Mines' });
      s.cards[play.card].linkedTo = `attack:${ctx!.id}`;
      s.cards[play.card].data = { side };
    },
  },
});
registerHooks({
  [SALT_MINES]: {
    onAttackEnd(s, self, ctx) {
      if (s.cards[self].linkedTo !== `attack:${ctx.id}`) return;
      const card = s.cards[self];
      if (attackCancelled(ctx)) { card.zone = 'hand'; card.controller = undefined; card.linkedTo = undefined; player(s, card.owner).hand.push(self); return; }
      const side = card.data?.side as 'attack' | 'defense' | undefined;
      const prevailed = side === 'attack' ? ctx.result === 'success' : ctx.result !== 'success';
      if (prevailed) {
        card.zone = 'hand'; card.controller = undefined; card.linkedTo = undefined;
        player(s, card.owner).hand.push(self);
        exposeCards(s, [self]);
        log(s, `${cardName(s, self)} returns to ${player(s, card.owner).name}'s hand, exposed.`, card.owner);
      } else discardCard(s, self);
    },
  },
});

// ---------------------------------------------------------------- Backmasquerade

registerPlots({
  'backmasquerade': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'ownGroup' },
    check(s, pl, play, ctx) {
      if (ctx) return 'Play this outside an attack.';
      return own(s, pl, play.target) && isGroup(s, play.target!) && hasAttr(s, play.target!, 'Magic') ? null : 'Choose a Magic Group you control.';
    },
    apply() {},
    resolve(s, pl, play) {
      const prev = Object.values(s.cards).find((c) => c.zone === 'table' && c.cardId === 'backmasquerade' && c.iid !== play.card);
      if (prev) { discardCard(s, prev.iid); log(s, 'The earlier Backmasquerade is removed.', pl); }
      s.cards[play.card].linkedTo = play.target;
      log(s, `Backmasquerade links to ${cardName(s, play.target!)}.`, pl);
    },
    linkLegal: (s, _p, g) => (s.cards[g] && s.cards[g].zone === 'structure' && hasAttr(s, g, 'Magic') ? 'ok' : 'discard'),
  },
});
registerHooks({
  'backmasquerade': {
    // A Group's own action, not this card's own: game.ts's checkAbility/useAbility now also accept a
    // linked table Plot that grants an ability this way (a small, generic engine change for this card).
    actions: [{
      id: 'unzap-one', label: 'Remove one Zap from any Illuminati', timing: ['anytime'], usesToken: false,
      needs: { target: 'plot' },
      check(s, _pl, self, p) {
        const group = s.cards[self].linkedTo;
        if (!group || s.cards[group]?.zone !== 'structure' || s.cards[group].tokens < 1) return 'The linked Magic Group has no Action token.';
        return p.target && zappedPlayer(s, p.target) !== undefined ? null : 'Choose a Zap card in play.';
      },
      apply(s, _pl, self, p) {
        const group = s.cards[self].linkedTo!;
        s.cards[group].tokens--;
        log(s, `${cardName(s, self)}: ${cardName(s, group)} removes ${cardName(s, p.target!)}.`, s.cards[self].controller!);
        discardCard(s, p.target!);
      },
    }],
  },
});

// ---------------------------------------------------------------- Bar Codes

registerChoice('bar-codes-shuffle', {
  resolve(s, pl, picked) {
    if (picked[0] !== 'shuffle') return;
    shuffle(s, groupDeckOf(s, pl));
    log(s, `${player(s, pl).name} shuffles their Group deck.`, pl);
  },
  ai: () => ['keep'], // the computer sees no reason to shuffle away a deck it does not know was looked at
});

registerPlots({
  'bar-codes': {
    timing: ['anytime'],
    needs: { target: 'rival' },
    check(s, pl, play) {
      if (!rivalOf(s, pl, play.target)) return 'Choose a rival.';
      const payer = play.payWith?.length === 1 ? s.cards[play.payWith[0]] : undefined;
      if (!payer || payer.controller !== pl || payer.zone !== 'structure' || payer.tokens < 1 || !hasAttr(s, play.payWith![0], 'Computer')) {
        return 'Pay with the action of one of your Computer Groups.';
      }
      return null;
    },
    apply(s, _pl, play) { s.cards[play.payWith![0]].tokens--; },
    resolve(s, pl, play) {
      const r = rivalOf(s, pl, play.target);
      if (!r) return;
      revealTo(s, pl, [...groupDeckOf(s, r)], `Bar Codes: you look through ${player(s, r).name}'s Group deck`);
      askChoice(s, r, {
        key: 'bar-codes-shuffle', question: `${player(s, pl).name} looked through your Group deck with Bar Codes. Shuffle it?`,
        options: [{ id: 'shuffle', label: 'Shuffle it' }, { id: 'keep', label: 'Leave it as is' }], min: 1, max: 1, source: play.card,
      });
    },
  },
});

// ---------------------------------------------------------------- Beach Party

registerPlots({
  'beach-party': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'place' },
    check(s, _pl, play, ctx) {
      if (ctx) return 'Play this outside an attack.';
      return inPlay(s, play.target) && isPlace(s, play.target!) && hasAttr(s, play.target!, 'Coastal') && !!s.cards[play.target!].devastated
        ? null : 'Choose a Devastated Coastal Place.';
    },
    apply() {},
    resolve(s, pl, play) {
      const t = play.target ? s.cards[play.target] : undefined;
      if (!t || !t.devastated) return;
      t.devastated = false;
      giveToken(s, play.target!);
      s.cards[play.card].linkedTo = play.target;
      log(s, `Beach Party gives Relief and an Action token to ${cardName(s, play.target!)}.`, pl);
    },
    linkLegal: (s, _p, g) => (s.cards[g] && s.cards[g].zone === 'structure' ? 'ok' : 'discard'),
  },
});
registerHooks({
  'beach-party': {
    attackMod: (s, self, ctx, side) => (side === 'defense' && !!ctx.disaster && ctx.target === s.cards[self].linkedTo ? 5 : 0),
  },
});

// ---------------------------------------------------------------- Cease-Fire

function discardTopUnseen(s: GameState, pl: string, deck: 'plot' | 'group') {
  const p = player(s, pl);
  const arr = deck === 'group' ? p.groupDeck : p.plotDeck;
  const top = arr.shift();
  if (!top) return;
  s.cards[top].zone = 'hand';
  p.hand.push(top);
  discardCard(s, top);
}

registerPlots({
  'cease-fire': {
    timing: ['anytime'],
    needs: { mode: ['plot', 'group'] },
    check(s, pl, play) {
      const zapped = s.players.filter((p) => !p.eliminated && zapsOn(s, p.id).length > 0);
      if (zapped.length < 2) return 'At least two players must currently be Zapped.';
      if (play.mode !== 'plot' && play.mode !== 'group') return 'Choose whether to discard from your Plot or Group deck.';
      const deck = play.mode === 'group' ? player(s, pl).groupDeck : player(s, pl).plotDeck;
      return deck.length ? null : `Your ${play.mode === 'group' ? 'Group' : 'Plot'} deck is empty.`;
    },
    apply(s, pl, play) { discardTopUnseen(s, pl, play.mode === 'group' ? 'group' : 'plot'); },
    resolve(s, pl) {
      let n = 0;
      for (const p of s.players) {
        const zaps = zapsOn(s, p.id);
        n += zaps.length;
        for (const z of zaps) discardCard(s, z);
      }
      log(s, `${player(s, pl).name} calls a Cease-Fire: ${n} Zap${n === 1 ? '' : 's'} removed.`, pl);
    },
  },
});

// ---------------------------------------------------------------- Crusade

// Crusade is worded exactly like the base game's +10 Plots (and their official rewording): +10 Power or
// Resistance to one of your Church Groups; with an action it is played as that action is declared (the
// Group's own attack, or its aid) and counts only for it; for defense it lasts until the end of the turn,
// for defense only, not toward Goals. So it uses the same family (plots.ts plusTen).
registerPlots({
  'crusade': plusTen({ attributes: ['Church'] }),
});
