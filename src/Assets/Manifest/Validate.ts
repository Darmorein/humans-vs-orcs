import { applyAssetDefaults } from './Defaults';
import {
  ASSET_MANIFEST_VERSION,
  type AssetCategory,
  type AssetEntry,
  type AssetEntryInput,
  type AssetManifestV2,
  type ManifestValidationIssue,
  type ManifestValidationResult,
  type RenderLayer,
} from './Types';

const CATEGORIES: ReadonlySet<string> = new Set<AssetCategory>([
  'unit',
  'building',
  'terrain',
  'decoration',
  'resource',
  'ui',
  'vfx',
]);

const LAYERS: ReadonlySet<string> = new Set<RenderLayer>([
  'terrain',
  'decoration',
  'buildings',
  'units',
  'vfx',
  'ui',
]);

/**
 * Resolve defaults then validate. Errors block boot; warnings are logged.
 */
export function validateManifest(raw: AssetManifestV2): ManifestValidationResult {
  const errors: ManifestValidationIssue[] = [];
  const warnings: ManifestValidationIssue[] = [];

  if (raw.version !== ASSET_MANIFEST_VERSION) {
    errors.push({
      level: 'error',
      message: `Unsupported manifest version ${String(raw.version)}; expected ${ASSET_MANIFEST_VERSION}`,
    });
  }

  if (!Array.isArray(raw.assets) || raw.assets.length === 0) {
    errors.push({ level: 'error', message: 'Manifest assets array is empty or missing' });
    return { ok: false, errors, warnings, entries: [] };
  }

  const seen = new Set<string>();
  const entries: AssetEntry[] = [];

  for (const input of raw.assets) {
    validateInputShape(input, errors, warnings);
    if (!input?.id || !input?.category || !input?.src) continue;

    if (seen.has(input.id)) {
      errors.push({ level: 'error', id: input.id, message: `Duplicate asset id "${input.id}"` });
      continue;
    }
    seen.add(input.id);

    const entry = applyAssetDefaults(input);
    validateResolved(entry, errors, warnings);
    entries.push(entry);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    entries,
  };
}

function validateInputShape(
  input: AssetEntryInput | undefined,
  errors: ManifestValidationIssue[],
  warnings: ManifestValidationIssue[],
) {
  if (!input || typeof input !== 'object') {
    errors.push({ level: 'error', message: 'Asset entry is not an object' });
    return;
  }
  if (typeof input.id !== 'string' || !input.id.trim()) {
    errors.push({ level: 'error', message: 'Asset entry missing id' });
  }
  if (!CATEGORIES.has(input.category)) {
    errors.push({
      level: 'error',
      id: input.id,
      message: `Unknown category "${String(input.category)}"`,
    });
  }
  if (typeof input.src !== 'string' || !input.src.startsWith('/assets/')) {
    errors.push({
      level: 'error',
      id: input.id,
      message: `src must start with /assets/ (got "${String(input.src)}")`,
    });
  }
  if (input.category === 'terrain' && input.terrainType == null) {
    warnings.push({
      level: 'warning',
      id: input.id,
      message: 'Terrain asset has no terrainType; gameplay will not map it by type',
    });
  }
}

function validateResolved(
  entry: AssetEntry,
  errors: ManifestValidationIssue[],
  warnings: ManifestValidationIssue[],
) {
  if (!(entry.worldScale > 0)) {
    errors.push({ level: 'error', id: entry.id, message: 'worldScale must be > 0' });
  }
  if (entry.pivotX < 0 || entry.pivotX > 1 || entry.pivotY < 0 || entry.pivotY > 1) {
    errors.push({
      level: 'error',
      id: entry.id,
      message: `pivot must be in [0,1] (got ${entry.pivotX}, ${entry.pivotY})`,
    });
  }
  if (!LAYERS.has(entry.renderLayer)) {
    errors.push({
      level: 'error',
      id: entry.id,
      message: `Unknown renderLayer "${entry.renderLayer}"`,
    });
  }
  if (entry.animationDirections < 1) {
    errors.push({
      level: 'error',
      id: entry.id,
      message: 'animationDirections must be >= 1',
    });
  }
  if (entry.category === 'terrain') {
    if (entry.walkable == null) {
      warnings.push({
        level: 'warning',
        id: entry.id,
        message: 'Terrain walkable defaulted to null',
      });
    }
    if (entry.movementCost != null && !(entry.movementCost > 0)) {
      errors.push({
        level: 'error',
        id: entry.id,
        message: 'terrain movementCost must be > 0 when set',
      });
    }
  }
  // sourceWidth/Height stay null until image load; AssetManager fills them.
}
