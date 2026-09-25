// How people play. During a game each person's habits are counted move by move (kept inside the
// GameState, so they travel with saves and online records); at the end the game is folded into a
// lasting profile, and the profile becomes "mirror" computer players that play the same way.
// Pure functions: the browser uses them for offline games and the server for online ones.
import { type Action, type AiLevel, type GameState, applyAction, attackStrength } from '../engine';
import { chooseAction } from './ai';
import { attackChance, attackOutcomeScore, evaluate, rollout, standing, successChance } from './evaluate';
import { clampStyle, mirrorName, type Style } from './personas';

/** Counters for one person in one game. Plain numbers only, so they survive JSON saves. */
export interface HabitStats {
  turns: number;
  attacks: number; chanceSum: number; control: number; destroy: number;
  atLeader: number; atWeakest: number; atOther: number; fromHand: number;
  longShots: number; longShotFails: number; wins: number; resolved: number;
  targeted: number; defended: number;
  plotsPlayed: number; plotsBought: number; groupDraws: number;
  othersAttacks: number; meddled: number;
  decisions: number; gapSum: number; mistakes: number;
  // Bookkeeping, so each attack is counted once however many times the player acts in it.
  lastTargeted?: number; lastDefended?: number; lastSeen?: number; lastMeddled?: number;
  open?: { id: number; target: string; type: 'control' | 'destroy'; chance: number };
}

/** Odds below this count as a long shot. */
export const LONG_SHOT = 0.35;
/** A main-phase move this much worse than the Normal computer's choice counts as a mistake. */
export const MISTAKE_GAP = 2;
/** Games needed before a mirror is offered. */
export const MIN_GAMES = 2;
/** How much an older game still counts each time a new one is added. */
const DECAY = 0.85;

export const emptyHabits = (): HabitStats => ({
  turns: 0, attacks: 0, chanceSum: 0, control: 0, destroy: 0, atLeader: 0, atWeakest: 0, atOther: 0, fromHand: 0,
  longShots: 0, longShotFails: 0, wins: 0, resolved: 0, targeted: 0, defended: 0, plotsPlayed: 0, plotsBought: 0,
  groupDraws: 0, othersAttacks: 0, meddled: 0, decisions: 0, gapSum: 0, mistakes: 0,
});

function habitsOf(s: GameState, pl: string): HabitStats {
  s.habits ??= {};
  s.habits[pl] ??= emptyHabits() as unknown as Record<string, unknown>;
  return s.habits[pl] as unknown as HabitStats;
}
export const habitsIn = (s: GameState, pl: string): HabitStats | undefined => s.habits?.[pl] as unknown as HabitStats | undefined;

/** The player is in charge of their own main phase, with nothing else pending. */
const mainDecision = (s: GameState, pl: string) =>
  s.phase === 'main' && !s.window && !s.prompt && !s.attack && s.players[s.active]?.id === pl;

/**
 * Record what `pl` just did (`before` → `after`, which is updated in place). Only people are
 * recorded; call it after every applied action, computers' too, so attacks on people are noticed.
 */
export function observeHuman(before: GameState, after: GameState, pl: string, action: Action): void {
  const p = after.players.find((x) => x.id === pl);
  if (p && !p.isAI) record(before, after, pl, action, habitsOf(after, pl));
  noteAttacks(after);
}

function record(before: GameState, after: GameState, pl: string, a: Action, h: HabitStats) {
  const atk = before.attack;
  switch (a.type) {
    case 'attack': {
      const ctx = after.attack;
      h.plotsPlayed += a.plots?.length ?? 0;
      if (!ctx || ctx.attackerPlayer !== pl || ctx.id === atk?.id) break;
      const chance = successChance(attackStrength(after, ctx).strength);
      h.attacks++; h.chanceSum += chance; h[a.attackType]++;
      if (chance < LONG_SHOT) h.longShots++;
      // Whose Group it was: the leading rival, the weakest one, another, or a Group from our own hand.
      const t = before.cards[a.target];
      if (t?.zone === 'hand') h.fromHand++;
      else {
        const ranked = before.players.filter((x) => x.id !== pl && !x.eliminated).map((x) => ({ id: x.id, v: standing(before, x.id) })).sort((x, y) => y.v - x.v);
        const owner = t?.controller;
        if (owner && owner === ranked[0]?.id) h.atLeader++;
        else if (owner && ranked.length > 1 && owner === ranked[ranked.length - 1].id) h.atWeakest++;
        else h.atOther++;
      }
      h.open = { id: ctx.id, target: a.target, type: a.attackType, chance };
      break;
    }
    case 'playPlot': h.plotsPlayed++; break;
    case 'buyPlot': h.plotsBought++; break;
    case 'drawGroup': h.groupDraws++; break;
    case 'endTurn': if (mainDecision(before, pl)) h.turns++; break;
  }
  // Defending: any answer to a rival's attack on us, once per attack.
  const answers = a.type === 'oppose' || a.type === 'playPlot' || a.type === 'useAbility' || (a.type === 'agent' && a.as === 'oppose');
  if (atk && atk.targetPlayer === pl && atk.attackerPlayer !== pl && answers) {
    if (h.lastTargeted !== atk.id) { h.targeted++; h.lastTargeted = atk.id; }
    if (h.lastDefended !== atk.id) { h.defended++; h.lastDefended = atk.id; }
  }
  // Meddling: helping or hindering in someone else's fight.
  const joins = a.type === 'oppose' || a.type === 'aid' || a.type === 'agent';
  if (atk && joins && atk.attackerPlayer !== pl && atk.targetPlayer !== pl && h.lastMeddled !== atk.id) { h.meddled++; h.lastMeddled = atk.id; }
  if (mainDecision(before, pl)) judgeMove(before, after, pl, a, h);
}

