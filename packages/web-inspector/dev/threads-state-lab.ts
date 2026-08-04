import type { CopilotKitCore } from "@copilotkit/core";
import type { InspectorMetadataV1, RuntimeInfo } from "@copilotkit/shared";
import type { WebInspectorElement } from "@copilotkit/web-inspector";

export const CORE_SCENARIO_KEYS = [
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

export const EDGE_SCENARIO_KEYS = [
  "free-figma-148-of-200",
  "free-overage-241-of-200",
  "oss-no-metadata-enabled-zero",
  "capability-absent",
  "unknown-limit",
  "missing-expiry",
  "malformed-expiry",
  "usage-only",
  "action-only",
  "license-none",
  "license-expired",
  "thread-list-error",
  "video-error",
  "reduced-motion",
  "telemetry-disabled",
] as const;

export const ALL_SCENARIO_KEYS = [
  ...CORE_SCENARIO_KEYS,
  ...EDGE_SCENARIO_KEYS,
] as const;

export type ScenarioKey = (typeof ALL_SCENARIO_KEYS)[number];

export const THREAD_REQUEST_KINDS = [
  "list",
  "subscribe",
  "inspect",
  "messages",
  "events",
  "state",
] as const;

export type ThreadRequestKind = (typeof THREAD_REQUEST_KINDS)[number];

export type ThreadRequestCounters = Readonly<Record<ThreadRequestKind, number>>;

export type ThreadFixture = Readonly<{
  id: string;
  organizationId: string;
  agentId: string;
  createdById: string;
  name: string;
  archived: false;
  createdAt: string;
  updatedAt: string;
}>;

export type ThreadDetailsFixture = Readonly<{
  messages: readonly Readonly<Record<string, unknown>>[];
  events: readonly Readonly<Record<string, unknown>>[];
  state: Readonly<Record<string, unknown>>;
}>;

export interface ThreadsStateScenario {
  readonly key: ScenarioKey;
  readonly label: string;
  readonly description: string;
  readonly deployment: "managed" | "self_hosted" | "oss";
  readonly plan: "free" | "pro" | "team" | "enterprise" | "oss";
  readonly capability: "enabled" | "disabled" | "absent";
  readonly data: "zero" | "existing" | "error";
  readonly agentId: string;
  readonly runtimeInfo: Readonly<RuntimeInfo>;
  readonly inspectorMetadata?: Readonly<InspectorMetadataV1>;
  readonly inspectorMetadataBody?: unknown;
  readonly threads: readonly ThreadFixture[];
  readonly details: Readonly<Record<string, ThreadDetailsFixture>>;
  readonly expectedRequests: ThreadRequestCounters;
  readonly expectedNewestThreadId?: string;
  readonly joinCode: string;
  readonly joinToken: string;
  readonly listError?: Readonly<{ status: number; message: string }>;
  readonly media: "normal" | "video_error" | "reduced_motion";
}

export const LAB_RESET_STORAGE_KEYS = [
  "cpk:inspector:state",
  "cpk:inspector:threads-example-tour:v1",
] as const;

export const DEFAULT_SCENARIO_KEY: ScenarioKey = "free-figma-148-of-200";

const AGENT_ID = "threads-lab-agent";
const ORGANIZATION_ID = "threads-lab-organization";
const USER_ID = "threads-lab-user";
const MANAGE_PLAN_URL = "https://cloud.copilotkit.ai/settings/billing";
const ENABLE_INTELLIGENCE_URL =
  "https://cloud.copilotkit.ai/intelligence/enable";
const RENEW_URL = "https://cloud.copilotkit.ai/settings/license";

const ZERO_COUNTERS: ThreadRequestCounters = {
  list: 0,
  subscribe: 0,
  inspect: 0,
  messages: 0,
  events: 0,
  state: 0,
};

const ENABLED_ENDPOINTS = {
  list: true,
  inspect: true,
  mutations: true,
  realtimeMetadata: true,
} as const;

const DISABLED_ENDPOINTS = {
  list: false,
  inspect: false,
  mutations: false,
  realtimeMetadata: false,
} as const;

/** Recursively freezes a fixture graph without changing its values. */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(Reflect.get(value, key));
  }
  return Object.freeze(value);
}

