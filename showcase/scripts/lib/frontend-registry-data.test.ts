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

it("freezes 41 supported Angular features and records all three exclusions", () => {
  const registry = normalizeFrontendRegistry(
    frontendRegistryData,
    featureRegistryData.features,
  );

  const supported = Object.values(registry.feature_support).filter(
    (support) => support.angular.state === "supported",
  );
  expect(supported).toHaveLength(41);
  expect(registry.feature_support["cli-start"].angular).toMatchObject({
    state: "not-applicable",
    reason: expect.any(String),
    owner: expect.any(String),
    review_date: "2027-01-21",
  });
  expect(
    registry.feature_support["declarative-hashbrown"].angular,
  ).toMatchObject({
    state: "not-supported",
    reason: expect.any(String),
    owner: expect.any(String),
    review_date: "2027-01-21",
  });
  expect(
    registry.feature_support["declarative-json-render"].angular,
  ).toMatchObject({
    state: "not-applicable",
    reason: expect.any(String),
    owner: expect.any(String),
    review_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  });
  expect(
    registry.feature_support["declarative-json-render"].angular.reason,
  ).not.toMatch(/Hashbrown/i);
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
