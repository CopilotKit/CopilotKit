// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  selectDeployedImages,
  waitForDeployedImages,
} from "../../../scripts/compatibility-audit/deployed";
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
afterEach(() => vi.useRealTimers());
describe("deployment readiness", () => {
  it("waits through a deployment transition before selecting the new image", async () => {
    vi.useFakeTimers();
    const rolling = metadata([{ ...active, status: "DEPLOYING" }]);
    rolling.data.project.services.edges[0].node.serviceInstances.edges[0].node.latestDeployment.status =
      "DEPLOYING";
    const read = vi
      .fn()
      .mockResolvedValueOnce(rolling)
      .mockResolvedValue(metadata([active]));
    const result = waitForDeployedImages(read, "prod-id", ["example"]);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(result).resolves.toEqual({
      example: "ghcr.io/copilotkit/showcase-example@" + digest,
    });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("waits for overlapping successful images to settle to one digest", async () => {
    vi.useFakeTimers();
    const overlapping = metadata([
      active,
      { ...active, meta: { imageDigest: "sha256:" + "b".repeat(64) } },
    ]);
    const read = vi
      .fn()
      .mockResolvedValueOnce(overlapping)
      .mockResolvedValue(metadata([active]));
    const result = waitForDeployedImages(read, "prod-id", ["example"]);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(result).resolves.toEqual({
      example: "ghcr.io/copilotkit/showcase-example@" + digest,
    });
  });
  it("fails after the bounded wait when a deployment never settles", async () => {
    vi.useFakeTimers();
    const rolling = metadata([{ ...active, status: "DEPLOYING" }]);
    const result = waitForDeployedImages(async () => rolling, "prod-id", [
      "example",
    ]);
    const assertion = expect(result).rejects.toThrow(
      "still settling after 600000ms",
    );
    await vi.advanceTimersByTimeAsync(600_000);
    await assertion;
  });
  it("does not retry missing digest evidence on a settled deployment", async () => {
    const read = vi.fn(async () =>
      metadata([{ status: "SUCCESS", meta: null }]),
    );
    await expect(
      waitForDeployedImages(read, "prod-id", ["example"]),
    ).rejects.toThrow("Missing or ambiguous active image digest");
    expect(read).toHaveBeenCalledTimes(1);
  });
});
describe("deployed source selection", () => {
  it("reports permanent roster errors even when an earlier integration is deploying", () => {
    const rolling = metadata([{ ...active, status: "DEPLOYING" }]);
    expect(() =>
      selectDeployedImages(rolling, "prod-id", ["example", "missing"]),
    ).toThrow("Missing or ambiguous deployed service: missing");
  });
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
  it("does not assess the old active image while its replacement is deploying", () => {
    const rolling = metadata([active]);
    rolling.data.project.services.edges[0].node.serviceInstances.edges[0].node.latestDeployment.status =
      "DEPLOYING";
    expect(() => selectDeployedImages(rolling, "prod-id", ["example"])).toThrow(
      "Deployment is still settling",
    );
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
