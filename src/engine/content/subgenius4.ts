// SubGenius pack, batch "subgenius4": OverMan .. You'd Pay to Know What You Really Think!
// See docs/CARD_SCRIPTING.md ("Expansions") and docs/EXPANSIONS.md for the shared rules these cards
// build on (the uncontrolled area, the shared decks, "Requires ... Action" costs).
import type { AttackCtx, GameState, PlotEffect, PlotPlay } from '../types';
import { registerPlots } from '../plotTypes';
import { HOOKS, registerChoice, registerHooks, hooksOf } from '../hooks';
import { cardName, def } from '../cards';
import { alignments, attributes, power } from '../stats';
import { openArrows, puppets, structureCards, subtree } from '../geometry';
import { roll2d6, shuffle, nextRandom } from '../rng';
import { anyOf, groupActions, illuminatiAction, plotDiscards, targetAction } from '../costs';
import { sgRules, uncontrolledCards } from '../expansions';
import {
  activePlayer, askChoice, canEnterPlay, changeRoll, checkPlot, controllerOf2, discardCard,
  drawGroup, drawPlot, eventAnswered, exposableHand, exposeCards, giveToken, isCancelled, livePlayers, log, placeGroup, player,
  playPlot, playResourceCard, puppetSides, putUncontrolled, raiseEvent, resourcesOf, tokenBarred,
} from '../game';
import { describePlay, plotOptions } from '../moves';

// ---------------------------------------------------------------- small local helpers

const isGroup = (s: GameState, iid: string) => def(s, iid).type === 'Group';
const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';
const own = (s: GameState, pl: string, iid?: string) => inPlay(s, iid) && s.cards[iid!].controller === pl;
const hasAttr = (s: GameState, iid: string, a: string) => attributes(s, iid).includes(a);
const hasAlign = (s: GameState, iid: string, a: string) => (alignments(s, iid) as string[]).includes(a);

/** `needs.target: 'rival'` gives `play.target` as that rival's Illuminati card: who controls it? */
function auditee(s: GameState, pl: string, play: PlotPlay): string | undefined {
  const t = play.target;
  const r = t ? s.players.find((p) => p.illuminati === t && !p.eliminated) : undefined;
  return r && r.id !== pl ? r.id : undefined;
}

/** Plots just played, either in the counter window or during an attack (18-1/2 Minute Gap's pool). */
function counterPool(s: GameState, ctx?: AttackCtx) {
  return s.window?.kind === 'plot' ? s.window.plays ?? [] : ctx?.plays ?? [];
}

/** A card's roll outside an attack waiting for answers (a 'dieRoll' event), if there is one right now. */
function cardRollNow(s: GameState) {
  const e = eventAnswered(s);
  return e?.type === 'dieRoll' ? e : undefined;
}
/** That roll is made again (S.C.A.M., Shordurpersav). */
function rerollCardRoll(s: GameState, pl: string, why: string) {
  const e = cardRollNow(s);
  if (!e) return;
  const n = (e.data?.dice as number[] | undefined)?.length ?? 2;
  const dice = n === 2 ? roll2d6(s) : [roll2d6(s)[0]];
  changeRoll(e, { dice });
  e.data = { ...e.data, janorUsed: undefined };
  log(s, `${why}: ${player(s, e.player!).name} rolls again: ${dice.join(' + ')}${n === 2 ? ` = ${dice[0] + dice[1]}` : ''}.`, pl);
}

function pickRandom<T>(s: GameState, list: T[], n: number): T[] {
  const pool = [...list];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(nextRandom(s) * pool.length), 1)[0]);
  return out;
}

/** Send a card from wherever it sits to the bottom of the Group deck (shared, or its owner's). */
function bottomOfGroupDeck(s: GameState, pl: string, c: string) {
  if (!s.cards[c]) return;
  if (sgRules(s)) {
    if (!s.common!.uncontrolled.includes(c)) return;
    s.common!.uncontrolled = s.common!.uncontrolled.filter((x) => x !== c);
    Object.assign(s.cards[c], { zone: 'groupDeck', placedBy: undefined, placedTurn: undefined });
    s.common!.groupDeck.push(c);
  } else {
    const p = player(s, pl);
    if (!p.hand.includes(c) || def(s, c).type !== 'Group') return;
    p.hand = p.hand.filter((x) => x !== c);
    s.cards[c].zone = 'groupDeck';
    p.groupDeck.push(c);
  }
  log(s, `${cardName(s, c)} goes to the bottom of the Group deck.`, pl);
}

function doXDay(s: GameState, pl: string, play: PlotPlay) {
  const p = player(s, pl);
  const ill = player(s, pl).illuminati;
  s.cards[ill].data = { ...s.cards[ill].data, xDayTurn: s.turn };
  const plots = p.hand.filter((c) => c !== play.card && def(s, c).type === 'Plot');
  for (const c of plots) discardCard(s, c);
  const n = Math.min(4, plots.length);
  for (let i = 0; i < n; i++) drawPlot(s, p);
  log(s, `${p.name} declares X-Day: discards ${plots.length} Plot card${plots.length === 1 ? '' : 's'} and draws ${n} new one${n === 1 ? '' : 's'}.`, pl);
}

function doApostle(s: GameState, pl: string, play: PlotPlay) {
  let n = 0;
  for (const g of play.targets ?? []) {
    if (s.cards[g].zone !== 'structure' || s.cards[g].tokens !== 0 || s.cards[g].heldTokens) continue;
    // giveToken() itself respects any bar on the card getting tokens.
    giveToken(s, g);
    if (s.cards[g].tokens) n++;
  }
  log(s, `${n} Personalit${n === 1 ? 'y gets' : 'ies get'} an Action token.`, pl);
}

function doSultan(s: GameState, pl: string) {
  const ill = player(s, pl).illuminati;
  s.cards[ill].data = { ...s.cards[ill].data, sultanOfSlack: true };
  s.sultanOfSlack = { by: pl, tokens: s.cards[ill].tokens };
  log(s, `${player(s, pl).name} is the Sultan of Slack: until their next turn, nobody may win by an Illuminati Special Goal with fewer Action tokens than they hold.`, pl);
}

