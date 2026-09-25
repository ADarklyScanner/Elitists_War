// Encoded by the card-content pass. See docs/CARD_SCRIPTING.md.
// Plot cards that need the event/choice/target engine features (batch 2).
import type { GameEvent, GameState, PlotPlay, Side } from '../types';
import type { PlotHandler } from '../plotTypes';
import { registerPlots } from '../plotTypes';
import { registerChoice, registerHooks } from '../hooks';
import { cardName, def } from '../cards';
import { type Match, matches } from '../abilities';
import { alignments, power } from '../stats';
import { SIDES, openArrows, outSides, puppets, rotate, structureCards, subtree } from '../geometry';
import {
  activePlayer, askChoice, discardCard, livePlayers, log, placeGroup, player, protectedPlayer, revealTo,
  startAttack, validateAttack,
} from '../game';
import { exposableHand, exposeCards } from '../game';

// ---------------------------------------------------------------- helpers (as in plots.ts)

const own = (s: GameState, pl: string, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure' && s.cards[iid].controller === pl;
const isGroup = (s: GameState, iid?: string) => !!iid && !!s.cards[iid] && def(s, iid).type === 'Group';
const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';

function spend(s: GameState, pl: string, groups: string[] = []): string | null {
  for (const g of groups) if (!own(s, pl, g) || s.cards[g].tokens < 1) return 'Every paying Group must be yours and have an Action token.';
  if (new Set(groups).size !== groups.length) return 'A Group can only pay once.';
  return null;
}
function pay(s: GameState, groups: string[] = []) { for (const g of groups) s.cards[g].tokens--; }
const totalPower = (s: GameState, groups: string[] = []) => groups.reduce((n, g) => n + power(s, g), 0);

/** Exactly one of your Groups (or the Illuminati, if `ill`) with a token, matching `ok`. */
function oneActor(s: GameState, pl: string, payWith: string[] | undefined, ok: (g: string) => boolean, what: string): string | null {
  const err = spend(s, pl, payWith);
  if (err) return err;
  if (payWith?.length !== 1 || !ok(payWith[0])) return `Pay with the action of ${what}.`;
  return null;
}

const illum = (s: GameState, pl: string) => player(s, pl).illuminati;
function illuminatiAction(s: GameState, pl: string): string | null {
  return s.cards[illum(s, pl)].tokens < 1 ? 'This costs your Illuminati\'s action, and it has no Action token.' : null;
}

/** The event whose window is open (while checking/applying), or the one stashed on the card (while resolving). */
function eventOf(s: GameState, play: PlotPlay): GameEvent | undefined {
  if (s.window?.kind === 'event' && s.window.event) return s.window.event;
  if (s.window?.kind === 'plot' && s.window.event) return s.window.event;
  return s.cards[play.card]?.data?.event as GameEvent | undefined;
}
/** Remember the event on the card itself: the window is gone by the time the Plot resolves. */
function stashEvent(s: GameState, play: PlotPlay) {
  const e = eventOf(s, play);
  s.cards[play.card].data = { ...s.cards[play.card].data, event: e };
}

/** "At the very start of another player's turn." */
function rivalTurnStart(s: GameState, pl: string, play: PlotPlay): string | null {
  const e = eventOf(s, play);
  if (e?.type !== 'turnStart' || !e.player) return 'Play this at the very start of another player\'s turn.';
  if (e.player === pl) return 'Play this at the start of another player\'s turn, not your own.';
  if (protectedPlayer(s, pl, e.player)) return 'That player has not finished a first turn yet.';
  return null;
}

/** Take a Group (and its puppets) out of play without destroying it: puppets go back to the controller's hand. */
function discardFromPlay(s: GameState, g: string) {
  const c = s.cards[g];
  const prev = c.controller ?? c.owner;
  for (const p of puppets(s, g)) {
    for (const x of subtree(s, p)) {
      Object.assign(s.cards[x], { zone: 'hand', controller: undefined, master: undefined, x: undefined, y: undefined, tokens: 0 });
      player(s, prev).hand.push(x);
    }
  }
  for (const other of Object.values(s.cards)) if (other.linkedTo === g && (other.zone === 'table' || other.zone === 'resources')) discardCard(s, other.iid);
  Object.assign(c, { x: undefined, y: undefined, master: undefined, mods: [], devastated: false });
  discardCard(s, g);
}

const SIDE_NAMES = SIDES as string[];
const nowSide = (s: GameState, g: string, world: Side): Side => rotate(world, (4 - (s.cards[g].rot ?? 0)) % 4); // world -> printed
/** Printed sides of a Group that could still get an outgoing arrow. */
function freePrintedSides(s: GameState, g: string): Side[] {
  const d = def(s, g);
  const have = new Set<Side>([...(d.arrowsOut ?? []), ...s.cards[g].mods.filter((m) => m.kind === 'addArrow' && m.side).map((m) => m.side!)]);
  return SIDES.filter((sd) => sd !== d.arrowIn && !have.has(sd));
}
/** "This uses an action of that Group or its master." */
function groupOrMaster(s: GameState, pl: string, target: string, payWith: string[] | undefined): string | null {
  return oneActor(s, pl, payWith, (g) => g === target || g === s.cards[target].master, 'that Group or of its master');
}
function ownTurnNoAttack(s: GameState, pl: string, ctx: unknown): string | null {
  if (activePlayer(s).id !== pl) return 'Play this during your own turn.';
  if (ctx) return 'Play this outside attacks.';
  return null;
}

// ---------------------------------------------------------------- the cards

registerPlots({
  // One of your Personalities has just been destroyed: it survives as a head in a jar (linked).
  'head-in-a-jar': {
    timing: ['event'],
    events: ['destroyed'],
    linked: true,
    check(s, pl, play) {
      const e = eventOf(s, play);
      const p = e?.card;
      if (e?.type !== 'destroyed' || !p || e.player !== pl || def(s, p).subtype !== 'Personality') return 'Play this right after one of your Personalities is killed.';
      if (s.cards[p].zone !== 'destroyed') return 'That Personality is no longer in the destroyed pile.';
      if (s.cards[p].data?.neverReturns) return 'That Personality is gone for good and cannot come back.';
      if (!jarSpot(s, pl, e)) return 'There is no open control arrow in your Power Structure to keep it on.';
      return null;
    },
    apply: (s, _pl, play) => stashEvent(s, play),
    resolve(s, pl, play) {
      const e = eventOf(s, play);
      const p = e?.card;
      const spot = e && jarSpot(s, pl, e);
      if (!p || !spot || s.cards[p].zone !== 'destroyed') { log(s, 'Head in a Jar finds nothing to keep alive.', pl); return; }
      Object.assign(s.cards[p], { killed: false, tokens: 0, mods: [] });
      placeGroup(s, p, pl, spot.master, spot.side);
      for (const x of s.players) x.destroyedCredit = x.destroyedCredit.filter((d) => d !== p);
      s.cards[play.card].linkedTo = p;
      // Back in its old place, it keeps the puppets it had (they had gone back to hand).
      let back = 0;
      if (spot.original) {
        for (const l of layoutOf(e).slice(1)) {
          const c = s.cards[l.iid];
          const m = l.master ? s.cards[l.master] : undefined;
          if (!c || c.zone !== 'hand' || !player(s, pl).hand.includes(l.iid) || !m || !inPlay(s, l.master) || m.controller !== pl) continue;
          const side = l.side;
          if (!side || !openArrows(s, l.master!).includes(side)) continue;
          placeGroup(s, l.iid, pl, l.master!, side);
          back++;
        }
      }
      log(s, `${cardName(s, p)} lives on as a head in a jar${back ? ` and keeps ${back} puppet${back === 1 ? '' : 's'}` : ''}.`, pl);
    },
  },

  // 'i-lied' is not encoded: it only answers a sale or trade agreed between players (letting you back out of your side), and this version has no deals between players.

  // One of your Groups with fewer than 3 outgoing arrows gains one more (mode = the side as seen on the table).
  'let-s-get-organized': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'ownGroup', mode: SIDE_NAMES, pay: 'tokens' },
    check(s, pl, play, ctx) {
      const err = ownTurnNoAttack(s, pl, ctx);
      if (err) return err;
      const t = play.target;
      if (!own(s, pl, t) || !isGroup(s, t)) return 'Choose a Group you control.';
      if (outSides(s, t!).length >= 3) return 'That Group already has 3 outgoing control arrows.';
      if (Object.values(s.cards).some((c) => c.cardId === 'let-s-get-organized' && c.zone === 'table' && c.linkedTo === t)) return 'That Group already has a Let\'s Get Organized; a second one cannot be used on it.';
      const side = organizeSide(s, play);
      if (!side) return 'Choose a side of the Group that has no arrow yet.';
      return groupOrMaster(s, pl, t!, play.payWith);
    },
    apply(s, _pl, play) {
      pay(s, play.payWith);
      s.cards[play.card].data = { side: organizeSide(s, play) };
    },
    resolve(s, pl, play) {
      const t = play.target!;
      const side = s.cards[play.card].data?.side as Side | undefined;
      if (!own(s, pl, t) || !side) return;
      s.cards[t].mods.push({ source: play.card, kind: 'addArrow', side, until: 'permanent' });
      s.cards[play.card].linkedTo = t;
      log(s, `${cardName(s, t)} gains an extra control arrow.`, pl);
    },
  },

  // One of your Groups with one or two outgoing arrows gets arrows on all three free sides.
  'let-s-get-really-organized': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'ownGroup', pay: 'tokens' },
    check(s, pl, play, ctx) {
      const err = ownTurnNoAttack(s, pl, ctx);
      if (err) return err;
      const t = play.target;
      if (!own(s, pl, t) || !isGroup(s, t)) return 'Choose a Group you control.';
      const n = outSides(s, t!).length;
      if (n < 1 || n > 2) return 'Choose a Group with one or two outgoing control arrows.';
      return groupOrMaster(s, pl, t!, play.payWith);
    },
    apply: (s, _pl, play) => pay(s, play.payWith),
    resolve(s, pl, play) {
      const t = play.target!;
      if (!own(s, pl, t)) return;
      for (const side of freePrintedSides(s, t)) s.cards[t].mods.push({ source: play.card, kind: 'addArrow', side, until: 'permanent' });
      s.cards[play.card].linkedTo = t;
      log(s, `${cardName(s, t)} now has three outgoing control arrows.`, pl);
    },
  },

  // Right after your own Plot that cost actions: one paying Group of Power 6 or less (not the Illuminati)
  // gets its action back. Costs the top card of your Plot deck; once per turn.
  // target = the Plot just played; targets = [the Group whose action is replaced].
  'march-on-washington': {
    timing: ['counter'],
    needs: { target: 'plot', targets: true },
    check(s, pl, play, ctx) {
      const plays = s.window?.kind === 'plot' ? s.window.plays ?? [] : ctx?.plays ?? [];
      const pp = plays.find((x) => x.iid === play.target);
      if (!pp || pp.player !== pl || pp.ability || pp.iid === play.card || !s.cards[pp.iid] || def(s, pp.iid).type !== 'Plot') return 'Play this together with one of your own Plots that required actions.';
      const g = play.targets?.[0];
      if (!g || !(pp.play.payWith ?? []).includes(g)) return 'Choose a Group whose action paid for that Plot.';
      if (g === illum(s, pl)) return 'It never replaces an Illuminati action.';
      if (!own(s, pl, g)) return 'That Group is no longer yours.';
      if (power(s, g) > 6) return 'It only replaces the action of a Group with Power 6 or less.';
      if (plays.some((x) => x.iid !== play.card && s.cards[x.iid]?.cardId === 'march-on-washington' && x.play.target === pp.iid)) return 'That Plot already had an action replaced.';
      if (s.cards[illum(s, pl)].data?.marchTurn === s.turn) return 'You may use March on Washington only once per turn.';
      if (!player(s, pl).plotDeck.length) return 'You must discard the top card of your Plot deck, and it is empty.';
      return null;
    },
    apply(s, pl, play) {
      const p = player(s, pl);
      const ill = s.cards[p.illuminati];
      ill.data = { ...ill.data, marchTurn: s.turn };
      const top = p.plotDeck.shift()!;
      s.cards[top].zone = 'hand'; p.hand.push(top); discardCard(s, top);
      const g = play.targets![0];
      s.cards[g].tokens++;
      log(s, `The march stands in for ${cardName(s, g)}, which keeps its action; the top card of the Plot deck is discarded.`, pl);
    },
  },

  // Any Group becomes Media and its Global Power equals its Power (linked). Media Groups with 6+ Power pay.
  'media-connections': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'anyGroup', pay: 'tokens' },
    check(s, pl, play) {
      if (!inPlay(s, play.target) || !isGroup(s, play.target)) return 'Choose a Group in play.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      if (!play.payWith?.length || !play.payWith.every((g) => matches(s, g, { attributes: ['Media'] }))) return 'Pay with the actions of Media Groups.';
      if (totalPower(s, play.payWith) < 6) return 'The paying Media Groups need at least 6 Power in total.';
      return null;
    },
    apply(s, _pl, play, ctx) { pay(s, play.payWith); if (ctx) connect(s, play); },
    resolve: (s, _pl, play) => connect(s, play),
  },

  // After a rival's takeover of a Group from his hand fails: one out-of-turn attack on it at +5.
  // mode = 'control' | 'destroy'; helper = your attacking Group.
  'opportunity-knocks': {
    timing: ['event'],
    events: ['failedTakeover'],
    needs: { mode: ['control', 'destroy'], helper: true },
    check(s, pl, play) {
      const e = eventOf(s, play);
      const g = e?.card;
      if (e?.type !== 'failedTakeover' || !g || !e.player || e.player === pl) return 'Play this right after a rival fails to take over a Group from their hand.';
      if (!player(s, e.player).hand.includes(g) || s.cards[g].zone !== 'hand') return 'That Group is no longer in their hand.';
      if (protectedPlayer(s, pl, e.player)) return 'That player has not finished a first turn yet.';
      if (!play.helper) return 'Choose the Group that makes the attack.';
      return validateAttack(s, pl, knock(s, play, g), { outOfTurn: true, anyHand: true });
    },
    apply: (s, _pl, play) => stashEvent(s, play),
    resolve(s, pl, play) {
      const g = eventOf(s, play)?.card;
      if (!g) return;
      const a = knock(s, play, g);
      const why = s.attack ? 'another attack is under way' : validateAttack(s, pl, a, { outOfTurn: true, anyHand: true });
      if (why) { log(s, `The opportunity is lost: ${why}`, pl); return; }
      startAttack(s, pl, a, { outOfTurn: true, anyHand: true });
      s.attack!.attackBonus.push({ player: pl, amount: 5, label: 'Opportunity Knocks' });
    },
  },

  // Your Illuminati's action: Agents of your Illuminati in play are destroyed. Any other Group's action:
  // it loses 1 Power and 1 Global Power but rivals can never use agents against it (linked).
  'purge': {
    timing: ['anytime'],
    needs: { pay: 'tokens' },
    check(s, pl, play, ctx) {
      if (activePlayer(s).id !== pl) return 'Play this during your own turn.';
      const err = oneActor(s, pl, play.payWith, (g) => g === illum(s, pl) || isGroup(s, g), 'the Group using it');
      if (err) return err;
      if (play.payWith![0] === illum(s, pl)) {
        if (!purgeAgents(s, pl).length) return 'There are no Agents of your Illuminati in play to purge.';
      } else if (ctx) return 'A Group purges itself outside attacks.';
      return null;
    },
    apply(s, _pl, play) { pay(s, play.payWith); },
    resolve(s, pl, play) {
      const g = play.payWith![0];
      if (g === illum(s, pl)) {
        const agents = purgeAgents(s, pl);
        for (const a of agents) Object.assign(s.cards[a], { zone: 'destroyed', controller: undefined, master: undefined, linkedTo: undefined, x: undefined, y: undefined, tokens: 0 });
        log(s, `${agents.length} Agent card${agents.length === 1 ? ' is' : 's are'} purged.`, pl);
        return;
      }
      if (!own(s, pl, g)) return;
      s.cards[g].data = { ...s.cards[g].data, noAgents: true };
      s.cards[play.card].linkedTo = g;
      log(s, `${cardName(s, g)} purges its ranks: weaker, but safe from rival agents.`, pl);
    },
  },

  // Your Illuminati's action: move your Groups freely (without paying) for the rest of this turn.
  'reorganization': {
    timing: ['anytime'],
    check(s, pl, _play, ctx) {
      return ownTurnNoAttack(s, pl, ctx) ?? illuminatiAction(s, pl);
    },
    apply(s, pl) { s.cards[illum(s, pl)].tokens--; },
    resolve(s, pl) {
      s.turnFlags.freeMoves = pl;
      log(s, `${player(s, pl).name} may rearrange the Power Structure freely this turn.`, pl);
    },
  },

  // A rival's automatic takeover from hand: the Group goes back to his hand and no more automatic
  // takeovers for him this turn. Illuminati action, or Groups with 6+ Power, one sharing an alignment.
  'sabotage': {
    timing: ['event'],
    events: ['takeover'],
    needs: { pay: 'tokens' },
    check(s, pl, play) {
      const e = eventOf(s, play);
      const g = e?.card;
      if (e?.type !== 'takeover' || !g || !e.player || e.player === pl) return 'Play this right after a rival\'s automatic takeover.';
      if (!isGroup(s, g) || !own(s, e.player, g)) return 'Only an automatic takeover of a Group that is still in play can be sabotaged.';
      if (protectedPlayer(s, pl, e.player)) return 'That player has not finished a first turn yet.';
      const p = play.payWith ?? [];
      const err = spend(s, pl, p);
      if (err) return err;
      if (p.length === 1 && p[0] === illum(s, pl)) return null;
      if (!p.length || p.includes(illum(s, pl))) return 'Pay with your Illuminati\'s action, or with Groups totalling 6 Power.';
      if (totalPower(s, p) < 6) return 'The paying Groups need at least 6 Power in total.';
      const al = alignments(s, g);
      if (!p.some((x) => alignments(s, x).some((a) => al.includes(a)))) return `At least one paying Group must share an alignment with ${cardName(s, g)}.`;
      return null;
    },
    apply(s, _pl, play) { pay(s, play.payWith); stashEvent(s, play); },
    resolve(s, pl, play) {
      const e = eventOf(s, play);
      const g = e?.card;
      if (!g || !e?.player || !own(s, e.player, g)) return;
      for (const x of subtree(s, g)) {
        Object.assign(s.cards[x], { zone: 'hand', controller: undefined, master: undefined, x: undefined, y: undefined, tokens: 0 });
        player(s, e.player).hand.push(x);
      }
      s.turnFlags.noTakeover = true;
      s.turnFlags.takeoverDone = false; // the takeover never happened
      log(s, `The takeover of ${cardName(s, g)} is sabotaged: it goes back to ${player(s, e.player).name}'s hand, and no more automatic takeovers this turn.`, pl);
    },
  },

  // At the start of another player's turn: you take a special turn first (no draws, no Plots, no new
  // Illuminati token). Errata: Illuminati action, not in the first round, once per game per player.
  'seize-the-time': {
    timing: ['event'],
    events: ['turnStart'],
    check(s, pl, play) {
      const err = rivalTurnStart(s, pl, play);
      if (err) return err;
      if (s.round === 1) return 'Not during the first round of the game.';
      if (s.turnFlags.extraTurn || s.extraTurnFor) return 'Someone has already seized this turn.';
      if (s.cards[illum(s, pl)].data?.seizedTime) return 'You may seize the time only once per game.';
      return illuminatiAction(s, pl);
    },
    apply(s, pl) {
      const ill = s.cards[illum(s, pl)];
      ill.tokens--;
      ill.data = { ...ill.data, seizedTime: true };
    },
    resolve(s, pl) {
      if (s.extraTurnFor) return;
      s.extraTurnFor = pl;
      log(s, `${player(s, pl).name} seizes the time and takes a special turn first.`, pl);
    },
  },

  // At the start of another player's turn: he may only draw and place tokens this turn. Needs a
  // Government Group with Power 5+. No effect on the Discordians; only once per game against each player.
  'senate-investigating-committee': {
    timing: ['event'],
    events: ['turnStart'],
    needs: { pay: 'tokens' },
    check(s, pl, play) {
      const err = rivalTurnStart(s, pl, play);
      if (err) return err;
      const who = eventOf(s, play)!.player!;
      if (s.cards[illum(s, who)].cardId === 'discordian-society') return 'The Discordians cannot be investigated.';
      return oneActor(s, pl, play.payWith, (g) => matches(s, g, { alignments: ['Government'] }) && power(s, g) >= 5, 'a Government Group with Power 5 or more');
    },
    apply(s, _pl, play) { pay(s, play.payWith); stashEvent(s, play); },
    resolve(s, pl, play) {
      const who = eventOf(s, play)?.player;
      if (!who || activePlayer(s).id !== who) return;
      const ill = s.cards[illum(s, who)];
      if (ill.data?.investigated) { log(s, `${player(s, who).name} has already faced a Senate investigation: this one achieves nothing.`, pl); return; }
      ill.data = { ...ill.data, investigated: true };
      s.turnFlags.restricted = true;
      log(s, `${player(s, who).name} is under investigation: this turn they can only draw cards and place Action tokens.`, pl);
    },
  },

  // Right after another player discards a Plot: it goes to your hand. A Group with Power 3+ pays.
  'stealing-the-plans': {
    timing: ['event'],
    events: ['discarded'],
    needs: { pay: 'tokens' },
    check(s, pl, play) {
      const e = eventOf(s, play);
      const c = e?.card;
      if (e?.type !== 'discarded' || !c || !e.player || e.player === pl || c === play.card) return 'Play this right after another player discards a Plot card.';
      if (def(s, c).type !== 'Plot' || s.cards[c].zone !== 'discard' || !player(s, e.player).discard.includes(c)) return 'That Plot card is no longer in the discard pile.';
      if (protectedPlayer(s, pl, e.player)) return 'That player has not finished a first turn yet.';
      return oneActor(s, pl, play.payWith, (g) => power(s, g) >= 3, 'a Group with Power 3 or more');
    },
    apply(s, _pl, play) { pay(s, play.payWith); stashEvent(s, play); },
    resolve(s, pl, play) {
      const e = eventOf(s, play);
      const c = e?.card;
      if (!c || !e?.player || s.cards[c].zone !== 'discard') return;
      const from = player(s, e.player);
      from.discard = from.discard.filter((x) => x !== c);
      Object.assign(s.cards[c], { zone: 'hand', exposed: false, controller: undefined, linkedTo: undefined });
      player(s, pl).hand.push(c);
      log(s, `${player(s, pl).name} steals the plans: ${cardName(s, c)} goes into their hand.`, pl);
    },
  },

  // Look at a rival's hidden Plots, then take one or reveal them all. Paid by the Network, a Computer or a Bank Group.
  // target = the rival (his Illuminati).
  'the-auditor-from-hell': {
    timing: ['anytime'],
    needs: { target: 'rival', pay: 'tokens' },
    check(s, pl, play) {
      const r = auditee(s, pl, play);
      if (!r) return 'Choose a rival.';
      return oneActor(s, pl, play.payWith,
        (g) => (g === illum(s, pl) && s.cards[g].cardId === 'the-network') || (isGroup(s, g) && matches(s, g, { attributes: ['Computer', 'Bank'] })),
        'the Network, or of a Computer or Bank Group');
    },
    apply(s, _pl, play) { pay(s, play.payWith); },
    resolve(s, pl, play) {
      const r = auditee(s, pl, play);
      if (!r) return;
      const hidden = hiddenPlots(s, r);
      revealTo(s, pl, hidden, `The audit of ${player(s, r).name} turns up`);
      log(s, `${player(s, pl).name} audits ${player(s, r).name}'s hidden Plots.`, pl);
      if (!hidden.length) return;
      askChoice(s, pl, {
        key: 'auditor-from-hell',
        question: `Take one of ${player(s, r).name}'s Plots, or expose them all?`,
        options: [...hidden.map((c) => ({ id: c, label: `Take ${cardName(s, c)}` })), { id: 'reveal', label: 'Expose them all' }],
        min: 1, max: 1, source: play.card, data: { rival: r },
      });
    },
  },

  // At the very start of a rival's turn: he draws no Plot cards this turn. A Magic Group pays.
  'unlucky-13': {
    timing: ['event'],
    events: ['turnStart'],
    needs: { pay: 'tokens' },
    check(s, pl, play) {
      return rivalTurnStart(s, pl, play)
        ?? oneActor(s, pl, play.payWith, (g) => isGroup(s, g) && matches(s, g, { attributes: ['Magic'] }), 'one of your Magic Groups');
    },
    apply(s, _pl, play) { pay(s, play.payWith); stashEvent(s, play); },
    resolve(s, pl, play) {
      const who = eventOf(s, play)?.player;
      if (!who) return;
      s.turnFlags.noPlotDraws = [...new Set([...(s.turnFlags.noPlotDraws ?? []), who])];
      log(s, `Bad luck for ${player(s, who).name}: no Plot cards this turn.`, pl);
    },
  },

  // Replace your Illuminati with an Illuminati card from your hand; the old one is discarded, and
  // any duplicate (Agents) of the new one in your hand is lost. target = the Illuminati card in hand.
  'unmasked': {
    timing: ['anytime'],
    needs: { target: 'handCard' },
    check(s, pl, play, ctx) {
      if (ctx) return 'Unmasked! cannot be played during an attack in this version.';
      const t = play.target;
      if (!t || !player(s, pl).hand.includes(t) || def(s, t).type !== 'Illuminati') return 'Choose an Illuminati card from your hand.';
      return null;
    },
    apply() {},
    resolve(s, pl, play) {
      const p = player(s, pl);
      const neu = play.target!;
      if (!p.hand.includes(neu)) return;
      const old = p.illuminati;
      const oc = s.cards[old];
      p.hand = p.hand.filter((x) => x !== neu);
      Object.assign(s.cards[neu], { zone: 'structure', controller: pl, master: undefined, x: oc.x, y: oc.y, rot: 0, tokens: oc.tokens, mods: [], exposed: false });
      for (const c of Object.values(s.cards)) {
        if (c.zone === 'structure' && c.master === old) c.master = neu;
        if ((c.zone === 'resources' || c.zone === 'table') && c.linkedTo === old) c.linkedTo = neu;
      }
      p.illuminati = neu;
      Object.assign(oc, { x: undefined, y: undefined, rot: undefined, mods: [] });
      discardCard(s, old);
      const agents = p.hand.filter((x) => s.cards[x].cardId === s.cards[neu].cardId);
      for (const a of agents) discardCard(s, a);
      log(s, `${p.name} is unmasked: the true masters are ${cardName(s, neu)}${agents.length ? ' (their Agents card is lost)' : ''}.`, pl);
    },
  },

  // Your Illuminati's action: every player discards one Group of his choice from his Power Structure
  // (discarded, not destroyed). Errata: not in the first round.
  'upheaval': {
    timing: ['anytime'],
    check(s, pl, _play, ctx) {
      if (ctx) return 'Upheaval! cannot be played during an attack.';
      if (s.round === 1) return 'Not during the first round of the game.';
      return illuminatiAction(s, pl);
    },
    apply(s, pl) { s.cards[illum(s, pl)].tokens--; },
    resolve(s, pl) {
      const seats = livePlayers(s);
      const start = Math.max(0, seats.findIndex((p) => p.id === pl));
      for (let i = 0; i < seats.length; i++) {
        const who = seats[(start + i) % seats.length].id;
        const groups = structureCards(s, who).filter((g) => isGroup(s, g));
        if (!groups.length) continue;
        askChoice(s, who, {
          key: 'upheaval',
          question: 'Upheaval! Choose one of your Groups to discard.',
          options: groups.map((g) => ({ id: g, label: cardName(s, g) })),
          min: 1, max: 1,
        });
      }
      log(s, 'Upheaval! Every player must give up one of their Groups.', pl);
    },
  },
});

