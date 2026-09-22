import { describe, expect, it } from "vitest";
import { buildTurns, preNavigateRoute } from "./d5-byoc.js";
import { RENDERING_PILLS } from "./_pill-contracts-rendering.js";
const context = {
  integrationSlug: "langgraph-python",
  featureType: "byoc",
  baseUrl: "http://localhost:39200",
} as const;
describe("byoc exact candidate contracts", () => {
  it.each(["declarative-hashbrown", "declarative-json-render"] as const)(
    "uses all canonical pills for %s",
    (demoId) => {
      const turns = buildTurns({ ...context, demoId });
      expect(turns.map((turn) => turn.action?.buttonName)).toEqual(
        RENDERING_PILLS[demoId].map((pill) => pill.buttonName),
      );
      expect(turns.map((turn) => turn.input)).toEqual(
        RENDERING_PILLS[demoId].map((pill) => pill.expectedDispatchedPrompt),
      );
      expect(preNavigateRoute("byoc", { demos: [demoId] })).toBe(
        `/demos/${demoId}`,
      );
    },
  );
  it("fails closed instead of silently selecting a different BYOC demo", () => {
    expect(() => buildTurns(context)).toThrow("exact candidate demoId");
    expect(() =>
      preNavigateRoute("byoc", {
        demos: ["declarative-hashbrown", "declarative-json-render"],
      }),
    ).toThrow("one exact candidate");
  });
});
