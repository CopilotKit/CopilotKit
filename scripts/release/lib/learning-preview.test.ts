import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { valid } from "semver";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_SCOPES,
  LEARNING_PREVIEW,
  ROOT,
  getScopeConfig,
  resolveScopes,
} from "./config.js";
import {
  computePrereleaseVersion,
  getCurrentVersion,
  getPackagesForScope,
  pinPrereleaseDependencies,
} from "./versions.js";
import type { PublishablePackage } from "./versions.js";
import type { PackedManifest } from "./pack-workspace.js";
import {
  LEARNING_PACKAGE,
  publishPrereleasePackages,
  verifyPackedLearningPreview,
} from "./learning-preview.js";

let temp: string;
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "learning-preview-test-"));
});
afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});

function fixture(
  name: string,
  version: string,
  dependencies: Record<string, string> = {},
): PublishablePackage {
  const dir = join(temp, name.replace("@copilotkit/", ""));
  mkdirSync(dir, { recursive: true });
  const pkg = { name, version, main: "index.cjs", dependencies };
  const pkgJsonPath = join(dir, "package.json");
  writeFileSync(pkgJsonPath, JSON.stringify(pkg));
  writeFileSync(
    join(dir, "index.cjs"),
    name === LEARNING_PACKAGE
      ? `module.exports = ${JSON.stringify(version)};`
      : `module.exports = require(${JSON.stringify(LEARNING_PACKAGE)});`,
  );
  return { name, dir, pkgJsonPath, pkg };
}

const previewPackages = () => [
  fixture("@copilotkit/core", "1.76.1-canary.preview.123", {
    [LEARNING_PACKAGE]: "workspace:*",
  }),
  fixture(LEARNING_PACKAGE, "0.0.2-canary.preview.123"),
];

function pack(pkg: PublishablePackage) {
  execFileSync("pnpm", ["pack", "--pack-destination", temp], {
    cwd: pkg.dir,
    stdio: "pipe",
  });
  const tarball = join(
    temp,
    `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.pkg.version}.tgz`,
  );
  const manifest: PackedManifest = JSON.parse(
    execFileSync("tar", ["-xOf", tarball, "package/package.json"], {
      encoding: "utf8",
    }),
  );
  return { tarball, manifest };
}

describe("learning-preview composition", () => {
  it("selects exactly the two independent groups, preserving regular selectors", () => {
    expect(resolveScopes(LEARNING_PREVIEW)).toEqual(["monorepo", "learning"]);
    expect(resolveScopes("learning")).toEqual(["learning"]);
    expect(resolveScopes("monorepo")).toEqual(["monorepo"]);
    expect(resolveScopes(ALL_SCOPES)).toContain("angular");
    expect(getScopeConfig("monorepo").packages).not.toContain(LEARNING_PACKAGE);
    const names = resolveScopes(LEARNING_PREVIEW).flatMap((scope) =>
      getPackagesForScope(scope).map((pkg) => pkg.name),
    );
    expect(names).toEqual([
      ...getScopeConfig("monorepo").packages,
      LEARNING_PACKAGE,
    ]);
    expect(new Set(names).size).toBe(18);
  });

  it("keeps separate version bases and one shared canary id", () => {
    expect(getCurrentVersion("learning")).toBe("0.0.1");
    const suffix = "learning-preview.123.1";
    expect(computePrereleaseVersion("1.76.0", suffix)).toBe(
      `1.76.1-canary.${suffix}`,
    );
    expect(
      computePrereleaseVersion(getCurrentVersion("learning"), suffix),
    ).toBe(`0.0.2-canary.${suffix}`);
  });

  it("packs and installs Core against the exact Learning from this run", () => {
    const packages = previewPackages();
    pinPrereleaseDependencies(packages);
    const core = pack(packages[0]);
    const learning = pack(packages[1]);
    expect(core.manifest.dependencies?.[LEARNING_PACKAGE]).toBe(
      learning.manifest.version,
    );
    verifyPackedLearningPreview(LEARNING_PREVIEW, packages, core.manifest);
    const consumer = join(temp, "consumer");
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({
        name: "preview-consumer",
        private: true,
        dependencies: {
          "@copilotkit/core": `file:${core.tarball}`,
          [LEARNING_PACKAGE]: `file:${learning.tarball}`,
        },
        pnpm: { overrides: { [LEARNING_PACKAGE]: `file:${learning.tarball}` } },
      }),
    );
    execFileSync(
      "pnpm",
      [
        "install",
        "--offline",
        "--ignore-scripts",
        "--store-dir",
        join(temp, "store"),
      ],
      { cwd: consumer, stdio: "pipe" },
    );
    const installed = execFileSync(
      process.execPath,
      ["-p", 'require("@copilotkit/core")'],
      { cwd: consumer, encoding: "utf8" },
    ).trim();
    expect(installed).toBe("0.0.2-canary.preview.123");
  });

  it.each([undefined, "1.76.0", "^0.0.2-canary.preview.123", "0.0.1"])(
    "rejects a packed Core pin outside this run: %s",
    (version) => {
      const manifest: PackedManifest = {
        name: "@copilotkit/core",
        version: "1.76.1-canary.preview.123",
        dependencies:
          version === undefined ? {} : { [LEARNING_PACKAGE]: version },
      };
      expect(() =>
        verifyPackedLearningPreview(
          LEARNING_PREVIEW,
          previewPackages(),
          manifest,
        ),
      ).toThrow("same-run");
    },
  );
});

