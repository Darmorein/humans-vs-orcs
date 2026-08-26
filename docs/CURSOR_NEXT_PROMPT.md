# Cursor prompt — Art Kit v1.1 runtime

Copy the prompt below into Cursor after the **Manifest Runtime Integration** pull request is merged.

---

You are working in `Darmorein/humans-vs-orcs`, a Vite + TypeScript browser RTS. Read the repository before editing. Manifest v2 is already validated at build time and is now the runtime source of truth for sprite scale, pivot, collision footprint, selection radius, and building placement. Do not reintroduce per-entity geometry or render constants when the manifest can express them.

## Goal

Implement the next vertical slice of the asset pipeline: a production-ready animation runtime that consumes Manifest v2 atlas/clip metadata while keeping every current static prototype sprite working.

## Required work

1. Add a small animation player under `src/Assets/Animation/` that:
   - selects clips by `state` and isometric direction (`NE`, `SE`, `SW`, `NW`);
   - advances frames deterministically from simulation/render time supplied by the caller;
   - supports loop and one-shot clips;
   - exposes ranged `releaseFrame` events exactly once per attack;
   - never reads wall-clock time or uses `Math.random()`.
2. Add atlas-aware drawing without breaking the existing `drawSprite` static-image path. Frame rectangles must come exclusively from `AssetEntry.atlas`.
3. Give `Unit` a minimal visual state adapter for `idle`, `walk`, `attack`, `hit`, and `death`. Gameplay remains authoritative: animation must not decide damage, movement, death, or cooldowns.
4. Derive the four-direction facing from the unit's current facing vector. Document the mapping and test all quadrant boundaries.
5. Keep static prototype sprites as a graceful fallback whenever `atlas === null` or the requested clip is missing. Emit a development-only diagnostic once per missing clip, not every frame.
6. Add focused automated checks for clip lookup, frame progression, one-shot completion, release-frame emission, and direction mapping. If the repo still has no test runner, add the smallest suitable setup and scripts without replacing the existing build pipeline.
7. Update `docs/ASSET_PIPELINE_V2.md` with the exact sheet layout, clip lookup rules, deterministic timing contract, and fallback behavior.

## Constraints

- Preserve PvP/replay determinism.
- Do not generate or commit fake final art, base64 blobs, or duplicated images.
- Do not change gameplay balance values.
- Do not make animation state part of save files unless the existing replay/save architecture requires it; explain any such decision.
- Do not bypass `assetManifest` with new hardcoded scale, pivot, frame-size, or clip tables.
- Keep TypeScript strict and avoid `any` in new code.
- Preserve current assets and public paths.

## Acceptance criteria

- All current static sprites render exactly as before when no atlas metadata exists.
- A synthetic manifest atlas can drive all four directions and at least one one-shot attack clip in automated tests.
- `npm run validate:assets` passes.
- TypeScript checks pass.
- `npm run build` passes.
- The final response lists changed files, commands run, remaining art dependencies, and any intentionally deferred work.

Work on a new branch, make cohesive commits, and open a pull request against `main`. Do not merge it automatically.

---
