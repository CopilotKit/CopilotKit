// Launcher signal + What's new (OSS-864 / OSS-865)
//
// These tests assert externally observable behaviour: whether a dot is
// present, whether a beat fired, which navigation entry is current, and what
// the component persisted. They deliberately do not assert private field
// names or render-method names, because the navigation is due to be
// restructured and field-level assertions would break for no reason.
//
// For the storage decisions the assertion is about REACH rather than
// mechanism: a read recorded under one dev-server port is honoured under
// another, which is the requirement localStorage structurally cannot meet.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import { afterEach, expect, test, vi } from "vitest";

import { WebInspectorElement } from "../index.js";

const ANNOUNCEMENT_URL = "https://cdn.copilotkit.ai/announcements.json";
const INSPECTOR_STATE_KEY = "cpk:inspector:state";
const LEGACY_ANNOUNCEMENT_KEY = "cpk:inspector:announcements";
const PULSED_SESSION_KEY = "cpk:inspector:pulsed";
const READ_COOKIE_NAME = "cpk_inspector_announcements";

const TIMESTAMP = "2026-08-01T09:00:00.000Z";
const NEXT_TIMESTAMP = "2026-08-14T09:00:00.000Z";

type AnnouncementFeed = {
  timestamp?: string;
  previewText?: string;
  announcement?: string;
};

type Harness = {
  inspector: WebInspectorElement;
  /** Mount another inspector against the same tab, as a page reload would. */
  remount: (
    feed?: AnnouncementFeed | "pending",
  ) => Promise<WebInspectorElement>;
  /** Drop the origin-scoped stores the way a change of port does. */
  changePort: () => void;
  resolveFeed: () => void;
  teardown: () => void;
};

type MountOptions = {
  feed?: AnnouncementFeed | "pending";
  persistedMenu?: string;
  persistedOpen?: boolean;
  legacyReadState?: string;
  /** Pre-record a timestamp as already read, in the host-scoped cookie. */
  readTimestamp?: string;
};

function announcement(overrides: AnnouncementFeed = {}): AnnouncementFeed {
  return {
    timestamp: TIMESTAMP,
    previewText: "Channels are here",
    announcement: "## Channels\n\nRead the [release notes](https://x.test).",
    ...overrides,
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 800; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

/** Let the announcement fetch and every dependent render settle. */
async function settle(inspector: WebInspectorElement): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    await inspector.updateComplete;
  }
}

function requireElement<T extends Node>(element: T | null | undefined): T {
  if (!element) throw new Error("Expected element was not rendered");
  return element;
}

function root(inspector: WebInspectorElement): ShadowRoot {
  return requireElement(inspector.shadowRoot);
}

/** The resting dot painted on the closed launcher, or null when quiet. */
function launcherDot(inspector: WebInspectorElement): HTMLElement | null {
  return root(inspector).querySelector<HTMLElement>("[data-cpk-signal-dot]");
}

function launcherButton(inspector: WebInspectorElement): HTMLButtonElement {
  return requireElement(
    root(inspector).querySelector<HTMLButtonElement>(
      'button[aria-label^="Web Inspector"]',
    ),
  );
}

/** The static unread marker on the What's new navigation entry. */
function navUnreadMarker(inspector: WebInspectorElement): HTMLElement | null {
  return (
    root(inspector)
      .querySelector<HTMLElement>(".inspector-nav-signal-dot")
      ?.closest<HTMLElement>('button[data-inspector-menu-key="whats-new"]') ??
    null
  );
}

function navigationLabels(inspector: WebInspectorElement): string[] {
  return Array.from(
    root(inspector).querySelectorAll<HTMLButtonElement>(
      'nav[aria-label="Inspector"] button[data-inspector-menu-key]',
    ),
  ).map((control) => control.textContent?.trim() ?? "");
}

function whatsNewState(inspector: WebInspectorElement): string | null {
  return (
    root(inspector)
      .querySelector<HTMLElement>("[data-cpk-whats-new]")
      ?.getAttribute("data-cpk-whats-new-state") ?? null
  );
}

async function click(
  inspector: WebInspectorElement,
  element: Element | null,
): Promise<void> {
  requireElement(element as HTMLElement | null).click();
  await settle(inspector);
}

