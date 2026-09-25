// Deals, trades and gifts between players (R040, R022 and the transfer part of R038), and I Lied.
//
// A deal is an offer from one player to another: what the offerer hands over, what he asks for in
// return (nothing, for a gift), and an optional promise about the future. Offers are private to the
// two players (deals may be made secretly), never block the game, and lapse when the turn they were
// made in ends. When the other player accepts, both sides change hands at once, as one step: if any
// part is not legal at that moment, nothing happens. A promise is only words: the engine shows it and
// never enforces it, since only an exchange made on the spot binds anybody.
//
// What can change hands:
//  - cards in hand (hidden or exposed Plots, Group and Resource cards), at any time except while a
//    player is in the middle of a decision or a draw, while a Plot waits to resolve (it may be looking
//    at or taking cards from a hand), or from a player outside a Privileged attack to one inside it;
//  - Resources in play not used this turn, and Groups in play with their puppets (for one Action token
//    from the Group, its old or new master, or either Illuminati), only in the main phase of one of the
//    two players and while nothing else is going on.
// Undrawn cards and Action tokens never change hands.
//
// I Lied is played the moment a deal is agreed: the liar's side is held back while the others may
// counter the Plot, and is handed over after all only if I Lied is cancelled. The other side is
// delivered at once, as the card says. The player accepting plays it with his answer; the offerer
// commits it secretly with his offer (online games are played a move at a time, so the offerer is
// not asked again after the other player accepts).
import type { Action, Deal, DealGroup, DealSide, DealWait, GameState, PlayedPlot } from './types';
import { RuleError } from './types';
import { cardName, def } from './cards';
import { openArrows, subtree } from './geometry';
import { registerPlots } from './plotTypes';
import { activePlayer, canExpose, isPrivileged, livePlayers, log, moveSubtree, player, tokenBarred } from './game';

export const I_LIED = 'i-lied';
/** Open offers one player may have at a time. */
export const MAX_OPEN_OFFERS = 3;
/** Most cards of the giver's choice one offer may ask for. */
export const MAX_ANY = 5;
export const MAX_NOTE = 200;

export type DealAction = Extract<Action, { type: 'offerDeal' | 'respondDeal' | 'cancelDeal' }>;
export const isDealAction = (a: Action): a is DealAction => a.type === 'offerDeal' || a.type === 'respondDeal' || a.type === 'cancelDeal';

/** Are deals allowed in this game (a house rule may turn them off)? */
export const dealsAllowed = (s: GameState) => !s.settings.houseRules.includes('noDeals');

/** Open offers made to this player. */
export function offersTo(s: GameState, pl: string): Deal[] {
  return (s.deals ?? []).filter((d) => d.to === pl);
}
/** Open offers this player has made. */
export function offersFrom(s: GameState, pl: string): Deal[] {
  return (s.deals ?? []).filter((d) => d.from === pl);
}

export function sideEmpty(d: DealSide): boolean {
  return !d.cards?.length && !d.resources?.length && !d.groups?.length && !d.anyPlots && !d.anyCards;
}
const inPlayParts = (d: DealSide) => !!(d.resources?.length || d.groups?.length);
const handParts = (d: DealSide) => !!(d.cards?.length || d.anyPlots || d.anyCards);

// ---------------------------------------------------------------- what can change hands, and when

/** Why cards in hand cannot go from `giver` to `receiver` right now (null if they can). */
export function handTiming(s: GameState, giver: string, receiver: string): string | null {
  if (s.prompt) return 'Cards in hand cannot change hands while a player is in the middle of a decision or a draw.';
  if (s.window?.kind === 'plot') return 'Cards in hand cannot change hands while a Plot is waiting to take effect.';
  const ctx = s.attack;
  if (ctx && isPrivileged(ctx)) {
    const inIt = [ctx.attackerPlayer, ctx.targetPlayer];
    if (inIt.includes(receiver) && !inIt.includes(giver)) return 'Nobody may give or trade cards to a player in a Privileged attack until it is over.';
  }
  return null;
}

/** Why Groups and Resources in play cannot change hands between these two players right now. */
export function playTiming(s: GameState, a: string, b: string): string | null {
  if (s.phase !== 'main' || ![a, b].includes(activePlayer(s).id)) return 'Groups and Resources in play change hands only in the main phase of one of the two players\' turns.';
  if (s.attack || s.window || s.prompt) return 'Groups and Resources in play change hands only when no attack, response or decision is under way.';
  if (s.turnFlags.restricted) return 'Nothing in play may change hands this turn: the active player may only draw cards and place Action tokens.';
  return null;
}

