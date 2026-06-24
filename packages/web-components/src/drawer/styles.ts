import { css } from "lit";

/**
 * Scoped styles for `<copilotkit-drawer>`.
 *
 * Theming is driven by CSS custom properties (`--cpk-drawer-*`) that consumers
 * may override from outside the shadow root. Key structural nodes expose
 * `part="..."` attributes so consumers can target them with `::part()`.
 *
 * The `768px` breakpoint matches the SDK sidebar (`CopilotSidebarView`): at or
 * below it the drawer becomes an off-canvas overlay with a backdrop that does
 * NOT push page content; above it the drawer is in-flow and can collapse to a
 * narrow rail.
 */
export const drawerStyles = css`
  :host {
    --cpk-drawer-width: 320px;
    --cpk-drawer-rail-width: 56px;
    --cpk-drawer-bg: #ffffff;
    --cpk-drawer-fg: #1a1a1a;
    --cpk-drawer-muted-fg: #6b7280;
    --cpk-drawer-border: #e5e7eb;
    --cpk-drawer-accent: #6366f1;
    --cpk-drawer-accent-fg: #ffffff;
    --cpk-drawer-row-hover-bg: #f3f4f6;
    --cpk-drawer-row-active-bg: #eef2ff;
    --cpk-drawer-danger: #dc2626;
    --cpk-drawer-backdrop: rgba(0, 0, 0, 0.4);
    --cpk-drawer-radius: 8px;
    --cpk-drawer-transition: 260ms ease;

    display: block;
    box-sizing: border-box;
    color: var(--cpk-drawer-fg);
    font-family:
      system-ui,
      -apple-system,
      "Segoe UI",
      sans-serif;
    font-size: 14px;
  }

  :host *,
  :host *::before,
  :host *::after {
    box-sizing: border-box;
  }

  [hidden] {
    display: none !important;
  }

  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: var(--cpk-drawer-width);
    background: var(--cpk-drawer-bg);
    border-right: 1px solid var(--cpk-drawer-border);
    overflow: hidden;
    transition:
      width var(--cpk-drawer-transition),
      transform var(--cpk-drawer-transition);
  }

  /* Desktop collapse-to-rail: in-flow, just narrows. */
  :host([collapsed]:not([overlay])) .panel {
    width: var(--cpk-drawer-rail-width);
  }

  :host([collapsed]:not([overlay])) .thread-list,
  :host([collapsed]:not([overlay])) .filters,
  :host([collapsed]:not([overlay])) .new-thread,
  :host([collapsed]:not([overlay])) .footer,
  :host([collapsed]:not([overlay])) .title {
    display: none;
  }

  /* Mobile / overlay mode: off-canvas, fixed, with backdrop. */
  :host([overlay]) .panel {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1200;
    height: 100%;
    transform: translateX(-100%);
    pointer-events: none;
    box-shadow: 2px 0 16px rgba(0, 0, 0, 0.15);
  }

  /*
   * A closed overlay panel is moved off-screen and made non-interactive. The
   * panel is also marked \`inert\` + \`aria-hidden\` from the component, but
   * \`visibility: hidden\` is a belt-and-suspenders guarantee that its controls
   * leave the tab order and accessibility tree in environments where \`inert\`
   * is not honored.
   */
  :host([overlay]:not([open])) .panel {
    visibility: hidden;
  }

  :host([overlay][open]) .panel {
    transform: translateX(0);
    pointer-events: auto;
    visibility: visible;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1199;
    background: var(--cpk-drawer-backdrop);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--cpk-drawer-transition);
  }

  :host([overlay][open]) .backdrop {
    opacity: 1;
    pointer-events: auto;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border-bottom: 1px solid var(--cpk-drawer-border);
  }

  .title {
    font-weight: 600;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
    border: none;
    background: transparent;
  }

  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--cpk-drawer-radius);
    color: var(--cpk-drawer-muted-fg);
  }

  .icon-button:hover {
    background: var(--cpk-drawer-row-hover-bg);
  }

  .new-thread {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin: 12px;
    padding: 8px 12px;
    border-radius: var(--cpk-drawer-radius);
    background: var(--cpk-drawer-accent);
    color: var(--cpk-drawer-accent-fg);
    font-weight: 600;
  }

  .filters {
    display: flex;
    gap: 4px;
    padding: 0 12px 8px;
  }

  .filter-button {
    flex: 1;
    padding: 6px 10px;
    border-radius: var(--cpk-drawer-radius);
    color: var(--cpk-drawer-muted-fg);
    border: 1px solid transparent;
  }

  .filter-button[aria-pressed="true"] {
    background: var(--cpk-drawer-row-active-bg);
    color: var(--cpk-drawer-accent);
    border-color: var(--cpk-drawer-accent);
  }

  .thread-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 8px;
    list-style: none;
    margin: 0;
  }

  .thread-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: var(--cpk-drawer-radius);
    cursor: pointer;
  }

  .thread-row:hover {
    background: var(--cpk-drawer-row-hover-bg);
  }

  .thread-row[data-active="true"] {
    background: var(--cpk-drawer-row-active-bg);
  }

  .thread-main {
    flex: 1;
    min-width: 0;
    text-align: left;
    background: transparent;
  }

  .thread-name {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .thread-meta {
    display: block;
    font-size: 12px;
    color: var(--cpk-drawer-muted-fg);
  }

  .row-actions {
    display: flex;
    gap: 2px;
  }

  .row-actions .icon-button {
    width: 28px;
    height: 28px;
  }

  .danger {
    color: var(--cpk-drawer-danger);
  }

  .state {
    padding: 24px 16px;
    text-align: center;
    color: var(--cpk-drawer-muted-fg);
  }

  .error {
    color: var(--cpk-drawer-danger);
  }

  .spinner {
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 2px solid var(--cpk-drawer-border);
    border-top-color: var(--cpk-drawer-accent);
    border-radius: 50%;
    animation: cpk-drawer-spin 0.8s linear infinite;
  }

  @keyframes cpk-drawer-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .upsell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 32px 20px;
    text-align: center;
  }

  .upsell-cta {
    display: inline-block;
    padding: 8px 16px;
    border-radius: var(--cpk-drawer-radius);
    background: var(--cpk-drawer-accent);
    color: var(--cpk-drawer-accent-fg);
    text-decoration: none;
    font-weight: 600;
  }

  .confirm {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }

  .confirm-button {
    padding: 4px 8px;
    border-radius: var(--cpk-drawer-radius);
    font-size: 12px;
    font-weight: 600;
  }

  .confirm-yes {
    background: var(--cpk-drawer-danger);
    color: #ffffff;
  }

  .confirm-no {
    color: var(--cpk-drawer-muted-fg);
  }

  .footer {
    border-top: 1px solid var(--cpk-drawer-border);
  }

  .memories {
    border-top: 1px solid var(--cpk-drawer-border);
  }
`;
