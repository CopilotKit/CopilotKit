/**
 * D5 — tool-rendering-reasoning-chain script.
 *
 * Drives `/demos/tool-rendering-reasoning-chain`. The demo composes
 * two patterns into one chat surface:
 *
 *   1. Reasoning tokens streamed by `init_chat_model("openai:gpt-5.4",
 *      use_responses_api=True, reasoning={"effort":"medium",
 *      "summary":"detailed"})` and rendered via a custom
 *      `messageView.reasoningMessage` slot
 *      (`<ReasoningBlock data-testid="reasoning-block">`).
 *   2. Per-tool renderers wired through `useRenderTool`:
 *        get_weather    → <WeatherCard data-testid="weather-card" />
 *        search_flights → <FlightListCard data-testid="flight-list-card" />
 *        get_stock_price / roll_dice → <CustomCatchallRenderer
 *          data-testid="custom-catchall-card" data-tool-name="..." />
 *
 * Three-turn flow in ONE thread (chip-driven). Each pill drives a
 * CHAINED two-tool flow with reasoning summaries between iterations:
 *
 *   1. "Compare AAPL and MSFT stocks for me."
 *      → get_stock_price(AAPL) → get_stock_price(MSFT) → comparison.
 *      Asserts reasoning-block + 2 custom-catchall-card[tool=get_stock_price].
 *   2. "Roll a 20-sided die for me and compare it to a smaller one."
 *      → roll_dice(sides=20) → roll_dice(sides=6) → contrast narration.
 *      Asserts reasoning-block + 2 custom-catchall-card[tool=roll_dice].
 *   3. "Find flights from SFO to JFK and show me the weather there."
 *      → search_flights(SFO,JFK) → get_weather(JFK) → trip-plan narration.
 *      Asserts reasoning-block + flight-list-card + weather-card.
 *
 * The three-turns-in-one-thread shape is load-bearing: it's the
 * regression guard for the AG-UI reasoning-role message bug. Without
 * the `LangGraphAgent.run` reasoning-role filter (in
 * @copilotkit/runtime), the SECOND turn used to crash before the model
 * was called because @ag-ui/langgraph's message converter throws on
 * `role:"reasoning"` messages the client replayed from turn 1. If that
 * filter regresses, turn 2 fails here with INCOMPLETE_STREAM.
 *
 * The reasoning-block assertion on every turn is the second regression
 * guard: it catches a drop of the reasoning slot wiring OR a model
 * config drift back to `summary:"auto"` that silently skips summaries.
 * The catchall card[tool=...] assertions catch the CustomCatchallRenderer
 * regressing, plus the fixture chain advancing fully (not stopping at
 * the first tool call).
 *
 * If you reduce the per-turn count, you LOSE multi-pill safety coverage.
 * Keep three turns.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

/** The harness `Page` interface intentionally narrows the surface to
 *  `waitForSelector` + `evaluate` (see conversation-runner.ts). For
 *  count-based polling we need `Page.locator(sel).count()` — that method
 *  is exposed by the e2e-deep wrapper (`E2eDeepPage.locator`). We cast
 *  to a local interface so this script doesn't depend on the wider
 *  Playwright Page type. Sleep between polls uses native `setTimeout`
 *  rather than Playwright's `page.waitForTimeout`, which is not part of
 *  the harness `Page` surface. */
interface CountablePage extends Page {
  locator(selector: string): { count(): Promise<number> };
}

const POLL_INTERVAL_MS = 250;

interface CardSelector {
  /** Card `data-testid`. Custom-catchall cards share one testid across
   *  every catchall-rendered tool — combine with `toolName` to scope to
   *  a specific tool. */
  testId: string;
  /** When set, restrict the selector to cards whose `data-tool-name`
   *  matches. Required for `custom-catchall-card` because both stocks
   *  AND dice render through it; omitted for branded per-tool cards
   *  (`flight-list-card`, `weather-card`) where the testid is unique. */
  toolName?: string;
  /** Minimum visible count for this card group in this turn. `1` for the
   *  branded per-tool cards (one flight list per turn). `2` for the
   *  catchall cards because each pill chains a pair of calls (AAPL+MSFT,
   *  d20+d6). */
  minCount: number;
}

interface PillExpectation {
  /** Chip prompt — MUST mirror `tool-rendering-reasoning-chain/page.tsx`
   *  suggestion-chip messages verbatim so aimock's `userMessage`
   *  substring matcher selects the right canned response. */
  prompt: string;
  /** Card groups expected in this turn. Each entry has a minimum count
   *  so chained pills can require BOTH tool calls' cards before the
   *  turn is considered passing. */
  cards: readonly CardSelector[];
  /** Lowercase substrings the assistant transcript must contain. The
   *  transcript is the cumulative across-turns view, so each turn's
   *  expected substring should be unique to its narration. */
  textTokens: readonly string[];
  /** Per-turn budget — agent reasoning + 2 chained tool calls + render. */
  responseTimeoutMs: number;
}

const TURN_EXPECTATIONS: readonly PillExpectation[] = [
  {
    // Pill 1 — chained stocks comparison (AAPL → MSFT).
    prompt: "Compare AAPL and MSFT stocks for me.",
    cards: [
      {
        testId: "custom-catchall-card",
        toolName: "get_stock_price",
        minCount: 2,
      },
    ],
    textTokens: ["aapl", "msft"],
    responseTimeoutMs: 90_000,
  },
  {
    // Pill 2 — chained dice contrast (d20 → d6).
    prompt: "Roll a 20-sided die for me and compare it to a smaller one.",
    cards: [
      { testId: "custom-catchall-card", toolName: "roll_dice", minCount: 2 },
    ],
    textTokens: ["d20"],
    responseTimeoutMs: 90_000,
  },
  {
    // Pill 3 — chained flights + destination weather (SFO→JFK + JFK).
    // Exercises BOTH branded per-tool renderers in one turn.
    prompt: "Find flights from SFO to JFK and show me the weather there.",
    cards: [
      { testId: "flight-list-card", minCount: 1 },
      { testId: "weather-card", minCount: 1 },
    ],
    textTokens: ["sfo", "jfk"],
    responseTimeoutMs: 90_000,
  },
];

