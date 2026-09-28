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
    color: var(--_fg);

    /* Token resolution, highest priority first:
       1. explicit per-token override (--cpk-drawer-*),
       2. the host app's theme variables. The panel prefers the shadcn/react-core
          SIDEBAR family (--sidebar, --sidebar-accent, …), which exists for
          exactly this surface, and falls back to the generic names
          (--background, --accent, …) for hosts that only define those. Both
          follow the host's light/dark theme by inheritance (custom properties
          are NOT reset by all:initial),
       3. the built-in light default derived from react-core at build time, so a
          host with no theme still renders correctly (self-contained). */
    --_bg: var(
      --cpk-drawer-bg,
      var(--sidebar, var(--background, ${tok(T.sidebar)}))
    );
    --_fg: var(
      --cpk-drawer-fg,
      var(--sidebar-foreground, var(--foreground, ${tok(T["sidebar-fg"])}))
    );
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
    --_accent: var(
      --cpk-drawer-accent,
      var(--sidebar-accent, var(--accent, ${tok(T["sidebar-accent"])}))
    );
    --_accent-fg: var(
      --cpk-drawer-accent-fg,
      var(
        --sidebar-accent-foreground,
        var(--accent-foreground, ${tok(T["sidebar-accent-fg"])})
      )
    );
    --_primary: var(--cpk-drawer-primary, var(--primary, ${tok(T.primary)}));
    --_primary-fg: var(
      --cpk-drawer-primary-fg,
      var(--primary-foreground, ${tok(T["primary-fg"])})
    );
    --_danger: var(--cpk-drawer-danger, var(--destructive, ${tok(T.danger)}));
    --_border: var(
      --cpk-drawer-border,
      var(--sidebar-border, var(--border, ${tok(T["sidebar-border"])}))
    );
    --_ring: var(
      --cpk-drawer-ring,
      var(--sidebar-ring, var(--ring, ${tok(T["sidebar-ring"])}))
    );
    /* Filter-applied dot. Neutral by default so it reads in either theme. */
    --_indicator: var(--cpk-drawer-indicator, var(--_primary));
    /* Hover fill: --cpk-drawer-muted when the host sets it, else the accent. */
    --_hover: var(--cpk-drawer-muted, var(--_accent));
    /* Text sizes derive from --cpk-drawer-font-size (14px by default). */
    --_text: var(--cpk-drawer-font-size, 14px);
    --_text-sm: calc(var(--_text) * 13 / 14);
    --_text-xs: calc(var(--_text) * 12 / 14);
    /* Rows and controls use the theme radius (rounded-lg), capped so a host
       with a very large --radius never turns rows into pills. */
    --_radius: min(
      var(--cpk-drawer-radius, var(--radius, ${tok(T.radius)})),
      12px
    );
    --_radius-sm: max(calc(var(--_radius) - 4px), 4px);
    /* In-flow desktop width. Hosts reserve this column (see the
       --cpk-drawer-reserved-width contract), so it stays at 320px; the
       floating overlay panel defaults narrower (260px). */
    --_width: var(--cpk-drawer-width, 320px);
    --_shadow: var(
      --cpk-drawer-shadow,
      0 16px 48px -12px rgb(0 0 0 / 0.22),
      0 4px 12px -4px rgb(0 0 0 / 0.08)
    );
    --_shadow-menu: var(
      --cpk-drawer-menu-shadow,
      0 8px 24px -6px rgb(0 0 0 / 0.16),
      0 2px 6px -2px rgb(0 0 0 / 0.08)
    );
    --_scrim: var(--cpk-drawer-scrim, rgb(0 0 0 / 0.3));
    --_ease: cubic-bezier(0.32, 0.72, 0, 1);
    --_dur: 280ms;
  }

  :host([hidden]) {
    display: none;
  }

  /* Overlay mode: the host covers its nearest positioned ancestor (e.g. a chat
     popup or sidebar) and the panel slides in from that box's left edge. The
     host itself never intercepts pointer events — only the scrim and the panel
     do, and only while open. */
  :host([overlay]) {
    /* Match the chat modal header's 16px glyphs, so the panel toggle doesn't
       resize when it takes the launcher's place. */
    --_header-icon: 16px;
    position: absolute;
    inset: 0;
    z-index: 50;
    height: auto;
    overflow: hidden;
    pointer-events: none;
  }

  * {
    box-sizing: border-box;
  }

  button {
    -webkit-tap-highlight-color: transparent;
  }

  button:focus-visible,
  .row:focus-visible {
    outline: 2px solid var(--_ring);
    outline-offset: -2px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .root {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: var(--_width);
    background: var(--_bg);
    color: var(--_fg);
    border-right: 1px solid var(--_border);
    overflow: hidden;
    /* The confirm-delete dialog no longer needs a positioning context here: it
       is a native <dialog> opened with showModal(), which renders in the
       browser top layer independent of any stacking context (ENT-1051). No
       other direct child of .root is absolutely positioned (the filter and
       row-action popovers anchor to their own positioned ancestors), so .root
       stays static. The mobile and overlay paths establish their own context
       via position:fixed / position:absolute. */
  }

  /* Mobile: off-canvas overlay (modal pattern), fixed to the viewport. */
  .root.mobile {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 1000;
    width: min(var(--_width), 85vw);
    transform: translateX(-100%);
    box-shadow: none;
    transition:
      transform var(--_dur) var(--_ease),
      box-shadow var(--_dur) var(--_ease);
  }

  .root.mobile.open {
    transform: translateX(0);
    box-shadow: var(--_shadow);
  }

  /* Overlay: off-canvas panel contained by the host's positioned ancestor.
     Hidden (and so unfocusable) once the slide-out finishes. */
  .root.overlay {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 1;
    width: min(var(--cpk-drawer-width, 260px), 85%);
    pointer-events: auto;
    visibility: hidden;
    transform: translateX(-100%);
    box-shadow: none;
    transition:
      transform var(--_dur) var(--_ease),
      box-shadow var(--_dur) var(--_ease),
      visibility 0s linear var(--_dur);
  }

  .root.overlay:focus {
    outline: none;
  }

  .root.overlay.open {
    visibility: visible;
    transform: translateX(0);
    box-shadow: var(--_shadow);
    transition:
      transform var(--_dur) var(--_ease),
      box-shadow var(--_dur) var(--_ease),
      visibility 0s;
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
    background: var(--_scrim);
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
    animation: cpk-drawer-fade-in var(--_dur) ease;
  }

  .backdrop.overlay {
    position: absolute;
    z-index: 0;
    animation: none;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity var(--_dur) ease,
      visibility 0s linear var(--_dur);
  }

  .backdrop.overlay.open {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition:
      opacity var(--_dur) ease,
      visibility 0s;
  }

  .backdrop:focus-visible {
    outline: none;
  }

  @keyframes cpk-drawer-fade-in {
    from {
      opacity: 0;
    }
  }

  /* Floating launcher cluster: a compact card holding the sidebar toggle + a
     "New Thread" icon button. Rendered by the element itself in the
     mobile-closed AND desktop-collapsed states so there is always a way to
     reopen/expand — and to start a new conversation — with no host wiring. */
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
    padding: 4px;
    border-radius: calc(var(--_radius) + 4px);
    border: 1px solid var(--_border);
    background: var(--cpk-drawer-surface, var(--_bg));
    color: var(--cpk-drawer-surface-fg, var(--_fg));
    box-shadow: var(--_shadow-menu);
  }

  .launcher {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: var(--_radius);
    background: transparent;
    color: var(--cpk-drawer-surface-fg, var(--_muted-fg));
    cursor: pointer;
    font: inherit;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }

  .launcher:hover {
    background: var(--_hover);
    color: var(--_accent-fg);
  }

  .launcher .icon {
    width: 18px;
    height: 18px;
    display: block;
  }

  /* One compact top bar: [title] … [panel toggle]. 56px tall to match the
     chat modal header, so in a popup/sidebar overlay it lines up with the
     header behind it. */
  .header {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    min-height: 56px;
    padding: 0 12px;
  }

  /* The title area; consumer slot="header" content replaces the title. */
  .header-slot {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
  }

  .title {
    display: block;
    min-width: 0;
    /* With the header's 12px inset, the title shares the rows' 18px text edge. */
    padding: 0 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--_text);
    font-weight: 600;
    line-height: var(--cpk-drawer-line-height, 20px);
    color: var(--_fg);
  }

  .icon-btn {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: var(--_radius);
    background: transparent;
    color: var(--_muted-fg);
    cursor: pointer;
    font: inherit;
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      opacity 0.15s ease;
  }

  .icon-btn:hover,
  .icon-btn[aria-expanded="true"] {
    background: var(--_hover);
    color: var(--_accent-fg);
  }

  .icon {
    width: 18px;
    height: 18px;
    display: block;
    flex: none;
  }

  .header .icon-btn .icon {
    width: var(--_header-icon, 18px);
    height: var(--_header-icon, 18px);
  }

  .new-conversation {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    /* Rows inset 8px from the panel edge; with the 1px border and 9px inner
       padding the icon and every row's text share the same 18px left edge. */
    margin: 0 8px;
    padding: 0 9px;
    border: 1px dashed var(--_border);
    border-radius: var(--_radius);
    background: transparent;
    color: var(--_fg);
    cursor: pointer;
    font: inherit;
    font-size: var(--_text);
    line-height: var(--cpk-drawer-line-height, 20px);
    text-align: left;
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease;
  }

  .new-conversation:hover {
    border-color: color-mix(in oklab, var(--_fg) 25%, transparent);
    background: var(--_hover);
    color: var(--_accent-fg);
  }

  .section-heading {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 28px;
    margin: 10px 8px 2px;
    padding: 0 4px 0 10px;
  }

  .section-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--_text-xs);
    font-weight: 500;
    line-height: var(--cpk-drawer-line-height, 16px);
    color: var(--_muted-fg);
  }

  .icon-btn.small {
    width: 24px;
    height: 24px;
    border-radius: var(--_radius-sm);
  }

  .icon-btn.small .icon {
    width: 14px;
    height: 14px;
  }

  /* On pointer devices the filter control stays out of the way until the panel
     is hovered or focused (or a filter is applied); touch keeps it visible. */
  @media (hover: hover) {
    .filter-toggle {
      opacity: 0;
    }

    .root:hover .filter-toggle,
    .root:focus-within .filter-toggle,
    .filter-toggle[aria-expanded="true"],
    .filter-toggle.filtered {
      opacity: 1;
    }
  }

  /* "Filter applied" indicator dot at the funnel's bottom-right. Shown only
     when a non-default filter is active. */
  .filter-dot {
    position: absolute;
    right: 2px;
    bottom: 3px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--_indicator);
    box-shadow: 0 0 0 1.5px var(--_bg);
    pointer-events: none;
  }

  .filter-popover {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 15;
    display: flex;
    flex-direction: column;
    min-width: 144px;
    padding: 4px;
    background: var(--_surface);
    color: var(--_surface-fg);
    border: 1px solid var(--_border);
    border-radius: calc(var(--_radius) + 2px);
    box-shadow: var(--_shadow-menu);
    animation: cpk-drawer-pop-in 0.12s ease-out;
  }

  .filter-opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--_radius-sm);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-size: var(--_text);
    text-align: left;
  }

  .filter-opt:hover {
    background: var(--_hover);
    color: var(--_accent-fg);
  }

  .filter-opt[aria-pressed="true"] {
    font-weight: 500;
  }

  .filter-opt .icon {
    width: 14px;
    height: 14px;
  }

  @keyframes cpk-drawer-pop-in {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--_border) transparent;
    padding: 0 8px 12px;
    margin: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .row {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    min-height: 36px;
    padding: 0 4px 0 10px;
    border-radius: var(--_radius);
    cursor: pointer;
    background: transparent;
    color: var(--_fg);
    font-size: var(--_text);
    line-height: var(--cpk-drawer-line-height, 20px);
    user-select: none;
    -webkit-user-select: none;
    opacity: 0;
    transform: translateY(2px);
    animation: cpk-drawer-row-in 0.2s ease-out forwards;
    transition: background-color 0.12s ease;
    /* Positioned so the hovered row can be lifted above later rows (below). */
    position: relative;
  }

  .row:hover,
  .row.menu-open {
    background: var(--_hover);
    color: var(--_accent-fg);
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
    font-weight: 500;
  }

  .row.archived .row-name {
    color: var(--_muted-fg);
    font-style: italic;
  }

  .row-name {
    flex: 1;
    min-width: 0;
  }

  /* Consumer row content projected via slot="row:<id>" takes the name's place. */
  .row > slot::slotted(*) {
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
    border-radius: var(--_radius-sm);
  }

  .row-action:hover {
    background: var(--_hover);
    color: var(--_accent-fg);
  }

  .row-action-icon {
    width: 15px;
    height: 15px;
    display: block;
  }

  /* Per-row "…" trigger: hidden at rest, revealed when the row is hovered,
     focused (keyboard), active (selected), or its menu is open. */
  .row-menu {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: var(--_radius-sm);
    background: transparent;
    color: var(--_muted-fg);
    cursor: pointer;
    font: inherit;
    opacity: 0;
    transition:
      opacity 0.12s ease,
      color 0.12s ease;
  }

  .row:hover .row-menu,
  .row:focus-within .row-menu,
  .row.active .row-menu,
  .row-menu[aria-expanded="true"] {
    opacity: 1;
  }

  /* Touch devices have no hover to reveal it, so keep it visible there. */
  @media (hover: none) {
    .row-menu {
      opacity: 1;
    }
  }

  .row-menu:hover,
  .row-menu[aria-expanded="true"] {
    color: var(--_fg);
  }

  .row-menu .icon {
    width: 16px;
    height: 16px;
  }

  .row-menu-popover {
    position: absolute;
    right: 4px;
    top: calc(100% - 4px);
    z-index: 16;
    display: flex;
    flex-direction: column;
    min-width: 160px;
    padding: 4px;
    background: var(--_surface);
    color: var(--_surface-fg);
    border: 1px solid var(--_border);
    border-radius: calc(var(--_radius) + 2px);
    box-shadow: var(--_shadow-menu);
    font-weight: 400;
    animation: cpk-drawer-pop-in 0.12s ease-out;
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
    gap: 10px;
    min-height: 32px;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-size: var(--_text);
    text-align: left;
    padding: 0 8px;
    border-radius: var(--_radius-sm);
  }

  .row-menu-item:hover {
    background: var(--_hover);
    color: var(--_accent-fg);
  }

  .row-menu-item.danger,
  .row-menu-item.danger:hover {
    color: var(--_danger);
  }

  .row-menu-item .row-action-icon,
  .row-menu-item .icon {
    width: 16px;
    height: 16px;
  }

  button.primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    padding: 0 12px;
    background: var(--_primary);
    color: var(--_primary-fg);
    border: 0;
    border-radius: var(--_radius);
    cursor: pointer;
    font: inherit;
    font-size: var(--_text-sm);
    font-weight: 500;
    transition: opacity 0.15s ease;
  }

  button.primary:hover {
    opacity: 0.88;
  }

  button.primary:focus-visible {
    outline-offset: 2px;
  }

  /* Quiet secondary action (retry). */
  .quiet-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--_border);
    border-radius: var(--_radius-sm);
    background: transparent;
    color: var(--_fg);
    cursor: pointer;
    font: inherit;
    font-size: var(--_text-sm);
    font-weight: 500;
    transition: background-color 0.15s ease;
  }

  .quiet-btn:hover {
    background: var(--_hover);
    color: var(--_accent-fg);
  }

  .quiet-btn .icon {
    width: 14px;
    height: 14px;
  }

  .state {
    margin: 4px 8px 0;
    padding: 8px 10px;
    color: var(--_muted-fg);
    font-size: var(--_text-sm);
    line-height: var(--cpk-drawer-line-height, 18px);
  }

  .state p {
    margin: 0;
  }

  .state.error {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  /* Loading: skeleton rows with a gentle, staggered pulse. The rows follow a
     screen-reader-only <span>, so they are counted with :nth-of-type. */
  .skeleton {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 0 8px;
  }

  .skeleton-row {
    display: flex;
    align-items: center;
    height: 36px;
    padding: 0 10px;
  }

  .skeleton-bar {
    display: block;
    height: 10px;
    width: 72%;
    border-radius: 999px;
    background: var(--_border);
    animation: cpk-drawer-pulse 1.6s ease-in-out infinite;
  }

  .skeleton-row:nth-of-type(2) .skeleton-bar {
    width: 54%;
    animation-delay: 0.12s;
  }
  .skeleton-row:nth-of-type(3) .skeleton-bar {
    width: 84%;
    animation-delay: 0.24s;
  }
  .skeleton-row:nth-of-type(4) .skeleton-bar {
    width: 62%;
    animation-delay: 0.36s;
  }
  .skeleton-row:nth-of-type(5) .skeleton-bar {
    width: 46%;
    animation-delay: 0.48s;
  }
  .skeleton-row:nth-of-type(6) .skeleton-bar {
    width: 68%;
    animation-delay: 0.6s;
  }

  @keyframes cpk-drawer-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.45;
    }
  }

  .fetch-more-error {
    margin: 4px 8px 12px;
    padding: 6px 10px;
    color: var(--_muted-fg);
    font-size: var(--_text-sm);
  }

  .fetch-more-error .row-action {
    padding: 0 2px;
    color: var(--_fg);
    font-size: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .fetch-more-error .row-action:hover {
    background: transparent;
  }

  .load-more {
    display: block;
    flex: none;
    width: calc(100% - 16px);
    min-height: 32px;
    margin: 0 8px 12px;
    padding: 0 10px;
    background: none;
    border: none;
    border-radius: var(--_radius);
    color: var(--_muted-fg);
    font: inherit;
    font-size: var(--_text-sm);
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .load-more:hover {
    color: var(--_accent-fg);
    background: var(--_hover);
  }

  /* Locked (unlicensed): a compact upsell card, not a full-panel block. */
  .licensed {
    padding: 4px 8px 12px;
  }

  .upsell {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 14px;
    border: 1px solid var(--_border);
    border-radius: calc(var(--_radius) + 2px);
    background: var(--_surface);
    color: var(--_surface-fg);
  }

  .upsell-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    margin-bottom: 4px;
    border-radius: var(--_radius-sm);
    background: var(--_accent);
    color: var(--_accent-fg);
  }

  .upsell-icon .icon {
    width: 15px;
    height: 15px;
  }

  .upsell-title {
    margin: 0;
    font-size: var(--_text-sm);
    font-weight: 600;
    line-height: var(--cpk-drawer-line-height, 18px);
  }

  .upsell-text {
    margin: 0;
    font-size: var(--_text-xs);
    line-height: var(--cpk-drawer-line-height, 17px);
    color: var(--_muted-fg);
  }

  .upsell button.primary {
    width: 100%;
    margin-top: 8px;
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
    border: 1px solid var(--_border);
    padding: 16px;
    width: max-content;
    max-width: min(80vw, calc(var(--confirm-band, var(--_width)) - 24px));
    background: var(--_surface);
    color: var(--_surface-fg);
    border-radius: calc(var(--_radius) + 4px);
    box-shadow: var(--_shadow);
    font-size: var(--_text);
    line-height: var(--cpk-drawer-line-height, 20px);
  }

  /* Only lay out the card contents when open. A closed <dialog> is display:none
     via the UA stylesheet, and author display rules must not override that (or
     an empty box would leak), so the flex layout is scoped to [open]. */
  .dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .dialog p {
    margin: 0;
  }

  .dialog::backdrop {
    background: rgba(0, 0, 0, 0.3);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .dialog-actions .row-action {
    height: 32px;
    padding: 0 12px;
    border-radius: var(--_radius);
    color: var(--_fg);
    font-size: var(--_text-sm);
    font-weight: 500;
  }

  .footer {
    border-top: 1px solid var(--_border);
    padding: 12px;
  }

  .footer[hidden] {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      animation-delay: 0s !important;
      transition-duration: 0.01ms !important;
      transition-delay: 0s !important;
    }
  }
`;
