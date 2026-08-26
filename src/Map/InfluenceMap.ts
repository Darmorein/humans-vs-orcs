import type { Camera } from '../Engine/Camera';
import type { FactionId } from '../Players/Types';
import { FACTIONS } from '../Players/Types';
import { doctrineOf } from '../Players/FactionDoctrine';
import type { MatchState } from '../Players/MatchState';
import type { Settlement } from '../Settlement/Settlement';

/** Control of one influence cell — no province IDs. */
export type TerritoryControl = 'none' | 'contested' | FactionId;

export interface InfluenceSource {
  x: number;
  y: number;
  factionId: FactionId;
  /** Peak strength before distance falloff. */
  strength: number;
  /** World-distance at which contribution reaches 0. */
  range: number;
}

const CELL = 56;
const UPDATE_INTERVAL = 0.45;
/** Below this peak on a cell → unclaimed wilderness. */
const MIN_CLAIM = 8;
/**
 * When runner-up / leader ≥ this, or absolute gap is tiny → Contested.
 * e.g. Humans 42 / Orcs 37 ≈ 0.88 → Contested.
 */
const CONTEST_RATIO = 0.88;
const CONTEST_ABS_GAP = 6;

const FACTION_ORDER: FactionId[] = ['humans', 'orcs'];

/**
 * Continuous influence field over the world (no provinces).
 * Settlements radiate power from population, prosperity, safety,
 * infrastructure and prestige; control shifts as those change.
 */
export class InfluenceMap {
  public readonly cellSize = CELL;
  public overlayVisible = false;

  private readonly cols: number;
  private readonly rows: number;
  private readonly worldW: number;
  private readonly worldH: number;

  /** Per-faction stacked influence at cell centers. */
  private readonly byFaction: Record<FactionId, Float32Array>;
  private readonly control: Uint8Array; // 0 none, 1 contested, 2 humans, 3 orcs

  private accum = 0;
  private keyHeld = false;

  constructor(mapWidth: number, mapHeight: number) {
    this.worldW = mapWidth;
    this.worldH = mapHeight;
    this.cols = Math.ceil(mapWidth / CELL);
    this.rows = Math.ceil(mapHeight / CELL);
    const n = this.cols * this.rows;
    this.byFaction = {
      humans: new Float32Array(n),
      orcs: new Float32Array(n),
    };
    this.control = new Uint8Array(n);
  }

  /** Edge-toggle for territory overlay (default KeyT). */
  public handleToggleInput(keys: Record<string, boolean>, code = 'KeyT') {
    const down = !!keys[code];
    if (down && !this.keyHeld) this.overlayVisible = !this.overlayVisible;
    this.keyHeld = down;
  }

  public update(dt: number, settlements: Settlement[], match: MatchState) {
    this.accum += dt;
    if (this.accum < UPDATE_INTERVAL) return;
    this.accum = 0;
    this.rebuild(settlements, match);
  }

  public getAccum(): number {
    return this.accum;
  }

  public setAccum(v: number) {
    this.accum = Math.max(0, v);
  }

  /** Force immediate rebuild (e.g. after load). */
  public rebuild(settlements: Settlement[], match: MatchState) {
    this.byFaction.humans.fill(0);
    this.byFaction.orcs.fill(0);

    const sources = this.collectSources(settlements, match);
    for (const src of sources) {
      this.stampSource(src);
    }
    this.resolveControl();
  }

  public getControlAt(worldX: number, worldY: number): TerritoryControl {
    const i = this.indexAt(worldX, worldY);
    if (i < 0) return 'none';
    return decodeControl(this.control[i]!);
  }

  public getFactionInfluenceAt(
    worldX: number,
    worldY: number,
    factionId: FactionId,
  ): number {
    const i = this.indexAt(worldX, worldY);
    if (i < 0) return 0;
    return this.byFaction[factionId][i] ?? 0;
  }

  /**
   * Fraction of claimed cells owned / contested for AI strategic analysis.
   * Wilderness cells are ignored in the denominator.
   */
  public estimateControlShares(factionId: FactionId): {
    ownShare: number;
    contestedShare: number;
  } {
    let claimed = 0;
    let own = 0;
    let contested = 0;
    const ownCode = factionId === 'humans' ? 2 : 3;
    for (let i = 0; i < this.control.length; i++) {
      const code = this.control[i]!;
      if (code === 0) continue;
      claimed += 1;
      if (code === 1) contested += 1;
      else if (code === ownCode) own += 1;
    }
    if (claimed === 0) return { ownShare: 0.35, contestedShare: 0.1 };
    return {
      ownShare: own / claimed,
      contestedShare: contested / claimed,
    };
  }

