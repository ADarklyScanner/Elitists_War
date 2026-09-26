// SubGenius pack, batch subgenius2: the Church's early Personalities, its Places, its Gadgets and
// Artifacts, and its Goal cards. See docs/CARD_SCRIPTING.md, "Expansions", and docs/EXPANSIONS.md.
import type { AttackCtx, GameState } from '../types';
import { RuleError } from '../types';
import { registerAbilities, attackingGroups } from '../abilities';
import { registerHooks } from '../hooks';
import { registerPlots, registerGoals, registerGoalProgress, registerGoalExposeBonus } from '../plotTypes';
import { def, cardName } from '../cards';
import { alignments, attributes, power } from '../stats';
import { openArrows, outSides, structureCards, subtree } from '../geometry';
import {
  activePlayer, controllerOf2, discardCard, drawGroup, drawPlot, goalCount, goalNeeded, livePlayers,
  log, moveSubtree, player, plotsInHand, revealTo,
} from '../game';
import { plotDeckOf, groupDeckOf, sgRules } from '../expansions';
import { roll2d6 } from '../rng';

// ---------------------------------------------------------------- shared helpers

const inPlay = (s: GameState, iid?: string) => !!iid && (s.cards[iid]?.zone === 'structure' || s.cards[iid]?.zone === 'uncontrolled');
const isGroup = (s: GameState, iid?: string) => !!iid && !!s.cards[iid] && def(s, iid).type === 'Group';
const active = (s: GameState, self: string) => s.cards[self]?.zone === 'resources' && !!s.cards[self].controller && !s.cards[self].hiddenUnder;
const linked = (s: GameState, self: string) => s.cards[self].linkedTo;
/** Is `child` somewhere under `master` in the same Power Structure (its own puppets, and theirs, and so on)? */
function isUnder(s: GameState, master: string, child: string): boolean {
  let c = s.cards[child];
  while (c?.master) { if (c.master === master) return true; c = s.cards[c.master]; }
  return false;
}

// =================================================================== Groups

registerAbilities({
  'www-subgenius-com': [],
  'connie-dobbs': [],
  'dr-k-taden-legume': [],
  'jesus-b': [],
  'nhgh': [{ kind: 'cannotBeDestroyed' }],
  'overman-philo-drummond': [],
  'reverend-ivan-stang': [],
  'st-janor-hypercleats': [],
  'frop-farm': [],
  'dallas-catacombs': [],
  'dobbstown': [{ kind: 'attackBonus', on: 'control', target: { attributes: ['SubGenius'], subtypes: ['Personality'] }, value: 5, scope: 'any' }],
  'dokstok': [{ kind: 'extraIlluminatiToken', value: 1 }],
  'saucer-landing-strip': [],
});

