import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  bumpPackages,
  getCommunityPackagesForScopes,
  getCurrentVersion,
  getPackagesForScope,
} from "./versions.js";

let tmpDir: string;

// Its own mock, separate from versions.test.ts: adding a community scope to
// that file's shared config would make its other scopes' fixtures incomplete.
vi.mock("./config.js", async () => {
  const scopes: Record<string, any> = {
    monorepo: {
      packages: ["@copilotkit/core"],
      versionSource: "@copilotkit/core",
      sharedVersion: true,
    },
    svelte: {
      packages: ["@copilotkit/svelte"],
      versionSource: "@copilotkit/svelte",
      sharedVersion: false,
    },
  };
  return {
    get ROOT() {
      return tmpDir || "/mock";
    },
    loadConfig: () => ({ prereleaseTag: "canary", scopes }),
    getScopeConfig: (scope: string) => scopes[scope],
  };
});

function writePackage(relativeDir: string, manifest: Record<string, unknown>) {
  const dir = path.join(tmpDir, relativeDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
}

describe("community packages in the release tooling", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-community-"));
    writePackage("packages/core", {
      name: "@copilotkit/core",
      version: "1.77.0",
    });
    writePackage("community/svelte", {
      name: "@copilotkit/svelte",
      version: "0.1.0",
      dependencies: { "@copilotkit/core": "1.77.0" },
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds a scope's package under community/", () => {
    const [svelte] = getPackagesForScope("svelte" as any);
    expect(svelte.name).toBe("@copilotkit/svelte");
    expect(svelte.dir).toBe(path.join(tmpDir, "community/svelte"));
  });

  it("reads a community scope's version from its versionSource", () => {
    expect(getCurrentVersion("svelte" as any)).toBe("0.1.0");
  });

  it("bumps a community package without touching its exact core pin", () => {
    bumpPackages("svelte" as any, "0.2.0");
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, "community/svelte/package.json"),
        "utf8",
      ),
    );
    expect(manifest.version).toBe("0.2.0");
    // Not in the svelte scope, so the pin to the published core stays as is.
    expect(manifest.dependencies["@copilotkit/core"]).toBe("1.77.0");
  });

  it("selects only community packages for the separate build", () => {
    expect(
      getCommunityPackagesForScopes(["monorepo", "svelte"] as any).map(
        (p) => p.name,
      ),
    ).toEqual(["@copilotkit/svelte"]);
    expect(getCommunityPackagesForScopes(["monorepo"] as any)).toEqual([]);
  });

  it("still works when community/ does not exist", () => {
    fs.rmSync(path.join(tmpDir, "community"), { recursive: true });
    expect(getPackagesForScope("monorepo" as any).map((p) => p.name)).toEqual([
      "@copilotkit/core",
    ]);
    expect(getCommunityPackagesForScopes(["monorepo"] as any)).toEqual([]);
  });
});
