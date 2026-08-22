// Launcher error signal (OSS-903)
//
// Same discipline as launcher-signal.spec.ts, whose helpers this suite mirrors:
// every assertion is on externally observable behaviour — whether a dot is
// present, which tone it takes, whether a beat is in flight, which navigation
// entry is current and which is marked, what the accessible name says, and what
// a telemetry payload contains. Nothing reaches for a private field or a render
// method name, because the navigation has already been restructured once during
// this cycle and will move again.
//
// Timers: fake for the settle window, which is otherwise two real seconds per
// case. Beat *completion* keeps real timers, as the announcement suite does,
// because that is the one assertion about a duration rather than a transition.

import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectThreadsError,
} from "@copilotkit/core";
import type { ɵThreadStore } from "@copilotkit/core";
import type {
  IntelligenceRuntimeInfo,
  ThreadEndpointRuntimeInfo,
} from "@copilotkit/shared";
import { afterEach, expect, test, vi } from "vitest";

import { WebInspectorElement } from "../index.js";
import { TELEMETRY_EVENTS, TELEMETRY_INGEST_URL } from "../lib/telemetry.js";

const RUNTIME_URL = "https://runtime.error-signal.test";
const AGENT_ID = "error-signal-agent";
const ANNOUNCEMENT_URL = "https://cdn.copilotkit.ai/announcements.json";
const INSPECTOR_STATE_KEY = "cpk:inspector:state";
const PULSED_SESSION_KEY = "cpk:inspector:pulsed";
const TIMESTAMP = "2026-08-01T09:00:00.000Z";

// The contract, not an implementation detail: "a failure must persist for
// approximately two seconds", and an error beats faster than product news.
const SETTLE_MS = 2000;
const ERROR_BEAT_MS = 1500;
const NEWS_BEAT_MS = 2100;

const ENABLED_ENDPOINTS = {
  list: true,
  inspect: true,
  mutations: false,
  realtimeMetadata: false,
} satisfies ThreadEndpointRuntimeInfo;

type TelemetryBody = Readonly<{
  event: string;
  properties: Readonly<Record<string, unknown>>;
}>;

type Marker = Readonly<{ key: string; tone: string | null }>;

type Options = Readonly<{
  /** Omitted means Intelligence is not configured, which must arm nothing. */
  endpoints?: ThreadEndpointRuntimeInfo;
  /** Start the thread list route broken, so the thread latch has a source. */
  listFails?: boolean;
  /** Serve a real announcement so the two signals can be exercised together. */
  announcement?: boolean;
  /** Hold the announcement feed until `releaseAnnouncement()` is called. */
  announcementPending?: boolean;
  persistedOpen?: boolean;
  persistedMenu?: string;
  telemetryDisabled?: boolean;
  optedOut?: boolean;
  reducedMotion?: boolean;
  /** Leave real timers in place, for the one beat-completion assertion. */
  realTimers?: boolean;
}>;

class SignalTestCore extends CopilotKitCore {
  private readonly endpointsValue: ThreadEndpointRuntimeInfo | undefined;
  private readonly telemetryDisabledValue: boolean;

  constructor(options: Options) {
    super({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      // Nothing ever calls connect(): the status transitions this suite is
      // about are driven explicitly, so no test depends on a network race.
      deferInitialConnection: true,
    });
    this.endpointsValue = options.endpoints;
    this.telemetryDisabledValue = options.telemetryDisabled ?? false;
  }

  override get threadEndpoints(): ThreadEndpointRuntimeInfo | undefined {
    return this.endpointsValue;
  }

  override get intelligence(): IntelligenceRuntimeInfo | undefined {
    return undefined;
  }

  override get telemetryDisabled(): boolean {
    return this.telemetryDisabledValue;
  }

  async emitStatus(
    status: CopilotKitCoreRuntimeConnectionStatus,
  ): Promise<void> {
    await this.notifySubscribers(
      (subscriber) =>
        subscriber.onRuntimeConnectionStatusChanged?.({
          copilotkit: this,
          status,
        }),
      "Error-signal test runtime subscriber failed",
    );
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTelemetryBody(raw: string): TelemetryBody {
  const parsed: unknown = JSON.parse(raw);
  if (
    !isRecord(parsed) ||
    typeof parsed.event !== "string" ||
    !isRecord(parsed.properties)
  ) {
    throw new Error("Telemetry request body had an unexpected shape");
  }
  return { event: parsed.event, properties: parsed.properties };
}

function stubMatchMedia(reducedMotion: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(
      (query: string) =>
        ({
          matches:
            reducedMotion && query === "(prefers-reduced-motion: reduce)",
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }) satisfies MediaQueryList,
    ),
  );
}

function requireElement<T extends Node>(element: T | null | undefined): T {
  if (!element) throw new Error("Expected element was not rendered");
  return element;
}

/** Fails loudly when a harness control was not wired for this scenario. */
function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`This scenario has no ${what}`);
  }
  return value;
}

