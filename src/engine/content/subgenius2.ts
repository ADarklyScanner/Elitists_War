// SubGenius pack, batch subgenius2: the Church's early Personalities, its Places, its Gadgets and
// Artifacts, and its Goal cards. See docs/CARD_SCRIPTING.md, "Expansions", and docs/EXPANSIONS.md.
import type { AttackCtx, GameState } from '../types';
import { RuleError } from '../types';
import { registerAbilities, attackingGroups } from '../abilities';
import { HOOKS, registerHooks } from '../hooks';
import { registerPlots, registerGoals, registerGoalProgress, registerGoalExposeBonus } from '../plotTypes';
import { def, cardName } from '../cards';
import { alignments, attributes, power } from '../stats';
import { openArrows, outSides, structureCards, subtree } from '../geometry';
import {
  activePlayer, askChoice, cardRoll, changeRoll, controllerOf2, discardCard, drawGroup, drawPlot, endTurnAtOnce, eventAnswered, finalDice, goalCount,
  goalNeeded, livePlayers, log, moveSubtree, movableSides, player, plotsInHand, registerRollResult, resourcesOf, revealTo, tokenBarred,
} from '../game';
import { registerChoice } from '../hooks';
import { plotDeckOf, groupDeckOf, sgRules } from '../expansions';
import { PLOTS } from '../plotTypes';
import type { GameEvent } from '../types';

// ---------------------------------------------------------------- shared helpers

const inPlay = (s: GameState, iid?: string) => !!iid && (s.cards[iid]?.zone === 'structure' || s.cards[iid]?.zone === 'uncontrolled');
const isGroup = (s: GameState, iid?: string) => !!iid && !!s.cards[iid] && def(s, iid).type === 'Group';
const active = (s: GameState, self: string) => s.cards[self]?.zone === 'resources' && !!s.cards[self].controller && !s.cards[self].hiddenUnder;
const linked = (s: GameState, self: string) => s.cards[self].linkedTo;
/** Is `child` somewhere under `master` in the same Power Structure (its own puppets, and theirs, and so on)? */
function isUnder(s: GameState, master: string, child: string): boolean {
  let c = s.cards[child];
  while (c?.master) { if (c.master === master) return true; c = s.cards[c.master]; }
  return false;
}

// =================================================================== Groups

registerAbilities({
  'www-subgenius-com': [],
  'connie-dobbs': [],
  'dr-k-taden-legume': [],
  'jesus-b': [],
  'nhgh': [{ kind: 'cannotBeDestroyed' }],
  'overman-philo-drummond': [],
  'reverend-ivan-stang': [],
  'st-janor-hypercleats': [],
  'frop-farm': [],
  'dallas-catacombs': [],
  'dobbstown': [{ kind: 'attackBonus', on: 'control', target: { attributes: ['SubGenius'], subtypes: ['Personality'] }, value: 5, scope: 'any' }],
  'dokstok': [],
  'saucer-landing-strip': [],
});

