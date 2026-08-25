import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectThreadsIsLoading,
} from "@copilotkit/core";
import type {
  InspectorMetadataV1,
  ɵThread,
  ɵThreadStore,
} from "@copilotkit/core";
import type {
  RuntimeInfo,
  ThreadEndpointRuntimeInfo,
} from "@copilotkit/shared";
import { expect, test, vi } from "vitest";

import { WebInspectorElement } from "../index.js";
import { TELEMETRY_EVENTS, TELEMETRY_INGEST_URL } from "../lib/telemetry.js";

const RUNTIME_URL = "https://runtime.example.test/api/copilotkit";
const TELEMETRY_DISCLOSURE_KEY = "cpk:inspector:telemetry:disclosure_shown";
const TELEMETRY_DISTINCT_ID_KEY = "cpk:inspector:telemetry:distinct_id";
const INSPECTOR_STATE_KEY = "cpk:inspector:state";

const ENABLED_ENDPOINTS = {
  list: true,
  inspect: true,
  mutations: false,
  realtimeMetadata: false,
} satisfies ThreadEndpointRuntimeInfo;

const LOCKED_ENDPOINTS = {
  ...ENABLED_ENDPOINTS,
  list: false,
} satisfies ThreadEndpointRuntimeInfo;

type InspectorLeafKey =
  | "threads"
  | "whats-new"
  | "ag-ui-events"
  | "event-snippets"
  | "agents"
  | "frontend-tools"
  | "capabilities"
  | "agent-context"
  | "memories";

type TelemetryProperties = Readonly<{
  [key: string]: unknown;
}>;

type TelemetryBody = Readonly<{
  event: string;
  properties: TelemetryProperties;
}>;

type SetupOptions = Readonly<{
  endpoints?: ThreadEndpointRuntimeInfo;
  initialMenu?: InspectorLeafKey;
  listErrorAgents?: readonly string[];
  metadataResponses?: readonly InspectorMetadataV1[];
  rejectTelemetry?: boolean;
  telemetryDisabled?: boolean;
  threadsByAgent?: Readonly<{
    [agentId: string]: readonly ɵThread[];
  }>;
  withFeatureLeaves?: boolean;
}>;

type TelemetryHarness = Readonly<{
  core: CopilotKitCore;
  inspector: WebInspectorElement;
  telemetryBodies: TelemetryBody[];
  clickControl: (label: string) => Promise<void>;
  flush: () => Promise<void>;
  open: () => Promise<void>;
  requestUrls: string[];
  selectContext: (label: string) => Promise<void>;
  selectGroup: (key: string) => Promise<void>;
  selectLeaf: (key: InspectorLeafKey) => Promise<void>;
  selectThread: (name: string) => Promise<void>;
  telemetryFor: (event: string) => TelemetryBody[];
  teardown: () => Promise<void>;
}>;

type UsageCase = Readonly<{
  name: string;
  usage?: NonNullable<InspectorMetadataV1["usage"]>;
  usageBucket:
    | "absent"
    | "empty"
    | "within_limit"
    | "at_or_over_limit"
    | "unlimited"
    | "unknown_limit";
  expiryBucket: "unavailable" | "zero" | "positive";
}>;

type PlacementCase = Readonly<{
  name: string;
  endpoints: ThreadEndpointRuntimeInfo;
  actionKind: "manage_plan" | "renew";
  licenseState: "valid" | "expired";
  renderedPlacement: "threads-footer" | "locked";
  telemetryPlacement: "threads_footer" | "threads_locked";
}>;

