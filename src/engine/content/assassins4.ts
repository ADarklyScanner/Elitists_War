// Encoded by the card-content pass. See docs/CARD_SCRIPTING.md ("Expansions") and docs/EXPANSIONS.md.
// Batch: defection, dolphins, don't-rock-the-boat, don't-touch-that-dial, enough-is-enough,
// every-year-is-worse, exorcism, family-values, fickle-finger-of-fate, five-year-plan,
// floating-point-error, frankenfood, go-fish, go-lemmings-go, grave-robbers, hubble-trouble,
// junk-bonds, lab-explosion, let-the-sunshine-in, may-day, metric-system,
// my-karma-ran-over-your-dogma, near-miss, nevermore, partition.
import type { Alignment, GameEvent, GameState, PlotPlay } from '../types';
import type { PlotHandler } from '../plotTypes';
import { registerPlots } from '../plotTypes';
import { linkedPlotLive, registerChoice, registerHooks, type AbilityParams } from '../hooks';
import { CARDS, cardName, def } from '../cards';
import { type Match, matches } from '../abilities';
import { alignments, attributes, isOpposite, power } from '../stats';
import { openArrows, structureCards } from '../geometry';
import {
  activePlayer, askChoice, clearConditions, controllerOf2, currentOutcome, discardCard, exposableHand, exposeCards,
  giveToken, isUnique, log, placeGroup, player, playResourceCard, raiseEvent, revealTo, tokenBarred,
  zappedPlayer, zapsOn,
} from '../game';
import { freezePlot, paralysisPlot, registerZap, zapPlot } from './families';

// ---------------------------------------------------------------- shared local helpers

