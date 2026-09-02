import { configureWebInspectorElement, WebInspectorElement } from "../index.js";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type { CopilotKitCoreSubscriber } from "@copilotkit/core";
import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import type { InspectorOpenSource } from "../shared/telemetry/privacy.js";
import { describe, it, test, expect, vi, beforeEach, afterEach } from "vitest";
import { findInspectorCopyControl } from "../testing/inspector-elements.js";
import { installClipboard } from "../testing/clipboard.js";
import type { ThreadsState } from "../domains/threads/state.js";

// --- Types for accessing LitElement-private reactive properties ---
// WebInspectorElement stores these as private Lit reactive properties.
// There's no public API to read them, so the cast is unavoidable in tests.

type InspectorThreadViewInternals = {
  isOpen: boolean;
  selectedMenu: "ag-ui-events" | "threads";
  threads: ThreadsState;
};

// --- Mock agent factory ---

type MockAgentExtras = Partial<{
  messages: unknown;
  state: unknown;
  toolHandlers: Record<string, unknown>;
  toolRenderers: Record<string, unknown>;
}>;

type MockAgentController = {
  // Each subscriber method has a different parameter shape — TypeScript
  // can't narrow a dynamic key lookup, so the internal cast is unavoidable.
  emit: (key: keyof AgentSubscriber, payload: unknown) => void;
  /** Simulate AbstractAgent.setState(): mutate the mock's state and notify subscribers. */
  simulateSetState: (newState: Record<string, unknown>) => void;
};

function createMockAgent(
  agentId: string,
  extras: MockAgentExtras = {},
): { agent: AbstractAgent; controller: MockAgentController } {
  const subscribers = new Set<AgentSubscriber>();

  const agentObj = {
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

  const simulateSetState = (newState: Record<string, unknown>) => {
    agentObj.state = newState;
    emit("onStateChanged", {
      state: newState,
      messages: agentObj.messages ?? [],
      agent: agentObj,
    });
  };

  // AbstractAgent is an abstract class — our plain-object mock satisfies
  // the subset the inspector uses but can't extend the class.
  return {
    agent: agentObj as unknown as AbstractAgent,
    controller: { emit, simulateSetState },
  };
}

// --- Mock core factory ---

// --- Minimal no-op memory store stub ---
// The inspector calls core.getMemoryStore() lazily, on first Memories-tab
// activation (NOT on attach). All mock cores still expose this method so that
// tests which do activate the tab don't hit a TypeError. The stub below seeds
// the store with empty memories and available=true, which is the right default
// for tests that don't exercise the memory feature.

type MockMemoryStoreState = {
  memories: never[];
  isLoading: boolean;
  isMutating: boolean;
  error: null;
  context: null;
  sessionId: number;
  available: boolean;
  realtimeStatus: "connecting" | "connected" | "unavailable";
};

function createNoopMemoryStore() {
  const state: MockMemoryStoreState = {
    memories: [],
    isLoading: false,
    isMutating: false,
    error: null,
    context: null,
    sessionId: 0,
    available: true,
    realtimeStatus: "connecting",
  };
  return {
    getState: () => state,
    select: <T>(selector: (s: MockMemoryStoreState) => T) => ({
      subscribe: (cb: (v: T) => void) => {
        cb(selector(state));
        return { unsubscribe: () => undefined };
      },
    }),
  };
}

type MockCore = {
  agents: Record<string, AbstractAgent>;
  context: Record<string, unknown>;
  properties: Record<string, unknown>;
  runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
  subscribe: (subscriber: CopilotKitCoreSubscriber) => {
    unsubscribe: () => void;
  };
  getThreadStores: () => Record<string, never>;
  getThreadStore: (agentId: string) => undefined;
  getMemoryStore: () => ReturnType<typeof createNoopMemoryStore>;
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
    getThreadStores() {
      return {};
    },
    getThreadStore(_agentId: string) {
      return undefined;
    },
    getMemoryStore() {
      return createNoopMemoryStore();
    },
  };

  return {
    core,
    emitAgentsChanged(nextAgents = core.agents) {
      core.agents = nextAgents;
      // CopilotKitCore is a full class — our mock only covers what the
      // inspector reads, so this cast is unavoidable.
      subscribers.forEach((subscriber) =>
        subscriber.onAgentsChanged?.({
          copilotkit: core as unknown as CopilotKitCore,
          agents: core.agents,
        }),
      );
    },
  };
}

// --- Test helpers ---

/** Create inspector, attach to DOM, wire up mock core. */
function createInspectorWithCore(core: MockCore) {
  const inspector = new WebInspectorElement();
  document.body.appendChild(inspector);
  // WebInspectorElement["core"] is a CopilotKitCore instance — our MockCore
  // only implements the subset exercised by these tests.
  inspector.core = core as unknown as WebInspectorElement["core"];
  return inspector;
}

type TelemetryPost = { event: string; properties: Record<string, unknown> };

/** Decode the `oss.inspector.*` payloads a stubbed fetch received. */
function telemetryPostsFrom(fetchMock: {
  mock: { calls: unknown[][] };
}): TelemetryPost[] {
  return fetchMock.mock.calls
    .filter(
      (call) =>
        String(call[0]) === "https://telemetry.copilotkit.ai/ingest" &&
        (call[1] as RequestInit | undefined)?.method === "POST",
    )
    .map(
      (call) =>
        JSON.parse(
          ((call[1] as RequestInit | undefined)?.body as string) ?? "{}",
        ) as TelemetryPost,
    );
}

// --- Tests ---

