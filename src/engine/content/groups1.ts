import type { Alignment, AttackCtx, Contribution, GameState, PlotEffect, Side } from '../types';
import { abilitiesOf, attackingGroups, matches, registerAbilities, type Match } from '../abilities';
import { registerChoice, registerHooks, type AbilityParams, type ActivatedAbility } from '../hooks';
import { def, cardName } from '../cards';
import { alignmentPairs, alignments, attributes, power } from '../stats';
import { openArrows, sideOf, structureCards, subtree } from '../geometry';
import { NWO_EFFECTS } from '../nwo';
import { nextRandom, roll2d6, shuffle } from '../rng';
import {
  askChoice, attackCancelled, canAid, canOppose, cancelledGroups, controllerOf2, discardCard, drawGroup, drawPlot, isCancelled,
  isPrivileged, livePlayers, log, moveSubtree, player, protectedPlayer, raiseEvent, revealTo, tokenBarred,
} from '../game';

registerAbilities({
  'madison-avenue': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Media'] }, value: 10, scope: 'direct' },
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Media'] }, value: 2, scope: 'any' },
  ],
  'mi-5': [
    { kind: 'pending', note: 'Negating an attempt to expose your Plots as it happens: cards expose Plots directly, with no event or response window to answer; turning exposed Plots face down is encoded' },
  ],
  'moonies': [],
  'moral-minority': [
    { kind: 'powerPer', per: { alignments: ['Straight'] }, value: 1 },
  ],
  'mossad': [],
  'multinational-oil-companies': [],
  'nasa': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Space'] }, value: 4, scope: 'direct' },
  ],
  'nato': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Nation'] }, value: 4, scope: 'direct' },
  ],
  'nephews-of-god': [],
  'ninjas': [
    { kind: 'attackBonus', on: 'destroy', value: 2, scope: 'direct' },
    { kind: 'selfDefense', value: 10, on: 'destroy', instant: true },
  ],
  'n-s-a': [],
  'nuclear-power-companies': [
    { kind: 'pending', note: 'Cancelling actions taken outside an attack (moves, Plot purchases, abilities): the engine opens no response window after them; cancelling actions in an attack is encoded' },
  ],
  'offshore-banks': [],
  'opec': [],
  'paranoids': [
    { kind: 'structureDefense', value: 2 },
    { kind: 'noTokens' },
  ],
  'phone-company': [],
  'phone-phreaks': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Computer'] }, value: 6, scope: 'direct' },
  ],
  'pollsters': [],
  'post-office': [],
  'professional-sports': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Straight'] }, value: 4, scope: 'direct' },
  ],
  'psychiatrists': [],
  'punk-rockers': [],
  'recording-industry': [],
  'red-cross': [
    { kind: 'selfDefense', value: 15, on: 'destroy', instant: true },
  ],
  'reformed-church-of-satan': [
    { kind: 'selfDefense', value: 8, vs: { alignments: ['Straight'] } },
  ],
  'religious-reich': [],
  'republicans': [],
  'rifkinites': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Green'] }, value: 6, scope: 'direct' },
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Corporate'] }, value: 2, scope: 'direct' },
    { kind: 'attackBonus', on: 'destroy', target: { attributes: ['Science'] }, value: 2, scope: 'direct' },
    { kind: 'attackBonus', on: 'destroy', target: { attributes: ['Space'] }, value: 2, scope: 'direct' },
    { kind: 'attackBonus', on: 'destroy', target: { attributes: ['Computer'] }, value: 2, scope: 'direct' },
  ],
  'robot-sea-monsters': [
    { kind: 'attackBonus', on: 'destroy', target: { names: ['japan', 'california'] }, value: 10, scope: 'direct' },
  ],
  'rosicrucians': [],
  'saturday-morning-cartoons': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Violent'] }, value: 2, scope: 'direct' },
  ],
  'savings-and-loans': [
    { kind: 'pending', note: 'Cancelling Bank/Corporate/Government actions taken outside an attack: the engine opens no response window after them; the +3 and cancelling actions in an attack are encoded' },
  ],
  'science-fiction-fans': [
    { kind: 'attackBonus', on: 'both', target: { attributes: ['Computer'] }, value: 2, scope: 'direct' },
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Weird'] }, value: 2, scope: 'direct' },
  ],
  'secret-service': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Government'], subtypes: ['Personality'] }, value: 10, scope: 'direct' },
    { kind: 'pending', note: 'Direct-destruction modifier vs other Government groups (value missing from card data); +10 on Assassinations is encoded' },
  ],
  'secular-humanists': [],
  'semiconscious-liberation-army': [
    { kind: 'attackBonus', on: 'destroy', value: 3, scope: 'any' },
  ],
  's-m-o-f': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Weird'] }, value: 2, scope: 'direct' },
    { kind: 'pending', note: 'Additional +4 direct vs specified fandom groups (list missing from card data); removing a rival Weird token is encoded' },
  ],
  'society-for-creative-anarchism': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Straight'] }, value: 4, scope: 'direct' },
  ],
  'south-american-nazis': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Weird'], attributes: ['Science'] }, value: 6, scope: 'direct' },
  ],
  'subliminals': [
    { kind: 'powerPer', per: { attributes: ['Media'] }, value: 1, global: true },
  ],
  'supreme-court': [
    { kind: 'pending', note: 'Cancelling Government actions taken outside an attack: the engine opens no response window after them; cancelling actions in an attack is encoded' },
  ],
  'survivalists': [],
  'tabloids': [
    { kind: 'pending', note: '+3 involving Convenience Stores (that card and the exact bonus are missing from the card data); attacking Secret Groups is encoded' },
  ],
  'telephone-psychics': [
    { kind: 'attackBonus', on: 'control', target: { names: ['ronald-reagan', 'nancy-reagan', 'tabloids'] }, value: 6, scope: 'direct' },
    { kind: 'pending', note: '+6 direct control also vs qualifying low-Power Media groups (Power threshold missing from card data)' },
  ],
  'templars': [],
  'the-mafia': [
    { kind: 'attackBonus', on: 'destroy', target: { alignments: ['Criminal'] }, value: 4, scope: 'direct', replacesAlignmentPenalty: true },
    { kind: 'attackBonus', on: 'both', target: { alignments: ['Criminal'] }, value: 2, scope: 'any' },
  ],
  'the-men-in-black': [
    { kind: 'attackBonus', on: 'destroy', value: 4, scope: 'direct' },
  ],
  'tobacco-companies': [
    { kind: 'attackBonus', on: 'control', target: { alignments: ['Government'] }, value: 8, scope: 'direct', replacesAlignmentPenalty: true },
  ],
  'trekkies': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Media'] }, value: 4, scope: 'direct' },
  ],
  'triliberal-commission': [
    { kind: 'pending', note: 'Counts double as Liberal for Goal cards only: Goal conditions count matching Groups one each, and no hook lets one Group count twice for an alignment' },
  ],
  'tv-preachers': [
    { kind: 'attackBonus', on: 'control', target: { allAlignments: ['Straight', 'Fanatic'] }, value: 6, scope: 'direct', replacesAlignmentPenalty: true },
  ],
  'underground-newspapers': [],
  'united-nations': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Nation'] }, value: 6, scope: 'direct' },
  ],
  'urban-gangs': [
    { kind: 'attackBonus', on: 'destroy', value: 2, scope: 'any' },
  ],
  'vampires': [
    { kind: 'attackBonus', on: 'control', target: { subtypes: ['Personality'] }, value: 4, scope: 'direct' },
  ],
  'video-games': [
    { kind: 'attackBonus', on: 'control', target: { names: ['convenience-stores'] }, value: 3, scope: 'direct' },
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Computer'] }, value: 3, scope: 'direct' },
  ],
});

