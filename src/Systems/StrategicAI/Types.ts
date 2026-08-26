/**
 * Strategic AI posture — any faction seat.
 * Chosen from world analysis, not fixed spawn timers.
 */
export type StrategicState =
  | 'develop'
  | 'expand'
  | 'defend'
  | 'fortify'
  | 'raid'
  | 'attack'
  | 'recover';

export const STRATEGIC_STATES: StrategicState[] = [
  'develop',
  'expand',
  'defend',
  'fortify',
  'raid',
  'attack',
  'recover',
];

export function strategicStateLabel(state: StrategicState): string {
  switch (state) {
    case 'develop':
      return 'Develop';
    case 'expand':
      return 'Expand';
    case 'defend':
      return 'Defend';
    case 'fortify':
      return 'Fortify';
    case 'raid':
      return 'Raid';
    case 'attack':
      return 'Attack';
    case 'recover':
      return 'Recover';
  }
}

/** Snapshot of the board as the AI seat perceives it. */
export interface StrategicSituation {
  /** Civic citizens (settlement pop), not map unit count. */
  civicPopulation: number;
  housing: number;
  housingPressure: number;
  /** Map units / building-derived cap (same soft cap players feel). */
  unitPop: number;
  unitMaxPop: number;
  gold: number;
  food: number;
  wood: number;
  stone: number;
  iron: number;
  prosperity: number;
  safety: number;
  craftsmanship: number;
  topNeed: string | null;
  settlementCount: number;
  hasTownCenter: boolean;
  hasProduction: boolean;
  mainHpRatio: number;
  workerCount: number;
  armyStrength: number;
  armyCount: number;
  enemyArmyStrength: number;
  enemyArmyCount: number;
  /** armyStrength / max(enemy, 1) */
  armyRatio: number;
  threatNearBase: number;
  territoryOwnShare: number;
  territoryContestedShare: number;
  nearbyMineCount: number;
  resourcePressure: number;
  primaryBridgeContested: boolean;
  bridgeFriendlyPresence: number;
  bridgeEnemyPresence: number;
  /** Best defensive hold score near home approach. */
  defensibleScore: number;
  canExpand: boolean;
  expansionCrowding: number;
  unfinishedBuilds: number;
  doctrineExpansion: number;
  doctrineHarass: number;
  doctrineDefense: number;
  doctrineCraft: number;
}
