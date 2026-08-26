import { SeededRandom } from './SeededRandom';

/** Seeded value-noise + fBm for natural elevation / biomes. */
export class Noise2D {
  private perm: number[];

  constructor(rng: SeededRandom) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    this.perm = p.concat(p);
  }

  /** Returns 0..1 */
  noise(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const n00 = this.hash(x0, y0);
    const n10 = this.hash(x0 + 1, y0);
    const n01 = this.hash(x0, y0 + 1);
    const n11 = this.hash(x0 + 1, y0 + 1);

    const ix0 = n00 + (n10 - n00) * sx;
    const ix1 = n01 + (n11 - n01) * sx;
    return ix0 + (ix1 - ix0) * sy;
  }

  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let value = 0;
    let amp = 1;
    let freq = 1;
    let max = 0;
    for (let i = 0; i < octaves; i++) {
      value += this.noise(x * freq, y * freq) * amp;
      max += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return value / max;
  }

  private hash(x: number, y: number): number {
    const xi = ((x % 256) + 256) % 256;
    const yi = ((y % 256) + 256) % 256;
    return this.perm[this.perm[xi] + yi] / 255;
  }
}
