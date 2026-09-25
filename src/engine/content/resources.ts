// Encoded by the card-content pass. See docs/CARD_SCRIPTING.md.
// The 36 Resource cards. A Resource enters play linked to its controller's Illuminati ("unlinked");
// `linkTo` limits which Groups it may be linked to. Parts the engine cannot express yet are marked
// `// PENDING: …`.
import type { Alignment, AttackCtx, Contribution, GameState, PlotEffect, Side } from '../types';
import { RuleError } from '../types';
import type { ActivatedAbility, CardHooks } from '../hooks';
import { registerChoice, registerHooks, fireHooks, hooksOf, HOOKS } from '../hooks';
import { def, OPPOSITE, cardName } from '../cards';
import { type Match, matches, attackingGroups } from '../abilities';
import { alignments, countControlled, power } from '../stats';
import { openArrows, structureCards, subtree } from '../geometry';
import { rollDie, roll2d6, shuffle } from '../rng';
import {
  activePlayer, announcedCancel, askChoice, attackCancelled, canAid, canEnterPlay, canOppose, controllerOf2, currentOutcome, destroyGroup,
  discardCard, drawPlot, giveToken, isCancelled, isPrivileged, liveEffects, log, moveSubtree, player, playResourceCard,
  protectedPlayer, tokenBarred,
} from '../game';
import { canExpose, exposeCards } from '../game';
import { resourceKinds } from './plots3';

// ---------------------------------------------------------------- helpers

/** Is this Resource an Artifact or a Gadget (as recorded in its uniqueness footer or notes)? */
const artifactOrGadget = (s: GameState, iid: string) =>
  def(s, iid).type === 'Resource' && resourceKinds(s, iid).some((k) => k === 'Artifact' || k === 'Gadget');

const ctrl = (s: GameState, self: string) => controllerOf2(s, self);
/** In play and face up (a Resource face down under Warehouse 23 does nothing). */
const active = (s: GameState, self: string) => s.cards[self]?.zone === 'resources' && !!s.cards[self].controller && !s.cards[self].hiddenUnder;
const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';
const isGroup = (s: GameState, iid?: string) => !!iid && def(s, iid).type === 'Group';
const own = (s: GameState, pl: string, iid?: string) => inPlay(s, iid) && s.cards[iid!].controller === pl;
const is = (s: GameState, iid: string | undefined, m: Match) => !!iid && matches(s, iid, m);
const place = (s: GameState, iid?: string) => !!iid && def(s, iid).subtype === 'Place';
const personality = (s: GameState, iid?: string) => !!iid && def(s, iid).subtype === 'Personality';
const coastalPlace = (s: GameState, iid?: string) => place(s, iid) && is(s, iid, { attributes: ['Coastal'] });
const data = (s: GameState, self: string) => (s.cards[self].data ??= {});

/** The Group this Resource is linked to (undefined while it is linked to the Illuminati, i.e. unlinked). */
function linkedGroup(s: GameState, self: string): string | undefined {
  const l = s.cards[self].linkedTo;
  return l && inPlay(s, l) && isGroup(s, l) && s.cards[l].controller === s.cards[self].controller ? l : undefined;
}
const unlinked = (s: GameState, self: string) => active(s, self) && !linkedGroup(s, self);
/** The controller's Illuminati, when `iid` is it. */
const isOwnIlluminati = (s: GameState, self: string, iid: string) => {
  const pl = ctrl(s, self);
  return !!pl && active(s, self) && player(s, pl).illuminati === iid;
};
/** The Group or Illuminati this Resource is attached to (its Illuminati when unlinked). */
function attachedTo(s: GameState, self: string): string | undefined {
  const l = s.cards[self].linkedTo;
  return active(s, self) && l && inPlay(s, l) && s.cards[l].controller === s.cards[self].controller ? l : undefined;
}
/** Only the first copy (by instance id) of `cardIds` attached to `iid` counts (one per Group / largest multiplier). */
function firstAttached(s: GameState, iid: string, cardIds: string[], ok: (r: string) => boolean): string | undefined {
  return Object.values(s.cards)
    .filter((c) => c.zone === 'resources' && c.linkedTo === iid && cardIds.includes(c.cardId) && ok(c.iid))
    .map((c) => c.iid).sort()[0];
}

/** Groups acting in an attack: the leader, those aiding and those opposing. */
const actingGroups = (ctx: AttackCtx) => [...attackingGroups(ctx), ...ctx.oppose.map((o) => o.iid)].filter((x): x is string => !!x);

/** The dice as rolled (after re-rolls, before +/- modifiers). */
function naturalRoll(ctx: AttackCtx): number {
  let dice = ctx.roll;
  for (const e of liveEffects(ctx)) if (e.t === 'reroll') dice = e.dice;
  return dice ? dice[0] + dice[1] : 0;
}
const usedInAttack = (ctx: AttackCtx, self: string, abilityIds?: string[]) =>
  ctx.plays.some((p) => p.ability === self && (!abilityIds || abilityIds.some((a) => p.iid.startsWith(`ability:${self}:${a}:`))));

/** "Power is doubled": adds the base value once, unless a x2 (or larger) multiplier already applies (R047). */
function doubling(s: GameState, iid: string): number {
  const c = s.cards[iid];
  let base = def(s, iid).power ?? 0;
  for (const m of c.mods) if (m.kind === 'setPower' && m.value !== undefined) base = m.lower ? Math.min(base, m.value) : Math.max(base, m.value);
  const mul = Math.max(1, ...c.mods.filter((m) => m.kind === 'mulPower' && !m.defenseOnly).map((m) => m.value ?? 1));
  return mul >= 2 ? 0 : base * (2 - mul);
}
const DOUBLERS = ['cyborg-soldiers', 'necronomicon'];
const doublerOk = (s: GameState, r: string) => {
  const g = linkedGroup(s, r);
  return !!g && HOOKS[s.cards[r].cardId]!.linkTo!(s, r, g);
};

/** Move a Plot from the top of a deck into its owner's discard pile. */
function discardTopPlot(s: GameState, pl: string) {
  const p = player(s, pl);
  const top = p.plotDeck.shift();
  if (top) { s.cards[top].zone = 'hand'; p.hand.push(top); discardCard(s, top); }
}

/** Temporarily open the attack window so the engine's own aid/oppose rules can be reused after the roll. */
function asAttackWindow<T>(s: GameState, fn: () => T): T {
  const w = s.window;
  if (!w) return fn();
  const kind = w.kind;
  w.kind = 'attack';
  try { return fn(); } finally { w.kind = kind; }
}

/** An attack bonus from an activated ability (a Resource's action, not a Plot: it cannot be cancelled by Plot cancels). */
function bonus(s: GameState, pl: string, self: string, ctx: AttackCtx, amount: number, side: 'attack' | 'defense' = 'attack', forGroup?: string) {
  const entry: Contribution = { player: pl, amount, label: cardName(s, self), forGroup };
  (side === 'attack' ? ctx.attackBonus : ctx.defenseBonus).push(entry);
}

/** A live effect produced by a card on its own (not an activated ability), recorded like an ability use. */
function hookEffect(s: GameState, ctx: AttackCtx, self: string, pl: string, id: string, effect: PlotEffect) {
  ctx.plays.push({ iid: `ability:${self}:${id}:${s.version}:${ctx.plays.length}`, player: pl, play: { card: self }, effect, ability: self });
}

const isMedia = (s: GameState, g: string) => is(s, g, { attributes: ['Media'] });

