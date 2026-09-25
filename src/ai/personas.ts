import type { AiLevel } from '../engine/types';

// Named computer players. Each name always plays the same way, on top of its difficulty level,
// so a player who keeps beating "Vex" is beating a real habit (long shots, thin defence), not luck.

export interface Style {
  risk: number;          // added to the lowest odds it will attack at (below 0 = takes long shots)
  defend: number;        // added to the odds at which it bothers to defend (below 0 = defends more)
  fullDefense: boolean;  // throws every spare Group into its own defence
  destroy: number;       // how much it values destroying Groups (1 = usual)
  control: number;       // how much it values taking control of Groups (1 = usual)
  fromHand: number;      // extra value on bringing in Groups from its own hand
  leader: number;        // how much more it wants to hit the leading rival (1.3 = usual)
  weakest: number;       // how much more it wants to hit the weakest rival (1 = no preference)
  safeBets: boolean;     // ranks attacks mostly by their odds, not by the prize
  plotHand: number;      // buys Plots while holding fewer than this
  schemer: boolean;      // plays Plots and abilities whenever they help even a little
  collector: boolean;    // spends spare actions drawing Group cards
  meddler: boolean;      // steps into other players' attacks to stop the leader
}

export const BASE_STYLE: Style = {
  risk: 0, defend: 0, fullDefense: false, destroy: 1, control: 1, fromHand: 0, leader: 1.3, weakest: 1,
  safeBets: false, plotHand: 4, schemer: false, collector: false, meddler: false,
};

/**
 * A well-known way of playing. Each style has its own name at every difficulty, so "Grimsby" is always
 * a Normal Wrecker and "The Demolisher" always a Hard one, and learning a name means learning a habit.
 */
export interface PlayStyle {
  id: string; style: string; blurb: string; tell: string;
  names: Record<AiLevel, string>;
  /** Illuminati that suit the style, best first (the computer takes the first one still free). */
  favours: string[];
  s: Partial<Style>;
}

export const STYLES: PlayStyle[] = [
  { id: 'gambler', style: 'Gambler', blurb: 'Attacks at poor odds and rarely bothers to defend.',
    tell: 'Let the long shots fail, then hit the Groups it left with no one to defend them.',
    names: { easy: 'Lucky Lou', normal: 'Vex', hard: 'The Croupier' }, favours: ['ufos', 'bermuda-triangle'], s: { risk: -0.14, defend: 0.15 } },
  { id: 'turtle', style: 'Turtle', blurb: 'Takes only safe attacks and throws everything into defence.',
    tell: 'Attack where its help cannot reach, and race it to the Goal: it grows slowly.',
    names: { easy: 'Aunt Prudence', normal: 'Mortimer', hard: 'The Warden' }, favours: ['shangri-la', 'gnomes-of-zurich'], s: { risk: 0.12, defend: -0.1, fullDefense: true } },
  { id: 'schemer', style: 'Schemer', blurb: 'Hoards Plots and plays them at every chance.',
    tell: 'Expect a Plot on every big attack; bait them out with small attacks first.',
    names: { easy: 'Penny Dreadful', normal: 'Lady Ashgrove', hard: 'The Cardinal' }, favours: ['discordian-society', 'the-network'], s: { plotHand: 7, schemer: true } },
  { id: 'wrecker', style: 'Wrecker', blurb: 'Would rather destroy your Groups than take them.',
    tell: 'Destroying needs opposite alignments: keep Groups that clash with its own away from open edges.',
    names: { easy: 'Rusty', normal: 'Grimsby', hard: 'The Demolisher' }, favours: ['servants-of-cthulhu', 'adepts-of-hermes'], s: { destroy: 1.8, control: 0.8 } },
  { id: 'collector', style: 'Collector', blurb: 'Builds from its own hand and draws Group cards constantly.',
    tell: 'It rarely attacks early; use that time, then strike before its structure snowballs.',
    names: { easy: 'Pip', normal: 'Octavia', hard: 'The Archivist' }, favours: ['the-network', 'gnomes-of-zurich'], s: { control: 1.15, destroy: 0.5, fromHand: 4, collector: true } },
  { id: 'vulture', style: 'Vulture', blurb: 'Picks on whoever is weakest.',
    tell: 'Stay out of last place and it will leave you alone.',
    names: { easy: 'Scraps', normal: 'Silas', hard: 'The Undertaker' }, favours: ['bavarian-illuminati', 'servants-of-cthulhu'], s: { leader: 1, weakest: 2, fromHand: -3 } },
  { id: 'kingslayer', style: 'Kingslayer', blurb: 'Goes after the leader, relentlessly.',
    tell: 'Do not pull ahead early; let someone else draw its fire.',
    names: { easy: 'Sir Reginald', normal: 'The Regent', hard: 'The Usurper' }, favours: ['bavarian-illuminati', 'discordian-society'], s: { leader: 2.4, fromHand: -3 } },
  { id: 'opportunist', style: 'Opportunist', blurb: 'Takes whatever attack is most likely to work, however small the prize.',
    tell: 'Your weak Groups draw its attacks; protect the easy targets and it stalls.',
    names: { easy: 'Dodger', normal: 'Cassius', hard: 'The Broker' }, favours: ['gnomes-of-zurich', 'ufos'], s: { safeBets: true } },
  { id: 'meddler', style: 'Meddler', blurb: 'Joins other players\' fights to stop whoever is winning.',
    tell: 'When you lead, count on it helping your target defend.',
    names: { easy: 'Busybody Bea', normal: 'Nyx', hard: 'The Whisperer' }, favours: ['adepts-of-hermes', 'shangri-la'], s: { meddler: true, leader: 1.6 } },
  { id: 'book', style: 'By the book', blurb: 'Plays a steady, balanced game.',
    tell: 'No special habit to exploit: a good opponent to practise against.',
    names: { easy: 'Rookie', normal: 'Juniper', hard: 'The Professor' }, favours: [], s: {} },
];

