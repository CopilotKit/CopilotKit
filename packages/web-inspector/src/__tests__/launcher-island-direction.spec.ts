// Launcher island direction — the one spec that drives both surfaces at one
// stubbed geometry, on both of the axes the island can open along.
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
// The vertical axis arrived later, and arrived with the same shape of hole:
// the rule read `viewportWidth` and nothing else, so an island dragged to the
// foot of the window opened on the correct SIDE and then ran off the bottom
// of the screen — rows unreachable, and nothing left on screen to say they
// were there. It is the same defect one axis over, so it is guarded here, in
// the same file, by the same join: one geometry, both surfaces, compare what
// each one chose.
//
// Same `stubGeometry` idiom as the other launcher suites: jsdom lays nothing
// out, so `getBoundingClientRect` is mocked to give the mark and the capsule
// real boxes rather than the all-zero rect jsdom would otherwise return. The
// vertical cases stub `window.innerHeight` alongside `innerWidth` for the
// same reason: jsdom's default 768 is plenty of room, so a rule that never
// looked down would pass every one of them.

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
/**
 * A `mark.left` inside the range the two rules used to disagree over.
 *
 * The capsule's (correct) rule opens left from `EDGE_MARGIN + OVERHANG` =
 * 236. The drawer's stale rule opened left only from `EDGE_MARGIN + 248` =
 * 264. Anything in [236, 264) used to give capsule=left, drawer=right.
 */
const DIVERGENT_LEFT = 240;

/**
 * The island's height at this suite's launcher size, and the part of it that
 * hangs past the mark.
 *
 * Written out here as the arithmetic the rule performs rather than as the
 * number it comes to, so this file states the same relationship
 * `launcherIslandHeight` does: the capsule's band is the mark itself, and
 * everything past it is the drawer's chrome plus its rows. If a third row is
 * ever added, `ISLAND_ROWS` is the one figure here that has to follow it.
 */
const ISLAND_CHROME = 16; // two hairlines + the band gap + the room past the last row
const ISLAND_ROW_HEIGHT = 32;
const ISLAND_ROWS = 2;
const ISLAND_HEIGHT =
  LAUNCHER_SIZE + ISLAND_CHROME + ISLAND_ROWS * ISLAND_ROW_HEIGHT; // 132
/** What the vertical axis actually has to find room for. */
const DROP_OVERHANG = ISLAND_HEIGHT - LAUNCHER_SIZE; // 80

/**
 * A viewport and a `mark.top` that leave the island no room below the mark
 * and plenty above it.
 *
 * `mark.bottom` is 172, so the room below is 200 - 16 - 172 = 12, well short
 * of the 80 the rows need; the room above is 120 - 16 = 104, comfortably past
 * it. Downward is the preferred answer, so a rule that reached "up" here can
 * only have got there by looking.
 */
const SHORT_VIEWPORT_HEIGHT = 200;
const LOW_LAUNCHER_TOP = 120;

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

let restoreViewport: (() => void) | null = null;

