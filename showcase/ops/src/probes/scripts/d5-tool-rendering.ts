/**
 * D5 — tool-rendering script.
 *
 * Drives the `/demos/tool-rendering` page through one user turn ("weather
 * in Tokyo") and asserts the assistant invokes the `get_weather` tool
 * AND the frontend renders a structured weather card in the DOM. The
 * heart of D5 for this feature is verifying CARD STRUCTURE, not just
 * text — `e2e-smoke.ts`'s `tools:<slug>` row already covers vocabulary
 * matching, so this deeper probe checks that the per-tool renderer
 * actually produced a card element with the expected sub-pieces.
 *
 * Why a single turn: the recorded fixture
 * (`showcase/ops/fixtures/d5/tool-rendering.json`) contains one
 * userMessage match — `"weather in Tokyo"` — which fans out into TWO
 * tool calls (`get_weather` + `search_flights`) on the LGP backend per
 * its system prompt. The `toolCallId`-routed fixtures handle the second
 * leg of each tool's request/response. From the conversation runner's
 * perspective this is still ONE user turn — the runner sends one
 * message, waits for the assistant to settle, and runs the assertion
 * once on the resulting DOM.
 *
 * Selector cascade: the LGP reference implementation marks the weather
 * card with `data-testid="weather-card"` (see
 * `showcase/packages/langgraph-python/src/app/demos/tool-rendering/weather-card.tsx`).
 * Other integrations may use different testids, class names, or
 * data-attributes for the same card. We probe a 4-selector cascade so
 * the script works across the fleet without a per-integration override:
 *
 *   1. `[data-testid="weather-card"]`        — LGP canonical.
 *   2. `[data-tool-name="get_weather"]`      — alternative convention
 *                                              for integrations that key
 *                                              off the tool name rather
 *                                              than a fixed testid.
 *   3. `.copilotkit-tool-render`             — class-based fallback
 *                                              (e.g. catch-all renderers
 *                                              that wrap in a known
 *                                              CopilotKit class).
 *   4. `[data-testid="copilot-tool-render"]` — generic CopilotKit testid
 *                                              for any rendered tool.
 *
 * Failure mode: if NONE of the 4 selectors match within the timeout,
 * the assertion throws with a specific message
 * (`"tool-rendering: expected card for `get_weather` but selector
 * cascade matched 0 elements"`) so an operator triaging a red row can
 * tell "framework regression" (no card at all) from "content
 * regression" (card present, no temperature inside).
 *
 * Structural sub-assertions: once the card is found, we read its
 * textContent and child-element count and assert presence of:
 *   - a numeric temperature (any digit run),
 *   - the city label ("Tokyo" — case-insensitive substring),
 *   - at least one inner element (childCount >= 1) — proxy for
 *     "non-empty structured card", since exact image/icon selectors
 *     vary by integration.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

/**
 * Tool-card selector cascade. Order matters: the most-specific testid
 * first (LGP canonical), then progressively more generic fallbacks. A
 * matching integration ought to hit selector #1 — the cascade exists
 * for fleet resilience, not as the primary code path.
 */
export const TOOL_CARD_SELECTORS = [
  '[data-testid="weather-card"]',
  '[data-tool-name="get_weather"]',
  ".copilotkit-tool-render",
  '[data-testid="copilot-tool-render"]',
] as const;

/** Per-selector probe timeout (ms). The runner has already waited for
 * the assistant to settle, so the card SHOULD be in the DOM by now;
 * the budget covers integrations where the renderer mounts asynchronously
 * after the assistant message lands. */
const SELECTOR_PROBE_TIMEOUT_MS = 5_000;

/**
 * Result of probing the DOM for a tool card. Returned by `probeToolCard`
 * so the assertion can branch on missing-card vs structurally-deficient-
 * card with distinct error messages.
 */
export interface ToolCardProbeResult {
  /** Selector that matched (one of `TOOL_CARD_SELECTORS`), or null if none did. */
  selector: string | null;
  /** Lowercased, whitespace-collapsed textContent of the matched card. */
  text: string;
  /** Element-children count — proxy for "structured (non-empty) card". */
  childCount: number;
}

/**
 * Probe the DOM for a tool card. Iterates the cascade in the BROWSER
 * via a single `page.evaluate` so we don't make N waitForSelector
 * round-trips for selectors that don't match (each fail would burn
 * the per-probe timeout sequentially — 4 × 5 s = 20 s in the worst
 * case). Returns the first matching selector along with its
 * textContent and child-element count, or all-empty / null when
 * nothing matched.
 *
 * The selector list is interpolated into the evaluated function via
 * a string-built body. This is the canonical pattern when the runner's
 * `Page.evaluate` interface is `() => R` (no arguments) — closure
 * capture would not survive Playwright's function serialisation, so
 * we either hard-code the selector list (we do) or stash it on
 * `document.body.dataset` before the call. Hard-coding keeps the
 * function self-contained.
 */
