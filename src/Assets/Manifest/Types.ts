/**
 * Asset Manifest v2 — public schema.
 * Simulation-facing metadata (footprint, walkable, etc.) lives here;
 * graphics files are referenced by `src` and are not altered by the manifest.
 */

export const ASSET_MANIFEST_VERSION = 2 as const;

export const ISO_DIRECTIONS = ['NE', 'SE', 'SW', 'NW'] as const;
export type IsoDirection = (typeof ISO_DIRECTIONS)[number];

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

export type AssetProductionStatus = 'concept' | 'prototype' | 'production';

/** Axis-aligned size in world units (approx. footprint on the ground plane). */
export interface Footprint {
  width: number;
  height: number;
}

/** Placement footprint expressed in procedural-map tiles, independently from sprite bounds. */
export interface TileFootprint {
  columns: number;
  rows: number;
}

export interface ManifestSpaceStandard {
  projection: 'isometric-2:1';
  /** Authoring diamond used when exporting final art. */
  sourceTileWidth: number;
  sourceTileHeight: number;
  /** Runtime size of one square map cell before the 2:1 projection. */
  worldUnitsPerTile: number;
  /** Reference height used to compare Human and Orc unit scale. */
  unitReferenceHeight: number;
}

export interface ManifestAnimationStandard {
  directions: IsoDirection[];
  coreStates: string[];
  civilianStates: string[];
  rangedStates: string[];
  casterStates: string[];
}

export interface ManifestAtlasStandard {
  padding: number;
  spacing: number;
  powerOfTwo: boolean;
  maxSize: number;
}

export interface ManifestTeamColorStandard {
  requiredForFactionAssets: boolean;
  channel: 'alpha' | 'red';
  mode: 'replace' | 'multiply';
}

export interface AssetProductionStandards {
  space: ManifestSpaceStandard;
  animation: ManifestAnimationStandard;
  atlas: ManifestAtlasStandard;
  teamColor: ManifestTeamColorStandard;
}

export interface AnimationClipDefinition {
  state: string;
  direction: IsoDirection;
  startFrame: number;
  frameCount: number;
  fps: number;
  loop: boolean;
  /** Zero-based frame inside this clip; required for ranged release timing. */
  releaseFrame?: number | null;
}

/** Actual sprite-sheet layout. Null means the current asset is a static prototype sprite. */
export interface SpriteSheetDefinition {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  margin: number;
  spacing: number;
  clips: AnimationClipDefinition[];
}

export interface TeamColorMaskDefinition {
  /** Separate grayscale/alpha mask under `/assets/...`. */
  src: string;
  channel: 'alpha' | 'red';
  mode: 'replace' | 'multiply';
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

  /** Approximate occupied ground size in runtime world units. */
  footprint?: Footprint;
  /** Placement footprint on the procedural map grid. */
  footprintTiles?: TileFootprint;
  collisionFootprint?: Footprint;

  pivotX?: number;
  pivotY?: number;

  selectionRadius?: number;

  renderLayer?: RenderLayer;

  blocksMovement?: boolean;
  blocksVision?: boolean;

  teamColorMask?: TeamColorMaskDefinition | null;

  animationStates?: string[];
  animationDirections?: IsoDirection[];
  atlas?: SpriteSheetDefinition | null;

  productionStatus?: AssetProductionStatus;

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
    | 'teamColorMask'
    | 'atlas'
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
  teamColorMask: TeamColorMaskDefinition | null;
  atlas: SpriteSheetDefinition | null;

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
  standards: AssetProductionStandards;
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