async function openWhatsNew(inspector: WebInspectorElement): Promise<void> {
  if (!root(inspector).querySelector(".inspector-window")) {
    await click(inspector, launcherButton(inspector));
  }
  await click(
    inspector,
    root(inspector).querySelector(
      'button[data-inspector-menu-key="whats-new"]',
    ),
  );
}

/**
 * A real mouse press: pointerdown, pointerup, then click, in that order.
 *
 * `element.click()` dispatches only the click event, which is what keyboard
 * activation looks like. The launcher also opens from its pointerup handler,
 * and pointer events land first — so the two paths are genuinely different and
 * a click-only helper cannot see a divergence between them.
 */
async function press(
  inspector: WebInspectorElement,
  element: Element | null,
): Promise<void> {
  const target = requireElement(element as HTMLElement | null);
  const init = { bubbles: true, composed: true, pointerId: 1, button: 0 };
  target.dispatchEvent(new PointerEvent("pointerdown", init));
  target.dispatchEvent(new PointerEvent("pointerup", init));
  target.click();
  await settle(inspector);
}

/** Every stylesheet this component adopts, as one string. */
function stylesheetText(inspector: WebInspectorElement): string {
  return Array.from(root(inspector).querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
}

// Registered before the first mount so a mount that fails still tears its
// core, its element and its global stubs down.
let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

async function setup(options: MountOptions = {}): Promise<Harness> {
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();
  if (options.persistedMenu !== undefined || options.persistedOpen) {
    window.localStorage.setItem(
      INSPECTOR_STATE_KEY,
      JSON.stringify({
        hasOpenedInspector: options.persistedMenu !== undefined,
        ...(options.persistedMenu !== undefined
          ? { selectedMenu: options.persistedMenu }
          : {}),
        ...(options.persistedOpen ? { isOpen: true } : {}),
      }),
    );
  }
  if (options.readTimestamp !== undefined) {
    document.cookie = `${READ_COOKIE_NAME}=${encodeURIComponent(
      JSON.stringify({ timestamp: options.readTimestamp }),
    )}; Path=/`;
  }
  if (options.legacyReadState !== undefined) {
    window.localStorage.setItem(
      LEGACY_ANNOUNCEMENT_KEY,
      options.legacyReadState,
    );
  }

  let feed: AnnouncementFeed | "pending" = options.feed ?? announcement();
  let releaseFeed: (() => void) | null = null;

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === ANNOUNCEMENT_URL) {
        if (feed === "pending") {
          await new Promise<void>((resolve) => {
            releaseFeed = resolve;
          });
          return jsonResponse(announcement());
        }
        return jsonResponse(feed);
      }
      if (url.endsWith("/info")) {
        return jsonResponse({
          version: "1.0.0",
          agents: {},
          audioFileTranscriptionEnabled: false,
          mode: "sse",
          threadEndpoints: {
            list: false,
            inspect: false,
            mutations: false,
            realtimeMetadata: false,
          },
          inspectorMetadata: false,
          licenseStatus: "unknown",
          // No telemetry from this suite: the funnel is asserted in
          // web-inspector.spec.ts, behind the egress guard.
          telemetryDisabled: true,
        });
      }
      throw new Error(`Unexpected inspector request: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  const cores: CopilotKitCore[] = [];
  const inspectors: WebInspectorElement[] = [];

  const teardown = (): void => {
    for (const mounted of inspectors) mounted.remove();
    for (const core of cores) core.setRuntimeUrl(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.replaceChildren();
    document.getElementById("cpk-inspector-brand-fonts")?.remove();
  };
  cleanup = teardown;

  const mount = async (): Promise<WebInspectorElement> => {
    const core = new CopilotKitCore({
      runtimeUrl: "http://localhost:4000/api/copilotkit",
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
    cores.push(core);
    const inspector = new WebInspectorElement();
    inspectors.push(inspector);
    inspector.core = core;
    document.body.appendChild(inspector);
    core.connect();
    await waitFor(
      () =>
        core.runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      "the Core handshake",
    );
    await settle(inspector);
    return inspector;
  };

  const inspector = await mount();

  return {
    inspector,
    remount: async (nextFeed) => {
      for (const mounted of inspectors) mounted.remove();
      document.body.replaceChildren();
      // A reload that lands with the panel closed, which is where the
      // launcher — and therefore the dot — is visible.
      const persisted: Record<string, unknown> = JSON.parse(
        window.localStorage.getItem(INSPECTOR_STATE_KEY) ?? "{}",
      );
      delete persisted.isOpen;
      window.localStorage.setItem(
        INSPECTOR_STATE_KEY,
        JSON.stringify(persisted),
      );
      if (nextFeed !== undefined) feed = nextFeed;
      return mount();
    },
    changePort: () => {
      // localStorage is partitioned by origin, and origin includes the port,
      // so a different port means an empty store. The cookie jar is shared by
      // every port on the host, so it is deliberately left alone.
      window.localStorage.clear();
      window.sessionStorage.clear();
    },
    resolveFeed: () => {
      feed = announcement();
      releaseFeed?.();
    },
    teardown,
  };
}

// ── Navigation ────────────────────────────────────────────────────────────

test("What's new remains directly below Home whether or not anything is unread", async () => {
  const context = await setup();
  await click(context.inspector, launcherButton(context.inspector));

  expect(navigationLabels(context.inspector)).toEqual([
    "Home",
    "What's New",
    "Playground",
    "Threads",
    "Learning",
    "Agent",
    "AG-UI Events",
    "Event Snippets",
    "Context",
  ]);
  expect(navUnreadMarker(context.inspector)).not.toBeNull();
  expect(navigationLabels(context.inspector)[1]).toBe("What's New");
});

test("a fresh developer lands on Home with the What's new preview", async () => {
  const context = await setup();
  await click(context.inspector, launcherButton(context.inspector));

  expect(
    root(context.inspector).querySelector(
      'button[data-inspector-menu-key="home"][aria-current="page"]',
    ),
  ).not.toBeNull();
  expect(whatsNewState(context.inspector)).toBeNull();
  expect(
    root(context.inspector).querySelector("[data-inspector-home-band='news']"),
  ).not.toBeNull();
  expect(navUnreadMarker(context.inspector)).not.toBeNull();
});

test("restoring the panel never moves the reader, however loud the signal", async () => {
  // A deliberate press on the launcher may take the reader to What's new,
  // because the launcher carries the signal. A restore is not a gesture, so it
  // must leave the reader where they were and merely mark the navigation
  // entry: invited rather than moved.
  const context = await setup({
    persistedMenu: "ag-ui-events",
    persistedOpen: true,
  });

  expect(
    root(context.inspector).querySelector(
      'button[data-inspector-menu-key="ag-ui-events"][aria-current="page"]',
    ),
  ).not.toBeNull();
  expect(whatsNewState(context.inspector)).toBeNull();
  expect(navUnreadMarker(context.inspector)).not.toBeNull();
});

// ── Arming ────────────────────────────────────────────────────────────────

test("the signal arms on a timestamp and a body", async () => {
  const context = await setup();

  expect(launcherDot(context.inspector)).not.toBeNull();
});

test("the signal still arms when the feed carries no preview text", async () => {
  const context = await setup({
    feed: { timestamp: TIMESTAMP, announcement: "## Channels are here" },
  });

  // previewText used to gate the dot, which would have meant an announcement
  // without preview text produced no dot at all.
  expect(launcherDot(context.inspector)).not.toBeNull();

  await openWhatsNew(context.inspector);
  expect(whatsNewState(context.inspector)).toBe("content");
  expect(
    root(context.inspector).querySelector(".whats-new__heading"),
  ).toBeNull();
});

test("the signal stays quiet for a feed with no body", async () => {
  const context = await setup({ feed: { timestamp: TIMESTAMP } });

  expect(launcherDot(context.inspector)).toBeNull();
});

test("a body that renders to nothing arms nothing and is not counted as read", async () => {
  const context = await setup({
    feed: announcement({ announcement: "   " }),
  });

  // A dot What's new could never clear — because clearing requires content —
  // would be a signal with no way out.
  expect(launcherDot(context.inspector)).toBeNull();

  await openWhatsNew(context.inspector);
  expect(whatsNewState(context.inspector)).toBe("empty");

  // The same announcement, once it carries a body, still arms.
  const republished = await context.remount(announcement());
  expect(launcherDot(republished)).not.toBeNull();
});

// ── Clearing ──────────────────────────────────────────────────────────────

test("a panel restored on another tab does not consume the announcement", async () => {
  const context = await setup({
    persistedMenu: "ag-ui-events",
    persistedOpen: true,
  });

  expect(navUnreadMarker(context.inspector)).not.toBeNull();

  // Closing again leaves the launcher dot exactly where it was.
  await click(
    context.inspector,
    root(context.inspector).querySelector(
      'button[aria-label="Close Web Inspector"]',
    ),
  );
  expect(launcherDot(context.inspector)).not.toBeNull();

  const reloaded = await context.remount();
  expect(launcherDot(reloaded)).not.toBeNull();
});

test("rendering What's new with content clears both markers and keeps them cleared", async () => {
  const context = await setup();

  await openWhatsNew(context.inspector);
  expect(whatsNewState(context.inspector)).toBe("content");
  expect(navUnreadMarker(context.inspector)).toBeNull();

  await click(
    context.inspector,
    root(context.inspector).querySelector(
      'button[aria-label="Close Web Inspector"]',
    ),
  );
  expect(launcherDot(context.inspector)).toBeNull();

  const reloaded = await context.remount();
  expect(launcherDot(reloaded)).toBeNull();
});

test("a loading render is not a read, and the clear follows the content", async () => {
  const context = await setup({ feed: "pending" });

  // Nothing has arrived, so nothing can be unread yet.
  expect(launcherDot(context.inspector)).toBeNull();
  await openWhatsNew(context.inspector);
  expect(whatsNewState(context.inspector)).toBe("loading");

  context.resolveFeed();
  await settle(context.inspector);

  expect(whatsNewState(context.inspector)).toBe("content");
  expect(navUnreadMarker(context.inspector)).toBeNull();

  // The read stuck, so the announcement the reader never saw a loading state
  // for is not re-armed on the next load.
  const reloaded = await context.remount();
  expect(launcherDot(reloaded)).toBeNull();
});

test("the read is recorded only after the announcement content is visible", async () => {
  const context = await setup({ feed: "pending" });
  await openWhatsNew(context.inspector);
  expect(whatsNewState(context.inspector)).toBe("loading");

  const cookieDescriptor = Object.getOwnPropertyDescriptor(document, "cookie");
  if (!cookieDescriptor?.get || !cookieDescriptor.set) {
    throw new Error("Expected the test cookie shim");
  }
  let stateWhenReadWasRecorded: string | null = null;
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => cookieDescriptor.get?.call(document) ?? "",
    set: (value: string) => {
      if (value.startsWith(`${READ_COOKIE_NAME}=`)) {
        stateWhenReadWasRecorded = whatsNewState(context.inspector);
      }
      cookieDescriptor.set?.call(document, value);
    },
  });

  try {
    context.resolveFeed();
    await settle(context.inspector);

    expect(whatsNewState(context.inspector)).toBe("content");
    expect(stateWhenReadWasRecorded).toBe("content");
  } finally {
    Object.defineProperty(document, "cookie", cookieDescriptor);
  }
});

test("a feed that fails to load leaves the announcement unread", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const context = await setup({ feed: { previewText: "no timestamp" } });

  await openWhatsNew(context.inspector);
  expect(whatsNewState(context.inspector)).toBe("empty");

  const reloaded = await context.remount(announcement());
  // The failed load recorded nothing, so the real announcement still arms.
  expect(launcherDot(reloaded)).not.toBeNull();
  warn.mockRestore();
});

// ── Read-state reach ──────────────────────────────────────────────────────

test("an announcement read on one dev-server port is read on every other", async () => {
  const context = await setup();
  await openWhatsNew(context.inspector);
  expect(navUnreadMarker(context.inspector)).toBeNull();

  context.changePort();
  const otherPort = await context.remount();

  expect(launcherDot(otherPort)).toBeNull();
});

test("a newly published announcement re-arms the signal", async () => {
  const context = await setup();
  await openWhatsNew(context.inspector);

  const republished = await context.remount(
    announcement({ timestamp: NEXT_TIMESTAMP, previewText: "Kite is here" }),
  );

  expect(launcherDot(republished)).not.toBeNull();
});

test("a browser that blocks cookies still arms, opens, and remembers within the port", async () => {
  const cookieDescriptor = Object.getOwnPropertyDescriptor(document, "cookie");
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => "",
    set: () => {},
  });

  try {
    const context = await setup();
    expect(launcherDot(context.inspector)).not.toBeNull();

    await openWhatsNew(context.inspector);
    expect(whatsNewState(context.inspector)).toBe("content");

    // The localStorage mirror degrades the feature to per-project behaviour
    // rather than to nothing.
    const reloaded = await context.remount();
    expect(launcherDot(reloaded)).toBeNull();
  } finally {
    if (cookieDescriptor) {
      Object.defineProperty(document, "cookie", cookieDescriptor);
    } else {
      Reflect.deleteProperty(document, "cookie");
    }
  }
});

test("the superseded read state is deleted rather than migrated", async () => {
  const context = await setup({
    legacyReadState: JSON.stringify({ timestamp: TIMESTAMP }),
  });

  // Every installed user is re-armed exactly once, so they discover the
  // surface that replaced the bubble they used to close.
  expect(launcherDot(context.inspector)).not.toBeNull();
  expect(window.localStorage.getItem(LEGACY_ANNOUNCEMENT_KEY)).toBeNull();

  await openWhatsNew(context.inspector);
  const reloaded = await context.remount();

  // Reset once, not on every load.
  expect(launcherDot(reloaded)).toBeNull();
  expect(window.localStorage.getItem(LEGACY_ANNOUNCEMENT_KEY)).toBeNull();
});

// ── Pulse ─────────────────────────────────────────────────────────────────

const pulsing = (inspector: WebInspectorElement): boolean =>
  launcherButton(inspector).getAttribute("data-cpk-signal-pulsing") === "true";

test("the launcher beats once per tab, and again for a new announcement", async () => {
  const context = await setup();

  expect(pulsing(context.inspector)).toBe(true);
  expect(window.sessionStorage.getItem(PULSED_SESSION_KEY)).toBe(TIMESTAMP);

  // Reloading the app forty times a day must not mean forty interruptions.
  for (let reload = 0; reload < 3; reload += 1) {
    const reloaded = await context.remount();
    expect(launcherDot(reloaded)).not.toBeNull();
    expect(pulsing(reloaded)).toBe(false);
  }

  const republished = await context.remount(
    announcement({ timestamp: NEXT_TIMESTAMP }),
  );
  expect(pulsing(republished)).toBe(true);
  expect(window.sessionStorage.getItem(PULSED_SESSION_KEY)).toBe(
    NEXT_TIMESTAMP,
  );
});

test("an unread announcement waits to beat until the launcher is visible", async () => {
  const context = await setup({
    persistedMenu: "ag-ui-events",
    persistedOpen: true,
  });

  expect(navUnreadMarker(context.inspector)).not.toBeNull();
  expect(window.sessionStorage.getItem(PULSED_SESSION_KEY)).toBeNull();

  await click(
    context.inspector,
    root(context.inspector).querySelector(
      'button[aria-label="Close Web Inspector"]',
    ),
  );

  expect(pulsing(context.inspector)).toBe(true);
  expect(window.sessionStorage.getItem(PULSED_SESSION_KEY)).toBe(TIMESTAMP);
});

// Real timers: the beat is scheduled during mount, so fake timers installed
// afterwards would not own it, and installing them first stalls the handshake.
test("the beat ends and leaves the resting dot behind", async () => {
  const context = await setup();
  expect(pulsing(context.inspector)).toBe(true);

  // One beat per firing — the news cadence is 2100ms — then the halo resolves
  // to a dot that persists until the signal clears.
  await waitFor(() => !pulsing(context.inspector), "the beat to finish");

  expect(launcherDot(context.inspector)).not.toBeNull();
}, 10_000);

// ── The removed surfaces ──────────────────────────────────────────────────

test("nothing is left covering the host application", async () => {
  const context = await setup();
  const shadowRoot = root(context.inspector);

  expect(shadowRoot.querySelector(".announcement-preview")).toBeNull();
  expect(shadowRoot.textContent).not.toContain("Channels are here");
  expect(stylesheetText(context.inspector)).not.toContain(
    ".announcement-preview",
  );
});

test("no announcement card sits above the content of any tab", async () => {
  const context = await setup({ persistedMenu: "ag-ui-events" });
  await click(context.inspector, launcherButton(context.inspector));

  for (const leaf of ["ag-ui-events", "threads", "memories"]) {
    await click(
      context.inspector,
      root(context.inspector).querySelector(
        `button[data-inspector-menu-key="${leaf}"]`,
      ),
    );
    const main = requireElement(
      root(context.inspector).querySelector<HTMLElement>("#cpk-main-scroll"),
    );
    expect(main.querySelector(".announcement-content")).toBeNull();
    expect(main.textContent).not.toContain("Show more");
    expect(main.textContent).not.toContain("Dismiss announcement");
  }

  // The one place the announcement does live.
  await click(
    context.inspector,
    root(context.inspector).querySelector(
      'button[data-inspector-menu-key="whats-new"]',
    ),
  );
  expect(
    requireElement(
      root(context.inspector).querySelector<HTMLElement>("#cpk-main-scroll"),
    ).querySelector(".announcement-content"),
  ).not.toBeNull();
});

test("no acknowledge or dismiss control is offered anywhere in What's new", async () => {
  const context = await setup();
  await click(context.inspector, launcherButton(context.inspector));

  const labels = Array.from(
    root(context.inspector).querySelectorAll<HTMLElement>("button"),
  ).map((control) =>
    `${control.getAttribute("aria-label") ?? ""} ${control.textContent ?? ""}`.toLowerCase(),
  );
  for (const label of labels) {
    expect(label).not.toContain("dismiss");
    expect(label).not.toContain("got it");
    expect(label).not.toContain("show more");
  }
});

// ── Launcher treatment ────────────────────────────────────────────────────

test("the launcher animates opacity, transform and a clip — nothing that forces layout", async () => {
  const context = await setup();
  const css = stylesheetText(context.inspector);

  const keyframes = Array.from(
    css.matchAll(/@keyframes\s+cpk-launcher-[\w-]+\s*\{([\s\S]*?\}\s*)\}/g),
  ).map((match) => match[1] ?? "");
  // Two for the halo, and one per direction for the pill's reveal.
  expect(keyframes).toHaveLength(4);

  const animated = new Set(
    keyframes
      .flatMap((body) => Array.from(body.matchAll(/([a-z-]+)\s*:/g)))
      .map((match) => match[1]),
  );
  // THE RULE IS THE LAYOUT GUARANTEE, not this literal list. This component is
  // mounted permanently on top of a customer's application, so no property
  // that forces a layout on every frame is acceptable — `width` and `height`
  // are what this test exists to keep out. `clip-path` joined the list when
  // the pill landed: it leaves the element's geometry constant and changes
  // only the visible region, so it satisfies the guarantee rather than
  // weakening it. Any further addition has to clear the same bar.
  expect([...animated].sort()).toEqual(["clip-path", "opacity", "transform"]);
});

test("the pulse sends two water-drop rings outward from the launcher rim", async () => {
  const context = await setup();
  const css = stylesheetText(context.inspector);

  const rings =
    /\.console-button\[data-cpk-signal\]::before,\s*\.console-button\[data-cpk-signal\]::after\s*\{([\s\S]*?)\}/.exec(
      css,
    )?.[1] ?? "";
  expect(rings).toContain("inset: 0");
  expect(rings).toContain("border: 2px solid");
  expect(rings).toContain("var(--cpk-launcher-signal) 68%");
  expect(rings).toContain("box-shadow: 0 0 8px");

  const ripple =
    /@keyframes\s+cpk-launcher-ripple\s*\{([\s\S]*?\}\s*)\}/.exec(css)?.[1] ??
    "";
  expect(ripple).toContain("opacity: 0.95");
  expect(ripple).toContain("transform: scale(1)");
  // On a 51.84px launcher, 1.5 reaches 12.96px past the rim.
  expect(ripple).toContain("transform: scale(1.5)");
  expect(css).toContain("calc(var(--cpk-launcher-cadence) - 180ms)");
  expect(css).toContain("animation-delay: 180ms");
});

test("the pulse also washes across the inside beneath the Kite mark", async () => {
  const context = await setup();
  const css = stylesheetText(context.inspector);
  const wash = root(context.inspector).querySelector<HTMLElement>(
    ".cpk-launcher-signal-wash",
  );

  expect(wash).not.toBeNull();
  expect(wash?.getAttribute("aria-hidden")).toBe("true");

  const washRule =
    /\.cpk-launcher-signal-wash\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  expect(washRule).toContain("z-index: 1");
  expect(washRule).toContain("radial-gradient");
  expect(washRule).toContain("transparent 26%");
  expect(css).toContain("@keyframes cpk-launcher-wash");
  expect(css).toContain("animation: cpk-launcher-wash");
});

test("reduced motion holds the halo instead of animating it", async () => {
  const context = await setup();
  const css = stylesheetText(context.inspector);

  const reducedMotion = css.slice(
    css.indexOf("@media (prefers-reduced-motion: reduce)"),
  );
  expect(reducedMotion).toContain(".console-button[data-cpk-signal]::before");
  expect(reducedMotion).toContain(".cpk-launcher-signal-wash");
  expect(reducedMotion).toContain("animation: none");
});

test("the launcher scales to a 20% larger desktop cap and keeps the dot on its rim", async () => {
  const context = await setup();
  const css = stylesheetText(context.inspector);

  expect(css).toMatch(
    /--cpk-launcher-size:\s*clamp\(\s*51\.84px,\s*7vw,\s*62\.208px\s*\)/,
  );
  expect(css).toContain("width: var(--cpk-launcher-size)");
  expect(css).toContain("height: var(--cpk-launcher-size)");
  expect(css).toContain("box-sizing: border-box");
  // 0.35355 is 0.5 x cos45: the dot's centre lands exactly on the rim.
  expect(css).toContain("var(--cpk-launcher-size) * 0.35355");
  expect(css).not.toContain("var(--cpk-launcher-size) * 35%");
});

test("the launcher shows the Kite mark and the signal's own colour", async () => {
  const context = await setup();
  const button = launcherButton(context.inspector);

  expect(button.getAttribute("data-cpk-signal")).toBe("news");
  expect(button.style.getPropertyValue("--cpk-launcher-signal")).toBe(
    "#A78BFA",
  );
  expect(button.style.getPropertyValue("--cpk-launcher-cadence")).toBe(
    "2100ms",
  );

  const mark = requireElement(
    root(context.inspector).querySelector<HTMLImageElement>(
      'img[alt="Inspector logo"]',
    ),
  );
  expect(mark.getAttribute("src")).toContain("svg");
  expect(mark.classList.contains("h-6")).toBe(true);

  // The mark has to paint above the halo, or the ring washes across it and
  // destroys the contrast the rim treatment exists to preserve.
  expect(mark.classList.contains("cpk-launcher-mark")).toBe(true);
  const markRule =
    /\.cpk-launcher-mark\s*\{([\s\S]*?)\}/.exec(
      stylesheetText(context.inspector),
    )?.[1] ?? "";
  expect(markRule).toContain("z-index: 2");
  expect(markRule).toContain("height: calc(var(--cpk-launcher-size) / 1.8)");
});

test("the Kite crop leaves the canonical artwork paths untouched", () => {
  const svg = readFileSync("src/assets/inspector-logo-kite.svg", "utf8");
  const paths = Array.from(
    svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g),
    (match) => match[1] ?? "",
  );

  expect(svg).toContain('viewBox="4.57 3.36 17.8 17.8"');
  expect(paths).toHaveLength(7);
  expect(createHash("sha256").update(paths.join("\n")).digest("hex")).toBe(
    "1e8c159e6743cb467fbe245e1b9948806f3da4e3659cbdabbb69582fc9adb287",
  );
});

test("pressing the launcher opens Home when the signal is unread", async () => {
  const context = await setup({ persistedMenu: "ag-ui-events" });

  await click(context.inspector, launcherButton(context.inspector));

  expect(
    root(context.inspector).querySelector(
      'button[data-inspector-menu-key="home"][aria-current="page"]',
    ),
  ).not.toBeNull();
  expect(whatsNewState(context.inspector)).toBeNull();
  expect(navUnreadMarker(context.inspector)).not.toBeNull();
});

test("a mouse press on the launcher behaves exactly like a keypress", async () => {
  // The launcher opens from its pointerup handler as well as from click, and
  // pointer events land first, so the two paths are genuinely separate. A
  // divergence between them once slipped through unnoticed.
  const context = await setup({ persistedMenu: "ag-ui-events" });

  await press(context.inspector, launcherButton(context.inspector));

  expect(
    root(context.inspector).querySelector(
      'button[data-inspector-menu-key="home"][aria-current="page"]',
    ),
  ).not.toBeNull();
  expect(navUnreadMarker(context.inspector)).not.toBeNull();
});

test("the dot is decoration, and pressing it just opens the launcher", async () => {
  const context = await setup({ persistedMenu: "ag-ui-events" });

  await press(context.inspector, launcherDot(context.inspector));

  expect(
    root(context.inspector).querySelector(
      'button[data-inspector-menu-key="home"][aria-current="page"]',
    ),
  ).not.toBeNull();
});

test("the marked navigation entry is the way into What's new", async () => {
  const context = await setup({ persistedMenu: "ag-ui-events" });
  await click(context.inspector, launcherButton(context.inspector));

  await click(context.inspector, navUnreadMarker(context.inspector));

  expect(whatsNewState(context.inspector)).toBe("content");
  expect(navUnreadMarker(context.inspector)).toBeNull();
  expect(launcherDot(context.inspector)).toBeNull();
});

test("a mouse press with nothing unread still restores the reader's tab", async () => {
  const context = await setup({
    persistedMenu: "ag-ui-events",
    readTimestamp: TIMESTAMP,
  });

  await press(context.inspector, launcherButton(context.inspector));

  expect(
    root(context.inspector).querySelector(
      'button[data-inspector-menu-key="ag-ui-events"][aria-current="page"]',
    ),
  ).not.toBeNull();
});

test("with nothing unread the launcher restores the tab the reader left", async () => {
  const context = await setup({
    persistedMenu: "ag-ui-events",
    readTimestamp: TIMESTAMP,
  });

  expect(launcherDot(context.inspector)).toBeNull();
  await click(context.inspector, launcherButton(context.inspector));

  expect(
    root(context.inspector).querySelector(
      'button[data-inspector-menu-key="ag-ui-events"][aria-current="page"]',
    ),
  ).not.toBeNull();
});

test("the launcher carries the unread hint on itself, not on the dot", async () => {
  const context = await setup();

  expect(launcherButton(context.inspector).getAttribute("title")).toBe(
    "What's new — unread",
  );
  expect(
    requireElement(launcherDot(context.inspector)).getAttribute("title"),
  ).toBeNull();
});

test("the navigation marker is static, and shares the dot's colour", async () => {
  // Restored open on another tab: the launcher is hidden, so the marker on the
  // navigation entry is the only thing still carrying the signal.
  const context = await setup({
    persistedMenu: "ag-ui-events",
    persistedOpen: true,
  });

  const entry = requireElement(navUnreadMarker(context.inspector));
  expect(entry.querySelector(".inspector-nav-signal-dot")).not.toBeNull();
  expect(entry.getAttribute("aria-label")).toBe("What's New, new content");

  const marker = requireElement(
    entry.querySelector<HTMLElement>(".inspector-nav-signal-dot"),
  );
  // The marker is tone-selected rather than one hardcoded colour, because a
  // second signal now marks a different entry in a different colour. The
  // announcement keeps the lilac it always had.
  expect(marker.getAttribute("data-cpk-signal-tone")).toBe("news");

  const css = stylesheetText(context.inspector);
  const rule =
    /\.inspector-nav-signal-dot\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  // Same colour token as the launcher dot, and no movement: an animation here
  // would compete with the live event stream a developer is watching.
  expect(rule.toUpperCase()).toContain("#A78BFA");
  expect(rule).not.toContain("animation");

  const errorRule =
    /\.inspector-nav-signal-dot\[data-cpk-signal-tone="error"\]\s*\{([\s\S]*?)\}/.exec(
      css,
    )?.[1] ?? "";
  expect(errorRule.toUpperCase()).not.toContain("#A78BFA");
  expect(errorRule).not.toContain("animation");
});
