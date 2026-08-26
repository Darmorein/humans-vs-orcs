/**
 * Art Kit v1.1 animation runtime.
 * Consumes Manifest v2 atlas/clip metadata with deterministic, caller-driven timing.
 */

export { AnimationPlayer, type AnimationSample } from './AnimationPlayer';
export { clipKey, findClip } from './clipLookup';
export {
  absoluteFrameIndex,
  atlasFrameRect,
  type AtlasSourceRect,
} from './frameRect';
export { facingToIsoDirection } from './isoDirection';
export {
  resolveUnitVisualPose,
  type UnitVisualAnimState,
  type UnitVisualInput,
  type UnitVisualPose,
} from './UnitVisualState';
export {
  resetMissingClipDiagnostics,
  warnMissingClipOnce,
} from './missingClipDiagnostic';
