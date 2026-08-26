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

/**
 * A* pathfinding on the terrain grid.
 * Step cost uses each tile's `movementCost` (Terrain System v2); non-walkable tiles are blocked.
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
): PathPoint[] {
  const sx = clamp(Math.floor(startWorldX / tileSize), 0, width - 1);
  const sy = clamp(Math.floor(startWorldY / tileSize), 0, height - 1);
  let gx = clamp(Math.floor(goalWorldX / tileSize), 0, width - 1);
  let gy = clamp(Math.floor(goalWorldY / tileSize), 0, height - 1);

  const start = sy * width + sx;
  let goal = gy * width + gx;

  if (!tiles[goal]?.walkable) {
    const nearest = findNearestWalkable(tiles, width, height, gx, gy);
    if (!nearest) return [];
    gx = nearest.x;
    gy = nearest.y;
    goal = gy * width + gx;
  }

  if (!tiles[start]?.walkable) {
    const nearest = findNearestWalkable(tiles, width, height, sx, sy);
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

      const tile = tiles[ni]!;
      if (!tile.walkable) continue;

      // No corner-cutting through blocked diagonals
      if (d.x !== 0 && d.y !== 0) {
        const a = tiles[cy * width + (cx + d.x)];
        const b = tiles[(cy + d.y) * width + cx];
        if (!a?.walkable || !b?.walkable) continue;
      }

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

function findNearestWalkable(
  tiles: TerrainTile[],
  width: number,
  height: number,
  cx: number,
  cy: number,
): { x: number; y: number } | null {
  for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if (tiles[y * width + x]?.walkable) return { x, y };
      }
    }
  }
  return null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
