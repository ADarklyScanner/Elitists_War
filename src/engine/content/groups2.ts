import type { Alignment, AttackCtx, GameState } from '../types';
import { attackingGroups, abilitiesOf, matches, registerAbilities } from '../abilities';
import { type ActivatedAbility, type CardHooks, HOOKS, activeHookCards, hooksOf, registerHooks } from '../hooks';
import { cardName, def } from '../cards';
import { alignments, attributes, countControlled, globalPower, isOpposite, power } from '../stats';
import { NWO_EFFECTS, fanaticUnited } from '../nwo';
import { puppets, sideOf, structureCards } from '../geometry';
import { resourceKinds } from './plots3';
import { roll2d6, rollDie } from '../rng';
import {
  attackCancelled, canEnterPlay, cancelledGroups, controllerOf2, destroyGroup, discardCard, drawPlot, isPrivileged, log,
  livePlayers, placeGroup, player, protectedPlayer, revealTo,
} from '../game';
import { magicByCard } from '../hooks';

/** Government Groups of the United States (Bill Clinton's +3; the data has no U.S. attribute). */
const US_GOVERNMENT = [
  'b-a-t-f', 'c-i-a', 'fbi', 'federal-reserve', 'i-r-s', 'nasa', 'n-s-a', 'post-office', 'secret-service', 'supreme-court',
  'al-gore', 'california', 'center-for-disease-control', 'new-york', 'pentagon', 'texas',
];

registerAbilities({
  'voudonistas': [
    { kind: 'attackBonus', on: 'destroy', target: { subtypes: ['Personality'] }, value: 8, scope: 'direct' },
  ],
  'wall-street': [],
  'wargamers': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Computer'] }, value: 2, scope: 'any' },
  ],
  'w-i-t-c-h': [],
  'al-gore': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Green'] }, value: 8, scope: 'direct' },
  ],
  'bill-clinton': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Government'] }, value: 8, scope: 'direct' },
    { kind: 'attackBonus', on: 'control', target: { names: US_GOVERNMENT, alignments: ['Government'] }, value: 3, scope: 'any' },
  ],
  'bjorne': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Media'] }, value: 4, scope: 'direct' },
  ],
  'count-dracula': [
    { kind: 'attackBonus', on: 'control', target: { names: ['vampires'] }, value: 10, scope: 'direct' },
  ],
  'dan-quayle': [],
  'elvis': [
    { kind: 'attackBonus', on: 'control', target: { names: ['church-of-elvis'] }, value: 6, scope: 'direct' },
  ],
  'fidel-castro': [],
  'george-bush': [],
  'gordo-remora': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Weird'] }, value: 10, scope: 'direct' },
  ],
  'hillary-clinton': [
    { kind: 'attackBonus', on: 'control', target: { names: ['bill-clinton', 'congressional-wives', 'democrats'] }, value: 2, scope: 'any' },
    { kind: 'attackBonus', on: 'control', target: { names: ['bill-clinton', 'congressional-wives', 'democrats'] }, value: 6, scope: 'direct' },
  ],
  'imelda-marcos': [],
  'jimmy-hoffa': [
    { kind: 'attackBonus', on: 'control', target: { names: ['cfl-aio'] }, value: 6, scope: 'direct' },
  ],
  'manuel-noriega': [
    { kind: 'attackBonus', on: 'control', target: { names: ['international-cocaine-smugglers'] }, value: 6, scope: 'any' },
  ],
  'margaret-thatcher': [
    { kind: 'attackBonus', on: 'control', target: { names: ['england'] }, value: 10, scope: 'any' },
  ],
  'media-sensation': [],
  'nancy-reagan': [
    { kind: 'attackBonus', on: 'control', target: { names: ['ronald-reagan'] }, value: 10, scope: 'direct' },
  ],
  'ollie-north': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Conservative'], attributes: ['Media'] }, value: 8, scope: 'direct' },
  ],
  'prince-charles': [],
  'princess-di': [],
  'ronald-reagan': [
    { kind: 'selfImmune', from: { attributes: ['Media'] } },
  ],
  'ross-perot': [],
  'saddam-hussein': [],
  'brazil': [],
  'california': [],
  'canada': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Green'] }, value: 10, scope: 'direct' },
  ],
  'center-for-disease-control': [
    { kind: 'attackBonus', on: 'destroy', target: { subtypes: ['Place'] }, value: 15, scope: 'direct' },
  ],
  'china': [
    { kind: 'selfDefense', value: 20, on: 'destroy', instant: true },
  ],
  'dinosaur-park': [],
  'england': [],
  'finland': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 6, scope: 'direct' },
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 2, scope: 'any' },
  ],
  'france': [],
  'germany': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Science'] }, value: 2, scope: 'any' },
  ],
  'hawaii': [],
  'hollywood': [
    { kind: 'powerPer', per: { attributes: ['Media'], subtypes: ['Personality'] }, value: 2, global: true },
  ],
  'israel': [
    { kind: 'attackBonus', on: 'control', target: { names: ['mossad'] }, value: 8, scope: 'any' },
  ],
  'italy': [],
  'japan': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Science', 'Computer'] }, value: 6, scope: 'direct' },
  ],
  // Las Vegas' wager is scripted below.
  'las-vegas': [],
  'moonbase': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Space'] }, value: 4, scope: 'any' },
  ],
  'new-york': [],
  'orbit-one': [],
  'pentagon': [],
  'russia': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Communist'] }, value: 4, scope: 'direct' },
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Communist'] }, value: 2, scope: 'any' },
  ],
  'silicon-valley': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 4, scope: 'any' },
  ],
  'stonehenge': [
    { kind: 'structureImmune', from: { attributes: ['Magic'] } },
  ],
  'switzerland': [],
  'texas': [],
  'vatican-city': [
    { kind: 'structureImmune', from: { alignments: ['Peaceful'] } },
  ],
  'the-great-pyramid': [],
  'pyramid-marketing-schemes': [
    { kind: 'powerPer', per: { alignments: ['Fanatic'] }, value: 1 },
  ],
  'trading-card-games': [],
});

// ---------------------------------------------------------------- scripted parts

