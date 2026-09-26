// Assassins pack, batch "assassins1": Society of Assassins (the pack's Illuminati) and two dozen
// Groups and Personalities. See docs/CARD_SCRIPTING.md ("Expansions") and docs/EXPANSIONS.md.
import type { Alignment, Contribution, GameState, Side } from '../types';
import { registerAbilities } from '../abilities';
import { registerChoice, registerHooks, HOOKS, type AbilityParams } from '../hooks';
import { PLOTS, registerPlots } from '../plotTypes';
import { def, cardName } from '../cards';
import { alignments, attributes, power } from '../stats';
import { structureCards, openArrows, puppets } from '../geometry';
import { fanaticUnited } from '../nwo';
import {
  controllerOf2, player, log, drawPlot, destroyGroup, discardCard, placeGroup, askChoice, copiedGoalProblem, declareCopiedGoal,
  checkPlot, playPlot, startAttack, attackCancelled, noteCostDiscard, shieldFromGoFish, validateAttack,
} from '../game';
import { shuffle, rollDie } from '../rng';
import { plotOptions } from '../moves';

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
    // "When one of your Fanatic Groups attacks or defends, you may treat its Fanatic alignment as that
    // of any other Fanatic Group": Fanatics are normally opposed to each other, and this lets the player
    // make them the same one. Asked when the attack is declared, of each Society player whose Fanatic
    // Group attacks or is attacked (Card FAQ: either player may make them the same; once they are the
    // same they stay so for that attack). A defender may also make its Fanatic the same as its master's,
    // so that they share it against an Attack to Control.
    onAttackStart(s, self, ctx) {
      const pl = controllerOf2(s, self);
      if (!pl || ctx.instant || !ctx.attacker || !s.cards[ctx.target] || fanaticUnited(s)) return;
      const fan = (g?: string) => !!g && s.cards[g]?.zone === 'structure' && alignments(s, g).includes('Fanatic');
      const mine = (g?: string) => !!g && s.cards[g]?.zone === 'structure' && s.cards[g].controller === pl;
      if (fan(ctx.attacker) && alignments(s, ctx.target).includes('Fanatic') && (mine(ctx.attacker) || mine(ctx.target))) {
        askChoice(s, pl, {
          key: 'soa-fanatic', source: self, min: 1, max: 1, data: { attack: ctx.id, role: mine(ctx.attacker) ? 'attack' : 'defense' },
          question: `${cardName(s, self)}: treat the Fanatic alignments of ${cardName(s, ctx.attacker)} and ${cardName(s, ctx.target)} as the same one in this attack?`,
          options: [{ id: 'same', label: 'Yes: the same Fanatic alignment' }, { id: 'opposite', label: 'No: opposed, as usual' }],
        });
      }
      const m = s.cards[ctx.target].master;
      if (ctx.type === 'control' && mine(ctx.target) && fan(ctx.target) && fan(m) && def(s, m!).type === 'Group' && !HOOKS[s.cards[ctx.target].cardId]?.fanaticSameAsMaster) {
        askChoice(s, pl, {
          key: 'soa-master', source: self, min: 1, max: 1, data: { attack: ctx.id },
          question: `${cardName(s, self)}: treat the Fanatic alignment of ${cardName(s, ctx.target)} as its master's (${cardName(s, m!)}), so they share it in this defense?`,
          options: [{ id: 'same', label: 'Yes: they share it' }, { id: 'opposite', label: 'No' }],
        });
      }
    },
  },
});
registerChoice('soa-fanatic', {
  resolve(s, pl, picked, data) {
    if (picked[0] !== 'same' || !s.attack || s.attack.id !== data.attack) return;
    s.attack.fanaticSame = true;
    log(s, `${player(s, pl).name} treats the two Fanatic alignments as the same one in this attack (Society of Assassins).`, pl);
  },
  // Sharing an alignment helps an Attack to Control and hinders an Attack to Destroy.
  ai: (s, _pl, _o, data) => [(s.attack?.type === 'control') === (data.role === 'attack') ? 'same' : 'opposite'],
});
registerChoice('soa-master', {
  resolve(s, pl, picked, data) {
    if (picked[0] !== 'same' || !s.attack || s.attack.id !== data.attack) return;
    s.attack.fanaticMasterSame = true;
    log(s, `${player(s, pl).name} makes ${cardName(s, s.attack.target)} share its master's Fanatic alignment (Society of Assassins).`, pl);
  },
  ai: () => ['same'],
});