registerHooks({
  // At the start of each of the controller's turns, an extra Group is drawn (into the uncontrolled
  // area under the stand-alone rules); in a mixed game, with no uncontrolled area to draw into, its
  // action buys that draw instead (the printed text gives both options explicitly).
  'www-subgenius-com': {
    onTurnStart(s, self) {
      if (!sgRules(s)) return;
      if ((s.common?.uncontrolled.length ?? 0) >= 8) return;
      const pl = controllerOf2(s, self);
      if (pl) drawGroup(s, player(s, pl));
    },
    actions: [{
      id: 'draw-group', label: 'Spend its action to draw a Group card', timing: ['anytime'], usesToken: true, ai: 'draw',
      check(s) { return sgRules(s) ? 'Only in a game with no uncontrolled area.' : null; },
      apply(s, pl) { drawGroup(s, player(s, pl)); },
    }],
  },

  // Neither Connie nor any Group in her own subtree can be destroyed while she is both Straight and
  // SubGenius (an alignment or attribute change from another card ends the protection at once).
  'connie-dobbs': {
    preventDestroy(s, self, target) {
      if (target !== self && !isUnder(s, self, target)) return false;
      return alignments(s, self).includes('Straight') && attributes(s, self).includes('SubGenius');
    },
  },

  // No attack of any kind (including Instant Attacks, which have no attacking Group) may fall on
  // another SubGenius Personality of Legume's own controller while he stays SubGenius and in play.
  'dr-k-taden-legume': {
    immune(s, self, target, source) {
      if (target === self || !attributes(s, self).includes('SubGenius')) return false;
      const ctl = controllerOf2(s, self);
      if (!ctl || controllerOf2(s, target) !== ctl) return false;
      if (def(s, target).subtype !== 'Personality' || !attributes(s, target).includes('SubGenius')) return false;
      const srcOwner = s.cards[source] ? (controllerOf2(s, source) ?? s.cards[source].owner) : undefined;
      return srcOwner !== ctl; // never blocks its own controller's own plays
    },
  },

  // A once-per-game bonus token for the mock "send a dollar" ritual; a real transaction is flavor,
  // not something the engine can verify, so using the ability is itself the whole cost.
  'jesus-b': {
    actions: [{
      id: 'buy-slack', label: 'Buy one Slack for your Illuminati', timing: ['anytime'], usesToken: false, ai: 'free',
      check(s, _pl, self) { return s.cards[self].data?.boughtSlack ? 'Already used once this game.' : null; },
      apply(s, pl, self) {
        s.cards[self].data = { ...s.cards[self].data, boughtSlack: true };
        s.cards[player(s, pl).illuminati].tokens++;
        log(s, `${cardName(s, self)} buys one Slack for the Illuminati (the traditional dollar in the mail).`, pl);
      },
    }],
  },

  // Cannot be destroyed. Nobody but a player who has exposed The Anti"Bob" may take it over. While it
  // sits uncontrolled, its Power of 5 helps any Attack to Destroy, anywhere. In a mixed game there is no
  // uncontrolled area for it to sit in: it may instead be played from hand as a one-off +5 to an Attack
  // to Destroy on a rival's Group, after which it becomes that rival's card (the printed alternative).
  'nhgh': {
    activeUncontrolled: true,
    forbidAttack(s, self, _attacker, target, type, attackerPlayer) {
      if (target !== self || (type !== 'control' && type !== 'takeover')) return null;
      return exposedAntiBob(s, attackerPlayer) ? null : `${cardName(s, self)} can only be controlled by a player who has exposed The Anti"Bob".`;
    },
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || ctx.type !== 'destroy' || s.cards[self].zone !== 'uncontrolled') return 0;
      return 5;
    },
  },

  // His Weird puppets are SubGenius, and the OverMan / False OverMan Resources cannot link to him.
  'overman-philo-drummond': {
    attributeMod(s, self, iid, current) {
      if (current.includes('SubGenius') || s.cards[iid]?.master !== self) return current;
      return alignments(s, iid).includes('Weird') ? [...current, 'SubGenius'] : current;
    },
    immune(s, self, target, source) {
      return target === self && (s.cards[source]?.cardId === 'overman' || s.cards[source]?.cardId === 'false-overman');
    },
  },

  'reverend-ivan-stang': {
    actions: [{
      id: 'give-token', label: 'Give his Action token to another SubGenius Group with none', timing: ['anytime'], usesToken: true,
      needs: { target: 'ownGroup' }, ai: 'free',
      check(s, pl, self, p) {
        const t = p.target ? s.cards[p.target] : undefined;
        if (!t || t.iid === self || t.zone !== 'structure' || t.controller !== pl) return "Choose another SubGenius Group of yours.";
        if (!attributes(s, p.target!).includes('SubGenius')) return 'Choose a SubGenius Group.';
        if (t.tokens > 0) return 'That Group already has an Action token.';
        return null;
      },
      apply(s, _pl, _self, p) { s.cards[p.target!].tokens++; },
    }],
  },

  // A natural 11 in an attack he makes or aids does not fail automatically; a natural 2 counts as 12
  // instead, and costs his Illuminati one token (if it has any). He may attack, or help attack, Secret
  // Groups whatever their alignments (R014 does not apply to him).
  'st-janor-hypercleats': {
    noAutoFail11: (s, self, ctx) => attackingGroups(ctx).includes(self),
    secretOverride: (s, self, group) => group === self,
    beforeAttackResult(s, self, ctx) {
      if (!attackingGroups(ctx).includes(self)) return;
      if ((ctx.roll?.[0] ?? 0) + (ctx.roll?.[1] ?? 0) !== 2) return;
      if (ctx.plays.some((pp) => pp.ability === self)) return; // only once per attack
      const pl = controllerOf2(s, self);
      if (!pl) return;
      ctx.plays.push({ iid: `ability:${self}:natural-two:${s.version}`, player: pl, play: { card: self }, effect: { t: 'set', value: 12 }, ability: self });
      const ill = player(s, pl).illuminati;
      if (s.cards[ill].tokens > 0) {
        s.cards[ill].tokens--;
        log(s, `${cardName(s, self)} rolls a natural 2, which counts as a 12; ${player(s, pl).name}'s Illuminati loses an Action token.`, pl);
      } else log(s, `${cardName(s, self)} rolls a natural 2, which counts as a 12.`, pl);
    },
  },

  'frop-farm': {
    actions: [{
      id: 'strip', label: 'Remove every Action token from a Personality', timing: ['anytime'], usesToken: true, needs: { target: 'personality' }, ai: 'never',
      check(s, _pl, _self, p) {
        if (!p.target || def(s, p.target).subtype !== 'Personality' || !inPlay(s, p.target)) return 'Choose a Personality in play.';
        return null;
      },
      apply(s, _pl, _self, p) { s.cards[p.target!].tokens = 0; },
    }],
  },

  // RULING: "may hang on any side... and switch sides at any time" is encoded as freedom for the
  // Group actually being moved (movableSides() in game.ts). Puppets carried along with it keep their
  // relative layout on its own real arrows, as for any move; a puppet placed loosely by the Catacombs
  // that isn't itself moved keeps sitting there until it, or an ancestor, loses the Catacombs.
  'dallas-catacombs': {
    freeArrows: (s, self, master) => s.cards[master]?.controller === controllerOf2(s, self),
    onDestroy(s, self, victim) { if (victim === self) untangleCatacombs(s, s.cards[self].controller); },
    onCapture(s, self, victim, _by, from) { if (victim === self && from) untangleCatacombs(s, from); },
  },

  'dokstok': {
    // RULING: "must be given to, or traded to, another Illuminati, or thrown away, before doing
    // anything else" is table etiquette on how that specific token is later spent; tokens are a plain
    // count in this engine (not individually tagged), so, like Jesus B.'s dollar, it is left to players
    // to honour it. The engine only grants the extra token itself (extraIlluminatiToken above).
  },

  'saucer-landing-strip': {
    actions: [{
      id: 'trade', label: "Trade this Group's Action token for two Plots", timing: ['anytime'], usesToken: true, ai: 'draw',
      check(s, pl) { return plotsInHand(s, pl).length ? 'You must hold no Plot cards.' : null; },
      apply(s, pl) { drawPlot(s, player(s, pl), 2); },
    }],
  },
});

