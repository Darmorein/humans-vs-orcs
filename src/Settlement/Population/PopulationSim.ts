import type { FactionId } from '../../Players/Types';
import { doctrineOf } from '../../Players/FactionDoctrine';
import type { Settlement } from '../Settlement';
import {
  ALL_PROFESSIONS,
  ALL_TRAITS,
  type Citizen,
  type CitizenTrait,
  type ProfessionRole,
} from './Types';

let nextCitizenId = 1;

export function getNextCitizenId(): number {
  return nextCitizenId;
}
export function setNextCitizenId(n: number) {
  nextCitizenId = Math.max(1, Math.floor(n));
}

const FOOD_PER_CITIZEN = 0.45;
const MAX_AGE = 70;
const TICK = 1.0; // accumulate to ~1s steps for light sim

/**
 * Lightweight inhabitant simulation — not agent-per-tile.
 * Citizens consume food, need housing, gain professions from settlement needs,
 * and may be born, die, or migrate.
 */
export class PopulationSim {
  private accum = 0;

  /** Soft hook for chronicle (major migration coalescing). */
  public static onCitizenMigrated:
    | ((from: Settlement, to: Settlement, citizenId: string) => void)
    | null = null;

  public getAccum(): number {
    return this.accum;
  }

  public setAccum(v: number) {
    this.accum = Math.max(0, v);
  }

  /** Seed starting villagers when a settlement first gets a town center. */
  public seedIfEmpty(s: Settlement, factionId: FactionId, count = 8) {
    if (s.citizens.length > 0) return;
    const n = s.tier === 'camp' ? 5 : count;
    for (let i = 0; i < n; i++) {
      s.citizens.push(this.createCitizen(s.id, 16 + (i * 7) % 30, 'peasant'));
    }
    void factionId;
    s.population = s.citizens.length;
  }

  public update(dt: number, settlements: Settlement[], factionOf: (playerId: string) => FactionId) {
    this.accum += dt;
    if (this.accum < TICK) return;
    const step = this.accum;
    this.accum = 0;

    for (const s of settlements) {
      if (!s.hasTownCenter) continue;
      this.seedIfEmpty(s, factionOf(s.playerId));
      this.ageAndHealth(s, step);
      this.assignProfessions(s, factionOf(s.playerId));
      this.applyVitalNeeds(s, step);
      this.tryGrowth(s, step);
      this.tryDeaths(s);
      s.population = s.citizens.length;
    }

    this.tryMigration(settlements, step);
    for (const s of settlements) s.population = s.citizens.length;
  }

  public countByProfession(s: Settlement): Record<ProfessionRole, number> {
    const counts = Object.fromEntries(ALL_PROFESSIONS.map((p) => [p, 0])) as Record<
      ProfessionRole,
      number
    >;
    for (const c of s.citizens) counts[c.profession] += 1;
    return counts;
  }

  private createCitizen(
    settlementId: string,
    age: number,
    profession: ProfessionRole,
  ): Citizen {
    const traits: CitizenTrait[] = [];
    const t = ALL_TRAITS[Math.floor(hash(settlementId + nextCitizenId) * ALL_TRAITS.length) % ALL_TRAITS.length]!;
    traits.push(t);
    if (hash(settlementId + nextCitizenId + 9) > 0.7) {
      const t2 = ALL_TRAITS[Math.floor(hash(settlementId + nextCitizenId + 3) * ALL_TRAITS.length) % ALL_TRAITS.length]!;
      if (t2 !== t) traits.push(t2);
    }
    return {
      id: `c-${nextCitizenId++}`,
      age,
      profession,
      settlementId,
      health: 0.75 + hash(settlementId + nextCitizenId) * 0.25,
      experience: age * 0.4,
      traits,
      prestige: age * 0.2,
      heroId: null,
    };
  }

  private ageAndHealth(s: Settlement, dt: number) {
    for (const c of s.citizens) {
      c.age += dt / 40; // slow years
      c.experience = Math.min(100, c.experience + dt * 0.15);
      if (c.traits.includes('hardy')) c.health = Math.min(1, c.health + dt * 0.01);
      if (c.traits.includes('frail')) c.health -= dt * 0.008;
    }
  }

  /** Reassign idle/peasant-heavy workforce toward settlement needs. */
  private assignProfessions(s: Settlement, factionId: FactionId) {
    const d = doctrineOf(factionId);
    const counts = this.countByProfession(s);
    const n = s.citizens.length;
    if (n === 0) return;

    const targets: Record<ProfessionRole, number> = {
      peasant: Math.max(1, Math.floor(n * 0.15)),
      farmer: Math.max(s.farmCount, Math.ceil(n * (0.15 + s.needs.food * 0.25) * d.farmerBias)),
      lumberjack: Math.ceil(n * (s.wood < s.capacity.wood * 0.4 ? 0.18 : 0.08)),
      miner: Math.ceil(n * (s.stone < 40 || s.iron < 20 ? 0.14 : 0.06)),
      builder: Math.max(
        s.queue.list().length > 0 || s.needs.housing > 0.4 ? 2 : 1,
        Math.ceil(n * 0.1 * d.builderBias),
      ),
      craftsman: Math.ceil(n * (s.storageCount > 0 ? 0.12 : 0.05) * d.craftsmanBias),
      soldier: Math.ceil(
        n * (0.08 + s.needs.defense * 0.25 + s.threatPressure * 0.2) * d.soldierBias,
      ),
    };

    // Normalize so sum ~= n
    let sum = ALL_PROFESSIONS.reduce((a, p) => a + targets[p], 0);
    if (sum > n) {
      const scale = n / sum;
      for (const p of ALL_PROFESSIONS) targets[p] = Math.max(0, Math.floor(targets[p] * scale));
      targets.peasant = Math.max(0, n - ALL_PROFESSIONS.reduce((a, p) => a + (p === 'peasant' ? 0 : targets[p]), 0));
    } else {
      targets.peasant += n - sum;
    }

    const needMore = (role: ProfessionRole) => (counts[role] ?? 0) < targets[role];
    const needLess = (role: ProfessionRole) => (counts[role] ?? 0) > targets[role];

    for (const c of s.citizens) {
      if (!needLess(c.profession) && c.profession !== 'peasant') continue;
      const next = ALL_PROFESSIONS.find((p) => p !== c.profession && needMore(p));
      if (!next) continue;
      // Brave prefer soldier; industrious prefer crafts/build; lazy stay peasant longer
      if (next === 'soldier' && c.traits.includes('brave')) {
        /* prefer */
      } else if (next === 'peasant' && c.traits.includes('industrious')) continue;
      else if (c.traits.includes('lazy') && next !== 'peasant' && hash(c.id) > 0.55) continue;

      counts[c.profession] -= 1;
      c.profession = next;
      counts[next] += 1;
    }
  }

