/**
 * D5 — gen-ui-a2ui-fixed script.
 *
 * Drives `/demos/a2ui-fixed-schema`. The agent emits an A2UI payload
 * matching the locked fixed-schema definitions (Card / Title /
 * Airport / …); the renderer materializes the component tree.
 *
 * Genuine assertion: send the suggestion-pill prompt; after settle,
 * assert the `[data-testid="a2ui-fixed-card"]` mounts. Replaces the
 * prior "transcript mentions a2ui" keyword check, which would stay
 * green even if the renderer never painted.
 */

import {
  registerD5Script,
  type D5BuildContext,
  type D5FeatureType,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import { FIRST_SIGNAL_TIMEOUT_MS, waitForTestId } from "./_genuine-shared.js";

/** Default `/demos/<featureType>` would be `/demos/gen-ui-a2ui-fixed`,
 *  which does not exist — the actual route uses the registry-id
 *  `a2ui-fixed-schema`. */
export function preNavigateRoute(_ft: D5FeatureType): string {
  return "/demos/a2ui-fixed-schema";
}

/** Pill prompt MUST match `a2ui-fixed-schema/suggestions.ts`. */
export const A2UI_FIXED_PILL_PROMPT =
  "Find me a flight from SFO to JFK on United for $289.";

export function buildA2uiFixedAssertion(opts?: {
  timeoutMs?: number;
}): (page: Page) => Promise<void> {
  const timeout = opts?.timeoutMs ?? FIRST_SIGNAL_TIMEOUT_MS;
  return async (page: Page): Promise<void> => {
    await waitForTestId(page, "a2ui-fixed-card", timeout, "gen-ui-a2ui-fixed");
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: A2UI_FIXED_PILL_PROMPT,
      assertions: buildA2uiFixedAssertion(),
      responseTimeoutMs: 60_000,
      // The A2UI surface can complete WITHOUT an assistant text bubble — e.g.
      // frameworks whose fixed-schema render arrives via the middleware-injected
      // `render_a2ui` tool call (no trailing narration), such as the hermes
      // integration. Opting into `completeOnMount` swaps the runner's third
      // settle conjunct from "assistant text stabilised" to "the fixed flight
      // card mounted", so the turn completes on `run-finished + new bubble +
      // surface painted` and the `a2ui-fixed-card` assertion gets to run.
      // Frameworks that DO emit a confirmation sentence (langgraph-python etc.)
      // still mount `a2ui-fixed-card`, so this is a strict superset — same
      // green outcome, just a completion path that also covers text-less
      // renders. Mirrors the `completeOnMount` swap in d5-gen-ui-declarative.ts.
      completeOnMount: {
        testIds: ["a2ui-fixed-card"],
        minNewMounts: 1,
      },
    },
  ];
}

registerD5Script({
  featureTypes: ["gen-ui-a2ui-fixed"],
  fixtureFile: "gen-ui-a2ui-fixed.json",
  buildTurns,
  preNavigateRoute,
});
