// Assassins pack, batch 5. See docs/CARD_SCRIPTING.md ("Expansions") and docs/EXPANSIONS.md.
import type { Alignment, GameState, PlotPlay, Side } from '../types';
import { registerPlots } from '../plotTypes';
import { anyHook, hooksOf, registerChoice, registerHooks } from '../hooks';
import { cardName, def, OPPOSITE } from '../cards';
import { type Match, matches } from '../abilities';
import { alignments, attributes, power } from '../stats';
import { openArrows, puppets, sideOf, subtree } from '../geometry';
import {
  askChoice, attackCancelled, canEnterPlay, discardCard, exposeCards, giveToken, isCancelled, log, moveSubtree, player,
  playResourceCard, startCardAttack, zappedPlayer,
} from '../game';
import { freezePlot, paralysisPlot, registerZap } from './families';

// ---------------------------------------------------------------- helpers

const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';
const own = (s: GameState, pl: string, iid?: string) => inPlay(s, iid) && s.cards[iid!].controller === pl;
const isGroup = (s: GameState, iid?: string) => !!iid && def(s, iid).type === 'Group';
const isPersonality = (s: GameState, iid?: string) => !!iid && def(s, iid).subtype === 'Personality';
const isGadget = (s: GameState, iid: string) => /\bGadget\b/.test(def(s, iid).uniqueness ?? '');
const totalPower = (s: GameState, gs: string[]) => gs.reduce((n, g) => n + power(s, g), 0);

// ---------------------------------------------------------------- Freezes

registerPlots({
  'pave-the-earth': freezePlot({ match: { attributes: ['Green'] }, label: 'Green' }),
  'school-prayer': freezePlot({
    match: [{ attributes: ['Church'] }, { alignments: ['Liberal', 'Conservative'] }],
    cancel: { attributes: ['Church'] }, label: 'Church, Liberal and Conservative',
  }),
});

// ---------------------------------------------------------------- Zaps

registerZap('tanstaafl', { noTakeover: { alignments: ['Liberal'] } });
registerZap('take-the-money-and-run', { noTakeover: { alignments: ['Criminal'] } });
registerZap('the-meek-shall-inherit', { noTakeover: { alignments: ['Violent'] } });
registerZap('sorry-wrong-number', { hooks: { noProximityBonus: (s, self, target) => s.cards[target]?.controller === zappedPlayer(s, self) } });
registerZap('security-leak', {
  hooks: {
    onDraw(s, self, pl, deck, card) { if (deck === 'plot' && pl === zappedPlayer(s, self)) exposeCards(s, [card]); },
  },
});

// ---------------------------------------------------------------- Paralysis

registerPlots({
  'vile-secretions': paralysisPlot({ on: { alignments: ['Weird'] }, pay: { alignments: ['Straight'] } }),
  'waiting-period': paralysisPlot({ on: { alignments: ['Violent'] }, pay: { alignments: ['Peaceful'] } }),
  'whistle-blowers': paralysisPlot({ on: { alignments: ['Government'] }, pay: { alignments: ['Corporate'] } }),
});

// ---------------------------------------------------------------- Pizza for the Secret Meeting

registerPlots({
  'pizza-for-the-secret-meeting': {
    timing: ['anytime'],
    needs: { target: 'anyGroup' },
    check(s, _pl, play) {
      if (!inPlay(s, play.target) || !attributes(s, play.target!).includes('Secret')) return 'Choose a Secret Group in play.';
      return null;
    },
    apply: () => undefined,
    resolve(s, pl, play) {
      s.cards[play.target!].mods.push({ source: play.card, kind: 'removeAttr', attr: 'Secret', until: 'endOfTurn' });
      log(s, `${cardName(s, play.target!)} is not Secret for the rest of the turn.`, pl);
    },
  },
});

// ---------------------------------------------------------------- Regi$tered Trademark
//
// RULING: the printed rule polices what players say out loud (table talk) about the linked card. This
// engine has no chat channel to detect a naming slip, so it cannot referee that by itself. The closest
// faithful version keeps the honor system the paper game already relies on: it stays linked to the
// chosen Group for good, and either player may record the two penalties the card names — admitting a
// slip (discarding a Plot) or catching the Group's owner slipping first (they hand over their top
// Plot) — through the `nameSlip` / `catchNameSlip` engine actions, whenever they judge one happened.

