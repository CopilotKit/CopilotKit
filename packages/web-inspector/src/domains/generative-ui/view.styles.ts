import { css } from "lit";

export const generativeUIViewStyles = css`
  :host {
    --gui-ink: #202127;
    --gui-muted: #64656f;
    --gui-line: #dcdce4;
    --gui-soft: #f7f7fa;
    --gui-canvas: #fff;
    --gui-accent: #7567ff;
    --gui-accent-soft: #f0edff;
    --gui-green: #168b69;
    --gui-green-soft: #eaf6f1;
    --gui-amber: #8a5a00;
    --gui-amber-soft: #fff6e0;
    --gui-danger: #a12f2f;
    --gui-danger-soft: #fff4f4;
    --cpk-json-key: #3d408f;
    --cpk-json-str: #0b6b4c;
    --cpk-json-num: #8a5900;
    --cpk-json-bool: #c0333a;
    --cpk-json-nil: #57575b;
    display: block;
    height: 100%;
    overflow: auto;
    color: var(--gui-ink);
    background: var(--gui-canvas);
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    font-size: 12px;
  }
  :host([data-color-scheme="dark"]) {
    color-scheme: dark;
    --gui-ink: #f3f4f8;
    --gui-muted: #b0b3be;
    --gui-line: #3a3e4b;
    --gui-soft: #20232d;
    --gui-canvas: #15171e;
    --gui-accent: #a296ff;
    --gui-accent-soft: #2a2940;
    --gui-green: #4dc69d;
    --gui-green-soft: #172923;
    --gui-amber: #f2c46d;
    --gui-amber-soft: #2f2716;
    --gui-danger: #ffabab;
    --gui-danger-soft: #321f25;
    --cpk-json-key: #bec2ff;
    --cpk-json-str: #85ecce;
    --cpk-json-num: #ffac4d;
    --cpk-json-bool: #fa5f67;
    --cpk-json-nil: #afafb7;
  }
  .header {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 12px 16px 0;
    background: var(--gui-canvas);
    border-bottom: 1px solid var(--gui-line);
  }
  .title-row,
  .row-title,
  .section-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .title-row,
  .row-title {
    align-items: baseline;
  }
  .section-head h3 {
    margin-right: auto;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }
  h3 {
    margin: 0 0 4px;
    font-size: 12px;
    font-weight: 600;
  }
  h4 {
    margin: 12px 0 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--gui-muted);
  }
  p {
    margin: 2px 0 6px;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
  }
  .body {
    padding: 12px 16px 24px;
  }
  section {
    margin-bottom: 20px;
  }
  .muted {
    color: var(--gui-muted);
  }
  .small {
    font-size: 11px;
  }
  .strong {
    font-weight: 600;
    color: var(--gui-ink);
  }
  .warn {
    color: var(--gui-amber);
  }
  .danger {
    color: var(--gui-danger);
  }
  .tabs,
  .segmented {
    display: flex;
    gap: 4px;
    margin-top: 8px;
  }
  .segmented {
    margin: 0 0 8px;
  }
  .tab {
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--gui-muted);
    font: inherit;
    font-weight: 500;
    padding: 6px 8px;
    cursor: pointer;
  }
  .segmented .tab {
    border: 1px solid var(--gui-line);
    border-radius: 6px;
  }
  .tab.active {
    color: var(--gui-ink);
    border-bottom-color: var(--gui-accent);
  }
  .segmented .tab.active {
    border-color: var(--gui-accent);
    background: var(--gui-accent-soft);
  }
  .tab:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .chip {
    display: inline-block;
    border: 1px solid var(--gui-line);
    border-radius: 999px;
    padding: 0 6px;
    font-size: 10px;
    line-height: 16px;
    color: var(--gui-muted);
    background: var(--gui-soft);
  }
  .chip.event {
    color: var(--gui-accent);
    background: var(--gui-accent-soft);
  }
  .status-ready {
    color: var(--gui-green);
    background: var(--gui-green-soft);
  }
  .status-streaming {
    color: var(--gui-accent);
    background: var(--gui-accent-soft);
  }
  .status-error {
    color: var(--gui-danger);
    background: var(--gui-danger-soft);
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid var(--gui-line);
  }
  .row-main {
    flex: 1;
    min-width: 0;
  }
  .card {
    border: 1px solid var(--gui-line);
    border-radius: 8px;
    margin-bottom: 6px;
    overflow: hidden;
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 8px;
  }
  .card-toggle {
    display: flex;
    flex: 1;
    box-sizing: border-box;
    width: 100%;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 8px 10px;
    cursor: pointer;
  }
  .card-toggle:hover {
    background: var(--gui-soft);
  }
  .card-body {
    padding: 8px 10px;
    border-top: 1px solid var(--gui-line);
  }
  .card > .card-body:first-child {
    border-top: 0;
  }
  .button {
    flex-shrink: 0;
    border: 1px solid var(--gui-line);
    border-radius: 6px;
    background: var(--gui-canvas);
    color: var(--gui-ink);
    font: inherit;
    font-size: 11px;
    padding: 2px 8px;
    cursor: pointer;
  }
  .button:hover {
    border-color: var(--gui-accent);
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .filter {
    width: 160px;
    box-sizing: border-box;
    border: 1px solid var(--gui-line);
    border-radius: 6px;
    background: var(--gui-canvas);
    color: var(--gui-ink);
    font: inherit;
    font-size: 11px;
    padding: 3px 6px;
  }
  .catalog-toggle::before {
    content: "▸";
    display: inline-block;
    width: 10px;
    color: var(--gui-muted);
    transition: transform 0.1s;
  }
  .catalog-toggle[aria-expanded="true"]::before {
    transform: rotate(90deg);
  }
  pre {
    margin: 4px 0 0;
    max-height: 320px;
    overflow: auto;
    border-radius: 6px;
    background: var(--gui-soft);
    padding: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }
  pre.prompt {
    max-height: 480px;
  }
  .list,
  .ops {
    margin: 0;
    padding-left: 18px;
  }
  .list li {
    margin-bottom: 4px;
  }
  .ops {
    list-style: none;
    padding: 0;
  }
  .tree {
    list-style: none;
    margin: 0;
    padding-left: 14px;
    border-left: 1px solid var(--gui-line);
  }
  .tree.root {
    padding-left: 0;
    border-left: 0;
  }
  .op-toggle {
    display: flex;
    align-items: baseline;
    gap: 6px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    padding: 2px 0;
    cursor: pointer;
  }
  .empty {
    padding: 48px 24px;
    text-align: center;
    color: var(--gui-muted);
  }
`;
