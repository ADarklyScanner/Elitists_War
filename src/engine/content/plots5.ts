// Encoded by the card-content pass. See docs/CARD_SCRIPTING.md.
// Plot cards R–W (third batch).
import type { Alignment, AttackCtx, GameState, PlotEffect, PlotPlay } from '../types';
import type { PlotHandler } from '../plotTypes';
import { registerPlots } from '../plotTypes';
import { registerChoice, registerHooks } from '../hooks';
import { def, OPPOSITE } from '../cards';
import { type Match, matches } from '../abilities';
import { alignments, globalPower, power } from '../stats';
import { roll2d6 } from '../rng';
import {
  activePlayer, askChoice, attackCancelled, attackStrength, canEnterPlay, controllerOf2, currentOutcome, destroyGroup,
  discardCard, drawGroup, finalRoll, isPrivileged, livePlayers, log, player, playResourceCard, protectedPlayer,
  startInstantAttack, tokenBarred,
  disasterTarget,
} from '../game';

// ---------------------------------------------------------------- helpers (copied from plots.ts)

const own = (s: GameState, pl: string, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure' && s.cards[iid].controller === pl;
const isGroup = (s: GameState, iid?: string) => !!iid && def(s, iid).type === 'Group';
const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';
const describe = (m: Match) => [...(m.alignments ?? []), ...(m.attributes ?? []), ...(m.subtypes ?? [])].join('/');

function spend(s: GameState, pl: string, groups: string[] = []): string | null {
  for (const g of groups) if (!own(s, pl, g) || s.cards[g].tokens < 1) return 'Every paying Group must be yours and have an Action token.';
  if (new Set(groups).size !== groups.length) return 'A Group can only pay once.';
  return null;
}
function pay(s: GameState, groups: string[] = []) { for (const g of groups) s.cards[g].tokens--; }
const totalPower = (s: GameState, groups: string[] = []) => groups.reduce((n, g) => n + power(s, g), 0);

/** Happens at once inside an attack, or after the counter window otherwise. */
function effectNow(fn: (s: GameState, pl: string, play: PlotPlay) => void): Pick<PlotHandler, 'apply' | 'resolve'> {
  return {
    apply: (s, pl, play, ctx) => { if (ctx) fn(s, pl, play); },
    resolve: fn,
  };
}

/** "Your Illuminati's action, or actions of [X] Groups whose Power totals at least `min`." */
function illuminatiOr(s: GameState, pl: string, payers: string[] | undefined, m: Match, min: number): string | null {
  const p = payers ?? [];
  const err = spend(s, pl, p);
  if (err) return err;
  const ill = player(s, pl).illuminati;
  if (p.length === 1 && p[0] === ill) return null;
  if (!p.length || p.some((g) => g === ill || !matches(s, g, m))) return `Pay with your Illuminati's action, or with ${describe(m)} Groups.`;
  if (totalPower(s, p) < min) return `The paying ${describe(m)} Groups need at least ${min} Power in total.`;
  return null;
}

/** The rival a card is aimed at: the controller of `target`, or the only rival in a two-player game. */
function chosenRival(s: GameState, pl: string, play: PlotPlay): string | undefined {
  if (play.target && s.cards[play.target]) {
    const c = s.cards[play.target];
    const who = c.zone === 'structure' || c.zone === 'resources' ? c.controller : undefined;
    return who && who !== pl ? who : undefined;
  }
  const rivals = livePlayers(s).filter((p) => p.id !== pl);
  return rivals.length === 1 ? rivals[0].id : undefined;
}
function rivalError(s: GameState, pl: string, play: PlotPlay): string | null {
  const r = chosenRival(s, pl, play);
  if (!r) return 'Choose a rival (pick one of their cards in play).';
  if (protectedPlayer(s, pl, r)) return 'That player has not finished a first turn yet.';
  return null;
}

/** Uses the target's action; its Power is raised to `value` and the card stays linked. */
function raiseTo(value: number, match: Match, onePerPlayer: boolean): PlotHandler {
  return {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'ownGroup' },
    check(s, pl, play) {
      if (!own(s, pl, play.target) || !isGroup(s, play.target) || !matches(s, play.target!, match)) return `Choose a ${describe(match)} Group you control.`;
      if (s.cards[play.target!].tokens < 1) return 'That Group needs an available action.';
      const cardId = s.cards[play.card].cardId;
      if (onePerPlayer && Object.values(s.cards).some((c) => c.cardId === cardId && c.zone === 'table' && c.controller === pl && c.linkedTo)) return 'You may only have one of these in play.';
      return null;
    },
    apply(s, _pl, play, ctx) {
      s.cards[play.target!].tokens--;
      if (ctx) link(s, play);
    },
    resolve: (s, _pl, play) => link(s, play),
  };
  function link(s: GameState, play: PlotPlay) {
    if (!inPlay(s, play.target)) return;
    s.cards[play.target!].mods.push({ source: play.card, kind: 'setPower', value, until: 'permanent' });
    s.cards[play.card].linkedTo = play.target;
  }
}

