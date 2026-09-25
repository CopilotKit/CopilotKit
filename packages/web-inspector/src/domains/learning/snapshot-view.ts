import { LitElement, html, nothing } from "lit";
import type {
  InspectorLearningInsight,
  InspectorLearningSnapshotV1,
} from "@copilotkit/shared";

import { deriveLearningViewState } from "./snapshot-state.js";
import { learningSnapshotBaseStyles } from "./snapshot-view.base.styles.js";
import { learningSnapshotPanelStyles } from "./snapshot-view.panel.styles.js";

export type { LearningViewState } from "./snapshot-state.js";
export { deriveLearningViewState } from "./snapshot-state.js";

export class CpkLearningView extends LitElement {
  static properties = {
    supported: { type: Boolean },
    loading: { type: Boolean },
    refreshing: { type: Boolean },
    error: { attribute: false },
    snapshot: { attribute: false },
    setupActive: { type: Boolean },
    copyState: { attribute: false },
    recopyState: { attribute: false },
    setupPrompt: { attribute: false },
  };

  supported = false;
  loading = false;
  refreshing = false;
  error: string | null = null;
  snapshot: InspectorLearningSnapshotV1 | null = null;
  setupActive = false;
  copyState: "idle" | "copied" | "error" = "idle";
  recopyState: "idle" | "copied" | "error" = "idle";
  setupPrompt = "";
  private promptOpen = false;
  private promptTrigger: HTMLElement | null = null;
  private expandedSkillId: string | null = null;
  private selectedInsightId: string | null = null;
  private skillPageKey = "";

  static styles = [learningSnapshotBaseStyles, learningSnapshotPanelStyles];

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

  private openPrompt(event?: Event) {
    const trigger = event?.currentTarget;
    this.promptTrigger = trigger instanceof HTMLElement ? trigger : null;
    this.promptOpen = true;
    this.requestUpdate();
    void this.updateComplete.then(() => {
      this.renderRoot
        .querySelector<HTMLButtonElement>(".dialog-close")
        ?.focus();
    });
  }

  private closePrompt(): void {
    this.promptOpen = false;
    this.requestUpdate();
    void this.updateComplete.then(() => this.promptTrigger?.focus());
  }

  private handlePromptKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.closePrompt();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget;
    if (!(dialog instanceof HTMLElement)) return;
    const root = dialog.getRootNode();
    const activeElement =
      root instanceof ShadowRoot ? root.activeElement : document.activeElement;
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  private setupPromptButton(label = "Copy the setup prompt") {
    return html`<button
      class="primary"
      type="button"
      @click=${(event: Event) =>
        label === "Open the setup prompt"
          ? this.openPrompt(event)
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
    const waitingForLearningSetup =
      mode === "setup" &&
      this.setupActive &&
      (this.snapshot === null ||
        this.snapshot.configuration.state === "not_configured");
    const completedSteps = ready || running ? 2 : 1;
    const pendingThreads = ready ? (this.snapshot?.pendingThreadCount ?? 0) : 0;
    const title = attention
      ? "Learning setup needs attention"
      : mode === "setup"
        ? waitingForLearningSetup
          ? "Waiting for Automatic Learning setup"
          : "Waiting for the first Thread"
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
        <h2 id="learning-setup-title">Set up Automatic Learning</h2>
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
          <button
            class="copy-again"
            type="button"
            aria-live="polite"
            @click=${() => this.emit("learning-recopy-setup")}
          >
            ${
              this.recopyState === "copied"
                ? "✓ Copied!"
                : this.recopyState === "error"
                  ? "Try copying again"
                  : "Copy prompt again"
            }
          </button>
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
          <h3>
            ${
              waitingForLearningSetup
                ? "Set up Automatic Learning"
                : "Create your first Thread"
            }
          </h3>
          <p>
            ${
              waitingForLearningSetup
                ? "Run the copied prompt in your coding agent. This page will continue when Automatic Learning is ready."
                : "Open Checkout Assistant and complete a conversation."
            }
          </p>
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
                  Inspector did not find the Learning Space or app
                  instrumentation. Open the setup prompt, run it in your coding
                  agent, then try again.
                </p>
                <button
                  class="prompt-link"
                  type="button"
                  @click=${(event: Event) => this.openPrompt(event)}
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
                  <dt>Learning Space</dt>
                  <dd>${container?.id ?? "Waiting for setup"}</dd>
                  <dt>Status</dt>
                  <dd>
                    ${
                      ready
                        ? "Threads available"
                        : running
                          ? "Analysis running"
                          : waitingForLearningSetup
                            ? "Waiting for Automatic Learning setup"
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
    const containerId =
      snapshot.configuration.state === "configured"
        ? snapshot.configuration.container.id
        : "";
    const skillPageKey = `${snapshot.projectKey}|${containerId}|${snapshot.skillsPage.page}|${snapshot.skillsPage.items.map((skill) => skill.id).join(",")}`;
    if (skillPageKey !== this.skillPageKey) {
      this.skillPageKey = skillPageKey;
      this.expandedSkillId = null;
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
      ${this.renderSkills(snapshot)}
      ${sourceInsight ? this.renderEvidence(sourceInsight) : nothing}
      ${this.renderInsights(snapshot)}
    `;
  }

