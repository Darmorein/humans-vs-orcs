import './style.css';
import { assets } from './Assets/Assets';
import { Game } from './Game';
import { MapGenerator } from './Map/MapGenerator';
import { mountLobby, type BootTarget } from './Net';
import {
  clearPendingLoadSlot,
  peekPendingLoadSlot,
  readSaveFromStorage,
} from './Sim';

async function bootGame(target: BootTarget) {
  const params = new URLSearchParams(window.location.search);
  let game: Game;

  if (target.kind === 'pvp') {
    game = new Game({
      seed: target.config.seed,
      pvp: {
        factions: target.config.factions,
        localSeat: target.config.localSeat,
        session: target.session,
        modeLabel: target.config.mode,
      },
    });
  } else {
    const seedParam = params.get('seed');
    const seedFromUrl = seedParam ? Number(seedParam) : undefined;
    const seed =
      target.seed ?? (Number.isFinite(seedFromUrl) ? seedFromUrl : undefined);
    game = new Game({
      seed,
      localFaction: target.localFaction,
    });
  }

  game.start();

  if (target.kind === 'skirmish') {
    const wantLoad = params.get('load') === '1';
    const pendingSlot = peekPendingLoadSlot();
    if (wantLoad || pendingSlot) {
      const slot = pendingSlot ?? 'default';
      const save = readSaveFromStorage(slot);
      if (save && save.seed === game.seed) {
        game.applySave(save);
        clearPendingLoadSlot();
        if (wantLoad) {
          const url = new URL(window.location.href);
          url.searchParams.delete('load');
          window.history.replaceState({}, '', url.toString());
        }
      } else if (wantLoad) {
        console.warn('[Load] pending save missing or seed mismatch');
        clearPendingLoadSlot();
      }
    }
  }

  const seedLabel = document.getElementById('seed-label');
  if (seedLabel) seedLabel.textContent = `Seed: ${game.seed}`;

  if (!game.worldValidation.ok) {
    console.warn('[WorldGen] map validation incomplete', game.worldValidation);
  } else {
    console.info('[WorldGen] fair map ok', game.seed);
  }

  if (params.get('diagnose') === '1') {
    const ok = MapGenerator.assertDeterministic(game.seed);
    console.info(`[WorldGen] determinism seed=${game.seed}: ${ok ? 'OK' : 'FAIL'}`);
  }
}

async function boot() {
  const loading = document.getElementById('loading');
  try {
    await assets.load();
  } catch (err) {
    console.error(err);
  }
  if (loading) loading.remove();

  mountLobby((target) => {
    void bootGame(target);
  });
}

boot();
