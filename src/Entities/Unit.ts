import { assets, drawSprite } from '../Assets/Assets';
import {
  AnimationPlayer,
  atlasFrameRect,
  drawAtlasFrame,
  reportMissingClip,
  resolveUnitVisualState,
  worldFacingToIsoDirection,
  type AnimationEvent,
} from '../Assets/Animation';
import type { IsoDirection } from '../Assets/Manifest';
import {
  unitAssetMeta,
  unitSpriteKey,
  unitSpritePivotY,
  unitSpriteScale,
} from '../Assets/SpriteMap';
import { drawIsoEllipse } from '../Engine/Iso';
import type { GameMap } from '../Map/GameMap';
import type { PathPoint } from '../Map/Pathfinding';
import { isForestTerrain } from '../Map/Terrain';
import { MatchState, type PlayerState } from '../Players/MatchState';
import { isHostile } from '../Players/Relations';
import { Building, isMainBuilding } from './Building';
import { Entity } from './Entity';
import { ResourceNode } from './ResourceNode';
import {
  damageMultiplierFromScore,
  assessEngagement,
  assessHoldPosition,
} from '../Combat/TacticalTerrain';

export class Unit extends Entity {
  public speed: number;
  public targetX: number | null = null;
  public targetY: number | null = null;
  public targetEntity: Entity | null = null;
  /** Strategic order (e.g. enemy base) resumed after dealing with nearby threats. */
  private orderTarget: Entity | null = null;

  public damage: number;
  public attackRange: number;
  public attackCooldown: number = 1.0;
  private attackTimer: number = 0;
  private isAttackingVisual: number = 0;
  private hitVisualTimer: number = 0;
  private restartAttackAnimation = false;
  private restartHitAnimation = false;
  private visualDirection: IsoDirection = 'SE';
  private readonly visualAnimation = new AnimationPlayer();
  private visualAnimationEvents: AnimationEvent[] = [];
  public unitType: 'Worker' | 'Swordsman' | 'Archer' | 'Peon' | 'Grunt' | 'SpearOrc';

  public gatherTarget: any = null;
  public heldGold: number = 0;
  public maxGoldCapacity: number = 10;
  private gatherTimer: number = 0;
  public buildTarget: any = null;
  /** When set, unit is part of a Settler Group founding mission. */
  public settlerGroupId: string | null = null;
  /** Combat Squad id — null for workers / unassigned. */
  public squadId: string | null = null;
  /** Soft multipliers from squad morale/xp (1 = neutral). */
  public squadAttackMul = 1;
  public squadSpeedMul = 1;
  /** Formation flags pushed each tick by SquadSystem. */
  public holdGround = false;
  public chargeStrikeReady = false;
  public formationMeleeTakenMul = 1;
  public formationRangedTakenMul = 1;
  public formationFrontalDefense = false;
  public formationFirstContactMul = 1;
  public facingX = 0;
  public facingY = 1;
  /** Squad is broken and fleeing. */
  public isRouting = false;
  /**
   * Emergent hero (named) — not the same as temporary squad leadership.
   * Set by HeroSystem when an agent rises through deeds.
   */
  public isHero = false;
  public heroId: string | null = null;
  public heroName: string | null = null;
  /** Personal career — feeds hero emergence. */
  public personalXp = 0;
  public prestige = 0;
  public killCount = 0;
  public structuresRaised = 0;
  public settlementsFounded = 0;
  public leaguesWalked = 0;
  public agentTraits: import('../Heroes/Types').AgentTrait[] = [];
  public careerLog: string[] = [];
  /** Carried procedural artifact id, if any. */
  public artifactId: string | null = null;
  /** Baselines for artifact effect re-application. */
  public artifactBase: {
    damage: number;
    maxHp: number;
    speed: number;
    attackRange: number;
  } | null = null;

  /** Optional global hook when a unit dies (Squad victory morale). */
  public static onUnitKilled: ((victim: Unit, killer: Entity | null) => void) | null = null;

  private path: PathPoint[] = [];
  private pathIndex = 0;
  /** Last map seen in update — used for tactical takeDamage. */
  private lastGameMap: GameMap | null = null;

