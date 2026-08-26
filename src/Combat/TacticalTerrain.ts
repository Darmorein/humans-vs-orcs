import type { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import type { GameMap } from '../Map/GameMap';
import { isForestTerrain, type TerrainType } from '../Map/Terrain';
import { isHostile } from '../Players/Relations';

/**
 * Lightweight tactical heuristics — hills, forest, roads, bridges, flanks.
 * Scores are relative weights (e.g. Hold Hill +20), not ML.
 */

export interface TacticalFactor {
  id: string;
  label: string;
  score: number;
}

export interface TacticalAssessment {
  total: number;
  factors: TacticalFactor[];
}

const ELEV_EPS = 0.04;

function push(factors: TacticalFactor[], id: string, label: string, score: number) {
  if (score === 0) return;
  factors.push({ id, label, score });
}

/** True when attacker approaches from behind defender facing. */
export function isFlanking(
  attackerX: number,
  attackerY: number,
  defenderX: number,
  defenderY: number,
  facingX: number,
  facingY: number,
  threshold = -0.15,
): boolean {
  const ax = attackerX - defenderX;
  const ay = attackerY - defenderY;
  const len = Math.hypot(ax, ay);
  if (len < 1) return false;
  const flen = Math.hypot(facingX, facingY);
  if (flen < 1e-3) return false;
  const dot = (ax / len) * (facingX / flen) + (ay / len) * (facingY / flen);
  return dot < threshold;
}

/** Positive = attacker higher than defender. */
export function elevationDelta(
  map: GameMap,
  ax: number,
  ay: number,
  dx: number,
  dy: number,
): number {
  return map.getTileAt(ax, ay).elevation - map.getTileAt(dx, dy).elevation;
}

export function nearTerrain(
  map: GameMap,
  x: number,
  y: number,
  types: TerrainType[],
  radiusWorld: number,
): boolean {
  const r = Math.ceil(radiusWorld / map.tileSize);
  const { tx, ty } = map.worldToTile(x, y);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x2 = tx + dx;
      const y2 = ty + dy;
      if (x2 < 0 || y2 < 0 || x2 >= map.tileWidth || y2 >= map.tileHeight) continue;
      const t = map.tiles[y2 * map.tileWidth + x2]!.type;
      if (types.includes(t)) return true;
    }
  }
  return false;
}

export function nearestBridgeDist(map: GameMap, x: number, y: number): number {
  let best = Infinity;
  for (const b of map.findBridgeCenters()) {
    best = Math.min(best, Math.hypot(b.x - x, b.y - y));
  }
  return best;
}

/**
 * Score a static hold / stand position (own squad centroid or candidate).
 */
export function assessHoldPosition(
  map: GameMap,
  x: number,
  y: number,
  opts?: { isRanged?: boolean; enemiesNearby?: number },
): TacticalAssessment {
  const factors: TacticalFactor[] = [];
  const tile = map.getTileAt(x, y);
  const isRanged = opts?.isRanged ?? false;
  const enemies = opts?.enemiesNearby ?? 0;

  if (tile.type === 'hill') push(factors, 'holdHill', 'Hold Hill', +20);

  const bridgeDist = nearestBridgeDist(map, x, y);
  if (bridgeDist < 70) push(factors, 'defendBridge', 'Defend Bridge', +25);
  else if (bridgeDist < 120) push(factors, 'nearChoke', 'Near Choke', +10);

  if (isForestTerrain(tile.type)) {
    push(factors, 'forestCover', 'Forest Cover', isRanged ? +12 : +8);
  }

  if (tile.type === 'road') push(factors, 'onRoad', 'On Road', +5);

  if (isRanged && enemies > 0) {
    const exposed =
      tile.type === 'grass' ||
      tile.type === 'road' ||
      (tile.type === 'hill' && !isForestTerrain(tile.type));
    const open = !isForestTerrain(tile.type) && tile.type !== 'denseForest';
    if (open && (exposed || tile.defenseModifier < 0.1)) {
      push(factors, 'exposedArchers', 'Exposed Archers', -20);
    }
  }

  if (tile.type === 'bridge' && enemies >= 2) {
    push(factors, 'holdChoke', 'Hold Choke', +15);
  }

  return summarize(factors);
}

/**
 * Score attacker vs defender engagement (combat + AI targeting).
 */
