import type { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import { Building } from '../Entities/Building';
import { ResourceNode } from '../Entities/ResourceNode';
import type { MatchState } from '../Players/MatchState';
import type { SettlementSystem } from '../Settlement/SettlementSystem';
import type { GameRng } from './GameRng';
import { GAME_STATE_VERSION } from './SimClock';
import type { GameCommand } from './Commands';

/** JSON-friendly snapshot for future netcode / replay / desync checks. */
export interface GameStateSnapshot {
  version: typeof GAME_STATE_VERSION;
  seed: number;
  simTick: number;
  rngState: number;
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
    squadId?: string | null;
    heroId?: string | null;
    artifactId?: string | null;
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
  }>;
  pendingCommands: GameCommand[];
}

export function serializeGameState(args: {
  seed: number;
  simTick: number;
  rng: GameRng;
  match: MatchState;
  entities: Entity[];
  settlements: SettlementSystem;
  pendingCommands: GameCommand[];
}): GameStateSnapshot {
  return {
    version: GAME_STATE_VERSION,
    seed: args.seed,
    simTick: args.simTick,
    rngState: args.rng.getState(),
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
    })),
    pendingCommands: args.pendingCommands.map((c) => ({ ...c })),
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
    return {
      ...base,
      kind: 'unit' as const,
      unitType: e.unitType,
      squadId: e.squadId,
      heroId: e.heroId,
      artifactId: e.artifactId,
    };
  }
  if (e instanceof Building) {
    return {
      ...base,
      kind: 'building' as const,
      buildingType: e.buildingType,
      isConstructed: e.isConstructed,
    };
  }
  if (e instanceof ResourceNode) {
    return { ...base, kind: 'resource' as const };
  }
  return { ...base, kind: 'other' as const };
}
