import { describe, expect, it } from "vitest";
import { buildTurns, preNavigateRoute } from "./d5-gen-ui-custom.js";
import {
  RENDERING_PILLS,
  assertCanonicalPieGeometry,
} from "./_pill-contracts-rendering.js";

describe("gen-ui-custom canonical functional contract", () => {
  const canonical = RENDERING_PILLS["gen-ui-tool-based"];
  const context = {
    integrationSlug: "langgraph-python",
    featureType: "gen-ui-custom",
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
    expect(preNavigateRoute()).toBe("/demos/gen-ui-tool-based");
  });
});

describe("canonical pie geometry", () => {
  const expected = [45, 22, 15, 12, 6];
  const healthy = expected.map((value, index) => ({
    radius: 100,
    arc: (value / 100) * 2 * Math.PI * 100,
    gap: ((100 - value) / 100) * 2 * Math.PI * 100,
    offset:
      -(expected.slice(0, index).reduce((sum, item) => sum + item, 0) / 100) *
      2 *
      Math.PI *
      100,
    visible: true,
  }));
  it("accepts actual slice proportions and offsets", () => {
    expect(() => assertCanonicalPieGeometry(healthy, expected)).not.toThrow();
  });
  it("rejects non-finite SVG geometry instead of comparing NaN", () => {
    expect(() =>
      assertCanonicalPieGeometry(
        healthy.map((slice) => ({ ...slice, arc: NaN, offset: NaN })),
        expected,
      ),
    ).toThrow("pie geometry");
  });
  it("rejects a legend without its pie marks", () => {
    expect(() => assertCanonicalPieGeometry([], expected)).toThrow(
      "pie geometry",
    );
  });
  it("rejects wrong slice proportions and unpainted marks", () => {
    expect(() =>
      assertCanonicalPieGeometry(
        healthy.map((slice) => ({ ...slice, arc: 1 })),
        expected,
      ),
    ).toThrow("pie geometry");
    expect(() =>
      assertCanonicalPieGeometry(
        healthy.map((slice) => ({ ...slice, visible: false })),
        expected,
      ),
    ).toThrow("pie geometry");
  });
});