const own = (s: GameState, pl: string, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure' && s.cards[iid].controller === pl;
const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';
const inHand = (s: GameState, pl: string, iid?: string) => !!iid && player(s, pl).hand.includes(iid);
const hasAttr = (s: GameState, iid: string, a: string) => attributes(s, iid).includes(a);
const isGadget = (uniqueness?: string | null) => /\bGadget\b/.test(uniqueness ?? '');
const isArtifact = (uniqueness?: string | null) => /\bArtifact\b/.test(uniqueness ?? '');
const totalPower = (s: GameState, groups: string[] = []) => groups.reduce((n, g) => n + power(s, g), 0);

function spend(s: GameState, pl: string, groups: string[] = []): string | null {
  for (const g of groups) if (!own(s, pl, g) || s.cards[g].tokens < 1) return 'Every paying Group must be yours and have an Action token.';
  if (new Set(groups).size !== groups.length) return 'A Group can only pay once.';
  return null;
}
function pay(s: GameState, groups: string[] = []) { for (const g of groups) s.cards[g].tokens--; }
function payOne(s: GameState, pl: string, payWith: string[] | undefined, ok: (g: string) => boolean, msg: string): string | null {
  const err = spend(s, pl, payWith);
  if (err) return err;
  if (payWith?.length !== 1 || !ok(payWith[0])) return msg;
  return null;
}

/** The event whose response window is open right now, or (once resolving) the one stashed on the card. */
const eventNow = (s: GameState): GameEvent | undefined => (s.window?.kind === 'event' ? s.window.event : undefined);
function remember(s: GameState, play: PlotPlay) {
  const e = eventNow(s);
  s.cards[play.card].data = { ...s.cards[play.card].data, event: e ? JSON.parse(JSON.stringify(e)) : undefined };
}
const remembered = (s: GameState, play: PlotPlay) => s.cards[play.card].data?.event as GameEvent | undefined;

/** Discard the top card of a player's own Plot or Group deck (never the SubGenius shared piles: not needed by this batch). */
function discardTop(s: GameState, pl: string, deck: 'plotDeck' | 'groupDeck'): string | undefined {
  const p = player(s, pl);
  const top = p[deck].shift();
  if (top) { s.cards[top].zone = 'hand'; p.hand.push(top); discardCard(s, top); }
  return top;
}

/** Go, Lemmings, Go! (Assassins): discarding cards to pay a cost draws extra discards of the same kind and place. */
function costDiscarded(s: GameState, payer: string, kind: 'plot' | 'group', place: 'hand' | 'deck', cards: string[]) {
  if (!cards.length) return;
  raiseEvent(s, { type: 'costDiscard', player: payer, cards: [...cards], data: { kind, place } });
}

// ================================================================== Zaps

registerZap('don-t-rock-the-boat', { noTakeover: { alignments: ['Fanatic'] } });
registerZap('my-karma-ran-over-your-dogma', { noTakeover: { alignments: ['Straight'] } });

registerZap('family-values', {
  noTakeover: { alignments: ['Weird'] },
  // The Discordian Society's own player is immune to this Zap (it is otherwise a Weird Illuminati).
  canTarget: (s, _pl, victim) => (s.cards[player(s, victim).illuminati].cardId === 'discordian-society' ? 'The Discordian Society is immune to Family Values.' : null),
});

{
  const labExplosion = zapPlot({
    hooks: {
      forbidAttack(s, self, _attacker, target, type, attackerPlayer) {
        if (type === 'takeover' && attackerPlayer === zappedPlayer(s, self) && s.cards[target] && def(s, target).type === 'Resource') {
          return `${cardName(s, self)}: ${player(s, attackerPlayer).name} may take over no more Resources.`;
        }
        return null;
      },
    },
  });
  registerPlots({ 'lab-explosion': labExplosion.plot });
  registerHooks({ 'lab-explosion': labExplosion.hooks });
}

// Fickle Finger of Fate: the victim loses the automatic takeover entirely, but the first direct attack
// their own Illuminati leads each turn gets a flat +10 (not Global Power). Several copies on the same
// player still give only +10 in total (CFAQ). Not usable in a two-player game (card text).
const isCanonicalFFoF = (s: GameState, self: string): boolean => {
  const victim = zappedPlayer(s, self);
  if (!victim) return false;
  const all = Object.values(s.cards).filter((c) => c.cardId === 'fickle-finger-of-fate' && c.zone === 'table' && zappedPlayer(s, c.iid) === victim && linkedPlotLive(s, c.iid));
  return all.every((c) => c.iid >= self);
};
{
  const ffof = zapPlot({
    canTarget: (s) => (s.players.length === 2 ? 'Fickle Finger of Fate cannot be played in a two-player game.' : null),
    hooks: {
      forbidAttack(s, self, _attacker, _target, type, attackerPlayer) {
        if (type === 'takeover' && attackerPlayer === zappedPlayer(s, self)) return `${cardName(s, self)}: ${player(s, attackerPlayer).name} has lost the automatic takeover.`;
        return null;
      },
      // RULING: the printed card lets the victim choose which attack gets the +10; the engine applies it
      // automatically to the first direct attack their Illuminati leads each turn, since there is no
      // mechanism here for declining a passive attack modifier in advance.
      attackMod(s, self, ctx, side) {
        if (side !== 'attack' || !ctx.attacker) return 0;
        const victim = zappedPlayer(s, self);
        if (!victim || ctx.attackerPlayer !== victim || ctx.attacker !== player(s, victim).illuminati) return 0;
        if (!isCanonicalFFoF(s, self)) return 0;
        if (s.cards[self].data?.usedTurn === s.turn) return 0;
        return 10;
      },
      onAttackEnd(s, self, ctx) {
        const victim = zappedPlayer(s, self);
        if (!victim || ctx.attackerPlayer !== victim || ctx.attacker !== player(s, victim).illuminati) return;
        if (!isCanonicalFFoF(s, self) || s.cards[self].data?.usedTurn === s.turn) return;
        s.cards[self].data = { ...s.cards[self].data, usedTurn: s.turn };
      },
    },
  });
  registerPlots({ 'fickle-finger-of-fate': ffof.plot });
  registerHooks({ 'fickle-finger-of-fate': ffof.hooks });
}

// ================================================================== Paralysis

registerPlots({
  'every-year-is-worse': paralysisPlot({ on: { alignments: ['Conservative'] }, pay: { alignments: ['Liberal'] } }),
  'metric-system': paralysisPlot({ on: { alignments: ['Corporate'] }, pay: { alignments: ['Government'] } }),
});

// ================================================================== Attribute Freezes

registerPlots({
  'five-year-plan': freezePlot({ match: { attributes: ['Communist'] }, label: 'Communist' }),
  'floating-point-error': freezePlot({ match: { attributes: ['Computer'] }, label: 'Computer' }),
  'junk-bonds': freezePlot({ match: { attributes: ['Bank'] }, label: 'Bank' }),
  'let-the-sunshine-in': freezePlot({ match: { attributes: ['Secret'] }, label: 'Secret' }),
  // "Satellites" names the category: every Satellite Resource in the base data is Weather Satellite; the
  // Orbital Mind Control Lasers is named on the card by its full title.
  'hubble-trouble': freezePlot({
    match: [{ attributes: ['Space'] }, { attributes: ['Science'] }],
    resources: ['weather-satellite', 'orbital-mind-control-lasers'],
    label: 'Space, Science',
  }),
});

// ================================================================== Give an Action token

function tokenGiftPlot(match: Match, label: string): PlotHandler {
  return {
    timing: ['anytime'],
    needs: { targets: true },
    check(s, pl, play) {
      const list = play.targets ?? [];
      if (!list.length) return `Choose one ${label} Group, or several with 5 Power or less in total.`;
      if (new Set(list).size !== list.length) return 'Choose each Group only once.';
      const ill = player(s, pl).illuminati;
      if (s.cards[ill].tokens < 1) return 'This costs your Illuminati\'s action.';
      for (const g of list) {
        if (!own(s, pl, g) || !matches(s, g, match)) return `Choose your own ${label} Groups.`;
        if (s.cards[g].tokens > 0 || s.cards[g].heldTokens) return `${cardName(s, g)} already has an Action token.`;
        if (tokenBarred(s, g)) return `${cardName(s, g)} cannot receive an Action token.`;
      }
      if (list.length > 1 && totalPower(s, list) > 5) return 'Several Groups may share this only if their Power totals 5 or less.';
      return null;
    },
    apply(s, pl) { s.cards[player(s, pl).illuminati].tokens--; },
    resolve(s, pl, play) {
      for (const g of play.targets ?? []) giveToken(s, g);
      log(s, `${player(s, pl).name} spends an Illuminati action to give an Action token to ${(play.targets ?? []).map((g) => cardName(s, g)).join(', ')}.`, pl);
    },
  };
}
registerPlots({
  'dolphins': tokenGiftPlot({ attributes: ['Green'] }, 'Green'),
  'may-day': tokenGiftPlot({ attributes: ['Communist'] }, 'Communist'),
});

// ================================================================== Enough is Enough

registerPlots({
  'enough-is-enough': {
    timing: ['event'],
    events: ['turnStart'],
    check(s, pl, play) {
      const e = eventNow(s);
      if (!e || e.type !== 'turnStart' || e.player !== pl) return 'Play this at the very start of your own turn, before drawing Plots.';
      return null;
    },
    apply(s, _pl, play) { remember(s, play); },
    resolve(s, pl, play) {
      const e = remembered(s, play);
      if (!e || e.player !== pl) return;
      const n = clearConditions(s, pl);
      s.turnFlags.noPlotDraws = [...new Set([...(s.turnFlags.noPlotDraws ?? []), pl])];
      log(s, `${player(s, pl).name} cleans house (${n} condition${n === 1 ? '' : 's'} removed) and draws no Plot this turn.`, pl);
    },
  },
});

// ================================================================== Exorcism

registerPlots({
  'exorcism': {
    timing: ['anytime'],
    needs: { target: 'rival', mode: ['plotDeck', 'groupDeck'] },
    check(s, pl, play) {
      const t = play.target ? s.cards[play.target] : undefined;
      if (!t || t.zone !== 'structure' || def(s, play.target!).type !== 'Illuminati') return 'Choose a player\'s Illuminati (any player, including yourself).';
      const victim = t.controller;
      if (!victim || !zapsOn(s, victim).length) return 'That player is not Zapped.';
      if (play.mode !== 'plotDeck' && play.mode !== 'groupDeck') return 'Choose whether to discard from your Plot deck or your Group deck.';
      if (!player(s, pl)[play.mode].length) return 'That deck is empty.';
      return null;
    },
    apply(s, pl, play) {
      const deck = play.mode as 'plotDeck' | 'groupDeck';
      const top = discardTop(s, pl, deck);
      if (top) costDiscarded(s, pl, deck === 'plotDeck' ? 'plot' : 'group', 'deck', [top]);
    },
    resolve(s, pl, play) {
      const victim = play.target ? s.cards[play.target]?.controller : undefined;
      if (!victim) return;
      const zaps = zapsOn(s, victim);
      for (const z of zaps) discardCard(s, z);
      log(s, `${player(s, pl).name} performs an Exorcism on ${player(s, victim).name}: ${zaps.length} Zap${zaps.length === 1 ? '' : 's'} removed.`, pl);
    },
  },
});

// ================================================================== Don't Touch That Dial!

registerPlots({
  'don-t-touch-that-dial': {
    timing: ['roll'],
    needs: { pay: 'tokens' },
    check(s, pl, play, ctx) {
      if (!ctx || !ctx.roll) return 'Play this right after the dice are rolled.';
      if (!s.cards[ctx.target] || def(s, ctx.target).subtype !== 'Place' || !hasAttr(s, ctx.target, 'Media')) return 'The target of this attack is not a Media Group.';
      if (currentOutcome(s, ctx) !== 'failure') return 'This attack is not currently failing.';
      return payOne(s, pl, play.payWith, (g) => hasAttr(s, g, 'Media'), 'Pay with the action of one of your Media Groups.');
    },
    apply(s, _pl, play, ctx) { pay(s, play.payWith); if (ctx) ctx.endsAttackerTurn = true; },
  },
});

// ================================================================== Frankenfood

{
  const frankenfoodPlot: PlotHandler = {
    timing: ['anytime'],
    needs: { target: 'ownGroup', alignment: true, pay: 'tokens' },
    check(s, pl, play) {
      const t = play.target;
      if (!t || !own(s, pl, t) || def(s, t).subtype !== 'Place') return 'Choose a Place you control.';
      if (!play.alignment) return 'Choose the alignment to give it.';
      const current = alignments(s, t);
      if (current.some((a) => isOpposite(a, play.alignment!))) return `${cardName(s, t)} already has the opposite alignment.`;
      if (current.includes(play.alignment)) return `${cardName(s, t)} already has that alignment.`;
      return payOne(s, pl, play.payWith, (g) => hasAttr(s, g, 'Science'), 'Pay with the action of one of your Science Groups.');
    },
    apply(s, _pl, play) { pay(s, play.payWith); },
    resolve(s, pl, play) {
      if (!own(s, pl, play.target)) return;
      s.cards[play.card].linkedTo = play.target;
      s.cards[play.card].data = { alignment: play.alignment };
      log(s, `${player(s, pl).name} gives ${cardName(s, play.target!)} the ${play.alignment} alignment.`, pl);
    },
  };
  registerPlots({ 'frankenfood': frankenfoodPlot });

  registerHooks({
    'frankenfood': {
      alignmentMod(s, self, iid, current) {
        if (!linkedPlotLive(s, self) || s.cards[self].linkedTo !== iid) return current;
        const a = s.cards[self].data?.alignment as Alignment | undefined;
        return a && !current.includes(a) ? [...current, a] : current;
      },
      actions: [
        {
          id: 'drop', label: 'Remove the alignment Frankenfood added', timing: ['anytime'], usesToken: false, ai: 'never',
          needs: { helpers: true },
          check(s, pl, self, p) {
            if (controllerOf2(s, self) === pl) return null;
            const pool = p.payWith ?? [];
            if (!pool.length || !pool.every((g) => own(s, pl, g) && s.cards[g].tokens > 0 && hasAttr(s, g, 'Science'))) return 'Pay with the actions of your own Science Groups.';
            if (totalPower(s, pool) < 6) return 'Your Science Groups need 6 Power in total to remove this.';
            return null;
          },
          apply(s, pl, self, p) {
            if (controllerOf2(s, self) !== pl) for (const g of p.payWith ?? []) s.cards[g].tokens--;
            const target = s.cards[self].linkedTo;
            log(s, `${player(s, pl).name} removes the alignment Frankenfood gave ${target ? cardName(s, target) : 'a Place'}.`, pl);
            discardCard(s, self);
          },
        },
      ],
    },
  });
}

// ================================================================== Defection

function defectionOptions(s: GameState, pl: string): string[] {
  return player(s, pl).groupDeck.filter((iid) => {
    const d = def(s, iid);
    if (d.type !== 'Resource') return false;
    const eligible = d.id === 'clipper-chip' || (isGadget(d.uniqueness) && !isUnique(s, iid));
    if (!eligible) return false;
    return Object.values(s.cards).some((c) => c.zone === 'resources' && c.controller && c.controller !== pl && c.cardId === d.id);
  });
}
registerPlots({
  'defection': {
    timing: ['anytime'],
    needs: { pay: 'tokens' },
    check(s, pl, play) {
      if (!defectionOptions(s, pl).length) return 'You have no non-Unique Gadget (or Clipper Chip) in your Group deck that duplicates a Resource a rival controls.';
      return payOne(s, pl, play.payWith, (g) => hasAttr(s, g, 'Nation'), 'Pay with the action of one of your Nation Groups.');
    },
    apply(s, _pl, play) { pay(s, play.payWith); },
    resolve(s, pl) {
      const opts = defectionOptions(s, pl);
      if (!opts.length) return;
      askChoice(s, pl, {
        key: 'defection', question: 'Defection: bring which duplicate Resource into play?', min: 1, max: 1,
        options: opts.map((c) => ({ id: c, label: cardName(s, c) })),
      });
    },
  },
});
registerChoice('defection', {
  resolve(s, pl, picked) {
    const c = picked[0];
    if (!c || !player(s, pl).groupDeck.includes(c) || !defectionOptions(s, pl).includes(c)) return;
    player(s, pl).groupDeck = player(s, pl).groupDeck.filter((x) => x !== c);
    playResourceCard(s, c, pl);
    log(s, `${player(s, pl).name} defects a duplicate ${cardName(s, c)} into play.`, pl);
  },
});

// ================================================================== Grave Robbers

function graveRobbersOptions(s: GameState, pl: string): string[] {
  return player(s, pl).groupDeck.filter((iid) => def(s, iid).type === 'Resource' && isArtifact(def(s, iid).uniqueness));
}
function magicPayers(s: GameState, pl: string): string[] | null {
  const pool = structureCards(s, pl).filter((g) => own(s, pl, g) && s.cards[g].tokens > 0 && hasAttr(s, g, 'Magic')).sort((a, b) => power(s, a) - power(s, b));
  const one = pool.find((g) => power(s, g) >= 6);
  if (one) return [one];
  let total = 0; const picks: string[] = [];
  for (const g of [...pool].reverse()) { if (total >= 6) break; picks.push(g); total += power(s, g); }
  return total >= 6 ? picks : null;
}
registerPlots({
  'grave-robbers': {
    timing: ['event'],
    events: ['takeover'],
    check(s, pl, play) {
      const e = eventNow(s);
      if (!e || e.type !== 'takeover' || e.player !== pl || !e.card || !s.cards[e.card] || def(s, e.card).type !== 'Resource') {
        return 'Play this right after you take over a Resource.';
      }
      return graveRobbersOptions(s, pl).length ? null : 'You have no Artifact in your Group deck.';
    },
    apply(s, _pl, play) { remember(s, play); },
    resolve(s, pl) {
      const opts = graveRobbersOptions(s, pl).filter((c) => !hasAttr(s, c, 'Magic') || !!magicPayers(s, pl));
      if (!opts.length) return;
      askChoice(s, pl, {
        key: 'grave-robbers', question: 'Grave Robbers: bring which Artifact into play?', min: 1, max: 1,
        options: opts.map((c) => ({ id: c, label: `${cardName(s, c)}${hasAttr(s, c, 'Magic') ? ' (Magic: costs Magic actions worth 6 Power)' : ''}` })),
      });
    },
  },
});
registerChoice('grave-robbers', {
  resolve(s, pl, picked) {
    const c = picked[0];
    if (!c || !player(s, pl).groupDeck.includes(c) || !graveRobbersOptions(s, pl).includes(c)) return;
    // RULING: the card lets the player pay with Magic actions worth 6 Power; the engine picks the
    // combination automatically (cheapest first) since the choice of *which* Artifact already stands in
    // for the player's decision here.
    if (hasAttr(s, c, 'Magic')) {
      const payers = magicPayers(s, pl);
      if (!payers) return;
      for (const g of payers) s.cards[g].tokens--;
    }
    player(s, pl).groupDeck = player(s, pl).groupDeck.filter((x) => x !== c);
    playResourceCard(s, c, pl);
    log(s, `${player(s, pl).name} robs a grave for ${cardName(s, c)}.`, pl);
  },
});

// ================================================================== Go Fish

function goFishImmune(s: GameState, victim: string): boolean {
  const until = s.cards[player(s, victim).illuminati].data?.goFishImmuneThroughTurnsTaken as number | undefined;
  return until !== undefined && player(s, victim).turnsTaken <= until;
}
function markGoFishImmune(s: GameState, who: string) {
  const c = s.cards[player(s, who).illuminati];
  c.data = { ...c.data, goFishImmuneThroughTurnsTaken: player(s, who).turnsTaken + 1 };
}
registerPlots({
  // RULING: the errata's immunity ("received a Plot card from a rival, or been forced to show a rival any
  // non-exposed Plot") is tracked only for Go Fish's own effects here, not for every other way a Plot
  // could change hands or be revealed in the game.
  'go-fish': {
    timing: ['anytime'],
    needs: { target: 'rival', mode: [] },
    check(s, pl, play) {
      const t = play.target ? s.cards[play.target] : undefined;
      const victim = t?.controller;
      if (!t || t.zone !== 'structure' || def(s, play.target!).type !== 'Illuminati' || !victim || victim === pl) return 'Name a rival.';
      if (!play.mode || !CARDS[play.mode] || CARDS[play.mode].type !== 'Plot') return 'Name a Plot card.';
      if (goFishImmune(s, victim)) return `${player(s, victim).name} is immune to Go Fish until the end of their next turn.`;
      return null;
    },
    apply() {},
    resolve(s, pl, play) {
      const victim = s.cards[play.target!]?.controller;
      if (!victim) return;
      const named = play.mode!;
      const vp = player(s, victim);
      const hidden = exposableHand(s, victim, 'Plot');
      revealTo(s, pl, hidden, `Go Fish reveals ${vp.name}'s hidden Plots`);
      markGoFishImmune(s, victim);
      const matching = vp.hand.filter((c) => def(s, c).type === 'Plot' && s.cards[c].cardId === named);
      if (!matching.length) {
        const mine = player(s, pl).hand.filter((c) => def(s, c).type === 'Plot');
        exposeCards(s, mine);
        log(s, `${player(s, pl).name} plays Go Fish naming ${cardName(s, named)} against ${vp.name}, who has none: all of ${player(s, pl).name}'s Plots are exposed.`, pl);
        return;
      }
      for (const c of matching) {
        vp.hand = vp.hand.filter((x) => x !== c);
        s.cards[c].zone = 'hand';
        s.cards[c].exposed = false;
        player(s, pl).hand.push(c);
        for (let i = 0; i < 2 && vp.plotDeck.length; i++) discardTop(s, victim, 'plotDeck');
      }
      markGoFishImmune(s, pl);
      log(s, `${player(s, pl).name} plays Go Fish naming ${cardName(s, named)} against ${vp.name}: ${matching.length} card${matching.length === 1 ? '' : 's'} given up, plus ${matching.length * 2} Plot discard${matching.length === 1 ? '' : 's'}.`, pl);
    },
  },
});

// ================================================================== Go, Lemmings, Go!

function goLemmingsExtra(s: GameState, victim: string, kind: 'plot' | 'group', place: 'hand' | 'deck', n: number) {
  const need = n === 1 ? 2 : n;
  const p = player(s, victim);
  const typeName = kind === 'plot' ? 'Plot' : 'Group';
  let done = 0;
  if (place === 'hand') {
    for (const c of p.hand.filter((x) => def(s, x).type === typeName)) { if (done >= need) break; discardCard(s, c); done++; }
  }
  const deckArr = kind === 'plot' ? p.plotDeck : p.groupDeck;
  while (done < need && deckArr.length) { discardTop(s, victim, kind === 'plot' ? 'plotDeck' : 'groupDeck'); done++; }
  if (done) log(s, `Go, Lemmings, Go! makes ${p.name} discard ${done} more card${done === 1 ? '' : 's'}, for no benefit.`, victim);
}
registerPlots({
  // RULING: the printed card triggers on any discard of Plots or Groups paid to power a Plot or a
  // Group's ability. This engine only raises the underlying 'costDiscard' event for the two generalised
  // discard-cost mechanisms it has (a Plot's declared "Requires ... Discards" cost, and this batch's own
  // manual deck/hand discard costs); the many one-off Group-ability discard costs elsewhere are not
  // individually wired up to it.
  'go-lemmings-go': {
    timing: ['event'],
    events: ['costDiscard'],
    check(s, pl, play) {
      const e = eventNow(s);
      if (!e || e.type !== 'costDiscard' || !e.player || e.player === pl) return 'Play this right after a rival discards cards to pay a cost.';
      return null;
    },
    apply(s, _pl, play) { remember(s, play); },
    resolve(s, _pl, play) {
      const e = remembered(s, play);
      if (!e?.player || !e.cards?.length) return;
      const data = (e.data ?? {}) as { kind?: 'plot' | 'group'; place?: 'hand' | 'deck' };
      goLemmingsExtra(s, e.player, data.kind ?? 'plot', data.place ?? 'hand', e.cards.length);
    },
  },
});

// ================================================================== Near Miss

registerPlots({
  'near-miss': {
    timing: ['roll', 'anytime'],
    needs: { target: 'place', mode: ['save', 'clear'] },
    check(s, pl, play, ctx) {
      const mode = play.mode ?? (ctx ? 'save' : 'clear');
      if (mode === 'save') {
        if (!ctx || !ctx.roll) return 'Play this right after the roll, when the attack would destroy a Place.';
        if (!s.cards[ctx.target] || def(s, ctx.target).subtype !== 'Place') return 'The target of this attack is not a Place.';
        if (currentOutcome(s, ctx) !== 'success') return 'This attack is not currently succeeding.';
        if (ctx.plays.some((p) => s.cards[p.iid]?.cardId === 'near-miss')) return 'Only one Near Miss can help against this attack.';
        return null;
      }
      if (ctx) return 'Removing Devastation is not part of an attack.';
      if (!inPlay(s, play.target) || def(s, play.target!).subtype !== 'Place' || !s.cards[play.target!].devastated) return 'Choose a Devastated Place.';
      if (s.attack && s.attack.target === play.target) return 'That Place was just Devastated: wait until this attack is over.';
      return null;
    },
    apply(s, _pl, play, ctx) {
      if (ctx) { ctx.disaster = { destroyMargin: ctx.disaster?.destroyMargin ?? null, devastateOnly: true }; }
    },
    resolve(s, pl, play) {
      if ((play.mode ?? 'clear') !== 'clear' || !play.target) return;
      s.cards[play.target].devastated = false;
      log(s, `${player(s, pl).name} plays Near Miss: ${cardName(s, play.target)} recovers from Devastation.`, pl);
    },
  },
});

// ================================================================== Nevermore!

function bannedByNevermore(s: GameState, self: string): string[] {
  return (s.cards[self]?.data?.banned as string[] | undefined) ?? [];
}
function banCostCheck(s: GameState, pl: string, mode: string | undefined, payWith: string[] | undefined): string | null {
  if (mode === 'illuminati') return s.cards[player(s, pl).illuminati].tokens >= 1 ? null : 'This costs your Illuminati\'s action.';
  if (mode === 'discards') {
    const cards = payWith ?? [];
    if (cards.length !== 2 || new Set(cards).size !== 2) return 'Discard two Plot cards from your hand or deck.';
    const p = player(s, pl);
    for (const c of cards) {
      if (!s.cards[c] || def(s, c).type !== 'Plot') return 'Discard Plot cards only.';
      if (!p.hand.includes(c) && !p.plotDeck.includes(c)) return 'Discard from your own hand or Plot deck.';
    }
    return null;
  }
  return 'Choose how to pay: an Illuminati action, or two Plot discards from your hand or deck.';
}
function payBanCost(s: GameState, pl: string, mode: string | undefined, payWith: string[] | undefined) {
  if (mode === 'illuminati') { s.cards[player(s, pl).illuminati].tokens--; return; }
  const p = player(s, pl);
  let fromHand = 0;
  for (const c of payWith ?? []) { if (p.hand.includes(c)) fromHand++; discardCard(s, c); }
  costDiscarded(s, pl, 'plot', fromHand === (payWith?.length ?? 0) ? 'hand' : 'deck', payWith ?? []);
}
registerPlots({
  'nevermore': {
    timing: ['event'],
    events: ['plotResolved'],
    needs: { mode: ['illuminati', 'discards'], pay: 'tokens' },
    check(s, pl, play) {
      const e = eventNow(s);
      if (!e || e.type !== 'plotResolved' || !e.card || !s.cards[e.card]) return 'Play this right after a Plot resolves.';
      return banCostCheck(s, pl, play.mode, play.payWith);
    },
    apply(s, pl, play) { payBanCost(s, pl, play.mode, play.payWith); remember(s, play); },
    resolve(s, pl, play) {
      const e = remembered(s, play);
      if (!e?.card || !s.cards[e.card]) return;
      const bannedId = s.cards[e.card].cardId;
      s.cards[play.card].linkedTo = 'nevermore';
      s.cards[play.card].data = { banned: [bannedId] };
      log(s, `${player(s, pl).name} plays Nevermore!: ${cardName(s, e.card)} is banned for the rest of the game.`, pl);
    },
  },
});
registerHooks({
  'nevermore': {
    actions: [
      {
        id: 'ban', label: 'Ban another Plot that just resolved', timing: ['event'], events: ['plotResolved'], usesToken: false, ai: 'never',
        needs: { modes: ['illuminati', 'discards'] },
        listens(s, _pl, self, e) { return e.type === 'plotResolved' && !!e.card && !!s.cards[e.card] && !bannedByNevermore(s, self).includes(s.cards[e.card].cardId); },
        check(s, pl, self, p: AbilityParams) {
          const e = eventNow(s);
          if (!e || e.type !== 'plotResolved' || !e.card || !s.cards[e.card]) return 'Nothing to ban right now.';
          if (bannedByNevermore(s, self).includes(s.cards[e.card].cardId)) return 'That Plot is already banned.';
          return banCostCheck(s, pl, p.mode, p.payWith);
        },
        apply(s, pl, self, p: AbilityParams) {
          const e = eventNow(s);
          if (!e?.card || !s.cards[e.card]) return;
          payBanCost(s, pl, p.mode, p.payWith);
          const id = s.cards[e.card].cardId;
          s.cards[self].data = { ...s.cards[self].data, banned: [...bannedByNevermore(s, self), id] };
          log(s, `${player(s, pl).name} spends to Nevermore ${cardName(s, e.card)} as well: it is banned for the rest of the game.`, pl);
        },
      },
    ],
  },
});

// ================================================================== Partition

registerPlots({
  // RULING: the printed card lets you bring your duplicate Huge Place into play either by an automatic
  // takeover or by a full Attack to Control; this engine implements only the uncontested "automatic
  // takeover" path (an ordinary attack that could fail would need to reuse the whole attack subsystem for
  // one rare card). The Place still ends up split exactly as printed once it is in play.
  'partition': {
    timing: ['anytime'],
    needs: { target: 'handGroup' },
    check(s, pl, play) {
      if (s.phase !== 'main' || activePlayer(s).id !== pl || s.attack) return 'Play this on your own turn, outside an attack.';
      const t = play.target;
      if (!t || !inHand(s, pl, t) || def(s, t).subtype !== 'Place' || !hasAttr(s, t, 'Huge')) return 'Choose a Huge Place card from your hand.';
      if (!Object.values(s.cards).some((c) => c.zone === 'structure' && c.cardId === s.cards[t].cardId)) return 'No copy of that Place is in play to partition.';
      const spot = structureCards(s, pl).flatMap((m) => openArrows(s, m).map((side) => ({ onto: m, side })))[0];
      if (!spot) return 'You have no open arrow to place it on.';
      return null;
    },
    apply() {},
    resolve(s, pl, play) {
      const t = play.target!;
      if (!inHand(s, pl, t)) return;
      const cardId = s.cards[t].cardId;
      const orig = Object.values(s.cards).find((c) => c.zone === 'structure' && c.cardId === cardId)?.iid;
      const spot = structureCards(s, pl).flatMap((m) => openArrows(s, m).map((side) => ({ onto: m, side })))[0];
      if (!orig || !spot) return;
      placeGroup(s, t, pl, spot.onto, spot.side);
      s.cards[t].tokens = 0;
      log(s, `${player(s, pl).name} plays a duplicate ${cardName(s, t)} into play: Partition splits it.`, pl);
      const printed = def(s, t).power ?? 0;
      const half = Math.ceil(printed / 2);
      for (const iid of [t, orig]) {
        s.cards[iid].mods = [
          ...s.cards[iid].mods.filter((m) => m.source !== 'partition'),
          { source: 'partition', kind: 'setPower', value: half, lower: true, until: 'permanent' },
          { source: 'partition', kind: 'removeAttr', attr: 'Huge', until: 'permanent' },
        ];
        s.cards[iid].data = { ...s.cards[iid].data, partitionPair: iid === t ? orig : t };
      }
    },
  },
});
