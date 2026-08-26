import { Building } from '../Entities/Building';
import type { Entity } from '../Entities/Entity';
import { ResourceNode } from '../Entities/ResourceNode';
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

  // Sample ring so large footprints don't sit half on water/rock.
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

/** Default clearance radius for a building type (world units). */
export function footprintForBuildingType(type: string): number {
  if (type === 'TownHall' || type === 'OrcStronghold' || type === 'Fort') return 48;
  if (type === 'Barracks' || type === 'OrcBarracks') return 40;
  if (type === 'House' || type === 'Wall') return 28;
  if (type === 'Farm' || type === 'PigFarm') return 32;
  return 36;
}
