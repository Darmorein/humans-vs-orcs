import { GameLoop } from './Engine/GameLoop';
import { Renderer } from './Engine/Renderer';
import { Camera } from './Engine/Camera';
import { InputManager } from './Engine/InputManager';
import { GameMap } from './Map/GameMap';
import { MapGenerator } from './Map/MapGenerator';
import { canPlaceBuildingAt, footprintForBuildingType, placementBlockReason } from './Map/BuildPlacement';
import { Entity } from './Entities/Entity';
import { Unit } from './Entities/Unit';
import { Building, isMainBuilding } from './Entities/Building';
import type { BuildingType } from './Entities/Building';
import { ResourceNode } from './Entities/ResourceNode';
import { SelectionSystem } from './Systems/SelectionSystem';
import { UIManager } from './UI/UIManager';
import { FogOfWar } from './Systems/FogOfWar';
import { drawIsoBox, drawIsoEllipse, isoDepth } from './Engine/Iso';
import { assets } from './Assets/Assets';
import { createDefaultMatch, createPvpMatch, MatchState, type PlayerState } from './Players/MatchState';
import type { PlayerController } from './Players/PlayerController';
import { LocalPlayerController } from './Players/LocalPlayerController';
import { AIPlayerController } from './Players/AIPlayerController';
import { RemotePlayerController } from './Players/RemotePlayerController';
import type { FactionId } from './Players/Types';
import {
  applyCapitalDefeatFlags,
  resolveLocalMatchOutcome,
} from './Players/FactionDefeatState';
import { SettlementSystem } from './Settlement/SettlementSystem';
import { civilianVisualAgents } from './Settlement/CivilianVisualAgents';
import { populationSim, PopulationSim } from './Settlement/Population/PopulationSim';
import { TIER_DEFS } from './Settlement/SettlementTier';
import type { SettlementFocus } from './Settlement/SettlementFocus';
import type { TaxPolicy } from './Players/TaxPolicy';
import { taxPolicyLabel } from './Players/TaxPolicy';
import { InfluenceMap } from './Map/InfluenceMap';
import { SquadSystem } from './Combat/SquadSystem';
import { HeroSystem } from './Heroes';
import { ArtifactSystem } from './Artifacts';
import { WorldHistory, EventFeed } from './WorldHistory';
import type { WorldEvent } from './WorldHistory';
import {
  CommandQueue,
  GameRng,
  ReplayPlayer,
  ReplayRecorder,
  SIM_TICK_DT,
  applyCommand,
  buildSaveGame,
  clearPendingLoadSlot,
  compareSaveLoadHashes,
  downloadJson,
  hashGameSnapshot,
  hydrateFromSnapshot,
  markPendingLoad,
  mountSimDiagnostics,
  readSaveFromStorage,
  serializeGameState,
  writeSaveToStorage,
  DEFAULT_SAVE_SLOT,
  type AiVsAiDeterminismResult,
  type DeterminismTestResult,
  type GameCommand,
  type GameStateSnapshot,
  type ReplayManifest,
  type SaveGame,
} from './Sim';
import { compareAiVsAiHashes, diffSnapshotHints } from './Sim/determinismTest';
import { spawnUnitRegistered } from './Sim/spawnUnit';
import { unitSpawnOptions } from './Sim/UnitCatalog';
import { PVP_COMMAND_DELAY_TICKS, type PvpSession } from './Net';
import {
  CITY_PACING,
  MATCH_DOMINANCE_RESOLVE_SEC,
  MATCH_SOFT_CAP_SEC,
  MatchPacingDiagnostics,
  strategicDominanceScore,
} from './Match/MatchPacing';
import { isCombatUnitType } from './Combat/Squad';
import { MilitaryRecruitmentSystem } from './Combat/MilitaryRecruitment';
import {
  defaultMeleeSquadTemplate,
  defaultRangedSquadTemplate,
  squadTemplatesForFaction,
} from './Combat/SquadTemplates';
import type { SquadTemplate } from './Combat/SquadTemplates';
import { formationOffsets, orientOffsets } from './Combat/Formations';
import { doctrineOf } from './Players/FactionDoctrine';

/** Boot options for skirmish or synchronized PvP 1v1. */
export interface GameOptions {
  seed?: number;
  /** Skirmish: local faction (opponent = other, AI). */
  localFaction?: FactionId;
  /** Both seats AI (determinism smoke / spectator). */
  bothAi?: boolean;
  /** PvP: both factions + local seat; creates REMOTE opponent. */
  pvp?: {
    factions: [FactionId, FactionId];
    localSeat: 0 | 1;
    session: PvpSession;
    modeLabel?: string;
  };
}

/**
 * Host shell: presentation + local input → GameCommand queue → fixed-tick simulation.
 * PvP: remote commands inject into the same queue; map seed is shared.
 */
export class Game {
  private loop: GameLoop;
  private renderer: Renderer;
  private camera: Camera;
  private input: InputManager;
  private gameMap: GameMap;
  private fog: FogOfWar;
  public readonly seed: number;
  public readonly worldValidation: GameMap['validation'];

  private match: MatchState;
  private controllers: PlayerController[] = [];
  private aiControllers: AIPlayerController[] = [];

  private entities: Entity[] = [];
  private selectionSystem: SelectionSystem;
  private uiManager: UIManager;
  private settlementSystem: SettlementSystem;
  private influenceMap: InfluenceMap;
  private civilianVisuals = civilianVisualAgents;
  private squadSystem: SquadSystem;
  private recruitment = new MilitaryRecruitmentSystem();
  private heroSystem: HeroSystem;
  private artifactSystem: ArtifactSystem;
  private worldHistory: WorldHistory;
  private eventFeed!: EventFeed;

  private readonly commandQueue = new CommandQueue();
  private readonly simRng: GameRng;
  /** Applied player commands for future replay (seed + this log). */
  private readonly replayRecorder = new ReplayRecorder();
  /** Dev replay: inject recorded commands; live controllers paused while active. */
  private readonly replayPlayer = new ReplayPlayer();
  /** Monotonic simulation tick (fixed step). */
  private simTick = 0;

  private placementMode: BuildingType | 'foundSettlement' | 'establishOutpost' | null = null;
  /** Short-lived player-facing build / place feedback (not serialized). */
  private buildFeedback: string | null = null;
  private buildFeedbackTimer = 0;
  /** Brief ground cue after Move/Attack (local feedback only). */
  private orderMarker: {
    x: number;
    y: number;
    ttl: number;
    kind: 'move' | 'attack';
  } | null = null;
  private gameState: 'playing' | 'victory' | 'defeat' = 'playing';
  private readonly pacingDiag = new MatchPacingDiagnostics();
  private readonly debugPacing =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('debug') === '1';
  /** Per-seat peak city count for second-city timing. */
  private readonly seatCityPeaks = new Map<string, number>();

  private pvpSession: PvpSession | null = null;
  private pvpUnsubs: Array<() => void> = [];
  private pvpModeLabel: string | null = null;
  private lastStateHash = '—';
  private pvpRemoteHash: string | null = null;
  private pvpLastCompareTick: number | null = null;
  private static readonly PVP_HASH_INTERVAL = 120;