// ---------------------------------------------------------------- scripted behaviour

const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';
const isGroup = (s: GameState, iid: string) => def(s, iid).type === 'Group';
const hasAlign = (s: GameState, iid: string, ...al: Alignment[]) => al.some((a) => alignments(s, iid).includes(a));
const hasAttr = (s: GameState, iid: string, ...at: string[]) => at.some((a) => attributes(s, iid).includes(a));
/** `iid` is in the same Power Structure as `self`. */
const sameOwner = (s: GameState, self: string, iid: string) => inPlay(s, iid) && s.cards[iid].controller === controllerOf2(s, self);
/** The Group leading a normal (non-Instant) attack is `self`. */
const leads = (ctx: AttackCtx, self: string) => !ctx.instant && ctx.attacker === self;

/** The rival a card is used against: `mode` names a player, or `target` is one of his cards, or the only rival. */
function rivalFor(s: GameState, pl: string, p: AbilityParams): string | undefined {
  const rivals = livePlayers(s).map((x) => x.id).filter((id) => id !== pl);
  if (p.mode && rivals.includes(p.mode)) return p.mode;
  const c = p.target ? s.cards[p.target] : undefined;
  const who = c ? c.controller ?? c.owner : undefined;
  if (who && rivals.includes(who)) return who;
  return rivals.length === 1 ? rivals[0] : undefined;
}
function rivalCheck(s: GameState, pl: string, p: AbilityParams): string | null {
  const r = rivalFor(s, pl, p);
  if (!r) return 'Choose a rival.';
  if (protectedPlayer(s, pl, r)) return 'That player has not finished a first turn yet.';
  return null;
}
function pickRandom<T>(s: GameState, list: T[], n: number): T[] {
  const pool = [...list], out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(nextRandom(s) * pool.length), 1)[0]);
  return out;
}

/** "As an action, expose two random hidden [Plot|Group] cards of a rival". */
function exposeTwo(kind: 'Plot' | 'Group'): ActivatedAbility {
  const hidden = (s: GameState, rival: string) => player(s, rival).hand.filter((c) => def(s, c).type === kind && !s.cards[c].exposed);
  return {
    id: 'expose', label: `Expose two random hidden ${kind} cards of a rival`, timing: ['anytime'], usesToken: true, ai: 'never',
    check(s, pl, _self, p) {
      const err = rivalCheck(s, pl, p);
      if (err) return err;
      return hidden(s, rivalFor(s, pl, p)!).length ? null : `That rival has no hidden ${kind} cards in hand.`;
    },
    apply(s, pl, _self, p) {
      const rival = rivalFor(s, pl, p)!;
      const shown = pickRandom(s, hidden(s, rival), 2);
      for (const c of shown) s.cards[c].exposed = true;
      log(s, `${player(s, rival).name} must expose ${shown.map((c) => cardName(s, c)).join(' and ')}.`, pl);
    },
  };
}

/** "On your turn, freely look at two random hidden [Plot|Group] cards of a rival" (only you see them). */
function inspectTwo(kind: 'Plot' | 'Group'): ActivatedAbility {
  const hidden = (s: GameState, rival: string) => player(s, rival).hand.filter((c) => def(s, c).type === kind && !s.cards[c].exposed);
  return {
    id: 'inspect', label: `Look at two random hidden ${kind} cards of a rival`, timing: ['main'], usesToken: false, oncePerTurn: true, ai: 'never',
    needs: { target: 'rival' },
    check(s, pl, _self, p) {
      const err = rivalCheck(s, pl, p);
      if (err) return err;
      return hidden(s, rivalFor(s, pl, p)!).length ? null : `That rival has no hidden ${kind} cards in hand.`;
    },
    apply(s, pl, self, p) {
      const rival = rivalFor(s, pl, p)!;
      revealTo(s, pl, pickRandom(s, hidden(s, rival), 2), `${cardName(s, self)}: you look at ${player(s, rival).name}'s cards`);
    },
  };
}

/** "As an action, force the discard of an exposed Plot held by a rival" (Templars, Psychiatrists). */
function discardExposed(allowGoals: boolean): ActivatedAbility {
  return {
    id: 'discardExposed', label: `Force a rival to discard an exposed ${allowGoals ? '' : 'non-Goal '}Plot`, timing: ['anytime'], usesToken: true, ai: 'never',
    needs: { target: 'plot' },
    check(s, pl, _self, p) {
      const c = p.target ? s.cards[p.target] : undefined;
      if (!c || c.zone !== 'hand' || c.owner === pl || !c.exposed || def(s, c.iid).type !== 'Plot') return 'Choose an exposed Plot in a rival\'s hand.';
      if (!allowGoals && def(s, c.iid).subtype === 'Goal') return 'Goal cards cannot be chosen.';
      if (protectedPlayer(s, pl, c.owner)) return 'That player has not finished a first turn yet.';
      return null;
    },
    apply(s, pl, _self, p) {
      discardCard(s, p.target!);
      log(s, `${player(s, s.cards[p.target!].owner).name} discards ${cardName(s, p.target!)}.`, pl);
    },
  };
}

