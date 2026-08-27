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
  core: IslandTestCore;
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

  return { inspector, core, openHud, clickHud, pressLauncher };
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

test("the drawer names three services and nothing else", async () => {
  const { inspector, openHud } = await setup({ intelligence: true });
  await openHud();
  // A real DOM assertion, not a stylesheet one: jsdom matches selectors even
  // though it lays nothing out, so querySelectorAll and .dataset both work.
  expect(drawerRows(inspector).map((row) => row.dataset.cpkHudRow)).toEqual([
    "threads",
    "intelligence",
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
  //   but an armed error does not (arming a signal closes the hud).
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