registerHooks({
  // At the start of each of the controller's turns he may draw an extra Group into the uncontrolled
  // area (with his normal draws, whatever the area holds; a person may decline it like any draw); in a
  // game with no uncontrolled area its action buys a Group draw instead (the printed alternative).
  'www-subgenius-com': {
    extraGroupDraws: (s) => (sgRules(s) ? 1 : 0),
    actions: [{
      id: 'draw-group', label: 'Spend its action to draw a Group card', timing: ['anytime'], usesToken: true, ai: 'draw',
      check(s) { return sgRules(s) ? 'Only in a game with no uncontrolled area.' : null; },
      apply(s, pl) { drawGroup(s, player(s, pl)); },
    }],
  },

  // Neither Connie nor any Group she controls can be destroyed while she is both Straight and SubGenius
  // (an alignment or attribute change from another card ends the protection at once). As for any
  // undestroyable Group, no Attack to Destroy may even be made on them, Instant attacks included (card
  // FAQ, "Undestroyable Groups"); Schizm still may.
  // RULING: "any group she controls" is every Group below her, her puppets' puppets too: in INWO a
  // Group controls everything beneath it, as the Illuminati controls its whole Power Structure.
  'connie-dobbs': {
    forbidIsImmunity: true,
    preventDestroy: (s, self, target) => connieShields(s, self, target),
    forbidAttack(s, self, _attacker, target, type) {
      return type === 'destroy' && connieShields(s, self, target) ? `${cardName(s, target)} cannot be destroyed while Connie Dobbs is Straight and SubGenius.` : null;
    },
    immune(s, self, target, source) {
      return def(s, source).type === 'Plot' && !!PLOTS[def(s, source).id]?.timing.includes('instant') && connieShields(s, self, target);
    },
  },

  // Nobody (his own controller included) may make any kind of attack on another SubGenius Personality
  // of Legume's controller while he stays SubGenius and in play: attacks by Groups, and Instant attacks
  // (Plots that launch one). Other Plots and abilities are not attacks and still reach them.
  'dr-k-taden-legume': {
    immune(s, self, target, source) {
      if (target === self || !attributes(s, self).includes('SubGenius')) return false;
      const ctl = controllerOf2(s, self);
      if (!ctl || controllerOf2(s, target) !== ctl) return false;
      if (def(s, target).subtype !== 'Personality' || !attributes(s, target).includes('SubGenius')) return false;
      const src = s.cards[source];
      if (!src) return false;
      const d = def(s, source);
      if (d.type === 'Plot') return !!PLOTS[d.id]?.timing.includes('instant');
      return d.type === 'Group' || d.type === 'Illuminati';
    },
  },

  // A once-per-game bonus token for the mock "send a dollar" ritual; a real transaction is flavor,
  // not something the engine can verify, so using the ability is itself the whole cost.
  'jesus-b': {
    actions: [{
      id: 'buy-slack', label: 'Buy one Slack for your Illuminati', timing: ['anytime'], usesToken: false, ai: 'free',
      check(s, _pl, self) { return s.cards[self].data?.boughtSlack ? 'Already used once this game.' : null; },
      apply(s, pl, self) {
        s.cards[self].data = { ...s.cards[self].data, boughtSlack: true };
        s.cards[player(s, pl).illuminati].tokens++;
        log(s, `${cardName(s, self)} buys one Slack for the Illuminati (the traditional dollar in the mail).`, pl);
      },
    }],
  },

  // Cannot be destroyed. Nobody but a player who has exposed The Anti"Bob" may take it over. While it
  // sits uncontrolled, its Power of 5 helps any Attack to Destroy, anywhere. In a mixed game there is no
  // uncontrolled area for it to sit in: it may instead be played from hand as a one-off +5 to an Attack
  // to Destroy on a rival's Group, after which it becomes that rival's card (the printed alternative).
  'nhgh': {
    activeUncontrolled: true,
    forbidIsImmunity: true,
    rulesOffTable: true,
    forbidAttack(s, self, _attacker, target, type, attackerPlayer) {
      if (target !== self || (type !== 'control' && type !== 'takeover')) return null;
      return exposedAntiBob(s, attackerPlayer) ? null : `${cardName(s, self)} can only be controlled by a player who has exposed The Anti"Bob".`;
    },
    attackMod(s, self, ctx, side) {
      if (side !== 'attack' || ctx.type !== 'destroy' || s.cards[self].zone !== 'uncontrolled') return 0;
      return 5;
    },
  },

  // Every Weird Group he controls (directly or through his puppets) is SubGenius; OverMan and False
  // OverMan never affect him (both cards refuse him, see subgenius3.ts and subgenius4.ts).
  'overman-philo-drummond': {
    attributeMod(s, self, iid, current) {
      if (current.includes('SubGenius') || !isUnder(s, self, iid)) return current;
      return alignments(s, iid).includes('Weird') ? [...current, 'SubGenius'] : current;
    },
    immune(s, self, target, source) {
      return target === self && (s.cards[source]?.cardId === 'overman' || s.cards[source]?.cardId === 'false-overman');
    },
  },

  // His token may go to any other SubGenius Group in play (anyone's) that has none.
  'reverend-ivan-stang': {
    actions: [{
      id: 'give-token', label: 'Give his Action token to another SubGenius Group with none', timing: ['anytime'], usesToken: true,
      needs: { target: 'group' }, ai: 'free',
      check(s, _pl, self, p) {
        const t = p.target ? s.cards[p.target] : undefined;
        if (!t || t.iid === self || t.zone !== 'structure' || def(s, t.iid).type !== 'Group') return 'Choose another SubGenius Group in play.';
        if (!attributes(s, p.target!).includes('SubGenius')) return 'Choose a SubGenius Group.';
        if (t.tokens > 0 || t.heldTokens) return 'That Group already has an Action token.';
        if (tokenBarred(s, t.iid)) return 'That Group cannot receive Action tokens.';
        return null;
      },
      apply(s, pl, self, p) {
        s.cards[p.target!].tokens++;
        log(s, `${cardName(s, self)} gives his Action token to ${cardName(s, p.target!)}.`, pl);
      },
    }],
  },

  // A natural 11 in an attack he makes or aids does not fail automatically; a natural 2 counts as 12
  // instead, and costs his Illuminati one token (if it has any). He may attack, or help attack, Secret
  // Groups whatever their alignments (R014 does not apply to him).
  'st-janor-hypercleats': {
    noAutoFail11: (s, self, ctx) => attackingGroups(ctx).includes(self),
    secretOverride: (s, self, group) => group === self,
    beforeAttackResult(s, self, ctx) {
      if (!attackingGroups(ctx).includes(self)) return;
      const dice = finalDice(ctx);
      if (!dice || dice[0] + dice[1] !== 2) return;
      if (ctx.plays.some((pp) => pp.ability === self)) return; // only once per attack
      const pl = controllerOf2(s, self);
      if (!pl) return;
      ctx.plays.push({ iid: `ability:${self}:natural-two:${s.version}`, player: pl, play: { card: self }, effect: { t: 'set', value: 12 }, ability: self });
      const ill = player(s, pl).illuminati;
      if (s.cards[ill].tokens > 0) {
        s.cards[ill].tokens--;
        log(s, `${cardName(s, self)} rolls a natural 2, which counts as a 12; ${player(s, pl).name}'s Illuminati loses an Action token.`, pl);
      } else log(s, `${cardName(s, self)} rolls a natural 2, which counts as a 12.`, pl);
    },
  },

  'frop-farm': {
    actions: [{
      id: 'strip', label: 'Remove every Action token from a Personality', timing: ['anytime'], usesToken: true, needs: { target: 'personality' }, ai: 'never',
      check(s, _pl, _self, p) {
        if (!p.target || def(s, p.target).subtype !== 'Personality' || !inPlay(s, p.target)) return 'Choose a Personality in play.';
        return null;
      },
      apply(s, _pl, _self, p) { s.cards[p.target!].tokens = 0; },
    }],
  },

  // Every Group of its controller may hang on any side of its master, whenever it enters his Power
  // Structure or is moved (automatic takeover, capture, move; its own puppets keep their sides too), up
  // to the master's number of outgoing arrows (freeArrows, read by game.ts). "Moved to any other side of
  // that card at any time" is its own ability: turning a Group to another side of the same master costs
  // no action and may be done whenever its controller may act. Losing the Catacombs, he puts every Group
  // back on a real arrow of its master (his choice of arrow, free); one that no longer fits is discarded.
  'dallas-catacombs': {
    freeArrows: (s, self, master) => s.cards[master]?.controller === controllerOf2(s, self),
    onDestroy(s, self, victim) { if (victim === self) untangleCatacombs(s, s.cards[self].controller); },
    onCapture(s, self, victim, _by, from) { if (victim === self && from) untangleCatacombs(s, from); },
    actions: [{
      id: 'turn-side', label: 'Turn one of your Groups to another side of its master', timing: ['anytime'], usesToken: false,
      needs: { target: 'ownGroup', modes: ['TOP', 'RIGHT', 'BOTTOM', 'LEFT'] }, ai: 'never',
      check(s, pl, _self, p) {
        const g = p.target;
        const c = g ? s.cards[g] : undefined;
        if (!c || c.zone !== 'structure' || c.controller !== pl || !c.master) return 'Choose one of your Groups (not your Illuminati).';
        if (!['TOP', 'RIGHT', 'BOTTOM', 'LEFT'].includes(p.mode ?? '') || p.mode === c.side) return 'Choose another side of its master.';
        if (!movableSides(s, pl, g!, c.master).includes(p.mode as never)) return 'That side of its master is not free.';
        return null;
      },
      apply(s, pl, _self, p) {
        const g = p.target!;
        moveSubtree(s, g, pl, s.cards[g].master!, p.mode as never, 'hand');
        log(s, `${cardName(s, g)} turns to another side of ${cardName(s, s.cards[g].master!)}.`, pl);
      },
    }],
  },

  // At token placement its controller's Illuminati gets one extra token that he may not use himself: before
  // doing anything else he gives it to another player's Illuminati or throws it away (a question he must
  // answer at once). RULING: "traded" is the same gift made as his side of a bargain struck at the table;
  // what he asks in return is up to the players, as the card invites.
  'dokstok': {
    onTokensPlaced(s, self, active) {
      const pl = controllerOf2(s, self);
      if (!pl || pl !== active || s.turnFlags.extraTurn) return;
      const rivals = livePlayers(s).filter((x) => x.id !== pl);
      askChoice(s, pl, {
        key: 'dokstok-token', source: self,
        question: 'Dokstok: your extra token must go to another player\'s Illuminati, or be thrown away. Who gets it?',
        options: [...rivals.map((r) => ({ id: r.id, label: `Give it to ${r.name}` })), { id: 'discard', label: 'Throw it away' }],
        min: 1, max: 1, data: {},
      });
    },
  },

  'saucer-landing-strip': {
    actions: [{
      id: 'trade', label: "Trade this Group's Action token for two Plots", timing: ['anytime'], usesToken: true, ai: 'draw',
      check(s, pl) { return plotsInHand(s, pl).length ? 'You must hold no Plot cards.' : null; },
      apply(s, pl) { drawPlot(s, player(s, pl), 2); },
    }],
  },
});

