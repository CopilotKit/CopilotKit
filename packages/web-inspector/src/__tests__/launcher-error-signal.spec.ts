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
// Timers: fake for the beat and pill, which would otherwise take several
// real seconds per case. Beat *completion* keeps real timers, as the
// announcement suite does, because that is the one assertion about a
// duration rather than a transition.

import {
  CopilotKitCore,
  CopilotKitCoreErrorCode,
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

import type { AbstractAgent } from "@ag-ui/client";
import { WebInspectorElement } from "../index.js";
import { TELEMETRY_EVENTS, TELEMETRY_INGEST_URL } from "../lib/telemetry.js";

const RUNTIME_URL = "https://runtime.error-signal.test";
const AGENT_ID = "error-signal-agent";
const ANNOUNCEMENT_URL = "https://cdn.copilotkit.ai/announcements.json";
const INSPECTOR_STATE_KEY = "cpk:inspector:state";
const PULSED_SESSION_KEY = "cpk:inspector:pulsed";
const TIMESTAMP = "2026-08-01T09:00:00.000Z";

// The contract, not an implementation detail: an error beats faster than
// product news. Wiring failures arm as soon as the network reports them.
const ERROR_BEAT_MS = 400;
const NEWS_BEAT_MS = 2100;

// The gesture's remaining three phases, stated ONCE for this whole suite. The
// durations are taste and are expected to be tuned by eye after the first live
// look — `ERROR_GESTURE_MS` in the implementation is the single place they are
// declared, and this is the single place any test expectation reads them, so
// tuning the feel stays a number rather than a refactor.
const PILL_OPEN_MS = 250;
const PILL_HOLD_MS = 2500;
const PILL_CLOSE_MS = 250;
/** Beat, open, hold and close, end to end. */
const GESTURE_MS = ERROR_BEAT_MS + PILL_OPEN_MS + PILL_HOLD_MS + PILL_CLOSE_MS;

/** The words the panel already uses, which the pill repeats verbatim. */
const RUNTIME_ERROR_WORDS = "Runtime error";
const THREADS_ERROR_WORDS = "Failed to load threads";

/**
 * The pill's second line: the one string in this feature that appears nowhere
 * else in the product, and the only one that is shown without being spoken.
 */
const PILL_SUBLINE_WORDS = "Open Inspector for details";

/** The launcher's rendered diameter at the suite's viewport. */
const LAUNCHER_SIZE = 52;

/** The margin the pill keeps between itself and the window edge. */
const EDGE_MARGIN = 16;

/**
 * The pill's natural width at its widest label, as the direction logic would
 * measure it. jsdom lays nothing out — every rect is zero — so this is stubbed
 * rather than measured; see `stubGeometry`.
 *
 * It grew when the pill did: the mark-side padding went from `+2px` to `+12px`,
 * and the subline is now the widest line in it rather than the failure class.
 * It moved again when the text-side padding stopped being a literal and the two
 * lines grew a point: padding is measured from the bounding box, but the first
 * half-height of that side is the rounded cap, so a bare 14px left the text
 * sitting inside the curve. That side is now exactly `size / 2` — the radius —
 * which lands the text where the cap ends, i.e. 26 at this harness's launcher
 * size of 52.
 * Checked against a real browser at 12px/10.5px: 26 text-side padding +
 * 130 subline + 64 mark-side padding + 2 border. The threshold at which neither
 * side has room moved with it, which is what the two tests either side of
 * `TIGHTEST_FIT` pin down.
 */
const PILL_WIDTH = 222;

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
  /**
   * Configure Intelligence. Only the Learning tests need it: without it the
   * view stays a locked teaser, so the memory latch is unreachable — which is
   * itself the subject of one of those tests.
   */
  intelligence?: boolean;
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

/**
 * A memory store whose error is settable.
 *
 * The real store cannot fail in this suite: it only fetches once it has an
 * Intelligence context, and `intelligence` is overridden to undefined here on
 * purpose. So the `memory` latch needs a store that can be told to fail.
 * Defaults match an unconfigured deployment — not available, no error — so the
 * exclusion tests keep meaning what they say.
 */
type TestMemoryState = {
  memories: never[];
  isLoading: boolean;
  isMutating: boolean;
  error: { message: string } | null;
  context: null;
  sessionId: number;
  available: boolean;
  realtimeStatus: "connecting" | "connected" | "unavailable";
};

function createTestMemoryStore() {
  // Replaced, never mutated. The store's selectors are memoized on the state
  // they were handed, so a stub that edits one object in place reports the
  // stale value forever and looks exactly like a signal that does not fire.
  let state: TestMemoryState = {
    memories: [],
    isLoading: false,
    isMutating: false,
    error: null,
    context: null,
    sessionId: 0,
    available: false,
    realtimeStatus: "unavailable",
  };
  const notifiers: Array<() => void> = [];
  const store = {
    getState: () => state,
    select: <T>(selector: (s: TestMemoryState) => T) => ({
      subscribe: (callback: (value: T) => void) => {
        let last = selector(state);
        callback(last);
        const notify = () => {
          const next = selector(state);
          if (next === last) return;
          last = next;
          callback(next);
        };
        notifiers.push(notify);
        return {
          unsubscribe: () => {
            const index = notifiers.indexOf(notify);
            if (index >= 0) notifiers.splice(index, 1);
          },
        };
      },
    }),
  };
  return {
    store,
    /** A configured deployment whose load call is refused, or recovers. */
    setError(message: string | null) {
      state = {
        ...state,
        available: true,
        realtimeStatus: "connected",
        error: message === null ? null : { message },
      };
      // Copied: a callback may unsubscribe while this loop is running.
      for (const notify of notifiers.slice()) notify();
    },
  };
}

class SignalTestCore extends CopilotKitCore {
  private readonly endpointsValue: ThreadEndpointRuntimeInfo | undefined;
  private readonly telemetryDisabledValue: boolean;
  private readonly intelligenceValue: IntelligenceRuntimeInfo | undefined;

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
    this.intelligenceValue =
      options.intelligence === true
        ? { wsUrl: "wss://intelligence.test" }
        : undefined;
  }

  override get threadEndpoints(): ThreadEndpointRuntimeInfo | undefined {
    return this.endpointsValue;
  }

  override get intelligence(): IntelligenceRuntimeInfo | undefined {
    return this.intelligenceValue;
  }

  readonly memory = createTestMemoryStore();

  // Same laziness as the real core: the store is only ever reached from the
  // Learning view, which is the whole reason `memory` is an unread event
  // rather than a state the launcher can mirror from a cold start.
  override getMemoryStore() {
    return this.memory.store as unknown as ReturnType<
      CopilotKitCore["getMemoryStore"]
    >;
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

  async emitAppError(
    code: CopilotKitCoreErrorCode,
    message = "lab failure",
    context: Record<string, unknown> = {},
  ): Promise<void> {
    await this.notifySubscribers(
      (subscriber) =>
        subscriber.onError?.({
          copilotkit: this,
          error: new Error(message),
          code,
          context,
        }),
      "Error-signal test onError subscriber failed",
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

/** The pill on the closed launcher, or null when the launcher is not talking. */
function pill(inspector: WebInspectorElement): HTMLElement | null {
  return root(inspector).querySelector<HTMLElement>("[data-cpk-launcher-pill]");
}

/** Which subject the pill names, or null when there is no pill. */
function pillSubject(inspector: WebInspectorElement): string | null {
  return pill(inspector)?.getAttribute("data-cpk-launcher-pill") ?? null;
}

/** The pill's first line — the failure class — or null when there is no pill. */
function pillHeading(inspector: WebInspectorElement): string | null {
  return lineText(inspector, "heading");
}

/** The pill's second line, which invites the click that now works. */
function pillSubline(inspector: WebInspectorElement): string | null {
  return lineText(inspector, "subline");
}

function lineText(
  inspector: WebInspectorElement,
  line: "heading" | "subline",
): string | null {
  const text = pill(inspector)
    ?.querySelector(`[data-cpk-pill-${line}]`)
    ?.textContent?.trim();
  return text === undefined || text === "" ? null : text;
}

/** Which side the pill grew from, or null when there is no pill. */
function pillDirection(inspector: WebInspectorElement): string | null {
  return pill(inspector)?.getAttribute("data-cpk-pill-direction") ?? null;
}

/**
 * Where the pill is in the gesture. `closed` is the reveal's start state, held
 * for the whole beat so the pill's full width can be measured before anything
 * is shown.
 */
function pillPhase(inspector: WebInspectorElement): string | null {
  return pill(inspector)?.getAttribute("data-cpk-pill-phase") ?? null;
}

/** Whether the pill is actually showing its words. */
const pillOpen = (inspector: WebInspectorElement): boolean => {
  const phase = pillPhase(inspector);
  return phase === "opening" || phase === "holding" || phase === "closing";
};

/** What the launcher has spoken into its polite live region, if anything. */
function spoken(inspector: WebInspectorElement): string {
  return (
    root(inspector)
      .querySelector("[data-cpk-launcher-announcement]")
      ?.textContent?.trim() ?? ""
  );
}

function liveRegion(inspector: WebInspectorElement): HTMLElement | null {
  return root(inspector).querySelector<HTMLElement>(
    "[data-cpk-launcher-announcement]",
  );
}

/** Every word this component puts on the host page, whitespace collapsed. */
function renderedText(inspector: WebInspectorElement): string {
  return Array.from(root(inspector).children)
    .filter((child) => child.tagName !== "STYLE")
    .map((child) => child.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Gives the launcher and the pill real dimensions, because jsdom lays nothing
 * out: every rect is zero, so the pill would trivially fit on either side and
 * the direction decision would never be exercised.
 *
 * `launcherLeft` is where the launcher's left edge sits, which is what a
 * reader changes by dragging it, and `pillWidth` is the pill's natural width
 * at its full label.
 */
let restoreViewportWidth: (() => void) | null = null;

function stubGeometry(options: {
  launcherLeft: number;
  pillWidth: number;
  viewportWidth: number;
}): void {
  const previousWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: options.viewportWidth,
  });
  restoreViewportWidth = () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: previousWidth,
    });
  };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement): DOMRect {
      const box = (left: number, width: number): DOMRect =>
        ({
          x: left,
          y: 0,
          left,
          right: left + width,
          top: 0,
          bottom: LAUNCHER_SIZE,
          width,
          height: LAUNCHER_SIZE,
          toJSON: () => ({}),
        }) as DOMRect;
      if (this.classList.contains("console-button")) {
        return box(options.launcherLeft, LAUNCHER_SIZE);
      }
      if (this.hasAttribute("data-cpk-launcher-pill")) {
        // A clip never changes the layout box, so this is the full width
        // whichever phase the pill is in.
        return box(options.launcherLeft, options.pillWidth);
      }
      return box(0, 0);
    },
  );
}

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
  fireAppError: (
    code: CopilotKitCoreErrorCode,
    message?: string,
    context?: Record<string, unknown>,
  ) => Promise<void>;
  /** Refuse, or un-refuse, the Learning load on a configured deployment. */
  failMemory: (message: string | null) => Promise<void>;
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
  restoreViewportWidth?.();
  restoreViewportWidth = null;
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
    // Installed before the Inspector mounts, so every beat this suite asserts
    // on belongs to the fake clock — a timer started during mount would
    // otherwise stay on the real one and never be reached.
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
    fireAppError: async (code, message, errorContext) => {
      await core.emitAppError(code, message, errorContext);
      await flush();
    },
    failMemory: async (message) => {
      core.memory.setError(message);
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

/** Arms the connection latch from a healthy start. */
async function armConnectionFailure(context: Harness): Promise<void> {
  await context.breakConnection();
}

// ── Arming ────────────────────────────────────────────────────────────────

test("a connection failure that heals before the next render arms nothing", async () => {
  const context = await setup();

  await context.core.emitStatus(CopilotKitCoreRuntimeConnectionStatus.Error);
  await context.core.emitStatus(
    CopilotKitCoreRuntimeConnectionStatus.Connected,
  );
  await context.flush();

  expect(launcherDot(context.inspector)).toBeNull();
  expect(pulsing(context.inspector)).toBe(false);
});

test("a connection failure arms at once and beats once", async () => {
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

test("a reconnect in flight does not clear a runtime error", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  expect(launcherDot(context.inspector)).not.toBeNull();

  await context.core.emitStatus(
    CopilotKitCoreRuntimeConnectionStatus.Connecting,
  );
  await context.flush();
  expect(launcherDot(context.inspector)).not.toBeNull();

  await context.healConnection();
  expect(launcherDot(context.inspector)).toBeNull();
});

test("a thread refetch that is still failing keeps the latch", async () => {
  const context = await setup({
    endpoints: ENABLED_ENDPOINTS,
    listFails: true,
  });
  expect(dotSubject(context.inspector)).toBe("threads");

  await context.breakThreads();
  expect(dotSubject(context.inspector)).toBe("threads");
});

test("a second source arming behind the first produces no additional beat", async () => {
  const context = await setup({
    endpoints: ENABLED_ENDPOINTS,
    listFails: true,
  });

  // The thread latch arms first and takes its beat.
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
    await context.flush();
    // `disconnected` is also the INITIAL value, so counting it would paint the
    // launcher red on every single page load.
    expect(launcherDot(context.inspector), status).toBeNull();
  }

  // No Core attached at all is not a defect of the developer's wiring.
  const detached = new WebInspectorElement();
  detached.setAttribute("auto-attach-core", "false");
  document.body.append(detached);
  await detached.updateComplete;
  await context.flush();
  expect(
    detached.shadowRoot?.querySelector("[data-cpk-signal-dot]"),
  ).toBeNull();
  detached.remove();
});

test("an unconfigured Intelligence and a locked Learning view arm nothing", async () => {
  // No thread endpoints is "not configured", not "configured and failing". Same
  // for Learning: opening the view does subscribe the Memory store — that is
  // what the activation below does — but without an Intelligence context the
  // store never fetches, so there is no failure to report. A locked view is a
  // product state, not a defect.
  const context = await setup();

  await context.press(launcher(context.inspector));
  await context.activate(
    root(context.inspector).querySelector(
      'button[data-inspector-menu-key="memories"]',
    ),
  );
  await context.flush();

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

  expect(pulsing(context.inspector)).toBe(true);
  expect(dotSubject(context.inspector)).toBe("whats-new");
  await context.breakConnection();

  // The failure owns the resting dot immediately, but does not truncate the
  // announcement's beat or repaint it mid-flight.
  expect(dotSubject(context.inspector)).toBe("connection");
  expect(pulsing(context.inspector)).toBe(false);

  await context.advance(NEWS_BEAT_MS + 100);
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
  // The failure's pill is closing early, and the gesture holds the slot until
  // it has finished: the announcement waits out the close rather than beating
  // over the top of a pill that is still on screen.
  expect(pulsing(context.inspector)).toBe(false);
  await context.advance(PILL_CLOSE_MS);

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

// The contract this test guards CHANGED with the pill: "nothing overlays the
// host application" became "nothing STAYS over the host application". The pill
// deliberately covers more of the page for about three seconds and then does
// not, which is the whole feature — so the assertion is now about what is left
// behind rather than about whether anything ever appears.
test("nothing stays over the host application once the gesture has finished", async () => {
  const context = await setup();
  await armConnectionFailure(context);

  const button = requireElement(launcher(context.inspector));
  // No tooltip, still: a developer who deliberately ships the Inspector to
  // production must not leak internal failure detail to their end users, and
  // the pill carries a fixed failure *class*, never a message.
  expect(button.getAttribute("title")).toBeNull();

  // Mid-gesture the pill is on the page and says its piece: the failure class
  // twice over and only twice — once visibly on the pill and once in the live
  // region, which are the same words by design — plus the pill's second line,
  // which is shown and never spoken.
  await context.advance(ERROR_BEAT_MS + PILL_OPEN_MS);
  expect(renderedText(context.inspector)).toBe(
    `${RUNTIME_ERROR_WORDS} ${PILL_SUBLINE_WORDS} ${RUNTIME_ERROR_WORDS}`,
  );

  // Afterwards nothing of it remains — not the pill, and not the sentence in
  // the live region. The dot goes on carrying the state; the gesture carried
  // only the moment.
  await context.advance(PILL_HOLD_MS + PILL_CLOSE_MS);
  expect(pill(context.inspector)).toBeNull();
  expect(spoken(context.inspector)).toBe("");
  expect(renderedText(context.inspector)).toBe("");
  expect(launcherDot(context.inspector)).not.toBeNull();

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

// ── The pill ──────────────────────────────────────────────────────────────
//
// One gesture per outage: the beat says *here*, then the launcher opens
// sideways into a pill that says *this*, holds long enough to be read, and
// closes back to the plain mark with its dot.

test("a failure opens exactly one pill, after the beat, with the source's words", async () => {
  const context = await setup();
  await armConnectionFailure(context);

  // During the beat the pill is already laid out at full width and clipped to
  // nothing, so its room can be measured before anything is shown.
  expect(pillPhase(context.inspector)).toBe("closed");
  expect(pillOpen(context.inspector)).toBe(false);
  expect(pulsing(context.inspector)).toBe(true);

  // The beat first, then the pill: sequential, not simultaneous.
  await context.advance(ERROR_BEAT_MS);
  expect(pulsing(context.inspector)).toBe(false);
  expect(pillPhase(context.inspector)).toBe("opening");
  expect(pillSubject(context.inspector)).toBe("connection");
  expect(pillHeading(context.inspector)).toBe(RUNTIME_ERROR_WORDS);

  await context.advance(PILL_OPEN_MS);
  expect(pillPhase(context.inspector)).toBe("holding");

  await context.advance(PILL_HOLD_MS);
  expect(pillPhase(context.inspector)).toBe("closing");

  // Back to the plain mark with its dot. Nothing to dismiss, nothing left.
  await context.advance(PILL_CLOSE_MS);
  expect(pill(context.inspector)).toBeNull();
  expect(launcherDot(context.inspector)).not.toBeNull();
});

test("a thread failure's pill carries the Threads view's own words", async () => {
  const context = await setup({
    endpoints: ENABLED_ENDPOINTS,
    listFails: true,
  });
  await context.advance(ERROR_BEAT_MS);

  expect(pillSubject(context.inspector)).toBe("threads");
  expect(pillHeading(context.inspector)).toBe(THREADS_ERROR_WORDS);
});

// ── Two lines, one pill height ────────────────────────────────────────────

test("the pill stacks the failure class over the invitation to open", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);

  // The heading is the panel's own wording; the subline is the one line of
  // copy in this feature that exists nowhere else in the product, and it is
  // there because the pill is clickable and has to say so.
  expect(pillHeading(context.inspector)).toBe(RUNTIME_ERROR_WORDS);
  expect(pillSubline(context.inspector)).toBe(PILL_SUBLINE_WORDS);
});

test("every subject's pill carries the same subline", async () => {
  const context = await setup({
    endpoints: ENABLED_ENDPOINTS,
    listFails: true,
  });
  await context.advance(ERROR_BEAT_MS);

  // Shared, not per-source: the invitation is about the control, not about
  // which thing broke.
  expect(pillHeading(context.inspector)).toBe(THREADS_ERROR_WORDS);
  expect(pillSubline(context.inspector)).toBe(PILL_SUBLINE_WORDS);
});

test("the second line does not make the pill taller than the launcher", async () => {
  const context = await setup();
  const css = stylesheetText(context.inspector);
  const pillRule = /\.cpk-launcher-pill\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";

  // Two lines inside an unchanged height: a column, centred, with the pill's
  // height still pinned to the launcher's own diameter. Growing the pill
  // vertically would break the capsule it forms with the mark.
  expect(pillRule).toContain("height: var(--cpk-launcher-size)");
  expect(pillRule).toContain("flex-direction: column");
  expect(pillRule).toContain("justify-content: center");
  expect(pillRule).toContain("gap: 1px");
  expect(pillRule).not.toContain("min-height");

  // The two lines are typographically distinct, and the subline recedes.
  const heading =
    /\.cpk-launcher-pill__heading\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  const subline =
    /\.cpk-launcher-pill__subline\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  expect(heading).toContain("font-size: 12px");
  expect(heading).toContain("line-height: 1.2");
  expect(subline).toContain("font-size: 10.5px");
  expect(subline).toContain("line-height: 1.2");
  expect(subline).toContain("font-weight: 500");
  expect(subline).toContain("opacity: 0.72");
});

test("the pill's text is held off its own border and clear of the mark", async () => {
  const context = await setup();
  const css = stylesheetText(context.inspector);

  // Both directions, because the mark is on the other end in each: the text
  // side gets room so the words do not sit against the border, and the mark
  // side clears the circle with room to spare. Widening the pill moves the
  // threshold at which neither side has room — see PILL_WIDTH.
  //
  // The text side must stay derived from the capsule's radius rather than a
  // literal. Padding is measured from the bounding box, but the first
  // half-height of that side is the rounded cap, so a bare 14px put the words
  // 16px inside the curve at the production launcher size. Asserted as an
  // expression so a later "simplification" back to a literal fails here.
  for (const direction of ["left", "right"]) {
    const rule =
      new RegExp(
        `\\.cpk-launcher-pill\\[data-cpk-pill-direction="${direction}"\\]\\s*\\{([\\s\\S]*?)\\}`,
      ).exec(css)?.[1] ?? "";
    expect(rule).toContain("calc(var(--cpk-launcher-size) / 2)");
    expect(rule).toContain("calc(var(--cpk-launcher-size) + 12px)");
    expect(rule).not.toMatch(/(^|[^-\d])14px/);
  }
});

test("the pill and the launcher share one surface and one edge", async () => {
  // The pill used to carry a red-tinted border of its own, which read as a
  // second object rather than the launcher opening. Both now resolve the same
  // two custom properties, declared once on the wrapper, so they cannot drift
  // apart in a later edit. Asserted as the token, not the colour: the value is
  // allowed to change, the sharing is not.
  const context = await setup();
  const css = stylesheetText(context.inspector);

  const wrapper =
    /\.console-button-wrapper\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  expect(wrapper).toContain("--cpk-launcher-face:");
  expect(wrapper).toContain("--cpk-launcher-edge:");

  // The selector appears more than once — a base rule for geometry and a brand
  // override for colour — so gather every block rather than the first.
  const allBlocks = (selector: RegExp): string =>
    [...css.matchAll(selector)].map((match) => match[1] ?? "").join("\n");

  const buttonRules = allBlocks(/\.console-button\s*\{([\s\S]*?)\}/g);
  expect(buttonRules).toContain("var(--cpk-launcher-face)");
  expect(buttonRules).toContain("var(--cpk-launcher-edge)");

  const pillRules = allBlocks(/\.cpk-launcher-pill\s*\{([\s\S]*?)\}/g);
  expect(pillRules).toContain("var(--cpk-launcher-face)");
  expect(pillRules).toContain("var(--cpk-launcher-edge)");
  expect(pillRules).not.toContain("color-mix");
});

test("the pill repeats the words the panel itself uses", async () => {
  // The outside and the inside must agree: a reader who sees the pill and then
  // opens the panel finds the identical sentence and has nothing to reconcile.
  const context = await setup();
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);
  const words = required(pillHeading(context.inspector), "runtime pill");

  await context.press(launcher(context.inspector));
  expect(currentMenu(context.inspector)).toBe("home");
  expect(root(context.inspector).textContent).toContain(words);
});

test("an unread announcement beats without opening a pill", async () => {
  // Refused on a measurement, not deferred for effort: the feed's preview text
  // is 54 characters against a 36-pixel launcher, and the width would be set
  // by a feed we do not control. The pill is read from the signal's own label,
  // so the announcement simply declares none.
  const context = await setup({ announcement: true });

  expect(dotSubject(context.inspector)).toBe("whats-new");
  expect(pulsing(context.inspector)).toBe(true);
  expect(pill(context.inspector)).toBeNull();
  expect(spoken(context.inspector)).toBe("");

  await context.advance(NEWS_BEAT_MS + PILL_OPEN_MS + PILL_HOLD_MS);
  expect(pill(context.inspector)).toBeNull();
  expect(spoken(context.inspector)).toBe("");
});

test("a sustained failure opens no second pill", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  await context.advance(GESTURE_MS);
  expect(pill(context.inspector)).toBeNull();

  // A minute of the same outage is still one problem, and one gesture.
  for (let tick = 0; tick < 6; tick += 1) {
    await context.advance(10_000);
    expect(pill(context.inspector)).toBeNull();
  }
  expect(launcherDot(context.inspector)).not.toBeNull();
});

test("a resolved-and-recurring failure opens a second pill", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  await context.advance(GESTURE_MS);

  await context.healConnection();
  expect(pill(context.inspector)).toBeNull();

  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);
  expect(pillOpen(context.inspector)).toBe(true);
  expect(pillHeading(context.inspector)).toBe(RUNTIME_ERROR_WORDS);
});

