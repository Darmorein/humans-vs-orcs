/** Fixed simulation step — gameplay must not depend on render FPS. */
export const SIM_TICK_HZ = 60;
export const SIM_TICK_DT = 1 / SIM_TICK_HZ;
export const SIM_TICK_MS = 1000 / SIM_TICK_HZ;

/** Snapshot schema version for future multiplayer / replay. */
export const GAME_STATE_VERSION = 2 as const;
