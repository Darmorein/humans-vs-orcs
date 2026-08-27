import type { AssetEntryInput } from './Types';

const expansion = (entry: AssetEntryInput): AssetEntryInput => ({
  ...entry,
  productionStatus: 'production',
  animationStates: ['idle'],
  animationDirections: ['SE'],
  atlas: null,
  tags: [...(entry.tags ?? []), 'expansion-v1'],
});

const staticBuilding = (
  entry: AssetEntryInput,
  footprint: { width: number; height: number },
  tiles: { columns: number; rows: number },
): AssetEntryInput => expansion({
  ...entry,
  category: 'building',
  footprint,
  footprintTiles: tiles,
  collisionFootprint: {
    width: Math.round(footprint.width * 0.88),
    height: Math.round(footprint.height * 0.88),
  },
  blocksMovement: true,
  blocksVision: true,
});

const prop = (entry: AssetEntryInput): AssetEntryInput => expansion({
  ...entry,
  category: 'decoration',
  faction: entry.faction ?? 'neutral',
  blocksMovement: false,
  blocksVision: false,
  selectionRadius: 0,
});

const terrain = (entry: AssetEntryInput): AssetEntryInput => expansion({
  ...entry,
  category: 'terrain',
  walkable: true,
  movementCost: entry.movementCost ?? 1,
  elevationType: 'flat',
  blocksMovement: false,
  blocksVision: false,
});

/**
 * Living-world expansion sprites. Entries are registered for runtime lookup but
 * do not create gameplay entities by themselves.
 */