function root(inspector: WebInspectorElement): ShadowRoot {
  return requireElement(inspector.shadowRoot);
}

/** The launcher, or null while the panel is open and it is not rendered. */
function launcher(inspector: WebInspectorElement): HTMLButtonElement | null {
  return root(inspector).querySelector<HTMLButtonElement>(
    'button[aria-label^="Web Inspector"]',
  );
}

/** The resting dot painted on the closed launcher, or null when quiet. */
function launcherDot(inspector: WebInspectorElement): HTMLElement | null {
  return root(inspector).querySelector<HTMLElement>("[data-cpk-signal-dot]");
}

/** Which subject the dot currently belongs to. */
function dotSubject(inspector: WebInspectorElement): string | null {
  return launcherDot(inspector)?.getAttribute("data-cpk-signal-dot") ?? null;
}

function launcherTone(inspector: WebInspectorElement): string | null {
  return launcher(inspector)?.getAttribute("data-cpk-signal") ?? null;
}

function launcherColor(inspector: WebInspectorElement): string {
  return (
    launcher(inspector)?.style.getPropertyValue("--cpk-launcher-signal") ?? ""
  );
}

function launcherName(inspector: WebInspectorElement): string | null {
  return launcher(inspector)?.getAttribute("aria-label") ?? null;
}

const pulsing = (inspector: WebInspectorElement): boolean =>
  launcher(inspector)?.getAttribute("data-cpk-signal-pulsing") === "true";

/** Every marked navigation entry, with the tone its marker carries. */
function markers(inspector: WebInspectorElement): Marker[] {
  return Array.from(
    root(inspector).querySelectorAll<HTMLButtonElement>(
      'nav[aria-label="Inspector"] button[data-inspector-menu-key]',
    ),
  )
    .filter((control) => control.querySelector(".inspector-nav-signal-dot"))
    .map((control) => ({
      key: control.getAttribute("data-inspector-menu-key") ?? "",
      tone:
        control
          .querySelector(".inspector-nav-signal-dot")
          ?.getAttribute("data-cpk-signal-tone") ?? null,
    }));
}

function currentMenu(inspector: WebInspectorElement): string | null {
  return (
    root(inspector)
      .querySelector('button[data-inspector-menu-key][aria-current="page"]')
      ?.getAttribute("data-inspector-menu-key") ?? null
  );
}

/** Every stylesheet this component adopts, as one string. */
function stylesheetText(inspector: WebInspectorElement): string {
  return Array.from(root(inspector).querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
}

type Harness = Readonly<{
  core: SignalTestCore;
  inspector: WebInspectorElement;
  store: ɵThreadStore | null;
  telemetryBodies: TelemetryBody[];
  /** Let renders and resolved fetches settle without moving the clock. */
  flush: () => Promise<void>;
  /** Move the clock and settle. The only way time passes in this suite. */
  advance: (ms: number) => Promise<void>;
  /** Publish the held announcement feed, arming the news signal mid-test. */
  releaseAnnouncement: () => Promise<void>;
  breakConnection: () => Promise<void>;
  healConnection: () => Promise<void>;
  breakThreads: () => Promise<void>;
  healThreads: () => Promise<void>;
  /** A real mouse press: pointerdown, pointerup, then click. */
  press: (element: Element | null) => Promise<void>;
  /** Keyboard activation, which fires click with no pointer events. */
  activate: (element: Element | null) => Promise<void>;
  closePanel: () => Promise<void>;
  hideTab: () => Promise<void>;
  showTab: () => Promise<void>;
  teardown: () => void;
}>;

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
});

