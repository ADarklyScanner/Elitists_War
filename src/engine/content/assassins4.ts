// Encoded by the card-content pass. See docs/CARD_SCRIPTING.md ("Expansions") and docs/EXPANSIONS.md.
// Batch: defection, dolphins, don't-rock-the-boat, don't-touch-that-dial, enough-is-enough,
// every-year-is-worse, exorcism, family-values, fickle-finger-of-fate, five-year-plan,
// floating-point-error, frankenfood, go-fish, go-lemmings-go, grave-robbers, hubble-trouble,
// junk-bonds, lab-explosion, let-the-sunshine-in, may-day, metric-system,
// my-karma-ran-over-your-dogma, near-miss, nevermore, partition.
import type { Alignment, AttackCtx, GameEvent, GameState, PlotPlay, Side } from '../types';
import type { PlotHandler } from '../plotTypes';
import { registerPlots } from '../plotTypes';
import { HOOKS, anyHook, linkedPlotLive, registerChoice, registerHooks, type AbilityParams } from '../hooks';
import { CARDS, cardName, def } from '../cards';
import { type Match, abilitiesOf, matches } from '../abilities';
import { alignments, attributes, isOpposite, power } from '../stats';
import { openArrows, structureCards } from '../geometry';
import {
  activePlayer, askChoice, attackCancelled, attackStrength, canEnterPlay, clearConditions, controllerOf2, currentOutcome, discardCard,
  exposeCards, finalRoll, giveToken, goFishShielded, isCancelled, isParalyzed, isUnique, log, masterProblem, noteCostDiscard, placeGroup,
  player, playResourceCard, revealTo, shieldFromGoFish, startAttack, tokenBarred, validateAttack, zappedPlayer, zapsOn,
} from '../game';
import { groupDeckOf, plotDeckOf } from '../expansions';
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

