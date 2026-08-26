import type { BuildingType } from '../Entities/Building';
import type { AssetKey } from './AssetPaths';
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

/** Prefer Manifest v2 worldScale; fall back to legacy constants. */
export function buildingSpriteScale(type: BuildingType): number {
  if (type === 'House') return 0.16;
  if (type === 'Storage' || type === 'Market') return 0.18;
  if (type === 'Wall') return 0.14;
  if (type === 'Blacksmith' || type === 'Temple') return 0.2;
  if (type === 'Fort') return 0.22;
  const key = buildingSpriteKey(type);
  const meta = assetManifest.get(key);
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

export function buildingSpritePivotY(type: BuildingType): number {
  return assetManifest.get(buildingSpriteKey(type))?.pivotY ?? 0.88;
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

export function unitSpriteScale(unitType: string): number {
  const key =
    unitType === 'Worker'
      ? 'human/worker'
      : unitType === 'Swordsman'
        ? 'human/swordsman'
        : unitType === 'Archer'
          ? 'human/archer'
          : unitType === 'Peon'
            ? 'orc/peon'
            : unitType === 'Grunt'
              ? 'orc/grunt'
              : unitType === 'SpearOrc'
                ? 'orc/spear-orc'
                : null;
  if (key) {
    const meta = assetManifest.get(key);
    if (meta) return meta.worldScale;
  }
  if (unitType === 'Worker' || unitType === 'Peon') return 0.22;
  if (unitType === 'Archer') return 0.23;
  if (unitType === 'Grunt') return 0.2;
  if (unitType === 'SpearOrc') return 0.22;
  return 0.24;
}

export function unitSpritePivotY(unitType: string): number {
  const key = unitSpriteKey(
    unitType === 'Peon' || unitType === 'Grunt' || unitType === 'SpearOrc' || unitType === 'Shaman'
      ? 'orcs'
      : 'humans',
    unitType,
  );
  return (key && assetManifest.get(key)?.pivotY) || 0.92;
}