/** Has this player exposed The Anti"Bob" (in hand, and shown)? */
function exposedAntiBob(s: GameState, pl: string): boolean {
  return player(s, pl).hand.some((iid) => s.cards[iid].cardId === 'the-anti-bob' && s.cards[iid].exposed);
}

/**
 * Losing the Catacombs (destroyed or captured): every Group of `controller` sitting on a side that
 * isn't really one of its master's outgoing arrows moves onto a real arrow for free (shallowest first,
 * so an ancestor is corrected before its puppets are looked at); one that no longer fits is discarded
 * with its own puppets.
 */
function untangleCatacombs(s: GameState, controller: string | undefined) {
  if (!controller) return;
  const depthOf = (iid: string) => { let d = 0, c = s.cards[iid]; while (c.master) { d++; c = s.cards[c.master]; } return d; };
  const cards = structureCards(s, controller).filter((iid) => !!s.cards[iid].master).sort((a, b) => depthOf(a) - depthOf(b));
  for (const iid of cards) {
    const c = s.cards[iid];
    if (c.zone !== 'structure' || !c.master) continue; // already moved or discarded by an earlier fix
    if (c.side && outSides(s, c.master).includes(c.side)) continue; // already a real arrow
    const open = openArrows(s, c.master, new Set(subtree(s, iid)));
    if (open.length) moveSubtree(s, iid, controller, c.master, open[0], 'discard');
    else for (const g of subtree(s, iid)) discardCard(s, g);
  }
}

// =================================================================== Resources

