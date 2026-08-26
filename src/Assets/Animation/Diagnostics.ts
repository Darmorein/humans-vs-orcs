import type { IsoDirection } from '../Manifest/Types.ts';

export type MissingClipWarning = (assetId: string, state: string, direction: IsoDirection) => void;

export function createMissingClipReporter(
  enabled: boolean,
  warn: (message: string) => void = console.warn,
): MissingClipWarning {
  const reported = new Set<string>();
  return (assetId, state, direction) => {
    if (!enabled) return;
    const key = `${assetId}:${state}:${direction}`;
    if (reported.has(key)) return;
    reported.add(key);
    warn(`[Animation] Missing clip ${key}; using static sprite fallback`);
  };
}

export const reportMissingClip = createMissingClipReporter(import.meta.env?.DEV === true);
