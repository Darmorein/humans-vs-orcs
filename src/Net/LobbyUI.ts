import type { FactionId } from '../Players/Types';
import { PvpSession, type PvpMatchConfig } from './PvpSession';
import { DEFAULT_PVP_WS, modeLabel } from './Protocol';

export interface LobbyResult {
  kind: 'skirmish';
  localFaction: FactionId;
  seed?: number;
}

export type BootTarget =
  | LobbyResult
  | { kind: 'pvp'; config: PvpMatchConfig; session: PvpSession };

/**
 * Pre-match overlay: skirmish vs AI, or 1v1 lobby (faction / ready / start).
 */
export function mountLobby(onBoot: (target: BootTarget) => void): void {
  const lobbyRoot = document.getElementById('lobby');
  if (!lobbyRoot) {
    onBoot({ kind: 'skirmish', localFaction: 'humans' });
    return;
  }
  const root = lobbyRoot;

  const params = new URLSearchParams(window.location.search);
  if (params.get('skirmish') === '1' || params.get('pvp') === '0') {
    root.hidden = true;
    onBoot({
      kind: 'skirmish',
      localFaction: params.get('faction') === 'orcs' ? 'orcs' : 'humans',
      seed: params.get('seed') ? Number(params.get('seed')) : undefined,
    });
    return;
  }

  root.hidden = false;
  root.innerHTML = `
    <div class="lobby-panel">
      <h1 class="lobby-title">Humans vs Orcs</h1>
      <p class="lobby-sub">1v1 foundation — shared seed, independent factions</p>
      <div class="lobby-tabs">
        <button type="button" data-tab="skirmish" class="active">Skirmish (vs AI)</button>
        <button type="button" data-tab="pvp">PvP 1v1</button>
      </div>
      <div data-pane="skirmish" class="lobby-pane">
        <label class="lobby-field">Your faction
          <select id="skirmish-faction">
            <option value="humans">Humans</option>
            <option value="orcs">Orcs</option>
          </select>
        </label>
        <button type="button" id="skirmish-start" class="lobby-primary">Play vs AI</button>
      </div>
      <div data-pane="pvp" class="lobby-pane" hidden>
        <label class="lobby-field">Display name
          <input id="pvp-name" type="text" maxlength="24" value="Commander" />
        </label>
        <label class="lobby-field">Relay URL
          <input id="pvp-ws" type="text" value="${DEFAULT_PVP_WS}" />
        </label>
        <div class="lobby-row">
          <button type="button" id="pvp-create" class="lobby-primary">Create room</button>
          <input id="pvp-code" type="text" maxlength="8" placeholder="ROOM" class="lobby-code" />
          <button type="button" id="pvp-join">Join</button>
        </div>
        <p id="pvp-status" class="lobby-status">Start relay: <code>npm run pvp</code></p>
        <div id="pvp-room" class="lobby-room" hidden>
          <div class="lobby-room-head">
            <span>Room <strong id="pvp-room-id">—</strong></span>
            <span id="pvp-mode">—</span>
          </div>
          <div id="pvp-seats" class="lobby-seats"></div>
          <label class="lobby-field">Your faction
            <select id="pvp-faction">
              <option value="humans">Humans</option>
              <option value="orcs">Orcs</option>
            </select>
          </label>
          <div class="lobby-row">
            <button type="button" id="pvp-ready">Ready</button>
            <button type="button" id="pvp-start" class="lobby-primary" hidden>Start match</button>
          </div>
        </div>
      </div>
    </div>
  `;

  let session: PvpSession | null = null;
  let myReady = false;

  const panes = root.querySelectorAll<HTMLElement>('.lobby-pane');
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('[data-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      panes.forEach((p) => {
        p.hidden = p.dataset.pane !== tab;
      });
    });
  });

  root.querySelector('#skirmish-start')?.addEventListener('click', () => {
    const sel = root.querySelector('#skirmish-faction') as HTMLSelectElement;
    session?.dispose();
    root.hidden = true;
    onBoot({
      kind: 'skirmish',
      localFaction: sel.value === 'orcs' ? 'orcs' : 'humans',
    });
  });

  const statusEl = () => root.querySelector('#pvp-status') as HTMLElement;
  const roomEl = () => root.querySelector('#pvp-room') as HTMLElement;

  async function ensureSession(): Promise<PvpSession> {
    if (session) return session;
    const url = (root.querySelector('#pvp-ws') as HTMLInputElement).value.trim() || DEFAULT_PVP_WS;
    session = new PvpSession(url);
    await session.connect();
    session.onLobby((seats, info) => {
      if (info.error) statusEl().textContent = info.error;
      else if (info.roomId) statusEl().textContent = info.isHost ? 'Host — waiting for opponent' : 'Joined room';
      if (!info.roomId || !seats) return;
      roomEl().hidden = false;
      (root.querySelector('#pvp-room-id') as HTMLElement).textContent = info.roomId;
      (root.querySelector('#pvp-mode') as HTMLElement).textContent = modeLabel(
        seats[0].factionId,
        seats[1].factionId,
      );
      const seatsBox = root.querySelector('#pvp-seats') as HTMLElement;
      seatsBox.innerHTML = seats
        .map((s) => {
          const you = info.seat === s.seat ? ' (you)' : '';
          const ready = s.ready ? '✓ ready' : '…';
          const conn = s.connected ? s.displayName : 'empty';
          return `<div class="lobby-seat">Seat ${s.seat + 1}${you}: <b>${conn}</b> — ${s.factionId} — ${ready}</div>`;
        })
        .join('');
      const startBtn = root.querySelector('#pvp-start') as HTMLButtonElement;
      startBtn.hidden = !info.isHost;
      const fac = root.querySelector('#pvp-faction') as HTMLSelectElement;
      if (info.seat != null) {
        fac.value = seats[info.seat].factionId;
      }
    });
    session.onMatchStart((config) => {
      root.hidden = true;
      onBoot({ kind: 'pvp', config, session: session! });
    });
    return session;
  }

  root.querySelector('#pvp-create')?.addEventListener('click', async () => {
    try {
      const s = await ensureSession();
      const name = (root.querySelector('#pvp-name') as HTMLInputElement).value || 'Commander';
      s.createRoom(name);
      statusEl().textContent = 'Creating room…';
    } catch (e) {
      statusEl().textContent = e instanceof Error ? e.message : 'Connection failed';
    }
  });

  root.querySelector('#pvp-join')?.addEventListener('click', async () => {
    try {
      const s = await ensureSession();
      const name = (root.querySelector('#pvp-name') as HTMLInputElement).value || 'Commander';
      const code = (root.querySelector('#pvp-code') as HTMLInputElement).value;
      s.joinRoom(code, name);
      statusEl().textContent = 'Joining…';
    } catch (e) {
      statusEl().textContent = e instanceof Error ? e.message : 'Connection failed';
    }
  });

  root.querySelector('#pvp-faction')?.addEventListener('change', (ev) => {
    const v = (ev.target as HTMLSelectElement).value === 'orcs' ? 'orcs' : 'humans';
    session?.setFaction(v);
    myReady = false;
    const readyBtn = root.querySelector('#pvp-ready') as HTMLButtonElement;
    readyBtn.textContent = 'Ready';
  });

  root.querySelector('#pvp-ready')?.addEventListener('click', () => {
    myReady = !myReady;
    session?.setReady(myReady);
    const readyBtn = root.querySelector('#pvp-ready') as HTMLButtonElement;
    readyBtn.textContent = myReady ? 'Unready' : 'Ready';
  });

  root.querySelector('#pvp-start')?.addEventListener('click', () => {
    session?.startMatch();
  });
}
