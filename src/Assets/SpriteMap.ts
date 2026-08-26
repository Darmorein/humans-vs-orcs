import type { BuildingType } from '../Entities/Building';
import type { AssetKey } from './AssetPaths';
import type { AssetEntry } from './Manifest';
import { assetManifest } from './Manifest/Registry';

export function buildingSpriteKey(
  type: BuildingType,
  factionId: string = 'humans',
): AssetKey {
  switch (type) {
    case 'TownHall':
      return 'human/town-hall';
    case 'Barracks':
      return 'human/barracks';
    case 'Farm':
      return 'human/farm';
    case 'House':
      return factionId === 'orcs' ? 'orc/war-hut' : 'human/farm';
    case 'Storage':
      return factionId === 'orcs' ? 'orc/barracks' : 'human/barracks';
    case 'OrcStronghold':
      return 'orc/stronghold';
    case 'OrcBarracks':
      return 'orc/barracks';
    case 'PigFarm':
      return 'orc/war-hut';
    case 'Blacksmith':
      return factionId === 'orcs' ? 'orc/spike-tower' : 'human/watchtower';
    case 'Fort':
      return factionId === 'orcs' ? 'orc/stronghold' : 'human/town-hall';
    case 'Temple':
      return factionId === 'orcs' ? 'orc/war-hut' : 'human/watchtower';
    case 'Market':
      return factionId === 'orcs' ? 'orc/barracks' : 'human/barracks';
    case 'Wall':
      return factionId === 'orcs' ? 'orc/spike-tower' : 'human/watchtower';
  }
}

/** Manifest entry used by both rendering and gameplay geometry. */
export function buildingAssetMeta(
  type: BuildingType,
  factionId: string = 'humans',
): AssetEntry | undefined {
  return assetManifest.get(buildingSpriteKey(type, factionId));
}

/** Prefer Manifest v2 worldScale; fall back only if the registry is unavailable. */
export function buildingSpriteScale(type: BuildingType, factionId: string = 'humans'): number {
  const meta = buildingAssetMeta(type, factionId);
  if (meta) return meta.worldScale;
  switch (type) {
    case 'TownHall':
      return 0.3;
    case 'OrcStronghold':
      return 0.26;
    case 'Barracks':
      return 0.26;
    case 'OrcBarracks':
      return 0.24;
    case 'Farm':
      return 0.22;
    case 'PigFarm':
      return 0.2;
    default:
      return 0.22;
  }
}

export function buildingSpritePivotY(type: BuildingType, factionId: string = 'humans'): number {
  return buildingAssetMeta(type, factionId)?.pivotY ?? 0.88;
}

export function unitSpriteKey(
  factionId: 'humans' | 'orcs' | 'neutral' | string,
  unitType: string,
): AssetKey | null {
  if (factionId === 'humans') {
    if (unitType === 'Worker') return 'human/worker';
    if (unitType === 'Swordsman') return 'human/swordsman';
    if (unitType === 'Archer') return 'human/archer';
    if (unitType === 'Mage') return 'human/mage';
  } else if (factionId === 'orcs') {
    if (unitType === 'Peon') return 'orc/peon';
    if (unitType === 'Grunt') return 'orc/grunt';
    if (unitType === 'SpearOrc') return 'orc/spear-orc';
    if (unitType === 'Shaman') return 'orc/shaman';
  }
  return null;
}

/** Manifest entry used by both unit rendering and gameplay geometry. */
export function unitAssetMeta(factionId: string, unitType: string): AssetEntry | undefined {
  const key = unitSpriteKey(factionId, unitType);
  return key ? assetManifest.get(key) : undefined;
}

export function unitSpriteScale(factionId: string, unitType: string): number {
  const meta = unitAssetMeta(factionId, unitType);
  if (meta) return meta.worldScale;
  if (unitType === 'Worker' || unitType === 'Peon') return 0.22;
  if (unitType === 'Archer') return 0.23;
  if (unitType === 'Grunt') return 0.2;
  if (unitType === 'SpearOrc') return 0.22;
  return 0.24;
}

export function unitSpritePivotY(factionId: string, unitType: string): number {
  return unitAssetMeta(factionId, unitType)?.pivotY ?? 0.92;
}
