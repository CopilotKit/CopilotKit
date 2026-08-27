import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectThreads,
  ɵselectThreadsIsLoading,
} from "@copilotkit/core";
import type { ɵThreadStore } from "@copilotkit/core";
import type { ThreadEndpointRuntimeInfo } from "@copilotkit/shared";
import { expect, test, vi } from "vitest";

import { WebInspectorElement } from "../../../index.js";

const RUNTIME_URL = "https://runtime.example.test";
const AGENT_ID = "video-agent";
const VIDEO_URL =
  "https://cdn.copilotkit.ai/corp-site/videos/copilotkit-generative-ui-agentic-frontend-demo.webm";
const VIDEO_FALLBACK =
  "The demo video is unavailable. Use the example threads to explore Messages, AG-UI Events, and State.";

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
type GateKind = "timer" | "idle";
type FixtureMode = "enabled-zero" | "locked";

const ZERO_ROUTES = {
  list: 0,
  subscribe: 0,
  inspect: 0,
  messages: 0,
  events: 0,
  state: 0,
} as const satisfies ThreadRoutes;

type FixtureOptions = Readonly<{
  mode: FixtureMode;
  reducedMotion: boolean;
  gate: GateKind;
  play: () => Promise<void>;
}>;

class VideoTestCore extends CopilotKitCore {
  constructor(
    private readonly endpointsValue: ThreadEndpointRuntimeInfo | undefined,
  ) {
    super({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
  }

  override get threadEndpoints(): ThreadEndpointRuntimeInfo | undefined {
    return this.endpointsValue;
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
      "Video test runtime subscriber failed",
    );
  }
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

function stubMotionPreference(reducedMotion: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      return {
        matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      } satisfies MediaQueryList;
    }),
  );
}

function idleDeadline(): IdleDeadline {
  return {
    didTimeout: false,
    timeRemaining: () => 50,
  };
}

async function flushInspector(inspector: WebInspectorElement): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve();
    await inspector.updateComplete;
  }
}

function requireVideo(root: ShadowRoot): HTMLVideoElement {
  const video = root.querySelector<HTMLVideoElement>(
    ".cpk-threads-overview-video",
  );
  expect(video, "the deferred demo video placeholder").not.toBeNull();
  if (!video) throw new Error("The deferred demo video was not rendered");
  return video;
}

function findDemoControl(root: ShadowRoot): HTMLButtonElement | null {
  return (
    Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) =>
        button.textContent?.trim() === "Play demo" ||
        button.textContent?.trim() === "Pause demo",
    ) ?? null
  );
}

function requireDemoControl(root: ShadowRoot): HTMLButtonElement {
  const control = findDemoControl(root);
  expect(control, "the native demo playback control").not.toBeNull();
  if (!control) throw new Error("The demo playback control was not rendered");
  return control;
}

function exampleRows(root: ShadowRoot): HTMLButtonElement[] {
  const list = root.querySelector("cpk-thread-list");
  return Array.from(
    list?.shadowRoot?.querySelectorAll<HTMLButtonElement>(".cpk-tl__item") ??
      [],
  );
}

function expectAllExamples(root: ShadowRoot): void {
  expect(exampleRows(root).map((row) => row.textContent?.trim())).toEqual([
    expect.stringContaining("Realtime thread sync"),
    expect.stringContaining("Manage saved conversations"),
    expect.stringContaining("Inspect durable run history"),
  ]);
}

function requireButton(root: ShadowRoot, label: string): HTMLButtonElement {
  const button = Array.from(
    root.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.trim() === label);
  expect(button, `${label} control`).not.toBeUndefined();
  if (!button) throw new Error(`${label} control was not rendered`);
  return button;
}

function observeVideoSources(root: ShadowRoot) {
  const attachments: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (
        record.type !== "attributes" ||
        record.attributeName !== "src" ||
        !(record.target instanceof HTMLVideoElement)
      ) {
        continue;
      }
      const source = record.target.getAttribute("src");
      if (source !== null) attachments.push(source);
    }
  });
  observer.observe(root, {
    attributes: true,
    subtree: true,
    attributeFilter: ["src"],
  });
  return { attachments, disconnect: () => observer.disconnect() };
}