/**
 * Move quality: how the position after the person's move compares with the Normal computer's own
 * choice from the same position. Only the active person's main-phase moves are judged (cheap enough).
 */
function judgeMove(before: GameState, after: GameState, pl: string, a: Action, h: HabitStats) {
  const probe: GameState = { ...before, players: before.players.map((p) => (p.id === pl ? { ...p, aiLevel: 'normal' as AiLevel, aiStyle: undefined, aiStyleData: undefined } : p)) };
  let gap = 0;
  try {
    const best = chooseAction(probe, pl);
    if (JSON.stringify(best) !== JSON.stringify(a)) gap = moveValue(before, applyAction(before, pl, best), pl) - moveValue(before, after, pl);
  } catch { return; } // the computer's pick was not playable here: nothing to compare
  gap = Math.min(30, Math.max(0, gap)); // a win or loss in the look-ahead would swamp everything else
  h.decisions++; h.gapSum += gap;
  if (gap > MISTAKE_GAP) h.mistakes++;
}

/** The position a move leads to; a new attack counts as its two outcomes weighed by the odds. */
function moveValue(before: GameState, after: GameState, pl: string): number {
  const ctx = after.attack;
  if (ctx && ctx.attackerPlayer === pl && ctx.id !== before.attack?.id) {
    const c = attackChance(after);
    return c * attackOutcomeScore(structuredClone(after), pl, true) + (1 - c) * attackOutcomeScore(structuredClone(after), pl, false);
  }
  return evaluate(rollout(after, pl), pl);
}

/** Note attacks that involve people: aimed at them, among others, and how their own ones ended. */
export function noteAttacks(s: GameState): void {
  const ctx = s.attack;
  for (const p of s.players) {
    if (p.isAI) continue;
    const known = habitsIn(s, p.id);
    if (known?.open && ctx?.id !== known.open.id) {
      const o = known.open, c = s.cards[o.target];
      const won = o.type === 'control' ? c?.zone === 'structure' && c.controller === p.id : c?.zone !== 'structure';
      known.resolved++;
      if (won) known.wins++;
      else if (o.chance < LONG_SHOT) known.longShotFails++;
      delete known.open;
    }
    if (!ctx || ctx.attackerPlayer === p.id) continue;
    const h = habitsOf(s, p.id);
    if (ctx.targetPlayer === p.id) { if (h.lastTargeted !== ctx.id) { h.targeted++; h.lastTargeted = ctx.id; } }
    else if (h.lastSeen !== ctx.id) { h.othersAttacks++; h.lastSeen = ctx.id; }
  }
}

// ------------------------------------------------------------------ the lasting profile

/** Traits kept as running weighted averages across games. */
export const TRAITS = ['odds', 'attackRate', 'defendRate', 'destroyShare', 'leaderShare', 'weakestShare', 'handShare',
  'plotRate', 'buyRate', 'drawRate', 'meddleRate', 'gap', 'mistakeRate'] as const;
export type Trait = typeof TRAITS[number];

export interface PlayProfile {
  version: 1;
  games: number;
  wins: number;
  /** Each trait's weighted average and the (decayed) weight behind it. */
  traits: Partial<Record<Trait, { v: number; w: number }>>;
  mistakeRate: number;
  illuminatiPicks: Record<string, number>;
  lastUpdated: number;
  /** The last few games folded in, so a game is never counted twice. */
  recent: string[];
}

