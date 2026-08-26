import type {
  AnimationClipDefinition,
  IsoDirection,
  SpriteSheetDefinition,
} from '../Manifest/Types';
import { clipKey, findClip } from './clipLookup';
import { absoluteFrameIndex, atlasFrameRect, type AtlasSourceRect } from './frameRect';

/** Sample produced by one deterministic `advance` step. */
export interface AnimationSample {
  /** Resolved clip, or null when atlas/clip is unavailable. */
  clip: AnimationClipDefinition | null;
  /** Clip-local frame index (0 .. frameCount-1), or 0 when no clip. */
  localFrame: number;
  /** Absolute sheet frame index, or null when no clip. */
  absoluteFrame: number | null;
  /** Source rectangle for drawing, or null when no clip. */
  sourceRect: AtlasSourceRect | null;
  /** True exactly once when the playhead reaches/crosses `releaseFrame`. */
  releaseEvent: boolean;
  /** True after a non-looping clip has played through its last frame. */
  completed: boolean;
  /** Identity of the active clip, or null. */
  key: string | null;
}

/**
 * Deterministic clip player driven only by caller-supplied `dt`.
 * Never reads wall-clock time and never uses randomness.
 *
 * Timing contract: `localFrame = floor(elapsed * fps)` clamped/wrapped per `loop`.
 * One-shot clips freeze on the last frame and set `completed` once elapsed covers
 * every frame (`elapsed * fps >= frameCount`).
 */
export class AnimationPlayer {
  private state = 'idle';
  private direction: IsoDirection = 'SE';
  private elapsed = 0;
  private releaseEmitted = false;
  private activeKey: string | null = null;

  /** Current gameplay animation state (idle/walk/attack/…). */
  public get animState(): string {
    return this.state;
  }

  /** Current isometric facing used for clip lookup. */
  public get animDirection(): IsoDirection {
    return this.direction;
  }

  /** Seconds advanced inside the active clip (caller-supplied time only). */
  public get elapsedSeconds(): number {
    return this.elapsed;
  }

  /**
   * Select clip by state + direction. Resets playhead when the clip identity changes.
   */
  public setClip(state: string, direction: IsoDirection): void {
    const nextKey = clipKey(state, direction);
    if (nextKey === this.activeKey && this.state === state && this.direction === direction) {
      return;
    }
    this.state = state;
    this.direction = direction;
    this.activeKey = nextKey;
    this.elapsed = 0;
    this.releaseEmitted = false;
  }

  /**
   * Advance by `dt` seconds against the given atlas and return the current sample.
   * When the atlas or clip is missing, returns a null sample (caller should fall back).
   */
  public advance(dt: number, atlas: SpriteSheetDefinition | null | undefined): AnimationSample {
    const safeDt = dt > 0 ? dt : 0;
    const clip = findClip(atlas, this.state, this.direction);
    if (!clip || !atlas) {
      this.activeKey = clipKey(this.state, this.direction);
      return emptySample(this.activeKey);
    }

    this.activeKey = clipKey(clip.state, clip.direction);
    this.elapsed += safeDt;

    const rawFrame = this.elapsed * clip.fps;
    let localFrame: number;
    let completed = false;

    if (clip.loop) {
      const cycle = Math.floor(rawFrame);
      localFrame = ((cycle % clip.frameCount) + clip.frameCount) % clip.frameCount;
    } else {
      if (rawFrame >= clip.frameCount) {
        localFrame = clip.frameCount - 1;
        completed = true;
      } else {
        localFrame = Math.floor(rawFrame);
        completed = false;
      }
    }

    let releaseEvent = false;
    if (
      clip.releaseFrame != null &&
      !this.releaseEmitted &&
      localFrame >= clip.releaseFrame
    ) {
      this.releaseEmitted = true;
      releaseEvent = true;
    }

    const abs = absoluteFrameIndex(clip.startFrame, localFrame);
    return {
      clip,
      localFrame,
      absoluteFrame: abs,
      sourceRect: atlasFrameRect(atlas, abs),
      releaseEvent,
      completed,
      key: this.activeKey,
    };
  }

  /** Force playhead to a specific elapsed time (tests / deterministic scrub). */
  public seek(elapsedSeconds: number): void {
    this.elapsed = Math.max(0, elapsedSeconds);
    this.releaseEmitted = false;
  }
}

function emptySample(key: string | null): AnimationSample {
  return {
    clip: null,
    localFrame: 0,
    absoluteFrame: null,
    sourceRect: null,
    releaseEvent: false,
    completed: false,
    key,
  };
}
