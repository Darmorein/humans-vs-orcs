import type { GameCommand } from './Commands';

/**
 * Command stamped with the sim tick when it was *applied*.
 * Future pure replay: start from seed, re-apply this list in order.
 */
export interface TimedCommand {
  tick: number;
  command: GameCommand;
}

/**
 * Replay foundation document.
 * Full lockstep determinism is not required yet — this schema stays stable
 * while systems migrate off Math.random / unordered iteration.
 */
export interface ReplayManifest {
  format: 'hvo-replay';
  version: 1;
  seed: number;
  /** Tick when recording started (usually 0). */
  startTick: number;
  /** Last tick included in this log. */
  endTick: number;
  commands: TimedCommand[];
  determinism: DeterminismMeta;
}

export interface DeterminismMeta {
  /**
   * snapshot — resume from serialized world (current default for Load).
   * partial — seed+commands approximate; soft systems may diverge.
   * lockstep — pure reconstruct (goal).
   */
  level: 'snapshot' | 'partial' | 'lockstep';
  notes: string[];
}

export const CURRENT_DETERMINISM: DeterminismMeta = {
  level: 'partial',
  notes: [
    'Load uses GameStateSnapshot v2 (entities, squads, heroes, artifacts, queues, RNG, id allocators).',
    'Replay log (seed + TimedCommand[]) is recorded; ReplayPlayer kept for command reconstruct tests.',
    'AI issues GameCommands through the same applyCommand path as local/remote.',
    'Match seed pick / New World / PvP fair-seed search may use Math.random (outside sim ticks).',
    'Soft civic timers / influence / fog / presentation still diverge across reconstruct.',
  ],
};

/** Append-only recorder living beside the CommandQueue. */
export class ReplayRecorder {
  private commands: TimedCommand[] = [];
  private startTick = 0;
  private endTick = 0;

  public reset(startTick = 0) {
    this.commands = [];
    this.startTick = startTick;
    this.endTick = startTick;
  }

  public recordApplied(tick: number, command: GameCommand) {
    this.commands.push({ tick, command: { ...command } });
    if (tick > this.endTick) this.endTick = tick;
  }

  public getCommands(): readonly TimedCommand[] {
    return this.commands;
  }

  public restore(commands: TimedCommand[], startTick = 0, endTick?: number) {
    this.commands = commands.map((c) => ({
      tick: c.tick,
      command: { ...c.command },
    }));
    this.startTick = startTick;
    this.endTick = endTick ?? (commands.at(-1)?.tick ?? startTick);
  }

  public toManifest(seed: number): ReplayManifest {
    return {
      format: 'hvo-replay',
      version: 1,
      seed,
      startTick: this.startTick,
      endTick: this.endTick,
      commands: this.commands.map((c) => ({
        tick: c.tick,
        command: { ...c.command },
      })),
      determinism: { ...CURRENT_DETERMINISM, notes: [...CURRENT_DETERMINISM.notes] },
    };
  }
}

/**
 * Future: feed TimedCommands back into CommandQueue at matching ticks.
 * Stub keeps API stable while determinism improves.
 */
export class ReplayPlayer {
  private readonly byTick = new Map<number, GameCommand[]>();
  private enabled = false;

  public load(manifest: ReplayManifest) {
    this.byTick.clear();
    for (const entry of manifest.commands) {
      const list = this.byTick.get(entry.tick) ?? [];
      list.push(entry.command);
      this.byTick.set(entry.tick, list);
    }
    this.enabled = true;
  }

  public stop() {
    this.enabled = false;
    this.byTick.clear();
  }

  public isActive(): boolean {
    return this.enabled;
  }

  /** Commands scheduled for this tick (empty if none / inactive). */
  public commandsForTick(tick: number): GameCommand[] {
    if (!this.enabled) return [];
    return this.byTick.get(tick) ?? [];
  }
}
