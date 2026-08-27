// Launcher island (the capsule the closed launcher opens into)
//
// Same discipline as the other launcher suites: assertions read the actual
// adopted stylesheet text rather than computed style or layout geometry.
// This suite runs under jsdom (see packages/web-inspector/vitest.config.ts),
// which returns "" for every custom-property read off a shadow-root
// stylesheet, rgba(0, 0, 0, 0) for backgroundColor, and an all-zero DOMRect
// for every element — so getComputedStyle() and getBoundingClientRect()
// cannot tell these cases apart. The stylesheet text can, so every test here
// extracts a CSS rule by name and inspects its declarations directly.
//
// What is under test is the SHARING, not the value: the capsule and the
// launcher resolve the same custom properties rather than each carrying its
// own literal, so a later edit that changes a token moves both, and a later
// edit that hardcodes either fails here.

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

class IslandTestCore extends CopilotKitCore {
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
  const core = new IslandTestCore(options);
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

/** Every stylesheet this component adopts, as one string. */
function stylesheetText(inspector: WebInspectorElement): string {
  return Array.from(root(inspector).querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
}

function capsule(inspector: WebInspectorElement): HTMLElement | null {
  return root(inspector).querySelector<HTMLElement>(
    "[data-cpk-launcher-capsule]",
  );
}

test("the capsule and the launcher share one surface and one edge", async () => {
  const { inspector } = await setup();
  const css = stylesheetText(inspector);
  const wrapperRule =
    /\.console-button-wrapper\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  // The wrapper is the one place the tokens are declared. If a later edit
  // moves the declaration elsewhere, both consumers below lose their source
  // of truth silently — this pins the source, not just the consumers.
  expect(wrapperRule).toContain("--cpk-launcher-face:");
  expect(wrapperRule).toContain("--cpk-launcher-edge:");

  const capsuleRule =
    /\.cpk-launcher-capsule\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  // The capsule resolves the wrapper's own tokens rather than restating the
  // colours. A future edit that changes a token moves both the launcher and
  // the capsule at once; a future edit that hardcodes either drifts apart
  // without this failing to catch it.
  expect(capsuleRule).toContain("var(--cpk-launcher-face)");
  expect(capsuleRule).toContain("var(--cpk-launcher-edge)");
  // color-mix would be a second, independently-computed surface rather than
  // the same one the launcher already carries.
  expect(capsuleRule).not.toContain("color-mix");
});

test("the island width is a shared custom property, not a literal", async () => {
  const { inspector } = await setup();
  const css = stylesheetText(inspector);

  const wrapperRule =
    /\.console-button-wrapper\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  // The width is declared once, as a length, on the wrapper. Asserted as a
  // pattern rather than a specific number: the value is allowed to change,
  // but it must still live on the shared token rather than move onto the
  // capsule as its own literal.
  expect(wrapperRule).toMatch(/--cpk-launcher-island:\s*\d+(\.\d+)?px/);

  const capsuleRule =
    /\.cpk-launcher-capsule\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  // The capsule reads that same token for its own width. If it instead
  // carried a matching literal, the two would agree today and silently
  // drift the next time either one is edited.
  expect(capsuleRule).toContain("width: var(--cpk-launcher-island)");
});

test("one radius expression makes every island shape", async () => {
  const { inspector } = await setup();
  const css = stylesheetText(inspector);

  const capsuleRule =
    /\.cpk-launcher-capsule\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  // The radius is derived from the launcher's own size rather than a bare
  // pixel value, so the capsule's ends stay exactly as round as the circle
  // it opens from at every size the clamp produces. A literal radius would
  // agree with the circle only at one width and drift at every other.
  expect(capsuleRule).toContain(
    "border-radius: calc(var(--cpk-launcher-size) / 2)",
  );
});