async function setup(options: Options = {}): Promise<Harness> {
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();
  stubMatchMedia(options.reducedMotion === true);
  if (options.optedOut) {
    window.localStorage.setItem("cpk:inspector:telemetry:opt_out", "true");
  }
  if (options.persistedMenu !== undefined || options.persistedOpen) {
    window.localStorage.setItem(
      INSPECTOR_STATE_KEY,
      JSON.stringify({
        hasOpenedInspector: options.persistedMenu !== undefined,
        ...(options.persistedMenu === undefined
          ? {}
          : { selectedMenu: options.persistedMenu }),
        ...(options.persistedOpen ? { isOpen: true } : {}),
      }),
    );
  }

  const telemetryBodies: TelemetryBody[] = [];
  let releaseAnnouncementFeed: (() => void) | null = null;
  let listFails = options.listFails === true;
  let visibility: DocumentVisibilityState = "visible";
  const visibilityDescriptor = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "visibilityState",
  );
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });

  const fetchMock = Object.assign(
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      ).href;
      if (href === TELEMETRY_INGEST_URL) {
        if (typeof init?.body === "string") {
          telemetryBodies.push(parseTelemetryBody(init.body));
        }
        return new Response(null, { status: 204 });
      }
      if (href === ANNOUNCEMENT_URL) {
        if (options.announcementPending) {
          await new Promise<void>((resolve) => {
            releaseAnnouncementFeed = resolve;
          });
        } else if (!options.announcement) {
          return new Response(null, { status: 404 });
        }
        return jsonResponse({
          timestamp: TIMESTAMP,
          previewText: "Channels are here",
          announcement: "## Channels\n\nRead the release notes.",
        });
      }
      if (href.endsWith("/threads")) {
        if (listFails) {
          return new Response(JSON.stringify({ error: "list refused" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        return jsonResponse({ threads: [], joinCode: null });
      }
      return new Response(null, { status: 404 });
    }),
    globalThis.fetch,
  );
  vi.stubGlobal("fetch", fetchMock);

  // One turn of the event loop, whichever clock is installed. Both branches
  // drain microtasks and zero-delay timers, so a resolved fetch and the render
  // that depends on it land in the same turn.
  const tick = async (ms: number): Promise<void> => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(ms);
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  };

  const flush = async (): Promise<void> => {
    for (let turn = 0; turn < 6; turn += 1) {
      await tick(0);
      await inspector.updateComplete;
    }
  };

  const advance = async (ms: number): Promise<void> => {
    await tick(ms);
    await flush();
  };

  const store = options.endpoints
    ? ɵcreateThreadStore({ fetch: fetchMock })
    : null;
  if (store) {
    store.start();
    store.setContext({
      runtimeUrl: RUNTIME_URL,
      headers: {},
      agentId: AGENT_ID,
    });
    await vi.waitFor(() => {
      expect(Boolean(ɵselectThreadsError(store.getState()))).toBe(listFails);
    });
  }

  const core = new SignalTestCore(options);
  if (store) core.registerThreadStore(AGENT_ID, store);

  if (!options.realTimers) {
    // Installed before the Inspector mounts, so every settle window and every
    // beat this suite asserts on belongs to the fake clock — a timer started
    // during mount would otherwise stay on the real one and never be reached.
    // Limited to the two timer functions the feature uses, so the
    // announcement's date handling is untouched.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  }

  const inspector = new WebInspectorElement();
  document.body.append(inspector);
  inspector.core = core;
  // A configured runtime that answered its handshake: the baseline every
  // scenario below departs from, and the state in which nothing is wrong.
  await core.emitStatus(CopilotKitCoreRuntimeConnectionStatus.Connected);
  await flush();

  const teardown = (): void => {
    vi.useRealTimers();
    inspector.remove();
    if (store) {
      core.unregisterThreadStore(AGENT_ID);
      store.stop();
    }
    if (visibilityDescriptor) {
      Object.defineProperty(document, "visibilityState", visibilityDescriptor);
    } else {
      Reflect.deleteProperty(document, "visibilityState");
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.replaceChildren();
    document.getElementById("cpk-inspector-brand-fonts")?.remove();
  };
  cleanup = teardown;

  const setVisibility = async (
    next: DocumentVisibilityState,
  ): Promise<void> => {
    visibility = next;
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
  };

  return {
    core,
    inspector,
    store,
    telemetryBodies,
    flush,
    advance,
    releaseAnnouncement: async () => {
      required(releaseAnnouncementFeed, "held announcement feed")();
      await flush();
    },
    breakConnection: async () => {
      await core.emitStatus(CopilotKitCoreRuntimeConnectionStatus.Error);
      await flush();
    },
    healConnection: async () => {
      await core.emitStatus(CopilotKitCoreRuntimeConnectionStatus.Connected);
      await flush();
    },
    breakThreads: async () => {
      listFails = true;
      required(store, "thread store").refresh();
      await advance(0);
    },
    healThreads: async () => {
      listFails = false;
      required(store, "thread store").refresh();
      await advance(0);
    },
    press: async (element) => {
      const target = requireElement(element as HTMLElement | null);
      const init = { bubbles: true, composed: true, pointerId: 1, button: 0 };
      target.dispatchEvent(new PointerEvent("pointerdown", init));
      target.dispatchEvent(new PointerEvent("pointerup", init));
      target.click();
      await flush();
    },
    activate: async (element) => {
      requireElement(element as HTMLElement | null).click();
      await flush();
    },
    closePanel: async () => {
      requireElement(
        root(inspector).querySelector<HTMLElement>(
          'button[aria-label="Close Web Inspector"]',
        ),
      ).click();
      await flush();
    },
    hideTab: () => setVisibility("hidden"),
    showTab: () => setVisibility("visible"),
    teardown,
  };
}

/** Arms the connection latch from a healthy start, settle window included. */
async function armConnectionFailure(context: Harness): Promise<void> {
  await context.breakConnection();
  await context.advance(SETTLE_MS);
}

// ── The settle window ─────────────────────────────────────────────────────

test("a failure shorter than the settle window arms nothing at all", async () => {
  const context = await setup();

  await context.breakConnection();
  await context.advance(SETTLE_MS - 500);
  // Nothing yet: a blip that trains a developer to ignore the signal is worse
  // than no signal.
  expect(launcherDot(context.inspector)).toBeNull();

  await context.healConnection();
  await context.advance(SETTLE_MS * 2);

  expect(launcherDot(context.inspector)).toBeNull();
  expect(pulsing(context.inspector)).toBe(false);
});

test("a failure crossing the settle window arms once and beats once", async () => {
  const context = await setup();

  await armConnectionFailure(context);

  expect(launcherDot(context.inspector)).not.toBeNull();
  expect(dotSubject(context.inspector)).toBe("connection");
  expect(launcherTone(context.inspector)).toBe("error");
  expect(pulsing(context.inspector)).toBe(true);

  // One beat, not a strobe.
  await context.advance(ERROR_BEAT_MS);
  expect(pulsing(context.inspector)).toBe(false);
  expect(launcherDot(context.inspector)).not.toBeNull();
});

test("a sustained failure never beats a second time", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);

  // A minute of the same outage is still one problem.
  for (let tick = 0; tick < 6; tick += 1) {
    await context.advance(10_000);
    expect(pulsing(context.inspector)).toBe(false);
  }
  expect(launcherDot(context.inspector)).not.toBeNull();
});