/** Is `target` Connie Dobbs, or a Group below her, while she is Straight and SubGenius? */
function connieShields(s: GameState, self: string, target: string): boolean {
  if (target !== self && !isUnder(s, self, target)) return false;
  return alignments(s, self).includes('Straight') && attributes(s, self).includes('SubGenius');
}

/** Has this player exposed The Anti"Bob" (in hand, and shown)? */
function exposedAntiBob(s: GameState, pl: string): boolean {
  return player(s, pl).hand.some((iid) => s.cards[iid].cardId === 'the-anti-bob' && s.cards[iid].exposed);
}

/**
 * Losing the Catacombs (destroyed or captured): every Group of `controller` sitting on a side that is not
 * really one of its master's outgoing arrows goes onto a real arrow of the same master, as a free move
 * (shallowest first, so a master is put right before its puppets are looked at). Its controller picks the
 * arrow; one that no longer fits is discarded with its own puppets. Every placement is asked as a choice,
 * so it happens once the Catacombs have really left (their own rule no longer applies).
 */
function untangleCatacombs(s: GameState, controller: string | undefined) {
  if (!controller || player(s, controller).eliminated) return;
  const depthOf = (iid: string) => { let d = 0, c = s.cards[iid]; while (c.master) { d++; c = s.cards[c.master]; } return d; };
  const wrong = structureCards(s, controller)
    .filter((iid) => { const c = s.cards[iid]; return !!c.master && !(c.side && outSides(s, c.master).includes(c.side)); })
    .sort((a, b) => depthOf(a) - depthOf(b));
  for (const iid of wrong) {
    const c = s.cards[iid];
    const open = openArrows(s, c.master!, new Set(subtree(s, iid)));
    if (!open.length) {
      log(s, `${cardName(s, iid)} no longer fits in the Power Structure and is discarded.`, controller);
      for (const g of subtree(s, iid)) discardCard(s, g);
      continue;
    }
    askChoice(s, controller, {
      key: 'catacombs-untangle',
      question: `The Dallas Catacombs are gone: put ${cardName(s, iid)} on a real control arrow of ${cardName(s, c.master!)}.`,
      options: open.map((side) => ({ id: side, label: `${side.toLowerCase()} arrow` })), min: 1, max: 1, data: { controller, group: iid },
    });
    return; // the rest waits for this answer
  }
}

