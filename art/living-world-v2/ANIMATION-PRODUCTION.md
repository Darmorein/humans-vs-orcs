# Animation production contract

The eight static unit sprites define approved class silhouette, materials and
color language. They are not fake atlases. Production animation follows the
runtime already merged into Manifest v2.

## Shared standard

| Property | Value |
| --- | --- |
| Directions | `NE`, `SE`, `SW`, `NW` |
| Frame canvas | fixed per unit, recommended 192×192 or 256×256 |
| Pivot | identical ground contact in every frame |
| Idle | 6 frames, 8 fps, loop |
| Walk | 8 frames, 10 fps, loop |
| Attack | 8 frames, 12 fps, one-shot |
| Hit | 4 frames, 12 fps, one-shot |
| Death | 8 frames, 10 fps, one-shot |
| Atlas padding/spacing | 2 px / 2 px |

This equals 34 frames per direction, 136 core frames per unit and 1088 core
frames for the current eight-unit roster. Civilian/caster extensions are added
only after core gameplay review.

## Unit jobs

| Unit | Extra clips | Attack note |
| --- | --- | --- |
| Human Worker | `gather`, `carry-resource`, `build` | small hammer action |
| Human Swordsman | none initially | shield leads, short readable arc |
| Human Archer | `attack-anticipation`, `projectile-release` | release frame 4 |
| Human Mage | `cast`, optional `channel` | effect separate from body atlas |
| Orc Peon | `gather`, `carry-resource`, `build` | tool swing, heavy posture |
| Orc Grunt | none initially | broad axe arc, no giant smear |
| Orc Spear Orc | `attack-anticipation`, `projectile-release` | release frame 4 |
| Orc Shaman | `cast`, optional `channel` | effect separate from body atlas |

## Production order

1. Human Swordsman full core atlas.
2. In-game pivot, scale, direction and state QA.
3. Orc Grunt as opposing melee benchmark.
4. Human Archer and Orc Spear Orc with release-frame validation.
5. Worker and Peon civilian extensions.
6. Mage and Shaman casting extensions.

## Per-sheet prompt skeleton

```text
Use the approved static unit sprite as an identity and material reference.
Create one animation clip for <UNIT>, state <STATE>, direction <DIRECTION>.
Fixed 3/4 isometric 2:1 camera, upper-left light, identical costume, equipment,
body proportions, canvas size and ground-contact pivot in every frame.
<FRAME_COUNT> evenly spaced keyframes in chronological order on a single row,
genuine transparent RGBA, no labels, no checkerboard, no background, no camera
movement, no weapon-hand swaps, no baked VFX or selection ring.
```

Generate one clip and direction per job. Do not ask a generator to invent an
entire 136-frame unit atlas in one image.
