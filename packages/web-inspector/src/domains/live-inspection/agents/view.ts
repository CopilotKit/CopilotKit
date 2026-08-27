import { html, nothing } from "lit";
import type {
  InspectorMessage,
  InspectorToolCall,
  LiveInspectionState,
} from "../state.js";
import { AGENT_SCOPE_POPUP_ID, AGENT_SCOPE_TRIGGER_ID } from "../state.js";

type AgentStats = Readonly<{
  totalEvents: number;
  lastActivity: number | null;
  messages: number;
  toolCalls: number;
  errors: number;
}>;

type ToolError = Readonly<{
  toolCallId?: string;
  message: string;
}> | null;

export type AgentsViewModel = Readonly<{
  agentId: string | null;
  status: "running" | "idle" | "error";
  stats: AgentStats;
  state: unknown;
  hasState: boolean;
  messages: InspectorMessage[] | null;
  toolError: ToolError;
  errorBanner: unknown;
  toolsSection: unknown;
  eventsSection: unknown;
  clipboard?: Pick<Clipboard, "writeText">;
  renderIcon: (name: string) => unknown;
  renderJson: (value: unknown, options?: { maxHeight?: string }) => unknown;
  onViewEvents: () => void;
}>;

export function renderAgentsView(model: AgentsViewModel) {
  if (!model.agentId) {
    return html`${model.errorBanner}<div
      class="flex h-full items-center justify-center px-4 py-8 text-center"
    >
      <div class="max-w-md">
        <div
          class="mb-3 flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8"
        >
          ${model.renderIcon("Bot")}
        </div>
        <p class="text-sm text-gray-600">No agent selected</p>
        <p class="mt-2 text-xs text-gray-500">
          Select an agent from the dropdown above to view details.
        </p>
      </div>
    </div>`;
  }
  const statusClasses = {
    running: "bg-emerald-50 text-emerald-700",
    idle: "bg-gray-100 text-gray-600",
    error: "bg-rose-50 text-rose-700",
  };
  return html`<div class="cpk-agent-view flex flex-col gap-4 p-4 overflow-auto">
    ${model.errorBanner}
    <div class="cpk-agent-overview rounded-lg border border-gray-200 bg-white p-4">
      <div class="flex items-start justify-between mb-4">
        <div class="flex items-center gap-3">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 cpk-agent-icon"
          >
            ${model.renderIcon("Bot")}
          </div>
          <div>
            <h3 class="font-semibold text-sm text-gray-900">${model.agentId}</h3>
            <span
              class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                statusClasses[model.status]
              } relative -translate-y-[2px]"
            >
              <span
                aria-hidden="true"
                class="h-1.5 w-1.5 rounded-full ${
                  model.status === "running"
                    ? "bg-emerald-500 animate-pulse"
                    : model.status === "error"
                      ? "bg-rose-500"
                      : "bg-gray-400"
                }"
              ></span>
              ${model.status.charAt(0).toUpperCase() + model.status.slice(1)}
            </span>
          </div>
        </div>
        ${
          model.stats.lastActivity
            ? html`<span class="text-xs text-gray-500"
              >Last activity:
              ${new Date(model.stats.lastActivity).toLocaleTimeString()}</span
            >`
            : nothing
        }
      </div>
      <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
        <button
          type="button"
          class="live-inspection-control rounded-md bg-gray-50 px-3 py-2 text-left transition hover:bg-gray-100 cursor-pointer overflow-hidden cpk-stat-card"
          @click=${model.onViewEvents}
          title="View all events in AG-UI Events"
        >
          ${renderStat("Total Events", model.stats.totalEvents)}
        </button>
        <div class="rounded-md bg-gray-50 px-3 py-2 overflow-hidden cpk-stat-card">
          ${renderStat("Messages", model.stats.messages)}
        </div>
        <div class="rounded-md bg-gray-50 px-3 py-2 overflow-hidden cpk-stat-card">
          ${renderStat("Tool Calls", model.stats.toolCalls)}
        </div>
        <div class="rounded-md bg-gray-50 px-3 py-2 overflow-hidden cpk-stat-card">
          ${renderStat("Errors", model.stats.errors)}
        </div>
      </div>
    </div>
    <div class="cpk-section-card">
      <div class="cpk-section-header"><h4>Current State</h4></div>
      <div class="overflow-auto p-4">
        ${
          model.hasState
            ? model.renderJson(model.state, { maxHeight: "16rem" })
            : renderEmpty("Database", "State is empty", model)
        }
      </div>
    </div>
    <div class="cpk-section-card">
      <div class="cpk-section-header"><h4>Current Messages</h4></div>
      <div class="overflow-auto">
        ${renderMessages(model)}
      </div>
    </div>
    ${model.toolsSection}
    <div class="cpk-section-card overflow-hidden">
      <div class="cpk-section-header"><h4>AG-UI Events</h4></div>
      ${model.eventsSection}
    </div>
  </div>`;
}

