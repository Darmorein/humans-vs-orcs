import { GameLoop } from './Engine/GameLoop';
import { Renderer } from './Engine/Renderer';
import { Camera } from './Engine/Camera';
import { InputManager } from './Engine/InputManager';
import { GameMap } from './Map/GameMap';
import { MapGenerator } from './Map/MapGenerator';
import { canPlaceBuildingAt, footprintForBuildingType } from './Map/BuildPlacement';
import { Entity } from './Entities/Entity';
import { Unit } from './Entities/Unit';
import { Building, isMainBuilding } from './Entities/Building';
import type { BuildingType } from './Entities/Building';
import { ResourceNode } from './Entities/ResourceNode';
import { SelectionSystem } from './Systems/SelectionSystem';
import { UIManager } from './UI/UIManager';
import { FogOfWar } from './Systems/FogOfWar';
import { drawIsoBox, isoDepth } from './Engine/Iso';
import { assets } from './Assets/Assets';
import { createDefaultMatch, createPvpMatch, MatchState, type PlayerState } from './Players/MatchState';
import type { PlayerController } from './Players/PlayerController';
import { LocalPlayerController } from './Players/LocalPlayerController';
import { AIPlayerController } from './Players/AIPlayerController';
import { RemotePlayerController } from './Players/RemotePlayerController';
import type { FactionId } from './Players/Types';
import { SettlementSystem } from './Settlement/SettlementSystem';
import { populationSim, PopulationSim } from './Settlement/Population/PopulationSim';
import { TIER_DEFS } from './Settlement/SettlementTier';
import { InfluenceMap } from './Map/InfluenceMap';
import { SquadSystem } from './Combat/SquadSystem';
import { HeroSystem } from './Heroes';
import { ArtifactSystem } from './Artifacts';
import { WorldHistory, EventFeed } from './WorldHistory';
import type { WorldEvent } from './WorldHistory';
import {
  CommandQueue,
  GameRng,
  ReplayRecorder,
  SIM_TICK_DT,
  applyCommand,
  buildSaveGame,
  clearPendingLoadSlot,
  downloadJson,
  hydrateFromSnapshot,
  markPendingLoad,
  readSaveFromStorage,
  serializeGameState,
  writeSaveToStorage,
  DEFAULT_SAVE_SLOT,
  type GameCommand,
  type GameStateSnapshot,
  type SaveGame,
} from './Sim';
import { PVP_COMMAND_DELAY_TICKS, type PvpSession } from './Net';

/** Boot options for skirmish or synchronized PvP 1v1. */
export interface GameOptions {
  seed?: number;
  /** Skirmish: local faction (opponent = other, AI). */
  localFaction?: FactionId;
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
  private squadSystem: SquadSystem;
  private heroSystem: HeroSystem;
  private artifactSystem: ArtifactSystem;
  private worldHistory: WorldHistory;
  private eventFeed!: EventFeed;

  private readonly commandQueue = new CommandQueue();
  private readonly simRng: GameRng;
  /** Applied player commands for future replay (seed + this log). */
  private readonly replayRecorder = new ReplayRecorder();
  /** Monotonic simulation tick (fixed step). */
  private simTick = 0;

  private placementMode: BuildingType | 'foundSettlement' | null = null;
  private gameState: 'playing' | 'victory' | 'defeat' = 'playing';