registerChoice('catacombs-untangle', {
  resolve(s, pl, picked, data) {
    const g = data.group as string;
    const c = s.cards[g];
    if (c?.zone === 'structure' && c.controller === pl && c.master) {
      const open = openArrows(s, c.master, new Set(subtree(s, g)));
      const side = open.includes(picked[0] as never) ? picked[0] : open[0];
      if (side) {
        moveSubtree(s, g, pl, c.master, side as never, 'discard');
        log(s, `${cardName(s, g)} goes back onto a real control arrow of ${cardName(s, c.master)}.`, pl);
      } else for (const x of subtree(s, g)) discardCard(s, x);
    }
    untangleCatacombs(s, data.controller as string);
  },
});

registerChoice('dokstok-token', {
  // A computer player keeps its rivals from getting stronger.
  ai: () => ['discard'],
  resolve(s, pl, picked) {
    const to = s.players.find((x) => x.id === picked[0] && x.id !== pl && !x.eliminated);
    if (!to) { log(s, `${player(s, pl).name} throws Dokstok's extra token away.`, pl); return; }
    s.cards[to.illuminati].tokens++;
    log(s, `${player(s, pl).name} gives Dokstok's extra token to ${to.name}'s Illuminati.`, pl);
  },
});

/** A natural 11 or 12 on two dice by the Janor Device's holder: his turn ends if it was his; the rivals roll off for it. */
function janorNatural(s: GameState, self: string, pl: string, dice: number[]) {
  const raw = dice[0] + dice[1];
  if (raw !== 11 && raw !== 12) return;
  log(s, `${cardName(s, self)}: ${player(s, pl).name} rolled a natural ${raw} and must give it away.`, pl);
  if (activePlayer(s).id === pl) endTurnAtOnce(s);
  const rivals = livePlayers(s).filter((x) => x.id !== pl).map((x) => x.id);
  if (!rivals.length) return;
  janorRollNext(s, { device: self, from: pl, round: rivals, i: 0, results: {} });
}

interface JanorRollOff { device: string; from: string; round: string[]; i: number; results: Record<string, number> }

/** The roll-off for the Janor Device: each rival in turn rolls two dice (an announced roll others may change). */
function janorRollNext(s: GameState, r: JanorRollOff) {
  if (r.i < r.round.length) { cardRoll(s, r.round[r.i], 2, 'janor-rolloff', { rollOff: r }); return; }
  const best = Math.max(...r.round.map((id) => r.results[id]));
  const tied = r.round.filter((id) => r.results[id] === best);
  if (tied.length > 1) { log(s, 'The Janor Device roll-off is tied: those players roll again.'); janorRollNext(s, { ...r, round: tied, i: 0, results: {} }); return; }
  const winner = player(s, tied[0]);
  const dev = s.cards[r.device];
  if (dev.zone !== 'resources') return;
  Object.assign(dev, { controller: winner.id, linkedTo: winner.illuminati, tokens: 0 });
  log(s, `${cardName(s, r.device)} goes to ${winner.name}, the highest roll.`, winner.id);
}

