/**
 * PvP 1v1 wire protocol (lobby + in-match).
 * Relay server forwards client messages; seats are assigned by the room.
 */

import type { FactionId } from '../Players/Types';
import type { GameCommand } from '../Sim/Commands';

export type SeatIndex = 0 | 1;

export interface LobbySeat {
  seat: SeatIndex;
  connected: boolean;
  displayName: string;
  factionId: FactionId;
  ready: boolean;
}

/** Messages the client sends (also relayed peer→peer except hello/create/join). */
export type ClientNetMessage =
  | { type: 'create'; displayName: string }
  | { type: 'join'; roomId: string; displayName: string }
  | { type: 'setFaction'; factionId: FactionId }
  | { type: 'setReady'; ready: boolean }
  | { type: 'requestStart' }
  | { type: 'matchStart'; seed: number; factions: [FactionId, FactionId] }
  | { type: 'command'; command: GameCommand }
  | { type: 'chat'; text: string };

/** Messages the client receives from the relay or peer (via relay). */
export type ServerNetMessage =
  | { type: 'welcome'; roomId: string; seat: SeatIndex; isHost: boolean }
  | { type: 'lobby'; seats: [LobbySeat, LobbySeat] }
  | { type: 'peerLeft' }
  | { type: 'error'; message: string }
  | { type: 'matchStart'; seed: number; factions: [FactionId, FactionId] }
  | { type: 'command'; command: GameCommand }
  | { type: 'chat'; text: string; fromSeat: SeatIndex };

export function modeLabel(a: FactionId, b: FactionId): string {
  if (a === 'humans' && b === 'humans') return 'Human vs Human';
  if (a === 'orcs' && b === 'orcs') return 'Orc vs Orc';
  return 'Human vs Orc';
}

export const DEFAULT_PVP_WS = 'ws://127.0.0.1:3333';
/** Extra sim ticks before a networked command applies (both clients). */
export const PVP_COMMAND_DELAY_TICKS = 3;
