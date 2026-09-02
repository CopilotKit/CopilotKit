import { createServer } from "node:http";
import type { Server } from "node:http";

import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import { WebSocket } from "ws";
import { expect, test, vi } from "vitest";

import type { WebInspectorElement } from "@copilotkit/web-inspector";
import {
  ALL_SCENARIO_KEYS,
  CORE_SCENARIO_KEYS,
  EDGE_SCENARIO_KEYS,
  LEARNING_SCENARIO_KEYS,
  LAB_RESET_STORAGE_KEYS,
  THREAD_REQUEST_KINDS,
  THREADS_STATE_SCENARIOS,
  canonicalScenarioUrl,
  clearThreadsStateLabNotificationState,
  clearThreadsStateLabStorage,
  consumedNotificationReplayUrl,
  copyThreadsStateLabDirectLink,
  getThreadsStateScenario,
  installThreadsStateLabNavigation,
  installThreadsStateLabReducedMotion,
  navigateThreadsStateLabScenario,
  notificationReplayUrl,
  parseScenarioKey,
  runtimeUrlFor,
  seedThreadsStateLabAgentEvents,
  stopThreadsStateLabClient,
} from "./threads-state-lab.js";
import type {
  ThreadRequestCounters,
  ThreadsStateScenario,
} from "./threads-state-lab.js";
import {
  createThreadsStateLabPlugin,
  createThreadsStateLabRuntime,
} from "./threads-state-lab-server.js";

await vi.importActual("../src/index.js");
import type {
  ThreadsStateLabMiddleware,
  ThreadsStateLabPlugin,
  ThreadsStateLabRuntime,
} from "./threads-state-lab-server.js";

const EXPECTED_CORE_KEYS = [
  "pro-enabled-zero",
  "pro-enabled-existing",
  "pro-disabled-zero",
  "pro-disabled-existing",
  "team-enabled-zero",
  "team-enabled-existing",
  "team-disabled-zero",
  "team-disabled-existing",
  "enterprise-enabled-zero",
  "enterprise-enabled-existing",
  "enterprise-disabled-zero",
  "enterprise-disabled-existing",
  "self-hosted-enabled-zero",
  "self-hosted-enabled-existing",
  "self-hosted-disabled-zero",
  "self-hosted-disabled-existing",
] as const;

const EXPECTED_EDGE_KEYS = [
  "free-figma-148-of-200",
  "free-overage-241-of-200",
  "pro-warning-4500-of-5000",
  "pro-at-limit-5000-of-5000",
  "oss-no-metadata-enabled-zero",
  "capability-absent",
  "unknown-limit",
  "missing-expiry",
  "malformed-expiry",
  "usage-only",
  "action-only",
  "license-none",
  "license-expired",
  "agent-run-error",
  "thread-list-error",
  "video-error",
  "reduced-motion",
  "telemetry-disabled",
] as const;

const EXPECTED_LEARNING_KEYS = [
  "learning-enabled-existing",
  "learning-enabled-empty",
  "learning-disabled",
] as const;

const EXPECTED_RECORDING_THREADS = [
  {
    name: "Plan onboarding follow-up",
    updatedAt: "2026-07-30T09:24:00.000Z",
  },
  {
    name: "Product recommendation review",
    updatedAt: "2026-07-31T18:55:00.000Z",
  },
  {
    name: "Account access troubleshooting",
    updatedAt: "2026-08-01T10:41:00.000Z",
  },
  {
    name: "Subscription renewal question",
    updatedAt: "2026-08-01T22:17:00.000Z",
  },
  {
    name: "Checkout support follow-up",
    updatedAt: "2026-08-02T13:22:00.000Z",
  },
  {
    name: "Billing escalation handoff",
    updatedAt: "2026-08-02T19:08:00.000Z",
  },
  {
    name: "AI Tooling Retrospective Report",
    updatedAt: "2026-08-03T09:45:00.000Z",
  },
  {
    name: "Data Centers and Water",
    updatedAt: "2026-08-03T17:12:00.000Z",
  },
  {
    name: "View Storage Naming Suggestions",
    updatedAt: "2026-08-03T21:30:00.000Z",
  },
  {
    name: "Catching a Throwed Roll in Every Lambert's Cafe",
    updatedAt: "2026-08-04T11:05:00.000Z",
  },
  {
    name: "Queue Management in k8s",
    updatedAt: "2026-08-04T14:18:00.000Z",
  },
  {
    name: "Flights from Chicago to Orlando",
    updatedAt: "2026-08-04T16:42:00.000Z",
  },
] as const;

const ZERO_COUNTERS = {
  list: 0,
  subscribe: 0,
  inspect: 0,
  messages: 0,
  events: 0,
  state: 0,
} as const;

type RunningLabServer = Readonly<{
  baselineUpgradeListeners: number;
  origin: string;
  runtime: ThreadsStateLabRuntime;
  server: Server;
}>;

type RunningViteLabServer = Readonly<{
  close: () => Promise<void>;
  httpServer: Server;
  origin: string;
  plugin: ThreadsStateLabPlugin;
}>;

/** Starts one real HTTP and Phoenix server on a free loopback port. */
async function startLabServer(): Promise<RunningLabServer> {
  const runtime = createThreadsStateLabRuntime();
  const server = createServer((request, response) => {
    void runtime.handleNodeRequest(request, response);
  });
  const baselineUpgradeListeners = server.listenerCount("upgrade");
  runtime.attachWebSocketServer(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP test server address.");
  }
  return {
    baselineUpgradeListeners,
    origin: `http://127.0.0.1:${address.port}`,
    runtime,
    server,
  };
}

/** Stops stores, sockets, listeners, and the loopback HTTP server. */
async function stopLabServer(lab: RunningLabServer): Promise<void> {
  await lab.runtime.dispose();
  await new Promise<void>((resolve, reject) => {
    lab.server.close((error) => (error ? reject(error) : resolve()));
  });
}