function disaster(opts: { power: number; destroyMargin: number; hugeAllowed: boolean }): PlotHandler {
  return {
    timing: ['instant'],
    needs: { target: 'place' },
    check(s, _pl, play) {
      if (!disasterTarget(s, play.target)) return 'Choose a Place in play.';
      if (!opts.hugeAllowed && (def(s, play.target!).attributes ?? []).includes('Huge')) return 'This Disaster cannot strike a Huge Place.';
      return null;
    },
    apply(s, pl, play) {
      startInstantAttack(s, pl, { plot: play.card, target: play.target!, power: opts.power, disaster: { destroyMargin: opts.destroyMargin } });
    },
  };
}

function assassination(base: number, helper: Match): PlotHandler {
  return {
    timing: ['instant'],
    needs: { target: 'personality', helper: true },
    check(s, pl, play) {
      if (!inPlay(s, play.target) || def(s, play.target!).subtype !== 'Personality') return 'Choose a Personality in play.';
      if (play.helper && (!own(s, pl, play.helper) || s.cards[play.helper].tokens < 1 || !matches(s, play.helper, helper))) return `The helping Group must be your ${describe(helper)} Group with an Action token.`;
      return null;
    },
    apply(s, pl, play) {
      startInstantAttack(s, pl, { plot: play.card, target: play.target!, power: base, assassination: true, helper: play.helper });
    },
  };
}

/** "Right after placing Action tokens": in your own main phase before anything else has happened this turn. */
const START_OK = /takes over .* automatically\.|brings .* into play\./;
function rightAfterTokens(s: GameState, pl: string): string | null {
  if (s.phase !== 'main' || activePlayer(s).id !== pl || s.attack || s.window) return 'Play this in your own turn, right after placing Action tokens.';
  let i = s.log.length - 1;
  while (i >= 0 && !(s.log[i].turn === s.turn && s.log[i].text.startsWith('— Turn'))) i--;
  if (i < 0) return null;
  if (s.log.slice(i + 1).some((e) => !e.info && !START_OK.test(e.text))) return 'Too late: this must be played right after placing Action tokens, before doing anything else.';
  return null;
}

/** One extra Action token each for the first `n` distinct recipients (your Groups). */
function extraTokens(s: GameState, pl: string, recipients: string[], n: number) {
  let given = 0;
  for (const g of recipients.slice(0, n)) {
    if (!own(s, pl, g) || tokenBarred(s, g)) continue;
    s.cards[g].tokens++;
    given++;
  }
  log(s, `${given} Group${given === 1 ? ' gets' : 's get'} an extra Action token.`, pl);
}
function recipientsError(s: GameState, pl: string, t: string[] | undefined): string | null {
  const list = t ?? [];
  if (new Set(list).size !== list.length) return 'No Group may receive more than one extra token from this card.';
  if (!list.every((g) => own(s, pl, g))) return 'Extra tokens go only to Groups in your own Power Structure.';
  return null;
}

const isNation = (s: GameState, iid: string) => (def(s, iid).attributes ?? []).includes('Nation');
const isDictatorship = (s: GameState, iid: string) =>
  Object.values(s.cards).some((c) => c.cardId === 'dictatorship' && c.zone === 'table' && c.linkedTo === iid)
  || s.cards[iid].mods.some((m) => s.cards[m.source]?.cardId === 'dictatorship');
const artifactOrGadget = (s: GameState, iid: string) =>
  /\b(Artifact|Gadget)\b/.test(def(s, iid).uniqueness ?? '') || (def(s, iid).attributes ?? []).some((a) => a === 'Artifact' || a === 'Gadget');

// ---------------------------------------------------------------- the cards

