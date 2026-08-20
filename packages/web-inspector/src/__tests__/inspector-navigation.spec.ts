import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type { InspectorMetadataV1 } from "@copilotkit/core";
import { expect, test, vi } from "vitest";

import { WebInspectorElement } from "../index.js";

type InspectorNavigationContext = {
  inspector: WebInspectorElement;
  selectedMenuBeforeCore?: unknown;
  open: () => Promise<void>;
  selectGroup: (key: string) => Promise<void>;
  selectLeaf: (key: string) => Promise<void>;
  toggleSettings: () => Promise<void>;
  teardown: () => void;
};

type SetupOptions = {
  appendBeforeCore?: boolean;
  catalog?: boolean;
  frontendTools?: boolean;
  metadata?: InspectorMetadataV1;
  persistedState?: string;
  announcement?: { timestamp: string; announcement: string };
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
          previewText: "New from CopilotKit",
          announcement: options.announcement.announcement,
        });
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
          inspectorMetadata: options.metadata !== undefined,
          licenseStatus: options.metadata ? "valid" : "unknown",
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
      'button[aria-label="Web Inspector"]',
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
    inspector,
    selectedMenuBeforeCore,
    open: async () => {
      if (inspector.shadowRoot?.querySelector(".inspector-window")) {
        return;
      }
      const opener = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
        'button[aria-label="Web Inspector"]',
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

test("first launch opens Home with a live sidebar, footer CTA, and no account placeholders", async () => {
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
    expect(home.querySelector(".inspector-home-hero")).not.toBeNull();
    expect(home.querySelector("[data-inspector-home-connected]")).toBeNull();
    expect(sidebarLeaves(root)).toEqual([
      "home",
      "threads",
      "memories",
      "agents",
      "ag-ui-events",
      "agent-context",
    ]);
    expect(navigation.textContent).toContain("Workbench");
    expect(navigation.textContent).toContain("Inspect");
    expect(navigation.textContent).not.toContain("Learning");
    expectCurrentNavigation(root, "home", "home");
    expect(
      requireElement(
        root.querySelector<HTMLAnchorElement>("[data-inspector-thread-cta]"),
        "Sidebar engineer CTA was not rendered",
      ).textContent,
    ).toContain("Talk to an Engineer");
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

test("trusted identity and plan render on Home, not in the dark header", async () => {
  const context = await setup({ metadata: trustedMetadata() });
  try {
    await context.open();
    // The Threads usage footer lives on the Threads tab, which is no longer
    // where a fresh developer lands.
    await context.selectGroup("threads");

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
        '[title="Live runtime connection established."] .font-medium',
      ),
      "Connected status label was not rendered",
    );

    expect(identity.closest("[data-inspector-account-strip]")).toBeNull();
    expect(getComputedStyle(accountStrip).backgroundColor).toBe("rgb(1, 5, 7)");
    expect(connectedStatus.textContent?.trim()).toBe("Connected");
    expect(identity.textContent).toContain("Acme Inc.");
    expect(identity.textContent).toContain("Support");
    expect(plan.textContent?.trim()).toBe("Enterprise");
    const home = requireElement(
      root.querySelector<HTMLElement>("[data-inspector-home]"),
      "Home briefing was not rendered",
    );
    expect(home.querySelector(".inspector-home-hero")).toBeNull();
    const headingRow = requireElement(
      home.querySelector<HTMLElement>(".inspector-home-section-head"),
      "Home heading row was not rendered",
    );
    const sectionTitle = requireElement(
      headingRow.querySelector<HTMLElement>(".inspector-home-section-title"),
      "What's going on heading was not rendered",
    );
    const connectedChip = requireElement(
      headingRow.querySelector<HTMLElement>("[data-inspector-home-connected]"),
      "Connected chip was not rendered next to What's going on",
    );
    expect(sectionTitle.textContent?.trim()).toBe("What's going on");
    expect(connectedChip.textContent).toContain("Intelligence connected");
    expect(
      sectionTitle.compareDocumentPosition(connectedChip) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      root
        .querySelector<HTMLAnchorElement>("[data-inspector-home-cta]")
        ?.textContent?.trim(),
    ).toBe("MANAGE PLAN");
    expect(
      accountStrip.querySelector<HTMLImageElement>('img[alt="CopilotKit"]'),
    ).not.toBeNull();
    for (const label of ["Dock to left", "Settings", "Close Web Inspector"]) {
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
      leaf: "threads",
      group: "workbench",
      marker: "Threads are unavailable.",
    },
    { leaf: "memories", group: "workbench", marker: "Long-term memory" },
    { leaf: "home", group: "home", marker: "What's going on" },
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

test("Workbench remembers Memory, and Settings does not persist a settings leaf", async () => {
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
    expectCurrentNavigation(root, "workbench", "memories");
    expect(window.localStorage.getItem("cpk:inspector:state")).not.toContain(
      '"settings"',
    );
    await context.toggleSettings();
    expect(root.querySelector("#cpk-main-scroll")?.textContent).toContain(
      "Long-term memory",
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

test("collapsed sidebar uses an icon rail and keeps accessible names", async () => {
  const context = await setup({
    persistedState: JSON.stringify({
      dockMode: "docked-left",
      sidebarCollapsed: true,
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
    const home = requireElement(
      root.querySelector<HTMLButtonElement>(
        'button[data-inspector-menu-key="home"]',
      ),
      "Home was not rendered",
    );
    expect(home.getAttribute("aria-label")).toContain("Home");
    const cta = requireElement(
      root.querySelector<HTMLAnchorElement>("[data-inspector-thread-cta]"),
      "Footer CTA was not rendered",
    );
    expect(cta.getAttribute("aria-label")).toContain("Talk to an Engineer");
  } finally {
    context.teardown();
  }
});

test("Home splits announcement markdown and hides news when the document is missing", async () => {
  const withNews = await setup({
    persistedState: JSON.stringify({
      selectedMenu: "threads",
      hasOpenedInspector: true,
    }),
    announcement: {
      timestamp: "2026-08-20T00:00:00.000Z",
      announcement: `## Channels
Try Channels in the new demo.

## Angular
Angular docs are live.

## Release notes
Read what shipped.
`,
    },
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
          .querySelector('button[data-inspector-menu-key="home"]')
          ?.getAttribute("aria-label")
          ?.includes("new announcement") === true,
      "Home unread badge",
    );
    await withNews.selectLeaf("home");
    await waitFor(
      () => root.querySelector("[data-inspector-home-band='news']") !== null,
      "Home news band",
    );
    const news = requireElement(
      root.querySelector<HTMLElement>("[data-inspector-home-band='news']"),
      "From CopilotKit was not rendered",
    );
    expect(news.textContent).toContain("Channels");
    expect(news.textContent).toContain("Angular");
    expect(news.textContent).toContain("Release notes");
  } finally {
    withNews.teardown();
  }

  const hidden = await setup();
  try {
    await hidden.open();
    const root = requireElement(
      hidden.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    expect(root.querySelector("[data-inspector-home-band='news']")).toBeNull();
  } finally {
    hidden.teardown();
  }
});
