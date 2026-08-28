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
  CopilotKitCoreErrorCode,
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkit/core";
import type {
  IntelligenceRuntimeInfo,
  RuntimeLicenseStatus,
  ThreadEndpointRuntimeInfo,
} from "@copilotkit/shared";
import { afterEach, expect, test, vi } from "vitest";

import { WebInspectorElement } from "../index.js";
import { TELEMETRY_EVENTS, TELEMETRY_INGEST_URL } from "../lib/telemetry.js";

const RUNTIME_URL = "https://runtime.launcher-hud.test";
const ANNOUNCEMENT_URL = "https://cdn.copilotkit.ai/announcements.json";
const ANNOUNCEMENT_TIMESTAMP = "2026-08-01T09:00:00.000Z";
/** The announcement's own cadence, which is slower than an error's. */
const NEWS_BEAT_MS = 2100;

/**
 * The gesture, stated once, mirroring `ERROR_GESTURE_MS` in the
 * implementation — 3400ms end to end, not the 4500 a stale note once claimed.
 */
const ERROR_BEAT_MS = 400;
const PILL_OPEN_MS = 250;
const PILL_HOLD_MS = 2500;
const PILL_CLOSE_MS = 250;
const GESTURE_MS = ERROR_BEAT_MS + PILL_OPEN_MS + PILL_HOLD_MS + PILL_CLOSE_MS;

/** The dwell reveal's own durations, mirroring `LAUNCHER_ISLAND_MS`. */
const ISLAND_CLOSE_MS = 220;

/** Words the capsule can carry, each owned by the panel it comes from. */
const RUNTIME_ERROR_WORDS = "Runtime error";
const RUN_ERROR_WORDS = "Agent run failed";
const INTELLIGENCE_OFF_WORDS = "Intelligence not connected";
const INTELLIGENCE_ON_WORDS = "Intelligence connected";

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
  /**
   * Install the fake clock before the element mounts, for the arbitration
   * suite at the foot of this file. A timer started during mount would
   * otherwise stay on the real one and never be reached.
   */
  fakeTimers?: boolean;
  /**
   * Hold the announcement feed until `releaseAnnouncement()` is called, so
   * the news signal can be armed at a chosen moment mid-test rather than
   * during mount.
   */
  announcementPending?: boolean;
}>;

