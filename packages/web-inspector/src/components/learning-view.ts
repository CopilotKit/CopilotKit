import { LitElement, css, html, nothing } from "lit";
import type {
  InspectorLearningInsight,
  InspectorLearningSnapshotV1,
} from "@copilotkit/shared";

export type LearningViewState =
  | "unsupported"
  | "loading"
  | "error"
  | "selection_required"
  | "invalid"
  | "results"
  | "first_run"
  | "ready"
  | "empty"
  | "setup"
  | "landing";

export function deriveLearningViewState(input: {
  readonly supported: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly snapshot: InspectorLearningSnapshotV1 | null;
  readonly setupActive: boolean;
}): LearningViewState {
  if (!input.supported) return "unsupported";
  if (!input.snapshot && input.loading) return "loading";
  if (!input.snapshot && input.error) return "error";
  const snapshot = input.snapshot;
  if (!snapshot) return "loading";
  if (snapshot.configuration.state === "selection_required")
    return "selection_required";
  if (snapshot.configuration.state === "invalid") return "invalid";
  const hasResults =
    snapshot.skillsPage.total > 0 || snapshot.insightsPage.total > 0;
  if (hasResults || snapshot.pendingCandidateCount > 0) return "results";
  if (snapshot.run.hasActiveRun) return "first_run";
  if (snapshot.run.hasEverSucceeded && snapshot.pendingThreadCount === 0)
    return "empty";
  if (
    snapshot.configuration.state === "configured" &&
    snapshot.pendingThreadCount > 0
  )
    return "ready";
  if (input.setupActive || snapshot.configuration.state === "configured")
    return "setup";
  return "landing";
}

export class CpkLearningView extends LitElement {
  static properties = {
    supported: { type: Boolean },
    loading: { type: Boolean },
    refreshing: { type: Boolean },
    error: { attribute: false },
    snapshot: { attribute: false },
    setupActive: { type: Boolean },
    copyState: { attribute: false },
    setupPrompt: { attribute: false },
  };

  supported = false;
  loading = false;
  refreshing = false;
  error: string | null = null;
  snapshot: InspectorLearningSnapshotV1 | null = null;
  setupActive = false;
  copyState: "idle" | "copied" | "error" = "idle";
  setupPrompt = "";
  private promptOpen = false;
  private expandedSkillId: string | null = null;
  private selectedInsightId: string | null = null;
  private skillPageKey = "";

