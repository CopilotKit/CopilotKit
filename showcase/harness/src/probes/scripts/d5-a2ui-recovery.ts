/** Canonical LGP pill controls and results, shared by every frontend/integration. */
import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext, D5FeatureType } from "../helpers/d5-registry.js";
import { buildRenderingTurns } from "./_pill-contracts-rendering.js";

export function buildTurns(_ctx: D5BuildContext) {
  return buildRenderingTurns("a2ui-recovery");
}

export function preNavigateRoute(_feature?: D5FeatureType) {
  return "/demos/a2ui-recovery";
}

registerD5Script({
  featureTypes: ["a2ui-recovery"],
  fixtureFile: "a2ui-recovery.json",
  buildTurns,
  preNavigateRoute,
});