/** "As an action, cancel an action of a [matching] Group" — during an attack. */
function cancelAction(label: string, ok: (s: GameState, g: string) => boolean): ActivatedAbility {
  // Groups acting in the attack, and cards that used an ability in it.
  const actors = (ctx: AttackCtx) => [ctx.attacker, ...ctx.aid.map((a) => a.iid), ...ctx.oppose.map((o) => o.iid)].filter((x): x is string => !!x);
  const abilityPlay = (ctx: AttackCtx, card: string) => [...ctx.plays].reverse().find((pp) => pp.ability === card && !isCancelled(ctx.plays, pp.iid));
  return {
    id: 'cancelAction', label, timing: ['attack'], usesToken: true, ai: 'cancelAttacker',
    needs: { target: 'actingGroup' },
    check(s, _pl, self, p, ctx) {
      if (!ctx) return 'Only during an attack.';
      const t = p.target;
      if (!t || t === self) return 'Choose another Group that is acting in this attack.';
      const acting = actors(ctx).includes(t) && !cancelledGroups(ctx).has(t);
      if (!acting && !abilityPlay(ctx, t)) return 'That Group is not taking an action in this attack.';
      if (!ok(s, t)) return `${cardName(s, t)}'s action cannot be cancelled by this card.`;
      return null;
    },
    apply(_s, _pl, _self, p, ctx): PlotEffect {
      if (actors(ctx!).includes(p.target!)) return { t: 'cancelGroup', group: p.target! };
      return { t: 'cancelPlot', target: abilityPlay(ctx!, p.target!)!.iid };
    },
  };
}

/** "Interfere in a Privileged attack, ending the privilege": the Group aids or opposes and the attack is no longer Privileged. */
function interfere(label: string, when: (s: GameState, ctx: AttackCtx) => boolean, anyAlignment: boolean): ActivatedAbility {
  return {
    id: 'interfere', label, timing: ['attack'], usesToken: true, ai: 'never', needs: { modes: ['aid', 'oppose'] },
    check(s, pl, self, p, ctx) {
      if (!ctx || ctx.instant || !isPrivileged(ctx) || !when(s, ctx)) return 'Only during a Privileged attack this card may interfere in.';
      if (p.mode !== 'aid' && p.mode !== 'oppose') return 'Choose whether to aid or oppose.';
      if (self === ctx.attacker || self === ctx.target || [...ctx.aid, ...ctx.oppose].some((c) => c.iid === self)) return 'This Group is already part of this attack.';
      if (anyAlignment) return null;
      const r = p.mode === 'aid' ? canAid(s, pl, self) : canOppose(s, pl, self);
      return r.ok ? null : r.why ?? 'Not allowed.';
    },
    apply(s, pl, self, p, ctx): PlotEffect {
      let useGlobal = false;
      if (!anyAlignment) {
        // canAid/canOppose look for the token, which is already spent: only their alignment verdict matters here.
        s.cards[self].tokens++;
        useGlobal = (p.mode === 'aid' ? canAid : canOppose)(s, pl, self).global;
        s.cards[self].tokens--;
      }
      const entry: Contribution & { useGlobal?: boolean } = { player: pl, iid: self, amount: 0, label: cardName(s, self), useGlobal };
      (p.mode === 'aid' ? ctx!.aid : ctx!.oppose).push(entry);
      log(s, `${cardName(s, self)} ${p.mode === 'aid' ? 'aids' : 'opposes'}; the attack is no longer Privileged.`, pl);
      return { t: 'unprivilege' };
    },
  };
}
/** Player may take part in a Privileged attack because one of his cards can interfere in it. */
const canInterfereWith = (s: GameState, self: string, pl: string, when: (s: GameState, ctx: AttackCtx) => boolean) =>
  controllerOf2(s, self) === pl && !!s.attack && !s.attack.instant && s.cards[self].tokens > 0 && !tokenBarred(s, self) && when(s, s.attack);

/** The alignment modifiers of a normal attack as attackStrength computes them (R006). */
function alignmentModifiers(s: GameState, ctx: AttackCtx): { attack: number; master: number } {
  if (ctx.instant || !ctx.attacker) return { attack: 0, master: 0 };
  const att = ctx.attacker, tgt = ctx.target;
  const pairs = alignmentPairs(s, att, tgt);
  let perSame = 4, perOpp = 4;
  for (const n of Object.values(s.nwo)) {
    const v = n ? NWO_EFFECTS[s.cards[n].cardId]?.alignmentValues?.() : undefined;
    if (v) { perSame = v.same; perOpp = v.opposite; }
  }
  const replaces = abilitiesOf(s, att).some((a) => a.kind === 'attackBonus' && a.replacesAlignmentPenalty && (a.on === 'both' || a.on === ctx.type) && matches(s, tgt, a.target));
  const attack = ctx.type === 'control'
    ? pairs.same * perSame - (replaces ? 0 : pairs.opposite * perOpp)
    : pairs.opposite * perOpp - (replaces ? 0 : pairs.same * perSame);
  let master = 0;
  const m = s.cards[tgt].master;
  if (ctx.type === 'control' && !ctx.fromHand && m && def(s, m).type === 'Group') {
    master = alignments(s, tgt).filter((x) => x !== 'Fanatic' && alignments(s, m).includes(x)).length * 4;
  }
  return { attack, master };
}

/** Automatic Relief: the Place is no longer Devastated. */
function relieve(s: GameState, place: string, by: string) {
  if (!inPlay(s, place) || !s.cards[place].devastated) return;
  s.cards[place].devastated = false;
  log(s, `${cardName(s, by)}: ${cardName(s, place)} receives Relief and is no longer Devastated.`, controllerOf2(s, by));
}

/** OPEC: printed Power is 2d6-2, +1 with Texas, +1 with Multinational Oil Companies. */
function rollOpec(s: GameState, self: string) {
  const pl = controllerOf2(s, self);
  if (!pl) return;
  const dice = roll2d6(s);
  const mine = structureCards(s, pl).map((g) => s.cards[g].cardId);
  const v = dice[0] + dice[1] - 2 + (mine.includes('texas') ? 1 : 0) + (mine.includes('multinational-oil-companies') ? 1 : 0);
  const c = s.cards[self];
  c.mods = c.mods.filter((m) => !(m.source === self && m.kind === 'setPower'));
  c.mods.push({ source: self, kind: 'setPower', value: v, until: 'permanent' });
  log(s, `OPEC rolls ${dice[0]} + ${dice[1]}: its Power is now ${v}.`, pl);
}

