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
        return new Response(null, { status: 404 });
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

/** Return the ordered native controls from the active Agent child navigation. */
function agentChildControls(root: ShadowRoot): HTMLButtonElement[] {
  const navigation = requireElement(
    root.querySelector<HTMLElement>('nav[aria-label="Agent navigation"]'),
    "Agent child navigation was not rendered",
  );
  return Array.from(
    navigation.querySelectorAll<HTMLButtonElement>(
      "button[data-inspector-menu-key]",
    ),
  );
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

/** Require that a group and exact legacy leaf both expose current state. */
function expectCurrentNavigation(
  root: ShadowRoot,
  group: string,
  leaf: string,
): void {
  expect(
    root.querySelector(
      `button[data-inspector-group="${group}"][aria-current="page"]`,
    ),
    `${group} should be the current Inspector group`,
  ).not.toBeNull();
  expect(
    root.querySelector(
      `button[data-inspector-menu-key="${leaf}"][aria-current="page"]`,
    ),
    `${leaf} should be the current legacy leaf`,
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

/** Read a property from the component's rendered shadow-DOM stylesheet. */
function renderedStyleProperty(
  root: ShadowRoot,
  selector: string,
  property: string,
): string | undefined {
  const normalizedSelector = selector.replace(/\s+/g, " ").trim();
  const css = Array.from(root.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
  const parserStyle = document.createElement("style");
  parserStyle.textContent = css;
  document.head.append(parserStyle);
  try {
    const rule = Array.from(parserStyle.sheet?.cssRules ?? [])
      .filter(
        (candidate): candidate is CSSStyleRule =>
          candidate instanceof CSSStyleRule,
      )
      .find(
        (candidate) =>
          candidate.selectorText.replace(/\s+/g, " ").trim() ===
          normalizedSelector,
      );
    return rule?.style.getPropertyValue(property);
  } finally {
    parserStyle.remove();
  }
}

test("first launch lands on What's new and shows grouped navigation without account placeholders", async () => {
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
    const primaryNavigation = requireElement(
      root.querySelector<HTMLElement>(
        'nav[aria-label="Inspector primary navigation"]',
      ),
      "Inspector primary navigation was not rendered",
    );
    const groupControls = Array.from(
      primaryNavigation.querySelectorAll<HTMLButtonElement>(
        "button[data-inspector-group]",
      ),
    );

    expect(groupControls.map((control) => control.textContent?.trim())).toEqual(
      ["What's new", "Threads", "Agents", "Learning"],
    );
    expect(groupControls[0]?.getAttribute("aria-current")).toBe("page");
    expect(
      groupControls
        .slice(1)
        .every((control) => !control.hasAttribute("aria-current")),
    ).toBe(true);
    // The Threads CTA belongs to the Threads group, which is no longer where a
    // fresh developer lands.
    expect(
      primaryNavigation.querySelector("[data-inspector-thread-cta]"),
    ).toBeNull();
    await context.selectGroup("threads");
    expect(
      requireElement(
        primaryNavigation.querySelector<HTMLAnchorElement>(
          "[data-inspector-thread-cta]",
        ),
        "Threads engineer CTA was not rendered",
      ).textContent?.trim(),
    ).toBe("Talk to an Engineer");
    expect(
      accountStrip.querySelector('[data-inspector-metadata="identity"]'),
    ).toBeNull();
    expect(
      accountStrip.querySelector('[data-inspector-metadata="plan"]'),
    ).toBeNull();
    expect(accountStrip.textContent).not.toContain("Free");
  } finally {
    context.teardown();
  }
});

test("trusted identity and plan render in the dark account strip with all window controls", async () => {
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
      accountStrip.querySelector<HTMLElement>(
        '[data-inspector-metadata="identity"]',
      ),
      "Trusted account identity was not rendered",
    );
    const plan = requireElement(
      accountStrip.querySelector<HTMLElement>(
        '[data-inspector-metadata="plan"]',
      ),
      "Trusted account plan was not rendered",
    );
    const accountDetails = requireElement(
      accountStrip.querySelector<HTMLElement>(
        '[aria-label="Inspector account details"]',
      ),
      "Labelled account details were not rendered",
    );
    const threadsUsage = requireElement(
      root.querySelector<HTMLElement>('[aria-label="Threads usage"]'),
      "Labelled Threads usage was not rendered",
    );
    const connectedStatus = requireElement(
      root.querySelector<HTMLElement>(
        '[title="Live runtime connection established."] .font-medium',
      ),
      "Connected status label was not rendered",
    );

    expect(getComputedStyle(accountStrip).backgroundColor).toBe("rgb(1, 5, 7)");
    expect(accountDetails.getAttribute("role")).toBe("group");
    expect(threadsUsage.getAttribute("role")).toBe("group");
    expect(connectedStatus.textContent?.trim()).toBe("Connected");
    expect(
      renderedStyleProperty(
        root,
        'div[class*="bg-emerald-50"][class*="border-emerald-200"]',
        "color",
      ),
    ).toBe("rgb(8, 118, 83)");
    expect(
      renderedStyleProperty(
        root,
        'div[class*="bg-emerald-50"][class*="border-emerald-200"] span[class*="opacity-80"]',
        "opacity",
      ),
    ).toBe("1");
    expect(
      renderedStyleProperty(root, ".announcement-content a", "color"),
    ).toBe("rgb(85, 88, 178)");
    expect(identity.textContent).toContain("Acme Inc.");
    expect(identity.textContent).toContain("Support");
    expect(plan.textContent?.trim()).toBe("Enterprise");
    expect(
      accountStrip.querySelector<HTMLImageElement>('img[alt="Inspector logo"]'),
    ).not.toBeNull();
    expect(accountStrip.textContent).toContain("No agents available");
    for (const label of ["Dock to left", "Settings", "Close Web Inspector"]) {
      const control = requireElement(
        accountStrip.querySelector<HTMLButtonElement>(
          `button[aria-label="${label}"]`,
        ),
        `${label} should stay in the account strip`,
      );
      expectVisibleFocus(root, control);
      expect(getComputedStyle(control).cursor).toBe("pointer");
    }
  } finally {
    context.teardown();
  }
});

test("Agents shows all five legacy children in order with frontend tools and a catalog", async () => {
  const context = await setup({ frontendTools: true, catalog: true });
  try {
    await context.open();
    await context.selectGroup("agents");

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const controls = agentChildControls(root);

    expect(controls.map((control) => control.textContent?.trim())).toEqual([
      "AG-UI Events",
      "Agent",
      "Frontend Tools",
      "Capabilities",
      "Context",
    ]);
    expect(controls.map((control) => control.dataset.inspectorMenuKey)).toEqual(
      [
        "ag-ui-events",
        "agents",
        "frontend-tools",
        "capabilities",
        "agent-context",
      ],
    );
    expect(controls[0]?.getAttribute("aria-current")).toBe("page");
    expect(
      controls
        .slice(1)
        .every((control) => !control.hasAttribute("aria-current")),
    ).toBe(true);
    expect(root.querySelector("[data-inspector-thread-cta]")).toBeNull();
  } finally {
    context.teardown();
  }
});

test("Agent children hide only the leaves that depend on missing optional sources", async () => {
  const scenarios: Array<{
    options: SetupOptions;
    labels: string[];
  }> = [
    {
      options: { catalog: true },
      labels: ["AG-UI Events", "Agent", "Capabilities", "Context"],
    },
    {
      options: { frontendTools: true },
      labels: [
        "AG-UI Events",
        "Agent",
        "Frontend Tools",
        "Capabilities",
        "Context",
      ],
    },
    {
      options: {},
      labels: ["AG-UI Events", "Agent", "Context"],
    },
  ];

  for (const scenario of scenarios) {
    const context = await setup(scenario.options);
    try {
      await context.open();
      await context.selectGroup("agents");

      const root = requireElement(
        context.inspector.shadowRoot,
        "Web Inspector shadow root was not rendered",
      );
      expect(
        agentChildControls(root).map((control) => control.textContent?.trim()),
      ).toEqual(scenario.labels);
    } finally {
      context.teardown();
    }
  }

  const context = await setup({ frontendTools: true, catalog: true });
  try {
    await context.open();
    await context.selectGroup("agents");
    await context.selectLeaf("frontend-tools");

    context.inspector.core = null;
    await context.inspector.updateComplete;

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    expect(
      agentChildControls(root).map((control) => control.textContent?.trim()),
    ).toEqual(["AG-UI Events", "Agent", "Context"]);
    expectCurrentNavigation(root, "agents", "ag-ui-events");
    expect(storedSelectedMenu()).toBe("ag-ui-events");
  } finally {
    context.teardown();
  }
});

test("persisted legacy leaves restore their exact views while missing, malformed, stale, and invalid state opens What's new", async () => {
  const validLeaves = [
    {
      leaf: "whats-new",
      group: "whats-new",
      marker: "No announcements right now.",
    },
    { leaf: "ag-ui-events", group: "agents", marker: "No events yet" },
    { leaf: "agents", group: "agents", marker: "No agent selected" },
    {
      leaf: "frontend-tools",
      group: "agents",
      marker: "Find support records.",
    },
    {
      leaf: "capabilities",
      group: "agents",
      marker: "Toggle a capability off",
    },
    {
      leaf: "agent-context",
      group: "agents",
      marker: "No context available",
    },
    {
      leaf: "threads",
      group: "threads",
      marker: "Threads are unavailable.",
    },
    { leaf: "memories", group: "learning", marker: "Long-term memory" },
  ];

  for (const expected of validLeaves) {
    const context = await setup({
      frontendTools: true,
      catalog: true,
      persistedState: JSON.stringify({ selectedMenu: expected.leaf }),
    });
    try {
      await context.open();

      const root = requireElement(
        context.inspector.shadowRoot,
        "Web Inspector shadow root was not rendered",
      );
      const main = requireElement(
        root.querySelector<HTMLElement>("#cpk-main-scroll"),
        "Inspector main view was not rendered",
      );
      expectCurrentNavigation(root, expected.group, expected.leaf);
      expect(main.textContent).toContain(expected.marker);
      expect(storedSelectedMenu()).toBe(expected.leaf);
    } finally {
      context.teardown();
    }
  }

  const delayedCore = await setup({
    appendBeforeCore: true,
    frontendTools: true,
    catalog: true,
    persistedState: JSON.stringify({ selectedMenu: "frontend-tools" }),
  });
  try {
    await delayedCore.open();
    expect(delayedCore.selectedMenuBeforeCore).toBe("frontend-tools");
    const root = requireElement(
      delayedCore.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    expectCurrentNavigation(root, "agents", "frontend-tools");
    expect(root.querySelector("#cpk-main-scroll")?.textContent).toContain(
      "Find support records.",
    );
    expect(storedSelectedMenu()).toBe("frontend-tools");
  } finally {
    delayedCore.teardown();
  }

  const fallbacks: SetupOptions[] = [
    { frontendTools: true, catalog: true },
    { frontendTools: true, catalog: true, persistedState: "{" },
    {
      persistedState: JSON.stringify({ selectedMenu: "frontend-tools" }),
    },
    {
      frontendTools: true,
      catalog: true,
      persistedState: JSON.stringify({ selectedMenu: "settings" }),
    },
  ];

  for (const options of fallbacks) {
    const context = await setup(options);
    try {
      await context.open();

      const root = requireElement(
        context.inspector.shadowRoot,
        "Web Inspector shadow root was not rendered",
      );
      expectCurrentNavigation(root, "whats-new", "whats-new");
      expect(storedSelectedMenu()).toBe("whats-new");
    } finally {
      context.teardown();
    }
  }
});

test("groups remember their last child and Settings returns to the exact unpersisted leaf", async () => {
  const context = await setup({ frontendTools: true, catalog: true });
  try {
    await context.open();
    await context.selectGroup("agents");
    await context.selectLeaf("frontend-tools");
    await context.selectGroup("learning");
    await context.selectGroup("agents");

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    expectCurrentNavigation(root, "agents", "frontend-tools");
    expect(storedSelectedMenu()).toBe("frontend-tools");

    await context.toggleSettings();

    expect(
      root
        .querySelector<HTMLButtonElement>('button[aria-label="Settings"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(root.querySelector("#cpk-main-scroll")?.textContent).toContain(
      "Settings",
    );
    expectCurrentNavigation(root, "agents", "frontend-tools");
    expect(storedSelectedMenu()).toBe("frontend-tools");
    expect(window.localStorage.getItem("cpk:inspector:state")).not.toContain(
      '"settings"',
    );

    await context.toggleSettings();

    expectCurrentNavigation(root, "agents", "frontend-tools");
    expect(root.querySelector("#cpk-main-scroll")?.textContent).toContain(
      "Find support records.",
    );

    await context.selectGroup("threads");
    await context.toggleSettings();
    await context.toggleSettings();

    expectCurrentNavigation(root, "threads", "threads");
    await context.selectGroup("agents");
    expectCurrentNavigation(root, "agents", "frontend-tools");
  } finally {
    context.teardown();
  }
});

test("labelled native navigation exposes keyboard focus and current state without positive tabindex", async () => {
  const context = await setup({ frontendTools: true, catalog: true });
  try {
    await context.open();
    // The Threads CTA is a Threads-group affordance, and a fresh developer now
    // lands on What's new.
    await context.selectGroup("threads");

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const primaryNavigation = requireElement(
      root.querySelector<HTMLElement>(
        'nav[aria-label="Inspector primary navigation"]',
      ),
      "Inspector primary navigation was not rendered",
    );
    const groups = Array.from(
      primaryNavigation.querySelectorAll<HTMLButtonElement>(
        "button[data-inspector-group]",
      ),
    );
    const threads = requireElement(
      primaryNavigation.querySelector<HTMLButtonElement>(
        'button[data-inspector-group="threads"]',
      ),
      "Threads group was not rendered",
    );
    const agents = requireElement(
      primaryNavigation.querySelector<HTMLButtonElement>(
        'button[data-inspector-group="agents"]',
      ),
      "Agents group was not rendered",
    );
    const cta = requireElement(
      primaryNavigation.querySelector<HTMLAnchorElement>(
        "a[data-inspector-thread-cta]",
      ),
      "Threads CTA was not rendered as a link",
    );
    const settings = requireElement(
      root.querySelector<HTMLButtonElement>('button[aria-label="Settings"]'),
      "Settings was not rendered",
    );
    const dock = requireElement(
      root.querySelector<HTMLButtonElement>(
        'button[aria-label="Dock to left"]',
      ),
      "Dock control was not rendered",
    );

    expect(groups).toHaveLength(4);
    expect(
      groups.every((control) => control instanceof HTMLButtonElement),
    ).toBe(true);
    expect(groups.every((control) => control.type === "button")).toBe(true);
    expect(getComputedStyle(primaryNavigation).cursor).toBe("default");
    expect(threads.getAttribute("aria-current")).toBe("page");
    expect(agents.hasAttribute("aria-current")).toBe(false);
    expect(cta).toBeInstanceOf(HTMLAnchorElement);
    expect(cta.href).toMatch(
      /^https:\/\/www\.copilotkit\.ai\/talk-to-an-engineer/,
    );
    expect(
      Array.from(root.querySelectorAll<HTMLElement>("[tabindex]")).every(
        (element) => element.tabIndex <= 0,
      ),
    ).toBe(true);

    for (const key of ["Enter", " "]) {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      expect(agents.dispatchEvent(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    }
    for (const control of [threads, agents, cta]) {
      expectVisibleFocus(root, control);
      expect(getComputedStyle(control).cursor).toBe("pointer");
    }
    for (const control of [settings, dock]) {
      expectVisibleFocus(root, control);
    }

    agents.click();
    await context.inspector.updateComplete;
    expectCurrentNavigation(root, "agents", "ag-ui-events");

    const childNavigation = requireElement(
      root.querySelector<HTMLElement>('nav[aria-label="Agent navigation"]'),
      "Agent child navigation was not rendered",
    );
    expect(childNavigation.getAttribute("aria-label")).not.toBe(
      primaryNavigation.getAttribute("aria-label"),
    );
    expect(getComputedStyle(childNavigation).cursor).toBe("default");
    const children = agentChildControls(root);
    expect(
      children.every((control) => control instanceof HTMLButtonElement),
    ).toBe(true);
    expect(children[0]?.getAttribute("aria-current")).toBe("page");
    expect(
      children
        .slice(1)
        .every((control) => !control.hasAttribute("aria-current")),
    ).toBe(true);
    expectVisibleFocus(root, children[0]!);
    expect(
      children.every(
        (control) => getComputedStyle(control).cursor === "pointer",
      ),
    ).toBe(true);

    for (const navigation of [primaryNavigation, childNavigation]) {
      const event = new PointerEvent("pointerdown", {
        pointerId: 8,
        bubbles: true,
        cancelable: true,
      });
      expect(navigation.dispatchEvent(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    }
  } finally {
    context.teardown();
  }
});

test("minimum-width Agent navigation scrolls horizontally and keeps the active child reachable", async () => {
  const widthDescriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
  const scrollDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView",
  );
  const scrollIntoView = vi.fn();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 840,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });

  let context: InspectorNavigationContext | undefined;
  try {
    context = await setup({ frontendTools: true, catalog: true });
    await context.open();
    await context.selectGroup("agents");
    await context.selectLeaf("agent-context");
    await context.inspector.updateComplete;
    await Promise.resolve();

    scrollIntoView.mockClear();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 640,
    });
    window.dispatchEvent(new Event("resize"));
    await context.inspector.updateComplete;
    await Promise.resolve();

    const root = requireElement(
      context.inspector.shadowRoot,
      "Web Inspector shadow root was not rendered",
    );
    const navigation = requireElement(
      root.querySelector<HTMLElement>('nav[aria-label="Agent navigation"]'),
      "Agent child navigation was not rendered",
    );
    const active = requireElement(
      navigation.querySelector<HTMLButtonElement>(
        'button[data-inspector-menu-key="agent-context"][aria-current="page"]',
      ),
      "The active Context child was not rendered",
    );
    const inspectorWindow = requireElement(
      root.querySelector<HTMLElement>(".inspector-window"),
      "Inspector window was not rendered",
    );

    expect(window.innerWidth).toBe(640);
    expect(getComputedStyle(navigation).overflowX).toBe("auto");
    expect(getComputedStyle(navigation).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(inspectorWindow).overflowX).toBe("hidden");
    expect(inspectorWindow.style.width).toBe("608px");
    expect(active.textContent?.trim()).toBe("Context");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
  } finally {
    context?.teardown();
    if (widthDescriptor) {
      Object.defineProperty(window, "innerWidth", widthDescriptor);
    } else {
      Reflect.deleteProperty(window, "innerWidth");
    }
    if (scrollDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        scrollDescriptor,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  }
});