function isProperties(value: unknown): value is TelemetryProperties {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTelemetryBody(value: unknown): value is TelemetryBody {
  return (
    isProperties(value) &&
    typeof value.event === "string" &&
    isProperties(value.properties)
  );
}

function parseTelemetryBody(raw: string): TelemetryBody {
  const parsed: unknown = JSON.parse(raw);
  if (!isTelemetryBody(parsed)) {
    throw new Error("Telemetry request body had an unexpected shape");
  }
  return parsed;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function runtimeInfo(
  agentIds: readonly string[],
  endpoints: ThreadEndpointRuntimeInfo,
  metadata: InspectorMetadataV1 | undefined,
  telemetryDisabled: boolean,
): RuntimeInfo {
  const agents: RuntimeInfo["agents"] = {};
  for (const agentId of agentIds) {
    agents[agentId] = {
      name: agentId,
      className: "HttpAgent",
      description: `Telemetry test agent ${agentId}`,
    };
  }
  return {
    version: "1.0.0",
    agents,
    audioFileTranscriptionEnabled: false,
    mode: "sse",
    threadEndpoints: endpoints,
    inspectorMetadata: metadata !== undefined,
    licenseStatus: metadata?.license?.state ?? "valid",
    telemetryDisabled,
  };
}

function realThread(agentId: string, id = `real-thread-${agentId}`): ɵThread {
  return {
    id,
    organizationId: "organization-exact-sentinel",
    agentId,
    createdById: "user-exact-sentinel",
    name: `Real row ${agentId}`,
    archived: false,
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:01:00.000Z",
  };
}

function metadataWithUsage(
  usage?: NonNullable<InspectorMetadataV1["usage"]>,
): InspectorMetadataV1 {
  return {
    schemaVersion: 1,
    plan: { code: "enterprise-exact", label: "Enterprise Exact" },
    license: { state: "valid" },
    ...(usage === undefined ? {} : { usage }),
  };
}

function metadataWithAction(case_: PlacementCase): InspectorMetadataV1 {
  return {
    schemaVersion: 1,
    identity: {
      organizationName: "Organization Exact Sentinel",
      projectName: "Project Exact Sentinel",
    },
    plan: { code: "plan-exact-sentinel", label: "Plan Exact Sentinel" },
    license: { state: case_.licenseState },
    action: {
      kind: case_.actionKind,
      url: `https://cloud.copilotkit.ai/exact/${case_.actionKind}`,
    },
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 37,
    },
  };
}

function planRevision(index: number): InspectorMetadataV1 {
  return {
    schemaVersion: 1,
    plan: { code: `plan-${index}`, label: `Plan ${index}` },
    license: { state: "valid" },
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(
    input instanceof Request ? input.url : String(input),
    window.location.href,
  );
}

function threadRoute(
  url: URL,
): "list" | "messages" | "events" | "state" | "inspect" | null {
  if (/\/threads\/[^/]+\/messages$/.test(url.pathname)) return "messages";
  if (/\/threads\/[^/]+\/events$/.test(url.pathname)) return "events";
  if (/\/threads\/[^/]+\/state$/.test(url.pathname)) return "state";
  if (/\/threads\/[^/]+$/.test(url.pathname)) return "inspect";
  if (url.pathname.endsWith("/threads")) return "list";
  return null;
}

function requireElement<T>(element: T | null | undefined, message: string): T {
  if (!element) throw new Error(message);
  return element;
}

function renderedThreadListText(inspector: WebInspectorElement): string {
  const list = requireElement(
    inspector.shadowRoot?.querySelector<HTMLElement>("cpk-thread-list"),
    "Thread list was not rendered",
  );
  return list.shadowRoot?.textContent ?? "";
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

async function flushInspector(inspector: WebInspectorElement): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await Promise.resolve();
    await inspector.updateComplete;
  }
}

function stubReducedMotion(): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(
      (query: string): MediaQueryList => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      }),
    ),
  );
}

function expectExactProperties(
  body: TelemetryBody,
  expected: TelemetryProperties,
): void {
  const enrichment = {
    distinct_id: expect.any(String),
    inspector_distinct_id: expect.any(String),
    package_name: "@copilotkit/web-inspector",
    package_version: expect.any(String),
  };
  expect(body.properties).toMatchObject({ ...expected, ...enrichment });
  expect(Object.keys(body.properties).sort()).toEqual(
    [...Object.keys(expected), ...Object.keys(enrichment)].sort(),
  );
  expect(body.properties.inspector_distinct_id).toBe(
    body.properties.distinct_id,
  );
}

function threadCommon(
  overrides: TelemetryProperties = {},
): TelemetryProperties {
  return {
    intelligence_status: "intelligence_enabled",
    thread_service_status: "available",
    license_status: "valid",
    runtime_mode: "sse",
    runtime_url_type: "remote",
    telemetry_disabled: false,
    has_threads: false,
    usage_bucket: "absent",
    expiry_bucket: "unavailable",
    group_key: "workbench",
    leaf_key: "threads",
    ...overrides,
  };
}

