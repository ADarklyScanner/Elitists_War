// Reusable card families shared by the base game and the expansion packs. Expansion cards are built
// from these (see docs/CARD_SCRIPTING.md, "Expansions"): a card script usually only chooses the options.
import type { AttackCtx, GameState, PlotPlay } from '../types';
import type { PlotHandler } from '../plotTypes';
import type { CardHooks } from '../hooks';
import { registerHooks } from '../hooks';
import { registerPlots } from '../plotTypes';
import { cardName, def } from '../cards';
import { type Match, matches } from '../abilities';
import { anyOf, groupActions, illuminatiAction, targetResistance, type CostOption } from '../costs';
import {
  addFreeze, announcedAction, announcedActors, cancelledGroups, isPrivileged, log, player, respondToAction, startInstantAttack,
  syncConditions, zappedPlayer,
} from '../game';

const describe = (m: Match) => [...(m.alignments ?? []), ...(m.attributes ?? []), ...(m.subtypes ?? [])].join('/');
const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';
const own = (s: GameState, pl: string, iid?: string) => inPlay(s, iid) && s.cards[iid!].controller === pl;
const notPrivileged = (ctx?: AttackCtx) => (ctx && isPrivileged(ctx) ? 'Not during a Privileged attack.' : null);

// ---------------------------------------------------------------- Assassinations

/**
 * Assassination: an Instant Attack to Destroy (kill) a Personality, needing no action. `power` may
 * depend on the target (Spontaneous Combustion: 15 against a Magic Personality). One of the player's
 * Groups matching `helper` (any of the listed matches) may spend its action to add its Power.
 */
export function assassinationPlot(opts: { power: number | ((s: GameState, target: string) => number); helper?: Match | Match[] }): PlotHandler {
  const helpers = opts.helper ? (Array.isArray(opts.helper) ? opts.helper : [opts.helper]) : [];
  return {
    timing: ['instant'],
    needs: { target: 'personality', helper: helpers.length > 0 },
    check(s, pl, play) {
      if (!inPlay(s, play.target) || def(s, play.target!).subtype !== 'Personality') return 'Choose a Personality in play.';
      if (play.helper && (!helpers.length || !own(s, pl, play.helper) || s.cards[play.helper].tokens < 1 || !helpers.some((m) => matches(s, play.helper!, m)))) return `The helping Group must be your ${helpers.map(describe).join(' or ')} Group with an Action token.`;
      return null;
    },
    apply(s, pl, play) {
      const power = typeof opts.power === 'number' ? opts.power : opts.power(s, play.target!);
      startInstantAttack(s, pl, { plot: play.card, target: play.target!, power, assassination: true, helper: play.helper });
    },
  };
}

// ---------------------------------------------------------------- Zaps

export interface ZapOptions {
  /** No Group of the victim's Power Structure may take over (attack to control, or automatically) a Group matching this. */
  noTakeover?: Match;
  /** The victim may not play Assassinations or Disasters. */
  noInstants?: boolean;
  /** A further condition on the victim (return a reason to refuse), e.g. not in two-player games. */
  canTarget?: (s: GameState, pl: string, victim: string) => string | null;
  /** More restrictions, as hooks of the Zap card. Use zappedPlayer(s, self) to know whom it restricts. */
  hooks?: CardHooks;
}

/**
 * A Zap: played with an Illuminati action on a rival's Illuminati (`play.target`), at any time except
 * during a Privileged attack. It stays on the table linked to that Illuminati and restricts the whole
 * Power Structure until removed (applyAction {type:'removeZaps'}). Played during an attack it can make
 * that attack illegal, which cancels it. Several Zaps add up.
 */
export function zapPlot(opts: ZapOptions): { plot: PlotHandler; hooks: CardHooks } {
  const link = (s: GameState, pl: string, play: PlotPlay) => {
    s.cards[play.card].linkedTo = play.target;
    log(s, `${cardName(s, play.card)} Zaps ${player(s, s.cards[play.target!].controller!).name}.`, pl);
    syncConditions(s);
  };
  const plot: PlotHandler = {
    timing: ['anytime'],
    condition: 'zap',
    needs: { target: 'rival' },
    requires: anyOf(illuminatiAction()),
    check(s, pl, play, ctx) {
      const t = play.target ? s.cards[play.target] : undefined;
      const victim = t?.controller;
      if (!t || t.zone !== 'structure' || def(s, play.target!).type !== 'Illuminati' || !victim || victim === pl) return 'Play a Zap on a rival\'s Illuminati.';
      return notPrivileged(ctx) ?? opts.canTarget?.(s, pl, victim) ?? null;
    },
    apply(s, pl, play, ctx) { if (ctx) link(s, pl, play); },
    resolve: link,
  };
  const hooks: CardHooks = {
    ...opts.hooks,
    forbidAttack(s, self, attacker, target, type, attackerPlayer) {
      if (opts.noTakeover && attackerPlayer === zappedPlayer(s, self) && (type === 'control' || type === 'takeover') && s.cards[target] && def(s, target).type === 'Group' && matches(s, target, opts.noTakeover)) {
        return `${cardName(s, self)}: ${player(s, attackerPlayer).name} may not take over ${describe(opts.noTakeover)} Groups.`;
      }
      return opts.hooks?.forbidAttack?.(s, self, attacker, target, type, attackerPlayer) ?? null;
    },
    forbidUse(s, self, pl, card, target, ctx) {
      const sub = s.cards[card] ? def(s, card).subtype : '';
      if (opts.noInstants && pl === zappedPlayer(s, self) && (sub === 'Assassination' || sub === 'Disaster')) return `${cardName(s, self)}: you may not use Assassinations or Disasters.`;
      return opts.hooks?.forbidUse?.(s, self, pl, card, target, ctx) ?? null;
    },
  };
  return { plot, hooks };
}

