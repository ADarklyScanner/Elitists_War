// Assassins pack, batch "assassins2" (docs/EXPANSIONS.md, docs/CARD_SCRIPTING.md "Expansions"):
// three Places (Al Amarja, Australia, Illuminati University), ten Resources (Black Helicopters,
// Blivit, Killer Satellite, Lenin's Body, Orgone Grinder, Power Satellite, Screaming Meme, Spy
// Satellite, The Big Prawn, X-Ray Specs), one Assassination (Spontaneous Combustion), four Disasters
// (Drought, Flesh-Eating Bacteria, No Beer!, Oil Spill), three Goals (Blinded by Science, Earth
// First!, Population Reduction) and four NWOs (Antitrust Legislation, Apathy, Australian Rules, End
// of the World).
import type { Alignment, AttackCtx, GameState, PlotPlay, Side } from '../types';
import type { PlotHandler } from '../plotTypes';
import { registerAbilities } from '../abilities';
import { registerHooks, registerChoice, HOOKS, anyHook, paralyzedGroups, type AbilityParams } from '../hooks';
import { abilitiesOf } from '../abilities';
import { registerPlots, registerGoals } from '../plotTypes';
import { def, cardName, OPPOSITE } from '../cards';
import { attributes, alignments, power } from '../stats';
import { structureCards, puppets, subtree } from '../geometry';
import { nextRandom, shuffle } from '../rng';
import {
  activePlayer, announcedAction, canExpose, exposeCards, raiseEvent, revealTo, announcedActors, askChoice, attackCancelled, cancelActorEffect, canAttackPlayer, controllerOf2,
  discardCard, disasterTarget, drawGroup, drawPlot, endTurnCleanup, goalAlignWeight, goalNeeded, goalTally, isParalyzed, localTime, log,
  movableSides, moveSubtree, noteCostDiscard, player, respondToAction, startCardAttack, startInstantAttack, syncConditions, tokenBarred,
} from '../game';
import { cardRoll, registerRollResult } from '../game';
import { plotDeckOf, groupDeckOf } from '../expansions';
import { assassinationPlot } from './families';
import { nwoColor } from '../nwo';

// ---------------------------------------------------------------- helpers

