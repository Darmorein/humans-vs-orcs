import { Entity } from '../Entities/Entity';
import { getNextSquadId, setNextSquadId } from '../Combat/SquadSystem';
import { getNextSettlementSeq, setNextSettlementSeq } from '../Settlement/SettlementSystem';
import { getNextHeroSeq, setNextHeroSeq } from '../Heroes/HeroSystem';
import { getNextArtifactSeq, setNextArtifactSeq } from '../Artifacts/ArtifactSystem';
import { getNextCitizenId, setNextCitizenId } from '../Settlement/Population/PopulationSim';
import { getNextProjectId, setNextProjectId } from '../Settlement/ConstructionQueue';
import { getNextRecruitJobSeq, setNextRecruitJobSeq } from '../Combat/MilitaryRecruitment';
import { getNextSettlerGroupId, setNextSettlerGroupId } from '../Settlement/SettlerGroup';

/**
 * Serializable deterministic ID allocator state for save/load / hash.
 * Module counters stay the runtime source; this snapshots them.
 */
export interface IdAllocatorState {
  entityNext: number;
  squadNext: number;
  settlementNext: number;
  heroNext: number;
  artifactNext: number;
  citizenNext: number;
  projectNext: number;
  settlerGroupNext: number;
  recruitJobNext?: number;
}

export function captureIdAllocators(): IdAllocatorState {
  return {
    entityNext: Entity.peekNextId(),
    squadNext: getNextSquadId(),
    settlementNext: getNextSettlementSeq(),
    heroNext: getNextHeroSeq(),
    artifactNext: getNextArtifactSeq(),
    citizenNext: getNextCitizenId(),
    projectNext: getNextProjectId(),
    settlerGroupNext: getNextSettlerGroupId(),
    recruitJobNext: getNextRecruitJobSeq(),
  };
}

export function restoreIdAllocators(state: IdAllocatorState) {
  Entity.resetIdCounter(state.entityNext);
  setNextSquadId(state.squadNext);
  setNextSettlementSeq(state.settlementNext);
  setNextHeroSeq(state.heroNext);
  setNextArtifactSeq(state.artifactNext);
  setNextCitizenId(state.citizenNext);
  setNextProjectId(state.projectNext);
  setNextSettlerGroupId(state.settlerGroupNext);
  if (state.recruitJobNext != null) setNextRecruitJobSeq(state.recruitJobNext);
}