  constructor(options?: number | GameOptions) {
    const opts: GameOptions =
      typeof options === 'number' ? { seed: options } : options ?? {};

    this.seed = (opts.seed ?? Math.floor(Math.random() * 1_000_000_000)) >>> 0 || 1;
    // Separate stream from map gen so gameplay rolls stay stable if map code changes.
    this.simRng = new GameRng((this.seed ^ 0x9e3779b9) >>> 0 || 1);

    this.renderer = new Renderer('game-canvas');
    this.camera = new Camera(this.renderer.canvas.width, this.renderer.canvas.height);
    this.input = new InputManager();

    const generated = MapGenerator.create(this.seed);
    this.gameMap = new GameMap(generated);
    this.worldValidation = generated.validation;
    this.fog = new FogOfWar(this.gameMap.width, this.gameMap.height);
    this.selectionSystem = new SelectionSystem();
    this.uiManager = new UIManager(this);
    this.settlementSystem = new SettlementSystem();
    this.influenceMap = new InfluenceMap(this.gameMap.width, this.gameMap.height);
    this.squadSystem = new SquadSystem();
    this.heroSystem = new HeroSystem();
    this.artifactSystem = new ArtifactSystem();
    this.worldHistory = new WorldHistory();
    HeroSystem.active = this.heroSystem;
    ArtifactSystem.active = this.artifactSystem;
    WorldHistory.active = this.worldHistory;
    this.selectionSystem.bindSquads(this.squadSystem);
    this.selectionSystem.bindCommandSink((cmd) => this.submitCommand(cmd));

    if (opts.pvp) {
      this.pvpSession = opts.pvp.session;
      this.pvpModeLabel = opts.pvp.modeLabel ?? null;
      this.match = createPvpMatch({
        factions: opts.pvp.factions,
        localSeat: opts.pvp.localSeat,
      });
    } else {
      this.match = createDefaultMatch({
        localFaction: opts.localFaction ?? 'humans',
        localController: opts.bothAi ? 'AI' : 'LOCAL',
        opponentController: 'AI',
      });
    }
    this.controllers = this.buildControllers(this.match);

    Unit.onUnitKilled = (victim, killer) => {
      this.squadSystem.notifyKill(killer);
      if (killer instanceof Unit) this.heroSystem.noteKill(killer, victim);
      if (victim.isHero || victim.heroId) this.heroSystem.noteHeroFallen(victim, killer);
      if (victim.artifactId) this.artifactSystem.noteCarrierKilled(victim, killer);
      this.worldHistory.noteCombatDeath(victim, killer);
      this.settlementSystem.noteMilitaryCasualty(victim);
    };
    Building.onConstructed = (building, entities) => {
      const builders: Unit[] = entities.filter(
        (e): e is Unit =>
          e instanceof Unit &&
          !e.isDead &&
          e.buildTarget === building &&
          e.ownerPlayerId === building.ownerPlayerId,
      );
      if (builders.length === 0) {
        for (const e of entities) {
          if (!(e instanceof Unit) || e.isDead) continue;
          if (e.ownerPlayerId !== building.ownerPlayerId) continue;
          if (e.unitType !== 'Worker' && e.unitType !== 'Peon') continue;
          if (Math.hypot(e.x - building.x, e.y - building.y) < 80) builders.push(e);
        }
      }
      this.heroSystem.noteStructureRaised(builders, building);
      if (
        building.ownerPlayerId === this.match.localPlayerId &&
        (building.buildingType === 'Outpost' || building.buildingType === 'Fort')
      ) {
        this.showBuildFeedback(`${building.buildingType} complete — influence active`);
      }
    };
    SettlementSystem.onSettlementFounded = (playerId, settlers, camp) => {
      this.heroSystem.noteSettlementFounded(settlers, playerId);
      const player = this.match.getPlayer(playerId);
      this.worldHistory.noteSettlementFounded(camp, player?.displayName ?? playerId);
    };
    PopulationSim.onCitizenMigrated = (from, to, citizenId) => {
      this.worldHistory.noteCitizenMigrated(from, to, citizenId);
    };

    window.addEventListener('resize', () => {
      this.camera.resize(this.renderer.canvas.width, this.renderer.canvas.height);
    });

    this.spawnPlayers();
    this.worldHistory.seedKnownSettlements(this.settlementSystem);
    const localBase = this.baseForPlayer(this.match.localPlayer);
    this.camera.centerOn(localBase.x + 40, localBase.y);

    this.eventFeed = new EventFeed(this.worldHistory, (ev) => this.focusWorldEvent(ev));

    this.loop = new GameLoop(
      (frameDt) => this.onFrame(frameDt),
      (simDt) => this.onSimTick(simDt),
      () => this.render(),
    );

    this.bindNewMapButton();
    this.bindTerritoryButton();
    this.bindSaveLoadButtons();
    this.bindSurrenderButton();
    this.replayRecorder.reset(0);
    this.wirePvpSession();
  }

  public start() {
    this.loop.start();
    mountSimDiagnostics(() => this.collectDiagnostics());
  }

  /** Current gameplay hash (dev / PvP desync). */
  public computeStateHash(): string {
    return hashGameSnapshot(this.exportStateSnapshot());
  }

  /**
   * Save/load determinism smoke: run n ticks, snapshot, run m more → hashA;
   * reload snapshot, run m → hashB.
   */
  public runSaveLoadDeterminismTest(n = 120, m = 120): DeterminismTestResult {
    const wasPlaying = this.gameState;
    this.gameState = 'playing';
    for (let i = 0; i < n; i++) this.debugSimTick();
    const mid = this.exportStateSnapshot();
    const save = buildSaveGame({
      seed: this.seed,
      simTick: this.simTick,
      snapshot: mid,
      replayCommands: this.replayRecorder.getCommands(),
    });
    for (let i = 0; i < m; i++) this.debugSimTick();
    const afterContinue = this.exportStateSnapshot();
    this.applySave(save);
    for (let i = 0; i < m; i++) this.debugSimTick();
    const afterReload = this.exportStateSnapshot();
    this.gameState = wasPlaying;
    const result = compareSaveLoadHashes(this.seed, n, m, afterContinue, afterReload);
    console.info('[Determinism]', result);
    if (result.mismatchHints?.length) {
      console.warn('[Determinism] hints', result.mismatchHints);
    }
    return result;
  }

  /**
   * AI vs AI twin run from a boot snapshot: N ticks twice → hashes must match.
   * Both legs start from the same hydrated boot (avoids construct-vs-hydrate skew).
   */
  public runAiVsAiDeterminismTest(ticks = 600): AiVsAiDeterminismResult {
    const wasPlaying = this.gameState;
    this.gameState = 'playing';
    const boot = buildSaveGame({
      seed: this.seed,
      simTick: this.simTick,
      snapshot: this.exportStateSnapshot(),
      replayCommands: this.replayRecorder.getCommands(),
    });
    // Normalize to hydrated boot before both legs.
    this.applySave(boot);
    for (let i = 0; i < ticks; i++) this.debugSimTick();
    const snapA = this.exportStateSnapshot();
    this.applySave(boot);
    for (let i = 0; i < ticks; i++) this.debugSimTick();
    const snapB = this.exportStateSnapshot();
    this.gameState = wasPlaying;
    const result = compareAiVsAiHashes(this.seed, ticks, snapA, snapB);
    console.info('[AiVsAiDeterminism]', result);
    if (result.mismatchHints?.length) {
      console.warn('[AiVsAiDeterminism] hints', result.mismatchHints);
    }
    return result;
  }

  /** Snapshot round-trip: export → hydrate → export must match (lossy serialize detector). */
  public runSnapshotRoundTripTest(): { ok: boolean; hashA: string; hashB: string; hints?: string[] } {
    const a = this.exportStateSnapshot();
    const save = buildSaveGame({
      seed: this.seed,
      simTick: this.simTick,
      snapshot: a,
      replayCommands: this.replayRecorder.getCommands(),
    });
    this.applySave(save);
    const b = this.exportStateSnapshot();
    const hashA = hashGameSnapshot(a);
    const hashB = hashGameSnapshot(b);
    const ok = hashA === hashB;
    const hints = ok ? undefined : diffSnapshotHints(a, b);
    console.info('[SnapshotRoundTrip]', ok ? 'PASS' : 'FAIL', { hashA, hashB, hints });
    return { ok, hashA, hashB, hints };
  }

  /** Advance one sim tick without frame/input (tests). */
  public debugSimTick() {
    this.onSimTick(SIM_TICK_DT);
  }

  /**
   * Local UI / selection enqueue intents.
   * AI uses enqueueCommand via GameContext (any seat it controls).
   */
  public submitCommand(cmd: GameCommand): void {
    if (this.gameState !== 'playing') return;
    if (cmd.playerId !== this.match.localPlayerId) return;
    this.enqueueCommand(cmd);
  }

  /**
   * Simulation command ingress for LOCAL UI, AI seats, and internal systems.
   * PvP relays only local-seat orders.
   */
  public enqueueCommand(cmd: GameCommand): void {
    if (this.gameState !== 'playing') return;
    if (!this.match.getPlayer(cmd.playerId)) return;

    const delay = this.pvpSession ? PVP_COMMAND_DELAY_TICKS : 0;
    const stamped: GameCommand = {
      ...cmd,
      issuedAtTick: this.simTick + delay,
    };
    this.commandQueue.enqueue(stamped);
    if (this.pvpSession && cmd.playerId === this.match.localPlayerId) {
      this.pvpSession.sendCommand(stamped);
    }
  }

  /** Inject a command received from the peer (same queue as local). */
  public submitRemoteCommand(cmd: GameCommand): void {
    if (this.gameState !== 'playing') return;
    if (cmd.playerId === this.match.localPlayerId) return;
    const at = Math.max(cmd.issuedAtTick ?? this.simTick + 1, this.simTick + 1);
    this.commandQueue.enqueue({ ...cmd, issuedAtTick: at });
  }

  public surrender(): void {
    if (this.gameState !== 'playing') return;
    this.submitCommand({
      type: 'surrender',
      playerId: this.match.localPlayerId,
    });
  }

  public getSimTick(): number {
    return this.simTick;
  }

  public getSimTickDt(): number {
    return SIM_TICK_DT;
  }

  /** Serializable match snapshot (desync / replay / future multiplayer). */
  public exportStateSnapshot(): GameStateSnapshot {
    return serializeGameState({
      seed: this.seed,
      mapGeneratorVersion: this.gameMap.mapGeneratorVersion,
      simTick: this.simTick,
      rng: this.simRng,
      match: this.match,
      entities: this.entities,
      settlements: this.settlementSystem,
      pendingCommands: this.commandQueue.snapshotPending(),
      squads: this.squadSystem,
      recruitment: this.recruitment,
      heroes: this.heroSystem,
      artifacts: this.artifactSystem,
      history: this.worldHistory,
      softState: this.captureSoftSimState(),
      pacingDiagnostics: this.pacingDiag.capture(),
    });
  }

