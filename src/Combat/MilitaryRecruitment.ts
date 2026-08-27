import type { Entity } from '../Entities/Entity';
import { Building, isMainBuilding } from '../Entities/Building';
import { Unit } from '../Entities/Unit';
import type { MatchState } from '../Players/MatchState';
import type { SettlementSystem } from '../Settlement/SettlementSystem';
import type { GameRng } from '../Sim/GameRng';
import { spawnUnitRegistered } from '../Sim/spawnUnit';
import { unitSpawnOptions } from '../Sim/UnitCatalog';
import { formationOffsets, orientOffsets } from './Formations';
import type { SquadSystem } from './SquadSystem';
import type { Squad } from './Squad';
import {
  allSquadTemplates,
  getSquadTemplate,
  reinforceMemberTreasuryCost,
  reinforceTrainTime,
  type SquadTemplate,
} from './SquadTemplates';

let nextJobSeq = 1;

export function getNextRecruitJobSeq(): number {
  return nextJobSeq;
}
export function setNextRecruitJobSeq(n: number) {
  nextJobSeq = Math.max(1, Math.floor(n));
}

function isBarracks(type: Building['buildingType']): boolean {
  return type === 'Barracks' || type === 'OrcBarracks';
}

/** Whether this constructed building may train the given squad template. */
export function buildingCanProduce(building: Building, template: SquadTemplate): boolean {
  if (!building.isConstructed || building.isDead) return false;
  if (template.requiredCapability === 'advanced') return isBarracks(building.buildingType);
  return isMainBuilding(building.buildingType) || isBarracks(building.buildingType);
}

/** Spawn just outside the building footprint (south-east of iso front). */
function musterAnchorOutside(b: Building): { x: number; y: number } {
  const dist = b.radius + 36;
  return {
    x: b.x + dist * 0.75,
    y: b.y + dist * 0.75,
  };
}

export type MilitaryJobKind = 'recruit' | 'reinforce';

/** In-progress military production (squad recruit or reinforce). */
export interface MilitaryJob {
  id: string;
  kind: MilitaryJobKind;
  playerId: string;
  templateId: string;
  buildingId: number;
  settlementId: string;
  /** For reinforce — existing depleted squad. */
  squadId: string | null;
  membersNeeded: number;
  progress: number;
  trainTime: number;
  /** Display name reserved at enqueue (stable for UI). */
  displayName: string;
}

export interface MilitaryJobSnapshot {
  id: string;
  kind: MilitaryJobKind;
  playerId: string;
  templateId: string;
  buildingId: number;
  settlementId: string;
  squadId: string | null;
  membersNeeded: number;
  progress: number;
  trainTime: number;
  displayName: string;
}

/**
 * Squad-centric military production.
 * Each Town Hall / Barracks trains into its own queue slot and spawns at that building.
 */
export class MilitaryRecruitmentSystem {
  private jobs: MilitaryJob[] = [];
  /** Per-owner ordinal for squad naming. */
  private nameOrdinal = new Map<string, number>();

  public list(playerId?: string): MilitaryJob[] {
    if (!playerId) return [...this.jobs];
    return this.jobs.filter((j) => j.playerId === playerId);
  }

  public clear() {
    this.jobs = [];
    this.nameOrdinal.clear();
    nextJobSeq = 1;
  }

  public capture(): MilitaryJobSnapshot[] {
    return this.jobs.map((j) => ({ ...j }));
  }

  public restore(rows: MilitaryJobSnapshot[] | undefined | null) {
    this.jobs = [];
    if (!rows) return;
    for (const r of rows) {
      this.jobs.push({ ...r });
      const n = Number(r.id.replace(/\D/g, '')) || 0;
      if (n >= nextJobSeq) nextJobSeq = n + 1;
    }
  }

  public captureNameOrdinals(): Record<string, number> {
    return Object.fromEntries(this.nameOrdinal);
  }

  public restoreNameOrdinals(m: Record<string, number> | undefined | null) {
    this.nameOrdinal.clear();
    if (!m) return;
    for (const [k, v] of Object.entries(m)) this.nameOrdinal.set(k, v);
  }

