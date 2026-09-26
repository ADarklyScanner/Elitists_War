// Assassins pack, batch "assassins1": Society of Assassins (the pack's Illuminati) and two dozen
// Groups and Personalities. See docs/CARD_SCRIPTING.md ("Expansions") and docs/EXPANSIONS.md.
import type { Alignment, GameState } from '../types';
import { registerAbilities } from '../abilities';
import { registerHooks, HOOKS } from '../hooks';
import { PLOTS } from '../plotTypes';
import { def, cardName } from '../cards';
import { alignments, attributes, power } from '../stats';
import { structureCards, openArrows } from '../geometry';
import {
  controllerOf2, player, log, drawPlot, destroyGroup, discardCard, placeGroup,
  checkPlot, playPlot, startAttack, attackCancelled,
} from '../game';
import { shuffle, rollDie } from '../rng';

// ==================================================================== Society of Assassins (Illuminati)

registerAbilities({
  // Special Goal: a Secret Group counts double for the Basic Goal, unless a rival controls a stronger one.
  'society-of-assassins': [
    { kind: 'doubleCount', match: { attributes: ['Secret'] }, unlessRivalStronger: true },
  ],
});

registerHooks({
  'society-of-assassins': {
    // Global Power equal to Power, for every Fanatic Group this Illuminati controls.
    globalMod(s, self, iid) {
      if (controllerOf2(s, self) !== controllerOf2(s, iid) || !alignments(s, iid).includes('Fanatic')) return 0;
      return power(s, iid);
    },
    // RULING: the card lets you pick, per attack, which other Fanatic Group's alignment a Fanatic Group
    // borrows in place of its generic Fanatic identity. The engine does not model that choice; instead,
    // while a controlled Fanatic Group takes part in an attack (attacking, defending, aiding or opposing),
    // it automatically borrows the alignment of one of your other Fanatic Groups if doing so matches an
    // alignment on the opposing side (gaining the same-alignment credit that a plain "Fanatic" cannot).
    alignmentMod(s, self, iid, current, goals) {
      if (goals || !current.includes('Fanatic')) return current;
      const pl = controllerOf2(s, self);
      if (!pl || controllerOf2(s, iid) !== pl) return current;
      const ctx = s.attack;
      if (!ctx) return current;
      const onAttack = ctx.attacker === iid || ctx.aid.some((a) => a.iid === iid);
      const onDefense = ctx.target === iid || ctx.oppose.some((o) => o.iid === iid);
      if (!onAttack && !onDefense) return current;
      // Printed alignments only (not `alignments()`, which would call this same hook again for another
      // Fanatic Group in the same attack — e.g. two of your Fanatic Groups both aiding — and recurse).
      const printed = (x?: string) => (x && s.cards[x] ? def(s, x).alignments ?? [] : []);
      const opposing: string[] = [];
      const collect = (x?: string) => opposing.push(...printed(x));
      if (onAttack) { collect(ctx.target); for (const o of ctx.oppose) collect(o.iid); }
      else { collect(ctx.attacker); for (const a of ctx.aid) collect(a.iid); }
      for (const g of structureCards(s, pl)) {
        if (g === iid) continue;
        const al = printed(g);
        if (!al.includes('Fanatic')) continue;
        const borrow = al.find((a) => a !== 'Fanatic' && opposing.includes(a));
        if (borrow) return [...current.filter((a) => a !== 'Fanatic'), 'Fanatic', borrow as Alignment];
      }
      return current;
    },
  },
});

// ==================================================================== Arms Dealers