// ==================================================================== Arms Dealers
// Spend its action to trade any number of your Plots for as many exposed Plots of one rival, in one go
// (`targets`: yours; `take`: his). The rival cannot refuse (Card FAQ: it is not a deal, so I Lied does
// not apply). You may hide any or all of the Plots you receive (all are hidden unless listed in
// `keepExposed`); exposed Plots you give stay exposed, and the rival learns the hidden ones he gets.

const isPlotCard = (s: GameState, c: string) => def(s, c).type === 'Plot';
registerAbilities({ 'arms-dealers': [] });
registerHooks({
  'arms-dealers': {
    actions: [{
      id: 'trade', label: "Trade Plots for as many of one rival's exposed Plots", timing: ['anytime'], usesToken: true,
      needs: { target: 'rivalHand', targetsOf: 'handPlot' },
      // One for one with each exposed Plot, or as many as possible at once (a person may send any set).
      options(s, pl, self) {
        if (s.cards[self].tokens < 1) return [];
        const mine = player(s, pl).hand.filter((c) => isPlotCard(s, c));
        const out: { params: AbilityParams; label: string }[] = [];
        for (const r of s.players) {
          if (r.id === pl || r.eliminated) continue;
          const ex = r.hand.filter((c) => isPlotCard(s, c) && s.cards[c].exposed);
          for (const e of ex) for (const m of mine) out.push({ params: { take: [e], targets: [m] }, label: `give ${cardName(s, m)} for ${r.name}'s ${cardName(s, e)}` });
          const n = Math.min(ex.length, mine.length);
          if (n > 1) out.push({ params: { take: ex.slice(0, n), targets: mine.slice(0, n) }, label: `give ${mine.slice(0, n).map((c) => cardName(s, c)).join(', ')} for all of ${r.name}'s exposed Plots` });
        }
        return out.slice(0, 40);
      },
      check(s, pl, _self, p) {
        const take = armsTake(p);
        if (!take.length) return "Choose one or more exposed Plots in one rival's hand.";
        const owner = s.players.find((x) => x.hand.includes(take[0]));
        if (!owner || owner.id === pl || owner.eliminated) return 'Choose Plots belonging to a rival.';
        if (new Set(take).size !== take.length) return 'Choose each of his Plots only once.';
        for (const t of take) {
          if (!s.cards[t] || !owner.hand.includes(t) || !isPlotCard(s, t)) return `Choose only Plots from ${owner.name}'s hand: the trade is with one rival.`;
          if (!s.cards[t].exposed) return `${owner.name}'s Plots must be exposed to be traded for.`;
        }
        const give = p.targets ?? [];
        if (give.length !== take.length || new Set(give).size !== give.length) return `Choose ${take.length} Plot${take.length === 1 ? '' : 's'} of your own to give in exchange.`;
        if (!give.every((c) => player(s, pl).hand.includes(c) && isPlotCard(s, c))) return 'Give Plots from your own hand.';
        if ((p.keepExposed ?? []).some((c) => !take.includes(c))) return 'Only Plots you receive can be left exposed.';
        return null;
      },
      apply(s, pl, self, p) {
        const take = armsTake(p);
        const give = p.targets!;
        const owner = s.players.find((x) => x.hand.includes(take[0]))!;
        const me = player(s, pl);
        me.hand = me.hand.filter((c) => !give.includes(c));
        owner.hand = owner.hand.filter((c) => !take.includes(c));
        for (const c of take) { me.hand.push(c); if (s.common) s.cards[c].owner = pl; s.cards[c].exposed = (p.keepExposed ?? []).includes(c); }
        for (const c of give) { owner.hand.push(c); if (s.common) s.cards[c].owner = owner.id; }
        // The rival now knows the hidden Plots he received; both received Plots from a rival (Go Fish).
        owner.known = [...new Set([...(owner.known ?? []), ...give])];
        shieldFromGoFish(s, pl);
        shieldFromGoFish(s, owner.id);
        log(s, `${cardName(s, self)}: ${me.name} trades ${give.length} Plot card${give.length === 1 ? '' : 's'} for ${owner.name}'s exposed ${take.map((c) => cardName(s, c)).join(', ')}.`, pl);
      },
    }],
  },
});
/** The rival's Plots taken by Arms Dealers (`take`, or the single `target`). */
const armsTake = (p: AbilityParams) => p.take ?? (p.target ? [p.target] : []);

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
// An agents card played by its controller gets +5 more (attack or defense, as the agents card goes). If
// anyone else plays one, its controller may give them the +5 too, at no cost: he is asked. No effect on
// spare Illuminati cards used as agents (they are not Group cards).

