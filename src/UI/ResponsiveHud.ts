import './ResponsiveHud.css';
import { MatchState } from '../Players/MatchState';
import { TAX_POLICIES, TAX_POLICY_DEFS, type TaxPolicy } from '../Players/TaxPolicy';
import type { Game } from '../Game';

type CityTab = 'develop' | 'army' | 'govern';
type PlacementInternals = { placementMode?: string | null };

/** Map-first presentation shell over the existing authoritative UIManager. */
export class ResponsiveHud {
  private readonly game: Game;
  private raf = 0;
  private lastSig = '';
  private actionDecorationQueued = false;
  private activeCityTab: CityTab = 'develop';

  private treasuryChip: HTMLButtonElement | null;
  private armiesChip: HTMLButtonElement | null;
  private citiesChip: HTMLButtonElement | null;
  private eventsChip: HTMLButtonElement | null;
  private menuChip: HTMLButtonElement | null;
  private empireSheet: HTMLElement | null;
  private citiesPanel: HTMLElement | null;
  private eventFeed: HTMLElement | null;
  private devMenu: HTMLElement | null;
  private actionButtons: HTMLElement | null;
  private selectionInfo: HTMLElement | null;
  private placementBar: HTMLElement;

  private touchInteractionSeen = false;
  private lastPlacementMode: string | null = null;
  private placementCandidate: { x: number; y: number } | null = null;
  private placementPointerId: number | null = null;
  private placementStartX = 0;
  private placementStartY = 0;
  private placementMoved = false;

  constructor(game: Game) {
    this.game = game;
    this.treasuryChip = document.querySelector<HTMLButtonElement>('[data-hud="treasury"]');
    this.armiesChip = document.querySelector<HTMLButtonElement>('[data-hud="armies"]');
    this.citiesChip = document.querySelector<HTMLButtonElement>('[data-hud="cities"]');
    this.eventsChip = document.querySelector<HTMLButtonElement>('[data-hud="events"]');
    this.menuChip = document.querySelector<HTMLButtonElement>('[data-hud="menu"]');
    this.empireSheet = document.getElementById('empire-sheet');
    this.citiesPanel = document.getElementById('cities-overview');
    this.eventFeed = document.getElementById('event-feed');
    this.devMenu = document.getElementById('dev-menu');
    this.actionButtons = document.getElementById('action-buttons');
    this.selectionInfo = document.getElementById('selection-info');
    this.placementBar = this.createPlacementBar();

    this.bindShell();
    this.bindPlacementTouch();
    this.observeLegacyPanels();
    this.tick();
  }

  public destroy(): void {
    cancelAnimationFrame(this.raf);
    this.placementBar.remove();
  }