function runtimeInfo(
  key: ScenarioKey,
  options: Readonly<{
    capability: ThreadsStateScenario["capability"];
    licenseStatus?: RuntimeInfo["licenseStatus"];
    metadata?: boolean;
    telemetryDisabled?: boolean;
  }>,
): RuntimeInfo {
  return {
    version: `threads-state-lab:${key}`,
    agents: {
      [AGENT_ID]: {
        name: AGENT_ID,
        className: "HttpAgent",
        description: "Deterministic local Inspector Threads lab agent",
      },
    },
    audioFileTranscriptionEnabled: false,
    mode: "intelligence",
    intelligence: {
      wsUrl: `ws://127.0.0.1:5177/inspector-lab-runtime/${key}/realtime`,
    },
    ...(options.capability === "absent"
      ? {}
      : {
          threadEndpoints:
            options.capability === "enabled"
              ? ENABLED_ENDPOINTS
              : DISABLED_ENDPOINTS,
        }),
    ...(options.metadata === false ? {} : { inspectorMetadata: true }),
    suggestions: false,
    a2uiEnabled: false,
    openGenerativeUIEnabled: false,
    licenseStatus: options.licenseStatus ?? "valid",
    telemetryDisabled: options.telemetryDisabled ?? false,
  };
}

function threadFixtures(prefix: string): readonly ThreadFixture[] {
  return [
    {
      id: `${prefix}-thread-earlier`,
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      createdById: USER_ID,
      name: "Plan onboarding follow-up",
      archived: false,
      createdAt: "2026-07-28T09:00:00.000Z",
      updatedAt: "2026-07-28T09:24:00.000Z",
    },
    {
      id: `${prefix}-thread-newest`,
      organizationId: ORGANIZATION_ID,
      agentId: AGENT_ID,
      createdById: USER_ID,
      name: "Inspector launch review",
      archived: false,
      createdAt: "2026-08-02T15:00:00.000Z",
      updatedAt: "2026-08-03T16:42:00.000Z",
    },
  ];
}

function threadDetails(
  threads: readonly ThreadFixture[],
): Readonly<Record<string, ThreadDetailsFixture>> {
  return Object.fromEntries(
    threads.map((thread, index) => [
      thread.id,
      {
        messages: [
          {
            id: `${thread.id}-user-message`,
            role: "user",
            content: "Show the saved Inspector thread details.",
          },
          {
            id: `${thread.id}-assistant-message`,
            role: "assistant",
            content: "This response came from the local scenario lab.",
          },
        ],
        events: [
          {
            type: "RUN_STARTED",
            timestamp: `2026-08-03T16:4${index}:00.000Z`,
            payload: { runId: `${thread.id}-run` },
          },
          {
            type: "TEXT_MESSAGE_CONTENT",
            timestamp: `2026-08-03T16:4${index}:01.000Z`,
            payload: {
              messageId: `${thread.id}-assistant-message`,
              delta: "Local scenario detail event",
            },
          },
          {
            type: "RUN_FINISHED",
            timestamp: `2026-08-03T16:4${index}:02.000Z`,
            payload: { runId: `${thread.id}-run` },
          },
        ],
        state: {
          source: "threads-state-lab",
          threadId: thread.id,
          reviewStatus: index === 1 ? "ready" : "draft",
        },
      },
    ]),
  );
}

function expectedRequests(
  capability: ThreadsStateScenario["capability"],
  data: ThreadsStateScenario["data"],
): ThreadRequestCounters {
  if (capability !== "enabled") return { ...ZERO_COUNTERS };
  if (data === "error") return { ...ZERO_COUNTERS, list: 1 };
  if (data === "zero") {
    return { ...ZERO_COUNTERS, list: 1, subscribe: 1 };
  }
  return { ...ZERO_COUNTERS, list: 1, subscribe: 1, events: 1 };
}

