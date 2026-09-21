import { noLgpCanonicalTurns } from "./_pill-contracts-tools-agents.js";
/** No LGP counterpart exists for these features; never infer functional success from a smoke check. */
import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext, D5FeatureType } from "../helpers/d5-registry.js";
import type { ConversationTurn } from "../helpers/conversation-runner.js";

/** Reject the unavailable canonical background-agent definition. */
export function buildBackgroundAgentsTurns(
  _context: D5BuildContext,
): ConversationTurn[] {
  return noLgpCanonicalTurns("background-agents");
}

/** Reject the unavailable canonical observational-memory definition. */
export function buildObservationalMemoryTurns(
  _context: D5BuildContext,
): ConversationTurn[] {
  return noLgpCanonicalTurns("observational-memory");
}

/** An empty Browser Use action list cannot establish functional acceptance. */
export function buildBrowserUseTurns(
  _context: D5BuildContext,
): ConversationTurn[] {
  return noLgpCanonicalTurns("browser-use-smoke");
}

/** Resolve closed Mastra probe literals to public demo routes. */
export function preNavigateMastraRoute(featureType: D5FeatureType): string {
  return featureType === "browser-use-smoke"
    ? "/demos/browser-use"
    : `/demos/${featureType}`;
}

registerD5Script({
  featureTypes: ["background-agents"],
  fixtureFile: "background-agents.json",
  buildTurns: buildBackgroundAgentsTurns,
  preNavigateRoute: preNavigateMastraRoute,
});

registerD5Script({
  featureTypes: ["observational-memory"],
  fixtureFile: "observational-memory.json",
  buildTurns: buildObservationalMemoryTurns,
  preNavigateRoute: preNavigateMastraRoute,
});

registerD5Script({
  featureTypes: ["browser-use-smoke"],
  buildTurns: buildBrowserUseTurns,
  preNavigateRoute: preNavigateMastraRoute,
});
