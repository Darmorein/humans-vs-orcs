import { assets, drawSprite } from '../Assets/Assets';
import type { Camera } from '../Engine/Camera';
import { drawIsoEllipse } from '../Engine/Iso';
import type { Entity } from '../Entities/Entity';
import { Building, isMainBuilding } from '../Entities/Building';
import { ResourceNode } from '../Entities/ResourceNode';
import { Unit } from '../Entities/Unit';
import type { FactionId } from '../Players/Types';
import { FACTIONS } from '../Players/Types';
import { isHostile } from '../Players/Relations';
import { unitSpriteKey, unitSpriteScale } from '../Assets/SpriteMap';
import type { Settlement } from './Settlement';
import type { ProfessionRole } from './Population/Types';

export type CivilianBehavior = 'home' | 'work' | 'build' | 'center' | 'flee' | 'mine';

/** Non-authoritative presentation agent — never drives income or construction. */
export interface CivilianAgent {
  id: string;
  settlementId: string;
  factionId: FactionId;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  behavior: CivilianBehavior;
  profession: ProfessionRole;
  speed: number;
  phase: number;
}

const MAX_AGENTS = 32;
const FAR_CAP = 12;
const CAMERA_NEAR = 900;

/**
 * Spawns / updates representative civilians from settlement population.
 * Rebuild from scratch on load — not serialized.
 */
export class CivilianVisualAgents {
  private agents: CivilianAgent[] = [];
  private nextId = 1;
  private rebuildTimer = 0;

  public list(): readonly CivilianAgent[] {
    return this.agents;
  }

  public clear() {
    this.agents = [];
  }