/**
 * Wild cards: no style, no plan, any legal move at random. Each name is a different wild card, but they
 * all play the same way; they have no difficulty.
 */
export const WILD_CARDS = [
  { id: 'wild-pudding', name: 'Pudding' }, { id: 'wild-wobbles', name: 'Mister Wobbles' },
  { id: 'wild-lenore', name: 'Loopy Lenore' }, { id: 'wild-bingo', name: 'Bingo' },
];
export const WILD_STYLE: PlayStyle = {
  id: 'chaos', style: 'Wild card', blurb: 'No plan at all: any legal move, picked at random.',
  tell: 'Nothing to read here. Protect your big Groups from freak attacks and keep building.',
  names: { easy: 'Pudding', normal: 'Pudding', hard: 'Pudding' }, favours: [], s: {},
};

export const styleById = (id?: string) => (id === 'chaos' ? WILD_STYLE : STYLES.find((p) => p.id === id));
export const styleOf = (id?: string): Style => ({ ...BASE_STYLE, ...(styleById(id)?.s ?? {}) });
/** The style and level behind a computer's name, e.g. "Grimsby" → Wrecker, Normal. */
export const whoIs = (name: string) => {
  for (const st of STYLES) for (const lv of ['easy', 'normal', 'hard'] as AiLevel[]) if (st.names[lv] === name) return { style: st, level: lv };
  return undefined;
};

export interface Seating { style: PlayStyle; level: AiLevel; name: string; illuminati?: string }

/**
 * Give each computer a different style (repeatably from a seed), its name for that level, and an
 * Illuminati that suits the style when one is still free.
 */
export function seatComputers(levels: AiLevel[], seed: number, taken: string[] = [], allIlluminati: string[] = []): Seating[] {
  const list = [...STYLES];
  let x = (seed >>> 0) || 1;
  for (let i = list.length - 1; i > 0; i--) {
    x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0; x = (x ^ (x >>> 13)) >>> 0;
    const j = x % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  const used = new Set(taken);
  return levels.map((level, i) => {
    const style = list[i % list.length];
    const pick = [...style.favours, ...allIlluminati].find((id) => !used.has(id));
    if (pick) used.add(pick);
    return { style, level, name: style.names[level], illuminati: pick };
  });
}