/** Starts the Vite plugin through its narrow server adapter and owns shutdown. */
async function startViteLabServer(): Promise<RunningViteLabServer> {
  const httpServer = createServer();
  const handlers: ThreadsStateLabMiddleware[] = [];
  const plugin = createThreadsStateLabPlugin();
  plugin.configureLabServer({
    httpServer,
    useMiddleware(handler) {
      handlers.push(handler);
    },
  });
  const handler = handlers[0];
  if (!handler) throw new Error("Expected the lab Runtime middleware.");
  httpServer.on("request", (request, response) => {
    handler(request, response, () => {
      response.statusCode = 200;
      response.setHeader("content-type", "text/html");
      response.end("Vite fallback");
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    await plugin.closeBundle();
    throw new Error("Expected a TCP Vite test server address.");
  }
  let closePromise: Promise<void> | null = null;
  return {
    close() {
      closePromise ??= (async () => {
        await plugin.closeBundle();
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
      })();
      return closePromise;
    },
    httpServer,
    origin: `http://127.0.0.1:${address.port}`,
    plugin,
  };
}

/** Waits for Lit and its immediate reactive work without a timing sleep. */
async function flushInspector(inspector: WebInspectorElement): Promise<void> {
  await Promise.resolve();
  await inspector.updateComplete;
  await Promise.resolve();
  await inspector.updateComplete;
}

/** Finds matching elements across every public nested Shadow Root. */
function collectDeep(root: Document | ShadowRoot | Element, selector: string) {
  const matches = Array.from(root.querySelectorAll(selector));
  for (const element of root.querySelectorAll("*")) {
    if (element.shadowRoot) {
      matches.push(...collectDeep(element.shadowRoot, selector));
    }
  }
  return matches;
}

/** Reads text recursively while excluding non-visible style and script text. */
function readableNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (
    node instanceof Element &&
    (node.tagName === "STYLE" || node.tagName === "SCRIPT")
  ) {
    return "";
  }
  const parts = Array.from(node.childNodes, readableNodeText);
  if (node instanceof Element && node.shadowRoot) {
    parts.push(readableNodeText(node.shadowRoot));
  }
  return parts.join(" ");
}

/** Returns normalized text from an Inspector and its public Shadow Roots. */
function inspectorText(inspector: WebInspectorElement): string {
  const root = inspector.shadowRoot;
  if (!root) return "";
  return readableNodeText(root).replace(/\s+/g, " ").trim();
}

/** Finds one native public Inspector button by its visible label. */
function inspectorButton(
  inspector: WebInspectorElement,
  label: string,
): HTMLButtonElement | undefined {
  const root = inspector.shadowRoot;
  if (!root) return undefined;
  return collectDeep(root, "button")
    .filter((element) => element instanceof HTMLButtonElement)
    .find(
      (button) => button.textContent?.replace(/\s+/g, " ").trim() === label,
    );
}

/** Returns every visible local-example button in the current Threads surface. */
function exampleButtons(inspector: WebInspectorElement): HTMLButtonElement[] {
  const root = inspector.shadowRoot;
  if (!root) return [];
  return collectDeep(root, "button")
    .filter((element) => element instanceof HTMLButtonElement)
    .filter((button) => button.textContent?.includes("Example"));
}

/** Reads the current server-side request counters for one scenario. */
async function requestCounters(
  origin: string,
  scenario: ThreadsStateScenario,
): Promise<ThreadRequestCounters> {
  const response = await fetch(
    `${runtimeUrlFor(origin, scenario.key)}/request-log`,
  );
  const value = await readJson(response);
  if (
    typeof value !== "object" ||
    value === null ||
    !("counters" in value) ||
    typeof value.counters !== "object" ||
    value.counters === null
  ) {
    throw new Error("Expected a request counter object.");
  }
  const counters = value.counters;
  for (const kind of THREAD_REQUEST_KINDS) {
    if (typeof Reflect.get(counters, kind) !== "number") {
      throw new Error(`Expected a numeric ${kind} counter.`);
    }
  }
  return {
    list: Reflect.get(counters, "list"),
    subscribe: Reflect.get(counters, "subscribe"),
    inspect: Reflect.get(counters, "inspect"),
    messages: Reflect.get(counters, "messages"),
    events: Reflect.get(counters, "events"),
    state: Reflect.get(counters, "state"),
  };
}

/** Returns the expected action label for trusted fixture metadata. */
function expectedActionLabel(scenario: ThreadsStateScenario): string | null {
  const kind = scenario.inspectorMetadata?.action?.kind;
  if (kind === "manage_plan") {
    const usage = scenario.inspectorMetadata?.usage;
    if (usage?.limit.kind === "finite") {
      const warningThreshold =
        usage.limit.value - Math.floor(usage.limit.value / 10);
      if (usage.used >= warningThreshold) return "Upgrade Your Plan";
    }
    return "Manage Your Plan";
  }
  if (kind === "enable_intelligence") return "Enable Intelligence";
  if (kind === "renew") return "Renew";
  return null;
}

/** Returns the finite progress tone expected from trusted usage. */
function expectedCapacityState(
  scenario: ThreadsStateScenario,
): "normal" | "warning" | "critical" | null {
  const usage = scenario.inspectorMetadata?.usage;
  if (usage?.limit.kind !== "finite") return null;
  if (usage.used >= usage.limit.value) return "critical";

  const warningThreshold =
    usage.limit.value - Math.floor(usage.limit.value / 10);
  return usage.used >= warningThreshold ? "warning" : "normal";
}

/** Returns the required overview copy for a route that cannot show saved rows. */
function expectedOverviewCopy(
  scenario: ThreadsStateScenario,
): Readonly<{ heading: string; description: string }> | null {
  if (scenario.data === "error") return null;
  if (scenario.runtimeInfo.licenseStatus === "none") {
    return {
      heading: "Enable Intelligence to inspect Threads.",
      description:
        "Persist conversations and inspect saved thread history from the Inspector.",
    };
  }
  if (scenario.runtimeInfo.licenseStatus === "expired") {
    return {
      heading: "Renew Intelligence to inspect Threads.",
      description:
        "Your Intelligence access has expired. Renew it to inspect saved thread history.",
    };
  }
  if (scenario.capability !== "enabled") {
    return {
      heading: "Finish setting up Rich Threads",
      description:
        "Copy this prompt into your coding agent to finish the setup.",
    };
  }
  if (scenario.data === "existing") return null;
  return {
    heading: "Threads are persistent, inspectable conversations",
    description:
      "Take a tour with the example threads in the sidebar. Then, start chatting in your app to create the first real thread.",
  };
}

/**
 * Bridges jsdom's DOM realm to the real Node fetch and ws implementations.
 *
 * Node 24 rejects jsdom's AbortSignal before a loopback request reaches the
 * server. Cancellation has focused Core coverage; this matrix instead checks
 * the complete Inspector flow against bounded local responses, so its fetch
 * bridge removes only that incompatible test-realm signal.
 */
function installNodeIntegrationBridges(): () => void {
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const webSocketDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "WebSocket",
  );
  const nodeFetch = globalThis.fetch;
  const bridgedFetch = Object.assign(
    (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): ReturnType<typeof fetch> => {
      if (!init?.signal) return nodeFetch(input, init);
      const compatibleInit: RequestInit = { ...init };
      Reflect.deleteProperty(compatibleInit, "signal");
      return nodeFetch(input, compatibleInit);
    },
    nodeFetch,
  );
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: bridgedFetch,
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: WebSocket,
  });
  return () => {
    if (fetchDescriptor) {
      Object.defineProperty(globalThis, "fetch", fetchDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "fetch");
    }
    if (webSocketDescriptor) {
      Object.defineProperty(globalThis, "WebSocket", webSocketDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "WebSocket");
    }
  };
}

function assertDeeplyFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) {
    assertDeeplyFrozen(nested, seen);
  }
}

async function readJson(response: Response): Promise<unknown> {
  expect(response.headers.get("content-type")).toContain("application/json");
  return response.json();
}

function nextSocketMessage(socket: WebSocket): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    });
  });
}

test("exports the exact ordered 37-scenario route catalog", () => {
  expect(CORE_SCENARIO_KEYS).toEqual(EXPECTED_CORE_KEYS);
  expect(LEARNING_SCENARIO_KEYS).toEqual(EXPECTED_LEARNING_KEYS);
  expect(EDGE_SCENARIO_KEYS).toEqual(EXPECTED_EDGE_KEYS);
  expect(ALL_SCENARIO_KEYS).toEqual([
    ...EXPECTED_CORE_KEYS,
    ...EXPECTED_LEARNING_KEYS,
    ...EXPECTED_EDGE_KEYS,
  ]);
  expect(new Set(ALL_SCENARIO_KEYS).size).toBe(37);
  expect(Object.keys(THREADS_STATE_SCENARIOS)).toEqual(ALL_SCENARIO_KEYS);
});

