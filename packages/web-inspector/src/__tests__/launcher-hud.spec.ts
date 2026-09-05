// Launcher HUD (hover menu on the closed launcher)
//
// Observable behaviour only: whether the HUD is on screen, which rows it
// names, which Inspector leaf a row opens, and that a press on the circle
// still opens Inspector. No private fields.

import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type {
  IntelligenceRuntimeInfo,
  RuntimeLicenseStatus,
  ThreadEndpointRuntimeInfo,
} from "@copilotkit/shared";
import { afterEach, expect, test, vi } from "vitest";

import { WebInspectorElement } from "../index.js";

const RUNTIME_URL = "https://runtime.launcher-hud.test";
const ANNOUNCEMENT_URL = "https://cdn.copilotkit.ai/announcements.json";

const ENABLED_ENDPOINTS = {
  list: true,
  inspect: true,
  mutations: false,
  realtimeMetadata: false,
} satisfies ThreadEndpointRuntimeInfo;

type Options = Readonly<{
  endpoints?: ThreadEndpointRuntimeInfo;
  intelligence?: boolean;
  licenseStatus?: RuntimeLicenseStatus;
}>;

class HudTestCore extends CopilotKitCore {
  private readonly endpointsValue: ThreadEndpointRuntimeInfo | undefined;
  private readonly intelligenceValue: IntelligenceRuntimeInfo | undefined;
  private readonly licenseStatusValue: RuntimeLicenseStatus | undefined;

  constructor(options: Options) {
    super({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
    this.endpointsValue = options.endpoints;
    this.intelligenceValue =
      options.intelligence === true
        ? { wsUrl: "wss://intelligence.launcher-hud.test" }
        : undefined;
    this.licenseStatusValue = options.licenseStatus;
  }

  override get threadEndpoints(): ThreadEndpointRuntimeInfo | undefined {
    return this.endpointsValue;
  }

  override get intelligence(): IntelligenceRuntimeInfo | undefined {
    return this.intelligenceValue;
  }

  override get licenseStatus(): RuntimeLicenseStatus | undefined {
    return this.licenseStatusValue;
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
      "HUD test runtime subscriber failed",
    );
  }
}

function requireElement<T extends Node>(element: T | null | undefined): T {
  if (!element) {
    throw new Error("Expected an element");
  }
  return element;
}

function root(inspector: WebInspectorElement): ShadowRoot {
  return requireElement(inspector.shadowRoot);
}

function launcherButton(inspector: WebInspectorElement): HTMLButtonElement {
  return requireElement(
    root(inspector).querySelector<HTMLButtonElement>(
      'button[aria-label^="Web Inspector"]',
    ),
  );
}

function hud(inspector: WebInspectorElement): HTMLElement | null {
  return root(inspector).querySelector<HTMLElement>("[data-cpk-launcher-hud]");
}

function hudOpen(inspector: WebInspectorElement): boolean {
  return hud(inspector) !== null;
}

function hudRowLabels(inspector: WebInspectorElement): string[] {
  return Array.from(
    root(inspector).querySelectorAll<HTMLElement>("[data-cpk-hud-row]"),
  ).map((row) => {
    const action = row.querySelector("[data-cpk-hud-action]");
    return action?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  });
}

function currentMenu(inspector: WebInspectorElement): string | null {
  return (
    root(inspector)
      .querySelector('button[data-inspector-menu-key][aria-current="page"]')
      ?.getAttribute("data-inspector-menu-key") ?? null
  );
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
});

async function settle(inspector: WebInspectorElement): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) {
    await inspector.updateComplete;
    await Promise.resolve();
  }
}

