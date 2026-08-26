import type { TerrainTile } from './Terrain';

export type PathPoint = { x: number; y: number };

const DIRS8 = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

export interface PathOptions {
  /**
   * Extra blocked tiles (1 = blocked). Same length as tiles grid.
   * Used for building footprints so paths go around structures.
   */
  blocked?: Uint8Array | null;
}

/**
 * A* pathfinding on the terrain grid.
 * Step cost uses each tile's `movementCost`; non-walkable / blocked tiles are impassable.
 * Returns world-space waypoint centers.
 */
export function findPath(
  tiles: TerrainTile[],
  width: number,
  height: number,
  tileSize: number,
  startWorldX: number,
  startWorldY: number,
  goalWorldX: number,
  goalWorldY: number,
  options?: PathOptions,
): PathPoint[] {
  const blocked = options?.blocked ?? null;
  const sx = clamp(Math.floor(startWorldX / tileSize), 0, width - 1);
  const sy = clamp(Math.floor(startWorldY / tileSize), 0, height - 1);
  let gx = clamp(Math.floor(goalWorldX / tileSize), 0, width - 1);
  let gy = clamp(Math.floor(goalWorldY / tileSize), 0, height - 1);

  const start = sy * width + sx;
  let goal = gy * width + gx;

  const passable = (i: number): boolean => {
    if (!tiles[i]?.walkable) return false;
    // Start tile may sit inside a building; still allow leaving it.
    if (blocked && blocked[i] && i !== start) return false;
    return true;
  };

  if (!tiles[goal]?.walkable || (blocked && blocked[goal])) {
    const nearest = findNearestPassable(tiles, width, height, gx, gy, blocked);
    if (!nearest) return [];
    gx = nearest.x;
    gy = nearest.y;
    goal = gy * width + gx;
  }

  if (!tiles[start]?.walkable) {
    const nearest = findNearestPassable(tiles, width, height, sx, sy, blocked);
    if (!nearest) return [];
    return findPath(
      tiles,
      width,
      height,
      tileSize,
      (nearest.x + 0.5) * tileSize,
      (nearest.y + 0.5) * tileSize,
      goalWorldX,
      goalWorldY,
      options,
    );
  }

  if (start === goal) {
    return [{ x: goalWorldX, y: goalWorldY }];
  }

  const size = width * height;
  const gScore = new Float32Array(size).fill(Infinity);
  const fScore = new Float32Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open: number[] = [start];

  gScore[start] = 0;
  fScore[start] = heuristic(sx, sy, gx, gy);

  while (open.length > 0) {
    let bestI = 0;
    let bestF = fScore[open[0]!]!;
    for (let i = 1; i < open.length; i++) {
      const f = fScore[open[i]!]!;
      if (f < bestF) {
        bestF = f;
        bestI = i;
      }
    }

    const current = open[bestI]!;
    open[bestI] = open[open.length - 1]!;
    open.pop();

    if (current === goal) {
      const path = reconstruct(cameFrom, current, width, tileSize);
      path.push({ x: goalWorldX, y: goalWorldY });
      return path;
    }

    closed[current] = 1;
    const cx = current % width;
    const cy = Math.floor(current / width);

    for (const d of DIRS8) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (closed[ni]) continue;
      if (!passable(ni)) continue;

      if (d.x !== 0 && d.y !== 0) {
        const a = cy * width + (cx + d.x);
        const b = (cy + d.y) * width + cx;
        if (!passable(a) || !passable(b)) continue;
      }

      const tile = tiles[ni]!;
      const step = tile.movementCost * (d.x !== 0 && d.y !== 0 ? 1.414 : 1);
      const tentative = gScore[current]! + step;
      if (tentative >= gScore[ni]!) continue;

      cameFrom[ni] = current;
      gScore[ni] = tentative;
      fScore[ni] = tentative + heuristic(nx, ny, gx, gy);
      if (!open.includes(ni)) open.push(ni);
    }
  }

  return [];
}

/**
 * Mark grid tiles overlapping solid building circles.
 * Radius inflated slightly so paths stay outside canOccupy soft radius.
 */
export function markBuildingBlockedTiles(
  blocked: Uint8Array,
  width: number,
  height: number,
  tileSize: number,
  buildings: Array<{ x: number; y: number; radius: number }>,
): void {
  blocked.fill(0);
  for (const b of buildings) {
    const r = b.radius * 0.95 + tileSize * 0.35;
    const rSq = r * r;
    const minTx = clamp(Math.floor((b.x - r) / tileSize), 0, width - 1);
    const maxTx = clamp(Math.floor((b.x + r) / tileSize), 0, width - 1);
    const minTy = clamp(Math.floor((b.y - r) / tileSize), 0, height - 1);
    const maxTy = clamp(Math.floor((b.y + r) / tileSize), 0, height - 1);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const cx = (tx + 0.5) * tileSize;
        const cy = (ty + 0.5) * tileSize;
        const dx = cx - b.x;
        const dy = cy - b.y;
        if (dx * dx + dy * dy <= rSq) {
          blocked[ty * width + tx] = 1;
        }
      }
    }
  }
}

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
}

function reconstruct(
  cameFrom: Int32Array,
  current: number,
  width: number,
  tileSize: number,
): PathPoint[] {
  const path: PathPoint[] = [];
  let cur = current;
  while (cur !== -1) {
    const x = cur % width;
    const y = Math.floor(cur / width);
    path.push({ x: (x + 0.5) * tileSize, y: (y + 0.5) * tileSize });
    cur = cameFrom[cur]!;
  }
  path.reverse();
  return path;
}

function findNearestPassable(
  tiles: TerrainTile[],
  width: number,
  height: number,
  cx: number,
  cy: number,
  blocked: Uint8Array | null,
): { x: number; y: number } | null {
  for (let r = 0; r < 16; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = y * width + x;
        if (!tiles[i]?.walkable) continue;
        if (blocked && blocked[i]) continue;
        return { x, y };
      }
    }
  }
  return null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