function metadata(
  plan: ThreadsStateScenario["plan"],
  options: Readonly<{
    used: number;
    limit: NonNullable<InspectorMetadataV1["usage"]>["limit"];
    expiringSoonCount?: number;
    deployment?: ThreadsStateScenario["deployment"];
    action?: NonNullable<InspectorMetadataV1["action"]>;
  }>,
): InspectorMetadataV1 {
  const label =
    plan === "free"
      ? "Free"
      : plan === "pro"
        ? "Pro"
        : plan === "enterprise"
          ? "Enterprise"
          : "Team";
  return {
    schemaVersion: 1,
    identity: {
      organizationName:
        options.deployment === "self_hosted"
          ? "Local CopilotKit"
          : "Northstar Labs",
      projectName: "Inspector launch",
    },
    plan: { code: plan, label },
    license: { state: "valid" },
    ...(options.action ? { action: options.action } : {}),
    usage: {
      used: options.used,
      limit: options.limit,
      ...(options.expiringSoonCount === undefined
        ? {}
        : { expiringSoonCount: options.expiringSoonCount }),
    },
  };
}

function buildScenario(
  input: Omit<
    ThreadsStateScenario,
    | "agentId"
    | "details"
    | "expectedRequests"
    | "expectedNewestThreadId"
    | "joinCode"
    | "joinToken"
  >,
): ThreadsStateScenario {
  const hasThreads = input.threads.length > 0;
  return {
    ...input,
    agentId: AGENT_ID,
    details: threadDetails(input.threads),
    expectedRequests: expectedRequests(input.capability, input.data),
    ...(hasThreads ? { expectedNewestThreadId: input.threads[1]?.id } : {}),
    joinCode: `threads-lab-${input.key}`,
    joinToken: `threads-lab-token-${input.key}`,
  };
}

function buildCoreScenario(key: (typeof CORE_SCENARIO_KEYS)[number]) {
  const selfHosted = key.startsWith("self-hosted-");
  const plan: ThreadsStateScenario["plan"] = selfHosted
    ? "team"
    : key.startsWith("pro-")
      ? "pro"
      : key.startsWith("team-")
        ? "team"
        : "enterprise";
  const capability: ThreadsStateScenario["capability"] = key.includes(
    "-enabled-",
  )
    ? "enabled"
    : "disabled";
  const data: ThreadsStateScenario["data"] = key.endsWith("-existing")
    ? "existing"
    : "zero";
  const threads = data === "existing" ? threadFixtures(key) : [];
  const limit =
    plan === "enterprise"
      ? ({ kind: "unlimited" } as const)
      : ({
          kind: "finite",
          value: plan === "pro" ? 5_000 : 25_000,
        } as const);
  const used = plan === "pro" ? 122 : plan === "enterprise" ? 1_204 : 604;
  const action =
    !selfHosted && (plan === "pro" || plan === "team")
      ? ({ kind: "manage_plan", url: MANAGE_PLAN_URL } as const)
      : undefined;
  const inspectorMetadata = metadata(plan, {
    used,
    limit,
    expiringSoonCount: plan === "enterprise" ? 0 : plan === "pro" ? 7 : 18,
    deployment: selfHosted ? "self_hosted" : "managed",
    ...(action ? { action } : {}),
  });

  return buildScenario({
    key,
    label: `${selfHosted ? "Self-hosted Team" : inspectorMetadata.plan?.label} · ${capability} · ${data}`,
    description: `${data === "existing" ? "Two saved threads" : "No saved threads"}; Thread API ${capability}.`,
    deployment: selfHosted ? "self_hosted" : "managed",
    plan,
    capability,
    data,
    runtimeInfo: runtimeInfo(key, { capability }),
    inspectorMetadata,
    inspectorMetadataBody: inspectorMetadata,
    threads,
    media: "normal",
  });
}

