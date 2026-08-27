import { assets, drawSprite, drawTileSprite } from '../Assets/Assets';
import type { AssetKey } from '../Assets/AssetPaths';
import { Camera } from '../Engine/Camera';
import { drawIsoRock, drawIsoTree } from '../Engine/Iso';
import type { GeneratedMap } from './MapGenerator';
import { findPath, markBuildingBlockedTiles, type PathPoint } from './Pathfinding';
import { terrainColor, isBuildableTerrain, assertTerrainDefinitionsComplete, type TerrainTile, type TerrainType } from './Terrain';
import { MAP_CONFIG } from './MapConfig';
import type { Entity } from '../Entities/Entity';
import { Building } from '../Entities/Building';

export type MapDecoration = {
  x: number;
  y: number;
  radius: number;
  kind:
    | 'tree'
    | 'pine'
    | 'rock'
    | 'bush'
    | 'stump'
    | 'skull'
    | 'flowers'
    | 'blueFlowers'
    | 'pebbles'
    | 'cart'
    | 'fence'
    | 'marketStall';
};

export class GameMap {
  public width: number;
  public height: number;
  public tileWidth: number;
  public tileHeight: number;
  public tileSize: number;
  public tiles: TerrainTile[];
  public decorations: MapDecoration[] = [];
  public seed: number;
  /** Seat start slot A — not faction. */
  public startA: { x: number; y: number };
  /** Seat start slot B — not faction. */
  public startB: { x: number; y: number };
  public goldDeposits: { x: number; y: number }[];
  public validation: GeneratedMap['validation'];
  public mapGeneratorVersion: number;
  public layout: string;
  public expansionSites: GeneratedMap['expansionSites'];
  public regions: GeneratedMap['regions'];
  /** Scratch buffer for building footprints in pathfinding. */
  private pathBlockedScratch: Uint8Array | null = null;

  constructor(generated: GeneratedMap) {
    this.seed = generated.seed;
    this.tileWidth = generated.width;
    this.tileHeight = generated.height;
    this.tileSize = generated.tileSize;
    this.tiles = generated.tiles;
    this.width = generated.worldWidth;
    this.height = generated.worldHeight;
    this.startA = generated.startA;
    this.startB = generated.startB;
    this.goldDeposits = generated.goldDeposits;
    this.validation = generated.validation;
    this.mapGeneratorVersion = generated.mapGeneratorVersion ?? 1;
    this.layout = generated.layout ?? 'LEGACY';
    this.expansionSites = generated.expansionSites ?? [];
    this.regions = generated.regions ?? [];
    this.buildDecorations();
    assertTerrainDefinitionsComplete();
  }

  public worldToTile(x: number, y: number): { tx: number; ty: number } {
    return {
      tx: clamp(Math.floor(x / this.tileSize), 0, this.tileWidth - 1),
      ty: clamp(Math.floor(y / this.tileSize), 0, this.tileHeight - 1),
    };
  }

  public getTileAt(x: number, y: number): TerrainTile {
    const { tx, ty } = this.worldToTile(x, y);
    return this.tiles[ty * this.tileWidth + tx]!;
  }

  public isWalkable(x: number, y: number): boolean {
    return this.getTileAt(x, y).walkable;
  }

  public canBuildAt(x: number, y: number): boolean {
    return isBuildableTerrain(this.getTileAt(x, y).type);
  }

  public getMoveSpeedMultiplier(x: number, y: number): number {
    const tile = this.getTileAt(x, y);
    if (!tile.walkable) return 0.2;
    return 1 / tile.movementCost;
  }

  /**
   * Terrain A* with optional building footprints blocked.
   * Pass `ignoreBuilding` so builders can path onto their construction site.
   */
  public findPath(
    sx: number,
    sy: number,
    gx: number,
    gy: number,
    entities?: Entity[],
    ignoreBuilding?: Building | null,
  ): PathPoint[] {
    let blocked: Uint8Array | null = null;
    if (entities && entities.length > 0) {
      const size = this.tileWidth * this.tileHeight;
      if (!this.pathBlockedScratch || this.pathBlockedScratch.length !== size) {
        this.pathBlockedScratch = new Uint8Array(size);
      }
      blocked = this.pathBlockedScratch;
      const solids: Array<{ x: number; y: number; radius: number }> = [];
      for (const e of entities) {
        if (!(e instanceof Building) || e.isDead) continue;
        if (ignoreBuilding && e === ignoreBuilding) continue;
        solids.push({ x: e.x, y: e.y, radius: e.radius });
      }
      markBuildingBlockedTiles(blocked, this.tileWidth, this.tileHeight, this.tileSize, solids);
    }
    return findPath(this.tiles, this.tileWidth, this.tileHeight, this.tileSize, sx, sy, gx, gy, {
      blocked,
    });
  }

