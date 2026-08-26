/**
 * Player-set development focus — soft bias for autonomous settlement decisions.
 * Not a hard mode; settlements still pick concrete projects themselves.
 */
export type SettlementFocus =
  | 'balanced'
  | 'growth'
  | 'economy'
  | 'military'
  | 'crafting'
  | 'defense';

export const SETTLEMENT_FOCUSES: SettlementFocus[] = [
  'balanced',
  'growth',
  'economy',
  'military',
  'crafting',
  'defense',
];

export function settlementFocusLabel(f: SettlementFocus): string {
  switch (f) {
    case 'balanced':
      return 'Balanced';
    case 'growth':
      return 'Growth';
    case 'economy':
      return 'Economy';
    case 'military':
      return 'Military';
    case 'crafting':
      return 'Crafting';
    case 'defense':
      return 'Defense';
  }
}

/** Emergent specialization from world conditions (not a menu pick). */
export type SettlementSpecialization =
  | 'none'
  | 'farming'
  | 'mining'
  | 'crafting'
  | 'fortress'
  | 'trade'
  | 'religious';

export function specializationLabel(s: SettlementSpecialization): string {
  switch (s) {
    case 'none':
      return 'Mixed';
    case 'farming':
      return 'Farming Village';
    case 'mining':
      return 'Mining Town';
    case 'crafting':
      return 'Crafting Town';
    case 'fortress':
      return 'Fortress Town';
    case 'trade':
      return 'Trade Town';
    case 'religious':
      return 'Religious Center';
  }
}

/** Soft multipliers applied to SettlementNeeds after base recompute. */
export function focusNeedBias(focus: SettlementFocus): {
  housing: number;
  food: number;
  storage: number;
  defense: number;
} {
  switch (focus) {
    case 'growth':
      return { housing: 1.45, food: 1.4, storage: 0.9, defense: 0.85 };
    case 'economy':
      return { housing: 0.95, food: 1.05, storage: 1.5, defense: 0.8 };
    case 'military':
      return { housing: 0.9, food: 1.0, storage: 0.95, defense: 1.15 };
    case 'crafting':
      return { housing: 0.95, food: 0.95, storage: 1.15, defense: 0.85 };
    case 'defense':
      return { housing: 1.0, food: 1.05, storage: 0.9, defense: 1.55 };
    case 'balanced':
    default:
      return { housing: 1, food: 1, storage: 1, defense: 1 };
  }
}
