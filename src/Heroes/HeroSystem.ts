import { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import { Building } from '../Entities/Building';
import type { MatchState } from '../Players/MatchState';
import type { SettlementSystem } from '../Settlement/SettlementSystem';
import type { Settlement } from '../Settlement/Settlement';
import type { Citizen } from '../Settlement/Population/Types';
import { isCombatUnitType } from '../Combat/Squad';
import { generateHeroName } from './Names';
import {
  MAX_HEROES_PER_PLAYER,
  heroTypeLabel,
  type AgentTrait,
  type Hero,
  type HeroType,
} from './Types';
import { WorldHistory } from '../WorldHistory/WorldHistory';

let nextHeroSeq = 1;

export function getNextHeroSeq(): number {
  return nextHeroSeq;
}
export function setNextHeroSeq(n: number) {
  nextHeroSeq = Math.max(1, Math.floor(n));
}

const COMBAT_TRAITS: AgentTrait[] = [
  'brave',
  'hardy',
  'bloodthirsty',
  'steadfast',
  'industrious',
  'curious',
  'wanderer',
  'pious',
];

/**
 * Emergent heroes: ordinary units/citizens rise via XP, feats, traits, prestige.
 * No recruitment menu — only career evaluation.
 */
export class HeroSystem {
  /** Set by Game so settlements/buildings can report feats without DI. */
  public static active: HeroSystem | null = null;

  private heroes = new Map<string, Hero>();
  private elapsed = 0;
  private evalTimer = 0;
  private readonly evalInterval = 2.2;

  public all(): Hero[] {
    return [...this.heroes.values()];
  }

  public get(id: string): Hero | undefined {
    return this.heroes.get(id);
  }

  public getForUnit(unitId: number): Hero | undefined {
    return this.all().find((h) => h.alive && h.boundUnitId === unitId);
  }

  public getForCitizen(citizenId: string): Hero | undefined {
    return this.all().find((h) => h.alive && h.boundCitizenId === citizenId);
  }

  public heroesForPlayer(playerId: string): Hero[] {
    return this.all().filter((h) => h.ownerPlayerId === playerId && h.alive);
  }

  /** Replace all heroes from a save snapshot. */
  public replaceAll(heroes: Hero[]) {
    this.heroes.clear();
    for (const h of heroes) {
      this.heroes.set(h.id, {
        ...h,
        traits: [...h.traits],
        history: h.history.map((e) => ({ ...e })),
      });
    }
  }

  public update(
    dt: number,
    entities: Entity[],
    settlements: SettlementSystem,
    match: MatchState,
  ) {
    this.elapsed += dt;
    this.evalTimer += dt;
    this.tickUnitCareers(dt, entities);
    this.tickCitizenCareers(dt, settlements, match);
    this.syncHeroStats(entities, settlements);
    this.applyHeroAuras(settlements, match);

    if (this.evalTimer >= this.evalInterval) {
      this.evalTimer = 0;
      this.evaluateEmergence(entities, settlements, match);
    }
  }

  /** Kill credited to a living agent — personal XP + prestige. */
  public noteKill(killer: Unit, victim: Unit) {
    if (killer.isDead || !killer.ownerPlayerId) return;
    this.ensureUnitCareer(killer);
    killer.killCount += 1;
    const xp = victim.isHero ? 16 : isCombatUnitType(victim.unitType) ? 10 : 5;
    killer.personalXp = Math.min(100, killer.personalXp + xp);
    killer.prestige = Math.min(100, killer.prestige + (victim.isHero ? 8 : 3.5));
    this.pushUnitHistory(killer, `Slew a ${victim.unitType}`);
    this.refreshBoundHero(killer);
  }

  public noteStructureRaised(builders: Unit[], building: Building) {
    for (const u of builders) {
      if (u.isDead || !u.ownerPlayerId) continue;
      this.ensureUnitCareer(u);
      u.structuresRaised += 1;
      u.personalXp = Math.min(100, u.personalXp + 5);
      u.prestige = Math.min(100, u.prestige + 3);
      this.pushUnitHistory(u, `Raised a ${building.buildingType}`);
      this.refreshBoundHero(u);
    }
  }

  public noteSettlementFounded(settlers: Unit[], playerId: string) {
    for (const u of settlers) {
      if (u.isDead || u.ownerPlayerId !== playerId) continue;
      this.ensureUnitCareer(u);
      u.settlementsFounded += 1;
      u.personalXp = Math.min(100, u.personalXp + 18);
      u.prestige = Math.min(100, u.prestige + 12);
      if (!u.agentTraits.includes('wanderer')) u.agentTraits.push('wanderer');
      this.pushUnitHistory(u, 'Founded a new settlement');
      this.refreshBoundHero(u);
    }
  }

  public noteHeroFallen(unit: Unit, killer?: Entity | null) {
    const hero = this.getForUnit(unit.id);
    if (!hero) return;
    hero.alive = false;
    hero.history.push({
      time: this.elapsed,
      text: `Fell in battle (${Math.floor(this.elapsed)}s)`,
    });
    const killerName =
      killer instanceof Unit ? killer.heroName ?? killer.unitType : undefined;
    WorldHistory.active?.noteHeroDied(hero.name, unit.x, unit.y, unit.id, killerName);
  }

  // --- Careers -----------------------------------------------------------

  private ensureUnitCareer(unit: Unit) {
    if (unit.agentTraits.length > 0) return;
    const salt = unit.id * 17 + (unit.ownerPlayerId?.length ?? 0);
    const a = COMBAT_TRAITS[Math.abs(salt) % COMBAT_TRAITS.length]!;
    const b = COMBAT_TRAITS[Math.abs(salt * 3 + 5) % COMBAT_TRAITS.length]!;
    unit.agentTraits = a === b ? [a] : [a, b];
  }

  private tickUnitCareers(dt: number, entities: Entity[]) {
    for (const e of entities) {
      if (!(e instanceof Unit) || e.isDead || !e.ownerPlayerId) continue;
      this.ensureUnitCareer(e);

      const moving =
        e.targetX !== null ||
        e.targetEntity !== null ||
        e.gatherTarget !== null ||
        e.buildTarget !== null;
      if (moving) {
        e.leaguesWalked += dt * 0.08;
        if (e.agentTraits.includes('wanderer') || e.agentTraits.includes('curious')) {
          e.personalXp = Math.min(100, e.personalXp + dt * 0.35);
        } else {
          e.personalXp = Math.min(100, e.personalXp + dt * 0.12);
        }
      }

      if (isCombatUnitType(e.unitType) && e.targetEntity) {
        e.personalXp = Math.min(100, e.personalXp + dt * 0.45);
      }

      if (e.buildTarget) {
        e.personalXp = Math.min(100, e.personalXp + dt * 0.25);
        if (e.agentTraits.includes('industrious')) {
          e.prestige = Math.min(100, e.prestige + dt * 0.15);
        }
      }

      // Soft prestige from being known (squad leader without yet being a Hero)
      if (e.squadId && !e.heroId && e.killCount > 0) {
        e.prestige = Math.min(100, e.prestige + dt * 0.08);
      }
    }
  }

  private tickCitizenCareers(dt: number, settlements: SettlementSystem, match: MatchState) {
    for (const s of settlements.all()) {
      const player = match.getPlayer(s.playerId);
      if (!player || player.isDefeated) continue;
      for (const c of s.citizens) {
        if (c.heroId) continue;
        c.prestige = Math.min(100, (c.prestige ?? 0) + dt * 0.05);
        if (c.profession === 'craftsman') {
          c.experience = Math.min(100, c.experience + dt * 0.35 * (1 + s.craftsmanship));
          c.prestige = Math.min(100, c.prestige + dt * 0.12 * s.craftsmanship);
        }
        if (c.profession === 'soldier') {
          c.experience = Math.min(100, c.experience + dt * 0.2);
          c.prestige = Math.min(100, c.prestige + dt * 0.08 * s.militaryTradition);
        }
        // Temples / faith nurture priests
        if (s.faith > 0.4 && (c.traits.includes('curious') || c.traits.includes('hardy'))) {
          c.prestige = Math.min(100, c.prestige + dt * 0.1 * s.faith);
        }
        if (c.traits.includes('curious')) {
          c.prestige = Math.min(100, c.prestige + dt * 0.06);
        }
      }
    }
  }

  private syncHeroStats(entities: Entity[], settlements: SettlementSystem) {
    const units = new Map(
      entities.filter((e): e is Unit => e instanceof Unit).map((u) => [u.id, u]),
    );
    for (const hero of this.heroes.values()) {
      if (!hero.alive) continue;
      if (hero.boundUnitId != null) {
        const u = units.get(hero.boundUnitId);
        if (!u || u.isDead) {
          hero.alive = false;
          hero.history.push({ time: this.elapsed, text: 'Lost to the ages' });
          continue;
        }
        hero.experience = u.personalXp;
        hero.prestige = u.prestige;
        hero.traits = [...u.agentTraits];
      }
      if (hero.boundCitizenId) {
        const c = this.findCitizen(settlements, hero.boundCitizenId);
        if (!c) {
          hero.alive = false;
          hero.history.push({ time: this.elapsed, text: 'Passed away in the settlement' });
          continue;
        }
        hero.experience = c.experience;
        hero.prestige = c.prestige ?? 0;
        hero.traits = [...c.traits];
      }
    }
  }

  private applyHeroAuras(settlements: SettlementSystem, match: MatchState) {
    for (const s of settlements.all()) {
      const player = match.getPlayer(s.playerId);
      if (!player) continue;
      const living = this.heroesForPlayer(s.playerId);
      for (const h of living) {
        if (h.type === 'legendarySmith' && h.boundCitizenId) {
          const c = s.citizens.find((x) => x.id === h.boundCitizenId);
          if (c) s.craftsmanship = Math.min(1, s.craftsmanship + 0.0008);
        }
        if (h.type === 'priest' && h.boundCitizenId) {
          const c = s.citizens.find((x) => x.id === h.boundCitizenId);
          if (c) {
            s.faith = Math.min(1, s.faith + 0.0007);
            s.safety = Math.min(1, s.safety + 0.0003);
          }
        }
        if (h.type === 'explorer') {
          s.influence = Math.min(1, s.influence + 0.0002);
        }
      }
    }
  }

  // --- Emergence ---------------------------------------------------------

  private evaluateEmergence(
    entities: Entity[],
    settlements: SettlementSystem,
    match: MatchState,
  ) {
    for (const player of match.allPlayers()) {
      if (player.isDefeated) continue;
      if (this.heroesForPlayer(player.id).length >= MAX_HEROES_PER_PLAYER) continue;

      const units = entities.filter(
        (e): e is Unit =>
          e instanceof Unit && !e.isDead && e.ownerPlayerId === player.id && !e.heroId,
      );
      for (const u of units) {
        this.ensureUnitCareer(u);
        const type = this.pickUnitHeroType(u, player.factionId);
        if (!type) continue;
        if (this.unitEmergenceScore(u, type) < this.thresholdFor(type)) continue;
        this.promoteUnit(u, type);
        if (this.heroesForPlayer(player.id).length >= MAX_HEROES_PER_PLAYER) break;
      }

      if (this.heroesForPlayer(player.id).length >= MAX_HEROES_PER_PLAYER) continue;

      for (const s of settlements.allForOwner(player.id)) {
        for (const c of s.citizens) {
          if (c.heroId) continue;
          const type = this.pickCitizenHeroType(c, s, player.factionId);
          if (!type) continue;
          if (this.citizenEmergenceScore(c, s, type) < this.thresholdFor(type)) continue;
          this.promoteCitizen(c, s, type, player.factionId, player.id);
          if (this.heroesForPlayer(player.id).length >= MAX_HEROES_PER_PLAYER) break;
        }
      }
    }
  }

  private thresholdFor(type: HeroType): number {
    switch (type) {
      case 'veteranCaptain':
      case 'warchief':
        return 52;
      case 'masterArcher':
        return 48;
      case 'legendarySmith':
        return 46;
      case 'priest':
        return 44;
      case 'explorer':
        return 42;
    }
  }

  private pickUnitHeroType(u: Unit, factionId: string): HeroType | null {
    if (u.unitType === 'Archer' || u.unitType === 'SpearOrc') return 'masterArcher';
    if (u.unitType === 'Swordsman') return 'veteranCaptain';
    if (u.unitType === 'Grunt') return 'warchief';
    if (u.unitType === 'Worker' || u.unitType === 'Peon') {
      if (u.settlementsFounded > 0 || u.leaguesWalked > 40) return 'explorer';
      return null;
    }
    void factionId;
    return null;
  }

  private pickCitizenHeroType(
    c: Citizen,
    s: Settlement,
    factionId: string,
  ): HeroType | null {
    void factionId;
    if (c.profession === 'craftsman') return 'legendarySmith';
    if (
      (c.traits.includes('curious') || c.traits.includes('hardy')) &&
      s.faith >= 0.35
    ) {
      return 'priest';
    }
    if (c.traits.includes('curious') && c.experience >= 35) return 'explorer';
    return null;
  }

  private unitEmergenceScore(u: Unit, type: HeroType): number {
    let score = u.personalXp * 0.45 + u.prestige * 0.4;
    score += u.killCount * 4;
    score += Math.min(20, u.leaguesWalked * 0.15);
    score += u.structuresRaised * 5;
    score += u.settlementsFounded * 22;

    if (u.agentTraits.includes('brave')) score += 8;
    if (u.agentTraits.includes('bloodthirsty') && (type === 'warchief' || type === 'veteranCaptain'))
      score += 10;
    if (u.agentTraits.includes('steadfast') && type === 'veteranCaptain') score += 8;
    if (u.agentTraits.includes('wanderer') && type === 'explorer') score += 12;
    if (u.agentTraits.includes('curious') && type === 'explorer') score += 8;
    if (u.agentTraits.includes('industrious') && type === 'explorer') score += 4;

    if (type === 'masterArcher' && u.isRanged) score += u.killCount * 2;
    if ((type === 'veteranCaptain' || type === 'warchief') && !u.isRanged) score += 6;

    return score;
  }

  private citizenEmergenceScore(c: Citizen, s: Settlement, type: HeroType): number {
    let score = c.experience * 0.5 + (c.prestige ?? 0) * 0.45;
    if (c.traits.includes('industrious')) score += 10;
    if (c.traits.includes('curious')) score += 8;
    if (c.traits.includes('hardy')) score += 5;
    if (c.traits.includes('brave')) score += 4;
    if (type === 'legendarySmith') score += s.craftsmanship * 25 + s.storageCount * 4;
    if (type === 'priest') score += s.faith * 30 + s.houseCount * 2;
    if (type === 'explorer') score += c.age * 0.4 + s.influence * 10;
    return score;
  }

  private promoteUnit(unit: Unit, type: HeroType) {
    if (!unit.ownerPlayerId || unit.heroId) return;
    const id = `hero-${nextHeroSeq++}`;
    const name = generateHeroName(unit.factionId as 'humans' | 'orcs', unit.id * 13);
    const title = heroTypeLabel(type, unit.factionId as 'humans' | 'orcs');
    const history = [
      {
        time: this.elapsed,
        text: `Emerged as ${title} from the ranks`,
      },
      ...unit.careerLog.slice(-4).map((text) => ({ time: this.elapsed, text })),
    ];

    const hero: Hero = {
      id,
      type,
      name,
      ownerPlayerId: unit.ownerPlayerId,
      factionId: unit.factionId as 'humans' | 'orcs',
      traits: [...unit.agentTraits],
      experience: unit.personalXp,
      prestige: unit.prestige,
      history,
      boundUnitId: unit.id,
      boundCitizenId: null,
      alive: true,
      emergedAt: this.elapsed,
    };

    this.heroes.set(id, hero);
    unit.heroId = id;
    unit.isHero = true;
    unit.heroName = name;
    this.applyUnitHeroBonus(unit, type);
    unit.prestige = Math.min(100, unit.prestige + 10);
    hero.prestige = unit.prestige;
    WorldHistory.active?.noteHeroEmerged(
      name,
      title,
      unit.x,
      unit.y,
      unit.id,
      null,
      unit.ownerPlayerId,
    );
  }

  private promoteCitizen(
    c: Citizen,
    s: Settlement,
    type: HeroType,
    factionId: 'humans' | 'orcs',
    playerId: string,
  ) {
    if (c.heroId) return;
    const salt = c.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const id = `hero-${nextHeroSeq++}`;
    const name = generateHeroName(factionId, salt);
    const title = heroTypeLabel(type, factionId);
    const hero: Hero = {
      id,
      type,
      name,
      ownerPlayerId: playerId,
      factionId,
      traits: [...c.traits],
      experience: c.experience,
      prestige: c.prestige ?? 0,
      history: [
        {
          time: this.elapsed,
          text: `Recognized as ${title} among the people of the settlement`,
        },
      ],
      boundUnitId: null,
      boundCitizenId: c.id,
      alive: true,
      emergedAt: this.elapsed,
    };
    this.heroes.set(id, hero);
    c.heroId = id;
    c.prestige = Math.min(100, (c.prestige ?? 0) + 12);
    hero.prestige = c.prestige;
    if (type === 'legendarySmith') s.craftsmanship = Math.min(1, s.craftsmanship + 0.08);
    if (type === 'priest') s.faith = Math.min(1, s.faith + 0.08);
    WorldHistory.active?.noteHeroEmerged(
      name,
      title,
      s.centerX,
      s.centerY,
      null,
      s.id,
      playerId,
    );
  }

  private applyUnitHeroBonus(unit: Unit, type: HeroType) {
    // Soft identity bonuses — not faction-wide flat HP buffs.
    switch (type) {
      case 'veteranCaptain':
      case 'warchief':
        unit.damage = Math.round(unit.damage * 1.08);
        unit.maxHp = Math.round(unit.maxHp * 1.06);
        unit.hp = Math.min(unit.maxHp, unit.hp + unit.maxHp * 0.06);
        break;
      case 'masterArcher':
        unit.attackRange = Math.round(unit.attackRange * 1.12);
        unit.damage = Math.round(unit.damage * 1.06);
        break;
      case 'explorer':
        unit.speed = Math.round(unit.speed * 1.1);
        break;
      default:
        break;
    }
  }

  private pushUnitHistory(unit: Unit, text: string) {
    unit.careerLog.push(text);
    if (unit.careerLog.length > 8) unit.careerLog.shift();
  }

  private refreshBoundHero(unit: Unit) {
    const hero = this.getForUnit(unit.id);
    if (!hero) return;
    hero.experience = unit.personalXp;
    hero.prestige = unit.prestige;
    hero.traits = [...unit.agentTraits];
  }

  private findCitizen(settlements: SettlementSystem, citizenId: string): Citizen | null {
    for (const s of settlements.all()) {
      const c = s.citizens.find((x) => x.id === citizenId);
      if (c) return c;
    }
    return null;
  }
}

/** Prefer emergent heroes when choosing a new squad leader. */
export function preferHeroLeader(candidates: Unit[]): Unit | null {
  if (candidates.length === 0) return null;
  const heroes = candidates.filter((u) => u.isHero || u.heroId);
  const pool = heroes.length > 0 ? heroes : candidates;
  return pool.reduce((best, u) => (u.prestige >= best.prestige ? u : best));
}
