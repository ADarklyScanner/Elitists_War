// Encoded by the card-content pass. See docs/CARD_SCRIPTING.md.
// Plot cards C–H (second batch). Families shared with plots.ts are copied here because the helpers
// there are not exported.
import type { AttackCtx, GameState, PlotEffect, PlotPlay } from '../types';
import type { PlotHandler } from '../plotTypes';
import { PLOTS, registerPlots } from '../plotTypes';
import { anyHook, hooksOf, registerHooks } from '../hooks';
import { cardName, def, OPPOSITE } from '../cards';
import { type Match, matches } from '../abilities';
import { alignments, power, resistance } from '../stats';
import { openArrows, structureCards } from '../geometry';
import {
  activePlayer, currentOutcome, discardCard, giveToken, goalsInHand, isCancelled, isPrivileged, isSecret, isUnique,
  controllerOf2, livePlayers, log, placeGroup, player, playResourceCard, protectedPlayer,
} from '../game';

// ---------------------------------------------------------------- helpers

const own = (s: GameState, pl: string, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure' && s.cards[iid].controller === pl;
const isGroup = (s: GameState, iid?: string) => !!iid && !!s.cards[iid] && def(s, iid).type === 'Group';
const inPlay = (s: GameState, iid?: string) => !!iid && s.cards[iid]?.zone === 'structure';
const hasAttr = (s: GameState, iid: string, a: string) => (def(s, iid).attributes ?? []).includes(a);
const describe = (m: Match) => [...(m.alignments ?? []), ...(m.attributes ?? []), ...(m.subtypes ?? [])].join('/');

/** Spend one token from each listed Group of the player. */
function spend(s: GameState, pl: string, groups: string[] = []): string | null {
  for (const g of groups) if (!own(s, pl, g) || s.cards[g].tokens < 1) return 'Every paying Group must be yours and have an Action token.';
  if (new Set(groups).size !== groups.length) return 'A Group can only pay once.';
  return null;
}
function pay(s: GameState, groups: string[] = []) { for (const g of groups) s.cards[g].tokens--; }
const totalPower = (s: GameState, groups: string[] = []) => groups.reduce((n, g) => n + power(s, g), 0);

/** Wrap an effect so it happens at once inside an attack, or after the counter window otherwise. */
function effectNow(fn: (s: GameState, pl: string, play: PlotPlay) => void): Pick<PlotHandler, 'apply' | 'resolve'> {
  return {
    apply: (s, pl, play, ctx) => { if (ctx) fn(s, pl, play); },
    resolve: fn,
  };
}

/** Only in the player's own main phase, with nothing else going on. */
const ownMain = (s: GameState, pl: string, ctx?: AttackCtx) => !ctx && !s.window && s.phase === 'main' && activePlayer(s).id === pl;

/** Plots waiting in the current counter pool (a Plot window, or the Plots of the attack). */
const counterPool = (s: GameState, ctx?: AttackCtx) => (s.window?.kind === 'plot' ? s.window.plays ?? [] : ctx?.plays ?? []);

/** Take a card from a hand and put it on the table as part of a play. */
function toTable(s: GameState, pl: string, iid: string) {
  for (const p of s.players) p.hand = p.hand.filter((x) => x !== iid);
  Object.assign(s.cards[iid], { zone: 'table', controller: pl });
}

/** Remove a Plot's own modifiers from a card. */
const dropMods = (s: GameState, iid: string | undefined, source: string) => {
  if (iid && s.cards[iid]) s.cards[iid].mods = s.cards[iid].mods.filter((m) => m.source !== source);
};

/**
 * Resource categories (Magic, Artifact, Gadget) are not attributes in the card data: they are
 * printed on the card footer, which the data keeps in `uniqueness` ("Unique Magic Artifact") or in
 * `notes` ("Gadget; not marked Unique", "Footer reads 'Magic Artifact'").
 */
export function resourceKinds(s: GameState, iid: string): string[] {
  const d = def(s, iid);
  if (d.type !== 'Resource') return [];
  const src = [
    d.uniqueness ?? '',
    /^(?:Magic |Artifact |Gadget )*(?:Magic|Artifact|Gadget)\b[^;.]*[;.]/.exec(d.notes ?? '')?.[0] ?? '',
    /Footer reads '([^']*)'/.exec(d.notes ?? '')?.[1] ?? '',
  ].join(' ');
  return ['Magic', 'Artifact', 'Gadget'].filter((k) => new RegExp(`\\b${k}\\b`).test(src));
}
const resourceIs = (s: GameState, iid: string | undefined, kind: string) =>
  !!iid && !!s.cards[iid] && s.cards[iid].zone === 'resources' && resourceKinds(s, iid).includes(kind);
const resourcesInPlay = (s: GameState) => Object.values(s.cards).filter((c) => c.zone === 'resources').map((c) => c.iid);