registerPlots({
  'regi-tered-trademark': {
    timing: ['anytime'],
    needs: { target: 'anyGroup' },
    check(s, _pl, play) {
      if (!inPlay(s, play.target) || !isGroup(s, play.target)) return 'Choose a Group in play.';
      return null;
    },
    apply: () => undefined,
    resolve(s, pl, play) {
      s.cards[play.card].linkedTo = play.target;
      log(s, `${cardName(s, play.card)} is linked to ${cardName(s, play.target!)}: it must always be called by its full name.`, pl);
    },
  },
});

// ---------------------------------------------------------------- Reverse Whammy

registerPlots({
  'reverse-whammy': {
    timing: ['event'],
    events: ['plotResolved'],
    needs: { target: 'plot' },
    check(s, pl, play) {
      const e = s.window?.event;
      if (!e || e.type !== 'plotResolved' || e.player === pl) return 'Play this right after a rival plays a Zap on you.';
      const zap = e.card ? s.cards[e.card] : undefined;
      if (play.target !== e.card || !zap || zap.zone !== 'table' || !(def(s, e.card!).keywords ?? []).includes('Zap') || zap.linkedTo !== player(s, pl).illuminati) {
        return 'Play this right after a Zap is played on you.';
      }
      const disc = play.discards ?? [];
      if (disc.length) {
        if (disc.length !== 1 || !player(s, pl).hand.includes(disc[0]) || def(s, disc[0]).type !== 'Group') return 'Discard your top undrawn Group card, or a Group card from your hand.';
      }
      return null;
    },
    apply(s, _pl, play) {
      const e = s.window!.event!;
      s.cards[play.card].data = { zapper: e.player };
    },
    resolve(s, pl, play) {
      const me = player(s, pl);
      const disc = play.discards ?? [];
      if (disc.length) discardCard(s, disc[0]);
      else {
        const top = me.groupDeck.shift();
        if (top) { s.cards[top].zone = 'hand'; me.hand.push(top); discardCard(s, top); }
      }
      const zapper = (s.cards[play.card].data as { zapper?: string } | undefined)?.zapper;
      const zap = s.cards[play.target!];
      if (zapper && zap) {
        zap.linkedTo = player(s, zapper).illuminati;
        log(s, `${cardName(s, play.card)} turns ${cardName(s, play.target!)} back on ${player(s, zapper).name}.`, pl);
      }
    },
  },
});

// ---------------------------------------------------------------- Secret Master

registerPlots({
  'secret-master': {
    timing: ['anytime'],
    needs: { target: 'personality' },
    check(s, pl, play) {
      const t = play.target;
      if (!own(s, pl, t) || !isPersonality(s, t) || s.cards[t!].master !== player(s, pl).illuminati) return 'Choose a Personality directly controlled by your Illuminati.';
      return null;
    },
    apply: () => undefined,
    resolve(s, pl, play) {
      s.cards[play.card].linkedTo = play.target;
      log(s, `${cardName(s, play.target!)} becomes a Secret Master.`, pl);
    },
    linkLegal: (s, _plot, group) => (s.cards[group] && s.cards[group].zone === 'structure' && s.cards[group].master === player(s, s.cards[group].controller!).illuminati ? 'ok' : 'discard'),
  },
});
registerHooks({
  'secret-master': {
    preventDestroy(s, self, target, ctx) {
      if (target !== s.cards[self].linkedTo) return false;
      if (!ctx) return true;
      if (ctx.assassination) return false;
      if (ctx.attacker && def(s, ctx.attacker).type === 'Illuminati') return false;
      return true;
    },
    forbidAttack(s, self, _attacker, target, type) {
      if (target === s.cards[self].linkedTo && (type === 'control' || type === 'takeover')) return `${cardName(s, target)} cannot be captured: it is a Secret Master.`;
      return null;
    },
    attackMod(s, self, ctx, side) {
      return side === 'defense' && ctx.assassination && ctx.target === s.cards[self].linkedTo ? 20 : 0;
    },
    alignmentMod(s, self, iid, current) { return iid === s.cards[self].linkedTo ? [] : current; },
    attributeMod(s, self, iid, current) { return iid === s.cards[self].linkedTo ? [] : current; },
  },
});

