/**
 * Focused Art Kit v1.1 animation runtime checks.
 * Loaded via Vite SSR from `scripts/test-animation-runtime.mjs`.
 */

import {
  AnimationPlayer,
  atlasFrameRect,
  clipKey,
  facingToIsoDirection,
  findClip,
  resolveUnitVisualPose,
} from './index';
import type { AnimationClipDefinition, SpriteSheetDefinition } from '../Manifest/Types';

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

function assert(name: string, condition: boolean, detail?: string): CheckResult {
  return { name, ok: condition, detail: condition ? undefined : detail ?? 'failed' };
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Synthetic 4-direction sheet: idle(1) + walk(2) + attack(4, one-shot, release) per direction. */
export function makeSyntheticAtlas(): SpriteSheetDefinition {
  const clips: AnimationClipDefinition[] = [];
  const directions = ['NE', 'SE', 'SW', 'NW'] as const;
  let frame = 0;
  for (const direction of directions) {
    clips.push({
      state: 'idle',
      direction,
      startFrame: frame,
      frameCount: 1,
      fps: 1,
      loop: true,
    });
    frame += 1;
    clips.push({
      state: 'walk',
      direction,
      startFrame: frame,
      frameCount: 2,
      fps: 10,
      loop: true,
    });
    frame += 2;
    clips.push({
      state: 'attack',
      direction,
      startFrame: frame,
      frameCount: 4,
      fps: 10,
      loop: false,
      releaseFrame: 2,
    });
    frame += 4;
  }
  // 4 dirs × 7 frames = 28 → 7×4 sheet
  return {
    frameWidth: 32,
    frameHeight: 48,
    columns: 7,
    rows: 4,
    margin: 2,
    spacing: 2,
    clips,
  };
}

export function runAnimationRuntimeTests(): CheckResult[] {
  const results: CheckResult[] = [];
  const atlas = makeSyntheticAtlas();

  // —— Clip lookup ——
  for (const direction of ['NE', 'SE', 'SW', 'NW'] as const) {
    const idle = findClip(atlas, 'idle', direction);
    results.push(
      assert(
        `clip lookup idle:${direction}`,
        idle != null && idle.state === 'idle' && idle.direction === direction,
      ),
    );
    const attack = findClip(atlas, 'attack', direction);
    results.push(
      assert(
        `clip lookup attack:${direction}`,
        attack != null && attack.loop === false && attack.releaseFrame === 2,
      ),
    );
  }
  results.push(assert('clip lookup missing → null', findClip(atlas, 'cast', 'SE') == null));
  results.push(assert('clip lookup null atlas → null', findClip(null, 'idle', 'SE') == null));
  results.push(assert('clipKey format', clipKey('walk', 'NW') === 'walk:NW'));

  // —— Frame progression (loop) ——
  {
    const player = new AnimationPlayer();
    player.setClip('walk', 'SE');
    const walk = findClip(atlas, 'walk', 'SE')!;
    const a = player.advance(0, atlas);
    results.push(assert('walk frame 0 at t=0', a.localFrame === 0 && a.absoluteFrame === walk.startFrame));
    const b = player.advance(0.1, atlas); // 1 frame at 10 fps
    results.push(assert('walk frame 1 at t=0.1', b.localFrame === 1));
    const c = player.advance(0.1, atlas); // wraps
    results.push(assert('walk loops to frame 0', c.localFrame === 0 && c.completed === false));
  }

  // —— One-shot completion ——
  {
    const player = new AnimationPlayer();
    player.setClip('attack', 'NE');
    const attack = findClip(atlas, 'attack', 'NE')!;
    let completed = false;
    let lastLocal = -1;
    // 4 frames at 10 fps → 0.4s to complete
    for (let i = 0; i < 5; i++) {
      const sample = player.advance(0.1, atlas);
      lastLocal = sample.localFrame;
      if (sample.completed) completed = true;
    }
    results.push(
      assert(
        'one-shot freezes on last frame',
        lastLocal === attack.frameCount - 1 && completed,
        `local=${lastLocal} completed=${completed}`,
      ),
    );
    const after = player.advance(1, atlas);
    results.push(
      assert(
        'one-shot stays completed',
        after.completed && after.localFrame === attack.frameCount - 1,
      ),
    );
  }

  // —— releaseFrame exactly once per attack ——
  {
    const player = new AnimationPlayer();
    player.setClip('attack', 'SW');
    let releases = 0;
    for (let i = 0; i < 8; i++) {
      const sample = player.advance(0.1, atlas);
      if (sample.releaseEvent) releases++;
    }
    results.push(assert('releaseFrame once per playthrough', releases === 1, `releases=${releases}`));

    player.setClip('attack', 'SW'); // restart same clip identity after setClip reset
    // setClip with same key returns early without reset — force by changing direction then back
    player.setClip('idle', 'SW');
    player.setClip('attack', 'SW');
    releases = 0;
    for (let i = 0; i < 8; i++) {
      if (player.advance(0.1, atlas).releaseEvent) releases++;
    }
    results.push(assert('releaseFrame once after new attack', releases === 1, `releases=${releases}`));
  }

  // —— Atlas frame rect from sheet geometry only ——
  {
    const rect0 = atlasFrameRect(atlas, 0);
    results.push(
      assert(
        'frame 0 rect uses margin',
        deepEqual(rect0, { x: 2, y: 2, w: 32, h: 48 }),
        JSON.stringify(rect0),
      ),
    );
    const rect7 = atlasFrameRect(atlas, 7);
    results.push(
      assert(
        'frame 7 wraps to next row',
        deepEqual(rect7, { x: 2, y: 2 + 48 + 2, w: 32, h: 48 }),
        JSON.stringify(rect7),
      ),
    );
  }

  // —— Direction mapping + quadrant boundaries ——
  const dirCases: Array<{ fx: number; fy: number; expect: string; label: string }> = [
    { fx: 1, fy: 0, expect: 'SE', label: '+X' },
    { fx: 0, fy: 1, expect: 'SW', label: '+Y' },
    { fx: -1, fy: 0, expect: 'NW', label: '-X' },
    { fx: 0, fy: -1, expect: 'NE', label: '-Y' },
    { fx: 0, fy: 0, expect: 'SE', label: 'zero' },
    // Diagonal boundaries (iso axes)
    { fx: 1, fy: -1, expect: 'NE', label: 'boundary +X-Y (sx>0,sy=0)' },
    { fx: 1, fy: 1, expect: 'SE', label: 'boundary +X+Y (sx=0,sy>0)' },
    { fx: -1, fy: 1, expect: 'SW', label: 'boundary -X+Y (sx<0,sy=0)' },
    { fx: -1, fy: -1, expect: 'NW', label: 'boundary -X-Y (sx=0,sy<0)' },
    // Near-boundary samples inside each quadrant
    { fx: 0.5, fy: -0.8, expect: 'NE', label: 'near NE' },
    { fx: 0.9, fy: 0.1, expect: 'SE', label: 'near SE' },
    { fx: -0.5, fy: 0.8, expect: 'SW', label: 'near SW' },
    { fx: -0.9, fy: -0.1, expect: 'NW', label: 'near NW' },
  ];
  for (const c of dirCases) {
    const got = facingToIsoDirection(c.fx, c.fy);
    results.push(
      assert(`direction ${c.label} → ${c.expect}`, got === c.expect, `got ${got}`),
    );
  }

  // —— Visual state adapter priority ——
  results.push(
    assert(
      'adapter death wins',
      resolveUnitVisualPose({
        isDead: true,
        hitVisualRemaining: 1,
        attackVisualRemaining: 1,
        isMoving: true,
        facingX: 0,
        facingY: 1,
      }).state === 'death',
    ),
  );
  results.push(
    assert(
      'adapter attack over hit/walk',
      resolveUnitVisualPose({
        isDead: false,
        hitVisualRemaining: 1,
        attackVisualRemaining: 0.05,
        isMoving: true,
        facingX: 1,
        facingY: 0,
      }).state === 'attack',
    ),
  );
  results.push(
    assert(
      'adapter hit over walk',
      resolveUnitVisualPose({
        isDead: false,
        hitVisualRemaining: 0.1,
        attackVisualRemaining: 0,
        isMoving: true,
        facingX: 0,
        facingY: -1,
      }).state === 'hit',
    ),
  );
  results.push(
    assert(
      'adapter walk',
      resolveUnitVisualPose({
        isDead: false,
        hitVisualRemaining: 0,
        attackVisualRemaining: 0,
        isMoving: true,
        facingX: 0,
        facingY: 1,
      }).state === 'walk',
    ),
  );
  results.push(
    assert(
      'adapter idle + SW facing',
      deepEqual(
        resolveUnitVisualPose({
          isDead: false,
          hitVisualRemaining: 0,
          attackVisualRemaining: 0,
          isMoving: false,
          facingX: 0,
          facingY: 1,
        }),
        { state: 'idle', direction: 'SW' },
      ),
    ),
  );

  // —— Four directions driven by synthetic atlas via player ——
  for (const direction of ['NE', 'SE', 'SW', 'NW'] as const) {
    const player = new AnimationPlayer();
    player.setClip('idle', direction);
    const sample = player.advance(0, atlas);
    results.push(
      assert(
        `player drives ${direction}`,
        sample.clip?.direction === direction && sample.sourceRect != null,
      ),
    );
  }

  return results;
}
