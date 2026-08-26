import type {
  AnimationClipDefinition,
  IsoDirection,
  SpriteSheetDefinition,
} from '../Manifest/Types';

/** Clip identity used by the animation player (`state:direction`). */
export function clipKey(state: string, direction: IsoDirection): string {
  return `${state}:${direction}`;
}

/**
 * Find a clip on an atlas by gameplay state and isometric direction.
 * Returns `null` when the atlas is missing or the clip is not authored.
 */
export function findClip(
  atlas: SpriteSheetDefinition | null | undefined,
  state: string,
  direction: IsoDirection,
): AnimationClipDefinition | null {
  if (!atlas) return null;
  for (const clip of atlas.clips) {
    if (clip.state === state && clip.direction === direction) return clip;
  }
  return null;
}