// ---------------------------------------------------------------- effects

type Layout = { iid: string; master?: string; x?: number; y?: number; side?: Side }[];
const layoutOf = (e: GameEvent): Layout => ((e.data?.layout as Layout | undefined) ?? []);
/** Where the Personality goes back: its old place if it is still free, else the first open arrow. */
function jarSpot(s: GameState, pl: string, e: GameEvent): { master: string; side: Side; original: boolean } | undefined {
  const me = layoutOf(e)[0];
  if (me?.master && inPlay(s, me.master) && s.cards[me.master].controller === pl) {
    const side = me.side;
    if (side && openArrows(s, me.master).includes(side)) return { master: me.master, side, original: true };
  }
  for (const g of structureCards(s, pl)) {
    const side = openArrows(s, g)[0];
    if (side) return { master: g, side, original: false };
  }
  return undefined;
}

function organizeSide(s: GameState, play: PlotPlay): Side | undefined {
  const t = play.target!;
  const free = freePrintedSides(s, t);
  if (!play.mode) return free[0];
  if (!SIDE_NAMES.includes(play.mode)) return undefined;
  const printed = nowSide(s, t, play.mode as Side);
  return free.includes(printed) ? printed : undefined;
}

function connect(s: GameState, play: PlotPlay) {
  const t = play.target!;
  if (!inPlay(s, t)) return;
  s.cards[play.card].linkedTo = t;
  log(s, `${cardName(s, t)} gets Media connections.`);
}