registerHooks({
  // The +1/-1 adjustment works for any roll of an attack its holder leads (the printed "any die roll
  // you make" is scoped this way: only attacks have die rolls in this engine). A natural 11 or 12 sends
  // it off in a roll-off among the other players still in the game; if it happened on the holder's own
  // turn, that turn ends there and then.
  'janor-device': {
    actions: [{
      id: 'adjust', label: 'Add or subtract 1 from the roll', timing: ['roll'], usesToken: false, needs: { modes: ['plus', 'minus'] }, ai: 'boostAttack',
      check(s, pl, self, p, ctx) {
        if (!active(s, self) || s.cards[self].controller !== pl) return 'Not yours to use.';
        if (!ctx?.roll || ctx.attackerPlayer !== pl) return 'Only the attacker holding the Device may adjust his own roll.';
        if (ctx.plays.some((pp) => pp.ability === self)) return 'Already used on this roll.';
        if (p.mode !== 'plus' && p.mode !== 'minus') return 'Choose to add or subtract 1.';
        return null;
      },
      apply(_s, _pl, _self, p) { return { t: 'delta' as const, value: p.mode === 'plus' ? 1 : -1 }; },
    }],
    onAttackEnd(s, self, ctx) {
      const pl = s.cards[self].controller;
      if (!active(s, self) || pl !== ctx.attackerPlayer || !ctx.roll) return;
      const raw = ctx.roll[0] + ctx.roll[1];
      if (raw !== 11 && raw !== 12) return;
      if (activePlayer(s).id === pl) { s.phase = 'endOfTurn'; s.turnFlags.endedAtOnce = true; }
      const rivals = livePlayers(s).filter((x) => x.id !== pl);
      if (!rivals.length) return;
      let rolls = rivals.map((r) => ({ r, v: roll2d6(s).reduce((a, b) => a + b) }));
      for (;;) {
        rolls.sort((a, b) => b.v - a.v);
        const tied = rolls.filter((x) => x.v === rolls[0].v);
        if (tied.length === 1) break;
        rolls = tied.map((x) => ({ r: x.r, v: roll2d6(s).reduce((a, b) => a + b) }));
      }
      const winner = rolls[0].r;
      Object.assign(s.cards[self], { controller: winner.id, linkedTo: winner.illuminati });
      log(s, `${cardName(s, self)}: a natural ${raw} sends it to ${winner.name} after a roll-off.`, pl);
    },
  },

  // RULING: "one of your Personalities" is modelled the way this engine models "you choose one card
  // of a kind to benefit", i.e. it is the Personality the Meter is linked to (a Resource always links
  // to one Group of the controller's choosing already).
  'martyr-meter': {
    linkTo: (s, _self, g) => def(s, g).subtype === 'Personality',
    extraTokens(s, self, iid) { return active(s, self) && linked(s, self) === iid ? 1 : 0; },
    // Anyone holding the Martyr Meter is safe from Random Jesii (whichever card ends up implementing it).
    immune(s, self, target, source) {
      return s.cards[source]?.cardId === 'random-jesii' && s.cards[target]?.controller === controllerOf2(s, self);
    },
  },

  'sacred-stencil': {
    actions: [{
      id: 'boost', label: '+5 defense against an Attack to Destroy', timing: ['attack'], usesToken: false, ai: 'boostDefense',
      check(s, pl, self, _p, ctx) {
        if (!active(s, self) || s.cards[self].controller !== pl) return 'Not yours to use.';
        if (!ctx || ctx.type !== 'destroy' || ctx.targetPlayer !== pl) return "Only against an Attack to Destroy on a Group of yours.";
        // RULING: the printed "(in standard INWO, also against Instant attacks)" is read as: the pure
        // stand-alone SubGenius game keeps this Resource to ordinary Attacks to Destroy; a mixed game
        // gets the wider, explicitly-called-out version that also helps against Instant attacks.
        if (ctx.instant && sgRules(s)) return 'Not against Instant attacks in the stand-alone SubGenius game.';
        return null;
      },
      apply(s, pl, self, _p, ctx) {
        ctx!.defenseBonus.push({ player: pl, plot: self, amount: 5, label: cardName(s, self) });
      },
    }],
  },

  // RULING: "the top three cards of any two decks in the game" would need a much larger targeting UI
  // (any player's Plot or Group deck); this looks at the caster's own two decks instead, which is by
  // far the most common table use, or lets him look at one rival's Plot hand.
  'the-prescriptures': {
    hasAction: false,
    actions: [{
      id: 'foresee', label: 'Look ahead: two decks, or a rival\'s Plots', timing: ['anytime'], usesToken: false, oncePerTurn: true,
      needs: { modes: ['decks', 'hand'], target: 'rival', helpers: true },
      check(s, pl, self, p) {
        if (!active(s, self) || s.cards[self].controller !== pl) return 'Not yours to use.';
        const ill = player(s, pl).illuminati;
        const usingIll = p.payWith?.length === 1 && p.payWith[0] === ill && s.cards[ill].tokens >= 1;
        const personalities = structureCards(s, pl).filter((g) => def(s, g).subtype === 'Personality');
        const usingAll = !usingIll && personalities.length > 0 && !!p.payWith && p.payWith.length === personalities.length
          && personalities.every((g) => p.payWith!.includes(g) && s.cards[g].tokens >= 1);
        if (!usingIll && !usingAll) return "Pay with your Illuminati's action, or the actions of all your Personalities (at least one).";
        if (p.mode === 'hand') {
          // needs.target 'rival': p.target is that rival's Illuminati card, not a player id.
          const rival = p.target ? s.cards[p.target]?.controller : undefined;
          if (!rival || rival === pl || def(s, p.target!).type !== 'Illuminati') return 'Choose a rival.';
          return null;
        }
        if (p.mode !== 'decks') return 'Choose to look at two decks, or a rival\'s Plots.';
        return null;
      },
      apply(s, pl, self, p) {
        for (const g of p.payWith!) s.cards[g].tokens--;
        if (p.mode === 'hand') {
          const rival = s.cards[p.target!].controller!;
          revealTo(s, pl, plotsInHand(s, rival), `${cardName(s, self)}: ${player(s, rival).name}'s Plots`);
          return;
        }
        const plotTop = plotDeckOf(s, pl).slice(0, 3);
        const groupTop = groupDeckOf(s, pl).slice(0, 3);
        revealTo(s, pl, [...plotTop, ...groupTop], `${cardName(s, self)}: the top of your decks`);
      },
    }],
  },

  // Does not stack with another Resource of its kind raising the Illuminati's own Power (RULING: no
  // other card in this batch does so; a future one should check for this card the same way).
  'the-true-pipe': {
    powerMod(s, self, iid) { const pl = controllerOf2(s, self); return active(s, self) && pl && iid === player(s, pl).illuminati ? 2 : 0; },
    globalMod(s, self, iid) { const pl = controllerOf2(s, self); return active(s, self) && pl && iid === player(s, pl).illuminati ? 2 : 0; },
  },

  'three-fisted-tales-of-bob': {
    linkTo: (s, _self, g) => def(s, g).subtype === 'Place' && attributes(s, g).includes('SubGenius'),
    powerMod(s, self, iid) { return active(s, self) && linked(s, self) === iid ? 2 : 0; },
    // "Global Power equal to its new Power": computed from printed values only (never power()/globalPower()
    // of the target, which would recurse) — the target's printed Power plus this card's own +2.
    globalMod(s, self, iid) {
      if (!active(s, self) || linked(s, self) !== iid) return 0;
      const d = def(s, iid);
      return (d.power ?? 0) + 2 - (d.globalPower ?? 0);
    },
  },
});

