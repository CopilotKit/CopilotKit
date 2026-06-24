# Threads Drawer — Theming Contract

The threads-drawer is a BASE component. It is fully driven by CSS variables and
contains no hardcoded colors, shadows, or surface radii. To theme it for an
example, (re)define the tokens below on any ancestor (e.g. `:root`, `body`, or a
wrapper element) — **never edit the drawer files**.

The drawer first consumes the shared design-system tokens (`--card`,
`--border`, `--radius`, …) that `ui/card.tsx` and `ui/button.tsx` also consume.
For a handful of drawer-specific visuals (scrim, shadows, delete-hover tint) it
exposes dedicated `--threads-*` tokens, each with a fallback to a shared token or
the original literal — so defining nothing reproduces the default look exactly.

## Shared design-system tokens consumed

| Token                      | Controls                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--background`             | Tooltip text color (`color: var(--background)` on the dark tooltip body)                                                                                  |
| `--foreground`             | Drawer/dialog title + body text, active segment text, tooltip surface bg                                                                                  |
| `--card`                   | Drawer surface bg (via `--threads-drawer-bg`), active segment bg, empty/dialog/load-more bg                                                               |
| `--border`                 | Drawer + header + filter + dialog borders, thread accent (idle), selected-row inset ring, secondary-button hover bg, tooltip border                       |
| `--radius`                 | Drawer/dialog/button/segment/thread/empty-card radii; tooltip radius derives from it                                                                      |
| `--primary`                | New-thread button bg, primary dialog button bg, selected thread accent                                                                                    |
| `--primary-foreground`     | New-thread button text, primary dialog button text                                                                                                        |
| `--secondary`              | Icon-button + thread-row + load-more hover bg, segment track, archived badge bg, secondary dialog button bg, loading skeleton bars, thread-enter start bg |
| `--secondary-foreground`   | (locked-state) inline code text                                                                                                                           |
| `--muted-foreground`       | Icon-button idle color, segment idle text, meta text, placeholder/archived titles, empty/dialog description, load-more text, collapsed-rail icon          |
| `--accent`                 | Selected thread-row bg                                                                                                                                    |
| `--ring`                   | Focus-visible outline on buttons, thread items, segments, dialog buttons                                                                                  |
| `--destructive`            | Delete-button icon color + delete-hover text                                                                                                              |
| `--destructive-foreground` | Destructive dialog button text                                                                                                                            |
| `--font-body`              | Header, segments, tooltip, empty card, and dialog typography                                                                                              |

(locked-state additionally uses `--secondary`, `--muted-foreground`, `--border`,
`--radius`, `--secondary-foreground`, and the `ui/card` + `ui/button` tokens via
those components.)

## Drawer-specific tokens (with fallbacks)

| Token                             | Controls                                  | Fallback                                                  |
| --------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| `--threads-drawer-bg`             | Drawer surface background                 | `var(--card)`                                             |
| `--threads-drawer-border`         | Drawer right border color                 | `var(--border)`                                           |
| `--threads-drawer-shadow`         | Open-drawer drop shadow                   | `4px 0 20px rgb(0 0 0 / 0.04)`                            |
| `--threads-segment-active-shadow` | Active filter-segment shadow              | `0 1px 2px rgb(0 0 0 / 0.06)`                             |
| `--threads-delete-hover-bg`       | Delete-button hover/focus background tint | `color-mix(in srgb, var(--destructive) 10%, transparent)` |
| `--threads-overlay-bg`            | Confirm-dialog overlay scrim              | `rgb(0 0 0 / 0.5)`                                        |
| `--threads-dialog-shadow`         | Confirm-dialog drop shadow                | `0 20px 50px rgb(0 0 0 / 0.25)`                           |
| `--threads-tooltip-radius`        | Action-button tooltip corner radius       | `calc(var(--radius) - 0.45rem)` (= `0.3rem` at default)   |

All fallbacks resolve to the original hardcoded values in the north-star, so an
example that defines none of the `--threads-*` tokens renders pixel-identical to
the pre-tokenization drawer.