test("a resolved failure clears itself, and a fresh outage beats again", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);

  // Confirmation the fix worked, with nothing to acknowledge and nothing to
  // dismiss — clearing is immediate rather than settled.
  await context.healConnection();
  expect(launcherDot(context.inspector)).toBeNull();
  expect(launcherTone(context.inspector)).toBeNull();

  await armConnectionFailure(context);
  expect(launcherDot(context.inspector)).not.toBeNull();
  expect(pulsing(context.inspector)).toBe(true);
});

test("a second source arming behind the first produces no additional beat", async () => {
  const context = await setup({
    endpoints: ENABLED_ENDPOINTS,
    listFails: true,
  });

  // The thread latch arms first and takes its beat.
  await context.advance(SETTLE_MS);
  expect(dotSubject(context.inspector)).toBe("threads");
  expect(pulsing(context.inspector)).toBe(true);
  await context.advance(ERROR_BEAT_MS);
  expect(pulsing(context.inspector)).toBe(false);

  // A connection failure is the same problem seen from further upstream, so it
  // takes over the dot without nudging again.
  await armConnectionFailure(context);
  expect(dotSubject(context.inspector)).toBe("connection");
  expect(pulsing(context.inspector)).toBe(false);
});

// ── What does not signal ──────────────────────────────────────────────────

