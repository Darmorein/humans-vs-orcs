import { Entity } from '../../Entities/Entity';
import { Unit } from '../../Entities/Unit';
import { Building, isMainBuilding, isEconomyBuilding } from '../../Entities/Building';
import { ResourceNode } from '../../Entities/ResourceNode';
import type { GameMap } from '../../Map/GameMap';
import type { InfluenceMap } from '../../Map/InfluenceMap';
import type { MatchState } from '../../Players/MatchState';
import { isHostile } from '../../Players/Relations';
import { FACTIONS, type FactionId } from '../../Players/Types';
import { doctrineOf } from '../../Players/FactionDoctrine';
import type { SettlementSystem } from '../../Settlement/SettlementSystem';
import {
  countHostilesNear,
  gatherTacticalCandidates,
  pickBestHoldPoint,
} from '../../Combat/TacticalTerrain';
import type { StrategicSituation } from './Types';

export interface AnalyzeContext {
  playerId: string;
  entities: Entity[];
  match: MatchState;
  settlements: SettlementSystem;
  gameMap?: GameMap;
  influence?: InfluenceMap;
}

function unitCombatWeight(u: Unit): number {
  return (u.hp / Math.max(1, u.maxHp)) * (8 + u.damage) * (u.isRanged ? 1.05 : 1);
}

function isEnemyOf(playerId: string, e: Entity, relativeTo?: Entity): boolean {
  if (e instanceof ResourceNode) return false;
  if (relativeTo) return isHostile(relativeTo, e);
  return e.ownerPlayerId !== null && e.ownerPlayerId !== playerId;
}

/**
 * Read the same world the player uses: settlements, gold, influence, bridges, terrain.
 */
