import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  parseSemver,
  computeNextStableVersion,
  computePrereleaseVersion,
  resolvePrereleaseId,
  bumpPackages,
  findCrossScopeWorkspaceDeps,
  getPackagesForScope,
} from "./versions.js";

let tmpDir: string;

// Mock config — ROOT points to a temp dir for bumpPackages tests
vi.mock("./config.js", async () => {
  return {
    get ROOT() {
      return tmpDir || "/mock";
    },
    loadConfig: () => ({
      prereleaseTag: "canary",
      scopes: {
        monorepo: {
          packages: ["@copilotkit/react-core", "@copilotkit/shared"],
          versionSource: "@copilotkit/react-core",
          sharedVersion: true,
        },
        angular: {
          packages: ["@copilotkit/angular"],
          versionSource: "@copilotkit/angular",
          sharedVersion: false,
        },
      },
    }),
    getScopeConfig: (scope: string) => {
      const scopes: Record<string, any> = {
        monorepo: {
          packages: ["@copilotkit/react-core", "@copilotkit/shared"],
          versionSource: "@copilotkit/react-core",
          sharedVersion: true,
        },
        angular: {
          packages: ["@copilotkit/angular"],
          versionSource: "@copilotkit/angular",
          sharedVersion: false,
        },
      };
      return scopes[scope];
    },
  };
});

describe("parseSemver", () => {
  it("parses a stable version", () => {
    expect(parseSemver("1.55.2")).toEqual({
      major: 1,
      minor: 55,
      patch: 2,
      prerelease: null,
    });
  });

  it("parses a prerelease version", () => {
    expect(parseSemver("1.55.2-canary.1744382400")).toEqual({
      major: 1,
      minor: 55,
      patch: 2,
      prerelease: "canary.1744382400",
    });
  });

  it("parses a version with text prerelease", () => {
    expect(parseSemver("2.0.0-canary.fix-user-issue")).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      prerelease: "canary.fix-user-issue",
    });
  });

  it("throws on invalid version", () => {
    expect(() => parseSemver("not-a-version")).toThrow("Invalid semver");
  });

  it("throws on empty string", () => {
    expect(() => parseSemver("")).toThrow("Invalid semver");
  });
});