function deferredPlay() {
  let resolvePromise: (() => void) | null = null;
  let rejectPromise: ((reason: Error) => void) | null = null;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve() {
      if (!resolvePromise) throw new Error("Play promise was already resolved");
      const resolve = resolvePromise;
      resolvePromise = null;
      rejectPromise = null;
      resolve();
    },
    reject(reason: Error) {
      if (!rejectPromise) throw new Error("Play promise was already settled");
      const reject = rejectPromise;
      resolvePromise = null;
      rejectPromise = null;
      reject(reason);
    },
  };
}

async function setupFixture(options: FixtureOptions) {
  document.body.replaceChildren();
  document.getElementById("cpk-inspector-brand-fonts")?.remove();
  window.localStorage.clear();
  window.sessionStorage.clear();
  stubMotionPreference(options.reducedMotion);

  const routeCounts: Record<ThreadRoute, number> = { ...ZERO_ROUTES };
  const fetchMock = Object.assign(
    vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = requestUrl(input);
      if (url.href === "https://cdn.copilotkit.ai/announcements.json") {
        return new Response(null, { status: 404 });
      }
      const route = classifyThreadRoute(url);
      if (!route) throw new Error(`Unexpected video-test request: ${url.href}`);
      routeCounts[route] += 1;
      if (route === "list") {
        return jsonResponse({ threads: [], joinCode: null });
      }
      throw new Error(`Unexpected video-test Thread route: ${route}`);
    }),
    globalThis.fetch,
  );
  vi.stubGlobal("fetch", fetchMock);

  let store: ɵThreadStore | null = null;
  if (options.mode === "enabled-zero") {
    const enabledStore = ɵcreateThreadStore({ fetch: fetchMock });
    store = enabledStore;
    enabledStore.start();
    enabledStore.setContext({
      runtimeUrl: RUNTIME_URL,
      headers: {},
      agentId: AGENT_ID,
    });
    await vi.waitFor(() => {
      expect(ɵselectThreadsIsLoading(enabledStore.getState())).toBe(false);
      expect(ɵselectThreads(enabledStore.getState())).toEqual([]);
    });
  }

  vi.useFakeTimers();
  const play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockImplementation(options.play);
  const pause = vi
    .spyOn(HTMLMediaElement.prototype, "pause")
    .mockImplementation(() => undefined);
  const load = vi
    .spyOn(HTMLMediaElement.prototype, "load")
    .mockImplementation(() => undefined);
  const timeout = vi.spyOn(window, "setTimeout");
  const clearTimeout = vi.spyOn(window, "clearTimeout");
  const idleCallbacks: IdleRequestCallback[] = [];
  const idleHandles: number[] = [];
  const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
    const handle = 700 + idleCallbacks.length;
    idleCallbacks.push(callback);
    idleHandles.push(handle);
    return handle;
  });
  const cancelIdleCallback = vi.fn();
  if (options.gate === "idle") {
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
  } else {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("cancelIdleCallback", undefined);
  }

  const core = new VideoTestCore(
    options.mode === "enabled-zero" ? ENABLED_ENDPOINTS : undefined,
  );
  if (store) core.registerThreadStore(AGENT_ID, store);
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

  const timerEntries = () =>
    timeout.mock.calls.flatMap(([handler, delay]) => {
      if (delay !== 450 || typeof handler !== "function") {
        return [];
      }
      return [{ callback: () => handler() }];
    });
  const gateCount = () =>
    options.gate === "idle" ? idleCallbacks.length : timerEntries().length;
  const gateCallback = (index: number): (() => void) => {
    if (options.gate === "idle") {
      const callback = idleCallbacks[index];
      if (!callback) throw new Error(`Idle gate ${index} was not scheduled`);
      return () => callback(idleDeadline());
    }
    const entry = timerEntries()[index];
    if (!entry) throw new Error(`Timer gate ${index} was not scheduled`);
    return entry.callback;
  };
  const gateWasCancelled = (index: number): boolean => {
    if (options.gate === "idle") {
      return cancelIdleCallback.mock.calls.some(
        ([handle]) => handle === idleHandles[index],
      );
    }
    return !!timerEntries()[index] && clearTimeout.mock.calls.length > 0;
  };

  return {
    inspector,
    core,
    store,
    play,
    pause,
    load,
    routes: (): ThreadRoutes => ({ ...routeCounts }),
    gateCount,
    gateCallback,
    gateWasCancelled,
    async fireGate(index = 0) {
      if (options.gate === "timer" && index === 0) {
        await vi.advanceTimersByTimeAsync(450);
      } else {
        gateCallback(index)();
      }
      await flushInspector(inspector);
    },
    flush: () => flushInspector(inspector),
    async teardown() {
      inspector.remove();
      if (store) {
        core.unregisterThreadStore(AGENT_ID);
        store.stop();
      }
      await Promise.resolve();
      document.body.replaceChildren();
      document.getElementById("cpk-inspector-brand-fonts")?.remove();
      window.localStorage.clear();
      window.sessionStorage.clear();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    },
  };
}