const REASONING_BLOCK_TESTID = "reasoning-block";
const REASONING_TIMEOUT_MS = 30_000;
const CARD_TIMEOUT_MS = 30_000;

/** Read concatenated assistant transcript text (lowercased). Mirrors
 *  the selector cascade used in agentic-chat / multimodal probes. */
async function readAssistantTranscript(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(
          sel: string,
        ): ArrayLike<{ textContent: string | null }>;
      };
    };
    const sels = [
      '[data-testid="copilot-assistant-message"]',
      '[role="article"]:not([data-message-role="user"])',
      '[data-message-role="assistant"]',
    ];
    let nodes: ArrayLike<{ textContent: string | null }> = { length: 0 };
    for (const s of sels) {
      const found = win.document.querySelectorAll(s);
      if (found.length > 0) {
        nodes = found;
        break;
      }
    }
    let acc = "";
    for (let i = 0; i < nodes.length; i++) {
      acc += " " + (nodes[i]!.textContent ?? "");
    }
    return acc.toLowerCase();
  });
}

function assertContainsAll(
  text: string,
  tokens: readonly string[],
  context: string,
): void {
  const missing = tokens.filter((t) => !text.includes(t.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(
      `${context}: assistant text missing tokens [${missing.join(", ")}]; got (truncated): ${text.slice(0, 300)}`,
    );
  }
}

/** Builds the CSS selector for a card group. `data-tool-name` lets us
 *  scope catchall cards to a specific tool — without it, the catchall
 *  testid matches BOTH the prior turn's stock cards AND the current
 *  turn's dice cards in a multi-pill thread. */
function cardSelector(card: CardSelector): string {
  const base = `[data-testid="${card.testId}"]`;
  return card.toolName ? `${base}[data-tool-name="${card.toolName}"]` : base;
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return TURN_EXPECTATIONS.map((exp, idx) => ({
    input: exp.prompt,
    responseTimeoutMs: exp.responseTimeoutMs,
    assertions: async (page) => {
      const tag = `tool-rendering-reasoning-chain turn ${idx + 1}`;
      const pw = page as CountablePage;

      // 1. Reasoning-block count must INCREASE this turn vs the prior
      //    turn. A simple "visible" wait isn't enough on turn 2/3 — the
      //    block from turn 1 is still in the DOM. Counting catches a
      //    regression where the agent stops emitting reasoning summaries
      //    on follow-up turns (e.g. `summary:"auto"` drift) even though
      //    the FIRST turn renders fine.
      const reasoningBlocks = pw.locator(
        `[data-testid="${REASONING_BLOCK_TESTID}"]`,
      );
      const expectedReasoningCount = idx + 1;
      const reasoningStart = Date.now();
      while (Date.now() - reasoningStart < REASONING_TIMEOUT_MS) {
        const count = await reasoningBlocks.count();
        if (count >= expectedReasoningCount) break;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      const reasoningCount = await reasoningBlocks.count();
      if (reasoningCount < expectedReasoningCount) {
        throw new Error(
          `${tag}: expected at least ${expectedReasoningCount} [data-testid="${REASONING_BLOCK_TESTID}"] mounts within ${REASONING_TIMEOUT_MS}ms but saw ${reasoningCount} — reasoningMessage slot may be unwired, or the agent stopped emitting reasoning summaries on this turn`,
        );
      }

      // 2. Each card group's minimum count must be reached. Counting
      //    rather than "visible" catches:
      //      a. chain stopping after the first tool call (only 1 card
      //         where we expect 2 — the second-leg fixture didn't fire);
      //      b. on multi-pill turns, regression in toolCallId-keyed
      //         follow-up fixtures (the chain would silently degrade to
      //         single-tool again).
      //    Catchall cards accumulate across turns; the per-turn minimum
      //    here is the delta we need to see by end of this turn.
      for (const card of exp.cards) {
        const sel = cardSelector(card);
        const locator = pw.locator(sel);
        const cardStart = Date.now();
        while (Date.now() - cardStart < CARD_TIMEOUT_MS) {
          const count = await locator.count();
          if (count >= card.minCount) break;
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
        const count = await locator.count();
        if (count < card.minCount) {
          throw new Error(
            `${tag}: expected at least ${card.minCount} ${sel} within ${CARD_TIMEOUT_MS}ms but saw ${count} — tool chain may have stopped at the first call, or the per-tool renderer wiring drifted`,
          );
        }
      }

      // 3. Verify the assistant transcript contains this turn's unique
      //    tokens. The card mounting alone proves wiring; the text token
      //    catches the case where a stale fixture from a prior turn
      //    satisfies the testid wait but contains the wrong content.
      const text = await readAssistantTranscript(page);
      console.debug(`[d5-tool-rendering-reasoning-chain] ${tag} text`, {
        text: text.slice(0, 300),
      });
      assertContainsAll(text, exp.textTokens, tag);
    },
  }));
}

registerD5Script({
  featureTypes: ["tool-rendering-reasoning-chain"],
  fixtureFile: "tool-rendering-reasoning-chain.json",
  buildTurns,
});