  /** World-space centers of bridge clusters (choke points). */
  public findBridgeCenters(): { x: number; y: number }[] {
    if (this.bridgeCache) return this.bridgeCache;

    const points: { x: number; y: number }[] = [];
    for (let ty = 0; ty < this.tileHeight; ty++) {
      for (let tx = 0; tx < this.tileWidth; tx++) {
        if (this.tiles[ty * this.tileWidth + tx]!.type !== 'bridge') continue;
        points.push({
          x: (tx + 0.5) * this.tileSize,
          y: (ty + 0.5) * this.tileSize,
        });
      }
    }

    const clusters: { x: number; y: number; n: number }[] = [];
    const used = new Set<number>();
    for (let i = 0; i < points.length; i++) {
      if (used.has(i)) continue;
      let sx = points[i]!.x;
      let sy = points[i]!.y;
      let n = 1;
      used.add(i);
      for (let j = i + 1; j < points.length; j++) {
        if (used.has(j)) continue;
        if (Math.hypot(points[j]!.x - points[i]!.x, points[j]!.y - points[i]!.y) < this.tileSize * 4) {
          used.add(j);
          sx += points[j]!.x;
          sy += points[j]!.y;
          n++;
        }
      }
      clusters.push({ x: sx / n, y: sy / n, n });
    }

    this.bridgeCache = clusters.map((c) => ({ x: c.x, y: c.y }));
    return this.bridgeCache;
  }