function renderStat(label: string, value: number) {
  return html`<div class="truncate whitespace-nowrap text-xs text-gray-600">
      ${label}
    </div>
    <div class="text-lg font-semibold text-gray-900">${value}</div>`;
}

function renderEmpty(icon: string, label: string, model: AgentsViewModel) {
  return html`<div
    class="flex h-12 items-center justify-center text-xs text-gray-500"
  >
    <div class="flex items-center gap-2 text-gray-500">
      <span aria-hidden="true" class="text-lg text-gray-400"
        >${model.renderIcon(icon)}</span
      >
      <span>${label}</span>
    </div>
  </div>`;
}

function renderMessages(model: AgentsViewModel) {
  if (!model.messages?.length) {
    return renderEmpty("MessageSquare", "No messages available", model);
  }
  return html`<div class="w-full text-xs">
    <div class="cpk-agent-messages-head flex bg-gray-50">
      <div class="w-40 shrink-0 px-4 py-2 font-medium text-gray-700">Role</div>
      <div class="flex-1 px-4 py-2 font-medium text-gray-700">Content</div>
    </div>
    <div class="cpk-agent-messages-rows">
      ${model.messages.map((message) => renderMessage(message, model))}
    </div>
  </div>`;
}

function renderMessage(message: InspectorMessage, model: AgentsViewModel) {
  const role = message.role || "unknown";
  const roleClasses: Record<string, string> = {
    user: "bg-blue-100 text-blue-800",
    assistant: "bg-green-100 text-green-800",
    system: "bg-gray-100 text-gray-800",
    tool: "bg-amber-100 text-amber-800",
    unknown: "bg-gray-100 text-gray-600",
  };
  const failed =
    role === "tool" &&
    model.toolError?.toolCallId !== undefined &&
    model.toolError.toolCallId === message.toolCallId;
  return html`<div
    class="cpk-agent-message-row flex items-start ${failed ? "bg-rose-50" : ""}"
    data-cpk-failed-tool-result=${failed ? message.toolCallId : nothing}
  >
    <div class="w-40 shrink-0 px-4 py-2">
      <span
        class="inline-flex rounded px-2 py-0.5 text-[10px] font-medium ${
          roleClasses[role] ?? roleClasses.unknown
        }"
        >${role}</span
      >
    </div>
    <div class="flex-1 px-4 py-2">
      ${
        message.contentText.trim()
          ? html`<div class="whitespace-pre-wrap break-words text-gray-700">${message.contentText}</div>`
          : html`<div class="italic text-gray-400">
            ${message.toolCalls.length ? "Invoked tool call" : "—"}
          </div>`
      }
      ${
        role === "assistant" && message.toolCalls.length
          ? renderToolCalls(message.toolCalls, model)
          : nothing
      }
    </div>
  </div>`;
}

function renderToolCalls(calls: InspectorToolCall[], model: AgentsViewModel) {
  return html`<div class="mt-2 space-y-2">
    ${calls.map((call, index) => {
      const name = call.function?.name ?? call.toolName ?? "Unknown function";
      const id = call.id ?? `tool-call-${index + 1}`;
      const failed = model.toolError?.toolCallId === id;
      const args = call.function?.arguments ?? call.arguments;
      return html`<div
        class="rounded-md border p-3 text-xs ${
          failed
            ? "border-rose-300 bg-rose-50 text-gray-900"
            : "border-gray-200 bg-gray-50 text-gray-700"
        }"
        data-cpk-failed-tool-call=${failed ? id : undefined}
      >
        <div
          class="flex flex-wrap items-center justify-between gap-1 font-medium text-gray-900"
        >
          <span>${name}${failed ? " failed" : ""}</span>
          <span class="text-[10px] text-gray-600">ID: ${id}</span>
        </div>
        ${
          failed && model.toolError?.message
            ? html`<p class="mt-2 break-words leading-relaxed text-gray-800">
              ${model.toolError.message}
            </p>`
            : nothing
        }
        ${
          args === undefined || args === null || args === ""
            ? nothing
            : html`<div class="mt-2">${model.renderJson(args)}</div>`
        }
      </div>`;
    })}
  </div>`;
}