  static styles = css`
    :host {
      --learning-ink: #202127;
      --learning-muted: #64656f;
      --learning-line: #dcdce4;
      --learning-soft: #f7f7fa;
      --learning-purple: #7567ff;
      --learning-purple-dark: #5549e8;
      --learning-soft-purple: #f0edff;
      --learning-green: #168b69;
      display: block;
      height: 100%;
      overflow: auto;
      color: var(--learning-ink);
      background: #fff;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
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
    .refreshing {
      color: #858690;
      font-size: 11px;
    }
    .setup-card,
    .analysis-card,
    .content-card {
      border: 1px solid var(--learning-line);
      border-radius: 10px;
      background: #fff;
    }
    .setup-card {
      padding: 24px;
      background: #fbfbfd;
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
      background: #e9edf5;
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
      background: #fff;
      border: 1px solid var(--learning-line);
      border-radius: 8px;
    }
    .step.current {
      background: var(--learning-soft-purple);
      border-color: var(--learning-purple);
    }
    .step.error {
      background: #fff4f4;
      border-color: #d96a6a;
    }
    .step.complete {
      background: #f7fbf9;
      border-color: #b9dfd1;
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
      color: #555661;
      background: #edf0f5;
      border-radius: 50%;
      font-size: 12px;
      font-weight: 800;
    }
    .step.current .step-number {
      color: #fff;
      background: var(--learning-purple);
    }
    .step.complete .step-number {
      color: #fff;
      background: var(--learning-green);
    }
    .step-state {
      color: #a33a3a;
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
    .setup-support {
      margin-top: 14px;
    }
    .collection-panel {
      padding: 15px;
      background: #fff;
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
      color: #7e2929;
      background: #fff4f4;
      border: 1px solid #efc7c7;
      border-radius: 6px;
    }
    .error-alert p {
      margin: 0;
      color: #8c4a4a;
      font-size: 11px;
      line-height: 1.45;
    }
    .prompt-link {
      display: inline-block;
      margin-top: 7px;
      padding: 0;
      color: #7e2929;
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
      color: #62636d;
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
      color: #8a8b94;
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
      color: #fff;
      background: #202127;
      border: 1px solid #202127;
    }
    .secondary {
      color: #31323a;
      background: #fff;
      border: 1px solid #cfcfd7;
    }
    .primary:disabled,
    .primary[aria-disabled="true"] {
      color: #9a9ba3;
      background: #e5e5ea;
      border-color: #e5e5ea;
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
      color: #888993;
      font-size: 11px;
    }
    .outcome-preview span {
      padding: 6px 9px;
      background: #fff;
      border: 1px dashed #cfd0d8;
      border-radius: 5px;
    }
    .outcome-preview b {
      color: #b0b1b9;
    }
    .analysis-card {
      padding: 18px 20px;
      background: #f8f8fb;
    }
    .analysis-card.ready {
      background: #f5f3ff;
      border-color: #cfc8ff;
    }
    .analysis-card.error {
      background: #fff8f8;
      border-color: #efc7c7;
    }
    .analysis-row {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .analysis-copy {
      flex: 1;
    }
    .analysis-card h2 {
      margin-bottom: 7px;
    }
    .analysis-card p {
      margin: 0;
      color: var(--learning-muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .eyebrow {
      margin: 0 0 6px !important;
      color: var(--learning-purple-dark) !important;
      font-size: 10px !important;
      font-weight: 850;
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }
    .retry-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 12px;
      padding: 11px 12px;
      color: #7e2929;
      background: #fff4f4;
      border: 1px solid #efc7c7;
      border-radius: 6px;
      font-size: 11px;
    }
    .result-section {
      margin-top: 14px;
    }
    .result-section-heading {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-bottom: 10px;
    }
    .result-section-heading h2 {
      margin: 0;
      font-size: 14px;
    }
    .result-count {
      color: #8c8d96;
      font-size: 10px;
      font-weight: 700;
    }
    .review-link {
      margin-left: auto;
      color: var(--learning-purple-dark);
      font-size: 11px;
      font-weight: 750;
      text-decoration: none;
    }
    .quiet-link {
      display: inline-flex;
      margin-top: 12px;
      color: var(--learning-purple-dark);
      font-size: 11px;
      font-weight: 750;
      text-decoration: none;
    }
    .quiet-link:hover,
    .review-link:hover {
      text-decoration: underline;
    }
    .content-card {
      overflow: hidden;
    }
    .empty-card {
      padding: 24px;
      color: var(--learning-muted);
      background: #fbfbfd;
      border: 1px solid var(--learning-line);
      border-radius: 8px;
    }
    .empty-card.compact {
      padding: 15px 16px;
    }
    .empty-card h3 {
      margin: 0 0 6px;
      color: var(--learning-ink);
      font-size: 14px;
    }
    .empty-card p {
      margin: 0;
      font-size: 12px;
      line-height: 1.5;
    }
    .active-skill {
      padding: 16px;
    }
    .active-skill + .active-skill {
      border-top: 1px solid var(--learning-line);
    }
    .active-skill h3 {
      margin: 0 0 6px;
      font-size: 14px;
    }
    .active-skill > p {
      margin: 0;
      color: var(--learning-muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .skill-lineage {
      margin-top: 10px;
      padding: 10px 12px;
      background: #f8f8fb;
      border: 1px solid var(--learning-line);
      border-radius: 6px;
    }
    .skill-lineage > span {
      display: block;
      margin-bottom: 5px;
      color: #858690;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .skill-lineage button {
      display: flex;
      width: 100%;
      align-items: start;
      justify-content: space-between;
      gap: 14px;
      padding: 0;
      color: var(--learning-ink);
      background: none;
      border: 0;
      text-align: left;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.4;
      cursor: pointer;
    }
    .skill-lineage button small {
      flex: 0 0 auto;
      color: var(--learning-purple-dark);
      font-size: 10px;
      font-weight: 750;
    }
    .supporting-unavailable {
      color: #858690;
      font-size: 11px;
      font-style: italic;
    }
    .skill-source {
      margin-top: 10px;
    }
    .skill-source summary {
      width: fit-content;
      color: var(--learning-purple-dark);
      cursor: pointer;
      font-size: 11px;
      font-weight: 750;
    }
    .skill-source pre {
      margin: 10px 0 0;
      padding: 12px;
      color: #34353d;
      background: var(--learning-soft);
      border: 1px solid var(--learning-line);
      border-radius: 6px;
      font:
        11px/1.5 ui-monospace,
        SFMono-Regular,
        Menlo,
        Monaco,
        Consolas,
        monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .list-header {
      display: flex;
      align-items: center;
      padding: 10px 14px;
      color: #858690;
      background: #f8f8fa;
      border-bottom: 1px solid var(--learning-line);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .list-header span:last-child {
      margin-left: auto;
    }
    .insight-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      width: 100%;
      padding: 16px;
      color: inherit;
      background: #fff;
      border: 0;
      border-bottom: 1px solid var(--learning-line);
      text-align: left;
      cursor: pointer;
    }
    .insight-row:last-child {
      border-bottom: 0;
    }
    .insight-row:hover,
    .insight-row[data-selected="true"] {
      background: #fafaff;
    }
    .insight-row h3 {
      margin: 0 0 6px;
      font-size: 14px;
      line-height: 1.35;
    }
    .insight-row p {
      margin: 0;
      color: var(--learning-muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .evidence-count {
      min-width: 90px;
      color: var(--learning-purple-dark);
      font-size: 11px;
      font-weight: 750;
      text-align: right;
    }
    .detail-panel {
      margin-top: 14px;
      padding: 18px;
      background: #fafaff;
      border: 1px solid #dcd9ff;
      border-radius: 8px;
    }
    .detail-head {
      display: flex;
      align-items: start;
      gap: 14px;
    }
    .detail-head div {
      flex: 1;
    }
    .detail-head h3 {
      margin: 0 0 5px;
      font-size: 14px;
    }
    .detail-head p {
      margin: 0;
      color: var(--learning-muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .close-detail {
      width: 28px;
      height: 28px;
      color: #666771;
      background: #fff;
      border: 1px solid var(--learning-line);
      border-radius: 5px;
      cursor: pointer;
    }
    .evidence-list {
      display: grid;
      gap: 7px;
      margin-top: 14px;
    }
    .evidence-link,
    .evidence-unavailable {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 38px;
      padding: 10px;
      color: #34353d;
      background: #fff;
      border: 1px solid var(--learning-line);
      border-radius: 6px;
      font-size: 11px;
      text-align: left;
    }
    .evidence-link {
      width: 100%;
      cursor: pointer;
    }
    .evidence-link span {
      margin-left: auto;
      color: #898a93;
    }
    .evidence-unavailable {
      color: #858690;
      font-style: italic;
    }
    .pagination {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 10px;
    }
    .pagination span {
      margin-right: auto;
      color: var(--learning-muted);
      font-size: 11px;
    }
    .pagination button {
      min-height: 30px;
      padding: 0 10px;
      color: var(--learning-ink);
      background: #fff;
      border: 1px solid var(--learning-line);
      border-radius: 5px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
    }
    .pagination button:disabled {
      color: #aaaab2;
      background: #f6f6f8;
      cursor: default;
    }
    .skeleton {
      display: grid;
      gap: 10px;
    }
    .skeleton span {
      height: 74px;
      background: linear-gradient(90deg, #eeeef2, #f8f8fa, #eeeef2);
      background-size: 200% 100%;
      border-radius: 8px;
      animation: shimmer 1.3s infinite;
    }
    @keyframes shimmer {
      to {
        background-position: -200% 0;
      }
    }
    .dialog-backdrop {
      position: fixed;
      z-index: 50;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(15, 15, 20, 0.42);
    }
    .dialog {
      display: flex;
      width: min(620px, 100%);
      max-height: min(680px, 90vh);
      flex-direction: column;
      background: #fff;
      border: 1px solid #d9d9e1;
      border-radius: 13px;
      box-shadow: 0 22px 70px rgba(0, 0, 0, 0.22);
    }
    .dialog header {
      display: flex;
      align-items: start;
      justify-content: space-between;
      padding: 18px 19px 13px;
    }
    .dialog h2 {
      margin: 0;
      font-size: 16px;
    }
    .dialog header p {
      margin: 4px 0 0;
      color: #6d6d75;
      font-size: 11px;
    }
    .dialog-close {
      color: #777;
      background: transparent;
      border: 0;
      font-size: 20px;
      cursor: pointer;
    }
    .dialog pre {
      max-height: 420px;
      overflow: auto;
      margin: 0 19px;
      padding: 12px;
      background: var(--learning-soft);
      border: 1px solid var(--learning-line);
      border-radius: 6px;
      font:
        11px/1.5 ui-monospace,
        SFMono-Regular,
        Menlo,
        monospace;
      white-space: pre-wrap;
    }
    .dialog footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 14px 19px 18px;
    }
    .copy-error {
      margin: 10px 19px 0;
      color: #7e2929;
      font-size: 11px;
    }
    @media (max-width: 900px) {
      .steps {
        grid-template-columns: 1fr;
      }
      .step {
        min-height: auto;
      }
    }
    @media (max-width: 640px) {
      .pane-inner {
        padding: 24px 18px 60px;
      }
      .analysis-row,
      .collection-summary {
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .insight-row {
        grid-template-columns: 1fr;
        gap: 8px;
      }
      .evidence-count {
        text-align: left;
      }
      .review-link {
        width: 100%;
        margin: 4px 0 0;
      }
    }
  `;