registerRollResult({
  'janor-rolloff'(s, pl, total, _dice, data) {
    const r = data.rollOff as JanorRollOff;
    janorRollNext(s, { ...r, i: r.i + 1, results: { ...r.results, [pl]: total } });
  },
});

/** Personalities that may take the Martyr Meter's extra token: its holder's, in play and able to get tokens. */
function martyrCandidates(s: GameState, pl: string): string[] {
  return structureCards(s, pl).filter((g) => def(s, g).subtype === 'Personality' && !tokenBarred(s, g) && s.cards[g].capturedTurn !== s.turn && !s.cards[g].heldTokens);
}
function martyrToken(s: GameState, self: string, pl: string, g: string) {
  s.cards[g].tokens++;
  s.cards[self].benefitTurn = s.turn;
  log(s, `${cardName(s, self)}: ${cardName(s, g)} gets an extra Action token.`, pl);
}
registerChoice('martyr-meter', {
  ai: (s, _pl, options) => [[...options].sort((a, b) => power(s, b.id) - power(s, a.id))[0].id],
  resolve(s, pl, picked, data) {
    const self = data.self as string;
    const g = picked[0];
    if (!g || !active(s, self) || s.cards[self].controller !== pl || !martyrCandidates(s, pl).includes(g)) return;
    martyrToken(s, self, pl, g);
  },
});

/** Every deck in the game: the two shared decks (SubGenius rules), or each live player's Plot and Group decks. */
function allDecks(s: GameState): { id: string; label: string }[] {
  if (s.common) return [{ id: 'plot|common', label: 'The Plot deck' }, { id: 'group|common', label: 'The Group deck' }];
  return livePlayers(s).flatMap((p) => [
    { id: `plot|${p.id}`, label: `${p.name}'s Plot deck` },
    { id: `group|${p.id}`, label: `${p.name}'s Group deck` },
  ]);
}
function prescripturesLook(s: GameState, pl: string, self: string, decks: string[]) {
  const cards: string[] = [];
  for (const id of decks) {
    const [kind, who] = id.split('|');
    const owner = who === 'common' ? pl : who;
    if (!s.players.some((p) => p.id === owner)) continue;
    cards.push(...(kind === 'plot' ? plotDeckOf(s, owner) : groupDeckOf(s, owner)).slice(0, 3));
  }
  const names = allDecks(s).filter((d) => decks.includes(d.id)).map((d) => d.label.replace(/^The /, 'the ')).join(' and ');
  revealTo(s, pl, cards, `${cardName(s, self)}: the top of ${names}`);
}
registerChoice('prescriptures-decks', {
  // A computer player looks at its own next draws, then a rival's.
  ai: (_s, pl, options) => [...options.filter((o) => o.id.endsWith(`|${pl}`) || o.id.endsWith('|common')), ...options].slice(0, 2).map((o) => o.id),
  resolve(s, pl, picked, data) { prescripturesLook(s, pl, data.self as string, picked.slice(0, 2)); },
});

/** The True Pipe raises its holder's Illuminati only while no other Resource of his raises it too. */
function truePipeWorks(s: GameState, self: string, iid: string): boolean {
  const pl = controllerOf2(s, self);
  if (!active(s, self) || !pl || iid !== player(s, pl).illuminati) return false;
  return !resourcesOf(s, pl).some((r) => {
    if (r === self || s.cards[r].hiddenUnder) return false;
    const h = HOOKS[s.cards[r].cardId];
    return (h?.powerMod?.(s, r, iid) ?? 0) > 0 || (h?.globalMod?.(s, r, iid) ?? 0) > 0;
  });
}

// =================================================================== Resources

