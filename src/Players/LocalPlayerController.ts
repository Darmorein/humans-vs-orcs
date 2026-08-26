import type { GameContext, PlayerController } from './PlayerController';

/**
 * Local human input is handled by SelectionSystem / UI using match.localPlayerId.
 * This controller is a seat marker for the architecture (and future input ownership).
 */
export class LocalPlayerController implements PlayerController {
  public readonly playerId: string;

  constructor(playerId: string) {
    this.playerId = playerId;
  }

  update(_ctx: GameContext): void {
    // Intentionally empty — selection & UI drive local orders.
  }
}