  private emit(name: string, detail?: unknown) {
    this.dispatchEvent(
      new CustomEvent(name, { detail, bubbles: true, composed: true }),
    );
  }

  private externalLink(
    url: string | null,
    label: string,
    className = "primary",
    category: "learning" | "runs" | "candidates" = "learning",
  ) {
    return url
      ? html`<a
          class=${className}
          href=${url}
          target="_blank"
          rel="noopener noreferrer"
          @click=${() => this.emit("learning-web-link", { category })}
          >${label}</a
        >`
      : nothing;
  }

  private openPrompt() {
    this.promptOpen = true;
    this.requestUpdate();
  }

  private setupPromptButton(label = "Copy the setup prompt") {
    return html`<button
      class="primary"
      type="button"
      @click=${() =>
        label === "Open the setup prompt"
          ? this.openPrompt()
          : this.emit("learning-copy-setup")}
    >
      ${this.copyState === "copied" ? "Prompt copied" : label}
    </button>`;
  }

  private renderSetupProgress(
    mode: "setup" | "ready" | "running" | "attention",
  ) {
    const ready = mode === "ready";
    const running = mode === "running";
    const attention = mode === "attention";
    const completedSteps = ready || running ? 2 : 1;
    const pendingThreads = ready ? (this.snapshot?.pendingThreadCount ?? 0) : 0;
    const title = attention
      ? "Learning setup needs attention"
      : mode === "setup"
        ? "Waiting for the first Thread"
        : ready
          ? "Threads ready to analyze"
          : "Analysis is running in the web app.";
    const container =
      this.snapshot?.configuration.state === "configured"
        ? this.snapshot.configuration.container
        : null;

    return html`<section
      class="setup-card"
      aria-labelledby="learning-setup-title"
    >
      <div class="setup-top">
        <h2 id="learning-setup-title">Set up Learning</h2>
        <span class="progress-count">${completedSteps} of 3 steps</span>
      </div>
      <div class="progress-track" aria-hidden="true">
        <div
          class="progress-fill"
          style="width: ${(completedSteps / 3) * 100}%"
        ></div>
      </div>
      <ol class="steps">
        <li class="step complete">
          <div class="step-header"><span class="step-number">✓</span></div>
          <h3>Copy the setup prompt</h3>
          <p>Nice work. You’ve completed the first step.</p>
        </li>
        <li
          class="step ${
            attention
              ? "error current"
              : mode === "setup"
                ? "current"
                : "complete"
          }"
        >
          <div class="step-header">
            <span class="step-number">${ready || running ? "✓" : "2"}</span>
            ${
              attention
                ? html`
                    <span class="step-state">Needs attention</span>
                  `
                : nothing
            }
          </div>
          <h3>Create your first Thread</h3>
          <p>Open Checkout Assistant and complete a conversation.</p>
        </li>
        <li class="step ${ready || running ? "current" : ""}">
          <div class="step-header"><span class="step-number">3</span></div>
          <h3>Analyze Threads</h3>
          <p>We'll find patterns and turn them into insights and skills</p>
        </li>
      </ol>
      <div class="setup-support">
        <section class="collection-panel">
          <div class="support-heading"><h3>${title}</h3></div>
          ${
            attention
              ? html`<div class="error-alert" role="alert">
                <p>
                  Inspector did not find the Learning container or app
                  instrumentation. Open the setup prompt, run it in your coding
                  agent, then try again.
                </p>
                <button
                  class="prompt-link"
                  type="button"
                  @click=${() => this.openPrompt()}
                >
                  Open the setup prompt ↗
                </button>
              </div>`
              : html`<div class="collection-summary">
                <div class="collection-stat">
                  <strong class="captured-count">${pendingThreads}</strong>
                  <span>New Threads</span>
                </div>
                ${
                  ready || running
                    ? this.externalLink(
                        this.snapshot?.links.runs ?? null,
                        "Open in web app",
                        "primary setup-cta",
                        "runs",
                      )
                    : html`
                        <button class="primary setup-cta" disabled>Analyze Threads</button>
                      `
                }
              </div>`
          }
          ${
            attention
              ? nothing
              : html`<details class="technical-details">
                <summary>Technical details</summary>
                <dl>
                  <dt>Container</dt>
                  <dd>${container?.id ?? "Waiting for setup"}</dd>
                  <dt>Status</dt>
                  <dd>
                    ${
                      ready
                        ? "Threads available"
                        : running
                          ? "Analysis running"
                          : "Waiting for first Thread"
                    }
                  </dd>
                </dl>
              </details>`
          }
        </section>
      </div>
      <div class="outcome-preview" aria-label="Learning flow">
        <span>Threads</span><b>→</b><span>Insights</span><b>→</b
        ><span>Skills</span>
      </div>
    </section>`;
  }

