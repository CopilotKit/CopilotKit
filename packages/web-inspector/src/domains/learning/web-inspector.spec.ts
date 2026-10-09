import type {
  CopilotKitCore,
  CopilotKitCoreSubscriber,
  Memory,
} from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebInspectorElement } from "../../index.js";
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
  it("does not probe the Memory store when the Learning tab opens", async () => {
    const core = makeCoreWithMemory([]);
    const spy = vi.spyOn(core, "getMemoryStore");
    await mountMemories(core);
    expect(spy).not.toHaveBeenCalled();
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
  it("renders the locked Learning overview when intelligence is absent", async () => {
    const core = makeCoreNoIntelligence();
    const el = await mountMemories(core);

    const root = requireShadowRoot(el);
    const locked = requireElement<HTMLElement>(
      root,
      '[data-inspector-locked-feature="memory"]',
    );
    expect(locked.textContent).toContain("Learning");
    expect(locked.textContent).toContain(
      "Turn every interaction into reusable context.",
    );
    expect(root.querySelector("cpk-memory-list")).toBeNull();
    expect(root.querySelector("cpk-learning-view")).toBeNull();
  });

  it("renders the setup landing when Intelligence is present but unlicensed", async () => {
    const core = makeCoreWithMemory([], { licenseStatus: "none" });
    const el = await mountMemories(core);

    expect(
      el.shadowRoot?.querySelector('[data-inspector-locked-feature="memory"]'),
    ).not.toBeNull();
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

    const talkToEngineer = requireElement<HTMLAnchorElement>(
      requireShadowRoot(el),
      'a[href^="https://www.copilotkit.ai/talk-to-an-engineer"]',
    );
    const url = new URL(talkToEngineer.href);
    expect(url.searchParams.get("ref")).toBeTruthy();
    expect(url.searchParams.has("utm_source")).toBe(false);
    expect(url.searchParams.has("utm_medium")).toBe(false);
    expect(url.searchParams.has("utm_campaign")).toBe(false);
  });

  it("renders the locked Learning overview when memories are unavailable", async () => {
    const core = makeCoreWithMemory([], { available: false });
    const el = await mountMemories(core);

    expect(
      el.shadowRoot?.querySelector('[data-inspector-locked-feature="memory"]'),
    ).not.toBeNull();
    expect(el.shadowRoot?.querySelector("cpk-memory-list")).toBeNull();
  });
});

// ── 6.6  Passive guard ────────────────────────────────────────────────────

describe("WebInspectorElement memories — passive store guard", () => {
  it("does NOT call core.getMemoryStore() merely by attaching the inspector", async () => {
    const core = makeCoreWithMemory([]);
    const spy = vi.spyOn(core, "getMemoryStore");

    const el = new WebInspectorElement();
    document.body.append(el);
    attachCore(el, core);
    const internals = getLearningInspectorInternals(el);
    internals.isOpen = true;
    await el.updateComplete;

    expect(spy).not.toHaveBeenCalled();

    internals.handleMenuSelect("memories");
    await el.updateComplete;

    expect(spy).not.toHaveBeenCalled();
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
  it("restores the Memories tab without probing the Memory store", async () => {
    installPersistedLearningSelection();
    const core = makeCoreWithMemory([], { realtimeStatus: "connected" });
    const spy = vi.spyOn(core, "getMemoryStore");

    const el = new WebInspectorElement();
    document.body.append(el);
    attachCore(el, core);
    const internals = getLearningInspectorInternals(el);
    internals.isOpen = true;
    await el.updateComplete;

    expect(internals.selectedMenu).toBe("memories");
    expect(spy).not.toHaveBeenCalled();
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
  it("does not throw when core lacks getMemoryStore, and renders the locked overview", async () => {
    const olderCore = makeOlderCore();

    const el = new WebInspectorElement();
    document.body.appendChild(el);

    expect(() => {
      attachCore(el, olderCore);
    }).not.toThrow();

    const internals = getLearningInspectorInternals(el);
    internals.isOpen = true;
    internals.handleMenuSelect("memories");
    await el.updateComplete;

    expect(
      el.shadowRoot?.querySelector('[data-inspector-locked-feature="memory"]'),
    ).not.toBeNull();
    expect(el.shadowRoot?.querySelector("cpk-memory-list")).toBeNull();
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
        memory_count: 0,
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
