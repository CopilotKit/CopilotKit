import { css } from "lit";

export const threadInspectorStyles = css`
  @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap");

  /* ── Root ────────────────────────────────────────────────────────── */
  :host {
    display: flex;
    flex-direction: row;
    overflow: hidden;
    --cpk-json-key: #3d408f;
    --cpk-json-str: #0b6b4c;
    --cpk-json-num: #8a5900;
    --cpk-json-bool: #c0333a;
    --cpk-json-nil: #57575b;
    --cpk-json-border: none;
    --cpk-json-border-block-start: 1px solid #dbdbe5;
    --cpk-json-radius: 0;
  }

  .cpk-td {
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 13px;
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #ffffff;
  }

  /* ── Left area ───────────────────────────────────────────────────── */
  .cpk-td__left {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Tab bar header ──────────────────────────────────────────────── */
  .cpk-td__tabs-header {
    /* No top/right padding so tabs and toggle sit flush against the
       top and right edges of the inspector. */
    padding: 0 0 0 12px;
    border-bottom: 1px solid #dbdbe5;
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
  }

  .cpk-td__tab-group {
    display: flex;
    gap: 0;
    margin-bottom: -1px;
    /* Allow the tab list to shrink rather than pushing the panel-toggle
       button past the right edge of the inspector when horizontal space
       gets tight (the drawer being open eats noticeably into width). */
    min-width: 0;
    flex-shrink: 1;
    overflow: hidden;
  }

  .cpk-td__tab {
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 11px;
    font-weight: 500;
    padding: 10px 12px;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    background: transparent;
    color: #68686e;
    transition:
      color 0.12s,
      border-color 0.12s;
    white-space: nowrap;
  }

  .cpk-td__tab:hover {
    color: #010507;
  }

  .cpk-td__tab:focus-visible {
    outline: 2px solid #5558b2;
    outline-offset: -3px;
    border-radius: 5px;
  }

  .cpk-td__tab--active {
    color: #010507;
    border-bottom-color: #bec2ff;
  }

  /* Toggle is a separate control, not a tab — so it does NOT use the
     tabs' bottom-border active indicator. Instead, a subtle filled
     state communicates "the drawer is open," and a vertical separator
     on the left visually divorces it from the tab group. */
  .cpk-td__panel-toggle {
    margin-left: auto;
    align-self: stretch;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 12px;
    border: none;
    border-left: 1px solid #dbdbe5;
    background: transparent;
    color: #68686e;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      color 0.12s,
      background 0.12s;
  }
  .cpk-td__panel-toggle:hover {
    color: #010507;
    background: #f4f4f9;
  }
  .cpk-td__panel-toggle--active {
    color: #5558b2;
    background: #eee6fe;
  }
  .cpk-td__panel-toggle--active:hover {
    background: #e4d8fc;
  }

  /* ── Scrollable content ──────────────────────────────────────────── */
  .cpk-td__content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Pin direct children so expanded tool bodies don't get flex-shrunk. */
  .cpk-td__content > * {
    flex-shrink: 0;
  }

  .cpk-td__chrome-actions {
    margin-inline-start: auto;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    padding-inline: 8px;
    min-width: 0;
  }

  .cpk-td__chrome-actions + .cpk-td__panel-toggle {
    margin-inline-start: 0;
  }

  .cpk-td__metadata-strip {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid #e9e9ef;
    background: #fbfbfd;
    flex-shrink: 0;
  }

  .cpk-td__metadata-pills {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    flex-wrap: nowrap;
  }

  .cpk-td__metadata-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 1 1 0;
    min-width: 0;
    height: 24px;
    padding: 0 8px;
    border: 1px solid #dbdbe5;
    border-radius: 6px;
    background: #ffffff;
    color: #57575b;
    font-family: "Spline Sans Mono", monospace;
    font-size: 10px;
    white-space: nowrap;
  }

  .cpk-td__metadata-label {
    color: #68686e;
    text-transform: uppercase;
    font-size: 9px;
  }

  .cpk-td__metadata-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cpk-td__metadata-value--wrap,
  .cpk-td__metadata-pill--wrap {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cpk-td__view-in-app {
    appearance: none;
    flex-shrink: 0;
    margin: 0;
    border: 1px solid #5558b2;
    border-radius: 6px;
    background: #5558b2;
    color: #ffffff;
    font-family: "Spline Sans Mono", monospace;
    font-size: 10px;
    font-weight: 600;
    line-height: 1.2;
    min-height: 24px;
    padding: 3px 8px;
    cursor: pointer;
    transition:
      transform 160ms cubic-bezier(0.23, 1, 0.32, 1),
      background 120ms ease,
      color 120ms ease,
      border-color 120ms ease;
  }

  .cpk-td__view-in-app:focus-visible {
    outline: 2px solid #010507;
    outline-offset: 2px;
  }

  .cpk-td__view-in-app:active {
    transform: scale(0.96);
  }

  .cpk-td__view-in-app--stop {
    background: #ffffff;
    color: #5558b2;
  }

  .cpk-td__view-in-app-error {
    flex-basis: 100%;
    color: #c0333a;
    font-size: 11px;
  }

  @media (prefers-reduced-motion: reduce) {
    .cpk-td__view-in-app {
      transition: none;
    }

    .cpk-td__view-in-app:active {
      transform: none;
    }
  }

  /*
   * Each tab's content is wrapped in this panel so the keep-mounted
   * inactive panels can be hidden via display:none without disturbing
   * the gap between visible siblings. The flex column + gap gives each
   * conversation item / event row breathing room (the cpk-td__content
   * rule above no longer reaches them now that they are nested inside
   * the per-panel wrapper).
   */
  .cpk-td__panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .cpk-td__panel > * {
    flex-shrink: 0;
  }

  .cpk-td__panel[hidden] {
    display: none;
  }

  /* ── Empty state ─────────────────────────────────────────────────── */
  .cpk-td__empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #68686e;
    font-size: 13px;
    padding: 40px 0;
  }

  .cpk-td__empty-hint {
    font-size: 11px;
    color: #68686e;
    text-align: center;
    max-width: 220px;
    line-height: 1.5;
  }

  /* ── Status messages ─────────────────────────────────────────────── */
  .cpk-td__status {
    padding: 16px;
    font-size: 12px;
    color: #68686e;
    text-align: center;
  }

  .cpk-td__status--error {
    color: #c0333a;
  }

  @keyframes cpk-td-focus-pulse {
    0% {
      outline-color: rgba(100, 48, 171, 0);
      box-shadow: 0 0 0 rgba(100, 48, 171, 0);
      animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
    }
    24%,
    50% {
      outline-color: rgba(100, 48, 171, 0.78);
      box-shadow: 0 7px 20px rgba(100, 48, 171, 0.2);
    }
    100% {
      outline-color: rgba(100, 48, 171, 0);
      box-shadow: 0 0 0 rgba(100, 48, 171, 0);
    }
  }

  .cpk-td__focus-pulse {
    position: relative;
    z-index: 1;
    outline: 2px solid transparent;
    outline-offset: 3px;
    animation: cpk-td-focus-pulse 760ms linear;
  }

  @media (prefers-reduced-motion: reduce) {
    .cpk-td__focus-pulse {
      animation-duration: 320ms;
    }
  }

  /* ── Conversation bubbles ────────────────────────────────────────── */
  .cpk-td__bubble {
    display: flex;
    margin-bottom: 2px;
  }

  .cpk-td__bubble--user {
    justify-content: flex-end;
  }

  .cpk-td__bubble--assistant {
    justify-content: flex-start;
  }

  .cpk-td__bubble-inner {
    padding: 9px 14px;
    max-width: 75%;
    font-size: 13px;
    line-height: 1.55;
  }

  .cpk-td__bubble-inner--user {
    background: #eee6fe;
    color: #57575b;
    border-radius: 12px 12px 4px 12px;
  }

  .cpk-td__show-more {
    display: inline-block;
    margin-top: 4px;
    font-size: 11px;
    font-weight: 500;
    color: #57575b;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .cpk-td__bubble-inner--assistant {
    background: #f7f7f9;
    color: #010507;
    border-radius: 12px 12px 12px 4px;
    border: 1px solid #e9e9ef;
  }

  /* ── Tool call blocks ────────────────────────────────────────────── */
  .cpk-td__tool-block {
    border: 1px solid #e9e9ef;
    border-radius: 7px;
    overflow: hidden;
  }

  .cpk-td__tool-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: rgba(133, 236, 206, 0.15);
    cursor: pointer;
    font-size: 11px;
    user-select: none;
  }

  .cpk-td__tool-header:hover {
    background: rgba(133, 236, 206, 0.22);
  }

  .cpk-td__tool-name {
    font-family: "Spline Sans Mono", monospace;
    font-size: 10px;
    font-weight: 500;
    color: #087653;
    text-transform: uppercase;
    flex: 1;
  }

  .cpk-td__tool-status {
    font-family: "Spline Sans Mono", monospace;
    font-size: 9px;
    text-transform: uppercase;
    color: #087653;
  }

  .cpk-td__tool-status--pending {
    color: #8a5900;
  }

  .cpk-td__tool-chevron {
    color: #68686e;
    font-size: 10px;
  }

  .cpk-td__tool-body {
    padding: 8px 10px;
    border-top: 1px solid #e9e9ef;
    background: #ffffff;
  }

  .cpk-td__tool-section-label {
    font-family: "Spline Sans Mono", monospace;
    font-size: 9px;
    font-weight: 500;
    color: #68686e;
    text-transform: uppercase;
    margin-bottom: 4px;
    letter-spacing: 0.3px;
  }

  .cpk-td__tool-pre {
    margin: 0;
    font-family: "Spline Sans Mono", monospace;
    font-size: 12px;
    background: #f7f7f9;
    padding: 10px 12px;
    border-radius: 6px;
    overflow-x: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
    color: #010507;
    line-height: 1.65;
  }

  /* ── Tool call group ─────────────────────────────────────────────── */
  .cpk-td__tool-group {
    border: 1px solid #e9e9ef;
    border-radius: 7px;
    overflow: hidden;
  }

  .cpk-td__tool-group-header {
    padding: 5px 10px;
    background: rgba(133, 236, 206, 0.15);
    font-family: "Spline Sans Mono", monospace;
    font-size: 10px;
    color: #087653;
    text-transform: uppercase;
    font-weight: 500;
    border-bottom: 1px solid #e9e9ef;
  }

  .cpk-td__tool-group .cpk-td__tool-block {
    border: none;
    border-bottom: 1px solid #e9e9ef;
    border-radius: 0;
  }

  .cpk-td__tool-group .cpk-td__tool-block:last-child {
    border-bottom: none;
  }

  /* ── Inline chips (reasoning / state update) ─────────────────────── */
  .cpk-td__inline-chip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
    color: #68686e;
    font-family: "Spline Sans Mono", monospace;
    font-size: 9px;
    text-transform: uppercase;
  }

  .cpk-td__inline-chip::before,
  .cpk-td__inline-chip::after {
    content: "";
    flex: 1;
    height: 1px;
    background: #e9e9ef;
  }

  /* ── Interaction timeline ───────────────────────────────────────── */
  .cpk-td__timeline-item {
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    overflow: hidden;
  }

  .cpk-td__timeline-item--run,
  .cpk-td__timeline-item--state,
  .cpk-td__timeline-item--event,
  .cpk-td__timeline-item--tool,
  .cpk-td__event--run,
  .cpk-td__event--event,
  .cpk-td__event--state,
  .cpk-td__event--message,
  .cpk-td__event--tool {
    border-color: #dbdbe5;
    background: #ffffff;
  }

  .cpk-td__timeline-item--message {
    border-color: #dbdbe5;
    background: #ffffff;
    box-shadow: 0 1px 2px #0105070d;
  }

  .cpk-td__timeline-item--warning {
    border-color: rgba(250, 95, 103, 0.35);
    background: rgba(250, 95, 103, 0.04);
  }

  .cpk-td__timeline-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: transparent;
  }

  .cpk-td__timeline-item--message .cpk-td__timeline-header {
    padding: 10px 12px;
    background: #f7f7f9;
  }

  .cpk-td__timeline-item--user .cpk-td__timeline-header {
    background: #bec2ff1a;
  }

  .cpk-td__timeline-item--assistant .cpk-td__timeline-header {
    background: #85ecce1a;
  }

  .cpk-td__timeline-kind {
    display: inline-flex;
    align-items: center;
    padding: 4px 8px;
    border-radius: 999px;
    background: #f0f0f4;
    color: #57575b;
    font-family: "Spline Sans Mono", monospace;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    line-height: 1.2;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .cpk-td__timeline-item--message .cpk-td__timeline-kind {
    background: #bec2ff33;
    color: #010507;
  }

  .cpk-td__timeline-item--assistant .cpk-td__timeline-kind {
    background: #85ecce4d;
    color: #010507;
  }

  .cpk-td__timeline-item--warning .cpk-td__timeline-kind {
    background: rgba(250, 95, 103, 0.16);
    color: #c0333a;
  }

  .cpk-td__timeline-title {
    flex: 1;
    min-width: 0;
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: #57575b;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cpk-td__timeline-item--message .cpk-td__timeline-title {
    font-size: 13px;
    font-weight: 600;
    color: #010507;
  }

  .cpk-td__timeline-time {
    font-family: "Spline Sans Mono", monospace;
    font-size: 9px;
    color: #68686e;
    flex-shrink: 0;
  }

  .cpk-td__timeline-body {
    margin: 0;
    padding: 0 10px 9px;
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 12px;
    line-height: 1.55;
    color: #57575b;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .cpk-td__timeline-item--message .cpk-td__timeline-body {
    padding: 0 12px 12px;
    font-size: 13px;
    color: #010507;
  }

  .cpk-td__timeline-toolbar {
    display: flex;
    gap: 6px;
  }

  .cpk-td__timeline-bulk-toggle {
    margin: 0;
    padding: 6px 10px;
    border: 1px solid #dbdbe5;
    border-radius: 8px;
    background: #ffffff;
    color: #36363a;
    cursor: pointer;
    font-family: "Spline Sans Mono", monospace;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
  }

  .cpk-td__timeline-bulk-toggle:hover {
    border-color: rgba(85, 88, 178, 0.38);
    background: #f7f7ff;
    color: #010507;
  }

  .cpk-td__timeline-bulk-toggle:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .cpk-td__source-link {
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: #5558b2;
    cursor: pointer;
    font-family: "Spline Sans Mono", monospace;
    font-size: 9px;
    text-decoration: underline;
    text-underline-offset: 2px;
    flex-shrink: 0;
  }

  .cpk-td__source-link:hover {
    color: #010507;
  }

  .cpk-td__timeline-details-toggle {
    margin: 0;
    padding: 5px 10px;
    border: none;
    background: #ffffff;
    color: #5558b2;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: "Inter", sans-serif;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
    width: 100%;
  }

  .cpk-td__timeline-details-toggle:hover {
    background: #f7f7ff;
    color: #010507;
  }

  .cpk-td__timeline-details-toggle svg {
    width: 12px;
    height: 12px;
    stroke-width: 2;
  }

  /* ── Generative UI ──────────────────────────────────────────────── */
  @keyframes cpk-genui-enter {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .cpk-td__genui {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px 16px 8px;
    animation: cpk-genui-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  .cpk-td__genui-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 5px;
    background: #eee6fe;
    color: #57575b;
    font-size: 10px;
    font-weight: 600;
    align-self: flex-start;
  }

  .cpk-td__genui-card {
    overflow: hidden;
    border-radius: 14px;
    border: 1px solid #e2e8f0;
    background: #fff;
    box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.08);
  }

  .cpk-td__genui-placeholder {
    padding: 8px 12px;
    border-radius: 10px;
    border: 1px solid #ede9fe;
    background: #f5f3ff;
    color: #7c3aed;
    font-size: 11px;
  }

  /* ── AG-UI Events ────────────────────────────────────────────────── */
  .cpk-td__event {
    flex-shrink: 0;
    border: 1px solid #dbdbe5;
    border-radius: 10px;
    background: #ffffff;
    overflow: hidden;
    /*
     * content-visibility: auto lets the browser skip layout + paint for
     * off-screen events while keeping them in the DOM (so scroll size
     * stays correct). Without this, switching back to AG-UI Events on a
     * thread with hundreds of events triggers a full layout pass over
     * every event row, which on Martha's intelligence-backed example
     * shows up as a multi-second freeze each time the panel becomes
     * visible. The intrinsic-size hint avoids the visible jump as the
     * browser swaps in real heights when items scroll into view.
     */
    content-visibility: auto;
    contain-intrinsic-size: 0 80px;
  }

  .cpk-td__event--error {
    border-color: rgba(250, 95, 103, 0.35);
    background: rgba(250, 95, 103, 0.04);
  }

  .cpk-td__event-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: transparent;
  }

  .cpk-td__event-type {
    display: inline-flex;
    align-items: center;
    padding: 4px 8px;
    border-radius: 999px;
    background: #f0f0f4;
    color: #010507;
    font-family: "Spline Sans Mono", monospace;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    line-height: 1.2;
  }

  .cpk-td__event--message .cpk-td__event-type {
    background: #bec2ff33;
  }

  .cpk-td__event--tool .cpk-td__event-type {
    background: #85ecce4d;
  }

  .cpk-td__event--error .cpk-td__event-type {
    background: rgba(250, 95, 103, 0.16);
    color: #c0333a;
  }

  .cpk-td__event-time {
    margin-inline-start: auto;
    font-family: "Spline Sans Mono", monospace;
    font-size: 9px;
    color: #68686e;
    flex-shrink: 0;
  }

  /* ── Resize divider ──────────────────────────────────────────────── */
  /* Floats over the drawer's left edge so the toggle and the drawer
     touch directly without a 4px flex-gap between them. The hit zone
     is wider than its visual hint to make it easy to grab. */
  .cpk-td__detail-divider {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    width: 7px;
    cursor: col-resize;
    background: transparent;
    z-index: 5;
  }

  .cpk-td__detail-divider:hover {
    background: rgba(190, 194, 255, 0.3);
  }

  /* ── Right detail panel ──────────────────────────────────────────── */
  .cpk-td__detail {
    flex-shrink: 0;
    overflow: hidden;
    background: #f7f7f9;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0;
    box-sizing: border-box;
    position: relative;
    /* Slide open/closed via width + padding transition. When closed,
       width and padding are 0 so the drawer fully collapses. */
    transition:
      width 220ms cubic-bezier(0.4, 0, 0.2, 1),
      padding 220ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .cpk-td__detail[data-open="true"] {
    overflow-y: auto;
    padding: 16px;
  }

  .cpk-tdp__section-title {
    font-family: "Spline Sans Mono", monospace;
    font-size: 10px;
    font-weight: 500;
    color: #68686e;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-bottom: 8px;
  }

  .cpk-tdp__divider {
    height: 1px;
    background: #dbdbe5;
    margin: 14px 0;
  }

  .cpk-tdp__row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 3px 0;
    gap: 8px;
  }

  .cpk-tdp__label {
    color: #68686e;
    font-size: 11px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .cpk-tdp__value {
    color: #010507;
    font-family: "Spline Sans Mono", monospace;
    font-size: 11px;
    text-align: right;
    min-width: 0;
  }

  .cpk-tdp__value--truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 130px;
  }

  .cpk-tdp__value--wrap {
    white-space: normal;
    word-break: break-all;
    text-align: right;
  }

  :host([data-color-scheme="dark"]) {
    color-scheme: dark;
    --cpk-json-key: #bec2ff;
    --cpk-json-str: #85ecce;
    --cpk-json-num: #ffac4d;
    --cpk-json-bool: #fa5f67;
    --cpk-json-nil: #afafb7;
    --cpk-json-background: #111319;
    --cpk-json-color: #f3f4f8;
    --cpk-json-border-block-start: 1px solid #343742;
  }

  :host([data-color-scheme="dark"]) .cpk-td {
    background: #111319;
    color: #f3f4f8;
  }

  :host([data-color-scheme="dark"]) .cpk-td__tabs-header,
  :host([data-color-scheme="dark"]) .cpk-td__panel-toggle,
  :host([data-color-scheme="dark"]) .cpk-td__metadata-strip,
  :host([data-color-scheme="dark"]) .cpk-td__metadata-pill,
  :host([data-color-scheme="dark"]) .cpk-td__tool-block,
  :host([data-color-scheme="dark"]) .cpk-td__tool-header,
  :host([data-color-scheme="dark"]) .cpk-td__tool-body,
  :host([data-color-scheme="dark"]) .cpk-td__event,
  :host([data-color-scheme="dark"]) .cpk-td__event-payload,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-item,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-bulk-toggle,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-details-toggle {
    border-color: #343742;
  }

  :host([data-color-scheme="dark"]) .cpk-td__metadata-strip,
  :host([data-color-scheme="dark"]) .cpk-td__detail {
    background: #15171e;
  }

  :host([data-color-scheme="dark"]) .cpk-td__metadata-pill,
  :host([data-color-scheme="dark"]) .cpk-td__bubble-inner--assistant,
  :host([data-color-scheme="dark"]) .cpk-td__tool-block,
  :host([data-color-scheme="dark"]) .cpk-td__event,
  :host([data-color-scheme="dark"]) .cpk-td__genui-card,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-item,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-bulk-toggle,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-details-toggle {
    border-color: #343742;
    background: #191c24;
  }

  :host([data-color-scheme="dark"]) .cpk-td__timeline-header,
  :host([data-color-scheme="dark"]) .cpk-td__tool-body {
    background: #171a22;
  }

  :host([data-color-scheme="dark"]) .cpk-td__tool-pre {
    background: #111319;
    color: #f3f4f8;
  }

  :host([data-color-scheme="dark"]) .cpk-td__panel-toggle:hover,
  :host([data-color-scheme="dark"]) .cpk-td__tool-header:hover,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-bulk-toggle:hover,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-details-toggle:hover {
    background: #20232d;
  }

  :host([data-color-scheme="dark"]) .cpk-td__panel-toggle--active,
  :host([data-color-scheme="dark"]) .cpk-td__inline-chip,
  :host([data-color-scheme="dark"]) .cpk-td__genui-badge {
    background: #302b43;
    color: #d8d9ff;
  }

  :host([data-color-scheme="dark"]) .cpk-td__timeline-item--message {
    background: #191c24;
    border-color: #343742;
    box-shadow: none;
  }

  :host([data-color-scheme="dark"])
    .cpk-td__timeline-item--user
    .cpk-td__timeline-header {
    background: #bec2ff1a;
  }

  :host([data-color-scheme="dark"])
    .cpk-td__timeline-item--assistant
    .cpk-td__timeline-header {
    background: #85ecce1a;
  }

  :host([data-color-scheme="dark"])
    .cpk-td__timeline-item--message
    .cpk-td__timeline-kind {
    background: #302b43;
    color: #d8d9ff;
  }

  :host([data-color-scheme="dark"])
    .cpk-td__timeline-item--assistant
    .cpk-td__timeline-kind {
    background: #1a3a32;
    color: #85ecce;
  }

  :host([data-color-scheme="dark"]) .cpk-td__timeline-item--run,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-item--event,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-item--state,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-item--tool,
  :host([data-color-scheme="dark"]) .cpk-td__event--run,
  :host([data-color-scheme="dark"]) .cpk-td__event--event,
  :host([data-color-scheme="dark"]) .cpk-td__event--state,
  :host([data-color-scheme="dark"]) .cpk-td__event--message,
  :host([data-color-scheme="dark"]) .cpk-td__event--tool {
    background: #191c24;
    border-color: #343742;
  }

  :host([data-color-scheme="dark"])
    .cpk-td__timeline-item--run
    .cpk-td__timeline-header,
  :host([data-color-scheme="dark"])
    .cpk-td__timeline-item--event
    .cpk-td__timeline-header,
  :host([data-color-scheme="dark"])
    .cpk-td__timeline-item--state
    .cpk-td__timeline-header {
    background: transparent;
  }

  :host([data-color-scheme="dark"]) .cpk-td__timeline-kind {
    background: #20232d;
    color: #aeb1bd;
  }

  :host([data-color-scheme="dark"])
    .cpk-td__timeline-item--run
    .cpk-td__timeline-title,
  :host([data-color-scheme="dark"])
    .cpk-td__timeline-item--event
    .cpk-td__timeline-title,
  :host([data-color-scheme="dark"])
    .cpk-td__timeline-item--state
    .cpk-td__timeline-title {
    color: #aeb1bd;
  }

  :host([data-color-scheme="dark"]) .cpk-td__event-header {
    background: transparent;
  }

  :host([data-color-scheme="dark"]) .cpk-td__event-type {
    background: #20232d;
    color: #f3f4f8;
  }

  :host([data-color-scheme="dark"]) .cpk-td__event--message .cpk-td__event-type {
    background: #302b43;
    color: #d8d9ff;
  }

  :host([data-color-scheme="dark"]) .cpk-td__event--tool .cpk-td__event-type {
    background: #1a3a32;
    color: #85ecce;
  }

  :host([data-color-scheme="dark"]) .cpk-td__event--error .cpk-td__event-type {
    background: rgba(250, 95, 103, 0.2);
    color: #fa5f67;
  }

  :host([data-color-scheme="dark"])
    .cpk-td__timeline-item--message
    .cpk-td__timeline-body {
    color: #f3f4f8;
  }

  :host([data-color-scheme="dark"]) .cpk-td__tab,
  :host([data-color-scheme="dark"]) .cpk-td__panel-toggle,
  :host([data-color-scheme="dark"]) .cpk-td__metadata-label,
  :host([data-color-scheme="dark"]) .cpk-td__event-time,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-time,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-body,
  :host([data-color-scheme="dark"]) .cpk-tdp__label,
  :host([data-color-scheme="dark"]) .cpk-tdp__section-title {
    color: #aeb1bd;
  }

  :host([data-color-scheme="dark"]) .cpk-td__tab:hover,
  :host([data-color-scheme="dark"]) .cpk-td__tab--active,
  :host([data-color-scheme="dark"]) .cpk-td__metadata-value,
  :host([data-color-scheme="dark"]) .cpk-td__tool-name,
  :host([data-color-scheme="dark"]) .cpk-td__tool-pre,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-title,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-bulk-toggle,
  :host([data-color-scheme="dark"]) .cpk-td__timeline-details-toggle,
  :host([data-color-scheme="dark"]) .cpk-tdp__value {
    color: #f3f4f8;
  }

  :host([data-color-scheme="dark"]) .cpk-tdp__divider {
    background: #343742;
  }
`;
