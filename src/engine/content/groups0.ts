import type { AttackCtx, Contribution, GameState } from '../types';
import { attackingGroups, matches, registerAbilities, abilitiesOf, type Match } from '../abilities';
import { registerHooks, HOOKS, type AbilityParams } from '../hooks';
import { def, cardName, OPPOSITE } from '../cards';
import { alignments, globalPower, power, resistance } from '../stats';
import { openArrows, structureCards } from '../geometry';
import { nextRandom, roll2d6 } from '../rng';
import {
  attackCancelled, cancelledGroups, canEnterPlay, controllerOf2, currentOutcome, destroyGroup, discardCard,
  drawGroup, drawPlot, livePlayers, log, placeGroup, player, playResourceCard, protectedPlayer,
} from '../game';
import { disasterTarget, exposableHand, exposeCards } from '../game';
import { magicByCard } from '../hooks';

registerAbilities({
  'a-m-a': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Science'] }, value: 5, scope: 'direct' },
    { kind: 'aidBonus', on: 'both', target: { attributes: ['Science'] }, value: 5 },
  ],
  'american-autoduel-association': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Violent'] }, value: 4, scope: 'direct', replacesAlignmentPenalty: true },
    { kind: 'aidBonus', on: 'destroy', target: { alignments: ['Violent'] }, value: 4 },
  ],
  'anti-nuclear-activists': [
    { kind: 'attackBonus', on: 'destroy', target: { attributes: ['Science'] }, value: 6, scope: 'any' },
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Green'] }, value: 4, scope: 'any' },
  ],
  'anti-war-activists': [
    // Extra Resistance: it only counts against Attacks to Control (an Attack to Destroy is defended with Power).
    { kind: 'structureDefense', value: 4, on: 'control', vs: { alignments: ['Government'] } },
  ],
  'bank-of-england': [],
  'b-a-t-f': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Fanatic'] }, value: 8, scope: 'direct' },
    { kind: 'attackBonus', on: 'both', target: { names: ['gun-lobby', 'tobacco-companies', 'liquor-companies'] }, value: 6, scope: 'any' },
  ],
  'big-media': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Media'] }, value: 4, scope: 'any' },
  ],
  'black-activists': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Liberal'] }, value: 2, scope: 'any' },
    { kind: 'selfDefense', value: 4, vs: { alignments: ['Liberal'] } },
  ],
  'boy-sprouts': [],
  'cable-tv': [
    { kind: 'powerPer', per: { subtypes: ['Personality'] }, value: 1, global: true },
  ],
  'cattle-mutilators': [],
  'cfl-aio': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Corporate'] }, value: 10, scope: 'direct', replacesAlignmentPenalty: true },
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Corporate'] }, value: 4, scope: 'any' },
  ],
  'church-of-elvis': [],
  'c-i-a': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Government'], notSelf: true }, value: 4, scope: 'direct', replacesAlignmentPenalty: true },
  ],
  'clone-arrangers': [
    { kind: 'attackBonus', on: 'control', target: { subtypes: ['Personality'] }, value: 4, scope: 'any' },
  ],
  'comic-books': [],
  'congressional-wives': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Government'] }, value: 10, scope: 'direct' },
  ],
  'conspiracy-theorists': [
    { kind: 'handLimit', value: 1 },
  ],
  'cycle-gangs': [
    { kind: 'attackBonus', on: 'destroy', value: 2, scope: 'any' },
  ],
  'democrats': [],
  'dentists': [],
  'deprogrammers': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Weird', 'Fanatic'] }, value: 4, scope: 'any' },
    { kind: 'attackBonus', on: 'destroy', target: { allAlignments: ['Weird', 'Fanatic'] }, value: 4, scope: 'any' },
  ],
  'druids': [
  ],
  'eco-guerrillas': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Corporate'] }, value: 6, scope: 'direct' },
    // It raises Resistance, which only counts against Attacks to Control.
    { kind: 'structureDefense', value: 2, vs: { alignments: ['Corporate'] }, on: 'control' },
  ],
  'eff': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 4, scope: 'direct' },
  ],
  'elders-of-zion': [],
  'empty-vee': [],
  'evil-geniuses-for-a-better-tomorrow': [],
  'fast-food-chains': [
    { kind: 'attackBonus', on: 'destroy', target: { attributes: ['Green'] }, value: 6, scope: 'any' },
  ],
  'fbi': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Criminal'] }, value: 10, scope: 'direct' },
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Criminal'] }, value: 4, scope: 'any' },
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Criminal'] }, value: 2, scope: 'any' },
  ],
  'federal-reserve': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Bank'] }, value: 6, scope: 'any' },
  ],
  'feminists': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Liberal'] }, value: 3, scope: 'any' },
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Conservative'] }, value: 3, scope: 'any' },
  ],
  'fiendish-fluoridators': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Straight', 'Conservative'] }, value: 5, scope: 'any' },
    { kind: 'drawPlotOnDestroy', match: { alignments: ['Straight', 'Conservative'] } },
  ],
  'flat-earthers': [],
  'fnord-motor-company': [],
  'fraternal-orders': [],
  'fred-birch-society': [],
  'gay-activists': [],
  'girlie-magazines': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Straight'] }, value: 5, scope: 'direct' },
  ],
  'goldfish-fanciers': [
    { kind: 'structureImmune', from: { alignments: ['Fanatic'] } },
  ],
  'gun-lobby': [],
  'hackers': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 4, scope: 'direct' },
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Computer'] }, value: 2, scope: 'any' },
  ],
  'intellectuals': [],
  // International Cocaine Smugglers' +4 (it also covers the puppets of the named Groups) is scripted below.
  // The printed invitation to extend it to Personalities by agreement between players is not encoded:
  // this version has no player-to-player agreements.
  'international-cocaine-smugglers': [],
  'international-communist-conspiracy': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Communist'] }, value: 3, scope: 'any' },
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Fanatic'], attributes: ['Communist'] }, value: 4, scope: 'direct', replacesAlignmentPenalty: true },
  ],
  'international-weather-organization': [],
  'i-r-s': [],
  'joggers': [
    { kind: 'cannotBeDestroyed' },
  ],
  // Junk Mail's +6 against Secret Groups is scripted below: it must work in Secret attacks (R014).
  'junk-mail': [],
  'kkk': [],
  'l-4-society': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Science', 'Space'] }, value: 4, scope: 'any' },
  ],
  'lawyers': [
    { kind: 'structureDefense', value: 4, vs: { alignments: ['Government', 'Corporate'] } },
  ],
  'libertarians': [],
  'liquor-companies': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Media'] }, value: 4, scope: 'direct' },
  ],
  'loan-sharks': [
    { kind: 'powerPer', per: { alignments: ['Criminal'] }, value: 1 },
  ],
  'local-police-departments': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Criminal'] }, value: 4, scope: 'any' },
    { kind: 'cannotBeDestroyed' },
  ],
});


