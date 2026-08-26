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
import { populationSim } from '../Settlement/Population/PopulationSim';
import type { SoftSimState } from './SoftSimState';

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
  /** Optional restore of AI controller soft timers. */
  restoreAiSoft?: (rows: SoftSimState['ai']) => void;
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
    if (p.taxPolicy === 'low' || p.taxPolicy === 'normal' || p.taxPolicy === 'high' || p.taxPolicy === 'war') {
      player.taxPolicy = p.taxPolicy;
    }
    if (typeof p.lastTaxChangeTick === 'number') {
      player.lastTaxChangeTick = p.lastTaxChangeTick;
    }
    if (typeof p.treasuryIncomeRate === 'number') {
      player.treasuryIncomeRate = p.treasuryIncomeRate;
    }
    if (Array.isArray(p.taxContributions)) {
      player.taxContributions = p.taxContributions.map((c) => ({ ...c }));
    }
    if (p.capitalSettlementId !== undefined) {
      player.capitalSettlementId = p.capitalSettlementId;
    }
  }

  if (typeof snap.matchElapsedSec === 'number') {
    target.match.matchElapsedSec = snap.matchElapsedSec;
  }
  if (typeof snap.dominancePhase === 'boolean') {
    target.match.dominancePhase = snap.dominancePhase;
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
      const amount = e.remainingAmount ?? e.resourceAmount ?? 5000;
      const node = new ResourceNode(e.x, e.y, amount);
      node.assignId(e.id);
      node.hp = e.hp;
      node.maxHp = e.maxHp;
      node.remainingAmount = amount;
      node.resourceAmount = amount;
      node.linkedSettlementId = e.linkedSettlementId ?? null;
      node.controllingFactionId =
        (e.controllingFactionId as import('../Players/Types').FactionId | null) ?? null;
      node.infrastructureLevel = e.infrastructureLevel ?? 0;
      node.safety = e.resourceSafety ?? 1;
      node.raidDamageCooldown = e.raidDamageCooldown ?? 0;
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
      // Legacy workers handled after settlements hydrate (see below).
      if (e.unitType === 'Worker' || e.unitType === 'Peon') {
        continue;
      }
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

  // Second pass: wire unit order targets now that all entities exist.
  const byId = new Map<number, Entity>();
  for (const ent of target.entities) byId.set(ent.id, ent);
  for (const e of snap.entities) {
    if (e.kind !== 'unit') continue;
    if (e.unitType === 'Worker' || e.unitType === 'Peon') continue;
    const u = byId.get(e.id);
    if (!(u instanceof Unit)) continue;
    u.restoreRuntime(
      {
        ...e,
        agentTraits: e.agentTraits as import('../Heroes/Types').AgentTrait[] | undefined,
      },
      (id: number) => byId.get(id) ?? null,
      e.gatherTargetId,
      e.buildTargetId,
      e.attackTargetId,
    );
  }

  target.settlements.hydrateFromSnapshot(snap.settlements, target.match);
  if (snap.settlerGroups) {
    target.settlements.hydrateSettlerMissions(snap.settlerGroups as any, snap.transitCitizens);
  }

  // Convert legacy Worker/Peon units into civic population (despawn from map).
  for (const e of snap.entities) {
    if (e.kind !== 'unit') continue;
    if (e.unitType !== 'Worker' && e.unitType !== 'Peon') continue;
    if (!e.ownerPlayerId) continue;
    const seat =
      target.settlements.get(e.ownerPlayerId) ??
      target.settlements.allForOwner(e.ownerPlayerId)[0];
    if (!seat) continue;
    seat.citizens.push({
      id: `c-migrated-${e.id}`,
      age: 22,
      profession: 'peasant',
      settlementId: seat.id,
      health: 0.85,
      experience: 4,
      traits: ['industrious'],
      prestige: 0,
      heroId: null,
    });
    seat.population = seat.citizens.length;
    if (e.heldGold) {
      // Legacy carried gold → settlement local stock (not Faction Treasury sync).
      seat.gold += e.heldGold;
    }
  }

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

  if (snap.softState) {
    const soft = snap.softState;
    populationSim.setAccum(soft.populationAccum);
    if (target.heroes) {
      target.heroes.restoreSoftTimers(soft.heroElapsed, soft.heroEvalTimer);
    }
    if (target.artifacts) {
      target.artifacts.restoreSoftTimers(
        soft.artifactElapsed,
        soft.artifactForgeTimer,
        soft.artifactForgeCooldowns,
      );
    }
    if (target.history) {
      target.history.restoreSoftTimers(soft.historyElapsed, soft.historyTerritoryTimer);
      target.history.clearEphemeralClusters?.();
    }
    target.restoreAiSoft?.(soft.ai);
  }

  if (snap.idAllocators) {
    restoreIdAllocators(snap.idAllocators);
  } else {
    Entity.resetIdCounter(maxId + 1);
  }
}
