// SubGenius pack, batch "subgenius1": Bobbies through Yetis (24 Group/Organization cards).
// See docs/CARD_SCRIPTING.md, "Expansions", and docs/EXPANSIONS.md.
import { noteCostDiscard } from '../game';
import type { AttackCtx, GameEvent, GameState, PlotEffect } from '../types';
import { registerAbilities } from '../abilities';
import { registerHooks, registerChoice } from '../hooks';
import { def, cardName } from '../cards';
import { alignments, attributes, power } from '../stats';
import { structureCards, subtree } from '../geometry';
import {
  askChoice, attackCancelled, cancelledGroups, cardRoll, controllerOf2, discardCard, drawPlot, isCancelled, livePlayers, log, placeGroup, player, puppetSides,
  registerRollResult, tokenBarred,
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
const eventNow = (s: GameState): GameEvent | undefined => (s.window?.kind === 'event' ? s.window.event : undefined);
/**
 * Does `master` control `iid`, directly or through its puppets? The SubGenius glossary: a Power Structure is
 * what the Illuminati controls "both directly and through its puppets", and "master" names direct control
 * only; so a card saying "controls" reaches every Group below it.
 */
function controls(s: GameState, master: string, iid: string): boolean {
  let c = s.cards[iid];
  while (c?.master) { if (c.master === master) return true; c = s.cards[c.master]; }
  return false;
}

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

// "Bobbies": a hot potato. Successfully attacked (to control or destroy, a Disaster included), they never
// stay: the attacker must discard them or hand them to a rival, instead of the usual result. Nothing
// else removes or moves them (errata: only an attack on them or the loss of their master), so they are
// never destroyed and their controller may not move them. They never count toward any Goal themselves,
// but their (possibly unwilling) owner needs one more Group for the Basic Goal. Whoever takes them over
// may hang them at once on any rival's open control arrow.
registerHooks({
  'bobbies': {
    noGoalCount: true,
    goalPenalty: () => 1,
    neverDestroyed: true,
    cannotMove: true,
    replaceAttackResult(s, self, ctx) {
      if (ctx.target !== self) return false;
      bobbiesRelocate(s, self, ctx.attackerPlayer, true);
      return true;
    },
    // Taken over from a hand or the uncontrolled area (a successful attack is handled above).
    onEnterPlay(s, self) {
      const pl = s.cards[self].controller;
      if (!pl || s.attack?.target === self) return;
      bobbiesRelocate(s, self, pl, false);
    },
  },
});

/** Open control arrows of rivals of `byPlayer` where the "Bobbies" could be hung. */
function bobbiesSpots(s: GameState, self: string, byPlayer: string) {
  return livePlayers(s).filter((p) => p.id !== byPlayer)
    .flatMap((p) => structureCards(s, p.id).flatMap((m) => puppetSides(s, p.id, self, m).map((side) => ({ player: p.id, onto: m, side }))));
}

/** `mustGo`: after a successful attack (discard or give); otherwise just taken over (keep, or give). */
function bobbiesRelocate(s: GameState, self: string, byPlayer: string, mustGo: boolean) {
  const spots = bobbiesSpots(s, self, byPlayer);
  if (!mustGo && !spots.length) return;
  const options = [
    mustGo ? { id: 'discard', label: 'Discard "Bobbies"' } : { id: 'keep', label: 'Keep "Bobbies" where they are' },
    ...spots.map((sp) => ({ id: `give|${sp.player}|${sp.onto}|${sp.side}`, label: `Give "Bobbies" to ${player(s, sp.player).name} (on ${cardName(s, sp.onto)}, ${sp.side.toLowerCase()} side)` })),
  ];
  askChoice(s, byPlayer, {
    key: 'bobbies-relocate',
    question: mustGo ? '"Bobbies" cannot be kept: discard them, or give them to a rival?' : 'You took over the "Bobbies": keep them, or hang them on a rival\'s open control arrow?',
    options, min: 1, max: 1, data: { self, mustGo },
  });
}

registerChoice('bobbies-relocate', {
  // A computer player is glad to saddle a rival with them.
  ai: (_s, _pl, options) => [(options.find((o) => o.id.startsWith('give|')) ?? options[0]).id],
  resolve(s, pl, picked, data) {
    const self = data.self as string;
    if (!self || !s.cards[self] || !['structure', 'uncontrolled', 'hand'].includes(s.cards[self].zone)) return;
    const choice = picked[0];
    const drop = () => {
      if (!data.mustGo) return;
      // Not destroyed: simply discarded (their puppets go where a discarded Group's puppets go).
      discardCard(s, self);
      log(s, `${cardName(s, self)} are discarded.`, pl);
    };
    if (!choice || choice === 'discard' || choice === 'keep') { drop(); return; }
    const [, ontoPl, onto, side] = choice.split('|');
    if (!ontoPl || !onto || !side || !puppetSides(s, ontoPl, self, onto).includes(side as never)) { drop(); return; }
    placeGroup(s, self, ontoPl, onto, side as never);
    s.cards[self].tokens = 0;
    log(s, `${cardName(s, self)} are given to ${player(s, ontoPl).name}.`, pl);
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
  // Every SubGenius Group controlling it (directly or through its puppets) gets +2 Power, and +2 Global
  // Power if it has Global Power of its own.
  // RULING: "if it already has Global Power" reads the Group's printed Global Power (a globalMod may not ask
  // for the Global Power it is itself part of).
  'church-of-middle-america': {
    powerMod(s, self, iid) {
      return controls(s, iid, self) && hasAttr(s, iid, 'SubGenius') ? 2 : 0;
    },
    globalMod(s, self, iid) {
      return controls(s, iid, self) && hasAttr(s, iid, 'SubGenius') && (def(s, iid).globalPower ?? 0) > 0 ? 2 : 0;
    },
  },

  // Immune to a direct Attack to Control led by the Church of the SubGenius, the Discordian Society, or
  // any Weird or SubGenius Group; and never made a puppet of one of these, however it would get there
  // (an automatic takeover, a capture, a move, a card). Both hold wherever the card waits (a hand, the
  // uncontrolled area). Its controller may spend its token plus an Illuminati token to cancel any Plot.
  'citizens-for-normalcy': {
    forbidIsImmunity: true,
    rulesOffTable: true,
    forbidAttack(s, self, attacker, target, type) {
      if (target !== self || type !== 'control' || !attacker) return null;
      return normalcyFoe(s, attacker) ? `${cardName(s, self)} is immune to a direct Attack to Control by ${cardName(s, attacker)}.` : null;
    },
    forbidPuppet(s, self, group, master) {
      return group === self && normalcyFoe(s, master) ? `${cardName(s, self)} may never become a puppet of ${cardName(s, master)}.` : null;
    },
    actions: [{
      id: 'cancel-plot', label: "Spend its token and an Illuminati token: cancel any Plot", timing: ['counter', 'attack', 'roll'], usesToken: true, ai: 'never',
      needs: { target: 'plot' },
      check(s, pl, self, p, ctx) {
        if (!own(s, pl, self)) return "You must control the Citizens for Normalcy.";
        if (s.cards[player(s, pl).illuminati].tokens < 1) return 'Your Illuminati also needs an Action token.';
        const pool = s.window?.kind === 'plot' ? s.window.plays ?? [] : ctx?.plays ?? [];
        const t = p.target ?? (s.window?.kind === 'plot' ? s.window.plot?.iid : undefined);
        const pp = pool.find((x) => x.iid === t);
        if (!pp || !s.cards[pp.iid] || def(s, pp.iid).type !== 'Plot' || s.cards[pp.iid].zone !== 'table' || isCancelled(pool, pp.iid)) return 'Choose a Plot card that has just been played.';
        return null;
      },
      apply(s, pl, _self, p): PlotEffect {
        s.cards[player(s, pl).illuminati].tokens--;
        const target = p.target ?? s.window!.plot!.iid;
        log(s, `The Citizens for Normalcy cancel ${cardName(s, target)}.`, pl);
        return { t: 'cancelPlot', target };
      },
    }],
  },

  // A new Action token the moment the dice are rolled, when they take part in an attack on a rival's
  // Violent Group (leading or aiding it), or in the defense against one (as the target, or opposing,
  // when the attacking side has a rival's Violent Group). The Group only has to be Violent during the
  // attack (card FAQ).
  'corrective-phrenologists': {
    onDiceRolled(s, self, ctx) {
      const pl = ctl(s, self);
      if (!pl || !live(ctx, self)) return;
      const rivalViolent = (g?: string) => !!g && live(ctx, g) && !!ctl(s, g) && ctl(s, g) !== pl && hasAlign(s, g, 'Violent');
      const attacking = leadsOrAids(ctx, self) && rivalViolent(ctx.target);
      const defending = (ctx.target === self || ctx.oppose.some((o) => o.iid === self))
        && [ctx.attacker, ...ctx.aid.map((a) => a.iid)].some((g) => rivalViolent(g));
      if (!attacking && !defending) return;
      if (tokenBarred(s, self)) return;
      s.cards[self].tokens++;
      log(s, `${cardName(s, self)} get a new Action token.`, pl);
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

  // May add its Power to the defense of any SubGenius Group its controller controls, itself included, as a
  // free move (no token spent, and it keeps its own); once per attack.
  'drs-for-bob': {
    actions: [{
      id: 'defend-subgenius', label: 'Add its Power to a SubGenius Group\'s defense, free', timing: ['attack'], usesToken: false, ai: 'boostDefense',
      check(s, pl, self, _p, ctx) {
        if (!ctx) return 'Use this while a SubGenius Group you control is attacked.';
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

  // Every rival of its controller gets -2 on any attempt to control any Weird Group (wherever it is).
  'good-sex-for-mutants-dating-league': {
    attackMod(s, self, ctx, side) {
      const pl = ctl(s, self);
      if (side !== 'attack' || !pl || ctx.type !== 'control' || ctx.instant || ctx.attackerPlayer === pl) return 0;
      return hasAlign(s, ctx.target, 'Weird') ? -2 : 0;
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
      // The die roll is announced (cardRoll), so cards that change any die roll may answer it.
      apply(s, pl) {
        const card = eventNow(s)!.card!;
        cardRoll(s, pl, 1, 'mwowm', { card });
      },
    }],
  },

  // When they take part in an attack (leading, aiding or opposing), the target is marked the moment the
  // dice are rolled, whatever the outcome: that Group misses its next chance to get new Action tokens,
  // then the mark goes (finishBeginning in game.ts). The mark stays on the card wherever it goes.
  'phlegm-elementals': {
    onDiceRolled(s, self, ctx) {
      const involved = leadsOrAids(ctx, self) || ctx.oppose.some((o) => o.iid === self && live(ctx, self));
      if (!involved) return;
      const tgt = s.cards[ctx.target];
      if (!tgt || def(s, ctx.target).type !== 'Group') return;
      tgt.data = { ...tgt.data, skipTokenGain: true };
      log(s, `${cardName(s, ctx.target)} is befouled: it misses its next Action tokens.`);
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
        noteCostDiscard(s, pl, [{ kind: 'plot', place: 'hand', cards: [p.target!] }]);
        s.cards[self].tokens++;
        log(s, `${player(s, pl).name} discards a Plot to give the Rogue SubGenii an Action token.`, pl);
      },
    }],
  },

  // Gets an Action token during each rival's token placement phase, if it has none.
  's-l-a-k': {
    onTokensPlaced(s, self, active) {
      const pl = ctl(s, self);
      if (!pl || active === pl) return;
      if (s.cards[self].tokens === 0 && !s.cards[self].heldTokens && !tokenBarred(s, self)) { s.cards[self].tokens = 1; log(s, 'S.L.A.K. never rests: it gets an Action token.', pl); }
    },
  },

  // Triple Power in any attack against a Personality.
  's-p-u-t-u-m': {
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || !leadsOrAids(ctx, self)) return 0;
      return def(s, ctx.target).subtype === 'Personality' ? power(s, self) * 2 : 0;
    },
  },

  // May only control Personalities (no other card may become its puppet, however it would get there);
  // every Personality it controls is SubGenius; it may pass its own token to its master or to a puppet,
  // if that Group is SubGenius by its own printed card; it always has its master's alignments.
  'secret-fistemple': {
    // Nothing but Personalities anywhere below it (a Group coming in brings its own puppets along).
    forbidPuppet(s, self, group, master) {
      if (master !== self && !controls(s, self, master)) return null;
      const incoming = s.cards[group].zone === 'structure' ? subtree(s, group) : [group];
      return incoming.some((g) => def(s, g).subtype !== 'Personality') ? `${cardName(s, self)} may only control Personalities.` : null;
    },
    attributeMod(s, self, iid, current) {
      return controls(s, self, iid) && def(s, iid).subtype === 'Personality' && !current.includes('SubGenius') ? [...current, 'SubGenius'] : current;
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
        if (!(def(s, t).attributes ?? []).includes('SubGenius')) return 'That Group must be SubGenius by its own printed card.';
        return null;
      },
      apply(s, pl, _self, p) {
        s.cards[p.target!].tokens++;
        log(s, `The Secret FisTemple passes its Action token to ${cardName(s, p.target!)}.`, pl);
      },
    }],
  },

  // Every Group it controls (its puppets, and theirs) gets +5 Resistance.
  'subgenius-fistemples': {
    resistanceMod: (s, self, iid) => (controls(s, self, iid) ? 5 : 0),
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

  // When destroyed they go to the uncontrolled area (or their destroyer's hand in a standard game) and
  // never count as destroyed for any purpose: destroyGroup (game.ts) announces no destruction, so no
  // card reacts to it or gives credit for it. ("You can't actually CONTROL them" is flavor: they are
  // controlled like any Group.)
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

/** The masters the Citizens for Normalcy refuse: the Church of the SubGenius, the Discordian Society, Weird or SubGenius Groups. */
function normalcyFoe(s: GameState, g: string): boolean {
  const id = s.cards[g]?.cardId;
  return id === 'church-of-the-subgenius' || id === 'discordian-society' || hasAlign(s, g, 'Weird') || hasAttr(s, g, 'SubGenius');
}

// MWOWM's die roll, once everyone had the chance to change it: 3 or less takes the discarded Plot.
registerRollResult({
  mwowm(s, pl, total, _dice, data) {
    const card = data.card as string;
    if (total > 3) { log(s, `MWOWM: ${total} is too slow to catch ${cardName(s, card)}.`, pl); return; }
    if (!s.cards[card] || s.cards[card].zone !== 'discard') return;
    for (const x of s.players) x.discard = x.discard.filter((i) => i !== card);
    if (s.common) s.common.plotDiscard = s.common.plotDiscard.filter((i) => i !== card);
    s.cards[card].zone = 'hand';
    player(s, pl).hand.push(card);
    log(s, `MWOWM catches ${cardName(s, card)}.`, pl);
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
