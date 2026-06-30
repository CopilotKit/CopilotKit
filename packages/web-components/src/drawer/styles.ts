import { css, unsafeCSS } from "lit";
import { GENERATED_DRAWER_TOKEN_DEFAULTS } from "./generated-tokens";

/**
 * Wraps a generated token default value so it can be safely interpolated into a
 * lit `css` template. Values come from the checked-in generated tokens file
 * (derived from react-core), never from user input, so `unsafeCSS` is safe
 * here.
 */
const tok = (value: string) => unsafeCSS(value);
const T = GENERATED_DRAWER_TOKEN_DEFAULTS;

/**
 * Self-contained shadow-DOM styles for `<copilotkit-drawer>`.
 *
 * Authoring rules baked in here:
 *  - Every visual value is a `var(--cpk-drawer-<token>, <built default>)`. The
 *    built defaults come from {@link GENERATED_DRAWER_TOKEN_DEFAULTS}, derived
 *    from react-core's canonical theme at build time (anti-drift). Consumers
 *    override by setting `--cpk-drawer-*` from the light DOM — CSS custom
 *    properties pierce the shadow boundary by design.
 *  - Inherited properties (font, color, line-height) are RE-PINNED on `:host`
 *    so a hostile host stylesheet (`all: unset`, `* { ... !important }`,
 *    Tailwind preflight) cannot leak into or strip styling from the element.
 *  - Structural nodes expose `::part(...)` hooks for fine-grained theming.
 *
 * Token fallbacks are interpolated as literals (not runtime-read) so the CSS is
 * static and ships compiled.
 */