function doSlackfusion(s: GameState, pl: string) {
  s.turnFlags.slackfusion = true;
  log(s, `${player(s, pl).name} plays Slackfusion: Illuminati Action tokens may change hands in deals for the rest of the turn.`, pl);
}

/**
 * Sacred Jests: the rival's random Plot must be used at once, in any legal way he chooses (its target,
 * mode and payment included: every complete legal play is offered, the way the interface offers plays),
 * or discarded; a Goal is exposed instead. While he decides, the Plot counts as playable right now
 * whatever its usual moment (`forcedPlay`), as long as nothing but an attack's own timing rules it out.
 */
function doSacredJests(s: GameState, pl: string, play: PlotPlay) {
  const r = auditee(s, pl, play);
  if (!r) return;
  const p = player(s, r);
  const hand = p.hand.filter((c) => def(s, c).type === 'Plot');
  if (!hand.length) return;
  const picked = pickRandom(s, hand, 1)[0];
  if (def(s, picked).subtype === 'Goal') {
    const shown = exposeCards(s, [picked]);
    log(s, shown.length ? `${p.name} must expose ${cardName(s, picked)}.` : `${p.name}'s random Plot is a Goal that cannot be exposed.`, pl);
    return;
  }
  const plays = forcedPlays(s, r, picked);
  if (!plays.length) {
    log(s, `${p.name} cannot use ${cardName(s, picked)} right now and must discard it.`, pl);
    discardCard(s, picked);
    return;
  }
  askChoice(s, r, {
    key: 'sacred-jests', question: `Sacred Jests: use ${cardName(s, picked)} now, or discard it.`,
    options: [...plays.map((pp, i) => ({ id: `play:${i}`, label: `Play it: ${describePlay(s, pp)}` })), { id: 'discard', label: 'Discard it' }],
    min: 1, max: 1, data: { card: picked, plays },
  });
}

/** Every complete legal way for `r` to use the Plot `card` at once. */
function forcedPlays(s: GameState, r: string, card: string): PlotPlay[] {
  const saved = s.forcedPlay;
  s.forcedPlay = { player: r, card };
  try {
    return plotOptions(s, r, card).map((o) => (o.action as { play: PlotPlay }).play);
  } finally { s.forcedPlay = saved; }
}

function doPstench(s: GameState, pl: string, play: PlotPlay) {
  const r = auditee(s, pl, play);
  if (!r) return;
  if (play.mode === 'discardGoal') {
    // RULING: the player of Psychic Pstench names which exposed Goal goes, if the rival shows more than
    // one (the card forces that rival to discard "one exposed Goal"; the forcing player picks it).
    const goals = player(s, r).hand.filter((c) => s.cards[c].exposed && def(s, c).subtype === 'Goal');
    if (goals.length > 1) {
      askChoice(s, pl, {
        key: 'pstench-goal', question: `Psychic Pstench: which of ${player(s, r).name}'s exposed Goals must be discarded?`,
        options: goals.map((c) => ({ id: c, label: cardName(s, c) })), min: 1, max: 1, data: { rival: r },
      });
      return;
    }
    if (goals[0]) { log(s, `${player(s, r).name} must discard ${cardName(s, goals[0])}.`, pl); discardCard(s, goals[0]); }
    return;
  }
  const shown = exposeCards(s, exposableHand(s, r, 'Plot'));
  log(s, `${player(s, r).name} must expose ${shown.map((c) => cardName(s, c)).join(', ') || 'nothing'}.`, pl);
}

/** A Personality this player controls with an Action token and at least one open outgoing arrow. */
function openPersonalities(s: GameState, pl: string): string[] {
  return structureCards(s, pl).filter((g) => def(s, g).subtype === 'Personality' && s.cards[g].tokens > 0 && openArrows(s, g).length > 0);
}

// ---------------------------------------------------------------- Smite Them All! (sequential choices)

function smiteNext(s: GameState, remaining: string[], by: string) {
  if (remaining.length) {
    const [next, ...rest] = remaining;
    const pool = sgRules(s) ? uncontrolledCards(s) : player(s, next).hand.filter((c) => def(s, c).type === 'Group');
    if (!pool.length) { smiteNext(s, rest, by); return; }
    askChoice(s, next, {
      key: 'smite-rival', question: 'Smite Them All!: choose one Group card to send to the bottom of the Group deck.',
      options: pool.map((c) => ({ id: c, label: cardName(s, c) })), min: 1, max: 1, data: { remaining: rest, by },
    });
    return;
  }
  const pool = sgRules(s) ? uncontrolledCards(s) : player(s, by).hand.filter((c) => def(s, c).type === 'Group');
  if (!pool.length) return;
  const n = Math.min(2, pool.length);
  askChoice(s, by, {
    key: 'smite-final', question: 'Smite Them All!: choose two Group cards to send to the bottom of the Group deck.',
    options: pool.map((c) => ({ id: c, label: cardName(s, c) })), min: n, max: n, data: {},
  });
}

registerChoice('smite-rival', {
  resolve(s, pl, picked, data) {
    if (picked[0]) bottomOfGroupDeck(s, pl, picked[0]);
    smiteNext(s, (data.remaining as string[]) ?? [], data.by as string);
  },
  ai: (_s, _pl, options) => (options.length ? [options[0].id] : []),
});
registerChoice('smite-final', {
  resolve(s, pl, picked) { for (const c of picked) bottomOfGroupDeck(s, pl, c); },
});

// ---------------------------------------------------------------- Sacred Jests (forced play or discard)

