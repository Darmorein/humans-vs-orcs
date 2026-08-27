import type { StrategicSituation, StrategicState } from './Types';

export interface StateChoice {
  state: StrategicState;
  /** Short reason for diagnostics / HUD. */
  reason: string;
}

interface ScoredState {
  state: StrategicState;
  score: number;
  reason: string;
}

/**
 * Pick strategic posture from situation + doctrine weights.
 * Interrupt states (Defend / Recover) win unless scores are negligible.
 */
export function chooseStrategicState(
  sit: StrategicSituation,
  previous: StrategicState,
  secondsInState: number,
): StateChoice {
  const scored: ScoredState[] = [
    scoreDefend(sit),
    scoreRecover(sit),
    scoreFortify(sit),
    scoreExpand(sit),
    scoreAttack(sit),
    scoreRaid(sit),
    scoreDevelop(sit),
  ];

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const current = scored.find((s) => s.state === previous);

  // Hysteresis: stay put unless a clear better option (or interrupt).
  const interrupt = best.state === 'defend' || best.state === 'recover';
  if (
    current &&
    !interrupt &&
    best.state !== previous &&
    best.score < current.score + (secondsInState < 8 ? 18 : 10)
  ) {
    return { state: previous, reason: current.reason };
  }

  if (interrupt && best.score >= 28) {
    return { state: best.state, reason: best.reason };
  }

  return { state: best.state, reason: best.reason };
}

function scoreDefend(sit: StrategicSituation): ScoredState {
  let score = 0;
  if (sit.threatNearBase >= 1) score += 35 + sit.threatNearBase * 12;
  if (sit.mainHpRatio < 0.55) score += 40;
  if (sit.mainHpRatio < 0.35) score += 25;
  if (sit.safety < 0.4 && sit.threatNearBase > 0) score += 20;
  if (sit.primaryBridgeContested && sit.bridgeEnemyPresence > sit.bridgeFriendlyPresence + 1) {
    score += 18;
  }
  return {
    state: 'defend',
    score,
    reason: sit.threatNearBase > 0 ? 'threats near base' : 'main under fire',
  };
}

function scoreRecover(sit: StrategicSituation): ScoredState {
  let score = 0;
  if (sit.armyRatio < 0.45 && sit.enemyArmyCount >= 3) score += 32;
  if (sit.armyCount <= 1 && sit.enemyArmyCount >= 4) score += 28;
  if (sit.workerCount < 3) score += 22;
  if (sit.prosperity < 0.28 && sit.food < 20) score += 18;
  if (sit.mainHpRatio < 0.7 && sit.armyRatio < 0.7) score += 10;
  // Don't recover while actively raided harder than we can ignore
  if (sit.threatNearBase >= 3) score *= 0.35;
  return {
    state: 'recover',
    score,
    reason: 'rebuild economy / army',
  };
}

function scoreFortify(sit: StrategicSituation): ScoredState {
  let score = 0;
  if (sit.territoryContestedShare > 0.18) score += 22 * sit.doctrineDefense;
  if (sit.primaryBridgeContested) score += 20 * sit.doctrineDefense;
  if (sit.defensibleScore >= 10 && sit.bridgeFriendlyPresence < 2) score += 16;
  if (sit.safety < 0.55 && sit.threatNearBase === 0) score += 14 * sit.doctrineDefense;
  if (sit.hasProduction && sit.armyCount >= 3 && sit.doctrineDefense >= 1.1) score += 12;
  if (sit.doctrineDefense < 0.9) score *= 0.55;
  return {
    state: 'fortify',
    score,
    reason: 'secure bridges / territory',
  };
}

function scoreExpand(sit: StrategicSituation): ScoredState {
  let score = 0;
  if (!sit.canExpand) return { state: 'expand', score: 0, reason: 'cannot settle yet' };
  score += sit.expansionCrowding * 40 * sit.doctrineExpansion;
  if (sit.settlementCount < 2) score += 18 * sit.doctrineExpansion;
  if (sit.settlementCount < 3 && sit.doctrineExpansion > 1.1) score += 14;
  if (sit.housingPressure > 0.5) score += 16;
  if (sit.threatNearBase > 0) score *= 0.2;
  if (sit.armyRatio < 0.55) score *= 0.65;
  if (sit.workerCount < 4) score *= 0.5;
  return {
    state: 'expand',
    score,
    reason: 'new settlement opportunity',
  };
}

function scoreAttack(sit: StrategicSituation): ScoredState {
  let score = 0;
  if (!sit.hasProduction) return { state: 'attack', score: 0, reason: 'no muster' };
  // Accept near-parity fights early (4v4 / 6v5), not only crushing superiority.
  if (sit.armyCount >= 4 && sit.armyRatio >= 0.75) score += 26;
  if (sit.armyCount >= 6 && sit.armyRatio >= 0.9) score += 20;
  if (sit.armyCount >= 8 && sit.armyRatio >= 0.95) score += 14;
  if (sit.gold >= 60 && sit.prosperity > 0.3) score += 10;
  if (sit.territoryOwnShare > 0.45) score += 8;
  if (sit.doctrineHarass > 0.6 && sit.armyRatio >= 0.85) score += 8;
  if (sit.threatNearBase > 0) score *= 0.15;
  if (sit.armyRatio < 0.55) score *= 0.4;
  if (sit.workerCount < 4) score *= 0.85;
  return {
    state: 'attack',
    score,
    reason: 'army advantage',
  };
}

function scoreRaid(sit: StrategicSituation): ScoredState {
  let score = 0;
  if (!sit.hasProduction) return { state: 'raid', score: 0, reason: 'no muster' };
  if (sit.armyCount >= 4 && sit.armyRatio >= 0.55) {
    score += 28 + sit.doctrineHarass * 28;
  }
  if (sit.nearbyMineCount >= 1 && sit.enemyArmyCount >= 2) score += 10;
  if (sit.primaryBridgeContested === false && sit.armyCount >= 4) score += 14;
  if (sit.armyRatio >= 1.4) score *= 0.55; // prefer Attack when crushing
  if (sit.threatNearBase > 0) score *= 0.2;
  if (sit.armyCount < 4) score *= 0.35;
  return {
    state: 'raid',
    score,
    reason: 'contest frontier',
  };
}

function scoreDevelop(sit: StrategicSituation): ScoredState {
  let score = 14; // lower default so raid/attack can win with starter armies
  if (sit.topNeed) score += 16;
  if (sit.workerCount < 5) score += 18;
  if (!sit.hasProduction && sit.workerCount >= 3) score += 14;
  if (sit.housingPressure > 0.3) score += 12;
  if (sit.food < 25) score += 14;
  if (sit.unfinishedBuilds > 0) score += 10;
  if (sit.doctrineCraft >= 1.2 && sit.craftsmanship < 0.45) score += 12;
  if (sit.prosperity < 0.4) score += 10;
  if (sit.resourcePressure > 0.8) score += 8;
  // Soft preference only when army is thin
  if (sit.armyCount < 4) score += 8;
  return {
    state: 'develop',
    score,
    reason: sit.topNeed ? `need ${sit.topNeed}` : 'grow settlement',
  };
}