export const EXPANSION_ASSET_ENTRIES: AssetEntryInput[] = [
  expansion({
    id: 'resource/stone-deposit', category: 'resource',
    src: '/assets/expansion/resources/stone-deposit.png', faction: 'neutral', role: 'stone',
    sourceWidth: 412, sourceHeight: 265, worldScale: 0.22,
    footprintTiles: { columns: 2, rows: 2 }, pivotY: 0.86, selectionRadius: 28,
    blocksMovement: true, tags: ['resource', 'stone', 'strategic'],
  }),
  expansion({
    id: 'resource/iron-deposit', category: 'resource',
    src: '/assets/expansion/resources/iron-deposit.png', faction: 'neutral', role: 'iron',
    sourceWidth: 412, sourceHeight: 276, worldScale: 0.22,
    footprintTiles: { columns: 2, rows: 2 }, pivotY: 0.86, selectionRadius: 28,
    blocksMovement: true, tags: ['resource', 'iron', 'strategic'],
  }),

  staticBuilding({
    id: 'human/fort', category: 'building', src: '/assets/expansion/strategic-structures/human-fort.png',
    faction: 'humans', role: 'fort', sourceWidth: 552, sourceHeight: 344, worldScale: 0.28,
    selectionRadius: 46, tags: ['fort', 'defense', 'garrison', 'frontier'],
  }, { width: 76, height: 76 }, { columns: 3, rows: 2 }),
  staticBuilding({
    id: 'orc/fort', category: 'building', src: '/assets/expansion/strategic-structures/orc-fort.png',
    faction: 'orcs', role: 'fort', sourceWidth: 552, sourceHeight: 408, worldScale: 0.27,
    selectionRadius: 46, tags: ['fort', 'defense', 'garrison', 'frontier'],
  }, { width: 76, height: 76 }, { columns: 3, rows: 2 }),

  staticBuilding({
    id: 'human/house-a', category: 'building', src: '/assets/expansion/human-civic/human-house-a.png',
    faction: 'humans', role: 'civic-house', sourceWidth: 298, sourceHeight: 292, worldScale: 0.2,
    selectionRadius: 24, tags: ['civic', 'house', 'city-growth'],
  }, { width: 38, height: 38 }, { columns: 1, rows: 1 }),
  staticBuilding({
    id: 'human/house-b', category: 'building', src: '/assets/expansion/human-civic/human-house-b.png',
    faction: 'humans', role: 'civic-house', sourceWidth: 267, sourceHeight: 292, worldScale: 0.2,
    selectionRadius: 24, tags: ['civic', 'house', 'city-growth'],
  }, { width: 38, height: 38 }, { columns: 1, rows: 1 }),
  staticBuilding({
    id: 'human/workshop', category: 'building', src: '/assets/expansion/human-civic/human-workshop.png',
    faction: 'humans', role: 'civic-workshop', sourceWidth: 423, sourceHeight: 362, worldScale: 0.21,
    selectionRadius: 32, tags: ['civic', 'workshop', 'city-growth'],
  }, { width: 54, height: 54 }, { columns: 2, rows: 2 }),
  staticBuilding({
    id: 'human/storage-shed', category: 'building', src: '/assets/expansion/human-civic/human-storage-shed.png',
    faction: 'humans', role: 'civic-storage', sourceWidth: 319, sourceHeight: 282, worldScale: 0.2,
    selectionRadius: 24, tags: ['civic', 'storage', 'city-growth'],
  }, { width: 38, height: 38 }, { columns: 1, rows: 1 }),
  prop({
    id: 'human/market-stall-variant', category: 'decoration',
    src: '/assets/expansion/human-civic/human-market-stall-variant.png', faction: 'humans',
    role: 'civic-market', sourceWidth: 272, sourceHeight: 272, worldScale: 0.2,
    tags: ['civic', 'market', 'city-growth'],
  }),

  staticBuilding({
    id: 'orc/hut-a', category: 'building', src: '/assets/expansion/orc-civic/orc-hut-a.png',
    faction: 'orcs', role: 'civic-house', sourceWidth: 292, sourceHeight: 292, worldScale: 0.2,
    selectionRadius: 24, tags: ['civic', 'hut', 'city-growth'],
  }, { width: 38, height: 38 }, { columns: 1, rows: 1 }),
  staticBuilding({
    id: 'orc/hut-b', category: 'building', src: '/assets/expansion/orc-civic/orc-hut-b.png',
    faction: 'orcs', role: 'civic-house', sourceWidth: 334, sourceHeight: 292, worldScale: 0.2,
    selectionRadius: 24, tags: ['civic', 'hut', 'city-growth'],
  }, { width: 38, height: 38 }, { columns: 1, rows: 1 }),
  staticBuilding({
    id: 'orc/workshop', category: 'building', src: '/assets/expansion/orc-civic/orc-workshop.png',
    faction: 'orcs', role: 'civic-workshop', sourceWidth: 410, sourceHeight: 362, worldScale: 0.21,
    selectionRadius: 32, tags: ['civic', 'workshop', 'city-growth'],
  }, { width: 54, height: 54 }, { columns: 2, rows: 2 }),
  staticBuilding({
    id: 'orc/storage-hut', category: 'building', src: '/assets/expansion/orc-civic/orc-storage-hut.png',
    faction: 'orcs', role: 'civic-storage', sourceWidth: 320, sourceHeight: 292, worldScale: 0.2,
    selectionRadius: 24, tags: ['civic', 'storage', 'city-growth'],
  }, { width: 38, height: 38 }, { columns: 1, rows: 1 }),
  prop({
    id: 'orc/trade-stall', category: 'decoration', src: '/assets/expansion/orc-civic/orc-trade-stall.png',
    faction: 'orcs', role: 'civic-market', sourceWidth: 262, sourceHeight: 272, worldScale: 0.2,
    tags: ['civic', 'market', 'city-growth'],
  }),

  staticBuilding({
    id: 'human/palisade-segment', category: 'building',
    src: '/assets/expansion/defenses/human-palisade-segment.png', faction: 'humans', role: 'palisade',
    sourceWidth: 238, sourceHeight: 222, worldScale: 0.2, selectionRadius: 22,
    tags: ['defense', 'palisade', 'modular'],
  }, { width: 52, height: 24 }, { columns: 2, rows: 1 }),
  staticBuilding({
    id: 'human/gate-segment', category: 'building',
    src: '/assets/expansion/defenses/human-gate-segment.png', faction: 'humans', role: 'gate',
    sourceWidth: 377, sourceHeight: 262, worldScale: 0.2, selectionRadius: 28,
    tags: ['defense', 'gate', 'modular'],
  }, { width: 52, height: 24 }, { columns: 2, rows: 1 }),
  staticBuilding({
    id: 'orc/palisade-segment', category: 'building',
    src: '/assets/expansion/defenses/orc-palisade-segment.png', faction: 'orcs', role: 'palisade',
    sourceWidth: 235, sourceHeight: 222, worldScale: 0.2, selectionRadius: 22,
    tags: ['defense', 'palisade', 'modular'],
  }, { width: 52, height: 24 }, { columns: 2, rows: 1 }),
  staticBuilding({
    id: 'orc/gate-segment', category: 'building',
    src: '/assets/expansion/defenses/orc-gate-segment.png', faction: 'orcs', role: 'gate',
    sourceWidth: 346, sourceHeight: 262, worldScale: 0.2, selectionRadius: 28,
    tags: ['defense', 'gate', 'modular'],
  }, { width: 52, height: 24 }, { columns: 2, rows: 1 }),

  terrain({
    id: 'world/fertile-field-patch', category: 'terrain',
    src: '/assets/expansion/world-props/fertile-field-patch.png', faction: 'neutral', role: 'ground',
    sourceWidth: 356, sourceHeight: 197, terrainType: 'fertile', tags: ['terrain', 'fertile', 'expansion-site'],
  }),
  terrain({
    id: 'world/mineral-ground-patch', category: 'terrain',
    src: '/assets/expansion/world-props/mineral-ground-patch.png', faction: 'neutral', role: 'ground',
    sourceWidth: 356, sourceHeight: 197, terrainType: 'mineral', tags: ['terrain', 'mineral', 'expansion-site'],
  }),
  prop({
    id: 'world/frontier-signpost', category: 'decoration',
    src: '/assets/expansion/world-props/frontier-signpost.png', role: 'frontier-prop',
    sourceWidth: 141, sourceHeight: 182, worldScale: 0.22, tags: ['frontier', 'signpost'],
  }),
  prop({
    id: 'world/abandoned-cart', category: 'decoration',
    src: '/assets/expansion/world-props/abandoned-cart.png', role: 'frontier-prop',
    sourceWidth: 226, sourceHeight: 182, worldScale: 0.22, tags: ['frontier', 'cart'],
  }),
  prop({
    id: 'world/old-campfire', category: 'decoration',
    src: '/assets/expansion/world-props/old-campfire.png', role: 'frontier-prop',
    sourceWidth: 172, sourceHeight: 121, worldScale: 0.2, tags: ['frontier', 'campfire'],
  }),
  prop({
    id: 'world/broken-fence', category: 'decoration',
    src: '/assets/expansion/world-props/broken-fence.png', role: 'frontier-prop',
    sourceWidth: 215, sourceHeight: 162, worldScale: 0.2, tags: ['frontier', 'fence'],
  }),

  terrain({
    id: 'road/worn-dirt-road', category: 'terrain',
    src: '/assets/expansion/road-variants/worn-dirt-road.png', faction: 'neutral', role: 'road',
    sourceWidth: 356, sourceHeight: 197, terrainType: 'road', movementCost: 1 / 1.05,
    tags: ['terrain', 'road', 'worn'],
  }),
  terrain({
    id: 'road/heavy-travel-road', category: 'terrain',
    src: '/assets/expansion/road-variants/heavy-travel-road.png', faction: 'neutral', role: 'road',
    sourceWidth: 356, sourceHeight: 197, terrainType: 'road', movementCost: 1 / 1.15,
    tags: ['terrain', 'road', 'major-route'],
  }),
  terrain({
    id: 'road/muddy-road', category: 'terrain',
    src: '/assets/expansion/road-variants/muddy-road.png', faction: 'neutral', role: 'road',
    sourceWidth: 356, sourceHeight: 197, terrainType: 'road', movementCost: 1.05,
    tags: ['terrain', 'road', 'muddy'],
  }),
  terrain({
    id: 'human/reinforced-bridge', category: 'terrain',
    src: '/assets/expansion/bridges/human-reinforced-bridge.png', faction: 'humans', role: 'bridge',
    sourceWidth: 365, sourceHeight: 202, terrainType: 'bridge', tags: ['terrain', 'bridge', 'chokepoint'],
  }),
  terrain({
    id: 'orc/rough-bridge', category: 'terrain',
    src: '/assets/expansion/bridges/orc-rough-bridge.png', faction: 'orcs', role: 'bridge',
    sourceWidth: 365, sourceHeight: 202, terrainType: 'bridge', tags: ['terrain', 'bridge', 'chokepoint'],
  }),

  prop({
    id: 'battlefield/broken-shield', category: 'decoration',
    src: '/assets/expansion/battlefield-props/broken-shield.png', role: 'battlefield-prop',
    sourceWidth: 171, sourceHeight: 152, worldScale: 0.18, tags: ['battlefield', 'shield'],
  }),
  prop({
    id: 'battlefield/broken-spear', category: 'decoration',
    src: '/assets/expansion/battlefield-props/broken-spear.png', role: 'battlefield-prop',
    sourceWidth: 208, sourceHeight: 122, worldScale: 0.18, tags: ['battlefield', 'spear'],
  }),
  prop({
    id: 'battlefield/discarded-helmet', category: 'decoration',
    src: '/assets/expansion/battlefield-props/discarded-helmet.png', role: 'battlefield-prop',
    sourceWidth: 162, sourceHeight: 127, worldScale: 0.18, tags: ['battlefield', 'helmet'],
  }),
  prop({
    id: 'battlefield/damaged-banner-pole', category: 'decoration',
    src: '/assets/expansion/battlefield-props/damaged-banner-pole.png', role: 'battlefield-prop',
    sourceWidth: 162, sourceHeight: 182, worldScale: 0.18, tags: ['battlefield', 'banner'],
  }),
  prop({
    id: 'battlefield/small-weapon-pile', category: 'decoration',
    src: '/assets/expansion/battlefield-props/small-weapon-pile.png', role: 'battlefield-prop',
    sourceWidth: 202, sourceHeight: 135, worldScale: 0.18, tags: ['battlefield', 'weapons'],
  }),
  prop({
    id: 'battlefield/burnt-wagon-remains', category: 'decoration',
    src: '/assets/expansion/battlefield-props/burnt-wagon-remains.png', role: 'battlefield-prop',
    sourceWidth: 252, sourceHeight: 169, worldScale: 0.2, tags: ['battlefield', 'wagon'],
  }),
];
