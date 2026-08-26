import { buildingSpriteKey } from '../SpriteMap';
import { assetManifest } from './Registry';
import type { BuildingType } from '../../Entities/Building';

const BUILDING_TYPES: BuildingType[] = [
  'TownHall',
  'Barracks',
  'Farm',
  'OrcStronghold',
  'OrcBarracks',
  'PigFarm',
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

  for (const type of BUILDING_TYPES) {
    const id = buildingSpriteKey(type);
    if (!assetManifest.has(id)) missing.push(id);
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
    console.warn('[AssetManifest] gameplay coverage gaps:', missing.join(', '));
  } else {
    console.info('[AssetManifest] gameplay sprite coverage OK');
  }
}