// ---------------------------------------------------------------- Strange Bedfellows
//
// RULING: "Alignments changed by this card do not count toward any Goal" needs the change itself to
// disappear when a Goal is evaluated, which the engine's plain alignment modifiers cannot do (only
// numeric mods respect `countsForGoals`). So this card stays linked to the Group for as long as the
// reversal lasts and swaps its alignments through the `alignmentMod` hook instead, which does see the
// `goals` flag. The engine also only tracks "for one action" as coarsely as it already does for similar
// defensive bonuses: for the rest of the current turn, whether played during an attack or not. The
// card's second timing option (played during Action-token placement) is not offered: that phase runs
// automatically in this engine with no Plot response window.

function reversibleAlignments(s: GameState, iid: string): Alignment[] {
  return alignments(s, iid).filter((a) => OPPOSITE[a]);
}
function reverseAlignments(s: GameState, pl: string, play: PlotPlay) {
  const rev = play.alignment ? [play.alignment] : reversibleAlignments(s, play.target!);
  s.cards[play.card].linkedTo = play.target;
  s.cards[play.card].data = { turn: s.turn, rev };
  log(s, `${cardName(s, play.target!)}'s alignment${rev.length > 1 ? 's are' : ' is'} reversed (${rev.join(', ')}) for the rest of the turn.`, pl);
}

registerPlots({
  'strange-bedfellows': {
    timing: ['anytime', 'declare', 'attack'],
    needs: { target: 'ownGroup', alignment: true },
    check(s, pl, play) {
      if (!own(s, pl, play.target) || !isGroup(s, play.target)) return 'Choose a Group you control.';
      const rev = reversibleAlignments(s, play.target!);
      if (!rev.length) return `${cardName(s, play.target!)} has no alignment that can be reversed.`;
      if (play.alignment && !rev.includes(play.alignment)) return `Choose one of ${cardName(s, play.target!)}'s alignments (${rev.join(', ')}), or none to reverse all of them.`;
      return null;
    },
    apply(s, pl, play, ctx) { if (ctx) reverseAlignments(s, pl, play); },
    resolve(s, pl, play) { reverseAlignments(s, pl, play); },
    linkLegal: (s, plot, group) => (s.cards[group] && s.cards[plot].data?.turn === s.turn ? 'ok' : 'discard'),
  },
});
registerHooks({
  'strange-bedfellows': {
    alignmentMod(s, self, iid, current, goals) {
      if (iid !== s.cards[self].linkedTo || goals) return current;
      const rev = (s.cards[self].data as { rev?: Alignment[] } | undefined)?.rev ?? [];
      let out = [...current];
      for (const a of rev) {
        const opp = OPPOSITE[a]!;
        out = out.filter((x) => x !== opp);
        if (!out.includes(opp)) out.push(opp);
      }
      return out;
    },
  },
});

// ---------------------------------------------------------------- Sudden European Vacation

function moveAndProtect(s: GameState, pl: string, play: PlotPlay) {
  const t = play.target!, onto = play.helper!, side = play.mode as Side;
  moveSubtree(s, t, s.cards[onto].controller!, onto, side, 'hand');
  s.cards[play.card].linkedTo = t;
  s.cards[play.card].data = { turn: s.turn };
  log(s, `${cardName(s, t)} suddenly leaves for Europe and reappears under ${cardName(s, onto)}, safe from hostile Plots for the rest of the turn.`, pl);
}

