import type { GameMap } from '../Map/GameMap';
import type { PathPoint } from '../Map/Pathfinding';
import type { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import type { Squad } from './Squad';
import { FORMATION_DEFS } from './FormationDefs.ts';
import { formationOffsets, orientOffsets } from './Formations.ts';

/** Minimum slot spacing so soft collision (~0.88 * radii) does not fight destinations. */
export const FORMATION_BASE_SPACING = 46;

/** Temporary column scale at bridges / narrow gaps (does not change player formation). */
export const CHOKE_COMPRESS_MUL = 0.38;

const ANCHOR_ARRIVE = 10;
const MEMBER_ARRIVE = 14;
const OPEN_EXPAND_DIST = 56;

/**
 * Shared strategic march: one A* for the squad anchor, members chase live slots.
 */
export function beginSquadMarch(
  squad: Squad,
  destX: number,
  destY: number,
  units: Unit[],
  gameMap: GameMap | undefined,
  entities: Entity[],
): void {
  const center = centroidOf(units) ?? { x: destX, y: destY };
  const dx = destX - center.x;
  const dy = destY - center.y;
  const len = Math.hypot(dx, dy) || 1;
  squad.facingX = dx / len;
  squad.facingY = dy / len;

  let path: PathPoint[] = [];
  let goalX = destX;
  let goalY = destY;
  if (gameMap) {
    path = gameMap.findPath(center.x, center.y, destX, destY, entities);
    if (path.length > 0) {
      const last = path[path.length - 1]!;
      goalX = last.x;
      goalY = last.y;
    } else {
      // Direct fallback — still snap members later.
      path = [{ x: goalX, y: goalY }];
    }
  } else {
    path = [{ x: goalX, y: goalY }];
  }

  squad.marchActive = true;
  squad.orderDestX = goalX;
  squad.orderDestY = goalY;
  squad.anchorPath = path;
  squad.anchorIndex = 0;
  squad.anchorX = center.x;
  squad.anchorY = center.y;
  squad.compressMul = 1;
  squad.releasedSlotIds.clear();

  const sorted = sortMembers(squad, units);
  const fx = FORMATION_DEFS[squad.formation];
  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i]!;
    u.formationSlotIndex = i;
    u.followSquadMarch = true;
    u.clearStuckProgress();
    const slot = slotWorld(squad, sorted.length, i, 1);
    u.setFormationSeek(slot.x, slot.y);
    if (fx.id === 'charge') u.chargeStrikeReady = true;
    u.facingX = squad.facingX;
    u.facingY = squad.facingY;
  }
}

/** Advance formation anchor and refresh member seek points each sim tick. */
export function steerSquadMarch(
  squad: Squad,
  units: Unit[],
  dt: number,
  gameMap: GameMap | undefined,
  entities: Entity[],
): void {
  if (!squad.marchActive || units.length === 0) return;

  const sorted = sortMembers(squad, units);
  const speed = Math.max(40, squad.movementSpeed || 60);
  advanceAnchor(squad, speed * dt, gameMap);

  const atChoke = isChokeTerrain(gameMap, squad.anchorX, squad.anchorY);
  const nearOpen =
    !atChoke &&
    Math.hypot(squad.anchorX - squad.orderDestX, squad.anchorY - squad.orderDestY) > OPEN_EXPAND_DIST;
  if (atChoke) {
    squad.compressMul = CHOKE_COMPRESS_MUL;
  } else if (nearOpen || squad.compressMul < 1) {
    // Smooth re-expand after choke
    squad.compressMul = Math.min(1, squad.compressMul + dt * 1.8);
  }

  let arrived = 0;
  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i]!;
    u.formationSlotIndex = i;
    u.followSquadMarch = true;

    if (squad.releasedSlotIds.has(u.id)) {
      // Temporary release — seek anchor, then rejoin when clear
      u.setFormationSeek(squad.anchorX, squad.anchorY);
      if (
        Math.hypot(u.x - squad.anchorX, u.y - squad.anchorY) < MEMBER_ARRIVE * 1.5 &&
        !atChoke
      ) {
        squad.releasedSlotIds.delete(u.id);
      }
    } else {
      const slot = slotWorld(squad, sorted.length, i, squad.compressMul);
      const seek = snapWalkable(gameMap, entities, slot.x, slot.y);
      u.setFormationSeek(seek.x, seek.y);
    }

    if (
      Math.hypot(u.x - (u.targetX ?? u.x), u.y - (u.targetY ?? u.y)) < MEMBER_ARRIVE
    ) {
      arrived++;
    }

    // Anti-stuck: release slot if unit reports prolonged stall
    if (u.consumeStuckSignal()) {
      squad.releasedSlotIds.add(u.id);
      u.clearPath();
      if (gameMap) {
        const repath = gameMap.findPath(u.x, u.y, squad.anchorX, squad.anchorY, entities);
        if (repath.length > 0) {
          u.applySharedPath(repath);
        }
      }
      // Lateral nudge perpendicular to facing
      const px = -squad.facingY;
      const py = squad.facingX;
      const side = (u.id % 2 === 0 ? 1 : -1) * 18;
      u.applyStuckNudge(px * side, py * side, gameMap, entities);
    }
  }

  const anchorDone =
    Math.hypot(squad.anchorX - squad.orderDestX, squad.anchorY - squad.orderDestY) <
    ANCHOR_ARRIVE;
  if (anchorDone && arrived >= Math.ceil(sorted.length * 0.7) && squad.compressMul > 0.9) {
    endSquadMarch(squad, sorted);
  }
}