  /** Best bridge roughly between two world points. */
  public findBridgeToward(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): { x: number; y: number } | null {
    const bridges = this.findBridgeCenters();
    if (bridges.length === 0) return null;

    let best: { x: number; y: number } | null = null;
    let bestScore = Infinity;
    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2;

    for (const b of bridges) {
      const toMid = Math.hypot(b.x - midX, b.y - midY);
      const along =
        Math.hypot(b.x - fromX, b.y - fromY) + Math.hypot(toX - b.x, toY - b.y);
      const score = along * 0.7 + toMid * 0.3;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  /** Alternate bridge farthest from the primary (for flanking). */
  public findAlternateBridge(
    primary: { x: number; y: number } | null,
  ): { x: number; y: number } | null {
    const bridges = this.findBridgeCenters();
    if (!primary) return bridges[0] ?? null;
    let best: { x: number; y: number } | null = null;
    let bestDist = -1;
    for (const b of bridges) {
      const d = Math.hypot(b.x - primary.x, b.y - primary.y);
      if (d > bestDist && d > this.tileSize * 6) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  /** Nearest hill tile center within radius (world units). */
  public findHillNear(x: number, y: number, radius: number): { x: number; y: number } | null {
    const rTiles = Math.ceil(radius / this.tileSize);
    const { tx, ty } = this.worldToTile(x, y);
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;

    for (let dy = -rTiles; dy <= rTiles; dy++) {
      for (let dx = -rTiles; dx <= rTiles; dx++) {
        const x2 = tx + dx;
        const y2 = ty + dy;
        if (x2 < 0 || y2 < 0 || x2 >= this.tileWidth || y2 >= this.tileHeight) continue;
        if (this.tiles[y2 * this.tileWidth + x2]!.type !== 'hill') continue;
        const wx = (x2 + 0.5) * this.tileSize;
        const wy = (y2 + 0.5) * this.tileSize;
        const dist = Math.hypot(wx - x, wy - y);
        if (dist < bestDist && dist <= radius) {
          bestDist = dist;
          best = { x: wx, y: wy };
        }
      }
    }
    return best;
  }

  private bridgeCache: { x: number; y: number }[] | null = null;

  public draw(ctx: CanvasRenderingContext2D, camera: Camera) {
    const pad = this.tileSize * 2;
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

    const startX = Math.max(0, Math.floor(minX / this.tileSize));
    const endX = Math.min(this.tileWidth - 1, Math.floor(maxX / this.tileSize));
    const startY = Math.max(0, Math.floor(minY / this.tileSize));
    const endY = Math.min(this.tileHeight - 1, Math.floor(maxY / this.tileSize));
    const tileW = this.tileSize * 2.2;

    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = startX; tx <= endX; tx++) {
        const tile = this.tiles[ty * this.tileWidth + tx]!;
        const cx = (tx + 0.5) * this.tileSize;
        const cy = (ty + 0.5) * this.tileSize;
        const screen = camera.worldToScreen(cx, cy);
        const spriteKey = terrainSpriteKey(
          tile.type,
          this.tiles,
          this.tileWidth,
          this.tileHeight,
          tx,
          ty,
        );
        const sprite = spriteKey ? assets.get(spriteKey) : null;

        if (sprite && spriteKey) {
          const pivotY = assets.getMeta(spriteKey)?.pivotY ?? 0.55;
          drawTileSprite(ctx, sprite, screen.x, screen.y, tileW, pivotY);
          if (tile.type === 'hill') {
            ctx.fillStyle = 'rgba(121, 85, 72, 0.18)';
            ctx.beginPath();
            ctx.ellipse(screen.x, screen.y, tileW * 0.35, tileW * 0.18, 0, 0, Math.PI * 2);
            ctx.fill();
          }
          if (tile.type === 'gold') {
            ctx.fillStyle = 'rgba(255, 193, 7, 0.42)';
            ctx.beginPath();
            ctx.ellipse(screen.x, screen.y, tileW * 0.38, tileW * 0.2, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          this.drawFallbackTile(ctx, camera, tx, ty, tile);
        }
      }
    }
  }

  public drawDecoration(ctx: CanvasRenderingContext2D, deco: MapDecoration, camera: Camera) {
    const screenPos = camera.worldToScreen(deco.x, deco.y);
    const margin = 100;
    if (
      screenPos.x < -margin ||
      screenPos.y < -margin ||
      screenPos.x > camera.width + margin ||
      screenPos.y > camera.height + margin
    ) {
      return;
    }

    const key = decorationSpriteKey(deco.kind);
    const sprite = key ? assets.get(key) : null;
    if (sprite) {
      const scale =
        deco.kind === 'tree' || deco.kind === 'pine'
          ? 0.28 + deco.radius * 0.004
          : deco.kind === 'rock'
            ? 0.26
            : deco.kind === 'cart' || deco.kind === 'marketStall'
              ? 0.24
              : 0.22;
      drawSprite(ctx, sprite, screenPos.x, screenPos.y, scale, { pivotY: 0.9 });
      return;
    }

    if (deco.kind === 'tree' || deco.kind === 'pine') {
      drawIsoTree(ctx, screenPos.x, screenPos.y, deco.radius);
    } else if (
      deco.kind === 'rock' ||
      deco.kind === 'bush' ||
      deco.kind === 'stump' ||
      deco.kind === 'skull'
    ) {
      drawIsoRock(ctx, screenPos.x, screenPos.y, deco.radius);
    }
  }

  private drawFallbackTile(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    tx: number,
    ty: number,
    tile: TerrainTile,
  ) {
    const wx = tx * this.tileSize;
    const wy = ty * this.tileSize;
    const p0 = camera.worldToScreen(wx, wy);
    const p1 = camera.worldToScreen(wx + this.tileSize, wy);
    const p2 = camera.worldToScreen(wx + this.tileSize, wy + this.tileSize);
    const p3 = camera.worldToScreen(wx, wy + this.tileSize);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.fillStyle = terrainColor(tile.type, tile.elevation);
    ctx.fill();
  }

  private buildDecorations() {
    const rng = (n: number) => {
      const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };

    /** Cap props so 160×160 does not explode draw cost. */
    const maxDeco = Math.min(2800, Math.floor(this.tileWidth * this.tileHeight * 0.045));
    let n = this.seed;
    const nearStart = (wx: number, wy: number) => {
      const da = Math.hypot(wx - this.startA.x, wy - this.startA.y);
      const db = Math.hypot(wx - this.startB.x, wy - this.startB.y);
      return Math.min(da, db) < this.tileSize * 14;
    };
    const nearGold = (wx: number, wy: number) =>
      this.goldDeposits.some((g) => Math.hypot(wx - g.x, wy - g.y) < this.tileSize * 4);

    for (let ty = 0; ty < this.tileHeight; ty++) {
      for (let tx = 0; tx < this.tileWidth; tx++) {
        if (this.decorations.length >= maxDeco) break;
        const tile = this.tiles[ty * this.tileWidth + tx]!;
        const cx = (tx + 0.5) * this.tileSize;
        const cy = (ty + 0.5) * this.tileSize;
        const urban = nearStart(cx, cy);

        if (tile.type === 'forest' || tile.type === 'denseForest') {
          if (rng(n++) < 0.48) continue;
          const pine = rng(n++) > 0.5 || tile.type === 'denseForest';
          this.decorations.push({
            x: cx + (rng(n++) - 0.5) * this.tileSize * 0.5,
            y: cy + (rng(n++) - 0.5) * this.tileSize * 0.5,
            radius: 8 + rng(n++) * 8,
            kind: pine ? 'pine' : 'tree',
          });
          if (rng(n++) > 0.88) {
            this.decorations.push({
              x: cx + (rng(n++) - 0.5) * 10,
              y: cy + (rng(n++) - 0.5) * 10,
              radius: 6,
              kind: rng(n++) > 0.55 ? 'bush' : 'stump',
            });
          }
        } else if (tile.type === 'mountain') {
          if (rng(n++) > 0.68) {
            this.decorations.push({
              x: cx + (rng(n++) - 0.5) * 8,
              y: cy + (rng(n++) - 0.5) * 8,
              radius: 10 + rng(n++) * 12,
              kind: 'rock',
            });
          }
        } else if (tile.type === 'hill' && rng(n++) > 0.82) {
          this.decorations.push({
            x: cx,
            y: cy,
            radius: 8 + rng(n++) * 6,
            kind: 'rock',
          });
        } else if (tile.type === 'grass') {
          if (urban && rng(n++) > 0.965) {
            const roll = rng(n++);
            this.decorations.push({
              x: cx + (rng(n++) - 0.5) * 6,
              y: cy + (rng(n++) - 0.5) * 6,
              radius: 5,
              kind: roll > 0.66 ? 'cart' : roll > 0.33 ? 'fence' : 'marketStall',
            });
          } else if (rng(n++) > 0.978) {
            this.decorations.push({
              x: cx,
              y: cy,
              radius: 4,
              kind: rng(n++) > 0.5 ? 'flowers' : 'blueFlowers',
            });
          } else if (rng(n++) > 0.985) {
            this.decorations.push({
              x: cx,
              y: cy,
              radius: 4,
              kind: 'pebbles',
            });
          } else if (rng(n++) > 0.972) {
            this.decorations.push({
              x: cx,
              y: cy,
              radius: 5,
              kind: rng(n++) > 0.5 ? 'bush' : 'stump',
            });
          }
        } else if (tile.type === 'road') {
          if (rng(n++) > 0.991) {
            this.decorations.push({
              x: cx,
              y: cy,
              radius: 5,
              kind: nearGold(cx, cy) || rng(n++) > 0.4 ? 'skull' : 'pebbles',
            });
          }
        }
      }
      if (this.decorations.length >= maxDeco) break;
    }

    this.decorations.sort((a, b) => a.x + a.y - (b.x + b.y));
  }
}

function terrainSpriteKey(
  type: TerrainType,
  tiles?: TerrainTile[],
  width?: number,
  height?: number,
  tx?: number,
  ty?: number,
): AssetKey | null {
  switch (type) {
    case 'grass':
    case 'forest':
    case 'denseForest':
      return 'terrain/grass';
    case 'hill':
      return 'world/hill';
    case 'stone':
    case 'iron':
      // RESOURCE_ART_MISSING: no dedicated stone/iron sprites in Manifest v2.
      return 'terrain/dirt';
    case 'mountain':
      return 'terrain/rocks';
    case 'river':
    case 'deepWater':
      return 'terrain/water';
    case 'bridge':
      return 'world/bridge';
    case 'road':
      return roadSpriteKey(tiles, width, height, tx, ty);
    case 'gold':
      return 'terrain/dirt';
  }
}

function roadSpriteKey(
  tiles?: TerrainTile[],
  width?: number,
  height?: number,
  tx?: number,
  ty?: number,
): AssetKey {
  if (!tiles || width == null || height == null || tx == null || ty == null) {
    return 'terrain/path-straight';
  }
  const isRoad = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const t = tiles[y * width + x]?.type;
    return t === 'road' || t === 'bridge';
  };
  const n = isRoad(tx, ty - 1) ? 1 : 0;
  const e = isRoad(tx + 1, ty) ? 1 : 0;
  const s = isRoad(tx, ty + 1) ? 1 : 0;
  const w = isRoad(tx - 1, ty) ? 1 : 0;
  const mask = (n << 3) | (e << 2) | (s << 1) | w;
  // 4-way
  if (mask === 0b1111) return 'terrain/path-cross';
  // T-junctions
  if (mask === 0b0111 || mask === 0b1011 || mask === 0b1101 || mask === 0b1110) {
    return 'terrain/path-t-junction';
  }
  // Corners (two adjacent)
  if (
    mask === 0b1100 ||
    mask === 0b0110 ||
    mask === 0b0011 ||
    mask === 0b1001
  ) {
    return 'terrain/path-corner';
  }
  return 'terrain/path-straight';
}

function decorationSpriteKey(kind: MapDecoration['kind']): AssetKey | null {
  switch (kind) {
    case 'tree':
      return 'terrain/tree-deciduous';
    case 'pine':
      return 'terrain/tree-pine';
    case 'rock':
      return 'terrain/rocks';
    case 'bush':
      return 'terrain/bush';
    case 'stump':
      return 'terrain/stump';
    case 'skull':
      return 'terrain/battlefield-skull';
    case 'flowers':
      return 'terrain/flowers';
    case 'blueFlowers':
      return 'terrain/blue-flowers';
    case 'pebbles':
      return 'terrain/pebbles';
    case 'cart':
      return 'terrain/cart';
    case 'fence':
      return 'terrain/fence';
    case 'marketStall':
      return 'terrain/market-stall';
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export { MAP_CONFIG };
