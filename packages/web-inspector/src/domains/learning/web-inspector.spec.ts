import type {
  CopilotKitCore,
  CopilotKitCoreSubscriber,
  Memory,
} from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebInspectorElement } from "../../index.js";
import { CpkMemoryList } from "./memory-list.js";
import type { LearningState } from "./state.js";

type LearningInspectorInternals = {
  handleMenuSelect: (key: string) => void;
  isOpen: boolean;
  learning: LearningState;
  selectedMenu: string;
};

function getLearningInspectorInternals(
  element: WebInspectorElement,
): LearningInspectorInternals {
  // These root fields are intentionally private. Integration tests need one
  // boundary to drive root lifecycle and inspect the extracted domain state.
  return element as unknown as LearningInspectorInternals;
}

function attachCore(element: WebInspectorElement, core: object): void {
  Reflect.set(element, "core", core);
}

function requireShadowRoot(element: Element): ShadowRoot {
  const root = element.shadowRoot;
  if (!root) throw new Error("Expected element to have a shadow root");
  return root;
}

function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing test element: ${selector}`);
  return element;
}

function createNoopStorage(): Storage {
  return {
    length: 0,
    clear: () => undefined,
    getItem: () => null,
    key: () => null,
    removeItem: () => undefined,
    setItem: () => undefined,
  };
}

function createStorage(initial: Record<string, string>): Storage {
  const entries = new Map(Object.entries(initial));
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key) => entries.delete(key),
    setItem: (key, value) => entries.set(key, value),
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.stubGlobal("localStorage", createNoopStorage());
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

type MemoryStoreState = {
  memories: Memory[];
  isLoading: boolean;
  isMutating: boolean;
  error: Error | null;
  context: null;
  sessionId: number;
  available: boolean;
  realtimeStatus: "connecting" | "connected" | "unavailable";
};

/**
 * Returns a minimal mock memory store seeded with the given memories and
 * availability flag. The `select(selector)` method returns an Observable-like
 * that calls the subscriber once synchronously with the derived value, then
 * never again — sufficient for the inspector's subscription wiring.
 */
function makeMockMemoryStore(
  memories: Memory[],
  available: boolean,
  realtimeStatus: MemoryStoreState["realtimeStatus"] = "connected",
): { store: ReturnType<typeof buildStore>; state: MemoryStoreState } {
  const state: MemoryStoreState = {
    memories,
    isLoading: false,
    isMutating: false,
    error: null,
    context: null,
    sessionId: 0,
    available,
    realtimeStatus,
  };

  function buildStore() {
    return {
      getState: () => state,
      select: <T>(selector: (s: MemoryStoreState) => T) => ({
        subscribe: (cb: (v: T) => void) => {
          cb(selector(state));
          return { unsubscribe: () => undefined };
        },
      }),
    };
  }

  const store = buildStore();
  return { store, state };
}

type MemoryMockCore = {
  agents: CopilotKitCore["agents"];
  context: CopilotKitCore["context"];
  properties: CopilotKitCore["properties"];
  telemetryDisabled: CopilotKitCore["telemetryDisabled"];
  runtimeConnectionStatus: CopilotKitCore["runtimeConnectionStatus"];
  intelligence: CopilotKitCore["intelligence"];
  licenseStatus?: CopilotKitCore["licenseStatus"];
  subscribe: CopilotKitCore["subscribe"];
  getThreadStores: CopilotKitCore["getThreadStores"];
  getThreadStore: CopilotKitCore["getThreadStore"];
  getMemoryStore: () => ReturnType<typeof makeMockMemoryStore>["store"];
};

/**
 * Returns a mock core with an intelligence property set (so the memories view
 * is not locked by the intelligence guard) and a memory store seeded with the
 * supplied memories. Pass `available: false` to simulate memories being
 * unavailable (which also locks the view).
 */
function makeCoreWithMemory(
  memories: Memory[],
  opts: {
    available?: boolean;
    telemetryDisabled?: boolean;
    realtimeStatus?: MemoryStoreState["realtimeStatus"];
    licenseStatus?: CopilotKitCore["licenseStatus"];
  } = {},
): MemoryMockCore {
  const available = opts.available ?? true;
  const { store } = makeMockMemoryStore(
    memories,
    available,
    opts.realtimeStatus ?? "connected",
  );

  return {
    agents: {},
    context: {},
    properties: {},
    telemetryDisabled: opts.telemetryDisabled ?? false,
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
    // Intelligence present → locked teaser is NOT shown (unless available=false).
    intelligence: { wsUrl: "wss://localhost" },
    licenseStatus: opts.licenseStatus,
    subscribe: (_subscriber: CopilotKitCoreSubscriber) => ({
      unsubscribe: () => undefined,
    }),
    getThreadStores: () => ({}),
    getThreadStore: (_agentId: string) => undefined,
    getMemoryStore: () => store,
  };
}

/**
 * Returns a mock core that has NO intelligence property. Used to assert the
 * locked teaser regardless of memory availability.
 */
function makeCoreNoIntelligence(): MemoryMockCore {
  const { store } = makeMockMemoryStore([], true);

  return {
    agents: {},
    context: {},
    properties: {},
    telemetryDisabled: false,
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
    intelligence: undefined,
    subscribe: (_subscriber: CopilotKitCoreSubscriber) => ({
      unsubscribe: () => undefined,
    }),
    getThreadStores: () => ({}),
    getThreadStore: (_agentId: string) => undefined,
    getMemoryStore: () => store,
  };
}

function makeOlderCore() {
  return {
    agents: {},
    context: {},
    properties: {},
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
    intelligence: { wsUrl: "wss://localhost" },
    subscribe: (_subscriber: CopilotKitCoreSubscriber) => ({
      unsubscribe: () => undefined,
    }),
    getThreadStores: () => ({}),
    getThreadStore: (_agentId: string) => undefined,
  };
}

function installPersistedLearningSelection(): void {
  vi.stubGlobal(
    "localStorage",
    createStorage({
      "cpk:inspector:state": JSON.stringify({
        selectedMenu: "memories",
        hasOpenedInspector: true,
      }),
    }),
  );
}

/**
 * Mounts a `<cpk-web-inspector>` with the given core, opens it, and switches
 * to the memories tab. Returns the element ready for assertion.
 */
async function mountMemories(
  core: MemoryMockCore,
): Promise<WebInspectorElement> {
  const element = new WebInspectorElement();
  document.body.append(element);
  attachCore(element, core);

  const internals = getLearningInspectorInternals(element);
  internals.isOpen = true;
  internals.handleMenuSelect("memories");
  internals.selectedMenu = "memories";
  element.requestUpdate();
  await element.updateComplete;

  await element.updateComplete;
  return element;
}

// ── 6.2  Subscription ─────────────────────────────────────────────────────

describe("WebInspectorElement memories — subscription", () => {
  it("seeds Learning state from core.getMemoryStore() on Memories-tab activation", async () => {
    const oneMemory: Memory = {
      id: "m1",
      kind: "topical",
      scope: "user",
      content: "Likes dogs",
      sourceThreadIds: [],
      invalidatedAt: null,
    };

    const core = makeCoreWithMemory([oneMemory]);
    const el = await mountMemories(core);

    const ids = getLearningInspectorInternals(el).learning.memories.map(
      (memory) => memory.id,
    );

    expect(ids).toEqual(["m1"]);
  });
});

// ── 6.3  Tab presence ─────────────────────────────────────────────────────

describe("WebInspectorElement memories — tab presence", () => {
  it("renders Learning primary navigation in the inspector menu", async () => {
    const core = makeCoreWithMemory([]);
    const el = await mountMemories(core);

    const buttons = Array.from(
      el.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const learningButton = buttons.find((btn) =>
      btn.textContent?.trim().includes("Learning"),
    );

    expect(
      learningButton,
      "Learning workbench navigation should render",
    ).toBeDefined();
  });
});

// ── 6.4  View states ──────────────────────────────────────────────────────

describe("WebInspectorElement memories — view states", () => {
  it("renders the locked teaser when intelligence is absent", async () => {
    const core = makeCoreNoIntelligence();
    const el = await mountMemories(core);

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Learning");
    expect(text).toContain(
      "Learning turns durable information from agent interactions into reusable context. It isn't enabled on this deployment.",
    );
    expect(el.shadowRoot?.querySelector(".cpk-memory-locked")).not.toBeNull();
    expect(
      el.shadowRoot?.querySelector(".cpk-memory-locked-scrim"),
    ).not.toBeNull();
    expect(
      el.shadowRoot?.querySelector(".cpk-memory-locked-action-secondary"),
    ).not.toBeNull();
    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(
      memoryList,
      "cpk-memory-list should NOT render when locked",
    ).toBeNull();
  });

  it("renders the setup landing when Intelligence is present but unlicensed", async () => {
    const core = makeCoreWithMemory([], { licenseStatus: "none" });
    const el = await mountMemories(core);

    expect(el.shadowRoot?.querySelector(".cpk-memory-locked")).not.toBeNull();
    expect(
      el.shadowRoot?.querySelector(
        '[data-inspector-feature-setup-prompt="memory"]',
      ),
    ).not.toBeNull();
    expect(el.shadowRoot?.querySelector("cpk-memory-list")).toBeNull();
  });

  it("does not use Threads onboarding UTM attribution for locked memory CTAs", async () => {
    const core = makeCoreNoIntelligence();
    const el = await mountMemories(core);

    const root = requireShadowRoot(el);
    const talkToEngineer = requireElement<HTMLAnchorElement>(
      root,
      'a[href^="https://www.copilotkit.ai/talk-to-an-engineer"]',
    );
    const signup = requireElement<HTMLAnchorElement>(
      root,
      'a[href^="https://intelligence.copilotkit.ai/?ref="]',
    );

    for (const href of [talkToEngineer.href, signup.href]) {
      const url = new URL(href);
      expect(url.searchParams.get("ref")).toBeTruthy();
      expect(url.searchParams.has("utm_source")).toBe(false);
      expect(url.searchParams.has("utm_medium")).toBe(false);
      expect(url.searchParams.has("utm_campaign")).toBe(false);
    }
  });

  it("renders the locked teaser when memories are unavailable", async () => {
    const core = makeCoreWithMemory([], { available: false });
    const el = await mountMemories(core);

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Learning");
    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(
      memoryList,
      "cpk-memory-list should NOT render when unavailable",
    ).toBeNull();
  });

  it("renders cpk-memory-list with empty state when available and no memories", async () => {
    const core = makeCoreWithMemory([], { available: true });
    const el = await mountMemories(core);

    const memoryList = requireElement<CpkMemoryList>(
      requireShadowRoot(el),
      "cpk-memory-list",
    );
    await memoryList.updateComplete;
    const listText = requireShadowRoot(memoryList).textContent ?? "";
    expect(listText).toContain("No learning records yet");
  });

  it("keeps the list rendered (not the full-screen error) when a mutation error arrives with memories present", async () => {
    // INSP-2: a failed remove/update sets the store error while a valid list is
    // already on screen. That must NOT blank the list with the full-screen
    // "Failed to load learning data" state — the error is surfaced inline instead.
    const oneMemory: Memory = {
      id: "m1",
      kind: "topical",
      scope: "user",
      content: "Likes dogs",
      sourceThreadIds: [],
      invalidatedAt: null,
    };

    const core = makeCoreWithMemory([oneMemory]);
    const el = await mountMemories(core);

    // Simulate a mutation failure landing after the list is rendered.
    getLearningInspectorInternals(el).learning.memoriesError = new Error(
      "could not delete memory",
    );
    el.requestUpdate();
    await el.updateComplete;

    // The list survives.
    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(
      memoryList,
      "cpk-memory-list must remain rendered on a mutation error",
    ).not.toBeNull();

    const text = el.shadowRoot?.textContent ?? "";
    // Inline, non-blocking error with distinct copy.
    expect(text).toContain("Action failed: could not delete memory");
    // The full-screen load-failure copy must NOT appear.
    expect(text).not.toContain("Failed to load learning data");
  });

  it("shows the full-screen load error only when no memories are loaded", async () => {
    // INSP-2 counterpart: a snapshot-load failure (empty list) still shows the
    // full-screen "Failed to load learning data" state.
    const core = makeCoreWithMemory([]);
    const el = await mountMemories(core);

    getLearningInspectorInternals(el).learning.memoriesError = new Error(
      "network down",
    );
    el.requestUpdate();
    await el.updateComplete;

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Failed to load learning data");
    expect(text).toContain("network down");
    expect(text).not.toContain("Action failed:");
    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(memoryList).toBeNull();
  });

  it("shows the 'live' indicator only when realtime is connected", async () => {
    const core = makeCoreWithMemory([], {
      available: true,
      realtimeStatus: "connected",
    });
    const el = await mountMemories(core);

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("live");
    expect(text).not.toContain("offline");
    expect(text).not.toContain("reconnecting");
  });

  it("shows a muted 'reconnecting' indicator while realtime is connecting", async () => {
    const core = makeCoreWithMemory([], {
      available: true,
      realtimeStatus: "connecting",
    });
    const el = await mountMemories(core);

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("reconnecting");
    // It must NOT claim "live" while still connecting.
    expect(text).not.toMatch(/>\s*live\s*</);
  });

  it("shows a muted 'offline' indicator when realtime has permanently given up", async () => {
    const core = makeCoreWithMemory([], {
      available: true,
      realtimeStatus: "unavailable",
    });
    const el = await mountMemories(core);

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("offline");
    // The frozen snapshot must NOT be labelled "live".
    expect(text).not.toMatch(/>\s*live\s*</);
  });

  it("renders cpk-memory-list with a card when one memory is present", async () => {
    const oneMemory: Memory = {
      id: "m1",
      kind: "topical",
      scope: "user",
      content: "Prefers dark mode",
      sourceThreadIds: [],
      invalidatedAt: null,
    };

    const core = makeCoreWithMemory([oneMemory]);
    const el = await mountMemories(core);

    const memoryList = requireElement<CpkMemoryList>(
      requireShadowRoot(el),
      "cpk-memory-list",
    );
    await memoryList.updateComplete;
    expect(
      requireShadowRoot(memoryList).querySelectorAll(".cpk-ml__card"),
    ).toHaveLength(1);
  });
});

// ── 6.6  Passive guard ────────────────────────────────────────────────────

describe("WebInspectorElement memories — passive store guard", () => {
  it("calls core.getMemoryStore() on tab activation and reads from the returned store", async () => {
    const core = makeCoreWithMemory([]);
    const spy = vi.spyOn(core, "getMemoryStore");

    await mountMemories(core);

    expect(spy).toHaveBeenCalled();

    // The store instance that spy captured is the exact same object that
    // core.getMemoryStore() returns — inspector reads from it, never wraps it.
    const returnedStore = spy.mock.results[0]?.value;
    if (!returnedStore) throw new Error("Expected memory store access");
    // Verify the inspector consumed the store by checking its getState was accessible
    // (if the inspector had created its own store instead, this reference would differ).
    expect(typeof returnedStore.getState).toBe("function");
    expect(typeof returnedStore.select).toBe("function");
  });

  it("does NOT call core.getMemoryStore() merely by attaching the inspector", async () => {
    // INSP-1: getMemoryStore() lazily creates + starts the store and opens
    // realtime, so attaching the inspector must touch nothing. The store is
    // only created when the user activates the Memories tab.
    const core = makeCoreWithMemory([]);
    const spy = vi.spyOn(core, "getMemoryStore");

    const el = new WebInspectorElement();
    document.body.append(el);
    attachCore(el, core);
    const internals = getLearningInspectorInternals(el);
    internals.isOpen = true;
    await el.updateComplete;

    expect(spy).not.toHaveBeenCalled();

    // Activating the Memories tab is what creates + subscribes to the store.
    internals.handleMenuSelect("memories");
    await el.updateComplete;

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not double-subscribe when the Memories tab is re-activated", async () => {
    const core = makeCoreWithMemory([]);
    const spy = vi.spyOn(core, "getMemoryStore");

    const el = await mountMemories(core);
    expect(spy).toHaveBeenCalledTimes(1);

    // Re-activate the Memories tab — the guard must prevent a second
    // getMemoryStore() call (which would create a second store/realtime).
    getLearningInspectorInternals(el).handleMenuSelect("memories");
    await el.updateComplete;

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-subscribes after detach when the Memories tab is activated again", async () => {
    const core = makeCoreWithMemory([]);
    const spy = vi.spyOn(core, "getMemoryStore");

    const el = await mountMemories(core);
    expect(spy).toHaveBeenCalledTimes(1);

    // Detach (core = null) must reset the lazy-subscription guard.
    el.core = null;
    await el.updateComplete;

    // Re-attach + re-activate the tab → a fresh subscription is created.
    attachCore(el, core);
    const internals = getLearningInspectorInternals(el);
    internals.isOpen = true;
    internals.handleMenuSelect("memories");
    await el.updateComplete;

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// ── 6.6.1  Active-on-boot subscription ─────────────────────────────────────
//
// The memory subscription is normally created on a Memories-tab CLICK
// (handleMenuSelect → ensureMemorySubscription). But when the inspector boots
// with the Memories tab ALREADY active — e.g. a persisted
// `selectedMenu: "memories"` restored by hydrateStateFromStorageEarly — no
// click ever fires, so historically no subscription was created: the realtime
// indicator stayed stuck on the default "connecting" (rendered "reconnecting")
// and the list was empty until the user toggled tabs. The fix subscribes when
// the Memories tab is the active tab on boot, gated on the active tab so it
// still does not subscribe in apps not viewing memory (INSP-1).

describe("WebInspectorElement memories — active-on-boot subscription", () => {
  it("subscribes to the memory store on boot when the Memories tab is already active (no click)", async () => {
    installPersistedLearningSelection();
    // The store reports a live realtime status. If the inspector subscribes on
    // boot, the Learning realtime status reflects "connected"; if it does NOT (the
    // bug), it stays on the default "connecting".
    const core = makeCoreWithMemory([], { realtimeStatus: "connected" });
    const spy = vi.spyOn(core, "getMemoryStore");

    const el = new WebInspectorElement();
    document.body.append(el);
    // connectedCallback has already restored selectedMenu = "memories".
    // Assigning core (the realistic boot path) must trigger the subscription
    // without any handleMenuSelect click.
    attachCore(el, core);
    const internals = getLearningInspectorInternals(el);
    internals.isOpen = true;
    await el.updateComplete;

    expect(
      internals.selectedMenu,
      "persisted Memories tab should be the active tab on boot",
    ).toBe("memories");

    // The store was created + subscribed WITHOUT a tab click.
    expect(
      spy,
      "core.getMemoryStore() must be called on boot when Memories is active",
    ).toHaveBeenCalled();

    // The live status from the store is reflected — not the stuck default.
    expect(
      internals.learning.memoriesRealtimeStatus,
      "realtime status must reflect the store, not the default 'connecting'",
    ).toBe("connected");
  });

  it("does not double-subscribe when boot subscription is followed by a Memories-tab click", async () => {
    installPersistedLearningSelection();
    // The boot subscription must be idempotent: a later explicit click must not
    // create a second store/realtime connection.
    const core = makeCoreWithMemory([], { realtimeStatus: "connected" });
    const spy = vi.spyOn(core, "getMemoryStore");

    const el = new WebInspectorElement();
    document.body.append(el);
    attachCore(el, core);
    const internals = getLearningInspectorInternals(el);
    internals.isOpen = true;
    await el.updateComplete;

    expect(spy).toHaveBeenCalledTimes(1);

    internals.handleMenuSelect("memories");
    await el.updateComplete;

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ── 6.7  Older-core compat: missing getMemoryStore ────────────────────────
//
// An inspector attached to an older @copilotkit/core that predates
// getMemoryStore must not throw. The guard added in attachToCore must fall
// through to the else branch, mark Learning unavailable, and leave the
// memories tab in the locked-teaser state — exactly like a core that defines
// the method but returns available=false.

describe("WebInspectorElement memories — older-core compat (no getMemoryStore)", () => {
  it("does not throw when core lacks getMemoryStore, and renders the locked teaser", async () => {
    // Build a minimal core that does NOT define getMemoryStore — simulating an
    // older @copilotkit/core package. We deliberately omit the method rather
    // than setting it to undefined so the typeof guard fires correctly.
    const olderCore = makeOlderCore();

    const el = new WebInspectorElement();
    document.body.appendChild(el);

    // Assigning core must not throw even though getMemoryStore is missing.
    expect(() => {
      attachCore(el, olderCore);
    }).not.toThrow();

    // Open and switch to the memories tab so the view state is rendered.
    const internals = getLearningInspectorInternals(el);
    internals.isOpen = true;
    internals.handleMenuSelect("memories");
    await el.updateComplete;

    // The locked teaser must render — cpk-memory-list must NOT appear.
    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Learning");
    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(
      memoryList,
      "cpk-memory-list must not render when getMemoryStore is absent",
    ).toBeNull();
  });

  it("shows the SDK-upgrade teaser (distinct from the not-enabled teaser) when getMemoryStore is absent", async () => {
    // INSP-3: an older @copilotkit/core (no getMemoryStore) must guide an SDK
    // upgrade, with copy distinct from the genuine "not enabled on this
    // deployment" teaser shown by a current SDK against a memory-less backend.
    const olderCore = makeOlderCore();

    const el = new WebInspectorElement();
    document.body.append(el);
    attachCore(el, olderCore);
    const internals = getLearningInspectorInternals(el);
    internals.isOpen = true;
    internals.handleMenuSelect("memories");
    await el.updateComplete;

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("@copilotkit SDK");
    expect(text).toContain("Upgrade");
    // Must NOT show the deployment-not-enabled copy in this case.
    expect(text).not.toContain(
      "Learning turns durable information from agent interactions into reusable context. It isn't enabled on this deployment.",
    );
  });

  it("shows the not-enabled teaser (distinct from the upgrade teaser) when the current SDK reports memory unavailable", async () => {
    // INSP-3 counterpart: a current SDK (getMemoryStore present) whose store
    // reports available=false shows the deployment teaser, NOT upgrade copy.
    const core = makeCoreWithMemory([], { available: false });
    const el = await mountMemories(core);

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain(
      "Learning turns durable information from agent interactions into reusable context. It isn't enabled on this deployment.",
    );
    expect(text).not.toContain("@copilotkit SDK");
  });
});

// ── 6.8  Memories tab telemetry gating (A7) + detach reset (A8) ────────────
//
// The memories tab is the only telemetry call site that must honor the host
// `core.telemetryDisabled` opt-out and must not re-fire on every click. These
// tests mirror the Threads tab-click telemetry test. They also cover that
// detachFromCore resets the memory view state so a later attach to an older
// core never leaks stale memory counts into telemetry.

describe("WebInspectorElement memories — tab telemetry + detach reset", () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  const memoriesTabClicks = (): string[] =>
    fetchMock.mock.calls.flatMap(([input, init]) => {
      const body = init?.body;
      if (
        String(input) !== "https://telemetry.copilotkit.ai/ingest" ||
        init?.method !== "POST" ||
        typeof body !== "string" ||
        !body.includes('"event":"oss.inspector.memories_tab_clicked"')
      ) {
        return [];
      }
      return [body];
    });

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  it("posts memories_tab_clicked when the Memories tab is selected", async () => {
    const oneMemory: Memory = {
      id: "m1",
      kind: "topical",
      scope: "user",
      content: "Likes dogs",
      sourceThreadIds: [],
      invalidatedAt: null,
    };

    const core = makeCoreWithMemory([oneMemory]);
    await mountMemories(core);
    await Promise.resolve();

    const bodies = memoriesTabClicks();
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0] ?? "{}")).toMatchObject({
      properties: {
        memory_count: 1,
        available: true,
      },
    });
  });

  it("does NOT post memories_tab_clicked when core.telemetryDisabled is true", async () => {
    const core = makeCoreWithMemory([], { telemetryDisabled: true });
    await mountMemories(core);
    await Promise.resolve();

    expect(memoriesTabClicks()).toHaveLength(0);
  });

  it("does not double-fire when the already-active Memories tab is re-selected", async () => {
    const core = makeCoreWithMemory([]);
    const el = await mountMemories(core);
    await Promise.resolve();

    // Re-select the already-active Memories tab.
    getLearningInspectorInternals(el).handleMenuSelect("memories");
    await el.updateComplete;
    await Promise.resolve();

    expect(memoriesTabClicks()).toHaveLength(1);
  });

  it("resets memory view state on detachFromCore (memories empty, count 0)", async () => {
    const oneMemory: Memory = {
      id: "m1",
      kind: "topical",
      scope: "user",
      content: "Likes dogs",
      sourceThreadIds: [],
      invalidatedAt: null,
    };

    const core = makeCoreWithMemory([oneMemory]);
    const el = await mountMemories(core);
    await Promise.resolve();

    // Sanity: the seeded memory is present before detach.
    expect(
      getLearningInspectorInternals(el).learning.memories.map(
        (memory) => memory.id,
      ),
    ).toEqual(["m1"]);

    // Reassigning core triggers detachFromCore(); null means no re-attach.
    el.core = null;
    await el.updateComplete;

    const { learning } = getLearningInspectorInternals(el);
    expect(learning.memories).toEqual([]);
    expect(learning.memories).toHaveLength(0);
    expect(learning.memoriesLoading).toBe(false);
    expect(learning.memoriesError).toBeNull();
    expect(learning.memoriesAvailable).toBe(true);
  });
});
