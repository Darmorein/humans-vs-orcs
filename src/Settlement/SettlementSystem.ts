import {
  Building,
  isHousingBuilding,
  isMainBuilding,
  isStorageBuilding,
  type BuildingType,
} from '../Entities/Building';
import { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import type { GameMap } from '../Map/GameMap';
import { canPlaceBuildingAt, footprintForBuildingType } from '../Map/BuildPlacement';
import { createTile } from '../Map/Terrain';
import type { MatchState, PlayerState } from '../Players/MatchState';
import { FACTIONS } from '../Players/Types';
import { isHostile } from '../Players/Relations';
import {
  autonomousFarmForFaction,
  getRecipe,
  type ConstructionTarget,
} from './ConstructionCatalog';
import type { ConstructionProject } from './ConstructionQueue';
import { Settlement } from './Settlement';
import type { SettlementNeedKind } from './Types';
import { SettlementPlanner, settlementPlanner } from './SettlementPlanner';
import { populationSim } from './Population/PopulationSim';
import {
  evaluateTier,
  isBuildingAllowed,
  TIER_DEFS,
  type SettlementTier,
} from './SettlementTier';
import {
  createSettlerGroupId,
  FOUNDING_ARRIVAL_DIST,
  type SettlerGroup,
} from './SettlerGroup';
import { doctrineOf } from '../Players/FactionDoctrine';
import { pickLayoutForFaction } from './LayoutVariants';
import type { FactionId } from '../Players/Types';

const WOOD_PASSIVE = 0.25;
const STONE_PASSIVE = 0.1;

let nextSettlementSeq = 1;

/**
 * Settlement simulation: needs → queue → builds; multi-seat per player;
 * Settler Groups found new Camps; tiers gate buildings/params.
 */
export class SettlementSystem {
  /** Optional hook when settlers finish founding a camp (hero careers / history). */
  public static onSettlementFounded:
    | ((playerId: string, settlers: Unit[], camp: Settlement) => void)
    | null = null;

  private settlements = new Map<string, Settlement>();
  private settlerGroups: SettlerGroup[] = [];

  public ensure(playerId: string, factionId: FactionId = 'humans'): Settlement {
    const existing = this.primaryFor(playerId);
    if (existing) return existing;
    return this.createSettlement(playerId, 'village', 0, 0, factionId);
  }

  /** Primary seat for UI / AI (highest tier with TC, else any). */
  public get(playerId: string): Settlement | undefined {
    return this.primaryFor(playerId);
  }

  public getById(id: string): Settlement | undefined {
    return this.settlements.get(id);
  }

  public all(): Settlement[] {
    return [...this.settlements.values()];
  }

  public allForOwner(playerId: string): Settlement[] {
    return this.all().filter((s) => s.playerId === playerId);
  }

  /**
   * Replace settlement seats from a snapshot (Save/Load).
   * Citizens are lightly re-seeded to match population — not bit-identical.
   */
  public hydrateFromSnapshot(
    rows: Array<{
      id: string;
      playerId: string;
      tier: string;
      centerX: number;
      centerY: number;
      population: number;
      housing: number;
      gold: number;
      food: number;
      wood: number;
      stone: number;
      iron: number;
      hasTownCenter: boolean;
    }>,
    match?: MatchState,
  ) {
    this.settlements.clear();
    this.settlerGroups = [];
    let maxSeq = 1;
    for (const row of rows) {
      const m = /-(\d+)$/.exec(row.id);
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]) + 1);
      const tier = (row.tier as SettlementTier) || 'village';
      const s = new Settlement(row.id, row.playerId, tier);
      s.centerX = row.centerX;
      s.centerY = row.centerY;
      s.housing = row.housing;
      s.gold = row.gold;
      s.food = row.food;
      s.wood = row.wood;
      s.stone = row.stone;
      s.iron = row.iron;
      s.hasTownCenter = row.hasTownCenter;
      s.citizens = [];
      const factionId = match?.getPlayer(row.playerId)?.factionId ?? 'humans';
      if (row.population > 0) {
        populationSim.seedIfEmpty(s, factionId, Math.max(1, row.population));
        while (s.citizens.length > row.population) s.citizens.pop();
      }
      s.population = s.citizens.length;
      this.settlements.set(s.id, s);
    }
    nextSettlementSeq = Math.max(nextSettlementSeq, maxSeq);
  }

  public getSettlerGroup(ownerPlayerId: string): SettlerGroup | undefined {
    return this.settlerGroups.find(
      (g) =>
        g.ownerPlayerId === ownerPlayerId &&
        (g.status === 'ready' || g.status === 'traveling'),
    );
  }

  public update(dt: number, entities: Entity[], match: MatchState, gameMap: GameMap) {
    this.reconcileMains(entities, match);

    for (const s of this.all()) {
      const player = match.getPlayer(s.playerId);
      if (!player || player.isDefeated) continue;
      this.syncFromWorld(s, entities, player);
      this.simulateEconomy(s, dt);
      this.recomputeNeeds(s, player.factionId);
      this.deriveCivicStats(s, player.factionId);
      this.refreshTier(s);
      s.buildCooldown = Math.max(0, s.buildCooldown - dt);
      this.enqueueAutonomousIfNeeded(s, player);
      this.processQueue(s, entities, match, gameMap, player, dt);
    }

    for (const player of match.allPlayers()) {
      if (player.isDefeated) continue;
      const owned = this.allForOwner(player.id);
      if (owned.length === 0) continue;
      player.maxPop = Math.max(1, owned.reduce((a, s) => a + s.housing, 0));
      player.pop = owned.reduce((a, s) => a + s.unitCount, 0);
      const primary = this.primaryFor(player.id)!;
      player.gold = primary.gold;
      for (const s of owned) s.gold = player.gold;
    }

    const active = this.all().filter((s) => {
      const p = match.getPlayer(s.playerId);
      return !!p && !p.isDefeated;
    });
    populationSim.update(dt, active, (id) => match.getPlayer(id)?.factionId ?? 'humans');

    this.updateSettlerMissions(entities, match);
  }

  public enqueueStrategic(
    playerId: string,
    target: ConstructionTarget,
    planned?: { x: number; y: number },
  ): string | null {
    const recipe = getRecipe(target);
    if (!recipe || recipe.category !== 'strategic') return null;
    const s = this.ensure(playerId);
    if (!isBuildingAllowed(s.tier, target)) return null;
    const project = s.queue.enqueue(target, 'strategic', planned);
    return project?.id ?? null;
  }

  public cancelProject(playerId: string, projectId: string): boolean {
    return this.get(playerId)?.queue.cancel(projectId) ?? false;
  }

  public moveProject(playerId: string, projectId: string, direction: -1 | 1): boolean {
    return this.get(playerId)?.queue.move(projectId, direction) ?? false;
  }

  public canFormSettlerGroup(playerId: string, factionId: FactionId = 'humans'): boolean {
    const s = this.primaryFor(playerId);
    const d = doctrineOf(factionId);
    if (!s || !s.hasTownCenter) return false;
    if (!TIER_DEFS[s.tier].canSendSettlers) return false;
    if (s.population < d.settlerMinPop) return false;
    if (s.citizens.length < d.settlerCitizens + 3) return false;
    if (s.gold < d.settlerGoldCost || s.wood < d.settlerWoodCost) return false;
    if (this.getSettlerGroup(playerId)) return false;
    return true;
  }

  /** Reserve citizens + mark idle workers as a Settler Group. */
  public formSettlerGroup(
    playerId: string,
    entities: Entity[],
    factionId: FactionId,
  ): SettlerGroup | null {
    if (!this.canFormSettlerGroup(playerId, factionId)) return null;
    const s = this.primaryFor(playerId)!;
    const d = doctrineOf(factionId);
    const workerType = FACTIONS[factionId].workerType;

    const workers: Unit[] = [];
    for (const e of entities) {
      if (!(e instanceof Unit) || e.isDead || e.ownerPlayerId !== playerId) continue;
      if (e.unitType !== workerType) continue;
      if (e.settlerGroupId) continue;
      if (e.buildTarget || e.gatherTarget) continue;
      if (Math.hypot(e.x - s.centerX, e.y - s.centerY) > s.expansionRadius * 1.8) continue;
      workers.push(e);
      if (workers.length >= d.settlerWorkers) break;
    }
    if (workers.length < d.settlerWorkers) return null;

    if (
      !s.spendMaterials({
        gold: d.settlerGoldCost,
        wood: d.settlerWoodCost,
        stone: 0,
        iron: 0,
      })
    ) {
      return null;
    }

    const citizens = s.citizens.splice(0, d.settlerCitizens);
    const group: SettlerGroup = {
      id: createSettlerGroupId(),
      ownerPlayerId: playerId,
      parentSettlementId: s.id,
      citizenIds: citizens.map((c) => c.id),
      unitIds: workers.map((w) => w.id),
      targetX: null,
      targetY: null,
      status: 'ready',
    };
    this.transitCitizens.set(
      group.id,
      citizens.map((c) => {
        c.settlementId = group.id;
        return c;
      }),
    );
    for (const w of workers) w.settlerGroupId = group.id;
    this.settlerGroups.push(group);
    s.population = s.citizens.length;
    return group;
  }

  private transitCitizens = new Map<string, import('./Population/Types').Citizen[]>();

  /** Player order: Found Settlement Here — settlers march to the site. */
  public orderFoundSettlement(
    playerId: string,
    x: number,
    y: number,
    entities: Entity[],
    factionId: 'humans' | 'orcs',
  ): boolean {
    let group = this.getSettlerGroup(playerId);
    if (!group || group.status !== 'ready') {
      group = this.formSettlerGroup(playerId, entities, factionId) ?? undefined;
    }
    if (!group || group.status !== 'ready') return false;

    group.targetX = x;
    group.targetY = y;
    group.status = 'traveling';
    for (const e of entities) {
      if (!(e instanceof Unit) || e.settlerGroupId !== group.id) continue;
      e.moveCommand(x, y);
    }
    return true;
  }

  private createSettlement(
    playerId: string,
    tier: SettlementTier,
    x = 0,
    y = 0,
    factionId: FactionId = 'humans',
  ): Settlement {
    const id = `s-${playerId}-${nextSettlementSeq++}`;
    const d = doctrineOf(factionId);
    const layout = pickLayoutForFaction(id, d.preferredLayouts);
    const s = new Settlement(id, playerId, tier, layout);
    s.centerX = x;
    s.centerY = y;
    this.settlements.set(id, s);
    return s;
  }

  private primaryFor(playerId: string): Settlement | undefined {
    const owned = this.allForOwner(playerId);
    if (owned.length === 0) return undefined;
    owned.sort((a, b) => {
      const ta = TIER_DEFS[a.tier].minPopulation;
      const tb = TIER_DEFS[b.tier].minPopulation;
      if (tb !== ta) return tb - ta;
      return b.population - a.population;
    });
    return owned[0];
  }

  /** Bind main buildings to settlements; spawn seats for new TCs. */
  private reconcileMains(entities: Entity[], match: MatchState) {
    for (const player of match.allPlayers()) {
      if (player.isDefeated) continue;
      const mains = entities.filter(
        (e): e is Building =>
          e instanceof Building &&
          !e.isDead &&
          e.isConstructed &&
          e.ownerPlayerId === player.id &&
          isMainBuilding(e.buildingType),
      );

      for (const main of mains) {
        if (main.settlementId && this.settlements.has(main.settlementId)) continue;
        // Reuse unbound primary without TC, else create
        const unbound = this.allForOwner(player.id).find((s) => !s.hasTownCenter);
        if (unbound) {
          main.settlementId = unbound.id;
          unbound.centerX = main.x;
          unbound.centerY = main.y;
        } else if (this.allForOwner(player.id).length === 0) {
          const s = this.createSettlement(
            player.id,
            'village',
            main.x,
            main.y,
            player.factionId,
          );
          main.settlementId = s.id;
        } else {
          // Orphan main (shouldn't happen often) — attach to nearest
          const nearest = this.nearestSettlement(player.id, main.x, main.y);
          if (nearest) main.settlementId = nearest.id;
        }
      }
    }

    // Drop empty dead seats (no TC, no citizens)
    for (const s of this.all()) {
      if (s.hasTownCenter || s.citizens.length > 0) continue;
      if (this.settlerGroups.some((g) => g.parentSettlementId === s.id && g.status !== 'complete')) {
        continue;
      }
      // keep freshly created unbound briefly — only delete if never had center
      if (s.centerX === 0 && s.centerY === 0) continue;
    }
  }

  private nearestSettlement(playerId: string, x: number, y: number): Settlement | undefined {
    let best: Settlement | undefined;
    let bestD = Infinity;
    for (const s of this.allForOwner(playerId)) {
      const d = Math.hypot(s.centerX - x, s.centerY - y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private belongsToSettlement(e: Entity, s: Settlement, owned: Settlement[]): boolean {
    if (e.ownerPlayerId !== s.playerId) return false;
    if (e instanceof Building && e.settlementId) return e.settlementId === s.id;
    // Nearest-settlement ownership for unbound buildings / units
    let nearest = s;
    let best = Infinity;
    for (const o of owned) {
      const d = Math.hypot(e.x - o.centerX, e.y - o.centerY);
      if (d < best) {
        best = d;
        nearest = o;
      }
    }
    return nearest.id === s.id;
  }

  private syncFromWorld(s: Settlement, entities: Entity[], player: PlayerState) {
    s.gold = player.gold;
    s.unitCount = 0;
    s.housing = 0;
    s.houseCount = 0;
    s.farmCount = 0;
    s.storageCount = 0;
    s.structureCount = 0;
    s.hasTownCenter = false;

    let militaryWeight = 0;
    let hostilesNear = 0;
    let main: Building | null = null;
    const faction = FACTIONS[player.factionId];
    const owned = this.allForOwner(s.playerId);
    const tierDef = TIER_DEFS[s.tier];

    for (const e of entities) {
      if (e.isDead || e.ownerPlayerId !== s.playerId) continue;
      if (!this.belongsToSettlement(e, s, owned)) continue;

      if (e instanceof Unit) {
        if (e.settlerGroupId) continue; // in transit
        s.unitCount += 1;
        if (e.unitType === faction.meleeType || e.unitType === faction.rangedType) {
          militaryWeight += 1;
        }
      }
      if (e instanceof Building) {
        if (!e.isConstructed) continue;
        if (!e.settlementId) e.settlementId = s.id;
        s.structureCount += isMainBuilding(e.buildingType) ? 0 : 1;
        if (isMainBuilding(e.buildingType)) {
          s.hasTownCenter = true;
          s.housing += 4 + Math.floor(tierDef.housingBonus * 0.35);
          main = e;
        }
        if (isHousingBuilding(e.buildingType)) {
          s.houseCount += 1;
          s.housing += 4;
        }
        if (e.buildingType === 'Farm' || e.buildingType === 'PigFarm') {
          s.farmCount += 1;
        }
        if (isStorageBuilding(e.buildingType)) {
          s.storageCount += 1;
        }
      }
    }

    s.housing += tierDef.housingBonus;
    s.population = s.citizens.length;
    const cm = tierDef.capacityMult;
    s.capacity = {
      food: Math.floor((80 + s.storageCount * 40) * cm),
      wood: Math.floor((120 + s.storageCount * 50) * cm),
      stone: Math.floor((80 + s.storageCount * 40) * cm),
      iron: Math.floor((60 + s.storageCount * 30) * cm),
    };

    if (main) {
      s.centerX = main.x;
      s.centerY = main.y;
      s.expansionRadius = SettlementPlanner.computeExpansion(main.x, main.y, entities, s.playerId);
      for (const e of entities) {
        if (e.isDead || !(e instanceof Unit)) continue;
        if (Math.hypot(e.x - main.x, e.y - main.y) > 420) continue;
        if (e.ownerPlayerId === s.playerId) {
          if (e.unitType === faction.meleeType || e.unitType === faction.rangedType) {
            militaryWeight += 0.2;
          }
        } else if (isHostile(main, e)) {
          hostilesNear += 1;
        }
      }
    }

    s.threatPressure = Math.min(1, hostilesNear * 0.22);
    const garrison = Math.min(1, militaryWeight * 0.12);
    const soldierBonus = populationSim.countByProfession(s).soldier * 0.04;
    s.safety = Math.max(
      0,
      Math.min(1, 0.55 + garrison * 0.3 + soldierBonus - s.threatPressure * 0.7),
    );
  }

  private simulateEconomy(s: Settlement, dt: number) {
    s.wood = clamp(s.wood + WOOD_PASSIVE * dt, 0, s.capacity.wood);
    s.stone = clamp(s.stone + STONE_PASSIVE * dt, 0, s.capacity.stone);
  }

  private recomputeNeeds(s: Settlement, factionId: FactionId) {
    const d = doctrineOf(factionId);
    const housingRatio = s.housing > 0 ? s.population / s.housing : 1;
    s.needs.housing =
      housingRatio >= 0.85 ? clamp((housingRatio - 0.7) / 0.5, 0, 1) : 0;
    if (s.houseCount < 1 && s.population >= 3) s.needs.housing = Math.max(s.needs.housing, 0.55);
    if (s.houseCount < 2 && s.population >= 6) s.needs.housing = Math.max(s.needs.housing, 0.7);

    const foodRatio = s.capacity.food > 0 ? s.food / s.capacity.food : 0;
    const farmSupport = s.population > 0 ? s.farmCount / Math.max(1, s.population / 4) : 1;
    s.needs.food = 0;
    if (foodRatio < 0.35) s.needs.food = Math.max(s.needs.food, 1 - foodRatio);
    if (farmSupport < 0.8) s.needs.food = Math.max(s.needs.food, 0.45);
    if (s.farmCount < 1) s.needs.food = Math.max(s.needs.food, 0.75);
    if (s.farmCount < 2 && s.population >= 5) s.needs.food = Math.max(s.needs.food, 0.6);

    const stockPressure = Math.max(
      s.wood / s.capacity.wood,
      s.food / Math.max(1, s.capacity.food),
      s.stone / s.capacity.stone,
    );
    s.needs.storage = stockPressure > 0.75 ? stockPressure : 0;
    if (s.storageCount < 1 && s.farmCount >= 1) s.needs.storage = Math.max(s.needs.storage, 0.4);
    if (s.storageCount < 1 && s.gold >= 100) s.needs.storage = Math.max(s.needs.storage, 0.5);
    s.needs.storage = clamp(s.needs.storage * d.storagePriority, 0, 1);

    let defense =
      s.safety < 0.55 ? clamp((0.55 - s.safety) / 0.55, 0, 1) : s.threatPressure * 0.8;
    s.needs.defense = clamp(defense * d.defenseNeedBias, 0, 1);
  }

  private deriveCivicStats(s: Settlement, factionId: FactionId) {
    const d = doctrineOf(factionId);
    const by = populationSim.countByProfession(s);
    const n = Math.max(1, s.citizens.length);
    const wantFarmers = Math.ceil(n * (0.15 + s.needs.food * 0.25) * d.farmerBias);
    const wantBuilders = Math.ceil(
      n * (s.needs.housing > 0.3 ? 0.12 : 0.06) * d.builderBias,
    );
    const wantCraft = Math.ceil(n * 0.08 * d.craftsmanBias);
    const open =
      Math.max(0, wantFarmers - by.farmer) +
      Math.max(0, wantBuilders - by.builder) +
      Math.max(0, wantCraft - by.craftsman);
    s.jobs = clamp(open / n, 0, 1);

    s.prosperity = clamp(
      0.25 +
        s.food / 120 +
        s.gold / 800 +
        s.farmCount * 0.06 +
        by.farmer * 0.02 +
        by.craftsman * 0.015 * d.craftProsperityBias,
      0,
      1,
    );
    s.culture = clamp(0.2 + s.houseCount * 0.08 + s.prosperity * 0.3, 0, 1);
    s.knowledge = clamp(
      0.2 + s.storageCount * 0.1 + s.culture * 0.2 + by.craftsman * 0.04 * d.craftProsperityBias,
      0,
      1,
    );
    s.faith = clamp(0.25 + s.safety * 0.25 + s.houseCount * 0.04, 0, 1);
    s.craftsmanship = clamp(
      0.25 +
        s.storageCount * 0.12 * d.craftProsperityBias +
        s.wood / 200 +
        by.craftsman * 0.06 * d.craftsmanBias,
      0,
      1,
    );
    s.militaryTradition = clamp(
      0.2 +
        (1 - s.safety) * 0.2 +
        s.threatPressure * 0.4 +
        by.soldier * 0.04 * d.soldierBias +
        0.08 * d.militaryTraditionGain,
      0,
      1,
    );

    const foodScore = clamp(s.food / Math.max(1, s.capacity.food), 0, 1);
    const housingScore =
      s.housing > 0 ? clamp((s.housing - s.population) / Math.max(1, s.housing) + 0.45, 0, 1) : 0;

    const expansionPush =
      d.expansionPressure *
      (s.population > s.housing * 0.9 ? 0.15 : 0) *
      (s.prosperity > 0.45 ? 1 : 0.5);

    s.migrationAttraction = clamp(
      foodScore * 0.22 +
        housingScore * 0.22 +
        s.safety * 0.2 +
        s.prosperity * 0.18 +
        s.jobs * 0.18 +
        TIER_DEFS[s.tier].migrationBonus -
        expansionPush,
      0,
      1,
    );

    s.influence = clamp(
      s.prosperity * 0.3 +
        s.militaryTradition * 0.25 * d.influenceMilitaryWeight +
        s.culture * 0.25 +
        s.gold / 1000 +
        s.craftsmanship * 0.1 * d.craftProsperityBias,
      0,
      1,
    );
  }

  private refreshTier(s: Settlement) {
    if (!s.hasTownCenter) return;
    s.tier = evaluateTier(s.tier, s.population, s.structureCount);
  }

  private enqueueAutonomousIfNeeded(s: Settlement, player: PlayerState) {
    if (!s.hasTownCenter || s.buildCooldown > 0) return;
    const d = doctrineOf(player.factionId);
    const need = s.topNeed();

    if (!need) {
      const roadChance = d.roadBuildBias;
      if (
        s.farmCount >= 1 &&
        s.houseCount >= 1 &&
        !s.queue.hasQueuedOrBuilding('Road') &&
        s.stone >= 15 &&
        isBuildingAllowed(s.tier, 'Road') &&
        (roadChance >= 1 || Math.random() < roadChance * 0.35)
      ) {
        s.queue.enqueue('Road', 'autonomous');
      }
      if (
        d.defenseNeedBias > 1.1 &&
        s.threatPressure > 0.25 &&
        isBuildingAllowed(s.tier, 'Wall') &&
        !s.queue.hasQueuedOrBuilding('Wall')
      ) {
        const wall = getRecipe('Wall');
        if (wall && s.canAfford(wall.costs)) s.queue.enqueue('Wall', 'autonomous');
      }
      return;
    }

    let target: ConstructionTarget | null = null;
    if (need === 'housing' && s.houseCount < 6) target = 'House';
    else if (need === 'food' && s.farmCount < 6) {
      target = autonomousFarmForFaction(player.factionId);
    } else if (need === 'storage' && s.storageCount < 3) target = 'Storage';
    else if (need === 'defense') {
      if (d.defenseNeedBias >= 1.2 && isBuildingAllowed(s.tier, 'Wall')) target = 'Wall';
      else return;
    }

    if (!target || !isBuildingAllowed(s.tier, target)) return;
    if (s.queue.hasQueuedOrBuilding(target)) return;
    const recipe = getRecipe(target);
    if (!recipe || !s.canAfford(recipe.costs)) return;
    s.queue.enqueue(target, 'autonomous');
    s.buildCooldown = 1.5;
  }

  private processQueue(
    s: Settlement,
    entities: Entity[],
    match: MatchState,
    gameMap: GameMap,
    player: PlayerState,
    dt: number,
  ) {
    const unfinished = entities.find(
      (e): e is Building =>
        e instanceof Building &&
        e.ownerPlayerId === s.playerId &&
        (e.settlementId === s.id || !e.settlementId) &&
        this.belongsToSettlement(e, s, this.allForOwner(s.playerId)) &&
        !e.isDead &&
        !e.isConstructed,
    );
    if (unfinished) {
      this.assignIdleWorkers(s, entities, unfinished, player);
    }

    const active = s.queue.active();
    if (active) {
      this.advanceActiveProject(s, active, entities, gameMap, player, dt);
      return;
    }

    if (s.buildCooldown > 0) return;
    const next = s.queue.nextQueued();
    if (!next) return;
    this.tryStartProject(s, next, entities, match, gameMap, player);
  }

  private tryStartProject(
    s: Settlement,
    project: ConstructionProject,
    entities: Entity[],
    match: MatchState,
    gameMap: GameMap,
    player: PlayerState,
  ) {
    const recipe = getRecipe(project.target);
    if (!recipe) {
      s.queue.cancel(project.id);
      return;
    }
    if (!isBuildingAllowed(s.tier, project.target)) {
      s.queue.cancel(project.id);
      return;
    }

    if (s.population < recipe.minPopulation) return;
    if (!s.canAfford(recipe.costs)) return;

    const faction = FACTIONS[player.factionId];
    const idle = this.countIdleWorkers(s, entities, faction.workerType);
    if (idle < recipe.buildersRequired) return;
    if (project.target !== 'Road' && populationSim.countByProfession(s).builder < 1) return;

    const busy = entities.some(
      (e) =>
        e instanceof Building &&
        e.ownerPlayerId === s.playerId &&
        this.belongsToSettlement(e, s, this.allForOwner(s.playerId)) &&
        !e.isDead &&
        !e.isConstructed,
    );
    if (busy) return;

    if (project.target === 'Road') {
      const tiles = this.planRoadTiles(s, gameMap);
      if (tiles.length === 0) {
        s.queue.cancel(project.id);
        return;
      }
      if (!s.spendMaterials(recipe.costs)) return;
      const mp = match.getPlayer(s.playerId);
      if (mp) mp.gold = s.gold;
      project.roadTiles = tiles;
      project.roadIndex = 0;
      s.queue.markBuilding(project.id, null);
      const worker = this.findIdleWorker(s, entities, faction.workerType);
      if (worker) {
        const t0 = tiles[0]!;
        worker.moveCommand((t0.tx + 0.5) * gameMap.tileSize, (t0.ty + 0.5) * gameMap.tileSize);
      }
      s.buildCooldown = 2;
      return;
    }

    const buildingType = project.target as BuildingType;
    const main = entities.find(
      (e): e is Building =>
        e instanceof Building &&
        e.settlementId === s.id &&
        !e.isDead &&
        isMainBuilding(e.buildingType),
    );
    if (!main) return;

    let site =
      project.plannedX != null && project.plannedY != null
        ? { x: project.plannedX, y: project.plannedY, score: 1 }
        : null;

    if (site && !canPlaceBuildingAt(site.x, site.y, gameMap, entities, footprintForBuildingType(buildingType))) {
      site = null;
    }

    if (!site) {
      s.placementSalt += 1;
      const role = SettlementPlanner.roleFor(
        project.category === 'strategic' ? 'production' : this.needForTarget(project.target),
        buildingType,
      );
      site =
        settlementPlanner.findSite({
          centerX: s.centerX || main.x,
          centerY: s.centerY || main.y,
          layout: s.layout,
          expansionRadius: s.expansionRadius,
          buildingType,
          role,
          entities,
          gameMap,
          attemptSalt: s.placementSalt,
        }) ??
        settlementPlanner.findSite({
          centerX: s.centerX || main.x,
          centerY: s.centerY || main.y,
          layout: s.layout,
          expansionRadius: Math.min(340, s.expansionRadius + 70),
          buildingType,
          role,
          entities,
          gameMap,
          attemptSalt: s.placementSalt + 17,
        });
    }
    if (!site) return;

    if (!s.spendMaterials(recipe.costs)) return;
    const mp = match.getPlayer(s.playerId);
    if (mp) mp.gold = s.gold;

    const building = new Building(site.x, site.y, buildingType, player, false);
    building.settlementId = s.id;
    entities.push(building);
    s.queue.markBuilding(project.id, building.id);
    this.assignIdleWorkers(s, entities, building, player);
    s.buildCooldown = 3;
  }

  private advanceActiveProject(
    s: Settlement,
    project: ConstructionProject,
    entities: Entity[],
    gameMap: GameMap,
    player: PlayerState,
    dt: number,
  ) {
    if (project.target === 'Road') {
      this.advanceRoadProject(s, project, entities, gameMap, player, dt);
      return;
    }
    if (project.buildingId == null) {
      s.queue.cancel(project.id);
      return;
    }
    const building = entities.find((e) => e.id === project.buildingId);
    if (!building || building.isDead) {
      s.queue.cancel(project.id);
      return;
    }
    if (building instanceof Building && building.isConstructed) {
      s.queue.markDone(project.id);
      s.buildCooldown = 2;
    } else if (building instanceof Building) {
      this.assignIdleWorkers(s, entities, building, player);
    }
  }

  private advanceRoadProject(
    s: Settlement,
    project: ConstructionProject,
    entities: Entity[],
    gameMap: GameMap,
    player: PlayerState,
    dt: number,
  ) {
    if (project.roadIndex >= project.roadTiles.length) {
      s.queue.markDone(project.id);
      return;
    }
    const faction = FACTIONS[player.factionId];
    const tile = project.roadTiles[project.roadIndex]!;
    const wx = (tile.tx + 0.5) * gameMap.tileSize;
    const wy = (tile.ty + 0.5) * gameMap.tileSize;

    let builder: Unit | null = null;
    for (const e of entities) {
      if (!(e instanceof Unit) || e.isDead || e.ownerPlayerId !== s.playerId) continue;
      if (e.unitType !== faction.workerType) continue;
      if (e.settlerGroupId) continue;
      if (!this.belongsToSettlement(e, s, this.allForOwner(s.playerId))) continue;
      builder = e;
      break;
    }
    if (!builder) return;

    if (Math.hypot(builder.x - wx, builder.y - wy) > 36) {
      builder.moveCommand(wx, wy);
      return;
    }

    s.roadWorkTimer += dt;
    if (s.roadWorkTimer < 1.2) return;
    s.roadWorkTimer = 0;

    const idx = tile.ty * gameMap.tileWidth + tile.tx;
    const current = gameMap.tiles[idx]!;
    if (current.type === 'grass' || current.type === 'hill' || current.type === 'forest') {
      gameMap.tiles[idx] = createTile('road', current.elevation);
    }
    project.roadIndex += 1;
    if (project.roadIndex >= project.roadTiles.length) {
      s.queue.markDone(project.id);
      s.buildCooldown = 2;
    }
  }

  private planRoadTiles(s: Settlement, gameMap: GameMap): { tx: number; ty: number }[] {
    const { tx: cx, ty: cy } = gameMap.worldToTile(s.centerX, s.centerY);
    const out: { tx: number; ty: number }[] = [];
    const angle = (s.placementSalt % 8) * (Math.PI / 4);
    for (let step = 2; step <= 6; step++) {
      const tx = Math.round(cx + Math.cos(angle) * step);
      const ty = Math.round(cy + Math.sin(angle) * step);
      if (tx < 1 || ty < 1 || tx >= gameMap.tileWidth - 1 || ty >= gameMap.tileHeight - 1) continue;
      const t = gameMap.tiles[ty * gameMap.tileWidth + tx]!;
      if (t.type === 'road' || t.type === 'bridge') continue;
      if (t.type !== 'grass' && t.type !== 'hill' && t.type !== 'forest') continue;
      out.push({ tx, ty });
    }
    return out;
  }

  private updateSettlerMissions(entities: Entity[], match: MatchState) {
    for (const group of this.settlerGroups) {
      if (group.status !== 'traveling' || group.targetX == null || group.targetY == null) continue;

      const settlers = entities.filter(
        (e): e is Unit =>
          e instanceof Unit && !e.isDead && e.settlerGroupId === group.id,
      );
      if (settlers.length === 0) {
        const parent = this.getById(group.parentSettlementId);
        const stranded = this.transitCitizens.get(group.id);
        if (parent && stranded) {
          for (const c of stranded) {
            c.settlementId = parent.id;
            parent.citizens.push(c);
          }
        }
        group.status = 'failed';
        this.transitCitizens.delete(group.id);
        continue;
      }

      const arrived = settlers.filter(
        (u) => Math.hypot(u.x - group.targetX!, u.y - group.targetY!) <= FOUNDING_ARRIVAL_DIST,
      );
      if (arrived.length < Math.ceil(settlers.length * 0.6)) {
        for (const u of settlers) {
          if (Math.hypot(u.x - group.targetX, u.y - group.targetY) > FOUNDING_ARRIVAL_DIST) {
            u.moveCommand(group.targetX, group.targetY);
          }
        }
        continue;
      }

      const player = match.getPlayer(group.ownerPlayerId);
      if (!player) {
        group.status = 'failed';
        continue;
      }

      const camp = this.createSettlement(
        group.ownerPlayerId,
        'camp',
        group.targetX,
        group.targetY,
        player.factionId,
      );
      const tc = new Building(
        group.targetX,
        group.targetY,
        player.faction.mainBuilding,
        player,
        true,
      );
      tc.settlementId = camp.id;
      entities.push(tc);

      const citizens = this.transitCitizens.get(group.id) ?? [];
      for (const c of citizens) {
        c.settlementId = camp.id;
        c.profession = 'peasant';
        camp.citizens.push(c);
      }
      this.transitCitizens.delete(group.id);
      camp.population = camp.citizens.length;
      camp.food = 25;
      camp.wood = 40;
      camp.stone = 20;

      // Transfer a bit of stock from parent
      const parent = this.getById(group.parentSettlementId);
      if (parent) {
        const takeFood = Math.min(20, parent.food * 0.2);
        parent.food -= takeFood;
        camp.food += takeFood;
      }

      for (const u of settlers) {
        u.settlerGroupId = null;
        u.moveCommand(group.targetX + (Math.random() - 0.5) * 40, group.targetY + 30);
      }

      group.status = 'complete';
      SettlementSystem.onSettlementFounded?.(group.ownerPlayerId, settlers, camp);
    }

    this.settlerGroups = this.settlerGroups.filter(
      (g) => g.status === 'ready' || g.status === 'traveling',
    );
  }

  private needForTarget(target: ConstructionTarget): SettlementNeedKind {
    if (target === 'House') return 'housing';
    if (target === 'Farm' || target === 'PigFarm') return 'food';
    return 'storage';
  }

  private countIdleWorkers(s: Settlement, entities: Entity[], workerType: string): number {
    let n = 0;
    const owned = this.allForOwner(s.playerId);
    for (const e of entities) {
      if (!(e instanceof Unit) || e.isDead || e.ownerPlayerId !== s.playerId) continue;
      if (e.unitType !== workerType) continue;
      if (e.settlerGroupId) continue;
      if (!this.belongsToSettlement(e, s, owned)) continue;
      if (e.buildTarget || e.gatherTarget || e.targetEntity) continue;
      n++;
    }
    return n;
  }

  private findIdleWorker(s: Settlement, entities: Entity[], workerType: string): Unit | null {
    const owned = this.allForOwner(s.playerId);
    for (const e of entities) {
      if (!(e instanceof Unit) || e.isDead || e.ownerPlayerId !== s.playerId) continue;
      if (e.unitType !== workerType) continue;
      if (e.settlerGroupId) continue;
      if (!this.belongsToSettlement(e, s, owned)) continue;
      if (e.buildTarget || e.gatherTarget || e.targetEntity) continue;
      return e;
    }
    return null;
  }

  private assignIdleWorkers(
    s: Settlement,
    entities: Entity[],
    building: Building,
    player: PlayerState,
  ) {
    const workerType = FACTIONS[player.factionId].workerType;
    const owned = this.allForOwner(s.playerId);
    let assigned = 0;
    for (const e of entities) {
      if (!(e instanceof Unit) || e.isDead || e.ownerPlayerId !== s.playerId) continue;
      if (e.unitType !== workerType) continue;
      if (e.settlerGroupId) continue;
      if (!this.belongsToSettlement(e, s, owned)) continue;
      if (e.buildTarget === building) {
        assigned++;
        continue;
      }
      if (e.buildTarget || e.gatherTarget) continue;
      e.buildCommand(building);
      assigned++;
      if (assigned >= 3) break;
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
