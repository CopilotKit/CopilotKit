import { describe, expect, it } from "vitest";

import { getAngularFeatureDocs } from "../angular-feature-docs";

describe("Angular feature docs", () => {
  it("publishes one runnable, typed source entry for every supported feature", () => {
    const features = getAngularFeatureDocs();

    expect(features).toHaveLength(41);
    for (const feature of features) {
      expect(feature.state).toBe("supported");
      expect(feature.runHref).toBe(
        `https://showcase.copilotkit.ai/angular/${feature.integration}/${feature.id}`,
      );
      expect(feature.sourceHref).toBe(`${feature.runHref}/code`);
      expect(feature.apiHref).toMatch(/^\/reference\/angular/);
    }
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