async function setup(options: Options = {}): Promise<{
  inspector: WebInspectorElement;
  openHud: () => Promise<void>;
  clickHud: (row: string) => Promise<void>;
  pressLauncher: () => Promise<void>;
}> {
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    Object.assign(
      vi.fn(async (input: RequestInfo | URL) => {
        const href = new URL(
          input instanceof Request ? input.url : String(input),
          window.location.href,
        ).href;
        if (href === ANNOUNCEMENT_URL) {
          return new Response(null, { status: 404 });
        }
        return new Response(null, { status: 404 });
      }),
      globalThis.fetch,
    ),
  );

  const inspector = new WebInspectorElement();
  const core = new HudTestCore(options);
  document.body.append(inspector);
  inspector.core = core;
  await core.emitStatus(CopilotKitCoreRuntimeConnectionStatus.Connected);
  await settle(inspector);

  const teardown = (): void => {
    inspector.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.replaceChildren();
  };
  cleanup = teardown;

  const openHud = async (): Promise<void> => {
    const wrapper = requireElement(
      root(inspector).querySelector<HTMLElement>(".console-button-wrapper"),
    );
    wrapper.dispatchEvent(
      new PointerEvent("pointerenter", { bubbles: true, composed: true }),
    );
    await settle(inspector);
  };

  const clickHud = async (row: string): Promise<void> => {
    const control = requireElement(
      root(inspector).querySelector<HTMLButtonElement>(
        `[data-cpk-hud-row="${row}"] [data-cpk-hud-action]`,
      ),
    );
    control.click();
    await settle(inspector);
  };

  const pressLauncher = async (): Promise<void> => {
    const button = launcherButton(inspector);
    const init = { bubbles: true, composed: true, pointerId: 1, button: 0 };
    button.dispatchEvent(new PointerEvent("pointerdown", init));
    button.dispatchEvent(new PointerEvent("pointerup", init));
    button.click();
    await settle(inspector);
  };

  return { inspector, openHud, clickHud, pressLauncher };
}

test("the HUD stays closed during the initial page-settle delay", async () => {
  const { inspector } = await setup();
  expect(hud(inspector)).toBeNull();
});

test("the HUD previews every feature in sequence on page load, then leaves", async () => {
  vi.useFakeTimers();
  const { inspector } = await setup({
    intelligence: true,
    endpoints: ENABLED_ENDPOINTS,
  });

  expect(hud(inspector)).toBeNull();
  await vi.advanceTimersByTimeAsync(500);
  await settle(inspector);

  const introHud = requireElement(hud(inspector));
  expect(introHud.getAttribute("data-cpk-hud-intro")).toBe("true");
  expect(hudRowLabels(inspector)).toEqual([
    "Rich Threads",
    "Automatic Learning",
  ]);
  expect(
    [
      root(inspector).querySelector<HTMLElement>(
        ".cpk-launcher-hud__feature-list",
      ),
      ...Array.from(
        root(inspector).querySelectorAll<HTMLElement>("[data-cpk-hud-row]"),
      ),
    ].map((item) =>
      requireElement(item).style.getPropertyValue("--cpk-hud-waterfall-delay"),
    ),
  ).toEqual(["180ms", "350ms", "520ms"]);

  await vi.advanceTimersByTimeAsync(3400);
  await settle(inspector);
  expect(hud(inspector)).toBeNull();
});

test("hovering during the page-load preview keeps the HUD open", async () => {
  vi.useFakeTimers();
  const { inspector, openHud } = await setup();
  await vi.advanceTimersByTimeAsync(500);
  await settle(inspector);
  expect(hudOpen(inspector)).toBe(true);

  await openHud();
  await vi.advanceTimersByTimeAsync(3400);
  await settle(inspector);

  expect(hudOpen(inspector)).toBe(true);
  expect(hud(inspector)?.hasAttribute("data-cpk-hud-intro")).toBe(false);
});

