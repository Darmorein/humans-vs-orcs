/**
 * Terrain System v2 — gameplay rules for land tiles.
 * Procedural placement of new types is out of scope; definitions are used by
 * pathfinding, movement, combat, fog, and whatever the current map emits.
 */

export type TerrainType =
  | 'grass'
  | 'road'
  | 'forest'
  | 'denseForest'
  | 'hill'
  | 'mountain'
  | 'river'
  | 'deepWater'
  | 'bridge'
  | 'gold'
  | 'stone'
  | 'iron';

/** All terrain kinds (order stable for diagnostics / UI). */
export const TERRAIN_TYPES: readonly TerrainType[] = [
  'grass',
  'road',
  'forest',
  'denseForest',
  'hill',
  'mountain',
  'river',
  'deepWater',
  'bridge',
  'gold',
  'stone',
  'iron',
] as const;

export interface TerrainTile {
  type: TerrainType;
  elevation: number;
  walkable: boolean;
  /** A* step cost; lower = faster path preference. Speed mul ≈ 1 / cost when finite. */
  movementCost: number;
  /** Fraction of ranged damage mitigated when defending on this tile (0.2 = −20%). */
  defenseModifier: number;
  /** Outgoing ranged damage bonus when attacking from this tile (0.1 = +10%). */
  rangedModifier: number;
  /** Outgoing ranged range bonus when attacking from this tile (0.15 = +15%). */
  rangedRangeModifier: number;
  /** Multiplier applied to vision radius (0.75 = −25%). */
  visionModifier: number;
}

type TerrainDef = Omit<TerrainTile, 'type' | 'elevation'>;

/**
 * Authoritative gameplay table.
 * Road +15% speed → cost 1/1.15.
 * Forest −20% speed → cost 1/0.8; ranged received −20%; vision −25%.
 */
export const TERRAIN_DEFINITIONS: Record<TerrainType, TerrainDef> = {
  grass: {
    walkable: true,
    movementCost: 1,
    defenseModifier: 0,
    rangedModifier: 0,
    rangedRangeModifier: 0,
    visionModifier: 1,
  },
  road: {
    walkable: true,
    movementCost: 1 / 1.15,
    defenseModifier: 0,
    rangedModifier: 0,
    rangedRangeModifier: 0,
    visionModifier: 1,
  },
  forest: {
    walkable: true,
    movementCost: 1 / 0.8,
    defenseModifier: 0.2,
    rangedModifier: 0,
    rangedRangeModifier: 0,
    visionModifier: 0.75,
  },
  /** Denser cover: slower, harder to shoot into, worse vision (no proc-gen yet). */
  denseForest: {
    walkable: true,
    movementCost: 1 / 0.65,
    defenseModifier: 0.3,
    rangedModifier: 0,
    rangedRangeModifier: 0,
    visionModifier: 0.6,
  },
  hill: {
    walkable: true,
    movementCost: 1.15,
    defenseModifier: 0,
    rangedModifier: 0.1,
    rangedRangeModifier: 0.15,
    visionModifier: 1.15,
  },
  mountain: {
    walkable: false,
    movementCost: Infinity,
    defenseModifier: 0,
    rangedModifier: 0,
    rangedRangeModifier: 0,
    visionModifier: 0.5,
  },
  river: {
    walkable: false,
    movementCost: Infinity,
    defenseModifier: 0,
    rangedModifier: 0,
    rangedRangeModifier: 0,
    visionModifier: 1,
  },
  deepWater: {
    walkable: false,
    movementCost: Infinity,
    defenseModifier: 0,
    rangedModifier: 0,
    rangedRangeModifier: 0,
    visionModifier: 1,
  },
  /** Walkable choke — normal navmesh cost (same as grass). */
  bridge: {
    walkable: true,
    movementCost: 1,
    defenseModifier: 0,
    rangedModifier: 0,
    rangedRangeModifier: 0,
    visionModifier: 1,
  },
  gold: {
    walkable: true,
    movementCost: 1.05,
    defenseModifier: 0,
    rangedModifier: 0,
    rangedRangeModifier: 0,
    visionModifier: 1,
  },
  stone: {
    walkable: true,
    movementCost: 1.1,
    defenseModifier: 0,
    rangedModifier: 0,
    rangedRangeModifier: 0,
    visionModifier: 1,
  },
  iron: {
    walkable: true,
    movementCost: 1.1,
    defenseModifier: 0,
    rangedModifier: 0,
    rangedRangeModifier: 0,
    visionModifier: 1,
  },
};

export function createTile(type: TerrainType, elevation: number): TerrainTile {
  const def = TERRAIN_DEFINITIONS[type];
  return {
    type,
    elevation,
    walkable: def.walkable,
    movementCost: def.movementCost,
    defenseModifier: def.defenseModifier,
    rangedModifier: def.rangedModifier,
    rangedRangeModifier: def.rangedRangeModifier,
    visionModifier: def.visionModifier,
  };
}

export function isWaterTerrain(type: TerrainType): boolean {
  return type === 'river' || type === 'deepWater';
}

export function isForestTerrain(type: TerrainType): boolean {
  return type === 'forest' || type === 'denseForest';
}

/** Land units cannot enter water / mountains. Bridge remains walkable. */
export function isLandPassable(type: TerrainType): boolean {
  return TERRAIN_DEFINITIONS[type].walkable;
}

export function isBuildableTerrain(type: TerrainType): boolean {
  return type === 'grass' || type === 'road' || type === 'hill';
}

export function terrainColor(type: TerrainType, elevation: number): string {
  switch (type) {
    case 'grass': {
      const shade = Math.floor(90 + elevation * 40);
      return `rgb(${50 + shade * 0.2}, ${140 + shade * 0.3}, ${55 + shade * 0.1})`;
    }
    case 'forest':
      return elevation > 0.5 ? '#2E7D32' : '#388E3C';
    case 'denseForest':
      return '#1B5E20';
    case 'hill':
      return '#8D6E63';
    case 'mountain':
      return elevation > 0.85 ? '#ECEFF1' : '#78909C';
    case 'river':
      return elevation < 0.12 ? '#1565C0' : '#1E88E5';
    case 'deepWater':
      return '#0D47A1';
    case 'bridge':
      return '#A1887F';
    case 'road':
      return '#BCAAA4';
    case 'gold':
      return '#F9A825';
    case 'stone':
      return '#90A4AE';
    case 'iron':
      return '#546E7A';
  }
}

/** Dev check: every TerrainType has a definition row. */
export function assertTerrainDefinitionsComplete(): void {
  for (const type of TERRAIN_TYPES) {
    if (!TERRAIN_DEFINITIONS[type]) {
      throw new Error(`[Terrain] missing definition for ${type}`);
    }
  }
}