describe("preview publish ordering", () => {
  it("waits for Learning success before attempting dependent packages", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const attempted: string[] = [];
    const pending = publishPrereleasePackages(
      LEARNING_PREVIEW,
      previewPackages(),
      4,
      async (pkg) => {
        attempted.push(pkg.name);
        if (pkg.name === LEARNING_PACKAGE) await gate;
        return pkg.name;
      },
    );
    expect(attempted).toEqual([LEARNING_PACKAGE]);
    finish();
    await pending;
    expect(attempted).toEqual([LEARNING_PACKAGE, "@copilotkit/core"]);
  });

  it("stops before consumers when Learning fails", async () => {
    const publish = vi
      .fn<(pkg: PublishablePackage) => Promise<string>>()
      .mockRejectedValue(new Error("registry rejected Learning"));
    const results = await publishPrereleasePackages(
      LEARNING_PREVIEW,
      previewPackages(),
      4,
      publish,
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect(results[0].error).toEqual(new Error("registry rejected Learning"));
  });

  it("keeps regular concurrent publication and all failure reports", async () => {
    const publish = vi
      .fn<(pkg: PublishablePackage) => Promise<string>>()
      .mockRejectedValue(new Error("registry failure"));
    const results = await publishPrereleasePackages(
      ALL_SCOPES,
      previewPackages(),
      4,
      publish,
    );
    expect(publish).toHaveBeenCalledTimes(2);
    expect(results.every((result) => result.error instanceof Error)).toBe(true);
  });

  it("fails closed before publishing if the preview lacks Learning", async () => {
    const publish = vi.fn<(pkg: PublishablePackage) => Promise<string>>();
    await expect(
      publishPrereleasePackages(
        LEARNING_PREVIEW,
        [previewPackages()[0]],
        4,
        publish,
      ),
    ).rejects.toThrow("exactly one");
    expect(publish).not.toHaveBeenCalled();
  });
});

// Exercise the actual workflow shell, so changes to guards/identifier plumbing
// cannot drift from this test's model of them. No gh or npm publish is executed.
function workflowRuns(file: string, name: string) {
  const source = readFileSync(join(ROOT, ".github/workflows", file), "utf8");
  return source
    .split(/^      - name: /m)
    .filter((block) => block.startsWith(`${name}\n`))
    .map((block) => {
      const run = block.match(/^        run: \|\n((?:          .*\n)+)/m)?.[1];
      if (!run) throw new Error(`Missing shell for ${name}`);
      return run
        .split("\n")
        .map((line) => line.slice(10))
        .join("\n");
    });
}

function runShell(script: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    cwd: temp,
    env: {
      ...process.env,
      GITHUB_OUTPUT: join(temp, "output"),
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      ...env,
    },
  });
}

describe("canary workflow controls", () => {
  it.each([
    [LEARNING_PREVIEW, "refs/heads/main", 0],
    [LEARNING_PREVIEW, "refs/heads/feature", 1],
    [LEARNING_PREVIEW, "refs/tags/v1", 1],
    ["monorepo", "refs/heads/main", 1],
    ["monorepo", "refs/heads/feature", 0],
    [ALL_SCOPES, "refs/tags/v1", 1],
  ])("guards selector %s on %s", (scope, ref, expected) => {
    expect(
      runShell(workflowRuns("canary.yml", "Guard ref")[0], {
        SCOPE: scope,
        REF: ref,
      }).status,
    ).toBe(expected);
  });

  it("generates fresh preview identifiers for every attempt and retains regular labels", () => {
    const script = workflowRuns("canary.yml", "Compute canary branch name")[0];
    const output = join(temp, "output");
    for (const [scope, attempt, label, suffix] of [
      [LEARNING_PREVIEW, "1", "label", "learning-preview-label.123.1"],
      [LEARNING_PREVIEW, "2", "label", "learning-preview-label.123.2"],
      [LEARNING_PREVIEW, "1", "01..a_b", "learning-preview-01--a-b.123.1"],
      [LEARNING_PREVIEW, "1", "", "learning-preview.123.1"],
      ["monorepo", "1", "label", "label"],
    ]) {
      writeFileSync(output, "");
      expect(
        runShell(script, {
          SCOPE: scope,
          REF_NAME: "main",
          INPUT_SUFFIX: label,
          GITHUB_RUN_ATTEMPT: attempt,
        }).status,
      ).toBe(0);
      expect(readFileSync(output, "utf8")).toContain(`suffix=${suffix}\n`);
      if (scope === LEARNING_PREVIEW) {
        const version = computePrereleaseVersion("0.0.1", suffix);
        expect(valid(version)).toBe(version);
      }
    }
  });

  it("rejects stable preview dispatches in both build and publish jobs", () => {
    const guards = workflowRuns(
      "publish-release.yml",
      "Determine scope and mode",
    );
    expect(guards).toHaveLength(2);
    for (const script of guards) {
      expect(
        runShell(script, {
          INPUT_SCOPE: LEARNING_PREVIEW,
          INPUT_MODE: "stable",
          PR_HEAD_REF: "",
        }).status,
      ).toBe(1);
      expect(
        runShell(script, {
          INPUT_SCOPE: LEARNING_PREVIEW,
          INPUT_MODE: "prerelease",
          PR_HEAD_REF: "",
        }).status,
      ).toBe(0);
    }
  });
});