registerChoice('sacred-jests', {
  resolve(s, r, picked, data) {
    const card = data.card as string;
    if (!s.cards[card] || s.cards[card].zone !== 'hand' || !player(s, r).hand.includes(card)) return;
    const i = picked[0]?.startsWith('play:') ? Number(picked[0].slice(5)) : -1;
    const chosen = (data.plays as PlotPlay[] | undefined)?.[i];
    if (chosen) {
      s.forcedPlay = { player: r, card };
      try {
        if (!checkPlot(s, r, chosen)) { playPlot(s, r, chosen); return; }
      } finally { s.forcedPlay = undefined; }
      log(s, `${cardName(s, card)} can no longer be played that way.`, r);
    }
    log(s, `${player(s, r).name} discards ${cardName(s, card)}.`, r);
    discardCard(s, card);
  },
  // A computer player uses its own card rather than lose it.
  ai: (_s, _r, options) => [(options.find((o) => o.id.startsWith('play:')) ?? options[options.length - 1]).id],
});

registerChoice('pstench-goal', {
  resolve(s, pl, picked, data) {
    const r = data.rival as string;
    const goal = picked[0];
    if (!goal || !player(s, r).hand.includes(goal) || !s.cards[goal].exposed) return;
    log(s, `${player(s, r).name} must discard ${cardName(s, goal)}.`, pl);
    discardCard(s, goal);
  },
});

// ---------------------------------------------------------------- Rant! (which arrow of the Personality)

/** Put a Group taken with Rant! under its Personality, and let rivals answer the new control (Comet Hail-"Bob"). */
function rantPlace(s: GameState, pl: string, t: string, master: string, side: string) {
  placeGroup(s, t, pl, master, side as never);
  log(s, `${cardName(s, t)} becomes a puppet of ${cardName(s, master)} at once.`, pl);
  hooksOf(s, t)?.onEnterPlay?.(s, t);
  raiseEvent(s, { type: 'gainedControl', player: pl, card: t, data: { how: 'card' } });
}
registerChoice('rant-side', {
  resolve(s, pl, picked, data) {
    const t = data.card as string, master = data.master as string;
    const sides = puppetSides(s, pl, t, master);
    const side = sides.includes(picked[0] as never) ? picked[0] : sides[0];
    if (!side || !['uncontrolled', 'hand'].includes(s.cards[t].zone) || !canEnterPlay(s, t)) { log(s, `${cardName(s, t)} can no longer be placed there.`, pl); return; }
    rantPlace(s, pl, t, master, side);
  },
});

// ---------------------------------------------------------------- Random Jesii (choose which stays hidden)

registerChoice('random-jesii', {
  resolve(s, r, picked) {
    const keep = picked[0];
    const hand = exposableHand(s, r, 'Plot');
    const shown = exposeCards(s, hand.filter((c) => c !== keep));
    if (shown.length) log(s, `${player(s, r).name} must expose ${shown.map((c) => cardName(s, c)).join(', ')}.`, r);
  },
});

// ---------------------------------------------------------------- the cards

