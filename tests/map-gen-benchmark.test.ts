import assert from 'node:assert/strict';
import test from 'node:test';
import { MapGenerator } from '../src/Map/MapGenerator';
import { MAP_CONFIG, MAP_GENERATOR_VERSION, MAP_SIZE_PRESETS } from '../src/Map/MapConfig';

const SEED_COUNT = 100;
const FORCE_CORRIDOR_MAX_RATIO = 0.05;

test('map generator version is 2 and standard size is 160', () => {
  assert.equal(MAP_GENERATOR_VERSION, 2);
  assert.equal(MAP_CONFIG.width, 160);
  assert.equal(MAP_CONFIG.height, 160);
  assert.equal(MAP_SIZE_PRESETS.standard.width, 160);
});

test('same seed is deterministic', () => {
  assert.equal(MapGenerator.assertDeterministic(4242), true);
});

test('100-seed strategic quality benchmark', () => {
  let valid = 0;
  let forceCorridor = 0;
  let repairSum = 0;
  let diversitySum = 0;
  let expandBalSum = 0;
  let mainEtaSum = 0;
  let flankEtaSum = 0;
  let mainEtaN = 0;
  let flankEtaN = 0;
  let contactProxySum = 0;
  let contactProxyN = 0;
  const worst: Array<{ seed: number; reason: string; score: number }> = [];

  const t0 = Date.now();
  for (let i = 0; i < SEED_COUNT; i++) {
    const seed = (1000 + i * 9973) >>> 0;
    const map = MapGenerator.create(seed);
    const v = map.validation;
    if (v.ok) valid++;
    if (map.forceCorridorUsed || v.forceCorridorUsed) forceCorridor++;
    repairSum += v.repairPasses ?? v.repairs.length;
    diversitySum += v.routeDiversityScore ?? 0;
    const bal =
      1 -
      Math.min(
        1,
        Math.abs((v.expansionSiteCountA ?? 0) - (v.expansionSiteCountB ?? 0)) / 4,
      );
    expandBalSum += bal;
    if (Number.isFinite(v.mainRouteTravelTime) && v.mainRouteTravelTime < 1e6) {
      mainEtaSum += v.mainRouteTravelTime;
      mainEtaN++;
    }
    if (Number.isFinite(v.alternateRouteTravelTime) && v.alternateRouteTravelTime < 1e6) {
      flankEtaSum += v.alternateRouteTravelTime;
      flankEtaN++;
    }
    if (Number.isFinite(v.mainRouteTravelTime) && v.mainRouteTravelTime < 1e6) {
      contactProxySum += v.mainRouteTravelTime * 0.5;
      contactProxyN++;
    }

    let score = 0;
    const reasons: string[] = [];
    if (!v.ok) {
      score += 50;
      reasons.push('invalid');
    }
    if (map.forceCorridorUsed) {
      score += 40;
      reasons.push('forceCorridor');
    }
    if ((v.routeDiversityScore ?? 0) < 0.35) {
      score += 15;
      reasons.push(`lowDiversity=${(v.routeDiversityScore ?? 0).toFixed(2)}`);
    }
    if ((v.expansionSiteCountA ?? 0) < 1 || (v.expansionSiteCountB ?? 0) < 1) {
      score += 20;
      reasons.push('missingExpansion');
    }
    if (score > 0) {
      worst.push({ seed, reason: reasons.join(','), score });
    }
  }
  const elapsed = Date.now() - t0;

  worst.sort((a, b) => b.score - a.score);
  const topWorst = worst.slice(0, 5);

  const forceRatio = forceCorridor / SEED_COUNT;
  console.info(
    `[MapBench] n=${SEED_COUNT} valid=${valid} forceCorridor=${forceCorridor} (${(forceRatio * 100).toFixed(1)}%) ` +
      `avgRepair=${(repairSum / SEED_COUNT).toFixed(2)} avgDiversity=${(diversitySum / SEED_COUNT).toFixed(2)} ` +
      `avgExpandBal=${(expandBalSum / SEED_COUNT).toFixed(2)} ` +
      `avgMainETA=${mainEtaN ? (mainEtaSum / mainEtaN).toFixed(1) : '—'}s ` +
      `avgFlankETA=${flankEtaN ? (flankEtaSum / flankEtaN).toFixed(1) : '—'}s ` +
      `avgContactProxy=${contactProxyN ? (contactProxySum / contactProxyN).toFixed(1) : '—'}s ` +
      `genMs=${elapsed} worst=${JSON.stringify(topWorst)}`,
  );

  assert.ok(valid >= SEED_COUNT * 0.85, `valid maps ${valid}/${SEED_COUNT}`);
  assert.ok(
    forceRatio <= FORCE_CORRIDOR_MAX_RATIO,
    `forceCorridor ${(forceRatio * 100).toFixed(1)}% exceeds ${(FORCE_CORRIDOR_MAX_RATIO * 100).toFixed(0)}%`,
  );
});

test('performance smoke: compact/standard/large generate', () => {
  const times: Record<string, number> = {};
  for (const id of ['compact', 'standard', 'large'] as const) {
    const t0 = Date.now();
    MapGenerator.create(777, id);
    times[id] = Date.now() - t0;
  }
  assert.ok(times.standard! < 8000, `standard gen ${times.standard}ms too slow`);
  console.info(`[MapBench] genTimes ms=${JSON.stringify(times)}`);
});