const inStructure = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';
const isGroup = (s: GameState, iid: string) => def(s, iid).type === 'Group';
const hasAttr = (s: GameState, iid: string, a: string) => attributes(s, iid).includes(a);
const hasAlign = (s: GameState, iid: string, a: Alignment) => alignments(s, iid).includes(a);
/** Another Group in play controlled by the same player as `self`. */
const ownGroup = (s: GameState, self: string, iid: string) =>
  inStructure(s, iid) && isGroup(s, iid) && s.cards[iid].controller === controllerOf2(s, self);
/** The rival Las Vegas gambles with: the target names him (his Illuminati or any of his cards), or the only rival. */
function vegasRival(s: GameState, pl: string, p: { target?: string }): string | undefined {
  const rivals = livePlayers(s).map((x) => x.id).filter((id) => id !== pl);
  const c = p.target ? s.cards[p.target] : undefined;
  const who = c ? c.controller ?? c.owner : undefined;
  if (who && rivals.includes(who)) return who;
  return !p.target && rivals.length === 1 ? rivals[0] : undefined;
}

/** Groups spending an action in this attack (leader, aiders, opposers), minus cancelled ones. */
function actingGroups(ctx: AttackCtx): string[] {
  const gone = cancelledGroups(ctx);
  return [ctx.attacker, ...ctx.aid.map((a) => a.iid), ...ctx.oppose.map((o) => o.iid)].filter((x): x is string => !!x && !gone.has(x));
}
/** Id of the ability entry `useAbility` is about to record; used as `plot` so cancelling the ability undoes its bonus. */
const abilityEntry = (s: GameState, self: string, id: string) => `ability:${self}:${id}:${s.version}`;
const usedThisAttack = (ctx: AttackCtx, self: string, id: string) => ctx.plays.some((p) => p.iid.startsWith(`ability:${self}:${id}:`));

/** Alignment modifier (R006) the leading attacker would get with alignments `mine`. */
function alignValue(s: GameState, mine: Alignment[], theirs: Alignment[], type: AttackCtx['type']): number {
  const united = fanaticUnited(s);
  let same = 0, opp = 0;
  for (const p of new Set(mine)) {
    if (theirs.includes(p) && (p !== 'Fanatic' || united)) same++;
    for (const q of theirs) if (isOpposite(p, q, s)) opp++;
  }
  let perSame = 4, perOpp = 4;
  for (const n of Object.values(s.nwo)) {
    const v = n ? NWO_EFFECTS[s.cards[n].cardId]?.alignmentValues?.() : undefined;
    if (v) { perSame = v.same; perOpp = v.opposite; }
  }
  return type === 'control' ? same * perSame - opp * perOpp : opp * perOpp - same * perSame;
}
/** May a Group with alignments `mine` aid this kind of attack on a target with `theirs` (R006)? */
function alignQualifies(s: GameState, mine: Alignment[], theirs: Alignment[], type: AttackCtx['type']): boolean {
  return type === 'control'
    ? mine.some((a) => (a !== 'Fanatic' || fanaticUnited(s)) && theirs.includes(a))
    : mine.some((a) => theirs.some((b) => isOpposite(a, b, s)));
}

/** "As an action, cancel a [X] group's action." */
function cancelAction(what: string, ok: (s: GameState, g: string) => boolean): ActivatedAbility {
  return {
    id: 'cancel',
    label: `Cancel a ${what} Group's action`,
    timing: ['attack'],
    usesToken: true,
    needs: { target: 'actingGroup' },
    ai: 'cancelAttacker',
    check(s, _pl, _self, p, ctx) {
      if (!ctx) return 'Use this during an attack, against a Group taking an action in it.';
      if (!p.target || !actingGroups(ctx).includes(p.target)) return 'Choose a Group that is taking an action in this attack.';
      if (!ok(s, p.target)) return `Only a ${what} Group's action can be cancelled this way.`;
      return null;
    },
    apply: (_s, _pl, _self, p) => ({ t: 'cancelGroup', group: p.target! }),
  };
}

/** "A Corporate master of this Place gets one extra Action token each turn." */
const corporateMasterToken: CardHooks = {
  extraTokens: (s, self, iid) => (iid === s.cards[self].master && hasAlign(s, iid, 'Corporate') ? 1 : 0),
};

/** Only the listed Disasters affect this Place. The Disaster cannot succeed, and the token it took comes back. */
function disasterImmunity(affectedBy: string[] | null, immuneTo: string[] | null): CardHooks {
  const immune = (s: GameState, self: string, ctx: AttackCtx) => {
    if (!ctx.disaster || ctx.target !== self || !ctx.instantCard) return false;
    const id = s.cards[ctx.instantCard]?.cardId;
    return affectedBy ? !affectedBy.includes(id) : !!immuneTo?.includes(id);
  };
  return {
    immune: (s, self, target, source) => target === self && def(s, source).subtype === 'Disaster'
      && (affectedBy ? !affectedBy.includes(def(s, source).id) : !!immuneTo?.includes(def(s, source).id)),
    attackMod: (s, self, ctx, side) => (side === 'defense' && immune(s, self, ctx) ? 999 : 0),
    onAttackEnd(s, self, ctx) {
      if (immune(s, self, ctx) && ctx.tokenTaken && !attackCancelled(ctx) && inStructure(s, self)) {
        s.cards[self].tokens++;
        log(s, `${def(s, self).name} is immune to ${def(s, ctx.instantCard!).name}.`);
      }
    },
  };
}

/** Plots that always count as Magic when used to destroy (Count Dracula). */
const MAGIC_DESTROYERS = ['withering-curse', 'plague-of-demons'];

const isGnomes = (s: GameState, pl?: string) => !!pl && s.cards[player(s, pl).illuminati].cardId === 'gnomes-of-zurich';

function wallStreetVariants(al: Alignment[]): Alignment[][] {
  const out = [al];
  if (al.includes('Corporate')) out.push(al.map((a) => (a === 'Corporate' ? 'Government' : a)));
  if (al.includes('Government')) out.push(al.map((a) => (a === 'Government' ? 'Corporate' : a)));
  return out;
}

function subsets<T>(xs: T[]): T[][] {
  return xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((a) => [...a, x])], [[]]);
}

