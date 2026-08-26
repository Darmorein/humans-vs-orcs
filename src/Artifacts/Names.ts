import type { FactionId } from '../Players/Types';
import type { ArtifactQuality, ArtifactType } from './Types';

const HUMAN_PREFIX = [
  'Sunforged',
  'Oakbound',
  'Bright',
  'River',
  'Dawn',
  'Stone',
  'Silver',
  'Watch',
];
const HUMAN_SUFFIX: Record<ArtifactType, string[]> = {
  blade: ['Edge', 'Saber', 'Brand', 'Cleaver'],
  bow: ['Longbow', 'String', 'Arc', 'Shaft'],
  armor: ['Plate', 'Mail', 'Guard', 'Cuirass'],
  banner: ['Standard', 'Pennant', 'Colors'],
  relic: ['Chalice', 'Reliquary', 'Sigil'],
  tool: ['Hammer', 'Tongs', 'Anvil-Gift'],
};

const ORC_PREFIX = [
  'Blood',
  'Ash',
  'Iron',
  'Skull',
  'War',
  'Red',
  'Bone',
  'Fang',
];
const ORC_SUFFIX: Record<ArtifactType, string[]> = {
  blade: ['Choppa', 'Fang', 'Cleava', 'Tooth'],
  bow: ['Spear', 'Throwa', 'Stinga'],
  armor: ['Hide', 'Plate', 'Ribs'],
  banner: ['Totem', 'Warbanner', 'Mark'],
  relic: ['Fetish', 'Bone-Idol', 'Spirit-Stone'],
  tool: ['Smasha', 'Forge-Tooth', 'Anvil'],
};

function pick<T>(list: T[], salt: number): T {
  return list[Math.abs(salt) % list.length]!;
}

export function generateArtifactName(
  factionId: FactionId,
  type: ArtifactType,
  quality: ArtifactQuality,
  salt: number,
): string {
  const prefix =
    factionId === 'orcs' ? pick(ORC_PREFIX, salt) : pick(HUMAN_PREFIX, salt);
  const suffix =
    factionId === 'orcs'
      ? pick(ORC_SUFFIX[type], salt * 5 + 2)
      : pick(HUMAN_SUFFIX[type], salt * 5 + 2);
  const qBit =
    quality === 'legendary' ? ' the Legendary' : quality === 'masterwork' ? '' : '';
  return `${prefix} ${suffix}${qBit}`;
}
