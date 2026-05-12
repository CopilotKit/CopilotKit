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
 *        get_weather    → <WeatherCard />
 *        search_flights → <FlightListCard />
 *        get_stock_price / roll_dice → <CustomCatchallRenderer />
 *
 * Single-turn flow (chip-driven):
 *   "Find flights from SFO to JFK and show me the weather there."
 *     → reasoning-block + FlightListCard + WeatherCard.
 *   This pill is CHAINED (search_flights → get_weather(JFK)) so a single
 *   turn exercises BOTH per-tool renderers — covering all the wiring the
 *   previous two-turn Tokyo+SFO script covered, at half the wall-clock.
 *   Asserts ALL THREE testids mount (reasoning-block, flight-list-card,
 *   weather-card), plus assistant transcript mentions "sfo".
 *
 * The reasoning-block assertion is what makes this probe distinct from
 * `tool-rendering` (no reasoning slot) and from `reasoning-display`
 * (no per-tool renderers). A regression that drops the reasoning slot
 * OR the tool-renderer wiring OR the chained-tool-call behavior is
 * caught here. The catchall variants (dice / stocks) are covered
 * separately by `tool-rendering-custom-catchall`.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

interface PillExpectation {
  /** Chip prompt — MUST mirror `tool-rendering-reasoning-chain/page.tsx`
   *  suggestion-chip messages verbatim so aimock's `userMessage`
   *  substring matcher selects the right canned response. */
  prompt: string;
  /** Per-tool card testids to wait for. Chained pills emit multiple tool
   *  calls in succession, so this is a list — the assertion succeeds only
   *  if EVERY listed testid mounts within `CARD_TIMEOUT_MS`. */
  cardTestIds: readonly string[];
  /** Lowercase substrings the assistant transcript must contain. */
  textTokens: readonly string[];
  /** Per-turn budget — agent reasoning + tool call + render. */
  responseTimeoutMs: number;
}

const TURN_EXPECTATIONS: readonly PillExpectation[] = [
  {
    // Pill 3 in page.tsx — chained flights + destination weather.
    // Exercises BOTH per-tool renderers (FlightListCard + WeatherCard) in
    // a single turn, so this one prompt covers the full per-tool wiring.
    prompt: "Find flights from SFO to JFK and show me the weather there.",
    cardTestIds: ["flight-list-card", "weather-card"],
    textTokens: ["sfo"],
    responseTimeoutMs: 60_000,
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

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return TURN_EXPECTATIONS.map((exp, idx) => ({
    input: exp.prompt,
    responseTimeoutMs: exp.responseTimeoutMs,
    assertions: async (page) => {
      const tag = `tool-rendering-reasoning-chain turn ${idx + 1}`;

      // 1. Wait for the reasoning-block to mount. The agent's reasoning
      //    chain is the distinguishing signal vs the plain tool-rendering
      //    probe — if this never mounts, the reasoning slot wiring
      //    regressed.
      try {
        await page.waitForSelector(
          `[data-testid="${REASONING_BLOCK_TESTID}"]`,
          {
            state: "visible",
            timeout: REASONING_TIMEOUT_MS,
          },
        );
      } catch {
        throw new Error(
          `${tag}: expected [data-testid="${REASONING_BLOCK_TESTID}"] to mount within ${REASONING_TIMEOUT_MS}ms — reasoningMessage slot may be unwired or agent's reasoning tokens never streamed`,
        );
      }

      // 2. Wait for every per-tool card to mount. Chained pills emit
      //    multiple tool calls in one turn — each must land its dedicated
      //    renderer (NOT the catchall fallback). Asserting all of them
      //    catches the case where the second tool call regresses while
      //    the first still works.
      for (const cardTestId of exp.cardTestIds) {
        try {
          await page.waitForSelector(`[data-testid="${cardTestId}"]`, {
            state: "visible",
            timeout: CARD_TIMEOUT_MS,
          });
        } catch {
          throw new Error(
            `${tag}: expected [data-testid="${cardTestId}"] to mount within ${CARD_TIMEOUT_MS}ms — tool result may not have landed or the per-tool renderer wiring drifted`,
          );
        }
      }

      // 3. Verify the assistant transcript references the right context
      //    (e.g. "sfo" for the SFO→JFK chain). The card mounting alone
      //    proves wiring; the text token catches the case where a stale
      //    fixture from a prior turn satisfies the testid wait but
      //    contains the wrong route.
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