const SPACE_DISASTERS = ['meteor-strike'];
const cancelsOwnSide = (ctx: AttackCtx, self: string) => cancelledGroups(ctx).has(self);

registerHooks({
  'mi-5': {
    actions: [{
      id: 'hidePlots', label: 'Turn all your exposed Plots face down', timing: ['anytime'], usesToken: true, ai: 'never',
      check: (s, pl) => (player(s, pl).hand.some((c) => s.cards[c].exposed && def(s, c).type === 'Plot') ? null : 'You have no exposed Plots.'),
      apply(s, pl) {
        for (const c of player(s, pl).hand) if (def(s, c).type === 'Plot') s.cards[c].exposed = false;
      },
    }],
  },

  'moonies': (() => {
    const when = () => true;
    return {
      mayInterfere: (s: GameState, self: string, pl: string) => canInterfereWith(s, self, pl, when),
      actions: [interfere('Interfere in a Privileged attack (either side, regardless of alignment)', when, true)],
    };
  })(),

  'nasa': {
    actions: [{
      id: 'transferToken', label: 'Give its Action token to another Government Group of yours', timing: ['main'], usesToken: true, ai: 'never',
      needs: { target: 'ownGroup' },
      check(s, pl, self, p, ctx) {
        if (ctx) return 'Not during an attack.';
        const t = p.target;
        if (!t || t === self || !inPlay(s, t) || s.cards[t].controller !== pl || !isGroup(s, t) || !hasAlign(s, t, 'Government')) return 'Choose another Government Group you control.';
        if (s.cards[t].tokens > 0) return `${cardName(s, t)} already has an Action token.`;
        if (tokenBarred(s, t)) return `${cardName(s, t)} cannot hold Action tokens.`;
        return null;
      },
      apply(s, _pl, _self, p) { s.cards[p.target!].tokens = 1; },
    }],
  },

  'nato': {
    mayJoin: (s, self, ctx, group) => group === self && !ctx.instant &&
      ((!!ctx.attacker && hasAttr(s, ctx.attacker, 'Nation')) || hasAttr(s, ctx.target, 'Nation')),
  },

  'nephews-of-god': {
    onTurnStart(s, self) {
      const dice = roll2d6(s);
      const lucky = dice[0] + dice[1] <= 6;
      s.cards[self].data = { ...s.cards[self].data, extraDrawTurn: lucky ? s.turn : undefined };
      log(s, `Nephews of God roll ${dice[0]} + ${dice[1]}${lucky ? ': draw one extra card from either deck' : ''}.`, controllerOf2(s, self));
    },
    actions: [{
      id: 'extraDraw', label: 'Draw the extra card (Plot or Group deck)', timing: ['main'], usesToken: false, oncePerTurn: true, ai: 'draw',
      needs: { modes: ['plot', 'group'] },
      check(s, pl, self, p) {
        if (s.cards[self].data?.extraDrawTurn !== s.turn) return 'The Nephews of God did not roll 6 or less this turn.';
        if (p.mode !== 'plot' && p.mode !== 'group') return 'Choose the Plot deck or the Group deck.';
        const deck = p.mode === 'plot' ? player(s, pl).plotDeck : player(s, pl).groupDeck;
        return deck.length ? null : 'That deck is empty.';
      },
      apply(s, pl, self, p) {
        if (p.mode === 'plot') drawPlot(s, player(s, pl)); else drawGroup(s, player(s, pl));
        s.cards[self].data = { ...s.cards[self].data, extraDrawTurn: undefined };
      },
    }],
  },

  'ninjas': {
    attackMod: (s, self, ctx, side) =>
      side === 'attack' && ctx.assassination && ctx.attackerPlayer === controllerOf2(s, self) ? 4 : 0,
    onAttackEnd(s, self, ctx) {
      if (ctx.target !== self || ctx.result !== 'failure' || attackCancelled(ctx) || !inPlay(s, self) || tokenBarred(s, self)) return;
      s.cards[self].tokens += 1;
      log(s, 'The attack on the Ninjas failed: they gain an Action token.', controllerOf2(s, self));
    },
  },

  'nuclear-power-companies': {
    actions: [cancelAction("Cancel another Group's action", () => true)],
  },

  'offshore-banks': {
    // Immune to destruction by Government, Corporate or Criminal Groups: they cannot help destroy it,
    // and an Attack to Destroy they lead has no effect.
    immune: (s, self, target, source) => target === self && s.attack?.type === 'destroy' && s.attack.target === self &&
      isGroup(s, source) && hasAlign(s, source, 'Government', 'Corporate', 'Criminal'),
    preventDestroy: (s, self, target, ctx) => target === self && !!ctx && !ctx.instant && !!ctx.attacker &&
      isGroup(s, ctx.attacker) && hasAlign(s, ctx.attacker, 'Government', 'Corporate', 'Criminal'),
  },

  'opec': {
    onEnterPlay: rollOpec,
    onTurnStart: rollOpec,
  },

  'paranoids': {
    attackMod: (s, self, ctx, side) =>
      side === 'defense' && ctx.assassination && !!ctx.targetPlayer && ctx.targetPlayer === controllerOf2(s, self) ? 2 : 0,
    // power() is safe here: preventDestroy is not a Power modifier.
    preventDestroy: (s, self, target) => target === self && power(s, self) === 0,
  },

  'phone-company': { actions: [exposeTwo('Plot'), inspectTwo('Plot')] },
  'post-office': { actions: [exposeTwo('Group'), inspectTwo('Group')] },

  'pollsters': {
    attackMod(s, self, ctx, side) {
      if (ctx.instant || cancelsOwnSide(ctx, self)) return 0;
      const onAttack = ctx.attacker === self || ctx.aid.some((a) => a.iid === self);
      const onDefense = ctx.target === self || ctx.oppose.some((o) => o.iid === self);
      if (!onAttack && !onDefense) return 0;
      const m = alignmentModifiers(s, ctx);
      if (onAttack && side === 'attack' && m.attack < 0) return -m.attack;
      if (onAttack && side === 'defense' && m.master > 0) return -m.master;
      if (onDefense && side === 'attack' && m.attack > 0) return -m.attack;
      return 0;
    },
  },

  'professional-sports': {
    // A Personality directly linked to it by an arrow (its master or puppet).
    powerMod: (s, self, iid) => sameOwner(s, self, iid) && def(s, iid).subtype === 'Personality' &&
      (s.cards[iid].master === self || s.cards[self].master === iid) ? 3 : 0,
  },

  'psychiatrists': {
    attackMod: (s, self, ctx, side) =>
      side === 'attack' && leads(ctx, self) && ctx.type === 'destroy' && def(s, ctx.target).subtype === 'Personality' && !isPrivileged(ctx) ? 6 : 0,
    actions: [discardExposed(false)],
  },

  'recording-industry': {
    powerMod: (s, self, iid) => !sameOwner(s, self, iid) || def(s, iid).subtype !== 'Personality' ? 0 : hasAttr(s, iid, 'Media') ? 2 : 1,
  },

  'red-cross': {
    attackMod: (s, self, ctx, side) => side === 'defense' && !!ctx.disaster && !!ctx.targetPlayer && ctx.targetPlayer === controllerOf2(s, self) ? 6 : 0,
    onAttackEnd(s, self, ctx) {
      if (ctx.disaster && ctx.target === s.cards[self].master) relieve(s, ctx.target, self);
    },
    actions: [{
      id: 'relief', label: 'Send Relief to one Place', timing: ['anytime'], usesToken: true, ai: 'never',
      needs: { target: 'place' },
      check(s, _pl, _self, p) {
        if (s.window?.kind === 'roll') return 'Not during an attack roll.';
        return p.target && inPlay(s, p.target) && s.cards[p.target].devastated ? null : 'Choose a Devastated Place.';
      },
      apply(s, _pl, self, p) { relieve(s, p.target!, self); },
    }],
  },

  'reformed-church-of-satan': {
    // Straight Groups cannot attack or help attack your other Groups.
    immune: (s, self, target, source) => target !== self && sameOwner(s, self, target) && isGroup(s, source) && hasAlign(s, source, 'Straight'),
  },

  'religious-reich': (() => {
    const when = (s: GameState, ctx: AttackCtx) => attackingGroups(ctx).some((g) => hasAlign(s, g, 'Straight', 'Conservative'));
    return {
      mayInterfere: (s: GameState, self: string, pl: string) => canInterfereWith(s, self, pl, when),
      actions: [interfere('Interfere in a Privileged attack made or aided by Straight or Conservative Groups', when, false)],
    };
  })(),

  'republicans': {
    attackMod: (s, self, ctx, side) => side === 'attack' && leads(ctx, self) && ctx.type === 'control' &&
      hasAlign(s, ctx.target, 'Government') && !hasAttr(s, ctx.target, 'Nation') ? 5 : 0,
  },

  'robot-sea-monsters': {
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || ctx.type !== 'destroy') return 0;
      const t = ctx.target;
      const ok = hasAlign(s, t, 'Corporate', 'Government') || (def(s, t).subtype === 'Place' && hasAttr(s, t, 'Coastal'));
      if (!ok) return 0;
      if (ctx.disaster) {
        const card = ctx.instantCard ? s.cards[ctx.instantCard]?.cardId : undefined;
        return ctx.attackerPlayer === controllerOf2(s, self) && !SPACE_DISASTERS.includes(card ?? '') ? 4 : 0;
      }
      return leads(ctx, self) ? 4 : 0;
    },
  },

  'savings-and-loans': {
    attackMod: (s, self, ctx, side) => side === 'attack' && leads(ctx, self) && ctx.type === 'control' &&
      (hasAlign(s, ctx.target, 'Corporate', 'Government') || hasAttr(s, ctx.target, 'Bank')) ? 3 : 0,
    actions: [cancelAction('Cancel the action of a Bank, Corporate or Government Group', (s, g) => hasAlign(s, g, 'Corporate', 'Government') || hasAttr(s, g, 'Bank'))],
  },

  'science-fiction-fans': {
    attackMod: (s, self, ctx, side) => side === 'attack' && !ctx.instant && !!ctx.attacker && ctx.attacker === s.cards[self].master &&
      sameOwner(s, self, ctx.attacker) && hasAttr(s, ctx.target, 'Computer') ? 6 : 0,
  },

  'secret-service': {
    attackMod: (s, self, ctx, side) => side === 'attack' && ctx.assassination && ctx.attackerPlayer === controllerOf2(s, self) &&
      def(s, ctx.target).subtype === 'Personality' && hasAlign(s, ctx.target, 'Government') ? 10 : 0,
  },

  'secular-humanists': {
    attackMod: (s, self, ctx, side) => side === 'attack' && !ctx.instant && !!ctx.attacker && ctx.target !== self &&
      sameOwner(s, self, ctx.target) && hasAlign(s, ctx.attacker, 'Straight', 'Conservative') ? -3 : 0,
  },

  's-m-o-f': {
    actions: [{
      id: 'removeToken', label: 'Remove an Action token from a rival Weird Group', timing: ['main'], usesToken: false, oncePerTurn: true, ai: 'never',
      needs: { target: 'rivalGroup' },
      check(s, pl, _self, p) {
        const t = p.target;
        if (!t || !inPlay(s, t) || s.cards[t].controller === pl || !isGroup(s, t) || !hasAlign(s, t, 'Weird')) return 'Choose a Weird Group a rival controls.';
        if (protectedPlayer(s, pl, s.cards[t].controller)) return 'That player has not finished a first turn yet.';
        return s.cards[t].tokens > 0 ? null : `${cardName(s, t)} has no Action token.`;
      },
      apply(s, _pl, _self, p) { s.cards[p.target!].tokens--; },
    }],
  },

  'society-for-creative-anarchism': {
    actions: [{
      id: 'discardTopGroup', label: 'Force a rival to discard the top card of their Group deck', timing: ['anytime'], usesToken: true, ai: 'never',
      check(s, pl, _self, p) {
        const err = rivalCheck(s, pl, p);
        if (err) return err;
        return player(s, rivalFor(s, pl, p)!).groupDeck.length ? null : 'That rival\'s Group deck is empty.';
      },
      apply(s, pl, _self, p) {
        const rival = player(s, rivalFor(s, pl, p)!);
        const top = rival.groupDeck.shift()!;
        s.cards[top].zone = 'hand'; rival.hand.push(top);
        discardCard(s, top);
        log(s, `${rival.name} discards ${cardName(s, top)} from the top of the Group deck.`, pl);
      },
    }],
  },

  'south-american-nazis': {
    powerMod: (s, self, iid) => inPlay(s, iid) && s.cards[iid].master === self && matches(s, iid, { alignments: ['Weird'], attributes: ['Science'] } as Match) ? 3 : 0,
  },

  'supreme-court': {
    actions: [cancelAction("Cancel a Government Group's action", (s, g) => hasAlign(s, g, 'Government'))],
  },

  'survivalists': {
    attackMod: (s, self, ctx, side) => side === 'defense' && !!ctx.disaster && !!ctx.targetPlayer && ctx.targetPlayer === controllerOf2(s, self) ? 3 : 0,
    onTurnStart(s, self) {
      const c = s.cards[self];
      const near = [c.master, ...Object.values(s.cards).filter((x) => x.zone === 'structure' && x.master === self).map((x) => x.iid)];
      for (const g of near) if (g) relieve(s, g, self);
    },
  },

  'templars': { actions: [discardExposed(true)] },

  'the-men-in-black': {
    // Destroyed Groups never return in this engine; the mark keeps them out of any later recovery effect.
    onAttackEnd(s, self, ctx) {
      if (ctx.attacker !== self || ctx.type !== 'destroy' || ctx.result !== 'success' || s.cards[ctx.target].zone !== 'destroyed') return;
      s.cards[ctx.target].data = { ...s.cards[ctx.target].data, removedFromGame: true };
      log(s, `${cardName(s, ctx.target)} is removed from the game permanently.`, ctx.attackerPlayer);
    },
  },

  'tobacco-companies': {
    attackMod: (s, self, ctx, side) => side === 'attack' && ctx.target === self && ctx.type === 'destroy' && !ctx.instant && !!ctx.attacker && hasAttr(s, ctx.attacker, 'Green') ? 4 : 0,
  },

  'trekkies': {
    attackMod: (s, self, ctx, side) => side === 'attack' && ctx.target === self && ctx.type === 'control' && !ctx.instant && !!ctx.attacker && hasAttr(s, ctx.attacker, 'Media') ? 4 : 0,
  },

  'tv-preachers': {
    resistanceMod: (s, self, iid) => (inPlay(s, iid) && s.cards[iid].master === self ? 5 : 0),
  },

  'underground-newspapers': {
    onDestroy(s, self, victim) {
      const ctx = s.attack;
      if (!ctx || ctx.instant || ctx.target !== victim || cancelledGroups(ctx).has(self) || !attackingGroups(ctx).includes(self)) return;
      if (!hasAlign(s, victim, 'Corporate', 'Straight', 'Government')) return;
      const pl = controllerOf2(s, self)!;
      drawPlot(s, player(s, pl));
      log(s, 'Underground Newspapers helped destroy it: draw an extra Plot.', pl);
    },
  },

  'urban-gangs': {
    attackMod: (s, self, ctx, side) => side === 'attack' && ctx.assassination && ctx.attackerPlayer === controllerOf2(s, self) ? 2 : 0,
  },

  'video-games': {
    powerMod: (s, self, iid) => iid !== self && sameOwner(s, self, iid) && isGroup(s, iid) && hasAttr(s, iid, 'Computer') ? 1 : 0,
  },
});

