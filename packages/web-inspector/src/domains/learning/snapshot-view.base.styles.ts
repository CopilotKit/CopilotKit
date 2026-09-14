import { css } from "lit";

export const learningSnapshotBaseStyles = css`
    :host {
      --learning-ink: #202127;
      --learning-muted: #64656f;
      --learning-muted-strong: #858690;
      --learning-line: #dcdce4;
      --learning-line-secondary: #cfcfd7;
      --learning-line-accent: #dcd9ff;
      --learning-soft: #f7f7fa;
      --learning-canvas: #fff;
      --learning-surface: #fff;
      --learning-surface-subtle: #fbfbfd;
      --learning-surface-muted: #f8f8fb;
      --learning-surface-hover: #fafaff;
      --learning-purple: #7567ff;
      --learning-purple-dark: #5549e8;
      --learning-soft-purple: #f0edff;
      --learning-purple-border: #cfc8ff;
      --learning-green: #168b69;
      --learning-soft-green: #f7fbf9;
      --learning-green-border: #b9dfd1;
      --learning-soft-danger: #fff4f4;
      --learning-soft-danger-alt: #fff8f8;
      --learning-danger: #7e2929;
      --learning-danger-muted: #8c4a4a;
      --learning-danger-border: #efc7c7;
      --learning-danger-step-border: #d96a6a;
      --learning-track: #e9edf5;
      --learning-step-number: #edf0f5;
      --learning-step-number-ink: #555661;
      --learning-primary: #202127;
      --learning-primary-ink: #fff;
      --learning-secondary: #fff;
      --learning-secondary-ink: #31323a;
      --learning-disabled: #e5e5ea;
      --learning-disabled-ink: #9a9ba3;
      --learning-on-accent: #fff;
      --learning-outcome: #888993;
      --learning-outcome-dash: #cfd0d8;
      --learning-outcome-arrow: #b0b1b9;
      --learning-code: #34353d;
      --learning-dialog-line: #d9d9e1;
      --learning-skeleton-edge: #eeeef2;
      --learning-skeleton-center: #f8f8fa;
      display: block;
      height: 100%;
      overflow: auto;
      color: var(--learning-ink);
      background: var(--learning-canvas);
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }
    :host([data-color-scheme="dark"]) {
      color-scheme: dark;
      --learning-ink: #f3f4f8;
      --learning-muted: #b0b3be;
      --learning-muted-strong: #b8bbc5;
      --learning-line: #3a3e4b;
      --learning-line-secondary: #4c5161;
      --learning-line-accent: #625f95;
      --learning-soft: #20232d;
      --learning-canvas: #15171e;
      --learning-surface: #1a1d25;
      --learning-surface-subtle: #1d2029;
      --learning-surface-muted: #20232d;
      --learning-surface-hover: #252837;
      --learning-purple: #a296ff;
      --learning-purple-dark: #c4baff;
      --learning-soft-purple: #2a2940;
      --learning-purple-border: #625f95;
      --learning-green: #4dc69d;
      --learning-soft-green: #172923;
      --learning-green-border: #28604d;
      --learning-soft-danger: #321f25;
      --learning-soft-danger-alt: #2d2026;
      --learning-danger: #ffabab;
      --learning-danger-muted: #f2b5ba;
      --learning-danger-border: #7a424e;
      --learning-danger-step-border: #a95464;
      --learning-track: #303440;
      --learning-step-number: #303440;
      --learning-step-number-ink: #d8dae4;
      --learning-primary: #f3f4f8;
      --learning-primary-ink: #16181f;
      --learning-secondary: #20232d;
      --learning-secondary-ink: #edf0f6;
      --learning-disabled: #363a46;
      --learning-disabled-ink: #a4a8b5;
      --learning-on-accent: #171920;
      --learning-outcome: #b0b3be;
      --learning-outcome-dash: #545969;
      --learning-outcome-arrow: #858a99;
      --learning-code: #e2e4ec;
      --learning-dialog-line: #484c5a;
      --learning-skeleton-edge: #2a2d38;
      --learning-skeleton-center: #333744;
    }
    * {
      box-sizing: border-box;
    }
    button,
    a,
    summary {
      font: inherit;
    }
    button:focus-visible,
    a:focus-visible,
    summary:focus-visible {
      outline: 2px solid var(--learning-purple);
      outline-offset: 2px;
    }
    .pane-inner {
      max-width: 880px;
      min-height: 100%;
      margin: 0 auto;
      padding: 32px 36px 70px;
    }
    .pane-heading {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 24px;
    }
    .pane-heading h1 {
      margin: 0 0 7px;
      font-size: 25px;
      line-height: 1.2;
      letter-spacing: -0.035em;
    }
    .pane-heading p {
      max-width: 630px;
      margin: 0;
      color: var(--learning-muted);
      font-size: 14px;
      line-height: 1.5;
    }
    .pane-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .refreshing {
      color: var(--learning-muted-strong);
      font-size: 11px;
    }
    .setup-card,
    .analysis-card,
    .content-card {
      border: 1px solid var(--learning-line);
      border-radius: 10px;
      background: var(--learning-surface);
    }
    .setup-card {
      padding: 24px;
      background: var(--learning-surface-subtle);
    }
    .setup-top {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 20px;
    }
    .setup-top h2,
    .analysis-card h2 {
      margin: 0;
      font-size: 19px;
      line-height: 1.25;
      letter-spacing: -0.02em;
    }
    .progress-count {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      font-weight: 750;
      white-space: nowrap;
    }
    .progress-track {
      height: 8px;
      margin: 20px 0 18px;
      overflow: hidden;
      background: var(--learning-track);
      border-radius: 999px;
    }
    .progress-fill {
      height: 100%;
      background: var(--learning-purple);
      border-radius: inherit;
    }
    .steps {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .step {
      min-height: 142px;
      padding: 15px;
      background: var(--learning-surface);
      border: 1px solid var(--learning-line);
      border-radius: 8px;
    }
    .step.current {
      background: var(--learning-soft-purple);
      border-color: var(--learning-purple);
    }
    .step.error {
      background: var(--learning-soft-danger);
      border-color: var(--learning-danger-step-border);
    }
    .step.complete {
      background: var(--learning-soft-green);
      border-color: var(--learning-green-border);
    }
    .step-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 18px;
    }
    .step-number {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      color: var(--learning-step-number-ink);
      background: var(--learning-step-number);
      border-radius: 50%;
      font-size: 12px;
      font-weight: 800;
    }
    .step.current .step-number {
      color: var(--learning-on-accent);
      background: var(--learning-purple);
    }
    .step.complete .step-number {
      color: var(--learning-on-accent);
      background: var(--learning-green);
    }
    .step-state {
      color: var(--learning-danger);
      font-size: 9px;
      font-weight: 850;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .step h3 {
      margin: 0 0 7px;
      font-size: 14px;
    }
    .step p {
      margin: 0;
      color: var(--learning-muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .copy-again {
      margin-top: 12px;
      padding: 0;
      color: var(--learning-secondary-ink);
      background: none;
      border: 0;
      font-size: 11px;
      font-weight: 750;
      text-decoration: underline;
      cursor: pointer;
    }
    .setup-support {
      margin-top: 14px;
    }
    .collection-panel {
      padding: 15px;
      background: var(--learning-surface);
      border: 1px solid var(--learning-line);
      border-radius: 8px;
    }
    .support-heading {
      margin-bottom: 12px;
    }
    .support-heading h3 {
      margin: 0;
      font-size: 13px;
    }
    .error-alert {
      margin-bottom: 10px;
      padding: 11px 12px;
      color: var(--learning-danger);
      background: var(--learning-soft-danger);
      border: 1px solid var(--learning-danger-border);
      border-radius: 6px;
    }
    .error-alert p {
      margin: 0;
      color: var(--learning-danger-muted);
      font-size: 11px;
      line-height: 1.45;
    }
    .prompt-link {
      display: inline-block;
      margin-top: 7px;
      padding: 0;
      color: var(--learning-danger);
      background: none;
      border: 0;
      font-size: 11px;
      font-weight: 750;
      text-decoration: underline;
      cursor: pointer;
    }
    .collection-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 10px;
      background: var(--learning-soft);
      border-radius: 6px;
    }
    .collection-stat {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 9px;
    }
    .captured-count {
      color: var(--learning-ink);
      font-size: 28px;
      line-height: 1;
    }
    .collection-stat span {
      font-size: 12px;
      font-weight: 700;
    }
    .technical-details {
      margin-top: 10px;
      color: var(--learning-muted);
      font-size: 10px;
    }
    .technical-details summary {
      cursor: pointer;
      font-weight: 700;
    }
    .technical-details dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 5px 12px;
      margin: 9px 0 0;
      padding: 10px;
      background: var(--learning-soft);
      border-radius: 5px;
    }
    .technical-details dt {
      color: var(--learning-muted-strong);
    }
    .technical-details dd {
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      overflow-wrap: anywhere;
    }
    .primary,
    .secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      padding: 0 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 750;
      text-decoration: none;
      cursor: pointer;
    }
    .primary {
      color: var(--learning-primary-ink);
      background: var(--learning-primary);
      border: 1px solid var(--learning-primary);
    }
    .secondary {
      color: var(--learning-secondary-ink);
      background: var(--learning-secondary);
      border: 1px solid var(--learning-line-secondary);
    }
    .primary:disabled,
    .primary[aria-disabled="true"] {
      color: var(--learning-disabled-ink);
      background: var(--learning-disabled);
      border-color: var(--learning-disabled);
      cursor: not-allowed;
      pointer-events: none;
    }
    .setup-cta:not(:disabled),
    .results-cta {
      min-width: 170px;
      min-height: 40px;
      padding: 0 18px;
      box-shadow: 0 6px 14px rgba(23, 23, 27, 0.2);
    }
    .outcome-preview {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-top: 16px;
      color: var(--learning-outcome);
      font-size: 11px;
    }
    .outcome-preview span {
      padding: 6px 9px;
      background: var(--learning-surface);
      border: 1px dashed var(--learning-outcome-dash);
      border-radius: 5px;
    }
    .outcome-preview b {
      color: var(--learning-outcome-arrow);
    }
    .analysis-card {
      padding: 18px 20px;
      background: var(--learning-surface-muted);
    }
    .analysis-card.ready {
      background: var(--learning-soft-purple);
      border-color: var(--learning-purple-border);
    }
    .analysis-card.error {
      background: var(--learning-soft-danger-alt);
      border-color: var(--learning-danger-border);
    }
`;
