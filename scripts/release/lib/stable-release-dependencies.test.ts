import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertCompatiblePublishedDependency,
  preflightStableReleaseDependencies,
  readPublishedVersions,
} from "./stable-release-dependencies.js";
import { packPackage } from "./pack-workspace.js";

describe("stable cross-scope dependencies", () => {
  it("allows Channels after a compatible stable schema release", () => {
    expect(() =>
      assertCompatiblePublishedDependency({
        owner: "@copilotkit/channels-core",
        dependency: "@copilotkit/schema",
        requiredRange: "~0.1.0",
        publishedVersions: ["0.1.0", "0.1.9", "0.2.0"],
      }),
    ).not.toThrow();
  });

  it.each([
    [[], "has not been published"],
    [["0.0.9"], "No published @copilotkit/schema version satisfies ~0.1.0"],
    [["0.2.0"], "No published @copilotkit/schema version satisfies ~0.1.0"],
    [
      ["0.1.0-canary.1"],
      "No published @copilotkit/schema version satisfies ~0.1.0",
    ],
  ])(
    "blocks Channels-first and names the schema-first recovery",
    (versions, message) => {
      expect(() =>
        assertCompatiblePublishedDependency({
          owner: "@copilotkit/channels-core",
          dependency: "@copilotkit/schema",
          requiredRange: "~0.1.0",
          publishedVersions: versions,
        }),
      ).toThrow(new RegExp(`${message}.*release schema first`, "s"));
    },
  );

  it("treats registry E404 as no published versions", () => {
    const run = vi.fn(() => ({
      status: 1,
      stdout: "",
      stderr: "npm error E404",
    }));
    expect(readPublishedVersions("@copilotkit/schema", run)).toEqual([]);
  });

  it("fails closed on registry errors", () => {
    const run = vi.fn(() => ({ status: 1, stdout: "", stderr: "ECONNRESET" }));
    expect(() => readPublishedVersions("@copilotkit/schema", run)).toThrow(
      "npm registry check failed",
    );
  });

  it("does not query the registry for the schema scope", () => {
    const read = vi.fn(() => []);
    preflightStableReleaseDependencies("schema", read);
    expect(read).not.toHaveBeenCalled();
  });

  it("checks the schema range rewritten into the real packed core manifest", () => {
    const temp = mkdtempSync(join(tmpdir(), "stable-release-dependency-test-"));
    try {
      const { manifest } = packPackage("@copilotkit/channels-core", temp);
      expect(manifest.dependencies?.["@copilotkit/schema"]).toMatch(/^~/);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("runs before the stable release resolves npm or enters the publish loop", () => {
    const source = readFileSync("scripts/release/publish-release.ts", "utf8");
    const preflight = source.indexOf(
      "preflightStableReleaseDependencies(scope)",
    );
    const resolveNpm = source.indexOf("resolvePublishNpm()");
    const publishLoop = source.indexOf("for (const p of packagesToPublish)");

    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(resolveNpm);
    expect(preflight).toBeLessThan(publishLoop);
  });
});