type TelemetryBody = Readonly<{
  event: string;
  properties: Readonly<Record<string, unknown>>;
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

  /**
   * Arms one of the event-error signals — the second armed subject the
   * priority row of the case table needs, reached without standing up a
   * thread store. Same idiom as launcher-error-signal.spec.ts.
   */
  async emitAppError(code: CopilotKitCoreErrorCode): Promise<void> {
    await this.notifySubscribers(
      (subscriber) =>
        subscriber.onError?.({
          copilotkit: this,
          error: new Error("island lab failure"),
          code,
          context: {},
        }),
      "HUD test onError subscriber failed",
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

/** Whether the drawer — the island's list half — is on the page. */
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

/**
 * Let renders and resolved fetches land without moving the clock.
 *
 * Both branches drain microtasks and zero-delay timers, so which clock is
 * installed does not change what a caller has to write.
 */
async function settle(inspector: WebInspectorElement): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    await inspector.updateComplete;
    await Promise.resolve();
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTelemetryBody(raw: string): TelemetryBody {
  const parsed: unknown = JSON.parse(raw);
  if (
    !isRecord(parsed) ||
    typeof parsed.event !== "string" ||
    !isRecord(parsed.properties)
  ) {
    throw new Error("Telemetry request body had an unexpected shape");
  }
  return { event: parsed.event, properties: parsed.properties };
}

async function setup(options: Options = {}): Promise<{
  inspector: WebInspectorElement;
  core: IslandTestCore;
  openHud: () => Promise<void>;
  clickHud: (row: string) => Promise<void>;
  clickCapsule: () => Promise<void>;
  pressLauncher: () => Promise<void>;
  closeInspector: () => Promise<void>;
  /** Move the clock and settle. Requires `fakeTimers`. */
  advance: (ms: number) => Promise<void>;
  /** The pointer leaves the launcher. The island plays its exit. */
  leaveHud: () => Promise<void>;
  /** Keyboard dwell: focus arrives on, then departs, the launcher. */
  focusHud: () => Promise<void>;
  blurHud: () => Promise<void>;
  breakConnection: () => Promise<void>;
  healConnection: () => Promise<void>;
  fireRunError: () => Promise<void>;
  /** Publish the held announcement feed, arming the news signal mid-test. */
  releaseAnnouncement: () => Promise<void>;
  /** Every telemetry payload this component has posted, in order. */
  telemetryBodies: TelemetryBody[];
}> {
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();
  const telemetryBodies: TelemetryBody[] = [];
  let releaseAnnouncementFeed: (() => void) | null = null;
  vi.stubGlobal(
    "fetch",
    Object.assign(
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const href = new URL(
          input instanceof Request ? input.url : String(input),
          window.location.href,
        ).href;
        if (href === TELEMETRY_INGEST_URL) {
          if (typeof init?.body === "string") {
            telemetryBodies.push(parseTelemetryBody(init.body));
          }
          return new Response(null, { status: 204 });
        }
        if (href === ANNOUNCEMENT_URL) {
          if (!options.announcementPending) {
            return new Response(null, { status: 404 });
          }
          await new Promise<void>((resolve) => {
            releaseAnnouncementFeed = resolve;
          });
          return new Response(
            JSON.stringify({
              timestamp: ANNOUNCEMENT_TIMESTAMP,
              previewText: "Channels are here",
              announcement: "## Channels\n\nRead the release notes.",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(null, { status: 404 });
      }),
      globalThis.fetch,
    ),
  );

  if (options.fakeTimers) {
    // Limited to the two timer functions the launcher uses, so the
    // announcement's date handling is untouched.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  }

  const inspector = new WebInspectorElement();
  const core = new IslandTestCore(options);
  document.body.append(inspector);
  inspector.core = core;
  await core.emitStatus(CopilotKitCoreRuntimeConnectionStatus.Connected);
  await settle(inspector);

  const teardown = (): void => {
    vi.useRealTimers();
    inspector.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.body.replaceChildren();
  };
  cleanup = teardown;

  const wrapper = (): HTMLElement =>
    requireElement(
      root(inspector).querySelector<HTMLElement>(".console-button-wrapper"),
    );

  const openHud = async (): Promise<void> => {
    wrapper().dispatchEvent(
      new PointerEvent("pointerenter", { bubbles: true, composed: true }),
    );
    await settle(inspector);
  };

  const leaveHud = async (): Promise<void> => {
    wrapper().dispatchEvent(
      new PointerEvent("pointerleave", { bubbles: true, composed: true }),
    );
    await settle(inspector);
  };

  const focusHud = async (): Promise<void> => {
    wrapper().dispatchEvent(
      new FocusEvent("focusin", { bubbles: true, composed: true }),
    );
    await settle(inspector);
  };

  const blurHud = async (): Promise<void> => {
    wrapper().dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, composed: true }),
    );
    await settle(inspector);
  };

  const advance = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
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
    const pill = requireElement(
      root(inspector).querySelector<HTMLElement>("[data-cpk-launcher-capsule]"),
    );
    pill.click();
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

  const closeInspector = async (): Promise<void> => {
    const button = requireElement(
      root(inspector).querySelector<HTMLButtonElement>(
        'button[aria-label="Close Web Inspector"]',
      ),
    );
    button.click();
    await settle(inspector);
  };

  return {
    inspector,
    core,
    openHud,
    clickHud,
    clickCapsule,
    pressLauncher,
    closeInspector,
    advance,
    leaveHud,
    focusHud,
    blurHud,
    telemetryBodies,
    breakConnection: async () => {
      await core.emitStatus(CopilotKitCoreRuntimeConnectionStatus.Error);
      await settle(inspector);
    },
    healConnection: async () => {
      await core.emitStatus(CopilotKitCoreRuntimeConnectionStatus.Connected);
      await settle(inspector);
    },
    fireRunError: async () => {
      await core.emitAppError(CopilotKitCoreErrorCode.AGENT_RUN_FAILED);
      await settle(inspector);
    },
    releaseAnnouncement: async () => {
      if (releaseAnnouncementFeed === null) {
        throw new Error("This scenario has no held announcement feed");
      }
      releaseAnnouncementFeed();
      await settle(inspector);
    },
  };
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

function drawerRows(inspector: WebInspectorElement): HTMLElement[] {
  return Array.from(
    root(inspector).querySelectorAll<HTMLElement>("[data-cpk-hud-row]"),
  );
}

function capsuleHeading(inspector: WebInspectorElement): string | null {
  return (
    capsule(inspector)
      ?.querySelector("[data-cpk-capsule-heading]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ?? null
  );
}

function capsuleSubline(inspector: WebInspectorElement): string | null {
  return (
    capsule(inspector)
      ?.querySelector("[data-cpk-capsule-subline]")
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ?? null
  );
}

/**
 * The body of a rule whose selector is exactly `selector`, not one that merely
 * ends with it. `.cpk-launcher-drawer` also appears inside a descendant
 * selector earlier in the sheet, and a naive match returns that one.
 *
 * The gap between the rule boundary and the selector is `(whitespace |
 * /* comment *\/)*`, not bare `\s*`: `.cpk-launcher-capsule` sits behind a
 * multi-paragraph `/* ... *\/` doc comment, and a whitespace-only gap never
 * reaches past it, so the anchored match silently fails closed (returns
 * null) for that selector specifically.
 */
function ruleBody(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const gap = "(?:\\s|/\\*[\\s\\S]*?\\*/)*";
  const re = new RegExp(`(?:^|\\})${gap}${escaped}${gap}\\{([\\s\\S]*?)\\}`);
  return re.exec(css)?.[1] ?? null;
}

/**
 * Every rule body whose selector is exactly `selector`, in source order —
 * the `ruleBody` above returns only the first. `.console-button` itself is
 * declared twice in this stylesheet: an early rule carries layout only
 * (width/height/z-index/transition), and a second, later rule under the
 * "Floating button" comment carries paint (background, border, box-shadow).
 * A helper that stopped at the first occurrence would read the layout rule
 * and never see the paint one at all — silently checking nothing about the
 * declarations under test regardless of what they say.
 */
function allRuleBodies(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const gap = "(?:\\s|/\\*[\\s\\S]*?\\*/)*";
  const re = new RegExp(
    `(?:^|\\})${gap}${escaped}${gap}\\{([\\s\\S]*?)\\}`,
    "g",
  );
  return Array.from(css.matchAll(re)).map((m) => m[1] ?? "");
}

/**
 * The plain substring pattern `/\.cpk-launcher-drawer\s*\{.../` also matches
 * inside `.console-button-wrapper[data-cpk-hud="open"] .cpk-launcher-drawer`
 * — a compound rule that toggles visibility and sits earlier in the
 * stylesheet than the drawer's own geometry rule. Unanchored, `.exec` returns
 * that compound rule's body (pointer-events/opacity/visibility) instead of
 * the rule under test. `ruleBody` anchors the match on a rule boundary (start
 * of string or a preceding `}`), which skips any selector where
 * `.cpk-launcher-drawer` is a compound tail rather than the whole selector.
 */
function drawerRuleBody(css: string): string {
  return ruleBody(css, ".cpk-launcher-drawer") ?? "";
}

/**
 * The full body of a `@keyframes NAME { ... }` rule. Each stop inside it is
 * itself a `{ ... }` block, so `ruleBody`'s "stop at the first `}`" pattern
 * would return only the first stop's declarations rather than the whole
 * rule. This balances braces instead, walking from the rule's own opening
 * brace to its matching close.
 */
function keyframesBody(css: string, name: string): string {
  const start = css.indexOf(`@keyframes ${name}`);
  if (start === -1) return "";
  const braceStart = css.indexOf("{", start);
  if (braceStart === -1) return "";
  let depth = 0;
  for (let i = braceStart; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(braceStart + 1, i);
    }
  }
  return "";
}

/**
 * The `clip-path` declared on one stop — `"0%"` or `"100%"` — of a keyframes
 * body, whitespace collapsed to single spaces so a `calc()` expression
 * wrapped across several source lines compares equal to the same expression
 * written on one line.
 */
function clipPathAtStop(body: string, stop: "0%" | "100%"): string {
  const match = new RegExp(
    `${stop}\\s*\\{[\\s\\S]*?clip-path:\\s*([\\s\\S]*?);`,
  ).exec(body);
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

type ClipSide = "top" | "right" | "bottom" | "left";

/**
 * The `--cpk-island-clip-*` declarations actually present in one rule body,
 * keyed by side. The island's closed shape is no longer stated once per
 * direction inside a keyframe; it is composed from whichever of these
 * declarations apply, on the very rules that pin the island to a corner (see
 * the comment above the corner test below). A rule that only overrides one
 * axis — the vertical drop, or the horizontal side — legitimately leaves the
 * other two keys absent here rather than present-but-wrong, which is what
 * lets the corner-composing test merge exactly the rules that apply, the
 * same way the cascade does, instead of re-deriving the cascade itself.
 */
function clipProps(body: string): Partial<Record<ClipSide, string>> {
  const props: Partial<Record<ClipSide, string>> = {};
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const match = new RegExp(`--cpk-island-clip-${side}:\\s*([^;]+);`).exec(
      body,
    );
    const value = match?.[1];
    if (value !== undefined) props[side] = value.replace(/\s+/g, " ").trim();
  }
  return props;
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

  const drawerRule = drawerRuleBody(css);
  // The drawer is the capsule's sibling surface, not a second one: it reads
  // the same wrapper tokens rather than restating the colours, so spec
  // decisions 1 and 5 (one surface, shared by every launcher-opened piece)
  // hold for the drawer too, not just the capsule.
  expect(drawerRule).toContain("var(--cpk-launcher-face)");
  expect(drawerRule).toContain("var(--cpk-launcher-edge)");
  expect(drawerRule).not.toContain("color-mix");
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

  const drawerRule = drawerRuleBody(css);
  // The drawer reads the same shared width token as the capsule, so the two
  // stay flush by construction (spec decision 9) rather than by two literals
  // that happen to agree today.
  expect(drawerRule).toContain("width: var(--cpk-launcher-island)");
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

  const drawerRule = drawerRuleBody(css);
  // Same derived expression on the drawer: its corners stay exactly as round
  // as the circle the launcher opens from, at every size the clamp produces.
  expect(drawerRule).toContain(
    "border-radius: calc(var(--cpk-launcher-size) / 2)",
  );
});

test("the drawer reserves a band the launcher mark sits in", async () => {
  const { inspector } = await setup();
  const css = stylesheetText(inspector);
  const drawerRule = drawerRuleBody(css);
  // Self-check on the helper: `border-radius` only appears on the drawer's
  // own standalone rule, not on the earlier compound
  // `.console-button-wrapper[data-cpk-hud="open"] .cpk-launcher-drawer`
  // visibility toggle. If `drawerRuleBody` ever regressed to matching that
  // compound rule again, this would fail before the padding assertion below
  // got a chance to fail on the same wrong body.
  expect(drawerRule).toContain(
    "border-radius: calc(var(--cpk-launcher-size) / 2)",
  );
  // On main the first HUD row's top was 39px against a mark bottom of 62px -
  // 23px of overlap - and the mark's z-index swallowed the click, so a row
  // that looked like a link was not one. The fix is a top padding band sized
  // to clear the mark plus a margin, not a row that happens to sit lower.
  //
  // jsdom performs no layout: a getBoundingClientRect version of this test
  // would read {0,0,0,0} for both the row and the mark, always report an
  // overlap (0 <= 0), and never fail no matter what the CSS says. Reading
  // the declaration itself is the only way this suite can see the band.
  expect(drawerRule).toContain("padding: calc(var(--cpk-launcher-size) + 6px)");
});

test("the drawer and the capsule share a top edge and a width", async () => {
  const { inspector } = await setup();
  const css = stylesheetText(inspector);
  const drawerRule = drawerRuleBody(css);
  const capsuleRule =
    /\.cpk-launcher-capsule\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
  for (const rule of [drawerRule, capsuleRule]) {
    expect(rule).toContain("top: 50%");
    expect(rule).toContain("margin-top: calc(var(--cpk-launcher-size) / -2)");
    expect(rule).toContain("width: var(--cpk-launcher-island)");
  }
});

test("the drawer names two services and nothing else, Intelligence having left for the capsule's title", async () => {
  const { inspector, openHud } = await setup({ intelligence: true });
  await openHud();
  // A real DOM assertion, not a stylesheet one: jsdom matches selectors even
  // though it lays nothing out, so querySelectorAll and .dataset both work.
  expect(drawerRows(inspector).map((row) => row.dataset.cpkHudRow)).toEqual([
    "threads",
    "learning",
  ]);
});

test("rows carry no help button and no detail paragraph", async () => {
  const { inspector, openHud } = await setup({ intelligence: true });
  await openHud();
  // The pre-drawer HUD had a per-row help affordance and an expandable
  // detail paragraph; the drawer replaced both with a single click target.
  // If either ever reappears in markup, it should be a deliberate decision,
  // not a leftover from the old row template.
  expect(root(inspector).querySelector(".cpk-launcher-hud__help")).toBeNull();
  expect(root(inspector).querySelector(".cpk-launcher-hud__detail")).toBeNull();
});

/** Every `cpk-launcher-*` class actually carried by an element in `shadow`. */
function launcherDomClasses(shadow: ShadowRoot): Set<string> {
  return new Set(
    Array.from(shadow.querySelectorAll<HTMLElement>('[class*="cpk-launcher-"]'))
      .flatMap((el) => Array.from(el.classList))
      .filter((c) => c.startsWith("cpk-launcher-")),
  );
}

/** Every `data-cpk-*` attribute name actually carried by an element in `shadow`. */
function launcherDomAttributes(shadow: ShadowRoot): Set<string> {
  return new Set(
    Array.from(shadow.querySelectorAll<HTMLElement>("*")).flatMap((el) =>
      Array.from(el.attributes)
        .map((attr) => attr.name)
        .filter((name) => /^data-cpk-[\w-]+$/.test(name)),
    ),
  );
}

test("the drawer has a rule for each side it can open on", async () => {
  const { inspector } = await setup();
  const css = stylesheetText(inspector);
  // This is the hole the class scan below cannot see: its regex stops at
  // `[`, so `.cpk-launcher-drawer[data-cpk-drawer-side="right"]` only ever
  // contributes the reachable class `cpk-launcher-drawer`. Rename the
  // attribute in the stylesheet alone and every one of this file's other
  // tests — all 617 of them — stays green, while the renamed rule matches no
  // element: the right-opening drawer falls through to the base rule's
  // `right: 0` and renders roughly 210px off the left edge of the viewport,
  // for exactly the reader the direction-by-room rule exists to protect.
  // Pinning both rules' bodies directly closes that gap.
  const rightRule = ruleBody(
    css,
    '.cpk-launcher-drawer[data-cpk-drawer-side="right"]',
  );
  expect(rightRule, "no rule for the right-opening drawer").not.toBeNull();
  expect(rightRule).toContain("left: 0");
  expect(rightRule).toContain("right: auto");

  // The base rule is the left-opening default: no `data-cpk-drawer-side`
  // attribute at all resolves here, and it must still anchor the drawer to
  // the right edge for that default to mean anything.
  const baseRule = drawerRuleBody(css);
  expect(baseRule).toContain("right: 0");
});

test("every launcher rule reaches an element, and every launcher element has a rule", async () => {
  // No single state renders the whole island, so this guard has to look at
  // the union of two states rather than one:
  //
  // - The capsule is a gesture surface: `renderLauncherCapsule` only returns
  //   markup while `gestureSignal` and `pillPhase` are set, which nothing
  //   about a bare hover does. It needs an armed runtime error.
  // - The drawer is a dwell surface: `renderLauncherDrawer` only returns
  //   markup while `launcherHudOpen` is true, which a pointerenter dwell sets
  //   but a timed gesture never does — the drawer opens on dwell and on
  //   nothing else, which is arbitration rule 2.
  //
  // A guard that checked only one of these would quietly stop covering
  // whichever surface that state does not render — which is exactly how
  // `.cpk-launcher-capsule` went unreachable under the dwell-only version of
  // this test without the suite failing on it.

  // Dwell: a pointerenter opens the drawer.
  const dwell = await setup({ intelligence: true });
  await dwell.openHud();
  const css = stylesheetText(dwell.inspector);
  const dwellClasses = launcherDomClasses(root(dwell.inspector));

  // Gesture: an armed runtime error opens the capsule. Same idiom
  // launcher-error-signal.spec.ts uses to arm the `connection` signal:
  // `emitStatus(Error)` followed by a settle.
  const gesture = await setup({ intelligence: true });
  await gesture.core.emitStatus(CopilotKitCoreRuntimeConnectionStatus.Error);
  await settle(gesture.inspector);
  const gestureClasses = launcherDomClasses(root(gesture.inspector));

  const domClasses = new Set([...dwellClasses, ...gestureClasses]);

  // (a) No orphan rule. A selector that matches nothing is a rule that does
  // nothing, and wave 2 shipped six of them green: the stylesheet had been
  // renamed to .cpk-launcher-drawer* while the markup still said
  // .cpk-launcher-hud*, so the launcher rendered with no styling at all and
  // the suite could not see it.
  //
  // expect.soft: collect every failing class instead of stopping at the
  // first one, and — critically — instead of stopping before direction (b)
  // ever runs. The single-state version of this test threw on the first
  // unreached class and never reached (b) at all.
  const selectorClasses = new Set(
    Array.from(css.matchAll(/\.(cpk-launcher-(?:capsule|drawer)[\w-]*)/g))
      .map((m) => m[1])
      .filter((cls): cls is string => cls !== undefined),
  );
  expect(selectorClasses.size).toBeGreaterThan(0);
  for (const cls of selectorClasses) {
    expect
      .soft(domClasses.has(cls), `no element carries .${cls} in either state`)
      .toBe(true);
  }

  // (b) The mirror error: markup renamed ahead of the sheet.
  for (const cls of domClasses) {
    expect
      .soft(css, `.${cls} is rendered but has no rule`)
      .toContain(`.${cls}`);
  }

  // (c)/(d) The same join again, but over attribute NAMES rather than class
  // names. This is the half (a)/(b) above cannot see: the class regex stops
  // at `[`, so `.cpk-launcher-drawer[data-cpk-drawer-side="right"]` only
  // ever contributes the reachable class `cpk-launcher-drawer` — a
  // stylesheet-only rename of `data-cpk-drawer-side` leaves (a)/(b) green
  // while the renamed rule matches no element. The capsule's equivalent,
  // `data-cpk-capsule-direction`, is pinned directly in
  // launcher-error-signal.spec.ts; nothing pinned the drawer's, which is the
  // asymmetry this join closes.
  const dwellAttributes = launcherDomAttributes(root(dwell.inspector));
  const gestureAttributes = launcherDomAttributes(root(gesture.inspector));
  const domAttributes = new Set([...dwellAttributes, ...gestureAttributes]);

  const selectorAttributes = new Set(
    Array.from(css.matchAll(/data-cpk-[\w-]+/g)).map((m) => m[0]),
  );
  expect(selectorAttributes.size).toBeGreaterThan(0);

  // Two sheet-declared names are legitimately absent from both states here —
  // verified by reading the one code path that sets each, not assumed. Both
  // are correctly wired; this suite simply never visits the state that
  // reaches them. Neither is a rename casualty, so excluding them is not
  // silencing a hole — leaving them in would make this join flaky against
  // working code instead of catching a real regression.
  const attributesReachedByAThirdStateOnly = new Set([
    // Set only by the one-shot page-load intro preview
    // (`scheduleLauncherHudIntro`, guarded by its own start/end timers) —
    // never by `openHud()`'s pointerenter dwell path, which opens the drawer
    // without touching `launcherHudIntro`. A third, timer-gated state this
    // suite does not drive into.
    "data-cpk-hud-intro",
    // Styles `.inspector-nav-signal-dot`, the OPEN panel's sidebar
    // navigation marker (see the render call beside
    // `class="inspector-nav-signal-dot"`) — a different surface from the
    // closed launcher this file covers. Neither dwell nor gesture opens the
    // panel.
    "data-cpk-signal-tone",
  ]);
  for (const attr of selectorAttributes) {
    if (attributesReachedByAThirdStateOnly.has(attr)) continue;
    expect
      .soft(
        domAttributes.has(attr),
        `no element carries [${attr}] in either state`,
      )
      .toBe(true);
  }

  // Nine DOM-only names are excluded from the mirror direction below — every
  // one confirmed by grep to be a query hook other spec files (or this
  // component's own click handler) address by attribute selector, never a
  // CSS one, and confirmed absent from this component's stylesheet rather
  // than merely unchecked. A name added here without that same verification
  // would be silencing a real hole, not documenting one.
  const domOnlyQueryHooks = new Set([
    // Live-region marker (role="status"); the region itself carries no
    // visual styling, so nothing selects it.
    "data-cpk-launcher-announcement",
    // Boolean identity marker on the drawer root; queried by
    // launcher-hud.spec.ts and launcher-island-direction.spec.ts. The
    // `cpk-launcher-drawer` class carries the styling, this attribute does
    // not.
    "data-cpk-launcher-drawer",
    // Boolean/key identity marker on the capsule root; queried by
    // launcher-island-direction.spec.ts and launcher-error-signal.spec.ts.
    // Same split as the drawer's marker above.
    "data-cpk-launcher-capsule",
    // Row-id query hook, read by launcher-hud.spec.ts and by this
    // component's own `handleHudRowClick` closest() check.
    "data-cpk-hud-row",
    // Click-target query hook, read by launcher-hud.spec.ts and by this
    // component's own `handleHudRowClick` closest() check.
    "data-cpk-hud-action",
    // Presence marker for the row's checkmark SVG, read by
    // launcher-hud.spec.ts.
    "data-cpk-hud-check",
    // Presence marker for the row's cross SVG — the disabled-row mirror of
    // the checkmark above. Styling comes from the `.cpk-launcher-drawer__cross`
    // class (verified: four rules reference it), not from this attribute; it
    // is a query hook exactly like its sibling, for the same reason.
    "data-cpk-hud-cross",
    // Presence marker for the capsule's heading span. No selector — CSS or
    // test — currently addresses it by this attribute.
    "data-cpk-capsule-heading",
    // Presence marker for the capsule's subline span. Same as the heading
    // marker above.
    "data-cpk-capsule-subline",
    // Query hook for the decorative signal dot, read by
    // launcher-island-direction.spec.ts, launcher-error-signal.spec.ts,
    // launcher-signal.spec.ts and inspector-pop-out.spec.ts.
    "data-cpk-signal-dot",
  ]);
  for (const attr of domAttributes) {
    if (domOnlyQueryHooks.has(attr)) continue;
    expect
      .soft(css, `${attr} is rendered but no rule references it`)
      .toContain(attr);
  }
});

test("the drawer paints behind the capsule, which paints behind the mark", async () => {
  const { inspector } = await setup({ intelligence: true });
  const css = stylesheetText(inspector);
  const z = (selector: string, name: string): number => {
    const rule = ruleBody(css, selector) ?? "";
    const m = /z-index:\s*(-?\d+)/.exec(rule);
    // Absence is the failure mode, not a wrong number: an omitted z-index
    // reads as "on top" for a positioned sibling later in the DOM, which is
    // how the drawer came to paint over the mark it is supposed to sit under.
    expect(m, `${name} must declare an explicit z-index`).not.toBeNull();
    return Number(m![1]);
  };
  const drawer = z(".cpk-launcher-drawer", "the drawer");
  const capsule = z(".cpk-launcher-capsule", "the capsule");
  const mark = z(".console-button", "the launcher");
  expect(drawer).toBeLessThan(capsule);
  expect(capsule).toBeLessThan(mark);
});

test("the launcher declares its own ring instead of trusting the Tailwind border utility", async () => {
  const { inspector } = await setup();
  const css = stylesheetText(inspector);

  // The button's class list still carries Tailwind's `border` utility (it
  // also supplies unrelated resets), so a reader skimming the markup could
  // reasonably assume that utility is what draws the launcher's 1px ring.
  // It cannot be relied on for that: the generated utility is
  // `.border { border-style: var(--tw-border-style); border-width: 1px }`,
  // and `--tw-border-style` is registered by a Tailwind `@property` rule.
  // `@property` inside a stylesheet ADOPTED into a shadow root does not
  // register document-wide, so inside this component's shadow root the
  // variable was unresolved: `border-style` fell back to `none`, and CSS
  // then computes `border-width` to 0 regardless of the declared 1px. The
  // ring therefore rendered only when the HOST page happened to load
  // Tailwind v4 itself and register the property for us — on a plain host
  // page it silently vanished, with the same stylesheet bytes either way.
  // Measured live: the launcher's face against a dark host page is 1.10:1
  // (GitHub dark), indistinguishable from the page on its own, so this
  // hairline is not decoration — on that host it was the launcher's only
  // contour.
  //
  // The fix is the hand-written `.console-button` rule declaring
  // `border-width` and `border-style` itself, so the ring no longer
  // depends on what the host page happens to have loaded. That declaration
  // lives on the SECOND `.console-button` rule in this sheet — the first,
  // earlier one only carries layout (width/height/z-index/transition) — so
  // this reads every `.console-button` rule rather than just the first,
  // the same trap `ruleBody`'s own doc comment above calls out for
  // `.cpk-launcher-capsule`.
  //
  // A computed-style assertion cannot see any of this: jsdom resolves no
  // CSS off a shadow-root stylesheet, so the broken state (no declaration)
  // and the fixed state (1px solid) read back an identical computed 0px /
  // "" — only the declaration text tells them apart, which is why this
  // whole suite reads stylesheet text instead. And the assertion has to be
  // for PRESENCE, not a value: the bug was a missing declaration, not a
  // wrong one, exactly like the z-index guard just above.
  const consoleButtonRules = allRuleBodies(css, ".console-button");
  expect(
    consoleButtonRules.length,
    "expected two .console-button rules (layout, then paint)",
  ).toBeGreaterThanOrEqual(2);
  const declaresOwnRing = consoleButtonRules.some(
    (rule) =>
      /border-width:\s*1px/.test(rule) && /border-style:\s*solid/.test(rule),
  );
  expect(
    declaresOwnRing,
    "no .console-button rule declares border-width and border-style; the " +
      "ring is back to depending on the host page registering " +
      "--tw-border-style for the Tailwind `border` utility",
  ).toBe(true);
});

test("the capsule shows on dwell, titled with the Intelligence connection it is the parent of", async () => {
  // Connected: `intelligence: true` makes `CopilotKitCore.intelligence`
  // truthy, which is what the home briefing falls back to for
  // `hero.connection` while no metadata has been fetched (licenseState
  // stays "unknown" in this suite).
  const connected = await setup({ intelligence: true });
  await connected.openHud();
  expect(
    capsule(connected.inspector),
    "the capsule does not render on a bare dwell",
  ).not.toBeNull();
  expect(capsuleHeading(connected.inspector)).toBe("Intelligence connected");
  // The subline is the fixed invitation, unrelated to the connection state;
  // pinned here too so a future edit cannot satisfy the heading assertion by
  // swapping the two spans' content.
  expect(capsuleSubline(connected.inspector)).toBe("Click to open Inspector");

  // Not connected: no `intelligence` option at all.
  const disconnected = await setup();
  await disconnected.openHud();
  expect(capsuleHeading(disconnected.inspector)).toBe(
    "Intelligence not connected",
  );
  expect(capsuleSubline(disconnected.inspector)).toBe(
    "Click to open Inspector",
  );
});

test("a disabled row carries the cross, an enabled row carries the check, and the two are not the same colour", async () => {
  // No `endpoints` option: `areThreadEndpointsAvailable()` reads
  // `this._core?.threadEndpoints`, which is `undefined` here, so Threads is
  // disabled. Learning is backed by the component's own
  // `_memoriesAvailable`, which defaults to `true` and nothing here turns
  // off — so one setup produces one row of each kind.
  const { inspector, openHud } = await setup({ intelligence: true });
  await openHud();

  const rows = drawerRows(inspector);
  const threadsRow = rows.find((row) => row.dataset.cpkHudRow === "threads");
  const learningRow = rows.find((row) => row.dataset.cpkHudRow === "learning");
  if (!threadsRow || !learningRow) {
    throw new Error(
      `expected a threads row and a learning row, got ${rows
        .map((row) => row.dataset.cpkHudRow)
        .join(", ")}`,
    );
  }

  // Each row carries exactly one glyph, and it is the one that matches its
  // own state.
  expect(threadsRow.querySelector("[data-cpk-hud-cross]")).not.toBeNull();
  expect(threadsRow.querySelector("[data-cpk-hud-check]")).toBeNull();
  expect(learningRow.querySelector("[data-cpk-hud-check]")).not.toBeNull();
  expect(learningRow.querySelector("[data-cpk-hud-cross]")).toBeNull();

  // What is under test is the SHARING, not the value, same as the rest of
  // this file: the two glyphs must resolve to different colours, whatever
  // those colours are, so the on/off pair stays visually distinguishable to
  // a reader who cannot rely on the row text alone. Asserting a literal hex
  // would pass today and stay silent the day someone hardcodes the two
  // glyphs onto the same colour.
  const css = stylesheetText(inspector);
  const checkColor = /color:\s*([^;]+);/
    .exec(ruleBody(css, ".cpk-launcher-drawer__check") ?? "")?.[1]
    ?.trim();
  const crossColor = /color:\s*([^;]+);/
    .exec(ruleBody(css, ".cpk-launcher-drawer__cross") ?? "")?.[1]
    ?.trim();
  expect(checkColor, "the check has no colour rule").toBeTruthy();
  expect(crossColor, "the cross has no colour rule").toBeTruthy();
  expect(crossColor).not.toBe(checkColor);
});

test("the closed island clips to exactly the mark's footprint at every corner, and the open island clips to none of it", async () => {
  const { inspector } = await setup();
  const css = stylesheetText(inspector);

  // The mark can now be at any of four corners (the island flips up as well
  // as sideways), and the naive way to spell that would be four closed
  // shapes inside the keyframes — doubling the two this suite used to pin.
  // Instead the shape moved OUT of the keyframes entirely: each rule that
  // pins the island to an edge — the base rule (the resting corner), the
  // vertical override for `drop="up"`, and the horizontal override for
  // `side="right"` (once per surface, since the capsule reads its own
  // direction attribute and the drawer its own side attribute for the one
  // `placement.side` answer) — declares the `--cpk-island-clip-*` properties
  // for the edge(s) it owns. A shared rule then composes all four into one
  // property, `--cpk-island-closed`, which the resting `clip-path` and both
  // keyframes read.
  //
  // That is why the shape lives on the corner rules rather than inside the
  // keyframes: the corner a keyframe closes into is decided by the very same
  // declaration block that pins the island to that corner, so the two
  // cannot name different corners the way two independently-written
  // literals could — and it is what lets four corners share two keyframes
  // instead of eight.

  const FULL = "calc(100% - var(--cpk-launcher-size))";

  // The base rule: shared by the capsule and the drawer, and the only rule
  // that gives all four properties an unconditional value — the resting
  // corner, side="left"/drop="down", mark at the island's top-right. It also
  // composes them into `--cpk-island-closed` and is what the resting
  // `clip-path` reads, so this one rule is both a corner declaration and the
  // shared composition site.
  const baseRule =
    /\.cpk-launcher-capsule,\s*\.cpk-launcher-drawer\s*\{([\s\S]*?)\}/.exec(
      css,
    )?.[1] ?? "";
  const base = clipProps(baseRule);
  expect(base.top, "base rule: --cpk-island-clip-top").toBe("0");
  expect(base.right, "base rule: --cpk-island-clip-right").toBe("0");
  expect(base.bottom, "base rule: --cpk-island-clip-bottom").toBe(FULL);
  expect(base.left, "base rule: --cpk-island-clip-left").toBe(FULL);
  expect(baseRule).toContain("clip-path: var(--cpk-island-closed)");

  // The vertical override: shared by both surfaces, and the only rule that
  // touches top/bottom for the "up" drop — one of the two NEW corners this
  // suite never had to cover before. It knows nothing about which side the
  // island opens toward, so it must leave left/right alone.
  const dropUpRule =
    /\.cpk-launcher-capsule\[data-cpk-island-drop="up"\],\s*\.cpk-launcher-drawer\[data-cpk-island-drop="up"\]\s*\{([\s\S]*?)\}/.exec(
      css,
    )?.[1] ?? "";
  const dropUp = clipProps(dropUpRule);
  expect(dropUp.top, "drop=up rule: --cpk-island-clip-top").toBe(FULL);
  expect(dropUp.bottom, "drop=up rule: --cpk-island-clip-bottom").toBe("0");

  // The horizontal override, once per surface — the capsule and the drawer
  // read different attributes for the same one `placement.side` answer, so
  // there are two rules, and the two must still agree: they draw the same
  // corner of the same object.
  const capsuleRight = clipProps(
    ruleBody(
      css,
      '.cpk-launcher-capsule[data-cpk-capsule-direction="right"]',
    ) ?? "",
  );
  const drawerRight = clipProps(
    ruleBody(css, '.cpk-launcher-drawer[data-cpk-drawer-side="right"]') ?? "",
  );
  for (const [name, rule] of [
    ["capsule", capsuleRight],
    ["drawer", drawerRight],
  ] as const) {
    expect(rule.left, `${name} side=right rule: --cpk-island-clip-left`).toBe(
      "0",
    );
    expect(rule.right, `${name} side=right rule: --cpk-island-clip-right`).toBe(
      FULL,
    );
  }

  // Compose the four corners exactly as the cascade does: the base supplies
  // every property, and each override wins only the two it actually
  // declares. Built from the values already asserted above, not from a
  // second, independent set of literals — these are what the rules just
  // checked actually produce together, the same as a reader's browser would
  // compose them.
  const corners = {
    "top-right (side=left, drop=down, the default)": { ...base },
    "top-left (side=right, drop=down)": { ...base, ...capsuleRight },
    "bottom-right (side=left, drop=up)": { ...base, ...dropUp },
    "bottom-left (side=right, drop=up)": {
      ...base,
      ...capsuleRight,
      ...dropUp,
    },
  };

  // The two "up" corners are exactly where a mistake would hide: they are
  // new, and a copy-paste that carried the "down" rule's values into the
  // "up" rule (or the reverse) would leave every individual assertion above
  // satisfied — each declared value would still be "0" or the mark's own
  // size — while two of these four supposedly different corners were
  // secretly the same rectangle. Only comparing the composed results catches
  // that; an island whose closed frame left more than the mark's own corner
  // visible would not be a circle opening out, it would be a second surface
  // appearing before the reveal even starts.
  const shapes = Object.values(corners).map((clip) =>
    [clip.top, clip.right, clip.bottom, clip.left].join("|"),
  );
  expect(
    new Set(shapes).size,
    `expected four distinct corners, got: ${Object.keys(corners)
      .map((name, i) => `${name} = ${shapes[i]}`)
      .join("; ")}`,
  ).toBe(4);

  // The composed property is what both the resting clip (asserted above) and
  // both keyframes read — never a hardcoded corner of their own, which is
  // the only thing that keeps the shape and the anchor from drifting apart.
  const openKeyframes = keyframesBody(css, "cpk-launcher-island-open");
  const closeKeyframes = keyframesBody(css, "cpk-launcher-island-close");
  expect(openKeyframes, "cpk-launcher-island-open is missing").not.toBe("");
  expect(closeKeyframes, "cpk-launcher-island-close is missing").not.toBe("");

  expect(clipPathAtStop(openKeyframes, "0%")).toBe("var(--cpk-island-closed)");
  expect(clipPathAtStop(closeKeyframes, "100%")).toBe(
    "var(--cpk-island-closed)",
  );

  // The open end of the reveal is still the whole island, held back on no
  // side at all, rounded by the launcher's own radius rather than a bare
  // pixel that would agree with the circle only at one clamp width.
  const openClip = "inset(0 0 0 0 round calc(var(--cpk-launcher-size) / 2))";
  expect(clipPathAtStop(openKeyframes, "100%")).toBe(openClip);
  expect(clipPathAtStop(closeKeyframes, "0%")).toBe(openClip);
});

// `handlePillClick` fires for the capsule in both of its states (see
// `renderLauncherCapsule`), and the two states disagree about where a click
// should land: a running gesture already carries its own `landingTarget` and
// must keep it, while the dwell state — the one under test here — is the
// capsule reading Intelligence's own connection back to the reader, and only
// when that reading is "not connected" does the capsule steer the click to
// Home, because Home is where Intelligence gets set up.
//
// A test that opens a fresh Inspector and checks for "home" proves nothing:
// a brand-new instance defaults to Home regardless of what clicked it, so
// both the routed and the unrouted outcome look identical. Each test below
// first drives the reader to a menu that is NOT Home (Threads, via a HUD row
// — a landing mechanism already covered elsewhere in this suite) and closes
// the Inspector, leaving `selectedMenu` sitting on that other view exactly as
// the plain launcher mark would leave it. Only then does it dwell-open the
// HUD and click the capsule, so a pass can only mean the capsule actually
// decided the destination one way or the other.
test("the disconnected dwell capsule routes to Home even off a different starting view", async () => {
  const { inspector, openHud, clickHud, closeInspector, clickCapsule } =
    await setup(); // no `intelligence` option: disconnected.

  await openHud();
  await clickHud("threads");
  expect(currentMenu(inspector), "setup: expected to land on Threads").toBe(
    "threads",
  );

  await closeInspector();
  await openHud();
  expect(capsuleHeading(inspector)).toBe("Intelligence not connected");

  await clickCapsule();
  expect(currentMenu(inspector)).toBe("home");
});

test("the connected dwell capsule opens without forcing Home, leaving the reader's view alone", async () => {
  const { inspector, openHud, clickHud, closeInspector, clickCapsule } =
    await setup({ intelligence: true }); // connected.

  await openHud();
  await clickHud("threads");
  expect(currentMenu(inspector), "setup: expected to land on Threads").toBe(
    "threads",
  );

  await closeInspector();
  await openHud();
  expect(capsuleHeading(inspector)).toBe("Intelligence connected");

  await clickCapsule();
  // Not Home: the capsule stayed neutral and reopened wherever the reader
  // already was, exactly as the plain launcher mark does.
  expect(currentMenu(inspector)).toBe("threads");
});

// ── Arbitration: two drivers, one island ──────────────────────────────────
//
// One test per row of the spec's case table, plus the two silences the dwell
// driver owes.
//
// The split under test: a SIGNAL is event-shaped (it has a moment, so it beats,
// speaks and self-closes) and a DWELL is state-shaped (it has no moment, so it
// announces nothing, counts nothing, and ends only when the reader leaves).
// Capsule and drawer are two slots arbitrated apart — the driver decides how
// the island opens, the armed signal decides what the capsule says.
//
// Every assertion below reads rendered attributes and text, never a private
// field, so the shape of the state machine behind them stays free to change.

/** Which subject the capsule names, or null when there is no capsule. */
function capsuleSubject(inspector: WebInspectorElement): string | null {
  return capsule(inspector)?.getAttribute("data-cpk-launcher-capsule") ?? null;
}

/**
 * The gesture's phase attribute, which drives the timed reveal and its static
 * hold. Absent whenever the dwell is the one opening the capsule.
 */
function capsulePhase(inspector: WebInspectorElement): string | null {
  return capsule(inspector)?.getAttribute("data-cpk-capsule-phase") ?? null;
}

/** The dwell reveal's phase, shared by both halves of the island. */
function islandPhase(inspector: WebInspectorElement): string | null {
  return capsule(inspector)?.getAttribute("data-cpk-island-phase") ?? null;
}

/** Whether a beat is in flight on the launcher right now. */
function beating(inspector: WebInspectorElement): boolean {
  return (
    launcherButton(inspector).getAttribute("data-cpk-signal-pulsing") === "true"
  );
}

/** Which subject owns the resting dot, or null when the launcher is quiet. */
function dotSubject(inspector: WebInspectorElement): string | null {
  return (
    root(inspector)
      .querySelector("[data-cpk-signal-dot]")
      ?.getAttribute("data-cpk-signal-dot") ?? null
  );
}

/** What the launcher has put into its polite live region, if anything. */
function spoken(inspector: WebInspectorElement): string {
  return (
    root(inspector)
      .querySelector("[data-cpk-launcher-announcement]")
      ?.textContent?.trim() ?? ""
  );
}

function errorImpressions(bodies: TelemetryBody[]): TelemetryBody[] {
  return bodies.filter(
    (body) => body.event === TELEMETRY_EVENTS.errorSignalViewed,
  );
}

/**
 * Advances `total` in slices, asserting no beat is in flight after any of them.
 *
 * The slice is deliberately shorter than the 400ms error cadence: a single
 * long advance runs a whole beat start-to-finish inside itself and comes back
 * to a quiet launcher, so it cannot tell "never beat" from "beat while nobody
 * was looking" — and "the launcher never twitched" is precisely the claim
 * decisions 12 and 13 make.
 */
const BEAT_SAMPLE_MS = 200;

async function advanceWithoutBeating(
  context: {
    inspector: WebInspectorElement;
    advance: (ms: number) => Promise<void>;
  },
  total: number,
): Promise<void> {
  const steps = Math.ceil(total / BEAT_SAMPLE_MS);
  for (let step = 0; step < steps; step += 1) {
    await context.advance(BEAT_SAMPLE_MS);
    expect(
      beating(context.inspector),
      `a beat ran ${(step + 1) * BEAT_SAMPLE_MS}ms into a window that must stay still`,
    ).toBe(false);
  }
}

// Row 1 — Nothing armed, no dwell: capsule —, drawer —, beat —.
test("case table: with nothing armed and nobody hovering, the launcher shows neither half", async () => {
  const { inspector } = await setup({ intelligence: true });

  expect(capsule(inspector), "a capsule with nothing to say").toBeNull();
  expect(hudOpen(inspector), "a drawer nobody asked for").toBe(false);
  expect(beating(inspector)).toBe(false);
  expect(dotSubject(inspector)).toBeNull();
});

// Row 2 — Signal fires, no dwell: capsule = the signal's pillLabel, drawer —,
// beat yes, then the whole thing self-closes.
test("case table: a signal firing with nobody hovering beats, shows its words alone, and closes itself", async () => {
  const context = await setup({ fakeTimers: true });
  await context.breakConnection();

  // The beat says *here*.
  expect(beating(context.inspector)).toBe(true);
  expect(hudOpen(context.inspector), "a timed gesture opened the drawer").toBe(
    false,
  );

  // Then the pill says *this*.
  await context.advance(ERROR_BEAT_MS + PILL_OPEN_MS);
  expect(capsuleHeading(context.inspector)).toBe(RUNTIME_ERROR_WORDS);
  expect(capsuleSubject(context.inspector)).toBe("connection");
  expect(capsulePhase(context.inspector)).toBe("holding");
  expect(
    hudOpen(context.inspector),
    "arbitration rule 2: the drawer opens only on dwell",
  ).toBe(false);

  // And it ends on its own clock, leaving the dot behind.
  await context.advance(PILL_HOLD_MS + PILL_CLOSE_MS);
  expect(capsule(context.inspector)).toBeNull();
  expect(dotSubject(context.inspector)).toBe("connection");
});

// Row 3 — Dwell, nothing armed: capsule = the services summary, drawer = the
// services, no beat.
test("case table: a dwell with nothing armed opens the summary over the services", async () => {
  const { inspector, openHud } = await setup({ intelligence: true });
  await openHud();

  expect(capsuleHeading(inspector)).toBe(INTELLIGENCE_ON_WORDS);
  expect(capsuleSubject(inspector)).toBe("intelligence");
  expect(islandPhase(inspector)).toBe("open");
  expect(hudRowLabels(inspector)).toEqual([
    "Threads disabled",
    "Learning enabled",
  ]);
  expect(beating(inspector)).toBe(false);
});

// Row 4 — Dwell begins during a running gesture: capsule keeps the signal's
// pillLabel, the drawer opens, and the clock stops.
//
// This is the first of the two defects. `openLauncherHud` used to refuse
// outright while `gestureSignal` was set, so a hover during the 3.4 seconds
// after a failure opened nothing at all — the reader looking where the
// launcher just asked them to look, and getting silence.
test("case table: hovering during a running gesture opens the drawer and keeps the signal's words", async () => {
  const context = await setup({ intelligence: true, fakeTimers: true });
  await context.breakConnection();
  await context.advance(ERROR_BEAT_MS + PILL_OPEN_MS);
  expect(capsulePhase(context.inspector), "setup: mid-gesture").toBe("holding");

  await context.openHud();

  expect(
    hudOpen(context.inspector),
    "the drawer stayed shut under a hover because a gesture was running",
  ).toBe(true);
  expect(hudRowLabels(context.inspector)).toEqual([
    "Threads disabled",
    "Learning enabled",
  ]);
  // The words are the failure's, not the summary's: the reader hovered
  // *because* of the signal.
  expect(capsuleHeading(context.inspector)).toBe(RUNTIME_ERROR_WORDS);
  expect(capsuleSubject(context.inspector)).toBe("connection");
  // And the island is opening on the dwell's reveal, not holding on the
  // gesture's — one surface, one animation.
  expect(islandPhase(context.inspector)).toBe("open");
  expect(capsulePhase(context.inspector)).toBeNull();
});

// Row 4, second half — the clock stops.
//
// WCAG 2.1 SC 1.4.13 requires hover-triggered content to stay until the
// pointer leaves or the reader dismisses it. `beginGestureTail` used to end
// with `closeLauncherHud()`, and the hold used to expire on its own timer, so
// the island vanished from under the pointer either way.
test("case table: nothing times out under a dwelling pointer, however long it stays", async () => {
  const context = await setup({ intelligence: true, fakeTimers: true });
  await context.breakConnection();
  await context.advance(ERROR_BEAT_MS);
  await context.openHud();

  // Well past the whole 3400ms gesture, and past its hold several times over.
  await advanceWithoutBeating(context, GESTURE_MS * 3);

  expect(
    capsuleHeading(context.inspector),
    "the capsule timed out under the pointer",
  ).toBe(RUNTIME_ERROR_WORDS);
  expect(
    hudOpen(context.inspector),
    "the drawer timed out under the pointer",
  ).toBe(true);
  expect(islandPhase(context.inspector)).toBe("open");
  // The sentence is the third thing on the gesture's clock, and it is the one
  // that shows the clock really stopped rather than merely going unseen:
  // the capsule's words survive a gesture that ends underneath them, because
  // the dwell would go on supplying them from the armed signal. The live
  // region would not. A screen-reader user who focused the launcher as the
  // failure arrived must not have the announcement retracted while they are
  // still standing on it.
  expect(
    spoken(context.inspector),
    "the gesture ended under the pointer and took its sentence with it",
  ).toBe(RUNTIME_ERROR_WORDS);

  // And it ends when the reader does, not before.
  await context.leaveHud();
  await context.advance(ISLAND_CLOSE_MS);
  expect(spoken(context.inspector)).toBe("");
});

// Row 5 — Signal fires during dwell: the capsule swaps to the pillLabel, the
// drawer is unchanged, and there is NO beat (decision 12).
test("case table: a signal arriving during a dwell swaps the words in without beating", async () => {
  const context = await setup({ intelligence: true, fakeTimers: true });
  await context.openHud();
  expect(capsuleHeading(context.inspector)).toBe(INTELLIGENCE_ON_WORDS);
  const rowsBefore = hudRowLabels(context.inspector);

  await context.breakConnection();

  expect(capsuleHeading(context.inspector)).toBe(RUNTIME_ERROR_WORDS);
  expect(capsuleSubject(context.inspector)).toBe("connection");
  expect(
    beating(context.inspector),
    "decision 12: the launcher twitched under an aiming pointer",
  ).toBe(false);
  expect(
    hudOpen(context.inspector),
    "the drawer closed under the pointer when the signal arrived",
  ).toBe(true);
  expect(hudRowLabels(context.inspector), "the drawer's list changed").toEqual(
    rowsBefore,
  );
  expect(islandPhase(context.inspector)).toBe("open");

  // Not one beat, at any point in the window a gesture would have occupied.
  await advanceWithoutBeating(context, GESTURE_MS);
  expect(capsuleHeading(context.inspector)).toBe(RUNTIME_ERROR_WORDS);

  // And the gesture it never ran does not run on the way out either.
  await context.leaveHud();
  await context.advance(ISLAND_CLOSE_MS);
  expect(capsule(context.inspector)).toBeNull();
  await advanceWithoutBeating(context, GESTURE_MS);
  expect(capsule(context.inspector)).toBeNull();
  expect(dotSubject(context.inspector)).toBe("connection");
});

// Row 6 — Signal resolves during dwell: the capsule falls back to the summary,
// the drawer is unchanged, and no beat.
test("case table: a signal healing during a dwell falls back to the summary in place", async () => {
  const context = await setup({ intelligence: true, fakeTimers: true });
  await context.openHud();
  await context.breakConnection();
  expect(capsuleHeading(context.inspector), "setup: showing the failure").toBe(
    RUNTIME_ERROR_WORDS,
  );
  const rowsBefore = hudRowLabels(context.inspector);

  await context.healConnection();

  expect(capsuleHeading(context.inspector)).toBe(INTELLIGENCE_ON_WORDS);
  expect(capsuleSubject(context.inspector)).toBe("intelligence");
  expect(hudOpen(context.inspector)).toBe(true);
  expect(hudRowLabels(context.inspector)).toEqual(rowsBefore);
  // OSS-903 decision 5: a recovery is not announced, and it does not close
  // the island the reader is still reading.
  expect(beating(context.inspector)).toBe(false);
  expect(spoken(context.inspector)).toBe("");
  expect(dotSubject(context.inspector)).toBeNull();
  await advanceWithoutBeating(context, GESTURE_MS);
  expect(hudOpen(context.inspector)).toBe(true);
});

// Row 7 — Dwell ends after a signal was shown in it: capsule —, drawer —, and
// NO beat at all (decision 13). The dot stays lit, because the signal is
// still armed: what is lost is the announcement, not the information.
test("case table: a dwell that showed a signal does not replay the gesture when the pointer leaves", async () => {
  const context = await setup({ intelligence: true, fakeTimers: true });
  // A real gesture, parked mid-flight by the pointer arriving on it. This is
  // the case decision 13 is actually about: there IS a suspended sequence,
  // and the temptation is to let it finish once the reader steps away.
  await context.breakConnection();
  await context.advance(ERROR_BEAT_MS);
  await context.openHud();
  expect(
    capsuleHeading(context.inspector),
    "setup: parked under the pointer",
  ).toBe(RUNTIME_ERROR_WORDS);

  await context.leaveHud();
  await context.advance(ISLAND_CLOSE_MS);

  // The island leaves once and stays gone. It does not hand back to the
  // gesture it interrupted.
  expect(
    capsule(context.inspector),
    "decision 13: the parked gesture resumed as the island left",
  ).toBeNull();
  expect(hudOpen(context.inspector)).toBe(false);
  expect(spoken(context.inspector)).toBe("");
  // The whole gesture's worth of clock, twice over, and nothing runs.
  await advanceWithoutBeating(context, GESTURE_MS * 2);
  expect(
    capsule(context.inspector),
    "decision 13: the timed gesture replayed after the pointer left",
  ).toBeNull();
  // The information did not go anywhere.
  expect(dotSubject(context.inspector)).toBe("connection");
});

// The same row through the keyboard, because focus is the other half of the
// dwell driver and SC 1.4.13 covers both.
test("case table: focus dwells and blur ends it, on the same terms as the pointer", async () => {
  const context = await setup({ intelligence: true, fakeTimers: true });
  await context.breakConnection();
  await context.advance(ERROR_BEAT_MS);

  await context.focusHud();
  expect(hudOpen(context.inspector)).toBe(true);
  expect(capsuleHeading(context.inspector)).toBe(RUNTIME_ERROR_WORDS);
  await advanceWithoutBeating(context, GESTURE_MS * 2);
  expect(hudOpen(context.inspector), "focus did not hold the clock").toBe(true);

  await context.blurHud();
  expect(hudOpen(context.inspector)).toBe(false);
  expect(
    capsule(context.inspector),
    "decision 13: the parked gesture resumed the moment focus left",
  ).toBeNull();
  await advanceWithoutBeating(context, GESTURE_MS);
  expect(capsule(context.inspector)).toBeNull();
  expect(dotSubject(context.inspector)).toBe("connection");
});

// Row 8 — Two signals armed: the higher `priority` wins the capsule.
test("case table: with two signals armed the higher priority owns the capsule, whichever armed first", async () => {
  // `run` (priority 3) first, then `connection` (priority 5) over the top.
  const rising = await setup({ intelligence: true, fakeTimers: true });
  await rising.openHud();
  await rising.fireRunError();
  expect(capsuleHeading(rising.inspector), "setup: the lesser failure").toBe(
    RUN_ERROR_WORDS,
  );
  await rising.breakConnection();
  expect(capsuleHeading(rising.inspector)).toBe(RUNTIME_ERROR_WORDS);
  expect(capsuleSubject(rising.inspector)).toBe("connection");
  rising.inspector.remove();

  // And the other order: the worse failure keeps the capsule when a lesser one
  // arms behind it.
  const falling = await setup({ intelligence: true, fakeTimers: true });
  await falling.openHud();
  await falling.breakConnection();
  await falling.fireRunError();
  expect(capsuleHeading(falling.inspector)).toBe(RUNTIME_ERROR_WORDS);
  expect(capsuleSubject(falling.inspector)).toBe("connection");
});

// The registry, not the arbitration, is what keeps the announcement out of the
// capsule: `whats-new` declares no `pillLabel`. Pinned here because the
// arbitration would otherwise be free to acquire a special case for it.
test("case table: a dwell never shows a signal that declares no capsule words", async () => {
  const { inspector, openHud } = await setup({ intelligence: true });
  await openHud();
  expect(capsuleSubject(inspector)).toBe("intelligence");
  expect(capsuleSubject(inspector)).not.toBe("whats-new");
});

// ── The two silences ──────────────────────────────────────────────────────

test("the dwell driver puts nothing into the live region, because nothing changed", async () => {
  const context = await setup({ intelligence: true, fakeTimers: true });
  expect(spoken(context.inspector)).toBe("");

  await context.openHud();
  expect(
    spoken(context.inspector),
    "a hover spoke into the polite live region",
  ).toBe("");

  // Including the case where the dwell is carrying a signal's words: the
  // signal arrived under the pointer, so it was shown rather than announced
  // (decision 13). A screen-reader user who is focused here is reading the
  // capsule, not waiting to be told about it.
  await context.breakConnection();
  expect(capsuleHeading(context.inspector)).toBe(RUNTIME_ERROR_WORDS);
  expect(spoken(context.inspector)).toBe("");

  await context.leaveHud();
  await context.advance(ISLAND_CLOSE_MS);
  expect(spoken(context.inspector)).toBe("");
});

test("the dwell driver counts no impression, because a state has no occurrences", async () => {
  const context = await setup({ intelligence: true, fakeTimers: true });

  await context.openHud();
  await context.advance(GESTURE_MS);
  await context.leaveHud();
  await context.advance(ISLAND_CLOSE_MS);
  await context.openHud();
  await context.advance(GESTURE_MS);

  expect(
    context.telemetryBodies.map((body) => body.event),
    "hovering was counted, which would make the metric measure mouse movement",
  ).toEqual([]);
});

// The mirror of the silence above, and the reason it is not a licence to drop
// the signal driver's own impression: `maybeTrackErrorSignalViewed` holds the
// event until this outage's pill question is answered, and a signal shown in
// a dwelling capsule never runs a pill. Left unanswered, the impression for
// every failure that arrives under the pointer is silently lost.
test("a signal shown in a dwelling capsule still reports its one impression", async () => {
  const context = await setup({ intelligence: true, fakeTimers: true });
  await context.openHud();
  await context.breakConnection();
  await context.advance(GESTURE_MS);

  const impressions = errorImpressions(context.telemetryBodies);
  expect(impressions).toHaveLength(1);
  expect(impressions[0]?.properties.source).toBe("connection");
  expect(impressions[0]?.properties.label).toBe("shown");
});

// Decision 12 without decision 13: a signal that declares no `pillLabel` has
// no words to swap in, so a dwell shows the reader nothing about it. Its beat
// is therefore DEFERRED rather than spent — the launcher still must not twitch
// under an aiming pointer, but the nudge is owed and gets paid when the reader
// leaves. Spending it here would silently drop the announcement's one nudge.
test("a beat with no words to show is held while the pointer is there, then runs", async () => {
  const context = await setup({
    intelligence: true,
    fakeTimers: true,
    announcementPending: true,
  });

  await context.openHud();
  await context.releaseAnnouncement();

  // Armed, dotted, and silent — the announcement never reaches the capsule.
  expect(dotSubject(context.inspector)).toBe("whats-new");
  expect(capsuleSubject(context.inspector)).toBe("intelligence");
  await advanceWithoutBeating(context, NEWS_BEAT_MS * 2);

  await context.leaveHud();
  await context.advance(ISLAND_CLOSE_MS);

  expect(
    beating(context.inspector),
    "the held beat was dropped rather than deferred",
  ).toBe(true);
});