  private captureSoftSimState() {
    const hero = this.heroSystem.captureSoftTimers();
    const art = this.artifactSystem.captureSoftTimers();
    const hist = this.worldHistory.captureSoftTimers();
    const ai = this.controllers
      .filter((c): c is AIPlayerController => c instanceof AIPlayerController)
      .map((c) => c.captureSoftState());
    return {
      populationAccum: populationSim.getAccum(),
      heroElapsed: hero.elapsed,
      heroEvalTimer: hero.evalTimer,
      artifactElapsed: art.elapsed,
      artifactForgeTimer: art.forgeTimer,
      artifactForgeCooldowns: art.forgeCooldowns,
      historyElapsed: hist.elapsed,
      historyTerritoryTimer: hist.territoryCheckTimer,
      influenceAccum: this.influenceMap.getAccum(),
      ai,
    };
  }

  /**
   * Persist dual payload: GameStateSnapshot (authoritative Load) +
   * ReplayManifest (seed + TimedCommand[] for future reconstruct).
   */
  public saveGame(slot = DEFAULT_SAVE_SLOT): SaveGame {
    const save = buildSaveGame({
      seed: this.seed,
      simTick: this.simTick,
      snapshot: this.exportStateSnapshot(),
      replayCommands: this.replayRecorder.getCommands(),
      replayStartTick: 0,
    });
    writeSaveToStorage(save, slot);
    console.info(
      `[Save] slot=${slot} tick=${save.simTick} cmds=${save.replay.commands.length} (${save.replay.determinism.level})`,
    );
    return save;
  }

  /**
   * Load from localStorage. Same seed → in-place hydrate; otherwise reload with seed.
   */
  public loadGame(slot = DEFAULT_SAVE_SLOT): boolean {
    const save = readSaveFromStorage(slot);
    if (!save) {
      console.warn(`[Load] no save in slot=${slot}`);
      return false;
    }
    if (save.seed !== this.seed) {
      markPendingLoad(slot);
      const url = new URL(window.location.href);
      url.searchParams.set('seed', String(save.seed));
      url.searchParams.set('load', '1');
      window.location.href = url.toString();
      return true;
    }
    this.applySave(save);
    clearPendingLoadSlot();
    return true;
  }

  /** Apply SaveGame snapshot into the running match (map already matches seed). */
  public applySave(save: SaveGame): void {
    this.gameState = 'playing';
    this.placementMode = null;
    this.civilianVisuals.clear();
    this.commandQueue.drain();
    this.selectionSystem.selectedEntities = [];

    hydrateFromSnapshot(save.snapshot, {
      entities: this.entities,
      match: this.match,
      settlements: this.settlementSystem,
      squads: this.squadSystem,
      recruitment: this.recruitment,
      heroes: this.heroSystem,
      artifacts: this.artifactSystem,
      history: this.worldHistory,
      rng: this.simRng,
      setSimTick: (t) => {
        this.simTick = t;
      },
      unitOptions: (type) => this.unitOptions(type),
      restoreAiSoft: (rows) => {
        for (const row of rows) {
          const ctrl = this.controllers.find(
            (c) => c instanceof AIPlayerController && c.playerId === row.playerId,
          ) as AIPlayerController | undefined;
          ctrl?.restoreSoftState(row);
        }
      },
    });

    this.replayRecorder.restore(
      save.replay.commands,
      save.replay.startTick,
      save.replay.endTick,
    );

    for (const cmd of save.snapshot.pendingCommands) {
      this.commandQueue.enqueue(cmd);
    }

    this.influenceMap.rebuild(this.settlementSystem.all(), this.match);
    if (save.snapshot.softState) {
      this.influenceMap.setAccum(save.snapshot.softState.influenceAccum);
    }
    this.pacingDiag.restore(save.snapshot.pacingDiagnostics);
    this.fog.update(this.entities, this.gameMap, this.match.localPlayerId, this.influenceMap);
    console.info(
      `[Load] tick=${this.simTick} entities=${this.entities.length} cmdsLogged=${save.replay.commands.length}`,
    );
  }

  /** Download ReplayManifest JSON (seed + player commands). */
  public exportReplay(): void {
    const manifest = this.replayRecorder.toManifest(this.seed);
    downloadJson(`hvo-replay-seed${this.seed}-t${this.simTick}.json`, manifest);
  }

  /**
   * Development replay: same seed + ReplayManifest commands.
   * Call on a fresh match with matching seed; skips live AI/local while active.
   */
  public beginDevReplay(manifest: ReplayManifest): boolean {
    if (manifest.seed !== this.seed) {
      console.warn('[Replay] seed mismatch', manifest.seed, this.seed);
      return false;
    }
    this.replayPlayer.load(manifest);
    console.info(
      `[Replay] active cmds=${manifest.commands.length} endTick=${manifest.endTick}`,
    );
    return true;
  }

  public stopDevReplay(): void {
    this.replayPlayer.stop();
  }

  /** Placement preview only — world change happens via GameCommand on confirm. */
  public startBuildingPlacement(type: BuildingType) {
    if (this.gameState !== 'playing') return;
    this.placementMode = type;
    this.showBuildFeedback(`Place ${type} — LMB confirm, RMB cancel`);
  }

  public startFoundSettlementPlacement() {
    if (this.gameState !== 'playing') return;
    const local = this.match.localPlayer;
    const group = this.settlementSystem.getSettlerGroup(local.id);
    if (!group && !this.settlementSystem.canFormSettlerGroup(local.id, local.factionId, this.match)) {
      const why =
        this.settlementSystem.formSettlerGroupBlockReason(
          local.id,
          local.factionId,
          this.match,
        ) ?? 'Cannot found city';
      this.showBuildFeedback(why);
      return;
    }
    this.placementMode = 'foundSettlement';
    this.showBuildFeedback('Found City — click valid land');
  }

  public startEstablishOutpostPlacement() {
    if (this.gameState !== 'playing') return;
    this.placementMode = 'establishOutpost';
    this.showBuildFeedback('Place Outpost — click site (reasons shown if blocked)');
  }

  /** Toast explaining why a build/place/train action failed. */
  public showBuildFeedback(message: string, seconds = 3.5) {
    this.buildFeedback = message;
    this.buildFeedbackTimer = seconds;
  }

  public formSettlerGroup(): boolean {
    if (this.gameState !== 'playing') return false;
    if (!this.canFormSettlerGroup()) {
      const local = this.match.localPlayer;
      const why =
        this.settlementSystem.formSettlerGroupBlockReason(
          local.id,
          local.factionId,
          this.match,
        ) ?? 'Cannot form caravan';
      this.showBuildFeedback(why);
      return false;
    }
    this.submitCommand({
      type: 'formSettlerGroup',
      playerId: this.match.localPlayerId,
    });
    return true;
  }

  public canFormSettlerGroup(): boolean {
    const local = this.match.localPlayer;
    return this.settlementSystem.canFormSettlerGroup(local.id, local.factionId, this.match);
  }

  public formSettlerGroupBlockReason(): string | null {
    const local = this.match.localPlayer;
    return this.settlementSystem.formSettlerGroupBlockReason(
      local.id,
      local.factionId,
      this.match,
    );
  }

  public hasReadySettlerGroup(): boolean {
    const g = this.settlementSystem.getSettlerGroup(this.match.localPlayerId);
    return !!g && g.status === 'ready';
  }

  /** Change Faction Tax Policy (cooldown enforced in applyCommand). */
  public setTaxPolicy(policy: TaxPolicy) {
    this.submitCommand({
      type: 'setTaxPolicy',
      playerId: this.match.localPlayerId,
      policy,
    });
  }

  public queueStrategic(type: BuildingType, at: { x: number; y: number }) {
    this.submitCommand({
      type: 'queueBuilding',
      playerId: this.match.localPlayerId,
      buildingType: type,
      x: at.x,
      y: at.y,
    });
  }

  public cancelConstruction(projectId: string) {
    this.submitCommand({
      type: 'cancelConstruction',
      playerId: this.match.localPlayerId,
      projectId,
    });
  }

  public moveConstruction(projectId: string, direction: -1 | 1) {
    this.submitCommand({
      type: 'reorderConstruction',
      playerId: this.match.localPlayerId,
      projectId,
      direction,
    });
  }

  public trainUnit(building: Building, type: string, cost?: number) {
    // Legacy single-unit path — kept for replay/saves; UI uses recruitSquad.
    this.submitCommand({
      type: 'trainUnit',
      playerId: this.match.localPlayerId,
      buildingId: building.id,
      unitType: type,
      cost,
    });
  }

  public recruitSquad(templateId: string) {
    this.submitCommand({
      type: 'recruitSquad',
      playerId: this.match.localPlayerId,
      templateId,
    });
  }

  public reinforceSquad(squadId: string) {
    this.submitCommand({
      type: 'reinforceSquad',
      playerId: this.match.localPlayerId,
      squadId,
    });
  }

