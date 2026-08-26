import type { PlayerState } from './MatchState';
import type { FactionId } from './Types';

/**
 * Semantic defeat tracking: player seat + faction look, not hardcoded base names.
 * Current rule: loss of designated capital / main settlement building.
 */
export interface FactionDefeatState {
  playerId: string;
  factionId: FactionId;
  defeated: boolean;
  /** Present when capital/main is gone or surrender applied. */
  reason: 'capital_destroyed' | 'surrender' | null;
}

/** Owners that still have a living main building (TownHall / OrcStronghold). */
export function applyCapitalDefeatFlags(
  players: readonly PlayerState[],
  aliveMainOwnerIds: ReadonlySet<string>,
): FactionDefeatState[] {
  const out: FactionDefeatState[] = [];
  for (const player of players) {
    const capitalAlive = aliveMainOwnerIds.has(player.id);
    if (!capitalAlive) {
      player.isDefeated = true;
    }
    out.push({
      playerId: player.id,
      factionId: player.factionId,
      defeated: player.isDefeated,
      reason: player.isDefeated
        ? capitalAlive
          ? 'surrender'
          : 'capital_destroyed'
        : null,
    });
  }
  return out;
}

/** Local viewer outcome from seat defeat flags (not faction look). */
export function resolveLocalMatchOutcome(
  local: PlayerState,
  opponents: readonly PlayerState[],
): 'playing' | 'victory' | 'defeat' {
  if (local.isDefeated) return 'defeat';
  if (opponents.every((p) => p.isDefeated)) return 'victory';
  return 'playing';
}