describe("WebInspectorElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("binds a host core before the real custom element connects", () => {
    const { core } = createMockCore();
    const inspector = new WebInspectorElement();

    configureWebInspectorElement(inspector, core as unknown as CopilotKitCore);
    document.body.appendChild(inspector);

    expect(inspector.autoAttachCore).toBe(false);
    expect(inspector.core).toBe(core);
  });
  it("opens the requested message's thread", async () => {
    const { agent } = createMockAgent("alpha");
    const { core, emitAgentsChanged } = createMockCore({ alpha: agent });
    const inspector = createInspectorWithCore(core);

    emitAgentsChanged();
    await inspector.updateComplete;

    inspector.openInspector("message_toolbar", {
      threadId: "thread-1",
      agentId: "alpha",
      messageId: "assistant-message-1",
    });
    await inspector.updateComplete;

    const focusInternals = inspector as unknown as {
      isOpen: boolean;
      selectedMenu: string;
      selectedContext: string;
      threads: ThreadsState;
    };

    expect(focusInternals.isOpen).toBe(true);
    expect(focusInternals.selectedMenu).toBe("threads");
    expect(focusInternals.selectedContext).toBe("alpha");
    expect(focusInternals.threads.selectedThreadId).toBe("thread-1");
    expect(focusInternals.threads.focusedThreadMessageId).toBe(
      "assistant-message-1",
    );
    expect(focusInternals.threads.threadFocusRequestId).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Panel-open + What's new telemetry (OSS-566 / OSS-568 / OSS-864)
// ─────────────────────────────────────────────────────────────────────────
//
// `oss.inspector.opened` exists because opens were previously only inferable
// from in-panel activity (a floor) or from the announcement's own click event
// (which misses the floating-button path). `whats_new_viewed` carries a
// `surface` so a second one can be added later without reshaping the event,
// and it fires only when What's new renders WITH CONTENT — so the metric
// cannot inflate itself by counting people who opened the Inspector for an
// unrelated reason, or who arrived before the feed resolved.

const ANNOUNCEMENT_URL = "https://cdn.copilotkit.ai/announcements.json";

type OpenTelemetryInternals = {
  isOpen: boolean;
  announcementTimestamp: string | null;
  fetchAnnouncement: () => Promise<void>;
  openInspector: (source: InspectorOpenSource) => void;
};

/**
 * Open the panel, then navigate to What's new the way a reader does.
 *
 * Spelled out rather than relying on the landing tab: the launcher restores
 * whatever tab was last used, so a helper that only opened the panel would
 * pass by coincidence whenever that happened to be What's new.
 */
async function openWhatsNew(inspector: WebInspectorElement): Promise<void> {
  inspector.shadowRoot
    ?.querySelector<HTMLElement>('button[aria-label^="Web Inspector"]')
    ?.click();
  await inspector.updateComplete;
  inspector.shadowRoot
    ?.querySelector<HTMLElement>('button[data-inspector-menu-key="whats-new"]')
    ?.click();
  await inspector.updateComplete;
}

describe("WebInspectorElement open + What's new telemetry", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let body = "Channels are here — [read more](https://x.test)";
  const timestamp = "2026-07-01T09:00:00.000Z";

  beforeEach(() => {
    document.body.innerHTML = "";
    window.sessionStorage.clear();
    body = "Channels are here — [read more](https://x.test)";
    fetchMock = vi.fn((input: unknown) => {
      const href = String(input);
      if (href === ANNOUNCEMENT_URL) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              timestamp,
              previewText: "Channels are here",
              announcement: body,
            }),
            { status: 200 },
          ),
        );
      }
      if (href.includes("/threads")) {
        return Promise.resolve(
          new Response(JSON.stringify({ threads: [], joinCode: null }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Mount an inspector attached to a connected core with telemetry on. */
  function mount(telemetryDisabled = false, connected = true) {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore(
      { alpha: agent },
      {},
      {},
      telemetryDisabled,
    );
    if (!connected) {
      harness.core.runtimeConnectionStatus =
        CopilotKitCoreRuntimeConnectionStatus.Disconnected;
    }
    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    return {
      inspector,
      harness,
      internals: inspector as unknown as OpenTelemetryInternals,
    };
  }

  const posts = () => telemetryPostsFrom(fetchMock);
  const eventsNamed = (name: string) =>
    posts().filter((post) => post.event === name);
  const launcherIsPulsing = (inspector: WebInspectorElement) =>
    inspector.shadowRoot
      ?.querySelector('button[aria-label^="Web Inspector"]')
      ?.getAttribute("data-cpk-signal-pulsing") === "true";
  const announcementLink = (inspector: WebInspectorElement) => {
    const link = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      ".announcement-content a",
    );
    if (!link) throw new Error("Expected announcement link");
    return link;
  };

  it("records one launcher signal presentation when the pulse is rendered", async () => {
    const { inspector, internals } = mount();

    await internals.fetchAnnouncement();
    await inspector.updateComplete;

    expect(launcherIsPulsing(inspector)).toBe(true);
    const viewed = eventsNamed("oss.inspector.whats_new_signal_viewed");
    expect(viewed).toHaveLength(1);
    expect(viewed[0]!.properties).toMatchObject({
      banner_id: timestamp,
      surface: "launcher",
      presentation: "animated",
      package_name: "@copilotkit/web-inspector",
    });

    inspector.requestUpdate();
    await inspector.updateComplete;
    expect(eventsNamed("oss.inspector.whats_new_signal_viewed")).toHaveLength(
      1,
    );
  });

  it("waits to present and record the launcher signal until the tab is visible", async () => {
    const originalVisibility = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    let visibility: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });

    try {
      const { inspector, internals } = mount();
      await internals.fetchAnnouncement();
      await inspector.updateComplete;

      expect(launcherIsPulsing(inspector)).toBe(false);
      expect(eventsNamed("oss.inspector.whats_new_signal_viewed")).toHaveLength(
        0,
      );

      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      await inspector.updateComplete;

      expect(launcherIsPulsing(inspector)).toBe(true);
      expect(eventsNamed("oss.inspector.whats_new_signal_viewed")).toHaveLength(
        1,
      );
    } finally {
      if (originalVisibility) {
        Object.defineProperty(document, "visibilityState", originalVisibility);
      } else {
        Reflect.deleteProperty(document, "visibilityState");
      }
    }
  });

  it("labels a reduced-motion launcher presentation without requiring animation", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
      })),
    );
    const { inspector, internals } = mount();

    await internals.fetchAnnouncement();
    await inspector.updateComplete;

    expect(
      eventsNamed("oss.inspector.whats_new_signal_viewed")[0]!.properties,
    ).toMatchObject({ presentation: "reduced_motion" });
  });

  it("holds the launcher presentation until the runtime allows telemetry", async () => {
    const { inspector, harness, internals } = mount(false, false);

    await internals.fetchAnnouncement();
    await inspector.updateComplete;
    expect(eventsNamed("oss.inspector.whats_new_signal_viewed")).toHaveLength(
      0,
    );

    harness.completeHandshake({ telemetryDisabled: false });
    await inspector.updateComplete;
    expect(eventsNamed("oss.inspector.whats_new_signal_viewed")).toHaveLength(
      1,
    );
  });

  it("records one What's new impression, enriched like every other event", async () => {
    const { inspector, internals } = mount();

    await internals.fetchAnnouncement();
    await inspector.updateComplete;

    // Nothing yet: the announcement has loaded but nobody has seen it.
    expect(eventsNamed("oss.inspector.whats_new_viewed")).toHaveLength(0);

    await openWhatsNew(inspector);

    const viewed = eventsNamed("oss.inspector.whats_new_viewed");
    expect(viewed).toHaveLength(1);
    expect(viewed[0]!.properties).toMatchObject({
      banner_id: timestamp,
      surface: "whats_new",
      package_name: "@copilotkit/web-inspector",
    });
  });

  it("records announcement link activations, not ordinary content clicks", async () => {
    const { inspector, internals } = mount();

    await internals.fetchAnnouncement();
    await inspector.updateComplete;
    await openWhatsNew(inspector);

    const content = inspector.shadowRoot?.querySelector<HTMLElement>(
      ".announcement-content",
    );
    if (!content) throw new Error("Expected announcement content");

    content.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(eventsNamed("oss.inspector.whats_new_clicked")).toHaveLength(0);

    const link = content.querySelector<HTMLAnchorElement>("a");
    if (!link) throw new Error("Expected announcement link");
    link.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(eventsNamed("oss.inspector.whats_new_clicked")).toHaveLength(1);
  });

  it("copies announcement code through the shared copy control", async () => {
    const code = `const message = '<safe & exact>';`;
    body = `\`\`\`ts\n${code}\n\`\`\``;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const restoreClipboard = installClipboard({ writeText });

    try {
      const { inspector, internals } = mount();
      await internals.fetchAnnouncement();
      await openWhatsNew(inspector);

      const copy = findInspectorCopyControl(inspector.shadowRoot!, "Copy code");
      expect(copy).not.toBeNull();
      copy?.click();
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
    } finally {
      restoreClipboard();
    }
  });

  it("does not expose notification telemetry before a disabling handshake", async () => {
    body = "Channels are here — [read more](https://www.copilotkit.ai/news)";
    const { inspector, harness, internals } = mount(false, false);

    await internals.fetchAnnouncement();
    await inspector.updateComplete;
    await openWhatsNew(inspector);

    const link = announcementLink(inspector);
    expect(new URL(link.href).searchParams.has("posthog_distinct_id")).toBe(
      false,
    );

    link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(eventsNamed("oss.inspector.whats_new_clicked")).toHaveLength(0);

    harness.completeHandshake({ telemetryDisabled: true });
    await inspector.updateComplete;
    expect(eventsNamed("oss.inspector.whats_new_signal_viewed")).toHaveLength(
      0,
    );
    expect(eventsNamed("oss.inspector.whats_new_viewed")).toHaveLength(0);
    expect(eventsNamed("oss.inspector.whats_new_clicked")).toHaveLength(0);
  });

  it("adds notification attribution after the runtime allows telemetry", async () => {
    body = "Channels are here — [read more](https://www.copilotkit.ai/news)";
    const { inspector, harness, internals } = mount(false, false);

    await internals.fetchAnnouncement();
    await inspector.updateComplete;
    harness.completeHandshake({ telemetryDisabled: false });
    await inspector.updateComplete;
    await openWhatsNew(inspector);

    const link = announcementLink(inspector);
    expect(new URL(link.href).searchParams.has("posthog_distinct_id")).toBe(
      false,
    );

    link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(new URL(link.href).searchParams.get("posthog_distinct_id")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(eventsNamed("oss.inspector.whats_new_clicked")).toHaveLength(1);
  });

  // The metric must mean "the announcement was actually shown". A What's new
  // render without content — a loading state, or a body that renders to
  // nothing — is not an impression, so the metric cannot inflate itself.
  it("records no impression for a What's new render without content", async () => {
    body = "   ";
    const { inspector, internals } = mount();

    await internals.fetchAnnouncement();
    await inspector.updateComplete;
    // No dot to click: nothing armed, because nothing renders.
    inspector.shadowRoot
      ?.querySelector<HTMLElement>('button[aria-label^="Web Inspector"]')
      ?.click();
    await inspector.updateComplete;

    expect(eventsNamed("oss.inspector.whats_new_viewed")).toHaveLength(0);
  });

  it("does not re-record an impression already seen this mount", async () => {
    const { inspector, internals } = mount();

    await internals.fetchAnnouncement();
    await openWhatsNew(inspector);
    // Re-rendering the same view, repeatedly, is still one impression.
    inspector.requestUpdate();
    await inspector.updateComplete;
    inspector.requestUpdate();
    await inspector.updateComplete;

    expect(eventsNamed("oss.inspector.whats_new_viewed")).toHaveLength(1);
  });

  it("attributes every launcher open to the launcher, unread or not", async () => {
    // The launcher never routes through the signal, so it has one source. The
    // question "did a pending announcement coincide with this open?" is
    // answered by has_unseen_announcement, not by a second source value.
    const { inspector, internals } = mount();

    await internals.fetchAnnouncement();
    await inspector.updateComplete;

    inspector.shadowRoot
      ?.querySelector<HTMLElement>('button[aria-label^="Web Inspector"]')
      ?.click();
    await inspector.updateComplete;

    const opened = eventsNamed("oss.inspector.opened");
    expect(opened).toHaveLength(1);
    expect(opened[0]!.properties).toMatchObject({
      open_source: "floating_button",
      has_unseen_announcement: true,
      package_name: "@copilotkit/web-inspector",
    });
  });

  it("attributes a launcher open to the launcher when nothing is unread", async () => {
    const { inspector } = mount();
    await inspector.updateComplete;

    inspector.shadowRoot
      ?.querySelector<HTMLElement>('button[aria-label^="Web Inspector"]')
      ?.click();
    await inspector.updateComplete;

    expect(eventsNamed("oss.inspector.opened")[0]!.properties).toMatchObject({
      open_source: "floating_button",
      has_unseen_announcement: false,
    });
  });

  it("attributes an open from an assistant message toolbar", async () => {
    const { inspector, internals } = mount();
    await inspector.updateComplete;

    inspector.openInspector("message_toolbar");
    await inspector.updateComplete;

    expect(eventsNamed("oss.inspector.opened")[0]!.properties).toMatchObject({
      open_source: "message_toolbar",
    });
    expect(internals.isOpen).toBe(true);
  });

  it("counts one open per open, and nothing for an already-open panel", async () => {
    const { inspector, internals } = mount();
    await inspector.updateComplete;

    internals.openInspector("floating_button");
    internals.openInspector("floating_button");
    await inspector.updateComplete;

    expect(eventsNamed("oss.inspector.opened")).toHaveLength(1);
  });

  it("does not count a restored-open panel as an open", async () => {
    const { inspector, internals } = mount();
    // Restoring persisted state assigns isOpen directly rather than calling
    // openInspector — otherwise every reload / dev-server hot reload would
    // register as a fresh open.
    internals.isOpen = true;
    inspector.requestUpdate();
    await inspector.updateComplete;

    expect(eventsNamed("oss.inspector.opened")).toHaveLength(0);
  });

  // An open while disconnected is still a real open, so it is reported — but the
  // /info-derived dimensions are omitted rather than guessed. Recording the
  // `sse` default would permanently misattribute an Intelligence runtime.
  it("omits license and runtime mode for an open before the handshake", async () => {
    const { inspector, internals } = mount(false, false);

    internals.openInspector("floating_button");
    await inspector.updateComplete;

    const opened = eventsNamed("oss.inspector.opened");
    expect(opened).toHaveLength(1);
    expect(opened[0]!.properties).toMatchObject({
      open_source: "floating_button",
      // Config-derived, so accurate immediately.
      runtime_url_type: "localhost",
    });
    expect(opened[0]!.properties).not.toHaveProperty("runtime_mode");
    expect(opened[0]!.properties).not.toHaveProperty("license_status");
  });

  it("records license and runtime mode for an open against a connected Intelligence runtime", async () => {
    const { inspector, harness, internals } = mount(false, false);
    harness.completeHandshake({
      telemetryDisabled: false,
      runtimeMode: "intelligence",
      licenseStatus: "valid",
    });
    await inspector.updateComplete;

    internals.openInspector("floating_button");
    await inspector.updateComplete;

    expect(eventsNamed("oss.inspector.opened")[0]!.properties).toMatchObject({
      open_source: "floating_button",
      runtime_mode: "intelligence",
      license_status: "valid",
    });
  });

  // The impression deferral predates the surface split and must survive it: the
  // runtime's opt-out only arrives with /info.
  it("holds an impression until the handshake, then drops it when telemetry is disabled", async () => {
    const { inspector, harness, internals } = mount(false, false);

    await internals.fetchAnnouncement();
    await openWhatsNew(inspector);
    expect(eventsNamed("oss.inspector.whats_new_viewed")).toHaveLength(0);

    harness.completeHandshake({ telemetryDisabled: true });
    await inspector.updateComplete;

    expect(eventsNamed("oss.inspector.whats_new_viewed")).toHaveLength(0);
  });

  it("releases a held impression once the runtime allows telemetry", async () => {
    const { inspector, harness, internals } = mount(false, false);

    await internals.fetchAnnouncement();
    await openWhatsNew(inspector);
    expect(eventsNamed("oss.inspector.whats_new_viewed")).toHaveLength(0);

    harness.completeHandshake({ telemetryDisabled: false });
    await inspector.updateComplete;

    const viewed = eventsNamed("oss.inspector.whats_new_viewed");
    expect(viewed).toHaveLength(1);
    expect(viewed[0]!.properties).toMatchObject({
      surface: "whats_new",
    });
  });

  it("emits nothing when the runtime has telemetry disabled", async () => {
    const { inspector, internals } = mount(true);

    await internals.fetchAnnouncement();
    await openWhatsNew(inspector);

    expect(posts()).toEqual([]);
  });
});

