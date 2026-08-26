/**
 * Settler Group / founding mission — workers march, then a Camp is founded.
 */

export type SettlerGroupStatus = 'ready' | 'traveling' | 'complete' | 'failed';

export interface SettlerGroup {
  id: string;
  ownerPlayerId: string;
  parentSettlementId: string;
  /** Citizens reserved for the new Camp. */
  citizenIds: string[];
  /** Map worker entity ids escorting the group. */
  unitIds: number[];
  targetX: number | null;
  targetY: number | null;
  status: SettlerGroupStatus;
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
export const SETTLER_GOLD_COST = 100;
export const SETTLER_WOOD_COST = 40;
/** Parent must be at least this large (civic pop). */
export const SETTLER_MIN_PARENT_POP = 12;
export const FOUNDING_ARRIVAL_DIST = 48;