export function handCardProblem(s: GameState, giver: string, iid: string): string | null {
  const c = s.cards[iid];
  if (!c || !player(s, giver).hand.includes(iid)) return 'That card is no longer in the giver\'s hand.';
  if (c.failedTakeoverTurn === s.turn) return `${cardName(s, iid)} failed its takeover this turn and is about to be discarded.`;
  if (!canExpose(s, iid)) return 'A Plot hidden beneath a card is not really in the hand and cannot be given away.';
  return null;
}

/** Has a Resource been used this turn (an activated ability)? A used Resource cannot be given away until next turn. */
export function resourceUsed(s: GameState, iid: string): boolean {
  return Object.values(s.cards[iid]?.abilityTurns ?? {}).includes(s.turn);
}

export function resourceProblem(s: GameState, giver: string, receiver: string, iid: string): string | null {
  const c = s.cards[iid];
  if (!c || c.zone !== 'resources' || c.controller !== giver) return 'That Resource is not in play on the giver\'s side.';
  if (c.hiddenUnder) return 'A Resource face down under another card goes only with that card.';
  if (resourceUsed(s, iid)) return `${cardName(s, iid)} has been used this turn, so it cannot be given away until the next turn.`;
  if (/one per player/i.test(def(s, iid).uniqueness ?? '') && Object.values(s.cards).some((o) => o.cardId === c.cardId && o.zone === 'resources' && o.controller === receiver)) {
    return `${player(s, receiver).name} already has ${cardName(s, iid)}, and a player may have only one.`;
  }
  return null;
}

/** Cards whose token may pay for handing a Group over. */
export function groupPayers(s: GameState, giver: string, receiver: string, g: DealGroup): string[] {
  const c = s.cards[g.group];
  return [g.group, c?.master, g.onto, player(s, giver).illuminati, player(s, receiver).illuminati].filter((x): x is string => !!x);
}

export function groupProblem(s: GameState, giver: string, receiver: string, g: DealGroup): string | null {
  const c = s.cards[g.group];
  if (!c || c.zone !== 'structure' || c.controller !== giver || def(s, g.group).type !== 'Group') return 'That Group is not in the giver\'s Power Structure.';
  if (!g.onto || !g.side) return `Choose where ${cardName(s, g.group)} will go.`;
  const m = s.cards[g.onto];
  if (!m || m.zone !== 'structure' || m.controller !== receiver) return `${cardName(s, g.group)} must go onto a card in ${player(s, receiver).name}'s Power Structure.`;
  if (!openArrows(s, g.onto).includes(g.side)) return `That arrow of ${cardName(s, g.onto)} is not open.`;
  const pay = g.payWith ? s.cards[g.payWith] : undefined;
  if (!g.payWith || !pay || !groupPayers(s, giver, receiver, g).includes(g.payWith) || pay.tokens < 1 || tokenBarred(s, g.payWith)) {
    return `Handing over ${cardName(s, g.group)} costs one Action token from it, its old or new master, or either player's Illuminati.`;
  }
  return null;
}

// ---------------------------------------------------------------- describing a side

function describe(s: GameState, side: DealSide, full: boolean): string {
  const parts: string[] = [];
  const cards = side.cards ?? [];
  const shown = cards.filter((c) => full || s.cards[c]?.exposed);
  const hidden = cards.length - shown.length;
  for (const c of shown) parts.push(`${cardName(s, c)}${def(s, c).type === 'Plot' ? '' : ` (${def(s, c).type} card)`}`);
  if (hidden) parts.push(`${hidden} card${hidden === 1 ? '' : 's'} from hand`);
  for (const r of side.resources ?? []) parts.push(`${cardName(s, r)} (Resource)`);
  for (const g of side.groups ?? []) {
    const n = subtree(s, g.group).length - 1;
    parts.push(`${cardName(s, g.group)}${n > 0 ? ` with ${n} puppet${n === 1 ? '' : 's'}` : ''}`);
  }
  if (side.anyPlots) parts.push(`${side.anyPlots} Plot${side.anyPlots === 1 ? '' : 's'} of their choice`);
  if (side.anyCards) parts.push(`${side.anyCards} Group or Resource card${side.anyCards === 1 ? '' : 's'} of their choice`);
  return parts.length ? parts.join(', ') : 'nothing';
}