async function verifyDisconnectBeforeGate(gate: GateKind): Promise<void> {
  const harness = await setupFixture({
    mode: "enabled-zero",
    reducedMotion: false,
    gate,
    play: async () => undefined,
  });
  try {
    const root = harness.inspector.shadowRoot!;
    const video = requireVideo(root);
    const sourceChanges = observeVideoSources(root);
    const routesBeforeLifecycle = harness.routes();
    const staleGate = harness.gateCallback(0);

    expect(harness.gateCount()).toBe(1);
    expect(video.hasAttribute("src")).toBe(false);

    harness.inspector.remove();
    expect(harness.gateWasCancelled(0)).toBe(true);
    expect(harness.pause).toHaveBeenCalledTimes(1);
    expect(harness.load).toHaveBeenCalledTimes(1);

    staleGate();
    await Promise.resolve();
    await Promise.resolve();

    expect(video.hasAttribute("src")).toBe(false);
    expect(video.currentSrc).toBe("");
    expect(sourceChanges.attachments).toEqual([]);
    expect(harness.play).not.toHaveBeenCalled();
    expect(harness.routes()).toEqual(routesBeforeLifecycle);
    sourceChanges.disconnect();
  } finally {
    await harness.teardown();
  }
}

test("enabled zero defers the normal-motion asset and attaches it once after the gate", async () => {
  const harness = await setupFixture({
    mode: "enabled-zero",
    reducedMotion: false,
    gate: "timer",
    play: async () => undefined,
  });
  try {
    const root = harness.inspector.shadowRoot!;
    const frame = root.querySelector(".cpk-threads-overview-video-frame");
    const video = requireVideo(root);
    const control = requireDemoControl(root);
    const sourceChanges = observeVideoSources(root);
    const routesBeforeGate = harness.routes();

    expect(frame?.getAttribute("aria-hidden")).toBe("true");
    expect(control.textContent?.trim()).toBe("Play demo");
    expect(control.getAttribute("aria-pressed")).toBe("true");
    expect(video.hasAttribute("src")).toBe(false);
    expect(video.currentSrc).toBe("");
    expect(harness.play).not.toHaveBeenCalled();
    expect(harness.routes()).toEqual(routesBeforeGate);

    await harness.fireGate();

    expect(video.getAttribute("src")).toBe(VIDEO_URL);
    expect(sourceChanges.attachments).toEqual([VIDEO_URL]);
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.hasAttribute("muted")).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(true);
    expect(video.hasAttribute("loop")).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(harness.routes()).toEqual(routesBeforeGate);
    sourceChanges.disconnect();
  } finally {
    await harness.teardown();
  }
});

