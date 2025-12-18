import { WebInspectorElement } from "../index";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  type CopilotKitCoreSubscriber,
} from "@copilotkitnext/core";
import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import { describe, it, expect, vi, beforeEach } from "vitest";

type MockAgentController = { emit: (key: keyof AgentSubscriber, payload: unknown) => void };

type InspectorInternals = {
  flattenedEvents: Array<{ type: string }>;
  agentMessages: Map<string, Array<{ contentText?: string }>>;
  agentStates: Map<string, unknown>;
  cachedTools: Array<{ name: string }>;
};

type InspectorContextInternals = {
  contextStore: Record<string, { description?: string; value: unknown }>;
  copyContextValue: (value: unknown, id: string) => Promise<void>;
  persistState: () => void;
};

type MockAgentExtras = Partial<{
  messages: unknown;
  state: unknown;
  toolHandlers: Record<string, unknown>;
  toolRenderers: Record<string, unknown>;
}>;

function createMockAgent(
  agentId: string,
  extras: MockAgentExtras = {},
): { agent: AbstractAgent; controller: MockAgentController } {
  const subscribers = new Set<AgentSubscriber>();

  const agent = {
    agentId,
    ...extras,
    subscribe(subscriber: AgentSubscriber) {
      subscribers.add(subscriber);
      return {
        unsubscribe: () => subscribers.delete(subscriber),
      };
    },
  };

  const emit = (key: keyof AgentSubscriber, payload: unknown) => {
    subscribers.forEach((subscriber) => {
      const handler = subscriber[key];
      if (handler) {
        (handler as (arg: unknown) => void)(payload);
      }
    });
  };

  return { agent: agent as unknown as AbstractAgent, controller: { emit } };
}

type MockCore = {
  agents: Record<string, AbstractAgent>;
  context: Record<string, unknown>;
  properties: Record<string, unknown>;
  runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
  subscribe: (subscriber: CopilotKitCoreSubscriber) => { unsubscribe: () => void };
};

function createMockCore(initialAgents: Record<string, AbstractAgent> = {}) {
  const subscribers = new Set<CopilotKitCoreSubscriber>();
  const core: MockCore = {
    agents: initialAgents,
    context: {},
    properties: {},
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
    subscribe(subscriber: CopilotKitCoreSubscriber) {
      subscribers.add(subscriber);
      return { unsubscribe: () => subscribers.delete(subscriber) };
    },
  };

  return {
    core,
    emitAgentsChanged(nextAgents = core.agents) {
      core.agents = nextAgents;
      subscribers.forEach((subscriber) =>
        subscriber.onAgentsChanged?.({
          copilotkit: core as unknown as CopilotKitCore,
          agents: core.agents,
        }),
      );
    },
    emitContextChanged(nextContext: Record<string, unknown>) {
      core.context = nextContext;
      subscribers.forEach((subscriber) =>
        subscriber.onContextChanged?.({
          copilotkit: core as unknown as CopilotKitCore,
          context: core.context as unknown as Readonly<Record<string, { value: string; description: string }>>,
        }),
      );
    },
  };
}

describe("WebInspectorElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    const mockClipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    (navigator as unknown as { clipboard: typeof mockClipboard }).clipboard = mockClipboard;
  });

  it("records agent events and syncs state/messages/tools", async () => {
    const { agent, controller } = createMockAgent("alpha", {
      messages: [{ id: "m1", role: "user", content: "hi there" }],
      state: { foo: "bar" },
      toolHandlers: {
        greet: { description: "hello", parameters: { type: "object" } },
      },
    });
    const { core, emitAgentsChanged } = createMockCore({ alpha: agent });

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = core as unknown as WebInspectorElement["core"];

    emitAgentsChanged();
    await inspector.updateComplete;

    controller.emit("onRunStartedEvent", { event: { id: "run-1" } });
    controller.emit("onMessagesSnapshotEvent", { event: { id: "msg-1" } });
    await inspector.updateComplete;

    const inspectorHandle = inspector as unknown as InspectorInternals;

    const flattened = inspectorHandle.flattenedEvents;
    expect(flattened.some((evt) => evt.type === "RUN_STARTED")).toBe(true);
    expect(flattened.some((evt) => evt.type === "MESSAGES_SNAPSHOT")).toBe(true);
    expect(inspectorHandle.agentMessages.get("alpha")?.[0]?.contentText).toContain("hi there");
    expect(inspectorHandle.agentStates.get("alpha")).toBeDefined();
    expect(inspectorHandle.cachedTools.some((tool) => tool.name === "greet")).toBe(true);
  });

  it("normalizes context, persists state, and copies context values", async () => {
    const { core, emitContextChanged } = createMockCore();
    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = core as unknown as WebInspectorElement["core"];

    emitContextChanged({
      ctxA: { value: { nested: true } },
      ctxB: { description: "Described", value: 5 },
    });
    await inspector.updateComplete;

    const inspectorHandle = inspector as unknown as InspectorContextInternals;
    const contextStore = inspectorHandle.contextStore;
    const ctxA = contextStore.ctxA!;
    const ctxB = contextStore.ctxB!;
    expect(ctxA.value).toMatchObject({ nested: true });
    expect(ctxB.description).toBe("Described");

    await inspectorHandle.copyContextValue({ nested: true }, "ctxA");
    const clipboard = (navigator as unknown as { clipboard: { writeText: ReturnType<typeof vi.fn> } }).clipboard
      .writeText as ReturnType<typeof vi.fn>;
    expect(clipboard).toHaveBeenCalledTimes(1);

    inspectorHandle.persistState();
    expect(localStorage.getItem("cpk:inspector:state")).toBeTruthy();
  });
});