/** First-turn protection for targets chosen automatically (checkPlot only sees `play.target`). */
const shielded = (s: GameState, pl: string, iid: string) => protectedPlayer(s, pl, s.cards[iid].controller ?? s.cards[iid].owner);

/** Uses the target's action; its Power is raised to 6 and the card stays linked. One per player. */
function raiseToSix(match: Match): PlotHandler {
  return {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'ownGroup' },
    check(s, pl, play) {
      if (!own(s, pl, play.target) || !isGroup(s, play.target) || !matches(s, play.target!, match)) return `Choose a ${describe(match)} Group you control.`;
      if (s.cards[play.target!].tokens < 1) return 'That Group needs an available action.';
      const cardId = s.cards[play.card].cardId;
      if (Object.values(s.cards).some((c) => c.cardId === cardId && c.zone === 'table' && c.controller === pl && c.linkedTo)) return 'You may only have one of these in play.';
      return null;
    },
    apply(s, _pl, play, ctx) {
      s.cards[play.target!].tokens--;
      if (ctx) link(s, play);
    },
    resolve: (s, _pl, play) => link(s, play),
  };
  function link(s: GameState, play: PlotPlay) {
    if (!inPlay(s, play.target)) return;
    s.cards[play.target!].mods.push({ source: play.card, kind: 'setPower', value: 6, until: 'permanent' });
    s.cards[play.card].linkedTo = play.target;
  }
}

/** A destroyed card stops counting as destroyed: it goes to its owner's discard pile. */
function undestroy(s: GameState, original: string) {
  const c = s.cards[original];
  Object.assign(c, { zone: 'discard', killed: false, controller: undefined, master: undefined, linkedTo: undefined, tokens: 0 });
  player(s, c.owner).discard.push(original);
  for (const p of s.players) p.destroyedCredit = p.destroyedCredit.filter((x) => x !== original);
}
const destroyedCopy = (s: GameState, iid: string, killedOnly: boolean) =>
  Object.values(s.cards).find((c) => c.iid !== iid && c.cardId === s.cards[iid].cardId && c.zone === 'destroyed' && (!killedOnly || c.killed))?.iid;

// ---------------------------------------------------------------- card-specific pieces

/** Plots that are "about Computers" (Computer Security). */
const COMPUTER_PLOTS = new Set(['computer-virus', 'infobahn', 'gremlins', 'the-internet-worm', 'the-auditor-from-hell', 'the-weak-link', 'computer-security']);
/** Plots that look at a rival's hidden Plots (Double-Cross). */
const SPY_PLOTS = new Set(['agent-in-place', 'george-the-janitor', 'logic-bomb', 'mutual-betrayal', 'the-auditor-from-hell']);

// Celebrity Spokesman: an Organization that may take the link.
function spokesmanOrgOk(s: GameState, person: string, org: string): boolean {
  if (!inPlay(s, org) || def(s, org).subtype !== 'Organization' || isSecret(s, org)) return false;
  const al = alignments(s, org);
  if (al.includes('Government')) return false;
  // "No opposed alignments": none of the Organization's alignments is opposed to one of the Personality's.
  const pa = alignments(s, person);
  return !al.some((a) => pa.some((b) => OPPOSITE[a] === b || (a === 'Fanatic' && b === 'Fanatic')));
}
function spokesmanOrg(s: GameState, pl: string, play: PlotPlay): string | undefined {
  if (play.targets?.length) return play.targets[0];
  const cands = Object.values(s.cards).filter((c) => c.zone === 'structure' && play.target && spokesmanOrgOk(s, play.target, c.iid));
  return (cands.find((c) => c.controller === pl) ?? cands[0])?.iid;
}

// Combined Disasters: the two Disasters (main first).
function combinedPair(s: GameState, pl: string, play: PlotPlay): string[] | undefined {
  if (play.targets?.length) return play.targets;
  const hand = player(s, pl).hand.filter((h) => h !== play.card && def(s, h).subtype === 'Disaster' && PLOTS[s.cards[h].cardId]
    && !PLOTS[s.cards[h].cardId].check(s, pl, { card: h, target: play.target }));
  return hand.length >= 2 ? hand.slice(0, 2) : undefined;
}

// Forgery: a Unique Resource in hand duplicating one in play.
function forgeryCard(s: GameState, pl: string, play: PlotPlay): string | undefined {
  const ok = (r: string) => player(s, pl).hand.includes(r) && def(s, r).type === 'Resource' && isUnique(s, r)
    && Object.values(s.cards).some((c) => c.iid !== r && c.cardId === s.cards[r].cardId && c.zone === 'resources');
  if (play.target) return ok(play.target) ? play.target : undefined;
  return player(s, pl).hand.find(ok);
}

