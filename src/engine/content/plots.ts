// Plot cards available in this version, built from a few reusable families.
import type { Alignment, AttackCtx, GameState, PlotEffect, PlotPlay } from '../types';
import type { PlotHandler } from '../plotTypes';
import { registerPlots } from '../plotTypes';
import { assassinationPlot } from './families';
import { registerChoice, registerHooks } from '../hooks';
import { def } from '../cards';
import { type Match, matches } from '../abilities';
import { alignments, attributes, power, resistance } from '../stats';
import { OPPOSITE } from '../cards';
import { depth, structureCards } from '../geometry';
import { roll2d6 } from '../rng';
import { nwoColor } from '../nwo';
import {
  announcedAction, announcedActors, askChoice, cancelActorEffect, currentOutcome, discardCard, drawPlot, giveToken, isPrivileged, isSecret, log,
  player, respondToAction, startInstantAttack, disasterTarget,
} from '../game';

// ---------------------------------------------------------------- helpers

const own = (s: GameState, pl: string, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure' && s.cards[iid].controller === pl;
const isGroup = (s: GameState, iid?: string) => !!iid && def(s, iid).type === 'Group';
const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';
const sameCardInAttack = (s: GameState, pl: string, play: PlotPlay, ctx?: AttackCtx) =>
  !!ctx && ctx.plays.some((p) => p.player === pl && s.cards[p.iid]?.cardId === s.cards[play.card].cardId);
const describe = (m: Match) => [...(m.alignments ?? []), ...(m.attributes ?? []), ...(m.subtypes ?? [])].join('/');

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

// ---------------------------------------------------------------- families

/** "+10 Power or Resistance to one of your [X] Groups" (R028). */
function plusTen(match: Match): PlotHandler {
  return {
    timing: ['anytime', 'declare', 'attack'],
    needs: { target: 'ownGroup', mode: ['power', 'resistance'] },
    check(s, pl, play, ctx) {
      if (!own(s, pl, play.target) || !isGroup(s, play.target) || !matches(s, play.target!, match)) return `Choose a ${describe(match)} Group you control.`;
      if (sameCardInAttack(s, pl, play, ctx)) return 'You cannot use two copies of the same Plot in one attack.';
      if (!ctx) return null; // defensive use outside an attack: lasts until end of turn
      if ((play.mode ?? 'power') === 'power') {
        const leading = ctx.attacker === play.target && !s.window;
        const aiding = ctx.aid.some((a) => a.iid === play.target);
        if (!leading && !aiding) return 'A Power boost must go on the attacker when the attack is declared, or on a Group aiding it.';
      } else {
        if (ctx.instant) return 'Too late: an Instant attack uses the target\'s Power at the moment it was played.';
        if (ctx.target !== play.target && !ctx.oppose.some((o) => o.iid === play.target)) return 'Use it defensively on the Group being attacked or a Group opposing.';
      }
      return null;
    },
    // The Group must still qualify when the attack resolves (a Violent attacker made Peaceful loses its Terrorist Nuke).
    stillLegal(s, pl, play, ctx) {
      const t = play.target;
      if (!own(s, pl, t) || !isGroup(s, t) || !matches(s, t!, match)) return `${t && s.cards[t] ? def(s, t).name : 'The Group'} is no longer a ${describe(match)} Group of yours.`;
      if ((play.mode ?? 'power') === 'power') return ctx.attacker === t || ctx.aid.some((a) => a.iid === t) ? null : `${def(s, t!).name} no longer takes part in the attack.`;
      return ctx.target === t || ctx.oppose.some((o) => o.iid === t) ? null : `${def(s, t!).name} no longer takes part in the defense.`;
    },
    apply(s, pl, play, ctx) {
      if (!ctx) return;
      const entry = { player: pl, plot: play.card, forGroup: play.target, amount: 10, label: def(s, play.card).name };
      ((play.mode ?? 'power') === 'power' ? ctx.attackBonus : ctx.defenseBonus).push(entry);
    },
    resolve(s, _pl, play) {
      s.cards[play.target!].mods.push({
        source: play.card, kind: play.mode === 'power' ? 'power' : 'resistance', value: 10,
        defenseOnly: true, until: 'endOfTurn', countsForGoals: false,
      });
    },
  };
}

/**
 * Reload cards (official correction, R019): cost an Illuminati action and give a token to your
 * [X] Groups without one, up to 5 Power of Groups in total or any single Group. A Group captured
 * this turn cannot be reloaded.
 */
function tokenGiver(match: Match): PlotHandler {
  const eligible = (s: GameState, pl: string, g: string) =>
    own(s, pl, g) && isGroup(s, g) && matches(s, g, match) && s.cards[g].tokens === 0 && s.cards[g].capturedTurn !== s.turn;
  return {
    timing: ['anytime'],
    needs: { targets: true },
    check(s, pl, play) {
      if (s.cards[player(s, pl).illuminati].tokens < 1) return 'This costs an action from your Illuminati.';
      const t = play.targets ?? [];
      if (!t.length || new Set(t).size !== t.length) return `Choose which ${describe(match)} Groups get a token.`;
      if (!t.every((g) => eligible(s, pl, g))) return `Only your ${describe(match)} Groups without a token (not captured this turn) can be reloaded.`;
      if (t.length > 1 && totalPower(s, t) > 5) return 'Reload up to 5 Power of Groups in total, or any one Group.';
      return null;
    },
    apply(s, pl, play, ctx) {
      s.cards[player(s, pl).illuminati].tokens--;
      if (ctx) reload(s, pl, play);
    },
    resolve: (s, pl, play) => reload(s, pl, play),
  };
  function reload(s: GameState, pl: string, play: PlotPlay) {
    let n = 0;
    for (const g of play.targets ?? []) if (s.cards[g].zone === 'structure' && s.cards[g].tokens === 0) { giveToken(s, g); if (s.cards[g].tokens) n++; }
    log(s, `${n} Group${n === 1 ? ' gets' : 's get'} an Action token.`, pl);
  }
}

/** Uses the target's action; its Power is raised to 6 and the card stays linked. One per player. */
function raiseToSix(match: Match): PlotHandler {
  return {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'ownGroup' },
    check(s, pl, play) {
      if (!own(s, pl, play.target) || !isGroup(s, play.target) || !matches(s, play.target!, match)) return `Choose a ${describe(match)} Group you control.`;
      if (s.cards[play.target!].tokens < 1) return 'That Group needs an available action.';
      const cardId = s.cards[play.card].cardId;
      if (Object.values(s.cards).some((c) => c.cardId === cardId && c.zone === 'table' && c.controller === pl && c.linkedTo)) return 'You may only have one of these in play.';
      return null;
    },
    apply(s, pl, play, ctx) {
      s.cards[play.target!].tokens--;
      if (ctx) link(s, play);
    },
    resolve: (s, _pl, play) => link(s, play),
  };
  function link(s: GameState, play: PlotPlay) {
    s.cards[play.target!].mods.push({ source: play.card, kind: 'setPower', value: 6, until: 'permanent' });
    s.cards[play.card].linkedTo = play.target;
  }
}

