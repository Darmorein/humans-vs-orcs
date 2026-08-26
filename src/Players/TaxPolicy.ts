/**
 * Faction-level tax policy — takes a share of settlement taxable surplus
 * into the Faction Treasury (player.gold). Config-driven rates.
 */

export type TaxPolicy = 'low' | 'normal' | 'high' | 'war';

export const TAX_POLICIES: readonly TaxPolicy[] = ['low', 'normal', 'high', 'war'];

export interface TaxPolicyDef {
  id: TaxPolicy;
  label: string;
  /** Fraction of taxable surplus transferred to treasury (0..1). */
  rate: number;
  /** Soft multipliers applied in deriveCivicStats / migration. */
  prosperityBias: number;
  migrationBias: number;
  /** Autonomous build cooldown / need dampening (>1 = slower civic growth). */
  developmentPenalty: number;
  /** Extra warShock pressure per tax tick under this policy. */
  warShockAdd: number;
  blurb: string;
}

/** Tuning table — change rates here, not in tick logic. */
export const TAX_POLICY_DEFS: Record<TaxPolicy, TaxPolicyDef> = {
  low: {
    id: 'low',
    label: 'Low',
    rate: 0.15,
    prosperityBias: 1.08,
    migrationBias: 1.1,
    developmentPenalty: 0.85,
    warShockAdd: 0,
    blurb: 'Local growth ↑ · Treasury ↓',
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    rate: 0.3,
    prosperityBias: 1,
    migrationBias: 1,
    developmentPenalty: 1,
    warShockAdd: 0,
    blurb: 'Balanced',
  },
  high: {
    id: 'high',
    label: 'High',
    rate: 0.45,
    prosperityBias: 0.92,
    migrationBias: 0.88,
    developmentPenalty: 1.2,
    warShockAdd: 0.002,
    blurb: 'Treasury ↑ · Growth ↓',
  },
  war: {
    id: 'war',
    label: 'War',
    rate: 0.6,
    prosperityBias: 0.78,
    migrationBias: 0.65,
    developmentPenalty: 1.45,
    warShockAdd: 0.012,
    blurb: 'Max military funding · strong local penalties',
  },
};

/** Sim ticks between tax policy changes (≈30s at 20Hz fixed step). */
export const TAX_POLICY_COOLDOWN_TICKS = 600;

export function taxPolicyLabel(p: TaxPolicy): string {
  return TAX_POLICY_DEFS[p].label;
}

export function isTaxPolicy(v: string): v is TaxPolicy {
  return (TAX_POLICIES as readonly string[]).includes(v);
}
