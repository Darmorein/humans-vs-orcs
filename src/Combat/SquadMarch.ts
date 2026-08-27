import type { GameMap } from '../Map/GameMap.ts';
import type { PathPoint } from '../Map/Pathfinding.ts';
import type { Entity } from '../Entities/Entity.ts';
import { Building } from '../Entities/Building.ts';
import { Unit } from '../Entities/Unit.ts';
import { isHostile } from '../Players/Relations.ts';
import type { Squad } from './Squad.ts';
import { FORMATION_DEFS } from './FormationDefs.ts';
import { formationOffsets, orientOffsets } from './Formations.ts';

/** Minimum slot spacing so soft collision (~0.88 * radii) does not fight destinations. */
export const FORMATION_BASE_SPACING = 46;

/** Temporary column scale at bridges / narrow gaps (does not change player formation). */
export const CHOKE_COMPRESS_MUL = 0.38;

/** Max distance from combat / hold anchor before chase is cancelled. */
export const COMBAT_LEASH = FORMATION_BASE_SPACING * 2.0;

const ANCHOR_ARRIVE = 10;
const MEMBER_ARRIVE = 14;
const OPEN_EXPAND_DIST = 56;
const SLOT_SEARCH_RADIUS = 48;
const REPATH_COOLDOWN_SEC = 1.25;
const LAG_DIST = 42;

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
  clearEngageState(squad);
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
      path = [{ x: goalX, y: goalY }];
    }
  } else {
    path = [{ x: goalX, y: goalY }];
  }

  squad.orderMode = 'march';
  squad.marchActive = true;
  squad.orderDestX = goalX;
  squad.orderDestY = goalY;
  squad.anchorPath = path;
  squad.anchorIndex = 0;
  squad.anchorX = center.x;
  squad.anchorY = center.y;
  squad.compressMul = 1;
  squad.repathCooldown = 0;
  squad.stuckAccum = 0;

  const sorted = sortMembers(squad, units);
  const fx = FORMATION_DEFS[squad.formation];
  const sampleR = sorted[0]?.radius ?? 12;
  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i]!;
    u.formationSlotIndex = i;
    u.followSquadMarch = true;
    u.squadOrderMode = 'march';
    u.clearStuckProgress();
    const slot = slotWorld(squad, sorted.length, i, 1);
    const seek = findNearestValidFormationPoint(gameMap, entities, slot.x, slot.y, sampleR);
    u.setFormationSeek(seek.x, seek.y);
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
  const speedMul = cohesionSpeedMul(squad, sorted);
  advanceAnchor(squad, speed * dt * speedMul, gameMap);

  const atChoke = isChokeTerrain(gameMap, squad.anchorX, squad.anchorY);
  const nearOpen =
    !atChoke &&
    Math.hypot(squad.anchorX - squad.orderDestX, squad.anchorY - squad.orderDestY) > OPEN_EXPAND_DIST;
  if (atChoke) {
    squad.compressMul = CHOKE_COMPRESS_MUL;
  } else if (nearOpen || squad.compressMul < 1) {
    squad.compressMul = Math.min(1, squad.compressMul + dt * 1.8);
  }

  if (squad.repathCooldown > 0) squad.repathCooldown -= dt;

  let arrived = 0;
  let stuckCount = 0;
  let maxLag = 0;
  const sampleR = sorted[0]?.radius ?? 12;

  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i]!;
    u.formationSlotIndex = i;
    u.followSquadMarch = true;
    u.squadOrderMode = 'march';
    u.squadPrimaryTargetId = null;
    if (u.unstickCooldown > 0) u.unstickCooldown = Math.max(0, u.unstickCooldown - dt);

    const slot = slotWorld(squad, sorted.length, i, squad.compressMul);
    // Cheap path: only spiral-search when the ideal slot is blocked.
    const seek = findNearestValidFormationPoint(gameMap, entities, slot.x, slot.y, sampleR, 36);
    u.refreshFormationSeek(seek.x, seek.y);
    u.facingX = squad.facingX;
    u.facingY = squad.facingY;

    const lag = Math.hypot(u.x - seek.x, u.y - seek.y);
    maxLag = Math.max(maxLag, lag);
    if (lag < MEMBER_ARRIVE) {
      arrived++;
    }

    // Expensive rescue only on stuck signal + cooldown (not every frame).
    if (u.consumeStuckSignal() && u.unstickCooldown <= 0) {
      stuckCount++;
      recoverFormationStuck(u, seek, squad, gameMap, entities);
      u.unstickCooldown = 0.85;
    }
  }

  squad.stuckAccum = stuckCount;
  const n = sorted.length;
  const stuckThreshold = n <= 3 ? 2 : Math.max(2, Math.ceil(n * 0.25));
  if (stuckCount >= stuckThreshold && squad.repathCooldown <= 0) {
    repathSquadAnchor(squad, gameMap, entities, sorted);
    squad.repathCooldown = REPATH_COOLDOWN_SEC;
  }

  const anchorDone =
    Math.hypot(squad.anchorX - squad.orderDestX, squad.anchorY - squad.orderDestY) <
    ANCHOR_ARRIVE;
  // Don't abandon stragglers — wait until lag closes or rescue pulls them in.
  if (
    anchorDone &&
    arrived >= Math.ceil(sorted.length * 0.7) &&
    maxLag < MEMBER_ARRIVE * 3.5 &&
    squad.compressMul > 0.9
  ) {
    if (FORMATION_DEFS[squad.formation].holdGround) {
      beginSquadHold(squad, sorted, gameMap, entities);
    } else {
      endSquadMarch(squad, sorted, gameMap, entities);
    }
  }
}

