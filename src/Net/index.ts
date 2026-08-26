/**
 * Browser PvP 1v1 foundation: lobby, fair shared seed, command relay.
 * Requires `npm run pvp` (WebSocket room relay) for networked matches.
 */
export { NetClient } from './NetClient';
export { PvpSession, type PvpMatchConfig } from './PvpSession';
export { mountLobby, type BootTarget } from './LobbyUI';
export { pickFairSeed } from './pickFairSeed';
export {
  DEFAULT_PVP_WS,
  PVP_COMMAND_DELAY_TICKS,
  modeLabel,
  type SeatIndex,
  type LobbySeat,
} from './Protocol';
