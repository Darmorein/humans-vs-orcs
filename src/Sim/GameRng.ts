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

  range(min: number, max: number): number {
    return this.rng.range(min, max);
  }

  int(min: number, maxInclusive: number): number {
    return this.rng.int(min, maxInclusive);
  }

  chance(p: number): boolean {
    return this.rng.chance(p);
  }

  pick<T>(arr: T[]): T {
    return this.rng.pick(arr);
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
