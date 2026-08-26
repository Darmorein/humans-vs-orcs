import {
  formatEventTime,
  type WorldHistory,
} from './WorldHistory';
import { worldEventTypeLabel, type WorldEvent } from './Types';

/**
 * Lightweight scrollable chronicle feed — click focuses the camera when possible.
 */
export class EventFeed {
  private list: HTMLElement;
  private history: WorldHistory;
  private onFocus: (event: WorldEvent) => void;
  private unsub: (() => void) | null = null;

  constructor(history: WorldHistory, onFocus: (event: WorldEvent) => void) {
    this.history = history;
    this.onFocus = onFocus;

    this.list = document.getElementById('event-feed-list')!;
    this.unsub = history.onChange(() => this.render());
    this.render();
  }

  public destroy() {
    this.unsub?.();
  }

  private render() {
    const events = this.history.recent(12);
    this.list.innerHTML = '';
    if (events.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'event-feed-empty';
      empty.textContent = 'No major events yet…';
      this.list.appendChild(empty);
      return;
    }

    for (const e of events) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'event-feed-item';
      row.dataset.importance = e.importance >= 0.85 ? 'high' : e.importance >= 0.65 ? 'mid' : 'low';
      row.title = 'Focus camera on this event';
      row.innerHTML =
        `<span class="event-feed-time">${formatEventTime(e.timestamp)}</span>` +
        `<span class="event-feed-type">${worldEventTypeLabel(e.type)}</span>` +
        `<span class="event-feed-desc">${escapeHtml(e.description)}</span>`;
      row.addEventListener('click', () => this.onFocus(e));
      this.list.appendChild(row);
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
