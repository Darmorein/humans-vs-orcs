/**
 * City-centric match pacing knobs and documented timeline targets.
 *
 * Design intent (mobile skirmish ~12–18 min):
 * - Living start → Outpost mid-game → Second city later (~5–7 min), not immediately.
 * - Second city is intentionally gated (higher settler pop / Town tier / treasury).
 * - Soft dominance after 15 min nudges a resolve without replacing capital victory.
 *
 * Measured benchmarks: fill via MatchPacingDiagnostics during play / AI-vs-AI runs.
 */

/** Soft cap before dominance phase (seconds). */
export const MATCH_SOFT_CAP_SEC = 15 * 60;
/** After soft cap, wait this long then optional score resolve. */
export const MATCH_DOMINANCE_RESOLVE_SEC = 90;

/** Capital influence strength multiplier in InfluenceMap. */
export const CAPITAL_INFLUENCE_STRENGTH_MUL = 1.25;

/**
 * Timeline targets (wall-clock seconds of sim). Measured may be N/A without a run.
 */
export const PACING_TARGETS = {
  firstArmyCommand: 45,
  firstContact: 180,
  firstBattle: 300,
  firstOutpost: 240,
  /** Delayed second city — not immediate from living village start. */
  secondCity: 360,
  matchSoftCap: MATCH_SOFT_CAP_SEC,
  matchIdealEnd: 900,
} as const;

/**
 * Tunables mirrored into FactionDoctrine / SettlementSystem / SettlerGroup.
 * Prefer editing doctrine + SettlementSystem constants; this documents the package.
 */
export const CITY_PACING = {
  /** Humans settler gate — raised so City2 is mid-match. */
  humansSettlerMinPop: 20,
  humansSettlerGoldCost: 165,
  /** Orcs settler gate — still earlier than humans, not free. */
  orcsSettlerMinPop: 16,
  orcsSettlerGoldCost: 120,
  /** Caravan travel after founding is allowed. */
  settlerCaravanSpeed: 55,
  /** Outpost before City2 — cheaper / closer. */
  outpostCostScale: 0.6,
  outpostMinDistFromTc: 120,
  /** Territorial gold bump for shorter matches. */
  goldBaseExtraction: 3.0,
  /** Mild farming / mining specialization ease only. */
  farmingFarmThreshold: 2,
  miningIronThreshold: 40,
  miningStoneThreshold: 40,
  /** Living start civic seed. */
  localStartPop: 42,
  aiStartPop: 48,
  startLocalGold: 100,
  startFood: 70,
} as const;

/**
 * Runtime pacing probe — updated each sim tick from Game / command hooks.
 * Dev overlay when `?debug=1` or always as muted corner text.
 */
export class MatchPacingDiagnostics {
  public timeToFirstArmyCommand: number | null = null;
  public timeToFirstContact: number | null = null;
  public timeToFirstBattle: number | null = null;
  public timeToFirstOutpost: number | null = null;
  public timeToSecondCity: number | null = null;
  public matchDuration = 0;
  public peakCities = 0;
  public peakSquads = 0;

  public noteArmyCommand(elapsedSec: number) {
    if (this.timeToFirstArmyCommand == null) {
      this.timeToFirstArmyCommand = elapsedSec;
    }
  }

  public noteContact(elapsedSec: number) {
    if (this.timeToFirstContact == null) {
      this.timeToFirstContact = elapsedSec;
    }
  }

  public noteBattle(elapsedSec: number) {
    if (this.timeToFirstBattle == null) {
      this.timeToFirstBattle = elapsedSec;
    }
  }

  public noteOutpost(elapsedSec: number) {
    if (this.timeToFirstOutpost == null) {
      this.timeToFirstOutpost = elapsedSec;
    }
  }

  public noteSecondCity(elapsedSec: number) {
    if (this.timeToSecondCity == null) {
      this.timeToSecondCity = elapsedSec;
    }
  }

  public tick(elapsedSec: number, cityCount: number, squadCount: number) {
    this.matchDuration = elapsedSec;
    this.peakCities = Math.max(this.peakCities, cityCount);
    this.peakSquads = Math.max(this.peakSquads, squadCount);
  }

  /** Compact one-line HUD string. */
  public formatLine(): string {
    const f = (v: number | null) => (v == null ? '—' : `${Math.floor(v)}s`);
    return (
      `pace t${Math.floor(this.matchDuration)}s ` +
      `army${f(this.timeToFirstArmyCommand)} ` +
      `contact${f(this.timeToFirstContact)} ` +
      `battle${f(this.timeToFirstBattle)} ` +
      `outpost${f(this.timeToFirstOutpost)} ` +
      `city2${f(this.timeToSecondCity)} ` +
      `peakC${this.peakCities} sq${this.peakSquads}`
    );
  }

  public capture(): MatchPacingDiagSnapshot {
    return {
      timeToFirstArmyCommand: this.timeToFirstArmyCommand,
      timeToFirstContact: this.timeToFirstContact,
      timeToFirstBattle: this.timeToFirstBattle,
      timeToFirstOutpost: this.timeToFirstOutpost,
      timeToSecondCity: this.timeToSecondCity,
      matchDuration: this.matchDuration,
      peakCities: this.peakCities,
      peakSquads: this.peakSquads,
    };
  }

  public restore(snap: MatchPacingDiagSnapshot | undefined | null) {
    if (!snap) return;
    this.timeToFirstArmyCommand = snap.timeToFirstArmyCommand ?? null;
    this.timeToFirstContact = snap.timeToFirstContact ?? null;
    this.timeToFirstBattle = snap.timeToFirstBattle ?? null;
    this.timeToFirstOutpost = snap.timeToFirstOutpost ?? null;
    this.timeToSecondCity = snap.timeToSecondCity ?? null;
    this.matchDuration = snap.matchDuration ?? 0;
    this.peakCities = snap.peakCities ?? 0;
    this.peakSquads = snap.peakSquads ?? 0;
  }
}

export interface MatchPacingDiagSnapshot {
  timeToFirstArmyCommand: number | null;
  timeToFirstContact: number | null;
  timeToFirstBattle: number | null;
  timeToFirstOutpost: number | null;
  timeToSecondCity: number | null;
  matchDuration: number;
  peakCities: number;
  peakSquads: number;
}

/** Strategic score for soft dominance resolve (higher = winning). */
export function strategicDominanceScore(args: {
  cityCount: number;
  territoryShare: number;
  armyCount: number;
}): number {
  return args.cityCount * 40 + args.territoryShare * 100 + args.armyCount * 3;
}