test("the disconnected, connecting and unattached states arm nothing", async () => {
  const context = await setup();

  for (const status of [
    CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    CopilotKitCoreRuntimeConnectionStatus.Connecting,
  ]) {
    await context.core.emitStatus(status);
    await context.advance(SETTLE_MS * 2);
    // `disconnected` is also the INITIAL value, so counting it would paint the
    // launcher red on every single page load.
    expect(launcherDot(context.inspector), status).toBeNull();
  }

  // No Core attached at all is not a defect of the developer's wiring.
  const detached = new WebInspectorElement();
  detached.setAttribute("auto-attach-core", "false");
  document.body.append(detached);
  await detached.updateComplete;
  await context.advance(SETTLE_MS * 2);
  expect(
    detached.shadowRoot?.querySelector("[data-cpk-signal-dot]"),
  ).toBeNull();
  detached.remove();
});

test("an unconfigured Intelligence and a locked Learning view arm nothing", async () => {
  // No thread endpoints is "not configured", not "configured and failing", and
  // the Memory store is never even subscribed from here — its subscription is
  // lazy on purpose, because creating it opens a realtime connection.
  const context = await setup();

  await context.press(launcher(context.inspector));
  await context.activate(
    root(context.inspector).querySelector(
      'button[data-inspector-menu-key="memories"]',
    ),
  );
  await context.advance(SETTLE_MS * 2);

  expect(markers(context.inspector)).toEqual([]);
  await context.closePanel();
  expect(launcherDot(context.inspector)).toBeNull();
});

// ── Destinations ──────────────────────────────────────────────────────────

test("a connection failure marks Home and lands on Home", async () => {
  const context = await setup({ persistedMenu: "ag-ui-events" });
  await armConnectionFailure(context);

  await context.press(launcher(context.inspector));

  expect(currentMenu(context.inspector)).toBe("home");
  expect(markers(context.inspector)).toEqual([{ key: "home", tone: "error" }]);
});

test("a thread failure marks Threads and lands on Threads", async () => {
  const context = await setup({
    endpoints: ENABLED_ENDPOINTS,
    listFails: true,
    persistedMenu: "ag-ui-events",
  });
  await context.advance(SETTLE_MS);

  await context.press(launcher(context.inspector));

  expect(currentMenu(context.inspector)).toBe("threads");
  expect(markers(context.inspector)).toEqual([
    { key: "threads", tone: "error" },
  ]);
});

test("pressing the launcher by key lands exactly where a mouse press does", async () => {
  // The launcher opens from its pointerup handler as well as from click, and
  // pointer events land first, so the two paths are genuinely separate.
  const context = await setup({ persistedMenu: "ag-ui-events" });
  await armConnectionFailure(context);

  await context.activate(launcher(context.inspector));

  expect(currentMenu(context.inspector)).toBe("home");
  expect(markers(context.inspector)).toEqual([{ key: "home", tone: "error" }]);
});

test("the marker stays on the entry the reader is standing on", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  await context.press(launcher(context.inspector));

  expect(currentMenu(context.inspector)).toBe("home");
  // A state mirror stays true while it is being read. Suppressing it on the
  // active entry would make it reappear on navigating away.
  expect(markers(context.inspector)).toEqual([{ key: "home", tone: "error" }]);

  await context.activate(
    root(context.inspector).querySelector(
      'button[data-inspector-menu-key="ag-ui-events"]',
    ),
  );
  expect(markers(context.inspector)).toEqual([{ key: "home", tone: "error" }]);
});

test("the marker appears while the panel is open, without a beat", async () => {
  const context = await setup({
    persistedMenu: "ag-ui-events",
    persistedOpen: true,
  });

  expect(markers(context.inspector)).toEqual([]);
  await armConnectionFailure(context);

  // The failure reaches the reader even though the launcher is hidden, and
  // nothing interrupts: the panel is already on screen.
  expect(markers(context.inspector)).toEqual([{ key: "home", tone: "error" }]);
  expect(currentMenu(context.inspector)).toBe("ag-ui-events");
  expect(launcher(context.inspector)).toBeNull();
});

// ── Precedence ────────────────────────────────────────────────────────────

test("a failure outranks an unread announcement while both markers remain", async () => {
  const context = await setup({ announcement: true });

  expect(dotSubject(context.inspector)).toBe("whats-new");
  await context.advance(NEWS_BEAT_MS);
  await armConnectionFailure(context);

  // The more urgent of the two wins the one place available.
  expect(dotSubject(context.inspector)).toBe("connection");
  expect(launcherTone(context.inspector)).toBe("error");
  const errorColor = launcherColor(context.inspector);

  await context.press(launcher(context.inspector));
  expect(markers(context.inspector)).toEqual([
    { key: "home", tone: "error" },
    { key: "whats-new", tone: "news" },
  ]);

  // Suppressing the announcement did not lose it: it is displayed as soon as
  // the failure clears, still unread.
  await context.closePanel();
  await context.healConnection();
  expect(dotSubject(context.inspector)).toBe("whats-new");
  expect(launcherTone(context.inspector)).toBe("news");
  expect(launcherColor(context.inspector)).not.toBe(errorColor);
});

