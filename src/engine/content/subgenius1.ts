// SubGenius pack, batch "subgenius1": Bobbies through Yetis (24 Group/Organization cards).
// See docs/CARD_SCRIPTING.md, "Expansions", and docs/EXPANSIONS.md.
import type { AttackCtx, GameEvent, GameState, PlotEffect } from '../types';
import { registerAbilities } from '../abilities';
import { registerHooks, registerChoice } from '../hooks';
import { def, cardName } from '../cards';
import { alignments, attributes, power } from '../stats';
import { openArrows, structureCards } from '../geometry';
import { rollDie } from '../rng';
import {
  askChoice, attackCancelled, cancelledGroups, controllerOf2, discardCard, drawPlot, livePlayers, log, placeGroup, player, tokenBarred,
} from '../game';
import { plotDeckOf } from '../expansions';

// ---------------------------------------------------------------- small local helpers

const ctl = (s: GameState, iid: string) => controllerOf2(s, iid);
const own = (s: GameState, pl: string, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure' && s.cards[iid].controller === pl;
const hasAlign = (s: GameState, iid: string | undefined, a: string) => !!iid && alignments(s, iid).includes(a as never);
const hasAttr = (s: GameState, iid: string | undefined, a: string) => !!iid && attributes(s, iid).includes(a);
/** A card in the exchange (attacker, aid, target, oppose) still counted, i.e. not cancelled. */
const live = (ctx: AttackCtx, iid: string) => !cancelledGroups(ctx).has(iid);
const leadsOrAids = (ctx: AttackCtx, self: string) => (ctx.attacker === self || ctx.aid.some((a) => a.iid === self)) && live(ctx, self);
/** Every card that takes an active part in this attack, on either side. */
function cast(ctx: AttackCtx): string[] {
  return [ctx.attacker, ...ctx.aid.map((a) => a.iid), ctx.target, ...ctx.oppose.map((o) => o.iid)].filter((x): x is string => !!x);
}
const eventNow = (s: GameState): GameEvent | undefined => (s.window?.kind === 'event' ? s.window.event : undefined);

// ---------------------------------------------------------------- abilities (every card needs an entry)

registerAbilities({
  'bobbies': [],
  'advanced-supersonic-aluminum-nazi-hell-creatures-from-beneath-the-hollow-earth': [],
  'church-of-middle-america': [],
  'citizens-for-normalcy': [],
  'corrective-phrenologists': [],
  'divine-mail-order': [],
  'drs-for-bob': [],
  'false-prophets': [],
  'glorps': [],
  'good-sex-for-mutants-dating-league': [],
  'league-for-obvious-decency': [],
  'local-clenches': [],
  'mwowm': [],
  'phlegm-elementals': [],
  'pinks': [],
  'rogue-subgenii': [],
  's-l-a-k': [],
  's-p-u-t-u-m': [],
  'secret-fistemple': [],
  'speakers-in-tongues': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Church'] }, value: 3, scope: 'any' },
  ],
  'subgenius-fistemples': [],
  'the-hour-of-slack': [],
  'xists': [],
  'yetis': [],
});

// ---------------------------------------------------------------- hooks

// "Bobbies": a hot potato. Successfully attacked (to control or destroy), it never stays: the attacker
// must discard it or hand it to a rival. It never counts toward any Goal itself, but its (possibly
// unwilling) owner needs one more Group for the Basic Goal. RULING: a card that destroys Groups directly
// (bypassing an attack, e.g. some Disasters) is not intercepted here, since only the attack-resolution
// path is hooked; that is a rare edge case for a card this specialised.
registerHooks({
  'bobbies': {
    noGoalCount: true,
    goalPenalty: () => 1,
    preventDestroy: (s, self, target) => target === self,
    onAttackEnd(s, self, ctx) {
      if (ctx.target !== self || attackCancelled(ctx) || ctx.result !== 'success') return;
      if (ctx.type !== 'control' && ctx.type !== 'destroy') return;
      bobbiesRelocate(s, self, ctx.attackerPlayer);
    },
  },
});