registerPlots({
  // +10 to an attack on a Nation (+20 on a Dictatorship); paid by a Group not taking part in it.
  'revolution': {
    timing: ['declare', 'attack'],
    needs: { pay: 'tokens' },
    check(s, pl, play, ctx) {
      if (!ctx || ctx.instant) return 'Play this along with an attack on a Nation.';
      if (!isNation(s, ctx.target)) return 'The target of the attack must be a Nation.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      if (play.payWith?.length !== 1) return 'Pay with the action of one Group.';
      const g = play.payWith[0];
      if (g === ctx.attacker || ctx.aid.some((a) => a.iid === g)) return 'The paying Group must not be one of the Groups making the attack.';
      return null;
    },
    apply(s, pl, play, ctx) {
      pay(s, play.payWith);
      ctx!.attackBonus.push({ player: pl, plot: play.card, amount: isDictatorship(s, ctx!.target) ? 20 : 10, label: 'Revolution' });
    },
  },

  // Add, remove or reverse one alignment of a destroyed Group.
  'rewriting-history': {
    timing: ['anytime'],
    needs: { target: 'anyGroup', mode: ['add', 'remove', 'reverse'], alignment: true, pay: 'tokens' },
    check(s, pl, play) {
      if (!play.target || s.cards[play.target]?.zone !== 'destroyed' || !isGroup(s, play.target)) return 'Choose a destroyed Group.';
      const al = alignments(s, play.target);
      const a = play.alignment;
      if (!a) return 'Choose an alignment.';
      const mode = play.mode ?? 'add';
      if (mode === 'add' && al.includes(a)) return 'That Group already has this alignment.';
      if (mode === 'remove' && !al.includes(a)) return 'That Group does not have this alignment.';
      if (mode === 'reverse' && (!al.includes(a) || !OPPOSITE[a])) return 'Choose an alignment the Group has that has an opposite.';
      if (!['add', 'remove', 'reverse'].includes(mode)) return 'Choose add, remove or reverse.';
      return illuminatiOr(s, pl, play.payWith, { attributes: ['Media'] }, 8);
    },
    apply(s, _pl, play, ctx) { pay(s, play.payWith); if (ctx) rewrite(s, play); },
    resolve: (s, _pl, play) => rewrite(s, play),
  },

  // Remove all Action tokens from a rival's Groups of one alignment the paying Media Group has.
  'scandal': {
    timing: ['anytime'],
    needs: { pay: 'tokens', alignment: true },
    check(s, pl, play, ctx) {
      if (ctx) return 'Scandal cannot be played during an attack.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      const m = play.payWith?.[0];
      if (play.payWith?.length !== 1 || !matches(s, m!, { attributes: ['Media'] }) || power(s, m!) < 2) return 'Pay with the action of one of your Media Groups with Power 2 or more.';
      if (!play.alignment || !alignments(s, m!).includes(play.alignment)) return 'Choose an alignment that the acting Media Group has.';
      return rivalError(s, pl, play);
    },
    apply(s, _pl, play) { pay(s, play.payWith); },
    resolve(s, pl, play) {
      const r = chosenRival(s, pl, play);
      if (!r) return;
      let n = 0;
      for (const c of Object.values(s.cards)) {
        if (c.zone === 'structure' && c.controller === r && c.tokens > 0 && alignments(s, c.iid).includes(play.alignment!)) { c.tokens = 0; n++; }
      }
      log(s, `${n} ${play.alignment} Group${n === 1 ? '' : 's'} of ${player(s, r).name} lose their Action tokens.`, pl);
    },
  },

  // Power becomes 6; one in play per player.
  'self-esteem': raiseTo(6, { alignments: ['Liberal'] }, true),
  // Power increased to 4; one in play per player.
  'the-weird-turn-pro': raiseTo(4, { alignments: ['Weird'] }, true),

  // Add the Power of a second Assassination from hand to your Assassination.
  'spasm-of-violence': {
    timing: ['attack'],
    check(s, pl, play, ctx) {
      if (!ctx || !ctx.assassination || !ctx.instant || ctx.attackerPlayer !== pl) return 'Play this with one of your own Assassinations.';
      if (!secondAssassination(s, pl, play, ctx)) return 'You need a second Assassination card in hand to play along with it.';
      return null;
    },
    apply(s, pl, play, ctx) {
      const second = secondAssassination(s, pl, play, ctx!)!;
      const amount = parseInt(def(s, second).attackPower ?? '0', 10) || 0;
      discardCard(s, second);
      log(s, `${def(s, second).name} adds its Power (${amount}).`, pl);
      ctx!.attackBonus.push({ player: pl, plot: play.card, amount, label: `Spasm of Violence (${def(s, second).name})` });
    },
  },

  // One of your Groups acts at x4 Power, then is destroyed without counting for Goals.
  'sucked-dry-and-cast-aside': {
    timing: ['declare', 'attack'],
    needs: { target: 'ownGroup' },
    check(s, pl, play, ctx) {
      if (!own(s, pl, play.target) || !isGroup(s, play.target)) return 'Choose one of your Groups (not your Illuminati).';
      if (!ctx) return 'Play this when that Group takes an action in an attack.';
      const t = play.target!;
      const leading = ctx.attacker === t && !s.window;
      const joining = ctx.aid.some((a) => a.iid === t) || ctx.oppose.some((o) => o.iid === t);
      if (!leading && !joining) return 'Play it on the attacking Group as the attack is declared, or on a Group of yours aiding or opposing.';
      return null;
    },
    apply(s, pl, play, ctx) {
      const t = play.target!;
      const opposing = ctx!.oppose.find((o) => o.iid === t) as ({ useGlobal?: boolean } | undefined);
      const aiding = ctx!.aid.find((a) => a.iid === t) as ({ useGlobal?: boolean } | undefined);
      const base = (opposing ?? aiding)?.useGlobal ? globalPower(s, t) : power(s, t);
      (opposing ? ctx!.defenseBonus : ctx!.attackBonus).push({ player: pl, plot: play.card, amount: 3 * base, label: 'Sucked Dry and Cast Aside (x4)' });
      s.cards[play.card].linkedTo = t; // destroyed with its Group once the attack is over
    },
  },

  // Discard every New World Order in play. Other players' Media Groups may help pay: each of those
  // players is asked, and the NWOs go only if all of them agree.
  'sweeping-reforms': {
    timing: ['anytime'],
    needs: { pay: 'tokens' },
    check(s, pl, play, ctx) {
      const payers = play.payWith ?? [];
      if (new Set(payers).size !== payers.length) return 'A Group can only pay once.';
      const mine = payers.filter((g) => s.cards[g]?.controller === pl);
      const theirs = payers.filter((g) => !mine.includes(g));
      const err = spend(s, pl, mine);
      if (err) return err;
      for (const g of theirs) {
        if (!inPlay(s, g) || s.cards[g].tokens < 1 || tokenBarred(s, g)) return 'Every paying Group must have an Action token.';
        if (protectedPlayer(s, pl, s.cards[g].controller)) return 'That player has not finished a first turn yet.';
      }
      if (theirs.length && ctx) return 'Other players\' Media Groups can only help outside an attack.';
      if (!payers.length || !payers.every((g) => matches(s, g, { attributes: ['Media'] }))) return 'Pay with the actions of Media Groups.';
      if (totalPower(s, payers) < 6) return 'The paying Media Groups need at least 6 Power in total.';
      return null;
    },
    apply(s, pl, play, ctx) {
      pay(s, (play.payWith ?? []).filter((g) => s.cards[g].controller === pl));
      if (ctx) reform(s);
    },
    resolve(s, pl, play) {
      const byOwner = new Map<string, string[]>();
      for (const g of play.payWith ?? []) {
        const owner = s.cards[g].controller;
        if (owner && owner !== pl) byOwner.set(owner, [...(byOwner.get(owner) ?? []), g]);
      }
      if (!byOwner.size) { reform(s); return; }
      // Ask each other paying player; the NWOs go once all of them have agreed.
      s.cards[play.card].data = { ...s.cards[play.card].data, waiting: [...byOwner.keys()], agreed: [] };
      for (const [owner, groups] of byOwner) {
        askChoice(s, owner, {
          key: 'sweeping-reforms-help',
          question: `${player(s, pl).name} wants ${groups.map((g) => def(s, g).name).join(' and ')} to spend ${groups.length === 1 ? 'its action' : 'their actions'} on Sweeping Reforms. Do you agree?`,
          options: [{ id: 'yes', label: 'Agree' }, { id: 'no', label: 'Refuse' }],
          min: 1, max: 1, source: play.card, data: { groups, asker: pl },
        });
      }
    },
  },

  // Linked: +4 on direct Attacks to Control made by that Personality.
  'sweepstakes-prize': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'personality' },
    check(s, pl, play) {
      if (!own(s, pl, play.target) || def(s, play.target!).subtype !== 'Personality') return 'Choose one of your Personalities.';
      if (Object.values(s.cards).some((c) => c.cardId === 'sweepstakes-prize' && c.zone === 'table' && c.controller === pl && c.linkedTo)) return 'You already have a Sweepstakes Prize in play; each player may have only one.';
      return null;
    },
    ...effectNow((s, _pl, play) => { if (inPlay(s, play.target)) s.cards[play.card].linkedTo = play.target; }),
  },

  // An Assassination fails; the Talisman stays with the Personality it saved.
  'talisman-of-ahrimanes': {
    timing: ['attack', 'roll'],
    linked: true,
    check(s, _pl, play, ctx) {
      if (!ctx || !ctx.assassination) return 'Play this only after an Assassination.';
      if (Object.values(s.cards).some((c) => c.iid !== play.card && c.cardId === 'talisman-of-ahrimanes' && c.zone === 'table' && c.linkedTo)) return 'A Talisman of Ahrimanes is already in play; only one may be in play at a time.';
      return null;
    },
    apply(s, _pl, play, ctx): PlotEffect {
      s.cards[play.card].linkedTo = ctx!.target;
      return { t: 'fail' };
    },
  },

  // Discard Groups/Resources from hand and the top of your Groups deck for extra tokens.
  // payWith = cards from hand to discard; mode = how many cards from the top of the Groups deck
  // (default: one per recipient); targets = Groups to receive the extra tokens, in order.
  'the-big-sellout': {
    timing: ['anytime'],
    needs: { targets: true },
    check(s, pl, play) {
      const err = rightAfterTokens(s, pl);
      if (err) return err;
      const hand = play.payWith ?? [];
      const p = player(s, pl);
      if (new Set(hand).size !== hand.length || !hand.every((c) => p.hand.includes(c) && ['Group', 'Resource'].includes(def(s, c).type))) return 'Discard only Groups and Resources from your hand.';
      const deck = deckCount(play);
      if (deck === null) return 'Say how many cards to discard from your Groups deck.';
      if (hand.length + deck > 10) return 'Discard at most 10 cards in total.';
      if (deck > p.groupDeck.length) return 'Your Groups deck does not have that many cards.';
      if (hand.length + deck === 0) return 'Discard at least one card.';
      return recipientsError(s, pl, play.targets);
    },
    apply(s, pl, play) {
      const p = player(s, pl);
      let groups = 0;
      for (const c of play.payWith ?? []) { if (def(s, c).type === 'Group') groups++; discardCard(s, c); }
      for (const c of p.groupDeck.splice(0, deckCount(play) ?? 0)) {
        if (def(s, c).type === 'Group') groups++;
        s.cards[c].zone = 'hand'; p.hand.push(c); discardCard(s, c);
      }
      log(s, `${groups} Group${groups === 1 ? '' : 's'} sold out.`, pl);
      s.cards[play.card].data = { groups };
    },
    resolve(s, pl, play) {
      extraTokens(s, pl, play.targets ?? [], Number(s.cards[play.card].data?.groups ?? 0));
    },
  },

  // +20 to an Attack to Destroy the Lawyers.
  'the-first-thing-we-do-let-s-kill-all-the-lawyers': {
    timing: ['declare', 'attack'],
    check: (s, _pl, _play, ctx) => (ctx && ctx.type === 'destroy' && s.cards[ctx.target].cardId === 'lawyers' ? null : 'Only with an Attack to Destroy the Lawyers.'),
    apply(s, pl, play, ctx) {
      ctx!.attackBonus.push({ player: pl, plot: play.card, amount: 20, label: 'Kill All The Lawyers' });
      log(s, '"The first thing we do, let\'s kill all the lawyers."', pl);
    },
  },

  // Discard the top three cards of a rival's Plot deck.
  'the-internet-worm': {
    timing: ['anytime'],
    needs: { pay: 'tokens' },
    check: (s, pl, play) => illuminatiOr(s, pl, play.payWith, { attributes: ['Computer'] }, 3) ?? rivalError(s, pl, play),
    apply(s, pl, play, ctx) { pay(s, play.payWith); if (ctx) worm(s, pl, play); },
    resolve: worm,
  },

  // Disaster (errata): Power 24, not Huge Places, destroyed on a margin of 10 or more.
  'the-oregon-crud': disaster({ power: 24, destroyMargin: 10, hugeAllowed: false }),

  // Turn your failed Attack to Destroy into a success with the actions of Groups that could have aided.
  'the-second-bullet': {
    timing: ['roll'],
    needs: { pay: 'tokens' },
    check(s, pl, play, ctx) {
      if (!ctx?.roll || ctx.instant || ctx.type !== 'destroy' || ctx.attackerPlayer !== pl) return 'Play this right after your own Attack to Destroy fails its roll.';
      if (attackCancelled(ctx) || currentOutcome(s, ctx) !== 'failure') return 'Only after your Attack to Destroy has failed its roll.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      if (!play.payWith?.length) return 'Choose the Groups that add their Power.';
      for (const g of play.payWith) if (bulletPower(s, ctx, g) === null) return `${def(s, g).name} could not have aided this attack.`;
      const r = finalRoll(ctx);
      if (r >= 11) return 'A roll of 11 or 12 always fails.';
      if (attackStrength(s, ctx).strength + bulletTotal(s, ctx, play.payWith) < r) return 'The Power of those Groups falls short of turning the roll into a success.';
      return null;
    },
    apply(s, pl, play, ctx) {
      const amount = bulletTotal(s, ctx!, play.payWith!);
      pay(s, play.payWith);
      ctx!.attackBonus.push({ player: pl, plot: play.card, amount, label: 'The Second Bullet' });
    },
  },

  // Your turn: an automatic takeover of one Resource from hand.
  'the-stars-are-right': {
    timing: ['anytime'],
    needs: { pay: 'tokens' },
    check(s, pl, play) {
      if (activePlayer(s).id !== pl) return 'Play this on your own turn.';
      const p = play.payWith ?? [];
      const err = spend(s, pl, p);
      if (err) return err;
      const ill = player(s, pl).illuminati;
      const byIll = p.length === 1 && p[0] === ill;
      if (!byIll && (!p.length || p.some((g) => g === ill || !matches(s, g, { attributes: ['Magic'] }) || power(s, g) < 4))) return 'Pay with your Illuminati\'s action, or with Magic Groups each with Power 4 or more.';
      if (!starResource(s, pl, play)) return 'Choose a Resource in your hand that can come into play.';
      return null;
    },
    apply(s, pl, play, ctx) { pay(s, play.payWith); if (ctx) stars(s, pl, play); },
    resolve: (s, pl, play) => stars(s, pl, play),
  },

  // Destroy a rival's Artifact or Gadget Resource.
  'the-weak-link': {
    timing: ['anytime'],
    needs: { pay: 'tokens' },
    check(s, pl, play, ctx) {
      if (ctx && isPrivileged(ctx)) return 'Not during a Privileged attack.';
      if (!weakTarget(s, pl, play)) return 'Choose an Artifact or Gadget Resource a rival owns.';
      return illuminatiOr(s, pl, play.payWith, { attributes: ['Science', 'Magic', 'Computer'] }, 6);
    },
    apply(s, pl, play, ctx) { pay(s, play.payWith); if (ctx) weak(s, pl, play); },
    resolve: (s, pl, play) => weak(s, pl, play),
  },

  // Another player's successful roll: he must roll again, and draws a Group card.
  'time-warp': {
    timing: ['roll'],
    check(s, pl, _play, ctx) {
      if (!ctx?.roll) return 'Play this right after a die roll.';
      if (ctx.attackerPlayer === pl) return 'Only against another player\'s roll.';
      return currentOutcome(s, ctx) === 'success' ? null : 'Only after a successful roll.';
    },
    apply(s, pl, _play, ctx): PlotEffect {
      const dice = roll2d6(s);
      log(s, `Time Warp: ${player(s, ctx!.attackerPlayer).name} rolls again: ${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}.`, pl);
      drawGroup(s, player(s, ctx!.attackerPlayer));
      return { t: 'reroll', dice };
    },
  },

  // +6 defense against a Disaster; if the Place is still Devastated, Relief at the start of its owner's next turn.
  'volunteer-aid': {
    timing: ['attack'],
    needs: { target: 'place' },
    check(s, _pl, play, ctx) {
      if (!ctx?.disaster) return 'Play this when a Disaster strikes a Place.';
      if (play.target && play.target !== ctx.target) return 'Choose the Place the Disaster is striking.';
      return null;
    },
    apply(s, pl, play, ctx) {
      ctx!.defenseBonus.push({ player: pl, plot: play.card, amount: 6, label: 'Volunteer Aid' });
      s.cards[play.card].linkedTo = ctx!.target;
    },
  },

  // Remove up to 10 top Plots of your deck from the game for extra tokens. Errata: Illuminati action, once per game.
  // mode = how many cards to remove (default: one per recipient); targets = Groups receiving the tokens.
  'voodoo-economics': {
    timing: ['anytime'],
    needs: { targets: true },
    check(s, pl, play) {
      const err = rightAfterTokens(s, pl);
      if (err) return err;
      const ill = player(s, pl).illuminati;
      if (s.cards[ill].data?.voodooEconomics) return 'You may use Voodoo Economics only once per game.';
      if (s.cards[ill].tokens < 1) return 'This costs your Illuminati\'s action.';
      const n = deckCount(play);
      if (n === null || n < 0 || n > 10) return 'Remove between 0 and 10 cards.';
      if (n > player(s, pl).plotDeck.length) return 'Your Plot deck does not have that many cards.';
      return recipientsError(s, pl, play.targets);
    },
    apply(s, pl, play) {
      const p = player(s, pl);
      const ill = s.cards[p.illuminati];
      ill.tokens--;
      ill.data = { ...ill.data, voodooEconomics: true };
      const gone = p.plotDeck.splice(0, deckCount(play) ?? 0);
      // Out of the game: the 'destroyed' zone is the engine's pile of cards that never return.
      for (const c of gone) Object.assign(s.cards[c], { zone: 'destroyed', controller: undefined });
      s.cards[play.card].data = { removed: gone.length };
      log(s, `${gone.length} Plot card${gone.length === 1 ? ' is' : 's are'} removed from the game.`, pl);
    },
    resolve(s, pl, play) {
      extraTokens(s, pl, play.targets ?? [], Number(s.cards[play.card].data?.removed ?? 0));
    },
  },

  // A rival's Group that failed a takeover from hand goes to your hand instead of his discard pile.
  'vultures': {
    timing: ['anytime'],
    check: (s, pl, play) => (vultureTarget(s, pl, play) ? null : 'Choose a Group a rival failed to take over from hand this turn.'),
    apply() {},
    resolve(s, pl, play) {
      const g = vultureTarget(s, pl, play);
      if (!g) return;
      for (const p of s.players) p.hand = p.hand.filter((x) => x !== g);
      s.cards[g].failedTakeoverTurn = undefined;
      s.cards[g].exposed = false;
      player(s, pl).hand.push(g);
      log(s, `${player(s, pl).name} takes ${def(s, g).name}.`, pl);
    },
  },

  // Assassination: Power 10, one Magic Group may join.
  'withering-curse': assassination(10, { attributes: ['Magic'] }),
});

