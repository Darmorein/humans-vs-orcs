# Expansion Asset Pack v1

This expansion fills the living-world and frontier gaps left after Art Kit v2.
It adds 35 production static sprites without replacing the existing 64 runtime
assets.

## Coverage

- Resources: Stone Deposit and Iron Deposit
- Strategic structures: Human Fort and Orc Fort
- Human civic growth: two houses, workshop, storage shed, market stall
- Orc civic growth: two huts, workshop, storage hut, trade stall
- Modular defenses: Human and Orc palisade and gate segments
- Expansion-site props: fertile patch, mineral patch, signpost, cart, campfire, fence
- Roads: worn, heavy-travel and muddy variants
- Bridges: Human reinforced and Orc rough variants
- Battlefield history: shield, spear, helmet, banner, weapons and burnt wagon

## Runtime contract

Runtime files live under `public/assets/expansion/` and are registered by
`EXPANSION_ASSET_ENTRIES` in Manifest v2. Registration makes them available to
asset lookup; it does not spawn objects or change map generation by itself.

The files use a shared 2:1 isometric projection, RGBA transparency and at least
16 px of transparent padding. Roads and ground patches use the current terrain
envelope (356 × 197 px). Bridge variants use the current bridge envelope
(365 × 202 px).

Static buildings and props expose source dimensions, pivots, render scale and
footprints in the manifest. Gameplay remains authoritative for construction,
resource harvesting, garrisons, pathfinding and map placement.

## Validation

`npm run validate:assets` validates both Manifest v2 metadata and the existence
of every registered public sprite and team-color mask. `npm run build` runs this
validation before TypeScript and Vite.
