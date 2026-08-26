/**
 * Multiplayer-ready simulation core.
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
  EquipArtifactCommand,
  UnequipArtifactCommand,
  TransferArtifactCommand,
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
export { hashGameSnapshot, hashString, type SimulationStateHash } from './stateHash';
export { compareSaveLoadHashes, type DeterminismTestResult } from './determinismTest';
export { mountSimDiagnostics, type SimDiagnosticsData } from './diagnostics';
export { getUnitDef, unitSpawnOptions, allUnitDefs } from './UnitCatalog';
export { spawnUnitRegistered, spawnUnitNearBuilding } from './spawnUnit';
export { captureIdAllocators, restoreIdAllocators, type IdAllocatorState } from './IdAllocators';