/** What an offer says, in plain words, for one of its two players. */
export function dealText(s: GameState, d: Deal, viewer: string): string {
  const from = viewer === d.from ? 'you' : player(s, d.from).name;
  const to = viewer === d.to ? 'you' : player(s, d.to).name;
  const gift = sideEmpty(d.get);
  const ask = sideEmpty(d.give);
  let t = gift ? `${from} give${from === 'you' ? '' : 's'} ${to} ${describe(s, d.give, true)} as a gift`
    : ask ? `${from} ask${from === 'you' ? '' : 's'} ${to} for ${describe(s, d.get, true)}`
    : `${from} give${from === 'you' ? '' : 's'} ${describe(s, d.give, true)} in return for ${describe(s, d.get, true)}`;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (d.note) t += ` (promise: "${d.note}")`;
  return t;
}

/** A line only one player sees. */
function tell(s: GameState, pl: string, text: string) {
  s.log.push({ turn: s.turn, player: pl, to: pl, text });
}

// ---------------------------------------------------------------- handing things over

/**
 * Hand one side of a deal from `giver` to `receiver`. Strictly, anything not legal throws (and the
 * whole move is undone); otherwise (a side delivered late, after a cancelled I Lied) it is left out.
 */
function deliver(s: GameState, giver: string, receiver: string, side: DealSide, strict: boolean): DealSide {
  const done: DealSide = { cards: [], resources: [], groups: [] };
  const skip = (why: string) => {
    if (strict) throw new RuleError(why);
    log(s, `Left out of the deal: ${why}`);
  };
  const gp = player(s, giver), rp = player(s, receiver);
  if (side.cards?.length) {
    const why = handTiming(s, giver, receiver);
    if (why) skip(why);
    else for (const iid of side.cards) {
      const err = handCardProblem(s, giver, iid);
      if (err) { skip(err); continue; }
      const c = s.cards[iid];
      gp.hand = gp.hand.filter((x) => x !== iid);
      rp.hand.push(iid);
      Object.assign(c, { zone: 'hand', controller: undefined, failedTakeoverTurn: undefined });
      // The giver knows which card he handed over; nobody else learns it (R040).
      if (!c.exposed) gp.known = [...new Set([...(gp.known ?? []), iid])];
      done.cards!.push(iid);
    }
  }
  if (inPlayParts(side)) {
    const why = playTiming(s, giver, receiver);
    if (why) { skip(why); return done; }
  }
  for (const r of side.resources ?? []) {
    const err = resourceProblem(s, giver, receiver, r);
    if (err) { skip(err); continue; }
    // A Resource given away is linked to the receiver's Illuminati; he may re-link it in his main phase.
    Object.assign(s.cards[r], { controller: receiver, linkedTo: rp.illuminati, linkMovedTurn: undefined });
    done.resources!.push(r);
  }
  for (const g of side.groups ?? []) {
    const err = groupProblem(s, giver, receiver, g);
    if (err) { skip(err); continue; }
    s.cards[g.payWith!].tokens--;
    moveSubtree(s, g.group, receiver, g.onto!, g.side!, 'hand');
    const tree = subtree(s, g.group);
    // Moving under a Devastated Place costs the moved Groups their tokens (R037).
    for (const x of tree) if (tokenBarred(s, x)) s.cards[x].tokens = 0;
    // Resources linked to the Group and its puppets go with them.
    for (const r of Object.values(s.cards)) if (r.zone === 'resources' && r.linkedTo && tree.includes(r.linkedTo)) r.controller = receiver;
    done.groups!.push(g);
  }
  return done;
}

function logHandover(s: GameState, giver: string, receiver: string, side: DealSide) {
  if (sideEmpty(side)) return;
  const g = player(s, giver).name, r = player(s, receiver).name;
  log(s, `${g} hands ${r} ${describe(s, side, false)}.`, giver);
  if (side.cards?.some((c) => !s.cards[c].exposed)) {
    const text = describe(s, side, true);
    tell(s, giver, `You hand ${r}: ${text}.`);
    tell(s, receiver, `${g} hands you: ${text}.`);
  }
}

// ---------------------------------------------------------------- I Lied

