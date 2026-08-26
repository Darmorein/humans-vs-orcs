import { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import { Building, isMainBuilding } from '../Entities/Building';
import { MatchState } from '../Players/MatchState';
import { isOwnedBy } from '../Players/Relations';
import { FACTIONS } from '../Players/Types';
import type { BuildingType } from '../Entities/Building';
import {
  getRecipe,
  strategicOptionsForFaction,
  type ConstructionTarget,
} from '../Settlement/ConstructionCatalog';
import { populationSim, professionLabel } from '../Settlement/Population';
import { TIER_DEFS } from '../Settlement/SettlementTier';
import {
  SETTLEMENT_FOCUSES,
  settlementFocusLabel,
  specializationLabel,
  type SettlementFocus,
} from '../Settlement/SettlementFocus';
import { doctrineOf } from '../Players/FactionDoctrine';
import { isCombatUnitType } from '../Combat/Squad';
import { ALL_FORMATIONS, formationLabel } from '../Combat/FormationDefs';
import { heroTypeLabel } from '../Heroes';
import { artifactQualityLabel, artifactTypeLabel } from '../Artifacts';
import { getUnitDef } from '../Sim/UnitCatalog';
import { Game } from '../Game';

export class UIManager {
  private selectionInfoDiv: HTMLElement;
  private actionButtonsDiv: HTMLElement;
  private game: Game;

  private lastSelectedEntityId: number | null = null;
  private lastGold: number = -1;
  private lastQueueSig = '';

  constructor(game: Game) {
    this.game = game;
    this.selectionInfoDiv = document.getElementById('selection-info')!;
    this.actionButtonsDiv = document.getElementById('action-buttons')!;
  }

  public update(selectedEntities: Entity[]) {
    if (selectedEntities.length === 0) {
      if (this.lastSelectedEntityId !== null) {
        this.selectionInfoDiv.innerHTML = '';
        this.actionButtonsDiv.innerHTML = '';
        this.lastSelectedEntityId = null;
        this.lastQueueSig = '';
      }
      return;
    }

    const entity = selectedEntities[0]!;
    const local = MatchState.current?.localPlayer;
    const currentGold = local?.gold ?? 0;
    const settlement =
      local && entity instanceof Building && isOwnedBy(entity, local.id)
        ? this.game.getSettlementForBuilding(entity) ?? this.game.getSettlement(local.id)
        : local
          ? this.game.getSettlement(local.id)
          : undefined;
    const groupReady = this.game.hasReadySettlerGroup();
    const squads = this.game.getSquadSystem().squadsFromSelection(selectedEntities);
    const queueSig = settlement
      ? settlement.queue
          .list()
          .map((p) => `${p.id}:${p.status}`)
          .join('|') +
        `|c${settlement.population}|t${settlement.tier}|f${settlement.focus}|sp${settlement.specialization}|w${settlement.warShock.toFixed(2)}|g${groupReady ? 1 : 0}|sq${squads.map((s) => `${s.id}:${s.size}`).join(',')}|h${this.game.getHeroSystem().heroesForPlayer(local?.id ?? '').map((h) => h.id).join(',')}|a${this.game.getArtifactSystem().forPlayer(local?.id ?? '').map((x) => `${x.id}:${x.boundUnitId ?? 'v'}`).join(',')}`
      : `sq${squads.map((s) => `${s.id}:${s.size}`).join(',')}`;

    if (
      this.lastSelectedEntityId === entity.id &&
      this.lastGold === currentGold &&
      this.lastQueueSig === queueSig
    ) {
      return;
    }

    this.lastSelectedEntityId = entity.id;
    this.lastGold = currentGold;
    this.lastQueueSig = queueSig;

    let infoHtml = '';
    const selectedSquads = local
      ? this.game.getSquadSystem().squadsFromSelection(selectedEntities)
      : [];

    if (selectedSquads.length > 0 && entity instanceof Unit && isCombatUnitType(entity.unitType)) {
      for (const squad of selectedSquads) {
        infoHtml += `<h3>${squad.label}</h3>`;
        infoHtml += `<p>Morale ${Math.round(squad.morale)}${squad.routing ? ' ROUT!' : ''} · XP ${Math.floor(squad.experience)} · ${formationLabel(squad.formation)}</p>`;
        if (squad.lastTacticalSummary) {
          infoHtml += `<p class="muted">Tactics ${squad.lastTacticalScore >= 0 ? '+' : ''}${squad.lastTacticalScore}: ${squad.lastTacticalSummary}</p>`;
        }
        infoHtml += `<p class="muted">Atk ${squad.attackStrength.toFixed(1)} · Def ${squad.defense.toFixed(2)} · Rng ${Math.round(squad.range)} · Spd ${Math.round(squad.movementSpeed)}</p>`;
      }
      if (entity instanceof Unit) {
        infoHtml += this.heroInfoHtml(entity);
        infoHtml += this.artifactInfoHtml(entity);
      }
      if (selectedSquads.length === 1) {
        infoHtml += `<p class="muted">Ctrl+click: micro single agent</p>`;
      }
    } else {
      infoHtml += `<h3>${this.getEntityName(entity)}</h3>`;
      infoHtml += `<p>HP: ${Math.ceil(entity.hp)} / ${entity.maxHp}</p>`;

      if (local && entity instanceof Unit && isOwnedBy(entity, local.id)) {
        infoHtml += this.heroInfoHtml(entity);
        infoHtml += this.artifactInfoHtml(entity);
        if (!entity.heroId) {
          infoHtml += `<p class="muted">XP ${Math.floor(entity.personalXp)} · Prestige ${Math.floor(entity.prestige)} · Kills ${entity.killCount}</p>`;
          if (entity.agentTraits.length) {
            infoHtml += `<p class="muted">Traits: ${entity.agentTraits.join(', ')}</p>`;
          }
        }
        if (entity.unitType === 'Worker' || entity.unitType === 'Peon') {
          infoHtml += `<p>Gold: ${entity.heldGold} / 10</p>`;
          infoHtml += `<p class="muted">Autonomous builds: House / Farm / Storage / Roads</p>`;
        } else if (!entity.heroId) {
          infoHtml += `<p>Damage: ${entity.damage}</p>`;
        }
      }
    }

    if (settlement && local && isOwnedBy(entity, local.id)) {
      infoHtml += `<p>Mats: W${Math.floor(settlement.wood)} S${Math.floor(settlement.stone)} I${Math.floor(settlement.iron)}</p>`;
      if (entity instanceof Building && isMainBuilding(entity.buildingType)) {
        const by = populationSim.countByProfession(settlement);
        const top = (Object.entries(by) as [keyof typeof by, number][])
          .filter(([, n]) => n > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([role, n]) => `${professionLabel(local.factionId, role)} ${n}`)
          .join(', ');
        infoHtml += `<p>${TIER_DEFS[settlement.tier].label} · Citizens ${settlement.population}/${settlement.housing}</p>`;
        infoHtml += `<p>Safety ${Math.round(settlement.safety * 100)}% · Focus ${settlementFocusLabel(settlement.focus)} · ${specializationLabel(settlement.specialization)}</p>`;
        infoHtml += `<p class="muted">Attract ${Math.round(settlement.migrationAttraction * 100)}% · Jobs ${Math.round(settlement.jobs * 100)}%</p>`;
        const growth = settlement.growthHints.slice(0, 3);
        const safetyH = settlement.safetyHints.slice(0, 3);
        if (growth.length) {
          infoHtml += `<p class="muted">Growth: ${growth.join('; ')}</p>`;
        }
        if (safetyH.length) {
          infoHtml += `<p class="muted">Safety: ${safetyH.join('; ')}</p>`;
        }
        if (top) infoHtml += `<p class="muted">${top}</p>`;
        const heroes = this.game.getHeroSystem().heroesForPlayer(local.id);
        if (heroes.length > 0) {
          infoHtml += `<p><strong>Heroes</strong></p>`;
          for (const h of heroes.slice(0, 4)) {
            infoHtml += `<p class="muted">${h.name} — ${heroTypeLabel(h.type, h.factionId)} · prest ${Math.floor(h.prestige)}</p>`;
          }
        }
        const arts = this.game.getArtifactSystem().forPlayer(local.id);
        if (arts.length > 0) {
          infoHtml += `<p><strong>Artifacts</strong></p>`;
          for (const a of arts.slice(0, 5)) {
            const where = a.boundUnitId != null ? 'carried' : 'vault';
            infoHtml += `<p class="muted">${a.name} (${artifactQualityLabel(a.quality)} ${artifactTypeLabel(a.type)}, y${a.yearCreated}, ${where})</p>`;
          }
        }
      }
    }

    this.selectionInfoDiv.innerHTML = infoHtml;
    this.renderActionButtons(entity, currentGold, selectedSquads);
  }

  private getEntityName(entity: Entity): string {
    if (entity instanceof Building) {
      if (entity.buildingType === 'PigFarm') return 'War Hut';
      if (entity.buildingType === 'OrcBarracks') return 'Orc Barracks';
      if (entity.buildingType === 'OrcStronghold' || entity.buildingType === 'TownHall') {
        return 'Town Center';
      }
      return entity.buildingType;
    }
    if (entity instanceof Unit) {
      if (entity.heroName) return entity.heroName;
      return entity.unitType;
    }
    return 'Entity';
  }

  private heroInfoHtml(unit: Unit): string {
    const hero = unit.heroId ? this.game.getHeroSystem().get(unit.heroId) : undefined;
    if (!hero || !hero.alive) return '';
    const title = heroTypeLabel(hero.type, hero.factionId);
    let html = `<p><strong>★ ${hero.name}</strong> — ${title}</p>`;
    html += `<p class="muted">XP ${Math.floor(hero.experience)} · Prestige ${Math.floor(hero.prestige)} · ${hero.traits.join(', ')}</p>`;
    const recent = hero.history.slice(-3);
    for (const h of recent) {
      html += `<p class="muted">• ${h.text}</p>`;
    }
    return html;
  }

  private artifactInfoHtml(unit: Unit): string {
    if (!unit.artifactId) return '';
    const art = this.game.getArtifactSystem().get(unit.artifactId);
    if (!art || art.lost) return '';
    let html = `<p><strong>⚔ ${art.name}</strong> — ${artifactQualityLabel(art.quality)} ${artifactTypeLabel(art.type)}</p>`;
    html += `<p class="muted">Year ${art.yearCreated} · ${art.effects.map((e) => e.label).join(', ')}</p>`;
    const recent = art.history.slice(-2);
    for (const h of recent) {
      html += `<p class="muted">• ${h.text}</p>`;
    }
    return html;
  }

  private renderActionButtons(
    entity: Entity,
    gold: number,
    selectedSquads: import('../Combat/Squad').Squad[],
  ) {
    this.actionButtonsDiv.innerHTML = '';

    const local = MatchState.current?.localPlayer;
    if (!local || !isOwnedBy(entity, local.id)) return;

    if (selectedSquads.length > 0 && entity instanceof Unit) {
      for (const f of ALL_FORMATIONS) {
        const active = selectedSquads.every((s) => s.formation === f);
        this.createButton(`${formationLabel(f)}${active ? ' ✓' : ''}`, true, () => {
          for (const s of selectedSquads) this.game.setSquadFormation(s.id, f);
        });
      }
      if (entity.artifactId) {
        this.createButton('Unequip Artifact', true, () => this.game.unequipSelectedArtifact());
      }
      const vaulted = this.game
        .getArtifactSystem()
        .forPlayer(local.id)
        .filter((a) => a.boundUnitId == null);
      for (const a of vaulted.slice(0, 3)) {
        this.createButton(`Equip ${a.name}`, true, () =>
          this.game.transferArtifactToSelected(a.id),
        );
      }
      return;
    }

    const faction = FACTIONS[local.factionId];
    const settlement =
      entity instanceof Building
        ? this.game.getSettlementForBuilding(entity)
        : this.game.getSettlement(local.id);

    if (entity instanceof Building && isMainBuilding(entity.buildingType)) {
      if (!entity.isConstructed) return;

      const workerDef = getUnitDef(faction.workerType);
      const workerCost = workerDef?.goldCost ?? 50;
      const workerPop = workerDef?.populationCost ?? 1;
      const canDraftWorker = (settlement?.population ?? 0) >= workerPop;
      this.createButton(
        `Train ${faction.workerType} (${workerCost}G + ${workerPop} cit)`,
        gold >= workerCost && canDraftWorker,
        () => this.game.trainUnit(entity, faction.workerType),
      );

      for (const recipe of strategicOptionsForFaction(local.factionId, settlement?.tier)) {
        const afford =
          settlement?.canAfford(recipe.costs) ||
          (gold >= recipe.costs.gold &&
            (settlement?.wood ?? 0) >= recipe.costs.wood &&
            (settlement?.stone ?? 0) >= recipe.costs.stone);
        this.createButton(
          `Queue ${recipe.label}`,
          !!afford,
          () => this.game.startBuildingPlacement(recipe.target as BuildingType),
        );
      }

      if (settlement) {
        for (const f of SETTLEMENT_FOCUSES) {
          const active = settlement.focus === f;
          this.createButton(
            `Focus: ${settlementFocusLabel(f)}${active ? ' ✓' : ''}`,
            true,
            () => this.game.setSettlementFocus(settlement.id, f as SettlementFocus),
          );
        }
      }

      const canForm = this.game.canFormSettlerGroup();
      const ready = this.game.hasReadySettlerGroup();
      const doc = doctrineOf(local.factionId);
      this.createButton(
        ready
          ? 'Found Settlement Here'
          : `Form Settler Group (${doc.settlerGoldCost}G/${doc.settlerWoodCost}W)`,
        ready || canForm,
        () => {
          // Placement is local UI; founding mutates via FoundSettlementCommand.
          if (!ready && canForm) {
            this.game.formSettlerGroup();
          }
          this.game.startFoundSettlementPlacement();
        },
      );
      if (!ready && !canForm && settlement) {
        const hint = document.createElement('div');
        hint.className = 'queue-hint';
        hint.textContent = `Settlers need Village+, ${doc.settlerMinPop}+ citizens, idle workers (${local.faction.displayName})`;
        this.actionButtonsDiv.appendChild(hint);
      }

      this.renderQueueControls(settlement);
    } else if (entity instanceof Building && entity.buildingType === faction.productionBuilding) {
      if (!entity.isConstructed) return;
      const meleeDef = getUnitDef(faction.meleeType);
      const rangedDef = getUnitDef(faction.rangedType);
      const meleeCost = meleeDef?.goldCost ?? 80;
      const rangedCost = rangedDef?.goldCost ?? 100;
      const meleePop = meleeDef?.populationCost ?? 1;
      const rangedPop = rangedDef?.populationCost ?? 1;
      const cit = settlement?.population ?? 0;
      this.createButton(
        `Train ${faction.meleeType} (${meleeCost}G + ${meleePop} cit)`,
        gold >= meleeCost && cit >= meleePop,
        () => this.game.trainUnit(entity, faction.meleeType),
      );
      this.createButton(
        `Train ${faction.rangedType} (${rangedCost}G + ${rangedPop} cit)`,
        gold >= rangedCost && cit >= rangedPop,
        () => this.game.trainUnit(entity, faction.rangedType),
      );
    }
  }

  private renderQueueControls(settlement: ReturnType<Game['getSettlement']>) {
    if (!settlement) return;
    const projects = settlement.queue.list();
    if (projects.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'queue-hint';
      hint.textContent = 'Construction queue empty';
      this.actionButtonsDiv.appendChild(hint);
      return;
    }

    for (const p of projects) {
      const row = document.createElement('div');
      row.className = 'queue-row';
      const recipe = getRecipe(p.target as ConstructionTarget);
      const label = document.createElement('span');
      label.textContent = `${recipe?.label ?? p.target} [${p.status}]`;
      row.appendChild(label);

      if (p.status === 'queued') {
        this.miniBtn(row, '↑', () => this.game.moveConstruction(p.id, -1));
        this.miniBtn(row, '↓', () => this.game.moveConstruction(p.id, 1));
      }
      this.miniBtn(row, '✕', () => this.game.cancelConstruction(p.id));
      this.actionButtonsDiv.appendChild(row);
    }
  }

  private miniBtn(parent: HTMLElement, text: string, onClick: () => void) {
    const btn = document.createElement('button');
    btn.className = 'queue-mini';
    btn.textContent = text;
    btn.onmousedown = (e) => {
      e.stopPropagation();
      onClick();
    };
    parent.appendChild(btn);
  }

  private createButton(text: string, enabled: boolean, onClick: () => void) {
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.innerText = text;
    btn.disabled = !enabled;
    btn.onmousedown = (e) => {
      e.stopPropagation();
      if (enabled) onClick();
    };
    this.actionButtonsDiv.appendChild(btn);
  }
}
