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
  return root(inspector).querySelector<HTMLElement>(
    "[data-cpk-launcher-drawer]",
  );
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

function capsuleHeading(inspector: WebInspectorElement): string | null {
  return (
    root(inspector)
      .querySelector("[data-cpk-capsule-heading]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ?? null
  );
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
  clickCapsule: () => Promise<void>;
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

  const clickCapsule = async (): Promise<void> => {
    const capsule = requireElement(
      root(inspector).querySelector<HTMLElement>("[data-cpk-launcher-capsule]"),
    );
    capsule.click();
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

  return { inspector, openHud, clickHud, clickCapsule, pressLauncher };
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
  // Intelligence previews too, but as the capsule's title rather than a
  // staggered row — it is the connection the two rows below are carried
  // over, not a third feature beside them.
  expect(capsuleHeading(inspector)).toBe("Intelligence connected");
  expect(hudRowLabels(inspector)).toEqual([
    "Threads enabled",
    "Learning enabled",
  ]);
  // Two rows now, so two staggered delays: rowStart (180ms) then
  // rowStart + rowStagger (180ms + 170ms = 350ms). See
  // LAUNCHER_HUD_INTRO_MS in src/index.ts.
  expect(
    Array.from(
      root(inspector).querySelectorAll<HTMLElement>("[data-cpk-hud-row]"),
    ).map((row) => row.style.getPropertyValue("--cpk-hud-row-delay")),
  ).toEqual(["180ms", "350ms"]);

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

test("hovering the launcher shows Threads and Learning, disabled", async () => {
  const { inspector, openHud } = await setup();
  await openHud();
  expect(hudOpen(inspector)).toBe(true);
  expect(hudRowLabels(inspector)).toEqual([
    "Threads disabled",
    "Learning disabled",
  ]);
  // Intelligence is not a row any more; it is the capsule's title.
  expect(capsuleHeading(inspector)).toBe("Intelligence not connected");
});

test("connected Threads and Learning show a check, and Intelligence titles the capsule", async () => {
  const { inspector, openHud } = await setup({
    intelligence: true,
    endpoints: ENABLED_ENDPOINTS,
  });
  await openHud();
  expect(hudRowLabels(inspector)).toEqual([
    "Threads enabled",
    "Learning enabled",
  ]);
  expect(capsuleHeading(inspector)).toBe("Intelligence connected");
  expect(
    root(inspector).querySelector(
      '[data-cpk-hud-row="threads"] [data-cpk-hud-check]',
    ),
  ).not.toBeNull();
  expect(
    root(inspector).querySelector(
      '[data-cpk-hud-row="learning"] [data-cpk-hud-check]',
    ),
  ).not.toBeNull();
});

test("the HUD respects a runtime that is not entitled to Intelligence", async () => {
  const { inspector, openHud } = await setup({
    intelligence: true,
    endpoints: ENABLED_ENDPOINTS,
    licenseStatus: "none",
  });

  await openHud();

  // The transport flags (intelligence + endpoints) are present, but the
  // license is not entitled: the title must say so, not just the rows.
  expect(capsuleHeading(inspector)).toBe("Intelligence not connected");
  expect(hudRowLabels(inspector)).toEqual([
    "Threads disabled",
    "Learning disabled",
  ]);
  for (const row of ["threads", "learning"] as const) {
    expect(
      root(inspector).querySelector(
        `[data-cpk-hud-row="${row}"] [data-cpk-hud-check]`,
      ),
    ).toBeNull();
    expect(
      root(inspector).querySelector(
        `[data-cpk-hud-row="${row}"] [data-cpk-hud-cross]`,
      ),
    ).not.toBeNull();
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

test("Turn on Threads lands on the Threads view", async () => {
  const { inspector, openHud, clickHud } = await setup();
  await openHud();
  await clickHud("threads");
  expect(currentMenu(inspector)).toBe("threads");
});

test("a press on the row body lands, not only the title", async () => {
  const { inspector, openHud } = await setup();
  await openHud();
  const rowBody = requireElement(
    root(inspector).querySelector<HTMLElement>('[data-cpk-hud-row="threads"]'),
  );
  rowBody.click();
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

// There is no longer an Intelligence row to click: Intelligence is the
// capsule's title now, and the capsule itself is clickable — it opens the
// Inspector exactly as pressing the launcher mark does (see
// `handlePillClick` in src/index.ts), reusing the same plain-open path
// rather than a HUD row's `hudLandingMenu` override. A plain open lands on
// whichever menu was last selected, which for a fresh Inspector is "home".
// That is the equivalent guarantee to what these two tests checked before:
// interacting with the Intelligence surface opens the Inspector on Home, in
// both the connected and not-connected states.
test("clicking the capsule opens Inspector on Home when Intelligence is not connected", async () => {
  const { inspector, openHud, clickCapsule } = await setup();
  await openHud();
  await clickCapsule();
  expect(currentMenu(inspector)).toBe("home");
  expect(hud(inspector)).toBeNull();
});

test("clicking the capsule opens Inspector on Home when Intelligence is connected", async () => {
  const { inspector, openHud, clickCapsule } = await setup({
    intelligence: true,
  });
  await openHud();
  await clickCapsule();
  expect(currentMenu(inspector)).toBe("home");
  expect(hud(inspector)).toBeNull();
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