registerPlots({
  // OverMan: link to a Personality in play (controlled or uncontrolled) that is not already a False
  // OverMan, and never to OverMan Philo Drummond; raises its Power and Global Power to 3 (an increase
  // only: def() gives the printed base, per CARD_SCRIPTING.md).
  'overman': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'anyGroup' },
    check(s, _pl, play, ctx) {
      if (ctx || s.attack) return 'OverMan cannot be played during an attack.';
      const t = play.target ? s.cards[play.target] : undefined;
      if (!t || (t.zone !== 'structure' && t.zone !== 'uncontrolled') || def(s, play.target!).subtype !== 'Personality') return 'Choose a Personality in play.';
      if (t.cardId === 'overman-philo-drummond') return 'OverMan Philo Drummond is unaffected by OverMan.';
      const already = Object.values(s.cards).some((c) => c.cardId === 'false-overman' && c.zone === 'table' && c.linkedTo === play.target);
      if (already) return `${cardName(s, play.target!)} is already a False OverMan.`;
      return null;
    },
    apply(s, pl, play, ctx) { if (ctx) { s.cards[play.card].linkedTo = play.target; log(s, `${cardName(s, play.target!)} becomes a False OverMan.`, pl); } },
    resolve(s, pl, play) {
      if (!play.target || !s.cards[play.target] || !['structure', 'uncontrolled'].includes(s.cards[play.target].zone)) return;
      s.cards[play.card].linkedTo = play.target;
      log(s, `${cardName(s, play.target)} becomes a False OverMan.`, pl);
    },
    linkLegal: (s, _plot, group) => (s.cards[group] && ['structure', 'uncontrolled'].includes(s.cards[group].zone) && def(s, group).subtype === 'Personality'
      && s.cards[group].cardId !== 'overman-philo-drummond' ? 'ok' : 'discard'),
  },

  // Psychic Pstench: a chosen rival exposes all his Plots, or discards one exposed Goal.
  'psychic-pstench': {
    timing: ['anytime'],
    needs: { target: 'rival', mode: ['expose', 'discardGoal'] },
    requires: anyOf(groupActions({ attributes: ['SubGenius'], subtypes: ['Personality'] })),
    check(s, pl, play) {
      const r = auditee(s, pl, play);
      if (!r) return 'Choose a rival.';
      if (play.mode === 'discardGoal' && !player(s, r).hand.some((c) => s.cards[c].exposed && def(s, c).subtype === 'Goal')) return `${player(s, r).name} has no exposed Goal to discard.`;
      return null;
    },
    apply(s, pl, play, ctx) { if (ctx) doPstench(s, pl, play); },
    resolve: doPstench,
  },

  // Rain of Prairie Squid: reshuffle the whole uncontrolled area and deal as many replacements; in
  // standard play, discard any number of Groups from hand and draw as many.
  'rain-of-prairie-squid': {
    timing: ['anytime'],
    needs: { targetsOf: 'handGroup' },
    check(s, pl, play, ctx) {
      if (ctx || s.attack) return 'Rain of Prairie Squid cannot be played during an attack.';
      if (sgRules(s)) return null;
      const targets = play.targets ?? [];
      const p = player(s, pl);
      if (!targets.every((c) => p.hand.includes(c) && def(s, c).type === 'Group')) return 'Choose only Group cards from your own hand.';
      return null;
    },
    apply() {},
    resolve(s, pl, play) {
      if (sgRules(s)) {
        const c = s.common!;
        const removed = c.uncontrolled.splice(0);
        for (const iid of removed) Object.assign(s.cards[iid], { zone: 'groupDeck', placedBy: undefined, placedTurn: undefined });
        c.groupDeck.push(...shuffle(s, removed));
        log(s, `The uncontrolled area (${removed.length} card${removed.length === 1 ? '' : 's'}) is shuffled back into the Group deck.`, pl);
        const dealer = player(s, pl);
        for (let i = 0; i < removed.length; i++) drawGroup(s, dealer);
        return;
      }
      const p = player(s, pl);
      const targets = play.targets ?? [];
      for (const c of targets) discardCard(s, c);
      for (let i = 0; i < targets.length; i++) drawGroup(s, p);
      if (targets.length) log(s, `${p.name} discards ${targets.length} Group card${targets.length === 1 ? '' : 's'} and draws as many.`, pl);
    },
  },

  // Random Jesii: a chosen rival exposes all but one Plot. Immune: whoever controls the Martyr Meter (the
  // only place this immunity is encoded). RULING: the victim picks which Plot stays hidden.
  'random-jesii': {
    timing: ['anytime'],
    needs: { target: 'rival' },
    requires: anyOf(groupActions({ attributes: ['SubGenius', 'Church'] })),
    check(s, pl, play, ctx) {
      if (ctx || s.attack) return 'Random Jesii cannot be played during an attack.';
      const r = auditee(s, pl, play);
      if (!r) return 'Choose a rival.';
      if (resourcesOf(s, r).some((iid) => s.cards[iid].cardId === 'martyr-meter')) return `${player(s, r).name} holds the Martyr Meter and is immune.`;
      return null;
    },
    apply() {},
    resolve(s, pl, play) {
      const r = auditee(s, pl, play)!;
      const hidden = exposableHand(s, r, 'Plot');
      if (hidden.length <= 1) return;
      askChoice(s, r, {
        key: 'random-jesii', question: 'Random Jesii: choose one Plot card to keep hidden; the rest are exposed.',
        options: hidden.map((c) => ({ id: c, label: cardName(s, c) })), min: 1, max: 1, data: {},
      });
    },
  },

  // Rant!: on your turn, after token placement, a Personality with an open control arrow takes
  // automatic control of a Group or Resource from the uncontrolled area (hand, in standard play); a Group
  // goes on the arrow of that Personality its player picks. Your turn ends at once.
  'rant': {
    timing: ['anytime'],
    check(s, pl, play, ctx) {
      if (ctx || s.attack) return 'Rant! cannot be played during an attack.';
      if (!(s.phase === 'main' && activePlayer(s).id === pl)) return 'Play this on your own turn.';
      const payers = openPersonalities(s, pl);
      if (!play.payWith || play.payWith.length !== 1 || !payers.includes(play.payWith[0])) return 'Pay with the action of a Personality you control with an open control arrow.';
      const pool = sgRules(s) ? uncontrolledCards(s) : player(s, pl).hand;
      const t = play.target;
      if (!t || !pool.includes(t) || (def(s, t).type !== 'Group' && def(s, t).type !== 'Resource')) return sgRules(s) ? 'Choose a Group or Resource in the uncontrolled area.' : 'Choose a Group or Resource card in your hand.';
      if (!canEnterPlay(s, t, pl)) return 'That card is already in play or was destroyed.';
      if (def(s, t).type === 'Group' && !puppetSides(s, pl, t, play.payWith[0]).length) return `${cardName(s, t)} cannot become a puppet of ${cardName(s, play.payWith[0])}.`;
      return null;
    },
    // Its cost, the Personality's action, is paid as it is played.
    apply(s, _pl, play) { s.cards[play.payWith![0]].tokens--; },
    resolve(s, pl, play) {
      const master = play.payWith![0];
      const t = play.target!;
      const p = player(s, pl);
      const pool = sgRules(s) ? uncontrolledCards(s) : p.hand;
      if (!pool.includes(t) || !canEnterPlay(s, t, pl)) log(s, `${cardName(s, t)} is no longer there to take.`, pl);
      else if (def(s, t).type === 'Resource') {
        playResourceCard(s, t, pl);
        log(s, `${p.name} takes automatic control of ${cardName(s, t)}.`, pl);
      } else {
        const sides = puppetSides(s, pl, t, master);
        if (!sides.length) log(s, `${cardName(s, t)} cannot become a puppet of ${cardName(s, master)} now.`, pl);
        else if (sides.length === 1) rantPlace(s, pl, t, master, sides[0]);
        else askChoice(s, pl, {
          key: 'rant-side', question: `Rant!: on which control arrow of ${cardName(s, master)} does ${cardName(s, t)} go?`,
          options: sides.map((side) => ({ id: side, label: `${side.toLowerCase()} arrow` })), min: 1, max: 1, data: { card: t, master },
        });
      }
      log(s, `${p.name}'s turn ends at once.`, pl);
      s.phase = 'endOfTurn';
      s.turnFlags.endedAtOnce = true;
    },
  },

  // Repent!: right after token placement, do nothing else and end your turn; your Illuminati gets an
  // extra Action token.
  'repent': {
    timing: ['anytime'],
    check(s, pl, play, ctx) {
      if (ctx || s.attack) return 'Repent! cannot be played during an attack.';
      if (!(s.phase === 'main' && activePlayer(s).id === pl)) return 'Play this right at the start of your own turn.';
      let i = s.log.length - 1;
      while (i >= 0 && !(s.log[i].turn === s.turn && s.log[i].player === pl && /Action tokens/.test(s.log[i].text))) i--;
      if (i < 0 || s.log.slice(i + 1).some((e) => !e.info)) return 'Play this right after your token placement, before doing anything else.';
      return null;
    },
    apply() {},
    resolve(s, pl) {
      const ill = player(s, pl).illuminati;
      s.cards[ill].tokens++;
      log(s, `${player(s, pl).name} slacks off: an extra Action token, and the turn ends at once.`, pl);
      s.phase = 'endOfTurn';
      s.turnFlags.endedAtOnce = true;
    },
  },

  // Robo "Bob": on your turn, link for good to a SubGenius Place you control (its own action). Nobody
  // else may ever control it; it defends with +5 against destruction. One per player.
  'robo-bob': {
    timing: ['anytime'],
    linked: true,
    requires: anyOf(targetAction()),
    needs: { target: 'ownGroup' },
    check(s, pl, play, ctx) {
      if (ctx || s.attack) return 'Robo "Bob" cannot be played during an attack.';
      if (!(s.phase === 'main' && activePlayer(s).id === pl)) return 'Play this on your own turn.';
      const g = play.target;
      if (!g || !own(s, pl, g) || def(s, g).subtype !== 'Place' || !hasAttr(s, g, 'SubGenius')) return 'Choose a SubGenius Place you control.';
      if (Object.values(s.cards).some((c) => c.cardId === 'robo-bob' && c.controller === pl && c.zone === 'table' && !c.data?.linkInactive)) return 'You already have a Robo "Bob" in play.';
      return null;
    },
    apply(s, pl, play, ctx) { if (ctx) { s.cards[play.card].linkedTo = play.target; log(s, `Robo "Bob" guards ${cardName(s, play.target!)}.`, pl); } },
    resolve(s, pl, play) { s.cards[play.card].linkedTo = play.target; log(s, `Robo "Bob" guards ${cardName(s, play.target!)}.`, pl); },
    // Linked for good: it stays with the Place wherever it is in play, the uncontrolled area included
    // (SubGenius rules, "The Cards Remember"); it goes only when the Place leaves play.
    linkLegal: (s, _plot, group) => (s.cards[group] && ['structure', 'uncontrolled'].includes(s.cards[group].zone) ? 'ok' : 'discard'),
  },

  // S.C.A.M: right after a rival rolls (an attack roll, or a card's roll outside an attack), the roll is
  // void and made again. Costs the action of one of your Personalities.
  's-c-a-m': {
    timing: ['roll', 'event'],
    events: ['dieRoll'],
    requires: anyOf(groupActions({ subtypes: ['Personality'] })),
    check(s, pl, _play, ctx) {
      const e = cardRollNow(s);
      if (!ctx && e) return e.player && e.player !== pl ? null : 'Play this right after a rival makes a die roll.';
      if (!ctx?.roll || ctx.attackerPlayer === pl) return 'Play this right after a rival makes a die roll.';
      return null;
    },
    apply(s, pl, _play, ctx): PlotEffect | void {
      if (!ctx) return;
      const dice = roll2d6(s);
      log(s, `S.C.A.M: ${player(s, ctx.attackerPlayer).name} must roll again: ${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}.`, pl);
      return { t: 'reroll', dice };
    },
    resolve(s, pl) { rerollCardRoll(s, pl, 'S.C.A.M'); },
  },

  // Sacred Jests: a chosen rival picks one of his Plots at random and must use it at once (any legal
  // way, his choice) or discard it; a Goal picked is exposed instead (doSacredJests).
  'sacred-jests': {
    timing: ['anytime'],
    needs: { target: 'rival' },
    check(s, pl, play) {
      const r = auditee(s, pl, play);
      if (!r) return 'Choose a rival.';
      return player(s, r).hand.some((c) => def(s, c).type === 'Plot') ? null : `${player(s, r).name} holds no Plot cards.`;
    },
    apply(s, pl, play, ctx) { if (ctx) doSacredJests(s, pl, play); },
    resolve: doSacredJests,
  },

  // Schizm: played with any attack (Attack to Control or to Destroy, by anyone; not an Instant attack,
  // which only cards naming Instant attacks affect) on a Group controlled by a rival of its player (card
  // FAQ): +10 to the attack, which may be made even on a Group otherwise immune, uncontrollable or
  // undestroyable. If the attack succeeds, instead of the usual result the target and all its puppets
  // (and theirs) become uncontrolled; with no uncontrolled area, the target is discarded and its puppets
  // go to their owners' hands (the 'schizm' hooks below).
  'schizm': {
    timing: ['declare', 'attack'],
    overridesImmunity: true,
    linked: true,
    check(s, pl, _play, ctx) {
      if (!ctx || ctx.instant) return 'Play this with an attack (not an Instant attack).';
      const t = ctx.target ? s.cards[ctx.target] : undefined;
      if (!t || def(s, ctx.target).type !== 'Group' || t.zone !== 'structure' || !t.controller || t.controller === pl) return 'Choose an attack on a Group controlled by one of your rivals.';
      return null;
    },
    apply(s, pl, play, ctx) {
      s.cards[play.card].linkedTo = `attack:${ctx!.id}`;
      ctx!.attackBonus.push({ player: pl, plot: play.card, amount: 10, label: 'Schizm' });
      log(s, `Schizm: +10, and success sends ${cardName(s, ctx!.target)} ${sgRules(s) ? 'into the uncontrolled area' : 'away'}.`, pl);
    },
  },

  // Shordurpersav: right after you roll (an attack roll, or a card's roll outside an attack), ignore it
  // and roll again. Costs an Illuminati action or two SubGenius actions.
  'shordurpersav': {
    timing: ['roll', 'event'],
    events: ['dieRoll'],
    requires: anyOf(illuminatiAction(), groupActions({ attributes: ['SubGenius'] }, { count: 2 })),
    check(s, pl, _play, ctx) {
      const e = cardRollNow(s);
      if (!ctx && e) return e.player === pl ? null : 'Play this right after you make a die roll.';
      if (!ctx?.roll || ctx.attackerPlayer !== pl) return 'Play this right after you make a die roll.';
      return null;
    },
    apply(s, pl, _play, ctx): PlotEffect | void {
      if (!ctx) return;
      const dice = roll2d6(s);
      log(s, `Shordurpersav: ${player(s, pl).name} ignores that roll and tries again: ${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}.`, pl);
      return { t: 'reroll', dice };
    },
    resolve(s, pl) { rerollCardRoll(s, pl, 'Shordurpersav'); },
  },

  // Slackfusion: for the rest of the turn, Illuminati Action tokens may be given or traded in a deal,
  // Illuminati to Illuminati only.
  'slackfusion': {
    timing: ['anytime'],
    check: () => null,
    apply(s, pl, _play, ctx) { if (ctx) doSlackfusion(s, pl); },
    resolve: (s, pl) => doSlackfusion(s, pl),
  },

  // Smite Them All!: each rival sends one Group or Resource from the uncontrolled area to the bottom
  // of the Group deck, then you send two (you pick last); in standard play, each player instead sends
  // Group cards from his own hand to the bottom of his own deck.
  'smite-them-all': {
    timing: ['anytime'],
    check(s, pl, _play, ctx) {
      if (ctx || s.attack) return 'Smite Them All! cannot be played during an attack.';
      if (!sgRules(s) && player(s, pl).hand.filter((c) => def(s, c).type === 'Group').length < 2) return 'You need at least two Group cards in your own hand to play this.';
      return null;
    },
    apply() {},
    resolve(s, pl) {
      const rivals = livePlayers(s).map((p) => p.id).filter((id) => id !== pl);
      smiteNext(s, rivals, pl);
    },
  },

  // Stark Fist of Removal: on your turn, for all your own Illuminati tokens (at least one), a chosen
  // rival's Illuminati loses all of its tokens. Your turn ends at once.
  'stark-fist-of-removal': {
    timing: ['anytime'],
    needs: { target: 'rival' },
    check(s, pl, play, ctx) {
      if (ctx || s.attack) return 'Stark Fist of Removal cannot be played during an attack.';
      if (!(s.phase === 'main' && activePlayer(s).id === pl)) return 'Play this on your own turn.';
      if (s.cards[player(s, pl).illuminati].tokens < 1) return 'It costs all your Illuminati tokens, at least one.';
      return auditee(s, pl, play) ? null : 'Choose a rival.';
    },
    // Its cost: every token on your own Illuminati, paid as it is played.
    apply(s, pl) { s.cards[player(s, pl).illuminati].tokens = 0; },
    resolve(s, pl, play) {
      const r = auditee(s, pl, play);
      if (!r) return;
      s.cards[player(s, r).illuminati].tokens = 0;
      log(s, `${player(s, pl).name} shows the Stark Fist of Removal to ${player(s, r).name}: their Illuminati loses all Action tokens. The turn ends at once.`, pl);
      s.phase = 'endOfTurn';
      s.turnFlags.endedAtOnce = true;
    },
  },

  // Sultan of Slack: until your next turn, nobody may win by their Illuminati's Special Goal unless
  // their Illuminati holds at least as many Action tokens as yours. Once per game.
  'sultan-of-slack': {
    timing: ['anytime'],
    check(s, pl) {
      const ill = player(s, pl).illuminati;
      if (s.cards[ill].data?.sultanOfSlack) return 'You may play Sultan of Slack only once per game.';
      if (s.claims?.length) return 'This cannot be played while a victory is being contested.';
      return null;
    },
    apply(s, pl, _play, ctx) { if (ctx) doSultan(s, pl); },
    resolve: (s, pl) => doSultan(s, pl),
  },

  // Tape Runs Out...: right after any Plot is played, cancel it; both cards are discarded.
  'tape-runs-out': {
    timing: ['counter'],
    needs: { target: 'plot' },
    requires: anyOf(illuminatiAction(), plotDiscards(3)),
    check(s, pl, play, ctx) {
      const pool = counterPool(s, ctx);
      const pp = pool.find((p) => p.iid === play.target);
      if (!pp || play.target === play.card || !s.cards[pp.iid] || def(s, pp.iid).type !== 'Plot' || s.cards[pp.iid].zone !== 'table' || isCancelled(pool, pp.iid)) return 'Choose a Plot card that was just played.';
      return null;
    },
    apply(_s, _pl, play): PlotEffect { return { t: 'cancelPlot', target: play.target! }; },
  },

  // The 13th Apostle: an Illuminati action gives an Action token to any one Personality (anyone's), or
  // to several whose Power totals 5 or less; not to one that already has a token or is barred from
  // getting one.
  'the-13th-apostle': {
    timing: ['anytime'],
    needs: { targets: true },
    requires: anyOf(illuminatiAction()),
    check(s, _pl, play) {
      const t = play.targets ?? [];
      const eligible = (g: string) => inPlay(s, g) && isGroup(s, g) && def(s, g).subtype === 'Personality' && s.cards[g].tokens === 0
        && !s.cards[g].heldTokens && !tokenBarred(s, g);
      if (!t.length || new Set(t).size !== t.length) return 'Choose one or more Personalities to give an Action token.';
      if (!t.every(eligible)) return 'Only Personalities in play without an Action token, able to get one, can be given one.';
      if (t.length > 1 && t.reduce((n, g) => n + power(s, g), 0) > 5) return 'Give a token to one Personality, or several with 5 Power or less in total.';
      return null;
    },
    apply(s, pl, play, ctx) { if (ctx) doApostle(s, pl, play); },
    resolve: doApostle,
  },

  // The Saint of Sales: on your turn, an Illuminati action or SubGenius actions of 4 total Power take a
  // Resource from the uncontrolled area (or your hand, in standard play) into play without a roll.
  'the-saint-of-sales': {
    timing: ['anytime'],
    needs: { target: 'resource' },
    requires: anyOf(illuminatiAction(), groupActions({ attributes: ['SubGenius'] }, { power: 4 })),
    check(s, pl, play, ctx) {
      if (ctx || s.attack) return 'The Saint of Sales cannot be played during an attack.';
      if (!(s.phase === 'main' && activePlayer(s).id === pl)) return 'Play this on your own turn.';
      const pool = sgRules(s) ? uncontrolledCards(s) : player(s, pl).hand;
      const r = play.target;
      if (!r || !pool.includes(r) || def(s, r).type !== 'Resource') return sgRules(s) ? 'Choose a Resource in the uncontrolled area.' : 'Choose a Resource in your hand.';
      if (!canEnterPlay(s, r, pl)) return 'That Resource is Unique and already in play or destroyed.';
      return null;
    },
    apply() {},
    resolve(s, pl, play) {
      playResourceCard(s, play.target!, pl);
      log(s, `${player(s, pl).name} takes control of ${cardName(s, play.target!)} at once.`, pl);
    },
  },

  // The World Ends Tomorrow and You May Die!: with an attack on a Group in the uncontrolled area (a
  // Group in hand, in standard play) whose attacker shares an alignment with it or is a Media Group,
  // the attack succeeds automatically. Your turn ends at once.
  'the-world-ends-tomorrow-and-you-may-die': {
    timing: ['declare'],
    linked: true,
    check(s, pl, _play, ctx) {
      if (!ctx || ctx.instant || ctx.attackerPlayer !== pl) return 'Play this when you declare your attack.';
      const legal = sgRules(s) ? ctx.fromArea : ctx.fromHand;
      if (!legal) return sgRules(s) ? 'Attack a Group in the uncontrolled area.' : 'Attack a Group in your hand.';
      if (!ctx.attacker) return 'This attack needs an attacking Group.';
      const shares = alignments(s, ctx.attacker).some((a) => alignments(s, ctx.target).includes(a));
      if (!shares && !hasAttr(s, ctx.attacker, 'Media')) return `${cardName(s, ctx.attacker)} must share an alignment with the target, or be a Media Group.`;
      return null;
    },
    apply(s, pl, play, ctx): PlotEffect {
      s.cards[play.card].linkedTo = `attack:${ctx!.id}`;
      log(s, `${cardName(s, play.card)}: the attack succeeds automatically.`, pl);
      return { t: 'set', value: 2 };
    },
  },

  // They May Be Pink...: when a Straight Group is attacked, all your Weird and/or SubGenius Groups may
  // help defend it, regardless of alignment.
  'they-may-be-pink': {
    timing: ['attack'],
    check(s, _pl, _play, ctx) {
      if (!ctx || !s.cards[ctx.target] || !hasAlign(s, ctx.target, 'Straight')) return 'Play this while a Straight Group is attacked.';
      return null;
    },
    apply(s, pl, play, ctx) {
      s.cards[play.card].linkedTo = `attack:${ctx!.id}`;
      log(s, `${player(s, pl).name}'s Weird and SubGenius Groups may help defend ${cardName(s, ctx!.target)}.`, pl);
    },
  },

  // Time Control: on your turn, your Illuminati makes one direct attack at its normal Power without
  // spending a token; its player may not spend, or have spent, any Illuminati token this turn except to
  // buy Plots. The engine records every Illuminati token spent on anything else (illuminatiSpent) and,
  // once this is played, refuses any such spending (illuminatiLocked; noteIlluminatiSpending in game.ts).
  'time-control': {
    timing: ['anytime'],
    check(s, pl, _play, ctx) {
      if (ctx || s.attack) return 'Time Control cannot be played during an attack.';
      if (!(s.phase === 'main' && activePlayer(s).id === pl)) return 'Play this on your own turn.';
      if (s.turnFlags.illuminatiSpent?.includes(pl)) return 'Your Illuminati has already spent a token this turn on something other than buying Plots.';
      if (s.turnFlags.illuminatiLocked === pl || s.turnFlags.freeAttack === pl) return 'You have already played Time Control this turn.';
      return null;
    },
    apply() {},
    resolve(s, pl) {
      s.turnFlags.freeAttack = pl;
      s.turnFlags.illuminatiLocked = pl;
      log(s, `${player(s, pl).name}'s Illuminati may make one direct attack this turn at no token cost, and spends no other Illuminati token except to buy Plots.`, pl);
    },
  },

  // X-Day: discard all your Plots and draw as many new ones, four at most. Once per turn.
  'x-day': {
    timing: ['anytime'],
    check(s, pl, _play) {
      if (s.cards[player(s, pl).illuminati].data?.xDayTurn === s.turn) return 'You may only declare X-Day once per turn.';
      return null;
    },
    apply(s, pl, play, ctx) { if (ctx) doXDay(s, pl, play); },
    resolve: doXDay,
  },

  // Yacatisma: an action from a SubGenius Group makes a rival discard two random hidden Plots.
  'yacatisma': {
    timing: ['anytime'],
    needs: { target: 'rival' },
    requires: anyOf(groupActions({ attributes: ['SubGenius'] })),
    check(s, pl, play, ctx) {
      if (ctx || s.attack) return 'Yacatisma cannot be played during an attack.';
      const r = auditee(s, pl, play);
      if (!r) return 'Choose a rival.';
      return exposableHand(s, r, 'Plot').length ? null : `${player(s, r).name} has no hidden Plots.`;
    },
    apply() {},
    resolve(s, pl, play) {
      const r = auditee(s, pl, play)!;
      const picked = pickRandom(s, exposableHand(s, r, 'Plot'), 2);
      for (const c of picked) discardCard(s, c);
      if (picked.length) log(s, `${player(s, r).name} must discard ${picked.map((c) => cardName(s, c)).join(' and ')}.`, pl);
    },
  },

  // You'd Pay to Know What You Really Think!: send one of your puppet-free Groups (not your Illuminati)
  // to the uncontrolled area (discard it, in standard play) and replace it with the top Group card,
  // keeping its tokens; a Resource goes to your Resources instead, and a Group that cannot be placed
  // there is discarded (you draw a Plot).
  'you-d-pay-to-know-what-you-really-think': {
    timing: ['anytime'],
    needs: { target: 'ownGroup' },
    check(s, pl, play, ctx) {
      if (ctx || s.attack) return 'This cannot be played during an attack.';
      const g = play.target;
      if (!g || !own(s, pl, g) || def(s, g).type !== 'Group' || g === player(s, pl).illuminati) return 'Choose a Group you control, other than your Illuminati.';
      if (puppets(s, g).length) return 'Choose a Group with no puppets.';
      if (HOOKS[s.cards[g].cardId]?.neverDestroyed) return `Nothing but an attack can remove ${cardName(s, g)}.`;
      return null;
    },
    apply() {},
    resolve(s, pl, play) {
      const g = play.target!;
      const p = player(s, pl);
      const master = s.cards[g].master!, side = s.cards[g].side!;
      const oldTokens = s.cards[g].tokens;
      const oldName = cardName(s, g);
      if (sgRules(s)) putUncontrolled(s, g, pl); else discardCard(s, g);
      const drawn = drawGroup(s, p)[0];
      if (!drawn) { log(s, `${p.name}'s Group deck is empty: nothing replaces ${oldName}.`, pl); return; }
      if (def(s, drawn).type === 'Resource') {
        playResourceCard(s, drawn, pl);
        log(s, `${p.name} replaces ${oldName} with ${cardName(s, drawn)}, a Resource.`, pl);
        return;
      }
      const canPlace = canEnterPlay(s, drawn) && puppetSides(s, pl, drawn, master).includes(side);
      if (!canPlace) {
        discardCard(s, drawn);
        drawPlot(s, p);
        log(s, `${p.name} cannot control ${cardName(s, drawn)} there: it is discarded and ${p.name} draws a Plot instead.`, pl);
        return;
      }
      placeGroup(s, drawn, pl, master, side);
      s.cards[drawn].tokens = oldTokens;
      hooksOf(s, drawn)?.onEnterPlay?.(s, drawn);
      log(s, `${p.name} replaces ${oldName} with ${cardName(s, drawn)}.`, pl);
    },
  },
});