test("a failure resolving mid-beat leaves the beat to finish and opens no pill", async () => {
  const context = await setup({ announcementPending: true });
  await armConnectionFailure(context);
  expect(pulsing(context.inspector)).toBe(true);
  expect(pillOpen(context.inspector)).toBe(false);

  // An announcement is published while the failure's beat is in flight, and
  // then the failure is fixed halfway through it. The beat is left alone,
  // because a beat asserts nothing: it says *here*, and here is still where
  // the launcher is. The announcement's own beat therefore keeps waiting for
  // the slot until the failure's beat has run its full cadence.
  await context.releaseAnnouncement();
  const midBeat = Math.floor(ERROR_BEAT_MS / 2);
  await context.advance(midBeat);
  await context.healConnection();
  expect(dotSubject(context.inspector)).toBe("whats-new");
  expect(pulsing(context.inspector)).toBe(false);

  await context.advance(ERROR_BEAT_MS - midBeat - 50);
  expect(pulsing(context.inspector)).toBe(false);
  await context.advance(100);
  expect(pulsing(context.inspector)).toBe(true);

  // And no pill ever opened: the condition was gone before the beat ended.
  await context.advance(PILL_OPEN_MS + PILL_HOLD_MS);
  expect(pill(context.inspector)).toBeNull();
});

