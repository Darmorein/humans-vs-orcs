import {
  ACTIVE_MAP_PRESET,
  INFANTRY_SPEED_WU,
  MAP_CONFIG,
  MAP_GENERATOR_VERSION,
  mapConfigForPreset,
  type MapConfig,
  type MapSizePresetId,
} from './MapConfig';
import { Noise2D } from './Noise';
import { SeededRandom } from './SeededRandom';
import {
  planStrategicTopology,
  regionAt,
  type ExpansionSite,
  type StrategicPlan,
  type TilePoint,
} from './StrategicTopology';
import {
  createTile,
  isForestTerrain,
  isWaterTerrain,
  type TerrainTile,
  type TerrainType,
} from './Terrain';

export interface MapPoint {
  x: number;
  y: number;
}

export interface GeneratedMap {
  seed: number;
  width: number;
  height: number;
  tileSize: number;
  tiles: TerrainTile[];
  /** Seat start slot A — not faction. */
  startA: MapPoint;
  /** Seat start slot B — not faction. */
  startB: MapPoint;
  goldDeposits: MapPoint[];
  worldWidth: number;
  worldHeight: number;
  /** Dev diagnostics from Analyze/Repair. */
  validation: MapValidationReport;
  mapGeneratorVersion: typeof MAP_GENERATOR_VERSION;
  layout: string;
  regions: Array<{
    id: string;
    role: string;
    center: MapPoint;
    radius: number;
    ownerBias: string;
    terrainTheme: string;
    resourceTheme: string;
  }>;
  expansionSites: Array<{
    id: string;
    center: MapPoint;
    score: number;
    regionId: string;
    risk: string;
    ownerBias: string;
    terrainSpace: number;
    resourcePotential: number;
    defensibility: number;
    routeAccess: number;
  }>;
  forceCorridorUsed: boolean;
  /** Optional one-line strategic quality summary. */
  strategicQuality?: string;
}

export interface MapValidationReport {
  ok: boolean;
  startsConnected: boolean;
  startAReachable: boolean;
  startBReachable: boolean;
  startAHasGold: boolean;
  startBHasGold: boolean;
  startASettlementOk: boolean;
  startBSettlementOk: boolean;
  startANotEnclosed: boolean;
  startBNotEnclosed: boolean;
  bridgeCount: number;
  repairs: string[];
  /** Analyze 2.0 — travel / fairness / topology scores. */
  mainRouteTravelTime: number;
  alternateRouteTravelTime: number;
  routeDiversityScore: number;
  startFairnessScore: number;
  resourceFairnessScore: number;
  expansionSiteCountA: number;
  expansionSiteCountB: number;
  safeExpansionScoreA: number;
  safeExpansionScoreB: number;
  contestedExpansionScore: number;
  maneuverSpaceScore: number;
  chokepointQualityScore: number;
  forceCorridorUsed: boolean;
  degraded: boolean;
  repairPasses: number;
  sharedPathRatio: number;
}

type TilePos = { tx: number; ty: number };

