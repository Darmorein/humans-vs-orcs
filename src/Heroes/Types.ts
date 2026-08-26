import type { FactionId } from '../Players/Types';
import type { CitizenTrait } from '../Settlement/Population/Types';

/** Emergent hero archetypes — earned in play, never recruited from a menu. */
export type HeroType =
  | 'veteranCaptain'
  | 'warchief'
  | 'masterArcher'
  | 'legendarySmith'
  | 'priest'
  | 'explorer';

/** Traits carried on agents (units reuse citizen set + combat leanings). */
export type AgentTrait = CitizenTrait | 'bloodthirsty' | 'steadfast' | 'pious' | 'wanderer';

export interface HeroHistoryEntry {
  time: number;
  text: string;
}

/**
 * Named figure risen from a normal agent (map unit or civic citizen).
 */
export interface Hero {
  id: string;
  type: HeroType;
  name: string;
  ownerPlayerId: string;
  factionId: FactionId;
  traits: AgentTrait[];
  experience: number;
  prestige: number;
  history: HeroHistoryEntry[];
  /** Map unit binding — combat / explorer heroes. */
  boundUnitId: number | null;
  /** Civic citizen binding — smith / priest / some explorers. */
  boundCitizenId: string | null;
  alive: boolean;
  emergedAt: number;
}

export function heroTypeLabel(type: HeroType, factionId: FactionId): string {
  switch (type) {
    case 'veteranCaptain':
      return 'Veteran Captain';
    case 'warchief':
      return 'Warchief';
    case 'masterArcher':
      return factionId === 'orcs' ? 'Master Spearman' : 'Master Archer';
    case 'legendarySmith':
      return factionId === 'orcs' ? 'Legendary Artisan' : 'Legendary Smith';
    case 'priest':
      return factionId === 'orcs' ? 'Spirit Caller' : 'Priest';
    case 'explorer':
      return 'Explorer';
  }
}

export const MAX_HEROES_PER_PLAYER = 4;