const own = (s: GameState, pl: string, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure' && s.cards[iid].controller === pl;
const isGroup = (s: GameState, iid?: string) => !!iid && def(s, iid).type === 'Group';
const isResource = (s: GameState, iid?: string) => !!iid && def(s, iid).type === 'Resource';
const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';
const place = (s: GameState, iid?: string) => !!iid && def(s, iid).subtype === 'Place';
const personality = (s: GameState, iid?: string) => !!iid && def(s, iid).subtype === 'Personality';
const hasAlign = (s: GameState, iid: string, ...al: Alignment[]) => al.some((a) => alignments(s, iid).includes(a));
const hasAttr = (s: GameState, iid: string, ...at: string[]) => at.some((a) => attributes(s, iid).includes(a));
const ctrl = (s: GameState, self: string) => controllerOf2(s, self);
const active = (s: GameState, self: string) => s.cards[self]?.zone === 'resources' && !!s.cards[self].controller && !s.cards[self].hiddenUnder;

/** The Group this Resource is linked to (undefined while it is linked to the Illuminati, i.e. unlinked). */
function linkedGroup(s: GameState, self: string): string | undefined {
  const l = s.cards[self].linkedTo;
  return l && inPlay(s, l) && isGroup(s, l) && s.cards[l].controller === s.cards[self].controller ? l : undefined;
}
/** Only the first copy (lowest instance id) of a card among those linked to `iid` counts (one bonus per Place: Power Satellite). */
function firstLinked(s: GameState, iid: string, cardId: string): string | undefined {
  return Object.values(s.cards).filter((c) => c.zone === 'resources' && c.linkedTo === iid && c.cardId === cardId).map((c) => c.iid).sort()[0];
}
/** An attack bonus/defense entry from an activated ability (cannot be cancelled by a Plot's cancelPlot). */
const abilityEntry = (s: GameState, self: string, id: string) => `ability:${self}:${id}:${s.version}`;

/** Move a player's whole Plot or Group deck top card to their discard pile. */
function discardDeckTop(s: GameState, pl: string, deck: 'plot' | 'group') {
  const arr = deck === 'plot' ? plotDeckOf(s, pl) : groupDeckOf(s, pl);
  const top = arr.shift();
  if (top) discardCard(s, top);
  return top;
}

// ================================================================== Groups (Places)

registerAbilities({
  'al-amarja': [],
  'australia': [],
  'illuminati-university': [],
});

const alAmarjaCovers = (s: GameState, self: string, target: string) =>
  target === self || target === s.cards[self].master || s.cards[target]?.master === self;

registerHooks({
  // Its controller is unaffected by I Lied (see hooks.ts `immuneToLie`, consulted from deals.ts).
  'al-amarja': {
    immuneToLie: (s, self, victim) => ctrl(s, self) === victim,
    actions: [{
      id: 'burn-plot',
      label: 'Discard the top card of your Plot deck for +4 defense',
      timing: ['attack'],
      usesToken: false,
      ai: 'boostDefense',
      check(s, pl, self, _p, ctx) {
        if (!ctx || !ctx.disaster) return 'Only while a Disaster is being resolved.';
        if (ctrl(s, self) !== pl) return 'Only its controller may do this.';
        if (!alAmarjaCovers(s, self, ctx.target)) return `Only while a Disaster strikes ${cardName(s, self)}, its master or a puppet.`;
        if (!plotDeckOf(s, pl).length) return 'Your Plot deck is empty.';
        return null;
      },
      apply(s, pl, self, _p, ctx) {
        discardDeckTop(s, pl, 'plot');
        ctx!.defenseBonus.push({ player: pl, plot: abilityEntry(s, self, 'burn-plot'), forGroup: self, amount: 4, label: 'Al Amarja (a Plot discarded)' });
        log(s, `${player(s, pl).name} discards the top card of their Plot deck: Al Amarja +4 defense.`, pl);
      },
    }],
  },

  // While controlled, its printed Resistance counts double, or four times on a weekend or after 5 p.m.
  // local time: the engine reads the clock of Australia's controller (his reported time zone, or the
  // device's clock) at the start of every action and records the answer on the card, so an attack keeps
  // the value it started with and a saved game replays the same way (game.ts localClock / localTime).
  // RULING: "a national holiday in the country where you are playing" cannot be known by the software:
  // that single case is not applied (no day counts as a holiday). Its own +10 against Attacks to Destroy,
  // and its controller's other Organizations' +4, follow the Assassins FAQ ruling on Australia: since
  // the card does not mention Instants, neither bonus helps against a Disaster (Disasters are also
  // `type: 'destroy'` attacks in the engine).
  'australia': {
    beforeAction(s, self) {
      const pl = ctrl(s, self);
      if (!pl || s.attack || s.cards[self].zone !== 'structure') return;
      const { day, hour } = localTime(s, pl);
      const party = day === 0 || day === 6 || hour >= 17;
      if (Boolean(s.cards[self].data?.partyTime) !== party) s.cards[self].data = { ...s.cards[self].data, partyTime: party || undefined };
    },
    resistanceMod: (s, self, iid) => (iid === self && Boolean(s.cards[self].controller) ? (def(s, self).resistance ?? 0) * (s.cards[self].data?.partyTime ? 3 : 1) : 0),
    attackMod(s, self, ctx, side) {
      if (side !== 'defense' || ctx.disaster || ctx.type !== 'destroy' || !s.cards[self].controller) return 0;
      if (ctx.target === self) return 10;
      if (ctx.target !== self && def(s, ctx.target).type === 'Group' && def(s, ctx.target).subtype === 'Organization' && s.cards[ctx.target].controller === ctrl(s, self)) return 4;
      return 0;
    },
  },

  // It, its master and its puppets are immune to Disasters and to Straight/Government Groups (Assassins
  // Card FAQ: only IOU itself and its own puppets, not the whole Power Structure, even when its master
  // is the Illuminati). Tuition is paid at the end of every turn in the game (askChoice; see below).
  'illuminati-university': {
    immune(s, self, target, source) {
      if (!(target === self || target === s.cards[self].master || s.cards[target]?.master === self)) return false;
      if (def(s, source).subtype === 'Disaster') return true;
      return def(s, source).type === 'Group' && hasAlign(s, source, 'Straight', 'Government');
    },
    attackMod(s, self, ctx, side) {
      if (side !== 'defense') return 0;
      const covers = ctx.target === self || ctx.target === s.cards[self].master || s.cards[ctx.target]?.master === self;
      if (!covers) return 0;
      const bySource = ctx.disaster || (!!ctx.attacker && isGroup(s, ctx.attacker) && hasAlign(s, ctx.attacker, 'Straight', 'Government'));
      return bySource ? 999 : 0;
    },
    onAttackEnd(s, self, ctx) {
      const covers = ctx.target === self || ctx.target === s.cards[self].master || s.cards[ctx.target]?.master === self;
      if (covers && ctx.disaster && ctx.tokenTaken && !attackCancelled(ctx) && s.cards[self].zone === 'structure') {
        s.cards[self].tokens++;
        log(s, `${cardName(s, self)} is immune to Disasters.`);
      }
    },
    onTurnEnd(s, self) {
      if (s.cards[self].zone !== 'structure') return;
      const data = s.cards[self].data ?? {};
      if (data.tuitionTurn === s.turn) return;
      const pl = ctrl(s, self);
      if (!pl) return;
      const p = player(s, pl);
      const options: { id: string; label: string }[] = [];
      for (const iid of p.hand) {
        const t = def(s, iid).type;
        if (t === 'Plot' || t === 'Illuminati' || t === 'Group' || t === 'Resource') options.push({ id: `hand:${iid}`, label: `Discard ${cardName(s, iid)} (from hand)` });
      }
      if (plotDeckOf(s, pl).length) options.push({ id: 'topPlot', label: 'Discard the top card of your Plot deck' });
      if (groupDeckOf(s, pl).length) options.push({ id: 'topGroup', label: 'Discard the top card of your Group deck' });
      options.push({ id: 'discardIOU', label: 'Discard Illuminati University (its puppets return to your hand)' });
      askChoice(s, pl, {
        key: 'iou-tuition',
        question: 'Pay tuition for Illuminati University: discard a Plot or Group card (from hand or the top of a deck), or give up the University.',
        options, min: 1, max: 1, data: { iou: self },
      });
      return true;
    },
  },
});

registerChoice('iou-tuition', {
  resolve(s, pl, picked, data) {
    const iou = data.iou as string;
    if (s.cards[iou]) s.cards[iou].data = { ...s.cards[iou].data, tuitionTurn: s.turn };
    const id = picked[0];
    const p = player(s, pl);
    if (id === 'discardIOU' && s.cards[iou]?.zone === 'structure') {
      log(s, `${p.name} cannot pay tuition and discards Illuminati University; its puppets return to hand.`, pl);
      const controller = s.cards[iou].controller ?? pl;
      for (const pup of puppets(s, iou)) {
        for (const g of subtree(s, pup)) {
          const gc = s.cards[g];
          Object.assign(gc, { zone: 'hand', controller: undefined, master: undefined, x: undefined, y: undefined, side: undefined, tokens: 0 });
          player(s, controller).hand.push(g);
        }
      }
      discardCard(s, iou);
    } else if (id === 'topPlot') {
      const top = discardDeckTop(s, pl, 'plot');
      if (top) log(s, `${p.name} pays tuition: the top card of the Plot deck is discarded.`, pl);
    } else if (id === 'topGroup') {
      const top = discardDeckTop(s, pl, 'group');
      if (top) log(s, `${p.name} pays tuition: the top card of the Group deck is discarded.`, pl);
    } else if (id.startsWith('hand:')) {
      const card = id.slice(5);
      if (p.hand.includes(card)) { log(s, `${p.name} pays tuition: discards ${cardName(s, card)}.`, pl); discardCard(s, card); }
    }
    endTurnCleanup(s);
  },
  ai(s, _pl, options) {
    const pick = options.find((o) => o.id === 'topPlot') ?? options.find((o) => o.id === 'topGroup') ?? options.find((o) => o.id.startsWith('hand:')) ?? options.find((o) => o.id === 'discardIOU')!;
    return [pick.id];
  },
});

// ================================================================== Resources

/** Secret or Government (the two alignments Black Helicopters may link to and must keep). */
const secretOrGovernment = (s: GameState, iid: string) => hasAlign(s, iid, 'Government') || hasAttr(s, iid, 'Secret');

registerHooks({
  // Unique. Linked for good to a Secret or Government Group: all its attacks are Privileged; discarded
  // the moment the linked Group is neither any more (checked after every action via `linkTo`-style
  // condition below, mirrored so an already-linked Group that changes stops qualifying).
  'black-helicopters': {
    linkTo: (s, _self, g) => secretOrGovernment(s, g),
    linkStillLegal: (s, _self, g) => secretOrGovernment(s, g),
    onAttackStart(s, self, ctx) {
      const g = linkedGroup(s, self);
      if (g && ctx.attacker === g && !ctx.instant && secretOrGovernment(s, g)) ctx.privileged = true;
    },
  },
});

registerHooks({
  // Its action cancels another Resource's action that still holds an Action token. Only one may be in
  // play (not Unique): a newly played one destroys the old one, cancelling its just-used action too.
  'blivit': {
    hasAction: true,
    onEnterPlay(s, self) {
      const old = Object.values(s.cards).find((c) => c.iid !== self && c.cardId === 'blivit' && c.zone === 'resources');
      if (!old) return;
      // If the old one has just used its action, that action is cancelled.
      const e = announcedAction(s);
      const used = Boolean(e) && (e!.responses ?? []).some((r) => r.ability === old.iid);
      if (e && used) {
        const eff = cancelActorEffect(e, old.iid);
        if (eff) respondToAction(s, ctrl(s, self) ?? old.controller ?? old.owner, self, eff, true);
      }
      log(s, `A new Blivit is built: the old one is destroyed and discarded${used ? ', and the action it just used is cancelled' : ''}.`);
      discardCard(s, old.iid);
    },
    // Its owner is immune to the Nuclear Power Companies (Card FAQ: they cannot cancel his attack, nor any
    // other action of his cards). The Nuclear Power Companies' cancel checks this (below).
    immune: (s, self, target, source) => s.cards[source]?.cardId === 'nuclear-power-companies' && Boolean(ctrl(s, self)) && Boolean(s.cards[target]) && controllerOf2(s, target) === ctrl(s, self),
    actions: [{
      id: 'jam', label: "Cancel another Resource's action", timing: ['event'], events: ['action'], usesToken: true, ai: 'never',
      needs: { target: 'resource' },
      listens(s, pl, self, e) {
        if (e.type !== 'action' || !e.player || e.player === pl) return false;
        return announcedActors(e).some((a) => a !== self && isResource(s, a) && Boolean(HOOKS[s.cards[a].cardId]?.hasAction));
      },
      check(s, _pl, self, p) {
        const e = announcedAction(s);
        if (!e) return "Use this right after another Resource's action is announced.";
        const t = p.target;
        if (!t || t === self || !isResource(s, t) || !announcedActors(e).includes(t)) return "Choose another Resource that is using its action right now.";
        // "If a Resource does not have Action tokens, the Blivit cannot affect it."
        if (!HOOKS[s.cards[t].cardId]?.hasAction) return `${cardName(s, t)} has no Action tokens, so the Blivit cannot affect it.`;
        return null;
      },
      apply: (s, _pl, _self, p) => cancelActorEffect(announcedAction(s)!, p.target!) ?? { t: 'none' },
    }],
  },
});

// The Nuclear Power Companies (a base card, groups1.ts) cannot cancel an action of a player immune to
// them (Blivit): added here at load time, like the Liquor Companies' No Beer! use below.
{
  const npc = HOOKS['nuclear-power-companies']?.actions?.find((a) => a.id === 'cancelAction');
  if (npc) {
    const { check, listens } = npc;
    const shielded = (s: GameState, self: string, t?: string) => Boolean(t) && Boolean(s.cards[t!]) && anyHook(s, (h, me) => Boolean(h.immune?.(s, me, t!, self)));
    npc.check = (s, pl, self, p, ctx) => (shielded(s, self, p.target) ? `${cardName(s, p.target!)} is immune to ${cardName(s, self)}.` : check(s, pl, self, p, ctx));
    if (listens) npc.listens = (s, pl, self, e) => listens(s, pl, self, e) && announcedActors(e).some((g) => !shielded(s, self, g));
  }
}

const SATELLITE_TARGETS = (s: GameState, iid: string) => def(s, iid).name.includes('Satellite') || def(s, iid).id === 'orbital-mind-control-lasers';

/** Killer Satellite's strike, once decided: the target (and any action it had announced) and perhaps itself. */
function satelliteStrike(s: GameState, pl: string, self: string, t: string, killsTarget: boolean, killsSelf: boolean) {
  if (killsTarget && s.cards[t]?.zone === 'resources') {
    log(s, `${cardName(s, t)} is destroyed.`, pl);
    const e = announcedAction(s);
    if (e && announcedActors(e).includes(t)) respondToAction(s, pl, self, { t: 'cancelGroup', group: t }, true);
    destroyResource(s, t, pl);
  }
  if (killsSelf && s.cards[self]?.zone === 'resources') { log(s, 'Killer Satellite is destroyed.', pl); destroyResource(s, self, pl); }
}
registerRollResult({
  'killer-satellite'(s, pl, total, _dice, d) {
    const self = d.self as string, t = d.target as string;
    const isOmcl = s.cards[t]?.cardId === 'orbital-mind-control-lasers';
    log(s, `Killer Satellite rolls ${total} against ${cardName(s, t)}.`, pl);
    satelliteStrike(s, pl, self, t, total <= 3 || (total === 4 && !isOmcl) || total === 5, total >= 5 || (total === 4 && isOmcl));
  },
});

registerHooks({
  // Its action tries to destroy a Satellite Resource or the Orbital Mind Control Lasers (any action that
  // target had just announced is cancelled). Discard it for a sure kill, or roll a die. Or +5 to an
  // attack on a Space Place, or discard it with its token for +15 to destroy one.
  'killer-satellite': {
    hasAction: true,
    actions: [
      {
        // Mode 'roll' rolls a die as printed; mode 'sure' is the sure kill: the Killer Satellite is discarded.
        id: 'strike', label: 'Try to destroy a Satellite Resource (or the Orbital Mind Control Lasers)', timing: ['anytime', 'event'], events: ['action'], usesToken: true, ai: 'never',
        needs: { target: 'resource', modes: ['roll', 'sure'] },
        listens: (s, pl, self, e) => e.type === 'action' && announcedActors(e).some((a) => a !== self && SATELLITE_TARGETS(s, a)),
        check(s, _pl, self, p) {
          const t = p.target;
          if (!t || t === self || !isResource(s, t) || s.cards[t].zone !== 'resources' || !SATELLITE_TARGETS(s, t)) return 'Choose a Satellite Resource (or the Orbital Mind Control Lasers) in play.';
          return null;
        },
        apply(s, pl, self, p) {
          const t = p.target!;
          if (p.mode === 'sure') {
            log(s, `Killer Satellite is discarded for a sure kill on ${cardName(s, t)}.`, pl);
            discardCard(s, self);
            satelliteStrike(s, pl, self, t, true, false);
            return;
          }
          // The roll is announced (cardRoll), so cards that change any die roll may answer it; used during
          // an attack or in answer to an action, it is answered there and then (held), before it counts.
          cardRoll(s, pl, 1, 'killer-satellite', { self, target: t }, { quiet: true, hold: true, label: 'Killer Satellite' });
        },
      },
      {
        id: 'boost', label: '+5 to an attack on a Space Place', timing: ['attack'], usesToken: true, ai: 'boostAttack',
        check: (s, _pl, self, _p, ctx) => (ctx && ctx.type === 'destroy' && place(s, ctx.target) && hasAttr(s, ctx.target, 'Space') ? null : 'Use this against an attack on a Space Place.'),
        apply(s, pl, self, _p, ctx) { ctx!.attackBonus.push({ player: pl, plot: abilityEntry(s, self, 'boost'), forGroup: self, amount: 5, label: 'Killer Satellite' }); },
      },
      {
        id: 'sacrifice', label: 'Discard it (with its Action token) for +15 to destroy a Space Place', timing: ['attack'], usesToken: true, ai: 'never',
        check: (s, _pl, self, _p, ctx) => (ctx && ctx.type === 'destroy' && place(s, ctx.target) && hasAttr(s, ctx.target, 'Space') ? null : 'Use this against an attack to destroy a Space Place.'),
        apply(s, pl, self, _p, ctx) {
          ctx!.attackBonus.push({ player: pl, plot: abilityEntry(s, self, 'sacrifice'), forGroup: self, amount: 15, label: 'Killer Satellite (discarded)' });
          discardCard(s, self);
        },
      },
    ],
  },

  // Unique. Link to any Group: +5 on its direct Attacks to Control Communist Groups; a Communist Group
  // linked to it has Global Power equal to its Power (printed value, to avoid a recursive computation).
  'lenin-s-body': {
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || ctx.type !== 'control' || ctx.instant) return 0;
      const g = linkedGroup(s, self);
      return g && ctx.attacker === g && isGroup(s, ctx.target) && hasAttr(s, ctx.target, 'Communist') ? 5 : 0;
    },
    globalMod(s, self, iid) {
      const g = linkedGroup(s, self);
      return g === iid && hasAttr(s, iid, 'Communist') ? def(s, iid).power ?? 0 : 0;
    },
  },

  // Unique. Link to a Personality you control: Power 6, Resistance 10, no alignments or attributes and
  // gains none, overriding every other card (`lastWord`: its change is applied after every other card's).
  'orgone-grinder': {
    lastWord: true,
    linkTo: (s, _self, g) => personality(s, g),
    powerMod: (s, self, iid) => (linkedGroup(s, self) === iid ? 6 - (def(s, iid).power ?? 0) : 0),
    resistanceMod: (s, self, iid) => (linkedGroup(s, self) === iid ? 10 - (def(s, iid).resistance ?? 0) : 0),
    alignmentMod: (s, self, iid, current) => (linkedGroup(s, self) === iid ? [] : current),
    attributeMod: (s, self, iid, current) => (linkedGroup(s, self) === iid ? [] : current),
  },

  // Link to a Space Place or a Nation: +2 Power and +5 to all its defenses, Disasters included. One per
  // Place (only the first-played copy on a given Place counts).
  'power-satellite': {
    linkTo: (s, _self, g) => place(s, g) && hasAttr(s, g, 'Space', 'Nation'),
    powerMod: (s, self, iid) => (linkedGroup(s, self) === iid && firstLinked(s, iid, 'power-satellite') === self ? 2 : 0),
    attackMod: (s, self, ctx, side) => (side === 'defense' && linkedGroup(s, self) === ctx.target && firstLinked(s, ctx.target, 'power-satellite') === self ? 5 : 0),
  },

  // Link to an Organization (not an Illuminati): it cannot be taken away or moved, and the Organization
  // cannot be destroyed by any means. Only one may be in play: a new one discards the old.
  'screaming-meme': {
    forbidIlluminatiLink: true,
    onEnterPlay(s, self) {
      const old = Object.values(s.cards).find((c) => c.iid !== self && c.cardId === 'screaming-meme' && c.zone === 'resources');
      if (old) { log(s, 'A new Screaming Meme drives out the old one, which is forgotten.'); discardCard(s, old.iid); }
    },
    linkTo(s, self, g) {
      const cur = s.cards[self].linkedTo;
      if (cur && def(s, cur).type !== 'Illuminati') return false; // already placed: never relinked
      return def(s, g).type === 'Group' && def(s, g).subtype === 'Organization';
    },
    preventDestroy: (s, self, target) => linkedGroup(s, self) === target,
  },

  // Its action, at any time: pick three Groups at random from a rival's hand, show them if wished and
  // give them back, or expose one random Plot in a rival's hand.
  'spy-satellite': {
    hasAction: true,
    actions: [{
      // Picks are random (the game's own dice, so a replay picks the same cards). After looking at the
      // Group cards its user may show them to everybody, or not.
      id: 'peek', label: "Look at three of a rival's Group cards, or expose one of their Plots", timing: ['anytime'], usesToken: true, ai: 'never',
      needs: { target: 'rival', modes: ['groups', 'plot'] },
      check(s, pl, _self, p) {
        const rival = p.target ? s.cards[p.target].controller : undefined;
        if (!rival || rival === pl || !s.players.some((x) => x.id === rival && !x.eliminated)) return "Choose a rival's Illuminati.";
        if (p.mode !== 'groups' && p.mode !== 'plot') return 'Choose whether to look at Groups or a Plot.';
        return null;
      },
      apply(s, pl, _self, p) {
        const rival = s.cards[p.target!].controller!;
        const hand = player(s, rival).hand;
        if (p.mode === 'plot') {
          const plots = hand.filter((c) => (def(s, c).type === 'Plot' || def(s, c).type === 'Illuminati') && !s.cards[c].exposed && canExpose(s, c));
          if (!plots.length) { log(s, `${player(s, rival).name} has no hidden Plot cards to expose.`, pl); return; }
          const pick = plots[Math.floor(nextRandom(s) * plots.length)];
          exposeCards(s, [pick]);
          log(s, `Spy Satellite exposes one of ${player(s, rival).name}'s Plot cards: ${cardName(s, pick)}.`, pl);
        } else {
          const groups = hand.filter((c) => def(s, c).type === 'Group' || def(s, c).type === 'Resource');
          const seen = shuffle(s, [...groups]).slice(0, 3);
          log(s, `${player(s, pl).name} uses Spy Satellite to look at ${seen.length} Group card${seen.length === 1 ? '' : 's'} picked at random from ${player(s, rival).name}'s hand.`, pl);
          revealTo(s, pl, seen, 'Spy Satellite shows you');
          if (seen.length) {
            askChoice(s, pl, {
              key: 'spy-satellite-show', min: 1, max: 1, data: { cards: seen, rival },
              question: `Show ${seen.map((c) => cardName(s, c)).join(', ')} to all players before they go back?`,
              options: [{ id: 'show', label: 'Show them to everybody' }, { id: 'keep', label: 'Keep what you saw to yourself' }],
            });
          }
        }
      },
    }],
  },

  // Unique. Link for good to a Coastal Place: double Power. As you link it you may add, remove or
  // reverse one of the Place's alignments for good (the alignment change stays even if the Prawn later
  // leaves play: Assassins Card FAQ). If the Place is destroyed the Prawn is destroyed with it (the base
  // rule already does this for any linked Resource); if the Place is only Devastated (which normally
  // leaves linked Resources alone) the Prawn is destroyed too, since the card says so explicitly.
  'the-big-prawn': {
    linkTo: (s, _self, g) => place(s, g) && hasAttr(s, g, 'Coastal'),
    forbidIlluminatiLink: true,
    powerMod: (s, self, iid) => (linkedGroup(s, self) === iid ? def(s, iid).power ?? 0 : 0),
    onEvent(s, self, e) {
      if (e.type !== 'devastated' || s.cards[self]?.zone !== 'resources') return;
      if (s.cards[self].linkedTo !== e.card) return;
      log(s, 'The Big Prawn is destroyed as its Place is Devastated.');
      discardCard(s, self);
    },
  },

  // Unique. Link to a Science Group: its action looks at the top three cards of one deck in play. A
  // Weird Science Group may look at the top three of two decks, or the top six of one.
  'x-ray-specs': {
    linkTo: (s, _self, g) => hasAttr(s, g, 'Science'),
    // The special ability belongs to the linked Group and spends ITS action, not a token of the card
    // itself (X-Ray Specs is not marked ACTION): `usesToken: false` here, and the Group's own token is
    // checked and spent by hand.
    // The top three undrawn cards of any deck in play (anyone's Plot or Group deck: `targets` names it as
    // '<player id>:plot' or '<player id>:group'). A Weird Science Group may instead look at the top three
    // of any two decks (two `targets`), or the top six of any one (`mode` 'six').
    actions: [{
      id: 'peek', label: "Spend the linked Group's action to look at the top cards of a deck", timing: ['main'], usesToken: false, ai: 'never',
      options(s, _pl, self) {
        const decks = xrayDecks(s);
        const out: { params: AbilityParams; label: string }[] = decks.map((d) => ({ params: { targets: [d] }, label: xrayDeckName(s, d) }));
        const g = linkedGroup(s, self);
        if (g && weirdScience(s, g)) {
          for (const d of decks) out.push({ params: { targets: [d], mode: 'six' }, label: `top six of ${xrayDeckName(s, d)}` });
          for (let i = 0; i < decks.length; i++) for (let j = i + 1; j < decks.length; j++) out.push({ params: { targets: [decks[i], decks[j]] }, label: `${xrayDeckName(s, decks[i])} and ${xrayDeckName(s, decks[j])}` });
        }
        return out;
      },
      check(s, pl, self, p) {
        const g = linkedGroup(s, self);
        if (!g || !own(s, pl, g)) return 'Link X-Ray Specs to your Science Group first.';
        if (s.cards[g].tokens < 1) return `${cardName(s, g)} has no Action token.`;
        const want = p.targets ?? [];
        if (!want.length || want.some((d) => !xrayDecks(s).includes(d))) return 'Choose a deck in play to look at.';
        const arrays = want.map((d) => xrayDeck(s, d));
        if (new Set(arrays).size !== arrays.length) return 'Choose two different decks.';
        const weird = weirdScience(s, g);
        if (want.length > 2 || (want.length === 2 && (!weird || p.mode === 'six'))) return 'Only a Weird Science Group may look at two decks.';
        if (p.mode === 'six' && !weird) return 'Only a Weird Science Group may look at the top six cards.';
        return null;
      },
      apply(s, pl, self, p) {
        const g = linkedGroup(s, self)!;
        s.cards[g].tokens--;
        const n = p.mode === 'six' ? 6 : 3;
        for (const d of p.targets!) {
          const seen = xrayDeck(s, d).slice(0, n);
          log(s, `${cardName(s, g)} spends its action: X-Ray Specs looks at the top ${seen.length} card${seen.length === 1 ? '' : 's'} of ${xrayDeckName(s, d)}.`, pl);
          revealTo(s, pl, seen, `X-Ray Specs, ${xrayDeckName(s, d)} (top to bottom)`);
        }
      },
    }],
  },
});

