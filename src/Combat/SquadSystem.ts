import type { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import type { GameMap } from '../Map/GameMap';
import type { InfluenceMap } from '../Map/InfluenceMap';
import type { MatchState } from '../Players/MatchState';
import { isHostile } from '../Players/Relations';
import {
  isCombatUnitType,
  Squad,
  type CombatUnitType,
  type SquadFormation,
  SQUAD_MAX_SIZE,
} from './Squad';
import { FORMATION_DEFS } from './FormationDefs';
import { formationOffsets, orientOffsets } from './Formations';
import {
  clampMorale,
  MORALE_EVENT,
  MORALE_MAX,
  RALLY_THRESHOLD,
  ROUT_THRESHOLD,
} from './Morale';
import { isFlanking, assessHoldPosition } from './TacticalTerrain';
import { doctrineOf } from '../Players/FactionDoctrine';
import { preferHeroLeader } from '../Heroes/HeroSystem';

let nextSquadId = 1;

export interface SquadUpdateContext {
  entities: Entity[];
  gameMap?: GameMap;
  influence?: InfluenceMap;
  match?: MatchState;
}

/**
 * Maintains combat Squads. Player orders go through squads;
 * Unit.moveCommand / attackCommand remain available for AI and micro.
 * Morale 0–100; critical → ROUT (flee, ignore normal orders).
 */
export class SquadSystem {
  private squads = new Map<string, Squad>();

  public all(): Squad[] {
    return [...this.squads.values()];
  }

  public get(id: string): Squad | undefined {
    return this.squads.get(id);
  }

  public getForUnit(unit: Unit): Squad | undefined {
    if (!unit.squadId) return undefined;
    return this.squads.get(unit.squadId);
  }

  public squadsForOwner(playerId: string): Squad[] {
    return this.all().filter((s) => s.ownerPlayerId === playerId);
  }

  /** Wipe squads for save/load hydrate. */
  public clearAll() {
    this.squads.clear();
    nextSquadId = 1;
  }

  public registerUnit(unit: Unit): Squad | null {
    if (!isCombatUnitType(unit.unitType)) return null;
    if (!unit.ownerPlayerId) return null;
    if (unit.squadId && this.squads.has(unit.squadId)) return this.squads.get(unit.squadId)!;

    const open = this.findOpenSquad(unit.ownerPlayerId, unit.unitType);
    const squad = open ?? this.createSquad(unit.ownerPlayerId, unit.unitType);

    squad.memberIds.push(unit.id);
    unit.squadId = squad.id;
    if (squad.leaderId == null) {
      squad.leaderId = unit.id;
    }
    if (unit.factionId === 'humans' || unit.factionId === 'orcs') {
      squad.formation = doctrineOf(unit.factionId).defaultFormation;
    }
    squad.lastMemberCount = squad.memberIds.length;
    squad.lastLeaderId = squad.leaderId;
    this.recomputeStats(squad, [unit]);
    return squad;
  }

  /** Credit a kill to the attacker's squad (victory morale). */
  public notifyKill(killer: Entity | null | undefined) {
    if (!(killer instanceof Unit) || !killer.squadId) return;
    const squad = this.squads.get(killer.squadId);
    if (!squad) return;
    const fid = killer.factionId === 'orcs' ? 'orcs' : 'humans';
    const d = doctrineOf(fid);
    squad.victories += 1;
    squad.morale = clampMorale(
      squad.morale + MORALE_EVENT.victory * d.victoryMoraleMul * d.raidVictoryBonus,
    );
    squad.experience = Math.min(100, squad.experience + 3 * d.militaryTraditionGain);
  }

  public update(dt: number, ctx: SquadUpdateContext | Entity[]) {
    const context: SquadUpdateContext = Array.isArray(ctx) ? { entities: ctx } : ctx;
    const { entities, gameMap, influence, match } = context;

    for (const e of entities) {
      if (e instanceof Unit && isCombatUnitType(e.unitType) && !e.squadId) {
        this.registerUnit(e);
      }
    }

    const unitsById = this.unitMap(entities);

    for (const squad of this.all()) {
      this.pruneMembers(squad, unitsById);
      if (squad.memberIds.length === 0) {
        this.squads.delete(squad.id);
        continue;
      }
      this.ensureLeader(squad, unitsById);
      const members = this.membersOf(squad, unitsById);
      this.tickMoraleAndXp(squad, members, dt, entities, gameMap, influence, match);
      this.applyRoutState(squad, members);
      this.recomputeStats(squad, members);
      if (squad.routing) this.driveFlee(squad, members, entities);
    }
  }

  public orderMove(squad: Squad, x: number, y: number, entities: Entity[]) {
    if (squad.routing) return;
    const units = this.livingMembers(squad, entities);
    if (units.length === 0) return;

    const center = squad.centroid(this.unitMap(entities));
    const dx = center ? x - center.x : 0;
    const dy = center ? y - center.y : 1;
    this.setFacing(squad, dx, dy);

    const offsets = orientOffsets(formationOffsets(squad.formation, units.length), dx, dy);
    const fx = FORMATION_DEFS[squad.formation];

    units.sort((a, b) => {
      if (a.id === squad.leaderId) return -1;
      if (b.id === squad.leaderId) return 1;
      return a.id - b.id;
    });

    for (let i = 0; i < units.length; i++) {
      const o = offsets[i] ?? { x: 0, y: 0 };
      const u = units[i]!;
      u.moveCommand(x + o.x, y + o.y);
      if (fx.id === 'charge') u.chargeStrikeReady = true;
      u.facingX = squad.facingX;
      u.facingY = squad.facingY;
    }
  }

  public orderAttack(squad: Squad, target: Entity, entities: Entity[]) {
    if (squad.routing) return;
    const units = this.livingMembers(squad, entities);
    if (units.length === 0) return;

    const center = squad.centroid(this.unitMap(entities));
    if (center) this.setFacing(squad, target.x - center.x, target.y - center.y);

    const fx = FORMATION_DEFS[squad.formation];
    for (const u of units) {
      u.attackCommand(target);
      u.facingX = squad.facingX;
      u.facingY = squad.facingY;
      if (fx.id === 'charge') u.chargeStrikeReady = true;
    }
  }

  public setFormation(squad: Squad, formation: SquadFormation, entities?: Entity[]) {
    if (squad.routing) return;
    squad.formation = formation;
    if (!entities) return;
    const center = squad.centroid(this.unitMap(entities));
    if (!center) return;
    this.orderMove(squad, center.x, center.y, entities);
  }

  private setFacing(squad: Squad, dx: number, dy: number) {
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    squad.facingX = dx / len;
    squad.facingY = dy / len;
  }

  public squadsFromSelection(selected: Entity[]): Squad[] {
    const seen = new Set<string>();
    const out: Squad[] = [];
    for (const e of selected) {
      if (!(e instanceof Unit) || !e.squadId) continue;
      if (seen.has(e.squadId)) continue;
      const s = this.squads.get(e.squadId);
      if (!s) continue;
      seen.add(e.squadId);
      out.push(s);
    }
    return out;
  }

  public expandSelectionToSquads(selected: Entity[], entities: Entity[]): Entity[] {
    const unitsById = this.unitMap(entities);
    const result: Entity[] = [];
    const seen = new Set<number>();
    const squadSeen = new Set<string>();

    for (const e of selected) {
      if (!(e instanceof Unit)) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          result.push(e);
        }
        continue;
      }

      if (!e.squadId || !this.squads.has(e.squadId)) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          result.push(e);
        }
        continue;
      }

      if (squadSeen.has(e.squadId)) continue;
      squadSeen.add(e.squadId);
      const squad = this.squads.get(e.squadId)!;
      for (const id of squad.memberIds) {
        const u = unitsById.get(id);
        if (!u || u.isDead || seen.has(u.id)) continue;
        seen.add(u.id);
        u.selected = true;
        result.push(u);
      }
    }
    return result;
  }

  private createSquad(ownerPlayerId: string, unitType: CombatUnitType): Squad {
    const id = `sq-${nextSquadId++}`;
    const squad = new Squad(id, ownerPlayerId, unitType, SQUAD_MAX_SIZE);
    this.squads.set(id, squad);
    return squad;
  }

  private findOpenSquad(ownerPlayerId: string, unitType: CombatUnitType): Squad | undefined {
    return this.all().find(
      (s) => s.ownerPlayerId === ownerPlayerId && s.unitType === unitType && !s.isFull,
    );
  }

  private unitMap(entities: Entity[]): Map<number, Unit> {
    const m = new Map<number, Unit>();
    for (const e of entities) {
      if (e instanceof Unit && !e.isDead) m.set(e.id, e);
    }
    return m;
  }

  private membersOf(squad: Squad, unitsById: Map<number, Unit>): Unit[] {
    const out: Unit[] = [];
    for (const id of squad.memberIds) {
      const u = unitsById.get(id);
      if (u) out.push(u);
    }
    return out;
  }

  private livingMembers(squad: Squad, entities: Entity[]): Unit[] {
    return this.membersOf(squad, this.unitMap(entities));
  }

  private pruneMembers(squad: Squad, unitsById: Map<number, Unit>) {
    squad.memberIds = squad.memberIds.filter((id) => {
      const u = unitsById.get(id);
      if (!u || u.isDead) return false;
      u.squadId = squad.id;
      return true;
    });
  }

  private ensureLeader(squad: Squad, unitsById: Map<number, Unit>) {
    if (squad.leaderId != null && unitsById.has(squad.leaderId)) return;
    const members = squad.memberIds
      .map((id) => unitsById.get(id))
      .filter((u): u is Unit => !!u);
    const pick = preferHeroLeader(members);
    squad.leaderId = pick?.id ?? null;
  }

  private applyRoutState(squad: Squad, members: Unit[]) {
    if (!squad.routing && squad.morale <= ROUT_THRESHOLD) {
      squad.routing = true;
    } else if (squad.routing && squad.morale >= RALLY_THRESHOLD) {
      squad.routing = false;
    }
    for (const u of members) {
      u.isRouting = squad.routing;
      if (squad.routing) u.clearCombatFocus();
    }
  }

  private driveFlee(squad: Squad, members: Unit[], entities: Entity[]) {
    const center = squad.centroid(this.unitMap(entities));
    if (!center || members.length === 0) return;

    let ex = 0;
    let ey = 0;
    let n = 0;
    for (const e of entities) {
      if (!(e instanceof Unit) || e.isDead) continue;
      if (!isHostile(members[0]!, e)) continue;
      const d = Math.hypot(e.x - center.x, e.y - center.y);
      if (d > 380) continue;
      ex += e.x;
      ey += e.y;
      n++;
    }

    let fx: number;
    let fy: number;
    if (n > 0) {
      fx = center.x - ex / n;
      fy = center.y - ey / n;
    } else {
      fx = -squad.facingX || 1;
      fy = -squad.facingY || 0;
    }
    const len = Math.hypot(fx, fy) || 1;
    fx /= len;
    fy /= len;

    const destX = center.x + fx * 220;
    const destY = center.y + fy * 220;
    for (const u of members) {
      if (
        u.targetX == null ||
        Math.hypot((u.targetX ?? 0) - destX, (u.targetY ?? 0) - destY) > 80
      ) {
        u.moveCommand(destX + (Math.random() - 0.5) * 40, destY + (Math.random() - 0.5) * 40);
      }
    }
  }

  private recomputeStats(squad: Squad, members: Unit[]) {
    if (members.length === 0) return;
    let speed = 0;
    let dmg = 0;
    let range = 0;
    let def = 0;
    for (const u of members) {
      speed += u.speed;
      dmg += u.damage;
      range += u.attackRange;
      def += u.hp / Math.max(1, u.maxHp);
    }
    const n = members.length;
    const fx = FORMATION_DEFS[squad.formation];
    const xpBonus = 1 + squad.experience * 0.002;
    const morale01 = squad.morale / MORALE_MAX;
    const moraleMul = squad.routing ? 0.55 : 0.85 + morale01 * 0.3;

    squad.movementSpeed = (speed / n) * fx.speedMul * (squad.routing ? 1.2 : 1);
    squad.attackStrength = (dmg / n) * xpBonus * moraleMul;
    squad.range = range / n;
    squad.defense = (def / n) * (2 - fx.meleeTakenMul);

    for (const u of members) {
      u.squadAttackMul = moraleMul * xpBonus;
      u.squadSpeedMul =
        (0.92 + morale01 * 0.16) * fx.speedMul * (squad.routing ? 1.25 : 1);
      u.holdGround = fx.holdGround && !squad.routing;
      u.formationMeleeTakenMul = fx.meleeTakenMul;
      u.formationRangedTakenMul = fx.rangedTakenMul;
      u.formationFrontalDefense = fx.frontalDefense;
      u.formationFirstContactMul = fx.firstContactMul;
      u.facingX = squad.facingX;
      u.facingY = squad.facingY;
      u.isRouting = squad.routing;
      if (fx.id !== 'charge' && fx.firstContactMul <= 1) u.chargeStrikeReady = false;
    }
  }

  private tickMoraleAndXp(
    squad: Squad,
    members: Unit[],
    dt: number,
    entities: Entity[],
    gameMap?: GameMap,
    influence?: InfluenceMap,
    match?: MatchState,
  ) {
    const fx = FORMATION_DEFS[squad.formation];
    const center = squad.centroid(this.unitMap(entities));
    const owner = match?.getPlayer(squad.ownerPlayerId);
    const d = doctrineOf(owner?.factionId ?? 'humans');
    let delta = 0;

    const deaths = Math.max(0, squad.lastMemberCount - members.length);
    if (deaths > 0) delta -= deaths * MORALE_EVENT.memberDeath;

    if (squad.lastLeaderId != null && !members.some((m) => m.id === squad.lastLeaderId)) {
      delta -= MORALE_EVENT.leaderDeath;
      delta -= MORALE_EVENT.heroDeath * 0.5;
    }
    squad.lastMemberCount = members.length;
    squad.lastLeaderId = squad.leaderId;

    let inCombat = false;
    let enemiesNear = 0;
    let alliesNear = members.length;
    let flanked = false;
    let allyRouting = false;

    if (center && members[0]) {
      for (const e of entities) {
        if (!(e instanceof Unit) || e.isDead) continue;
        const d = Math.hypot(e.x - center.x, e.y - center.y);
        if (d > 320) continue;

        if (isHostile(members[0], e)) {
          enemiesNear++;
          if (
            isFlanking(e.x, e.y, center.x, center.y, squad.facingX, squad.facingY)
          ) {
            flanked = true;
          }
          if (d < 160) inCombat = true;
        } else if (e.ownerPlayerId === squad.ownerPlayerId && e.squadId !== squad.id) {
          alliesNear++;
          if (e.isRouting) allyRouting = true;
        }
      }
    }

    for (const u of members) {
      if (u.targetEntity && !u.targetEntity.isDead) inCombat = true;
    }

    if (flanked) delta -= 7 * dt;
    if (enemiesNear > alliesNear * 1.4 && enemiesNear >= 3) {
      delta -= 5.5 * dt * Math.min(2, enemiesNear / Math.max(1, alliesNear));
    }
    if (allyRouting) delta -= MORALE_EVENT.allyRoutNearby * dt * 0.7;

    if (inCombat) {
      squad.experience = Math.min(100, squad.experience + dt * 1.2);
      delta -= (1.2 + fx.moraleDrain) * dt;
    } else {
      delta += (1.5 + fx.moraleBonus) * dt;
    }

    delta += (squad.experience / 100) * 2.2 * dt;

    const heroAlive = members.some((m) => m.isHero || m.id === squad.leaderId);
    if (heroAlive) delta += 2.4 * dt * d.heroMoraleMul;

    if (center && influence && match) {
      const player = match.getPlayer(squad.ownerPlayerId);
      if (player) {
        const ctrl = influence.getControlAt(center.x, center.y);
        if (ctrl === player.factionId) delta += 4 * dt * d.territoryMoraleMul;
        else if (ctrl === 'contested') delta += 0.5 * dt;
        else if (ctrl !== 'none') delta -= 2 * dt;
      }
    }

    if (center && gameMap) {
      const hold = assessHoldPosition(gameMap, center.x, center.y, {
        isRanged: members.some((m) => m.isRanged),
        enemiesNearby: enemiesNear,
      });
      squad.lastTacticalScore = hold.total;
      squad.lastTacticalSummary = hold.factors
        .slice()
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
        .slice(0, 3)
        .map((f) => `${f.label} ${f.score > 0 ? '+' : ''}${f.score}`)
        .join(', ');
      delta += (hold.total / 20) * dt;
      if (hold.factors.some((f) => f.id === 'exposedArchers')) {
        delta -= 2 * dt;
      }
    }

    delta += Math.min(3, squad.victories * 0.15) * dt;

    if (squad.routing) {
      if (enemiesNear > 0) delta -= 2 * dt;
      else delta += 5 * dt;
    }

    squad.morale = clampMorale(squad.morale + delta);
  }
}
