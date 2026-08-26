/**
 * Squad formation definitions — positioning + combat modifiers.
 */

export type SquadFormation =
  | 'line'
  | 'shieldWall'
  | 'loose'
  | 'charge'
  | 'holdGround';

export const ALL_FORMATIONS: SquadFormation[] = [
  'line',
  'shieldWall',
  'loose',
  'charge',
  'holdGround',
];

export interface FormationEffects {
  id: SquadFormation;
  label: string;
  spacingMul: number;
  speedMul: number;
  meleeTakenMul: number;
  rangedTakenMul: number;
  firstContactMul: number;
  /** Extra morale change/sec in combat (0–100 scale). */
  moraleDrain: number;
  /** Passive morale recovery bonus /sec. */
  moraleBonus: number;
  frontalDefense: boolean;
  holdGround: boolean;
}

export const FORMATION_DEFS: Record<SquadFormation, FormationEffects> = {
  line: {
    id: 'line',
    label: 'Line',
    spacingMul: 1,
    speedMul: 1,
    meleeTakenMul: 1,
    rangedTakenMul: 1,
    firstContactMul: 1,
    moraleDrain: 0,
    moraleBonus: 0,
    frontalDefense: false,
    holdGround: false,
  },
  shieldWall: {
    id: 'shieldWall',
    label: 'Shield Wall',
    spacingMul: 0.9,
    speedMul: 0.72,
    meleeTakenMul: 0.78,
    rangedTakenMul: 0.92,
    firstContactMul: 1,
    moraleDrain: 0,
    moraleBonus: 1.2,
    frontalDefense: true,
    holdGround: false,
  },
  loose: {
    id: 'loose',
    label: 'Loose',
    spacingMul: 1.65,
    speedMul: 1.05,
    meleeTakenMul: 1.05,
    rangedTakenMul: 0.62,
    firstContactMul: 1,
    moraleDrain: 0,
    moraleBonus: 0,
    frontalDefense: false,
    holdGround: false,
  },
  charge: {
    id: 'charge',
    label: 'Charge',
    spacingMul: 0.9,
    speedMul: 1.35,
    meleeTakenMul: 1.08,
    rangedTakenMul: 1.1,
    firstContactMul: 1.45,
    moraleDrain: 4.5,
    moraleBonus: 0,
    frontalDefense: false,
    holdGround: false,
  },
  holdGround: {
    id: 'holdGround',
    label: 'Hold Ground',
    spacingMul: 0.95,
    speedMul: 0.85,
    meleeTakenMul: 0.82,
    rangedTakenMul: 0.88,
    firstContactMul: 1,
    moraleDrain: -1.5,
    moraleBonus: 3.5,
    frontalDefense: false,
    holdGround: true,
  },
};

export function formationLabel(f: SquadFormation): string {
  return FORMATION_DEFS[f].label;
}
