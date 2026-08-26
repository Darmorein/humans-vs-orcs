/**
 * Asset Manifest v2 — public schema.
 * Simulation-facing metadata (footprint, walkable, etc.) lives here;
 * graphics files are referenced by `src` and are not altered by the manifest.
 */

export const ASSET_MANIFEST_VERSION = 2 as const;

export type AssetCategory =
  | 'unit'
  | 'building'
  | 'terrain'
  | 'decoration'
  | 'resource'
  | 'ui'
  | 'vfx';

export type AssetFaction = 'humans' | 'orcs' | 'neutral';

export type RenderLayer = 'terrain' | 'decoration' | 'buildings' | 'units' | 'vfx' | 'ui';

export type ElevationType = 'flat' | 'raised' | 'high' | 'water' | 'none';

/** Axis-aligned size in world units (approx. footprint on the ground plane). */
export interface Footprint {
  width: number;
  height: number;
}

/**
 * Authoring shape: required identity + path; everything else may be omitted
 * and is filled by category defaults before validation.
 */
export interface AssetEntryInput {
  id: string;
  category: AssetCategory;
  /** Path under `/assets/...` (public/). */
  src: string;

  faction?: AssetFaction | null;
  role?: string | null;

  sourceWidth?: number | null;
  sourceHeight?: number | null;

  worldScale?: number;

  footprint?: Footprint;
  collisionFootprint?: Footprint;

  pivotX?: number;
  pivotY?: number;

  selectionRadius?: number;

  renderLayer?: RenderLayer;

  blocksMovement?: boolean;
  blocksVision?: boolean;

  teamColorMask?: boolean;

  animationStates?: string[];
  animationDirections?: number;

  tags?: string[];

  // --- terrain ---
  terrainType?: string | null;
  walkable?: boolean | null;
  movementCost?: number | null;
  elevationType?: ElevationType | null;
  defenseModifier?: number | null;
  visionModifier?: number | null;
  roadConnectionMask?: number | null;
  riverConnectionMask?: number | null;
}

/** Fully resolved entry after defaults — safe for runtime lookups. */
export interface AssetEntry extends Required<
  Omit<
    AssetEntryInput,
    | 'faction'
    | 'role'
    | 'sourceWidth'
    | 'sourceHeight'
    | 'terrainType'
    | 'walkable'
    | 'movementCost'
    | 'elevationType'
    | 'defenseModifier'
    | 'visionModifier'
    | 'roadConnectionMask'
    | 'riverConnectionMask'
  >
> {
  faction: AssetFaction | null;
  role: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;

  terrainType: string | null;
  walkable: boolean | null;
  movementCost: number | null;
  elevationType: ElevationType | null;
  defenseModifier: number | null;
  visionModifier: number | null;
  roadConnectionMask: number | null;
  riverConnectionMask: number | null;
}

export interface AssetManifestV2 {
  version: typeof ASSET_MANIFEST_VERSION;
  assets: AssetEntryInput[];
}

export interface ManifestValidationIssue {
  level: 'error' | 'warning';
  id?: string;
  message: string;
}

export interface ManifestValidationResult {
  ok: boolean;
  errors: ManifestValidationIssue[];
  warnings: ManifestValidationIssue[];
  entries: AssetEntry[];
}