function edgeScenario(
  key: (typeof EDGE_SCENARIO_KEYS)[number],
): ThreadsStateScenario {
  const existing = threadFixtures(key);
  const free148 = metadata("free", {
    used: 148,
    limit: { kind: "finite", value: 200 },
    expiringSoonCount: 37,
    action: { kind: "manage_plan", url: MANAGE_PLAN_URL },
  });
  const defaultExisting = metadata("free", {
    used: 36,
    limit: { kind: "finite", value: 200 },
    expiringSoonCount: 4,
    action: { kind: "manage_plan", url: MANAGE_PLAN_URL },
  });
  const base = {
    key,
    deployment: "managed" as const,
    plan: "free" as const,
    capability: "enabled" as const,
    data: "existing" as const,
    runtimeInfo: runtimeInfo(key, { capability: "enabled" }),
    inspectorMetadata: defaultExisting,
    inspectorMetadataBody: defaultExisting,
    threads: existing,
    media: "normal" as const,
  };

  switch (key) {
    case "free-figma-148-of-200":
      return buildScenario({
        ...base,
        label: "Free · Figma 148 / 200",
        description: "Approved 148 / 200 usage with 37 expiring soon.",
        inspectorMetadata: free148,
        inspectorMetadataBody: free148,
      });
    case "free-overage-241-of-200": {
      const overage = metadata("free", {
        used: 241,
        limit: { kind: "finite", value: 200 },
        expiringSoonCount: 0,
        action: { kind: "manage_plan", url: MANAGE_PLAN_URL },
      });
      return buildScenario({
        ...base,
        label: "Free · over limit",
        description: "Raw 241 / 200 renders as 200+ / 200 at 100%.",
        inspectorMetadata: overage,
        inspectorMetadataBody: overage,
      });
    }
    case "oss-no-metadata-enabled-zero":
      return buildScenario({
        ...base,
        label: "OSS · no metadata · enabled · zero",
        description: "Explicit Threads capability with no metadata body.",
        deployment: "oss",
        plan: "oss",
        data: "zero",
        runtimeInfo: runtimeInfo(key, {
          capability: "enabled",
          metadata: false,
          licenseStatus: undefined,
        }),
        inspectorMetadata: undefined,
        inspectorMetadataBody: undefined,
        threads: [],
      });
    case "capability-absent":
      return buildScenario({
        ...base,
        label: "Capability absent",
        description: "Seeded rows stay unreachable without threadEndpoints.",
        capability: "absent",
        runtimeInfo: runtimeInfo(key, { capability: "absent" }),
      });
    case "unknown-limit": {
      const value = metadata("free", {
        used: 36,
        limit: { kind: "unknown" },
        expiringSoonCount: 4,
        action: { kind: "manage_plan", url: MANAGE_PLAN_URL },
      });
      return buildScenario({
        ...base,
        label: "Unknown limit",
        description: "Usage count without a progress denominator.",
        inspectorMetadata: value,
        inspectorMetadataBody: value,
      });
    }
    case "missing-expiry": {
      const value = metadata("free", {
        used: 36,
        limit: { kind: "finite", value: 200 },
        action: { kind: "manage_plan", url: MANAGE_PLAN_URL },
      });
      return buildScenario({
        ...base,
        label: "Missing expiry",
        description: "Valid usage omits the expiry leaf.",
        inspectorMetadata: value,
        inspectorMetadataBody: value,
      });
    }
    case "malformed-expiry": {
      const value = metadata("free", {
        used: 36,
        limit: { kind: "finite", value: 200 },
        action: { kind: "manage_plan", url: MANAGE_PLAN_URL },
      });
      const body = {
        ...value,
        usage: { ...value.usage, expiringSoonCount: "invalid" },
      };
      return buildScenario({
        ...base,
        label: "Malformed expiry",
        description: "Untrusted string expiry is ignored without losing usage.",
        inspectorMetadata: value,
        inspectorMetadataBody: body,
      });
    }
    case "usage-only": {
      const value: InspectorMetadataV1 = {
        schemaVersion: 1,
        usage: {
          used: 36,
          limit: { kind: "finite", value: 200 },
          expiringSoonCount: 4,
        },
      };
      return buildScenario({
        ...base,
        label: "Usage only",
        description:
          "Usage renders without identity, plan, license, or action.",
        inspectorMetadata: value,
        inspectorMetadataBody: value,
      });
    }
    case "action-only": {
      const value: InspectorMetadataV1 = {
        schemaVersion: 1,
        license: { state: "valid" },
        action: { kind: "manage_plan", url: MANAGE_PLAN_URL },
      };
      return buildScenario({
        ...base,
        label: "Action only",
        description: "A valid plan action does not invent usage.",
        data: "zero",
        inspectorMetadata: value,
        inspectorMetadataBody: value,
        threads: [],
      });
    }
    case "license-none": {
      const value: InspectorMetadataV1 = {
        schemaVersion: 1,
        license: { state: "none" },
        action: {
          kind: "enable_intelligence",
          url: ENABLE_INTELLIGENCE_URL,
        },
      };
      return buildScenario({
        ...base,
        label: "License not enabled",
        description: "Locked Threads with a matching enable action.",
        capability: "disabled",
        runtimeInfo: runtimeInfo(key, {
          capability: "disabled",
          licenseStatus: "none",
        }),
        inspectorMetadata: value,
        inspectorMetadataBody: value,
      });
    }
    case "license-expired": {
      const value: InspectorMetadataV1 = {
        schemaVersion: 1,
        license: { state: "expired" },
        action: { kind: "renew", url: RENEW_URL },
      };
      return buildScenario({
        ...base,
        label: "License expired",
        description: "Locked Threads with a matching renewal action.",
        capability: "disabled",
        runtimeInfo: runtimeInfo(key, {
          capability: "disabled",
          licenseStatus: "expired",
        }),
        inspectorMetadata: value,
        inspectorMetadataBody: value,
      });
    }
    case "thread-list-error":
      return buildScenario({
        ...base,
        label: "Thread list error",
        description: "The enabled list route fails without showing examples.",
        data: "error",
        threads: [],
        listError: {
          status: 503,
          message: "Thread list unavailable in this lab scenario.",
        },
      });
    case "video-error":
      return buildScenario({
        ...base,
        label: "Video error",
        description: "CSP blocks media while examples and tour stay usable.",
        data: "zero",
        threads: [],
        media: "video_error",
      });
    case "reduced-motion":
      return buildScenario({
        ...base,
        label: "Reduced motion",
        description: "The demo starts paused for reduced-motion users.",
        data: "zero",
        threads: [],
        media: "reduced_motion",
      });
    case "telemetry-disabled":
      return buildScenario({
        ...base,
        label: "Telemetry disabled",
        description: "The full Inspector works with telemetry opted out.",
        runtimeInfo: runtimeInfo(key, {
          capability: "enabled",
          telemetryDisabled: true,
        }),
      });
  }
}

