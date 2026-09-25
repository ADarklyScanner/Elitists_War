// Encoded by the card-content pass. See docs/CARD_SCRIPTING.md.
// Plots H–R (second batch): linked stat changes, token strippers, hand raids, Disasters and more.
import type { Alignment, AttackCtx, GameState, PlotEffect, PlotPlay, Side } from '../types';
import type { PlotHandler } from '../plotTypes';
import { registerPlots } from '../plotTypes';
import { hooksOf, registerChoice, registerHooks } from '../hooks';
import { OPPOSITE, cardName, def } from '../cards';
import { abilitiesOf, attackingGroups, matches } from '../abilities';
import { alignments, attributes, power, resistance } from '../stats';
import { depth, openArrows, structureCards } from '../geometry';
import { nextRandom, roll2d6 } from '../rng';
import {
  activePlayer, askChoice, cancelledGroups, currentOutcome, discardCard, giveToken, isCancelled, isSecret, log, placeGroup, revealTo,
  player, playResourceCard, protectedPlayer, startInstantAttack, takeoverOptions,
  disasterTarget,
} from '../game';
import { attackStrength, exposableHand, exposeCards, shownGoal } from '../game';

// ---------------------------------------------------------------- helpers

const own = (s: GameState, pl: string, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure' && s.cards[iid].controller === pl;
const isGroup = (s: GameState, iid?: string) => !!iid && !!s.cards[iid] && def(s, iid).type === 'Group';
const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';
const hasAttr = (s: GameState, iid: string, a: string) => attributes(s, iid).includes(a);
const illOf = (s: GameState, pl: string) => player(s, pl).illuminati;

/** Spend one token from each listed Group of the player. */
function spend(s: GameState, pl: string, groups: string[] = []): string | null {
  for (const g of groups) if (!own(s, pl, g) || s.cards[g].tokens < 1) return 'Every paying Group must be yours and have an Action token.';
  if (new Set(groups).size !== groups.length) return 'A Group can only pay once.';
  return null;
}
function pay(s: GameState, groups: string[] = []) { for (const g of groups) s.cards[g].tokens--; }
const totalPower = (s: GameState, groups: string[] = []) => groups.reduce((n, g) => n + power(s, g), 0);

/** Wrap an effect so it happens at once inside an attack, or after the counter window otherwise. */
function effectNow(fn: (s: GameState, pl: string, play: PlotPlay) => void): Pick<PlotHandler, 'apply' | 'resolve'> {
  return {
    apply: (s, pl, play, ctx) => { if (ctx) fn(s, pl, play); },
    resolve: fn,
  };
}

/** Rival whose card `iid` is (in play or in hand). */
function rivalOf(s: GameState, pl: string, iid?: string): string | undefined {
  if (!iid || !s.cards[iid]) return undefined;
  const c = s.cards[iid];
  const who = c.zone === 'hand' ? s.players.find((p) => p.hand.includes(iid))?.id : c.controller;
  return who && who !== pl && !player(s, who).eliminated ? who : undefined;
}
/** Hidden Plots that other cards can reach (not one hidden beneath Texas or Fidel Castro). */
const hiddenPlots = (s: GameState, pl: string, except?: string) => exposableHand(s, pl, 'Plot').filter((i) => i !== except);

/** A linked Plot's target, unless the Plot was cancelled in the attack under way. */
function liveLink(s: GameState, self: string): string | undefined {
  const c = s.cards[self];
  if (!c.linkedTo) return undefined;
  const ctx = s.attack;
  if (ctx && ctx.plays.some((p) => p.iid === self) && isCancelled(ctx.plays, self)) return undefined;
  return c.linkedTo;
}
/** A linked Plot whose Group has left play is discarded. */
function dropIfGone(s: GameState, self: string) {
  const t = s.cards[self].linkedTo;
  if (t && s.cards[t]?.zone !== 'structure' && s.cards[self].zone === 'table') discardCard(s, self);
}
/** Media Blitz: the destroyed original that a Group card in hand duplicates (never an Assassinated Personality). */
const blitzOriginal = (s: GameState, dup: string) => Object.values(s.cards).find((c) => c.cardId === s.cards[dup].cardId && c.iid !== dup
  && c.zone === 'destroyed' && !c.data?.neverReturns && !(c.killed && def(s, c.iid).subtype === 'Personality'))?.iid;
/** Media Blitz: the Group card in hand it is used for (`target`, or the first that qualifies). */
function blitzCard(s: GameState, pl: string, play: PlotPlay): string | undefined {
  const ok = (i: string) => player(s, pl).hand.includes(i) && def(s, i).type === 'Group' && !!blitzOriginal(s, i);
  if (play.target) return ok(play.target) ? play.target : undefined;
  return player(s, pl).hand.find(ok);
}

function fightDiscard(s: GameState, pl: string, rival: string, card: string) {
  discardCard(s, card);
  log(s, `${player(s, rival).name} discards ${cardName(s, card)}.`, pl);
}

function moveToHand(s: GameState, card: string, to: string, exposed: boolean) {
  for (const p of s.players) p.hand = p.hand.filter((x) => x !== card);
  Object.assign(s.cards[card], { zone: 'hand', controller: undefined, linkedTo: undefined, exposed });
  player(s, to).hand.push(card);
}

// ---------------------------------------------------------------- families

/** Target permanently gains an alignment (losing its opposite). Pay with an Illuminati action,
 *  or actions of [alignment] Groups whose Power totals the target's Resistance (x2 if it has the
 *  opposite alignment) plus its closeness bonus when a rival controls it. */
function alignmentShift(add: Alignment, after?: (s: GameState, target: string) => void): PlotHandler {
  const threshold = (s: GameState, pl: string, t: string) => {
    const opp = OPPOSITE[add];
    let n = resistance(s, t) * (opp && alignments(s, t).includes(opp) ? 2 : 1);
    if (s.cards[t].controller !== pl) { const d = depth(s, t); n += d === 1 ? 10 : d === 2 ? 5 : 0; }
    return n;
  };
  return {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'anyGroup', pay: 'tokens' },
    check(s, pl, play) {
      if (!inPlay(s, play.target) || !isGroup(s, play.target)) return 'Choose a Group in play.';
      const payers = play.payWith ?? [];
      const err = spend(s, pl, payers);
      if (err) return err;
      if (payers.length === 1 && payers[0] === illOf(s, pl)) return null;
      if (!payers.length || payers.some((g) => g === illOf(s, pl) || !alignments(s, g).includes(add))) return `Pay with your Illuminati, or with ${add} Groups.`;
      const need = threshold(s, pl, play.target!);
      if (totalPower(s, payers) < need) return `The paying ${add} Groups need at least ${need} Power in total.`;
      return null;
    },
    apply(s, _pl, play, ctx) { pay(s, play.payWith); if (ctx) shift(s, play); },
    resolve: (s, _pl, play) => shift(s, play),
  };
  function shift(s: GameState, play: PlotPlay) {
    if (!inPlay(s, play.target)) return;
    s.cards[play.target!].mods.push({ source: play.card, kind: 'addAlign', align: add, until: 'permanent' });
    s.cards[play.card].linkedTo = play.target;
    after?.(s, play.target!);
  }
}