// --- Owned thread store header forwarding (issue #5581) ---
//
// When useThreads() isn't mounted, the inspector creates its own thread store
// per agent (ensureOwnedThreadStore). That store's /threads requests must carry
// the headers configured on <CopilotKit> (e.g. X-CSRF / auth), otherwise the
// requests 403 in environments that enforce CSRF/auth checks.

type RuntimeEntitlementDiagnostics = NonNullable<
  CopilotKitCore["runtimeEntitlements"]
>;

type HeaderMockCore = {
  agents: Record<string, AbstractAgent>;
  context: Record<string, unknown>;
  properties: Record<string, unknown>;
  telemetryDisabled: boolean;
  // Mirrors CopilotKitCore's pre-handshake state (`agent-registry.ts:77`):
  // `runtimeMode` already reads its `sse` default and `licenseStatus` is absent,
  // both of which only become real once /info answers. Without this, telemetry
  // assertions about pre-handshake segmentation pass for the wrong reason.
  runtimeMode: string;
  licenseStatus?: string;
  runtimeEntitlements?: RuntimeEntitlementDiagnostics;
  runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
  runtimeUrl: string;
  headers: Record<string, string>;
  ɵruntimeFetch: typeof fetch;
  threadEndpoints: {
    list: boolean;
    inspect: boolean;
    mutations: boolean;
    realtimeMetadata: boolean;
  };
  subscribe: (subscriber: CopilotKitCoreSubscriber) => {
    unsubscribe: () => void;
  };
  getThreadStores: () => Record<string, never>;
  getThreadStore: (agentId: string) => undefined;
  registerThreadStore: (agentId: string, store: unknown) => void;
  unregisterThreadStore: (agentId: string) => void;
  getMemoryStore: () => ReturnType<typeof createNoopMemoryStore>;
};

