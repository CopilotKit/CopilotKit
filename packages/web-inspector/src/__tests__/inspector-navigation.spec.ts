import { HttpAgent } from "@ag-ui/client";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type { InspectorMetadataV1 } from "@copilotkit/core";
import type { ɵThread } from "@copilotkit/core";
import { expect, test, vi } from "vitest";

import { WebInspectorElement } from "../index.js";

type InspectorNavigationContext = {
  core: CopilotKitCore;
  inspector: WebInspectorElement;
  selectedMenuBeforeCore?: unknown;
  open: () => Promise<void>;
  selectGroup: (key: string) => Promise<void>;
  selectLeaf: (key: string) => Promise<void>;
  emitEvent: (type: "RUN_FINISHED" | "RUN_ERROR") => Promise<void>;
  toggleSettings: () => Promise<void>;
  teardown: () => void;
};

type SetupOptions = {
  agent?: boolean;
  agentIds?: string[];
  appendBeforeCore?: boolean;
  catalog?: boolean;
  frontendTools?: boolean;
  metadata?: InspectorMetadataV1;
  persistedState?: string;
  announcement?: {
    timestamp: string;
    previewText?: string;
    announcement: string;
  };
  runtimeMode?: "sse" | "intelligence";
  threads?: ɵThread[];
  failThreadMessages?: boolean;
};

/** Build the trusted account metadata fixture used by the shell test. */
function trustedMetadata(): InspectorMetadataV1 {
  return {
    schemaVersion: 1,
    identity: {
      organizationName: "Acme Inc.",
      projectName: "Support",
    },
    plan: { code: "enterprise", label: "Enterprise" },
    license: { state: "valid" },
    action: {
      kind: "manage_plan",
      url: "https://cloud.copilotkit.ai/actions/manage_plan",
    },
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: 37,
    },
  };
}

/** Return a JSON response with a matching content type. */
function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Wait for an observable public state without reaching into component fields. */
async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

/** Mount an inspector around a real core and expose public user interactions. */
async function setup(
  options: SetupOptions = {},
): Promise<InspectorNavigationContext> {
  document.body.replaceChildren();
  window.localStorage.clear();
  if (options.persistedState !== undefined) {
    window.localStorage.setItem("cpk:inspector:state", options.persistedState);
  }

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://cdn.copilotkit.ai/announcements.json") {
        if (!options.announcement) {
          return new Response(null, { status: 404 });
        }
        return jsonResponse({
          timestamp: options.announcement.timestamp,
          previewText:
            options.announcement.previewText ?? "New from CopilotKit",
          announcement: options.announcement.announcement,
        });
      }
      if (url.endsWith("/info")) {
        return jsonResponse({
          version: "1.0.0",
          agents: options.agent
            ? { default: { description: "assistant", capabilities: {} } }
            : {},
          audioFileTranscriptionEnabled: false,
          mode: options.runtimeMode ?? "sse",
          threadEndpoints: {
            list: Boolean(options.threads),
            inspect: Boolean(options.threads),
            mutations: false,
            realtimeMetadata: false,
          },
          inspectorMetadata: options.metadata !== undefined,
          licenseStatus: options.metadata?.license?.state ?? "unknown",
          telemetryDisabled: true,
        });
      }
      if (url.endsWith("/inspector-metadata")) {
        return options.metadata
          ? jsonResponse(options.metadata)
          : new Response(null, { status: 204 });
      }
      if (url.endsWith("/memories")) {
        return jsonResponse({ memories: [] });
      }
      if (url.includes("/threads?")) {
        return jsonResponse({ threads: options.threads ?? [], joinCode: null });
      }
      if (url.endsWith("/threads/thread-1/messages")) {
        if (options.failThreadMessages) {
          return new Response("missing thread", { status: 500 });
        }
        return jsonResponse({
          messages: [
            { id: "message-1", role: "user", content: "Earlier question" },
            {
              id: "message-2",
              role: "assistant",
              content: "Earlier answer",
            },
          ],
        });
      }
      if (url.endsWith("/threads/thread-1/state")) {
        return jsonResponse({ state: { topic: "billing" } });
      }
      throw new Error(`Unexpected inspector request: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  const core = new CopilotKitCore({
    runtimeUrl: "http://localhost:4000/api/copilotkit",
    runtimeTransport: "rest",
    deferInitialConnection: true,
    tools: options.frontendTools
      ? [
          {
            name: "lookup",
            description: "Find support records.",
            handler: async () => ({ found: true }),
          },
        ]
      : [],
  });
  if (options.catalog) {
    core.setCatalogComponents([
      {
        name: "SupportCard",
        description: "Support result card.",
        schema: { type: "object" },
      },
    ]);
  }
  const inspector = new WebInspectorElement();
  let selectedMenuBeforeCore: unknown;
  if (options.appendBeforeCore) {
    document.body.appendChild(inspector);
    await inspector.updateComplete;
    const opener = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
      'button[aria-label^="Web Inspector"]',
    );
    if (!opener) {
      throw new Error("Web Inspector opener was not rendered before Core");
    }
    opener.click();
    await inspector.updateComplete;
    selectedMenuBeforeCore = storedSelectedMenu();
    inspector.core = core;
  } else {
    inspector.core = core;
    document.body.appendChild(inspector);
  }
  core.connect();

  await waitFor(
    () =>
      core.runtimeConnectionStatus ===
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    "the Core handshake",
  );
  if (options.agentIds?.length) {
    core.setAgents__unsafe_dev_only(
      Object.fromEntries(
        options.agentIds.map((agentId) => [
          agentId,
          new HttpAgent({
            url: `http://localhost:4000/api/copilotkit/agents/${agentId}`,
          }),
        ]),
      ),
    );
  }
  if (options.metadata) {
    await waitFor(
      () => core.inspectorMetadata !== undefined,
      "trusted inspector metadata",
    );
  }
  await inspector.updateComplete;

  const click = async (selector: string, message: string): Promise<void> => {
    const control =
      inspector.shadowRoot?.querySelector<HTMLButtonElement>(selector);
    if (!control) {
      throw new Error(message);
    }
    control.click();
    await inspector.updateComplete;
  };

  return {
    core,
    inspector,
    selectedMenuBeforeCore,
    open: async () => {
      if (inspector.shadowRoot?.querySelector(".inspector-window")) {
        return;
      }
      const opener = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
        'button[aria-label^="Web Inspector"]',
      );
      if (!opener) {
        throw new Error("Web Inspector opener was not rendered");
      }
      opener.click();
      await inspector.updateComplete;
    },
    selectGroup: (key) =>
      click(
        `button[data-inspector-group="${key}"]`,
        `Inspector group was not rendered: ${key}`,
      ),
    selectLeaf: (key) =>
      click(
        `button[data-inspector-menu-key="${key}"]`,
        `Inspector leaf was not rendered: ${key}`,
      ),
    emitEvent: async (type) => {
      const recordAgentEvent = Reflect.get(inspector, "recordAgentEvent");
      if (typeof recordAgentEvent !== "function") {
        throw new Error("Inspector event recorder was unavailable");
      }
      Reflect.apply(recordAgentEvent, inspector, ["support", type, { type }]);
      await inspector.updateComplete;
    },
    toggleSettings: () =>
      click('button[aria-label="Settings"]', "Settings was not rendered"),
    teardown: () => {
      inspector.remove();
      core.setRuntimeUrl(undefined);
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      window.localStorage.clear();
      document.body.replaceChildren();
      document.getElementById("cpk-inspector-brand-fonts")?.remove();
    },
  };
}

