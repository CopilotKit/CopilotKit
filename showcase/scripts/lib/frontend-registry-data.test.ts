import { expect, it } from "vitest";

import featureRegistryData from "../../shared/feature-registry.json";
import frontendRegistryData from "../../shared/frontend-registry.json";
import { normalizeFrontendRegistry } from "./frontend-registry.js";

it("declares React and Angular support for every active feature", () => {
  const registry = normalizeFrontendRegistry(
    frontendRegistryData,
    featureRegistryData.features,
  );
  const activeFeatureIds = featureRegistryData.features
    .filter((feature) => feature.deprecated !== true)
    .map((feature) => feature.id)
    .sort();

  expect(Object.keys(registry.feature_support).sort()).toEqual(
    activeFeatureIds,
  );
  for (const featureId of activeFeatureIds) {
    expect(registry.feature_support[featureId]).toHaveProperty("react");
    expect(registry.feature_support[featureId]).toHaveProperty("angular");
  }
});

it("keeps CLI docs-only and JSON Renderer permanently not applicable", () => {
  const registry = normalizeFrontendRegistry(
    frontendRegistryData,
    featureRegistryData.features,
  );

  expect(registry.feature_support["cli-start"]).toEqual({
    react: { state: "docs-only" },
    angular: { state: "docs-only" },
  });
  expect(
    registry.feature_support["declarative-json-render"].angular,
  ).toMatchObject({
    state: "not-applicable",
    reason: expect.any(String),
    owner: expect.any(String),
    review_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  });
});

it("contains no Angular quarantine", () => {
  const registry = normalizeFrontendRegistry(
    frontendRegistryData,
    featureRegistryData.features,
  );
  const quarantinedFeatures = Object.entries(registry.feature_support)
    .filter(([, support]) => support.angular.state === "quarantined")
    .map(([featureId]) => featureId);

  expect(quarantinedFeatures).toEqual([]);
});