// ---------------------------------------------------------------- choices, private looks, moves and Relief

/** "Send Relief": this Group's Power counts `times` over; other Groups of yours may add theirs (R037 needs 3x printed Power). */
function reliefAbility(times: number, word: string): ActivatedAbility {
  return {
    id: 'relief', label: `Send Relief to a Devastated Place (its Power counts ${word})`, timing: ['main', 'attack'], usesToken: true, ai: 'never',
    needs: { target: 'place' },
    check(s, pl, self, p) {
      const place = p.target;
      if (!place || !inPlay(s, place) || def(s, place).subtype !== 'Place' || !s.cards[place].devastated) return 'Choose a Devastated Place.';
      const until = s.cards[place].data?.noReliefUntilTurn as number | undefined;
      if (until !== undefined && s.turn <= until) return 'No Relief can be sent there yet.';
      const pay = p.payWith ?? [];
      if (new Set(pay).size !== pay.length || pay.includes(self)) return 'Each other Group can help only once.';
      if (!pay.every((g) => inPlay(s, g) && s.cards[g].controller === pl && s.cards[g].tokens > 0 && !tokenBarred(s, g))) return 'Each Group helping with Relief must be yours and have an Action token.';
      const need = 3 * (def(s, place).power ?? 0);
      const own = times * power(s, self);
      const total = own + pay.reduce((n, g) => n + power(s, g), 0);
      return total >= need ? null : `Relief needs ${need} Power in total; ${cardName(s, self)} counts as ${own}, so add Groups worth ${need - total} more.`;
    },
    apply(s, pl, self, p) {
      for (const g of p.payWith ?? []) s.cards[g].tokens--;
      s.cards[p.target!].devastated = false;
      log(s, `${cardName(s, self)} sends Relief: ${cardName(s, p.target!)} is no longer Devastated.`, pl);
      raiseEvent(s, { type: 'relief', card: p.target!, player: pl, cards: [self, ...(p.payWith ?? [])] });
    },
  };
}

