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
 * default loader in `d6-all-pills.ts` discovers it via the `d5-*` filename
 * convention.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
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
 *
 * **LGP-gold disjoint-prompts pattern** — these prompts MUST stay
 * disjoint from `d5-tool-rendering-default-catchall.ts`'s prompts so
 * aimock's `userMessage` substring matcher cannot cross-route a
 * default-catchall request to a custom-catchall fixture (or vice
 * versa) regardless of fixture file sort order. Supersedes PR #5465
 * which attempted to remove the `toolName` discriminator without
 * adding a replacement (cross-fixture leakage). See
 * `/tmp/cross-fixture-leak-investigation.md` for the full root-cause
 * trail.
 */
export const PROMPT_TOOL_PAIRS = [
  {
    prompt: "Forecast Tokyo through the wildcard renderer",
    tool: "get_weather",
  },
  {
    prompt: "Quote AAPL through the wildcard renderer",
    tool: "get_stock_price",
  },
] as const;

/**
 * Page text content the custom wildcard renderer's follow-up
 * fixtures emit. Asserted by the probe so a cross-fixture leak (a
 * default-catchall fixture servicing a custom-catchall request) is
 * caught at the content layer — testid-only assertions cannot catch
 * it because the `[data-testid="custom-wildcard-card"]` wrapper
 * mounts identically regardless of which file's content arrived.
 */
export const CUSTOM_CATCHALL_CONTENT_PHRASE =
  "rendered through the custom wildcard catchall";

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
  /**
   * True when at least one assistant message bubble on the page
   * contains the custom-catchall content phrase
   * (`CUSTOM_CATCHALL_CONTENT_PHRASE`). False when the wildcard card
   * mounted but the narrating content came from the WRONG fixture
   * file (cross-fixture leak — exactly the failure mode that
   * motivated PR #5465 and its follow-up). Optional so existing
   * test fixtures predating the field still type-check; absence is
   * treated as `false` by the validator.
   */
  customContentPhrasePresent?: boolean;
}

export async function probeCustomCatchall(
  page: Page,
): Promise<CustomCatchallProbe> {
  // ROOT CAUSE (PR #5495 A11): the prior implementation passed the
  // content phrase into the browser-side closure via the
  // `page.evaluate(fn, arg)` second-arg form:
  //
  //     return await page.evaluate((expectedPhrase?: string) => {
  //       const needle = expectedPhrase ?? "";
  //       if (needle) { /* … cascade scan … */ }
  //       ...
  //     }, phrase);
  //
  // Empirically (verified via in-closure return diagnostics during the
  // A11 RED-GREEN proof on `langgraph-python:tool-rendering-custom-catchall`),
  // `expectedPhrase` arrives as `undefined` inside the closure — the arg
  // is NOT propagated through the harness's compiled `page.evaluate` call
  // path. With `needle === ""`, the `if (needle)` guard skipped the entire
  // cascade and `customContentPhrasePresent` stayed `false` forever, even
  // though `bubble.textContent` / `body.textContent` / `body.innerText`
  // all contained the canonical phrase at the SAME moment.
  //
  // Why this affects ONLY this probe: `findAssistantBubbleAt` and
  // `readCascadeStateLast` pass a `number` (bubble index) via the same
  // mechanism and work correctly — verified by the conversation runner's
  // `settled text` log reading bubble idx=3's prose successfully. The
  // bubble-index path being green vs the string-arg path being undef
  // hints at a serialization-layer behavior we did not fully nail down
  // (Playwright + tsc + the harness build chain). The defensive fix
  // sidesteps the question entirely by inlining the needle as a JS
  // literal inside the closure — no `page.evaluate(fn, arg)` second-arg
  // dependency at all.
  //
  // The needle is the canonical content phrase exported above as
  // `CUSTOM_CATCHALL_CONTENT_PHRASE`. Keep these two in lock-step.
  return await page.evaluate(() => {
    const needle = "rendered through the custom wildcard catchall";
    // Re-establish minimal DOM shape locally — package tsconfig excludes the
    // `dom` lib. Same pattern used in `findAssistantBubbleAt`.
    interface DomElement {
      readonly textContent: string | null;
      getAttribute(name: string): string | null;
      querySelector(sel: string): DomElement | null;
      querySelectorAll(sel: string): DomNodeList;
    }
    interface DomNodeList {
      readonly length: number;
      item(idx: number): DomElement | null;
    }
    const doc = (
      globalThis as unknown as {
        document: {
          querySelectorAll(sel: string): DomNodeList;
          body: {
            textContent?: string | null;
          } | null;
        };
      }
    ).document;
    const containers = doc.querySelectorAll(
      '[data-testid="custom-wildcard-card"]',
    );
    const names = new Set<string>();
    for (let i = 0; i < containers.length; i++) {
      const n = containers.item(i)?.getAttribute("data-tool-name");
      if (n) names.add(n);
    }
    // Scan the assistant-message bubbles for the custom-catchall content
    // phrase. Uses `textContent` rather than `body.innerText` because
    // `innerText` excludes off-viewport text on long chat threads — the
    // latest narration bubble can be below the visible scrollport and
    // silently elided. `textContent` returns the full DOM-attached text
    // regardless of viewport state.
    //
    // The selector cascade matches `countAssistantMessages` in
    // `helpers/assistant-message-count.ts` so probes pick up bubbles for
    // shells that don't carry the canonical `copilot-assistant-message`
    // testid.
    let customContentPhrasePresent = false;
    const tiers = [
      '[data-testid="copilot-assistant-message"]',
      '[role="article"][data-message-role="assistant"]',
      '[role="article"]:not([data-message-role="user"])',
      '[data-message-role="assistant"]',
    ];
    for (const sel of tiers) {
      const bubbles = doc.querySelectorAll(sel);
      for (let i = 0; i < bubbles.length; i++) {
        const t = bubbles.item(i)?.textContent ?? "";
        if (t.includes(needle)) {
          customContentPhrasePresent = true;
          break;
        }
      }
      if (customContentPhrasePresent) break;
    }
    // Last-resort: scan the document body's textContent (full DOM).
    if (!customContentPhrasePresent) {
      const body = doc.body;
      const bodyText = (body?.textContent ?? "") as string;
      customContentPhrasePresent = bodyText.includes(needle);
    }
    return {
      toolNames: Array.from(names),
      containerCount: containers.length,
      customContentPhrasePresent,
    };
  });
}

