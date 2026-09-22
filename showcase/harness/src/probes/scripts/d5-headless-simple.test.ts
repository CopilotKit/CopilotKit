import { expect, it } from "vitest";
import { buildTurns } from "./d5-headless-simple.js";
import { HEADLESS_SIMPLE_PILLS } from "./_pill-contracts-beautiful-headless.js";

it("requires all three distinct initial-state actions with exact dispatch and result checks", () => {
  const turns = buildTurns({
    integrationSlug: "langgraph-python",
    featureType: "headless-simple",
    baseUrl: "http://localhost:3000",
  });
  expect(turns).toHaveLength(3);
  expect(turns.map((turn) => turn.action)).toEqual(
    HEADLESS_SIMPLE_PILLS.map((pill) => pill.action),
  );
  for (const turn of turns) {
    expect(turn).toHaveProperty("scenario", "fresh");
    expect(turn.input).toBe(turn.action?.expectedDispatchedPrompt);
    expect(turn.assertions).toBeTypeOf("function");
    expect(turn.skipSend).toBeUndefined();
  }
});