const weirdScience = (s: GameState, g: string) => hasAlign(s, g, 'Weird') && hasAttr(s, g, 'Science');
/** The decks in play, as '<player id>:plot' / '<player id>:group' (a shared SubGenius deck only once). */
function xrayDecks(s: GameState): string[] {
  const out: string[] = [];
  const seen = new Set<string[]>();
  for (const p of s.players) {
    if (p.eliminated) continue;
    for (const kind of ['plot', 'group'] as const) {
      const arr = kind === 'plot' ? plotDeckOf(s, p.id) : groupDeckOf(s, p.id);
      if (seen.has(arr)) continue;
      seen.add(arr);
      out.push(`${p.id}:${kind}`);
    }
  }
  return out;
}
function xrayDeck(s: GameState, d: string): string[] {
  const [pid, kind] = d.split(':');
  return kind === 'plot' ? plotDeckOf(s, pid) : groupDeckOf(s, pid);
}
function xrayDeckName(s: GameState, d: string): string {
  const [pid, kind] = d.split(':');
  const what = kind === 'plot' ? 'Plot' : 'Group';
  return s.common ? `the shared ${what} deck` : `${player(s, pid).name}'s ${what} deck`;
}
/** A Resource destroyed (not merely discarded): it goes to the destroyed pile, like one lost with its Group. */
function destroyResource(s: GameState, iid: string, by: string) {
  const c = s.cards[iid];
  if (c.zone !== 'resources') return;
  const owner = c.controller;
  Object.assign(c, { zone: 'destroyed', controller: undefined, linkedTo: undefined, tokens: 0, hiddenUnder: undefined });
  raiseEvent(s, { type: 'destroyed', card: iid, by, player: owner });
}
registerChoice('spy-satellite-show', {
  resolve(s, pl, picked, data) {
    if (picked[0] !== 'show') return;
    const cards = (data.cards as string[]).filter((c) => s.cards[c]);
    log(s, `${player(s, pl).name} shows everybody what the Spy Satellite saw in ${player(s, data.rival as string).name}'s hand: ${cards.map((c) => cardName(s, c)).join(', ')}.`, pl);
  },
  ai: () => ['keep'],
});

