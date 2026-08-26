/**
 * Living Settlement Core — public simulation model.
 * Soft civic stats are derived; needs drive autonomous basic construction.
 */

export type SettlementNeedKind = 'housing' | 'food' | 'storage' | 'defense';

/** Priority weights (higher = more urgent). Settlement picks the top unmet need. */
export interface SettlementNeeds {
  housing: number;
  food: number;
  storage: number;
  defense: number;
}

export interface SettlementResources {
  food: number;
  wood: number;
  stone: number;
  iron: number;
  gold: number;
}

/** Capacity soft-caps raised by Storage buildings. */
export interface SettlementCapacity {
  food: number;
  wood: number;
  stone: number;
  iron: number;
}