/** Linked Personalities of Moonbase that are still in play or in a hand. */
const moonbaseLinks = (s: GameState, self: string) => ((s.cards[self].data?.linked as string[] | undefined) ?? []);

// Moonbase: only Earthquake and Meteor Strike can reach it (Orbit One's errata list does not apply here).
const moonbaseDisasters = disasterImmunity(['earthquake', 'meteor-strike'], null);

/** Plots that count as Magic (spells, or their banner asks for a Magic action). */
const MAGIC_PLOTS = new Set([
  'withering-curse', 'plague-of-demons', 'air-magic', 'earth-magic', 'counterspell', 'hex', 'unlucky-13',
  'the-stars-are-right', 'talisman-of-ahrimanes', 'harmonica-virgins',
]);
/** Is this Group, Plot or Resource Magic? */
function isMagicCard(s: GameState, iid: string): boolean {
  const d = def(s, iid);
  if (d.type === 'Plot') return MAGIC_PLOTS.has(d.id);
  if (d.type === 'Resource') return resourceKinds(s, iid).includes('Magic');
  return hasAttr(s, iid, 'Magic');
}

/** Plots that stop an Assassination and are not Magic: Voudonistas ignore them. */
const PLAIN_ASSASSINATION_DEFENSES = ['mistaken-identity', 'bodyguard'];
/** Is this an Assassination the Voudonistas are making (their action not cancelled)? */
const voudonAssassination = (self: string, ctx?: AttackCtx) =>
  !!ctx?.assassination && ctx.aid.some((a) => a.iid === self) && !cancelledGroups(ctx).has(self);

/**
 * "Hide one Plot beneath this card": the Plot stays in its owner's hand but cannot be exposed.
 * Texas may swap it on your turn and lets it go beyond the hand limit; Fidel Castro hides a new one
 * only after the old one has been used.
 */
function plotHider(opts: { name: string; swap: boolean; beyondLimit: boolean; goals: boolean }): CardHooks {
  const hidden = (s: GameState, self: string): string | undefined => {
    const d = s.cards[self].data, iid = d?.hidden as string | undefined, who = d?.hider as string | undefined;
    if (!iid || !who || who !== controllerOf2(s, self) || !player(s, who).hand.includes(iid)) return undefined;
    return iid;
  };
  return {
    preventExpose: (s, self, card) => hidden(s, self) === card,
    handLimit: opts.beyondLimit ? (s, self) => (hidden(s, self) ? 1 : 0) : undefined,
    actions: [{
      id: 'hide',
      label: `Hide a Plot beneath ${opts.name}`,
      timing: ['main'],
      usesToken: false,
      needs: { target: 'handPlot' },
      secret: true,
      ai: 'never',
      check(s, pl, self, p) {
        const c = p.target ? s.cards[p.target] : undefined;
        if (!c || !player(s, pl).hand.includes(c.iid) || def(s, c.iid).type !== 'Plot') return 'Choose a Plot card in your hand.';
        if (!opts.goals && def(s, c.iid).subtype === 'Goal') return `A Goal cannot be hidden beneath ${opts.name}.`;
        if (c.exposed) return 'That Plot is already exposed; choose one that is still hidden.';
        const now = hidden(s, self);
        if (now === c.iid) return `That Plot is already hidden beneath ${opts.name}.`;
        if (now && !opts.swap) return `${opts.name} already hides a Plot; you can hide another once it has been used.`;
        return null;
      },
      apply(s, pl, self, p) {
        s.cards[self].data = { ...s.cards[self].data, hidden: p.target, hider: pl };
        log(s, `${player(s, pl).name} hides a Plot beneath ${opts.name}.`, pl);
      },
    }],
  };
}
/**
 * France and Italy: as a free action (no Action token needed or spent), add this Place's Power to the
 * defense of one of your own Groups with the given alignment, once per attack.
 */
function freeDefense(name: string, al: Alignment): CardHooks {
  return {
    // Its Power is used once: after defending for free it cannot also oppose with a token.
    forbidJoin: (_s, self, ctx, group, as) => as === 'oppose' && group === self && usedThisAttack(ctx, self, 'defend'),
    actions: [{
      id: 'defend',
      label: `Defend one of your ${al} Groups with ${name}'s Power (free action)`,
      timing: ['attack'],
      usesToken: false,
      ai: 'boostDefense',
      check(s, pl, self, _p, ctx) {
        if (!ctx || ctx.instant) return 'Use this during an attack on one of your Groups.';
        const t = ctx.target;
        if (!ownGroup(s, self, t) || s.cards[t].controller !== pl || !hasAlign(s, t, al)) return `The target must be a ${al} Group you control.`;
        if (t === self) return `${name} defends itself in the usual way.`;
        if (ctx.attacker === self || [...ctx.aid, ...ctx.oppose].some((c) => c.iid === self)) return `${name} is already part of this attack.`;
        if (usedThisAttack(ctx, self, 'defend')) return `${name} has already defended in this attack.`;
        // R014: only Secret Groups, or the target's own master and puppets, may defend a Secret Group.
        if (hasAttr(s, t, 'Secret') && !hasAttr(s, self, 'Secret') && s.cards[t].master !== self && s.cards[self].master !== t) return `${name} cannot defend a Secret Group.`;
        return null;
      },
      apply(s, pl, self, _p, ctx) {
        ctx!.defenseBonus.push({ player: pl, plot: abilityEntry(s, self, 'defend'), forGroup: self, amount: power(s, self), label: `${name} defends` });
      },
    }],
  };
}

/** Texas: the hidden Plot is lost if Texas is captured or destroyed. */
function loseHidden(s: GameState, self: string) {
  const d = s.cards[self].data, iid = d?.hidden as string | undefined, who = d?.hider as string | undefined;
  s.cards[self].data = { ...d, hidden: undefined, hider: undefined };
  if (!iid || !who || !player(s, who).hand.includes(iid)) return;
  log(s, 'The Plot hidden beneath Texas is lost.', who);
  discardCard(s, iid);
}