  public recruitSquadBlockReason(templateId: string): string | null {
    return this.recruitment.recruitBlockReason(
      this.match.localPlayerId,
      templateId,
      this.entities,
      this.match,
      this.settlementSystem,
    );
  }

  public reinforceSquadBlockReason(squadId: string): string | null {
    return this.recruitment.reinforceBlockReason(
      this.match.localPlayerId,
      squadId,
      this.entities,
      this.match,
      this.settlementSystem,
      this.squadSystem,
    );
  }

  public listSquadTemplatesForLocal() {
    return squadTemplatesForFaction(this.match.localPlayer.factionId);
  }

  public listMilitaryQueue() {
    return this.recruitment.list(this.match.localPlayerId);
  }

  /** Soft development focus for an owned settlement seat. */
  public setSettlementFocus(settlementId: string, focus: SettlementFocus) {
    this.submitCommand({
      type: 'setSettlementFocus',
      playerId: this.match.localPlayerId,
      settlementId,
      focus,
    });
  }

  private buildControllers(match: MatchState): PlayerController[] {
    const list: PlayerController[] = [];
    this.aiControllers = [];
    for (const player of match.allPlayers()) {
      if (player.controllerType === 'LOCAL') {
        list.push(new LocalPlayerController(player.id));
      } else if (player.controllerType === 'AI') {
        const ai = new AIPlayerController(player.id);
        this.aiControllers.push(ai);
        list.push(ai);
      } else {
        list.push(new RemotePlayerController(player.id));
      }
    }
    return list;
  }

  private baseForPlayer(player: PlayerState): { x: number; y: number } {
    // Seat → fair start slot (SW/NE), not faction look.
    return player.id === 'player-1' ? this.gameMap.startA : this.gameMap.startB;
  }

  /**
   * Spawn one closed starter squad (melee or ranged) offset from the capital.
   */
  private spawnStarterSquad(
    player: PlayerState,
    x: number,
    y: number,
    template: SquadTemplate,
    ordinalLabel: string,
    offset: { x: number; y: number },
  ) {
    const squad = this.squadSystem.createClosedSquad({
      ownerPlayerId: player.id,
      unitType: template.memberUnitType,
      maxSize: template.targetSize,
      targetSize: template.targetSize,
      displayName: `${ordinalLabel} ${template.displayName.replace(/ Squad$/i, '')}`,
      templateId: template.id,
    });
    squad.formation = doctrineOf(player.factionId).defaultFormation;
    const offsets = orientOffsets(
      formationOffsets(squad.formation, template.targetSize, 28),
      0,
      1,
    );
    const musterX = x + offset.x;
    const musterY = y + offset.y;
    for (let i = 0; i < template.targetSize; i++) {
      const o = offsets[i] ?? { x: (i - 1.5) * 22, y: 0 };
      const unit = spawnUnitRegistered({
        player,
        unitType: template.memberUnitType,
        x: musterX + o.x,
        y: musterY + o.y,
        entities: this.entities,
        squads: this.squadSystem,
        options: unitSpawnOptions(template.memberUnitType),
        registerOpts: { preferSquadId: squad.id },
      });
      unit.facingX = 0;
      unit.facingY = 1;
    }
  }

  /** Two coherent starter tools: melee screen + ranged / support. */
  private spawnStarterArmy(player: PlayerState, base: { x: number; y: number }) {
    const melee = defaultMeleeSquadTemplate(player.factionId);
    const ranged = defaultRangedSquadTemplate(player.factionId);
    this.spawnStarterSquad(player, base.x, base.y, melee, '1st', { x: 50, y: 40 });
    this.spawnStarterSquad(player, base.x, base.y, ranged, '1st', { x: 28, y: 78 });
  }

  private spawnPlayers() {
    for (const player of this.match.allPlayers()) {
      const base = this.baseForPlayer(player);
      const faction = player.faction;

      this.entities.push(new Building(base.x, base.y, faction.mainBuilding, player));

      // Immediate pressure opening: two coherent starter squads (no Barracks wait).
      this.spawnStarterArmy(player, base);
    }

    for (const gold of this.gameMap.goldDeposits) {
      this.entities.push(new ResourceNode(gold.x, gold.y, 5000));
    }

    // Bind TCs → settlements and seed starting citizens (no Worker units).
    this.settlementSystem.update(
      0,
      this.entities,
      this.match,
      this.gameMap,
      this.simRng,
      this.influenceMap,
    );
    for (const player of this.match.allPlayers()) {
      const s = this.settlementSystem.get(player.id);
      if (!s) continue;
      const seed =
        player.controllerType === 'AI' ? CITY_PACING.aiStartPop : CITY_PACING.localStartPop;
      while (s.citizens.length < seed) {
        const i = s.citizens.length;
        s.citizens.push({
          id: `c-start-${player.id}-${i}`,
          age: 18 + (i * 5) % 25,
          profession:
            i % 5 === 0
              ? 'builder'
              : i % 3 === 0
                ? 'farmer'
                : i % 7 === 0
                  ? 'miner'
                  : 'peasant',
          settlementId: s.id,
          health: 0.9,
          experience: 5,
          traits: ['hardy'],
          prestige: 1,
          heroId: null,
        });
      }
      s.population = s.citizens.length;
      s.food = Math.max(s.food, CITY_PACING.startFood);
      s.wood = Math.max(s.wood, 140);
      s.stone = Math.max(s.stone, 85);
      // Faction Treasury — enough for early reinforcement, not spam.
      player.gold = Math.max(player.gold, 560);
      // Local settlement gold is independent — seed ~100, do not mirror treasury.
      s.gold = CITY_PACING.startLocalGold + Math.floor(this.simRng.range(0, 21));

      if (!player.capitalSettlementId) {
        player.capitalSettlementId = s.id;
      }

      this.seedStartingStructures(player, s.id);
    }

    // Reconcile counts after seeded houses/farm so housing/tier reflect living start.
    this.settlementSystem.update(
      0,
      this.entities,
      this.match,
      this.gameMap,
      this.simRng,
      this.influenceMap,
    );
  }

  /** Seed 3 Houses + 1 Farm (constructed) near the capital TC — housing for 2 starters + 1 recruit. */
  private seedStartingStructures(player: PlayerState, settlementId: string) {
    const base = this.baseForPlayer(player);
    const farmType = player.factionId === 'orcs' ? 'PigFarm' : 'Farm';
    const offsets: Array<{ x: number; y: number; type: BuildingType }> = [
      { x: 72, y: 28, type: 'House' },
      { x: -68, y: 36, type: 'House' },
      { x: -40, y: -70, type: 'House' },
      { x: 24, y: 78, type: farmType },
    ];
    for (const o of offsets) {
      const x = base.x + o.x;
      const y = base.y + o.y;
      const foot = footprintForBuildingType(o.type, player.factionId);
      if (!canPlaceBuildingAt(x, y, this.gameMap, this.entities, foot)) {
        // Fallback ring search
        let placed = false;
        for (let a = 0; a < 8 && !placed; a++) {
          const ang = (a / 8) * Math.PI * 2;
          const fx = base.x + Math.cos(ang) * 90;
          const fy = base.y + Math.sin(ang) * 70;
          if (canPlaceBuildingAt(fx, fy, this.gameMap, this.entities, foot)) {
            const b = new Building(fx, fy, o.type, player, true);
            b.settlementId = settlementId;
            this.entities.push(b);
            placed = true;
          }
        }
        if (!placed) continue;
      } else {
        const b = new Building(x, y, o.type, player, true);
        b.settlementId = settlementId;
        this.entities.push(b);
      }
    }
  }

  private unitOptions(type: string) {
    if (type === 'Swordsman' || type === 'Grunt') {
      return { hp: 100, speed: 60, unitType: type, damage: 15, range: 25 };
    }
    if (type === 'Archer' || type === 'SpearOrc') {
      return { hp: 60, speed: 60, unitType: type, damage: 10, range: 150 };
    }
    return { hp: 40, speed: 70, unitType: type, damage: 3, range: 25 };
  }

