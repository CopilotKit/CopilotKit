import { css } from "lit";

export const learningViewStyles = css`
  .cpk-memory-locked {
    position: relative;
    display: flex;
    height: 100%;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background-color: #ffffff;
    padding: 32px;
  }

  .cpk-locked-preview {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: minmax(180px, 28%) 1fr;
    overflow: hidden;
    opacity: 0.58;
    pointer-events: none;
  }

  .cpk-locked-preview-sidebar {
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-right: 1px solid #dbdbe5;
    background-color: #fafafa;
    padding: 28px 24px;
  }

  .cpk-locked-preview-row {
    border-radius: 10px;
    background-color: #ffffff;
    box-shadow: inset 0 0 0 1px #eeeef4;
    padding: 12px;
  }

  .cpk-locked-preview-row[data-accent="true"] {
    background-color: #eee6fe;
  }

  .cpk-locked-preview-bar {
    border-radius: 999px;
    background-color: #d7d7df;
  }

  .cpk-locked-preview-row-title {
    width: var(--preview-width);
    height: 8px;
  }

  .cpk-locked-preview-row[data-accent="true"] .cpk-locked-preview-row-title {
    background-color: #a984f5;
  }

  .cpk-locked-preview-row-line {
    width: 88%;
    height: 6px;
    margin-top: 10px;
    background-color: #e3e3eb;
  }

  .cpk-locked-preview-row-line:last-child {
    width: 62%;
    margin-top: 7px;
    background-color: #e8e8ef;
  }

  .cpk-locked-preview-main {
    min-width: 0;
    background-color: #ffffff;
    padding: 42px 48px;
  }

  .cpk-locked-preview-heading {
    width: 180px;
    height: 10px;
  }

  .cpk-locked-preview-copy {
    width: min(520px, 58%);
    height: 8px;
    margin-top: 28px;
    background-color: #e3e3eb;
  }

  .cpk-locked-preview-copy + .cpk-locked-preview-copy {
    width: min(430px, 48%);
    margin-top: 12px;
    background-color: #e8e8ef;
  }

  .cpk-locked-preview-cards {
    display: grid;
    max-width: 620px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin-top: 30px;
  }

  .cpk-locked-preview-card {
    height: 116px;
    border-radius: 10px;
    background-color: #f5f5f8;
    box-shadow: inset 0 0 0 1px #eeeef4;
  }

  .cpk-locked-preview-footer-line {
    width: min(680px, 74%);
    height: 10px;
    margin-top: 34px;
    background-color: #e3e3eb;
  }

  .cpk-locked-preview-footer-line + .cpk-locked-preview-footer-line {
    width: min(560px, 60%);
    margin-top: 14px;
    background-color: #e8e8ef;
  }

  .cpk-memory-locked-scrim {
    position: absolute;
    inset: 0;
    background: radial-gradient(
      circle at center,
      rgba(255, 255, 255, 0.9) 0,
      rgba(255, 255, 255, 0.78) 24%,
      rgba(255, 255, 255, 0.34) 48%,
      rgba(255, 255, 255, 0.56) 100%
    );
    pointer-events: none;
  }

  .cpk-memory-locked-content {
    position: relative;
    z-index: 1;
    max-width: 440px;
    color: #57575b;
    text-align: center;
  }

  .cpk-memory-locked-icon-wrap {
    display: flex;
    justify-content: center;
    margin: 0 auto 18px;
  }

  .cpk-memory-locked-icon {
    display: flex;
    width: 44px;
    height: 44px;
    align-items: center;
    justify-content: center;
    border: 1px solid #dfd6fb;
    border-radius: 10px;
    background-color: #eee6fe;
    color: #57575b;
    box-shadow: 0 8px 18px rgba(87, 87, 91, 0.14);
  }

  .cpk-memory-locked-title {
    margin: 0 0 8px;
    color: #010507;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.35;
  }

  .cpk-memory-locked-copy {
    max-width: 380px;
    margin: 0 auto 18px;
    color: #57575b;
    font-size: 13px;
    line-height: 1.55;
  }

  .cpk-memory-locked-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .cpk-memory-locked-action {
    display: inline-flex;
    min-height: 34px;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid #6430ab;
    border-radius: 5px;
    background-color: #6430ab;
    padding: 8px 12px;
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    text-decoration: none;
  }

  .cpk-memory-locked-action:hover {
    border-color: #4e238c;
    background-color: #4e238c;
  }

  .cpk-memory-locked-action-secondary {
    border-color: #dbdbe5;
    background-color: #ffffff;
    color: #57575b;
  }

  .cpk-memory-locked-action-secondary:hover {
    border-color: #afafb7;
    background-color: #f7f7f9;
  }

  .cpk-learning-state {
    display: flex;
    height: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #68686e;
  }

  .cpk-learning-state--error,
  .cpk-learning-state--error .cpk-learning-state-copy {
    color: #c0333a;
  }

  .cpk-learning-state-title {
    font-size: 13px;
  }

  .cpk-learning-state-copy {
    max-width: 320px;
    color: #c0333a;
    font-size: 11px;
    line-height: 1.5;
    text-align: center;
  }

  .cpk-learning-shell {
    display: flex;
    height: 100%;
    flex-direction: column;
    overflow: hidden;
  }

  .cpk-learning-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .cpk-learning-header-status {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .cpk-learning-realtime {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #68686e;
    font-size: 10px;
    font-weight: 500;
  }

  .cpk-learning-realtime[data-connected="true"] {
    color: #57575b;
  }

  .cpk-learning-realtime-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .cpk-learning-count {
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.07);
    padding: 1px 7px;
    color: #57575b;
    font-size: 11px;
    font-weight: 500;
  }

  .cpk-learning-inline-error {
    display: flex;
    flex-shrink: 0;
    align-items: flex-start;
    gap: 8px;
    border-bottom: 1px solid #f1c7c9;
    background: #fdf3f3;
    padding: 8px 12px;
    color: #c0333a;
    font-size: 12px;
    line-height: 1.45;
  }

  .cpk-learning-inline-error-icon {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .cpk-learning-list {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .cpk-memory-locked-action:focus-visible {
    outline: 2px solid #6366f1;
    outline-offset: 2px;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-memory-locked {
    background-color: #111319;
    color: #f3f4f8;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-locked-preview-sidebar {
    border-color: #2f323d;
    background-color: #15171e;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-locked-preview-main {
    background-color: #111319;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-locked-preview-row {
    background-color: #191c24;
    box-shadow: inset 0 0 0 1px #2f323d;
  }

  .inspector-window[data-color-scheme="dark"]
    .cpk-locked-preview-row[data-accent="true"] {
    background-color: #292b43;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-locked-preview-bar {
    background-color: #333641;
  }

  .inspector-window[data-color-scheme="dark"]
    .cpk-locked-preview-row[data-accent="true"]
    .cpk-locked-preview-row-title {
    background-color: #777aae;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-locked-preview-row-line,
  .inspector-window[data-color-scheme="dark"] .cpk-locked-preview-copy,
  .inspector-window[data-color-scheme="dark"] .cpk-locked-preview-footer-line {
    background-color: #2f323d;
  }

  .inspector-window[data-color-scheme="dark"]
    .cpk-locked-preview-row-line:last-child,
  .inspector-window[data-color-scheme="dark"]
    .cpk-locked-preview-copy
    + .cpk-locked-preview-copy,
  .inspector-window[data-color-scheme="dark"]
    .cpk-locked-preview-footer-line
    + .cpk-locked-preview-footer-line {
    background-color: #292c36;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-locked-preview-card {
    background-color: #191c24;
    box-shadow: inset 0 0 0 1px #2f323d;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-memory-locked-scrim {
    background: radial-gradient(
      circle at center,
      rgba(17, 19, 25, 0.94) 0,
      rgba(17, 19, 25, 0.84) 24%,
      rgba(17, 19, 25, 0.46) 48%,
      rgba(17, 19, 25, 0.68) 100%
    );
  }

  .inspector-window[data-color-scheme="dark"] .cpk-memory-locked-content,
  .inspector-window[data-color-scheme="dark"] .cpk-memory-locked-copy {
    color: #aeb1bd;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-memory-locked-title {
    color: #f3f4f8;
  }

  .inspector-window[data-color-scheme="dark"] .cpk-memory-locked-icon {
    border-color: #666a9e;
    background-color: #292b43;
    color: #d8d9ff;
    box-shadow: none;
  }

  .inspector-window[data-color-scheme="dark"]
    .cpk-memory-locked-action-secondary {
    border-color: #464957;
    background-color: #191c24;
    color: #d8d9ff;
  }

  .inspector-window[data-color-scheme="dark"]
    .cpk-memory-locked-action-secondary:hover {
    border-color: #777aae;
    background-color: #242731;
    color: #ffffff;
  }
`;