/** Privatization: a Group that was a Dictatorship is one no longer; the Dictatorship card and its changes go. */
function endDictatorship(s: GameState, target: string) {
  const dict = Object.values(s.cards).filter((c) => c.cardId === 'dictatorship' && c.zone === 'table' && c.linkedTo === target).map((c) => c.iid);
  const t = s.cards[target];
  const sources = new Set([...dict, ...t.mods.filter((m) => s.cards[m.source]?.cardId === 'dictatorship').map((m) => m.source)]);
  if (!sources.size) return;
  t.mods = t.mods.filter((m) => !sources.has(m.source));
  for (const d of dict) discardCard(s, d);
  log(s, `${cardName(s, target)} is no longer a Dictatorship.`);
}

/** Disaster: Instant Attack to Destroy a Place. */
function disaster(opts: { power: (s: GameState, t: string) => number; destroyMargin: number | null; hugeAllowed: boolean; also?: (s: GameState) => void }): PlotHandler {
  return {
    timing: ['instant'],
    needs: { target: 'place' },
    check(s, _pl, play) {
      if (!disasterTarget(s, play.target)) return 'Choose a Place in play.';
      if (!opts.hugeAllowed && hasAttr(s, play.target!, 'Huge')) return 'This Disaster cannot strike a Huge Place.';
      return null;
    },
    apply(s, pl, play) {
      opts.also?.(s);
      startInstantAttack(s, pl, { plot: play.card, target: play.target!, power: opts.power(s, play.target!), disaster: { destroyMargin: opts.destroyMargin } });
    },
  };
}

/**
 * Impostor / Media Blitz: play from hand a duplicate of a Group that was destroyed (or of a
 * Personality that was Assassinated). It enters your Power Structure on an open arrow (of `helper`
 * if given, facing `mode` if given), and the original stops counting as destroyed for Goals.
 */