  private bindShell(): void {
    this.treasuryChip?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleEmpireSheet('treasury');
    });
    this.armiesChip?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleEmpireSheet('armies');
    });
    this.citiesChip?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.togglePanel(this.citiesPanel, this.citiesChip);
    });
    this.eventsChip?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.togglePanel(this.eventFeed, this.eventsChip);
    });
    this.menuChip?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.togglePanel(this.devMenu, this.menuChip);
    });

    for (const root of [
      document.getElementById('command-bar'),
      this.empireSheet,
      this.citiesPanel,
      this.eventFeed,
      this.devMenu,
      document.getElementById('ui-container'),
      this.placementBar,
    ]) {
      if (!root) continue;
      root.addEventListener('mousedown', (event) => event.stopPropagation());
      root.addEventListener('pointerdown', (event) => event.stopPropagation());
    }

    this.citiesPanel?.addEventListener('click', (event) => {
      const target = event.target as Element | null;
      if (target?.closest('.city-row')) queueMicrotask(() => this.closeTransientPanels());
    });

    document.addEventListener(
      'pointerdown',
      (event) => {
        if (event.pointerType === 'touch' || event.pointerType === 'pen') {
          this.touchInteractionSeen = true;
        }
      },
      { capture: true },
    );

    document.addEventListener('pointerdown', (event) => {
      const target = event.target as Node;
      const clickedHud =
        this.empireSheet?.contains(target) ||
        this.citiesPanel?.contains(target) ||
        this.eventFeed?.contains(target) ||
        this.devMenu?.contains(target) ||
        this.placementBar.contains(target) ||
        document.getElementById('ui-container')?.contains(target) ||
        (target instanceof Element && Boolean(target.closest('#command-bar')));
      if (!clickedHud) this.closeTransientPanels();
    });
  }

  private bindPlacementTouch(): void {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;

    canvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      if (!this.readPlacementMode()) return;
      this.touchInteractionSeen = true;
      this.placementPointerId = event.pointerId;
      this.placementStartX = event.clientX;
      this.placementStartY = event.clientY;
      this.placementMoved = false;
    });

    canvas.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.placementPointerId) return;
      const moved =
        Math.hypot(event.clientX - this.placementStartX, event.clientY - this.placementStartY) > 10;
      if (!moved) return;
      this.placementMoved = true;
      // A screen-space candidate is no longer trustworthy after the camera pans.
      if (this.placementCandidate) {
        this.placementCandidate = null;
        this.renderPlacementBar();
      }
    });

    const finish = (event: PointerEvent) => {
      if (event.pointerId !== this.placementPointerId) return;
      if (this.readPlacementMode() && !this.placementMoved) {
        this.placementCandidate = { x: event.clientX, y: event.clientY };
        this.renderPlacementBar();
      }
      this.placementPointerId = null;
      this.placementMoved = false;
    };

    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', () => {
      this.placementPointerId = null;
      this.placementMoved = false;
    });
  }

  private observeLegacyPanels(): void {
    if (this.actionButtons) {
      const observer = new MutationObserver(() => this.scheduleActionDecoration());
      observer.observe(this.actionButtons, { childList: true, subtree: true });
      this.scheduleActionDecoration();
    }
    if (this.eventFeed) {
      const observer = new MutationObserver(() => this.updateEventBadge());
      observer.observe(this.eventFeed, { childList: true, subtree: true });
      this.updateEventBadge();
    }
  }

  private scheduleActionDecoration(): void {
    if (this.actionDecorationQueued) return;
    this.actionDecorationQueued = true;
    queueMicrotask(() => {
      this.actionDecorationQueued = false;
      this.decorateActionButtons();
    });
  }

  private decorateActionButtons(): void {
    if (!this.actionButtons) return;
    if (
      this.actionButtons.querySelector(':scope > .hud-city-sheet') ||
      this.actionButtons.querySelector(':scope > .hud-formation-control')
    ) {
      return;
    }

    this.actionButtons.classList.remove('is-city-actions', 'is-formation-actions');
    this.selectionInfo?.classList.remove('is-city-summary');

    const buttons = Array.from(
      this.actionButtons.querySelectorAll<HTMLButtonElement>(':scope > .action-btn'),
    );
    for (const button of buttons) {
      const text = button.textContent?.trim() ?? '';
      if (/reinforce/i.test(text)) button.dataset.intent = 'primary';
      else if (/outpost|found city/i.test(text)) button.dataset.intent = 'strategic';
      else if (/tax:/i.test(text)) button.dataset.intent = 'govern';
      else if (/line|shield wall|loose|charge|hold ground/i.test(text)) {
        button.dataset.intent = 'formation';
      } else if (/queue|recruit/i.test(text)) button.dataset.intent = 'production';
      else button.dataset.intent = 'secondary';
    }

    const cityContext =
      Boolean(this.actionButtons.querySelector(':scope > .focus-select')) ||
      buttons.some((button) => /found city|outpost|tax:/i.test(button.textContent ?? ''));
    if (cityContext) {
      this.buildCitySheet();
      return;
    }

    const formationButtons = buttons.filter((button) => button.dataset.intent === 'formation');
    if (formationButtons.length >= 2) this.buildFormationPicker(formationButtons);
  }

  private buildFormationPicker(formationButtons: HTMLButtonElement[]): void {
    if (!this.actionButtons) return;
    this.actionButtons.classList.add('is-formation-actions');

    const active = formationButtons.find((button) => /✓/.test(button.textContent ?? ''));
    const activeLabel = (active?.textContent ?? formationButtons[0]?.textContent ?? 'Formation')
      .replace('✓', '')
      .trim();
    const control = document.createElement('div');
    control.className = 'hud-formation-control';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'hud-formation-trigger';
    trigger.innerHTML = `<span><small>Formation</small><strong>${escapeHtml(activeLabel)}</strong></span>`;
    const picker = document.createElement('div');
    picker.className = 'hud-formation-picker';
    picker.setAttribute('role', 'menu');

    for (const button of formationButtons) {
      button.classList.add('hud-formation-choice');
      picker.appendChild(button);
      button.addEventListener('click', () => control.classList.remove('is-open'));
    }
    trigger.addEventListener('click', () => control.classList.toggle('is-open'));
    control.append(trigger, picker);
    this.actionButtons.insertBefore(control, this.actionButtons.firstChild);
  }

  private buildCitySheet(): void {
    if (!this.actionButtons) return;
    this.actionButtons.classList.add('is-city-actions');
    this.selectionInfo?.classList.add('is-city-summary');

    const develop: HTMLElement[] = [];
    const army: HTMLElement[] = [];
    const govern: HTMLElement[] = [];
    for (const child of Array.from(this.actionButtons.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const text = child.textContent?.trim() ?? '';
      if (child.matches('.focus-select')) {
        govern.push(child);
      } else if (child.matches('.action-btn')) {
        const button = child as HTMLButtonElement;
        if (button.dataset.intent === 'govern' && /^tax:/i.test(text)) {
          button.remove();
        } else if (/recruit|reinforce/i.test(text)) {
          army.push(child);
        } else {
          develop.push(child);
        }
      } else if (/military queue/i.test(text)) {
        army.push(child);
      } else {
        develop.push(child);
      }
    }

    const counts: Record<CityTab, number> = {
      develop: develop.length,
      army: army.length,
      govern: govern.length,
    };
    if (counts[this.activeCityTab] === 0) {
      this.activeCityTab =
        (['develop', 'army', 'govern'] as CityTab[]).find((tab) => counts[tab] > 0) ??
        'develop';
    }

    const shell = document.createElement('section');
    shell.className = 'hud-city-sheet';
    const cityTitle = this.selectionInfo?.querySelector('h3')?.textContent?.trim() || 'Settlement';
    const quickStats = Array.from(this.selectionInfo?.querySelectorAll('p') ?? [])
      .map((node) => node.textContent?.trim() ?? '')
      .filter((text) => /^Local:|^Local income|^.+Pop\s|^Safety/i.test(text))
      .slice(0, 2)
      .join(' · ');
    const head = document.createElement('div');
    head.className = 'hud-city-sheet-head';
    head.innerHTML = `<div><small>SETTLEMENT</small><strong>${escapeHtml(cityTitle)}</strong></div><div class="hud-city-quickstats">${escapeHtml(quickStats)}</div>`;

    const tabs = document.createElement('nav');
    tabs.className = 'hud-city-tabs';
    tabs.setAttribute('aria-label', 'City management');
    const panes = new Map<CityTab, HTMLElement>();
    const definitions: Array<[CityTab, string, HTMLElement[]]> = [
      ['develop', 'Develop', develop],
      ['army', 'Army', army],
      ['govern', 'Govern', govern],
    ];

    for (const [tab, label, items] of definitions) {
      const tabButton = document.createElement('button');
      tabButton.type = 'button';
      tabButton.dataset.cityTab = tab;
      tabButton.className = `hud-city-tab${this.activeCityTab === tab ? ' is-active' : ''}`;
      tabButton.textContent = label;
      tabs.appendChild(tabButton);

      const pane = document.createElement('div');
      pane.dataset.pane = tab;
      pane.className = `hud-city-pane${this.activeCityTab === tab ? ' is-active' : ''}`;
      if (items.length) {
        for (const item of items) pane.appendChild(item);
      } else {
        const empty = document.createElement('div');
        empty.className = 'hud-empty-pane';
        empty.textContent =
          tab === 'govern' ? 'No local policy controls available' : 'Nothing available right now';
        pane.appendChild(empty);
      }
      panes.set(tab, pane);
    }

    tabs.addEventListener('click', (event) => {
      const target = event.target as HTMLButtonElement | null;
      const tab = target?.dataset.cityTab as CityTab | undefined;
      if (!tab) return;
      this.activeCityTab = tab;
      for (const button of tabs.querySelectorAll<HTMLButtonElement>('.hud-city-tab')) {
        button.classList.toggle('is-active', button.dataset.cityTab === tab);
      }
      for (const [paneTab, pane] of panes) pane.classList.toggle('is-active', paneTab === tab);
    });

    shell.append(head, tabs, ...panes.values());
    this.actionButtons.appendChild(shell);
  }

  private tick = (): void => {
    const local = MatchState.current?.localPlayer;
    const gold = local?.gold ?? 0;
    const squads = local ? this.game.getSquadSystem().squadsForOwner(local.id) : [];
    const cities = this.game.getOwnedCitiesOverview();
    const threatened = cities.filter((city) => city.underPressure).length;
    const sig = `${Math.floor(gold)}:${(local?.treasuryIncomeRate ?? 0).toFixed(1)}:${squads.length}:${cities.length}:${threatened}:${local?.taxPolicy ?? ''}`;

    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.renderTopBar(gold, local?.treasuryIncomeRate ?? 0, squads.length, cities.length, threatened);
      if (this.empireSheet?.classList.contains('is-open')) {
        this.renderEmpireSheet(this.empireSheet.dataset.mode === 'armies' ? 'armies' : 'treasury');
      }
    }

    const placementMode = this.readPlacementMode();
    if (placementMode !== this.lastPlacementMode) {
      this.lastPlacementMode = placementMode;
      this.placementCandidate = null;
      this.renderPlacementBar();
    } else if (placementMode && this.touchInteractionSeen) {
      this.renderPlacementBar();
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private renderTopBar(
    gold: number,
    income: number,
    armies: number,
    cities: number,
    threatened: number,
  ): void {
    if (this.treasuryChip) {
      const rate = `${income >= 0 ? '+' : ''}${income.toFixed(1)}/s`;
      this.treasuryChip.innerHTML = `<span class="hud-chip-icon">◆</span><span class="hud-chip-copy"><strong>${Math.floor(gold)}</strong><small>Treasury · ${escapeHtml(rate)}</small></span>`;
    }
    if (this.armiesChip) {
      this.armiesChip.innerHTML = `<span class="hud-chip-icon">⚔</span><span class="hud-chip-copy"><strong>${armies}</strong><small>Armies</small></span>`;
    }
    if (this.citiesChip) {
      this.citiesChip.innerHTML = `<span class="hud-chip-icon">♜</span><span class="hud-chip-copy"><strong>${cities}${threatened ? ` <em>⚠${threatened}</em>` : ''}</strong><small>Cities</small></span>`;
    }
  }

  private toggleEmpireSheet(mode: 'treasury' | 'armies'): void {
    if (!this.empireSheet) return;
    const alreadyOpen =
      this.empireSheet.classList.contains('is-open') && this.empireSheet.dataset.mode === mode;
    this.closeTransientPanels();
    if (alreadyOpen) return;
    this.empireSheet.dataset.mode = mode;
    this.renderEmpireSheet(mode);
    this.empireSheet.classList.add('is-open');
    this.empireSheet.setAttribute('aria-hidden', 'false');
    (mode === 'treasury' ? this.treasuryChip : this.armiesChip)?.classList.add('is-active');
  }

  private renderEmpireSheet(mode: 'treasury' | 'armies'): void {
    if (!this.empireSheet) return;
    const local = MatchState.current?.localPlayer;
    if (!local) {
      this.empireSheet.innerHTML = '';
      return;
    }

    if (mode === 'armies') {
      const squads = this.game.getSquadSystem().squadsForOwner(local.id);
      const rows = squads.length
        ? squads
            .map((squad) => {
              const cap = squad.targetSize || squad.maxSize;
              const morale = Math.max(0, Math.min(100, Math.round(squad.morale)));
              const warning =
                squad.routing || squad.isDepleted ? '<span class="hud-warning">⚠</span>' : '';
              return `<div class="hud-list-row"><div><strong>${warning}${escapeHtml(squad.displayName || squad.label)}</strong><small>${squad.size}/${cap} · ${escapeHtml(squad.formation)}${squad.routing ? ' · ROUT' : ''}</small></div><span class="hud-meter"><i style="width:${morale}%"></i></span></div>`;
            })
            .join('')
        : '<div class="hud-empty">No active armies</div>';
      this.empireSheet.innerHTML = `<div class="sheet-grabber"></div><header><div><small>COMMAND</small><h2>Armies</h2></div><button class="sheet-close" type="button" aria-label="Close">×</button></header><div class="hud-list">${rows}</div>`;
      this.empireSheet
        .querySelector<HTMLButtonElement>('.sheet-close')
        ?.addEventListener('click', () => this.closeTransientPanels());
      return;
    }

    const def = TAX_POLICY_DEFS[local.taxPolicy];
    const taxButtons = TAX_POLICIES.map((policy) => {
      const policyDef = TAX_POLICY_DEFS[policy];
      const active = policy === local.taxPolicy ? ' is-selected' : '';
      const description =
        policy === 'war'
          ? 'Maximum treasury, heavy city pressure'
          : policy === 'light'
            ? 'Lower revenue, healthier growth'
            : 'Balanced city contribution';
      return `<button class="choice-card${active}" type="button" data-tax-policy="${policy}"><strong>${escapeHtml(policyDef.label)}</strong><small>${description}</small></button>`;
    }).join('');
    this.empireSheet.innerHTML = `<div class="sheet-grabber"></div><header><div><small>EMPIRE</small><h2>Treasury</h2></div><button class="sheet-close" type="button" aria-label="Close">×</button></header><div class="treasury-hero"><strong>${Math.floor(local.gold)}</strong><span>${local.treasuryIncomeRate >= 0 ? '+' : ''}${local.treasuryIncomeRate.toFixed(1)}/s strategic gold</span></div><div class="sheet-section"><label>Tax policy · ${escapeHtml(def.label)}</label><div class="choice-grid">${taxButtons}</div></div>`;
    this.empireSheet
      .querySelector<HTMLButtonElement>('.sheet-close')
      ?.addEventListener('click', () => this.closeTransientPanels());
    for (const button of this.empireSheet.querySelectorAll<HTMLButtonElement>('[data-tax-policy]')) {
      button.addEventListener('click', () => {
        this.game.setTaxPolicy(button.dataset.taxPolicy as TaxPolicy);
      });
    }
  }

  private createPlacementBar(): HTMLElement {
    const bar = document.createElement('section');
    bar.className = 'hud-placement-bar';
    bar.setAttribute('aria-live', 'polite');
    bar.innerHTML = `<div class="hud-placement-copy"><small>PLACEMENT</small><strong>Tap a site</strong></div><div class="hud-placement-actions"><button type="button" data-placement="cancel">Cancel</button><button type="button" data-placement="confirm" disabled>Confirm</button></div>`;
    document.body.appendChild(bar);
    bar
      .querySelector<HTMLButtonElement>('[data-placement="confirm"]')
      ?.addEventListener('click', () => this.confirmPlacementCandidate());
    bar
      .querySelector<HTMLButtonElement>('[data-placement="cancel"]')
      ?.addEventListener('click', () => this.cancelPlacement());
    return bar;
  }

  private renderPlacementBar(): void {
    const mode = this.readPlacementMode();
    const shouldShow = Boolean(mode && this.touchInteractionSeen);
    this.placementBar.classList.toggle('is-open', shouldShow);
    if (!shouldShow) return;
    const title =
      mode === 'foundSettlement'
        ? 'Found City'
        : mode === 'establishOutpost'
          ? 'Establish Outpost'
          : `Place ${mode}`;
    const copy = this.placementBar.querySelector<HTMLElement>('.hud-placement-copy strong');
    if (copy) {
      copy.textContent = this.placementCandidate
        ? `${title} · site selected`
        : `${title} · tap a site on the map`;
    }
    const confirm = this.placementBar.querySelector<HTMLButtonElement>('[data-placement="confirm"]');
    if (confirm) confirm.disabled = !this.placementCandidate;
  }

  private confirmPlacementCandidate(): void {
    if (!this.placementCandidate || !this.readPlacementMode()) return;
    const { x, y } = this.placementCandidate;
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
    window.dispatchEvent(
      new MouseEvent('mousedown', { button: 0, buttons: 1, clientX: x, clientY: y }),
    );
    window.dispatchEvent(
      new MouseEvent('mouseup', { button: 0, buttons: 0, clientX: x, clientY: y }),
    );
  }

  private cancelPlacement(): void {
    if (!this.readPlacementMode()) return;
    const point = this.placementCandidate ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    window.dispatchEvent(
      new MouseEvent('mousedown', { button: 2, buttons: 2, clientX: point.x, clientY: point.y }),
    );
    window.dispatchEvent(
      new MouseEvent('mouseup', { button: 2, buttons: 0, clientX: point.x, clientY: point.y }),
    );
  }

  private readPlacementMode(): string | null {
    return (this.game as unknown as PlacementInternals).placementMode ?? null;
  }

  private togglePanel(panel: HTMLElement | null, chip: HTMLButtonElement | null): void {
    if (!panel) return;
    const alreadyOpen = panel.classList.contains('is-open');
    this.closeTransientPanels();
    if (alreadyOpen) return;
    panel.classList.add('is-open');
    chip?.classList.add('is-active');
  }

  private closeTransientPanels(): void {
    this.empireSheet?.classList.remove('is-open');
    this.empireSheet?.setAttribute('aria-hidden', 'true');
    this.citiesPanel?.classList.remove('is-open');
    this.eventFeed?.classList.remove('is-open');
    this.devMenu?.classList.remove('is-open');
    document.querySelector('.hud-formation-control.is-open')?.classList.remove('is-open');
    for (const chip of [
      this.treasuryChip,
      this.armiesChip,
      this.citiesChip,
      this.eventsChip,
      this.menuChip,
    ]) {
      chip?.classList.remove('is-active');
    }
  }

  private updateEventBadge(): void {
    if (!this.eventsChip || !this.eventFeed) return;
    const count = this.eventFeed.querySelectorAll('.event-feed-item').length;
    this.eventsChip.innerHTML = `<span class="hud-chip-icon">◉</span><span class="hud-chip-copy"><strong>${count || ''}</strong><small>Events</small></span>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