async function setup(options: SetupOptions = {}): Promise<TelemetryHarness> {
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();
  if (!options.telemetryDisabled) {
    window.localStorage.setItem(TELEMETRY_DISCLOSURE_KEY, "true");
  }
  window.localStorage.setItem(
    INSPECTOR_STATE_KEY,
    JSON.stringify({
      selectedMenu: options.initialMenu ?? "threads",
      hasOpenedInspector: true,
    }),
  );
  stubReducedMotion();

  const endpoints = options.endpoints ?? ENABLED_ENDPOINTS;
  const threadsByAgent = options.threadsByAgent ?? { alpha: [] };
  const agentIds = Object.keys(threadsByAgent);
  const metadataResponses = [...(options.metadataResponses ?? [])];
  const latestMetadata = metadataResponses[0];
  const listErrorAgents = new Set(options.listErrorAgents ?? []);
  const listRequestCounts = new Map<string, number>();
  const requestUrls: string[] = [];
  const telemetryBodies: TelemetryBody[] = [];
  let metadataRequestIndex = 0;

  const fetchMock = Object.assign(
    vi.fn(
      async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = requestUrl(input);
        requestUrls.push(url.href);
        if (url.href === TELEMETRY_INGEST_URL) {
          if (typeof init?.body !== "string") {
            throw new Error("Telemetry POST did not serialize a string body");
          }
          telemetryBodies.push(parseTelemetryBody(init.body));
          if (options.rejectTelemetry) {
            throw new Error("telemetry unavailable");
          }
          return new Response(null, { status: 204 });
        }
        if (url.href === "https://cdn.copilotkit.ai/announcements.json") {
          return new Response(null, { status: 404 });
        }
        if (url.pathname.endsWith("/info")) {
          return jsonResponse(
            runtimeInfo(
              agentIds,
              endpoints,
              latestMetadata,
              options.telemetryDisabled ?? false,
            ),
          );
        }
        if (url.pathname.endsWith("/inspector-metadata")) {
          const response =
            metadataResponses[
              Math.min(metadataRequestIndex, metadataResponses.length - 1)
            ];
          metadataRequestIndex += 1;
          if (response === undefined) {
            throw new Error("Unexpected Inspector metadata request");
          }
          return jsonResponse(response);
        }
        if (url.pathname.endsWith("/memories")) {
          return jsonResponse({ memories: [] });
        }

        const route = threadRoute(url);
        if (route === "list") {
          const agentId = url.searchParams.get("agentId");
          if (!agentId) throw new Error("Thread list omitted agentId");
          const requestCount = (listRequestCounts.get(agentId) ?? 0) + 1;
          listRequestCounts.set(agentId, requestCount);
          if (requestCount > 1 && listErrorAgents.has(agentId)) {
            throw new Error(`list failed for ${agentId}`);
          }
          return jsonResponse({
            threads: threadsByAgent[agentId] ?? [],
            joinCode: null,
            nextCursor: null,
          });
        }
        if (route === "messages") return jsonResponse({ messages: [] });
        if (route === "events") return jsonResponse({ events: [] });
        if (route === "state") return jsonResponse({ state: {} });
        if (route === "inspect") return jsonResponse({ thread: null });
        throw new Error(`Unexpected telemetry test request: ${url.href}`);
      },
    ),
    globalThis.fetch,
  );
  vi.stubGlobal("fetch", fetchMock);

  const core = new CopilotKitCore({
    runtimeUrl: RUNTIME_URL,
    runtimeTransport: "rest",
    deferInitialConnection: true,
    tools: options.withFeatureLeaves
      ? [
          {
            name: "lookup",
            description: "Look up a support record.",
            handler: async () => ({ found: true }),
          },
        ]
      : [],
  });
  if (options.withFeatureLeaves) {
    core.setCatalogComponents([
      {
        name: "SupportCard",
        description: "Render a support record.",
        schema: { type: "object" },
      },
    ]);
  }
  core.connect();
  await waitFor(
    () =>
      core.runtimeConnectionStatus ===
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    "the Core handshake",
  );
  if (latestMetadata !== undefined) {
    await waitFor(
      () => core.inspectorMetadata !== undefined,
      "trusted Inspector metadata",
    );
  }

  const stores: ɵThreadStore[] = [];
  for (const agentId of agentIds) {
    const store = ɵcreateThreadStore({ fetch: fetchMock });
    stores.push(store);
    store.start();
    store.setContext({ runtimeUrl: RUNTIME_URL, headers: {}, agentId });
    await waitFor(
      () => !ɵselectThreadsIsLoading(store.getState()),
      `the ${agentId} Thread list`,
    );
    await waitFor(
      () =>
        ɵselectThreads(store.getState()).length ===
        (threadsByAgent[agentId]?.length ?? 0),
      `the ${agentId} Thread rows`,
    );
    if (listErrorAgents.has(agentId)) {
      store.refresh();
      await waitFor(
        () => ɵselectThreadsError(store.getState()) !== null,
        `the ${agentId} Thread list error`,
      );
    }
    core.registerThreadStore(agentId, store);
  }

  const inspector = new WebInspectorElement();
  inspector.core = core;
  document.body.appendChild(inspector);
  await flushInspector(inspector);

  const root = requireElement(
    inspector.shadowRoot,
    "Web Inspector shadow root was not rendered",
  );
  const clickSelector = async (
    selector: string,
    message: string,
  ): Promise<void> => {
    const control = requireElement(
      root.querySelector<HTMLButtonElement>(selector),
      message,
    );
    control.click();
    await flushInspector(inspector);
  };
  const threadRows = (): HTMLButtonElement[] => {
    const list = requireElement(
      root.querySelector<HTMLElement>("cpk-thread-list"),
      "Thread list was not rendered",
    );
    return Array.from(
      list.shadowRoot?.querySelectorAll<HTMLButtonElement>(".cpk-tl__item") ??
        [],
    );
  };

  return {
    core,
    inspector,
    telemetryBodies,
    requestUrls,
    flush: () => flushInspector(inspector),
    open: () =>
      clickSelector(
        'button[aria-label="Web Inspector"]',
        "Web Inspector opener was not rendered",
      ),
    selectGroup: (key) =>
      clickSelector(
        `button[data-inspector-group="${key}"]`,
        `Inspector group was not rendered: ${key}`,
      ),
    selectLeaf: (key) =>
      clickSelector(
        `button[data-inspector-menu-key="${key}"]`,
        `Inspector leaf was not rendered: ${key}`,
      ),
    async selectContext(label) {
      const trigger = requireElement(
        root.querySelector<HTMLButtonElement>(
          '[data-context-dropdown-root="true"] > button',
        ),
        "Context dropdown was not rendered",
      );
      trigger.dispatchEvent(
        new Event("pointerdown", { bubbles: true, cancelable: true }),
      );
      await flushInspector(inspector);
      const option = Array.from(
        root.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === label);
      requireElement(
        option,
        `Context option was not rendered: ${label}`,
      ).click();
      await flushInspector(inspector);
    },
    async selectThread(name) {
      const row = threadRows().find((candidate) =>
        candidate.textContent?.includes(name),
      );
      requireElement(row, `Thread row was not rendered: ${name}`).click();
      await flushInspector(inspector);
    },
    async clickControl(label) {
      const control = Array.from(
        root.querySelectorAll<HTMLElement>("button, a"),
      ).find((candidate) => candidate.textContent?.trim() === label);
      requireElement(control, `Control was not rendered: ${label}`).click();
      await flushInspector(inspector);
    },
    telemetryFor: (event) =>
      telemetryBodies.filter((body) => body.event === event),
    async teardown() {
      inspector.remove();
      for (const [index, store] of stores.entries()) {
        core.unregisterThreadStore(agentIds[index] ?? "");
        store.stop();
      }
      core.setRuntimeUrl(undefined);
      await waitFor(
        () =>
          core.runtimeConnectionStatus ===
          CopilotKitCoreRuntimeConnectionStatus.Disconnected,
        "the Core disconnect",
      );
      await Promise.resolve();
      document.body.replaceChildren();
      document.getElementById("cpk-inspector-brand-fonts")?.remove();
      window.localStorage.clear();
      window.sessionStorage.clear();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}

const renderedViewCases = [
  {
    name: "locked seeded rows",
    endpoints: LOCKED_ENDPOINTS,
    rows: [realThread("alpha", "locked-exact-row")],
    event: TELEMETRY_EVENTS.threadsLockedViewed,
    intelligenceStatus: "intelligence_not_enabled",
    threadServiceStatus: "unavailable",
    hasThreads: false,
  },
  {
    name: "enabled zero rows",
    endpoints: ENABLED_ENDPOINTS,
    rows: [],
    event: TELEMETRY_EVENTS.threadsEmptyEnabledViewed,
    intelligenceStatus: "intelligence_enabled",
    threadServiceStatus: "available",
    hasThreads: false,
  },
  {
    name: "enabled real rows",
    endpoints: ENABLED_ENDPOINTS,
    rows: [realThread("alpha")],
    event: TELEMETRY_EVENTS.threadsEnabledViewed,
    intelligenceStatus: "intelligence_enabled",
    threadServiceStatus: "available",
    hasThreads: true,
  },
] satisfies ReadonlyArray<{
  name: string;
  endpoints: ThreadEndpointRuntimeInfo;
  rows: readonly ɵThread[];
  event: string;
  intelligenceStatus: string;
  threadServiceStatus: string;
  hasThreads: boolean;
}>;

test.each(renderedViewCases)(
  "$name emits a serialized coarse Thread view",
  async (case_) => {
    const harness = await setup({
      endpoints: case_.endpoints,
      threadsByAgent: { alpha: case_.rows },
    });
    try {
      await harness.open();

      const bodies = harness.telemetryFor(case_.event);
      expect(bodies).toHaveLength(1);
      expectExactProperties(
        requireElement(bodies[0], `${case_.event} was not captured`),
        threadCommon({
          intelligence_status: case_.intelligenceStatus,
          thread_service_status: case_.threadServiceStatus,
          has_threads: case_.hasThreads,
        }),
      );

      const text = harness.inspector.shadowRoot?.textContent ?? "";
      if (case_.name === "locked seeded rows") {
        expect(text).not.toContain("Real row alpha");
      }
      if (case_.name === "enabled zero rows") {
        const examples = harness.telemetryFor(
          TELEMETRY_EVENTS.threadsExampleViewed,
        );
        expect(examples).toHaveLength(3);
        expect(
          examples.every((body) => body.properties.has_threads === false),
        ).toBe(true);
      }
      if (case_.name === "enabled real rows") {
        expect(renderedThreadListText(harness.inspector)).toContain(
          "Real row alpha",
        );
      }
    } finally {
      await harness.teardown();
    }
  },
);

test("a visible Runtime row whose ID matches a local example still reports has_threads true", async () => {
  const harness = await setup({
    threadsByAgent: {
      alpha: [realThread("alpha", "example-realtime-sync")],
    },
  });
  try {
    await harness.open();

    const enabled = requireElement(
      harness.telemetryFor(TELEMETRY_EVENTS.threadsEnabledViewed)[0],
      "Visible collision-row enabled event was not captured",
    );
    expectExactProperties(enabled, threadCommon({ has_threads: true }));
    expect(renderedThreadListText(harness.inspector)).toContain(
      "Real row alpha",
    );
    expect(harness.telemetryFor(TELEMETRY_EVENTS.threadsExampleViewed)).toEqual(
      [],
    );
  } finally {
    await harness.teardown();
  }
});

test("a retained row hidden by a list error reports has_threads false", async () => {
  const harness = await setup({
    initialMenu: "ag-ui-events",
    listErrorAgents: ["alpha"],
    threadsByAgent: { alpha: [realThread("alpha", "error-hidden-row")] },
  });
  try {
    await harness.open();
    await harness.selectLeaf("threads");

    const tab = harness.telemetryFor(TELEMETRY_EVENTS.threadsTabClicked);
    expect(tab).toHaveLength(1);
    expectExactProperties(
      requireElement(tab[0], "Threads tab telemetry was not captured"),
      threadCommon({ has_threads: false }),
    );
    expect(
      harness.inspector.shadowRoot?.querySelector('[role="alert"]')
        ?.textContent ?? "",
    ).toContain("list failed for alpha");
    expect(harness.telemetryFor(TELEMETRY_EVENTS.threadsEnabledViewed)).toEqual(
      [],
    );
    expect(
      harness.telemetryFor(TELEMETRY_EVENTS.threadsEmptyEnabledViewed),
    ).toEqual([]);
  } finally {
    await harness.teardown();
  }
});

const usageCases = [
  {
    name: "missing usage",
    usageBucket: "absent",
    expiryBucket: "unavailable",
  },
  {
    name: "zero usage and zero expiry",
    usage: {
      used: 0,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 0,
    },
    usageBucket: "empty",
    expiryBucket: "zero",
  },
  {
    name: "finite below limit and positive expiry",
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 37,
    },
    usageBucket: "within_limit",
    expiryBucket: "positive",
  },
  {
    name: "finite warning threshold stays in the coarse within-limit bucket",
    usage: { used: 180, limit: { kind: "finite", value: 200 } },
    usageBucket: "within_limit",
    expiryBucket: "unavailable",
  },
  {
    name: "finite exact limit",
    usage: { used: 200, limit: { kind: "finite", value: 200 } },
    usageBucket: "at_or_over_limit",
    expiryBucket: "unavailable",
  },
  {
    name: "finite over limit",
    usage: {
      used: 241,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 0,
    },
    usageBucket: "at_or_over_limit",
    expiryBucket: "zero",
  },
  {
    name: "unlimited usage",
    usage: {
      used: 241,
      limit: { kind: "unlimited" },
      expiringSoonCount: 37,
    },
    usageBucket: "unlimited",
    expiryBucket: "positive",
  },
  {
    name: "unknown limit",
    usage: { used: 241, limit: { kind: "unknown" } },
    usageBucket: "unknown_limit",
    expiryBucket: "unavailable",
  },
] satisfies readonly UsageCase[];

