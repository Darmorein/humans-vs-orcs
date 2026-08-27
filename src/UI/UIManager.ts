import { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import { Building, isMainBuilding } from '../Entities/Building';
import { ResourceNode } from '../Entities/ResourceNode';
import { MatchState } from '../Players/MatchState';
import { isOwnedBy } from '../Players/Relations';
import { FACTIONS } from '../Players/Types';
import type { BuildingType } from '../Entities/Building';
import {
  getRecipe,
  listStrategicBuildOptions,
  treasuryGoldCost,
  type ConstructionTarget,
} from '../Settlement/ConstructionCatalog';
import { OUTPOST_TREASURY_COST } from '../Settlement/SettlementSystem';
import { populationSim, professionLabel } from '../Settlement/Population';
import { TIER_DEFS } from '../Settlement/SettlementTier';
import {
  SETTLEMENT_FOCUSES,
  settlementFocusLabel,
  specializationLabel,
  type SettlementFocus,
} from '../Settlement/SettlementFocus';
import { doctrineOf } from '../Players/FactionDoctrine';
import {
  TAX_POLICIES,
  TAX_POLICY_DEFS,
  TAX_POLICY_COOLDOWN_TICKS,
  type TaxPolicy,
} from '../Players/TaxPolicy';
import { isCombatUnitType } from '../Combat/Squad';
import { ALL_FORMATIONS, formationLabel } from '../Combat/FormationDefs';
import { heroTypeLabel } from '../Heroes';
import { artifactQualityLabel, artifactTypeLabel } from '../Artifacts';
import { Game } from '../Game';

export class UIManager {
  private selectionInfoDiv: HTMLElement;
  private actionButtonsDiv: HTMLElement;
  private citiesOverviewDiv: HTMLElement | null;
  private game: Game;

  private lastSelectedEntityId: number | null = null;
  private lastGold: number = -1;
  private lastQueueSig = '';
  private lastCitiesSig = '';

  constructor(game: Game) {
    this.game = game;
    this.selectionInfoDiv = document.getElementById('selection-info')!;
    this.actionButtonsDiv = document.getElementById('action-buttons')!;
    this.citiesOverviewDiv = document.getElementById('cities-overview');
  }

  public update(selectedEntities: Entity[]) {
    this.renderCitiesOverview();

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
        `|c${settlement.population}|t${settlement.tier}|f${settlement.focus}|sp${settlement.specialization}|w${settlement.warShock.toFixed(2)}|ig${settlement.localIncomeRate.toFixed(1)}|tx${settlement.taxContributionRate.toFixed(1)}|tp${local?.taxPolicy}|tr${(local?.treasuryIncomeRate ?? 0).toFixed(1)}|g${groupReady ? 1 : 0}|sq${squads.map((s) => `${s.id}:${s.size}`).join(',')}|h${this.game.getHeroSystem().heroesForPlayer(local?.id ?? '').map((h) => h.id).join(',')}|a${this.game.getArtifactSystem().forPlayer(local?.id ?? '').map((x) => `${x.id}:${x.boundUnitId ?? 'v'}`).join(',')}`
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
        infoHtml += `<h3>${squad.displayName || squad.label}</h3>`;
        const cap = squad.targetSize || squad.maxSize;
        infoHtml += `<p>${squad.size} / ${cap}${squad.isDepleted ? ' · <strong>DEPLETED</strong>' : ''}</p>`;
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

      if (entity instanceof ResourceNode) {
        infoHtml += `<p>Gold deposit · remaining ${Math.floor(entity.remainingAmount)}</p>`;
        infoHtml += `<p>Controlled by: ${entity.controllingFactionId ?? 'none'}</p>`;
        infoHtml += `<p>Linked: ${entity.linkedSettlementId ?? '—'} · infra ${entity.infrastructureLevel.toFixed(1)}</p>`;
        infoHtml += `<p>Output ~${entity.lastExtractionRate.toFixed(1)}/s · safety ${Math.round(entity.safety * 100)}%</p>`;
        if (entity.raidDamageCooldown > 0) {
          infoHtml += `<p class="muted">Raid damage ${entity.raidDamageCooldown.toFixed(1)}s</p>`;
        }
      }

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
          infoHtml += `<p class="muted">Legacy civilian (not commandable)</p>`;
        } else if (!entity.heroId) {
          infoHtml += `<p>Damage: ${entity.damage}</p>`;
        }
      }
    }

    if (settlement && local && isOwnedBy(entity, local.id)) {
      infoHtml += `<p>Local: G${Math.floor(settlement.gold)} F${Math.floor(settlement.food)} W${Math.floor(settlement.wood)} S${Math.floor(settlement.stone)} I${Math.floor(settlement.iron)}</p>`;
      if (entity instanceof Building && isMainBuilding(entity.buildingType)) {
        const by = populationSim.countByProfession(settlement);
        const mil = by.soldier;
        const labor = Math.round(settlement.civicLabor * 10) / 10;
        const localPlayer = MatchState.current?.localPlayer;
        const isCapital = localPlayer?.capitalSettlementId === settlement.id;
        const tierBit = `${TIER_DEFS[settlement.tier].label}${isCapital ? ' · Capital' : ''}`;
        infoHtml += `<p>${tierBit} · Pop ${settlement.population}/${settlement.housing} · Labor ${labor} · Mil ${mil}</p>`;
        infoHtml += `<p>Local income +${settlement.localIncomeRate.toFixed(1)}G/s · Tax contrib +${settlement.taxContributionRate.toFixed(1)}/s</p>`;
        infoHtml += `<p class="muted">Mines ${settlement.incomeSources.goldMines.toFixed(1)} · Farms ${settlement.incomeSources.foodFarms.toFixed(1)}</p>`;
        infoHtml += `<p>Infra mines ${settlement.mineCount} · farms ${settlement.farmCount} · outposts ${settlement.outpostCount}</p>`;
        infoHtml += `<p>Safety ${Math.round(settlement.safety * 100)}% · Influence ${Math.round(settlement.influence * 100)}% · Focus ${settlementFocusLabel(settlement.focus)} · ${specializationLabel(settlement.specialization)}</p>`;
        infoHtml += `<p class="muted">Attract ${Math.round(settlement.migrationAttraction * 100)}% · Jobs ${Math.round(settlement.jobs * 100)}%</p>`;
        const growth = settlement.growthHints.slice(0, 3);
        const safetyH = settlement.safetyHints.slice(0, 3);
        if (growth.length) {
          infoHtml += `<p class="muted">Growth: ${growth.join('; ')}</p>`;
        }
        if (safetyH.length) {
          infoHtml += `<p class="muted">Safety: ${safetyH.join('; ')}</p>`;
        }
        const top = (Object.entries(by) as [keyof typeof by, number][])
          .filter(([, n]) => n > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([role, n]) => `${professionLabel(local.factionId, role)} ${n}`)
          .join(', ');
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
    if (entity instanceof ResourceNode) return 'Gold Deposit';
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
      for (const squad of selectedSquads) {
        if (!squad.isDepleted) continue;
        const why = this.game.reinforceSquadBlockReason(squad.id);
        this.createButton(
          why ? `Reinforce — ${why}` : `Reinforce (${squad.size} → ${squad.targetSize || squad.maxSize})`,
          true,
          () => {
            if (why) {
              this.game.showBuildFeedback(why);
              return;
            }
            this.game.reinforceSquad(squad.id);
          },
        );
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

      const stock = {
        gold: gold, // Faction Treasury for strategic afford checks
        wood: settlement?.wood ?? 0,
        stone: settlement?.stone ?? 0,
        iron: settlement?.iron ?? 0,
        population: settlement?.population ?? 0,
        tier: settlement?.tier,
      };

      for (const opt of listStrategicBuildOptions(local.factionId, stock)) {
        const r = opt.recipe;
        if (r.target === 'Outpost') continue; // dedicated Establish Outpost flow
        const costBit = `${Math.ceil(treasuryGoldCost(r.costs))}T`;
        const label = opt.blockReason
          ? `${r.label} — ${opt.blockReason}`
          : `Queue ${r.label} (${costBit})`;
        this.createButton(label, true, () => {
          if (opt.blockReason) {
            this.game.showBuildFeedback(`Cannot build ${r.label}: ${opt.blockReason}`);
            return;
          }
          this.game.startBuildingPlacement(r.target as BuildingType);
        });
      }

      const outpostOpt = listStrategicBuildOptions(local.factionId, stock).find(
        (o) => o.recipe.target === 'Outpost',
      );
      const outpostLock = outpostOpt?.blockReason ?? null;
      const outpostCost = Math.ceil(OUTPOST_TREASURY_COST);
      this.createButton(
        outpostLock
          ? `Outpost — ${outpostLock}`
          : `Establish Outpost (${outpostCost} Treasury)`,
        true,
        () => {
          if (outpostLock) {
            this.game.showBuildFeedback(`Cannot establish Outpost: ${outpostLock}`);
            return;
          }
          this.game.startEstablishOutpostPlacement();
        },
      );

      // Tax policy buttons
      const onCooldown =
        local.lastTaxChangeTick > 0 &&
        this.game.getSimTick() - local.lastTaxChangeTick < TAX_POLICY_COOLDOWN_TICKS;
      for (const p of TAX_POLICIES) {
        const def = TAX_POLICY_DEFS[p];
        const active = local.taxPolicy === p;
        this.createButton(
          `Tax: ${def.label}${active ? ' ✓' : ''}${onCooldown && !active ? ' (cd)' : ''}`,
          true,
          () => {
            if (onCooldown && !active) {
              this.game.showBuildFeedback('Tax policy on cooldown');
              return;
            }
            this.game.setTaxPolicy(p as TaxPolicy);
            if (p === 'war') {
              this.game.showBuildFeedback(
                'WAR tax: max treasury take — strong local growth penalties',
              );
            }
          },
        );
      }

      if (settlement) {
        const focusSelect = document.createElement('select');
        focusSelect.className = 'focus-select';
        focusSelect.title = 'City focus';
        for (const f of SETTLEMENT_FOCUSES) {
          const opt = document.createElement('option');
          opt.value = f;
          opt.textContent = `Focus: ${settlementFocusLabel(f)}`;
          if (settlement.focus === f) opt.selected = true;
          focusSelect.appendChild(opt);
        }
        focusSelect.addEventListener('change', () => {
          this.game.setSettlementFocus(
            settlement.id,
            focusSelect.value as SettlementFocus,
          );
        });
        this.actionButtonsDiv.appendChild(focusSelect);
      }

      const canForm = this.game.canFormSettlerGroup();
      const ready = this.game.hasReadySettlerGroup();
      const doc = doctrineOf(local.factionId);
      this.createButton(
        ready ? 'Found City Here' : `Found City Here (${doc.settlerGoldCost}T)`,
        true,
        () => {
          if (!ready && !canForm) {
            const why =
              this.game.formSettlerGroupBlockReason() ??
              `Settlers need Town+, ${doc.settlerMinPop}+ citizens, and caravan costs`;
            this.game.showBuildFeedback(why);
            return;
          }
          if (!ready && canForm) {
            this.game.formSettlerGroup();
          }
          this.game.startFoundSettlementPlacement();
        },
      );
      if (!ready && !canForm && settlement) {
        const hint = document.createElement('div');
        hint.className = 'queue-hint';
        const why = this.game.formSettlerGroupBlockReason();
        hint.textContent =
          why ??
          `Settlers need Town+, ${doc.settlerMinPop}+ citizens (${local.faction.displayName})`;
        this.actionButtonsDiv.appendChild(hint);
      }

      this.renderMilitaryRecruitment(entity);
      this.renderQueueControls(settlement);
    } else if (entity instanceof Building && entity.buildingType === faction.productionBuilding) {
      if (!entity.isConstructed) return;
      this.renderMilitaryRecruitment(entity);
    }
  }

  /** City / Barracks: recruit complete squads at the selected building. */
  private renderMilitaryRecruitment(building: Building) {
    const templates = this.game.listSquadTemplatesForLocal();
    for (const t of templates) {
      const why = this.game.recruitSquadBlockReason(t.id, building.id);
      const site =
        building.buildingType === 'Barracks' || building.buildingType === 'OrcBarracks'
          ? 'Barracks'
          : 'City';
      const label = why
        ? `Recruit ${t.displayName} — ${why}`
        : `Recruit ${t.displayName} @ ${site} (${t.treasuryCost}T + ${t.manpowerCost} cit · ${t.trainTime}s)`;
      this.createButton(label, true, () => {
        if (why) {
          this.game.showBuildFeedback(why);
          return;
        }
        this.game.recruitSquad(t.id, building.id);
      });
    }
    const queue = this.game.listMilitaryQueue().filter((j) => j.buildingId === building.id);
    if (queue.length > 0) {
      const box = document.createElement('div');
      box.className = 'queue-hint';
      box.innerHTML = '<strong>MILITARY QUEUE</strong>';
      for (const job of queue) {
        const left = Math.max(0, job.trainTime - job.progress);
        const row = document.createElement('div');
        row.textContent =
          job.kind === 'reinforce'
            ? `Reinforce ${job.displayName} · ${left.toFixed(1)}s · +${job.membersNeeded}`
            : `${job.displayName} · ${left.toFixed(1)}s · ${job.membersNeeded} soldiers`;
        box.appendChild(row);
      }
      this.actionButtonsDiv.appendChild(box);
    }
  }

  private renderCitiesOverview() {
    const el = this.citiesOverviewDiv;
    if (!el) return;
    const rows = this.game.getOwnedCitiesOverview();
    const sig = rows
      .map(
        (r) =>
          `${r.id}:${r.tier}:${r.focus}:${r.pop}:${r.underPressure ? 1 : 0}:${r.isCapital ? 1 : 0}`,
      )
      .join('|');
    if (sig === this.lastCitiesSig) return;
    this.lastCitiesSig = sig;
    el.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'cities-title';
    title.textContent = 'Cities';
    el.appendChild(title);
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'None';
      el.appendChild(empty);
      return;
    }
    for (const r of rows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'city-row';
      const cap = r.isCapital ? ' · Capital' : '';
      const press = r.underPressure ? ' ⚠' : '';
      btn.innerHTML = `<span class="${r.isCapital ? 'city-cap' : ''}">${r.tier}${cap}</span> · ${settlementFocusLabel(r.focus as SettlementFocus)} · ${r.pop}${press}`;
      if (r.underPressure) btn.classList.add('city-pressure');
      btn.addEventListener('click', () => this.game.centerOnSettlement(r.id));
      el.appendChild(btn);
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
