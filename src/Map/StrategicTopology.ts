/**
 * Strategic Region Graph — macro topology planned before terrain realization.
 * Seat A/B are faction-neutral; layout picks axis (not always SW↔NE).
 */
import type { SeededRandom } from './SeededRandom';

export type MacroLayoutId =
  | 'DIAGONAL'
  | 'HORIZONTAL'
  | 'VERTICAL'
  | 'RIVER_DIVIDE'
  | 'DUAL_FRONT'
  | 'CENTRAL_BASIN'
  | 'MOUNTAIN_PASS';

export type RegionRole =
  | 'HEARTLAND'
  | 'FRONTIER'
  | 'CONTESTED'
  | 'EXPANSION'
  | 'SIDE_REGION'
  | 'WILDERNESS';

export type RegionTerrainTheme =
  | 'OPEN'
  | 'HILLS'
  | 'FOREST'
  | 'RIVERINE'
  | 'MOUNTAIN'
  | 'MIXED';

export type RegionResourceTheme =
  | 'GOLD_RICH'
  | 'WOOD_RICH'
  | 'FERTILE'
  | 'MINERAL'
  | 'MIXED'
  | 'SPARSE';

export interface TilePoint {
  tx: number;
  ty: number;
}

export interface StrategicRegion {
  id: string;
  role: RegionRole;
  center: TilePoint;
  radius: number;
  ownerBias: 'A' | 'B' | 'NEUTRAL';
  terrainTheme: RegionTerrainTheme;
  resourceTheme: RegionResourceTheme;
}

export interface PlannedRoute {
  id: 'main' | 'flank';
  /** Waypoints in tile space (heartland A → contested → heartland B). */
  waypoints: TilePoint[];
  /** Preferred river crossing (if any). */
  crossing: TilePoint | null;
}

export interface ExpansionSite {
  id: string;
  center: TilePoint;
  score: number;
  regionId: string;
  terrainSpace: number;
  resourcePotential: number;
  defensibility: number;
  routeAccess: number;
  /** Safer own-side vs contested frontier. */
  risk: 'safe' | 'contested';
  ownerBias: 'A' | 'B' | 'NEUTRAL';
}

export interface StrategicPlan {
  layout: MacroLayoutId;
  regions: StrategicRegion[];
  startA: TilePoint;
  startB: TilePoint;
  contestedCenters: TilePoint[];
  mainRoute: PlannedRoute;
  flankRoute: PlannedRoute;
  /** River spine control points (macro-guided). */
  riverControl: TilePoint[];
  /** Mountain ridge spines. */
  ridgeControl: TilePoint[];
}

const LAYOUTS: MacroLayoutId[] = [
  'DIAGONAL',
  'HORIZONTAL',
  'VERTICAL',
  'RIVER_DIVIDE',
  'DUAL_FRONT',
  'CENTRAL_BASIN',
  'MOUNTAIN_PASS',
];

/**
 * Build 7–11 macro regions + dual routes for a 1v1 map.
 * Starts sit inside heartlands with wilderness behind — not map corners.
 */
