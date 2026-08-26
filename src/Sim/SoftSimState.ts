/**
 * Soft timers / controller phase that affect mid-game resume but aren't
 * first-class entities. Serialized so save→load→continue can match.
 */
export interface SoftSimState {
  populationAccum: number;
  heroElapsed: number;
  heroEvalTimer: number;
  artifactElapsed: number;
  artifactForgeTimer: number;
  artifactForgeCooldowns: Array<{ settlementId: string; remaining: number }>;
  historyElapsed: number;
  historyTerritoryTimer: number;
  influenceAccum: number;
  ai: AiSoftState[];
}

export interface AiSoftState {
  playerId: string;
  state: string;
  stateReason: string;
  secondsInState: number;
  elapsed: number;
  thinkTimer: number;
  actionTimer: number;
  nextActionIn: number;
  expansionCooldown: number;
  guardIds: number[];
  assaultIds: number[];
  harassIds: number[];
  pendingTargetId: Array<{ unitId: number; targetId: number }>;
  assaultStartCount: number;
}

export function emptySoftSimState(): SoftSimState {
  return {
    populationAccum: 0,
    heroElapsed: 0,
    heroEvalTimer: 0,
    artifactElapsed: 0,
    artifactForgeTimer: 0,
    artifactForgeCooldowns: [],
    historyElapsed: 0,
    historyTerritoryTimer: 0,
    influenceAccum: 0,
    ai: [],
  };
}
