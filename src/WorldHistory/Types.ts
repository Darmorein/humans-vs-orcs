/**
 * Chronicle of consequential world events (not every skirmish or build).
 */

export type WorldEventType =
  | 'settlementFounded'
  | 'settlementDestroyed'
  | 'majorBattle'
  | 'heroEmerged'
  | 'heroDied'
  | 'artifactCreated'
  | 'artifactCaptured'
  | 'majorMigration'
  | 'territoryShift';

export interface WorldEventLocation {
  x: number;
  y: number;
  /** Soft links for camera focus validation. */
  settlementId?: string | null;
  unitId?: number | null;
}

export interface WorldEvent {
  id: string;
  timestamp: number;
  type: WorldEventType;
  location: WorldEventLocation;
  participants: string[];
  description: string;
  /** 0..1 — feed filters low-noise entries. */
  importance: number;
}

export function worldEventTypeLabel(type: WorldEventType): string {
  switch (type) {
    case 'settlementFounded':
      return 'Settlement Founded';
    case 'settlementDestroyed':
      return 'Settlement Destroyed';
    case 'majorBattle':
      return 'Major Battle';
    case 'heroEmerged':
      return 'Hero Emerged';
    case 'heroDied':
      return 'Hero Died';
    case 'artifactCreated':
      return 'Artifact Created';
    case 'artifactCaptured':
      return 'Artifact Captured';
    case 'majorMigration':
      return 'Major Migration';
    case 'territoryShift':
      return 'Territory Shift';
  }
}

/** Minimum importance to enter the chronicle / feed. */
export const HISTORY_IMPORTANCE_FLOOR = 0.45;
