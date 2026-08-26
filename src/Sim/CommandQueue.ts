import type { GameCommand } from './Commands';

/**
 * Ordered command buffer drained once per simulation tick.
 * Future multiplayer: merge remote + local commands before drain.
 */
export class CommandQueue {
  private pending: GameCommand[] = [];

  public enqueue(cmd: GameCommand) {
    this.pending.push(cmd);
  }

  public enqueueAll(cmds: GameCommand[]) {
    this.pending.push(...cmds);
  }

  public get length(): number {
    return this.pending.length;
  }

  /** Drain commands whose issuedAtTick is due (or unset). Defers the rest. */
  public drainForTick(simTick: number): GameCommand[] {
    if (this.pending.length === 0) return [];
    const ready: GameCommand[] = [];
    const keep: GameCommand[] = [];
    for (const cmd of this.pending) {
      const at = cmd.issuedAtTick;
      if (at == null || at <= simTick) ready.push(cmd);
      else keep.push(cmd);
    }
    this.pending = keep;
    return ready;
  }

  /** Drain in FIFO order for this tick (ignores scheduling). */
  public drain(): GameCommand[] {
    if (this.pending.length === 0) return [];
    const batch = this.pending;
    this.pending = [];
    return batch;
  }

  public clear() {
    this.pending = [];
  }

  /** Peek for diagnostics / snapshots. */
  public snapshotPending(): GameCommand[] {
    return this.pending.map((c) => ({ ...c }));
  }
}