// ================================================================== Plots

// ---------------------------------------------------------------- Assassination

registerPlots({
  // Instant Attack to kill a Personality, no action needed. Power 10, 15 against a Magic Personality.
  // One Magic Group may spend its action to add its own Power (assassinationPlot's `helper`).
  'spontaneous-combustion': assassinationPlot({
    power: (s, target) => (hasAttr(s, target, 'Magic') ? 15 : 10),
    helper: { attributes: ['Magic'] },
  }),
});

// ---------------------------------------------------------------- Disasters

const reliefAbility = (s: GameState, iid: string) => HOOKS[s.cards[iid].cardId]?.actions?.some((a) => a.id === 'relief') ?? false;

registerPlots({
  // Attack to Destroy a Huge Place, no action, not Instant. Power 24 against a Coastal Place, 28
  // otherwise. Coastal Places, and Groups whose special ability sends Relief, may aid the defense.
  'drought': {
    timing: ['instant'],
    needs: { target: 'place' },
    check(s, pl, play) {
      if (s.phase !== 'main' || activePlayer(s).id !== pl || s.window || s.attack) return 'Play this as an attack in your own turn.';
      if (!disasterTarget(s, play.target) || !hasAttr(s, play.target!, 'Huge')) return 'Choose a Huge Place in play.';
      return canAttackPlayer(s, pl, s.cards[play.target!].controller);
    },
    apply(s, pl, play) {
      const p = hasAttr(s, play.target!, 'Coastal') ? 24 : 28;
      startCardAttack(s, pl, { plot: play.card, target: play.target!, power: p, disaster: { destroyMargin: 10 } });
    },
    joinRule: (s, _ctx, group, as) => (as === 'aid' && ((place(s, group) && hasAttr(s, group, 'Coastal')) || reliefAbility(s, group)) ? true : undefined),
  },

  // Attack to Destroy any Place, no action, not Instant, Power 20. Any Science Group may aid; the
  // Center for Disease Control adds triple its Power. Destroying it (margin > 8) lets a Science action
  // return the card to hand instead of it being discarded (official errata).
  'flesh-eating-bacteria': {
    timing: ['instant'],
    needs: { target: 'place' },
    check(s, pl, play) {
      if (s.phase !== 'main' || activePlayer(s).id !== pl || s.window || s.attack) return 'Play this as an attack in your own turn.';
      if (!disasterTarget(s, play.target)) return 'Choose a Place in play.';
      return canAttackPlayer(s, pl, s.cards[play.target!].controller);
    },
    apply(s, pl, play) {
      startCardAttack(s, pl, { plot: play.card, target: play.target!, power: 20, disaster: { destroyMargin: 8 } });
    },
    joinRule: (s, _ctx, group, as) => (as === 'aid' && hasAttr(s, group, 'Science') ? true : undefined),
    joinMultiplier: (s, _ctx, group) => (s.cards[group]?.cardId === 'center-for-disease-control' ? 3 : 1),
    // The player who played it "may" spend a Science action to take it back: he is asked which of his
    // Science Groups spends it, or whether to let the card go. It stays on the table meanwhile.
    onDisasterSuccess(s, ctx, destroyed) {
      if (!destroyed) return;
      const pl = ctx.attackerPlayer;
      const card = ctx.instantCard;
      const payers = febPayers(s, pl);
      if (!payers.length || !card || s.cards[card]?.zone !== 'table') return;
      s.cards[card].linkedTo = 'feb-choice';
      askChoice(s, pl, {
        key: 'feb-return', source: card, min: 1, max: 1, data: { card },
        question: 'Flesh-Eating Bacteria destroyed its target: spend a Science action to take the card back into your hand?',
        options: [...payers.map((g) => ({ id: g, label: `Yes: ${cardName(s, g)} spends its action` })), { id: 'no', label: 'No: discard it' }],
      });
    },
  },

  // Instant Attack to Destroy any Place, no action. Power 16 (24 against Australia, Germany or Texas; 8
  // against France or Italy). The Liquor Companies may spend their action to halve or double it. Can
  // only Devastate, never destroy.
  'no-beer': {
    timing: ['instant'],
    needs: { target: 'place' },
    check(s, _pl, play) { return disasterTarget(s, play.target) ? null : 'Choose a Place in play.'; },
    apply(s, pl, play) {
      const id = def(s, play.target!).id;
      const p = ['australia', 'germany', 'texas'].includes(id) ? 24 : ['france', 'italy'].includes(id) ? 8 : 16;
      startInstantAttack(s, pl, { plot: play.card, target: play.target!, power: p, disaster: { destroyMargin: null } });
    },
  },

  // Instant Attack to Destroy a Coastal Place, no action. Power 14 against a Huge Place, 18 otherwise.
  // Success (margin > 6) destroys it; either success lets every Green Group get an extra token, once
  // per player per game (official errata). Or +10 to an attack on OPEC or the Multinational Oil
  // Companies.
  'oil-spill': {
    timing: ['instant', 'attack'],
    needs: { target: 'place', mode: ['disaster', 'bonus'] },
    check(s, pl, play, ctx) {
      if ((play.mode ?? 'disaster') === 'bonus') {
        if (!ctx) return 'Use the +10 bonus during an attack.';
        if (!['opec', 'multinational-oil-companies'].includes(def(s, ctx.target).id)) return 'This bonus only helps an attack on OPEC or the Multinational Oil Companies.';
        return null;
      }
      if (!disasterTarget(s, play.target) || !hasAttr(s, play.target!, 'Coastal')) return 'Choose a Coastal Place in play.';
      return null;
    },
    apply(s, pl, play) {
      // Plays during an attack come here without ctx (Instant-capable Plot): use the attack in progress.
      if ((play.mode ?? 'disaster') === 'bonus') { s.attack?.attackBonus.push({ player: pl, plot: play.card, amount: 10, label: 'Oil Spill' }); return; }
      const p = hasAttr(s, play.target!, 'Huge') ? 14 : 18;
      startInstantAttack(s, pl, { plot: play.card, target: play.target!, power: p, disaster: { destroyMargin: 6 } });
    },
    onDisasterSuccess(s, ctx) {
      const pl = ctx.attackerPlayer;
      const p = player(s, pl);
      if (p.flags?.oilSpill) return;
      p.flags = { ...p.flags, oilSpill: true };
      let n = 0;
      for (const c of Object.values(s.cards)) {
        if (c.zone === 'structure' && isGroup(s, c.iid) && hasAttr(s, c.iid, 'Green')) { c.tokens++; n++; }
      }
      if (n) log(s, `Oil Spill: every Green Group gets an extra Action token (${n}).`, pl);
    },
  },
});