export function assessEngagement(
  map: GameMap,
  attacker: Unit,
  defender: Entity,
): TacticalAssessment {
  const factors: TacticalFactor[] = [];
  const elev = elevationDelta(map, attacker.x, attacker.y, defender.x, defender.y);

  if (elev < -ELEV_EPS) push(factors, 'attackUphill', 'Attack Uphill', -15);
  else if (elev > ELEV_EPS) push(factors, 'attackDownhill', 'Attack Downhill', +10);

  if (defender instanceof Unit) {
    if (
      isFlanking(
        attacker.x,
        attacker.y,
        defender.x,
        defender.y,
        defender.facingX,
        defender.facingY,
      )
    ) {
      push(factors, 'enemyFlank', 'Enemy Flank', +15);
    }
  }

  const aTile = map.getTileAt(attacker.x, attacker.y);
  const dTile = map.getTileAt(defender.x, defender.y);

  if (aTile.type === 'hill') push(factors, 'fireFromHill', 'Fire From Hill', +8);
  if (isForestTerrain(dTile.type) && attacker.isRanged) {
    push(factors, 'targetInForest', 'Target In Forest', -10);
  }
  if (attacker.isRanged && (aTile.type === 'grass' || aTile.type === 'road')) {
    // Soft exposure while shooting from open ground
    push(factors, 'exposedArchers', 'Exposed Archers', -12);
  }

  if (dTile.type === 'bridge' || nearestBridgeDist(map, defender.x, defender.y) < 55) {
    push(factors, 'fightAtChoke', 'Fight At Choke', +6);
  }

  if (aTile.type === 'road') push(factors, 'roadApproach', 'Road Approach', +4);

  return summarize(factors);
}

/**
 * Convert assessment score into outgoing damage multiplier (~±20% soft cap).
 */
export function damageMultiplierFromScore(score: number): number {
  return clamp(1 + score * 0.004, 0.75, 1.25);
}

/**
 * Incoming damage multiplier for defender context (reverse of attacker advantage).
 */
export function takenMultiplierFromEngagement(
  map: GameMap,
  attacker: Unit,
  defender: Unit,
): number {
  const a = assessEngagement(map, attacker, defender);
  // Attacker advantage → we take more; their uphill penalty → we take less
  return clamp(1 + a.total * 0.0035, 0.78, 1.22);
}

/** Pick best world point among candidates by hold score. */
export function pickBestHoldPoint(
  map: GameMap,
  candidates: { x: number; y: number }[],
  opts?: { isRanged?: boolean; enemiesNearby?: number },
): { x: number; y: number; assessment: TacticalAssessment } | null {
  let best: { x: number; y: number; assessment: TacticalAssessment } | null = null;
  for (const c of candidates) {
    const assessment = assessHoldPosition(map, c.x, c.y, opts);
    if (!best || assessment.total > best.assessment.total) {
      best = { x: c.x, y: c.y, assessment };
    }
  }
  return best;
}

/** Build candidate tactical points near a focus (hills, bridges, forest edge). */
export function gatherTacticalCandidates(
  map: GameMap,
  focusX: number,
  focusY: number,
  radius: number,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const hill = map.findHillNear(focusX, focusY, radius);
  if (hill) out.push(hill);

  for (const b of map.findBridgeCenters()) {
    if (Math.hypot(b.x - focusX, b.y - focusY) <= radius) out.push(b);
  }

  // Sample forest tiles near focus
  const r = Math.ceil(radius / map.tileSize);
  const { tx, ty } = map.worldToTile(focusX, focusY);
  let forestSamples = 0;
  for (let dy = -r; dy <= r && forestSamples < 4; dy++) {
    for (let dx = -r; dx <= r && forestSamples < 4; dx++) {
      const x2 = tx + dx;
      const y2 = ty + dy;
      if (x2 < 0 || y2 < 0 || x2 >= map.tileWidth || y2 >= map.tileHeight) continue;
      const tile = map.tiles[y2 * map.tileWidth + x2]!;
      if (!isForestTerrain(tile.type)) continue;
      out.push({ x: (x2 + 0.5) * map.tileSize, y: (y2 + 0.5) * map.tileSize });
      forestSamples++;
    }
  }

  return out;
}

export function countHostilesNear(
  entities: Entity[],
  self: Entity,
  x: number,
  y: number,
  radius: number,
): number {
  let n = 0;
  const r2 = radius * radius;
  for (const e of entities) {
    if (!(e instanceof Unit) || e.isDead || !isHostile(self, e)) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    if (dx * dx + dy * dy <= r2) n++;
  }
  return n;
}

function summarize(factors: TacticalFactor[]): TacticalAssessment {
  let total = 0;
  for (const f of factors) total += f.score;
  return { total, factors };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