export function endSquadMarch(
  squad: Squad,
  units: Unit[],
  gameMap?: GameMap,
  entities?: Entity[],
): void {
  squad.marchActive = false;
  squad.anchorPath = [];
  squad.anchorIndex = 0;
  squad.compressMul = 1;
  squad.stuckAccum = 0;
  if (squad.orderMode === 'march') {
    squad.orderMode = FORMATION_DEFS[squad.formation].holdGround ? 'hold' : 'idle';
  }
  for (const u of units) {
    if (entities) ejectIfInvalidPosition(u, gameMap, entities);
    u.followSquadMarch = false;
    u.formationSlotIndex = -1;
    if (u.squadOrderMode === 'march') u.squadOrderMode = 'none';
  }
}

/**
 * Squad Engage: shared primary target, combat anchor, front-facing slots, leash.
 */
export function beginSquadEngage(
  squad: Squad,
  target: Entity,
  units: Unit[],
  gameMap: GameMap | undefined,
  entities: Entity[],
): void {
  endSquadMarchQuiet(squad, units);
  const center = centroidOf(units) ?? { x: target.x, y: target.y };
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const len = Math.hypot(dx, dy) || 1;
  squad.facingX = dx / len;
  squad.facingY = dy / len;

  squad.orderMode = 'engage';
  squad.engageActive = true;
  squad.primaryTargetId = target.id;
  squad.marchActive = false;
  const standoff = Math.max(36, (squad.range || 40) * 0.55);
  squad.combatAnchorX = target.x - (dx / len) * Math.min(standoff, len * 0.5);
  squad.combatAnchorY = target.y - (dy / len) * Math.min(standoff, len * 0.5);
  squad.repathCooldown = 0;
  squad.stuckAccum = 0;

  const sorted = sortMembers(squad, units);
  const fx = FORMATION_DEFS[squad.formation];
  applyCombatSlots(squad, sorted, target, gameMap, entities, fx.id === 'charge');
}

