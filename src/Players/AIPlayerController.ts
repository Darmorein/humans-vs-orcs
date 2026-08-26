import type { GameContext, PlayerController } from './PlayerController';
import { AISystem } from '../Systems/AISystem';

/** AI seat: drives one PlayerState via faction-aware AISystem. */
export class AIPlayerController implements PlayerController {
  public readonly playerId: string;
  private ai: AISystem;

  constructor(playerId: string) {
    this.playerId = playerId;
    this.ai = new AISystem(playerId);
  }

  update(ctx: GameContext): void {
    this.ai.update(
      ctx.dt,
      ctx.entities,
      ctx.gameMap,
      ctx.match,
      ctx.settlements,
      ctx.squads,
      ctx.influence,
    );
  }

  getPhase(): string {
    return this.ai.getPhase();
  }

  getStrategicReason(): string {
    return this.ai.getStrategicReason();
  }
}
