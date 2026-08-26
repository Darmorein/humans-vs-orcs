import { MAP_CONFIG } from './MapConfig';
import { Noise2D } from './Noise';
import { SeededRandom } from './SeededRandom';
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
  /** Seat start slot A (SW-ish) — not faction. */
  startA: MapPoint;
  /** Seat start slot B (NE-ish) — not faction. */
  startB: MapPoint;
  goldDeposits: MapPoint[];
  worldWidth: number;
  worldHeight: number;
  /** Dev diagnostics from Analyze/Repair. */
  validation: MapValidationReport;
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
 * Seeded procedural world generator.
 * Pipeline: Generate → Analyze → Repair. Same seed ⇒ same world.
 */
export class MapGenerator {
  private seed: number;
  private rng: SeededRandom;
  private noise: Noise2D;
  private w: number;
  private h: number;
  private elevation: Float32Array;
  private moisture: Float32Array;
  private tiles: TerrainTile[];
  /** Seat start slot A (SW region). */
  private startA: TilePos = { tx: 12, ty: 12 };
  /** Seat start slot B (NE region). */
  private startB: TilePos = { tx: 12, ty: 12 };
  private goldDeposits: TilePos[] = [];
  private repairs: string[] = [];

  private constructor(seed: number) {
    this.seed = seed >>> 0 || 1;
    this.rng = new SeededRandom(this.seed);
    this.noise = new Noise2D(new SeededRandom(this.seed ^ 0x9e3779b9));
    this.w = MAP_CONFIG.width;
    this.h = MAP_CONFIG.height;
    this.elevation = new Float32Array(this.w * this.h);
    this.moisture = new Float32Array(this.w * this.h);
    this.tiles = new Array(this.w * this.h);
  }

  static create(seed: number): GeneratedMap {
    return new MapGenerator(seed).run();
  }

  /** Dev check: same seed must yield identical tile types + starts. */
  static assertDeterministic(seed: number): boolean {
    const a = MapGenerator.create(seed);
    const b = MapGenerator.create(seed);
    if (a.tiles.length !== b.tiles.length) return false;
    for (let i = 0; i < a.tiles.length; i++) {
      if (a.tiles[i]!.type !== b.tiles[i]!.type) return false;
    }
    return (
      a.startA.x === b.startA.x &&
      a.startA.y === b.startA.y &&
      a.startB.x === b.startB.x &&
      a.startB.y === b.startB.y
    );
  }

