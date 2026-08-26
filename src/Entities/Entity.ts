import type { FactionId } from '../Players/Types';

export abstract class Entity {
  public x: number;
  public y: number;
  public radius: number;
  public selected: boolean = false;
  public hp: number;
  public maxHp: number;
  /** Racial/visual faction — not the same as player seat. */
  public factionId: FactionId | 'neutral';
  /** Owning player seat; null = world/neutral (e.g. gold). */
  public ownerPlayerId: string | null;
  public id: number;
  public isDead: boolean = false;
  public lastAttacker: Entity | null = null;
  private static nextId = 0;

  constructor(
    x: number,
    y: number,
    radius: number,
    hp: number,
    factionId: FactionId | 'neutral',
    ownerPlayerId: string | null,
  ) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.hp = hp;
    this.maxHp = hp;
    this.factionId = factionId;
    this.ownerPlayerId = ownerPlayerId;
    this.id = Entity.nextId++;
  }

  /** For save/load — continue ids above restored entities. */
  public static peekNextId(): number {
    return Entity.nextId;
  }

  public static resetIdCounter(nextId: number) {
    Entity.nextId = Math.max(0, Math.floor(nextId));
  }

  /** Assign a fixed id (hydrate). Call after resetIdCounter setup. */
  public assignId(id: number) {
    this.id = id;
  }

  public takeDamage(amount: number, source?: Entity) {
    if (this.isDead) return;
    if (source && source !== this) this.lastAttacker = source;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.isDead = true;
    }
  }

  public abstract update(dt: number, entities?: Entity[], gameMap?: unknown): void;
  public abstract draw(ctx: CanvasRenderingContext2D, camera: any, gameMap?: unknown): void;
}
