// The computer line-up for a new game: named players picked by hand, plus a number of random
// ones from each difficulty (and wild cards), resolved into seats when the game starts.
import type { AiLevel } from '../engine/types';
import { STYLES, WILD_CARDS, type PlayStyle } from '../ai/personas';

export type Section = AiLevel | 'wild';
export const SECTIONS: Section[] = ['easy', 'normal', 'hard', 'wild'];
export interface Lineup { picked: string[]; random: Record<Section, number> }
/** One computer seat: the name shown, its level, and its style id ('chaos' for a wild card). */
export interface BotSpec { name: string; level: AiLevel; style: string }

export const emptyLineup = (): Lineup => ({ picked: [], random: { easy: 0, normal: 1, hard: 0, wild: 0 } });
/** Ids: "<style>:<level>" for a named player, "wild:<id>" for a wild card. */
export const pickId = (style: PlayStyle, level: AiLevel) => `${style.id}:${level}`;

export function specOf(id: string): BotSpec | undefined {
  const [a, b] = id.split(':');
  if (a === 'wild') { const w = WILD_CARDS.find((x) => x.id === b); return w && { name: w.name, level: 'normal', style: 'chaos' }; }
  const st = STYLES.find((x) => x.id === a);
  const lv = b as AiLevel;
  return st && (lv === 'easy' || lv === 'normal' || lv === 'hard') ? { name: st.names[lv], level: lv, style: st.id } : undefined;
}

export const lineupSize = (l: Lineup) => l.picked.length + SECTIONS.reduce((n, k) => n + l.random[k], 0);

/**
 * Turn a line-up into seats: the hand-picked players first, then random ones. A random named
 * player never repeats a style already at the table while another is free; wild cards never repeat a name.
 */
export function resolveLineup(l: Lineup, seed: number): BotSpec[] {
  let x = (seed >>> 0) || 1;
  const rnd = () => { x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0; x = (x ^ (x >>> 13)) >>> 0; return x / 4294967296; };
  const out = l.picked.map(specOf).filter((b): b is BotSpec => !!b);
  const usedStyles = new Set(out.map((b) => b.style));
  const usedNames = new Set(out.map((b) => b.name));
  for (const sec of SECTIONS) {
    for (let k = 0; k < l.random[sec]; k++) {
      if (sec === 'wild') {
        const free = WILD_CARDS.filter((w) => !usedNames.has(w.name));
        const w = (free.length ? free : WILD_CARDS)[Math.floor(rnd() * (free.length || WILD_CARDS.length))];
        out.push({ name: free.length ? w.name : `${w.name} ${k + 2}`, level: 'normal', style: 'chaos' }); usedNames.add(w.name);
        continue;
      }
      const free = STYLES.filter((st) => !usedStyles.has(st.id) && !usedNames.has(st.names[sec]));
      const pool = free.length ? free : STYLES.filter((st) => !usedNames.has(st.names[sec]));
      const st = (pool.length ? pool : STYLES)[Math.floor(rnd() * (pool.length || STYLES.length))];
      out.push({ name: usedNames.has(st.names[sec]) ? `${st.names[sec]} II` : st.names[sec], level: sec, style: st.id });
      usedStyles.add(st.id); usedNames.add(st.names[sec]);
    }
  }
  return out;
}

/** Give each seat an Illuminati: one that suits its style if still free, otherwise any free one. */
export function assignIlluminati(bots: BotSpec[], taken: string[], all: string[]): string[] {
  const used = new Set(taken);
  return bots.map((b) => {
    const fav = STYLES.find((st) => st.id === b.style)?.favours ?? [];
    const ill = [...fav, ...all].find((id) => !used.has(id)) ?? all[0];
    used.add(ill);
    return ill;
  });
}
