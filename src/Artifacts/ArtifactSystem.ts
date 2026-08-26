import { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import { Building } from '../Entities/Building';
import type { MatchState } from '../Players/MatchState';
import type { SettlementSystem } from '../Settlement/SettlementSystem';
import type { Settlement } from '../Settlement/Settlement';
import type { HeroSystem } from '../Heroes/HeroSystem';
import { isCombatUnitType } from '../Combat/Squad';
import { generateArtifactName } from './Names';
import {
  MAX_ARTIFACTS_PER_PLAYER,
  artifactQualityLabel,
  artifactTypeLabel,
  type Artifact,
  type ArtifactEffect,
  type ArtifactQuality,
  type ArtifactType,
} from './Types';
import { WorldHistory } from '../WorldHistory/WorldHistory';
import type { GameRng } from '../Sim/GameRng';

let nextArtifactSeq = 1;

export function getNextArtifactSeq(): number {
  return nextArtifactSeq;
}
export function setNextArtifactSeq(n: number) {
  nextArtifactSeq = Math.max(1, Math.floor(n));
}

/** Seconds → chronicle year (aligned with slow civic aging). */
const YEAR_SCALE = 40;

/**
 * Procedural artifacts born from world conditions (craft, heroes, materials, prosperity).
 * Ownership moves by gift, battle, loss, or faction seizure — not random loot drops.
 */
export class ArtifactSystem {
  public static active: ArtifactSystem | null = null;

  private artifacts = new Map<string, Artifact>();
  private elapsed = 0;
  private forgeTimer = 0;
  private readonly forgeInterval = 3.5;
  /** Per-settlement cooldown after a successful forge. */
  private forgeCooldown = new Map<string, number>();

  public all(): Artifact[] {
    return [...this.artifacts.values()];
  }

  public get(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  public forPlayer(playerId: string): Artifact[] {
    return this.all().filter((a) => !a.lost && a.currentOwnerId === playerId);
  }

  /** Replace all artifacts from a save snapshot. */
  public replaceAll(artifacts: Artifact[]) {
    this.artifacts.clear();
    this.forgeCooldown.clear();
    for (const a of artifacts) {
      this.artifacts.set(a.id, {
        ...a,
        effects: a.effects.map((fx) => ({ ...fx })),
        history: a.history.map((e) => ({ ...e })),
      });
    }
  }

  public getForUnit(unitId: number): Artifact | undefined {
    return this.all().find((a) => !a.lost && a.boundUnitId === unitId);
  }

  public update(
    dt: number,
    entities: Entity[],
    settlements: SettlementSystem,
    match: MatchState,
    heroes: HeroSystem,
    rng: GameRng,
  ) {
    this.elapsed += dt;
    this.forgeTimer += dt;
    for (const [sid, t] of [...this.forgeCooldown.entries()]) {
      const next = t - dt;
      if (next <= 0) this.forgeCooldown.delete(sid);
      else this.forgeCooldown.set(sid, next);
    }

    this.syncCarriers(entities);
    this.applyEffects(entities, settlements, match);

    if (this.forgeTimer >= this.forgeInterval) {
      this.forgeTimer = 0;
      this.tryForgeFromWorld(entities, settlements, match, heroes, rng);
    }
  }

  /**
   * When a carrier dies: victor's faction may seize the artifact;
   * otherwise it is lost on the field.
   */
  public noteCarrierKilled(victim: Unit, killer: Entity | null) {
    const art = this.getForUnit(victim.id);
    if (!art || art.lost) return;

    victim.artifactId = null;
    art.boundUnitId = null;
    this.restoreCarrierStats(victim);

    if (killer instanceof Unit && killer.ownerPlayerId && !killer.isDead) {
      const prevOwner = art.currentOwnerId;
      const prevFaction = art.factionId;
      art.currentOwnerId = killer.ownerPlayerId;
      art.factionId = killer.factionId === 'orcs' ? 'orcs' : 'humans';
      art.vaultSettlementId = null;

      if (!killer.artifactId && isCombatUnitType(killer.unitType)) {
        this.bindToUnit(art, killer);
        art.history.push({
          time: this.elapsed,
          text: `Seized in battle by ${killer.heroName ?? killer.unitType}`,
        });
      } else {
        art.vaultSettlementId = art.settlementCreatedId;
        art.history.push({
          time: this.elapsed,
          text: `Taken as a war prize into the victor's vault (was held by ${prevOwner})`,
        });
      }

      if (prevFaction !== art.factionId) {
        art.history.push({
          time: this.elapsed,
          text: `Claimed by the ${art.factionId === 'orcs' ? 'orc' : 'human'} faction`,
        });
        WorldHistory.active?.noteArtifactCaptured(
          art.name,
          victim.x,
          victim.y,
          prevFaction,
          art.factionId,
          killer.heroName ?? killer.unitType,
        );
      }
      return;
    }

    this.markLost(art, 'Abandoned on the battlefield');
  }

  /** Player gift / transfer to a living combat unit of the same owner. */
  public transferToUnit(artifactId: string, unit: Unit): boolean {
    const art = this.artifacts.get(artifactId);
    if (!art || art.lost || !unit.ownerPlayerId) return false;
    if (art.currentOwnerId !== unit.ownerPlayerId) return false;
    if (!isCombatUnitType(unit.unitType) || unit.isDead) return false;

    const previous = this.getForUnit(unit.id);
    if (previous && previous.id !== art.id) {
      this.returnToVault(previous, unit.ownerPlayerId);
    }

    if (art.boundUnitId != null && art.boundUnitId !== unit.id) {
      // Unequip previous carrier
      // (resolved in syncCarriers if unit gone)
    }

    this.bindToUnit(art, unit);
    art.history.push({
      time: this.elapsed,
      text: `Bestowed upon ${unit.heroName ?? unit.unitType}`,
    });
    return true;
  }

  /** Return an artifact to the settlement vault (still owned by player). */
  public returnToVault(art: Artifact, playerId: string, settlementId?: string) {
    if (art.lost) return;
    if (art.boundUnitId != null) {
      // carrier cleared by caller / sync
      art.boundUnitId = null;
    }
    art.currentOwnerId = playerId;
    art.vaultSettlementId = settlementId ?? art.settlementCreatedId;
    art.history.push({
      time: this.elapsed,
      text: 'Returned to the settlement vault',
    });
  }

  public unequipFromUnit(unit: Unit, settlements: SettlementSystem) {
    const art = this.getForUnit(unit.id);
    if (!art || !unit.ownerPlayerId) return;
    unit.artifactId = null;
    art.boundUnitId = null;
    this.restoreCarrierStats(unit);
    const seat = settlements.get(unit.ownerPlayerId);
    art.vaultSettlementId = seat?.id ?? art.settlementCreatedId;
    art.history.push({
      time: this.elapsed,
      text: `Set aside by ${unit.heroName ?? unit.unitType}`,
    });
  }

  // --- Forge from world conditions ---------------------------------------

  private tryForgeFromWorld(
    entities: Entity[],
    settlements: SettlementSystem,
    match: MatchState,
    heroes: HeroSystem,
    rng: GameRng,
  ) {
    for (const s of settlements.all()) {
      if (!s.hasTownCenter) continue;
      if (this.forgeCooldown.has(s.id)) continue;
      const player = match.getPlayer(s.playerId);
      if (!player || player.isDefeated) continue;
      if (this.forPlayer(player.id).length >= MAX_ARTIFACTS_PER_PLAYER) continue;

      const recipe = this.evaluateForgeRecipe(s, entities, heroes, player.factionId, rng);
      if (!recipe) continue;

      // Chance scales with how strongly conditions are met — not flat loot RNG.
      if (!rng.chance(recipe.chance)) continue;

      const costIron = recipe.ironCost;
      if (s.iron < costIron) continue;
      s.iron -= costIron;

      const art = this.createArtifact(recipe, s, player.factionId);
      this.artifacts.set(art.id, art);
      this.forgeCooldown.set(s.id, 90 + rng.next() * 40);
      WorldHistory.active?.noteArtifactCreated(
        art.name,
        artifactQualityLabel(art.quality),
        s,
        recipe.creatorId,
      );

      // Auto-equip to highest-prestige combat unit, else vault
      const carrier = this.pickCarrier(entities, player.id);
      if (carrier) {
        this.bindToUnit(art, carrier);
        art.history.push({
          time: this.elapsed,
          text: `First wielded by ${carrier.heroName ?? carrier.unitType}`,
        });
      } else {
        art.vaultSettlementId = s.id;
      }
    }
  }

  private evaluateForgeRecipe(
    s: Settlement,
    entities: Entity[],
    heroes: HeroSystem,
    factionId: 'humans' | 'orcs',
    rng: GameRng,
  ): ForgeRecipe | null {
    const hasSmithBuilding = entities.some(
      (e) =>
        e instanceof Building &&
        !e.isDead &&
        e.isConstructed &&
        e.ownerPlayerId === s.playerId &&
        e.buildingType === 'Blacksmith' &&
        (e.settlementId === s.id ||
          Math.hypot(e.x - s.centerX, e.y - s.centerY) < s.expansionRadius * 1.4),
    );

    const smithHero = heroes.heroesForPlayer(s.playerId).find((h) => {
      if (!h.alive || h.type !== 'legendarySmith') return false;
      if (!h.boundCitizenId) return true;
      return s.citizens.some((c) => c.id === h.boundCitizenId);
    });

    const highCraft = s.craftsmanship >= 0.55;
    const highProsperity = s.prosperity >= 0.48;
    const rareMaterial =
      s.iron >= 40 && s.iron / Math.max(1, s.capacity.iron) >= 0.5;

    // Primary recipe from the prompt
    if (highCraft && smithHero && rareMaterial && highProsperity && hasSmithBuilding) {
      const strength =
        (s.craftsmanship - 0.55) * 1.2 +
        (s.prosperity - 0.48) * 1.0 +
        Math.min(0.25, (s.iron - 40) / 80) +
        smithHero.prestige / 400;
      const quality = this.rollQuality(strength + s.craftsmanship * 0.3, rng);
      const type = this.pickCraftedType(factionId, s, rng);
      return {
        type,
        quality,
        creatorId: smithHero.id,
        chance: Math.min(0.42, 0.08 + strength * 0.55),
        ironCost: quality === 'legendary' ? 28 : quality === 'masterwork' ? 20 : 14,
        reason: 'High craftsmanship, master smith, rare iron, prosperity',
      };
    }

    // Secondary: faith + priest + temple (relic) — still condition-driven
    const priest = heroes.heroesForPlayer(s.playerId).find(
      (h) => h.alive && h.type === 'priest' && h.boundCitizenId &&
        s.citizens.some((c) => c.id === h.boundCitizenId),
    );
    const hasTemple = entities.some(
      (e) =>
        e instanceof Building &&
        !e.isDead &&
        e.buildingType === 'Temple' &&
        e.ownerPlayerId === s.playerId,
    );
    if (priest && hasTemple && s.faith >= 0.55 && s.prosperity >= 0.4) {
      const strength = (s.faith - 0.55) + priest.prestige / 350;
      return {
        type: 'relic',
        quality: this.rollQuality(strength + 0.35, rng),
        creatorId: priest.id,
        chance: Math.min(0.28, 0.06 + strength * 0.4),
        ironCost: 8,
        reason: 'High faith, priest, temple, prosperity',
      };
    }

    // War banner: tradition + captain/warchief + contested safety
    const warHero = heroes.heroesForPlayer(s.playerId).find(
      (h) =>
        h.alive &&
        (h.type === 'veteranCaptain' || h.type === 'warchief') &&
        h.boundUnitId != null,
    );
    if (
      warHero &&
      s.militaryTradition >= 0.55 &&
      s.threatPressure >= 0.2 &&
      s.prosperity >= 0.35
    ) {
      return {
        type: 'banner',
        quality: this.rollQuality(s.militaryTradition * 0.5 + warHero.prestige / 300, rng),
        creatorId: warHero.id,
        chance: Math.min(0.22, 0.05 + s.militaryTradition * 0.2),
        ironCost: 10,
        reason: 'Military tradition, war-leader, pressure of battle',
      };
    }

    return null;
  }

  private pickCraftedType(
    factionId: 'humans' | 'orcs',
    s: Settlement,
    rng: GameRng,
  ): ArtifactType {
    if (s.militaryTradition > s.craftsmanship) {
      return rng.chance(0.45) ? 'armor' : 'blade';
    }
    if (factionId === 'orcs' && rng.chance(0.35)) return 'blade';
    if (rng.chance(0.3)) return 'tool';
    if (rng.chance(0.35)) return 'bow';
    return rng.chance(0.5) ? 'blade' : 'armor';
  }

  private rollQuality(strength: number, rng: GameRng): ArtifactQuality {
    if (strength > 0.85 && rng.chance(0.22)) return 'legendary';
    if (strength > 0.45 && rng.chance(0.45)) return 'masterwork';
    return 'fine';
  }

  private createArtifact(
    recipe: ForgeRecipe,
    s: Settlement,
    factionId: 'humans' | 'orcs',
  ): Artifact {
    const id = `art-${nextArtifactSeq++}`;
    const salt = nextArtifactSeq * 17 + s.id.length * 3;
    const name = generateArtifactName(factionId, recipe.type, recipe.quality, salt);
    const year = Math.max(1, Math.floor(this.elapsed / YEAR_SCALE) + 1);
    const effects = this.buildEffects(recipe.type, recipe.quality);

    return {
      id,
      name,
      type: recipe.type,
      quality: recipe.quality,
      creatorId: recipe.creatorId,
      settlementCreatedId: s.id,
      yearCreated: year,
      currentOwnerId: s.playerId,
      factionId,
      boundUnitId: null,
      vaultSettlementId: s.id,
      effects,
      history: [
        {
          time: this.elapsed,
          text: `Forged in year ${year}: ${recipe.reason}`,
        },
        {
          time: this.elapsed,
          text: `${artifactQualityLabel(recipe.quality)} ${artifactTypeLabel(recipe.type)} — ${name}`,
        },
      ],
      lost: false,
    };
  }

  private buildEffects(type: ArtifactType, quality: ArtifactQuality): ArtifactEffect[] {
    const q =
      quality === 'legendary' ? 1.12 : quality === 'masterwork' ? 1.07 : 1.04;
    const effects: ArtifactEffect[] = [];
    switch (type) {
      case 'blade':
        effects.push({
          id: 'keen',
          label: 'Keen edge',
          attackMul: q,
          prestigeAura: quality === 'legendary' ? 4 : 2,
        });
        break;
      case 'bow':
        effects.push({
          id: 'trueflight',
          label: 'True flight',
          attackMul: 1 + (q - 1) * 0.8,
          rangeMul: q,
        });
        break;
      case 'armor':
        effects.push({
          id: 'ward',
          label: 'Warding plates',
          defenseMul: q,
        });
        break;
      case 'banner':
        effects.push({
          id: 'rally',
          label: 'Rallying banner',
          prestigeAura: quality === 'legendary' ? 8 : 5,
          attackMul: 1.03,
        });
        break;
      case 'relic':
        effects.push({
          id: 'blessing',
          label: 'Sacred blessing',
          faithAura: quality === 'legendary' ? 0.04 : 0.02,
          defenseMul: 1.03,
        });
        break;
      case 'tool':
        effects.push({
          id: 'master-tool',
          label: 'Master tools',
          craftsmanshipAura: quality === 'legendary' ? 0.05 : 0.03,
        });
        break;
    }
    return effects;
  }

  private bindToUnit(art: Artifact, unit: Unit) {
    if (art.boundUnitId != null && art.boundUnitId !== unit.id) {
      // Previous carrier reference cleared on next sync / unequip
    }
    if (unit.artifactId && unit.artifactId !== art.id) {
      const other = this.artifacts.get(unit.artifactId);
      if (other) {
        other.boundUnitId = null;
        other.vaultSettlementId = other.settlementCreatedId;
      }
    }
    art.boundUnitId = unit.id;
    art.vaultSettlementId = null;
    art.currentOwnerId = unit.ownerPlayerId ?? art.currentOwnerId;
    unit.artifactId = art.id;
    this.applyCarrierStats(unit, art, true);
  }

  private syncCarriers(entities: Entity[]) {
    const byId = new Map(
      entities.filter((e): e is Unit => e instanceof Unit).map((u) => [u.id, u]),
    );
    for (const art of this.artifacts.values()) {
      if (art.lost || art.boundUnitId == null) continue;
      const u = byId.get(art.boundUnitId);
      if (!u || u.isDead) {
        // Death path should call noteCarrierKilled; if still bound, vault it.
        art.boundUnitId = null;
        if (!art.lost) {
          art.vaultSettlementId = art.settlementCreatedId;
          art.history.push({
            time: this.elapsed,
            text: 'Recovered to the vault after the carrier fell',
          });
        }
        continue;
      }
      u.artifactId = art.id;
      if (u.ownerPlayerId) art.currentOwnerId = u.ownerPlayerId;
    }
  }

  private applyEffects(
    entities: Entity[],
    settlements: SettlementSystem,
    match: MatchState,
  ) {
    for (const art of this.artifacts.values()) {
      if (art.lost) continue;

      if (art.boundUnitId != null) {
        const u = entities.find(
          (e): e is Unit => e instanceof Unit && e.id === art.boundUnitId && !e.isDead,
        );
        if (u) this.applyCarrierStats(u, art, false);
      }

      // Vault auras on settlement
      if (art.boundUnitId == null && art.vaultSettlementId) {
        const s = settlements.getById(art.vaultSettlementId);
        if (!s) continue;
        for (const fx of art.effects) {
          if (fx.craftsmanshipAura) {
            s.craftsmanship = Math.min(1, s.craftsmanship + fx.craftsmanshipAura * 0.002);
          }
          if (fx.faithAura) {
            s.faith = Math.min(1, s.faith + fx.faithAura * 0.002);
          }
        }
      }
    }
    void match;
  }

  /**
   * Apply soft combat modifiers from the carried artifact.
   * Uses baseline fields so re-application stays stable.
   */
  private applyCarrierStats(unit: Unit, art: Artifact, initialBind: boolean) {
    if (!unit.artifactBase) {
      unit.artifactBase = {
        damage: unit.damage,
        maxHp: unit.maxHp,
        speed: unit.speed,
        attackRange: unit.attackRange,
      };
    }
    const base = unit.artifactBase;
    let atk = 1;
    let def = 1;
    let spd = 1;
    let rng = 1;
    let prestige = 0;
    for (const fx of art.effects) {
      if (fx.attackMul) atk *= fx.attackMul;
      if (fx.defenseMul) def *= fx.defenseMul;
      if (fx.speedMul) spd *= fx.speedMul;
      if (fx.rangeMul) rng *= fx.rangeMul;
      if (fx.prestigeAura) prestige += fx.prestigeAura;
    }
    unit.damage = Math.round(base.damage * atk);
    unit.speed = Math.round(base.speed * spd);
    unit.attackRange = Math.round(base.attackRange * rng);
    const newMax = Math.round(base.maxHp * def);
    if (initialBind || unit.maxHp !== newMax) {
      const ratio = unit.hp / Math.max(1, unit.maxHp);
      unit.maxHp = newMax;
      unit.hp = Math.min(newMax, Math.max(1, Math.round(newMax * ratio)));
    }
    if (prestige > 0 && initialBind) {
      unit.prestige = Math.min(100, unit.prestige + prestige * 0.15);
    }
  }

  private restoreCarrierStats(unit: Unit) {
    if (!unit.artifactBase) return;
    const base = unit.artifactBase;
    const ratio = unit.hp / Math.max(1, unit.maxHp);
    unit.damage = base.damage;
    unit.speed = base.speed;
    unit.attackRange = base.attackRange;
    unit.maxHp = base.maxHp;
    unit.hp = Math.min(base.maxHp, Math.max(1, Math.round(base.maxHp * ratio)));
    unit.artifactBase = null;
  }

  private pickCarrier(entities: Entity[], playerId: string): Unit | null {
    const combat = entities.filter(
      (e): e is Unit =>
        e instanceof Unit &&
        !e.isDead &&
        e.ownerPlayerId === playerId &&
        isCombatUnitType(e.unitType) &&
        !e.artifactId,
    );
    if (combat.length === 0) return null;
    combat.sort((a, b) => {
      const ha = a.isHero ? 20 : 0;
      const hb = b.isHero ? 20 : 0;
      return hb + b.prestige - (ha + a.prestige);
    });
    return combat[0] ?? null;
  }

  private markLost(art: Artifact, reason: string) {
    art.lost = true;
    art.boundUnitId = null;
    art.vaultSettlementId = null;
    art.history.push({ time: this.elapsed, text: `Lost: ${reason}` });
  }
}

interface ForgeRecipe {
  type: ArtifactType;
  quality: ArtifactQuality;
  creatorId: string;
  chance: number;
  ironCost: number;
  reason: string;
}
