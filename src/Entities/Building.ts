import { assets, drawSprite } from '../Assets/Assets';
import {
  buildingAssetMeta,
  buildingSpriteKey,
  buildingSpritePivotY,
  buildingSpriteScale,
} from '../Assets/SpriteMap';
import type { TileFootprint } from '../Assets/Manifest';
import { drawIsoBox, drawIsoDiamond, drawIsoEllipse } from '../Engine/Iso';
import type { FactionId } from '../Players/Types';
import { MatchState, type PlayerState } from '../Players/MatchState';
import { Entity } from './Entity';

export type BuildingType =
  | 'TownHall'
  | 'Barracks'
  | 'Farm'
  | 'House'
  | 'Storage'
  | 'OrcStronghold'
  | 'OrcBarracks'
  | 'PigFarm'
  | 'Blacksmith'
  | 'Fort'
  | 'Outpost'
  | 'Temple'
  | 'Market'
  | 'Wall';

export class Building extends Entity {
  public buildingType: BuildingType;
  public width: number;
  public height: number;
  public footprintTiles: TileFootprint;
  public isConstructed: boolean = true;
  public constructionProgress: number = 0;
  public maxConstructionProgress: number = 100;
  /** Soft link to Settlement.id for multi-settlement ownership. */
  public settlementId: string | null = null;

  constructor(
    x: number,
    y: number,
    type: BuildingType,
    owner: PlayerState,
    isConstructed: boolean = true,
  ) {
    let hp = 1000;
    let radius = 40;
    let maxProgress = 100;
    if (type === 'TownHall' || type === 'OrcStronghold') {
      hp = 1500;
      radius = 50;
      maxProgress = 200;
    } else if (type === 'Farm' || type === 'PigFarm') {
      hp = 400;
      radius = 30;
      maxProgress = 70;
    } else if (type === 'House') {
      hp = 350;
      radius = 26;
      maxProgress = 80;
    } else if (type === 'Storage') {
      hp = 500;
      radius = 34;
      maxProgress = 100;
    } else if (type === 'Barracks' || type === 'OrcBarracks') {
      maxProgress = 160;
    } else if (type === 'Blacksmith') {
      hp = 700;
      radius = 36;
      maxProgress = 140;
    } else if (type === 'Fort') {
      hp = 1800;
      radius = 48;
      maxProgress = 220;
    } else if (type === 'Outpost') {
      hp = 700;
      radius = 32;
      maxProgress = 110;
    } else if (type === 'Temple') {
      hp = 800;
      radius = 38;
      maxProgress = 150;
    } else if (type === 'Market') {
      hp = 600;
      radius = 36;
      maxProgress = 120;
    } else if (type === 'Wall') {
      hp = 450;
      radius = 22;
      maxProgress = 90;
    }

    const meta = buildingAssetMeta(type, owner.factionId);
    if (meta) {
      radius = Math.max(meta.collisionFootprint.width, meta.collisionFootprint.height) / 2;
    }

    super(x, y, radius, hp, owner.factionId, owner.id);
    this.buildingType = type;
    this.width = meta?.footprint.width ?? radius * 2;
    this.height = meta?.footprint.height ?? radius * 2;
    this.footprintTiles = meta?.footprintTiles
      ? { ...meta.footprintTiles }
      : { columns: 1, rows: 1 };
    this.selectionRadius = meta?.selectionRadius || radius;

    this.isConstructed = isConstructed;
    this.maxConstructionProgress = maxProgress;
    if (isConstructed) {
      this.constructionProgress = this.maxConstructionProgress;
    } else {
      this.hp = 10;
    }
  }

  public update(_dt: number, entities?: Entity[], _gameMap?: unknown) {
    if (!this.isConstructed && this.constructionProgress >= this.maxConstructionProgress) {
      this.isConstructed = true;
      this.hp = this.maxHp;
      if (Building.onConstructed) Building.onConstructed(this, entities ?? []);
    }
  }

  /** Fired once when construction finishes (settlement / hero career hooks). */
  public static onConstructed: ((building: Building, entities: Entity[]) => void) | null = null;

