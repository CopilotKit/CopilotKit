import type { ɵThread } from "@copilotkit/core";
import { html, nothing } from "lit";
import type { ThreadDebuggerProvider } from "../../shared/thread-debugger/types.js";
import { THREADS_EXAMPLE_TOUR_STEPS } from "./examples/tour.js";
import type { ThreadsState, ThreadsSetupPromptCopyState } from "./state.js";

export const THREADS_DOCS_URL = "https://docs.copilotkit.ai/threads";
export const THREADS_RUNTIME_SETUP_DOCS_URL =
  "https://docs.copilotkit.ai/backend/runtime-endpoints#enable-rich-threads-routes";
export const SELF_HOSTED_INTELLIGENCE_URL =
  "https://docs.copilotkit.ai/premium/self-hosting";
export const THREADS_RUNTIME_SETUP_PROMPT = [
  `Read ${THREADS_RUNTIME_SETUP_DOCS_URL} and finish setting up Rich Threads in this repository.`,
  "",
  "First inspect the repository's agent instructions, installed CopilotKit versions, Runtime adapter, frontend provider, route or proxy setup, and existing authentication. Preserve the current framework and deployment model. Preserve existing authentication middleware and access checks on every Runtime route.",
  "",
  "Follow the guide to enable the multi-route Runtime, align the frontend transport, scope identifyUser to the existing server-verified signed-in application user, and expose the full Runtime subtree for GET, POST, PATCH, and DELETE. Never use a fixed demo identity in production. If no trusted user identity exists, stop and ask me which auth source to use.",
  "",
  "Start the app and verify GET {basePath}/info reports threadEndpoints.list, inspect, mutations, and realtimeMetadata as true. Run focused tests, lint, and typecheck. Report the files changed, commands run, and verification result. If blocked, explain the missing input; do not invent setup.",
].join("\n");

export function getThreadsEmptyOnboardingAction(
  planCode: string | undefined,
  urls: { signup: string; selfHosted: string },
): Readonly<{
  href: string;
  label: "Sign up for Intelligence" | "Explore self-hosted Intelligence";
}> {
  const normalizedPlan = planCode?.trim().toLowerCase();
  if (
    normalizedPlan === "team_self_hosted" ||
    normalizedPlan === "team-self-hosted"
  ) {
    return {
      href: urls.selfHosted,
      label: "Explore self-hosted Intelligence",
    };
  }
  return { href: urls.signup, label: "Sign up for Intelligence" };
}

export type ThreadSelectionResult =
  | { kind: "overview" }
  | { kind: "example"; autoStartTour: boolean }
  | { kind: "real" };

export function selectThread(
  state: ThreadsState,
  input: {
    threadId: string;
    showingExamples: boolean;
    isExample: boolean;
    displayThreads: readonly ɵThread[];
  },
): ThreadSelectionResult {
  state.requestedThreadId = null;
  state.focusedThreadMessageId = null;
  if (
    input.showingExamples &&
    state.selectedThreadId === input.threadId &&
    state.selectedLocalExampleThreadId === input.threadId
  ) {
    state.selectedThreadId = null;
    state.selectedRealThreadIsExplicit = false;
    state.selectedLocalExampleThreadId = null;
    state.exampleTourActive = false;
    return { kind: "overview" };
  }

  state.selectedThreadId = input.threadId;
  if (input.showingExamples && input.isExample) {
    state.selectedRealThreadIsExplicit = false;
    state.selectedLocalExampleThreadId = input.threadId;
    const autoStartTour =
      !state.exampleTourDismissed && !state.exampleTourAutoShown;
    if (!autoStartTour) state.exampleTourActive = false;
    return { kind: "example", autoStartTour };
  }

  state.selectedRealThreadIsExplicit = input.displayThreads.some(
    (thread) => thread.id === input.threadId,
  );
  state.selectedLocalExampleThreadId = null;
  state.exampleTourActive = false;
  return { kind: "real" };
}

export function showSetupPromptCopyState(
  state: ThreadsState,
  copyState: Exclude<ThreadsSetupPromptCopyState, "idle">,
  generation: number,
  win: Window,
  isCurrent: () => boolean,
  requestUpdate: () => void,
): void {
  if (!isCurrent() || generation !== state.setupPromptCopyGeneration) return;
  if (state.setupPromptCopyResetTimeoutId !== null) {
    win.clearTimeout(state.setupPromptCopyResetTimeoutId);
  }
  state.setupPromptCopyState = copyState;
  requestUpdate();
  state.setupPromptCopyResetTimeoutId = win.setTimeout(() => {
    if (!isCurrent() || generation !== state.setupPromptCopyGeneration) return;
    state.setupPromptCopyState = "idle";
    state.setupPromptCopyResetTimeoutId = null;
    requestUpdate();
  }, 2000);
}