test("a failure resolving while the pill is open closes it early", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS + PILL_OPEN_MS);
  expect(pillPhase(context.inspector)).toBe("holding");

  // It states a condition, and the condition has stopped being true, so it
  // closes rather than serving out the rest of its hold.
  await context.healConnection();
  expect(pillPhase(context.inspector)).toBe("closing");

  await context.advance(PILL_CLOSE_MS);
  expect(pill(context.inspector)).toBeNull();
  // The dot going out is the only confirmation the fix needs.
  expect(launcherDot(context.inspector)).toBeNull();
  expect(spoken(context.inspector)).toBe("");
});

test("the gesture holds the pending slot, so an announcement beat runs after it", async () => {
  const context = await setup({ announcementPending: true });
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);
  expect(pillPhase(context.inspector)).toBe("opening");

  // The announcement is published mid-pill. It cannot beat over the top of a
  // gesture, and it must not recolour the one that is running.
  await context.releaseAnnouncement();
  expect(pulsing(context.inspector)).toBe(false);
  expect(dotSubject(context.inspector)).toBe("connection");
  expect(launcherTone(context.inspector)).toBe("error");

  // Still nothing, right up to the last phase of the gesture.
  await context.advance(PILL_OPEN_MS + PILL_HOLD_MS);
  expect(pillPhase(context.inspector)).toBe("closing");
  expect(pulsing(context.inspector)).toBe(false);

  // The failure is still there, so it still owns the dot — the announcement's
  // beat waits for the failure to clear, not merely for the gesture to end.
  await context.advance(PILL_CLOSE_MS);
  expect(pill(context.inspector)).toBeNull();
  await context.healConnection();
  expect(dotSubject(context.inspector)).toBe("whats-new");
  expect(pulsing(context.inspector)).toBe(true);
});