  private renderPagination(
    section: "skills" | "insights",
    page: number,
    totalPages: number,
  ) {
    if (totalPages <= 1) return nothing;
    return html`<nav class="pagination" aria-label="${section} pages">
      <span aria-live="polite">Page ${page} of ${totalPages}</span>
      <button
        ?disabled=${page <= 1}
        @click=${() => this.emit("learning-page", { section, page: page - 1 })}
      >
        Previous
      </button>
      <button
        ?disabled=${page >= totalPages}
        @click=${() => this.emit("learning-page", { section, page: page + 1 })}
      >
        Next
      </button>
    </nav>`;
  }

  private renderEvidence(insight: InspectorLearningInsight) {
    return html`<section class="detail-panel" aria-label="Insight evidence">
      <div class="detail-head">
        <div>
          <h3>Evidence</h3>
          <p>${insight.statement}</p>
        </div>
        <button
          class="close-detail"
          type="button"
          aria-label="Close evidence"
          @click=${() => {
            this.selectedInsightId = null;
            this.requestUpdate();
          }}
        >
          ×
        </button>
      </div>
      <div class="evidence-list">
        ${
          insight.evidence.length === 0
            ? html`
                <div class="evidence-unavailable">Evidence is no longer available</div>
              `
            : insight.evidence.map((evidence) =>
                evidence.status === "unavailable"
                  ? html`
                      <div class="evidence-unavailable">Evidence is no longer available</div>
                    `
                  : html`<button
                    class="evidence-link"
                    type="button"
                    @click=${() =>
                      this.emit("learning-open-evidence", {
                        threadId: evidence.threadId,
                        messageId: evidence.messageIds[0],
                      })}
                  >
                    ⌁
                    ${
                      evidence.threadName ??
                      `Thread ${evidence.threadId.slice(0, 8)}`
                    }
                    <span>Open Thread →</span>
                  </button>`,
              )
        }
      </div>
      ${
        insight.evidenceTruncated
          ? html`
              <p class="supporting-unavailable">Evidence response shortened</p>
            `
          : nothing
      }
    </section>`;
  }