test("models a deterministic CopilotKit agent RunError on Home", () => {
  const scenario = getThreadsStateScenario("agent-run-error");
  expect(scenario.initialMenu).toBe("home");
  expect(scenario.initialAgentEvents).toEqual([
    {
      type: "RUN_ERROR",
      runId: "threads-lab-run-error",
      message: "The agent could not complete this run.",
      code: "AGENT_RUN_ERROR",
    },
  ]);
});

test("deep-freezes every fixture and produces deterministic JSON", () => {
  assertDeeplyFrozen(CORE_SCENARIO_KEYS);
  assertDeeplyFrozen(LEARNING_SCENARIO_KEYS);
  assertDeeplyFrozen(EDGE_SCENARIO_KEYS);
  assertDeeplyFrozen(ALL_SCENARIO_KEYS);
  assertDeeplyFrozen(THREADS_STATE_SCENARIOS);
  const first = JSON.stringify(THREADS_STATE_SCENARIOS);
  const second = JSON.stringify(THREADS_STATE_SCENARIOS);
  expect(second).toBe(first);
});

test("models every plan deployment capability and data matrix cell", () => {
  for (const key of CORE_SCENARIO_KEYS) {
    const scenario = getThreadsStateScenario(key);
    const metadata = scenario.inspectorMetadata;
    const selfHosted = key.startsWith("self-hosted-");
    expect(scenario.deployment).toBe(selfHosted ? "self_hosted" : "managed");
    expect(scenario.runtimeInfo.threadEndpoints?.list).toBe(
      scenario.capability === "enabled",
    );
    expect(scenario.threads.length).toBe(scenario.data === "existing" ? 2 : 0);
    expect(metadata?.plan?.label.toLowerCase()).toContain(
      selfHosted ? "team" : scenario.plan,
    );
    if (scenario.plan === "enterprise") {
      expect(metadata?.usage?.limit).toEqual({ kind: "unlimited" });
      expect(metadata?.action).toBeUndefined();
    }
    if (selfHosted) {
      expect(metadata?.plan).toEqual({
        code: "team_self_hosted",
        label: "Team Self-Hosted",
      });
      expect(metadata?.usage?.limit).toEqual({ kind: "finite", value: 25_000 });
      expect(metadata?.action).toBeUndefined();
    } else {
      expect(metadata?.plan?.code).not.toBe("team_self_hosted");
    }
  }
});

test("models enabled, empty, and disabled Automatic Learning fixtures", () => {
  const existing = getThreadsStateScenario("learning-enabled-existing");
  const empty = getThreadsStateScenario("learning-enabled-empty");
  const disabled = getThreadsStateScenario("learning-disabled");

  expect(existing.learning).toBe("enabled");
  expect(existing.initialMenu).toBe("memories");
  expect(existing.memories.map((memory) => memory.kind)).toEqual([
    "topical",
    "episodic",
    "operational",
  ]);
  expect(empty.learning).toBe("enabled");
  expect(empty.initialMenu).toBe("memories");
  expect(empty.memories).toEqual([]);
  expect(disabled.learning).toBe("disabled");
  expect(disabled.initialMenu).toBe("memories");
  expect(disabled.memories).toEqual([]);
});

test("models zero-thread routes with available usage as true zero states", () => {
  const zeroScenarios = Object.values(THREADS_STATE_SCENARIOS).filter(
    (scenario) => scenario.data === "zero",
  );

  for (const scenario of zeroScenarios) {
    const usage = scenario.inspectorMetadata?.usage;

    expect(scenario.threads, scenario.key).toEqual([]);
    if (!usage) continue;
    expect(usage.used, scenario.key).toBe(0);
    expect(usage.expiringSoonCount, scenario.key).toBe(0);
  }
});

test("models the recording route with twelve realistic saved Threads", () => {
  const scenario = getThreadsStateScenario("free-figma-148-of-200");
  const threadIds = scenario.threads.map((thread) => thread.id);
  const threadNames = scenario.threads.map((thread) => thread.name);
  const creatorIds = scenario.threads.map((thread) => thread.createdById);
  const updateTimes = scenario.threads.map((thread) =>
    Date.parse(thread.updatedAt),
  );
  const newestThread = scenario.threads.reduce((newest, thread) =>
    Date.parse(thread.updatedAt) > Date.parse(newest.updatedAt)
      ? thread
      : newest,
  );
  const detailEventTimestamps = Object.values(scenario.details).flatMap(
    (details) => details.events.map((event) => event.timestamp),
  );

  expect(scenario.threads).toHaveLength(12);
  expect(
    scenario.threads.map(({ name, updatedAt }) => ({ name, updatedAt })),
  ).toEqual(EXPECTED_RECORDING_THREADS);
  expect(new Set(threadIds).size).toBe(12);
  expect(new Set(threadNames).size).toBe(12);
  expect(new Set(creatorIds).size).toBe(1);
  expect(
    scenario.threads.every(
      (thread) =>
        thread.agentId === scenario.agentId &&
        thread.archived === false &&
        thread.name.trim().length > 0,
    ),
  ).toBe(true);
  expect(
    scenario.threads.every(
      (thread) =>
        new Date(thread.createdAt).toISOString() === thread.createdAt &&
        new Date(thread.updatedAt).toISOString() === thread.updatedAt &&
        Date.parse(thread.createdAt) <= Date.parse(thread.updatedAt),
    ),
  ).toBe(true);
  expect(new Set(updateTimes).size).toBe(12);
  expect(updateTimes).toEqual(
    [...updateTimes].sort((left, right) => left - right),
  );
  expect(scenario.expectedNewestThreadId).toBe(newestThread.id);
  expect(newestThread.name).toBe("Flights from Chicago to Orlando");
  expect(Object.keys(scenario.details)).toEqual(threadIds);
  expect(
    detailEventTimestamps.every(
      (timestamp) =>
        typeof timestamp === "string" &&
        new Date(timestamp).toISOString() === timestamp,
    ),
  ).toBe(true);
  for (const thread of scenario.threads) {
    const details = scenario.details[thread.id];

    expect(details?.events.at(-1)?.timestamp, thread.id).toBe(thread.updatedAt);
    expect(details?.state.reviewStatus, thread.id).toBe(
      thread.id === newestThread.id ? "ready" : "draft",
    );
  }
  expect(scenario.inspectorMetadata?.usage).toEqual({
    used: 148,
    limit: { kind: "finite", value: 200 },
    expiringSoonCount: 37,
  });
});

test("preserves all edge metadata states without normalizing fixtures", () => {
  expect(
    getThreadsStateScenario("oss-no-metadata-enabled-zero").inspectorMetadata,
  ).toBeUndefined();
  expect(
    getThreadsStateScenario("missing-expiry").inspectorMetadata?.usage,
  ).not.toHaveProperty("expiringSoonCount");
  expect(
    getThreadsStateScenario("malformed-expiry").inspectorMetadataBody,
  ).toMatchObject({ usage: { expiringSoonCount: "invalid" } });
  expect(
    getThreadsStateScenario("free-overage-241-of-200").inspectorMetadata?.usage,
  ).toEqual({
    used: 241,
    limit: { kind: "finite", value: 200 },
    expiringSoonCount: 0,
  });
  expect(
    getThreadsStateScenario("pro-warning-4500-of-5000").inspectorMetadata
      ?.usage,
  ).toEqual({
    used: 4_500,
    limit: { kind: "finite", value: 5_000 },
    expiringSoonCount: 12,
  });
  expect(
    getThreadsStateScenario("pro-at-limit-5000-of-5000").inspectorMetadata
      ?.usage,
  ).toEqual({
    used: 5_000,
    limit: { kind: "finite", value: 5_000 },
    expiringSoonCount: 0,
  });
  expect(getThreadsStateScenario("usage-only").inspectorMetadata).toEqual({
    schemaVersion: 1,
    usage: {
      used: 36,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 4,
    },
  });
});

