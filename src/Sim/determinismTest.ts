import { hashGameSnapshot } from './stateHash';
import type { GameStateSnapshot } from './serializeState';

export interface DeterminismTestResult {
  ok: boolean;
  seed: number;
  n: number;
  m: number;
  hashA: string;
  hashB: string;
  note: string;
}

/**
 * Compare two mid-run hashes after save→load→continue.
 * Caller supplies snapshots captured by the host Game.
 */
export function compareSaveLoadHashes(
  seed: number,
  n: number,
  m: number,
  afterContinue: GameStateSnapshot,
  afterReloadContinue: GameStateSnapshot,
): DeterminismTestResult {
  const hashA = hashGameSnapshot(afterContinue);
  const hashB = hashGameSnapshot(afterReloadContinue);
  const ok = hashA === hashB;
  return {
    ok,
    seed,
    n,
    m,
    hashA,
    hashB,
    note: ok
      ? 'Save→load→continue hashes match'
      : 'Mismatch — check AI/RNG/soft systems or incomplete hydrate',
  };
}
