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
    const bothAi = params.get('aiVai') === '1' || params.get('aivsai') === '1';
    game = new Game({
      seed,
      localFaction: target.localFaction,
      bothAi,
    });
  }

  game.start();

  if (params.get('debug') === '1' || params.get('detTest') === '1') {
    (window as unknown as { __game?: Game }).__game = game;
  }

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
  if (seedLabel) {
    seedLabel.textContent = `Seed: ${game.seed}${params.get('aiVai') === '1' ? ' (AI vs AI)' : ''}`;
  }

  if (!game.worldValidation.ok) {
    console.warn('[WorldGen] map validation incomplete', game.worldValidation);
  } else {
    console.info('[WorldGen] fair map ok', game.seed);
  }

  if (params.get('diagnose') === '1') {
    const ok = MapGenerator.assertDeterministic(game.seed);
    console.info(`[WorldGen] determinism seed=${game.seed}: ${ok ? 'OK' : 'FAIL'}`);
  }

  if (params.get('detTest') === '1') {
    const n = Number(params.get('n') ?? 90);
    const m = Number(params.get('m') ?? 90);
    // Defer so first frames can settle
    setTimeout(() => {
      const result = game.runSaveLoadDeterminismTest(
        Number.isFinite(n) ? n : 90,
        Number.isFinite(m) ? m : 90,
      );
      console.info('[DeterminismTest]', result.ok ? 'PASS' : 'FAIL', result);
    }, 500);
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

  const params = new URLSearchParams(window.location.search);
  if (params.get('aiVai') === '1' || params.get('skirmish') === '1') {
    void bootGame({
      kind: 'skirmish',
      localFaction: params.get('faction') === 'orcs' ? 'orcs' : 'humans',
      seed: params.get('seed') ? Number(params.get('seed')) : undefined,
    });
    return;
  }

  mountLobby((target) => {
    void bootGame(target);
  });
}

boot();
