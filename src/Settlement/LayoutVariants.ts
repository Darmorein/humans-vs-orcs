/**
 * Organic settlement layout variants — each town picks one so cities differ.
 */

export type SettlementLayoutId =
  | 'radial'
  | 'crescent'
  | 'roadSpine'
  | 'clustered'
  | 'scatter';

export interface SettlementLayoutProfile {
  id: SettlementLayoutId;
  /** Preferred wedge of the circle (radians); full circle if span >= TAU. */
  arcCenter: number;
  arcSpan: number;
  /** How strongly to hug roads (0..1). */
  roadBias: number;
  /** Houses pack tighter when high. */
  houseClustering: number;
  /** Farms pushed outward when high. */
  farmOutward: number;
  /** Extra angular jitter. */
  angleJitter: number;
  /** Radial noise scale. */
  radiusJitter: number;
}

export const SETTLEMENT_LAYOUTS: Record<SettlementLayoutId, SettlementLayoutProfile> = {
  radial: {
    id: 'radial',
    arcCenter: 0,
    arcSpan: Math.PI * 2,
    roadBias: 0.35,
    houseClustering: 0.35,
    farmOutward: 0.55,
    angleJitter: 0.35,
    radiusJitter: 0.22,
  },
  crescent: {
    id: 'crescent',
    arcCenter: -0.4,
    arcSpan: Math.PI * 1.15,
    roadBias: 0.4,
    houseClustering: 0.5,
    farmOutward: 0.65,
    angleJitter: 0.28,
    radiusJitter: 0.2,
  },
  roadSpine: {
    id: 'roadSpine',
    arcCenter: 0.2,
    arcSpan: Math.PI * 2,
    roadBias: 0.92,
    houseClustering: 0.45,
    farmOutward: 0.4,
    angleJitter: 0.45,
    radiusJitter: 0.3,
  },
  clustered: {
    id: 'clustered',
    arcCenter: 0.8,
    arcSpan: Math.PI * 1.4,
    roadBias: 0.3,
    houseClustering: 0.9,
    farmOutward: 0.85,
    angleJitter: 0.5,
    radiusJitter: 0.18,
  },
  scatter: {
    id: 'scatter',
    arcCenter: 1.1,
    arcSpan: Math.PI * 2,
    roadBias: 0.25,
    houseClustering: 0.2,
    farmOutward: 0.5,
    angleJitter: 0.85,
    radiusJitter: 0.45,
  },
};

const LAYOUT_ORDER: SettlementLayoutId[] = [
  'radial',
  'crescent',
  'roadSpine',
  'clustered',
  'scatter',
];

/** Deterministic layout pick from settlement / player id. */
export function pickLayoutForId(id: string): SettlementLayoutProfile {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const layoutId = LAYOUT_ORDER[Math.abs(h) % LAYOUT_ORDER.length]!;
  return rotateLayout(SETTLEMENT_LAYOUTS[layoutId]!, h);
}

/**
 * Faction-biased layout: Humans favor ordered spines; Orcs favor scatter/clusters.
 */
export function pickLayoutForFaction(
  id: string,
  preferred: SettlementLayoutId[],
): SettlementLayoutProfile {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const pool = preferred.length > 0 ? preferred : LAYOUT_ORDER;
  const layoutId = pool[Math.abs(h) % pool.length]!;
  return rotateLayout(SETTLEMENT_LAYOUTS[layoutId]!, h);
}

function rotateLayout(base: SettlementLayoutProfile, h: number): SettlementLayoutProfile {
  const rot = ((h >>> 8) % 360) * (Math.PI / 180);
  return {
    ...base,
    arcCenter: base.arcCenter + rot,
  };
}