/** A cancel that also answers a rival's matching Group announcing an action outside an attack (Bigfoot). */
function alsoAfterAnnouncedActions(ab: ActivatedAbility, ok: (s: GameState, g: string) => boolean): ActivatedAbility {
  const outside = announcedCancel(ok);
  const now = (s: GameState, ctx?: AttackCtx) => !ctx && s.window?.kind === 'event';
  return {
    ...ab, timing: [...ab.timing, 'event'], listens: outside.listens,
    check: (s, pl, self, p, ctx) => (now(s, ctx) ? outside.check(s, pl, self, p) : ab.check(s, pl, self, p, ctx)),
    apply: (s, pl, self, p, ctx) => (now(s, ctx) ? outside.apply(s, pl, self, p) : ab.apply(s, pl, self, p, ctx)),
  };
}

const needAttack = (ctx?: AttackCtx) => (!ctx ? 'Use this during an attack.' : null);

/** "Cancel the action of …": target a Group acting in the current attack. */
function cancelAction(label: string, what: string, ok: (s: GameState, g: string) => boolean, extra: Partial<ActivatedAbility> = {}): ActivatedAbility {
  return {
    id: 'cancel', label, timing: ['attack'], usesToken: true, needs: { target: 'actingGroup' }, ai: 'cancelAttacker', ...extra,
    check(s, _pl, _self, p, ctx) {
      if (!ctx || ctx.instant) return 'Use this against a Group acting in an attack.';
      if (!p.target || !actingGroups(ctx).includes(p.target) || !ok(s, p.target)) return `Choose ${what} that is taking an action in this attack.`;
      return null;
    },
    apply: (_s, _pl, _self, p): PlotEffect => ({ t: 'cancelGroup', group: p.target! }),
  };
}

// ---------------------------------------------------------------- Clipper Chip upkeep

function clipperCheck(s: GameState, self: string, gone?: string) {
  const pl = ctrl(s, self);
  if (!pl || !active(s, self)) return;
  const gov = structureCards(s, pl).some((g) => g !== gone && isGroup(s, g) && alignments(s, g).includes('Government'));
  if (!gov) {
    log(s, 'Clipper Chip is discarded: its controller has no Government Groups.', pl);
    discardCard(s, self);
  }
}

// ---------------------------------------------------------------- pending choices (Hitler's Brain, Soulburner)

interface SoulDebt { rival: string; kind: 'capture' | 'destroy' }
const debts = (s: GameState, self: string) => ((data(s, self).pending as SoulDebt[] | undefined) ?? []);

// ---------------------------------------------------------------- draw helpers (Crystal Skull, Shroud of Turin)

type DeckKind = 'plot' | 'group';
/**
 * A card that changes how a draw is made puts the card just drawn back on top of its deck and owes its
 * controller that draw. Owed draws are settled one at a time with a question, in order, so each one
 * sees the deck as the previous one left it.
 */
function oweDraw(s: GameState, self: string, pl: string, deck: DeckKind, card: string): boolean {
  const p0 = player(s, pl);
  if (!p0.hand.includes(card)) return false; // another card already took this draw over
  p0.hand = p0.hand.filter((i) => i !== card);
  s.cards[card].zone = deck === 'plot' ? 'plotDeck' : 'groupDeck';
  (deck === 'plot' ? p0.plotDeck : p0.groupDeck).unshift(card);
  const d = data(s, self);
  const owed = [...((d.owed as DeckKind[] | undefined) ?? []), deck];
  d.owed = owed;
  return owed.length === 1; // nothing is being asked yet: ask now
}
/** Settle one owed draw: take `iid` out of the deck into its owner's hand. */
function takeFromDeck(s: GameState, pl: string, deck: DeckKind, iid: string) {
  const p0 = player(s, pl);
  const pile = deck === 'plot' ? p0.plotDeck : p0.groupDeck;
  const i = pile.indexOf(iid);
  if (i >= 0) pile.splice(i, 1);
  s.cards[iid].zone = 'hand';
  p0.hand.push(iid);
}
/** One owed draw is settled; ask about the next one, if any. */
function nextOwed(s: GameState, self: string, pl: string, ask: (s: GameState, self: string, pl: string) => void) {
  const d = data(s, self);
  d.owed = ((d.owed as DeckKind[] | undefined) ?? []).slice(1);
  if ((d.owed as DeckKind[]).length) ask(s, self, pl);
}

function askSkull(s: GameState, self: string, pl: string) {
  const top = player(s, pl).plotDeck.slice(0, 3);
  if (top.length < 2) {
    // Nothing to choose from: the draw is made normally.
    if (top.length) takeFromDeck(s, pl, 'plot', top[0]);
    nextOwed(s, self, pl, askSkull);
    return;
  }
  askChoice(s, pl, {
    key: 'crystal-skull', source: self, min: 1, max: top.length,
    question: 'Crystal Skull: pick the Plot you draw from the top three of your deck. The others go back on top, unless you also mark them for the bottom.',
    options: [
      ...top.map((i) => ({ id: `take:${i}`, label: `Draw ${cardName(s, i)}` })),
      ...top.map((i) => ({ id: `bottom:${i}`, label: `Put ${cardName(s, i)} at the bottom` })),
    ],
  });
}
registerChoice('crystal-skull', {
  resolve(s, pl, picked, d) {
    const self = d.source as string;
    const takes = picked.filter((x) => x.startsWith('take:')).map((x) => x.slice(5));
    if (takes.length !== 1) throw new RuleError('Pick exactly one of the three Plots to draw.');
    const pile = player(s, pl).plotDeck;
    const top = pile.slice(0, 3);
    const keep = top.includes(takes[0]) ? takes[0] : top[0];
    if (keep) {
      const toBottom = picked.filter((x) => x.startsWith('bottom:')).map((x) => x.slice(7)).filter((i) => i !== keep && top.includes(i));
      pile.splice(0, top.length);
      pile.unshift(...top.filter((i) => i !== keep && !toBottom.includes(i)));
      pile.push(...toBottom);
      s.cards[keep].zone = 'hand';
      player(s, pl).hand.push(keep);
      log(s, `${player(s, pl).name} draws a Plot with the Crystal Skull${toBottom.length ? ` and puts ${toBottom.length} at the bottom of the deck` : ''}.`, pl);
    }
    nextOwed(s, self, pl, askSkull);
  },
  ai: (_s, _pl, options) => [options[0].id],
});

function askShroud(s: GameState, self: string, pl: string) {
  const deck = (data(s, self).owed as DeckKind[])[0];
  const pile = deck === 'plot' ? player(s, pl).plotDeck : player(s, pl).groupDeck;
  if (pile.length < 2) {
    if (pile.length) takeFromDeck(s, pl, deck, pile[0]);
    nextOwed(s, self, pl, askShroud);
    return;
  }
  askChoice(s, pl, {
    key: 'shroud-of-turin', source: self, min: 1, max: 1, data: { deck },
    question: `Shroud of Turin: the top card of your ${deck === 'plot' ? 'Plot' : 'Group'} deck is ${cardName(s, pile[0])}. Draw it, or leave it there and draw the bottom card without looking?`,
    options: [{ id: 'top', label: `Draw ${cardName(s, pile[0])}` }, { id: 'bottom', label: 'Draw the bottom card instead' }],
  });
}
registerChoice('shroud-of-turin', {
  resolve(s, pl, picked, d) {
    const self = d.source as string;
    const deck = d.deck as DeckKind;
    const pile = deck === 'plot' ? player(s, pl).plotDeck : player(s, pl).groupDeck;
    const card = picked[0] === 'bottom' ? pile[pile.length - 1] : pile[0];
    if (card) {
      takeFromDeck(s, pl, deck, card);
      if (picked[0] === 'bottom') log(s, `${player(s, pl).name} leaves the top card and draws from the bottom (Shroud of Turin).`, pl);
    }
    nextOwed(s, self, pl, askShroud);
  },
});