export function planStrategicTopology(
  w: number,
  h: number,
  rng: SeededRandom,
): StrategicPlan {
  const layout = rng.pick(LAYOUTS);
  const axis = layoutAxis(layout, rng);

  // Heartlands inset with wilderness behind, but far enough for ~45–90s contact.
  const aNorm = offsetAlongAxis(axis, 0.2 + rng.range(-0.02, 0.02), rng, true);
  const bNorm = offsetAlongAxis(axis, 0.8 + rng.range(-0.02, 0.02), rng, false);
  const startA = { tx: clamp(Math.round(aNorm.x * w), 10, w - 11), ty: clamp(Math.round(aNorm.y * h), 10, h - 11) };
  const startB = { tx: clamp(Math.round(bNorm.x * w), 10, w - 11), ty: clamp(Math.round(bNorm.y * h), 10, h - 11) };

  const mid = {
    tx: Math.round((startA.tx + startB.tx) / 2 + rng.range(-w * 0.04, w * 0.04)),
    ty: Math.round((startA.ty + startB.ty) / 2 + rng.range(-h * 0.04, h * 0.04)),
  };
  mid.tx = clamp(mid.tx, 16, w - 17);
  mid.ty = clamp(mid.ty, 16, h - 17);

  const perp = perpendicular(axis);
  const contested2 = {
    tx: clamp(Math.round(mid.tx + perp.x * w * (0.12 + rng.range(0, 0.06))), 14, w - 15),
    ty: clamp(Math.round(mid.ty + perp.y * h * (0.12 + rng.range(0, 0.06))), 14, h - 15),
  };
  const contested3 =
    layout === 'DUAL_FRONT' || layout === 'CENTRAL_BASIN' || rng.chance(0.55)
      ? {
          tx: clamp(Math.round(mid.tx - perp.x * w * (0.1 + rng.range(0, 0.05))), 14, w - 15),
          ty: clamp(Math.round(mid.ty - perp.y * h * (0.1 + rng.range(0, 0.05))), 14, h - 15),
        }
      : null;

  const frontierA = lerpTile(startA, mid, 0.45);
  const frontierB = lerpTile(startB, mid, 0.45);

  const wildA = {
    tx: clamp(Math.round(startA.tx - (mid.tx - startA.tx) * 0.55), 6, w - 7),
    ty: clamp(Math.round(startA.ty - (mid.ty - startA.ty) * 0.55), 6, h - 7),
  };
  const wildB = {
    tx: clamp(Math.round(startB.tx - (mid.tx - startB.tx) * 0.55), 6, w - 7),
    ty: clamp(Math.round(startB.ty - (mid.ty - startB.ty) * 0.55), 6, h - 7),
  };

  const sideA = {
    tx: clamp(Math.round(startA.tx + perp.x * w * 0.14), 8, w - 9),
    ty: clamp(Math.round(startA.ty + perp.y * h * 0.14), 8, h - 9),
  };
  const sideB = {
    tx: clamp(Math.round(startB.tx - perp.x * w * 0.14), 8, w - 9),
    ty: clamp(Math.round(startB.ty - perp.y * h * 0.14), 8, h - 9),
  };

  const rHeart = Math.round(Math.min(w, h) * 0.09);
  const rFront = Math.round(Math.min(w, h) * 0.07);
  const rCont = Math.round(Math.min(w, h) * 0.08);
  const rSide = Math.round(Math.min(w, h) * 0.06);

  const regions: StrategicRegion[] = [
    {
      id: 'heartland-a',
      role: 'HEARTLAND',
      center: startA,
      radius: rHeart,
      ownerBias: 'A',
      terrainTheme: 'OPEN',
      resourceTheme: 'FERTILE',
    },
    {
      id: 'wilderness-a',
      role: 'WILDERNESS',
      center: wildA,
      radius: rSide + 2,
      ownerBias: 'A',
      terrainTheme: layout === 'MOUNTAIN_PASS' ? 'HILLS' : 'FOREST',
      resourceTheme: 'WOOD_RICH',
    },
    {
      id: 'frontier-a',
      role: 'FRONTIER',
      center: frontierA,
      radius: rFront,
      ownerBias: 'A',
      terrainTheme: 'MIXED',
      resourceTheme: 'MIXED',
    },
    {
      id: 'contested-main',
      role: 'CONTESTED',
      center: mid,
      radius: rCont,
      ownerBias: 'NEUTRAL',
      terrainTheme: layout === 'CENTRAL_BASIN' ? 'OPEN' : layout === 'MOUNTAIN_PASS' ? 'HILLS' : 'RIVERINE',
      resourceTheme: 'GOLD_RICH',
    },
    {
      id: 'contested-alt',
      role: 'CONTESTED',
      center: contested2,
      radius: rFront,
      ownerBias: 'NEUTRAL',
      terrainTheme: 'HILLS',
      resourceTheme: 'MIXED',
    },
    {
      id: 'frontier-b',
      role: 'FRONTIER',
      center: frontierB,
      radius: rFront,
      ownerBias: 'B',
      terrainTheme: 'MIXED',
      resourceTheme: 'MIXED',
    },
    {
      id: 'heartland-b',
      role: 'HEARTLAND',
      center: startB,
      radius: rHeart,
      ownerBias: 'B',
      terrainTheme: 'OPEN',
      resourceTheme: 'FERTILE',
    },
    {
      id: 'wilderness-b',
      role: 'WILDERNESS',
      center: wildB,
      radius: rSide + 2,
      ownerBias: 'B',
      terrainTheme: 'FOREST',
      resourceTheme: 'WOOD_RICH',
    },
    {
      id: 'side-a',
      role: 'SIDE_REGION',
      center: sideA,
      radius: rSide,
      ownerBias: 'A',
      terrainTheme: 'FOREST',
      resourceTheme: 'WOOD_RICH',
    },
    {
      id: 'side-b',
      role: 'SIDE_REGION',
      center: sideB,
      radius: rSide,
      ownerBias: 'B',
      terrainTheme: 'HILLS',
      resourceTheme: 'MINERAL',
    },
  ];

  if (contested3) {
    regions.push({
      id: 'contested-side',
      role: 'CONTESTED',
      center: contested3,
      radius: rFront,
      ownerBias: 'NEUTRAL',
      terrainTheme: 'OPEN',
      resourceTheme: 'GOLD_RICH',
    });
  }

  // Expansion pockets near wilderness / side regions
  regions.push({
    id: 'expand-a-safe',
    role: 'EXPANSION',
    center: lerpTile(startA, wildA, 0.55),
    radius: rSide,
    ownerBias: 'A',
    terrainTheme: 'OPEN',
    resourceTheme: 'FERTILE',
  });
  regions.push({
    id: 'expand-a-risk',
    role: 'EXPANSION',
    center: lerpTile(frontierA, contested2, 0.4),
    radius: rSide,
    ownerBias: 'A',
    terrainTheme: 'MIXED',
    resourceTheme: 'GOLD_RICH',
  });
  regions.push({
    id: 'expand-b-safe',
    role: 'EXPANSION',
    center: lerpTile(startB, wildB, 0.55),
    radius: rSide,
    ownerBias: 'B',
    terrainTheme: 'OPEN',
    resourceTheme: 'FERTILE',
  });
  regions.push({
    id: 'expand-b-risk',
    role: 'EXPANSION',
    center: lerpTile(frontierB, contested2, 0.4),
    radius: rSide,
    ownerBias: 'B',
    terrainTheme: 'MIXED',
    resourceTheme: 'MIXED',
  });

  const contestedCenters = [mid, contested2];
  if (contested3) contestedCenters.push(contested3);

  const mainCrossing =
    layout === 'RIVER_DIVIDE' || layout === 'DUAL_FRONT' || layout === 'DIAGONAL' || rng.chance(0.7)
      ? { ...mid }
      : null;

  const flankCrossing = contested2;

  const mainRoute: PlannedRoute = {
    id: 'main',
    waypoints: [startA, frontierA, mid, frontierB, startB],
    crossing: mainCrossing,
  };
  const flankRoute: PlannedRoute = {
    id: 'flank',
    waypoints: [startA, sideA, contested2, sideB, startB],
    crossing: flankCrossing,
  };

  const riverControl = buildRiverControl(layout, startA, startB, mid, contested2, perp, w, h, rng);
  const ridgeControl = buildRidgeControl(layout, startA, startB, mid, perp, w, h, rng);

  return {
    layout,
    regions,
    startA,
    startB,
    contestedCenters,
    mainRoute,
    flankRoute,
    riverControl,
    ridgeControl,
  };
}

