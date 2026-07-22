import { describe, expect, it } from "vitest";

import featureRegistry from "../../shared/feature-registry.json";
import frontendRegistry from "../../shared/frontend-registry.json";
import { buildAngularFeatureSearchEntries } from "./angular-feature-search";

describe("Angular feature search entries", () => {
  it("indexes every supported Angular feature", () => {
    const entries = buildAngularFeatureSearchEntries(
      frontendRegistry,
      featureRegistry,
    );

    expect(entries).toHaveLength(41);
    for (const entry of entries) {
      expect(entry.type).toBe("page");
      expect(entry.title).toMatch(/ — Angular example$/);
      expect(entry.section).toBe("Angular features");
      expect(entry.href).toMatch(/^\/angular\/features#[a-z0-9-]+$/);
    }
  });

  it("omits CLI, Hashbrown, and JSON Renderer entries", () => {
    const hrefs = buildAngularFeatureSearchEntries(
      frontendRegistry,
      featureRegistry,
    ).map((entry) => entry.href);

    expect(hrefs).not.toEqual(
      expect.arrayContaining([
        "/angular/features#cli-start",
        "/angular/features#declarative-hashbrown",
        "/angular/features#declarative-json-render",
      ]),
    );
  });
});