function bobbiesRelocate(s: GameState, self: string, byPlayer: string) {
  if (s.cards[self].zone !== 'structure') return;
  const spots = livePlayers(s).filter((p) => p.id !== byPlayer)
    .flatMap((p) => structureCards(s, p.id).flatMap((m) => openArrows(s, m).map((side) => ({ player: p.id, onto: m, side }))));
  const options = [
    { id: 'discard', label: 'Discard "Bobbies"' },
    ...spots.map((sp) => ({ id: `give|${sp.player}|${sp.onto}|${sp.side}`, label: `Give "Bobbies" to ${player(s, sp.player).name} (on ${cardName(s, sp.onto)})` })),
  ];
  askChoice(s, byPlayer, {
    key: 'bobbies-relocate', question: '"Bobbies" cannot be kept: discard them, or give them to a rival?',
    options, min: 1, max: 1, data: { self },
  });
}

registerChoice('bobbies-relocate', {
  ai: (_s, _pl, options) => [options[0].id],
  resolve(s, pl, picked, data) {
    const self = data.self as string;
    if (!self || !s.cards[self] || s.cards[self].zone !== 'structure') return;
    const choice = picked[0];
    if (!choice || choice === 'discard') { discardCard(s, self); log(s, `${cardName(s, self)} is discarded.`, pl); return; }
    const [, ontoPl, onto, side] = choice.split('|');
    if (!ontoPl || !onto || !side || s.cards[onto]?.zone !== 'structure' || s.cards[onto].controller !== ontoPl || !openArrows(s, onto).includes(side as never)) {
      discardCard(s, self); log(s, `${cardName(s, self)} is discarded.`, pl); return;
    }
    placeGroup(s, self, ontoPl, onto, side as never);
    log(s, `${cardName(s, self)} is given to ${player(s, ontoPl).name}.`, pl);
  },
});

