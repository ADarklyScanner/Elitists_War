// Encoded by the card-content pass. See docs/CARD_SCRIPTING.md.
// The 36 Resource cards. A Resource enters play linked to its controller's Illuminati ("unlinked");
// `linkTo` limits which Groups it may be linked to. Parts the engine cannot express yet are marked
// `// PENDING: …`.
import type { Alignment, AttackCtx, Contribution, GameState, PlotEffect } from '../types';
import type { ActivatedAbility, CardHooks } from '../hooks';
import { registerHooks, HOOKS } from '../hooks';
import { def, OPPOSITE, cardName } from '../cards';
import { type Match, matches, attackingGroups } from '../abilities';
import { alignments, countControlled } from '../stats';
import { structureCards } from '../geometry';
import { rollDie, roll2d6, shuffle } from '../rng';
import {
  activePlayer, canAid, canEnterPlay, canOppose, controllerOf2, currentOutcome, destroyGroup, discardCard,
  drawPlot, giveToken, isPrivileged, liveEffects, log, player, playResourceCard, protectedPlayer, tokenBarred,
} from '../game';

// ---------------------------------------------------------------- helpers

const ctrl = (s: GameState, self: string) => controllerOf2(s, self);
const active = (s: GameState, self: string) => s.cards[self]?.zone === 'resources' && !!s.cards[self].controller;
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
  for (const m of c.mods) if (m.kind === 'setPower' && m.value !== undefined) base = Math.max(base, m.value);
  const mul = Math.max(1, ...c.mods.filter((m) => m.kind === 'mulPower' && !m.defenseOnly).map((m) => m.value ?? 1));
  return mul >= 2 ? 0 : base * (2 - mul);
}
const DOUBLERS = ['cyborg-soldiers', 'necronomicon'];
const doublerOk = (s: GameState, r: string) => {
  const g = linkedGroup(s, r);
  return !!g && HOOKS[s.cards[r].cardId]!.linkTo!(s, r, g);
};

function destroyResource(s: GameState, iid: string) {
  log(s, `${cardName(s, iid)} is destroyed.`);
  Object.assign(s.cards[iid], { zone: 'destroyed', controller: undefined, linkedTo: undefined, tokens: 0 });
}

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

/** Crystal Skull / Shroud of Turin: remember the cards drawn at the start of this turn. */
function rememberDraws(s: GameState, self: string) {
  const pl = ctrl(s, self);
  if (!pl) return;
  const hand = player(s, pl).hand;
  const lastOf = (t: string) => [...hand].reverse().find((i) => def(s, i).type === t || (t === 'Group' && def(s, i).type === 'Resource'));
  Object.assign(data(s, self), { turn: s.turn, plot: lastOf('Plot'), group: lastOf('Group'), used: false });
}

// ---------------------------------------------------------------- the cards

const hallucinationCancel = cancelAction('Cancel a Personality\'s action', 'a Personality', (s, g) => personality(s, g));


