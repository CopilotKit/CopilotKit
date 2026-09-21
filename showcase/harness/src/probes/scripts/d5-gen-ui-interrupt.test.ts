import { describe, it, expect } from "vitest";
import { buildTurns, preNavigateRoute } from "./d5-gen-ui-interrupt.js";
import { BOOKING_PILLS } from "./_pill-contracts-hitl.js";

describe("gen-ui-interrupt canonical pills", () => {
  const turns = buildTurns({
    integrationSlug: "langgraph-python",
    featureType: "gen-ui-interrupt",
    baseUrl: "http://localhost",
  });
  it("covers every canonical pill with exact dispatch", () => {
    expect(turns).toHaveLength(2);
    for (const turn of turns) {
      expect(turn.action?.kind).toBe("pill");
      expect(turn.action?.expectedDispatchedPrompt).toBe(turn.input);
      expect(turn.assertions).toBeTypeOf("function");
      expect(turn.skipSend).toBeUndefined();
    }
  });
  it("has unique required action identities", () => {
    expect(new Set(turns.map((t) => t.action?.id)).size).toBe(turns.length);
  });
  it("does not vary canonical actions by integration", () => {
    const other = buildTurns({
      integrationSlug: "mastra",
      featureType: "gen-ui-interrupt",
      baseUrl: "http://localhost",
    });
    expect(other.map((t) => t.action)).toEqual(turns.map((t) => t.action));
  });
  it("uses canonical navigation", () =>
    expect(preNavigateRoute()).toBe("/demos/gen-ui-interrupt"));
  it("retains both exact canonical button labels", () =>
    expect(turns.map((t) => t.action?.buttonName)).toEqual(
      BOOKING_PILLS.map((p) => p.buttonName),
    ));
});
