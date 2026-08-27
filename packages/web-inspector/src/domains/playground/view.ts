import { html, nothing } from "lit";
import type { PlaygroundComposerViewActions } from "./composer.js";
import { renderPlaygroundComposer } from "./composer.js";
import type { PlaygroundState, PlaygroundToolCall } from "./state.js";

type PlaygroundIconName =
  | "Activity"
  | "ChevronRight"
  | "Clock3"
  | "LoaderCircle"
  | "Plus"
  | "RotateCcw"
  | "X"
  | "ArrowUp"
  | "Square"
  | "TriangleAlert";

export interface PlaygroundSourceThread {
  id: string;
  agentId: string;
  name?: string | null;
}

export interface PlaygroundSuggestion {
  title: string;
  message: string;
  isLoading?: boolean;
}

export interface PlaygroundViewModel {
  state: PlaygroundState;
  agentId: string | null;
  sourceThreads: readonly PlaygroundSourceThread[];
  runtimeMode: string;
  runtimeLabel: string;
  suggestions: readonly PlaygroundSuggestion[];
  intelligenceSignupUrl: string;
  clipboard?: Clipboard;
  renderIcon: (name: PlaygroundIconName) => unknown;
  renderToolCalls: (toolCalls: PlaygroundToolCall[]) => unknown;
}

export interface PlaygroundViewActions {
  composer: PlaygroundComposerViewActions;
  loadThread: (event: Event) => void;
  newThread: () => void;
  dismissEphemeralNotice: () => void;
  suggestion: (message: string) => void;
  retry: () => void;
}

