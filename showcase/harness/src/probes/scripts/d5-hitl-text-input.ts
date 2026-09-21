import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import { buildHitlTurns, HITL_ROUTES } from "./_pill-contracts-hitl.js";

export function buildTurns(_ctx: D5BuildContext) {
  return buildHitlTurns("hitl-text-input");
}
export function preNavigateRoute() {
  return HITL_ROUTES["hitl-text-input"];
}
const script = {
  featureTypes: ["hitl-text-input" as const],
  fixtureFile: "hitl-text-input.json",
  preNavigateRoute,
  buildTurns,
};
registerD5Script(script);
export const __d5HitlTextInputScript = script;
