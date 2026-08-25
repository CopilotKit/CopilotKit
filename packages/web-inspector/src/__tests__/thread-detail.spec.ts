import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectThreadsIsLoading,
} from "@copilotkit/core";
import type { ɵThreadStore } from "@copilotkit/core";
import type { ThreadEndpointRuntimeInfo } from "@copilotkit/shared";
import { expect, test, vi } from "vitest";

import { CpkThreadInspector, WebInspectorElement } from "../index.js";
import type {
  ThreadDebuggerMetadata,
  ThreadDebuggerProvider,
} from "../index.js";

const RUNTIME_URL = "https://runtime.example.test";
const AGENT_ID = "thread-detail-agent";
const TOUR_STORAGE_KEY = "cpk:inspector:threads-example-tour:v1";

const ENABLED_ENDPOINTS = {
  list: true,
  inspect: true,
  mutations: false,
  realtimeMetadata: false,
} satisfies ThreadEndpointRuntimeInfo;

const THREAD_ROUTES = [
  "list",
  "subscribe",
  "inspect",
  "messages",
  "events",
  "state",
] as const;

type ThreadRoute = (typeof THREAD_ROUTES)[number];
type ThreadRoutes = Readonly<Record<ThreadRoute, number>>;

const ZERO_ROUTES = {
  list: 0,
  subscribe: 0,
  inspect: 0,
  messages: 0,
  events: 0,
  state: 0,
} as const satisfies ThreadRoutes;

type HeaderFact = Readonly<{ label: string; value: string }>;

type ExampleHarness = Readonly<{
  inspector: WebInspectorElement;
  core: ExampleTestCore;
  store: ɵThreadStore;
  routes: () => ThreadRoutes;
  flush: () => Promise<void>;
  rows: () => HTMLButtonElement[];
  details: () => CpkThreadInspector;
  selectExample: (name: string) => Promise<CpkThreadInspector>;
  teardown: () => Promise<void>;
}>;

class ExampleTestCore extends CopilotKitCore {
  constructor() {
    super({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
  }

  override get threadEndpoints(): ThreadEndpointRuntimeInfo {
    return ENABLED_ENDPOINTS;
  }

  override get telemetryDisabled(): boolean {
    return true;
  }

  async emitConnected(): Promise<void> {
    await this.notifySubscribers(
      (subscriber) =>
        subscriber.onRuntimeConnectionStatusChanged?.({
          copilotkit: this,
          status: CopilotKitCoreRuntimeConnectionStatus.Connected,
        }),
      "Thread detail test runtime subscriber failed",
    );
  }
}

function installImmediateAnimationFrame(): void {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
}

function prepareDom(): void {
  document.body.replaceChildren();
  document.getElementById("cpk-inspector-brand-fonts")?.remove();
  window.localStorage.clear();
  window.sessionStorage.clear();
  installImmediateAnimationFrame();
}

async function flushDetail(detail: CpkThreadInspector): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) {
    await Promise.resolve();
    await detail.updateComplete;
  }
}

async function flushInspector(inspector: WebInspectorElement): Promise<void> {
  for (let turn = 0; turn < 7; turn += 1) {
    await Promise.resolve();
    await inspector.updateComplete;
    const detail =
      inspector.shadowRoot?.querySelector<CpkThreadInspector>(
        "cpk-thread-details",
      );
    if (detail) await detail.updateComplete;
  }
}

function appendDetail(options: {
  threadId: string;
  provider?: ThreadDebuggerProvider;
  thread?: ThreadDebuggerMetadata;
}): CpkThreadInspector {
  const detail = new CpkThreadInspector();
  detail.threadId = options.threadId;
  detail.provider = options.provider ?? null;
  detail.thread = options.thread ?? null;
  document.body.append(detail);
  return detail;
}

function detailTabs(detail: CpkThreadInspector): HTMLButtonElement[] {
  return Array.from(
    detail.shadowRoot?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ??
      [],
  );
}

function requireTab(
  detail: CpkThreadInspector,
  label: string,
): HTMLButtonElement {
  const tab = detailTabs(detail).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(tab, `${label} tab`).not.toBeUndefined();
  if (!tab) throw new Error(`${label} tab was not rendered`);
  return tab;
}

async function selectTab(
  detail: CpkThreadInspector,
  label: string,
): Promise<HTMLButtonElement> {
  requireTab(detail, label).click();
  await flushDetail(detail);
  return requireTab(detail, label);
}