export const drawerStyles = css`
  :host {
    /* Re-pin inheritable properties to close inheritance leaks from hostile
       host CSS. These are the only properties that cross the shadow boundary
       via inheritance, so we hard-set them at the root. */
    all: initial;
    display: block;
    height: 100%;
    box-sizing: border-box;
    font-family:
      var(--cpk-drawer-font-family, ui-sans-serif, system-ui, sans-serif);
    font-size: var(--cpk-drawer-font-size, 14px);
    line-height: var(--cpk-drawer-line-height, 1.4);
    color: var(--cpk-drawer-fg, var(--foreground, ${tok(T.fg)}));

    /* Three-level token resolution, highest priority first:
       1. explicit per-token override (--cpk-drawer-*),
       2. the host app's theme variable (--background/--card/… — the standard
          react-core/shadcn names), so the drawer follows the host's light/dark
          theme by inheritance (custom properties are NOT reset by all:initial),
       3. the built-in light default derived from react-core at build time, so a
          host with no theme still renders correctly (self-contained). */
    --_bg: var(--cpk-drawer-bg, var(--background, ${tok(T.bg)}));
    --_surface: var(--cpk-drawer-surface, var(--card, ${tok(T.surface)}));
    --_surface-fg: var(
      --cpk-drawer-surface-fg,
      var(--card-foreground, ${tok(T["surface-fg"])})
    );
    --_muted: var(--cpk-drawer-muted, var(--muted, ${tok(T.muted)}));
    --_muted-fg: var(
      --cpk-drawer-muted-fg,
      var(--muted-foreground, ${tok(T["muted-fg"])})
    );
    --_accent: var(--cpk-drawer-accent, var(--accent, ${tok(T.accent)}));
    --_accent-fg: var(
      --cpk-drawer-accent-fg,
      var(--accent-foreground, ${tok(T["accent-fg"])})
    );
    --_primary: var(--cpk-drawer-primary, var(--primary, ${tok(T.primary)}));
    --_primary-fg: var(
      --cpk-drawer-primary-fg,
      var(--primary-foreground, ${tok(T["primary-fg"])})
    );
    --_danger: var(--cpk-drawer-danger, var(--destructive, ${tok(T.danger)}));
    --_border: var(--cpk-drawer-border, var(--border, ${tok(T.border)}));
    --_ring: var(--cpk-drawer-ring, var(--ring, ${tok(T.ring)}));
    --_radius: var(--cpk-drawer-radius, var(--radius, ${tok(T.radius)}));
    --_width: var(--cpk-drawer-width, 320px);
    --_rail-width: var(--cpk-drawer-rail-width, 56px);
  }

  :host([hidden]) {
    display: none;
  }

  * {
    box-sizing: border-box;
  }

  .root {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: var(--_width);
    background: var(--_bg);
    border-right: 1px solid var(--_border);
    overflow: hidden;
    transition: width 0.2s ease;
  }

  .root.collapsed {
    width: var(--_rail-width);
  }

  /* Mobile: off-canvas overlay (modal pattern). */
  .root.mobile {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 1000;
    width: min(var(--_width), 85vw);
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    box-shadow: 0 0 0 100vmax transparent;
  }

  .root.mobile.open {
    transform: translateX(0);
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
    background: rgba(0, 0, 0, 0.4);
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
  }

  /* Mobile-only floating affordance to OPEN the off-canvas drawer. Rendered by
     the element itself so phones always have a way in with no host wiring. */
  .launcher {
    position: fixed;
    z-index: 998;
    /* Position is themeable so a host can line the launcher up with its own
       header controls (e.g. vertically centering it on a toggle group). */
    top: var(--cpk-drawer-launcher-top, 12px);
    left: var(--cpk-drawer-launcher-left, 12px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 999px;
    border: 1px solid var(--_border);
    background: var(--_surface);
    color: var(--_surface-fg);
    cursor: pointer;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.12);
  }

  .launcher-icon {
    width: 18px;
    height: 18px;
    display: block;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px;
    border-bottom: 1px solid var(--_border);
  }

  .filters {
    display: flex;
    gap: 4px;
    padding: 8px 12px;
  }

  .filter-btn {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--_border);
    border-radius: var(--_radius);
    background: var(--_bg);
    color: var(--_muted-fg);
    cursor: pointer;
    font: inherit;
  }

  .filter-btn[aria-pressed="true"] {
    background: var(--_accent);
    color: var(--_accent-fg);
    border-color: var(--_ring);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 12px;
    margin: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--_radius);
    cursor: pointer;
    background: transparent;
    color: inherit;
    border: 1px solid transparent;
    opacity: 0;
    transform: translateY(4px);
    animation: cpk-drawer-row-in 0.18s ease forwards;
    /* Positioned so the hovered row can be lifted above later rows (below). */
    position: relative;
  }

  /* The entry animation leaves each row with a (non-none) transform, making it
     its own stacking context — which would paint the name tooltip UNDER the
     following rows (their text bled through the bubble). Lifting the hovered
     row's z-index re-floats its tooltip above the rows beneath it. */
  .row.name-clipped:hover {
    z-index: 2;
  }

  @keyframes cpk-drawer-row-in {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .row.active {
    background: var(--_accent);
    color: var(--_accent-fg);
    border-color: var(--_ring);
  }

  .row.archived .row-name {
    color: var(--_muted-fg);
  }

  .row-name {
    /* The outer name element owns NO overflow clip so it can host the name
       tooltip pseudo-element; the inner .row-name-text does the ellipsis. */
    flex: 1;
    min-width: 0;
    position: relative;
  }

  .row-name-text {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Name tooltip: matches the row-action tooltip (instant primary bubble with
     an arrow), shown ONLY when the name is clipped. Positioned below the name,
     wrapping within the drawer width (a long name can't fit one line). */
  .row-name.name-clipped[data-tooltip]:hover::after {
    content: attr(data-tooltip);
    position: absolute;
    left: 0;
    top: calc(100% + 6px);
    white-space: normal;
    max-width: 240px;
    background: var(--_primary);
    color: var(--_primary-fg);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 12px;
    line-height: 1.4;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.18);
    pointer-events: none;
    z-index: 20;
  }

  .row-name.name-clipped[data-tooltip]:hover::before {
    content: "";
    position: absolute;
    left: 10px;
    top: calc(100% + 1.5px);
    transform: rotate(45deg);
    width: 7px;
    height: 7px;
    background: var(--_primary);
    border-radius: 1px;
    pointer-events: none;
    z-index: 21;
  }

  .row-name.placeholder {
    color: var(--_muted-fg);
    font-style: italic;
  }

  .row-name.revealed {
    animation: cpk-drawer-name-reveal 0.3s ease;
  }

  @keyframes cpk-drawer-name-reveal {
    from {
      opacity: 0.4;
    }
    to {
      opacity: 1;
    }
  }

  .row-action {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    border: 0;
    background: transparent;
    color: var(--_muted-fg);
    cursor: pointer;
    font: inherit;
    padding: 5px;
    border-radius: 6px;
  }

  /* Instant tooltip (matches the react components' delayDuration:0) styled to
     match the CPK standard tooltip: a solid primary-colored bubble with
     primary-foreground text, rounded corners, no border, and a small arrow —
     NOT a surface/bordered box (which reads as a button). Rendered to the LEFT
     of the action so the list's vertical overflow never clips it; the native
     \`title\` tooltip is avoided because its show-delay is browser-fixed (~1.5s)
     and cannot be tuned. */
  .row-action[data-tooltip]:hover::after,
  .row-action[data-tooltip]:focus-visible::after {
    content: attr(data-tooltip);
    position: absolute;
    right: calc(100% + 8px);
    top: 50%;
    transform: translateY(-50%);
    white-space: nowrap;
    background: var(--_primary);
    color: var(--_primary-fg);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 12px;
    line-height: 1.4;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.18);
    pointer-events: none;
    z-index: 20;
  }

  /* Arrow: a small rotated square at the bubble's right edge, pointing at the
     action — same primary fill as the bubble. */
  .row-action[data-tooltip]:hover::before,
  .row-action[data-tooltip]:focus-visible::before {
    content: "";
    position: absolute;
    right: calc(100% + 4.5px);
    top: 50%;
    transform: translateY(-50%) rotate(45deg);
    width: 7px;
    height: 7px;
    background: var(--_primary);
    border-radius: 1px;
    pointer-events: none;
    z-index: 21;
  }

  /* While the delete-confirmation dialog is open, suppress row-action tooltips:
     the clicked trash button keeps :focus-visible (and may stay hovered), which
     would otherwise leave its "Delete" tooltip floating over the dialog. */
  .root.confirming .row-action[data-tooltip]:hover::after,
  .root.confirming .row-action[data-tooltip]:focus-visible::after,
  .root.confirming .row-action[data-tooltip]:hover::before,
  .root.confirming .row-action[data-tooltip]:focus-visible::before {
    content: none;
    display: none;
  }

  .row-action:hover,
  .row-action:focus-visible {
    background: var(--_muted);
    color: inherit;
  }

  .row-action.danger:hover,
  .row-action.danger:focus-visible {
    color: var(--_danger);
  }

  .row-action-icon {
    width: 15px;
    height: 15px;
    display: block;
  }

  button.primary {
    background: var(--_primary);
    color: var(--_primary-fg);
    border: 0;
    border-radius: var(--_radius);
    padding: 8px 12px;
    cursor: pointer;
    font: inherit;
  }

  .state {
    padding: 24px 16px;
    text-align: center;
    color: var(--_muted-fg);
  }

  .state.error {
    color: var(--_danger);
  }

  .fetch-more-error {
    padding: 8px 12px;
    text-align: center;
    color: var(--_danger);
    font-size: 0.9em;
  }

  .load-more {
    display: block;
    width: 100%;
    padding: 8px 12px;
    background: none;
    border: none;
    color: var(--_muted-fg);
    font: inherit;
    font-size: 0.9em;
    cursor: pointer;
  }

  .load-more:hover,
  .load-more:focus-visible {
    color: var(--_surface-fg);
    background: var(--_muted);
  }

  .upsell {
    padding: 24px 16px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .memories {
    border-top: 1px solid var(--_border);
    padding: 8px 12px;
  }

  .memories[hidden] {
    display: none;
  }

  .dialog-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }

  .dialog {
    background: var(--_surface);
    color: var(--_surface-fg);
    border-radius: var(--_radius);
    padding: 16px;
    max-width: 80%;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .footer {
    border-top: 1px solid var(--_border);
    padding: 12px;
  }

  .footer[hidden] {
    display: none;
  }
`;
