import type { AtlasFrameRect } from './Atlas.ts';

export function drawAtlasFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  source: AtlasFrameRect,
  screenX: number,
  screenY: number,
  scale: number,
  options?: { pivotY?: number; pivotX?: number; alpha?: number },
): void {
  const width = source.width * scale;
  const height = source.height * scale;
  const pivotX = options?.pivotX ?? 0.5;
  const pivotY = options?.pivotY ?? 0.9;
  const alpha = options?.alpha ?? 1;

  if (alpha < 1) ctx.globalAlpha = alpha;
  ctx.drawImage(
    img,
    source.x,
    source.y,
    source.width,
    source.height,
    screenX - width * pivotX,
    screenY - height * pivotY,
    width,
    height,
  );
  if (alpha < 1) ctx.globalAlpha = 1;
}