/**
 * Validate that BOTH expected tool names rendered through the SAME
 * custom-catchall testid AND that the rendered narration came from
 * the custom-catchall fixture (not a leaked default-catchall fixture).
 * Returns null when the cross-tool + content snapshot holds, or a
 * human-readable error string on the first failing check.
 *
 * The checks are ordered from "no rendering at all" → "partial
 * rendering" → "wrong tools rendered" → "wrong narration content"
 * so the operator's first error message is the most informative
 * one. The content check (when `requireContentPhrase` is true) is
 * the LGP-gold disjoint-prompts guard — it catches a cross-fixture
 * leak that the testid + tool-name checks structurally cannot.
 */
export function validateCustomCatchall(
  snap: CustomCatchallProbe,
  expectedToolNames: readonly string[],
  requireContentPhrase: boolean = false,
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
  if (requireContentPhrase && !snap.customContentPhrasePresent) {
    return (
      `tool-rendering-custom-catchall: custom wildcard rendered ` +
      `[${snap.toolNames.join(", ")}] but the page body does not include ` +
      `the custom-catchall content phrase ${JSON.stringify(CUSTOM_CATCHALL_CONTENT_PHRASE)} — ` +
      "narration may have come from a leaked default-catchall fixture"
    );
  }
  return null;
}

export async function assertCustomCatchall(
  page: Page,
  expectedToolNames: readonly string[],
  optionsOrTimeoutMs:
    | number
    | { requireContentPhrase?: boolean; timeoutMs?: number } = {},
): Promise<void> {
  // Accept legacy `(page, expected, timeoutMs)` signature alongside the new
  // options-object form so callers in this repo (e.g. existing tests under
  // `d5-tool-rendering-custom-catchall.test.ts`) keep compiling.
  const options =
    typeof optionsOrTimeoutMs === "number"
      ? { timeoutMs: optionsOrTimeoutMs }
      : optionsOrTimeoutMs;
  const { requireContentPhrase = false, timeoutMs = POLL_TIMEOUT_MS } = options;
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  let pollCount = 0;
  while (Date.now() < deadline) {
    const snap = await probeCustomCatchall(page);
    pollCount++;
    lastError = validateCustomCatchall(
      snap,
      expectedToolNames,
      requireContentPhrase,
    );
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
      // through the same custom-catchall testid AND the assistant's
      // narration content (passed in via `ctx.text` — the turn-scoped
      // bubble text resolved by the conversation runner's settle path)
      // must include the custom-catchall content phrase. The narration
      // content check proves the response came from the custom-catchall
      // fixture rather than a leaked default-catchall fixture
      // (LGP-gold disjoint-prompts guard). We use `ctx.text` instead
      // of a probe-side DOM read so the check is cascade-consistent
      // with the rest of the harness (turn-indexed, defect-2 safe —
      // see `d5-gen-ui-custom.ts` for the same pattern).
      assertions: async (page, ctx) => {
        await assertCustomCatchall(page, allExpected, {
          requireContentPhrase: true,
          timeoutMs: POLL_TIMEOUT_MS,
        });
        const phrase = CUSTOM_CATCHALL_CONTENT_PHRASE;
        if (!ctx.text.includes(phrase)) {
          throw new Error(
            "tool-rendering-custom-catchall: narration content does not " +
              `include the custom-catchall content phrase ${JSON.stringify(phrase)} — ` +
              `narration may have come from a leaked default-catchall fixture. ` +
              `Observed text: ${JSON.stringify(ctx.text.slice(0, 200))}`,
          );
        }
      },
    },
  ];
}

export function preNavigateRoute(): string {
  return "/demos/tool-rendering-custom-catchall";
}

registerD5Script({
  featureTypes: ["tool-rendering-custom-catchall"],
  fixtureFile: "tool-rendering-custom-catchall.json",
  buildTurns,
  preNavigateRoute,
});