test("loaded data fades in and resolved guarded playback enters playing", async () => {
  const pendingPlay = deferredPlay();
  const harness = await setupFixture({
    mode: "enabled-zero",
    reducedMotion: false,
    gate: "timer",
    play: () => pendingPlay.promise,
  });
  try {
    const root = harness.inspector.shadowRoot!;
    const video = requireVideo(root);
    const routesBeforePlayback = harness.routes();

    expect(video.getAttribute("data-loaded")).toBe("false");

    await harness.fireGate();
    video.dispatchEvent(new Event("loadeddata"));
    await harness.flush();

    expect(video.getAttribute("data-loaded")).toBe("true");
    expect(harness.play).toHaveBeenCalledTimes(1);

    pendingPlay.resolve();
    await harness.flush();

    const control = requireDemoControl(root);
    expect(control.textContent?.trim()).toBe("Pause demo");
    expect(control.getAttribute("aria-pressed")).toBe("false");
    expect(harness.routes()).toEqual(routesBeforePlayback);
  } finally {
    await harness.teardown();
  }
});

test("locked reduced motion defers then loads the same asset without autoplay", async () => {
  const harness = await setupFixture({
    mode: "locked",
    reducedMotion: true,
    gate: "timer",
    play: async () => undefined,
  });
  try {
    const root = harness.inspector.shadowRoot!;
    const video = requireVideo(root);
    const routesBeforeGate = harness.routes();

    expect(video.hasAttribute("src")).toBe(false);
    expect(requireDemoControl(root).textContent?.trim()).toBe("Play demo");
    expectAllExamples(root);

    await harness.fireGate();

    const control = requireDemoControl(root);
    expect(video.getAttribute("src")).toBe(VIDEO_URL);
    expect(video.autoplay).toBe(false);
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(harness.play).not.toHaveBeenCalled();
    expect(control.textContent?.trim()).toBe("Play demo");
    expect(control.getAttribute("aria-pressed")).toBe("true");
    expect(harness.routes()).toEqual(routesBeforeGate);
  } finally {
    await harness.teardown();
  }
});

test("the external native control plays and pauses once per action", async () => {
  const harness = await setupFixture({
    mode: "enabled-zero",
    reducedMotion: false,
    gate: "timer",
    play: async () => undefined,
  });
  try {
    const root = harness.inspector.shadowRoot!;
    const video = requireVideo(root);
    const sourceChanges = observeVideoSources(root);
    const routesBeforeActions = harness.routes();
    const playControl = requireDemoControl(root);

    expect(playControl).toBeInstanceOf(HTMLButtonElement);
    expect(playControl.type).toBe("button");
    expect(playControl.hasAttribute("role")).toBe(false);
    expect(playControl.hasAttribute("tabindex")).toBe(false);
    expect(playControl.tabIndex).toBe(0);
    expect(playControl.closest('[aria-hidden="true"]')).toBeNull();
    expect(video.closest('[aria-hidden="true"]')).not.toBeNull();
    playControl.focus();
    expect(root.activeElement).toBe(playControl);

    playControl.click();
    await harness.flush();

    const pauseControl = requireDemoControl(root);
    expect(video.getAttribute("src")).toBe(VIDEO_URL);
    expect(sourceChanges.attachments).toEqual([VIDEO_URL]);
    expect(harness.play).toHaveBeenCalledTimes(1);
    expect(pauseControl.textContent?.trim()).toBe("Pause demo");
    expect(pauseControl.getAttribute("aria-pressed")).toBe("false");

    pauseControl.click();
    await harness.flush();
    await vi.advanceTimersByTimeAsync(450);
    await harness.flush();

    const resumedControl = requireDemoControl(root);
    expect(harness.pause).toHaveBeenCalledTimes(1);
    expect(harness.play).toHaveBeenCalledTimes(1);
    expect(sourceChanges.attachments).toEqual([VIDEO_URL]);
    expect(resumedControl.textContent?.trim()).toBe("Play demo");
    expect(resumedControl.getAttribute("aria-pressed")).toBe("true");
    expect(harness.routes()).toEqual(routesBeforeActions);
    sourceChanges.disconnect();
  } finally {
    await harness.teardown();
  }
});

