/** Canonical LGP pill controls and results, shared by every frontend/integration. */
import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext, D5FeatureType } from "../helpers/d5-registry.js";
import { buildRenderingTurns } from "./_pill-contracts-rendering.js";

export function buildTurns(_ctx: D5BuildContext) {
  return buildRenderingTurns("gen-ui-tool-based");
}

export function preNavigateRoute(_feature?: D5FeatureType) {
  return "/demos/gen-ui-tool-based";
}

registerD5Script({
  featureTypes: ["gen-ui-custom"],
  fixtureFile: "gen-ui-custom.json",
  buildTurns,
  preNavigateRoute,
});
