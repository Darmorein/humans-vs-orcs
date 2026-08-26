/**
 * Squad morale 0–100 and ROUT thresholds.
 * Battles can end in flight — not only annihilation.
 */

export const MORALE_MIN = 0;
export const MORALE_MAX = 100;
export const MORALE_DEFAULT = 72;

/** Drop at or below this → ROUT. */
export const ROUT_THRESHOLD = 24;
/** Must climb above this to rally from ROUT. */
export const RALLY_THRESHOLD = 40;

export const MORALE_EVENT = {
  memberDeath: 10,
  leaderDeath: 28,
  heroDeath: 18,
  victory: 12,
  allyRoutNearby: 8,
} as const;

export function clampMorale(v: number): number {
  return Math.max(MORALE_MIN, Math.min(MORALE_MAX, v));
}
