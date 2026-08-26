import type { BuildingType } from '../Entities/Building';
import type { FactionId } from '../Players/Types';
import { isBuildingAllowed, type SettlementTier } from './SettlementTier';

/** Who may enqueue the project. */
export type ConstructionCategory = 'autonomous' | 'strategic';

/** Buildings + special Road project (tile work, not a Building entity). */
export type ConstructionTarget = BuildingType | 'Road';

export interface ConstructionCosts {
  gold: number;
  wood: number;
  stone: number;
  iron: number;
}

export interface ConstructionRecipe {
  target: ConstructionTarget;
  category: ConstructionCategory;
  label: string;
  costs: ConstructionCosts;
  /** Minimum idle builders required to start. */
  buildersRequired: number;
  /** Population must be at least this (0 = no gate). */
  minPopulation: number;
  /** World-space placement clearance radius (preview == simulation). */
  footprint: number;
}

function recipe(
  partial: Omit<ConstructionRecipe, 'footprint'> & { footprint?: number },
): ConstructionRecipe {
  return {
    ...partial,
    footprint: partial.footprint ?? defaultFootprint(partial.target),
  };
}

export function defaultFootprint(target: ConstructionTarget): number {
  if (target === 'TownHall' || target === 'OrcStronghold' || target === 'Fort') return 48;
  if (target === 'Barracks' || target === 'OrcBarracks') return 40;
  if (target === 'House' || target === 'Wall') return 28;
  if (target === 'Farm' || target === 'PigFarm') return 32;
  if (target === 'Road') return 20;
  if (target === 'Blacksmith' || target === 'Temple' || target === 'Market') return 36;
  if (target === 'Storage') return 34;
  return 36;
}

const AUTONOMOUS: ConstructionRecipe[] = [
  recipe({
    target: 'House',
    category: 'autonomous',
    label: 'House',
    costs: { gold: 20, wood: 30, stone: 0, iron: 0 },
    buildersRequired: 1,
    minPopulation: 2,
  }),
  recipe({
    target: 'Farm',
    category: 'autonomous',
    label: 'Farm',
    costs: { gold: 25, wood: 20, stone: 0, iron: 0 },
    buildersRequired: 1,
    minPopulation: 2,
  }),
  recipe({
    target: 'PigFarm',
    category: 'autonomous',
    label: 'War Hut',
    costs: { gold: 25, wood: 20, stone: 0, iron: 0 },
    buildersRequired: 1,
    minPopulation: 2,
  }),
  recipe({
    target: 'Storage',
    category: 'autonomous',
    label: 'Storage',
    costs: { gold: 30, wood: 25, stone: 15, iron: 0 },
    buildersRequired: 1,
    minPopulation: 3,
  }),
  recipe({
    target: 'Road',
    category: 'autonomous',
    label: 'Basic Road',
    costs: { gold: 5, wood: 0, stone: 15, iron: 0 },
    buildersRequired: 1,
    minPopulation: 2,
  }),
];

const STRATEGIC: ConstructionRecipe[] = [
  recipe({
    target: 'Barracks',
    category: 'strategic',
    label: 'Barracks',
    costs: { gold: 100, wood: 40, stone: 30, iron: 10 },
    buildersRequired: 2,
    minPopulation: 4,
  }),
  recipe({
    target: 'OrcBarracks',
    category: 'strategic',
    label: 'Orc Barracks',
    costs: { gold: 100, wood: 40, stone: 30, iron: 10 },
    buildersRequired: 2,
    minPopulation: 4,
  }),
  recipe({
    target: 'Blacksmith',
    category: 'strategic',
    label: 'Blacksmith',
    costs: { gold: 80, wood: 30, stone: 40, iron: 25 },
    buildersRequired: 2,
    minPopulation: 5,
  }),
  recipe({
    target: 'Fort',
    category: 'strategic',
    label: 'Fort',
    costs: { gold: 120, wood: 20, stone: 80, iron: 15 },
    buildersRequired: 2,
    minPopulation: 6,
  }),
  recipe({
    target: 'Temple',
    category: 'strategic',
    label: 'Temple',
    costs: { gold: 90, wood: 50, stone: 40, iron: 5 },
    buildersRequired: 2,
    minPopulation: 5,
  }),
  recipe({
    target: 'Market',
    category: 'strategic',
    label: 'Market',
    costs: { gold: 70, wood: 45, stone: 20, iron: 0 },
    buildersRequired: 1,
    minPopulation: 4,
  }),
  recipe({
    target: 'Wall',
    category: 'strategic',
    label: 'Wall',
    costs: { gold: 15, wood: 5, stone: 35, iron: 0 },
    buildersRequired: 1,
    minPopulation: 3,
  }),
];

const BY_TARGET = new Map<ConstructionTarget, ConstructionRecipe>();
for (const r of [...AUTONOMOUS, ...STRATEGIC]) BY_TARGET.set(r.target, r);

export function getRecipe(target: ConstructionTarget): ConstructionRecipe | undefined {
  return BY_TARGET.get(target);
}

/** Footprint for placement — catalog first, then type defaults (mains). */
export function footprintForTarget(target: string): number {
  const r = getRecipe(target as ConstructionTarget);
  if (r) return r.footprint;
  return defaultFootprint(target as ConstructionTarget);
}

/** Strategic options shown to the local player (faction + tier aware). */
export function strategicOptionsForFaction(
  factionId: FactionId,
  tier?: SettlementTier,
): ConstructionRecipe[] {
  return STRATEGIC.filter((r) => {
    if (r.target === 'Barracks') return factionId === 'humans';
    if (r.target === 'OrcBarracks') return factionId === 'orcs';
    if (tier && !isBuildingAllowed(tier, r.target)) return false;
    return true;
  });
}

export function autonomousFarmForFaction(factionId: FactionId): ConstructionTarget {
  return factionId === 'orcs' ? 'PigFarm' : 'Farm';
}

export function isAutonomousTarget(target: ConstructionTarget): boolean {
  return getRecipe(target)?.category === 'autonomous';
}

export function isStrategicTarget(target: ConstructionTarget): boolean {
  return getRecipe(target)?.category === 'strategic';
}