const T: Record<string, CardHooks> = {
  // Re-rolls are offered as a free action in the roll window rather than happening on their own.
  // PENDING: an automatic "after the roll" trigger (the player must use the ability to get the re-roll).
  'angel-s-feather': {
    linkTo: (s, _self, g) => alignments(s, g).includes('Peaceful'),
    actions: [{
      id: 'reroll', label: 'Re-roll the dice', timing: ['roll'], usesToken: false, ai: 'boostDefense',
      check(s, pl, self, _p, ctx) {
        if (!ctx?.roll) return 'Use this right after the dice are rolled.';
        if (usedInAttack(ctx, self)) return 'Angel\'s Feather already re-rolled this attack.';
        const g = linkedGroup(s, self);
        const out = currentOutcome(s, ctx);
        if (ctx.type === 'control' && !ctx.instant && g && ctx.attacker === g && alignments(s, g).includes('Peaceful') && out === 'failure') return null;
        if (ctx.targetPlayer === pl && own(s, pl, ctx.target) && alignments(s, ctx.target).includes('Peaceful') && out === 'success') return null;
        return 'Only a failed Attack to Control by the linked Peaceful Group, or a successful attack on one of your Peaceful Groups.';
      },
      apply(s, pl) {
        const dice = roll2d6(s);
        log(s, `Angel's Feather: re-roll ${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}.`, pl);
        return { t: 'reroll', dice };
      },
    }],
  },

  // The note is kept on the card (secret in the UI).
  'ark-of-the-covenant': {
    actions: [{
      id: 'name', label: 'Secretly name one of your Groups', timing: ['main'], usesToken: false, needs: { target: 'ownGroup' }, ai: 'never',
      check: (s, pl, _self, p) => (own(s, pl, p.target) && isGroup(s, p.target) ? null : 'Name a Group in your Power Structure.'),
      apply(s, _pl, self, p) { s.cards[self].note = p.target; },
    }],
    onDestroy(s, self, victim) {
      const pl = ctrl(s, self);
      if (!pl || !active(s, self) || s.cards[self].note !== victim || s.cards[victim].controller !== pl) return;
      s.cards[self].note = undefined;
      log(s, `The Ark of the Covenant is revealed: it protected ${cardName(s, victim)}.`, pl);
      const ctx = s.attack;
      const destroyer = ctx && !ctx.instant ? ctx.attacker : undefined;
      // PENDING: Instant attacks (Disasters, Assassinations) have no destroying Group, so nothing happens.
      if (!destroyer || !inPlay(s, destroyer)) return;
      if (def(s, destroyer).type === 'Illuminati') {
        // PENDING: the rival should choose which Group to lose; the weakest one is taken instead.
        const rival = s.cards[destroyer].controller!;
        const lose = structureCards(s, rival).filter((g) => isGroup(s, g)).sort((a, b) => (def(s, a).power ?? 0) - (def(s, b).power ?? 0))[0];
        if (lose) { log(s, `${cardName(s, lose)} is lost to the Ark.`, pl); destroyGroup(s, lose, pl); }
      } else {
        log(s, `${cardName(s, destroyer)} is destroyed by the Ark.`, pl);
        destroyGroup(s, destroyer, pl);
      }
    },
  },

  'bigfoot': {
    hasAction: true,
    // PENDING: only Media actions inside an attack can be cancelled (other actions have no response window).
    actions: [cancelAction('Cancel a Media Group\'s action', 'a Media Group', (s, g) => is(s, g, { attributes: ['Media'] }))],
    attackMod: (s, self, ctx, side) =>
      side === 'attack' && active(s, self) && ctx.type === 'control' && !ctx.instant && ctx.attackerPlayer === ctrl(s, self) && is(s, ctx.target, { attributes: ['Green'] }) ? 3 : 0,
  },

  'book-of-kells': {
    linkTo: (s, _self, g) => is(s, g, { attributes: ['Magic'] }),
    powerMod: (s, self, iid) => (unlinked(s, self) && isOwnIlluminati(s, self, iid) ? 1 : 0),
    globalMod: (s, self, iid) => (unlinked(s, self) && isOwnIlluminati(s, self, iid) ? 1 : 0),
    // PENDING: neither of the Magic Group's two actions may be an Attack to Destroy (no hook to forbid an attack).
    extraTokens: (s, self, iid) => (linkedGroup(s, self) === iid && is(s, iid, { attributes: ['Magic'] }) ? 1 : 0),
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

  // PENDING: the engine has no "whenever you draw a Plot" hook. Encoded for the Plot drawn at the
  // start of your turn: put it back and take any one of the top three, the other two go on top or bottom.
  'crystal-skull': {
    onTurnStart: rememberDraws,
    actions: [{
      id: 'search', label: 'Look at the top three Plots and take one', timing: ['main'], usesToken: false, needs: { target: 'plot', modes: ['top', 'bottom'] }, ai: 'never',
      check(s, pl, self, p) {
        const d = data(s, self);
        const p0 = player(s, pl);
        if (d.turn !== s.turn || d.used || !d.plot || !p0.hand.includes(d.plot as string)) return 'Use this right after drawing your Plot at the start of your turn.';
        const pool = [d.plot as string, ...p0.plotDeck.slice(0, 2)];
        if (!p.target || !pool.includes(p.target)) return 'Choose one of the top three Plot cards.';
        return null;
      },
      apply(s, pl, self, p) {
        const d = data(s, self);
        const p0 = player(s, pl);
        const drawn = d.plot as string;
        p0.hand = p0.hand.filter((i) => i !== drawn);
        s.cards[drawn].zone = 'plotDeck';
        p0.plotDeck.unshift(drawn);
        const top3 = p0.plotDeck.splice(0, 3);
        const keep = p.target!;
        const rest = top3.filter((i) => i !== keep);
        if (p.mode === 'bottom') p0.plotDeck.push(...rest); else p0.plotDeck.unshift(...rest);
        s.cards[keep].zone = 'hand';
        p0.hand.push(keep);
        d.used = true;
      },
    }],
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
    extraTokens: (s, self, iid) => {
      const at = attachedTo(s, self);
      if (at !== iid) return 0;
      const ok = def(s, iid).type === 'Illuminati' ? s.cards[iid].cardId === 'the-network' : is(s, iid, { attributes: ['Computer'] });
      return ok && firstAttached(s, iid, ['eliza'], () => true) === self ? 1 : 0;
    },
    // PENDING: the engine does not track which action is the "extra" one. Approximation: Eliza crashes
    // when the linked Group leads an attack that rolls 11 or 12 while spending its last Action token.
    onAttackEnd(s, self, ctx) {
      const at = attachedTo(s, self);
      if (!at || ctx.attacker !== at || naturalRoll(ctx) < 11 || s.cards[at].tokens > 0) return;
      const pl = ctrl(s, self)!;
      log(s, 'Eliza crashes! It is discarded and all hidden Plots of its controller are revealed.', pl);
      for (const i of player(s, pl).hand) if (def(s, i).type === 'Plot') s.cards[i].exposed = true;
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

  // PENDING: Hidden City cannot be targeted by Disasters (the engine only attacks Groups), so it never
  // defends as a Power 10 Place; and a destroyed Hidden City still blocks a new one (canEnterPlay).
  'hidden-city': {
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
    // PENDING: no hook forbids declaring the attack; an Attack to Control on a Peaceful Group simply
    // cannot succeed. Automatic takeovers of Peaceful Groups are not blocked.
    attackMod: (s, self, ctx, side) =>
      side === 'attack' && active(s, self) && ctx.type === 'control' && ctx.attackerPlayer === ctrl(s, self) && alignments(s, ctx.target).includes('Peaceful') ? -100 : 0,
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
    // PENDING: taking a Personality just played from a RIVAL's hand is not possible (it would need to be
    // placed in your structure); only your own Attack to Control on a Personality from hand is covered.
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

  // The +5 applies to its controller's attempts (a passive card has no action to lend to a rival).
  'rogue-boomer': {
    attackMod: (s, self, ctx, side) =>
      side === 'attack' && active(s, self) && ctx.type === 'control' && !ctx.instant && ctx.attackerPlayer === ctrl(s, self) && is(s, ctx.target, { attributes: ['Nation'] }) ? 5 : 0,
    actions: [{
      id: 'strike', label: '+10 to destroy a Place or to a Disaster, then discard', timing: ['attack'], usesToken: false, ai: 'boostAttack',
      check: (s, _pl, _self, _p, ctx) => needAttack(ctx) ?? (ctx!.type === 'destroy' && (place(s, ctx!.target) || !!ctx!.disaster) ? null : 'Only an attempt to destroy a Place, or a Disaster.'),
      apply(s, pl, self, _p, ctx) {
        bonus(s, pl, self, ctx!, 10);
        discardCard(s, self);
      },
    }],
  },

  // PENDING: the engine has no draw hook. Encoded for the cards drawn at the start of your turn:
  // swap the Plot (or Group) you drew for the bottom card of that deck; the rejected card goes back on top.
  'shroud-of-turin': {
    onTurnStart: rememberDraws,
    actions: [{
      id: 'swap', label: 'Take the bottom card instead of the card you drew', timing: ['main'], usesToken: false, needs: { modes: ['plot', 'group'] }, ai: 'never',
      check(s, pl, self, p) {
        const d = data(s, self);
        const card = (p.mode === 'group' ? d.group : d.plot) as string | undefined;
        const p0 = player(s, pl);
        const deck = p.mode === 'group' ? p0.groupDeck : p0.plotDeck;
        if (d.turn !== s.turn || d.used || !card || !p0.hand.includes(card)) return 'Use this right after your draw at the start of your turn.';
        return deck.length ? null : 'That deck is empty.';
      },
      apply(s, pl, self, p) {
        const d = data(s, self);
        const isGroupDeck = p.mode === 'group';
        const card = (isGroupDeck ? d.group : d.plot) as string;
        const p0 = player(s, pl);
        const deck = isGroupDeck ? p0.groupDeck : p0.plotDeck;
        const bottom = deck.pop()!;
        p0.hand = p0.hand.filter((i) => i !== card);
        s.cards[card].zone = isGroupDeck ? 'groupDeck' : 'plotDeck';
        deck.unshift(card);
        s.cards[bottom].zone = 'hand';
        p0.hand.push(bottom);
        d.used = true;
      },
    }],
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
          if (debt.kind === 'destroy' && p.target && !player(s, debt.rival).hand.includes(p.target)) return 'Choose a Plot in that rival\'s hand.';
          return null;
        },
        apply(s, _pl, self, p) {
          const [debt, ...rest] = debts(s, self);
          data(s, self).pending = rest;
          const rival = player(s, debt.rival);
          for (const i of rival.hand) if (def(s, i).type === 'Plot') s.cards[i].exposed = true;
          if (debt.kind === 'destroy') {
            const victim = p.target ?? rival.hand.find((i) => def(s, i).type === 'Plot');
            if (victim && def(s, victim).type === 'Plot') discardCard(s, victim);
          }
        },
      },
    ],
  },

  // PENDING: an attack aided by the Spear should count as Magic for defenses against Magic.
  'spear-of-longinus': {
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
        if (die <= 5) destroyResource(s, p.target!);
        if (die >= 2) destroyResource(s, self);
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
      id: 'name', label: 'Secretly name a Place (cannot be changed)', timing: ['main'], usesToken: false, needs: { target: 'place' }, ai: 'never',
      check: (s, _pl, self, p) => (s.cards[self].note ? 'The Grail already protects a Place.' : inPlay(s, p.target) && place(s, p.target) ? null : 'Name a Place in play.'),
      apply(s, _pl, self, p) { s.cards[self].note = p.target; },
    }],
    preventDestroy: (s, self, target) => active(s, self) && s.cards[self].note === target,
    // Disasters do not check preventDestroy in the engine, so the Grail makes them fail outright.
    // PENDING: this shows the Grail's bonus before the roll, revealing the note early.
    attackMod: (s, self, ctx, side) => (side === 'defense' && active(s, self) && !!ctx.disaster && s.cards[self].note === ctx.target ? 100 : 0),
    onAttackEnd(s, self, ctx) {
      if (active(s, self) && s.cards[self].note === ctx.target && ctx.type === 'destroy' && (ctx.result === 'success' || ctx.disaster)) data(s, self).revealed = true;
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

  // PENDING: hiding Resources face down under Warehouse 23 (hidden cards inactive and untouchable).
  'warehouse-23': {
    onEnterPlay(s, self) { data(s, self).enteredTurn = s.turn; },
    actions: [{
      id: 'fetch', label: 'Bring in an Artifact or Gadget from your hand or deck', timing: ['main'], usesToken: false, needs: { target: 'resource' }, ai: 'never',
      check(s, pl, self, p) {
        const d = data(s, self);
        if (d.enteredTurn !== s.turn || d.fetched) return 'Only when Warehouse 23 is first played.';
        const p0 = player(s, pl);
        const t = p.target;
        if (!t || !s.cards[t] || s.cards[t].owner !== pl || ![...p0.hand, ...p0.groupDeck, ...p0.plotDeck].includes(t)) return 'Choose a card from your hand or deck.';
        if (def(s, t).type !== 'Resource' || !/Artifact|Gadget/.test(def(s, t).uniqueness ?? '')) return 'Choose an Artifact or Gadget Resource.';
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