function headerFacts(detail: CpkThreadInspector): HeaderFact[] {
  const header = detail.shadowRoot?.querySelector<HTMLElement>(
    '[aria-label="Thread metadata"]',
  );
  expect(header, "thread metadata header").not.toBeNull();
  if (!header) throw new Error("Thread metadata header was not rendered");
  return Array.from(
    header.querySelectorAll<HTMLElement>(".cpk-td__metadata-pill"),
  ).map((pill) => ({
    label:
      pill
        .querySelector<HTMLElement>(".cpk-td__metadata-label")
        ?.textContent?.trim() ?? "",
    value:
      pill
        .querySelector<HTMLElement>(".cpk-td__metadata-value")
        ?.textContent?.trim() ?? "",
  }));
}

function expectedTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function selectedTab(detail: CpkThreadInspector): HTMLButtonElement {
  const selected = detailTabs(detail).find(
    (tab) => tab.getAttribute("aria-selected") === "true",
  );
  expect(selected, "selected Thread detail tab").not.toBeUndefined();
  if (!selected) throw new Error("No Thread detail tab was selected");
  return selected;
}

function mountedPanels(detail: CpkThreadInspector): HTMLElement[] {
  return Array.from(
    detail.shadowRoot?.querySelectorAll<HTMLElement>('[role="tabpanel"]') ?? [],
  );
}

function dispatchNavigationKey(
  tab: HTMLButtonElement,
  key: string,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  tab.dispatchEvent(event);
  return event;
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(
    input instanceof Request ? input.url : String(input),
    window.location.href,
  );
}

