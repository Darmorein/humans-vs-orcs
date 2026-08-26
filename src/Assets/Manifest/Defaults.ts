import type {
  AssetCategory,
  AssetEntry,
  AssetEntryInput,
  ElevationType,
  Footprint,
  IsoDirection,
  RenderLayer,
  SpriteSheetDefinition,
  TeamColorMaskDefinition,
  TileFootprint,
} from './Types';

function fp(width: number, height: number): Footprint {
  return { width, height };
}

function tiles(columns: number, rows: number): TileFootprint {
  return { columns, rows };
}

interface CategoryDefaults {
  faction: AssetEntry['faction'];
  role: string | null;
  worldScale: number;
  footprint: Footprint;
  footprintTiles: TileFootprint;
  collisionFootprint: Footprint;
  pivotX: number;
  pivotY: number;
  selectionRadius: number;
  renderLayer: RenderLayer;
  blocksMovement: boolean;
  blocksVision: boolean;
  teamColorMask: TeamColorMaskDefinition | null;
  animationStates: string[];
  animationDirections: IsoDirection[];
  atlas: SpriteSheetDefinition | null;
  productionStatus: AssetEntry['productionStatus'];
  tags: string[];
  terrainType: string | null;
  walkable: boolean | null;
  movementCost: number | null;
  elevationType: ElevationType | null;
  defenseModifier: number | null;
  visionModifier: number | null;
  roadConnectionMask: number | null;
  riverConnectionMask: number | null;
}

const NEUTRAL_TERRAIN: CategoryDefaults = {
  faction: 'neutral',
  role: null,
  worldScale: 1,
  footprint: fp(28, 28),
  footprintTiles: tiles(1, 1),
  collisionFootprint: fp(28, 28),
  pivotX: 0.5,
  pivotY: 0.55,
  selectionRadius: 0,
  renderLayer: 'terrain',
  blocksMovement: false,
  blocksVision: false,
  teamColorMask: null,
  animationStates: ['idle'],
  animationDirections: ['SE'],
  atlas: null,
  productionStatus: 'prototype',
  tags: ['terrain'],
  terrainType: null,
  walkable: true,
  movementCost: 1,
  elevationType: 'flat',
  defenseModifier: 0,
  visionModifier: 1,
  roadConnectionMask: 0,
  riverConnectionMask: 0,
};

const BY_CATEGORY: Record<AssetCategory, CategoryDefaults> = {
  unit: {
    faction: null,
    role: null,
    worldScale: 0.24,
    footprint: fp(24, 24),
    footprintTiles: tiles(1, 1),
    collisionFootprint: fp(20, 20),
    pivotX: 0.5,
    pivotY: 0.92,
    selectionRadius: 18,
    renderLayer: 'units',
    blocksMovement: false,
    blocksVision: false,
    teamColorMask: null,
    animationStates: ['idle'],
    animationDirections: ['SE'],
    atlas: null,
    productionStatus: 'prototype',
    tags: ['unit'],
    terrainType: null,
    walkable: null,
    movementCost: null,
    elevationType: null,
    defenseModifier: null,
    visionModifier: null,
    roadConnectionMask: null,
    riverConnectionMask: null,
  },
  building: {
    faction: null,
    role: null,
    worldScale: 0.26,
    footprint: fp(80, 80),
    footprintTiles: tiles(3, 3),
    collisionFootprint: fp(70, 70),
    pivotX: 0.5,
    pivotY: 0.88,
    selectionRadius: 48,
    renderLayer: 'buildings',
    blocksMovement: true,
    blocksVision: true,
    teamColorMask: null,
    animationStates: ['idle'],
    animationDirections: ['SE'],
    atlas: null,
    productionStatus: 'prototype',
    tags: ['building'],
    terrainType: null,
    walkable: null,
    movementCost: null,
    elevationType: null,
    defenseModifier: null,
    visionModifier: null,
    roadConnectionMask: null,
    riverConnectionMask: null,
  },
  terrain: { ...NEUTRAL_TERRAIN },
  decoration: {
    faction: 'neutral',
    role: 'prop',
    worldScale: 0.24,
    footprint: fp(20, 20),
    footprintTiles: tiles(1, 1),
    collisionFootprint: fp(12, 12),
    pivotX: 0.5,
    pivotY: 0.9,
    selectionRadius: 0,
    renderLayer: 'decoration',
    blocksMovement: false,
    blocksVision: false,
    teamColorMask: null,
    animationStates: ['idle'],
    animationDirections: ['SE'],
    atlas: null,
    productionStatus: 'prototype',
    tags: ['decoration'],
    terrainType: null,
    walkable: null,
    movementCost: null,
    elevationType: null,
    defenseModifier: null,
    visionModifier: null,
    roadConnectionMask: null,
    riverConnectionMask: null,
  },
  resource: {
    faction: 'neutral',
    role: 'gold',
    worldScale: 0.32,
    footprint: fp(40, 40),
    footprintTiles: tiles(2, 2),
    collisionFootprint: fp(36, 36),
    pivotX: 0.5,
    pivotY: 0.82,
    selectionRadius: 28,
    renderLayer: 'decoration',
    blocksMovement: true,
    blocksVision: false,
    teamColorMask: null,
    animationStates: ['idle'],
    animationDirections: ['SE'],
    atlas: null,
    productionStatus: 'prototype',
    tags: ['resource', 'gold'],
    terrainType: null,
    walkable: null,
    movementCost: null,
    elevationType: null,
    defenseModifier: null,
    visionModifier: null,
    roadConnectionMask: null,
    riverConnectionMask: null,
  },
  ui: {
    faction: null,
    role: 'icon',
    worldScale: 1,
    footprint: fp(32, 32),
    footprintTiles: tiles(0, 0),
    collisionFootprint: fp(0, 0),
    pivotX: 0.5,
    pivotY: 0.5,
    selectionRadius: 0,
    renderLayer: 'ui',
    blocksMovement: false,
    blocksVision: false,
    teamColorMask: null,
    animationStates: ['idle'],
    animationDirections: ['SE'],
    atlas: null,
    productionStatus: 'prototype',
    tags: ['ui'],
    terrainType: null,
    walkable: null,
    movementCost: null,
    elevationType: null,
    defenseModifier: null,
    visionModifier: null,
    roadConnectionMask: null,
    riverConnectionMask: null,
  },
  vfx: {
    faction: null,
    role: 'fx',
    worldScale: 0.2,
    footprint: fp(16, 16),
    footprintTiles: tiles(0, 0),
    collisionFootprint: fp(0, 0),
    pivotX: 0.5,
    pivotY: 0.5,
    selectionRadius: 0,
    renderLayer: 'vfx',
    blocksMovement: false,
    blocksVision: false,
    teamColorMask: null,
    animationStates: ['play'],
    animationDirections: ['SE'],
    atlas: null,
    productionStatus: 'prototype',
    tags: ['vfx'],
    terrainType: null,
    walkable: null,
    movementCost: null,
    elevationType: null,
    defenseModifier: null,
    visionModifier: null,
    roadConnectionMask: null,
    riverConnectionMask: null,
  },
};

