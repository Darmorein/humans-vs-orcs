import type { GameStateSnapshot } from './serializeState';
import {
  CURRENT_DETERMINISM,
  type ReplayManifest,
  type TimedCommand,
} from './ReplayLog';

export const SAVE_FORMAT = 'hvo-save' as const;
export const SAVE_VERSION = 1 as const;
export const DEFAULT_SAVE_SLOT = 'default';

/**
 * On-disk / localStorage save package.
 * Dual payload: snapshot for reliable Load today; replay log for future reconstruct.
 */
export interface SaveGame {
  format: typeof SAVE_FORMAT;
  version: typeof SAVE_VERSION;
  savedAt: string;
  seed: number;
  simTick: number;
  /** Authoritative resume path while determinism is incomplete. */
  snapshot: GameStateSnapshot;
  /** seed + player commands — foundation for future lockstep replay. */
  replay: ReplayManifest;
}

export function buildSaveGame(args: {
  seed: number;
  simTick: number;
  snapshot: GameStateSnapshot;
  replayCommands: readonly TimedCommand[];
  replayStartTick?: number;
}): SaveGame {
  const replay: ReplayManifest = {
    format: 'hvo-replay',
    version: 1,
    seed: args.seed,
    startTick: args.replayStartTick ?? 0,
    endTick: args.simTick,
    commands: args.replayCommands.map((c) => ({
      tick: c.tick,
      command: { ...c.command },
    })),
    determinism: {
      ...CURRENT_DETERMINISM,
      notes: [...CURRENT_DETERMINISM.notes],
    },
  };

  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    seed: args.seed,
    simTick: args.simTick,
    snapshot: args.snapshot,
    replay,
  };
}

export function parseSaveGame(raw: unknown): SaveGame | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<SaveGame>;
  if (o.format !== SAVE_FORMAT) return null;
  if (o.version !== SAVE_VERSION) return null;
  if (typeof o.seed !== 'number' || typeof o.simTick !== 'number') return null;
  if (!o.snapshot || !o.replay) return null;
  return o as SaveGame;
}

export function saveSlotKey(slot: string): string {
  return `hvo.save.${slot}`;
}

export function writeSaveToStorage(save: SaveGame, slot = DEFAULT_SAVE_SLOT): void {
  localStorage.setItem(saveSlotKey(slot), JSON.stringify(save));
}

export function readSaveFromStorage(slot = DEFAULT_SAVE_SLOT): SaveGame | null {
  const raw = localStorage.getItem(saveSlotKey(slot));
  if (!raw) return null;
  try {
    return parseSaveGame(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Mark slot to apply after next boot (used when seed must change via reload). */
export function markPendingLoad(slot = DEFAULT_SAVE_SLOT): void {
  localStorage.setItem('hvo.save.pending', slot);
}

export function peekPendingLoadSlot(): string | null {
  return localStorage.getItem('hvo.save.pending');
}

export function clearPendingLoadSlot() {
  localStorage.removeItem('hvo.save.pending');
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