/** Target permanently gains an alignment (losing its opposite). Pay with an Illuminati action,
 *  or actions of [alignment] Groups whose Power totals the target's Resistance (x2 if it has the
 *  opposite alignment) plus its closeness bonus when a rival controls it. */
function alignmentShift(add: Alignment): PlotHandler {
  const threshold = (s: GameState, pl: string, t: string) => {
    let n = resistance(s, t) * (alignments(s, t).includes(OPPOSITE[add]!) ? 2 : 1);
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
      if (payers.length === 1 && payers[0] === player(s, pl).illuminati) return null;
      if (!payers.length || payers.some((g) => g === player(s, pl).illuminati || !alignments(s, g).includes(add))) return `Pay with your Illuminati, or with ${add} Groups.`;
      const need = threshold(s, pl, play.target!);
      if (totalPower(s, payers) < need) return `The paying ${add} Groups need at least ${need} Power in total.`;
      return null;
    },
    apply(s, _pl, play, ctx) { pay(s, play.payWith); if (ctx) shift(s, play); },
    resolve: (s, _pl, play) => shift(s, play),
  };
  function shift(s: GameState, play: PlotPlay) {
    s.cards[play.target!].mods.push({ source: play.card, kind: 'addAlign', align: add, until: 'permanent' });
    s.cards[play.card].linkedTo = play.target;
  }
}

