/**
 * CI drift test — Phase 3.7.
 * Asserts that the package set in showcase/shared/packages.json matches
 * the set of integration slugs from the registry (both derived from
 * the same source). This prevents ops discovery and dashboard rendering
 * from silently diverging.
 */
import { describe, it, expect } from "vitest";
import { getPackages } from "./registry";
import registryData from "../../../shell/src/data/registry.json";

interface RegistryShape {
  integrations: Array<{ slug: string }>;
  packages?: Array<{ slug: string }>;
}

describe("packages-drift", () => {
  it("packages.json slugs match integration slugs from registry", () => {
    const registry = registryData as unknown as RegistryShape;
    const integrationSlugs = new Set(registry.integrations.map((i) => i.slug));
    const packageSlugs = new Set(getPackages().map((p) => p.slug));

    // Every package must correspond to an integration
    for (const slug of packageSlugs) {
      expect(
        integrationSlugs.has(slug),
        `package ${slug} not in integrations`,
      ).toBe(true);
    }

    // Every integration must have a corresponding package
    for (const slug of integrationSlugs) {
      expect(
        packageSlugs.has(slug),
        `integration ${slug} not in packages`,
      ).toBe(true);
    }

    expect(packageSlugs.size).toBe(integrationSlugs.size);
  });
});