/** Register a Zap card: its Plot handler and its hooks. */
export function registerZap(id: string, opts: ZapOptions) {
  const z = zapPlot(opts);
  registerPlots({ [id]: z.plot });
  registerHooks({ [id]: z.hooks });
}

// ---------------------------------------------------------------- Paralysis

/**
 * A Paralysis: played at any moment outside a Privileged attack, on a Group matching `on`, paid
 * with an Illuminati action or with actions of `pay` Groups whose Power totals the target's current
 * Resistance. The Group is Paralyzed until it no longer matches `on` (the card is then discarded) or
 * someone frees it (applyAction {type:'freeGroup'}).
 */
export function paralysisPlot(opts: { on: Match; pay: Match }): PlotHandler {
  const link = (s: GameState, pl: string, play: PlotPlay) => {
    if (!play.target || !s.cards[play.target] || !['structure', 'uncontrolled'].includes(s.cards[play.target].zone)) return;
    s.cards[play.card].linkedTo = play.target;
    log(s, `${cardName(s, play.target)} is Paralyzed.`, pl);
    syncConditions(s);
  };
  return {
    timing: ['anytime'],
    condition: 'paralysis',
    needs: { target: 'anyGroup' },
    requires: anyOf(illuminatiAction(), groupActions(opts.pay, { power: targetResistance, what: `${describe(opts.pay)} ` })),
    check(s, _pl, play, ctx) {
      const t = play.target ? s.cards[play.target] : undefined;
      if (!t || !['structure', 'uncontrolled'].includes(t.zone) || def(s, play.target!).type !== 'Group' || !matches(s, play.target!, opts.on)) return `Choose a ${describe(opts.on)} Group in play.`;
      return notPrivileged(ctx);
    },
    apply(s, pl, play, ctx) { if (ctx) link(s, pl, play); },
    resolve: link,
    // It ends when the Group no longer has the alignment it was played on.
    linkLegal: (s, _plot, group) => (s.cards[group] && ['structure', 'uncontrolled'].includes(s.cards[group].zone) && matches(s, group, opts.on) ? 'ok' : 'discard'),
  };
}

// ---------------------------------------------------------------- Attribute Freezes

/**
 * An Attribute Freeze. Mode 'freeze': until the end of the turn no Group matching `match` (and no
 * Resource listed in `resources`) may spend Action tokens except to defend itself. Mode 'cancel':
 * right after a Group matching `cancel` (default `match`) acts, cancel that action (`play.target`).
 * Paid with any of `pay` (default: an Illuminati action or an action of a matching Group).
 */
const list = (m: Match | Match[]) => (Array.isArray(m) ? m : [m]);

export function freezePlot(
opts: { match: Match | Match[]; resources?: string[]; cancel?: Match | Match[]; pay?: CostOption[]; label: string }): PlotHandler {
  const cancelMatch = opts.cancel ?? opts.match;
  const acting = (s: GameState, ctx?: AttackCtx): string[] => {
    if (ctx) {
      const gone = cancelledGroups(ctx);
      return [ctx.attacker, ...ctx.aid.map((a) => a.iid), ...ctx.oppose.map((o) => o.iid)].filter((g): g is string => !!g && !gone.has(g));
    }
    const e = announcedAction(s);
    return e ? announcedActors(e) : [];
  };
  return {
    timing: ['anytime', 'event'],
    events: ['action'],
    needs: { target: 'anyGroup', mode: ['freeze', 'cancel'] },
    requires: anyOf(...(opts.pay ?? [illuminatiAction(), ...list(opts.match).map((m) => groupActions(m))])),
    check(s, _pl, play, ctx) {
      if ((play.mode ?? 'freeze') === 'freeze') return play.target ? 'A Freeze needs no target.' : null;
      if (!play.target || !acting(s, ctx).includes(play.target) || !s.cards[play.target] || !list(cancelMatch).some((m) => matches(s, play.target!, m))) return `Choose a ${list(cancelMatch).map(describe).join(' or ')} Group that is acting right now.`;
      return null;
    },
    apply(s, pl, play, ctx) {
      if (!ctx) return;
      if ((play.mode ?? 'freeze') === 'freeze') { addFreeze(s, { card: play.card, player: pl, match: opts.match, resources: opts.resources, label: opts.label }); return; }
      return { t: 'cancelGroup', group: play.target! };
    },
    resolve(s, pl, play) {
      if ((play.mode ?? 'freeze') === 'freeze') addFreeze(s, { card: play.card, player: pl, match: opts.match, resources: opts.resources, label: opts.label });
      else respondToAction(s, pl, play.card, { t: 'cancelGroup', group: play.target! });
    },
  };
}
