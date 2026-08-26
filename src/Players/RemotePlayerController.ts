import type { GameContext, PlayerController } from './PlayerController';

/**
 * Networked seat: orders arrive via Net → Game.submitRemoteCommand, not here.
 * Controllers still participate in the seat loop for symmetry with LOCAL/AI.
 */
export class RemotePlayerController implements PlayerController {
  public readonly playerId: string;

  constructor(playerId: string) {
    this.playerId = playerId;
  }

  update(_ctx: GameContext): void {
    // Intentionally empty — remote intents are injected into CommandQueue.
  }
}
