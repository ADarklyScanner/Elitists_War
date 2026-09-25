// Encoded by the card-content pass. See docs/CARD_SCRIPTING.md.
// Goals, New World Orders and assorted Plots (batch 2).
import type { Alignment, AttackCtx, GameState, PlotEffect, PlotPlay } from '../types';
import type { PlotHandler } from '../plotTypes';
import { registerGoalProgress, registerGoals, registerPlots } from '../plotTypes';
import { HOOKS, registerChoice, registerHooks } from '../hooks';
import { def } from '../cards';
import { matches } from '../abilities';
import { alignments, attributes, power } from '../stats';
import { structureCards } from '../geometry';
import { nwoColor } from '../nwo';
import {
  attackCancelled, destroyGroup, discardCard, drawPlot, giveToken, goalAlignWeight, goalCount, goalNeeded, isCancelled,
  livePlayers, log, player, startInstantAttack, tokenBarred,
  disasterTarget, askChoice, revealTo,
} from '../game';
import { exposableHand } from '../game';

// ---------------------------------------------------------------- helpers (copied from plots.ts)

const own = (s: GameState, pl: string, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure' && s.cards[iid].controller === pl;
const isGroup = (s: GameState, iid?: string) => !!iid && def(s, iid).type === 'Group';
const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';
const hasAlign = (s: GameState, iid: string, a: Alignment) => alignments(s, iid).includes(a);
const hasAttr = (s: GameState, iid: string, a: string) => attributes(s, iid).includes(a);

function spend(s: GameState, pl: string, groups: string[] = []): string | null {
  for (const g of groups) if (!own(s, pl, g) || s.cards[g].tokens < 1) return 'Every paying Group must be yours and have an Action token.';
  if (new Set(groups).size !== groups.length) return 'A Group can only pay once.';
  return null;
}
function pay(s: GameState, groups: string[] = []) { for (const g of groups) s.cards[g].tokens--; }
const totalPower = (s: GameState, groups: string[] = []) => groups.reduce((n, g) => n + power(s, g), 0);

/** Do the effect at once inside an attack, or after the counter window otherwise. */
function effectNow(fn: (s: GameState, pl: string, play: PlotPlay) => void): Pick<PlotHandler, 'apply' | 'resolve'> {
  return {
    apply: (s, pl, play, ctx) => { if (ctx) fn(s, pl, play); },
    resolve: fn,
  };
}

/** Discard the top card of a player's Plot or Group deck. */
function discardTop(s: GameState, pl: string, deck: 'plotDeck' | 'groupDeck') {
  const p = player(s, pl);
  const top = p[deck].shift();
  if (top) { s.cards[top].zone = 'hand'; p.hand.push(top); discardCard(s, top); }
}

function nwo(): PlotHandler {
  const place = (s: GameState, _pl: string, play: PlotPlay) => {
    const color = nwoColor(s.cards[play.card].cardId);
    const prev = s.nwo[color];
    if (prev && prev !== play.card) { discardCard(s, prev); log(s, `${def(s, prev).name} is replaced.`); }
    s.nwo[color] = play.card;
    s.cards[play.card].linkedTo = 'nwo';
  };
  return { timing: ['nwo'], check: () => null, ...effectNow(place) };
}

/** Is this NWO card currently in play? */
const nwoActive = (s: GameState, cardId: string) =>
  Object.values(s.nwo).some((iid) => !!iid && s.cards[iid]?.cardId === cardId && s.cards[iid].zone === 'table');

// ---------------------------------------------------------------- Goals

/** Groups (not the Illuminati) that count for victory: not a Devastated Place or below one. */
function countedGroups(s: GameState, pl: string): string[] {
  return structureCards(s, pl).filter((iid) => {
    let c = s.cards[iid];
    for (;;) {
      if (c.devastated) return false;
      if (!c.master) return true;
      c = s.cards[c.master];
    }
  });
}

/** "Counts as two groups" Goals: the Basic Goal with an extra doubling rule. */
function doubleGoal(pred: (s: GameState, iid: string) => boolean, what: string) {
  return (s: GameState, pl: string) =>
    goalCount(s, pl, (iid) => pred(s, iid)) >= goalNeeded(s, pl) ? `controls enough Groups, counting ${what} twice` : null;
}

const COMBOS: [number, number][] = [[2, 6], [3, 5], [4, 4], [5, 3], [6, 1]];

/** "Destroy N [A] groups and control M [B] groups" Goals. Destroyed Groups are judged by their printed alignments. */
function destroyAndControl(destroyed: Alignment, controlled: Alignment) {
  return (s: GameState, pl: string) => {
    const d = player(s, pl).destroyedCredit.filter((iid) => (def(s, iid).alignments ?? []).includes(destroyed)).reduce((n, iid) => n + goalAlignWeight(s, iid, destroyed), 0);
    const c = countedGroups(s, pl).filter((iid) => isGroup(s, iid) && hasAlign(s, iid, controlled)).reduce((n, iid) => n + goalAlignWeight(s, iid, controlled), 0);
    const hit = COMBOS.find(([nd, nc]) => d >= nd && c >= nc);
    return hit ? `destroyed ${d} ${destroyed} Groups and controls ${c} ${controlled} Groups` : null;
  };
}

const VIOLENT_CRIMINAL = (s: GameState, i: string) => hasAlign(s, i, 'Violent') && hasAlign(s, i, 'Criminal');
const WEIRD_3 = (s: GameState, i: string) => hasAlign(s, i, 'Weird') && power(s, i, { goals: true }) >= 3;
const CORPORATE_4 = (s: GameState, i: string) => hasAlign(s, i, 'Corporate') && power(s, i, { goals: true }) >= 4;
const DESTROY_CONTROL: Record<string, [Alignment, Alignment]> = {
  'kill-for-peace': ['Violent', 'Peaceful'],
  'let-them-eat-cake': ['Liberal', 'Conservative'],
  'power-to-the-people': ['Conservative', 'Liberal'],
  'the-hand-of-madness': ['Peaceful', 'Violent'],
  'up-against-the-wall': ['Government', 'Violent'],
};
const totalGoalPower = (s: GameState, pl: string) => countedGroups(s, pl).reduce((n, iid) => n + power(s, iid, { goals: true }), 0);

registerGoals({
  'criminal-overlords': doubleGoal(VIOLENT_CRIMINAL, 'Violent Criminal Groups'),
  'hail-eris': doubleGoal(WEIRD_3, 'Weird Groups of Power 3+'),
  'the-corporate-masters': doubleGoal(CORPORATE_4, 'Corporate Groups of Power 4+'),
  ...Object.fromEntries(Object.entries(DESTROY_CONTROL).map(([id, [d, c]]) => [id, destroyAndControl(d, c)])),
  'power-for-its-own-sake': (s, pl) => {
    const total = totalGoalPower(s, pl);
    return total >= 50 ? `controls ${total} Power` : null;
  },
});

// How far a holder is toward each Goal (for computer players).
const doubleProgress = (pred: (s: GameState, iid: string) => boolean) => (s: GameState, pl: string) =>
  Math.min(1, goalCount(s, pl, (iid) => pred(s, iid)) / Math.max(1, goalNeeded(s, pl)));
function destroyControlProgress(destroyed: Alignment, controlled: Alignment) {
  return (s: GameState, pl: string) => {
    const d = player(s, pl).destroyedCredit.filter((iid) => (def(s, iid).alignments ?? []).includes(destroyed)).reduce((n, iid) => n + goalAlignWeight(s, iid, destroyed), 0);
    const c = countedGroups(s, pl).filter((iid) => isGroup(s, iid) && hasAlign(s, iid, controlled)).reduce((n, iid) => n + goalAlignWeight(s, iid, controlled), 0);
    return Math.max(...COMBOS.map(([nd, nc]) => (Math.min(d, nd) + Math.min(c, nc)) / (nd + nc)));
  };
}
registerGoalProgress({
  'criminal-overlords': doubleProgress(VIOLENT_CRIMINAL),
  'hail-eris': doubleProgress(WEIRD_3),
  'the-corporate-masters': doubleProgress(CORPORATE_4),
  ...Object.fromEntries(Object.entries(DESTROY_CONTROL).map(([id, [d, c]]) => [id, destroyControlProgress(d, c)])),
  'power-for-its-own-sake': (s, pl) => Math.min(1, totalGoalPower(s, pl) / 50),
});

// ---------------------------------------------------------------- NWO constant effects

registerHooks({
  'peace-in-our-time': {
    // NWO_EFFECTS already gives Peaceful Groups +1 Power and +3 Resistance.
    powerMod: (s, _self, iid) => (def(s, iid).type === 'Group' && (hasAlign(s, iid, 'Violent') || hasAlign(s, iid, 'Criminal')) ? -1 : 0),
    // The +3 Resistance is only for Groups in a Power Structure (not Groups attacked from hand).
    resistanceMod: (s, _self, iid) => (def(s, iid).type === 'Group' && s.cards[iid].zone !== 'structure' && hasAlign(s, iid, 'Peaceful') ? -3 : 0),
    // +3 instead of +1 when defending against an attempt to destroy.
    attackMod: (s, _self, ctx, side) => (side === 'defense' && ctx.type === 'destroy' && isGroup(s, ctx.target) && hasAlign(s, ctx.target, 'Peaceful') ? 2 : 0),
  },
  'tax-reform': {
    // +10 to every defense of the I.R.S.
    attackMod: (s, _self, ctx, side) => (side === 'defense' && s.cards[ctx.target]?.cardId === 'i-r-s' ? 10 : 0),
  },
  'world-war-three': {
    attackMod(s, _self, ctx, side) {
      if (side !== 'attack' || !wwiiiAttack(s, ctx)) return 0;
      return 2 * power(s, ctx.attacker!); // the attacking Nation's Power is tripled
    },
    onAttackEnd(s, _self, ctx) {
      if (!wwiiiAttack(s, ctx) || attackCancelled(ctx)) return;
      const att = ctx.attacker!;
      if (ctx.result === 'success') {
        drawPlot(s, player(s, ctx.attackerPlayer));
        if (s.cards[att].zone === 'structure' && !tokenBarred(s, att)) s.cards[att].tokens++;
        log(s, `World War Three: ${def(s, att).name} wins — a Plot card and another Action token.`, ctx.attackerPlayer);
      } else if (s.cards[att].zone === 'structure') {
        log(s, `World War Three: ${def(s, att).name} loses the war and is destroyed.`, ctx.targetPlayer);
        destroyGroup(s, att, ctx.targetPlayer ?? ctx.attackerPlayer);
      }
    },
  },
});

function wwiiiAttack(s: GameState, ctx: AttackCtx): boolean {
  return !ctx.instant && ctx.type === 'destroy' && !!ctx.attacker && hasAttr(s, ctx.attacker, 'Nation') && hasAttr(s, ctx.target, 'Nation');
}

// Tax Reform's tax on every rival is part of the I.R.S. ability (groups0.ts).

// ---------------------------------------------------------------- Plot hooks

registerHooks({
  bodyguard: {
    attackMod: (s, self, ctx, side) => (side === 'defense' && ctx.type === 'destroy' && ctx.target === s.cards[self].linkedTo ? 6 : 0),
  },
  'bimbo-at-eleven': {
    // Linked to its attack only, so that it can mark the victim when the attack ends.
    onAttackEnd(s, self, ctx) {
      if (s.cards[self].linkedTo !== `attack:${ctx.id}`) return;
      if (ctx.result === 'success' && s.cards[ctx.target].zone === 'destroyed') {
        s.cards[ctx.target].data = { ...s.cards[ctx.target].data, neverReturns: true };
        log(s, `${def(s, ctx.target).name} is gone for good.`);
      }
      discardCard(s, self);
    },
  },
});

/** Personalities in this set that are not male. Media Sensation's gender is unspecified. */
const NOT_MALE = new Set(['hillary-clinton', 'imelda-marcos', 'margaret-thatcher', 'nancy-reagan', 'princess-di', 'media-sensation']);

/** Mods on a Group that a Plot card (not a New World Order) put there, grouped by source. */
function plotChanges(s: GameState, iid: string): string[] {
  const kinds = ['power', 'resistance', 'setPower', 'setResistance', 'mulPower', 'mulResistance', 'addAlign', 'removeAlign'];
  const out = new Set<string>();
  for (const m of s.cards[iid].mods) {
    const src = s.cards[m.source];
    if (!src || !kinds.includes(m.kind)) continue;
    const d = def(s, m.source);
    if (d.type === 'Plot' && d.subtype !== 'NWO') out.add(m.source);
  }
  return [...out];
}

/** Plots just played that can be countered now (the counter window, or the current attack). */
function justPlayed(s: GameState, ctx?: AttackCtx) {
  return s.window?.kind === 'plot' ? s.window.plays ?? [] : ctx?.plays ?? [];
}

const ANGST_HELPERS = ['psychiatrists', 'intellectuals', 'orbital-mind-control-lasers'];
const MONSTER_PREY = ['robot-sea-monsters', 'nuclear-power-companies'];

// ---------------------------------------------------------------- the cards

registerPlots({
  // Goal cards only register their condition (registerGoals above). Registering a PlotHandler
  // for them would put them in random decks, and the computer player cannot yet discard down to
  // the Goal-card limit (src/ai/ai.ts only discards Plots over the Plot limit).
  // Held in hand: the engine raises the Goal limit to two while it is held (goalLimit).
  'alternate-goals': {
    timing: [],
    check: () => 'Keep Alternate Goals in your hand: while you hold it you may hold two Goals.',
    apply: () => undefined,
  },

  // New World Orders
  'peace-in-our-time': nwo(),
  'tax-reform': nwo(),
  'world-war-three': nwo(),

  '18-1-2-minute-gap': {
    timing: ['counter'],
    needs: { target: 'plot' },
    check(s, pl, play, ctx) {
      const pool = justPlayed(s, ctx);
      const pp = pool.find((p) => p.iid === play.target);
      if (!pp || play.target === play.card || !s.cards[pp.iid] || def(s, pp.iid).type !== 'Plot' || s.cards[pp.iid].zone !== 'table' || isCancelled(pool, pp.iid)) return 'Choose a Plot card that was just played.';
      if (pp.player === pl) return 'Only a Plot another player just played.';
      const p = player(s, pl);
      if (s.cards[p.illuminati].tokens < 1) return 'Your Illuminati must have at least one Action token to spend.';
      if (!p.plotDeck.length || !p.groupDeck.length) return 'You must discard the top card of both your Plot deck and your Group deck.';
      return null;
    },
    apply(s, pl, play): PlotEffect {
      const p = player(s, pl);
      s.cards[p.illuminati].tokens = 0;
      discardTop(s, pl, 'plotDeck');
      discardTop(s, pl, 'groupDeck');
      const t = s.cards[play.target!];
      Object.assign(t, { zone: 'hand', controller: undefined, linkedTo: undefined });
      p.hand.push(t.iid);
      log(s, `${def(s, t.iid).name} has no effect and goes into ${p.name}'s hand.`, pl);
      return { t: 'cancelPlot', target: play.target! };
    },
  },

  'agent-in-place': {
    timing: ['anytime'],
    needs: { target: 'rivalGroup', pay: 'tokens' },
    check(s, pl, play) {
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      if (play.payWith?.length !== 1 || power(s, play.payWith[0]) < 4) return 'Spend the action of one of your Groups with Power 4 or more.';
      const rival = agentRival(s, play);
      if (!rival || rival === pl) return 'Choose a rival (one of their Groups, or one of their hidden Plots).';
      if (!hidden(s, rival).length) return 'That rival has no hidden Plot cards.';
      return null;
    },
    apply(s, _pl, play) { pay(s, play.payWith); },
    // The player sees the rival's hidden Plots, then picks the one to discard.
    resolve(s, pl, play) {
      const rival = agentRival(s, play)!;
      const cards = hidden(s, rival);
      if (!cards.length) return;
      revealTo(s, pl, cards, `Your agent reports ${player(s, rival).name}'s hidden Plots`);
      log(s, `${player(s, pl).name} looks at ${player(s, rival).name}'s hidden Plots.`, pl);
      askChoice(s, pl, {
        key: 'agent-in-place',
        question: `Which of ${player(s, rival).name}'s Plots must be discarded?`,
        options: cards.map((c) => ({ id: c, label: def(s, c).name })),
        min: 1, max: 1, source: play.card, data: { rival },
      });
    },
  },

  'air-magic': {
    timing: ['attack'],
    needs: { pay: 'tokens', mode: ['magic', 'deck'] },
    check(s, pl, play, ctx) {
      if (!ctx?.disaster || !disasterTarget(s, ctx.target)) return 'Play this when a Place is struck by a Disaster.';
      if (ctx.instantCard && ['earthquake', 'volcano'].includes(s.cards[ctx.instantCard].cardId)) return 'Air Magic does not help against an Earthquake or a Volcano.';
      if (play.mode === 'deck') return player(s, pl).plotDeck.length ? null : 'Your Plot deck is empty.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      return play.payWith?.length === 1 && matches(s, play.payWith[0], { attributes: ['Magic'] }) ? null : 'Pay with the action of a Magic Group, or discard the top card of your Plot deck.';
    },
    apply(s, pl, play, ctx) {
      if (play.mode === 'deck') discardTop(s, pl, 'plotDeck'); else pay(s, play.payWith);
      const t = ctx!.target;
      const opts = { defense: true, halve: !!s.cards[t].devastated };
      const now = power(s, t, opts);
      s.cards[t].mods.push({ source: play.card, kind: 'mulPower', value: 3, until: 'attack' });
      const tripled = power(s, t, opts);
      s.cards[t].mods.pop();
      ctx!.defenseBonus.push({ player: pl, plot: play.card, amount: Math.max(0, tripled - now), label: 'Air Magic (Power x3)' });
    },
  },

  'angst': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'anyGroup', pay: 'tokens' },
    check(s, pl, play, ctx) {
      if (ctx || s.attack) return 'Angst cannot be played during an attack.';
      if (!inPlay(s, play.target) || !isGroup(s, play.target) || !['Place', 'Organization'].includes(def(s, play.target!).subtype)) return 'Choose a Place or Organization in play.';
      if (s.cards[player(s, pl).illuminati].tokens < 1) return 'This needs an action from your Illuminati.';
      const h = play.payWith ?? [];
      const c = h.length === 1 ? s.cards[h[0]] : undefined;
      if (!c || !ANGST_HELPERS.includes(c.cardId) || c.controller !== pl || (c.zone !== 'structure' && c.zone !== 'resources') || c.tokens < 1) return 'Also spend the action of your Psychiatrists, Intellectuals or Orbital Mind Control Lasers.';
      return null;
    },
    apply(s, pl, play) {
      s.cards[player(s, pl).illuminati].tokens--;
      s.cards[play.payWith![0]].tokens--;
    },
    resolve(s, _pl, play) {
      const t = play.target!;
      if (!inPlay(s, t)) return;
      // Set to 1 before multipliers and additions (R047), so later bonuses still count and expire normally.
      s.cards[t].mods.push({ source: play.card, kind: 'setPower', value: 1, lower: true, until: 'permanent' });
      s.cards[play.card].linkedTo = t;
    },
  },

  'atomic-monster': {
    timing: ['instant', 'declare', 'attack'],
    needs: { target: 'place', mode: ['disaster', 'boost'] },
    check(s, _pl, play, ctx) {
      if (play.mode === 'boost') {
        if (!ctx || ctx.type !== 'destroy' || !MONSTER_PREY.includes(s.cards[ctx.target].cardId)) return 'This +10 applies only when the target of an Attack to Destroy is the Robot Sea Monsters or the Nuclear Power Companies.';
        return null;
      }
      if (ctx) return 'Launch the Atomic Monster when no attack is in progress.';
      if (!inPlay(s, play.target) || def(s, play.target!).subtype !== 'Place') return 'Choose a Place in play.';
      if (!(def(s, play.target!).attributes ?? []).includes('Coastal')) return 'The Atomic Monster can only strike a Coastal Place.';
      return null;
    },
    apply(s, pl, play) {
      if (play.mode === 'boost') {
        const ctx = s.attack!;
        ctx.attackBonus.push({ player: pl, plot: play.card, amount: 10, label: 'Atomic Monster' });
        if (s.window) s.window.passed = [];
        return;
      }
      const t = play.target!;
      const id = s.cards[t].cardId;
      const pw = id === 'japan' || id === 'california' ? 24 : (def(s, t).attributes ?? []).includes('Huge') ? 16 : 20;
      startInstantAttack(s, pl, { plot: play.card, target: t, power: pw, disaster: { destroyMargin: 7 } });
    },
  },

  'backlash': {
    timing: ['anytime'],
    needs: { target: 'anyGroup', pay: 'tokens' },
    check(s, pl, play) {
      if (!inPlay(s, play.target) || !isGroup(s, play.target)) return 'Choose a Group in play.';
      const src = plotChanges(s, play.target!);
      if (!src.length) return 'No Plot card has changed that Group.';
      if (play.mode && !src.includes(play.mode)) return 'That Plot did not change this Group.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      const t: Alignment[] = alignments(s, play.target!).filter((a) => a !== 'Fanatic');
      if (play.payWith?.length !== 1 || !alignments(s, play.payWith[0]).some((a) => t.includes(a))) return 'Spend the action of one of your Groups that shares an alignment (not Fanatic) with the target.';
      return null;
    },
    apply(s, _pl, play, ctx) { pay(s, play.payWith); if (ctx) undo(s, play); },
    resolve: (s, _pl, play) => undo(s, play),
  },

  'bank-merger': {
    timing: ['anytime'],
    check: (s, pl) => (structureCards(s, pl).some((g) => isGroup(s, g) && matches(s, g, { attributes: ['Bank'] })) ? null : 'You control no Bank Groups.'),
    ...effectNow((s, pl) => {
      let n = 0;
      for (const g of structureCards(s, pl)) {
        if (isGroup(s, g) && matches(s, g, { attributes: ['Bank'] }) && !tokenBarred(s, g)) { s.cards[g].tokens++; n++; }
      }
      log(s, `${n} Bank Group${n === 1 ? ' gets' : 's get'} an Action token.`, pl);
    }),
  },

  'bimbo-at-eleven': {
    timing: ['declare'],
    check(s, pl, _play, ctx) {
      if (!ctx || ctx.instant || ctx.attackerPlayer !== pl || ctx.type !== 'destroy') return 'Play this when you declare an Attack to Destroy.';
      if (!ctx.attacker || !matches(s, ctx.attacker, { attributes: ['Media'] })) return 'The attack must be made by a Media Group.';
      if (def(s, ctx.target).subtype !== 'Personality' || NOT_MALE.has(s.cards[ctx.target].cardId)) return 'Only against a male Personality.';
      return null;
    },
    apply(s, pl, play, ctx): PlotEffect {
      ctx!.attackBonus.push({ player: pl, plot: play.card, amount: 5, label: 'Bimbo at Eleven' });
      s.cards[play.card].linkedTo = `attack:${ctx!.id}`;
      // Privileged, except that players with Media Groups may still take part.
      for (const p of livePlayers(s)) {
        if (p.id === pl || !structureCards(s, p.id).some((g) => isGroup(s, g) && matches(s, g, { attributes: ['Media'] }))) continue;
        ctx!.plays.push({ iid: `bimbo:${play.card}:${p.id}`, player: pl, play: { card: play.card }, effect: { t: 'interfere', player: p.id } });
      }
      return { t: 'privileged' };
    },
  },

  'blitzkrieg': {
    timing: ['anytime'],
    needs: { target: 'ownGroup' },
    check: (s, pl, play) => (own(s, pl, play.target) && isGroup(s, play.target) && s.cards[play.target!].capturedTurn === s.turn
      ? null : 'Choose a Group you took control of this turn.'),
    ...effectNow((s, _pl, play) => { if (inPlay(s, play.target)) giveToken(s, play.target!); }),
  },

  'blood-toil-tears-and-sweat': {
    timing: ['anytime'],
    needs: { pay: 'tokens', mode: ['red', 'blue', 'yellow'] },
    check(s, pl, play) {
      if (!nwoTarget(s, play)) return 'Choose a New World Order in play.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      if (!play.payWith?.length || !play.payWith.every((g) => matches(s, g, { attributes: ['Media'] }))) return 'Pay with the actions of your Media Groups.';
      return totalPower(s, play.payWith) >= 4 ? null : 'The paying Media Groups need at least 4 Power in total.';
    },
    apply(s, _pl, play, ctx) { const t = nwoTarget(s, play); pay(s, play.payWith); if (ctx && t) dropNwo(s, t); },
    resolve(s, _pl, play) { const t = nwoTarget(s, play); if (t) dropNwo(s, t); },
  },

  'bodyguard': {
    timing: ['attack'],
    linked: true,
    check(s, _pl, _play, ctx) {
      if (!ctx?.assassination) return 'Play this after an Assassination is played.';
      return inPlay(s, ctx.target) && def(s, ctx.target).subtype === 'Personality' ? null : 'The Assassination has no Personality to protect.';
    },
    apply(s, _pl, play, ctx): PlotEffect {
      s.cards[play.card].linkedTo = ctx!.target;
      return { t: 'fail' };
    },
  },
});