  constructor(x: number, y: number, owner: PlayerState, options: any) {
    const unitType = (options.unitType ||
      (owner.factionId === 'humans' ? 'Worker' : 'Grunt')) as Unit['unitType'];
    const meta = unitAssetMeta(owner.factionId, unitType);
    const radius = meta
      ? Math.max(meta.collisionFootprint.width, meta.collisionFootprint.height) / 2
      : 12;
    super(x, y, radius, options.hp, owner.factionId, owner.id);
    this.speed = options.speed || 50;
    this.damage = options.damage || 10;
    this.attackRange = options.range || 35;
    this.attackCooldown = options.attackCooldown || 1.0;
    this.unitType = unitType;
    this.selectionRadius = meta?.selectionRadius || radius;
  }

  public get isRanged(): boolean {
    return this.unitType === 'Archer' || this.unitType === 'SpearOrc';
  }

  public moveCommand(x: number, y: number) {
    const dx = x - this.x;
    const dy = y - this.y;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      this.facingX = dx / len;
      this.facingY = dy / len;
    }
    this.targetX = x;
    this.targetY = y;
    this.targetEntity = null;
    this.orderTarget = null;
    this.gatherTarget = null;
    this.buildTarget = null;
    this.clearPath();
  }

  public attackCommand(entity: Entity) {
    if (this.isRouting) return;
    this.orderTarget = entity;
    this.targetEntity = entity;
    this.targetX = null;
    this.targetY = null;
    this.gatherTarget = null;
    this.buildTarget = null;
    this.clearPath();
  }

  /** Drop combat orders (used when entering ROUT). */
  public clearCombatFocus() {
    this.targetEntity = null;
    this.orderTarget = null;
    this.gatherTarget = null;
    this.buildTarget = null;
  }

  public gatherCommand(node: any) {
    this.gatherTarget = node;
    this.targetEntity = null;
    this.orderTarget = null;
    this.targetX = null;
    this.targetY = null;
    this.buildTarget = null;
    this.clearPath();
  }

  public buildCommand(building: any) {
    this.buildTarget = building;
    this.gatherTarget = null;
    this.targetEntity = null;
    this.orderTarget = null;
    this.targetX = null;
    this.targetY = null;
    this.clearPath();
  }

  public update(dt: number, entities?: Entity[], gameMap?: GameMap) {
    const startX = this.x;
    const startY = this.y;
    if (this.isDead) {
      this.updateVisualAnimation(dt, false);
      return;
    }
    if (gameMap) this.lastGameMap = gameMap;

    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (this.isAttackingVisual > 0) this.isAttackingVisual -= dt;
    if (this.hitVisualTimer > 0) this.hitVisualTimer -= dt;

    // ROUT: only flee — no aggro / build / gather
    if (this.isRouting) {
      this.clearCombatFocus();
      if (this.targetX !== null && this.targetY !== null) {
        if (Math.hypot(this.targetX - this.x, this.targetY - this.y) < 4) {
          this.targetX = null;
          this.targetY = null;
          this.clearPath();
        } else {
          this.chasePoint(this.targetX, this.targetY, dt, gameMap, entities);
        }
      }
      this.updateVisualAnimation(dt, this.x !== startX || this.y !== startY);
      return;
    }

    this.retargetThreats(entities);

    if (this.buildTarget) {
      if (this.buildTarget.isDead || this.buildTarget.isConstructed) {
        this.buildTarget = null;
        this.clearPath();
      } else {
        const reach = this.buildTarget.radius + this.radius + 10;
        if (Math.hypot(this.buildTarget.x - this.x, this.buildTarget.y - this.y) <= reach) {
          this.buildTarget.constructionProgress += 10 * dt;
          this.clearPath();
        } else {
          this.chasePoint(this.buildTarget.x, this.buildTarget.y, dt, gameMap, entities);
        }
      }
    } else if (this.gatherTarget) {
      if (this.heldGold >= this.maxGoldCapacity) {
        const dropoff = this.findDropoff(entities);
        if (dropoff) {
          if (Math.hypot(dropoff.x - this.x, dropoff.y - this.y) <= 60) {
            this.depositGold();
            this.heldGold = 0;
            this.clearPath();
          } else {
            this.chasePoint(dropoff.x, dropoff.y, dt, gameMap, entities);
          }
        }
      } else {
        const reach = this.gatherTarget.radius + this.radius + 5;
        if (Math.hypot(this.gatherTarget.x - this.x, this.gatherTarget.y - this.y) <= reach) {
          this.gatherTimer += dt;
          if (this.gatherTimer >= 1.0) {
            this.heldGold += 2;
            this.gatherTimer = 0;
          }
          this.clearPath();
        } else {
          this.chasePoint(this.gatherTarget.x, this.gatherTarget.y, dt, gameMap, entities);
        }
      }
    } else if (this.targetEntity) {
      if (this.targetEntity.isDead) {
        this.targetEntity = null;
        if (this.orderTarget?.isDead) this.orderTarget = null;
        this.clearPath();
        this.retargetThreats(entities);
      } else {
        const range = this.getEffectiveRange(gameMap);
        const dist = Math.hypot(this.targetEntity.x - this.x, this.targetEntity.y - this.y);
        if (dist <= range + this.targetEntity.radius + this.radius) {
          if (this.attackTimer <= 0) {
            this.targetEntity.takeDamage(this.getEffectiveDamage(gameMap), this);
            this.attackTimer = this.attackCooldown;
            this.isAttackingVisual = 0.1;
            this.restartAttackAnimation = true;
            this.chargeStrikeReady = false;
          }
          this.clearPath();
        } else if (this.holdGround) {
          // Hold Ground: no pursuit — wait for enemy to enter range
          this.clearPath();
        } else {
          this.chasePoint(this.targetEntity.x, this.targetEntity.y, dt, gameMap, entities);
        }
      }
    } else if (this.targetX !== null && this.targetY !== null) {
      if (Math.hypot(this.targetX - this.x, this.targetY - this.y) < 4) {
        this.targetX = null;
        this.targetY = null;
        this.clearPath();
      } else {
        this.chasePoint(this.targetX, this.targetY, dt, gameMap, entities);
      }
    }
    this.updateVisualAnimation(dt, this.x !== startX || this.y !== startY);
  }

  public draw(ctx: CanvasRenderingContext2D, camera: any, gameMap?: GameMap) {
    if (this.isDead) return;
    const screenPos = camera.worldToScreen(this.x, this.y);
    const inForest = gameMap ? isForestTerrain(gameMap.getTileAt(this.x, this.y).type) : false;
    const key = unitSpriteKey(this.factionId, this.unitType);
    const sprite = key ? assets.get(key) : null;
    const meta = unitAssetMeta(this.factionId, this.unitType);
    const animationFrame = this.visualAnimation.currentFrameRect();
    const atlasFallbackFrame = meta?.atlas ? atlasFrameRect(meta.atlas, 0) : null;
    const frameToDraw = animationFrame ?? atlasFallbackFrame;
    const scale = unitSpriteScale(this.factionId, this.unitType);
    const spriteH = sprite
      ? (frameToDraw?.height ?? sprite.height) * scale
      : this.bodyRadius() * 2.4;

    drawIsoEllipse(ctx, screenPos.x, screenPos.y, this.radius + 2, 'rgba(0, 0, 0, 0.28)');

    if (this.selected) {
      const ring = MatchState.current?.getPlayer(this.ownerPlayerId ?? '')?.playerColor ?? '#4FC3F7';
      drawIsoEllipse(ctx, screenPos.x, screenPos.y, this.selectionRadius, undefined, ring);
    }

    if (sprite) {
      const drawOptions = {
        pivotX: meta?.pivotX ?? 0.5,
        pivotY: unitSpritePivotY(this.factionId, this.unitType),
        alpha: inForest ? 0.78 : 1,
      };
      if (frameToDraw) {
        drawAtlasFrame(
          ctx,
          sprite,
          frameToDraw,
          screenPos.x,
          screenPos.y,
          scale,
          drawOptions,
        );
      } else {
        drawSprite(ctx, sprite, screenPos.x, screenPos.y, scale, drawOptions);
      }
    } else {
      this.drawFallbackUnit(ctx, screenPos, inForest);
    }

    if (this.isAttackingVisual > 0) {
      const spark = assets.get('vfx/hit-spark');
      if (spark) {
        drawSprite(ctx, spark, screenPos.x + 8, screenPos.y - spriteH * 0.45, 0.18, { pivotY: 0.5 });
      }
    }

    if (this.isHero && this.heroName) {
      ctx.fillStyle = 'rgba(255, 214, 90, 0.95)';
      ctx.font = 'bold 11px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('★', screenPos.x, screenPos.y - spriteH * 0.92);
      ctx.fillStyle = 'rgba(255, 236, 170, 0.92)';
      ctx.font = '10px Segoe UI, sans-serif';
      ctx.fillText(this.heroName, screenPos.x, screenPos.y - spriteH * 0.92 - 12);
    } else if (this.artifactId) {
      ctx.fillStyle = 'rgba(180, 220, 255, 0.9)';
      ctx.font = 'bold 10px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚔', screenPos.x, screenPos.y - spriteH * 0.88);
    }

    if ((this.unitType === 'Worker' || this.unitType === 'Peon') && this.heldGold > 0) {
      const goldIcon = assets.get('ui/gold');
      if (goldIcon) {
        drawSprite(ctx, goldIcon, screenPos.x + 10, screenPos.y - spriteH * 0.35, 0.12, { pivotY: 0.5 });
      } else {
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(screenPos.x + 8, screenPos.y - 10, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (inForest) {
      ctx.fillStyle = 'rgba(27, 94, 32, 0.28)';
      ctx.beginPath();
      ctx.ellipse(screenPos.x, screenPos.y - spriteH * 0.55, 14, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.hp < this.maxHp || this.selected) {
      const barWidth = 22;
      const barHeight = 4;
      const hpPercent = Math.max(0, this.hp / this.maxHp);
      const barY = screenPos.y - spriteH * 0.92 - 8;
      ctx.fillStyle = '#f00';
      ctx.fillRect(screenPos.x - barWidth / 2, barY, barWidth, barHeight);
      ctx.fillStyle = '#0f0';
      ctx.fillRect(screenPos.x - barWidth / 2, barY, barWidth * hpPercent, barHeight);
    }
  }

  private drawFallbackUnit(
    ctx: CanvasRenderingContext2D,
    screenPos: { x: number; y: number },
    inForest: boolean,
  ) {
    const bodyRadius = this.bodyRadius();
    const bodyY = screenPos.y - bodyRadius * 0.85;
    ctx.globalAlpha = inForest ? 0.72 : 1;
    let fill = this.factionTint();
    if (this.isAttackingVisual > 0) fill = '#fff';

    ctx.beginPath();
    ctx.ellipse(screenPos.x, bodyY + bodyRadius * 0.35, bodyRadius * 0.7, bodyRadius * 0.95, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(screenPos.x, bodyY - bodyRadius * 0.35, bodyRadius * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /**
   * While marching to a base/building, switch to nearby enemy units
   * (especially whoever is hitting us), then resume the original order.
   */
  private retargetThreats(entities?: Entity[]) {
    if (!entities || this.gatherTarget || this.buildTarget) return;

    const isWorker = this.unitType === 'Worker' || this.unitType === 'Peon';
    // Hold Ground: only engage within weapon range (no pursuit aggro)
    const aggroRange = this.holdGround
      ? this.attackRange + this.radius + 8
      : Math.max(this.attackRange * 2.75, isWorker ? 70 : 100);

    if (this.orderTarget?.isDead) this.orderTarget = null;

    if (this.targetEntity instanceof Unit && !this.targetEntity.isDead) {
      if (
        this.lastAttacker instanceof Unit &&
        !this.lastAttacker.isDead &&
        isHostile(this, this.lastAttacker) &&
        this.lastAttacker !== this.targetEntity
      ) {
        const dCur = Math.hypot(this.targetEntity.x - this.x, this.targetEntity.y - this.y);
        const dAtk = Math.hypot(this.lastAttacker.x - this.x, this.lastAttacker.y - this.y);
        if (dAtk <= aggroRange && dAtk < dCur * 0.75) {
          this.targetEntity = this.lastAttacker;
          this.clearPath();
        }
      }
      // Hold Ground: drop chase target that left weapon range
      if (this.holdGround && this.targetEntity) {
        const d = Math.hypot(this.targetEntity.x - this.x, this.targetEntity.y - this.y);
        const reach = this.attackRange + this.targetEntity.radius + this.radius;
        if (d > reach * 1.15) {
          this.targetEntity = null;
          this.clearPath();
        }
      }
      return;
    }

    let threat: Entity | null = null;
    let bestDist = aggroRange;

    if (
      this.lastAttacker &&
      !this.lastAttacker.isDead &&
      isHostile(this, this.lastAttacker) &&
      !(this.lastAttacker instanceof ResourceNode)
    ) {
      const dist = Math.hypot(this.lastAttacker.x - this.x, this.lastAttacker.y - this.y);
      if (dist <= aggroRange) {
        threat = this.lastAttacker;
        bestDist = dist;
      }
    }

    for (const e of entities) {
      if (!(e instanceof Unit) || e.isDead || !isHostile(this, e)) continue;
      const dist = Math.hypot(e.x - this.x, e.y - this.y);
      if (dist < bestDist) {
        bestDist = dist;
        threat = e;
      }
    }

    if (threat) {
      this.targetEntity = threat;
      this.targetX = null;
      this.targetY = null;
      this.clearPath();
      return;
    }

    // Hold Ground never resumes long-range march on orderTarget by chasing
    if (this.holdGround) return;

    if ((!this.targetEntity || this.targetEntity.isDead) && this.orderTarget && !this.orderTarget.isDead) {
      this.targetEntity = this.orderTarget;
      this.clearPath();
      return;
    }

    if (!this.targetEntity && !this.orderTarget && !isWorker) {
      let closest: Entity | null = null;
      let closestDist = this.attackRange * 2;
      for (const e of entities) {
        if (e.isDead || !isHostile(this, e) || e instanceof ResourceNode) continue;
        const dist = Math.hypot(e.x - this.x, e.y - this.y);
        if (dist < closestDist) {
          closestDist = dist;
          closest = e;
        }
      }
      if (closest) {
        this.targetEntity = closest;
        this.clearPath();
      }
    }
  }

  private chasePoint(
    gx: number,
    gy: number,
    dt: number,
    gameMap?: GameMap,
    entities?: Entity[],
  ) {
    if (gameMap) {
      if (this.path.length === 0 || this.pathIndex >= this.path.length) {
        this.path = gameMap.findPath(this.x, this.y, gx, gy);
        this.pathIndex = 0;
      }

      if (this.path.length > 0) {
        const waypoint = this.path[Math.min(this.pathIndex, this.path.length - 1)]!;
        if (Math.hypot(waypoint.x - this.x, waypoint.y - this.y) < 6) {
          this.pathIndex++;
          if (this.pathIndex >= this.path.length) {
            this.path = [];
            return;
          }
        }
        const next = this.path[Math.min(this.pathIndex, this.path.length - 1)]!;
        this.stepToward(next.x, next.y, dt, gameMap, entities);
        return;
      }
    }

    this.stepToward(gx, gy, dt, gameMap, entities);
  }

  private stepToward(
    gx: number,
    gy: number,
    dt: number,
    gameMap?: GameMap,
    entities?: Entity[],
  ) {
    const dx = gx - this.x;
    const dy = gy - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.1) return;

    const speedMul = gameMap ? gameMap.getMoveSpeedMultiplier(this.x, this.y) : 1;
    const step = this.speed * this.squadSpeedMul * speedMul * dt;
    const nx = this.x + (dx / dist) * Math.min(step, dist);
    const ny = this.y + (dy / dist) * Math.min(step, dist);

    if (this.canOccupy(nx, ny, gameMap, entities)) {
      this.x = nx;
      this.y = ny;
    } else if (this.canOccupy(nx, this.y, gameMap, entities)) {
      this.x = nx;
      this.clearPath();
    } else if (this.canOccupy(this.x, ny, gameMap, entities)) {
      this.y = ny;
      this.clearPath();
    } else {
      this.clearPath();
    }
  }

  /** Terrain + building footprints (builders may enter their own site). */
  private canOccupy(x: number, y: number, gameMap?: GameMap, entities?: Entity[]): boolean {
    if (gameMap && !gameMap.isWalkable(x, y)) return false;
    if (!entities) return true;
    for (const e of entities) {
      if (!(e instanceof Building) || e.isDead) continue;
      if (this.buildTarget === e) continue;
      const r = this.radius * 0.45 + e.radius * 0.88;
      if ((x - e.x) * (x - e.x) + (y - e.y) * (y - e.y) < r * r) return false;
    }
    return true;
  }

  private getEffectiveRange(gameMap?: GameMap): number {
    let range = this.attackRange;
    if (!gameMap || !this.isRanged) return range;
    const atk = gameMap.getTileAt(this.x, this.y);
    return range * (1 + atk.rangedRangeModifier);
  }

  private getEffectiveDamage(gameMap?: GameMap): number {
    let dmg = this.damage * this.squadAttackMul;
    if (this.chargeStrikeReady) {
      dmg *= this.formationFirstContactMul;
    }
    if (!gameMap || !this.targetEntity) return dmg;

    const atk = gameMap.getTileAt(this.x, this.y);
    const def = gameMap.getTileAt(this.targetEntity.x, this.targetEntity.y);

    if (this.isRanged) {
      dmg *= 1 + atk.rangedModifier;
      dmg *= 1 - def.defenseModifier;
    }

    // Hills / flanks / uphill via tactical heuristics
    const tactical = assessEngagement(gameMap, this, this.targetEntity);
    dmg *= damageMultiplierFromScore(tactical.total);

    return dmg;
  }

  public override takeDamage(amount: number, source?: Entity) {
    if (this.isDead) return;
    let dmg = amount;
    if (source instanceof Unit) {
      const ranged = source.isRanged;
      dmg *= ranged ? this.formationRangedTakenMul : this.formationMeleeTakenMul;
      if (this.formationFrontalDefense && !ranged) {
        const ax = source.x - this.x;
        const ay = source.y - this.y;
        const alen = Math.hypot(ax, ay) || 1;
        const dot = (ax / alen) * this.facingX + (ay / alen) * this.facingY;
        if (dot > 0.25) dmg *= 0.75;
      }
      if (this.lastGameMap) {
        const hold = assessHoldPosition(this.lastGameMap, this.x, this.y, {
          isRanged: this.isRanged,
          enemiesNearby: 1,
        });
        // Strong hold (hill/bridge/forest) → take less; exposed archers → take more
        dmg *= Math.max(0.8, Math.min(1.18, 1 - hold.total * 0.003));
      }
    }
    const wasAlive = !this.isDead;
    super.takeDamage(dmg, source);
    this.hitVisualTimer = 0.16;
    this.restartHitAnimation = true;
    if (wasAlive && this.isDead && Unit.onUnitKilled) {
      Unit.onUnitKilled(this, source ?? null);
    }
  }

  /**
   * Visual-only events. Gameplay may inspect them in a future integration, but
   * damage and projectiles intentionally remain authoritative in combat code.
   */
  public consumeVisualAnimationEvents(): AnimationEvent[] {
    const events = this.visualAnimationEvents;
    this.visualAnimationEvents = [];
    return events;
  }

  private updateVisualAnimation(dt: number, isMoving: boolean): void {
    this.visualDirection = worldFacingToIsoDirection(
      this.facingX,
      this.facingY,
      this.visualDirection,
    );
    const state = resolveUnitVisualState({
      isDead: this.isDead,
      wasHit: this.hitVisualTimer > 0 || this.restartHitAnimation,
      isAttacking: this.isAttackingVisual > 0,
      isMoving,
    });
    const meta = unitAssetMeta(this.factionId, this.unitType);
    const restart =
      (state === 'attack' && this.restartAttackAnimation) ||
      (state === 'hit' && this.restartHitAnimation);

    if (meta?.atlas) {
      const found = this.visualAnimation.play(meta.atlas, state, this.visualDirection, restart);
      if (!found) reportMissingClip(meta.id, state, this.visualDirection);
    } else {
      this.visualAnimation.clear();
    }

    this.restartAttackAnimation = false;
    this.restartHitAnimation = false;
    const result = this.visualAnimation.update(dt);
    this.visualAnimationEvents = result.events;
  }

  private clearPath() {
    this.path = [];
    this.pathIndex = 0;
  }

  /** Faction visual tint (not playerColor). */
  private factionTint(): string {
    if (this.factionId === 'humans') {
      if (this.unitType === 'Worker') return '#64B5F6';
      if (this.unitType === 'Archer') return '#1565C0';
      return '#2196F3';
    }
    if (this.unitType === 'Peon') return '#BF360C';
    if (this.unitType === 'SpearOrc') return '#8B0000';
    return '#D32F2F';
  }

  private bodyRadius(): number {
    if (this.unitType === 'Worker' || this.unitType === 'Peon') return 8;
    if (this.unitType === 'Archer' || this.unitType === 'SpearOrc') return 9;
    return 11;
  }

  private findDropoff(entities?: Entity[]): Entity | undefined {
    if (!entities || !this.ownerPlayerId) return undefined;
    return entities.find(
      (e) =>
        e instanceof Building &&
        !e.isDead &&
        e.ownerPlayerId === this.ownerPlayerId &&
        isMainBuilding(e.buildingType),
    );
  }

  private depositGold() {
    if (!this.ownerPlayerId) return;
    MatchState.current?.depositGold(this.ownerPlayerId, this.heldGold);
  }
}