function febPayers(s: GameState, pl: string): string[] {
  return structureCards(s, pl).filter((iid) => isGroup(s, iid) && hasAttr(s, iid, 'Science') && s.cards[iid].tokens > 0 && !tokenBarred(s, iid));
}
registerChoice('feb-return', {
  resolve(s, pl, picked, data) {
    const card = data.card as string;
    if (s.cards[card]?.zone !== 'table') return;
    s.cards[card].linkedTo = undefined;
    const g = picked[0];
    if (g === 'no' || !febPayers(s, pl).includes(g)) { discardCard(s, card); return; }
    s.cards[g].tokens--;
    Object.assign(s.cards[card], { zone: 'hand', controller: undefined });
    player(s, pl).hand.push(card);
    log(s, `${cardName(s, g)} spends its action: Flesh-Eating Bacteria returns to ${player(s, pl).name}'s hand.`, pl);
  },
  // The computer takes the card back with its weakest Science Group.
  ai: (s, _pl, options) => [[...options].filter((o) => o.id !== 'no').sort((a, b) => power(s, a.id) - power(s, b.id))[0]?.id ?? 'no'],
});

// No Beer!: the Liquor Companies (a base card, groups0.ts) gain a further use of their action, relevant
// only to this Plot; added here at load time (not by editing groups0.ts, which the base pack still owns)
// so the pack that needs it is the pack that adds it.
(HOOKS['liquor-companies'] ??= {}).actions = [
  ...(HOOKS['liquor-companies']?.actions ?? []),
  {
    id: 'no-beer', label: "Halve or double No Beer!'s Power", timing: ['attack'], usesToken: true, ai: 'never',
    needs: { modes: ['half', 'double'] },
    check(s, _pl, _self, p, ctx) {
      if (!ctx || !ctx.instant || s.cards[ctx.instantCard ?? '']?.cardId !== 'no-beer') return 'Use this only against No Beer!.';
      if (p.mode !== 'half' && p.mode !== 'double') return 'Choose halve or double.';
      return null;
    },
    apply(s, pl, _self, p, ctx) {
      const factor = p.mode === 'half' ? 0.5 : 2;
      ctx!.instantPower = Math.round((ctx!.instantPower ?? 0) * factor);
      log(s, `The Liquor Companies ${p.mode === 'half' ? 'halve' : 'double'} No Beer!'s Power to ${ctx!.instantPower}.`, pl);
    },
  },
];

