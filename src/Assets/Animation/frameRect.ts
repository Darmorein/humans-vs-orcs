import type { SpriteSheetDefinition } from '../Manifest/Types';

/** Pixel rectangle inside a sprite sheet for a zero-based absolute frame index. */
export interface AtlasSourceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Resolve the source rectangle for an absolute sheet frame index.
 * Geometry comes exclusively from `SpriteSheetDefinition` (margin/spacing/frame size).
 */
export function atlasFrameRect(
  atlas: SpriteSheetDefinition,
  absoluteFrameIndex: number,
): AtlasSourceRect {
  const col = absoluteFrameIndex % atlas.columns;
  const row = Math.floor(absoluteFrameIndex / atlas.columns);
  return {
    x: atlas.margin + col * (atlas.frameWidth + atlas.spacing),
    y: atlas.margin + row * (atlas.frameHeight + atlas.spacing),
    w: atlas.frameWidth,
    h: atlas.frameHeight,
  };
}

/**
 * Absolute frame index for a clip-local frame (0 .. frameCount-1).
 */
export function absoluteFrameIndex(
  startFrame: number,
  localFrame: number,
): number {
  return startFrame + localFrame;
}