test.each(usageCases)(
  "$name maps to closed serialized metadata buckets",
  async (case_) => {
    const harness = await setup({
      initialMenu: "ag-ui-events",
      metadataResponses: [metadataWithUsage(case_.usage)],
    });
    try {
      await harness.open();

      const planBodies = harness
        .telemetryFor(TELEMETRY_EVENTS.metadataModuleViewed)
        .filter((body) => body.properties.module === "plan");
      expect(planBodies).toHaveLength(1);
      expectExactProperties(
        requireElement(
          planBodies[0],
          "Plan metadata telemetry was not captured",
        ),
        {
          module: "plan",
          license_bucket: "valid",
          usage_bucket: case_.usageBucket,
          expiry_bucket: case_.expiryBucket,
          group_key: "inspect",
          leaf_key: "ag-ui-events",
        },
      );
      expect(JSON.stringify(planBodies[0]?.properties)).not.toContain(
        "enterprise-exact",
      );
    } finally {
      await harness.teardown();
    }
  },
);

const placementCases = [
  {
    name: "footer",
    endpoints: ENABLED_ENDPOINTS,
    actionKind: "manage_plan",
    licenseState: "valid",
    renderedPlacement: "threads-footer",
    telemetryPlacement: "threads_footer",
  },
  {
    name: "locked body",
    endpoints: LOCKED_ENDPOINTS,
    actionKind: "renew",
    licenseState: "expired",
    renderedPlacement: "locked",
    telemetryPlacement: "threads_locked",
  },
] satisfies readonly PlacementCase[];

