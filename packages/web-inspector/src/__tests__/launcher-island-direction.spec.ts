// Launcher island direction — the one spec that drives both surfaces at one
// stubbed geometry.
//
// The capsule and the drawer used to decide which side of the mark to open
// on through two different rules. The drawer measured itself as a card
// standing beside the launcher and used a stale width; the capsule measured
// the overhang of an island drawn over the mark. For any `mark.left` in
// [236, 264) at LAUNCHER_SIZE = 52 the two rules disagreed outright — the
// capsule opened left, the drawer opened right, two halves of one object
// pointing away from each other. A second divergence let the drawer fall
// back to a side and clip off the viewport in exactly the position where the
// capsule correctly declined to open at all.
//
// The entire shipped suite — 615 tests — stayed green against a deliberate
// reintroduction of that bug. That is not a gap in effort: it is a gap in
// shape. launcher-error-signal.spec.ts stubs geometry and asserts the
// capsule's own direction (see its `stubGeometry` and the tests around
// `pillDirection`); launcher-island.spec.ts asserts the drawer's markup and
// stylesheet with no geometry stub at all. Both are thorough about the
// surface they cover, and neither ever puts the capsule and the drawer at
// the same `mark.left` and compares what each one chose. That comparison is
// the only thing that can catch the two rules drifting apart again, so it
// lives here, in its own file, rather than folded into either suite above.
//
// Same `stubGeometry` idiom as the other launcher suites: jsdom lays nothing
// out, so `getBoundingClientRect` is mocked to give the mark and the capsule
// real boxes rather than the all-zero rect jsdom would otherwise return.

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

const RUNTIME_URL = "https://runtime.launcher-island-direction.test";

/** The launcher's rendered diameter at this suite's viewport. */
const LAUNCHER_SIZE = 52;
const EDGE_MARGIN = 16;
const ISLAND_WIDTH = 272;
/** The island's overhang past the mark — the part that actually needs room. */
const OVERHANG = ISLAND_WIDTH - LAUNCHER_SIZE; // 220

/**
 * A `mark.left` inside the range the two rules used to disagree over.
 *
 * The capsule's (correct) rule opens left from `EDGE_MARGIN + OVERHANG` =
 * 236. The drawer's stale rule opened left only from `EDGE_MARGIN + 248` =
 * 264. Anything in [236, 264) used to give capsule=left, drawer=right.
 */
const DIVERGENT_LEFT = 240;

// The gesture's four phases, stated once for this suite. Matches
// launcher-error-signal.spec.ts's own constants; the drawer is only reached
// once the capsule's gesture has fully closed, so both tests here have to
// wait out all four before opening the drawer on top of it.
const ERROR_BEAT_MS = 400;
const PILL_OPEN_MS = 250;
const PILL_HOLD_MS = 2500;
const PILL_CLOSE_MS = 250;
const GESTURE_MS = ERROR_BEAT_MS + PILL_OPEN_MS + PILL_HOLD_MS + PILL_CLOSE_MS;

const ENABLED_ENDPOINTS = {
  list: true,
  inspect: true,
  mutations: false,
  realtimeMetadata: false,
} satisfies ThreadEndpointRuntimeInfo;

class DirectionTestCore extends CopilotKitCore {
  constructor() {
    super({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
  }

  override get threadEndpoints(): ThreadEndpointRuntimeInfo | undefined {
    return ENABLED_ENDPOINTS;
  }

  override get intelligence(): IntelligenceRuntimeInfo | undefined {
    return undefined;
  }

  override get telemetryDisabled(): boolean {
    return true;
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
      "direction test runtime subscriber failed",
    );
  }
}

let restoreViewportWidth: (() => void) | null = null;

function stubGeometry(options: {
  launcherLeft: number;
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
      if (this.hasAttribute("data-cpk-launcher-capsule")) {
        return box(options.launcherLeft, ISLAND_WIDTH);
      }
      return box(0, 0);
    },
  );
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  restoreViewportWidth?.();
  restoreViewportWidth = null;
  vi.useRealTimers();
});

function root(inspector: WebInspectorElement): ShadowRoot {
  const shadow = inspector.shadowRoot;
  if (!shadow) throw new Error("no shadow root");
  return shadow;
}

