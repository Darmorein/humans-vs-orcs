/**
 * Deterministic gameplay state hash for desync detection / determinism tests.
 * Ignores presentation (camera, DOM, fog visuals, selection).
 */

import type { GameStateSnapshot } from './serializeState';

/** FNV-1a 32-bit over a canonical JSON string. */
export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * Hash a snapshot (or any plain gameplay payload) with stable key order.
 */
export function hashGameSnapshot(snap: GameStateSnapshot): string {
  const canonical = {
    version: snap.version,
    seed: snap.seed,
    simTick: snap.simTick,
    rngState: snap.rngState,
    idAllocators: snap.idAllocators,
    players: [...snap.players].sort((a, b) => a.id.localeCompare(b.id)),
    entities: [...snap.entities].sort((a, b) => a.id - b.id),
    settlements: [...snap.settlements].sort((a, b) => a.id.localeCompare(b.id)),
    squads: snap.squads ? [...snap.squads].sort((a, b) => a.id.localeCompare(b.id)) : [],
    heroes: snap.heroes ? [...snap.heroes].sort((a, b) => a.id.localeCompare(b.id)) : [],
    artifacts: snap.artifacts
      ? [...snap.artifacts].sort((a, b) => a.id.localeCompare(b.id))
      : [],
  };
  return hashString(stableStringify(canonical));
}

export type SimulationStateHash = string;