const scenarios = [
  ...CORE_SCENARIO_KEYS.map(buildCoreScenario),
  ...EDGE_SCENARIO_KEYS.map(edgeScenario),
];

export const THREADS_STATE_SCENARIOS = deepFreeze(
  Object.fromEntries(
    scenarios.map((scenario) => [scenario.key, scenario]),
  ) as Record<ScenarioKey, ThreadsStateScenario>,
);

deepFreeze(CORE_SCENARIO_KEYS);
deepFreeze(EDGE_SCENARIO_KEYS);
deepFreeze(ALL_SCENARIO_KEYS);
deepFreeze(THREAD_REQUEST_KINDS);
deepFreeze(LAB_RESET_STORAGE_KEYS);

/** Returns one immutable fixture or throws for programmer input. */
export function getThreadsStateScenario(
  key: ScenarioKey,
): ThreadsStateScenario {
  return THREADS_STATE_SCENARIOS[key];
}

/** Parses an untrusted route key and reports an explicit fallback. */
export function parseScenarioKey(
  value: string | null,
): Readonly<{ scenarioKey: ScenarioKey; rejectedKey?: string }> {
  if (value === null || value.length === 0) {
    return { scenarioKey: DEFAULT_SCENARIO_KEY };
  }
  if ((ALL_SCENARIO_KEYS as readonly string[]).includes(value)) {
    return { scenarioKey: value as ScenarioKey };
  }
  return { scenarioKey: DEFAULT_SCENARIO_KEY, rejectedKey: value };
}

