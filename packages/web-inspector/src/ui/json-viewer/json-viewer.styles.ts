import { css } from "lit";

export const jsonViewerStyles = css`
  :host {
    display: block;
    min-width: 0;
  }

  :host([data-color-scheme="dark"]) {
    --cpk-json-key: #bec2ff;
    --cpk-json-str: #85ecce;
    --cpk-json-num: #ffac4d;
    --cpk-json-bool: #fa5f67;
    --cpk-json-nil: #afafb7;
    --cpk-json-color: #f3f4f8;
    --cpk-json-background: #111319;
    --cpk-json-border: 1px solid #343742;
  }

  .frame {
    position: relative;
    min-width: 0;
  }

  pre,
  code {
    box-sizing: border-box;
    margin: 0;
    max-width: 100%;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: normal;
    font-family: "Spline Sans Mono", ui-monospace, monospace;
    font-size: var(--cpk-json-font-size, 0.75rem);
    line-height: var(--cpk-json-line-height, 1.65);
    color: var(--cpk-json-color, #010507);
  }

  pre {
    padding: var(--cpk-json-padding, 10px 12px);
    border: var(--cpk-json-border, 1px solid #dbdbe5);
    border-block-start: var(--cpk-json-border-block-start);
    border-radius: var(--cpk-json-radius, 8px);
    background: var(--cpk-json-background, #f7f7f9);
  }

  code.inline {
    display: inline-block;
    padding: var(--cpk-json-inline-padding, 0);
  }

  .token--key {
    color: var(--cpk-json-key, #3d408f);
  }

  .token--string {
    color: var(--cpk-json-str, #0b6b4c);
  }

  .token--number {
    color: var(--cpk-json-num, #8a5900);
  }

  .token--boolean {
    color: var(--cpk-json-bool, #c0333a);
  }

  .token--null {
    color: var(--cpk-json-nil, #57575b);
  }

  cpk-inspector-copy-button {
    position: absolute;
    inset-block-start: 6px;
    inset-inline-end: 6px;
  }

  .frame--copyable pre,
  .frame--copyable code.inline {
    padding-inline-end: 64px;
  }
`;
