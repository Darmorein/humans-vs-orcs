/**
 * Squad-centric combat control — orders to groups, agents still simulate.
 */
export { Squad, isCombatUnitType, squadDisplayName, SQUAD_MAX_SIZE } from './Squad';
export type { CombatUnitType, SquadOrderMode } from './Squad';
export type { SquadFormation } from './FormationDefs';
export {
  ALL_FORMATIONS,
  FORMATION_DEFS,
  formationLabel,
} from './FormationDefs';
export { SquadSystem } from './SquadSystem';
export type { SquadUpdateContext } from './SquadSystem';
export { formationOffsets, orientOffsets } from './Formations';
export {
  FORMATION_BASE_SPACING,
  CHOKE_COMPRESS_MUL,
  COMBAT_LEASH,
  findNearestValidFormationPoint,
  isValidFormationPoint,
} from './SquadMarch';
export {
  allSquadTemplates,
  getSquadTemplate,
  squadTemplatesForFaction,
  defaultMeleeSquadTemplate,
  defaultRangedSquadTemplate,
} from './SquadTemplates';
export type { SquadTemplate } from './SquadTemplates';
export { MilitaryRecruitmentSystem } from './MilitaryRecruitment';
export type { MilitaryJob, MilitaryJobSnapshot } from './MilitaryRecruitment';
export {
  MORALE_MAX,
  MORALE_DEFAULT,
  ROUT_THRESHOLD,
  RALLY_THRESHOLD,
  clampMorale,
} from './Morale';
export {
  assessHoldPosition,
  assessEngagement,
  isFlanking,
  pickBestHoldPoint,
  gatherTacticalCandidates,
  damageMultiplierFromScore,
} from './TacticalTerrain';
export type { TacticalAssessment, TacticalFactor } from './TacticalTerrain';