/** Disaster: Instant Attack to Destroy a Place. */
function disaster(opts: { power: (s: GameState, t: string) => number; destroyMargin: number | null; hugeAllowed: boolean; devastateOnly?: boolean; coastalOnly?: boolean }): PlotHandler {
  return {
    timing: ['instant'],
    needs: { target: 'place' },
    check(s, _pl, play) {
      if (!disasterTarget(s, play.target)) return 'Choose a Place in play.';
      if (!opts.hugeAllowed && (def(s, play.target!).attributes ?? []).includes('Huge')) return 'This Disaster cannot strike a Huge Place.';
      // A Place in a Power Structure must be Coastal; the Hidden City may be struck by any Disaster.
      if (opts.coastalOnly && s.cards[play.target!].zone === 'structure' && !attributes(s, play.target!).includes('Coastal')) return 'This Disaster can only strike a Coastal Place.';
      return null;
    },
    apply(s, pl, play) {
      startInstantAttack(s, pl, { plot: play.card, target: play.target!, power: opts.power(s, play.target!), disaster: { destroyMargin: opts.destroyMargin, devastateOnly: opts.devastateOnly } });
    },
  };
}

/** Assassination: Instant Attack to Destroy a Personality; one qualifying Group may join (any of the matches). */
function assassination(base: number, helper: Match | Match[]): PlotHandler {
  return assassinationPlot({ power: base, helper });
}


/** Cancel another Plot just played (in the counter window or during an attack). */
function counter(opts: { check: (s: GameState, pl: string, play: PlotPlay) => string | null; pay: (s: GameState, pl: string, play: PlotPlay) => void }): PlotHandler {
  return {
    timing: ['counter'],
    needs: { target: 'plot', pay: 'tokens' },
    check(s, pl, play, ctx) {
      const pool = s.window?.kind === 'plot' ? s.window.plays ?? [] : ctx?.plays ?? [];
      if (!play.target || !pool.some((p) => p.iid === play.target) || play.target === play.card) return 'Choose a Plot that was just played.';
      return opts.check(s, pl, play);
    },
    apply(s, pl, play): PlotEffect { opts.pay(s, pl, play); return { t: 'cancelPlot', target: play.target! }; },
  };
}

/** Played right after the attack dice are rolled. */
function rollPlot(fn: (s: GameState, pl: string, play: PlotPlay, ctx: AttackCtx) => PlotEffect, check: (s: GameState, pl: string, play: PlotPlay, ctx: AttackCtx) => string | null, needs?: PlotHandler['needs']): PlotHandler {
  return {
    timing: ['roll'],
    needs,
    check: (s, pl, play, ctx) => (!ctx?.roll ? 'Play this right after a die roll.' : check(s, pl, play, ctx)),
    apply: (s, pl, play, ctx) => fn(s, pl, play, ctx!),
  };
}