function capsuleSide(inspector: WebInspectorElement): string | null {
  return (
    root(inspector)
      .querySelector("[data-cpk-launcher-capsule]")
      ?.getAttribute("data-cpk-capsule-direction") ?? null
  );
}

function drawerSide(inspector: WebInspectorElement): string | null {
  return (
    root(inspector)
      .querySelector("[data-cpk-launcher-drawer]")
      ?.getAttribute("data-cpk-drawer-side") ?? null
  );
}

async function setup(geometry: {
  launcherLeft: number;
  viewportWidth: number;
}): Promise<{
  inspector: WebInspectorElement;
  advance: (ms: number) => Promise<void>;
  breakConnection: () => Promise<void>;
  dwell: () => Promise<void>;
}> {
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    Object.assign(
      vi.fn(async () => new Response(null, { status: 404 })),
      globalThis.fetch,
    ),
  );

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  const inspector = new WebInspectorElement();
  const core = new DirectionTestCore();
  document.body.append(inspector);
  inspector.core = core;
  await core.emitStatus(CopilotKitCoreRuntimeConnectionStatus.Connected);

  const flush = async (): Promise<void> => {
    for (let turn = 0; turn < 6; turn += 1) {
      await vi.advanceTimersByTimeAsync(0);
      await inspector.updateComplete;
    }
  };
  await flush();

  // Stubbed after mount, exactly as the shipped suite does it.
  stubGeometry(geometry);

  cleanup = () => {
    inspector.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.replaceChildren();
  };

  return {
    inspector,
    advance: async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      await flush();
    },
    breakConnection: async () => {
      await core.emitStatus(CopilotKitCoreRuntimeConnectionStatus.Error);
      await flush();
    },
    dwell: async () => {
      const wrapper = root(inspector).querySelector<HTMLElement>(
        ".console-button-wrapper",
      );
      if (!wrapper) throw new Error("no launcher wrapper");
      wrapper.dispatchEvent(
        new PointerEvent("pointerenter", { bubbles: true, composed: true }),
      );
      await flush();
    },
  };
}

test("the capsule and the drawer open on the same side", async () => {
  const context = await setup({
    launcherLeft: DIVERGENT_LEFT,
    viewportWidth: 1280,
  });

  await context.breakConnection();
  const capsule = capsuleSide(context.inspector);

  // Let the whole gesture finish so the drawer is no longer blocked by it.
  await context.advance(GESTURE_MS);
  await context.dwell();
  const drawer = drawerSide(context.inspector);

  const observed = `mark.left=${DIVERGENT_LEFT} capsule=${capsule} drawer=${drawer}`;
  expect(capsule, observed).not.toBeNull();
  expect(drawer, observed).not.toBeNull();
  expect(drawer, observed).toBe(capsule);
  // And the side is the one the correct rule gives: 240 - 220 = 20 >= 16.
  expect(capsule, observed).toBe("left");
});

test("with no room on either side, neither half opens", async () => {
  // Narrow enough that neither side clears EDGE_MARGIN with the overhang.
  const viewportWidth = EDGE_MARGIN + LAUNCHER_SIZE + EDGE_MARGIN;
  const context = await setup({
    launcherLeft: EDGE_MARGIN,
    viewportWidth,
  });

  await context.breakConnection();
  const capsulePresent =
    root(context.inspector).querySelector("[data-cpk-launcher-capsule]") !==
    null;

  await context.advance(GESTURE_MS);
  await context.dwell();
  const drawerPresent =
    root(context.inspector).querySelector("[data-cpk-launcher-drawer]") !==
    null;

  // The signal itself is intact: the dot survives, only the labels are lost.
  const dotPresent =
    root(context.inspector).querySelector("[data-cpk-signal-dot]") !== null;

  const observed = `viewport=${viewportWidth} capsule=${
    capsulePresent ? "shown" : "stood down"
  } drawer=${drawerPresent ? "shown" : "stood down"} dot=${
    dotPresent ? "present" : "gone"
  }`;

  expect(capsulePresent, observed).toBe(false);
  expect(drawerPresent, observed).toBe(false);
  expect(dotPresent, observed).toBe(true);
});
