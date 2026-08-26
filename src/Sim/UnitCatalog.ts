/**
 * Trainable unit definitions — single source for cost / combat stats.
 * No rebalance: values match prior hardcoded UI/AI/Game paths.
 */
export type TrainableUnitType =
  | 'Worker'
  | 'Peon'
  | 'Swordsman'
  | 'Archer'
  | 'Grunt'
  | 'SpearOrc';

export interface UnitDefinition {
  id: TrainableUnitType;
  /** Base gold cost before doctrine multipliers. */
  goldCost: number;
  populationCost: number;
  hp: number;
  speed: number;
  damage: number;
  range: number;
  role: 'worker' | 'melee' | 'ranged';
}

const UNITS: Record<TrainableUnitType, UnitDefinition> = {
  Worker: {
    id: 'Worker',
    goldCost: 50,
    populationCost: 1,
    hp: 40,
    speed: 70,
    damage: 3,
    range: 25,
    role: 'worker',
  },
  Peon: {
    id: 'Peon',
    goldCost: 50,
    populationCost: 1,
    hp: 40,
    speed: 70,
    damage: 3,
    range: 25,
    role: 'worker',
  },
  Swordsman: {
    id: 'Swordsman',
    goldCost: 80,
    populationCost: 1,
    hp: 100,
    speed: 60,
    damage: 15,
    range: 25,
    role: 'melee',
  },
  Archer: {
    id: 'Archer',
    goldCost: 100,
    populationCost: 1,
    hp: 60,
    speed: 60,
    damage: 10,
    range: 150,
    role: 'ranged',
  },
  Grunt: {
    id: 'Grunt',
    goldCost: 80,
    populationCost: 1,
    hp: 130,
    speed: 52,
    damage: 18,
    range: 28,
    role: 'melee',
  },
  SpearOrc: {
    id: 'SpearOrc',
    goldCost: 100,
    populationCost: 1,
    hp: 80,
    speed: 56,
    damage: 11,
    range: 120,
    role: 'ranged',
  },
};

export function getUnitDef(type: string): UnitDefinition | undefined {
  return UNITS[type as TrainableUnitType];
}

export function unitSpawnOptions(type: string): {
  hp: number;
  speed: number;
  unitType: string;
  damage: number;
  range: number;
} {
  const def = getUnitDef(type);
  if (!def) {
    return { hp: 40, speed: 70, unitType: type, damage: 3, range: 25 };
  }
  return {
    hp: def.hp,
    speed: def.speed,
    unitType: def.id,
    damage: def.damage,
    range: def.range,
  };
}

export function allUnitDefs(): readonly UnitDefinition[] {
  return Object.values(UNITS);
}