  /** One primary reason Recruit Squad would fail. */
  public recruitBlockReason(
    playerId: string,
    templateId: string,
    entities: Entity[],
    match: MatchState,
    settlements: SettlementSystem,
    buildingId?: number,
  ): string | null {
    const player = match.getPlayer(playerId);
    const template = getSquadTemplate(templateId);
    if (!player || !template) return 'Unknown squad type';
    if (template.factionId !== player.factionId) return 'Wrong faction template';
    if (player.pop + template.manpowerCost > player.maxPop) {
      return `Need ${player.pop + template.manpowerCost - player.maxPop} more housing`;
    }
    const muster = this.resolveMusterBuilding(playerId, entities, template, buildingId);
    if (!muster) {
      if (buildingId != null) {
        return template.requiredCapability === 'advanced'
          ? 'This building cannot train that squad'
          : 'Select Town Hall or Barracks';
      }
      return template.requiredCapability === 'advanced'
        ? 'Requires Barracks'
        : 'No muster site';
    }
    if (this.jobs.some((j) => j.buildingId === muster.id)) {
      return 'This building is busy';
    }
    if (player.gold < template.treasuryCost) {
      return `Need ${template.treasuryCost - Math.floor(player.gold)} more Treasury`;
    }
    const draftWhy = settlements.draftBlockReason(
      playerId,
      muster.x,
      muster.y,
      template.manpowerCost,
    );
    if (draftWhy) return draftWhy;
    const active = this.jobs.filter((j) => j.playerId === playerId).length;
    if (active >= this.queueCapacity(playerId, entities)) {
      return 'Recruitment queue full';
    }
    return null;
  }

  public enqueueRecruit(args: {
    playerId: string;
    templateId: string;
    entities: Entity[];
    match: MatchState;
    settlements: SettlementSystem;
    buildingId?: number;
  }): string | null {
    const why = this.recruitBlockReason(
      args.playerId,
      args.templateId,
      args.entities,
      args.match,
      args.settlements,
      args.buildingId,
    );
    if (why) return null;
    const player = args.match.getPlayer(args.playerId)!;
    const template = getSquadTemplate(args.templateId)!;
    const muster = this.resolveMusterBuilding(
      args.playerId,
      args.entities,
      template,
      args.buildingId,
    )!;
    const settlementId = args.settlements.draftForRecruitment(
      args.playerId,
      muster.x,
      muster.y,
      template.manpowerCost,
    );
    if (!settlementId) return null;
    if (!args.match.trySpend(args.playerId, template.treasuryCost)) return null;

    const displayName = this.nextSquadName(args.playerId, template);
    const id = `mj-${nextJobSeq++}`;
    this.jobs.push({
      id,
      kind: 'recruit',
      playerId: args.playerId,
      templateId: template.id,
      buildingId: muster.id,
      settlementId,
      squadId: null,
      membersNeeded: template.targetSize,
      progress: 0,
      trainTime: this.effectiveTrainTime(template, muster),
      displayName,
    });
    void player;
    return id;
  }

  /** One primary reason Reinforce would fail. */
  public reinforceBlockReason(
    playerId: string,
    squadId: string,
    entities: Entity[],
    match: MatchState,
    settlements: SettlementSystem,
    squads: SquadSystem,
  ): string | null {
    const player = match.getPlayer(playerId);
    const squad = squads.get(squadId);
    if (!player || !squad) return 'Squad not found';
    if (squad.ownerPlayerId !== playerId) return 'Not your squad';
    if (squad.memberIds.length === 0) return 'Squad destroyed';
    const missing = Math.max(0, (squad.targetSize || squad.maxSize) - squad.memberIds.length);
    if (missing <= 0) return 'Squad is full';
    if (!this.squadNearFriendlyCity(squad, entities, settlements, playerId)) {
      return 'Must be near friendly city';
    }
    const template = this.templateForSquad(squad);
    if (!template) return 'Unknown squad type';
    const muster = this.resolveMusterBuilding(playerId, entities, template);
    if (!muster) {
      return template.requiredCapability === 'advanced'
        ? 'Requires Barracks'
        : 'No muster site';
    }
    if (this.jobs.some((j) => j.buildingId === muster.id)) {
      return 'Muster building is busy';
    }
    const cost = reinforceMemberTreasuryCost(template, player.factionId) * missing;
    if (player.gold < cost) {
      return `Need ${cost - Math.floor(player.gold)} more Treasury`;
    }
    if (player.pop + missing > player.maxPop) {
      return `Need ${player.pop + missing - player.maxPop} more housing`;
    }
    const draftWhy = settlements.draftBlockReason(playerId, muster.x, muster.y, missing);
    if (draftWhy) return draftWhy;
    if (this.jobs.some((j) => j.squadId === squadId && j.kind === 'reinforce')) {
      return 'Already reinforcing';
    }
    const active = this.jobs.filter((j) => j.playerId === playerId).length;
    if (active >= this.queueCapacity(playerId, entities)) {
      return 'Recruitment queue full';
    }
    return null;
  }