registerAbilities({ 'arms-dealers': [] });
registerHooks({
  'arms-dealers': {
    actions: [{
      id: 'trade', label: "Trade a Plot for one of a rival's exposed Plots", timing: ['anytime'], usesToken: true,
      needs: { target: 'rivalHand', targetsOf: 'handPlot' },
      // RULING: the printed card trades any number of Plots at once. Trading them one at a time (a
      // separate use of this ability, once per token, for each pair) is the closest faithful version the
      // interface's single-target selection supports.
      check(s, pl, _self, p) {
        const t = p.target;
        if (!t || !s.cards[t] || def(s, t).type !== 'Plot') return "Choose an exposed Plot in a rival's hand.";
        const owner = s.players.find((x) => x.hand.includes(t));
        if (!owner || owner.id === pl) return "Choose a Plot belonging to a rival.";
        if (!s.cards[t].exposed) return 'That Plot must be exposed.';
        const give = p.targets ?? [];
        if (give.length !== 1 || give[0] === t || !player(s, pl).hand.includes(give[0]) || def(s, give[0]).type !== 'Plot') {
          return 'Choose one Plot of yours to trade for it.';
        }
        return null;
      },
      apply(s, pl, self, p) {
        const theirs = p.target!;
        const mine = p.targets![0];
        const owner = s.players.find((x) => x.hand.includes(theirs))!;
        const me = player(s, pl);
        me.hand = me.hand.filter((c) => c !== mine);
        owner.hand = owner.hand.filter((c) => c !== theirs);
        me.hand.push(theirs);
        owner.hand.push(mine);
        // "Plots you get may be hidden" — the traded-in card is no longer known to be exposed.
        s.cards[theirs].exposed = false;
        log(s, `${cardName(s, self)}: ${me.name} trades a Plot card with ${owner.name}.`, pl);
      },
    }],
  },
});

// ==================================================================== Church of Violentology

registerAbilities({ 'church-of-violentology': [] });
registerHooks({
  'church-of-violentology': {
    // Every Group that helps destroy it earns its controller a Plot (fires while its own hooks are
    // still active, right before it actually leaves the Power Structure).
    onDestroy(s, self, victim, by) {
      if (victim !== self) return;
      const ctx = s.attack;
      if (!ctx || ctx.target !== self || ctx.type !== 'destroy') return;
      const helpers = [ctx.attacker, ...ctx.aid.map((a) => a.iid)].filter((x): x is string => !!x);
      for (const g of helpers) {
        const pl = controllerOf2(s, g) ?? by;
        drawPlot(s, player(s, pl), 1);
      }
    },
    // A failed Attack to Destroy: its controller draws a Plot per attacking Group, and the weakest
    // attacking Group (never an Illuminati) is destroyed, credited to the Church's controller.
    onAttackEnd(s, self, ctx) {
      if (ctx.target !== self || ctx.type !== 'destroy' || ctx.result !== 'failure' || attackCancelled(ctx)) return;
      const churchController = controllerOf2(s, self);
      if (!churchController) return;
      const helpers = [ctx.attacker, ...ctx.aid.map((a) => a.iid)].filter((x): x is string => !!x);
      if (!helpers.length) return;
      drawPlot(s, player(s, churchController), helpers.length);
      const candidates = helpers.filter((g) => def(s, g).type !== 'Illuminati');
      if (!candidates.length) return;
      const weakest = candidates.reduce((a, b) => (def(s, b).power ?? 0) < (def(s, a).power ?? 0) ? b : a);
      log(s, `${cardName(s, self)}'s minions destroy ${cardName(s, weakest)}.`, churchController);
      destroyGroup(s, weakest, churchController);
    },
  },
});

// ==================================================================== Convenience Stores

registerAbilities({
  'convenience-stores': [
    { kind: 'selfDefense', value: 10, on: 'destroy' },
  ],
});
registerHooks({
  'convenience-stores': {
    // +5 more for any agents card played by anyone (its own controller's automatically; the card lets
    // its controller give the same bonus to another player's agents use "at no cost", so the engine
    // just always grants it — there is never a reason to withhold a free bonus). No effect on a spare
    // Illuminati card used the same way (checked via the underlying card's type).
    attackMod(s, _self, ctx, side) {
      const list = side === 'attack' ? ctx.attackBonus : ctx.defenseBonus;
      return list.some((b) => b.plot && s.cards[b.plot] && def(s, b.plot).type === 'Group' && b.label.startsWith('Agents')) ? 5 : 0;
    },
  },
});