/** Require one rendered element so fixture defects fail with a useful message. */
function requireElement<T extends Node>(
  element: T | null | undefined,
  message: string,
): T {
  if (!element) {
    throw new Error(message);
  }
  return element;
}

/** Read only the persisted legacy leaf without assuming the storage shape. */
function storedSelectedMenu(): unknown {
  const serialized = window.localStorage.getItem("cpk:inspector:state");
  if (serialized === null) {
    return undefined;
  }
  const state: unknown = JSON.parse(serialized);
  if (typeof state !== "object" || state === null) {
    return undefined;
  }
  return Reflect.get(state, "selectedMenu");
}

function storedHasOpenedInspector(): unknown {
  const serialized = window.localStorage.getItem("cpk:inspector:state");
  if (serialized === null) {
    return undefined;
  }
  const state: unknown = JSON.parse(serialized);
  if (typeof state !== "object" || state === null) {
    return undefined;
  }
  return Reflect.get(state, "hasOpenedInspector");
}

function storedColorSchemePreference(): unknown {
  const serialized = window.localStorage.getItem("cpk:inspector:state");
  if (serialized === null) {
    return undefined;
  }
  const state: unknown = JSON.parse(serialized);
  if (typeof state !== "object" || state === null) {
    return undefined;
  }
  return Reflect.get(state, "colorSchemePreference");
}

/** Require that a group and exact leaf both expose current state. */
function expectCurrentNavigation(
  root: ShadowRoot,
  group: string,
  leaf: string,
): void {
  expect(
    root.querySelector(
      `button[data-inspector-group="${group}"][data-inspector-menu-key="${leaf}"][aria-current="page"]`,
    ),
    `${group}/${leaf} should be the current Inspector pane`,
  ).not.toBeNull();
}

/** Prove that focus lands and retains two-pixel outline geometry. */
function expectVisibleFocus(root: ShadowRoot, control: HTMLElement): void {
  control.focus();
  expect(root.activeElement).toBe(control);
  const styles = getComputedStyle(control);
  expect(styles.outlineStyle).toBe("solid");
  expect(Number.parseFloat(styles.outlineWidth)).toBeGreaterThanOrEqual(2);
}

const SAVED_THREAD: ɵThread = {
  id: "thread-1",
  organizationId: "organization-1",
  agentId: "default",
  createdById: "user-1",
  name: "Saved conversation",
  archived: false,
  createdAt: "2026-08-19T12:00:00.000Z",
  updatedAt: "2026-08-19T12:01:00.000Z",
};

async function selectSavedThread(
  inspector: WebInspectorElement,
): Promise<void> {
  const root = requireElement(
    inspector.shadowRoot,
    "Web Inspector shadow root was not rendered",
  );
  await waitFor(() => {
    const list = root.querySelector("cpk-thread-list");
    return Boolean(list?.shadowRoot?.querySelector(".cpk-tl__item"));
  }, "saved thread row");
  const list = requireElement(
    root.querySelector("cpk-thread-list"),
    "Thread list was not rendered",
  );
  const row = requireElement(
    list.shadowRoot?.querySelector<HTMLButtonElement>(".cpk-tl__item"),
    "Saved thread row was not rendered",
  );
  row.click();
  await inspector.updateComplete;
  await waitFor(
    () => root.querySelector("cpk-thread-details") !== null,
    "thread details",
  );
}

function tryFromHereButton(root: ShadowRoot): HTMLButtonElement | null {
  const details = root.querySelector("cpk-thread-details");
  return (
    details?.shadowRoot?.querySelector<HTMLButtonElement>(
      'button[aria-label="Try from here"]',
    ) ?? null
  );
}

function sidebarLeaves(root: ShadowRoot): string[] {
  const navigation = requireElement(
    root.querySelector<HTMLElement>('nav[aria-label="Inspector"]'),
    "Inspector sidebar was not rendered",
  );
  return Array.from(
    navigation.querySelectorAll<HTMLButtonElement>(
      "button[data-inspector-menu-key]",
    ),
  ).map((control) => control.dataset.inspectorMenuKey ?? "");
}

test("first launch opens Home with live navigation and sidebar statuses", async () => {
  const context = await setup();
  try {
    await context.open();

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const accountStrip = requireElement(
      root.querySelector<HTMLElement>("[data-inspector-account-strip]"),
      "Inspector account strip was not rendered",
    );
    const navigation = requireElement(
      root.querySelector<HTMLElement>('nav[aria-label="Inspector"]'),
      "Inspector sidebar was not rendered",
    );
    const home = requireElement(
      root.querySelector<HTMLElement>("[data-inspector-home]"),
      "Home briefing was not rendered",
    );
    expect(home.querySelector(".inspector-home-hero")).toBeNull();
    expect(home.querySelector("[data-inspector-whats-new-preview]")).toBeNull();
    expect(sidebarLeaves(root)).toEqual([
      "home",
      "whats-new",
      "playground",
      "threads",
      "memories",
      "agents",
      "ag-ui-events",
      "agent-context",
    ]);
    expect(navigation.textContent).toContain("Workbench");
    expect(navigation.textContent).toContain("Inspect");
    expect(navigation.textContent).toContain("Learning");
    expect(navigation.textContent).toContain("Playground");
    expectCurrentNavigation(root, "home", "home");
    const engineerCta = requireElement(
      root.querySelector<HTMLAnchorElement>("[data-inspector-thread-cta]"),
      "Header engineer CTA was not rendered",
    );
    expect(engineerCta.textContent).toContain("Talk to an Engineer");
    expect(engineerCta.closest("[data-inspector-account-strip]")).toBe(
      accountStrip,
    );
    expect(
      root.querySelector("[data-inspector-sidebar-agent-selector]"),
    ).not.toBeNull();
    expect(
      root.querySelector("[data-inspector-sidebar-intelligence]")?.textContent,
    ).toContain("Intelligence is off");
    expect(root.querySelector("[data-inspector-sidebar-runtime]")).toBeNull();
    expect(
      accountStrip.querySelector('[data-inspector-metadata="identity"]'),
    ).toBeNull();
    expect(
      accountStrip.querySelector('[data-inspector-metadata="plan"]'),
    ).toBeNull();
    expect(root.querySelector('nav[aria-label="Agent navigation"]')).toBeNull();
    expect(storedSelectedMenu()).toBe("home");
    expect(storedHasOpenedInspector()).toBe(true);
  } finally {
    context.teardown();
  }
});