// Foiled!: a rival's exposed Goal card.
function foiledGoal(s: GameState, pl: string, play: PlotPlay): string | undefined {
  const ok = (g: string) => {
    const c = s.cards[g];
    return !!c && c.zone === 'hand' && !!c.exposed && def(s, g).subtype === 'Goal'
      && livePlayers(s).some((p) => p.id !== pl && goalsInHand(s, p.id).includes(g) && !protectedPlayer(s, pl, p.id));
  };
  if (play.target) return ok(play.target) ? play.target : undefined;
  for (const p of livePlayers(s)) if (p.id !== pl) { const g = goalsInHand(s, p.id).find(ok); if (g) return g; }
  return undefined;
}

// Deasil Engine / Hex / Gremlins: pick a Resource (explicit or the first eligible).
function pickResource(s: GameState, pl: string, play: PlotPlay, ok: (r: string) => boolean): string | undefined {
  if (play.target) return s.cards[play.target] && def(s, play.target).type === 'Resource' && ok(play.target) && !shielded(s, pl, play.target) ? play.target : undefined;
  const all = resourcesInPlay(s).filter((r) => ok(r) && !shielded(s, pl, r));
  return all.find((r) => s.cards[r].controller !== pl) ?? all[0];
}

// Counterspell: the Magic Resource ability used against the player in this attack.
function spellUsed(s: GameState, pl: string, ctx: AttackCtx, play: PlotPlay) {
  return ctx.plays.find((p) => p.ability && p.player !== pl && !isCancelled(ctx.plays, p.iid)
    && resourceIs(s, p.ability, 'Magic') && (!play.target || play.target === p.ability));
}

/** Groups using their Power in this attack. */
const actingGroups = (ctx: AttackCtx) => [ctx.attacker, ...ctx.aid.map((a) => a.iid), ...ctx.oppose.map((o) => o.iid)].filter((x): x is string => !!x);

// ---------------------------------------------------------------- the cards

