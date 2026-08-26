import { applyAssetDefaults } from './Defaults';
import {
  ASSET_MANIFEST_VERSION,
  ISO_DIRECTIONS,
  type AssetCategory,
  type AssetEntry,
  type AssetEntryInput,
  type AssetManifestV2,
  type AssetProductionStandards,
  type IsoDirection,
  type ManifestValidationIssue,
  type ManifestValidationResult,
  type RenderLayer,
  type SpriteSheetDefinition,
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

const DIRECTIONS: ReadonlySet<string> = new Set<IsoDirection>(ISO_DIRECTIONS);
const PRODUCTION_STATUSES = new Set(['concept', 'prototype', 'production']);

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

  validateStandards(raw.standards, errors);

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
  validateFootprint(entry.footprint, 'footprint', entry.id, errors, false);
  validateFootprint(entry.collisionFootprint, 'collisionFootprint', entry.id, errors, true);
  validateTileFootprint(entry, errors);

  if (entry.selectionRadius < 0) {
    errors.push({ level: 'error', id: entry.id, message: 'selectionRadius must be >= 0' });
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
  if (entry.animationDirections.length < 1) {
    errors.push({
      level: 'error',
      id: entry.id,
      message: 'animationDirections must contain at least one direction',
    });
  }
  if (new Set(entry.animationDirections).size !== entry.animationDirections.length) {
    errors.push({ level: 'error', id: entry.id, message: 'animationDirections contains duplicates' });
  }
  for (const direction of entry.animationDirections) {
    if (!DIRECTIONS.has(direction)) {
      errors.push({
        level: 'error',
        id: entry.id,
        message: `Unknown animation direction "${direction}"`,
      });
    }
  }
  if (!PRODUCTION_STATUSES.has(entry.productionStatus)) {
    errors.push({
      level: 'error',
      id: entry.id,
      message: `Unknown productionStatus "${entry.productionStatus}"`,
    });
  }
  if (entry.atlas) validateAtlas(entry.atlas, entry, errors);
  if (entry.teamColorMask) {
    if (!entry.teamColorMask.src.startsWith('/assets/')) {
      errors.push({
        level: 'error',
        id: entry.id,
        message: 'teamColorMask.src must start with /assets/',
      });
    }
  }
  if ((entry.sourceWidth == null) !== (entry.sourceHeight == null)) {
    errors.push({
      level: 'error',
      id: entry.id,
      message: 'sourceWidth and sourceHeight must be authored together',
    });
  }
  if (
    (entry.sourceWidth != null && entry.sourceWidth < 1) ||
    (entry.sourceHeight != null && entry.sourceHeight < 1)
  ) {
    errors.push({
      level: 'error',
      id: entry.id,
      message: 'sourceWidth/sourceHeight must be positive when authored',
    });
  }
  if (entry.productionStatus === 'production') {
    if (entry.sourceWidth == null || entry.sourceHeight == null) {
      errors.push({
        level: 'error',
        id: entry.id,
        message: 'Production assets require authored sourceWidth/sourceHeight',
      });
    }
    if (entry.category === 'unit' && !entry.atlas) {
      errors.push({
        level: 'error',
        id: entry.id,
        message: 'Production unit assets require an atlas definition',
      });
    }
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

function validateStandards(
  standards: AssetProductionStandards | undefined,
  errors: ManifestValidationIssue[],
) {
  if (!standards) {
    errors.push({ level: 'error', message: 'Manifest production standards are missing' });
    return;
  }
  const { space, animation, atlas, teamColor } = standards;
  if (space.projection !== 'isometric-2:1') {
    errors.push({ level: 'error', message: 'Manifest projection must be isometric-2:1' });
  }
  if (!(space.sourceTileWidth > 0) || !(space.sourceTileHeight > 0)) {
    errors.push({ level: 'error', message: 'Source tile dimensions must be > 0' });
  } else if (space.sourceTileWidth !== space.sourceTileHeight * 2) {
    errors.push({ level: 'error', message: 'Source tile dimensions must keep a 2:1 ratio' });
  }
  if (!(space.worldUnitsPerTile > 0) || !(space.unitReferenceHeight > 0)) {
    errors.push({ level: 'error', message: 'World scale standards must be > 0' });
  }
  if (
    animation.directions.length !== ISO_DIRECTIONS.length ||
    ISO_DIRECTIONS.some((direction) => !animation.directions.includes(direction))
  ) {
    errors.push({
      level: 'error',
      message: `Production animation standard must define ${ISO_DIRECTIONS.join(', ')}`,
    });
  }
  if (animation.coreStates.length === 0) {
    errors.push({ level: 'error', message: 'Production core animation states are missing' });
  }
  if (atlas.padding < 0 || atlas.spacing < 0 || atlas.maxSize < 1) {
    errors.push({ level: 'error', message: 'Atlas padding/spacing/maxSize values are invalid' });
  }
  if (
    typeof teamColor.requiredForFactionAssets !== 'boolean' ||
    (teamColor.channel !== 'alpha' && teamColor.channel !== 'red') ||
    (teamColor.mode !== 'replace' && teamColor.mode !== 'multiply')
  ) {
    errors.push({ level: 'error', message: 'Team-color production standard is invalid' });
  }
}

function validateFootprint(
  footprint: { width: number; height: number },
  label: string,
  id: string,
  errors: ManifestValidationIssue[],
  allowZero: boolean,
) {
  const validWidth = allowZero ? footprint.width >= 0 : footprint.width > 0;
  const validHeight = allowZero ? footprint.height >= 0 : footprint.height > 0;
  if (!validWidth || !validHeight) {
    errors.push({
      level: 'error',
      id,
      message: `${label} dimensions must be ${allowZero ? '>= 0' : '> 0'}`,
    });
  }
}

function validateTileFootprint(entry: AssetEntry, errors: ManifestValidationIssue[]) {
  const allowZero = entry.category === 'ui' || entry.category === 'vfx';
  const { columns, rows } = entry.footprintTiles;
  const validColumns = Number.isInteger(columns) && (allowZero ? columns >= 0 : columns > 0);
  const validRows = Number.isInteger(rows) && (allowZero ? rows >= 0 : rows > 0);
  if (!validColumns || !validRows) {
    errors.push({
      level: 'error',
      id: entry.id,
      message: `footprintTiles must use integer ${allowZero ? 'non-negative' : 'positive'} dimensions`,
    });
  }
}

function validateAtlas(
  atlas: SpriteSheetDefinition,
  entry: AssetEntry,
  errors: ManifestValidationIssue[],
) {
  const id = entry.id;
  const ints = [atlas.frameWidth, atlas.frameHeight, atlas.columns, atlas.rows];
  if (ints.some((value) => !Number.isInteger(value) || value < 1)) {
    errors.push({
      level: 'error',
      id,
      message: 'Atlas frame dimensions, columns and rows must be positive integers',
    });
  }
  if (atlas.margin < 0 || atlas.spacing < 0) {
    errors.push({ level: 'error', id, message: 'Atlas margin and spacing must be >= 0' });
  }
  const capacity = atlas.columns * atlas.rows;
  const occupied = new Set<number>();
  const clipKeys = new Set<string>();
  for (const clip of atlas.clips) {
    const key = `${clip.state}:${clip.direction}`;
    if (clipKeys.has(key)) {
      errors.push({ level: 'error', id, message: `Duplicate atlas clip "${key}"` });
    }
    clipKeys.add(key);
    if (!clip.state.trim() || !DIRECTIONS.has(clip.direction)) {
      errors.push({ level: 'error', id, message: `Invalid atlas clip identity "${key}"` });
    }
    if (!entry.animationStates.includes(clip.state)) {
      errors.push({
        level: 'error',
        id,
        message: `Atlas clip state "${clip.state}" is absent from animationStates`,
      });
    }
    if (!entry.animationDirections.includes(clip.direction)) {
      errors.push({
        level: 'error',
        id,
        message: `Atlas clip direction "${clip.direction}" is absent from animationDirections`,
      });
    }
    if (
      !Number.isInteger(clip.startFrame) ||
      clip.startFrame < 0 ||
      !Number.isInteger(clip.frameCount) ||
      clip.frameCount < 1 ||
      clip.startFrame + clip.frameCount > capacity ||
      !(clip.fps > 0)
    ) {
      errors.push({ level: 'error', id, message: `Invalid atlas range for clip "${key}"` });
      continue;
    }
    if (
      clip.releaseFrame != null &&
      (!Number.isInteger(clip.releaseFrame) ||
        clip.releaseFrame < 0 ||
        clip.releaseFrame >= clip.frameCount)
    ) {
      errors.push({ level: 'error', id, message: `Invalid releaseFrame for clip "${key}"` });
    }
    for (let frame = clip.startFrame; frame < clip.startFrame + clip.frameCount; frame++) {
      if (occupied.has(frame)) {
        errors.push({ level: 'error', id, message: `Atlas frame ${frame} is assigned twice` });
      }
      occupied.add(frame);
    }
  }
  if (entry.sourceWidth != null && entry.sourceHeight != null) {
    const expectedWidth =
      atlas.margin * 2 + atlas.columns * atlas.frameWidth + (atlas.columns - 1) * atlas.spacing;
    const expectedHeight =
      atlas.margin * 2 + atlas.rows * atlas.frameHeight + (atlas.rows - 1) * atlas.spacing;
    if (expectedWidth !== entry.sourceWidth || expectedHeight !== entry.sourceHeight) {
      errors.push({
        level: 'error',
        id,
        message:
          `Atlas geometry resolves to ${expectedWidth}x${expectedHeight}, ` +
          `but source is ${entry.sourceWidth}x${entry.sourceHeight}`,
      });
    }
  }
}