test("Playground creates an isolated local thread and explains ephemeral durability", async () => {
  const context = await setup({ agent: true });
  try {
    await context.open();
    await context.selectLeaf("playground");

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    expectCurrentNavigation(root, "workbench", "playground");
    expect(root.querySelector("#cpk-main-scroll")?.textContent).toContain(
      "Agent: default",
    );
    const input = requireElement(
      root.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Playground message"]',
      ),
      "Playground message input was not rendered",
    );
    input.value = "Hello from Inspector";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await context.inspector.updateComplete;
    expect(
      requireElement(
        root.querySelector<HTMLButtonElement>(
          'button[aria-label="Send playground message"]',
        ),
        "Playground send button was not rendered",
      ).disabled,
    ).toBe(false);

    const newThread = requireElement(
      Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "New thread",
      ),
      "Playground New thread button was not rendered",
    );
    newThread.click();
    await context.inspector.updateComplete;

    const notice = requireElement(
      root.querySelector<HTMLElement>("[data-playground-ephemeral-notice]"),
      "Ephemeral thread notice was not rendered",
    );
    expect(notice.textContent?.replace(/\s+/g, " ")).toContain(
      "deleted when your local session ends",
    );
    expect(notice.textContent).toContain("Set up Intelligence");
  } finally {
    context.teardown();
  }
});

test("Playground forks saved thread history without changing the app agent", async () => {
  const context = await setup({
    agent: true,
    threads: [
      {
        id: "thread-1",
        organizationId: "organization-1",
        agentId: "default",
        createdById: "user-1",
        name: "Saved conversation",
        archived: false,
        createdAt: "2026-08-19T12:00:00.000Z",
        updatedAt: "2026-08-19T12:01:00.000Z",
      },
    ],
  });
  try {
    await context.open();
    await context.selectLeaf("playground");

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    await waitFor(
      () => root.querySelector("#cpk-playground-thread-source") !== null,
      "saved thread selector",
    );
    const source = requireElement(
      root.querySelector<HTMLSelectElement>("#cpk-playground-thread-source"),
      "Saved thread selector was not rendered",
    );
    source.value = "thread-1";
    source.dispatchEvent(
      new Event("change", { bubbles: true, composed: true }),
    );

    await waitFor(
      () => root.textContent?.includes("Earlier answer") === true,
      "saved thread messages",
    );
    expect(root.textContent).toContain("Earlier question");
    expect(context.core.getAgent("default")?.messages).toEqual([]);
  } finally {
    context.teardown();
  }
});

test("Try from here copies a stored thread into Playground without changing the app agent", async () => {
  const context = await setup({
    agent: true,
    agentIds: ["default"],
    threads: [SAVED_THREAD],
  });
  try {
    await context.open();
    await context.selectLeaf("threads");
    await selectSavedThread(context.inspector);

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const button = requireElement(
      tryFromHereButton(root),
      "Try from here was not rendered",
    );
    button.click();

    await waitFor(
      () => root.textContent?.includes("Earlier answer") === true,
      "copied thread messages",
    );
    expectCurrentNavigation(root, "workbench", "playground");
    expect(root.textContent).toContain("Earlier question");
    expect(context.core.getAgent("default")?.messages).toEqual([]);
    expect(
      root.querySelector<HTMLSelectElement>("#cpk-playground-thread-source")
        ?.value,
    ).toBe("thread-1");
  } finally {
    context.teardown();
  }
});

test("Try from here stays on Threads when messages fail", async () => {
  const context = await setup({
    agent: true,
    agentIds: ["default"],
    threads: [SAVED_THREAD],
    failThreadMessages: true,
  });
  try {
    await context.open();
    await context.selectLeaf("threads");
    await selectSavedThread(context.inspector);
    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const button = requireElement(
      tryFromHereButton(root),
      "Try from here was not rendered",
    );
    button.click();
    await waitFor(() => {
      const details = root.querySelector("cpk-thread-details");
      return (
        details?.shadowRoot?.textContent?.includes("Failed to load thread") ===
        true
      );
    }, "Try from here error");
    expectCurrentNavigation(root, "workbench", "threads");
  } finally {
    context.teardown();
  }
});

test("Try from here is hidden on example tour threads", async () => {
  const context = await setup({ agent: true, threads: [] });
  try {
    await context.open();
    await context.selectLeaf("threads");
    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    await waitFor(() => {
      const list = root.querySelector("cpk-thread-list");
      return Boolean(list?.shadowRoot?.querySelector(".cpk-tl__item"));
    }, "example thread row");
    const list = requireElement(
      root.querySelector("cpk-thread-list"),
      "Thread list was not rendered",
    );
    const row = requireElement(
      list.shadowRoot?.querySelector<HTMLButtonElement>(".cpk-tl__item"),
      "Example thread row was not rendered",
    );
    row.click();
    await context.inspector.updateComplete;
    await waitFor(
      () => root.querySelector("cpk-thread-details") !== null,
      "example thread details",
    );
    expect(tryFromHereButton(root)).toBeNull();
  } finally {
    context.teardown();
  }
});

test("Playground omits the durability CTA when Intelligence is active", async () => {
  const context = await setup({ agent: true, runtimeMode: "intelligence" });
  try {
    await context.open();
    await context.selectLeaf("playground");

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const newThread = requireElement(
      Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "New thread",
      ),
      "Playground New thread button was not rendered",
    );
    newThread.click();
    await context.inspector.updateComplete;

    expect(root.querySelector("[data-playground-ephemeral-notice]")).toBeNull();
  } finally {
    context.teardown();
  }
});

