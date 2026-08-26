import type { Unit } from '../Entities/Unit';
import type { SquadFormation } from './FormationDefs';
import { MORALE_DEFAULT } from './Morale';

export type { SquadFormation } from './FormationDefs';
export type CombatUnitType = 'Swordsman' | 'Archer' | 'Grunt' | 'SpearOrc';

export const SQUAD_MAX_SIZE = 10;

export function isCombatUnitType(type: string): type is CombatUnitType {
  return (
    type === 'Swordsman' ||
    type === 'Archer' ||
    type === 'Grunt' ||
    type === 'SpearOrc'
  );
}

export function squadDisplayName(type: CombatUnitType): string {
  switch (type) {
    case 'Swordsman':
      return 'Swordsmen';
    case 'Archer':
      return 'Archers';
    case 'Grunt':
      return 'Orc Grunts';
    case 'SpearOrc':
      return 'Orc Spears';
  }
}

/**
 * Squad aggregate. Individual Units remain simulated; this is the player-facing control unit.
 */
export class Squad {
  public readonly id: string;
  public readonly ownerPlayerId: string;
  public readonly unitType: CombatUnitType;

  public memberIds: number[] = [];
  public leaderId: number | null = null;

  /** Morale 0–100. Critical → ROUT. */
  public morale = MORALE_DEFAULT;
  /** Broken — ignores normal orders and flees. */
  public routing = false;
  public experience = 0;
  public victories = 0;
  public formation: SquadFormation = 'line';

  public facingX = 0;
  public facingY = 1;

  public movementSpeed = 60;
  public attackStrength = 10;
  public defense = 0.1;
  public range = 30;

  public lastMemberCount = 0;
  public lastLeaderId: number | null = null;
  /** Last hold-position heuristic total (debug / UI). */
  public lastTacticalScore = 0;
  public lastTacticalSummary = '';

  public readonly maxSize: number;

  constructor(
    id: string,
    ownerPlayerId: string,
    unitType: CombatUnitType,
    maxSize = SQUAD_MAX_SIZE,
  ) {
    this.id = id;
    this.ownerPlayerId = ownerPlayerId;
    this.unitType = unitType;
    this.maxSize = maxSize;
  }

  public get size(): number {
    return this.memberIds.length;
  }

  public get isFull(): boolean {
    return this.memberIds.length >= this.maxSize;
  }

  public get label(): string {
    const base = `${squadDisplayName(this.unitType)}  ${this.size} / ${this.maxSize}`;
    return this.routing ? `${base}  ROUT` : base;
  }

  public centroid(unitsById: Map<number, Unit>): { x: number; y: number } | null {
    let x = 0;
    let y = 0;
    let n = 0;
    for (const id of this.memberIds) {
      const u = unitsById.get(id);
      if (!u || u.isDead) continue;
      x += u.x;
      y += u.y;
      n++;
    }
    if (n === 0) return null;
    return { x: x / n, y: y / n };
  }
}