export const emptyProfile = (): PlayProfile => ({ version: 1, games: 0, wins: 0, traits: {}, mistakeRate: 0, illuminatiPicks: {}, lastUpdated: 0, recent: [] });

/** A profile read from storage or a database, with anything malformed dropped. */
export function normalizeProfile(raw: unknown): PlayProfile {
  const p = emptyProfile();
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  p.games = Math.max(0, Math.floor(num(r.games)));
  p.wins = Math.max(0, Math.min(p.games, Math.floor(num(r.wins))));
  p.mistakeRate = Math.max(0, Math.min(1, num(r.mistakeRate)));
  p.lastUpdated = num(r.lastUpdated);
  const traits = (r.traits ?? {}) as Record<string, { v?: unknown; w?: unknown }>;
  for (const t of TRAITS) if (traits[t] && num(traits[t].w) > 0) p.traits[t] = { v: num(traits[t].v), w: num(traits[t].w) };
  for (const [k, v] of Object.entries((r.illuminatiPicks ?? {}) as Record<string, unknown>)) if (num(v) > 0) p.illuminatiPicks[k] = Math.floor(num(v));
  if (Array.isArray(r.recent)) p.recent = r.recent.filter((x): x is string => typeof x === 'string').slice(-30);
  return p;
}

/** One game's value for each trait that game gave evidence for. */
export function gameTraits(h: HabitStats): Partial<Record<Trait, number>> {
  const out: Partial<Record<Trait, number>> = {};
  const rivalAttacks = h.atLeader + h.atWeakest + h.atOther;
  if (h.attacks) { out.odds = h.chanceSum / h.attacks; out.handShare = h.fromHand / h.attacks; }
  if (h.control + h.destroy) out.destroyShare = h.destroy / (h.control + h.destroy);
  if (rivalAttacks) { out.leaderShare = h.atLeader / rivalAttacks; out.weakestShare = h.atWeakest / rivalAttacks; }
  if (h.targeted) out.defendRate = Math.min(1, h.defended / h.targeted);
  if (h.turns) {
    out.attackRate = h.attacks / h.turns; out.plotRate = h.plotsPlayed / h.turns;
    out.buyRate = h.plotsBought / h.turns; out.drawRate = h.groupDraws / h.turns;
  }
  if (h.othersAttacks) out.meddleRate = Math.min(1, h.meddled / h.othersAttacks);
  if (h.decisions) { out.gap = h.gapSum / h.decisions; out.mistakeRate = h.mistakes / h.decisions; }
  return out;
}

/**
 * Fold a finished game into the profile. Older games fade (each counts DECAY as much once a new one
 * is added); a won game counts double; and a game whose moves beat the player's usual move quality
 * counts up to twice as much again, so the mirror leans towards how they play at their best.
 */
export function foldGame(profile: PlayProfile, habits: HabitStats | undefined, result: { won: boolean; illuminati?: string; gameId?: string; now?: number }): PlayProfile {
  const p = normalizeProfile(profile);
  if (result.gameId && p.recent.includes(result.gameId)) return p;
  const g = gameTraits(habits ?? emptyHabits());
  const prevGap = p.traits.gap?.v;
  const improvement = prevGap !== undefined && g.gap !== undefined ? Math.min(1, Math.max(0, (prevGap - g.gap) / Math.max(1, prevGap))) : 0;
  const weight = (result.won ? 2 : 1) * (1 + improvement);
  for (const t of TRAITS) {
    const cur = p.traits[t], x = g[t];
    const w = (cur?.w ?? 0) * DECAY;
    if (x === undefined) { if (cur) cur.w = w; continue; }
    p.traits[t] = { v: ((cur?.v ?? 0) * w + x * weight) / (w + weight), w: w + weight };
  }
  p.games++;
  if (result.won) p.wins++;
  p.mistakeRate = p.traits.mistakeRate?.v ?? 0;
  if (result.illuminati) p.illuminatiPicks[result.illuminati] = (p.illuminatiPicks[result.illuminati] ?? 0) + 1;
  p.lastUpdated = result.now ?? Date.now();
  if (result.gameId) p.recent = [...p.recent, result.gameId].slice(-30);
  return p;
}

export const mirrorReady = (p?: PlayProfile) => !!p && p.games >= MIN_GAMES;
/** 0..1: how much a mirror can be trusted to play like its player (full at ten games). */
export const profileConfidence = (p?: PlayProfile) => Math.min(1, (p?.games ?? 0) / 10);

// ------------------------------------------------------------------ mirrors

