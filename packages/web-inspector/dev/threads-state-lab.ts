import type {
  CopilotKitCore,
  CopilotKitCoreSubscriber,
  ɵThread,
  ɵThreadStore,
} from "@copilotkit/core";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
} from "@copilotkit/core";
import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";

export type ThreadsLabScenarioKey =
  | "locked"
  | "enabled-empty"
  | "enabled-populated"
  | "list-error"
  | "telemetry-disabled";

type ThreadEndpoints = {
  list: boolean;
  inspect: boolean;
  mutations: boolean;
  realtimeMetadata: boolean;
};

type ThreadsLabCoreShape = {
  telemetryDisabled: boolean;
  runtimeUrl: string;
  runtimeMode: "sse" | "intelligence";
  licenseStatus: "valid" | "none" | "unknown";
  threadEndpoints: ThreadEndpoints;
  intelligence?: { wsUrl: string };
};

export type ThreadsLabScenario = {
  key: ThreadsLabScenarioKey;
  label: string;
  description: string;
  core: ThreadsLabCoreShape;
  threads: ɵThread[];
  messages?: unknown[];
  events?: unknown[];
  state?: Record<string, unknown> | null;
  threadDetails?: Record<
    string,
    {
      messages?: unknown[];
      events?: unknown[];
      state?: Record<string, unknown> | null;
    }
  >;
  listError?: string;
};

const runtimeUrl = "http://127.0.0.1:5177/inspector-lab-runtime";
const intelligence = { wsUrl: "wss://127.0.0.1:5177/inspector-lab-ws" };
const enabledThreadEndpoints: ThreadEndpoints = {
  list: true,
  inspect: true,
  mutations: true,
  realtimeMetadata: false,
};

export const threadsLabScenarios: ThreadsLabScenario[] = [
  {
    key: "locked",
    label: "Locked",
    description:
      "Runtime reports that thread listing/inspection is unavailable.",
    core: {
      telemetryDisabled: false,
      runtimeUrl,
      runtimeMode: "sse",
      licenseStatus: "none",
      threadEndpoints: {
        list: false,
        inspect: false,
        mutations: false,
        realtimeMetadata: false,
      },
    },
    threads: [],
  },
  {
    key: "enabled-empty",
    label: "Enabled, empty",
    description:
      "Runtime supports Threads and shows example rows until real thread history exists.",
    core: {
      telemetryDisabled: false,
      runtimeUrl,
      runtimeMode: "intelligence",
      licenseStatus: "valid",
      threadEndpoints: enabledThreadEndpoints,
      intelligence,
    },
    threads: [],
  },
  {
    key: "enabled-populated",
    label: "Enabled, populated",
    description: "Runtime supports Threads and returns saved thread history.",
    core: {
      telemetryDisabled: false,
      runtimeUrl,
      runtimeMode: "intelligence",
      licenseStatus: "valid",
      threadEndpoints: enabledThreadEndpoints,
      intelligence,
    },
    threads: [
      {
        id: "thread-onboarding",
        name: "Onboarding follow-up",
        agentId: "planner-agent",
        createdAt: "2026-07-08T17:42:00.000Z",
        updatedAt: "2026-07-08T18:03:00.000Z",
      },
      {
        id: "thread-support",
        name: "Support escalation draft",
        agentId: "planner-agent",
        createdAt: "2026-07-07T20:18:00.000Z",
        updatedAt: "2026-07-07T21:10:00.000Z",
      },
    ],
    messages: [
      {
        id: "lab-user-message",
        role: "user",
        content: "Can we follow up on the onboarding plan?",
      },
      {
        id: "lab-assistant-message",
        role: "assistant",
        content:
          "Yes. I drafted the next steps and flagged the Enterprise Intelligence setup question.",
      },
    ],
    events: [
      {
        type: "RUN_STARTED",
        timestamp: "2026-07-08T18:00:00.000Z",
        payload: { runId: "lab-run-1" },
      },
      {
        type: "TEXT_MESSAGE_CONTENT",
        timestamp: "2026-07-08T18:00:01.000Z",
        payload: {
          messageId: "lab-message-1",
          delta: "This event came from the local Inspector Threads lab.",
        },
      },
      {
        type: "RUN_FINISHED",
        timestamp: "2026-07-08T18:00:02.000Z",
        payload: { runId: "lab-run-1" },
      },
    ],
    state: {
      source: "inspector-threads-state-lab",
      selectedThread: "thread-onboarding",
      phase: "follow-up",
    },
  },
  {
    key: "list-error",
    label: "List error",
    description: "Runtime advertises Threads, but the list endpoint fails.",
    core: {
      telemetryDisabled: false,
      runtimeUrl,
      runtimeMode: "intelligence",
      licenseStatus: "valid",
      threadEndpoints: enabledThreadEndpoints,
      intelligence,
    },
    threads: [],
    listError: "401 Unauthorized: missing project credentials",
  },
  {
    key: "telemetry-disabled",
    label: "Telemetry disabled",
    description:
      "Runtime supports Threads and returns saved history, with inspector telemetry disabled.",
    core: {
      telemetryDisabled: true,
      runtimeUrl,
      runtimeMode: "intelligence",
      licenseStatus: "valid",
      threadEndpoints: enabledThreadEndpoints,
      intelligence,
    },
    threads: [
      {
        id: "thread-telemetry-optout",
        name: "Telemetry opt-out audit",
        agentId: "planner-agent",
        createdAt: "2026-07-05T16:00:00.000Z",
        updatedAt: "2026-07-05T16:22:00.000Z",
      },
    ],
    messages: [
      {
        id: "telemetry-user-message",
        role: "user",
        content:
          "Confirm the inspector still works when telemetry is disabled.",
      },
      {
        id: "telemetry-assistant-message",
        role: "assistant",
        content:
          "Telemetry is disabled for this preview; the thread UI still loads saved history.",
      },
    ],
    events: [
      {
        type: "RUN_STARTED",
        timestamp: "2026-07-05T16:20:00.000Z",
        payload: { runId: "telemetry-run-1" },
      },
      {
        type: "RUN_FINISHED",
        timestamp: "2026-07-05T16:22:00.000Z",
        payload: { runId: "telemetry-run-1" },
      },
    ],
    state: {
      source: "inspector-threads-state-lab",
      telemetryDisabled: true,
      selectedThread: "thread-telemetry-optout",
    },
  },
];