/** Privilege must be announced by the attacker when the attack is first declared (R032). */
function privilegedPlot(bonus: number, check: (s: GameState, pl: string, ctx: AttackCtx) => string | null): PlotHandler {
  return {
    timing: ['declare'],
    check(s, pl, play, ctx) {
      if (!ctx || ctx.instant || ctx.attackerPlayer !== pl) return 'Play this when you declare your attack.';
      if (sameCardInAttack(s, pl, play, ctx)) return 'Already played in this attack.';
      return check(s, pl, ctx);
    },
    stillLegal: (s, pl, _play, ctx) => check(s, pl, ctx),
    apply(s, pl, play, ctx): PlotEffect {
      if (bonus) ctx!.attackBonus.push({ player: pl, plot: play.card, amount: bonus, label: def(s, play.card).name });
      return { t: 'privileged' };
    },
  };
}

function nwo(): PlotHandler {
  const place = (s: GameState, _pl: string, play: PlotPlay) => {
    const color = nwoColor(s.cards[play.card].cardId);
    const prev = s.nwo[color];
    if (prev && prev !== play.card) { discardCard(s, prev); log(s, `${def(s, prev).name} is replaced.`); }
    s.nwo[color] = play.card;
    s.cards[play.card].linkedTo = 'nwo';
  };
  return { timing: ['nwo'], check: () => null, ...effectNow(place) };
}

/** Privileged Attack: may this card of the player make or pay for the privilege (Illuminati or a Secret Group)? */
const privilegeActor = (s: GameState, pl: string, g: string) =>
  g === player(s, pl).illuminati || (own(s, pl, g) && isGroup(s, g) && isSecret(s, g));
/** Who spends a token for Privileged Attack when the player names nobody. */
function privilegePayer(s: GameState, pl: string): string | undefined {
  const ill = player(s, pl).illuminati;
  if (s.cards[ill].tokens >= 1) return ill;
  return structureCards(s, pl).filter((g) => privilegeActor(s, pl, g) && s.cards[g].tokens >= 1)
    .sort((a, b) => power(s, a) - power(s, b))[0];
}

const onAttackSide = (s: GameState, pl: string, ctx: AttackCtx, m: Match) =>
  [ctx.attacker, ...ctx.aid.map((a) => a.iid)].some((g) => !!g && s.cards[g].controller === pl && matches(s, g, m));

// ---------------------------------------------------------------- the cards