export interface ThreadsOverviewViewModel {
  locked: boolean;
  lockedCopy?: { heading: string; description: string };
  diagnostic: unknown;
  setupPrompt: unknown;
  docsUrl: string;
  onboardingAction: { href: string; label: string };
  video: unknown;
  lockedAction: unknown;
}

export function renderThreadsOverview(model: ThreadsOverviewViewModel) {
  return html`
    <div class="cpk-threads-overview">
      <div class="cpk-threads-overview-content">
        <h2 class="cpk-threads-overview-title">
          ${
            model.lockedCopy?.heading ??
            "Threads are persistent, inspectable conversations"
          }
        </h2>
        ${model.video}
        <p class="cpk-threads-overview-copy">
          ${
            model.lockedCopy?.description ??
            "Take a tour with the example threads in the sidebar. Then, start chatting in your app to create the first real thread."
          }
        </p>
        ${model.locked ? model.diagnostic : nothing}
        <div class="cpk-threads-overview-actions">
          ${
            model.locked
              ? html`
                ${model.setupPrompt}
                ${model.lockedAction}
              `
              : html`
                <a
                  href=${model.docsUrl}
                  target="_blank"
                  rel="noopener"
                  class="cpk-threads-overview-action cpk-threads-overview-action-primary"
                >
                  Learn how Threads work
                </a>
                <a
                  href=${model.onboardingAction.href}
                  target="_blank"
                  rel="noopener"
                  class="cpk-threads-overview-action cpk-threads-overview-action-secondary"
                >
                  ${model.onboardingAction.label}
                </a>
              `
          }
        </div>
      </div>
    </div>
  `;
}

export function renderThreadsTour(
  state: ThreadsState,
  actions: {
    start: () => void;
    setStep: (step: number) => void;
    dismiss: (method: "skip" | "done") => void;
  },
) {
  if (
    !state.selectedThreadId ||
    state.selectedThreadId !== state.selectedLocalExampleThreadId
  ) {
    return nothing;
  }
  if (!state.exampleTourActive) {
    return html`<button
      class="cpk-threads-tour-launch"
      type="button"
      @click=${actions.start}
    >
      Show tour
    </button>`;
  }

  const step =
    THREADS_EXAMPLE_TOUR_STEPS[state.exampleTourStep] ??
    THREADS_EXAMPLE_TOUR_STEPS[0]!;
  const isFirst = state.exampleTourStep === 0;
  const isLast =
    state.exampleTourStep === THREADS_EXAMPLE_TOUR_STEPS.length - 1;
  return html`
    <div
      class="cpk-threads-tour"
      role="dialog"
      aria-label="Example thread tour"
    >
      <div class="cpk-threads-tour-step">
        ${state.exampleTourStep + 1}/${THREADS_EXAMPLE_TOUR_STEPS.length}
        ${step.label}
      </div>
      <div class="cpk-threads-tour-title">${step.title}</div>
      <div class="cpk-threads-tour-copy">${step.body}</div>
      <div class="cpk-threads-tour-actions">
        <button
          class="cpk-threads-tour-skip"
          type="button"
          @click=${() => actions.dismiss("skip")}
        >
          Skip
        </button>
        <div class="cpk-threads-tour-nav">
          <button
            class="cpk-threads-tour-button cpk-threads-tour-button-secondary"
            type="button"
            ?disabled=${isFirst}
            @click=${() => actions.setStep(state.exampleTourStep - 1)}
          >
            Back
          </button>
          <button
            class="cpk-threads-tour-button cpk-threads-tour-button-primary"
            type="button"
            @click=${() =>
              isLast
                ? actions.dismiss("done")
                : actions.setStep(state.exampleTourStep + 1)}
          >
            ${isLast ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  `;
}

export interface ThreadsViewModel {
  state: ThreadsState;
  colorScheme: string;
  visibleThreads: readonly ɵThread[];
  displayThreadCount: number;
  selectedThread: ɵThread | null;
  selectedThreadIsLocalExample: boolean;
  threadsErrorMessage: string | null;
  loadingWithoutRows: boolean;
  showingExamples: boolean;
  runtimeUrl: string;
  headers: Readonly<Record<string, string>>;
  threadInspectionAvailable: boolean;
  liveMessageVersion: number;
  viewInAppMode: "hidden" | "view" | "stop";
  provider: ThreadDebuggerProvider | null;
  agentStateInput: unknown;
  agentEventsInput: unknown;
  agentMessagesInput: unknown;
  usageFooter: unknown;
  tour: unknown;
  overview: unknown;
}

