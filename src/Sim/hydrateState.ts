import { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import { Building, type BuildingType } from '../Entities/Building';
import { ResourceNode } from '../Entities/ResourceNode';
import type { MatchState } from '../Players/MatchState';
import type { SettlementSystem } from '../Settlement/SettlementSystem';
import type { SquadSystem } from '../Combat/SquadSystem';
import { isCombatUnitType } from '../Combat/Squad';
import type { GameRng } from './GameRng';
import type { GameStateSnapshot } from './serializeState';

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
}

/**
 * Best-effort restore from GameStateSnapshot.
 * Enough for Save/Load; not a claim of bit-identical replay.
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

  for (const e of snap.entities) {
    if (e.kind === 'resource') {
      const node = new ResourceNode(e.x, e.y, 5000);
      node.assignId(e.id);
      node.hp = e.hp;
      node.maxHp = e.maxHp;
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
      if (e.heroId) u.isHero = true;
      target.entities.push(u);
      if (isCombatUnitType(u.unitType)) target.squads.registerUnit(u);
    }
  }

  Entity.resetIdCounter(maxId + 1);
  target.settlements.hydrateFromSnapshot(snap.settlements, target.match);
}
