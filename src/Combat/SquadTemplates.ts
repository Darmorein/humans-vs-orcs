import type { FactionId } from '../Players/Types';
import { FACTIONS } from '../Players/Types';
import type { CombatUnitType } from './Squad';
import { getUnitDef } from '../Sim/UnitCatalog';
import { doctrineOf } from '../Players/FactionDoctrine';

/**
 * Data-driven squad recruitment product.
 * Members remain Unit entities; the template is the production / UI unit.
 */
export interface SquadTemplate {
  id: string;
  displayName: string;
  factionId: FactionId;
  memberUnitType: CombatUnitType;
  targetSize: number;
  minimumDeploySize: number;
  /** Base treasury before doctrine mul (bulk of member costs). */
  treasuryCost: number;
  manpowerCost: number;
  /** Seconds of sim time to train a full squad. */
  trainTime: number;
  requiredCapability: 'barracks';
}

const BULK_DISCOUNT = 0.9;
const TRAIN_TIME_SEC = 12;
const TARGET_SIZE = 4;

function memberTreasury(unitType: CombatUnitType, factionId: FactionId): number {
  const def = getUnitDef(unitType);
  const base = def?.goldCost ?? 80;
  const mul = doctrineOf(factionId).militaryTrainGoldMul;
  return Math.floor(base * mul);
}

function buildTemplate(
  id: string,
  displayName: string,
  factionId: FactionId,
  memberUnitType: CombatUnitType,
): SquadTemplate {
  const per = memberTreasury(memberUnitType, factionId);
  return {
    id,
    displayName,
    factionId,
    memberUnitType,
    targetSize: TARGET_SIZE,
    minimumDeploySize: TARGET_SIZE,
    treasuryCost: Math.floor(per * TARGET_SIZE * BULK_DISCOUNT),
    manpowerCost: TARGET_SIZE,
    trainTime: TRAIN_TIME_SEC,
    requiredCapability: 'barracks',
  };
}

const TEMPLATES: SquadTemplate[] = [
  buildTemplate('humans-infantry', 'Human Infantry Squad', 'humans', 'Swordsman'),
  buildTemplate('humans-archers', 'Human Archer Squad', 'humans', 'Archer'),
  buildTemplate('orcs-grunts', 'Orc Grunt Squad', 'orcs', 'Grunt'),
  buildTemplate('orcs-spears', 'Orc Spear Squad', 'orcs', 'SpearOrc'),
];

export function allSquadTemplates(): readonly SquadTemplate[] {
  return TEMPLATES;
}

export function getSquadTemplate(id: string): SquadTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function squadTemplatesForFaction(factionId: FactionId): SquadTemplate[] {
  return TEMPLATES.filter((t) => t.factionId === factionId);
}

/** Melee / ranged defaults for a faction (AI + starter). */
export function defaultMeleeSquadTemplate(factionId: FactionId): SquadTemplate {
  const f = FACTIONS[factionId];
  return (
    TEMPLATES.find((t) => t.factionId === factionId && t.memberUnitType === f.meleeType) ??
    TEMPLATES[0]!
  );
}

export function defaultRangedSquadTemplate(factionId: FactionId): SquadTemplate {
  const f = FACTIONS[factionId];
  return (
    TEMPLATES.find((t) => t.factionId === factionId && t.memberUnitType === f.rangedType) ??
    TEMPLATES[1]!
  );
}

/** Per-member reinforce cost (no bulk discount). */
export function reinforceMemberTreasuryCost(
  template: SquadTemplate,
  factionId: FactionId,
): number {
  return memberTreasury(template.memberUnitType, factionId);
}

/** Short reinforce delay scales with missing count. */
export function reinforceTrainTime(missing: number): number {
  return Math.max(4, missing * 3);
}
