/**
 * D5 — `tool-rendering-custom-catchall` script.
 *
 * Phase-2A split (see `.claude/specs/lgp-test-genuine-pass.md`): the old
 * mapping pointed `tool-rendering-custom-catchall` at the
 * `d5-tool-rendering.ts` probe, which asserts a per-tool `WeatherCard`.
 * The custom catchall is a USER-supplied wildcard renderer that fires
 * for ANY tool the integration didn't register a per-tool renderer for.
 * The signal we want here is "the SAME custom wildcard testid renders
 * for two DIFFERENT tool calls" — i.e. the wildcard truly catches all
 * tools, not just one.
 *
 * Custom-catchall testid contract (Phase-1E production code, see
 * `showcase/integrations/langgraph-python/src/app/demos/tool-rendering-custom-catchall/custom-catchall-renderer.tsx`):
 *   - the user-supplied component renders a wrapper carrying
 *     `[data-testid="custom-wildcard-card"]` on every invocation,
 *     regardless of tool name.
 *   - the wrapper carries the tool name on `[data-tool-name="<name>"]`
 *     so the cross-tool snapshot can verify a SINGLE testid maps to
 *     MULTIPLE tool names.
 *
 * The probe sends two distinct prompts in sequence (driving two
 * different tool calls) and asserts both render through the same
 * `custom-wildcard-card` testid with distinct `data-tool-name`
 * values. This is the "cross-test signature snapshot" called out in
 * Phase-2A.
 *
 * Side effect: importing this module triggers `registerD5Script`. The
 * default loader in `e2e-deep.ts` discovers it via the `d5-*` filename
 * convention.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

/** Testid the custom wildcard component renders for every tool call. */
export const CUSTOM_CATCHALL_TESTID = "custom-wildcard-card";

/**
 * The two prompts we send. Each is paired with the expected tool name
 * the assistant should invoke. Verbatim match against fixture
 * `userMessage` matchers — drift would route to the live model.
 *
 * `get_weather` and `get_stock_price` are the canonical pair used
 * across the tool-rendering family (matches `tool-rendering.json` and
 * `gen-ui-headless-complete.json` patterns).
 */
export const PROMPT_TOOL_PAIRS = [
  { prompt: "weather in Tokyo", tool: "get_weather" },
  { prompt: "What's the current price of AAPL?", tool: "get_stock_price" },
] as const;

const POLL_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 250;

/**
 * Snapshot read in one round-trip: the set of tool names rendered
 * through the custom-catchall testid. The set lets the cross-tool
 * assertion verify "both tool names rendered through the SAME testid"
 * without re-reading the DOM per turn.
 */
export interface CustomCatchallProbe {
  /** Distinct tool names found on `[data-testid="custom-wildcard-card"][data-tool-name=...]`. */
  toolNames: string[];
  /** Total number of custom-catchall containers in the DOM. */
  containerCount: number;
}

export async function probeCustomCatchall(
  page: Page,
): Promise<CustomCatchallProbe> {
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(sel: string): ArrayLike<{
          getAttribute(name: string): string | null;
        }>;
      };
    };
    const containers = win.document.querySelectorAll(
      '[data-testid="custom-wildcard-card"]',
    );
    const names = new Set<string>();
    for (let i = 0; i < containers.length; i++) {
      const n = containers[i]!.getAttribute("data-tool-name");
      if (n) names.add(n);
    }
    return {
      toolNames: Array.from(names),
      containerCount: containers.length,
    };
  });
}

/**
 * Validate that BOTH expected tool names rendered through the SAME
 * custom-catchall testid. Returns null when the cross-tool snapshot
 * holds, or a human-readable error string on the first failing check.
 *
 * The checks are ordered from "no rendering at all" → "partial
 * rendering" → "wrong tools rendered" so the operator's first error
 * message is the most informative one.
 */
export function validateCustomCatchall(
  snap: CustomCatchallProbe,
  expectedToolNames: readonly string[],
): string | null {
  if (snap.containerCount === 0) {
    return (
      `tool-rendering-custom-catchall: expected [data-testid="${CUSTOM_CATCHALL_TESTID}"] ` +
      "but found 0 containers — custom wildcard renderer did not fire"
    );
  }
  const missing = expectedToolNames.filter(
    (name) => !snap.toolNames.includes(name),
  );
  if (missing.length > 0) {
    return (
      `tool-rendering-custom-catchall: custom wildcard rendered ${snap.containerCount} ` +
      `container(s) but is missing tool name(s) [${missing.join(", ")}]; ` +
      `observed: [${snap.toolNames.join(", ") || "(none)"}]`
    );
  }
  return null;
}

export async function assertCustomCatchall(
  page: Page,
  expectedToolNames: readonly string[],
  timeoutMs: number = POLL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  let pollCount = 0;
  while (Date.now() < deadline) {
    const snap = await probeCustomCatchall(page);
    pollCount++;
    lastError = validateCustomCatchall(snap, expectedToolNames);
    if (lastError === null) {
      console.debug(
        "[d5-tool-rendering-custom-catchall] cross-tool signature passed",
        { pollCount, snap },
      );
      return;
    }
    if (pollCount === 1 || pollCount % 10 === 0) {
      console.debug("[d5-tool-rendering-custom-catchall] not ready yet", {
        pollCount,
        lastError,
        snap,
      });
    }
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    lastError ?? "tool-rendering-custom-catchall: poll deadline exceeded",
  );
}

/**
 * Build the conversation turns. We send two prompts in sequence; the
 * FIRST turn asserts only that the custom wildcard fired for the
 * first tool, and the SECOND turn asserts BOTH tool names rendered
 * through the same testid (the cross-tool snapshot). Splitting like
 * this means a regression that breaks the wildcard for the SECOND
 * tool surfaces with "missing get_stock_price" rather than "missing
 * everything".
 */
export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  const allExpected = PROMPT_TOOL_PAIRS.map((p) => p.tool);
  return [
    {
      input: PROMPT_TOOL_PAIRS[0].prompt,
      assertions: (page: Page) =>
        assertCustomCatchall(page, [PROMPT_TOOL_PAIRS[0].tool]),
    },
    {
      input: PROMPT_TOOL_PAIRS[1].prompt,
      // After the second turn, BOTH tool calls must have rendered
      // through the same custom-catchall testid.
      assertions: (page: Page) => assertCustomCatchall(page, allExpected),
    },
  ];
}

export function preNavigateRoute(): string {
  return "/demos/tool-rendering-custom-catchall";
}

registerD5Script({
  featureTypes: ["tool-rendering-custom-catchall"],
  fixtureFile: "tool-rendering.json",
  buildTurns,
  preNavigateRoute,
});
