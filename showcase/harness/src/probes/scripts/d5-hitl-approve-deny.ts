import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import { buildHitlTurns, HITL_ROUTES } from "./_pill-contracts-hitl.js";

export function buildTurns(_ctx: D5BuildContext) {
  return buildHitlTurns("hitl-approve-deny");
}
export function preNavigateRoute() {
  return HITL_ROUTES["hitl-approve-deny"];
}
const script = {
  featureTypes: ["hitl-approve-deny" as const],
  fixtureFile: "hitl-approve-deny.json",
  preNavigateRoute,
  buildTurns,
};
registerD5Script(script);
export const __d5HitlApproveDenyScript = script;
