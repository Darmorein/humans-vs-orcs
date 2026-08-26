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
| Decoration pivot | ground contact point |

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

Recommended sheet rules:

- 2 px transparent padding and 2 px spacing;
- power-of-two atlases up to 4096×4096;
- identical frame dimensions and ground pivot across every direction;
- no baked selection ring or player color;
- transparent RGBA background.

## Animation runtime

`src/Assets/Animation/` is a visual-only layer between Manifest v2 and unit
rendering. A clip lookup key is exactly `state + direction`. The initial unit
state priority is `death`, `hit`, `attack`, `walk`, then `idle`; these states
only reflect facts already established by gameplay.

The direction adapter reads `Unit.facingX` and `Unit.facingY` in world space.
The dominant axis maps as follows: `+X → SE`, `+Y → SW`, `-X → NW`, and
`-Y → NE`. Exact `|X| === |Y|` ties use X, while near-zero vectors keep the
previous valid direction. Camera position and screen coordinates never affect
the result.

Animation time advances only through the `dt` supplied to `Unit.update`. The
runtime does not read wall-clock time, schedule timers or use randomness, so
the same clip, starting state and delta sequence always produce the same frame.
Looping clips use modulo progression. One-shot clips hold their final frame and
report completion without changing gameplay state.

For a zero-based absolute frame index `i`, atlas coordinates are:

```text
column = i % columns
row    = floor(i / columns)
srcX   = margin + column * (frameWidth + spacing)
srcY   = margin + row    * (frameHeight + spacing)
```

The drawn source rectangle always uses `frameWidth × frameHeight`. Scale and
pivot still come from the resolved asset entry.

`releaseFrame` is zero-based within its clip. Crossing it emits one visual
event per clip execution, including when one large delta crosses several
frames. Combat damage and projectile creation remain in gameplay code. A later
combat-presentation PR may consume this event to align a projectile visual,
but must not make simulation results depend on animation completion.

If `atlas` is null, the renderer uses the existing whole-image `drawSprite`
path. If a defined atlas lacks the requested `state + direction`, the renderer
uses its first valid cell instead of accidentally drawing the whole sheet.
Missing clips in a defined atlas produce one development warning per unique
`asset + state + direction`; production builds do not log them every frame.

Example atlas metadata:

```ts
atlas: {
  frameWidth: 192,
  frameHeight: 192,
  columns: 8,
  rows: 4,
  margin: 2,
  spacing: 2,
  clips: [
    { state: 'idle', direction: 'SE', startFrame: 0, frameCount: 6, fps: 8, loop: true },
    {
      state: 'attack',
      direction: 'SE',
      startFrame: 8,
      frameCount: 8,
      fps: 12,
      loop: false,
      releaseFrame: 4,
    },
  ],
}
```

The adapter recognizes `death`, but the current entity lifecycle removes dead
units before the next render. Persistent corpses and visible death playback are
intentionally deferred to a separate presentation-lifecycle change.

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

Prototype assets are intentionally allowed to omit sheets, source dimensions
and masks. Runtime diagnostics report those remaining production gaps as one
summary instead of pretending the assets are final.