registerHooks({
  // Its holder may add or subtract 1 from any die roll he makes: his attack rolls, and the rolls cards
  // make for him outside attacks (cardRoll, answered as a 'dieRoll' event). Whenever he rolls a natural
  // 11 or 12 on two dice (the dice as they finally fell, re-rolls included), his turn ends there if it
  // was his, and the Device goes to the rival who rolls highest on two dice (ties roll again).
  'janor-device': {
    actions: [{
      id: 'adjust', label: 'Add or subtract 1 from the roll', timing: ['roll', 'event'], events: ['dieRoll'], usesToken: false,
      needs: { modes: ['plus', 'minus'] }, ai: 'boostAttack',
      listens: (s, pl, self, e) => e.type === 'dieRoll' && e.player === pl && active(s, self) && s.cards[self].controller === pl && !e.data?.janorUsed,
      check(s, pl, self, p, ctx) {
        if (!active(s, self) || s.cards[self].controller !== pl) return 'Not yours to use.';
        if (p.mode !== 'plus' && p.mode !== 'minus') return 'Choose to add or subtract 1.';
        const e = eventAnswered(s);
        if (!ctx && e?.type === 'dieRoll') {
          if (e.player !== pl) return 'Only a roll you made yourself.';
          return e.data?.janorUsed ? 'Already used on this roll.' : null;
        }
        if (!ctx?.roll || ctx.attackerPlayer !== pl) return 'Only the attacker holding the Device may adjust his own roll.';
        if (ctx.plays.some((pp) => pp.ability === self)) return 'Already used on this roll.';
        return null;
      },
      apply(s, _pl, _self, p, ctx) {
        const delta = p.mode === 'plus' ? 1 : -1;
        const e = eventAnswered(s);
        if (!ctx && e?.type === 'dieRoll') { changeRoll(e, { delta }); e.data = { ...e.data, janorUsed: true }; return; }
        return { t: 'delta' as const, value: delta };
      },
    }],
    onAttackEnd(s, self, ctx) {
      const pl = s.cards[self].controller;
      const dice = finalDice(ctx);
      if (!active(s, self) || pl !== ctx.attackerPlayer || !dice) return;
      janorNatural(s, self, pl, dice);
    },
    // The natural roll is the dice as they fell (a re-roll replaces them), whatever a card changed it to.
    afterCardRoll(s, self, e) {
      const pl = s.cards[self].controller;
      const dice = e.data?.dice as number[] | undefined;
      if (!active(s, self) || !pl || e.player !== pl || !dice || dice.length !== 2) return;
      janorNatural(s, self, pl, dice);
    },
  },

  // During its holder's token placement phase, one of his Personalities (his choice, each turn) gets an
  // extra Action token. (Its holder's immunity to Random Jesii is printed on Random Jesii, which checks
  // for this card: see subgenius4.ts.)
  'martyr-meter': {
    onTokensPlaced(s, self, activeId) {
      const pl = s.cards[self].controller;
      if (!active(s, self) || !pl || pl !== activeId || s.turnFlags.extraTurn) return;
      const ok = martyrCandidates(s, pl);
      if (ok.length === 1) { martyrToken(s, self, pl, ok[0]); return; }
      if (!ok.length) return;
      askChoice(s, pl, {
        key: 'martyr-meter', source: self,
        question: 'Martyr Meter: which of your Personalities gets an extra Action token?',
        options: ok.map((g) => ({ id: g, label: cardName(s, g) })), min: 1, max: 1, data: { self },
      });
    },
  },

  'sacred-stencil': {
    actions: [{
      id: 'boost', label: '+5 defense against an Attack to Destroy', timing: ['attack'], usesToken: false, ai: 'boostDefense',
      check(s, pl, self, _p, ctx) {
        if (!active(s, self) || s.cards[self].controller !== pl) return 'Not yours to use.';
        if (!ctx || ctx.type !== 'destroy' || ctx.targetPlayer !== pl) return "Only against an Attack to Destroy on a Group of yours.";
        // RULING: the card names Instant attacks for standard INWO only, so under the stand-alone
        // SubGenius rules it helps against ordinary Attacks to Destroy alone (the SubGenius set itself
        // has no Instant attacks); in a standard game it also helps against Instant attacks.
        if (ctx.instant && sgRules(s)) return 'Not against Instant attacks in the stand-alone SubGenius game.';
        return null;
      },
      apply(s, pl, self, _p, ctx) {
        ctx!.defenseBonus.push({ player: pl, plot: self, amount: 5, label: cardName(s, self) });
      },
    }],
  },

  // Once per turn, on its holder's own turn, for the actions of all his Personalities (at least one) or an
  // Illuminati action: the top three cards of any two decks in the game (his choice among every player's
  // Plot and Group decks; under SubGenius rules the two shared decks), or one rival's Plot hand.
  'the-prescriptures': {
    hasAction: false,
    actions: [{
      id: 'foresee', label: 'Look ahead: two decks, or a rival\'s Plots', timing: ['anytime'], usesToken: false, oncePerTurn: true,
      needs: { modes: ['decks', 'hand'], target: 'rival', helpers: true },
      check(s, pl, self, p) {
        if (!active(s, self) || s.cards[self].controller !== pl) return 'Not yours to use.';
        if (activePlayer(s).id !== pl) return 'Only on your own turn.';
        const ill = player(s, pl).illuminati;
        const usingIll = p.payWith?.length === 1 && p.payWith[0] === ill && s.cards[ill].tokens >= 1;
        const personalities = structureCards(s, pl).filter((g) => def(s, g).subtype === 'Personality');
        const usingAll = !usingIll && personalities.length > 0 && !!p.payWith && p.payWith.length === personalities.length
          && personalities.every((g) => p.payWith!.includes(g) && s.cards[g].tokens >= 1);
        if (!usingIll && !usingAll) return "Pay with your Illuminati's action, or the actions of all your Personalities (at least one).";
        if (p.mode === 'hand') {
          // needs.target 'rival': p.target is that rival's Illuminati card, not a player id.
          const rival = p.target ? s.cards[p.target]?.controller : undefined;
          if (!rival || rival === pl || def(s, p.target!).type !== 'Illuminati') return 'Choose a rival.';
          return null;
        }
        if (p.mode !== 'decks') return 'Choose to look at two decks, or a rival\'s Plots.';
        return null;
      },
      apply(s, pl, self, p) {
        for (const g of p.payWith!) s.cards[g].tokens--;
        if (p.mode === 'hand') {
          const rival = s.cards[p.target!].controller!;
          revealTo(s, pl, plotsInHand(s, rival), `${cardName(s, self)}: ${player(s, rival).name}'s Plots`);
          return;
        }
        const decks = allDecks(s);
        if (decks.length <= 2) { prescripturesLook(s, pl, self, decks.map((d) => d.id)); return; }
        askChoice(s, pl, {
          key: 'prescriptures-decks', source: self,
          question: 'The Prescriptures: look at the top three cards of which two decks?',
          options: decks.map((d) => ({ id: d.id, label: d.label })), min: 2, max: 2, data: { self },
        });
      },
    }],
  },

  // +2 Power and +2 Global Power for its holder's Illuminati, but it is never combined with another
  // Resource of his that raises his Illuminati's Power: while he holds one, the Pipe adds nothing.
  'the-true-pipe': {
    powerMod(s, self, iid) { return truePipeWorks(s, self, iid) ? 2 : 0; },
    globalMod(s, self, iid) { return truePipeWorks(s, self, iid) ? 2 : 0; },
  },

  // Linked to a SubGenius Place: +2 Power, and Global Power equal to its Power with that +2.
  'three-fisted-tales-of-bob': {
    linkTo: (s, _self, g) => def(s, g).subtype === 'Place' && attributes(s, g).includes('SubGenius'),
    powerMod(s, self, iid) { return active(s, self) && linked(s, self) === iid ? 2 : 0; },
    globalEqualsPower: (s, self, iid) => (active(s, self) && linked(s, self) === iid ? 'current' : undefined),
  },
});