// ---------------------------------------------------------------- effects

function rewrite(s: GameState, play: PlotPlay) {
  const t = play.target!;
  const a = play.alignment!;
  const mode = play.mode ?? 'add';
  const c = s.cards[t];
  if (mode === 'add') c.mods.push({ source: play.card, kind: 'addAlign', align: a, until: 'permanent' });
  else if (mode === 'remove') c.mods.push({ source: play.card, kind: 'removeAlign', align: a, until: 'permanent' });
  else c.mods.push({ source: play.card, kind: 'addAlign', align: OPPOSITE[a] as Alignment, until: 'permanent' }); // the opposite replaces it
  log(s, `History is rewritten: ${def(s, t).name} is now ${alignments(s, t).join(', ') || 'unaligned'}.`);
}

function reform(s: GameState) {
  for (const [color, iid] of Object.entries(s.nwo)) {
    if (!iid) continue;
    if (s.cards[iid]?.zone === 'table') discardCard(s, iid);
    s.nwo[color] = undefined;
  }
  log(s, 'Every New World Order is discarded.');
}

function worm(s: GameState, pl: string, play: PlotPlay) {
  const r = chosenRival(s, pl, play);
  if (!r) return;
  const p = player(s, r);
  const top = p.plotDeck.splice(0, 3);
  for (const c of top) { s.cards[c].zone = 'hand'; p.hand.push(c); discardCard(s, c); }
  log(s, `${top.length} Plot card${top.length === 1 ? '' : 's'} from ${p.name}'s deck are discarded unseen.`, pl);
}