/** Go, Lemmings, Go! (Assassins): announce cards discarded from a hand or a deck to pay a cost. */
function costDiscarded(s: GameState, payer: string, kind: 'plot' | 'group', place: 'hand' | 'deck', cards: string[]) {
  noteCostDiscard(s, payer, [{ kind, place, cards }]);
}
/** Discard the top card of a player's Plot or Group deck (the shared one under SubGenius rules). */
function discardDeckTop(s: GameState, pl: string, deck: 'plot' | 'group'): string | undefined {
  const arr = deck === 'plot' ? plotDeckOf(s, pl) : groupDeckOf(s, pl);
  const top = arr.shift();
  if (top) { s.cards[top].zone = 'hand'; player(s, pl).hand.push(top); discardCard(s, top); }
  return top;
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

// Fickle Finger of Fate: the victim loses the automatic takeover entirely, but gets +10 to the Power of
// his Illuminati for any one direct attack it makes each turn (CFAQ: Power, not Global Power; one direct
// attack). The victim chooses which: each time his Illuminati declares an attack while the bonus is still
// unused this turn, he is asked whether to use it on this one. Several copies on the same player still
// give only +10 in total (CFAQ). Not usable in a two-player game (card text).
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
      onAttackStart(s, self, ctx) {
        const victim = zappedPlayer(s, self);
        if (!victim || ctx.instant || ctx.attackerPlayer !== victim || ctx.attacker !== player(s, victim).illuminati) return;
        if (!isCanonicalFFoF(s, self) || ffofUsed(s, victim)) return;
        askChoice(s, victim, {
          key: 'ffof-bonus', source: self,
          question: `${cardName(s, self)}: use your +10 for this turn on this attack by your Illuminati?`,
          options: [{ id: 'use', label: 'Yes: +10 to this attack' }, { id: 'save', label: 'No: keep it for a later attack this turn' }],
          min: 1, max: 1, data: { zap: self, attack: ctx.id },
        });
      },
      attackMod(s, self, ctx, side) {
        if (side !== 'attack' || !ctx.attacker) return 0;
        return s.cards[self].data?.bonusAttack === ctx.id ? 10 : 0;
      },
      onAttackEnd(s, self, ctx) {
        // An attack that never happened (cancelled) did not use the bonus up.
        if (s.cards[self].data?.bonusAttack === ctx.id && attackCancelled(ctx)) {
          s.cards[self].data = { ...s.cards[self].data, bonusAttack: undefined, usedTurn: undefined };
        }
      },
    },
  });
  registerPlots({ 'fickle-finger-of-fate': ffof.plot });
  registerHooks({ 'fickle-finger-of-fate': ffof.hooks });
}
/** Has this player already used a Fickle Finger of Fate bonus this turn (on any copy)? */
function ffofUsed(s: GameState, victim: string): boolean {
  return Object.values(s.cards).some((c) => c.cardId === 'fickle-finger-of-fate' && c.zone === 'table' && zappedPlayer(s, c.iid) === victim && c.data?.usedTurn === s.turn);
}
registerChoice('ffof-bonus', {
  resolve(s, pl, picked, data) {
    const zap = data.zap as string;
    if (picked[0] !== 'use' || !s.cards[zap] || s.attack?.id !== data.attack) return;
    s.cards[zap].data = { ...s.cards[zap].data, usedTurn: s.turn, bonusAttack: data.attack };
    log(s, `${player(s, pl).name} uses the Fickle Finger of Fate: +10 to this attack by their Illuminati.`, pl);
  },
  // The computer takes the bonus on the first attack: a later one is not guaranteed.
  ai: () => ['use'],
});

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
  // "Satellites" names the category: every Satellite Resource of any set (the Weather Satellite, and the
  // Killer, Power and Spy Satellites of this pack); the Orbital Mind Control Lasers is named in full.
  'hubble-trouble': freezePlot({
    match: [{ attributes: ['Space'] }, { attributes: ['Science'] }],
    resources: [...Object.values(CARDS).filter((c) => c.type === 'Resource' && /Satellite/.test(c.name)).map((c) => c.id), 'orbital-mind-control-lasers'],
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
// "Use this card when you are entitled to take over a Resource": it stands in for that takeover, and the
// Artifact comes from the Group deck instead of the hand. A player is entitled to take over a Resource
// at two moments: his automatic takeover (mode 'takeover', played in the window right before it: the
// turn's automatic takeover is used up) and his once-per-turn Resource play in his main phase (mode
// 'resource': it costs the Illuminati action that play costs). The player picks the Artifact and, for a
// Magic one, which Magic Groups spend their actions (6 Power in total).

/** A Magic Artifact: "Magic" is part of a Resource's kind line (its `uniqueness`), not an attribute. */
const isMagicCard = (s: GameState, c: string) => /\bMagic\b/.test(def(s, c).uniqueness ?? '') || hasAttr(s, c, 'Magic');
function magicPool(s: GameState, pl: string): string[] {
  return structureCards(s, pl).filter((g) => own(s, pl, g) && s.cards[g].tokens > 0 && hasAttr(s, g, 'Magic'));
}
/** A set of Magic Groups able to pay 6 Power (fewest, strongest first), or null. */
function magicPayers(s: GameState, pl: string): string[] | null {
  const pool = magicPool(s, pl).sort((a, b) => power(s, a) - power(s, b));
  const one = pool.find((g) => power(s, g) >= 6);
  if (one) return [one];
  let total = 0; const picks: string[] = [];
  for (const g of [...pool].reverse()) { if (total >= 6) break; picks.push(g); total += power(s, g); }
  return total >= 6 ? picks : null;
}
function graveRobbersOptions(s: GameState, pl: string): string[] {
  return player(s, pl).groupDeck.filter((iid) => def(s, iid).type === 'Resource' && isArtifact(def(s, iid).uniqueness)
    && canEnterPlay(s, iid, pl) && (!isMagicCard(s, iid) || !!magicPayers(s, pl))
    && !anyHook(s, (h, self) => !!h.forbidAttack?.(s, self, undefined, iid, 'takeover', pl)));
}
function graveRobbersMode(s: GameState, play: PlotPlay): 'takeover' | 'resource' {
  if (play.mode === 'takeover' || play.mode === 'resource') return play.mode;
  return (eventNow(s) ?? remembered(s, play))?.type === 'drawn' ? 'takeover' : 'resource';
}
registerPlots({
  'grave-robbers': {
    timing: ['anytime', 'event'],
    events: ['drawn'],
    needs: { mode: ['takeover', 'resource'] },
    check(s, pl, play, ctx) {
      if (ctx || s.attack) return 'Grave Robbers is not played during an attack.';
      if (activePlayer(s).id !== pl) return 'Play this in your own turn, when you may take over a Resource.';
      if (graveRobbersMode(s, play) === 'takeover') {
        const e = eventNow(s);
        if (!e || e.type !== 'drawn' || e.player !== pl) return 'Play this for your automatic takeover, right after your start-of-turn draws.';
        if (s.turnFlags.takeoverDone || s.turnFlags.noTakeover || s.turnFlags.restricted) return 'You have no automatic takeover left this turn.';
      } else {
        if (s.phase !== 'main' || s.window) return 'Play this in your main phase, as your Resource play for the turn (or for your automatic takeover).';
        if (s.turnFlags.resourcePlayed) return 'You have already brought a Resource into play this turn.';
        if (s.cards[player(s, pl).illuminati].tokens < 1) return 'Bringing a Resource into play costs an action of your Illuminati.';
        if (s.turnFlags.illuminatiLocked === pl) return 'Your Illuminati\'s token cannot be spent this turn except to buy a Plot card.';
      }
      return graveRobbersOptions(s, pl).length ? null : 'You have no Artifact in your Group deck that you could bring into play.';
    },
    apply(s, pl, play) {
      const mode = graveRobbersMode(s, play);
      remember(s, play);
      if (mode === 'takeover') { s.turnFlags.takeoverDone = true; return; }
      s.cards[player(s, pl).illuminati].tokens--;
      s.turnFlags.resourcePlayed = true;
    },
    resolve(s, pl) {
      const opts = graveRobbersOptions(s, pl);
      if (!opts.length) { log(s, 'Grave Robbers finds no Artifact to bring into play.', pl); return; }
      log(s, `${player(s, pl).name} searches their Group deck with Grave Robbers.`, pl);
      askChoice(s, pl, {
        key: 'grave-robbers', question: 'Grave Robbers: bring which Artifact into play?', min: 1, max: 1,
        options: opts.map((c) => ({ id: c, label: `${cardName(s, c)}${isMagicCard(s, c) ? ' (Magic: costs Magic actions worth 6 Power)' : ''}` })),
      });
    },
  },
});
function robGrave(s: GameState, pl: string, c: string, payers: string[]) {
  for (const g of payers) s.cards[g].tokens--;
  player(s, pl).groupDeck = player(s, pl).groupDeck.filter((x) => x !== c);
  s.cards[c].zone = 'hand';
  player(s, pl).hand.push(c);
  playResourceCard(s, c, pl);
  // "If it has actions, it starts with a full complement of Action tokens."
  const card = s.cards[c] as { zone: string; cardId: string; tokens: number };
  if (card.zone === 'resources' && HOOKS[card.cardId]?.hasAction) card.tokens = 1;
  log(s, `${player(s, pl).name} robs a grave for ${cardName(s, c)}${payers.length ? `, paid by ${payers.map((g) => cardName(s, g)).join(', ')}` : ''}.`, pl);
}
registerChoice('grave-robbers', {
  resolve(s, pl, picked) {
    const c = picked[0];
    if (!c || !graveRobbersOptions(s, pl).includes(c)) return;
    if (!isMagicCard(s, c)) { robGrave(s, pl, c, []); return; }
    askGraveRobbersPayers(s, pl, c);
  },
});
function askGraveRobbersPayers(s: GameState, pl: string, c: string, again = false) {
  const pool = magicPool(s, pl);
  askChoice(s, pl, {
    key: 'grave-robbers-pay', min: 1, max: pool.length,
    question: `${again ? 'Those do not add up to 6 Power. ' : ''}${cardName(s, c)} is Magic: choose Magic Groups of yours to spend their actions, 6 Power in total.`,
    options: pool.map((g) => ({ id: g, label: `${cardName(s, g)} (Power ${power(s, g)})` })), data: { card: c },
  });
}
registerChoice('grave-robbers-pay', {
  resolve(s, pl, picked, data) {
    const c = data.card as string;
    if (!player(s, pl).groupDeck.includes(c)) return;
    const ok = picked.every((g) => magicPool(s, pl).includes(g));
    if (!ok || totalPower(s, picked) < 6) { if (magicPayers(s, pl)) askGraveRobbersPayers(s, pl, c, true); return; }
    robGrave(s, pl, c, picked);
  },
  ai: (s, pl) => magicPayers(s, pl) ?? [],
});

// ================================================================== Go Fish
// Official errata: anyone who has received a Plot card from a rival, or been forced to show a rival a
// hidden Plot in his hand or deck, is immune to Go Fish until the end of his next turn. The engine tracks
// that wherever it happens (game.ts shieldFromGoFish: deals, trades, thefts, looks and exposures). Only
// hidden Plots are affected (Card FAQ): a named Plot the rival holds only exposed does not count.

registerPlots({
  'go-fish': {
    timing: ['anytime'],
    needs: { target: 'rival', mode: [] },
    check(s, pl, play) {
      const t = play.target ? s.cards[play.target] : undefined;
      const victim = t?.controller;
      if (!t || t.zone !== 'structure' || def(s, play.target!).type !== 'Illuminati' || !victim || victim === pl) return 'Name a rival.';
      if (!play.mode || !CARDS[play.mode] || CARDS[play.mode].type !== 'Plot') return 'Name a Plot card.';
      if (goFishShielded(s, victim)) return `${player(s, victim).name} is immune to Go Fish until the end of their next turn.`;
      return null;
    },
    apply() {},
    resolve(s, pl, play) {
      const victim = s.cards[play.target!]?.controller;
      if (!victim) return;
      const named = play.mode!;
      const vp = player(s, victim);
      const hidden = vp.hand.filter((c) => ['Plot', 'Illuminati'].includes(def(s, c).type) && !s.cards[c].exposed);
      const matching = hidden.filter((c) => s.cards[c].cardId === named);
      revealTo(s, pl, hidden, `Go Fish: ${vp.name}'s hidden Plots`);
      if (!matching.length) {
        const shown = exposeCards(s, player(s, pl).hand.filter((c) => ['Plot', 'Illuminati'].includes(def(s, c).type)));
        log(s, `${player(s, pl).name} plays Go Fish naming ${CARDS[named].name} against ${vp.name}, who has none hidden: ${player(s, pl).name}'s Plots are exposed${shown.length ? ` (${shown.map((c) => cardName(s, c)).join(', ')})` : ''}.`, pl);
        return;
      }
      let discarded = 0;
      for (const c of matching) {
        vp.hand = vp.hand.filter((x) => x !== c);
        Object.assign(s.cards[c], { zone: 'hand', exposed: false });
        if (s.common) s.cards[c].owner = pl;
        player(s, pl).hand.push(c);
        for (let i = 0; i < 2; i++) if (discardDeckTop(s, victim, 'plot')) discarded++;
      }
      shieldFromGoFish(s, pl); // he has now received Plots from a rival
      log(s, `${player(s, pl).name} plays Go Fish naming ${CARDS[named].name} against ${vp.name}: ${matching.length} card${matching.length === 1 ? '' : 's'} handed over, and ${discarded} undrawn Plot${discarded === 1 ? '' : 's'} discarded.`, pl);
    },
  },
});

// ================================================================== Go, Lemmings, Go!
// Answers any discard of Plots or Group cards, from a hand or a deck, made to pay for a Plot or a
// special ability (the engine announces every such cost with noteCostDiscard, base-game cards included).
// One card discarded: two more of the same kind; several: as many again of each kind, from the same place.
// Extra hand discards are chosen by the victim, made up from his deck if his hand runs short; extra deck
// discards come from the deck only (never from the hand, even if the deck runs out).

type CostPart = { kind: 'plot' | 'group'; place: 'hand' | 'deck'; cards: string[] };
const kindOf = (s: GameState, c: string): 'plot' | 'group' => (['Plot', 'Illuminati'].includes(def(s, c).type) ? 'plot' : 'group');
function lemmingsDeckDiscards(s: GameState, victim: string, kind: 'plot' | 'group', n: number): number {
  let done = 0;
  while (done < n && discardDeckTop(s, victim, kind)) done++;
  return done;
}
function goLemmingsParts(e: GameEvent): CostPart[] {
  const d = (e.data ?? {}) as { parts?: CostPart[]; kind?: 'plot' | 'group'; place?: 'hand' | 'deck' };
  return d.parts ?? [{ kind: d.kind ?? 'plot', place: d.place ?? 'hand', cards: e.cards ?? [] }];
}
registerPlots({
  'go-lemmings-go': {
    timing: ['event'],
    events: ['costDiscard'],
    check(s, pl) {
      const e = eventNow(s);
      if (!e || e.type !== 'costDiscard' || !e.player || e.player === pl) return 'Play this right after a rival discards cards to pay for a Plot or a special ability.';
      if (player(s, e.player).eliminated) return 'That player is out of the game.';
      return null;
    },
    apply(s, _pl, play) { remember(s, play); },
    resolve(s, _pl, play) {
      const e = remembered(s, play);
      if (!e?.player || !e.cards?.length || player(s, e.player).eliminated) return;
      const victim = e.player;
      const parts = goLemmingsParts(e);
      const total = parts.reduce((n, x) => n + x.cards.length, 0);
      let fromDeck = 0;
      const handDue: { kind: 'plot' | 'group'; n: number }[] = [];
      for (const part of parts) {
        const n = total === 1 ? 2 : part.cards.length;
        if (part.place === 'deck') fromDeck += lemmingsDeckDiscards(s, victim, part.kind, n);
        else handDue.push({ kind: part.kind, n });
      }
      if (fromDeck) log(s, `Go, Lemmings, Go!: ${player(s, victim).name} discards ${fromDeck} more card${fromDeck === 1 ? '' : 's'} from their deck, for no benefit.`, victim);
      for (const due of handDue) askLemmingsHand(s, victim, due.kind, due.n);
    },
  },
});
function askLemmingsHand(s: GameState, victim: string, kind: 'plot' | 'group', n: number) {
  const hand = player(s, victim).hand.filter((c) => kindOf(s, c) === kind && !s.cards[c].data?.lockedInHand);
  if (hand.length <= n) {
    // No choice to make: the whole hand of that kind goes, and the deck makes up the difference.
    for (const c of hand) discardCard(s, c);
    const more = lemmingsDeckDiscards(s, victim, kind, n - hand.length);
    if (hand.length + more) log(s, `Go, Lemmings, Go!: ${player(s, victim).name} discards ${hand.length + more} more ${kind === 'plot' ? 'Plot' : 'Group'} card${hand.length + more === 1 ? '' : 's'}, for no benefit.`, victim);
    return;
  }
  askChoice(s, victim, {
    key: 'lemmings-hand', min: n, max: n,
    question: `Go, Lemmings, Go!: discard ${n} more ${kind === 'plot' ? 'Plot' : 'Group'} card${n === 1 ? '' : 's'} from your hand. Choose which.`,
    options: hand.map((c) => ({ id: c, label: cardName(s, c) })), data: { kind, n },
  });
}
registerChoice('lemmings-hand', {
  resolve(s, pl, picked, data) {
    const kind = data.kind as 'plot' | 'group';
    const gone = picked.filter((c) => player(s, pl).hand.includes(c) && kindOf(s, c) === kind);
    for (const c of gone) discardCard(s, c);
    log(s, `Go, Lemmings, Go!: ${player(s, pl).name} discards ${gone.length} more card${gone.length === 1 ? '' : 's'} from hand, for no benefit.`, pl);
  },
  // The computer gives up the cards with the lowest printed Power first (Plots have none: hand order).
  ai: (s, _pl, options, data) => [...options].sort((a, b) => (def(s, a.id).power ?? 0) - (def(s, b.id).power ?? 0)).slice(0, data.n as number).map((o) => o.id),
});

// ================================================================== Near Miss
// Played when a Place is destroyed, by any means (Card FAQ: Disasters, attacks, World War III, backfires
// …): the destruction becomes a mere Devastation. Right after the roll of an attack that is destroying a
// Place ('save' in the roll window) the attack only Devastates; once a Place has been destroyed ('save'
// in the response window of its destruction) it comes back to where it was, Devastated, with its puppets
// and linked cards. Or ('clear') it removes a Place's Devastation. Two Near Misses never make a complete
// miss: a Place a Near Miss saved this turn cannot have that Devastation cleared by another. A Place
// that cannot be destroyed anyway (cannotBeDestroyed, preventDestroy) needs no Near Miss.

function indestructible(s: GameState, t: string, ctx?: AttackCtx): boolean {
  return abilitiesOf(s, t).some((a) => a.kind === 'cannotBeDestroyed') || anyHook(s, (h, self) => !!h.preventDestroy?.(s, self, t, ctx));
}
/** Why this attack, as it stands after the roll, is not about to destroy its target Place (null if it is). */
function destroyingPlace(s: GameState, ctx: AttackCtx): string | null {
  if (!ctx.roll) return 'Play this right after the roll, when the attack would destroy a Place.';
  if (ctx.type !== 'destroy' || !s.cards[ctx.target] || s.cards[ctx.target].zone !== 'structure' || def(s, ctx.target).subtype !== 'Place') return 'This attack is not trying to destroy a Place.';
  if (currentOutcome(s, ctx) !== 'success') return 'This attack is not currently succeeding.';
  if (indestructible(s, ctx.target, ctx)) return `${cardName(s, ctx.target)} cannot be destroyed anyway.`;
  if (ctx.disaster) {
    const margin = attackStrength(s, ctx).strength - finalRoll(ctx);
    if (ctx.disaster.devastateOnly || ctx.disaster.destroyMargin === null || margin < ctx.disaster.destroyMargin) return 'This Disaster will only Devastate the Place, not destroy it.';
  }
  return null;
}
type Layout = { iid: string; master?: string; side?: Side }[];
function destroyedPlaceEvent(s: GameState, e: GameEvent | undefined): string | null {
  if (!e || e.type !== 'destroyed' || !e.card || !s.cards[e.card]) return 'Play this right after a Place is destroyed.';
  if (def(s, e.card).subtype !== 'Place' || s.cards[e.card].zone !== 'destroyed') return 'Play this right after a Place is destroyed.';
  if (s.cards[e.card].data?.neverReturns || s.cards[e.card].data?.removedFromGame) return `${cardName(s, e.card)} is gone for good.`;
  const spot = ((e.data as { layout?: Layout } | undefined)?.layout ?? [])[0];
  const m = spot?.master ? s.cards[spot.master] : undefined;
  if (!spot || !m || m.zone !== 'structure' || !e.player || m.controller !== e.player || !spot.side || !openArrows(s, spot.master!).includes(spot.side)) {
    return `${cardName(s, e.card)} has no place left to come back to.`;
  }
  return null;
}
function unDestroy(s: GameState, pl: string, e: GameEvent) {
  const place = e.card!;
  const owner = e.player!;
  const data = (e.data ?? {}) as { layout?: Layout; links?: { iid: string; zone: string; controller?: string }[] };
  const layout = data.layout ?? [];
  const spot = layout[0];
  placeGroup(s, place, owner, spot.master!, spot.side!);
  Object.assign(s.cards[place], { devastated: true, tokens: 0, killed: false });
  for (const x of s.players) x.destroyedCredit = x.destroyedCredit.filter((d) => d !== place);
  // Its puppets had gone back to hand: they come back where they were, where there is still room.
  for (const l of layout.slice(1)) {
    const c = s.cards[l.iid];
    const m = l.master ? s.cards[l.master] : undefined;
    if (!c || c.zone !== 'hand' || !player(s, owner).hand.includes(l.iid) || !m || m.zone !== 'structure' || m.controller !== owner || !l.side || !openArrows(s, l.master!).includes(l.side)) continue;
    placeGroup(s, l.iid, owner, l.master!, l.side);
    s.cards[l.iid].tokens = 0;
  }
  // So do the cards that were linked to it.
  for (const l of data.links ?? []) {
    const c = s.cards[l.iid];
    if (!c) continue;
    if (l.zone === 'resources' && c.zone === 'destroyed') {
      for (const x of s.players) x.destroyedCredit = x.destroyedCredit.filter((d) => d !== l.iid);
      Object.assign(c, { zone: 'resources', controller: owner, linkedTo: place, tokens: 0 });
    } else if (l.zone === 'table' && c.zone === 'discard') {
      for (const x of s.players) x.discard = x.discard.filter((d) => d !== l.iid);
      if (s.common) s.common.plotDiscard = s.common.plotDiscard.filter((d) => d !== l.iid);
      Object.assign(c, { zone: 'table', controller: l.controller, linkedTo: place });
    }
  }
  s.cards[place].data = { ...s.cards[place].data, nearMissTurn: s.turn };
  log(s, `Near Miss: ${cardName(s, place)} is only Devastated after all, and is back in ${player(s, owner).name}'s Power Structure.`, pl);
}
function nearMissMode(s: GameState, play: PlotPlay, ctx?: AttackCtx): 'save' | 'clear' {
  if (play.mode === 'save' || play.mode === 'clear') return play.mode;
  return ctx?.roll || eventNow(s)?.type === 'destroyed' ? 'save' : 'clear';
}
registerPlots({
  'near-miss': {
    timing: ['roll', 'anytime', 'event'],
    events: ['destroyed', 'devastated'],
    needs: { target: 'place', mode: ['save', 'clear'] },
    check(s, _pl, play, ctx) {
      const mode = nearMissMode(s, play, ctx);
      if (mode === 'save') {
        if (ctx) {
          const why = destroyingPlace(s, ctx);
          if (why) return why;
          if (ctx.plays.some((p) => s.cards[p.iid]?.cardId === 'near-miss' && !isCancelled(ctx.plays, p.iid))) return 'Only one Near Miss can help against this attack.';
          return null;
        }
        return destroyedPlaceEvent(s, eventNow(s));
      }
      if (ctx) return 'Removing Devastation is not part of an attack.';
      if (!inPlay(s, play.target) || def(s, play.target!).subtype !== 'Place' || !s.cards[play.target!].devastated) return 'Choose a Devastated Place.';
      if (s.attack && s.attack.target === play.target) return 'That Place was just Devastated: wait until this attack is over.';
      // Two Near Misses together never turn a destruction into a complete miss.
      if (s.cards[play.target!].data?.nearMissTurn === s.turn) return 'A Near Miss has already turned this Place\'s destruction into Devastation: a second one cannot clear it.';
      return null;
    },
    apply(s, _pl, play, ctx) {
      s.cards[play.card].data = { ...s.cards[play.card].data, mode: nearMissMode(s, play, ctx) };
      if (ctx) {
        ctx.disaster = { destroyMargin: ctx.disaster?.destroyMargin ?? null, devastateOnly: true };
        s.cards[ctx.target].data = { ...s.cards[ctx.target].data, nearMissTurn: s.turn };
      } else remember(s, play);
    },
    resolve(s, pl, play) {
      if (s.cards[play.card].data?.mode === 'save') {
        const e = remembered(s, play);
        if (!e || destroyedPlaceEvent(s, e)) { log(s, 'Near Miss comes too late: the Place cannot come back.', pl); return; }
        unDestroy(s, pl, e);
        return;
      }
      if (!play.target || !s.cards[play.target]?.devastated) return;
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
  const hand = (payWith ?? []).filter((c) => p.hand.includes(c));
  const deck = (payWith ?? []).filter((c) => !p.hand.includes(c));
  for (const c of deck) { p.plotDeck = p.plotDeck.filter((x) => x !== c); s.cards[c].zone = 'hand'; p.hand.push(c); }
  for (const c of payWith ?? []) discardCard(s, c);
  noteCostDiscard(s, pl, [{ kind: 'plot', place: 'hand', cards: hand }, { kind: 'plot', place: 'deck', cards: deck }]);
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
// On your own turn, with a duplicate of a Huge Place in play in your hand: take the duplicate over
// automatically (mode 'takeover': it goes on an open arrow you name) or attack it to control from your
// hand (mode 'attack': `helper` is the attacking Group, a real Attack to Control that may fail). Once the
// duplicate is in play the Place is split: two non-Huge Places, each with half the printed Power (rounded
// up), each with +10 attacking the other (game.ts attackStrength). Agents cards work normally against
// either (they share the card). The halves are reunited with the `reunitePartition` action (game.ts),
// once one controls the other. Names given to the halves have no effect on play (Card FAQ), so the
// engine does not ask for any.

const partitionOriginal = (s: GameState, t: string) => Object.values(s.cards).find((c) => c.zone === 'structure' && c.cardId === s.cards[t].cardId && c.iid !== t)?.iid;
function splitPlace(s: GameState, pl: string, t: string, orig: string) {
  const half = Math.ceil((def(s, t).power ?? 0) / 2);
  for (const iid of [t, orig]) {
    s.cards[iid].mods = [
      ...s.cards[iid].mods.filter((m) => m.source !== 'partition'),
      { source: 'partition', kind: 'setPower', value: half, lower: true, until: 'permanent' },
      { source: 'partition', kind: 'removeAttr', attr: 'Huge', until: 'permanent' },
    ];
    s.cards[iid].data = { ...s.cards[iid].data, partitionPair: iid === t ? orig : t };
  }
  log(s, `Partition splits ${cardName(s, t)} in two: each half has ${half} Power and is no longer Huge.`, pl);
}
registerPlots({
  'partition': {
    timing: ['anytime'],
    needs: { target: 'handGroup', mode: ['takeover', 'attack'], helper: true },
    check(s, pl, play, ctx) {
      if (ctx || s.attack || s.phase !== 'main' || activePlayer(s).id !== pl) return 'Play this on your own turn, outside an attack.';
      const t = play.target;
      if (!t || !inHand(s, pl, t) || def(s, t).subtype !== 'Place' || !hasAttr(s, t, 'Huge')) return 'Choose a Huge Place card from your hand.';
      if (!partitionOriginal(s, t)) return 'No copy of that Place is in play to partition.';
      if ((play.mode ?? 'takeover') === 'attack') {
        const a = play.helper;
        if (!a) return 'Choose the Group of yours that attacks to control it.';
        return validateAttack(s, pl, { type: 'attack', attackType: 'control', attacker: a, target: t }, { partitionOf: partitionOriginal(s, t) });
      }
      const onto = play.helper;
      if (anyHook(s, (h, self) => !!h.forbidAttack?.(s, self, undefined, t, 'takeover', pl))) return 'A card in play forbids that automatic takeover.';
      if (!partitionSpots(s, pl, t).length) return 'You have no open arrow to place it on.';
      if (onto && !partitionSpots(s, pl, t).some((x) => x.onto === onto)) return `${cardName(s, onto)} has no open arrow for it.`;
      return null;
    },
    apply() {},
    resolve(s, pl, play) {
      const t = play.target!;
      const orig = partitionOriginal(s, t);
      if (!inHand(s, pl, t) || !orig) return;
      if ((play.mode ?? 'takeover') === 'attack') {
        // A real Attack to Control from hand; the split happens if it succeeds (the hook below).
        s.cards[play.card].linkedTo = `attack:${s.attackCounter + 1}`;
        s.cards[play.card].data = { ...s.cards[play.card].data, partition: t, orig };
        startAttack(s, pl, { type: 'attack', attackType: 'control', attacker: play.helper!, target: t }, { partitionOf: orig });
        return;
      }
      const spots = partitionSpots(s, pl, t);
      const spot = spots.find((x) => x.onto === play.helper) ?? spots[0];
      if (!spot) return;
      placeGroup(s, t, pl, spot.onto, spot.side);
      s.cards[t].tokens = 0;
      s.cards[t].capturedTurn = s.turn;
      log(s, `${player(s, pl).name} takes over a duplicate ${cardName(s, t)} automatically.`, pl);
      splitPlace(s, pl, t, orig);
    },
  },
});
function partitionSpots(s: GameState, pl: string, t: string): { onto: string; side: Side }[] {
  return structureCards(s, pl).filter((m) => !isParalyzed(s, m)).flatMap((m) => openArrows(s, m).map((side) => ({ onto: m, side })))
    .filter((x) => !masterProblem(s, t, x.onto));
}
registerHooks({
  'partition': {
    onAttackEnd(s, self, ctx) {
      if (s.cards[self].linkedTo !== `attack:${ctx.id}`) return;
      const d = s.cards[self].data as { partition?: string; orig?: string } | undefined;
      const t = d?.partition, orig = d?.orig;
      if (ctx.result === 'success' && !attackCancelled(ctx) && t && orig && s.cards[t]?.zone === 'structure' && s.cards[orig]?.zone === 'structure') {
        splitPlace(s, ctx.attackerPlayer, t, orig);
      }
      discardCard(s, self);
    },
  },
});
