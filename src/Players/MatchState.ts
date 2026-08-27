import {
  FACTIONS,
  PLAYER_COLORS,
  type ControllerType,
  type FactionId,
  type Player,
} from './Types';
import type { TaxPolicy } from './TaxPolicy';

/** Per-settlement tax remittance for the last tax tick (UI). */
export interface TaxContribution {
  settlementId: string;
  label: string;
  amount: number;
}

export class PlayerState implements Player {
  public id: string;
  public factionId: FactionId;
  public controllerType: ControllerType;
  public playerColor: string;
  public displayName: string;
  /**
   * Faction Treasury (field name kept as `gold` for save/compat).
   * Settlement local gold lives on Settlement — do not mirror.
   */
  public gold: number;
  public pop = 0;
  public maxPop = 0;
  public isDefeated = false;

  /** Faction tax take on settlement taxable surplus. */
  public taxPolicy: TaxPolicy = 'normal';
  /** Sim tick of last successful SetTaxPolicy (cooldown gate). */
  public lastTaxChangeTick = 0;
  /** Rolling treasury income from taxes (gold/sec, UI). */
  public treasuryIncomeRate = 0;
  /** Last tax-tick remittances for HUD / settlement panel. */
  public taxContributions: TaxContribution[] = [];
  /**
   * Designated capital settlement seat id.
   * Set on first TC reconcile / spawn; capital destroy is primary victory.
   */
  public capitalSettlementId: string | null = null;

  constructor(init: Player & { gold?: number; taxPolicy?: TaxPolicy; capitalSettlementId?: string | null }) {
    this.id = init.id;
    this.factionId = init.factionId;
    this.controllerType = init.controllerType;
    this.playerColor = init.playerColor;
    this.displayName = init.displayName;
    this.gold = init.gold ?? 300;
    if (init.taxPolicy) this.taxPolicy = init.taxPolicy;
    if (init.capitalSettlementId !== undefined) {
      this.capitalSettlementId = init.capitalSettlementId;
    }
  }

  public get faction() {
    return FACTIONS[this.factionId];
  }
}

/**
 * Runtime match roster. Separates faction identity from player/controller identity.
 * Ready for extra LOCAL/AI/REMOTE seats without networking yet.
 */
export class MatchState {
  public static current: MatchState | null = null;

  public readonly players = new Map<string, PlayerState>();
  public localPlayerId: string;
  /** Sim seconds since match start (for soft dominance). */
  public matchElapsedSec = 0;
  /** After MATCH_SOFT_CAP_SEC — mild score pressure / optional soft resolve. */
  public dominancePhase = false;

  constructor(players: PlayerState[], localPlayerId: string) {
    for (const p of players) this.players.set(p.id, p);
    this.localPlayerId = localPlayerId;
    MatchState.current = this;
  }

  public get localPlayer(): PlayerState {
    return this.players.get(this.localPlayerId)!;
  }

  public getPlayer(id: string): PlayerState | undefined {
    return this.players.get(id);
  }

  public allPlayers(): PlayerState[] {
    return [...this.players.values()];
  }

  public opponentsOf(playerId: string): PlayerState[] {
    return this.allPlayers().filter((p) => p.id !== playerId && !p.isDefeated);
  }

  public depositGold(playerId: string, amount: number) {
    const p = this.players.get(playerId);
    if (p) p.gold += amount;
  }

  public trySpend(playerId: string, amount: number): boolean {
    const p = this.players.get(playerId);
    if (!p || p.gold < amount) return false;
    p.gold -= amount;
    return true;
  }
}

/** Standard 1v1 setup: local Humans vs AI Orcs (swap-friendly). */
export function createDefaultMatch(options?: {
  localFaction?: FactionId;
  opponentFaction?: FactionId;
  localController?: ControllerType;
  opponentController?: ControllerType;
  localDisplayName?: string;
  opponentDisplayName?: string;
}): MatchState {
  const localFaction: FactionId = options?.localFaction ?? 'humans';
  const opponentFaction: FactionId =
    options?.opponentFaction ?? (localFaction === 'humans' ? 'orcs' : 'humans');

  const p1 = new PlayerState({
    id: 'player-1',
    factionId: localFaction,
    controllerType: options?.localController ?? 'LOCAL',
    playerColor: PLAYER_COLORS[0],
    displayName: options?.localDisplayName ?? 'Player 1',
    gold: 560,
  });

  const p2 = new PlayerState({
    id: 'player-2',
    factionId: opponentFaction,
    controllerType: options?.opponentController ?? 'AI',
    playerColor: PLAYER_COLORS[1],
    displayName:
      options?.opponentDisplayName ??
      (opponentFaction === 'orcs' ? 'Orc Warlord' : 'Human Commander'),
    gold: 600,
  });

  return new MatchState([p1, p2], p1.id);
}

/**
 * 1v1 PvP roster: each seat chooses faction independently.
 * Start slots are by seat (player-1 / player-2), not by faction look.
 */
export function createPvpMatch(options: {
  factions: [FactionId, FactionId];
  localSeat: 0 | 1;
  names?: [string, string];
}): MatchState {
  const [f0, f1] = options.factions;
  const names = options.names ?? ['Player 1', 'Player 2'];

  const p1 = new PlayerState({
    id: 'player-1',
    factionId: f0,
    controllerType: options.localSeat === 0 ? 'LOCAL' : 'REMOTE',
    playerColor: PLAYER_COLORS[0],
    displayName: names[0],
    gold: 560,
  });

  const p2 = new PlayerState({
    id: 'player-2',
    factionId: f1,
    controllerType: options.localSeat === 1 ? 'LOCAL' : 'REMOTE',
    playerColor: PLAYER_COLORS[1],
    displayName: names[1],
    gold: 560,
  });

  const localId = options.localSeat === 0 ? p1.id : p2.id;
  return new MatchState([p1, p2], localId);
}