function secondAssassination(s: GameState, pl: string, play: PlotPlay, ctx: AttackCtx): string | undefined {
  const ok = (c: string) => player(s, pl).hand.includes(c) && def(s, c).subtype === 'Assassination' && c !== ctx.instantCard && c !== play.card;
  if (play.target) return ok(play.target) ? play.target : undefined;
  return player(s, pl).hand.find(ok);
}

function deckCount(play: PlotPlay): number | null {
  if (play.mode === undefined) return (play.targets ?? []).length;
  const n = Number(play.mode);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Power a Group adds with The Second Bullet, or null if it could not have aided the attack. */
function bulletPower(s: GameState, ctx: AttackCtx, g: string): number | null {
  if (g === ctx.attacker || g === ctx.target || [...ctx.aid, ...ctx.oppose].some((x) => x.iid === g)) return null;
  if (def(s, g).type !== 'Group' && def(s, g).type !== 'Illuminati') return null;
  const al = alignments(s, g), ta = alignments(s, ctx.target);
  const qualifies = al.some((a) => ta.some((b) => (a === 'Fanatic' && b === 'Fanatic') || (a !== b && OPPOSITE[a] === b)));
  if (qualifies) return power(s, g);
  const gp = globalPower(s, g);
  return gp > 0 ? gp : null;
}
const bulletTotal = (s: GameState, ctx: AttackCtx, groups: string[]) => groups.reduce((n, g) => n + (bulletPower(s, ctx, g) ?? 0), 0);

function starResource(s: GameState, pl: string, play: PlotPlay): string | undefined {
  const ok = (c: string) => player(s, pl).hand.includes(c) && def(s, c).type === 'Resource' && canEnterPlay(s, c, pl);
  if (play.target) return ok(play.target) ? play.target : undefined;
  return player(s, pl).hand.find(ok);
}
function stars(s: GameState, pl: string, play: PlotPlay) {
  const r = starResource(s, pl, play);
  if (r) playResourceCard(s, r, pl);
}

function weakTarget(s: GameState, pl: string, play: PlotPlay): string | undefined {
  const ok = (c: string) => s.cards[c]?.zone === 'resources' && s.cards[c].controller !== pl && artifactOrGadget(s, c) && !protectedPlayer(s, pl, s.cards[c].controller);
  if (play.target) return ok(play.target) ? play.target : undefined;
  const all = Object.values(s.cards).filter((c) => ok(c.iid));
  return all.length === 1 ? all[0].iid : undefined;
}
function weak(s: GameState, pl: string, play: PlotPlay) {
  const r = weakTarget(s, pl, play);
  if (!r) return;
  log(s, `${def(s, r).name} is destroyed.`, pl);
  discardCard(s, r);
}

function vultureTarget(s: GameState, pl: string, play: PlotPlay): string | undefined {
  const ok = (c: string) => {
    const card = s.cards[c];
    if (!card || card.zone !== 'hand' || card.failedTakeoverTurn !== s.turn || def(s, c).type !== 'Group') return false;
    const holder = s.players.find((p) => p.hand.includes(c));
    return !!holder && holder.id !== pl;
  };
  if (play.target) return ok(play.target) ? play.target : undefined;
  return Object.keys(s.cards).find(ok);
}

// ---------------------------------------------------------------- linked Plots

registerHooks({
  'sweepstakes-prize': {
    attackMod: (s, self, ctx, side) =>
      (side === 'attack' && ctx.type === 'control' && !ctx.instant && ctx.attacker === s.cards[self].linkedTo ? 4 : 0),
  },
  'talisman-of-ahrimanes': {
    attackMod: (s, self, ctx, side) =>
      (side === 'defense' && ctx.type === 'destroy' && ctx.target === s.cards[self].linkedTo ? (ctx.assassination ? 10 : 2) : 0),
  },
  'sucked-dry-and-cast-aside': {
    onAttackEnd(s, self, ctx) {
      if (!ctx.plays.some((p) => p.iid === self)) return;
      const g = s.cards[self].linkedTo;
      if (g && s.cards[g]?.zone === 'structure') {
        log(s, `${def(s, g).name} is sucked dry and cast aside.`);
        const by = s.cards[g].controller!;
        destroyGroup(s, g, by);
        for (const p of s.players) p.destroyedCredit = p.destroyedCredit.filter((x) => x !== g); // never counts for Goals
      }
      if (s.cards[self].zone === 'table') discardCard(s, self);
    },
  },
  'volunteer-aid': {
    onAttackEnd(s, self, ctx) {
      if (!ctx.plays.some((p) => p.iid === self)) return;
      const place = s.cards[self].linkedTo;
      if (place && s.cards[place]?.zone === 'structure' && s.cards[place].devastated) {
        // Relief arrives at the start of the Place owner's next turn.
        s.cards[self].controller = s.cards[place].controller;
      } else if (s.cards[self].zone === 'table') discardCard(s, self);
    },
    onTurnStart(s, self) {
      const place = s.cards[self].linkedTo;
      if (place && s.cards[place]?.zone === 'structure' && s.cards[place].devastated && s.cards[place].controller === controllerOf2(s, self)) {
        s.cards[place].devastated = false;
        log(s, `Volunteer Aid: ${def(s, place).name} receives Relief.`);
      }
      discardCard(s, self);
    },
  },
});

// A player asked to let his Media Groups pay for another player's Sweeping Reforms.
registerChoice('sweeping-reforms-help', {
  resolve(s, pl, picked, data) {
    const c = s.cards[data.source as string];
    const waiting = (c?.data?.waiting as string[] | undefined) ?? [];
    if (!c || !waiting.includes(pl)) return; // already settled (someone refused)
    const groups = data.groups as string[];
    const ready = groups.every((g) => s.cards[g]?.zone === 'structure' && s.cards[g].controller === pl && s.cards[g].tokens > 0 && !tokenBarred(s, g));
    if (picked[0] !== 'yes' || !ready) {
      c.data = { ...c.data, waiting: [] };
      log(s, `${player(s, pl).name} does not help: Sweeping Reforms has no effect.`, pl);
      return;
    }
    const agreed = [...((c.data?.agreed as string[] | undefined) ?? []), ...groups];
    const left = waiting.filter((x) => x !== pl);
    c.data = { ...c.data, waiting: left, agreed };
    log(s, `${player(s, pl).name} agrees to help with Sweeping Reforms.`, pl);
    if (left.length) return;
    for (const g of agreed) if (s.cards[g]?.zone === 'structure' && s.cards[g].tokens > 0) s.cards[g].tokens--;
    reform(s);
  },
  // The computer helps only when none of the New World Orders in play is its own.
  ai: (s, pl) => [Object.values(s.nwo).some((n) => !!n && s.cards[n]?.controller === pl) ? 'no' : 'yes'],
});