test("the navigation marker takes the failure colour, not the announcement colour", async () => {
  const context = await setup({
    endpoints: ENABLED_ENDPOINTS,
    listFails: true,
    announcement: true,
    persistedOpen: true,
    persistedMenu: "ag-ui-events",
  });
  await context.advance(SETTLE_MS);

  expect(markers(context.inspector)).toEqual([
    { key: "whats-new", tone: "news" },
    { key: "threads", tone: "error" },
  ]);

  const css = stylesheetText(context.inspector);
  const newsRule =
    /\.inspector-nav-signal-dot\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  const errorRule =
    /\.inspector-nav-signal-dot\[data-cpk-signal-tone="error"\]\s*\{([\s\S]*?)\}/.exec(
      css,
    )?.[1] ?? "";
  expect(newsRule.toUpperCase()).toContain("#A78BFA");
  expect(errorRule).toMatch(/background:\s*#[0-9A-Fa-f]{6}/);
  expect(errorRule.toUpperCase()).not.toContain("#A78BFA");
});

// ── Deferral: four reasons, four flush points ─────────────────────────────

test("a beat deferred because the panel is open runs when the panel closes", async () => {
  const context = await setup({
    persistedMenu: "ag-ui-events",
    persistedOpen: true,
  });
  await armConnectionFailure(context);
  expect(markers(context.inspector)).toHaveLength(1);

  await context.closePanel();

  expect(pulsing(context.inspector)).toBe(true);
  expect(dotSubject(context.inspector)).toBe("connection");
});

test("a beat deferred because the tab is hidden runs when the tab returns", async () => {
  const context = await setup();
  await context.hideTab();
  await armConnectionFailure(context);

  // The dot is already there; only the nudge waits for somebody to look.
  expect(launcherDot(context.inspector)).not.toBeNull();
  expect(pulsing(context.inspector)).toBe(false);

  await context.showTab();
  expect(pulsing(context.inspector)).toBe(true);
});

test("a beat deferred behind a running beat runs when that beat ends", async () => {
  const context = await setup({ announcement: true });

  // The announcement's beat is in flight; the failure's settle window is
  // arranged to land inside it.
  expect(pulsing(context.inspector)).toBe(true);
  expect(dotSubject(context.inspector)).toBe("whats-new");
  await context.breakConnection();
  await context.advance(SETTLE_MS);

  // The failure owns the resting dot immediately, but did not truncate the
  // announcement's beat or repaint it mid-flight.
  expect(dotSubject(context.inspector)).toBe("connection");
  expect(pulsing(context.inspector)).toBe(false);

  // Just past the announcement's own cadence, so its beat ends and the
  // failure's runs whole rather than as its final fraction.
  await context.advance(NEWS_BEAT_MS - SETTLE_MS + 100);
  expect(pulsing(context.inspector)).toBe(true);
  expect(dotSubject(context.inspector)).toBe("connection");
});

test("a beat deferred because another signal owns the dot runs when that clears", async () => {
  const context = await setup({ announcementPending: true });

  // The failure arrives first and takes the dot.
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);
  expect(dotSubject(context.inspector)).toBe("connection");

  // Now the announcement is published. It cannot beat, because the failure
  // owns the dot, and its once-per-tab token stays deliberately unspent.
  await context.releaseAnnouncement();
  expect(dotSubject(context.inspector)).toBe("connection");
  expect(pulsing(context.inspector)).toBe(false);
  expect(window.sessionStorage.getItem(PULSED_SESSION_KEY)).toBeNull();

  await context.healConnection();

  expect(dotSubject(context.inspector)).toBe("whats-new");
  expect(pulsing(context.inspector)).toBe(true);
  // Spent only now that it has actually been shown.
  expect(window.sessionStorage.getItem(PULSED_SESSION_KEY)).toBe(TIMESTAMP);
});