function agentRival(s: GameState, play: PlotPlay): string | undefined {
  const t = play.target ? s.cards[play.target] : undefined;
  if (!t) return undefined;
  if (t.zone === 'hand') return s.players.find((p) => p.hand.includes(t.iid))?.id;
  return t.zone === 'structure' ? t.controller : undefined;
}
/** A player's hidden Plots that other cards can reach (not one hidden beneath Texas or Fidel Castro). */
function hidden(s: GameState, pl: string): string[] {
  return exposableHand(s, pl, 'Plot');
}

registerChoice('agent-in-place', {
  resolve(s, pl, picked, data) {
    const rival = data.rival as string;
    const c = picked[0];
    if (!c || !hidden(s, rival).includes(c)) return;
    log(s, `${player(s, pl).name}'s agent makes ${player(s, rival).name} discard ${def(s, c).name}.`, pl);
    discardCard(s, c);
  },
});

function undo(s: GameState, play: PlotPlay) {
  const t = play.target!;
  if (!inPlay(s, t)) return;
  const src = play.mode && plotChanges(s, t).includes(play.mode) ? play.mode : plotChanges(s, t)[0];
  if (!src) return;
  s.cards[t].mods = s.cards[t].mods.filter((m) => m.source !== src);
  const c = s.cards[src];
  if (c.zone === 'table') discardCard(s, src);
  log(s, `Backlash undoes ${def(s, src).name} on ${def(s, t).name}.`);
}

function nwoTarget(s: GameState, play: PlotPlay): string | undefined {
  const inPlayNwos = Object.values(s.nwo).filter((x): x is string => !!x && s.cards[x]?.zone === 'table');
  if (play.target && inPlayNwos.includes(play.target)) return play.target;
  const byColor = play.mode ? s.nwo[play.mode] : undefined;
  return byColor && inPlayNwos.includes(byColor) ? byColor : undefined;
}
function dropNwo(s: GameState, iid: string) {
  for (const [color, x] of Object.entries(s.nwo)) if (x === iid) s.nwo[color] = undefined;
  discardCard(s, iid);
  log(s, `${def(s, iid).name} is discarded.`);
}
