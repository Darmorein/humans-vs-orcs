import type { ConstructionTarget } from './ConstructionCatalog';

/** Settlement size progression — gates params and available buildings. */
export type SettlementTier = 'camp' | 'hamlet' | 'village' | 'town' | 'city';

export const TIER_ORDER: SettlementTier[] = [
  'camp',
  'hamlet',
  'village',
  'town',
  'city',
];

export interface SettlementTierDef {
  id: SettlementTier;
  label: string;
  /** Citizens required to promote into this tier. */
  minPopulation: number;
  /** Constructed non-main structures required. */
  minStructures: number;
  /** Extra housing soft-cap from civic status. */
  housingBonus: number;
  /** Multiplier on storage capacities. */
  capacityMult: number;
  migrationBonus: number;
  /** Minimum tier that may dispatch a Settler Group. */
  canSendSettlers: boolean;
  /** Buildings allowed at this tier (Road included). */
  allowedBuildings: ConstructionTarget[];
}

const BASIC: ConstructionTarget[] = ['House', 'Farm', 'PigFarm', 'Storage'];
const WITH_ROAD: ConstructionTarget[] = [...BASIC, 'Road'];
const VILLAGE_BUILDINGS: ConstructionTarget[] = [
  ...WITH_ROAD,
  'Barracks',
  'OrcBarracks',
  'Wall',
  'Outpost',
];
const TOWN_BUILDINGS: ConstructionTarget[] = [
  ...VILLAGE_BUILDINGS,
  'Blacksmith',
  'Market',
];
const CITY_BUILDINGS: ConstructionTarget[] = [
  ...TOWN_BUILDINGS,
  'Fort',
  'Temple',
];

export const TIER_DEFS: Record<SettlementTier, SettlementTierDef> = {
  camp: {
    id: 'camp',
    label: 'Camp',
    minPopulation: 0,
    minStructures: 0,
    housingBonus: 0,
    capacityMult: 0.7,
    migrationBonus: -0.05,
    canSendSettlers: false,
    allowedBuildings: BASIC,
  },
  hamlet: {
    id: 'hamlet',
    label: 'Hamlet',
    minPopulation: 6,
    minStructures: 1,
    housingBonus: 2,
    capacityMult: 0.85,
    migrationBonus: 0,
    canSendSettlers: false,
    allowedBuildings: WITH_ROAD,
  },
  village: {
    id: 'village',
    label: 'Village',
    minPopulation: 12,
    minStructures: 3,
    housingBonus: 4,
    capacityMult: 1,
    migrationBonus: 0.05,
    /** Second city delayed — settlers require Town+. Outpost remains at Village. */
    canSendSettlers: false,
    allowedBuildings: VILLAGE_BUILDINGS,
  },
  town: {
    id: 'town',
    label: 'Town',
    minPopulation: 20,
    minStructures: 4,
    housingBonus: 8,
    capacityMult: 1.15,
    migrationBonus: 0.1,
    canSendSettlers: true,
    allowedBuildings: TOWN_BUILDINGS,
  },
  city: {
    id: 'city',
    label: 'City',
    minPopulation: 36,
    minStructures: 8,
    housingBonus: 12,
    capacityMult: 1.35,
    migrationBonus: 0.15,
    canSendSettlers: true,
    allowedBuildings: CITY_BUILDINGS,
  },
};

export function tierIndex(tier: SettlementTier): number {
  return TIER_ORDER.indexOf(tier);
}

export function tierAtLeast(have: SettlementTier, need: SettlementTier): boolean {
  return tierIndex(have) >= tierIndex(need);
}

export function nextTier(tier: SettlementTier): SettlementTier | null {
  const i = tierIndex(tier);
  if (i < 0 || i >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[i + 1]!;
}

export function isBuildingAllowed(tier: SettlementTier, target: ConstructionTarget): boolean {
  return TIER_DEFS[tier].allowedBuildings.includes(target);
}

/** Lowest tier that unlocks this building, or null if never. */
export function minTierForBuilding(target: ConstructionTarget): SettlementTier | null {
  for (const tier of TIER_ORDER) {
    if (TIER_DEFS[tier].allowedBuildings.includes(target)) return tier;
  }
  return null;
}

/** Promote if population + structures meet the next tier's thresholds. */
export function evaluateTier(current: SettlementTier, population: number, structures: number): SettlementTier {
  let tier = current;
  for (;;) {
    const n = nextTier(tier);
    if (!n) break;
    const def = TIER_DEFS[n];
    if (population < def.minPopulation || structures < def.minStructures) break;
    tier = n;
  }
  return tier;
}
