import { describe, expect, it } from "vitest";

import { getAngularFeatureDocs } from "../angular-feature-docs";

describe("Angular feature docs", () => {
  it("publishes typed source for every supported feature", () => {
    const features = getAngularFeatureDocs();

    expect(features).toHaveLength(41);
    for (const feature of features) {
      expect(feature.state).toBe("supported");
      const route = `https://showcase.copilotkit.ai/angular/${feature.integration}/${feature.id}`;
      expect(feature.runHref).toBe(feature.runnable ? route : null);
      expect(feature.sourceHref).toBe(`${route}/code`);
      expect(feature.apiHref).toMatch(/^\/reference\/angular/);
    }
    expect(
      features.filter((feature) => !feature.runnable).map(({ id }) => id),
    ).toEqual(["threadid-frontend-tool-roundtrip"]);
  });

  it("omits CLI, Hashbrown, and JSON Renderer from Angular feature docs", () => {
    expect(getAngularFeatureDocs().map((feature) => feature.id)).not.toEqual(
      expect.arrayContaining([
        "cli-start",
        "declarative-hashbrown",
        "declarative-json-render",
      ]),
    );
  });
});
