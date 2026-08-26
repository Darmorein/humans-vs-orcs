import { Unit } from '../Entities/Unit';
import type { PlayerState } from '../Players/MatchState';
import { isCombatUnitType } from '../Combat/Squad';
import type { SquadSystem } from '../Combat/SquadSystem';
import { unitSpawnOptions } from './UnitCatalog';
import type { GameRng } from './GameRng';

export interface SpawnUnitArgs {
  player: PlayerState;
  unitType: string;
  x: number;
  y: number;
  entities: Unit[] | { push(u: Unit): void };
  squads: SquadSystem;
  /** Optional override options; defaults from UnitCatalog. */
  options?: {
    hp: number;
    speed: number;
    unitType: string;
    damage: number;
    range: number;
  };
}

/**
 * Single registration path for all simulation-spawned units
 * (train command, match bootstrap, hydrate uses assignId separately).
 */
export function spawnUnitRegistered(args: SpawnUnitArgs): Unit {
  const options = args.options ?? unitSpawnOptions(args.unitType);
  const unit = new Unit(args.x, args.y, args.player, options);
  args.entities.push(unit);
  if (isCombatUnitType(unit.unitType)) {
    args.squads.registerUnit(unit);
  }
  return unit;
}

/** Spawn near a building with deterministic angle/distance from GameRng. */
export function spawnUnitNearBuilding(
  args: Omit<SpawnUnitArgs, 'x' | 'y'> & {
    buildingX: number;
    buildingY: number;
    rng: GameRng;
    distMin?: number;
    distMax?: number;
  },
): Unit {
  const angle = args.rng.angle();
  const dist = args.rng.range(args.distMin ?? 55, args.distMax ?? 80);
  return spawnUnitRegistered({
    ...args,
    x: args.buildingX + Math.cos(angle) * dist,
    y: args.buildingY + Math.sin(angle) * dist,
  });
}
