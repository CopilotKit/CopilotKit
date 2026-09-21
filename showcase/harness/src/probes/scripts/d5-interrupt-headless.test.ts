import { expect, it } from "vitest";
import { buildTurns } from "./d5-interrupt-headless.js";

it("clicks both canonical headless interrupt pills without typed substitution", () => {
  const turns = buildTurns({
    integrationSlug: "langgraph-python",
    featureType: "interrupt-headless",
    baseUrl: "http://localhost",
  });
  expect(turns.map((turn) => turn.action?.buttonName)).toEqual([
    "Book a call with sales",
    "Schedule a 1:1 with Alice",
  ]);
  for (const turn of turns)
    expect(turn.action?.expectedDispatchedPrompt).toBe(turn.input);
});
