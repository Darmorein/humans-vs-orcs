import type { BuildingType } from '../Entities/Building';
import type { SquadFormation } from '../Combat/FormationDefs';

/**
 * Player-intent commands — serializable for future lockstep / replay.
 * UI and local input enqueue these; simulation applies them on a fixed tick.
 */
export type GameCommand =
  | MoveSquadCommand
  | AttackCommand
  | ChangeFormationCommand
  | QueueBuildingCommand
  | FoundSettlementCommand
  | FormSettlerGroupCommand
  | TrainUnitCommand
  | MoveAgentsCommand
  | GatherCommand
  | AssistBuildCommand
  | CancelConstructionCommand
  | ReorderConstructionCommand
  | SurrenderCommand;

interface CommandBase {
  /** Issuing seat — unambiguous Player ID. */
  playerId: string;
  /** Optional client/sim tick hint for future networking. */
  issuedAtTick?: number;
}

export interface MoveSquadCommand extends CommandBase {
  type: 'moveSquad';
  squadId: string;
  x: number;
  y: number;
}

export interface AttackCommand extends CommandBase {
  type: 'attack';
  /** Squad attack (preferred for combat). */
  squadId?: string;
  /** Micro / worker attack. */
  unitIds?: number[];
  targetEntityId: number;
}

export interface ChangeFormationCommand extends CommandBase {
  type: 'changeFormation';
  squadId: string;
  formation: SquadFormation;
}

export interface QueueBuildingCommand extends CommandBase {
  type: 'queueBuilding';
  buildingType: BuildingType;
  x?: number;
  y?: number;
}

export interface FoundSettlementCommand extends CommandBase {
  type: 'foundSettlement';
  x: number;
  y: number;
  /** If no ready settler group, attempt to form one first. */
  formGroupIfNeeded?: boolean;
}

export interface FormSettlerGroupCommand extends CommandBase {
  type: 'formSettlerGroup';
}

export interface TrainUnitCommand extends CommandBase {
  type: 'trainUnit';
  buildingId: number;
  unitType: string;
  cost: number;
}

/** Non-squad agents (workers / Ctrl-micro). */
export interface MoveAgentsCommand extends CommandBase {
  type: 'moveAgents';
  unitIds: number[];
  x: number;
  y: number;
}

export interface GatherCommand extends CommandBase {
  type: 'gather';
  unitIds: number[];
  resourceEntityId: number;
}

export interface AssistBuildCommand extends CommandBase {
  type: 'assistBuild';
  unitIds: number[];
  buildingId: number;
}

export interface CancelConstructionCommand extends CommandBase {
  type: 'cancelConstruction';
  projectId: string;
}

export interface ReorderConstructionCommand extends CommandBase {
  type: 'reorderConstruction';
  projectId: string;
  direction: -1 | 1;
}

export interface SurrenderCommand extends CommandBase {
  type: 'surrender';
}

export function isGameCommand(v: unknown): v is GameCommand {
  return !!v && typeof v === 'object' && typeof (v as GameCommand).type === 'string';
}