export function endSquadMarch(squad: Squad, units: Unit[]): void {
  squad.marchActive = false;
  squad.anchorPath = [];
  squad.anchorIndex = 0;
  squad.compressMul = 1;
  squad.releasedSlotIds.clear();
  for (const u of units) {
    u.followSquadMarch = false;
    u.formationSlotIndex = -1;
  }
}

/** Attack ring so melee does not stack on one pixel. */
export function attackRingPoint(
  targetX: number,
  targetY: number,
  index: number,
  count: number,
  radius: number,
): { x: number; y: number } {
  if (count <= 1) return { x: targetX, y: targetY };
  const a = (index / count) * Math.PI * 2 + Math.PI * 0.25;
  return {
    x: targetX + Math.cos(a) * radius,
    y: targetY + Math.sin(a) * radius,
  };
}

function advanceAnchor(squad: Squad, step: number, gameMap: GameMap | undefined): void {
  if (squad.anchorPath.length === 0) {
    squad.anchorX = squad.orderDestX;
    squad.anchorY = squad.orderDestY;
    return;
  }
  let remaining = step;
  while (remaining > 0 && squad.anchorIndex < squad.anchorPath.length) {
    const wp = squad.anchorPath[squad.anchorIndex]!;
    const dx = wp.x - squad.anchorX;
    const dy = wp.y - squad.anchorY;
    const dist = Math.hypot(dx, dy);
    if (dist <= ANCHOR_ARRIVE) {
      squad.anchorIndex++;
      continue;
    }
    const take = Math.min(remaining, dist);
    squad.anchorX += (dx / dist) * take;
    squad.anchorY += (dy / dist) * take;
    remaining -= take;
    if (dist - take <= ANCHOR_ARRIVE) squad.anchorIndex++;
  }
  if (squad.anchorIndex >= squad.anchorPath.length) {
    squad.anchorX = squad.orderDestX;
    squad.anchorY = squad.orderDestY;
  }
  if (gameMap && !gameMap.isWalkable(squad.anchorX, squad.anchorY)) {
    const snapped = snapWalkable(gameMap, undefined, squad.anchorX, squad.anchorY);
    squad.anchorX = snapped.x;
    squad.anchorY = snapped.y;
  }
}

function slotWorld(
  squad: Squad,
  count: number,
  index: number,
  compressMul: number,
): { x: number; y: number } {
  // At chokes, force a temporary column along facing (does not change player formation).
  if (compressMul < 0.55) {
    const fileGap = 22;
    const along = (index - (count - 1) / 2) * fileGap;
    const fx = squad.facingX;
    const fy = squad.facingY;
    return {
      x: squad.anchorX - fx * along,
      y: squad.anchorY - fy * along,
    };
  }
  const spacing = FORMATION_BASE_SPACING * compressMul;
  const offsets = orientOffsets(
    formationOffsets(squad.formation, count, spacing),
    squad.facingX,
    squad.facingY,
  );
  const o = offsets[index] ?? { x: 0, y: 0 };
  return { x: squad.anchorX + o.x, y: squad.anchorY + o.y };
}

function isChokeTerrain(gameMap: GameMap | undefined, x: number, y: number): boolean {
  if (!gameMap) return false;
  const tile = gameMap.getTileAt(x, y);
  if (tile.type === 'bridge') return true;
  // Narrow gap: few walkable neighbors
  const ts = gameMap.tileSize;
  let walk = 0;
  for (let oy = -ts; oy <= ts; oy += ts) {
    for (let ox = -ts; ox <= ts; ox += ts) {
      if (ox === 0 && oy === 0) continue;
      if (gameMap.isWalkable(x + ox, y + oy)) walk++;
    }
  }
  return walk <= 3;
}

function snapWalkable(
  gameMap: GameMap | undefined,
  entities: Entity[] | undefined,
  x: number,
  y: number,
): { x: number; y: number } {
  if (!gameMap) return { x, y };
  if (gameMap.isWalkable(x, y)) return { x, y };
  // Use pathfinder goal snap via a trivial findPath start≈goal
  const path = gameMap.findPath(x, y, x, y, entities);
  if (path.length > 0) return { x: path[0]!.x, y: path[0]!.y };
  return { x, y };
}

function sortMembers(squad: Squad, units: Unit[]): Unit[] {
  return [...units].sort((a, b) => {
    if (a.id === squad.leaderId) return -1;
    if (b.id === squad.leaderId) return 1;
    return a.id - b.id;
  });
}

function centroidOf(units: Unit[]): { x: number; y: number } | null {
  if (units.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const u of units) {
    x += u.x;
    y += u.y;
  }
  return { x: x / units.length, y: y / units.length };
}