test("uses safe actions, catalog limits, and newest thread fixtures", () => {
  for (const scenario of Object.values(THREADS_STATE_SCENARIOS)) {
    const action = scenario.inspectorMetadata?.action;
    if (action) {
      const url = new URL(action.url);
      expect(url.protocol).toBe("https:");
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
    }
    if (scenario.expectedNewestThreadId) {
      const newestThread = scenario.threads.reduce((newest, thread) =>
        Date.parse(thread.updatedAt) > Date.parse(newest.updatedAt)
          ? thread
          : newest,
      );

      expect(scenario.threads.length).toBeGreaterThan(0);
      expect(newestThread.id).toBe(scenario.expectedNewestThreadId);
    }
    if (
      scenario.deployment === "self_hosted" ||
      scenario.inspectorMetadata?.plan?.code === "enterprise"
    ) {
      expect(scenario.inspectorMetadata?.action).toBeUndefined();
    }
  }
});

test("serves public info and optional inspector metadata shapes", async () => {
  const runtime = createThreadsStateLabRuntime();
  const info = await runtime.handleRequest(
    new Request("http://127.0.0.1/inspector-lab-runtime/pro-enabled-zero/info"),
  );
  expect(await readJson(info)).toMatchObject({
    agents: { "threads-lab-agent": { name: "threads-lab-agent" } },
    mode: "intelligence",
    threadEndpoints: { list: true },
    inspectorMetadata: true,
  });
  const absent = await runtime.handleRequest(
    new Request(
      "http://127.0.0.1/inspector-lab-runtime/oss-no-metadata-enabled-zero/inspector-metadata",
    ),
  );
  expect(absent.status).toBe(204);
  await runtime.dispose();
});

test("serves deterministic list and bounded list-error responses", async () => {
  const runtime = createThreadsStateLabRuntime();
  const list = await runtime.handleRequest(
    new Request(
      "http://127.0.0.1/inspector-lab-runtime/pro-enabled-existing/threads?agentId=threads-lab-agent",
    ),
  );
  expect(await readJson(list)).toMatchObject({
    threads: [{ id: expect.any(String) }, { id: expect.any(String) }],
    joinCode: expect.any(String),
    nextCursor: null,
  });
  const failure = await runtime.handleRequest(
    new Request(
      "http://127.0.0.1/inspector-lab-runtime/thread-list-error/threads?agentId=threads-lab-agent",
    ),
  );
  expect(failure.status).toBe(503);
  expect(await readJson(failure)).toEqual({
    error: "Thread list unavailable in this lab scenario.",
  });
  await runtime.dispose();
});

test("serves Automatic Learning records, realtime credentials, recall, and the disabled gate", async () => {
  const runtime = createThreadsStateLabRuntime();
  const enabledBase =
    "http://127.0.0.1/inspector-lab-runtime/learning-enabled-existing";
  const list = await runtime.handleRequest(
    new Request(`${enabledBase}/memories`),
  );
  expect(await readJson(list)).toMatchObject({
    memories: [
      { kind: "topical" },
      { kind: "episodic" },
      { kind: "operational" },
    ],
  });
  const subscribe = await runtime.handleRequest(
    new Request(`${enabledBase}/memories/subscribe`, {
      method: "POST",
      body: "{}",
    }),
  );
  expect(await readJson(subscribe)).toEqual({
    joinToken: "threads-lab-token-learning-enabled-existing",
    joinCode: "memories-threads-lab-learning-enabled-existing",
  });
  const recall = await runtime.handleRequest(
    new Request(`${enabledBase}/memories/recall`, {
      method: "POST",
      body: JSON.stringify({ query: "launch review" }),
    }),
  );
  const recallBody = (await readJson(recall)) as { memories: unknown[] };
  expect(recallBody).toMatchObject({
    memories: expect.any(Array),
  });
  expect(recallBody.memories[0]).toMatchObject({ score: 0.95 });
  const disabled = await runtime.handleRequest(
    new Request(
      "http://127.0.0.1/inspector-lab-runtime/learning-disabled/memories",
    ),
  );
  expect(disabled.status).toBe(404);
  await runtime.dispose();
});

test("serves subscribe inspect messages events and state contracts", async () => {
  const runtime = createThreadsStateLabRuntime();
  const scenario = getThreadsStateScenario("pro-enabled-existing");
  const threadId = scenario.expectedNewestThreadId;
  expect(threadId).toBeDefined();
  const base = "http://127.0.0.1/inspector-lab-runtime/pro-enabled-existing";
  const subscribe = await runtime.handleRequest(
    new Request(`${base}/threads/subscribe`, { method: "POST", body: "{}" }),
  );
  expect(await readJson(subscribe)).toEqual({
    joinToken: scenario.joinToken,
  });
  const inspect = await runtime.handleRequest(
    new Request(`${base}/threads/${encodeURIComponent(threadId ?? "")}`),
  );
  expect(await readJson(inspect)).toMatchObject({ id: threadId });
  for (const resource of ["messages", "events", "state"] as const) {
    const response = await runtime.handleRequest(
      new Request(
        `${base}/threads/${encodeURIComponent(threadId ?? "")}/${resource}`,
      ),
    );
    expect(response.status, resource).toBe(200);
    expect(await readJson(response), resource).toHaveProperty(resource);
  }
  await runtime.dispose();
});

test("returns useful JSON errors for unknown routes scenarios and thread IDs", async () => {
  const runtime = createThreadsStateLabRuntime();
  for (const url of [
    "http://127.0.0.1/inspector-lab-runtime/not-a-scenario/info",
    "http://127.0.0.1/inspector-lab-runtime/pro-enabled-zero/not-a-route",
    "http://127.0.0.1/inspector-lab-runtime/pro-enabled-existing/threads/not-a-thread",
  ]) {
    const response = await runtime.handleRequest(new Request(url));
    expect(response.status, url).toBe(404);
    expect(await readJson(response), url).toHaveProperty("error");
  }
  await runtime.dispose();
});

