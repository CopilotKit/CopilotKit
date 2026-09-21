import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import { buildHitlTurns, HITL_ROUTES } from "./_pill-contracts-hitl.js";

export function buildTurns(_ctx: D5BuildContext) {
  return buildHitlTurns("interrupt-headless");
}
export function preNavigateRoute() {
  return HITL_ROUTES["interrupt-headless"];
}
const script = {
  featureTypes: ["interrupt-headless" as const],
  fixtureFile: "interrupt-headless.json",
  preNavigateRoute,
  buildTurns,
};
registerD5Script(script);
