// @vitest-environment node
import { describe, expect, it } from "vitest";
import { selectDeployedImages } from "../../../scripts/compatibility-audit/deployed";
import { assessCompatibility } from "../../../scripts/compatibility-audit/snapshot";
import type { VariantMapping } from "../../../scripts/compatibility-audit/types";

const digest = "sha256:" + "a".repeat(64);
function metadata(
  active: { status: string; meta: { imageDigest?: string } | null }[],
  environmentId = "prod-id",
) {
  return {
    data: {
      project: {
        services: {
          edges: [
            {
              node: {
                name: "showcase-example",
                serviceInstances: {
                  edges: [
                    {
                      node: {
                        environmentId,
                        source: {
                          image: "ghcr.io/copilotkit/showcase-example:latest",
                        },
                        activeDeployments: active,
                        latestDeployment: {
                          status: "FAILED",
                          meta: { imageDigest: "sha256:" + "b".repeat(64) },
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  };
}
const active = { status: "SUCCESS", meta: { imageDigest: digest } };
describe("deployed source selection", () => {
  it("uses the active image rather than a failed newer deployment or mutable latest tag", () => {
    expect(
      selectDeployedImages(metadata([active]), "prod-id", ["example"]),
    ).toEqual({
      example: "ghcr.io/copilotkit/showcase-example@" + digest,
    });
  });
  it("refuses to substitute another environment's deployment", () => {
    expect(() =>
      selectDeployedImages(metadata([active], "staging-id"), "prod-id", [
        "example",
      ]),
    ).toThrow();
  });
  it("refuses ambiguous running images during a deployment transition", () => {
    expect(() =>
      selectDeployedImages(
        metadata([
          active,
          { ...active, meta: { imageDigest: "sha256:" + "b".repeat(64) } },
        ]),
        "prod-id",
        ["example"],
      ),
    ).toThrow();
  });
  it("scores two integrations from their own source files and records their commit provenance", () => {
    const commits = { first: "a".repeat(40), second: "b".repeat(40) };
    const mapping: VariantMapping[] = Object.keys(commits).map((slug) => ({
      slug,
      language: "python",
      excludedLibraries: [],
      libraries: [
        {
          name: "example",
          registry: "pypi",
          role: "framework",
          required: true,
          reason: "framework",
          source: { kind: "requirements", path: "shared/requirements.txt" },
          releasePolicy: "stable",
        },
      ],
    }));
    const result = assessCompatibility({
      sourceSha: "c".repeat(40),
      sourceCommits: commits,
      mapping,
      asOf: "2026-10-13T12:00:00Z",
      read: () => {
        throw new Error("Main must not supply deployed versions");
      },
      readForVariant: (slug) =>
        slug === "first" ? "example==1.2.3" : "example==1.2.1",
      inventories: [
        {
          registry: "pypi",
          name: "example",
          sourceUrl: "https://pypi.org/project/example/",
          complete: true,
          diagnostics: [],
          releases: [
            {
              version: "1.2.3",
              timestamp: "2026-10-01T00:00:00Z",
              timestampKind: "published",
              eligible: true,
            },
          ],
        },
      ],
    });
    expect(result.snapshot.rows.map((row) => row.currentScore)).toEqual([
      100, 98,
    ]);
    expect(result.packages.map((pkg) => pkg.sourceSha)).toEqual(
      Object.values(commits),
    );
  });
});
