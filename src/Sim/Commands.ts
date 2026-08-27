import type { BuildingType } from '../Entities/Building';
import type { SquadFormation } from '../Combat/FormationDefs';
import type { SettlementFocus } from '../Settlement/SettlementFocus';
import type { TaxPolicy } from '../Players/TaxPolicy';

/**
 * Player-intent commands — serializable for lockstep / replay / PvP.
 * UI and AI enqueue these; simulation applies them on a fixed tick.
 */
export type GameCommand =
  | MoveSquadCommand
  | AttackCommand
  | ChangeFormationCommand
  | QueueBuildingCommand
  | FoundSettlementCommand
  | FormSettlerGroupCommand
  | TrainUnitCommand
  | RecruitSquadCommand
  | ReinforceSquadCommand
  | MoveAgentsCommand
  | GatherCommand
  | AssistBuildCommand
  | CancelConstructionCommand
  | ReorderConstructionCommand
  | SurrenderCommand
  | EquipArtifactCommand
  | UnequipArtifactCommand
  | TransferArtifactCommand
  | SetSettlementFocusCommand
  | EstablishOutpostCommand
  | SetTaxPolicyCommand;

interface CommandBase {
  /** Issuing seat — unambiguous Player ID. */
  playerId: string;
  /** Optional client/sim tick hint for networking. */
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
  squadId?: string;
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
  /** Required world position — footprint validated from ConstructionCatalog. */
  x: number;
  y: number;
}

export interface FoundSettlementCommand extends CommandBase {
  type: 'foundSettlement';
  x: number;
  y: number;
  formGroupIfNeeded?: boolean;
}

export interface FormSettlerGroupCommand extends CommandBase {
  type: 'formSettlerGroup';
}

export interface TrainUnitCommand extends CommandBase {
  type: 'trainUnit';
  buildingId: number;
  unitType: string;
  /** Ignored at apply — cost comes from UnitCatalog + doctrine. Kept for log compat. */
  cost?: number;
}

/** Recruit a full squad from a Barracks / city military queue. */
export interface RecruitSquadCommand extends CommandBase {
  type: 'recruitSquad';
  templateId: string;
  /** Town Hall / Barracks that trains and spawns the squad. */
  buildingId: number;
}

/** Reinforce a depleted squad near a friendly city. */
export interface ReinforceSquadCommand extends CommandBase {
  type: 'reinforceSquad';
  squadId: string;
}

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

export interface EquipArtifactCommand extends CommandBase {
  type: 'equipArtifact';
  artifactId: string;
  unitId: number;
}

export interface UnequipArtifactCommand extends CommandBase {
  type: 'unequipArtifact';
  unitId: number;
}

export interface TransferArtifactCommand extends CommandBase {
  type: 'transferArtifact';
  artifactId: string;
  /** Target unit; omit / null to vault (unequip to settlement vault). */
  unitId: number | null;
}

export interface SetSettlementFocusCommand extends CommandBase {
  type: 'setSettlementFocus';
  settlementId: string;
  focus: SettlementFocus;
}

export interface EstablishOutpostCommand extends CommandBase {
  type: 'establishOutpost';
  x: number;
  y: number;
}

/** Change Faction Tax Policy (cooldown gated in applyCommand). */
export interface SetTaxPolicyCommand extends CommandBase {
  type: 'setTaxPolicy';
  policy: TaxPolicy;
}

export function isGameCommand(v: unknown): v is GameCommand {
  return !!v && typeof v === 'object' && typeof (v as GameCommand).type === 'string';
}
