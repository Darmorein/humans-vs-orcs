import { assets, drawSprite } from '../Assets/Assets';
import { drawIsoBox, drawIsoDiamond, drawIsoEllipse } from '../Engine/Iso';
import type { FactionId } from '../Players/Types';
import { Entity } from './Entity';

/**
 * Gold deposit — territorial income extracts remainingAmount into linked settlements.
 * Worker gather micro is retired; nodes are settlement infrastructure targets.
 */
export class ResourceNode extends Entity {
  /** Legacy alias kept for save compat; prefer remainingAmount. */
  public resourceAmount: number;
  /** Authoritative depletable stock. */
  public remainingAmount: number;
  /** Soft link to Settlement.id extracting this deposit. */
  public linkedSettlementId: string | null = null;
  /** Faction currently receiving income (null if unclaimed / enemy-held). */
  public controllingFactionId: FactionId | null = null;
  /**
   * 0 = undeveloped access; higher with Mine/Outpost proximity or sustained extraction.
   * Caps output multiplier.
   */
  public infrastructureLevel = 0;
  /** 0..1 local safety around the deposit (raid / contested). */
  public safety = 1;
  /** Seconds remaining of raid output disable / reduced safety. */
  public raidDamageCooldown = 0;
  /** Gold extracted this tick (UI / diagnostics). */
  public lastExtractionRate = 0;

  constructor(x: number, y: number, amount: number) {
    super(x, y, 28, 10000, 'neutral', null);
    this.resourceAmount = amount;
    this.remainingAmount = amount;
  }

  public update(dt: number, _entities?: Entity[], _gameMap?: unknown) {
    if (this.raidDamageCooldown > 0) {
      this.raidDamageCooldown = Math.max(0, this.raidDamageCooldown - dt);
    }
    // Slowly recover safety when not under raid.
    if (this.raidDamageCooldown <= 0 && this.safety < 1) {
      this.safety = Math.min(1, this.safety + dt * 0.08);
    }
    this.resourceAmount = this.remainingAmount;
  }

  public draw(ctx: CanvasRenderingContext2D, camera: any, _gameMap?: unknown) {
    const screenPos = camera.worldToScreen(this.x, this.y);
    const sprite = assets.get('terrain/gold-deposit');

    // Bright ground ring so deposits read on dirt/grass tiles.
    drawIsoEllipse(ctx, screenPos.x, screenPos.y, this.radius + 14, 'rgba(255, 193, 7, 0.35)');
    drawIsoEllipse(ctx, screenPos.x, screenPos.y, this.radius + 6, 'rgba(0, 0, 0, 0.3)');

    if (sprite) {
      drawSprite(ctx, sprite, screenPos.x, screenPos.y, 0.55, { pivotY: 0.82 });
    } else {
      drawIsoDiamond(ctx, screenPos.x, screenPos.y, this.radius + 6, '#6D4C41', '#4E342E');
      drawIsoBox(ctx, screenPos.x, screenPos.y - 4, this.radius * 0.7, 22, {
        top: '#FFD54F',
        left: '#F9A825',
        right: '#FFC107',
      });
    }

    const stock = Math.min(1, this.remainingAmount / 5000);
    const barW = 36;
    ctx.fillStyle = '#222';
    ctx.fillRect(screenPos.x - barW / 2, screenPos.y + 16, barW, 5);
    ctx.fillStyle = this.raidDamageCooldown > 0 ? '#E53935' : '#FFD54F';
    ctx.fillRect(screenPos.x - barW / 2, screenPos.y + 16, barW * stock, 5);

    ctx.textAlign = 'center';
    ctx.font = 'bold 11px Segoe UI, sans-serif';
    ctx.fillStyle = '#FFF8E1';
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 3;
    const title = this.selected ? 'GOLD DEPOSIT' : 'GOLD';
    ctx.strokeText(title, screenPos.x, screenPos.y - 28);
    ctx.fillText(title, screenPos.x, screenPos.y - 28);

    ctx.font = '10px Segoe UI, sans-serif';
    if (this.lastExtractionRate > 0.05) {
      const rate = `+${this.lastExtractionRate.toFixed(1)}/s`;
      ctx.fillStyle = '#FFE082';
      ctx.strokeText(rate, screenPos.x, screenPos.y - 16);
      ctx.fillText(rate, screenPos.x, screenPos.y - 16);
    } else if (this.linkedSettlementId) {
      ctx.fillStyle = 'rgba(255, 224, 130, 0.75)';
      ctx.fillText('linked · idle', screenPos.x, screenPos.y - 16);
    } else {
      ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
      ctx.fillText('unclaimed', screenPos.x, screenPos.y - 16);
    }
  }
}