/** Why this player cannot play I Lied on a deal right now (null if he can). */
export function lieProblem(s: GameState, pl: string, card: string): string | null {
  const c = s.cards[card];
  if (!c || c.cardId !== I_LIED || !player(s, pl).hand.includes(card)) return 'Choose an I Lied card from your hand.';
  if (s.attack) return 'I Lied cannot be played while an attack is under way; agree to the deal once the attack is over.';
  if (s.prompt || (s.window && s.window.kind !== 'event' && s.window.kind !== 'endOfTurn')) return 'I Lied cannot be played while another card is being resolved.';
  if (activePlayer(s).id === pl && (s.turnFlags.extraTurn || s.turnFlags.restricted)) return 'You may play no Plots this turn.';
  return null;
}

/** Play the next I Lied of an agreed deal, or finish the deal once every one has been answered. */
function nextLie(s: GameState, w: DealWait) {
  if (w.lies.some((l) => l.state === 'playing')) return;
  const l = w.lies.find((x) => x.state === 'waiting');
  if (!l) { s.dealWaits = (s.dealWaits ?? []).filter((x) => x !== w); return; }
  const other = l.player === w.deal.from ? w.deal.to : w.deal.from;
  const err = lieProblem(s, l.player, l.card);
  if (err || player(s, l.player).eliminated) {
    // The card is gone or cannot be played now: the liar is bound by the deal after all.
    l.state = 'cancelled';
    tell(s, l.player, `Your I Lied could not be played (${err ?? 'you are out of the game'}), so you hand over your side of the deal.`);
    handOver(s, w, l.player, other);
    nextLie(s, w);
    return;
  }
  l.state = 'playing';
  const p = player(s, l.player);
  p.hand = p.hand.filter((x) => x !== l.card);
  Object.assign(s.cards[l.card], { zone: 'table', controller: l.player, exposed: false, data: { ...s.cards[l.card].data, dealWait: w.id } });
  log(s, `${p.name} plays I Lied on the deal just made with ${player(s, other).name}: ${p.name} does not have to hand over their side, but ${player(s, other).name} still does.`, l.player);
  const pp: PlayedPlot = { iid: l.card, player: l.player, play: { card: l.card }, effect: { t: 'none' } };
  // Like any Plot, it waits for the others to counter it; the window of an event it interrupts reopens afterwards.
  const fromEvent = s.window?.kind === 'event' ? s.window.event : undefined;
  s.window = { kind: 'plot', passed: [l.player], plot: pp, plays: [pp], deadline: Date.now() + s.settings.responseHours * 3600_000, event: fromEvent };
}

function handOver(s: GameState, w: DealWait, giver: string, receiver: string) {
  const side = giver === w.deal.from ? w.deal.give : w.deal.get;
  const done = deliver(s, giver, receiver, side, false);
  logHandover(s, giver, receiver, done);
}

/** I Lied has resolved (kept) or been cancelled. */
function settleLie(s: GameState, card: string, kept: boolean) {
  const w = (s.dealWaits ?? []).find((x) => x.lies.some((l) => l.card === card && l.state === 'playing'));
  if (!w) return;
  const l = w.lies.find((x) => x.card === card && x.state === 'playing')!;
  const other = l.player === w.deal.from ? w.deal.to : w.deal.from;
  l.state = kept ? 'kept' : 'cancelled';
  if (kept) log(s, `${player(s, l.player).name} keeps their side of the deal.`, l.player);
  else {
    log(s, `I Lied was cancelled: ${player(s, l.player).name} must hand over their side of the deal after all.`, l.player);
    if (!player(s, l.player).eliminated && !player(s, other).eliminated) handOver(s, w, l.player, other);
  }
  nextLie(s, w);
}

registerPlots({
  [I_LIED]: {
    timing: [],
    check: () => 'Play I Lied as you accept a deal, or add it to an offer you make: it is played the moment the deal is agreed.',
    apply: () => undefined,
    resolve: (s, _pl, play) => settleLie(s, play.card, true),
    refund: (s, _pl, play) => settleLie(s, play.card, false),
  },
});

// ---------------------------------------------------------------- offers

