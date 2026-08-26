import { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import { Building, isMainBuilding, isEconomyBuilding } from '../Entities/Building';
import { ResourceNode } from '../Entities/ResourceNode';
import type { GameMap } from '../Map/GameMap';
import { canPlaceBuildingAt } from '../Map/BuildPlacement';
import type { InfluenceMap } from '../Map/InfluenceMap';
import { MatchState, type PlayerState } from '../Players/MatchState';
import { isHostile } from '../Players/Relations';
import { FACTIONS, type FactionDefinition } from '../Players/Types';
import type { SettlementSystem } from '../Settlement/SettlementSystem';
import {
  countHostilesNear,
  gatherTacticalCandidates,
  pickBestHoldPoint,
} from '../Combat/TacticalTerrain';
import { doctrineOf } from '../Players/FactionDoctrine';
import type { SquadSystem } from '../Combat/SquadSystem';
import {
  analyzeStrategicSituation,
  chooseStrategicState,
  strategicStateLabel,
  type StrategicSituation,
  type StrategicState,
} from './StrategicAI';

type TrainableUnit =
  | FactionDefinition['workerType']
  | FactionDefinition['meleeType']
  | FactionDefinition['rangedType'];

/**
 * Strategic AI for any faction seat.
 * Uses the same settlement queue, settlers, gold training, and buildings as the player.
 * Posture comes from world analysis — not fixed "spawn N every T seconds".
 */
export class AISystem {
  private state: StrategicState = 'develop';
  private stateReason = 'opening';
  private secondsInState = 0;
  private situation: StrategicSituation | null = null;

  private elapsed = 0;
  private thinkTimer = 0;
  private readonly thinkInterval = 1.15;

  private actionTimer = 0;
  private nextActionIn = 22;
  private expansionCooldown = 0;

  private guardIds = new Set<number>();
  private assaultIds = new Set<number>();
  private harassIds = new Set<number>();
  private pendingTargetId = new Map<number, number>();
  private assaultStartCount = 0;

  private match: MatchState | null = null;
  private settlements: SettlementSystem | null = null;
  private squads: SquadSystem | null = null;
  private influence: InfluenceMap | null = null;

  public readonly playerId: string;

  constructor(playerId: string) {
    this.playerId = playerId;
  }

  public update(
    dt: number,
    entities: Entity[],
    gameMap?: GameMap,
    match?: MatchState,
    settlements?: SettlementSystem,
    squads?: SquadSystem,
    influence?: InfluenceMap,
  ) {
    this.match = match ?? MatchState.current;
    this.settlements = settlements ?? null;
    this.squads = squads ?? null;
    this.influence = influence ?? null;
    if (!this.match || !this.getPlayer() || !this.settlements) return;

    this.elapsed += dt;
    this.thinkTimer += dt;
    this.actionTimer += dt;
    this.secondsInState += dt;
    if (this.expansionCooldown > 0) this.expansionCooldown -= dt;

    this.cleanupRoles(entities);
    this.defendBase(entities, gameMap);
    this.fleePeons(entities);
    this.advanceWaypoints(entities);

    if (this.thinkTimer >= this.thinkInterval) {
      this.thinkTimer = 0;
      this.reassess(entities, gameMap);
      this.manageWorkers(entities);
      this.manageConstruction(entities);
      this.manageTraining(entities);
      this.tryExpandSettlement(entities, gameMap);
      this.positionGuards(entities, gameMap);
      this.checkRetreat(entities, gameMap);
    }

    if (this.actionTimer >= this.nextActionIn) {
      if (this.tryMilitaryAction(entities, gameMap)) {
        this.actionTimer = 0;
        this.nextActionIn = this.scheduleNextAction();
      }
    }
  }

  private reassess(entities: Entity[], gameMap?: GameMap) {
    if (!this.match || !this.settlements) return;
    const sit = analyzeStrategicSituation({
      playerId: this.playerId,
      entities,
      match: this.match,
      settlements: this.settlements,
      gameMap,
      influence: this.influence ?? undefined,
    });
    this.situation = sit;
    if (!sit) return;

    const choice = chooseStrategicState(sit, this.state, this.secondsInState);
    if (choice.state !== this.state) {
      this.state = choice.state;
      this.stateReason = choice.reason;
      this.secondsInState = 0;
      this.nextActionIn = Math.min(this.nextActionIn, this.scheduleNextAction() * 0.5);
    } else {
      this.stateReason = choice.reason;
    }
  }

  private getPlayer(): PlayerState | undefined {
    return this.match?.getPlayer(this.playerId);
  }

  private getFaction(): FactionDefinition | undefined {
    const player = this.getPlayer();
    return player ? FACTIONS[player.factionId] : undefined;
  }

  private isOwn(e: Entity): boolean {
    return e.ownerPlayerId === this.playerId;
  }

  private isEnemy(e: Entity, relativeTo?: Entity): boolean {
    if (e instanceof ResourceNode) return false;
    if (relativeTo) return isHostile(relativeTo, e);
    return e.ownerPlayerId !== null && e.ownerPlayerId !== this.playerId;
  }

  private scheduleNextAction(): number {
    const d = doctrineOf(this.getFaction()?.id ?? 'orcs');
    const base = (() => {
      switch (this.state) {
        case 'develop':
        case 'expand':
        case 'recover':
          return 36 + Math.random() * 14;
        case 'fortify':
          return 28 + Math.random() * 10;
        case 'defend':
          return 16 + Math.random() * 8;
        case 'raid':
          return 22 + Math.random() * 10;
        case 'attack':
          return 14 + Math.random() * 8;
      }
    })();
    return base * d.aiActionIntervalMul;
  }

  private getGold(): number {
    return this.getPlayer()?.gold ?? 0;
  }

  private trySpend(amount: number): boolean {
    return this.match?.trySpend(this.playerId, amount) ?? false;
  }

  private getMainBuilding(entities: Entity[]): Building | undefined {
    const faction = this.getFaction();
    if (!faction) return undefined;
    return entities.find(
      (e): e is Building =>
        e instanceof Building &&
        !e.isDead &&
        this.isOwn(e) &&
        e.buildingType === faction.mainBuilding,
    );
  }

  private getEnemyMainBuilding(entities: Entity[]): Building | undefined {
    return entities.find(
      (e): e is Building =>
        e instanceof Building && !e.isDead && this.isEnemy(e) && isMainBuilding(e.buildingType),
    );
  }

  private getMilitary(entities: Entity[]): Unit[] {
    const faction = this.getFaction();
    if (!faction) return [];
    return entities.filter(
      (e): e is Unit =>
        e instanceof Unit &&
        !e.isDead &&
        this.isOwn(e) &&
        (e.unitType === faction.meleeType || e.unitType === faction.rangedType),
    );
  }

  private getWorkers(entities: Entity[]): Unit[] {
    const faction = this.getFaction();
    if (!faction) return [];
    return entities.filter(
      (e): e is Unit =>
        e instanceof Unit && !e.isDead && this.isOwn(e) && e.unitType === faction.workerType,
    );
  }

  private cleanupRoles(entities: Entity[]) {
    const alive = new Set(entities.filter((e) => !e.isDead).map((e) => e.id));
    for (const set of [this.guardIds, this.assaultIds, this.harassIds]) {
      for (const id of [...set]) {
        if (!alive.has(id)) set.delete(id);
      }
    }
    for (const id of [...this.pendingTargetId.keys()]) {
      if (!alive.has(id)) this.pendingTargetId.delete(id);
    }
  }

  // --- Economy (same tools as the player) --------------------------------

  private manageWorkers(entities: Entity[]) {
    const main = this.getMainBuilding(entities);
    if (!main) return;

    const mines = this.findMinesNear(entities, main, this.state === 'develop' ? 3 : 2);
    if (mines.length === 0) return;

    const workers = this.getWorkers(entities);
    const builders = workers.filter((p) => p.buildTarget).length;
    const reserveBuilders =
      this.state === 'develop' || this.state === 'fortify' || this.state === 'recover' ? 2 : 1;

    let mineIndex = 0;
    for (const worker of workers) {
      if (worker.buildTarget || worker.targetEntity) continue;
      if (
        builders < reserveBuilders &&
        !worker.gatherTarget &&
        workers.indexOf(worker) < reserveBuilders
      ) {
        continue;
      }
      if (worker.gatherTarget) continue;
      if (worker.targetX !== null) continue;

      const mine = mines[mineIndex % mines.length]!;
      mineIndex++;
      worker.gatherCommand(mine);
    }
  }

  private findMinesNear(entities: Entity[], main: Building, count: number): ResourceNode[] {
    const mines = entities
      .filter((e): e is ResourceNode => e instanceof ResourceNode && !e.isDead)
      .map((m) => ({ m, dist: Math.hypot(m.x - main.x, m.y - main.y) }))
      .sort((a, b) => a.dist - b.dist);

    const result: ResourceNode[] = [];
    for (const entry of mines) {
      if (result.length >= count) break;
      if (result.length === 0 || entry.dist < 900) result.push(entry.m);
    }
    return result;
  }

  private fleePeons(entities: Entity[]) {
    const main = this.getMainBuilding(entities);
    if (!main) return;

    for (const worker of this.getWorkers(entities)) {
      let threatNear = false;
      for (const e of entities) {
        if (e.isDead || !(e instanceof Unit) || !this.isEnemy(e, worker)) continue;
        if (Math.hypot(e.x - worker.x, e.y - worker.y) < 200) {
          threatNear = true;
          break;
        }
      }
      if (!threatNear) continue;

      const distHome = Math.hypot(worker.x - main.x, worker.y - main.y);
      if (distHome < 90) {
        worker.gatherTarget = null;
        worker.buildTarget = null;
        continue;
      }

      if (
        worker.targetX !== null &&
        Math.hypot(worker.targetX - main.x, worker.targetY! - main.y) < 80
      ) {
        continue;
      }

      worker.gatherTarget = null;
      worker.buildTarget = null;
      worker.moveCommand(main.x + 40, main.y + 40);
    }
  }

  private manageConstruction(entities: Entity[]) {
    const faction = this.getFaction();
    const player = this.getPlayer();
    const main = this.getMainBuilding(entities);
    const sit = this.situation;
    if (!faction || !player || !main || !sit) return;

    const unfinished = entities.find(
      (e): e is Building =>
        e instanceof Building && this.isOwn(e) && !e.isDead && !e.isConstructed,
    );
    if (unfinished) {
      this.assignBuilders(entities, unfinished);
      return;
    }

    const settlement = this.settlements?.get(this.playerId);
    if (!settlement?.hasTownCenter) return;

    // Production — needed for any military posture; still player-queue rules.
    if (
      !sit.hasProduction &&
      this.getGold() >= 100 &&
      sit.unitPop >= Math.min(4, Math.max(2, sit.unitMaxPop * 0.4))
    ) {
      this.settlements?.enqueueStrategic(this.playerId, faction.productionBuilding);
      return;
    }

    if (!sit.hasProduction) return;
    const d = doctrineOf(player.factionId);

    // Fortify / Defend: walls & forts via the same strategic catalog as the player.
    if (
      (this.state === 'fortify' || this.state === 'defend') &&
      this.getGold() >= 15 &&
      settlement.population >= 3
    ) {
      if (
        !settlement.queue.hasQueuedOrBuilding('Wall') &&
        (sit.primaryBridgeContested || sit.safety < 0.55 || this.state === 'fortify')
      ) {
        this.settlements?.enqueueStrategic(this.playerId, 'Wall');
        return;
      }
      if (
        this.getGold() >= 120 &&
        settlement.population >= 6 &&
        !settlement.queue.hasQueuedOrBuilding('Fort') &&
        !entities.some(
          (e) =>
            e instanceof Building && e.buildingType === 'Fort' && !e.isDead && this.isOwn(e),
        )
      ) {
        this.settlements?.enqueueStrategic(this.playerId, 'Fort');
        return;
      }
    }

    // Develop / Recover / Fortify: infrastructure & crafting (doctrine-weighted).
    if (
      (this.state === 'develop' || this.state === 'recover' || this.state === 'fortify') &&
      d.craftProsperityBias >= 1.05
    ) {
      if (
        this.getGold() >= 80 &&
        settlement.population >= 5 &&
        !settlement.queue.hasQueuedOrBuilding('Blacksmith') &&
        !entities.some(
          (e) =>
            e instanceof Building &&
            e.buildingType === 'Blacksmith' &&
            !e.isDead &&
            this.isOwn(e),
        )
      ) {
        this.settlements?.enqueueStrategic(this.playerId, 'Blacksmith');
        return;
      }
      if (
        this.getGold() >= 70 &&
        settlement.population >= 4 &&
        !settlement.queue.hasQueuedOrBuilding('Market') &&
        !entities.some(
          (e) =>
            e instanceof Building && e.buildingType === 'Market' && !e.isDead && this.isOwn(e),
        )
      ) {
        this.settlements?.enqueueStrategic(this.playerId, 'Market');
        return;
      }
    }

    // Temple when recovering morale / culture gap
    if (
      this.state === 'recover' &&
      this.getGold() >= 90 &&
      settlement.population >= 5 &&
      !settlement.queue.hasQueuedOrBuilding('Temple')
    ) {
      this.settlements?.enqueueStrategic(this.playerId, 'Temple');
    }
  }

  private tryExpandSettlement(entities: Entity[], gameMap?: GameMap) {
    if (!gameMap || !this.settlements || this.expansionCooldown > 0) return;
    if (this.state === 'defend' || this.state === 'recover') return;
    if (this.state !== 'expand' && this.state !== 'develop') return;

    const player = this.getPlayer();
    const sit = this.situation;
    if (!player || !sit) return;

    // Expand state: push when possible. Develop: only when clearly crowded.
    if (this.state === 'develop' && sit.expansionCrowding < 0.55) return;
    if (this.state === 'expand' && sit.expansionCrowding < 0.2 && sit.settlementCount >= 2) return;

    const d = doctrineOf(player.factionId);
    const owned = this.settlements.allForOwner(this.playerId);
    const maxSeats = d.expansionPressure > 1.1 ? 3 : 2;
    if (owned.length >= maxSeats) return;

    const primary = this.settlements.get(this.playerId);
    if (!primary?.hasTownCenter) return;
    if (!this.settlements.canFormSettlerGroup(this.playerId, player.factionId)) return;

    const site = this.pickExpansionSite(
      entities,
      gameMap,
      primary.centerX,
      primary.centerY,
      d.expansionPressure,
    );
    if (!site) return;

    const ok = this.settlements.orderFoundSettlement(
      this.playerId,
      site.x,
      site.y,
      entities,
      player.factionId,
    );
    if (ok) {
      this.expansionCooldown = 75 / Math.max(0.5, d.expansionPressure);
      const s = this.settlements.get(this.playerId);
      if (s) player.gold = s.gold;
    }
  }

  private pickExpansionSite(
    entities: Entity[],
    gameMap: GameMap,
    cx: number,
    cy: number,
    pressure: number,
  ): { x: number; y: number } | null {
    const enemyMain = this.getEnemyMainBuilding(entities);
    const preferTowardEnemy = pressure > 1 && this.state === 'expand';
    const baseAngle = enemyMain
      ? Math.atan2(enemyMain.y - cy, enemyMain.x - cx)
      : Math.random() * Math.PI * 2;
    const dist = preferTowardEnemy ? 280 + Math.random() * 120 : 220 + Math.random() * 160;

    for (let i = 0; i < 12; i++) {
      const a = preferTowardEnemy
        ? baseAngle + (Math.random() - 0.5) * 0.9
        : baseAngle + (i / 12) * Math.PI * 2;
      const x = cx + Math.cos(a) * dist;
      const y = cy + Math.sin(a) * (dist * 0.85);
      if (!canPlaceBuildingAt(x, y, gameMap, entities, 40)) continue;
      if (enemyMain && Math.hypot(x - enemyMain.x, y - enemyMain.y) < 220) continue;
      return { x, y };
    }
    return null;
  }

  private applyPreferredFormation(units: Unit[]) {
    if (!this.squads || units.length === 0) return;
    const player = this.getPlayer();
    if (!player) return;
    const formation = doctrineOf(player.factionId).preferredCombatFormation;
    const seen = new Set<string>();
    for (const u of units) {
      const squad = this.squads.getForUnit(u);
      if (!squad || seen.has(squad.id)) continue;
      seen.add(squad.id);
      this.squads.setFormation(squad, formation);
    }
  }

  private assignBuilders(entities: Entity[], building: Building) {
    const workers = this.getWorkers(entities);
    let assigned = 0;
    for (const worker of workers) {
      if (assigned >= 2) break;
      if (worker.buildTarget === building) {
        assigned++;
        continue;
      }
      if (worker.buildTarget || worker.targetEntity) continue;
      worker.buildCommand(building);
      assigned++;
    }
  }

  /**
   * Train to close gaps vs situation — workers when developing, military when threatened.
   * Costs go through MatchState.trySpend (same as the local player).
   */
  private manageTraining(entities: Entity[]) {
    const faction = this.getFaction();
    const main = this.getMainBuilding(entities);
    const sit = this.situation;
    if (!faction || !main || !sit) return;
    if (sit.unitPop >= sit.unitMaxPop) return;

    const workers = this.getWorkers(entities).length;
    const military = this.getMilitary(entities);
    const workerTarget = this.desiredWorkers(sit);
    const militaryTarget = this.desiredMilitary(sit);

    const needWorkers =
      workers < workerTarget &&
      (this.state === 'develop' ||
        this.state === 'expand' ||
        this.state === 'recover' ||
        workers < 3);

    if (needWorkers && this.getGold() >= 50) {
      this.spawnUnit(entities, main, faction.workerType, 50);
      return;
    }

    const barracks = entities.find(
      (e): e is Building =>
        e instanceof Building &&
        e.buildingType === faction.productionBuilding &&
        e.isConstructed &&
        !e.isDead &&
        this.isOwn(e),
    );
    if (!barracks) return;
    if (military.length >= militaryTarget || this.getGold() < 80) return;
    if (this.state === 'develop' && military.length >= Math.max(2, militaryTarget - 2)) return;

    const preferRanged = this.shouldTrainRanged(entities, faction, military);
    if (preferRanged && this.getGold() >= 100) {
      this.spawnUnit(entities, barracks, faction.rangedType, 100);
    } else {
      this.spawnUnit(entities, barracks, faction.meleeType, 80);
    }
  }

  private desiredWorkers(sit: StrategicSituation): number {
    let n = 4;
    if (sit.nearbyMineCount >= 2) n += 1;
    if (sit.topNeed === 'food' || sit.topNeed === 'housing') n += 1;
    if (this.state === 'develop' || this.state === 'expand') n += 1;
    if (this.state === 'recover') n += 2;
    if (sit.unfinishedBuilds > 0) n += 1;
    return Math.min(8, n);
  }

  private desiredMilitary(sit: StrategicSituation): number {
    const d = doctrineOf(this.getPlayer()?.factionId ?? 'orcs');
    let n = Math.ceil(2 + sit.enemyArmyCount * 0.65);
    switch (this.state) {
      case 'develop':
        n = Math.max(2, Math.ceil(sit.enemyArmyCount * 0.4));
        break;
      case 'expand':
        n = Math.max(3, Math.ceil(sit.enemyArmyCount * 0.55));
        break;
      case 'recover':
        n = Math.max(3, Math.ceil(sit.enemyArmyCount * 0.7));
        break;
      case 'fortify':
      case 'defend':
        n = Math.max(5, Math.ceil(sit.enemyArmyCount * 0.9 + 2));
        break;
      case 'raid':
        n = Math.max(4, Math.ceil(sit.enemyArmyCount * 0.75 + 1));
        break;
      case 'attack':
        n = Math.max(6, Math.ceil(sit.enemyArmyCount * 1.05 + 2));
        break;
    }
    return Math.ceil(n / d.militaryTrainGoldMul);
  }

  private shouldTrainRanged(
    entities: Entity[],
    faction: FactionDefinition,
    military: Unit[],
  ): boolean {
    const enemyRanged = entities.filter(
      (e) =>
        e instanceof Unit &&
        !e.isDead &&
        this.isEnemy(e) &&
        (e.unitType === 'Archer' || e.unitType === 'SpearOrc'),
    ).length;
    const enemyMelee = entities.filter(
      (e) =>
        e instanceof Unit &&
        !e.isDead &&
        this.isEnemy(e) &&
        (e.unitType === 'Swordsman' ||
          e.unitType === 'Grunt' ||
          e.unitType === 'Worker' ||
          e.unitType === 'Peon'),
    ).length;
    const ranged = military.filter((u) => u.unitType === faction.rangedType).length;
    const melee = military.filter((u) => u.unitType === faction.meleeType).length;
    let prefer = ranged < melee / 2 || enemyMelee > enemyRanged + 1;
    if (enemyRanged > enemyMelee) prefer = false;
    return prefer;
  }

  private spawnUnit(
    entities: Entity[],
    building: Building,
    type: TrainableUnit,
    cost: number,
  ) {
    const player = this.getPlayer();
    if (!player) return;
    const faction = this.getFaction();
    const d = doctrineOf(player.factionId);
    const isMilitary =
      !!faction && (type === faction.meleeType || type === faction.rangedType);
    const paid = Math.floor(cost * (isMilitary ? d.militaryTrainGoldMul : 1));
    if (!this.trySpend(paid)) return;

    const options = this.unitOptions(type);
    const angle = Math.random() * Math.PI * 2;
    const dist = 55 + Math.random() * 25;
    entities.push(
      new Unit(
        building.x + Math.cos(angle) * dist,
        building.y + Math.sin(angle) * dist,
        player,
        options,
      ),
    );
  }

  private unitOptions(type: TrainableUnit) {
    switch (type) {
      case 'Worker':
      case 'Peon':
        return { hp: 40, speed: 70, unitType: type, damage: 3, range: 25 };
      case 'Swordsman':
        return { hp: 100, speed: 60, unitType: type, damage: 15, range: 25 };
      case 'Grunt':
        return { hp: 130, speed: 52, unitType: type, damage: 18, range: 28 };
      case 'Archer':
        return { hp: 60, speed: 60, unitType: type, damage: 10, range: 150 };
      case 'SpearOrc':
        return { hp: 80, speed: 56, unitType: type, damage: 11, range: 120 };
    }
  }

  // --- Defense -----------------------------------------------------------

  private findThreatsNear(
    entities: Entity[],
    x: number,
    y: number,
    radius: number,
    relativeTo?: Entity,
  ): Entity[] {
    const r2 = radius * radius;
    const threats: Entity[] = [];
    for (const e of entities) {
      if (e.isDead || !this.isEnemy(e, relativeTo)) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy < r2) threats.push(e);
    }
    return threats;
  }

  private defendBase(entities: Entity[], gameMap?: GameMap) {
    const main = this.getMainBuilding(entities);
    if (!main) return;

    const urgent = this.state === 'defend' || this.state === 'fortify';
    const radius = urgent || this.getMilitary(entities).length < 5 ? 520 : 420;
    const threats = this.findThreatsNear(entities, main.x, main.y, radius, main);
    if (threats.length === 0) return;

    for (const unit of this.getMilitary(entities)) {
      if (this.state === 'defend' && (this.assaultIds.has(unit.id) || this.harassIds.has(unit.id))) {
        this.assaultIds.delete(unit.id);
        this.harassIds.delete(unit.id);
        this.guardIds.add(unit.id);
        this.pendingTargetId.delete(unit.id);
      }

      if (unit.targetEntity instanceof Unit && !unit.targetEntity.isDead) continue;

      let closest: Entity | null = null;
      let closestDist = Infinity;
      for (const threat of threats) {
        const dist = Math.hypot(threat.x - unit.x, threat.y - unit.y);
        if (dist < closestDist) {
          closestDist = dist;
          closest = threat;
        }
      }
      if (closest) {
        unit.attackCommand(closest);
        this.guardIds.add(unit.id);
      }
    }

    void gameMap;
  }

  private positionGuards(entities: Entity[], gameMap?: GameMap) {
    if (!gameMap) return;
    const main = this.getMainBuilding(entities);
    if (!main) return;

    const enemyMain = this.getEnemyMainBuilding(entities);
    const bridge = enemyMain
      ? gameMap.findBridgeToward(main.x, main.y, enemyMain.x, enemyMain.y)
      : gameMap.findBridgeCenters()[0] ?? null;
    if (!bridge) return;

    const d = doctrineOf(this.getFaction()?.id ?? 'orcs');
    const sit = this.situation;
    let desiredGuards = 1 + d.aiGuardCountBonus;
    if (this.state === 'defend') desiredGuards = 4 + d.aiGuardCountBonus;
    else if (this.state === 'fortify') desiredGuards = 3 + d.aiGuardCountBonus;
    else if (this.state === 'recover') desiredGuards = 2 + d.aiGuardCountBonus;
    else if (sit?.primaryBridgeContested) desiredGuards = 3 + d.aiGuardCountBonus;

    const military = this.getMilitary(entities);
    let guards = military.filter((u) => this.guardIds.has(u.id));

    while (guards.length < desiredGuards) {
      const candidate = military.find(
        (u) =>
          !this.guardIds.has(u.id) &&
          !this.assaultIds.has(u.id) &&
          !this.harassIds.has(u.id),
      );
      if (!candidate) break;
      this.guardIds.add(candidate.id);
      guards = military.filter((u) => this.guardIds.has(u.id));
    }

    for (const guard of guards) {
      if (guard.targetEntity && !guard.targetEntity.isDead) continue;

      const ox = main.x - bridge.x;
      const oy = main.y - bridge.y;
      const len = Math.hypot(ox, oy) || 1;
      const homeSide = {
        x: bridge.x + (ox / len) * 55,
        y: bridge.y + (oy / len) * 55,
      };
      const candidates = [
        homeSide,
        bridge,
        ...gatherTacticalCandidates(gameMap, bridge.x, bridge.y, 160),
      ];
      const enemies = countHostilesNear(entities, guard, bridge.x, bridge.y, 200);
      const best = pickBestHoldPoint(gameMap, candidates, {
        isRanged: guard.isRanged,
        enemiesNearby: enemies,
      });
      const stand = best ?? homeSide;
      if (Math.hypot(guard.x - stand.x, guard.y - stand.y) > 70) {
        guard.moveCommand(stand.x, stand.y);
      }
    }
  }

  // --- Offense (only when posture asks for it) ---------------------------

  private tryMilitaryAction(entities: Entity[], gameMap?: GameMap): boolean {
    if (
      this.state === 'develop' ||
      this.state === 'expand' ||
      this.state === 'recover' ||
      this.state === 'fortify'
    ) {
      return false;
    }

    const military = this.getMilitary(entities);
    const free = military.filter((u) => !this.guardIds.has(u.id));
    const sit = this.situation;

    if (this.state === 'defend') {
      // Light counter-raid only when we still have spare force at home.
      if ((sit?.threatNearBase ?? 0) > 2) return false;
      return this.launchHarass(entities, free, gameMap, 2);
    }

    if (this.state === 'raid') {
      const size = sit && sit.armyRatio >= 1.0 ? 3 : 2;
      if (free.length >= 4 && Math.random() < (sit?.doctrineHarass ?? 0.5) * 0.35) {
        return this.launchAssault(entities, free, gameMap, false);
      }
      return this.launchHarass(entities, free, gameMap, size);
    }

    // attack
    return this.launchAssault(entities, free, gameMap, (sit?.armyRatio ?? 0) >= 1.25);
  }

  private launchHarass(
    entities: Entity[],
    free: Unit[],
    gameMap: GameMap | undefined,
    count: number,
  ): boolean {
    const faction = this.getFaction();
    if (!faction || free.length < count) return false;

    const target = this.pickHarassTarget(entities);
    if (!target) return false;

    const squad = free.slice(0, count);
    const enemyMain = this.getEnemyMainBuilding(entities);
    const main = this.getMainBuilding(entities);
    this.applyPreferredFormation(squad);

    let waypoint: { x: number; y: number } | null = null;
    if (gameMap && main && enemyMain) {
      const primary = gameMap.findBridgeToward(main.x, main.y, enemyMain.x, enemyMain.y);
      waypoint = gameMap.findAlternateBridge(primary) ?? primary;
    }

    for (const unit of squad) {
      this.harassIds.add(unit.id);
      this.assaultIds.delete(unit.id);
      this.guardIds.delete(unit.id);

      if (unit.unitType === faction.rangedType && gameMap) {
        const enemies = countHostilesNear(entities, unit, target.x, target.y, 300);
        const candidates = gatherTacticalCandidates(gameMap, target.x, target.y, 280);
        const best = pickBestHoldPoint(gameMap, candidates, {
          isRanged: true,
          enemiesNearby: enemies,
        });
        if (best && best.assessment.total >= 8) {
          unit.moveCommand(best.x, best.y);
          this.pendingTargetId.set(unit.id, target.id);
          continue;
        }
      }

      if (waypoint && Math.hypot(unit.x - target.x, unit.y - target.y) > 400) {
        let dest = waypoint;
        if (gameMap) {
          const opts = [waypoint];
          const alt = gameMap.findAlternateBridge(waypoint);
          if (alt) opts.push(alt);
          const scored = pickBestHoldPoint(gameMap, opts, { enemiesNearby: 2 });
          if (scored) dest = scored;
        }
        unit.moveCommand(dest.x, dest.y);
        this.pendingTargetId.set(unit.id, target.id);
      } else {
        unit.attackCommand(target);
        this.pendingTargetId.delete(unit.id);
      }
    }

    this.assaultStartCount = Math.max(this.assaultStartCount, squad.length);
    return true;
  }

  private launchAssault(
    entities: Entity[],
    free: Unit[],
    gameMap: GameMap | undefined,
    allIn: boolean,
  ): boolean {
    const faction = this.getFaction();
    if (!faction) return false;

    const minSize = allIn ? 5 : 4;
    if (free.length < minSize) return false;

    const target = this.pickSiegeTarget(entities);
    if (!target) return false;

    const keep = allIn ? 1 : Math.min(2, Math.floor(free.length / 4));
    const squad = free.slice(keep);
    if (squad.length < minSize) return false;

    this.applyPreferredFormation(squad);

    const main = this.getMainBuilding(entities);
    const bridge =
      gameMap && main
        ? gameMap.findBridgeToward(main.x, main.y, target.x, target.y)
        : null;

    let waypoint = bridge;
    if (bridge && gameMap && this.isBridgeContested(entities, bridge)) {
      waypoint = gameMap.findAlternateBridge(bridge) ?? bridge;
    }

    for (const unit of squad) {
      this.assaultIds.add(unit.id);
      this.harassIds.delete(unit.id);
      this.guardIds.delete(unit.id);

      if (unit.unitType === faction.rangedType && gameMap) {
        const enemies = countHostilesNear(entities, unit, target.x, target.y, 340);
        const candidates = gatherTacticalCandidates(gameMap, target.x, target.y, 320);
        const best = pickBestHoldPoint(gameMap, candidates, {
          isRanged: true,
          enemiesNearby: enemies,
        });
        if (
          best &&
          best.assessment.total >= 10 &&
          Math.hypot(unit.x - target.x, unit.y - target.y) > 220
        ) {
          unit.moveCommand(best.x, best.y);
          this.pendingTargetId.set(unit.id, target.id);
          continue;
        }
      }

      if (waypoint && Math.hypot(unit.x - target.x, unit.y - target.y) > 380) {
        let dest = waypoint;
        if (gameMap) {
          const opts = [waypoint];
          const alt = gameMap.findAlternateBridge(waypoint);
          if (alt) opts.push(alt);
          const scored = pickBestHoldPoint(gameMap, opts, {
            enemiesNearby: this.isBridgeContested(entities, waypoint) ? 4 : 1,
          });
          if (scored) dest = scored;
        }
        unit.moveCommand(
          dest.x + (Math.random() - 0.5) * 30,
          dest.y + (Math.random() - 0.5) * 30,
        );
        this.pendingTargetId.set(unit.id, target.id);
      } else {
        unit.attackCommand(target);
        this.pendingTargetId.delete(unit.id);
      }
    }

    this.assaultStartCount = squad.length;
    return true;
  }

  private isBridgeContested(entities: Entity[], bridge: { x: number; y: number }): boolean {
    let enemies = 0;
    for (const e of entities) {
      if (e.isDead || !(e instanceof Unit) || !this.isEnemy(e)) continue;
      if (Math.hypot(e.x - bridge.x, e.y - bridge.y) < 160) enemies++;
    }
    return enemies >= 3;
  }

  private advanceWaypoints(entities: Entity[]) {
    const byId = new Map(entities.map((e) => [e.id, e]));

    for (const unit of this.getMilitary(entities)) {
      const pendingId = this.pendingTargetId.get(unit.id);
      if (pendingId === undefined) continue;

      if (unit.targetX !== null && unit.targetY !== null) {
        if (Math.hypot(unit.x - unit.targetX, unit.y - unit.targetY) > 45) continue;
      } else if (unit.targetEntity && !unit.targetEntity.isDead) {
        continue;
      }

      const target = byId.get(pendingId);
      if (target && !target.isDead) unit.attackCommand(target);
      this.pendingTargetId.delete(unit.id);
    }
  }

  private checkRetreat(entities: Entity[], gameMap?: GameMap) {
    const assault = this.getMilitary(entities).filter(
      (u) => this.assaultIds.has(u.id) || this.harassIds.has(u.id),
    );
    if (assault.length === 0 || this.assaultStartCount === 0) return;

    const aliveRatio = assault.length / Math.max(1, this.assaultStartCount);
    if (aliveRatio > 0.6) return;

    const main = this.getMainBuilding(entities);
    if (!main) return;

    const enemyMain = this.getEnemyMainBuilding(entities);
    const bridge =
      gameMap && enemyMain
        ? gameMap.findBridgeToward(main.x, main.y, enemyMain.x, enemyMain.y)
        : null;

    for (const unit of assault) {
      this.assaultIds.delete(unit.id);
      this.harassIds.delete(unit.id);
      this.guardIds.add(unit.id);
      this.pendingTargetId.delete(unit.id);
      if (bridge) unit.moveCommand(bridge.x, bridge.y);
      else unit.moveCommand(main.x, main.y);
    }

    this.assaultStartCount = 0;
    this.state = 'recover';
    this.stateReason = 'failed assault';
    this.secondsInState = 0;
  }

  /** Debug / HUD — human-readable strategic posture. */
  public getPhase(): string {
    return strategicStateLabel(this.state);
  }

  public getStrategicReason(): string {
    return this.stateReason;
  }

  public getState(): StrategicState {
    return this.state;
  }

  private pickHarassTarget(entities: Entity[]): Entity | null {
    const enemyWorkers = entities.filter(
      (e): e is Unit =>
        e instanceof Unit &&
        !e.isDead &&
        this.isEnemy(e) &&
        (e.unitType === 'Worker' || e.unitType === 'Peon'),
    );

    if (enemyWorkers.length > 0) {
      const enemyMain = this.getEnemyMainBuilding(entities);
      enemyWorkers.sort((a, b) => {
        if (!enemyMain) return 0;
        return (
          Math.hypot(b.x - enemyMain.x, b.y - enemyMain.y) -
          Math.hypot(a.x - enemyMain.x, a.y - enemyMain.y)
        );
      });
      return enemyWorkers[0]!;
    }

    const enemyMain = this.getEnemyMainBuilding(entities);
    if (enemyMain) {
      let bestMine: ResourceNode | null = null;
      let bestDist = Infinity;
      for (const e of entities) {
        if (!(e instanceof ResourceNode) || e.isDead) continue;
        const dist = Math.hypot(e.x - enemyMain.x, e.y - enemyMain.y);
        if (dist < 500 && dist < bestDist) {
          bestDist = dist;
          bestMine = e;
        }
      }
      if (bestMine) {
        for (const e of entities) {
          if (e.isDead || !this.isEnemy(e)) continue;
          if (e instanceof Building && !isMainBuilding(e.buildingType)) {
            if (Math.hypot(e.x - bestMine.x, e.y - bestMine.y) < 350) return e;
          }
        }
      }
    }

    const economy = entities.find(
      (e) =>
        e instanceof Building && !e.isDead && this.isEnemy(e) && isEconomyBuilding(e.buildingType),
    );
    if (economy) return economy;

    return this.pickSiegeTarget(entities);
  }

  private pickSiegeTarget(entities: Entity[]): Entity | null {
    const main = this.getMainBuilding(entities);
    const enemies = entities.filter((e) => !e.isDead && this.isEnemy(e));
    if (enemies.length === 0) return null;

    if (main) {
      let nearestRaider: Entity | null = null;
      let nearestDist = 500 * 500;
      for (const h of enemies) {
        if (!(h instanceof Unit)) continue;
        const dist = Math.hypot(h.x - main.x, h.y - main.y);
        if (dist * dist < nearestDist) {
          nearestDist = dist * dist;
          nearestRaider = h;
        }
      }
      if (nearestRaider) return nearestRaider;
    }

    if (this.state === 'raid') {
      const production = enemies.find(
        (e) =>
          e instanceof Building &&
          (e.buildingType === 'Barracks' || e.buildingType === 'OrcBarracks'),
      );
      if (production) return production;
    }

    const enemyMain = enemies.find(
      (e) => e instanceof Building && isMainBuilding(e.buildingType),
    );
    if (enemyMain) return enemyMain;

    const building = enemies.find((e) => e instanceof Building);
    if (building) return building;

    return enemies[0] ?? null;
  }
}
