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
    super(x, y, 20, 10000, 'neutral', null);
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

    drawIsoEllipse(ctx, screenPos.x, screenPos.y, this.radius + 6, 'rgba(0, 0, 0, 0.25)');

    if (sprite) {
      drawSprite(ctx, sprite, screenPos.x, screenPos.y, 0.32, { pivotY: 0.82 });
    } else {
      drawIsoDiamond(ctx, screenPos.x, screenPos.y, this.radius + 2, '#6D4C41', '#4E342E');
      drawIsoBox(ctx, screenPos.x, screenPos.y - 2, this.radius * 0.55, 16, {
        top: '#FFD54F',
        left: '#F9A825',
        right: '#FFC107',
      });
    }

    if (this.selected || this.raidDamageCooldown > 0) {
      const barW = 28;
      const pct = Math.max(0, this.remainingAmount / Math.max(1, this.maxHp > 0 ? 5000 : 5000));
      // Use initial stock proxy via resourceAmount cap stored at spawn (~5000 typical).
      const stock = Math.min(1, this.remainingAmount / 5000);
      ctx.fillStyle = '#333';
      ctx.fillRect(screenPos.x - barW / 2, screenPos.y + 14, barW, 4);
      ctx.fillStyle = this.raidDamageCooldown > 0 ? '#E53935' : '#FFD54F';
      ctx.fillRect(screenPos.x - barW / 2, screenPos.y + 14, barW * stock, 4);
      void pct;
    }
  }
}