test("Playground composer stays readable in dark mode", async () => {
  const context = await setup({ agent: true });
  try {
    await context.open();
    await context.selectLeaf("playground");

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const inspectorWindow = requireElement(
      root.querySelector<HTMLElement>(".inspector-window"),
      "Inspector window was not rendered",
    );
    const toggle = requireElement(
      root.querySelector<HTMLButtonElement>("[data-inspector-theme-toggle]"),
      "Theme toggle was not rendered",
    );

    toggle.click();
    await waitFor(
      () => inspectorWindow.dataset.colorScheme === "dark",
      "dark color scheme",
    );

    expect(
      root
        .querySelector('textarea[aria-label="Playground message"]')
        ?.classList.contains("cpk-playground-input"),
    ).toBe(true);
    expect(root.querySelector(".cpk-playground-composer")).not.toBeNull();
    expect(
      root
        .querySelector('button[aria-label="Send playground message"]')
        ?.classList.contains("cpk-playground-send"),
    ).toBe(true);
  } finally {
    context.teardown();
  }
});

test("Playground surface styles live in the Web Inspector shadow root", () => {
  const styles = WebInspectorElement.styles as Array<{ cssText?: string }>;
  const cssText = styles.map((style) => style.cssText ?? "").join("\n");

  expect(cssText).toMatch(
    /\.cpk-playground-root\s*\{[^}]*background:\s*#fbfbfd\s*!important/s,
  );
  expect(cssText).toMatch(
    /\.cpk-playground-header\s*\{[^}]*min-height:\s*58px[^}]*background:\s*#f7f6fd\s*!important/s,
  );
  expect(cssText).toMatch(
    /\.cpk-playground-composer\s*\{[^}]*border:\s*1px solid #dcdce8/s,
  );
  expect(cssText).toMatch(
    /\.inspector-window\[data-color-scheme="dark"\]\s+\.cpk-playground-composer\s*\{[^}]*background:\s*#15171e\s*!important/s,
  );
  expect(cssText).toContain("@keyframes cpk-playground-message-enter");
});

test("trusted identity stays on Home while connection state moves into branded chrome", async () => {
  const context = await setup({ metadata: trustedMetadata() });
  try {
    await context.open();

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const accountStrip = requireElement(
      root.querySelector<HTMLElement>("[data-inspector-account-strip]"),
      "Inspector account strip was not rendered",
    );
    const identity = requireElement(
      root.querySelector<HTMLElement>('[data-inspector-metadata="identity"]'),
      "Trusted account identity was not rendered",
    );
    const plan = requireElement(
      root.querySelector<HTMLElement>('[data-inspector-metadata="plan"]'),
      "Trusted account plan was not rendered",
    );
    const connectedStatus = requireElement(
      root.querySelector<HTMLElement>(
        "[data-inspector-sidebar-intelligence] .inspector-sidebar-status-copy",
      ),
      "Connected Intelligence status was not rendered",
    );

    expect(identity.closest("[data-inspector-account-strip]")).toBeNull();
    expect(getComputedStyle(accountStrip).color).toBe("rgb(1, 5, 7)");
    expect(connectedStatus.querySelector("strong")?.textContent?.trim()).toBe(
      "Acme Inc.",
    );
    expect(connectedStatus.querySelector("span")?.textContent?.trim()).toBe(
      "Enterprise plan",
    );
    expect(root.querySelector(".inspector-sidebar-status-icon")).toBeNull();
    expect(root.querySelector("[data-inspector-sidebar-runtime]")).toBeNull();
    expect(identity.textContent).toContain("Acme Inc.");
    expect(identity.textContent).toContain("Support");
    expect(plan.textContent).toContain("Enterprise");
    const home = requireElement(
      root.querySelector<HTMLElement>("[data-inspector-home]"),
      "Home briefing was not rendered",
    );
    expect(home.querySelector(".inspector-home-hero")).toBeNull();
    const sectionTitle = requireElement(
      home.querySelector<HTMLElement>(".inspector-home-section-title"),
      "System Health heading was not rendered",
    );
    expect(sectionTitle.textContent?.trim()).toBe("System Health");
    const runtimeHealth = requireElement(
      home.querySelector<HTMLElement>('[data-inspector-home-card="runtime"]'),
      "System Health strip was not rendered",
    );
    expect(runtimeHealth.dataset.healthState).toBe("healthy");
    expect(runtimeHealth.getAttribute("aria-label")).toBe("System Health");
    expect(
      home.querySelector(".inspector-system-health-header")?.textContent,
    ).toContain("Healthy");
    expect(home.querySelector(".inspector-system-health-heading p")).toBeNull();
    expect(
      runtimeHealth.querySelector('[data-runtime-health-signal="runtime"]')
        ?.textContent,
    ).toContain("Available");
    expect(
      runtimeHealth.querySelector('[data-runtime-health-signal="runtime"]')
        ?.textContent,
    ).toContain("http://localhost:4000/api/copilotkit");
    const runtimeUrl = requireElement(
      runtimeHealth.querySelector<HTMLElement>(".inspector-system-health-url"),
      "Runtime URL detail was not rendered",
    );
    expect(runtimeUrl.dataset.fullValue).toBe(
      "http://localhost:4000/api/copilotkit",
    );
    expect(runtimeUrl.tabIndex).toBe(0);
    expect(
      runtimeHealth
        .querySelector('[data-runtime-health-signal="connection"]')
        ?.textContent?.replace(/\s+/g, " "),
    ).toContain("Live updates Ready New events will appear here.");
    expect(
      runtimeHealth
        .querySelector('[data-runtime-health-signal="last-event"]')
        ?.textContent?.replace(/\s+/g, " "),
    ).toContain("Recent activity No events yet Waiting for an agent to run.");
    expect(
      runtimeHealth.querySelectorAll("[data-runtime-health-signal]"),
    ).toHaveLength(3);
    expect(
      runtimeHealth.querySelector('[data-runtime-health-signal="url"]'),
    ).toBeNull();
    expect(runtimeHealth.querySelector("button")).toBeNull();
    expect(
      runtimeHealth.querySelector(".inspector-system-health-icon"),
    ).toBeNull();
    const intelligenceHud = requireElement(
      home.querySelector<HTMLElement>(
        '[data-inspector-home-card="intelligence"]',
      ),
      "Intelligence HUD was not rendered",
    );
    expect(intelligenceHud.textContent).toContain("Connected");
    expect(intelligenceHud.textContent).toContain("Support");
    expect(intelligenceHud.textContent).toContain("Acme Inc.");
    expect(intelligenceHud.textContent).toContain("148 / 200");
    expect(
      intelligenceHud.querySelector(".inspector-intelligence-hud-heading p"),
    ).toBeNull();
    const systemState = requireElement(
      home.querySelector<HTMLElement>(".inspector-system-health-state"),
      "System Health state was not rendered",
    );
    const intelligenceState = requireElement(
      intelligenceHud.querySelector<HTMLElement>(
        ".inspector-intelligence-hud-state",
      ),
      "Intelligence state was not rendered",
    );
    expect(systemState.dataset.tone).toBe("success");
    expect(intelligenceState.dataset.tone).toBe("success");
    expect(getComputedStyle(systemState).borderRadius).toBe(
      getComputedStyle(intelligenceState).borderRadius,
    );
    expect(
      intelligenceHud.querySelector(".inspector-intelligence-hud-icon"),
    ).toBeNull();
    expect(
      intelligenceHud.querySelector<HTMLAnchorElement>(
        '[data-inspector-home-intelligence-action="manage_plan"]',
      )?.textContent,
    ).toContain("Manage plan");
    expect(
      intelligenceHud
        .querySelector<HTMLAnchorElement>(
          '[data-inspector-home-intelligence-action="manage_plan"]',
        )
        ?.closest(".inspector-intelligence-hud-plan-summary"),
    ).not.toBeNull();
    const features = requireElement(
      home.querySelector<HTMLElement>('[data-inspector-home-card="services"]'),
      "Features section was not rendered",
    );
    expect(features.textContent).toContain("Features");
    expect(features.textContent?.replace(/\s+/g, " ")).toContain(
      "1 active, 6 off",
    );
    expect(features.querySelectorAll("[data-inspector-service]")).toHaveLength(
      7,
    );
    expect(
      features.querySelectorAll("[data-feature-state-group]"),
    ).toHaveLength(2);
    expect(
      features.querySelectorAll(
        '[data-feature-state-group="active"] [data-inspector-service]',
      ),
    ).toHaveLength(1);
    expect(
      features.querySelectorAll(
        '[data-feature-state-group="available"] [data-inspector-service]',
      ),
    ).toHaveLength(6);
    expect(
      features.querySelector<HTMLElement>('[data-inspector-service="memory"]')
        ?.dataset.state,
    ).toBe("on");
    expect(
      features.querySelector<HTMLElement>('[data-inspector-service="threads"]')
        ?.dataset.state,
    ).toBe("off");
    expect(
      features.querySelector<HTMLElement>('[data-inspector-service="audio"]')
        ?.dataset.state,
    ).toBe("off");
    expect(features.querySelector(".inspector-home-feature-check")).toBeNull();
    expect(root.querySelector("[data-inspector-home-connected]")).toBeNull();
    const intelligenceStatus = requireElement(
      root.querySelector<HTMLElement>("[data-inspector-sidebar-intelligence]"),
      "Intelligence sidebar status was not rendered",
    );
    expect(intelligenceStatus.textContent).toContain("Acme Inc.");
    expect(intelligenceStatus.textContent).toContain("Enterprise plan");
    expect(
      intelligenceStatus.querySelector<HTMLAnchorElement>(
        '[data-inspector-sidebar-intelligence-action="manage_plan"]',
      )?.textContent,
    ).toContain("Manage plan");
    const logo = requireElement(
      accountStrip.querySelector<HTMLImageElement>('img[alt="CopilotKit"]'),
      "CopilotKit logo was not rendered",
    );
    expect(getComputedStyle(logo).filter).toBe("none");
    for (const label of [
      "Window layout",
      "Switch to dark mode",
      "Settings",
      "Close Web Inspector",
    ]) {
      const control = requireElement(
        accountStrip.querySelector<HTMLButtonElement>(
          `button[aria-label="${label}"]`,
        ),
        `${label} should stay in the account strip`,
      );
      expectVisibleFocus(root, control);
    }
  } finally {
    context.teardown();
  }
});

