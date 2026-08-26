export type UnitVisualState = 'idle' | 'walk' | 'attack' | 'hit' | 'death';

export interface UnitVisualStateInput {
  isDead: boolean;
  wasHit: boolean;
  isAttacking: boolean;
  isMoving: boolean;
}

/** Gameplay facts select a visual state; the animation never changes those facts. */
export function resolveUnitVisualState(input: UnitVisualStateInput): UnitVisualState {
  if (input.isDead) return 'death';
  if (input.wasHit) return 'hit';
  if (input.isAttacking) return 'attack';
  if (input.isMoving) return 'walk';
  return 'idle';
}