  public enqueueReinforce(args: {
    playerId: string;
    squadId: string;
    entities: Entity[];
    match: MatchState;
    settlements: SettlementSystem;
    squads: SquadSystem;
  }): string | null {
    const why = this.reinforceBlockReason(
      args.playerId,
      args.squadId,
      args.entities,
      args.match,
      args.settlements,
      args.squads,
    );
    if (why) return null;
    const player = args.match.getPlayer(args.playerId)!;
    const squad = args.squads.get(args.squadId)!;
    const template = this.templateForSquad(squad)!;
    const missing = Math.max(0, (squad.targetSize || squad.maxSize) - squad.memberIds.length);
    const muster = this.resolveMusterBuilding(args.playerId, args.entities, template)!;
    const cost = reinforceMemberTreasuryCost(template, player.factionId) * missing;
    const settlementId = args.settlements.draftForRecruitment(
      args.playerId,
      muster.x,
      muster.y,
      missing,
    );
    if (!settlementId) return null;
    if (!args.match.trySpend(args.playerId, cost)) return null;

    const id = `mj-${nextJobSeq++}`;
    this.jobs.push({
      id,
      kind: 'reinforce',
      playerId: args.playerId,
      templateId: template.id,
      buildingId: muster.id,
      settlementId,
      squadId: squad.id,
      membersNeeded: missing,
      progress: 0,
      trainTime: reinforceTrainTime(missing),
      displayName: squad.displayName || template.displayName,
    });
    return id;
  }

  public update(dt: number, ctx: {
    entities: Entity[];
    match: MatchState;
    settlements: SettlementSystem;
    squads: SquadSystem;
    rng: GameRng;
  }) {
    if (this.jobs.length === 0) return;
    const remaining: MilitaryJob[] = [];
    for (const job of this.jobs) {
      job.progress += dt;
      if (job.progress < job.trainTime) {
        remaining.push(job);
        continue;
      }
      if (job.kind === 'recruit') {
        this.completeRecruit(job, ctx);
      } else {
        this.completeReinforce(job, ctx);
      }
    }
    this.jobs = remaining;
  }

  private completeRecruit(
    job: MilitaryJob,
    ctx: {
      entities: Entity[];
      match: MatchState;
      settlements: SettlementSystem;
      squads: SquadSystem;
      rng: GameRng;
    },
  ) {
    const player = ctx.match.getPlayer(job.playerId);
    const template = getSquadTemplate(job.templateId);
    if (!player || !template) return;
    const muster = this.musterPoint(job.buildingId, ctx.entities, player.id);
    const squad = ctx.squads.createClosedSquad({
      ownerPlayerId: job.playerId,
      unitType: template.memberUnitType,
      maxSize: template.targetSize,
      targetSize: template.targetSize,
      displayName: job.displayName,
      templateId: template.id,
    });
    this.spawnMembersIntoSquad({
      squad,
      count: job.membersNeeded,
      template,
      player,
      muster,
      settlementId: job.settlementId,
      entities: ctx.entities,
      squads: ctx.squads,
      rng: ctx.rng,
    });
  }

  private completeReinforce(
    job: MilitaryJob,
    ctx: {
      entities: Entity[];
      match: MatchState;
      settlements: SettlementSystem;
      squads: SquadSystem;
      rng: GameRng;
    },
  ) {
    if (!job.squadId) return;
    const player = ctx.match.getPlayer(job.playerId);
    const squad = ctx.squads.get(job.squadId);
    const template = getSquadTemplate(job.templateId);
    if (!player || !squad || !template) return;
    if (squad.memberIds.length === 0) return; // destroyed while training
    const missing = Math.min(
      job.membersNeeded,
      Math.max(0, (squad.targetSize || squad.maxSize) - squad.memberIds.length),
    );
    if (missing <= 0) return;
    const muster = this.musterPoint(job.buildingId, ctx.entities, player.id);
    this.spawnMembersIntoSquad({
      squad,
      count: missing,
      template,
      player,
      muster,
      settlementId: job.settlementId,
      entities: ctx.entities,
      squads: ctx.squads,
      rng: ctx.rng,
    });
  }

  private spawnMembersIntoSquad(args: {
    squad: Squad;
    count: number;
    template: SquadTemplate;
    player: import('../Players/MatchState').PlayerState;
    muster: { x: number; y: number };
    settlementId: string;
    entities: Entity[];
    squads: SquadSystem;
    rng: GameRng;
  }) {
    const facingX = 0;
    const facingY = 1;
    const offsets = orientOffsets(
      formationOffsets(args.squad.formation, args.count, 28),
      facingX,
      facingY,
    );
    for (let i = 0; i < args.count; i++) {
      const o = offsets[i] ?? { x: (i - args.count / 2) * 20, y: 0 };
      const unit = spawnUnitRegistered({
        player: args.player,
        unitType: args.template.memberUnitType,
        x: args.muster.x + o.x,
        y: args.muster.y + o.y,
        entities: args.entities,
        squads: args.squads,
        options: unitSpawnOptions(args.template.memberUnitType),
        registerOpts: { preferSquadId: args.squad.id },
      });
      unit.draftedFromSettlementId = args.settlementId;
      unit.facingX = facingX;
      unit.facingY = facingY;
    }
  }