  private bindNewMapButton() {
    const btn = document.getElementById('new-map-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = Math.floor(Math.random() * 1_000_000_000);
      const url = new URL(window.location.href);
      url.searchParams.set('seed', String(next));
      window.location.href = url.toString();
    });
  }

  private territoryBtn: HTMLElement | null = null;

  private bindTerritoryButton() {
    this.territoryBtn = document.getElementById('territory-btn');
    if (!this.territoryBtn) return;
    this.territoryBtn.addEventListener('click', () => {
      this.influenceMap.overlayVisible = !this.influenceMap.overlayVisible;
      this.syncTerritoryButton();
    });
    this.syncTerritoryButton();
  }

  private bindSaveLoadButtons() {
    document.getElementById('save-btn')?.addEventListener('click', () => {
      this.saveGame();
    });
    document.getElementById('load-btn')?.addEventListener('click', () => {
      this.loadGame();
    });
    document.getElementById('export-replay-btn')?.addEventListener('click', () => {
      this.exportReplay();
    });
  }

  private bindSurrenderButton() {
    const btn = document.getElementById('surrender-btn');
    if (!btn) return;
    if (!this.pvpSession) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    btn.addEventListener('click', () => this.surrender());
  }

  private wirePvpSession() {
    if (!this.pvpSession) return;
    this.pvpUnsubs.push(
      this.pvpSession.onRemoteCommand((cmd) => this.submitRemoteCommand(cmd)),
    );
    this.pvpUnsubs.push(
      this.pvpSession.onPeerLeft(() => {
        if (this.gameState !== 'playing') return;
        for (const p of this.match.allPlayers()) {
          if (p.id !== this.match.localPlayerId) p.isDefeated = true;
        }
        this.gameState = 'victory';
      }),
    );
    this.pvpUnsubs.push(
      this.pvpSession.onRemoteHash((tick, hash) => {
        this.pvpRemoteHash = hash;
        this.pvpLastCompareTick = tick;
        if (tick === this.simTick || Math.abs(tick - this.simTick) <= 2) {
          const local = this.computeStateHash();
          this.lastStateHash = local;
          if (local !== hash) {
            const recent = this.replayRecorder.getCommands().slice(-12);
            console.error(
              `[DESYNC DETECTED]\ntick: ${tick}\nlocal: ${local}\nremote: ${hash}\nsimTick: ${this.simTick}`,
              recent,
            );
          }
        }
      }),
    );
    const mode = document.getElementById('pvp-mode-label');
    if (mode && this.pvpModeLabel) {
      mode.hidden = false;
      mode.textContent = this.pvpModeLabel;
    }
  }

  private maybeSendPvpHash() {
    if (!this.pvpSession) return;
    if (this.simTick % Game.PVP_HASH_INTERVAL !== 0) return;
    const hash = this.computeStateHash();
    this.lastStateHash = hash;
    this.pvpSession.sendHashSync(this.simTick, hash);
  }

  private collectDiagnostics() {
    const units = this.entities.filter((e) => e instanceof Unit && !e.isDead).length;
    let determinismStatus = 'skirmish';
    if (this.pvpSession) {
      if (
        this.pvpRemoteHash &&
        this.lastStateHash !== '—' &&
        this.pvpRemoteHash !== this.lastStateHash
      ) {
        determinismStatus = 'DESYNC';
      } else if (this.pvpRemoteHash) {
        determinismStatus = 'SYNCED';
      } else {
        determinismStatus = 'pvp-waiting';
      }
    }
    return {
      simTick: this.simTick,
      seed: this.seed,
      rngState: this.simRng.getState(),
      entityCount: this.entities.filter((e) => !e.isDead).length,
      unitCount: units,
      squadCount: this.squadSystem.all().length,
      settlementCount: this.settlementSystem.all().length,
      commandQueueLength: this.commandQueue.length,
      lastStateHash: this.lastStateHash === '—' ? this.computeStateHash() : this.lastStateHash,
      determinismStatus,
      pvpLocalHash: this.pvpSession ? this.lastStateHash : undefined,
      pvpRemoteHash: this.pvpRemoteHash ?? undefined,
      pvpLastCompareTick: this.pvpLastCompareTick ?? undefined,
    };
  }

  private processCommandQueue() {
    const batch = this.commandQueue.drainForTick(this.simTick);
    if (batch.length === 0) return;
    const world = {
      entities: this.entities,
      match: this.match,
      settlements: this.settlementSystem,
      squads: this.squadSystem,
      recruitment: this.recruitment,
      rng: this.simRng,
      gameMap: this.gameMap,
      artifacts: this.artifactSystem,
      influence: this.influenceMap,
      simTick: this.simTick,
    };
    const elapsed = this.match.matchElapsedSec;
    for (const cmd of batch) {
      const ok = applyCommand(cmd, world);
      this.replayRecorder.recordApplied(this.simTick, cmd);
      if (!ok) continue;
      if (cmd.playerId === this.match.localPlayerId) {
        if (cmd.type === 'moveSquad' || cmd.type === 'moveAgents') {
          this.orderMarker = {
            x: cmd.x,
            y: cmd.y,
            ttl: 0.85,
            kind: 'move',
          };
        } else if (cmd.type === 'attack') {
          const t = this.entities.find((e) => e.id === cmd.targetEntityId);
          if (t) {
            this.orderMarker = { x: t.x, y: t.y, ttl: 0.9, kind: 'attack' };
          }
        } else if (cmd.type === 'recruitSquad') {
          this.showBuildFeedback('Squad training started', 2);
        } else if (cmd.type === 'reinforceSquad') {
          this.showBuildFeedback('Reinforcements ordered', 2);
        }
      }
      if (
        cmd.type === 'moveSquad' ||
        cmd.type === 'moveAgents' ||
        cmd.type === 'attack' ||
        cmd.type === 'trainUnit' ||
        cmd.type === 'recruitSquad' ||
        cmd.type === 'reinforceSquad'
      ) {
        this.pacingDiag.noteArmyCommand(elapsed);
      }
      if (cmd.type === 'establishOutpost') {
        this.pacingDiag.noteOutpost(elapsed);
      }
      if (cmd.type === 'foundSettlement') {
        // Second city counted after founding resolves in updatePacingPeaks.
      }
    }
  }

  private syncTerritoryButton() {
    if (!this.territoryBtn) return;
    this.territoryBtn.classList.toggle('active', this.influenceMap.overlayVisible);
    this.territoryBtn.setAttribute('aria-pressed', String(this.influenceMap.overlayVisible));
  }

  private update(dt: number) {
    if (this.gameState !== 'playing') return;

    this.influenceMap.handleToggleInput(this.input.keys);
    this.syncTerritoryButton();
    this.camera.update(dt, this.input);
    const local = this.match.localPlayer;

    if (this.placementMode && this.input.mouseLeftPressed) {
      const worldPos = this.camera.screenToWorld(this.input.mousePos.x, this.input.mousePos.y);
      if (this.placementMode === 'foundSettlement') {
        const reason = placementBlockReason(worldPos.x, worldPos.y, this.gameMap, this.entities, 44);
        if (!reason) {
          this.submitCommand({
            type: 'foundSettlement',
            playerId: local.id,
            x: worldPos.x,
            y: worldPos.y,
            formGroupIfNeeded: true,
          });
          this.placementMode = null;
          this.showBuildFeedback('City expedition ordered');
        } else {
          this.showBuildFeedback(`Cannot found here: ${reason}`);
        }
      } else if (this.placementMode === 'establishOutpost') {
        const block = this.settlementSystem.establishOutpostBlockReason(
          local.id,
          worldPos.x,
          worldPos.y,
          this.entities,
          this.match,
          this.gameMap,
          this.influenceMap,
        );
        if (!block) {
          this.submitCommand({
            type: 'establishOutpost',
            playerId: local.id,
            x: worldPos.x,
            y: worldPos.y,
          });
          this.placementMode = null;
          this.showBuildFeedback('Outpost site placed — building (keep army nearby)');
        } else {
          this.showBuildFeedback(`Cannot place Outpost: ${block}`);
        }
      } else {
        const foot = footprintForBuildingType(this.placementMode, local.factionId);
        const reason = placementBlockReason(
          worldPos.x,
          worldPos.y,
          this.gameMap,
          this.entities,
          foot,
        );
        if (!reason) {
          const queued = this.placementMode;
          this.submitCommand({
            type: 'queueBuilding',
            playerId: local.id,
            buildingType: this.placementMode,
            x: worldPos.x,
            y: worldPos.y,
          });
          this.placementMode = null;
          this.showBuildFeedback(`Queued ${queued}`);
        } else {
          this.showBuildFeedback(`Cannot place: ${reason}`);
        }
      }
    }

    if (!this.placementMode) {
      this.selectionSystem.update(this.input, this.camera, this.entities, this.fog);
    } else if (this.input.mouseRightPressed) {
      this.placementMode = null;
      this.showBuildFeedback('Placement cancelled');
    }

    if (this.buildFeedbackTimer > 0) {
      this.buildFeedbackTimer = Math.max(0, this.buildFeedbackTimer - dt);
      if (this.buildFeedbackTimer <= 0) this.buildFeedback = null;
    }
    if (this.orderMarker) {
      this.orderMarker.ttl -= dt;
      if (this.orderMarker.ttl <= 0) this.orderMarker = null;
    }

    this.uiManager.update(this.selectionSystem.selectedEntities);
    this.input.resetFrameState();
  }

  /** @deprecated split into onFrame / onSimTick — kept name alias during migration */
  private onFrame(frameDt: number) {
    this.update(frameDt);
  }

  private onSimTick(dt: number) {
    if (this.gameState !== 'playing') return;

    this.simTick += 1;

    if (this.replayPlayer.isActive()) {
      for (const cmd of this.replayPlayer.commandsForTick(this.simTick)) {
        this.commandQueue.enqueue({ ...cmd, issuedAtTick: this.simTick });
      }
    }

    this.processCommandQueue();
    this.maybeSendPvpHash();

    const local = this.match.localPlayer;
    if (!this.replayPlayer.isActive()) {
      const ctx = {
        dt,
        entities: this.entities,
        gameMap: this.gameMap,
        match: this.match,
        settlements: this.settlementSystem,
        squads: this.squadSystem,
        influence: this.influenceMap,
        submitCommand: (cmd: GameCommand) => this.enqueueCommand(cmd),
        rng: this.simRng,
        simTick: this.simTick,
      };
      for (const controller of this.controllers) {
        controller.update(ctx);
      }
    }

    const aliveMains = new Set<string>();

    this.squadSystem.steerMarches(dt, {
      entities: this.entities,
      gameMap: this.gameMap,
      influence: this.influenceMap,
      match: this.match,
      rng: this.simRng,
    });

    for (const entity of this.entities) {
      entity.update(dt, this.entities, this.gameMap);

      if (
        entity instanceof Building &&
        !entity.isDead &&
        entity.ownerPlayerId &&
        isMainBuilding(entity.buildingType)
      ) {
        const owner = this.match.getPlayer(entity.ownerPlayerId);
        if (!owner) continue;
        // Capital victory: designated capital TC counts; fallback any main if unset.
        if (
          !owner.capitalSettlementId ||
          entity.settlementId === owner.capitalSettlementId
        ) {
          aliveMains.add(entity.ownerPlayerId);
        }
      }
    }

    this.settlementSystem.update(
      dt,
      this.entities,
      this.match,
      this.gameMap,
      this.simRng,
      this.influenceMap,
    );
    this.influenceMap.update(dt, this.settlementSystem.all(), this.match, this.entities);
    this.civilianVisuals.update(
      dt,
      this.settlementSystem.all(),
      this.entities,
      { x: this.camera.x, y: this.camera.y },
    );
    this.squadSystem.update(dt, {
      entities: this.entities,
      gameMap: this.gameMap,
      influence: this.influenceMap,
      match: this.match,
      rng: this.simRng,
    });
    this.recruitment.update(dt, {
      entities: this.entities,
      match: this.match,
      settlements: this.settlementSystem,
      squads: this.squadSystem,
      rng: this.simRng,
    });
    this.heroSystem.update(dt, this.entities, this.settlementSystem, this.match);
    this.artifactSystem.update(
      dt,
      this.entities,
      this.settlementSystem,
      this.match,
      this.heroSystem,
      this.simRng,
    );
    this.worldHistory.update(dt, this.settlementSystem, this.influenceMap, this.match, {
      x: this.gameMap.width * 0.5,
      y: this.gameMap.height * 0.5,
    });

    this.updateMatchPacing(dt);
    this.observeCombatPacing();

    applyCapitalDefeatFlags(this.match.allPlayers(), aliveMains);
    let outcome = resolveLocalMatchOutcome(local, this.match.opponentsOf(local.id));
    if (outcome === 'playing') {
      outcome = this.maybeSoftDominanceResolve();
    }
    if (outcome !== 'playing') this.gameState = outcome;

    this.resolveUnitCollisions();

    this.entities = this.entities.filter((e) => !e.isDead);
    this.selectionSystem.selectedEntities = this.selectionSystem.selectedEntities.filter(
      (e) => !e.isDead,
    );

    this.fog.update(this.entities, this.gameMap, this.match.localPlayerId, this.influenceMap);
  }

  private resolveUnitCollisions() {
    for (let i = 0; i < this.entities.length; i++) {
      const e1 = this.entities[i]!;
      if (!(e1 instanceof Unit) || e1.isDead) continue;

      // Unit–unit: only j > i so each pair is processed once.
      for (let j = i + 1; j < this.entities.length; j++) {
        const e2 = this.entities[j]!;
        if (!(e2 instanceof Unit) || e2.isDead) continue;

        const dx = e1.x - e2.x;
        const dy = e1.y - e2.y;
        const distSq = dx * dx + dy * dy;
        const sameOwner = e1.ownerPlayerId && e1.ownerPlayerId === e2.ownerPlayerId;
        const softScale = sameOwner ? 0.72 : 0.88;
        const minDist = (e1.radius + e2.radius) * softScale;
        if (distSq >= minDist * minDist) continue;
        // Coincident stack — deterministic angular nudge (was skipped forever).
        if (distSq <= 1e-6) {
          const a = ((e1.id * 17 + e2.id * 31) % 16) * (Math.PI / 8);
          const push = minDist * 0.35;
          this.trySlideUnit(e1, Math.cos(a) * push, Math.sin(a) * push);
          this.trySlideUnit(e2, -Math.cos(a) * push, -Math.sin(a) * push);
          continue;
        }
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        // Moving friendlies yield less — prefer traffic flow over rigid packing.
        const e1Moving = e1.targetX != null || e1.targetEntity != null || e1.followSquadMarch;
        const e2Moving = e2.targetX != null || e2.targetEntity != null || e2.followSquadMarch;
        let w1 = 0.5;
        let w2 = 0.5;
        if (sameOwner && e1Moving !== e2Moving) {
          w1 = e1Moving ? 0.25 : 0.75;
          w2 = 1 - w1;
        }
        const strength = sameOwner ? 0.55 : 1;
        this.trySlideUnit(e1, nx * overlap * w1 * strength, ny * overlap * w1 * strength);
        this.trySlideUnit(e2, -nx * overlap * w2 * strength, -ny * overlap * w2 * strength);
      }

      // Buildings are often spawned before units — must check all, not only j > i.
      for (const e2 of this.entities) {
        if (!(e2 instanceof Building) || e2.isDead) continue;
        if (e1.buildTarget === e2) continue;
        const dx = e1.x - e2.x;
        const dy = e1.y - e2.y;
        const distSq = dx * dx + dy * dy;
        const minDist = e1.radius * 0.55 + e2.radius * 0.92;
        if (distSq >= minDist * minDist) continue;
        const dist = Math.sqrt(distSq);
        const ang = dist > 0.01 ? Math.atan2(dy, dx) : (e1.id % 16) * 0.4;
        const target = minDist + 2;
        let placed = false;
        for (let k = 0; k < 8; k++) {
          const a = ang + (k * Math.PI) / 4;
          const tx = e2.x + Math.cos(a) * target;
          const ty = e2.y + Math.sin(a) * target;
          if (this.gameMap.isWalkable(tx, ty) && !this.hitsBuildingSolid(e1, tx, ty, e2)) {
            e1.x = tx;
            e1.y = ty;
            placed = true;
            break;
          }
        }
        if (!placed && dist > 0.01) {
          e1.x = e2.x + (dx / dist) * target;
          e1.y = e2.y + (dy / dist) * target;
        }
      }
    }
  }

  private trySlideUnit(unit: Unit, ox: number, oy: number) {
    const nx = unit.x + ox;
    const ny = unit.y + oy;
    if (this.gameMap.isWalkable(nx, ny) && !this.hitsBuildingSolid(unit, nx, ny)) {
      unit.x = nx;
      unit.y = ny;
      return;
    }
    if (this.gameMap.isWalkable(nx, unit.y) && !this.hitsBuildingSolid(unit, nx, unit.y)) {
      unit.x = nx;
      return;
    }
    if (this.gameMap.isWalkable(unit.x, ny) && !this.hitsBuildingSolid(unit, unit.x, ny)) {
      unit.y = ny;
    }
  }

  private hitsBuildingSolid(unit: Unit, x: number, y: number, ignore?: Building): boolean {
    for (const e of this.entities) {
      if (!(e instanceof Building) || e.isDead || e === ignore) continue;
      if (unit.buildTarget === e) continue;
      const r = unit.radius * 0.5 + e.radius * 0.85;
      if ((x - e.x) * (x - e.x) + (y - e.y) * (y - e.y) < r * r) return true;
    }
    return false;
  }

  private render() {
    this.renderer.clear();
    const ctx = this.renderer.ctx;
    ctx.save();

    this.gameMap.draw(ctx, this.camera);

    const drawList: { depth: number; draw: () => void }[] = [];
    for (const deco of this.gameMap.decorations) {
      if (!this.fog.knowsTerrainAt(deco.x, deco.y)) continue;
      drawList.push({
        depth: isoDepth(deco.x, deco.y),
        draw: () => this.gameMap.drawDecoration(ctx, deco, this.camera),
      });
    }
    for (const entity of this.entities) {
      if (!this.fog.canSeeEntity(entity)) continue;
      drawList.push({
        depth: isoDepth(entity.x, entity.y),
        draw: () => entity.draw(ctx, this.camera, this.gameMap),
      });
    }
    drawList.sort((a, b) => a.depth - b.depth);
    for (const item of drawList) item.draw();

    this.civilianVisuals.draw(ctx, this.camera);

    // Settler caravan markers (authoritative position, presentation only)
    for (const g of this.settlementSystem.exportSettlerGroups()) {
      if (g.status !== 'traveling' && g.status !== 'ready') continue;
      const screen = this.camera.worldToScreen(g.caravanX, g.caravanY);
      ctx.fillStyle = g.status === 'traveling' ? '#FFE082' : '#B0BEC5';
      ctx.beginPath();
      ctx.arc(screen.x, screen.y - 8, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFF8E1';
      ctx.font = '10px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(g.status === 'traveling' ? 'Caravan' : 'Settlers', screen.x, screen.y - 18);
    }

    this.fog.draw(ctx, this.camera);

    if (this.orderMarker && this.orderMarker.ttl > 0) {
      const m = this.orderMarker;
      const alpha = Math.min(1, m.ttl / 0.4);
      const screen = this.camera.worldToScreen(m.x, m.y);
      const color =
        m.kind === 'attack'
          ? `rgba(255, 82, 82, ${0.55 * alpha})`
          : `rgba(129, 212, 250, ${0.5 * alpha})`;
      drawIsoEllipse(ctx, screen.x, screen.y, 18 + (1 - alpha) * 10, undefined, color);
    }
    this.influenceMap.draw(ctx, this.camera);

    if (this.placementMode) {
      const worldPos = this.camera.screenToWorld(this.input.mousePos.x, this.input.mousePos.y);
      const screenPos = this.camera.worldToScreen(worldPos.x, worldPos.y);
      const foot =
        this.placementMode === 'foundSettlement'
          ? 44
          : this.placementMode === 'establishOutpost'
            ? footprintForBuildingType('Outpost', this.match.localPlayer.factionId)
            : footprintForBuildingType(this.placementMode, this.match.localPlayer.factionId);
      const block =
        this.placementMode === 'establishOutpost'
          ? this.settlementSystem.establishOutpostBlockReason(
              this.match.localPlayerId,
              worldPos.x,
              worldPos.y,
              this.entities,
              this.match,
              this.gameMap,
              this.influenceMap,
            )
          : placementBlockReason(worldPos.x, worldPos.y, this.gameMap, this.entities, foot);
      const valid = block === null;
      if (this.placementMode === 'foundSettlement') {
        ctx.globalAlpha = 0.5;
        drawIsoBox(ctx, screenPos.x, screenPos.y, 46, 22, {
          top: valid ? '#A5D6A7' : '#E57373',
          left: valid ? '#388E3C' : '#C62828',
          right: valid ? '#66BB6A' : '#EF5350',
        });
        ctx.globalAlpha = 1;
        ctx.fillStyle = valid ? '#C8E6C9' : '#FFCDD2';
        ctx.font = '12px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          valid ? 'Found City Here' : `Cannot found: ${block}`,
          screenPos.x,
          screenPos.y - 36,
        );
      } else if (this.placementMode === 'establishOutpost') {
        ctx.globalAlpha = 0.5;
        drawIsoBox(ctx, screenPos.x, screenPos.y, foot, 26, {
          top: valid ? '#90CAF9' : '#E57373',
          left: valid ? '#1565C0' : '#C62828',
          right: valid ? '#42A5F5' : '#EF5350',
        });
        ctx.globalAlpha = 1;
        ctx.fillStyle = valid ? '#BBDEFB' : '#FFCDD2';
        ctx.font = '12px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          valid ? 'Establish Outpost' : `Cannot place: ${block}`,
          screenPos.x,
          screenPos.y - 36,
        );
      } else {
        const radius = foot;
        const height =
          this.placementMode === 'Barracks' || this.placementMode === 'OrcBarracks' ? 38 : 18;
        ctx.globalAlpha = 0.55;
        drawIsoBox(ctx, screenPos.x, screenPos.y, radius, height, {
          top: valid ? '#81C784' : '#E57373',
          left: valid ? '#2E7D32' : '#C62828',
          right: valid ? '#43A047' : '#EF5350',
        });
        ctx.globalAlpha = 1;
        ctx.fillStyle = valid ? '#C8E6C9' : '#FFCDD2';
        ctx.font = '12px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          valid ? `Place ${this.placementMode}` : `Cannot place: ${block}`,
          screenPos.x,
          screenPos.y - 36,
        );
      }
    } else {
      this.selectionSystem.draw(ctx);
    }

    this.drawUI(ctx);

    if (this.gameState !== 'playing') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(0, 0, this.renderer.canvas.width, this.renderer.canvas.height);
      ctx.fillStyle = this.gameState === 'victory' ? '#4CAF50' : '#F44336';
      ctx.font = 'bold 80px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(
        this.gameState === 'victory' ? 'VICTORY' : 'DEFEAT',
        this.renderer.canvas.width / 2,
        this.renderer.canvas.height / 2,
      );
      ctx.font = '24px Arial';
      ctx.fillStyle = '#fff';
      ctx.fillText(
        'Refresh page to Play Again',
        this.renderer.canvas.width / 2,
        this.renderer.canvas.height / 2 + 50,
      );
    }

    ctx.restore();
  }

  private drawUI(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(20, 28, 18, 0.82)';
    ctx.fillRect(0, 0, this.renderer.canvas.width, 52);

    const local = this.match.localPlayer;
    const gold = local.gold;
    const pop = local.pop;
    const maxPop = local.maxPop;
    const treasuryRate = local.treasuryIncomeRate;
    const taxLabel = taxPolicyLabel(local.taxPolicy).toUpperCase();

    const goldIcon = assets.get('ui/gold');
    const popIcon = assets.get('ui/population');
    if (goldIcon) ctx.drawImage(goldIcon, 14, 6, 28, 28);
    if (popIcon) ctx.drawImage(popIcon, 210, 6, 28, 28);

    ctx.fillStyle = '#F4B51E';
    ctx.font = 'bold 16px Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Treasury ${Math.floor(gold)}`, goldIcon ? 46 : 20, 22);

    ctx.font = 'bold 11px Segoe UI, sans-serif';
    ctx.fillStyle = treasuryRate > 0.05 ? '#FFE082' : 'rgba(255, 224, 130, 0.45)';
    ctx.fillText(
      `+${treasuryRate.toFixed(1)}/s  Tax: ${taxLabel}`,
      goldIcon ? 46 : 20,
      40,
    );

    ctx.fillStyle = '#D7CFB7';
    ctx.font = 'bold 16px Segoe UI, sans-serif';
    ctx.fillText(`${pop}/${maxPop}`, popIcon ? 242 : 220, 28);
    ctx.font = '12px Segoe UI, sans-serif';

    const settlement = this.settlementSystem.get(local.id);
    if (settlement) {
      const need = settlement.topNeed(0.25);
      ctx.fillStyle = 'rgba(215, 207, 183, 0.85)';
      ctx.fillText(
        `Local G${Math.floor(settlement.gold)}(+${settlement.localIncomeRate.toFixed(1)})  ` +
          `W${Math.floor(settlement.wood)}(+${settlement.incomeRates.wood.toFixed(1)})  ` +
          `S${Math.floor(settlement.stone)}(+${settlement.incomeRates.stone.toFixed(1)})  ` +
          `Food ${Math.floor(settlement.food)}(+${settlement.incomeRates.food.toFixed(1)})  ` +
          `Tax→ +${settlement.taxContributionRate.toFixed(1)}/s`,
        320,
        20,
      );
      ctx.fillStyle = 'rgba(215, 207, 183, 0.65)';
      const aiPhase = this.aiControllers[0]?.getPhase();
      const aiReason = this.aiControllers[0]?.getStrategicReason?.();
      const opp = this.match.opponentsOf(local.id)[0];
      const phaseBit =
        aiPhase && opp
          ? `${opp.displayName}: ${aiPhase}${aiReason ? ` (${aiReason})` : ''}`
          : '';
      const seats = this.settlementSystem.allForOwner(local.id).length;
      const cap =
        local.capitalSettlementId &&
        this.settlementSystem.getById(local.capitalSettlementId)
          ? 'Capital'
          : TIER_DEFS[settlement.tier].label;
      ctx.fillText(
        `Citizens ${settlement.population}/${settlement.housing}  ` +
          `${cap} · ${TIER_DEFS[settlement.tier].label}  Safety ${Math.round(settlement.safety * 100)}%` +
          (need ? `  → ${need}` : '') +
          `  Outposts ${settlement.outpostCount}` +
          `  Cities:${seats}` +
          (phaseBit ? `   ${phaseBit}` : ''),
        320,
        38,
      );
    }

    // Player color swatch (distinct from faction accent)
    ctx.fillStyle = local.playerColor;
    ctx.fillRect(this.renderer.canvas.width - 36, 14, 22, 22);

    ctx.fillStyle = this.influenceMap.overlayVisible
      ? 'rgba(255, 220, 120, 0.9)'
      : 'rgba(215, 207, 183, 0.45)';
    ctx.font = '11px Segoe UI, sans-serif';
    ctx.textAlign = 'right';
    const tip = this.influenceMap.overlayVisible ? 'Territory ON (T)' : 'T: Territory';
    ctx.fillText(tip, this.renderer.canvas.width - 48, 28);

    if (this.influenceMap.overlayVisible) {
      const world = this.camera.screenToWorld(this.input.mousePos.x, this.input.mousePos.y);
      const ctrl = this.influenceMap.getControlAt(world.x, world.y);
      const h = this.influenceMap.getFactionInfluenceAt(world.x, world.y, 'humans');
      const o = this.influenceMap.getFactionInfluenceAt(world.x, world.y, 'orcs');
      const label =
        ctrl === 'none'
          ? 'Wilderness'
          : ctrl === 'contested'
            ? 'Contested'
            : ctrl === 'humans'
              ? 'Human territory'
              : 'Orc territory';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255, 245, 200, 0.85)';
      ctx.fillText(
        `${label}  H${Math.round(h)} O${Math.round(o)}`,
        14,
        this.renderer.canvas.height - 18,
      );
    }

    if (this.buildFeedback) {
      const msg = this.buildFeedback;
      ctx.font = 'bold 14px Segoe UI, sans-serif';
      const w = Math.min(this.renderer.canvas.width - 40, ctx.measureText(msg).width + 28);
      const x = (this.renderer.canvas.width - w) / 2;
      const y = 64;
      ctx.fillStyle = 'rgba(20, 18, 12, 0.88)';
      ctx.fillRect(x, y, w, 28);
      ctx.strokeStyle = 'rgba(255, 193, 7, 0.65)';
      ctx.strokeRect(x, y, w, 28);
      ctx.fillStyle = '#FFE082';
      ctx.textAlign = 'center';
      ctx.fillText(msg, this.renderer.canvas.width / 2, y + 19);
    }

    // Pacing diagnostics (always muted corner; richer with ?debug=1)
    ctx.textAlign = 'left';
    ctx.font = this.debugPacing ? '11px Segoe UI, sans-serif' : '10px Segoe UI, sans-serif';
    ctx.fillStyle = this.debugPacing
      ? 'rgba(200, 220, 180, 0.85)'
      : 'rgba(180, 190, 160, 0.45)';
    const paceY = this.renderer.canvas.height - (this.influenceMap.overlayVisible ? 36 : 14);
    ctx.fillText(this.pacingDiag.formatLine(), 14, paceY);
    if (this.match.dominancePhase) {
      ctx.fillStyle = 'rgba(255, 180, 80, 0.7)';
      ctx.fillText('Dominance phase', 14, paceY - 14);
    }
  }

  /** Center camera on an owned city seat. */
  public centerOnSettlement(settlementId: string): boolean {
    const s = this.settlementSystem.getById(settlementId);
    if (!s) return false;
    this.camera.centerOn(s.centerX, s.centerY);
    return true;
  }

  /** Compact cities list for HUD / overview panel. */
  public getOwnedCitiesOverview(): Array<{
    id: string;
    shortId: string;
    tier: string;
    focus: string;
    pop: number;
    underPressure: boolean;
    isCapital: boolean;
  }> {
    const local = this.match.localPlayer;
    return this.settlementSystem.allForOwner(local.id).map((s) => ({
      id: s.id,
      shortId: s.id.replace(/^s-/, '').slice(-8),
      tier: TIER_DEFS[s.tier].label,
      focus: s.focus,
      pop: s.population,
      underPressure: s.threatPressure > 0.35 || s.warShock > 0.2,
      isCapital: local.capitalSettlementId === s.id,
    }));
  }

  public getMatch(): MatchState {
    return this.match;
  }

  public getPacingDiagnostics(): MatchPacingDiagnostics {
    return this.pacingDiag;
  }

  private updateMatchPacing(dt: number) {
    this.match.matchElapsedSec += dt;
    if (this.match.matchElapsedSec >= MATCH_SOFT_CAP_SEC) {
      this.match.dominancePhase = true;
    }

    let totalCities = 0;
    for (const p of this.match.allPlayers()) {
      const n = this.settlementSystem.allForOwner(p.id).filter((s) => s.hasTownCenter).length;
      totalCities += n;
      const prev = this.seatCityPeaks.get(p.id) ?? 0;
      if (n >= 2 && prev < 2) {
        this.pacingDiag.noteSecondCity(this.match.matchElapsedSec);
      }
      this.seatCityPeaks.set(p.id, Math.max(prev, n));
    }
    this.pacingDiag.tick(
      this.match.matchElapsedSec,
      totalCities,
      this.squadSystem.all().length,
    );
  }

  private observeCombatPacing() {
    const elapsed = this.match.matchElapsedSec;
    const combat = this.entities.filter(
      (e): e is Unit => e instanceof Unit && !e.isDead && isCombatUnitType(e.unitType),
    );
    for (let i = 0; i < combat.length; i++) {
      const a = combat[i]!;
      for (let j = i + 1; j < combat.length; j++) {
        const b = combat[j]!;
        if (a.ownerPlayerId === b.ownerPlayerId) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 220) this.pacingDiag.noteContact(elapsed);
        if (d < 90 || a.targetEntity === b || b.targetEntity === a) {
          this.pacingDiag.noteBattle(elapsed);
        }
      }
    }
    for (const e of this.entities) {
      if (!(e instanceof Unit) || !e.isDead) continue;
      if (!isCombatUnitType(e.unitType)) continue;
      this.pacingDiag.noteBattle(elapsed);
    }
  }

  /**
   * Soft resolve after soft-cap + 90s — optional score win.
   * Capital destroy remains primary; this only fires if still playing.
   */
  private maybeSoftDominanceResolve(): 'playing' | 'victory' | 'defeat' {
    if (!this.match.dominancePhase) return 'playing';
    if (this.match.matchElapsedSec < MATCH_SOFT_CAP_SEC + MATCH_DOMINANCE_RESOLVE_SEC) {
      return 'playing';
    }
    const scores = this.match.allPlayers().map((p) => {
      const cities = this.settlementSystem.allForOwner(p.id).filter((s) => s.hasTownCenter)
        .length;
      const territory = this.influenceMap.estimateControlShares(p.factionId).ownShare;
      const army = this.entities.filter(
        (e) =>
          e instanceof Unit &&
          !e.isDead &&
          e.ownerPlayerId === p.id &&
          isCombatUnitType(e.unitType),
      ).length;
      return {
        player: p,
        score: strategicDominanceScore({ cityCount: cities, territoryShare: territory, armyCount: army }),
      };
    });
    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];
    const second = scores[1];
    if (!best || (second && best.score - second.score < 8)) return 'playing';
    for (const row of scores) {
      if (row.player.id !== best.player.id) row.player.isDefeated = true;
    }
    return resolveLocalMatchOutcome(
      this.match.localPlayer,
      this.match.opponentsOf(this.match.localPlayerId),
    );
  }

  /** Dev / UI access to local settlement simulation. */
  public getSettlement(playerId?: string) {
    return this.settlementSystem.get(playerId ?? this.match.localPlayerId);
  }

  public getSettlementSystem(): SettlementSystem {
    return this.settlementSystem;
  }

  /** One primary reason train draft would fail near a building. */
  public trainDraftBlockReason(nearX: number, nearY: number, count: number): string | null {
    return this.settlementSystem.draftBlockReason(
      this.match.localPlayerId,
      nearX,
      nearY,
      count,
    );
  }

  public getSettlementForBuilding(building: Building) {
    if (building.settlementId) {
      return this.settlementSystem.getById(building.settlementId);
    }
    return this.getSettlement(building.ownerPlayerId ?? undefined);
  }

  public getSquadSystem() {
    return this.squadSystem;
  }

  public getHeroSystem() {
    return this.heroSystem;
  }

  public getArtifactSystem() {
    return this.artifactSystem;
  }

  public getWorldHistory() {
    return this.worldHistory;
  }

  public getEventFeed() {
    return this.eventFeed;
  }

  /** Camera jump for Event Feed clicks — only if subject still exists. */
  public focusWorldEvent(event: WorldEvent) {
    const focus = this.worldHistory.resolveFocus(
      event,
      this.entities,
      this.settlementSystem,
    );
    if (!focus) return;
    this.camera.centerOn(focus.x, focus.y);
  }

  /** Bestow a vaulted artifact on the selected combat unit. */
  public transferArtifactToSelected(artifactId: string): boolean {
    const unit = this.selectionSystem.selectedEntities.find(
      (e): e is Unit => e instanceof Unit && !e.isDead,
    );
    if (!unit || unit.ownerPlayerId !== this.match.localPlayerId) return false;
    this.submitCommand({
      type: 'equipArtifact',
      playerId: this.match.localPlayerId,
      artifactId,
      unitId: unit.id,
    });
    return true;
  }

  public unequipSelectedArtifact(): boolean {
    const unit = this.selectionSystem.selectedEntities.find(
      (e): e is Unit => e instanceof Unit && !e.isDead && !!e.artifactId,
    );
    if (!unit || unit.ownerPlayerId !== this.match.localPlayerId) return false;
    this.submitCommand({
      type: 'unequipArtifact',
      playerId: this.match.localPlayerId,
      unitId: unit.id,
    });
    return true;
  }

  public setSquadFormation(squadId: string, formation: import('./Combat/FormationDefs').SquadFormation) {
    this.submitCommand({
      type: 'changeFormation',
      playerId: this.match.localPlayerId,
      squadId,
      formation,
    });
  }
}