describe("computeNextStableVersion", () => {
  it("bumps patch", () => {
    expect(computeNextStableVersion("1.55.2", "patch")).toBe("1.55.3");
  });

  it("bumps minor", () => {
    expect(computeNextStableVersion("1.55.2", "minor")).toBe("1.56.0");
  });

  it("bumps major", () => {
    expect(computeNextStableVersion("1.55.2", "major")).toBe("2.0.0");
  });

  it("strips prerelease suffix on any bump", () => {
    expect(computeNextStableVersion("1.56.0-canary.123", "patch")).toBe(
      "1.56.0",
    );
  });

  it("strips prerelease suffix regardless of bump level", () => {
    expect(computeNextStableVersion("2.0.0-canary.123", "major")).toBe("2.0.0");
  });

  it("handles 0.x versions", () => {
    expect(computeNextStableVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(computeNextStableVersion("0.1.0", "minor")).toBe("0.2.0");
    expect(computeNextStableVersion("0.1.0", "major")).toBe("1.0.0");
  });
});

describe("resolvePrereleaseId", () => {
  it("uses the supplied suffix verbatim", () => {
    expect(resolvePrereleaseId("fix-user-issue")).toBe("fix-user-issue");
  });

  it("falls back to a unix timestamp", () => {
    expect(resolvePrereleaseId()).toMatch(/^\d+$/);
    expect(resolvePrereleaseId("")).toMatch(/^\d+$/);
  });
});

describe("computePrereleaseVersion", () => {
  it("appends canary tag with timestamp when no suffix given", () => {
    const result = computePrereleaseVersion("1.55.2");
    expect(result).toMatch(/^1\.55\.3-canary\.\d+$/);
  });

  it("appends canary tag with custom suffix", () => {
    expect(computePrereleaseVersion("1.55.2", "fix-user-issue")).toBe(
      "1.55.3-canary.fix-user-issue",
    );
  });

  // A stable release leaves the working tree on the version it published, so
  // basing the canary on that version would publish a prerelease BELOW the
  // release it was cut from — unreachable by any dependent range, and a `canary`
  // dist-tag pointing behind `latest`.
  it("bumps the patch so the canary sorts above the released version", () => {
    expect(computePrereleaseVersion("1.55.2", "test")).toBe(
      "1.55.3-canary.test",
    );
    expect(computePrereleaseVersion("2.0.0", "test")).toBe("2.0.1-canary.test");
    expect(computePrereleaseVersion("0.2.1", "test")).toBe("0.2.2-canary.test");
  });

  // An existing prerelease means the tree is ALREADY on an unreleased version;
  // bumping again would skip it.
  it("reuses the base version when it already carries a prerelease", () => {
    expect(computePrereleaseVersion("1.55.2-canary.old", "new")).toBe(
      "1.55.2-canary.new",
    );
    expect(computePrereleaseVersion("1.56.0-alpha.1", "new")).toBe(
      "1.56.0-canary.new",
    );
  });
});

describe("bumpPackages", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-test-"));
    const packagesDir = path.join(tmpDir, "packages");

    // Create shared package
    const sharedDir = path.join(packagesDir, "shared");
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(
      path.join(sharedDir, "package.json"),
      JSON.stringify({
        name: "@copilotkit/shared",
        version: "1.55.2",
      }),
    );

    // Create react-core with workspace:* dep on shared
    const reactCoreDir = path.join(packagesDir, "react-core");
    fs.mkdirSync(reactCoreDir, { recursive: true });
    fs.writeFileSync(
      path.join(reactCoreDir, "package.json"),
      JSON.stringify({
        name: "@copilotkit/react-core",
        version: "1.55.2",
        dependencies: {
          "@copilotkit/shared": "workspace:*",
        },
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("bumps version fields", () => {
    const result = bumpPackages("monorepo", "1.55.3");
    expect(result).toHaveLength(2);
    expect(result[0].newVersion).toBe("1.55.3");

    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, "packages/shared/package.json"),
        "utf8",
      ),
    );
    expect(pkg.version).toBe("1.55.3");
  });

  it("preserves workspace:* protocol in dependencies", () => {
    bumpPackages("monorepo", "1.55.3");

    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, "packages/react-core/package.json"),
        "utf8",
      ),
    );
    expect(pkg.dependencies["@copilotkit/shared"]).toBe("workspace:*");
  });

  it("updates exact version deps (not workspace protocol)", () => {
    // Write react-core with an exact version dep instead of workspace:*
    fs.writeFileSync(
      path.join(tmpDir, "packages/react-core/package.json"),
      JSON.stringify({
        name: "@copilotkit/react-core",
        version: "1.55.2",
        dependencies: {
          "@copilotkit/shared": "1.55.2",
        },
      }),
    );

    bumpPackages("monorepo", "1.55.3");

    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, "packages/react-core/package.json"),
        "utf8",
      ),
    );
    expect(pkg.dependencies["@copilotkit/shared"]).toBe("1.55.3");
  });

  it("preserves the configured publish order", () => {
    expect(getPackagesForScope("monorepo").map((pkg) => pkg.name)).toEqual([
      "@copilotkit/react-core",
      "@copilotkit/shared",
    ]);
  });
});

// Mirrors the real @copilotkit/runtime -> @copilotkit/channels-intelligence edge:
// a package in one release scope carrying a workspace: dep on a package owned by
// another. pnpm pack pins those to the working-tree version, so a canary of only
// the depending scope ships against the OTHER scope's last stable release.
describe("findCrossScopeWorkspaceDeps", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-test-"));
    const packagesDir = path.join(tmpDir, "packages");

    const write = (dir: string, pkg: Record<string, unknown>) => {
      const target = path.join(packagesDir, dir);
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "package.json"), JSON.stringify(pkg));
    };

    write("shared", { name: "@copilotkit/shared", version: "1.55.2" });
    write("react-core", {
      name: "@copilotkit/react-core",
      version: "1.55.2",
      dependencies: {
        "@copilotkit/shared": "workspace:*",
        "@copilotkit/angular": "workspace:^",
        "some-third-party": "^1.0.0",
      },
      devDependencies: { "@copilotkit/angular": "workspace:*" },
    });
    write("angular", { name: "@copilotkit/angular", version: "0.2.0" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports the version a dependency outside the published scopes pins to", () => {
    expect(findCrossScopeWorkspaceDeps(["monorepo"])).toEqual([
      {
        from: "@copilotkit/react-core",
        dep: "@copilotkit/angular",
        depScope: "angular",
        resolvesTo: "0.2.0",
      },
    ]);
  });

  it("reports nothing once every scope on the edge is published together", () => {
    expect(findCrossScopeWorkspaceDeps(["monorepo", "angular"])).toEqual([]);
  });

  it("ignores in-scope deps and third-party ranges", () => {
    const found = findCrossScopeWorkspaceDeps(["monorepo"]);
    expect(found.map((edge) => edge.dep)).not.toContain("@copilotkit/shared");
    expect(found.map((edge) => edge.dep)).not.toContain("some-third-party");
  });
});
