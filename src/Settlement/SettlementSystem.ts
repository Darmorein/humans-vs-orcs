import {
  Building,
  isHousingBuilding,
  isMainBuilding,
  isOutpostBuilding,
  isStorageBuilding,
  type BuildingType,
} from '../Entities/Building';
import { Entity } from '../Entities/Entity';
import { ResourceNode } from '../Entities/ResourceNode';
import { Unit } from '../Entities/Unit';
import type { GameMap } from '../Map/GameMap';
import type { InfluenceMap } from '../Map/InfluenceMap';
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
import { Settlement, emptyIncomeSources } from './Settlement';
import type { SettlementNeedKind } from './Types';
import { SettlementPlanner, settlementPlanner } from './SettlementPlanner';
import { populationSim } from './Population/PopulationSim';
import {
  focusNeedBias,
  type SettlementFocus,
  type SettlementSpecialization,
} from './SettlementFocus';
import {
  evaluateTier,
  isBuildingAllowed,
  TIER_DEFS,
  type SettlementTier,
} from './SettlementTier';
import {
  createSettlerGroupId,
  FOUNDING_ARRIVAL_DIST,
  SETTLER_CARAVAN_SPEED,
  type SettlerGroup,
} from './SettlerGroup';
import { doctrineOf } from '../Players/FactionDoctrine';
import {
  pickLayoutForFaction,
  pickLayoutForId,
  SETTLEMENT_LAYOUTS,
  type SettlementLayoutId,
} from './LayoutVariants';
import type { FactionId } from '../Players/Types';
import type { GameRng } from '../Sim/GameRng';
import type { Citizen } from './Population/Types';

const WOOD_PASSIVE = 0.25;
const STONE_PASSIVE = 0.1;
/** Base gold extraction per second at infra 0 / full safety / owned. */
const GOLD_BASE_EXTRACTION = 2.2;
const FOOD_PER_FARM = 1.15;
const LINK_MINE_RANGE = 520;
const RAID_RANGE = 90;
const OUTPOST_COST = { gold: 60, wood: 25, stone: 40, iron: 5 };
const OUTPOST_MIN_DIST_FROM_TC = 160;
const OUTPOST_MAX_DIST_FROM_ARMY = 110;
const OUTPOST_MIN_DIST_BETWEEN = 140;

let nextSettlementSeq = 1;

