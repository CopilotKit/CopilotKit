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
 * Self-contained shadow-DOM styles for `<copilotkit-threads-drawer>`.
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
    font-family: var(
      --cpk-drawer-font-family,
      ui-sans-serif,
      system-ui,
      sans-serif
    );
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
    --_indicator: var(--cpk-drawer-indicator, #5b94e4);
    /* Cap the corner radius at 4px (per designer) — themeable but never larger. */
    --_radius: min(
      var(--cpk-drawer-radius, var(--radius, ${tok(T.radius)})),
      4px
    );
    --_width: var(--cpk-drawer-width, 320px);
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
    /* The confirm-delete dialog no longer needs a positioning context here: it
       is a native <dialog> opened with showModal(), which renders in the
       browser top layer independent of any stacking context (ENT-1051). No
       other direct child of .root is absolutely positioned (the filter and
       row-action popovers anchor to their own positioned ancestors), so .root
       stays static. The mobile path establishes its own context via
       position:fixed. */
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

  /* Desktop collapsed: the panel is replaced by the floating cluster, so remove
     it from the layout entirely. The host reclaims the reserved column via the
     --cpk-drawer-reserved-width:0px override the element sets on collapse. */
  .root.collapsed {
    display: none;
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

  /* Floating launcher cluster (Figma "closed" mockup): a rounded surface card
     holding the sidebar toggle + a "New Conversation" (+) icon button. Rendered
     by the element itself in the mobile-closed AND desktop-collapsed states so
     there is always a way to reopen/expand — and to start a new conversation —
     with no host wiring. */
  .launcher-cluster {
    position: fixed;
    z-index: 998;
    /* Position is themeable so a host can line the cluster up with its own
       header controls (e.g. vertically centering it on a toggle group). */
    top: var(--cpk-drawer-launcher-top, 24px);
    left: var(--cpk-drawer-launcher-left, 24px);
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 6px;
    border-radius: var(--_radius);
    border: 1px solid var(--_border);
    background: var(--_surface);
    color: var(--_surface-fg);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.12);
  }

  .launcher {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 6px;
    border: 0;
    border-radius: calc(var(--_radius) - 3px);
    background: transparent;
    color: var(--_surface-fg);
    cursor: pointer;
    font: inherit;
  }

  .launcher:hover,
  .launcher:focus-visible {
    background: var(--_muted);
  }

  .launcher .icon {
    width: 18px;
    height: 18px;
    display: block;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
  }

  /* The header is hidden until a consumer projects slot="header" content
     (the redesign has no built-in header controls). Mirrors the memories/footer
     gating so an empty padded header bar never renders above the list. */
  .header[hidden] {
    display: none;
  }

  /* Optional consumer projection surface. When a consumer projects into
     slot="header" it fills the header row. */
  .header slot[name="header"] {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
  }

  .icon-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 6px;
    border: 0;
    border-radius: var(--_radius);
    background: transparent;
    color: var(--_muted-fg);
    cursor: pointer;
    font: inherit;
  }

  /* "Filter applied" indicator dot at the funnel's bottom-right (Figma archived
     view). Shown only when a non-default filter is active. */
  .filter-dot {
    position: absolute;
    right: 3px;
    bottom: 4px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--_indicator);
    pointer-events: none;
  }

  .icon-btn:hover,
  .icon-btn:focus-visible {
    background: var(--_muted);
    color: inherit;
  }

  .icon-btn[aria-pressed="true"] {
    background: var(--_muted);
    color: inherit;
  }

  .icon {
    width: 20px;
    height: 20px;
    display: block;
  }

  .new-conversation {
    display: flex;
    align-items: center;
    gap: 12px;
    /* No top margin by default: the header bar (the collapse toggle on desktop,
       the close button on mobile-open) sits above this row and supplies the top
       spacing — the header-hidden case re-adds it below. Horizontal geometry
       matches the list rows: the hover background insets 12px (like a row's
       highlight) and, with 10px inner padding, the icon's left edge lands at
       22px — the same x as the thread names below (list padding 12 + row
       padding 10). */
    margin: 0 12px;
    padding: 8px 10px;
    border: 0;
    border-radius: var(--_radius);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }

  /* Only when the header bar is fully hidden (collapsible=false AND no projected
     header content) is this row the first element — give it the top spacing the
     header would otherwise supply. */
  .header[hidden] + .new-conversation {
    margin-top: 12px;
  }

  .new-conversation:hover,
  .new-conversation:focus-visible {
    background: var(--_muted);
  }

  .new-conversation .icon {
    width: 16px;
    height: 16px;
  }

  .section-heading {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    /* Match the list rows' content edge: "Recent Conversations" lands at 22px
       (margin 12 + padding 10), aligned with the thread names and the New
       Conversation icon; the funnel sits 22px from the right, over the kebabs. */
    padding: 8px 10px;
    margin: 0 12px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--_muted-fg);
    text-transform: none;
  }

  .icon-btn.small {
    width: 24px;
    height: 24px;
    padding: 4px;
  }

  .icon-btn.small .icon {
    width: 16px;
    height: 16px;
  }

  .filter-popover {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 15;
    display: flex;
    flex-direction: column;
    min-width: 120px;
    padding: 4px;
    background: var(--_surface);
    color: var(--_surface-fg);
    border: 1px solid var(--_border);
    border-radius: var(--_radius);
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.18);
  }

  .filter-opt {
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
    padding: 6px 8px;
    border-radius: 4px;
  }

  .filter-opt:hover,
  .filter-opt:focus-visible {
    background: var(--_muted);
  }

  .filter-opt[aria-pressed="true"] {
    font-weight: 600;
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

  /* Lift the interacted row above later rows so its kebab popover (which paints
     inside the row's own transform stacking context) is not clipped by / drawn
     under the rows below it. */
  .row:hover,
  .row:focus-within,
  .row.menu-open {
    z-index: 3;
  }

  /* While a kebab menu is open, the popover only covers part of the rows it
     overlaps, so the rest of the list would still respond to hover — revealing
     other rows' kebabs and (under a host \`::part(row):hover\` theme) painting a
     hover background "through"/around the open menu. Freeze pointer events on
     every OTHER row so the menu reads as a single focused surface. The owner
     row (\`.menu-open\`) and its popover stay interactive, and a pointerdown that
     lands on a frozen row still reaches the document handler that closes the
     menu, so click-away dismissal is preserved. */
  .list.menu-open .row:not(.menu-open) {
    pointer-events: none;
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
    /* No border on the selected row — the background change alone marks it
       (per designer). The base row keeps its 1px transparent border so the
       layout stays stable. */
  }

  .row.archived .row-name {
    color: var(--_muted-fg);
    font-style: italic;
  }

  .row-name {
    flex: 1;
    min-width: 0;
  }

  .row-name-text {
    display: block;
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
    border-radius: 4px;
  }

  .row-action:hover,
  .row-action:focus-visible {
    background: var(--_muted);
    color: inherit;
  }

  .row-action-icon {
    width: 15px;
    height: 15px;
    display: block;
  }

  /* Per-row kebab trigger: hidden at rest, revealed when the row is hovered,
     focused (keyboard), active (selected), or its menu is open. */
  .row-menu {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 4px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--_muted-fg);
    cursor: pointer;
    font: inherit;
    opacity: 0;
  }

  .row:hover .row-menu,
  .row:focus-within .row-menu,
  .row.active .row-menu,
  .row-menu[aria-expanded="true"] {
    opacity: 1;
  }

  .row-menu:hover,
  .row-menu:focus-visible {
    background: var(--_muted);
    color: inherit;
  }

  .row-menu .icon {
    width: 16px;
    height: 16px;
  }

  .row-menu-popover {
    position: absolute;
    right: 8px;
    top: calc(100% - 4px);
    z-index: 16;
    display: flex;
    flex-direction: column;
    min-width: 140px;
    padding: 4px;
    background: var(--_surface);
    color: var(--_surface-fg);
    border: 1px solid var(--_border);
    border-radius: var(--_radius);
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.18);
  }

  /* Rows in the lower portion of the list open their kebab menu UPWARD so it is
     not clipped by the list's overflow scroll box (.list is overflow-y:auto,
     which also clips the x-axis). Anchoring to the button's top edge via
     \`bottom\` keeps the popover inside the list's visible area for bottom rows. */
  .row.menu-up .row-menu-popover {
    top: auto;
    bottom: calc(100% - 4px);
  }

  .row-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
    padding: 6px 8px;
    border-radius: 4px;
  }

  .row-menu-item:hover,
  .row-menu-item:focus-visible {
    background: var(--_muted);
  }

  .row-menu-item.danger:hover,
  .row-menu-item.danger:focus-visible {
    color: var(--_danger);
  }

  .row-menu-item .row-action-icon,
  .row-menu-item .icon {
    width: 15px;
    height: 15px;
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

  .licensed {
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

  /* Confirm-delete dialog — a native <dialog> opened with showModal(). It lives
     in the browser TOP LAYER, so it can never be painted under other UI (the
     old CSS-positioned overlay was trapped in the drawer host's stacking
     context and appeared under the chat's welcome view — ENT-1051). The UA
     centers it in the viewport via margin:auto; we reset the UA chrome and
     apply the drawer's surface-card look. */
  .dialog {
    /* Top-layer (showModal) so it is never clipped, but centered over the DRAWER
       PANEL rather than the viewport: JS sets --confirm-cx/cy from the visible
       .root rect (falls back to viewport-center when unmeasured, e.g. jsdom).
       Width is capped to the drawer band so it reads as "inside the drawer". */
    margin: 0;
    position: fixed;
    left: var(--confirm-cx, 50%);
    top: var(--confirm-cy, 50%);
    transform: translate(-50%, -50%);
    border: 0;
    padding: 16px;
    width: max-content;
    max-width: min(80vw, calc(var(--_width) - 24px));
    background: var(--_surface);
    color: var(--_surface-fg);
    border-radius: var(--_radius);
  }

  /* Only lay out the card contents when open. A closed <dialog> is display:none
     via the UA stylesheet, and author display rules must not override that (or
     an empty box would leak), so the flex layout is scoped to [open]. */
  .dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .dialog::backdrop {
    background: rgba(0, 0, 0, 0.3);
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
