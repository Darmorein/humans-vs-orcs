import type { IsoDirection } from '../Manifest/Types';
import { facingToIsoDirection } from './isoDirection';

/**
 * Core unit visual animation states from Manifest production standards.
 * Gameplay remains authoritative — this adapter only chooses a clip name.
 */
export type UnitVisualAnimState = 'idle' | 'walk' | 'attack' | 'hit' | 'death';

/** Presentation-only inputs derived from unit runtime (not written to save/replay). */
export interface UnitVisualInput {
  isDead: boolean;
  /** Remaining presentation flash after taking damage (seconds). */
  hitVisualRemaining: number;
  /** Remaining presentation flash after dealing an attack (seconds). */
  attackVisualRemaining: number;
  /** True while the unit is pathing / chasing a world point. */
  isMoving: boolean;
  facingX: number;
  facingY: number;
}

export interface UnitVisualPose {
  state: UnitVisualAnimState;
  direction: IsoDirection;
}

/**
 * Priority: death → attack → hit → walk → idle.
 * Does not decide damage, movement, death, or cooldowns — only clip selection.
 */
export function resolveUnitVisualPose(input: UnitVisualInput): UnitVisualPose {
  const direction = facingToIsoDirection(input.facingX, input.facingY);
  let state: UnitVisualAnimState = 'idle';
  if (input.isDead) {
    state = 'death';
  } else if (input.attackVisualRemaining > 0) {
    state = 'attack';
  } else if (input.hitVisualRemaining > 0) {
    state = 'hit';
  } else if (input.isMoving) {
    state = 'walk';
  }
  return { state, direction };
}
