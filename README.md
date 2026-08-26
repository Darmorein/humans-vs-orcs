# Humans vs Orcs

Browser-based isometric fantasy RTS with deterministic world generation,
autonomous settlements, squads, territory influence, world history and a PvP
relay foundation.

## Run locally

```bash
npm ci
npm run dev
```

Production build:

```bash
npm run build
```

Optional PvP relay:

```bash
npm run pvp
```

## Main systems

- `src/Map` — deterministic terrain, rivers, bridges, pathfinding and influence.
- `src/Settlement` — living settlements, population and construction.
- `src/Combat` — squads, formations, morale and tactical terrain.
- `src/Players` — faction definitions and local/AI/remote controllers.
- `src/Sim` — deterministic command, replay and save pipeline.
- `src/Assets/Manifest` — schema-driven Asset Manifest v2.
- `art-kit` / `public/assets` — source art kit and runtime assets.

Art scale, pivots, tile footprints, directional sprite sheets and team-color
masks are specified in [Asset Pipeline v2](docs/ASSET_PIPELINE_V2.md).