/** Legal new places for Group `g` (and its puppets) inside its controller's Power Structure. */
function moveSpots(s: GameState, g: string): { onto: string; side: Side }[] {
  const c = s.cards[g];
  if (!inPlay(s, g) || !c.controller) return [];
  const tree = subtree(s, g);
  const ignore = new Set(tree);
  const out: { onto: string; side: Side }[] = [];
  for (const m of structureCards(s, c.controller)) {
    if (tree.includes(m)) continue;
    for (const side of openArrows(s, m, ignore)) {
      if (m === c.master && side === sideOf(s, c.iid)) continue; // where it already is
      out.push({ onto: m, side });
    }
  }
  return out;
}
const SIDE_WORD: Record<Side, string> = { TOP: 'top', RIGHT: 'right', BOTTOM: 'bottom', LEFT: 'left' };
function askMove(s: GameState, pl: string, self: string, g: string) {
  askChoice(s, pl, {
    key: 'groups1-move', question: `${cardName(s, self)}: where should ${cardName(s, g)} go?`, min: 1, max: 1, source: self,
    options: moveSpots(s, g).map((o) => ({ id: `${o.onto}|${o.side}`, label: `${cardName(s, o.onto)}, ${SIDE_WORD[o.side]} arrow` })),
    data: { group: g },
  });
}
registerChoice('groups1-move', {
  resolve(s, pl, picked, data) {
    const g = data.group as string;
    const [onto, side] = picked[0].split('|') as [string, Side];
    if (!moveSpots(s, g).some((o) => o.onto === onto && o.side === side)) { log(s, `${cardName(s, g)} can no longer move there.`, pl); return; }
    moveSubtree(s, g, s.cards[g].controller!, onto, side, 'hand');
    // Moving under a Devastated Place costs the moved Groups their tokens (R037).
    for (const x of subtree(s, g)) if (tokenBarred(s, x)) s.cards[x].tokens = 0;
    log(s, `${cardName(s, g)} is moved under ${cardName(s, onto)}.`, pl);
  },
});