registerPlots({
  'sudden-european-vacation': {
    timing: ['anytime', 'counter', 'attack'],
    needs: { target: 'ownGroup', helper: true },
    check(s, pl, play) {
      const t = play.target;
      if (!own(s, pl, t) || !isPersonality(s, t)) return 'Choose a Personality you control.';
      const onto = play.helper, side = play.mode as Side | undefined;
      if (!onto || !s.cards[onto] || s.cards[onto].zone !== 'structure' || !side) return "Choose a master card and an open arrow to move it to.";
      if (subtree(s, t!).includes(onto)) return `${cardName(s, t!)} cannot be moved under its own puppet.`;
      if (onto === s.cards[t!].master && side === s.cards[t!].side) return `${cardName(s, t!)} is already there.`;
      if (!openArrows(s, onto, new Set(subtree(s, t!))).includes(side)) return `${cardName(s, onto)} has no open ${side} arrow.`;
      return null;
    },
    apply(s, pl, play, ctx) {
      if (ctx) { moveAndProtect(s, pl, play); return; }
      if (s.window?.kind === 'plot') {
        moveAndProtect(s, pl, play);
        return { t: 'cancelPlot', target: s.window.plot!.iid };
      }
    },
    resolve(s, pl, play) { moveAndProtect(s, pl, play); },
    linkLegal: (s, plot, group) => (s.cards[group] && s.cards[plot].data?.turn === s.turn ? 'ok' : 'discard'),
  },
});
registerHooks({
  'sudden-european-vacation': {
    immune: (s, self, target, source) => target === s.cards[self].linkedTo && !!s.cards[source] && def(s, source).type === 'Plot',
  },
});

// ---------------------------------------------------------------- Sufficiently Advanced Technology

registerPlots({
  'sufficiently-advanced-technology': {
    timing: ['anytime'],
    needs: { target: 'ownGroup' },
    check(s, pl, play) {
      if (!own(s, pl, play.target) || !isGroup(s, play.target)) return 'Choose a Group you control.';
      const attrs = attributes(s, play.target!);
      if (!attrs.includes('Science') && !attrs.includes('Magic')) return 'Choose a Science or Magic Group.';
      return null;
    },
    apply: () => undefined,
    resolve(s, pl, play) {
      s.cards[play.card].linkedTo = play.target;
      log(s, `${cardName(s, play.target!)} becomes both Science and Magic.`, pl);
    },
    linkLegal: (s, _plot, group) => (s.cards[group] && ['structure', 'uncontrolled'].includes(s.cards[group].zone) ? 'ok' : 'discard'),
  },
});
registerHooks({
  'sufficiently-advanced-technology': {
    attributeMod(s, self, iid, current) {
      if (iid !== s.cards[self].linkedTo) return current;
      const out = [...current];
      if (out.includes('Science') && !out.includes('Magic')) out.push('Magic');
      if (out.includes('Magic') && !out.includes('Science')) out.push('Science');
      return out;
    },
  },
});

// ---------------------------------------------------------------- Supernova

registerPlots({
  'supernova': {
    timing: ['anytime'],
    needs: { targetsOf: 'handCard' },
    check(s, pl, play) {
      const targets = play.targets ?? [];
      if (!targets.length || targets.length > 2) return 'Choose one or two Gadget Resources from your hand.';
      if (new Set(targets).size !== targets.length) return 'Choose different cards.';
      for (const t of targets) {
        if (!player(s, pl).hand.includes(t) || def(s, t).type !== 'Resource' || !isGadget(s, t)) return 'Choose Gadget Resources from your hand.';
        if (!canEnterPlay(s, t, pl)) return `${cardName(s, t)} cannot come into play right now.`;
      }
      const pay = play.payWith ?? [];
      if (pay.length !== targets.length || new Set(pay).size !== pay.length) return 'Spend one Space action for each Resource taken.';
      for (const g of pay) {
        if (!own(s, pl, g) || !attributes(s, g).includes('Space') || s.cards[g].tokens < 1) return 'Pay with one Space Group action per Resource.';
      }
      return null;
    },
    apply(s, pl, play, ctx) {
      for (const g of play.payWith ?? []) s.cards[g].tokens--;
      if (ctx) bringGadgets(s, pl, play);
    },
    resolve(s, pl, play) { bringGadgets(s, pl, play); },
  },
});
function bringGadgets(s: GameState, pl: string, play: PlotPlay) {
  for (const t of play.targets ?? []) {
    if (!player(s, pl).hand.includes(t)) continue;
    playResourceCard(s, t, pl);
    if (hooksOf(s, t)?.hasAction) giveToken(s, t);
  }
  log(s, `${player(s, pl).name} brings ${(play.targets ?? []).length} Gadget Resource(s) into play with the Supernova.`, pl);
}