function duplicateReturn(kind: 'assassinated' | 'destroyed', payOk: (s: GameState, pl: string, g: string, dup: string) => boolean, payMsg: string): PlotHandler {
  // A Group that is gone for good (Whispering Campaign, And Stay Dead) cannot be brought back this way.
  const original = (s: GameState, dup: string) => Object.values(s.cards).find((c) => c.cardId === s.cards[dup].cardId && c.iid !== dup && c.zone === 'destroyed' && !c.data?.neverReturns
    && (kind === 'assassinated' ? !!c.killed && def(s, c.iid).subtype === 'Personality' : !(c.killed && def(s, c.iid).subtype === 'Personality')));
  const candidates = (s: GameState, pl: string) => player(s, pl).hand.filter((i) => def(s, i).type === 'Group' && !!original(s, i)
    && !Object.values(s.cards).some((c) => c.cardId === s.cards[i].cardId && c.zone === 'structure'));
  const spot = (s: GameState, pl: string, play: PlotPlay): { m: string; side: Side } | undefined => {
    const masters = play.helper ? [play.helper] : [illOf(s, pl), ...structureCards(s, pl).filter((g) => g !== illOf(s, pl))];
    for (const m of masters) {
      if (!own(s, pl, m)) continue;
      const side = openArrows(s, m).find((sd) => !play.mode || sd === play.mode);
      if (side) return { m, side };
    }
    return undefined;
  };
  const pick = (s: GameState, pl: string, play: PlotPlay) => (play.target ? play.target : candidates(s, pl)[0]);
  return {
    timing: ['anytime'],
    needs: { pay: 'tokens' },
    check(s, pl, play) {
      const dup = pick(s, pl, play);
      if (!dup || !candidates(s, pl).includes(dup)) {
        return kind === 'assassinated' ? 'You need a card in hand that duplicates an Assassinated Personality.' : 'You need a Group card in hand that duplicates a destroyed Group (not an Assassinated Personality).';
      }
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      if (play.payWith?.length !== 1 || !payOk(s, pl, play.payWith[0], dup)) return payMsg;
      if (!spot(s, pl, play)) return 'You need an open control arrow to place it on.';
      return null;
    },
    apply(s, pl, play, ctx) { pay(s, play.payWith); if (ctx) bring(s, pl, play); },
    resolve: (s, pl, play) => bring(s, pl, play),
  };
  function bring(s: GameState, pl: string, play: PlotPlay) {
    const dup = pick(s, pl, play);
    if (!dup || !player(s, pl).hand.includes(dup)) return;
    const orig = original(s, dup);
    const at = spot(s, pl, play);
    if (!orig || !at) { log(s, 'There is no longer room for the duplicate.', pl); return; }
    for (const p of s.players) p.destroyedCredit = p.destroyedCredit.filter((x) => x !== orig.iid);
    placeGroup(s, dup, pl, at.m, at.side);
    s.cards[dup].tokens = 0;
    log(s, `${cardName(s, dup)} returns to play under ${player(s, pl).name}'s control; the original no longer counts as destroyed.`, pl);
    hooksOf(s, dup)?.onEnterPlay?.(s, dup);
  }
}

// ---------------------------------------------------------------- the cards

