import type { AssetKey } from './AssetPaths';
import { assetManifest } from './Manifest/Registry';
import { ASSET_MANIFEST_V2 } from './Manifest/entries';
import type { AssetEntry } from './Manifest/Types';

class AssetManager {
  private images = new Map<string, HTMLImageElement>();
  private failed = new Set<string>();
  public loaded = false;

  /**
   * Validate Manifest v2, register metadata, then load images listed in the manifest.
   * Does not alter graphic files — only reads them.
   */
  public async load(): Promise<void> {
    assetManifest.load(ASSET_MANIFEST_V2);

    const entries = assetManifest.all();
    await Promise.all(entries.map((entry) => this.loadImage(entry)));

    this.loaded = true;
  }

  private loadImage(entry: AssetEntry): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.images.set(entry.id, img);
        entry.sourceWidth = img.naturalWidth || img.width;
        entry.sourceHeight = img.naturalHeight || img.height;
        resolve();
      };
      img.onerror = () => {
        this.failed.add(entry.id);
        console.warn('Failed to load asset', entry.id, entry.src);
        resolve();
      };
      img.src = entry.src;
    });
  }

  public get(key: AssetKey | string): HTMLImageElement | null {
    return this.images.get(key) ?? null;
  }

  public has(key: AssetKey | string): boolean {
    return this.images.has(key);
  }

  /** Resolved Manifest v2 metadata for an asset id. */
  public getMeta(key: AssetKey | string): AssetEntry | undefined {
    return assetManifest.get(key);
  }

  public failedKeys(): string[] {
    return [...this.failed];
  }
}

export const assets = new AssetManager();

export interface DrawSpriteOptions {
  pivotY?: number;
  pivotX?: number;
  alpha?: number;
  /**
   * Atlas frame rectangle in source image pixels.
   * When omitted, draws the full image (static prototype path).
   * Rectangles must come from Manifest v2 `AssetEntry.atlas` via `atlasFrameRect`.
   */
  sourceRect?: { x: number; y: number; w: number; h: number };
}

/**
 * Draw sprite using manifest pivot when options omit pivot.
 * Static path (`sourceRect` omitted) is unchanged for prototype PNGs.
 * Atlas path draws a single frame from `sourceRect` at the same pivot/scale contract.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  screenX: number,
  screenY: number,
  scale: number,
  options?: DrawSpriteOptions,
) {
  const pivotX = options?.pivotX ?? 0.5;
  const pivotY = options?.pivotY ?? 0.9;
  const alpha = options?.alpha ?? 1;
  const rect = options?.sourceRect;

  const w = (rect ? rect.w : img.width) * scale;
  const h = (rect ? rect.h : img.height) * scale;
  const dx = screenX - w * pivotX;
  const dy = screenY - h * pivotY;

  if (alpha < 1) ctx.globalAlpha = alpha;
  if (rect) {
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, dx, dy, w, h);
  } else {
    ctx.drawImage(img, dx, dy, w, h);
  }
  if (alpha < 1) ctx.globalAlpha = 1;
}

/** Draw terrain tile centered on iso tile center (uses manifest pivotY when provided). */
export function drawTileSprite(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  screenX: number,
  screenY: number,
  targetWidth: number,
  pivotY = 0.55,
) {
  const scale = targetWidth / img.width;
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, screenX - w / 2, screenY - h * pivotY, w, h);
}