export function steerSquadEngage(
  squad: Squad,
  units: Unit[],
  dt: number,
  gameMap: GameMap | undefined,
  entities: Entity[],
): void {
  if (!squad.engageActive || units.length === 0) return;

  const sorted = sortMembers(squad, units);
  let target = findEntityById(entities, squad.primaryTargetId);
  if (!target || target.isDead) {
    target = pickNextPrimaryTarget(squad, sorted, entities);
    squad.primaryTargetId = target?.id ?? null;
  }
  if (!target) {
    if (FORMATION_DEFS[squad.formation].holdGround) {
      beginSquadHold(squad, sorted, gameMap, entities);
    } else {
      endSquadEngage(squad, sorted);
    }
    return;
  }

  const center = centroidOf(sorted) ?? { x: squad.combatAnchorX, y: squad.combatAnchorY };
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const len = Math.hypot(dx, dy) || 1;
  squad.facingX = dx / len;
  squad.facingY = dy / len;

  const standoff = Math.max(36, (squad.range || 40) * 0.55);
  const desiredX = target.x - (dx / len) * Math.min(standoff, len * 0.5);
  const desiredY = target.y - (dy / len) * Math.min(standoff, len * 0.5);
  const lerp = Math.min(1, dt * 2.2);
  squad.combatAnchorX += (desiredX - squad.combatAnchorX) * lerp;
  squad.combatAnchorY += (desiredY - squad.combatAnchorY) * lerp;

  if (squad.repathCooldown > 0) squad.repathCooldown -= dt;

  let stuckCount = 0;
  const fx = FORMATION_DEFS[squad.formation];
  applyCombatSlots(squad, sorted, target, gameMap, entities, fx.id === 'charge');

  for (const u of sorted) {
    if (u.unstickCooldown > 0) u.unstickCooldown = Math.max(0, u.unstickCooldown - dt);
    if (u.consumeStuckSignal() && u.unstickCooldown <= 0) {
      stuckCount++;
      const seek = {
        x: u.targetX ?? squad.combatAnchorX,
        y: u.targetY ?? squad.combatAnchorY,
      };
      recoverFormationStuck(u, seek, squad, gameMap, entities);
      u.unstickCooldown = 0.85;
    }
  }
  squad.stuckAccum = stuckCount;
  const n = sorted.length;
  const stuckThreshold = n <= 3 ? 2 : Math.max(2, Math.ceil(n * 0.25));
  if (stuckCount >= stuckThreshold && squad.repathCooldown <= 0) {
    // Nudge combat anchor slightly toward centroid so slots become reachable.
    squad.combatAnchorX = squad.combatAnchorX * 0.65 + center.x * 0.35;
    squad.combatAnchorY = squad.combatAnchorY * 0.65 + center.y * 0.35;
    squad.repathCooldown = REPATH_COOLDOWN_SEC;
  }
}

export function endSquadEngage(squad: Squad, units: Unit[]): void {
  squad.engageActive = false;
  squad.primaryTargetId = null;
  if (squad.orderMode === 'engage') {
    squad.orderMode = FORMATION_DEFS[squad.formation].holdGround ? 'hold' : 'idle';
  }
  for (const u of units) {
    u.followSquadMarch = false;
    u.formationSlotIndex = -1;
    u.squadPrimaryTargetId = null;
    if (u.squadOrderMode === 'engage') u.squadOrderMode = 'none';
  }
}

/** Hold: fixed anchor, formation slots, local weapon-range only. */
export function beginSquadHold(
  squad: Squad,
  units: Unit[],
  gameMap: GameMap | undefined,
  entities: Entity[],
): void {
  clearEngageState(squad);
  squad.marchActive = false;
  squad.anchorPath = [];
  squad.orderMode = 'hold';
  const center = centroidOf(units) ?? { x: squad.anchorX, y: squad.anchorY };
  squad.holdAnchorX = center.x;
  squad.holdAnchorY = center.y;
  squad.anchorX = center.x;
  squad.anchorY = center.y;
  squad.compressMul = 1;

  const sorted = sortMembers(squad, units);
  const sampleR = sorted[0]?.radius ?? 12;
  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i]!;
    u.formationSlotIndex = i;
    u.followSquadMarch = true;
    u.squadOrderMode = 'hold';
    u.holdGround = true;
    u.squadPrimaryTargetId = null;
    u.combatAnchorX = squad.holdAnchorX;
    u.combatAnchorY = squad.holdAnchorY;
    u.combatLeash = COMBAT_LEASH;
    const slot = slotWorldAt(
      squad.holdAnchorX,
      squad.holdAnchorY,
      squad.facingX,
      squad.facingY,
      squad.formation,
      sorted.length,
      i,
      1,
    );
    const seek = findNearestValidFormationPoint(gameMap, entities, slot.x, slot.y, sampleR);
    u.setFormationSeek(seek.x, seek.y);
    u.facingX = squad.facingX;
    u.facingY = squad.facingY;
  }
}

export function steerSquadHold(
  squad: Squad,
  units: Unit[],
  dt: number,
  gameMap: GameMap | undefined,
  entities: Entity[],
): void {
  if (squad.orderMode !== 'hold' || units.length === 0) return;
  void dt;
  const sorted = sortMembers(squad, units);
  const sampleR = sorted[0]?.radius ?? 12;
  for (let i = 0; i < sorted.length; i++) {
    const u = sorted[i]!;
    u.formationSlotIndex = i;
    u.followSquadMarch = true;
    u.squadOrderMode = 'hold';
    u.holdGround = true;
    u.combatAnchorX = squad.holdAnchorX;
    u.combatAnchorY = squad.holdAnchorY;
    u.combatLeash = COMBAT_LEASH;
    const slot = slotWorldAt(
      squad.holdAnchorX,
      squad.holdAnchorY,
      squad.facingX,
      squad.facingY,
      squad.formation,
      sorted.length,
      i,
      1,
    );
    const seek = findNearestValidFormationPoint(gameMap, entities, slot.x, slot.y, sampleR);
    // Prefer returning to slot over free chase — keep seek even if local target exists.
    if (!u.targetEntity || u.targetEntity.isDead) {
      u.refreshFormationSeek(seek.x, seek.y);
    } else {
      u.refreshFormationSeek(seek.x, seek.y);
    }
    u.facingX = squad.facingX;
    u.facingY = squad.facingY;
  }
}

