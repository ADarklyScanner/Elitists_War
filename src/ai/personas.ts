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

export interface Persona { id: string; name: string; style: string; blurb: string; tell: string; s: Partial<Style> }

/** The cast. Blurbs say how each one plays; tells hint how to beat them. */
export const PERSONAS: Persona[] = [
  { id: 'vex', name: 'Vex', style: 'Gambler', blurb: 'Attacks at poor odds and rarely bothers to defend.',
    tell: 'Let the long shots fail, then hit Groups left without defenders.', s: { risk: -0.14, defend: 0.15 } },
  { id: 'mortimer', name: 'Mortimer', style: 'Turtle', blurb: 'Only takes safe attacks and defends everything with everything.',
    tell: 'Attack where his help cannot reach, and race him to the Goal: he grows slowly.', s: { risk: 0.12, defend: -0.1, fullDefense: true } },
  { id: 'ashgrove', name: 'Lady Ashgrove', style: 'Schemer', blurb: 'Hoards Plots and plays them at every chance.',
    tell: 'Expect a Plot on every big attack; bait them out with small ones first.', s: { plotHand: 7, schemer: true } },
  { id: 'grimsby', name: 'Grimsby', style: 'Wrecker', blurb: 'Would rather destroy your Groups than take them.',
    tell: 'Keep Groups with opposite alignments to his away from your edges; destroying needs them.', s: { destroy: 1.8, control: 0.8 } },
  { id: 'octavia', name: 'Octavia', style: 'Collector', blurb: 'Builds from her own hand and draws Groups constantly.',
    tell: 'She rarely attacks you early; use that time, then strike before her structure snowballs.', s: { control: 1.15, destroy: 0.5, fromHand: 4, collector: true } },
  { id: 'silas', name: 'Silas', style: 'Vulture', blurb: 'Picks on whoever is weakest.',
    tell: 'Stay out of last place and he will leave you alone.', s: { leader: 1, weakest: 1.6 } },
  { id: 'regent', name: 'The Regent', style: 'Kingslayer', blurb: 'Goes after the leader, relentlessly.',
    tell: 'Do not pull ahead early; let someone else draw his fire.', s: { leader: 2 } },
  { id: 'cassius', name: 'Cassius', style: 'Opportunist', blurb: 'Takes whatever attack is most likely to work, however small the prize.',
    tell: 'Your weak Groups draw his attacks; protect the easy targets and he stalls.', s: { safeBets: true } },
  { id: 'nyx', name: 'Nyx', style: 'Meddler', blurb: 'Joins other players\' fights to stop whoever is winning.',
    tell: 'When you lead, count on her helping your target defend.', s: { meddler: true, leader: 1.5 } },
  { id: 'juniper', name: 'Juniper', style: 'By the book', blurb: 'Plays a steady, balanced game.',
    tell: 'No special habit to exploit: a good opponent to practise against.', s: {} },
];

export const personaById = (id?: string) => PERSONAS.find((p) => p.id === id);
export const styleOf = (id?: string): Style => ({ ...BASE_STYLE, ...(personaById(id)?.s ?? {}) });

/** Pick `n` different personas for a new game, repeatably from a seed. */
export function pickPersonas(n: number, seed: number): Persona[] {
  const list = [...PERSONAS];
  let x = (seed >>> 0) || 1;
  for (let i = list.length - 1; i > 0; i--) {
    x = Math.imul(x ^ (x >>> 15), 2246822507) >>> 0; x ^= x >>> 13;
    const j = x % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return Array.from({ length: n }, (_, i) => list[i % list.length]);
}
