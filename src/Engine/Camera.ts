import { isoToWorld, worldToIso } from './Iso';

export class Camera {
  public x: number = 0;
  public y: number = 0;
  private moveSpeed: number = 500;
  public width: number;
  public height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  public update(dt: number, input: any) {
    if (input.keys['KeyW'] || input.keys['ArrowUp']) this.y -= this.moveSpeed * dt;
    if (input.keys['KeyS'] || input.keys['ArrowDown']) this.y += this.moveSpeed * dt;
    if (input.keys['KeyA'] || input.keys['ArrowLeft']) this.x -= this.moveSpeed * dt;
    if (input.keys['KeyD'] || input.keys['ArrowRight']) this.x += this.moveSpeed * dt;
  }

  public resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  public centerOn(worldX: number, worldY: number) {
    const iso = worldToIso(worldX, worldY);
    this.x = iso.x - this.width / 2;
    this.y = iso.y - this.height / 2;
  }

  public screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return isoToWorld(screenX + this.x, screenY + this.y);
  }

  public worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const iso = worldToIso(worldX, worldY);
    return {
      x: iso.x - this.x,
      y: iso.y - this.y,
    };
  }
}
