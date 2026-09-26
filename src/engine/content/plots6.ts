// Encoded by the card-content pass. See docs/CARD_SCRIPTING.md.
// Plot cards that need the event/choice/target engine features (batch 1).
import { noteCostDiscard } from '../game';
import type { Alignment, GameEvent, GameState, PlotPlay } from '../types';
import type { PlotHandler } from '../plotTypes';
import { registerGoalProgress, registerGoals, registerPlots } from '../plotTypes';
import { goalCheck, registerChoice, registerHooks, sumHooks } from '../hooks';
import { cardName, def } from '../cards';
import { abilitiesOf } from '../abilities';
import { alignments, attributes, power } from '../stats';
import { puppets, structureCards, subtree } from '../geometry';
import { nwoColor } from '../nwo';
import { shuffle } from '../rng';
import {
  activePlayer, askChoice, canAttackPlayer, controllerOf2, discardCard, drawGroup, drawPlot, isCancelled, isSecret, log,
  player, playResourceCard, protectedPlayer, startCardAttack, startInstantAttack,
  disasterTarget,
} from '../game';
import { exposableHand, exposeCards } from '../game';

// ---------------------------------------------------------------- helpers

const own = (s: GameState, pl: string, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure' && s.cards[iid].controller === pl;
const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';
const hasAttr = (s: GameState, iid: string, a: string) => attributes(s, iid).includes(a);
const hasAlign = (s: GameState, iid: string, a: Alignment) => alignments(s, iid).includes(a);

function spend(s: GameState, pl: string, groups: string[] = []): string | null {
  for (const g of groups) if (!own(s, pl, g) || s.cards[g].tokens < 1) return 'Every paying Group must be yours and have an Action token.';
  if (new Set(groups).size !== groups.length) return 'A Group can only pay once.';
  return null;
}
function pay(s: GameState, groups: string[] = []) { for (const g of groups) s.cards[g].tokens--; }

/** Exactly one of your Groups with an action, meeting `ok`. */
function payOne(s: GameState, pl: string, payWith: string[] | undefined, ok: (g: string) => boolean, msg: string): string | null {
  const err = spend(s, pl, payWith);
  if (err) return err;
  if (payWith?.length !== 1 || !ok(payWith[0])) return msg;
  return null;
}

/** The event whose response window is open right now. */
const eventNow = (s: GameState): GameEvent | undefined => (s.window?.kind === 'event' ? s.window.event : undefined);
/** Event Plots resolve after the counter window, when the event window is closed: keep a copy. */
function remember(s: GameState, play: PlotPlay) {
  const e = eventNow(s);
  s.cards[play.card].data = { ...s.cards[play.card].data, event: e ? JSON.parse(JSON.stringify(e)) : undefined };
}
const remembered = (s: GameState, play: PlotPlay) => s.cards[play.card].data?.event as GameEvent | undefined;

/** Take a card out of whichever discard pile holds it. */
function outOfDiscard(s: GameState, iid: string) {
  for (const p of s.players) p.discard = p.discard.filter((x) => x !== iid);
}

/** Normal number of Plot draws at the start of `pl`'s turn (1 plus abilities that add more). */
function plotDrawCount(s: GameState, pl: string): number {
  let extra = 0;
  for (const iid of structureCards(s, pl)) for (const a of abilitiesOf(s, iid)) if (a.kind === 'extraPlotDraw') extra += a.value;
  extra += sumHooks(s, (h, self) => (controllerOf2(s, self) === pl ? h.extraPlotDraws?.(s, self) : 0));
  return 1 + extra;
}

/** "Before you draw" cards: only at the start of your own normal turn. */
function atOwnTurnStart(s: GameState, pl: string): string | null {
  const e = eventNow(s);
  if (e?.type !== 'turnStart' || e.player !== pl) return 'Play this at the start of your own turn, before you draw.';
  if (s.turnFlags.extraTurn || s.turnFlags.noDraws || s.extraTurnFor) return 'You are not drawing cards at the start of this turn.';
  return null;
}

const artifactOrGadget = (s: GameState, iid: string) =>
  /\b(Artifact|Gadget)\b/.test(def(s, iid).uniqueness ?? '') || (def(s, iid).attributes ?? []).some((a) => a === 'Artifact' || a === 'Gadget');
/** "Weird Science": a Weird Group with the Science attribute. */
const magicOrWeirdScience = (s: GameState, g: string) => hasAttr(s, g, 'Magic') || (hasAttr(s, g, 'Science') && hasAlign(s, g, 'Weird'));

/** The rival whose Illuminati is `target`. */
function rivalOf(s: GameState, pl: string, target?: string): string | undefined {
  const c = target ? s.cards[target] : undefined;
  if (!c || def(s, target!).type !== 'Illuminati' || c.zone !== 'structure') return undefined;
  const who = c.controller;
  return who && who !== pl && !player(s, who).eliminated ? who : undefined;
}

/** A player's Plot cards in hand that are not exposed and that other cards can reach (not beneath Texas). */
const hiddenPlots = (s: GameState, pl: string) => exposableHand(s, pl, 'Plot');

/** Turn number of `pl`'s next turn, taking turns in seat order among players still in the game. */
function nextTurnOf(s: GameState, pl: string): number {
  const seat = s.players.findIndex((p) => p.id === pl);
  let i = s.active, n = 0;
  do {
    i = (i + 1) % s.players.length;
    if (!s.players[i].eliminated) n++;
  } while (i !== seat && n <= s.players.length);
  return s.turn + n;
}

function nwo(onPlace?: (s: GameState) => void): PlotHandler {
  const place = (s: GameState, _pl: string, play: PlotPlay) => {
    const color = nwoColor(s.cards[play.card].cardId);
    const prev = s.nwo[color];
    if (prev && prev !== play.card) { discardCard(s, prev); log(s, `${def(s, prev).name} is replaced.`); }
    s.nwo[color] = play.card;
    s.cards[play.card].linkedTo = 'nwo';
    onPlace?.(s);
  };
  return {
    timing: ['nwo'],
    check: () => null,
    apply: (s, pl, play, ctx) => { if (ctx) place(s, pl, play); },
    resolve: place,
  };
}

/** A Disaster that attacks with the card's own Power (not Instant, no action needed). */
function cardDisaster(powerOf: (s: GameState, place: string) => number, disaster: { destroyMargin: number | null; devastateOnly?: boolean }, aidRule?: 'defenderOnly'): PlotHandler {
  return {
    timing: ['instant'],
    needs: { target: 'place' },
    check(s, pl, play) {
      if (s.phase !== 'main' || activePlayer(s).id !== pl || s.window || s.attack) return 'Play this as an attack in your own turn.';
      if (!disasterTarget(s, play.target)) return 'Choose a Place in play.';
      return canAttackPlayer(s, pl, s.cards[play.target!].controller);
    },
    apply(s, pl, play) {
      const p = powerOf(s, play.target!);
      startCardAttack(s, pl, { plot: play.card, target: play.target!, power: p, disaster, aidRule });
      log(s, `${cardName(s, play.card)} strikes ${cardName(s, play.target!)} with Power ${p}.`, pl);
    },
  };
}

// ---------------------------------------------------------------- Goals

registerGoals({
  // Credited with knocking out two other Illuminati (their last Group taken, or you helped take it).
  'fratricide': (s, pl) => {
    const down = s.players.filter((p) => p.id !== pl
      && (p.eliminated || puppets(s, p.illuminati).length === 0)
      && (p.lastPuppetTakenBy === pl || (p.lastPuppetHelpers ?? []).includes(pl)));
    return down.length >= 2 ? `helped bring down ${down.map((p) => p.name).join(' and ')}` : null;
  },
});
registerGoalProgress({
  // Rivals already knocked out with this player's help, and how few Groups the others have left.
  'fratricide': (s, pl) => {
    const rivals = s.players.filter((p) => p.id !== pl);
    const down = rivals.filter((p) => (p.eliminated || puppets(s, p.illuminati).length === 0) && (p.lastPuppetTakenBy === pl || (p.lastPuppetHelpers ?? []).includes(pl))).length;
    const weak = rivals.filter((p) => !p.eliminated && puppets(s, p.illuminati).length > 0).map((p) => 1 / (1 + puppets(s, p.illuminati).length)).sort((a, b) => b - a);
    return Math.min(1, (down + (down < 2 ? weak[0] ?? 0 : 0) * 0.5) / 2);
  },
});

// ---------------------------------------------------------------- the cards

registerPlots({
  // New World Orders (constant effects are hooks below).
  'military-industrial-complex': nwo(),
  'political-correctness': nwo(),
  'world-hunger': nwo((s) => {
    for (const c of Object.values(s.cards)) if (c.zone === 'structure' && green(s, c.iid)) c.tokens = 0;
  }),

  // At the start of your turn: two extra Plots from one rival's deck (or one each from two rivals);
  // no Group cards are drawn this turn. mode 'split': one from the target, one from `targets[0]`
  // (another rival's Illuminati) or else the next rival in seat order.
  'an-offer-you-can-t-refuse': {
    timing: ['event'], events: ['turnStart'],
    needs: { target: 'rival', mode: ['two', 'split'] },
    check(s, pl, play) {
      const err = atOwnTurnStart(s, pl);
      if (err) return err;
      const from = offerSources(s, pl, play);
      return typeof from === 'string' ? from : null;
    },
    apply() {},
    resolve(s, pl, play) {
      const from = offerSources(s, pl, play);
      if (typeof from === 'string') return;
      const me = player(s, pl);
      let n = 0;
      for (const r of from) {
        const top = player(s, r).plotDeck.shift();
        if (!top) continue;
        Object.assign(s.cards[top], { zone: 'hand', exposed: false });
        me.hand.push(top);
        n++;
      }
      const names = [...new Set(from)].map((r) => player(s, r).name).join(' and ');
      log(s, `${me.name} helps himself to ${n} Plot card${n === 1 ? '' : 's'} from ${names}'s deck, and will draw no Group cards this turn.`, pl);
      // Stays on the table for the rest of the turn to stop Group draws.
      s.cards[play.card].linkedTo = `turn:${s.turn}`;
      s.cards[play.card].data = { ...s.cards[play.card].data, turn: s.turn };
    },
  },

  // Right after a Group is destroyed or discarded: it can never come back. Magic Group's action.
  'and-stay-dead': {
    timing: ['event'], events: ['destroyed', 'discarded'],
    needs: { pay: 'tokens' },
    check(s, pl, play) {
      const g = eventNow(s)?.card;
      if (!g || !s.cards[g] || def(s, g).type !== 'Group') return 'Play this right after a Group is destroyed or discarded.';
      if (s.cards[g].zone !== 'destroyed' && s.cards[g].zone !== 'discard') return 'That Group is no longer out of play.';
      if (s.cards[g].data?.neverReturns) return 'That Group is already gone for good.';
      return payOne(s, pl, play.payWith, (m) => hasAttr(s, m, 'Magic'), 'Pay with the action of one of your Magic Groups.');
    },
    apply(s, _pl, play) { pay(s, play.payWith); remember(s, play); },
    resolve(s, pl, play) {
      const g = remembered(s, play)?.card;
      if (!g || (s.cards[g].zone !== 'destroyed' && s.cards[g].zone !== 'discard')) return;
      s.cards[g].data = { ...s.cards[g].data, neverReturns: true };
      // Out of the game: the 'destroyed' pile is where cards that never return are kept.
      if (s.cards[g].zone === 'discard') { outOfDiscard(s, g); s.cards[g].zone = 'destroyed'; }
      log(s, `${cardName(s, g)} is laid to rest for good: nothing can bring it back.`, pl);
    },
  },

  // After a Place is destroyed (Power 12) or Devastated (Power 9): Instant Attack to Destroy an
  // Organization. Only Magic or Weird Science Groups may join, on either side.
  'annual-convention': {
    timing: ['event', 'instant'], events: ['destroyed', 'devastated'],
    needs: { target: 'anyGroup' },
    check(s, _pl, play) {
      const e = eventNow(s);
      if (!e?.card || !s.cards[e.card] || def(s, e.card).subtype !== 'Place') return 'Play this right after a Place is destroyed or Devastated.';
      if (!inPlay(s, play.target) || def(s, play.target!).subtype !== 'Organization') return 'Choose an Organization in play.';
      return null;
    },
    apply(s, pl, play) {
      const p = eventNow(s)!.type === 'destroyed' ? 12 : 9;
      startInstantAttack(s, pl, { plot: play.card, target: play.target!, power: p });
      s.cards[play.card].linkedTo = `attack:${s.attack!.id}`;
      log(s, `The cultists gather: an Instant Attack with Power ${p} on ${cardName(s, play.target!)}.`, pl);
    },
  },

  // A rival's automatic takeover: the Group goes back to their hand and they pick another. One Group's action.
  'botched-contact': {
    timing: ['event'], events: ['takeover'],
    needs: { pay: 'tokens' },
    check(s, pl, play) {
      const e = eventNow(s);
      if (e?.type !== 'takeover' || !e.player || e.player === pl) return 'Play this right after a rival makes an automatic takeover.';
      const g = e.card;
      if (!g || def(s, g).type !== 'Group' || !own(s, e.player, g) || puppets(s, g).length) return 'Only a Group just placed by an automatic takeover can be sent back.';
      if (protectedPlayer(s, pl, e.player)) return 'That player has not finished a first turn yet.';
      return payOne(s, pl, play.payWith, () => true, 'Pay with the action of one of your Groups.');
    },
    apply(s, _pl, play) { pay(s, play.payWith); remember(s, play); },
    resolve(s, pl, play) {
      const e = remembered(s, play);
      const g = e?.card;
      if (!e?.player || !g || !own(s, e.player, g) || puppets(s, g).length) return;
      Object.assign(s.cards[g], { zone: 'hand', controller: undefined, master: undefined, x: undefined, y: undefined, tokens: 0 });
      s.cards[g].data = { ...s.cards[g].data, noTakeoverTurn: s.turn };
      player(s, e.player).hand.push(g);
      s.turnFlags.takeoverDone = false;
      s.turnFlags.redoTakeover = true;
      log(s, `The contact with ${cardName(s, g)} goes wrong: it returns to ${player(s, e.player).name}'s hand, who must pick another takeover.`, pl);
    },
  },

  // After Relief reaches a Devastated Place: the Relief is lost (house ruling) and no Relief may be
  // tried there until after your next turn.
  'corruption': {
    timing: ['event'], events: ['relief'],
    check(s) {
      const e = eventNow(s);
      if (e?.type !== 'relief' || !inPlay(s, e.card)) return 'Play this right after Relief is sent to a Devastated Place.';
      if (s.cards[e.card!].devastated) return 'That Place is already Devastated again.';
      return null;
    },
    apply(s, _pl, play) { remember(s, play); },
    resolve(s, pl, play) {
      const place = remembered(s, play)?.card;
      if (!inPlay(s, place)) return;
      const c = s.cards[place!];
      c.devastated = true;
      for (const g of subtree(s, place!)) s.cards[g].tokens = 0;
      c.data = { ...c.data, noReliefUntilTurn: nextTurnOf(s, pl) };
      log(s, `The Relief supplies for ${cardName(s, place!)} vanish: it stays Devastated, and no Relief can be tried there until after ${player(s, pl).name}'s next turn.`, pl);
    },
  },

  // A Gadget or Artifact Resource just destroyed or discarded comes back, under your control.
  'cover-of-darkness': {
    timing: ['event'], events: ['destroyed', 'discarded'],
    check(s) {
      const e = eventNow(s);
      const r = e?.card;
      if (!r || !s.cards[r] || def(s, r).type !== 'Resource' || !artifactOrGadget(s, r)) return 'Play this right after a Gadget or Artifact Resource is destroyed or discarded.';
      if (e!.type === 'discarded' && e!.data?.from !== 'resources') return 'Only a Resource that was in play.';
      if (s.cards[r].zone !== 'destroyed' && s.cards[r].zone !== 'discard') return 'That Resource is no longer lost.';
      return null;
    },
    apply(s, _pl, play) { remember(s, play); },
    resolve(s, pl, play) {
      const r = remembered(s, play)?.card;
      if (!r || (s.cards[r].zone !== 'destroyed' && s.cards[r].zone !== 'discard')) return;
      outOfDiscard(s, r);
      log(s, `Under cover of darkness, ${player(s, pl).name} spirits away ${cardName(s, r)}.`, pl);
      playResourceCard(s, r, pl);
    },
  },

  // Instead of drawing, choose the cards from one of your decks (mode 'plot' or 'group'), then
  // reshuffle it. The other deck is drawn as usual. Magic Group's action.
  // The printed 30-second search limit is not enforced online.
  'crop-circles': {
    timing: ['event'], events: ['turnStart'],
    needs: { mode: ['plot', 'group'], pay: 'tokens' },
    check(s, pl, play) {
      const err = atOwnTurnStart(s, pl);
      if (err) return err;
      if (play.mode !== 'plot' && play.mode !== 'group') return 'Choose which deck to search: plot or group.';
      const p = player(s, pl);
      if (!(play.mode === 'plot' ? p.plotDeck : p.groupDeck).length) return 'That deck is empty.';
      return payOne(s, pl, play.payWith, (m) => hasAttr(s, m, 'Magic'), 'Pay with the action of one of your Magic Groups.');
    },
    apply(s, _pl, play) { pay(s, play.payWith); },
    resolve(s, pl, play) {
      const p = player(s, pl);
      const deck = play.mode === 'group' ? 'group' : 'plot';
      const n = deck === 'plot' ? plotDrawCount(s, pl) : 1;
      s.turnFlags.noDraws = true;
      if (deck === 'plot') drawGroup(s, p); else drawPlot(s, p, plotDrawCount(s, pl));
      const pile = deck === 'plot' ? p.plotDeck : p.groupDeck;
      const k = Math.min(n, pile.length);
      if (!k) return;
      askChoice(s, pl, {
        key: 'crop-circles', question: `Crop Circles: choose ${k} card${k === 1 ? '' : 's'} from your ${deck === 'plot' ? 'Plot' : 'Group'} deck.`,
        options: pile.map((c) => ({ id: c, label: cardName(s, c) })), min: k, max: k, source: play.card, data: { deck },
      });
    },
  },

  // During a Disaster on a Place: any Magic Group may spend its action to oppose it.
  'earth-magic': {
    timing: ['attack'],
    check(_s, _pl, _play, ctx) {
      if (!ctx?.disaster || !disasterTarget(_s, ctx.target)) return 'Play this while a Disaster strikes a Place.';
      return null;
    },
    apply(s, pl, play, ctx) {
      s.cards[play.card].linkedTo = `attack:${ctx!.id}`;
      log(s, 'The earth answers: Magic Groups may now oppose this Disaster.', pl);
    },
  },

  // When a rival draws a Plot at the start of his turn: it becomes yours; discard another Plot (targets[0]).
  'embezzlement': {
    timing: ['event'], events: ['drawn'],
    needs: { target: 'rivalHand', targetsOf: 'handPlot' },
    check(s, pl, play) {
      const e = eventNow(s);
      if (e?.type !== 'drawn' || !e.player || e.player === pl) return 'Play this the moment another player draws a Plot card.';
      const t = play.target;
      if (!t || !(e.cards ?? []).includes(t) || def(s, t).type !== 'Plot' || !player(s, e.player).hand.includes(t)) return 'Choose a Plot card that player has just drawn.';
      const d = play.targets ?? [];
      if (d.length !== 1 || d[0] === play.card || !player(s, pl).hand.includes(d[0]) || def(s, d[0]).type !== 'Plot') return 'Discard exactly one other Plot card from your hand.';
      return null;
    },
    apply(s, pl, play) { discardCard(s, play.targets![0]); noteCostDiscard(s, pl, [{ kind: 'plot', place: 'hand', cards: [play.targets![0]] }]); },
    resolve(s, pl, play) {
      const t = play.target!;
      const holder = s.players.find((p) => p.hand.includes(t));
      if (!holder || holder.id === pl) return;
      holder.hand = holder.hand.filter((x) => x !== t);
      s.cards[t].exposed = false;
      player(s, pl).hand.push(t);
      log(s, `${player(s, pl).name} quietly pockets a Plot card ${holder.name} has just drawn.`, pl);
    },
  },

  // Disaster: Power 14, not Instant; it can only Devastate, never destroy.
  'epidemic': cardDisaster(() => 14, { destroyMargin: null, devastateOnly: true }),

  // A Media Group with Power 4+ pays: a Secret Group loses its Secret status for good.
  'exposed': {
    timing: ['anytime'],
    needs: { target: 'anyGroup', pay: 'tokens' },
    check(s, pl, play) {
      if (!inPlay(s, play.target) || !isSecret(s, play.target!)) return 'Choose a Secret Group in play.';
      return payOne(s, pl, play.payWith, (m) => hasAttr(s, m, 'Media') && power(s, m) >= 4, 'Pay with the action of one of your Media Groups with Power 4 or more.');
    },
    apply(s, _pl, play) { pay(s, play.payWith); },
    resolve(s, pl, play) {
      const g = play.target!;
      if (!inPlay(s, g) || !isSecret(s, g)) return;
      s.cards[g].mods.push({ source: play.card, kind: 'removeAttr', attr: 'Secret', until: 'permanent' });
      log(s, `${cardName(s, g)} is in the headlines: it is no longer Secret.`, pl);
    },
  },

  // One Group's action: a rival sets one hidden Plot aside; blind, you decide whether he exposes that
  // card or all of his other hidden Plots.
  'george-the-janitor': {
    timing: ['anytime'],
    needs: { target: 'rival', pay: 'tokens' },
    check(s, pl, play) {
      const r = rivalOf(s, pl, play.target);
      if (!r) return 'Choose a rival.';
      const err = payOne(s, pl, play.payWith, () => true, 'Pay with the action of one of your Groups.');
      if (err) return err;
      return hiddenPlots(s, r).length ? null : `${player(s, r).name} has no hidden Plot cards.`;
    },
    apply(s, _pl, play) { pay(s, play.payWith); },
    resolve(s, pl, play) {
      const r = rivalOf(s, pl, play.target);
      if (!r) return;
      const h = hiddenPlots(s, r);
      if (!h.length) return;
      askChoice(s, r, {
        key: 'george-pick', question: `${player(s, pl).name} has the janitor snooping: pick one of your hidden Plot cards.`,
        options: h.map((c) => ({ id: c, label: cardName(s, c) })), min: 1, max: 1, source: play.card, data: { snoop: pl },
      });
    },
  },

  // Disaster: Power 30 on a Coastal Place, else 24; only the defender may be helped; Devastates, or
  // destroys when the roll is made by more than 6.
  'giant-kudzu': cardDisaster((s, place) => (hasAttr(s, place, 'Coastal') ? 30 : 24), { destroyMargin: 7 }, 'defenderOnly'),

  // Right after one of your Plots is used: it returns to your hand, and Hat Trick is discarded instead.
  // Action of one Group with Power 3+.
  'hat-trick': {
    timing: ['event'], events: ['discarded'],
    needs: { target: 'discardPile', pay: 'tokens' },
    check(s, pl, play) {
      const e = eventNow(s);
      const c = e?.card;
      if (e?.type !== 'discarded' || e.data?.from !== 'table' || !c || !s.cards[c] || def(s, c).type !== 'Plot' || (e.by ?? e.player) !== pl) return 'Play this right after you use one of your Plot cards.';
      if (play.target && play.target !== c) return 'Choose the Plot card you have just used.';
      if (s.cards[c].zone !== 'discard') return 'That Plot card is no longer in the discard pile.';
      return payOne(s, pl, play.payWith, (g) => power(s, g) >= 3, 'Pay with the action of one of your Groups with Power 3 or more.');
    },
    apply(s, _pl, play) { pay(s, play.payWith); remember(s, play); },
    resolve(s, pl, play) {
      const c = remembered(s, play)?.card;
      if (!c || s.cards[c].zone !== 'discard') return;
      outOfDiscard(s, c);
      Object.assign(s.cards[c], { zone: 'hand', exposed: false });
      player(s, pl).hand.push(c);
      log(s, `With a flourish, ${cardName(s, c)} goes back into ${player(s, pl).name}'s hand.`, pl);
    },
  },
});

// ---------------------------------------------------------------- card pieces

/** Rivals An Offer You Can't Refuse takes from (one entry per card), or a reason it cannot. */
function offerSources(s: GameState, pl: string, play: PlotPlay): string[] | string {
  const a = rivalOf(s, pl, play.target);
  if (!a) return 'Choose a rival whose Plot deck you take from.';
  if (protectedPlayer(s, pl, a)) return 'That player has not finished a first turn yet.';
  if (play.mode !== 'split') return [a, a];
  let b = play.targets?.length ? rivalOf(s, pl, play.targets[0]) : undefined;
  if (!b && !play.targets?.length) {
    const seat = s.players.findIndex((p) => p.id === a);
    for (let i = 1; i < s.players.length && !b; i++) {
      const p = s.players[(seat + i) % s.players.length];
      if (p.id !== pl && p.id !== a && !p.eliminated) b = p.id;
    }
  }
  if (!b || b === a) return 'Taking one card each needs two different rivals.';
  if (protectedPlayer(s, pl, b)) return 'That player has not finished a first turn yet.';
  return [a, b];
}

/** Green Groups under World Hunger. Printed attributes and card changes only: this is read while
 *  the engine decides which abilities are switched off, so it must not ask other cards. */
function green(s: GameState, iid: string): boolean {
  if (def(s, iid).type !== 'Group') return false;
  let on = (def(s, iid).attributes ?? []).includes('Green');
  for (const m of s.cards[iid].mods) {
    if (m.kind === 'addAttr' && m.attr === 'Green') on = true;
    if (m.kind === 'removeAttr' && m.attr === 'Green') on = false;
  }
  return on;
}

/** Political Correctness asks for a Group's Power while working out its alignments: stop the loop. */
let pcBusy = false;

registerHooks({
  'military-industrial-complex': {
    // Corporate cards count as Government too, except when checking Goals.
    alignmentMod: (_s, _self, _iid, cur, goals) =>
      (goals || goalCheck.active || !cur.includes('Corporate') || cur.includes('Government') ? cur : [...cur, 'Government']),
  },
  'political-correctness': {
    // NWO_EFFECTS already gives Liberal Groups +3 Power. Conservative Groups with Power 0 or 1 turn Criminal.
    alignmentMod(s, _self, iid, cur) {
      if (pcBusy || def(s, iid).type !== 'Group' || !cur.includes('Conservative') || cur.includes('Criminal')) return cur;
      pcBusy = true;
      try { return power(s, iid) <= 1 ? [...cur, 'Criminal'] : cur; } finally { pcBusy = false; }
    },
  },
  'world-hunger': {
    noTokens: (s, _self, iid) => green(s, iid),
    disablesAbilities: (s, _self, iid) => green(s, iid),
    powerMod: (s, _self, iid) => (def(s, iid).type === 'Group' && (hasAlign(s, iid, 'Liberal') || hasAttr(s, iid, 'Nation')) ? -2 : 0),
  },
  'an-offer-you-can-t-refuse': {
    beforeDraw: (s, self, who, deck) => (deck === 'group' && who === controllerOf2(s, self) && s.cards[self].data?.turn === s.turn ? 'skip' : undefined),
    onTurnStart(s, self) { if (s.cards[self].data?.turn !== s.turn) discardCard(s, self); },
  },
  'annual-convention': {
    mayJoin: (s, self, ctx, group) => ctx.instantCard === self && magicOrWeirdScience(s, group),
    onAttackEnd(s, self, ctx) { if (ctx.instantCard === self && s.cards[self].zone === 'table') discardCard(s, self); },
  },
  'earth-magic': {
    mayJoin: (s, self, ctx, group, as) =>
      as === 'oppose' && s.cards[self].linkedTo === `attack:${ctx.id}` && !isCancelled(ctx.plays, self) && hasAttr(s, group, 'Magic'),
    onAttackEnd(s, self, ctx) { if (s.cards[self].linkedTo === `attack:${ctx.id}` && s.cards[self].zone === 'table') discardCard(s, self); },
  },
});

// ---------------------------------------------------------------- choices

registerChoice('crop-circles', {
  resolve(s, pl, picked, data) {
    const p = player(s, pl);
    const pile = data.deck === 'group' ? p.groupDeck : p.plotDeck;
    for (const c of picked) {
      const i = pile.indexOf(c);
      if (i < 0) continue;
      pile.splice(i, 1);
      s.cards[c].zone = 'hand';
      p.hand.push(c);
    }
    shuffle(s, pile);
    log(s, `${p.name} picks ${picked.length} card${picked.length === 1 ? '' : 's'} from the ${data.deck === 'group' ? 'Group' : 'Plot'} deck and shuffles the rest.`, pl);
  },
});

registerChoice('george-pick', {
  resolve(s, pl, picked, data) {
    const snoop = data.snoop as string;
    if (!snoop || player(s, snoop).eliminated) return;
    const others = hiddenPlots(s, pl).filter((c) => c !== picked[0]).length;
    log(s, `${player(s, pl).name} sets one hidden Plot card aside.`, pl);
    askChoice(s, snoop, {
      key: 'george-decide', question: `${player(s, pl).name} has set one hidden Plot card aside. Which must be exposed?`,
      options: [{ id: 'picked', label: 'The card set aside' }, { id: 'others', label: `The other hidden Plot cards (${others})` }],
      min: 1, max: 1, data: { rival: pl, picked: picked[0] },
    });
  },
  // The computer sets aside its least valuable-looking card: the first one.
});

registerChoice('george-decide', {
  resolve(s, pl, picked, data) {
    const r = data.rival as string;
    const card = data.picked as string;
    const list = picked[0] === 'picked' ? [card] : hiddenPlots(s, r).filter((c) => c !== card);
    const shown = list.filter((c) => player(s, r).hand.includes(c));
    const exposed = exposeCards(s, shown);
    log(s, `${player(s, r).name} must show ${exposed.map((c) => cardName(s, c)).join(', ') || 'nothing'}.`, pl);
  },
  // The computer exposes the larger set.
  ai: (_s, _pl, options) => [options[1].label.endsWith('(0)') || options[1].label.endsWith('(1)') ? 'picked' : 'others'],
});