// ---------------------------------------------------------------- choices: Ark of the Covenant, Bigfoot, Immortality Serum

registerChoice('ark-of-the-covenant', {
  resolve(s, _pl, picked, d) {
    const g = picked[0];
    if (!inPlay(s, g)) return;
    log(s, `${cardName(s, g)} is lost to the Ark of the Covenant.`, d.by as string);
    destroyGroup(s, g, d.by as string);
  },
  // The computer gives up its weakest Group.
  ai: (s, _pl, options) => [[...options].sort((a, b) => (def(s, a.id).power ?? 0) - (def(s, b.id).power ?? 0))[0].id],
});

registerChoice('bigfoot', {
  resolve(s, pl, picked, d) {
    const self = d.source as string;
    const g = picked[0];
    const place = d.place as string;
    if (g === 'no' || !active(s, self) || ctrl(s, self) !== pl || s.cards[self].tokens < 1) return;
    s.cards[self].tokens--;
    const rest = (d.payers as string[]).filter((x) => x !== g && inPlay(s, x));
    const total = rest.reduce((n, x) => n + power(s, x), 0);
    const need = 3 * (def(s, place).power ?? 0);
    if (inPlay(s, place) && total < need) {
      s.cards[place].devastated = true;
      log(s, `Bigfoot cancels ${cardName(s, g)}'s action: the Relief falls short and ${cardName(s, place)} stays Devastated.`, pl);
    } else log(s, `Bigfoot cancels ${cardName(s, g)}'s action, but the other Groups still send enough Relief.`, pl);
  },
  ai: (_s, _pl, options) => [options[options.length > 1 ? 1 : 0].id],
});

function offerSerum(s: GameState, self: string, target: string, from: string | undefined) {
  const pl = ctrl(s, self);
  if (!pl || !unlinked(s, self) || !from || from === pl || !inPlay(s, target) || !personality(s, target) || protectedPlayer(s, pl, from)) return;
  const spots = structureCards(s, pl).flatMap((m) => openArrows(s, m).map((side) => ({
    id: `${m}|${side}`, label: `Take ${cardName(s, target)}, placed on ${cardName(s, m)} (${side.toLowerCase()} arrow)`,
  })));
  if (!spots.length) return;
  askChoice(s, pl, {
    key: 'immortality-serum', source: self, min: 1, max: 1, data: { target },
    question: `Immortality Serum: a rival has just played ${cardName(s, target)}. Take control of it with no roll, and let the Serum serve it?`,
    options: [{ id: 'no', label: 'Keep the Serum for later' }, ...spots],
  });
}
registerChoice('immortality-serum', {
  resolve(s, pl, picked, d) {
    if (picked[0] === 'no') return;
    const self = d.source as string;
    const t = d.target as string;
    const [m, side] = picked[0].split('|') as [string, Side];
    if (!inPlay(s, t) || !personality(s, t) || !unlinked(s, self) || ctrl(s, self) !== pl || !own(s, pl, m) || !openArrows(s, m).includes(side)) {
      log(s, 'The Immortality Serum can no longer be used on that Personality.', pl);
      return;
    }
    const from = s.cards[t].controller;
    moveSubtree(s, t, pl, m, side, 'hand');
    for (const g of subtree(s, t)) { s.cards[g].tokens = 0; s.cards[g].capturedTurn = s.turn; }
    for (const r of Object.values(s.cards)) if (r.zone === 'resources' && r.linkedTo === t) r.controller = pl;
    s.cards[self].linkedTo = t;
    log(s, `${player(s, pl).name} uses the Immortality Serum to take control of ${cardName(s, t)}; the Serum now serves it.`, pl);
    hooksOf(s, t)?.onEnterPlay?.(s, t);
    fireHooks(s, (h, c) => h.onCapture?.(s, c, t, pl, from));
  },
  // The computer always takes the Personality.
  ai: (_s, _pl, options) => [options[options.length > 1 ? 1 : 0].id],
});

// ---------------------------------------------------------------- the cards

/** Eliza gives `iid` (the Group or Illuminati it is attached to) an extra action: a Computer Group or the Network, one Eliza each. */
function elizaBoosts(s: GameState, self: string, iid: string): boolean {
  const ok = def(s, iid).type === 'Illuminati' ? s.cards[iid].cardId === 'the-network' : is(s, iid, { attributes: ['Computer'] });
  return ok && firstAttached(s, iid, ['eliza'], () => true) === self;
}

const hallucinationCancel =cancelAction('Cancel a Personality\'s action', 'a Personality', (s, g) => personality(s, g));


