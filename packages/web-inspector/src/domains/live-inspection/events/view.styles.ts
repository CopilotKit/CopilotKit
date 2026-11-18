import { css } from "lit";

export const liveInspectionViewStyles = css`
  .live-inspection-control:focus-visible {
    outline: 2px solid #5558b2;
    outline-offset: 2px;
  }

  .event-column-resizer {
    position: absolute;
    inset-block: 0;
    inset-inline-end: -12px;
    z-index: 2;
    width: 24px;
    min-width: 24px;
    border: 0;
    background: transparent;
    cursor: col-resize;
    touch-action: none;
  }

  .event-column-resizer:focus-visible {
    background: #bec2ff;
  }

  .event-expansion-button {
    display: block;
    width: 100%;
    min-height: 32px;
    border: 0;
    background: transparent;
    padding: 8px 12px;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .event-expanded-payload {
    padding: 8px 12px;
  }

  .event-collapse-button {
    min-height: 24px;
    margin-block-end: 6px;
    border: 0;
    background: transparent;
    padding: 2px 0;
    color: #57575b;
    font: inherit;
    cursor: pointer;
  }

  .cpk-section-card {
    overflow: hidden;
    border-radius: 10px;
    background: #ffffff;
  }

  .cpk-agent-icon {
    background-color: #f0f0f4 !important;
    color: #57575b !important;
  }

  .cpk-stat-card {
    border: 1px solid #dbdbe5 !important;
    background-color: #ffffff !important;
  }

  button.cpk-stat-card:hover {
    background-color: #f7f7f9 !important;
  }

  .cpk-agent-messages-head {
    border-bottom: 1px solid #e4e4ec;
  }

  .cpk-agent-message-row + .cpk-agent-message-row {
    border-top: 1px solid #e4e4ec;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-agent-overview,
  .inspector-window[data-color-scheme="dark"] .cpk-section-card {
    border-color: #3a3d49 !important;
    background-color: #191c24 !important;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-agent-icon {
    background-color: #292b43 !important;
    color: #d8d9ff !important;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-stat-card {
    border-color: #464957 !important;
    background-color: #191c24 !important;
  }

  .inspector-window[data-color-scheme="dark"] button.cpk-stat-card:hover {
    background-color: #20232d !important;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-agent-messages-head,
  .inspector-window[data-color-scheme="dark"]
    .cpk-agent-message-row
    + .cpk-agent-message-row {
    border-color: #3a3d49 !important;
  }

  @media (prefers-reduced-motion: reduce) {
    .live-inspection-control,
    .live-inspection-control * {
      animation: none !important;
      transition: none !important;
    }
  }
`;