/** Both viewport dimensions together — the rule reads them as a pair. */
function setViewport(width: number, height: number): void {
  for (const [key, value] of [
    ["innerWidth", width],
    ["innerHeight", height],
  ] as const) {
    Object.defineProperty(window, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
}

/**
 * The stubbed geometry.
 *
 * `launcherTop` and `viewportHeight` default to the values every test in this
 * file used before the vertical axis existed: the mark at the top of the
 * window, and jsdom's own 768px viewport. A horizontal test therefore reads
 * exactly as it did, and any test that says nothing about the vertical axis is
 * asking for the case with room to spare below.
 */
function stubGeometry(options: {
  launcherLeft: number;
  viewportWidth: number;
  launcherTop?: number;
  viewportHeight?: number;
}): void {
  const launcherTop = options.launcherTop ?? 0;
  const previousWidth = window.innerWidth;
  const previousHeight = window.innerHeight;
  setViewport(options.viewportWidth, options.viewportHeight ?? previousHeight);
  restoreViewport = () => setViewport(previousWidth, previousHeight);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement): DOMRect {
      const box = (left: number, width: number): DOMRect =>
        ({
          x: left,
          y: launcherTop,
          left,
          right: left + width,
          top: launcherTop,
          bottom: launcherTop + LAUNCHER_SIZE,
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
  restoreViewport?.();
  restoreViewport = null;
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

/**
 * The vertical half of each surface's answer.
 *
 * One attribute name for both, unlike the side — which the capsule and the
 * drawer each spell their own way for historical reasons. Read off each
 * element separately all the same: the point of this file is to compare what
 * the two of them are actually carrying, and reading one and assuming the
 * other would prove nothing.
 */
function capsuleDrop(inspector: WebInspectorElement): string | null {
  return (
    root(inspector)
      .querySelector("[data-cpk-launcher-capsule]")
      ?.getAttribute("data-cpk-island-drop") ?? null
  );
}

function drawerDrop(inspector: WebInspectorElement): string | null {
  return (
    root(inspector)
      .querySelector("[data-cpk-launcher-drawer]")
      ?.getAttribute("data-cpk-island-drop") ?? null
  );
}

async function setup(geometry: {
  launcherLeft: number;
  viewportWidth: number;
  launcherTop?: number;
  viewportHeight?: number;
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

// ── The vertical axis ─────────────────────────────────────────────────────
//
// Same three shapes as above, one axis over: the two surfaces agree where
// the flip is needed, they agree where it is not, and where neither way up
// fits they both stand down and leave the dot.

test("the capsule and the drawer flip up together when the rows will not fit below", async () => {
  const context = await setup({
    launcherLeft: DIVERGENT_LEFT,
    viewportWidth: 1280,
    launcherTop: LOW_LAUNCHER_TOP,
    viewportHeight: SHORT_VIEWPORT_HEIGHT,
  });

  await context.breakConnection();
  const capsule = capsuleDrop(context.inspector);

  await context.advance(GESTURE_MS);
  await context.dwell();
  const drawer = drawerDrop(context.inspector);

  const roomBelow =
    SHORT_VIEWPORT_HEIGHT - EDGE_MARGIN - (LOW_LAUNCHER_TOP + LAUNCHER_SIZE);
  const observed =
    `mark.top=${LOW_LAUNCHER_TOP} viewportHeight=${SHORT_VIEWPORT_HEIGHT} ` +
    `roomBelow=${roomBelow} needs=${DROP_OVERHANG} ` +
    `capsule=${capsule} drawer=${drawer}`;
  expect(capsule, observed).not.toBeNull();
  expect(drawer, observed).not.toBeNull();
  expect(drawer, observed).toBe(capsule);
  // The drawer's rows hang 80px past the mark and only 12px of window is left
  // below it, so the island has to hang from the mark's bottom edge instead.
  expect(capsule, observed).toBe("up");
});

// The next two tests are one test in two halves, and they are the only thing
// in this suite that can see the island's HEIGHT.
//
// The flip test above passes on any height between 13px and 105px of
// overhang, so it says the rule looks down but not what it looks for. These
// two put the window one pixel either side of the exact figure
// `launcherIslandHeight` computes, so the arithmetic behind that figure — two
// hairlines, the band that clears the mark, the room past the last row, and
// the rows themselves — is load-bearing here. Get any term of it wrong, or
// add a row without the height following, and one of the two fails.
//
// Downward is also the island's natural direction, so the first of them is
// the case that must not change at all.

test("with exactly the room the rows need below it, the island still opens downward", async () => {
  const viewportHeight =
    EDGE_MARGIN + LOW_LAUNCHER_TOP + LAUNCHER_SIZE + DROP_OVERHANG;
  const context = await setup({
    launcherLeft: DIVERGENT_LEFT,
    viewportWidth: 1280,
    launcherTop: LOW_LAUNCHER_TOP,
    viewportHeight,
  });

  await context.breakConnection();
  const capsule = capsuleDrop(context.inspector);

  await context.advance(GESTURE_MS);
  await context.dwell();
  const drawer = drawerDrop(context.inspector);

  const observed =
    `viewportHeight=${viewportHeight} roomBelow=${DROP_OVERHANG} ` +
    `needs=${DROP_OVERHANG} capsule=${capsule} drawer=${drawer}`;
  expect(drawer, observed).toBe(capsule);
  expect(capsule, observed).toBe("down");
});

test("one pixel short of it, the island flips up", async () => {
  const viewportHeight =
    EDGE_MARGIN + LOW_LAUNCHER_TOP + LAUNCHER_SIZE + DROP_OVERHANG - 1;
  const context = await setup({
    launcherLeft: DIVERGENT_LEFT,
    viewportWidth: 1280,
    launcherTop: LOW_LAUNCHER_TOP,
    viewportHeight,
  });

  await context.breakConnection();
  const capsule = capsuleDrop(context.inspector);

  await context.advance(GESTURE_MS);
  await context.dwell();
  const drawer = drawerDrop(context.inspector);

  const observed =
    `viewportHeight=${viewportHeight} roomBelow=${DROP_OVERHANG - 1} ` +
    `needs=${DROP_OVERHANG} capsule=${capsule} drawer=${drawer}`;
  expect(drawer, observed).toBe(capsule);
  expect(capsule, observed).toBe("up");
});

test("with no room above or below, neither half opens", async () => {
  // The vertical mirror of the no-room test above: a window exactly one mark
  // plus its two margins tall, so the rows have nowhere to go either way.
  // Horizontally there is room to spare, which is the point — the island is
  // dropped on the strength of the axis that fails, not because both did.
  const viewportHeight = EDGE_MARGIN + LAUNCHER_SIZE + EDGE_MARGIN;
  const context = await setup({
    launcherLeft: DIVERGENT_LEFT,
    viewportWidth: 1280,
    launcherTop: EDGE_MARGIN,
    viewportHeight,
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

  // The signal itself is intact, exactly as it is when the horizontal axis
  // is the one with no room: the dot survives, only the labels are lost.
  const dotPresent =
    root(context.inspector).querySelector("[data-cpk-signal-dot]") !== null;

  const observed =
    `viewportHeight=${viewportHeight} needs=${DROP_OVERHANG} ` +
    `capsule=${capsulePresent ? "shown" : "stood down"} ` +
    `drawer=${drawerPresent ? "shown" : "stood down"} ` +
    `dot=${dotPresent ? "present" : "gone"}`;

  expect(capsulePresent, observed).toBe(false);
  expect(drawerPresent, observed).toBe(false);
  expect(dotPresent, observed).toBe(true);
});
