import { buildingSpriteKey } from '../SpriteMap';
import { assetManifest } from './Registry';
import { ASSET_PRODUCTION_STANDARDS } from './entries';
import type { BuildingType } from '../../Entities/Building';
import { MAP_CONFIG } from '../../Map/MapConfig';

const BUILDING_TYPES: BuildingType[] = [
  'TownHall',
  'Barracks',
  'Farm',
  'House',
  'Storage',
  'OrcStronghold',
  'OrcBarracks',
  'PigFarm',
  'Blacksmith',
  'Fort',
  'Temple',
  'Market',
  'Wall',
];

const UNIT_KEYS = [
  'human/worker',
  'human/swordsman',
  'human/archer',
  'orc/peon',
  'orc/grunt',
  'orc/spear-orc',
] as const;

/**
 * Dev diagnostic: ensure gameplay sprite keys resolve in the loaded manifest.
 * Called after successful manifest validation.
 */
export function runManifestGameplayChecks(): void {
  const missing: string[] = [];

  for (const factionId of ['humans', 'orcs'] as const) {
    for (const type of BUILDING_TYPES) {
      const id = buildingSpriteKey(type, factionId);
      const entry = assetManifest.get(id);
      if (!entry) {
        missing.push(id);
        continue;
      }
      if (
        entry.category !== 'building' ||
        entry.footprint.width <= 0 ||
        entry.footprint.height <= 0 ||
        entry.collisionFootprint.width <= 0 ||
        entry.collisionFootprint.height <= 0
      ) {
        missing.push(`${id}:invalid-gameplay-geometry`);
      }
    }
  }
  for (const id of UNIT_KEYS) {
    if (!assetManifest.has(id)) missing.push(id);
  }

  const terrainNeeded = ['grass', 'hill', 'mountain', 'river', 'road'];
  for (const t of terrainNeeded) {
    if (!assetManifest.getByTerrainType(t)) {
      missing.push(`terrainType:${t}`);
    }
  }

  if (missing.length) {
    console.warn('[AssetManifest] gameplay coverage gaps:', [...new Set(missing)].join(', '));
  } else {
    console.info('[AssetManifest] gameplay sprite coverage OK');
  }

  if (MAP_CONFIG.tileSize !== ASSET_PRODUCTION_STANDARDS.space.worldUnitsPerTile) {
    console.warn(
      '[AssetManifest] tile-size mismatch:',
      `map=${MAP_CONFIG.tileSize}, manifest=${ASSET_PRODUCTION_STANDARDS.space.worldUnitsPerTile}`,
    );
  }

  reportProductionReadiness();
}

function reportProductionReadiness(): void {
  const units = assetManifest.all().filter((entry) => entry.category === 'unit');
  const factionAssets = assetManifest
    .all()
    .filter((entry) => entry.faction === 'humans' || entry.faction === 'orcs');
  const requiredDirections = ASSET_PRODUCTION_STANDARDS.animation.directions;

  const staticUnits = units.filter(
    (entry) =>
      !entry.atlas ||
      requiredDirections.some((direction) => !entry.animationDirections.includes(direction)),
  );
  const missingTeamMasks = factionAssets.filter((entry) => !entry.teamColorMask);
  const missingAuthoredSize = assetManifest
    .all()
    .filter((entry) => entry.sourceWidth == null || entry.sourceHeight == null);

  if (staticUnits.length || missingTeamMasks.length || missingAuthoredSize.length) {
    console.info(
      '[AssetManifest] prototype readiness:',
      `${staticUnits.length} unit(s) await directional atlases,`,
      `${missingTeamMasks.length} faction asset(s) await team-color masks,`,
      `${missingAuthoredSize.length} asset(s) use runtime source dimensions`,
    );
  } else {
    console.info('[AssetManifest] production metadata complete');
  }
}