  private selectInsight(insight: InspectorLearningInsight) {
    this.selectedInsightId = insight.id;
    this.emit("learning-evidence-opened");
    this.requestUpdate();
  }

  private supportingInsightLabel(statement: string): string {
    const firstStop = statement.indexOf(".");
    return firstStop === -1 ? statement : statement.slice(0, firstStop + 1);
  }

  private renderSkills(snapshot: InspectorLearningSnapshotV1) {
    const firstSkillId = snapshot.skillsPage.items[0]?.id ?? null;
    const containerId =
      snapshot.configuration.state === "configured"
        ? snapshot.configuration.container.id
        : "";
    const skillPageKey = `${snapshot.projectKey}|${containerId}|${snapshot.skillsPage.page}|${snapshot.skillsPage.items.map((skill) => skill.id).join(",")}`;
    if (skillPageKey !== this.skillPageKey) {
      this.skillPageKey = skillPageKey;
      this.expandedSkillId =
        snapshot.skillsPage.page === 1 ? firstSkillId : null;
    }
    return html`<section class="result-section" aria-labelledby="skills-title">
      <div class="result-section-heading">
        <h2 id="skills-title">Skills in registry</h2>
        <span class="result-count">${snapshot.skillsPage.total}</span>
        ${
          snapshot.pendingCandidateCount > 0
            ? this.externalLink(
                snapshot.links.candidates,
                `${snapshot.pendingCandidateCount} ${snapshot.pendingCandidateCount === 1 ? "Skill" : "Skills"} for review in web app ↗`,
                "review-link",
                "candidates",
              )
            : nothing
        }
      </div>
      ${
        snapshot.skillsPage.items.length === 0
          ? html`
              <div class="empty-card compact">
                <h3>No Skills in registry yet</h3>
                <p>
                  No Insight has produced a Skill that was approved into the registry yet.
                </p>
              </div>
            `
          : html`<div class="content-card">
            ${snapshot.skillsPage.items.map((skill) => {
              const open = this.expandedSkillId === skill.id;
              return html`<article class="active-skill">
                <h3>${skill.name}</h3>
                <p>${skill.description}</p>
                <div class="skill-lineage">
                  <span>Supporting Insight</span>
                  ${
                    skill.sourceInsight
                      ? html`<button
                        type="button"
                        @click=${() => this.selectInsight(skill.sourceInsight!)}
                      >
                        ${this.supportingInsightLabel(
                          skill.sourceInsight.statement,
                        )}<small
                          >${skill.sourceInsight.totalThreadCount}
                          ${
                            skill.sourceInsight.totalThreadCount === 1
                              ? "Thread"
                              : "Threads"
                          }</small
                        >
                      </button>`
                      : html`
                          <div class="supporting-unavailable">Supporting Insight unavailable</div>
                        `
                  }
                </div>
                <details
                  class="skill-source"
                  ?open=${open}
                  @toggle=${(event: Event) => {
                    const nextOpen = (event.currentTarget as HTMLDetailsElement)
                      .open;
                    if (nextOpen === open) return;
                    this.expandedSkillId = nextOpen ? skill.id : "";
                    this.emit("learning-skill-toggle", {
                      action: nextOpen ? "expanded" : "collapsed",
                    });
                    this.requestUpdate();
                  }}
                >
                  <summary>View SKILL.md</summary>
                  <pre>${skill.skillMd}</pre>
                </details>
              </article>`;
            })}
          </div>`
      }
      ${this.renderPagination(
        "skills",
        snapshot.skillsPage.page,
        snapshot.skillsPage.totalPages,
      )}
    </section>`;
  }

