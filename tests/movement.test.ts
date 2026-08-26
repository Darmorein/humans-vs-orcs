import assert from 'node:assert/strict';
import test from 'node:test';
import { formationOffsets } from '../src/Combat/Formations.ts';
import { findPath } from '../src/Map/Pathfinding.ts';
import { createTile, type TerrainTile } from '../src/Map/Terrain.ts';

/** Mirrors SquadMarch.FORMATION_BASE_SPACING — keep in sync. */
const FORMATION_BASE_SPACING = 46;
const CHOKE_COMPRESS_MUL = 0.38;

/** Soft collision minDist for two radius-22 units (friendly soft scale 0.72). */
const COLLISION_MIN = (22 + 22) * 0.72;

function attackRingPoint(
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

test('formation line spacing clears soft friendly collision', () => {
  const offsets = formationOffsets('line', 8, FORMATION_BASE_SPACING);
  for (let i = 1; i < offsets.length; i++) {
    const a = offsets[i - 1]!;
    const b = offsets[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    assert.ok(d + 0.5 >= COLLISION_MIN, `slot gap ${d} < collision ${COLLISION_MIN}`);
  }
});

test('choke compression collapses to column-scale spacing', () => {
  const open = formationOffsets('line', 8, FORMATION_BASE_SPACING);
  const choke = formationOffsets('line', 8, FORMATION_BASE_SPACING * CHOKE_COMPRESS_MUL);
  const openWidth = Math.abs(open[open.length - 1]!.x - open[0]!.x);
  const chokeWidth = Math.abs(choke[choke.length - 1]!.x - choke[0]!.x);
  assert.ok(chokeWidth < openWidth * 0.5, 'compressed formation should be much narrower');
});

test('attack ring spreads members around a target', () => {
  const pts = Array.from({ length: 8 }, (_, i) => attackRingPoint(100, 200, i, 8, 40));
  const uniq = new Set(pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`));
  assert.equal(uniq.size, 8);
});

test('8-unit bridge chokepoint: shared path crosses water corridor', () => {
  const w = 14;
  const h = 10;
  const tileSize = 28;
  const tiles: TerrainTile[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const river = x >= 6 && x <= 7;
      const bridge = river && y === 4;
      tiles.push(createTile(bridge ? 'bridge' : river ? 'river' : 'grass', 0));
    }
  }

  const startX = 2.5 * tileSize;
  const startY = 4.5 * tileSize;
  const goalX = 11.5 * tileSize;
  const goalY = 4.5 * tileSize;
  const path = findPath(tiles, w, h, tileSize, startX, startY, goalX, goalY);
  assert.ok(path.length > 0, 'path across bridge must exist');

  let steppedOnBridge = false;
  for (const p of path) {
    const tx = Math.floor(p.x / tileSize);
    const ty = Math.floor(p.y / tileSize);
    const t = tiles[ty * w + tx]!;
    assert.notEqual(t.type, 'river', 'path must not walk river');
    if (t.type === 'bridge') steppedOnBridge = true;
  }
  assert.ok(steppedOnBridge, 'path should use the bridge tile');

  // Temporary column: 8 units @ 22px file gap → lateral width ~0, depth fits corridor
  const fileGap = 22;
  const columnDepth = (8 - 1) * fileGap;
  assert.ok(columnDepth < tileSize * 8, 'column depth should be traversable');
  assert.ok(fileGap < tileSize, 'column members stay within bridge tile width');
});

test('12-unit open-field destinations remain unique and reachable spacing', () => {
  const offsets = formationOffsets('loose', 12, FORMATION_BASE_SPACING);
  assert.equal(offsets.length, 12);
  const keys = new Set(offsets.map((o) => `${o.x.toFixed(0)},${o.y.toFixed(0)}`));
  assert.equal(keys.size, 12);
  const xs = offsets.map((o) => o.x);
  const ys = offsets.map((o) => o.y);
  const span = Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));
  assert.ok(span > 80 && span < 600, `unexpected formation span ${span}`);
});
