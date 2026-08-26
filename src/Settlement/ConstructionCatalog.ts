import type { BuildingType } from '../Entities/Building';
import type { FactionId } from '../Players/Types';
import {
  isBuildingAllowed,
  minTierForBuilding,
  TIER_DEFS,
  type SettlementTier,
} from './SettlementTier';
import { footprintForBuildingType } from '../Map/BuildPlacement';

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

/**
 * Who pays when a project starts.
 * - settlement: local seat materials (autonomous civic)
 * - treasury: all costs as gold from Faction Treasury via treasuryGoldCost
 * - mixed: gold from treasury; wood/stone/iron from settlement when above reserve
 */
export type FundingSource = 'settlement' | 'treasury' | 'mixed';

export interface ConstructionRecipe {
  target: ConstructionTarget;
  category: ConstructionCategory;
  label: string;
  costs: ConstructionCosts;
  /** Who funds this recipe at project start. */
  fundingSource: FundingSource;
  /** Minimum civic builder labor to start (population profession pool). */
  buildersRequired: number;
  /** Population must be at least this (0 = no gate). */
  minPopulation: number;
  /** World-space placement clearance radius (preview == simulation). */
  footprint: number;
}

/** Convert material costs into Faction Treasury gold (strategic / outpost). */
export function treasuryGoldCost(costs: ConstructionCosts): number {
  return costs.gold + costs.wood * 0.5 + costs.stone * 0.75 + costs.iron * 2;
}

/** Player-facing build option with soft lock reasons (shown in UI, not hidden). */
export interface StrategicBuildOption {
  recipe: ConstructionRecipe;
  /** Null when buildable now. */
  blockReason: string | null;
}

function recipe(
  partial: Omit<ConstructionRecipe, 'footprint' | 'fundingSource'> & {
    footprint?: number;
    fundingSource?: FundingSource;
  },
): ConstructionRecipe {
  return {
    ...partial,
    fundingSource:
      partial.fundingSource ??
      (partial.category === 'strategic' ? 'treasury' : 'settlement'),
    footprint: partial.footprint ?? defaultFootprint(partial.target),
  };
}

export function defaultFootprint(target: ConstructionTarget): number {
  if (target === 'TownHall' || target === 'OrcStronghold' || target === 'Fort') return 48;
  if (target === 'Outpost') return 32;
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
    costs: { gold: 80, wood: 30, stone: 20, iron: 5 },
    buildersRequired: 2,
    minPopulation: 4,
  }),
  recipe({
    target: 'OrcBarracks',
    category: 'strategic',
    label: 'Orc Barracks',
    costs: { gold: 80, wood: 30, stone: 20, iron: 5 },
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
    target: 'Outpost',
    category: 'strategic',
    label: 'Outpost',
    costs: { gold: 60, wood: 25, stone: 40, iron: 5 },
    buildersRequired: 1,
    minPopulation: 4,
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

/** Footprint for placement — Asset Manifest via BuildPlacement when available. */
export function footprintForTarget(target: string, factionId: FactionId = 'humans'): number {
  if (target === 'Road') return 20;
  return footprintForBuildingType(target, factionId);
}

/** Strategic options shown to the local player (faction + tier aware). */
export function strategicOptionsForFaction(
  factionId: FactionId,
  tier?: SettlementTier,
): ConstructionRecipe[] {
  return listStrategicBuildOptions(factionId, {
    gold: Number.POSITIVE_INFINITY,
    wood: Number.POSITIVE_INFINITY,
    stone: Number.POSITIVE_INFINITY,
    iron: Number.POSITIVE_INFINITY,
    population: Number.POSITIVE_INFINITY,
    tier,
  })
    .filter((o) => o.blockReason === null)
    .map((o) => o.recipe);
}

/**
 * All faction strategic buildings with explicit block reasons
 * (treasury gold / tier / population) — never silently omit.
 * `have.gold` is Faction Treasury for treasury-funded recipes.
 */
export function listStrategicBuildOptions(
  factionId: FactionId,
  have: {
    gold: number;
    wood: number;
    stone: number;
    iron: number;
    population: number;
    tier?: SettlementTier;
  },
): StrategicBuildOption[] {
  const out: StrategicBuildOption[] = [];
  for (const r of STRATEGIC) {
    if (r.target === 'Barracks' && factionId !== 'humans') continue;
    if (r.target === 'OrcBarracks' && factionId !== 'orcs') continue;

    const reasons: string[] = [];
    if (have.tier && !isBuildingAllowed(have.tier, r.target)) {
      const need = minTierForBuilding(r.target);
      reasons.push(
        need ? `Needs ${TIER_DEFS[need].label}` : 'Locked',
      );
    }
    if (have.population < r.minPopulation) {
      reasons.push(`Need ${r.minPopulation} pop`);
    }
    if (r.fundingSource === 'treasury' || r.fundingSource === 'mixed') {
      const need = treasuryGoldCost(r.costs);
      if (have.gold < need) {
        reasons.push(`Need ${Math.ceil(need - have.gold)} Treasury gold`);
      }
    } else {
      const missing = formatMissingCosts(have, r.costs);
      if (missing) reasons.push(missing);
    }

    out.push({
      recipe: r,
      blockReason: reasons.length ? reasons.join(' · ') : null,
    });
  }
  return out;
}

/** e.g. "Need 40 stone, 5 iron" or null if affordable. */
export function formatMissingCosts(
  have: { gold: number; wood: number; stone: number; iron: number },
  costs: ConstructionCosts,
): string | null {
  const parts: string[] = [];
  if (have.gold < costs.gold) parts.push(`${Math.ceil(costs.gold - have.gold)}G`);
  if (have.wood < costs.wood) parts.push(`${Math.ceil(costs.wood - have.wood)}W`);
  if (have.stone < costs.stone) parts.push(`${Math.ceil(costs.stone - have.stone)} stone`);
  if (have.iron < costs.iron) parts.push(`${Math.ceil(costs.iron - have.iron)} iron`);
  return parts.length ? `Need ${parts.join(', ')}` : null;
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
