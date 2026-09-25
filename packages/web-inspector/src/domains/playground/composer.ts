import { html, nothing } from "lit";
import { isPlaygroundTextAreaElement } from "./element-guards.js";
import type { PlaygroundState } from "./state.js";

export interface PlaygroundComposerController {
  state: PlaygroundState;
  selectedAgentId: string | null;
  createMessageId: () => string;
  startSession: (preferredAgentId?: string) => void;
  syncMessages: () => void;
  runAgent: () => Promise<void>;
  requestUpdate: () => void;
}

export function sendPlaygroundMessage(
  controller: PlaygroundComposerController,
  content: string,
): void {
  const { state } = controller;
  if (!content || state.isRunning || state.isLoadingThread) return;
  if (!state.agent || state.agentId !== controller.selectedAgentId) {
    controller.startSession(controller.selectedAgentId ?? undefined);
  }
  if (!state.agent) return;

  state.agent.addMessage({
    id: controller.createMessageId(),
    role: "user",
    content,
  });
  state.input = "";
  controller.syncMessages();
  void controller.runAgent();
}

export function retryPlaygroundRun(
  controller: PlaygroundComposerController,
): void {
  const { state } = controller;
  const agent = state.agent;
  if (!agent || state.isRunning) return;
  let lastUserIndex = -1;
  for (let index = agent.messages.length - 1; index >= 0; index -= 1) {
    if (agent.messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) return;
  agent.setMessages(agent.messages.slice(0, lastUserIndex + 1));
  controller.syncMessages();
  void controller.runAgent();
}

export function updatePlaygroundInput(
  state: PlaygroundState,
  event: Event,
  requestUpdate: () => void,
): void {
  const input = event.currentTarget;
  if (!isPlaygroundTextAreaElement(input)) return;
  state.input = input.value;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  requestUpdate();
}

export function submitPlaygroundOnEnter(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.shiftKey) return;
  const input = event.currentTarget;
  if (!isPlaygroundTextAreaElement(input)) return;
  event.preventDefault();
  input.form?.requestSubmit();
}

export interface PlaygroundComposerViewModel {
  state: PlaygroundState;
  agentId: string | null;
  busy: boolean;
  hasRetry: boolean;
  centered?: boolean;
  renderIcon: (name: "ArrowUp" | "Square" | "TriangleAlert") => unknown;
}

export interface PlaygroundComposerViewActions {
  submit: (event: SubmitEvent) => void;
  input: (event: Event) => void;
  keyDown: (event: KeyboardEvent) => void;
  retry: () => void;
  stop: () => void;
}

export function renderPlaygroundComposer(
  model: PlaygroundComposerViewModel,
  actions: PlaygroundComposerViewActions,
) {
  const { state } = model;
  const placeholder = !model.agentId
    ? "Waiting for an agent..."
    : state.isLoadingThread
      ? "Loading thread..."
      : "Type a message...";
  const sendDisabled =
    !model.agentId ||
    state.isLoadingThread ||
    (!state.isRunning && !state.input.trim());

  return html`
    <form
      class=${
        model.centered
          ? "cpk-playground-form mt-5 w-full"
          : "cpk-playground-form bg-white px-3 pb-3 pt-1.5"
      }
      @submit=${actions.submit}
    >
      ${
        state.error
          ? html`<div
            class="mx-auto mb-2 flex max-w-3xl items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[10px] text-rose-950"
            role="alert"
            data-playground-error
          >
            <span class="mt-0.5 shrink-0"
              >${model.renderIcon("TriangleAlert")}</span
            >
            <div class="min-w-0 flex-1">
              <p class="font-semibold">Agent run failed</p>
              <p class="mt-0.5 break-words leading-relaxed">${state.error}</p>
            </div>
            ${
              model.hasRetry
                ? html`<button
                  type="button"
                  class="shrink-0 rounded-md border border-rose-200 bg-white px-2 py-1 font-medium text-rose-700 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-1 disabled:opacity-50"
                  ?disabled=${model.busy}
                  @click=${actions.retry}
                >
                  Retry
                </button>`
                : nothing
            }
          </div>`
          : nothing
      }
      <div
        class="cpk-playground-composer mx-auto flex max-w-3xl items-end gap-1.5 rounded-[28px] bg-white px-2.5 py-1.5 shadow-[0_4px_4px_0_#0000000a,0_0_1px_0_#0000009e] transition-shadow duration-200 focus-within:shadow-[0_6px_18px_0_#00000014,0_0_1px_0_#0000009e]"
      >
        <textarea
          class="cpk-playground-input min-h-[40px] max-h-32 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-[13px] leading-5 text-gray-900 outline-none placeholder:text-gray-500 disabled:cursor-not-allowed disabled:opacity-60"
          rows="1"
          placeholder=${placeholder}
          aria-label="Playground message"
          .value=${state.input}
          ?disabled=${!model.agentId || model.busy}
          @input=${actions.input}
          @keydown=${actions.keyDown}
        ></textarea>
        <button
          type=${state.isRunning ? "button" : "submit"}
          class=${`cpk-playground-send mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 [&>svg]:h-[18px] [&>svg]:w-[18px] ${
            sendDisabled
              ? "cursor-not-allowed bg-[#00000014] text-[rgb(13,13,13)] opacity-50"
              : "cursor-pointer bg-black text-white hover:opacity-70 active:opacity-60"
          }`}
          aria-label=${
            state.isRunning ? "Stop agent" : "Send playground message"
          }
          ?disabled=${sendDisabled}
          @click=${state.isRunning ? actions.stop : nothing}
        >
          ${model.renderIcon(state.isRunning ? "Square" : "ArrowUp")}
        </button>
      </div>
      <p
        class="mx-auto max-w-3xl px-3 py-2 text-center text-[10px] leading-4 text-gray-500"
      >
        AI can make mistakes. Please verify important information.
      </p>
    </form>
  `;
}