function knock(s: GameState, play: PlotPlay, target: string) {
  return { type: 'attack' as const, attackType: (play.mode === 'destroy' ? 'destroy' : 'control') as 'control' | 'destroy', attacker: play.helper!, target };
}

/** Cards in play that duplicate your Illuminati without being anybody's Illuminati. */
function purgeAgents(s: GameState, pl: string): string[] {
  const id = s.cards[illum(s, pl)].cardId;
  const rulers = new Set(s.players.map((p) => p.illuminati));
  return Object.values(s.cards).filter((c) => c.cardId === id && !rulers.has(c.iid) && ['structure', 'table', 'resources'].includes(c.zone)).map((c) => c.iid);
}

function auditee(s: GameState, pl: string, play: PlotPlay): string | undefined {
  const t = play.target;
  const r = t ? s.players.find((p) => p.illuminati === t && !p.eliminated) : undefined;
  return r && r.id !== pl ? r.id : undefined;
}
/** Hidden Plots that other cards can reach (not one hidden beneath Texas or Fidel Castro). */
const hiddenPlots = (s: GameState, r: string) => exposableHand(s, r, 'Plot');

registerChoice('auditor-from-hell', {
  resolve(s, pl, picked, data) {
    const r = data.rival as string;
    const hidden = hiddenPlots(s, r);
    if (picked[0] === 'reveal') {
      const shown = exposeCards(s, hidden);
      log(s, `The audit exposes ${player(s, r).name}'s Plots: ${shown.map((c) => cardName(s, c)).join(', ') || 'none'}.`, pl);
      return;
    }
    const c = picked[0];
    if (!hidden.includes(c)) return;
    const from = player(s, r);
    from.hand = from.hand.filter((x) => x !== c);
    player(s, pl).hand.push(c);
    s.cards[c].exposed = false;
    log(s, `${player(s, pl).name} takes one of ${from.name}'s Plot cards.`, pl);
  },
});

