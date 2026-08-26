import { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import { Building, isMainBuilding, isEconomyBuilding, type BuildingType } from '../Entities/Building';
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
import type { GameCommand } from '../Sim/Commands';
import type { GameRng } from '../Sim/GameRng';
import { TAX_POLICY_COOLDOWN_TICKS, type TaxPolicy } from '../Players/TaxPolicy';
import { OUTPOST_TREASURY_COST } from '../Settlement/SettlementSystem';
import { getRecipe, treasuryGoldCost } from '../Settlement/ConstructionCatalog';
import {
  analyzeStrategicSituation,
  chooseStrategicState,
  strategicStateLabel,
  type StrategicSituation,
  type StrategicState,
} from './StrategicAI';

/**
 * Strategic AI for any faction seat.
 * Issues GameCommands only — never mutates units/buildings/economy for orders.
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
  private submitCommand: ((cmd: GameCommand) => void) | null = null;
  private rng: GameRng | null = null;
  private simTick = 0;

  public readonly playerId: string;

  constructor(playerId: string) {
    this.playerId = playerId;
  }

  public captureSoftState(): import('../Sim/SoftSimState').AiSoftState {
    return {
      playerId: this.playerId,
      state: this.state,
      stateReason: this.stateReason,
      secondsInState: this.secondsInState,
      elapsed: this.elapsed,
      thinkTimer: this.thinkTimer,
      actionTimer: this.actionTimer,
      nextActionIn: this.nextActionIn,
      expansionCooldown: this.expansionCooldown,
      guardIds: [...this.guardIds],
      assaultIds: [...this.assaultIds],
      harassIds: [...this.harassIds],
      pendingTargetId: [...this.pendingTargetId.entries()].map(([unitId, targetId]) => ({
        unitId,
        targetId,
      })),
      assaultStartCount: this.assaultStartCount,
    };
  }

  public restoreSoftState(s: import('../Sim/SoftSimState').AiSoftState) {
    this.state = s.state as StrategicState;
    this.stateReason = s.stateReason;
    this.secondsInState = s.secondsInState;
    this.elapsed = s.elapsed;
    this.thinkTimer = s.thinkTimer;
    this.actionTimer = s.actionTimer;
    this.nextActionIn = s.nextActionIn;
    this.expansionCooldown = s.expansionCooldown;
    this.guardIds = new Set(s.guardIds);
    this.assaultIds = new Set(s.assaultIds);
    this.harassIds = new Set(s.harassIds);
    this.pendingTargetId = new Map(s.pendingTargetId.map((p) => [p.unitId, p.targetId]));
    this.assaultStartCount = s.assaultStartCount;
  }

  public update(
    dt: number,
    entities: Entity[],
    gameMap?: GameMap,
    match?: MatchState,
    settlements?: SettlementSystem,
    squads?: SquadSystem,
    influence?: InfluenceMap,
    submitCommand?: (cmd: GameCommand) => void,
    rng?: GameRng,
    simTick?: number,
  ) {
    this.match = match ?? MatchState.current;
    this.settlements = settlements ?? null;
    this.squads = squads ?? null;
    this.influence = influence ?? null;
    this.submitCommand = submitCommand ?? null;
    this.rng = rng ?? null;
    if (typeof simTick === 'number') this.simTick = simTick;
    if (!this.match || !this.getPlayer() || !this.settlements || !this.submitCommand || !this.rng) {
      return;
    }

    this.elapsed += dt;
    this.thinkTimer += dt;
    this.actionTimer += dt;
    this.secondsInState += dt;
    if (this.expansionCooldown > 0) this.expansionCooldown -= dt;

    this.cleanupRoles(entities);
    this.defendBase(entities, gameMap);
    this.advanceWaypoints(entities);

    if (this.thinkTimer >= this.thinkInterval) {
      this.thinkTimer = 0;
      this.reassess(entities, gameMap);
      this.manageTaxPolicy();
      this.manageCityFocuses();
      this.manageEconomyTerritory(entities, gameMap);
      this.manageConstruction(entities, gameMap);
      this.manageTraining(entities);
      this.tryEstablishOutpost(entities, gameMap);
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

  private enqueue(cmd: GameCommand) {
    this.submitCommand?.(cmd);
  }

  private orderMove(unit: Unit, x: number, y: number, seenSquads?: Set<string>) {
    const squad = this.squads?.getForUnit(unit);
    if (squad) {
      if (seenSquads) {
        if (seenSquads.has(squad.id)) return;
        seenSquads.add(squad.id);
      }
      this.enqueue({
        type: 'moveSquad',
        playerId: this.playerId,
        squadId: squad.id,
        x,
        y,
      });
      return;
    }
    this.enqueue({
      type: 'moveAgents',
      playerId: this.playerId,
      unitIds: [unit.id],
      x,
      y,
    });
  }

  private orderAttack(unit: Unit, target: Entity, seenSquads?: Set<string>) {
    const squad = this.squads?.getForUnit(unit);
    if (squad) {
      if (seenSquads) {
        if (seenSquads.has(squad.id)) return;
        seenSquads.add(squad.id);
      }
      this.enqueue({
        type: 'attack',
        playerId: this.playerId,
        squadId: squad.id,
        targetEntityId: target.id,
      });
      return;
    }
    this.enqueue({
      type: 'attack',
      playerId: this.playerId,
      unitIds: [unit.id],
      targetEntityId: target.id,
    });
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
    const rng = this.rng!;
    const d = doctrineOf(this.getFaction()?.id ?? 'orcs');
    const base = (() => {
      switch (this.state) {
        case 'develop':
        case 'expand':
        case 'recover':
          return 36 + rng.next() * 14;
        case 'fortify':
          return 28 + rng.next() * 10;
        case 'defend':
          return 16 + rng.next() * 8;
        case 'raid':
          return 22 + rng.next() * 10;
        case 'attack':
          return 14 + rng.next() * 8;
      }
    })();
    return base * d.aiActionIntervalMul;
  }

  private getGold(): number {
    return this.getPlayer()?.gold ?? 0;
  }

  /**
   * Tax policy hysteresis: Recover/Develop → low/normal;
   * Attack prep → high; low treasury + Attack → war.
   */
  private manageTaxPolicy() {
    const player = this.getPlayer();
    if (!player) return;
    if (
      player.lastTaxChangeTick > 0 &&
      this.simTick - player.lastTaxChangeTick < TAX_POLICY_COOLDOWN_TICKS
    ) {
      return;
    }

    let desired: TaxPolicy = 'normal';
    if (this.state === 'recover' || this.state === 'develop' || this.state === 'expand') {
      desired = this.state === 'recover' ? 'low' : 'normal';
    } else if (this.state === 'fortify' || this.state === 'defend') {
      desired = 'normal';
    } else if (this.state === 'raid' || this.state === 'attack') {
      desired = player.gold < 120 ? 'war' : 'high';
    }

    // Mild hysteresis: don't flip war↔low without staying in state a bit.
    if (desired === player.taxPolicy) return;
    if (
      (player.taxPolicy === 'war' || player.taxPolicy === 'high') &&
      (desired === 'low' || desired === 'normal') &&
      this.secondsInState < 12
    ) {
      return;
    }

    this.enqueue({
      type: 'setTaxPolicy',
      playerId: this.playerId,
      policy: desired,
    });
  }

  /**
   * Multi-city roles: capital economy/crafting, frontier military/defense.
   * Only when 2+ seats; does not spam every tick (focus already set).
   */
  private manageCityFocuses() {
    if (!this.settlements) return;
    const player = this.getPlayer();
    if (!player) return;
    const seats = this.settlements
      .allForOwner(this.playerId)
      .filter((s) => s.hasTownCenter);
    if (seats.length < 2) return;

    const capitalId = player.capitalSettlementId;
    for (const s of seats) {
      const isCap = capitalId === s.id || (!capitalId && s === seats[0]);
      const want = isCap
        ? player.factionId === 'humans'
          ? 'crafting'
          : 'economy'
        : s.threatPressure > 0.35
          ? 'defense'
          : 'military';
      if (s.focus === want) continue;
      this.enqueue({
        type: 'setSettlementFocus',
        playerId: this.playerId,
        settlementId: s.id,
        focus: want,
      });
    }
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

  // --- Economy (territorial — no Worker gather micro) --------------------

  private manageEconomyTerritory(entities: Entity[], gameMap?: GameMap) {
    const main = this.getMainBuilding(entities);
    const settlement = this.settlements?.get(this.playerId);
    if (!main || !settlement) return;
    void gameMap;

    // Protect linked mines: send a guard squad near threatened deposits.
    const mines = this.findMinesNear(entities, main, 3);
    for (const mine of mines) {
      if (mine.raidDamageCooldown <= 0) continue;
      const military = this.getMilitary(entities);
      if (military.length === 0) break;
      const guard = military[0]!;
      if (Math.hypot(guard.x - mine.x, guard.y - mine.y) > 160) {
        this.orderMove(guard, mine.x + 30, mine.y + 30);
      }
      break;
    }
  }

  private tryEstablishOutpost(entities: Entity[], gameMap?: GameMap) {
    if (!gameMap) return;
    const main = this.getMainBuilding(entities);
    const settlement = this.settlements?.get(this.playerId);
    const player = this.getPlayer();
    if (!main || !settlement || !player) return;
    if (settlement.outpostCount >= 2) return;
    if (settlement.tier === 'camp' || settlement.tier === 'hamlet') return;
    if (this.getGold() < OUTPOST_TREASURY_COST) return;

    // Prefer Outpost before City2 when treasury ok mid-game.
    const cityCount = this.settlements?.allForOwner(this.playerId).length ?? 1;
    if (cityCount >= 2 && settlement.outpostCount >= 1 && this.elapsed < 400) return;

    const military = this.getMilitary(entities);
    if (military.length < 2) return;
    const scout = military[military.length - 1]!;
    const ang = (this.elapsed * 0.07) % (Math.PI * 2);
    const dist = 180 + settlement.outpostCount * 40;
    const x = scout.x + Math.cos(ang) * 40;
    const y = scout.y + Math.sin(ang) * 40;
    const ox = main.x + Math.cos(ang) * dist;
    const oy = main.y + Math.sin(ang) * dist;
    const site = canPlaceBuildingAt(ox, oy, gameMap, entities, 32)
      ? { x: ox, y: oy }
      : canPlaceBuildingAt(x, y, gameMap, entities, 32)
        ? { x, y }
        : null;
    if (!site) return;
    if (Math.hypot(site.x - main.x, site.y - main.y) < 120) return;

    this.enqueue({
      type: 'establishOutpost',
      playerId: this.playerId,
      x: site.x,
      y: site.y,
    });
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

  private pickBuildSite(
    entities: Entity[],
    gameMap: GameMap,
    main: Building,
  ): { x: number; y: number } | null {
    const offsets = [
      { x: main.x + 80, y: main.y + 40 },
      { x: main.x - 80, y: main.y + 40 },
      { x: main.x + 80, y: main.y - 40 },
      { x: main.x - 60, y: main.y - 60 },
      { x: main.x + 100, y: main.y },
      { x: main.x, y: main.y + 100 },
      { x: main.x - 100, y: main.y + 20 },
      { x: main.x + 40, y: main.y - 100 },
    ];
    for (const c of offsets) {
      if (canPlaceBuildingAt(c.x, c.y, gameMap, entities, 40)) return c;
    }
    return this.pickExpansionSite(entities, gameMap, main.x, main.y, 1);
  }

  private queueBuildingNearMain(
    entities: Entity[],
    gameMap: GameMap | undefined,
    main: Building,
    buildingType: BuildingType,
  ): boolean {
    if (!gameMap) return false;
    const site = this.pickBuildSite(entities, gameMap, main);
    if (!site) return false;
    this.enqueue({
      type: 'queueBuilding',
      playerId: this.playerId,
      buildingType,
      x: site.x,
      y: site.y,
    });
    return true;
  }

  private manageConstruction(entities: Entity[], gameMap?: GameMap) {
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
      // Civic labor advances construction — no Worker assistBuild.
      return;
    }

    const settlement = this.settlements?.get(this.playerId);
    if (!settlement?.hasTownCenter) return;

    // Production — needed for any military posture; still player-queue rules.
    const barracksNeed = this.treasuryNeed(faction.productionBuilding);
    if (
      !sit.hasProduction &&
      this.getGold() >= barracksNeed &&
      sit.unitPop >= Math.min(4, Math.max(2, sit.unitMaxPop * 0.4))
    ) {
      this.queueBuildingNearMain(entities, gameMap, main, faction.productionBuilding);
      return;
    }

    if (!sit.hasProduction) return;
    const d = doctrineOf(player.factionId);

    // Fortify / Defend: walls & forts via the same strategic catalog as the player.
    if (
      (this.state === 'fortify' || this.state === 'defend') &&
      this.getGold() >= this.treasuryNeed('Wall') &&
      settlement.population >= 3
    ) {
      if (
        !settlement.queue.hasQueuedOrBuilding('Wall') &&
        (sit.primaryBridgeContested || sit.safety < 0.55 || this.state === 'fortify')
      ) {
        this.queueBuildingNearMain(entities, gameMap, main, 'Wall');
        return;
      }
      if (
        this.getGold() >= this.treasuryNeed('Fort') &&
        settlement.population >= 6 &&
        !settlement.queue.hasQueuedOrBuilding('Fort') &&
        !entities.some(
          (e) =>
            e instanceof Building && e.buildingType === 'Fort' && !e.isDead && this.isOwn(e),
        )
      ) {
        this.queueBuildingNearMain(entities, gameMap, main, 'Fort');
        return;
      }
    }

    // Develop / Recover / Fortify: infrastructure & crafting (doctrine-weighted).
    if (
      (this.state === 'develop' || this.state === 'recover' || this.state === 'fortify') &&
      d.craftProsperityBias >= 1.05
    ) {
      if (
        this.getGold() >= this.treasuryNeed('Blacksmith') &&
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
        this.queueBuildingNearMain(entities, gameMap, main, 'Blacksmith');
        return;
      }
      if (
        this.getGold() >= this.treasuryNeed('Market') &&
        settlement.population >= 4 &&
        !settlement.queue.hasQueuedOrBuilding('Market') &&
        !entities.some(
          (e) =>
            e instanceof Building && e.buildingType === 'Market' && !e.isDead && this.isOwn(e),
        )
      ) {
        this.queueBuildingNearMain(entities, gameMap, main, 'Market');
        return;
      }
    }

    // Temple when recovering morale / culture gap
    if (
      this.state === 'recover' &&
      this.getGold() >= this.treasuryNeed('Temple') &&
      settlement.population >= 5 &&
      !settlement.queue.hasQueuedOrBuilding('Temple')
    ) {
      this.queueBuildingNearMain(entities, gameMap, main, 'Temple');
    }
  }

  private treasuryNeed(target: BuildingType | 'Wall' | 'Fort' | 'Blacksmith' | 'Market' | 'Temple'): number {
    const r = getRecipe(target as BuildingType);
    return r ? treasuryGoldCost(r.costs) : 100;
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

    // Prefer Outpost before second city when treasury can afford it mid-game.
    const primary = this.settlements.get(this.playerId);
    if (!primary?.hasTownCenter) return;
    if (
      owned.length < 2 &&
      primary.outpostCount < 1 &&
      this.getGold() >= OUTPOST_TREASURY_COST &&
      this.elapsed > 90 &&
      this.elapsed < 420
    ) {
      return;
    }

    if (!this.settlements.canFormSettlerGroup(this.playerId, player.factionId, this.match ?? undefined)) return;

    const site = this.pickExpansionSite(
      entities,
      gameMap,
      primary.centerX,
      primary.centerY,
      d.expansionPressure,
    );
    if (!site) return;

    this.enqueue({
      type: 'foundSettlement',
      playerId: this.playerId,
      x: site.x,
      y: site.y,
      formGroupIfNeeded: true,
    });
    this.expansionCooldown = 75 / Math.max(0.5, d.expansionPressure);
  }

  private pickExpansionSite(
    entities: Entity[],
    gameMap: GameMap,
    cx: number,
    cy: number,
    pressure: number,
  ): { x: number; y: number } | null {
    const rng = this.rng!;
    const enemyMain = this.getEnemyMainBuilding(entities);
    const preferTowardEnemy = pressure > 1 && this.state === 'expand';
    const baseAngle = enemyMain
      ? Math.atan2(enemyMain.y - cy, enemyMain.x - cx)
      : rng.angle();
    const dist = preferTowardEnemy ? 280 + rng.next() * 120 : 220 + rng.next() * 160;

    for (let i = 0; i < 12; i++) {
      const a = preferTowardEnemy
        ? baseAngle + (rng.next() - 0.5) * 0.9
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
      this.enqueue({
        type: 'changeFormation',
        playerId: this.playerId,
        squadId: squad.id,
        formation,
      });
    }
  }

  /**
   * Train military when threatened / expanding. Workers are no longer trained.
   */
  private manageTraining(entities: Entity[]) {
    const faction = this.getFaction();
    const main = this.getMainBuilding(entities);
    const sit = this.situation;
    if (!faction || !main || !sit) return;
    if (sit.unitPop >= sit.unitMaxPop) return;

    const military = this.getMilitary(entities);
    const militaryTarget = this.desiredMilitary(sit);

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
      this.enqueue({
        type: 'trainUnit',
        playerId: this.playerId,
        buildingId: barracks.id,
        unitType: faction.rangedType,
      });
    } else {
      this.enqueue({
        type: 'trainUnit',
        playerId: this.playerId,
        buildingId: barracks.id,
        unitType: faction.meleeType,
      });
    }
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

    const seenSquads = new Set<string>();
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
        this.orderAttack(unit, closest, seenSquads);
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

    const seenSquads = new Set<string>();
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
        this.orderMove(guard, stand.x, stand.y, seenSquads);
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
    const rng = this.rng!;

    if (this.state === 'defend') {
      // Light counter-raid only when we still have spare force at home.
      if ((sit?.threatNearBase ?? 0) > 2) return false;
      return this.launchHarass(entities, free, gameMap, 2);
    }

    if (this.state === 'raid') {
      const size = sit && sit.armyRatio >= 1.0 ? 3 : 2;
      if (free.length >= 4 && rng.chance((sit?.doctrineHarass ?? 0.5) * 0.35)) {
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

    const seenMove = new Set<string>();
    const seenAttack = new Set<string>();
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
          this.orderMove(unit, best.x, best.y, seenMove);
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
        this.orderMove(unit, dest.x, dest.y, seenMove);
        this.pendingTargetId.set(unit.id, target.id);
      } else {
        this.orderAttack(unit, target, seenAttack);
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

    const rng = this.rng!;
    const seenMove = new Set<string>();
    const seenAttack = new Set<string>();
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
          this.orderMove(unit, best.x, best.y, seenMove);
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
        this.orderMove(
          unit,
          dest.x + (rng.next() - 0.5) * 30,
          dest.y + (rng.next() - 0.5) * 30,
          seenMove,
        );
        this.pendingTargetId.set(unit.id, target.id);
      } else {
        this.orderAttack(unit, target, seenAttack);
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
    const seenAttack = new Set<string>();

    for (const unit of this.getMilitary(entities)) {
      const pendingId = this.pendingTargetId.get(unit.id);
      if (pendingId === undefined) continue;

      if (unit.targetX !== null && unit.targetY !== null) {
        if (Math.hypot(unit.x - unit.targetX, unit.y - unit.targetY) > 45) continue;
      } else if (unit.targetEntity && !unit.targetEntity.isDead) {
        continue;
      }

      const target = byId.get(pendingId);
      if (target && !target.isDead) this.orderAttack(unit, target, seenAttack);
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

    const seenMove = new Set<string>();
    for (const unit of assault) {
      this.assaultIds.delete(unit.id);
      this.harassIds.delete(unit.id);
      this.guardIds.add(unit.id);
      this.pendingTargetId.delete(unit.id);
      if (bridge) this.orderMove(unit, bridge.x, bridge.y, seenMove);
      else this.orderMove(unit, main.x, main.y, seenMove);
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
    const enemyMain = this.getEnemyMainBuilding(entities);
    if (enemyMain) {
      let bestMine: ResourceNode | null = null;
      let bestDist = Infinity;
      for (const e of entities) {
        if (!(e instanceof ResourceNode) || e.isDead) continue;
        const dist = Math.hypot(e.x - enemyMain.x, e.y - enemyMain.y);
        if (dist < 560 && dist < bestDist) {
          bestDist = dist;
          bestMine = e;
        }
      }
      if (bestMine) return bestMine;
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
