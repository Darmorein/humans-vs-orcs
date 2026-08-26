/**
 * Living Settlement Core — autonomous village + construction queue.
 */
export { Settlement } from './Settlement';
export { SettlementSystem } from './SettlementSystem';
export { SettlementPlanner, settlementPlanner } from './SettlementPlanner';
export { ConstructionQueue } from './ConstructionQueue';
export type { ConstructionProject, ProjectStatus } from './ConstructionQueue';
export {
  getRecipe,
  strategicOptionsForFaction,
  autonomousFarmForFaction,
  type ConstructionCategory,
  type ConstructionTarget,
  type ConstructionCosts,
  type ConstructionRecipe,
} from './ConstructionCatalog';
export {
  SETTLEMENT_LAYOUTS,
  pickLayoutForId,
  type SettlementLayoutId,
  type SettlementLayoutProfile,
} from './LayoutVariants';
export type {
  SettlementFocus,
  SettlementSpecialization,
} from './SettlementFocus';
export {
  SETTLEMENT_FOCUSES,
  settlementFocusLabel,
  specializationLabel,
  focusNeedBias,
} from './SettlementFocus';
export type {
  SettlementCapacity,
  SettlementNeedKind,
  SettlementNeeds,
  SettlementResources,
} from './Types';
export {
  populationSim,
  type Citizen,
  type ProfessionRole,
  type CitizenTrait,
  professionLabel,
  HUMAN_PROFESSION_LABELS,
  ORC_PROFESSION_LABELS,
} from './Population';
export {
  TIER_DEFS,
  TIER_ORDER,
  evaluateTier,
  isBuildingAllowed,
  type SettlementTier,
} from './SettlementTier';
export {
  SETTLER_CITIZENS,
  SETTLER_WORKERS,
  SETTLER_GOLD_COST,
  SETTLER_MIN_PARENT_POP,
  SETTLER_CARAVAN_SPEED,
  type SettlerGroup,
} from './SettlerGroup';
export { civilianVisualAgents, CivilianVisualAgents } from './CivilianVisualAgents';
export type { SettlementIncomeSources } from './Settlement';
export { emptyIncomeSources } from './Settlement';