  public update(
    dt: number,
    settlements: Settlement[],
    entities: Entity[],
    camera: { x: number; y: number },
  ) {
    this.rebuildTimer += dt;
    if (this.rebuildTimer >= 1.25) {
      this.rebuildTimer = 0;
      this.reconcile(settlements, entities, camera);
    }

    for (const a of this.agents) {
      const s = settlements.find((x) => x.id === a.settlementId);
      if (!s) continue;
      this.pickTarget(a, s, entities, dt);
      const dx = a.targetX - a.x;
      const dy = a.targetY - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 4) {
        const step = Math.min(dist, a.speed * dt);
        a.x += (dx / dist) * step;
        a.y += (dy / dist) * step;
      } else {
        a.phase += dt;
        if (a.phase > 2.5 + (a.id.length % 5) * 0.3) {
          a.phase = 0;
          a.behavior = this.nextBehavior(a, s);
        }
      }
    }
  }

  public draw(ctx: CanvasRenderingContext2D, camera: Camera) {
    for (const a of this.agents) {
      const screen = camera.worldToScreen(a.x, a.y);
      if (
        screen.x < -40 ||
        screen.y < -40 ||
        screen.x > camera.width + 40 ||
        screen.y > camera.height + 40
      ) {
        continue;
      }
      const workerType = FACTIONS[a.factionId].workerType;
      const key = unitSpriteKey(a.factionId, workerType);
      const sprite = key ? assets.get(key) : null;
      const scale = unitSpriteScale(a.factionId, workerType) * 0.85;
      drawIsoEllipse(ctx, screen.x, screen.y, 6, 'rgba(0,0,0,0.2)');
      if (sprite) {
        drawSprite(ctx, sprite, screen.x, screen.y, scale, { pivotY: 0.85, alpha: 0.92 });
      } else {
        ctx.fillStyle = a.factionId === 'orcs' ? '#BF360C' : '#64B5F6';
        ctx.beginPath();
        ctx.arc(screen.x, screen.y - 6, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private reconcile(
    settlements: Settlement[],
    entities: Entity[],
    camera: { x: number; y: number },
  ) {
    const keep = new Map<string, CivilianAgent>();
    for (const a of this.agents) keep.set(`${a.settlementId}:${a.id}`, a);

    const next: CivilianAgent[] = [];
    for (const s of settlements) {
      if (!s.hasTownCenter || s.population <= 0) continue;
      const distCam = Math.hypot(s.centerX - camera.x, s.centerY - camera.y);
      const cap = distCam > CAMERA_NEAR ? FAR_CAP : MAX_AGENTS;
      const want = Math.min(cap, Math.max(2, Math.floor(s.population / 3)));
      const existing = this.agents.filter((a) => a.settlementId === s.id);
      for (let i = 0; i < want; i++) {
        const prev = existing[i];
        if (prev) {
          next.push(prev);
          continue;
        }
        const cit = s.citizens[i % Math.max(1, s.citizens.length)];
        const ang = (i / want) * Math.PI * 2;
        next.push({
          id: `cv-${this.nextId++}`,
          settlementId: s.id,
          factionId: (entities.find(
            (e) => e instanceof Building && e.settlementId === s.id,
          )?.factionId as FactionId) ?? 'humans',
          x: s.centerX + Math.cos(ang) * 40,
          y: s.centerY + Math.sin(ang) * 40,
          targetX: s.centerX,
          targetY: s.centerY,
          behavior: 'center',
          profession: cit?.profession ?? 'peasant',
          speed: 28 + (i % 5) * 3,
          phase: i * 0.4,
        });
      }
    }
    // Cap global
    this.agents = next.slice(0, MAX_AGENTS * 4);
    void keep;
  }

  private nextBehavior(a: CivilianAgent, _s: Settlement): CivilianBehavior {
    if (a.behavior === 'flee') return 'center';
    if (a.profession === 'miner') return 'mine';
    if (a.profession === 'builder') return 'build';
    if (a.profession === 'farmer') return 'work';
    const roll = (a.phase * 7 + a.id.length) % 5;
    if (roll === 0) return 'home';
    if (roll === 1) return 'work';
    if (roll === 2) return 'center';
    if (roll === 3) return 'mine';
    return 'build';
  }

  private pickTarget(a: CivilianAgent, s: Settlement, entities: Entity[], _dt: number) {
    // Flee when hostiles near settlement center
    for (const e of entities) {
      if (!(e instanceof Unit) || e.isDead) continue;
      if (Math.hypot(e.x - a.x, e.y - a.y) > 140) continue;
      const sample = entities.find(
        (b) => b instanceof Building && b.settlementId === s.id && !b.isDead,
      );
      if (sample && isHostile(sample, e)) {
        a.behavior = 'flee';
        a.targetX = s.centerX;
        a.targetY = s.centerY;
        s.warShock = Math.min(1, s.warShock + 0.0002);
        return;
      }
    }

    if (a.behavior === 'flee' || a.behavior === 'center') {
      a.targetX = s.centerX + ((a.id.length * 13) % 40) - 20;
      a.targetY = s.centerY + ((a.id.length * 17) % 40) - 20;
      return;
    }

    if (a.behavior === 'mine') {
      const mine = entities.find(
        (e): e is ResourceNode =>
          e instanceof ResourceNode &&
          !e.isDead &&
          e.linkedSettlementId === s.id &&
          Math.hypot(e.x - s.centerX, e.y - s.centerY) < 700,
      );
      if (mine) {
        a.targetX = mine.x + ((a.id.length * 11) % 24) - 12;
        a.targetY = mine.y + ((a.id.length * 19) % 24) - 12;
        return;
      }
      a.behavior = 'center';
    }

    if (a.behavior === 'build') {
      const site = entities.find(
        (e): e is Building =>
          e instanceof Building &&
          !e.isDead &&
          e.settlementId === s.id &&
          !e.isConstructed,
      );
      if (site) {
        a.targetX = site.x;
        a.targetY = site.y;
        return;
      }
      a.behavior = 'home';
    }

    if (a.behavior === 'work') {
      const farm = entities.find(
        (e): e is Building =>
          e instanceof Building &&
          !e.isDead &&
          e.settlementId === s.id &&
          e.isConstructed &&
          (e.buildingType === 'Farm' || e.buildingType === 'PigFarm'),
      );
      if (farm) {
        a.targetX = farm.x + 10;
        a.targetY = farm.y + 10;
        return;
      }
    }

    // home / default — orbit houses or TC
    const house = entities.find(
      (e): e is Building =>
        e instanceof Building &&
        !e.isDead &&
        e.settlementId === s.id &&
        e.isConstructed &&
        (e.buildingType === 'House' || isMainBuilding(e.buildingType)),
    );
    if (house) {
      a.targetX = house.x + ((a.id.length * 7) % 30) - 15;
      a.targetY = house.y + ((a.id.length * 9) % 30) - 15;
    } else {
      a.targetX = s.centerX;
      a.targetY = s.centerY;
    }
  }
}

export const civilianVisualAgents = new CivilianVisualAgents();
