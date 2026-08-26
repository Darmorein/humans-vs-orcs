# Asset Pipeline v2

This document is the production contract between simulation, rendering and art.
The current PNG files remain prototype sprites until their manifest entry is
promoted to `production`.

## Frozen coordinate standard

| Property | Value |
| --- | --- |
| Projection | fixed 2:1 isometric |
| Authoring tile | 128×64 px |
| Runtime map cell | 28 world units |
| Light | upper-left |
| Unit pivot | ground contact between the feet |
| Building pivot | center of the lower footprint edge |
| Decsheets pivot | ground contact point |

`footprint` is expressed in runtime world units and is independent from image
bounds. `footprintTiles` is the placement footprint used by map generation and
construction. `collisionFootprint` is the physical blocking area and may be
smaller than both.

Initial building placement sizes:

| Role | Humans | Orcs | Tiles |
| --- | --- | --- | --- |
| Main | Town Hall | Stronghold | 4×4 |
| Production | Barracks | Barracks | 3×2 |
| Economy | Farm | War Hut | 2×2 |
| Defense | Watchtower | Spike Tower | 1×1 |

## Runtime authority

After `assets.load()` validates and registers the manifest, runtime systems use
the resolved entry as their primary source of truth:

- `worldScale` and `pivotY` control sprite drawing;
- `collisionFootprint` sets the circular collision body's conservative radius;
- `selectionRadius` controls click targeting and the rendered selection ring;
- `footprint` and `footprintTiles × worldUnitsPerTile` determine building
  placement clearance (the larger extent wins);
- the placement preview uses that same resolved clearance.

Legacy constants remain only as boot/test fallbacks when the manifest registry
has not been loaded or a gameplay sprite has no entry. Runtime diagnostics check
coverage for every current building mapping, every playable unit sprite and the
required terrain types. They also warn if `MAP_CONFIG.tileSize` diverges from
`standards.space.worldUnitsPerTile`.

## Directional unit sheets

Every production unit targets four authored directions: `NE`, `SE`, `SW`, and
`NW`. Mirroring may be used by the renderer only when asymmetric equipment,
team-color markings and weapon hands remain correct.

Required clips:

- all units: `idle`, `walk`, `attack`, `hit`, `death`;
- civilians: `gather`, `carry-resource`, `build`;
- ranged units: `attack-anticipation`, `projectile-release`;
- casters: `cast`, optionally `channel`.

Each `SpriteSheetDefinition` stores the frame geometry plus explicit clips. A
clip is addressed by `state + direction`; ranged clips may define a
zero-based `releaseFrame`. Frames cannot be reused by two clips in one sheet.

### Exact sheet layout

Frames are indexed **row-major** from the top-left cell:

```
absoluteIndex = row * columns + column
srcX = margin + column * (frameWidth + spacing)
srcY = margin + row * (frameHeight + spacing)
srcW = frameWidth
srcH = frameHeight
```

Recommended sheet rules:

- 2 px transparent padding (`margin`) and 2 px spacing;
- power-of-two atlases up to 4096×4096;
- identical frame dimensions and ground pivot across every direction;
- no baked selection ring or player color;
- transparent RGBA background.

When `sourceWidth` / `sourceHeight` are authored, validation requires:

```
expectedW = margin*2 + columns*frameWidth + (columns-1)*spacing
expectedH = margin*2 + rows*frameHeight + (rows-1)*spacing
```

### Clip lookup rules

Runtime lookup key is `state:direction` (see `findClip` / `AnimationPlayer`):

1. Read `AssetEntry.atlas`. If `atlas === null`, use the static full-image path.
2. Select clip where `clip.state` and `clip.direction` match the requested pose.
3. If no clip matches, keep the static full-image fallback and emit a
   **development-only** diagnostic **once** per `(assetId, state, direction)`.
4. Never invent frame sizes, pivots, or clip tables outside the manifest.

Unit pose priority (presentation only): `death` → `attack` → `hit` → `walk` →
`idle`. Facing uses the unit's gameplay `facingX` / `facingY` mapped through
`facingToIsoDirection` (iso screen axes `sx = fx - fy`, `sy = fx + fy`).

### Deterministic timing contract

`AnimationPlayer` advances only from **caller-supplied** `dt` (simulation or
render time). It must not read wall-clock time or use `Math.random()`.

- Looping clip: `localFrame = floor(elapsed * fps) mod frameCount`
- One-shot clip: clamp to the last frame; `completed` when
  `elapsed * fps >= frameCount`
- `releaseFrame` (zero-based inside the clip) emits **exactly once** per
  playthrough when `localFrame >= releaseFrame`; resetting the clip identity
  arms it again

Combat damage, movement, death and cooldowns stay authoritative in gameplay
systems. `releaseFrame` is exposed for future projectile/VFX sync and must not
replace attack cooldown logic.

### Fallback behavior

| Condition | Draw path |
| --- | --- |
| `atlas === null` (prototype PNG) | Full image via `drawSprite` (unchanged) |
| Atlas present, clip missing | Full image + one-shot DEV warning |
| Atlas present, clip resolved | `drawImage` source rect from `atlasFrameRect` |

### Animation state and save / replay

Animation playheads, hit/attack presentation timers, and release pulses are
**not** serialized into save games or replay snapshots. Replay/PvP determinism
covers gameplay state only; presentation rebuilds from facing, movement and
combat cues after load. Including ephemeral frame indices would bloat saves
without improving sim hashes, and would risk false desyncs if render cadence
diverged from sim ticks.

## Team color

Faction identity and player identity are separate. Human/Orc materials stay
fixed, while banners, small cloth areas, selection rings and territory overlays
may use the player's color.

A production faction asset should provide a separate `teamColorMask.src` image.
The default contract reads the red channel and replaces the masked color. This
allows several Human or Orc players without recoloring the base faction art.

## Promotion checklist

Before changing `productionStatus` to `production`:

1. Author `sourceWidth` and `sourceHeight` in the manifest.
2. Verify `footprintTiles`, world footprint and collision footprint separately.
3. Check normalized pivot values in `[0, 1]` at 100%, 75% and 50% zoom.
4. For units, attach an atlas with every required direction and gameplay clip.
5. Attach a team-color mask for faction-owned art.
6. Confirm the asset path starts with `/assets/` and loads during boot.
7. Run `npm run build`; production metadata errors block compilation/runtime boot.
8. Run `npm run test:animation` after atlas/clip changes.

Prototype assets are intentionally allowed to omit sheets, source dimensions
and masks. Runtime diagnostics report those remaining production gaps as one
summary instead of pretending the assets are final.
