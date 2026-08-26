import { Camera } from '../Engine/Camera';
import { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import { Building, isMainBuilding } from '../Entities/Building';
import { ResourceNode } from '../Entities/ResourceNode';
import type { GameMap } from '../Map/GameMap';
import { MatchState } from '../Players/MatchState';

export class FogOfWar {
  public readonly cellSize = 48;
  private cols: number;
  private rows: number;
  private explored: Uint8Array;
  private visible: Uint8Array;
  private viewerPlayerId: string | null = null;

  constructor(mapWidth: number, mapHeight: number) {
    this.cols = Math.ceil(mapWidth / this.cellSize);
    this.rows = Math.ceil(mapHeight / this.cellSize);
    this.explored = new Uint8Array(this.cols * this.rows);
    this.visible = new Uint8Array(this.cols * this.rows);
  }

  public update(entities: Entity[], gameMap?: GameMap, viewerPlayerId?: string) {
    this.viewerPlayerId =
      viewerPlayerId ?? MatchState.current?.localPlayerId ?? this.viewerPlayerId;
    this.visible.fill(0);
    if (!this.viewerPlayerId) return;

    for (const entity of entities) {
      if (entity.isDead || entity.ownerPlayerId !== this.viewerPlayerId) continue;
      if (entity instanceof ResourceNode) continue;
      if (entity instanceof Building && !entity.isConstructed) continue;
      this.reveal(entity.x, entity.y, this.visionRange(entity, gameMap));
    }
  }

  public isVisibleAt(x: number, y: number): boolean {
    const i = this.indexAt(x, y);
    return i >= 0 && this.visible[i] === 1;
  }

  public isExploredAt(x: number, y: number): boolean {
    const i = this.indexAt(x, y);
    return i >= 0 && this.explored[i] === 1;
  }

  public canSeeEntity(entity: Entity): boolean {
    if (entity.isDead) return false;
    if (entity instanceof ResourceNode) return this.isExploredAt(entity.x, entity.y);
    if (this.viewerPlayerId && entity.ownerPlayerId === this.viewerPlayerId) return true;
    if (entity instanceof Building) return this.isExploredAt(entity.x, entity.y);
    return this.isVisibleAt(entity.x, entity.y);
  }

  public canTargetEntity(entity: Entity): boolean {
    if (entity.isDead) return false;
    if (entity instanceof ResourceNode) return this.isExploredAt(entity.x, entity.y);
    if (this.viewerPlayerId && entity.ownerPlayerId === this.viewerPlayerId) return true;
    return this.isVisibleAt(entity.x, entity.y);
  }

  public draw(ctx: CanvasRenderingContext2D, camera: Camera) {
    const pad = this.cellSize * 2;
    const corners = [
      camera.screenToWorld(-pad, -pad),
      camera.screenToWorld(camera.width + pad, -pad),
      camera.screenToWorld(camera.width + pad, camera.height + pad),
      camera.screenToWorld(-pad, camera.height + pad),
    ];

    const minX = Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x);
    const maxX = Math.max(corners[0].x, corners[1].x, corners[2].x, corners[3].x);
    const minY = Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y);
    const maxY = Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y);

    const minCx = Math.max(0, Math.floor(minX / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor(maxX / this.cellSize));
    const minCy = Math.max(0, Math.floor(minY / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor(maxY / this.cellSize));

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const i = cy * this.cols + cx;
        if (this.visible[i] === 1) continue;

        const wx = cx * this.cellSize;
        const wy = cy * this.cellSize;
        const p0 = camera.worldToScreen(wx, wy);
        const p1 = camera.worldToScreen(wx + this.cellSize, wy);
        const p2 = camera.worldToScreen(wx + this.cellSize, wy + this.cellSize);
        const p3 = camera.worldToScreen(wx, wy + this.cellSize);

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fillStyle = this.explored[i] === 1 ? 'rgba(0, 0, 0, 0.55)' : '#030503';
        ctx.fill();
      }
    }
  }

  private visionRange(entity: Entity, gameMap?: GameMap): number {
    let range = 200;
    if (entity instanceof Building) {
      range = isMainBuilding(entity.buildingType) ? 360 : 220;
    } else if (entity instanceof Unit) {
      if (entity.unitType === 'Archer' || entity.unitType === 'SpearOrc') range = 280;
      else if (entity.unitType === 'Worker' || entity.unitType === 'Peon') range = 180;
      else range = 240;
    }

    if (gameMap) {
      const tile = gameMap.getTileAt(entity.x, entity.y);
      range *= tile.visionModifier;
    }
    return range;
  }

  private reveal(x: number, y: number, range: number) {
    const rangeSq = range * range;
    const minCx = Math.max(0, Math.floor((x - range) / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + range) / this.cellSize));
    const minCy = Math.max(0, Math.floor((y - range) / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor((y + range) / this.cellSize));

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const cellX = cx * this.cellSize + this.cellSize * 0.5;
        const cellY = cy * this.cellSize + this.cellSize * 0.5;
        const dx = cellX - x;
        const dy = cellY - y;
        if (dx * dx + dy * dy <= rangeSq) {
          const i = cy * this.cols + cx;
          this.visible[i] = 1;
          this.explored[i] = 1;
        }
      }
    }
  }

  private indexAt(x: number, y: number): number {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return -1;
    return cy * this.cols + cx;
  }
}
