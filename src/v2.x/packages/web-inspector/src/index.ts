import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import tailwindStyles from "./styles/generated.css";
import inspectorLogoUrl from "./assets/inspector-logo.svg";
import inspectorLogoIconUrl from "./assets/inspector-logo-icon.svg";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { marked } from "marked";
import { icons } from "lucide";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  type CopilotKitCoreSubscriber,
  type CopilotKitCoreErrorCode,
} from "@copilotkitnext/core";
import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import type { Anchor, ContextKey, ContextState, DockMode, Position, Size } from "./lib/types";
import {
  applyAnchorPosition as applyAnchorPositionHelper,
  centerContext as centerContextHelper,
  constrainToViewport,
  keepPositionWithinViewport,
  updateAnchorFromPosition as updateAnchorFromPositionHelper,
  updateSizeFromElement,
  clampSize as clampSizeToViewport,
} from "./lib/context-helpers";
import {
  loadInspectorState,
  saveInspectorState,
  type PersistedState,
  isValidAnchor,
  isValidPosition,
  isValidSize,
  isValidDockMode,
} from "./lib/persistence";

export const WEB_INSPECTOR_TAG = "cpk-web-inspector" as const;

type LucideIconName = keyof typeof icons;

type MenuKey = "ag-ui-events" | "agents" | "frontend-tools" | "agent-context";

type MenuItem = {
  key: MenuKey;
  label: string;
  icon: LucideIconName;
};

const EDGE_MARGIN = 16;
const DRAG_THRESHOLD = 6;
const MIN_WINDOW_WIDTH = 600;
const MIN_WINDOW_WIDTH_DOCKED_LEFT = 420;
const MIN_WINDOW_HEIGHT = 200;
const INSPECTOR_STORAGE_KEY = "cpk:inspector:state";
const ANNOUNCEMENT_STORAGE_KEY = "cpk:inspector:announcements";
const ANNOUNCEMENT_URL = "https://cdn.copilotkit.ai/announcements.json";
const DEFAULT_BUTTON_SIZE: Size = { width: 48, height: 48 };
const DEFAULT_WINDOW_SIZE: Size = { width: 840, height: 560 };
const DOCKED_LEFT_WIDTH = 500; // Sensible width for left dock with collapsed sidebar
const MAX_AGENT_EVENTS = 200;
const MAX_TOTAL_EVENTS = 500;

type InspectorAgentEventType =
  | "RUN_STARTED"
  | "RUN_FINISHED"
  | "RUN_ERROR"
  | "TEXT_MESSAGE_START"
  | "TEXT_MESSAGE_CONTENT"
  | "TEXT_MESSAGE_END"
  | "TOOL_CALL_START"
  | "TOOL_CALL_ARGS"
  | "TOOL_CALL_END"
  | "TOOL_CALL_RESULT"
  | "STATE_SNAPSHOT"
  | "STATE_DELTA"
  | "MESSAGES_SNAPSHOT"
  | "RAW_EVENT"
  | "CUSTOM_EVENT";

const AGENT_EVENT_TYPES: readonly InspectorAgentEventType[] = [
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "TEXT_MESSAGE_START",
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_END",
  "TOOL_CALL_START",
  "TOOL_CALL_ARGS",
  "TOOL_CALL_END",
  "TOOL_CALL_RESULT",
  "STATE_SNAPSHOT",
  "STATE_DELTA",
  "MESSAGES_SNAPSHOT",
  "RAW_EVENT",
  "CUSTOM_EVENT",
] as const;

type SanitizedValue =
  | string
  | number
  | boolean
  | null
  | SanitizedValue[]
  | { [key: string]: SanitizedValue };

type InspectorToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: SanitizedValue | string;
  };
  toolName?: string;
  status?: string;
};

type InspectorMessage = {
  id?: string;
  role: string;
  contentText: string;
  contentRaw?: SanitizedValue;
  toolCalls: InspectorToolCall[];
};

type InspectorToolDefinition = {
  agentId: string;
  name: string;
  description?: string;
  parameters?: unknown;
  type: "handler" | "renderer";
};

type InspectorEvent = {
  id: string;
  agentId: string;
  type: InspectorAgentEventType;
  timestamp: number;
  payload: SanitizedValue;
};

export class WebInspectorElement extends LitElement {
  static properties = {
    core: { attribute: false },
    autoAttachCore: { type: Boolean, attribute: "auto-attach-core" },
  } as const;

  private _core: CopilotKitCore | null = null;
  private coreSubscriber: CopilotKitCoreSubscriber | null = null;
  private coreUnsubscribe: (() => void) | null = null;
  private runtimeStatus: CopilotKitCoreRuntimeConnectionStatus | null = null;
  private coreProperties: Readonly<Record<string, unknown>> = {};
  private lastCoreError: { code: CopilotKitCoreErrorCode; message: string } | null = null;
  private agentSubscriptions: Map<string, () => void> = new Map();
  private agentEvents: Map<string, InspectorEvent[]> = new Map();
  private agentMessages: Map<string, InspectorMessage[]> = new Map();
  private agentStates: Map<string, SanitizedValue> = new Map();
  private flattenedEvents: InspectorEvent[] = [];
  private eventCounter = 0;
  private contextStore: Record<string, { description?: string; value: unknown }> = {};

  private pointerId: number | null = null;
  private dragStart: Position | null = null;
  private dragOffset: Position = { x: 0, y: 0 };
  private isDragging = false;
  private pointerContext: ContextKey | null = null;
  private isOpen = false;
  private draggedDuringInteraction = false;
  private ignoreNextButtonClick = false;
  private selectedMenu: MenuKey = "ag-ui-events";
  private contextMenuOpen = false;
  private dockMode: DockMode = "floating";
  private previousBodyMargins: { left: string; bottom: string } | null = null;
  private transitionTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private pendingSelectedContext: string | null = null;
  private autoAttachCore = true;
  private attemptedAutoAttach = false;
  private cachedTools: InspectorToolDefinition[] = [];
  private toolSignature = "";
  private eventFilterText = "";
  private eventTypeFilter: InspectorAgentEventType | "all" = "all";

  private announcementMarkdown: string | null = null;
  private announcementHtml: string | null = null;
  private announcementTimestamp: string | null = null;
  private announcementPreviewText: string | null = null;
  private hasUnseenAnnouncement = false;
  private announcementLoaded = false;
  private announcementLoadError: unknown = null;
  private announcementPromise: Promise<void> | null = null;
  private showAnnouncementPreview = true;

  get core(): CopilotKitCore | null {
    return this._core;
  }

  set core(value: CopilotKitCore | null) {
    const oldValue = this._core;
    if (oldValue === value) {
      return;
    }

    this.detachFromCore();

    this._core = value ?? null;
    this.requestUpdate("core", oldValue);

    if (this._core) {
      this.attachToCore(this._core);
    }
  }

  private readonly contextState: Record<ContextKey, ContextState> = {
    button: {
      position: { x: EDGE_MARGIN, y: EDGE_MARGIN },
      size: { ...DEFAULT_BUTTON_SIZE },
      anchor: { horizontal: "right", vertical: "top" },
      anchorOffset: { x: EDGE_MARGIN, y: EDGE_MARGIN },
    },
    window: {
      position: { x: EDGE_MARGIN, y: EDGE_MARGIN },
      size: { ...DEFAULT_WINDOW_SIZE },
      anchor: { horizontal: "right", vertical: "top" },
      anchorOffset: { x: EDGE_MARGIN, y: EDGE_MARGIN },
    },
  };

  private hasCustomPosition: Record<ContextKey, boolean> = {
    button: false,
    window: false,
  };

  private resizePointerId: number | null = null;
  private resizeStart: Position | null = null;
  private resizeInitialSize: { width: number; height: number } | null = null;
  private isResizing = false;

  private readonly menuItems: MenuItem[] = [
    { key: "ag-ui-events", label: "AG-UI Events", icon: "Zap" },
    { key: "agents", label: "Agent", icon: "Bot" },
    { key: "frontend-tools", label: "Frontend Tools", icon: "Hammer" },
    { key: "agent-context", label: "Context", icon: "FileText" },
  ];

  private attachToCore(core: CopilotKitCore): void {
    this.runtimeStatus = core.runtimeConnectionStatus;
    this.coreProperties = core.properties;
    this.lastCoreError = null;

    this.coreSubscriber = {
      onRuntimeConnectionStatusChanged: ({ status }) => {
        this.runtimeStatus = status;
        this.requestUpdate();
      },
      onPropertiesChanged: ({ properties }) => {
        this.coreProperties = properties;
        this.requestUpdate();
      },
      onError: ({ code, error }) => {
        this.lastCoreError = { code, message: error.message };
        this.requestUpdate();
      },
      onAgentsChanged: ({ agents }) => {
        this.processAgentsChanged(agents);
      },
      onContextChanged: ({ context }) => {
        this.contextStore = this.normalizeContextStore(context);
        this.requestUpdate();
      },
    } satisfies CopilotKitCoreSubscriber;

    this.coreUnsubscribe = core.subscribe(this.coreSubscriber).unsubscribe;
    this.processAgentsChanged(core.agents);

    // Initialize context from core
    if (core.context) {
      this.contextStore = this.normalizeContextStore(core.context);
    }
  }

  private detachFromCore(): void {
    if (this.coreUnsubscribe) {
      this.coreUnsubscribe();
      this.coreUnsubscribe = null;
    }
    this.coreSubscriber = null;
    this.runtimeStatus = null;
    this.lastCoreError = null;
    this.coreProperties = {};
    this.cachedTools = [];
    this.toolSignature = "";
    this.teardownAgentSubscriptions();
  }

  private teardownAgentSubscriptions(): void {
    for (const unsubscribe of this.agentSubscriptions.values()) {
      unsubscribe();
    }
    this.agentSubscriptions.clear();
    this.agentEvents.clear();
    this.agentMessages.clear();
    this.agentStates.clear();
    this.flattenedEvents = [];
    this.eventCounter = 0;
  }

  private processAgentsChanged(agents: Readonly<Record<string, AbstractAgent>>): void {
    const seenAgentIds = new Set<string>();

    for (const agent of Object.values(agents)) {
      if (!agent?.agentId) {
        continue;
      }
      seenAgentIds.add(agent.agentId);
      this.subscribeToAgent(agent);
    }

    for (const agentId of Array.from(this.agentSubscriptions.keys())) {
      if (!seenAgentIds.has(agentId)) {
        this.unsubscribeFromAgent(agentId);
        this.agentEvents.delete(agentId);
        this.agentMessages.delete(agentId);
        this.agentStates.delete(agentId);
      }
    }

    this.updateContextOptions(seenAgentIds);
    this.refreshToolsSnapshot();
    this.requestUpdate();
  }

  private refreshToolsSnapshot(): void {
    if (!this._core) {
      if (this.cachedTools.length > 0) {
        this.cachedTools = [];
        this.toolSignature = "";
        this.requestUpdate();
      }
      return;
    }

    const tools = this.extractToolsFromAgents();
    const signature = JSON.stringify(
      tools.map((tool) => ({
        agentId: tool.agentId,
        name: tool.name,
        type: tool.type,
        hasDescription: Boolean(tool.description),
        hasParameters: Boolean(tool.parameters),
      })),
    );

    if (signature !== this.toolSignature) {
      this.toolSignature = signature;
      this.cachedTools = tools;
      this.requestUpdate();
    }
  }

  private tryAutoAttachCore(): void {
    if (this.attemptedAutoAttach || this._core || !this.autoAttachCore || typeof window === "undefined") {
      return;
    }

    this.attemptedAutoAttach = true;

    const globalWindow = window as unknown as Record<string, unknown>;
    const globalCandidates: Array<unknown> = [
      // Common app-level globals used during development
      globalWindow.__COPILOTKIT_CORE__,
      (globalWindow.copilotkit as { core?: unknown } | undefined)?.core,
      globalWindow.copilotkitCore,
    ];

    const foundCore = globalCandidates.find(
      (candidate): candidate is CopilotKitCore => !!candidate && typeof candidate === "object",
    );

    if (foundCore) {
      this.core = foundCore;
    }
  }