  /**
   * Seed → Elevation → Ridges → Valleys → Rivers/Lakes → Moisture → Forests →
   * Clearings → Resources → Bridges → Starts → Roads → Validation → Repair
   */
  private run(): GeneratedMap {
    // —— Generate ——
    this.generateElevation();
    this.carveMountainRidges();
    this.carveValleys();
    this.smoothElevation(2);
    this.paintLandTerrain();
    this.generateRiversAndLakes();
    this.computeMoisture();
    this.generateForestClusters();
    this.carveClearings();
    this.placeResources();
    this.placeStrategicBridges();
    this.placeStartingAreas();
    this.generateRoads(this.startA, this.startB, this.goldDeposits);

    // —— Analyze → Repair (loop) ——
    let report = this.analyze();
    const maxRepairRounds = 8;
    for (let round = 0; round < maxRepairRounds && !report.ok; round++) {
      this.repair(report);
      report = this.analyze();
    }

    if (!report.ok) {
      this.forceCorridor(this.startA, this.startB);
      this.repairs.push('force-corridor');
      report = this.analyze();
    }

    report.repairs = [...this.repairs];
    console.info(
      `[WorldGen] seed=${this.seed} ok=${report.ok} bridges=${report.bridgeCount} repairs=${report.repairs.length}`,
    );

    const tileSize = MAP_CONFIG.tileSize;
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
        // Soft continental shelf — avoid hard border cliffs
        const edge = Math.min(nx, 1 - nx, ny, 1 - ny);
        if (edge < 0.06) e *= 0.55 + (edge / 0.06) * 0.45;
        this.elevation[this.idx(x, y)] = e;
      }
    }
  }

  /** Continuous mountain chains, not speckled peaks. */
  private carveMountainRidges() {
    const ridgeCount = 2 + this.rng.int(0, 2);
    for (let r = 0; r < ridgeCount; r++) {
      let x = this.rng.range(0.12, 0.88) * this.w;
      let y = this.rng.range(0.12, 0.88) * this.h;
      const steps = this.rng.int(55, 95);
      let angle = this.rng.range(0, Math.PI * 2);
      const persistence = this.rng.range(0.82, 0.94);

      for (let s = 0; s < steps; s++) {
        angle += this.rng.range(-0.28, 0.28);
        x += Math.cos(angle) * this.rng.range(1.1, 1.7);
        y += Math.sin(angle) * this.rng.range(1.1, 1.7);
        this.raiseAround(x, y, 2.4, 0.16 * persistence);
        if (this.rng.chance(0.22)) this.raiseAround(x, y, 4.2, 0.07);
        // Occasional spur
        if (this.rng.chance(0.08)) {
          const spur = angle + (this.rng.chance(0.5) ? 1.2 : -1.2);
          this.raiseAround(x + Math.cos(spur) * 3, y + Math.sin(spur) * 3, 2.0, 0.12);
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
    const mountainT = sorted[Math.floor(sorted.length * (1 - MAP_CONFIG.mountainCoverage))]!;
    const hillT = sorted[Math.floor(sorted.length * (1 - MAP_CONFIG.mountainCoverage - 0.18))]!;

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

  private generateRiversAndLakes() {
    const riverCount = this.rng.int(MAP_CONFIG.riverCountMin, MAP_CONFIG.riverCountMax + 1);
    for (let i = 0; i < riverCount; i++) this.carveRiverDownhill();
    this.floodBasinsAsLakes();
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

      // Tiny noise only among equal/near-equal neighbors — keep downhill bias
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
          // Escape toward map edge / lower macro direction
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
    // Expand low water pockets into lakes; deepen centers
    const seeds: TilePos[] = [];
    for (let y = 3; y < this.h - 3; y++) {
      for (let x = 3; x < this.w - 3; x++) {
        if (!isWaterTerrain(this.tiles[this.idx(x, y)]!.type)) continue;
        if (this.elevation[this.idx(x, y)]! < 0.28 && this.rng.chance(0.07)) {
          seeds.push({ tx: x, ty: y });
        }
      }
    }
    // Deterministic order
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

    const targetCells = Math.floor(this.w * this.h * MAP_CONFIG.forestCoverage);
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

    // Dense cores: forest tiles with many forest neighbors
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

  private placeResources() {
    this.goldDeposits = [];
    // Gold near future start zones — provisional; refined after starts if needed
    // Full gold placement happens after starting areas so each base gets access.
    this.placeStoneIron();
  }

  private placeStoneIron() {
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
      // Small cluster
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

  private placeStrategicBridges() {
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

    // Deterministic shuffle via seeded scores
    candidates.sort((a, b) => {
      const sa = this.hashMix(a.key);
      const sb = this.hashMix(b.key);
      return sa - sb || a.key - b.key;
    });

    const target = this.rng.int(MAP_CONFIG.bridgeCountMin, MAP_CONFIG.bridgeCountMax);
    const placed: TilePos[] = [];

    for (const c of candidates) {
      if (placed.length >= target) break;
      if (placed.some((p) => Math.abs(p.tx - c.x) + Math.abs(p.ty - c.y) < 14)) continue;
      this.spanBridge(c.x, c.y);
      placed.push({ tx: c.x, ty: c.y });
    }
  }

  private placeStartingAreas() {
    // Same SW / NE sites as before — labels are seat slots, not factions.
    let startA = this.pickBaseSite(0.06, 0.4, 0.55, 0.94);
    let startB = this.pickBaseSite(0.55, 0.94, 0.06, 0.42);

    if (!startA || !startB) {
      this.flattenFallbackBases();
      startA = this.pickBaseSite(0.08, 0.38, 0.58, 0.92) ?? { tx: 14, ty: this.h - 14 };
      startB = this.pickBaseSite(0.58, 0.92, 0.08, 0.38) ?? { tx: this.w - 14, ty: 14 };
    }

    this.startA = startA;
    this.startB = startB;
    this.clearBaseArea(startA.tx, startA.ty);
    this.clearBaseArea(startB.tx, startB.ty);

    this.goldDeposits = this.placeGold(startA, startB);
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
      bridgeCount >= MAP_CONFIG.bridgeCountMin;

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
    };
  }

  // ─── Repair ──────────────────────────────────────────────────────

  private repair(report: MapValidationReport) {
    if (!report.startsConnected) {
      if (this.tryAddBridgeToward(this.startA, this.startB)) {
        this.repairs.push('bridge-link');
      } else if (this.carvePassToward(this.startA, this.startB)) {
        this.repairs.push('mountain-pass');
      } else {
        this.forceCorridor(this.startA, this.startB);
        this.repairs.push('local-terrain-corridor');
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
      const g = this.findGoldNear(this.startA, MAP_CONFIG.goldNearBaseMin, MAP_CONFIG.goldNearBaseMax);
      if (g) {
        this.goldDeposits.push(g);
        this.markGoldTile(g.tx, g.ty);
        this.ensurePath(this.startA, g);
        this.repairs.push('gold-startA');
      }
    }
    if (!report.startBHasGold) {
      const g = this.findGoldNear(this.startB, MAP_CONFIG.goldNearBaseMin, MAP_CONFIG.goldNearBaseMax);
      if (g) {
        this.goldDeposits.push(g);
        this.markGoldTile(g.tx, g.ty);
        this.ensurePath(this.startB, g);
        this.repairs.push('gold-startB');
      }
    }

    if (report.bridgeCount < MAP_CONFIG.bridgeCountMin) {
      this.placeStrategicBridges();
      this.repairs.push('bridges-topup');
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
    // Scan water cells near midpoint
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
    const r = MAP_CONFIG.baseClearRadius + 1;
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
    if (!this.tryAddBridgeToward(a, b)) this.forceCorridor(a, b);
  }

  // ─── helpers ─────────────────────────────────────────────────────

  private idx(x: number, y: number): number {
    return y * this.w + x;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  private tileToWorld(tx: number, ty: number): MapPoint {
    const s = MAP_CONFIG.tileSize;
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
    const r = MAP_CONFIG.baseClearRadius;
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

  private pickBaseSite(
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
  ): TilePos | null {
    const x0 = Math.floor(minX * this.w);
    const x1 = Math.floor(maxX * this.w);
    const y0 = Math.floor(minY * this.h);
    const y1 = Math.floor(maxY * this.h);

    let best: { tx: number; ty: number; score: number } | null = null;

    for (let attempt = 0; attempt < 90; attempt++) {
      const tx = this.rng.int(x0, x1);
      const ty = this.rng.int(y0, y1);
      const score = this.scoreBaseSite(tx, ty);
      if (score < 0) continue;
      if (!best || score > best.score) best = { tx, ty, score };
    }
    return best ? { tx: best.tx, ty: best.ty } : null;
  }

  private scoreBaseSite(tx: number, ty: number): number {
    const radius = MAP_CONFIG.baseClearRadius;
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
    const radius = MAP_CONFIG.baseClearRadius;
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

  private flattenFallbackBases() {
    this.clearBaseArea(14, this.h - 14);
    this.clearBaseArea(this.w - 14, 14);
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

  private placeGold(human: TilePos, orc: TilePos): TilePos[] {
    const deposits: TilePos[] = [];

    const nearHuman = this.findGoldNear(human, MAP_CONFIG.goldNearBaseMin, MAP_CONFIG.goldNearBaseMax);
    const nearOrc = this.findGoldNear(orc, MAP_CONFIG.goldNearBaseMin, MAP_CONFIG.goldNearBaseMax);
    if (nearHuman) {
      deposits.push(nearHuman);
      this.markGoldTile(nearHuman.tx, nearHuman.ty);
    }
    if (nearOrc) {
      deposits.push(nearOrc);
      this.markGoldTile(nearOrc.tx, nearOrc.ty);
    }

    while (deposits.length < MAP_CONFIG.goldDepositCount) {
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

  private generateRoads(human: TilePos, orc: TilePos, gold: TilePos[]) {
    const waypoints = [human, ...gold, orc];
    for (let i = 0; i < waypoints.length - 1; i++) {
      this.paintRoadPath(waypoints[i]!, waypoints[i + 1]!);
    }
    this.paintRoadPath(human, orc);
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