test("clearing a failure announces nothing and opens no pill", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  await context.advance(GESTURE_MS);

  await context.healConnection();
  await context.advance(GESTURE_MS * 2);

  // Recovery is silent by design: the dot going out is the message, it is
  // immediate, and it costs no attention. Announcing it would double the
  // gestures across exactly the break-and-fix cycle debugging consists of.
  expect(pill(context.inspector)).toBeNull();
  expect(spoken(context.inspector)).toBe("");
  expect(launcherDot(context.inspector)).toBeNull();
  expect(pulsing(context.inspector)).toBe(false);
});

// ── Direction, and the honest degrade ─────────────────────────────────────

test("the pill opens left when there is room to the left", async () => {
  const context = await setup();
  // Anchored top-right with the whole window to its left.
  stubGeometry({
    launcherLeft: 1200,
    pillWidth: PILL_WIDTH,
    viewportWidth: 1280,
  });
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);

  // Leftwards is the natural direction: away from the launcher's own edge.
  expect(pillDirection(context.inspector)).toBe("left");
  expect(pillOpen(context.inspector)).toBe(true);
});

test("the pill opens right when the launcher sits too close to the left edge", async () => {
  const context = await setup();
  // Dragged to the left corner, where a leftward pill needs far more room than
  // exists — permanently, because the position persists.
  stubGeometry({
    launcherLeft: 16,
    pillWidth: PILL_WIDTH,
    viewportWidth: 1280,
  });
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);

  expect(pillDirection(context.inspector)).toBe("right");
  expect(pillOpen(context.inspector)).toBe(true);
  expect(pillHeading(context.inspector)).toBe(RUNTIME_ERROR_WORDS);
});

test("neither side having room leaves the dot and the beat untouched, and no pill", async () => {
  const context = await setup();
  // A window too narrow for the label on either side.
  stubGeometry({ launcherLeft: 16, pillWidth: PILL_WIDTH, viewportWidth: 130 });
  await armConnectionFailure(context);

  // The signal is intact and only the label is lost: degrading honestly beats
  // a truncated pill, and the reader's own page is not ours to constrain.
  expect(launcherDot(context.inspector)).not.toBeNull();
  expect(pulsing(context.inspector)).toBe(true);
  expect(pill(context.inspector)).toBeNull();

  await context.advance(GESTURE_MS);
  expect(pill(context.inspector)).toBeNull();
  expect(launcherDot(context.inspector)).not.toBeNull();
});

test("with no room the failure is still spoken", async () => {
  const context = await setup();
  stubGeometry({ launcherLeft: 16, pillWidth: PILL_WIDTH, viewportWidth: 130 });
  await armConnectionFailure(context);

  // The same words still arrive; they simply arrive without the movement.
  expect(spoken(context.inspector)).toBe(RUNTIME_ERROR_WORDS);
});

// The narrowest window a rightward pill fits in: the launcher's own left
// offset, the mark, its overhang, and the margin the pill keeps from the edge.
// Widening the pill — as the padding and the second line did — moves this,
// which is the whole reason PILL_WIDTH is a named number.
const TIGHTEST_FIT =
  EDGE_MARGIN + LAUNCHER_SIZE + (PILL_WIDTH - LAUNCHER_SIZE) + EDGE_MARGIN;