// ==================================================================== Copy Shops

function tempCopy(s: GameState, pl: string, src: string): string {
  const cardId = s.cards[src].cardId;
  const iid = `${pl}-copyshop-${Object.keys(s.cards).length}`;
  s.cards[iid] = { iid, cardId, owner: pl, zone: 'hand', tokens: 0, mods: [] };
  player(s, pl).hand.push(iid);
  return iid;
}

registerAbilities({ 'copy-shops': [] });
registerHooks({
  'copy-shops': {
    actions: [{
      id: 'copy', label: "Copy a rival's exposed Plot and use it at once", timing: ['anytime'], usesToken: true,
      needs: { target: 'rivalHand', targetsOf: 'handPlot' },
      // Its check() clones the whole game state to test the copy's legality; too expensive to weigh in
      // computer look-ahead for a rare, situational ability.
      ai: 'never',
      check(s, pl, _self, p) {
        const t = p.target;
        if (!t || !s.cards[t] || def(s, t).type !== 'Plot') return "Choose an exposed Plot in a rival's hand.";
        const owner = s.players.find((x) => x.hand.includes(t));
        if (!owner || owner.id === pl) return "Choose a Plot belonging to a rival.";
        if (!s.cards[t].exposed) return 'That Plot must be exposed.';
        if (def(s, t).subtype === 'Goal') return 'Copy Shops cannot copy a Goal card.'; // RULING: a Goal is claimed, not "played"; not modeled.
        if (!PLOTS[s.cards[t].cardId]) return `${cardName(s, t)} is not available in this version yet.`;
        const give = p.targets ?? [];
        if (give.length !== 1 || !player(s, pl).hand.includes(give[0]) || def(s, give[0]).type !== 'Plot') {
          return 'Discard one Plot card from your hand to pay for the copy.';
        }
        const probe = structuredClone(s);
        const temp = tempCopy(probe, pl, t);
        return checkPlot(probe, pl, { card: temp, ...(p.copyPlay ?? {}) });
      },
      apply(s, pl, self, p) {
        discardCard(s, p.targets![0]);
        const t = p.target!;
        const temp = tempCopy(s, pl, t);
        log(s, `${cardName(s, self)}: ${player(s, pl).name} copies ${cardName(s, t)}.`, pl);
        playPlot(s, pl, { card: temp, ...(p.copyPlay ?? {}) });
      },
    }],
  },
});

// ==================================================================== Day Care Centers

registerAbilities({ 'day-care-centers': [] });
registerHooks({
  'day-care-centers': {
    // Always exactly its master's current alignments.
    alignmentMod(s, self, iid, current) {
      if (iid !== self || s.cards[self].zone !== 'structure') return current;
      const master = s.cards[self].master;
      return master ? alignments(s, master) : current;
    },
    // When destroyed, the alignments it had at that moment are frozen in place (its own hook then
    // becomes inactive; `destroyGroup` turns `data.freezeAlignments` into permanent modifiers once the
    // generic destruction reset has cleared its old ones).
    onDestroy(s, self, victim) {
      if (victim !== self) return;
      s.cards[self].data = { ...s.cards[self].data, freezeAlignments: alignments(s, self) };
    },
  },
});

// ==================================================================== Dittoheads
// RULING: "only a Personality may control it, on any arrow even without a printed one" needs placement
// rules the engine's geometry does not offer for one card; a Dittoheads is captured and placed like any
// other Group, on a real open arrow. The bonus to its master, and its borrowed alignments, are exact.