  public draw(ctx: CanvasRenderingContext2D, camera: any, _gameMap?: unknown) {
    if (this.isDead) return;
    const screenPos = camera.worldToScreen(this.x, this.y);
    const sprite = assets.get(buildingSpriteKey(this.buildingType, this.factionId));
    const scale = buildingSpriteScale(this.buildingType, this.factionId);
    const spriteH = sprite ? sprite.height * scale : this.isoHeight() + this.radius;

    drawIsoEllipse(ctx, screenPos.x, screenPos.y, this.radius * 1.8, 'rgba(0, 0, 0, 0.3)');

    if (this.selected) {
      const ring = MatchState.current?.getPlayer(this.ownerPlayerId ?? '')?.playerColor ?? '#4FC3F7';
      drawIsoDiamond(ctx, screenPos.x, screenPos.y, this.selectionRadius, undefined, ring);
    }

    if (sprite) {
      drawSprite(ctx, sprite, screenPos.x, screenPos.y, scale, {
        pivotY: buildingSpritePivotY(this.buildingType, this.factionId),
        alpha: this.isConstructed ? 1 : 0.65,
      });
    } else {
      const boxHeight = this.isoHeight();
      ctx.globalAlpha = this.isConstructed ? 1 : 0.7;
      drawIsoBox(ctx, screenPos.x, screenPos.y, this.radius, boxHeight, this.faceColors());
      ctx.globalAlpha = 1;
    }

    const barY = screenPos.y - spriteH * 0.88 - 8;
    if (!this.isConstructed) {
      const buildPercent = Math.max(0, this.constructionProgress / this.maxConstructionProgress);
      ctx.fillStyle = '#444';
      ctx.fillRect(screenPos.x - this.width / 2, barY, this.width, 5);
      ctx.fillStyle = '#0ff';
      ctx.fillRect(screenPos.x - this.width / 2, barY, this.width * buildPercent, 5);
    } else {
      const hpPercent = Math.max(0, this.hp / this.maxHp);
      if (hpPercent < 1 || this.selected) {
        ctx.fillStyle = '#f00';
        ctx.fillRect(screenPos.x - this.width / 2, barY, this.width, 5);
        ctx.fillStyle = '#0f0';
        ctx.fillRect(screenPos.x - this.width / 2, barY, this.width * hpPercent, 5);
      }
    }
  }

  private isoHeight(): number {
    if (this.buildingType === 'TownHall') return 56;
    if (this.buildingType === 'OrcStronghold') return 64;
    if (this.buildingType === 'Fort') return 52;
    if (this.buildingType === 'Outpost') return 28;
    if (this.buildingType === 'Barracks' || this.buildingType === 'OrcBarracks') return 38;
    if (this.buildingType === 'Blacksmith' || this.buildingType === 'Temple') return 32;
    if (this.buildingType === 'Storage' || this.buildingType === 'Market') return 28;
    if (this.buildingType === 'Wall') return 22;
    if (this.buildingType === 'House') return 16;
    return 18;
  }

  private faceColors(): { top: string; left: string; right: string } {
    if (this.buildingType === 'House') {
      return this.factionId === 'orcs'
        ? { top: '#EF9A9A', left: '#6D1B1B', right: '#C62828' }
        : { top: '#90CAF9', left: '#1565C0', right: '#42A5F5' };
    }
    if (this.buildingType === 'Storage' || this.buildingType === 'Market') {
      return this.factionId === 'orcs'
        ? { top: '#FFCC80', left: '#5D4037', right: '#8D6E63' }
        : { top: '#FFE082', left: '#5D4037', right: '#A1887F' };
    }
    if (this.buildingType === 'Wall' || this.buildingType === 'Fort' || this.buildingType === 'Outpost') {
      return { top: '#B0BEC5', left: '#455A64', right: '#78909C' };
    }
    if (this.buildingType === 'Temple') {
      return { top: '#E1BEE7', left: '#6A1B9A', right: '#AB47BC' };
    }
    if (this.buildingType === 'Blacksmith') {
      return { top: '#FFAB91', left: '#4E342E', right: '#8D6E63' };
    }
    if (this.factionId === 'orcs') {
      return { top: '#E53935', left: '#5D0000', right: '#C62828' };
    }
    return { top: '#1E88E5', left: '#0D47A1', right: '#1976D2' };
  }
}

export function isMainBuilding(type: BuildingType): boolean {
  return type === 'TownHall' || type === 'OrcStronghold';
}

export function isEconomyBuilding(type: BuildingType): boolean {
  return type === 'Farm' || type === 'PigFarm';
}

export function isHousingBuilding(type: BuildingType): boolean {
  return type === 'House';
}

export function isStorageBuilding(type: BuildingType): boolean {
  return type === 'Storage';
}

export function isStrategicBuilding(type: BuildingType): boolean {
  return (
    type === 'Barracks' ||
    type === 'OrcBarracks' ||
    type === 'Blacksmith' ||
    type === 'Fort' ||
    type === 'Outpost' ||
    type === 'Temple' ||
    type === 'Market' ||
    type === 'Wall'
  );
}

export function isOutpostBuilding(type: BuildingType): boolean {
  return type === 'Outpost' || type === 'Fort';
}

export function factionOfBuildingType(type: BuildingType): FactionId {
  if (type === 'OrcStronghold' || type === 'OrcBarracks' || type === 'PigFarm') return 'orcs';
  return 'humans';
}
