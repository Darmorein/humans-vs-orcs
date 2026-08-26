import type { ConstructionCategory, ConstructionTarget } from './ConstructionCatalog';
import { getRecipe } from './ConstructionCatalog';

export type ProjectStatus = 'queued' | 'building' | 'done' | 'cancelled';

export interface ConstructionProject {
  id: string;
  category: ConstructionCategory;
  target: ConstructionTarget;
  status: ProjectStatus;
  /** Materials already deducted when construction physically started. */
  materialsSpent: boolean;
  /** Entity id of the under-construction building (null for Road). */
  buildingId: number | null;
  plannedX: number | null;
  plannedY: number | null;
  /** Road tile work progress. */
  roadTiles: { tx: number; ty: number }[];
  roadIndex: number;
}

let nextProjectId = 1;

export function getNextProjectId(): number {
  return nextProjectId;
}
export function setNextProjectId(n: number) {
  nextProjectId = Math.max(1, Math.floor(n));
}

/**
 * Ordered construction queue for one settlement.
 * Player may enqueue strategic projects, reorder, and cancel.
 */
export class ConstructionQueue {
  private items: ConstructionProject[] = [];

  public list(): readonly ConstructionProject[] {
    return this.items;
  }

  public active(): ConstructionProject | undefined {
    return this.items.find((p) => p.status === 'building');
  }

  public nextQueued(): ConstructionProject | undefined {
    return this.items.find((p) => p.status === 'queued');
  }

  public get(id: string): ConstructionProject | undefined {
    return this.items.find((p) => p.id === id);
  }

  public enqueue(
    target: ConstructionTarget,
    category: ConstructionCategory,
    planned?: { x: number; y: number },
  ): ConstructionProject | null {
    const recipe = getRecipe(target);
    if (!recipe || recipe.category !== category) return null;
    // Avoid duplicate queued autonomous of same target
    if (
      category === 'autonomous' &&
      this.items.some((p) => p.status === 'queued' && p.target === target)
    ) {
      return null;
    }

    const project: ConstructionProject = {
      id: `cq-${nextProjectId++}`,
      category,
      target,
      status: 'queued',
      materialsSpent: false,
      buildingId: null,
      plannedX: planned?.x ?? null,
      plannedY: planned?.y ?? null,
      roadTiles: [],
      roadIndex: 0,
    };
    this.items.push(project);
    return project;
  }

  public cancel(id: string): boolean {
    const p = this.get(id);
    if (!p || p.status === 'done' || p.status === 'cancelled') return false;
    p.status = 'cancelled';
    this.prune();
    return true;
  }

  public move(id: string, direction: -1 | 1): boolean {
    const i = this.items.findIndex((p) => p.id === id);
    if (i < 0) return false;
    const p = this.items[i]!;
    if (p.status !== 'queued') return false;
    const j = i + direction;
    if (j < 0 || j >= this.items.length) return false;
    const other = this.items[j]!;
    if (other.status !== 'queued') return false;
    this.items[i] = other;
    this.items[j] = p;
    return true;
  }

  public markBuilding(id: string, buildingId: number | null) {
    const p = this.get(id);
    if (!p) return;
    p.status = 'building';
    p.buildingId = buildingId;
    p.materialsSpent = true;
  }

  public markDone(id: string) {
    const p = this.get(id);
    if (!p) return;
    p.status = 'done';
    this.prune();
  }

  public hasQueuedOrBuilding(target: ConstructionTarget): boolean {
    return this.items.some(
      (p) =>
        p.target === target && (p.status === 'queued' || p.status === 'building'),
    );
  }

  /** Replace queue contents from a save snapshot. */
  public replaceAll(projects: ConstructionProject[]) {
    this.items = projects.map((p) => ({
      ...p,
      roadTiles: p.roadTiles.map((t) => ({ ...t })),
    }));
  }

  private prune() {
    this.items = this.items.filter((p) => p.status === 'queued' || p.status === 'building');
  }
}