// ---------------------------------------------------------------- Supreme Court Nomination

const NOMINATION_BONUS: Match = { names: ['republicans', 'democrats'] };
registerPlots({
  'supreme-court-nomination': {
    timing: ['instant'],
    needs: { target: 'personality' },
    check(s, _pl, play) {
      if (!inPlay(s, play.target) || !isPersonality(s, play.target)) return 'Choose a Personality in play.';
      if (Object.values(s.cards).some((c) => c.zone === 'structure' && (c.data as { chiefJustice?: boolean } | undefined)?.chiefJustice)) {
        return 'A Chief Justice is already sitting: no more nominations while he is in play.';
      }
      return null;
    },
    apply(s, pl, play) {
      s.cards[play.card].linkedTo = play.target;
      startCardAttack(s, pl, { plot: play.card, target: play.target!, power: 15 });
    },
    joinRule: () => true,
    joinMultiplier: (s, _ctx, g) => (matches(s, g, NOMINATION_BONUS) || attributes(s, g).includes('Media') ? 2 : 1),
  },
});
registerHooks({
  'supreme-court-nomination': {
    onAttackEnd(s, self, ctx) {
      if (ctx.instantCard !== self) return;
      if (!attackCancelled(ctx) && ctx.result === 'failure' && s.cards[ctx.target]?.zone === 'structure') {
        const t = s.cards[ctx.target];
        t.mods.push({ source: self, kind: 'setPower', value: 4, until: 'permanent' });
        t.mods.push({ source: self, kind: 'addAlign', align: 'Government', until: 'permanent' });
        t.data = { ...t.data, chiefJustice: true };
        log(s, `${cardName(s, ctx.target)} becomes Chief Justice.`, ctx.attackerPlayer);
      }
      discardCard(s, self);
    },
  },
});

// ---------------------------------------------------------------- Teflon Coating

registerPlots({
  'teflon-coating': {
    timing: ['attack'],
    check(s, _pl, _play, ctx) {
      if (!ctx || def(s, ctx.target).subtype !== 'Personality') return 'Play this during an attack on a Personality.';
      const involved = [ctx.attacker, ...ctx.aid.map((a) => a.iid)].filter((g): g is string => !!g && !isCancelled(ctx.plays, g));
      if (!involved.some((g) => attributes(s, g).includes('Media'))) return 'No Media Group is attacking or aiding this attack yet.';
      return null;
    },
    apply(s, pl, play, ctx) {
      if (!ctx) return;
      s.cards[play.card].linkedTo = ctx.target;
      const media = [ctx.attacker, ...ctx.aid.map((a) => a.iid)].filter((g): g is string => !!g && attributes(s, g).includes('Media'));
      let i = 0;
      for (const g of media) ctx.plays.push({ iid: `teflon:${g}:${i++}:${play.card}`, player: pl, play: { card: play.card }, effect: { t: 'cancelGroup', group: g }, partOf: play.card });
      log(s, `${cardName(s, play.card)} cancels every Media action against ${cardName(s, ctx.target)}.`, pl);
    },
  },
});
registerHooks({
  'teflon-coating': {
    forbidJoin(s, self, ctx, group, as) { return as === 'aid' && s.cards[self].linkedTo === ctx.target && attributes(s, group).includes('Media'); },
    onAttackEnd(s, self, ctx) { if (s.cards[self]?.linkedTo === ctx.target) discardCard(s, self); },
  },
});

// ---------------------------------------------------------------- The Irish Flu

