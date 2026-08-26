import type { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import { Building } from '../Entities/Building';
import { ResourceNode } from '../Entities/ResourceNode';
import type { MatchState } from '../Players/MatchState';
import type { SettlementSystem } from '../Settlement/SettlementSystem';
import type { ConstructionProject } from '../Settlement/ConstructionQueue';
import type { Citizen } from '../Settlement/Population/Types';
import type { SquadSystem } from '../Combat/SquadSystem';
import type { SquadFormation } from '../Combat/Squad';
import type { HeroSystem } from '../Heroes/HeroSystem';
import type { Hero } from '../Heroes/Types';
import type { ArtifactSystem } from '../Artifacts/ArtifactSystem';
import type { Artifact } from '../Artifacts/Types';
import type { WorldHistory } from '../WorldHistory/WorldHistory';
import type { WorldEvent } from '../WorldHistory/Types';
import type { GameRng } from './GameRng';
import { GAME_STATE_VERSION } from './SimClock';
import type { GameCommand } from './Commands';
import { captureIdAllocators, type IdAllocatorState } from './IdAllocators';
import type { SettlementFocus, SettlementSpecialization } from '../Settlement/SettlementFocus';
import type { SoftSimState } from './SoftSimState';
import { emptySoftSimState } from './SoftSimState';

/** Plain squad row for snapshot / hydrate (mirrors Squad fields). */
export interface SquadSnapshot {
  id: string;
  ownerPlayerId: string;
  unitType: string;
  memberIds: number[];
  leaderId: number | null;
  morale: number;
  routing: boolean;
  experience: number;
  victories: number;
  formation: SquadFormation;
  facingX: number;
  facingY: number;
}

/** JSON-friendly snapshot for future netcode / replay / desync checks. */
export interface GameStateSnapshot {
  version: typeof GAME_STATE_VERSION;
  seed: number;
  simTick: number;
  rngState: number;
  idAllocators: IdAllocatorState;
  localPlayerId: string;
  players: Array<{
    id: string;
    factionId: string;
    controllerType: string;
    playerColor: string;
    displayName: string;
    gold: number;
    pop: number;
    maxPop: number;
    isDefeated: boolean;
  }>;
  entities: Array<{
    id: number;
    kind: 'unit' | 'building' | 'resource' | 'other';
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    ownerPlayerId: string | null;
    factionId: string;
    unitType?: string;
    buildingType?: string;
    isConstructed?: boolean;
    constructionProgress?: number;
    maxConstructionProgress?: number;
    settlementId?: string | null;
    resourceAmount?: number;
    remainingAmount?: number;
    linkedSettlementId?: string | null;
    controllingFactionId?: string | null;
    infrastructureLevel?: number;
    resourceSafety?: number;
    raidDamageCooldown?: number;
    squadId?: string | null;
    heroId?: string | null;
    artifactId?: string | null;
    personalXp?: number;
    prestige?: number;
    killCount?: number;
    isHero?: boolean;
    heroName?: string | null;
    heldGold?: number;
    leaguesWalked?: number;
    structuresRaised?: number;
    settlementsFounded?: number;
    settlerGroupId?: string | null;
    draftedFromSettlementId?: string | null;
    targetX?: number | null;
    targetY?: number | null;
    facingX?: number;
    facingY?: number;
    gatherTargetId?: number | null;
    buildTargetId?: number | null;
    attackTargetId?: number | null;
    attackTimer?: number;
    gatherTimer?: number;
    holdGround?: boolean;
    isRouting?: boolean;
    agentTraits?: string[];
    careerLog?: string[];
    path?: Array<{ x: number; y: number }>;
    pathIndex?: number;
  }>;
  settlements: Array<{
    id: string;
    playerId: string;
    tier: string;
    centerX: number;
    centerY: number;
    population: number;
    housing: number;
    gold: number;
    food: number;
    wood: number;
    stone: number;
    iron: number;
    hasTownCenter: boolean;
    citizens?: Citizen[];
    queue?: ConstructionProject[];
    expansionRadius?: number;
    layoutId?: string;
    focus?: SettlementFocus;
    specialization?: SettlementSpecialization;
    warShock?: number;
    incomeRates?: { gold: number; food: number; wood: number; stone: number };
  }>;
  settlerGroups?: Array<{
    id: string;
    ownerPlayerId: string;
    parentSettlementId: string;
    citizenIds: string[];
    unitIds: number[];
    targetX: number | null;
    targetY: number | null;
    status: string;
    caravanX: number;
    caravanY: number;
    caravanSpeed: number;
  }>;
  transitCitizens?: Array<{ groupId: string; citizens: Citizen[] }>;
  squads?: SquadSnapshot[];
  heroes?: Hero[];
  artifacts?: Artifact[];
  historyEvents?: WorldEvent[];
  pendingCommands: GameCommand[];
  /** Soft timers / AI phase for mid-game resume fidelity. */
  softState?: SoftSimState;
}

export function serializeGameState(args: {
  seed: number;
  simTick: number;
  rng: GameRng;
  match: MatchState;
  entities: Entity[];
  settlements: SettlementSystem;
  pendingCommands: GameCommand[];
  squads?: SquadSystem;
  heroes?: HeroSystem;
  artifacts?: ArtifactSystem;
  history?: WorldHistory;
  softState?: SoftSimState;
}): GameStateSnapshot {
  return {
    version: GAME_STATE_VERSION,
    seed: args.seed,
    simTick: args.simTick,
    rngState: args.rng.getState(),
    idAllocators: captureIdAllocators(),
    localPlayerId: args.match.localPlayerId,
    players: args.match.allPlayers().map((p) => ({
      id: p.id,
      factionId: p.factionId,
      controllerType: p.controllerType,
      playerColor: p.playerColor,
      displayName: p.displayName,
      gold: p.gold,
      pop: p.pop,
      maxPop: p.maxPop,
      isDefeated: p.isDefeated,
    })),
    entities: args.entities.filter((e) => !e.isDead).map((e) => serializeEntity(e)),
    settlements: args.settlements.all().map((s) => ({
      id: s.id,
      playerId: s.playerId,
      tier: s.tier,
      centerX: s.centerX,
      centerY: s.centerY,
      population: s.population,
      housing: s.housing,
      gold: s.gold,
      food: s.food,
      wood: s.wood,
      stone: s.stone,
      iron: s.iron,
      hasTownCenter: s.hasTownCenter,
      citizens: s.citizens.map((c) => cloneCitizen(c)),
      queue: s.queue.list().map((p) => cloneProject(p)),
      expansionRadius: s.expansionRadius,
      layoutId: s.layout.id,
      focus: s.focus,
      specialization: s.specialization,
      warShock: s.warShock,
      incomeRates: { ...s.incomeRates },
    })),
    settlerGroups: args.settlements.exportSettlerGroups(),
    transitCitizens: args.settlements.exportTransitCitizens(),
    squads: args.squads
      ? args.squads.all().map((sq) => ({
          id: sq.id,
          ownerPlayerId: sq.ownerPlayerId,
          unitType: sq.unitType,
          memberIds: [...sq.memberIds],
          leaderId: sq.leaderId,
          morale: sq.morale,
          routing: sq.routing,
          experience: sq.experience,
          victories: sq.victories,
          formation: sq.formation,
          facingX: sq.facingX,
          facingY: sq.facingY,
        }))
      : undefined,
    heroes: args.heroes ? args.heroes.all().map((h) => cloneHero(h)) : undefined,
    artifacts: args.artifacts
      ? args.artifacts.all().map((a) => cloneArtifact(a))
      : undefined,
    historyEvents: args.history
      ? args.history.all().map((e) => cloneWorldEvent(e))
      : undefined,
    pendingCommands: args.pendingCommands.map((c) => ({ ...c })),
    softState: args.softState ?? emptySoftSimState(),
  };
}

function serializeEntity(e: Entity): GameStateSnapshot['entities'][number] {
  const base = {
    id: e.id,
    x: e.x,
    y: e.y,
    hp: e.hp,
    maxHp: e.maxHp,
    ownerPlayerId: e.ownerPlayerId,
    factionId: String(e.factionId),
  };
  if (e instanceof Unit) {
    const rt = e.captureRuntime();
    return {
      ...base,
      kind: 'unit' as const,
      unitType: e.unitType,
      squadId: e.squadId,
      heroId: e.heroId,
      artifactId: e.artifactId,
      personalXp: e.personalXp,
      prestige: e.prestige,
      killCount: e.killCount,
      isHero: e.isHero,
      heroName: e.heroName,
      ...rt,
    };
  }
  if (e instanceof Building) {
    return {
      ...base,
      kind: 'building' as const,
      buildingType: e.buildingType,
      isConstructed: e.isConstructed,
      constructionProgress: e.constructionProgress,
      maxConstructionProgress: e.maxConstructionProgress,
      settlementId: e.settlementId,
    };
  }
  if (e instanceof ResourceNode) {
    return {
      ...base,
      kind: 'resource' as const,
      resourceAmount: e.remainingAmount,
      remainingAmount: e.remainingAmount,
      linkedSettlementId: e.linkedSettlementId,
      controllingFactionId: e.controllingFactionId,
      infrastructureLevel: e.infrastructureLevel,
      resourceSafety: e.safety,
      raidDamageCooldown: e.raidDamageCooldown,
    };
  }
  return { ...base, kind: 'other' as const };
}

function cloneCitizen(c: Citizen): Citizen {
  return {
    id: c.id,
    age: c.age,
    profession: c.profession,
    settlementId: c.settlementId,
    health: c.health,
    experience: c.experience,
    traits: [...c.traits],
    prestige: c.prestige,
    heroId: c.heroId ?? null,
  };
}

function cloneProject(p: ConstructionProject): ConstructionProject {
  return {
    ...p,
    roadTiles: p.roadTiles.map((t) => ({ ...t })),
  };
}

function cloneHero(h: Hero): Hero {
  return {
    ...h,
    traits: [...h.traits],
    history: h.history.map((e) => ({ ...e })),
  };
}

function cloneArtifact(a: Artifact): Artifact {
  return {
    ...a,
    effects: a.effects.map((fx) => ({ ...fx })),
    history: a.history.map((e) => ({ ...e })),
  };
}

function cloneWorldEvent(e: WorldEvent): WorldEvent {
  return {
    ...e,
    location: { ...e.location },
    participants: [...e.participants],
  };
}