export function analyzeStrategicSituation(ctx: AnalyzeContext): StrategicSituation | null {
  const player = ctx.match.getPlayer(ctx.playerId);
  if (!player || player.isDefeated) return null;

  const faction = FACTIONS[player.factionId];
  const d = doctrineOf(player.factionId);
  const { entities, settlements, gameMap, influence } = ctx;

  const main = entities.find(
    (e): e is Building =>
      e instanceof Building &&
      !e.isDead &&
      e.ownerPlayerId === ctx.playerId &&
      e.buildingType === faction.mainBuilding,
  );

  const settlement = settlements.get(ctx.playerId);
  const ownedSeats = settlements.allForOwner(ctx.playerId);

  let unitPop = 0;
  let unitMaxPop = 0;
  let workerCount = 0;
  let armyStrength = 0;
  let armyCount = 0;
  let enemyArmyStrength = 0;
  let enemyArmyCount = 0;
  let unfinishedBuilds = 0;
  let nearbyMineCount = 0;

  for (const e of entities) {
    if (e.isDead) continue;
    if (e.ownerPlayerId === ctx.playerId) {
      if (e instanceof Unit) {
        unitPop += 1;
        // Workers retired — civic builders / civic pop proxy for AI economy scores.
        if (e.unitType === faction.meleeType || e.unitType === faction.rangedType) {
          armyCount += 1;
          armyStrength += unitCombatWeight(e);
        }
      }
      if (e instanceof Building && e.isConstructed) {
        if (e.buildingType === faction.mainBuilding || isEconomyBuilding(e.buildingType)) {
          unitMaxPop += 5;
        }
      }
      if (e instanceof Building && !e.isConstructed) unfinishedBuilds += 1;
    } else if (isEnemyOf(ctx.playerId, e)) {
      if (e instanceof Unit) {
        const f = FACTIONS[e.factionId as FactionId];
        const isMil =
          !!f && (e.unitType === f.meleeType || e.unitType === f.rangedType);
        if (isMil || e.unitType === 'Swordsman' || e.unitType === 'Archer' || e.unitType === 'Grunt' || e.unitType === 'SpearOrc') {
          enemyArmyCount += 1;
          enemyArmyStrength += unitCombatWeight(e);
        }
      }
    }
  }

  // Civic labor proxy (retired Worker micro) — builders + population soft floor.
  if (settlement) {
    const builders = settlement.citizens.filter((c) => c.profession === 'builder').length;
    workerCount = Math.max(builders, Math.floor(settlement.population * 0.2));
  }

  if (main) {
    for (const e of entities) {
      if (!(e instanceof ResourceNode) || e.isDead) continue;
      if (Math.hypot(e.x - main.x, e.y - main.y) < 900) nearbyMineCount += 1;
    }
  }

  const threatNearBase = main
    ? countThreats(entities, ctx.playerId, main.x, main.y, 480, main)
    : 0;

  const hasProduction =
    entities.some(
      (e) =>
        e instanceof Building &&
        e.buildingType === faction.productionBuilding &&
        !e.isDead &&
        e.ownerPlayerId === ctx.playerId,
    ) || !!settlement?.queue.hasQueuedOrBuilding(faction.productionBuilding);

  let primaryBridgeContested = false;
  let bridgeFriendlyPresence = 0;
  let bridgeEnemyPresence = 0;
  let defensibleScore = 0;

  if (gameMap && main) {
    const enemyMain = entities.find(
      (e): e is Building =>
        e instanceof Building &&
        !e.isDead &&
        isEnemyOf(ctx.playerId, e) &&
        isMainBuilding(e.buildingType),
    );
    const bridge = enemyMain
      ? gameMap.findBridgeToward(main.x, main.y, enemyMain.x, enemyMain.y)
      : gameMap.findBridgeCenters()[0] ?? null;

    if (bridge) {
      for (const e of entities) {
        if (e.isDead || !(e instanceof Unit)) continue;
        const dist = Math.hypot(e.x - bridge.x, e.y - bridge.y);
        if (dist > 170) continue;
        if (e.ownerPlayerId === ctx.playerId) bridgeFriendlyPresence += 1;
        else if (isEnemyOf(ctx.playerId, e)) bridgeEnemyPresence += 1;
      }
      primaryBridgeContested = bridgeEnemyPresence >= 2 && bridgeEnemyPresence >= bridgeFriendlyPresence;

      const candidates = [
        bridge,
        ...gatherTacticalCandidates(gameMap, bridge.x, bridge.y, 180),
      ];
      const hostiles = countHostilesNear(entities, main, bridge.x, bridge.y, 220);
      const best = pickBestHoldPoint(gameMap, candidates, {
        isRanged: false,
        enemiesNearby: hostiles,
      });
      defensibleScore = best?.assessment.total ?? 0;
    }
  }

  const territory = influence
    ? influence.estimateControlShares(player.factionId)
    : { ownShare: 0.35, contestedShare: 0.1 };

  const civicPopulation = settlement?.population ?? 0;
  const housing = settlement?.housing ?? 1;
  const housingPressure =
    housing > 0 ? Math.max(0, civicPopulation / housing - 0.7) / 0.5 : 1;

  const food = settlement?.food ?? 0;
  const wood = settlement?.wood ?? 0;
  const stone = settlement?.stone ?? 0;
  const iron = settlement?.iron ?? 0;
  const capacity = settlement?.capacity;
  const resourcePressure = capacity
    ? Math.max(
        wood / Math.max(1, capacity.wood),
        food / Math.max(1, capacity.food),
        stone / Math.max(1, capacity.stone),
      )
    : 0.5;

  const canExpand =
    settlements.canFormSettlerGroup(ctx.playerId, player.factionId, ctx.match) ||
    !!settlements.getSettlerGroup(ctx.playerId);

  const expansionCrowding =
    settlement && settlement.hasTownCenter
      ? Math.max(
          housingPressure,
          settlement.prosperity > 0.45 ? 0.35 : 0,
          civicPopulation >= d.settlerMinPop ? 0.2 : 0,
        )
      : 0;

  const armyRatio = armyStrength / Math.max(12, enemyArmyStrength);

  return {
    civicPopulation,
    housing,
    housingPressure: Math.min(1, Math.max(0, housingPressure)),
    unitPop,
    unitMaxPop,
    gold: player.gold,
    food,
    wood,
    stone,
    iron,
    prosperity: settlement?.prosperity ?? 0,
    safety: settlement?.safety ?? 0.5,
    craftsmanship: settlement?.craftsmanship ?? 0.3,
    topNeed: settlement?.topNeed(0.2) ?? null,
    settlementCount: ownedSeats.length,
    hasTownCenter: !!settlement?.hasTownCenter,
    hasProduction,
    mainHpRatio: main ? main.hp / main.maxHp : 0,
    workerCount,
    armyStrength,
    armyCount,
    enemyArmyStrength,
    enemyArmyCount,
    armyRatio,
    threatNearBase,
    territoryOwnShare: territory.ownShare,
    territoryContestedShare: territory.contestedShare,
    nearbyMineCount,
    resourcePressure: Math.min(1, resourcePressure),
    primaryBridgeContested,
    bridgeFriendlyPresence,
    bridgeEnemyPresence,
    defensibleScore,
    canExpand,
    expansionCrowding: Math.min(1, expansionCrowding),
    unfinishedBuilds,
    doctrineExpansion: d.expansionPressure,
    doctrineHarass: d.aiHarassBias,
    doctrineDefense: d.defenseNeedBias,
    doctrineCraft: d.craftProsperityBias,
  };
}

function countThreats(
  entities: Entity[],
  playerId: string,
  x: number,
  y: number,
  radius: number,
  relativeTo?: Entity,
): number {
  const r2 = radius * radius;
  let n = 0;
  for (const e of entities) {
    if (e.isDead || !(e instanceof Unit) || !isEnemyOf(playerId, e, relativeTo)) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    if (dx * dx + dy * dy < r2) n += 1;
  }
  return n;
}