function layoutAxis(layout: MacroLayoutId, rng: SeededRandom): { x: number; y: number } {
  switch (layout) {
    case 'HORIZONTAL':
      return { x: 1, y: rng.range(-0.12, 0.12) };
    case 'VERTICAL':
      return { x: rng.range(-0.12, 0.12), y: 1 };
    case 'RIVER_DIVIDE':
      return rng.chance(0.5) ? { x: 1, y: 0.15 } : { x: 0.15, y: 1 };
    case 'DUAL_FRONT':
      return { x: 0.85, y: 0.35 };
    case 'CENTRAL_BASIN':
      return { x: 0.7, y: 0.7 };
    case 'MOUNTAIN_PASS':
      return { x: 0.55, y: 0.85 };
    case 'DIAGONAL':
    default:
      return rng.chance(0.5) ? { x: 1, y: 1 } : { x: 1, y: -1 };
  }
}

function offsetAlongAxis(
  axis: { x: number; y: number },
  t: number,
  rng: SeededRandom,
  isA: boolean,
): { x: number; y: number } {
  const len = Math.hypot(axis.x, axis.y) || 1;
  const ux = axis.x / len;
  const uy = axis.y / len;
  // Map t∈[0,1] onto padded band; keep wilderness behind each seat.
  const cx = 0.5 + (t - 0.5) * ux * 0.92;
  const cy = 0.5 + (t - 0.5) * uy * 0.92;
  const jitter = 0.04;
  return {
    x: clamp(cx + rng.range(-jitter, jitter) + (isA ? -0.02 : 0.02) * uy, 0.1, 0.9),
    y: clamp(cy + rng.range(-jitter, jitter) + (isA ? 0.02 : -0.02) * ux, 0.1, 0.9),
  };
}

function perpendicular(axis: { x: number; y: number }): { x: number; y: number } {
  const len = Math.hypot(axis.x, axis.y) || 1;
  return { x: -axis.y / len, y: axis.x / len };
}

function lerpTile(a: TilePoint, b: TilePoint, t: number): TilePoint {
  return {
    tx: Math.round(a.tx + (b.tx - a.tx) * t),
    ty: Math.round(a.ty + (b.ty - a.ty) * t),
  };
}

