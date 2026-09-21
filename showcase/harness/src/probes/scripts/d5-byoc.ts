/** BYOC routes retain separate canonical controls and expected results. */
import { registerD5Script } from "../helpers/d5-registry.js";
import type {
  D5BuildContext,
  D5FeatureType,
  D5RouteContext,
} from "../helpers/d5-registry.js";
import { buildRenderingTurns } from "./_pill-contracts-rendering.js";

export function buildTurns(ctx: D5BuildContext & { demoId?: string }) {
  if (ctx.demoId === "declarative-hashbrown" || ctx.demoId === "byoc-hashbrown")
    return buildRenderingTurns("declarative-hashbrown");
  if (
    ctx.demoId === "declarative-json-render" ||
    ctx.demoId === "byoc-json-render"
  )
    return buildRenderingTurns("declarative-json-render");
  throw new Error(
    "byoc: exact candidate demoId is required; hashbrown and json-render cannot share acceptance",
  );
}
export function preNavigateRoute(
  _feature: D5FeatureType,
  ctx?: D5RouteContext,
) {
  const routes =
    ctx?.demos?.filter((demo) =>
      [
        "declarative-hashbrown",
        "byoc-hashbrown",
        "declarative-json-render",
        "byoc-json-render",
      ].includes(demo),
    ) ?? [];
  if (routes.length !== 1)
    throw new Error("byoc: one exact candidate route is required");
  return `/demos/${routes[0]}`;
}
registerD5Script({
  featureTypes: ["byoc"],
  fixtureFile: "byoc.json",
  buildTurns,
  preNavigateRoute,
});