type MirrorKnobs = Partial<Style> & { mistakes: number };
const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) => y0 + ((Math.min(Math.max(x, Math.min(x0, x1)), Math.max(x0, x1)) - x0) / (x1 - x0)) * (y1 - y0);

/**
 * The profile as the computer's style knobs, each kept inside the range the built-in styles use:
 * odds taken (against a 0.55 baseline) set its risk; how often it defends; the destroy/control mix;
 * who it targets; how it uses Plots; Group draws; and stepping into other players' fights.
 */
export function mirrorStyle(p: PlayProfile): MirrorKnobs {
  const t = (k: Trait) => p.traits[k]?.v;
  const k: Record<string, number | boolean> = {};
  const odds = t('odds'), defend = t('defendRate'), destroy = t('destroyShare'), leader = t('leaderShare'), weakest = t('weakestShare');
  const hand = t('handShare'), buy = t('buyRate'), plots = t('plotRate'), draws = t('drawRate'), meddle = t('meddleRate');
  if (odds !== undefined) { k.risk = (odds - 0.55) * 0.8; if (odds >= 0.75) k.safeBets = true; }
  if (defend !== undefined) {
    k.defend = defend >= 0.6 ? lerp(defend, 0.6, 1, 0, -0.1) : lerp(defend, 0, 0.6, 0.15, 0);
    if (defend >= 0.9 && (p.traits.defendRate?.w ?? 0) >= 2) k.fullDefense = true;
  }
  if (destroy !== undefined) { k.destroy = 1 + (destroy - 0.3) * 2; k.control = 1 - (destroy - 0.3) * 0.6; }
  if (leader !== undefined) k.leader = 1.3 + (leader - 0.4) * 2.5;
  if (weakest !== undefined) k.weakest = 1 + Math.max(0, weakest - 0.3) * 2.5;
  if (hand !== undefined) k.fromHand = (hand - 0.25) * 12;
  if (buy !== undefined) k.plotHand = 4 + Math.max(0, buy - 0.3) * 6;
  if (plots !== undefined) k.schemer = plots >= 0.8;
  if (draws !== undefined) k.collector = draws >= 0.5;
  if (meddle !== undefined) k.meddler = meddle >= 0.3;
  k.mistakes = p.mistakeRate;
  return { mistakes: 0, ...clampStyle(k) } as MirrorKnobs;
}

/**
 * The Illuminati a mirror plays on: the player's second favourite, so they meet their own habits on
 * something other than what they usually learn with. Otherwise any but their favourite.
 */
export function mirrorIlluminati(p: PlayProfile, all: string[] = []): string | undefined {
  const ranked = Object.entries(p.illuminatiPicks).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  return ranked[1] ?? all.find((id) => id !== ranked[0]);
}

/** A small repeatable random stream from a seed (for jitter). */
function stream(seed: number) {
  let x = (seed >>> 0) || 1;
  return () => { x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0; x = (x ^ (x >>> 13)) >>> 0; return x / 4294967296; };
}

const VARIANT_WORDS = ['Mirror', 'Echo', 'Shadow'];
/**
 * `n` mirrors of one player: the first exactly as profiled, the rest nudged a little each way, so a
 * table of them is not three copies of one habit. Named "Your Mirror/Echo/Shadow", or "Ann's …" online.
 */
export function mirrorVariants(p: PlayProfile, n: number, seed: number, owner?: string): { name: string; data: MirrorKnobs }[] {
  const base = mirrorStyle(p);
  const r = stream(seed);
  const nudge = (x: number | undefined, size: number) => (x === undefined ? undefined : x + (r() * 2 - 1) * size);
  return Array.from({ length: n }, (_, i) => {
    const word = `${VARIANT_WORDS[i % 3]}${i >= 3 ? ` ${Math.floor(i / 3) + 1}` : ''}`;
    const name = owner ? `${owner}'s ${word}` : `Your ${word}`;
    if (i === 0) return { name, data: { ...base } };
    const d = { ...base, risk: nudge(base.risk ?? 0, 0.03), defend: nudge(base.defend ?? 0, 0.03), destroy: nudge(base.destroy, 0.1), leader: nudge(base.leader, 0.15) };
    return { name, data: { mistakes: base.mistakes, ...clampStyle(d) } as MirrorKnobs };
  });
}

/** A mirror ready to be seated: the same shape as a line-up seat (src/ui/lineup.ts BotSpec). */
export interface MirrorSeat { name: string; level: AiLevel; style: 'mirror'; data: MirrorKnobs; illuminati?: string; owner?: string }