registerPlots({
  'the-irish-flu': {
    timing: ['anytime'],
    needs: { target: 'personality' },
    check(s, _pl, play) {
      if (!inPlay(s, play.target) || !isPersonality(s, play.target)) return 'Choose a Personality in play.';
      return null;
    },
    apply: () => undefined,
    resolve(s, pl, play) { infectWithFlu(s, pl, play.card, play.target!); },
  },
});
function fluImmune(s: GameState, iid: string, flu: string): boolean {
  return ((s.cards[iid].data as { immuneFlu?: string[] } | undefined)?.immuneFlu ?? []).includes(flu);
}
function infectWithFlu(s: GameState, pl: string, flu: string, target: string) {
  s.cards[flu].linkedTo = target;
  s.cards[target].tokens = 0;
  s.cards[target].mods.push({ source: flu, kind: 'noTokens', until: 'endOfTurn' });
  log(s, `${cardName(s, target)} catches the Flu from ${cardName(s, flu)} and loses its Action token.`, pl);
}
registerHooks({
  'the-irish-flu': {
    // RULING: "the beginning of the next turn" is read as the infected Personality's own owner's next
    // turn, matching this engine's per-controller turn-start hook (the wording does not say whose turn).
    onTurnStart(s, self) {
      const victim = s.cards[self].linkedTo;
      if (!victim || !inPlay(s, victim)) { discardCard(s, self); return; }
      s.cards[victim].data = { ...s.cards[victim].data, immuneFlu: [...((s.cards[victim].data as { immuneFlu?: string[] } | undefined)?.immuneFlu ?? []), self] };
      const owner = s.cards[victim].controller!;
      const catchable = Object.values(s.cards).filter((c) => c.zone === 'structure' && def(s, c.iid).subtype === 'Personality' && !fluImmune(s, c.iid, self)
        && !anyHook(s, (h, hself) => !!h.immune?.(s, hself, c.iid, self))).map((c) => c.iid);
      log(s, `${cardName(s, victim)} recovers and is now immune to ${cardName(s, self)}.`, owner);
      if (!catchable.length) { discardCard(s, self); log(s, `Every Personality in play is immune: ${cardName(s, self)} is discarded.`); return; }
      askChoice(s, owner, {
        key: 'irish-flu-pass', question: `${cardName(s, self)}: pass the Flu on to which Personality?`, min: 1, max: 1, source: self,
        options: catchable.map((c) => ({ id: c, label: cardName(s, c) })), data: { flu: self },
      });
    },
  },
});
registerChoice('irish-flu-pass', {
  resolve(s, pl, picked, data) {
    const flu = data.flu as string;
    if (!s.cards[flu] || s.cards[flu].zone !== 'table') return;
    infectWithFlu(s, pl, flu, picked[0]);
  },
});

// ---------------------------------------------------------------- This Was Only A Test
//
// RULING: "cancelled" is modelled with the same mechanism the engine already uses for an Instant attack
// made illegal mid-flight (the Plot returns to its owner's hand, exposed): a small, generic addition to
// `attackIllegal`/`checkPlot` (see game.ts) lets a card mark a specific Instant attack "stopped" and
// bench that Plot card until its owner has completed one more of their own turns, instead of only
// reacting to hook-based immunity as the base engine did before.

registerPlots({
  'this-was-only-a-test': {
    timing: ['attack'],
    check(s, _pl, _play, ctx) {
      if (!ctx?.disaster || !ctx.instantCard) return 'Play this right when a Disaster is played.';
      return null;
    },
    apply(s, _pl, _play, ctx) {
      const card = ctx!.instantCard!;
      const owner = s.cards[card].owner;
      s.cards[card].data = { ...s.cards[card].data, attackStopped: true, unusableUntilOwnerTurns: player(s, owner).turnsTaken + 1 };
    },
  },
});

// ---------------------------------------------------------------- Truck Bomb

registerPlots({
  'truck-bomb': {
    timing: ['attack'],
    check(s, pl, _play, ctx) {
      if (!ctx || ctx.instant || ctx.type !== 'destroy' || ctx.attackerPlayer !== pl || !ctx.attacker) return 'Play this when you attack to destroy an Organization.';
      if (def(s, ctx.target).subtype !== 'Organization') return 'Only against an Organization.';
      if (!alignments(s, ctx.attacker).includes('Violent')) return "The attacking Group must be Violent.";
      if (ctx.aid.length || ctx.oppose.length) return 'Too late: play this before anyone aids or opposes.';
      return null;
    },
    apply(s, _pl, _play, ctx) {
      const c = ctx!;
      c.instant = true;
      c.instantPower = power(s, c.attacker!);
      c.instantDefense = power(s, c.target, { defense: true, halve: !!s.cards[c.target].devastated });
    },
  },
});

// ---------------------------------------------------------------- Witch Hunt