test("disabled Intelligence becomes a setup action in the sidebar and on Home", async () => {
  const setupUrl = "https://cloud.copilotkit.ai/actions/enable_intelligence";
  const context = await setup({
    metadata: {
      schemaVersion: 1,
      license: { state: "none" },
      action: {
        kind: "enable_intelligence",
        url: setupUrl,
      },
    },
  });
  try {
    await context.open();

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const sidebarSetup = requireElement(
      root.querySelector<HTMLAnchorElement>(
        '[data-inspector-sidebar-intelligence-action="enable_intelligence"]',
      ),
      "Sidebar Intelligence setup action was not rendered",
    );
    expect(sidebarSetup.textContent?.replace(/\s+/g, " ")).toContain(
      "Intelligence is off Set up Threads and Memory",
    );
    expect(sidebarSetup.href).toBe(setupUrl);

    const home = requireElement(
      root.querySelector<HTMLElement>("[data-inspector-home]"),
      "Home briefing was not rendered",
    );
    expect(home.dataset.inspectorHomeState).toBe("disconnected");
    const intelligenceHud = requireElement(
      home.querySelector<HTMLElement>(
        '[data-inspector-home-card="intelligence"]',
      ),
      "Disconnected Intelligence module was not rendered",
    );
    expect(intelligenceHud.dataset.state).toBe("disconnected");
    expect(intelligenceHud.dataset.mode).toBe("install");
    expect(intelligenceHud.textContent).toContain("CopilotKit Intelligence");
    expect(
      intelligenceHud.querySelector(".inspector-intelligence-hud-details"),
    ).toBeNull();

    // The install prompt is the primary action; the signup page is demoted to
    // a secondary link. Assert both, because the whole point of this card is
    // that leaving for a signup page is no longer the only way forward.
    const copyPrompt = requireElement(
      intelligenceHud.querySelector<HTMLButtonElement>(
        "[data-inspector-intelligence-copy-prompt]",
      ),
      "Home Intelligence copy-prompt button was not rendered",
    );
    expect(copyPrompt.textContent).toContain("Copy setup prompt");

    const homeSetup = requireElement(
      intelligenceHud.querySelector<HTMLAnchorElement>(
        '[data-inspector-home-intelligence-action="enable_intelligence"]',
      ),
      "Home Intelligence setup action was not rendered",
    );
    // Names the alternative route, not an explainer: this href is the
    // Intelligence product page, so promising an explanation would mislead.
    expect(homeSetup.textContent).toContain("Set it up yourself");
    expect(homeSetup.href).toBe(setupUrl);

    // The condensed story only belongs to the never-connected state.
    const story = requireElement(
      intelligenceHud.querySelector<HTMLElement>(
        "[data-inspector-intelligence-story]",
      ),
      "Intelligence story was not rendered",
    );
    expect(story.querySelectorAll(".inspector-intelligence-beat")).toHaveLength(
      4,
    );
    expect(story.dataset.beat).toBe("threads");

    // Copy and picture must stay paired — one slide of prose per beat, and the
    // same beat marked active in both. This is the whole point of the section:
    // an earlier version sold Threads in prose while showing Learning.
    const copy = requireElement(
      intelligenceHud.querySelector<HTMLElement>(
        "[data-inspector-intelligence-copy]",
      ),
      "Intelligence rotating copy was not rendered",
    );
    expect(
      copy.querySelectorAll(".inspector-intelligence-copy-slide"),
    ).toHaveLength(4);
    expect(copy.dataset.beat).toBe(story.dataset.beat);
    const activeCopy = requireElement(
      copy.querySelector<HTMLElement>('[data-active="true"]'),
      "No active copy slide",
    );
    expect(activeCopy.dataset.beatId).toBe("threads");

    // The rotating text is hidden from assistive tech, so one stable sentence
    // has to be exposed in its place.
    expect(copy.getAttribute("aria-hidden")).toBe("true");
    requireElement(
      intelligenceHud.querySelector<HTMLElement>(
        ".inspector-intelligence-sr-summary",
      ),
      "Screen-reader summary was not rendered",
    );

    // Tabs let a developer go back to a slide that already passed.
    expect(
      story.querySelectorAll(".inspector-intelligence-story-tab"),
    ).toHaveLength(4);
    const features = requireElement(
      home.querySelector<HTMLElement>('[data-inspector-home-card="services"]'),
      "Features section was not rendered",
    );
    expect(features.textContent?.replace(/\s+/g, " ")).toContain(
      "0 active, 7 off",
    );
    expect(
      features.querySelector<HTMLElement>('[data-inspector-service="threads"]')
        ?.dataset.state,
    ).toBe("off");
    expect(
      features.querySelectorAll(
        '[data-feature-state-group="active"] [data-inspector-service]',
      ),
    ).toHaveLength(0);
  } finally {
    context.teardown();
  }
});

