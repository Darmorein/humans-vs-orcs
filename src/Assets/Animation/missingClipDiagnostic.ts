import type { IsoDirection } from '../Manifest/Types';
import { clipKey } from './clipLookup';

const warnedKeys = new Set<string>();

function isDevMode(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

/**
 * Emit a development-only warning once per missing `(assetId, state, direction)`.
 * Safe to call every frame — subsequent hits are silent.
 */
export function warnMissingClipOnce(
  assetId: string,
  state: string,
  direction: IsoDirection,
): void {
  if (!isDevMode()) return;
  const key = `${assetId}:${clipKey(state, direction)}`;
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(
    `[Animation] missing clip ${clipKey(state, direction)} for asset "${assetId}" — using static sprite fallback`,
  );
}

/** Test helper: clear the once-set so suites can assert diagnostics. */
export function resetMissingClipDiagnostics(): void {
  warnedKeys.clear();
}
