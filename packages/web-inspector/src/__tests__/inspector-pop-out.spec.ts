import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";

import { WebInspectorElement } from "../index.js";
import {
  INSPECTOR_POP_OUT_NAME,
  POP_OUT_BLOCKED_MESSAGE,
} from "../lib/pop-out.js";

type PopOutWindowStub = {
  document: Document;
  closed: boolean;
  customElements: CustomElementRegistry;
  navigator: {
    clipboard: {
      writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
    };
  };
  close: ReturnType<typeof vi.fn>;
  addEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => void;
  removeEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => void;
};

type OpenWindow = (
  url?: string | URL,
  target?: string,
  features?: string,
) => Window | null;

type InspectorPopOutContext = {
  inspector: WebInspectorElement;
  core: CopilotKitCore;
  popDoc: Document;
  fakeWindow: PopOutWindowStub;
  windowOpen: ReturnType<typeof vi.fn<OpenWindow>>;
  open: () => Promise<void>;
  selectGroup: (key: string) => Promise<void>;
  selectLeaf: (key: string) => Promise<void>;
  clickDetach: () => Promise<void>;
  firePageHide: () => void;
  firePopOutPointerDown: (path?: EventTarget[]) => void;
  teardown: () => void;
};

type SetupOptions = {
  persistedState?: string;
  blockPopOut?: boolean;
};

const DETACH_LABEL = "Detach Inspector into its own window";
const DETACH_TEST_ID = "cpk-inspector-pop-out";
const WINDOW_LAYOUT_LABEL = "Window layout";
const INSPECTOR_STATE_KEY = "cpk:inspector:state";
const POP_OUT_REOPEN_KEYS = [
  "isPoppedOut",
  "poppedOut",
  "popOut",
  "popped",
  "isPopped",
] as const;

/** jsdom cannot open a real popup. Body must stay a real HTMLElement for Lit. */
function installPopOutStub(blockPopOut = false): {
  open: ReturnType<typeof vi.fn<OpenWindow>>;
  fakeWindow: PopOutWindowStub;
  popDoc: Document;
  firePageHide: () => void;
  firePointerDown: (path?: EventTarget[]) => void;
} {
  const popDoc = document.implementation.createHTMLDocument("pop-out");
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  const emit = (type: string, event?: Event): void => {
    const set = listeners.get(type);
    if (!set) {
      return;
    }
    const emitted = event ?? new Event(type);
    for (const listener of set) {
      if (typeof listener === "function") {
        listener(emitted);
      } else {
        listener.handleEvent(emitted);
      }
    }
  };

  const fakeWindow: PopOutWindowStub = {
    document: popDoc,
    closed: false,
    customElements,
    navigator: {
      clipboard: {
        writeText: vi.fn(async () => undefined),
      },
    },
    close: vi.fn(function close(this: PopOutWindowStub) {
      this.closed = true;
      emit("pagehide");
    }),
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      listeners.get(type)?.delete(listener);
    },
  };

  const open = vi.fn<OpenWindow>((_url, _target, _features) =>
    blockPopOut ? null : (fakeWindow as unknown as Window),
  );
  vi.stubGlobal("open", open);

  return {
    open,
    fakeWindow,
    popDoc,
    firePageHide: () => {
      fakeWindow.closed = true;
      emit("pagehide");
    },
    firePointerDown: (path = []) => {
      const event = new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
      });
      if (path.length > 0) {
        Object.defineProperty(event, "composedPath", {
          configurable: true,
          value: () => path,
        });
      }
      emit("pointerdown", event);
    },
  };
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

/** Return a JSON response with a matching content type. */
function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
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

function requireShadow(inspector: WebInspectorElement): ShadowRoot {
  return requireElement(
    inspector.shadowRoot,
    "Web Inspector shadow root was not rendered",
  );
}

async function openWindowLayoutMenu(
  inspector: WebInspectorElement,
): Promise<ShadowRoot> {
  let root = requireShadow(inspector);
  if (root.querySelector('[role="menu"][aria-label="Window layout"]')) {
    return root;
  }
  const trigger = requireElement(
    root.querySelector<HTMLButtonElement>(
      `button[aria-label="${WINDOW_LAYOUT_LABEL}"]`,
    ),
    "Window layout control was not rendered",
  );
  trigger.click();
  await inspector.updateComplete;
  root = requireShadow(inspector);
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  return root;
}

