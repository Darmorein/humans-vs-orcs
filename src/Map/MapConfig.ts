/**
 * Map generation coverage / layout knobs.
 * Per-tile combat & movement rules live in Terrain.ts (Terrain System v2).
 */
export const MAP_CONFIG = {
  width: 112,
  height: 112,
  tileSize: 28,

  mountainCoverage: 0.13,
  forestCoverage: 0.26,
  waterCoverage: 0.07,

  riverCountMin: 1,
  riverCountMax: 2,
  bridgeCountMin: 2,
  bridgeCountMax: 4,
  goldDepositCount: 6,

  baseClearRadius: 5,
  goldNearBaseMin: 4,
  goldNearBaseMax: 8,
} as const;

export type MapConfig = typeof MAP_CONFIG;