/** One mirror per level for this player (Normal = Mirror, Easy = Echo, Hard = Shadow), or none yet. */
export function mirrorSeats(p: PlayProfile | undefined, seed: number, owner?: string, all: string[] = []): MirrorSeat[] {
  if (!p || !mirrorReady(p)) return [];
  const v = mirrorVariants(p, 3, seed, owner);
  const illuminati = mirrorIlluminati(p, all);
  return (['normal', 'easy', 'hard'] as AiLevel[]).map((level, i) => ({ name: mirrorName(level, owner), level, style: 'mirror', data: v[i].data, illuminati, owner }));
}

// ------------------------------------------------------------------ telling the player

const pct = (x: number) => `${Math.round(x * 100)}%`;
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** Three to five plain findings about this game, compared with the player's usual play where known. */
export function habitsReport(h: HabitStats | undefined, profile?: PlayProfile): string[] {
  if (!h) return [];
  const out: string[] = [];
  const rivalAttacks = h.atLeader + h.atWeakest + h.atOther;
  if (!h.attacks) out.push('You made no attacks this game.');
  else {
    const avg = h.chanceSum / h.attacks, usual = profile && profile.games >= MIN_GAMES ? profile.traits.odds?.v : undefined;
    out.push(`You attacked ${times(h.attacks)}, at ${pct(avg)} odds on average${usual !== undefined ? ` (usually ${pct(usual)})` : ''}; ${h.wins} of ${h.resolved} succeeded.`);
  }
  if (h.longShots) out.push(`You attacked at under ${pct(LONG_SHOT)} odds ${times(h.longShots)}; ${h.longShotFails} failed.`);
  if (h.targeted) out.push(`You defended ${h.defended} of ${h.targeted} attack${h.targeted === 1 ? '' : 's'} on you.`);
  if (rivalAttacks >= 2) {
    if (!h.atLeader) out.push('You never attacked the leader.');
    else if (h.atLeader / rivalAttacks >= 0.6) out.push(`Most of your attacks on rivals (${h.atLeader} of ${rivalAttacks}) went at the leader.`);
    else if (h.atWeakest / rivalAttacks >= 0.6) out.push(`Most of your attacks on rivals (${h.atWeakest} of ${rivalAttacks}) went at the weakest player.`);
  }
  if (h.decisions) {
    out.push(h.mistakes
      ? `${h.mistakes} of your ${h.decisions} main-phase moves looked clearly weaker than what the Normal computer would have done.`
      : `None of your ${h.decisions} main-phase moves looked clearly weaker than what the Normal computer would have done.`);
  }
  if (out.length < 5 && h.control + h.destroy >= 2) out.push(`You attacked to take control ${times(h.control)} and to destroy ${times(h.destroy)}.`);
  if (out.length < 5 && h.turns) out.push(`You bought ${h.plotsBought} Plot${h.plotsBought === 1 ? '' : 's'} and played ${h.plotsPlayed}.`);
  if (out.length < 3 && h.othersAttacks) out.push(`You joined ${h.meddled} of ${h.othersAttacks} attacks between other players.`);
  return out.slice(0, 5);
}

/** The strongest habits in the profile, in words (for the lobby and the picker). */
export function describeProfile(p: PlayProfile): string[] {
  const k = mirrorStyle(p);
  const out: string[] = [];
  if ((k.risk ?? 0) <= -0.05) out.push('Takes long shots');
  if ((k.risk ?? 0) >= 0.05) out.push('Attacks only at good odds');
  if ((k.defend ?? 0) <= -0.05) out.push('Defends almost everything');
  if ((k.defend ?? 0) >= 0.07) out.push('Often lets attacks through');
  if ((k.destroy ?? 1) >= 1.3) out.push('Prefers destroying Groups');
  if ((k.leader ?? 1.3) >= 1.8) out.push('Goes after the leader');
  if ((k.weakest ?? 1) >= 1.5) out.push('Picks on the weakest');
  if (k.schemer) out.push('Plays Plots freely');
  if (k.collector) out.push('Draws Group cards often');
  if (k.meddler) out.push('Joins other players\' fights');
  return out.length ? out.slice(0, 3) : p.games ? ['Plays a balanced game'] : [];
}

/** What the lobby shows about a player's mirror. */
export function profileSummary(p: PlayProfile) {
  return { games: p.games, wins: p.wins, ready: mirrorReady(p), minGames: MIN_GAMES, confidence: profileConfidence(p), traits: describeProfile(p) };
}
export type ProfileSummary = ReturnType<typeof profileSummary>;

