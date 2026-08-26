import type { SettlementCapacity, SettlementNeeds, SettlementResources } from './Types';
import { pickLayoutForId, type SettlementLayoutProfile } from './LayoutVariants';
import { ConstructionQueue } from './ConstructionQueue';
import type { Citizen } from './Population/Types';
import { TIER_DEFS, type SettlementTier } from './SettlementTier';
import type { SettlementFocus, SettlementSpecialization } from './SettlementFocus';

/** Named income channels for settlement dashboard / AI. */
export interface SettlementIncomeSources {
  goldMines: number;
  goldPassive: number;
  foodFarms: number;
  woodPassive: number;
  stonePassive: number;
}

export function emptyIncomeSources(): SettlementIncomeSources {
  return {
    goldMines: 0,
    goldPassive: 0,
    foodFarms: 0,
    woodPassive: 0,
    stonePassive: 0,
  };
}

/**
 * Autonomous settlement seat owned by one Player (a player may own several).
 * Construction goes through ConstructionQueue; citizens are a light pop sim.
 */
export class Settlement {
  public readonly id: string;
  /** Owning player seat. */
  public readonly playerId: string;
  public readonly layout: SettlementLayoutProfile;
  public readonly queue = new ConstructionQueue();
  public citizens: Citizen[] = [];

  /** Camp → … → City; gates buildings and soft params. */
  public tier: SettlementTier;

  public centerX = 0;
  public centerY = 0;
  public expansionRadius = 120;
  public structureCount = 0;

  /** Inhabitant count (citizens), not map unit count. */
  public population = 0;
  public housing = 0;
  /** Map units near this seat (workers/army). */
  public unitCount = 0;

  /** 0..1 — open productive roles that attract migrants. */
  public jobs = 0.4;

  public food = 40;
  public wood = 100;
  public stone = 60;
  public iron = 30;
  public gold = 0;

  public safety = 0.7;
  public prosperity = 0.4;
  public culture = 0.3;
  public knowledge = 0.25;
  public faith = 0.3;
  public craftsmanship = 0.35;
  public militaryTradition = 0.3;

  public migrationAttraction = 0.4;
  /** Civic prestige — also feeds InfluenceMap territory strength. */
  public influence = 0.3;

  /** Player strategic focus — soft autonomous bias. */
  public focus: SettlementFocus = 'balanced';
  /** Emergent role from buildings / economy (world-driven). */
  public specialization: SettlementSpecialization = 'none';
  /** Short reasons for UI (growth / safety), refreshed each tick. */
  public growthHints: string[] = [];
  public safetyHints: string[] = [];
  /** Decaying war shock from nearby casualties (0..1). */
  public warShock = 0;

  public capacity: SettlementCapacity = {
    food: 80,
    wood: 160,
    stone: 120,
    iron: 80,
  };

  public needs: SettlementNeeds = {
    housing: 0,
    food: 0,
    storage: 0,
    defense: 0,
  };

  public threatPressure = 0;

  public houseCount = 0;
  public farmCount = 0;
  public storageCount = 0;
  public outpostCount = 0;
  public mineCount = 0;
  public hasTownCenter = false;

  /** Aggregate civic builders available for autonomous/strategic construction. */
  public civicLabor = 0;
  /** Per-tick resource income breakdown for UI (gold/food/wood/stone). */
  public incomeSources: SettlementIncomeSources = emptyIncomeSources();
  /** Last-tick rates (per second) for dashboard — local production (not tax). */
  public incomeRates = { gold: 0, food: 0, wood: 0, stone: 0 };
  /** Local gold income rate (mines), for settlement panel. */
  public localIncomeRate = 0;
  /** Gold remitted to Faction Treasury last tax tick (/s). */
  public taxContributionRate = 0;

  public buildCooldown = 0;
  public placementSalt = 0;
  public roadWorkTimer = 0;

  constructor(
    id: string,
    playerId: string,
    tier: SettlementTier = 'village',
    layout?: SettlementLayoutProfile,
  ) {
    this.id = id;
    this.playerId = playerId;
    this.tier = tier;
    this.layout = layout ?? pickLayoutForId(id);
    const def = TIER_DEFS[tier];
    this.food = Math.floor(40 * def.capacityMult);
    this.wood = Math.floor(100 * def.capacityMult);
    this.stone = Math.floor(60 * def.capacityMult);
  }

  public get resources(): SettlementResources {
    return {
      food: this.food,
      wood: this.wood,
      stone: this.stone,
      iron: this.iron,
      gold: this.gold,
    };
  }

  public canAfford(costs: { gold: number; wood: number; stone: number; iron: number }): boolean {
    return (
      this.gold >= costs.gold &&
      this.wood >= costs.wood &&
      this.stone >= costs.stone &&
      this.iron >= costs.iron
    );
  }

  public spendMaterials(costs: {
    gold: number;
    wood: number;
    stone: number;
    iron: number;
  }): boolean {
    if (!this.canAfford(costs)) return false;
    this.gold -= costs.gold;
    this.wood -= costs.wood;
    this.stone -= costs.stone;
    this.iron -= costs.iron;
    return true;
  }

  public topNeed(threshold = 0.35): keyof SettlementNeeds | null {
    const entries: [keyof SettlementNeeds, number][] = [
      ['housing', this.needs.housing],
      ['food', this.needs.food],
      ['storage', this.needs.storage],
      ['defense', this.needs.defense],
    ];
    entries.sort((a, b) => b[1] - a[1]);
    const top = entries[0]!;
    return top[1] >= threshold ? top[0] : null;
  }
}