// =================================================================== Goals

/** Groups (not the Illuminati) that count toward a Goal: not a Devastated Place or anything under one. */
function countedGroups(s: GameState, pl: string): string[] {
  return structureCards(s, pl).filter((iid) => {
    let c = s.cards[iid];
    for (;;) { if (c.devastated) return false; if (!c.master) return true; c = s.cards[c.master]; }
  });
}
const subgenius3 = (s: GameState, iid: string) => attributes(s, iid).includes('SubGenius') && power(s, iid, { goals: true }) >= 3;

registerGoals({
  // Instead of an ordinary declared victory, this reads on the elimination rule itself: showing Arise!
  // spares its holder from going out for having no puppets, until the end of that turn (see
  // checkElimination in game.ts). It never shows up as something to declare.
  'arise': () => null,

  'brag-of-the-subgenius': (s, pl) =>
    (goalCount(s, pl, (iid) => subgenius3(s, iid)) >= goalNeeded(s, pl) ? 'controls enough Groups, counting Power 3+ SubGenius Groups twice' : null),

  // RULING: "eliminate a player of your own Illuminati by taking their last Group" is read with the
  // engine's existing elimination credit (eliminatedBy), which does not distinguish a capture from a
  // destruction; the printed "taking" is the common case, since one faction rarely destroys another's
  // last Group outright rather than absorbing it.
  'cast-out-false-prophets': (s, pl) => {
    const ill = s.cards[player(s, pl).illuminati].cardId;
    const victim = s.players.find((x) => x.eliminated && x.eliminatedBy === pl && s.cards[x.illuminati].cardId === ill);
    return victim ? `eliminated ${victim.name}, a faction of the same Illuminati` : null;
  },

  // RULING: "cannot be combined with another Goal" gets no extra enforcement beyond the usual one-Goal-
  // card hand limit, the same as every other base-game Goal carrying this same printed line.
  'science-cannot-remove-the-terror-of-the-gods': (s, pl) => {
    const destroyed = player(s, pl).destroyedCredit.filter((iid) => scienceOrChurch(s, iid)).length;
    const controlled = countedGroups(s, pl).filter((iid) => isGroup(s, iid) && attributes(s, iid).includes('Church')).length;
    const combo = [[2, 5], [3, 4], [4, 3], [5, 2], [6, 1]].find(([d, c]) => destroyed >= d && controlled >= c);
    return combo ? `destroyed ${destroyed} Science or Church Groups and controls ${controlled} Church Groups` : null;
  },

  'the-anti-bob': (s, pl) => {
    const controlled = countedGroups(s, pl).filter((iid) => isGroup(s, iid) && attributes(s, iid).includes('SubGenius')).length;
    const destroyed = player(s, pl).destroyedCredit.filter((iid) => {
      const d = def(s, iid);
      return (d.attributes ?? []).includes('SubGenius') || (d.alignments ?? []).includes('Weird');
    }).length;
    return controlled >= 6 && destroyed >= 2 ? `controls ${controlled} SubGenius Groups and destroyed ${destroyed} rivals' SubGenius or Weird Groups` : null;
  },
});

