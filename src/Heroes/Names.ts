import type { FactionId } from '../Players/Types';

const HUMAN_FIRST = [
  'Aldric',
  'Brenna',
  'Cedric',
  'Elara',
  'Gareth',
  'Isolde',
  'Marcus',
  'Rowena',
  'Theron',
  'Vesper',
];
const HUMAN_LAST = [
  'of the Watch',
  'Ironhand',
  'Brightlance',
  'the Steady',
  'Oakshield',
  'Farstrider',
  'Hammerfall',
  'Dawncrest',
];

const ORC_FIRST = [
  'Grak',
  'Ugluk',
  'Sharga',
  'Morg',
  'Drakha',
  'Zug',
  'Nazg',
  'Brug',
  'Skarra',
  'Throk',
];
const ORC_LAST = [
  'Skullsplitter',
  'Bonecrusher',
  'of the Warband',
  'Bloodfang',
  'Ashwalker',
  'Ironjaw',
  'the Unbroken',
  'Redtusk',
];

function pick(list: string[], salt: number): string {
  return list[Math.abs(salt) % list.length]!;
}

/** Deterministic display name from agent id + faction. */
export function generateHeroName(factionId: FactionId, salt: number): string {
  if (factionId === 'orcs') {
    return `${pick(ORC_FIRST, salt)} ${pick(ORC_LAST, salt * 7 + 3)}`;
  }
  return `${pick(HUMAN_FIRST, salt)} ${pick(HUMAN_LAST, salt * 11 + 5)}`;
}