registerPlots({
  // ---- linked stat changes
  'hidden-influence': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'anyGroup' },
    check(s, pl, play) {
      if (!inPlay(s, play.target) || !isGroup(s, play.target)) return 'Choose a Group in play.';
      return s.cards[illOf(s, pl)].tokens >= 1 ? null : 'This costs an action from your Illuminati.';
    },
    apply(s, pl, play, ctx) { s.cards[illOf(s, pl)].tokens--; if (ctx) s.cards[play.card].linkedTo = play.target; },
    resolve(s, _pl, play) { if (inPlay(s, play.target)) s.cards[play.card].linkedTo = play.target; },
  },
  'messiah': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'personality' },
    check(s, pl, play, ctx) {
      if (ctx) return 'Messiah cannot be played during an attack.';
      if (!own(s, pl, play.target) || def(s, play.target!).subtype !== 'Personality') return 'Choose a Personality you control.';
      if (Object.values(s.cards).some((c) => c.cardId === 'messiah' && c.zone === 'table' && c.linkedTo)) return 'The game allows just one Messiah on the table, and one is already there.';
      return null;
    },
    apply() {},
    resolve(s, _pl, play) { if (inPlay(s, play.target)) s.cards[play.card].linkedTo = play.target; },
  },
  'never-surrender': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'anyGroup' },
    check(s, pl, play, ctx) {
      const t = play.target;
      if (!t || !s.cards[t] || def(s, t).type !== 'Group' || !alignments(s, t).includes('Fanatic')) return 'Choose a Fanatic Group.';
      const justPlayed = !!ctx && ctx.fromHand && ctx.target === t && ctx.attackerPlayer !== pl;
      if (!inPlay(s, t) && !justPlayed) return 'Choose a Fanatic Group in play, or one a rival has just played from their hand.';
      return null;
    },
    ...effectNow((s, _pl, play) => {
      const t = s.cards[play.target!];
      if (t.zone === 'structure' || (s.attack?.fromHand && s.attack.target === play.target)) s.cards[play.card].linkedTo = play.target;
    }),
  },
  'resistance-is-useless': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'anyGroup', pay: 'tokens' },
    check(s, pl, play) {
      if (!inPlay(s, play.target) || !isGroup(s, play.target)) return 'Choose a Group in play.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      return play.payWith?.length === 1 && hasAttr(s, play.payWith[0], 'Media') ? null : 'Pay with the action of one of your Media Groups.';
    },
    apply(s, _pl, play, ctx) { pay(s, play.payWith); if (ctx) linkForTurn(s, play); },
    resolve: (s, _pl, play) => linkForTurn(s, play),
  },

  // ---- alignment changes (same family as Liberal Agenda etc.)
  'nationalization': alignmentShift('Government'),
  'privatization': alignmentShift('Corporate', endDictatorship),
  'power-corrupts': alignmentShift('Criminal'),

  // ---- Action tokens
  'market-manipulation': {
    timing: ['anytime'],
    needs: { target: 'anyGroup' },
    check(s, pl, play) {
      const t = play.target;
      if (t && (!inPlay(s, t) || !isGroup(s, t) || !(alignments(s, t).includes('Corporate') || hasAttr(s, t, 'Bank')))) return 'Choose a Corporate or Bank Group in play.';
      for (const g of play.targets ?? []) {
        if (!inPlay(s, g) || !isGroup(s, g) || !hasAttr(s, g, 'Bank')) return 'Only Bank Groups can be added to the list.';
        if (protectedPlayer(s, pl, s.cards[g].controller)) return 'That player has not finished a first turn yet.';
      }
      return null;
    },
    ...effectNow((s, pl, play) => {
      const banks = play.targets ?? Object.values(s.cards).filter((c) => c.zone === 'structure' && c.controller !== pl && def(s, c.iid).type === 'Group'
        && hasAttr(s, c.iid, 'Bank') && !protectedPlayer(s, pl, c.controller)).map((c) => c.iid);
      const all = [...new Set([...(play.target ? [play.target] : []), ...banks])].filter((g) => inPlay(s, g));
      for (const g of all) s.cards[g].tokens = 0;
      log(s, all.length ? `Action tokens removed from ${all.map((g) => cardName(s, g)).join(', ')}.` : 'No Action tokens removed.', pl);
    }),
  },
  'mass-murder': {
    timing: ['anytime'],
    needs: { target: 'anyGroup', pay: 'tokens' },
    check(s, pl, play) {
      const media = (g?: string) => inPlay(s, g) && isGroup(s, g) && hasAttr(s, g!, 'Media');
      if (play.target && !media(play.target)) return 'Choose a Media Group.';
      for (const g of play.targets ?? []) {
        if (!media(g)) return 'Only Media Groups can lose their tokens.';
        if (protectedPlayer(s, pl, s.cards[g].controller)) return 'That player has not finished a first turn yet.';
      }
      const payers = play.payWith ?? [];
      const err = spend(s, pl, payers);
      if (err) return err;
      if (payers.length === 1 && payers[0] === illOf(s, pl)) return null;
      if (!payers.length || !payers.every((g) => media(g)) || totalPower(s, payers) < 5) return 'Pay with your Illuminati, or with Media Groups whose Power totals 5 or more.';
      return null;
    },
    apply(s, pl, play, ctx): PlotEffect | void {
      pay(s, play.payWith);
      if (!ctx) return;
      const acting = [ctx.attacker, ...ctx.aid.map((a) => a.iid), ...ctx.oppose.map((o) => o.iid)];
      const cancel = chosenMedia(s, pl, play).filter((g) => acting.includes(g));
      strip(s, pl, play);
      // Cancel the just-taken actions of every chosen Media Group acting in this attack. The first is this
      // Plot's own effect; the others are recorded as parts of it, so cancelling the Plot undoes them all.
      for (const g of cancel.slice(1)) ctx.plays.push({ iid: `${play.card}:cancel:${g}`, player: pl, play: { card: play.card }, effect: { t: 'cancelGroup', group: g }, partOf: play.card });
      if (cancel.length) return { t: 'cancelGroup', group: cancel[0] };
    },
    resolve: (s, pl, play) => strip(s, pl, play),
  },
  'miracle-diet-plan': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'rivalGroup', helper: true, pay: 'tokens' },
    check(s, pl, play, ctx) {
      if (ctx) return 'Miracle Diet Plan cannot be played during an attack.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      if (play.payWith?.length !== 1 || !hasAttr(s, play.payWith[0], 'Media')) return 'Pay with the action of one of your Media Groups.';
      if (!own(s, pl, play.helper) || !isGroup(s, play.helper) || !hasAttr(s, play.helper!, 'Science')) return 'Choose a Science Group you control (as the helper) to triple its next action.';
      if (!inPlay(s, play.target) || !isGroup(s, play.target) || s.cards[play.target!].controller === pl) return 'Choose a rival Group (not an Illuminati) to lose its Action tokens.';
      return null;
    },
    apply(s, _pl, play) { pay(s, play.payWith); },
    resolve(s, pl, play) {
      if (inPlay(s, play.target)) { s.cards[play.target!].tokens = 0; log(s, `${cardName(s, play.target!)} loses its Action tokens.`, pl); }
      if (own(s, pl, play.helper)) s.cards[play.card].linkedTo = play.helper;
    },
  },
  'reach-out': {
    timing: ['anytime'],
    needs: { target: 'rivalGroup' },
    check(s, pl, play) {
      if (s.phase !== 'endOfTurn' || activePlayer(s).id !== pl || s.attack) return 'Play this only at the end of your own turn.';
      if (!rivalOf(s, pl, play.target) || s.cards[play.target!].zone !== 'structure') return 'Choose a rival (one of their Groups).';
      return s.cards[illOf(s, pl)].tokens >= 1 ? null : 'This costs an action from your Illuminati.';
    },
    apply(s, pl) { s.cards[illOf(s, pl)].tokens--; },
    resolve(s, pl, play) {
      const rival = s.cards[play.target!].controller;
      for (const who of [rival, pl]) if (who) for (const g of structureCards(s, who)) s.cards[g].tokens = 0;
      log(s, `${rival ? player(s, rival).name : 'The rival'}'s Groups and ${player(s, pl).name}'s own Groups lose all their Action tokens.`, pl);
    },
  },

  // ---- hands and hidden Plots
  'let-s-you-and-him-fight': {
    timing: ['anytime'],
    needs: { target: 'rivalGroup' },
    check(s, pl, play) {
      if (!rivalOf(s, pl, play.target)) return 'Choose a rival (one of their Groups).';
      return s.cards[illOf(s, pl)].tokens >= 1 ? null : 'This costs an action from your Illuminati.';
    },
    apply(s, pl) { s.cards[illOf(s, pl)].tokens--; },
    resolve(s, pl, play) {
      const rival = rivalOf(s, pl, play.target);
      if (!rival) return;
      const pool = player(s, rival).hand.filter((i) => ['Group', 'Resource'].includes(def(s, i).type));
      if (!pool.length) { log(s, `${player(s, rival).name} has no Group cards in hand.`, pl); return; }
      if (pool.length === 1) { fightDiscard(s, pl, rival, pool[0]); return; }
      // Two cards drawn at random; the player sees them and picks the one to discard.
      const a = pool.splice(Math.floor(nextRandom(s) * pool.length), 1)[0];
      const b = pool[Math.floor(nextRandom(s) * pool.length)];
      revealTo(s, pl, [a, b], `You draw two cards at random from ${player(s, rival).name}'s hand`);
      askChoice(s, pl, {
        key: 'let-s-you-and-him-fight',
        question: `Which card must ${player(s, rival).name} discard? The other goes back to their hand.`,
        options: [a, b].map((c) => ({ id: c, label: cardName(s, c) })),
        min: 1, max: 1, source: play.card, data: { rival },
      });
    },
  },
  'logic-bomb': {
    timing: ['anytime'],
    needs: { target: 'rivalGroup', pay: 'tokens' },
    check(s, pl, play) {
      const rival = rivalOf(s, pl, play.target);
      if (!rival) return 'Choose a rival (one of their Groups or hidden Plots).';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      return play.payWith?.length === 1 && power(s, play.payWith[0]) >= 6 ? null : 'Pay with the action of one Group with Power 6 or more.';
    },
    apply(s, _pl, play) { pay(s, play.payWith); },
    // The player sees the rival's hidden Plots, then may take one (which is exposed) or none.
    resolve(s, pl, play) {
      const rival = rivalOf(s, pl, play.target);
      if (!rival) return;
      const hidden = hiddenPlots(s, rival);
      revealTo(s, pl, hidden, `The Logic Bomb shows you ${player(s, rival).name}'s hidden Plots`);
      log(s, `${player(s, pl).name} looks at ${player(s, rival).name}'s ${hidden.length} hidden Plot${hidden.length === 1 ? '' : 's'}.`, pl);
      if (!hidden.length) return;
      askChoice(s, pl, {
        key: 'logic-bomb',
        question: `Take one of ${player(s, rival).name}'s Plots? It will be exposed in your hand.`,
        options: [...hidden.map((c) => ({ id: c, label: `Take ${cardName(s, c)}` })), { id: 'none', label: 'Take nothing' }],
        min: 1, max: 1, source: play.card, data: { rival },
      });
    },
  },
  'mutual-betrayal': {
    timing: ['anytime'],
    needs: { target: 'rivalGroup', pay: 'tokens' },
    check(s, pl, play) {
      const rival = rivalOf(s, pl, play.target);
      if (!rival) return 'Choose a rival.';
      if (protectedPlayer(s, pl, rival)) return 'That player has not finished a first turn yet.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      return play.payWith?.length === 1 ? null : 'Pay with the action of one Group.';
    },
    apply(s, _pl, play) { pay(s, play.payWith); },
    // The player sees the rival's hidden Plots first, then picks which to expose (and as many of their own).
    resolve(s, pl, play) {
      const rival = rivalOf(s, pl, play.target);
      if (!rival) return;
      const theirs = hiddenPlots(s, rival);
      revealTo(s, pl, theirs, `You look at ${player(s, rival).name}'s hidden Plots`);
      log(s, `${player(s, pl).name} looks at ${player(s, rival).name}'s hidden Plots.`, pl);
      const most = Math.min(theirs.length, hiddenPlots(s, pl, play.card).length);
      if (!most) return;
      askChoice(s, pl, {
        key: 'mutual-betrayal-theirs',
        question: `Which of ${player(s, rival).name}'s Plots do you expose? You must expose as many of your own.`,
        options: theirs.map((c) => ({ id: c, label: cardName(s, c) })),
        min: 0, max: most, source: play.card, data: { rival },
      });
    },
  },
  'nice-idea-it-s-mine-now': {
    timing: ['anytime'],
    check(s, pl, play) {
      if (activePlayer(s).id !== pl) return 'Only on your own turn.';
      const goal = play.target ?? exposedGoals(s, pl)[0];
      if (!goal || !exposedGoals(s, pl).includes(goal)) return 'Choose an exposed Goal card of a rival.';
      return s.cards[illOf(s, pl)].tokens >= 1 ? null : 'This costs an action from your Illuminati.';
    },
    apply(s, pl) { s.cards[illOf(s, pl)].tokens--; },
    resolve(s, pl, play) {
      const goal = play.target ?? exposedGoals(s, pl)[0];
      if (!goal || !exposedGoals(s, pl).includes(goal)) return;
      moveToHand(s, goal, pl, true);
      log(s, `${player(s, pl).name} takes the Goal ${cardName(s, goal)}.`, pl);
    },
  },
  'impostor': duplicateReturn('assassinated',
    (s, _pl, g, dup) => alignments(s, g).some((a) => a !== 'Fanatic' && alignments(s, dup).includes(a)),
    'Pay with the action of one of your Groups sharing an alignment with that Personality.'),
  // The duplicate in hand may be played normally (a takeover attempt from hand), as if the original had
  // never been destroyed: the original goes to the discard pile and stops counting as destroyed.
  'media-blitz': {
    timing: ['anytime'],
    needs: { target: 'handGroup', pay: 'tokens' },
    check(s, pl, play) {
      const dup = blitzCard(s, pl, play);
      if (!dup || !blitzOriginal(s, dup)) return 'You need a Group card in hand that duplicates a destroyed Group (not an Assassinated Personality).';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      return play.payWith?.length === 1 && hasAttr(s, play.payWith[0], 'Media') ? null : 'Pay with the action of one of your Media Groups.';
    },
    apply(s, _pl, play) { pay(s, play.payWith); },
    resolve(s, pl, play) {
      const dup = blitzCard(s, pl, play);
      const orig = dup && blitzOriginal(s, dup);
      if (!dup || !orig) return;
      const c = s.cards[orig];
      Object.assign(c, { zone: 'discard', killed: false, controller: undefined, master: undefined, linkedTo: undefined, tokens: 0 });
      player(s, c.owner).discard.push(orig);
      for (const p of s.players) p.destroyedCredit = p.destroyedCredit.filter((x) => x !== orig);
      log(s, `${cardName(s, dup)} may now be played as if it had never been destroyed; the original no longer counts as destroyed.`, pl);
    },
  },

  // ---- attacks
  'mistaken-identity': {
    timing: ['attack', 'roll'],
    check: (_s, _pl, _play, ctx) => (ctx?.assassination ? null : 'Play this against an Assassination.'),
    apply: (): PlotEffect => ({ t: 'fail' }),
  },
  'mother-s-march': {
    timing: ['roll'],
    needs: { pay: 'tokens' },
    check(s, pl, play, ctx) {
      if (!ctx?.roll || ctx.type !== 'destroy') return 'Play this right after an Attack to Destroy has succeeded.';
      if (currentOutcome(s, ctx) !== 'success') return 'Only after the Attack to Destroy has succeeded.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      return play.payWith?.length === 1 && power(s, play.payWith[0]) >= 3 ? null : 'Pay with the action of one Group with Power 3 or more.';
    },
    apply(s, pl, play, ctx): PlotEffect {
      pay(s, play.payWith);
      ctx!.attackBonus.push({ player: pl, plot: play.card, amount: -4, label: "Mothers' March" });
      // No one may change the strength of the re-rolled attack: fix it now.
      const { attack, defense } = attackStrength(s, ctx!);
      ctx!.strengthLock = { attack, defense, by: play.card };
      const dice = roll2d6(s);
      log(s, `Re-roll at −4: ${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}.`, pl);
      return { t: 'reroll', dice };
    },
  },
  'payoff': {
    timing: ['counter', 'attack'],
    needs: { target: 'plot' },
    check(s, pl, play, ctx) {
      const pool = ctx?.plays ?? [];
      const pp = pool.find((p) => p.iid === play.target);
      if (!pp || !s.cards[pp.iid] || def(s, pp.iid).type !== 'Group' || pp.player === pl) return 'Play this when a rival plays a duplicate of one of your Groups.';
      if (!Object.values(s.cards).some((c) => c.zone === 'structure' && c.controller === pl && c.cardId === s.cards[pp.iid]?.cardId)) return 'That card does not duplicate a Group you control.';
      return null;
    },
    apply: (_s, _pl, play): PlotEffect => ({ t: 'cancelPlot', target: play.target! }),
  },
  'plague-of-demons': {
    timing: ['instant', 'declare', 'attack'],
    needs: { target: 'anyGroup', mode: ['disaster', 'boost'], pay: 'tokens' },
    check(s, pl, play, ctx) {
      if ((play.mode ?? 'disaster') === 'boost') {
        if (!ctx || ctx.type !== 'destroy' || !matches(s, ctx.target, { attributes: ['Magic'] })) return 'Discard it for +10 to an Attack to Destroy a Magic Group.';
        if (play.target && play.target !== ctx.target) return 'The bonus goes to the attack on the Magic Group.';
        return null;
      }
      if (ctx) return 'The Disaster is an Instant Attack: play it when no attack is under way.';
      if (!disasterTarget(s, play.target)) return 'Choose a Place in play.';
      if (hasAttr(s, play.target!, 'Huge')) return 'Plague of Demons cannot strike a Huge Place.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      return play.payWith?.length === 1 && matches(s, play.payWith[0], { attributes: ['Magic'] }) ? null : 'Spend the action of one of your Magic Groups.';
    },
    apply(s, pl, play) {
      // Plays during an attack come here without ctx (Instant-capable Plot): use the attack in progress.
      if ((play.mode ?? 'disaster') === 'boost') {
        s.attack?.attackBonus.push({ player: pl, plot: play.card, amount: 10, label: 'Plague of Demons' });
        return;
      }
      const g = play.payWith![0];
      const p = 10 + power(s, g);
      pay(s, play.payWith);
      startInstantAttack(s, pl, { plot: play.card, target: play.target!, power: p, disaster: { destroyMargin: 6 } });
    },
  },
  'nuclear-accident': disaster({
    power: (s, t) => (hasAttr(s, t, 'Huge') ? 14 : 18), destroyMargin: 5, hugeAllowed: true,
    also: (s) => {
      for (const c of Object.values(s.cards)) {
        if (c.cardId === 'nuclear-power-companies' && c.zone === 'structure' && c.tokens > 0) { c.tokens = 0; log(s, 'Nuclear Power Companies loses its action token.'); }
      }
    },
  }),
  'rain-of-frogs': disaster({
    power: (s, t) => 10 + 4 * Object.values(s.cards).filter((c) => c.cardId === 'the-frog-god' && c.zone === 'resources' && c.controller === s.cards[t].controller).length,
    destroyMargin: 7, hugeAllowed: true,
  }),

  // ---- turn structure
  'power-grab': {
    timing: ['anytime'],
    needs: { helper: true },
    check(s, pl, play, ctx) {
      if (ctx || s.phase !== 'main' || activePlayer(s).id !== pl) return 'Play this on your own turn, right after your automatic takeover.';
      let i = s.log.length - 1;
      while (i >= 0 && !(s.log[i].turn === s.turn && s.log[i].player === pl && /automatically|into play/.test(s.log[i].text))) i--;
      if (!s.turnFlags.takeoverDone || i < 0 || s.log.slice(i + 1).some((e) => e.player === pl && !e.info)) return 'Play this right after your automatic takeover, before doing anything else.';
      return grabOption(s, pl, play) ? null : 'You have no second automatic takeover to make (choose a card in hand and an open arrow).';
    },
    apply() {},
    resolve(s, pl, play) {
      const o = grabOption(s, pl, play);
      if (o) {
        if (def(s, o.card).type === 'Resource') playResourceCard(s, o.card, pl);
        else {
          placeGroup(s, o.card, pl, o.onto, o.side);
          log(s, `${player(s, pl).name} takes over ${cardName(s, o.card)} automatically.`, pl);
          hooksOf(s, o.card)?.onEnterPlay?.(s, o.card);
          giveToken(s, o.card);
        }
      }
      log(s, `${player(s, pl).name}'s turn ends at once.`, pl);
      s.phase = 'endOfTurn';
      // A turn cut short skips the rest of the turn sequence: nobody can win at its end (R016).
      s.turnFlags.endedAtOnce = true;
    },
  },
});