export function getNextSettlementSeq(): number {
  return nextSettlementSeq;
}
export function setNextSettlementSeq(n: number) {
  nextSettlementSeq = Math.max(1, Math.floor(n));
}

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
  /** Active only during `update` — road rolls / settler scatter. */
  private tickRng: GameRng | null = null;

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
   * Uses snap citizens/queue when present; otherwise lightly re-seeds population.
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
      citizens?: Citizen[];
      queue?: ConstructionProject[];
      expansionRadius?: number;
      layoutId?: string;
      focus?: SettlementFocus;
      specialization?: SettlementSpecialization;
      warShock?: number;
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
      const layout =
        row.layoutId && row.layoutId in SETTLEMENT_LAYOUTS
          ? SETTLEMENT_LAYOUTS[row.layoutId as SettlementLayoutId]
          : pickLayoutForId(row.id);
      const s = new Settlement(row.id, row.playerId, tier, layout);
      s.centerX = row.centerX;
      s.centerY = row.centerY;
      s.housing = row.housing;
      s.gold = row.gold;
      s.food = row.food;
      s.wood = row.wood;
      s.stone = row.stone;
      s.iron = row.iron;
      s.hasTownCenter = row.hasTownCenter;
      if (typeof row.expansionRadius === 'number') {
        s.expansionRadius = row.expansionRadius;
      }
      if (row.focus) s.focus = row.focus;
      if (row.specialization) s.specialization = row.specialization;
      if (typeof row.warShock === 'number') s.warShock = row.warShock;

      if (row.citizens) {
        s.citizens = row.citizens.map((c) => ({
          ...c,
          traits: [...c.traits],
          heroId: c.heroId ?? null,
        }));
        s.population = s.citizens.length;
      } else {
        s.citizens = [];
        const factionId = match?.getPlayer(row.playerId)?.factionId ?? 'humans';
        if (row.population > 0) {
          populationSim.seedIfEmpty(s, factionId, Math.max(1, row.population));
          while (s.citizens.length > row.population) s.citizens.pop();
        }
        s.population = s.citizens.length;
      }

      if (row.queue) {
        s.queue.replaceAll(row.queue);
      }

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

  public update(
    dt: number,
    entities: Entity[],
    match: MatchState,
    gameMap: GameMap,
    rng: GameRng,
    influence?: InfluenceMap,
  ) {
    this.tickRng = rng;
    this.reconcileMains(entities, match);
    this.linkResourceNodes(entities, match, influence);
    this.processResourceRaids(entities, match);

    for (const s of this.all()) {
      const player = match.getPlayer(s.playerId);
      if (!player || player.isDefeated) continue;
      this.syncFromWorld(s, entities, player, influence);
      this.simulateEconomy(s, dt, entities, player, influence);
      this.recomputeNeeds(s, player.factionId);
      this.deriveCivicStats(s, player.factionId, entities);
      this.refreshTier(s);
      this.refreshFeedbackHints(s, player.factionId);
      s.warShock = Math.max(0, s.warShock - dt * 0.035);
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

    this.updateSettlerMissions(entities, match, dt);
    this.tickRng = null;
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

  /**
   * Reserve citizens + materials for a Settler Group (caravan — no map workers).
   */
  public formSettlerGroup(
    playerId: string,
    entities: Entity[],
    factionId: FactionId,
  ): SettlerGroup | null {
    if (!this.canFormSettlerGroup(playerId, factionId)) return null;
    const s = this.primaryFor(playerId)!;
    const d = doctrineOf(factionId);
    void entities;

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
      unitIds: [],
      targetX: null,
      targetY: null,
      status: 'ready',
      caravanX: s.centerX,
      caravanY: s.centerY,
      caravanSpeed: SETTLER_CARAVAN_SPEED,
    };
    this.transitCitizens.set(
      group.id,
      citizens.map((c) => {
        c.settlementId = group.id;
        return c;
      }),
    );
    this.settlerGroups.push(group);
    s.population = s.citizens.length;
    return group;
  }

  private transitCitizens = new Map<string, import('./Population/Types').Citizen[]>();

  /** Player order: Found Settlement Here — caravan marches to the site. */
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
    // Legacy escort units (old saves) still march.
    for (const e of entities) {
      if (!(e instanceof Unit) || e.settlerGroupId !== group.id) continue;
      e.moveCommand(x, y);
    }
    return true;
  }

  /**
   * Establish an Outpost near friendly army presence — GameCommands path.
   * Requires combat units nearby, min distance from TC, not deep in enemy solid control.
   */
  public establishOutpost(
    playerId: string,
    x: number,
    y: number,
    entities: Entity[],
    match: MatchState,
    gameMap: GameMap,
    influence?: InfluenceMap,
  ): boolean {
    const player = match.getPlayer(playerId);
    const s = this.primaryFor(playerId);
    if (!player || !s || !s.hasTownCenter) return false;
    if (!isBuildingAllowed(s.tier, 'Outpost')) return false;
    if (!s.canAfford(OUTPOST_COST)) return false;

    const distTc = Math.hypot(x - s.centerX, y - s.centerY);
    if (distTc < OUTPOST_MIN_DIST_FROM_TC) return false;
    if (distTc > s.expansionRadius * 2.8 + 280) return false;

    const faction = FACTIONS[player.factionId];
    let armyNear = 0;
    for (const e of entities) {
      if (!(e instanceof Unit) || e.isDead || e.ownerPlayerId !== playerId) continue;
      if (e.unitType !== faction.meleeType && e.unitType !== faction.rangedType) continue;
      if (Math.hypot(e.x - x, e.y - y) <= OUTPOST_MAX_DIST_FROM_ARMY) armyNear += 1;
    }
    if (armyNear < 1) return false;

    for (const e of entities) {
      if (!(e instanceof Building) || e.isDead) continue;
      if (!isOutpostBuilding(e.buildingType)) continue;
      if (e.ownerPlayerId !== playerId) continue;
      if (Math.hypot(e.x - x, e.y - y) < OUTPOST_MIN_DIST_BETWEEN) return false;
    }

    if (influence) {
      const ctrl = influence.getControlAt(x, y);
      if (ctrl !== 'none' && ctrl !== 'contested' && ctrl !== player.factionId) {
        // Deep enemy solid control — reject
        const enemyInf = influence.getFactionInfluenceAt(x, y, ctrl);
        const ownInf = influence.getFactionInfluenceAt(x, y, player.factionId);
        if (enemyInf > ownInf * 1.6 && enemyInf > 40) return false;
      }
    }

    if (!canPlaceBuildingAt(x, y, gameMap, entities, footprintForBuildingType('Outpost', player.factionId))) {
      return false;
    }
    if (!s.spendMaterials(OUTPOST_COST)) return false;
    player.gold = s.gold;

    const building = new Building(x, y, 'Outpost', player, false);
    building.settlementId = s.id;
    entities.push(building);
    s.buildCooldown = 2;
    return true;
  }

  /** Snapshot settler groups for save. */
  public exportSettlerGroups(): SettlerGroup[] {
    return this.settlerGroups.map((g) => ({
      ...g,
      citizenIds: [...g.citizenIds],
      unitIds: [...g.unitIds],
    }));
  }

  public exportTransitCitizens(): Array<{ groupId: string; citizens: Citizen[] }> {
    return [...this.transitCitizens.entries()].map(([groupId, citizens]) => ({
      groupId,
      citizens: citizens.map((c) => ({ ...c, traits: [...c.traits] })),
    }));
  }

  public hydrateSettlerMissions(
    groups: SettlerGroup[],
    transit?: Array<{ groupId: string; citizens: Citizen[] }>,
  ) {
    this.settlerGroups = groups.map((g) => ({
      ...g,
      citizenIds: [...g.citizenIds],
      unitIds: [...g.unitIds],
      caravanX: g.caravanX ?? 0,
      caravanY: g.caravanY ?? 0,
      caravanSpeed: g.caravanSpeed ?? SETTLER_CARAVAN_SPEED,
    }));
    this.transitCitizens.clear();
    if (transit) {
      for (const row of transit) {
        this.transitCitizens.set(
          row.groupId,
          row.citizens.map((c) => ({ ...c, traits: [...c.traits] })),
        );
      }
    }
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

  /**
   * Draft `count` citizens near a world point for recruitment.
   * @returns settlement id on success, null if pool too small / no seat.
   */
  public draftForRecruitment(
    playerId: string,
    nearX: number,
    nearY: number,
    count: number,
  ): string | null {
    const s = this.nearestSettlement(playerId, nearX, nearY);
    if (!s || !s.hasTownCenter) return null;
    if (!populationSim.draftCitizens(s, count)) return null;
    return s.id;
  }

  /** Combat death feedback on the nearest owned settlement. */
  public noteMilitaryCasualty(unit: Unit) {
    if (!unit.ownerPlayerId) return;
    const s =
      (unit.draftedFromSettlementId
        ? this.settlements.get(unit.draftedFromSettlementId)
        : undefined) ?? this.nearestSettlement(unit.ownerPlayerId, unit.x, unit.y);
    if (!s) return;
    populationSim.applyWarCasualty(s, unit.isHero ? 1.6 : 1);
    if (!unit.draftedFromSettlementId && s.citizens.length > 0) {
      // Legacy undrafted unit — social loss from the pool.
      populationSim.draftCitizens(s, 1);
    }
  }

  public setFocus(playerId: string, settlementId: string, focus: SettlementFocus): boolean {
    const s = this.settlements.get(settlementId);
    if (!s || s.playerId !== playerId) return false;
    s.focus = focus;
    return true;
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

  private syncFromWorld(
    s: Settlement,
    entities: Entity[],
    player: PlayerState,
    influence?: InfluenceMap,
  ) {
    s.gold = player.gold;
    s.unitCount = 0;
    s.housing = 0;
    s.houseCount = 0;
    s.farmCount = 0;
    s.storageCount = 0;
    s.outpostCount = 0;
    s.mineCount = 0;
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
        // Economy workers are no longer gameplay units — ignore for pop/army counts.
        if (e.unitType === faction.workerType) continue;
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
        if (isOutpostBuilding(e.buildingType)) {
          s.outpostCount += 1;
        }
      }
    }

    for (const e of entities) {
      if (!(e instanceof ResourceNode) || e.isDead) continue;
      if (e.linkedSettlementId === s.id) s.mineCount += 1;
    }

    s.housing += tierDef.housingBonus;
    s.population = s.citizens.length;
    const byProf = populationSim.countByProfession(s);
    s.civicLabor = byProf.builder + byProf.craftsman * 0.35 + byProf.peasant * 0.1;
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

    s.threatPressure = Math.min(1, hostilesNear * 0.22 + s.warShock * 0.55);
    let enemyTerritory = 0;
    if (influence) {
      const ctrl = influence.getControlAt(s.centerX, s.centerY);
      if (ctrl !== 'none' && ctrl !== 'contested' && ctrl !== player.factionId) {
        enemyTerritory = 0.35;
      } else if (ctrl === 'contested') {
        enemyTerritory = 0.18;
      }
    }
    s.threatPressure = Math.min(1, s.threatPressure + enemyTerritory);
    const garrison = Math.min(1, militaryWeight * 0.12);
    const soldierBonus = populationSim.countByProfession(s).soldier * 0.04;
    s.safety = Math.max(
      0,
      Math.min(1, 0.55 + garrison * 0.3 + soldierBonus - s.threatPressure * 0.7),
    );
  }

  private simulateEconomy(
    s: Settlement,
    dt: number,
    entities: Entity[],
    player: PlayerState,
    influence?: InfluenceMap,
  ) {
    const sources = emptyIncomeSources();
    sources.woodPassive = WOOD_PASSIVE * dt;
    sources.stonePassive = STONE_PASSIVE * dt;
    s.wood = clamp(s.wood + sources.woodPassive, 0, s.capacity.wood);
    s.stone = clamp(s.stone + sources.stonePassive, 0, s.capacity.stone);

    const farmMult =
      1 +
      (s.specialization === 'farming' ? 0.2 : 0) +
      (s.focus === 'growth' ? 0.08 : 0);
    sources.foodFarms = s.farmCount * FOOD_PER_FARM * farmMult * s.safety * dt;
    s.food = clamp(s.food + sources.foodFarms, 0, s.capacity.food);

    let goldGain = 0;
    const by = populationSim.countByProfession(s);
    const minerBoost = 1 + by.miner * 0.04;
    const specBoost =
      s.specialization === 'mining' ? 1.2 : s.specialization === 'trade' ? 1.08 : 1;

    for (const e of entities) {
      if (!(e instanceof ResourceNode) || e.isDead) continue;
      if (e.linkedSettlementId !== s.id) continue;
      if (e.remainingAmount <= 0) {
        e.lastExtractionRate = 0;
        continue;
      }

      const ctrl = influence?.getControlAt(e.x, e.y) ?? 'none';
      let ownership = 0;
      if (ctrl === player.factionId) ownership = 1;
      else if (ctrl === 'contested') ownership = 0.45;
      else if (ctrl === 'none') {
        // Linked outpost/settlement still grants weak access
        ownership = e.controllingFactionId === player.factionId ? 0.7 : 0.35;
      } else {
        // Enemy solid control — no income
        ownership = 0;
        e.controllingFactionId = ctrl;
        e.lastExtractionRate = 0;
        continue;
      }

      e.controllingFactionId = ownership > 0 ? player.factionId : e.controllingFactionId;

      const infra = 0.55 + Math.min(1.5, e.infrastructureLevel) * 0.45;
      const access =
        0.65 +
        Math.min(
          0.35,
          1 - Math.hypot(e.x - s.centerX, e.y - s.centerY) / (LINK_MINE_RANGE + 80),
        );
      const raidMul = e.raidDamageCooldown > 0 ? 0.15 : 1;
      const safety = clamp(e.safety * s.safety, 0.15, 1) * raidMul;

      const rate =
        GOLD_BASE_EXTRACTION * infra * safety * access * ownership * minerBoost * specBoost;
      const extracted = Math.min(e.remainingAmount, rate * dt);
      e.remainingAmount -= extracted;
      e.resourceAmount = e.remainingAmount;
      e.lastExtractionRate = rate;
      // Slow infra growth while extracting safely
      if (extracted > 0 && e.raidDamageCooldown <= 0) {
        e.infrastructureLevel = Math.min(3, e.infrastructureLevel + dt * 0.015);
      }
      goldGain += extracted;
    }

    sources.goldMines = goldGain;
    s.gold += goldGain;
    s.incomeSources = sources;
    s.incomeRates = {
      gold: dt > 0 ? goldGain / dt : 0,
      food: dt > 0 ? sources.foodFarms / dt : 0,
      wood: WOOD_PASSIVE,
      stone: STONE_PASSIVE,
    };
  }

  /** Link nearby gold deposits to owned settlements / outposts. */
  private linkResourceNodes(
    entities: Entity[],
    match: MatchState,
    influence?: InfluenceMap,
  ) {
    for (const node of entities) {
      if (!(node instanceof ResourceNode) || node.isDead) continue;

      let best: Settlement | null = null;
      let bestScore = -1;

      for (const s of this.all()) {
        const player = match.getPlayer(s.playerId);
        if (!player || player.isDefeated || !s.hasTownCenter) continue;
        const d = Math.hypot(node.x - s.centerX, node.y - s.centerY);
        if (d > LINK_MINE_RANGE) continue;
        let score = 1 - d / LINK_MINE_RANGE;
        score += s.outpostCount * 0.05;
        if (s.specialization === 'mining') score += 0.1;
        // Prefer settlements that already own influence
        if (influence) {
          const ctrl = influence.getControlAt(node.x, node.y);
          if (ctrl === player.factionId) score += 0.25;
          else if (ctrl === 'contested') score += 0.08;
        }
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }

      // Outpost proximity boosts link / infra
      for (const e of entities) {
        if (!(e instanceof Building) || e.isDead || !e.isConstructed) continue;
        if (!isOutpostBuilding(e.buildingType)) continue;
        const player = match.getPlayer(e.ownerPlayerId ?? '');
        if (!player) continue;
        const d = Math.hypot(node.x - e.x, node.y - e.y);
        if (d > 220) continue;
        const seat =
          (e.settlementId ? this.getById(e.settlementId) : null) ??
          this.nearestSettlement(player.id, e.x, e.y);
        if (!seat) continue;
        const score = 0.55 + (1 - d / 220) + (e.buildingType === 'Fort' ? 0.2 : 0.1);
        if (score > bestScore) {
          bestScore = score;
          best = seat;
        }
        if (seat.id === node.linkedSettlementId || best === seat) {
          node.infrastructureLevel = Math.max(
            node.infrastructureLevel,
            e.buildingType === 'Fort' ? 2 : 1,
          );
        }
      }

      if (best) {
        node.linkedSettlementId = best.id;
        const p = match.getPlayer(best.playerId);
        if (p) node.controllingFactionId = p.factionId;
      }
    }
  }

  /** Enemy combat near linked deposits → raid damage / safety drop. */
  private processResourceRaids(entities: Entity[], match: MatchState) {
    for (const node of entities) {
      if (!(node instanceof ResourceNode) || node.isDead) continue;
      if (!node.linkedSettlementId) continue;
      const seat = this.getById(node.linkedSettlementId);
      if (!seat) continue;
      const owner = match.getPlayer(seat.playerId);
      if (!owner) continue;

      let raiders = 0;
      for (const e of entities) {
        if (!(e instanceof Unit) || e.isDead) continue;
        if (e.ownerPlayerId === seat.playerId) continue;
        if (!e.ownerPlayerId) continue;
        const other = match.getPlayer(e.ownerPlayerId);
        if (!other || other.factionId === owner.factionId) continue;
        if (Math.hypot(e.x - node.x, e.y - node.y) > RAID_RANGE) continue;
        const f = FACTIONS[other.factionId];
        if (e.unitType !== f.meleeType && e.unitType !== f.rangedType) continue;
        raiders += 1;
      }
      if (raiders <= 0) continue;
      node.raidDamageCooldown = Math.max(node.raidDamageCooldown, 4 + raiders * 1.5);
      node.safety = Math.max(0.1, node.safety - 0.08 * raiders);
      node.infrastructureLevel = Math.max(0, node.infrastructureLevel - 0.04 * raiders);
    }
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

    const bias = focusNeedBias(s.focus);
    s.needs.housing = clamp(s.needs.housing * bias.housing, 0, 1);
    s.needs.food = clamp(s.needs.food * bias.food, 0, 1);
    s.needs.storage = clamp(s.needs.storage * bias.storage, 0, 1);
    s.needs.defense = clamp(s.needs.defense * bias.defense, 0, 1);
  }

  private deriveCivicStats(s: Settlement, factionId: FactionId, entities: Entity[]) {
    const d = doctrineOf(factionId);
    const by = populationSim.countByProfession(s);
    const n = Math.max(1, s.citizens.length);
    const wantFarmers = Math.ceil(n * (0.15 + s.needs.food * 0.25) * d.farmerBias);
    const wantBuilders = Math.ceil(
      n * (s.needs.housing > 0.3 ? 0.12 : 0.06) * d.builderBias,
    );
    const craftBias =
      d.craftsmanBias * (s.focus === 'crafting' ? 1.35 : s.focus === 'military' ? 0.85 : 1);
    const wantCraft = Math.ceil(n * 0.08 * craftBias);
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
        by.craftsman * 0.015 * d.craftProsperityBias -
        s.warShock * 0.15,
      0,
      1,
    );
    s.culture = clamp(0.2 + s.houseCount * 0.08 + s.prosperity * 0.3, 0, 1);
    s.knowledge = clamp(
      0.2 + s.prosperity * 0.2 + by.craftsman * 0.03 + (s.focus === 'crafting' ? 0.08 : 0),
      0,
      1,
    );
    s.faith = clamp(0.25 + s.safety * 0.25 + s.houseCount * 0.04, 0, 1);
    s.craftsmanship = clamp(
      0.2 +
        by.craftsman * 0.05 * d.craftProsperityBias +
        s.knowledge * 0.25 +
        (s.focus === 'crafting' ? 0.12 : 0) +
        (s.specialization === 'crafting' ? 0.1 : 0),
      0,
      1,
    );
    s.militaryTradition = clamp(
      s.militaryTradition * 0.998 +
        by.soldier * 0.002 +
        (s.focus === 'military' ? 0.0015 : 0) +
        (s.specialization === 'fortress' ? 0.001 : 0),
      0,
      1,
    );

    const foodScore = clamp(s.food / 40, 0, 1.2);
    const housingScore =
      s.housing > 0 ? clamp(1 - s.population / Math.max(1, s.housing), 0, 1) : 0;
    const expansionPush =
      (s.tier === 'city' ? 0.08 : 0) *
      (s.prosperity > 0.45 ? 1 : 0.5);

    s.migrationAttraction = clamp(
      foodScore * 0.22 +
        housingScore * 0.22 +
        s.safety * 0.2 +
        s.prosperity * 0.18 +
        s.jobs * 0.18 +
        TIER_DEFS[s.tier].migrationBonus -
        expansionPush -
        s.warShock * 0.25,
      0,
      1,
    );

    s.influence = clamp(
      s.prosperity * 0.3 +
        s.militaryTradition * 0.25 * d.influenceMilitaryWeight +
        s.culture * 0.25 +
        s.gold / 1000 +
        s.craftsmanship * 0.1 * d.craftProsperityBias +
        (s.specialization === 'fortress' ? 0.08 : 0),
      0,
      1,
    );

    s.specialization = this.detectSpecialization(s, entities);
  }

  private detectSpecialization(s: Settlement, entities: Entity[]): SettlementSpecialization {
    let hasSmith = false;
    let hasFort = false;
    let hasTemple = false;
    let hasMarket = false;
    for (const e of entities) {
      if (!(e instanceof Building) || e.isDead || e.settlementId !== s.id) continue;
      if (e.buildingType === 'Blacksmith') hasSmith = true;
      if (e.buildingType === 'Fort' || e.buildingType === 'Wall') hasFort = true;
      if (e.buildingType === 'Temple') hasTemple = true;
      if (e.buildingType === 'Market') hasMarket = true;
    }
    if (hasSmith && s.craftsmanship > 0.45 && s.iron > 20) return 'crafting';
    if (hasFort && s.militaryTradition > 0.4) return 'fortress';
    if (hasTemple && s.faith > 0.55) return 'religious';
    if (hasMarket && s.prosperity > 0.5) return 'trade';
    if (s.farmCount >= 3 && s.farmCount > s.houseCount) return 'farming';
    if (s.iron > 80 && s.stone > 80) return 'mining';
    return 'none';
  }

  private refreshFeedbackHints(s: Settlement, factionId: FactionId) {
    void factionId;
    const growth: string[] = [];
    if (s.housing > 0 && s.population >= s.housing) growth.push('Housing shortage');
    if (s.food < 12) growth.push('Low food');
    if (s.threatPressure > 0.35) growth.push('Enemy army nearby');
    if (s.warShock > 0.2) growth.push('Recent war losses');
    if (s.focus === 'growth') growth.push('Focus: Growth');
    s.growthHints = growth.slice(0, 3);

    const safety: string[] = [];
    if (s.threatPressure > 0.4) safety.push('Hostiles nearby');
    if (s.warShock > 0.25) safety.push('War shock');
    if (s.needs.defense > 0.45) safety.push('Needs fortifications');
    if (s.unitCount < 3) safety.push('Thin garrison');
    s.safetyHints = safety.slice(0, 3);
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
        (roadChance >= 1 || (this.tickRng?.chance(roadChance * 0.35) ?? false))
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
      this.advanceCivicConstruction(s, unfinished, dt);
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

  /** Construction progress from civic labor pool — not map Worker micro. */
  private advanceCivicConstruction(s: Settlement, building: Building, dt: number) {
    if (building.isConstructed) return;
    const labor = Math.max(0.35, s.civicLabor);
    const rate = 6 + labor * 4.5;
    building.constructionProgress += rate * dt;
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

    // Civic labor gate (builders profession / pool) — replaces idle map workers.
    if (s.civicLabor < recipe.buildersRequired * 0.55) return;

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

    if (
      site &&
      !canPlaceBuildingAt(
        site.x,
        site.y,
        gameMap,
        entities,
        footprintForBuildingType(buildingType, player.factionId),
      )
    ) {
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
      this.advanceRoadProject(s, project, gameMap, dt);
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
      this.advanceCivicConstruction(s, building, dt);
      void player;
    }
  }

  private advanceRoadProject(
    s: Settlement,
    project: ConstructionProject,
    gameMap: GameMap,
    dt: number,
  ) {
    if (project.roadIndex >= project.roadTiles.length) {
      s.queue.markDone(project.id);
      return;
    }
    // Civic labor lays road tiles over time (no Worker walk required).
    const labor = Math.max(0.4, s.civicLabor);
    s.roadWorkTimer += dt * (0.7 + labor * 0.35);
    if (s.roadWorkTimer < 1.0) return;
    s.roadWorkTimer = 0;

    const tile = project.roadTiles[project.roadIndex]!;
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

  private updateSettlerMissions(entities: Entity[], match: MatchState, dt: number) {
    for (const group of this.settlerGroups) {
      if (group.status !== 'traveling' || group.targetX == null || group.targetY == null) continue;

      const legacyEscorts = entities.filter(
        (e): e is Unit =>
          e instanceof Unit && !e.isDead && e.settlerGroupId === group.id,
      );

      // Prefer caravan motion; escorts are optional legacy.
      const dx = group.targetX - group.caravanX;
      const dy = group.targetY - group.caravanY;
      const dist = Math.hypot(dx, dy);
      if (dist > FOUNDING_ARRIVAL_DIST) {
        const step = Math.min(dist, group.caravanSpeed * dt);
        group.caravanX += (dx / dist) * step;
        group.caravanY += (dy / dist) * step;
        for (const u of legacyEscorts) {
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

      const parent = this.getById(group.parentSettlementId);
      if (parent) {
        const takeFood = Math.min(20, parent.food * 0.2);
        parent.food -= takeFood;
        camp.food += takeFood;
      }

      for (const u of legacyEscorts) {
        u.settlerGroupId = null;
        const jitter = this.tickRng ? this.tickRng.range(-20, 20) : 0;
        u.moveCommand(group.targetX + jitter, group.targetY + 30);
      }

      group.status = 'complete';
      SettlementSystem.onSettlementFounded?.(group.ownerPlayerId, legacyEscorts, camp);
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
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
