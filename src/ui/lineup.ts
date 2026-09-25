// The computer line-up for a new game: named players picked by hand, plus a number of random
// ones from each difficulty (and wild cards), resolved into seats when the game starts.
import type { AiLevel } from '../engine/types';
import { mirrorName, STYLES, WILD_CARDS, type PlayStyle } from '../ai/personas';

export type Section = AiLevel | 'wild';
export const SECTIONS: Section[] = ['easy', 'normal', 'hard', 'wild'];
export interface Lineup { picked: string[]; random: Record<Section, number> }
/**
 * One computer seat: the name shown, its level, and its style id ('chaos' for a wild card, 'mirror'
 * for a mirror of a real player, which also carries its learned knobs and preferred Illuminati).
 */
export interface BotSpec { name: string; level: AiLevel; style: string; data?: Record<string, number | boolean | undefined>; illuminati?: string; owner?: string }

export const emptyLineup = (): Lineup => ({ picked: [], random: { easy: 0, normal: 1, hard: 0, wild: 0 } });
/** Ids: "<style>:<level>" for a named player, "wild:<id>" for a wild card, "mirror:<level>" for your mirror. */
export const pickId = (style: PlayStyle, level: AiLevel) => `${style.id}:${level}`;
const isLevel = (x: string): x is AiLevel => x === 'easy' || x === 'normal' || x === 'hard';

export function specOf(id: string): BotSpec | undefined {
  const [a, b] = id.split(':');
  if (a === 'wild') { const w = WILD_CARDS.find((x) => x.id === b); return w && { name: w.name, level: 'normal', style: 'chaos' }; }
  if (a === 'mirror') return isLevel(b) ? { name: mirrorName(b), level: b, style: 'mirror' } : undefined;
  const st = STYLES.find((x) => x.id === a);
  const lv = b as AiLevel;
  return st && (lv === 'easy' || lv === 'normal' || lv === 'hard') ? { name: st.names[lv], level: lv, style: st.id } : undefined;
}

export const lineupSize = (l: Lineup) => l.picked.length + SECTIONS.reduce((n, k) => n + l.random[k], 0);

/**
 * Turn a line-up into seats: the hand-picked players first, then random ones. A random named
 * player never repeats a style already at the table while another is free; wild cards never repeat a name.
 *
 * `pool.mirrors` are the mirrors on offer (one per level for each person at the table who has
 * enough games). A picked "mirror:<level>" takes the first free one of that level, or becomes a
 * random seat of that level if there is none. A random seat of a level draws uniformly from the
 * whole pool of that level: the built-in players not already seated plus the free mirrors.
 * `pool.seated` are computers already at the table (they count as used, and are not returned).
 */
export function resolveLineup(l: Lineup, seed: number, pool: { mirrors?: BotSpec[]; seated?: BotSpec[] } = {}): BotSpec[] {
  let x = (seed >>> 0) || 1;
  const rnd = () => { x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0; x = (x ^ (x >>> 13)) >>> 0; return x / 4294967296; };
  const out: BotSpec[] = [];
  const usedStyles = new Set((pool.seated ?? []).map((b) => b.style));
  const usedNames = new Set((pool.seated ?? []).map((b) => b.name));
  const add = (b: BotSpec) => { out.push(b); usedStyles.add(b.style); usedNames.add(b.name); };
  const mirrors = pool.mirrors ?? [];
  const random = { ...l.random };
  for (const id of l.picked) {
    const b = specOf(id);
    if (b?.style !== 'mirror') { if (b) add(b); continue; }
    const m = mirrors.find((x) => x.level === b.level && !usedNames.has(x.name));
    if (m) add(m); else random[b.level]++;
  }
  for (const sec of SECTIONS) {
    for (let k = 0; k < random[sec]; k++) {
      if (sec === 'wild') {
        const free = WILD_CARDS.filter((w) => !usedNames.has(w.name));
        const w = (free.length ? free : WILD_CARDS)[Math.floor(rnd() * (free.length || WILD_CARDS.length))];
        out.push({ name: free.length ? w.name : `${w.name} ${k + 2}`, level: 'normal', style: 'chaos' }); usedNames.add(w.name);
        continue;
      }
      const free = STYLES.filter((st) => !usedStyles.has(st.id) && !usedNames.has(st.names[sec]));
      const named = free.length ? free : STYLES.filter((st) => !usedNames.has(st.names[sec]));
      const builtIn = named.length ? named : STYLES;
      const mine = mirrors.filter((m) => m.level === sec && !usedNames.has(m.name));
      const i = Math.floor(rnd() * (builtIn.length + mine.length));
      if (i >= builtIn.length) { add(mine[i - builtIn.length]); continue; }
      const st = builtIn[i];
      add({ name: usedNames.has(st.names[sec]) ? `${st.names[sec]} II` : st.names[sec], level: sec, style: st.id });
    }
  }
  return out;
}

/** Give each seat an Illuminati: its own preference or one that suits its style if still free, otherwise any free one. */
export function assignIlluminati(bots: BotSpec[], taken: string[], all: string[]): string[] {
  const used = new Set(taken);
  return bots.map((b) => {
    const fav = STYLES.find((st) => st.id === b.style)?.favours ?? [];
    // A mirror asks for its player's second-favourite Illuminati.
    const ill = [...(b.illuminati ? [b.illuminati] : []), ...fav, ...all].find((id) => !used.has(id)) ?? all[0];
    used.add(ill);
    return ill;
  });
}

/**
 * The line-up as an online game request. Random named seats and mirrors are sent as placeholders
 * ('random' / 'mirror' with a level): the server fills them when the game starts, from the pool that
 * includes the mirrors of everyone at the table. Named players and wild cards are resolved here.
 */
export function lineupRequest(l: Lineup, seed: number): BotSpec[] {
  const picked = l.picked.map(specOf).filter((b): b is BotSpec => !!b);
  const randoms = (['easy', 'normal', 'hard'] as AiLevel[]).flatMap((level) => Array.from({ length: l.random[level] }, () => ({ name: '', level, style: 'random' })));
  const wild = resolveLineup({ picked: [], random: { easy: 0, normal: 0, hard: 0, wild: l.random.wild } }, seed, { seated: picked });
  return [...picked, ...randoms, ...wild];
}