export function getThreadsLabScenario(
  key: ThreadsLabScenarioKey,
): ThreadsLabScenario {
  const scenario = threadsLabScenarios.find((item) => item.key === key);
  if (!scenario) {
    throw new Error(`Unknown Threads lab scenario: ${key}`);
  }
  return scenario;
}

export function createThreadsLabCore(
  scenario: ThreadsLabScenario,
): CopilotKitCore {
  const subscribers = new Set<CopilotKitCoreSubscriber>();
  const threadStores = new Map<string, ɵThreadStore>();
  const agent = createLabAgent("planner-agent");

  const core = {
    agents: { [agent.agentId]: agent },
    context: {},
    properties: {},
    telemetryDisabled: scenario.core.telemetryDisabled,
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
    runtimeUrl: scenario.core.runtimeUrl,
    runtimeMode: scenario.core.runtimeMode,
    licenseStatus: scenario.core.licenseStatus,
    intelligence: scenario.core.intelligence,
    headers: { "X-Inspector-Lab": scenario.key },
    threadEndpoints: scenario.core.threadEndpoints,
    subscribe(subscriber: CopilotKitCoreSubscriber) {
      subscribers.add(subscriber);
      return { unsubscribe: () => subscribers.delete(subscriber) };
    },
    getThreadStores() {
      return Object.fromEntries(threadStores);
    },
    getThreadStore(agentId: string) {
      return threadStores.get(agentId);
    },
    registerThreadStore(agentId: string, store: ɵThreadStore) {
      threadStores.set(agentId, store);
    },
    unregisterThreadStore(agentId: string) {
      threadStores.delete(agentId);
    },
    getMemoryStore() {
      return createUnavailableMemoryStore();
    },
  } satisfies Partial<CopilotKitCore> & {
    agents: Record<string, AbstractAgent>;
    subscribe: CopilotKitCore["subscribe"];
    getThreadStores: CopilotKitCore["getThreadStores"];
    getThreadStore: CopilotKitCore["getThreadStore"];
    registerThreadStore: CopilotKitCore["registerThreadStore"];
    unregisterThreadStore: CopilotKitCore["unregisterThreadStore"];
  };

  if (scenario.core.threadEndpoints.list) {
    const store = ɵcreateThreadStore({
      fetch: createThreadsLabScenarioFetch(scenario),
    });
    store.start();
    store.setContext({
      runtimeUrl: scenario.core.runtimeUrl,
      headers: { "X-Inspector-Lab": scenario.key },
      wsUrl: scenario.core.intelligence?.wsUrl,
      agentId: agent.agentId,
    });
    threadStores.set(agent.agentId, store);
  }

  return core as CopilotKitCore;
}