const T: Record<string, CardHooks> = {
  // Automatic: once everyone has passed after the roll, a qualifying result is re-rolled (once per
  // attack) and the roll window opens again so players can respond to the new roll.
  'angel-s-feather': {
    linkTo: (s, _self, g) => alignments(s, g).includes('Peaceful'),
    beforeAttackResult(s, self, ctx) {
      const pl = ctrl(s, self);
      if (!pl || !active(s, self) || !ctx.roll || usedInAttack(ctx, self) || attackCancelled(ctx)) return false;
      const g = linkedGroup(s, self);
      const out = currentOutcome(s, ctx);
      const ownFailed = ctx.type === 'control' && !ctx.instant && !!g && ctx.attacker === g && alignments(s, g).includes('Peaceful') && out === 'failure';
      const hitMine = ctx.targetPlayer === pl && own(s, pl, ctx.target) && alignments(s, ctx.target).includes('Peaceful') && out === 'success';
      if (!ownFailed && !hitMine) return false;
      const dice = roll2d6(s);
      log(s, `Angel's Feather: the attack is rolled again — ${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}, and this roll counts.`, pl);
      hookEffect(s, ctx, self, pl, 'reroll', { t: 'reroll', dice });
      return true;
    },
  },

  // The note is kept on the card (secret in the UI).
  'ark-of-the-covenant': {
    actions: [{
      id: 'name', label: 'Secretly name one of your Groups', timing: ['main'], usesToken: false, secret: true, needs: { target: 'ownGroup' }, ai: 'never',
      check: (s, pl, _self, p) => (own(s, pl, p.target) && isGroup(s, p.target) ? null : 'Name a Group in your Power Structure.'),
      apply(s, _pl, self, p) { s.cards[self].note = p.target; },
    }],
    onDestroy(s, self, victim, by) {
      const pl = ctrl(s, self);
      if (!pl || !active(s, self) || s.cards[self].note !== victim || s.cards[victim].controller !== pl) return;
      s.cards[self].note = undefined;
      log(s, `The Ark of the Covenant is revealed: it protected ${cardName(s, victim)}.`, pl);
      const ctx = s.attack;
      // The Group that made the attack strikes back on itself. Instant attacks (Disasters, Assassinations),
      // attacks made by cards and Plots that destroy directly are directed by the Illuminati (the rules
      // say so of Plots), so they count as destroyed by the Illuminati of the player behind them.
      const group = ctx && !ctx.instant && ctx.target === victim && ctx.attacker && def(s, ctx.attacker).type === 'Group' ? ctx.attacker : undefined;
      if (group) {
        if (!inPlay(s, group)) return;
        log(s, `${cardName(s, group)} is destroyed by the Ark.`, pl);
        destroyGroup(s, group, pl);
        return;
      }
      const rival = by;
      if (!rival || rival === pl || !s.players.some((p) => p.id === rival && !p.eliminated)) return;
      // The Illuminati's owner chooses which of his Groups is lost.
      const options = structureCards(s, rival).filter((g) => isGroup(s, g)).map((g) => ({ id: g, label: cardName(s, g) }));
      if (options.length) {
        askChoice(s, rival, {
          key: 'ark-of-the-covenant', source: self, min: 1, max: 1, options, data: { by: pl },
          question: `The Ark of the Covenant protected ${cardName(s, victim)}: your Illuminati destroyed it, so choose one of your Groups to lose.`,
        });
      }
    },
  },

  'bigfoot': {
    hasAction: true,
    // Media actions in an attack are cancelled with the ability. Outside attacks, a rival's Media Group
    // announcing an action (a move, an ability, Relief) opens a response window where Bigfoot may cancel
    // it. Buying Plots is not an action and cannot be cancelled (R027). Relief sent while another window
    // is open is not announced: Bigfoot is offered to cancel it when it happens (the 'relief' event).
    actions: [alsoAfterAnnouncedActions(cancelAction('Cancel a Media Group\'s action', 'a Media Group', isMedia), isMedia)],
    onEvent(s, self, e) {
      const pl = ctrl(s, self);
      if (e.type !== 'relief' || e.data?.announced || !pl || !active(s, self) || s.cards[self].tokens < 1 || !e.player || e.player === pl || !e.card) return;
      if (protectedPlayer(s, pl, e.player)) return;
      const media = (e.cards ?? []).filter((g) => is(s, g, { attributes: ['Media'] }));
      if (!media.length) return;
      askChoice(s, pl, {
        key: 'bigfoot', source: self, min: 1, max: 1, data: { place: e.card, payers: e.cards },
        question: `Bigfoot: a Media Group helps send Relief to ${cardName(s, e.card)}. Spend Bigfoot's action to cancel it?`,
        options: [{ id: 'no', label: 'Let the Relief through' }, ...media.map((g) => ({ id: g, label: `Cancel ${cardName(s, g)}'s action` }))],
      });
    },
    attackMod: (s, self, ctx, side) =>
      side === 'attack' && active(s, self) && ctx.type === 'control' && !ctx.instant && ctx.attackerPlayer === ctrl(s, self) && is(s, ctx.target, { attributes: ['Green'] }) ? 3 : 0,
  },

  'book-of-kells': {
    linkTo: (s, _self, g) => is(s, g, { attributes: ['Magic'] }),
    powerMod: (s, self, iid) => (unlinked(s, self) && isOwnIlluminati(s, self, iid) ? 1 : 0),
    globalMod: (s, self, iid) => (unlinked(s, self) && isOwnIlluminati(s, self, iid) ? 1 : 0),
    extraTokens: (s, self, iid) => (linkedGroup(s, self) === iid && is(s, iid, { attributes: ['Magic'] }) ? 1 : 0),
    // Neither of the linked Magic Group's actions may be an Attack to Destroy.
    forbidAttack: (s, self, attacker, _target, type) =>
      type === 'destroy' && !!attacker && linkedGroup(s, self) === attacker && is(s, attacker, { attributes: ['Magic'] })
        ? `${cardName(s, attacker)} acts twice a turn thanks to the Book of Kells, so it may not attack to destroy.` : null,
  },

  'center-for-weird-studies': {
    actions: [{
      id: 'refresh', label: 'Discard a Plot: give a spent Group or Resource a new Action token', timing: ['anytime'], usesToken: false, oncePerTurn: true,
      needs: { target: 'group' }, ai: 'never',
      check(s, pl, _self, p) {
        if (activePlayer(s).id !== pl) return 'Only during your own turn.';
        const hand = player(s, pl).hand;
        const plot = p.payWith?.[0] ?? hand.find((i) => def(s, i).type === 'Plot');
        if (!plot || !hand.includes(plot) || def(s, plot).type !== 'Plot') return 'Discard a Plot card from your hand.';
        const t = p.target ? s.cards[p.target] : undefined;
        if (!t || t.controller !== pl) return 'Choose one of your Groups or Resources.';
        if (t.tokens > 0) return 'It still has its Action token.';
        if (t.zone === 'structure') {
          if (t.capturedTurn === s.turn || tokenBarred(s, t.iid)) return 'That Group cannot receive a token now.';
        } else if (t.zone !== 'resources' || !HOOKS[t.cardId]?.hasAction) return 'That Resource has no action of its own.';
        return null;
      },
      apply(s, pl, _self, p) {
        const plot = p.payWith?.[0] ?? player(s, pl).hand.find((i) => def(s, i).type === 'Plot')!;
        discardCard(s, plot);
        const t = s.cards[p.target!];
        if (t.zone === 'structure') giveToken(s, t.iid); else t.tokens = 1;
      },
    }],
  },

  'clipper-chip': {
    powerMod: (s, self, iid) => {
      const pl = ctrl(s, self);
      return pl && active(s, self) && own(s, pl, iid) && isGroup(s, iid) && alignments(s, iid).includes('Government') ? 2 : 0;
    },
    immune: (s, self, target, source) => {
      const pl = ctrl(s, self);
      return !!pl && active(s, self) && s.cards[source]?.cardId === 'phone-phreaks' && (s.cards[target]?.controller === pl);
    },
    onEnterPlay: (s, self) => clipperCheck(s, self),
    onTurnStart: (s, self) => clipperCheck(s, self),
    onAttackEnd: (s, self) => clipperCheck(s, self),
    onCapture: (s, self) => clipperCheck(s, self),
    onDestroy: (s, self, victim) => clipperCheck(s, self, victim),
  },

  // Every Plot its controller draws: he picks one of the top three; each of the other two goes back on
  // top or to the bottom (his choice, card by card) before the next draw.
  'crystal-skull': {
    onDraw(s, self, pl, deck, card) {
      if (deck !== 'plot' || ctrl(s, self) !== pl || !active(s, self)) return;
      if (oweDraw(s, self, pl, 'plot', card)) askSkull(s, self, pl);
    },
  },

  'cyborg-soldiers': {
    linkTo: (s, _self, g) => alignments(s, g).includes('Violent'),
    // Lost with the linked Group: the engine destroys linked Resources with their Group (R041).
    powerMod: (s, self, iid) => (linkedGroup(s, self) === iid && firstAttached(s, iid, DOUBLERS, (r) => doublerOk(s, r)) === self ? doubling(s, iid) : 0),
  },

  'death-mask': {
    linkTo: (s, _self, g) => is(s, g, { attributes: ['Magic'] }),
    actions: [{
      id: 'join', label: 'Linked Magic Group joins the attack after the roll', timing: ['roll'], usesToken: false, needs: { modes: ['aid', 'oppose'] }, ai: 'boostAttack',
      check(s, pl, self, p, ctx) {
        if (!ctx?.roll || ctx.instant) return 'Use this right after the dice are rolled in an attack.';
        const g = linkedGroup(s, self);
        if (!g || !is(s, g, { attributes: ['Magic'] })) return 'Death Mask must be linked to a Magic Group.';
        const r = asAttackWindow(s, () => (p.mode === 'oppose' ? canOppose(s, pl, g) : canAid(s, pl, g)));
        return r.ok ? null : `${cardName(s, g)} could not normally join this attack: ${r.why ?? 'not allowed'}.`;
      },
      apply(s, pl, self, p, ctx) {
        const g = linkedGroup(s, self)!;
        const r = asAttackWindow(s, () => (p.mode === 'oppose' ? canOppose(s, pl, g) : canAid(s, pl, g)));
        s.cards[g].tokens--;
        const c = { player: pl, iid: g, amount: 0, label: cardName(s, g), useGlobal: r.global, selfDefense: 'self' in r && r.self === true };
        (p.mode === 'oppose' ? ctx!.oppose : ctx!.aid).push(c as Contribution);
      },
    }],
  },

  'earthquake-projector': {
    hasAction: true,
    actions: [{
      id: 'boost', label: '+2 to an Attack to Destroy a Place or a Disaster', timing: ['attack'], usesToken: true, oncePerTurn: true, ai: 'boostAttack',
      check: (s, _pl, _self, _p, ctx) => needAttack(ctx) ?? (ctx!.type === 'destroy' && (place(s, ctx!.target) || !!ctx!.disaster) ? null : 'Only an Attack to Destroy a Place, or a Disaster.'),
      apply(s, pl, self, _p, ctx) { bonus(s, pl, self, ctx!, 2); },
    }],
  },

  // Max one per Group (errata): only the first Eliza on a Group gives the extra action.
  'eliza': {
    linkTo: (s, self, g) => is(s, g, { attributes: ['Computer'] }) && !Object.values(s.cards).some((c) => c.iid !== self && c.cardId === 'eliza' && c.zone === 'resources' && c.linkedTo === g),
    extraTokens: (s, self, iid) => (attachedTo(s, self) === iid && elizaBoosts(s, self, iid) ? 1 : 0),
    // The extra action is the last one the Group takes in a turn in which Eliza gave it a token: at the
    // start of the turn Eliza notes whether it gives one; Eliza crashes when the Group leads an attack
    // with its last token that turn and rolls 11 or 12.
    onTurnStart(s, self) {
      const at = attachedTo(s, self);
      const gives = !!at && elizaBoosts(s, self, at) && !tokenBarred(s, at) && s.cards[at].capturedTurn !== s.turn;
      data(s, self).extra = gives ? { turn: s.turn, group: at } : undefined;
    },
    onAttackEnd(s, self, ctx) {
      const at = attachedTo(s, self);
      const extra = data(s, self).extra as { turn: number; group: string } | undefined;
      if (!at || !extra || extra.turn !== s.turn || extra.group !== at) return;
      if (ctx.attacker !== at || naturalRoll(ctx) < 11 || s.cards[at].tokens > 0) return;
      const pl = ctrl(s, self)!;
      log(s, 'Eliza crashes! It is discarded and all hidden Plots of its controller are revealed.', pl);
      exposeCards(s, player(s, pl).hand.filter((i) => def(s, i).type === 'Plot'));
      discardCard(s, self);
    },
  },

  'flying-saucer': {
    linkTo: (s, _self, g) => personality(s, g),
    // Captured/destroyed with the Personality: the engine moves/destroys linked Resources (R041).
    attackMod: (s, self, ctx, side) => {
      const g = linkedGroup(s, self);
      return side === 'defense' && g && ctx.target === g && personality(s, g) && ctx.type === 'destroy' ? 10 : 0;
    },
    actions: [{
      id: 'takeover', label: 'Extra Resource takeover (discard the top Plot of your deck)', timing: ['main'], usesToken: false, oncePerTurn: true,
      needs: { target: 'resource' }, ai: 'never',
      check(s, pl, self, p) {
        if (!unlinked(s, self)) return 'Only while the Flying Saucer is unlinked.';
        const p0 = player(s, pl);
        if (!p.target || !p0.hand.includes(p.target) || def(s, p.target).type !== 'Resource') return 'Choose a Resource in your hand.';
        if (!canEnterPlay(s, p.target, pl)) return 'That Resource cannot come into play.';
        if (!p0.plotDeck.length) return 'Your Plot deck is empty.';
        return null;
      },
      apply(s, pl, _self, p) { discardTopPlot(s, pl); playResourceCard(s, p.target!, pl); },
    }],
  },

  'hallucinations': {
    hasAction: true,
    actions: [
      {
        ...hallucinationCancel,
        oncePerTurn: true,
        check: (s, pl, self, p, ctx) => (s.cards[self].abilityTurns?.boost === s.turn ? 'Already used this turn.' : hallucinationCancel.check(s, pl, self, p, ctx)),
      },
      {
        id: 'boost', label: '+3 to an attempt to destroy a Personality', timing: ['attack'], usesToken: true, oncePerTurn: true, ai: 'boostAttack',
        check(s, _pl, self, _p, ctx) {
          if (s.cards[self].abilityTurns?.cancel === s.turn) return 'Already used this turn.';
          return needAttack(ctx) ?? (ctx!.type === 'destroy' && personality(s, ctx!.target) ? null : 'Only an attempt to destroy a Personality.');
        },
        apply(s, pl, self, _p, ctx) { bonus(s, pl, self, ctx!, 3); },
      },
    ],
  },

  'hammer-of-thor': {
    hasAction: true,
    actions: [{
      id: 'boost', label: '+2 Power to a Government or Violent Group', timing: ['attack'], usesToken: true, oncePerTurn: true, needs: { target: 'group' }, ai: 'boostAttack',
      check(s, _pl, _self, p, ctx) {
        if (!ctx) return 'Use this during an attack.';
        if (!p.target || !isGroup(s, p.target) || !alignments(s, p.target).some((a) => a === 'Government' || a === 'Violent')) return 'Choose a Government or Violent Group.';
        if (p.target === ctx.attacker) return null;
        if (p.target === ctx.target && ctx.type === 'destroy') return null;
        return 'Only for the Group making the attack, or the Group defending against an Attack to Destroy.';
      },
      apply(s, pl, self, p, ctx) { bonus(s, pl, self, ctx!, 2, p.target === ctx!.attacker ? 'attack' : 'defense', p.target); },
    }],
  },

  // Every Disaster card can target it (it lacks the Huge and Coastal attributes). All defenses treat it
  // as a Power 10 Place; it never becomes Devastated; after its destruction anyone may play another copy.
  'hidden-city': {
    replaceableWhenDestroyed: true,
    disasterTargetPower: 10,
    powerMod: (s, self, iid) => (isOwnIlluminati(s, self, iid) ? 2 : 0),
    globalMod: (s, self, iid) => (isOwnIlluminati(s, self, iid) ? 2 : 0),
  },

  // The choice after each destruction is banked and spent with one of the two free abilities.
  'hitler-s-brain': {
    onDestroy(s, self, _victim, by) {
      if (!active(s, self) || by !== ctrl(s, self)) return;
      data(s, self).pending = ((data(s, self).pending as number | undefined) ?? 0) + 1;
    },
    actions: [
      {
        id: 'draw', label: 'Draw a Plot (for a Group you destroyed)', timing: ['anytime', 'roll'], usesToken: false, ai: 'draw',
        check: (s, _pl, self) => ((data(s, self).pending as number | undefined) ? null : 'Only after you destroy a Group.'),
        apply(s, pl, self) { data(s, self).pending = (data(s, self).pending as number) - 1; drawPlot(s, player(s, pl)); },
      },
      {
        id: 'hide', label: 'Hide all your exposed Plots (for a Group you destroyed)', timing: ['anytime', 'roll'], usesToken: false, ai: 'never',
        check: (s, _pl, self) => ((data(s, self).pending as number | undefined) ? null : 'Only after you destroy a Group.'),
        apply(s, pl, self) {
          data(s, self).pending = (data(s, self).pending as number) - 1;
          for (const i of player(s, pl).hand) s.cards[i].exposed = false;
        },
      },
    ],
    // Its controller may not take control of Peaceful Groups: no Attack to Control, no automatic takeover.
    forbidAttack: (s, self, _attacker, target, type, attackerPlayer) =>
      type !== 'destroy' && active(s, self) && attackerPlayer === ctrl(s, self) && alignments(s, target).includes('Peaceful')
        ? `While you hold Hitler's Brain you cannot take control of a Peaceful Group such as ${cardName(s, target)}.` : null,
  },

  'immortality-serum': {
    // Linking it to a Personality you control is its one use: it may not move once it serves one.
    linkTo: (s, self, g) => personality(s, g) && !linkedGroup(s, self),
    preventDestroy: (s, self, target) => {
      const g = s.cards[self].linkedTo;
      return active(s, self) && target === g && personality(s, g);
    },
    attackMod: (s, self, ctx, side) => {
      const g = s.cards[self].linkedTo;
      return side === 'defense' && active(s, self) && ctx.type === 'destroy' && !ctx.instant && ctx.target === g && personality(s, g) ? 5 : 0;
    },
    // A Personality a rival has just played (automatic takeover, or a successful Attack to Control on it
    // from his hand): the Serum's controller is asked whether to take it, choosing where it goes.
    onEvent(s, self, e) {
      if (e.type === 'takeover' && e.card) offerSerum(s, self, e.card, e.player);
    },
    onCapture(s, self, victim, by, from) {
      if (from === undefined && by !== ctrl(s, self)) offerSerum(s, self, victim, by);
    },
    // Your own Personality played from hand: the ability takes it with no roll during your attack.
    actions: [{
      id: 'seize', label: 'Take control of the Personality with no die roll', timing: ['attack'], usesToken: false, ai: 'boostAttack',
      check(s, pl, self, _p, ctx) {
        if (!ctx || ctx.type !== 'control' || !ctx.fromHand || ctx.attackerPlayer !== pl || !personality(s, ctx.target)) return 'Only when you attack to control a Personality played from your hand.';
        if (!unlinked(s, self)) return 'The Serum already serves a Personality.';
        return null;
      },
      apply(s, pl, self, _p, ctx): PlotEffect {
        data(s, self).seize = ctx!.target;
        bonus(s, pl, self, ctx!, 100);
        return { t: 'set', value: 2 };
      },
    }],
    onAttackEnd(s, self, ctx) {
      const d = data(s, self);
      if (d.seize !== ctx.target) return;
      d.seize = undefined;
      if (ctx.result === 'success' && inPlay(s, ctx.target) && s.cards[ctx.target].controller === ctrl(s, self)) s.cards[self].linkedTo = ctx.target;
    },
  },

  'loch-ness-monster': {
    hasAction: true,
    actions: [
      cancelAction('Cancel a Coastal Place\'s action', 'a Coastal Place', (s, g) => coastalPlace(s, g)),
      {
        id: 'boost', label: '+4 to destroy a Coastal Place (or to a Disaster against one)', timing: ['attack'], usesToken: true, ai: 'boostAttack',
        check: (s, _pl, _self, _p, ctx) => needAttack(ctx) ?? (ctx!.type === 'destroy' && coastalPlace(s, ctx!.target) ? null : 'Only an attempt to destroy a Coastal Place.'),
        apply(s, pl, self, _p, ctx) { bonus(s, pl, self, ctx!, 4); },
      },
    ],
  },

  'mercenaries': {
    hasAction: true,
    actions: [{
      id: 'boost', label: '+4 to an Attack to Destroy or +1 to an Attack to Control', timing: ['attack'], usesToken: true, oncePerTurn: true, ai: 'boostAttack',
      check: (_s, _pl, _self, _p, ctx) => needAttack(ctx),
      apply(s, pl, self, _p, ctx) { bonus(s, pl, self, ctx!, ctx!.type === 'destroy' ? 4 : 1); },
    }],
  },

  'midas-mill': {
    linkTo: (s, _self, g) => is(s, g, { attributes: ['Coastal'] }),
    powerMod: (s, self, iid) => (unlinked(s, self) && isOwnIlluminati(s, self, iid) ? 2 : 0),
    // Global Power is capped at Power (R029), so a large bonus makes it equal to its Power.
    globalMod: (s, self, iid) => {
      if (unlinked(s, self) && isOwnIlluminati(s, self, iid)) return 2;
      return linkedGroup(s, self) === iid && is(s, iid, { attributes: ['Coastal'] }) ? 1000 : 0;
    },
  },

  'necronomicon': {
    linkTo: (s, _self, g) => alignments(s, g).includes('Violent') || is(s, g, { attributes: ['Magic'] }),
    powerMod: (s, self, iid) => (linkedGroup(s, self) === iid && firstAttached(s, iid, DOUBLERS, (r) => doublerOk(s, r)) === self ? doubling(s, iid) : 0),
    onAttackEnd(s, self, ctx) {
      const g = linkedGroup(s, self);
      if (!g || ctx.attacker !== g || naturalRoll(ctx) < 11 || !inPlay(s, g)) return;
      const pl = ctrl(s, self)!;
      log(s, `${cardName(s, g)} rolled ${naturalRoll(ctx)} and is devoured by the Necronomicon!`, pl);
      s.cards[self].linkedTo = player(s, pl).illuminati; // unlinked, not destroyed
      destroyGroup(s, g, pl);
      if (s.cards[player(s, pl).illuminati].cardId !== 'servants-of-cthulhu') {
        player(s, pl).destroyedCredit = player(s, pl).destroyedCredit.filter((x) => x !== g);
      }
    },
  },

  'orbital-mind-control-lasers': {
    hasAction: true,
    actions: [{
      id: 'align', label: 'Add, remove or reverse an alignment until end of turn', timing: ['anytime', 'roll'], usesToken: true,
      needs: { target: 'group', modes: ['add', 'remove', 'reverse'], alignment: true }, ai: 'never',
      check(s, _pl, _self, p, ctx) {
        if (ctx && isPrivileged(ctx)) return 'Not during a Privileged attack.';
        if (!inPlay(s, p.target) || !isGroup(s, p.target)) return 'Choose a Group in play.';
        const al = p.alignment as Alignment | undefined;
        if (!al) return 'Choose an alignment.';
        const has = alignments(s, p.target!).includes(al);
        if (p.mode === 'add') return has ? 'It already has that alignment.' : null;
        if (p.mode === 'remove') return has ? null : 'It does not have that alignment.';
        if (p.mode === 'reverse') return has && OPPOSITE[al] ? null : 'Reverse an alignment the Group has and that has an opposite.';
        return 'Choose add, remove or reverse.';
      },
      apply(s, _pl, self, p) {
        const al = p.alignment as Alignment;
        const mods = s.cards[p.target!].mods;
        if (p.mode === 'add') mods.push({ source: self, kind: 'addAlign', align: al, until: 'endOfTurn' });
        else if (p.mode === 'remove') mods.push({ source: self, kind: 'removeAlign', align: al, until: 'endOfTurn' });
        else mods.push({ source: self, kind: 'addAlign', align: OPPOSITE[al]!, until: 'endOfTurn' }); // gaining the opposite drops it
      },
    }],
  },

  // Linked to a Group (or to the Illuminati while unlinked), which gets one more Action token.
  'perpetual-motion-machine': {
    extraTokens: (s, self, iid) => (attachedTo(s, self) === iid ? 1 : 0),
  },

  'principia-discordia': {
    resistanceMod: (s, self, iid) => {
      const pl = ctrl(s, self);
      if (!pl || !active(s, self) || !own(s, pl, iid) || !isGroup(s, iid) || !alignments(s, iid).includes('Weird')) return 0;
      return countControlled(s, pl, (g) => alignments(s, g).includes('Weird'));
    },
  },

  // "Any attempt" bonuses help only attacks made by one of your own Groups, never a rival's attack
  // that you aid (rulebook glossary), so the +5 and the one-shot +10 against a Place are for your own
  // attacks. The one-shot +10 may be added to any Disaster.
  'rogue-boomer': {
    attackMod: (s, self, ctx, side) =>
      side === 'attack' && active(s, self) && ctx.type === 'control' && !ctx.instant && ctx.attackerPlayer === ctrl(s, self) && is(s, ctx.target, { attributes: ['Nation'] }) ? 5 : 0,
    actions: [{
      id: 'strike', label: '+10 to destroy a Place or to a Disaster, then discard', timing: ['attack'], usesToken: false, ai: 'boostAttack',
      check: (s, pl, _self, _p, ctx) => needAttack(ctx) ?? (ctx!.type === 'destroy' && (!!ctx!.disaster || (place(s, ctx!.target) && ctx!.attackerPlayer === pl))
        ? null : 'Only one of your own attempts to destroy a Place, or a Disaster.'),
      apply(s, pl, self, _p, ctx) {
        bonus(s, pl, self, ctx!, 10);
        discardCard(s, self);
      },
    }],
  },

  // Every Plot or Group card its controller draws: he sees the top card and either draws it or leaves
  // it on top and draws the bottom card unseen. (With the Crystal Skull also in play, the card that
  // reacts first handles a Plot draw.)
  'shroud-of-turin': {
    onDraw(s, self, pl, deck, card) {
      if (ctrl(s, self) !== pl || !active(s, self)) return;
      if (oweDraw(s, self, pl, deck, card)) askShroud(s, self, pl);
    },
  },

  // The choice after each capture/destruction is banked and spent with one of the two free abilities.
  'soulburner': {
    onCapture(s, self, _victim, by, from) {
      const pl = ctrl(s, self);
      if (!pl || from !== pl || by === pl) return;
      data(s, self).pending = [...debts(s, self), { rival: by, kind: 'capture' }];
    },
    onDestroy(s, self, victim, by) {
      const pl = ctrl(s, self);
      if (!pl || !active(s, self) || s.cards[victim].controller !== pl || by === pl) return;
      data(s, self).pending = [...debts(s, self), { rival: by, kind: 'destroy' }];
    },
    actions: [
      {
        id: 'take', label: 'Take Plots from the rival\'s deck (1 for a capture, 2 for a destruction)', timing: ['anytime', 'roll'], usesToken: false, ai: 'draw',
        check: (s, _pl, self) => (debts(s, self).length ? null : 'Only after a rival captures or destroys one of your Groups.'),
        apply(s, pl, self) {
          const [debt, ...rest] = debts(s, self);
          data(s, self).pending = rest;
          const rival = player(s, debt.rival);
          for (let i = 0; i < (debt.kind === 'destroy' ? 2 : 1); i++) {
            const c = rival.plotDeck.shift();
            if (!c) break;
            s.cards[c].zone = 'hand';
            player(s, pl).hand.push(c);
          }
        },
      },
      {
        id: 'expose', label: 'Expose all the rival\'s Plots (and after a destruction, discard one of them)', timing: ['anytime', 'roll'], usesToken: false,
        needs: { target: 'plot' }, ai: 'never',
        check(s, _pl, self, p) {
          const debt = debts(s, self)[0];
          if (!debt) return 'Only after a rival captures or destroys one of your Groups.';
          if (debt.kind === 'destroy' && p.target && (!player(s, debt.rival).hand.includes(p.target) || !canExpose(s, p.target))) return 'Choose a Plot in that rival\'s hand that is not hidden beneath a card.';
          return null;
        },
        apply(s, _pl, self, p) {
          const [debt, ...rest] = debts(s, self);
          data(s, self).pending = rest;
          const rival = player(s, debt.rival);
          const shown = exposeCards(s, rival.hand.filter((i) => def(s, i).type === 'Plot'));
          if (debt.kind === 'destroy') {
            const victim = p.target ?? shown[0];
            if (victim && def(s, victim).type === 'Plot') discardCard(s, victim);
          }
        },
      },
    ],
  },

  // Once the Spear helps an attack, that attack is Magic for the rest of it, so defenses against Magic
  // apply: the attacking Groups (leader and helpers) count as Magic, and so does a Disaster, which has
  // no attacking Group (magicAttack).
  'spear-of-longinus': {
    magicAttack: (_s, self, ctx) => ctx.plays.some((p) => p.ability === self && !isCancelled(ctx.plays, p.iid)),
    attributeMod(s, self, iid, current) {
      const ctx = s.attack;
      if (!ctx || current.includes('Magic') || !active(s, self) || !attackingGroups(ctx).includes(iid)) return current;
      return ctx.plays.some((p) => p.ability === self && !isCancelled(ctx.plays, p.iid)) ? [...current, 'Magic'] : current;
    },
    actions: [{
      id: 'boost', label: '+1 to an Attack to Destroy or a Disaster', timing: ['attack'], usesToken: false, ai: 'boostAttack',
      check: (_s, _pl, self, _p, ctx) => needAttack(ctx) ?? (ctx!.type !== 'destroy' ? 'Only an Attack to Destroy or a Disaster.' : usedInAttack(ctx!, self) ? 'The Spear already helps this attack.' : null),
      apply(s, pl, self, _p, ctx) { bonus(s, pl, self, ctx!, 1); },
    }],
  },

  'suicide-squad': {
    actions: [{
      id: 'strike', label: 'Try to destroy a rival\'s Resource (roll one die)', timing: ['anytime', 'roll'], usesToken: false, needs: { target: 'resource' }, ai: 'never',
      check(s, pl, _self, p, ctx) {
        if (ctx && isPrivileged(ctx)) return 'Not during a Privileged attack.';
        const t = p.target ? s.cards[p.target] : undefined;
        if (!t || t.zone !== 'resources' || !t.controller || t.controller === pl) return 'Choose a Resource a rival controls.';
        if (protectedPlayer(s, pl, t.controller)) return 'That player has not finished a first turn yet.';
        return null;
      },
      apply(s, pl, self, p) {
        const die = rollDie(s);
        log(s, `Suicide Squad rolls ${die}.`, pl);
        // Every card it destroys is discarded (so a Unique one may be played again later).
        if (die <= 5) { log(s, `${cardName(s, p.target!)} is destroyed and discarded.`); discardCard(s, p.target!); }
        if (die >= 2) { log(s, `${cardName(s, self)} is destroyed and discarded.`); discardCard(s, self); }
      },
    }],
  },

  // The engine marks the card to be discarded at end of turn; the Bronze Head clears that mark.
  'the-bronze-head': {
    onAttackEnd(s, self, ctx) {
      if (!active(s, self) || !ctx.fromHand || ctx.result !== 'failure' || ctx.attackerPlayer !== ctrl(s, self)) return;
      if (s.cards[ctx.target].zone === 'hand') s.cards[ctx.target].failedTakeoverTurn = undefined;
    },
  },

  // Its controller may interfere with Privileged attacks while the Frog God has its action; the action is
  // spent when the attack ends if he took part in it without being the attacker or the defender.
  'the-frog-god': {
    hasAction: true,
    mayInterfere: (s, self, pl) => ctrl(s, self) === pl && active(s, self) && s.cards[self].tokens > 0,
    onAttackEnd(s, self, ctx) {
      const pl = ctrl(s, self);
      if (!pl || !isPrivileged(ctx) || pl === ctx.attackerPlayer || pl === ctx.targetPlayer) return;
      const tookPart = [...ctx.aid, ...ctx.oppose].some((c) => c.player === pl) || ctx.plays.some((p) => p.player === pl);
      if (tookPart && s.cards[self].tokens > 0) s.cards[self].tokens--;
    },
  },

  'the-holy-grail': {
    actions: [{
      id: 'name', label: 'Secretly name a Place (cannot be changed)', timing: ['main'], usesToken: false, secret: true, needs: { target: 'place' }, ai: 'never',
      check: (s, _pl, self, p) => (s.cards[self].note ? 'The Grail already protects a Place.' : inPlay(s, p.target) && place(s, p.target) ? null : 'Name a Place in play.'),
      apply(s, _pl, self, p) { s.cards[self].note = p.target; },
    }],
    preventDestroy: (s, self, target) => active(s, self) && s.cards[self].note === target,
    // Only when an attack would really destroy or Devastate the Place (everyone has passed after the
    // roll and it succeeds) is the note revealed and the attack made to fail.
    beforeAttackResult(s, self, ctx) {
      const pl = ctrl(s, self);
      if (!pl || !active(s, self) || s.cards[self].note !== ctx.target || ctx.type !== 'destroy' || currentOutcome(s, ctx) !== 'success') return false;
      data(s, self).revealed = true;
      log(s, `The Holy Grail is revealed: it protects ${cardName(s, ctx.target)}, so the attack fails.`, pl);
      hookEffect(s, ctx, self, pl, 'protect', { t: 'fail' });
      return false;
    },
    onCapture(s, self, victim) {
      if (!active(s, self) || s.cards[self].note !== victim) return;
      log(s, `${cardName(s, victim)} was captured: The Holy Grail is discarded.`);
      discardCard(s, self);
    },
  },

  'the-library-at-alexandria': {
    attackMod: (s, self, ctx, side) =>
      side === 'attack' && active(s, self) && ctx.type === 'control' && !ctx.instant && ctx.attackerPlayer === ctrl(s, self) && is(s, ctx.target, { attributes: ['Science', 'Magic', 'Computer'] }) ? 5 : 0,
  },

  // New Resources may be played face down under it (the usual once-per-turn Resource play, paid with an
  // Illuminati action). A face-down Resource does nothing and only its controller knows what it is
  // (`hiddenUnder`; the online view hides it from rivals, and rivals' cards cannot target it). Its
  // controller may turn one face up at any time, and may then use it at once; it stays face up. The
  // engine moves hidden cards with Warehouse 23 when it is captured, destroyed or discarded.
  'warehouse-23': {
    onEnterPlay(s, self) { data(s, self).enteredTurn = s.turn; },
    actions: [{
      id: 'hide', label: 'Play a Resource face down under Warehouse 23', timing: ['main'], usesToken: false, secret: true,
      needs: { target: 'handCard' }, ai: 'never',
      check(s, pl, self, p) {
        if (!active(s, self)) return 'Warehouse 23 must be face up in play.';
        const t = p.target;
        if (!t || !player(s, pl).hand.includes(t) || def(s, t).type !== 'Resource') return 'Choose a Resource card in your hand.';
        if (s.turnFlags.resourcePlayed) return 'You can only play one Resource this way per turn.';
        if (!canEnterPlay(s, t, pl)) return 'That Resource is Unique and already in play or destroyed.';
        if (s.cards[player(s, pl).illuminati].tokens < 1) return 'Your Illuminati needs an Action token.';
        return null;
      },
      apply(s, pl, self, p) {
        s.cards[player(s, pl).illuminati].tokens--;
        s.turnFlags.resourcePlayed = true;
        playResourceCard(s, p.target!, pl, { hiddenUnder: self });
      },
    }, {
      id: 'reveal', label: 'Turn a Resource in Warehouse 23 face up', timing: ['main', 'anytime', 'attack', 'roll'], usesToken: false,
      needs: { target: 'resource' }, ai: 'never',
      check(s, pl, self, p) {
        const t = p.target ? s.cards[p.target] : undefined;
        return t && t.hiddenUnder === self && t.controller === pl ? null : 'Choose a Resource face down under your Warehouse 23.';
      },
      apply(s, pl, self, p) {
        const t = p.target!;
        s.cards[t].hiddenUnder = undefined;
        log(s, `${player(s, pl).name} turns ${cardName(s, t)} face up from ${cardName(s, self)}.`, pl);
        hooksOf(s, t)?.onEnterPlay?.(s, t);
      },
    }, {
      id: 'fetch', label: 'Bring in an Artifact or Gadget from your hand or deck', timing: ['main'], usesToken: false, needs: { target: 'resource' }, ai: 'never',
      check(s, pl, self, p) {
        const d = data(s, self);
        if (d.enteredTurn !== s.turn || d.fetched) return 'Only when Warehouse 23 is first played.';
        const p0 = player(s, pl);
        const t = p.target;
        if (!t || !s.cards[t] || s.cards[t].owner !== pl || ![...p0.hand, ...p0.groupDeck, ...p0.plotDeck].includes(t)) return 'Choose a card from your hand or deck.';
        if (!artifactOrGadget(s, t)) return 'Choose an Artifact or Gadget Resource.';
        if (!canEnterPlay(s, t, pl)) return 'That Resource cannot come into play.';
        return null;
      },
      apply(s, pl, self, p) {
        const p0 = player(s, pl);
        const t = p.target!;
        data(s, self).fetched = true;
        for (const deck of [p0.groupDeck, p0.plotDeck]) {
          const i = deck.indexOf(t);
          if (i >= 0) { deck.splice(i, 1); shuffle(s, deck); }
        }
        playResourceCard(s, t, pl);
      },
    }],
  },

  // Errata: +10 or -4 to Tornado, Hurricane, Rain of Frogs; +4 or -2 to any other attack to destroy a
  // non-Space Place. Two Action tokens, never both in the same attack.
  'weather-satellite': {
    hasAction: true,
    onTurnStart(s, self) { if (active(s, self)) s.cards[self].tokens = 2; },
    actions: [
      {
        id: 'storm', label: 'Tornado, Hurricane or Rain of Frogs: +10 or -4', timing: ['attack'], usesToken: true, needs: { modes: ['up', 'down'] }, ai: 'boostAttack',
        check(s, _pl, self, _p, ctx) {
          if (!ctx) return 'Use this during an attack.';
          if (usedInAttack(ctx, self)) return 'The Satellite already acted in this attack.';
          return isStorm(s, ctx) ? null : 'Only a Tornado, Hurricane or Rain of Frogs.';
        },
        apply(s, pl, self, p, ctx) { bonus(s, pl, self, ctx!, p.mode === 'down' ? -4 : 10); },
      },
      {
        id: 'place', label: 'Other attack to destroy a non-Space Place: +4 or -2', timing: ['attack'], usesToken: true, needs: { modes: ['up', 'down'] }, ai: 'boostAttack',
        check(s, _pl, self, _p, ctx) {
          if (!ctx) return 'Use this during an attack.';
          if (usedInAttack(ctx, self)) return 'The Satellite already acted in this attack.';
          if (isStorm(s, ctx)) return 'Use the storm option for this Disaster.';
          return ctx.type === 'destroy' && place(s, ctx.target) && !is(s, ctx.target, { attributes: ['Space'] }) ? null : 'Only an attack to destroy a Place that is not a Space Place.';
        },
        apply(s, pl, self, p, ctx) { bonus(s, pl, self, ctx!, p.mode === 'down' ? -2 : 4); },
      },
    ],
  },

  'xanadu': {
    cancelAgents: (s, self) => active(s, self),
  },
};

function isStorm(s: GameState, ctx: AttackCtx) {
  return !!ctx.instantCard && !!ctx.disaster && ['tornado', 'hurricane', 'rain-of-frogs'].includes(s.cards[ctx.instantCard]?.cardId ?? '');
}

registerHooks(T);