registerAbilities({ 'dittoheads': [] });
registerHooks({
  'dittoheads': {
    powerMod(s, self, iid) {
      const master = s.cards[self].master;
      return iid === master && def(s, master).subtype === 'Personality' ? 2 : 0;
    },
    resistanceMod(s, self, iid) {
      const master = s.cards[self].master;
      if (iid !== master || def(s, master).subtype !== 'Personality') return 0;
      return (def(s, master).resistance ?? 0) * 2; // tripled: base (already counted) + 2x more
    },
    alignmentMod(s, self, iid, current) {
      if (iid !== self) return current;
      const master = s.cards[self].master;
      if (!master) return current;
      const al = [...alignments(s, master)];
      if (!al.includes('Fanatic')) al.push('Fanatic');
      return al;
    },
  },
});

// ==================================================================== Drug Companies

registerAbilities({ 'drug-companies': [] });
registerHooks({
  'drug-companies': {
    // Its own +10 bonus applies only to this special attack, never a normal Attack to Control.
    attackMod(s, self, ctx, side) {
      return side === 'attack' && ctx.attacker === self && ctx.type === 'control' && ctx.stripAlignment ? 10 : 0;
    },
    actions: [{
      // RULING: reuses the normal Attack to Control machinery in full (proximity, alignment maths,
      // aid/oppose, cancels) so it needs the attacker's own open control arrow, though nothing is
      // actually captured on success.
      id: 'strip-alignment', label: 'Attack to strip an alignment', timing: ['main'], usesToken: false,
      needs: { target: 'group', alignment: true },
      check(s, pl, self, p) {
        const t = p.target;
        if (!t || !s.cards[t] || def(s, t).type !== 'Group' || s.cards[t].zone !== 'structure') return 'Choose a Group in play.';
        if (!p.alignment || !alignments(s, t).includes(p.alignment as Alignment)) return 'Choose an alignment that Group currently has.';
        if (s.cards[self].tokens < 1) return `${cardName(s, self)} has no Action token.`;
        return null;
      },
      apply(s, pl, self, p) {
        startAttack(s, pl, { type: 'attack', attackType: 'control', attacker: self, target: p.target! });
        s.attack!.stripAlignment = p.alignment as Alignment;
      },
      ai: 'never', // rare, situational, and only worth it for a computer player with a clear read on the board
    }],
  },
});

// ==================================================================== EPA

registerAbilities({ 'epa': [] });
registerHooks({
  'epa': {
    disablesAbilities(s, self, iid) {
      return s.cards[iid].cardId === 'nuclear-power-companies' && s.cards[self].tokens > 0;
    },
  },
});

// ==================================================================== Militia

registerAbilities({ 'militia': [] });
registerHooks({
  'militia': {
    onAttackEnd(s, self, ctx) {
      if (ctx.type !== 'destroy' || attackCancelled(ctx) || s.cards[self].zone !== 'structure') return;
      if (ctx.attacker !== self && !ctx.aid.some((a) => a.iid === self)) return;
      const base = def(s, self).power ?? 1;
      const mods = s.cards[self].mods;
      const cur = mods.filter((m) => m.source === self && m.kind === 'power').reduce((n, m) => n + (m.value ?? 0), 0);
      const next = ctx.result === 'success' ? cur + 1 : Math.max(1 - base, cur - 1);
      s.cards[self].mods = [...mods.filter((m) => !(m.source === self && m.kind === 'power')), { source: self, kind: 'power', value: next, until: 'permanent' }];
      log(s, `${cardName(s, self)}'s Power ${next > cur ? 'rises' : 'drops'} to ${base + next}.`, controllerOf2(s, self));
    },
  },
});

// ==================================================================== Nutrition Nazis
// RULING: the second use — playing it from hand like a Plot, once per game, to give a Group the Science
// attribute — is not implemented: it needs a Group card to go through the Plot-play pipeline, which the
// engine reserves for Plot cards. Its main ability (Science Groups may always join a fight it is part of)
// is fully implemented.