test.each(placementCases)(
  "$name metadata actions serialize their coarse placement",
  async (case_) => {
    const harness = await setup({
      endpoints: case_.endpoints,
      metadataResponses: [metadataWithAction(case_)],
      threadsByAgent: { alpha: [] },
    });
    try {
      await harness.open();

      const root = requireElement(
        harness.inspector.shadowRoot,
        "Web Inspector shadow root was not rendered",
      );
      const action = requireElement(
        root.querySelector<HTMLAnchorElement>(
          `[data-inspector-action-placement="${case_.renderedPlacement}"]`,
        ),
        `${case_.name} action was not rendered`,
      );
      const viewed = harness
        .telemetryFor(TELEMETRY_EVENTS.metadataModuleViewed)
        .filter((body) => body.properties.module === "action");
      expect(viewed).toHaveLength(1);
      expectExactProperties(
        requireElement(viewed[0], "Action impression was not captured"),
        {
          module: "action",
          action_kind: case_.actionKind,
          license_bucket: case_.licenseState,
          usage_bucket: "within_limit",
          expiry_bucket: "positive",
          group_key: "workbench",
          leaf_key: "threads",
          action_placement: case_.telemetryPlacement,
        },
      );

      action.dispatchEvent(new Event("click"));
      await harness.flush();

      const clicked = harness.telemetryFor(
        TELEMETRY_EVENTS.metadataActionClicked,
      );
      expect(clicked).toHaveLength(1);
      expectExactProperties(
        requireElement(clicked[0], "Action click was not captured"),
        {
          module: "action",
          action_kind: case_.actionKind,
          license_bucket: case_.licenseState,
          usage_bucket: "within_limit",
          expiry_bucket: "positive",
          group_key: "workbench",
          leaf_key: "threads",
          action_placement: case_.telemetryPlacement,
        },
      );
      expect(JSON.stringify([...viewed, ...clicked])).not.toMatch(
        /Organization Exact|Project Exact|plan-exact|cloud\.copilotkit\.ai/,
      );
    } finally {
      await harness.teardown();
    }
  },
);