function clean(d: DealSide | undefined): DealSide {
  const uniq = (xs?: string[]) => [...new Set((xs ?? []).filter((x) => typeof x === 'string'))];
  const seen = new Set<string>();
  const groups = (d?.groups ?? []).filter((g) => g && typeof g.group === 'string' && !seen.has(g.group) && seen.add(g.group))
    .map((g) => ({ group: g.group, onto: g.onto, side: g.side, payWith: g.payWith }));
  const n = (x?: number) => (Number.isInteger(x) && x! > 0 ? Math.min(MAX_ANY, x!) : 0);
  const out: DealSide = {};
  if (uniq(d?.cards).length) out.cards = uniq(d?.cards);
  if (uniq(d?.resources).length) out.resources = uniq(d?.resources);
  if (groups.length) out.groups = groups;
  if (n(d?.anyPlots)) out.anyPlots = n(d?.anyPlots);
  if (n(d?.anyCards)) out.anyCards = n(d?.anyCards);
  return out;
}

function checkParties(s: GameState, a: string, b: string) {
  if (s.phase === 'setup') throw new RuleError('Deals can be made once the game has begun.');
  if (!dealsAllowed(s)) throw new RuleError('Deals between players are turned off in this game.');
  if (a === b) throw new RuleError('Choose another player.');
  const pa = player(s, a), pb = player(s, b);
  if (pa.eliminated || pb.eliminated) throw new RuleError('That player is out of the game.');
}

/** A Group item may not sit inside another Group item's puppets (it moves with its master anyway). */
function checkNesting(s: GameState, groups: DealGroup[]) {
  for (const g of groups) for (const h of groups) {
    if (g !== h && s.cards[h.group]?.zone === 'structure' && subtree(s, h.group).includes(g.group)) {
      throw new RuleError(`${cardName(s, g.group)} is a puppet of ${cardName(s, h.group)} and goes with it anyway.`);
    }
  }
}

function offer(s: GameState, pl: string, a: Extract<Action, { type: 'offerDeal' }>) {
  checkParties(s, pl, a.to);
  const give = clean(a.give), get = clean(a.get);
  delete give.anyPlots; delete give.anyCards; // you name the cards you give
  if (sideEmpty(give) && sideEmpty(get)) throw new RuleError('Put something into the deal.');
  if (a.counterOf) {
    const o = (s.deals ?? []).find((d) => d.id === a.counterOf);
    if (!o || o.to !== pl || o.from !== a.to) throw new RuleError('That offer is no longer open.');
  }
  if (offersFrom(s, pl).filter((d) => d.id !== a.counterOf).length >= MAX_OPEN_OFFERS) throw new RuleError(`You may have at most ${MAX_OPEN_OFFERS} offers waiting for an answer.`);
  if ((inPlayParts(give) || inPlayParts(get)) && (s.phase !== 'main' || ![pl, a.to].includes(activePlayer(s).id))) {
    throw new RuleError('Groups and Resources in play change hands only in the main phase of one of the two players\' turns.');
  }
  const me = player(s, pl), them = player(s, a.to);
  // What you give.
  for (const c of give.cards ?? []) { const e = handCardProblem(s, pl, c); if (e) throw new RuleError(e); }
  for (const r of give.resources ?? []) { const e = resourceProblem(s, pl, a.to, r); if (e) throw new RuleError(e); }
  for (const g of give.groups ?? []) {
    const c = s.cards[g.group];
    if (!c || c.zone !== 'structure' || c.controller !== pl || def(s, g.group).type !== 'Group') throw new RuleError('You can only give Groups in your own Power Structure (not your Illuminati).');
    g.onto = undefined; g.side = undefined; // the receiver chooses where it goes
    if (g.payWith && (![g.group, c.master, me.illuminati].includes(g.payWith) || s.cards[g.payWith]?.tokens < 1)) throw new RuleError('Pay for handing over a Group with a token from it, its master, or your Illuminati (or leave it to the other player).');
  }
  checkNesting(s, give.groups ?? []);
  // What you ask for: only what you can see.
  for (const c of get.cards ?? []) {
    if (!them.hand.includes(c) || !(s.cards[c].exposed || me.known?.includes(c))) throw new RuleError(`You can only ask for cards of ${them.name}'s you can see; ask for a Plot of their choice instead.`);
    const e = handCardProblem(s, a.to, c); if (e) throw new RuleError(e);
  }
  for (const r of get.resources ?? []) { const e = resourceProblem(s, a.to, pl, r); if (e) throw new RuleError(e); }
  for (const g of get.groups ?? []) {
    const c = s.cards[g.group];
    if (!c || c.zone !== 'structure' || c.controller !== a.to || def(s, g.group).type !== 'Group') throw new RuleError(`You can only ask for Groups in ${them.name}'s Power Structure (not an Illuminati).`);
    const m = g.onto ? s.cards[g.onto] : undefined;
    if (!m || m.zone !== 'structure' || m.controller !== pl || !g.side || !openArrows(s, g.onto!).includes(g.side)) throw new RuleError(`Choose an open arrow in your Power Structure for ${cardName(s, g.group)}.`);
    if (g.payWith && (![g.onto, me.illuminati].includes(g.payWith) || s.cards[g.payWith]?.tokens < 1)) throw new RuleError('Pay with a token from the new master or your Illuminati (or leave it to the other player).');
  }
  checkNesting(s, get.groups ?? []);
  if (a.lie) {
    const c = s.cards[a.lie];
    if (!c || c.cardId !== I_LIED || !me.hand.includes(a.lie) || give.cards?.includes(a.lie)) throw new RuleError('Choose an I Lied card from your hand that is not part of the deal.');
  }
  if (a.counterOf) {
    s.deals = (s.deals ?? []).filter((d) => d.id !== a.counterOf);
    tell(s, a.to, `${me.name} turns down your offer and makes a counter-offer.`);
  }
  const note = typeof a.note === 'string' ? a.note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE) : '';
  const d: Deal = { id: `d${(s.dealCounter = (s.dealCounter ?? 0) + 1)}`, from: pl, to: a.to, turn: s.turn, give, get, ...(note ? { note } : {}), ...(a.lie ? { lie: a.lie } : {}), ...(a.counterOf ? { counterOf: a.counterOf } : {}) };
  (s.deals ??= []).push(d);
  s.turnFlags.dealOffers = [...new Set([...(s.turnFlags.dealOffers ?? []), pl])];
  // Showing a hidden card to one rival is allowed: the offer shows him what he would get.
  const shown = (give.cards ?? []).filter((c) => !s.cards[c].exposed);
  if (shown.length) them.known = [...new Set([...(them.known ?? []), ...shown])];
  tell(s, pl, `Your offer to ${them.name}: ${dealText(s, d, pl)}.${a.lie ? ' (You will play I Lied if it is accepted.)' : ''}`);
  tell(s, a.to, `${me.name} makes you an offer: ${dealText(s, d, a.to)}. It lapses at the end of this turn.`);
}