registerAbilities({ 'nutrition-nazis': [] });
registerHooks({
  'nutrition-nazis': {
    mayJoin(s, self, ctx, group, as) {
      if (!attributes(s, group).includes('Science')) return false;
      const onAttack = ctx.attacker === self || ctx.aid.some((a) => a.iid === self);
      const onDefense = ctx.target === self || ctx.oppose.some((o) => o.iid === self);
      return (as === 'aid' && onAttack) || (as === 'oppose' && onDefense);
    },
  },
});

// ==================================================================== Pale People In Black
// RULING: fully ignores the opposite-alignment penalty when it leads an Attack to Control (the common
// case, via `replacesAlignmentPenalty`). The base attack-strength formula only ever applies that penalty
// for the leading attacker versus the target, so a Pale People In Black that only aids such an attack has
// no separate penalty to remove in the first place.

registerAbilities({
  // RULING: the printed card removes the opposite-alignment penalty whenever it *participates* in an
  // Attack to Control, but the base game's alignment maths (R006) only ever computes that penalty from
  // the *leading* attacker's alignments versus the target's — and this Group has no outgoing arrow (per
  // the scan), so it can never lead a capture. `replacesAlignmentPenalty` is declared for a future card or
  // rule that lets it lead (or is read directly, as the test here does), giving the exact intended effect
  // whenever it is the leader; while it only aids, there is no leader-side penalty of its own to remove.
  'pale-people-in-black': [
    { kind: 'cannotBeDestroyed' },
    { kind: 'attackBonus', on: 'control', target: {}, value: 0, scope: 'direct', replacesAlignmentPenalty: true },
  ],
});
registerHooks({ 'pale-people-in-black': {} });

// ==================================================================== Recycling Centers

registerAbilities({ 'recycling-centers': [] });
registerHooks({
  'recycling-centers': {
    actions: [{
      id: 'salvage', label: 'Salvage a Group or Gadget discarded this turn', timing: ['anytime'], usesToken: true,
      needs: { target: 'discardPile' },
      check(s, pl, _self, p) {
        const t = p.target;
        if (!t || !s.cards[t] || s.cards[t].zone !== 'discard') return 'Choose a card in a discard pile.';
        const d = def(s, t);
        const gadget = d.type === 'Resource' && /\bGadget\b/.test(d.uniqueness ?? '');
        if (d.type !== 'Group' && !gadget) return 'Choose a Group card or a Gadget Resource.';
        if (s.cards[t].data?.discardTurn !== s.turn) return 'That card must have been discarded this turn.';
        return null;
      },
      apply(s, pl, self, p) {
        const t = p.target!;
        const owner = player(s, s.cards[t].owner);
        owner.discard = owner.discard.filter((c) => c !== t);
        if (s.common) {
          s.common.plotDiscard = s.common.plotDiscard.filter((c) => c !== t);
          s.common.groupDiscard = s.common.groupDiscard.filter((c) => c !== t);
        }
        s.cards[t].zone = 'hand';
        owner.hand.push(t);
        log(s, `${cardName(s, self)}: ${cardName(s, t)} is salvaged back to ${owner.name}'s hand.`, pl);
      },
    }],
  },
});

// ==================================================================== Science Alarmists
// RULING: "without your permission" would need a permission-request flow; the engine always withholds
// permission, so no rival's Group of these attributes can ever be taken over automatically while this
// Group is controlled.

registerAbilities({ 'science-alarmists': [] });
registerHooks({
  'science-alarmists': {
    forbidAttack(s, self, _attacker, target, type, attackerPlayer) {
      if (type !== 'takeover' || attackerPlayer === controllerOf2(s, self)) return null;
      if (!s.cards[target] || def(s, target).type !== 'Group') return null;
      if (!attributes(s, target).includes('Science') && !attributes(s, target).includes('Green')) return null;
      return `${cardName(s, self)}: no automatic takeover of a Science or Green Group without permission.`;
    },
  },
});