/** Bill Clinton: whether he counts as Liberal is rolled each turn (1-3: Liberal). */
/**
 * Bill Clinton: whenever his alignments matter a die decides whether he is Liberal (1-3) at that moment.
 * A fresh roll is made at the start of every attack (it holds for that attack) and at the start of each
 * turn (it holds outside attacks, e.g. for Goals and moves).
 */
function rollClinton(s: GameState, self: string, attack?: number) {
  const die = rollDie(s);
  const liberal = die <= 3;
  s.cards[self].data = attack === undefined
    ? { ...s.cards[self].data, liberalTurn: liberal ? s.turn : undefined }
    : { ...s.cards[self].data, rollAttack: attack, liberalAttack: liberal };
  log(s, `Bill Clinton rolls ${die}: he is ${liberal ? '' : 'not '}Liberal ${attack === undefined ? 'for now' : 'in this attack'}.`);
}
function clintonLiberal(s: GameState, self: string): boolean {
  const d = s.cards[self].data;
  if (s.attack && d?.rollAttack === s.attack.id) return !!d.liberalAttack;
  return d?.liberalTurn === s.turn;
}

/** The Great Pyramid: its controller forgets the Plots it showed him (no notes allowed). */
function forgetShown(s: GameState, self: string) {
  const shown = (s.cards[self].data?.shown as string[] | undefined) ?? [];
  if (!shown.length) return;
  const me = controllerOf2(s, self);
  if (me) player(s, me).known = (player(s, me).known ?? []).filter((c) => !shown.includes(c));
  s.cards[self].data = { ...s.cards[self].data, shown: [] };
}