export function renderPlaygroundView(
  model: PlaygroundViewModel,
  actions: PlaygroundViewActions,
) {
  const { state } = model;
  const sourceThreads = model.sourceThreads.filter(
    (thread) => !model.agentId || thread.agentId === model.agentId,
  );
  const visibleMessages = state.messages.filter(
    (message) =>
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "reasoning" ||
      message.role === "activity",
  );
  const hasRetry =
    state.agent?.messages.some((message) => message.role === "user") ?? false;
  const busy = state.isRunning || state.isLoadingThread;
  const lastAssistantIndex = visibleMessages.reduce(
    (last, message, index) => (message.role === "assistant" ? index : last),
    -1,
  );
  const lastReasoningIndex = visibleMessages.reduce(
    (last, message, index) => (message.role === "reasoning" ? index : last),
    -1,
  );
  const showWelcome = !state.isLoadingThread && visibleMessages.length === 0;
  const composerModel = {
    state,
    agentId: model.agentId,
    busy,
    hasRetry,
    renderIcon: model.renderIcon,
  };

  return html`
    <div
      class="cpk-playground-root flex h-full min-h-[420px] flex-col bg-white"
    >
      <header
        class="cpk-playground-header flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <h2 class="text-xs font-semibold text-gray-900">Playground</h2>
            <span
              class="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[9px] font-medium text-gray-600"
              >${model.runtimeMode.toUpperCase()}</span
            >
          </div>
          <div
            class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9px] text-gray-600"
          >
            <span class="truncate">Agent: ${model.agentId ?? "waiting..."}</span>
            <span
              class="h-3 w-px shrink-0 bg-gray-200"
              aria-hidden="true"
            ></span>
            <span class="truncate" title=${model.runtimeLabel}
              >${model.runtimeLabel}</span
            >
          </div>
        </div>
        <div
          class="cpk-playground-actions ml-auto flex min-w-0 items-center gap-2"
        >
          ${
            sourceThreads.length > 0
              ? html`<label class="sr-only" for="cpk-playground-thread-source"
                  >Start from a thread</label
                >
                <select
                  id="cpk-playground-thread-source"
                  class="cpk-playground-thread-select max-w-[200px] rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] text-gray-700 outline-none transition hover:border-gray-300 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                  .value=${state.sourceThreadId ?? ""}
                  ?disabled=${busy}
                  @change=${actions.loadThread}
                >
                  <option value="">Load a thread...</option>
                  ${sourceThreads.map(
                    (thread) => html`<option value=${thread.id}>
                      ${
                        thread.name?.trim() || `Thread ${thread.id.slice(0, 8)}`
                      }
                    </option>`,
                  )}
                </select>`
              : nothing
          }
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:h-3.5 [&>svg]:w-3.5"
            ?disabled=${busy || !model.agentId}
            @click=${actions.newThread}
          >
            ${model.renderIcon("Plus")} <span>New thread</span>
          </button>
        </div>
      </header>

      ${
        state.showEphemeralNotice && model.runtimeMode !== "intelligence"
          ? html`<div
            role="alert"
            class="mx-3 mt-2 flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2 text-[10px] text-violet-950"
            data-playground-ephemeral-notice
          >
            <span
              class="mt-0.5 text-violet-600 [&>svg]:h-3.5 [&>svg]:w-3.5"
              >${model.renderIcon("Clock3")}</span
            >
            <p class="min-w-0 flex-1 leading-relaxed">
              Scratch threads are ephemeral and will be deleted when your local
              session ends. Need durable history?
              <a
                class="font-semibold underline decoration-violet-300 underline-offset-2 hover:decoration-violet-700 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1"
                href=${model.intelligenceSignupUrl}
                target="_blank"
                rel="noopener noreferrer"
                >Set up Intelligence</a
              >.
            </p>
            <button
              type="button"
              class="rounded p-0.5 text-violet-500 transition hover:bg-violet-100 hover:text-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1"
              aria-label="Dismiss ephemeral thread notice"
              @click=${actions.dismissEphemeralNotice}
            >
              ${model.renderIcon("X")}
            </button>
          </div>`
          : nothing
      }

      <div
        class="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        data-playground-messages
      >
        ${
          state.isLoadingThread
            ? html`<div
              class="flex h-full items-center justify-center gap-1.5 text-[10px] text-gray-600"
            >
              <span
                class="text-gray-500 [&>svg]:animate-spin"
                aria-hidden="true"
                >${model.renderIcon("LoaderCircle")}</span
              >
              Loading thread into a scratch session...
            </div>`
            : visibleMessages.length === 0
              ? html`<div
                class="cpk-playground-welcome mx-auto flex h-full w-full flex-col items-center justify-center text-center"
              >
                <p class="cpk-playground-welcome-title">
                  How can I help you today?
                </p>
                ${renderPlaygroundComposer(
                  { ...composerModel, centered: true },
                  actions.composer,
                )}
              </div>`
              : html`<div class="mx-auto flex max-w-3xl flex-col pb-5">
                ${visibleMessages.map((message, index) => {
                  const isUser = message.role === "user";
                  const isReasoning = message.role === "reasoning";
                  const isActivity = message.role === "activity";
                  const content = isActivity
                    ? (message.activityType ?? "Agent activity")
                    : message.contentText;
                  if (
                    !isReasoning &&
                    !content &&
                    message.toolCalls.length === 0
                  ) {
                    return nothing;
                  }
                  if (isReasoning) {
                    const isStreaming =
                      state.isRunning && index === lastReasoningIndex;
                    const duration = message.id
                      ? state.reasoningDurations.get(message.id)
                      : undefined;
                    const durationLabel =
                      duration === undefined || duration < 1000
                        ? "a few seconds"
                        : `${Math.round(duration / 1000)} seconds`;
                    const label = isStreaming
                      ? "Thinking…"
                      : `Thought for ${durationLabel}`;

                    if (isStreaming) {
                      return html`<section
                        class="cpk-playground-message-enter my-1 text-[11px] text-gray-500"
                        data-playground-message-role="reasoning"
                      >
                        <div
                          class="inline-flex items-center gap-1 py-1 font-medium"
                        >
                          <span>${label}</span>
                          ${
                            content
                              ? nothing
                              : html`
                                  <span
                                    class="cpk-playground-thinking-dot ml-1 h-1.5 w-1.5 rounded-full bg-gray-500"
                                    aria-hidden="true"
                                  ></span>
                                `
                          }
                        </div>
                        ${
                          content
                            ? html`<div
                              class="pb-2 pt-1 leading-5 text-gray-500"
                            >
                              ${content}
                            </div>`
                            : nothing
                        }
                      </section>`;
                    }

                    return content
                      ? html`<details
                          class="cpk-playground-message-enter cpk-playground-reasoning my-1 text-[11px] text-gray-500"
                          data-playground-message-role="reasoning"
                        >
                          <summary
                            class="inline-flex cursor-pointer list-none items-center gap-1 py-1 font-medium transition-colors hover:text-gray-900 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-1"
                          >
                            <span>${label}</span>
                            <span
                              class="cpk-playground-reasoning-chevron transition-transform duration-200 [&>svg]:h-3 [&>svg]:w-3"
                              >${model.renderIcon("ChevronRight")}</span
                            >
                          </summary>
                          <div class="pb-2 pt-1 leading-5 text-gray-500">
                            ${content}
                          </div>
                        </details>`
                      : html`<div
                          class="cpk-playground-message-enter my-1 py-1 text-[11px] font-medium text-gray-500"
                          data-playground-message-role="reasoning"
                        >
                          ${label}
                        </div>`;
                  }
                  const isMultiline =
                    content.includes("\n") || content.length > 72;
                  const showToolbar =
                    !isUser &&
                    !isActivity &&
                    Boolean(content) &&
                    !(state.isRunning && index === lastAssistantIndex);
                  return html`<article
                    class=${
                      isActivity
                        ? "cpk-playground-message-enter mr-auto mt-3 flex max-w-full items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[10px] text-gray-600"
                        : isUser
                          ? "cpk-playground-message-enter flex w-full flex-col items-end pt-8"
                          : "cpk-playground-message-enter w-full"
                    }
                    data-playground-message-role=${message.role}
                  >
                    ${
                      isActivity
                        ? html`<span class="text-gray-500"
                            >${model.renderIcon("Activity")}</span
                          >
                          <span class="font-medium text-gray-700"
                            >Activity</span
                          >
                          <span class="truncate">${content}</span>`
                        : isUser
                          ? html`<div
                            class=${`max-w-[80%] whitespace-pre-wrap break-words rounded-[16px] bg-gray-100 px-3 text-[13px] leading-5 text-gray-900 ${
                              isMultiline ? "py-2.5" : "py-1"
                            }`}
                          >
                            ${content}
                          </div>`
                          : html`<div
                            class="whitespace-pre-wrap break-words py-3 text-[13px] leading-[22px] text-gray-800"
                          >
                            ${content}
                          </div>`
                    }
                    ${
                      !isUser && message.toolCalls.length > 0
                        ? model.renderToolCalls(message.toolCalls)
                        : nothing
                    }
                    ${
                      showToolbar
                        ? html`<div
                          class="-ml-1 flex min-h-7 w-full items-center gap-1 bg-transparent"
                          data-playground-assistant-toolbar
                        >
                          <cpk-inspector-copy-button
                            variant="icon"
                            title="Copy message"
                            label="Copy message"
                            copied-label="Message copied"
                            .value=${content}
                            .clipboard=${model.clipboard}
                          ></cpk-inspector-copy-button>
                          ${
                            index === lastAssistantIndex &&
                            hasRetry &&
                            !busy &&
                            !state.error
                              ? html`<button
                                type="button"
                                class="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-1 [&>svg]:h-3.5 [&>svg]:w-3.5"
                                title="Retry last prompt"
                                aria-label="Retry last prompt"
                                @click=${actions.retry}
                              >
                                ${model.renderIcon("RotateCcw")}
                              </button>`
                              : nothing
                          }
                        </div>`
                        : nothing
                    }
                  </article>`;
                })}
                ${
                  state.isRunning && lastReasoningIndex < 0
                    ? html`
                        <div
                          class="cpk-playground-message-enter mt-3 flex items-center gap-1 px-1 py-1"
                          aria-label="Agent is working"
                        >
                          <span
                            class="cpk-playground-thinking-dot h-1.5 w-1.5 rounded-full bg-gray-500"
                          ></span>
                          <span
                            class="cpk-playground-thinking-dot h-1.5 w-1.5 rounded-full bg-gray-500"
                          ></span>
                          <span
                            class="cpk-playground-thinking-dot h-1.5 w-1.5 rounded-full bg-gray-500"
                          ></span>
                        </div>
                      `
                    : nothing
                }
                ${
                  !busy &&
                  lastAssistantIndex >= 0 &&
                  model.suggestions.length > 0
                    ? html`<div
                      class="mt-3 flex flex-wrap items-center gap-1.5"
                      data-playground-suggestions
                    >
                      ${model.suggestions.map(
                        (suggestion) => html`<button
                          type="button"
                          class="inline-flex h-7 items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 text-[10px] font-medium leading-none text-gray-900 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-gray-500"
                          ?disabled=${suggestion.isLoading}
                          aria-busy=${suggestion.isLoading ? "true" : "false"}
                          @click=${() => actions.suggestion(suggestion.message)}
                        >
                          ${
                            suggestion.isLoading
                              ? html`<span
                                class="[&>svg]:animate-spin"
                                aria-hidden="true"
                                >${model.renderIcon("LoaderCircle")}</span
                              >`
                              : nothing
                          }
                          <span>${suggestion.title}</span>
                        </button>`,
                      )}
                    </div>`
                    : nothing
                }
              </div>`
        }
      </div>

      ${
        showWelcome
          ? nothing
          : renderPlaygroundComposer(composerModel, actions.composer)
      }
    </div>
  `;
}