  private renderInsights(snapshot: InspectorLearningSnapshotV1) {
    const selected = snapshot.insightsPage.items.find(
      (insight) => insight.id === this.selectedInsightId,
    );
    return html`<section
      class="result-section"
      aria-labelledby="insights-title"
    >
      <div class="result-section-heading">
        <h2 id="insights-title">
          ${snapshot.skillsPage.total > 0 ? "More Insights" : "Insights"}
        </h2>
        <span class="result-count">${snapshot.insightsPage.total}</span>
      </div>
      ${
        snapshot.insightsPage.items.length === 0
          ? html`
              <div class="empty-card compact"><h3>No active Insights</h3></div>
            `
          : html`<div class="content-card">
            <div class="list-header">
              <span>Pattern</span><span>Evidence</span>
            </div>
            ${snapshot.insightsPage.items.map(
              (insight) => html`<button
                class="insight-row"
                data-selected=${selected?.id === insight.id}
                type="button"
                @click=${() =>
                  selected?.id === insight.id
                    ? ((this.selectedInsightId = null), this.requestUpdate())
                    : this.selectInsight(insight)}
              >
                <div>
                  <h3>${insight.statement}</h3>
                  <p>${insight.impact}</p>
                </div>
                <span class="evidence-count"
                  >${insight.totalThreadCount}
                  ${insight.totalThreadCount === 1 ? "Thread" : "Threads"}</span
                >
              </button>`,
            )}
          </div>`
      }
      ${selected ? this.renderEvidence(selected) : nothing}
      ${this.renderPagination(
        "insights",
        snapshot.insightsPage.page,
        snapshot.insightsPage.totalPages,
      )}
    </section>`;
  }

