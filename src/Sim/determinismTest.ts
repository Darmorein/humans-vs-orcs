import { hashGameSnapshot, hashString, stableStringifyForDiff } from './stateHash';
import type { GameStateSnapshot } from './serializeState';

export interface DeterminismTestResult {
  ok: boolean;
  seed: number;
  n: number;
  m: number;
  hashA: string;
  hashB: string;
  note: string;
  /** Subsystem hashes when mismatch (helps locate divergence). */
  mismatchHints?: string[];
}

export interface AiVsAiDeterminismResult {
  ok: boolean;
  seed: number;
  ticks: number;
  hashA: string;
  hashB: string;
  note: string;
  mismatchHints?: string[];
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
      : 'Mismatch — see mismatchHints for subsystem diffs',
    mismatchHints: ok ? undefined : diffSnapshotHints(afterContinue, afterReloadContinue),
  };
}

export function compareAiVsAiHashes(
  seed: number,
  ticks: number,
  snapA: GameStateSnapshot,
  snapB: GameStateSnapshot,
): AiVsAiDeterminismResult {
  const hashA = hashGameSnapshot(snapA);
  const hashB = hashGameSnapshot(snapB);
  const ok = hashA === hashB;
  return {
    ok,
    seed,
    ticks,
    hashA,
    hashB,
    note: ok
      ? 'AI vs AI twin runs match'
      : 'AI vs AI mismatch — see mismatchHints',
    mismatchHints: ok ? undefined : diffSnapshotHints(snapA, snapB),
  };
}

function subsystemHash(label: string, value: unknown): string {
  return `${label}:${hashString(stableStringifyForDiff(value))}`;
}

export function diffSnapshotHints(a: GameStateSnapshot, b: GameStateSnapshot): string[] {
  const hints: string[] = [];
  const check = (label: string, va: unknown, vb: unknown) => {
    const ha = hashString(stableStringifyForDiff(va));
    const hb = hashString(stableStringifyForDiff(vb));
    if (ha !== hb) hints.push(`${label} ${ha}≠${hb}`);
  };
  check('tick', a.simTick, b.simTick);
  check('rng', a.rngState, b.rngState);
  check('ids', a.idAllocators, b.idAllocators);
  check('players', a.players, b.players);
  check('entities', a.entities, b.entities);
  check('settlements', a.settlements, b.settlements);
  check('squads', a.squads ?? [], b.squads ?? []);
  check('heroes', a.heroes ?? [], b.heroes ?? []);
  check('artifacts', a.artifacts ?? [], b.artifacts ?? []);
  check('history', a.historyEvents ?? [], b.historyEvents ?? []);
  check('soft', a.softState ?? null, b.softState ?? null);
  check('pending', a.pendingCommands, b.pendingCommands);
  if (hints.length === 0) hints.push(subsystemHash('full', { a: hashGameSnapshot(a), b: hashGameSnapshot(b) }));
  return hints;
}