test("a window exactly wide enough still opens the pill", async () => {
  const context = await setup();
  stubGeometry({
    launcherLeft: EDGE_MARGIN,
    pillWidth: PILL_WIDTH,
    viewportWidth: TIGHTEST_FIT,
  });
  await armConnectionFailure(context);

  expect(pillDirection(context.inspector)).toBe("right");
});

test("one pixel narrower than that degrades to no pill at all", async () => {
  const context = await setup();
  stubGeometry({
    launcherLeft: EDGE_MARGIN,
    pillWidth: PILL_WIDTH,
    viewportWidth: TIGHTEST_FIT - 1,
  });
  await armConnectionFailure(context);

  // A truncated pill is never the fallback: the dot and the beat carry the
  // signal, and only the label is lost.
  expect(pill(context.inspector)).toBeNull();
  expect(launcherDot(context.inspector)).not.toBeNull();
  expect(pulsing(context.inspector)).toBe(true);
});

// ── Reduced motion ────────────────────────────────────────────────────────

test("reduced motion shows the pill with no clip animation and the same hold", async () => {
  const context = await setup({ reducedMotion: true });
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);

  // The pill arrives, and the phases keep exactly the same timing: the
  // instruction is to reduce motion, not to withhold information or to remove
  // the reader's chance to read it.
  expect(pillOpen(context.inspector)).toBe(true);
  expect(pillHeading(context.inspector)).toBe(RUNTIME_ERROR_WORDS);
  await context.advance(PILL_OPEN_MS);
  expect(pillPhase(context.inspector)).toBe("holding");
  await context.advance(PILL_HOLD_MS);
  expect(pillPhase(context.inspector)).toBe("closing");

  const css = stylesheetText(context.inspector);
  const reduced = css.slice(
    css.indexOf("@media (prefers-reduced-motion: reduce)"),
  );
  // Shown by opacity alone, with the clip held open rather than animated.
  expect(reduced).toContain(
    '.cpk-launcher-pill[data-cpk-pill-phase="holding"]',
  );
  expect(reduced).toContain("animation: none");
  expect(reduced).toContain("clip-path: inset(0 0 0 0)");
});

test("the reveal animates a rectangular clip, never a width or a scale", async () => {
  const context = await setup();
  const css = stylesheetText(context.inspector);

  // The two directions are the same animation with the inset on the other
  // side, which is what makes choosing a side nearly free.
  for (const direction of ["left", "right"]) {
    const frames =
      new RegExp(
        `@keyframes\\s+cpk-launcher-pill-${direction}\\s*\\{([\\s\\S]*?\\}\\s*)\\}`,
      ).exec(css)?.[1] ?? "";
    expect(frames).toContain("clip-path: inset(");
    expect(frames).toContain("opacity");
    // Animating either of these gives up the layout guarantee — `width` forces
    // a layout on every frame on someone else's page, and a horizontal scale
    // squashes the mark itself, so the dot and halo would become ellipses.
    expect(frames).not.toContain("width");
    expect(frames).not.toContain("scale");
  }

  // Laid out at full width from the start, so only the visible region moves.
  const pillRule = /\.cpk-launcher-pill\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  expect(pillRule).not.toMatch(/(^|[^-])width\s*:/);
  expect(pillRule).not.toContain("transform: scale");
});

test("the revealing edge is the capsule's own rounded end, not a straight wipe", async () => {
  const context = await setup();
  const css = stylesheetText(context.inspector);

  // An unrounded inset sweeps a straight vertical line sideways and reads as a
  // wipe. Rounding BOTH stops of BOTH directions makes it read as an opening —
  // and a clip-path only interpolates between shapes of the same kind, so a
  // `round` on one stop alone would stop the reveal animating at all.
  for (const direction of ["left", "right"]) {
    const frames =
      new RegExp(
        `@keyframes\\s+cpk-launcher-pill-${direction}\\s*\\{([\\s\\S]*?\\}\\s*)\\}`,
      ).exec(css)?.[1] ?? "";
    const stops = frames.match(/clip-path:[\s\S]*?;/g) ?? [];
    expect(stops).toHaveLength(2);
    for (const stop of stops) {
      expect(stop).toContain("inset(");
      expect(stop).toContain("round 999px");
    }
  }
});

// ── Clicking the pill ─────────────────────────────────────────────────────
//
// The subline invites a click, so the click has to work. It is the launcher's
// own action, reported under the launcher's own source.

test("clicking the pill opens the Inspector where the launcher would", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);

  await context.activate(pill(context.inspector));

  // A press on the launcher is a gesture towards whatever the dot is about, and
  // a click on the pill is the same gesture: it lands where the failure is
  // explained.
  expect(launcher(context.inspector)).toBeNull();
  expect(currentMenu(context.inspector)).toBe("home");
});

test("clicking a thread failure's pill lands on Threads", async () => {
  const context = await setup({
    endpoints: ENABLED_ENDPOINTS,
    listFails: true,
  });
  await context.advance(ERROR_BEAT_MS);

  await context.activate(pill(context.inspector));
  expect(currentMenu(context.inspector)).toBe("threads");
});

test("clicking the pill ends the gesture and leaves nothing behind", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);
  await context.activate(pill(context.inspector));

  // The panel is over the launcher, so the gesture has nowhere left to run —
  // and it must not resume when the panel closes either.
  expect(pill(context.inspector)).toBeNull();
  await context.advance(GESTURE_MS);
  expect(pill(context.inspector)).toBeNull();

  await context.closePanel();
  await context.advance(GESTURE_MS);
  expect(pill(context.inspector)).toBeNull();
  expect(launcherDot(context.inspector)).not.toBeNull();
});

test("the pill's click is reported under the launcher's own open source", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);

  await context.activate(pill(context.inspector));
  await context.flush();

  // Reusing the existing source rather than adding one: the telemetry
  // catalogue does not change, and the two paths are the same action.
  const opens = context.telemetryBodies.filter(
    (body) => body.event === TELEMETRY_EVENTS.opened,
  );
  expect(opens).toHaveLength(1);
  expect(opens[0]?.properties).toMatchObject({
    open_source: "floating_button",
    has_error_signal: true,
    error_signal_source: "connection",
  });
});

test("the pill is clickable only while it is on screen", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  const css = stylesheetText(context.inspector);
  const pillRule = /\.cpk-launcher-pill\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";

  // During the beat the clip covers the mark alone, and a click target nobody
  // can see over someone else's page is not something to ship. The base rule
  // therefore takes no pointer at all, and the three visible phases take it
  // back.
  expect(pillRule).toContain("pointer-events: none");
  const visible =
    /\.cpk-launcher-pill\[data-cpk-pill-phase="opening"\],\s*\.cpk-launcher-pill\[data-cpk-pill-phase="holding"\],\s*\.cpk-launcher-pill\[data-cpk-pill-phase="closing"\]\s*\{([\s\S]*?)\}/.exec(
      css,
    )?.[1] ?? "";
  expect(visible).toContain("pointer-events: auto");
  expect(visible).toContain("cursor: pointer");
});

test("the pill adds no second tab stop for the launcher's one action", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);
  const element = requireElement(pill(context.inspector));

  // The launcher beside it is already a focusable control for this action, and
  // a second tab stop for one action is a regression — so the pill stays a
  // pointer affordance and nothing more.
  expect(element.getAttribute("tabindex")).toBeNull();
  expect(element.getAttribute("role")).toBeNull();
  expect(element.matches("a[href], button, input, select, textarea")).toBe(
    false,
  );
  expect(
    element.querySelector("[tabindex], a[href], button, input, select"),
  ).toBeNull();

  // Still hidden from assistive technology: the live region already spoke.
  expect(element.getAttribute("aria-hidden")).toBe("true");

  // One focusable control on the launcher, before and while it talks.
  expect(
    root(context.inspector).querySelectorAll(
      "button, a[href], [tabindex]:not([tabindex='-1'])",
    ),
  ).toHaveLength(1);
});

