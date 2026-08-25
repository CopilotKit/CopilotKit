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
}>;

class HudTestCore extends CopilotKitCore {
  private readonly endpointsValue: ThreadEndpointRuntimeInfo | undefined;
  private readonly intelligenceValue: IntelligenceRuntimeInfo | undefined;

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
  }

  override get threadEndpoints(): ThreadEndpointRuntimeInfo | undefined {
    return this.endpointsValue;
  }

  override get intelligence(): IntelligenceRuntimeInfo | undefined {
    return this.intelligenceValue;
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

function requireElement<T extends Element>(element: T | null): T {
  if (element === null) {
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

test("the HUD is closed until the launcher is hovered", async () => {
  const { inspector } = await setup();
  expect(hud(inspector)).toBeNull();
});

test("hovering the launcher shows Open Inspector, Threads, Intelligence, and Learning", async () => {
  const { inspector, openHud } = await setup();
  await openHud();
  expect(hudOpen(inspector)).toBe(true);
  expect(hudRowLabels(inspector)).toEqual([
    "Open Inspector",
    "Turn on Threads",
    "Turn on Intelligence",
    "Turn on Learning",
  ]);
});

test("connected Intelligence and Threads keep their slots and show a check", async () => {
  const { inspector, openHud } = await setup({
    intelligence: true,
    endpoints: ENABLED_ENDPOINTS,
  });
  await openHud();
  expect(hudRowLabels(inspector)).toEqual([
    "Open Inspector",
    "Threads on",
    "Intelligence connected",
    "Learning on",
  ]);
  expect(
    root(inspector).querySelector(
      '[data-cpk-hud-row="threads"] [data-cpk-hud-check]',
    ),
  ).not.toBeNull();
  expect(
    root(inspector).querySelector(
      '[data-cpk-hud-row="intelligence"] [data-cpk-hud-check]',
    ),
  ).not.toBeNull();
  expect(
    root(inspector).querySelector(
      '[data-cpk-hud-row="learning"] [data-cpk-hud-check]',
    ),
  ).not.toBeNull();
});

test("pressing the circle still opens Inspector", async () => {
  const { inspector, pressLauncher } = await setup();
  await pressLauncher();
  expect(root(inspector).querySelector(".inspector-window")).not.toBeNull();
  expect(hud(inspector)).toBeNull();
});

test("Open Inspector in the HUD opens the panel", async () => {
  const { inspector, openHud, clickHud } = await setup();
  await openHud();
  await clickHud("inspector");
  expect(root(inspector).querySelector(".inspector-window")).not.toBeNull();
  expect(currentMenu(inspector)).toBe("home");
});

test("Turn on Threads lands on the Threads view", async () => {
  const { inspector, openHud, clickHud } = await setup();
  await openHud();
  await clickHud("threads");
  expect(currentMenu(inspector)).toBe("threads");
});

test("a press on the row body lands, not only the title", async () => {
  const { inspector, openHud } = await setup();
  await openHud();
  const detail = requireElement(
    root(inspector).querySelector<HTMLElement>(
      '[data-cpk-hud-row="threads"] .cpk-launcher-hud__detail',
    ),
  );
  detail.click();
  await settle(inspector);
  expect(currentMenu(inspector)).toBe("threads");
});

test("Threads on still lands on the Threads view", async () => {
  const { inspector, openHud, clickHud } = await setup({
    endpoints: ENABLED_ENDPOINTS,
  });
  await openHud();
  await clickHud("threads");
  expect(currentMenu(inspector)).toBe("threads");
});

test("the help mark keeps a row's detail open without hover", async () => {
  const { inspector, openHud } = await setup();
  await openHud();
  const help = requireElement(
    root(inspector).querySelector<HTMLButtonElement>(
      '[data-cpk-hud-row="threads"] [aria-expanded]',
    ),
  );
  help.click();
  await settle(inspector);
  expect(
    root(inspector)
      .querySelector('[data-cpk-hud-row="threads"]')
      ?.getAttribute("data-cpk-hud-help"),
  ).toBe("open");
  expect(help.getAttribute("aria-expanded")).toBe("true");
  expect(root(inspector).querySelector(".inspector-window")).toBeNull();
});

test("Turn on Intelligence lands on Home", async () => {
  const { inspector, openHud, clickHud } = await setup();
  await openHud();
  await clickHud("intelligence");
  expect(currentMenu(inspector)).toBe("home");
});

test("Intelligence connected lands on Home", async () => {
  const { inspector, openHud, clickHud } = await setup({ intelligence: true });
  await openHud();
  await clickHud("intelligence");
  expect(currentMenu(inspector)).toBe("home");
});

test("Turn on Learning lands on the Learning view", async () => {
  const { inspector, openHud, clickHud } = await setup();
  await openHud();
  await clickHud("learning");
  expect(currentMenu(inspector)).toBe("memories");
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
