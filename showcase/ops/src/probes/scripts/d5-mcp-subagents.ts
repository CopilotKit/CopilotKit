/**
 * D5 — `mcp-apps` + `subagents` script.
 *
 * Both feature types are covered by ONE script that drives the
 * `/demos/subagents` route. The fixture (`mcp-subagents.json`) was
 * recorded against the supervisor agent in LangGraph Python's
 * `/demos/subagents`, NOT `/demos/mcp-apps` — coupling the latter to a
 * public Excalidraw MCP server would have made fixture replay depend on
 * an external service. So we reuse the same chained-delegation
 * conversation for both feature types and route them both to
 * `/demos/subagents` via `preNavigateRoute`.
 *
 * The fixture chains three sub-agent tool calls (research → writing →
 * critique) followed by a final text reply that mentions the result of
 * each delegation. The single user turn is the trigger for the entire
 * chain; the supervisor's loop fires the three tool calls before
 * emitting the final text. Per-turn assertion verifies the reply
 * surfaces fragments that prove ALL three sub-agents ran (research's
 * facts, writing's draft language, critique's framing).
 *
 * Side effect: importing this module triggers `registerD5Script`. The
 * default loader in `e2e-deep.ts` discovers it via the `d5-*` filename
 * convention.
 */

import {
  registerD5Script,
  type D5BuildContext,
  type D5FeatureType,
} from "../helpers/d5-registry.js";
import type {
  ConversationTurn,
  Page,
} from "../helpers/conversation-runner.js";

/**
 * Phrases the final assistant reply MUST contain to prove the entire
 * sub-agent chain executed:
 *
 *   - "ten hours a week"        → research_agent's facts
 *   - "remote workers"          → writing_agent's draft surface
 *   - "talent pool"             → research_agent fact survived through draft
 *   - "mentorship"              → critique_agent's counterweight framing
 *   - "cultural cohesion"       → critique_agent's framing
 *
 * Drawn directly from the fixture's `call_d5_critique_agent_001`
 * response so any drift between fixture and assertion will surface as a
 * loud test failure rather than a silent green.
 */
const EXPECTED_REPLY_FRAGMENTS = [
  "ten hours a week",
  "remote workers",
  "talent pool",
  "mentorship",
  "cultural cohesion",
] as const;

/**
 * Single user prompt that triggers the chain. Verbatim match against the
 * fixture's `userMessage` matcher — any divergence here would route the
 * request to the live model rather than the recorded chain, which is
 * exactly the mismatch we want to fail loudly on.
 */
const USER_PROMPT =
  "Research the benefits of remote work and draft a one-paragraph summary";

/**
 * Build the per-(integration, featureType) conversation. The chain
 * itself doesn't vary across integrations — every showcase that exposes
 * `/demos/subagents` runs the same supervisor → research/writing/critique
 * pattern — so `ctx` is unused here. We accept it to honour the
 * `D5Script.buildTurns` contract.
 */
export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: USER_PROMPT,
      assertions: assertChainedReply,
    },
  ];
}

/**
 * Per-turn assertion. After the assistant settles, scrape the rendered
 * conversation text and verify every chain fragment is present. We pull
 * the visible text via `page.evaluate` rather than Playwright's
 * `textContent(selector)` because the runner's `Page` surface (a
 * structural minimal subset of `playwright.Page`) only exposes
 * `evaluate` — keeps unit-test fakes thin.
 *
 * The assertion intentionally checks the FINAL reply text (not DOM
 * cards for sub-agent invocations) because the fixture already proves
 * the chain executed: if any sub-agent had been skipped, its fact
 * fragment would not have made it into the critique's draft, and this
 * check would fail. Optional DOM inspection of `[data-testid="delegation-entry"]`
 * is left as a follow-up — the fixture-driven text check is the load-
 * bearing signal.
 */
export async function assertChainedReply(page: Page): Promise<void> {
  const visibleText = await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        body: { innerText?: string; textContent?: string };
      };
    };
    return (
      win.document.body.innerText ?? win.document.body.textContent ?? ""
    );
  });

  const lower = visibleText.toLowerCase();
  const missing = EXPECTED_REPLY_FRAGMENTS.filter(
    (fragment) => !lower.includes(fragment.toLowerCase()),
  );
  if (missing.length > 0) {
    throw new Error(
      `mcp-subagents: chained reply missing fragments: ${missing.join(", ")}`,
    );
  }
}

/**
 * Route override. Both `mcp-apps` and `subagents` resolve to
 * `/demos/subagents` because the fixture was recorded against that
 * route (see fixture _comment for the rationale). The driver default is
 * `/demos/<featureType>`, which would 404 on `/demos/mcp-apps` for any
 * showcase that hasn't wired a real MCP demo.
 */
export function preNavigateRoute(_featureType: D5FeatureType): string {
  return "/demos/subagents";
}

registerD5Script({
  featureTypes: ["mcp-apps", "subagents"],
  fixtureFile: "mcp-subagents.json",
  buildTurns,
  preNavigateRoute,
});
