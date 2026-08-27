import { InputManager } from '../Engine/InputManager';
import { Camera } from '../Engine/Camera';
import { Entity } from '../Entities/Entity';
import { Unit } from '../Entities/Unit';
import { Building } from '../Entities/Building';
import { ResourceNode } from '../Entities/ResourceNode';
import { MatchState } from '../Players/MatchState';
import { isOwnedBy } from '../Players/Relations';
import type { FogOfWar } from './FogOfWar';
import type { SquadSystem } from '../Combat/SquadSystem';
import { isCombatUnitType } from '../Combat/Squad';
import type { GameCommand } from '../Sim/Commands';

export type CommandSink = (cmd: GameCommand) => void;

/**
 * Local selection & order *intent*. Combat orders become GameCommands —
 * this system does not mutate simulation state directly.
 * Economy workers / settler escorts are not army-selectable.
 */
export class SelectionSystem {
  private selectionBoxStart: { x: number; y: number } | null = null;
  private selectionBoxEnd: { x: number; y: number } | null = null;

  public selectedEntities: Entity[] = [];
  private squads: SquadSystem | null = null;
  private commandSink: CommandSink | null = null;

  public bindSquads(squads: SquadSystem) {
    this.squads = squads;
  }

  public bindCommandSink(sink: CommandSink) {
    this.commandSink = sink;
  }

  private isSelectableUnit(entity: Entity, localId: string): boolean {
    if (entity instanceof ResourceNode) return true;
    if (!isOwnedBy(entity, localId)) return false;
    if (!(entity instanceof Unit)) return true;
    if (entity.unitType === 'Worker' || entity.unitType === 'Peon') return false;
    if (entity.settlerGroupId) return false;
    return true;
  }

  public update(input: InputManager, camera: Camera, entities: Entity[], fog: FogOfWar) {
    const localId = MatchState.current?.localPlayerId;
    if (!localId) return;

    // Touch UX: one tap is contextual. Friendly selects, enemy attacks, empty ground moves.
    // Dragging is consumed by Camera as pan and never reaches this branch.
    if (input.touchTapPressed) {
      this.handleTouchTap(input, camera, entities, fog, localId);
      return;
    }

    if (input.mouseLeftPressed) {
      this.selectionBoxStart = { x: input.mousePos.x, y: input.mousePos.y };
      this.selectionBoxEnd = { x: input.mousePos.x, y: input.mousePos.y };
    }

    if (input.mouseLeftDown && this.selectionBoxStart) {
      this.selectionBoxEnd = { x: input.mousePos.x, y: input.mousePos.y };
    }

    if (!input.mouseLeftDown && this.selectionBoxStart && this.selectionBoxEnd) {
      const isShift = input.keys['ShiftLeft'] || input.keys['ShiftRight'];
      const micro = input.keys['ControlLeft'] || input.keys['ControlRight'];

      const minX = Math.min(this.selectionBoxStart.x, this.selectionBoxEnd.x);
      const maxX = Math.max(this.selectionBoxStart.x, this.selectionBoxEnd.x);
      const minY = Math.min(this.selectionBoxStart.y, this.selectionBoxEnd.y);
      const maxY = Math.max(this.selectionBoxStart.y, this.selectionBoxEnd.y);

      const boxWidth = maxX - minX;
      const boxHeight = maxY - minY;

      if (!isShift) {
        this.selectedEntities.forEach((e) => (e.selected = false));
        this.selectedEntities = [];
      }

      if (boxWidth < 5 && boxHeight < 5) {
        const worldPos = camera.screenToWorld(this.selectionBoxStart.x, this.selectionBoxStart.y);
        for (const entity of entities) {
          if (!this.isSelectableUnit(entity, localId)) continue;
          const dx = entity.x - worldPos.x;
          const dy = entity.y - worldPos.y;
          if (dx * dx + dy * dy <= entity.selectionRadius * entity.selectionRadius) {
            entity.selected = true;
            this.selectedEntities.push(entity);
            break;
          }
        }
      } else {
        for (const entity of entities) {
          if (!this.isSelectableUnit(entity, localId)) continue;
          const screenPos = camera.worldToScreen(entity.x, entity.y);
          if (
            screenPos.x >= minX &&
            screenPos.x <= maxX &&
            screenPos.y >= minY &&
            screenPos.y <= maxY
          ) {
            if (!entity.selected) {
              entity.selected = true;
              this.selectedEntities.push(entity);
            }
          }
        }
      }

      if (this.squads && !micro) {
        this.selectedEntities = this.squads.expandSelectionToSquads(
          this.selectedEntities,
          entities,
        );
      }

      this.selectionBoxStart = null;
      this.selectionBoxEnd = null;
    }

    if (input.mouseRightPressed) {
      const worldPos = camera.screenToWorld(input.mousePos.x, input.mousePos.y);

      let clickedEnemy: Entity | null = null;
      let clickedResource: ResourceNode | null = null;
      let clickedBuilding: Building | null = null;

      for (const entity of entities) {
        if (entity.isDead || !fog.canTargetEntity(entity)) continue;
        const dx = entity.x - worldPos.x;
        const dy = entity.y - worldPos.y;
        if (dx * dx + dy * dy > entity.selectionRadius * entity.selectionRadius * 4) continue;

        if (entity instanceof ResourceNode) {
          clickedResource = entity;
          break;
        }
        if (entity.ownerPlayerId !== null && entity.ownerPlayerId !== localId) {
          clickedEnemy = entity;
          break;
        }
        if (
          entity instanceof Building &&
          isOwnedBy(entity, localId) &&
          entity.isConstructed === false
        ) {
          clickedBuilding = entity;
          break;
        }
      }

      this.issueOrderCommands(localId, worldPos, clickedEnemy, clickedResource, clickedBuilding);
    }
  }