test("the Home last-event link opens and expands that exact AG-UI event", async () => {
  const context = await setup();

  try {
    await context.open();
    await context.emitEvent("RUN_FINISHED");

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const lastEvent = requireElement(
      root.querySelector<HTMLElement>(
        '[data-runtime-health-signal="last-event"]',
      ),
      "Last event signal was not rendered",
    );
    expect(lastEvent.textContent?.replace(/\s+/g, " ")).toMatch(
      /RUN_FINISHED \d+ second(?:s)? ago View event/,
    );
    expect(
      root
        .querySelector('[data-runtime-health-signal="connection"]')
        ?.textContent?.replace(/\s+/g, " "),
    ).toContain("Live updates Ready New events will appear here.");

    const viewEvent = requireElement(
      lastEvent.querySelector<HTMLButtonElement>(
        ".inspector-system-health-event-link",
      ),
      "Last event link was not rendered",
    );
    viewEvent.click();
    await context.inspector.updateComplete;

    expectCurrentNavigation(root, "inspect", "ag-ui-events");
    const eventRow = requireElement(
      root.querySelector<HTMLElement>("[data-inspector-event-id]"),
      "Linked AG-UI event row was not rendered",
    );
    expect(eventRow.textContent).toContain("RUN_FINISHED");
    expect(eventRow.querySelector("pre")).not.toBeNull();
  } finally {
    context.teardown();
  }
});

test("theme toggle applies and restores the explicit persisted color scheme", async () => {
  const first = await setup();
  let persistedState = "";
  try {
    await first.open();
    const root = requireElement(
      first.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const inspectorWindow = requireElement(
      root.querySelector<HTMLElement>(".inspector-window"),
      "Inspector window was not rendered",
    );
    const toggle = requireElement(
      root.querySelector<HTMLButtonElement>("[data-inspector-theme-toggle]"),
      "Theme toggle was not rendered",
    );

    expect(inspectorWindow.dataset.colorScheme).toBe("light");
    toggle.click();
    await waitFor(
      () => inspectorWindow.dataset.colorScheme === "dark",
      "dark color scheme",
    );
    expect(toggle.getAttribute("aria-label")).toBe("Switch to light mode");
    expect(storedColorSchemePreference()).toBe("dark");
    const serialized = window.localStorage.getItem("cpk:inspector:state");
    if (serialized === null) {
      throw new Error("Theme preference was not persisted");
    }
    persistedState = serialized;
  } finally {
    first.teardown();
  }

  const restored = await setup({ persistedState });
  try {
    await restored.open();
    const root = requireElement(
      restored.inspector.shadowRoot,
      "Restored Web Inspector shadow root was not rendered",
    );
    expect(
      root.querySelector<HTMLElement>(".inspector-window")?.dataset.colorScheme,
    ).toBe("dark");
    expect(
      root
        .querySelector("[data-inspector-theme-toggle]")
        ?.getAttribute("aria-label"),
    ).toBe("Switch to light mode");
  } finally {
    restored.teardown();
  }
});

test("theme follows the system preference until a user chooses a theme", async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "matchMedia",
  );
  let listener: ((event: MediaQueryListEvent) => void) | undefined;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (media: string): MediaQueryList => ({
      matches: media === "(prefers-color-scheme: dark)",
      media,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: (
        _type: string,
        nextListener: EventListenerOrEventListenerObject,
      ) => {
        listener = nextListener as (event: MediaQueryListEvent) => void;
      },
      removeEventListener: () => {
        listener = undefined;
      },
      dispatchEvent: () => true,
    }),
  });

  const context = await setup();
  try {
    await context.open();
    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const inspectorWindow = requireElement(
      root.querySelector<HTMLElement>(".inspector-window"),
      "Inspector window was not rendered",
    );
    const toggle = requireElement(
      root.querySelector<HTMLButtonElement>("[data-inspector-theme-toggle]"),
      "Theme toggle was not rendered",
    );

    expect(inspectorWindow.dataset.colorScheme).toBe("dark");
    expect(storedColorSchemePreference()).toBeUndefined();

    toggle.click();
    await waitFor(
      () => inspectorWindow.dataset.colorScheme === "light",
      "explicit light color scheme",
    );
    expect(storedColorSchemePreference()).toBe("light");

    listener?.({ matches: true } as MediaQueryListEvent);
    await context.inspector.updateComplete;
    expect(inspectorWindow.dataset.colorScheme).toBe("light");
  } finally {
    context.teardown();
    if (originalDescriptor) {
      Object.defineProperty(window, "matchMedia", originalDescriptor);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
  }
});