  private nextSquadName(playerId: string, template: SquadTemplate): string {
    const key = `${playerId}:${template.id}`;
    const n = (this.nameOrdinal.get(key) ?? 0) + 1;
    this.nameOrdinal.set(key, n);
    const ord = n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
    const short = template.displayName.replace(/ Squad$/i, '');
    return `${ord} ${short}`;
  }

  private templateForSquad(squad: Squad): SquadTemplate | undefined {
    if (squad.templateId) return getSquadTemplate(squad.templateId);
    return allSquadTemplates().find((t) => t.memberUnitType === squad.unitType);
  }

  private musterPoint(
    buildingId: number,
    entities: Entity[],
    playerId: string,
  ): { x: number; y: number } {
    const b = entities.find(
      (e): e is Building => e instanceof Building && e.id === buildingId && !e.isDead,
    );
    if (b) return musterAnchorOutside(b);
    const main = entities.find(
      (e): e is Building =>
        e instanceof Building &&
        !e.isDead &&
        e.ownerPlayerId === playerId &&
        isMainBuilding(e.buildingType),
    );
    if (main) return musterAnchorOutside(main);
    return { x: 0, y: 0 };
  }

  /**
   * Explicit buildingId when the player queued from a selected Town Hall / Barracks.
   * Otherwise pick an idle site that can produce the template (AI / reinforce).
   */
  private resolveMusterBuilding(
    playerId: string,
    entities: Entity[],
    template: SquadTemplate,
    buildingId?: number,
  ): Building | null {
    if (buildingId != null) {
      const b = entities.find(
        (e): e is Building => e instanceof Building && e.id === buildingId && !e.isDead,
      );
      if (!b || b.ownerPlayerId !== playerId || !b.isConstructed) return null;
      if (!buildingCanProduce(b, template)) return null;
      return b;
    }
    return this.findIdleMusterBuilding(playerId, entities, template);
  }

  private findIdleMusterBuilding(
    playerId: string,
    entities: Entity[],
    template: SquadTemplate,
  ): Building | null {
    const sites = this.listMusterBuildings(playerId, entities).filter((b) =>
      buildingCanProduce(b, template),
    );
    const idle = sites.find((b) => !this.jobs.some((j) => j.buildingId === b.id));
    return idle ?? sites[0] ?? null;
  }

  private listMusterBuildings(playerId: string, entities: Entity[]): Building[] {
    const out: Building[] = [];
    for (const e of entities) {
      if (!(e instanceof Building) || e.isDead || !e.isConstructed) continue;
      if (e.ownerPlayerId !== playerId) continue;
      if (isMainBuilding(e.buildingType) || isBarracks(e.buildingType)) {
        out.push(e);
      }
    }
    out.sort((a, b) => {
      const aB = isBarracks(a.buildingType) ? 0 : 1;
      const bB = isBarracks(b.buildingType) ? 0 : 1;
      if (aB !== bB) return aB - bB;
      return a.id - b.id;
    });
    return out;
  }

  /** Each Town Hall / Barracks grants 1 concurrent training slot. */
  private queueCapacity(playerId: string, entities: Entity[]): number {
    return Math.max(1, this.listMusterBuildings(playerId, entities).length);
  }

  /** Training at a Barracks is faster; Town Hall uses base time. */
  private effectiveTrainTime(template: SquadTemplate, muster: Building): number {
    if (isBarracks(muster.buildingType)) {
      return Math.max(6, template.trainTime * 0.72);
    }
    return template.trainTime;
  }

  private squadNearFriendlyCity(
    squad: Squad,
    entities: Entity[],
    settlements: SettlementSystem,
    playerId: string,
  ): boolean {
    const members = squad.memberIds
      .map((id) => entities.find((e) => e instanceof Unit && e.id === id))
      .filter((u): u is Unit => !!u && !u.isDead);
    if (members.length === 0) return false;
    let cx = 0;
    let cy = 0;
    for (const u of members) {
      cx += u.x;
      cy += u.y;
    }
    cx /= members.length;
    cy /= members.length;
    const seats = settlements.allForOwner(playerId);
    for (const s of seats) {
      if (!s.hasTownCenter) continue;
      if (Math.hypot(cx - s.centerX, cy - s.centerY) <= 220) return true;
    }
    return false;
  }
}