function linkForTurn(s: GameState, play: PlotPlay) {
  if (!inPlay(s, play.target)) return;
  s.cards[play.card].linkedTo = play.target;
  s.cards[play.card].data = { turn: s.turn };
}

/** Mass Murder: the Media Groups chosen (`target` and `targets`; by default every rival Media Group). */
function chosenMedia(s: GameState, pl: string, play: PlotPlay): string[] {
  const list = play.targets ?? Object.values(s.cards).filter((c) => c.zone === 'structure' && c.controller !== pl && def(s, c.iid).type === 'Group'
    && hasAttr(s, c.iid, 'Media') && !protectedPlayer(s, pl, c.controller)).map((c) => c.iid);
  return [...new Set([...(play.target ? [play.target] : []), ...list])].filter((g) => inPlay(s, g));
}
function strip(s: GameState, pl: string, play: PlotPlay) {
  const all = chosenMedia(s, pl, play);
  for (const g of all) s.cards[g].tokens = 0;
  log(s, all.length ? `Media Groups lose their Action tokens: ${all.map((g) => cardName(s, g)).join(', ')}.` : 'No Media Groups lose tokens.', pl);
}

function exposedGoals(s: GameState, pl: string): string[] {
  return s.players.filter((p) => p.id !== pl && !p.eliminated && !protectedPlayer(s, pl, p.id))
    .flatMap((p) => p.hand.filter((i) => def(s, i).subtype === 'Goal' && s.cards[i].exposed && !shownGoal(s, i)));
}

