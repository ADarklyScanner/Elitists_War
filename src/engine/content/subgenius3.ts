// SubGenius pack, batch "subgenius3": 24 Plot cards (docs/CARD_SCRIPTING.md, "Expansions").
import { noteCostDiscard } from '../game';
import type { Alignment, AttackCtx, GameState, PlotPlay } from '../types';
import type { PlotHandler } from '../plotTypes';
import { registerPlots } from '../plotTypes';
import { HOOKS, anyHook, isCancelled, registerChoice, registerHooks } from '../hooks';
import { abilitiesOf } from '../abilities';
import { cardName, def, OPPOSITE } from '../cards';
import { alignments, attributes, power } from '../stats';
import { structureCards, puppets, subtree } from '../geometry';
import { anyOf, groupActions, illuminatiAction, plotDiscards, targetAction } from '../costs';
import {
  activePlayer, announcedAction, announcedActors, askChoice, attackCancelled, changeRoll, destroyGroup, discardCard,
  drawGroup, drawPlot, eventAnswered, exposeCards, giveToken, log, player, plotsInHand, respondToAction,
  revealTo, tokenBarred,
} from '../game';
import { sgRules } from '../expansions';

// ---------------------------------------------------------------- helpers

const inPlay = (s: GameState, iid?: string) => !!iid && !!s.cards[iid] && ['structure', 'uncontrolled'].includes(s.cards[iid].zone);
const own = (s: GameState, pl: string, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure' && s.cards[iid].controller === pl;
const isGroup = (s: GameState, iid?: string) => !!iid && def(s, iid).type === 'Group';
const ready = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure' && s.cards[iid].tokens > 0;
const totalPower = (s: GameState, groups: string[]) => groups.reduce((n, g) => n + power(s, g), 0);

/** `play.target` names a rival's Illuminati: return that rival's player id, or undefined. */
const rivalIlluminati = (s: GameState, pl: string, target?: string): string | undefined => {
  const t = target ? s.cards[target] : undefined;
  const victim = t?.controller;
  return t && t.zone === 'structure' && def(s, target!).type === 'Illuminati' && victim && victim !== pl ? victim : undefined;
};

/** Wrap an effect so it happens at once inside an attack, or after the counter window otherwise
 *  (the pattern the base game's own Plot families use: see `plots.ts`, `effectNow`). */
function effectNow(fn: (s: GameState, pl: string, play: PlotPlay) => void): Pick<PlotHandler, 'apply' | 'resolve'> {
  return {
    apply: (s, pl, play, ctx) => { if (ctx) fn(s, pl, play); },
    resolve: fn,
  };
}

/**
 * Discard a Group from a Power Structure, sending its puppets where a destroyed Group's puppets would
 * go (the controller's hand, or the shared uncontrolled area under SubGenius rules).
 */
function discardGroupWithPuppets(s: GameState, iid: string) {
  const owner = s.cards[iid].controller!;
  for (const p of puppets(s, iid)) {
    for (const g of subtree(s, p)) {
      const gc = s.cards[g];
      if (s.common) {
        Object.assign(gc, {
          zone: 'uncontrolled', controller: undefined, master: undefined, linkedTo: undefined, x: undefined,
          y: undefined, side: undefined, tokens: 0, heldTokens: undefined, placedBy: owner, placedTurn: s.turn,
        });
        s.common.uncontrolled.push(g);
      } else {
        Object.assign(gc, { zone: 'hand', controller: undefined, master: undefined, x: undefined, y: undefined, tokens: 0 });
        player(s, owner).hand.push(g);
      }
    }
  }
  discardCard(s, iid);
}

/**
 * Is a linked Plot's continuing need for the SubGenius attribute on `group` still met? 'inactive' while
 * a temporary change (Mediocretinism's "until the end of the turn") has taken the attribute away, so the
 * link stays and works again once it returns; 'discard' once the loss is not such a temporary change (SG
 * "Links", "The Cards Remember").
 */
function subGeniusLinkLegal(s: GameState, _plot: string, group: string): 'ok' | 'inactive' | 'discard' {
  if (!inPlay(s, group)) return 'discard';
  if (attributes(s, group).includes('SubGenius')) return 'ok';
  const temp = s.cards[group].mods.some((m) => m.kind === 'removeAttr' && m.attr === 'SubGenius' && m.until !== 'permanent');
  return temp ? 'inactive' : 'discard';
}

// ---------------------------------------------------------------- . . . Or Kill Me!

function orKillMeAct(s: GameState, pl: string, play: PlotPlay) {
  const victimIll = play.target!;
  const victim = s.cards[victimIll].controller!;
  (s.turnFlags.noActionsExcept ??= []).push(pl);
  log(s, `${player(s, pl).name} demands Slack from ${player(s, victim).name}: ". . . Or Kill Me!"`, pl);
  // Groups nothing but an attack may remove ("Bobbies") cannot be chosen.
  const groups = structureCards(s, victim).filter((g) => g !== victimIll && !HOOKS[s.cards[g].cardId]?.neverDestroyed);
  const options = [
    { id: 'give', label: 'Give up an Illuminati token' },
    ...groups.map((g) => ({ id: `discard:${g}`, label: cardName(s, g) })),
  ];
  askChoice(s, victim, {
    key: 'or-kill-me',
    question: `${player(s, pl).name} plays ". . . Or Kill Me!": give up an Illuminati token, or discard one of your Groups.`,
    options, min: 1, max: 1, data: { asker: pl, victimIll },
  });
}
registerChoice('or-kill-me', {
  resolve(s, victim, picked, data) {
    const asker = data.asker as string;
    if (picked[0] === 'give') {
      s.cards[data.victimIll as string].tokens--;
      s.cards[player(s, asker).illuminati].tokens++;
      log(s, `${player(s, victim).name} gives up an Illuminati token to ${player(s, asker).name}.`, victim);
    } else {
      const g = picked[0].slice('discard:'.length);
      log(s, `${player(s, victim).name} discards ${cardName(s, g)} rather than give up Slack.`, victim);
      discardGroupWithPuppets(s, g);
    }
  },
});

// "He chooses the ones to be discarded" (JHVH-1).
registerChoice('jhvh-1-discard', {
  resolve(s, victim, picked) {
    for (const c of picked) discardCard(s, c);
    log(s, `${player(s, victim).name} discards ${picked.length} Plot${picked.length === 1 ? '' : 's'} to JHVH-1.`, victim);
  },
});

// ---------------------------------------------------------------- Attitude Mutation

/** Its cost, paid as it is played: nothing for a Group the Illuminati controls directly, else its master's action. */
function attitudeMutationPay(s: GameState, pl: string, play: PlotPlay) {
  const ill = player(s, pl).illuminati;
  s.cards[ill].data = { ...s.cards[ill].data, attitudeMutationTurn: s.turn };
  const master = s.cards[play.target!].master!;
  if (master !== ill) s.cards[master].tokens--;
}
function attitudeMutationAct(s: GameState, pl: string, play: PlotPlay) {
  const t = play.target!;
  if (s.cards[t].zone !== 'structure') return;
  const al = play.alignment as Alignment;
  const mode = (play.mode ?? 'add') as 'add' | 'remove' | 'reverse';
  if (mode === 'remove') s.cards[t].mods.push({ source: play.card, kind: 'removeAlign', align: al, until: 'endOfTurn' });
  else if (mode === 'reverse') s.cards[t].mods.push({ source: play.card, kind: 'addAlign', align: OPPOSITE[al]!, until: 'endOfTurn' });
  else s.cards[t].mods.push({ source: play.card, kind: 'addAlign', align: al, until: 'endOfTurn' });
  log(s, `${player(s, pl).name} plays Attitude Mutation on ${cardName(s, t)}.`, pl);
}

// ---------------------------------------------------------------- Excremeditation

const excremeditationEligible = (s: GameState, g: string) =>
  inPlay(s, g) && isGroup(s, g) && attributes(s, g).includes('SubGenius') && s.cards[g].tokens === 0 && !tokenBarred(s, g);

// ---------------------------------------------------------------- Kill "Bob"!

/**
 * RULING: "every player who participated on the attacking side" is the attacker and every player whose
 * aiding Group still counted at the end (Plots alone do not make a participant).
 * Kill "Bob"! stays with its attack (linked to it) and pays out once the attack is over, with the dice as
 * they finally stood: on a success every player on the attacking side (the attacker, and every player
 * whose Group aided and still counted) gets an Illuminati token; the player whose SubGenius Group it was
 * gets one whatever the dice said, if he is the one who played it. A cancelled Kill "Bob"!, or an attack
 * that never came to its dice, gives nothing.
 */
function killBobPayout(s: GameState, self: string, ctx: AttackCtx) {
  const pl = s.cards[self].controller!;
  if (isCancelled(ctx.plays, self) || attackCancelled(ctx) || ctx.illegal) return;
  const winners = new Set<string>();
  if (s.cards[self].data?.killBobOwner === pl) winners.add(pl);
  if (ctx.result === 'success') {
    winners.add(ctx.attackerPlayer);
    const gone = new Set(ctx.illegalGroups ?? []);
    for (const a of ctx.aid) if (a.iid && !gone.has(a.iid) && !ctx.plays.some((p) => !isCancelled(ctx.plays, p.iid) && p.effect.t === 'cancelGroup' && p.effect.group === a.iid)) winners.add(a.player);
  }
  for (const w of winners) if (!player(s, w).eliminated) s.cards[player(s, w).illuminati].tokens++;
  log(s, `Kill "Bob"! gives an Illuminati token to ${[...winners].map((w) => player(s, w).name).join(', ') || 'no one'}.`, pl);
}

// ---------------------------------------------------------------- Comet Hail-"Bob"

function cometHailBobAct(s: GameState, pl: string, play: PlotPlay) {
  const ill = player(s, pl).illuminati;
  s.cards[ill].data = { ...s.cards[ill].data, cometHailBobUsed: true };
  const g = play.target!;
  if (s.cards[g].zone !== 'structure') return;
  // A Group that cannot be destroyed survives it.
  if (abilitiesOf(s, g).some((a) => a.kind === 'cannotBeDestroyed') || anyHook(s, (h, self) => !!h.preventDestroy?.(s, self, g))) {
    log(s, `${cardName(s, g)} cannot be destroyed.`, pl);
    return;
  }
  log(s, `Comet Hail-"Bob" destroys ${cardName(s, g)}, but not for any Goal.`, pl);
  destroyGroup(s, g, pl);
  const credit = player(s, pl).destroyedCredit;
  const at = credit.indexOf(g);
  if (at >= 0) credit.splice(at, 1);
}

// ---------------------------------------------------------------- registration

registerPlots({
  // "You may play this card at any time when you have no Slack . . . Pick a rival who does have Slack.
  // That player must either give you one Illuminati token, or discard a Group from his Power Structure.
  // You cannot take any actions or free moves for the rest of that turn, other than to defend yourself
  // against attacks."
  'or-kill-me': {
    timing: ['anytime'],
    needs: { target: 'rival' },
    check(s, pl, play) {
      const me = player(s, pl);
      if (s.cards[me.illuminati].tokens > 0) return 'You may only play this when your Illuminati has no Slack.';
      const victim = rivalIlluminati(s, pl, play.target);
      if (!victim) return 'Choose a rival Illuminati.';
      if (s.cards[play.target!].tokens < 1) return `${player(s, victim).name}'s Illuminati has no Slack to give up.`;
      return null;
    },
    ...effectNow(orKillMeAct),
  },

  // "The Power for one SubGenius group is increased to 6. Link this card to your chosen SubGenius
  // group. This card may be played at any time, and counts as the action for the group it affects. The
  // increased Power takes effect immediately. No player may have more than one 13013 in play."
  '13013': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'ownGroup' },
    requires: anyOf(targetAction()),
    check(s, pl, play) {
      if (!own(s, pl, play.target) || !isGroup(s, play.target) || !attributes(s, play.target!).includes('SubGenius')) {
        return 'Choose a SubGenius Group you control.';
      }
      if (Object.values(s.cards).some((c) => c.cardId === '13013' && c.zone === 'table' && c.controller === pl && c.linkedTo)) {
        return 'You may only have one 13013 in play.';
      }
      return null;
    },
    ...effectNow((s, _pl, play) => {
      s.cards[play.target!].mods.push({ source: play.card, kind: 'setPower', value: 6, until: 'permanent' });
      s.cards[play.card].linkedTo = play.target;
    }),
    linkLegal: subGeniusLinkLegal,
  },

  // "Play this card at any time, on a rival who has at least two Action tokens on their Illuminati.
  // Remove one of them. No player may be hit by more than one AntiSlack card in a turn."
  'anti-slack': {
    timing: ['anytime'],
    needs: { target: 'rival' },
    check(s, pl, play) {
      const victim = rivalIlluminati(s, pl, play.target);
      if (!victim) return 'Choose a rival Illuminati.';
      const t = s.cards[play.target!];
      if (t.tokens < 2) return `${player(s, victim).name}'s Illuminati needs at least two Slack tokens.`;
      if (t.data?.antiSlackTurn === s.turn) return `${player(s, victim).name} was already hit by an Anti-Slack this turn.`;
      return null;
    },
    ...effectNow((s, _pl, play) => {
      const t = s.cards[play.target!];
      t.tokens--;
      t.data = { ...t.data, antiSlackTurn: s.turn };
    }),
  },

  // "Play this card at any time. You may add, remove or reverse an alignment of any group you control.
  // If the group is directly controlled by the Illuminati, there is no cost to make the change;
  // otherwise, it requires an action from that group's master. The change lasts only for the rest of the
  // current turn. You may play only one Attitude Mutation per turn."
  'attitude-mutation': {
    timing: ['anytime'],
    needs: { target: 'ownGroup', mode: ['add', 'remove', 'reverse'], alignment: true },
    check(s, pl, play) {
      const t = play.target;
      if (!own(s, pl, t) || !isGroup(s, t)) return 'Choose a Group you control.';
      const ill = player(s, pl).illuminati;
      if (s.cards[ill].data?.attitudeMutationTurn === s.turn) return 'You may only play one Attitude Mutation per turn.';
      const al = play.alignment as Alignment | undefined;
      if (!al) return 'Choose an alignment.';
      const mode = (play.mode ?? 'add') as 'add' | 'remove' | 'reverse';
      const current = alignments(s, t!);
      if (mode === 'add' && current.includes(al)) return `${cardName(s, t!)} already has that alignment.`;
      if (mode !== 'add' && !current.includes(al)) return `${cardName(s, t!)} does not have that alignment.`;
      if (mode === 'reverse' && !OPPOSITE[al]) return 'That alignment has no opposite to reverse to.';
      const master = s.cards[t!].master!;
      if (master !== ill && !ready(s, master)) return `${cardName(s, master)} (its master) needs an available action to pay for this.`;
      return null;
    },
    apply(s, pl, play, ctx) { attitudeMutationPay(s, pl, play); if (ctx) attitudeMutationAct(s, pl, play); },
    resolve: attitudeMutationAct,
  },

  // Right after any die roll by anyone (an attack roll, or a card's roll outside an attack, announced as
  // a 'dieRoll' event): that roll becomes a 12. Three other Plots are discarded.
  // A card rolling in the middle of an attack (OPEC, Bill Clinton, Imelda Marcos, Killer Satellite) is
  // reached too: its roll is held in a window of its own (cardRoll) and the attack goes on afterwards.
  bulldada: {
    timing: ['roll', 'event'],
    events: ['dieRoll'],
    requires: anyOf(plotDiscards(3)),
    check(s, _pl, _play, ctx) { return ctx?.roll || cardRollNow(s) ? null : 'Play this right after any die roll.'; },
    // The roll counts as 12; the natural roll (SubGenius glossary) stays what the dice showed.
    apply(s, _pl, _play, ctx) { if (ctx) return { t: 'set', value: 12 }; },
    resolve(s) { setCardRoll(s, 12); },
  },

  // Right after a rival takes control of a Group from his hand or the uncontrolled area, however he does
  // it: an automatic takeover ('takeover' event), a successful Attack to Control on it, or a card putting
  // it into play (both 'gainedControl'). That Group is destroyed, and the destruction counts for no Goal.
  // Costs an Illuminati action or two Church actions; once per game for each player (errata).
  'comet-hail-bob': {
    timing: ['event'],
    events: ['takeover', 'gainedControl'],
    needs: { target: 'anyGroup' },
    requires: anyOf(illuminatiAction(), groupActions({ attributes: ['Church'] }, { count: 2 })),
    check(s, pl, play) {
      const ev = s.window?.kind === 'event' ? s.window.event : undefined;
      if (!ev || (ev.type !== 'takeover' && ev.type !== 'gainedControl')) return 'Play this right after a rival takes control of a Group from his hand or the uncontrolled area.';
      if (!ev.player || ev.player === pl) return "Only against a rival's takeover.";
      if (play.target !== ev.card || def(s, ev.card!).type !== 'Group') return 'Choose the Group that was just taken over.';
      if (s.cards[ev.card!].zone !== 'structure' || s.cards[ev.card!].controller !== ev.player) return 'That Group is no longer in its new Power Structure.';
      const ill = player(s, pl).illuminati;
      if (s.cards[ill].data?.cometHailBobUsed) return 'You may only play Comet Hail-"Bob" once per game.';
      return null;
    },
    ...effectNow(cometHailBobAct),
  },

  // Cancel any action taken by a rival's Weird Group, or aided by one: the whole action is cancelled (an
  // attack with a rival's Weird Group attacking or aiding, or an announced action it takes).
  'decency-is-ok': {
    timing: ['attack', 'event'],
    events: ['action'],
    needs: { target: 'anyGroup' },
    check(s, pl, play, ctx) {
      const t = play.target;
      if (!t || !s.cards[t]) return 'Choose a Group that is acting.';
      const owner = s.cards[t].controller;
      if (!owner || owner === pl) return "Choose a rival's Group.";
      if (!alignments(s, t).includes('Weird')) return `${cardName(s, t)} is not Weird.`;
      if (ctx) {
        if (t !== ctx.attacker && !ctx.aid.some((a) => a.iid === t)) return 'Choose the Group attacking, or aiding the attack.';
      } else {
        const e = announcedAction(s);
        if (!e || !announcedActors(e).includes(t)) return "Use this right after a rival's Weird Group acts.";
      }
      return null;
    },
    apply(s, _pl, play, ctx) {
      if (!ctx) return;
      // The whole attack is cancelled: cancelling its attacking Group (or, with none, the attack) does that.
      return ctx.attacker ? { t: 'cancelGroup', group: ctx.attacker } : { t: 'fail' };
    },
    resolve(s, pl, play) { respondToAction(s, pl, play.card, { t: 'fail' }); void play; },
  },

  // +10 Power or Resistance (player's choice) to a SubGenius Group he controls. With an action (leading an
  // attack as it is declared, or aiding one) it counts for that action only. For defense (the Group being
  // attacked, or one opposing an attack; or played outside an attack, ready for one) it lasts until the end
  // of the turn and never counts for Goals. It counts once per action or defense: one Devival on a Group
  // at a time (and, in an attack, the base rule against two copies of one Plot).
  devival: {
    timing: ['anytime', 'declare', 'attack'],
    needs: { target: 'ownGroup', mode: ['power', 'resistance'] },
    check(s, pl, play, ctx) {
      if (!own(s, pl, play.target) || !isGroup(s, play.target) || !attributes(s, play.target!).includes('SubGenius')) {
        return 'Choose a SubGenius Group you control.';
      }
      const t = play.target!;
      const mode = play.mode ?? 'power';
      if (s.cards[t].mods.some((m) => m.until === 'endOfTurn' && s.cards[m.source]?.cardId === 'devival' && m.kind === (mode === 'power' ? 'power' : 'resistance'))) {
        return `${cardName(s, t)} already has a Devival bonus of that kind this turn.`;
      }
      if (!ctx) return null;
      if (ctx.instant) return "Too late: an Instant attack uses the target's Power at the moment it was played.";
      if (mode === 'power') {
        const leading = ctx.attacker === t && !s.window;
        const aiding = ctx.aid.some((a) => a.iid === t);
        const opposing = ctx.oppose.some((o) => o.iid === t && t !== ctx.target);
        if (!leading && !aiding && !opposing) return 'A Power boost goes on the attacker as the attack is declared, on a Group aiding it, or on a Group opposing it.';
      } else if (ctx.target !== t) return 'A Resistance boost goes on the Group being attacked.';
      return null;
    },
    apply(s, pl, play, ctx) {
      if (!ctx) return;
      const t = play.target!;
      const mode = play.mode ?? 'power';
      if (mode === 'power' && (ctx.attacker === t || ctx.aid.some((a) => a.iid === t))) {
        ctx.attackBonus.push({ player: pl, plot: play.card, forGroup: t, amount: 10, label: def(s, play.card).name });
        return;
      }
      devivalDefense(s, play);
    },
    resolve(s, _pl, play) { devivalDefense(s, play); },
  },

  // "Play this card at any time. Draw enough new Plots to fill your hand out to 5. You may only play
  // this card once per game. It requires an action from one SubGenius group."
  'eternal-salvation-or-triple-your-money-back': {
    timing: ['anytime'],
    requires: anyOf(groupActions({ attributes: ['SubGenius'] })),
    check(s, pl) {
      const ill = player(s, pl).illuminati;
      if (s.cards[ill].data?.eternalSalvationUsed) return 'You may only play this once per game.';
      return null;
    },
    ...effectNow((s, pl) => {
      const ill = player(s, pl).illuminati;
      s.cards[ill].data = { ...s.cards[ill].data, eternalSalvationUsed: true };
      const n = Math.max(0, 5 - plotsInHand(s, pl).length);
      if (n) drawPlot(s, player(s, pl), n);
      log(s, `${player(s, pl).name} draws back up to 5 Plots.`, pl);
    }),
  },

  // "Place an Action token on any SubGenius group, or on two or more SubGenius groups whose Power adds
  // up to 5 or less. This card may not benefit a group that already has any tokens, or a group which is
  // suffering from any effect that prevents it from getting Action tokens. This card may be played at
  // any time. It requires an action from your Illuminati."
  excremeditation: {
    timing: ['anytime'],
    needs: { targets: true },
    requires: anyOf(illuminatiAction()),
    check(s, _pl, play) {
      const t = play.targets ?? [];
      if (!t.length || new Set(t).size !== t.length) return 'Choose one or more SubGenius Groups without a token.';
      if (!t.every((g) => excremeditationEligible(s, g))) return 'Choose SubGenius Groups in play with no Action token, able to receive one.';
      if (t.length > 1 && totalPower(s, t) > 5) return 'Several Groups together may add up to 5 Power in total.';
      return null;
    },
    ...effectNow((s, _pl, play) => { for (const g of play.targets ?? []) giveToken(s, g); }),
  },

  // "Play this card on your turn to reduce the Resistance of any group in the uncontrolled area (or in
  // your hand) to 0 until the end of the current turn."
  'fake-healing': {
    timing: ['anytime'],
    needs: { target: 'anyGroup' },
    check(s, pl, play) {
      if (s.phase !== 'main' || activePlayer(s).id !== pl) return 'Only on your own turn.';
      const t = play.target;
      const c = t ? s.cards[t] : undefined;
      if (!c || !isGroup(s, t)) return 'Choose a Group in the uncontrolled area or in your hand.';
      const inArea = c.zone === 'uncontrolled';
      const inHand = c.zone === 'hand' && player(s, pl).hand.includes(t!);
      if (!inArea && !inHand) return 'Choose a Group in the uncontrolled area or in your hand.';
      return null;
    },
    ...effectNow((s, _pl, play) => {
      s.cards[play.target!].mods.push({ source: play.card, kind: 'setResistance', value: 0, lower: true, until: 'endOfTurn' });
    }),
  },

  // "Play this card at any time except during an attack. Link it to any Personality in play, either
  // uncontrolled or controlled by any player. Increase his Power to 3, but he becomes Violent and
  // Straight! . . . This card cannot affect someone who is already an OverMan."
  'false-overman': {
    timing: ['anytime'],
    needs: { target: 'personality' },
    check(s, _pl, play, ctx) {
      if (ctx) return 'Not during an attack.';
      const t = play.target;
      if (!inPlay(s, t) || def(s, t!).subtype !== 'Personality') return 'Choose a Personality in play.';
      if (s.cards[t!].cardId === 'overman-philo-drummond') return 'OverMan Philo Drummond cannot become a False OverMan.';
      if (Object.values(s.cards).some((c) => c.zone === 'table' && c.linkedTo === t && c.cardId === 'overman')) {
        return `${cardName(s, t!)} is already an OverMan.`;
      }
      return null;
    },
    // Adding Violent and Straight takes away Peaceful and Weird (an alignment and its opposite never coexist).
    ...effectNow((s, _pl, play) => {
      const t = play.target!;
      s.cards[t].mods.push({ source: play.card, kind: 'setPower', value: 3, until: 'permanent' });
      s.cards[t].mods.push({ source: play.card, kind: 'addAlign', align: 'Violent', until: 'permanent' });
      s.cards[t].mods.push({ source: play.card, kind: 'addAlign', align: 'Straight', until: 'permanent' });
      s.cards[play.card].linkedTo = t;
    }),
  },

  // "Play this card at any time. Choose one Group (other than an Illuminati) controlled by a rival.
  // Remove all its Action tokens, and those on its puppets, and their puppets, and so on. This requires
  // an action from your Illuminati. No one may be hit with more than one False Slack in a single turn."
  'false-slack': {
    timing: ['anytime'],
    needs: { target: 'rivalGroup' },
    requires: anyOf(illuminatiAction()),
    check(s, pl, play) {
      const t = play.target;
      if (!t || !isGroup(s, t) || s.cards[t].zone !== 'structure' || s.cards[t].controller === pl) return "Choose a rival's Group.";
      const victim = s.cards[t].controller!;
      if (s.cards[player(s, victim).illuminati].data?.falseSlackTurn === s.turn) return `${player(s, victim).name} was already hit by False Slack this turn.`;
      return null;
    },
    ...effectNow((s, pl, play) => {
      const t = play.target!;
      const ill = s.cards[player(s, s.cards[t].controller!).illuminati];
      ill.data = { ...ill.data, falseSlackTurn: s.turn };
      for (const iid of subtree(s, t)) s.cards[iid].tokens = 0;
      log(s, `False Slack empties the Action tokens of ${cardName(s, t)} and its puppets.`, pl);
    }),
  },

  // "Play this card immediately after you use a Plot. Discard this card instead, plus one other, and
  // put the first Plot back into your hand."
  'give-me-slack-or-give-me-food': {
    timing: ['counter'],
    requires: anyOf(plotDiscards(1)),
    check(s, pl) {
      if (s.window?.kind !== 'plot') return 'Play this right after you play a Plot.';
      if (s.window.plot!.player !== pl) return 'You may only take back one of your own Plots.';
      return null;
    },
    apply(s, pl) {
      const original = s.window!.plot!.iid;
      const c = s.cards[original];
      c.zone = 'hand'; c.controller = undefined; c.linkedTo = undefined;
      player(s, pl).hand.push(original);
      log(s, `${player(s, pl).name} takes ${cardName(s, original)} back into hand instead of using it.`, pl);
      return { t: 'cancelPlot', target: original };
    },
  },

  // "Play this card at any time: a Group's Global Power becomes equal to its permanent Power. Link this
  // card to the group. This requires an action from the affected group and discarding two other Plots."
  'head-launching': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'ownGroup' },
    check(s, pl, play) {
      if (!own(s, pl, play.target) || !isGroup(s, play.target)) return 'Choose a Group you control.';
      if (!ready(s, play.target)) return 'That Group needs an available action.';
      const discards = play.discards ?? [];
      const hand = player(s, pl).hand;
      if (discards.length !== 2 || new Set(discards).size !== 2 || discards.some((c) => c === play.card || !hand.includes(c) || def(s, c).type !== 'Plot')) {
        return 'Discard two other Plot cards from your hand.';
      }
      return null;
    },
    apply(s, _pl, play, ctx) {
      s.cards[play.target!].tokens--;
      for (const c of play.discards!) discardCard(s, c);
      noteCostDiscard(s, _pl, [{ kind: 'plot', place: 'hand', cards: play.discards! }]);
      if (ctx) s.cards[play.card].linkedTo = play.target;
    },
    resolve(s, _pl, play) { s.cards[play.card].linkedTo = play.target; },
  },

  // "Play this card at any time, except during an attack, on any Church of the SubGenius Illuminati
  // which has no SubGenius groups in its Power Structure. They lose one Illuminati token. No player may
  // be hit by more than one Inherently Bogus card in a turn."
  'inherently-bogus': {
    timing: ['anytime'],
    needs: { target: 'rival' },
    check(s, pl, play, ctx) {
      if (ctx) return 'Not during an attack.';
      const victim = rivalIlluminati(s, pl, play.target);
      if (!victim) return 'Choose a rival Illuminati.';
      const t = s.cards[play.target!];
      if (t.cardId !== 'church-of-the-subgenius') return 'Choose a Church of the SubGenius Illuminati.';
      if (structureCards(s, victim).some((g) => attributes(s, g).includes('SubGenius'))) return `${player(s, victim).name} controls a SubGenius Group.`;
      if (t.data?.bogusTurn === s.turn) return `${player(s, victim).name} was already hit by Inherently Bogus this turn.`;
      if (t.tokens < 1) return `${player(s, victim).name}'s Illuminati has no Slack to lose.`;
      return null;
    },
    ...effectNow((s, _pl, play) => {
      const t = s.cards[play.target!];
      t.tokens--;
      t.data = { ...t.data, bogusTurn: s.turn };
    }),
  },

  // "Play this card on a rival at any time. He must immediately discard half of his Plots (round up). He
  // chooses the ones to be discarded. This requires an action from your Illuminati."
  'jhvh-1': {
    timing: ['anytime'],
    needs: { target: 'rival' },
    requires: anyOf(illuminatiAction()),
    check(s, pl, play) {
      const victim = rivalIlluminati(s, pl, play.target);
      if (!victim) return 'Choose a rival Illuminati.';
      if (!plotsInHand(s, victim).length) return `${player(s, victim).name} has no Plots to discard.`;
      return null;
    },
    ...effectNow((s, _pl, play) => {
      const victim = s.cards[play.target!].controller!;
      const hand = plotsInHand(s, victim);
      const n = Math.ceil(hand.length / 2);
      askChoice(s, victim, {
        key: 'jhvh-1-discard',
        question: `JHVH-1 forces you to discard ${n} Plot card${n === 1 ? '' : 's'}. Choose which.`,
        options: hand.map((c) => ({ id: c, label: cardName(s, c) })),
        min: n, max: n,
      });
    }),
  },

  // Played during an Attack to Destroy on a SubGenius Group (not an Instant attack, which only cards
  // naming Instant attacks affect), before or after the roll; it pays out after the dice, once the attack
  // is over (killBobPayout). Once per turn for each player.
  'kill-bob': {
    timing: ['attack', 'roll'],
    linked: true,
    check(s, pl, _play, ctx) {
      if (!ctx || ctx.type !== 'destroy' || ctx.instant) return 'Play this during an Attack to Destroy.';
      if (!attributes(s, ctx.target).includes('SubGenius')) return 'The target must be a SubGenius Group.';
      const ill = player(s, pl).illuminati;
      if (s.cards[ill].data?.killBobTurn === s.turn) return 'You may only play Kill "Bob"! once per turn.';
      return null;
    },
    apply(s, pl, play, ctx) {
      if (!ctx) return;
      const ill = player(s, pl).illuminati;
      s.cards[ill].data = { ...s.cards[ill].data, killBobTurn: s.turn };
      // Whose SubGenius Group it was when the card was played.
      s.cards[play.card].data = { ...s.cards[play.card].data, killBobOwner: ctx.targetPlayer };
      s.cards[play.card].linkedTo = `attack:${ctx.id}`;
    },
  },

  // Right after any die roll by anyone (an attack roll, or a card's roll outside an attack): that roll
  // becomes a 2. An attack of strength below 2 is never rolled, so it cannot help one.
  // Three other Plots are discarded.
  'luck-plane': {
    timing: ['roll', 'event'],
    events: ['dieRoll'],
    requires: anyOf(plotDiscards(3)),
    check(s, _pl, _play, ctx) { return ctx?.roll || cardRollNow(s) ? null : 'Play this right after any die roll.'; },
    apply(s, _pl, _play, ctx) { if (ctx) return { t: 'set', value: 2 }; },
    resolve(s) { setCardRoll(s, 2); },
  },

  // "Play this card at any time on any SubGenius group to remove that attribute until the end of the
  // current turn."
  mediocretinism: {
    timing: ['anytime'],
    needs: { target: 'anyGroup' },
    check(s, _pl, play) {
      const t = play.target;
      if (!inPlay(s, t) || !isGroup(s, t) || !attributes(s, t!).includes('SubGenius')) return 'Choose a SubGenius Group in play.';
      return null;
    },
    ...effectNow((s, _pl, play) => {
      s.cards[play.target!].mods.push({ source: play.card, kind: 'removeAttr', attr: 'SubGenius', until: 'endOfTurn' });
    }),
  },

  // "Play this card at any time. Each player must draw a Group and add it to the uncontrolled area. In
  // standard INWO, he must draw a Group, show it to you and add it to his own hand."
  'miraculous-manifestation': {
    timing: ['anytime'],
    check() { return null; },
    ...effectNow((s, pl) => {
      for (const p of s.players) {
        if (p.eliminated) continue;
        const drawn = drawGroup(s, p);
        if (!sgRules(s) && p.id !== pl && drawn.length) revealTo(s, pl, drawn, `${p.name} draws a Group`);
      }
      log(s, 'Miraculous Manifestation makes every player draw a Group.', pl);
    }),
  },

  // At any time, for one Slack (Illuminati token): its player exposes all his own Plots. Once per game
  // for each player.
  'more-slack': {
    timing: ['anytime'],
    check(s, pl) {
      const ill = player(s, pl).illuminati;
      if (s.cards[ill].tokens < 1) return 'Your Illuminati needs a Slack token to spend.';
      if (s.cards[ill].data?.moreSlackUsed) return 'You may only play More Slack once per game.';
      return null;
    },
    // Its price, one Slack, is paid as it is played.
    apply(s, pl, play, ctx) {
      const ill = player(s, pl).illuminati;
      s.cards[ill].tokens--;
      s.cards[ill].data = { ...s.cards[ill].data, moreSlackUsed: true };
      if (ctx) moreSlackAct(s, pl, play);
    },
    resolve: (s, pl, play) => moreSlackAct(s, pl, play),
  },

  // "Play this card at any time. Link it to any SubGenius Personality. It gains Global Power equal to
  // its Permanent Power. This costs that Personality's action."
  'nental-ife': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'ownGroup' },
    requires: anyOf(targetAction()),
    check(s, pl, play) {
      const t = play.target;
      if (!own(s, pl, t) || def(s, t!).subtype !== 'Personality' || !attributes(s, t!).includes('SubGenius')) {
        return 'Choose a SubGenius Personality you control.';
      }
      return null;
    },
    ...effectNow((s, _pl, play) => { s.cards[play.card].linkedTo = play.target; }),
    linkLegal: subGeniusLinkLegal,
  },

  // "Play this card when any attack is made against a Personality, before the dice are rolled. That
  // attack becomes a failure."
  'official-all-inclusive-divine-excuse': {
    timing: ['attack'],
    check(s, _pl, _play, ctx) {
      if (!ctx || s.window?.kind !== 'attack') return 'Play this before the dice are rolled.';
      if (def(s, ctx.target).subtype !== 'Personality') return 'The attack must target a Personality.';
      return null;
    },
    apply(s, _pl, _play, ctx) { if (ctx) return { t: 'fail' }; },
  },
});