async function requireWindowLayoutAction(
  inspector: WebInspectorElement,
  label: string,
): Promise<HTMLButtonElement> {
  const root = await openWindowLayoutMenu(inspector);
  return requireElement(
    root.querySelector<HTMLButtonElement>(
      `[role="menuitem"][aria-label="${label}"]`,
    ),
    `Window layout action was not rendered: ${label}`,
  );
}

async function requireDetach(
  inspector: WebInspectorElement,
): Promise<HTMLButtonElement> {
  const root = await openWindowLayoutMenu(inspector);
  const control =
    root.querySelector<HTMLButtonElement>(
      `button[aria-label="${DETACH_LABEL}"]`,
    ) ??
    root.querySelector<HTMLButtonElement>(`[data-testid="${DETACH_TEST_ID}"]`);
  if (!control) {
    throw new Error("Detach Inspector control was not rendered");
  }
  expect(control.getAttribute("aria-label")).toBe(DETACH_LABEL);
  expect(control.getAttribute("data-testid")).toBe(DETACH_TEST_ID);
  return control;
}

function storedInspectorState(): Record<string, unknown> {
  const serialized = window.localStorage.getItem(INSPECTOR_STATE_KEY);
  if (serialized === null) {
    throw new Error("Inspector state was not persisted");
  }
  const state: unknown = JSON.parse(serialized);
  if (typeof state !== "object" || state === null) {
    throw new Error("Inspector state was not an object");
  }
  return state as Record<string, unknown>;
}

function readWindowSize(inspectorWindow: HTMLElement): {
  width: number;
  height: number;
} {
  const width = Math.round(Number.parseFloat(inspectorWindow.style.width));
  const height = Math.round(Number.parseFloat(inspectorWindow.style.height));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(
      `Inspector window size was not readable from style (${inspectorWindow.style.width}, ${inspectorWindow.style.height})`,
    );
  }
  return { width, height };
}

function dockMarginPx(): number {
  return Number.parseFloat(document.body.style.marginLeft || "0") || 0;
}

function queryControl(
  root: ParentNode,
  selector: string,
): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(selector);
}

function createMockAgent(agentId: string): {
  agent: AbstractAgent;
  emit: (key: keyof AgentSubscriber, payload: unknown) => void;
  subscriberCount: () => number;
} {
  const subscribers = new Set<AgentSubscriber>();
  const agentObj = {
    agentId,
    subscribe(subscriber: AgentSubscriber) {
      subscribers.add(subscriber);
      return {
        unsubscribe: () => subscribers.delete(subscriber),
      };
    },
  };

  return {
    agent: agentObj as unknown as AbstractAgent,
    emit: (key, payload) => {
      for (const subscriber of subscribers) {
        const handler = subscriber[key];
        if (handler) {
          (handler as (arg: unknown) => void)(payload);
        }
      }
    },
    subscriberCount: () => subscribers.size,
  };
}

function dispatchEscape(...targets: EventTarget[]): void {
  for (const target of targets) {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  }
}

/** Mount an inspector around a real core and expose public user interactions. */
async function setup(
  options: SetupOptions = {},
): Promise<InspectorPopOutContext> {
  document.body.replaceChildren();
  document.body.style.marginLeft = "";
  document.body.style.marginBottom = "";
  document.body.style.transition = "";
  window.localStorage.clear();
  if (options.persistedState !== undefined) {
    window.localStorage.setItem(INSPECTOR_STATE_KEY, options.persistedState);
  }

  const stub = installPopOutStub(options.blockPopOut === true);

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
          inspectorMetadata: false,
          licenseStatus: "unknown",
          telemetryDisabled: true,
        });
      }
      if (url.endsWith("/inspector-metadata")) {
        return new Response(null, { status: 204 });
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
  });
  const inspector = new WebInspectorElement();
  inspector.core = core;
  document.body.appendChild(inspector);
  core.connect();

  await waitFor(
    () =>
      core.runtimeConnectionStatus ===
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    "the Core handshake",
  );
  await inspector.updateComplete;

  const clickInShadow = async (
    selector: string,
    message: string,
  ): Promise<void> => {
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
    core,
    popDoc: stub.popDoc,
    fakeWindow: stub.fakeWindow,
    windowOpen: stub.open,
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
      clickInShadow(
        `button[data-inspector-group="${key}"]`,
        `Inspector group was not rendered: ${key}`,
      ),
    selectLeaf: (key) =>
      clickInShadow(
        `button[data-inspector-menu-key="${key}"]`,
        `Inspector leaf was not rendered: ${key}`,
      ),
    clickDetach: async () => {
      (await requireDetach(inspector)).click();
      await inspector.updateComplete;
    },
    firePageHide: stub.firePageHide,
    firePopOutPointerDown: stub.firePointerDown,
    teardown: () => {
      inspector.remove();
      core.setRuntimeUrl(undefined);
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      window.localStorage.clear();
      document.body.style.marginLeft = "";
      document.body.style.marginBottom = "";
      document.body.style.transition = "";
      document.body.replaceChildren();
      document.getElementById("cpk-inspector-brand-fonts")?.remove();
    },
  };
}

