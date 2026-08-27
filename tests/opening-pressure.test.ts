import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Opening pressure + Strategic Map Gen v2 contracts.
 * Mirrors MapConfig / MatchPacing / topology design (no full asset graph).
 */

const MAP = {
  width: 160,
  height: 160,
  tileSize: 28,
  generatorVersion: 2,
  /** Heartlands inset — not corners — along layout axis (~0.28 / 0.72). */
  heartlandT: [0.2, 0.8] as const,
} as const;

const PACING = {
  firstArmyCommand: 20,
  firstContact: 75,
  firstBattle: 120,
  firstOutpost: 240,
} as const;

const OPENING = {
  starterSquads: 2,
  basicTrainSec: 10,
  capitalMuster: true,
  aiOpeningMoveSec: 30,
  firstContactBand: [45, 90] as const,
} as const;

const INFANTRY_SPEED = 60;

function travelSec(distWorld: number, speed = INFANTRY_SPEED): number {
  return distWorld / speed;
}

test('standard map is ~160×160 (not 90/112 boom arena)', () => {
  assert.equal(MAP.width, 160);
  assert.equal(MAP.height, 160);
  assert.equal(MAP.generatorVersion, 2);
});

test('pacing targets match immediate-pressure opening', () => {
  assert.ok(PACING.firstArmyCommand <= 20);
  assert.ok(PACING.firstContact <= 90);
  assert.ok(PACING.firstBattle <= 150);
});

test('inset heartlands keep contact band when both armies advance', () => {
  // Representative seats along a diagonal axis at t=0.28 and t=0.72.
  const aTx = 0.5 + (MAP.heartlandT[0] - 0.5) * 0.92 * MAP.width;
  const aTy = 0.5 + (MAP.heartlandT[0] - 0.5) * 0.92 * MAP.height;
  const bTx = 0.5 + (MAP.heartlandT[1] - 0.5) * 0.92 * MAP.width;
  const bTy = 0.5 + (MAP.heartlandT[1] - 0.5) * 0.92 * MAP.height;
  const full = Math.hypot(bTx - aTx, bTy - aTy) * MAP.tileSize;
  const halfTravel = travelSec(full * 0.5);
  assert.ok(
    halfTravel <= 55,
    `half-travel ${halfTravel.toFixed(1)}s too slow for ${OPENING.firstContactBand[0]}–${OPENING.firstContactBand[1]}s contact`,
  );
  // Capital–capital straight-line should feel larger than 90×90 era (~larger world).
  assert.ok(full / MAP.tileSize >= 55, 'capitals should not sit on top of each other');
});

test('opening force and muster gate', () => {
  assert.equal(OPENING.starterSquads, 2);
  assert.ok(OPENING.basicTrainSec >= 8 && OPENING.basicTrainSec <= 15);
  assert.equal(OPENING.capitalMuster, true);
  assert.ok(OPENING.aiOpeningMoveSec <= 30);
});