registerHooks({
  // A Plot for its controller whenever it takes part in a successful Attack to Destroy a rival's Group.
  'advanced-supersonic-aluminum-nazi-hell-creatures-from-beneath-the-hollow-earth': {
    onAttackEnd(s, self, ctx) {
      const pl = ctl(s, self);
      if (!pl || attackCancelled(ctx) || ctx.result !== 'success' || ctx.type !== 'destroy') return;
      if (!leadsOrAids(ctx, self)) return;
      if (!ctx.targetPlayer || ctx.targetPlayer === pl) return; // must be a rival's Group
      drawPlot(s, player(s, pl));
      log(s, `${cardName(s, self)}: a rival's Group was destroyed, draw a Plot.`, pl);
    },
  },

  // +2 Power (and +2 Global Power if it prints any) for a SubGenius Group that directly controls it.
  'church-of-middle-america': {
    powerMod(s, self, iid) {
      return s.cards[self].master === iid && hasAttr(s, iid, 'SubGenius') ? 2 : 0;
    },
    // globalMod must not call globalPower() of iid (recursion): read its printed value instead.
    globalMod(s, self, iid) {
      return s.cards[self].master === iid && hasAttr(s, iid, 'SubGenius') && (def(s, iid).globalPower ?? 0) > 0 ? 2 : 0;
    },
  },

  // Immune to a direct Attack to Control, an automatic takeover or a move that would make it a puppet of
  // the Church of the SubGenius, the Discordian Society, or any Weird or SubGenius Group. Its controller
  // may spend its token plus an Illuminati token to cancel any Plot.
  // RULING: automatic takeover and voluntary moves choose a destination arrow without asking any per-arrow
  // hook, so the "may not be moved under one of these" half is approximated: it blocks the whole automatic
  // takeover only when literally no other Group of the acting player could receive it, and does not
  // constrain a later voluntary move at all. The direct-attack half above is fully enforced.
  'citizens-for-normalcy': {
    forbidAttack(s, self, attacker, target, type, attackerPlayer) {
      if (target !== self || type === 'destroy') return null;
      const blocked = (g: string) => s.cards[g].cardId === 'discordian-society' || hasAttr(s, g, 'Weird') || hasAttr(s, g, 'SubGenius');
      if (attacker) return blocked(attacker) ? `${cardName(s, self)} is immune to a direct Attack to Control by ${cardName(s, attacker)}.` : null;
      if (type === 'takeover') {
        if (attackerPlayer && player(s, attackerPlayer).illuminati && s.cards[player(s, attackerPlayer).illuminati].cardId === 'church-of-the-subgenius') {
          return `${cardName(s, self)} cannot become a puppet of the Church of the SubGenius.`;
        }
        const spots = attackerPlayer ? structureCards(s, attackerPlayer).filter((g) => !blocked(g) && openArrows(s, g).length) : [];
        if (attackerPlayer && !spots.length) return `${cardName(s, self)} would have to become a puppet of a Weird or SubGenius Group.`;
      }
      return null;
    },
    actions: [{
      id: 'cancel-plot', label: "Spend its token and an Illuminati token: cancel any Plot", timing: ['counter'], usesToken: true, ai: 'never',
      check(s, pl, self) {
        if (!own(s, pl, self)) return "You must control the Citizens for Normalcy.";
        if (!s.window?.plot) return 'Use this while a Plot is waiting to resolve.';
        if (s.cards[player(s, pl).illuminati].tokens < 1) return 'Your Illuminati also needs an Action token.';
        return null;
      },
      apply(s, pl): PlotEffect {
        s.cards[player(s, pl).illuminati].tokens--;
        const target = s.window!.plot!.iid;
        log(s, `The Citizens for Normalcy cancel ${cardName(s, target)}.`, pl);
        return { t: 'cancelPlot', target };
      },
    }],
  },

  // A fresh Action token as soon as the dice are rolled, in any attack or defense involving a rival's
  // Violent Group. (No hook fires exactly "as the dice are rolled"; beforeAttackResult, which runs right
  // after the roll and before the result is applied, is the closest equivalent.)
  'corrective-phrenologists': {
    beforeAttackResult(s, self, ctx) {
      const pl = ctl(s, self);
      if (!pl) return;
      if (s.cards[self].data?.phrenologyAttack === ctx.id) return; // already fired for this attack (a re-roll re-opens this hook)
      const involved = leadsOrAids(ctx, self) || ctx.target === self || ctx.oppose.some((o) => live(ctx, o.iid ?? '') && o.iid === self);
      if (!involved) return;
      if (!cast(ctx).some((g) => g !== self && ctl(s, g) && ctl(s, g) !== pl && hasAlign(s, g, 'Violent'))) return;
      s.cards[self].data = { ...s.cards[self].data, phrenologyAttack: ctx.id };
      if (!tokenBarred(s, self)) { s.cards[self].tokens = Math.max(1, s.cards[self].tokens); log(s, `${cardName(s, self)} gets a fresh Action token.`, pl); }
    },
  },

  'divine-mail-order': {
    actions: [{
      id: 'mail-order', label: 'Draw a Plot, or with an Illuminati action draw three', timing: ['main', 'anytime'], usesToken: true,
      needs: { modes: ['one', 'three'] }, ai: 'draw',
      check(s, pl, _self, p) {
        if (p.mode === 'three' && s.cards[player(s, pl).illuminati].tokens < 1) return 'Also spend an Illuminati Action token, or draw only one Plot.';
        return null;
      },
      apply(s, pl, _self, p) {
        if (p.mode === 'three') { s.cards[player(s, pl).illuminati].tokens--; drawPlot(s, player(s, pl), 3); }
        else drawPlot(s, player(s, pl));
      },
    }],
  },

  // May add its Power to the defense of another SubGenius Group its controller controls, as a free move
  // (no token spent, and it keeps its own).
  'drs-for-bob': {
    actions: [{
      id: 'defend-subgenius', label: 'Add its Power to another SubGenius Group\'s defense, free', timing: ['attack'], usesToken: false, ai: 'boostDefense',
      check(s, pl, self, _p, ctx) {
        if (!ctx || ctx.target === self) return 'Choose a defence of another SubGenius Group you control.';
        if (ctl(s, self) !== pl || ctl(s, ctx.target) !== pl) return 'You must control both Drs. for "Bob" and the defending Group.';
        if (!hasAttr(s, ctx.target, 'SubGenius')) return 'The defending Group must be SubGenius.';
        if (ctx.plays.some((p) => p.ability === self)) return 'Drs. for "Bob" has already helped this attack.';
        return null;
      },
      apply(s, pl, self, _p, ctx) {
        ctx!.defenseBonus.push({ player: pl, forGroup: ctx!.target, amount: power(s, self), label: cardName(s, self) });
      },
    }],
  },

  // +4 on any attempt (led by one of your own Groups) to control or destroy a rival's Church Group.
  'false-prophets': {
    attackMod(s, self, ctx, side) {
      const pl = ctl(s, self);
      if (side !== 'attack' || !pl || ctx.instant || ctx.attackerPlayer !== pl) return 0;
      if (!ctx.targetPlayer || ctx.targetPlayer === pl) return 0;
      return hasAttr(s, ctx.target, 'Church') ? 4 : 0;
    },
  },

  // Double Power attacking (or aiding an attack) to destroy a SubGenius Group; triple if their controller
  // has exposed The Anti"Bob".
  'glorps': {
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || ctx.type !== 'destroy' || !leadsOrAids(ctx, self) || !hasAttr(s, ctx.target, 'SubGenius')) return 0;
      const pl = ctl(s, self);
      const antiBob = !!pl && player(s, pl).hand.some((c) => s.cards[c].cardId === 'the-anti-bob' && s.cards[c].exposed);
      return power(s, self) * (antiBob ? 2 : 1);
    },
  },

  // Rivals' attempts to control a Weird Group it directly controls get -2.
  'good-sex-for-mutants-dating-league': {
    attackMod(s, self, ctx, side) {
      const pl = ctl(s, self);
      if (side !== 'attack' || !pl || ctx.type !== 'control' || ctx.instant || ctx.attackerPlayer === pl) return 0;
      return s.cards[ctx.target]?.master === self && hasAlign(s, ctx.target, 'Weird') ? -2 : 0;
    },
  },

  // Its action: put up to two exposed Plots (anyone's) on top of the shared Plot deck, or their owner's
  // Plot deck in standard play.
  'league-for-obvious-decency': {
    actions: [{
      id: 'bury-exposed', label: 'Return up to two exposed Plots to the top of the Plot deck', timing: ['anytime'], usesToken: true, ai: 'never',
      check(s) { return exposedPlots(s).length ? null : 'No exposed Plots to return.'; },
      apply(s, pl) {
        const options = exposedPlots(s).map((c) => ({ id: c, label: `${def(s, c).name} (${player(s, s.players.find((p) => p.hand.includes(c))!.id).name})` }));
        askChoice(s, pl, { key: 'league-bury-exposed', question: "Return up to two exposed Plots to the top of their owners' Plot decks?", options, min: 0, max: 2 });
      },
    }],
  },

  // An extra Action token each turn for its master, while that Group is SubGenius.
  'local-clenches': {
    extraTokens: (s, self, iid) => (s.cards[self].master === iid && hasAttr(s, iid, 'SubGenius') ? 1 : 0),
  },

  // Whenever any Plot is discarded, may spend its action to roll a die: 3 or less takes that Plot.
  'mwowm': {
    actions: [{
      id: 'snatch', label: 'Spend its action: roll a die to catch a just-discarded Plot', timing: ['event'], events: ['discarded'], usesToken: true, ai: 'never',
      listens(s, pl, self, e) {
        return e.type === 'discarded' && !!e.card && def(s, e.card).type === 'Plot' && ctl(s, self) === pl && s.cards[self].tokens > 0 && !tokenBarred(s, self);
      },
      check(s) {
        const e = eventNow(s);
        return e && e.type === 'discarded' && e.card && def(s, e.card).type === 'Plot' ? null : 'Use this right after a Plot is discarded.';
      },
      apply(s, pl) {
        const card = eventNow(s)!.card!;
        const roll = rollDie(s);
        if (roll > 3) { log(s, `MWOWM rolls ${roll}: too slow to catch ${cardName(s, card)}.`, pl); return; }
        if (s.cards[card].zone !== 'discard') return;
        for (const x of s.players) x.discard = x.discard.filter((i) => i !== card);
        if (s.common) { s.common.plotDiscard = s.common.plotDiscard.filter((i) => i !== card); }
        s.cards[card].zone = 'hand';
        player(s, pl).hand.push(card);
        log(s, `MWOWM rolls ${roll}: it catches ${cardName(s, card)}.`, pl);
      },
    }],
  },

  // Once it takes part in an attack, marks the target as soon as the dice are rolled: that Group misses
  // its next chance to get a new Action token.
  'phlegm-elementals': {
    beforeAttackResult(s, self, ctx) {
      if (s.cards[self].data?.phlegmAttack === ctx.id) return;
      const involved = leadsOrAids(ctx, self) || ctx.target === self || ctx.oppose.some((o) => o.iid === self);
      if (!involved) return;
      s.cards[self].data = { ...s.cards[self].data, phlegmAttack: ctx.id };
      const tgt = s.cards[ctx.target];
      if (tgt && tgt.zone === 'structure') { tgt.data = { ...tgt.data, skipTokenGain: true }; log(s, `${cardName(s, ctx.target)} is befouled: it misses its next Action token.`); }
    },
  },

  // Whenever it has no Action token, it may take one from another Straight Group its controller controls.
  'pinks': {
    actions: [{
      id: 'mooch', label: 'Take an Action token from another Straight Group you control', timing: ['anytime'], usesToken: false, needs: { target: 'ownGroup' }, ai: 'never',
      check(s, pl, self, p) {
        if (s.cards[self].tokens > 0) return 'The Pinks already have an Action token.';
        const t = p.target;
        if (!t || t === self || !own(s, pl, t) || !hasAlign(s, t, 'Straight')) return 'Choose another Straight Group you control.';
        if (s.cards[t].tokens < 1 || tokenBarred(s, t)) return 'That Group has no Action token to give.';
        return null;
      },
      apply(s, pl, self, p) {
        s.cards[p.target!].tokens--;
        s.cards[self].tokens++;
        log(s, `${cardName(s, p.target!)} gives its Action token to the Pinks.`, pl);
      },
    }],
  },

  // Whenever it has no Action token, its controller may discard a Plot to give it one; once per turn.
  'rogue-subgenii': {
    actions: [{
      id: 'rogue-token', label: 'Discard a Plot to give the Rogue SubGenii an Action token', timing: ['anytime'], usesToken: false, oncePerTurn: true, needs: { target: 'handPlot' }, ai: 'never',
      check(s, pl, self, p) {
        if (s.cards[self].tokens > 0) return 'The Rogue SubGenii already have an Action token.';
        const t = p.target;
        if (!t || !player(s, pl).hand.includes(t) || def(s, t).type !== 'Plot') return 'Discard one of your Plot cards.';
        return null;
      },
      apply(s, pl, self, p) {
        discardCard(s, p.target!);
        s.cards[self].tokens++;
        log(s, `${player(s, pl).name} discards a Plot to give the Rogue SubGenii an Action token.`, pl);
      },
    }],
  },

  // Gets an Action token at each rival's token placement, if it has none. (No hook fires precisely at
  // "token placement"; turnStart, right before it, is the closest equivalent.)
  's-l-a-k': {
    onEvent(s, self, e) {
      if (e.type !== 'turnStart' || !e.player) return;
      const pl = ctl(s, self);
      if (!pl || e.player === pl) return;
      if (s.cards[self].tokens === 0 && !tokenBarred(s, self)) { s.cards[self].tokens = 1; log(s, 'S.L.A.K. never rests: it gets an Action token.', pl); }
    },
  },

  // Triple Power in any attack against a Personality.
  's-p-u-t-u-m': {
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || !leadsOrAids(ctx, self)) return 0;
      return def(s, ctx.target).subtype === 'Personality' ? power(s, self) * 2 : 0;
    },
  },

  // May only attack to control Personalities; every Personality it controls is SubGenius; it may pass its
  // own token to its master or to a puppet that is SubGenius by its own printed card; it always has its
  // master's alignments.
  'secret-fistemple': {
    forbidAttack(s, self, attacker, target, type) {
      return attacker === self && type === 'control' && def(s, target).subtype !== 'Personality'
        ? `${cardName(s, self)} may only attack to control a Personality.` : null;
    },
    attributeMod(s, self, iid, current) {
      return s.cards[iid].master === self && def(s, iid).subtype === 'Personality' && !current.includes('SubGenius') ? [...current, 'SubGenius'] : current;
    },
    alignmentMod(s, self, iid, current) {
      if (iid !== self) return current;
      const m = s.cards[self].master;
      return m ? alignments(s, m) : current;
    },
    actions: [{
      id: 'pass-token', label: "Give its Action token to its master or a natively SubGenius puppet", timing: ['anytime'], usesToken: true, needs: { target: 'group' }, ai: 'never',
      check(s, pl, self, p) {
        const t = p.target;
        if (!t || s.cards[t]?.zone !== 'structure' || s.cards[t].controller !== pl) return 'Choose a Group you control.';
        const isMaster = t === s.cards[self].master;
        const isPuppet = s.cards[t].master === self;
        if (!isMaster && !isPuppet) return "Choose the Secret FisTemple's master or one of its own puppets.";
        if (!isMaster && !(def(s, t).attributes ?? []).includes('SubGenius')) return 'That puppet must be SubGenius by its own printed card.';
        return null;
      },
      apply(s, pl, _self, p) {
        s.cards[p.target!].tokens++;
        log(s, `The Secret FisTemple passes its Action token to ${cardName(s, p.target!)}.`, pl);
      },
    }],
  },

  // Every Group it directly controls gets +5 Resistance.
  'subgenius-fistemples': {
    resistanceMod: (s, self, iid) => (s.cards[iid].master === self ? 5 : 0),
  },

  // Whenever a rival attacks a Group in your Power Structure, draw a Plot as the attack begins.
  'the-hour-of-slack': {
    onAttackStart(s, self, ctx) {
      const pl = ctl(s, self);
      if (!pl || ctx.targetPlayer !== pl || ctx.attackerPlayer === pl) return;
      drawPlot(s, player(s, pl));
      log(s, `${cardName(s, self)}: a rival attacks, draw a Plot.`, pl);
    },
  },

  // Cannot really be controlled: never counts as destroyed for other cards, and when destroyed goes to
  // the uncontrolled area (or its destroyer's hand in a standard game) instead of the destroyed pile.
  // RULING: this covers the Basic Goal / destroy-credit bookkeeping (noDestroyCredit) and where the card
  // ends up (survivesDestruction); a rival's own "draw a Plot when you destroy a Group" ability still
  // triggers, since undoing every downstream effect of the 'destroyed' event is beyond what a single
  // Group's hooks can safely intercept.
  'xists': {
    noDestroyCredit: true,
    survivesDestruction: true,
  },

  // May be placed on any physically open side of its master, arrow or not; any Group with an open side
  // may attack to control it.
  'yetis': {
    anySideMaster: true,
  },
});

function exposedPlots(s: GameState): string[] {
  const out: string[] = [];
  for (const p of s.players) for (const c of p.hand) if (s.cards[c].exposed && def(s, c).type === 'Plot') out.push(c);
  return out;
}

registerChoice('league-bury-exposed', {
  ai: () => [],
  resolve(s, pl, picked) {
    for (const c of picked) {
      const card = s.cards[c];
      if (card.zone !== 'hand' || !card.exposed || def(s, c).type !== 'Plot') continue;
      const owner = player(s, card.owner);
      owner.hand = owner.hand.filter((x) => x !== c);
      card.zone = 'plotDeck'; card.exposed = false; card.controller = undefined;
      plotDeckOf(s, card.owner).unshift(c);
      log(s, `${player(s, pl).name} returns ${def(s, c).name} to the top of ${owner.name}'s Plot deck.`, pl);
    }
  },
});
