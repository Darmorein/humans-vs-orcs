import { Building } from '../Entities/Building';
import type { BuildingType } from '../Entities/Building';
import type { Entity } from '../Entities/Entity';
import { ResourceNode } from '../Entities/ResourceNode';
import { buildingAssetMeta } from '../Assets/SpriteMap';
import { ASSET_PRODUCTION_STANDARDS } from '../Assets/Manifest';
import type { GameMap } from './GameMap';
import { isBuildableTerrain } from './Terrain';

/**
 * Terrain + footprint clearance for placing a building.
 * Manual placement must use this — GameMap.canBuildAt is terrain-only.
 */
export function canPlaceBuildingAt(
  x: number,
  y: number,
  gameMap: GameMap,
  entities: readonly Entity[],
  footprintRadius = 36,
): boolean {
  return placementBlockReason(x, y, gameMap, entities, footprintRadius) === null;
}

/** Human-readable reason a site is blocked, or null if valid. */
export function placementBlockReason(
  x: number,
  y: number,
  gameMap: GameMap,
  entities: readonly Entity[],
  footprintRadius = 36,
): string | null {
  const center = gameMap.getTileAt(x, y);
  if (!isBuildableTerrain(center.type)) {
    return `Bad terrain (${center.type})`;
  }

  const samples = 6;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    const sx = x + Math.cos(a) * footprintRadius * 0.65;
    const sy = y + Math.sin(a) * footprintRadius * 0.65;
    const t = gameMap.getTileAt(sx, sy);
    if (!isBuildableTerrain(t.type)) {
      return `Footprint hits ${t.type}`;
    }
  }

  for (const e of entities) {
    if (e.isDead) continue;
    if (e instanceof Building) {
      const minSep = footprintRadius + e.radius * 0.9;
      if (Math.hypot(e.x - x, e.y - y) < minSep) {
        return `Too close to ${e.buildingType}`;
      }
    } else if (e instanceof ResourceNode) {
      if (Math.hypot(e.x - x, e.y - y) < footprintRadius + e.radius + 8) {
        return 'Too close to gold deposit';
      }
    }
  }
  return null;
}

/**
 * Manifest-driven clearance radius for a building type (world units).
 * Shared by placement preview and simulation validation.
 */
export function footprintForBuildingType(type: string, factionId: string = 'humans'): number {
  const meta = buildingAssetMeta(type as BuildingType, factionId);
  if (meta) {
    const unitsPerTile = ASSET_PRODUCTION_STANDARDS.space.worldUnitsPerTile;
    return Math.max(
      meta.footprint.width / 2,
      meta.footprint.height / 2,
      (meta.footprintTiles.columns * unitsPerTile) / 2,
      (meta.footprintTiles.rows * unitsPerTile) / 2,
    );
  }

  if (type === 'TownHall' || type === 'OrcStronghold' || type === 'Fort') return 48;
  if (type === 'Outpost') return 32;
  if (type === 'Barracks' || type === 'OrcBarracks') return 40;
  if (type === 'House' || type === 'Wall') return 28;
  if (type === 'Farm' || type === 'PigFarm') return 32;
  return 36;
}