// ---------------------------------------------------------------- hooks (linked Plots' lasting effects)

registerHooks({
  'overman': {
    powerMod(s, self, iid) {
      const c = s.cards[self];
      if (c.linkedTo !== iid) return 0;
      return Math.max(0, 3 - (def(s, iid).power ?? 0));
    },
    globalMod(s, self, iid) {
      const c = s.cards[self];
      if (c.linkedTo !== iid) return 0;
      return Math.max(0, 3 - (def(s, iid).globalPower ?? 0));
    },
  },
  'schizm': {
    onAttackEnd(s, self, ctx) {
      if (s.cards[self].linkedTo === `attack:${ctx.id}` && s.cards[self].zone === 'table') discardCard(s, self);
    },
    // A successful attack with a live Schizm: the target scatters instead of being captured or destroyed.
    replaceAttackResult(s, self, ctx) {
      if (s.cards[self].linkedTo !== `attack:${ctx.id}` || isCancelled(ctx.plays, self)) return false;
      if (!s.cards[ctx.target] || s.cards[ctx.target].zone !== 'structure') return false;
      const tree = subtree(s, ctx.target);
      if (sgRules(s)) {
        for (const iid of tree) putUncontrolled(s, iid, ctx.attackerPlayer);
      } else {
        const [root, ...rest] = tree;
        discardCard(s, root);
        for (const iid of rest) {
          const owner = s.cards[iid].owner;
          Object.assign(s.cards[iid], { zone: 'hand', controller: undefined, master: undefined, linkedTo: undefined, tokens: 0, x: undefined, y: undefined, side: undefined });
          player(s, owner).hand.push(iid);
        }
      }
      log(s, `Schizm: ${cardName(s, ctx.target)}${tree.length > 1 ? ' and its puppets' : ''} ${sgRules(s) ? 'become uncontrolled' : 'scatter'}.`, ctx.attackerPlayer);
      return true;
    },
  },
  'robo-bob': {
    forbidIsImmunity: true,
    // Carried off with a captured master, the Place leaves the capturer's Power Structure at once (with
    // its own puppets): it may never be controlled by another player.
    onCapture(s, self, _victim, by) {
      const place = s.cards[self].linkedTo;
      const owner = controllerOf2(s, self);
      if (!place || !owner || by === owner || s.cards[place]?.zone !== 'structure' || s.cards[place].controller !== by) return;
      log(s, `Robo "Bob": ${cardName(s, place)} will not serve ${player(s, by).name} and leaves the Power Structure.`, owner);
      for (const g of [...subtree(s, place)].reverse()) putUncontrolled(s, g, owner);
    },
    forbidAttack(s, self, _attacker, target, type, attackerPlayer) {
      const c = s.cards[self];
      if (c.linkedTo !== target || (type !== 'control' && type !== 'takeover')) return null;
      return attackerPlayer === controllerOf2(s, self) ? null : `Robo "Bob" guards ${cardName(s, target)}: nobody else may ever control it.`;
    },
    attackMod(s, self, ctx, side) {
      const c = s.cards[self];
      if (side !== 'defense' || c.linkedTo !== ctx.target || ctx.type !== 'destroy') return 0;
      return 5;
    },
  },
  'the-world-ends-tomorrow-and-you-may-die': {
    onAttackEnd(s, self, ctx) {
      if (s.cards[self].linkedTo !== `attack:${ctx.id}` || s.cards[self].zone !== 'table') return;
      discardCard(s, self);
      log(s, `${player(s, ctx.attackerPlayer).name}'s turn ends at once.`, ctx.attackerPlayer);
      s.phase = 'endOfTurn';
      s.turnFlags.endedAtOnce = true;
    },
  },
  'they-may-be-pink': {
    mayJoin(s, self, ctx, group, as) {
      if (as !== 'oppose' || s.cards[self].linkedTo !== `attack:${ctx.id}` || isCancelled(ctx.plays, self)) return false;
      if (controllerOf2(s, group) !== s.cards[self].controller) return false;
      return hasAlign(s, group, 'Weird') || hasAttr(s, group, 'SubGenius');
    },
    onAttackEnd(s, self, ctx) {
      if (s.cards[self].linkedTo === `attack:${ctx.id}` && s.cards[self].zone === 'table') discardCard(s, self);
    },
  },
});