function classifyThreadRoute(url: URL): ThreadRoute | null {
  if (url.pathname.endsWith("/threads/subscribe")) return "subscribe";
  if (/\/threads\/[^/]+\/messages$/.test(url.pathname)) return "messages";
  if (/\/threads\/[^/]+\/events$/.test(url.pathname)) return "events";
  if (/\/threads\/[^/]+\/state$/.test(url.pathname)) return "state";
  if (/\/threads\/[^/]+$/.test(url.pathname)) return "inspect";
  if (url.pathname.endsWith("/threads")) return "list";
  return null;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function responseForRoute(route: ThreadRoute): Response {
  if (route === "list") return jsonResponse({ threads: [], joinCode: null });
  if (route === "messages") return jsonResponse({ messages: [] });
  if (route === "events") return jsonResponse({ events: [] });
  if (route === "state") return jsonResponse({ state: {} });
  if (route === "inspect") return jsonResponse({ thread: null });
  return new Response(null, { status: 404 });
}

async function setupExampleHarness(): Promise<ExampleHarness> {
  prepareDom();
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
  vi.stubGlobal(
    "requestIdleCallback",
    vi.fn(() => 700),
  );
  vi.stubGlobal("cancelIdleCallback", vi.fn());
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    () => undefined,
  );
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(
    () => undefined,
  );

  const routeCounts: Record<ThreadRoute, number> = { ...ZERO_ROUTES };
  const currentFetch = globalThis.fetch;
  const fetchMock = Object.assign(
    vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = requestUrl(input);
      if (url.href === "https://cdn.copilotkit.ai/announcements.json") {
        return new Response(null, { status: 404 });
      }
      const route = classifyThreadRoute(url);
      if (!route) {
        throw new Error(`Unexpected Thread detail request: ${url.href}`);
      }
      routeCounts[route] += 1;
      return responseForRoute(route);
    }),
    currentFetch,
  );
  vi.stubGlobal("fetch", fetchMock);

  const store = ɵcreateThreadStore({ fetch: fetchMock });
  store.start();
  store.setContext({
    runtimeUrl: RUNTIME_URL,
    headers: {},
    agentId: AGENT_ID,
  });
  await vi.waitFor(() => {
    expect(ɵselectThreadsIsLoading(store.getState())).toBe(false);
  });

  const core = new ExampleTestCore();
  core.registerThreadStore(AGENT_ID, store);
  const inspector = new WebInspectorElement();
  document.body.append(inspector);
  inspector.core = core;
  await core.emitConnected();
  await flushInspector(inspector);

  const opener = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
    'button[aria-label^="Web Inspector"]',
  );
  if (!opener) throw new Error("Web Inspector opener was not rendered");
  opener.click();
  await flushInspector(inspector);
  const threads = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
    'button[data-inspector-menu-key="threads"]',
  );
  if (!threads) throw new Error("Threads group was not rendered");
  threads.click();
  await flushInspector(inspector);

  const rows = (): HTMLButtonElement[] => {
    const list = inspector.shadowRoot?.querySelector("cpk-thread-list");
    return Array.from(
      list?.shadowRoot?.querySelectorAll<HTMLButtonElement>(".cpk-tl__item") ??
        [],
    );
  };
  await vi.waitFor(() => expect(rows()).toHaveLength(3));

  const details = (): CpkThreadInspector => {
    const detail =
      inspector.shadowRoot?.querySelector<CpkThreadInspector>(
        "cpk-thread-details",
      );
    if (!detail) throw new Error("Thread details were not rendered");
    return detail;
  };

  return {
    inspector,
    core,
    store,
    routes: () => ({ ...routeCounts }),
    flush: () => flushInspector(inspector),
    rows,
    details,
    async selectExample(name) {
      const row = rows().find((candidate) =>
        candidate.textContent?.includes(name),
      );
      if (!row) throw new Error(`Example row was not rendered: ${name}`);
      row.click();
      await flushInspector(inspector);
      const detail = details();
      await vi.waitFor(() => {
        expect(headerFacts(detail).map((fact) => fact.label)).toContain(
          "Created",
        );
      });
      return detail;
    },
    async teardown() {
      inspector.remove();
      core.unregisterThreadStore(AGENT_ID);
      store.stop();
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

function requireButton(root: ShadowRoot, label: string): HTMLButtonElement {
  const button = Array.from(
    root.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.trim() === label);
  expect(button, `${label} button`).not.toBeUndefined();
  if (!button) throw new Error(`${label} button was not rendered`);
  return button;
}

function expectNoMutationControls(
  inspector: WebInspectorElement | undefined,
  detail: CpkThreadInspector,
): void {
  const labels = [
    ...Array.from(
      inspector?.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ??
        [],
    ),
    ...Array.from(
      detail.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ),
  ].map((button) => button.textContent?.trim() ?? "");
  for (const mutation of ["Rename", "Archive", "Delete", "Restore"]) {
    expect(labels).not.toContain(mutation);
  }
}

test("real metadata renders the exact labels, full identity, and supplied optional facts", async () => {
  prepareDom();
  const threadId = "thread-real-1234567890-abcdefghijklmnopqrstuvwxyz";
  const createdAt = "2026-06-25T10:00:00.000Z";
  const updatedAt = "2026-06-25T10:05:06.000Z";
  const provider: ThreadDebuggerProvider = {
    getThreadMetadata: vi.fn().mockResolvedValue({
      id: threadId,
      name: "Provider name",
      agentId: "agent-real",
      endUserId: "account-user-must-not-be-in-header",
      createdById: "creator-must-not-be-in-header",
      status: "active-must-not-be-in-header",
      createdAt,
      updatedAt,
    }),
    getEvents: vi.fn().mockResolvedValue([]),
  };
  const detail = appendDetail({
    threadId,
    provider,
    thread: { id: threadId, name: "Row name" },
  });
  try {
    await vi.waitFor(() => {
      expect(headerFacts(detail)).toEqual([
        { label: "Name", value: "Provider name" },
        { label: "ID", value: threadId },
        { label: "Agent", value: "agent-real" },
        { label: "Created", value: expectedTime(createdAt) },
        { label: "Updated", value: expectedTime(updatedAt) },
      ]);
    });

    const header = detail.shadowRoot?.querySelector<HTMLElement>(
      '[aria-label="Thread metadata"]',
    );
    expect(header?.getAttribute("role")).toBe("group");
    expect(header?.getAttribute("aria-label")).toBe("Thread metadata");
    expect(header?.textContent).not.toContain("End user");
    expect(header?.textContent).not.toContain("Created by");
    expect(header?.textContent).not.toContain("Status");
    expect(header?.textContent).toContain(threadId);
    const renderedStyle =
      detail.shadowRoot?.querySelector("style")?.textContent;
    if (!renderedStyle)
      throw new Error("Thread detail styles were not rendered");
    const parserStyle = document.createElement("style");
    parserStyle.textContent = renderedStyle;
    document.head.append(parserStyle);
    try {
      const styleRules = Array.from(parserStyle.sheet?.cssRules ?? []).filter(
        (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule,
      );
      for (const selector of [
        ".cpk-td__tab",
        ".cpk-td__metadata-label",
        ".cpk-td__timeline-time",
        ".cpk-td__event-time",
        ".cpk-tdp__section-title",
        ".cpk-tdp__label",
      ]) {
        const rule = styleRules.find(
          (candidate) => candidate.selectorText === selector,
        );
        expect(rule?.style.color, selector).toBe("rgb(104, 104, 110)");
      }
    } finally {
      parserStyle.remove();
    }
    const namedIdFact = detail.shadowRoot?.querySelector<HTMLElement>(
      `[role="group"][aria-label="ID: ${threadId}"]`,
    );
    expect(namedIdFact).not.toBeNull();
    expect(namedIdFact?.textContent).toContain(threadId);
    expect(
      header?.parentElement
        ?.querySelector(".cpk-td__empty-hint")
        ?.textContent?.replace(/\s+/g, " ")
        .trim(),
    ).toBe(
      "Timeline rows are normalized from AG-UI events. Open AG-UI Events or State to inspect the available thread data.",
    );

    detail.shadowRoot
      ?.querySelector<HTMLButtonElement>(".cpk-td__panel-toggle")
      ?.click();
    await flushDetail(detail);
    const idRow = Array.from(
      detail.shadowRoot?.querySelectorAll<HTMLElement>(".cpk-tdp__row") ?? [],
    ).find(
      (row) =>
        row.querySelector(".cpk-tdp__label")?.textContent?.trim() === "ID",
    );
    expect(idRow?.querySelector(".cpk-tdp__value")?.textContent?.trim()).toBe(
      threadId,
    );
    expectNoMutationControls(undefined, detail);
  } finally {
    detail.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("a message focus request scrolls and pulses once per request", async () => {
  prepareDom();
  const scrollIntoView = vi.fn();
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView",
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  const detail = new CpkThreadInspector();
  detail.threadId = "thread-focused-message";
  detail.focusMessageId = "assistant-message-1";
  detail.focusRequestId = 1;
  detail.provider = {
    getEvents: vi.fn().mockResolvedValue([
      {
        type: "TEXT_MESSAGE_START",
        timestamp: "2026-06-25T10:00:00.000Z",
        payload: {
          messageId: "assistant-message-1",
          role: "assistant",
        },
      },
      {
        type: "TEXT_MESSAGE_CONTENT",
        timestamp: "2026-06-25T10:00:01.000Z",
        payload: {
          messageId: "assistant-message-1",
          delta: "Focused response",
        },
      },
    ]),
  };
  document.body.append(detail);

  try {
    await vi.waitFor(() => {
      const focusedMessage = detail.shadowRoot?.querySelector<HTMLElement>(
        '[data-message-id="assistant-message-1"]',
      );
      expect(focusedMessage).not.toBeNull();
      expect(focusedMessage?.classList.contains("cpk-td__focus-pulse")).toBe(
        true,
      );
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    });

    const focusedMessage = detail.shadowRoot?.querySelector<HTMLElement>(
      '[data-message-id="assistant-message-1"]',
    );
    focusedMessage?.dispatchEvent(new Event("animationend"));
    expect(focusedMessage?.classList.contains("cpk-td__focus-pulse")).toBe(
      false,
    );

    scrollIntoView.mockClear();
    detail.agentEventsInput = [...detail.agentEventsInput];
    await detail.updateComplete;
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(focusedMessage?.classList.contains("cpk-td__focus-pulse")).toBe(
      false,
    );

    detail.focusRequestId = 2;
    await detail.updateComplete;
    await vi.waitFor(() => {
      expect(focusedMessage?.classList.contains("cpk-td__focus-pulse")).toBe(
        true,
      );
    });
  } finally {
    detail.remove();
    if (originalScrollIntoView) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScrollIntoView,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("missing metadata falls back to Untitled and the full thread ID without optional account facts", async () => {
  prepareDom();
  const threadId = "thread-fallback-full-0987654321-zyxwvutsrqponmlkjihgfedcba";
  const provider: ThreadDebuggerProvider = {
    getThreadMetadata: vi.fn().mockResolvedValue(null),
    getEvents: vi.fn().mockResolvedValue([]),
  };
  const detail = appendDetail({ threadId, provider });
  try {
    await flushDetail(detail);
    expect(headerFacts(detail)).toEqual([
      { label: "Name", value: "Untitled" },
      { label: "ID", value: threadId },
    ]);
    const headerText =
      detail.shadowRoot?.querySelector('[aria-label="Thread metadata"]')
        ?.textContent ?? "";
    for (const absent of [
      "Agent",
      "Created",
      "Updated",
      "End user",
      "Created by",
      "Status",
    ]) {
      expect(headerText).not.toContain(absent);
    }
  } finally {
    detail.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("click selection keeps stable unique tab and panel ARIA links across rerenders", async () => {
  prepareDom();
  const provider: ThreadDebuggerProvider = {
    getEvents: vi.fn().mockResolvedValue([
      {
        type: "RUN_STARTED",
        timestamp: "2026-06-25T10:00:00.000Z",
        payload: { runId: "run-aria" },
      },
    ]),
    getState: vi.fn().mockResolvedValue({ step: "aria" }),
  };
  const first = appendDetail({
    threadId: "thread-aria-first",
    provider,
    thread: { id: "thread-aria-first", name: "First" },
  });
  const second = appendDetail({
    threadId: "thread-aria-second",
    provider,
    thread: { id: "thread-aria-second", name: "Second" },
  });
  try {
    await flushDetail(first);
    await flushDetail(second);
    const firstInitialIds = detailTabs(first).map((tab) => tab.id);
    const secondIds = detailTabs(second).map((tab) => tab.id);
    expect(firstInitialIds).toHaveLength(3);
    expect(new Set(firstInitialIds).size).toBe(3);
    expect(firstInitialIds.every((id) => id.length > 0)).toBe(true);
    expect(secondIds.every((id) => !firstInitialIds.includes(id))).toBe(true);

    await selectTab(first, "AG-UI Events");
    await selectTab(first, "State");
    const selected = await selectTab(first, "AG-UI Events");
    const tabs = detailTabs(first);
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      "Messages",
      "AG-UI Events",
      "State",
    ]);
    expect(tabs.map((tab) => tab.type)).toEqual(["button", "button", "button"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual([
      "-1",
      "0",
      "-1",
    ]);
    expect(selected.id).toMatch(/-tab-raw-events$/);

    const panels = mountedPanels(first);
    expect(panels).toHaveLength(3);
    expect(panels.filter((panel) => !panel.hidden)).toHaveLength(1);
    for (const tab of tabs) {
      const controls = tab.getAttribute("aria-controls");
      expect(controls).toBeTruthy();
      const panel = panels.find((candidate) => candidate.id === controls);
      expect(panel).toBeDefined();
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(panel?.hidden).toBe(tab !== selected);
    }

    first.thread = { id: "thread-aria-first", name: "First rerendered" };
    await first.updateComplete;
    expect(selectedTab(first).textContent?.trim()).toBe("AG-UI Events");
    expect(detailTabs(first).map((tab) => tab.id)).toEqual(firstInitialIds);
  } finally {
    first.remove();
    second.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("Arrow keys wrap and Home and End select and focus their exact tabs", async () => {
  prepareDom();
  const detail = appendDetail({
    threadId: "thread-keyboard",
    provider: {
      getEvents: vi.fn().mockResolvedValue([]),
      getState: vi.fn().mockResolvedValue({ keyboard: true }),
    },
  });
  try {
    await flushDetail(detail);
    const messages = requireTab(detail, "Messages");
    messages.focus();
    expect(detail.shadowRoot?.activeElement).toBe(messages);

    const right = dispatchNavigationKey(messages, "ArrowRight");
    await flushDetail(detail);
    expect(right.defaultPrevented).toBe(true);
    expect(selectedTab(detail).textContent?.trim()).toBe("AG-UI Events");
    expect(detail.shadowRoot?.activeElement).toBe(
      requireTab(detail, "AG-UI Events"),
    );

    const left = dispatchNavigationKey(
      requireTab(detail, "AG-UI Events"),
      "ArrowLeft",
    );
    await flushDetail(detail);
    expect(left.defaultPrevented).toBe(true);
    expect(selectedTab(detail).textContent?.trim()).toBe("Messages");

    dispatchNavigationKey(requireTab(detail, "Messages"), "ArrowLeft");
    await flushDetail(detail);
    expect(selectedTab(detail).textContent?.trim()).toBe("State");
    dispatchNavigationKey(requireTab(detail, "State"), "ArrowRight");
    await flushDetail(detail);
    expect(selectedTab(detail).textContent?.trim()).toBe("Messages");

    dispatchNavigationKey(requireTab(detail, "Messages"), "End");
    await flushDetail(detail);
    expect(selectedTab(detail).textContent?.trim()).toBe("State");
    expect(detail.shadowRoot?.activeElement).toBe(requireTab(detail, "State"));
    dispatchNavigationKey(requireTab(detail, "State"), "Home");
    await flushDetail(detail);
    expect(selectedTab(detail).textContent?.trim()).toBe("Messages");
    expect(detail.shadowRoot?.activeElement).toBe(
      requireTab(detail, "Messages"),
    );

    const tabKey = dispatchNavigationKey(requireTab(detail, "Messages"), "Tab");
    await flushDetail(detail);
    expect(tabKey.defaultPrevented).toBe(false);
    expect(selectedTab(detail).textContent?.trim()).toBe("Messages");
  } finally {
    detail.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("real provider navigation shares events, lazily loads state once, and adds no request", async () => {
  prepareDom();
  const currentFetch = globalThis.fetch;
  const fetchMock = Object.assign(
    vi.fn(async (): Promise<Response> => jsonResponse({})),
    currentFetch,
  );
  vi.stubGlobal("fetch", fetchMock);
  const getThreadMetadata = vi.fn().mockResolvedValue({
    id: "thread-provider-routing",
    name: "Provider routing",
  });
  const getMessages = vi.fn().mockResolvedValue([]);
  const getEvents = vi.fn().mockResolvedValue([
    {
      type: "RUN_STARTED",
      timestamp: "2026-06-25T10:00:00.000Z",
      payload: { runId: "one-shared-response" },
    },
  ]);
  const getState = vi.fn().mockResolvedValue({ loaded: "once" });
  const detail = appendDetail({
    threadId: "thread-provider-routing",
    provider: { getThreadMetadata, getMessages, getEvents, getState },
  });
  try {
    await vi.waitFor(() => expect(getEvents).toHaveBeenCalledTimes(1));
    expect(getThreadMetadata).toHaveBeenCalledTimes(1);
    expect(getMessages).not.toHaveBeenCalled();
    expect(getState).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    await selectTab(detail, "AG-UI Events");
    await selectTab(detail, "Messages");
    await selectTab(detail, "AG-UI Events");
    expect(getEvents).toHaveBeenCalledTimes(1);
    expect(getMessages).not.toHaveBeenCalled();

    await selectTab(detail, "State");
    await vi.waitFor(() => expect(getState).toHaveBeenCalledTimes(1));
    await selectTab(detail, "Messages");
    await selectTab(detail, "State");
    expect(getState).toHaveBeenCalledTimes(1);
    expect(getEvents).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    detail.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("a source-event link selects AG-UI Events and reveals the indexed event", async () => {
  prepareDom();
  const detail = appendDetail({
    threadId: "thread-source-link",
    provider: {
      getEvents: vi.fn().mockResolvedValue([
        {
          type: "RUN_STARTED",
          timestamp: "2026-06-25T10:00:00.000Z",
          payload: { runId: "source-link-run" },
        },
      ]),
    },
  });
  try {
    await vi.waitFor(() => {
      expect(
        detail.shadowRoot?.querySelector<HTMLButtonElement>(
          ".cpk-td__source-link",
        ),
      ).not.toBeNull();
    });
    detail.shadowRoot
      ?.querySelector<HTMLButtonElement>(".cpk-td__source-link")
      ?.click();
    await flushDetail(detail);

    const selected = selectedTab(detail);
    expect(selected.textContent?.trim()).toBe("AG-UI Events");
    expect(selected.id).toMatch(/-tab-raw-events$/);
    const event = detail.shadowRoot?.querySelector<HTMLElement>(
      '.cpk-td__event[data-source-index="1"]',
    );
    expect(event).not.toBeNull();
    expect(event?.closest<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(
      false,
    );
    expect(event?.textContent).toContain("RUN_STARTED");
    expect(
      getComputedStyle(
        event?.querySelector<HTMLElement>(".cpk-td__event-type") ??
          document.body,
      ).color,
    ).toBe("rgb(138, 89, 0)");
  } finally {
    detail.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("all three local examples use the shared labels, created fact, local panels, and zero routes", async () => {
  const harness = await setupExampleHarness();
  const examples = [
    {
      id: "example-realtime-sync",
      name: "Realtime thread sync",
      event: "RUN_STARTED",
      state: "cart_demo_42",
    },
    {
      id: "example-manage-history",
      name: "Manage saved conversations",
      event: "CUSTOM_EVENT",
      state: "Billing escalation handoff",
    },
    {
      id: "example-inspect-runs",
      name: "Inspect durable run history",
      event: "TOOL_CALL_START",
      state: "auditLogsRequired",
    },
  ] as const;
  try {
    const routesBeforeExamples = harness.routes();
    for (const example of examples) {
      const detail = await harness.selectExample(example.name);
      const facts = headerFacts(detail);
      expect(facts.map((fact) => fact.label)).toEqual([
        "Name",
        "ID",
        "Agent",
        "Created",
        "Updated",
      ]);
      expect(facts.find((fact) => fact.label === "Name")?.value).toBe(
        example.name,
      );
      expect(facts.find((fact) => fact.label === "ID")?.value).toBe(example.id);
      expect(facts.find((fact) => fact.label === "Created")?.value).not.toBe(
        "—",
      );
      expect(detailTabs(detail).map((tab) => tab.textContent?.trim())).toEqual([
        "Messages",
        "AG-UI Events",
        "State",
      ]);

      const skip = Array.from(
        harness.inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>(
          "button",
        ) ?? [],
      ).find((button) => button.textContent?.trim() === "Skip");
      skip?.click();
      await harness.flush();

      await selectTab(detail, "Messages");
      expect(detail.shadowRoot?.textContent).toContain("Run started");
      await selectTab(detail, "AG-UI Events");
      expect(detail.shadowRoot?.textContent).toContain(example.event);
      await selectTab(detail, "State");
      expect(detail.shadowRoot?.textContent).toContain(example.state);
      expectNoMutationControls(harness.inspector, detail);
      expect(harness.routes()).toEqual(routesBeforeExamples);
    }
  } finally {
    await harness.teardown();
  }
});

test("Sam's tour uses the new labels while preserving step bodies, storage, navigation, and local routing", async () => {
  const harness = await setupExampleHarness();
  try {
    const routesBeforeTour = harness.routes();
    const detail = await harness.selectExample("Realtime thread sync");
    const root = harness.inspector.shadowRoot!;
    const expectedSteps = [
      {
        label: "Messages",
        tabSuffix: "-tab-timeline",
        body: "The timeline turns messages, tool calls, state changes, and run markers into a scannable debugging trail.",
      },
      {
        label: "AG-UI Events",
        tabSuffix: "-tab-raw-events",
        body: "Raw events show the exact AG-UI stream behind the timeline when you need to verify ordering or payload shape.",
      },
      {
        label: "State",
        tabSuffix: "-tab-state",
        body: "The state tab shows the saved values that make a thread resumable across sessions.",
      },
    ] as const;

    for (const [index, step] of expectedSteps.entries()) {
      await vi.waitFor(() => {
        const dialog = root.querySelector<HTMLElement>(
          '[role="dialog"][aria-label="Example thread tour"]',
        );
        expect(dialog?.textContent).toContain(`${index + 1}/3`);
        expect(dialog?.textContent).toContain(step.label);
        expect(dialog?.textContent).toContain(step.body);
        expect(selectedTab(detail).id).toMatch(
          new RegExp(`${step.tabSuffix}$`),
        );
      });
      if (index < expectedSteps.length - 1) {
        requireButton(root, "Next").click();
        await harness.flush();
      }
    }

    requireButton(root, "Back").click();
    await harness.flush();
    expect(selectedTab(detail).textContent?.trim()).toBe("AG-UI Events");
    requireButton(root, "Next").click();
    await harness.flush();
    requireButton(root, "Done").click();
    await harness.flush();

    expect(
      JSON.parse(window.localStorage.getItem(TOUR_STORAGE_KEY) ?? "null"),
    ).toEqual({ dismissed: true });
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    requireButton(root, "Show tour").click();
    await harness.flush();
    const reopenedTourText =
      root.querySelector('[role="dialog"]')?.textContent ?? "";
    expect(reopenedTourText).toContain("1/3");
    expect(reopenedTourText).toContain("Messages");
    expect(selectedTab(detail).id).toMatch(/-tab-timeline$/);
    expectNoMutationControls(harness.inspector, detail);
    expect(harness.routes()).toEqual(routesBeforeTour);
  } finally {
    await harness.teardown();
  }
});