// ---------------------------------------------------------------- scripted parts

const ctl = (s: GameState, self: string) => controllerOf2(s, self);
const is = (s: GameState, iid: string | undefined, m: Match) => !!iid && !!s.cards[iid] && matches(s, iid, m);
const hasAlign = (s: GameState, iid: string | undefined, a: string) => !!iid && alignments(s, iid).includes(a as never);
const own = (s: GameState, pl: string, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure' && s.cards[iid].controller === pl;
const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';

/** The Group's action in this attack still counts (it has not been cancelled). */
const live = (ctx: AttackCtx, iid: string) => !cancelledGroups(ctx).has(iid);
/** `self` leads this (normal) attack or aids it. */
const onAttack = (ctx: AttackCtx, self: string) => live(ctx, self) && (ctx.attacker === self || ctx.aid.some((c) => c.iid === self));

/** Power a Group put into the attack, measured the same way the engine does. */
function contribPower(s: GameState, c: Contribution & { useGlobal?: boolean; selfDefense?: boolean }): number {
  if (!c.iid) return c.amount;
  const v = c.useGlobal ? globalPower(s, c.iid)
    : power(s, c.iid, c.selfDefense ? { defense: true, selfDefense: true, noDefenseAdds: true } : {});
  return v + c.amount;
}

/**
 * What `self`'s own attackBonus entries already add to this attack, as the engine counts them: the
 * larger of its "direct" and "any attempt" totals when it leads, else its "any attempt" total
 * (for "instead of" upgrades).
 */
function ownBonus(s: GameState, self: string, ctx: AttackCtx): number {
  let direct = 0, any = 0;
  for (const a of abilitiesOf(s, self)) {
    if (a.kind !== 'attackBonus' || !(a.on === 'both' || a.on === ctx.type) || !matches(s, ctx.target, a.target, self)) continue;
    if (a.scope === 'any') any += a.value; else direct += a.value;
  }
  return ctx.attacker === self ? Math.max(direct, any) : any;
}
/** A normal attack led by one of the Groups of `self`'s controller (where "any attempt" bonuses apply). */
const ledByOwner = (s: GameState, self: string, ctx: AttackCtx) =>
  !ctx.instant && !!ctx.attacker && ctx.attackerPlayer === ctl(s, self);

const isSpaceDisaster = (s: GameState, plot?: string) =>
  !!plot && !!s.cards[plot] && ((def(s, plot).attributes ?? []).includes('Space') || /\bSpace Disaster\b/i.test(def(s, plot).text));

/** The rival an ability is aimed at: the controller/owner of the chosen card, or the only rival. */
function rivalFor(s: GameState, pl: string, p: AbilityParams): string | null {
  if (p.target && s.cards[p.target]) {
    const c = s.cards[p.target];
    const r = c.controller ?? c.owner;
    return r !== pl && !player(s, r).eliminated ? r : null;
  }
  const rivals = livePlayers(s).filter((x) => x.id !== pl);
  return rivals.length === 1 ? rivals[0].id : null;
}
/** The Lawyers make their controller immune to the I.R.S. */
const lawyered = (s: GameState, pl: string) => structureCards(s, pl).some((g) => s.cards[g].cardId === 'lawyers');
/** Tax Reform (a New World Order) is in play. */
const taxReform = (s: GameState) => Object.values(s.nwo).some((iid) => !!iid && s.cards[iid]?.cardId === 'tax-reform' && s.cards[iid].zone === 'table');
/** Rivals the I.R.S. can tax under Tax Reform. */
const taxable = (s: GameState, pl: string) => livePlayers(s)
  .filter((r) => r.id !== pl && !protectedPlayer(s, pl, r.id) && !lawyered(s, r.id) && r.plotDeck.length).map((r) => r.id);
const rivalError = (s: GameState, pl: string, r: string | null) =>
  !r ? 'Choose a card of the rival you want to target.' : protectedPlayer(s, pl, r) ? 'That player has not finished a first turn yet.' : null;

/** `target` is in the Power Structure of the Discordian Society. */
const discordianTarget = (s: GameState, target: string) => {
  const c = s.cards[target];
  return c?.zone === 'structure' && !!c.controller && s.cards[player(s, c.controller).illuminati].cardId === 'discordian-society';
};

const isGadget = (s: GameState, iid: string) => def(s, iid).type === 'Resource' && /\bGadget\b/.test(`${def(s, iid).notes ?? ''} ${def(s, iid).text}`);

/** The Groups (and, through them, their puppets) International Cocaine Smugglers gets +4 to control. */
const COCAINE_CLIENTS = ['punk-rockers', 'cycle-gangs', 'urban-gangs', 'hollywood', 'manuel-noriega'];

/** The Place cards that stand for U.S. states (Libertarians). */
const US_STATES = ['california', 'texas', 'new-york'];

registerHooks({
  'a-m-a': {
    // May help defend or help attack any Science group, whatever the alignments.
    mayJoin: (s, self, ctx, group) => group === self && !ctx.instant && ctx.target !== self && is(s, ctx.target, { attributes: ['Science'] }),
    // +5 when aiding a Science group against control or destruction (i.e. helping defend it).
    // (The +5 when it helps attack one is its aidBonus.)
    attackMod: (s, self, ctx, side) =>
      side === 'defense' && !ctx.instant && ctx.target !== self && is(s, ctx.target, { attributes: ['Science'] })
        && live(ctx, self) && ctx.oppose.some((c) => c.iid === self) ? 5 : 0,
  },

  'anti-nuclear-activists': {
    // +10 on any attempt against Nuclear Power Companies, instead of (not on top of) its other bonuses.
    attackMod: (s, self, ctx, side) =>
      side === 'attack' && ledByOwner(s, self, ctx) && s.cards[ctx.target].cardId === 'nuclear-power-companies'
        ? Math.max(0, 10 - ownBonus(s, self, ctx)) : 0,
  },

  'bank-of-england': {
    actions: [{
      id: 'draw', label: 'Draw two Plot cards', timing: ['anytime'], usesToken: true, ai: 'draw',
      check: (s, pl) => (player(s, pl).plotDeck.length ? null : 'Your Plot deck is empty.'),
      apply: (s, pl, self) => { drawPlot(s, player(s, pl), 2); log(s, `${cardName(s, self)} draws two Plot cards.`, pl); },
    }],
  },

  'big-media': {
    mayJoin: (s, self, ctx, group) =>
      group === self && (is(s, ctx.attacker, { attributes: ['Media'] }) || is(s, ctx.target, { attributes: ['Media'] })),
  },

  'boy-sprouts': {
    // Relief sent with the Boy Sprouts: their Power counts as 12 and their controller draws a Plot.
    actions: [{
      id: 'relief', label: 'Send Relief (Power counts as 12, draw a Plot)', timing: ['main', 'attack'], usesToken: true,
      needs: { target: 'place' },
      check(s, pl, self, p) {
        const place = p.target;
        if (!inPlay(s, place) || def(s, place!).subtype !== 'Place' || !s.cards[place!].devastated) return 'Choose a Devastated Place.';
        const pay = p.payWith ?? [];
        if (new Set(pay).size !== pay.length || pay.includes(self)) return 'Each other Group can help only once.';
        if (!pay.every((g) => own(s, pl, g) && s.cards[g].tokens > 0)) return 'Each Group helping with Relief must be yours and have an Action token.';
        const need = 3 * (def(s, place!).power ?? 0);
        const total = 12 + pay.reduce((n, g) => n + power(s, g), 0);
        return total >= need ? null : `Relief needs ${need} Power in total; the Boy Sprouts count as 12, so add Groups worth ${need - total} more.`;
      },
      apply(s, pl, _self, p) {
        for (const g of p.payWith ?? []) s.cards[g].tokens--;
        s.cards[p.target!].devastated = false;
        log(s, `${cardName(s, p.target!)} is no longer Devastated.`, pl);
        drawPlot(s, player(s, pl));
      },
    }],
  },

  'cattle-mutilators': {
    actions: [{
      id: 'expose', label: 'Expose all hidden Plots of one rival', timing: ['main'], usesToken: true, ai: 'never',
      needs: { target: 'rivalGroup' },
      check(s, pl, _self, p) {
        const r = rivalFor(s, pl, p);
        const err = rivalError(s, pl, r);
        if (err) return err;
        return exposableHand(s, r!, 'Plot').length ? null : 'That rival has no hidden Plots.';
      },
      apply(s, pl, _self, p) {
        const r = player(s, rivalFor(s, pl, p)!);
        const plots = exposeCards(s, exposableHand(s, r.id, 'Plot'));
        log(s, `${r.name} must expose ${plots.length} Plot${plots.length === 1 ? '' : 's'}: ${plots.map((c) => cardName(s, c)).join(', ')}.`, pl);
      },
    }],
  },

  'church-of-elvis': {
    // Power becomes 4 while Elvis is in play, 8 while you control him.
    powerMod(s, self, iid) {
      if (iid !== self) return 0;
      const elvis = Object.values(s.cards).find((c) => c.cardId === 'elvis' && c.zone === 'structure');
      if (!elvis) return 0;
      const target = elvis.controller === ctl(s, self) ? 8 : 4;
      return Math.max(0, target - (def(s, self).power ?? 0));
    },
  },

  'c-i-a': {
    actions: [{
      id: 'assassinate', label: 'Make this an Assassination (Instant attack)', timing: ['attack'], usesToken: false,
      check(s, pl, self, _p, ctx) {
        if (!ctx || ctx.instant || ctx.attacker !== self || ctx.attackerPlayer !== pl || ctx.type !== 'destroy') return 'Only when the C.I.A. itself attacks to destroy.';
        if (def(s, ctx.target).subtype !== 'Personality') return 'Only an attack on a Personality can become an Assassination.';
        if (ctx.aid.length || ctx.oppose.length) return 'Too late: decide before anyone aids or opposes.';
        return null;
      },
      apply(s, _pl, self, _p, ctx) {
        const c = ctx!;
        c.assassination = true;
        c.instant = true;
        c.instantPower = power(s, self);
        c.instantDefense = power(s, c.target, { defense: true, halve: !!s.cards[c.target].devastated });
      },
    }],
  },

  'clone-arrangers': {
    onDestroy(s, self, victim) {
      if (def(s, victim).subtype === 'Personality' && s.cards[victim].killed) s.cards[self].data = { ...s.cards[self].data, justKilled: victim, turn: s.turn };
    },
    actions: [{
      id: 'clone', label: 'Restore the Personality just killed', timing: ['anytime'], usesToken: true,
      needs: { target: 'ownGroup' },
      check(s, pl, self, p) {
        const d = s.cards[self].data;
        const v = d?.justKilled as string | undefined;
        if (!v || d?.turn !== s.turn || s.cards[v].zone !== 'destroyed' || !s.cards[v].killed) return 'No Personality has just been killed.';
        if (!own(s, pl, p.target) || !openArrows(s, p.target!).length) return 'Choose one of your cards with an open control arrow.';
        return null;
      },
      apply(s, pl, self, p) {
        const v = s.cards[self].data!.justKilled as string;
        for (const x of s.players) x.destroyedCredit = x.destroyedCredit.filter((i) => i !== v);
        Object.assign(s.cards[v], { killed: false, mods: [], tokens: 0, capturedTurn: s.turn });
        placeGroup(s, v, pl, p.target!, openArrows(s, p.target!)[0]);
        s.cards[self].data = { ...s.cards[self].data, justKilled: undefined };
        log(s, `${cardName(s, v)} is cloned back to life and no longer counts as destroyed.`, pl);
      },
    }],
  },

  'comic-books': {
    // Attacking (or aiding) control of a Weird group: its printed Resistance counts as 0 and it
    // gets no bonus from a Weird master.
    attackMod(s, self, ctx, side) {
      if (side !== 'defense' || ctx.instant || ctx.type !== 'control' || !hasAlign(s, ctx.target, 'Weird') || !onAttack(ctx, self)) return 0;
      let n = -Math.min(def(s, ctx.target).resistance ?? 0, resistance(s, ctx.target));
      const m = s.cards[ctx.target].master;
      if (!ctx.fromHand && m && def(s, m).type === 'Group' && hasAlign(s, m, 'Weird')) n -= 4;
      return n;
    },
  },

  'cycle-gangs': {
    attackMod: (s, self, ctx, side) =>
      side === 'attack' && !!ctx.disaster && ctx.attackerPlayer === ctl(s, self) && !isSpaceDisaster(s, ctx.instantCard) ? 4 : 0,
  },

  'democrats': {
    attackMod: (s, self, ctx, side) =>
      side === 'attack' && !ctx.instant && ctx.type === 'control' && ctx.attacker === self
        && hasAlign(s, ctx.target, 'Government') && !is(s, ctx.target, { attributes: ['Nation'] }) ? 4 : 0,
  },

  'dentists': {
    actions: [{
      id: 'cancel', label: 'Cancel the action of a Personality', timing: ['attack'], usesToken: true, ai: 'cancelAttacker',
      needs: { target: 'personality' },
      check(s, _pl, _self, p, ctx) {
        const t = p.target;
        if (!ctx || !t || !s.cards[t] || def(s, t).subtype !== 'Personality') return 'Choose a Personality taking part in this attack.';
        const acting = ctx.attacker === t || [...ctx.aid, ...ctx.oppose].some((c) => c.iid === t);
        if (!acting) return `${cardName(s, t)} has not used an action in this attack.`;
        if (!live(ctx, t)) return 'That action is already cancelled.';
        return null;
      },
      apply: (_s, _pl, _self, p) => ({ t: 'cancelGroup', group: p.target! }),
    }],
  },

  'deprogrammers': {
    // The Discordians' protection against Straight Groups does not stop the Deprogrammers.
    ignoreImmunity: (s, self, attacker, target) => attacker === self && discordianTarget(s, target),
  },

  'druids': {
    mayJoin: (s, self, ctx, group) =>
      group === self && (is(s, ctx.attacker, { attributes: ['Magic'] }) || is(s, ctx.target, { attributes: ['Magic'] }) || magicByCard(s, ctx)),
    // They may help in attacks by or against Magic Groups even when those are Secret (not lead an attack on one).
    secretOverride: (s, self, group, secret) => !!s.attack && group === self && is(s, secret, { attributes: ['Magic'] }),
    attackMod(s, self, ctx, side) {
      const place = s.cards[self].data?.place as string | undefined;
      return side === 'defense' && !!ctx.disaster && !!place && ctx.target === place && inPlay(s, place) ? 8 : 0;
    },
    onDestroy(s, self, victim, by) {
      if (s.cards[self].data?.place !== victim || s.cards[self].zone !== 'structure') return;
      log(s, `${cardName(s, self)} are destroyed along with ${cardName(s, victim)}.`);
      destroyGroup(s, self, by);
    },
    onCapture(s, self, victim) { if (victim === self && s.cards[self].data) s.cards[self].data = { ...s.cards[self].data, place: undefined }; },
    actions: [{
      id: 'link', label: 'Link to any Place in play', timing: ['main'], usesToken: false, oncePerTurn: true,
      needs: { target: 'place' },
      check: (s, _pl, self, p) =>
        inPlay(s, p.target) && def(s, p.target!).type === 'Group' && def(s, p.target!).subtype === 'Place' ? (s.cards[self].data?.place === p.target ? 'Already linked there.' : null) : 'Choose a Place in play.',
      apply(s, pl, self, p) { s.cards[self].data = { ...s.cards[self].data, place: p.target }; log(s, `${cardName(s, self)} link to ${cardName(s, p.target!)}.`, pl); },
    }],
  },

  'elders-of-zion': {
    // One reorganization of the whole Power Structure: free moves, until the player does anything else.
    actions: [{
      id: 'reorganize', label: 'Reorganize your Power Structure (also spends an Illuminati action)', timing: ['main'], usesToken: true, ai: 'reorganize',
      check(s, pl) {
        if (s.turnFlags.freeMoves === pl) return 'You can already move your Groups freely.';
        return s.cards[player(s, pl).illuminati].tokens > 0 ? null : 'Your Illuminati also needs an Action token.';
      },
      apply(s, pl, self) {
        s.cards[player(s, pl).illuminati].tokens--;
        s.turnFlags.freeMoves = pl;
        s.turnFlags.freeMovesOnce = true;
        log(s, `${cardName(s, self)}: ${player(s, pl).name} reorganizes the Power Structure — Groups move for free until the next other step.`, pl);
      },
    }],
  },

  'eff': {
    // Helping defend a Computer group doubles the total Power spent by the defending Groups.
    attackMod(s, self, ctx, side) {
      if (side !== 'defense' || ctx.instant || ctx.target === self || !is(s, ctx.target, { attributes: ['Computer'] })) return 0;
      if (!live(ctx, self) || !ctx.oppose.some((c) => c.iid === self)) return 0;
      return ctx.oppose.filter((c) => c.iid && live(ctx, c.iid)).reduce((n, c) => n + contribPower(s, c), 0);
    },
  },

  'empty-vee': {
    immune: (s, self, target, source) =>
      inPlay(s, target) && s.cards[target].controller === ctl(s, self) && is(s, target, { attributes: ['Media'] })
        && def(s, source).type === 'Group' && hasAlign(s, source, 'Straight'),
    powerMod: (s, self, iid) =>
      s.cards[iid].zone === 'structure' && s.cards[iid].controller === ctl(s, self) && def(s, iid).type === 'Group' && def(s, iid).subtype === 'Personality' ? 1 : 0,
  },

  'evil-geniuses-for-a-better-tomorrow': {
    // Resources linked here stay here; they are lost or captured with the Evil Geniuses (the engine
    // already moves or destroys linked Resources with their Group).
    lockLinks: () => true,
    actions: [{
      id: 'gadget', label: 'Take over a Gadget from your hand and link it here', timing: ['main'], usesToken: true,
      needs: { target: 'resource' },
      check(s, pl, self, p) {
        const r = p.target;
        if (!r || !player(s, pl).hand.includes(r) || !isGadget(s, r)) return 'Choose a Gadget Resource in your hand.';
        if (!canEnterPlay(s, r, pl)) return 'That Resource cannot come into play (it is Unique and already in play or destroyed).';
        const rule = HOOKS[s.cards[r].cardId]?.linkTo;
        if (rule && !rule(s, r, self)) return `${cardName(s, r)} cannot be linked to ${cardName(s, self)}.`;
        return null;
      },
      apply(s, pl, self, p) {
        playResourceCard(s, p.target!, pl);
        Object.assign(s.cards[p.target!], { linkedTo: self, linkMovedTurn: s.turn });
      },
    }],
  },

  'fast-food-chains': {
    actions: [{
      id: 'hide', label: 'Hide an exposed Plot (two per turn)', timing: ['main'], usesToken: false, ai: 'never',
      needs: { target: 'plot' },
      check(s, pl, self, p) {
        const d = s.cards[self].data;
        if (d?.hideTurn === s.turn && (d.hidden as number) >= 2) return 'You have already hidden two Plots this turn.';
        return p.target && player(s, pl).hand.includes(p.target) && s.cards[p.target].exposed ? null : 'Choose one of your exposed Plots.';
      },
      apply(s, _pl, self, p) {
        const d = s.cards[self].data;
        const n = d?.hideTurn === s.turn ? (d.hidden as number) : 0;
        s.cards[self].data = { ...d, hideTurn: s.turn, hidden: n + 1 };
        s.cards[p.target!].exposed = false;
      },
    }],
  },

  'federal-reserve': {
    // +2 on any attack against a Nation or Corporate group (once, even if it is both).
    attackMod: (s, self, ctx, side) =>
      side === 'attack' && !ctx.instant && ctx.attackerPlayer === ctl(s, self)
        && (is(s, ctx.target, { attributes: ['Nation'] }) || hasAlign(s, ctx.target, 'Corporate')) ? 2 : 0,
  },

  'feminists': {
    actions: [{
      id: 'recruit', label: 'Draw a random Group card from a rival\'s hand (keep it if Liberal)', timing: ['main'], usesToken: true, ai: 'draw',
      needs: { target: 'rivalGroup' },
      check(s, pl, _self, p) {
        const r = rivalFor(s, pl, p);
        const err = rivalError(s, pl, r);
        if (err) return err;
        return player(s, r!).hand.some((c) => def(s, c).type === 'Group') ? null : 'That rival has no Group cards in hand.';
      },
      apply(s, pl, _self, p) {
        const r = player(s, rivalFor(s, pl, p)!);
        const groups = r.hand.filter((c) => def(s, c).type === 'Group');
        const pick = groups[Math.floor(nextRandom(s) * groups.length)];
        if ((def(s, pick).alignments ?? []).includes('Liberal')) {
          r.hand = r.hand.filter((c) => c !== pick);
          player(s, pl).hand.push(pick);
          log(s, `The Feminists draw ${cardName(s, pick)} from ${r.name} and keep it.`, pl);
        } else {
          log(s, `The Feminists draw ${cardName(s, pick)} from ${r.name}; it is not Liberal and goes back.`, pl);
        }
      },
    }],
  },

  'flat-earthers': {
    actions: [{
      id: 'roll', label: 'Roll 2d6: draw that many Plots if no more than the Places you control', timing: ['main'], usesToken: true, ai: 'draw',
      check: () => null,
      apply(s, pl) {
        const places = structureCards(s, pl).filter((g) => def(s, g).type === 'Group' && def(s, g).subtype === 'Place').length;
        const [a, b] = roll2d6(s);
        const n = a + b;
        if (n <= places) { drawPlot(s, player(s, pl), n); log(s, `Rolled ${n} with ${places} Places controlled: draw ${n} Plots.`, pl); }
        else log(s, `Rolled ${n} with only ${places} Places controlled: nothing happens.`, pl);
      },
    }],
  },

  'fnord-motor-company': {
    actions: [{
      id: 'reroll', label: 'Discard a Plot to reroll a failed attack', timing: ['roll'], usesToken: true, ai: 'never',
      needs: { target: 'plot' },
      check(s, pl, self, p, ctx) {
        if (!ctx || ctx.instant || ctx.attackerPlayer !== pl || !ctx.attacker || ctx.attacker === self || !own(s, pl, ctx.attacker)) return 'Only for an attack made by another Group you control.';
        if (attackCancelled(ctx) || currentOutcome(s, ctx) !== 'failure') return 'The attack has not failed.';
        if (!p.target || !player(s, pl).hand.includes(p.target) || def(s, p.target).type !== 'Plot') return 'Choose a Plot card from your hand to discard.';
        return null;
      },
      apply(s, _pl, _self, p) {
        discardCard(s, p.target!);
        return { t: 'reroll', dice: roll2d6(s) };
      },
    }],
  },

  'fraternal-orders': {
    actions: [{
      id: 'draw', label: 'Draw a Group card', timing: ['anytime'], usesToken: true, ai: 'draw',
      check: (s, pl) => (player(s, pl).groupDeck.length ? null : 'Your Group deck is empty.'),
      apply: (s, pl) => { drawGroup(s, player(s, pl)); },
    }],
  },

  'fred-birch-society': {
    // Two Conservative Groups for Goal cards; one Group everywhere else.
    goalAlignWeight: (_s, _iid, alignment) => (alignment === 'Conservative' ? 2 : 1),
  },

  'gay-activists': {
    actions: [{
      id: 'reverse', label: 'Reverse one alignment of a Group until end of turn', timing: ['main'], usesToken: true, ai: 'never',
      needs: { target: 'group', alignment: true },
      check(s, pl, _self, p) {
        if (s.attack) return 'Not during an attack.';
        if (!inPlay(s, p.target) || def(s, p.target!).type !== 'Group') return 'Choose a Group in play.';
        if (protectedPlayer(s, pl, s.cards[p.target!].controller)) return 'That player has not finished a first turn yet.';
        const al = p.alignment as never;
        if (!p.alignment || !alignments(s, p.target!).includes(al)) return 'Choose one of that Group\'s alignments.';
        if (!OPPOSITE[al]) return `${p.alignment} has no opposite to reverse to.`;
        return null;
      },
      apply(s, pl, self, p) {
        const al = p.alignment as keyof typeof OPPOSITE;
        s.cards[p.target!].mods.push({ source: self, kind: 'addAlign', align: OPPOSITE[al]!, until: 'endOfTurn' });
        log(s, `${cardName(s, p.target!)} is ${OPPOSITE[al]} instead of ${al} until the end of the turn.`, pl);
      },
    }],
  },

  'gun-lobby': {
    // Resistance becomes 10 against Liberal, Weird or Communist attackers.
    attackMod(s, self, ctx, side) {
      if (side !== 'defense' || ctx.instant || ctx.type !== 'control' || ctx.target !== self) return 0;
      const hostile = attackingGroups(ctx).some((g) => live(ctx, g) && (hasAlign(s, g, 'Liberal') || hasAlign(s, g, 'Weird') || is(s, g, { attributes: ['Communist'] })));
      return hostile ? Math.max(0, 10 - (def(s, self).resistance ?? 0)) : 0;
    },
    // A Plot after any attack on one of your Conservative or Violent Groups, won or lost, as long as
    // you still control the Gun Lobby. ctx.targetPlayer is who controlled the target when the attack began.
    onAttackEnd(s, self, ctx) {
      const pl = ctl(s, self);
      if (!pl || ctx.targetPlayer !== pl || attackCancelled(ctx)) return;
      if (!(hasAlign(s, ctx.target, 'Conservative') || hasAlign(s, ctx.target, 'Violent'))) return;
      drawPlot(s, player(s, pl));
      log(s, `${cardName(s, self)}: ${cardName(s, ctx.target)} was attacked, draw a Plot.`, pl);
    },
  },

  'intellectuals': {
    powerMod(s, self, iid) {
      const m = s.cards[self].master;
      return iid === m && is(s, m, { attributes: ['Media'] }) ? 1 : 0;
    },
    // Disasters never check this; Assassinations are let through.
    preventDestroy(s, self, target, ctx) {
      const m = s.cards[self].master;
      return target === m && is(s, m, { attributes: ['Media'] }) && !ctx?.assassination && !ctx?.disaster;
    },
    // Disasters and Assassinations only destroy, so the Media master can never be captured.
    forbidAttack(s, self, _attacker, target, type) {
      const m = s.cards[self].master;
      return type === 'control' && target === m && is(s, m, { attributes: ['Media'] })
        ? `The Intellectuals protect ${cardName(s, m!)}: it cannot be taken over.` : null;
    },
  },

  'international-cocaine-smugglers': {
    // +4 to any takeover attempt you lead against one of these Groups or one of their puppets.
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || ctx.type !== 'control' || ctx.instant || !ctx.attacker || ctx.attackerPlayer !== ctl(s, self)) return 0;
      const t = s.cards[ctx.target];
      const master = t.master && inPlay(s, t.master) ? s.cards[t.master].cardId : undefined;
      return COCAINE_CLIENTS.includes(t.cardId) || (!!master && COCAINE_CLIENTS.includes(master)) ? 4 : 0;
    },
  },

  'international-communist-conspiracy': {
    // +3 on any attempt to control a puppet of a Communist master (the target's own +3 does not stack with this one).
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || !ledByOwner(s, self, ctx) || ctx.type !== 'control' || ctx.fromHand) return 0;
      const m = s.cards[ctx.target].master;
      return is(s, m, { attributes: ['Communist'] }) && !is(s, ctx.target, { attributes: ['Communist'] }) ? 3 : 0;
    },
  },

  'international-weather-organization': {
    attackMod(s, self, ctx, side) {
      if (!ctx.disaster || !disasterTarget(s, ctx.target)) return 0;
      const pl = ctl(s, self);
      if (side === 'defense' && ctx.targetPlayer === pl) return 6;
      if (side === 'attack' && ctx.attackerPlayer === pl && ctx.targetPlayer && ctx.targetPlayer !== pl && !isSpaceDisaster(s, ctx.instantCard)) return 4;
      return 0;
    },
  },

  'i-r-s': {
    // Once per turn, and optional: the top Plot of one rival's deck. While the Tax Reform NWO is in
    // play the same tax takes the top Plot of every rival's deck instead.
    actions: [{
      id: 'tax', label: 'Take the top Plot of a rival\'s deck (of every rival under Tax Reform)', timing: ['main'], usesToken: false, oncePerTurn: true, ai: 'draw',
      needs: { target: 'rivalGroup' },
      check(s, pl, _self, p) {
        if (taxReform(s)) return taxable(s, pl).length ? null : 'No rival has a Plot deck the I.R.S. can tax.';
        const r = rivalFor(s, pl, p);
        const err = rivalError(s, pl, r);
        if (err) return err;
        if (lawyered(s, r!)) return 'That rival\'s Lawyers make them immune to the I.R.S.';
        return player(s, r!).plotDeck.length ? null : 'That rival\'s Plot deck is empty.';
      },
      apply(s, pl, _self, p) {
        const rivals = taxReform(s) ? taxable(s, pl) : [rivalFor(s, pl, p)!];
        for (const id of rivals) {
          const r = player(s, id);
          const c = r.plotDeck.shift()!;
          s.cards[c].zone = 'hand';
          s.cards[c].exposed = false;
          player(s, pl).hand.push(c);
          log(s, `The I.R.S. collects ${cardName(s, c)} from the top of ${r.name}'s Plot deck.`, r.id);
        }
      },
    }],
  },

  'joggers': {
    attackMod: (s, self, ctx, side) => (side === 'attack' && !!ctx.assassination && ctx.attackerPlayer === ctl(s, self) ? 2 : 0),
  },

  'junk-mail': {
    // May attack, aid or oppose Secret Groups, and its +6 on any attempt to control one still counts
    // in those attacks, whichever of your Groups leads.
    secretOverride: (_s, self, group) => group === self,
    worksInSecretAttacks: true,
    attackMod: (s, self, ctx, side) =>
      side === 'attack' && ledByOwner(s, self, ctx) && ctx.type === 'control' && is(s, ctx.target, { attributes: ['Secret'] }) ? 6 : 0,
  },

  'kkk': {
    // Destroying a Peaceful group with the KKK's help: every Violent group on both sides counts double.
    attackMod(s, self, ctx, side) {
      if (ctx.instant || ctx.type !== 'destroy' || !hasAlign(s, ctx.target, 'Peaceful') || !onAttack(ctx, self)) return 0;
      if (side === 'attack') {
        let n = ctx.attacker && hasAlign(s, ctx.attacker, 'Violent') ? power(s, ctx.attacker) : 0;
        for (const c of ctx.aid) if (c.iid && live(ctx, c.iid) && hasAlign(s, c.iid, 'Violent')) n += contribPower(s, c);
        return n;
      }
      let n = hasAlign(s, ctx.target, 'Violent') ? power(s, ctx.target, { defense: true, halve: !!s.cards[ctx.target].devastated }) : 0;
      for (const c of ctx.oppose) if (c.iid && live(ctx, c.iid) && hasAlign(s, c.iid, 'Violent')) n += contribPower(s, c);
      return n;
    },
  },

  'l-4-society': {
    // +8 on direct control of Space groups, instead of its +4.
    attackMod: (s, self, ctx, side) =>
      side === 'attack' && !ctx.instant && ctx.type === 'control' && ctx.attacker === self && is(s, ctx.target, { attributes: ['Space'] })
        ? Math.max(0, 8 - ownBonus(s, self, ctx)) : 0,
  },

  'libertarians': {
    // Taking a Group away from a Government master: total attacking Power is doubled.
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || ctx.instant || ctx.type !== 'control' || ctx.fromHand || !onAttack(ctx, self)) return 0;
      const m = s.cards[ctx.target].master;
      if (!m || def(s, m).type !== 'Group' || !hasAlign(s, m, 'Government')) return 0;
      let n = ctx.attacker && live(ctx, ctx.attacker) ? power(s, ctx.attacker) : 0;
      for (const c of ctx.aid) if (c.iid && live(ctx, c.iid)) n += contribPower(s, c);
      return n;
    },
    // Taking a Nation or a Government Place that is a U.S. state: their Power becomes its Power.
    onCapture(s, self, victim) {
      if (s.attack?.attacker !== self) return;
      if (!is(s, victim, { attributes: ['Nation'] }) && !is(s, victim, { names: US_STATES, alignments: ['Government'] })) return;
      const c = s.cards[self];
      c.mods = c.mods.filter((m) => !(m.source === self && m.kind === 'setPower'));
      c.mods.push({ source: self, kind: 'setPower', value: def(s, victim).power ?? 0, until: 'permanent' });
      log(s, `${cardName(s, self)} now have the Power of ${cardName(s, victim)}.`);
    },
  },

  'liquor-companies': {
    actions: [{
      id: 'dry', label: 'Cancel a rival\'s next card draw', timing: ['anytime'], usesToken: true, ai: 'never',
      needs: { target: 'rival' },
      check(s, pl, self, p) {
        const err = rivalError(s, pl, rivalFor(s, pl, p));
        if (err) return err;
        return s.cards[self].data?.cancelDraw ? 'A rival\'s draw is already going to be cancelled.' : null;
      },
      apply(s, pl, self, p) {
        const r = rivalFor(s, pl, p)!;
        s.cards[self].data = { ...s.cards[self].data, cancelDraw: r };
        log(s, `${cardName(s, self)}: ${player(s, r).name} will miss the next card draw.`, pl);
      },
    }],
    beforeDraw(s, self, pl) {
      if (s.cards[self].data?.cancelDraw !== pl) return undefined;
      s.cards[self].data = { ...s.cards[self].data, cancelDraw: undefined };
      return 'skip';
    },
    // An unused cancellation lapses when the controller's next turn begins.
    onTurnStart(s, self) { if (s.cards[self].data?.cancelDraw) s.cards[self].data = { ...s.cards[self].data, cancelDraw: undefined }; },
  },

  'local-police-departments': {
    powerMod: (s, self, iid) => (iid === s.cards[self].master ? 1 : 0),
    resistanceMod: (s, self, iid) => (iid === s.cards[self].master ? 3 : 0),
  },
});
