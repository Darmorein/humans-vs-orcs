import type { Entity } from '../Entities/Entity';
import type { GameMap } from '../Map/GameMap';
import type { MatchState } from './MatchState';
import type { SettlementSystem } from '../Settlement/SettlementSystem';
import type { SquadSystem } from '../Combat/SquadSystem';
import type { InfluenceMap } from '../Map/InfluenceMap';
import type { GameCommand } from '../Sim/Commands';
import type { GameRng } from '../Sim/GameRng';

/** Shared per-frame context for player controllers (local / AI / future remote). */
export interface GameContext {
  dt: number;
  entities: Entity[];
  gameMap: GameMap;
  match: MatchState;
  settlements: SettlementSystem;
  squads?: SquadSystem;
  influence?: InfluenceMap;
  submitCommand: (cmd: GameCommand) => void;
  rng: GameRng;
  /** Fixed sim tick (tax policy cooldown / AI hysteresis). */
  simTick?: number;
}

export interface PlayerController {
  readonly playerId: string;
  update(ctx: GameContext): void;
}
