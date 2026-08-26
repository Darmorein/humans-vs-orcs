import type { FactionId } from '../Players/Types';

/** Procedural artifact kinds — forged from world conditions, not loot tables. */
export type ArtifactType =
  | 'blade'
  | 'bow'
  | 'armor'
  | 'banner'
  | 'relic'
  | 'tool';

export type ArtifactQuality = 'fine' | 'masterwork' | 'legendary';

export interface ArtifactEffect {
  id: string;
  label: string;
  /** Soft multipliers applied while carried / vaulted. */
  attackMul?: number;
  defenseMul?: number;
  speedMul?: number;
  rangeMul?: number;
  prestigeAura?: number;
  craftsmanshipAura?: number;
  faithAura?: number;
}

export interface ArtifactHistoryEntry {
  time: number;
  text: string;
}

/**
 * Named world-born item with provenance and ownership trail.
 */
export interface Artifact {
  id: string;
  name: string;
  type: ArtifactType;
  quality: ArtifactQuality;
  /** Hero or citizen id who forged / consecrated it. */
  creatorId: string;
  settlementCreatedId: string;
  yearCreated: number;
  /** Controlling player seat. */
  currentOwnerId: string;
  factionId: FactionId;
  /** Map unit carrying it into the field; null = vaulted at settlement. */
  boundUnitId: number | null;
  vaultSettlementId: string | null;
  effects: ArtifactEffect[];
  history: ArtifactHistoryEntry[];
  /** Permanently lost (no owner). */
  lost: boolean;
}

export function artifactTypeLabel(type: ArtifactType): string {
  switch (type) {
    case 'blade':
      return 'Blade';
    case 'bow':
      return 'Bow';
    case 'armor':
      return 'Armor';
    case 'banner':
      return 'Banner';
    case 'relic':
      return 'Relic';
    case 'tool':
      return 'Tool';
  }
}

export function artifactQualityLabel(q: ArtifactQuality): string {
  switch (q) {
    case 'fine':
      return 'Fine';
    case 'masterwork':
      return 'Masterwork';
    case 'legendary':
      return 'Legendary';
  }
}

export const MAX_ARTIFACTS_PER_PLAYER = 5;
