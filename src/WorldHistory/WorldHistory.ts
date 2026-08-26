import type { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import type { InfluenceMap } from '../Map/InfluenceMap';
import type { MatchState } from '../Players/MatchState';
import type { SettlementSystem } from '../Settlement/SettlementSystem';
import type { Settlement } from '../Settlement/Settlement';
import {
  HISTORY_IMPORTANCE_FLOOR,
  type WorldEvent,
  type WorldEventLocation,
  type WorldEventType,
} from './Types';

let nextEventSeq = 1;

interface BattleCluster {
  x: number;
  y: number;
  kills: number;
  participants: Set<string>;
  lastKillAt: number;
  recorded: boolean;
}

interface MigrationBucket {
  fromId: string;
  toId: string;
  count: number;
  x: number;
  y: number;
  participants: string[];
  windowUntil: number;
}

/**
 * Records only major world events for the chronicle + event feed.
 */
export class WorldHistory {
  public static active: WorldHistory | null = null;

  private events: WorldEvent[] = [];
  private elapsed = 0;
  private readonly maxEvents = 80;

  private battleClusters: BattleCluster[] = [];
  private migrationBuckets: MigrationBucket[] = [];
  private knownTownCenters = new Set<string>();
  private lastTerritoryLeader: 'humans' | 'orcs' | 'contested' | 'none' = 'none';
  private territoryCheckTimer = 0;

  private listeners = new Set<() => void>();

  public all(): readonly WorldEvent[] {
    return this.events;
  }

  /** Newest first, capped for the feed. */
  public recent(limit = 14): WorldEvent[] {
    return this.events.slice(-limit).reverse();
  }

  public get(id: string): WorldEvent | undefined {
    return this.events.find((e) => e.id === id);
  }

  /** Replace chronicle events from a save snapshot. */
  public replaceEvents(events: WorldEvent[]) {
    this.events = events.map((e) => ({
      ...e,
      location: { ...e.location },
      participants: [...e.participants],
    }));
    let maxSeq = 1;
    for (const e of this.events) {
      const m = /^we-(\d+)$/.exec(e.id);
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]) + 1);
      if (e.timestamp > this.elapsed) this.elapsed = e.timestamp;
      if (e.location.settlementId) this.knownTownCenters.add(e.location.settlementId);
    }
    nextEventSeq = Math.max(nextEventSeq, maxSeq);
    this.notify();
  }

  public captureSoftTimers(): { elapsed: number; territoryCheckTimer: number } {
    return { elapsed: this.elapsed, territoryCheckTimer: this.territoryCheckTimer };
  }

  public restoreSoftTimers(elapsed: number, territoryCheckTimer: number) {
    this.elapsed = elapsed;
    this.territoryCheckTimer = territoryCheckTimer;
  }

  /** Clear ephemeral battle/migration buffers (not snapshotted). */
  public clearEphemeralClusters() {
    this.battleClusters = [];
    this.migrationBuckets = [];
  }

  public onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  public update(
    dt: number,
    settlements: SettlementSystem,
    influence: InfluenceMap,
    match: MatchState,
    mapCenter?: { x: number; y: number },
  ) {
    this.elapsed += dt;
    this.territoryCheckTimer += dt;
    this.pruneBattleClusters();
    this.flushMigrationBuckets();
    this.detectDestroyedSettlements(settlements, match);
    if (this.territoryCheckTimer >= 4.5) {
      this.territoryCheckTimer = 0;
      this.detectTerritoryShift(influence, mapCenter);
    }
  }

  public record(input: {
    type: WorldEventType;
    location: WorldEventLocation;
    participants: string[];
    description: string;
    importance: number;
  }): WorldEvent | null {
    if (input.importance < HISTORY_IMPORTANCE_FLOOR) return null;
    const event: WorldEvent = {
      id: `we-${nextEventSeq++}`,
      timestamp: this.elapsed,
      type: input.type,
      location: { ...input.location },
      participants: [...input.participants],
      description: input.description,
      importance: Math.min(1, input.importance),
    };
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    this.notify();
    return event;
  }

  /**
   * Resolve a focus point if the subject still exists in the world.
   * Pure coordinate events (battles, territory) always resolve.
   */
  public resolveFocus(
    event: WorldEvent,
    entities: Entity[],
    settlements: SettlementSystem,
  ): { x: number; y: number } | null {
    const loc = event.location;
    if (loc.settlementId) {
      const s = settlements.getById(loc.settlementId);
      if (!s || !s.hasTownCenter) return null;
      return { x: s.centerX, y: s.centerY };
    }
    if (loc.unitId != null) {
      const u = entities.find(
        (e): e is Unit => e instanceof Unit && e.id === loc.unitId && !e.isDead,
      );
      if (!u) return null;
      return { x: u.x, y: u.y };
    }
    // Coords-only chronicle entries remain focusable
    if (
      event.type === 'majorBattle' ||
      event.type === 'territoryShift' ||
      event.type === 'settlementDestroyed'
    ) {
      return { x: loc.x, y: loc.y };
    }
    return { x: loc.x, y: loc.y };
  }

  // --- Domain hooks ------------------------------------------------------

  public noteSettlementFounded(s: Settlement, playerName: string) {
    this.knownTownCenters.add(s.id);
    this.record({
      type: 'settlementFounded',
      location: { x: s.centerX, y: s.centerY, settlementId: s.id },
      participants: [playerName, s.id],
      description: `${playerName} founded a new ${s.tier} settlement`,
      importance: 0.75,
    });
  }

  public noteHeroEmerged(
    name: string,
    title: string,
    x: number,
    y: number,
    unitId: number | null,
    settlementId: string | null,
    ownerName: string,
  ) {
    this.record({
      type: 'heroEmerged',
      location: { x, y, unitId, settlementId },
      participants: [name, ownerName],
      description: `${name} rose as ${title}`,
      importance: 0.85,
    });
  }

  public noteHeroDied(name: string, x: number, y: number, unitId: number, killerName?: string) {
    this.record({
      type: 'heroDied',
      location: { x, y, unitId },
      participants: killerName ? [name, killerName] : [name],
      description: killerName ? `${name} fell to ${killerName}` : `${name} fell in battle`,
      importance: 0.9,
    });
  }

  public noteArtifactCreated(
    artName: string,
    quality: string,
    settlement: Settlement,
    creatorId: string,
  ) {
    this.record({
      type: 'artifactCreated',
      location: {
        x: settlement.centerX,
        y: settlement.centerY,
        settlementId: settlement.id,
      },
      participants: [artName, creatorId, settlement.id],
      description: `${quality} artifact ${artName} was forged`,
      importance: 0.8,
    });
  }

  public noteArtifactCaptured(
    artName: string,
    x: number,
    y: number,
    fromFaction: string,
    toFaction: string,
    captor: string,
  ) {
    this.record({
      type: 'artifactCaptured',
      location: { x, y },
      participants: [artName, captor, fromFaction, toFaction],
      description: `${artName} seized by ${captor} (${fromFaction} → ${toFaction})`,
      importance: 0.88,
    });
  }

  public noteCitizenMigrated(
    from: Settlement,
    to: Settlement,
    citizenLabel: string,
  ) {
    const now = this.elapsed;
    let bucket = this.migrationBuckets.find(
      (b) => b.fromId === from.id && b.toId === to.id && b.windowUntil > now,
    );
    if (!bucket) {
      bucket = {
        fromId: from.id,
        toId: to.id,
        count: 0,
        x: (from.centerX + to.centerX) * 0.5,
        y: (from.centerY + to.centerY) * 0.5,
        participants: [],
        windowUntil: now + 35,
      };
      this.migrationBuckets.push(bucket);
    }
    bucket.count += 1;
    bucket.participants.push(citizenLabel);
    bucket.windowUntil = now + 35;
    if (bucket.count >= 3) {
      this.record({
        type: 'majorMigration',
        location: {
          x: to.centerX,
          y: to.centerY,
          settlementId: to.id,
        },
        participants: [from.id, to.id, ...bucket.participants.slice(0, 4)],
        description: `${bucket.count} people migrated toward a more promising settlement`,
        importance: Math.min(0.95, 0.55 + bucket.count * 0.08),
      });
      bucket.count = 0;
      bucket.participants = [];
      bucket.windowUntil = now;
    }
  }

  /** Combat death — may coalesce into a Major Battle. */
  public noteCombatDeath(victim: Unit, killer: Entity | null) {
    const militaryVictim =
      victim.unitType === 'Swordsman' ||
      victim.unitType === 'Archer' ||
      victim.unitType === 'Grunt' ||
      victim.unitType === 'SpearOrc';
    if (!militaryVictim && !(killer instanceof Unit && this.isMilitary(killer))) {
      return;
    }
    const x = victim.x;
    const y = victim.y;
    const now = this.elapsed;
    let cluster = this.battleClusters.find(
      (c) => Math.hypot(c.x - x, c.y - y) < 220 && now - c.lastKillAt < 12,
    );
    if (!cluster) {
      cluster = {
        x,
        y,
        kills: 0,
        participants: new Set(),
        lastKillAt: now,
        recorded: false,
      };
      this.battleClusters.push(cluster);
    }
    cluster.kills += 1;
    cluster.lastKillAt = now;
    cluster.x = (cluster.x * (cluster.kills - 1) + x) / cluster.kills;
    cluster.y = (cluster.y * (cluster.kills - 1) + y) / cluster.kills;
    cluster.participants.add(victim.heroName ?? victim.unitType);
    if (killer instanceof Unit) {
      cluster.participants.add(killer.heroName ?? killer.unitType);
    }
    if (!cluster.recorded && cluster.kills >= 4) {
      cluster.recorded = true;
      const names = [...cluster.participants].slice(0, 6);
      this.record({
        type: 'majorBattle',
        location: { x: cluster.x, y: cluster.y },
        participants: names,
        description: `Major battle erupted (${cluster.kills} fallen nearby)`,
        importance: Math.min(1, 0.55 + cluster.kills * 0.06),
      });
    }
  }

  public seedKnownSettlements(settlements: SettlementSystem) {
    for (const s of settlements.all()) {
      if (s.hasTownCenter) this.knownTownCenters.add(s.id);
    }
  }

  private detectDestroyedSettlements(settlements: SettlementSystem, match: MatchState) {
    for (const id of [...this.knownTownCenters]) {
      const s = settlements.getById(id);
      if (s && s.hasTownCenter) continue;
      this.knownTownCenters.delete(id);
      const player = s ? match.getPlayer(s.playerId) : undefined;
      const x = s?.centerX ?? 0;
      const y = s?.centerY ?? 0;
      this.record({
        type: 'settlementDestroyed',
        location: { x, y },
        participants: player ? [player.displayName, id] : [id],
        description: s
          ? `Settlement at the frontier was destroyed`
          : `A settlement was wiped from the map`,
        importance: 0.92,
      });
    }
    for (const s of settlements.all()) {
      if (s.hasTownCenter) this.knownTownCenters.add(s.id);
    }
  }

  private detectTerritoryShift(
    influence: InfluenceMap,
    mapCenter?: { x: number; y: number },
  ) {
    const h = influence.estimateControlShares('humans');
    const o = influence.estimateControlShares('orcs');
    let leader: 'humans' | 'orcs' | 'contested' | 'none' = 'none';
    if (h.ownShare + o.ownShare < 0.05) leader = 'none';
    else if (Math.abs(h.ownShare - o.ownShare) < 0.08) leader = 'contested';
    else leader = h.ownShare > o.ownShare ? 'humans' : 'orcs';

    if (leader === this.lastTerritoryLeader) return;
    if (this.lastTerritoryLeader === 'none' && leader !== 'none') {
      this.lastTerritoryLeader = leader;
      return;
    }
    const prev = this.lastTerritoryLeader;
    this.lastTerritoryLeader = leader;
    if (leader === 'none') return;

    const label =
      leader === 'contested'
        ? 'Contested frontiers'
        : leader === 'humans'
          ? 'Human territory expands'
          : 'Orc territory expands';
    const cx = mapCenter?.x ?? 0;
    const cy = mapCenter?.y ?? 0;
    this.record({
      type: 'territoryShift',
      location: { x: cx, y: cy },
      participants: [prev, leader],
      description: `${label} (${prev} → ${leader})`,
      importance: 0.7,
    });
  }

  private flushMigrationBuckets() {
    const now = this.elapsed;
    this.migrationBuckets = this.migrationBuckets.filter((b) => b.windowUntil > now || b.count > 0);
  }

  private pruneBattleClusters() {
    const now = this.elapsed;
    this.battleClusters = this.battleClusters.filter((c) => now - c.lastKillAt < 16);
  }

  private isMilitary(u: Unit): boolean {
    return (
      u.unitType === 'Swordsman' ||
      u.unitType === 'Archer' ||
      u.unitType === 'Grunt' ||
      u.unitType === 'SpearOrc'
    );
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }
}

export function formatEventTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