function createHeaderMockCore(
  agents: Record<string, AbstractAgent>,
  headers: Record<string, string>,
  endpointOverrides: Partial<HeaderMockCore["threadEndpoints"]> = {},
  telemetryDisabled = true,
  diagnostics: Pick<
    HeaderMockCore,
    "runtimeEntitlements" | "licenseStatus"
  > = {},
) {
  const subscribers = new Set<CopilotKitCoreSubscriber>();
  // Delegates to the live `globalThis.fetch` so every existing assertion on the
  // fetch stub keeps working, while a regression back to the global leaves this
  // spy uncalled.
  const runtimeFetch = vi.fn<typeof fetch>((...args) =>
    globalThis.fetch(...args),
  );
  const core: HeaderMockCore = {
    agents,
    context: {},
    properties: {},
    telemetryDisabled,
    runtimeMode: "sse",
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
    runtimeUrl: "http://localhost/api",
    headers,
    ɵruntimeFetch: runtimeFetch,
    threadEndpoints: {
      list: true,
      inspect: true,
      mutations: true,
      realtimeMetadata: true,
      ...endpointOverrides,
    },
    subscribe(subscriber: CopilotKitCoreSubscriber) {
      subscribers.add(subscriber);
      return { unsubscribe: () => subscribers.delete(subscriber) };
    },
    getThreadStores() {
      return {};
    },
    getThreadStore() {
      return undefined;
    },
    registerThreadStore() {},
    unregisterThreadStore() {},
    getMemoryStore() {
      return createNoopMemoryStore();
    },
  };

  const asCore = () => core as unknown as CopilotKitCore;
  return {
    core,
    runtimeFetch,
    emitAgentsChanged() {
      subscribers.forEach((s) =>
        s.onAgentsChanged?.({ copilotkit: asCore(), agents: core.agents }),
      );
    },
    emitHeadersChanged(nextHeaders: Record<string, string>) {
      core.headers = nextHeaders;
      subscribers.forEach((s) =>
        s.onHeadersChanged?.({ copilotkit: asCore(), headers: nextHeaders }),
      );
    },
    /**
     * Simulates the /info handshake landing: applies what the runtime reported,
     * then transitions to `connected`. Lets a test observe what is sent after
     * the handshake versus before it — the segmentation fields do not exist
     * until this point.
     */
    completeHandshake(
      reported: {
        telemetryDisabled?: boolean;
        licenseStatus?: string;
        runtimeMode?: string;
      } = {},
    ) {
      Object.assign(core, reported);
      core.runtimeConnectionStatus =
        CopilotKitCoreRuntimeConnectionStatus.Connected;
      subscribers.forEach((s) =>
        s.onRuntimeConnectionStatusChanged?.({
          copilotkit: asCore(),
          status: core.runtimeConnectionStatus,
        }),
      );
    },
  };
}

const headersOf = (call: unknown[]) =>
  (call[1] as { headers?: Record<string, string> } | undefined)?.headers ?? {};

/** Return the rendered text inside the nested Threads list component. */
const threadListText = (inspector: WebInspectorElement) =>
  inspector.shadowRoot?.querySelector("cpk-thread-list")?.shadowRoot
    ?.textContent ?? "";

/** Create an isolated Runtime-diagnostics browser fixture. */
function setupRuntimeDiagnostics() {
  document.body.innerHTML = "";
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const threadListCalls = () =>
    fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/threads?"),
    );

  /** Mount the Threads view with one capability and entitlement state. */
  async function mountThreadsWithCapability(
    threadListAvailable: boolean,
    diagnostics: Pick<HeaderMockCore, "runtimeEntitlements" | "licenseStatus">,
  ): Promise<WebInspectorElement> {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/info")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              version: "1.0.0",
              agents: {
                alpha: {
                  name: "alpha",
                  className: "HttpAgent",
                  description: "Alpha",
                },
              },
              audioFileTranscriptionEnabled: false,
              mode: "intelligence",
              threadEndpoints: {
                list: threadListAvailable,
                inspect: true,
                mutations: true,
                realtimeMetadata: true,
              },
              telemetryDisabled: true,
              ...diagnostics,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (url.includes("/threads?")) {
        return Promise.resolve(
          new Response(JSON.stringify({ threads: [] }), { status: 200 }),
        );
      }
      if (url.includes("announcement.json")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              timestamp: "2026-07-11T00:00:00.000Z",
              previewText: "",
              announcement: "Inspector",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    const core = new CopilotKitCore({
      runtimeUrl: "http://localhost/api",
      runtimeTransport: "rest",
    });
    await vi.waitFor(() => {
      expect(core.runtimeConnectionStatus).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      );
    });

    localStorage.removeItem("cpk:inspector:state");
    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = core;
    await inspector.updateComplete;

    const openInspector =
      inspector.shadowRoot?.querySelector<HTMLButtonElement>(
        'button[aria-label="Web Inspector"]',
      );
    expect(openInspector).not.toBeNull();
    openInspector?.click();
    await inspector.updateComplete;

    const threadsButton = Array.from(
      inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.trim() === "Threads");
    expect(threadsButton).toBeDefined();
    threadsButton?.click();
    await inspector.updateComplete;

    return inspector;
  }

  return {
    fetchMock,
    mountThreadsWithCapability,
    threadListCalls,
    teardown: () => {
      document.body.innerHTML = "";
      vi.unstubAllGlobals();
    },
  };
}