function scienceOrChurch(s: GameState, iid: string): boolean {
  const d = def(s, iid);
  return (d.attributes ?? []).includes('Science') || (d.attributes ?? []).includes('Church');
}

registerGoalProgress({
  'brag-of-the-subgenius': (s, pl) => Math.min(1, goalCount(s, pl, (iid) => subgenius3(s, iid)) / Math.max(1, goalNeeded(s, pl))),
  'the-anti-bob': (s, pl) => {
    const controlled = countedGroups(s, pl).filter((iid) => isGroup(s, iid) && attributes(s, iid).includes('SubGenius')).length;
    const destroyed = player(s, pl).destroyedCredit.filter((iid) => {
      const d = def(s, iid);
      return (d.attributes ?? []).includes('SubGenius') || (d.alignments ?? []).includes('Weird');
    }).length;
    return Math.min(1, controlled / 6, destroyed / 2);
  },
});

registerGoalExposeBonus({
  // A once-per-game, self-chosen exposure: +1 Illuminati token, and the card can never be hidden or
  // discarded again (`lockedInHand` is read by the 'discard' action in game.ts).
  'the-anti-bob': (s, pl, card) => {
    if (s.cards[card].exposed) throw new RuleError('Already exposed.');
    s.cards[card].exposed = true;
    s.cards[card].data = { ...s.cards[card].data, lockedInHand: true };
    s.cards[player(s, pl).illuminati].tokens++;
    log(s, `${player(s, pl).name} exposes The Anti"Bob" for an extra Illuminati token; it can never be hidden again.`, pl);
  },
});

// ---------------------------------------------------------------- Group cards also playable as Plots

registerPlots({
  // RULING: "the False Prophets" is read as flavor for whichever rival is being attacked (the card
  // names no specific card of its own); the narrower "unless directly controlled by the Illuminati"
  // carve-out on the master clause is folded into simply boosting any Attack to Destroy on a rival.
  'cast-out-false-prophets': {
    timing: ['attack'],
    check(s, pl, _play, ctx: AttackCtx | undefined) {
      if (!ctx || ctx.type !== 'destroy') return 'Use this on an Attack to Destroy.';
      if (!ctx.targetPlayer || ctx.targetPlayer === pl) return "Choose an Attack to Destroy on a rival's Group.";
      return null;
    },
    apply(s, pl, play, ctx) {
      ctx!.attackBonus.push({ player: pl, plot: play.card, amount: 10, label: cardName(s, play.card) });
    },
  },
  'nhgh': {
    timing: ['attack'],
    check(s, pl, _play, ctx: AttackCtx | undefined) {
      if (sgRules(s)) return 'NHGH is only played this way when there is no uncontrolled area.';
      if (!ctx || ctx.type !== 'destroy') return 'Use this on an Attack to Destroy.';
      if (!ctx.targetPlayer || ctx.targetPlayer === pl) return "Choose an Attack to Destroy on a rival's Group.";
      return null;
    },
    apply(s, pl, play, ctx) {
      ctx!.attackBonus.push({ player: pl, plot: play.card, amount: 5, label: cardName(s, play.card) });
      const rival = ctx!.targetPlayer!;
      Object.assign(s.cards[play.card], { zone: 'hand', controller: undefined, owner: rival });
      player(s, rival).hand.push(play.card);
      log(s, `${cardName(s, play.card)} goes to ${player(s, rival).name}, as its own price.`, pl);
    },
  },
});