registerHooks({
  'voudonistas': {
    // +4 on an Assassination it joins; defenses made only against Assassinations work only if they are Magic.
    attackMod(s, self, ctx, side) {
      if (!voudonAssassination(self, ctx)) return 0;
      if (side === 'attack') return 4;
      const plain = { ...ctx, assassination: false };
      let extra = 0;
      for (const o of activeHookCards(s)) {
        const h = HOOKS[s.cards[o].cardId];
        if (o === self || !h.attackMod || isMagicCard(s, o)) continue;
        extra += h.attackMod(s, o, ctx, 'defense') - h.attackMod(s, o, plain, 'defense');
      }
      return extra > 0 ? -extra : 0;
    },
    forbidUse: (s, self, _pl, card, _target, ctx) => (voudonAssassination(self, ctx) && PLAIN_ASSASSINATION_DEFENSES.includes(s.cards[card]?.cardId)
      ? `The Voudonistas' Assassination is Magic: ${def(s, card).name} cannot stop it.` : null),
  },

  'wall-street': {
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || ctx.instant || ctx.attacker !== self || cancelledGroups(ctx).has(self)) return 0;
      const ta = alignments(s, ctx.target), mine = alignments(s, self);
      const base = alignValue(s, mine, ta, ctx.type);
      return Math.max(...wallStreetVariants(mine).map((v) => alignValue(s, v, ta, ctx.type))) - base;
    },
    mayJoin: (s, self, ctx, group, as) => as === 'aid' && group === self && !ctx.instant
      && wallStreetVariants(alignments(s, self)).some((v) => alignQualifies(s, v, alignments(s, ctx.target), ctx.type)),
    resistanceMod: (s, self, iid) => (s.cards[iid].master === self && inStructure(s, iid) ? 10 : 0),
  },

  'wargamers': {
    actions: [{
      id: 'bury',
      label: 'Put an exposed Plot on the bottom of its owner\'s deck',
      timing: ['anytime'],
      usesToken: true,
      needs: { target: 'plot' },
      check(s, _pl, _self, p) {
        const c = p.target ? s.cards[p.target] : undefined;
        if (!c || c.zone !== 'hand' || def(s, c.iid).type !== 'Plot') return 'Choose a Plot card in a player\'s hand.';
        if (!c.exposed) return 'Only an exposed Plot can be put back.';
        return null;
      },
      apply(s, pl, _self, p) {
        const c = s.cards[p.target!];
        for (const x of s.players) x.hand = x.hand.filter((i) => i !== c.iid);
        Object.assign(c, { zone: 'plotDeck', exposed: false, controller: undefined });
        player(s, c.owner).plotDeck.push(c.iid);
        log(s, `${def(s, c.iid).name} goes to the bottom of ${player(s, c.owner).name}'s Plot deck.`, pl);
      },
    }],
  },

  'w-i-t-c-h': {
    actions: [{
      id: 'alter',
      label: 'Alter the die roll by 1 (by 2 if a Magic Group is involved)',
      timing: ['roll'],
      usesToken: true,
      needs: { modes: ['up', 'down'] },
      ai: 'boostAttack',
      check(_s, _pl, _self, p, ctx) {
        if (!ctx?.roll) return 'Use this right after a die roll.';
        if (p.mode !== 'up' && p.mode !== 'down') return 'Choose whether to raise or lower the roll.';
        return null;
      },
      apply(s, _pl, _self, p, ctx) {
        const magic = [ctx!.target, ...actingGroups(ctx!)].some((g) => hasAttr(s, g, 'Magic'));
        const n = magic ? 2 : 1;
        return { t: 'delta', value: p.mode === 'down' ? -n : n };
      },
    }],
  },

  'bill-clinton': {
    onEnterPlay: rollClinton,
    onEvent(s, self, e) { if (e.type === 'turnStart') rollClinton(s, self); },
    onAttackStart(s, self, ctx) { rollClinton(s, self, ctx.id); },
    alignmentMod: (s, self, iid, cur) => (iid === self && clintonLiberal(s, self) && !cur.includes('Liberal')
      ? [...cur.filter((a) => a !== 'Conservative'), 'Liberal'] : cur),
  },

  'bjorne': {
    extraTokens: (s, self, iid) => (iid === self ? puppets(s, self).filter((g) => hasAttr(s, g, 'Media')).length : 0),
    onDestroy(s, self, victim, by) {
      if (victim !== self) return;
      // One Plot, plus one more for each point of his Power at that moment.
      const n = 1 + Math.max(0, power(s, self));
      drawPlot(s, player(s, by), n);
      log(s, `${player(s, by).name} draws ${n} Plot${n === 1 ? '' : 's'} for destroying Bjorne.`, by);
    },
  },

  'count-dracula': {
    preventDestroy(s, self, target, ctx) {
      if (target !== self) return false;
      if (!ctx) return true;
      const gone = cancelledGroups(ctx);
      const magicGroup = attackingGroups(ctx).some((g) => !gone.has(g) && hasAttr(s, g, 'Magic'));
      const magicCard = !!ctx.instantCard && MAGIC_DESTROYERS.includes(s.cards[ctx.instantCard]?.cardId);
      return !(magicGroup || magicCard || magicByCard(s, ctx));
    },
    // Magic Artifacts linked to him cannot be taken or lost while he lives.
    protectResource: (s, self, r) => s.cards[r].linkedTo === self && resourceKinds(s, r).includes('Magic') && resourceKinds(s, r).includes('Artifact'),
    // Once destroyed he is gone for good, and so are the Magic Artifacts linked to him (they are
    // destroyed with him; this also bars any card that would bring them back).
    onDestroy(s, self, victim) {
      if (victim !== self) return;
      const lost = [self, ...Object.values(s.cards).filter((c) => c.linkedTo === self && c.zone === 'resources'
        && resourceKinds(s, c.iid).includes('Magic') && resourceKinds(s, c.iid).includes('Artifact')).map((c) => c.iid)];
      for (const iid of lost) s.cards[iid].data = { ...s.cards[iid].data, neverReturns: true };
      if (lost.length > 1) log(s, `${lost.slice(1).map((r) => cardName(s, r)).join(', ')} ${lost.length > 2 ? 'are' : 'is'} lost forever with Count Dracula.`);
    },
  },

  'fidel-castro': plotHider({ name: 'Fidel Castro', swap: false, beyondLimit: false, goals: true }),

  'texas': {
    ...plotHider({ name: 'Texas', swap: true, beyondLimit: true, goals: false }),
    // The hidden Plot may only be used for something involving Texas: aimed at Texas, played in an
    // attack Texas makes, aids, opposes or is the target of, or answering a Plot aimed at Texas.
    forbidUse(s, self, pl, card, target, ctx) {
      const d = s.cards[self].data;
      if (d?.hidden !== card || d?.hider !== pl) return null;
      if (target === self) return null;
      if (ctx && [ctx.attacker, ctx.target, ...ctx.aid.map((c) => c.iid), ...ctx.oppose.map((c) => c.iid)].includes(self)) return null;
      const answered = target ? [...(ctx?.plays ?? []), ...(s.window?.plays ?? [])].find((p) => p.iid === target) : undefined;
      if (answered?.play.target === self) return null;
      return 'The Plot hidden beneath Texas can only be used for something involving Texas.';
    },
    onDestroy(s, self, victim) { if (victim === self) loseHidden(s, self); },
    onCapture(s, self) {
      const who = s.cards[self].data?.hider as string | undefined;
      if (who && who !== controllerOf2(s, self)) loseHidden(s, self);
    },
  },

  'media-sensation': { multipleCopies: true, noDestroyCredit: true },

  'ronald-reagan': {
    // Once he makes or aids an attack, Media Groups may not take the other side.
    forbidJoin: (s, self, ctx, group, as) => as === 'oppose' && hasAttr(s, group, 'Media') && !cancelledGroups(ctx).has(self)
      && (ctx.attacker === self || ctx.aid.some((a) => a.iid === self)),
  },

  'ross-perot': {
    alignmentMod(s, self, iid, cur) {
      if (s.cards[iid]?.master !== self || s.cards[iid].zone !== 'structure') return cur;
      const out: Alignment[] = cur.filter((a) => a !== 'Weird' && a !== 'Liberal');
      for (const a of ['Straight', 'Conservative'] as Alignment[]) if (!out.includes(a)) out.push(a);
      return out;
    },
  },

  'stonehenge': {
    // Rivals' Magic Plots, Resources and Magic Groups' abilities cannot be used against you.
    forbidUse(s, self, pl, card, target, ctx) {
      const me = controllerOf2(s, self);
      if (!me || pl === me || !isMagicCard(s, card)) return null;
      const t = target ? s.cards[target] : undefined;
      // Covers your hand, decks and discard pile too, like any whole-structure immunity.
      const mine = !!t && ((t.controller === me && (t.zone === 'structure' || t.zone === 'resources' || t.zone === 'table'))
        || (t.owner === me && (t.zone === 'hand' || t.zone === 'discard' || t.zone === 'plotDeck' || t.zone === 'groupDeck')));
      return mine || (ctx?.targetPlayer === me && ctx.attackerPlayer !== me) ? `${player(s, me).name} controls Stonehenge and is immune to Magic.` : null;
    },
    // Bonuses that rivals' Magic cards give to an attack on you are cancelled.
    attackMod(s, self, ctx, side) {
      const me = controllerOf2(s, self);
      if (side !== 'defense' || !me || ctx.targetPlayer !== me || ctx.attackerPlayer === me) return 0;
      let n = 0;
      for (const o of activeHookCards(s)) {
        const h = HOOKS[s.cards[o].cardId];
        if (o === self || !h.attackMod || controllerOf2(s, o) === me || !isMagicCard(s, o)) continue;
        n += Math.max(0, h.attackMod(s, o, ctx, 'attack'));
      }
      if (!ctx.instant && ctx.attacker) {
        for (const g of structureCards(s, ctx.attackerPlayer)) {
          if (g === ctx.attacker || !isMagicCard(s, g)) continue;
          for (const a of abilitiesOf(s, g)) {
            if (a.kind === 'attackBonus' && a.scope === 'any' && (a.on === 'both' || a.on === ctx.type) && matches(s, ctx.target, a.target, g)) n += a.value;
          }
        }
      }
      return n;
    },
  },

  'dan-quayle': { actions: [cancelAction('Media', (s, g) => hasAttr(s, g, 'Media'))] },
  'elvis': { actions: [cancelAction('Media', (s, g) => hasAttr(s, g, 'Media'))] },
  'jimmy-hoffa': { actions: [cancelAction('Corporate', (s, g) => hasAlign(s, g, 'Corporate'))] },
  'saddam-hussein': { actions: [cancelAction('Government', (s, g) => hasAlign(s, g, 'Government'))] },

  'george-bush': {
    actions: [{
      id: 'conservative',
      label: 'Choose whether George Bush counts as Conservative',
      timing: ['anytime'],
      usesToken: false,
      needs: { modes: ['yes', 'no'] },
      ai: 'never',
      check: (_s, _pl, _self, p) => (p.mode === 'yes' || p.mode === 'no' ? null : 'Choose yes (Conservative) or no.'),
      apply(s, pl, self, p) {
        const c = s.cards[self];
        c.mods = c.mods.filter((m) => !(m.source === self && m.kind === 'addAlign'));
        if (p.mode === 'yes') c.mods.push({ source: self, kind: 'addAlign', align: 'Conservative', until: 'permanent' });
        log(s, `George Bush ${p.mode === 'yes' ? 'counts' : 'does not count'} as Conservative.`, pl);
      },
    }],
  },

  'imelda-marcos': {
    actions: [{
      id: 'gamble',
      label: 'Roll a die: 1-5 her Power counts as 5, 6 she is destroyed',
      timing: ['attack'],
      usesToken: false,
      ai: 'boostAttack',
      check(s, _pl, self, _p, ctx) {
        if (!ctx || ctx.instant) return 'Use this while she attacks or aids an attack.';
        if (ctx.attacker !== self && !ctx.aid.some((a) => a.iid === self)) return 'She must be making or aiding this attack.';
        if (cancelledGroups(ctx).has(self)) return 'Her action has been cancelled.';
        if (!hasAlign(s, ctx.target, 'Government') && !hasAttr(s, ctx.target, 'Bank')) return 'Only against a Government or Bank target.';
        if (usedThisAttack(ctx, self, 'gamble')) return 'She already rolled in this attack.';
        return null;
      },
      apply(s, pl, self, _p, ctx) {
        const die = rollDie(s);
        if (die <= 5) {
          const add = 5 - power(s, self);
          log(s, `Imelda Marcos rolls ${die}: her Power counts as 5.`, pl);
          if (add > 0) ctx!.attackBonus.push({ player: pl, plot: abilityEntry(s, self, 'gamble'), forGroup: self, amount: add, label: 'Imelda Marcos (Power counts as 5)' });
          return;
        }
        const credit = ctx!.targetPlayer ?? s.cards[ctx!.target].owner;
        log(s, `Imelda Marcos rolls 6 and is destroyed.`, pl);
        destroyGroup(s, self, credit);
        return { t: 'cancelGroup', group: self };
      },
    }],
  },

  'manuel-noriega': {
    attackMod(s, self, ctx, side) {
      const m = s.cards[self].master;
      if (side !== 'attack' || ctx.instant || !m || ctx.attacker !== m || cancelledGroups(ctx).has(m)) return 0;
      const ta = alignments(s, ctx.target), mine = alignments(s, m);
      const base = alignValue(s, mine, ta, ctx.type);
      return Math.max(...subsets(alignments(s, self)).map((b) => alignValue(s, [...mine, ...b], ta, ctx.type))) - base;
    },
    mayJoin: (s, self, ctx, group, as) => as === 'aid' && !ctx.instant && group === s.cards[self].master
      && alignQualifies(s, [...alignments(s, group), ...alignments(s, self)], alignments(s, ctx.target), ctx.type),
  },

  'prince-charles': {
    attackMod(s, self, ctx, side) {
      if (ctx.instant) return 0;
      if (side === 'defense') {
        const shielded = [self, s.cards[self].master, ...puppets(s, self)];
        return isPrivileged(ctx) && shielded.includes(ctx.target) ? 999 : 0; // immune to Privileged attacks
      }
      if (ctx.target !== self) return 0;
      // Media Groups attacking him count their Power twice.
      const gone = cancelledGroups(ctx);
      let n = 0;
      if (ctx.attacker && !gone.has(ctx.attacker) && hasAttr(s, ctx.attacker, 'Media')) n += power(s, ctx.attacker);
      for (const a of ctx.aid) {
        if (!a.iid || gone.has(a.iid) || !hasAttr(s, a.iid, 'Media')) continue;
        n += (a as { useGlobal?: boolean }).useGlobal ? globalPower(s, a.iid) : power(s, a.iid);
      }
      return n;
    },
    mayJoin: (_s, self, ctx, _group, as) => as === 'oppose' && ctx.target === self,
  },

  'princess-di': {
    powerMod: (s, self, iid) => (iid !== self && ownGroup(s, self, iid) && hasAlign(s, iid, 'Liberal') ? 1 : 0),
    immune(s, self, target, source) {
      if (target !== self && s.cards[target]?.master !== self) return false;
      const src = s.cards[source];
      if (!src || src.zone !== 'structure' || src.controller === controllerOf2(s, self)) return false;
      return (hasAlign(s, source, 'Peaceful') || hasAlign(s, source, 'Liberal')) && !hasAttr(s, source, 'Media');
    },
  },

  'brazil': corporateMasterToken,
  'hawaii': corporateMasterToken,
  'china': corporateMasterToken,
  'england': { extraTokens: (_s, self, iid) => (iid === self ? 1 : 0) },

  'california': {
    powerMod: (s, self, iid) => (ownGroup(s, self, iid) && hasAttr(s, iid, 'Media') ? 1 : 0),
  },
  'new-york': {
    powerMod: (s, self, iid) => (iid !== self && ownGroup(s, self, iid) && hasAlign(s, iid, 'Criminal') ? 1 : 0),
  },

  'center-for-disease-control': {
    // Assassins expansion: The Irish Flu says the C.D.C. makes its whole Power Structure immune to it.
    immune: (s, self, target, source) => s.cards[source]?.cardId === 'the-irish-flu' && ownGroup(s, self, target),
    onAttackEnd(s, self, ctx) {
      if (ctx.attacker !== self || ctx.instant || ctx.type !== 'destroy' || ctx.result !== 'failure' || attackCancelled(ctx)) return;
      if (def(s, ctx.target).subtype !== 'Place' || !inStructure(s, self)) return;
      log(s, 'The Center for Disease Control fails to destroy a Place and is destroyed itself.');
      destroyGroup(s, self, ctx.targetPlayer ?? s.cards[ctx.target].owner);
    },
    actions: [{
      id: 'relief',
      label: 'Send Relief to a Devastated Place',
      timing: ['anytime'],
      usesToken: true,
      needs: { target: 'place' },
      check(s, _pl, _self, p) {
        if (!inStructure(s, p.target) || def(s, p.target!).subtype !== 'Place' || !s.cards[p.target!].devastated) return 'Choose a Devastated Place in play.';
        return null;
      },
      apply(s, pl, _self, p) {
        s.cards[p.target!].devastated = false;
        log(s, `${def(s, p.target!).name} is no longer Devastated.`, pl);
      },
    }],
  },

  'dinosaur-park': {
    mayJoin: (s, self, ctx, group, _as) => (group === self || group === s.cards[self].master)
      && (hasAlign(s, ctx.target, 'Corporate') || hasAttr(s, ctx.target, 'Science')),
    actions: [{
      id: 'disaster',
      label: '+4 to a Disaster',
      timing: ['attack'],
      usesToken: true,
      ai: 'boostAttack',
      check: (_s, _pl, _self, _p, ctx) => (ctx?.disaster ? null : 'Use this while a Disaster is being resolved.'),
      apply(s, pl, self, _p, ctx) {
        ctx!.attackBonus.push({ player: pl, plot: abilityEntry(s, self, 'disaster'), forGroup: self, amount: 4, label: 'Dinosaur Park' });
      },
    }],
  },

  'france': freeDefense('France', 'Liberal'),
  'italy': freeDefense('Italy', 'Weird'),

  'germany': {
    // Remember the tokens it saved; if any, it still receives another one this turn.
    onTurnStart(s, self) { s.cards[self].data = { ...s.cards[self].data, saved: s.cards[self].tokens }; },
    extraTokens: (s, self, iid) => (iid === self && Number(s.cards[self].data?.saved ?? 0) > 0 ? 1 : 0),
    actions: [{
      id: 'combine',
      label: 'Spend a saved action to add Germany\'s Power again',
      timing: ['attack'],
      usesToken: true,
      ai: 'boostAttack',
      check(_s, _pl, self, _p, ctx) {
        if (!ctx || ctx.instant) return 'Use this in an attack Germany is taking part in.';
        if (!actingGroups(ctx).includes(self)) return 'Germany must already be attacking, aiding or opposing in this attack.';
        return null;
      },
      apply(s, pl, self, _p, ctx) {
        const opposing = ctx!.oppose.some((o) => o.iid === self);
        (opposing ? ctx!.defenseBonus : ctx!.attackBonus).push({ player: pl, plot: abilityEntry(s, self, 'combine'), forGroup: self, amount: power(s, self), label: 'Germany (saved action)' });
      },
    }],
  },

  'israel': {
    mayJoin: (_s, self, _ctx, group) => group === self,
    mayInterfere: (s, self, pl) => pl === controllerOf2(s, self) && s.cards[self].tokens > 0,
    actions: [{
      id: 'interfere',
      label: 'Interfere in this attack (negates Privilege)',
      timing: ['attack'],
      usesToken: true,
      needs: { modes: ['aid', 'oppose'] },
      ai: 'boostDefense',
      check(_s, _pl, self, p, ctx) {
        if (!ctx) return 'Use this during an attack.';
        if (p.mode !== 'aid' && p.mode !== 'oppose') return 'Choose whether Israel aids or opposes.';
        if (ctx.attacker === self || ctx.target === self || [...ctx.aid, ...ctx.oppose].some((c) => c.iid === self)) return 'Israel is already part of this attack.';
        return null;
      },
      apply(s, pl, self, p, ctx) {
        (p.mode === 'aid' ? ctx!.attackBonus : ctx!.defenseBonus).push({ player: pl, plot: abilityEntry(s, self, 'interfere'), forGroup: self, amount: power(s, self), label: 'Israel interferes' });
        return isPrivileged(ctx!) ? { t: 'unprivilege' } : undefined;
      },
    }],
  },

  'las-vegas': {
    // The house game: wager 1-3 Plots with a rival (target = the rival's Illuminati, mode = how many).
    // 2d6: 7 or more and the house wins, taking that many cards off the top of the rival's Plot deck;
    // 6 or less and the rival takes them off the top of yours. A short deck gives what it has.
    actions: [{
      id: 'bet', label: 'Gamble 1 to 3 Plot cards with a rival on a roll of two dice', timing: ['anytime'], usesToken: true, ai: 'never',
      needs: { target: 'rival', modes: ['1', '2', '3'] },
      check(s, pl, _self, p) {
        const r = vegasRival(s, pl, p);
        if (!r) return 'Choose the rival to gamble with.';
        if (protectedPlayer(s, pl, r)) return 'That player has not finished a first turn yet.';
        if (!['1', '2', '3'].includes(p.mode ?? '')) return 'Choose how many Plot cards to bet: 1, 2 or 3.';
        return null;
      },
      apply(s, pl, self, p) {
        const r = vegasRival(s, pl, p)!;
        const n = Number(p.mode);
        const dice = roll2d6(s);
        const total = dice[0] + dice[1];
        const [winner, loser] = total >= 7 ? [pl, r] : [r, pl];
        const from = player(s, loser).plotDeck;
        let got = 0;
        for (; got < n && from.length; got++) {
          const c = from.shift()!;
          Object.assign(s.cards[c], { zone: 'hand', exposed: false });
          player(s, winner).hand.push(c);
        }
        log(s, `${cardName(s, self)}: ${player(s, pl).name} bets ${n} Plot card${n === 1 ? '' : 's'} with ${player(s, r).name} and rolls ${dice[0]}+${dice[1]} = ${total}. `
          + `${total >= 7 ? 'The house wins' : `${player(s, r).name} beats the house`}: ${player(s, winner).name} takes ${got} from the top of ${player(s, loser).name}'s Plot deck.`, pl);
      },
    }],
  },

  'moonbase': {
    ...moonbaseDisasters,
    attackMod(s, self, ctx, side) {
      if (side !== 'defense') return 0;
      if (moonbaseDisasters.attackMod!(s, self, ctx, side)) return 999;
      // Linked Personalities: +6 against Assassination (not against Voudonistas, whose Magic ignores it).
      if (!ctx.assassination || !moonbaseLinks(s, self).includes(ctx.target)) return 0;
      return ctx.aid.some((a) => a.iid && s.cards[a.iid].cardId === 'voudonistas') ? 0 : 6;
    },
    onDestroy(s, self, victim, by) {
      if (victim !== self) return;
      for (const p of moonbaseLinks(s, self)) {
        const c = s.cards[p];
        if (c.zone === 'structure') { log(s, `${def(s, p).name} dies with Moonbase.`); c.killed = true; destroyGroup(s, p, by); }
        else if (c.zone === 'hand') {
          for (const x of s.players) x.hand = x.hand.filter((i) => i !== p);
          Object.assign(c, { zone: 'destroyed', controller: undefined, killed: true, tokens: 0, mods: [] });
          log(s, `${def(s, p).name} dies with Moonbase.`);
        }
      }
      s.cards[self].data = { ...s.cards[self].data, linked: [] };
    },
    actions: [{
      id: 'link',
      label: 'Link a Personality to Moonbase',
      timing: ['main'],
      usesToken: false,
      needs: { target: 'ownGroup' },
      ai: 'never',
      check(s, pl, self, p) {
        if (!p.target || !inStructure(s, p.target) || s.cards[p.target].controller !== pl || def(s, p.target).subtype !== 'Personality') return 'Choose a Personality you control.';
        if (moonbaseLinks(s, self).includes(p.target)) return 'That Personality is already linked to Moonbase.';
        return null;
      },
      apply(s, _pl, self, p) {
        s.cards[self].data = { ...s.cards[self].data, linked: [...moonbaseLinks(s, self).filter((x) => s.cards[x].zone === 'structure'), p.target!] };
      },
    }],
  },

  'orbit-one': {
    ...disasterImmunity(['nuclear-accident', 'meteor-strike'], null),
    extraPlotDraws: (s, self) => puppets(s, self).filter((g) => hasAttr(s, g, 'Science')).length,
  },
  'pentagon': {
    extraPlotDraws: (s, self) => puppets(s, self).filter((g) => hasAlign(s, g, 'Corporate')).length,
  },

  'russia': {
    // Also works while Russia is attacked from its owner's hand.
    asTarget: (s, self, ctx, side) => (side === 'attack' && !ctx.instant && ctx.type === 'control' && ctx.target === self
      && !!ctx.attacker && !cancelledGroups(ctx).has(ctx.attacker) && hasAttr(s, ctx.attacker, 'Communist') ? 4 : 0),
  },

  'silicon-valley': {
    actions: [{
      id: 'draw',
      label: 'Draw an extra Plot',
      timing: ['main'],
      usesToken: true,
      ai: 'draw',
      check: (s, pl) => (player(s, pl).plotDeck.length ? null : 'Your Plot deck is empty.'),
      apply(s, pl) { drawPlot(s, player(s, pl)); log(s, `${player(s, pl).name} draws a Plot with Silicon Valley.`, pl); },
    }],
  },

  'switzerland': {
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || ctx.instant) return 0;
      const ctrl = controllerOf2(s, self);
      return ctrl && !isGnomes(s, ctrl) && ctx.attackerPlayer === ctrl && isGnomes(s, ctx.targetPlayer) ? 2 : 0;
    },
    // The Gnomes' +15 also works while Switzerland is attacked from hand.
    asTarget: (s, self, ctx, side) => (side === 'attack' && !ctx.instant && ctx.type === 'control' && ctx.target === self
      && !!ctx.attacker && !cancelledGroups(ctx).has(ctx.attacker) && s.cards[ctx.attacker].cardId === 'gnomes-of-zurich' ? 15 : 0),
    preventDestroy: (s, self, target, ctx) => target === self && !!ctx && isGnomes(s, ctx.attackerPlayer),
  },

  'the-great-pyramid': {
    ...disasterImmunity(null, ['tornado', 'hurricane']),
    // Each rival shows you the first Plot he draws each turn; you forget it when the next turn starts.
    onDraw(s, self, pl, deck, card) {
      const me = controllerOf2(s, self);
      if (deck !== 'plot' || !me || pl === me) return;
      const d = s.cards[self].data ?? {};
      const seen = (d.seen as Record<string, number> | undefined) ?? {};
      if (seen[pl] === s.turn) return;
      s.cards[self].data = { ...d, seen: { ...seen, [pl]: s.turn }, shown: [...((d.shown as string[] | undefined) ?? []), card] };
      revealTo(s, me, [card], `The Great Pyramid shows you the first Plot ${player(s, pl).name} drew this turn`);
    },
    onEvent(s, self, e) { if (e.type === 'turnStart') forgetShown(s, self); },
  },

  'pyramid-marketing-schemes': {
    resistanceMod(s, self, iid) {
      const pl = controllerOf2(s, self);
      return iid === self && pl ? 2 * countControlled(s, pl, (g) => hasAlign(s, g, 'Fanatic')) : 0;
    },
  },

  'trading-card-games': {
    actions: [{
      id: 'replace',
      label: 'Replace it with a Group from your hand',
      timing: ['main'],
      usesToken: false,
      needs: { target: 'group' },
      ai: 'never',
      check(s, pl, _self, p) {
        if (!p.target || !player(s, pl).hand.includes(p.target) || def(s, p.target).type !== 'Group') return 'Choose a Group card in your hand.';
        if (!canEnterPlay(s, p.target)) return 'That Group is already in play or was destroyed.';
        return null;
      },
      apply(s, pl, self, p) {
        const c = s.cards[self];
        const side = sideOf(s, self)!;
        const master = c.master!;
        for (const r of Object.values(s.cards)) if (r.linkedTo === self && r.zone === 'resources') r.linkedTo = p.target;
        discardCard(s, self);
        Object.assign(c, { x: undefined, y: undefined, rot: undefined, side: undefined });
        placeGroup(s, p.target!, pl, master, side);
        log(s, `${def(s, p.target!).name} takes the place of Trading Card Games.`, pl);
        hooksOf(s, p.target!)?.onEnterPlay?.(s, p.target!);
      },
    }],
  },
});