test("the one pending slot goes to the more urgent beat, and loses nothing", async () => {
  const context = await setup({ announcement: true, persistedOpen: true });

  // The announcement armed with the panel open, so its beat is pending. The
  // failure then arms and needs the same slot.
  expect(window.sessionStorage.getItem(PULSED_SESSION_KEY)).toBeNull();
  await armConnectionFailure(context);
  await context.closePanel();

  expect(dotSubject(context.inspector)).toBe("connection");
  expect(pulsing(context.inspector)).toBe(true);
  await context.advance(ERROR_BEAT_MS);

  // The announcement lost the slot but not the nudge: its token is unspent, so
  // it beats the next time it arms — the token is only ever written by a beat
  // that actually ran.
  await context.healConnection();
  expect(dotSubject(context.inspector)).toBe("whats-new");
  expect(window.sessionStorage.getItem(PULSED_SESSION_KEY)).toBeNull();
});

test("a deferred beat whose problem has already been fixed does not run", async () => {
  const context = await setup({
    persistedMenu: "ag-ui-events",
    persistedOpen: true,
  });
  await armConnectionFailure(context);
  expect(markers(context.inspector)).toHaveLength(1);

  await context.healConnection();
  await context.closePanel();

  // Nobody is nudged about something that no longer exists.
  expect(pulsing(context.inspector)).toBe(false);
  expect(launcherDot(context.inspector)).toBeNull();
});

// ── Text, motion and assistive technology ────────────────────────────────

test("reduced motion conveys the failure without animating it", async () => {
  const context = await setup({ reducedMotion: true });
  await armConnectionFailure(context);

  // The information arrives; the movement does not.
  expect(launcherDot(context.inspector)).not.toBeNull();
  expect(launcherTone(context.inspector)).toBe("error");

  const css = stylesheetText(context.inspector);
  const reducedMotion = css.slice(
    css.indexOf("@media (prefers-reduced-motion: reduce)"),
  );
  // Attribute-presence selectors, so the second tone inherits the treatment.
  expect(reducedMotion).toContain(".console-button[data-cpk-signal]::before");
  expect(reducedMotion).toContain("animation: none");
});

test("the accessible name names the failure class and then goes back to plain", async () => {
  const context = await setup();
  expect(launcherName(context.inspector)).toBe("Web Inspector");

  await armConnectionFailure(context);
  expect(launcherName(context.inspector)).toBe("Web Inspector, runtime error");

  await context.healConnection();
  expect(launcherName(context.inspector)).toBe("Web Inspector");
});

test("a thread failure names its own class on the launcher and its entry", async () => {
  const context = await setup({
    endpoints: ENABLED_ENDPOINTS,
    listFails: true,
  });
  await context.advance(SETTLE_MS);

  expect(launcherName(context.inspector)).toBe(
    "Web Inspector, thread loading error",
  );

  await context.press(launcher(context.inspector));
  expect(
    root(context.inspector)
      .querySelector('button[data-inspector-menu-key="threads"]')
      ?.getAttribute("aria-label"),
  ).toBe("Threads, thread loading error");
});

test("nothing new is rendered over the host application", async () => {
  const context = await setup();
  await armConnectionFailure(context);

  const button = requireElement(launcher(context.inspector));
  // No tooltip and no label: a developer who deliberately ships the Inspector
  // to production must not leak internal failure detail to their end users.
  expect(button.getAttribute("title")).toBeNull();
  const rendered = Array.from(root(context.inspector).children)
    .filter((child) => child.tagName !== "STYLE")
    .map((child) => child.textContent?.trim() ?? "")
    .join("");
  expect(rendered).toBe("");
  for (const decoration of [
    ".cpk-launcher-signal-wash",
    ".cpk-launcher-signal-dot",
  ]) {
    expect(
      requireElement(
        root(context.inspector).querySelector(decoration),
      ).getAttribute("aria-hidden"),
    ).toBe("true");
  }
});

// ── Nothing is remembered ─────────────────────────────────────────────────

test("the error signal stores nothing, because it mirrors live state", async () => {
  const context = await setup();
  const before = new Set(Object.keys(window.localStorage));

  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);

  // No read state, no acknowledgement, no message. There is nothing to
  // acknowledge and nothing to dismiss, so there is nothing to persist —
  // "never persisted" is expressed by not persisting.
  const added = Object.keys(window.localStorage).filter(
    (key) => !before.has(key),
  );
  expect(added).toEqual([]);
  expect(Object.keys(window.sessionStorage)).toEqual([]);

  const stored = [
    ...Object.keys(window.localStorage).map(
      (key) => window.localStorage.getItem(key) ?? "",
    ),
    ...Object.keys(window.sessionStorage).map(
      (key) => window.sessionStorage.getItem(key) ?? "",
    ),
  ].join("|");
  expect(stored).not.toContain("error");
  expect(stored).not.toContain(RUNTIME_URL);
});