  private handleTouchTap(
    input: InputManager,
    camera: Camera,
    entities: Entity[],
    fog: FogOfWar,
    localId: string,
  ) {
    const worldPos = camera.screenToWorld(input.mousePos.x, input.mousePos.y);
    let friendly: Entity | null = null;
    let resource: ResourceNode | null = null;
    let enemy: Entity | null = null;
    let friendlyDist = Number.POSITIVE_INFINITY;
    let enemyDist = Number.POSITIVE_INFINITY;

    // Touch hit boxes are intentionally forgiving. Prefer owned objects over enemies
    // when silhouettes overlap so selection remains predictable on a small screen.
    for (const entity of entities) {
      if (entity.isDead || !fog.knowsTerrainAt(entity.x, entity.y)) continue;
      const dx = entity.x - worldPos.x;
      const dy = entity.y - worldPos.y;
      const distSq = dx * dx + dy * dy;
      const touchRadius = Math.max(entity.selectionRadius * 1.7, 22);
      if (distSq > touchRadius * touchRadius) continue;

      if (entity instanceof ResourceNode) {
        if (!resource) resource = entity;
        continue;
      }
      if (this.isSelectableUnit(entity, localId)) {
        if (distSq < friendlyDist) {
          friendlyDist = distSq;
          friendly = entity;
        }
        continue;
      }
      if (
        entity.ownerPlayerId !== null &&
        entity.ownerPlayerId !== localId &&
        fog.canTargetEntity(entity) &&
        distSq < enemyDist
      ) {
        enemyDist = distSq;
        enemy = entity;
      }
    }

    if (friendly) {
      this.replaceSelection([friendly], entities);
      return;
    }

    // With an army selected, battlefield taps are commands rather than deselection.
    if (this.selectedEntities.length > 0) {
      this.issueOrderCommands(localId, worldPos, enemy, null, null);
      return;
    }

    // Neutral resources remain inspectable when there is no current command context.
    if (resource) {
      this.replaceSelection([resource], entities);
      return;
    }

    this.replaceSelection([], entities);
  }

  private replaceSelection(next: Entity[], entities: Entity[]) {
    for (const entity of this.selectedEntities) entity.selected = false;
    this.selectedEntities = [];
    for (const entity of next) {
      entity.selected = true;
      this.selectedEntities.push(entity);
    }
    if (this.squads && next.some((entity) => entity instanceof Unit)) {
      this.selectedEntities = this.squads.expandSelectionToSquads(this.selectedEntities, entities);
    }
  }

  private issueOrderCommands(
    playerId: string,
    worldPos: { x: number; y: number },
    clickedEnemy: Entity | null,
    clickedResource: ResourceNode | null,
    clickedBuilding: Building | null,
  ) {
    if (!this.commandSink) return;

    const selectedSquads = this.squads?.squadsFromSelection(this.selectedEntities) ?? [];
    const orderedSquadIds = new Set(selectedSquads.map((s) => s.id));

    if (selectedSquads.length > 0 && !clickedBuilding) {
      for (const squad of selectedSquads) {
        if (clickedEnemy) {
          this.commandSink({
            type: 'attack',
            playerId,
            squadId: squad.id,
            targetEntityId: clickedEnemy.id,
          });
        } else if (!clickedResource) {
          this.commandSink({
            type: 'moveSquad',
            playerId,
            squadId: squad.id,
            x: worldPos.x,
            y: worldPos.y,
          });
        }
      }
    }

    const agentIds: number[] = [];
    for (const entity of this.selectedEntities) {
      if (!(entity instanceof Unit)) continue;
      if (entity.unitType === 'Worker' || entity.unitType === 'Peon') continue;
      if (
        entity.squadId &&
        orderedSquadIds.has(entity.squadId) &&
        !clickedBuilding &&
        !clickedResource
      ) {
        continue;
      }
      agentIds.push(entity.id);
    }

    if (agentIds.length === 0) return;

    // Economy gather / assistBuild retired — combat / move only.
    if (clickedBuilding || clickedResource) return;

    if (clickedEnemy) {
      this.commandSink({
        type: 'attack',
        playerId,
        unitIds: agentIds,
        targetEntityId: clickedEnemy.id,
      });
    } else {
      const movers = agentIds.filter((id) => {
        const e = this.selectedEntities.find((x) => x.id === id);
        return (
          e instanceof Unit &&
          (!isCombatUnitType(e.unitType) || !e.squadId || !orderedSquadIds.has(e.squadId))
        );
      });
      if (movers.length > 0) {
        this.commandSink({
          type: 'moveAgents',
          playerId,
          unitIds: movers,
          x: worldPos.x,
          y: worldPos.y,
        });
      }
    }
  }

  public draw(ctx: CanvasRenderingContext2D) {
    if (this.selectionBoxStart && this.selectionBoxEnd) {
      const minX = Math.min(this.selectionBoxStart.x, this.selectionBoxEnd.x);
      const maxX = Math.max(this.selectionBoxStart.x, this.selectionBoxEnd.x);
      const minY = Math.min(this.selectionBoxStart.y, this.selectionBoxEnd.y);
      const maxY = Math.max(this.selectionBoxStart.y, this.selectionBoxEnd.y);

      const color = MatchState.current?.localPlayer.playerColor ?? '#4FC3F7';
      ctx.strokeStyle = color;
      ctx.fillStyle = color + '33';
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.rect(minX, minY, maxX - minX, maxY - minY);
      ctx.fill();
      ctx.stroke();
    }
  }
}