// ---------------------------------------------------------------- Goals

/** Groups (not the Illuminati) that count toward victory: not Paralyzed, not a Devastated Place or below one. */
function countedGroups(s: GameState, pl: string): string[] {
  return structureCards(s, pl).filter((iid) => {
    if (paralyzedGroups(s).has(iid)) return false;
    let c = s.cards[iid];
    for (;;) { if (c.devastated) return false; if (!c.master) return true; c = s.cards[c.master]; }
  });
}
const COMBOS: [number, number][] = [[2, 6], [3, 5], [4, 4], [5, 3], [6, 1]];
/** Does this player's Illuminati count destroyed Groups toward the Basic Goal (the Servants of Cthulhu)? */
const countsDestroyed = (s: GameState, pl: string) => abilitiesOf(s, player(s, pl).illuminati).some((a) => a.kind === 'specialGoal' && a.goal === 'destroyCount');

registerGoals({
  // Control at least 6 Science Groups with 30+ total Power (official errata). Cannot be combined with
  // another Goal (there is no other Goal card to combine it with anyway: a player holds only one).
  'blinded-by-science': (s, pl) => {
    const groups = countedGroups(s, pl).filter((iid) => isGroup(s, iid) && hasAttr(s, iid, 'Science'));
    const total = groups.reduce((n, iid) => n + power(s, iid, { goals: true }), 0);
    return groups.length >= 6 && total >= 30 ? `controls ${groups.length} Science Groups with ${total} Power` : null;
  },

  // Destroyed Corporate Groups and controlled Green Groups in one of the five printed combinations.
  'earth-first': (s, pl) => {
    const d = player(s, pl).destroyedCredit.filter((iid) => (def(s, iid).alignments ?? []).includes('Corporate')).reduce((n, iid) => n + goalAlignWeight(s, iid, 'Corporate'), 0);
    const c = countedGroups(s, pl).filter((iid) => isGroup(s, iid) && hasAttr(s, iid, 'Green')).length;
    const hit = COMBOS.find(([nd, nc]) => d >= nd && c >= nc);
    return hit ? `destroyed ${d} Corporate Groups and controls ${c} Green Groups` : null;
  },

  // Up to three destroyed Huge Places count as two Groups each toward the Basic Goal (for a player whose
  // destroyed Groups count toward it, the Servants of Cthulhu, as two destroyed Groups each), and no other
  // destroyed Group counts toward it; no more than three cards ever count double, these included. Or an
  // outright win with five Huge Places destroyed without recourse to World War III: a destruction that
  // World War III brought about (its tripled Nation attack, or its backfire) is marked when it happens
  // (plots2.ts) and does not count toward the five.
  'population-reduction': (s, pl) => {
    const huge = player(s, pl).destroyedCredit.filter((iid) => (def(s, iid).attributes ?? []).includes('Huge') && def(s, iid).subtype === 'Place');
    const clean = huge.filter((iid) => !s.cards[iid].data?.viaWorldWarThree);
    if (clean.length >= 5) return `destroyed ${clean.length} Huge Places without World War III`;
    const { count, doubled } = goalTally(s, pl);
    const counted = Math.min(huge.length, Math.max(0, 3 - doubled));
    // The Servants of Cthulhu count every destroyed Group toward the Basic Goal: with this Goal, only the
    // Huge Places do (as two each).
    const need = goalNeeded(s, pl) + (countsDestroyed(s, pl) ? player(s, pl).destroyedCredit.length : 0);
    return count + counted * 2 >= need ? `controls enough Groups, counting ${counted} destroyed Huge Place${counted === 1 ? '' : 's'} as two each` : null;
  },
});

