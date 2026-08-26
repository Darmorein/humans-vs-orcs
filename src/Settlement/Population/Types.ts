import type { FactionId } from '../../Players/Types';

/** Shared profession roles — labels differ per faction. */
export type ProfessionRole =
  | 'peasant'
  | 'farmer'
  | 'lumberjack'
  | 'miner'
  | 'builder'
  | 'craftsman'
  | 'soldier';

export type CitizenTrait = 'hardy' | 'industrious' | 'frail' | 'brave' | 'lazy' | 'curious';

export interface Citizen {
  id: string;
  age: number;
  profession: ProfessionRole;
  settlementId: string;
  health: number;
  experience: number;
  traits: CitizenTrait[];
  /** Soft renown toward hero emergence. */
  prestige?: number;
  /** Bound emergent hero id, if any. */
  heroId?: string | null;
}

export const HUMAN_PROFESSION_LABELS: Record<ProfessionRole, string> = {
  peasant: 'Peasant',
  farmer: 'Farmer',
  lumberjack: 'Lumberjack',
  miner: 'Miner',
  builder: 'Builder',
  craftsman: 'Craftsman',
  soldier: 'Soldier',
};

/** Orc analogues of the same roles. */
export const ORC_PROFESSION_LABELS: Record<ProfessionRole, string> = {
  peasant: 'Peon',
  farmer: 'Herder',
  lumberjack: 'Woodcutter',
  miner: 'Digga',
  builder: 'Builder',
  craftsman: 'Artisan',
  soldier: 'Warrior',
};

export function professionLabel(factionId: FactionId, role: ProfessionRole): string {
  return factionId === 'orcs' ? ORC_PROFESSION_LABELS[role] : HUMAN_PROFESSION_LABELS[role];
}

export const ALL_PROFESSIONS: ProfessionRole[] = [
  'peasant',
  'farmer',
  'lumberjack',
  'miner',
  'builder',
  'craftsman',
  'soldier',
];

export const ALL_TRAITS: CitizenTrait[] = [
  'hardy',
  'industrious',
  'frail',
  'brave',
  'lazy',
  'curious',
];
