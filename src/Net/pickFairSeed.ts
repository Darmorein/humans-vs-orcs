import { MapGenerator } from '../Map/MapGenerator';

/**
 * Pick a procedural seed whose map validation reports gameplay-fair starts.
 * Prefers non-degraded maps (no forceCorridor). Shared by PvP clients via matchStart.
 */
export function pickFairSeed(preferred?: number, maxAttempts = 64): {
  seed: number;
  ok: boolean;
  attempts: number;
} {
  const start = (preferred ?? Math.floor(Math.random() * 1_000_000_000)) >>> 0 || 1;
  let fallback: number | null = null;
  for (let i = 0; i < maxAttempts; i++) {
    const seed = (start + i * 0x9e3779b9) >>> 0 || 1;
    const map = MapGenerator.create(seed);
    if (map.validation.ok && !map.forceCorridorUsed) {
      return { seed, ok: true, attempts: i + 1 };
    }
    if (map.validation.ok && fallback == null) fallback = seed;
  }
  if (fallback != null) return { seed: fallback, ok: true, attempts: maxAttempts };
  return { seed: start, ok: false, attempts: maxAttempts };
}
