import { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import { Building } from '../Entities/Building';
import { ResourceNode } from '../Entities/ResourceNode';
import type { MatchState } from '../Players/MatchState';
import type { SettlementSystem } from '../Settlement/SettlementSystem';
import type { SquadSystem } from '../Combat/SquadSystem';
import type { ArtifactSystem } from '../Artifacts/ArtifactSystem';
import { doctrineOf } from '../Players/FactionDoctrine';
import { canPlaceBuildingAt, footprintForBuildingType } from '../Map/BuildPlacement';
import type { GameMap } from '../Map/GameMap';
import type { GameCommand } from './Commands';
import type { GameRng } from './GameRng';
import { getUnitDef, unitSpawnOptions } from './UnitCatalog';
import { spawnUnitNearBuilding } from './spawnUnit';

export interface CommandWorld {
  entities: Entity[];
  match: MatchState;
  settlements: SettlementSystem;
  squads: SquadSystem;
  rng: GameRng;
  gameMap: GameMap;
  artifacts?: ArtifactSystem;
}

/**
 * Apply one player command to the simulation.
 * Returns false if rejected (wrong owner, missing target, etc.).
 */
export function applyCommand(cmd: GameCommand, world: CommandWorld): boolean {
  const player = world.match.getPlayer(cmd.playerId);
  if (!player) return false;

  if (cmd.type === 'surrender') {
    if (player.isDefeated) return false;
    player.isDefeated = true;
    return true;
  }

  if (player.isDefeated) return false;

  switch (cmd.type) {
    case 'moveSquad':
      return applyMoveSquad(cmd, world);
    case 'attack':
      return applyAttack(cmd, world);
    case 'changeFormation':
      return applyFormation(cmd, world);
    case 'queueBuilding':
      return applyQueueBuilding(cmd, world);
    case 'foundSettlement':
      return applyFoundSettlement(cmd, world);
    case 'formSettlerGroup':
      return applyFormSettler(cmd, world);
    case 'trainUnit':
      return applyTrainUnit(cmd, world);
    case 'moveAgents':
      return applyMoveAgents(cmd, world);
    case 'gather':
      return applyGather(cmd, world);
    case 'assistBuild':
      return applyAssistBuild(cmd, world);
    case 'cancelConstruction':
      return world.settlements.cancelProject(cmd.playerId, cmd.projectId);
    case 'reorderConstruction':
      return world.settlements.moveProject(cmd.playerId, cmd.projectId, cmd.direction);
    case 'equipArtifact':
      return applyEquipArtifact(cmd, world);
    case 'unequipArtifact':
      return applyUnequipArtifact(cmd, world);
    case 'transferArtifact':
      return applyTransferArtifact(cmd, world);
    case 'setSettlementFocus':
      return world.settlements.setFocus(cmd.playerId, cmd.settlementId, cmd.focus);
    default:
      return false;
  }
}

function applyMoveSquad(
  cmd: Extract<GameCommand, { type: 'moveSquad' }>,
  world: CommandWorld,
): boolean {
  const squad = world.squads.get(cmd.squadId);
  if (!squad || squad.ownerPlayerId !== cmd.playerId) return false;
  world.squads.orderMove(squad, cmd.x, cmd.y, world.entities);
  return true;
}

function applyAttack(
  cmd: Extract<GameCommand, { type: 'attack' }>,
  world: CommandWorld,
): boolean {
  const target = world.entities.find((e) => e.id === cmd.targetEntityId && !e.isDead);
  if (!target) return false;

  if (cmd.squadId) {
    const squad = world.squads.get(cmd.squadId);
    if (!squad || squad.ownerPlayerId !== cmd.playerId) return false;
    world.squads.orderAttack(squad, target, world.entities);
    return true;
  }

  if (cmd.unitIds && cmd.unitIds.length > 0) {
    let any = false;
    for (const id of cmd.unitIds) {
      const u = world.entities.find(
        (e): e is Unit => e instanceof Unit && e.id === id && !e.isDead,
      );
      if (!u || u.ownerPlayerId !== cmd.playerId) continue;
      u.attackCommand(target);
      any = true;
    }
    return any;
  }
  return false;
}

function applyFormation(
  cmd: Extract<GameCommand, { type: 'changeFormation' }>,
  world: CommandWorld,
): boolean {
  const squad = world.squads.get(cmd.squadId);
  if (!squad || squad.ownerPlayerId !== cmd.playerId) return false;
  world.squads.setFormation(squad, cmd.formation, world.entities);
  return true;
}

function applyQueueBuilding(
  cmd: Extract<GameCommand, { type: 'queueBuilding' }>,
  world: CommandWorld,
): boolean {
  const player = world.match.getPlayer(cmd.playerId);
  if (!player) return false;
  const foot = footprintForBuildingType(cmd.buildingType, player.factionId);
  if (!canPlaceBuildingAt(cmd.x, cmd.y, world.gameMap, world.entities, foot)) {
    return false;
  }
  return !!world.settlements.enqueueStrategic(cmd.playerId, cmd.buildingType, {
    x: cmd.x,
    y: cmd.y,
  });
}

function applyFoundSettlement(
  cmd: Extract<GameCommand, { type: 'foundSettlement' }>,
  world: CommandWorld,
): boolean {
  if (!canPlaceBuildingAt(cmd.x, cmd.y, world.gameMap, world.entities, 44)) return false;
  const player = world.match.getPlayer(cmd.playerId)!;
  void cmd.formGroupIfNeeded;
  const ok = world.settlements.orderFoundSettlement(
    cmd.playerId,
    cmd.x,
    cmd.y,
    world.entities,
    player.factionId,
  );
  if (ok) {
    const s = world.settlements.get(cmd.playerId);
    if (s) player.gold = s.gold;
  }
  return ok;
}

function applyFormSettler(
  cmd: Extract<GameCommand, { type: 'formSettlerGroup' }>,
  world: CommandWorld,
): boolean {
  const player = world.match.getPlayer(cmd.playerId)!;
  const g = world.settlements.formSettlerGroup(
    cmd.playerId,
    world.entities,
    player.factionId,
  );
  if (!g) return false;
  const s = world.settlements.get(cmd.playerId);
  if (s) player.gold = s.gold;
  return true;
}

function applyTrainUnit(
  cmd: Extract<GameCommand, { type: 'trainUnit' }>,
  world: CommandWorld,
): boolean {
  const player = world.match.getPlayer(cmd.playerId)!;
  const building = world.entities.find(
    (e): e is Building =>
      e instanceof Building && e.id === cmd.buildingId && !e.isDead,
  );
  if (!building || building.ownerPlayerId !== cmd.playerId) return false;
  if (!building.isConstructed) return false;
  if (player.pop >= player.maxPop) return false;

  const def = getUnitDef(cmd.unitType);
  if (!def) return false;

  const faction = player.faction;
  const isMilitary =
    cmd.unitType === faction.meleeType || cmd.unitType === faction.rangedType;
  const d = doctrineOf(player.factionId);
  const paid = Math.floor(def.goldCost * (isMilitary ? d.militaryTrainGoldMul : 1));
  if (player.gold < paid) return false;

  const popCost = Math.max(1, def.populationCost);
  // Draft before spend — reject without taking gold if the citizen pool is empty.
  const draftSettlementId = world.settlements.draftForRecruitment(
    cmd.playerId,
    building.x,
    building.y,
    popCost,
  );
  if (!draftSettlementId) return false;

  if (!world.match.trySpend(cmd.playerId, paid)) return false;

  const unit = spawnUnitNearBuilding({
    player,
    unitType: cmd.unitType,
    buildingX: building.x,
    buildingY: building.y,
    entities: world.entities,
    squads: world.squads,
    rng: world.rng,
    options: unitSpawnOptions(cmd.unitType),
    distMin: 55,
    distMax: 55,
  });
  unit.draftedFromSettlementId = draftSettlementId;
  return true;
}

function applyMoveAgents(
  cmd: Extract<GameCommand, { type: 'moveAgents' }>,
  world: CommandWorld,
): boolean {
  const maxCols = Math.ceil(Math.sqrt(Math.max(1, cmd.unitIds.length)));
  let row = 0;
  let col = 0;
  let any = false;
  for (const id of cmd.unitIds) {
    const u = world.entities.find(
      (e): e is Unit => e instanceof Unit && e.id === id && !e.isDead,
    );
    if (!u || u.ownerPlayerId !== cmd.playerId) continue;
    const offsetX = col * 30 - maxCols * 15;
    const offsetY = row * 30 - maxCols * 15;
    u.moveCommand(cmd.x + offsetX, cmd.y + offsetY);
    any = true;
    col++;
    if (col >= maxCols) {
      col = 0;
      row++;
    }
  }
  return any;
}

function applyGather(
  cmd: Extract<GameCommand, { type: 'gather' }>,
  world: CommandWorld,
): boolean {
  const node = world.entities.find(
    (e): e is ResourceNode =>
      e instanceof ResourceNode && e.id === cmd.resourceEntityId && !e.isDead,
  );
  if (!node) return false;
  let any = false;
  for (const id of cmd.unitIds) {
    const u = world.entities.find(
      (e): e is Unit => e instanceof Unit && e.id === id && !e.isDead,
    );
    if (!u || u.ownerPlayerId !== cmd.playerId) continue;
    u.gatherCommand(node);
    any = true;
  }
  return any;
}

function applyAssistBuild(
  cmd: Extract<GameCommand, { type: 'assistBuild' }>,
  world: CommandWorld,
): boolean {
  const building = world.entities.find(
    (e): e is Building =>
      e instanceof Building && e.id === cmd.buildingId && !e.isDead,
  );
  if (!building) return false;
  let any = false;
  for (const id of cmd.unitIds) {
    const u = world.entities.find(
      (e): e is Unit => e instanceof Unit && e.id === id && !e.isDead,
    );
    if (!u || u.ownerPlayerId !== cmd.playerId) continue;
    u.buildCommand(building);
    any = true;
  }
  return any;
}

function applyEquipArtifact(
  cmd: Extract<GameCommand, { type: 'equipArtifact' }>,
  world: CommandWorld,
): boolean {
  if (!world.artifacts) return false;
  const unit = world.entities.find(
    (e): e is Unit => e instanceof Unit && e.id === cmd.unitId && !e.isDead,
  );
  if (!unit || unit.ownerPlayerId !== cmd.playerId) return false;
  return world.artifacts.transferToUnit(cmd.artifactId, unit);
}

function applyUnequipArtifact(
  cmd: Extract<GameCommand, { type: 'unequipArtifact' }>,
  world: CommandWorld,
): boolean {
  if (!world.artifacts) return false;
  const unit = world.entities.find(
    (e): e is Unit => e instanceof Unit && e.id === cmd.unitId && !e.isDead,
  );
  if (!unit || unit.ownerPlayerId !== cmd.playerId) return false;
  if (!unit.artifactId) return false;
  world.artifacts.unequipFromUnit(unit, world.settlements);
  return true;
}

function applyTransferArtifact(
  cmd: Extract<GameCommand, { type: 'transferArtifact' }>,
  world: CommandWorld,
): boolean {
  if (!world.artifacts) return false;
  if (cmd.unitId == null) {
    const art = world.artifacts.get(cmd.artifactId);
    if (!art || art.currentOwnerId !== cmd.playerId || art.lost) return false;
    if (art.boundUnitId == null) return true;
    const carrier = world.entities.find(
      (e): e is Unit => e instanceof Unit && e.id === art.boundUnitId,
    );
    if (!carrier) return false;
    world.artifacts.unequipFromUnit(carrier, world.settlements);
    return true;
  }
  return applyEquipArtifact(
    { type: 'equipArtifact', playerId: cmd.playerId, artifactId: cmd.artifactId, unitId: cmd.unitId },
    world,
  );
}
