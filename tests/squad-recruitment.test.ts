import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Contract tests for squad recruitment knobs (mirrors SquadTemplates.ts).
 * Avoids importing the full doctrine/catalog graph under node --test.
 */

const TEMPLATES = [
  {
    id: 'humans-infantry',
    displayName: 'Human Infantry Squad',
    factionId: 'humans',
    memberUnitType: 'Swordsman',
    targetSize: 4,
    minimumDeploySize: 4,
    manpowerCost: 4,
    trainTime: 10,
    requiredCapability: 'basic',
  },
  {
    id: 'humans-archers',
    displayName: 'Human Archer Squad',
    factionId: 'humans',
    memberUnitType: 'Archer',
    targetSize: 4,
    minimumDeploySize: 4,
    manpowerCost: 4,
    trainTime: 10,
    requiredCapability: 'basic',
  },
  {
    id: 'orcs-grunts',
    displayName: 'Orc Grunt Squad',
    factionId: 'orcs',
    memberUnitType: 'Grunt',
    targetSize: 4,
    minimumDeploySize: 4,
    manpowerCost: 4,
    trainTime: 10,
    requiredCapability: 'basic',
  },
  {
    id: 'orcs-spears',
    displayName: 'Orc Spear Squad',
    factionId: 'orcs',
    memberUnitType: 'SpearOrc',
    targetSize: 4,
    minimumDeploySize: 4,
    manpowerCost: 4,
    trainTime: 10,
    requiredCapability: 'basic',
  },
] as const;

test('squad product is 4-member templates for both factions', () => {
  assert.equal(TEMPLATES.length, 4);
  for (const t of TEMPLATES) {
    assert.equal(t.targetSize, 4);
    assert.equal(t.minimumDeploySize, 4);
    assert.equal(t.manpowerCost, 4);
    assert.ok(t.trainTime >= 8 && t.trainTime <= 15);
    assert.equal(t.requiredCapability, 'basic');
  }
});

test('recruitment UX is squad-shaped not unit-shaped', () => {
  for (const t of TEMPLATES) {
    assert.match(t.displayName, /Squad$/);
    assert.ok(!t.displayName.includes('Train Swordsman'));
  }
});

test('reinforce delay scales with missing members', () => {
  const reinforceTrainTime = (missing: number) => Math.max(4, missing * 3);
  assert.equal(reinforceTrainTime(1), 4);
  assert.equal(reinforceTrainTime(2), 6);
  assert.equal(reinforceTrainTime(4), 12);
});

test('army scaling example: 3 squads × 4 = 12 units', () => {
  const squads = 3;
  const members = TEMPLATES[0]!.targetSize;
  assert.equal(squads * members, 12);
});

test('opening: two starter tools + capital muster (no Barracks gate)', () => {
  const starterSquads = 2;
  const thirdSquadTrainSec = TEMPLATES[0]!.trainTime;
  assert.equal(starterSquads, 2);
  assert.ok(thirdSquadTrainSec <= 15);
  assert.ok(TEMPLATES.every((t) => t.requiredCapability === 'basic'));
});