test("all examples and the complete tour serialize only closed kinds and step pairs", async () => {
  const harness = await setup();
  try {
    await harness.open();

    const viewed = harness.telemetryFor(TELEMETRY_EVENTS.threadsExampleViewed);
    expect(viewed.map((body) => body.properties.example_kind)).toEqual([
      "realtime_sync",
      "manage_history",
      "inspect_runs",
    ]);
    for (const body of viewed) {
      expectExactProperties(
        body,
        threadCommon({ example_kind: body.properties.example_kind }),
      );
    }

    const root = requireElement(
      harness.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const list = requireElement(
      root.querySelector<HTMLElement>("cpk-thread-list"),
      "Thread list was not rendered",
    );
    const requestCountBeforeUnknown = harness.telemetryBodies.length;
    list.dispatchEvent(
      new CustomEvent<string>("threadSelected", {
        detail: "unknown-example-exact-id",
        bubbles: true,
        composed: true,
      }),
    );
    await harness.flush();
    expect(harness.telemetryBodies).toHaveLength(requestCountBeforeUnknown);
    expect(
      harness.telemetryFor(TELEMETRY_EVENTS.threadsExampleSelected),
    ).toEqual([]);
    expect(
      harness.telemetryFor(TELEMETRY_EVENTS.threadsExampleTourStarted),
    ).toEqual([]);

    await harness.selectThread("Realtime thread sync");
    await harness.clickControl("Next");
    await harness.clickControl("Next");
    await harness.clickControl("Done");
    await harness.selectThread("Manage saved conversations");
    await harness.selectThread("Inspect durable run history");

    const selected = harness.telemetryFor(
      TELEMETRY_EVENTS.threadsExampleSelected,
    );
    expect(selected.map((body) => body.properties.example_kind)).toEqual([
      "realtime_sync",
      "manage_history",
      "inspect_runs",
    ]);
    for (const body of selected) {
      expectExactProperties(
        body,
        threadCommon({ example_kind: body.properties.example_kind }),
      );
    }

    const started = requireElement(
      harness.telemetryFor(TELEMETRY_EVENTS.threadsExampleTourStarted)[0],
      "Tour start was not captured",
    );
    expectExactProperties(
      started,
      threadCommon({
        example_kind: "realtime_sync",
        tour_step: 1,
        tour_tab: "timeline",
      }),
    );
    const steps = harness
      .telemetryFor(TELEMETRY_EVENTS.threadsExampleTourStepViewed)
      .filter((body) => body.properties.example_kind === "realtime_sync");
    expect(
      steps.map((body) => [
        body.properties.tour_step,
        body.properties.tour_tab,
      ]),
    ).toEqual([
      [1, "timeline"],
      [2, "raw-events"],
      [3, "state"],
    ]);
    for (const body of steps) {
      expectExactProperties(
        body,
        threadCommon({
          example_kind: "realtime_sync",
          tour_step: body.properties.tour_step,
          tour_tab: body.properties.tour_tab,
        }),
      );
    }
    const completed = requireElement(
      harness.telemetryFor(TELEMETRY_EVENTS.threadsExampleTourCompleted)[0],
      "Tour completion was not captured",
    );
    expectExactProperties(
      completed,
      threadCommon({
        example_kind: "realtime_sync",
        tour_step: 3,
        tour_tab: "state",
        dismiss_method: "done",
      }),
    );

    await harness.clickControl("Show tour");
    await harness.clickControl("Skip");

    const reopened = requireElement(
      harness.telemetryFor(TELEMETRY_EVENTS.threadsExampleTourReopened)[0],
      "Tour reopen was not captured",
    );
    expectExactProperties(
      reopened,
      threadCommon({
        example_kind: "inspect_runs",
        tour_step: 1,
        tour_tab: "timeline",
      }),
    );
    const dismissed = requireElement(
      harness.telemetryFor(TELEMETRY_EVENTS.threadsExampleTourDismissed)[0],
      "Tour dismissal was not captured",
    );
    expectExactProperties(
      dismissed,
      threadCommon({
        example_kind: "inspect_runs",
        tour_step: 1,
        tour_tab: "timeline",
        dismiss_method: "skip",
      }),
    );
    expect(
      JSON.stringify(
        harness.telemetryBodies.filter((body) =>
          body.event.startsWith("oss.inspector.threads_example_"),
        ),
      ),
    ).not.toMatch(
      /example-realtime-sync|example-manage-history|example-inspect-runs|unknown-example-exact-id/,
    );
  } finally {
    await harness.teardown();
  }
});

test("has_threads follows only real rows visible in the active Agent context", async () => {
  const harness = await setup({
    initialMenu: "ag-ui-events",
    threadsByAgent: {
      alpha: [],
      beta: [realThread("beta")],
    },
  });
  try {
    await harness.open();
    await harness.selectContext("alpha");
    await harness.selectLeaf("threads");

    const hiddenRowTab = requireElement(
      harness.telemetryFor(TELEMETRY_EVENTS.threadsTabClicked)[0],
      "Hidden-row Threads tab event was not captured",
    );
    expectExactProperties(hiddenRowTab, threadCommon({ has_threads: false }));
    const examples = harness.telemetryFor(
      TELEMETRY_EVENTS.threadsExampleViewed,
    );
    expect(examples).toHaveLength(3);
    expect(
      examples.every((body) => body.properties.has_threads === false),
    ).toBe(true);

    await harness.selectContext("beta");

    const enabled = requireElement(
      harness.telemetryFor(TELEMETRY_EVENTS.threadsEnabledViewed)[0],
      "Visible-row enabled event was not captured",
    );
    expectExactProperties(enabled, threadCommon({ has_threads: true }));
    expect(renderedThreadListText(harness.inspector)).toContain(
      "Real row beta",
    );

    await harness.selectLeaf("agents");
    await harness.selectLeaf("threads");

    const tabBodies = harness.telemetryFor(TELEMETRY_EVENTS.threadsTabClicked);
    expect(tabBodies).toHaveLength(2);
    expectExactProperties(
      requireElement(
        tabBodies[1],
        "Visible-row Threads tab event was not captured",
      ),
      threadCommon({ has_threads: true }),
    );
  } finally {
    await harness.teardown();
  }
});

test("metadata telemetry uses every stable legacy leaf key", async () => {
  const revisions = Array.from({ length: 9 }, (_, index) =>
    planRevision(index),
  );
  const harness = await setup({
    metadataResponses: revisions,
    withFeatureLeaves: true,
  });
  try {
    await harness.open();

    const pairs: ReadonlyArray<
      Readonly<{
        group: "home" | "workbench" | "inspect";
        leaf: InspectorLeafKey;
      }>
    > = [
      { group: "home", leaf: "whats-new" },
      { group: "workbench", leaf: "threads" },
      { group: "inspect", leaf: "ag-ui-events" },
      { group: "inspect", leaf: "event-snippets" },
      { group: "inspect", leaf: "agents" },
      { group: "inspect", leaf: "frontend-tools" },
      { group: "inspect", leaf: "capabilities" },
      { group: "inspect", leaf: "agent-context" },
      { group: "workbench", leaf: "memories" },
    ];

    for (const [index, pair] of pairs.entries()) {
      await harness.selectGroup(pair.group);
      await harness.selectLeaf(pair.leaf);
      if (index > 0) {
        await harness.core.refreshInspectorMetadata();
        await waitFor(
          () => harness.core.inspectorMetadata?.plan?.label === `Plan ${index}`,
          `Plan ${index}`,
        );
        await harness.flush();
      }
      const planBodies = harness
        .telemetryFor(TELEMETRY_EVENTS.metadataModuleViewed)
        .filter((body) => body.properties.module === "plan");
      const body = requireElement(
        planBodies.at(-1),
        `Plan telemetry was not captured for ${pair.group}/${pair.leaf}`,
      );
      expectExactProperties(body, {
        module: "plan",
        license_bucket: "valid",
        usage_bucket: "absent",
        expiry_bucket: "unavailable",
        group_key: pair.group,
        leaf_key: pair.leaf,
      });
    }
  } finally {
    await harness.teardown();
  }
});

test("Settings overlay keeps Learning memories keys for changed metadata", async () => {
  const harness = await setup({
    initialMenu: "memories",
    metadataResponses: [planRevision(0), planRevision(1)],
  });
  try {
    await harness.open();
    const settings = requireElement(
      harness.inspector.shadowRoot?.querySelector<HTMLButtonElement>(
        'button[aria-label="Settings"]',
      ),
      "Settings was not rendered",
    );
    settings.click();
    await harness.flush();
    await harness.core.refreshInspectorMetadata();
    await waitFor(
      () => harness.core.inspectorMetadata?.plan?.label === "Plan 1",
      "changed metadata under Settings",
    );
    await harness.flush();

    const planBodies = harness
      .telemetryFor(TELEMETRY_EVENTS.metadataModuleViewed)
      .filter((body) => body.properties.module === "plan");
    expect(planBodies).toHaveLength(2);
    expectExactProperties(
      requireElement(planBodies[1], "Settings metadata event was not captured"),
      {
        module: "plan",
        license_bucket: "valid",
        usage_bucket: "absent",
        expiry_bucket: "unavailable",
        group_key: "workbench",
        leaf_key: "memories",
      },
    );
    expect(harness.inspector.shadowRoot?.textContent ?? "").toContain(
      "Settings",
    );
    expect(JSON.stringify(planBodies)).not.toMatch(/Settings|Learning|Memory/);
  } finally {
    await harness.teardown();
  }
});

test("runtime telemetry opt-out stops every rendered Thread telemetry side effect", async () => {
  const disclosureLog = vi.spyOn(console, "info").mockImplementation(() => {});
  const harness = await setup({
    endpoints: LOCKED_ENDPOINTS,
    initialMenu: "ag-ui-events",
    telemetryDisabled: true,
    threadsByAgent: {
      alpha: [realThread("alpha", "opted-out-seeded-row")],
    },
  });
  try {
    await harness.open();
    await harness.selectLeaf("threads");
    await harness.selectThread("Realtime thread sync");
    await harness.clickControl("Next");

    const root = requireElement(
      harness.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const destinations = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('a[href*="copilotkit.ai"]'),
    );
    const headerCta = requireElement(
      root.querySelector<HTMLAnchorElement>("[data-inspector-thread-cta]"),
      "Threads header CTA was not rendered",
    );
    headerCta.dispatchEvent(new Event("click"));
    await harness.flush();

    expect(harness.telemetryBodies).toEqual([]);
    expect(
      harness.requestUrls.filter((url) => url === TELEMETRY_INGEST_URL),
    ).toEqual([]);
    expect(window.localStorage.getItem(TELEMETRY_DISTINCT_ID_KEY)).toBeNull();
    expect(window.localStorage.getItem(TELEMETRY_DISCLOSURE_KEY)).toBeNull();
    expect(disclosureLog).not.toHaveBeenCalled();
    expect(destinations.length).toBeGreaterThan(0);
    for (const destination of destinations) {
      expect(
        new URL(destination.href).searchParams.has("posthog_distinct_id"),
      ).toBe(false);
    }
    expect(root.querySelector("cpk-thread-details")).not.toBeNull();
    expect(root.querySelector('[role="dialog"]')?.textContent ?? "").toContain(
      "2/3",
    );
  } finally {
    await harness.teardown();
  }
});

test("telemetry rejection cannot break actions, example selection, tour state, or navigation", async () => {
  const unhandledReasons: unknown[] = [];
  const recordUnhandled = (event: PromiseRejectionEvent): void => {
    unhandledReasons.push(event.reason);
  };
  window.addEventListener("unhandledrejection", recordUnhandled);
  const placement = placementCases[0];
  if (!placement) throw new Error("Footer placement fixture was not defined");
  const harness = await setup({
    metadataResponses: [metadataWithAction(placement)],
    rejectTelemetry: true,
  });
  try {
    await harness.open();
    const root = requireElement(
      harness.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const action = requireElement(
      root.querySelector<HTMLAnchorElement>(
        '[data-inspector-action-placement="threads-footer"]',
      ),
      "Footer action was not rendered",
    );
    const href = action.href;
    action.dispatchEvent(new Event("click"));
    await harness.selectThread("Realtime thread sync");
    await harness.clickControl("Next");
    await harness.selectLeaf("agents");
    await harness.selectLeaf("threads");
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    const currentAction = requireElement(
      root.querySelector<HTMLAnchorElement>(
        '[data-inspector-action-placement="threads-footer"]',
      ),
      "Footer action disappeared after telemetry rejection",
    );
    expect(currentAction.href).toBe(href);
    expect(root.querySelector("cpk-thread-details")).not.toBeNull();
    expect(root.querySelector('[role="dialog"]')?.textContent ?? "").toContain(
      "2/3",
    );
    expect(
      root.querySelector(
        'button[data-inspector-menu-key="threads"][aria-current="page"]',
      ),
    ).not.toBeNull();
    expect(harness.telemetryBodies.length).toBeGreaterThan(0);
    expect(unhandledReasons).toEqual([]);
  } finally {
    window.removeEventListener("unhandledrejection", recordUnhandled);
    await harness.teardown();
  }
});
