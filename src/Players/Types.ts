/** Faction = racial/visual identity (not the player). */
export type FactionId = 'humans' | 'orcs';

export type ControllerType = 'LOCAL' | 'AI' | 'REMOTE';

export interface Player {
  id: string;
  factionId: FactionId;
  controllerType: ControllerType;
  /** UI/selection color — independent from faction palette. */
  playerColor: string;
  displayName: string;
}

export interface FactionDefinition {
  id: FactionId;
  displayName: string;
  /** Faction visual accent (buildings/units), not player color. */
  accent: string;
  workerType: 'Worker' | 'Peon';
  meleeType: 'Swordsman' | 'Grunt';
  rangedType: 'Archer' | 'SpearOrc';
  mainBuilding: 'TownHall' | 'OrcStronghold';
  productionBuilding: 'Barracks' | 'OrcBarracks';
  economyBuilding: 'Farm' | 'PigFarm';
}

export const FACTIONS: Record<FactionId, FactionDefinition> = {
  humans: {
    id: 'humans',
    displayName: 'Humans',
    accent: '#1E4F9A',
    workerType: 'Worker',
    meleeType: 'Swordsman',
    rangedType: 'Archer',
    mainBuilding: 'TownHall',
    productionBuilding: 'Barracks',
    economyBuilding: 'Farm',
  },
  orcs: {
    id: 'orcs',
    displayName: 'Orcs',
    accent: '#A33425',
    workerType: 'Peon',
    meleeType: 'Grunt',
    rangedType: 'SpearOrc',
    mainBuilding: 'OrcStronghold',
    productionBuilding: 'OrcBarracks',
    economyBuilding: 'PigFarm',
  },
};

/** Default player palette (not faction colors). */
export const PLAYER_COLORS = ['#4FC3F7', '#FFB74D', '#81C784', '#CE93D8', '#F48FB1'] as const;