  private renderResults(snapshot: InspectorLearningSnapshotV1) {
    const sourceInsight = snapshot.skillsPage.items
      .map((skill) => skill.sourceInsight)
      .find((insight) => insight?.id === this.selectedInsightId);
    return html`
      ${
        snapshot.pendingThreadCount > 0
          ? html`<section class="analysis-card ready">
            <div class="analysis-row">
              <div class="analysis-copy">
                <h2>Find new Insights and Skills</h2>
                <p>You have new threads ready to be analyzed.</p>
              </div>
              ${this.externalLink(
                snapshot.links.runs,
                "Open in web app",
                "primary results-cta",
                "runs",
              )}
            </div>
          </section>`
          : nothing
      }
      ${
        this.error
          ? html`<div class="retry-strip" role="status">
            <span>${this.error}</span>
            <button
              class="secondary"
              type="button"
              @click=${() => this.emit("learning-retry")}
            >
              Retry
            </button>
          </div>`
          : nothing
      }
      ${this.renderSkills(snapshot)}
      ${sourceInsight ? this.renderEvidence(sourceInsight) : nothing}
      ${this.renderInsights(snapshot)}
    `;
  }

  private renderEmptyResults(snapshot: InspectorLearningSnapshotV1) {
    return html`<section class="analysis-card">
        <div class="analysis-row">
          <div class="analysis-copy">
            <p class="eyebrow">Analysis complete</p>
            <h2>No new Insights or Skills</h2>
            <p>
              Create more Threads with Checkout Assistant. You can run Learning
              again when new Threads are available.
            </p>
          </div>
        </div>
      </section>
      <section class="result-section">
        <div class="result-section-heading">
          <h2>Skills in registry</h2><span class="result-count">0</span>
        </div>
        <div class="empty-card">
          <h3>No Skills from this analysis</h3>
          <p>Learning did not generate a Skill for review.</p>
        </div>
      </section>
      <section class="result-section">
        <div class="result-section-heading">
          <h2>Insights</h2><span class="result-count">0</span>
        </div>
        <div class="empty-card">
          <h3>No Insights from this analysis</h3>
          <p>Learning did not find a useful pattern in these Threads.</p>
        </div>
      </section>
      ${this.externalLink(
        snapshot.links.learning,
        "Open in web app ↗",
        "quiet-link",
        "learning",
      )}`;
  }