  private applyVitalNeeds(s: Settlement, dt: number) {
    const by = this.countByProfession(s);
    const foodProd =
      s.farmCount * 3.2 * dt + by.farmer * 0.55 * dt * (1 + this.traitWorkBonus(s, 'farmer'));
    const foodUse = s.citizens.length * FOOD_PER_CITIZEN * dt;
    s.food = clamp(s.food + foodProd - foodUse, 0, s.capacity.food);

    const woodGain =
      by.lumberjack * 0.7 * dt * (1 + this.traitWorkBonus(s, 'lumberjack')) + 0.15 * dt;
    const stoneGain = by.miner * 0.45 * dt;
    const ironGain = by.miner * 0.2 * dt;
    s.wood = clamp(s.wood + woodGain, 0, s.capacity.wood);
    s.stone = clamp(s.stone + stoneGain, 0, s.capacity.stone);
    s.iron = clamp(s.iron + ironGain, 0, s.capacity.iron);

    // Starvation damages health
    if (s.food < 1) {
      for (const c of s.citizens) c.health -= 0.04 * dt;
    } else if (s.food > s.capacity.food * 0.5) {
      for (const c of s.citizens) c.health = Math.min(1, c.health + 0.01 * dt);
    }

    // Overcrowding
    if (s.housing > 0 && s.citizens.length > s.housing) {
      for (const c of s.citizens) c.health -= 0.015 * dt;
    }
  }

  private traitWorkBonus(s: Settlement, role: ProfessionRole): number {
    let bonus = 0;
    for (const c of s.citizens) {
      if (c.profession !== role) continue;
      if (c.traits.includes('industrious')) bonus += 0.08;
      if (c.traits.includes('lazy')) bonus -= 0.05;
      bonus += c.experience * 0.001;
    }
    return bonus;
  }

  private tryGrowth(s: Settlement, dt: number) {
    const room = s.housing - s.citizens.length;
    if (room <= 0) return;
    if (s.food < 15) return;
    const chance = 0.02 * dt * (s.prosperity + 0.3) * Math.min(1, room / 3);
    if (hash(s.playerId + String(s.citizens.length) + Math.floor(s.food)) < chance) {
      s.citizens.push(this.createCitizen(s.id, 0, 'peasant'));
      s.food = Math.max(0, s.food - 8);
    }
  }

  private tryDeaths(s: Settlement) {
    s.citizens = s.citizens.filter((c) => {
      if (c.health <= 0) return false;
      if (c.age >= MAX_AGE + (c.traits.includes('hardy') ? 8 : 0)) return false;
      return true;
    });
  }

  /**
   * Migration uses attraction (food, housing, safety, prosperity, jobs)
   * scaled by distance between seats. Same-owner seats preferred; same-faction allowed.
   */
  private tryMigration(settlements: Settlement[], dt: number) {
    if (settlements.length < 2) return;
    for (const from of settlements) {
      if (from.citizens.length < 4 || !from.hasTownCenter) continue;
      const crowded = from.housing > 0 && from.citizens.length > from.housing;
      const hungry = from.food < 8;
      const fewJobs = from.jobs < 0.12;
      if (!crowded && !hungry && from.safety > 0.45 && !fewJobs) continue;

      const candidates = settlements
        .filter(
          (t) =>
            t.id !== from.id &&
            t.hasTownCenter &&
            t.playerId === from.playerId &&
            (t.housing <= 0 || t.citizens.length < t.housing),
        )
        .map((t) => {
          const dist = Math.hypot(t.centerX - from.centerX, t.centerY - from.centerY);
          const distFactor = 1 / (1 + dist / 420);
          const score =
            t.migrationAttraction * distFactor - from.migrationAttraction * 0.35;
          return { t, dist, score };
        })
        .filter((c) => c.score > 0.04)
        .sort((a, b) => b.score - a.score);

      const best = candidates[0];
      if (!best) continue;

      const chance = 0.02 * dt * best.score;
      if (hash(from.id + best.t.id + String(from.citizens.length)) > chance) continue;

      const idx = from.citizens.findIndex(
        (c) =>
          c.profession === 'peasant' ||
          c.health < 0.45 ||
          c.traits.includes('curious'),
      );
      const i = idx >= 0 ? idx : from.citizens.length - 1;
      const [mover] = from.citizens.splice(i, 1);
      if (!mover) continue;
      mover.settlementId = best.t.id;
      mover.profession = 'peasant';
      best.t.citizens.push(mover);
      PopulationSim.onCitizenMigrated?.(from, best.t, mover.id);
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export const populationSim = new PopulationSim();