// nental-ife and head-launching: Global Power equal to the linked Group's Permanent Power (its Power
// without changes that last only for a turn or an attack; stats.ts, globalEqualsPower).
registerHooks({
  'nental-ife': { globalEqualsPower: (s, self, iid) => (s.cards[self].linkedTo === iid ? 'permanent' : undefined) },
  'head-launching': { globalEqualsPower: (s, self, iid) => (s.cards[self].linkedTo === iid ? 'permanent' : undefined) },
  'kill-bob': {
    onAttackEnd(s, self, ctx) {
      if (s.cards[self].linkedTo !== `attack:${ctx.id}` || s.cards[self].zone !== 'table') return;
      killBobPayout(s, self, ctx);
      discardCard(s, self);
    },
  },
});

function moreSlackAct(s: GameState, pl: string, play: PlotPlay) {
  const shown = exposeCards(s, plotsInHand(s, pl).filter((c) => c !== play.card));
  log(s, `${player(s, pl).name} exposes ${shown.map((c) => cardName(s, c)).join(', ') || 'no Plots'}.`, pl);
}

/** Devival used for defense: +10 Power or Resistance until the end of the turn, for defense only, never for Goals. */
function devivalDefense(s: GameState, play: PlotPlay) {
  s.cards[play.target!].mods.push({
    source: play.card, kind: play.mode === 'resistance' ? 'resistance' : 'power', value: 10,
    defenseOnly: true, until: 'endOfTurn', countsForGoals: false, ...(play.mode === 'resistance' ? {} : { forOpposing: true }),
  });
}

/** A card's roll outside an attack waiting for answers (a 'dieRoll' event), if there is one right now. */
function cardRollNow(s: GameState) {
  const e = eventAnswered(s);
  return e?.type === 'dieRoll' ? e : undefined;
}
/** That roll now counts as `total` (its natural roll, the dice shown, is unchanged). */
function setCardRoll(s: GameState, total: 2 | 12) {
  const e = cardRollNow(s);
  if (e) changeRoll(e, { set: total });
}