export interface ThreadsViewActions {
  selectThread: (threadId: string) => void;
  resizeStart: (event: PointerEvent) => void;
  resizeMove: (event: PointerEvent) => void;
  resizeEnd: (event: PointerEvent) => void;
  viewInApp: () => void;
  stopViewing: () => void;
}

export function renderThreadsView(
  model: ThreadsViewModel,
  actions: ThreadsViewActions,
) {
  const { state, selectedThread } = model;
  return html`
    <div style="display:flex;height:100%;overflow:hidden;flex-direction:column;">
      <div style="display:flex;min-height:0;flex:1;overflow:hidden;">
        <div
          style="width:${state.threadListWidth}px;flex-shrink:0;overflow:hidden;display:flex;flex-direction:column;border-right:1px solid #DBDBE5;"
        >
          <cpk-thread-list
            style="min-height:0;flex:1;"
            data-color-scheme=${model.colorScheme}
            .threads=${model.visibleThreads}
            .selectedThreadId=${state.selectedThreadId}
            .inAppThreadId=${state.inAppThreadId}
            .errorMessage=${model.threadsErrorMessage}
            .suppressEmptyState=${model.loadingWithoutRows}
            @threadSelected=${(event: CustomEvent<string>) =>
              actions.selectThread(event.detail)}
          ></cpk-thread-list>
          ${model.usageFooter}
        </div>

        <div
          style="width:4px;flex-shrink:0;cursor:col-resize;background:transparent;position:relative;z-index:1;"
          @pointerdown=${actions.resizeStart}
          @pointermove=${actions.resizeMove}
          @pointerup=${actions.resizeEnd}
          @pointercancel=${actions.resizeEnd}
        ></div>

        <div
          style="flex:1;min-width:0;overflow:hidden;display:flex;position:relative;"
        >
          ${
            model.threadsErrorMessage
              ? html`<div
                role="alert"
                style="display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:24px;color:#c0333a;text-align:center;"
              >
                <strong style="font-size:13px;">Failed to load threads</strong>
                <span style="max-width:440px;font-size:12px;line-height:1.5;"
                  >${model.threadsErrorMessage}</span
                >
              </div>`
              : model.loadingWithoutRows
                ? html`
                    <div
                      role="status"
                      style="
                        display: flex;
                        flex: 1;
                        align-items: center;
                        justify-content: center;
                        color: #57575b;
                        font-size: 13px;
                      "
                    >
                      Loading threads…
                    </div>
                  `
                : selectedThread
                  ? html`<cpk-thread-details
                      style="flex:1;min-width:0;"
                      data-color-scheme=${model.colorScheme}
                      .threadId=${selectedThread.id}
                      .thread=${selectedThread}
                      .provider=${model.provider}
                      .runtimeUrl=${model.runtimeUrl}
                      .headers=${model.headers}
                      .threadInspectionAvailable=${model.threadInspectionAvailable}
                      .liveMessageVersion=${model.liveMessageVersion}
                      .viewInAppMode=${model.viewInAppMode}
                      .viewInAppError=${state.viewInAppError}
                      @viewInApp=${actions.viewInApp}
                      @stopViewing=${actions.stopViewing}
                      .focusMessageId=${state.focusedThreadMessageId}
                      .focusRequestId=${state.threadFocusRequestId}
                      .agentStateInput=${model.agentStateInput}
                      .agentEventsInput=${model.agentEventsInput}
                      .agentMessagesInput=${model.agentMessagesInput}
                    ></cpk-thread-details>
                    ${
                      model.selectedThreadIsLocalExample ? model.tour : nothing
                    }`
                  : model.showingExamples
                    ? model.overview
                    : html`<div
                      style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#68686e;"
                    >
                      <svg
                        width="32"
                        height="32"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#c0c0c8"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path
                          d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                        />
                      </svg>
                      <span style="font-size:13px;"
                        >${
                          model.displayThreadCount === 0
                            ? "No threads yet"
                            : "Select a thread to inspect"
                        }</span
                      >
                    </div>`
          }
        </div>
      </div>
    </div>
  `;
}
