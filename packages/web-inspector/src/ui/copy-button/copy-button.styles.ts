import { css } from "lit";

export const copyButtonStyles = css`
  :host {
    display: inline-flex;
    font-family: "Plus Jakarta Sans", system-ui, sans-serif;
  }

  button {
    min-width: 24px;
    min-height: 24px;
    box-sizing: border-box;
    border: 1px solid var(--cpk-copy-border, #d8d8e8);
    border-radius: var(--cpk-copy-radius, 6px);
    padding: var(--cpk-copy-padding, 3px 8px);
    background: var(--cpk-copy-background, #ffffff);
    color: var(--cpk-copy-color, #57575b);
    font: inherit;
    font-size: var(--cpk-copy-font-size, 0.6875rem);
    font-weight: var(--cpk-copy-font-weight, 600);
    line-height: 1.35;
    cursor: pointer;
  }

  button:hover {
    border-color: var(--cpk-copy-hover-border, var(--cpk-copy-border, #d8d8e8));
    background: var(--cpk-copy-hover-background, #f1f1f6);
    color: var(--cpk-copy-hover-color, #010507);
  }

  button:focus-visible {
    outline: 2px solid var(--cpk-copy-focus, #6857ff);
    outline-offset: 2px;
  }

  button[data-state="copied"] {
    border-color: var(--cpk-copy-success-border, #9edac7);
    background: var(--cpk-copy-success-background, #eaf8f3);
    color: var(--cpk-copy-success-color, #0b6b4c);
  }

  button[data-state="error"] {
    border-color: var(--cpk-copy-error-border, #f2a5aa);
    color: var(--cpk-copy-error-color, #9f252c);
  }

  button.icon {
    display: inline-flex;
    width: 28px;
    height: 28px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-color: transparent;
    background: transparent;
  }

  svg {
    width: 14px;
    height: 14px;
  }

  .status {
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

  :host([data-color-scheme="dark"]) button {
    --cpk-copy-border: #454956;
    --cpk-copy-background: #1d2028;
    --cpk-copy-color: #d5d7df;
    --cpk-copy-hover-background: #292d37;
    --cpk-copy-hover-color: #ffffff;
  }

  @media (forced-colors: active) {
    button:focus-visible {
      outline-color: Highlight;
    }
  }
`;
