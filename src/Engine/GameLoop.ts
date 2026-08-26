import { SIM_TICK_MS } from '../Sim/SimClock';

/**
 * Separates presentation/input (every frame) from fixed simulation ticks.
 * Gameplay advances only on fixed steps — independent of FPS.
 */
export class GameLoop {
  private lastTime = 0;
  private accumulatedTime = 0;
  private readonly fixedDeltaTime = SIM_TICK_MS;
  private isRunning = false;
  private animationFrameId = 0;

  private frameFn: (frameDtSec: number) => void;
  private simFn: (simDtSec: number) => void;
  private renderFn: () => void;

  constructor(
    frameFn: (frameDtSec: number) => void,
    simFn: (simDtSec: number) => void,
    renderFn: () => void,
  ) {
    this.frameFn = frameFn;
    this.simFn = simFn;
    this.renderFn = renderFn;
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    this.animationFrameId = requestAnimationFrame((time) => this.loop(time));
  }

  public stop() {
    this.isRunning = false;
    cancelAnimationFrame(this.animationFrameId);
  }

  private loop(currentTime: number) {
    if (!this.isRunning) return;

    let deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;
    if (deltaTime > 250) deltaTime = 250;

    this.frameFn(deltaTime / 1000);

    this.accumulatedTime += deltaTime;
    while (this.accumulatedTime >= this.fixedDeltaTime) {
      this.simFn(this.fixedDeltaTime / 1000);
      this.accumulatedTime -= this.fixedDeltaTime;
    }

    this.renderFn();
    this.animationFrameId = requestAnimationFrame((time) => this.loop(time));
  }
}