// ---------------------------------------------------------------- New World Orders

function nwo(): PlotHandler {
  const takeEffect = (s: GameState, _pl: string, play: PlotPlay) => {
    const color = nwoColor(s.cards[play.card].cardId);
    const prev = s.nwo[color];
    if (prev && prev !== play.card) { discardCard(s, prev); log(s, `${def(s, prev).name} is replaced.`); }
    s.nwo[color] = play.card;
    s.cards[play.card].linkedTo = 'nwo';
  };
  return {
    timing: ['nwo'],
    check: () => null,
    apply: (s, pl, play, ctx) => { if (ctx) takeEffect(s, pl, play); },
    resolve: takeEffect,
  };
}

// ---------------------------------------------------------------- Antitrust Legislation
// Yellow NWO, as the official errata words it. When it is played, before it takes effect, each player in
// turn (its player first, then in seat order) may move his Groups, discarding one Plot card (from hand or
// the top of his deck) for each move, or three for a complete reorganization (as many moves as he likes).
// Then it takes effect: while it is in effect, a Corporate Group that controls or is controlled by another
// Corporate Group loses its Action tokens at once, gets no new ones, and cannot use its special ability.
// Played during an attack, the reorganization waits until the attack is over.
//
// Which Groups are Corporate: for tokens, the Group's alignments as they stand; for switching abilities
// off, the Group's own alignments (printed, and as Plots and modifiers on it changed them). RULING: the
// engine decides which cards' abilities are on before it can work out alignment changes that other
// cards' ongoing abilities make, and those changes could themselves depend on it (a circle), so that one
// check cannot see them.

const printedCorporate = (s: GameState, iid: string) => {
  let al = [...(def(s, iid).alignments ?? [])];
  for (const m of s.cards[iid].mods) {
    if (m.kind === 'addAlign' && m.align) { al = al.filter((a) => a !== OPPOSITE[m.align!] && a !== m.align); al.push(m.align); }
    if (m.kind === 'removeAlign' && m.align) al = al.filter((a) => a !== m.align);
  }
  return al.includes('Corporate');
};
/** Is this Corporate Group nested with another Corporate Group (its master or one of its puppets)? */
function corpOverCorp(s: GameState, iid: string, corp: (s: GameState, g: string) => boolean): boolean {
  if (!isGroup(s, iid) || s.cards[iid].zone !== 'structure' || !corp(s, iid)) return false;
  const master = s.cards[iid].master;
  if (master && isGroup(s, master) && corp(s, master)) return true;
  return puppets(s, iid).some((p) => isGroup(s, p) && corp(s, p));
}
const liveCorporate = (s: GameState, g: string) => alignments(s, g).includes('Corporate');
const antitrustInForce = (s: GameState, self: string) => s.cards[self].linkedTo === 'nwo';

type ReorgData = { queue: string[]; complete: string[]; pending?: boolean; attack?: number };
const reorgData = (s: GameState, card: string) => s.cards[card].data as ReorgData;