/** @deprecated Prefer front combat slots — kept for tests / legacy callers. */
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

function applyCombatSlots(
  squad: Squad,
  sorted: Unit[],
  target: Entity,
  gameMap: GameMap | undefined,
  entities: Entity[],
  chargeReady: boolean,
): void {
  const sampleR = sorted[0]?.radius ?? 12;
  const n = sorted.length;
  for (let i = 0; i < n; i++) {
    const u = sorted[i]!;
    u.formationSlotIndex = i;
    u.followSquadMarch = true;
    u.squadOrderMode = 'engage';
    u.squadPrimaryTargetId = target.id;
    u.combatAnchorX = squad.combatAnchorX;
    u.combatAnchorY = squad.combatAnchorY;
    u.combatLeash = COMBAT_LEASH;

    let slot = slotWorldAt(
      squad.combatAnchorX,
      squad.combatAnchorY,
      squad.facingX,
      squad.facingY,
      squad.formation,
      n,
      i,
      1,
    );
    // Ranged: stay behind the front line.
    if (u.isRanged) {
      slot = {
        x: slot.x - squad.facingX * FORMATION_BASE_SPACING * 0.9,
        y: slot.y - squad.facingY * FORMATION_BASE_SPACING * 0.9,
      };
    }
    const seek = findNearestValidFormationPoint(gameMap, entities, slot.x, slot.y, sampleR);

    const distToAnchor = Math.hypot(u.x - squad.combatAnchorX, u.y - squad.combatAnchorY);
    const weaponReach = u.attackRange + target.radius + u.radius;
    const distToTarget = Math.hypot(target.x - u.x, target.y - u.y);

    if (distToTarget <= weaponReach && distToAnchor <= COMBAT_LEASH * 1.15) {
      u.setLocalCombatTarget(target);
      u.refreshFormationSeek(seek.x, seek.y);
    } else if (distToAnchor > COMBAT_LEASH) {
      u.setFormationSeek(seek.x, seek.y);
    } else {
      u.refreshFormationSeek(seek.x, seek.y);
      u.squadPrimaryTargetId = target.id;
    }

    if (chargeReady) u.chargeStrikeReady = true;
    u.facingX = squad.facingX;
    u.facingY = squad.facingY;
  }
}

function cohesionSpeedMul(squad: Squad, units: Unit[]): number {
  if (units.length === 0) return 1;
  let lagging = 0;
  let worst = 0;
  for (const u of units) {
    const tx = u.targetX ?? squad.anchorX;
    const ty = u.targetY ?? squad.anchorY;
    const d = Math.hypot(u.x - tx, u.y - ty);
    worst = Math.max(worst, d);
    if (d > LAG_DIST) lagging++;
  }
  const ratio = lagging / units.length;
  // One member wedged in base while others march — stop dragging the formation away.
  if (worst > 110 || uHasHighStuckStreak(units)) return 0.2;
  if (ratio > 0.35) return 0.45;
  if (ratio > 0.2) return 0.7;
  return 1;
}

function uHasHighStuckStreak(units: Unit[]): boolean {
  for (const u of units) {
    if (u.formationStuckStreak >= 2) return true;
  }
  return false;
}

/**
 * Escalating unstick while staying on the squad order.
 * Pinched between buildings → hard rescue (cooldown-gated by caller).
 */
