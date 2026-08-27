import { MatchState } from '../Players/MatchState';
import { TAX_POLICIES, TAX_POLICY_DEFS, type TaxPolicy } from '../Players/TaxPolicy';
import type { Game } from '../Game';

/**
 * Presentation shell layered over the existing UIManager.
 * Keeps simulation/action wiring intact while turning the legacy always-open
 * panels into contextual, touch-friendly HUD surfaces.
 */
export class ResponsiveHud {
  private readonly game: Game;
  private raf = 0;
  private lastSig = '';

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

    this.bindShell();
    this.observeLegacyPanels();
    this.tick();
  }

  public destroy(): void {
    cancelAnimationFrame(this.raf);
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

    document.addEventListener('pointerdown', (event) => {
      const target = event.target as Node;
      const clickedHud =
        this.empireSheet?.contains(target) ||
        this.citiesPanel?.contains(target) ||
        this.eventFeed?.contains(target) ||
        this.devMenu?.contains(target) ||
        (target instanceof Element && Boolean(target.closest('#command-bar')));
      if (!clickedHud) this.closeTransientPanels();
    });
  }

  private observeLegacyPanels(): void {
    if (this.actionButtons) {
      const observer = new MutationObserver(() => this.decorateActionButtons());
      observer.observe(this.actionButtons, { childList: true, subtree: true });
      this.decorateActionButtons();
    }

    if (this.eventFeed) {
      const observer = new MutationObserver(() => this.updateEventBadge());
      observer.observe(this.eventFeed, { childList: true, subtree: true });
      this.updateEventBadge();
    }
  }

  private decorateActionButtons(): void {
    if (!this.actionButtons) return;
    const buttons = Array.from(this.actionButtons.querySelectorAll<HTMLButtonElement>('.action-btn'));
    for (const button of buttons) {
      const text = button.textContent?.trim() ?? '';
      if (/reinforce/i.test(text)) button.dataset.intent = 'primary';
      else if (/outpost|found city/i.test(text)) button.dataset.intent = 'strategic';
      else if (/tax:/i.test(text)) button.dataset.intent = 'govern';
      else if (/line|wedge|column|formation/i.test(text)) button.dataset.intent = 'formation';
      else if (/queue|recruit/i.test(text)) button.dataset.intent = 'production';
      else button.dataset.intent = 'secondary';
    }
  }

  private tick = (): void => {
    const local = MatchState.current?.localPlayer;
    const gold = local?.gold ?? 0;
    const squads = local ? this.game.getSquadSystem().squadsForOwner(local.id) : [];
    const cities = this.game.getOwnedCitiesOverview();
    const threatened = cities.filter((city) => city.underPressure).length;
    const sig = `${Math.floor(gold)}:${squads.length}:${cities.length}:${threatened}:${local?.taxPolicy ?? ''}`;

    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.renderTopBar(gold, squads.length, cities.length, threatened);
      if (this.empireSheet?.classList.contains('is-open')) {
        const mode = this.empireSheet.dataset.mode === 'armies' ? 'armies' : 'treasury';
        this.renderEmpireSheet(mode);
      }
    }

    this.raf = requestAnimationFrame(this.tick);
  };

  private renderTopBar(gold: number, armies: number, cities: number, threatened: number): void {
    if (this.treasuryChip) {
      this.treasuryChip.innerHTML = `<span class="hud-chip-icon">◆</span><span class="hud-chip-copy"><strong>${Math.floor(gold)}</strong><small>Treasury</small></span>`;
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
    const alreadyOpen = this.empireSheet.classList.contains('is-open') && this.empireSheet.dataset.mode === mode;
    this.closeTransientPanels();
    if (alreadyOpen) return;
    this.empireSheet.dataset.mode = mode;
    this.renderEmpireSheet(mode);
    this.empireSheet.classList.add('is-open');
    this.empireSheet.setAttribute('aria-hidden', 'false');
    const chip = mode === 'treasury' ? this.treasuryChip : this.armiesChip;
    chip?.classList.add('is-active');
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
              const warning = squad.routing || squad.isDepleted ? '<span class="hud-warning">⚠</span>' : '';
              return `<div class="hud-list-row"><div><strong>${warning}${escapeHtml(squad.displayName || squad.label)}</strong><small>${squad.size}/${cap} · ${escapeHtml(squad.formation)}${squad.routing ? ' · ROUT' : ''}</small></div><span class="hud-meter"><i style="width:${morale}%"></i></span></div>`;
            })
            .join('')
        : '<div class="hud-empty">No active armies</div>';
      this.empireSheet.innerHTML = `<div class="sheet-grabber"></div><header><div><small>COMMAND</small><h2>Armies</h2></div><button class="sheet-close" type="button" aria-label="Close">×</button></header><div class="hud-list">${rows}</div>`;
      this.empireSheet.querySelector<HTMLButtonElement>('.sheet-close')?.addEventListener('click', () => this.closeTransientPanels());
      return;
    }

    const def = TAX_POLICY_DEFS[local.taxPolicy];
    const taxButtons = TAX_POLICIES.map((policy) => {
      const policyDef = TAX_POLICY_DEFS[policy];
      const active = policy === local.taxPolicy ? ' is-selected' : '';
      return `<button class="choice-card${active}" type="button" data-tax-policy="${policy}"><strong>${escapeHtml(policyDef.label)}</strong><small>${policy === 'war' ? 'Maximum treasury, heavy city pressure' : policy === 'light' ? 'Lower revenue, healthier growth' : 'Balanced city contribution'}</small></button>`;
    }).join('');

    this.empireSheet.innerHTML = `<div class="sheet-grabber"></div><header><div><small>EMPIRE</small><h2>Treasury</h2></div><button class="sheet-close" type="button" aria-label="Close">×</button></header><div class="treasury-hero"><strong>${Math.floor(local.gold)}</strong><span>strategic gold</span></div><div class="sheet-section"><label>Tax policy · ${escapeHtml(def.label)}</label><div class="choice-grid">${taxButtons}</div></div>`;
    this.empireSheet.querySelector<HTMLButtonElement>('.sheet-close')?.addEventListener('click', () => this.closeTransientPanels());
    for (const button of this.empireSheet.querySelectorAll<HTMLButtonElement>('[data-tax-policy]')) {
      button.addEventListener('click', () => {
        const policy = button.dataset.taxPolicy as TaxPolicy;
        this.game.setTaxPolicy(policy);
      });
    }
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
    for (const chip of [this.treasuryChip, this.armiesChip, this.citiesChip, this.eventsChip, this.menuChip]) {
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