test.each([
  {
    diagnostic: "ready entitlement",
    status: "ready",
    legacyStatus: "expired",
    runtimeEntitlements: {
      status: "ready",
      entitlement: {
        active: true,
        source: "managedOrgSubscription",
        features: { msteams: true },
        limits: { "threads.retention_hours": 120 },
        planCode: "pro",
        entitlementSource: "clerk_subscription",
      },
    },
    errorMessage: undefined,
    errorCode: undefined,
    requestId: undefined,
    traceId: undefined,
    lockedHeading: "Renew Intelligence to inspect Threads.",
  },
  {
    diagnostic: "expired self-hosted entitlement",
    status: "degraded",
    legacyStatus: "valid",
    runtimeEntitlements: {
      status: "degraded",
      error: {
        code: "RUNTIME_ENTITLEMENTS_SELF_HOSTED_EXPIRED",
        message: "Self-hosted license has expired.",
        retryable: false,
        requestId: "req-expired",
        traceId: "trace-expired",
      },
    },
    errorMessage: "Self-hosted license has expired.",
    errorCode: "RUNTIME_ENTITLEMENTS_SELF_HOSTED_EXPIRED",
    requestId: "req-expired",
    traceId: "trace-expired",
    lockedHeading: "Finish setting up Rich Threads",
  },
  {
    diagnostic: "misconfigured self-hosted entitlement",
    status: "misconfigured",
    legacyStatus: "valid",
    runtimeEntitlements: {
      status: "misconfigured",
      error: {
        code: "RUNTIME_ENTITLEMENTS_SELF_HOSTED_MISCONFIGURED",
        message: "Self-hosted license configuration is missing or invalid.",
        retryable: false,
      },
    },
    errorMessage: "Self-hosted license configuration is missing or invalid.",
    errorCode: "RUNTIME_ENTITLEMENTS_SELF_HOSTED_MISCONFIGURED",
    requestId: undefined,
    traceId: undefined,
    lockedHeading: "Finish setting up Rich Threads",
  },
  {
    diagnostic: "unavailable managed entitlement",
    status: "unavailable",
    legacyStatus: "valid",
    runtimeEntitlements: {
      status: "unavailable",
      error: {
        code: "RUNTIME_ENTITLEMENTS_MANAGED_UNAVAILABLE",
        message: "Managed entitlement resolution is temporarily unavailable.",
        retryable: true,
      },
    },
    errorMessage: "Managed entitlement resolution is temporarily unavailable.",
    errorCode: "RUNTIME_ENTITLEMENTS_MANAGED_UNAVAILABLE",
    requestId: undefined,
    traceId: undefined,
    lockedHeading: "Finish setting up Rich Threads",
  },
  {
    diagnostic: "SDK fail-soft entitlement lookup",
    status: "unavailable",
    legacyStatus: "valid",
    runtimeEntitlements: {
      status: "unavailable",
      error: {
        code: "runtime_entitlements_unavailable",
        message: "Runtime entitlement lookup failed",
        retryable: true,
      },
    },
    errorMessage: "Runtime entitlement lookup failed",
    errorCode: "runtime_entitlements_unavailable",
    requestId: undefined,
    traceId: undefined,
    lockedHeading: "Finish setting up Rich Threads",
  },
] as const)(
  "renders structured Runtime entitlement diagnostics for $diagnostic",
  async ({
    status,
    legacyStatus,
    runtimeEntitlements,
    errorMessage,
    errorCode,
    requestId,
    traceId,
    lockedHeading,
  }) => {
    const fixture = setupRuntimeDiagnostics();

    try {
      const inspector = await fixture.mountThreadsWithCapability(false, {
        runtimeEntitlements,
        licenseStatus: legacyStatus,
      });

      const diagnostics = inspector.shadowRoot?.querySelectorAll(
        "[data-runtime-entitlement-status]",
      );
      const diagnostic = inspector.shadowRoot?.querySelector<HTMLElement>(
        `[data-runtime-entitlement-status="${status}"]`,
      );

      expect(diagnostics).toHaveLength(1);
      expect(diagnostic).not.toBeNull();
      if (errorMessage) {
        expect(diagnostic?.textContent).toContain(errorMessage);
      }
      if (errorCode) {
        expect(diagnostic?.textContent).toContain(errorCode);
      }
      if (requestId) {
        expect(diagnostic?.textContent).toContain(requestId);
      }
      if (traceId) {
        expect(diagnostic?.textContent).toContain(traceId);
      }
      expect(inspector.shadowRoot?.textContent ?? "").toContain(lockedHeading);
      expect(
        fixture.fetchMock.mock.calls.some((call) =>
          String(call[0]).includes("/threads"),
        ),
      ).toBe(false);
    } finally {
      fixture.teardown();
    }
  },
);

test("falls back to expired legacy license diagnostics when structured entitlements are omitted", async () => {
  const fixture = setupRuntimeDiagnostics();

  try {
    const inspector = await fixture.mountThreadsWithCapability(false, {
      licenseStatus: "expired",
    });

    const diagnostics = inspector.shadowRoot?.querySelectorAll(
      "[data-runtime-entitlement-status]",
    );
    const degraded = inspector.shadowRoot?.querySelector(
      '[data-runtime-entitlement-status="degraded"]',
    );

    expect(diagnostics).toHaveLength(1);
    expect(degraded).not.toBeNull();
    expect(inspector.shadowRoot?.textContent ?? "").toContain(
      "Renew Intelligence to inspect Threads.",
    );
  } finally {
    fixture.teardown();
  }
});

test.each([
  {
    diagnostic: "structured misconfiguration",
    diagnostics: {
      runtimeEntitlements: {
        status: "misconfigured",
        error: {
          code: "RUNTIME_ENTITLEMENTS_SELF_HOSTED_MISCONFIGURED",
          message: "Self-hosted license configuration is missing or invalid.",
          retryable: false,
        },
      },
      licenseStatus: "valid",
    },
  },
  {
    diagnostic: "legacy expired license",
    diagnostics: { licenseStatus: "expired" },
  },
] as const)(
  "keeps Threads available for $diagnostic when the Runtime advertises list capability",
  async ({ diagnostics }) => {
    const fixture = setupRuntimeDiagnostics();

    try {
      const inspector = await fixture.mountThreadsWithCapability(
        true,
        diagnostics,
      );

      const threadsButton = Array.from(
        inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ??
          [],
      ).find((button) => button.textContent?.trim() === "Threads");
      expect(threadsButton).toBeDefined();
      await vi.waitFor(() => {
        expect(threadListText(inspector)).toContain("Realtime thread sync");
      });
      expect(inspector.shadowRoot?.textContent ?? "").toContain(
        "Threads are persistent, inspectable conversations",
      );
      expect(inspector.shadowRoot?.textContent ?? "").not.toContain(
        "Enable Intelligence to inspect Threads.",
      );
      expect(fixture.threadListCalls().length).toBeGreaterThan(0);
    } finally {
      fixture.teardown();
    }
  },
);