export type AgentScopeDropdownModel = Readonly<{
  state: LiveInspectionState;
  agentsOnly: boolean;
  iconRail: boolean;
  open: boolean;
  renderIcon: (name: string) => unknown;
  onToggle: (event: Event) => void;
  onSelect: (key: string) => void;
  onPointerEnter: (event: PointerEvent) => void;
  onPointerLeave: () => void;
  onFocusIn: () => void;
  onFocusOut: (event: FocusEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}>;

export function renderAgentScopeDropdown(model: AgentScopeDropdownModel) {
  const options = model.agentsOnly
    ? model.state.contextOptions.filter((option) => option.key !== "all-agents")
    : model.state.contextOptions;
  const selectedLabel =
    options.find((option) => option.key === model.state.selectedContext)
      ?.label ?? "";
  const selectedIndex = options.findIndex(
    (option) => option.key === model.state.selectedContext,
  );
  const activeIndex = selectedIndex < 0 ? 0 : selectedIndex;
  return html`<div
    class="relative z-40 min-w-0 flex-1"
    data-context-dropdown-root="true"
    @pointerenter=${model.iconRail ? model.onPointerEnter : nothing}
    @pointerleave=${model.iconRail ? model.onPointerLeave : nothing}
    @focusin=${model.iconRail ? model.onFocusIn : nothing}
    @focusout=${model.iconRail ? model.onFocusOut : nothing}
    @keydown=${model.onKeyDown}
  >
    <button
      id=${AGENT_SCOPE_TRIGGER_ID}
      type="button"
      class="live-inspection-control relative z-40 flex w-full min-w-0 max-w-[240px] items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
      aria-label="Select agent scope: ${selectedLabel}"
      aria-haspopup="menu"
      aria-expanded=${model.open ? "true" : "false"}
      aria-controls=${AGENT_SCOPE_POPUP_ID}
      title=${selectedLabel}
      @click=${model.onToggle}
    >
      <span class="inspector-context-dropdown-icon shrink-0" aria-hidden="true"
        >${model.renderIcon("Bot")}</span
      >
      <span class="inspector-context-dropdown-label truncate flex-1 text-left"
        >${selectedLabel}</span
      >
      <span
        class="inspector-context-dropdown-chevron shrink-0 text-gray-400"
        aria-hidden="true"
        >${model.renderIcon("ChevronDown")}</span
      >
    </button>
    ${
      model.open
        ? html`<div
          id=${AGENT_SCOPE_POPUP_ID}
          role="menu"
          aria-labelledby=${AGENT_SCOPE_TRIGGER_ID}
          class="absolute left-0 z-50 mt-1.5 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-md ring-1 ring-black/5${
            model.iconRail ? " inspector-icon-rail-menu" : ""
          }"
          data-context-dropdown-root="true"
          data-open="true"
          @keydown=${handleAgentScopeMenuKeyDown}
        >
          ${options.map(
            (option, index) => html`<button
              type="button"
              role="menuitemradio"
              aria-checked=${
                option.key === model.state.selectedContext ? "true" : "false"
              }
              tabindex=${index === activeIndex ? "0" : "-1"}
              class="live-inspection-control flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-gray-50 focus:bg-gray-50"
              data-context-dropdown-root="true"
              @click=${() => model.onSelect(option.key)}
            >
              <span
                class="truncate ${
                  option.key === model.state.selectedContext
                    ? "text-gray-900 font-medium"
                    : "text-gray-600"
                }"
                >${option.label}</span
              >
              ${
                option.key === model.state.selectedContext
                  ? html`<span aria-hidden="true" class="text-gray-500"
                    >${model.renderIcon("Check")}</span
                  >`
                  : nothing
              }
            </button>`,
          )}
        </div>`
        : nothing
    }
  </div>`;
}

function isOwnerRealmHtmlElement(
  target: EventTarget | null,
): target is HTMLElement {
  if (target === null) return false;
  const ownerDocument = Reflect.get(target, "ownerDocument");
  if (typeof ownerDocument !== "object" || ownerDocument === null) return false;
  const ownerWindow = Reflect.get(ownerDocument, "defaultView");
  if (typeof ownerWindow !== "object" || ownerWindow === null) return false;
  const ElementConstructor = Reflect.get(ownerWindow, "HTMLElement");
  return (
    typeof ElementConstructor === "function" &&
    target instanceof ElementConstructor
  );
}

function focusMenuItem(items: HTMLButtonElement[], index: number): void {
  items.forEach((item, itemIndex) => {
    item.tabIndex = itemIndex === index ? 0 : -1;
  });
  items[index]?.focus();
}

function handleAgentScopeMenuKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape" || event.key === "Tab") return;
  const menu = event.currentTarget;
  if (!isOwnerRealmHtmlElement(menu)) return;
  const items = Array.from(
    menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
  );
  if (items.length === 0) return;
  const currentIndex = items.findIndex((item) => item === event.target);
  let nextIndex: number | undefined;
  if (event.key === "ArrowDown") {
    nextIndex = (Math.max(currentIndex, 0) + 1) % items.length;
  } else if (event.key === "ArrowUp") {
    nextIndex =
      (currentIndex < 0 ? items.length : currentIndex - 1 + items.length) %
      items.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = items.length - 1;
  } else if (
    event.key.length === 1 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    const query = event.key.toLocaleLowerCase();
    for (let offset = 1; offset <= items.length; offset += 1) {
      const candidateIndex =
        (Math.max(currentIndex, 0) + offset) % items.length;
      if (
        items[candidateIndex]?.textContent
          ?.trim()
          .toLocaleLowerCase()
          .startsWith(query)
      ) {
        nextIndex = candidateIndex;
        break;
      }
    }
  }
  if (nextIndex === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  focusMenuItem(items, nextIndex);
}