export async function probeToolCard(page: Page): Promise<ToolCardProbeResult> {
  const result = await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): {
          textContent: string | null;
          children: { length: number };
        } | null;
      };
    };
    // Keep this list in sync with `TOOL_CARD_SELECTORS` above. We
    // can't use the closure binding because page.evaluate's function
    // body is shipped to the browser as a string; closure refs from
    // the server-side module would be undefined inside the browser.
    const selectors = [
      '[data-testid="weather-card"]',
      '[data-tool-name="get_weather"]',
      ".copilotkit-tool-render",
      '[data-testid="copilot-tool-render"]',
    ];
    for (const sel of selectors) {
      const el = win.document.querySelector(sel);
      if (el) {
        const raw = el.textContent ?? "";
        const text = raw.toLowerCase().replace(/\s+/g, " ").trim();
        return {
          selector: sel,
          text,
          childCount: el.children.length,
        };
      }
    }
    return { selector: null, text: "", childCount: 0 };
  });
  return result as ToolCardProbeResult;
}

/**
 * Build the assertion callback for a per-turn `ConversationTurn`. Exported
 * so unit tests can invoke the assertion directly against a scripted
 * Page fake without going through the runner.
 *
 * Strategy:
 *   1. Wait up to `SELECTOR_PROBE_TIMEOUT_MS` for the FIRST selector
 *      in the cascade to become visible. This gives the runner's
 *      page-load auto-wait one final settle window for the renderer to
 *      mount.
 *   2. Run an in-browser cascade probe (`probeToolCard`) to find any
 *      matching selector and read its text + childCount in one round
 *      trip.
 *   3. If no selector matched, throw with the canonical "selector
 *      cascade matched 0 elements" message.
 *   4. Otherwise assert numeric temperature, "Tokyo" label, and
 *      childCount >= 1.
 */
export function buildToolRenderingAssertion(): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    // Best-effort wait for the canonical selector. We don't fail here
    // if it times out — the cascade probe below covers integrations
    // that use a different selector. This wait exists so that, on the
    // 90% case (LGP-shaped renderer), we don't race the renderer
    // mount and immediately probe an empty DOM.
    try {
      await page.waitForSelector(TOOL_CARD_SELECTORS[0], {
        state: "visible",
        timeout: SELECTOR_PROBE_TIMEOUT_MS,
      });
    } catch {
      // Canonical selector didn't appear — let the cascade probe try
      // the fallbacks. A genuine "no card at all" outcome surfaces
      // through the probe result below.
    }

    const probe = await probeToolCard(page);

    if (probe.selector === null) {
      throw new Error(
        "tool-rendering: expected card for `get_weather` but selector cascade matched 0 elements",
      );
    }

    // Numeric temperature — any standalone digit run. Allows formats
    // like "22", "22.5", "22°", "22°F". Avoids over-fitting to a
    // particular degree symbol or unit (Celsius vs Fahrenheit varies
    // by integration).
    if (!/\d/.test(probe.text)) {
      throw new Error(
        `tool-rendering: card matched ${probe.selector} but no numeric temperature found in "${probe.text.slice(0, 200)}"`,
      );
    }

    // City label — case-insensitive substring on the request city.
    // The fixture user message is "weather in Tokyo" so the response
    // and rendered card MUST mention Tokyo somewhere.
    if (!probe.text.includes("tokyo")) {
      throw new Error(
        `tool-rendering: card matched ${probe.selector} but missing city label "Tokyo" in "${probe.text.slice(0, 200)}"`,
      );
    }

    // Structural sub-element check. A card with zero element children
    // is a string-only render — failing the "structured" expectation
    // even if it happens to mention Tokyo and a number.
    if (probe.childCount < 1) {
      throw new Error(
        `tool-rendering: card matched ${probe.selector} has no inner elements (childCount=0) — expected an icon / labelled block`,
      );
    }
  };
}

/**
 * Build the conversation turns for a tool-rendering probe. The fixture
 * has ONE userMessage match (`"weather in Tokyo"`) so `buildTurns`
 * returns a single-turn array. The `toolCallId`-routed fixtures fire
 * inside the same user turn — they handle the assistant's mid-loop
 * re-invocations after each tool returns, all within one runner turn.
 *
 * `_ctx` is unused today; reserved so a future per-integration override
 * (e.g. a backend that uses "weather in Paris") can branch on
 * `ctx.integrationSlug` without changing the function signature.
 */
export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "weather in Tokyo",
      assertions: buildToolRenderingAssertion(),
    },
  ];
}

// Side-effect registration — picked up by the e2e-deep driver's
// dynamic loader scan of `src/probes/scripts/d5-*.{js,ts}`.
registerD5Script({
  featureTypes: ["tool-rendering"],
  fixtureFile: "tool-rendering.json",
  buildTurns,
});
