import { describe, it, expect } from "vitest";
import { getD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import {
  buildTurns,
  preNavigateRoute,
  HASHBROWN_PILL,
  JSON_RENDER_PILL,
  METRIC_CARD_SELECTOR,
  CHART_SELECTORS,
} from "./d5-byoc.js";

describe("d5-byoc script", () => {
  it("registers under featureType 'byoc'", () => {
    const script = getD5Script("byoc");
    expect(script).toBeDefined();
    expect(script?.fixtureFile).toBe("feature-parity.json");
  });

  it("buildTurns sends the hashbrown pill prompt", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "byoc",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.input).toBe(HASHBROWN_PILL);
  });

  it("preNavigateRoute prefers hashbrown when both demos are declared", () => {
    expect(
      preNavigateRoute("byoc", {
        demos: ["byoc-hashbrown", "byoc-json-render"],
      }),
    ).toBe("/demos/byoc-hashbrown");
  });

  it("preNavigateRoute uses json-render when hashbrown is absent", () => {
    expect(preNavigateRoute("byoc", { demos: ["byoc-json-render"] })).toBe(
      "/demos/byoc-json-render",
    );
  });

  it("preNavigateRoute routes declarative-hashbrown to its renamed slug", () => {
    expect(preNavigateRoute("byoc", { demos: ["declarative-hashbrown"] })).toBe(
      "/demos/declarative-hashbrown",
    );
  });

  it("preNavigateRoute routes declarative-json-render to its renamed slug", () => {
    expect(
      preNavigateRoute("byoc", { demos: ["declarative-json-render"] }),
    ).toBe("/demos/declarative-json-render");
  });

  it("preNavigateRoute prefers declarative-hashbrown over byoc-hashbrown when both ID forms are declared", () => {
    // langgraph-python uses `declarative-*`; if a manifest ever lists both
    // forms (e.g. during a transitional release) the renamed slug wins so
    // the probe doesn't 404 against an integration that has retired the
    // legacy slug.
    expect(
      preNavigateRoute("byoc", {
        demos: ["byoc-hashbrown", "declarative-hashbrown"],
      }),
    ).toBe("/demos/declarative-hashbrown");
  });

  it("exposes the rendered-component selectors", () => {
    expect(METRIC_CARD_SELECTOR).toBe('[data-testid="metric-card"]');
    expect(CHART_SELECTORS).toContain('[data-testid="bar-chart"]');
    expect(CHART_SELECTORS).toContain('[data-testid="pie-chart"]');
  });

  it("pill prompts are populated", () => {
    expect(HASHBROWN_PILL.length).toBeGreaterThan(20);
    expect(JSON_RENDER_PILL.length).toBeGreaterThan(20);
  });
});
