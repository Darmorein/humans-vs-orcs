import type { IsoDirection } from '../Manifest/Types';

/**
 * Map a world-space facing vector to one of four isometric directions.
 *
 * World XY is cartesian; the screen projection is classic 2:1 iso:
 * `sx = fx - fy`, `sy = fx + fy` (sy proportional to screen Y).
 *
 * Quadrant rules (axis ties prefer clockwise NE → SE → SW → NW):
 * - `sx > 0 && sy <= 0` → NE
 * - `sx >= 0 && sy > 0` → SE
 * - `sx < 0 && sy >= 0` → SW
 * - `sx <= 0 && sy < 0` → NW
 *
 * Zero vector defaults to `SE`. Axis-aligned examples:
 * `(1,0)→SE`, `(0,1)→SW`, `(-1,0)→NW`, `(0,-1)→NE`.
 */
export function facingToIsoDirection(facingX: number, facingY: number): IsoDirection {
  const sx = facingX - facingY;
  const sy = facingX + facingY;
  if (sx === 0 && sy === 0) return 'SE';
  if (sx > 0 && sy <= 0) return 'NE';
  if (sx >= 0 && sy > 0) return 'SE';
  if (sx < 0 && sy >= 0) return 'SW';
  return 'NW';
}
