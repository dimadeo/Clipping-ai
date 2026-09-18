# Pipeline glass design

The pipeline uses a pure black background and dark frosted cards. Amber, emerald/cyan, and violet underlights give the cards depth. These colors are decorative: read the status badge for the actual state of a stage or connection.

## Shared tokens

All component tokens live on `#pipeline-control` in `src/pipeline-panel.js`.

| Token | Purpose |
| --- | --- |
| `--pipeline-black` | Pure black background, `#000`. |
| `--pipeline-surface` / `--pipeline-glass-fill` | Opaque charcoal fallback, then translucent charcoal when backdrop blur is supported. |
| `--pipeline-orb-amber`, `--pipeline-orb-cyan`, `--pipeline-orb-violet` | Diffuse accent lighting, repeated independently of stage status. |
| `--pipeline-text` / `--pipeline-muted` | White primary labels and readable light gray supporting text. |
| `--pipeline-line` / `--pipeline-rim` | Quiet outer border and brighter top edge. |
| `--pipeline-depth` / `--pipeline-reflection` | Layered inset edges, shadow, and a restrained surface reflection. |
| `--pipeline-radius` / `--pipeline-small-radius` | Rounded cards at 24 px and controls at 14 px. |
| `--pipeline-focus` | Bright cream keyboard outline, outside the control boundary. |

## Components and states

Stage cards, summary cards, the selected-stage detail panel, and system cards share the glass surface. Stage numbers retain their hexagonal shape, and amber arrows retain the existing reading order. The layout still adapts to five, three, two, or one column.

Primary actions and stage titles use white 18 px labels. Supporting text is generally 16 px; status badges and version notes are 15 px. The opaque status badges preserve their own text and border colors above the decorative lighting.

A selected stage has a solid white border and a second outer rim, reinforced by its existing pressed state and the selected-stage detail heading. Hover brightens the border without moving the card. Keyboard focus adds a separate cream outline with space around it. Disabled controls use legible gray text and a subdued surface.

## Accessibility and fallback

The effect uses CSS only. It adds no moving orbs, parallax, animations, or external assets. Decorative layers cannot intercept clicks. Keyboard controls, focus, labels, monitoring behavior, and request handling remain unchanged.

Browsers without backdrop filtering use an opaque charcoal surface with the same borders, text, status badges, and inset depth. The background remains pure black. Keep ambient colors diffuse and low in intensity; strengthen a border or text label when a state needs emphasis.