function recoverFormationStuck(
  u: Unit,
  seek: { x: number; y: number },
  squad: Squad,
  gameMap: GameMap | undefined,
  entities: Entity[],
): void {
  u.formationStuckStreak += 1;
  const streak = u.formationStuckStreak;
  const buildings = collectBuildings(entities);
  const pinched = isPinchedBetweenBuildings(u, buildings);

  if (pinched || streak >= 2) {
    hardRescueUnit(u, seek.x, seek.y, gameMap, buildings);
    if (stillPinchedOrInvalid(u, gameMap, buildings)) {
      hardRescueUnit(u, squad.anchorX, squad.anchorY, gameMap, buildings);
    }
    u.refreshFormationSeek(seek.x, seek.y);
    u.formationStuckStreak = 0;
    u.clearStuckProgress();
    return;
  }

  const px = -squad.facingY;
  const py = squad.facingX;
  const side = (u.id % 2 === 0 ? 1 : -1) * 16;
  u.applyStuckNudge(px * side, py * side, gameMap, entities);
  const dx = seek.x - u.x;
  const dy = seek.y - u.y;
  const len = Math.hypot(dx, dy) || 1;
  u.applyStuckNudge((dx / len) * 18, (dy / len) * 18, gameMap, entities);
  u.clearPath();

  if (gameMap) {
    const path = gameMap.findPath(u.x, u.y, seek.x, seek.y, entities);
    if (path.length > 0) {
      u.applySharedPath(path);
      u.refreshFormationSeek(seek.x, seek.y);
    }
  }
}

function stillPinchedOrInvalid(
  u: Unit,
  gameMap: GameMap | undefined,
  buildings: Building[],
): boolean {
  return (
    isPinchedBetweenBuildings(u, buildings) ||
    !isComfortablyClear(gameMap, buildings, u.x, u.y, u.radius)
  );
}

/** Two+ building soft radii overlapping the unit = classic base corridor trap. */
function isPinchedBetweenBuildings(u: Unit, buildings: Building[]): boolean {
  let near = 0;
  for (const e of buildings) {
    const r = u.radius * 0.7 + e.radius * 1.05 + 10;
    if ((u.x - e.x) * (u.x - e.x) + (u.y - e.y) * (u.y - e.y) < r * r) {
      near++;
      if (near >= 2) return true;
    }
  }
  return false;
}

/**
 * Teleport to the nearest comfortably clear point toward a preferred destination.
 * Stays on squad order — does not open a solo strategic path.
 */
function hardRescueUnit(
  u: Unit,
  preferX: number,
  preferY: number,
  gameMap: GameMap | undefined,
  buildings: Building[],
): void {
  const probes = [
    { x: preferX, y: preferY },
    { x: u.x + (preferX - u.x) * 0.55, y: u.y + (preferY - u.y) * 0.55 },
    { x: u.x, y: u.y },
  ];
  for (const p of probes) {
    const spot = findComfortablePoint(gameMap, buildings, p.x, p.y, u.radius, 64);
    if (spot) {
      u.x = spot.x;
      u.y = spot.y;
      u.clearPath();
      return;
    }
  }
}

/** Pop a unit out of terrain / building solid if currently invalid or pinched. */
function ejectIfInvalidPosition(
  u: Unit,
  gameMap: GameMap | undefined,
  entities: Entity[],
): boolean {
  const buildings = collectBuildings(entities);
  if (
    isComfortablyClear(gameMap, buildings, u.x, u.y, u.radius) &&
    !isPinchedBetweenBuildings(u, buildings)
  ) {
    return false;
  }
  hardRescueUnit(u, u.x, u.y, gameMap, buildings);
  return true;
}

function collectBuildings(entities: Entity[] | undefined): Building[] {
  if (!entities) return [];
  const out: Building[] = [];
  for (const e of entities) {
    if (e instanceof Building && !e.isDead) out.push(e);
  }
  return out;
}

/** Clear of terrain + buildings with a comfort margin (no corridor traps). */
export function isComfortablyClear(
  gameMap: GameMap | undefined,
  buildingsOrEntities: Building[] | Entity[] | undefined,
  x: number,
  y: number,
  unitRadius: number,
): boolean {
  if (gameMap && !gameMap.isWalkable(x, y)) return false;
  if (!buildingsOrEntities || buildingsOrEntities.length === 0) return true;
  const margin = unitRadius * 0.7 + 10;
  for (const e of buildingsOrEntities) {
    if (!(e instanceof Building) || e.isDead) continue;
    const r = margin + e.radius * 0.95;
    if ((x - e.x) * (x - e.x) + (y - e.y) * (y - e.y) < r * r) return false;
  }
  return true;
}

/**
 * Local search for a formation slot that is walkable, clear of building solids,
 * and accounts for unit collision radius.
 */
