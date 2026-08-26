import type { IsoDirection } from '../Manifest/Types.ts';

const FACING_EPSILON_SQUARED = 1e-8;

/**
 * Map a cartesian world-space facing vector to one of the four authored
 * isometric directions. World axes become screen diagonals after projection:
 * +X → SE, +Y → SW, -X → NW, -Y → NE.
 *
 * The dominant world axis wins. Exact diagonal boundaries belong to the X
 * axis, which makes ties deterministic on every client. A near-zero vector
 * preserves the last valid direction.
 */
export function worldFacingToIsoDirection(
  facingX: number,
  facingY: number,
  previous: IsoDirection,
): IsoDirection {
  if (facingX * facingX + facingY * facingY <= FACING_EPSILON_SQUARED) {
    return previous;
  }

  if (Math.abs(facingX) >= Math.abs(facingY)) {
    return facingX >= 0 ? 'SE' : 'NW';
  }
  return facingY >= 0 ? 'SW' : 'NE';
}
