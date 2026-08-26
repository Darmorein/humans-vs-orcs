# Integration map

## Current-game replacement surface

The directory layout under `assets/` mirrors the current repository's
`public/assets/` layout. These groups can be reviewed as direct replacements:

- `assets/humans/buildings/` — 4 files;
- `assets/humans/units/` — 4 static compatibility sprites;
- `assets/orcs/buildings/` — 4 files;
- `assets/orcs/units/` — 4 static compatibility sprites;
- `assets/terrain/` — 23 files, including every current terrain PNG;
- `assets/ui/` — 12 files;
- `assets/vfx/` — 8 files.

The following eight assets are additions. They now have Manifest v2 entries;
the status column describes their current runtime integration:

| Asset | Manifest id | Runtime status |
| --- | --- | --- |
| Hill | `world/hill` | active for hill terrain |
| Bridge | `world/bridge` | active for bridge terrain |
| Outpost foundation | `world/outpost-foundation` | registered, construction-state use deferred |
| Human outpost | `human/outpost` | active for Human Outpost |
| Orc outpost | `orc/outpost` | active for Orc Outpost |
| Cart | `terrain/cart` | registered, placement deferred |
| Fence | `terrain/fence` | registered, placement deferred |
| Market stall | `terrain/market-stall` | registered, placement deferred |

Runtime copies of non-tile replacements are normalized to the previous
sprite's visible height before they are written to `public/assets`. This keeps
the existing Manifest scale contract stable while retaining the full-resolution
master PNGs in the separately archived production kit.

## Safety rules

1. Integrate on a dedicated branch.
2. Preserve the existing asset kit until an in-game comparison is approved.
3. Update `sourceWidth/sourceHeight` from `manifest.json`.
4. Recalibrate `worldScale` and pivots; generated canvas dimensions differ from
   the previous kit and must not be compensated with ad-hoc draw constants.
5. Keep unit `atlas: null` while using the static compatibility sprites.
6. Promote a unit to `production` only after its full four-direction atlas and
   team-color mask pass validation.

## Known intentional deferrals

- final team-color masks;
- frame-by-frame production animation atlases;
- corpse/death presentation lifecycle;
- river autotiling beyond the supplied shoreline references;
- baked territory overlays (territory remains a runtime effect).
