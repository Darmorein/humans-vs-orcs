import assert from 'node:assert/strict';
import test from 'node:test';
import { AnimationPlayer } from '../src/Assets/Animation/AnimationPlayer.ts';
import { atlasFrameRect, clipFrameRect, findAnimationClip } from '../src/Assets/Animation/Atlas.ts';
import { createMissingClipReporter } from '../src/Assets/Animation/Diagnostics.ts';
import { worldFacingToIsoDirection } from '../src/Assets/Animation/Direction.ts';
import { resolveUnitVisualState } from '../src/Assets/Animation/UnitVisualState.ts';
import type { SpriteSheetDefinition } from '../src/Assets/Manifest/Types.ts';

const atlas: SpriteSheetDefinition = {
  frameWidth: 32,
  frameHeight: 48,
  columns: 4,
  rows: 4,
  margin: 2,
  spacing: 2,
  clips: [
    { state: 'idle', direction: 'NE', startFrame: 0, frameCount: 4, fps: 4, loop: true },
    {
      state: 'attack',
      direction: 'SE',
      startFrame: 4,
      frameCount: 4,
      fps: 4,
      loop: false,
      releaseFrame: 2,
    },
    { state: 'idle', direction: 'SE', startFrame: 8, frameCount: 1, fps: 2, loop: true },
    { state: 'idle', direction: 'SW', startFrame: 9, frameCount: 1, fps: 2, loop: true },
    { state: 'idle', direction: 'NW', startFrame: 10, frameCount: 1, fps: 2, loop: true },
  ],
};

test('clip lookup uses state and direction', () => {
  assert.equal(findAnimationClip(atlas, 'attack', 'SE')?.startFrame, 4);
  assert.equal(findAnimationClip(atlas, 'attack', 'NE'), null);
  assert.equal(findAnimationClip(null, 'idle', 'SE'), null);
});

test('atlas frame rectangle uses margin, spacing, columns and frame dimensions', () => {
  assert.deepEqual(atlasFrameRect(atlas, 5), {
    x: 36,
    y: 52,
    width: 32,
    height: 48,
    frameIndex: 5,
  });
  assert.equal(atlasFrameRect(atlas, 16), null);
});

test('looping clips advance deterministically and wrap after a large delta', () => {
  const player = new AnimationPlayer();
  assert.equal(player.play(atlas, 'idle', 'NE'), true);
  player.update(1.25);
  assert.equal(player.currentFrameRect()?.frameIndex, 1);
  assert.equal(player.isComplete(), false);
  player.update(10);
  assert.equal(player.currentFrameRect()?.frameIndex, 1);
});

test('a synthetic atlas can select every authored direction', () => {
  const player = new AnimationPlayer();
  for (const direction of ['NE', 'SE', 'SW', 'NW'] as const) {
    assert.equal(player.play(atlas, 'idle', direction), true);
    assert.equal(player.currentDirection(), direction);
    assert.notEqual(player.currentFrameRect(), null);
  }
});

test('one-shot clips hold the last frame and report completion', () => {
  const player = new AnimationPlayer();
  player.play(atlas, 'attack', 'SE');
  assert.equal(player.update(0.75).completed, false);
  assert.equal(player.currentFrameRect()?.frameIndex, 7);
  assert.equal(player.update(0.25).completed, true);
  assert.equal(player.currentFrameRect()?.frameIndex, 7);
});

test('release frame emits exactly once even when a large delta crosses frames', () => {
  const player = new AnimationPlayer();
  player.play(atlas, 'attack', 'SE');
  const crossed = player.update(0.8);
  assert.deepEqual(crossed.events, [
    { type: 'release-frame', state: 'attack', direction: 'SE', localFrame: 2 },
  ]);
  assert.deepEqual(player.update(3).events, []);
});

test('the same attack can emit again after an explicit restart', () => {
  const player = new AnimationPlayer();
  player.play(atlas, 'attack', 'SE');
  assert.equal(player.update(0.5).events.length, 1);
  player.play(atlas, 'attack', 'SE', true);
  assert.equal(player.update(0.5).events.length, 1);
});

test('world facing maps axes, quadrants, boundaries and zero vectors', () => {
  assert.equal(worldFacingToIsoDirection(1, 0, 'NE'), 'SE');
  assert.equal(worldFacingToIsoDirection(0, 1, 'NE'), 'SW');
  assert.equal(worldFacingToIsoDirection(-1, 0, 'SE'), 'NW');
  assert.equal(worldFacingToIsoDirection(0, -1, 'SE'), 'NE');
  assert.equal(worldFacingToIsoDirection(3, 2, 'NE'), 'SE');
  assert.equal(worldFacingToIsoDirection(-2, 3, 'NE'), 'SW');
  assert.equal(worldFacingToIsoDirection(-3, -2, 'SE'), 'NW');
  assert.equal(worldFacingToIsoDirection(2, -3, 'SE'), 'NE');
  assert.equal(worldFacingToIsoDirection(1, 1, 'NE'), 'SE');
  assert.equal(worldFacingToIsoDirection(-1, 1, 'SE'), 'NW');
  assert.equal(worldFacingToIsoDirection(0, 0, 'SW'), 'SW');
  assert.equal(worldFacingToIsoDirection(0.00001, 0, 'NW'), 'NW');
});

test('atlas and missing-clip paths fall back cleanly', () => {
  assert.equal(clipFrameRect(null, 'idle', 'SE', 0), null);
  assert.equal(clipFrameRect(atlas, 'walk', 'SE', 0), null);
  assert.equal(clipFrameRect(atlas, 'idle', 'SE', 0)?.frameIndex, 8);
});

test('missing-clip diagnostics are development-only and unique', () => {
  const warnings: string[] = [];
  const report = createMissingClipReporter(true, (message) => warnings.push(message));
  report('human/archer', 'attack', 'NE');
  report('human/archer', 'attack', 'NE');
  report('human/archer', 'attack', 'SE');
  assert.equal(warnings.length, 2);

  const disabled = createMissingClipReporter(false, (message) => warnings.push(message));
  disabled('human/archer', 'attack', 'SW');
  assert.equal(warnings.length, 2);
});

test('unit visual-state adapter preserves gameplay priority', () => {
  assert.equal(
    resolveUnitVisualState({ isDead: true, wasHit: true, isAttacking: true, isMoving: true }),
    'death',
  );
  assert.equal(
    resolveUnitVisualState({ isDead: false, wasHit: true, isAttacking: true, isMoving: true }),
    'hit',
  );
  assert.equal(
    resolveUnitVisualState({ isDead: false, wasHit: false, isAttacking: true, isMoving: true }),
    'attack',
  );
  assert.equal(
    resolveUnitVisualState({ isDead: false, wasHit: false, isAttacking: false, isMoving: true }),
    'walk',
  );
  assert.equal(
    resolveUnitVisualState({ isDead: false, wasHit: false, isAttacking: false, isMoving: false }),
    'idle',
  );
});