// =================================================================== Goals

/** Groups (not the Illuminati) that count toward a Goal: not a Devastated Place or anything under one. */
function countedGroups(s: GameState, pl: string): string[] {
  return structureCards(s, pl).filter((iid) => {
    let c = s.cards[iid];
    for (;;) { if (c.devastated) return false; if (!c.master) return true; c = s.cards[c.master]; }
  });
}
const subgenius3 = (s: GameState, iid: string) => attributes(s, iid).includes('SubGenius') && power(s, iid, { goals: true }) >= 3;

registerGoals({
  // Instead of an ordinary declared victory, this reads on the elimination rule itself: showing Arise!
  // spares its holder from going out for having no puppets, until the end of that turn (see
  // checkElimination in game.ts). It never shows up as something to declare.
  'arise': () => null,

  'brag-of-the-subgenius': (s, pl) =>
    (goalCount(s, pl, (iid) => subgenius3(s, iid)) >= goalNeeded(s, pl) ? 'controls enough Groups, counting Power 3+ SubGenius Groups twice' : null),

  // "Destroy" another Illuminati of the same kind as yours by eliminating it, i.e. by removing its last
  // Group, whether you capture that Group or destroy it (the printed card says "eliminating", not
  // "taking"): the elimination credit (eliminatedBy) records exactly that.
  'cast-out-false-prophets': (s, pl) => {
    const ill = s.cards[player(s, pl).illuminati].cardId;
    const victim = s.players.find((x) => x.eliminated && x.eliminatedBy === pl && s.cards[x.illuminati].cardId === ill);
    return victim ? `eliminated ${victim.name}, a faction of the same Illuminati` : null;
  },

  // "Cannot be combined with other Goals": the engine never adds one Goal's Groups to another's (each Goal
  // card and the Basic Goal are judged on their own), so nothing more is needed.
  'science-cannot-remove-the-terror-of-the-gods': (s, pl) => {
    const destroyed = player(s, pl).destroyedCredit.filter((iid) => scienceOrChurch(s, iid)).length;
    const controlled = countedGroups(s, pl).filter((iid) => isGroup(s, iid) && attributes(s, iid).includes('Church')).length;
    const combo = [[2, 5], [3, 4], [4, 3], [5, 2], [6, 1]].find(([d, c]) => destroyed >= d && controlled >= c);
    return combo ? `destroyed ${destroyed} Science or Church Groups and controls ${controlled} Church Groups` : null;
  },

  'the-anti-bob': (s, pl) => {
    const controlled = countedGroups(s, pl).filter((iid) => isGroup(s, iid) && attributes(s, iid).includes('SubGenius')).length;
    const destroyed = antiBobVictims(s, pl);
    return controlled >= 6 && destroyed >= 2 ? `controls ${controlled} SubGenius Groups and destroyed ${destroyed} rivals' SubGenius or Weird Groups` : null;
  },
});