registerPlots({
  'celebrity-spokesman': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'personality' },
    check(s, pl, play, ctx) {
      if (ctx) return 'Celebrity Spokesman cannot be played during an attack.';
      if (!own(s, pl, play.target) || def(s, play.target!).subtype !== 'Personality') return 'Choose a Personality you control.';
      const org = spokesmanOrg(s, pl, play);
      if (!org || !spokesmanOrgOk(s, play.target!, org)) return 'Choose an Organization in play that is neither Secret nor Government and has no alignment opposed to the Personality.';
      if (shielded(s, pl, org)) return 'That player has not finished a first turn yet.';
      return null;
    },
    apply() { /* no cost */ },
    resolve(s, pl, play) {
      const org = spokesmanOrg(s, pl, play);
      if (!own(s, pl, play.target) || !org || !spokesmanOrgOk(s, play.target!, org)) return;
      s.cards[play.target!].mods.push({ source: play.card, kind: 'setPower', value: 4, until: 'permanent' });
      s.cards[play.card].linkedTo = play.target;
      s.cards[play.card].data = { org };
      log(s, `${cardName(s, play.target!)} becomes the spokesman of ${cardName(s, org)}.`, pl);
    },
  },
  'charismatic-leader': raiseToSix({ alignments: ['Fanatic'] }),
  'citizenship-award': raiseToSix({ alignments: ['Conservative'] }),

  'clone': {
    timing: ['anytime'],
    check(s, pl, play, ctx) {
      if (!ownMain(s, pl, ctx)) return 'Play Clone in your own turn, outside an attack.';
      const t = play.target ?? player(s, pl).hand.find((h) => def(s, h).subtype === 'Personality' && destroyedCopy(s, h, true));
      if (!t || !player(s, pl).hand.includes(t) || def(s, t).subtype !== 'Personality' || !destroyedCopy(s, t, true)) return 'You need a Personality in your hand that duplicates one that was Assassinated.';
      return null;
    },
    apply() { /* no cost */ },
    resolve(s, pl, play) {
      const t = play.target ?? player(s, pl).hand.find((h) => def(s, h).subtype === 'Personality' && destroyedCopy(s, h, true));
      const original = t && destroyedCopy(s, t, true);
      if (!t || !original) return;
      undestroy(s, original);
      log(s, `${cardName(s, t)} is cloned: the original no longer counts as destroyed.`, pl);
      // With the Clone Arrangers the clone comes into play automatically, on the first open arrow.
      if (structureCards(s, pl).some((g) => s.cards[g].cardId === 'clone-arrangers')) {
        const ill = player(s, pl).illuminati;
        const masters = [ill, ...structureCards(s, pl).filter((g) => g !== ill)];
        for (const m of masters) {
          const side = openArrows(s, m)[0];
          if (!side) continue;
          placeGroup(s, t, pl, m, side);
          log(s, `The Clone Arrangers bring ${cardName(s, t)} into play.`, pl);
          hooksOf(s, t)?.onEnterPlay?.(s, t);
          break;
        }
      }
    },
  },

  'combined-disasters': {
    timing: ['instant'],
    needs: { target: 'place' },
    check(s, pl, play) {
      if (!inPlay(s, play.target) || def(s, play.target!).subtype !== 'Place') return 'Choose a Place in play.';
      const pair = combinedPair(s, pl, play);
      if (!pair || pair.length !== 2 || pair[0] === pair[1]) return 'You need two Disasters in your hand that can both strike that Place.';
      for (const d of pair) {
        if (!player(s, pl).hand.includes(d) || d === play.card || def(s, d).subtype !== 'Disaster' || !PLOTS[s.cards[d].cardId]) return 'Both cards must be Disasters from your hand.';
        const err = PLOTS[s.cards[d].cardId].check(s, pl, { card: d, target: play.target });
        if (err) return `${cardName(s, d)}: ${err}`;
      }
      return null;
    },
    apply(s, pl, play) {
      const [main, second] = combinedPair(s, pl, play)!;
      // The second Disaster only adds its Power: find it by trying it on a copy of the game.
      const probe = structuredClone(s);
      PLOTS[probe.cards[second].cardId].apply(probe, pl, { card: second, target: play.target });
      const extra = probe.attack?.instantPower ?? 0;
      toTable(s, pl, main);
      toTable(s, pl, second);
      PLOTS[s.cards[main].cardId].apply(s, pl, { card: main, target: play.target });
      const ctx = s.attack!;
      ctx.plays.push({ iid: main, player: pl, play: { card: main, target: play.target }, effect: { t: 'none' } });
      ctx.plays.push({ iid: second, player: pl, play: { card: second, target: play.target }, effect: { t: 'none' } });
      ctx.attackBonus.push({ player: pl, plot: play.card, amount: extra, label: `Combined Disasters (${cardName(s, second)})` });
      log(s, `${cardName(s, main)} and ${cardName(s, second)} strike together.`, pl);
    },
  },

  'commitment': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'anyGroup' },
    check(s, _pl, play, ctx) {
      const t = play.target;
      const fromHand = !!ctx && ctx.fromHand && ctx.target === t;
      if (!t || !isGroup(s, t) || (!inPlay(s, t) && !fromHand)) return 'Choose a Group in play (or one being played from hand).';
      return null;
    },
    apply(s, pl, play, ctx) {
      if (!ctx) return;
      s.cards[play.card].linkedTo = play.target;
      s.cards[play.card].data = { pendingAttack: ctx.id };
      // Live during this attack (so cancelling Commitment undoes it); made permanent when the attack ends.
      if (ctx.target === play.target && ctx.type === 'control') {
        const bump = Math.max(0, 8 - resistance(s, play.target!));
        if (bump) ctx.defenseBonus.push({ player: pl, plot: play.card, amount: bump, label: 'Commitment' });
      }
    },
    resolve(s, _pl, play) {
      if (!inPlay(s, play.target)) return;
      s.cards[play.target!].mods.push({ source: play.card, kind: 'setResistance', value: 8, until: 'permanent' });
      s.cards[play.card].linkedTo = play.target;
    },
  },

  'computer-security': {
    timing: ['counter'],
    needs: { target: 'plot', pay: 'tokens' },
    check(s, pl, play, ctx) {
      const pool = counterPool(s, ctx);
      const last = pool[pool.length - 1];
      if (!play.target || !last || last.iid !== play.target || play.target === play.card) return 'Play this immediately after the Plot you want to negate.';
      const about = COMPUTER_PLOTS.has(s.cards[last.iid].cardId);
      const onComputer = !!last.play.target && !!s.cards[last.play.target] && isGroup(s, last.play.target) && hasAttr(s, last.play.target, 'Computer');
      if (!about && !onComputer) return 'Only against a Plot about Computers or used on a Computer Group.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      const g = play.payWith?.[0];
      if (play.payWith?.length !== 1 || !(hasAttr(s, g!, 'Computer') || s.cards[g!].cardId === 'the-network')) return 'Pay with the action of the Network or one of your Computer Groups.';
      return null;
    },
    apply(s, _pl, play): PlotEffect { pay(s, play.payWith); return { t: 'cancelPlot', target: play.target! }; },
  },

  'counter-revolution': {
    timing: ['anytime'],
    needs: { pay: 'tokens' },
    check(s, pl, play, ctx) {
      if (!ownMain(s, pl, ctx)) return 'Play Counter-Revolution in your own turn, outside an attack.';
      const t = play.target ?? player(s, pl).hand.find((h) => isGroup(s, h) && hasAttr(s, h, 'Nation') && destroyedCopy(s, h, false));
      if (!t || !player(s, pl).hand.includes(t) || !isGroup(s, t) || !hasAttr(s, t, 'Nation') || !destroyedCopy(s, t, false)) return 'You need a Nation in your hand that duplicates a destroyed one.';
      const payers = play.payWith ?? [];
      const err = spend(s, pl, payers);
      if (err) return err;
      if (payers.length === 1 && payers[0] === player(s, pl).illuminati) return null;
      if (!payers.length || payers.some((g) => g === player(s, pl).illuminati || !alignments(s, g).includes('Government'))) return 'Pay with your Illuminati, or with Government Groups.';
      if (totalPower(s, payers) < 10) return 'The paying Government Groups need at least 10 Power in total.';
      return null;
    },
    apply(s, _pl, play) { pay(s, play.payWith); },
    resolve(s, pl, play) {
      const t = play.target ?? player(s, pl).hand.find((h) => isGroup(s, h) && hasAttr(s, h, 'Nation') && destroyedCopy(s, h, false));
      const original = t && destroyedCopy(s, t, false);
      if (!t || !original) return;
      undestroy(s, original);
      log(s, `${cardName(s, t)} may be played as though it had never been destroyed.`, pl);
    },
  },

  'counterspell': {
    timing: ['attack', 'roll'],
    needs: { pay: 'tokens' },
    check(s, pl, play, ctx) {
      if (!ctx || ctx.targetPlayer !== pl) return 'Play this when a Magic Resource is used in an attack against you.';
      if (!spellUsed(s, pl, ctx, play)) return 'No Magic Resource has been used against you in this attack.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      const g = play.payWith?.[0];
      if (play.payWith?.length !== 1 || !(g === player(s, pl).illuminati || hasAttr(s, g!, 'Magic'))) return 'Pay with the action of your Illuminati or one of your Magic Groups.';
      return null;
    },
    apply(s, pl, play, ctx): PlotEffect {
      const use = spellUsed(s, pl, ctx!, play)!;
      pay(s, play.payWith);
      const r = use.ability!;
      log(s, `${cardName(s, r)} is destroyed and discarded.`, pl);
      discardCard(s, r);
      return { t: 'cancelPlot', target: use.iid };
    },
  },

  'cover-up': {
    timing: ['roll', 'counter'],
    needs: { pay: 'tokens' },
    check(s, pl, play, ctx) {
      if (s.window?.kind === 'roll') {
        if (!ctx || !isSecret(s, ctx.target)) return 'Play this after a Secret Group has been attacked successfully.';
        if (currentOutcome(s, ctx) !== 'success') return 'Only after the attack has succeeded.';
        const err = spend(s, pl, play.payWith);
        if (err) return err;
        const g = play.payWith?.[0];
        if (play.payWith?.length !== 1 || !(g === player(s, pl).illuminati || (isSecret(s, g!) && g !== ctx.target))) return 'Pay with the action of your Illuminati or of a different Secret Group.';
        return null;
      }
      const pool = counterPool(s, ctx);
      const target = play.target ?? pool.find((p) => s.cards[p.iid]?.cardId === 'exposed')?.iid;
      if (!target || !pool.some((p) => p.iid === target && s.cards[p.iid].cardId === 'exposed')) return 'Play this after a Secret Group is attacked successfully, or right after Exposed! is played.';
      return null;
    },
    apply(s, pl, play, ctx): PlotEffect {
      if (s.window?.kind === 'roll') { pay(s, play.payWith); return { t: 'fail' }; }
      const target = play.target ?? counterPool(s, ctx).find((p) => s.cards[p.iid]?.cardId === 'exposed')!.iid;
      return { t: 'cancelPlot', target };
    },
  },

  'currency-speculation': {
    timing: ['anytime', 'declare'],
    linked: true,
    needs: { target: 'ownGroup', mode: ['power', 'resistance'] },
    check(s, pl, play) {
      if (!own(s, pl, play.target) || !isGroup(s, play.target) || !hasAttr(s, play.target!, 'Bank')) return 'Choose a Bank Group you control.';
      if (play.mode && play.mode !== 'power' && play.mode !== 'resistance') return 'Choose Power or Resistance.';
      return null;
    },
    apply(s, pl, play, ctx) {
      if (!ctx) return;
      const g = play.target!;
      const mode = play.mode === 'resistance' ? 'resistance' : 'power';
      s.cards[play.card].linkedTo = g;
      s.cards[play.card].data = { mode, pendingAttack: ctx.id };
      // Already acting in this attack: the tripling applies now (live, so it can be cancelled) and is used up.
      if (mode === 'power' && (ctx.attacker === g || ctx.aid.some((a) => a.iid === g))) {
        ctx.attackBonus.push({ player: pl, plot: play.card, forGroup: g, amount: 2 * power(s, g), label: 'Currency Speculation' });
        s.cards[play.card].data = { mode, used: true };
      } else if (mode === 'power' && ctx.oppose.some((o) => o.iid === g)) {
        ctx.defenseBonus.push({ player: pl, plot: play.card, forGroup: g, amount: 2 * power(s, g), label: 'Currency Speculation' });
        s.cards[play.card].data = { mode, used: true };
      } else if (mode === 'resistance' && ctx.target === g) {
        if (ctx.type === 'control') ctx.defenseBonus.push({ player: pl, plot: play.card, amount: 2 * resistance(s, g), label: 'Currency Speculation' });
        s.cards[play.card].data = { mode, used: true };
      }
    },
    resolve(s, _pl, play) {
      if (!inPlay(s, play.target)) return;
      const mode = play.mode === 'resistance' ? 'resistance' : 'power';
      s.cards[play.target!].mods.push({ source: play.card, kind: mode === 'power' ? 'mulPower' : 'mulResistance', value: 3, until: 'permanent', countsForGoals: false });
      s.cards[play.card].linkedTo = play.target;
      s.cards[play.card].data = { mode };
    },
  },

  'deasil-engine': {
    timing: ['anytime', 'counter'],
    check(s, pl, play, ctx) {
      const pool = counterPool(s, ctx);
      if (play.target && pool.some((p) => p.iid === play.target && p.iid !== play.card && s.cards[p.iid].cardId === 'deasil-engine')) return null;
      if (s.window?.kind === 'plot') return 'Only another Deasil Engine can be answered this way.';
      return pickResource(s, pl, play, (r) => resourceIs(s, r, 'Gadget')) ? null : 'Choose a Gadget Resource in play.';
    },
    apply(s, pl, play, ctx): PlotEffect | void {
      const pool = counterPool(s, ctx);
      if (play.target && pool.some((p) => p.iid === play.target && s.cards[p.iid].cardId === 'deasil-engine')) return { t: 'cancelPlot', target: play.target };
      const r = pickResource(s, pl, play, (x) => resourceIs(s, x, 'Gadget'))!;
      s.cards[play.card].data = { resource: r };
      if (ctx) { log(s, `${cardName(s, r)} destroys itself.`, pl); discardCard(s, r); }
    },
    resolve(s, pl, play) {
      const r = s.cards[play.card].data?.resource as string | undefined;
      if (r && s.cards[r].zone === 'resources') { log(s, `${cardName(s, r)} destroys itself.`, pl); discardCard(s, r); }
    },
  },

  'dictatorship': {
    timing: ['anytime'],
    linked: true,
    needs: { target: 'ownGroup' },
    check(s, pl, play, ctx) {
      if (!ownMain(s, pl, ctx)) return 'Play Dictatorship in your own turn, outside an attack.';
      if (!own(s, pl, play.target) || !isGroup(s, play.target) || !hasAttr(s, play.target!, 'Nation')) return 'Choose a Nation you control.';
      const payer = play.payWith?.length ? play.payWith : [play.target!];
      const err = spend(s, pl, payer);
      if (err || payer.length !== 1 || (payer[0] !== play.target && payer[0] !== s.cards[play.target!].master)) return 'This uses the action of the Nation or of its master.';
      return null;
    },
    apply(s, _pl, play) { pay(s, play.payWith?.length ? play.payWith : [play.target!]); },
    resolve(s, pl, play) {
      if (!own(s, pl, play.target)) return;
      const g = s.cards[play.target!];
      g.mods.push({ source: play.card, kind: 'power', value: 2, until: 'permanent' });
      if (!alignments(s, g.iid).includes('Violent')) g.mods.push({ source: play.card, kind: 'addAlign', align: 'Violent', until: 'permanent' });
      s.cards[play.card].linkedTo = g.iid;
      log(s, `${cardName(s, g.iid)} becomes a Dictatorship.`, pl);
    },
  },

  'double-cross': {
    timing: ['counter'],
    needs: { target: 'plot' },
    check(s, pl, play, ctx) {
      const spy = counterPool(s, ctx).find((p) => p.iid === play.target);
      if (!spy || !SPY_PLOTS.has(s.cards[spy.iid].cardId) || spy.player === pl) return 'Play this against a rival\'s Plot that looks at your hidden Plots.';
      const t = spy.play.target && s.cards[spy.play.target];
      const victim = t ? t.controller ?? t.owner : livePlayers(s).filter((p) => p.id !== spy.player).length === 1 ? pl : undefined;
      return victim === pl ? null : 'That Plot is not spying on you.';
    },
    apply: (_s, _pl, play): PlotEffect => ({ t: 'cancelPlot', target: play.target! }),
  },

  'early-warning': {
    timing: ['attack'],
    check(s, pl, play, ctx) {
      if (!ctx?.disaster) return 'Play this when a Disaster strikes a Place.';
      if (play.target && play.target !== ctx.target) return 'Early Warning protects the Place the Disaster is striking.';
      return null;
    },
    apply(s, pl, play, ctx) {
      ctx!.defenseBonus.push({ player: pl, plot: play.card, forGroup: undefined, amount: 10, label: 'Early Warning' });
    },
  },

  'faction-fight': {
    timing: ['declare'],
    check(s, pl, _play, ctx) {
      if (!ctx || ctx.instant || ctx.attackerPlayer !== pl) return 'Play this when you declare an attack.';
      if (ctx.fromHand || !ctx.targetPlayer || ctx.targetPlayer === pl) return 'The target must be a Group controlled by a rival.';
      if (ctx.usedAgents) return 'Only one agents card may be used per attack.';
      if (!player(s, pl).hand.some((h) => h !== ctx.target && s.cards[h].cardId === s.cards[ctx.target].cardId)) return 'You need a duplicate card of the Group you are attacking.';
      if (anyHook(s, (h, self) => controllerOf2(s, self) === ctx.targetPlayer && h.cancelAgents?.(s, self) === true)) return 'Agents give no bonus against this Group.';
      return null;
    },
    apply(s, pl, play, ctx): PlotEffect {
      const dup = player(s, pl).hand.find((h) => h !== ctx!.target && s.cards[h].cardId === s.cards[ctx!.target].cardId)!;
      toTable(s, pl, dup);
      ctx!.attackBonus.push({ player: pl, plot: dup, amount: 10, label: `Agents (${cardName(s, dup)})` });
      ctx!.plays.push({ iid: dup, player: pl, play: { card: dup }, effect: { t: 'none' } });
      ctx!.usedAgents = true;
      ctx!.attackBonus.push({ player: pl, plot: play.card, amount: 5, label: 'Faction Fight' });
      return { t: 'privileged' };
    },
  },

  'foiled': {
    timing: ['anytime'],
    needs: { pay: 'tokens' },
    check(s, pl, play) {
      if (!foiledGoal(s, pl, play)) return 'Choose an exposed Goal card of a rival.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      return play.payWith?.length === 1 && hasAttr(s, play.payWith[0], 'Media') ? null : 'Pay with the action of one of your Media Groups.';
    },
    apply(s, pl, play, ctx) {
      pay(s, play.payWith);
      s.cards[play.card].data = { goal: foiledGoal(s, pl, play) };
      if (ctx) foil(s, play);
    },
    resolve: (s, _pl, play) => foil(s, play),
  },

  'forgery': {
    timing: ['anytime'],
    check(s, pl, play, ctx) {
      if (!ownMain(s, pl, ctx)) return 'Play Forgery in your own turn, outside an attack.';
      return forgeryCard(s, pl, play) ? null : 'You need a Unique Resource in your hand that duplicates one already in play.';
    },
    apply(s, pl, play) { s.cards[play.card].data = { resource: forgeryCard(s, pl, play) }; },
    resolve(s, pl, play) {
      const r = s.cards[play.card].data?.resource as string | undefined;
      if (!r || !player(s, pl).hand.includes(r)) return;
      for (const c of Object.values(s.cards)) {
        if (c.iid !== r && c.cardId === s.cards[r].cardId && c.zone === 'resources') {
          log(s, `${player(s, c.controller ?? c.owner).name}'s ${cardName(s, c.iid)} was a forgery and is discarded.`, pl);
          discardCard(s, c.iid);
        }
      }
      playResourceCard(s, r, pl);
    },
  },

  'full-moon': {
    timing: ['anytime'],
    check(s, pl, play) {
      for (const g of play.targets ?? []) {
        if (!inPlay(s, g) || !isGroup(s, g) || !alignments(s, g).includes('Fanatic') || s.cards[g].controller === pl) return 'Other Groups you choose must be Fanatic Groups of other players.';
        if (shielded(s, pl, g)) return 'That player has not finished a first turn yet.';
      }
      return null;
    },
    ...effectNow((s, pl, play) => {
      let n = 0;
      const mine = structureCards(s, pl).filter((g) => isGroup(s, g) && alignments(s, g).includes('Fanatic'));
      for (const g of [...mine, ...(play.targets ?? [])]) {
        const c = s.cards[g];
        if (c.zone !== 'structure' || c.capturedTurn === s.turn) continue;
        const before = c.tokens;
        giveToken(s, g);
        if (c.tokens > before) n++;
      }
      log(s, `Full Moon: ${n} Fanatic Group${n === 1 ? ' gets' : 's get'} an Action token.`, pl);
    }),
  },

  'gremlins': {
    timing: ['anytime'],
    needs: { target: 'anyGroup', mode: ['computer', 'gadget'] },
    check(s, pl, play) {
      if (play.mode === 'gadget') {
        return pickResource(s, pl, play, (r) => resourceIs(s, r, 'Gadget') && s.cards[r].controller !== pl) ? null : 'Choose a Gadget Resource a rival controls.';
      }
      if (!inPlay(s, play.target) || !isGroup(s, play.target) || !hasAttr(s, play.target!, 'Computer')) return 'Choose a Computer Group in play.';
      return null;
    },
    apply(s, pl, play, ctx): PlotEffect | void {
      if (play.mode === 'gadget') {
        s.cards[play.card].data = { resource: pickResource(s, pl, play, (r) => resourceIs(s, r, 'Gadget') && s.cards[r].controller !== pl) };
        if (ctx) bounce(s, play);
        return;
      }
      if (!ctx) return;
      if (actingGroups(ctx).includes(play.target!)) return { t: 'cancelGroup', group: play.target! };
      s.cards[play.target!].tokens = Math.max(0, s.cards[play.target!].tokens - 1);
    },
    resolve(s, _pl, play) {
      if (play.mode === 'gadget') return bounce(s, play);
      if (inPlay(s, play.target)) s.cards[play.target!].tokens = Math.max(0, s.cards[play.target!].tokens - 1);
    },
  },
});