test("a media error keeps the examples, local detail tabs, and tour usable", async () => {
  const harness = await setupFixture({
    mode: "enabled-zero",
    reducedMotion: false,
    gate: "timer",
    play: async () => undefined,
  });
  try {
    const root = harness.inspector.shadowRoot!;
    const video = requireVideo(root);
    const routesBeforeError = harness.routes();

    await harness.fireGate();
    video.dispatchEvent(new Event("error"));
    await harness.flush();

    expect(root.textContent).toContain(VIDEO_FALLBACK);
    expect(root.textContent).not.toContain("Failed to load threads");
    expectAllExamples(root);
    expect(requireDemoControl(root).textContent?.trim()).toBe("Play demo");

    exampleRows(root)[0]?.click();
    await harness.flush();
    const detail = root.querySelector("cpk-thread-details");
    const detailTabs = Array.from(
      detail?.shadowRoot?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ??
        [],
    );
    expect(detailTabs).toHaveLength(3);
    const eventsTab = detailTabs[1];
    expect(eventsTab).toBeDefined();
    eventsTab?.click();
    await harness.flush();
    requireButton(root, "Skip").click();
    await harness.flush();
    requireButton(root, "Show tour").click();
    await harness.flush();

    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    expectAllExamples(root);
    expect(harness.routes()).toEqual(routesBeforeError);
  } finally {
    await harness.teardown();
  }
});

test("a rejected play reaches fallback without an unhandled rejection or lost demo", async () => {
  let attempt = 0;
  const unhandledRejections: PromiseRejectionEvent[] = [];
  const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    unhandledRejections.push(event);
    event.preventDefault();
  };
  window.addEventListener("unhandledrejection", handleUnhandledRejection);
  const harness = await setupFixture({
    mode: "enabled-zero",
    reducedMotion: false,
    gate: "timer",
    play: () => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error("blocked playback"))
        : Promise.resolve();
    },
  });
  try {
    const root = harness.inspector.shadowRoot!;
    const failedVideo = requireVideo(root);
    const sourceChanges = observeVideoSources(root);
    const routesBeforePlayback = harness.routes();

    await harness.fireGate();
    await harness.flush();

    expect(harness.play).toHaveBeenCalledTimes(1);
    expect(unhandledRejections).toEqual([]);
    expect(root.textContent).toContain(VIDEO_FALLBACK);
    expect(root.textContent).toContain(
      "Threads are persistent, inspectable conversations",
    );
    expectAllExamples(root);

    const retry = requireDemoControl(root);
    expect(retry.textContent?.trim()).toBe("Play demo");
    expect(retry.getAttribute("aria-pressed")).toBe("true");
    retry.click();
    await harness.flush();

    const retriedVideo = requireVideo(root);
    expect(harness.play).toHaveBeenCalledTimes(2);
    expect(unhandledRejections).toEqual([]);
    expect(retriedVideo).not.toBe(failedVideo);
    expect(retriedVideo.getAttribute("src")).toBe(VIDEO_URL);
    expect(sourceChanges.attachments).toEqual([VIDEO_URL, VIDEO_URL]);
    expect(root.textContent).not.toContain(VIDEO_FALLBACK);
    expect(requireDemoControl(root).textContent?.trim()).toBe("Pause demo");
    expect(requireDemoControl(root).getAttribute("aria-pressed")).toBe("false");

    failedVideo.dispatchEvent(new Event("pause"));
    failedVideo.dispatchEvent(new Event("play"));
    failedVideo.dispatchEvent(new Event("error"));
    failedVideo.dispatchEvent(new Event("loadeddata"));
    await harness.flush();

    expect(root.textContent).not.toContain(VIDEO_FALLBACK);
    expect(requireDemoControl(root).textContent?.trim()).toBe("Pause demo");

    exampleRows(root)[1]?.click();
    await harness.flush();
    const detail = root.querySelector("cpk-thread-details");
    expect(
      Array.from(
        detail?.shadowRoot?.querySelectorAll<HTMLButtonElement>(
          '[role="tab"]',
        ) ?? [],
      ).some((tab) => tab.textContent?.trim() === "State"),
    ).toBe(true);
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    expectAllExamples(root);
    expect(harness.routes()).toEqual(routesBeforePlayback);
    sourceChanges.disconnect();
  } finally {
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    await harness.teardown();
  }
});

