import { css } from "lit";

export const threadInspectorDetailStyles = css`
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
`;