function foil(s: GameState, play: PlotPlay) {
  const g = s.cards[play.card].data?.goal as string | undefined;
  if (!g || s.cards[g].zone !== 'hand' || !s.cards[g].exposed) return;
  log(s, `${cardName(s, g)} is foiled and discarded.`);
  discardCard(s, g);
}

function bounce(s: GameState, play: PlotPlay) {
  const r = s.cards[play.card].data?.resource as string | undefined;
  if (!r || s.cards[r].zone !== 'resources') return;
  const to = s.cards[r].controller ?? s.cards[r].owner;
  Object.assign(s.cards[r], { zone: 'hand', controller: undefined, linkedTo: undefined, tokens: 0 });
  player(s, to).hand.push(r);
  log(s, `${cardName(s, r)} goes back to ${player(s, to).name}'s hand.`);
}

// ---------------------------------------------------------------- ongoing effects of linked Plots

registerHooks({
  // The bonus ends if either linked card is captured or destroyed.
  'celebrity-spokesman': {
    onCapture(s, self, victim) {
      const c = s.cards[self];
      if (victim !== c.linkedTo && victim !== c.data?.org) return;
      dropMods(s, c.linkedTo, self);
      log(s, 'Celebrity Spokesman ends.');
      discardCard(s, self);
    },
    onDestroy(s, self, victim) {
      const c = s.cards[self];
      if (victim !== c.linkedTo && victim !== c.data?.org) return;
      dropMods(s, c.linkedTo, self);
      discardCard(s, self);
    },
  },

  // Played during an attack: becomes permanent when the attack ends (if the Group is in play).
  'commitment': {
    onAttackEnd(s, self, ctx) {
      const c = s.cards[self];
      if (c.data?.pendingAttack !== ctx.id) return;
      c.data = {};
      if (inPlay(s, c.linkedTo)) s.cards[c.linkedTo!].mods.push({ source: self, kind: 'setResistance', value: 8, until: 'permanent' });
      else discardCard(s, self);
    },
  },

  // Used up by the Bank's next action (Power) or next defense (Resistance).
  'currency-speculation': {
    onAttackEnd(s, self, ctx) {
      const c = s.cards[self];
      const g = c.linkedTo!;
      const data = c.data ?? {};
      if (data.used) { dropMods(s, g, self); discardCard(s, self); return; }
      if (data.pendingAttack === ctx.id) {
        c.data = { mode: data.mode };
        if (inPlay(s, g)) s.cards[g].mods.push({ source: self, kind: data.mode === 'resistance' ? 'mulResistance' : 'mulPower', value: 3, until: 'permanent', countsForGoals: false });
        else discardCard(s, self);
        return;
      }
      const usedUp = data.mode === 'resistance' ? ctx.target === g : actingGroups(ctx).includes(g);
      if (usedUp) { dropMods(s, g, self); discardCard(s, self); }
    },
  },
});

