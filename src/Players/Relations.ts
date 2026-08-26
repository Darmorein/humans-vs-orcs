import type { Entity } from '../Entities/Entity';

export function isNeutral(entity: Entity): boolean {
  return entity.ownerPlayerId === null || entity.factionId === 'neutral';
}

export function isOwnedBy(entity: Entity, playerId: string): boolean {
  return entity.ownerPlayerId === playerId;
}

/** Combat hostility: different owners. Neutral resources are never hostile. */
export function isHostile(a: Entity, b: Entity): boolean {
  if (isNeutral(a) || isNeutral(b)) return false;
  return a.ownerPlayerId !== b.ownerPlayerId;
}

export function isAlly(a: Entity, b: Entity): boolean {
  if (isNeutral(a) || isNeutral(b)) return false;
  return a.ownerPlayerId === b.ownerPlayerId;
}
