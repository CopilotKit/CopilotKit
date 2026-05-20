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
 * (`showcase/harness/fixtures/d5/tool-rendering.json`) contains one
 * userMessage match — `"weather in Tokyo"` — which emits a single tool
 * call (`get_weather`) on the LGP backend per its system prompt. The
 * `toolCallId`-routed fixture handles the second leg of the tool's
 * request/response. From the conversation runner's
 * perspective this is still ONE user turn — the runner sends one
 * message, waits for the assistant to settle, and runs the assertion
 * once on the resulting DOM.
 *
 * Selector cascade: the LGP reference implementation marks the weather
 * card with `data-testid="weather-card"` (see
 * `showcase/integrations/langgraph-python/src/app/demos/tool-rendering/weather-card.tsx`).
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
 *   - at least one inner element (childCount >= 1) — proxy for
 *     "non-empty structured card", since exact image/icon selectors
 *     vary by integration.
 *
 * Note: the city label ("Tokyo") is intentionally NOT asserted. Some
 * integrations render the card with only temperature + condition,
 * omitting the city name from the card element's textContent. The
 * city label is a D3 rendering-detail concern, not a D5 signal.
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
 * Maximum time (ms) to poll `probeToolCard` for a structurally complete
 * card after the conversation runner declares the turn settled. The
 * runner settles on assistant-message count stability, but the tool
 * render lifecycle (`inProgress` → `executing` → `complete`) runs
 * independently — the tool result arrives as a separate AG-UI event
 * (`TOOL_CALL_RESULT`) that may land slightly after the final text
 * message that triggered the runner's settle. Without polling, the
 * probe would snapshot the DOM once and catch the card in a loading
 * state even though the result is about to arrive.
 */
const PROBE_POLL_TIMEOUT_MS = 10_000;

/** Interval between `probeToolCard` retries. */
const PROBE_POLL_INTERVAL_MS = 200;

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
 * Check whether a probe result satisfies all structural sub-assertions:
 * numeric temperature and childCount >= 1. Returns `null` when all checks
 * pass, or a human-readable error string on the first failing check.
 * Used by both the one-shot and polling code paths.
 *
 * Note: the city label ("Tokyo") is intentionally NOT checked here.
 * Some integrations render the weather card with only temperature +
 * condition text, without the city name in the card element's
 * textContent. The card's structure (selector matched, numeric
 * temperature, childCount >= 1) is the D5-level signal that
 * tool-rendering works. Per-integration rendering details (which
 * fields appear in the card) are a D3 concern.
 */
export function validateProbe(probe: ToolCardProbeResult): string | null {
  if (probe.selector === null) {
    return "tool-rendering: expected card for `get_weather` but selector cascade matched 0 elements";
  }
  if (!/\d/.test(probe.text)) {
    return `tool-rendering: card matched ${probe.selector} but no numeric temperature found in "${probe.text.slice(0, 200)}"`;
  }
  if (probe.childCount < 1) {
    return `tool-rendering: card matched ${probe.selector} has no inner elements (childCount=0) — expected an icon / labelled block`;
  }
  return null;
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
 *   2. Poll `probeToolCard` up to `PROBE_POLL_TIMEOUT_MS`, checking
 *      after each probe whether the card satisfies all structural
 *      sub-assertions (numeric temperature, childCount >= 1). The
 *      poll loop exists because the tool
 *      render lifecycle (`inProgress` → `executing` → `complete`)
 *      is driven by the `TOOL_CALL_RESULT` AG-UI event which may
 *      arrive slightly after the text message that caused the
 *      conversation runner to declare "settled". Without polling,
 *      the probe snapshots the DOM once and catches the card in a
 *      loading state — the exact failure mode seen in the 6
 *      affected integrations.
 *   3. If the poll deadline passes without a passing probe, throw
 *      with the last validation error so the operator sees whether
 *      the failure was "no card" vs "card present but still loading".
 */
export function buildToolRenderingAssertion(opts?: {
  /** Override the poll timeout — only used by unit tests to avoid
   *  10 s waits when the fake page always returns a failing probe. */
  pollTimeoutMs?: number;
}): (page: Page) => Promise<void> {
  const pollTimeout = opts?.pollTimeoutMs ?? PROBE_POLL_TIMEOUT_MS;
  return async (page: Page): Promise<void> => {
    console.debug("[d5-tool-rendering] waiting for tool card", {
      canonicalSelector: TOOL_CARD_SELECTORS[0],
      pollTimeoutMs: pollTimeout,
    });
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
      console.debug("[d5-tool-rendering] canonical selector matched", {
        selector: TOOL_CARD_SELECTORS[0],
      });
    } catch {
      // Canonical selector didn't appear — let the cascade probe try
      // the fallbacks. A genuine "no card at all" outcome surfaces
      // through the probe result below.
      console.debug(
        "[d5-tool-rendering] canonical selector miss — trying cascade probe",
      );
    }

    // Poll probeToolCard until the card is structurally complete or
    // the deadline passes. First probe is immediate (no initial sleep).
    const deadline = Date.now() + pollTimeout;
    let lastError: string | null = null;
    let probeCount = 0;

    while (Date.now() < deadline) {
      const probe = await probeToolCard(page);
      probeCount++;
      lastError = validateProbe(probe);
      if (lastError === null) {
        // All checks passed — card is structurally complete.
        console.debug("[d5-tool-rendering] tool card structurally complete", {
          selector: probe.selector,
          text: probe.text.slice(0, 200),
          childCount: probe.childCount,
          probeAttempts: probeCount,
        });
        return;
      }
      if (probeCount === 1 || probeCount % 10 === 0) {
        console.debug("[d5-tool-rendering] tool card probe — not ready yet", {
          probeCount,
          selector: probe.selector,
          text: probe.text.slice(0, 100),
          childCount: probe.childCount,
          validationError: lastError,
        });
      }
      // Card not ready yet — sleep briefly and retry.
      await new Promise<void>((r) => setTimeout(r, PROBE_POLL_INTERVAL_MS));
    }

    console.debug("[d5-tool-rendering] tool card probe TIMEOUT", {
      probeCount,
      lastError,
    });
    // Deadline elapsed — throw the last validation error.
    throw new Error(lastError!);
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