// Not encoded (they need engine support), so they are not registered and the game won't offer them:
//   corruption, cover-of-darkness, crop-circles, earth-magic, embezzlement, epidemic, exposed,
//   george-the-janitor, giant-kudzu, hat-trick, head-in-a-jar.
registerPlots({
  // Hex: destroy a rival's Magic Resource.
  'hex': {
    timing: ['anytime'],
    needs: { pay: 'tokens' },
    check(s, pl, play, ctx) {
      if (ctx && isPrivileged(ctx)) return 'Hex cannot be played during a Privileged attack.';
      if (!pickResource(s, pl, play, (r) => resourceIs(s, r, 'Magic') && s.cards[r].controller !== pl)) return 'Choose a Magic Resource a rival controls.';
      const err = spend(s, pl, play.payWith);
      if (err) return err;
      const g = play.payWith?.[0];
      if (play.payWith?.length !== 1 || !(g === player(s, pl).illuminati || (hasAttr(s, g!, 'Magic') && power(s, g!) >= 3))) return 'Pay with the action of your Illuminati or of a Magic Group with Power 3 or more.';
      return null;
    },
    apply(s, pl, play, ctx) {
      pay(s, play.payWith);
      s.cards[play.card].data = { resource: pickResource(s, pl, play, (r) => resourceIs(s, r, 'Magic') && s.cards[r].controller !== pl) };
      if (ctx) hex(s, play);
    },
    resolve: (s, _pl, play) => hex(s, play),
  },
});

function hex(s: GameState, play: PlotPlay) {
  const r = s.cards[play.card].data?.resource as string | undefined;
  if (!r || s.cards[r].zone !== 'resources') return;
  log(s, `${cardName(s, r)} is hexed and discarded.`);
  discardCard(s, r);
}
