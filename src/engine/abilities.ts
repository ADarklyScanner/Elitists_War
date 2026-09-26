// Reusable building blocks for Group and Illuminati special abilities.
// Each card's ability is described as data (a list of Ability entries) so the
// engine can apply it generically. Cards whose ability needs bespoke logic use
// `custom` hooks, and anything not yet encoded is marked `pending`.
import type { Alignment, AttackCtx, GameState } from './types';
import { def } from './cards';
import { abilitiesDisabled } from './hooks';

/** Describes which Groups something applies to. All listed conditions must hold. */
export interface Match {
  alignments?: Alignment[];      // has ANY of these
  allAlignments?: Alignment[];   // has ALL of these
  attributes?: string[];         // has ANY of these attributes
  subtypes?: string[];           // Organization | Personality | Place
  names?: string[];              // specific card ids
  notSelf?: boolean;
}

export type AttackKind = 'control' | 'destroy' | 'both';

export type Ability =
  /** +value when attacking a matching target. scope 'direct' = only when this group leads;
   *  'any' = any attack led by one of your groups (the "any attempt" wording). */
  | { kind: 'attackBonus'; on: AttackKind; target?: Match; value: number; scope: 'direct' | 'any'; instant?: boolean; replacesAlignmentPenalty?: boolean }
  /** +value when this group aids an attack on a matching target. */
  | { kind: 'aidBonus'; on: AttackKind; target?: Match; value: number }
  /** +value defense for every group in the owner's Power Structure (vs attacks made or aided by `vs`). */
  | { kind: 'structureDefense'; value: number; vs?: Match; instant?: boolean; on?: AttackKind }
  /** +value defense for this group only. */
  | { kind: 'selfDefense'; value: number; vs?: Match; on?: AttackKind; instant?: boolean }
  /** Power Structure cannot be attacked (or targeted by abilities) by matching groups. */
  | { kind: 'structureImmune'; from: Match }
  /** This group cannot be attacked by matching groups. */
  | { kind: 'selfImmune'; from: Match }
  | { kind: 'cannotBeDestroyed' }
  /** +value Power per other group you control matching `per` (global: also raises Global Power). */
  | { kind: 'powerPer'; per: Match; value: number; global?: boolean }
  | { kind: 'extraPlotDraw'; value: number }
  | { kind: 'handLimit'; value: number }
  /** Counts double for the Basic Goal (Illuminati special abilities). */
  | { kind: 'doubleCount'; match: Match; minPower?: number }
  | { kind: 'extraIlluminatiToken'; value: number }
  | { kind: 'freePrivilegedAttack' }
  /** Draw a Plot whenever you destroy a (matching) Group. */
  | { kind: 'drawPlotOnDestroy'; match?: Match }
  | { kind: 'canOnlyDestroy'; match: Match }
  /**
   * 'slack' (Church of the SubGenius): up to `value` tokens on the Illuminati count as Groups toward the
   * Basic Goal; it cannot be combined with any other Goal.
   */
  | { kind: 'specialGoal'; goal: 'totalPower' | 'bermuda' | 'destroyCount' | 'peacefulPower' | 'slack'; value: number }
  /** Slack (Church of the SubGenius): the Illuminati keeps its Action tokens from turn to turn and gets its new ones on top. */
  | { kind: 'slack' }
  | { kind: 'noTokens' }
  /** A failed Attack to Control on a Group from your hand returns it to hand instead of discarding it. */
  | { kind: 'failedHandReturns' }
  | { kind: 'pending'; note: string };

export const GROUP_ABILITIES: Record<string, Ability[]> = {};

export function registerAbilities(table: Record<string, Ability[]>) {
  Object.assign(GROUP_ABILITIES, table);
}

export function abilitiesOf(s: GameState, iid: string): Ability[] {
  const list = GROUP_ABILITIES[s.cards[iid].cardId] ?? [];
  if (list.length && s.cards[iid].zone === 'structure' && abilitiesDisabled(s, iid)) return [];
  return list;
}

export function isImplemented(cardId: string): boolean {
  const a = GROUP_ABILITIES[cardId];
  return !!a && !a.some((x) => x.kind === 'pending');
}

// ---------- matching helpers (injected by stats.ts to avoid a cycle) ----------
type AlignFn = (s: GameState, iid: string) => Alignment[];
let alignFn: AlignFn = () => [];
let attrFn: (s: GameState, iid: string) => string[] = (s, iid) => def(s, iid).attributes ?? [];
export function setAlignmentResolver(fn: AlignFn, attrs?: (s: GameState, iid: string) => string[]) { alignFn = fn; if (attrs) attrFn = attrs; }

export function matches(s: GameState, iid: string, m: Match | undefined, self?: string): boolean {
  if (!m) return true;
  const d = def(s, iid);
  if (m.notSelf && iid === self) return false;
  if (m.names && !m.names.includes(d.id)) return false;
  if (m.subtypes && !m.subtypes.includes(d.subtype)) return false;
  if (m.attributes && !m.attributes.some((a) => attrFn(s, iid).includes(a))) return false;
  const al = alignFn(s, iid);
  if (m.alignments && !m.alignments.some((a) => al.includes(a))) return false;
  if (m.allAlignments && !m.allAlignments.every((a) => al.includes(a))) return false;
  return true;
}

/** Groups (by iid) that contributed to an attack's attacking side. */
export function attackingGroups(ctx: AttackCtx): string[] {
  return [ctx.attacker, ...ctx.aid.map((a) => a.iid)].filter((x): x is string => !!x);
}
