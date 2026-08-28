import { css } from "lit";

export const threadInspectorDarkStyles = css`
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