// ── Telemetry ─────────────────────────────────────────────────────────────

function errorSignalEvents(context: Harness): TelemetryBody[] {
  return context.telemetryBodies.filter(
    (body) => body.event === TELEMETRY_EVENTS.errorSignalViewed,
  );
}

test("the visibility event fires when the dot appears, not when it arms", async () => {
  const context = await setup({
    persistedMenu: "ag-ui-events",
    persistedOpen: true,
  });

  await armConnectionFailure(context);
  // Armed, marked, and deliberately uncounted: there is no launcher to see.
  expect(markers(context.inspector)).toHaveLength(1);
  expect(errorSignalEvents(context)).toHaveLength(0);

  await context.closePanel();
  await context.flush();

  expect(errorSignalEvents(context)).toHaveLength(1);
  expect(errorSignalEvents(context)[0]?.properties).toMatchObject({
    source: "connection",
    presentation: "animated",
  });

  // Once per outage, however many renders follow.
  await context.advance(ERROR_BEAT_MS * 4);
  expect(errorSignalEvents(context)).toHaveLength(1);
});

test("the visibility event reports the thread source and reduced motion", async () => {
  const context = await setup({
    endpoints: ENABLED_ENDPOINTS,
    listFails: true,
    reducedMotion: true,
  });
  await context.advance(SETTLE_MS);

  expect(errorSignalEvents(context)).toHaveLength(1);
  expect(errorSignalEvents(context)[0]?.properties).toMatchObject({
    source: "threads",
    presentation: "reduced_motion",
  });
});

test("the open event carries the error signal and its class", async () => {
  const context = await setup();
  await armConnectionFailure(context);

  await context.press(launcher(context.inspector));
  await context.flush();

  const opens = context.telemetryBodies.filter(
    (body) => body.event === TELEMETRY_EVENTS.opened,
  );
  expect(opens).toHaveLength(1);
  expect(opens[0]?.properties).toMatchObject({
    has_error_signal: true,
    error_signal_source: "connection",
    has_unseen_announcement: false,
  });
});

test("no telemetry payload anywhere carries the failure message", async () => {
  const context = await setup({
    endpoints: ENABLED_ENDPOINTS,
    listFails: true,
  });
  await context.advance(SETTLE_MS);
  await context.press(launcher(context.inspector));
  await context.flush();

  expect(context.telemetryBodies.length).toBeGreaterThan(0);
  for (const body of context.telemetryBodies) {
    const serialized = JSON.stringify(body.properties);
    expect(serialized).not.toContain("list refused");
    expect(serialized).not.toContain("503");
    expect(serialized).not.toContain(RUNTIME_URL);
    for (const key of Object.keys(body.properties)) {
      expect(key).not.toMatch(/message|detail|reason|stack/);
    }
  }
});

test("an opted-out session sends nothing whatever fails", async () => {
  const context = await setup({ optedOut: true });
  await armConnectionFailure(context);
  await context.press(launcher(context.inspector));
  await context.flush();

  expect(context.telemetryBodies).toEqual([]);
});

test("a runtime that disabled telemetry sends nothing whatever fails", async () => {
  const context = await setup({ telemetryDisabled: true });
  await armConnectionFailure(context);
  await context.press(launcher(context.inspector));
  await context.flush();

  expect(context.telemetryBodies).toEqual([]);
});

// ── Beat completion, on real timers ───────────────────────────────────────

// Real timers, as in the announcement suite: this is the one assertion about a
// duration rather than a transition.
test("the beat ends and leaves the resting dot behind", async () => {
  const context = await setup({ realTimers: true });

  await context.breakConnection();
  await context.advance(SETTLE_MS + 200);
  expect(pulsing(context.inspector)).toBe(true);

  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (!pulsing(context.inspector)) break;
    await context.advance(20);
  }

  expect(pulsing(context.inspector)).toBe(false);
  expect(launcherDot(context.inspector)).not.toBeNull();
  expect(launcherTone(context.inspector)).toBe("error");
}, 20_000);