// ---------------------------------------------------------------- answers

/** Fill in the choices an offer leaves to the player accepting it. */
function concrete(s: GameState, d: Deal, a: Extract<Action, { type: 'respondDeal' }>): { give: DealSide; get: DealSide } {
  const me = player(s, d.to);
  const extra = new Map((a.groups ?? []).map((g) => [g.group, g]));
  // Groups coming to me: I choose where they go, and pay if the offerer did not.
  const give: DealSide = { ...d.give, groups: (d.give.groups ?? []).map((g) => {
    const x = extra.get(g.group);
    const payWith = g.payWith ?? x?.payWith;
    if (!g.payWith && payWith && s.cards[payWith]?.controller !== d.to) throw new RuleError('Pay with a token of one of your own cards.');
    return { group: g.group, onto: x?.onto, side: x?.side, payWith };
  }) };
  // Groups I hand over: the offerer chose where; I pay if he did not.
  const get: DealSide = { cards: [...(d.get.cards ?? [])], resources: d.get.resources, groups: (d.get.groups ?? []).map((g) => {
    const x = extra.get(g.group);
    const payWith = g.payWith ?? x?.payWith;
    if (!g.payWith && payWith && s.cards[payWith]?.controller !== d.to) throw new RuleError('Pay with a token of one of your own cards.');
    return { ...g, payWith };
  }) };
  // Cards of my choice.
  const choose = [...new Set(a.choose ?? [])];
  const plots = choose.filter((c) => s.cards[c] && def(s, c).type === 'Plot');
  const others = choose.filter((c) => s.cards[c] && def(s, c).type !== 'Plot');
  if (choose.some((c) => !me.hand.includes(c) || get.cards!.includes(c) || c === a.lie)) throw new RuleError('Choose other cards from your own hand.');
  if (plots.length !== (d.get.anyPlots ?? 0) || others.length !== (d.get.anyCards ?? 0) || others.some((c) => def(s, c).type === 'Illuminati')) {
    const want = [d.get.anyPlots ? `${d.get.anyPlots} Plot${d.get.anyPlots === 1 ? '' : 's'}` : '', d.get.anyCards ? `${d.get.anyCards} Group or Resource card${d.get.anyCards === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
    throw new RuleError(want ? `Choose ${want} from your hand to hand over.` : 'This offer does not ask you to choose cards.');
  }
  get.cards!.push(...choose);
  return { give: clean(give), get: clean(get) };
}

function accept(s: GameState, pl: string, d: Deal, a: Extract<Action, { type: 'respondDeal' }>) {
  const { give, get } = concrete(s, d, a);
  // What each side hands over must be legal right now: try the whole exchange on a copy first.
  const probe: GameState = structuredClone(s);
  deliver(probe, d.from, d.to, give, true);
  deliver(probe, d.to, d.from, get, true);
  if (a.lie) {
    const e = lieProblem(s, pl, a.lie);
    if (e) throw new RuleError(e);
  }
  const lies: DealWait['lies'] = [];
  if (d.lie && !give.cards?.includes(d.lie)) lies.push({ player: d.from, card: d.lie, state: 'waiting' });
  if (a.lie) lies.push({ player: pl, card: a.lie, state: 'waiting' });
  s.deals = (s.deals ?? []).filter((x) => x.id !== d.id);
  const agreed: Deal = { ...d, give, get };
  const me = player(s, pl).name, them = player(s, d.from).name;
  log(s, `${me} accepts a deal with ${them}.`, pl);
  if (d.note) { tell(s, d.from, `${me} accepts your offer. Your promise ("${d.note}") is up to you: nothing makes you keep it.`); tell(s, pl, `You accept ${them}'s offer. The promise ("${d.note}") is only a promise: nothing makes ${them} keep it.`); }
  const liars = new Set(lies.map((l) => l.player));
  // The side of a player who is not lying is handed over at once (I Lied binds the other party).
  if (!liars.has(d.from)) { deliver(s, d.from, d.to, give, true); logHandover(s, d.from, d.to, give); }
  if (!liars.has(d.to)) { deliver(s, d.to, d.from, get, true); logHandover(s, d.to, d.from, get); }
  if (!lies.length) return;
  const w: DealWait = { id: `w${d.id}`, deal: agreed, lies };
  (s.dealWaits ??= []).push(w);
  nextLie(s, w);
}

/** Offers, answers and withdrawals. None of them waits on anybody, so none can hold up the game. */
export function dealAction(s: GameState, pl: string, a: DealAction) {
  if (a.type === 'offerDeal') { offer(s, pl, a); return; }
  const d = (s.deals ?? []).find((x) => x.id === a.deal);
  if (!d) throw new RuleError('That offer is no longer open.');
  if (a.type === 'cancelDeal') {
    if (d.from !== pl) throw new RuleError('Only the player who made an offer can withdraw it.');
    s.deals = s.deals!.filter((x) => x !== d);
    tell(s, pl, `You withdraw your offer to ${player(s, d.to).name}.`);
    tell(s, d.to, `${player(s, pl).name} withdraws the offer made to you.`);
    return;
  }
  if (d.to !== pl) throw new RuleError('That offer was not made to you.');
  if (!a.accept) {
    s.deals = s.deals!.filter((x) => x !== d);
    tell(s, pl, `You turn down ${player(s, d.from).name}'s offer.`);
    tell(s, d.from, `${player(s, pl).name} turns down your offer.`);
    return;
  }
  checkParties(s, d.from, pl);
  accept(s, pl, d, a);
}

/** Offers lapse at the end of the turn they were made in. */
export function lapseDeals(s: GameState) {
  for (const d of s.deals ?? []) {
    if (player(s, d.from).eliminated || player(s, d.to).eliminated) continue;
    tell(s, d.from, `Your offer to ${player(s, d.to).name} lapses with the end of the turn.`);
    tell(s, d.to, `${player(s, d.from).name}'s offer to you lapses with the end of the turn.`);
  }
  s.deals = [];
}

/** Drop offers involving a player who is out, and every offer once the game is over. */
export function tidyDeals(s: GameState) {
  if (!s.deals?.length) return;
  if (s.phase === 'gameOver') { s.deals = []; return; }
  const live = new Set(livePlayers(s).map((p) => p.id));
  s.deals = s.deals.filter((d) => live.has(d.from) && live.has(d.to));
}
