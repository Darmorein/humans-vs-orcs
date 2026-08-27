import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginSquadEngage,
  beginSquadMarch,
  COMBAT_LEASH,
  findNearestValidFormationPoint,
  isValidFormationPoint,
  steerSquadMarch,
} from '../src/Combat/SquadMarch.ts';
import { Squad } from '../src/Combat/Squad.ts';
import { Unit } from '../src/Entities/Unit.ts';
import { Building } from '../src/Entities/Building.ts';
import { PlayerState } from '../src/Players/MatchState.ts';

const human = new PlayerState({
  id: 'p1',
  factionId: 'humans',
  controllerType: 'LOCAL',
  playerColor: '#4fc3f7',
  displayName: 'Humans',
});
const orc = new PlayerState({
  id: 'p2',
  factionId: 'orcs',
  controllerType: 'AI',
  playerColor: '#ef5350',
  displayName: 'Orcs',
});

function makeUnit(
  id: number,
  x: number,
  y: number,
  opts?: {
    type?: Unit['unitType'];
    owner?: PlayerState;
    range?: number;
  },
): Unit {
  const owner = opts?.owner ?? human;
  const u = new Unit(x, y, owner, {
    unitType: opts?.type ?? 'Swordsman',
    range: opts?.range ?? 35,
    damage: 5,
    speed: 60,
    hp: 100,
  });
  Object.defineProperty(u, 'id', { value: id, configurable: true });
  return u;
}

test('march discipline: retarget does not cancel formation seek for distant enemy', () => {
  const a = makeUnit(1, 0, 0);
  const enemy = makeUnit(2, 80, 0, { owner: orc, type: 'Grunt' });
  a.followSquadMarch = true;
  a.squadOrderMode = 'march';
  a.setFormationSeek(200, 0);

  a.update(0.05, [a, enemy]);

  assert.equal(a.targetX, 200);
  assert.equal(a.targetY, 0);
  assert.equal(a.followSquadMarch, true);
  assert.equal(a.targetEntity, null);
});

test('march discipline: ranged may fire in weapon range without dropping seek', () => {
  const archer = makeUnit(1, 0, 0, { type: 'Archer', range: 120 });
  const enemy = makeUnit(2, 50, 0, { owner: orc, type: 'Grunt' });
  archer.followSquadMarch = true;
  archer.squadOrderMode = 'march';
  archer.setFormationSeek(200, 0);

  archer.update(0.05, [archer, enemy]);

  assert.equal(archer.targetX, 200);
  assert.equal(archer.targetY, 0);
});

test('squad orderMode transitions: move → march, attack → engage', () => {
  const u1 = makeUnit(1, 0, 0);
  const u2 = makeUnit(2, 40, 0);
  const enemy = makeUnit(9, 200, 0, { owner: orc, type: 'Grunt' });
  const squad = new Squad('s1', 'p1', 'Swordsman');
  squad.memberIds = [1, 2];
  squad.leaderId = 1;
  u1.squadId = 's1';
  u2.squadId = 's1';

  beginSquadMarch(squad, 300, 0, [u1, u2], undefined, [u1, u2, enemy]);
  assert.equal(squad.orderMode, 'march');
  assert.equal(squad.marchActive, true);
  assert.equal(u1.squadOrderMode, 'march');
  assert.equal(u1.followSquadMarch, true);

  beginSquadEngage(squad, enemy, [u1, u2], undefined, [u1, u2, enemy]);
  assert.equal(squad.orderMode, 'engage');
  assert.equal(squad.engageActive, true);
  assert.equal(squad.primaryTargetId, enemy.id);
  assert.equal(u1.squadOrderMode, 'engage');
  assert.equal(u1.combatLeash, COMBAT_LEASH);
});

test('combat leash constant is formation-scaled', () => {
  assert.ok(COMBAT_LEASH >= 80);
  assert.ok(COMBAT_LEASH <= 120);
});

test('multi-member stuck arms squad repath cooldown', () => {
  const units: Unit[] = [];
  for (let i = 0; i < 4; i++) {
    units.push(makeUnit(i + 1, i * 40, 0));
  }
  const squad = new Squad('s2', 'p1', 'Swordsman');
  squad.memberIds = units.map((u) => u.id);
  squad.leaderId = 1;
  for (const u of units) u.squadId = 's2';

  beginSquadMarch(squad, 400, 0, units, undefined, units);
  for (const u of units) {
    (u as unknown as { stuckSignal: boolean }).stuckSignal = true;
  }
  steerSquadMarch(squad, units, 0.1, undefined, units);
  assert.ok(squad.stuckAccum >= 2);
  assert.ok(squad.repathCooldown > 0);
});

test('formation slot validation rejects building footprint', () => {
  const building = new Building(100, 100, 'TownHall', human, true);
  assert.equal(isValidFormationPoint(undefined, [building], 100, 100, 12), false);
  const near = findNearestValidFormationPoint(undefined, [building], 100, 100, 12, 96);
  assert.ok(isValidFormationPoint(undefined, [building], near.x, near.y, 12));
  assert.ok(Math.hypot(near.x - 100, near.y - 100) > 1);
});

test('engage combat slots stay frontal (not a full ring)', () => {
  const members: Unit[] = [];
  for (let i = 0; i < 6; i++) {
    members.push(makeUnit(i + 1, i * 20, 0));
  }
  const enemy = makeUnit(99, 0, -200, { owner: orc, type: 'Grunt' });
  const squad = new Squad('s3', 'p1', 'Swordsman');
  squad.memberIds = members.map((u) => u.id);
  squad.leaderId = 1;
  squad.formation = 'line';
  for (const u of members) u.squadId = 's3';

  beginSquadEngage(squad, enemy, members, undefined, [...members, enemy]);

  let maxSpreadFromEnemy = 0;
  let minSpreadFromEnemy = Infinity;
  for (const u of members) {
    assert.ok(u.targetX != null && u.targetY != null);
    const d = Math.hypot(u.targetX! - enemy.x, u.targetY! - enemy.y);
    maxSpreadFromEnemy = Math.max(maxSpreadFromEnemy, d);
    minSpreadFromEnemy = Math.min(minSpreadFromEnemy, d);
  }
  assert.ok(maxSpreadFromEnemy - minSpreadFromEnemy < 160, 'slots should form a front, not a ring');
  for (const u of members) {
    const dAnchor = Math.hypot(u.targetX! - squad.combatAnchorX, u.targetY! - squad.combatAnchorY);
    assert.ok(dAnchor < COMBAT_LEASH * 1.5);
  }
});

test('stuck recovery soft-places toward a valid point outside building', () => {
  const building = new Building(100, 100, 'TownHall', human, true);
  // Point inside solid → nearest valid must be outside.
  const trapped = findNearestValidFormationPoint(undefined, [building], 100, 100, 12, 72);
  assert.ok(isValidFormationPoint(undefined, [building], trapped.x, trapped.y, 12));
  assert.ok(Math.hypot(trapped.x - 100, trapped.y - 100) > 20);
});

test('building iso sort depth uses front edge beyond center', () => {
  function isoDepth(x: number, y: number) {
    return x + y;
  }
  function buildingDepth(b: { x: number; y: number; radius: number; height?: number }) {
    const front = Math.max(b.radius * 0.92, (b.height || b.radius * 2) * 0.45);
    return isoDepth(b.x, b.y + front);
  }
  const b = { x: 100, y: 100, radius: 40, height: 80 };
  assert.ok(buildingDepth(b) > isoDepth(b.x, b.y));
});
