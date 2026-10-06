// @vitest-environment node

import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertMappingCoverage,
  COMPATIBILITY_MAPPING,
} from "../../../scripts/compatibility-audit/mapping";
import type { VariantMapping } from "../../../scripts/compatibility-audit/types";
import { COMPATIBILITY_SNAPSHOT } from "../../../src/data/compatibility-snapshot";

const integrations = new URL("../../../../integrations/", import.meta.url);
const manifestSlugs = readdirSync(integrations).filter((slug) =>
  existsSync(new URL(`${slug}/manifest.yaml`, integrations)),
);

function copy(): VariantMapping[] {
  return structuredClone(COMPATIBILITY_MAPPING);
}

describe("Showcase compatibility mapping", () => {
  it("covers the manifest roster and preserves contributors outside the approved .NET policy", () => {
    expect(() =>
      assertMappingCoverage(COMPATIBILITY_MAPPING, manifestSlugs),
    ).not.toThrow();
    expect(COMPATIBILITY_MAPPING).toHaveLength(22);

    const expected = COMPATIBILITY_SNAPSHOT.rows
      .filter((row) => !row.slug.endsWith("-dotnet"))
      .flatMap((row) =>
        row.packages
          .filter((pkg) => pkg.drivesCompatibility)
          .map((pkg) => `${row.slug}/${pkg.name}`),
      );
    expect(expected).toHaveLength(30);
    const mapped = COMPATIBILITY_MAPPING.flatMap((variant) =>
      variant.libraries.map((pkg) => `${variant.slug}/${pkg.name}`),
    );
    expect(mapped).toHaveLength(34);
    expect(mapped.sort()).toEqual(
      [
        ...expected,
        "google-antigravity/google-antigravity",
        "ms-agent-dotnet/Microsoft.Agents.AI",
        "ms-agent-harness-dotnet/Microsoft.Agents.AI",
        "ms-agent-harness-dotnet/Microsoft.Agents.AI.Harness",
      ].sort(),
    );
  });

  it("keeps historical noncontributing packages explicitly excluded", () => {
    for (const row of COMPATIBILITY_SNAPSHOT.rows) {
      const mapping = COMPATIBILITY_MAPPING.find(
        (item) => item.slug === row.slug,
      );
      expect(mapping).toBeDefined();
      const exclusions = new Map(
        mapping!.excludedLibraries.map((item) => [item.name, item.reason]),
      );
      for (const pkg of row.packages.filter(
        (item) =>
          !item.drivesCompatibility && item.name !== "Microsoft.Agents.AI",
      )) {
        expect(
          exclusions.get(pkg.name),
          `${row.slug}/${pkg.name}`,
        ).toBeTruthy();
      }
    }
    expect(
      COMPATIBILITY_MAPPING.find((item) => item.slug === "built-in-agent")
        ?.excludedReason,
    ).toMatch(/CopilotKit.*external framework/);
  });

  it("requires core in both .NET variants without inventing lockfile evidence", () => {
    for (const slug of ["ms-agent-dotnet", "ms-agent-harness-dotnet"]) {
      const variant = COMPATIBILITY_MAPPING.find((item) => item.slug === slug)!;
      const expected = ["Microsoft.Agents.AI"];
      if (slug === "ms-agent-harness-dotnet")
        expected.push("Microsoft.Agents.AI.Harness");
      expect(variant.libraries.map((item) => item.name)).toEqual(expected);
      expect(
        variant.libraries.find((item) => item.name === "Microsoft.Agents.AI"),
      ).toMatchObject({
        required: true,
        role: "framework",
        source: { kind: "csproj", transitive: true },
      });
      for (const library of variant.libraries) {
        expect(library.source.lockPath).toBeUndefined();
      }
      for (const name of [
        "Microsoft.Agents.AI.Hosting",
        "Microsoft.Agents.AI.Hosting.AGUI.AspNetCore",
      ]) {
        expect(variant.excludedLibraries).toContainEqual({
          name,
          reason: expect.any(String),
        });
      }
    }
    expect(JSON.stringify(COMPATIBILITY_MAPPING)).not.toMatch(
      /runningVersion|latest|currentScore/,
    );
  });

  it("records source, lock, and Spring BOM linkage", () => {
    for (const slug of ["langgraph-typescript", "strands-typescript"]) {
      const variant = COMPATIBILITY_MAPPING.find((item) => item.slug === slug)!;
      for (const library of variant.libraries) {
        expect(library.source.path).toBe(
          `showcase/integrations/${slug}/src/agent/package.json`,
        );
        expect(library.source.lockPath).toBe(
          `showcase/integrations/${slug}/src/agent/package-lock.json`,
        );
      }
    }
    const spring = COMPATIBILITY_MAPPING.find(
      (item) => item.slug === "spring-ai",
    )!;
    expect(spring.libraries[0].source.property).toBe("spring-ai.version");
    expect(spring.libraries[1].source.managedBy).toBe(
      "org.springframework.ai:spring-ai-bom",
    );
  });

  it("rejects roster drift, duplicates, and unexplained exclusions", () => {
    expect(() =>
      assertMappingCoverage(copy(), [...manifestSlugs, "new-integration"]),
    ).toThrow(/missing=new-integration/);
    expect(() => assertMappingCoverage(copy(), manifestSlugs.slice(1))).toThrow(
      /stale=/,
    );

    const duplicateSlug = copy();
    duplicateSlug.push(structuredClone(duplicateSlug[0]));
    expect(() => assertMappingCoverage(duplicateSlug, manifestSlugs)).toThrow(
      /Duplicate or empty mapping slug/,
    );

    const duplicatePackage = copy();
    duplicatePackage[0].libraries.push(
      structuredClone(duplicatePackage[0].libraries[0]),
    );
    expect(() =>
      assertMappingCoverage(duplicatePackage, manifestSlugs),
    ).toThrow(/Duplicate or empty package/);

    const emptyReason = copy();
    emptyReason[2].excludedLibraries[0].reason = " ";
    expect(() => assertMappingCoverage(emptyReason, manifestSlugs)).toThrow(
      /Duplicate or unexplained excluded package/,
    );
  });
});