/** Builds the canonical loopback Runtime URL for a scenario. */
export function runtimeUrlFor(origin: string, key: ScenarioKey): string {
  return `${origin.replace(/\/+$/, "")}/inspector-lab-runtime/${key}`;
}

/** Builds the canonical recordable direct link. */
export function canonicalScenarioUrl(origin: string, key: ScenarioKey): string {
  const url = new URL("/", origin);
  url.searchParams.set("scenario", key);
  url.searchParams.set("reset", "1");
  return url.href;
}

/** Runs full fixture teardown before assigning one canonical scenario link. */
export async function navigateThreadsStateLabScenario(
  location: Readonly<{
    origin: string;
    assign(url: string): void;
  }>,
  key: ScenarioKey,
  teardown: () => Promise<void>,
): Promise<string> {
  await teardown();
  const directLink = canonicalScenarioUrl(location.origin, key);
  location.assign(directLink);
  return directLink;
}

/** Wires scenario selection and reset controls to one guarded navigation path. */
export function installThreadsStateLabNavigation(
  scenarioSelect: HTMLSelectElement,
  resetButton: HTMLButtonElement,
  currentScenarioKey: ScenarioKey,
  navigate: (key: ScenarioKey) => Promise<void>,
  reportError: (error: unknown) => void,
): () => void {
  const handleScenarioChange = (): void => {
    const next = parseScenarioKey(scenarioSelect.value).scenarioKey;
    navigate(next).catch(reportError);
  };
  const handleReset = (): void => {
    navigate(currentScenarioKey).catch(reportError);
  };
  scenarioSelect.addEventListener("change", handleScenarioChange);
  resetButton.addEventListener("click", handleReset);
  return () => {
    scenarioSelect.removeEventListener("change", handleScenarioChange);
    resetButton.removeEventListener("click", handleReset);
  };
}

/** Removes only the two Inspector-owned keys reset by the scenario lab. */
export function clearThreadsStateLabStorage(
  storage: Pick<Storage, "removeItem">,
): void {
  for (const key of LAB_RESET_STORAGE_KEYS) storage.removeItem(key);
}

/** Copies and returns one canonical scenario URL without changing page state. */
export async function copyThreadsStateLabDirectLink(
  clipboard: Pick<Clipboard, "writeText">,
  origin: string,
  key: ScenarioKey,
): Promise<string> {
  const directLink = canonicalScenarioUrl(origin, key);
  await clipboard.writeText(directLink);
  return directLink;
}

/** Installs the exact reduced-motion response and returns its full restoration. */
export function installThreadsStateLabReducedMotion(
  targetWindow: Window,
): () => void {
  const ownDescriptor = Object.getOwnPropertyDescriptor(
    targetWindow,
    "matchMedia",
  );
  const originalMatchMedia = targetWindow.matchMedia.bind(targetWindow);
  const exactQuery = "(prefers-reduced-motion: reduce)";
  Object.defineProperty(targetWindow, "matchMedia", {
    configurable: true,
    writable: true,
    value: (mediaQuery: string): MediaQueryList => {
      if (mediaQuery !== exactQuery) return originalMatchMedia(mediaQuery);
      return {
        matches: true,
        media: mediaQuery,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
      };
    },
  });
  return () => {
    if (ownDescriptor) {
      Object.defineProperty(targetWindow, "matchMedia", ownDescriptor);
    } else {
      Reflect.deleteProperty(targetWindow, "matchMedia");
    }
  };
}

/** Stops and unregisters every store owned by one lab Core and Inspector pair. */
export function stopThreadsStateLabClient(
  core: CopilotKitCore | null,
  inspector: WebInspectorElement | null,
): void {
  const priorStores = core ? Object.entries(core.getThreadStores()) : [];
  inspector?.remove();
  if (inspector) inspector.core = null;
  for (const [agentId, store] of priorStores) {
    if (core?.getThreadStore(agentId) !== store) continue;
    store.stop();
    core.unregisterThreadStore(agentId);
  }
  core?.setRuntimeUrl(undefined);
}
