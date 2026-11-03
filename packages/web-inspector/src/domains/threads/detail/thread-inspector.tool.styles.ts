import { css } from "lit";

/* Tool activity stays compact in the conversation; raw data is opt-in. */
export const threadInspectorToolStyles = css`
  .cpk-td__tool-block {
    min-width: 0;
  }
  .cpk-td__tool-block:has(> .cpk-td__tool-header[aria-expanded="true"]) {
    border-radius: 10px;
    overflow: hidden;
    background: #ffffff;
    box-shadow: 0 0 0 1px oklch(0 0 0 / 0.08);
  }
  .cpk-td__tool-header {
    appearance: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: transparent;
    color: #68686e;
    cursor: pointer;
    width: 100%;
    border: 0;
    font-family: inherit;
    text-align: left;
    font-size: 12px;
  }
  .cpk-td__tool-header > svg {
    flex-shrink: 0;
  }
  .cpk-td__tool-header:focus-visible {
    outline: 2px solid var(--cpk-primary-color, #7076b3);
    outline-offset: -2px;
  }
  .cpk-td__tool-header:hover {
    background: #f7f7f9;
    border-radius: 8px;
  }
  .cpk-td__tool-block:has(> .cpk-td__tool-header[aria-expanded="true"])
    .cpk-td__tool-header:hover {
    border-radius: 0;
  }
  .cpk-td__tool-copy {
    flex: 1;
    min-width: 0;
  }
  .cpk-td__tool-title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    min-width: 0;
  }
  .cpk-td__tool-name {
    font-size: 13px;
    font-weight: 500;
    line-height: 1.6;
    color: #57575b;
    overflow-wrap: anywhere;
  }
  .cpk-td__tool-status {
    display: block;
    font-size: 11px;
    line-height: 1.6;
    color: #68686e;
  }
  .cpk-td__tool-status--pending {
    color: #8a5900;
  }
  .cpk-td__tool-chevron {
    flex-shrink: 0;
    transition: transform 150ms;
  }
  .cpk-td__tool-header[aria-expanded="true"] .cpk-td__tool-chevron {
    transform: rotate(90deg);
  }
  .cpk-td__tool-name--streaming {
    width: fit-content;
    background: linear-gradient(100deg, #68686e 35%, #c9c9d5 50%, #68686e 65%);
    background-size: 250% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
    animation: cpk-tool-shimmer 2s linear infinite;
  }
  @keyframes cpk-tool-shimmer {
    from {
      background-position: 150% 0;
    }
    to {
      background-position: -100% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cpk-td__tool-name--streaming {
      animation: none;
      background: none;
      color: inherit;
    }
    .cpk-td__tool-chevron {
      transition: none;
    }
  }
  .cpk-td__tool-body {
    min-width: 0;
    padding-top: 4px;
    border-top: 1px solid #e9e9ef;
  }
  .cpk-td__tool-identifier {
    margin-left: 0.35em;
    color: #68686e;
    font:
      11px/1.6 "Spline Sans Mono",
      monospace;
    overflow-wrap: anywhere;
  }
  .cpk-td__tool-data {
    display: grid;
    gap: 0;
  }
  .cpk-td__tool-section-label {
    font-family: "Plus Jakarta Sans", sans-serif;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.65;
    color: #68686e;
    margin: 0;
    padding: 8px 12px;
  }
  .cpk-td__tool-body cpk-inspector-json-viewer {
    --cpk-json-font-size: 12px;
    --cpk-json-line-height: 1.65;
  }
  .cpk-td__tool-result {
    border-top: 1px solid #e9e9ef;
  }
  .cpk-td__tool-group {
    min-width: 0;
  }
  .cpk-td__tool-group-header {
    padding: 4px 12px;
    font-size: 11px;
    color: #68686e;
  }
  .cpk-td__tool-group .cpk-td__tool-block {
    margin-left: 12px;
  }

  :host([data-color-scheme="dark"]) .cpk-td__tool-header {
    background: transparent;
  }
  :host([data-color-scheme="dark"])
    .cpk-td__tool-block:has(> .cpk-td__tool-header[aria-expanded="true"]) {
    background: #191c24;
    box-shadow: 0 0 0 1px oklch(1 0 0 / 0.12);
  }
  :host([data-color-scheme="dark"]) .cpk-td__tool-body,
  :host([data-color-scheme="dark"]) .cpk-td__tool-result {
    border-top-color: #343742;
  }
  :host([data-color-scheme="dark"]) .cpk-td__tool-header:hover {
    background: #20232d;
  }
  :host([data-color-scheme="dark"]) .cpk-td__tool-name {
    color: #f4f4f5;
  }
  :host([data-color-scheme="dark"]) .cpk-td__tool-status--pending {
    color: #fbbf24;
  }
  :host([data-color-scheme="dark"]) .cpk-td__tool-status,
  :host([data-color-scheme="dark"]) .cpk-td__tool-section-label,
  :host([data-color-scheme="dark"]) .cpk-td__tool-identifier,
  :host([data-color-scheme="dark"]) .cpk-td__tool-group-header {
    color: #aeb1bd;
  }
  :host([data-color-scheme="dark"]) .cpk-td__tool-name--streaming {
    color: transparent;
    background-image: linear-gradient(
      100deg,
      #aeb1bd 35%,
      #ffffff 50%,
      #aeb1bd 65%
    );
  }
  @media (prefers-reduced-motion: reduce) {
    :host([data-color-scheme="dark"]) .cpk-td__tool-name--streaming {
      background: none;
      color: #f3f4f8;
    }
  }
`;
