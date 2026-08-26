import { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import { Building } from '../Entities/Building';
import { ResourceNode } from '../Entities/ResourceNode';
import type { MatchState } from '../Players/MatchState';
import type { SettlementSystem } from '../Settlement/SettlementSystem';
import type { SquadSystem } from '../Combat/SquadSystem';
import { isCombatUnitType } from '../Combat/Squad';
import { doctrineOf } from '../Players/FactionDoctrine';
import type { GameCommand } from './Commands';
import type { GameRng } from './GameRng';

export interface CommandWorld {
  entities: Entity[];
  match: MatchState;
  settlements: SettlementSystem;
  squads: SquadSystem;
  rng: GameRng;
  canBuildAt: (x: number, y: number) => boolean;
  unitOptions: (type: string) => {
    hp: number;
    speed: number;
    unitType: string;
    damage: number;
    range: number;
  };
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
  if (cmd.x != null && cmd.y != null && !world.canBuildAt(cmd.x, cmd.y)) return false;
  const at = cmd.x != null && cmd.y != null ? { x: cmd.x, y: cmd.y } : undefined;
  return !!world.settlements.enqueueStrategic(cmd.playerId, cmd.buildingType, at);
}

function applyFoundSettlement(
  cmd: Extract<GameCommand, { type: 'foundSettlement' }>,
  world: CommandWorld,
): boolean {
  if (!world.canBuildAt(cmd.x, cmd.y)) return false;
  const player = world.match.getPlayer(cmd.playerId)!;
  // SettlementSystem.orderFoundSettlement forms a group when none is ready.
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

  const faction = player.faction;
  const isMilitary =
    cmd.unitType === faction.meleeType || cmd.unitType === faction.rangedType;
  const d = doctrineOf(player.factionId);
  const paid = Math.floor(cmd.cost * (isMilitary ? d.militaryTrainGoldMul : 1));
  if (!world.match.trySpend(cmd.playerId, paid)) return false;

  const options = world.unitOptions(cmd.unitType);
  const angle = world.rng.angle();
  const unit = new Unit(
    building.x + Math.cos(angle) * 55,
    building.y + Math.sin(angle) * 55,
    player,
    options,
  );
  world.entities.push(unit);
  if (isCombatUnitType(unit.unitType)) world.squads.registerUnit(unit);
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