  public draw(ctx: CanvasRenderingContext2D, camera: Camera) {
    if (!this.overlayVisible) return;

    const pad = CELL * 2;
    const corners = [
      camera.screenToWorld(-pad, -pad),
      camera.screenToWorld(camera.width + pad, -pad),
      camera.screenToWorld(camera.width + pad, camera.height + pad),
      camera.screenToWorld(-pad, camera.height + pad),
    ];
    const minX = Math.min(corners[0]!.x, corners[1]!.x, corners[2]!.x, corners[3]!.x);
    const maxX = Math.max(corners[0]!.x, corners[1]!.x, corners[2]!.x, corners[3]!.x);
    const minY = Math.min(corners[0]!.y, corners[1]!.y, corners[2]!.y, corners[3]!.y);
    const maxY = Math.max(corners[0]!.y, corners[1]!.y, corners[2]!.y, corners[3]!.y);

    const minCx = Math.max(0, Math.floor(minX / CELL));
    const maxCx = Math.min(this.cols - 1, Math.floor(maxX / CELL));
    const minCy = Math.max(0, Math.floor(minY / CELL));
    const maxCy = Math.min(this.rows - 1, Math.floor(maxY / CELL));

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const i = cy * this.cols + cx;
        const code = this.control[i]!;
        if (code === 0) continue;

        const wx = cx * CELL;
        const wy = cy * CELL;
        const p0 = camera.worldToScreen(wx, wy);
        const p1 = camera.worldToScreen(wx + CELL, wy);
        const p2 = camera.worldToScreen(wx + CELL, wy + CELL);
        const p3 = camera.worldToScreen(wx, wy + CELL);

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();

        if (code === 1) {
          ctx.fillStyle = 'rgba(210, 180, 60, 0.28)';
          ctx.fill();
          // Light hatch for contested
          ctx.strokeStyle = 'rgba(255, 220, 80, 0.35)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        } else {
          const fid = code === 2 ? 'humans' : 'orcs';
          const accent = FACTIONS[fid].accent;
          const peak = this.byFaction[fid][i]!;
          const alpha = 0.12 + Math.min(0.28, peak / 180);
          ctx.fillStyle = hexToRgba(accent, alpha);
          ctx.fill();
        }
      }
    }

    this.drawBorders(ctx, camera, minCx, maxCx, minCy, maxCy);
  }

  private collectSources(settlements: Settlement[], match: MatchState): InfluenceSource[] {
    const out: InfluenceSource[] = [];
    for (const s of settlements) {
      const player = match.getPlayer(s.playerId);
      if (!player || player.isDefeated) continue;
      // Destroyed / no town center → no projection (borders retract)
      if (!s.hasTownCenter) continue;
      if (s.population <= 0 && s.structureCount <= 0) continue;

      const infrastructure =
        (s.hasTownCenter ? 6 : 0) +
        s.houseCount * 1.4 +
        s.farmCount * 1.1 +
        s.storageCount * 1.6 +
        s.structureCount * 0.7;

      const prestige = s.influence;
      const d = doctrineOf(player.factionId);
      const strength =
        s.population * 2.8 +
        s.prosperity * 50 +
        s.safety * 42 +
        infrastructure * 3.5 * d.craftProsperityBias +
        prestige * 55 +
        s.militaryTradition * 28 * d.influenceMilitaryWeight;
      const range = 220 + strength * 2.2 + s.expansionRadius * 0.35 * d.expansionPressure;
      if (strength < 4) continue;
      out.push({
        x: s.centerX,
        y: s.centerY,
        factionId: player.factionId,
        strength,
        range,
      });
    }
    return out;
  }

  private stampSource(src: InfluenceSource) {
    const r = src.range;
    const rCells = Math.ceil(r / CELL) + 1;
    const cx0 = Math.floor(src.x / CELL);
    const cy0 = Math.floor(src.y / CELL);
    const field = this.byFaction[src.factionId];

    for (let cy = cy0 - rCells; cy <= cy0 + rCells; cy++) {
      if (cy < 0 || cy >= this.rows) continue;
      for (let cx = cx0 - rCells; cx <= cx0 + rCells; cx++) {
        if (cx < 0 || cx >= this.cols) continue;
        const wx = cx * CELL + CELL * 0.5;
        const wy = cy * CELL + CELL * 0.5;
        const d = Math.hypot(wx - src.x, wy - src.y);
        if (d >= r) continue;
        const t = 1 - d / r;
        // Smooth falloff — borders move as strength/range change
        const contrib = src.strength * t * t;
        const i = cy * this.cols + cx;
        field[i] = (field[i] ?? 0) + contrib;
      }
    }
  }

  private resolveControl() {
    const n = this.control.length;
    for (let i = 0; i < n; i++) {
      let bestId: FactionId = 'humans';
      let best = -1;
      let second = -1;
      for (const fid of FACTION_ORDER) {
        const v = this.byFaction[fid][i] ?? 0;
        if (v > best) {
          second = best;
          best = v;
          bestId = fid;
        } else if (v > second) {
          second = v;
        }
      }

      if (best < MIN_CLAIM) {
        this.control[i] = 0;
        continue;
      }
      const ratio = second > 0 ? second / best : 0;
      if (ratio >= CONTEST_RATIO || best - second < CONTEST_ABS_GAP) {
        this.control[i] = 1;
      } else {
        this.control[i] = bestId === 'humans' ? 2 : 3;
      }
    }
  }

  /** Outline where adjacent cells differ in control. */
  private drawBorders(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    minCx: number,
    maxCx: number,
    minCy: number,
    maxCy: number,
  ) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 240, 0.45)';

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const i = cy * this.cols + cx;
        const c = this.control[i]!;
        if (c === 0) continue;

        const wx = cx * CELL;
        const wy = cy * CELL;
        // Right edge
        if (cx < this.cols - 1 && this.control[i + 1]! !== c) {
          const a = camera.worldToScreen(wx + CELL, wy);
          const b = camera.worldToScreen(wx + CELL, wy + CELL);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        // Bottom edge
        if (cy < this.rows - 1 && this.control[i + this.cols]! !== c) {
          const a = camera.worldToScreen(wx, wy + CELL);
          const b = camera.worldToScreen(wx + CELL, wy + CELL);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
  }

  private indexAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.worldW || y >= this.worldH) return -1;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return -1;
    return cy * this.cols + cx;
  }
}

function decodeControl(code: number): TerritoryControl {
  if (code === 1) return 'contested';
  if (code === 2) return 'humans';
  if (code === 3) return 'orcs';
  return 'none';
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
