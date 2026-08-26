/**
 * Asset Manifest v2 public surface.
 * Schema → defaults → validation → registry used at boot by `assets.load()`.
 */
export type {
  AssetCategory,
  AssetEntry,
  AssetEntryInput,
  AssetFaction,
  AssetManifestV2,
  AssetProductionStandards,
  AssetProductionStatus,
  AnimationClipDefinition,
  ElevationType,
  Footprint,
  IsoDirection,
  ManifestAnimationStandard,
  ManifestAtlasStandard,
  ManifestSpaceStandard,
  ManifestTeamColorStandard,
  ManifestValidationIssue,
  ManifestValidationResult,
  RenderLayer,
  SpriteSheetDefinition,
  TeamColorMaskDefinition,
  TileFootprint,
} from './Types';
export { ASSET_MANIFEST_VERSION, ISO_DIRECTIONS } from './Types';
export { ASSET_MANIFEST_V2, ASSET_PRODUCTION_STANDARDS } from './entries';
export { applyAssetDefaults } from './Defaults';
export { validateManifest } from './Validate';
export { assetManifest, AssetManifestRegistry } from './Registry';
export { runManifestGameplayChecks } from './diagnostics';