test("serves the exact Runtime base error and video-failure CSP through Vite", async () => {
  const lab = await startViteLabServer();
  try {
    const response = await fetch(`${lab.origin}/inspector-lab-runtime`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Missing lab scenario." });
    const videoFailure = await fetch(`${lab.origin}/?scenario=video-error`);
    expect(videoFailure.status).toBe(200);
    expect(videoFailure.headers.get("content-security-policy")).toBe(
      "media-src 'none'",
    );
    const normal = await fetch(`${lab.origin}/?scenario=pro-enabled-zero`);
    expect(normal.status).toBe(200);
    expect(normal.headers.has("content-security-policy")).toBe(false);
  } finally {
    await lab.close();
  }
});

test("reads and resets one scenario request ledger without counting lab routes", async () => {
  const runtime = createThreadsStateLabRuntime();
  const base = "http://127.0.0.1/inspector-lab-runtime/pro-enabled-zero";
  await runtime.handleRequest(new Request(`${base}/info`));
  await runtime.handleRequest(
    new Request(`${base}/threads?agentId=threads-lab-agent`),
  );
  const first = await runtime.handleRequest(new Request(`${base}/request-log`));
  expect(await readJson(first)).toMatchObject({ counters: { list: 1 } });
  const reset = await runtime.handleRequest(
    new Request(`${base}/request-log/reset`, { method: "POST" }),
  );
  expect(await readJson(reset)).toEqual({
    counters: ZERO_COUNTERS,
    entries: [],
  });
  const second = await runtime.handleRequest(
    new Request(`${base}/request-log`),
  );
  expect(await readJson(second)).toEqual({
    counters: ZERO_COUNTERS,
    entries: [],
  });
  await runtime.dispose();
});

test("counts one real Phoenix join and reset closes its scenario socket", async () => {
  const lab = await startLabServer();
  try {
    const scenario = getThreadsStateScenario("pro-enabled-zero");
    const base = `${lab.origin}/inspector-lab-runtime/pro-enabled-zero`;
    const credentials = await fetch(`${base}/threads/subscribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(await readJson(credentials)).toEqual({
      joinToken: scenario.joinToken,
    });
    const beforeJoin = await fetch(`${base}/request-log`);
    expect(await readJson(beforeJoin)).toMatchObject({
      counters: { subscribe: 0 },
    });
    const socket = new WebSocket(
      `${lab.origin.replace("http:", "ws:")}/inspector-lab-runtime/pro-enabled-zero/realtime/websocket?join_token=${encodeURIComponent(scenario.joinToken)}&vsn=2.0.0`,
    );
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const reply = nextSocketMessage(socket);
    socket.send(
      JSON.stringify([
        "join-ref",
        "message-ref",
        `user_meta:${scenario.joinCode}`,
        "phx_join",
        {},
      ]),
    );
    expect(await reply).toEqual([
      "join-ref",
      "message-ref",
      `user_meta:${scenario.joinCode}`,
      "phx_reply",
      { status: "ok", response: {} },
    ]);
    const duplicateReply = nextSocketMessage(socket);
    socket.send(
      JSON.stringify([
        "join-ref-2",
        "message-ref-2",
        `user_meta:${scenario.joinCode}`,
        "phx_join",
        {},
      ]),
    );
    expect(await duplicateReply).toEqual([
      "join-ref-2",
      "message-ref-2",
      `user_meta:${scenario.joinCode}`,
      "phx_reply",
      { status: "ok", response: {} },
    ]);
    const heartbeatReply = nextSocketMessage(socket);
    socket.send(
      JSON.stringify([null, "heartbeat-ref", "phoenix", "heartbeat", {}]),
    );
    expect(await heartbeatReply).toEqual([
      null,
      "heartbeat-ref",
      "phoenix",
      "phx_reply",
      { status: "ok", response: {} },
    ]);
    const log = await fetch(`${base}/request-log`);
    expect(await readJson(log)).toMatchObject({ counters: { subscribe: 1 } });
    const socketClosed = new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
    });
    const reset = await fetch(`${base}/request-log/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(await readJson(reset)).toEqual({
      counters: ZERO_COUNTERS,
      entries: [],
    });
    await socketClosed;
    await vi.waitFor(() => {
      expect(lab.runtime.openSocketCount()).toBe(0);
    });
  } finally {
    await stopLabServer(lab);
  }
  expect(lab.runtime.openSocketCount()).toBe(0);
  expect(lab.server.listenerCount("upgrade")).toBe(
    lab.baselineUpgradeListeners,
  );
});

test("the Vite close hook disposes open sockets and upgrade listeners", async () => {
  const lab = await startViteLabServer();
  try {
    const scenario = getThreadsStateScenario("team-enabled-zero");
    const socket = new WebSocket(
      `${lab.origin.replace("http:", "ws:")}/inspector-lab-runtime/${scenario.key}/realtime/websocket?join_token=${encodeURIComponent(scenario.joinToken)}&vsn=2.0.0`,
    );
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const socketClosed = new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
    });
    await lab.close();
    await socketClosed;
    expect(lab.httpServer.listening).toBe(false);
  } finally {
    await lab.close();
  }
});

