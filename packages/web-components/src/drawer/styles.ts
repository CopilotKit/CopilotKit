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
    box-sizing: border-box;
    font-family:
      var(--cpk-drawer-font-family, ui-sans-serif, system-ui, sans-serif);
    font-size: var(--cpk-drawer-font-size, 14px);
    line-height: var(--cpk-drawer-line-height, 1.4);
    color: var(--cpk-drawer-fg, ${tok(T.fg)});

    --_bg: var(--cpk-drawer-bg, ${tok(T.bg)});
    --_surface: var(--cpk-drawer-surface, ${tok(T.surface)});
    --_surface-fg: var(--cpk-drawer-surface-fg, ${tok(T["surface-fg"])});
    --_muted: var(--cpk-drawer-muted, ${tok(T.muted)});
    --_muted-fg: var(--cpk-drawer-muted-fg, ${tok(T["muted-fg"])});
    --_accent: var(--cpk-drawer-accent, ${tok(T.accent)});
    --_accent-fg: var(--cpk-drawer-accent-fg, ${tok(T["accent-fg"])});
    --_primary: var(--cpk-drawer-primary, ${tok(T.primary)});
    --_primary-fg: var(--cpk-drawer-primary-fg, ${tok(T["primary-fg"])});
    --_danger: var(--cpk-drawer-danger, ${tok(T.danger)});
    --_border: var(--cpk-drawer-border, ${tok(T.border)});
    --_ring: var(--cpk-drawer-ring, ${tok(T.ring)});
    --_radius: var(--cpk-drawer-radius, ${tok(T.radius)});
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
    overflow-y: auto;
    padding: 8px;
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
    text-decoration: line-through;
    color: var(--_muted-fg);
  }

  .row-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    border: 0;
    background: transparent;
    color: var(--_muted-fg);
    cursor: pointer;
    font: inherit;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .row-action.danger {
    color: var(--_danger);
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
`;