// ==================================================================== Shock Jocks

registerAbilities({ 'shock-jocks': [] });
registerHooks({
  'shock-jocks': {
    alignmentMod(s, self, iid, current) {
      if (iid !== self) return current;
      const ctx = s.attack;
      if (!ctx || ctx.type !== 'control' || ctx.attacker !== self) return current;
      if (!s.cards[ctx.target] || !alignments(s, ctx.target).includes('Straight')) return current;
      return current.map((a) => (a === 'Weird' ? 'Straight' : a));
    },
    mayInterfere(s, self, pl) {
      if (pl !== controllerOf2(s, self) || !s.attack) return false;
      const ctx = s.attack;
      const involves = (iid?: string) => !!iid && s.cards[iid] && alignments(s, iid).includes('Straight');
      return involves(ctx.attacker) || involves(ctx.target) || ctx.aid.some((a) => involves(a.iid)) || ctx.oppose.some((o) => involves(o.iid));
    },
  },
});

// ==================================================================== State Lotteries

registerAbilities({ 'state-lotteries': [] });
registerHooks({
  'state-lotteries': {
    actions: [{
      id: 'redraw', label: 'Reshuffle your Groups or your Plots and redraw', timing: ['anytime'], usesToken: true,
      needs: { modes: ['groups', 'plots'] },
      check(s, pl, _self, p) {
        if (p.mode !== 'groups' && p.mode !== 'plots') return 'Choose Groups or Plots.';
        return null;
      },
      apply(s, pl, self, p) {
        const isGroups = p.mode === 'groups';
        const me = player(s, pl);
        const cards = me.hand.filter((c) => (isGroups ? def(s, c).type === 'Group' : def(s, c).type === 'Plot' || def(s, c).type === 'Illuminati'));
        me.hand = me.hand.filter((c) => !cards.includes(c));
        const deck = isGroups ? me.groupDeck : me.plotDeck;
        for (const c of cards) { s.cards[c].zone = isGroups ? 'groupDeck' : 'plotDeck'; s.cards[c].exposed = false; deck.push(c); }
        shuffle(s, deck);
        const draws = Math.max(0, cards.length - 1);
        log(s, `${cardName(s, self)}: ${me.name} reshuffles ${cards.length} ${isGroups ? 'Group' : 'Plot'} card${cards.length === 1 ? '' : 's'} and draws ${draws}.`, pl);
        for (let i = 0; i < draws; i++) {
          const top = deck.shift();
          if (!top) break;
          s.cards[top].zone = 'hand';
          me.hand.push(top);
        }
      },
    }],
  },
});

// ==================================================================== Swingers

registerAbilities({
  'swingers': [
    { kind: 'powerPer', per: { alignments: ['Liberal'], notSelf: true }, value: 1 },
  ],
});
registerHooks({ 'swingers': {} });

// ==================================================================== The Green Party

registerAbilities({
  'the-green-party': [
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Green'] }, value: 4, scope: 'direct' },
  ],
});
registerHooks({
  'the-green-party': {
    powerMod(s, self, iid) {
      if (iid === self || controllerOf2(s, self) !== controllerOf2(s, iid)) return 0;
      return attributes(s, iid).includes('Green') ? 1 : 0;
    },
  },
});

// ==================================================================== The Thule Group
// RULING: "protects" Hitler's Brain's own Peaceful-control restriction is Hitler's Brain's own card
// (elsewhere); here only "cannot be captured or destroyed while linked to it" is this card's own text.