const DIRS4 = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const DIRS8 = [
  ...DIRS4,
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

/**
 * Seeded procedural world generator (Strategic Map Generation v2).
 * Pipeline: Plan → Elevation bias → Terrain → Routes → Expansion → Analyze/Repair.
 * Same seed + preset ⇒ same world.
 */
export class MapGenerator {
  private seed: number;
  private rng: SeededRandom;
  private noise: Noise2D;
  private w: number;
  private h: number;
  private cfg: MapConfig;
  private elevation: Float32Array;
  private moisture: Float32Array;
  private tiles: TerrainTile[];
  /** Seat start slot A. */
  private startA: TilePos = { tx: 12, ty: 12 };
  /** Seat start slot B. */
  private startB: TilePos = { tx: 12, ty: 12 };
  private goldDeposits: TilePos[] = [];
  private repairs: string[] = [];
  private plan: StrategicPlan | null = null;
  private expansionSites: ExpansionSite[] = [];
  private forceCorridorUsed = false;
  private degraded = false;
  private repairPasses = 0;

  private constructor(seed: number, preset?: MapSizePresetId) {
    this.seed = seed >>> 0 || 1;
    this.rng = new SeededRandom(this.seed);
    this.noise = new Noise2D(new SeededRandom(this.seed ^ 0x9e3779b9));
    // Preset overrides width/height; tileSize stays locked to MAP_CONFIG.
    this.cfg = { ...mapConfigForPreset(preset ?? ACTIVE_MAP_PRESET), tileSize: MAP_CONFIG.tileSize };
    this.w = this.cfg.width;
    this.h = this.cfg.height;
    this.elevation = new Float32Array(this.w * this.h);
    this.moisture = new Float32Array(this.w * this.h);
    this.tiles = new Array(this.w * this.h);
  }

  static create(seed: number, preset?: MapSizePresetId): GeneratedMap {
    return new MapGenerator(seed, preset).run();
  }

  /** Dev check: same seed must yield identical tiles, starts, layout, expansions. */
  static assertDeterministic(seed: number, preset?: MapSizePresetId): boolean {
    const a = MapGenerator.create(seed, preset);
    const b = MapGenerator.create(seed, preset);
    if (a.tiles.length !== b.tiles.length) return false;
    for (let i = 0; i < a.tiles.length; i++) {
      if (a.tiles[i]!.type !== b.tiles[i]!.type) return false;
    }
    if (a.layout !== b.layout) return false;
    if (a.forceCorridorUsed !== b.forceCorridorUsed) return false;
    if (a.expansionSites.length !== b.expansionSites.length) return false;
    for (let i = 0; i < a.expansionSites.length; i++) {
      const ea = a.expansionSites[i]!;
      const eb = b.expansionSites[i]!;
      if (ea.center.x !== eb.center.x || ea.center.y !== eb.center.y) return false;
    }
    return (
      a.startA.x === b.startA.x &&
      a.startA.y === b.startA.y &&
      a.startB.x === b.startB.x &&
      a.startB.y === b.startB.y
    );
  }

  /**
   * Strategic plan → elevation → terrain themes → rivers → forests →
   * resources → starts → corridors/roads → expansion → validate/repair.
   */
  private run(): GeneratedMap {
    this.plan = planStrategicTopology(this.w, this.h, this.rng);

    this.generateElevation();
    this.applyStrategicElevationBias();
    this.carveMountainRidges();
    this.carveValleys();
    this.smoothElevation(2);
    this.paintLandTerrain();
    this.applyRegionTerrainThemes();
    this.generateMacroGuidedRivers();
    this.computeMoisture();
    this.boostForestInWoodRegions();
    this.generateForestClusters();
    this.carveClearings();
    this.carveClearingsNearRegions(['OPEN', 'HEARTLAND', 'EXPANSION']);
    this.placeResources();
    this.placeStartingAreasFromPlan();
    this.placeRouteBridges();
    this.carveRouteCorridors();
    this.generateStrategicRoads();
    this.scoreAndPlaceExpansionSites();

    let report = this.analyze();
    const maxRepairRounds = 8;
    for (let round = 0; round < maxRepairRounds && !report.ok; round++) {
      this.repairPasses++;
      this.repair(report);
      report = this.analyze();
    }

    if (!report.ok) {
      this.forceCorridor(this.startA, this.startB);
      this.forceCorridorUsed = true;
      this.degraded = true;
      this.repairs.push('force-corridor');
      report = this.analyze();
    }

    report = this.finalizeStrategicScores(report);
    report.repairs = [...this.repairs];
    report.forceCorridorUsed = this.forceCorridorUsed;
    report.degraded = this.degraded;
    report.repairPasses = this.repairPasses;

    const quality = this.formatStrategicQuality(report);
    console.info(
      `[WorldGen] seed=${this.seed} layout=${this.plan.layout} ok=${report.ok} ` +
        `bridges=${report.bridgeCount} repairs=${report.repairs.length} ` +
        `forceCorridor=${this.forceCorridorUsed} | ${quality}`,
    );

    const tileSize = this.cfg.tileSize;
    return {
      seed: this.seed,
      width: this.w,
      height: this.h,
      tileSize,
      tiles: this.tiles,
      startA: this.tileToWorld(this.startA.tx, this.startA.ty),
      startB: this.tileToWorld(this.startB.tx, this.startB.ty),
      goldDeposits: this.goldDeposits.map((g) => this.tileToWorld(g.tx, g.ty)),
      worldWidth: this.w * tileSize,
      worldHeight: this.h * tileSize,
      validation: report,
      mapGeneratorVersion: MAP_GENERATOR_VERSION,
      layout: this.plan.layout,
      regions: this.plan.regions.map((r) => ({
        id: r.id,
        role: r.role,
        center: this.tileToWorld(r.center.tx, r.center.ty),
        radius: r.radius,
        ownerBias: r.ownerBias,
        terrainTheme: r.terrainTheme,
        resourceTheme: r.resourceTheme,
      })),
      expansionSites: this.expansionSites.map((s) => ({
        id: s.id,
        center: this.tileToWorld(s.center.tx, s.center.ty),
        score: s.score,
        regionId: s.regionId,
        risk: s.risk,
        ownerBias: s.ownerBias,
        terrainSpace: s.terrainSpace,
        resourcePotential: s.resourcePotential,
        defensibility: s.defensibility,
        routeAccess: s.routeAccess,
      })),
      forceCorridorUsed: this.forceCorridorUsed,
      strategicQuality: quality,
    };
  }

  // ─── pipeline stages ─────────────────────────────────────────────

  private generateElevation() {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const nx = x / this.w;
        const ny = y / this.h;
        const macro = this.noise.fbm(nx * 2.1, ny * 2.1, 5);
        const medium = this.noise.fbm(nx * 5.5 + 17, ny * 5.5 + 17, 4);
        const detail = this.noise.fbm(nx * 13 + 41, ny * 13 + 41, 2);
        let e = macro * 0.58 + medium * 0.3 + detail * 0.12;
        const edge = Math.min(nx, 1 - nx, ny, 1 - ny);
        if (edge < 0.06) e *= 0.55 + (edge / 0.06) * 0.45;
        this.elevation[this.idx(x, y)] = e;
      }
    }
  }

  /** Raise ridges from plan.ridgeControl; lower basins / contested open; clear heartlands. */
  private applyStrategicElevationBias() {
    const plan = this.plan!;
    for (const p of plan.ridgeControl) {
      this.raiseAround(p.tx, p.ty, 5.5, 0.14);
      this.raiseAround(p.tx, p.ty, 3.2, 0.1);
    }
    // Soft ridge spine between consecutive control points
    for (let i = 0; i < plan.ridgeControl.length - 1; i++) {
      const a = plan.ridgeControl[i]!;
      const b = plan.ridgeControl[i + 1]!;
      const steps = Math.max(4, Math.round(Math.hypot(b.tx - a.tx, b.ty - a.ty) / 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.tx + (b.tx - a.tx) * t;
        const y = a.ty + (b.ty - a.ty) * t;
        this.raiseAround(x, y, 3.5, 0.08);
      }
    }

    for (const r of plan.regions) {
      if (r.role === 'HEARTLAND' || (r.role === 'CONTESTED' && r.terrainTheme === 'OPEN')) {
        this.lowerAround(r.center.tx, r.center.ty, r.radius * 0.85, 0.07);
      }
      if (r.terrainTheme === 'OPEN' && (r.role === 'CONTESTED' || r.role === 'EXPANSION')) {
        this.lowerAround(r.center.tx, r.center.ty, r.radius * 0.7, 0.05);
      }
      if (plan.layout === 'CENTRAL_BASIN' && r.id === 'contested-main') {
        this.lowerAround(r.center.tx, r.center.ty, r.radius * 1.1, 0.1);
      }
    }
  }

  /** Continuous mountain chains (lighter — plan ridges already bias elevation). */
  private carveMountainRidges() {
    const ridgeCount = 1 + this.rng.int(0, 2);
    for (let r = 0; r < ridgeCount; r++) {
      let x = this.rng.range(0.12, 0.88) * this.w;
      let y = this.rng.range(0.12, 0.88) * this.h;
      const steps = this.rng.int(40, 70);
      let angle = this.rng.range(0, Math.PI * 2);
      const persistence = this.rng.range(0.78, 0.9);

      for (let s = 0; s < steps; s++) {
        angle += this.rng.range(-0.28, 0.28);
        x += Math.cos(angle) * this.rng.range(1.1, 1.7);
        y += Math.sin(angle) * this.rng.range(1.1, 1.7);
        // Skip heartlands / open contested
        const reg = regionAt(this.plan!, Math.round(x), Math.round(y));
        if (reg && (reg.role === 'HEARTLAND' || (reg.role === 'CONTESTED' && reg.terrainTheme === 'OPEN'))) {
          continue;
        }
        this.raiseAround(x, y, 2.2, 0.12 * persistence);
        if (this.rng.chance(0.18)) this.raiseAround(x, y, 3.8, 0.055);
        if (this.rng.chance(0.07)) {
          const spur = angle + (this.rng.chance(0.5) ? 1.2 : -1.2);
          this.raiseAround(x + Math.cos(spur) * 3, y + Math.sin(spur) * 3, 1.8, 0.09);
        }
      }
    }
  }

  /** Soft trenches that guide later rivers and create passable lowlands. */
  private carveValleys() {
    const valleyCount = 2 + this.rng.int(0, 2);
    for (let v = 0; v < valleyCount; v++) {
      let x = this.rng.range(0.1, 0.9) * this.w;
      let y = this.rng.range(0.1, 0.9) * this.h;
      const steps = this.rng.int(35, 70);
      let angle = this.rng.range(0, Math.PI * 2);

      for (let s = 0; s < steps; s++) {
        angle += this.rng.range(-0.4, 0.4);
        x += Math.cos(angle) * 1.5;
        y += Math.sin(angle) * 1.5;
        this.lowerAround(x, y, 2.8, 0.09);
        if (this.rng.chance(0.2)) this.lowerAround(x, y, 4.5, 0.04);
      }
    }
  }

  /** Land only — water comes from downhill rivers/lakes. */
  private paintLandTerrain() {
    const sorted = Array.from(this.elevation).sort((a, b) => a - b);
    const mountainT = sorted[Math.floor(sorted.length * (1 - this.cfg.mountainCoverage))]!;
    const hillT = sorted[Math.floor(sorted.length * (1 - this.cfg.mountainCoverage - 0.18))]!;

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const e = this.elevation[this.idx(x, y)]!;
        let type: TerrainType = 'grass';
        if (e >= mountainT) type = 'mountain';
        else if (e >= hillT) type = 'hill';
        this.tiles[this.idx(x, y)] = createTile(type, e);
      }
    }
  }

  /** Open contested/heartland → grass; wilderness forest moisture; clear mountains in open hearts. */
  private applyRegionTerrainThemes() {
    const plan = this.plan!;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const reg = regionAt(plan, x, y);
        if (!reg) continue;
        const i = this.idx(x, y);
        const t = this.tiles[i]!;
        const openHeart =
          reg.role === 'HEARTLAND' ||
          (reg.role === 'CONTESTED' && reg.terrainTheme === 'OPEN') ||
          (reg.role === 'EXPANSION' && reg.terrainTheme === 'OPEN');

        if (openHeart) {
          if (t.type === 'mountain') {
            this.tiles[i] = createTile('hill', Math.min(t.elevation, 0.52));
          }
          // Flatten to grass near center of open regions
          const d = Math.hypot(x - reg.center.tx, y - reg.center.ty);
          if (d < reg.radius * 0.65 && (t.type === 'hill' || this.tiles[i]!.type === 'hill')) {
            if (this.hashMix(i) % 100 < 55) {
              this.tiles[i] = createTile('grass', Math.min(this.tiles[i]!.elevation, 0.42));
            }
          }
        }

        if (reg.terrainTheme === 'HILLS' && t.type === 'grass' && this.hashMix(i + 17) % 100 < 28) {
          this.tiles[i] = createTile('hill', Math.max(t.elevation, 0.48));
        }
        if (reg.terrainTheme === 'MOUNTAIN' && t.type === 'hill' && this.hashMix(i + 31) % 100 < 35) {
          this.tiles[i] = createTile('mountain', Math.max(t.elevation, 0.72));
        }
      }
    }
  }

  /**
   * Carve rivers along plan.riverControl + optional 0–1 random downhill river.
   * Not always a continuous wall between A and B.
   */
  private generateMacroGuidedRivers() {
    const plan = this.plan!;
    const pts = plan.riverControl;
    if (pts.length >= 2) {
      for (let i = 0; i < pts.length - 1; i++) {
        this.carveRiverBetween(pts[i]!, pts[i + 1]!);
      }
    } else if (pts.length === 1) {
      this.carveRiverFromPoint(pts[0]!);
    }

    if (plan.layout === 'CENTRAL_BASIN' && pts.length > 0) {
      const mid = pts[Math.floor(pts.length / 2)]!;
      this.paintWater(mid.tx, mid.ty, 3, 'river');
      this.paintWater(mid.tx, mid.ty, 1, 'deepWater');
    }

    // 0–1 opportunistic random river — not forced between seats
    if (this.rng.chance(0.55)) {
      this.carveRiverDownhill();
    }
    this.floodBasinsAsLakes();
  }

  private carveRiverBetween(a: TilePoint, b: TilePoint) {
    let x = a.tx;
    let y = a.ty;
    const visited = new Set<number>();
    const maxSteps = Math.max(40, Math.round(Math.hypot(b.tx - a.tx, b.ty - a.ty) * 2.5));

    for (let step = 0; step < maxSteps; step++) {
      const i = this.idx(x, y);
      if (visited.has(i)) break;
      visited.add(i);
      const wide = this.rng.chance(0.15) ? 1 : 0;
      this.paintWater(x, y, wide, 'river');

      if (Math.abs(x - b.tx) + Math.abs(y - b.ty) <= 1) break;

      let nextX = x;
      let nextY = y;
      let bestScore = Infinity;
      for (const d of DIRS8) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!this.inBounds(nx, ny)) continue;
        if (visited.has(this.idx(nx, ny))) continue;
        const e = this.elevation[this.idx(nx, ny)]!;
        const dist = Math.hypot(b.tx - nx, b.ty - ny);
        const score = e * 2.2 + dist * 0.08;
        if (score < bestScore) {
          bestScore = score;
          nextX = nx;
          nextY = ny;
        }
      }
      if (nextX === x && nextY === y) {
        if (x !== b.tx) x += Math.sign(b.tx - x);
        else if (y !== b.ty) y += Math.sign(b.ty - y);
        else break;
      } else {
        x = nextX;
        y = nextY;
      }
    }
  }

  private carveRiverFromPoint(p: TilePoint) {
    let x = p.tx;
    let y = p.ty;
    const visited = new Set<number>();
    for (let step = 0; step < 120; step++) {
      const i = this.idx(x, y);
      if (visited.has(i)) break;
      visited.add(i);
      this.paintWater(x, y, this.rng.chance(0.12) ? 1 : 0, 'river');
      if (x <= 1 || y <= 1 || x >= this.w - 2 || y >= this.h - 2) break;
      let nextX = x;
      let nextY = y;
      let lowest = this.elevation[i]!;
      for (const d of DIRS8) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!this.inBounds(nx, ny) || visited.has(this.idx(nx, ny))) continue;
        const e = this.elevation[this.idx(nx, ny)]!;
        if (e < lowest) {
          lowest = e;
          nextX = nx;
          nextY = ny;
        }
      }
      if (nextX === x && nextY === y) break;
      x = nextX;
      y = nextY;
    }
  }

  /** Rivers always prefer lower elevation neighbors (high → low). */
  private carveRiverDownhill() {
    let best: TilePos | null = null;
    let bestE = 0;
    for (let attempt = 0; attempt < 50; attempt++) {
      const tx = this.rng.int(5, this.w - 6);
      const ty = this.rng.int(5, this.h - 6);
      const e = this.elevation[this.idx(tx, ty)]!;
      const t = this.tiles[this.idx(tx, ty)]!.type;
      if (e > bestE && t !== 'mountain' && !isWaterTerrain(t)) {
        bestE = e;
        best = { tx, ty };
      }
    }
    if (!best || bestE < 0.42) return;

    let x = best.tx;
    let y = best.ty;
    const visited = new Set<number>();

    for (let step = 0; step < 260; step++) {
      const i = this.idx(x, y);
      if (visited.has(i)) break;
      visited.add(i);

      const wide = this.rng.chance(0.18) ? 1 : 0;
      this.paintWater(x, y, wide, 'river');

      if (x <= 1 || y <= 1 || x >= this.w - 2 || y >= this.h - 2) break;

      let nextX = x;
      let nextY = y;
      let lowest = this.elevation[i]!;
      let foundLower = false;

      for (const d of DIRS8) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!this.inBounds(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (visited.has(ni)) continue;
        const e = this.elevation[ni]!;
        if (e < lowest - 0.001) {
          lowest = e;
          nextX = nx;
          nextY = ny;
          foundLower = true;
        }
      }

      if (!foundLower) {
        let candidates: TilePos[] = [];
        for (const d of DIRS4) {
          const nx = x + d.x;
          const ny = y + d.y;
          if (!this.inBounds(nx, ny)) continue;
          if (visited.has(this.idx(nx, ny))) continue;
          if (this.elevation[this.idx(nx, ny)]! <= this.elevation[i]! + 0.015) {
            candidates.push({ tx: nx, ty: ny });
          }
        }
        if (candidates.length === 0) {
          const towardEdgeX = x < this.w / 2 ? -1 : 1;
          const towardEdgeY = y < this.h / 2 ? -1 : 1;
          candidates = [
            { tx: x + towardEdgeX, ty: y },
            { tx: x, ty: y + towardEdgeY },
          ].filter((p) => this.inBounds(p.tx, p.ty));
        }
        const pick = this.rng.pick(candidates);
        nextX = pick.tx;
        nextY = pick.ty;
      }

      x = nextX;
      y = nextY;
    }
  }

  private floodBasinsAsLakes() {
    const seeds: TilePos[] = [];
    for (let y = 3; y < this.h - 3; y++) {
      for (let x = 3; x < this.w - 3; x++) {
        if (!isWaterTerrain(this.tiles[this.idx(x, y)]!.type)) continue;
        if (this.elevation[this.idx(x, y)]! < 0.28 && this.rng.chance(0.07)) {
          seeds.push({ tx: x, ty: y });
        }
      }
    }
    seeds.sort((a, b) => a.ty - b.ty || a.tx - b.tx);

    for (const s of seeds) {
      const r = this.rng.int(2, 3);
      this.paintWater(s.tx, s.ty, r, 'river');
      this.paintWater(s.tx, s.ty, Math.max(0, r - 2), 'deepWater');
    }
  }

  private computeMoisture() {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const nx = x / this.w;
        const ny = y / this.h;
        let m = this.noise.fbm(nx * 4.8 + 9, ny * 4.8 + 9, 4);

        let waterBoost = 0;
        for (let dy = -4; dy <= 4; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            const wx = x + dx;
            const wy = y + dy;
            if (!this.inBounds(wx, wy)) continue;
            if (isWaterTerrain(this.tiles[this.idx(wx, wy)]!.type)) {
              const dist = Math.hypot(dx, dy);
              waterBoost = Math.max(waterBoost, 0.28 * (1 - dist / 5));
            }
          }
        }
        m += waterBoost;

        const type = this.tiles[this.idx(x, y)]!.type;
        if (type === 'hill') m -= 0.1;
        if (type === 'mountain') m -= 0.45;
        this.moisture[this.idx(x, y)] = m;
      }
    }
  }

  private boostForestInWoodRegions() {
    const plan = this.plan!;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const reg = regionAt(plan, x, y);
        if (!reg) continue;
        if (reg.terrainTheme === 'FOREST' || reg.resourceTheme === 'WOOD_RICH') {
          this.moisture[this.idx(x, y)] = Math.min(1.2, this.moisture[this.idx(x, y)]! + 0.18);
        }
        if (reg.role === 'HEARTLAND' || (reg.role === 'CONTESTED' && reg.terrainTheme === 'OPEN')) {
          this.moisture[this.idx(x, y)] = Math.max(0, this.moisture[this.idx(x, y)]! - 0.12);
        }
      }
    }
  }

  /** Forests grow as moisture-seeded clusters (not salt-and-pepper). */
  private generateForestClusters() {
    const seeds: { x: number; y: number; score: number }[] = [];
    for (let y = 4; y < this.h - 4; y++) {
      for (let x = 4; x < this.w - 4; x++) {
        if (this.tiles[this.idx(x, y)]!.type !== 'grass') continue;
        const m = this.moisture[this.idx(x, y)]!;
        if (m < 0.52) continue;
        if (this.rng.chance(0.035 + m * 0.04)) {
          seeds.push({ x, y, score: m });
        }
      }
    }
    seeds.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);

    const targetCells = Math.floor(this.w * this.h * this.cfg.forestCoverage);
    let painted = 0;
    const forestMask = new Uint8Array(this.w * this.h);

    for (const seed of seeds) {
      if (painted >= targetCells) break;
      const clusterTarget = this.rng.int(18, 55);
      const queue: TilePos[] = [{ tx: seed.x, ty: seed.y }];
      let grown = 0;

      while (queue.length > 0 && grown < clusterTarget && painted < targetCells) {
        const cur = queue.shift()!;
        const i = this.idx(cur.tx, cur.ty);
        if (forestMask[i]) continue;
        if (this.tiles[i]!.type !== 'grass') continue;
        if (this.moisture[i]! < 0.4) continue;

        forestMask[i] = 1;
        this.tiles[i] = createTile('forest', this.tiles[i]!.elevation);
        painted++;
        grown++;

        const neighbors = DIRS8.filter((d) => this.inBounds(cur.tx + d.x, cur.ty + d.y)).sort(
          (a, b) =>
            this.moisture[this.idx(cur.tx + b.x, cur.ty + b.y)]! -
            this.moisture[this.idx(cur.tx + a.x, cur.ty + a.y)]!,
        );
        for (const d of neighbors) {
          const nx = cur.tx + d.x;
          const ny = cur.ty + d.y;
          if (!this.inBounds(nx, ny)) continue;
          if (forestMask[this.idx(nx, ny)]) continue;
          if (this.moisture[this.idx(nx, ny)]! < 0.42) continue;
          if (this.rng.chance(0.72)) queue.push({ tx: nx, ty: ny });
        }
      }
    }

    for (let y = 1; y < this.h - 1; y++) {
      for (let x = 1; x < this.w - 1; x++) {
        if (this.tiles[this.idx(x, y)]!.type !== 'forest') continue;
        let n = 0;
        for (const d of DIRS8) {
          if (isForestTerrain(this.tiles[this.idx(x + d.x, y + d.y)]!.type)) n++;
        }
        if (n >= 6) {
          this.tiles[this.idx(x, y)] = createTile('denseForest', this.tiles[this.idx(x, y)]!.elevation);
        }
      }
    }
  }

  private carveClearings() {
    for (let i = 0; i < 10; i++) {
      const cx = this.rng.int(8, this.w - 9);
      const cy = this.rng.int(8, this.h - 9);
      if (!isForestTerrain(this.tiles[this.idx(cx, cy)]!.type)) continue;
      const radius = this.rng.range(2.2, 4.8);
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (!this.inBounds(x, y)) continue;
          const dist = Math.hypot(dx, dy) + this.rng.range(-0.35, 0.35);
          if (dist > radius) continue;
          const t = this.tiles[this.idx(x, y)]!;
          if (isForestTerrain(t.type)) this.tiles[this.idx(x, y)] = createTile('grass', t.elevation);
        }
      }
    }
  }

  private carveClearingsNearRegions(themesOrRoles: string[]) {
    const plan = this.plan!;
    for (const r of plan.regions) {
      const match =
        themesOrRoles.includes(r.terrainTheme) ||
        themesOrRoles.includes(r.role) ||
        (r.terrainTheme === 'OPEN' && themesOrRoles.includes('OPEN'));
      if (!match) continue;
      if (r.role !== 'HEARTLAND' && r.role !== 'CONTESTED' && r.role !== 'EXPANSION' && r.terrainTheme !== 'OPEN') {
        continue;
      }
      const cx = r.center.tx;
      const cy = r.center.ty;
      const radius = r.radius * 0.9;
      for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy++) {
        for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (!this.inBounds(x, y)) continue;
          if (Math.hypot(dx, dy) > radius) continue;
          const t = this.tiles[this.idx(x, y)]!;
          if (isForestTerrain(t.type)) {
            this.tiles[this.idx(x, y)] = createTile('grass', t.elevation);
          }
        }
      }
    }
  }

  private placeResources() {
    this.goldDeposits = [];
    this.placeStoneIron();
  }

  private placeStoneIron() {
    // RESOURCE_ART_MISSING: stone/iron tiles have no dedicated production art in Manifest —
    // renderer still paints them as dirt until asset keys exist.
    const stoneCount = 4 + this.rng.int(0, 2);
    const ironCount = 3 + this.rng.int(0, 2);
    this.scatterResourceTiles('stone', stoneCount, (t) => t === 'hill' || t === 'mountain');
    this.scatterResourceTiles('iron', ironCount, (t) => t === 'hill' || t === 'mountain' || t === 'grass');
  }

  private scatterResourceTiles(
    type: 'stone' | 'iron',
    count: number,
    ok: (t: TerrainType) => boolean,
  ) {
    let placed = 0;
    for (let attempt = 0; attempt < 200 && placed < count; attempt++) {
      const tx = this.rng.int(6, this.w - 7);
      const ty = this.rng.int(6, this.h - 7);
      const tile = this.tiles[this.idx(tx, ty)]!;
      if (!ok(tile.type) || isWaterTerrain(tile.type)) continue;
      if (tile.type === 'gold' || tile.type === 'stone' || tile.type === 'iron') continue;
      this.tiles[this.idx(tx, ty)] = createTile(type, tile.elevation);
      for (const d of DIRS4) {
        if (!this.rng.chance(0.45)) continue;
        const nx = tx + d.x;
        const ny = ty + d.y;
        if (!this.inBounds(nx, ny)) continue;
        const n = this.tiles[this.idx(nx, ny)]!;
        if (ok(n.type) && !isWaterTerrain(n.type) && n.type !== 'bridge') {
          this.tiles[this.idx(nx, ny)] = createTile(type, n.elevation);
        }
      }
      placed++;
    }
  }

  private placeStartingAreasFromPlan() {
    const plan = this.plan!;
    this.startA = { tx: plan.startA.tx, ty: plan.startA.ty };
    this.startB = { tx: plan.startB.tx, ty: plan.startB.ty };

    // Nudge onto walkable flat if plan point landed poorly
    this.startA = this.refineBaseNear(this.startA) ?? this.startA;
    this.startB = this.refineBaseNear(this.startB) ?? this.startB;

    this.clearBaseArea(this.startA.tx, this.startA.ty);
    this.clearBaseArea(this.startB.tx, this.startB.ty);
    this.goldDeposits = this.placeGold(this.startA, this.startB);
  }

  private refineBaseNear(base: TilePos): TilePos | null {
    if (this.scoreBaseSite(base.tx, base.ty) >= 0) return base;
    let bestTx = -1;
    let bestTy = -1;
    let bestScore = -1;
    for (let r = 1; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const tx = base.tx + dx;
          const ty = base.ty + dy;
          const score = this.scoreBaseSite(tx, ty);
          if (score < 0) continue;
          if (score > bestScore) {
            bestScore = score;
            bestTx = tx;
            bestTy = ty;
          }
        }
      }
      if (bestScore >= 0) return { tx: bestTx, ty: bestTy };
    }
    this.clearBaseArea(base.tx, base.ty);
    return base;
  }

  /** Bridges at main/flank crossings only — never spam every water cell. */
  private placeRouteBridges() {
    const plan = this.plan!;
    const placed: TilePos[] = [];
    const minSpacing = Math.max(22, Math.floor(Math.min(this.w, this.h) * 0.12));

    const tryPlace = (tx: number, ty: number) => {
      if (!this.inBounds(tx, ty)) return;
      if (placed.some((p) => Math.abs(p.tx - tx) + Math.abs(p.ty - ty) < minSpacing)) return;
      let bx = tx;
      let by = ty;
      if (!isWaterTerrain(this.tiles[this.idx(tx, ty)]!.type)) {
        let found = false;
        for (let r = 1; r <= 8 && !found; r++) {
          for (let dy = -r; dy <= r && !found; dy++) {
            for (let dx = -r; dx <= r && !found; dx++) {
              const x = tx + dx;
              const y = ty + dy;
              if (!this.inBounds(x, y)) continue;
              if (!isWaterTerrain(this.tiles[this.idx(x, y)]!.type)) continue;
              const walkN = this.isLand(x, y - 1) || this.isLand(x, y - 2);
              const walkS = this.isLand(x, y + 1) || this.isLand(x, y + 2);
              const walkE = this.isLand(x + 1, y) || this.isLand(x + 2, y);
              const walkW = this.isLand(x - 1, y) || this.isLand(x - 2, y);
              if ((walkN && walkS) || (walkE && walkW)) {
                bx = x;
                by = y;
                found = true;
              }
            }
          }
        }
        if (!found) return;
      }
      this.spanBridge(bx, by);
      placed.push({ tx: bx, ty: by });
    };

    if (plan.mainRoute.crossing) tryPlace(plan.mainRoute.crossing.tx, plan.mainRoute.crossing.ty);
    if (plan.flankRoute.crossing) tryPlace(plan.flankRoute.crossing.tx, plan.flankRoute.crossing.ty);

    // At most 1–2 extra crossings, heavily spaced — never carpet the river.
    const target = Math.min(this.cfg.bridgeCountMax, Math.max(this.cfg.bridgeCountMin, placed.length + 1));
    if (placed.length >= target) return;

    const candidates: { x: number; y: number; key: number }[] = [];
    for (let y = 2; y < this.h - 2; y++) {
      for (let x = 2; x < this.w - 2; x++) {
        if (!isWaterTerrain(this.tiles[this.idx(x, y)]!.type)) continue;
        const walkN = this.isLand(x, y - 1) || this.isLand(x, y - 2);
        const walkS = this.isLand(x, y + 1) || this.isLand(x, y + 2);
        const walkE = this.isLand(x + 1, y) || this.isLand(x + 2, y);
        const walkW = this.isLand(x - 1, y) || this.isLand(x - 2, y);
        if ((walkN && walkS) || (walkE && walkW)) {
          candidates.push({ x, y, key: y * this.w + x });
        }
      }
    }
    candidates.sort((a, b) => {
      const sa = this.hashMix(a.key);
      const sb = this.hashMix(b.key);
      return sa - sb || a.key - b.key;
    });

    for (const c of candidates) {
      if (placed.length >= target) break;
      if (placed.some((p) => Math.abs(p.tx - c.x) + Math.abs(p.ty - c.y) < minSpacing)) continue;
      this.spanBridge(c.x, c.y);
      placed.push({ tx: c.x, ty: c.y });
    }
  }

  /**
   * Soften mountains/forest along planned routes — do NOT auto-bridge every water tile
   * (that destroyed chokepoint value and collapsed travel times).
   */
  private carveRouteCorridors() {
    const plan = this.plan!;
    this.carveWaypointCorridor(plan.mainRoute.waypoints, false);
    this.carveWaypointCorridor(plan.flankRoute.waypoints, true);
  }

  private carveWaypointCorridor(waypoints: TilePoint[], flank: boolean) {
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i]!;
      const b = waypoints[i + 1]!;
      const path = this.greedyPathIgnoreMountains(a.tx, a.ty, b.tx, b.ty);
      for (const p of path) {
        const t = this.tiles[this.idx(p.x, p.y)]!;
        if (isWaterTerrain(t.type) || t.type === 'bridge') {
          // Leave water; planned bridges handle crossings.
          continue;
        }
        if (t.type === 'mountain') {
          this.tiles[this.idx(p.x, p.y)] = createTile('hill', Math.min(t.elevation, 0.55));
        } else if (isForestTerrain(t.type) && this.hashMix(this.idx(p.x, p.y)) % 100 < (flank ? 25 : 45)) {
          this.tiles[this.idx(p.x, p.y)] = createTile(flank ? 'forest' : 'grass', t.elevation);
        }
        for (const d of DIRS4) {
          const nx = p.x + d.x;
          const ny = p.y + d.y;
          if (!this.inBounds(nx, ny)) continue;
          const n = this.tiles[this.idx(nx, ny)]!;
          if (n.type === 'mountain' && !flank) {
            this.tiles[this.idx(nx, ny)] = createTile('hill', Math.min(n.elevation, 0.55));
          }
        }
      }
    }
  }

  /** Roads: capital → frontier → contested → expansion sites (not only A→all gold→B). */
  private generateStrategicRoads() {
    const plan = this.plan!;
    const chain = (pts: TilePoint[]) => {
      for (let i = 0; i < pts.length - 1; i++) {
        this.paintRoadPath(
          { tx: pts[i]!.tx, ty: pts[i]!.ty },
          { tx: pts[i + 1]!.tx, ty: pts[i + 1]!.ty },
        );
      }
    };
    chain(plan.mainRoute.waypoints);
    chain(plan.flankRoute.waypoints);

    // Link expansions lightly
    for (const site of this.expansionSites) {
      const nearest =
        site.ownerBias === 'A'
          ? this.startA
          : site.ownerBias === 'B'
            ? this.startB
            : plan.contestedCenters[0]
              ? { tx: plan.contestedCenters[0].tx, ty: plan.contestedCenters[0].ty }
              : this.startA;
      this.paintRoadPath(nearest, { tx: site.center.tx, ty: site.center.ty });
    }

    // Contested gold access
    for (const g of this.goldDeposits) {
      const mid = plan.contestedCenters[0];
      if (!mid) continue;
      if (Math.hypot(g.tx - mid.tx, g.ty - mid.ty) < 18) {
        this.paintRoadPath({ tx: mid.tx, ty: mid.ty }, g);
      }
    }
  }

  /** 5–8 expansion sites from EXPANSION regions + scored flat areas; safe+contested per seat. */
  private scoreAndPlaceExpansionSites() {
    const plan = this.plan!;
    const candidates: ExpansionSite[] = [];

    for (const r of plan.regions) {
      if (r.role !== 'EXPANSION') continue;
      const score = this.scoreExpansionCandidate(r.center.tx, r.center.ty, r);
      candidates.push({
        id: r.id,
        center: { ...r.center },
        score: score.total,
        regionId: r.id,
        terrainSpace: score.terrainSpace,
        resourcePotential: score.resourcePotential,
        defensibility: score.defensibility,
        routeAccess: score.routeAccess,
        risk: r.ownerBias === 'NEUTRAL' || r.id.includes('risk') ? 'contested' : 'safe',
        ownerBias: r.ownerBias,
      });
    }

    // Extra flat-area candidates
    for (let attempt = 0; attempt < 40; attempt++) {
      const tx = this.rng.int(10, this.w - 11);
      const ty = this.rng.int(10, this.h - 11);
      const reg = regionAt(plan, tx, ty);
      if (!reg) continue;
      if (reg.role === 'HEARTLAND') continue;
      const nearExisting = candidates.some((c) => Math.hypot(c.center.tx - tx, c.center.ty - ty) < 14);
      if (nearExisting) continue;
      if (Math.hypot(tx - this.startA.tx, ty - this.startA.ty) < 12) continue;
      if (Math.hypot(tx - this.startB.tx, ty - this.startB.ty) < 12) continue;
      const flat = this.countFlatAround(tx, ty, 4);
      if (flat < 28) continue;
      const score = this.scoreExpansionCandidate(tx, ty, reg);
      const distA = Math.hypot(tx - this.startA.tx, ty - this.startA.ty);
      const distB = Math.hypot(tx - this.startB.tx, ty - this.startB.ty);
      const ownerBias: 'A' | 'B' | 'NEUTRAL' =
        Math.abs(distA - distB) < 10 ? 'NEUTRAL' : distA < distB ? 'A' : 'B';
      candidates.push({
        id: `expand-flat-${attempt}`,
        center: { tx, ty },
        score: score.total,
        regionId: reg.id,
        terrainSpace: score.terrainSpace,
        resourcePotential: score.resourcePotential,
        defensibility: score.defensibility,
        routeAccess: score.routeAccess,
        risk: ownerBias === 'NEUTRAL' || Math.min(distA, distB) > Math.max(distA, distB) * 0.7 ? 'contested' : 'safe',
        ownerBias,
      });
    }

    candidates.sort((a, b) => b.score - a.score || a.center.ty - b.center.ty || a.center.tx - b.center.tx);

    const picked: ExpansionSite[] = [];
    const ensure = (pred: (s: ExpansionSite) => boolean) => {
      const hit = candidates.find((c) => pred(c) && !picked.some((p) => p.id === c.id));
      if (hit) picked.push(hit);
    };
    ensure((s) => s.ownerBias === 'A' && s.risk === 'safe');
    ensure((s) => s.ownerBias === 'B' && s.risk === 'safe');
    ensure((s) => s.ownerBias === 'A' && s.risk === 'contested');
    ensure((s) => s.ownerBias === 'B' && s.risk === 'contested');

    for (const c of candidates) {
      if (picked.length >= 8) break;
      if (picked.some((p) => p.id === c.id)) continue;
      if (picked.some((p) => Math.hypot(p.center.tx - c.center.tx, p.center.ty - c.center.ty) < 12)) continue;
      picked.push(c);
    }
    while (picked.length < 5 && candidates.length > picked.length) {
      const next = candidates.find((c) => !picked.some((p) => p.id === c.id));
      if (!next) break;
      picked.push(next);
    }

    this.expansionSites = picked.slice(0, 8);

    // Clear small pads at sites
    for (const s of this.expansionSites) {
      this.clearAround(s.center.tx, s.center.ty, 2);
    }

    // Re-paint roads to expansions now that sites exist
    for (const site of this.expansionSites) {
      const nearest =
        site.ownerBias === 'A'
          ? this.startA
          : site.ownerBias === 'B'
            ? this.startB
            : { tx: plan.contestedCenters[0]?.tx ?? this.startA.tx, ty: plan.contestedCenters[0]?.ty ?? this.startA.ty };
      this.paintRoadPath(nearest, { tx: site.center.tx, ty: site.center.ty });
    }
  }

  private scoreExpansionCandidate(
    tx: number,
    ty: number,
    reg: { resourceTheme: string; terrainTheme: string },
  ): {
    total: number;
    terrainSpace: number;
    resourcePotential: number;
    defensibility: number;
    routeAccess: number;
  } {
    const terrainSpace = this.countFlatAround(tx, ty, 5) / 80;
    let resourcePotential = 0.4;
    if (reg.resourceTheme === 'GOLD_RICH') resourcePotential = 0.9;
    else if (reg.resourceTheme === 'FERTILE') resourcePotential = 0.7;
    else if (reg.resourceTheme === 'MINERAL') resourcePotential = 0.65;
    else if (reg.resourceTheme === 'WOOD_RICH') resourcePotential = 0.55;

    let hills = 0;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (!this.inBounds(tx + dx, ty + dy)) continue;
        const t = this.tiles[this.idx(tx + dx, ty + dy)]!.type;
        if (t === 'hill' || t === 'mountain') hills++;
      }
    }
    const defensibility = Math.min(1, hills / 25);
    const routeAccess =
      (this.canPath(this.startA.tx, this.startA.ty, tx, ty) ? 0.5 : 0) +
      (this.canPath(this.startB.tx, this.startB.ty, tx, ty) ? 0.5 : 0.15);
    const total = terrainSpace * 0.35 + resourcePotential * 0.3 + defensibility * 0.15 + routeAccess * 0.2;
    return { total, terrainSpace, resourcePotential, defensibility, routeAccess };
  }

  private countFlatAround(tx: number, ty: number, r: number): number {
    let n = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!this.inBounds(tx + dx, ty + dy)) continue;
        const t = this.tiles[this.idx(tx + dx, ty + dy)]!.type;
        if (t === 'grass' || t === 'hill' || t === 'road') n++;
      }
    }
    return n;
  }

  // ─── Analyze ─────────────────────────────────────────────────────

  private analyze(): MapValidationReport {
    const startA = this.startA;
    const startB = this.startB;
    const bridgeCount = this.countBridges();

    const startsConnected = this.canPath(startA.tx, startA.ty, startB.tx, startB.ty);
    const startAReachable = this.tiles[this.idx(startA.tx, startA.ty)]?.walkable === true;
    const startBReachable = this.tiles[this.idx(startB.tx, startB.ty)]?.walkable === true;
    const startAHasGold = this.goldDeposits.some((g) =>
      this.canPath(startA.tx, startA.ty, g.tx, g.ty),
    );
    const startBHasGold = this.goldDeposits.some((g) =>
      this.canPath(startB.tx, startB.ty, g.tx, g.ty),
    );
    const startASettlementOk = this.scoreBaseSite(startA.tx, startA.ty) >= 0;
    const startBSettlementOk = this.scoreBaseSite(startB.tx, startB.ty) >= 0;
    const startANotEnclosed = this.hasEscapeRoute(startA.tx, startA.ty);
    const startBNotEnclosed = this.hasEscapeRoute(startB.tx, startB.ty);

    const ok =
      startsConnected &&
      startAReachable &&
      startBReachable &&
      startAHasGold &&
      startBHasGold &&
      startASettlementOk &&
      startBSettlementOk &&
      startANotEnclosed &&
      startBNotEnclosed &&
      bridgeCount >= this.cfg.bridgeCountMin;

    return {
      ok,
      startsConnected,
      startAReachable,
      startBReachable,
      startAHasGold,
      startBHasGold,
      startASettlementOk,
      startBSettlementOk,
      startANotEnclosed,
      startBNotEnclosed,
      bridgeCount,
      repairs: [...this.repairs],
      mainRouteTravelTime: 0,
      alternateRouteTravelTime: 0,
      routeDiversityScore: 0,
      startFairnessScore: 0,
      resourceFairnessScore: 0,
      expansionSiteCountA: 0,
      expansionSiteCountB: 0,
      safeExpansionScoreA: 0,
      safeExpansionScoreB: 0,
      contestedExpansionScore: 0,
      maneuverSpaceScore: 0,
      chokepointQualityScore: 0,
      forceCorridorUsed: this.forceCorridorUsed,
      degraded: this.degraded,
      repairPasses: this.repairPasses,
      sharedPathRatio: 0,
    };
  }

  private finalizeStrategicScores(report: MapValidationReport): MapValidationReport {
    const plan = this.plan!;
    const mid = plan.contestedCenters[0] ?? {
      tx: Math.round((this.startA.tx + this.startB.tx) / 2),
      ty: Math.round((this.startA.ty + this.startB.ty) / 2),
    };
    const flankMid = plan.contestedCenters[1] ?? plan.flankRoute.crossing ?? mid;

    const mainTime = this.pathCostSeconds(this.startA.tx, this.startA.ty, this.startB.tx, this.startB.ty);
    // Alternate: via flank contested (A→flank→B sum as proxy when direct exists)
    const altA = this.pathCostSeconds(this.startA.tx, this.startA.ty, flankMid.tx, flankMid.ty);
    const altB = this.pathCostSeconds(flankMid.tx, flankMid.ty, this.startB.tx, this.startB.ty);
    const altTime =
      Number.isFinite(altA) && Number.isFinite(altB) ? altA + altB : this.pathCostSeconds(this.startA.tx, this.startA.ty, mid.tx, mid.ty);

    const mainTiles = this.findPathTiles(this.startA.tx, this.startA.ty, mid.tx, mid.ty);
    const mainTiles2 = this.findPathTiles(mid.tx, mid.ty, this.startB.tx, this.startB.ty);
    const flankTiles = this.findPathTiles(this.startA.tx, this.startA.ty, flankMid.tx, flankMid.ty);
    const flankTiles2 = this.findPathTiles(flankMid.tx, flankMid.ty, this.startB.tx, this.startB.ty);

    const mainSet = new Set([...mainTiles, ...mainTiles2]);
    const flankSet = new Set([...flankTiles, ...flankTiles2]);
    let intersection = 0;
    for (const k of mainSet) if (flankSet.has(k)) intersection++;
    const union = mainSet.size + flankSet.size - intersection;
    const sharedPathRatio = union > 0 ? intersection / union : 1;
    const routeDiversityScore = Math.max(0, Math.min(1, 1 - sharedPathRatio));

    const goldA = this.goldDeposits.filter((g) =>
      this.canPath(this.startA.tx, this.startA.ty, g.tx, g.ty),
    ).length;
    const goldB = this.goldDeposits.filter((g) =>
      this.canPath(this.startB.tx, this.startB.ty, g.tx, g.ty),
    ).length;
    const resourceFairnessScore =
      goldA + goldB > 0 ? 1 - Math.abs(goldA - goldB) / Math.max(goldA, goldB, 1) : 0;

    const distAB = Math.hypot(this.startA.tx - this.startB.tx, this.startA.ty - this.startB.ty);
    const ideal = Math.min(this.w, this.h) * 0.45;
    const startFairnessScore = Math.max(0, Math.min(1, 1 - Math.abs(distAB - ideal) / ideal));

    const sitesA = this.expansionSites.filter((s) => s.ownerBias === 'A');
    const sitesB = this.expansionSites.filter((s) => s.ownerBias === 'B');
    const safeA = sitesA.filter((s) => s.risk === 'safe');
    const safeB = sitesB.filter((s) => s.risk === 'safe');
    const contested = this.expansionSites.filter((s) => s.risk === 'contested');

    const maneuverSpaceScore = this.computeManeuverSpaceScore();
    const bridgeCount = report.bridgeCount;
    const chokepointQualityScore = Math.max(
      0,
      Math.min(1, bridgeCount / Math.max(this.cfg.bridgeCountMax, 1) * 0.5 + routeDiversityScore * 0.5),
    );

    return {
      ...report,
      mainRouteTravelTime: Number.isFinite(mainTime) ? mainTime : Infinity,
      alternateRouteTravelTime: Number.isFinite(altTime) ? altTime : Infinity,
      routeDiversityScore,
      startFairnessScore,
      resourceFairnessScore,
      expansionSiteCountA: sitesA.length,
      expansionSiteCountB: sitesB.length,
      safeExpansionScoreA: safeA.length > 0 ? Math.min(1, safeA.reduce((s, x) => s + x.score, 0) / safeA.length) : 0,
      safeExpansionScoreB: safeB.length > 0 ? Math.min(1, safeB.reduce((s, x) => s + x.score, 0) / safeB.length) : 0,
      contestedExpansionScore:
        contested.length > 0 ? Math.min(1, contested.reduce((s, x) => s + x.score, 0) / contested.length) : 0,
      maneuverSpaceScore,
      chokepointQualityScore,
      sharedPathRatio,
      forceCorridorUsed: this.forceCorridorUsed,
      degraded: this.degraded,
      repairPasses: this.repairPasses,
    };
  }

  private formatStrategicQuality(report: MapValidationReport): string {
    const fmt = (t: number) => (Number.isFinite(t) ? `${t.toFixed(0)}s` : '∞');
    return (
      `main=${fmt(report.mainRouteTravelTime)} alt=${fmt(report.alternateRouteTravelTime)} ` +
      `div=${report.routeDiversityScore.toFixed(2)} man=${report.maneuverSpaceScore.toFixed(2)} ` +
      `fair=${report.startFairnessScore.toFixed(2)}/${report.resourceFairnessScore.toFixed(2)} ` +
      `exp A/B=${report.expansionSiteCountA}/${report.expansionSiteCountB}`
    );
  }

  /**
   * 4-dir Dijkstra using tile.movementCost.
   * time = (totalCost * tileSize) / INFANTRY_SPEED_WU. No path → Infinity.
   */
  private pathCostSeconds(sx: number, sy: number, gx: number, gy: number): number {
    const start = this.idx(sx, sy);
    const goal = this.idx(gx, gy);
    if (!this.tiles[start]?.walkable || !this.tiles[goal]?.walkable) return Infinity;

    const dist = new Float64Array(this.w * this.h);
    dist.fill(Infinity);
    dist[start] = 0;
    // Simple binary-heap-less Dijkstra via bucket/scan — map sizes are modest
    const open: number[] = [start];
    const inOpen = new Uint8Array(this.w * this.h);
    inOpen[start] = 1;

    while (open.length > 0) {
      let bestI = 0;
      let bestD = dist[open[0]!]!;
      for (let i = 1; i < open.length; i++) {
        const d = dist[open[i]!]!;
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      const cur = open[bestI]!;
      open[bestI] = open[open.length - 1]!;
      open.pop();
      inOpen[cur] = 0;
      if (cur === goal) break;
      if (bestD === Infinity) break;

      const cx = cur % this.w;
      const cy = Math.floor(cur / this.w);
      for (const d of DIRS4) {
        const nx = cx + d.x;
        const ny = cy + d.y;
        if (!this.inBounds(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        const tile = this.tiles[ni]!;
        if (!tile.walkable || !Number.isFinite(tile.movementCost)) continue;
        const nd = bestD + tile.movementCost;
        if (nd < dist[ni]!) {
          dist[ni] = nd;
          if (!inOpen[ni]) {
            open.push(ni);
            inOpen[ni] = 1;
          }
        }
      }
    }

    const totalCost = dist[goal]!;
    if (!Number.isFinite(totalCost)) return Infinity;
    return (totalCost * this.cfg.tileSize) / INFANTRY_SPEED_WU;
  }

  /** Walkable path tile indices (4-dir BFS parent reconstruction). */
  private findPathTiles(sx: number, sy: number, gx: number, gy: number): number[] {
    const start = this.idx(sx, sy);
    const goal = this.idx(gx, gy);
    if (!this.tiles[start]?.walkable || !this.tiles[goal]?.walkable) return [];

    const parent = new Int32Array(this.w * this.h);
    parent.fill(-1);
    const open: number[] = [start];
    const seen = new Uint8Array(this.w * this.h);
    seen[start] = 1;
    parent[start] = start;

    let found = false;
    while (open.length > 0) {
      const cur = open.shift()!;
      if (cur === goal) {
        found = true;
        break;
      }
      const cx = cur % this.w;
      const cy = Math.floor(cur / this.w);
      for (const d of DIRS4) {
        const nx = cx + d.x;
        const ny = cy + d.y;
        if (!this.inBounds(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (seen[ni]) continue;
        if (!this.tiles[ni]!.walkable) continue;
        seen[ni] = 1;
        parent[ni] = cur;
        open.push(ni);
      }
    }
    if (!found) return [];

    const path: number[] = [];
    let cur = goal;
    while (cur !== start) {
      path.push(cur);
      cur = parent[cur]!;
      if (cur < 0) break;
    }
    path.push(start);
    return path;
  }

  /** Largest connected components of walkable grass/hill/road (not forest). */
  private computeManeuverSpaceScore(): number {
    const area = this.w * this.h;
    const seen = new Uint8Array(area);
    const sizes: number[] = [];

    const isManeuver = (t: TerrainType) => t === 'grass' || t === 'hill' || t === 'road';

    for (let i = 0; i < area; i++) {
      if (seen[i]) continue;
      const t = this.tiles[i]!.type;
      if (!isManeuver(t) || !this.tiles[i]!.walkable) {
        seen[i] = 1;
        continue;
      }
      let size = 0;
      const stack = [i];
      seen[i] = 1;
      while (stack.length > 0) {
        const cur = stack.pop()!;
        size++;
        const cx = cur % this.w;
        const cy = Math.floor(cur / this.w);
        for (const d of DIRS4) {
          const nx = cx + d.x;
          const ny = cy + d.y;
          if (!this.inBounds(nx, ny)) continue;
          const ni = this.idx(nx, ny);
          if (seen[ni]) continue;
          const nt = this.tiles[ni]!;
          if (!nt.walkable || !isManeuver(nt.type)) {
            seen[ni] = 1;
            continue;
          }
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      sizes.push(size);
    }

    sizes.sort((a, b) => b - a);
    const top3 = (sizes[0] ?? 0) + (sizes[1] ?? 0) + (sizes[2] ?? 0);
    return Math.max(0, Math.min(1, top3 / Math.max(area * 0.35, 1)));
  }

  // ─── Repair ──────────────────────────────────────────────────────

  private repair(report: MapValidationReport) {
    if (!report.startsConnected) {
      // Prefer planned corridors → mountain pass → bridge → local open — NOT forceCorridor first
      this.improvePlannedRouteCorridors();
      this.repairs.push('improve-corridors');
      if (!this.canPath(this.startA.tx, this.startA.ty, this.startB.tx, this.startB.ty)) {
        if (this.carvePassToward(this.startA, this.startB)) {
          this.repairs.push('mountain-pass');
        } else if (this.tryAddBridgeToward(this.startA, this.startB)) {
          this.repairs.push('bridge-link');
        } else {
          this.openLocalObstruction(this.startA, this.startB);
          this.clearBaseArea(this.startA.tx, this.startA.ty);
          this.clearBaseArea(this.startB.tx, this.startB.ty);
          this.repairs.push('open-local-obstruction');
        }
      }
    }

    if (!report.startANotEnclosed) {
      this.openBasePerimeter(this.startA);
      this.repairs.push('open-startA');
    }
    if (!report.startBNotEnclosed) {
      this.openBasePerimeter(this.startB);
      this.repairs.push('open-startB');
    }

    if (!report.startASettlementOk) {
      this.clearBaseArea(this.startA.tx, this.startA.ty);
      this.repairs.push('clear-startA-settlement');
    }
    if (!report.startBSettlementOk) {
      this.clearBaseArea(this.startB.tx, this.startB.ty);
      this.repairs.push('clear-startB-settlement');
    }

    if (!report.startAHasGold) {
      const g = this.findGoldNear(this.startA, this.cfg.goldNearBaseMin, this.cfg.goldNearBaseMax);
      if (g) {
        this.goldDeposits.push(g);
        this.markGoldTile(g.tx, g.ty);
        this.ensurePath(this.startA, g);
        this.repairs.push('gold-startA');
      }
    }
    if (!report.startBHasGold) {
      const g = this.findGoldNear(this.startB, this.cfg.goldNearBaseMin, this.cfg.goldNearBaseMax);
      if (g) {
        this.goldDeposits.push(g);
        this.markGoldTile(g.tx, g.ty);
        this.ensurePath(this.startB, g);
        this.repairs.push('gold-startB');
      }
    }

    if (report.bridgeCount < this.cfg.bridgeCountMin) {
      this.placeRouteBridges();
      this.repairs.push('bridges-topup');
    }
  }

  private improvePlannedRouteCorridors() {
    this.carveRouteCorridors();
  }

  private openLocalObstruction(a: TilePos, b: TilePos) {
    const path = this.greedyPathIgnoreMountains(a.tx, a.ty, b.tx, b.ty);
    for (const p of path) {
      const t = this.tiles[this.idx(p.x, p.y)]!;
      if (isWaterTerrain(t.type)) {
        this.tiles[this.idx(p.x, p.y)] = createTile('bridge', 0.25);
      } else if (t.type === 'mountain' || isForestTerrain(t.type)) {
        this.tiles[this.idx(p.x, p.y)] = createTile('grass', Math.min(t.elevation, 0.4));
      }
    }
  }

  private tryAddBridgeToward(a: TilePos, b: TilePos): boolean {
    const path = this.greedyPathIgnoreWater(a.tx, a.ty, b.tx, b.ty);
    for (const p of path) {
      if (isWaterTerrain(this.tiles[this.idx(p.x, p.y)]!.type)) {
        this.spanBridge(p.x, p.y);
        return true;
      }
    }
    const mx = Math.round((a.tx + b.tx) / 2);
    const my = Math.round((a.ty + b.ty) / 2);
    for (let r = 0; r < 20; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = mx + dx;
          const y = my + dy;
          if (!this.inBounds(x, y)) continue;
          if (!isWaterTerrain(this.tiles[this.idx(x, y)]!.type)) continue;
          const walkN = this.isLand(x, y - 1);
          const walkS = this.isLand(x, y + 1);
          const walkE = this.isLand(x + 1, y);
          const walkW = this.isLand(x - 1, y);
          if ((walkN && walkS) || (walkE && walkW)) {
            this.spanBridge(x, y);
            return true;
          }
        }
      }
    }
    return false;
  }

  private carvePassToward(a: TilePos, b: TilePos): boolean {
    const path = this.greedyPathIgnoreMountains(a.tx, a.ty, b.tx, b.ty);
    let carved = false;
    for (const p of path) {
      const t = this.tiles[this.idx(p.x, p.y)]!;
      if (t.type === 'mountain') {
        this.tiles[this.idx(p.x, p.y)] = createTile('hill', Math.min(t.elevation, 0.55));
        carved = true;
        for (const d of DIRS4) {
          const nx = p.x + d.x;
          const ny = p.y + d.y;
          if (!this.inBounds(nx, ny)) continue;
          const n = this.tiles[this.idx(nx, ny)]!;
          if (n.type === 'mountain') {
            this.tiles[this.idx(nx, ny)] = createTile('hill', Math.min(n.elevation, 0.55));
          }
        }
      }
    }
    return carved;
  }

  private forceCorridor(a: TilePos, b: TilePos) {
    let x = a.tx;
    let y = a.ty;
    while (Math.abs(x - b.tx) + Math.abs(y - b.ty) > 0) {
      if (this.rng.chance(0.5) && x !== b.tx) x += Math.sign(b.tx - x);
      else if (y !== b.ty) y += Math.sign(b.ty - y);
      else x += Math.sign(b.tx - x);

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const t = this.tiles[this.idx(nx, ny)]!.type;
          if (isWaterTerrain(t)) {
            this.tiles[this.idx(nx, ny)] = createTile('bridge', 0.25);
          } else if (t === 'mountain' || isForestTerrain(t)) {
            this.tiles[this.idx(nx, ny)] = createTile('grass', 0.35);
          }
        }
      }
    }
  }

  private openBasePerimeter(base: TilePos) {
    const r = this.cfg.baseClearRadius + 1;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      for (let d = 1; d <= r + 3; d++) {
        const x = Math.round(base.tx + Math.cos(angle) * d);
        const y = Math.round(base.ty + Math.sin(angle) * d);
        if (!this.inBounds(x, y)) break;
        const t = this.tiles[this.idx(x, y)]!;
        if (isWaterTerrain(t.type)) {
          this.tiles[this.idx(x, y)] = createTile('bridge', 0.25);
          break;
        }
        if (t.type === 'mountain') {
          this.tiles[this.idx(x, y)] = createTile('hill', 0.45);
        } else if (isForestTerrain(t.type)) {
          this.tiles[this.idx(x, y)] = createTile('grass', t.elevation);
        }
      }
    }
  }

  private ensurePath(a: TilePos, b: TilePos) {
    if (this.canPath(a.tx, a.ty, b.tx, b.ty)) return;
    if (this.carvePassToward(a, b)) return;
    if (!this.tryAddBridgeToward(a, b)) {
      // Last resort for gold access only — do not mark global forceCorridorUsed
      this.forceCorridor(a, b);
    }
  }

  // ─── helpers ─────────────────────────────────────────────────────

  private idx(x: number, y: number): number {
    return y * this.w + x;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  private tileToWorld(tx: number, ty: number): MapPoint {
    const s = this.cfg.tileSize;
    return { x: (tx + 0.5) * s, y: (ty + 0.5) * s };
  }

  private hashMix(n: number): number {
    let t = (n + this.seed) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  private raiseAround(cx: number, cy: number, radius: number, amount: number) {
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(cx + dx);
        const y = Math.floor(cy + dy);
        if (!this.inBounds(x, y)) continue;
        const dist = Math.hypot(dx, dy);
        if (dist > radius) continue;
        const falloff = 1 - dist / radius;
        const i = this.idx(x, y);
        this.elevation[i] = Math.min(1, this.elevation[i]! + amount * falloff * falloff);
      }
    }
  }

  private lowerAround(cx: number, cy: number, radius: number, amount: number) {
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(cx + dx);
        const y = Math.floor(cy + dy);
        if (!this.inBounds(x, y)) continue;
        const dist = Math.hypot(dx, dy);
        if (dist > radius) continue;
        const falloff = 1 - dist / radius;
        const i = this.idx(x, y);
        this.elevation[i] = Math.max(0, this.elevation[i]! - amount * falloff * falloff);
      }
    }
  }

  private smoothElevation(passes: number) {
    for (let p = 0; p < passes; p++) {
      const next = new Float32Array(this.elevation);
      for (let y = 1; y < this.h - 1; y++) {
        for (let x = 1; x < this.w - 1; x++) {
          let sum = this.elevation[this.idx(x, y)]! * 2;
          for (const d of DIRS8) sum += this.elevation[this.idx(x + d.x, y + d.y)]!;
          next[this.idx(x, y)] = sum / 10;
        }
      }
      this.elevation = next;
    }
  }

  private paintWater(cx: number, cy: number, radius: number, kind: 'river' | 'deepWater') {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!this.inBounds(x, y)) continue;
        if (dx * dx + dy * dy > radius * radius + 0.1) continue;
        const e = this.elevation[this.idx(x, y)]!;
        if (this.tiles[this.idx(x, y)]!.type === 'mountain' && radius === 0) continue;
        this.tiles[this.idx(x, y)] = createTile(kind, Math.min(e, kind === 'deepWater' ? 0.08 : 0.15));
      }
    }
  }

  private isLand(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const t = this.tiles[this.idx(x, y)]!.type;
    return !isWaterTerrain(t) && t !== 'mountain';
  }

  private spanBridge(x: number, y: number) {
    const vertical =
      this.isLand(x, y - 1) || this.isLand(x, y + 1) || this.isLand(x, y - 2) || this.isLand(x, y + 2);
    const horizontal = this.isLand(x - 1, y) || this.isLand(x + 1, y);

    if (vertical && !horizontal) {
      for (let dy = -4; dy <= 4; dy++) {
        const yy = y + dy;
        if (!this.inBounds(x, yy)) continue;
        if (isWaterTerrain(this.tiles[this.idx(x, yy)]!.type)) {
          this.tiles[this.idx(x, yy)] = createTile('bridge', 0.2);
        }
      }
      for (const dx of [-1, 1]) {
        if (!this.inBounds(x + dx, y)) continue;
        if (isWaterTerrain(this.tiles[this.idx(x + dx, y)]!.type)) {
          this.tiles[this.idx(x + dx, y)] = createTile('bridge', 0.2);
        }
      }
    } else {
      for (let dx = -4; dx <= 4; dx++) {
        const xx = x + dx;
        if (!this.inBounds(xx, y)) continue;
        if (isWaterTerrain(this.tiles[this.idx(xx, y)]!.type)) {
          this.tiles[this.idx(xx, y)] = createTile('bridge', 0.2);
        }
      }
      for (const dy of [-1, 1]) {
        if (!this.inBounds(x, y + dy)) continue;
        if (isWaterTerrain(this.tiles[this.idx(x, y + dy)]!.type)) {
          this.tiles[this.idx(x, y + dy)] = createTile('bridge', 0.2);
        }
      }
    }
  }

  private countBridges(): number {
    let n = 0;
    for (const t of this.tiles) if (t.type === 'bridge') n++;
    return n;
  }

  private hasEscapeRoute(tx: number, ty: number): boolean {
    const r = this.cfg.baseClearRadius;
    let exits = 0;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      let clear = true;
      for (let d = r; d <= r + 4; d++) {
        const x = Math.round(tx + Math.cos(angle) * d);
        const y = Math.round(ty + Math.sin(angle) * d);
        if (!this.inBounds(x, y)) {
          clear = false;
          break;
        }
        if (!this.tiles[this.idx(x, y)]!.walkable) {
          clear = false;
          break;
        }
      }
      if (clear) exits++;
    }
    return exits >= 2;
  }

  private scoreBaseSite(tx: number, ty: number): number {
    const radius = this.cfg.baseClearRadius;
    let flat = 0;
    let blocked = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (!this.inBounds(x, y)) {
          blocked++;
          continue;
        }
        const t = this.tiles[this.idx(x, y)]!.type;
        if (isWaterTerrain(t) || t === 'mountain') blocked++;
        else if (t === 'grass' || t === 'road' || t === 'hill') flat++;
        else flat += 0.35;
      }
    }
    if (blocked > 8) return -1;
    if (flat < 40) return -1;
    return flat - blocked * 2;
  }

  private clearBaseArea(tx: number, ty: number) {
    const radius = this.cfg.baseClearRadius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (!this.inBounds(x, y)) continue;
        if (dx * dx + dy * dy > radius * radius) continue;
        const e = this.elevation[this.idx(x, y)]!;
        this.tiles[this.idx(x, y)] = createTile('grass', Math.min(e, 0.45));
      }
    }
  }

  private canPath(sx: number, sy: number, gx: number, gy: number): boolean {
    const start = this.idx(sx, sy);
    const goal = this.idx(gx, gy);
    if (!this.tiles[start]?.walkable || !this.tiles[goal]?.walkable) return false;

    const open: number[] = [start];
    const seen = new Uint8Array(this.w * this.h);
    seen[start] = 1;

    while (open.length > 0) {
      const cur = open.pop()!;
      if (cur === goal) return true;
      const cx = cur % this.w;
      const cy = Math.floor(cur / this.w);
      for (const d of DIRS4) {
        const nx = cx + d.x;
        const ny = cy + d.y;
        if (!this.inBounds(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (seen[ni]) continue;
        if (!this.tiles[ni]!.walkable) continue;
        seen[ni] = 1;
        open.push(ni);
      }
    }
    return false;
  }

  /** Prefer GOLD_RICH contested centers for 1–2 deposits; keep near-base gold for A and B. */
  private placeGold(seatA: TilePos, seatB: TilePos): TilePos[] {
    const deposits: TilePos[] = [];
    const plan = this.plan!;

    const nearA = this.findGoldNear(seatA, this.cfg.goldNearBaseMin, this.cfg.goldNearBaseMax);
    const nearB = this.findGoldNear(seatB, this.cfg.goldNearBaseMin, this.cfg.goldNearBaseMax);
    if (nearA) {
      deposits.push(nearA);
      this.markGoldTile(nearA.tx, nearA.ty);
    }
    if (nearB) {
      deposits.push(nearB);
      this.markGoldTile(nearB.tx, nearB.ty);
    }

    const goldRich = plan.regions.filter((r) => r.resourceTheme === 'GOLD_RICH' && r.role === 'CONTESTED');
    let contestedPlaced = 0;
    for (const r of goldRich) {
      if (contestedPlaced >= 2) break;
      if (deposits.length >= this.cfg.goldDepositCount) break;
      const spot = this.findGoldNear({ tx: r.center.tx, ty: r.center.ty }, 1, Math.max(3, Math.floor(r.radius * 0.5)));
      if (!spot) continue;
      if (deposits.some((d) => Math.hypot(d.tx - spot.tx, d.ty - spot.ty) < 10)) continue;
      deposits.push(spot);
      this.markGoldTile(spot.tx, spot.ty);
      contestedPlaced++;
    }

    while (deposits.length < this.cfg.goldDepositCount) {
      const tx = this.rng.int(8, this.w - 9);
      const ty = this.rng.int(8, this.h - 9);
      if (!this.isGoodGoldSpot(tx, ty)) continue;
      if (deposits.some((d) => Math.hypot(d.tx - tx, d.ty - ty) < 10)) continue;
      deposits.push({ tx, ty });
      this.markGoldTile(tx, ty);
      this.clearAround(tx, ty, 2);
    }

    return deposits;
  }

  private markGoldTile(tx: number, ty: number) {
    if (!this.inBounds(tx, ty)) return;
    const e = this.tiles[this.idx(tx, ty)]!.elevation;
    this.tiles[this.idx(tx, ty)] = createTile('gold', e);
  }

  private findGoldNear(base: TilePos, minD: number, maxD: number): TilePos | null {
    let best: { tx: number; ty: number; score: number } | null = null;
    for (let attempt = 0; attempt < 70; attempt++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const dist = this.rng.range(minD, maxD);
      const tx = Math.round(base.tx + Math.cos(angle) * dist);
      const ty = Math.round(base.ty + Math.sin(angle) * dist);
      if (!this.isGoodGoldSpot(tx, ty)) continue;
      const score = this.rng.next();
      if (!best || score > best.score) best = { tx, ty, score };
    }
    if (best) this.clearAround(best.tx, best.ty, 2);
    return best ? { tx: best.tx, ty: best.ty } : null;
  }

  private isGoodGoldSpot(tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) return false;
    const t = this.tiles[this.idx(tx, ty)]!.type;
    return t === 'grass' || t === 'hill' || t === 'forest' || t === 'denseForest' || t === 'road';
  }

  private clearAround(tx: number, ty: number, r: number) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (!this.inBounds(x, y)) continue;
        if (x === tx && y === ty) continue;
        const t = this.tiles[this.idx(x, y)]!;
        if (isWaterTerrain(t.type) || t.type === 'mountain' || t.type === 'bridge') continue;
        if (t.type === 'gold' || t.type === 'stone' || t.type === 'iron') continue;
        this.tiles[this.idx(x, y)] = createTile('grass', t.elevation);
      }
    }
  }

  private paintRoadPath(a: TilePos, b: TilePos) {
    const path = this.greedyPath(a.tx, a.ty, b.tx, b.ty);
    for (const p of path) {
      const t = this.tiles[this.idx(p.x, p.y)]!;
      if (!t.walkable) continue;
      if (t.type === 'bridge' || t.type === 'gold') continue;
      this.tiles[this.idx(p.x, p.y)] = createTile('road', t.elevation);
      for (const d of DIRS4) {
        const nx = p.x + d.x;
        const ny = p.y + d.y;
        if (!this.inBounds(nx, ny)) continue;
        const n = this.tiles[this.idx(nx, ny)]!;
        if (n.type === 'grass' && this.rng.chance(0.32)) {
          this.tiles[this.idx(nx, ny)] = createTile('road', n.elevation);
        }
      }
    }
  }

  private greedyPath(sx: number, sy: number, gx: number, gy: number): { x: number; y: number }[] {
    const path: { x: number; y: number }[] = [];
    let x = sx;
    let y = sy;
    const guard = this.w * this.h;
    for (let i = 0; i < guard; i++) {
      path.push({ x, y });
      if (x === gx && y === gy) break;

      let bestX = x;
      let bestY = y;
      let bestScore = Infinity;
      for (const d of DIRS8) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!this.inBounds(nx, ny)) continue;
        const tile = this.tiles[this.idx(nx, ny)]!;
        if (!tile.walkable && tile.type !== 'bridge') continue;
        const dist = Math.hypot(gx - nx, gy - ny);
        const cost = (tile.walkable ? tile.movementCost : 8) + dist;
        if (cost < bestScore) {
          bestScore = cost;
          bestX = nx;
          bestY = ny;
        }
      }
      if (bestX === x && bestY === y) {
        if (x !== gx) x += Math.sign(gx - x);
        else if (y !== gy) y += Math.sign(gy - y);
        else break;
      } else {
        x = bestX;
        y = bestY;
      }
    }
    return path;
  }

  /** Path that may step on water (for repair bridge search). */
  private greedyPathIgnoreWater(sx: number, sy: number, gx: number, gy: number): { x: number; y: number }[] {
    const path: { x: number; y: number }[] = [];
    let x = sx;
    let y = sy;
    for (let i = 0; i < this.w * this.h; i++) {
      path.push({ x, y });
      if (x === gx && y === gy) break;
      let bestX = x;
      let bestY = y;
      let bestScore = Infinity;
      for (const d of DIRS8) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!this.inBounds(nx, ny)) continue;
        const tile = this.tiles[this.idx(nx, ny)]!;
        if (tile.type === 'mountain') continue;
        const dist = Math.hypot(gx - nx, gy - ny);
        const waterPenalty = isWaterTerrain(tile.type) ? 3 : tile.walkable ? tile.movementCost : 6;
        const cost = waterPenalty + dist;
        if (cost < bestScore) {
          bestScore = cost;
          bestX = nx;
          bestY = ny;
        }
      }
      if (bestX === x && bestY === y) {
        if (x !== gx) x += Math.sign(gx - x);
        else if (y !== gy) y += Math.sign(gy - y);
        else break;
      } else {
        x = bestX;
        y = bestY;
      }
    }
    return path;
  }

  private greedyPathIgnoreMountains(sx: number, sy: number, gx: number, gy: number): { x: number; y: number }[] {
    const path: { x: number; y: number }[] = [];
    let x = sx;
    let y = sy;
    for (let i = 0; i < this.w * this.h; i++) {
      path.push({ x, y });
      if (x === gx && y === gy) break;
      let bestX = x;
      let bestY = y;
      let bestScore = Infinity;
      for (const d of DIRS8) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (!this.inBounds(nx, ny)) continue;
        const tile = this.tiles[this.idx(nx, ny)]!;
        if (isWaterTerrain(tile.type) && tile.type !== 'bridge') continue;
        const dist = Math.hypot(gx - nx, gy - ny);
        const mountainPenalty = tile.type === 'mountain' ? 4 : tile.walkable ? tile.movementCost : 5;
        const cost = mountainPenalty + dist;
        if (cost < bestScore) {
          bestScore = cost;
          bestX = nx;
          bestY = ny;
        }
      }
      if (bestX === x && bestY === y) {
        if (x !== gx) x += Math.sign(gx - x);
        else if (y !== gy) y += Math.sign(gy - y);
        else break;
      } else {
        x = bestX;
        y = bestY;
      }
    }
    return path;
  }
}
