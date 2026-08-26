import type { SquadFormation } from './FormationDefs.ts';
import { FORMATION_DEFS } from './FormationDefs.ts';

/** World-space offsets for formation slots (local +Y = forward). */
export function formationOffsets(
  formation: SquadFormation,
  count: number,
  baseSpacing = 46,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (count <= 0) return out;

  const spacing = baseSpacing * FORMATION_DEFS[formation].spacingMul;

  switch (formation) {
    case 'line': {
      // Neutral single rank facing forward
      const start = -((count - 1) * spacing) / 2;
      for (let i = 0; i < count; i++) {
        out.push({ x: start + i * spacing, y: 0 });
      }
      break;
    }
    case 'shieldWall': {
      // Tight double-ish line — dense frontal wall
      const front = Math.ceil(count * 0.65);
      const back = count - front;
      const startF = -((front - 1) * spacing) / 2;
      for (let i = 0; i < front; i++) {
        out.push({ x: startF + i * spacing, y: 0 });
      }
      if (back > 0) {
        const startB = -((back - 1) * spacing) / 2;
        for (let i = 0; i < back; i++) {
          out.push({ x: startB + i * spacing, y: spacing * 0.75 });
        }
      }
      break;
    }
    case 'loose': {
      // Wide grid — spacing already inflated via spacingMul
      const cols = Math.ceil(Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        out.push({
          x: (c - (cols - 1) / 2) * spacing,
          y: (r - (cols - 1) / 2) * spacing,
        });
      }
      break;
    }
    case 'charge': {
      // Arrow / wedge — leader at tip for first contact
      out.push({ x: 0, y: 0 });
      let placed = 1;
      let rank = 1;
      while (placed < count) {
        const inRank = Math.min(rank + 1, count - placed);
        const start = -((inRank - 1) * spacing) / 2;
        for (let i = 0; i < inRank; i++) {
          out.push({ x: start + i * spacing, y: rank * spacing * 0.9 });
          placed++;
        }
        rank++;
      }
      break;
    }
    case 'holdGround': {
      // Compact square — defensive footprint
      const cols = Math.ceil(Math.sqrt(count));
      for (let i = 0; i < count; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        out.push({
          x: (c - (cols - 1) / 2) * spacing,
          y: (r - (cols - 1) / 2) * spacing,
        });
      }
      break;
    }
  }
  return out;
}

/** Rotate local formation offsets so +Y faces toward (dx, dy). */
export function orientOffsets(
  offsets: { x: number; y: number }[],
  dx: number,
  dy: number,
): { x: number; y: number }[] {
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return offsets;
  const fx = dx / len;
  const fy = dy / len;
  const rx = fy;
  const ry = -fx;
  return offsets.map((o) => ({
    x: o.x * rx + o.y * fx,
    y: o.x * ry + o.y * fy,
  }));
}