test.each([
  {
    diagnostic: "structured ready entitlement",
    diagnostics: {
      runtimeEntitlements: {
        status: "ready",
        entitlement: {
          active: true,
          source: "managedOrgSubscription",
          features: { msteams: true },
          limits: { "threads.retention_hours": 120 },
        },
      },
      licenseStatus: "expired",
    },
    lockedHeading: "Renew Intelligence to inspect Threads.",
  },
  {
    diagnostic: "legacy valid license",
    diagnostics: { licenseStatus: "valid" },
    lockedHeading: "Finish setting up Rich Threads",
  },
] as const)(
  "keeps Threads unavailable for $diagnostic when the Runtime omits list capability",
  async ({ diagnostics, lockedHeading }) => {
    const fixture = setupRuntimeDiagnostics();

    try {
      const inspector = await fixture.mountThreadsWithCapability(
        false,
        diagnostics,
      );

      const threadsButton = Array.from(
        inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ??
          [],
      ).find((button) => button.textContent?.trim() === "Threads");
      expect(threadsButton).toBeDefined();
      expect(inspector.shadowRoot?.textContent ?? "").toContain(lockedHeading);
      expect(threadListText(inspector)).not.toContain(
        "Threads are persistent, inspectable conversations",
      );
      expect(fixture.threadListCalls()).toHaveLength(0);
    } finally {
      fixture.teardown();
    }
  },
);