/** Fill omitted fields from category defaults. Does not invent `id` / `category` / `src`. */
export function applyAssetDefaults(input: AssetEntryInput): AssetEntry {
  const d = BY_CATEGORY[input.category];
  return {
    id: input.id,
    category: input.category,
    src: input.src,
    faction: input.faction !== undefined ? input.faction : d.faction,
    role: input.role !== undefined ? input.role : d.role,
    sourceWidth: input.sourceWidth ?? null,
    sourceHeight: input.sourceHeight ?? null,
    worldScale: input.worldScale ?? d.worldScale,
    footprint: input.footprint ?? { ...d.footprint },
    footprintTiles: input.footprintTiles ?? { ...d.footprintTiles },
    collisionFootprint: input.collisionFootprint ?? { ...d.collisionFootprint },
    pivotX: input.pivotX ?? d.pivotX,
    pivotY: input.pivotY ?? d.pivotY,
    selectionRadius: input.selectionRadius ?? d.selectionRadius,
    renderLayer: input.renderLayer ?? d.renderLayer,
    blocksMovement: input.blocksMovement ?? d.blocksMovement,
    blocksVision: input.blocksVision ?? d.blocksVision,
    teamColorMask: input.teamColorMask ?? d.teamColorMask,
    animationStates: input.animationStates ?? [...d.animationStates],
    animationDirections: input.animationDirections ?? [...d.animationDirections],
    atlas: input.atlas ?? d.atlas,
    productionStatus: input.productionStatus ?? d.productionStatus,
    tags: input.tags ?? [...d.tags],
    terrainType: input.terrainType !== undefined ? input.terrainType : d.terrainType,
    walkable: input.walkable !== undefined ? input.walkable : d.walkable,
    movementCost: input.movementCost !== undefined ? input.movementCost : d.movementCost,
    elevationType: input.elevationType !== undefined ? input.elevationType : d.elevationType,
    defenseModifier: input.defenseModifier !== undefined ? input.defenseModifier : d.defenseModifier,
    visionModifier: input.visionModifier !== undefined ? input.visionModifier : d.visionModifier,
    roadConnectionMask:
      input.roadConnectionMask !== undefined ? input.roadConnectionMask : d.roadConnectionMask,
    riverConnectionMask:
      input.riverConnectionMask !== undefined ? input.riverConnectionMask : d.riverConnectionMask,
  };
}