test("Inspect shows flattened live leaves and hides optional sources", async () => {
  const withTools = await setup({ frontendTools: true, catalog: true });
  try {
    await withTools.open();
    const root = requireElement(
      withTools.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    expect(sidebarLeaves(root)).toEqual([
      "home",
      "whats-new",
      "playground",
      "threads",
      "memories",
      "agents",
      "ag-ui-events",
      "frontend-tools",
      "capabilities",
      "agent-context",
    ]);
    await withTools.selectLeaf("agents");
    expectCurrentNavigation(root, "inspect", "agents");
    expect(root.querySelector('nav[aria-label="Agent navigation"]')).toBeNull();
    expect(root.querySelector("[data-inspector-thread-cta]")).not.toBeNull();
  } finally {
    withTools.teardown();
  }

  const context = await setup({ frontendTools: true, catalog: true });
  try {
    await context.open();
    await context.selectLeaf("frontend-tools");
    context.inspector.core = null;
    await context.inspector.updateComplete;
    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    expect(sidebarLeaves(root)).toEqual([
      "home",
      "whats-new",
      "playground",
      "threads",
      "memories",
      "agents",
      "ag-ui-events",
      "agent-context",
    ]);
    expectCurrentNavigation(root, "inspect", "agents");
    expect(storedSelectedMenu()).toBe("agents");
  } finally {
    context.teardown();
  }
});

test("persisted leaves restore after Inspector has been opened, and first upgrade open is Home", async () => {
  const validLeaves = [
    { leaf: "ag-ui-events", group: "inspect", marker: "No events yet" },
    { leaf: "agents", group: "inspect", marker: "No agent selected" },
    {
      leaf: "frontend-tools",
      group: "inspect",
      marker: "Find support records.",
    },
    {
      leaf: "capabilities",
      group: "inspect",
      marker: "Toggle a capability off",
    },
    {
      leaf: "agent-context",
      group: "inspect",
      marker: "No context available",
    },
    {
      leaf: "playground",
      group: "workbench",
      marker: "Playground",
    },
    {
      leaf: "threads",
      group: "workbench",
      marker: "Threads are unavailable.",
    },
    { leaf: "memories", group: "workbench", marker: "Learning" },
    { leaf: "home", group: "home", marker: "System Health" },
    {
      leaf: "whats-new",
      group: "home",
      marker: "You're all caught up",
    },
  ];

  for (const expected of validLeaves) {
    const context = await setup({
      frontendTools: true,
      catalog: true,
      persistedState: JSON.stringify({
        selectedMenu: expected.leaf,
        hasOpenedInspector: true,
      }),
    });
    try {
      await context.open();
      const root = requireElement(
        context.inspector.shadowRoot,
        "Web Inspector shadow root was not rendered",
      );
      expectCurrentNavigation(root, expected.group, expected.leaf);
      expect(root.querySelector("#cpk-main-scroll")?.textContent).toContain(
        expected.marker,
      );
      expect(storedSelectedMenu()).toBe(expected.leaf);
    } finally {
      context.teardown();
    }
  }

  const upgrade = await setup({
    persistedState: JSON.stringify({ selectedMenu: "threads" }),
  });
  try {
    await upgrade.open();
    const root = requireElement(
      upgrade.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    expectCurrentNavigation(root, "home", "home");
    expect(storedHasOpenedInspector()).toBe(true);
    expect(storedSelectedMenu()).toBe("threads");
  } finally {
    upgrade.teardown();
  }
});

test("Workbench remembers Learning, and Settings does not persist a settings leaf", async () => {
  const context = await setup({ frontendTools: true, catalog: true });
  try {
    await context.open();
    await context.selectLeaf("memories");
    await context.selectLeaf("frontend-tools");
    await context.selectLeaf("memories");

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    expectCurrentNavigation(root, "workbench", "memories");
    expect(storedSelectedMenu()).toBe("memories");

    await context.toggleSettings();
    expect(
      root
        .querySelector<HTMLButtonElement>('button[aria-label="Settings"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(root.querySelector("#cpk-main-scroll")?.textContent).toContain(
      "Settings",
    );
    const settingsPanel = requireElement(
      root.querySelector<HTMLElement>("[data-inspector-settings]"),
      "Settings panel was not rendered",
    );
    expect(settingsPanel.getAttribute("data-state")).toBe("disabled");
    expect(settingsPanel.querySelector("h1")?.textContent?.trim()).toBe(
      "Settings",
    );
    const privacy = requireElement(
      settingsPanel.querySelector<HTMLElement>(
        'section[aria-labelledby="inspector-settings-privacy-title"]',
      ),
      "Privacy settings were not rendered",
    );
    expect(privacy.textContent).toContain("Analytics off");
    expect(
      privacy.querySelectorAll(
        'ul[aria-label="Content CopilotKit never collects"] li',
      ),
    ).toHaveLength(4);
    const policy = requireElement(
      privacy.querySelector<HTMLAnchorElement>(
        ".inspector-settings-policy-link",
      ),
      "Telemetry policy link was not rendered",
    );
    expect(policy.target).toBe("_blank");
    expect(policy.rel).toContain("noreferrer");
    expectCurrentNavigation(root, "workbench", "memories");
    expect(window.localStorage.getItem("cpk:inspector:state")).not.toContain(
      '"settings"',
    );
    await context.toggleSettings();
    expect(root.querySelector("#cpk-main-scroll")?.textContent).toContain(
      "Learning",
    );
  } finally {
    context.teardown();
  }
});

test("labelled sidebar exposes keyboard focus without positive tabindex", async () => {
  const context = await setup({ frontendTools: true, catalog: true });
  try {
    await context.open();
    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const navigation = requireElement(
      root.querySelector<HTMLElement>('nav[aria-label="Inspector"]'),
      "Inspector sidebar was not rendered",
    );
    const home = requireElement(
      navigation.querySelector<HTMLButtonElement>(
        'button[data-inspector-menu-key="home"]',
      ),
      "Home was not rendered",
    );
    const threads = requireElement(
      navigation.querySelector<HTMLButtonElement>(
        'button[data-inspector-menu-key="threads"]',
      ),
      "Threads was not rendered",
    );
    const cta = requireElement(
      root.querySelector<HTMLAnchorElement>("a[data-inspector-thread-cta]"),
      "Sidebar CTA was not rendered as a link",
    );

    expect(home.getAttribute("aria-current")).toBe("page");
    expect(cta.href).toMatch(
      /^https:\/\/www\.copilotkit\.ai\/talk-to-an-engineer/,
    );
    expect(
      Array.from(root.querySelectorAll<HTMLElement>("[tabindex]")).every(
        (element) => element.tabIndex <= 0,
      ),
    ).toBe(true);
    for (const control of [home, threads, cta]) {
      expectVisibleFocus(root, control);
    }
    threads.click();
    await context.inspector.updateComplete;
    expectCurrentNavigation(root, "workbench", "threads");
  } finally {
    context.teardown();
  }
});

test("docked sidebar automatically uses an icon rail and keeps accessible names", async () => {
  const context = await setup({
    agentIds: ["support"],
    persistedState: JSON.stringify({
      dockMode: "docked-left",
      sidebarCollapsed: false,
      hasOpenedInspector: true,
      selectedMenu: "home",
    }),
  });
  try {
    await context.open();
    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const sidebar = requireElement(
      root.querySelector<HTMLElement>(".inspector-sidebar"),
      "Inspector sidebar was not rendered",
    );
    expect(sidebar.getAttribute("data-icon-rail")).toBe("true");
    expect(root.querySelector("[data-inspector-sidebar-toggle]")).toBeNull();
    const home = requireElement(
      root.querySelector<HTMLButtonElement>(
        'button[data-inspector-menu-key="home"]',
      ),
      "Home was not rendered",
    );
    expect(home.getAttribute("aria-label")).toContain("Home");
    expect(home.dataset.inspectorTooltip).toBe("Home");
    home.dispatchEvent(new Event("focus"));
    await context.inspector.updateComplete;
    expect(
      sidebar.querySelector(".inspector-sidebar-rail-tooltip")?.textContent,
    ).toBe("Home");
    home.dispatchEvent(new Event("blur"));
    await context.inspector.updateComplete;
    expect(sidebar.querySelector(".inspector-sidebar-rail-tooltip")).toBeNull();
    const cta = requireElement(
      root.querySelector<HTMLAnchorElement>("[data-inspector-thread-cta]"),
      "Header CTA was not rendered",
    );
    expect(cta.getAttribute("aria-label")).toContain("Talk to an Engineer");
    expect(cta.closest("[data-inspector-account-strip]")).not.toBeNull();
    const scope = requireElement(
      sidebar.querySelector<HTMLElement>(
        "[data-inspector-sidebar-agent-selector]",
      ),
      "Agent scope was not rendered in the icon rail",
    );
    expect(scope.querySelector(".inspector-agent-selector")).not.toBeNull();
    const scopeRoot = requireElement(
      scope.querySelector<HTMLElement>('[data-context-dropdown-root="true"]'),
      "Agent scope dropdown root was not rendered in the icon rail",
    );
    const scopeTrigger = requireElement(
      scopeRoot.querySelector<HTMLButtonElement>("button"),
      "Agent scope trigger was not rendered in the icon rail",
    );
    scopeRoot.dispatchEvent(
      Object.assign(new Event("pointerenter"), { pointerType: "mouse" }),
    );
    await context.inspector.updateComplete;
    const visibleOption = () =>
      scope.querySelector(
        '.inspector-icon-rail-menu[data-open="true"] button[data-context-dropdown-root="true"]',
      );
    expect(visibleOption()).not.toBeNull();
    scopeTrigger.dispatchEvent(
      Object.assign(
        new Event("pointerdown", { bubbles: true, cancelable: true }),
        {
          pointerType: "mouse",
        },
      ),
    );
    await context.inspector.updateComplete;
    expect(visibleOption()).not.toBeNull();
    scopeRoot.dispatchEvent(new Event("pointerleave"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await context.inspector.updateComplete;
    expect(visibleOption()).toBeNull();
    expect(sidebar.querySelector(".inspector-sidebar-footer")).toBeNull();
  } finally {
    context.teardown();
  }
});

test("Home leads with an unread update preview that clears after opening What's New", async () => {
  const announcement = {
    timestamp: "2026-08-20T00:00:00.000Z",
    previewText: "Channels, Angular, and more are now available.",
    announcement: `## Channels
Try Channels in the new demo.

## Angular
Angular docs are live.

## Release notes
Read what shipped.
`,
  };
  const withNews = await setup({
    persistedState: JSON.stringify({
      selectedMenu: "threads",
      hasOpenedInspector: true,
    }),
    announcement,
  });
  try {
    await withNews.open();
    const root = requireElement(
      withNews.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    await waitFor(
      () =>
        root
          .querySelector('button[data-inspector-menu-key="whats-new"]')
          ?.getAttribute("aria-label")
          ?.includes("new content") === true,
      "What's New unread badge",
    );
    await withNews.selectLeaf("home");
    await waitFor(
      () => root.querySelector("[data-inspector-home-band='news']") !== null,
      "Home news band",
    );
    const preview = requireElement(
      root.querySelector<HTMLElement>("[data-inspector-home-band='news']"),
      "What's New preview was not rendered",
    );
    const home = requireElement(
      root.querySelector<HTMLElement>("[data-inspector-home]"),
      "Home was not rendered",
    );
    expect(home.firstElementChild).toBe(preview);
    expect(
      Array.from(home.querySelectorAll("h1, h2")).some(
        (heading) => heading.textContent?.trim() === "What's New",
      ),
    ).toBe(false);
    expect(preview.textContent).toContain("Channels");
    expect(preview.textContent).toContain(
      "Channels, Angular, and more are now available.",
    );
    expect(preview.textContent).not.toContain("Angular docs are live");
    requireElement(
      preview.querySelector<HTMLButtonElement>(
        "[data-inspector-whats-new-preview]",
      ),
      "What's New preview button was not rendered",
    ).click();
    await waitFor(
      () => root.querySelector("[data-inspector-whats-new]") !== null,
      "What's New page",
    );
    const updates = requireElement(
      root.querySelector<HTMLElement>("[data-inspector-whats-new]"),
      "What's New page was not rendered",
    );
    expectCurrentNavigation(root, "home", "whats-new");
    expect(updates.textContent).toContain("Channels");
    expect(updates.textContent).toContain("Angular");
    expect(updates.textContent).toContain("Release notes");
    expect(
      updates.querySelector(
        ".inspector-whats-new-document .announcement-content",
      ),
    ).not.toBeNull();
    expect(updates.querySelectorAll(".inspector-home-story")).toHaveLength(0);
    expect(
      root
        .querySelector('button[data-inspector-menu-key="whats-new"]')
        ?.getAttribute("aria-label"),
    ).toBe("What's New");
    expect(root.querySelector("[data-inspector-home-band='news']")).toBeNull();
    expectCurrentNavigation(root, "home", "whats-new");
  } finally {
    withNews.teardown();
  }

  const withoutAnnouncement = await setup();
  try {
    await withoutAnnouncement.open();
    const root = requireElement(
      withoutAnnouncement.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    expect(root.querySelector("[data-inspector-home-band='news']")).toBeNull();
    expect(root.textContent).not.toContain("You're all caught up");
  } finally {
    withoutAnnouncement.teardown();
  }
});
