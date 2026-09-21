import { describe, expect, it } from "vitest";
import { buildTurns, preNavigateRoute } from "./d5-gen-ui-agent.js";
import { RENDERING_PILLS } from "./_pill-contracts-rendering.js";

describe("gen-ui-agent canonical functional contract", () => {
  const canonical = RENDERING_PILLS["gen-ui-agent"];
  const context = {
    integrationSlug: "langgraph-python",
    featureType: "gen-ui-agent",
    baseUrl: "http://localhost:39200",
  } as const;
  it("drives every exact actual canonical control once", () => {
    const turns = buildTurns(context);
    expect(turns).toHaveLength(canonical.length);
    expect(new Set(turns.map((turn) => turn.action?.id)).size).toBe(
      canonical.length,
    );
    for (const [index, turn] of turns.entries()) {
      expect(turn.action).toEqual({
        ...canonical[index],
        kind: "pill",
        submission: { kind: "immediate" },
      });
      expect(turn.input).toBe(canonical[index]!.expectedDispatchedPrompt);
      expect(turn.assertions).toBeTypeOf("function");
      expect(turn.preFill).toBeTypeOf("function");
      expect(turn).not.toHaveProperty("skipFill");
      expect(turn).not.toHaveProperty("skipSend");
    }
  });
  it("never substitutes integration-specific prompts or weaker controls", () => {
    const identities = (slug: string) =>
      buildTurns({ ...context, integrationSlug: slug }).map((turn) => ({
        input: turn.input,
        action: turn.action,
      }));
    for (const slug of ["google-adk", "spring-ai", "mastra", "unknown"])
      expect(identities(slug)).toEqual(identities("langgraph-python"));
  });
  it("retains the actual demo route", () => {
    expect(preNavigateRoute()).toBe("/demos/gen-ui-agent");
  });
});