  private pvpSession: PvpSession | null = null;
  private pvpUnsubs: Array<() => void> = [];
  private pvpModeLabel: string | null = null;

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
      });
    }
    this.controllers = this.buildControllers(this.match);

    Unit.onUnitKilled = (victim, killer) => {
      this.squadSystem.notifyKill(killer);
      if (killer instanceof Unit) this.heroSystem.noteKill(killer, victim);
      if (victim.isHero || victim.heroId) this.heroSystem.noteHeroFallen(victim, killer);
      if (victim.artifactId) this.artifactSystem.noteCarrierKilled(victim, killer);
      this.worldHistory.noteCombatDeath(victim, killer);
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
  }

  /**
   * Local UI / selection enqueue intents. Does not mutate the world immediately.
   * In PvP, also relays to the peer with a short delay buffer.
   */
  public submitCommand(cmd: GameCommand): void {
    if (this.gameState !== 'playing') return;
    if (cmd.playerId !== this.match.localPlayerId) return;

    const delay = this.pvpSession ? PVP_COMMAND_DELAY_TICKS : 0;
    const stamped: GameCommand = {
      ...cmd,
      issuedAtTick: this.simTick + delay,
    };
    this.commandQueue.enqueue(stamped);
    if (this.pvpSession) {
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
      simTick: this.simTick,
      rng: this.simRng,
      match: this.match,
      entities: this.entities,
      settlements: this.settlementSystem,
      pendingCommands: this.commandQueue.snapshotPending(),
    });
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
    this.commandQueue.drain();
    this.selectionSystem.selectedEntities = [];

    hydrateFromSnapshot(save.snapshot, {
      entities: this.entities,
      match: this.match,
      settlements: this.settlementSystem,
      squads: this.squadSystem,
      rng: this.simRng,
      setSimTick: (t) => {
        this.simTick = t;
      },
      unitOptions: (type) => this.unitOptions(type),
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
    this.fog.update(this.entities, this.gameMap, this.match.localPlayerId);
    console.info(
      `[Load] tick=${this.simTick} entities=${this.entities.length} cmdsLogged=${save.replay.commands.length}`,
    );
  }

  /** Download ReplayManifest JSON (seed + player commands). */
  public exportReplay(): void {
    const manifest = this.replayRecorder.toManifest(this.seed);
    downloadJson(`hvo-replay-seed${this.seed}-t${this.simTick}.json`, manifest);
  }

  /** Placement preview only — world change happens via GameCommand on confirm. */
  public startBuildingPlacement(type: BuildingType) {
    if (this.gameState !== 'playing') return;
    this.placementMode = type;
  }

  public startFoundSettlementPlacement() {
    if (this.gameState !== 'playing') return;
    const local = this.match.localPlayer;
    const group = this.settlementSystem.getSettlerGroup(local.id);
    if (!group && !this.settlementSystem.canFormSettlerGroup(local.id, local.factionId)) return;
    this.placementMode = 'foundSettlement';
  }

  public formSettlerGroup(): boolean {
    if (this.gameState !== 'playing') return false;
    if (!this.canFormSettlerGroup()) return false;
    this.submitCommand({
      type: 'formSettlerGroup',
      playerId: this.match.localPlayerId,
    });
    return true;
  }

  public canFormSettlerGroup(): boolean {
    const local = this.match.localPlayer;
    return this.settlementSystem.canFormSettlerGroup(local.id, local.factionId);
  }

  public hasReadySettlerGroup(): boolean {
    const g = this.settlementSystem.getSettlerGroup(this.match.localPlayerId);
    return !!g && g.status === 'ready';
  }

  public queueStrategic(type: BuildingType, at?: { x: number; y: number }) {
    this.submitCommand({
      type: 'queueBuilding',
      playerId: this.match.localPlayerId,
      buildingType: type,
      x: at?.x,
      y: at?.y,
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

  public trainUnit(building: Building, type: string, cost: number) {
    this.submitCommand({
      type: 'trainUnit',
      playerId: this.match.localPlayerId,
      buildingId: building.id,
      unitType: type,
      cost,
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
    // Seat → fair start slot (map labels are historical; not tied to faction look).
    return player.id === 'player-1' ? this.gameMap.humanBase : this.gameMap.orcBase;
  }

  private seatIndex(player: PlayerState): 0 | 1 {
    return player.id === 'player-1' ? 0 : 1;
  }

  private spawnPlayers() {
    for (const player of this.match.allPlayers()) {
      const base = this.baseForPlayer(player);
      const faction = player.faction;
      const seat = this.seatIndex(player);

      this.entities.push(new Building(base.x, base.y, faction.mainBuilding, player));

      const workerCount = player.controllerType === 'AI' ? 4 : 3;
      for (let i = 0; i < workerCount; i++) {
        const ox = seat === 0 ? 40 + i * 28 : -50 + i * 28;
        this.entities.push(
          new Unit(base.x + ox, base.y + 30, player, {
            hp: 40,
            speed: 70,
            unitType: faction.workerType,
            damage: 3,
            range: 25,
          }),
        );
      }

      if (player.controllerType === 'AI') {
        const grunt = new Unit(base.x + 55, base.y + 40, player, {
          hp: 130,
          speed: 52,
          unitType: faction.meleeType,
          damage: 18,
          range: 28,
        });
        const ranged = new Unit(base.x + 80, base.y + 20, player, {
          hp: 80,
          speed: 56,
          unitType: faction.rangedType,
          damage: 11,
          range: 120,
        });
        this.entities.push(grunt, ranged);
        this.squadSystem.registerUnit(grunt);
        this.squadSystem.registerUnit(ranged);
      }
    }

    for (const gold of this.gameMap.goldDeposits) {
      this.entities.push(new ResourceNode(gold.x, gold.y, 5000));
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
    const mode = document.getElementById('pvp-mode-label');
    if (mode && this.pvpModeLabel) {
      mode.hidden = false;
      mode.textContent = this.pvpModeLabel;
    }
  }

  private processCommandQueue() {
    const batch = this.commandQueue.drainForTick(this.simTick);
    if (batch.length === 0) return;
    const world = {
      entities: this.entities,
      match: this.match,
      settlements: this.settlementSystem,
      squads: this.squadSystem,
      rng: this.simRng,
      canBuildAt: (x: number, y: number) =>
        canPlaceBuildingAt(
          x,
          y,
          this.gameMap,
          this.entities,
          this.placementMode && this.placementMode !== 'foundSettlement'
            ? footprintForBuildingType(this.placementMode, this.match.localPlayer.factionId)
            : 40,
        ),
      unitOptions: (type: string) => this.unitOptions(type),
    };
    for (const cmd of batch) {
      applyCommand(cmd, world);
      this.replayRecorder.recordApplied(this.simTick, cmd);
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
        if (this.canPlaceAt(worldPos.x, worldPos.y, 44)) {
          this.submitCommand({
            type: 'foundSettlement',
            playerId: local.id,
            x: worldPos.x,
            y: worldPos.y,
            formGroupIfNeeded: true,
          });
          this.placementMode = null;
        }
      } else if (
        this.canPlaceAt(
          worldPos.x,
          worldPos.y,
          footprintForBuildingType(this.placementMode, local.factionId),
        )
      ) {
        this.submitCommand({
          type: 'queueBuilding',
          playerId: local.id,
          buildingType: this.placementMode,
          x: worldPos.x,
          y: worldPos.y,
        });
        this.placementMode = null;
      }
    }

    if (!this.placementMode) {
      this.selectionSystem.update(this.input, this.camera, this.entities, this.fog);
    } else if (this.input.mouseRightPressed) {
      this.placementMode = null;
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
    this.processCommandQueue();

    const local = this.match.localPlayer;
    const ctx = {
      dt,
      entities: this.entities,
      gameMap: this.gameMap,
      match: this.match,
      settlements: this.settlementSystem,
      squads: this.squadSystem,
      influence: this.influenceMap,
    };
    for (const controller of this.controllers) {
      controller.update(ctx);
    }

    const aliveMains = new Set<string>();

    for (const entity of this.entities) {
      entity.update(dt, this.entities, this.gameMap);

      if (
        entity instanceof Building &&
        !entity.isDead &&
        entity.ownerPlayerId &&
        isMainBuilding(entity.buildingType)
      ) {
        aliveMains.add(entity.ownerPlayerId);
      }
    }

    this.settlementSystem.update(dt, this.entities, this.match, this.gameMap);
    this.influenceMap.update(dt, this.settlementSystem.all(), this.match);
    this.squadSystem.update(dt, {
      entities: this.entities,
      gameMap: this.gameMap,
      influence: this.influenceMap,
      match: this.match,
    });
    this.heroSystem.update(dt, this.entities, this.settlementSystem, this.match);
    this.artifactSystem.update(
      dt,
      this.entities,
      this.settlementSystem,
      this.match,
      this.heroSystem,
    );
    this.worldHistory.update(dt, this.settlementSystem, this.influenceMap, this.match, {
      x: this.gameMap.width * 0.5,
      y: this.gameMap.height * 0.5,
    });

    for (const player of this.match.allPlayers()) {
      if (!aliveMains.has(player.id)) player.isDefeated = true;
    }

    if (local.isDefeated) this.gameState = 'defeat';
    else if (this.match.opponentsOf(local.id).every((p) => p.isDefeated)) {
      this.gameState = 'victory';
    }

    this.resolveUnitCollisions();

    this.entities = this.entities.filter((e) => !e.isDead);
    this.selectionSystem.selectedEntities = this.selectionSystem.selectedEntities.filter(
      (e) => !e.isDead,
    );

    this.fog.update(this.entities, this.gameMap, this.match.localPlayerId);
  }

  private canPlaceAt(x: number, y: number, footprint = 36): boolean {
    return canPlaceBuildingAt(x, y, this.gameMap, this.entities, footprint);
  }

  private resolveUnitCollisions() {
    for (let i = 0; i < this.entities.length; i++) {
      const e1 = this.entities[i]!;
      if (!(e1 instanceof Unit) || e1.isDead) continue;

      for (let j = i + 1; j < this.entities.length; j++) {
        const e2 = this.entities[j]!;
        if (e2.isDead) continue;

        const dx = e1.x - e2.x;
        const dy = e1.y - e2.y;
        const distSq = dx * dx + dy * dy;

        if (e2 instanceof Unit) {
          const minDist = (e1.radius + e2.radius) * 0.88;
          if (distSq >= minDist * minDist || distSq <= 0) continue;
          const dist = Math.sqrt(distSq);
          const overlap = minDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;
          this.trySlideUnit(e1, nx * overlap * 0.5, ny * overlap * 0.5);
          this.trySlideUnit(e2, -nx * overlap * 0.5, -ny * overlap * 0.5);
          continue;
        }

        if (e2 instanceof Building) {
          if (e1.buildTarget === e2) continue;
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
      if (!this.fog.isExploredAt(deco.x, deco.y)) continue;
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

    this.fog.draw(ctx, this.camera);
    this.influenceMap.draw(ctx, this.camera);

    if (this.placementMode) {
      const worldPos = this.camera.screenToWorld(this.input.mousePos.x, this.input.mousePos.y);
      const screenPos = this.camera.worldToScreen(worldPos.x, worldPos.y);
      const foot =
        this.placementMode === 'foundSettlement'
          ? 44
          : footprintForBuildingType(this.placementMode, this.match.localPlayer.factionId);
      const valid = this.canPlaceAt(worldPos.x, worldPos.y, foot);
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
        ctx.fillText('Found Settlement Here', screenPos.x, screenPos.y - 36);
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

    const goldIcon = assets.get('ui/gold');
    const popIcon = assets.get('ui/population');
    if (goldIcon) ctx.drawImage(goldIcon, 14, 6, 28, 28);
    if (popIcon) ctx.drawImage(popIcon, 150, 6, 28, 28);

    ctx.fillStyle = '#F4B51E';
    ctx.font = 'bold 16px Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(gold), goldIcon ? 46 : 20, 28);
    ctx.fillStyle = '#D7CFB7';
    ctx.fillText(`${pop}/${maxPop}`, popIcon ? 182 : 160, 28);
    ctx.font = '12px Segoe UI, sans-serif';

    const settlement = this.settlementSystem.get(local.id);
    if (settlement) {
      const need = settlement.topNeed(0.25);
      const byProf = populationSim.countByProfession(settlement);
      ctx.fillStyle = 'rgba(215, 207, 183, 0.75)';
      ctx.fillText(
        `Citizens ${settlement.population}/${settlement.housing}  Food ${Math.floor(settlement.food)}  ` +
          `${TIER_DEFS[settlement.tier].label}  Safety ${Math.round(settlement.safety * 100)}%` +
          (need ? `  → ${need}` : ''),
        280,
        20,
      );
      ctx.fillStyle = 'rgba(215, 207, 183, 0.5)';
      const aiPhase = this.aiControllers[0]?.getPhase();
      const aiReason = this.aiControllers[0]?.getStrategicReason?.();
      const opp = this.match.opponentsOf(local.id)[0];
      const phaseBit =
        aiPhase && opp
          ? `${opp.displayName}: ${aiPhase}${aiReason ? ` (${aiReason})` : ''}`
          : '';
      const seats = this.settlementSystem.allForOwner(local.id).length;
      ctx.fillText(
        `H${settlement.houseCount} F${settlement.farmCount} S${settlement.storageCount}` +
          `  Farm${byProf.farmer} Build${byProf.builder} Sold${byProf.soldier}` +
          `  seats:${seats} atr${Math.round(settlement.migrationAttraction * 100)}` +
          `  [${settlement.layout.id}]` +
          (phaseBit ? `   ${phaseBit}` : ''),
        280,
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
  }

  /** Dev / UI access to local settlement simulation. */
  public getSettlement(playerId?: string) {
    return this.settlementSystem.get(playerId ?? this.match.localPlayerId);
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
    return this.artifactSystem.transferToUnit(artifactId, unit);
  }

  public unequipSelectedArtifact(): boolean {
    const unit = this.selectionSystem.selectedEntities.find(
      (e): e is Unit => e instanceof Unit && !e.isDead && !!e.artifactId,
    );
    if (!unit || unit.ownerPlayerId !== this.match.localPlayerId) return false;
    this.artifactSystem.unequipFromUnit(unit, this.settlementSystem);
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