function grabOption(s: GameState, pl: string, play: PlotPlay) {
  return takeoverOptions(s, pl).find((o) => (!play.target || o.card === play.target)
    && (def(s, o.card).type === 'Resource' || ((!play.helper || o.onto === play.helper) && (!play.mode || o.side === play.mode))));
}

// ---------------------------------------------------------------- ongoing effects of linked Plots

const defenseAbilityBonus = (s: GameState, t: string, ctx: AttackCtx): number => {
  if (!ctx.targetPlayer || isSecret(s, t) || (!!ctx.attacker && isSecret(s, ctx.attacker))) return 0;
  const attackers = ctx.instant ? [] : attackingGroups(ctx);
  let n = 0;
  for (const g of structureCards(s, ctx.targetPlayer)) {
    for (const a of abilitiesOf(s, g)) {
      if (a.kind !== 'structureDefense' && !(a.kind === 'selfDefense' && g === t)) continue;
      const kindOk = !a.on || a.on === 'both' || a.on === ctx.type;
      if (kindOk && (!ctx.instant || a.instant) && (!a.vs || attackers.some((x) => matches(s, x, a.vs)))) n += a.value;
    }
  }
  return n;
};

const churches = (s: GameState, pl?: string) => (pl ? structureCards(s, pl).filter((g) => def(s, g).type === 'Group' && (def(s, g).attributes ?? []).includes('Church')).length : 0);

