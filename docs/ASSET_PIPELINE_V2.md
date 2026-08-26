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