/** SubGenius or Weird Groups this player destroyed that belonged to a rival at the time (not uncontrolled ones, not his own). */
function antiBobVictims(s: GameState, pl: string): number {
  return player(s, pl).destroyedCredit.filter((iid) => {
    const d = def(s, iid);
    const from = s.cards[iid].data?.destroyedFrom as string | undefined;
    return !!from && from !== pl && ((d.attributes ?? []).includes('SubGenius') || (d.alignments ?? []).includes('Weird'));
  }).length;
}

function scienceOrChurch(s: GameState, iid: string): boolean {
  const d = def(s, iid);
  return (d.attributes ?? []).includes('Science') || (d.attributes ?? []).includes('Church');
}

registerGoalProgress({
  'brag-of-the-subgenius': (s, pl) => Math.min(1, goalCount(s, pl, (iid) => subgenius3(s, iid)) / Math.max(1, goalNeeded(s, pl))),
  'the-anti-bob': (s, pl) => {
    const controlled = countedGroups(s, pl).filter((iid) => isGroup(s, iid) && attributes(s, iid).includes('SubGenius')).length;
    return Math.min(1, controlled / 6, antiBobVictims(s, pl) / 2);
  },
});

registerGoalExposeBonus({
  // A once-per-game, self-chosen exposure: +1 Illuminati token, and the card can never be hidden or
  // discarded again (`lockedInHand` is read by the 'discard' action in game.ts).
  'the-anti-bob': (s, pl, card) => {
    if (s.cards[card].exposed) throw new RuleError('Already exposed.');
    s.cards[card].exposed = true;
    s.cards[card].data = { ...s.cards[card].data, lockedInHand: true };
    const ill = s.cards[player(s, pl).illuminati];
    // One token per game for each player, however many copies he exposes.
    if (!ill.data?.antiBobToken) {
      ill.tokens++;
      ill.data = { ...ill.data, antiBobToken: true };
      log(s, `${player(s, pl).name} exposes The Anti"Bob" for an extra Illuminati token; it can never be hidden again.`, pl);
    } else log(s, `${player(s, pl).name} exposes The Anti"Bob"; it can never be hidden again.`, pl);
  },
});

// ---------------------------------------------------------------- Group cards also playable as Plots

registerPlots({
  // As a Plot: +10 to an Attack to Destroy on the False Prophets (the Group card of that name), on one of
  // their puppets, or on their master, unless their master is an Illuminati (which cannot be attacked).
  'cast-out-false-prophets': {
    timing: ['attack'],
    check(s, _pl, _play, ctx: AttackCtx | undefined) {
      if (!ctx || ctx.type !== 'destroy') return 'Use this on an Attack to Destroy.';
      const prophets = Object.values(s.cards).filter((c) => c.cardId === 'false-prophets' && (c.zone === 'structure' || c.zone === 'uncontrolled')).map((c) => c.iid);
      const t = s.cards[ctx.target];
      const ok = prophets.some((fp) => ctx.target === fp || t?.master === fp
        || (s.cards[fp].master === ctx.target && def(s, ctx.target).type !== 'Illuminati'));
      return ok ? null : 'The target must be the False Prophets, one of their puppets, or their master (not an Illuminati).';
    },
    apply(s, pl, play, ctx) {
      ctx!.attackBonus.push({ player: pl, plot: play.card, amount: 10, label: cardName(s, play.card) });
    },
  },
  'nhgh': {
    timing: ['attack'],
    check(s, pl, _play, ctx: AttackCtx | undefined) {
      if (sgRules(s)) return 'NHGH is only played this way when there is no uncontrolled area.';
      if (!ctx || ctx.type !== 'destroy') return 'Use this on an Attack to Destroy.';
      if (!ctx.targetPlayer || ctx.targetPlayer === pl) return "Choose an Attack to Destroy on a rival's Group.";
      return null;
    },
    apply(s, pl, play, ctx) {
      ctx!.attackBonus.push({ player: pl, plot: play.card, amount: 5, label: cardName(s, play.card) });
      const rival = ctx!.targetPlayer!;
      Object.assign(s.cards[play.card], { zone: 'hand', controller: undefined, owner: rival });
      player(s, rival).hand.push(play.card);
      log(s, `${cardName(s, play.card)} goes to ${player(s, rival).name}, as its own price.`, pl);
    },
  },
});