registerHooks({
  // Global Power is capped at Power, so a large bonus makes it equal to Power.
  'hidden-influence': {
    globalMod: (s, self, iid) => (liveLink(s, self) === iid ? 1000 : 0),
    onTurnStart: dropIfGone,
  },
  'messiah': {
    powerMod: (s, self, iid) => (liveLink(s, self) === iid ? 4 + 2 * churches(s, s.cards[self].controller) : 0),
    resistanceMod: (s, self, iid) => (liveLink(s, self) === iid ? 4 + 2 * churches(s, s.cards[self].controller) : 0),
    onTurnStart: dropIfGone,
  },
  // Resistance raised to 12 (measured from the printed value).
  'never-surrender': {
    resistanceMod: (s, self, iid) => (liveLink(s, self) === iid ? Math.max(0, 12 - (def(s, iid).resistance ?? 0)) : 0),
    onAttackEnd: (s, self) => dropIfGone(s, self),
    onTurnStart: dropIfGone,
  },
  'resistance-is-useless': {
    resistanceMod: (s, self, iid) => (liveLink(s, self) === iid && s.cards[self].data?.turn === s.turn ? -1000 : 0),
    // No bonus from shared alignments with its master or from special abilities (control attacks).
    attackMod(s, self, ctx, side) {
      const t = liveLink(s, self);
      if (side !== 'defense' || ctx.type !== 'control' || t !== ctx.target || s.cards[self].data?.turn !== s.turn) return 0;
      let n = 0;
      const m = s.cards[t].master;
      if (!ctx.fromHand && m && def(s, m).type === 'Group') n += alignments(s, t).filter((x) => x !== 'Fanatic' && alignments(s, m).includes(x)).length * 4;
      return -(n + defenseAbilityBonus(s, t, ctx));
    },
    onTurnStart: (s, self) => { if (s.cards[self].data?.turn !== s.turn) discardCard(s, self); },
  },
  // The Science Group's next action (in an attack) is made at triple Power.
  'miracle-diet-plan': {
    attackMod(s, self, ctx, side) {
      const g = s.cards[self].linkedTo;
      if (!g || cancelledGroups(ctx).has(g) || s.cards[g]?.zone !== 'structure') return 0;
      const attacking = ctx.attacker === g || ctx.aid.some((a) => a.iid === g);
      const defending = ctx.oppose.some((o) => o.iid === g);
      if ((side === 'attack' && attacking) || (side === 'defense' && defending)) return 2 * power(s, g);
      return 0;
    },
    onAttackEnd(s, self, ctx) {
      const g = s.cards[self].linkedTo;
      if (g && [ctx.attacker, ...ctx.aid.map((a) => a.iid), ...ctx.oppose.map((o) => o.iid)].includes(g)) {
        log(s, 'The Miracle Diet Plan has been used.');
        discardCard(s, self);
      }
    },
    onTurnStart: dropIfGone,
  },
  // Alignment-change Plots only need to leave when their Group does.
  'nationalization': { onTurnStart: dropIfGone },
  'privatization': { onTurnStart: dropIfGone },
  'power-corrupts': { onTurnStart: dropIfGone },
});

