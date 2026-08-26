import type {
  AnimationClipDefinition,
  IsoDirection,
  SpriteSheetDefinition,
} from '../Manifest/Types.ts';
import { atlasFrameRect, findAnimationClip, type AtlasFrameRect } from './Atlas.ts';

export interface AnimationReleaseFrameEvent {
  type: 'release-frame';
  state: string;
  direction: IsoDirection;
  localFrame: number;
}

export type AnimationEvent = AnimationReleaseFrameEvent;

export interface AnimationUpdateResult {
  completed: boolean;
  events: AnimationEvent[];
}

/**
 * Small deterministic clip clock. It owns visual time only and never reads a
 * wall clock, gameplay RNG, timers or camera state.
 */
export class AnimationPlayer {
  private atlas: SpriteSheetDefinition | null = null;
  private clip: AnimationClipDefinition | null = null;
  private state = '';
  private direction: IsoDirection = 'SE';
  private elapsedSeconds = 0;
  private localFrame = 0;
  private highestRawFrame = -1;
  private releaseEmitted = false;
  private completed = false;

  public play(
    atlas: SpriteSheetDefinition | null,
    state: string,
    direction: IsoDirection,
    restart = false,
  ): boolean {
    const clip = findAnimationClip(atlas, state, direction);
    if (!atlas || !clip) {
      this.clear();
      return false;
    }

    const changed =
      this.atlas !== atlas ||
      this.clip !== clip ||
      this.state !== state ||
      this.direction !== direction;
    this.atlas = atlas;
    this.clip = clip;
    this.state = state;
    this.direction = direction;
    if (changed || restart) this.restart();
    return true;
  }

  public restart(): void {
    this.elapsedSeconds = 0;
    this.localFrame = 0;
    this.highestRawFrame = -1;
    this.releaseEmitted = false;
    this.completed = false;
  }

  public clear(): void {
    this.atlas = null;
    this.clip = null;
    this.state = '';
    this.restart();
  }

  public update(deltaSeconds: number): AnimationUpdateResult {
    if (!this.clip) return { completed: false, events: [] };

    const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    this.elapsedSeconds += dt;
    const rawFrame = Math.floor(this.elapsedSeconds * this.clip.fps);
    const events: AnimationEvent[] = [];

    if (
      !this.releaseEmitted &&
      this.clip.releaseFrame != null &&
      this.highestRawFrame < this.clip.releaseFrame &&
      rawFrame >= this.clip.releaseFrame
    ) {
      this.releaseEmitted = true;
      events.push({
        type: 'release-frame',
        state: this.state,
        direction: this.direction,
        localFrame: this.clip.releaseFrame,
      });
    }

    this.highestRawFrame = Math.max(this.highestRawFrame, rawFrame);
    if (this.clip.loop) {
      this.localFrame = rawFrame % this.clip.frameCount;
      this.completed = false;
    } else {
      this.localFrame = Math.min(rawFrame, this.clip.frameCount - 1);
      this.completed = rawFrame >= this.clip.frameCount;
    }

    return { completed: this.completed, events };
  }

  public currentFrameRect(): AtlasFrameRect | null {
    if (!this.atlas || !this.clip) return null;
    return atlasFrameRect(this.atlas, this.clip.startFrame + this.localFrame);
  }

  public isComplete(): boolean {
    return this.completed;
  }

  public currentState(): string | null {
    return this.clip ? this.state : null;
  }

  public currentDirection(): IsoDirection | null {
    return this.clip ? this.direction : null;
  }
}