export function findNearestValidFormationPoint(
  gameMap: GameMap | undefined,
  entities: Entity[] | undefined,
  x: number,
  y: number,
  unitRadius: number,
  maxRadius = SLOT_SEARCH_RADIUS,
): { x: number; y: number } {
  const buildings = collectBuildings(entities);
  if (isComfortablyClear(gameMap, buildings, x, y, unitRadius)) return { x, y };
  const comfort = findComfortablePoint(gameMap, buildings, x, y, unitRadius, maxRadius);
  if (comfort) return comfort;
  return snapWalkable(gameMap, entities, x, y);
}

export function isValidFormationPoint(
  gameMap: GameMap | undefined,
  entities: Entity[] | undefined,
  x: number,
  y: number,
  unitRadius: number,
): boolean {
  return isComfortablyClear(gameMap, collectBuildings(entities), x, y, unitRadius);
}

/** Capped spiral — mobile-safe (≤ ~6 rings × 8 samples). */
function findComfortablePoint(
  gameMap: GameMap | undefined,
  buildings: Building[],
  x: number,
  y: number,
  unitRadius: number,
  maxRadius: number,
): { x: number; y: number } | null {
  if (isComfortablyClear(gameMap, buildings, x, y, unitRadius)) return { x, y };
  const step = 14;
  const limit = Math.min(maxRadius, 70);
  for (let r = step; r <= limit; r += step) {
    const samples = 8;
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (isComfortablyClear(gameMap, buildings, px, py, unitRadius)) {
        return { x: px, y: py };
      }
    }
  }
  return null;
}

function repathSquadAnchor(
  squad: Squad,
  gameMap: GameMap | undefined,
  entities: Entity[],
  units: Unit[],
): void {
  if (!gameMap) return;
  const center = centroidOf(units) ?? { x: squad.anchorX, y: squad.anchorY };
  const path = gameMap.findPath(center.x, center.y, squad.orderDestX, squad.orderDestY, entities);
  if (path.length === 0) return;
  squad.anchorPath = path;
  squad.anchorIndex = 0;
  squad.anchorX = center.x;
  squad.anchorY = center.y;
  for (const u of units) {
    u.clearPath();
    u.clearStuckProgress();
  }
}

function endSquadMarchQuiet(squad: Squad, units: Unit[]): void {
  squad.marchActive = false;
  squad.anchorPath = [];
  squad.anchorIndex = 0;
  squad.compressMul = 1;
  for (const u of units) {
    u.formationSlotIndex = -1;
  }
}

function clearEngageState(squad: Squad): void {
  squad.engageActive = false;
  squad.primaryTargetId = null;
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
  return slotWorldAt(
    squad.anchorX,
    squad.anchorY,
    squad.facingX,
    squad.facingY,
    squad.formation,
    count,
    index,
    compressMul,
  );
}

function slotWorldAt(
  ax: number,
  ay: number,
  facingX: number,
  facingY: number,
  formation: Squad['formation'],
  count: number,
  index: number,
  compressMul: number,
): { x: number; y: number } {
  if (compressMul < 0.55) {
    const fileGap = 22;
    const along = (index - (count - 1) / 2) * fileGap;
    return {
      x: ax - facingX * along,
      y: ay - facingY * along,
    };
  }
  const spacing = FORMATION_BASE_SPACING * compressMul;
  const offsets = orientOffsets(
    formationOffsets(formation, count, spacing),
    facingX,
    facingY,
  );
  const o = offsets[index] ?? { x: 0, y: 0 };
  return { x: ax + o.x, y: ay + o.y };
}

function isChokeTerrain(gameMap: GameMap | undefined, x: number, y: number): boolean {
  if (!gameMap) return false;
  const tile = gameMap.getTileAt(x, y);
  if (tile.type === 'bridge') return true;
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

function findEntityById(entities: Entity[], id: number | null): Entity | null {
  if (id == null) return null;
  for (const e of entities) {
    if (e.id === id && !e.isDead) return e;
  }
  return null;
}

function pickNextPrimaryTarget(
  squad: Squad,
  members: Unit[],
  entities: Entity[],
): Entity | null {
  if (members.length === 0) return null;
  const probe = members[0]!;
  const ax = squad.combatAnchorX;
  const ay = squad.combatAnchorY;
  let best: Entity | null = null;
  let bestDist = 220;
  for (const e of entities) {
    if (!(e instanceof Unit) || e.isDead || !isHostile(probe, e)) continue;
    const d = Math.hypot(e.x - ax, e.y - ay);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}