describe("Inspector pop-out", () => {
  it("calls open with a blank URL, the pop-out name, and the current size", async () => {
    const context = await setup();
    try {
      await context.open();

      const inspectorWindow = requireElement(
        requireShadow(context.inspector).querySelector<HTMLElement>(
          ".inspector-window",
        ),
        "Inspector window was not rendered",
      );
      const { width, height } = readWindowSize(inspectorWindow);

      await context.clickDetach();

      expect(context.windowOpen).toHaveBeenCalledTimes(1);
      expect(context.windowOpen).toHaveBeenCalledWith(
        "",
        INSPECTOR_POP_OUT_NAME,
        expect.any(String),
      );
      const features = String(context.windowOpen.mock.calls[0]?.[2] ?? "");
      expect(features).toContain("popup");
      expect(features).toContain(`width=${width}`);
      expect(features).toContain(`height=${height}`);
    } finally {
      context.teardown();
    }
  });

  it("hides the in-page inspector window and opener after a successful pop-out", async () => {
    const context = await setup();
    try {
      await context.open();
      await context.clickDetach();

      await waitFor(() => {
        const root = context.inspector.shadowRoot;
        return (
          root?.querySelector(".inspector-window") === null &&
          root?.querySelector('button[aria-label="Web Inspector"]') === null
        );
      }, "in-page Inspector chrome to hide");

      const root = requireShadow(context.inspector);
      expect(root.querySelector(".inspector-window")).toBeNull();
      expect(
        root.querySelector('button[aria-label="Web Inspector"]'),
      ).toBeNull();
    } finally {
      context.teardown();
    }
  });

  it("renders the inspector window in the pop-out document", async () => {
    const context = await setup();
    try {
      await context.open();
      await context.clickDetach();

      await waitFor(
        () => context.popDoc.querySelector(".inspector-window") !== null,
        "the Inspector window in the pop-out document",
      );
      expect(context.popDoc.querySelector(".inspector-window")).not.toBeNull();
    } finally {
      context.teardown();
    }
  });

  it("renders the threads list in the pop-out document", async () => {
    const context = await setup();
    try {
      await context.open();
      await context.selectLeaf("threads");
      await context.clickDetach();

      await waitFor(
        () => context.popDoc.querySelector("cpk-thread-list") !== null,
        "the threads list in the pop-out document",
      );
      expect(context.popDoc.querySelector("cpk-thread-list")).not.toBeNull();
    } finally {
      context.teardown();
    }
  });

  it("moves the same Inspector subtree into the pop-out and back", async () => {
    const context = await setup();
    try {
      await context.open();
      await context.selectLeaf("threads");

      const inPageThreadList = requireElement(
        requireShadow(context.inspector).querySelector("cpk-thread-list"),
        "the in-page threads list",
      );
      const portableThreadListStyle = requireElement(
        inPageThreadList.shadowRoot?.querySelector("style"),
        "the portable threads-list stylesheet",
      );
      expect(portableThreadListStyle.textContent).toContain(".cpk-tl");

      await context.clickDetach();
      await waitFor(
        () => context.popDoc.querySelector("cpk-thread-list") !== null,
        "the threads list to move into the pop-out",
      );
      expect(context.popDoc.querySelector("cpk-thread-list")).toBe(
        inPageThreadList,
      );
      expect(inPageThreadList.shadowRoot?.querySelector("style")).toBe(
        portableThreadListStyle,
      );
      expect(portableThreadListStyle.ownerDocument).toBe(context.popDoc);

      context.firePageHide();
      await context.inspector.updateComplete;
      await waitFor(
        () =>
          requireShadow(context.inspector).querySelector("cpk-thread-list") !==
          null,
        "the threads list to return to the app page",
      );
      expect(
        requireShadow(context.inspector).querySelector("cpk-thread-list"),
      ).toBe(inPageThreadList);
      expect(portableThreadListStyle.ownerDocument).toBe(document);
    } finally {
      context.teardown();
    }
  });

  it("hides Close, Detach, and dock controls in the pop-out and keeps Settings", async () => {
    const context = await setup();
    try {
      const mock = createMockAgent("alpha");
      context.core.addAgent__unsafe_dev_only({
        id: "alpha",
        agent: mock.agent,
      });
      await context.inspector.updateComplete;
      await context.open();

      const inPageRoot = requireShadow(context.inspector);
      const inPageSettings = requireElement(
        queryControl(inPageRoot, 'button[aria-label="Settings"]'),
        "the in-page Settings control",
      );
      const inPageAgentSelector = requireElement(
        inPageRoot.querySelector<HTMLButtonElement>(
          '[data-context-dropdown-root="true"] > button',
        ),
        "the in-page agent selector",
      );
      const inPageSettingsMarkup = inPageSettings.outerHTML;
      const inPageAgentSelectorMarkup = inPageAgentSelector.outerHTML;

      await context.clickDetach();

      await waitFor(
        () => context.popDoc.querySelector(".inspector-window") !== null,
        "the Inspector window in the pop-out document",
      );

      expect(
        queryControl(
          context.popDoc,
          'button[aria-label="Close Web Inspector"]',
        ),
      ).toBeNull();
      expect(
        queryControl(context.popDoc, `button[aria-label="${DETACH_LABEL}"]`),
      ).toBeNull();
      expect(
        queryControl(context.popDoc, `[data-testid="${DETACH_TEST_ID}"]`),
      ).toBeNull();
      expect(
        queryControl(
          context.popDoc,
          `button[aria-label="${WINDOW_LAYOUT_LABEL}"]`,
        ),
      ).toBeNull();
      const settings = requireElement(
        queryControl(context.popDoc, 'button[aria-label="Settings"]'),
        "the pop-out Settings control",
      );
      expect(settings.outerHTML).toBe(inPageSettingsMarkup);

      const agentSelector = requireElement(
        context.popDoc.querySelector<HTMLButtonElement>(
          '[data-context-dropdown-root="true"] > button',
        ),
        "the pop-out agent selector",
      );
      expect(agentSelector.outerHTML).toBe(inPageAgentSelectorMarkup);
    } finally {
      context.teardown();
    }
  });

  it("does not open a second pop-out window after Detach is gone", async () => {
    const context = await setup();
    try {
      await context.open();
      await context.clickDetach();

      await waitFor(
        () => context.popDoc.querySelector(".inspector-window") !== null,
        "the Inspector window in the pop-out document",
      );

      expect(
        queryControl(
          requireShadow(context.inspector),
          `button[aria-label="${DETACH_LABEL}"]`,
        ),
      ).toBeNull();
      expect(
        queryControl(context.popDoc, `button[aria-label="${DETACH_LABEL}"]`),
      ).toBeNull();
      expect(
        queryControl(context.popDoc, `[data-testid="${DETACH_TEST_ID}"]`),
      ).toBeNull();
      expect(context.windowOpen).toHaveBeenCalledTimes(1);
    } finally {
      context.teardown();
    }
  });

  it("throws when the popup is blocked and keeps the in-page inspector", async () => {
    const context = await setup({ blockPopOut: true });
    try {
      await context.open();
      const root = requireShadow(context.inspector);
      const detach = await requireDetach(context.inspector);

      expect(() => detach.click()).toThrow(POP_OUT_BLOCKED_MESSAGE);
      await context.inspector.updateComplete;

      expect(root.querySelector(".inspector-window")).not.toBeNull();
      expect(context.windowOpen).toHaveBeenCalledTimes(1);
    } finally {
      context.teardown();
    }
  });

  it("closes the popup and keeps the in-page inspector if pop-out setup throws", async () => {
    const context = await setup();
    try {
      await context.open();
      const root = requireShadow(context.inspector);
      expect(root.querySelector(".inspector-window")).not.toBeNull();

      context.fakeWindow.customElements = {
        get: () => undefined,
        define: () => {
          throw new Error("define failed");
        },
      } as unknown as CustomElementRegistry;

      const detach = await requireDetach(context.inspector);
      expect(() => detach.click()).toThrow("define failed");
      await context.inspector.updateComplete;

      expect(context.fakeWindow.close).toHaveBeenCalled();
      expect(root.querySelector(".inspector-window")).not.toBeNull();
      expect(
        root.querySelector('button[aria-label="Web Inspector"]'),
      ).toBeNull();
      expect(context.popDoc.querySelector(".inspector-window")).toBeNull();
    } finally {
      context.teardown();
    }
  });

  it("keeps the host in the app document and still receives agent events", async () => {
    const context = await setup();
    try {
      await context.open();
      await context.selectLeaf("ag-ui-events");

      const mock = createMockAgent("alpha");
      context.core.addAgent__unsafe_dev_only({
        id: "alpha",
        agent: mock.agent,
      });

      await context.clickDetach();

      expect(document.body.contains(context.inspector)).toBe(true);
      expect(document.body.querySelector("cpk-web-inspector")).toBe(
        context.inspector,
      );

      await waitFor(
        () => context.popDoc.querySelector(".inspector-window") !== null,
        "the Inspector window in the pop-out document",
      );

      // Real Core subscribers read input.runId. Document.textContent is always
      // null, so read the body.
      mock.emit("onRunStartedEvent", {
        event: { id: "run-1" },
        input: { runId: "run-1" },
      });
      await context.inspector.updateComplete;
      await waitFor(
        () => context.popDoc.body.textContent?.includes("RUN_STARTED") === true,
        "the pop-out Inspector to show the new agent event",
      );
    } finally {
      context.teardown();
    }
  });

  it("docks back on pagehide, stays open, and keeps the dock mode", async () => {
    const context = await setup();
    try {
      await context.open();
      expect(
        queryControl(
          requireShadow(context.inspector),
          `button[aria-label="${WINDOW_LAYOUT_LABEL}"]`,
        ),
      ).not.toBeNull();

      await context.clickDetach();
      await waitFor(
        () => context.popDoc.querySelector(".inspector-window") !== null,
        "the Inspector window in the pop-out document",
      );

      context.firePageHide();
      await context.inspector.updateComplete;
      await waitFor(() => {
        const root = context.inspector.shadowRoot;
        return root?.querySelector(".inspector-window") !== null;
      }, "the in-page Inspector window to return");

      const root = requireShadow(context.inspector);
      expect(root.querySelector(".inspector-window")).not.toBeNull();
      expect(
        root.querySelector('button[aria-label="Web Inspector"]'),
      ).toBeNull();
      expect(
        queryControl(root, `button[aria-label="${WINDOW_LAYOUT_LABEL}"]`),
      ).not.toBeNull();
      expect(
        await requireWindowLayoutAction(context.inspector, "Dock to left"),
      ).not.toBeNull();
    } finally {
      context.teardown();
    }
  });

  it("preserves the app margin while a docked Inspector is popped out and restored", async () => {
    const context = await setup({
      persistedState: JSON.stringify({ dockMode: "docked-left" }),
    });
    try {
      document.body.style.marginLeft = "19px";
      await context.open();
      await waitFor(
        () => dockMarginPx() > 19,
        "the dock-left page margin to apply",
      );
      const dockMargin = document.body.style.marginLeft;
      expect(
        await requireWindowLayoutAction(context.inspector, "Float window"),
      ).not.toBeNull();

      await context.clickDetach();
      await waitFor(
        () => context.popDoc.querySelector(".inspector-window") !== null,
        "the Inspector window in the pop-out document",
      );
      expect(document.body.style.marginLeft).toBe("19px");

      context.firePageHide();
      await context.inspector.updateComplete;
      await waitFor(
        () => dockMarginPx() > 19,
        "the dock-left page margin to return",
      );
      expect(document.body.style.marginLeft).toBe(dockMargin);
      const float = await requireWindowLayoutAction(
        context.inspector,
        "Float window",
      );
      float.click();
      await context.inspector.updateComplete;
      expect(document.body.style.marginLeft).toBe("19px");
    } finally {
      context.teardown();
    }
  });

  it("docks back if the pop-out document is already gone", async () => {
    const context = await setup({
      persistedState: JSON.stringify({ dockMode: "docked-left" }),
    });
    try {
      await context.open();
      await waitFor(
        () => dockMarginPx() > 0,
        "the dock-left page margin to apply",
      );
      await context.clickDetach();
      await waitFor(
        () => context.popDoc.querySelector(".inspector-window") !== null,
        "the Inspector window in the pop-out document",
      );

      Object.defineProperty(context.popDoc, "body", {
        configurable: true,
        get() {
          throw new Error("dead pop-out document");
        },
      });

      context.firePageHide();
      await context.inspector.updateComplete;
      await waitFor(() => {
        const root = context.inspector.shadowRoot;
        return root?.querySelector(".inspector-window") !== null;
      }, "the in-page Inspector window to return");

      expect(dockMarginPx()).toBeGreaterThan(0);
    } finally {
      context.teardown();
    }
  });

  it("lets Settings toggle in the pop-out and ignores Escape and close", async () => {
    const context = await setup();
    try {
      await context.open();
      await context.clickDetach();
      await waitFor(
        () => context.popDoc.querySelector(".inspector-window") !== null,
        "the Inspector window in the pop-out document",
      );

      const settings = requireElement(
        queryControl(context.popDoc, 'button[aria-label="Settings"]'),
        "Settings was not rendered in the pop-out",
      );
      settings.click();
      await context.inspector.updateComplete;
      await waitFor(
        () => settings.getAttribute("aria-pressed") === "true",
        "Settings to turn on in the pop-out",
      );
      expect(
        context.popDoc.querySelector("#cpk-main-scroll")?.textContent,
      ).toContain("Privacy");

      settings.click();
      await context.inspector.updateComplete;
      await waitFor(
        () => settings.getAttribute("aria-pressed") !== "true",
        "Settings to turn off in the pop-out",
      );

      settings.click();
      await context.inspector.updateComplete;
      await waitFor(
        () => settings.getAttribute("aria-pressed") === "true",
        "Settings to turn on again in the pop-out",
      );

      const popWindow = requireElement(
        context.popDoc.querySelector<HTMLElement>(".inspector-window"),
        "Inspector window was not rendered in the pop-out",
      );
      dispatchEscape(
        window,
        document,
        context.inspector,
        context.popDoc,
        popWindow,
      );
      queryControl(
        requireShadow(context.inspector),
        'button[aria-label="Close Web Inspector"]',
      )?.click();
      queryControl(
        context.popDoc,
        'button[aria-label="Close Web Inspector"]',
      )?.click();
      await context.inspector.updateComplete;

      expect(context.popDoc.querySelector(".inspector-window")).not.toBeNull();
      expect(
        requireShadow(context.inspector).querySelector(
          'button[aria-label="Web Inspector"]',
        ),
      ).toBeNull();
      expect(storedInspectorState().isOpen).toBe(true);
    } finally {
      context.teardown();
    }
  });

  it("closes the agent menu on a pointerdown in the pop-out window", async () => {
    const context = await setup();
    try {
      await context.open();
      const mock = createMockAgent("alpha");
      context.core.addAgent__unsafe_dev_only({
        id: "alpha",
        agent: mock.agent,
      });
      await context.inspector.updateComplete;

      await context.clickDetach();
      await waitFor(
        () => context.popDoc.querySelector(".inspector-window") !== null,
        "the Inspector window in the pop-out document",
      );

      const toggle = requireElement(
        context.popDoc.querySelector<HTMLButtonElement>(
          '[data-context-dropdown-root="true"] > button',
        ),
        "Agent menu was not rendered in the pop-out",
      );
      toggle.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      await context.inspector.updateComplete;
      await waitFor(
        () =>
          context.popDoc.querySelectorAll(
            '[data-context-dropdown-root="true"] button',
          ).length > 1,
        "the agent menu to open in the pop-out",
      );

      context.firePopOutPointerDown();
      await context.inspector.updateComplete;
      await waitFor(
        () =>
          context.popDoc.querySelectorAll(
            '[data-context-dropdown-root="true"] button',
          ).length === 1,
        "the agent menu to close after a pop-out pointerdown",
      );
    } finally {
      context.teardown();
    }
  });

  it("keeps the agent menu open for a dropdown pointerdown from another realm", async () => {
    const context = await setup();
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    try {
      await context.open();
      const mock = createMockAgent("alpha");
      context.core.addAgent__unsafe_dev_only({
        id: "alpha",
        agent: mock.agent,
      });
      await context.inspector.updateComplete;

      await context.clickDetach();
      await waitFor(
        () => context.popDoc.querySelector(".inspector-window") !== null,
        "the Inspector window in the pop-out document",
      );

      const toggle = requireElement(
        context.popDoc.querySelector<HTMLButtonElement>(
          '[data-context-dropdown-root="true"] > button',
        ),
        "Agent menu was not rendered in the pop-out",
      );
      toggle.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      await context.inspector.updateComplete;

      const foreignButton = requireElement(
        iframe.contentDocument?.createElement("button"),
        "foreign-realm test button",
      );
      foreignButton.dataset.contextDropdownRoot = "true";
      expect(foreignButton instanceof HTMLElement).toBe(false);

      context.firePopOutPointerDown([foreignButton]);
      await context.inspector.updateComplete;

      expect(
        context.popDoc.querySelectorAll(
          '[data-context-dropdown-root="true"] button',
        ).length,
      ).toBeGreaterThan(1);
    } finally {
      iframe.remove();
      context.teardown();
    }
  });

  it("copies with the pop-out window clipboard", async () => {
    const context = await setup();
    try {
      await context.open();
      await context.selectLeaf("ag-ui-events");
      const mock = createMockAgent("alpha");
      context.core.addAgent__unsafe_dev_only({
        id: "alpha",
        agent: mock.agent,
      });
      mock.emit("onRunStartedEvent", {
        event: { id: "run-copy" },
        input: { runId: "run-copy" },
      });
      await context.inspector.updateComplete;
      await context.clickDetach();
      await waitFor(
        () => context.popDoc.body.textContent?.includes("RUN_STARTED") === true,
        "the pop-out Inspector to show the agent event",
      );

      const eventRow = requireElement(
        context.popDoc.querySelector<HTMLTableRowElement>("tbody tr"),
        "Event row was not rendered in the pop-out",
      );
      eventRow.click();
      await context.inspector.updateComplete;
      await waitFor(() => {
        const buttons = Array.from(context.popDoc.querySelectorAll("button"));
        return buttons.some((button) => button.textContent?.includes("Copy"));
      }, "the event Copy control in the pop-out");

      const pageWrite = vi.fn(async () => undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: pageWrite },
      });

      const copy = requireElement(
        Array.from(context.popDoc.querySelectorAll("button")).find((button) =>
          button.textContent?.includes("Copy"),
        ),
        "Event Copy control was not rendered in the pop-out",
      );
      copy.click();
      await waitFor(() => {
        const writes = context.fakeWindow.navigator.clipboard.writeText;
        return writes.mock.calls.length > 0;
      }, "the pop-out clipboard write");
      expect(pageWrite).not.toHaveBeenCalled();
    } finally {
      context.teardown();
    }
  });

  it("closes the pop-out window when the host is removed", async () => {
    const context = await setup();
    try {
      await context.open();
      const mock = createMockAgent("alpha");
      context.core.addAgent__unsafe_dev_only({
        id: "alpha",
        agent: mock.agent,
      });
      await context.inspector.updateComplete;

      await context.clickDetach();
      await waitFor(
        () => context.popDoc.querySelector(".inspector-window") !== null,
        "the Inspector window in the pop-out document",
      );
      expect(mock.subscriberCount()).toBeGreaterThan(0);

      Object.defineProperty(context.popDoc, "body", {
        configurable: true,
        get() {
          throw new Error("dead pop-out document");
        },
      });

      const requestUpdate = vi.spyOn(context.inspector, "requestUpdate");
      context.inspector.remove();
      expect(context.fakeWindow.close).toHaveBeenCalled();

      requestUpdate.mockClear();
      mock.emit("onRunStartedEvent", {
        event: { id: "run-after-remove" },
        input: { runId: "run-after-remove" },
      });
      expect(requestUpdate).not.toHaveBeenCalled();
    } finally {
      context.teardown();
    }
  });

  it("persists isOpen true without a flag that would reopen the pop-out", async () => {
    const context = await setup();
    try {
      await context.open();
      await context.clickDetach();
      await waitFor(
        () => context.popDoc.querySelector(".inspector-window") !== null,
        "the Inspector window in the pop-out document",
      );

      const state = storedInspectorState();
      expect(state.isOpen).toBe(true);
      if (state.dockMode !== undefined) {
        expect(["floating", "docked-left"]).toContain(state.dockMode);
      }
      for (const key of POP_OUT_REOPEN_KEYS) {
        expect(state).not.toHaveProperty(key);
      }
      expect(JSON.stringify(state).toLowerCase()).not.toMatch(
        /ispoppedout|poppedout|popout/,
      );
    } finally {
      context.teardown();
    }
  });
});