function startAntitrust(s: GameState, pl: string, card: string, attack?: number) {
  const seats = s.players.map((p) => p.id);
  const from = seats.indexOf(pl);
  const queue = [...seats.slice(from), ...seats.slice(0, from)].filter((id) => !player(s, id).eliminated);
  s.cards[card].linkedTo = 'antitrust-pending';
  s.cards[card].data = { ...s.cards[card].data, queue, complete: [], pending: true, attack } as Record<string, unknown>;
  if (attack !== undefined) { log(s, 'Antitrust Legislation: the players may reorganize once this attack is over.', pl); return; }
  log(s, 'Antitrust Legislation: before it takes effect, each player may move Groups, for one Plot per move or three for a complete reorganization.', pl);
  askReorg(s, card);
}
/** The moves a player could make now: every one of his Groups onto any open arrow of his structure. */
function reorgMoves(s: GameState, pl: string): { group: string; onto: string; side: Side }[] {
  const out: { group: string; onto: string; side: Side }[] = [];
  const mine = structureCards(s, pl);
  for (const g of mine) {
    if (!isGroup(s, g)) continue;
    const sub = new Set(subtree(s, g));
    for (const m of mine) {
      if (sub.has(m) || isParalyzed(s, m)) continue;
      for (const side of movableSides(s, pl, g, m)) if (!(m === s.cards[g].master && side === s.cards[g].side)) out.push({ group: g, onto: m, side });
    }
  }
  return out;
}
const plotPayment = (s: GameState, pl: string) => player(s, pl).hand.filter((c) => ['Plot', 'Illuminati'].includes(def(s, c).type)).length + plotDeckOf(s, pl).length;
function askReorg(s: GameState, card: string) {
  const d = reorgData(s, card);
  while (d.queue.length && player(s, d.queue[0]).eliminated) d.queue.shift();
  const pl = d.queue[0];
  if (!pl) { antitrustTakesEffect(s, card); return; }
  const complete = d.complete.includes(pl);
  const canPay = plotPayment(s, pl);
  const moves = complete || canPay ? reorgMoves(s, pl) : [];
  const options = [
    { id: 'done', label: complete ? 'Done reorganizing' : 'No more moves: let it take effect' },
    ...(!complete && canPay >= 3 ? [{ id: 'complete', label: 'Discard three Plots for a complete reorganization' }] : []),
    ...moves.map((m) => ({ id: `move|${m.group}|${m.onto}|${m.side}`, label: `Move ${cardName(s, m.group)} onto ${cardName(s, m.onto)} (${m.side.toLowerCase()})${complete ? '' : ': discard one Plot'}` })),
  ];
  askChoice(s, pl, {
    key: 'antitrust-reorg', source: card, min: 1, max: 1, data: { card }, options,
    question: `Antitrust Legislation is about to take effect: while it does, a Corporate Group nested with another Corporate Group loses its tokens and special ability. Move Groups first?${complete ? ' (Your complete reorganization is paid: moves are free.)' : ''}`,
  });
}
function antitrustTakesEffect(s: GameState, card: string) {
  const c = s.cards[card];
  if (c.zone !== 'table') return;
  const color = nwoColor(c.cardId);
  const prev = s.nwo[color];
  if (prev && prev !== card) { discardCard(s, prev); log(s, `${def(s, prev).name} is replaced.`); }
  s.nwo[color] = card;
  c.linkedTo = 'nwo';
  c.data = { ...c.data, queue: undefined, complete: undefined, pending: undefined, attack: undefined };
  log(s, 'Antitrust Legislation takes effect.');
  syncConditions(s);
}
function askReorgPayment(s: GameState, pl: string, card: string, n: number, move?: string) {
  const hand = player(s, pl).hand.filter((c) => ['Plot', 'Illuminati'].includes(def(s, c).type));
  const deck = plotDeckOf(s, pl).slice(0, n).map((_c, i) => ({ id: `deck${i}`, label: `The ${i === 0 ? 'top' : i === 1 ? 'second' : 'third'} card of your Plot deck (unseen)` }));
  askChoice(s, pl, {
    key: 'antitrust-pay', source: card, min: n, max: n, data: { card, n, move },
    question: `Discard ${n} Plot card${n === 1 ? '' : 's'} (from your hand, or the top of your Plot deck) to pay for ${move ? 'this move' : 'a complete reorganization'}.`,
    options: [...hand.map((c) => ({ id: c, label: cardName(s, c) })), ...deck],
  });
}
registerChoice('antitrust-reorg', {
  resolve(s, pl, picked, data) {
    const card = data.card as string;
    if (s.cards[card]?.zone !== 'table') return;
    const d = reorgData(s, card);
    const id = picked[0];
    if (id === 'done') { d.queue.shift(); askReorg(s, card); return; }
    if (id === 'complete') { askReorgPayment(s, pl, card, 3); return; }
    if (d.complete.includes(pl)) { reorgMove(s, pl, id); askReorg(s, card); return; }
    askReorgPayment(s, pl, card, 1, id);
  },
  // The computer lets it take effect as things stand.
  ai: () => ['done'],
});
registerChoice('antitrust-pay', {
  resolve(s, pl, picked, data) {
    const card = data.card as string;
    if (s.cards[card]?.zone !== 'table') return;
    const p = player(s, pl);
    const deckTop = plotDeckOf(s, pl).slice(0, 3);
    const fromHand = picked.filter((c) => p.hand.includes(c));
    const fromDeck = picked.filter((c) => c.startsWith('deck')).map((c) => deckTop[Number(c.slice(4))]).filter((c): c is string => Boolean(c));
    for (const c of fromDeck) { const deck = plotDeckOf(s, pl); deck.splice(deck.indexOf(c), 1); s.cards[c].zone = 'hand'; p.hand.push(c); }
    for (const c of [...fromHand, ...fromDeck]) discardCard(s, c);
    noteCostDiscard(s, pl, [{ kind: 'plot', place: 'hand', cards: fromHand }, { kind: 'plot', place: 'deck', cards: fromDeck }]);
    const d = reorgData(s, card);
    if (data.move) reorgMove(s, pl, data.move as string);
    else { d.complete.push(pl); log(s, `${p.name} discards three Plots for a complete reorganization.`, pl); }
    askReorg(s, card);
  },
});
function reorgMove(s: GameState, pl: string, id: string) {
  const [, group, onto, side] = id.split('|') as [string, string, string, Side];
  if (!reorgMoves(s, pl).some((m) => m.group === group && m.onto === onto && m.side === side)) { log(s, `${cardName(s, group)} can no longer be moved there.`, pl); return; }
  moveSubtree(s, group, pl, onto, side, 'hand');
  for (const g of subtree(s, group)) if (tokenBarred(s, g)) s.cards[g].tokens = 0;
  log(s, `${player(s, pl).name} moves ${cardName(s, group)} onto ${cardName(s, onto)} before Antitrust Legislation takes effect.`, pl);
}

registerPlots({
  'antitrust-legislation': {
    timing: ['nwo'],
    check: () => null,
    apply: (s, pl, play, ctx) => { if (ctx) startAntitrust(s, pl, play.card, ctx.id); },
    resolve: (s, pl, play) => startAntitrust(s, pl, play.card),
  },
  // Red NWO.
  'apathy': nwo(),
  // Red NWO.
  'australian-rules': nwo(),
  // Yellow NWO. Its flat Power effect is in nwo.ts (NWO_EFFECTS), alongside the base game's NWOs.
  'end-of-the-world': nwo(),
});

registerHooks({
  'antitrust-legislation': {
    losesTokens: (s, self, iid) => antitrustInForce(s, self) && corpOverCorp(s, iid, liveCorporate),
    noTokens: (s, self, iid) => antitrustInForce(s, self) && corpOverCorp(s, iid, liveCorporate),
    disablesAbilities: (s, self, iid) => antitrustInForce(s, self) && corpOverCorp(s, iid, printedCorporate),
    // Played during an attack: the reorganization comes once the attack is over.
    onAttackEnd(s, self, ctx) {
      const d = reorgData(s, self);
      if (s.cards[self].linkedTo === 'antitrust-pending' && d?.attack === ctx.id) { d.attack = undefined; askReorg(s, self); }
    },
  },
  // No Group may aid an attack made by another Group.
  'apathy': {
    forbidJoin: (s, self, ctx, group, as) => as === 'aid',
  },
  // Attacking a rival, or aiding such an attack, earns an extra Plot draw; capturing or destroying a
  // rival's Group earns an extra Group draw.
  'australian-rules': {
    onAttackEnd(s, self, ctx) {
      if (attackCancelled(ctx)) return;
      const target = ctx.targetPlayer;
      if (!target) return;
      const drawnFor = new Set<string>();
      const plotDraw = (pl?: string) => {
        if (!pl || pl === target || drawnFor.has(pl)) return;
        drawnFor.add(pl);
        drawPlot(s, player(s, pl), 1);
        log(s, `${player(s, pl).name} draws a Plot card (Australian Rules).`, pl);
      };
      plotDraw(ctx.attackerPlayer);
      for (const a of ctx.aid) plotDraw(a.player);
      if (ctx.result === 'success' && (ctx.type === 'control' || ctx.type === 'destroy') && ctx.attackerPlayer !== target) {
        drawGroup(s, player(s, ctx.attackerPlayer));
        log(s, `${player(s, ctx.attackerPlayer).name} draws a Group card (Australian Rules).`, ctx.attackerPlayer);
      }
    },
  },
});