// ── The spoken announcement ───────────────────────────────────────────────

test("the polite live region announces the failure once per outage", async () => {
  const context = await setup();
  const region = requireElement(liveRegion(context.inspector));

  // Empty and with no visual footprint while the launcher is quiet: a live
  // region has to exist before its content lands to be announced reliably.
  expect(spoken(context.inspector)).toBe("");
  expect(region.className).toContain("sr-only");

  await armConnectionFailure(context);
  // Same rising edge as the beat and the pill, so "once per outage" needs no
  // separate rule.
  expect(spoken(context.inspector)).toBe(RUNTIME_ERROR_WORDS);

  await context.advance(GESTURE_MS);
  expect(spoken(context.inspector)).toBe("");

  // A sustained outage does not repeat itself.
  await context.advance(60_000);
  expect(spoken(context.inspector)).toBe("");
});

test("the spoken sentence is the failure class alone, never the instruction", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);

  // The pill shows two lines and speaks one. A screen-reader user cannot act on
  // an instruction delivered through an announcement, and carrying it would
  // double the spoken length for nothing.
  expect(pillSubline(context.inspector)).toBe(PILL_SUBLINE_WORDS);
  expect(spoken(context.inspector)).toBe(RUNTIME_ERROR_WORDS);
  expect(spoken(context.inspector)).not.toContain(PILL_SUBLINE_WORDS);
});

test("the announcement is polite, never assertive", async () => {
  const context = await setup();
  await armConnectionFailure(context);

  const region = requireElement(liveRegion(context.inspector));
  // Speech is serial: it occupies the channel the reader is using to operate
  // their own software, so a development tool never interrupts mid-sentence.
  expect(region.getAttribute("aria-live")).toBe("polite");
  expect(region.getAttribute("role")).toBe("status");
  expect(root(context.inspector).innerHTML).not.toContain("assertive");
});

test("the pill itself is hidden from assistive technology", async () => {
  const context = await setup();
  await armConnectionFailure(context);
  await context.advance(ERROR_BEAT_MS);

  // The live region carries the announcement; the pill is its visual
  // counterpart and must not be read a second time.
  expect(
    requireElement(pill(context.inspector)).getAttribute("aria-hidden"),
  ).toBe("true");
});

test("no rendered text anywhere carries the failure message", async () => {
  const context = await setup({
    endpoints: ENABLED_ENDPOINTS,
    listFails: true,
  });
  await context.advance(ERROR_BEAT_MS);

  // For width, and because a message can contain prompts, URLs and
  // identifiers: only the failure *class* is ever shown or spoken. Everything
  // on the page is accounted for here — the pill's two lines and the spoken
  // sentence, which is the class alone.
  const rendered = renderedText(context.inspector);
  expect(rendered).toBe(
    `${THREADS_ERROR_WORDS} ${PILL_SUBLINE_WORDS} ${THREADS_ERROR_WORDS}`,
  );
  expect(rendered).not.toContain("list refused");
  expect(rendered).not.toContain("503");
  expect(rendered).not.toContain(RUNTIME_URL);
});

// ── Nothing wrong, nothing changed ────────────────────────────────────────

test("with nothing wrong the launcher renders exactly as before", async () => {
  const context = await setup();

  expect(launcherDot(context.inspector)).toBeNull();
  expect(pill(context.inspector)).toBeNull();
  expect(spoken(context.inspector)).toBe("");
  expect(launcherName(context.inspector)).toBe("Web Inspector");
  expect(launcherTone(context.inspector)).toBeNull();

  // And it stays that way: the feature costs nothing in the normal case.
  await context.advance(GESTURE_MS * 3);
  expect(pill(context.inspector)).toBeNull();
  expect(renderedText(context.inspector)).toBe("");
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
    label: "shown",
  });

  // Once per outage, however many renders follow.
  await context.advance(ERROR_BEAT_MS * 4);
  expect(errorSignalEvents(context)).toHaveLength(1);
});

test("the visibility event reports whether the pill was shown or suppressed", async () => {
  const context = await setup();
  stubGeometry({
    launcherLeft: 1200,
    pillWidth: PILL_WIDTH,
    viewportWidth: 1280,
  });
  await armConnectionFailure(context);

  expect(errorSignalEvents(context)).toHaveLength(1);
  expect(errorSignalEvents(context)[0]?.properties.label).toBe("shown");
});

test("the visibility event reports the no-room fallback as suppressed", async () => {
  // A degradation whose frequency is unknown is a degradation that gets argued
  // about later, so the silent case is the one this property exists to count.
  const context = await setup();
  stubGeometry({ launcherLeft: 16, pillWidth: PILL_WIDTH, viewportWidth: 130 });
  await armConnectionFailure(context);

  expect(pill(context.inspector)).toBeNull();
  expect(errorSignalEvents(context)).toHaveLength(1);
  expect(errorSignalEvents(context)[0]?.properties).toMatchObject({
    source: "connection",
    presentation: "animated",
    label: "suppressed",
  });
});

