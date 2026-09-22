/** Actual canonical pills and exact visible results, identical across integrations. */
import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext, D5FeatureType } from "../helpers/d5-registry.js";
import {
  buildStateToolsTurns,
  STATE_TOOLS_ROUTES,
} from "./_pill-contracts-state-tools.js";

export function buildTurns(_ctx: D5BuildContext) {
  return buildStateToolsTurns("readonly-state-context");
}
export function preNavigateRoute(featureType: D5FeatureType) {
  if (featureType !== "readonly-state-context")
    throw new Error(`Unsupported feature: ${featureType}`);
  return STATE_TOOLS_ROUTES[featureType];
}
registerD5Script({
  featureTypes: ["readonly-state-context"],
  fixtureFile: "readonly-state-context.json",
  buildTurns,
  preNavigateRoute,
});