registerChoice('upheaval', {
  resolve(s, pl, picked) {
    const g = picked[0];
    if (!own(s, pl, g)) return;
    log(s, `${player(s, pl).name} gives up ${cardName(s, g)}.`, pl);
    discardFromPlay(s, g);
  },
  ai: (s, _pl, options) => [[...options].sort((a, b) => power(s, a.id) - power(s, b.id))[0].id],
});

// ---------------------------------------------------------------- linked Plots

const linked = (s: GameState, self: string) => s.cards[self].linkedTo;

registerHooks({
  'head-in-a-jar': {
    forbidAttack: (s, self, attacker, _target, type) =>
      (attacker && attacker === linked(s, self) && type === 'control' ? `${cardName(s, attacker)} is only a head in a jar: it cannot take control of new Groups.` : null),
    attackMod: (s, self, ctx, side) => (side === 'defense' && ctx.assassination && ctx.target === linked(s, self) ? 10 : 0),
  },
  'media-connections': {
    attributeMod: (s, self, iid, current) => (iid === linked(s, self) && !current.includes('Media') ? [...current, 'Media'] : current),
    // Global Power is capped at Power (R029), so a large boost makes it equal to Power.
    globalMod: (s, self, iid) => (iid === linked(s, self) ? 1000 : 0),
  },
  'purge': {
    powerMod: (s, self, iid) => (iid === linked(s, self) ? -1 : 0),
    globalMod: (s, self, iid) => (iid === linked(s, self) ? -1 : 0),
  },
});
