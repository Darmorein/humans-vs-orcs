/**
 * Map generation coverage / layout knobs + size presets.
 * Per-tile combat & movement rules live in Terrain.ts.
 *
 * World size ≠ first-contact distance: Standard 160×160 keeps contact
 * timing via heartland placement + contested belt, not corner-to-corner spans.
 */
export const MAP_GENERATOR_VERSION = 2 as const;

/** Infantry speed used for travel-time diagnostics (matches Unit catalog ~60). */
export const INFANTRY_SPEED_WU = 60;

export type MapSizePresetId = 'compact' | 'standard' | 'large';

export interface MapSizePreset {
  id: MapSizePresetId;
  width: number;
  height: number;
  label: string;
}

export const MAP_SIZE_PRESETS: Record<MapSizePresetId, MapSizePreset> = {
  compact: { id: 'compact', width: 128, height: 128, label: 'Compact' },
  standard: { id: 'standard', width: 160, height: 160, label: 'Standard' },
  large: { id: 'large', width: 192, height: 192, label: 'Large' },
};

/** Active match preset — Standard is the primary 1v1 target. */
export const ACTIVE_MAP_PRESET: MapSizePresetId = 'standard';

const active = MAP_SIZE_PRESETS[ACTIVE_MAP_PRESET];

export const MAP_CONFIG = {
  width: active.width,
  height: active.height,
  /** Must stay aligned with Asset Manifest worldUnitsPerTile. */
  tileSize: 28,

  mountainCoverage: 0.11,
  /** Coherent forest regions — slightly lower than old speckled 26%. */
  forestCoverage: 0.2,
  waterCoverage: 0.07,

  riverCountMin: 1,
  riverCountMax: 2,
  bridgeCountMin: 2,
  bridgeCountMax: 4,
  goldDepositCount: 7,

  baseClearRadius: 5,
  goldNearBaseMin: 4,
  goldNearBaseMax: 9,

  /** Opening contact targets (seconds at INFANTRY_SPEED_WU). */
  contactCapitalToContestedSec: { min: 25, max: 45 },
  contactViaObjectiveSec: { min: 45, max: 90 },
  capitalToCapitalSec: { min: 90, max: 180 },
} as const;

export type MapConfig = typeof MAP_CONFIG;

export function mapConfigForPreset(id: MapSizePresetId): typeof MAP_CONFIG {
  const p = MAP_SIZE_PRESETS[id];
  return { ...MAP_CONFIG, width: p.width, height: p.height };
}