registerAbilities({
  'convenience-stores': [
    { kind: 'selfDefense', value: 10, on: 'destroy' },
  ],
});
const isAgentsEntry = (s: GameState, b: Contribution) => !!b.plot && !!s.cards[b.plot] && def(s, b.plot).type === 'Group' && b.label.startsWith('Agents');
registerHooks({
  'convenience-stores': {
    attackMod(s, self, ctx, side) {
      const owner = controllerOf2(s, self);
      const list = side === 'attack' ? ctx.attackBonus : ctx.defenseBonus;
      const granted = (s.cards[self].data?.grantedAgents as string[] | undefined) ?? [];
      return list.some((b) => isAgentsEntry(s, b) && (b.player === owner || granted.includes(b.plot!))) ? 5 : 0;
    },
    onAgents(s, self, ctx, entry, as) {
      const owner = controllerOf2(s, self);
      if (!owner || entry.player === owner || !isAgentsEntry(s, entry)) return;
      askChoice(s, owner, {
        key: 'convenience-agents', source: self, min: 1, max: 1,
        data: { stores: self, agents: entry.plot, attack: ctx.id, helps: as === 'aid' ? ctx.attackerPlayer : ctx.targetPlayer },
        question: `${player(s, entry.player).name} plays an agents card (${cardName(s, entry.plot!)}). Give them the +5 of ${cardName(s, self)}, at no cost?`,
        options: [{ id: 'give', label: 'Give the +5' }, { id: 'keep', label: 'No' }],
      });
    },
  },
});
registerChoice('convenience-agents', {
  resolve(s, pl, picked, data) {
    const self = data.stores as string;
    if (picked[0] !== 'give' || !s.cards[self] || s.attack?.id !== data.attack) return;
    s.cards[self].data = { ...s.cards[self].data, grantedAgents: [...((s.cards[self].data?.grantedAgents as string[] | undefined) ?? []), data.agents as string] };
    log(s, `${player(s, pl).name} gives the agents card the +5 of ${cardName(s, self)}.`, pl);
  },
  // The computer gives it only when the agents card helps its own side.
  ai: (_s, pl, _o, data) => [data.helps === pl ? 'give' : 'keep'],
});

// ==================================================================== Copy Shops
// Spend its action, and discard a Plot from hand, to copy a rival's exposed Plot and use the copy at once
// (`copyPlay` holds the copy's own play: its target, mode, payment …), paying its normal cost. The copy
// is a card of its own that leaves the game as soon as it is used up or nullified (game.ts vanishCopy):
// nobody can keep, save or scavenge it; a copy that stays linked stays linked like the original would.
// A copied Goal counts only if its player can win with it at once: it is declared for victory then and
// there (game.ts declareCopiedGoal), and does not count otherwise. Illuminati cards cannot be copied
// (Card FAQ: they cannot be played like a Plot). The rival's own card is untouched.

