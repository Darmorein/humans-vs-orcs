import type { FactionId } from '../Players/Types';
import type { GameCommand } from '../Sim/Commands';
import { NetClient } from './NetClient';
import { pickFairSeed } from './pickFairSeed';
import {
  modeLabel,
  type LobbySeat,
  type SeatIndex,
  type ServerNetMessage,
} from './Protocol';

export interface PvpMatchConfig {
  seed: number;
  factions: [FactionId, FactionId];
  localSeat: SeatIndex;
  roomId: string;
  mode: string;
}

type LobbyListener = (seats: [LobbySeat, LobbySeat] | null, info: PvpSessionInfo) => void;
type MatchListener = (cfg: PvpMatchConfig) => void;
type CommandListener = (cmd: GameCommand) => void;

export interface PvpSessionInfo {
  roomId: string | null;
  seat: SeatIndex | null;
  isHost: boolean;
  error: string | null;
  peerConnected: boolean;
}

/**
 * Lobby + in-match session over the room relay.
 * Host picks a fair shared seed when both seats are ready and Start is pressed.
 */
export class PvpSession {
  private readonly client: NetClient;
  private roomId: string | null = null;
  private seat: SeatIndex | null = null;
  private isHost = false;
  private seats: [LobbySeat, LobbySeat] | null = null;
  private error: string | null = null;
  private peerConnected = false;
  private unsub: (() => void) | null = null;

  private lobbyListeners = new Set<LobbyListener>();
  private matchListeners = new Set<MatchListener>();
  private commandListeners = new Set<CommandListener>();
  private peerLeftListeners = new Set<() => void>();

  constructor(wsUrl?: string) {
    this.client = new NetClient(wsUrl);
  }

  public get info(): PvpSessionInfo {
    return {
      roomId: this.roomId,
      seat: this.seat,
      isHost: this.isHost,
      error: this.error,
      peerConnected: this.peerConnected,
    };
  }

  public get lobbySeats(): [LobbySeat, LobbySeat] | null {
    return this.seats;
  }

  public onLobby(fn: LobbyListener): () => void {
    this.lobbyListeners.add(fn);
    return () => this.lobbyListeners.delete(fn);
  }

  public onMatchStart(fn: MatchListener): () => void {
    this.matchListeners.add(fn);
    return () => this.matchListeners.delete(fn);
  }

  public onRemoteCommand(fn: CommandListener): () => void {
    this.commandListeners.add(fn);
    return () => this.commandListeners.delete(fn);
  }

  public onPeerLeft(fn: () => void): () => void {
    this.peerLeftListeners.add(fn);
    return () => this.peerLeftListeners.delete(fn);
  }

  public async connect(): Promise<void> {
    this.unsub?.();
    this.unsub = this.client.onMessage((msg) => this.handle(msg));
    await this.client.connect();
  }

  public createRoom(displayName: string) {
    this.error = null;
    this.client.send({ type: 'create', displayName });
  }

  public joinRoom(roomId: string, displayName: string) {
    this.error = null;
    this.client.send({ type: 'join', roomId: roomId.trim().toUpperCase(), displayName });
  }

  public setFaction(factionId: FactionId) {
    this.client.send({ type: 'setFaction', factionId });
  }

  public setReady(ready: boolean) {
    this.client.send({ type: 'setReady', ready });
  }

  /** Host only: generate fair seed and synchronize start. */
  public startMatch() {
    if (!this.isHost || !this.seats) {
      this.error = 'Only host can start';
      this.emitLobby();
      return;
    }
    const [a, b] = this.seats;
    if (!a.connected || !b.connected || !a.ready || !b.ready) {
      this.error = 'Both players must be connected and ready';
      this.emitLobby();
      return;
    }
    const { seed, ok } = pickFairSeed();
    if (!ok) {
      this.error = 'Could not find a fair map seed — try again';
      this.emitLobby();
      return;
    }
    const factions: [FactionId, FactionId] = [
      a.factionId as FactionId,
      b.factionId as FactionId,
    ];
    this.client.send({ type: 'matchStart', seed, factions });
  }

  public sendCommand(command: GameCommand) {
    this.client.send({ type: 'command', command });
  }

  public dispose() {
    this.unsub?.();
    this.unsub = null;
    this.client.close();
  }

  private handle(msg: ServerNetMessage) {
    switch (msg.type) {
      case 'welcome':
        this.roomId = msg.roomId;
        this.seat = msg.seat;
        this.isHost = msg.isHost;
        this.error = null;
        this.emitLobby();
        break;
      case 'lobby':
        this.seats = msg.seats;
        this.peerConnected = msg.seats[0].connected && msg.seats[1].connected;
        this.error = null;
        this.emitLobby();
        break;
      case 'peerLeft':
        this.peerConnected = false;
        this.error = 'Opponent disconnected';
        this.emitLobby();
        for (const fn of this.peerLeftListeners) fn();
        break;
      case 'error':
        this.error = msg.message;
        this.emitLobby();
        break;
      case 'matchStart':
        if (this.seat == null || !this.roomId) return;
        for (const fn of this.matchListeners) {
          fn({
            seed: msg.seed,
            factions: msg.factions,
            localSeat: this.seat,
            roomId: this.roomId,
            mode: modeLabel(msg.factions[0], msg.factions[1]),
          });
        }
        break;
      case 'command':
        for (const fn of this.commandListeners) fn(msg.command);
        break;
      default:
        break;
    }
  }

  private emitLobby() {
    for (const fn of this.lobbyListeners) fn(this.seats, this.info);
  }
}
