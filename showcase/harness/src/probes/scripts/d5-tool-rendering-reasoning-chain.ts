import { buildToolsAgentTurns } from "./_pill-contracts-tools-agents.js";
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
import type { ConversationTurn } from "../helpers/conversation-runner.js";

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return buildToolsAgentTurns("tool-rendering-reasoning-chain");
}

registerD5Script({
  featureTypes: ["tool-rendering-reasoning-chain"],
  fixtureFile: "tool-rendering-reasoning-chain.json",
  buildTurns,
});
