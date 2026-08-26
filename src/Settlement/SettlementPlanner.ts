import { Building, isMainBuilding, type BuildingType } from '../Entities/Building';
import { Entity } from '../Entities/Entity';
import { ResourceNode } from '../Entities/ResourceNode';
import { canPlaceBuildingAt } from '../Map/BuildPlacement';
import type { GameMap } from '../Map/GameMap';
import { isWaterTerrain } from '../Map/Terrain';
import type { SettlementLayoutProfile } from './LayoutVariants';
import type { SettlementNeedKind } from './Types';

export type BuildRole = 'housing' | 'food' | 'storage' | 'production' | 'generic';

export interface PlacementRequest {
  centerX: number;
  centerY: number;
  layout: SettlementLayoutProfile;
  /** How far the settlement has already grown (world units). */
  expansionRadius: number;
  buildingType: BuildingType;
  role: BuildRole;
  entities: Entity[];
  gameMap: GameMap;
  /** Stable salt so repeated searches don't always pick the same first candidate. */
  attemptSalt?: number;
}

/**
 * Organic settlement placement — no rigid grid.
 * Scores candidates around the town center with layout bias, road preference,
 * spacing, and hard blocks (water / mountain / buildings / rocks).
 */
export class SettlementPlanner {
  public findSite(req: PlacementRequest): { x: number; y: number; score: number } | null {
    const spacing = this.spacingFor(req.buildingType, req.layout);
    const candidates: { x: number; y: number; score: number }[] = [];
    const salt = req.attemptSalt ?? 0;
    const rings = 6;

    for (let ring = 1; ring <= rings; ring++) {
      const baseR =
        this.roleMinRadius(req.role, req.layout) +
        ring * (26 + req.layout.houseClustering * 8) +
        (salt % 7) * 3;
      const steps = 10 + ring * 5;
      for (let i = 0; i < steps; i++) {
        const t = (i + salt * 0.37) / steps;
        const ang =
          req.layout.arcCenter -
          req.layout.arcSpan * 0.5 +
          t * req.layout.arcSpan +
          (Math.sin((i + salt) * 1.7) * 0.5) * req.layout.angleJitter;
        const r = baseR * (1 + ((i + salt) % 5) * 0.04 * req.layout.radiusJitter);
        const x = req.centerX + Math.cos(ang) * r;
        const y = req.centerY + Math.sin(ang) * r * 0.92;
        if (!this.isClear(x, y, spacing, req)) continue;
        const score =
          this.scoreCandidate(
            x,
            y,
            Math.atan2(y - req.centerY, x - req.centerX),
            Math.hypot(x - req.centerX, y - req.centerY),
            this.roleMinRadius(req.role, req.layout),
            req.expansionRadius,
            req,
          ) +
          12 * req.layout.roadBias;
        candidates.push({ x, y, score });
      }
    }

    this.scatterFill(candidates, spacing, req);

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
    return candidates[0] ?? null;
  }

  public static roleFor(
    need: SettlementNeedKind | 'production',
    buildingType: BuildingType,
  ): BuildRole {
    if (need === 'housing' || buildingType === 'House') return 'housing';
    if (need === 'food' || buildingType === 'Farm' || buildingType === 'PigFarm') return 'food';
    if (need === 'storage' || buildingType === 'Storage') return 'storage';
    if (
      need === 'production' ||
      buildingType === 'Barracks' ||
      buildingType === 'OrcBarracks' ||
      buildingType === 'Blacksmith'
    ) {
      return 'production';
    }
    return 'generic';
  }

  /** How far the settlement footprint currently extends from the main. */
  public static computeExpansion(
    centerX: number,
    centerY: number,
    entities: Entity[],
    playerId: string,
  ): number {
    let maxR = 120;
    for (const e of entities) {
      if (e.isDead || !(e instanceof Building)) continue;
      if (e.ownerPlayerId !== playerId) continue;
      const d = Math.hypot(e.x - centerX, e.y - centerY) + e.radius;
      if (d > maxR) maxR = d;
    }
    return Math.min(360, Math.max(120, maxR + 40));
  }

