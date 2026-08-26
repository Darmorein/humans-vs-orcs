/**
 * Settler Group / founding mission — caravan travels without player-controlled workers.
 */

export type SettlerGroupStatus = 'ready' | 'traveling' | 'complete' | 'failed';

export interface SettlerGroup {
  id: string;
  ownerPlayerId: string;
  parentSettlementId: string;
  /** Citizens reserved for the new Camp. */
  citizenIds: string[];
  /**
   * Optional escort / traveler unit ids (non-commandable visual or legacy).
   * New missions may leave this empty and use caravanX/Y only.
   */
  unitIds: number[];
  targetX: number | null;
  targetY: number | null;
  status: SettlerGroupStatus;
  /** Authoritative caravan position while traveling. */
  caravanX: number;
  caravanY: number;
  /** World units per second. */
  caravanSpeed: number;
}

let nextGroupId = 1;

export function getNextSettlerGroupId(): number {
  return nextGroupId;
}
export function setNextSettlerGroupId(n: number) {
  nextGroupId = Math.max(1, Math.floor(n));
}

export function createSettlerGroupId(): string {
  return `sg-${nextGroupId++}`;
}

export const SETTLER_CITIZENS = 5;
export const SETTLER_WORKERS = 3;
/** Legacy catalog defaults — live costs come from FactionDoctrine (raised for City2 delay). */
export const SETTLER_GOLD_COST = 165;
export const SETTLER_WOOD_COST = 40;
/** Parent must be at least this large (civic pop) — doctrine overrides per faction. */
export const SETTLER_MIN_PARENT_POP = 20;
export const FOUNDING_ARRIVAL_DIST = 48;
/** Slightly faster caravan once founding is allowed. */
export const SETTLER_CARAVAN_SPEED = 55;