/** Rosicrucians: pick any card from your Plot deck, then shuffle it. */
function rosicruciansSearch(s: GameState, pl: string, self: string) {
  askChoice(s, pl, {
    key: 'rosicrucians-search', question: 'Rosicrucians: take any card from your Plot deck (the deck is then shuffled).', min: 1, max: 1, source: self,
    options: player(s, pl).plotDeck.map((c) => ({ id: c, label: cardName(s, c) })),
  });
}
registerChoice('rosicrucians-search', {
  resolve(s, pl, picked) {
    const p = player(s, pl);
    const c = picked[0];
    if (!p.plotDeck.includes(c)) return;
    p.plotDeck = p.plotDeck.filter((x) => x !== c);
    s.cards[c].zone = 'hand';
    p.hand.push(c);
    shuffle(s, p.plotDeck);
    log(s, `${p.name} searches the Plot deck for a card and shuffles it.`, pl);
  },
});

/** Plots that count as Magic when used to destroy (as for Count Dracula). */
const MAGIC_PLOTS = ['withering-curse', 'plague-of-demons'];
function magicAttack(s: GameState, ctx?: AttackCtx): boolean {
  if (!ctx) return false;
  const gone = cancelledGroups(ctx);
  if (attackingGroups(ctx).some((g) => !gone.has(g) && hasAttr(s, g, 'Magic'))) return true;
  return !!ctx.instantCard && MAGIC_PLOTS.includes(s.cards[ctx.instantCard]?.cardId);
}

/** The deck a card points at: `target` is a player's Illuminati card; no target means your own. */
function deckOwner(s: GameState, pl: string, p: AbilityParams): string | undefined {
  if (!p.target) return pl;
  const c = s.cards[p.target];
  const who = c ? c.controller ?? c.owner : undefined;
  return who && livePlayers(s).some((x) => x.id === who) ? who : undefined;
}
function nsaInspect(free: boolean): ActivatedAbility {
  return {
    id: free ? 'inspect' : 'inspectAction',
    label: free ? 'Look at the top or bottom three cards of a Plot deck (free, once on your turn)' : 'Look at the top or bottom three cards of a Plot deck',
    timing: free ? ['main'] : ['anytime'], usesToken: !free, oncePerTurn: free, ai: 'never',
    needs: { target: 'rival', modes: ['top', 'bottom'] },
    check(s, pl, _self, p) {
      const who = deckOwner(s, pl, p);
      if (!who) return 'Choose a player.';
      if (protectedPlayer(s, pl, who)) return 'That player has not finished a first turn yet.';
      if (p.mode !== 'top' && p.mode !== 'bottom') return 'Choose the top or the bottom of the deck.';
      return player(s, who).plotDeck.length ? null : 'That Plot deck is empty.';
    },
    apply(s, pl, self, p) {
      const who = deckOwner(s, pl, p)!;
      const deck = player(s, who).plotDeck;
      const cards = p.mode === 'top' ? deck.slice(0, 3) : deck.slice(-3).reverse();
      revealTo(s, pl, cards, `${cardName(s, self)}: the ${p.mode} of ${player(s, who).name}'s Plot deck holds`);
    },
  };
}