  private renderRetryStrip() {
    if (!this.error) return nothing;
    return html`<div class="retry-strip" role="status">
      <span>${this.error}</span>
      <button
        class="secondary"
        type="button"
        @click=${() => this.emit("learning-retry")}
      >
        Retry
      </button>
    </div>`;
  }

  private renderEmptyResults(snapshot: InspectorLearningSnapshotV1) {
    return html`<section class="analysis-card">
        <div class="analysis-row">
          <div class="analysis-copy">
            <p class="eyebrow">Analysis complete</p>
            <h2>No new Insights or Skills</h2>
            <p>
              Create more Threads with Checkout Assistant. You can run Automatic Learning
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
          <p>Automatic Learning did not generate a Skill for review.</p>
        </div>
      </section>
      <section class="result-section">
        <div class="result-section-heading">
          <h2>Insights</h2><span class="result-count">0</span>
        </div>
        <div class="empty-card">
          <h3>No Insights from this analysis</h3>
          <p>Automatic Learning did not find a useful pattern in these Threads.</p>
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
    if (state === "loading") {
      content = html`
        <div class="skeleton" aria-label="Loading Automatic Learning">
          <span></span><span></span><span></span>
        </div>
      `;
    } else if (state === "error") {
      content = this.renderCompactState({
        title: "Automatic Learning data is unavailable",
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
        title: "Inspector cannot choose a Learning Space for this agent.",
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

    const retry =
      state === "error" || !this.snapshot ? nothing : this.renderRetryStrip();

    return html`<main class="pane-inner" data-learning-state=${state}>
        <header class="pane-heading">
          <div>
            <h1>Automatic Learning</h1>
            <p>Intelligence finds patterns in Rich Threads and proposes reusable Skills.</p>
            ${this.snapshot?.configuration.state === "configured" ? html`<p style="font-size:12px;margin-top:10px">Learning Space <strong>${this.snapshot.configuration.container.name}</strong></p>` : nothing}
          </div>
          <div class="pane-actions">
            ${
              state === "results"
                ? this.externalLink(
                    this.snapshot!.webAppOrigin,
                    "Open Intelligence ↗",
                    "secondary",
                  )
                : nothing
            }
            ${
              state === "setup" && this.setupActive
                ? html`<button
                    class="secondary"
                    type="button"
                    @click=${() => this.emit("learning-go-back")}
                  >
                    ← Go back
                  </button>`
                : nothing
            }
            ${
              this.refreshing
                ? html`
                    <span class="refreshing" role="status">Refreshing</span>
                  `
                : nothing
            }
          </div>
        </header>
        ${retry}
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
              @keydown=${this.handlePromptKeydown}
            >
              <header>
                <div>
                  <h2 id="learning-prompt-title">Set up Rich Threads</h2>
                  <p>Paste this prompt into your coding agent.</p>
                </div>
                <button
                  class="dialog-close"
                  aria-label="Close setup prompt"
                  @click=${() => this.closePrompt()}
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
                  @click=${() => this.closePrompt()}
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
