import { assets, drawSprite } from '../Assets/Assets';
import { drawIsoBox, drawIsoDiamond, drawIsoEllipse } from '../Engine/Iso';
import { Entity } from './Entity';

export class ResourceNode extends Entity {
  public resourceAmount: number;

  constructor(x: number, y: number, amount: number) {
    super(x, y, 20, 10000, 'neutral', null);
    this.resourceAmount = amount;
  }

  public update(_dt: number, _entities?: Entity[], _gameMap?: unknown) {}

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
  }
}
