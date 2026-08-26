/**
 * Multiplayer-ready simulation core (no networking yet).
 * Fixed tick, seeded RNG, command queue, serializable snapshots,
 * save/load + replay foundation (seed + TimedCommand[]).
 */
export { SIM_TICK_HZ, SIM_TICK_DT, SIM_TICK_MS, GAME_STATE_VERSION } from './SimClock';
export { GameRng } from './GameRng';
export type { GameCommand } from './Commands';
export type {
  MoveSquadCommand,
  AttackCommand,
  ChangeFormationCommand,
  QueueBuildingCommand,
  FoundSettlementCommand,
} from './Commands';
export { isGameCommand } from './Commands';
export { CommandQueue } from './CommandQueue';
export { applyCommand, type CommandWorld } from './applyCommand';
export { serializeGameState, type GameStateSnapshot } from './serializeState';
export {
  ReplayRecorder,
  ReplayPlayer,
  CURRENT_DETERMINISM,
  type ReplayManifest,
  type TimedCommand,
  type DeterminismMeta,
} from './ReplayLog';
export {
  buildSaveGame,
  parseSaveGame,
  writeSaveToStorage,
  readSaveFromStorage,
  markPendingLoad,
  peekPendingLoadSlot,
  clearPendingLoadSlot,
  downloadJson,
  DEFAULT_SAVE_SLOT,
  SAVE_FORMAT,
  SAVE_VERSION,
  type SaveGame,
} from './SaveGame';
export { hydrateFromSnapshot } from './hydrateState';
