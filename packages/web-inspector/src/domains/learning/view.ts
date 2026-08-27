import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type { DirectiveResult } from "lit/directive.js";
import type { LearningState } from "./state.js";

export const LEARNING_VIEW_LABEL = "Learning";
export const MEMORY_LOAD_ERROR_LABEL = "Failed to load learning data";

export type LearningViewModel = Readonly<{
  state: LearningState;
  enabled: boolean;
  setupPrompt: TemplateResult | typeof nothing;
  colorScheme: "light" | "dark";
  lockIcon: DirectiveResult;
  talkToEngineerUrl: string;
  intelligenceSignupUrl: string;
  loadErrorAdvice: string | undefined;
}>;

export type LearningViewActions = Readonly<{
  talkToEngineer: () => void;
  signUpForIntelligence: () => void;
  recallQueryChanged: (query: string) => void;
  recallSubmitted: (query: string) => void;
  recallCleared: () => void;
}>;

function renderErrorIcon(size: number): TemplateResult {
  return html`
    <svg
      width=${size}
      height=${size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#c0333a"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  `;
}

function renderRealtimeIndicator(state: LearningState): TemplateResult {
  const status = state.memoriesRealtimeStatus;
  const connected = status === "connected";
  const dotColor = connected
    ? "#22c55e"
    : status === "connecting"
      ? "#f59e0b"
      : "#9ca3af";
  const label = connected
    ? "live"
    : status === "connecting"
      ? "reconnecting"
      : "offline";
  return html`
    <span class="cpk-learning-realtime" data-connected=${connected}>
      <span
        class="cpk-learning-realtime-dot"
        style="background:${dotColor}"
        aria-hidden="true"
      ></span>
      ${label}
    </span>
  `;
}

function renderLearningLockedBackground(): TemplateResult {
  const rows = [
    { width: 74, accent: true },
    { width: 92 },
    { width: 68 },
    { width: 84 },
    { width: 58 },
    { width: 76 },
  ];

  return html`
    <div aria-hidden="true" class="cpk-locked-preview">
      <div class="cpk-locked-preview-sidebar">
        ${rows.map(
          (row) => html`
            <div
              class="cpk-locked-preview-row"
              data-accent=${row.accent ? "true" : "false"}
            >
              <div
                class="cpk-locked-preview-bar cpk-locked-preview-row-title"
                style="--preview-width: ${row.width}%;"
              ></div>
              <div
                class="cpk-locked-preview-bar cpk-locked-preview-row-line"
              ></div>
              <div
                class="cpk-locked-preview-bar cpk-locked-preview-row-line"
              ></div>
            </div>
          `,
        )}
      </div>
      <div class="cpk-locked-preview-main">
        <div class="cpk-locked-preview-bar cpk-locked-preview-heading"></div>
        <div class="cpk-locked-preview-bar cpk-locked-preview-copy"></div>
        <div class="cpk-locked-preview-bar cpk-locked-preview-copy"></div>
        <div class="cpk-locked-preview-cards">
          <div class="cpk-locked-preview-card"></div>
          <div class="cpk-locked-preview-card"></div>
        </div>
        <div
          class="cpk-locked-preview-bar cpk-locked-preview-footer-line"
        ></div>
        <div
          class="cpk-locked-preview-bar cpk-locked-preview-footer-line"
        ></div>
      </div>
    </div>
  `;
}

export function renderLearningView(
  model: LearningViewModel,
  actions: LearningViewActions,
): TemplateResult {
  const { state } = model;
  if (!model.enabled) {
    return html`
      <div class="cpk-memory-locked">
        ${renderLearningLockedBackground()}
        <div aria-hidden="true" class="cpk-memory-locked-scrim"></div>
        <div class="cpk-memory-locked-content">
          <div aria-hidden="true" class="cpk-memory-locked-icon-wrap">
            <div class="cpk-memory-locked-icon">${model.lockIcon}</div>
          </div>
          <h2 class="cpk-memory-locked-title">Learning</h2>
          <p class="cpk-memory-locked-copy">
            ${
              state.memoryStoreUnsupported
                ? "Learning is unavailable in this version of the @copilotkit SDK. Upgrade @copilotkit/core (and @copilotkit/react) to a version that supports long-term memory."
                : "Learning turns durable information from agent interactions into reusable context. It isn't enabled on this deployment."
            }
          </p>
          <div class="cpk-memory-locked-actions">
            ${model.setupPrompt}
            <a
              href=${model.talkToEngineerUrl}
              target="_blank"
              rel="noopener"
              class="cpk-memory-locked-action"
              aria-label="Talk to an Engineer (opens in a new tab)"
              @click=${actions.talkToEngineer}
            >
              Talk to an Engineer
            </a>
            <a
              href=${model.intelligenceSignupUrl}
              target="_blank"
              rel="noopener"
              class="cpk-memory-locked-action cpk-memory-locked-action-secondary"
              aria-label="Sign up for Intelligence (opens in a new tab)"
              @click=${actions.signUpForIntelligence}
            >
              Sign up for Intelligence
            </a>
          </div>
        </div>
      </div>
    `;
  }

  if (state.memoriesError && state.memories.length === 0) {
    return html`
      <div class="cpk-learning-state cpk-learning-state--error" role="alert">
        ${renderErrorIcon(24)}
        <span class="cpk-learning-state-title">${MEMORY_LOAD_ERROR_LABEL}</span>
        <span class="cpk-learning-state-copy"
          >${state.memoriesError.message}</span
        >
        <span class="cpk-learning-state-copy">${model.loadErrorAdvice}</span>
      </div>
    `;
  }

  if (state.memoriesLoading && state.memories.length === 0) {
    return html`
      <div class="cpk-learning-state" role="status">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#c0c0c8"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span class="cpk-learning-state-title">Loading learning…</span>
      </div>
    `;
  }

  return html`
    <div class="cpk-learning-shell">
      <div class="cpk-section-header cpk-learning-header">
        <h4>${LEARNING_VIEW_LABEL}</h4>
        <div class="cpk-learning-header-status">
          ${renderRealtimeIndicator(state)}
          <span class="cpk-learning-count">${state.memories.length}</span>
        </div>
      </div>
      ${
        state.memoriesError
          ? html`
              <div class="cpk-learning-inline-error" role="alert">
                <span class="cpk-learning-inline-error-icon">
                  ${renderErrorIcon(16)}
                </span>
                <span>Action failed: ${state.memoriesError.message}</span>
              </div>
            `
          : nothing
      }
      <div class="cpk-learning-list">
        <cpk-memory-list
          style="height:100%;"
          data-color-scheme=${model.colorScheme}
          .memories=${state.memories}
          .recallResults=${state.recallResults}
          .recallLoading=${state.recallLoading}
          .recallError=${state.recallError}
          .recallQueryText=${state.recallQuery}
          @recallQueryChanged=${(event: CustomEvent<string>) =>
            actions.recallQueryChanged(event.detail)}
          @recallSubmitted=${(event: CustomEvent<string>) =>
            actions.recallSubmitted(event.detail)}
          @recallCleared=${actions.recallCleared}
        ></cpk-memory-list>
      </div>
    </div>
  `;
}
