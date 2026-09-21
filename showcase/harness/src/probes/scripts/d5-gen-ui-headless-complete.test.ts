import { expect, it } from "vitest";
import { buildTurns } from "./d5-gen-ui-headless-complete.js";
import { HEADLESS_COMPLETE_PILLS } from "./_pill-contracts-beautiful-headless.js";

it("accounts for four disappearing samples and four persistent suggestions without alternate prompts", () => {
  const turns = buildTurns({
    integrationSlug: "langgraph-python",
    featureType: "gen-ui-headless-complete",
    baseUrl: "http://localhost:3000",
  });
  expect(turns).toHaveLength(8);
  expect(new Set(turns.map((turn) => turn.action?.id)).size).toBe(8);
  HEADLESS_COMPLETE_PILLS.forEach((pill, index) => {
    const sample = turns[index]!;
    const suggestion = turns[index + 4]!;
    expect(sample).toHaveProperty("scenario", "fresh");
    expect(sample.action?.buttonName).toBe(`Try suggestion: ${pill.sample}`);
    expect(sample.action?.expectedDispatchedPrompt).toBe(pill.sample);
    expect(suggestion.action?.buttonName).toBe(`Suggestion: ${pill.title}`);
    expect(suggestion.action?.expectedDispatchedPrompt).toBe(pill.prompt);
    expect(suggestion.assertions).toBeTypeOf("function");
    expect(suggestion).not.toHaveProperty("scenario");
  });
});