function buildRiverControl(
  layout: MacroLayoutId,
  a: TilePoint,
  b: TilePoint,
  mid: TilePoint,
  alt: TilePoint,
  perp: { x: number; y: number },
  w: number,
  h: number,
  rng: SeededRandom,
): TilePoint[] {
  if (layout === 'CENTRAL_BASIN') {
    // Lake-ish basin — short rivers into center, not a wall.
    return [
      { tx: clamp(mid.tx - 18, 4, w - 5), ty: mid.ty },
      mid,
      { tx: clamp(mid.tx + 18, 4, w - 5), ty: mid.ty },
    ];
  }
  if (layout === 'MOUNTAIN_PASS') {
    // Rivers along flanks, leave central pass dry.
    return [
      {
        tx: clamp(Math.round(mid.tx + perp.x * 22), 4, w - 5),
        ty: clamp(Math.round(mid.ty + perp.y * 22), 4, h - 5),
      },
      {
        tx: clamp(Math.round(alt.tx + perp.x * 10), 4, w - 5),
        ty: clamp(Math.round(alt.ty + perp.y * 10), 4, h - 5),
      },
    ];
  }
  if (layout === 'DUAL_FRONT') {
    // Two partial dividers — not one continuous wall.
    return [
      lerpTile(a, mid, 0.55),
      mid,
      lerpTile(b, alt, 0.4),
      alt,
    ];
  }
  // Default: front-aligned river through contested belt (crossable).
  const along = {
    x: (b.tx - a.tx) / (Math.hypot(b.tx - a.tx, b.ty - a.ty) || 1),
    y: (b.ty - a.ty) / (Math.hypot(b.tx - a.tx, b.ty - a.ty) || 1),
  };
  const p0 = {
    tx: clamp(Math.round(mid.tx - along.x * w * 0.22 + perp.x * rng.range(-6, 6)), 3, w - 4),
    ty: clamp(Math.round(mid.ty - along.y * h * 0.22 + perp.y * rng.range(-6, 6)), 3, h - 4),
  };
  const p1 = mid;
  const p2 = {
    tx: clamp(Math.round(mid.tx + along.x * w * 0.22 + perp.x * rng.range(-6, 6)), 3, w - 4),
    ty: clamp(Math.round(mid.ty + along.y * h * 0.22 + perp.y * rng.range(-6, 6)), 3, h - 4),
  };
  return [p0, p1, p2];
}

function buildRidgeControl(
  layout: MacroLayoutId,
  a: TilePoint,
  b: TilePoint,
  mid: TilePoint,
  perp: { x: number; y: number },
  w: number,
  h: number,
  rng: SeededRandom,
): TilePoint[] {
  if (layout === 'MOUNTAIN_PASS') {
    return [
      {
        tx: clamp(Math.round(mid.tx + perp.x * 28), 5, w - 6),
        ty: clamp(Math.round(mid.ty + perp.y * 28), 5, h - 6),
      },
      {
        tx: clamp(Math.round(mid.tx + perp.x * 8), 5, w - 6),
        ty: clamp(Math.round(mid.ty + perp.y * 8), 5, h - 6),
      },
      {
        tx: clamp(Math.round(mid.tx - perp.x * 8), 5, w - 6),
        ty: clamp(Math.round(mid.ty - perp.y * 8), 5, h - 6),
      },
      {
        tx: clamp(Math.round(mid.tx - perp.x * 28), 5, w - 6),
        ty: clamp(Math.round(mid.ty - perp.y * 28), 5, h - 6),
      },
    ];
  }
  if (layout === 'CENTRAL_BASIN') {
    // Rim hills around open basin.
    return [
      { tx: clamp(mid.tx - 24, 4, w - 5), ty: clamp(mid.ty - 18, 4, h - 5) },
      { tx: clamp(mid.tx + 24, 4, w - 5), ty: clamp(mid.ty - 18, 4, h - 5) },
      { tx: clamp(mid.tx + 24, 4, w - 5), ty: clamp(mid.ty + 18, 4, h - 5) },
      { tx: clamp(mid.tx - 24, 4, w - 5), ty: clamp(mid.ty + 18, 4, h - 5) },
    ];
  }
  // Mild side ridges — don't wall the front.
  void a;
  void b;
  void rng;
  return [
    {
      tx: clamp(Math.round(mid.tx + perp.x * 30), 5, w - 6),
      ty: clamp(Math.round(mid.ty + perp.y * 30), 5, h - 6),
    },
    {
      tx: clamp(Math.round(mid.tx - perp.x * 30), 5, w - 6),
      ty: clamp(Math.round(mid.ty - perp.y * 30), 5, h - 6),
    },
  ];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Nearest region containing (or closest to) a tile. */
export function regionAt(plan: StrategicPlan, tx: number, ty: number): StrategicRegion | null {
  let best: StrategicRegion | null = null;
  let bestD = Infinity;
  for (const r of plan.regions) {
    const d = Math.hypot(tx - r.center.tx, ty - r.center.ty);
    if (d <= r.radius && d < bestD) {
      best = r;
      bestD = d;
    }
  }
  if (best) return best;
  for (const r of plan.regions) {
    const d = Math.hypot(tx - r.center.tx, ty - r.center.ty);
    if (d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}