registerAbilities({ 'the-thule-group': [] });
registerHooks({
  'the-thule-group': {
    actions: [{
      id: 'sacrifice', label: 'Discard Groups from hand for Power or Resistance', timing: ['attack'], usesToken: true,
      needs: { target: 'handGroup', targetsOf: 'handGroup', modes: ['attack', 'defense'] },
      check(s, pl, _self, p, ctx) {
        if (!ctx) return 'Only during an attack.';
        if (p.mode !== 'attack' && p.mode !== 'defense') return 'Choose attack or defense.';
        const give = p.targets ?? [];
        if (!give.length || !give.every((c) => player(s, pl).hand.includes(c) && def(s, c).type === 'Group')) {
          return 'Choose one or more Group cards from your hand to discard.';
        }
        return null;
      },
      apply(s, pl, self, p, ctx) {
        const total = p.targets!.reduce((n, c) => n + (def(s, c).power ?? 0), 0);
        for (const c of [...p.targets!]) discardCard(s, c);
        const entry = { player: pl, plot: self, amount: total, label: `${cardName(s, self)} (discarded Groups)` };
        (p.mode === 'attack' ? ctx!.attackBonus : ctx!.defenseBonus).push(entry);
      },
    }],
    preventDestroy(s, self, target) {
      return target === self && Object.values(s.cards).some((c) => c.cardId === 'hitler-s-brain' && c.zone === 'resources' && c.linkedTo === self);
    },
    forbidAttack(s, self, _attacker, target, type) {
      if (type !== 'control' && type !== 'takeover') return null;
      if (target !== self) return null;
      const linked = Object.values(s.cards).some((c) => c.cardId === 'hitler-s-brain' && c.zone === 'resources' && c.linkedTo === self);
      return linked ? `${cardName(s, self)} cannot be captured while Hitler's Brain is linked to it.` : null;
    },
  },
});

// ==================================================================== General Disorder
// RULING: linked Plots and stat-changing modifiers are restored on revival; the standard "linked Plots
// are discarded when their Group is destroyed" rule still applies at the moment of destruction, since
// undoing it there would require bypassing that generic step for this one card.

registerAbilities({ 'general-disorder': [] });
registerHooks({
  'general-disorder': {
    actions: [{
      id: 'disorder', label: 'Give +10 to a Disaster (Devastate only)', timing: ['attack'], usesToken: true,
      check(s, pl, _self, _p, ctx) {
        if (!ctx?.disaster) return 'Only while a Disaster is in progress.';
        return null;
      },
      apply(s, pl, self, _p, ctx) {
        ctx!.attackBonus.push({ player: pl, plot: self, amount: 10, label: cardName(s, self) });
        ctx!.disaster = { ...ctx!.disaster!, devastateOnly: true };
      },
    }],
    onDestroy(s, self, victim) {
      if (victim !== self) return;
      const master = s.cards[self].master;
      s.cards[self].data = {
        ...s.cards[self].data,
        reviveAtEndOfTurn: s.turn,
        gdMaster: master,
        gdController: s.cards[self].controller,
        gdMods: s.cards[self].mods,
      };
    },
    delayedRevive(s, self) {
      const data = (s.cards[self].data ?? {}) as { gdMaster?: string; gdController?: string; gdMods?: typeof s.cards[string]['mods'] };
      const savedMods = data.gdMods ?? [];
      const master = data.gdMaster;
      if (master && s.cards[master]?.zone === 'structure') {
        const open = openArrows(s, master);
        if (open.length) {
          placeGroup(s, self, s.cards[master].controller!, master, open[0]);
          s.cards[self].tokens = 0;
          s.cards[self].mods = savedMods;
          log(s, `${cardName(s, self)} returns from the dead onto ${cardName(s, master)}.`, s.cards[master].controller);
          s.cards[self].data = { ...s.cards[self].data, reviveAtEndOfTurn: undefined };
          return;
        }
      }
      const ownerId = data.gdController ?? s.cards[self].owner;
      s.cards[self].zone = 'hand';
      s.cards[self].mods = savedMods;
      player(s, ownerId).hand.push(self);
      log(s, `${cardName(s, self)} returns from the dead to ${player(s, ownerId).name}'s hand.`, ownerId);
      s.cards[self].data = { ...s.cards[self].data, reviveAtEndOfTurn: undefined };
    },
  },
});

