import type { Alignment, AttackCtx, GameState } from '../types';
import { attackingGroups, registerAbilities } from '../abilities';
import { type ActivatedAbility, type CardHooks, hooksOf, registerHooks } from '../hooks';
import { def } from '../cards';
import { alignments, attributes, countControlled, globalPower, isOpposite, power } from '../stats';
import { NWO_EFFECTS } from '../nwo';
import { DELTA, SIDES, puppets } from '../geometry';
import { rollDie } from '../rng';
import {
  attackCancelled, canEnterPlay, cancelledGroups, controllerOf2, destroyGroup, discardCard, drawPlot, isPrivileged, log,
  placeGroup, player,
} from '../game';

registerAbilities({
  'voudonistas': [
    { kind: 'attackBonus', on: 'destroy', target: { subtypes: ['Personality'] }, value: 8, scope: 'direct' },
    { kind: 'pending', note: 'Assassination defenses from other cards that are not specifically anti-Magic still apply against it (only Moonbase honours this); needs defenses tagged as Magic-specific' },
  ],
  'wall-street': [],
  'wargamers': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Computer'] }, value: 2, scope: 'direct' },
  ],
  'w-i-t-c-h': [],
  'al-gore': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Green'] }, value: 8, scope: 'direct' },
  ],
  'bill-clinton': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Government'] }, value: 8, scope: 'direct' },
    { kind: 'pending', note: '+3 to control U.S. Government groups (no U.S. attribute); Liberal status determined by die roll when relevant' },
  ],
  'bjorne': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Media'] }, value: 4, scope: 'direct' },
  ],
  'count-dracula': [
    { kind: 'attackBonus', on: 'control', target: { names: ['vampires'] }, value: 10, scope: 'direct' },
    { kind: 'pending', note: 'Linked Magic Artifacts cannot be taken from him or lost while he lives (needs a hook protecting Resources from being stolen or discarded)' },
  ],
  'dan-quayle': [],
  'elvis': [
    { kind: 'attackBonus', on: 'control', target: { names: ['church-of-elvis'] }, value: 6, scope: 'direct' },
  ],
  'fidel-castro': [
    { kind: 'pending', note: 'May hide one Plot linked beneath him (unexposable); may relink after the Plot is used' },
  ],
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
    { kind: 'attackBonus', on: 'control', target: { names: ['international-cocaine-smugglers'] }, value: 6, scope: 'direct' },
  ],
  'margaret-thatcher': [
    { kind: 'attackBonus', on: 'control', target: { names: ['england'] }, value: 10, scope: 'direct' },
  ],
  'media-sensation': [
    { kind: 'pending', note: 'Multiple copies legal with unique Personality names; destroying one does not count toward Goals' },
  ],
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
    { kind: 'pending', note: 'After he makes/aids an attack, Media groups cannot join the opposite side' },
  ],
  'ross-perot': [
    { kind: 'pending', note: 'Groups he controls become Straight and Conservative, losing Weird/Liberal, until they get a new master' },
  ],
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
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Science'] }, value: 2, scope: 'direct' },
  ],
  'hawaii': [],
  'hollywood': [
    { kind: 'powerPer', per: { attributes: ['Media'], subtypes: ['Personality'] }, value: 2, global: true },
  ],
  'israel': [
    { kind: 'attackBonus', on: 'control', target: { names: ['mossad'] }, value: 8, scope: 'direct' },
  ],
  'italy': [],
  'japan': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Science', 'Computer'] }, value: 6, scope: 'direct' },
  ],
  'las-vegas': [
    { kind: 'pending', note: 'Action: wager 1-3 Plots against a rival, resolve 2d6 card-transfer gamble' },
  ],
  'moonbase': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Space'] }, value: 4, scope: 'direct' },
  ],
  'new-york': [],
  'orbit-one': [],
  'pentagon': [],
  'russia': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Communist'] }, value: 4, scope: 'direct' },
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Communist'] }, value: 2, scope: 'any' },
    { kind: 'pending', note: 'Communist +4 on direct control of Russia works only while Russia is in play, not when it is attacked from hand (hooks of a card in hand are inactive)' },
  ],
  'silicon-valley': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 4, scope: 'direct' },
  ],
  'stonehenge': [
    { kind: 'structureImmune', from: { attributes: ['Magic'] } },
    { kind: 'pending', note: 'Also immune to effects of Magic Plots and Resources' },
  ],
  'switzerland': [
    { kind: 'pending', note: 'Gnomes +15 direct control works only while Switzerland is in play, not when it is attacked from hand (hooks of a card in hand are inactive)' },
  ],
  'texas': [
    { kind: 'pending', note: 'May hide one non-Goal Plot beneath it beyond hand limit, unexposable, swappable; lost if Texas is captured/destroyed' },
  ],
  'vatican-city': [
    { kind: 'structureImmune', from: { alignments: ['Peaceful'] } },
  ],
  'the-great-pyramid': [
    { kind: 'pending', note: 'Rivals must show you the first Plot they draw each turn (needs private reveals to one player)' },
  ],
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
  let same = 0, opp = 0;
  for (const p of new Set(mine)) {
    if (theirs.includes(p) && p !== 'Fanatic') same++;
    for (const q of theirs) if (isOpposite(p, q)) opp++;
  }
  let perSame = 4, perOpp = 4;
  for (const n of Object.values(s.nwo)) {
    const v = n ? NWO_EFFECTS[s.cards[n].cardId]?.alignmentValues?.() : undefined;
    if (v) { perSame = v.same; perOpp = v.opposite; }
  }
  return type === 'control' ? same * perSame - opp * perOpp : opp * perOpp - same * perSame;
}
/** May a Group with alignments `mine` aid this kind of attack on a target with `theirs` (R006)? */
function alignQualifies(mine: Alignment[], theirs: Alignment[], type: AttackCtx['type']): boolean {
  return type === 'control'
    ? mine.some((a) => a !== 'Fanatic' && theirs.includes(a))
    : mine.some((a) => theirs.some((b) => isOpposite(a, b)));
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

const moonbaseDisasters = disasterImmunity(['nuclear-accident', 'meteor-strike'], null);

registerHooks({
  'voudonistas': {
    // +4 on an Assassination it joins.
    attackMod: (s, self, ctx, side) =>
      (side === 'attack' && ctx.assassination && ctx.aid.some((a) => a.iid === self) && !cancelledGroups(ctx).has(self) ? 4 : 0),
  },

  'wall-street': {
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || ctx.instant || ctx.attacker !== self || cancelledGroups(ctx).has(self)) return 0;
      const ta = alignments(s, ctx.target), mine = alignments(s, self);
      const base = alignValue(s, mine, ta, ctx.type);
      return Math.max(...wallStreetVariants(mine).map((v) => alignValue(s, v, ta, ctx.type))) - base;
    },
    mayJoin: (s, self, ctx, group, as) => as === 'aid' && group === self && !ctx.instant
      && wallStreetVariants(alignments(s, self)).some((v) => alignQualifies(v, alignments(s, ctx.target), ctx.type)),
    resistanceMod: (s, self, iid) => (s.cards[iid].master === self && inStructure(s, iid) ? 10 : 0),
  },

  'wargamers': {
    actions: [{
      id: 'bury',
      label: 'Put an exposed Plot on the bottom of its owner\'s deck',
      timing: ['anytime'],
      usesToken: true,
      needs: { target: 'plot' },
      ai: 'never',
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

  'bjorne': {
    extraTokens: (s, self, iid) => (iid === self ? puppets(s, self).filter((g) => hasAttr(s, g, 'Media')).length : 0),
    onDestroy(s, self, victim, by) {
      if (victim !== self) return;
      const n = power(s, self);
      if (n > 0) { drawPlot(s, player(s, by), n); log(s, `${player(s, by).name} draws ${n} Plot${n === 1 ? '' : 's'} for destroying Bjorne.`, by); }
    },
  },

  'count-dracula': {
    preventDestroy(s, self, target, ctx) {
      if (target !== self) return false;
      if (!ctx) return true;
      const gone = cancelledGroups(ctx);
      const magicGroup = attackingGroups(ctx).some((g) => !gone.has(g) && hasAttr(s, g, 'Magic'));
      const magicCard = !!ctx.instantCard && MAGIC_DESTROYERS.includes(s.cards[ctx.instantCard]?.cardId);
      return !(magicGroup || magicCard);
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
      && alignQualifies([...alignments(s, group), ...alignments(s, self)], alignments(s, ctx.target), ctx.type),
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
      ai: 'never',
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

  'france': {
    mayJoin: (s, self, ctx, group, as) => as === 'oppose' && group === self && ownGroup(s, self, ctx.target) && hasAlign(s, ctx.target, 'Liberal'),
  },
  'italy': {
    mayJoin: (s, self, ctx, group, as) => as === 'oppose' && group === self && ownGroup(s, self, ctx.target) && hasAlign(s, ctx.target, 'Weird'),
  },

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
    attackMod: (s, self, ctx, side) => (side === 'attack' && !ctx.instant && ctx.type === 'control' && ctx.target === self
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
      let n = 0;
      if (ctx.type === 'control' && ctx.target === self && ctx.attacker && s.cards[ctx.attacker].cardId === 'gnomes-of-zurich') n += 15;
      const ctrl = controllerOf2(s, self);
      if (ctrl && !isGnomes(s, ctrl) && ctx.attackerPlayer === ctrl && isGnomes(s, ctx.targetPlayer)) n += 2;
      return n;
    },
    preventDestroy: (s, self, target, ctx) => target === self && !!ctx && isGnomes(s, ctx.attackerPlayer),
  },

  'the-great-pyramid': disasterImmunity(null, ['tornado', 'hurricane']),

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
        const c = s.cards[self], m = s.cards[c.master!];
        const side = SIDES.find((sd) => m.x! + DELTA[sd][0] === c.x && m.y! + DELTA[sd][1] === c.y)!;
        const master = c.master!;
        for (const r of Object.values(s.cards)) if (r.linkedTo === self && r.zone === 'resources') r.linkedTo = p.target;
        discardCard(s, self);
        Object.assign(c, { x: undefined, y: undefined, rot: undefined });
        placeGroup(s, p.target!, pl, master, side);
        log(s, `${def(s, p.target!).name} takes the place of Trading Card Games.`, pl);
        hooksOf(s, p.target!)?.onEnterPlay?.(s, p.target!);
      },
    }],
  },
});