registerPlots({
  // +10 family
  'albino-alligators': plusTen({ alignments: ['Weird'] }),
  'benefit-concert': plusTen({ alignments: ['Liberal'] }),
  'cold-fusion': plusTen({ attributes: ['Science'] }),
  'harmonica-virgins': plusTen({ attributes: ['Magic'] }),
  'infobahn': plusTen({ attributes: ['Computer'] }),
  'jihad': plusTen({ alignments: ['Fanatic'] }),
  'just-say-no': plusTen({ alignments: ['Straight'] }),
  'martial-law': plusTen({ alignments: ['Government'] }),
  'martyrs': plusTen({ alignments: ['Peaceful'] }),
  'pulitzer-prize': plusTen({ attributes: ['Media'] }),
  'save-the-whales': plusTen({ attributes: ['Green'] }),
  'slush-fund': plusTen({ alignments: ['Conservative'] }),
  'stock-split': plusTen({ alignments: ['Corporate'] }),
  'terrorist-nuke': plusTen({ alignments: ['Violent'] }),
  'the-big-score': plusTen({ alignments: ['Criminal'] }),
  'world-cup-victory': plusTen({ attributes: ['Nation'] }),

  // Action tokens
  'reload': tokenGiver({ alignments: ['Violent'] }),
  'red-scare': tokenGiver({ alignments: ['Conservative'] }),
  'pledge-drive': tokenGiver({ alignments: ['Liberal'] }),
  'tax-breaks': tokenGiver({ alignments: ['Corporate'] }),
  'gang-war': tokenGiver({ alignments: ['Criminal'] }),
  'flower-power': tokenGiver({ alignments: ['Peaceful'] }),
  'freaking-the-mundanes': tokenGiver({ alignments: ['Weird'] }),
  'dollars-for-decency': tokenGiver({ alignments: ['Straight'] }),
  'new-federal-budget': tokenGiver({ alignments: ['Government'] }),

  // Power raised to 6
  'emergency-powers': raiseToSix({ alignments: ['Government'] }),
  'grassroots-support': raiseToSix({ alignments: ['Straight'] }),
  'monopoly': raiseToSix({ alignments: ['Corporate'] }),
  'new-blood': raiseToSix({ alignments: ['Violent'] }),
  'mob-influence': raiseToSix({ alignments: ['Criminal'] }),
  'nobel-peace-prize': raiseToSix({ alignments: ['Peaceful'] }),

  // Alignment changes
  'kinder-and-gentler': alignmentShift('Peaceful'),
  'liberal-agenda': alignmentShift('Liberal'),
  'fundie-money': alignmentShift('Conservative'),
  'jake-day': alignmentShift('Weird'),
  'straighten-up': alignmentShift('Straight'),
  'assertiveness-training': alignmentShift('Violent'),

  // Disasters (errata applied to Volcano)
  'tornado': disaster({ power: () => 12, destroyMargin: 5, hugeAllowed: false }),
  'volcano': disaster({ power: () => 18, destroyMargin: 2, hugeAllowed: false }),
  'meteor-strike': disaster({ power: () => 16, destroyMargin: 5, hugeAllowed: true }),
  'earthquake': disaster({ power: (s, t) => ((def(s, t).attributes ?? []).includes('Huge') ? 12 : 16), destroyMargin: 6, hugeAllowed: true }),
  'hurricane': disaster({ power: (s, t) => ((def(s, t).attributes ?? []).includes('Huge') ? 16 : 20), destroyMargin: null, hugeAllowed: true, devastateOnly: true, coastalOnly: true }),
  'tidal-wave': disaster({ power: (s, t) => ((def(s, t).attributes ?? []).includes('Huge') ? 20 : 24), destroyMargin: 11, hugeAllowed: true, coastalOnly: true }),

  // Assassinations
  'sniper': assassination(10, { alignments: ['Government'] }),
  'hit-and-run': assassination(10, { alignments: ['Fanatic'] }),
  'car-bomb': assassination(8, { alignments: ['Violent', 'Criminal'] }),
  // A Magic helper joins the attack (as an aiding Group), which makes the attack Magic.
  'poison': assassination(8, [{ alignments: ['Criminal'] }, { attributes: ['Magic'] }]),

  // Cancels
  'hoax': counter({
    check: (s, pl, play) => {
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      return totalPower(s, play.payWith) >= 6 ? null : 'Pay with Groups whose Power totals 6 or more.';
    },
    pay: (s, pl, play) => {
      pay(s, play.payWith);
      const top = player(s, pl).plotDeck.shift();
      if (top) { s.cards[top].zone = 'hand'; player(s, pl).hand.push(top); discardCard(s, top); }
    },
  }),
  'secrets-man-was-not-meant-to-know': counter({
    check: (s, pl, play) => {
      const p = player(s, pl);
      if (play.mode === 'deck') return p.plotDeck.length >= 2 ? null : 'You need two cards in your Plot deck.';
      return s.cards[p.illuminati].tokens >= 1 ? null : 'Your Illuminati needs an Action token (or discard two Plots from your deck).';
    },
    pay: (s, pl, play) => {
      const p = player(s, pl);
      if (play.mode === 'deck') {
        for (const top of p.plotDeck.splice(0, 2)) { s.cards[top].zone = 'hand'; p.hand.push(top); discardCard(s, top); }
      } else s.cards[p.illuminati].tokens = 0;
    },
  }),
  // Cancels one action of a Group: inside an attack, or an action announced outside attacks (a move,
  // an ability used in the main phase, Relief, ...).
  'are-we-having-fun-yet': {
    timing: ['attack', 'event'],
    events: ['action'],
    needs: { target: 'anyGroup', pay: 'tokens' },
    check(s, pl, play, ctx) {
      if (ctx) {
        if (ctx.instant) return 'Play this against a Group acting in an attack, or right after an action is announced.';
        const acting = [ctx.attacker, ...ctx.aid.map((a) => a.iid), ...ctx.oppose.map((o) => o.iid)];
        if (!play.target || !acting.includes(play.target)) return 'Choose a Group that is taking an action in this attack.';
      } else {
        const e = announcedAction(s);
        if (!e) return 'Play this against a Group acting in an attack, or right after an action is announced.';
        if (!play.target || !announcedActors(e).includes(play.target) || !cancelActorEffect(e, play.target)) return 'Choose a Group that is taking the action just announced.';
      }
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      if (!play.payWith?.length || totalPower(s, play.payWith) <= power(s, play.target)) return `Pay with Groups whose total Power is more than ${power(s, play.target)}.`;
      return null;
    },
    apply(s, _pl, play, ctx): PlotEffect | void {
      pay(s, play.payWith);
      if (ctx) return { t: 'cancelGroup', group: play.target! };
    },
    resolve(s, pl, play) {
      const e = announcedAction(s);
      const effect = e && play.target ? cancelActorEffect(e, play.target) : undefined;
      if (effect) respondToAction(s, pl, play.card, effect);
    },
  },

  // Die rolls
  // Pay by discarding the top card of your Group deck (mode 'groupDeck') or two Group cards from your
  // hand (mode 'hand': you choose which two when you hold more than two).
  'fnord': rollPlot((s, pl, play) => {
    const p = player(s, pl);
    const inHand = p.hand.filter((x) => def(s, x).type === 'Group');
    const fromHand = play.mode === 'hand' || (!play.mode && !p.groupDeck.length);
    if (!fromHand) {
      const top = p.groupDeck.shift()!;
      s.cards[top].zone = 'hand'; p.hand.push(top); discardCard(s, top);
    } else if (inHand.length === 2) for (const g of inHand) discardCard(s, g);
    else {
      askChoice(s, pl, {
        key: 'fnord-discard', question: 'Choose two Group cards from your hand to discard.',
        options: inHand.map((g) => ({ id: g, label: def(s, g).name })), min: 2, max: 2, source: play.card,
      });
    }
    const dice = roll2d6(s);
    log(s, `Re-roll: ${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}.`, pl);
    return { t: 'reroll', dice };
  }, (s, pl, play, ctx) => {
    if (ctx.attackerPlayer !== pl) return 'You can only re-roll your own die roll.';
    const p = player(s, pl);
    const handOk = p.hand.filter((x) => def(s, x).type === 'Group').length >= 2;
    if (play.mode === 'hand') return handOk ? null : 'You need two Group cards in your hand to discard.';
    if (play.mode === 'groupDeck') return p.groupDeck.length ? null : 'Your Group deck is empty.';
    return p.groupDeck.length || handOk ? null : 'You need a Group card to discard.';
  }, { mode: ['groupDeck', 'hand'] }),
  'computer-virus': rollPlot((s, _pl, play) => {
    pay(s, play.payWith);
    return { t: 'delta', value: play.mode === 'down' ? -2 : 2 };
  }, (s, pl, play) => {
    const err = spend(s, pl, play.payWith);
    if (err) return err;
    if (play.payWith?.length !== 1 || !matches(s, play.payWith[0], { attributes: ['Science', 'Space', 'Computer'] })) return 'Pay with the action of one Science, Space or Computer Group.';
    return null;
  }, { pay: 'tokens', mode: ['up', 'down'] }),
  'murphy-s-law': rollPlot((s, pl) => {
    s.cards[player(s, pl).illuminati].tokens = 0;
    return { t: 'set', value: 12 };
  }, (s, pl) => (s.cards[player(s, pl).illuminati].tokens >= 1 ? null : 'Your Illuminati needs at least one Action token.')),
  'bribery': rollPlot((s, pl) => {
    s.cards[player(s, pl).illuminati].tokens = 0;
    return { t: 'set', value: 2 };
  }, (s, pl) => (s.cards[player(s, pl).illuminati].tokens >= 1 ? null : 'Your Illuminati needs at least one Action token.')),
  'read-my-lips': rollPlot(() => ({ t: 'fail' }), (s, pl, _play, ctx) => {
    if (ctx.assassination || ctx.instant) return 'Not against Assassinations or Instant attacks.';
    if (s.cards[ctx.target].controller !== pl || def(s, ctx.target).subtype !== 'Personality') return 'Only when one of your Personalities is attacked.';
    return currentOutcome(s, ctx) === 'success' ? null : 'Only after the attack has succeeded.';
  }),

  // Privileged attacks
  // Free when your Illuminati or one of your Secret Groups makes the attack; otherwise one of them
  // spends a token (`payWith`, or the Illuminati first, then your weakest Secret Group).
  'privileged-attack': {
    timing: ['declare'],
    check(s, pl, play, ctx) {
      if (!ctx || ctx.instant || ctx.attackerPlayer !== pl) return 'Play this when you declare an attack.';
      if (play.payWith?.length) {
        if (play.payWith.length !== 1 || !privilegeActor(s, pl, play.payWith[0])) return 'Only your Illuminati or one of your Secret Groups can pay for this.';
        return s.cards[play.payWith[0]].tokens >= 1 ? null : `${def(s, play.payWith[0]).name} has no Action token to spend.`;
      }
      if (ctx.attacker && privilegeActor(s, pl, ctx.attacker)) return null;
      return privilegePayer(s, pl) ? null : 'Your Illuminati or one of your Secret Groups must make the attack or spend an Action token.';
    },
    apply(s, pl, play, ctx): PlotEffect {
      const payer = play.payWith?.[0] ?? (ctx!.attacker && privilegeActor(s, pl, ctx!.attacker) ? undefined : privilegePayer(s, pl));
      if (payer) s.cards[payer].tokens--;
      return { t: 'privileged' };
    },
  },
  'eat-the-rich': privilegedPlot(10, (s, pl, ctx) =>
    ctx.type !== 'destroy' || power(s, ctx.target) < 6 ? 'Only with an Attack to Destroy on a Group with Power 6 or more.'
      : onAttackSide(s, pl, ctx, { attributes: ['Media'] }) ? null : 'One of your Media Groups must be attacking or aiding.'),
  'censorship': privilegedPlot(15, (s, pl, ctx) =>
    !matches(s, ctx.target, { attributes: ['Media'] }) ? 'Only against a Media Group.'
      : onAttackSide(s, pl, ctx, { alignments: ['Straight', 'Conservative', 'Government'] }) ? null : 'A Straight, Conservative or Government Group of yours must be attacking or aiding.'),
  'ketchup-is-a-vegetable': privilegedPlot(5, (s, _pl, ctx) =>
    ctx.type === 'destroy' && alignments(s, ctx.target).includes('Government') ? null : 'Only with an Attack to Destroy on a Government Group.'),
  'deep-agent': {
    timing: ['attack'],
    check: (_s, _pl, _play, ctx) => (ctx && isPrivileged(ctx) ? null : 'Only against a Privileged attack.'),
    apply: (): PlotEffect => ({ t: 'unprivilege' }),
  },
  'interference': {
    timing: ['attack'],
    check: (_s, _pl, _play, ctx) => (ctx && isPrivileged(ctx) ? null : 'Only during a Privileged attack.'),
    apply: (_s, pl): PlotEffect => ({ t: 'interfere', player: pl }),
  },

  // Attack boosts
  'swiss-bank-account': {
    timing: ['declare'],
    check: (s, pl, _play, ctx) => (ctx && ctx.attacker === player(s, pl).illuminati ? null : 'Only when your Illuminati makes the attack.'),
    apply(s, pl, play, ctx) { ctx!.attackBonus.push({ player: pl, plot: play.card, amount: 10, label: 'Swiss Bank Account' }); },
  },
  'whispering-campaign': {
    timing: ['declare'],
    needs: { pay: 'tokens' },
    check(s, pl, play, ctx) {
      if (!ctx || ctx.instant || ctx.type !== 'destroy' || ctx.attackerPlayer !== pl) return 'Play this with your Attack to Destroy.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      return play.payWith?.length === 1 && matches(s, play.payWith[0], { attributes: ['Media'] }) ? null : 'Pay with the action of one of your Media Groups.';
    },
    apply(s, pl, play, ctx) {
      pay(s, play.payWith);
      ctx!.attackBonus.push({ player: pl, plot: play.card, amount: def(s, ctx!.target).subtype === 'Personality' ? 15 : 10, label: 'Whispering Campaign' });
      // Stays linked to this attack so that it can keep a Personality it destroys out for good.
      s.cards[play.card].linkedTo = `attack:${ctx!.id}`;
    },
  },

  // Other
  'savings-loan-scam': {
    timing: ['anytime'],
    needs: { pay: 'tokens' },
    check: (s, pl, play) => spend(s, pl, play.payWith) ?? (play.payWith?.length === 1 ? null : 'Pay with one Group\'s action.'),
    apply(s, pl, play, ctx) { pay(s, play.payWith); if (ctx) drawPlot(s, player(s, pl), 3); },
    resolve: (s, pl) => drawPlot(s, player(s, pl), 3),
  },
  'good-polls': {
    timing: ['anytime'],
    needs: { alignment: true },
    check: (_s, _pl, play) => (play.alignment ? null : 'Choose an alignment.'),
    ...effectNow((s, pl, play) => {
      for (const g of structureCards(s, pl)) {
        if (isGroup(s, g) && alignments(s, g).includes(play.alignment!)) {
          s.cards[g].mods.push({ source: play.card, kind: 'mulPower', value: 3, defenseOnly: true, until: 'startOfOwnerTurn', countsForGoals: false });
          s.cards[g].mods.push({ source: play.card, kind: 'mulResistance', value: 3, defenseOnly: true, until: 'startOfOwnerTurn', countsForGoals: false });
        }
      }
    }),
  },

  // New World Orders
  'solidarity': nwo(),
  'law-and-order': nwo(),
  'bigger-business': nwo(),
  'gun-control': nwo(),
  'a-thousand-points-of-light': nwo(),
  'fear-and-loathing': nwo(),
  'don-t-forget-to-smash-the-state': nwo(),
  'chicken-in-every-pot': nwo(),
  'energy-crisis': nwo(),
});

registerChoice('fnord-discard', {
  resolve(s, pl, picked) {
    for (const g of picked) if (player(s, pl).hand.includes(g) && def(s, g).type === 'Group') discardCard(s, g);
    log(s, `${player(s, pl).name} discards two Group cards to pay for Fnord!`, pl);
  },
  // The computer gives up its two weakest Group cards.
  ai: (s, _pl, options) => [...options].sort((a, b) => (def(s, a.id).power ?? 0) - (def(s, b.id).power ?? 0)).slice(0, 2).map((o) => o.id),
});

registerHooks({
  // A Personality destroyed by a Whispering Campaign leaves public life: nothing can bring it back.
  'whispering-campaign': {
    onAttackEnd(s, self, ctx) {
      if (s.cards[self].linkedTo !== `attack:${ctx.id}`) return;
      if (ctx.result === 'success' && s.cards[ctx.target].zone === 'destroyed' && def(s, ctx.target).subtype === 'Personality') {
        s.cards[ctx.target].data = { ...s.cards[ctx.target].data, neverReturns: true };
        log(s, `${def(s, ctx.target).name} is out of public life for good.`);
      }
      discardCard(s, self);
    },
  },
});