function witchHuntEligible(s: GameState, g: string) {
  return s.cards[g]?.zone === 'structure' && def(s, g).type === 'Group' && attributes(s, g).includes('Church') && s.cards[g].tokens === 0 && s.cards[g].capturedTurn !== s.turn;
}
function witchHuntGive(s: GameState, pl: string, play: PlotPlay) {
  let n = 0;
  for (const g of play.targets ?? []) if (s.cards[g]?.zone === 'structure' && s.cards[g].tokens === 0) { giveToken(s, g); if (s.cards[g].tokens) n++; }
  log(s, `${n} Church Group${n === 1 ? ' gets' : 's get'} an Action token.`, pl);
}
registerPlots({
  'witch-hunt': {
    timing: ['anytime'],
    needs: { targets: true },
    check(s, pl, play) {
      if (s.cards[player(s, pl).illuminati].tokens < 1) return 'This costs an action from your Illuminati.';
      const t = play.targets ?? [];
      if (!t.length || new Set(t).size !== t.length) return 'Choose which Church Groups get a token.';
      if (!t.every((g) => witchHuntEligible(s, g))) return 'Choose Church Groups without a token (not captured this turn, and able to receive one).';
      if (t.length > 1 && totalPower(s, t) > 5) return 'Give a token to one Church Group, or several totalling 5 Power or less.';
      return null;
    },
    apply(s, pl, play, ctx) {
      s.cards[player(s, pl).illuminati].tokens--;
      if (ctx) witchHuntGive(s, pl, play);
    },
    resolve: (s, pl, play) => witchHuntGive(s, pl, play),
  },
});

// ---------------------------------------------------------------- You Are What You Eat
//
// RULING: the card lets the player choose to rehang each former puppet, discard it, or return it to
// hand. This engine has no generic three-way choice for that, so puppets are rehung automatically where
// an arrow is open (matching how a normal capture already handles overflow) and sent to their owner's
// hand otherwise; the "or discard" option is not offered separately.

registerPlots({
  'you-are-what-you-eat': {
    timing: ['event'],
    events: ['destroyed'],
    check(s, pl) {
      const e = s.window?.event;
      if (!e || e.type !== 'destroyed' || e.by !== pl) return 'Play this right after one of your Groups destroys another.';
      const attacker = (e.data as { attacker?: string } | undefined)?.attacker;
      if (!attacker || !s.cards[attacker] || s.cards[attacker].zone !== 'structure' || s.cards[attacker].controller !== pl || def(s, attacker).type !== 'Group') {
        return 'Only when a Group of yours (not your Illuminati) did the destroying.';
      }
      return null;
    },
    apply(s, _pl, play) {
      const e = s.window!.event!;
      s.cards[play.card].data = { attacker: (e.data as { attacker?: string }).attacker, victim: e.card };
    },
    resolve(s, pl, play) {
      const data = s.cards[play.card].data as { attacker: string; victim: string } | undefined;
      if (!data || !s.cards[data.attacker] || s.cards[data.attacker].zone !== 'structure' || !s.cards[data.victim] || s.cards[data.victim].zone !== 'destroyed') return;
      const { attacker, victim } = data;
      const master = s.cards[attacker].master!;
      const side = sideOf(s, attacker)!;
      const kids = puppets(s, attacker); // captured before the attacker leaves play
      discardCard(s, attacker); // it counts as destroyed, but never toward a Goal: discardCard gives no destroy credit
      log(s, `${cardName(s, attacker)} is discarded, in place of what it destroyed.`, pl);
      moveSubtree(s, victim, pl, master, side, 'hand');
      log(s, `${cardName(s, victim)} takes ${cardName(s, attacker)}'s place.`, pl);
      // Former puppets of the attacker: rehung on the new card where there is room, else back to hand.
      for (const k of kids) {
        const open = openArrows(s, victim);
        if (open.length) { moveSubtree(s, k, pl, victim, open[0], 'hand'); continue; }
        for (const g of subtree(s, k)) {
          Object.assign(s.cards[g], { zone: 'hand' as const, controller: undefined, master: undefined, x: undefined, y: undefined, side: undefined });
          player(s, s.cards[g].owner).hand.push(g);
        }
      }
    },
  },
});