test("hovering the launcher shows its feature states without a redundant header", async () => {
  const { inspector, openHud } = await setup();
  await openHud();
  expect(hudOpen(inspector)).toBe(true);
  expect(launcherButton(inspector).getAttribute("title")).toBe(
    "CopilotKit Inspector",
  );
  expect(root(inspector).querySelector("[data-cpk-hud-header]")).toBeNull();
  expect(hudRowLabels(inspector)).toEqual([
    "Rich Threads",
    "Automatic Learning",
  ]);
  expect(
    root(inspector).querySelector('[data-cpk-hud-row="inspector"]'),
  ).toBeNull();
  expect(
    root(inspector).querySelector('[data-cpk-hud-row="intelligence"]'),
  ).toBeNull();
  expect(
    root(inspector).querySelector('[data-cpk-hud-icon="threads"] svg'),
  ).not.toBeNull();
  expect(
    root(inspector).querySelector('[data-cpk-hud-icon="learning"] svg'),
  ).not.toBeNull();
  expect(hud(inspector)?.getAttribute("data-cpk-hud-vertical")).toBe("top");
});

test("feature toggles reflect only capability states the Inspector has proved", async () => {
  const { inspector, openHud } = await setup({
    intelligence: true,
    endpoints: ENABLED_ENDPOINTS,
  });
  await openHud();
  expect(hudRowLabels(inspector)).toEqual([
    "Rich Threads",
    "Automatic Learning",
  ]);
  const threadsToggle = requireElement(
    root(inspector).querySelector<HTMLButtonElement>(
      '[data-cpk-hud-toggle="threads"]',
    ),
  );
  expect(threadsToggle.getAttribute("data-enabled")).toBe("true");
  expect(threadsToggle.disabled).toBe(true);
  expect(threadsToggle.getAttribute("aria-label")).toBe(
    "Rich Threads is enabled",
  );

  const learningToggle = requireElement(
    root(inspector).querySelector<HTMLButtonElement>(
      '[data-cpk-hud-toggle="learning"]',
    ),
  );
  expect(learningToggle.getAttribute("data-enabled")).toBe("false");
  expect(learningToggle.disabled).toBe(false);
  expect(learningToggle.getAttribute("aria-label")).toBe(
    "Open Automatic Learning in Inspector",
  );
});

test("the HUD respects a runtime that is not entitled to Intelligence", async () => {
  const { inspector, openHud } = await setup({
    intelligence: true,
    endpoints: ENABLED_ENDPOINTS,
    licenseStatus: "none",
  });

  await openHud();

  expect(hudRowLabels(inspector)).toEqual([
    "Rich Threads",
    "Automatic Learning",
  ]);
  for (const row of ["threads", "learning"] as const) {
    const toggle = requireElement(
      root(inspector).querySelector<HTMLButtonElement>(
        `[data-cpk-hud-toggle="${row}"]`,
      ),
    );
    expect(toggle.getAttribute("data-enabled")).toBe("false");
    expect(toggle.disabled).toBe(false);
  }
});

test("pressing the circle still opens Inspector", async () => {
  const { inspector, pressLauncher } = await setup();
  await pressLauncher();
  expect(root(inspector).querySelector(".inspector-window")).not.toBeNull();
  expect(hud(inspector)).toBeNull();
});

test("the floating window does not cover the sidebar toggle with a SW handle", async () => {
  const { inspector, pressLauncher } = await setup();
  await pressLauncher();
  const tree = root(inspector);
  expect(tree.querySelector('[data-resize-edge="sw"]')).toBeNull();
  expect(tree.querySelector('[data-resize-edge="se"]')).not.toBeNull();
  expect(tree.querySelector("[data-inspector-sidebar-toggle]")).not.toBeNull();
});

test("an enabled row body keeps its Inspector destination", async () => {
  const { inspector, openHud } = await setup({
    intelligence: true,
    endpoints: ENABLED_ENDPOINTS,
  });
  await openHud();
  const row = requireElement(
    root(inspector).querySelector<HTMLElement>('[data-cpk-hud-row="threads"]'),
  );
  row.click();
  await settle(inspector);
  expect(currentMenu(inspector)).toBe("threads");
});

test("Rich Threads on still lands on the Threads view", async () => {
  const { inspector, openHud, clickHud } = await setup({
    intelligence: true,
    endpoints: ENABLED_ENDPOINTS,
  });
  await openHud();
  await clickHud("threads");
  expect(currentMenu(inspector)).toBe("threads");
});

