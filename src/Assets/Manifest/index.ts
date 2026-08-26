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
  ElevationType,
  Footprint,
  ManifestValidationIssue,
  ManifestValidationResult,
  RenderLayer,
} from './Types';
export { ASSET_MANIFEST_VERSION } from './Types';
export { ASSET_MANIFEST_V2 } from './entries';
export { applyAssetDefaults } from './Defaults';
export { validateManifest } from './Validate';
export { assetManifest, AssetManifestRegistry } from './Registry';
export { runManifestGameplayChecks } from './diagnostics';