  private subscribeToAgent(agent: AbstractAgent): void {
    if (!agent.agentId) {
      return;
    }

    const agentId = agent.agentId;

    this.unsubscribeFromAgent(agentId);

    const subscriber: AgentSubscriber = {
      onRunStartedEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "RUN_STARTED", event);
      },
      onRunFinishedEvent: ({ event, result }) => {
        this.recordAgentEvent(agentId, "RUN_FINISHED", { event, result });
      },
      onRunErrorEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "RUN_ERROR", event);
      },
      onTextMessageStartEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "TEXT_MESSAGE_START", event);
      },
      onTextMessageContentEvent: ({ event, textMessageBuffer }) => {
        this.recordAgentEvent(agentId, "TEXT_MESSAGE_CONTENT", { event, textMessageBuffer });
      },
      onTextMessageEndEvent: ({ event, textMessageBuffer }) => {
        this.recordAgentEvent(agentId, "TEXT_MESSAGE_END", { event, textMessageBuffer });
      },
      onToolCallStartEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "TOOL_CALL_START", event);
      },
      onToolCallArgsEvent: ({ event, toolCallBuffer, toolCallName, partialToolCallArgs }) => {
        this.recordAgentEvent(agentId, "TOOL_CALL_ARGS", { event, toolCallBuffer, toolCallName, partialToolCallArgs });
      },
      onToolCallEndEvent: ({ event, toolCallArgs, toolCallName }) => {
        this.recordAgentEvent(agentId, "TOOL_CALL_END", { event, toolCallArgs, toolCallName });
      },
      onToolCallResultEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "TOOL_CALL_RESULT", event);
      },
      onStateSnapshotEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "STATE_SNAPSHOT", event);
        this.syncAgentState(agent);
      },
      onStateDeltaEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "STATE_DELTA", event);
        this.syncAgentState(agent);
      },
      onMessagesSnapshotEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "MESSAGES_SNAPSHOT", event);
        this.syncAgentMessages(agent);
      },
      onMessagesChanged: () => {
        this.syncAgentMessages(agent);
      },
      onRawEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "RAW_EVENT", event);
      },
      onCustomEvent: ({ event }) => {
        this.recordAgentEvent(agentId, "CUSTOM_EVENT", event);
      },
    };

    const { unsubscribe } = agent.subscribe(subscriber);
    this.agentSubscriptions.set(agentId, unsubscribe);
    this.syncAgentMessages(agent);
    this.syncAgentState(agent);

    if (!this.agentEvents.has(agentId)) {
      this.agentEvents.set(agentId, []);
    }
  }

  private unsubscribeFromAgent(agentId: string): void {
    const unsubscribe = this.agentSubscriptions.get(agentId);
    if (unsubscribe) {
      unsubscribe();
      this.agentSubscriptions.delete(agentId);
    }
  }

  private recordAgentEvent(agentId: string, type: InspectorAgentEventType, payload: unknown): void {
    const eventId = `${agentId}:${++this.eventCounter}`;
    const normalizedPayload = this.normalizeEventPayload(type, payload);
    const event: InspectorEvent = {
      id: eventId,
      agentId,
      type,
      timestamp: Date.now(),
      payload: normalizedPayload,
    };

    const currentAgentEvents = this.agentEvents.get(agentId) ?? [];
    const nextAgentEvents = [event, ...currentAgentEvents].slice(0, MAX_AGENT_EVENTS);
    this.agentEvents.set(agentId, nextAgentEvents);

    this.flattenedEvents = [event, ...this.flattenedEvents].slice(0, MAX_TOTAL_EVENTS);
    this.refreshToolsSnapshot();
    this.requestUpdate();
  }

  private syncAgentMessages(agent: AbstractAgent): void {
    if (!agent?.agentId) {
      return;
    }

    const messages = this.normalizeAgentMessages((agent as { messages?: unknown }).messages);
    if (messages) {
      this.agentMessages.set(agent.agentId, messages);
    } else {
      this.agentMessages.delete(agent.agentId);
    }

    this.requestUpdate();
  }

  private syncAgentState(agent: AbstractAgent): void {
    if (!agent?.agentId) {
      return;
    }

    const state = (agent as { state?: unknown }).state;

    if (state === undefined || state === null) {
      this.agentStates.delete(agent.agentId);
    } else {
      this.agentStates.set(agent.agentId, this.sanitizeForLogging(state));
    }

    this.requestUpdate();
  }

  private updateContextOptions(agentIds: Set<string>): void {
    const nextOptions: Array<{ key: string; label: string }> = [
      { key: "all-agents", label: "All Agents" },
      ...Array.from(agentIds)
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ key: id, label: id })),
    ];

    const optionsChanged =
      this.contextOptions.length !== nextOptions.length ||
      this.contextOptions.some((option, index) => option.key !== nextOptions[index]?.key);

    if (optionsChanged) {
      this.contextOptions = nextOptions;
    }

    const pendingContext = this.pendingSelectedContext;
    if (pendingContext) {
      const isPendingAvailable = pendingContext === "all-agents" || agentIds.has(pendingContext);
      if (isPendingAvailable) {
        if (this.selectedContext !== pendingContext) {
          this.selectedContext = pendingContext;
          this.expandedRows.clear();
        }
        this.pendingSelectedContext = null;
      } else if (agentIds.size > 0) {
        // Agents are loaded but the pending selection no longer exists
        this.pendingSelectedContext = null;
      }
    }

    const hasSelectedContext = nextOptions.some((option) => option.key === this.selectedContext);

    if (!hasSelectedContext && this.pendingSelectedContext === null) {
      // Auto-select "default" agent if it exists, otherwise first agent, otherwise "all-agents"
      let nextSelected: string = "all-agents";

      if (agentIds.has("default")) {
        nextSelected = "default";
      } else if (agentIds.size > 0) {
        nextSelected = Array.from(agentIds).sort((a, b) => a.localeCompare(b))[0]!;
      }

      if (this.selectedContext !== nextSelected) {
        this.selectedContext = nextSelected;
        this.expandedRows.clear();
        this.persistState();
      }
    }
  }

  private getEventsForSelectedContext(): InspectorEvent[] {
    if (this.selectedContext === "all-agents") {
      return this.flattenedEvents;
    }

    return this.agentEvents.get(this.selectedContext) ?? [];
  }

  private filterEvents(events: InspectorEvent[]): InspectorEvent[] {
    const query = this.eventFilterText.trim().toLowerCase();

    return events.filter((event) => {
      if (this.eventTypeFilter !== "all" && event.type !== this.eventTypeFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const payloadText = this.stringifyPayload(event.payload, false).toLowerCase();
      return (
        event.type.toLowerCase().includes(query) ||
        event.agentId.toLowerCase().includes(query) ||
        payloadText.includes(query)
      );
    });
  }

  private getLatestStateForAgent(agentId: string): SanitizedValue | null {
    if (this.agentStates.has(agentId)) {
      const value = this.agentStates.get(agentId);
      return value === undefined ? null : value;
    }

    const events = this.agentEvents.get(agentId) ?? [];
    const stateEvent = events.find((e) => e.type === "STATE_SNAPSHOT");
    if (!stateEvent) {
      return null;
    }
    return stateEvent.payload;
  }

  private getLatestMessagesForAgent(agentId: string): InspectorMessage[] | null {
    const messages = this.agentMessages.get(agentId);
    return messages ?? null;
  }

  private getAgentStatus(agentId: string): "running" | "idle" | "error" {
    const events = this.agentEvents.get(agentId) ?? [];
    if (events.length === 0) {
      return "idle";
    }

    // Check most recent run-related event
    const runEvent = events.find((e) => e.type === "RUN_STARTED" || e.type === "RUN_FINISHED" || e.type === "RUN_ERROR");

    if (!runEvent) {
      return "idle";
    }

    if (runEvent.type === "RUN_ERROR") {
      return "error";
    }

    if (runEvent.type === "RUN_STARTED") {
      // Check if there's a RUN_FINISHED after this
      const finishedAfter = events.find(
        (e) => e.type === "RUN_FINISHED" && e.timestamp > runEvent.timestamp
      );
      return finishedAfter ? "idle" : "running";
    }

    return "idle";
  }

  private getAgentStats(agentId: string): { totalEvents: number; lastActivity: number | null; messages: number; toolCalls: number; errors: number } {
    const events = this.agentEvents.get(agentId) ?? [];

    const messages = this.agentMessages.get(agentId);

    const toolCallCount = messages
      ? messages.reduce((count, message) => count + (message.toolCalls?.length ?? 0), 0)
      : events.filter((e) => e.type === "TOOL_CALL_END").length;

    const messageCount = messages?.length ?? 0;

    return {
      totalEvents: events.length,
      lastActivity: events[0]?.timestamp ?? null,
      messages: messageCount,
      toolCalls: toolCallCount,
      errors: events.filter((e) => e.type === "RUN_ERROR").length,
    };
  }

  private renderToolCallDetails(toolCalls: InspectorToolCall[]) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return nothing;
    }

    return html`
      <div class="mt-2 space-y-2">
        ${toolCalls.map((call, index) => {
          const functionName = call.function?.name ?? call.toolName ?? "Unknown function";
          const callId = typeof call?.id === "string" ? call.id : `tool-call-${index + 1}`;
          const argsString = this.formatToolCallArguments(call.function?.arguments);
          return html`
            <div class="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
              <div class="flex flex-wrap items-center justify-between gap-1 font-medium text-gray-900">
                <span>${functionName}</span>
                <span class="text-[10px] text-gray-500">ID: ${callId}</span>
              </div>
              ${argsString
                ? html`<pre class="mt-2 overflow-auto rounded bg-white p-2 text-[11px] leading-relaxed text-gray-800">${argsString}</pre>`
                : nothing}
            </div>
          `;
        })}
      </div>
    `;
  }

  private formatToolCallArguments(args: unknown): string | null {
    if (args === undefined || args === null || args === '') {
      return null;
    }

    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return args;
      }
    }

    if (typeof args === 'object') {
      try {
        return JSON.stringify(args, null, 2);
      } catch {
        return String(args);
      }
    }

    return String(args);
  }

  private hasRenderableState(state: unknown): boolean {
    if (state === null || state === undefined) {
      return false;
    }

    if (Array.isArray(state)) {
      return state.length > 0;
    }

    if (typeof state === 'object') {
      return Object.keys(state as Record<string, unknown>).length > 0;
    }

    if (typeof state === 'string') {
      const trimmed = state.trim();
      return trimmed.length > 0 && trimmed !== '{}';
    }

    return true;
  }

  private formatStateForDisplay(state: unknown): string {
    if (state === null || state === undefined) {
      return '';
    }

    if (typeof state === 'string') {
      const trimmed = state.trim();
      if (trimmed.length === 0) {
        return '';
      }
      try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return state;
      }
    }

    if (typeof state === 'object') {
      try {
        return JSON.stringify(state, null, 2);
      } catch {
        return String(state);
      }
    }

    return String(state);
  }

  private getEventBadgeClasses(type: string): string {
    const base = "font-mono text-[10px] font-medium inline-flex items-center rounded-sm px-1.5 py-0.5 border";

    if (type.startsWith("RUN_")) {
      return `${base} bg-blue-50 text-blue-700 border-blue-200`;
    }

    if (type.startsWith("TEXT_MESSAGE")) {
      return `${base} bg-emerald-50 text-emerald-700 border-emerald-200`;
    }

    if (type.startsWith("TOOL_CALL")) {
      return `${base} bg-amber-50 text-amber-700 border-amber-200`;
    }

    if (type.startsWith("STATE")) {
      return `${base} bg-violet-50 text-violet-700 border-violet-200`;
    }

    if (type.startsWith("MESSAGES")) {
      return `${base} bg-sky-50 text-sky-700 border-sky-200`;
    }

    if (type === "RUN_ERROR") {
      return `${base} bg-rose-50 text-rose-700 border-rose-200`;
    }

    return `${base} bg-gray-100 text-gray-600 border-gray-200`;
  }

  private stringifyPayload(payload: unknown, pretty: boolean): string {
    try {
      if (payload === undefined) {
        return pretty ? "undefined" : "undefined";
      }
      if (typeof payload === "string") {
        return payload;
      }
      return JSON.stringify(payload, null, pretty ? 2 : 0) ?? "";
    } catch (error) {
      console.warn("Failed to stringify inspector payload", error);
      return String(payload);
    }
  }

  private extractEventFromPayload(payload: unknown): unknown {
    // If payload is an object with an 'event' field, extract it
    if (payload && typeof payload === "object" && "event" in payload) {
      return (payload as Record<string, unknown>).event;
    }
    // Otherwise, assume the payload itself is the event
    return payload;
  }

  private async copyToClipboard(text: string, eventId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copiedEvents.add(eventId);
      this.requestUpdate();

      // Clear the "copied" state after 2 seconds
      setTimeout(() => {
        this.copiedEvents.delete(eventId);
        this.requestUpdate();
      }, 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  }

  static styles = [
    unsafeCSS(tailwindStyles),
    css`
      :host {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 2147483646;
        display: block;
        will-change: transform;
      }

      :host([data-transitioning="true"]) {
        transition: transform 300ms ease;
      }

      .console-button {
        transition:
          transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
          opacity 160ms ease;
      }

      .console-button[data-dragging="true"] {
        transition: opacity 160ms ease;
      }

      .inspector-window[data-transitioning="true"] {
        transition: width 300ms ease, height 300ms ease;
      }

      .inspector-window[data-docked="true"] {
        border-radius: 0 !important;
        box-shadow: none !important;
      }

      .resize-handle {
        touch-action: none;
        user-select: none;
      }

      .dock-resize-handle {
        position: absolute;
        top: 0;
        right: 0;
        width: 10px;
        height: 100%;
        cursor: ew-resize;
        touch-action: none;
        z-index: 50;
        background: transparent;
      }

      .tooltip-target {
        position: relative;
      }

      .tooltip-target::after {
        content: attr(data-tooltip);
        position: absolute;
        top: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%) translateY(-4px);
        white-space: nowrap;
        background: rgba(17, 24, 39, 0.95);
        color: white;
        padding: 4px 8px;
        border-radius: 6px;
        font-size: 10px;
        line-height: 1.2;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
        opacity: 0;
        pointer-events: none;
        transition: opacity 120ms ease, transform 120ms ease;
        z-index: 4000;
      }

      .tooltip-target:hover::after {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      .announcement-preview {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        min-width: 300px;
        max-width: 300px;
        background: white;
        color: #111827;
        font-size: 13px;
        line-height: 1.4;
        border-radius: 12px;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.22);
        padding: 10px 12px;
        display: inline-flex;
        align-items: flex-start;
        gap: 8px;
        z-index: 4500;
        animation: fade-slide-in 160ms ease;
        border: 1px solid rgba(148, 163, 184, 0.35);
        white-space: normal;
        word-break: break-word;
        text-align: left;
      }

      .announcement-preview[data-side="left"] {
        right: 100%;
        margin-right: 10px;
      }

      .announcement-preview[data-side="right"] {
        left: 100%;
        margin-left: 10px;
      }

      .announcement-preview__arrow {
        position: absolute;
        width: 10px;
        height: 10px;
        background: white;
        border: 1px solid rgba(148, 163, 184, 0.35);
        transform: rotate(45deg);
        top: 50%;
        margin-top: -5px;
        z-index: -1;
      }

      .announcement-preview[data-side="left"] .announcement-preview__arrow {
        right: -5px;
        box-shadow: 6px -6px 10px rgba(15, 23, 42, 0.12);
      }

      .announcement-preview[data-side="right"] .announcement-preview__arrow {
        left: -5px;
        box-shadow: -6px 6px 10px rgba(15, 23, 42, 0.12);
      }

      .announcement-dismiss {
        color: #6b7280;
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.5);
        background: rgba(248, 250, 252, 0.9);
        transition: background 120ms ease, color 120ms ease;
      }

      .announcement-dismiss:hover {
        background: rgba(241, 245, 249, 1);
        color: #111827;
      }

      .announcement-content {
        color: #111827;
        font-size: 14px;
        line-height: 1.6;
      }

      .announcement-content h1,
      .announcement-content h2,
      .announcement-content h3 {
        font-weight: 700;
        margin: 0.4rem 0 0.2rem;
      }

      .announcement-content h1 {
        font-size: 1.1rem;
      }

      .announcement-content h2 {
        font-size: 1rem;
      }

      .announcement-content h3 {
        font-size: 0.95rem;
      }

      .announcement-content p {
        margin: 0.25rem 0;
      }

      .announcement-content ul {
        list-style: disc;
        padding-left: 1.25rem;
        margin: 0.3rem 0;
      }

      .announcement-content ol {
        list-style: decimal;
        padding-left: 1.25rem;
        margin: 0.3rem 0;
      }

      .announcement-content a {
        color: #0f766e;
        text-decoration: underline;
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this.handleResize);
      window.addEventListener("pointerdown", this.handleGlobalPointerDown as EventListener);

      // Load state early (before first render) so menu selection is correct
      this.hydrateStateFromStorageEarly();
      this.tryAutoAttachCore();
      this.ensureAnnouncementLoading();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.handleResize);
      window.removeEventListener("pointerdown", this.handleGlobalPointerDown as EventListener);
    }
    this.removeDockStyles(); // Clean up any docking styles
    this.detachFromCore();
  }

  firstUpdated(): void {
    if (typeof window === "undefined") {
      return;
    }

    if (!this._core) {
      this.tryAutoAttachCore();
    }

    this.measureContext("button");
    this.measureContext("window");

    this.contextState.button.anchor = { horizontal: "right", vertical: "top" };
    this.contextState.button.anchorOffset = { x: EDGE_MARGIN, y: EDGE_MARGIN };

    this.contextState.window.anchor = { horizontal: "right", vertical: "top" };
    this.contextState.window.anchorOffset = { x: EDGE_MARGIN, y: EDGE_MARGIN };

    this.hydrateStateFromStorage();

    // Apply docking styles if open and docked (skip transition on initial load)
    if (this.isOpen && this.dockMode !== 'floating') {
      this.applyDockStyles(true);
    }

    this.applyAnchorPosition("button");

    if (this.dockMode === 'floating') {
      if (this.hasCustomPosition.window) {
        this.applyAnchorPosition("window");
      } else {
        this.centerContext("window");
      }
    }

    this.ensureAnnouncementLoading();

    this.updateHostTransform(this.isOpen ? "window" : "button");
  }

  render() {
    return this.isOpen ? this.renderWindow() : this.renderButton();
  }

  private renderButton() {
    const buttonClasses = [
      "console-button",
      "group",
      "relative",
      "pointer-events-auto",
      "inline-flex",
      "h-12",
      "w-12",
      "items-center",
      "justify-center",
      "rounded-full",
      "border",
      "border-white/20",
      "bg-slate-950/95",
      "text-xs",
      "font-medium",
      "text-white",
      "ring-1",
      "ring-white/10",
      "backdrop-blur-md",
      "transition",
      "hover:border-white/30",
      "hover:bg-slate-900/95",
      "hover:scale-105",
      "focus-visible:outline",
      "focus-visible:outline-2",
      "focus-visible:outline-offset-2",
      "focus-visible:outline-rose-500",
      "touch-none",
      "select-none",
      this.isDragging ? "cursor-grabbing" : "cursor-grab",
    ].join(" ");

    return html`
      <button
        class=${buttonClasses}
        type="button"
        aria-label="Web Inspector"
        data-drag-context="button"
        data-dragging=${this.isDragging && this.pointerContext === "button" ? "true" : "false"}
        @pointerdown=${this.handlePointerDown}
        @pointermove=${this.handlePointerMove}
        @pointerup=${this.handlePointerUp}
        @pointercancel=${this.handlePointerCancel}
        @click=${this.handleButtonClick}
      >
        ${this.renderAnnouncementPreview()}
        <img src=${inspectorLogoIconUrl} alt="Inspector logo" class="h-5 w-auto" loading="lazy" />
      </button>
    `;
  }

  private renderWindow() {
    const windowState = this.contextState.window;
    const isDocked = this.dockMode !== 'floating';
    const isTransitioning = this.hasAttribute('data-transitioning');

    const windowStyles = isDocked
      ? this.getDockedWindowStyles()
      : {
          width: `${Math.round(windowState.size.width)}px`,
          height: `${Math.round(windowState.size.height)}px`,
          minWidth: `${MIN_WINDOW_WIDTH}px`,
          minHeight: `${MIN_WINDOW_HEIGHT}px`,
        };

    const hasContextDropdown = this.contextOptions.length > 0;
    const contextDropdown = hasContextDropdown ? this.renderContextDropdown() : nothing;
    const coreStatus = this.getCoreStatusSummary();
    const agentSelector = hasContextDropdown
      ? contextDropdown
      : html`
          <div class="flex items-center gap-2 rounded-md border border-dashed border-gray-200 px-2 py-1 text-xs text-gray-400">
            <span>${this.renderIcon("Bot")}</span>
            <span class="truncate">No agents available</span>
          </div>
        `;

    return html`
      <section
        class="inspector-window pointer-events-auto relative flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-gray-900 shadow-lg"
        style=${styleMap(windowStyles)}
        data-docked=${isDocked}
        data-transitioning=${isTransitioning}
      >
        ${isDocked
          ? html`
              <div
                class="dock-resize-handle pointer-events-auto"
                role="presentation"
                aria-hidden="true"
                @pointerdown=${this.handleResizePointerDown}
                @pointermove=${this.handleResizePointerMove}
                @pointerup=${this.handleResizePointerUp}
                @pointercancel=${this.handleResizePointerCancel}
              ></div>
            `
          : nothing}
        <div class="flex flex-1 flex-col overflow-hidden bg-white text-gray-800">
          <div
            class="drag-handle relative z-30 flex flex-col border-b border-gray-200 bg-white/95 backdrop-blur-sm ${isDocked ? '' : (this.isDragging && this.pointerContext === 'window' ? 'cursor-grabbing' : 'cursor-grab')}"
            data-drag-context="window"
            @pointerdown=${isDocked ? undefined : this.handlePointerDown}
            @pointermove=${isDocked ? undefined : this.handlePointerMove}
            @pointerup=${isDocked ? undefined : this.handlePointerUp}
            @pointercancel=${isDocked ? undefined : this.handlePointerCancel}
          >
            <div class="flex flex-wrap items-center gap-3 px-4 py-3">
              <div class="flex items-center min-w-0">
                <img src=${inspectorLogoUrl} alt="Inspector logo" class="h-6 w-auto" loading="lazy" />
              </div>
              <div class="ml-auto flex min-w-0 items-center gap-2">
                <div class="min-w-[160px] max-w-xs">
                  ${agentSelector}
                </div>
                <div class="flex items-center gap-1">
                  ${this.renderDockControls()}
                  <button
                    class="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
                    type="button"
                    aria-label="Close Web Inspector"
                    @pointerdown=${this.handleClosePointerDown}
                    @click=${this.handleCloseClick}
                  >
                    ${this.renderIcon("X")}
                  </button>
                </div>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 border-t border-gray-100 px-3 py-2 text-xs">
              ${this.menuItems.map(({ key, label, icon }) => {
                const isSelected = this.selectedMenu === key;
                const tabClasses = [
                  "inline-flex items-center gap-2 rounded-md px-3 py-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-300",
                  isSelected ? "bg-gray-900 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                ].join(" ");

                return html`
                  <button
                    type="button"
                    class=${tabClasses}
                    aria-pressed=${isSelected}
                    @click=${() => this.handleMenuSelect(key)}
                  >
                    <span class="text-gray-400 ${isSelected ? 'text-white' : ''}">
                      ${this.renderIcon(icon)}
                    </span>
                    <span>${label}</span>
                  </button>
                `;
              })}
            </div>
          </div>
            <div class="flex flex-1 flex-col overflow-hidden">
              <div class="flex-1 overflow-auto">
                ${this.renderAnnouncementPanel()}
                ${this.renderCoreWarningBanner()}
                ${this.renderMainContent()}
                <slot></slot>
              </div>
              <div class="border-t border-gray-200 bg-gray-50 px-4 py-2">
                <div
                  class="flex items-center gap-2 rounded-md px-3 py-2 text-xs ${coreStatus.tone} w-full overflow-hidden my-1"
                  title=${coreStatus.description}
                >
                  <span class="flex h-6 w-6 items-center justify-center rounded bg-white/60">
                    ${this.renderIcon("Activity")}
                  </span>
                  <span class="font-medium">${coreStatus.label}</span>
                  <span class="truncate text-[11px] opacity-80">${coreStatus.description}</span>
                </div>
              </div>
            </div>
          </div>
        <div
          class="resize-handle pointer-events-auto absolute bottom-1 right-1 flex h-5 w-5 cursor-nwse-resize items-center justify-center text-gray-400 transition hover:text-gray-600"
          role="presentation"
          aria-hidden="true"
          @pointerdown=${this.handleResizePointerDown}
          @pointermove=${this.handleResizePointerMove}
          @pointerup=${this.handleResizePointerUp}
          @pointercancel=${this.handleResizePointerCancel}
        >
          <svg
            class="h-3 w-3"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-width="1.5"
          >
            <path d="M5 15L15 5" />
            <path d="M9 15L15 9" />
          </svg>
        </div>
      </section>
    `;
  }

  private hydrateStateFromStorageEarly(): void {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    const persisted = loadInspectorState(INSPECTOR_STORAGE_KEY);
    if (!persisted) {
      return;
    }

    // Restore the open/closed state
    if (typeof persisted.isOpen === "boolean") {
      this.isOpen = persisted.isOpen;
    }

    // Restore the dock mode
    if (isValidDockMode(persisted.dockMode)) {
      this.dockMode = persisted.dockMode;
    }

    // Restore selected menu
    if (typeof persisted.selectedMenu === "string") {
      const validMenu = this.menuItems.find((item) => item.key === persisted.selectedMenu);
      if (validMenu) {
        this.selectedMenu = validMenu.key;
      }
    }

    // Restore selected context (agent), will be validated later against available agents
    if (typeof persisted.selectedContext === "string") {
      this.selectedContext = persisted.selectedContext;
      this.pendingSelectedContext = persisted.selectedContext;
    }
  }

  private hydrateStateFromStorage(): void {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return;
    }

    const persisted = loadInspectorState(INSPECTOR_STORAGE_KEY);
    if (!persisted) {
      return;
    }

    const persistedButton = persisted.button;
    if (persistedButton) {
      if (isValidAnchor(persistedButton.anchor)) {
        this.contextState.button.anchor = persistedButton.anchor;
      }

      if (isValidPosition(persistedButton.anchorOffset)) {
        this.contextState.button.anchorOffset = persistedButton.anchorOffset;
      }

      if (typeof persistedButton.hasCustomPosition === "boolean") {
        this.hasCustomPosition.button = persistedButton.hasCustomPosition;
      }
    }

    const persistedWindow = persisted.window;
    if (persistedWindow) {
      if (isValidAnchor(persistedWindow.anchor)) {
        this.contextState.window.anchor = persistedWindow.anchor;
      }

      if (isValidPosition(persistedWindow.anchorOffset)) {
        this.contextState.window.anchorOffset = persistedWindow.anchorOffset;
      }

      if (isValidSize(persistedWindow.size)) {
        // Now clampWindowSize will use the correct minimum based on dockMode
        this.contextState.window.size = this.clampWindowSize(persistedWindow.size);
      }

      if (typeof persistedWindow.hasCustomPosition === "boolean") {
        this.hasCustomPosition.window = persistedWindow.hasCustomPosition;
      }
    }

    if (typeof persisted.selectedContext === "string") {
      this.selectedContext = persisted.selectedContext;
      this.pendingSelectedContext = persisted.selectedContext;
    }
  }

  private get activeContext(): ContextKey {
    return this.isOpen ? "window" : "button";
  }

  private handlePointerDown = (event: PointerEvent) => {
    // Don't allow dragging when docked
    if (this.dockMode !== 'floating' && this.isOpen) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    const contextAttr = target?.dataset.dragContext;
    const context: ContextKey = contextAttr === "window" ? "window" : "button";

    const eventTarget = event.target as HTMLElement | null;
    if (context === "window" && eventTarget?.closest("button")) {
      return;
    }

    this.pointerContext = context;
    this.measureContext(context);

    event.preventDefault();

    this.pointerId = event.pointerId;
    this.dragStart = { x: event.clientX, y: event.clientY };
    const state = this.contextState[context];
    this.dragOffset = {
      x: event.clientX - state.position.x,
      y: event.clientY - state.position.y,
    };
    this.isDragging = false;
    this.draggedDuringInteraction = false;
    this.ignoreNextButtonClick = false;

    target?.setPointerCapture?.(this.pointerId);
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (this.pointerId !== event.pointerId || !this.dragStart || !this.pointerContext) {
      return;
    }

    const distance = Math.hypot(event.clientX - this.dragStart.x, event.clientY - this.dragStart.y);
    if (!this.isDragging && distance < DRAG_THRESHOLD) {
      return;
    }

    event.preventDefault();
    this.setDragging(true);
    this.draggedDuringInteraction = true;

    const desired: Position = {
      x: event.clientX - this.dragOffset.x,
      y: event.clientY - this.dragOffset.y,
    };

    const constrained = this.constrainToViewport(desired, this.pointerContext);
    this.contextState[this.pointerContext].position = constrained;
    this.updateHostTransform(this.pointerContext);
  };

  private handlePointerUp = (event: PointerEvent) => {
    if (this.pointerId !== event.pointerId) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture(this.pointerId)) {
      target.releasePointerCapture(this.pointerId);
    }

    const context = this.pointerContext ?? this.activeContext;

    if (this.isDragging && this.pointerContext) {
      event.preventDefault();
      this.setDragging(false);
      if (this.pointerContext === "window") {
        this.updateAnchorFromPosition(this.pointerContext);
        this.hasCustomPosition.window = true;
        this.applyAnchorPosition(this.pointerContext);
      } else if (this.pointerContext === "button") {
        // Snap button to nearest corner
        this.snapButtonToCorner();
        this.hasCustomPosition.button = true;
        if (this.draggedDuringInteraction) {
          this.ignoreNextButtonClick = true;
        }
      }
    } else if (context === "button" && !this.isOpen && !this.draggedDuringInteraction) {
      this.openInspector();
    }

    this.resetPointerTracking();
  };

  private handlePointerCancel = (event: PointerEvent) => {
    if (this.pointerId !== event.pointerId) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture(this.pointerId)) {
      target.releasePointerCapture(this.pointerId);
    }

    this.resetPointerTracking();
  };

  private handleButtonClick = (event: Event) => {
    if (this.isDragging) {
      event.preventDefault();
      return;
    }

    if (this.ignoreNextButtonClick) {
      event.preventDefault();
      this.ignoreNextButtonClick = false;
      return;
    }

    if (!this.isOpen) {
      event.preventDefault();
      this.openInspector();
    }
  };

  private handleClosePointerDown = (event: PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };

  private handleCloseClick = () => {
    this.closeInspector();
  };

  private handleResizePointerDown = (event: PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();

    this.hasCustomPosition.window = true;
    this.isResizing = true;
    this.resizePointerId = event.pointerId;
    this.resizeStart = { x: event.clientX, y: event.clientY };
    this.resizeInitialSize = { ...this.contextState.window.size };

    // Remove transition from body during resize to prevent lag
    if (document.body && this.dockMode !== 'floating') {
      document.body.style.transition = '';
    }

    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture?.(event.pointerId);
  };

  private handleResizePointerMove = (event: PointerEvent) => {
    if (!this.isResizing || this.resizePointerId !== event.pointerId || !this.resizeStart || !this.resizeInitialSize) {
      return;
    }

    event.preventDefault();

    const deltaX = event.clientX - this.resizeStart.x;
    const deltaY = event.clientY - this.resizeStart.y;
    const state = this.contextState.window;

    // For docked states, only resize in the appropriate dimension
    if (this.dockMode === 'docked-left') {
      // Only resize width for left dock
      state.size = this.clampWindowSize({
        width: this.resizeInitialSize.width + deltaX,
        height: state.size.height,
      });
      // Update the body margin
      if (document.body) {
        document.body.style.marginLeft = `${state.size.width}px`;
      }
    } else {
      // Full resize for floating mode
      state.size = this.clampWindowSize({
        width: this.resizeInitialSize.width + deltaX,
        height: this.resizeInitialSize.height + deltaY,
      });
      this.keepPositionWithinViewport("window");
      this.updateAnchorFromPosition("window");
    }

    this.requestUpdate();
    this.updateHostTransform("window");
  };

  private handleResizePointerUp = (event: PointerEvent) => {
    if (this.resizePointerId !== event.pointerId) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture(this.resizePointerId)) {
      target.releasePointerCapture(this.resizePointerId);
    }

    // Only update anchor position for floating mode
    if (this.dockMode === 'floating') {
      this.updateAnchorFromPosition("window");
      this.applyAnchorPosition("window");
    }

    // Persist the new size after resize completes
    this.persistState();
    this.resetResizeTracking();
  };

  private handleResizePointerCancel = (event: PointerEvent) => {
    if (this.resizePointerId !== event.pointerId) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture(this.resizePointerId)) {
      target.releasePointerCapture(this.resizePointerId);
    }

    // Only update anchor position for floating mode
    if (this.dockMode === 'floating') {
      this.updateAnchorFromPosition("window");
      this.applyAnchorPosition("window");
    }

    // Persist the new size after resize completes
    this.persistState();
    this.resetResizeTracking();
  };

  private handleResize = () => {
    this.measureContext("button");
    this.applyAnchorPosition("button");

    this.measureContext("window");
    if (this.hasCustomPosition.window) {
      this.applyAnchorPosition("window");
    } else {
      this.centerContext("window");
    }

    this.updateHostTransform();
  };

  private measureContext(context: ContextKey): void {
    const selector = context === "window" ? ".inspector-window" : ".console-button";
    const element = this.renderRoot?.querySelector(selector) as HTMLElement | null;
    if (!element) {
      return;
    }
    const fallback = context === "window" ? DEFAULT_WINDOW_SIZE : DEFAULT_BUTTON_SIZE;
    updateSizeFromElement(this.contextState[context], element, fallback);
  }

  private centerContext(context: ContextKey): void {
    if (typeof window === "undefined") {
      return;
    }

    const viewport = this.getViewportSize();
    centerContextHelper(this.contextState[context], viewport, EDGE_MARGIN);

    if (context === this.activeContext) {
      this.updateHostTransform(context);
    }

    this.hasCustomPosition[context] = false;
    this.persistState();
  }

  private ensureWindowPlacement(): void {
    if (typeof window === "undefined") {
      return;
    }

    if (!this.hasCustomPosition.window) {
      this.centerContext("window");
      return;
    }

    const viewport = this.getViewportSize();
    keepPositionWithinViewport(this.contextState.window, viewport, EDGE_MARGIN);
    updateAnchorFromPositionHelper(this.contextState.window, viewport, EDGE_MARGIN);
    this.updateHostTransform("window");
    this.persistState();
  }

  private constrainToViewport(position: Position, context: ContextKey): Position {
    if (typeof window === "undefined") {
      return position;
    }

    const viewport = this.getViewportSize();
    return constrainToViewport(this.contextState[context], position, viewport, EDGE_MARGIN);
  }

  private keepPositionWithinViewport(context: ContextKey): void {
    if (typeof window === "undefined") {
      return;
    }

    const viewport = this.getViewportSize();
    keepPositionWithinViewport(this.contextState[context], viewport, EDGE_MARGIN);
  }

  private getViewportSize(): Size {
    if (typeof window === "undefined") {
      return { ...DEFAULT_WINDOW_SIZE };
    }

    return { width: window.innerWidth, height: window.innerHeight };
  }

  private persistState(): void {
    const state: PersistedState = {
      button: {
        anchor: this.contextState.button.anchor,
        anchorOffset: this.contextState.button.anchorOffset,
        hasCustomPosition: this.hasCustomPosition.button,
      },
      window: {
        anchor: this.contextState.window.anchor,
        anchorOffset: this.contextState.window.anchorOffset,
        size: {
          width: Math.round(this.contextState.window.size.width),
          height: Math.round(this.contextState.window.size.height),
        },
        hasCustomPosition: this.hasCustomPosition.window,
      },
      isOpen: this.isOpen,
      dockMode: this.dockMode,
      selectedMenu: this.selectedMenu,
      selectedContext: this.selectedContext,
    };
    saveInspectorState(INSPECTOR_STORAGE_KEY, state);
    this.pendingSelectedContext = state.selectedContext ?? null;
  }

  private clampWindowSize(size: Size): Size {
    // Use smaller minimum width when docked left
    const minWidth = this.dockMode === 'docked-left' ? MIN_WINDOW_WIDTH_DOCKED_LEFT : MIN_WINDOW_WIDTH;

    if (typeof window === "undefined") {
      return {
        width: Math.max(minWidth, size.width),
        height: Math.max(MIN_WINDOW_HEIGHT, size.height),
      };
    }

    const viewport = this.getViewportSize();
    return clampSizeToViewport(size, viewport, EDGE_MARGIN, minWidth, MIN_WINDOW_HEIGHT);
  }

  private setDockMode(mode: DockMode): void {
    if (this.dockMode === mode) {
      return;
    }

    // Add transition class for smooth dock mode changes
    this.startHostTransition();

    // Clean up previous dock state
    this.removeDockStyles();

    this.dockMode = mode;

    if (mode !== 'floating') {
      // For docking, set the target size immediately so body margins are correct
      if (mode === 'docked-left') {
        this.contextState.window.size.width = DOCKED_LEFT_WIDTH;
      }

      // Then apply dock styles with correct sizes
      this.applyDockStyles();
    } else {
      // When floating, set size first then center
      this.contextState.window.size = { ...DEFAULT_WINDOW_SIZE };
      this.centerContext('window');
    }

    this.persistState();
    this.requestUpdate();
    this.updateHostTransform('window');
  }

  private startHostTransition(duration = 300): void {
    this.setAttribute('data-transitioning', 'true');

    if (this.transitionTimeoutId !== null) {
      clearTimeout(this.transitionTimeoutId);
    }

    this.transitionTimeoutId = setTimeout(() => {
      this.removeAttribute('data-transitioning');
      this.transitionTimeoutId = null;
    }, duration);
  }

  private applyDockStyles(skipTransition = false): void {
    if (typeof document === 'undefined' || !document.body) {
      return;
    }

    // Save original body margins
    const computedStyle = window.getComputedStyle(document.body);
    this.previousBodyMargins = {
      left: computedStyle.marginLeft,
      bottom: computedStyle.marginBottom,
    };

    // Apply transition to body for smooth animation (only when docking, not during resize or initial load)
    if (!this.isResizing && !skipTransition) {
      document.body.style.transition = 'margin 300ms ease';
    }

    // Apply body margins with the actual window sizes
    if (this.dockMode === 'docked-left') {
      document.body.style.marginLeft = `${this.contextState.window.size.width}px`;
    }

    // Remove transition after animation completes
    if (!this.isResizing && !skipTransition) {
      setTimeout(() => {
        if (document.body) {
          document.body.style.transition = '';
        }
      }, 300);
    }
  }

  private removeDockStyles(): void {
    if (typeof document === 'undefined' || !document.body) {
      return;
    }

    // Only add transition if not resizing
    if (!this.isResizing) {
      document.body.style.transition = 'margin 300ms ease';
    }

    // Restore original margins if saved
    if (this.previousBodyMargins) {
      document.body.style.marginLeft = this.previousBodyMargins.left;
      document.body.style.marginBottom = this.previousBodyMargins.bottom;
      this.previousBodyMargins = null;
    } else {
      // Reset to default if no previous values
      document.body.style.marginLeft = '';
      document.body.style.marginBottom = '';
    }

    // Clean up transition after animation completes
    setTimeout(() => {
      if (document.body) {
        document.body.style.transition = '';
      }
    }, 300);
  }

  private updateHostTransform(context: ContextKey = this.activeContext): void {
    if (context !== this.activeContext) {
      return;
    }

    // For docked states, CSS handles positioning with fixed positioning
    if (this.isOpen && this.dockMode === 'docked-left') {
      this.style.transform = `translate3d(0, 0, 0)`;
    } else {
      const { position } = this.contextState[context];
      this.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    }
  }

  private setDragging(value: boolean): void {
    if (this.isDragging !== value) {
      this.isDragging = value;
      this.requestUpdate();
    }
  }

  private updateAnchorFromPosition(context: ContextKey): void {
    if (typeof window === "undefined") {
      return;
    }
    const viewport = this.getViewportSize();
    updateAnchorFromPositionHelper(this.contextState[context], viewport, EDGE_MARGIN);
  }

  private snapButtonToCorner(): void {
    if (typeof window === "undefined") {
      return;
    }

    const viewport = this.getViewportSize();
    const state = this.contextState.button;

    // Determine which corner is closest based on center of button
    const centerX = state.position.x + state.size.width / 2;
    const centerY = state.position.y + state.size.height / 2;

    const horizontal: Anchor['horizontal'] = centerX < viewport.width / 2 ? 'left' : 'right';
    const vertical: Anchor['vertical'] = centerY < viewport.height / 2 ? 'top' : 'bottom';

    // Set anchor to nearest corner
    state.anchor = { horizontal, vertical };

    // Always use EDGE_MARGIN as offset (pinned to corner)
    state.anchorOffset = { x: EDGE_MARGIN, y: EDGE_MARGIN };

    // Apply the anchor position to snap to corner
    this.startHostTransition();
    this.applyAnchorPosition('button');
  }

  private applyAnchorPosition(context: ContextKey): void {
    if (typeof window === "undefined") {
      return;
    }
    const viewport = this.getViewportSize();
    applyAnchorPositionHelper(this.contextState[context], viewport, EDGE_MARGIN);
    this.updateHostTransform(context);
    this.persistState();
  }

  private resetResizeTracking(): void {
    this.resizePointerId = null;
    this.resizeStart = null;
    this.resizeInitialSize = null;
    this.isResizing = false;
  }

  private resetPointerTracking(): void {
    this.pointerId = null;
    this.dragStart = null;
    this.pointerContext = null;
    this.setDragging(false);
    this.draggedDuringInteraction = false;
  }

  private openInspector(): void {
    if (this.isOpen) {
      return;
    }

    this.showAnnouncementPreview = false; // hide the bubble once the inspector is opened

    this.ensureAnnouncementLoading();

    this.isOpen = true;
    this.persistState(); // Save the open state

    // Apply docking styles if in docked mode
    if (this.dockMode !== 'floating') {
      this.applyDockStyles();
    }

    this.ensureWindowPlacement();
    this.requestUpdate();
    void this.updateComplete.then(() => {
      this.measureContext("window");
      if (this.dockMode === 'floating') {
        if (this.hasCustomPosition.window) {
          this.applyAnchorPosition("window");
        } else {
          this.centerContext("window");
        }
      } else {
        // Update transform for docked position
        this.updateHostTransform("window");
      }

    });
  }

  private closeInspector(): void {
    if (!this.isOpen) {
      return;
    }

    this.isOpen = false;

    // Remove docking styles when closing
    if (this.dockMode !== 'floating') {
      this.removeDockStyles();
    }

    this.persistState(); // Save the closed state
    this.updateHostTransform("button");
    this.requestUpdate();
    void this.updateComplete.then(() => {
      this.measureContext("button");
      this.applyAnchorPosition("button");
    });
  }

  private renderIcon(name: LucideIconName) {
    const iconNode = icons[name];
    if (!iconNode) {
      return nothing;
    }

    const svgAttrs: Record<string, string | number> = {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: "h-3.5 w-3.5",
    };

    const svgMarkup = `<svg ${this.serializeAttributes(svgAttrs)}>${iconNode
      .map(([tag, attrs]) => `<${tag} ${this.serializeAttributes(attrs)} />`)
      .join("")}</svg>`;

    return unsafeHTML(svgMarkup);
  }

  private renderDockControls() {
    if (this.dockMode === 'floating') {
      // Show dock left button
      return html`
        <button
          class="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
          type="button"
          aria-label="Dock to left"
          title="Dock Left"
          @click=${() => this.handleDockClick('docked-left')}
        >
          ${this.renderIcon("PanelLeft")}
        </button>
      `;
    } else {
      // Show float button
      return html`
        <button
          class="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400"
          type="button"
          aria-label="Float window"
          title="Float"
          @click=${() => this.handleDockClick('floating')}
        >
          ${this.renderIcon("Maximize2")}
        </button>
      `;
    }
  }

  private getDockedWindowStyles(): Record<string, string> {
    if (this.dockMode === 'docked-left') {
      return {
        position: 'fixed',
        top: '0',
        left: '0',
        bottom: '0',
        width: `${Math.round(this.contextState.window.size.width)}px`,
        height: '100vh',
        minWidth: `${MIN_WINDOW_WIDTH_DOCKED_LEFT}px`,
        borderRadius: '0',
      };
    }
    // Default to floating styles
    return {
      width: `${Math.round(this.contextState.window.size.width)}px`,
      height: `${Math.round(this.contextState.window.size.height)}px`,
      minWidth: `${MIN_WINDOW_WIDTH}px`,
      minHeight: `${MIN_WINDOW_HEIGHT}px`,
    };
  }

  private handleDockClick(mode: DockMode): void {
    this.setDockMode(mode);
  }

  private serializeAttributes(attributes: Record<string, string | number | undefined>): string {
    return Object.entries(attributes)
      .filter(([key, value]) => key !== "key" && value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `${key}="${String(value).replace(/"/g, "&quot;")}"`)
      .join(" ");
  }

  private sanitizeForLogging(value: unknown, depth = 0, seen = new WeakSet<object>()): SanitizedValue {
    if (value === undefined) {
      return "[undefined]";
    }

    if (value === null || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
      return String(value);
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      if (depth >= 4) {
        return "[Truncated depth]" as SanitizedValue;
      }
      return value.map((item) => this.sanitizeForLogging(item, depth + 1, seen));
    }

    if (typeof value === "object") {
      if (seen.has(value as object)) {
        return "[Circular]" as SanitizedValue;
      }
      seen.add(value as object);

      if (depth >= 4) {
        return "[Truncated depth]" as SanitizedValue;
      }

      const result: Record<string, SanitizedValue> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        result[key] = this.sanitizeForLogging(entry, depth + 1, seen);
      }
      return result;
    }

    return String(value);
  }

  private normalizeEventPayload(_type: InspectorAgentEventType, payload: unknown): SanitizedValue {
    if (payload && typeof payload === "object" && "event" in payload) {
      const { event, ...rest } = payload as Record<string, unknown>;
      const cleaned = Object.keys(rest).length === 0 ? event : { event, ...rest };
      return this.sanitizeForLogging(cleaned);
    }

    return this.sanitizeForLogging(payload);
  }

  private normalizeMessageContent(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (content && typeof content === "object" && "text" in (content as Record<string, unknown>)) {
      const maybeText = (content as Record<string, unknown>).text;
      if (typeof maybeText === "string") {
        return maybeText;
      }
    }

    if (content === null || content === undefined) {
      return "";
    }

    if (typeof content === "object") {
      try {
        return JSON.stringify(this.sanitizeForLogging(content));
      } catch {
        return "";
      }
    }

    return String(content);
  }

  private normalizeToolCalls(raw: unknown): InspectorToolCall[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const call = entry as Record<string, unknown>;
        const fn = call.function as Record<string, unknown> | undefined;
        const functionName = typeof fn?.name === "string" ? fn.name : typeof call.toolName === "string" ? call.toolName : undefined;
        const args = fn && "arguments" in fn ? (fn as Record<string, unknown>).arguments : call.arguments;

        const normalized: InspectorToolCall = {
          id: typeof call.id === "string" ? call.id : undefined,
          toolName: typeof call.toolName === "string" ? call.toolName : functionName,
          status: typeof call.status === "string" ? call.status : undefined,
        };

        if (functionName) {
          normalized.function = {
            name: functionName,
            arguments: this.sanitizeForLogging(args),
          };
        }

        return normalized;
      })
      .filter((call): call is InspectorToolCall => Boolean(call));
  }

  private normalizeAgentMessage(message: unknown): InspectorMessage | null {
    if (!message || typeof message !== "object") {
      return null;
    }

    const raw = message as Record<string, unknown>;
    const role = typeof raw.role === "string" ? raw.role : "unknown";
    const contentText = this.normalizeMessageContent(raw.content);
    const toolCalls = this.normalizeToolCalls(raw.toolCalls);

    return {
      id: typeof raw.id === "string" ? raw.id : undefined,
      role,
      contentText,
      contentRaw: raw.content !== undefined ? this.sanitizeForLogging(raw.content) : undefined,
      toolCalls,
    };
  }

  private normalizeAgentMessages(messages: unknown): InspectorMessage[] | null {
    if (!Array.isArray(messages)) {
      return null;
    }

    const normalized = messages
      .map((message) => this.normalizeAgentMessage(message))
      .filter((msg): msg is InspectorMessage => msg !== null);

    return normalized;
  }

  private normalizeContextStore(
    context: Readonly<Record<string, unknown>> | null | undefined,
  ): Record<string, { description?: string; value: unknown }> {
    if (!context || typeof context !== "object") {
      return {};
    }

    const normalized: Record<string, { description?: string; value: unknown }> = {};
    for (const [key, entry] of Object.entries(context)) {
      if (entry && typeof entry === "object" && "value" in (entry as Record<string, unknown>)) {
        const candidate = entry as Record<string, unknown>;
        const description =
          typeof candidate.description === "string" && candidate.description.trim().length > 0
            ? candidate.description
            : undefined;
        normalized[key] = { description, value: candidate.value };
      } else {
        normalized[key] = { value: entry };
      }
    }

    return normalized;
  }

  private contextOptions: Array<{ key: string; label: string }> = [
    { key: "all-agents", label: "All Agents" },
  ];

  private selectedContext = "all-agents";
  private expandedRows: Set<string> = new Set();
  private copiedEvents: Set<string> = new Set();
  private expandedTools: Set<string> = new Set();
  private expandedContextItems: Set<string> = new Set();
  private copiedContextItems: Set<string> = new Set();

  private getSelectedMenu(): MenuItem {
    const found = this.menuItems.find((item) => item.key === this.selectedMenu);
    return found ?? this.menuItems[0]!;
  }

  private renderCoreWarningBanner() {
    if (this._core) {
      return nothing;
    }

    return html`
      <div class="mx-4 my-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <span class="mt-0.5 shrink-0 text-amber-600">${this.renderIcon("AlertTriangle")}</span>
        <div class="space-y-1">
          <div class="font-semibold text-amber-900">CopilotKit core not attached</div>
          <p class="text-[11px] leading-snug text-amber-800">
            Pass a live <code>CopilotKitCore</code> instance to <code>&lt;cpk-web-inspector&gt;</code> or expose it on
            <code>window.__COPILOTKIT_CORE__</code> for auto-attach.
          </p>
        </div>
      </div>
    `;
  }

  private getCoreStatusSummary(): { label: string; tone: string; description: string } {
    if (!this._core) {
      return {
        label: "Core not attached",
        tone: "border border-amber-200 bg-amber-50 text-amber-800",
        description: "Pass a CopilotKitCore instance to <cpk-web-inspector> or enable auto-attach.",
      };
    }

    const status = this.runtimeStatus ?? CopilotKitCoreRuntimeConnectionStatus.Disconnected;
    const lastErrorMessage = this.lastCoreError?.message;

    if (status === CopilotKitCoreRuntimeConnectionStatus.Error) {
      return {
        label: "Runtime error",
        tone: "border border-rose-200 bg-rose-50 text-rose-700",
        description: lastErrorMessage ?? "CopilotKit runtime reported an error.",
      };
    }

    if (status === CopilotKitCoreRuntimeConnectionStatus.Connecting) {
      return {
        label: "Connecting",
        tone: "border border-amber-200 bg-amber-50 text-amber-800",
        description: "Waiting for CopilotKit runtime to finish connecting.",
      };
    }

    if (status === CopilotKitCoreRuntimeConnectionStatus.Connected) {
      return {
        label: "Connected",
        tone: "border border-emerald-200 bg-emerald-50 text-emerald-700",
        description: "Live runtime connection established.",
      };
    }

    return {
      label: "Disconnected",
      tone: "border border-gray-200 bg-gray-50 text-gray-700",
      description: lastErrorMessage ?? "Waiting for CopilotKit runtime to connect.",
    };
  }

  private renderMainContent() {
    if (this.selectedMenu === "ag-ui-events") {
      return this.renderEventsTable();
    }

    if (this.selectedMenu === "agents") {
      return this.renderAgentsView();
    }

    if (this.selectedMenu === "frontend-tools") {
      return this.renderToolsView();
    }

    if (this.selectedMenu === "agent-context") {
      return this.renderContextView();
    }

    return nothing;
  }

  private renderEventsTable() {
    const events = this.getEventsForSelectedContext();
    const filteredEvents = this.filterEvents(events);
    const selectedLabel = this.selectedContext === "all-agents" ? "all agents" : `agent ${this.selectedContext}`;

    if (events.length === 0) {
      return html`
        <div class="flex h-full items-center justify-center px-4 py-8 text-center">
          <div class="max-w-md">
            <div class="mb-3 flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8">
              ${this.renderIcon("Zap")}
            </div>
            <p class="text-sm text-gray-600">No events yet</p>
            <p class="mt-2 text-xs text-gray-500">Trigger an agent run to see live activity.</p>
          </div>
        </div>
      `;
    }

    if (filteredEvents.length === 0) {
      return html`
        <div class="flex h-full items-center justify-center px-4 py-8 text-center">
          <div class="max-w-md space-y-3">
            <div class="flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8">
              ${this.renderIcon("Filter")}
            </div>
            <p class="text-sm text-gray-600">No events match the current filters.</p>
            <div>
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-md bg-gray-900 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-gray-800"
                @click=${this.resetEventFilters}
              >
                ${this.renderIcon("RefreshCw")}
                <span>Reset filters</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="flex h-full flex-col">
        <div class="flex flex-col gap-1.5 border-b border-gray-200 bg-white px-4 py-2.5">
          <div class="flex flex-wrap items-center gap-2">
            <div class="relative min-w-[200px] flex-1">
              <input
                type="search"
                class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-[11px] text-gray-700 shadow-sm outline-none ring-1 ring-transparent transition focus:border-gray-300 focus:ring-gray-200"
                placeholder="Search agent, type, payload"
                .value=${this.eventFilterText}
                @input=${this.handleEventFilterInput}
              />
            </div>
            <select
              class="w-40 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-700 shadow-sm outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
              .value=${this.eventTypeFilter}
              @change=${this.handleEventTypeChange}
            >
              <option value="all">All event types</option>
              ${AGENT_EVENT_TYPES.map(
                (type) =>
                  html`<option value=${type}>${type.toLowerCase().replace(/_/g, " ")}</option>`,
              )}
            </select>
            <div class="flex items-center gap-1 text-[11px]">
              <button
                type="button"
                class="tooltip-target flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                title="Reset filters"
                data-tooltip="Reset filters"
                aria-label="Reset filters"
                @click=${this.resetEventFilters}
                ?disabled=${!this.eventFilterText && this.eventTypeFilter === "all"}
              >
                ${this.renderIcon("RotateCw")}
              </button>
              <button
                type="button"
                class="tooltip-target flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                title="Export JSON"
                data-tooltip="Export JSON"
                aria-label="Export JSON"
                @click=${() => this.exportEvents(filteredEvents)}
                ?disabled=${filteredEvents.length === 0}
              >
                ${this.renderIcon("Download")}
              </button>
              <button
                type="button"
                class="tooltip-target flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                title="Clear events"
                data-tooltip="Clear events"
                aria-label="Clear events"
                @click=${this.handleClearEvents}
                ?disabled=${events.length === 0}
              >
                ${this.renderIcon("Trash2")}
              </button>
            </div>
          </div>
          <div class="text-[11px] text-gray-500">
            Showing ${filteredEvents.length} of ${events.length}${this.selectedContext === "all-agents" ? "" : ` for ${selectedLabel}`}
          </div>
        </div>
        <div class="relative h-full w-full overflow-y-auto overflow-x-hidden">
          <table class="w-full table-fixed border-collapse text-xs box-border">
            <thead class="sticky top-0 z-10">
              <tr class="bg-white">
                <th class="border-b border-gray-200 bg-white px-3 py-2 text-left font-medium text-gray-900">
                  Agent
                </th>
                <th class="border-b border-gray-200 bg-white px-3 py-2 text-left font-medium text-gray-900">
                  Time
                </th>
                <th class="border-b border-gray-200 bg-white px-3 py-2 text-left font-medium text-gray-900">
                  Event Type
                </th>
                <th class="border-b border-gray-200 bg-white px-3 py-2 text-left font-medium text-gray-900">
                  AG-UI Event
                </th>
              </tr>
            </thead>
            <tbody>
              ${filteredEvents.map((event, index) => {
                const rowBg = index % 2 === 0 ? "bg-white" : "bg-gray-50/50";
                const badgeClasses = this.getEventBadgeClasses(event.type);
                const extractedEvent = this.extractEventFromPayload(event.payload);
                const inlineEvent = this.stringifyPayload(extractedEvent, false) || "—";
                const prettyEvent = this.stringifyPayload(extractedEvent, true) || inlineEvent;
                const isExpanded = this.expandedRows.has(event.id);

                return html`
                  <tr
                    class="${rowBg} cursor-pointer transition hover:bg-blue-50/50"
                    @click=${() => this.toggleRowExpansion(event.id)}
                  >
                    <td class="border-l border-r border-b border-gray-200 px-3 py-2">
                      <span class="font-mono text-[11px] text-gray-600">${event.agentId}</span>
                    </td>
                    <td class="border-r border-b border-gray-200 px-3 py-2 font-mono text-[11px] text-gray-600">
                      <span title=${new Date(event.timestamp).toLocaleString()}>
                        ${new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                    </td>
                    <td class="border-r border-b border-gray-200 px-3 py-2">
                      <span class=${badgeClasses}>${event.type}</span>
                    </td>
                    <td class="border-r border-b border-gray-200 px-3 py-2 font-mono text-[10px] text-gray-600 ${isExpanded ? '' : 'truncate max-w-xs'}">
                      ${isExpanded
                        ? html`
                            <div class="group relative">
                              <pre class="m-0 whitespace-pre-wrap break-words text-[10px] font-mono text-gray-600">${prettyEvent}</pre>
                              <button
                                class="absolute right-0 top-0 cursor-pointer rounded px-2 py-1 text-[10px] opacity-0 transition group-hover:opacity-100 ${
                                  this.copiedEvents.has(event.id)
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                                }"
                                @click=${(e: Event) => {
                                  e.stopPropagation();
                                  this.copyToClipboard(prettyEvent, event.id);
                                }}
                              >
                                ${this.copiedEvents.has(event.id)
                                  ? html`<span>✓ Copied</span>`
                                  : html`<span>Copy</span>`}
                              </button>
                            </div>
                          `
                        : inlineEvent}
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  private handleEventFilterInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.eventFilterText = target?.value ?? "";
    this.requestUpdate();
  }

  private handleEventTypeChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    const value = target?.value as InspectorAgentEventType | "all" | undefined;
    if (!value) {
      return;
    }
    this.eventTypeFilter = value;
    this.requestUpdate();
  }

  private resetEventFilters(): void {
    this.eventFilterText = "";
    this.eventTypeFilter = "all";
    this.requestUpdate();
  }

  private handleClearEvents = (): void => {
    if (this.selectedContext === "all-agents") {
      this.agentEvents.clear();
      this.flattenedEvents = [];
    } else {
      this.agentEvents.delete(this.selectedContext);
      this.flattenedEvents = this.flattenedEvents.filter((event) => event.agentId !== this.selectedContext);
    }

    this.expandedRows.clear();
    this.copiedEvents.clear();
    this.requestUpdate();
  };

  private exportEvents(events: InspectorEvent[]): void {
    try {
      const payload = JSON.stringify(events, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `copilotkit-events-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export events", error);
    }
  }

  private renderAgentsView() {
    // Show message if "all-agents" is selected or no agents available
    if (this.selectedContext === "all-agents") {
      return html`
        <div class="flex h-full items-center justify-center px-4 py-8 text-center">
          <div class="max-w-md">
            <div class="mb-3 flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8">
              ${this.renderIcon("Bot")}
            </div>
            <p class="text-sm text-gray-600">No agent selected</p>
            <p class="mt-2 text-xs text-gray-500">Select an agent from the dropdown above to view details.</p>
          </div>
        </div>
      `;
    }

    const agentId = this.selectedContext;
    const status = this.getAgentStatus(agentId);
    const stats = this.getAgentStats(agentId);
    const state = this.getLatestStateForAgent(agentId);
    const messages = this.getLatestMessagesForAgent(agentId);

    const statusColors = {
      running: "bg-emerald-50 text-emerald-700",
      idle: "bg-gray-100 text-gray-600",
      error: "bg-rose-50 text-rose-700",
    };

    return html`
      <div class="flex flex-col gap-4 p-4 overflow-auto">
        <!-- Agent Overview Card -->
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <div class="flex items-start justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                ${this.renderIcon("Bot")}
              </div>
              <div>
                <h3 class="font-semibold text-sm text-gray-900">${agentId}</h3>
                <span class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[status]} relative -translate-y-[2px]">
                  <span class="h-1.5 w-1.5 rounded-full ${status === 'running' ? 'bg-emerald-500 animate-pulse' : status === 'error' ? 'bg-rose-500' : 'bg-gray-400'}"></span>
                  ${status.charAt(0).toUpperCase() + status.slice(1)}
                </span>
              </div>
            </div>
            ${stats.lastActivity
              ? html`<span class="text-xs text-gray-500">Last activity: ${new Date(stats.lastActivity).toLocaleTimeString()}</span>`
              : nothing}
          </div>
          <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
            <button
              type="button"
              class="rounded-md bg-gray-50 px-3 py-2 text-left transition hover:bg-gray-100 cursor-pointer overflow-hidden"
              @click=${() => this.handleMenuSelect("ag-ui-events")}
              title="View all events in AG-UI Events"
            >
              <div class="truncate whitespace-nowrap text-xs text-gray-600">Total Events</div>
              <div class="text-lg font-semibold text-gray-900">${stats.totalEvents}</div>
            </button>
            <div class="rounded-md bg-gray-50 px-3 py-2 overflow-hidden">
              <div class="truncate whitespace-nowrap text-xs text-gray-600">Messages</div>
              <div class="text-lg font-semibold text-gray-900">${stats.messages}</div>
            </div>
            <div class="rounded-md bg-gray-50 px-3 py-2 overflow-hidden">
              <div class="truncate whitespace-nowrap text-xs text-gray-600">Tool Calls</div>
              <div class="text-lg font-semibold text-gray-900">${stats.toolCalls}</div>
            </div>
            <div class="rounded-md bg-gray-50 px-3 py-2 overflow-hidden">
              <div class="truncate whitespace-nowrap text-xs text-gray-600">Errors</div>
              <div class="text-lg font-semibold text-gray-900">${stats.errors}</div>
            </div>
          </div>
        </div>

        <!-- Current State Section -->
        <div class="rounded-lg border border-gray-200 bg-white">
          <div class="border-b border-gray-200 px-4 py-3">
            <h4 class="text-sm font-semibold text-gray-900">Current State</h4>
          </div>
          <div class="overflow-auto p-4">
            ${this.hasRenderableState(state)
              ? html`
                  <pre class="overflow-auto rounded-md bg-gray-50 p-3 text-xs text-gray-800 max-h-64"><code>${this.formatStateForDisplay(state)}</code></pre>
                `
              : html`
                  <div class="flex h-40 items-center justify-center text-xs text-gray-500">
                    <div class="flex items-center gap-2 text-gray-500">
                      <span class="text-lg text-gray-400">${this.renderIcon("Database")}</span>
                      <span>State is empty</span>
                    </div>
                  </div>
                `}
          </div>
        </div>

        <!-- Current Messages Section -->
        <div class="rounded-lg border border-gray-200 bg-white">
          <div class="border-b border-gray-200 px-4 py-3">
            <h4 class="text-sm font-semibold text-gray-900">Current Messages</h4>
          </div>
          <div class="overflow-auto">
            ${messages && messages.length > 0
              ? html`
                  <table class="w-full text-xs">
                    <thead class="bg-gray-50">
                      <tr>
                        <th class="px-4 py-2 text-left font-medium text-gray-700">Role</th>
                        <th class="px-4 py-2 text-left font-medium text-gray-700">Content</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200">
                      ${messages.map((msg) => {
                        const role = msg.role || "unknown";
                        const roleColors: Record<string, string> = {
                          user: "bg-blue-100 text-blue-800",
                          assistant: "bg-green-100 text-green-800",
                          system: "bg-gray-100 text-gray-800",
                          tool: "bg-amber-100 text-amber-800",
                          unknown: "bg-gray-100 text-gray-600",
                        };

                        const rawContent = msg.contentText ?? "";
                        const toolCalls = msg.toolCalls ?? [];
                        const hasContent = rawContent.trim().length > 0;
                        const contentFallback = toolCalls.length > 0 ? "Invoked tool call" : "—";

                        return html`
                          <tr>
                            <td class="px-4 py-2 align-top">
                              <span class="inline-flex rounded px-2 py-0.5 text-[10px] font-medium ${roleColors[role] || roleColors.unknown}">
                                ${role}
                              </span>
                            </td>
                            <td class="px-4 py-2">
                              ${hasContent
                                ? html`<div class="max-w-2xl whitespace-pre-wrap break-words text-gray-700">${rawContent}</div>`
                                : html`<div class="text-xs italic text-gray-400">${contentFallback}</div>`}
                              ${role === 'assistant' && toolCalls.length > 0
                                ? this.renderToolCallDetails(toolCalls)
                                : nothing}
                            </td>
                          </tr>
                        `;
                      })}
                    </tbody>
                  </table>
                `
              : html`
                  <div class="flex h-40 items-center justify-center text-xs text-gray-500">
                    <div class="flex items-center gap-2 text-gray-500">
                      <span class="text-lg text-gray-400">${this.renderIcon("MessageSquare")}</span>
                      <span>No messages available</span>
                    </div>
                  </div>
                `}
          </div>
        </div>
      </div>
    `;
  }

  private renderContextDropdown() {
    // Filter out "all-agents" when in agents view
    const filteredOptions = this.selectedMenu === "agents"
      ? this.contextOptions.filter((opt) => opt.key !== "all-agents")
      : this.contextOptions;

    const selectedLabel = filteredOptions.find((opt) => opt.key === this.selectedContext)?.label ?? "";

    return html`
      <div class="relative z-40 min-w-0 flex-1" data-context-dropdown-root="true">
        <button
          type="button"
          class="relative z-40 flex w-full min-w-0 max-w-[240px] items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
          @pointerdown=${this.handleContextDropdownToggle}
        >
          <span class="truncate flex-1 text-left">${selectedLabel}</span>
          <span class="shrink-0 text-gray-400">${this.renderIcon("ChevronDown")}</span>
        </button>
        ${this.contextMenuOpen
          ? html`
              <div
                class="absolute left-0 z-50 mt-1.5 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-md ring-1 ring-black/5"
                data-context-dropdown-root="true"
              >
                ${filteredOptions.map(
                  (option) => html`
                    <button
                      type="button"
                      class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                      data-context-dropdown-root="true"
                      @click=${() => this.handleContextOptionSelect(option.key)}
                    >
                      <span class="truncate ${option.key === this.selectedContext ? 'text-gray-900 font-medium' : 'text-gray-600'}">${option.label}</span>
                      ${option.key === this.selectedContext
                        ? html`<span class="text-gray-500">${this.renderIcon("Check")}</span>`
                        : nothing}
                    </button>
                  `,
                )}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private handleMenuSelect(key: MenuKey): void {
    if (!this.menuItems.some((item) => item.key === key)) {
      return;
    }

    this.selectedMenu = key;

    // If switching to agents view and "all-agents" is selected, switch to default or first agent
    if (key === "agents" && this.selectedContext === "all-agents") {
      const agentOptions = this.contextOptions.filter((opt) => opt.key !== "all-agents");
      if (agentOptions.length > 0) {
        // Try to find "default" agent first
        const defaultAgent = agentOptions.find((opt) => opt.key === "default");
        this.selectedContext = defaultAgent ? defaultAgent.key : agentOptions[0]!.key;
      }
    }

    this.contextMenuOpen = false;
    this.persistState();
    this.requestUpdate();
  }

  private handleContextDropdownToggle(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuOpen = !this.contextMenuOpen;
    this.requestUpdate();
  }

  private handleContextOptionSelect(key: string): void {
    if (!this.contextOptions.some((option) => option.key === key)) {
      return;
    }

    if (this.selectedContext !== key) {
      this.selectedContext = key;
      this.expandedRows.clear();
    }

    this.contextMenuOpen = false;
    this.persistState();
    this.requestUpdate();
  }

  private renderToolsView() {
    if (!this._core) {
      return html`
        <div class="flex h-full items-center justify-center px-4 py-8 text-xs text-gray-500">
          No core instance available
        </div>
      `;
    }

    this.refreshToolsSnapshot();
    const allTools = this.cachedTools;

    if (allTools.length === 0) {
      return html`
        <div class="flex h-full items-center justify-center px-4 py-8 text-center">
          <div class="max-w-md">
            <div class="mb-3 flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8">
              ${this.renderIcon("Hammer")}
            </div>
            <p class="text-sm text-gray-600">No tools available</p>
            <p class="mt-2 text-xs text-gray-500">Tools will appear here once agents are configured with tool handlers or renderers.</p>
          </div>
        </div>
      `;
    }

    // Filter tools by selected agent
    const filteredTools = this.selectedContext === "all-agents"
      ? allTools
      : allTools.filter((tool) => !tool.agentId || tool.agentId === this.selectedContext);

    return html`
      <div class="flex h-full flex-col overflow-hidden">
        <div class="overflow-auto p-4">
          <div class="space-y-3">
            ${filteredTools.map(tool => this.renderToolCard(tool))}
          </div>
        </div>
      </div>
    `;
  }

  private extractToolsFromAgents(): InspectorToolDefinition[] {
    if (!this._core) {
      return [];
    }

    const tools: InspectorToolDefinition[] = [];

    // Start with tools registered on the core (frontend tools / HIL)
    for (const coreTool of this._core.tools ?? []) {
      tools.push({
        agentId: coreTool.agentId ?? "",
        name: coreTool.name,
        description: coreTool.description,
        parameters: coreTool.parameters,
        type: 'handler',
      });
    }

    // Augment with agent-level tool handlers/renderers
    for (const [agentId, agent] of Object.entries(this._core.agents)) {
      if (!agent) continue;

      // Try to extract tool handlers
      const handlers = (agent as { toolHandlers?: Record<string, unknown> }).toolHandlers;
      if (handlers && typeof handlers === 'object') {
        for (const [toolName, handler] of Object.entries(handlers)) {
          if (handler && typeof handler === 'object') {
            const handlerObj = handler as Record<string, unknown>;
            tools.push({
              agentId,
              name: toolName,
              description:
                (typeof handlerObj.description === "string" && handlerObj.description) ||
                (handlerObj.tool as { description?: string } | undefined)?.description,
              parameters:
                handlerObj.parameters ??
                (handlerObj.tool as { parameters?: unknown } | undefined)?.parameters,
              type: 'handler',
            });
          }
        }
      }

      // Try to extract tool renderers
      const renderers = (agent as { toolRenderers?: Record<string, unknown> }).toolRenderers;
      if (renderers && typeof renderers === 'object') {
        for (const [toolName, renderer] of Object.entries(renderers)) {
          // Don't duplicate if we already have it as a handler
          if (!tools.some(t => t.agentId === agentId && t.name === toolName)) {
            if (renderer && typeof renderer === 'object') {
              const rendererObj = renderer as Record<string, unknown>;
              tools.push({
                agentId,
                name: toolName,
                description:
                  (typeof rendererObj.description === "string" && rendererObj.description) ||
                  (rendererObj.tool as { description?: string } | undefined)?.description,
                parameters:
                  rendererObj.parameters ??
                  (rendererObj.tool as { parameters?: unknown } | undefined)?.parameters,
                type: 'renderer',
              });
            }
          }
        }
      }
    }

    return tools.sort((a, b) => {
      const agentCompare = a.agentId.localeCompare(b.agentId);
      if (agentCompare !== 0) return agentCompare;
      return a.name.localeCompare(b.name);
    });
  }

  private renderToolCard(tool: InspectorToolDefinition) {
    const isExpanded = this.expandedTools.has(`${tool.agentId}:${tool.name}`);
    const schema = this.extractSchemaInfo(tool.parameters);

    const typeColors = {
      handler: "bg-blue-50 text-blue-700 border-blue-200",
      renderer: "bg-purple-50 text-purple-700 border-purple-200",
    };

    return html`
      <div class="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <button
          type="button"
          class="w-full px-4 py-3 text-left transition hover:bg-gray-50"
          @click=${() => this.toggleToolExpansion(`${tool.agentId}:${tool.name}`)}
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-mono text-sm font-semibold text-gray-900">${tool.name}</span>
                <span class="inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${typeColors[tool.type]}">
                  ${tool.type}
                </span>
              </div>
              <div class="flex items-center gap-2 text-xs text-gray-500">
                <span class="flex items-center gap-1">
                  ${this.renderIcon("Bot")}
                  <span class="font-mono">${tool.agentId}</span>
                </span>
                ${schema.properties.length > 0
                  ? html`
                      <span class="text-gray-300">•</span>
                      <span>${schema.properties.length} parameter${schema.properties.length !== 1 ? 's' : ''}</span>
                    `
                  : nothing}
              </div>
              ${tool.description
                ? html`<p class="mt-2 text-xs text-gray-600">${tool.description}</p>`
                : nothing}
            </div>
            <span class="shrink-0 text-gray-400 transition ${isExpanded ? 'rotate-180' : ''}">
              ${this.renderIcon("ChevronDown")}
            </span>
          </div>
        </button>

        ${isExpanded
          ? html`
              <div class="border-t border-gray-200 bg-gray-50/50 px-4 py-3">
                ${schema.properties.length > 0
                  ? html`
                      <h5 class="mb-3 text-xs font-semibold text-gray-700">Parameters</h5>
                      <div class="space-y-3">
                        ${schema.properties.map(prop => html`
                          <div class="rounded-md border border-gray-200 bg-white p-3">
                            <div class="flex items-start justify-between gap-2 mb-1">
                              <span class="font-mono text-xs font-medium text-gray-900">${prop.name}</span>
                              <div class="flex items-center gap-1.5 shrink-0">
                                ${prop.required
                                  ? html`<span class="text-[9px] rounded border border-rose-200 bg-rose-50 px-1 py-0.5 font-medium text-rose-700">required</span>`
                                  : html`<span class="text-[9px] rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-medium text-gray-600">optional</span>`}
                                ${prop.type
                                  ? html`<span class="text-[9px] rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-gray-600">${prop.type}</span>`
                                  : nothing}
                              </div>
                            </div>
                            ${prop.description
                              ? html`<p class="mt-1 text-xs text-gray-600">${prop.description}</p>`
                              : nothing}
                            ${prop.defaultValue !== undefined
                              ? html`
                                  <div class="mt-2 flex items-center gap-1.5 text-[10px] text-gray-500">
                                    <span>Default:</span>
                                    <code class="rounded bg-gray-100 px-1 py-0.5 font-mono">${JSON.stringify(prop.defaultValue)}</code>
                                  </div>
                                `
                              : nothing}
                            ${prop.enum && prop.enum.length > 0
                              ? html`
                                  <div class="mt-2">
                                    <span class="text-[10px] text-gray-500">Allowed values:</span>
                                    <div class="mt-1 flex flex-wrap gap-1">
                                      ${prop.enum.map(val => html`
                                        <code class="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-mono text-gray-700">${JSON.stringify(val)}</code>
                                      `)}
                                    </div>
                                  </div>
                                `
                              : nothing}
                          </div>
                        `)}
                      </div>
                    `
                  : html`
                      <div class="flex items-center justify-center py-4 text-xs text-gray-500">
                        <span>No parameters defined</span>
                      </div>
                    `}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private extractSchemaInfo(parameters: unknown): {
    properties: Array<{
      name: string;
      type?: string;
      description?: string;
      required: boolean;
      defaultValue?: unknown;
      enum?: unknown[];
    }>;
  } {
    const result: {
      properties: Array<{
        name: string;
        type?: string;
        description?: string;
        required: boolean;
        defaultValue?: unknown;
        enum?: unknown[];
      }>;
    } = { properties: [] };

    if (!parameters || typeof parameters !== 'object') {
      return result;
    }

    // Try Zod schema introspection
    const zodDef = (parameters as { _def?: Record<string, unknown> })._def;
    if (zodDef && typeof zodDef === "object") {
      // Handle Zod object schema
      if (zodDef.typeName === 'ZodObject') {
        const rawShape = zodDef.shape;
        const shape =
          typeof rawShape === "function"
            ? (rawShape as () => Record<string, unknown>)()
            : (rawShape as Record<string, unknown> | undefined);

        if (!shape || typeof shape !== "object") {
          return result;
        }
        const requiredKeys = new Set<string>();

        // Get required fields
        if (zodDef.unknownKeys === 'strict' || !zodDef.catchall) {
          Object.keys(shape || {}).forEach((key) => {
            const candidate = (shape as Record<string, unknown>)[key];
            const fieldDef = (candidate as { _def?: Record<string, unknown> } | undefined)?._def;
            if (fieldDef && !this.isZodOptional(candidate)) {
              requiredKeys.add(key);
            }
          });
        }

        // Extract properties
        for (const [key, value] of Object.entries(shape || {})) {
          const fieldInfo = this.extractZodFieldInfo(value);
          result.properties.push({
            name: key,
            type: fieldInfo.type,
            description: fieldInfo.description,
            required: requiredKeys.has(key),
            defaultValue: fieldInfo.defaultValue,
            enum: fieldInfo.enum,
          });
        }
      }
    } else if (
      (parameters as { type?: string; properties?: Record<string, unknown> }).type === 'object' &&
      (parameters as { properties?: Record<string, unknown> }).properties
    ) {
      // Handle JSON Schema format
      const props = (parameters as { properties?: Record<string, unknown> }).properties;
      const required = new Set(
        Array.isArray((parameters as { required?: string[] }).required)
          ? (parameters as { required?: string[] }).required
          : [],
      );

      for (const [key, value] of Object.entries(props ?? {})) {
        const prop = value as Record<string, unknown>;
        result.properties.push({
          name: key,
          type: prop.type as string | undefined,
          description: typeof prop.description === "string" ? prop.description : undefined,
          required: required.has(key),
          defaultValue: prop.default,
          enum: Array.isArray(prop.enum) ? prop.enum : undefined,
        });
      }
    }

    return result;
  }

  private isZodOptional(zodSchema: unknown): boolean {
    const schema = zodSchema as { _def?: Record<string, unknown> };
    if (!schema?._def) return false;

    const def = schema._def;

    // Check if it's explicitly optional or nullable
    if (def.typeName === 'ZodOptional' || def.typeName === 'ZodNullable') {
      return true;
    }

    // Check if it has a default value
    if (def.defaultValue !== undefined) {
      return true;
    }

    return false;
  }

  private extractZodFieldInfo(zodSchema: unknown): {
    type?: string;
    description?: string;
    defaultValue?: unknown;
    enum?: unknown[];
  } {
    const info: {
      type?: string;
      description?: string;
      defaultValue?: unknown;
      enum?: unknown[];
    } = {};

    const schema = zodSchema as { _def?: Record<string, unknown> };
    if (!schema?._def) return info;

    let currentSchema = schema as { _def?: Record<string, unknown> };
    let def = currentSchema._def as Record<string, unknown>;

    // Unwrap optional/nullable
    while (def.typeName === 'ZodOptional' || def.typeName === 'ZodNullable' || def.typeName === 'ZodDefault') {
      if (def.typeName === 'ZodDefault' && def.defaultValue !== undefined) {
        info.defaultValue = typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue;
      }
      currentSchema = (def.innerType as { _def?: Record<string, unknown> }) ?? currentSchema;
      if (!currentSchema?._def) break;
      def = currentSchema._def as Record<string, unknown>;
    }

    // Extract description
    info.description = typeof def.description === "string" ? def.description : undefined;

    const typeName = typeof def.typeName === "string" ? def.typeName : undefined;

    // Extract type
    const typeMap: Record<string, string> = {
      ZodString: 'string',
      ZodNumber: 'number',
      ZodBoolean: 'boolean',
      ZodArray: 'array',
      ZodObject: 'object',
      ZodEnum: 'enum',
      ZodLiteral: 'literal',
      ZodUnion: 'union',
      ZodAny: 'any',
      ZodUnknown: 'unknown',
    };
    info.type = typeName ? typeMap[typeName] || typeName.replace('Zod', '').toLowerCase() : undefined;

    // Extract enum values
    if (typeName === 'ZodEnum' && Array.isArray(def.values)) {
      info.enum = def.values as unknown[];
    } else if (typeName === 'ZodLiteral' && def.value !== undefined) {
      info.enum = [def.value];
    }

    return info;
  }

  private toggleToolExpansion(toolId: string): void {
    if (this.expandedTools.has(toolId)) {
      this.expandedTools.delete(toolId);
    } else {
      this.expandedTools.add(toolId);
    }
    this.requestUpdate();
  }

  private renderContextView() {
    const contextEntries = Object.entries(this.contextStore);

    if (contextEntries.length === 0) {
      return html`
        <div class="flex h-full items-center justify-center px-4 py-8 text-center">
          <div class="max-w-md">
            <div class="mb-3 flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8">
              ${this.renderIcon("FileText")}
            </div>
            <p class="text-sm text-gray-600">No context available</p>
            <p class="mt-2 text-xs text-gray-500">Context will appear here once added to CopilotKit.</p>
          </div>
        </div>
      `;
    }

    return html`
      <div class="flex h-full flex-col overflow-hidden">
        <div class="overflow-auto p-4">
          <div class="space-y-3">
            ${contextEntries.map(([id, context]) => this.renderContextCard(id, context))}
          </div>
        </div>
      </div>
    `;
  }

  private renderContextCard(id: string, context: { description?: string; value: unknown }) {
    const isExpanded = this.expandedContextItems.has(id);
    const valuePreview = this.getContextValuePreview(context.value);
    const hasValue = context.value !== undefined && context.value !== null;
    const title = context.description?.trim() || id;

    return html`
      <div class="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <button
          type="button"
          class="w-full px-4 py-3 text-left transition hover:bg-gray-50"
          @click=${() => this.toggleContextExpansion(id)}
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-900 mb-1">${title}</p>
              <div class="flex items-center gap-2 text-xs text-gray-500">
                <span class="font-mono truncate inline-block align-middle" style="max-width: 180px;">${id}</span>
                ${hasValue
                  ? html`
                      <span class="text-gray-300">•</span>
                      <span class="truncate">${valuePreview}</span>
                    `
                  : nothing}
              </div>
            </div>
            <span class="shrink-0 text-gray-400 transition ${isExpanded ? 'rotate-180' : ''}">
              ${this.renderIcon("ChevronDown")}
            </span>
          </div>
        </button>

        ${isExpanded
          ? html`
              <div class="border-t border-gray-200 bg-gray-50/50 px-4 py-3">
                <div class="mb-3">
                  <h5 class="mb-1 text-xs font-semibold text-gray-700">ID</h5>
                  <code class="block rounded bg-white border border-gray-200 px-2 py-1 text-[10px] font-mono text-gray-600">${id}</code>
                </div>
                ${hasValue
                  ? html`
                      <div class="mb-2 flex items-center justify-between gap-2">
                        <h5 class="text-xs font-semibold text-gray-700">Value</h5>
                        <button
                          class="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-medium text-gray-700 transition hover:bg-gray-50"
                          type="button"
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            void this.copyContextValue(context.value, id);
                          }}
                        >
                          ${this.copiedContextItems.has(id) ? "Copied" : "Copy JSON"}
                        </button>
                      </div>
                      <div class="rounded-md border border-gray-200 bg-white p-3">
                        <pre class="overflow-auto text-xs text-gray-800 max-h-96"><code>${this.formatContextValue(context.value)}</code></pre>
                      </div>
                    `
                  : html`
                      <div class="flex items-center justify-center py-4 text-xs text-gray-500">
                        <span>No value available</span>
                      </div>
                    `}
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private getContextValuePreview(value: unknown): string {
    if (value === undefined || value === null) {
      return '—';
    }

    if (typeof value === 'string') {
      return value.length > 50 ? `${value.substring(0, 50)}...` : value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (Array.isArray(value)) {
      return `Array(${value.length})`;
    }

    if (typeof value === 'object') {
      const keys = Object.keys(value);
      return `Object with ${keys.length} key${keys.length !== 1 ? 's' : ''}`;
    }

    if (typeof value === 'function') {
      return 'Function';
    }

    return String(value);
  }

  private formatContextValue(value: unknown): string {
    if (value === undefined) {
      return 'undefined';
    }

    if (value === null) {
      return 'null';
    }

    if (typeof value === 'function') {
      return value.toString();
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private async copyContextValue(value: unknown, contextId: string): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      console.warn("Clipboard API is not available in this environment.");
      return;
    }

    const serialized = this.formatContextValue(value);
    try {
      await navigator.clipboard.writeText(serialized);
      this.copiedContextItems.add(contextId);
      this.requestUpdate();
      setTimeout(() => {
        this.copiedContextItems.delete(contextId);
        this.requestUpdate();
      }, 1500);
    } catch (error) {
      console.error("Failed to copy context value:", error);
    }
  }

  private toggleContextExpansion(contextId: string): void {
    if (this.expandedContextItems.has(contextId)) {
      this.expandedContextItems.delete(contextId);
    } else {
      this.expandedContextItems.add(contextId);
    }
    this.requestUpdate();
  }

  private handleGlobalPointerDown = (event: PointerEvent): void => {
    if (!this.contextMenuOpen) {
      return;
    }

    const clickedDropdown = event.composedPath().some((node) => {
      return node instanceof HTMLElement && node.dataset?.contextDropdownRoot === "true";
    });

    if (!clickedDropdown) {
      this.contextMenuOpen = false;
      this.requestUpdate();
    }
  };

  private toggleRowExpansion(eventId: string): void {
    // Don't toggle if user is selecting text
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }

    if (this.expandedRows.has(eventId)) {
      this.expandedRows.delete(eventId);
    } else {
      this.expandedRows.add(eventId);
    }
    this.requestUpdate();
  }

  private renderAnnouncementPanel() {
    if (!this.isOpen) {
      return nothing;
    }

    // Ensure loading is triggered even if we mounted in an already-open state
    this.ensureAnnouncementLoading();

    if (!this.hasUnseenAnnouncement) {
      return nothing;
    }

    if (!this.announcementLoaded && !this.announcementMarkdown) {
      return html`<div class="mx-4 my-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-[0_12px_30px_rgba(15,23,42,0.12)]">
        <div class="flex items-center gap-2 font-semibold">
          <span class="inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-900 text-white shadow-sm">
            ${this.renderIcon("Megaphone")}
          </span>
          <span>Loading latest announcement…</span>
        </div>
      </div>`;
    }

    if (this.announcementLoadError) {
      return html`<div class="mx-4 my-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 shadow-[0_12px_30px_rgba(15,23,42,0.12)]">
        <div class="flex items-center gap-2 font-semibold">
          <span class="inline-flex h-6 w-6 items-center justify-center rounded-md bg-rose-600 text-white shadow-sm">
            ${this.renderIcon("Megaphone")}
          </span>
          <span>Announcement unavailable</span>
        </div>
        <p class="mt-2 text-xs text-rose-800">We couldn’t load the latest notice. Please try opening the inspector again.</p>
      </div>`;
    }

    if (!this.announcementMarkdown) {
      return nothing;
    }

    const content = this.announcementHtml
      ? unsafeHTML(this.announcementHtml)
      : html`<pre class="whitespace-pre-wrap text-sm text-gray-900">${this.announcementMarkdown}</pre>`;

    return html`<div class="mx-4 my-3 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-[0_12px_30px_rgba(15,23,42,0.12)]">
      <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span class="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white shadow-sm">
          ${this.renderIcon("Megaphone")}
        </span>
        <span>Announcement</span>
        <button class="announcement-dismiss ml-auto" type="button" @click=${this.handleDismissAnnouncement} aria-label="Dismiss announcement">
          Dismiss
        </button>
      </div>
      <div class="announcement-content text-sm leading-relaxed text-gray-900">${content}</div>
    </div>`;
  }

  private ensureAnnouncementLoading(): void {
    if (this.announcementPromise || typeof window === "undefined" || typeof fetch === "undefined") {
      return;
    }
    this.announcementPromise = this.fetchAnnouncement();
  }

  private renderAnnouncementPreview() {
    if (!this.hasUnseenAnnouncement || !this.showAnnouncementPreview || !this.announcementPreviewText) {
      return nothing;
    }

    const side = this.contextState.button.anchor.horizontal === "left" ? "right" : "left";

    return html`<div
      class="announcement-preview"
      data-side=${side}
      role="note"
      @click=${() => this.handleAnnouncementPreviewClick()}
    >
      <span>${this.announcementPreviewText}</span>
      <span class="announcement-preview__arrow"></span>
    </div>`;
  }

  private handleAnnouncementPreviewClick(): void {
    this.showAnnouncementPreview = false;
    this.openInspector();
  }

  private handleDismissAnnouncement = (): void => {
    this.markAnnouncementSeen();
  };

  private async fetchAnnouncement(): Promise<void> {
    try {
      const response = await fetch(ANNOUNCEMENT_URL, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`Failed to load announcement (${response.status})`);
      }

      const data = (await response.json()) as {
        timestamp?: unknown;
        previewText?: unknown;
        announcement?: unknown;
      };

      const timestamp = typeof data?.timestamp === "string" ? data.timestamp : null;
      const previewText = typeof data?.previewText === "string" ? data.previewText : null;
      const markdown = typeof data?.announcement === "string" ? data.announcement : null;

      if (!timestamp || !markdown) {
        throw new Error("Malformed announcement payload");
      }

      const storedTimestamp = this.loadStoredAnnouncementTimestamp();

      this.announcementTimestamp = timestamp;
      this.announcementPreviewText = previewText ?? "";
      this.announcementMarkdown = markdown;
      this.hasUnseenAnnouncement = (!storedTimestamp || storedTimestamp !== timestamp) && !!this.announcementPreviewText;
      this.showAnnouncementPreview = this.hasUnseenAnnouncement;
      this.announcementHtml = await this.convertMarkdownToHtml(markdown);
      this.announcementLoaded = true;

      this.requestUpdate();
    } catch (error) {
      this.announcementLoadError = error;
      this.announcementLoaded = true;
      this.requestUpdate();
    }
  }

  private async convertMarkdownToHtml(markdown: string): Promise<string | null> {
    const renderer = new marked.Renderer();
    renderer.link = (href, title, text) => {
      const safeHref = this.escapeHtmlAttr(this.appendRefParam(href ?? ""));
      const titleAttr = title ? ` title="${this.escapeHtmlAttr(title)}"` : "";
      return `<a href="${safeHref}" target="_blank" rel="noopener"${titleAttr}>${text}</a>`;
    };
    return marked.parse(markdown, { renderer });
  }

  private appendRefParam(href: string): string {
    try {
      const url = new URL(href, typeof window !== "undefined" ? window.location.href : "https://copilotkit.ai");
      if (!url.searchParams.has("ref")) {
        url.searchParams.append("ref", "cpk-inspector");
      }
      return url.toString();
    } catch {
      return href;
    }
  }

  private escapeHtmlAttr(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private loadStoredAnnouncementTimestamp(): string | null {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(ANNOUNCEMENT_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.timestamp === "string") {
        return parsed.timestamp;
      }
      // Backward compatibility: previous shape { hash }
      return null;
    } catch {
      // ignore malformed storage
    }
    return null;
  }

  private persistAnnouncementTimestamp(timestamp: string): void {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      const payload = JSON.stringify({ timestamp });
      window.localStorage.setItem(ANNOUNCEMENT_STORAGE_KEY, payload);
    } catch {
      // Non-fatal if storage is unavailable
    }
  }

  private markAnnouncementSeen(): void {
    // Clear badge only when explicitly dismissed
    this.hasUnseenAnnouncement = false;
    this.showAnnouncementPreview = false;

    if (!this.announcementTimestamp) {
      // If still loading, attempt once more after promise resolves; avoid infinite requeues
      if (this.announcementPromise && !this.announcementLoaded) {
        void this.announcementPromise.then(() => this.markAnnouncementSeen()).catch(() => undefined);
      }
      this.requestUpdate();
      return;
    }

    this.persistAnnouncementTimestamp(this.announcementTimestamp);
    this.requestUpdate();
  }
}

export function defineWebInspector(): void {
  if (!customElements.get(WEB_INSPECTOR_TAG)) {
    customElements.define(WEB_INSPECTOR_TAG, WebInspectorElement);
  }
}

defineWebInspector();

declare global {
  interface HTMLElementTagNameMap {
    "cpk-web-inspector": WebInspectorElement;
  }
}