  private spacingFor(type: BuildingType, layout: SettlementLayoutProfile): number {
    const base =
      type === 'TownHall' || type === 'OrcStronghold'
        ? 56
        : type === 'House'
          ? 28 + layout.houseClustering * 6
          : type === 'Wall'
            ? 24
            : type === 'Farm' || type === 'PigFarm'
              ? 34 + layout.farmOutward * 4
              : 38;
    return base;
  }

  private roleMinRadius(role: BuildRole, layout: SettlementLayoutProfile): number {
    if (role === 'housing') return 50 + layout.houseClustering * 20;
    if (role === 'food') return 70 + layout.farmOutward * 40;
    if (role === 'storage') return 55;
    if (role === 'production') return 85;
    return 60;
  }

  private scatterFill(
    out: { x: number; y: number; score: number }[],
    spacing: number,
    req: PlacementRequest,
  ) {
    const n = 28;
    for (let i = 0; i < n; i++) {
      const t = (i + (req.attemptSalt ?? 0) * 0.13) / n;
      const ang =
        req.layout.arcCenter -
        req.layout.arcSpan * 0.5 +
        t * req.layout.arcSpan +
        Math.sin(i * 2.1) * req.layout.angleJitter;
      const r =
        this.roleMinRadius(req.role, req.layout) +
        (req.expansionRadius * 0.4 + 50) * (0.35 + (i % 5) * 0.12) *
          (1 + ((i % 3) - 1) * 0.08 * req.layout.radiusJitter);
      const x = req.centerX + Math.cos(ang) * r;
      const y = req.centerY + Math.sin(ang) * r * 0.9;
      if (!this.isClear(x, y, spacing, req)) continue;
      const score =
        this.scoreCandidate(
          x,
          y,
          Math.atan2(y - req.centerY, x - req.centerX),
          Math.hypot(x - req.centerX, y - req.centerY),
          this.roleMinRadius(req.role, req.layout),
          req.expansionRadius,
          req,
        ) +
        12 * req.layout.roadBias;
      out.push({ x, y, score });
    }
  }

  private isClear(x: number, y: number, spacing: number, req: PlacementRequest): boolean {
    if (x < 60 || y < 60 || x > req.gameMap.width - 60 || y > req.gameMap.height - 60) {
      return false;
    }
    if (!canPlaceBuildingAt(x, y, req.gameMap, req.entities, spacing)) return false;

    const tile = req.gameMap.getTileAt(x, y);
    if (isWaterTerrain(tile.type) || tile.type === 'mountain') return false;
    if (tile.type === 'stone' || tile.type === 'iron' || tile.type === 'gold') return false;

    for (const deco of req.gameMap.decorations) {
      if (deco.kind !== 'rock') continue;
      if (Math.hypot(deco.x - x, deco.y - y) < deco.radius + spacing * 0.45) return false;
    }

    // Extra soft spacing vs buildings (canPlaceBuildingAt already hard-blocks overlap)
    for (const e of req.entities) {
      if (e.isDead) continue;
      if (e instanceof Building || e instanceof ResourceNode) {
        const er = e instanceof Building ? e.radius + spacing * 0.2 : e.radius + 10;
        if (Math.hypot(e.x - x, e.y - y) < spacing * 0.85 + er * 0.45) return false;
      }
    }
    return true;
  }

  private scoreCandidate(
    x: number,
    y: number,
    ang: number,
    dist: number,
    minR: number,
    expansion: number,
    req: PlacementRequest,
  ): number {
    let score = 100;
    const half = req.layout.arcSpan * 0.5;
    const angDiff = angularDistance(ang, req.layout.arcCenter);
    if (angDiff > half) score -= (angDiff - half) * 25;
    else score += (half - angDiff) * 6;

    if (dist < minR) score -= (minR - dist) * 2;
    if (dist > expansion + 40) score -= (dist - expansion) * 0.4;

    const tile = req.gameMap.getTileAt(x, y);
    if (tile.type === 'grass' || tile.type === 'road' || tile.type === 'hill') score += 15;
    if (tile.type === 'road') score += 20 * req.layout.roadBias;
    if (tile.type === 'forest' || tile.type === 'denseForest') score -= 8;

    if (isMainBuilding(req.buildingType)) score += 5;

    const edge = Math.min(x, y, req.gameMap.width - x, req.gameMap.height - y);
    score += Math.min(40, edge * 0.05);

    return score;
  }
}

function angularDistance(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

export const settlementPlanner = new SettlementPlanner();