// ==================================================================== Lama Ramadingdong

registerAbilities({ 'lama-ramadingdong': [] });
registerHooks({
  'lama-ramadingdong': {
    powerMod(s, self, iid) {
      if (iid !== self) return 0;
      let n = 0;
      for (const c of Object.values(s.cards)) {
        if (c.iid !== self && c.zone === 'structure' && def(s, c.iid).type === 'Group' && attributes(s, c.iid).includes('Green')) n++;
      }
      return n;
    },
    attackMod(s, self, ctx, side) {
      if (side !== 'defense' || ctx.target === self || !s.cards[ctx.target]) return 0;
      return attributes(s, ctx.target).includes('Green') ? power(s, self) : 0;
    },
  },
});

// ==================================================================== Lyndon LaRouche

const LAROUCHE_PARTIES = new Set(['republicans', 'democrats', 'libertarians', 'the-green-party']);

registerAbilities({ 'lyndon-larouche': [] });
registerHooks({
  'lyndon-larouche': {
    powerMod(s, self, iid) {
      if (iid !== self) return 0;
      const pl = controllerOf2(s, self);
      if (!pl) return 0;
      let best = 0;
      for (const g of structureCards(s, pl)) {
        if (g === self || def(s, g).type !== 'Group') continue;
        if (alignments(s, g).includes('Government') || LAROUCHE_PARTIES.has(def(s, g).id)) best = Math.max(best, def(s, g).power ?? 0);
      }
      return best ? best - (def(s, self).power ?? 0) : 0;
    },
    goalAlignWeight: () => 0,
    onTurnStart(s, self) {
      const die = rollDie(s);
      const no = die <= 3;
      s.cards[self].data = { ...s.cards[self].data, larNoToken: no };
      log(s, `${cardName(s, self)} rolls ${die} for etheric vibrations from the dark side of Venus${no ? ': no Action token this turn' : ''}.`, controllerOf2(s, self));
    },
    noTokens(s, self, iid) {
      return iid === self && !!s.cards[self].data?.larNoToken;
    },
  },
});

// ==================================================================== Newt Gingrich
// Global: any attack (anyone's) to destroy a Liberal Group gets +3; his own direct such attacks get +5 more.

registerAbilities({ 'newt-gingrich': [] });
registerHooks({
  'newt-gingrich': {
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || ctx.type !== 'destroy' || !s.cards[ctx.target] || !alignments(s, ctx.target).includes('Liberal')) return 0;
      return 3 + (ctx.attacker === self ? 5 : 0);
    },
  },
});

// ==================================================================== Teddy Kennedy

registerAbilities({ 'teddy-kennedy': [] });
registerHooks({
  'teddy-kennedy': {
    forbidAttack(s, self, _attacker, target, type) {
      if ((type !== 'control' && type !== 'takeover') || !s.cards[target]) return null;
      if (controllerOf2(s, target) !== controllerOf2(s, self) || !alignments(s, target).includes('Liberal')) return null;
      return `${cardName(s, target)} is immune to Attacks to Control while Teddy Kennedy controls it.`;
    },
    attackMod(s, self, ctx, side) {
      if (side !== 'defense' || ctx.type !== 'destroy' || !s.cards[ctx.target]) return 0;
      if (controllerOf2(s, ctx.target) !== controllerOf2(s, self) || !alignments(s, ctx.target).includes('Liberal')) return 0;
      return 5;
    },
  },
});

// ==================================================================== Vladimir Zhirinovsky

registerAbilities({
  'vladimir-zhirinovsky': [
    { kind: 'attackBonus', on: 'control', target: { names: ['russia'] }, value: 10, scope: 'direct' },
    { kind: 'attackBonus', on: 'control', target: { attributes: ['Communist'] }, value: 5, scope: 'direct' },
  ],
});
registerHooks({ 'vladimir-zhirinovsky': {} });