test("rejects wrong Phoenix tokens and topics without counting subscribe", async () => {
  const runtime = createThreadsStateLabRuntime();
  const server = createServer((request, response) => {
    void runtime.handleNodeRequest(request, response);
  });
  runtime.attachWebSocketServer(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP test server address.");
  }
  const scenario = getThreadsStateScenario("team-enabled-zero");
  const socketBase = `ws://127.0.0.1:${address.port}/inspector-lab-runtime/team-enabled-zero/realtime/websocket`;
  const wrongToken = new WebSocket(
    `${socketBase}?join_token=wrong-token&vsn=2.0.0`,
  );
  const rejectedStatus = await new Promise<number>((resolve, reject) => {
    wrongToken.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    wrongToken.once("open", () => reject(new Error("Wrong token connected.")));
    wrongToken.once("error", () => undefined);
  });
  expect(rejectedStatus).toBe(401);

  const wrongTopic = new WebSocket(
    `${socketBase}?join_token=${encodeURIComponent(scenario.joinToken)}&vsn=2.0.0`,
  );
  await new Promise<void>((resolve, reject) => {
    wrongTopic.once("open", resolve);
    wrongTopic.once("error", reject);
  });
  const closeCode = new Promise<number>((resolve) => {
    wrongTopic.once("close", resolve);
  });
  wrongTopic.send(
    JSON.stringify([
      "join-ref",
      "message-ref",
      "user_meta:wrong",
      "phx_join",
      {},
    ]),
  );
  expect(await closeCode).toBe(1008);

  const base = `http://127.0.0.1:${address.port}/inspector-lab-runtime/team-enabled-zero`;
  const log = await fetch(`${base}/request-log`);
  expect(await readJson(log)).toMatchObject({ counters: { subscribe: 0 } });
  await runtime.dispose();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("rejects realtime for disabled and absent capabilities without counting subscribe", async () => {
  const runtime = createThreadsStateLabRuntime();
  const server = createServer((request, response) => {
    void runtime.handleNodeRequest(request, response);
  });
  runtime.attachWebSocketServer(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected a TCP test server address.");
    }
    const statuses: number[] = [];
    for (const key of ["pro-disabled-zero", "capability-absent"] as const) {
      const scenario = getThreadsStateScenario(key);
      const socket = new WebSocket(
        `ws://127.0.0.1:${address.port}/inspector-lab-runtime/${key}/realtime/websocket?join_token=${encodeURIComponent(scenario.joinToken)}&vsn=2.0.0`,
      );
      const status = await new Promise<number>((resolve, reject) => {
        socket.once("unexpected-response", (_request, response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        socket.once("open", () => {
          const reply = nextSocketMessage(socket);
          socket.send(
            JSON.stringify([
              "join-ref",
              "message-ref",
              `user_meta:${scenario.joinCode}`,
              "phx_join",
              {},
            ]),
          );
          reply.then(() => {
            socket.terminate();
            resolve(101);
          }, reject);
        });
        socket.once("error", () => undefined);
      });
      statuses.push(status);
    }
    expect(statuses).toEqual([403, 403]);
    for (const key of ["pro-disabled-zero", "capability-absent"] as const) {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/inspector-lab-runtime/${key}/request-log`,
      );
      expect(await readJson(response), key).toEqual({
        counters: ZERO_COUNTERS,
        entries: [],
      });
    }
  } finally {
    await runtime.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("parses direct links and limits reset to the Inspector-owned keys", () => {
  expect(parseScenarioKey("team-enabled-existing")).toEqual({
    scenarioKey: "team-enabled-existing",
  });
  expect(parseScenarioKey("unknown-route")).toEqual({
    scenarioKey: "free-figma-148-of-200",
    rejectedKey: "unknown-route",
  });
  expect(parseScenarioKey(null)).toEqual({
    scenarioKey: "free-figma-148-of-200",
  });
  expect(
    canonicalScenarioUrl("http://127.0.0.1:5177", "free-figma-148-of-200"),
  ).toBe("http://127.0.0.1:5177/?scenario=free-figma-148-of-200&reset=1");
  expect(LAB_RESET_STORAGE_KEYS).toEqual([
    "cpk:inspector:state",
    "cpk:inspector:threads-example-tour:v1",
    "cpk:inspector:dismissed_until",
  ]);
});

test("executes exact storage reset copy and reduced-motion restoration", async () => {
  const removedKeys: string[] = [];
  const resetCookies: string[] = [];
  clearThreadsStateLabStorage(
    {
      removeItem(key) {
        removedKeys.push(key);
      },
    },
    {
      get cookie() {
        return resetCookies.at(-1) ?? "";
      },
      set cookie(value) {
        resetCookies.push(value);
      },
    },
  );
  expect(removedKeys).toEqual(LAB_RESET_STORAGE_KEYS);
  expect(resetCookies).toEqual([
    "cpk_inspector_dismissed_until=; Path=/; Max-Age=0; SameSite=Lax",
  ]);

  const copiedValues: string[] = [];
  const copied = await copyThreadsStateLabDirectLink(
    {
      async writeText(value) {
        copiedValues.push(value);
      },
    },
    "http://127.0.0.1:5177",
    "team-enabled-existing",
  );
  expect(copied).toBe(
    "http://127.0.0.1:5177/?scenario=team-enabled-existing&reset=1",
  );
  expect(copiedValues).toEqual([copied]);

  const originalDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "matchMedia",
  );
  const delegatedQueries: string[] = [];
  const delegate = (media: string): MediaQueryList => {
    delegatedQueries.push(media);
    return {
      matches: false,
      media,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    };
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: delegate,
  });
  try {
    const restore = installThreadsStateLabReducedMotion(window);
    expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(
      true,
    );
    expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(
      false,
    );
    expect(delegatedQueries).toEqual(["(prefers-color-scheme: dark)"]);
    restore();
    expect(window.matchMedia).toBe(delegate);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(window, "matchMedia", originalDescriptor);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
  }
});

test("builds a clean launcher-notification replay", () => {
  const localValues = new Map<string, string>([
    [
      "cpk:inspector:state",
      JSON.stringify({
        isOpen: true,
        dockMode: "docked-left",
        selectedMenu: "agents",
      }),
    ],
    ["cpk:inspector:announcement_read", "seen"],
    ["cpk:inspector:dismissed_until", "later"],
  ]);
  const localRemoved: string[] = [];
  const sessionRemoved: string[] = [];
  const expiredCookies: string[] = [];
  const cookieTarget = {
    get cookie() {
      return expiredCookies.at(-1) ?? "";
    },
    set cookie(value: string) {
      expiredCookies.push(value);
    },
  };

  clearThreadsStateLabNotificationState(
    {
      getItem: (key) => localValues.get(key) ?? null,
      setItem: (key, value) => localValues.set(key, value),
      removeItem: (key) => {
        localRemoved.push(key);
        localValues.delete(key);
      },
    },
    { removeItem: (key) => sessionRemoved.push(key) },
    cookieTarget,
  );

  expect(JSON.parse(localValues.get("cpk:inspector:state") ?? "null")).toEqual({
    isOpen: false,
    dockMode: "docked-left",
    selectedMenu: "agents",
  });
  expect(localRemoved).toEqual([
    "cpk:inspector:announcement_read",
    "cpk:inspector:dismissed_until",
  ]);
  expect(sessionRemoved).toEqual(["cpk:inspector:pulsed"]);
  expect(expiredCookies).toEqual([
    "cpk_inspector_announcements=; Path=/; Max-Age=0; SameSite=Lax",
    "cpk_inspector_dismissed_until=; Path=/; Max-Age=0; SameSite=Lax",
  ]);
  expect(
    notificationReplayUrl(
      "http://127.0.0.1:5177/?scenario=free-figma-148-of-200&reset=1",
    ),
  ).toBe(
    "http://127.0.0.1:5177/?scenario=free-figma-148-of-200&replay-notification=1",
  );
  expect(
    consumedNotificationReplayUrl(
      "http://127.0.0.1:5177/?scenario=free-figma-148-of-200&replay-notification=1",
    ),
  ).toBe("http://127.0.0.1:5177/?scenario=free-figma-148-of-200");
});

test("runs teardown before real select and reset control navigation", async () => {
  const events: string[] = [];
  const assigned: string[] = [];
  const select = document.createElement("select");
  select.value = "team-enabled-existing";
  const selectedOption = document.createElement("option");
  selectedOption.value = "team-enabled-existing";
  selectedOption.selected = true;
  select.append(selectedOption);
  const reset = document.createElement("button");
  const location = {
    origin: "http://127.0.0.1:5177",
    assign(url: string) {
      events.push("assign");
      assigned.push(url);
    },
  };
  const removeListeners = installThreadsStateLabNavigation(
    select,
    reset,
    "pro-enabled-zero",
    async (key) => {
      await navigateThreadsStateLabScenario(location, key, async () => {
        events.push("teardown");
      });
    },
    (error) => {
      throw error;
    },
  );
  try {
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(assigned).toHaveLength(1));
    reset.click();
    await vi.waitFor(() => expect(assigned).toHaveLength(2));
    expect(events).toEqual(["teardown", "assign", "teardown", "assign"]);
    expect(assigned).toEqual([
      "http://127.0.0.1:5177/?scenario=team-enabled-existing&reset=1",
      "http://127.0.0.1:5177/?scenario=pro-enabled-zero&reset=1",
    ]);
  } finally {
    removeListeners();
  }
});

test("drives the real Core, Inspector, stores, surfaces, and ledger for all 37 routes", async () => {
  const restoreNodeBridges = installNodeIntegrationBridges();
  const matchMediaDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "matchMedia",
  );
  try {
    const lab = await startLabServer();
    try {
      if (typeof window.matchMedia !== "function") {
        Object.defineProperty(window, "matchMedia", {
          configurable: true,
          writable: true,
          value: (media: string): MediaQueryList => ({
            matches: false,
            media,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => true,
          }),
        });
      }
      for (const key of ALL_SCENARIO_KEYS) {
        const scenario = getThreadsStateScenario(key);
        const runtimeUrl = runtimeUrlFor(lab.origin, key);
        const resetResponse = await fetch(`${runtimeUrl}/request-log/reset`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        expect(resetResponse.status, key).toBe(200);
        for (const storageKey of LAB_RESET_STORAGE_KEYS) {
          window.localStorage.removeItem(storageKey);
        }
        document.body.replaceChildren();

        const restoreReducedMotion =
          key === "reduced-motion"
            ? installThreadsStateLabReducedMotion(window)
            : null;
        const core = new CopilotKitCore({
          runtimeUrl,
          runtimeTransport: "rest",
          deferInitialConnection: true,
        });
        const inspector = document.createElement("cpk-web-inspector");
        inspector.setAttribute("auto-attach-core", "false");
        inspector.core = core;
        document.body.append(inspector);

        try {
          core.connect();
          await vi.waitFor(
            () => {
              expect(core.runtimeConnectionStatus, key).toBe(
                CopilotKitCoreRuntimeConnectionStatus.Connected,
              );
            },
            { timeout: 5_000, interval: 20 },
          );
          await flushInspector(inspector);

          const launcher =
            inspector.shadowRoot?.querySelector<HTMLButtonElement>(
              'button[aria-label^="Web Inspector"]',
            );
          expect(launcher, `${key}: launcher`).toBeDefined();
          // A live thread-list failure owns the launcher, so the first open
          // lands on Threads instead of Home. The list request is still in
          // flight at this point, and the signal only arms once it has been
          // refused — so wait for the launcher to say so rather than assume
          // the request already lost. Two microtask turns is not a wait.
          const landingLabel = key === "thread-list-error" ? "Threads" : "Home";
          if (landingLabel !== "Home") {
            await vi.waitFor(
              () => {
                expect(
                  launcher?.getAttribute("aria-label"),
                  `${key}: launcher signal`,
                ).toContain("thread loading error");
              },
              { timeout: 5_000, interval: 20 },
            );
          }
          launcher?.click();
          await flushInspector(inspector);
          const homeButton = inspectorButton(inspector, "Home");
          expect(homeButton, `${key}: Home nav`).toBeDefined();
          const landingButton =
            landingLabel === "Home"
              ? homeButton
              : inspectorButton(inspector, "Threads");
          expect(
            landingButton?.classList.contains("inspector-nav-control-active"),
            `${key}: ${landingLabel} default`,
          ).toBe(true);
          if (landingLabel !== "Home") {
            homeButton?.click();
            await flushInspector(inspector);
          }
          const identity = scenario.inspectorMetadata?.identity;
          if (identity) {
            await vi.waitFor(() => {
              expect(
                collectDeep(
                  inspector.shadowRoot!,
                  '[aria-label="Inspector account details"]',
                ),
                `${key}: account presence`,
              ).toHaveLength(1);
            });
            const homeText = inspectorText(inspector);
            expect(homeText, `${key}: organization`).toContain(
              identity.organizationName,
            );
            expect(homeText, `${key}: project`).toContain(identity.projectName);
          } else {
            expect(
              collectDeep(
                inspector.shadowRoot!,
                '[aria-label="Inspector account details"]',
              ),
              `${key}: account presence`,
            ).toHaveLength(0);
          }
          if (scenario.initialAgentEvents?.length) {
            seedThreadsStateLabAgentEvents(inspector, scenario);
            await flushInspector(inspector);
            expect(
              inspectorText(inspector),
              `${key}: error activity`,
            ).toContain("RUN_ERROR");
            expect(inspectorText(inspector), `${key}: health state`).toContain(
              "Needs attention",
            );
            // A failed run is an EVENT, and the launcher's signal is a STATE
            // indicator: an hour of iteration produces many failed runs, and a
            // signal that is usually on carries no information. System Health
            // reports it, above; nothing outside the panel does.
            expect(
              collectDeep(
                inspector.shadowRoot!,
                '.inspector-nav-signal-dot[data-cpk-signal-tone="error"]',
              ),
              `${key}: run error raises no error signal`,
            ).toHaveLength(0);
            expect(
              collectDeep(inspector.shadowRoot!, '[data-cpk-signal="error"]'),
              `${key}: run error raises no launcher error tone`,
            ).toHaveLength(0);
          }
          const threadsButton = inspectorButton(inspector, "Threads");
          expect(threadsButton, `${key}: Threads nav`).toBeDefined();
          threadsButton?.click();
          await flushInspector(inspector);
          expect(
            threadsButton?.classList.contains("inspector-nav-control-active"),
            `${key}: Threads selected`,
          ).toBe(true);

          const expectedStoreCount = scenario.capability === "enabled" ? 1 : 0;
          await vi.waitFor(
            () => {
              expect(Object.keys(core.getThreadStores()).length, key).toBe(
                expectedStoreCount,
              );
            },
            { timeout: 5_000, interval: 20 },
          );
          await vi.waitFor(
            async () => {
              const storeStates = Object.values(core.getThreadStores()).map(
                (store) => {
                  const state = store.getState();
                  return {
                    context: state.context,
                    error:
                      state.error instanceof Error
                        ? `${state.error.name}: ${state.error.message}`
                        : state.error,
                    isLoading: state.isLoading,
                  };
                },
              );
              expect(
                await requestCounters(lab.origin, scenario),
                `${key}: ${JSON.stringify(storeStates)}`,
              ).toEqual(scenario.expectedRequests);
            },
            { timeout: 5_000, interval: 20 },
          );
          await flushInspector(inspector);

          const root = inspector.shadowRoot;
          expect(root, key).not.toBeNull();
          if (!root) throw new Error(`${key}: missing Inspector Shadow Root.`);
          const text = inspectorText(inspector);
          const navigation = collectDeep(root, '[aria-label="Inspector"]');
          expect(navigation, `${key}: grouped nav`).toHaveLength(1);
          expect(text, `${key}: Threads nav`).toContain("Threads");
          expect(text, `${key}: Agent nav`).toContain("Agent");
          expect(text, `${key}: Learning nav`).toContain("Learning");
          expect(text, `${key}: Home nav`).toContain("Home");
          const overviewCopy = expectedOverviewCopy(scenario);
          if (overviewCopy) {
            expect(text, `${key}: overview heading`).toContain(
              overviewCopy.heading,
            );
            expect(text, `${key}: overview description`).toContain(
              overviewCopy.description,
            );
          }
          const setupPrompts = collectDeep(
            root,
            '[data-inspector-feature-setup-prompt="threads"]',
          );
          const expectsSetup = scenario.capability !== "enabled";
          expect(setupPrompts, `${key}: setup prompt presence`).toHaveLength(
            expectsSetup ? 1 : 0,
          );
          if (setupPrompts.length === 1) {
            expect(
              setupPrompts[0]?.textContent?.trim(),
              `${key}: setup prompt label`,
            ).toBe("Copy setup prompt");
          }

          const usage = scenario.inspectorMetadata?.usage;
          const threadCount = collectDeep(
            root,
            "[data-inspector-thread-count]",
          );
          expect(threadCount, `${key}: usage presence`).toHaveLength(
            usage ? 1 : 0,
          );
          if (usage) {
            const used = String(usage.used);
            expect(text, `${key}: used count`).toContain(used);
            const progress = collectDeep(root, "progress");
            expect(progress, `${key}: finite progress`).toHaveLength(
              usage.limit.kind === "finite" ? 1 : 0,
            );
            if (usage.limit.kind === "finite") {
              const limit = String(usage.limit.value);
              const numerator =
                usage.used > usage.limit.value ? `${limit}+` : used;
              expect(text, `${key}: finite usage copy`).toContain(
                `${numerator} / ${limit} Threads`,
              );
              expect(
                progress[0]?.getAttribute("data-inspector-thread-capacity"),
                `${key}: capacity state`,
              ).toBe(expectedCapacityState(scenario));
            }
            if (
              Object.hasOwn(usage, "expiringSoonCount") &&
              typeof usage.expiringSoonCount === "number"
            ) {
              expect(text, `${key}: expiry copy`).toContain(
                `${usage.expiringSoonCount.toLocaleString("en-US")} Expiring Soon`,
              );
            }
          }

          const actionLabel = expectedActionLabel(scenario);
          const actions = collectDeep(
            root,
            "[data-inspector-action-placement]",
          );
          expect(actions, `${key}: action presence`).toHaveLength(
            actionLabel ? 1 : 0,
          );
          if (actionLabel) {
            expect(text, `${key}: action label`).toContain(actionLabel);
          }

          const main = root.querySelector("#cpk-main-scroll");
          if (!main) {
            throw new Error(`${key}: Inspector main content was not rendered`);
          }
          const generalIntelligenceOnboarding = collectDeep(
            main,
            'a[href^="https://intelligence.copilotkit.ai/?ref="]',
          );
          const selfHostedIntelligenceOnboarding = collectDeep(
            main,
            'a[href^="https://docs.copilotkit.ai/premium/self-hosting"]',
          );
          const showsEnabledZeroOverview =
            scenario.capability === "enabled" && scenario.data === "zero";
          const showsSelfHostedOnboarding =
            showsEnabledZeroOverview && scenario.deployment === "self_hosted";
          expect(
            generalIntelligenceOnboarding,
            `${key}: general Intelligence onboarding`,
          ).toHaveLength(
            showsEnabledZeroOverview && !showsSelfHostedOnboarding ? 1 : 0,
          );
          expect(
            selfHostedIntelligenceOnboarding,
            `${key}: self-hosted Intelligence onboarding`,
          ).toHaveLength(showsSelfHostedOnboarding ? 1 : 0);
          if (showsSelfHostedOnboarding) {
            expect(text, `${key}: self-hosted onboarding label`).toContain(
              "Explore self-hosted Intelligence",
            );
          } else if (showsEnabledZeroOverview) {
            expect(text, `${key}: general onboarding label`).toContain(
              "Sign up for Intelligence",
            );
          }

          const examples = exampleButtons(inspector);
          if (key === "video-error") {
            const video = collectDeep(root, ".cpk-threads-overview-video")[0];
            expect(video, `${key}: demo video`).toBeInstanceOf(
              HTMLVideoElement,
            );
            video?.dispatchEvent(new Event("error"));
            await flushInspector(inspector);
            expect(inspectorText(inspector), `${key}: fallback copy`).toContain(
              "The demo video is unavailable. Use the example threads to explore Messages, AG-UI Events, and State.",
            );
            expect(
              exampleButtons(inspector),
              `${key}: fallback examples`,
            ).toHaveLength(3);
          }
          if (key === "reduced-motion") {
            await vi.waitFor(
              () => {
                const video = collectDeep(
                  root,
                  ".cpk-threads-overview-video",
                )[0];
                expect(video, `${key}: reduced-motion video`).toBeInstanceOf(
                  HTMLVideoElement,
                );
                expect(
                  video instanceof HTMLVideoElement ? video.autoplay : true,
                  `${key}: reduced-motion autoplay`,
                ).toBe(false);
                const control = inspectorButton(inspector, "Play demo");
                expect(control, `${key}: reduced-motion control`).toBeDefined();
                expect(control?.getAttribute("aria-pressed")).toBe("true");
              },
              { timeout: 5_000, interval: 20 },
            );
          }
          if (scenario.data === "error") {
            expect(examples, `${key}: list-error examples`).toHaveLength(0);
          } else if (
            scenario.capability !== "enabled" ||
            scenario.data === "zero"
          ) {
            expect(examples, `${key}: local examples`).toHaveLength(3);
            for (let index = 0; index < 3; index += 1) {
              const current = exampleButtons(inspector)[index];
              expect(current, `${key}: example ${index + 1}`).toBeDefined();
              current?.click();
              await flushInspector(inspector);
              if (key === "video-error" && index === 0) {
                const detailTabs = collectDeep(root, '[role="tab"]')
                  .map((element) =>
                    element.textContent?.replace(/\s+/g, " ").trim(),
                  )
                  .filter((label) => label !== undefined);
                expect(detailTabs, `${key}: fallback detail tabs`).toEqual([
                  "Messages",
                  "AG-UI Events",
                  "State",
                ]);
                expect(
                  collectDeep(
                    root,
                    '[role="dialog"][aria-label="Example thread tour"]',
                  ),
                  `${key}: fallback tour`,
                ).toHaveLength(1);
              }
            }
            expect(await requestCounters(lab.origin, scenario), key).toEqual(
              scenario.expectedRequests,
            );
          } else {
            expect(examples, `${key}: no local examples`).toHaveLength(0);
            for (const thread of scenario.threads) {
              expect(
                inspectorText(inspector),
                `${key}: ${thread.id}`,
              ).toContain(thread.name);
            }
            if (key === "free-figma-148-of-200") {
              const renderedNames = collectDeep(root, ".cpk-tl__name").map(
                (element) => element.textContent?.trim(),
              );
              expect(renderedNames, `${key}: rendered sidebar order`).toEqual(
                EXPECTED_RECORDING_THREADS.map(
                  (_, index, threads) =>
                    threads[threads.length - index - 1]?.name,
                ),
              );
            }
            expect(
              inspectorText(inspector),
              `${key}: newest selection`,
            ).toContain(scenario.expectedNewestThreadId);
            const selectedRows = collectDeep(
              root,
              '.cpk-tl__item[aria-current="true"]',
            );
            const newestThread = scenario.threads.find(
              (thread) => thread.id === scenario.expectedNewestThreadId,
            );
            expect(selectedRows, `${key}: selected sidebar row`).toHaveLength(
              1,
            );
            expect(
              selectedRows[0]?.textContent,
              `${key}: selected newest name`,
            ).toContain(newestThread?.name);
            for (const [tab, kind] of [
              ["Messages", null],
              ["AG-UI Events", "events"],
              ["State", "state"],
            ] as const) {
              const tabButton = collectDeep(root, '[role="tab"]')
                .filter((element) => element instanceof HTMLButtonElement)
                .find(
                  (button) =>
                    button.textContent?.replace(/\s+/g, " ").trim() === tab,
                );
              expect(tabButton, `${key}: ${tab} tab`).toBeDefined();
              tabButton?.click();
              await flushInspector(inspector);
              expect(
                tabButton?.getAttribute("aria-selected"),
                `${key}: ${tab} active`,
              ).toBe("true");
              if (kind === null) continue;
              await vi.waitFor(
                async () => {
                  expect(
                    (await requestCounters(lab.origin, scenario))[kind],
                    `${key}: ${tab} request`,
                  ).toBe(1);
                },
                { timeout: 5_000, interval: 20 },
              );
            }
            await vi.waitFor(
              async () => {
                expect(
                  await requestCounters(lab.origin, scenario),
                  key,
                ).toEqual({
                  list: 1,
                  subscribe: 1,
                  inspect: 0,
                  messages: 1,
                  events: 1,
                  state: 1,
                });
              },
              { timeout: 5_000, interval: 20 },
            );
          }
        } finally {
          stopThreadsStateLabClient(core, inspector);
          restoreReducedMotion?.();
          expect(
            Object.keys(core.getThreadStores()),
            `${key}: store cleanup`,
          ).toEqual([]);
          expect(inspector.isConnected, `${key}: Inspector cleanup`).toBe(
            false,
          );
          document.body.replaceChildren();
        }
      }
    } finally {
      await stopLabServer(lab);
    }
  } finally {
    restoreNodeBridges();
    if (matchMediaDescriptor) {
      Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
  }
}, 60_000);

test("freezes media error reduced-motion and telemetry opt-out configuration", () => {
  expect(getThreadsStateScenario("video-error").media).toBe("video_error");
  expect(getThreadsStateScenario("reduced-motion").media).toBe(
    "reduced_motion",
  );
  expect(
    getThreadsStateScenario("telemetry-disabled").runtimeInfo.telemetryDisabled,
  ).toBe(true);
  expect(THREAD_REQUEST_KINDS).toEqual([
    "list",
    "subscribe",
    "inspect",
    "messages",
    "events",
    "state",
  ]);
});