describe("WebInspectorElement owned thread store headers (#5581)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const threadListCalls = () =>
    fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/threads?"),
    );
  const telemetryPosts = () =>
    fetchMock.mock.calls
      .filter(
        (call) =>
          String(call[0]) === "https://telemetry.copilotkit.ai/ingest" &&
          (call[1] as RequestInit | undefined)?.method === "POST",
      )
      .map((call) => {
        const body =
          ((call[1] as RequestInit | undefined)?.body as string) ?? "{}";
        return JSON.parse(body) as {
          event: string;
          properties: Record<string, unknown>;
        };
      });
  const expectNoUtmParams = (url: URL) => {
    expect(url.searchParams.has("utm_source")).toBe(false);
    expect(url.searchParams.has("utm_medium")).toBe(false);
    expect(url.searchParams.has("utm_campaign")).toBe(false);
  };

  beforeEach(() => {
    document.body.innerHTML = "";
    window.localStorage.setItem(
      "cpk:inspector:state",
      JSON.stringify({
        isOpen: true,
        selectedMenu: "threads",
        hasOpenedInspector: true,
      }),
    );
    fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ threads: [] }),
      }),
    );
    // The owned store captures globalThis.fetch when it's created, so stub
    // before the inspector attaches to the core.
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("forwards core headers on the owned store's /threads request", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore(
      { alpha: agent },
      { "X-CSRF": "1", Authorization: "Bearer abc" },
    );

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    await vi.waitFor(() => {
      expect(threadListCalls().length).toBeGreaterThan(0);
    });

    expect(headersOf(threadListCalls()[0]!)).toMatchObject({
      "X-CSRF": "1",
      Authorization: "Bearer abc",
    });
  });

  it("routes the owned store's /threads request through the core's instrumented fetch", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, {});

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    await vi.waitFor(() => {
      expect(threadListCalls().length).toBeGreaterThan(0);
    });

    expect(
      harness.runtimeFetch.mock.calls.filter((call) =>
        String(call[0]).includes("/threads?"),
      ).length,
    ).toBe(threadListCalls().length);
  });

  // The Inspector ships independently of the core it attaches to, so a newer
  // Inspector can meet an older pinned core with no `ɵruntimeFetch`. Losing
  // detection through the Threads view is acceptable; handing the thread store
  // `undefined` and breaking the view outright is not.
  it("falls back to the global fetch when the core has no instrumented fetch", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, {});
    delete (harness.core as { ɵruntimeFetch?: unknown }).ɵruntimeFetch;

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    await vi.waitFor(() => {
      expect(threadListCalls().length).toBeGreaterThan(0);
    });
    expect(harness.runtimeFetch).not.toHaveBeenCalled();
  });

  it("re-applies headers on the owned store when core headers change", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, { "X-CSRF": "1" });

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    await vi.waitFor(() => {
      expect(threadListCalls().length).toBeGreaterThan(0);
    });
    const callsBefore = threadListCalls().length;

    harness.emitHeadersChanged({ "X-CSRF": "2" });

    await vi.waitFor(() => {
      expect(threadListCalls().length).toBeGreaterThan(callsBefore);
    });

    expect(headersOf(threadListCalls().at(-1)!)).toMatchObject({
      "X-CSRF": "2",
    });
  });

  it("rerenders selected thread details so core header changes refetch events with new headers", async () => {
    fetchMock.mockImplementation(
      (url: string, init?: { headers?: Record<string, string> }) => {
        if (url.endsWith("/threads/thread-1/events")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                events: [
                  {
                    type: "RUN_STARTED",
                    timestamp: "2026-06-25T10:00:00.000Z",
                    payload: { csrf: init?.headers?.["X-CSRF"] },
                  },
                ],
              }),
              { status: 200 },
            ),
          );
        }
        if (url.includes("/threads?")) {
          return Promise.resolve(
            new Response(JSON.stringify({ threads: [] }), { status: 200 }),
          );
        }
        if (url.includes("/threads/") && url.endsWith("/messages")) {
          return Promise.resolve(
            new Response(JSON.stringify({ messages: [] }), { status: 200 }),
          );
        }
        return Promise.reject(new Error(`Unexpected URL ${url}`));
      },
    );
    const harness = createHeaderMockCore({}, { "X-CSRF": "1" });
    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];

    const internals = inspector as unknown as InspectorThreadViewInternals;
    internals.isOpen = true;
    internals.selectedMenu = "threads";
    internals.threads.selectedThreadId = "thread-1";
    internals.threads.threads = [
      {
        id: "thread-1",
        name: "Thread 1",
        agentId: "alpha",
        organizationId: "organization",
        createdById: "user",
        archived: false,
        createdAt: "2026-06-25T09:00:00.000Z",
        updatedAt: "2026-06-25T10:00:00.000Z",
      },
    ];
    inspector.requestUpdate();
    await inspector.updateComplete;

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.filter((call) =>
          String(call[0]).endsWith("/threads/thread-1/events"),
        ),
      ).toHaveLength(1);
    });

    harness.emitHeadersChanged({ "X-CSRF": "2" });

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.filter((call) =>
          String(call[0]).endsWith("/threads/thread-1/events"),
        ),
      ).toHaveLength(2);
    });
    expect(headersOf(fetchMock.mock.calls.at(-1)!)).toMatchObject({
      "X-CSRF": "2",
    });
  });

  it("shows the locked Intelligence state when thread listing is unavailable without fetching threads", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore(
      { alpha: agent },
      { "X-CSRF": "1" },
      { list: false },
      true,
    );

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    const internals = inspector as unknown as {
      isOpen: boolean;
      selectedMenu: "home" | "threads";
      handleMenuSelect: (key: "threads") => void;
    };
    internals.isOpen = true;
    internals.selectedMenu = "threads";
    internals.handleMenuSelect("threads");
    inspector.requestUpdate();
    await inspector.updateComplete;

    const text = inspector.shadowRoot?.textContent ?? "";
    expect(text).toMatch(/Threads are unavailable\./);
    expect(text).toContain("Talk to an Engineer");
    expect(text).not.toContain("Sign up for Intelligence");
    const ctaLabels = Array.from(
      inspector.shadowRoot?.querySelectorAll<HTMLAnchorElement>("a") ?? [],
    ).map((anchor) => anchor.textContent?.trim());
    expect(
      ctaLabels.filter((label) => label === "Talk to an Engineer"),
    ).toEqual(["Talk to an Engineer"]);
    const engineer = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://www.copilotkit.ai/talk-to-an-engineer"]',
    );
    expect(engineer?.closest("#cpk-main-scroll")).toBeNull();
    expect(text).not.toContain("No threads yet");
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("/threads")),
    ).toBe(false);
  });

  it("keeps Threads-only engineer attribution when metadata action is absent", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore(
      { alpha: agent },
      {},
      { list: false },
      false,
    );

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    const internals = inspector as unknown as {
      isOpen: boolean;
      selectedMenu: "home" | "threads";
      handleMenuSelect: (key: "threads") => void;
    };
    internals.isOpen = true;
    internals.selectedMenu = "threads";
    internals.handleMenuSelect("threads");
    inspector.requestUpdate();
    await inspector.updateComplete;

    const signup = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://dashboard.operations.copilotkit.ai/sign-in"]',
    );
    const engineer = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://www.copilotkit.ai/talk-to-an-engineer"]',
    );

    expect(signup).toBeNull();
    expect(engineer).not.toBeNull();

    const distinctId = new URL(engineer!.href).searchParams.get(
      "posthog_distinct_id",
    );
    expect(distinctId).toMatch(/^[0-9a-f-]{36}$/);

    const engineerUrl = new URL(engineer!.href);
    expect(engineerUrl.origin).toBe("https://www.copilotkit.ai");
    expect(engineerUrl.pathname).toBe("/talk-to-an-engineer");
    expect(engineerUrl.searchParams.get("ref")).toBe("cpk-inspector-threads");
    expectNoUtmParams(engineerUrl);
    expect(engineerUrl.searchParams.get("posthog_distinct_id")).toBe(
      distinctId,
    );
  });

  it("tracks Threads tab clicks through the rendered inspector menu", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore(
      { alpha: agent },
      {},
      { list: false },
      false,
    );

    localStorage.setItem(
      "cpk:inspector:state",
      JSON.stringify({
        selectedMenu: "ag-ui-events",
        hasOpenedInspector: true,
      }),
    );
    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    const internals = inspector as unknown as { isOpen: boolean };
    internals.isOpen = true;
    inspector.requestUpdate();
    await inspector.updateComplete;

    const threadsButton = Array.from(
      inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.trim() === "Threads");
    expect(threadsButton, "Threads menu button should render").toBeDefined();

    threadsButton!.click();
    await inspector.updateComplete;
    await Promise.resolve();

    const threadsTabClick = telemetryPosts().find(
      (post) => post.event === "oss.inspector.threads_tab_clicked",
    );
    expect(threadsTabClick).toBeDefined();
    expect(threadsTabClick!.properties).toMatchObject({
      intelligence_status: "intelligence_not_enabled",
      thread_service_status: "unavailable",
      telemetry_disabled: false,
    });
    expect(threadsTabClick!.properties.distinct_id).toMatch(/^[0-9a-f-]{36}$/);
    if (threadsTabClick!.properties.posthog_distinct_id !== undefined) {
      expect(threadsTabClick!.properties.posthog_distinct_id).toBe(
        threadsTabClick!.properties.distinct_id,
      );
    }
  });

  it("renders example threads and the deselected overview when enabled thread history is empty", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, {}, {}, true);

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    const internals = inspector as unknown as {
      isOpen: boolean;
      selectedMenu: "home" | "threads";
      handleMenuSelect: (key: "threads") => void;
    };
    internals.isOpen = true;
    internals.selectedMenu = "threads";
    internals.handleMenuSelect("threads");
    inspector.requestUpdate();
    await inspector.updateComplete;

    await vi.waitFor(() => {
      const text = threadListText(inspector);
      expect(text).toContain("Realtime thread sync");
      expect(text).toContain("Manage saved conversations");
      expect(text).toContain("Inspect durable run history");
    });

    const text = inspector.shadowRoot?.textContent ?? "";
    expect(text).toContain("Threads are persistent, inspectable conversations");
    expect(text).toContain(
      "Take a tour with the example threads in the sidebar.",
    );
    const threadsDocs = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://docs.copilotkit.ai/threads"]',
    );
    expect(threadsDocs?.textContent?.trim()).toBe("Learn how Threads work");
    const threadsDocsUrl = new URL(threadsDocs!.href);
    expect(threadsDocsUrl.origin).toBe("https://docs.copilotkit.ai");
    expect(threadsDocsUrl.pathname).toBe("/threads");
    expect(threadsDocsUrl.searchParams.get("ref")).toBe(
      "cpk-inspector-threads",
    );
    expectNoUtmParams(threadsDocsUrl);
    const intelligence = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      '#cpk-main-scroll a[href^="https://intelligence.copilotkit.ai/?ref="]',
    );
    expect(intelligence?.textContent?.trim()).toBe("Sign up for Intelligence");
    const intelligenceUrl = new URL(intelligence!.href);
    expect(intelligenceUrl.origin).toBe("https://intelligence.copilotkit.ai");
    expect(intelligenceUrl.pathname).toBe("/");
    expect(intelligenceUrl.searchParams.get("ref")).toBe(
      "cpk-inspector-threads",
    );
    expectNoUtmParams(intelligenceUrl);
    expect(threadListText(inspector)).toContain("Example");
    expect(text).not.toContain("No threads yet");
    expect(
      inspector.shadowRoot?.querySelector("cpk-thread-details"),
    ).toBeNull();
    expect(
      (inspector as unknown as InspectorThreadViewInternals).threads
        .selectedThreadId,
    ).toBeNull();

    const engineer = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://www.copilotkit.ai/talk-to-an-engineer"]',
    );
    const engineerUrl = new URL(engineer!.href);
    expect(engineerUrl.origin).toBe("https://www.copilotkit.ai");
    expect(engineerUrl.pathname).toBe("/talk-to-an-engineer");
    expect(engineerUrl.searchParams.get("ref")).toBe("cpk-inspector-threads");
    expectNoUtmParams(engineerUrl);
    expect(engineer?.closest("#cpk-main-scroll")).toBeNull();
  });

  it("does not render example threads once real threads are present", async () => {
    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = createHeaderMockCore({}, {}, {}, true)
      .core as unknown as WebInspectorElement["core"];

    const internals = inspector as unknown as InspectorThreadViewInternals;
    internals.isOpen = true;
    internals.selectedMenu = "threads";
    internals.threads.threads = [
      {
        id: "real-thread",
        name: "Real customer thread",
        agentId: "alpha",
        organizationId: "organization",
        createdById: "user",
        archived: false,
        createdAt: "2026-06-25T09:00:00.000Z",
        updatedAt: "2026-06-25T10:00:00.000Z",
      },
    ];
    internals.threads.threadsByAgent = new Map([
      ["alpha", internals.threads.threads],
    ]);
    inspector.requestUpdate();
    await inspector.updateComplete;

    const text = threadListText(inspector);
    expect(text).toContain("Real customer thread");
    expect(text).not.toContain("Realtime thread sync");
    expect(text).not.toContain("Example");
  });

  it("selects an example thread, shows the tour, and toggles back to the overview on second click", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, {}, {}, true);

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    const internals = inspector as unknown as {
      isOpen: boolean;
      selectedMenu: "home" | "threads";
      handleMenuSelect: (key: "threads") => void;
      threads: ThreadsState;
    };
    internals.isOpen = true;
    internals.selectedMenu = "threads";
    internals.handleMenuSelect("threads");
    inspector.requestUpdate();
    await inspector.updateComplete;

    await vi.waitFor(() => {
      expect(threadListText(inspector)).toContain("Realtime thread sync");
    });

    const threadList = inspector.shadowRoot?.querySelector("cpk-thread-list");
    const firstRow =
      threadList?.shadowRoot?.querySelector<HTMLElement>(".cpk-tl__item");
    expect(firstRow).toBeDefined();

    firstRow!.click();
    await inspector.updateComplete;
    await vi.waitFor(() => {
      expect(internals.threads.selectedThreadId).toBe("example-realtime-sync");
      expect(
        inspector.shadowRoot?.querySelector("cpk-thread-details"),
      ).not.toBe(null);
      expect(inspector.shadowRoot?.textContent ?? "").toContain(
        "Read the run as a story",
      );
    });

    firstRow!.click();
    await inspector.updateComplete;

    await vi.waitFor(() => {
      expect(internals.threads.selectedThreadId).toBeNull();
      expect(
        inspector.shadowRoot?.querySelector("cpk-thread-details"),
      ).toBeNull();
      expect(inspector.shadowRoot?.textContent ?? "").toContain(
        "Threads are persistent, inspectable conversations",
      );
    });
  });

  it("persists example tour dismissal so it does not auto-open again", async () => {
    const stored = new Map<string, string>([
      [
        "cpk:inspector:state",
        JSON.stringify({
          isOpen: true,
          selectedMenu: "threads",
          hasOpenedInspector: true,
        }),
      ],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
      clear: () => stored.clear(),
      get length() {
        return stored.size;
      },
      key: (index: number) => Array.from(stored.keys())[index] ?? null,
    });

    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, {}, {}, false);

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    const internals = inspector as unknown as {
      isOpen: boolean;
      selectedMenu: "home" | "threads";
      handleMenuSelect: (key: "threads") => void;
    };
    internals.isOpen = true;
    internals.selectedMenu = "threads";
    internals.handleMenuSelect("threads");
    inspector.requestUpdate();
    await inspector.updateComplete;

    await vi.waitFor(() => {
      expect(threadListText(inspector)).toContain("Realtime thread sync");
    });

    const firstRow = inspector.shadowRoot
      ?.querySelector("cpk-thread-list")
      ?.shadowRoot?.querySelector<HTMLElement>(".cpk-tl__item");
    firstRow!.click();
    await inspector.updateComplete;

    await vi.waitFor(() => {
      expect(inspector.shadowRoot?.textContent ?? "").toContain(
        "Read the run as a story",
      );
    });

    const skip = Array.from(
      inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.trim() === "Skip");
    expect(skip).toBeDefined();
    skip!.click();
    await inspector.updateComplete;

    expect(stored.get("cpk:inspector:threads-example-tour:v1")).toContain(
      '"dismissed":true',
    );

    const secondInspector = new WebInspectorElement();
    document.body.appendChild(secondInspector);
    secondInspector.core =
      harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();
    const secondInternals = secondInspector as unknown as {
      isOpen: boolean;
      handleMenuSelect: (key: "threads") => void;
    };
    secondInternals.isOpen = true;
    secondInternals.handleMenuSelect("threads");
    await secondInspector.updateComplete;

    await vi.waitFor(() => {
      expect(threadListText(secondInspector)).toContain("Realtime thread sync");
    });

    const secondRow = secondInspector.shadowRoot
      ?.querySelector("cpk-thread-list")
      ?.shadowRoot?.querySelector<HTMLElement>(".cpk-tl__item");
    secondRow!.click();
    await secondInspector.updateComplete;

    await vi.waitFor(() => {
      expect(
        secondInspector.shadowRoot?.querySelector("cpk-thread-details"),
      ).not.toBeNull();
    });
    expect(secondInspector.shadowRoot?.textContent ?? "").not.toContain(
      "Read the run as a story",
    );
    expect(secondInspector.shadowRoot?.textContent ?? "").toContain(
      "Show tour",
    );

    const showTour = Array.from(
      secondInspector.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        "button",
      ) ?? [],
    ).find((button) => button.textContent?.trim() === "Show tour");
    expect(showTour).toBeDefined();
    showTour!.click();
    await secondInspector.updateComplete;

    await vi.waitFor(() => {
      expect(secondInspector.shadowRoot?.textContent ?? "").toContain(
        "Read the run as a story",
      );
    });
  });

  it("tracks example thread selection and tour dismissal telemetry", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, {}, {}, false);

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    const internals = inspector as unknown as {
      isOpen: boolean;
      selectedMenu: "home" | "threads";
      handleMenuSelect: (key: "threads") => void;
    };
    internals.isOpen = true;
    internals.selectedMenu = "threads";
    internals.handleMenuSelect("threads");
    inspector.requestUpdate();
    await inspector.updateComplete;

    await vi.waitFor(() => {
      expect(threadListText(inspector)).toContain("Realtime thread sync");
    });

    const firstRow = inspector.shadowRoot
      ?.querySelector("cpk-thread-list")
      ?.shadowRoot?.querySelector<HTMLElement>(".cpk-tl__item");
    firstRow!.click();
    await inspector.updateComplete;

    await vi.waitFor(() => {
      expect(inspector.shadowRoot?.textContent ?? "").toContain(
        "Read the run as a story",
      );
    });

    const skip = Array.from(
      inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.trim() === "Skip");
    skip!.click();
    await inspector.updateComplete;

    const posts = telemetryPosts();
    expect(
      posts.some(
        (post) => post.event === "oss.inspector.threads_example_selected",
      ),
    ).toBe(true);
    expect(
      posts.some(
        (post) => post.event === "oss.inspector.threads_example_tour_started",
      ),
    ).toBe(true);
    const stepViewed = posts.find(
      (post) => post.event === "oss.inspector.threads_example_tour_step_viewed",
    );
    expect(stepViewed?.properties).toMatchObject({
      example_kind: "realtime_sync",
      tour_step: 1,
    });
    const dismissed = posts.find(
      (post) => post.event === "oss.inspector.threads_example_tour_dismissed",
    );
    expect(dismissed?.properties).toMatchObject({
      example_kind: "realtime_sync",
      dismiss_method: "skip",
    });
  });
});