export function disposeThreadsLabCore(core: CopilotKitCore): void {
  for (const [agentId, store] of Object.entries(core.getThreadStores())) {
    store.stop();
    core.unregisterThreadStore(agentId);
  }
}

function createLabAgent(agentId: string): AbstractAgent {
  const subscribers = new Set<AgentSubscriber>();
  return {
    agentId,
    messages: [],
    state: {
      phase: "idle",
      harness: "inspector-threads-state-lab",
    },
    subscribe(subscriber: AgentSubscriber) {
      subscribers.add(subscriber);
      return { unsubscribe: () => subscribers.delete(subscriber) };
    },
  } as unknown as AbstractAgent;
}

export function createThreadsLabScenarioFetch(
  scenario: ThreadsLabScenario,
  fallbackFetch?: typeof fetch,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(scenario.core.runtimeUrl)) {
      if (fallbackFetch) return fallbackFetch(input, init);
      return new Response("Not found", { status: 404 });
    }

    if (url.includes("/threads?")) {
      if (scenario.listError) {
        return new Response(JSON.stringify({ error: scenario.listError }), {
          status: 401,
          statusText: "Unauthorized",
        });
      }
      return jsonResponse({
        threads: scenario.threads.map(toThreadRecord),
        joinCode: null,
        nextCursor: null,
      });
    }

    if (url.endsWith("/messages")) {
      const details = getScenarioThreadDetails(scenario, url);
      return jsonResponse({
        messages: details?.messages ?? scenario.messages ?? [],
      });
    }

    if (url.endsWith("/events")) {
      const details = getScenarioThreadDetails(scenario, url);
      return jsonResponse({
        events: details?.events ?? scenario.events ?? [],
      });
    }

    if (url.endsWith("/state")) {
      const details = getScenarioThreadDetails(scenario, url);
      return jsonResponse({
        state: details?.state ?? scenario.state ?? null,
      });
    }

    return new Response("Not found", { status: 404 });
  };
}

function getScenarioThreadDetails(
  scenario: ThreadsLabScenario,
  url: string,
): NonNullable<ThreadsLabScenario["threadDetails"]>[string] | null {
  const match = url.match(/\/threads\/([^/]+)\/(?:messages|events|state)$/);
  if (!match) return null;
  const threadId = decodeURIComponent(match[1]!);
  return scenario.threadDetails?.[threadId] ?? null;
}

function toThreadRecord(thread: ɵThread) {
  return {
    id: thread.id,
    organizationId: "local-lab-org",
    agentId: thread.agentId,
    createdById: "local-lab-user",
    name: thread.name ?? null,
    archived: false,
    createdAt: thread.createdAt ?? "2026-07-08T17:42:00.000Z",
    updatedAt: thread.updatedAt ?? "2026-07-08T18:03:00.000Z",
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createUnavailableMemoryStore() {
  const subscription = { unsubscribe() {} };
  return {
    getState: () => ({
      memories: [],
      isLoading: false,
      error: null,
      available: false,
      realtimeStatus: "unavailable",
    }),
    select: () => ({
      subscribe: () => subscription,
    }),
  };
}