test("disconnect before either deferred gate cancels handles and ignores stale callbacks", async () => {
  await verifyDisconnectBeforeGate("timer");
  await verifyDisconnectBeforeGate("idle");
});

test("disconnect after load aborts media and reconnect starts one fresh lifecycle", async () => {
  const firstPlay = deferredPlay();
  const secondPlay = deferredPlay();
  let attempt = 0;
  const harness = await setupFixture({
    mode: "enabled-zero",
    reducedMotion: false,
    gate: "idle",
    play: () => {
      attempt += 1;
      return attempt === 1 ? firstPlay.promise : secondPlay.promise;
    },
  });
  try {
    const root = harness.inspector.shadowRoot!;
    const firstVideo = requireVideo(root);
    const sourceChanges = observeVideoSources(root);
    const routesBeforeLifecycle = harness.routes();

    expect(harness.gateCount()).toBe(1);
    await harness.fireGate(0);
    firstVideo.dispatchEvent(new Event("loadeddata"));
    await harness.flush();
    expect(harness.play).toHaveBeenCalledTimes(1);
    expect(sourceChanges.attachments).toEqual([VIDEO_URL]);

    harness.inspector.remove();
    expect(harness.pause).toHaveBeenCalledTimes(1);
    expect(harness.load).toHaveBeenCalledTimes(1);
    expect(firstVideo.hasAttribute("src")).toBe(false);
    firstPlay.resolve();
    await Promise.resolve();
    await Promise.resolve();

    document.body.append(harness.inspector);
    harness.inspector.remove();
    document.body.append(harness.inspector);
    await harness.flush();

    const reconnectedVideo = requireVideo(root);
    expect(reconnectedVideo).not.toBe(firstVideo);
    expect(harness.gateCount()).toBe(2);
    expect(reconnectedVideo.hasAttribute("src")).toBe(false);
    expect(requireDemoControl(root).textContent?.trim()).toBe("Play demo");

    firstVideo.dispatchEvent(new Event("pause"));
    firstVideo.dispatchEvent(new Event("play"));
    firstVideo.dispatchEvent(new Event("error"));
    firstVideo.dispatchEvent(new Event("loadeddata"));
    await harness.flush();

    expect(reconnectedVideo.hasAttribute("src")).toBe(false);
    expect(root.textContent).not.toContain(VIDEO_FALLBACK);
    expect(requireDemoControl(root).textContent?.trim()).toBe("Play demo");

    harness.gateCallback(0)();
    await harness.flush();
    expect(reconnectedVideo.hasAttribute("src")).toBe(false);
    expect(harness.play).toHaveBeenCalledTimes(1);

    await harness.fireGate(1);
    reconnectedVideo.dispatchEvent(new Event("loadeddata"));
    await harness.flush();
    secondPlay.resolve();
    await harness.flush();

    expect(reconnectedVideo.getAttribute("src")).toBe(VIDEO_URL);
    expect(sourceChanges.attachments).toEqual([VIDEO_URL, VIDEO_URL]);
    expect(harness.play).toHaveBeenCalledTimes(2);
    expect(requireDemoControl(root).textContent?.trim()).toBe("Pause demo");
    expect(harness.routes()).toEqual(routesBeforeLifecycle);
    sourceChanges.disconnect();
  } finally {
    await harness.teardown();
  }
});