test("feature help buttons describe their destination with tooltips", async () => {
  const { inspector, openHud } = await setup();
  await openHud();
  const help = requireElement(
    root(inspector).querySelector<HTMLButtonElement>(
      '[data-cpk-hud-learn-more="threads"]',
    ),
  );
  const detailId = help.getAttribute("aria-describedby");
  const tooltip = requireElement(
    root(inspector).getElementById(detailId ?? ""),
  );
  expect(tooltip.getAttribute("role")).toBe("tooltip");
  expect(tooltip.textContent).toBe("Click to learn more");
});

test("feature toggles open their relevant Inspector views", async () => {
  const { inspector, openHud } = await setup();
  await openHud();
  requireElement(
    root(inspector).querySelector<HTMLButtonElement>(
      '[data-cpk-hud-toggle="learning"]',
    ),
  ).click();
  await settle(inspector);
  expect(currentMenu(inspector)).toBe("memories");
});

test("disabled feature rows open their landing pages, where setup prompts can be copied", async () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  const writeText = vi
    .fn<(value: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  try {
    const { inspector, openHud, clickHud } = await setup();
    await openHud();

    expect(root(inspector).querySelector("[data-cpk-hud-copy]")).toBeNull();
    expect(root(inspector).querySelector("[data-cpk-hud-help]")).toBeNull();

    await clickHud("threads");
    expect(currentMenu(inspector)).toBe("threads");
    const copyThreads = requireElement(
      root(inspector).querySelector<HTMLButtonElement>(
        '[data-inspector-feature-setup-prompt="threads"]',
      ),
    );

    copyThreads.click();
    await settle(inspector);

    expect(writeText).toHaveBeenCalledTimes(1);
    const threadsPrompt = String(writeText.mock.calls[0]?.[0]);
    expect(threadsPrompt).toContain(
      "This task is specifically to enable Threads",
    );
    expect(threadsPrompt).toContain("https://docs.copilotkit.ai/threads");
    expect(threadsPrompt).not.toContain("--intent");
    expect(copyThreads.dataset.copyState).toBe("copied");
    expect(copyThreads.getAttribute("aria-label")).toBe(
      "Threads setup prompt copied",
    );

    requireElement(
      root(inspector).querySelector<HTMLButtonElement>(
        '[data-inspector-menu-key="memories"]',
      ),
    ).click();
    await settle(inspector);
    expect(currentMenu(inspector)).toBe("memories");
    const learningView = requireElement(
      root(inspector).querySelector<HTMLElement>("cpk-learning-view"),
    );
    await (learningView as HTMLElement & { updateComplete: Promise<void> })
      .updateComplete;
    expect(learningView.shadowRoot?.textContent).toContain(
      "Learning is not available with this runtime version.",
    );
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(root(inspector).querySelector(".inspector-window")).not.toBeNull();
  } finally {
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  }
});

test("the launcher never shows setup prompt actions", async () => {
  const { inspector, openHud } = await setup({
    intelligence: true,
    endpoints: ENABLED_ENDPOINTS,
  });
  await openHud();
  expect(root(inspector).querySelector("[data-cpk-hud-copy]")).toBeNull();
});

test("Learning on still lands on the Learning view", async () => {
  const { inspector, openHud, clickHud } = await setup({ intelligence: true });
  await openHud();
  await clickHud("learning");
  expect(currentMenu(inspector)).toBe("memories");
});

test("focusing the launcher opens the HUD; Escape closes it", async () => {
  const { inspector } = await setup();
  const button = launcherButton(inspector);
  button.focus();
  root(inspector)
    .querySelector(".console-button-wrapper")
    ?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  await settle(inspector);
  expect(hudOpen(inspector)).toBe(true);

  button.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await settle(inspector);
  expect(hudOpen(inspector)).toBe(false);
});
