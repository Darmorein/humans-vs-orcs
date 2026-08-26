import { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import { Building, type BuildingType } from '../Entities/Building';
import { ResourceNode } from '../Entities/ResourceNode';
import type { MatchState } from '../Players/MatchState';
import type { SettlementSystem } from '../Settlement/SettlementSystem';
import type { SquadSystem } from '../Combat/SquadSystem';
import { isCombatUnitType } from '../Combat/Squad';
import type { HeroSystem } from '../Heroes/HeroSystem';
import type { ArtifactSystem } from '../Artifacts/ArtifactSystem';
import type { WorldHistory } from '../WorldHistory/WorldHistory';
import type { GameRng } from './GameRng';
import type { GameStateSnapshot } from './serializeState';
import { restoreIdAllocators } from './IdAllocators';

export interface HydrateTarget {
  entities: Entity[];
  match: MatchState;
  settlements: SettlementSystem;
  squads: SquadSystem;
  rng: GameRng;
  setSimTick: (tick: number) => void;
  unitOptions: (type: string) => {
    hp: number;
    speed: number;
    unitType: string;
    damage: number;
    range: number;
  };
  heroes?: HeroSystem;
  artifacts?: ArtifactSystem;
  history?: WorldHistory;
}

/**
 * Best-effort restore from GameStateSnapshot.
 * Mid-game fidelity: entities, settlements (citizens/queue), squads, heroes, artifacts, history.
 */
export function hydrateFromSnapshot(snap: GameStateSnapshot, target: HydrateTarget): void {
  for (const p of snap.players) {
    const player = target.match.getPlayer(p.id);
    if (!player) continue;
    player.gold = p.gold;
    player.pop = p.pop;
    player.maxPop = p.maxPop;
    player.isDefeated = p.isDefeated;
  }

  target.rng.setState(snap.rngState);
  target.setSimTick(snap.simTick);

  const maxId = snap.entities.reduce((m, e) => Math.max(m, e.id), 0);
  Entity.resetIdCounter(0);

  target.entities.length = 0;
  target.squads.clearAll();

  const hasSquadSnap = Array.isArray(snap.squads);

  for (const e of snap.entities) {
    if (e.kind === 'resource') {
      const amount = e.resourceAmount ?? 5000;
      const node = new ResourceNode(e.x, e.y, amount);
      node.assignId(e.id);
      node.hp = e.hp;
      node.maxHp = e.maxHp;
      node.resourceAmount = amount;
      target.entities.push(node);
      continue;
    }

    if (e.kind === 'building' && e.buildingType && e.ownerPlayerId) {
      const player = target.match.getPlayer(e.ownerPlayerId);
      if (!player) continue;
      const b = new Building(
        e.x,
        e.y,
        e.buildingType as BuildingType,
        player,
        e.isConstructed !== false,
      );
      b.assignId(e.id);
      b.hp = e.hp;
      b.maxHp = e.maxHp;
      if (typeof e.maxConstructionProgress === 'number') {
        b.maxConstructionProgress = e.maxConstructionProgress;
      }
      if (typeof e.constructionProgress === 'number') {
        b.constructionProgress = e.constructionProgress;
      }
      if (e.settlementId !== undefined) {
        b.settlementId = e.settlementId;
      }
      target.entities.push(b);
      continue;
    }

    if (e.kind === 'unit' && e.unitType && e.ownerPlayerId) {
      const player = target.match.getPlayer(e.ownerPlayerId);
      if (!player) continue;
      const opts = target.unitOptions(e.unitType);
      const u = new Unit(e.x, e.y, player, opts);
      u.assignId(e.id);
      u.hp = e.hp;
      u.maxHp = e.maxHp;
      u.heroId = e.heroId ?? null;
      u.artifactId = e.artifactId ?? null;
      u.personalXp = e.personalXp ?? 0;
      u.prestige = e.prestige ?? 0;
      u.killCount = e.killCount ?? 0;
      u.isHero = e.isHero ?? !!e.heroId;
      u.heroName = e.heroName ?? null;
      if (hasSquadSnap) {
        u.squadId = e.squadId ?? null;
      }
      target.entities.push(u);
      if (!hasSquadSnap && isCombatUnitType(u.unitType)) {
        target.squads.registerUnit(u);
      }
    }
  }

  target.settlements.hydrateFromSnapshot(snap.settlements, target.match);

  if (hasSquadSnap && snap.squads) {
    target.squads.hydrateFromSnapshot(snap.squads);
  }

  if (target.heroes && snap.heroes) {
    target.heroes.replaceAll(snap.heroes);
  }

  if (target.artifacts && snap.artifacts) {
    target.artifacts.replaceAll(snap.artifacts);
  }

  if (target.history && snap.historyEvents) {
    target.history.replaceEvents(snap.historyEvents);
  }

  if (snap.idAllocators) {
    restoreIdAllocators(snap.idAllocators);
  } else {
    Entity.resetIdCounter(maxId + 1);
  }
}