registerHooks({
  'mossad': {
    beforeDraw: (s, self, pl, deck) => (deck === 'plot' && pl === controllerOf2(s, self) && s.cards[self].data?.drawBottom ? 'bottom' : undefined),
    actions: [
      {
        id: 'peek', label: 'Look at the bottom card of your Plot deck', timing: ['anytime'], usesToken: false, ai: 'never',
        check: (s, pl) => (player(s, pl).plotDeck.length ? null : 'Your Plot deck is empty.'),
        apply(s, pl, self) { revealTo(s, pl, player(s, pl).plotDeck.slice(-1), `${cardName(s, self)}: the bottom of your Plot deck is`); },
      },
      {
        id: 'drawFrom', label: 'Choose whether your Plot draws come from the top or the bottom of the deck', timing: ['anytime'], usesToken: false, ai: 'never',
        needs: { modes: ['top', 'bottom'] },
        check: (_s, _pl, _self, p) => (p.mode === 'top' || p.mode === 'bottom' ? null : 'Choose the top or the bottom.'),
        apply(s, pl, self, p) {
          s.cards[self].data = { ...s.cards[self].data, drawBottom: p.mode === 'bottom' };
          log(s, `Your Plot draws now come from the ${p.mode} of the deck.`, pl);
        },
      },
    ],
  },

  'multinational-oil-companies': {
    actions: [{
      id: 'designate', label: 'Name one rival who may not take part in this attack', timing: ['attack'], usesToken: false, ai: 'never',
      needs: { target: 'rival' },
      check(s, pl, self, p, ctx) {
        if (!ctx || ctx.instant) return 'Only during an attack this Group makes or aids.';
        if (ctx.attacker !== self && !ctx.aid.some((a) => a.iid === self)) return 'Only during an attack this Group makes or aids.';
        if (cancelledGroups(ctx).has(self)) return 'This Group\'s action was cancelled.';
        if (livePlayers(s).length < 3) return 'Only in a game with more than two players.';
        if (s.cards[self].data?.designatedAttack === ctx.id) return 'A rival has already been named for this attack.';
        const r = rivalFor(s, pl, p);
        if (!r) return 'Choose a rival.';
        if (r === ctx.targetPlayer || r === ctx.attackerPlayer) return 'Choose a rival who is not already part of this attack.';
        return null;
      },
      apply(s, pl, self, p, ctx) {
        const r = rivalFor(s, pl, p)!;
        ctx!.barred = [...(ctx!.barred ?? []), r];
        s.cards[self].data = { ...s.cards[self].data, designatedAttack: ctx!.id };
        log(s, `${player(s, r).name} may not interfere in this attack.`, pl);
      },
    }],
  },

  'nato': { actions: [reliefAbility(3, 'three times')] },
  'united-nations': { actions: [reliefAbility(5, 'five times')] },

  'n-s-a': { actions: [nsaInspect(true), nsaInspect(false)] },

  'offshore-banks': {
    actions: [{
      id: 'freeMove', label: 'Move one of your Groups to another open arrow (free, once on your turn)', timing: ['main'], usesToken: false, oncePerTurn: true, ai: 'never',
      needs: { target: 'ownGroup' },
      check(s, pl, _self, p, ctx) {
        if (ctx) return 'Not during an attack.';
        const g = p.target;
        if (!g || !inPlay(s, g) || s.cards[g].controller !== pl || !isGroup(s, g)) return 'Choose one of your Groups.';
        return moveSpots(s, g).length ? null : `${cardName(s, g)} has nowhere else to go.`;
      },
      apply(s, pl, self, p) { askMove(s, pl, self, p.target!); },
    }],
  },

  'phone-phreaks': {
    actions: [{
      id: 'move', label: 'Move a Group in any Power Structure to another open arrow', timing: ['main'], usesToken: true, ai: 'never',
      needs: { target: 'group' },
      check(s, pl, _self, p, ctx) {
        if (ctx) return 'Not during an attack.';
        const g = p.target;
        if (!g || !inPlay(s, g) || !isGroup(s, g)) return 'Choose a Group in a Power Structure.';
        const owner = s.cards[g].controller!;
        if (owner !== pl && s.cards[g].master === player(s, owner).illuminati) return 'A Group directly controlled by a rival\'s Illuminati cannot be moved.';
        if (protectedPlayer(s, pl, owner)) return 'That player has not finished a first turn yet.';
        return moveSpots(s, g).length ? null : `${cardName(s, g)} has nowhere else to go.`;
      },
      apply(s, pl, self, p) { askMove(s, pl, self, p.target!); },
    }],
  },

  'punk-rockers': {
    // Their Power is on the attacking side: no Weird or Liberal Group may help defend the target.
    forbidJoin: (s, self, ctx, group, as) => as === 'oppose' && group !== ctx.target && attackingGroups(ctx).includes(self) &&
      !cancelledGroups(ctx).has(self) && isGroup(s, group) && hasAlign(s, group, 'Weird', 'Liberal'),
  },

  'reformed-church-of-satan': {
    forbidAttack: (_s, self, _attacker, target, type) => (target === self && type === 'control' ? 'The Reformed Church of Satan can only be attacked to destroy it.' : null),
  },

  'rosicrucians': {
    beforeDraw(s, self, pl, deck) {
      const c = s.cards[self];
      if (deck !== 'plot' || pl !== controllerOf2(s, self) || !c.data?.search || tokenBarred(s, self) || !player(s, pl).plotDeck.length) return undefined;
      if (s.phase === 'beginning') {
        // Start-of-turn draw: the search (and this turn's action of the Rosicrucians) comes in the main phase.
        if (c.data.owedTurn === s.turn) return undefined;
        c.data = { ...c.data, owedTurn: s.turn };
        log(s, 'The Rosicrucians will search the Plot deck instead of this draw.', pl);
        return 'skip';
      }
      if (c.tokens < 1) return undefined;
      c.tokens--;
      rosicruciansSearch(s, pl, self);
      return 'skip';
    },
    actions: [
      {
        id: 'searchMode', label: 'Choose whether Plot draws become a Rosicrucian search of the deck', timing: ['anytime'], usesToken: false, ai: 'never',
        needs: { modes: ['search', 'draw'] },
        check: (_s, _pl, _self, p) => (p.mode === 'search' || p.mode === 'draw' ? null : 'Choose search or draw.'),
        apply(s, pl, self, p) {
          s.cards[self].data = { ...s.cards[self].data, search: p.mode === 'search' };
          log(s, p.mode === 'search' ? 'Your Plot draws become searches while the Rosicrucians have an Action token.' : 'Your Plot draws are normal again.', pl);
        },
      },
      {
        id: 'search', label: 'Search the Plot deck for the draw you gave up', timing: ['main'], usesToken: true, ai: 'draw',
        check(s, pl, self) {
          if (s.cards[self].data?.owedTurn !== s.turn) return 'No Plot draw is waiting to be searched for.';
          return player(s, pl).plotDeck.length ? null : 'Your Plot deck is empty.';
        },
        apply(s, pl, self) {
          const c = s.cards[self];
          c.data = { ...c.data, owedTurn: undefined };
          rosicruciansSearch(s, pl, self);
        },
      },
    ],
  },

  'saturday-morning-cartoons': {
    alignmentMod: (s, self, iid, current) => (inPlay(s, iid) && s.cards[iid].master === self
      ? [...current.filter((a) => a !== 'Peaceful' && a !== 'Violent'), 'Violent' as Alignment] : current),
  },

  'tabloids': {
    // It may attack Secret Groups directly; in that attack the target is not Secret and anyone may help either side.
    secretOverride: (s, self, group, secret) => {
      const ctx = s.attack;
      if (!ctx) return group === self;
      return ctx.attacker === self && !ctx.instant && secret === ctx.target && !attackCancelled(ctx);
    },
    mayJoin: (s, self, ctx) => ctx.attacker === self && !ctx.instant && hasAttr(s, ctx.target, 'Secret'),
  },

  'vampires': {
    onCapture(s, self, victim) {
      const ctx = s.attack;
      if (!ctx || ctx.attacker !== self || ctx.type !== 'control' || def(s, victim).subtype !== 'Personality') return;
      s.cards[victim].data = { ...s.cards[victim].data, vampire: true };
      log(s, `${cardName(s, victim)} becomes a Vampire: only Magic can destroy it now, and then for good.`, ctx.attackerPlayer);
    },
    preventDestroy: (s, _self, target, ctx) => !!s.cards[target].data?.vampire && !magicAttack(s, ctx),
    onDestroy(s, _self, victim, by) {
      if (!s.cards[victim].data?.vampire) return;
      s.cards[victim].data = { ...s.cards[victim].data, removedFromGame: true };
      log(s, `${cardName(s, victim)} is gone for good.`, by);
    },
  },
});
