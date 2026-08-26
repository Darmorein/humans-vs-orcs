import type {
  AnimationClipDefinition,
  IsoDirection,
  SpriteSheetDefinition,
} from '../Manifest/Types.ts';

export interface AtlasFrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
  frameIndex: number;
}

export function findAnimationClip(
  atlas: SpriteSheetDefinition | null,
  state: string,
  direction: IsoDirection,
): AnimationClipDefinition | null {
  if (!atlas) return null;
  return atlas.clips.find((clip) => clip.state === state && clip.direction === direction) ?? null;
}

/** Convert a zero-based atlas frame index into its source-image rectangle. */
export function atlasFrameRect(
  atlas: SpriteSheetDefinition,
  frameIndex: number,
): AtlasFrameRect | null {
  const capacity = atlas.columns * atlas.rows;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= capacity) return null;

  const column = frameIndex % atlas.columns;
  const row = Math.floor(frameIndex / atlas.columns);
  return {
    x: atlas.margin + column * (atlas.frameWidth + atlas.spacing),
    y: atlas.margin + row * (atlas.frameHeight + atlas.spacing),
    width: atlas.frameWidth,
    height: atlas.frameHeight,
    frameIndex,
  };
}

export function clipFrameRect(
  atlas: SpriteSheetDefinition | null,
  state: string,
  direction: IsoDirection,
  localFrame: number,
): AtlasFrameRect | null {
  const clip = findAnimationClip(atlas, state, direction);
  if (
    !atlas ||
    !clip ||
    !Number.isInteger(localFrame) ||
    localFrame < 0 ||
    localFrame >= clip.frameCount
  ) {
    return null;
  }
  return atlasFrameRect(atlas, clip.startFrame + localFrame);
}
