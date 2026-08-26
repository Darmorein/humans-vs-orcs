import { SeededRandom } from '../Map/SeededRandom';

/**
 * Match-scoped PRNG. Map generation uses its own seed stream;
 * gameplay randomness (spawns, AI jitter, forge rolls) should go through this.
 */
export class GameRng {
  private readonly rng: SeededRandom;

  constructor(seed: number) {
    this.rng = new SeededRandom(seed >>> 0 || 1);
  }

  next(): number {
    return this.rng.next();
  }

  /** Alias for next() — [0, 1). */
  nextFloat(): number {
    return this.next();
  }

  range(min: number, max: number): number {
    return this.rng.range(min, max);
  }

  int(min: number, maxInclusive: number): number {
    return this.rng.int(min, maxInclusive);
  }

  /** Inclusive integer range (API alias). */
  nextInt(min: number, maxInclusive: number): number {
    return this.int(min, maxInclusive);
  }

  chance(p: number): boolean {
    return this.rng.chance(p);
  }

  pick<T>(arr: T[]): T {
    return this.rng.pick(arr);
  }

  /**
   * Deterministic substream derived from current state + stream name.
   * Does not advance this RNG (forks via hashed seed).
   */
  fork(streamName: string): GameRng {
    let h = this.getState() >>> 0;
    for (let i = 0; i < streamName.length; i++) {
      h ^= streamName.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return new GameRng((h >>> 0) || 1);
  }

  /** Angle in radians [0, TAU). */
  angle(): number {
    return this.next() * Math.PI * 2;
  }

  getState(): number {
    return this.rng.getState();
  }

  setState(state: number) {
    this.rng.setState(state);
  }
}
