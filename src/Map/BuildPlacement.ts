import { Building } from '../Entities/Building';
import type { Entity } from '../Entities/Entity';
import { ResourceNode } from '../Entities/ResourceNode';
import { footprintForTarget } from '../Settlement/ConstructionCatalog';
import type { GameMap } from './GameMap';

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
  if (!gameMap.canBuildAt(x, y)) return false;

  const samples = 6;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    const sx = x + Math.cos(a) * footprintRadius * 0.65;
    const sy = y + Math.sin(a) * footprintRadius * 0.65;
    if (!gameMap.canBuildAt(sx, sy)) return false;
  }

  for (const e of entities) {
    if (e.isDead) continue;
    if (e instanceof Building) {
      const minSep = footprintRadius + e.radius * 0.9;
      if (Math.hypot(e.x - x, e.y - y) < minSep) return false;
    } else if (e instanceof ResourceNode) {
      if (Math.hypot(e.x - x, e.y - y) < footprintRadius + e.radius + 8) return false;
    }
  }
  return true;
}

/** Prefer ConstructionCatalog.footprintForTarget — kept for call-site compatibility. */
export function footprintForBuildingType(type: string): number {
  return footprintForTarget(type);
}