// ---------------------------------------------------------------- choices

registerChoice('let-s-you-and-him-fight', {
  resolve(s, pl, picked, data) {
    const rival = data.rival as string;
    const c = picked[0];
    if (!c || !player(s, rival).hand.includes(c)) return;
    fightDiscard(s, pl, rival, c);
  },
  // The computer discards the more valuable card.
  ai: (s, _pl, options) => {
    const worth = (i: string) => (def(s, i).power ?? 0) + (def(s, i).arrowsOut?.length ?? 0) + (def(s, i).type === 'Resource' ? 3 : 0);
    return [[...options].sort((a, b) => worth(b.id) - worth(a.id))[0].id];
  },
});

registerChoice('logic-bomb', {
  resolve(s, pl, picked, data) {
    const rival = data.rival as string;
    const c = picked[0];
    if (!c || c === 'none' || !hiddenPlots(s, rival).includes(c)) { log(s, `${player(s, pl).name} takes nothing.`, pl); return; }
    moveToHand(s, c, pl, true);
    log(s, `${player(s, pl).name} takes ${cardName(s, c)} from ${player(s, rival).name} and exposes it.`, pl);
  },
});

registerChoice('mutual-betrayal-theirs', {
  resolve(s, pl, picked, data) {
    const rival = data.rival as string;
    const theirs = picked.filter((c) => hiddenPlots(s, rival).includes(c));
    const source = data.source as string | undefined;
    const mine = hiddenPlots(s, pl, source);
    if (!theirs.length || mine.length < theirs.length) return;
    askChoice(s, pl, {
      key: 'mutual-betrayal-mine',
      question: `Choose ${theirs.length} of your own Plots to expose.`,
      options: mine.map((c) => ({ id: c, label: cardName(s, c) })),
      min: theirs.length, max: theirs.length, source, data: { rival, theirs },
    });
  },
});

registerChoice('mutual-betrayal-mine', {
  resolve(s, pl, picked, data) {
    const rival = data.rival as string;
    const theirs = (data.theirs as string[]).filter((c) => hiddenPlots(s, rival).includes(c));
    const mine = picked.filter((c) => hiddenPlots(s, pl).includes(c));
    if (theirs.length !== mine.length) return; // something changed hands meanwhile: expose nothing
    const shown = exposeCards(s, [...theirs, ...mine]);
    if (shown.length) log(s, `Exposed: ${shown.map((x) => cardName(s, x)).join(', ')}.`, pl);
  },
});
