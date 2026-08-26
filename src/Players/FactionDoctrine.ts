import type { FactionId } from './Types';
import type { SettlementLayoutId } from '../Settlement/LayoutVariants';
import type { SquadFormation } from '../Combat/FormationDefs';

/**
 * Behavioral doctrine per playable faction.
 * Asymmetry comes from system priorities — not flat unit stat buffs.
 */
export interface FactionDoctrine {
  id: FactionId;
  /** Ordered settlement layouts preferred when founding / binding. */
  preferredLayouts: SettlementLayoutId[];
  /** How often autonomous road projects fire (0..1+). */
  roadBuildBias: number;
  /** Extra weight on storage / crafting needs. */
  storagePriority: number;
  /** Amplifies defense needs → walls / forts / guards. */
  defenseNeedBias: number;
  /** Profession allocation multipliers. */
  craftsmanBias: number;
  builderBias: number;
  soldierBias: number;
  farmerBias: number;
  /** Settler / expansion gates. */
  settlerMinPop: number;
  settlerGoldCost: number;
  settlerWoodCost: number;
  settlerCitizens: number;
  settlerWorkers: number;
  /** Auto-pressure to expand when crowded / prosperous. */
  expansionPressure: number;
  /** Morale / tradition hooks. */
  victoryMoraleMul: number;
  territoryMoraleMul: number;
  heroMoraleMul: number;
  militaryTraditionGain: number;
  /** Preferred default formation for new squads. */
  defaultFormation: SquadFormation;
  /** Soft preference when AI picks formations. */
  preferredCombatFormation: SquadFormation;
  /** AI tempo (lower = acts more often). */
  aiActionIntervalMul: number;
  aiBoomSeconds: number;
  aiMilitaryForPressure: number;
  aiMilitaryForAllin: number;
  aiHarassBias: number;
  aiGuardCountBonus: number;
  /** Military train gold multiplier (mobilization speed via cost, not HP). */
  militaryTrainGoldMul: number;
  /** Influence radiates farther from military tradition (orcs). */
  influenceMilitaryWeight: number;
  /** Craftsmanship / infrastructure prosperity contribution. */
  craftProsperityBias: number;
  raidVictoryBonus: number;
}

export const FACTION_DOCTRINES: Record<FactionId, FactionDoctrine> = {
  humans: {
    id: 'humans',
    preferredLayouts: ['roadSpine', 'radial', 'crescent'],
    roadBuildBias: 1.45,
    storagePriority: 1.35,
    defenseNeedBias: 1.4,
    craftsmanBias: 1.45,
    builderBias: 1.35,
    soldierBias: 0.85,
    farmerBias: 1.1,
    settlerMinPop: 14,
    settlerGoldCost: 110,
    settlerWoodCost: 50,
    settlerCitizens: 5,
    settlerWorkers: 3,
    expansionPressure: 0.55,
    victoryMoraleMul: 0.85,
    territoryMoraleMul: 1.45,
    heroMoraleMul: 1.4,
    militaryTraditionGain: 0.7,
    defaultFormation: 'line',
    preferredCombatFormation: 'shieldWall',
    aiActionIntervalMul: 1.15,
    aiBoomSeconds: 85,
    aiMilitaryForPressure: 5,
    aiMilitaryForAllin: 12,
    aiHarassBias: 0.35,
    aiGuardCountBonus: 1,
    militaryTrainGoldMul: 1,
    influenceMilitaryWeight: 0.85,
    craftProsperityBias: 1.35,
    raidVictoryBonus: 0.7,
  },
  orcs: {
    id: 'orcs',
    preferredLayouts: ['scatter', 'clustered', 'crescent'],
    roadBuildBias: 0.55,
    storagePriority: 0.75,
    defenseNeedBias: 0.75,
    craftsmanBias: 0.7,
    builderBias: 0.9,
    soldierBias: 1.55,
    farmerBias: 0.95,
    settlerMinPop: 10,
    settlerGoldCost: 80,
    settlerWoodCost: 30,
    settlerCitizens: 4,
    settlerWorkers: 2,
    expansionPressure: 1.45,
    victoryMoraleMul: 1.4,
    territoryMoraleMul: 0.75,
    heroMoraleMul: 0.95,
    militaryTraditionGain: 1.45,
    defaultFormation: 'loose',
    preferredCombatFormation: 'charge',
    aiActionIntervalMul: 0.78,
    aiBoomSeconds: 55,
    aiMilitaryForPressure: 3,
    aiMilitaryForAllin: 8,
    aiHarassBias: 0.72,
    aiGuardCountBonus: 0,
    militaryTrainGoldMul: 0.85,
    influenceMilitaryWeight: 1.35,
    craftProsperityBias: 0.7,
    raidVictoryBonus: 1.5,
  },
};

export function doctrineOf(factionId: FactionId): FactionDoctrine {
  return FACTION_DOCTRINES[factionId];
}