test("the visibility event reports the thread source and reduced motion", async () => {
  const context = await setup({
    endpoints: ENABLED_ENDPOINTS,
    listFails: true,
    reducedMotion: true,
  });

  expect(errorSignalEvents(context)).toHaveLength(1);
  expect(errorSignalEvents(context)[0]?.properties).toMatchObject({
    source: "threads",
    presentation: "reduced_motion",
    // Reduced motion still gets the words, so the pill still counts as shown.
    label: "shown",
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
  await context.press(launcher(context.inspector));
  await context.flush();

  expect(context.telemetryBodies.length).toBeGreaterThan(0);
  for (const body of context.telemetryBodies) {
    // The two id fields are random hex, so a short numeric needle like "503"
    // lands inside one about once in a few hundred runs — a flake that reads
    // like a privacy breach. They are opaque and carry nothing from the
    // failure, so they are excluded by name rather than by weakening the
    // needles, which are the point of the test.
    const { distinct_id, inspector_distinct_id, ...carriers } = body.properties;
    expect(typeof distinct_id).toBe("string");
    expect(typeof inspector_distinct_id).toBe("string");

    const serialized = JSON.stringify(carriers);
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

// ── App errors as unread events ───────────────────────────────────────────

test("a failed agent run names itself on the pill and lands on AG-UI Events", async () => {
  const context = await setup();
  await context.fireAppError(
    CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
    "model refused the run",
  );

  expect(dotSubject(context.inspector)).toBe("run");
  expect(launcherName(context.inspector)).toContain("agent run failed");
  await context.advance(ERROR_BEAT_MS);
  expect(pillHeading(context.inspector)).toBe("Agent run failed");

  await context.activate(pill(context.inspector));
  expect(currentMenu(context.inspector)).toBe("ag-ui-events");
  expect(
    root(context.inspector).querySelector('[data-cpk-event-error="run"]')
      ?.textContent,
  ).toContain("model refused the run");
});

test("a run error with no run to point at claims no highlight", async () => {
  const context = await setup();
  // AGENT_RUN_FAILED with an empty event buffer is the ordinary shape for
  // every code that reaches `run` through the catch-all without a run of its
  // own — a locked thread, an agent that was never registered.
  await context.fireAppError(
    CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
    "model refused the run",
  );
  await context.press(launcher(context.inspector));

  const banner = root(context.inspector).querySelector(
    '[data-cpk-event-error="run"]',
  )?.textContent;
  expect(banner).toContain("model refused the run");
  expect(banner).not.toContain("highlighted below");
  expect(
    root(context.inspector).querySelector("[data-cpk-failed-run-event]"),
  ).toBeNull();
});

test("run and tool errors retain their own detail while both are unread", async () => {
  const context = await setup();
  await context.fireAppError(
    CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
    "The run failed first.",
  );
  await context.fireAppError(
    CopilotKitCoreErrorCode.TOOL_HANDLER_FAILED,
    "The tool failed second.",
    { agentId: "tanstack", toolName: "crash" },
  );

  expect(dotSubject(context.inspector)).toBe("run");
  await context.press(launcher(context.inspector));

  expect(currentMenu(context.inspector)).toBe("ag-ui-events");
  const runBanner = root(context.inspector).querySelector(
    '[data-cpk-event-error="run"]',
  )?.textContent;
  expect(runBanner).toContain("The run failed first.");
  expect(runBanner).not.toContain("The tool failed second.");

  await context.closePanel();
  expect(dotSubject(context.inspector)).toBe("tool");
});

test("a tool error with no call id claims no highlight", async () => {
  const context = await setup();
  await context.fireAppError(
    CopilotKitCoreErrorCode.TOOL_NOT_FOUND,
    "Tool not found: bookFlight",
    { agentId: "tanstack", toolName: "bookFlight" },
  );
  await context.press(launcher(context.inspector));

  const banner = root(context.inspector).querySelector(
    '[data-cpk-event-error="tool"]',
  )?.textContent;
  expect(banner).toContain("Tool not found: bookFlight");
  expect(banner).not.toContain("highlighted below");
});

function createLabAgent(agentId: string, messages: unknown[] = []) {
  const subscribers: Array<{
    onRunErrorEvent?: (params: {
      event: { type: string; message: string };
      input: {
        threadId: string;
        runId: string;
        messages: unknown[];
        state: Record<string, never>;
        tools: unknown[];
        context: unknown[];
      };
      state: Record<string, never>;
      agent: unknown;
      messages: unknown[];
    }) => void | Promise<void>;
  }> = [];

  const agent = {
    agentId,
    messages,
    state: {},
    subscribe(subscriber: (typeof subscribers)[number]) {
      subscribers.push(subscriber);
      return {
        unsubscribe() {
          const index = subscribers.indexOf(subscriber);
          if (index >= 0) subscribers.splice(index, 1);
        },
      };
    },
    abortRun() {},
    clone() {
      return agent;
    },
  };

  return {
    // AbstractAgent is a class. Tests only need this subscriber/message shape.
    agent: agent as AbstractAgent,
    emitRunError(message: string) {
      const event = { type: "RUN_ERROR", message };
      const input = {
        threadId: "lab-thread",
        runId: "lab-run",
        messages: [],
        state: {},
        tools: [],
        context: [],
      };
      for (const subscriber of subscribers) {
        void subscriber.onRunErrorEvent?.({
          event,
          input,
          state: {},
          agent,
          messages: [],
        });
      }
    },
  };
}

function stubAgent(agentId: string): AbstractAgent {
  return createLabAgent(agentId).agent;
}

test("a missing tool names itself on the pill and lands on Agent", async () => {
  const context = await setup();
  await context.fireAppError(
    CopilotKitCoreErrorCode.TOOL_NOT_FOUND,
    "Tool not found: bookFlight",
  );

  expect(dotSubject(context.inspector)).toBe("tool");
  await context.advance(ERROR_BEAT_MS);
  expect(pillHeading(context.inspector)).toBe("Tool error");

  await context.activate(pill(context.inspector));
  expect(currentMenu(context.inspector)).toBe("agents");
  expect(
    root(context.inspector).querySelector('[data-cpk-event-error="tool"]')
      ?.textContent,
  ).toContain("Tool not found: bookFlight");
});

test("a tool error selects the agent that failed, not All Agents", async () => {
  const context = await setup();
  context.core.addAgent__unsafe_dev_only({
    id: "aisdk",
    agent: stubAgent("aisdk"),
  });
  context.core.addAgent__unsafe_dev_only({
    id: "tanstack",
    agent: stubAgent("tanstack"),
  });
  await context.flush();

  await context.fireAppError(
    CopilotKitCoreErrorCode.TOOL_HANDLER_FAILED,
    "Inspector lab: tool handler crashed.",
    { agentId: "tanstack", toolName: "crash", toolCallId: "call-crash-1" },
  );
  await context.advance(ERROR_BEAT_MS);
  await context.activate(pill(context.inspector));

  expect(currentMenu(context.inspector)).toBe("agents");
  expect(
    root(context.inspector).querySelector(
      '[aria-label="Select agent scope: tanstack"]',
    ),
  ).not.toBeNull();
  expect(root(context.inspector).textContent).not.toContain(
    "No agent selected",
  );
  const banner = root(context.inspector).querySelector(
    '[data-cpk-event-error="tool"]',
  )?.textContent;
  expect(banner).toContain("Agent: tanstack");
  expect(banner).toContain("Tool: crash");
  expect(banner).toContain("Inspector lab: tool handler crashed.");
});

test("a tool error highlights the failed tool call on Agent", async () => {
  const context = await setup();
  const lab = createLabAgent("tanstack", [
    {
      id: "assistant-1",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-crash-1",
          type: "function",
          function: { name: "crash", arguments: "{}" },
        },
      ],
    },
    {
      id: "tool-1",
      role: "tool",
      toolCallId: "call-crash-1",
      content: "Error: Inspector lab: tool handler crashed.",
    },
  ]);
  context.core.addAgent__unsafe_dev_only({
    id: "aisdk",
    agent: stubAgent("aisdk"),
  });
  context.core.addAgent__unsafe_dev_only({
    id: "tanstack",
    agent: lab.agent,
  });
  await context.flush();

  await context.fireAppError(
    CopilotKitCoreErrorCode.TOOL_HANDLER_FAILED,
    "Inspector lab: tool handler crashed.",
    { agentId: "tanstack", toolName: "crash", toolCallId: "call-crash-1" },
  );
  await context.advance(ERROR_BEAT_MS);
  await context.activate(pill(context.inspector));

  const failedCall = root(context.inspector).querySelector(
    '[data-cpk-failed-tool-call="call-crash-1"]',
  );
  expect(failedCall).not.toBeNull();
  expect(failedCall?.textContent).toContain("crash failed");
  expect(failedCall?.textContent).toContain(
    "Inspector lab: tool handler crashed.",
  );
  expect(
    root(context.inspector).querySelector(
      '[data-cpk-failed-tool-result="call-crash-1"]',
    ),
  ).not.toBeNull();
  expect(
    root(context.inspector).querySelector('[data-cpk-event-error="tool"]')
      ?.textContent,
  ).toContain("highlighted below");
});

test("a run error names the agent and highlights RUN_ERROR", async () => {
  const context = await setup();
  const lab = createLabAgent("tanstack");
  context.core.addAgent__unsafe_dev_only({
    id: "aisdk",
    agent: stubAgent("aisdk"),
  });
  context.core.addAgent__unsafe_dev_only({
    id: "tanstack",
    agent: lab.agent,
  });
  await context.flush();

  lab.emitRunError("Inspector lab: the agent run failed.");
  await context.flush();
  await context.fireAppError(
    CopilotKitCoreErrorCode.AGENT_RUN_ERROR_EVENT,
    "Inspector lab: the agent run failed.",
    { agentId: "tanstack" },
  );
  await context.advance(ERROR_BEAT_MS);
  await context.activate(pill(context.inspector));

  expect(currentMenu(context.inspector)).toBe("ag-ui-events");
  const banner = root(context.inspector).querySelector(
    '[data-cpk-event-error="run"]',
  )?.textContent;
  expect(banner).toContain("Agent: tanstack");
  expect(banner).toContain("Inspector lab: the agent run failed.");
  expect(banner).toContain("highlighted below");
  const failedEvent = root(context.inspector).querySelector(
    "[data-cpk-failed-run-event]",
  );
  expect(failedEvent).not.toBeNull();
  expect(failedEvent?.textContent).toContain("RUN_ERROR");
  expect(failedEvent?.textContent).toContain(
    "Inspector lab: the agent run failed.",
  );
});

test("reading the landing view clears the unread event, not the how-to-fix card", async () => {
  const context = await setup();
  await context.fireAppError(CopilotKitCoreErrorCode.AGENT_RUN_FAILED);
  await context.press(launcher(context.inspector));

  expect(currentMenu(context.inspector)).toBe("ag-ui-events");
  expect(
    root(context.inspector).querySelector('[data-cpk-event-error="run"]'),
  ).not.toBeNull();

  await context.closePanel();
  expect(launcherDot(context.inspector)).toBeNull();
});

test("a Learning failure names itself and lands on Learning", async () => {
  const context = await setup({ intelligence: true });
  // The store is only reached from the view, so visiting it once is what makes
  // the latch reachable at all. This mirrors how a developer gets here.
  await context.press(launcher(context.inspector));
  await context.activate(
    root(context.inspector).querySelector(
      'button[data-inspector-menu-key="memories"]',
    ),
  );
  await context.closePanel();

  await context.failMemory("Failed to load memories: 500");

  expect(dotSubject(context.inspector)).toBe("memory");
  expect(launcherName(context.inspector)).toContain("learning error");
  await context.advance(ERROR_BEAT_MS);
  expect(pillHeading(context.inspector)).toBe("Failed to load learning data");

  await context.activate(pill(context.inspector));
  expect(currentMenu(context.inspector)).toBe("memories");
  // Learning keeps its own error display rather than the shared banner that
  // run and tool use, so this asserts what the view actually renders: the
  // store's message, and the advice line from the shared guidance table.
  const view = root(context.inspector).textContent;
  expect(view).toContain("Failed to load memories: 500");
  expect(view).toContain("Intelligence is connected");
  // Advice is not a claim about this view, so nothing here promises a
  // highlight — and there is none to promise.
  expect(view).not.toContain("highlighted below");
});

test("a Learning failure arms nothing while the view has never been opened", async () => {
  const context = await setup({ intelligence: true });
  // No visit, so nothing ever called getMemoryStore(). The latch cannot know
  // the state, and a signal that only sometimes knows would be a false
  // statement rather than an incomplete feature.
  await context.failMemory("Failed to load memories: 500");

  expect(launcherDot(context.inspector)).toBeNull();
  expect(markers(context.inspector)).toEqual([]);
});

test("a resolved Learning failure stays unread until Learning renders", async () => {
  const context = await setup({ intelligence: true });
  await context.press(launcher(context.inspector));
  await context.activate(
    root(context.inspector).querySelector(
      'button[data-inspector-menu-key="memories"]',
    ),
  );
  await context.closePanel();
  await context.failMemory("Failed to load memories: 500");
  expect(dotSubject(context.inspector)).toBe("memory");

  await context.failMemory(null);

  expect(dotSubject(context.inspector)).toBe("memory");
  await context.press(launcher(context.inspector));
  expect(currentMenu(context.inspector)).toBe("memories");
  await context.closePanel();
  expect(launcherDot(context.inspector)).toBeNull();
});

test("navigating back to the events view keeps the reader's own filter", async () => {
  const context = await setup();
  // The reader arrives because of the failure once, reads it, and then works.
  await context.fireAppError(
    CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
    "model refused the run",
  );
  await context.press(launcher(context.inspector));
  expect(currentMenu(context.inspector)).toBe("ag-ui-events");

  const searchBox = () =>
    root(context.inspector).querySelector<HTMLInputElement>(
      'input[placeholder="Search agent, type, payload"]',
    );
  const typed = requireElement(searchBox());
  typed.value = "bookFlight";
  typed.dispatchEvent(new Event("input", { bubbles: true }));
  await context.flush();
  expect(searchBox()?.value).toBe("bookFlight");

  // Leaving and coming back is a passing-through, not an arrival. The error is
  // still in `lastEventError` — it outlives being read so the card survives —
  // so re-landing here would silently reset the reader's own view, and would
  // keep doing it for the rest of the session.
  root(context.inspector)
    .querySelector<HTMLButtonElement>('button[data-inspector-menu-key="home"]')
    ?.click();
  await context.flush();
  root(context.inspector)
    .querySelector<HTMLButtonElement>(
      'button[data-inspector-menu-key="ag-ui-events"]',
    )
    ?.click();
  await context.flush();

  expect(currentMenu(context.inspector)).toBe("ag-ui-events");
  expect(searchBox()?.value).toBe("bookFlight");
});

test("a handshake failure does not also arm the run event", async () => {
  const context = await setup();
  await context.fireAppError(CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED);
  await context.flush();

  expect(launcherDot(context.inspector)).toBeNull();
});

test("unclassified core errors do not claim the run error surface", async () => {
  const context = await setup();
  await context.fireAppError(
    CopilotKitCoreErrorCode.AGENT_THREAD_LOCKED,
    "The agent is busy.",
  );

  expect(launcherDot(context.inspector)).toBeNull();
  expect(markers(context.inspector)).toEqual([]);
});

test("wiring still owns the launcher when a run also failed", async () => {
  const context = await setup();
  await context.fireAppError(CopilotKitCoreErrorCode.AGENT_RUN_FAILED);
  await armConnectionFailure(context);

  expect(dotSubject(context.inspector)).toBe("connection");
  await context.press(launcher(context.inspector));
  expect(currentMenu(context.inspector)).toBe("home");
  expect(markers(context.inspector)).toEqual(
    expect.arrayContaining([
      { key: "home", tone: "error" },
      { key: "ag-ui-events", tone: "error" },
    ]),
  );
});

test("no telemetry payload for an app error carries the failure message", async () => {
  const context = await setup();
  await context.fireAppError(
    CopilotKitCoreErrorCode.AGENT_RUN_FAILED,
    "secret prompt in the stack",
  );
  await context.press(launcher(context.inspector));
  await context.flush();

  expect(context.telemetryBodies.length).toBeGreaterThan(0);
  for (const body of context.telemetryBodies) {
    expect(JSON.stringify(body.properties)).not.toContain(
      "secret prompt in the stack",
    );
  }
});

// ── Beat completion, on real timers ───────────────────────────────────────

// Real timers, as in the announcement suite: this is the one assertion about a
// duration rather than a transition.
test("the beat ends and leaves the resting dot behind", async () => {
  const context = await setup({ realTimers: true });

  await context.breakConnection();
  await context.advance(200);
  expect(pulsing(context.inspector)).toBe(true);

  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (!pulsing(context.inspector)) break;
    await context.advance(20);
  }

  expect(pulsing(context.inspector)).toBe(false);
  expect(launcherDot(context.inspector)).not.toBeNull();
  expect(launcherTone(context.inspector)).toBe("error");
}, 20_000);

// The one real-timer assertion about the gesture as a whole: it runs to the
// end by itself and leaves the resting state behind. Every phase *boundary* is
// asserted on the fake clock above, because the gesture is 3.4 seconds long and
// real timers would make this suite slow and flaky.
test("the whole gesture completes on its own and leaves the resting state behind", async () => {
  const context = await setup({ realTimers: true });

  await context.breakConnection();
  await context.advance(200);
  expect(pillPhase(context.inspector)).toBe("closed");

  let sawOpenPill = false;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (pillOpen(context.inspector)) sawOpenPill = true;
    if (sawOpenPill && pill(context.inspector) === null) break;
    await context.advance(20);
  }

  expect(sawOpenPill).toBe(true);
  expect(pill(context.inspector)).toBeNull();
  expect(spoken(context.inspector)).toBe("");
  // The dot stays: it carries the state, and the gesture carried the moment.
  expect(launcherDot(context.inspector)).not.toBeNull();
  expect(launcherTone(context.inspector)).toBe("error");
}, 30_000);