  private renderCompactState(input: {
    readonly title: string;
    readonly copy?: string;
    readonly action?: unknown;
    readonly error?: boolean;
  }) {
    return html`<section class="analysis-card ${input.error ? "error" : ""}">
      <div class="analysis-row">
        <div class="analysis-copy">
          <h2>${input.title}</h2>
          ${input.copy ? html`<p>${input.copy}</p>` : nothing}
        </div>
        ${input.action ?? nothing}
      </div>
    </section>`;
  }

  render() {
    const state = deriveLearningViewState({
      supported: this.supported,
      loading: this.loading,
      error: this.error,
      snapshot: this.snapshot,
      setupActive: this.setupActive,
    });
    let content: unknown;
    if (state === "unsupported") {
      content = this.renderCompactState({
        title: "Learning is not available with this runtime version.",
      });
    } else if (state === "loading") {
      content = html`
        <div class="skeleton" aria-label="Loading Learning">
          <span></span><span></span><span></span>
        </div>
      `;
    } else if (state === "error") {
      content = this.renderCompactState({
        title: "Learning data is unavailable",
        copy: this.error ?? undefined,
        error: true,
        action: html`<button
          class="secondary"
          type="button"
          @click=${() => this.emit("learning-retry")}
        >
          Retry
        </button>`,
      });
    } else if (state === "selection_required") {
      content = this.renderCompactState({
        title: "Inspector cannot choose a Learning container for this agent.",
        action: this.externalLink(
          this.snapshot!.links.learning,
          "Open in web app",
          "primary",
          "learning",
        ),
      });
    } else if (state === "invalid") {
      content = this.renderSetupProgress("attention");
    } else if (state === "landing") {
      // The parent Inspector preserves the existing locked-feature marketing
      // surface for Landing. The v5 pane begins only after its copy action.
      content = nothing;
    } else if (state === "setup") {
      content = this.renderSetupProgress("setup");
    } else if (state === "first_run") {
      content = this.renderSetupProgress("running");
    } else if (state === "ready") {
      content = this.renderSetupProgress("ready");
    } else if (state === "empty") {
      content = this.renderEmptyResults(this.snapshot!);
    } else {
      content = this.renderResults(this.snapshot!);
    }

    return html`<main class="pane-inner" data-learning-state=${state}>
        <header class="pane-heading">
          <div>
            <h1>Learning</h1>
            <p>Your Agent learns from conversations and improves over time.</p>
          </div>
          ${
            this.refreshing
              ? html`
                  <span class="refreshing" role="status">Refreshing</span>
                `
              : nothing
          }
        </header>
        ${content}
      </main>
      ${
        this.promptOpen
          ? html`<div class="dialog-backdrop">
            <section
              class="dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="learning-prompt-title"
            >
              <header>
                <div>
                  <h2 id="learning-prompt-title">Set up Rich Threads</h2>
                  <p>Paste this prompt into your coding agent.</p>
                </div>
                <button
                  class="dialog-close"
                  aria-label="Close setup prompt"
                  @click=${() => {
                    this.promptOpen = false;
                    this.requestUpdate();
                  }}
                >
                  ×
                </button>
              </header>
              <pre>${this.setupPrompt}</pre>
              ${
                this.copyState === "error"
                  ? html`
                      <p class="copy-error" role="alert">
                        Clipboard access failed. Retry to continue.
                      </p>
                    `
                  : nothing
              }
              <footer>
                <button
                  class="secondary"
                  @click=${() => {
                    this.promptOpen = false;
                    this.requestUpdate();
                  }}
                >
                  Close
                </button>
                <button
                  class="primary"
                  @click=${() => this.emit("learning-copy-setup")}
                >
                  ${
                    this.copyState === "copied"
                      ? "Prompt copied"
                      : "Copy the setup prompt"
                  }
                </button>
              </footer>
            </section>
          </div>`
          : nothing
      }`;
  }
}

if (!customElements.get("cpk-learning-view")) {
  customElements.define("cpk-learning-view", CpkLearningView);
}