function tempCopy(s: GameState, pl: string, src: string): string {
  const cardId = s.cards[src].cardId;
  const iid = `${pl}-copyshop-${Object.keys(s.cards).length}`;
  s.cards[iid] = { iid, cardId, owner: pl, zone: 'hand', tokens: 0, mods: [], data: { copyOf: src } };
  player(s, pl).hand.push(iid);
  return iid;
}

registerAbilities({ 'copy-shops': [] });
registerHooks({
  'copy-shops': {
    actions: [{
      id: 'copy', label: "Copy a rival's exposed Plot and use it at once", timing: ['anytime'], usesToken: true,
      needs: { target: 'rivalHand', targetsOf: 'handPlot' },
      // Each exposed rival Plot, paid for with the first Plot in hand, used in each legal way.
      options(s, pl, self) {
        if (s.cards[self].tokens < 1) return [];
        const give = player(s, pl).hand.find((c) => def(s, c).type === 'Plot');
        if (!give) return [];
        const out: { params: AbilityParams; label: string }[] = [];
        for (const r of s.players) {
          if (r.id === pl || r.eliminated) continue;
          for (const t of r.hand.filter((c) => def(s, c).type === 'Plot' && s.cards[c].exposed)) {
            if (def(s, t).subtype === 'Goal') { out.push({ params: { target: t, targets: [give] }, label: `copy ${cardName(s, t)} and win with it` }); continue; }
            if (!PLOTS[s.cards[t].cardId]) continue;
            const probe = structuredClone(s);
            player(probe, pl).hand = player(probe, pl).hand.filter((c) => c !== give);
            const temp = tempCopy(probe, pl, t);
            for (const o of plotOptions(probe, pl, temp).slice(0, 5)) {
              if (o.action.type !== 'playPlot') continue;
              const { card: _card, ...copyPlay } = o.action.play;
              out.push({ params: { target: t, targets: [give], copyPlay }, label: `copy ${cardName(s, t)}: ${o.label}` });
            }
          }
        }
        return out;
      },
      // Its check() clones the whole game state to test the copy's legality; too expensive to weigh in
      // computer look-ahead for a rare, situational ability.
      ai: 'never',
      check(s, pl, _self, p) {
        const t = p.target;
        if (!t || !s.cards[t] || def(s, t).type !== 'Plot') return "Choose an exposed Plot in a rival's hand.";
        const owner = s.players.find((x) => x.hand.includes(t));
        if (!owner || owner.id === pl) return "Choose a Plot belonging to a rival.";
        if (!s.cards[t].exposed) return 'That Plot must be exposed.';
        const give = p.targets ?? [];
        if (give.length !== 1 || !player(s, pl).hand.includes(give[0]) || def(s, give[0]).type !== 'Plot') {
          return 'Discard one Plot card from your hand to pay for the copy.';
        }
        if (def(s, t).subtype === 'Goal') return copiedGoalProblem(s, pl, s.cards[t].cardId);
        if (!PLOTS[s.cards[t].cardId]) return `${cardName(s, t)} is not available in this version yet.`;
        const probe = structuredClone(s);
        player(probe, pl).hand = player(probe, pl).hand.filter((c) => c !== give[0]);
        probe.cards[give[0]].zone = 'discard';
        const temp = tempCopy(probe, pl, t);
        return checkPlot(probe, pl, { card: temp, ...(p.copyPlay ?? {}) });
      },
      apply(s, pl, self, p) {
        const t = p.target!;
        const give = p.targets![0];
        discardCard(s, give);
        noteCostDiscard(s, pl, [{ kind: 'plot', place: 'hand', cards: [give] }]);
        if (def(s, t).subtype === 'Goal') {
          const why = copiedGoalProblem(s, pl, s.cards[t].cardId);
          if (why) { log(s, `${cardName(s, self)}: the copy of ${cardName(s, t)} does not count (${why})`, pl); return; }
          log(s, `${cardName(s, self)}: ${player(s, pl).name} copies ${cardName(s, t)}.`, pl);
          declareCopiedGoal(s, pl, s.cards[t].cardId);
          return;
        }
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
// Only a Personality may control it (as the attacker capturing it, or its master after a takeover or a
// move: Card FAQ, if there is no legal space it cannot be moved), on any side of its master's card, even
// one with no control arrow; no Personality may control two. Any number may be in play, and it is never
// an agents card. Its alignments are always its master's plus Fanatic, that Fanatic being the same as
// its master's if he is Fanatic too; in a hand it has none (Card FAQ), and once destroyed it keeps those
// it had. The master gets +2 Power and triple Resistance.

const dittoMaster = (s: GameState, self: string) => {
  const c = s.cards[self];
  return c.zone === 'structure' && c.master && def(s, c.master).subtype === 'Personality' ? c.master : undefined;
};
registerAbilities({ 'dittoheads': [] });
registerHooks({
  'dittoheads': {
    multipleCopies: true,
    anySideMaster: true,
    anySideOnMove: true,
    neverAgents: true,
    fanaticSameAsMaster: true,
    masterRule(s, iid, master) {
      if (def(s, master).subtype !== 'Personality') return 'Dittoheads may only be controlled by a Personality.';
      if (puppets(s, master).some((p) => p !== iid && s.cards[p].cardId === 'dittoheads')) return `${cardName(s, master)} already controls Dittoheads: no Personality may control more than one.`;
      return null;
    },
    baseAlignments(s, iid) {
      const m = dittoMaster(s, iid);
      if (!m) return [];
      const al = alignments(s, m);
      return al.includes('Fanatic') ? al : [...al, 'Fanatic'];
    },
    powerMod: (s, self, iid) => (iid === dittoMaster(s, self) ? 2 : 0),
    resistanceMul: (s, self, iid) => (iid === dittoMaster(s, self) ? 3 : 1),
    onDestroy(s, self, victim) {
      if (victim !== self) return;
      s.cards[self].data = { ...s.cards[self].data, freezeAlignments: alignments(s, self) };
    },
  },
});

// ==================================================================== Drug Companies
// Its special attack is rolled exactly as an Attack to Control (alignments, aid, cancels) with +10, on any
// Group in play, but succeeding only strips the alignment its player chose, for good (a sticky note in
// the paper game): no open control arrow is needed and nothing is captured. The attack becomes illegal if
// the target loses that alignment meanwhile (Card FAQ).

registerAbilities({ 'drug-companies': [] });
registerHooks({
  'drug-companies': {
    // Its own +10 bonus applies only to this special attack, never a normal Attack to Control.
    attackMod(s, self, ctx, side) {
      return side === 'attack' && ctx.attacker === self && ctx.type === 'control' && ctx.stripAlignment ? 10 : 0;
    },
    actions: [{
      id: 'strip-alignment', label: 'Attack to strip an alignment', timing: ['main'], usesToken: false,
      needs: { target: 'group', alignment: true },
      check(s, pl, self, p) {
        const t = p.target;
        if (!t || !s.cards[t] || def(s, t).type !== 'Group' || s.cards[t].zone !== 'structure') return 'Choose a Group in play.';
        if (!p.alignment || !alignments(s, t).includes(p.alignment as Alignment)) return 'Choose an alignment that Group currently has.';
        return validateAttack(s, pl, { type: 'attack', attackType: 'control', attacker: self, target: t }, { strip: true });
      },
      apply(s, pl, self, p) {
        startAttack(s, pl, { type: 'attack', attackType: 'control', attacker: self, target: p.target! }, { strip: true, stripAlignment: p.alignment as Alignment });
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
// As a Group: any Science Group may aid its side of an attack it takes part in, whatever its alignments.
// Or it may be played from its owner's hand like a Plot, linked to a Group in play (not one attacked from
// a hand: Card FAQ), which gains the Science attribute for good; the card is then a Plot for all
// purposes (it can be cancelled, and it is discarded if its Group leaves play). Not while a Nutrition
// Nazis is in play as a Group, and no Nutrition Nazis may come into play as a Group while one is linked
// as a Plot (Card FAQ). RULING: "this may only happen once per game" is read literally: once in the whole
// game, whoever plays it (a second copy cannot be played as a Plot either).

const NN = 'nutrition-nazis';
const nnPlayedAsPlot = (s: GameState) => s.players.some((p) => p.flags?.nutritionNazisPlot);
registerAbilities({ [NN]: [] });
registerPlots({
  [NN]: {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'anyGroup' },
    check(s, _pl, play) {
      if (nnPlayedAsPlot(s)) return 'The Nutrition Nazis may be played as a Plot only once per game.';
      if (Object.values(s.cards).some((c) => c.cardId === NN && c.zone === 'structure')) return 'Not while the Nutrition Nazis are in play as a Group.';
      const t = play.target;
      if (!t || !s.cards[t] || s.cards[t].zone !== 'structure' || def(s, t).type !== 'Group') return 'Choose a Group in play to link it to.';
      return null;
    },
    apply(s, pl, play, ctx) {
      const p = player(s, pl);
      p.flags = { ...p.flags, nutritionNazisPlot: true };
      if (ctx) linkNN(s, pl, play.card, play.target!);
    },
    resolve(s, pl, play) { if (s.cards[play.target!]?.zone === 'structure') linkNN(s, pl, play.card, play.target!); },
    linkLegal: (s, _plot, g) => (s.cards[g]?.zone === 'structure' ? 'ok' : 'discard'),
  },
});
function linkNN(s: GameState, pl: string, card: string, group: string) {
  s.cards[card].linkedTo = group;
  log(s, `${player(s, pl).name} plays the Nutrition Nazis as a Plot: ${cardName(s, group)} gains the Science attribute.`, pl);
}
registerHooks({
  [NN]: {
    mayJoin(s, self, ctx, group, as) {
      if (s.cards[self].zone !== 'structure' || !attributes(s, group).includes('Science')) return false;
      const onAttack = ctx.attacker === self || ctx.aid.some((a) => a.iid === self);
      const onDefense = ctx.target === self || ctx.oppose.some((o) => o.iid === self);
      return (as === 'aid' && onAttack) || (as === 'oppose' && onDefense);
    },
    // Played as a Plot: the linked Group is Science.
    attributeMod(s, self, iid, current) {
      const c = s.cards[self];
      return c.zone === 'table' && c.linkedTo === iid && !current.includes('Science') ? [...current, 'Science'] : current;
    },
    forbidAttack(s, self, _attacker, target, type) {
      if (s.cards[self].zone !== 'table' || (type !== 'control' && type !== 'takeover') || s.cards[target]?.cardId !== NN) return null;
      return 'The Nutrition Nazis are in play as a Plot: they cannot come into play as a Group until that Plot is gone.';
    },
  },
});

// ==================================================================== Pale People In Black
// When they take part in an Attack to Control (leading it or aiding it), the effects of opposed
// alignments are ignored: the attack loses no Power for alignments opposed between its leader and the
// target (game.ts attackStrength reads `replacesAlignmentPenalty` from every Group on the attacking side).
// They cannot be destroyed.

registerAbilities({
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
// While you control them, no rival may take over a Science or Green Group automatically without your
// permission: when one tries, the engine asks you to give or refuse it (game.ts doTakeover). A refused
// Group cannot be taken over automatically for the rest of that turn.

registerAbilities({ 'science-alarmists': [] });
registerHooks({
  'science-alarmists': {
    takeoverPermission(s, self, card, pl) {
      if (pl === controllerOf2(s, self) || !s.cards[card] || def(s, card).type !== 'Group') return false;
      return attributes(s, card).includes('Science') || attributes(s, card).includes('Green');
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
// Spend its action, during any attack (Instant ones included), to discard any number of Group cards from
// hand: their printed Power is added to the attack or to the defense, whatever their alignments and
// attributes. Those discards pay for its ability (Go, Lemmings, Go! may answer them). With Hitler's Brain
// linked to it, "they" (the Thule Group and Hitler's Brain) cannot be captured or destroyed.

const hitlersBrainOn = (s: GameState, self: string) => Object.values(s.cards).find((c) => c.cardId === 'hitler-s-brain' && c.zone === 'resources' && c.linkedTo === self)?.iid;
registerAbilities({ 'the-thule-group': [] });
registerHooks({
  'the-thule-group': {
    actions: [{
      id: 'sacrifice', label: 'Discard Groups from hand for Power or Resistance', timing: ['attack'], usesToken: true,
      needs: { target: 'handGroup', targetsOf: 'handGroup', modes: ['attack', 'defense'] },
      options(s, pl, self) {
        if (!s.attack || s.cards[self].tokens < 1) return [];
        const groups = player(s, pl).hand.filter((c) => def(s, c).type === 'Group');
        const sets = [...groups.map((g) => [g]), ...(groups.length > 1 ? [groups] : [])];
        return (['attack', 'defense'] as const).flatMap((mode) => sets.map((set) => ({
          params: { mode, targets: set },
          label: `discard ${set.map((g) => cardName(s, g)).join(', ')}: +${set.reduce((n, g) => n + (def(s, g).power ?? 0), 0)} to the ${mode}`,
        })));
      },
      check(s, pl, _self, p, ctx) {
        if (!ctx) return 'Only during an attack.';
        if (p.mode !== 'attack' && p.mode !== 'defense') return 'Choose attack or defense.';
        const give = p.targets ?? [];
        if (!give.length || new Set(give).size !== give.length || !give.every((c) => player(s, pl).hand.includes(c) && def(s, c).type === 'Group')) {
          return 'Choose one or more Group cards from your hand to discard.';
        }
        return null;
      },
      apply(s, pl, self, p, ctx) {
        const total = p.targets!.reduce((n, c) => n + (def(s, c).power ?? 0), 0);
        for (const c of [...p.targets!]) discardCard(s, c);
        noteCostDiscard(s, pl, [{ kind: 'group', place: 'hand', cards: p.targets! }]);
        const entry = { player: pl, plot: `ability:${self}:sacrifice:${s.version}`, amount: total, label: `${cardName(s, self)} (discarded Groups)` };
        (p.mode === 'attack' ? ctx!.attackBonus : ctx!.defenseBonus).push(entry);
      },
    }],
    preventDestroy(s, self, target) {
      const brain = hitlersBrainOn(s, self);
      return !!brain && (target === self || target === brain);
    },
    forbidAttack(s, self, _attacker, target, type) {
      if ((type !== 'control' && type !== 'takeover') || target !== self) return null;
      return hitlersBrainOn(s, self) ? `${cardName(s, self)} cannot be captured while Hitler's Brain is linked to it.` : null;
    },
  },
});

// ==================================================================== General Disorder
// Spend his action: +10 to a Disaster, which can then only Devastate. Killed or destroyed, he counts as
// destroyed only until the end of the turn: then, unless someone has won, he comes back on an open arrow
// of his former master (his controller picks which), or to hand if none is open, keeping every linked
// Plot (set aside meanwhile: game.ts keepsLinkedPlots) and every change, good or bad. The destruction no
// longer counts for anyone once he is back. His puppets go to hand when he is destroyed (the base rule).
// A Group that removes its victims from the game (the Men in Black) destroys him for good (Card FAQ).

const gdGone = (s: GameState, self: string) => !!s.cards[self].data?.removedFromGame || !!s.cards[self].data?.neverReturns;
registerAbilities({ 'general-disorder': [] });
registerHooks({
  'general-disorder': {
    keepsLinkedPlots: true,
    actions: [{
      id: 'disorder', label: 'Give +10 to a Disaster (Devastate only)', timing: ['attack'], usesToken: true,
      check(s, pl, _self, _p, ctx) {
        if (!ctx?.disaster) return 'Only while a Disaster is in progress.';
        return null;
      },
      apply(s, pl, self, _p, ctx) {
        ctx!.attackBonus.push({ player: pl, plot: `ability:${self}:disorder:${s.version}`, amount: 10, label: cardName(s, self) });
        ctx!.disaster = { ...ctx!.disaster!, devastateOnly: true };
      },
    }],
    onDestroy(s, self, victim) {
      if (victim !== self) return;
      s.cards[self].data = {
        ...s.cards[self].data,
        reviveAtEndOfTurn: s.turn,
        gdMaster: s.cards[self].master,
        gdController: s.cards[self].controller,
        gdMods: s.cards[self].mods,
      };
    },
    delayedRevive(s, self) {
      const data = (s.cards[self].data ?? {}) as { gdMaster?: string; gdController?: string; gdMods?: typeof s.cards[string]['mods'] };
      s.cards[self].data = { ...s.cards[self].data, reviveAtEndOfTurn: undefined };
      const kept = Object.values(s.cards).filter((c) => c.data?.keptFor === self).map((c) => c.iid);
      if (gdGone(s, self)) { for (const k of kept) releaseKept(s, k); return; }
      const ownerId = data.gdController ?? s.cards[self].owner;
      for (const x of s.players) x.destroyedCredit = x.destroyedCredit.filter((d) => d !== self);
      const master = data.gdMaster;
      const open = master && s.cards[master]?.zone === 'structure' && s.cards[master].controller === ownerId ? openArrows(s, master) : [];
      if (open.length > 1 && !player(s, ownerId).isAI) {
        askChoice(s, ownerId, {
          key: 'general-disorder-arrow', source: self, min: 1, max: 1, data: { gd: self, master, mods: data.gdMods ?? [] },
          question: `${cardName(s, self)} comes back to life: on which arrow of ${cardName(s, master!)}?`,
          options: open.map((side) => ({ id: side, label: `${side.toLowerCase()} arrow` })),
        });
        return;
      }
      reviveGeneral(s, self, ownerId, master, open[0], data.gdMods ?? []);
    },
  },
});
function releaseKept(s: GameState, k: string) {
  const c = s.cards[k];
  Object.assign(c, { zone: 'table', setAside: undefined, data: { ...c.data, keptFor: undefined } });
  discardCard(s, k);
}
function reviveGeneral(s: GameState, self: string, ownerId: string, master: string | undefined, side: Side | undefined, mods: typeof s.cards[string]['mods']) {
  const kept = Object.values(s.cards).filter((c) => c.data?.keptFor === self).map((c) => c.iid);
  s.cards[self].killed = false;
  if (master && side && s.cards[master]?.zone === 'structure' && openArrows(s, master).includes(side)) {
    placeGroup(s, self, s.cards[master].controller!, master, side);
    s.cards[self].tokens = 0;
    s.cards[self].mods = mods;
    for (const k of kept) Object.assign(s.cards[k], { zone: 'table', setAside: undefined, linkedTo: self, data: { ...s.cards[k].data, keptFor: undefined } });
    log(s, `${cardName(s, self)} returns from the dead onto ${cardName(s, master)}${kept.length ? `, with ${kept.map((k) => cardName(s, k)).join(', ')}` : ''}.`, s.cards[master].controller);
    return;
  }
  // Back to hand: a card in a hand cannot keep linked Plots.
  for (const k of kept) releaseKept(s, k);
  s.cards[self].zone = 'hand';
  s.cards[self].mods = mods;
  player(s, ownerId).hand.push(self);
  log(s, `${cardName(s, self)} returns from the dead to ${player(s, ownerId).name}'s hand.`, ownerId);
}
registerChoice('general-disorder-arrow', {
  resolve(s, pl, picked, data) {
    const self = data.gd as string;
    if (s.cards[self]?.zone !== 'destroyed') return;
    reviveGeneral(s, self, pl, data.master as string, picked[0] as Side, data.mods as typeof s.cards[string]['mods']);
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
